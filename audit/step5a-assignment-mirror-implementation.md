# Step 5A — remove `content_workflow_models.assignment_state`

วันที่ทำ: 2026-08-01

ฐานที่แตก branch: `main` commit `e05eb90018c1f80ec5ddb85e9b69900879364c60`

ขอบเขต: ลบเฉพาะ assignment-state mirror; ไม่แตะ `content_items.workflow_status`

## 1. ย้าย assignment transition history ก่อนลบ mirror

- `createAssignment` เขียน transition กลุ่ม `assignment` จาก `null` ไปยัง state ของ assignment row ที่สร้างจริง พร้อม `assignment_id` ที่ `collector/db/repository.mjs:6409,6476-6487`
- `updateAssignmentStateInternal` validate จาก `content_assignments.state` เดิม แล้วเขียน transition จาก state เดิมไป state ใหม่พร้อม `assignment_id` ที่ `collector/db/repository.mjs:6710,6743-6754`
- create และ update ครอบ assignment write กับ transition write ใน transaction เดียวกัน จึงไม่เกิด assignment row โดยไม่มี history จากการเขียนครึ่งทาง
- rework ใช้ operation จริงสองครั้ง: assignment เดิม `accepted -> closed` และ assignment ใหม่ `null -> assigned`; ไม่มีการสร้าง history ผ่าน workflow head แล้ว (`collector/db/repository.mjs:10304`)
- validation ของ transition จริงยังอยู่ใน `updateAssignmentStateInternal`; ลบเฉพาะ validation/bypass ของ mirror

## 2. Reader และความหมายใหม่

กฎกลางอยู่ที่ `collector/services/assignment-state.mjs:1-8`: มี assignment ใด ๆ ที่ state เป็น `accepted` หรือ `closed`

กฎเดียวกันถูกใช้ทั้งการ derive สำหรับ item response (`collector/server/index.mjs:4244-4266`) และ `buildPublishableSourceByItem` (`collector/db/repository.mjs:10000-10028,10060-10083`)

| Reader | ก่อนแก้ | หลังแก้ |
|---|---|---|
| `/api/items` และ item scope response | string จาก `content_workflow_models.assignment_state` | `has_accepted_assignment` boolean จาก assignment rows ที่ `resolveItemScopeContext` โหลดเพื่อ scope อยู่แล้ว (`collector/server/index.mjs:4244-4266,4285`) |
| single-item / mutation response | string จาก head | reuse scope context เมื่อมี; ถ้าเป็น single-item path ที่ยังไม่มี context จะโหลด assignments หนึ่งครั้ง (`collector/server/index.mjs:1380-1400`) |
| Article Intake | head ต้องเท่ากับ `accepted` | `has_accepted_assignment === true`, คือมี assignment `accepted|closed` (`collector/server/public/article-intake.js:407-424,461-464`) |
| dashboard queue bucket | head มีค่าใด ๆ ก็เข้า bucket `assignment` | เข้า bucket `assignment` เมื่อมี assignment `accepted|closed` (`collector/server/public/app.js:702-753`) |
| in-flight label | head มีค่าใด ๆ แสดง “ส่งงานให้ทีมแล้ว” | accepted/closed แสดง “งานที่มอบหมายถูกรับแล้ว” (`collector/server/public/app.js:2944-2956`) |
| workflow unknown-state validators | validate item-level assignment mirror | ไม่ validate mirror; assignment object จริงยังใช้ catalog เดิม |
| readiness diagnostic `reasons.workflow_state.assignment_state` | copy ค่า head ที่ไม่มี consumer | ลบ field ย่อย ไม่ query เพิ่ม |
| `listItemsByWorkflowHead({ assignment_states })` | filter head ภายใน full-list loop | ลบ capability ที่ไม่มี runtime caller; ไม่สร้าง N+1 query |
| maintenance smoke scripts | อ่าน/เขียน head column | direct head fixtures ไม่ใช้คอลัมน์; handoff smoke ใช้ `EXISTS content_assignments` |

### Query cost

ไม่มี query assignment เพิ่มใน `.map()` ของ `/api/items`: `resolveItemScopeContext` เรียก `listAssignmentsByItem` ครั้งเดียว แล้วใช้ array เดียวกันทั้ง visibility, primary assignment, owner metadata และ `has_accepted_assignment` (`collector/server/index.mjs:4244-4266,8507-8514`)

จุด single-item query สูงสุดหนึ่งครั้งต่อ response และมี index เดิมของ `content_assignments(content_item_id, created_at DESC)` รองรับ จึงไม่มีเหตุผลด้าน performance ให้เก็บ mirror

