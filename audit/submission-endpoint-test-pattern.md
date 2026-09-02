# Audit: test pattern สำหรับ POST /api/assignments/:id/submissions

โหมด: Discovery / research (read-only) — เครื่อง Runtime `D:\UbonRuntime\repos\UbonCity_Web`
เป้าหมาย: หา pattern เขียนจริงสำหรับ test ที่ยิง HTTP จริงใส่ route นี้ เพื่อคุ้ม fix ของ
branch `fix/submit-gate-active-batch` (ไม่ได้เขียน test เอง — ผลนี้ไปใส่ prompt ให้ implementer)

Pipeline ที่ใช้: `audit-scanner` (Layer 1 triage) → `audit-deep-reasoner` (Layer 2, ไล่เฉพาะ
candidate ที่ `needs_deep_review=true`). Layer 2 เทียบกับ Layer 1 แล้ว**ไม่พบความขัดแย้ง**
— เลขบรรทัดทั้งหมดด้านล่างตรงกับโค้ดจริงที่อ่าน ณ เวลา audit

---

## ⚠️ พบก่อนอื่น: test ที่มีอยู่แล้วบน fix branch ไม่ได้คุ้ม HTTP path

`collector/tests/submit-gate-active-batch.test.mjs` (85 บรรทัด, อยู่บน branch
`fix/submit-gate-active-batch` เท่านั้น) **ไม่ได้ spawn server และไม่ได้ยิง HTTP**:
- อ่าน `repository.mjs` เป็น text แล้ว extract source ของ `countActiveAssignmentWorkAssetsByType`
  ด้วย string manipulation (`extractNamedFunctionSource`, บรรทัด 12-27 ของไฟล์ทดสอบนั้น)
- rebuild ฟังก์ชันด้วย `new Function(...)` (บรรทัด 29-35) แล้วยัด mock statement object
  (`mockStmt.all()`) แทน SQL statement จริง
- เรียกฟังก์ชันที่ rebuild แล้วด้วย row object ที่เขียนมือ (`makeAssetRow`, บรรทัด 38-46) —
  ไม่มี SQLite, ไม่มีตาราง `content_assets` จริง, ไม่มี server process, ไม่มี auth, ไม่มี route

สรุป: มันเทสต์เฉพาะ logic การจัดกลุ่ม batch ล้วนๆ แบบแยกโดด — **path ทั้งหมดของ route จริง
(auth, `hasAssignmentSubmissionAccess`, เงื่อนไข 409 ต้นทาง, การต่อสาย gate เข้ากับฟังก์ชันจริง,
`enforceResetPerShotRequirements`) ยังไม่ถูกทดสอบเลย** — test ใหม่แบบ real-HTTP จึงไม่ซ้ำซ้อน
เป็นทางเดียวที่จะยืนยันว่า gate ต่อสายถูกใน route ที่รันจริง

---

## 1) ไฟล์ต้นแบบที่เลือก

**`collector/tests/backward-autoclose-scope.test.mjs`**

เหตุผล: มี boilerplate เดียวกับ `field-pack-ready-guard-route.test.mjs` ทุกตัวอักษร
(`reservePort`/`waitForCollector`/`ownerToken`/`withServer`) คือ spawn server จริงด้วย
`child_process.spawn` แล้วยิงด้วย `fetch` แต่มันสร้าง fixture assignment ด้วย
`repo.createAssignment()` ตรงๆ (บรรทัด 121-135) ไม่ต้องผ่านกลไก readiness/field-pack ที่หนักกว่า
ของ `field-pack-ready-guard-route.test.mjs` — ใกล้เคียงกับสิ่งที่ fixture assignment-submission
ต้องการมากกว่า

ไฟล์ที่ **ไม่ควร**ใช้เป็นต้นแบบ: `translation-workflow-fallback.test.mjs:364-419` — `http.createServer()`
ตรงนั้น mock upstream AI provider ไม่ใช่ collector server เอง ไม่เคย spawn `server/index.mjs`

---

## 2) ขั้นตอนของไฟล์ต้นแบบ (backward-autoclose-scope.test.mjs)

**(a) ตั้ง DB** — `testContext()` บรรทัด 100-114:
temp dir ด้วย `fs.mkdtempSync(path.join(os.tmpdir(), "backward-autoclose-"))` (บรรทัด 101),
`dbPath = path.join(tempDir, "test.sqlite")` (บรรทัด 102), เปิดด้วย `openDatabase(dbPath, schemaPath)`
(บรรทัด 103) โดย `schemaPath = path.join(collectorRoot, "database", "schema.sql")` (บรรทัด 18)
— `openDatabase` รัน `schema.sql` เต็มไฟล์ผ่าน `db.exec(schemaSql)` (`collector/db/client.mjs:35-53`,
โดยเฉพาะบรรทัด 43)

