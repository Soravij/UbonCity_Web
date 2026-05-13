import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildFieldPackPrompt,
  buildVisualPrompt,
  extractResponseText,
  normalizeFieldPack,
  normalizeVisualContext,
  parseJsonLike,
} from "../services/agent-generation.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function toText(value) {
  return String(value || "").trim();
}

async function readJsonBody(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`request body too large: ${total} bytes`);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(res, status, payload) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function appendJsonl(logFile, payload) {
  if (!logFile) return;
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, `${JSON.stringify(payload)}\n`, "utf8");
}

function summarizeRequest(body = {}) {
  const context = body.structured_context || {};
  const item = context.item || body.prompt_input?.item || {};
  return {
    task: toText(body.task),
    schema_version: toText(body.schema_version),
    content_item_id: Number(body.content_item_id || 0) || null,
    title: toText(item.title),
    category: toText(item.category),
    approved_context_count: Array.isArray(context.approved_context) ? context.approved_context.length : 0,
    evidence_blocks_count: Array.isArray(context.evidence_blocks) ? context.evidence_blocks.length : 0,
    selected_image_count: Number(context.image_context?.selected_count || 0) || 0,
    received_image_inputs: Array.isArray(body.images) ? body.images.length : 0,
    has_visual_context: Boolean(body.visual_context?.visual_summary),
  };
}

function buildAgentItem(body = {}) {
  const context = body.structured_context && typeof body.structured_context === "object" ? body.structured_context : {};
  const inputItem = body.prompt_input?.item || context.item || {};
  return {
    id: Number(body.content_item_id || context.content_item_id || inputItem.id || 0) || null,
    title: toText(inputItem.title || context.item?.title),
    type: toText(inputItem.type || context.item?.type),
    category: toText(inputItem.category || context.item?.category),
    lang: toText(inputItem.lang || context.item?.lang || "th") || "th",
    slug: toText(inputItem.slug || context.item?.slug),
    structured_context: context,
    visual_context: body.visual_context || null,
  };
}

function hasVisualContext(value) {
  const normalized = normalizeVisualContext(value);
  return Boolean(
    normalized.visual_summary
    || normalized.setting_cues.length
    || normalized.atmosphere_cues.length
    || normalized.style_cues.length
    || normalized.standout_visual_elements.length
    || normalized.confidence_note
  );
}

function resolveOpenAiConfig() {
  const apiKey = String(process.env.EXTERNAL_AGENT_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(process.env.EXTERNAL_AGENT_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const model = String(process.env.EXTERNAL_AGENT_OPENAI_MODEL || process.env.AI_MODEL || "gpt-5-mini").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or EXTERNAL_AGENT_OPENAI_API_KEY is missing");
  }
  return { apiKey, baseUrl, model };
}

async function fetchOpenAiResponses(payload, traceMeta = {}) {
  const config = resolveOpenAiConfig();
  const timeoutMs = Number(process.env.EXTERNAL_AGENT_OPENAI_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 90000) || 90000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`openai timeout after ${timeoutMs}ms`)), timeoutMs);
  const url = `${config.baseUrl}/chat/completions`;
  const startedAt = Date.now();
  console.error(`[real-external-agent] request.start ${JSON.stringify({ ...traceMeta, model: config.model, timeout_ms: timeoutMs })}`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        ...payload,
      }),
      signal: controller.signal,
    });
    console.error(`[real-external-agent] request.response ${JSON.stringify({ ...traceMeta, status: response.status, duration_ms: Date.now() - startedAt })}`);
    return response;
  } catch (err) {
    console.error(`[real-external-agent] request.error ${JSON.stringify({ ...traceMeta, duration_ms: Date.now() - startedAt, error: String(err?.message || err) })}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateVisualContext(body) {
  const item = buildAgentItem(body);
  const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return null;
  const response = await fetchOpenAiResponses({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: buildVisualPrompt(item, images.length) },
        ...images,
      ],
    }],
  }, {
    task: "generate_visual_context",
    content_item_id: item.id,
    image_count: images.length,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI visual-context error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const parsed = normalizeVisualContext(parseJsonLike(extractResponseText(data)));
  return hasVisualContext(parsed) ? parsed : null;
}

async function generateFieldPack(body) {
  const item = buildAgentItem(body);
  const response = await fetchOpenAiResponses({
    messages: [{ role: "user", content: buildFieldPackPrompt(item) }],
  }, {
    task: "generate_field_pack",
    content_item_id: item.id,
    title: item.title || null,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI field-pack error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const parsed = normalizeFieldPack(parseJsonLike(extractResponseText(data)));
  if (!parsed) {
    throw new Error("OpenAI field-pack response is not valid JSON");
  }
  return parsed;
}

const port = Number(readCliOption("--port") || process.env.REAL_EXTERNAL_AGENT_PORT || process.env.EXTERNAL_AGENT_PORT || 7001) || 7001;
const host = String(readCliOption("--host") || process.env.REAL_EXTERNAL_AGENT_HOST || process.env.EXTERNAL_AGENT_HOST || "127.0.0.1").trim() || "127.0.0.1";
const logFile = String(readCliOption("--log-file") || process.env.REAL_EXTERNAL_AGENT_LOG_FILE || process.env.EXTERNAL_AGENT_LOG_FILE || "").trim();

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    writeJson(res, 404, { error: "not found", expected: "POST /run" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const summary = summarizeRequest(body);
    console.error(`[real-external-agent] request ${JSON.stringify(summary)}`);
    await appendJsonl(logFile, {
      received_at: new Date().toISOString(),
      summary,
    });

    if (summary.task === "generate_visual_context") {
      const visualContext = await generateVisualContext(body);
      writeJson(res, 200, { visual_context: visualContext, debug: summary });
      return;
    }

    if (summary.task === "generate_field_pack") {
      const fieldPack = await generateFieldPack(body);
      writeJson(res, 200, { field_pack: fieldPack, debug: summary });
      return;
    }

    writeJson(res, 400, { error: "unsupported task", debug: summary });
  } catch (err) {
    writeJson(res, 500, { error: String(err?.message || err || "real external agent failed") });
  }
});

server.listen(port, host, () => {
  console.log(`real-external-agent: listening on http://${host}:${port}/run`);
  if (logFile) console.log(`real-external-agent: jsonl log ${logFile}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
