# Step 5A — `assignment_state` mirror audit

วันที่ตรวจ: 2026-08-01

ฐานที่ตรวจ: `origin/main` commit `e05eb90018c1f80ec5ddb85e9b69900879364c60`

ขอบเขต: `content_workflow_models.assignment_state` เท่านั้น ไม่ตรวจหรือวางแผนคอลัมน์ legacy อื่นในรอบนี้

วิธีตรวจ: อ่าน source และค้น usage ใหม่ทั้งหมดจาก commit ข้างต้น ไม่แตะ DB และไม่รัน test

## A. ทุกจุดที่เขียน `assignment_state` บน workflow head

### จุดเขียนทางกายภาพ

| ไฟล์:บรรทัด | จุดเขียน | รายละเอียด |
|---|---|---|
| `collector/db/repository.mjs:4779-4792` | `upsertWorkflowModelStmt` | `INSERT ... ON CONFLICT DO UPDATE`; ทุก create/update head เขียนคอลัมน์นี้ แม้ค่าจะเป็น `null` หรือค่าเดิม |
| `collector/db/repository.mjs:6053-6058` | `createWorkflowHead` | ส่ง `assignmentState` เข้า statement; default เป็น `null` จาก `buildWorkflowHeadDefaults` ที่ `:5938-5953` |
| `collector/db/repository.mjs:6164-6169` | `upsertWorkflowModel` | ส่งค่าจาก payload หรือ preserve ค่าเดิม (`:6109-6112`) เข้า statement |

### Caller ที่สามารถกำหนด/เปลี่ยนค่า

| ไฟล์:บรรทัด | Caller | ค่าที่เขียน |
|---|---|---|
| `collector/db/repository.mjs:6401-6445` | `syncWorkflowAssignmentStateOnCreate` | เขียน state ของ assignment ที่เพิ่งสร้าง เฉพาะเมื่อ head ยังไม่มีค่า |
| `collector/db/repository.mjs:6553-6566` | `createAssignment` | เรียก sync ข้างบนหลัง insert `content_assignments` ที่ `:6536-6551` |
| `collector/db/repository.mjs:6858-6880` | `updateAssignmentStateInternal` | เขียน state ใหม่ของ assignment row ลง head เมื่อค่าไม่ตรงกัน |
| `collector/db/repository.mjs:10429-10442` | `returnFieldAssignmentForRework` | บังคับ head เป็น state ของ assignment รอบใหม่ (`assigned`) หลังปิดรอบเดิม |
| `collector/server/index.mjs:6896-6912`, `:8817-8834` | `POST /api/items` | รับ `workflow_patch.assignment_state` แล้วส่งเข้า `createItemWithWorkflowHead`; สามารถสร้างค่า head โดยไม่มี assignment row ได้ |
| `collector/server/index.mjs:10021-10070` | `PUT /api/items/:id/workflow-model` | รับ `assignment_state` แล้วส่งเข้า `upsertWorkflowModel` โดยตรง; ไม่ update `content_assignments.state` |
| `collector/server/index.mjs:14296-14325` | `POST /api/import` | รับ `workflow_patch.assignment_state` แล้วสร้าง head; ไม่สร้าง assignment row ในเส้นทางนี้ |
| `collector/server/index.mjs:8758-8771`, `:8799-8812` | create event / other-transport item | เขียน `assignment_state: null` ตอนสร้าง head |

Writer นอก request runtime: `collector/scripts/seed-mock-work-stage-jobs.mjs:752` ส่ง state ของ assignment เข้า workflow patch; `collector/scripts/migrate-place-review-flags.mjs:62,80,87` สร้างและ copy คอลัมน์ขณะ rebuild ตาราง

## B. ทุกจุดที่อ่าน และแหล่งที่อ่าน

### อ่านจาก workflow head

