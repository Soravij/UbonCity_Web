import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import OpenAI from "openai";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";
const EVENT_LANGS = ["th", "en", "zh", "lo"];
const LANGUAGE_LABELS = {
  th: "Thai",
  en: "English",
  zh: "Chinese (Simplified)",
  lo: "Lao",
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let ensuredEventsTable = false;

function isAuthenticatedRequest(req) {
  try {
    const authHeader = String(req.headers?.authorization || "").trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return false;

    const decoded = jwt.verify(match[1], JWT_SECRET);
    return Boolean(decoded?.id);
  } catch {
    return false;
  }
}

function parseModelJson(rawText) {
  const text = String(rawText || "").trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const fencedBody = fenceMatch ? fenceMatch[1].trim() : text;

  try {
    return JSON.parse(fencedBody);
  } catch {
    const start = fencedBody.indexOf("{");
    const end = fencedBody.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(fencedBody.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function looksCorruptedTranslation(value) {
  const text = String(value || "").trim();
  if (!text) return true;

  const qmarks = (text.match(/\?/g) || []).length;
  return qmarks >= 3 && qmarks / Math.max(text.length, 1) >= 0.3;
}

function isInvalidTranslationPayload(payload) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  if (!title || !description) return true;
  return looksCorruptedTranslation(title) || looksCorruptedTranslation(description);
}

async function requestTranslation({ title, description, sourceLang, targetLang, strict = false }) {
  const strictLine = strict
    ? "If output contains question-mark placeholders like ???, regenerate proper target-language text."
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a professional tourism translator. Translate naturally for travel content. Return only JSON with keys title and description.",
      },
      {
        role: "user",
        content:
          `Source language: ${LANGUAGE_LABELS[sourceLang] || sourceLang} (${sourceLang})\n` +
          `Target language: ${LANGUAGE_LABELS[targetLang] || targetLang} (${targetLang})\n` +
          "Do not keep the original source text. The output must be fully in the target language.\n" +
          "For target lo, output must be in Lao language (not Thai).\n" +
          `${strictLine}\n\n` +
          `Title: ${title}\n` +
          `Description: ${description}`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  return parseModelJson(text);
}

async function buildEventTranslations(title, description) {
  const sourceTitle = String(title || "").trim();
  const sourceDescription = String(description || "").trim();
  const hasDescription = Boolean(sourceDescription);

  const map = {
    th: {
      title: sourceTitle,
      description: sourceDescription,
    },
  };

  for (const lang of EVENT_LANGS) {
    if (lang === "th") continue;

    let parsed = await requestTranslation({
      title: sourceTitle,
      description: hasDescription ? sourceDescription : sourceTitle,
      sourceLang: "th",
      targetLang: lang,
    });

    if (isInvalidTranslationPayload(parsed)) {
      parsed = await requestTranslation({
        title: sourceTitle,
        description: hasDescription ? sourceDescription : sourceTitle,
        sourceLang: "th",
        targetLang: lang,
        strict: true,
      });
    }

    const outTitle = String(parsed?.title || "").trim();
    const outDescription = hasDescription ? String(parsed?.description || "").trim() : "";

    if (!outTitle || looksCorruptedTranslation(outTitle)) {
      throw new Error(`Translation failed for ${lang}`);
    }

    if (hasDescription && (!outDescription || looksCorruptedTranslation(outDescription))) {
      throw new Error(`Translation failed for ${lang}`);
    }

    map[lang] = { title: outTitle, description: outDescription };
  }

  return map;
}

async function upsertEventTranslation(eventId, lang, title, description) {
  await pool.query(
    `INSERT INTO event_translations (event_id,lang,title,description)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description)`,
    [Number(eventId), lang, String(title || "").trim() || null, String(description || "").trim() || null]
  );
}

async function ensureEventsTable() {
  if (ensuredEventsTable) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id INT NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      image VARCHAR(1024) NULL,
      is_approved TINYINT(1) NOT NULL DEFAULT 0,
      approved_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_translations (
      id INT NOT NULL AUTO_INCREMENT,
      event_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_event_lang (event_id, lang)
    )
  `);

  const [approvedCol] = await pool.query("SHOW COLUMNS FROM events LIKE 'is_approved'");
  if (!approvedCol.length) {
    await pool.query("ALTER TABLE events ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 0");
  }

  const [approvedAtCol] = await pool.query("SHOW COLUMNS FROM events LIKE 'approved_at'");
  if (!approvedAtCol.length) {
    await pool.query("ALTER TABLE events ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL");
  }

  const [legacyPublishCol] = await pool.query("SHOW COLUMNS FROM events LIKE 'is_published'");
  if (legacyPublishCol.length) {
    await pool.query(
      "UPDATE events SET is_approved=1, approved_at=COALESCE(approved_at, updated_at) WHERE is_published=1"
    );
  }

  // Backfill TH translation for legacy rows.
  await pool.query(
    `INSERT INTO event_translations (event_id,lang,title,description)
     SELECT e.id, 'th', e.title, e.description
     FROM events e
     LEFT JOIN event_translations et ON et.event_id=e.id AND et.lang='th'
     WHERE et.id IS NULL`
  );

  // Ensure all supported languages exist at least with TH fallback.
  for (const lang of ["en", "zh", "lo"]) {
    await pool.query(
      `INSERT INTO event_translations (event_id,lang,title,description)
       SELECT th.event_id, ?, th.title, th.description
       FROM event_translations th
       LEFT JOIN event_translations target ON target.event_id=th.event_id AND target.lang=?
       WHERE th.lang='th' AND target.id IS NULL`,
      [lang, lang]
    );
  }

  ensuredEventsTable = true;
}

export const getEvents = async (req, res) => {
  try {
    await ensureEventsTable();

    const lang = EVENT_LANGS.includes(String(req.query?.lang || "")) ? String(req.query.lang) : "th";
    const includeUnapproved =
      String(req.query?.include_unapproved || "") === "1" && isAuthenticatedRequest(req);

    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.image,
         e.is_approved,
         e.approved_at,
         e.created_at,
         e.updated_at,
         ? AS lang,
         COALESCE(et_req.title, et_th.title, e.title) AS title,
         COALESCE(et_req.description, et_th.description, e.description) AS description
       FROM events e
       LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
       LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
       ${includeUnapproved ? "" : "WHERE e.is_approved=1"}
       ORDER BY COALESCE(e.approved_at, e.updated_at) DESC, e.id DESC`,
      [lang, lang]
    );

    return res.json({ items: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getEventDetail = async (req, res) => {
  try {
    await ensureEventsTable();

    const includeUnapproved =
      String(req.query?.include_unapproved || "") === "1" && isAuthenticatedRequest(req);

    const { id } = req.params;
    const lang = EVENT_LANGS.includes(String(req.query?.lang || "")) ? String(req.query.lang) : "th";

    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.image,
         e.is_approved,
         e.approved_at,
         e.created_at,
         e.updated_at,
         ? AS lang,
         COALESCE(et_req.title, et_th.title, e.title) AS title,
         COALESCE(et_req.description, et_th.description, e.description) AS description
       FROM events e
       LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
       LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
       WHERE e.id=? ${includeUnapproved ? "" : "AND e.is_approved=1"}
       LIMIT 1`,
      [lang, lang, Number(id)]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json({ item: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const createEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const { title, description, image } = req.body || {};
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();

    if (!cleanTitle) {
      return res.status(400).json({ error: "title is required" });
    }

    const [result] = await pool.query(
      "INSERT INTO events (title,description,image,is_approved,approved_at) VALUES (?,?,?,0,NULL)",
      [cleanTitle, cleanDescription || null, String(image || "").trim() || null]
    );

    await upsertEventTranslation(result.insertId, "th", cleanTitle, cleanDescription);

    return res.json({ message: "Created (pending approval)", id: result.insertId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const updateEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const { id } = req.params;
    const { title, description, image } = req.body || {};
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();

    if (!cleanTitle) {
      return res.status(400).json({ error: "title is required" });
    }

    const [result] = await pool.query(
      `UPDATE events
       SET title=?, description=?, image=?, is_approved=0, approved_at=NULL
       WHERE id=?`,
      [cleanTitle, cleanDescription || null, String(image || "").trim() || null, Number(id)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    await upsertEventTranslation(Number(id), "th", cleanTitle, cleanDescription);

    return res.json({ message: "Updated (pending approval)" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const approveEvent = async (req, res) => {
  const logs = [];
  try {
    await ensureEventsTable();

    const { id } = req.params;
    const eventId = Number(id);
    logs.push(`start approve event_id=${id}`);

    const [rows] = await pool.query(
      `SELECT title, description FROM event_translations WHERE event_id=? AND lang='th' LIMIT 1`,
      [eventId]
    );
    logs.push(`loaded thai source rows=${rows.length}`);

    if (!rows.length) {
      logs.push("thai source not found");
      return res.status(404).json({ error: "Event not found", logs });
    }

    const source = rows[0];
    let translations = null;
    try {
      translations = await buildEventTranslations(source.title || "", source.description || "");
      logs.push("ai translation completed for en/zh/lo");
    } catch (err) {
      logs.push(`ai translation failed -> fallback thai (${err?.message || "unknown"})`);
      translations = {
        th: { title: source.title || "", description: source.description || "" },
        en: { title: source.title || "", description: source.description || "" },
        zh: { title: source.title || "", description: source.description || "" },
        lo: { title: source.title || "", description: source.description || "" },
      };
    }

    for (const lang of ["en", "zh", "lo"]) {
      const t =
        translations?.[lang] ||
        translations?.th || {
          title: source.title || "",
          description: source.description || "",
        };
      await upsertEventTranslation(eventId, lang, t.title || source.title || "", t.description || source.description || "");
      logs.push(`[${lang}] upsert translation`);
    }

    const [result] = await pool.query(
      "UPDATE events SET is_approved=1, approved_at=CURRENT_TIMESTAMP WHERE id=?",
      [eventId]
    );

    if (!result.affectedRows) {
      logs.push("event row not found on approve update");
      return res.status(404).json({ error: "Event not found", logs });
    }

    logs.push("approved flag set");
    return res.json({ message: "Approved", logs });
  } catch (err) {
    logs.push(`fatal: ${err.message}`);
    return res.status(500).json({ error: err.message, logs });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const { id } = req.params;
    await pool.query("DELETE FROM event_translations WHERE event_id=?", [Number(id)]);
    const [result] = await pool.query("DELETE FROM events WHERE id=?", [Number(id)]);

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json({ message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};