**(b) spawn server** — `withServer(dbPath, run)` บรรทัด 74-98:
`child_process.spawn(process.execPath, [serverPath], { cwd: collectorRoot, env: {...process.env,
COLLECTOR_ROOT: collectorRoot, DB_PATH: dbPath, PORT: String(port), BACKEND_JWT_SECRET: authSecret},
stdio: "ignore" })` (บรรทัด 79-89), `serverPath = path.join(collectorRoot, "server", "index.mjs")`
(บรรทัด 19) — เป็น subprocess จริง ไม่ใช่ in-process `http.createServer`
หมายเหตุ: `COLLECTOR_ROOT` ที่ส่งไปไม่ได้ถูกอ่านโดย `collector/config/paths.mjs` ตัว `resolvePaths`
ใช้ `process.cwd()` เท่านั้น (`collector/config/paths.mjs:3-9`) ซึ่งถูกต้องอยู่แล้วเพราะ `cwd: collectorRoot`
ใน spawn options — `COLLECTOR_ROOT` แทบไม่มีผลกับ path resolution ตรงนี้ (แต่ script ตัวอื่นที่ spawn
sub-probe ใช้มันเพื่อจุดประสงค์อื่น ดูข้อ 5)

**(c) auth token** — `ownerToken()` บรรทัด 43-49:
`jwt.sign({ id: 901, email: "...@example.test", display_name: "...", role: "owner" }, authSecret,
{ issuer: "uboncity-backend", audience: "uboncity-collector" })` — `authSecret` เป็น string คงที่
(บรรทัด 20) ที่ส่งเป็น `BACKEND_JWT_SECRET` env var ให้ server เพื่อให้ verify ผ่าน
(`server/index.mjs:130`, `backendJwtSecret = String(process.env.BACKEND_JWT_SECRET || process.env.JWT_SECRET || "").trim()`)
`role: "owner"` มีผลจริง — ดูข้อ 4/5 (freelance role มีเงื่อนไข state เพิ่มที่ `11320-11326`)

**(d) ยิง request** — plain `fetch()` เช่นบรรทัด 140-144:
`fetch(\`${baseUrl}/...\`, { method: "POST", headers: { authorization: \`Bearer ${ownerToken()}\`,
"content-type": "application/json" }, body: JSON.stringify({...}) })`

**(e) teardown** — `finally` ใน `withServer` บรรทัด 92-97: `child.kill()` แล้ว
`await once(child, "exit")` ถ้ายังไม่ exit; ที่ระดับ test แต่ละตัว `ctx.cleanup()` (บรรทัด 108-113,
เรียกใน `finally` ของแต่ละ `test(...)`): `db.close()` (ห่อ try/catch) แล้ว
`fs.rmSync(tempDir, { recursive: true, force: true })`
สำคัญ: connection ที่ใช้สร้าง fixture ต้อง `ctx.db.close()` **ก่อน** เรียก `withServer(...)`
(pattern เดียวกันที่ `field-pack-ready-guard-route.test.mjs:187`) — กัน connection ซ้อนกันสอง
ตัวเปิดไฟล์ sqlite เดียวกันพร้อมกัน

---

## 3) สร้าง fixture 3 สถานะ

**สร้าง assignment**: `repo.createAssignment(payload, actorUserId, metadata)` —
`collector/db/repository.mjs:5264-5344`. พารามิเตอร์ที่เกี่ยว: `content_item_id`,
`assignee_user_id`/`assignee_name`/`assignee_contact`, `assignment_kind`
(normalize ผ่าน `normalizeAssignmentKindValue(payload.assignment_kind, "field")`, บรรทัด 5292),
`state` (default `"assigned"`, บรรทัด 5293)