| ไฟล์:บรรทัด | Reader / ผลที่ใช้ |
|---|---|
| `collector/db/repository.mjs:6036-6044` | `createWorkflowHead` อ่าน payload/seed และ validate ค่า |
| `collector/db/repository.mjs:6109-6117` | `upsertWorkflowModel` fallback ไปค่าเดิมและ validate ค่า |
| `collector/db/repository.mjs:6136-6149` | ตรวจ transition และนับว่า state เปลี่ยนหรือไม่ |
| `collector/db/repository.mjs:6187-6190` | สร้าง `content_workflow_transitions` กลุ่ม assignment จากค่าเดิม/ใหม่บน head |
| `collector/db/repository.mjs:6231-6256` | `listItemsByWorkflowHead`: filter `assignment_states` และ unknown-state assertion ภายใน loop ของ item ทั้งหมด |
| `collector/db/repository.mjs:6410-6418` | creation sync ตรวจว่ามีค่าเดิมหรือไม่; ถ้ามีจะ preserve และไม่เขียน state ของ assignment ใหม่ |
| `collector/db/repository.mjs:6443` | sync result คืนค่าที่อ่านกลับจาก head |
| `collector/db/repository.mjs:6807-6812` | assignment update เปรียบเทียบ head กับ `content_assignments.state` ใหม่เพื่อเลือก sync/reconcile |
| `collector/db/repository.mjs:8720-8724` | ใส่ใน `content_readiness_briefs.reasons_json.workflow_state`; ไม่พบ runtime reader ที่อ่าน field ย่อยนี้กลับมา |
| `collector/server/index.mjs:1303-1339` | `attachItemMatchFields` แนบ `assignment_state` จาก head ให้ `/api/items`; อยู่ใน `.map()` ของ list |
| `collector/server/index.mjs:1379-1396` | `attachWorkflowHeadFields` แนบค่าให้ single-item response และ mutation responses |
| `collector/server/index.mjs:2840-2850` | unknown workflow-head state validator |
| `collector/server/public/app.js:702-725,735-753` | dashboard snapshot และ queue bucket; ค่าใด ๆ ที่ไม่ว่างทำให้ item เข้า bucket `assignment` |
| `collector/server/public/app.js:2948-2960` | in-flight label; ค่าใด ๆ ที่ไม่ว่างแสดง “ส่งงานให้ทีมแล้ว” |
| `collector/server/public/article-intake.js:407-419,422-429,464-470` | article queue ใช้ค่า `accepted` เพื่อเลือก candidate, prefetch, label และ group |
| `collector/server/public/workflow-state-catalog.js:21-34` | ตรวจว่า item-level `assignment_state` อยู่ใน catalog หรือไม่ |

Maintenance scripts ที่อ่าน head โดยตรง: `collector/scripts/smoke-ai-input-cleanup-post-assignment.mjs:44`; `collector/scripts/smoke-field-pack-return-to-clean.mjs:53`; `collector/scripts/smoke-reference-cleanup.mjs:81`; `collector/scripts/smoke-handoff-boundary.mjs:37,48,66,78,92,98-100`

Tests ที่ผูกกับ head โดยตรง: `collector/tests/assignment-accept-confirmed-metadata.repository.test.mjs:645,649`; `collector/tests/assignment-ui-scope.test.mjs:2561,2728,2737,2953`; `collector/tests/field-pack.repository.test.mjs:1693`; `collector/tests/in-flight-items.test.mjs:48-53,120,219,251`; `collector/tests/manual-import-merge-backfill.behavior.test.mjs:153`; `collector/tests/workflow-readers-loud.test.mjs:202-206`

### อ่านจาก `content_assignments.state` จริง

