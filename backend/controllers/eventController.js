import pool from "../config/db.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";
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

  ensuredEventsTable = true;
}

export const getEvents = async (req, res) => {
  try {
    await ensureEventsTable();

    const includeUnapproved =
      String(req.query?.include_unapproved || "") === "1" && isAuthenticatedRequest(req);

    const [rows] = await pool.query(
      `SELECT id, title, description, image, is_approved, approved_at, created_at, updated_at
       FROM events
       ${includeUnapproved ? "" : "WHERE is_approved=1"}
       ORDER BY COALESCE(approved_at, updated_at) DESC, id DESC`
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

    const [rows] = await pool.query(
      `SELECT id, title, description, image, is_approved, approved_at, created_at, updated_at
       FROM events
       WHERE id=? ${includeUnapproved ? "" : "AND is_approved=1"}
       LIMIT 1`,
      [Number(id)]
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

    if (!cleanTitle) {
      return res.status(400).json({ error: "title is required" });
    }

    const [result] = await pool.query(
      "INSERT INTO events (title,description,image,is_approved,approved_at) VALUES (?,?,?,0,NULL)",
      [cleanTitle, String(description || "").trim() || null, String(image || "").trim() || null]
    );

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

    if (!cleanTitle) {
      return res.status(400).json({ error: "title is required" });
    }

    const [result] = await pool.query(
      `UPDATE events
       SET title=?, description=?, image=?, is_approved=0, approved_at=NULL
       WHERE id=?`,
      [cleanTitle, String(description || "").trim() || null, String(image || "").trim() || null, Number(id)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json({ message: "Updated (pending approval)" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const approveEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const { id } = req.params;
    const [result] = await pool.query(
      "UPDATE events SET is_approved=1, approved_at=CURRENT_TIMESTAMP WHERE id=?",
      [Number(id)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json({ message: "Approved" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM events WHERE id=?", [Number(id)]);

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json({ message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