**`revision_round` ไม่มี setter ตรงๆ** — ไม่อยู่ใน insert param list (บรรทัด 5310-5325) default
เป็น `0` ตาม schema (`collector/database/schema.sql:1020`,
`revision_round INTEGER NOT NULL DEFAULT 0`; `resolveAssignmentCurrentRound` ที่
`server/index.mjs:3121-3124` ตีความ `0` เป็นรอบ 1) มันขึ้นทีละ 1 เฉพาะตอน transition ไป
`"revision_requested"` เท่านั้น (`updateAssignmentStateStmt`, `repository.mjs:3835`) ผ่าน
`updateAssignmentStateInternal` (5573-5668) หรือ `requestAssignmentRevisionWithReset` (5717-5778)
— การไล่ state machine จริง 2 รอบเพื่อให้ได้ round=2 หนักเกินความจำเป็นสำหรับ fixture
**วิธีลัดที่มี precedent อยู่แล้วในโปรเจกต์**: raw SQL UPDATE ตรงเข้า temp DB ก่อน spawn server
(ตัวอย่าง precedent: `field-pack-ready-guard-route.test.mjs:102`,
`ctx.db.prepare("UPDATE content_items SET latitude=... WHERE id=?").run(place.id)`) เช่น
`ctx.db.prepare("UPDATE content_assignments SET revision_round=2 WHERE id=?").run(assignmentId)`

**`image_reset_required`**: ตั้งผ่าน `repo.updateAssignmentMediaResetPolicy(assignmentId,
{ image_reset_required, image_reset_reason, ... })` (`repository.mjs:5670-5695`, ใช้
`updateAssignmentMediaResetPolicyStmt` ที่ 3849-3858) ข้อควรระวัง:
`requestAssignmentRevisionWithReset` (5717-5778) ตั้งค่านี้ **และ** ลบ asset ของรอบปัจจุบันด้วย
`deleteAssignmentWorkAssetsByType` (5752-5757) เป็น side effect — ถ้าต้องการคุม asset แยกจาก reset
flag ให้เรียก `updateAssignmentMediaResetPolicy` ตรงๆ แทน

**`content_assets`**: **ไม่มีฟังก์ชันใน `repository.mjs` สำหรับ insert แถว assignment-work asset
เลย** มีแต่ inline SQL ใน route handler สองจุด: chunked-upload finalize
(`server/index.mjs:15057-15098`, insert คอลัมน์ `assignment_id, assignment_round,
assignment_media_type, assignment_surface, assignment_sync_batch_id` — route ที่ 14901) และ
multipart endpoint ที่ง่ายกว่า (route 15169, insert ที่ 15207-15208) ทั้งคู่ต้องมี
`assignment_surface='assignment_work'` และ `sync_batch_id` ไม่เป็น null
วิธีที่ปฏิบัติได้จริง (มี precedent อยู่แล้วในโปรเจกต์สำหรับตารางที่ไม่มี repo wrapper เช่น
`content_readiness_briefs`/`users` ที่ `assignment-accept-confirmed-metadata.repository.test.mjs:54-65`/`45-52`):
**raw `db.prepare("INSERT INTO content_assets (...) VALUES (...)").run(...)`** ให้คอลัมน์ตรงกับที่
`server/index.mjs:15058`/`15208` ใช้จริง บวกแถวคู่กันใน `assets`

**"active batch" คือหัวใจของความต่างระหว่าง gate เก่า/ใหม่**:
- gate เก่า SQL `listAssignmentRoundAssetsByTypeStmt` (`repository.mjs:3859-3879`):
  `ca.assignment_id=? AND ca.assignment_round=? AND ca.assignment_media_type=? AND
  assignment_surface='assignment_work'` — **round ต้องตรงเป๊ะ** ถ้า `revision_round=2` แต่
  asset อยู่ที่ `assignment_round=1` เท่านั้น จะได้ `[]`
- gate ใหม่ (fix branch) `listAssignmentWorkAssetsByAssignmentAndTypeStmt`
  (`repository.mjs:3893-3906`): `ca.assignment_id=? AND ca.content_item_id=? AND
  assignment_surface='assignment_work' AND assignment_media_type=?` — **ไม่กรอง round เลย**
  ดึง asset ทุกรอบมาแล้ว `resolveActiveAssignmentWorkBatchRows` (`repository.mjs:2824-2858`)
  จัดกลุ่มตาม (slot prefix ก่อน `"__"` ในชื่อไฟล์, media type) แล้วในแต่ละกลุ่มเลือกเฉพาะ batch
  ที่มี `assignment_round` สูงสุด (เสมอกันใช้ id สูงสุดตัดสิน) — คือ batch ล่าสุดของ slot นั้น
  ไม่ว่าจะมี batch ของรอบใหม่มา supersede จริงหรือยัง

พฤติกรรมของแต่ละ fixture:

| fixture | gate เก่า (main) | gate ใหม่ (fix branch) |
|---|---|---|
| (ก) round=2, มี asset ที่ round=1 ครบ, image_reset_required=0 | count=0 → **409** | asset round=1 ถูกนับเป็น active batch ของ slot นั้น (ไม่มี batch round=2 มา supersede) → count≥1 → **ผ่าน** — นี่คือ behavior ที่ mock test บน fix branch ทดสอบ |
| (ข) ไม่มี asset เลย | count=0 → **409** | count=0 → **409** — ไม่ต่างกัน ทั้งสอง branch |
| (ค) image_reset_required=1, ไม่มี asset รอบใหม่ | ดูข้อ 4 — ขึ้นกับว่า gate ไหนโดนถึงก่อน ไม่ใช่เรื่องนับ asset เก่า/ใหม่ | เช่นเดียวกัน |

---

## 4) payload/route: เงื่อนไข 400/409 เรียงตามลำดับจริง

Route: `server/index.mjs:11299-11449`

1. `11301-11304`: `assignmentId` ว่าง → **400** `{ error: "Invalid assignment id" }`
2. `11306-11309`: ไม่พบ assignment → **404**
3. `11312-11315`: `role === "editor"` → **403**
4. `11316-11319`: `!hasAssignmentSubmissionAccess(req, assignment)` → **403**
5. `11320-11326`: `role === "freelance"` และ state ไม่อยู่ใน `[assigned, in_progress,
   revision_requested]` → **409** `{ error: "assignment is not accepting submissions" }`
6. `11336-11339`: `submission_state` ไม่ถูกต้อง → **400**
7. `11340-11343`: `normalizedSubmissionState==="resubmitted"` แต่ assignment state ไม่ใช่
   `revision_requested` → **409**
8. `11344-11347`: `normalizedSubmissionState==="submitted"` แต่ assignment state เป็น
   `revision_requested` → **409**
9. **`11354-11365`: deliverables gate** — **409**
   `{ error: "บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง" }` ถ้า
   `currentRoundDeliverablesCount < 1` (fix branch เปลี่ยนแค่วิธีนับที่จุดนี้ ตำแหน่ง/
   `res.status(409)`/ข้อความเหมือนเดิม)
10. `11372`: `enforceAssignmentSubmissionRequiredFields(...)` (impl `3430-3461`) — throw
    `Error` ธรรมดา (ไม่มี `.code`) ถ้าขาดคำตอบ prompt หรือขาด `additional_text`
    (บรรทัด 3453-3455) → catch ที่ `11444-11447` ได้ **400**
11. `11373`: `enforceResetPerShotRequirements(...)` (impl `3515-3578`) — throw `Error`
    ธรรมดา (ไม่มี shot items ที่บรรทัด 3535, หรือ per-shot ขาด/เกินที่ 3566/3567/3571/3572)
    → catch เดียวกัน → **400**
12. `11392-11401`: `repo.addSubmissionWithAssignmentTransition(...)` อาจ throw จาก
    `addAssignmentSubmission` (`repository.mjs:5856-5947`, เช่น "duplicate submission is
    not allowed" บรรทัด 5867, "assignment is not accepting submissions from state=..."
    บรรทัด 5870) → **400**; หรือ `updateAssignmentStateInternal` ให้ `err.code =
    "INVALID_PRODUCTION_TRANSITION"` (`repository.mjs:5641-5645`) หรือ `assertValidTransition`
    ให้ `INVALID_TRANSITION` → **409** ผ่านการเช็ค `err.code` ที่ `11446`

**สำหรับ fixture (ค) (image_reset_required=1, ไม่มี asset รอบใหม่): gate ข้อ 9 (deliverables
gate) โดนก่อนและชนะเสมอ** ก่อนที่ `enforceResetPerShotRequirements` (ข้อ 11) จะถูกเรียกถึง
— ทั้งบน `main` และบน fix branch เพราะ diff (`git diff main...fix/submit-gate-active-batch --
collector/server/index.mjs`) มี hunk เดียว (`@@ -11352,11 +11352,10 @@`) ที่แทนที่วิธีนับใน
ตำแหน่งเดิม ไม่ได้ย้ายตำแหน่งเทียบกับบรรทัด 11372-11373