| ไฟล์:บรรทัด | Reader / ผลที่ใช้ |
|---|---|
| `collector/db/repository.mjs:6794-6806` | `updateAssignmentStateInternal` อ่าน state เดิมจาก assignment row และ validate transition จริง |
| `collector/db/repository.mjs:7242-7248` | submission-draft prefill อนุญาตเฉพาะ `revision_requested` |
| `collector/db/repository.mjs:10036-10106` | `buildPublishableSourceByItem` โหลด assignments จริง, rank state และตรวจ accepted/closed |
| `collector/db/repository.mjs:10131-10187` | publishable-source checks, source payload และ debug ใช้ state ของ candidate assignment จริง |
| `collector/server/index.mjs:4359-4369` | สิทธิ์แก้ editorial assignment อ่าน `assignment.state` จริง |
| `collector/server/index.mjs:4858-4868` | เลือก active editorial assignment จาก assignment rows จริง |
| `collector/server/index.mjs:9828-9851`, `:11788-11811` | submission/resubmission flow อ่าน assignment row จริง |
| `collector/server/public/app.js:1216-1218`, `:10080-10081` | UI action ของ assignment object อ่าน `.state` จริง |
| `collector/server/public/article-intake.js:165-180,678-703` | มี assignment object จริงจาก article-process หรือ `/api/assignments/mine`; ปัจจุบันใช้สำหรับ assignee แต่ยังไม่ได้ใช้แทน item-level head state |
| `collector/server/public/article-workspace-page.js:705-712` | แสดง `source.assignment_state` ซึ่งถูก derive จาก assignment จริงโดย `buildPublishableSourceByItem` |

## C. จุด sync และเงื่อนไข preserve

1. **Create assignment -> head:** `createAssignment` insert assignment ก่อน (`collector/db/repository.mjs:6536-6551`) แล้วเรียก `syncWorkflowAssignmentStateOnCreate` (`:6553-6563`).
2. **Preserve:** sync โหลด head แล้ว normalize ค่าเดิม (`:6410-6411`). ถ้าค่าเดิมเป็น assignment state ที่รู้จักและไม่ว่าง จะ return `existing_assignment_state_preserved` ทันที (`:6412-6418`) โดยไม่สนว่า assignment ใหม่เป็น kind ใด, id ใด หรือ state ใด. ค่า `null`, empty string หรือค่าที่ normalize ไม่ได้จึงจะยอมเขียน assignment ใหม่ (`:6421-6437`).
3. **Update assignment -> head:** assignment row ถูก update ที่ `:6818-6826`; ถ้า state บน head ต่างจาก state ใหม่ (`:6808-6809`) จะ sync ผ่าน `upsertWorkflowModel` (`:6858-6880`). ถ้า edge จาก state บน head ไป state ใหม่ผิดกฎ จะเปิด skip flag.
4. **Rework special reconcile:** ปิด assignment เก่าเป็น `closed`, สร้าง assignment ใหม่เป็น `assigned` (`:10401-10424`), แล้วบังคับ head จาก `closed -> assigned` ที่ `:10429-10442` เพราะ create sync preserve ค่า `closed`.
5. **ไม่มี reverse sync:** direct head writers ใน API create/import/workflow-model ไม่ update `content_assignments.state`.

ผลสำคัญ: head ไม่ได้หมายถึง “assignment ล่าสุด” อย่างสม่ำเสมอ เพราะ create จะ preserve ค่าเดิม แต่ update assignment ใด ๆ สามารถเขียน state ของ row นั้นทับ head ได้

## D. `skip_assignment_transition_validation`

นิยามและจุดอ่าน flag อยู่ที่ `collector/db/repository.mjs:6126,6136-6137` ใน `upsertWorkflowModel`

| ไฟล์:บรรทัด | ใครตั้ง | เมื่อใด / เพราะอะไร |
|---|---|---|
| `collector/db/repository.mjs:6810-6812,6874-6879` | `updateAssignmentStateInternal` | ตั้งเป็น `!canSyncViaTransition`; เป็น `true` เมื่อ state จริงของ assignment เปลี่ยนถูกกฎจาก row เดิม แต่ state เดิมบน head ล้าหลังจน edge `head -> new assignment state` ผิดกฎ |
| `collector/db/repository.mjs:10426-10440` | `returnFieldAssignmentForRework` | ตั้ง `true` ตายตัวเพื่อบังคับ head `closed -> assigned` หลังเปิด assignment รอบใหม่ เพราะ create sync preserve `closed` |

