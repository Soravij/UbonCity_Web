import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function toText(value) {
  return String(value || "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
}

async function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
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

function firstApprovedTexts(context, limit = 4) {
  const blocks = Array.isArray(context?.approved_context) ? context.approved_context : [];
  const out = [];
  for (const block of blocks) {
    const text = toText(block?.selected_text);
    if (text) out.push(text);
    const list = toArray(block?.selected_list);
    for (const item of list) out.push(item);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

function buildVisualContext(body) {
  const item = body.structured_context?.item || body.prompt_input?.item || {};
  return {
    visual_summary: `${toText(item.title) || "สถานที่นี้"} มีภาพที่เลือกไว้สำหรับช่วยอ่านบรรยากาศ`,
    setting_cues: ["ภาพจาก clean selection"],
    atmosphere_cues: ["ใช้เป็นบริบทเสริมเท่านั้น"],
    style_cues: [],
    standout_visual_elements: [],
    confidence_note: "mock external agent: ใช้สำหรับทดสอบ integration ไม่ใช่ผลวิเคราะห์ภาพจริง",
  };
}

function buildFieldPack(body) {
  const context = body.structured_context || {};
  const item = context.item || body.prompt_input?.item || {};
  const title = toText(item.title) || `Item ${Number(body.content_item_id || 0) || ""}`.trim();
  const approvedTexts = firstApprovedTexts(context);
  const visualSummary = toText(body.visual_context?.visual_summary);

  return {
    status: "ready_for_field",
    ai_summary: `${title} - mock external agent field pack`,
    ai_highlights: approvedTexts.slice(0, 3),
    ai_unknowns: ["ยืนยันข้อมูลล่าสุดก่อนใช้งานจริง"],
    editor_summary: "",
    verified_facts: approvedTexts.slice(0, 3),
    uncertain_facts: ["รายละเอียดหน้างานที่ต้องตรวจซ้ำ"],
    story_angle: `จัดชุดลงพื้นที่สำหรับ ${title}`,
    field_notes: visualSummary ? `ใช้ภาพประกอบเป็นบริบทเสริม: ${visualSummary}` : "mock external agent field notes",
    social_hook: `เช็ก ${title} จากหน้างานจริง`,
    social_caption_angle: "เล่าแบบสั้น ใช้ข้อเท็จจริงที่ยืนยันแล้ว",
    social_shot_emphasis: ["ภาพป้ายหรือจุดตั้งต้น", "ภาพบรรยากาศรวม", "ภาพรายละเอียดสำคัญ"],
    social_on_camera_points: ["จุดเด่นที่ยืนยันจาก clean context", "ข้อควรรู้ก่อนเดินทาง"],
    checklists: {
      must_verify_fact: ["ยืนยันเวลาเปิดและข้อจำกัดล่าสุด", "ยืนยันตำแหน่งและทางเข้าใช้งานจริง"],
      must_capture_shot: ["ถ่ายป้ายหรือจุดระบุตัวสถานที่", "ถ่ายภาพกว้างให้เห็นบริบทพื้นที่"],
      must_ask_question: ["มีข้อจำกัดหรือช่วงเวลาที่ควรหลีกเลี่ยงไหม", "ข้อมูลใดจากต้นทางที่เปลี่ยนไปแล้วหรือไม่"],
    },
    field_pack_references: [],
    field_pack_media_hints: [],
  };
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

const port = Number(readCliOption("--port") || process.env.MOCK_EXTERNAL_AGENT_PORT || 7001) || 7001;
const host = String(readCliOption("--host") || process.env.MOCK_EXTERNAL_AGENT_HOST || "127.0.0.1").trim() || "127.0.0.1";
const logFile = String(readCliOption("--log-file") || process.env.MOCK_EXTERNAL_AGENT_LOG_FILE || "").trim();

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    writeJson(res, 404, { error: "not found", expected: "POST /run" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const summary = summarizeRequest(body);
    console.error(`[mock-external-agent] ${JSON.stringify(summary)}`);
    await appendJsonl(logFile, {
      received_at: new Date().toISOString(),
      summary,
      request: body,
    });

    if (summary.task === "generate_visual_context") {
      writeJson(res, 200, { visual_context: buildVisualContext(body), debug: summary });
      return;
    }

    if (summary.task === "generate_field_pack" || summary.task === "revise_field_pack") {
      writeJson(res, 200, { field_pack: buildFieldPack(body), debug: summary });
      return;
    }

    writeJson(res, 400, { error: "unsupported task", debug: summary });
  } catch (err) {
    writeJson(res, 500, { error: String(err?.message || err || "mock external agent failed") });
  }
});

server.listen(port, host, () => {
  console.log(`mock-external-agent: listening on http://${host}:${port}/run`);
  if (logFile) console.log(`mock-external-agent: jsonl log ${logFile}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