**ข้อควรระวังสำคัญ**: เงื่อนไขนี้เป็นจริงเฉพาะกรณีที่ fixture ไม่มี asset ของ **ทั้งสอง media
type** (image และ video) สำหรับรอบปัจจุบัน (gate เก่า) หรือไม่มี active-batch asset ของทั้งสอง
type (gate ใหม่) ถ้า `image_reset_required=1` แต่มี asset วิดีโอเหลืออยู่ (ไม่ถูก reset)
deliverables gate อาจผ่าน (count≥1 จากฝั่งวิดีโอ) แล้ว `enforceResetPerShotRequirements` จะถูก
เรียกถึงจริงและอาจ 400 อิสระเพราะขาดภาพต่อช็อต — นอกจากนี้ `enforceResetPerShotRequirements`
เอง throw 400 guard-clause ของตัวเอง (ไม่มี `brief_json.shot_list_suggestions` และไม่มี
field-pack `must_capture` checklist, บรรทัด 3535) ถ้าจะทดสอบ per-shot logic จริงต้องมี
`brief_json.shot_list_suggestions` ที่ไม่ว่างด้วย

**payload ขั้นต่ำสำหรับ fixture (ก)/(ข) ที่ไม่มี `brief_json`/field pack แนบ**:
`enforceAssignmentSubmissionRequiredFields` สำหรับ `kind="field"` เรียก
`getAssignmentBriefPromptGroups(null)` (`server/index.mjs:3188-3197`) → `mustVerify=[]`,
`mustCapture=[]`, `mustAsk=[]` เพราะ brief เป็น `{}`; `findMissingPromptAnswers([], ...)`
คืน `[]` ทันที (3321-3323) และ `findMissingCapturePrompts(...)` คืน `[]` ทันทีเช่นกัน
(3397-3419, guard `!prompts.length` ที่ 3419) — **มีแค่ `payload.additional_text`
(บรรทัด 3453-3455) ที่ถูกบังคับจริง** เท่ากับ `article_payload_json: { additional_text: "..." }`
ก็พอผ่านข้อ 10 ได้แล้ว

**พบเพิ่มเติม (out of scope แต่ต้องรู้ก่อนออกแบบ fixture)**: `findMissingCapturePrompts`
(บรรทัด 3397-3428, ภายใน `enforceAssignmentSubmissionRequiredFields`) และ
`enforceResetPerShotRequirements` (3515-3578) **ยังเรียก gate เก่าแบบ round-ตรงเป๊ะ
`repo.listAssignmentRoundAssetsByType` อยู่** แม้บน fix branch (บรรทัด 3405-3406, 3420-3421,
3538, 3541) — fix branch เปลี่ยนแค่ top-level gate ที่ `11354-11365` เท่านั้น ไม่ได้แก้จุดนี้
ถ้า fixture มี field-pack `must_capture` checklist จริงและมี asset แค่ round เก่า อาจผ่าน
top-level gate ใหม่แต่ไป 400 ที่ `enforceAssignmentSubmissionRequiredFields`/
`enforceResetPerShotRequirements` แทน — implementer ต้องไม่เข้าใจผิดว่า 400 ตรงนั้นคือ
top-level gate fail

---

## 5) กับดัก

- **กัน port ชน**: `reservePort()` (`backward-autoclose-scope.test.mjs:22-29`) — bind
  `net.createServer()` ที่ port `0` อ่าน port ที่ OS สุ่มให้ ปิด probe socket แล้วส่ง port นั้น
  ให้ server ที่ spawn ผ่าน `PORT` env var คู่กับ `waitForCollector(baseUrl, child)`
  (บรรทัด 31-41) ที่ poll `GET /api/health` สูงสุด 50×50ms และเช็ค `child.exitCode` ด้วยเพื่อ
  fail เร็วถ้า server crash ตอน boot
- **env var ที่ server ต้องการตอน start**: `PORT` (`server/index.mjs:123`,
  `Number(process.env.PORT || 5060)`), `DB_PATH` (ผ่าน `collector/config/paths.mjs:9`,
  `process.env.DB_PATH ? path.resolve(...) : path.join(rootDir, "data", "collector.db")`),
  `BACKEND_JWT_SECRET`/`JWT_SECRET` (`server/index.mjs:130`) — **จำเป็น** ไม่ตั้งจะ throw
  `"BACKEND_JWT_SECRET is required..."` ที่บรรทัด 2350-2352 `COLLECTOR_ROOT` เองไม่ได้ถูกอ่านโดย
  `resolvePaths` — สิ่งที่มีผลจริงคือ `cwd` ตอน spawn ต้องตรงกับ root ที่ตั้งใจ