ไม่พบ caller อื่นใน source ปัจจุบันที่ตั้ง flag นี้

## E. แทน reader ของ head ด้วยอะไร และแพงเกินไปหรือไม่

| Reader จากข้อ B | แหล่งทดแทน | ต้นทุน / ข้อสรุป |
|---|---|---|
| create/upsert validation, change detection, head assignment transition (`repository.mjs:6036-6044,6109-6190`) | **ไม่ต้องใช้แล้ว** | ลบ assignment branch ออกจาก workflow-head writer. แต่ต้องย้ายการบันทึก assignment transition ให้ใช้ state เดิม/ใหม่ของ assignment row ที่มีอยู่แล้ว (`:6794-6806`); ไม่ต้อง query เพิ่ม |
| `listItemsByWorkflowHead({ assignment_states })` (`:6231-6256`) | **ไม่ต้องใช้แล้ว** ใน function นี้ | `rg` พบการประกาศ catalog และ test แต่ไม่พบ runtime caller ที่ส่ง `assignment_states`. การ query assignment ต่อ item ใน loop นี้จะเป็น N+1; ควรลบ filter capability แทน |
| create sync / update reconcile / rework reconcile (`:6401-6445,6807-6812,10426-10442`) | **ไม่ต้องใช้แล้ว** | operation มี assignment row จริงอยู่ในมือแล้ว; ไม่ต้อง query เพิ่ม |
| readiness `reasons_json` (`:8720-8724`) | **ไม่ต้องใช้แล้ว** หรือ query assignments สดถ้าต้องการ diagnostic จริง | เป็น single-item recompute ไม่ใช่ list และไม่พบ consumer ของ field ย่อย; ไม่มีเหตุผลให้เก็บ mirror |
| `/api/items` list projection (`server/index.mjs:1303-1339`) | derive สดจาก `primaryAssignment` ที่ `resolveItemScopeContext` โหลดอยู่แล้ว (`:4241-4257`) หรือ batch assignments ตาม item IDs | เป็นจุดเสี่ยงหลัก: `/api/items` ใช้ `repo.listItems()` แบบไม่มี limit (`:8490-8527`; SQL ไม่มี limit ที่ `repository.mjs:4025`) และวนทุก item. **ห้ามเพิ่ม query ใหม่ใน `attachItemMatchFields.map()`**. Reuse scope context หรือ batch query; ไม่ต้องเก็บ mirrorเพื่อแก้ performance |
| single-item projection (`server/index.mjs:1379-1396`) | query `listAssignmentsByItem(itemId)` สด หรือ reuse scope context | หนึ่ง item; index `content_assignments(content_item_id, created_at DESC)` รองรับ ไม่แพงเกินไป |
| dashboard queue/in-flight UI (`app.js:702-753,2948-2960`) | ให้ API คง response field ชื่อ `assignment_state` แบบ **derived** จาก assignment จริง หรือใช้ `assignment_owner` ที่มีอยู่ | ไม่จำเป็นต้องแตะ UI ใน Step 5A ถ้าคง response contract แบบ derived. ความหมายที่เหมาะคือ “primary/current assignment” แต่ selection rule ต้องยืนยัน; ดู blocker ด้านล่าง |
| article-intake accepted checks (`article-intake.js:407-470`) | query/derive จาก `content_assignments` สด; หน้าโหลด assignment objects อยู่แล้ว (`:165-180,678-703`) | ไม่มีเหตุผลด้าน performance ให้เก็บ mirror. แต่ความหมายเป็น blocker: head ที่ preserve `accepted` อาจกำลังทำหน้าที่ milestone “เคยผ่านงาน assignment แล้ว” ไม่ใช่ state ของ assignment ปัจจุบัน. **ไม่แน่ใจ** ว่าต้องใช้ latest assignment, active editorial assignment, latest field assignment หรือ `EXISTS(state IN ('accepted','closed'))` |
| unknown-state validator (`server/index.mjs:2840-2850`, `workflow-state-catalog.js:21-34`) | validate assignment object จริง หรือไม่ต้องนับ assignment เป็น workflow-head state | ไม่มี query เพิ่ม |
| smoke/migration/tests | query `content_assignments` หรือเอา assertion ของ mirror ออก | ไม่ใช่ runtime list cost |

