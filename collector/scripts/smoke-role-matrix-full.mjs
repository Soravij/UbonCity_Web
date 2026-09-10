import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "role-matrix-full-smoke-secret";
const reviewSyncToken = "smoke-test-review-sync-token";
const TEST_PREFIX = "__test-rm2-";

const results = [];
let passCount = 0;
let failCount = 0;

function record(name, pass, detail = "") {
  if (pass) { passCount++; results.push({ name, status: "PASS", detail }); }
  else { failCount++; results.push({ name, status: "FAIL", detail }); }
  console.error(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = Number(probe.address()?.port || 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForCollector(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode != null) throw new Error(`collector exited early with ${child.exitCode}`);
    try { const r = await fetch(`${baseUrl}/api/health`); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("collector server did not become ready");
}

function makeToken(userId, email, role, managedByUserId) {
  const payload = { id: userId, email, display_name: `Test ${role}`, role };
  if (managedByUserId != null) {
    payload.managed_by_user_id = managedByUserId;
  }
  return jwt.sign(payload, authSecret, { issuer: "uboncity-backend", audience: "uboncity-collector" });
}

async function withServer(dbPath, run) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = null;
  try {
    child = spawn(process.execPath, [serverPath], {
      cwd: collectorRoot,
      env: { ...process.env, COLLECTOR_ROOT: collectorRoot, DB_PATH: dbPath, PORT: String(port), BACKEND_JWT_SECRET: authSecret, COLLECTOR_REVIEW_SYNC_TOKEN: reviewSyncToken, COLLECTOR_SYNC_BACKEND_API: "http://127.0.0.1:5000/api", COLLECTOR_PUBLIC_BASE_URL: `http://127.0.0.1:${port}` },
      stdio: "ignore",
    });
    await waitForCollector(baseUrl, child);
    await run(baseUrl, port);
  } finally {
    if (child && child.exitCode == null) { child.kill(); await once(child, "exit"); }
  }
}

async function api(baseUrl, method, pathStr, token, body) {
  const opts = { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${baseUrl}${pathStr}`, opts);
}

async function apiMultipart(baseUrl, pathStr, token, formData) {
  return fetch(`${baseUrl}${pathStr}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
  });
}

async function getProdState(baseUrl, itemId, token) {
  const res = await api(baseUrl, "GET", `/api/items/${itemId}/workflow-model`, token);
  if (!res.ok) return null;
  const data = await res.json();
  return data.model?.production_state;
}

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-full-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdUserIds = [];
  const createdItemIds = [];
  const createdAssetIds = [];
  const createdAssignmentIds = [];

  const createUser = (suffix, role, managerUserId) => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`.toLowerCase();
    const result = db.prepare(
      `INSERT INTO users (email, display_name, password_hash, role, managed_by_user_id) VALUES (?, ?, '', ?, ?)`
    ).run(email, `Test ${suffix}`, role, managerUserId);
    const id = Number(result.lastInsertRowid || 0);
    db.prepare(`UPDATE users SET profile_json=? WHERE id=?`)
      .run(JSON.stringify({ _auth_sync: { user_id: id, provider: "backend", directory_active: true } }), id);
    createdUserIds.push(id);
    return { id, email };
  };

  const owner = createUser("owner", "owner", null);
  const adminA = createUser("adminA", "admin", owner.id);
  const adminB = createUser("adminB", "admin", owner.id);
  const managerA1 = createUser("mgrA1", "user", adminA.id);
  const managerA2 = createUser("mgrA2", "user", adminA.id);
  const managerB1 = createUser("mgrB1", "user", adminB.id);
  const managerB2 = createUser("mgrB2", "user", adminB.id);
  const editorA1 = createUser("edA1", "editor", managerA1.id);
  const freelanceA1 = createUser("flA1", "freelance", managerA1.id);
  const editorA2 = createUser("edA2", "editor", managerA2.id);
  const freelanceA2 = createUser("flA2", "freelance", managerA2.id);
  const editorB1 = createUser("edB1", "editor", managerB1.id);
  const freelanceB1 = createUser("flB1", "freelance", managerB1.id);
  const editorB2 = createUser("edB2", "editor", managerB2.id);
  const freelanceB2 = createUser("flB2", "freelance", managerB2.id);

  const tokens = {
    owner: makeToken(owner.id, owner.email, "owner", null),
    adminA: makeToken(adminA.id, adminA.email, "admin", owner.id),
    adminB: makeToken(adminB.id, adminB.email, "admin", owner.id),
    managerA1: makeToken(managerA1.id, managerA1.email, "user", adminA.id),
    managerA2: makeToken(managerA2.id, managerA2.email, "user", adminA.id),
    managerB1: makeToken(managerB1.id, managerB1.email, "user", adminB.id),
    managerB2: makeToken(managerB2.id, managerB2.email, "user", adminB.id),
    editorA1: makeToken(editorA1.id, editorA1.email, "editor", managerA1.id),
    freelanceA1: makeToken(freelanceA1.id, freelanceA1.email, "freelance", managerA1.id),
    editorA2: makeToken(editorA2.id, editorA2.email, "editor", managerA2.id),
    freelanceA2: makeToken(freelanceA2.id, freelanceA2.email, "freelance", managerA2.id),
    editorB1: makeToken(editorB1.id, editorB1.email, "editor", managerB1.id),
    freelanceB1: makeToken(freelanceB1.id, freelanceB1.email, "freelance", managerB1.id),
    editorB2: makeToken(editorB2.id, editorB2.email, "editor", managerB2.id),
    freelanceB2: makeToken(freelanceB2.id, freelanceB2.email, "freelance", managerB2.id),
  };

  const createItem = (title, type, claimedByUserId, prodState, category) => {
    const result = repo.createItemWithWorkflowHead({
      type: type || "place",
      category: category || "cafes",
      title,
      description_raw: title,
      source_type: "manual",
      source_name: "smoke-test",
    });
    const item = repo.getItem(result.item.id);
    createdItemIds.push(item.id);
    if (claimedByUserId) {
      db.prepare("UPDATE content_items SET claimed_by_user_id=?, claimed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(claimedByUserId, item.id);
    }
    if (prodState) {
      db.prepare("UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?")
        .run(prodState, item.id);
    }
    return item;
  };

  const createFieldPack = (itemId) => {
    const fpResult = db.prepare(`
      INSERT INTO field_packs (content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by)
      VALUES (?, 'ready_for_field', 1, 'smoke', '[]', '[]', '[]', '[]', '[]', '[]', 'smoke')
    `).run(itemId);
    const fpId = Number(fpResult.lastInsertRowid || 0);
    db.prepare(`UPDATE content_workflow_models SET current_field_pack_id=? WHERE content_item_id=?`).run(fpId, itemId);
    return fpId;
  };

  const createDraft = (itemId, title, body) => {
    const uid = `${TEST_PREFIX}draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, status) VALUES (?, ?, ?, ?, 'generated')`)
      .run(itemId, uid, title || "Smoke Draft", body || "smoke body");
  };

  const createAssignmentWorkAsset = (assignmentId, contentItemId) => {
    const assetUid = `${TEST_PREFIX}work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const assetResult = db.prepare(`INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type) VALUES (?, 'local', 'test/path', 'shot_01.jpg', 'image/jpeg')`)
      .run(assetUid);
    const assetId = Number(assetResult.lastInsertRowid || 0);
    createdAssetIds.push(assetId);
    db.prepare(`INSERT INTO content_assets (content_item_id, asset_id, assignment_id, assignment_surface, assignment_media_type, assignment_round, role, selected_in_clean) VALUES (?, ?, ?, 'assignment_work', 'image', 1, 'gallery', 1)`)
      .run(contentItemId, assetId, assignmentId);
    return assetId;
  };

  const itemA = createItem("คาเฟ่สวนกลางเมือง", "place", null, "collected");
  db.prepare("UPDATE content_items SET latitude=?, longitude=?, meta_title=?, meta_description=?, slug=?, summary=? WHERE id=?")
    .run(15.2448, 104.8473,
      "คาเฟ่สวนกลางเมือง ร้านกาแฟบรรยากาศดี",
      "คาเฟ่สวนกลางเมือง ร้านกาแฟบรรยากาศร่มรื่น มีสวนเล็กๆ ให้นั่งพักผ่อน เมล็ดกาแฟคั่วสดใหม่ ขนมปังโฮมเมนด์ วิวสวนสวยงาม",
      "cafe-suan-klang-mueang",
      "คาเฟ่สวนกลางเมืองเป็นร้านกาแฟเล็กๆ บรรยากาศร่มรื่น มีสวนเล็กๆ รอบร้าน ให้บริการกาแฟคั่วสดใหม่ ขนมปังโฮมเมนด์ และอาหารว่างไทย-ฝรั่ง เหมาะสำหรับนั่งพักผ่อนในวันหยุดสุดสัปดาห์",
      itemA.id);

  const imgAssetUid = `${TEST_PREFIX}img-${Date.now()}`;
  const coverDir = path.join(tempDir, "uploads", "img");
  fs.mkdirSync(coverDir, { recursive: true });
  const coverFilePath = path.join(coverDir, "cover.jpg");
  fs.writeFileSync(coverFilePath, Buffer.alloc(1024, 0xFF));
  const coverStoragePath = path.relative(collectorRoot, coverFilePath).replace(/\\/g, "/");
  const imgAssetResult = db.prepare(`INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes) VALUES (?, 'local', ?, 'cover.jpg', 'image/jpeg', 1024)`)
    .run(imgAssetUid, coverStoragePath);
  const imgAssetId = Number(imgAssetResult.lastInsertRowid || 0);
  createdAssetIds.push(imgAssetId);
  db.prepare(`INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover) VALUES (?, ?, 'cover', 1, 1)`)
    .run(itemA.id, imgAssetId);

  createFieldPack(itemA.id);
  const itemBField = createItem("ร้านก๋วยเตี๋ยวเรืออยุธยา", "place", managerA1.id, "ready_for_content");
  createFieldPack(itemBField.id);
  const itemBEditorial = createItem("ร้านส้มตำป้ามล", "place", managerA1.id, "ready_for_writer");
  createFieldPack(itemBEditorial.id);
  createDraft(itemBEditorial.id, "ร้านส้มตำป้ามล ส้มตำรสเด็ดอุบลราชธานี", "ร้านส้มตำป้ามลเป็นร้านส้มตำชื่อดังในอำเภอเมืองอุบลราชธานี ส้มตำรสจัดจ้าน ลาบเป็ดรสเด็ด บรรยากาศบ้านๆ ราคาเป็นกันเอง");
  const itemChainB = createItem("ร้านกาแฟดอยสุเทพ", "place", managerB1.id, "collected");
  const itemChainA2 = createItem("ร้านเบเกอรี่ครัวคุณยาย", "place", managerA2.id, "collected");
  const itemEditorB1 = createItem("ร้านอาหารไทยเรือนไม้", "place", managerB1.id, "ready_for_writer");
  createFieldPack(itemEditorB1.id);
  const edB1Uid = `${TEST_PREFIX}edB1-${Date.now()}`;
  const edB1Result = db.prepare(`INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_user_id, assignment_kind, state) VALUES (?, ?, ?, 'editorial', 'assigned')`)
    .run(edB1Uid, itemEditorB1.id, editorB1.id);
  createdAssignmentIds.push(Number(edB1Result.lastInsertRowid || 0));
  const itemCross = createItem("ร้านก๋วยเตี๋ยวต้มยำกุ้ง", "place", editorA1.id, "ready_for_content");
  createFieldPack(itemCross.id);

  const users = { owner, adminA, adminB, managerA1, managerA2, managerB1, managerB2, editorA1, freelanceA1, editorA2, freelanceA2, editorB1, freelanceB1, editorB2, freelanceB2 };
  const items = { itemA, itemBField, itemBEditorial, itemChainB, itemChainA2, itemEditorB1, itemCross };

  const cleanup = () => {
    for (const id of createdAssetIds) {
      try { db.prepare("DELETE FROM content_assets WHERE asset_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM assets WHERE id=?").run(id); } catch {}
    }
    for (const id of createdAssignmentIds) {
      try { db.prepare("DELETE FROM content_assignments WHERE id=?").run(id); } catch {}
    }
    for (const id of createdItemIds) {
      try { db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_drafts WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_items WHERE id=?").run(id); } catch {}
    }
    for (const id of createdUserIds) {
      try { db.prepare("DELETE FROM users WHERE id=?").run(id); } catch {}
    }
    try { db.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  };

  return { db, repo, dbPath, tempDir, tokens, users, items, createFieldPack, createDraft, createAssignmentWorkAsset, cleanup };
}

async function testGroupA(baseUrl, ctx) {
  const t = ctx.tokens;
  const itemId = ctx.items.itemA.id;

  async function step(name, method, pathStr, token, body) {
    const res = await api(baseUrl, method, pathStr, token, body);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    const ok = res.ok;
    record(`A: ${name}`, ok, `status=${res.status}${!ok ? ` err=${(json?.error || text || "").slice(0,120)}` : ""}`);
    return { res, json, text };
  }

  async function verify(name, expected) {
    const state = await getProdState(baseUrl, itemId, t.owner);
    record(`A: verify ${name}`, state === expected, `expected=${expected} actual=${state}`);
  }

  // ─── Rung 1: collected → analyzed via POST /api/run/clean ───
  await step("R1 collected→analyzed", "POST", "/api/run/clean", t.adminA, {});
  await verify("analyzed", "analyzed");

  // claim item so ai-draft can process it
  await step("claim item", "POST", `/api/items/${itemId}/claim`, t.owner, {});

  // seed evidence block
  const evRes = await step("seed evidence block", "POST", `/api/items/${itemId}/evidence-blocks`, t.owner, {
    block_type: "fact",
    source_type: "manual",
    text_value: "คาเฟ่สวนกลางเมืองตั้งอยู่ใจกลางเมือง เปิดให้บริการทุกวัน 08:00-17:00 น. เมล็ดกาแฟคั่วสดใหม่",
    status: "active",
  });
  const evBlockId = evRes.json?.block?.id;

  // seed approved context block
  await step("seed approved context", "POST", `/api/items/${itemId}/approved-context`, t.owner, {
    evidence_block_id: evBlockId,
    context_type: "fact",
    selected_text: "คาเฟ่สวนกลางเมืองตั้งอยู่ใจกลางเมือง เปิดให้บริการทุกวัน 08:00-17:00 น.",
    status: "active",
  });

  // ─── Rung 2: analyzed → generated via POST /api/run/ai-draft ───
  const r2 = await step("R2 analyzed→generated", "POST", "/api/run/ai-draft", t.owner, { content_item_id: itemId });
  if (!r2.res.ok) return;
  await verify("generated", "generated");

  // update field pack status to ready_for_field (ai-draft forces it to "draft")
  const fpItemRes = await api(baseUrl, "GET", `/api/items/${itemId}`, t.owner);
  const fpItemData = await fpItemRes.json();
  const fpId = fpItemData?.current_field_pack_id;
  if (fpId) {
    await step("update field pack→ready_for_field", "PUT", `/api/field-packs/${fpId}`, t.owner, { status: "ready_for_field" });
  }

  // ─── Rung 3: generated → ready_for_content via POST /api/items/:id/place-ready-for-content ───
  const r3 = await step("R3 generated→ready_for_content", "POST", `/api/items/${itemId}/place-ready-for-content`, t.owner, {});
  if (!r3.res.ok) return;
  await verify("ready_for_content", "ready_for_content");

  // ─── Rung 4: ready_for_content → field_working via POST /api/items/:id/assignments ───
  const r4 = await step("R4 field assign", "POST", `/api/items/${itemId}/assignments`, t.owner, {
    assignee_user_id: ctx.users.freelanceA1.id, assignment_kind: "field",
  });
  if (!r4.res.ok) return;
  const fieldAssignId = r4.json?.assignment?.id;

  // ─── Rung 5: field_working → field_review via POST /api/assignments/:id/submissions ───
  // 5a: set assignment to in_progress
  const r5a = await step("R5a in_progress", "PATCH", `/api/assignments/${fieldAssignId}/state`, t.adminA, { state: "in_progress" });
  if (!r5a.res.ok) return;

  // 5b: curate field pack to have exactly 1 must_capture (photo)
  const fpRes = await api(baseUrl, "GET", `/api/items/${itemId}`, t.owner);
  const fpData = await fpRes.json();
  const fieldPackId = fpData?.current_field_pack_id;
  const capturePrompt = "exterior";
  const r5b = await step("R5b curate field pack", "PUT", `/api/field-packs/${fieldPackId}`, t.adminA, {
    field_pack_checklists: [
      { checklist_type: "must_capture", item_text: capturePrompt, capture_type: "photo", item_order: 0, status: "todo" },
    ],
  });
  if (!r5b.res.ok) return;

  // 5c: upload asset — filename must match slot key = shot-1-exterior
  const slotKey = `shot-1-${capturePrompt}`;
  const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const formData = new FormData();
  formData.append("file", new Blob([png1x1], { type: "image/png" }), `${slotKey}.png`);
  formData.append("sync_batch_id", `smoke-${Date.now()}`);
  const r5c = await apiMultipart(baseUrl, `/api/assignments/${fieldAssignId}/assets/upload`, t.freelanceA1, formData);
  const r5cText = await r5c.text().catch(() => "");
  record("R5c upload asset", r5c.ok, `status=${r5c.status}${!r5c.ok ? ` err=${r5cText.slice(0,120)}` : ""}`);
  if (!r5c.ok) return;

  // 5d: submit — this should auto-transition field_working → field_review
  const r5d = await step("R5d submit→field_review", "POST", `/api/assignments/${fieldAssignId}/submissions`, t.freelanceA1, {
    action: "submit",
    article_payload_json: { additional_text: "smoke test field submission" },
  });
  if (!r5d.res.ok) return;
  await verify("field_review", "field_review");

  // ─── Rung 6: field_review → ready_for_writer via PATCH accept_submission ───
  const r6 = await step("R6 accept→ready_for_writer", "PATCH", `/api/assignments/${fieldAssignId}/state`, t.adminA, { action: "accept_submission" });
  if (!r6.res.ok) return;
  await verify("ready_for_writer", "ready_for_writer");

  // ─── Rung 7: ready_for_writer → writing_assigned via POST article-editorial-assignments ───
  const r7 = await step("R7 editorial assign→writing_assigned", "POST", `/api/items/${itemId}/article-editorial-assignments`, t.adminA, {
    assignee_user_id: ctx.users.editorA1.id,
  });
  if (!r7.res.ok) return;
  const edAssignId = r7.json?.assignment?.id;
  await verify("writing_assigned", "writing_assigned");

  // ─── Rung 8: writing_assigned → writing via POST article-process/transition drafting ───
  const r8 = await step("R8 drafting→writing", "POST", `/api/items/${itemId}/article-process/transition`, t.editorA1, { status: "drafting" });
  if (!r8.res.ok) return;
  await verify("writing", "writing");

  // save draft (needed for submit-review)
  await step("save draft", "PUT", `/api/items/${itemId}/editor-work`, t.editorA1, {
    draft: {
      body: "คาเฟ่สวนกลางเมืองเป็นร้านกาแฟเล็กๆ ที่ซ่อนตัวอยู่ใจกลางเมือง บรรยากาศอบอุ่นเป็นกันเอง มีสวนเล็กๆ รอบร้าน เหมาะสำหรับนั่งพักผ่อน เมล็ดกาแฟคั่วสดใหม่ รสชาติเข้มข้นกลมกล่อม ขนมปังโฮมเมนด์อบใหม่ทุกเช้า อาหารว่างไทย-ฝรั่งรสชาติดี ร้านเปิดให้บริการทุกวัน 08:00-17:00 น. มีที่จอดรถสะดวกสบาย".repeat(3),
      draft_title: "คาเฟ่สวนกลางเมือง ร้านกาแฟบรรยากาศดี",
      excerpt: "คาเฟ่สวนกลางเมืองเป็นร้านกาแฟบรรยากาศร่มรื่น มีสวนเล็กๆ ให้นั่งพักผ่อน เมล็ดกาแฟคั่วสดใหม่ ขนมปังโฮมเมนด์ เหมาะสำหรับวันหยุดสุดสัปดาห์",
    },
  });

  // ─── Rung 9: writing → in_review via POST article-process/submit-review ───
  const r9 = await step("R9 submit-review→in_review", "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
  if (!r9.res.ok) return;
  await verify("in_review", "in_review");

  // ─── Rung 10: in_review → ready_for_publish via POST review/action approve ───
  // accept editorial assignment first (required for publishable source)
  await step("accept editorial assignment", "PATCH", `/api/assignments/${edAssignId}/state`, t.owner, { action: "accept_submission" });
  // run quality stage first to create review report
  await step("run quality stage", "POST", "/api/run/quality", t.owner, {});
  const r10 = await step("R10 approve→ready_for_publish", "POST", "/api/review/action", t.owner, {
    content_item_id: itemId, action: "approve", notes: "smoke test approve",
  });
  if (!r10.res.ok) return;
  await verify("ready_for_publish", "ready_for_publish");

  // ─── Translation gate: generate + recheck before R11 ───
  const rTgen = await step("T1 generate-translations", "POST", `/api/items/${itemId}/generate-translations`, t.owner, {});
  if (!rTgen.res.ok) return;
  const tgenJson = rTgen.json;
  if (Number(tgenJson?.failed_count || 0) > 0) {
    const detail = JSON.stringify({
      failed_count: tgenJson?.failed_count,
      per_language_status: tgenJson?.per_language_status,
      result: tgenJson?.result,
    });
    record("T1 generate-translations check", false, detail);
    return;
  }

  for (const lang of ["en", "zh", "lo"]) {
    const rT = await step(`T2 recheck ${lang}`, "POST", `/api/items/${itemId}/translations/${lang}/recheck`, t.owner, {});
    if (!rT.res.ok) return;
    const trObj = rT.json?.translations?.find?.((tr) => tr.lang === lang);
    const recheckStatus = trObj?.translation_recheck_status;
    if (recheckStatus !== "passed" && recheckStatus !== "warning") {
      record(`T2 recheck ${lang} verify`, false, JSON.stringify({
        recheck_status: recheckStatus,
        lang,
        translation: trObj,
      }));
      return;
    }
    record(`T2 recheck ${lang} verify`, true, `recheck_status=${recheckStatus}`);
  }

  // ─── Rung 11: ready_for_publish → submitted_for_admin_review via POST submit-admin-review ───
  const r11 = await step("R11 submit-admin-review", "POST", `/api/items/${itemId}/submit-admin-review`, t.adminA, {});
  if (!r11.res.ok) return;
  await verify("submitted_for_admin_review", "submitted_for_admin_review");

  // ─── Rung 12: submitted_for_admin_review → completed via POST web-review-feedback ───
  const r12Res = await fetch(`${baseUrl}/api/web-review-feedback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-review-sync-token": reviewSyncToken,
    },
    body: JSON.stringify({
      source_system: "collector-app",
      content_type: "place",
      source_content_item_id: itemId,
      status: "published",
      review_note: "smoke test published",
      reviewed_at: new Date().toISOString(),
    }),
  });
  const r12Text = await r12Res.text().catch(() => "");
  let r12Json = null;
  try { r12Json = r12Text ? JSON.parse(r12Text) : null; } catch {}
  record("R12 web-review-feedback→completed", r12Res.ok, `status=${r12Res.status}${!r12Res.ok ? ` err=${(r12Json?.error || r12Text).slice(0,120)}` : ""}`);
  if (!r12Res.ok) return;
  await verify("completed", "completed");
}

async function testGroupB(baseUrl, ctx) {
  const t = ctx.tokens;

  async function testB1Field() {
    const itemId = ctx.items.itemBField.id;

    const res = await api(baseUrl, "POST", `/api/items/${itemId}/assignments`, t.adminA, {
      assignee_user_id: ctx.users.freelanceA1.id, assignment_kind: "field",
    });
    record("B1: field assign", res.ok, `status=${res.status}`);
    const assignId = res.ok ? (await res.json()).assignment?.id : null;

    let r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { state: "in_progress" });
    record("B1: in_progress", r.ok, `status=${r.status}`);

    ctx.createAssignmentWorkAsset(assignId, itemId);

    r = await api(baseUrl, "POST", `/api/assignments/${assignId}/submissions`, t.freelanceA1, { action: "submit", article_payload_json: { additional_text: "smoke B1 submit" } });
    record("B1: submit", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "request_revision" });
    record("B1: request_revision", r.ok, `status=${r.status}`);

    ctx.createAssignmentWorkAsset(assignId, itemId);

    r = await api(baseUrl, "POST", `/api/assignments/${assignId}/submissions`, t.freelanceA1, { action: "resubmit", article_payload_json: { additional_text: "smoke B1 resubmit" } });
    record("B1: resubmit", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "accept_submission" });
    record("B1: accept", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.owner, { action: "close_assignment" });
    record("B1: close", r.ok, `status=${r.status}`);

    const finalRes = await api(baseUrl, "GET", `/api/assignments/${assignId}`, t.owner);
    const finalData = finalRes.ok ? await finalRes.json() : null;
    record("B1: verify closed", finalData?.assignment?.state === "closed", `state=${finalData?.assignment?.state}`);
  }

  async function testB2Editorial() {
    const itemId = ctx.items.itemBEditorial.id;

    const res = await api(baseUrl, "POST", `/api/items/${itemId}/article-editorial-assignments`, t.adminA, {
      assignee_user_id: ctx.users.editorA1.id,
    });
    record("B2: editorial assign", res.ok, `status=${res.status}`);
    const assignId = res.ok ? (await res.json()).assignment?.id : null;

    let r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { state: "in_progress" });
    record("B2: in_progress", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
    record("B2: submit-review", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-editorial-assignments/${assignId}/request-revision`, t.adminA, {});
    record("B2: request_revision", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
    record("B2: resubmit-review", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "accept_submission" });
    record("B2: accept", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.owner, { action: "close_assignment" });
    record("B2: close", r.ok, `status=${r.status}`);

    const finalRes = await api(baseUrl, "GET", `/api/assignments/${assignId}`, t.owner);
    const finalData = finalRes.ok ? await finalRes.json() : null;
    record("B2: verify closed", finalData?.assignment?.state === "closed", `state=${finalData?.assignment?.state}`);
  }

  await testB1Field();
  await testB2Editorial();
}

async function testGroupC(baseUrl, ctx) {
  const t = ctx.tokens;

  let r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemChainB.id}`, t.adminA);
  record("C: adminA→chainB item 403", r.status === 403, `status=${r.status}`);

  r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemChainA2.id}`, t.managerA1);
  record("C: managerA1→managerA2 item 403", r.status === 403, `status=${r.status}`);

  r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemEditorB1.id}`, t.editorA1);
  record("C: editorA1→editorB1 item 403", r.status === 403, `status=${r.status}`);
}

async function testGroupD(baseUrl, ctx) {
  const t = ctx.tokens;
  const itemId = ctx.items.itemCross.id;

  const r = await api(baseUrl, "POST", `/api/items/${itemId}/assignments`, t.managerA1, {
    assignee_user_id: ctx.users.editorB1.id, assignment_kind: "editorial",
  });
  record("D: managerA1→editorB1 cross-chain rejected", r.status === 403, `status=${r.status}`);
}

async function main() {
  const ctx = testContext();
  try {
    await withServer(ctx.dbPath, async (baseUrl) => {
      await testGroupA(baseUrl, ctx);
      await testGroupB(baseUrl, ctx);
      await testGroupC(baseUrl, ctx);
      await testGroupD(baseUrl, ctx);
    });

    console.log(JSON.stringify({
      ok: failCount === 0,
      summary: { pass: passCount, fail: failCount, total: passCount + failCount },
      results,
    }, null, 2));

    if (failCount > 0) process.exitCode = 1;
  } finally {
    ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(`smoke-role-matrix-full: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