- **ความเสี่ยงสถานะค้าง/connection ซ้อน**: `openDatabase` (`collector/db/client.mjs:35-53`)
  เปิด `node:sqlite` `DatabaseSync` ตั้งแค่ `PRAGMA foreign_keys = ON` **ไม่ได้ตั้ง WAL pragma**
  เลย ใช้ journal mode default ของ SQLite — connection ที่ใช้สร้าง fixture กับ connection ของ
  server ที่ spawn ชี้ไฟล์เดียวกัน วิธีที่ทุกไฟล์ต้นแบบใช้แก้คือ **`db.close()` connection ฝั่ง
  fixture ก่อนเรียก `withServer(...)`** (เช่น `field-pack-ready-guard-route.test.mjs:187`,
  `backward-autoclose-scope.test.mjs:137`) แทนที่จะพึ่ง WAL concurrency
- **`import.meta.url` path guard** (ตัวที่ CLAUDE.md พูดถึง): ตัวอย่างที่
  `backward-autoclose-scope.test.mjs:16-17` —
  `const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const collectorRoot = path.dirname(__dirname);` (เหมือนกันที่
  `field-pack-ready-guard-route.test.mjs:17-18`) — ทำให้ test รันได้ทั้งจาก Dev
  (`D:\UbonCity_Web`) และ Runtime (`D:\UbonRuntime\repos\UbonCity_Web`) โดยไม่ hardcode path
- **role ของ token มีผล**: ต้องใช้ role ที่ไม่ใช่ `"editor"` (403 ที่ 11312-11315) และถ้าจะ
  ทดสอบ role `"freelance"` ต้องคุม assignment state ให้อยู่ใน
  `[assigned, in_progress, revision_requested]` ไม่งั้นชน 409 ที่ 11320-11326 ก่อนถึง gate
  ที่ต้องการทดสอบจริง — ต้นแบบใช้ `role: "owner"` เพื่อเลี่ยงเงื่อนไขนี้โดยตรง
- **ไม่มี repo helper สำหรับ insert `content_assets`**: ต้อง raw SQL insert เอง (ดูข้อ 3)
  คอลัมน์ต้องตรงกับที่ `server/index.mjs:15058`/`15208` ใช้จริง โดยเฉพาะ
  `assignment_surface='assignment_work'` และ `assignment_sync_batch_id` ต้องไม่เป็น null

---

## สรุปสั้นสำหรับ implementer prompt

- **ไฟล์ต้นแบบ**: `collector/tests/backward-autoclose-scope.test.mjs`
- **setup 5 ขั้น**: (a) temp DB จาก schema.sql ผ่าน `openDatabase` → (b) spawn
  `server/index.mjs` จริงด้วย `child_process.spawn` + ephemeral port + `waitForCollector`
  → (c) `jwt.sign(..., { role: "owner" }, authSecret)` เป็น Bearer token → (d) `fetch()`
  ยิง route → (e) `child.kill()` + `db.close()` + `fs.rmSync(tempDir)`
- **helper สร้าง fixture**: `repo.createAssignment()` (`repository.mjs:5264-5344`) +
  raw SQL `UPDATE content_assignments SET revision_round=...` (ไม่มี repo setter) +
  `repo.updateAssignmentMediaResetPolicy()` (5670-5695) + raw SQL insert เข้า `content_assets`
  ด้วยมือ (ไม่มี repo wrapper — ต้อง copy คอลัมน์จาก `server/index.mjs:15057-15098`)
- **กับดักที่ต้องเขียนกันไว้ใน prompt**: (1) test เดิมบน fix branch เป็น mock ล้วน ไม่ครอบคลุม
  HTTP path เลย — ต้องเขียนใหม่จริง (2) เขียนคอลัมน์ `content_assets` ให้ตรง schema/route จริง
  (3) `db.close()` fixture connection ก่อน spawn server กัน connection ซ้อน (4) fixture (ค)
  ต้องไม่มี asset ทั้ง image และ video ไม่งั้น deliverables gate จะผ่านและไปโดน
  `enforceResetPerShotRequirements` guard-clause อื่นแทน (5) role ต้องไม่ใช่ editor และถ้าใช้
  freelance ต้องคุม assignment state ให้อยู่ในลิสต์ที่อนุญาต (6) `enforceResetPerShotRequirements`/
  capture-prompt check ยังอิงกฎ round-ตรงเป๊ะแบบเก่าแม้บน fix branch — 400 จากจุดนั้นไม่ใช่สัญญาณ
  ว่า top-level gate fail