### Performance verdict

มี large-list path จริงสองจุด แต่ไม่ทำให้ต้องเก็บ mirror:

* `/api/items` ไม่มี limit และมี per-item assignment lookup อยู่แล้วใน `resolveItemScopeContext` (`collector/server/index.mjs:4241-4249,8498-8518`). ต้อง reuse/batch ห้ามเพิ่ม lookup ซ้ำใน `attachItemMatchFields`.
* `listItemsByWorkflowHead` วน item ทั้งหมด (`collector/db/repository.mjs:6241-6256`) แต่ assignment-state filter ไม่มี runtime caller จึงลบได้ ไม่ต้องแทนด้วย per-item query.

ดังนั้น **ไม่มี reader ที่บังคับให้เก็บ persisted mirror ด้วยเหตุผลด้าน performance**. จุดที่ต้องตัดสินก่อน fix เป็นเรื่อง semantics ของ article-intake `accepted`, ไม่ใช่ performance.

## F. Schema

* คอลัมน์: `collector/database/schema.sql:955` — `assignment_state TEXT`, nullable
* index: `collector/database/schema.sql:973` — `idx_content_workflow_models_assignment(assignment_state, updated_at DESC)`
* ไม่มี `CHECK`, `UNIQUE`, foreign key หรือ default ผูกกับคอลัมน์นี้
* foreign key ของตารางอยู่ที่ `collector/database/schema.sql:969` และผูก `content_item_id`, ไม่ได้ผูก `assignment_state`
* migration เดิม `collector/scripts/migrate-place-review-flags.mjs:51-97` แสดงรูปแบบ rebuild/copy ตารางและยัง copy `assignment_state`

ตามข้อกำหนดรอบนี้ การลบคอลัมน์ใน SQLite ต้องทำ table rebuild: drop index ที่อ้างคอลัมน์, สร้างตารางใหม่ที่ไม่มีคอลัมน์, copy columns ที่เหลือ, สลับตาราง และสร้าง indexes ที่เหลือใหม่

## G. Flag หมดความจำเป็นจริงไหม

**หมดความจำเป็นจริง** เมื่อ workflow head ไม่มี `assignment_state`:

* Caller แรก bypass เฉพาะ validation ของ edge ระหว่าง **ค่า mirror ที่ล้าหลัง** กับ state ใหม่ของ assignment (`collector/db/repository.mjs:6808-6812,6878`).
* Callerที่สอง bypass `closed -> assigned` เฉพาะบน mirror หลังเปิด assignment รอบใหม่ (`:10426-10440`).
* เมื่อลบ mirror จะไม่มี assignment transition บน `upsertWorkflowModel` ให้ bypass อีก

ข้อควรระวัง: ห้ามลบ validation ของ transition จริงที่ `collector/db/repository.mjs:6802-6806`. และห้ามลบ assignment transition history ไปพร้อม mirrorโดยไม่ย้าย `recordWorkflowTransition` ให้บันทึกจาก state เดิม/ใหม่ของ `content_assignments` โดยตรง มิฉะนั้น history กลุ่ม assignment ที่ปัจจุบันสร้างผ่าน head (`:6187-6190`) จะหาย