## 3. Sync และ skip flag

ลบแล้ว:

- `syncWorkflowAssignmentStateOnCreate`
- assignment-state write ใน `updateAssignmentStateInternal`; เหลือเฉพาะ place production-ladder side effect ที่เป็นคนละ state group
- forced head reconcile ใน `returnFieldAssignmentForRework`
- audit events ชื่อ `assignment.workflow_sync.*`
- input `workflow_patch.assignment_state` ใน create/import และ `assignment_state` ใน workflow-model endpoint

ค้น `skip_assignment_transition_validation` ใต้ `collector/` แล้วไม่พบทั้งนิยาม จุดอ่าน หรือ caller ที่ตั้ง `true` ดังนั้น flag หมดความจำเป็นตามเหตุเดิมจริง ส่วน `skip_production_transition_validation` และ `skip_publication_transition_validation` อยู่นอก scope รอบนี้

## 4. Schema และ migration

- schema ใหม่ของ `content_workflow_models` อยู่ที่ `collector/database/schema.sql:950-968`; ไม่มี `assignment_state`
- index ที่เหลือถูกประกาศใหม่ที่ `collector/database/schema.sql:970-974`; ไม่มี `idx_content_workflow_models_assignment`
- forward/reverse table rebuild อยู่ที่ `collector/scripts/migrate-remove-assignment-state.mjs:29-82`
- forward copy ทุกคอลัมน์ที่เหลือและสร้าง production/publication/pointer indexes ใหม่
- reverse สร้าง nullable `assignment_state` และ assignment index กลับมา; ค่าเดิมที่ถูกลบกู้คืนไม่ได้และตั้งเป็น `NULL` โดยตั้งใจ เพราะข้อมูล mirror ไม่มี semantic ที่เชื่อถือได้
- boot/repository ปฏิเสธฐานที่ยังมี mirror พร้อมบอก migration command (`collector/db/workflow-head-schema.mjs:24-32`, `collector/db/client.mjs:253`, `collector/db/repository.mjs:3424`)
- ปรับ `migrate-place-review-flags.mjs` ไม่ให้ rebuild แล้วนำ assignment mirror กลับมา

## 5. Verification

### Assignment history และ schema

- targeted history/migration/content-type suite: 101/101 ผ่าน
- focused atomic history + shared reader suite: 48/48 ผ่าน
- migration test รัน `down -> up -> down -> up` จริง และตรวจว่า FK `ON DELETE CASCADE`, `content_item_id UNIQUE`, indexes ที่เหลือ และ `PRAGMA foreign_key_check` ยังถูกต้อง (`collector/tests/assignment-state-migration.test.mjs:22-111`)
- create/update/rework assertions ตรวจ `assignment_id`, `from_state`, `to_state` จาก assignment จริง

### Article Intake กับฐานทดสอบจริง

อ่าน `collector/data/collector.db` แบบ read-only:

- place/event 30 items
- old head signal (`assignment_state='accepted'`): 0 items
- new real-assignment signal (`EXISTS accepted|closed`): 1 item
- จุดต่างคือ item `30` “88 Coffee Bean”: head=`submitted`, assignment rows=`submitted,accepted`, `workflow_status=approved`

item 30 อยู่ Article Intake ก่อนแก้อยู่แล้วเพราะ `approved` เป็น `ARTICLE_FLOW_STATUSES` ดังนั้นชุด item ของ Article Intake ในฐานนี้เท่าเดิม; เปลี่ยนเฉพาะเหตุผลประกอบการเข้า queue จาก legacy workflow status ไปเป็นกฎ assignment จริงที่สอดคล้องกัน

### Non-place

- shared reader test ครอบ `place/closed`, `event/accepted`, `article/submitted` และผ่านทั้งหมด (`collector/tests/assignment-state-reader.test.mjs:66-78`)
- content-type transition suite ผ่านทุก content type; assignment transition graph จริงยังคงเดิม

### Full suite

`npm run test:all` จาก repo root:

- 817 tests
- 756 pass
- **60 fail — ตรง baseline ที่กำหนด**

ตรวจ base commit แยกใน scratch worktreeได้ 813 tests / 746 pass / 66 fail; failure หกตัวที่หายไปเป็นกลุ่ม `manual-import-merge-backfill.behavior.test.mjs` ที่ baseline document ระบุไว้แล้ว และไม่มี failure name ใหม่จาก Step 5A
