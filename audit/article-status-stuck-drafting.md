# Audit: item 39 ("More Moon") — article-process status ค้างที่ "drafting"

- โหมด: READ-ONLY (audit-scanner → audit-deep-reasoner). ไม่มีการแก้โค้ด/migration/restart ใด ๆ
- เครื่อง: Runtime (`D:\UbonRuntime\repos\UbonCity_Web`), DB จริงที่ `collector/data/collector.db`
- อาการ: `GET /api/items/39/article-process` คืน `status: "drafting"`, ปุ่ม `#btn-request-revision`
  (`collector/server/public/article-submit-page.js:934`) และ `#btn-approve-sync` (`:936-943`) จึง disabled ทั้งคู่

---

## 1. `status` เก็บที่ไหน และมีกี่จุดเขียน

**`content_workflow_models` ไม่มีคอลัมน์ `status` เลย** — คอลัมน์จริงคือ `production_state`,
`publication_state`, `place_review_flag`, `current_draft_id`, `current_review_report_id`,
`current_field_pack_id`, `state_version`, `content_version`, ... (ยืนยันจาก schema + query จริง)

`status` เป็นค่า **คำนวณตอนอ่าน (derived at read time)** โดย `deriveArticleProcessStatus()`
(`collector/server/index.mjs:4470-4502`) จาก `production_state` / `publication_state` /
`place_review_flag` / `publishableSource.ready_for_publish_source`

จุดเขียนคอลัมน์ที่แท้จริง (ไม่มีจุดใดเขียน `status` ตรง ๆ):

| จุด | เงื่อนไข | เขียนอะไร |
|---|---|---|
| `mapArticleProcessStatusToWorkflowPatch` (`index.mjs:4551-4585`) | แปลง article-process status → patch | เช่น `ready_for_review → {production_state:"in_review", publication_state:"draft"}` (`:4566-4572`) |
| `transitionArticleProcessState` (`index.mjs:4227-4296`) | เรียกจาก route `:9332` และ `:9386/:9541` | ส่ง patch ผ่าน `resolvePlaceLadderWorkflowPatch` แล้ว `repo.upsertWorkflowModel` |
| `finalizeArticleProcessReadyForSync` (`index.mjs:4352-4449`) | path `ready_for_sync` | `production_state:"ready_for_publish", publication_state:"approved"` |
| `applyArticleNeedsRevisionWorkflowTransition` (`index.mjs:4315-4350`) | ส่งกลับแก้ไข | `production_state:"needs_revision"` (หรือ place-ladder target) |
| `PATCH /api/assignments/:id/state` field-accept (`index.mjs:11143-11185`) | `assignment_kind==="field" && nextState==="accepted"` | `production_state:"ready_for_writer"`/`"content_in_progress"` |
| **`resolvePlaceLadderWorkflowPatch` (`index.mjs:4298-4313`)** | ถ้า `repo.canTransition(...)===false` | **ตัด `production_state` ออกจาก patch เงียบ ๆ** (แค่ `console.error`, ไม่มี exception/4xx กลับไปยังผู้เรียก) |
| `repo.upsertWorkflowModel` (`repository.mjs:4876-4939` ใหม่ / `:4994-5035` conflict) → UPSERT `content_workflow_models` (`:3693-3715`) → `recordWorkflowTransition` (`:4802-4816`) → INSERT `content_workflow_transitions` (`:3724-3729`) | เขียนจริงเฉพาะ field ที่ค่าต่างจากเดิม | ถ้าไม่มีอะไรเปลี่ยนจะไม่ insert transition row เลย |

---

## 2. ทำไม item 39 ไม่ได้ `ready_for_review` — ข้อมูลจริงจาก DB

Write attempt จริงของ item 39 คือ `POST /api/items/39/article-process/submit-review`
(`index.mjs:9386-9555`, note: "submitted from article workspace") ซึ่งสร้างสำเร็จ:
- `content_assignments.id=39` → `assignment_kind:"editorial"`, `state:"submitted"`, `latest_submission_id:19`
- `content_assignment_submissions.id=19` → `submission_state:"submitted"`
- `content_assignment_submission_deliverables.id=106` → `deliverable_type:"article_draft"`, มีเนื้อหาไทยเต็ม, `status:"submitted"`

จากนั้นที่ `index.mjs:9541` เรียก `transitionArticleProcessState(..., "ready_for_review", ...)` →
`mapArticleProcessStatusToWorkflowPatch("ready_for_review","place")` (`:4566-4572`) คืน
`{production_state:"in_review", publication_state:"draft", place_review_flag:"none"}`

Patch นี้ผ่าน `resolvePlaceLadderWorkflowPatch` (`:4298-4313`) ซึ่งเรียก
`repo.canTransition("place","production","writing_assigned","in_review")` —
**place production ladder (`repository.mjs:525-526`) ไม่มี edge `writing_assigned → in_review`**:
```
writing_assigned: Set(["writing", "ready_for_writer", "field_review"])   // :525 — ไม่มี "in_review"
writing:          Set(["writing_assigned", "in_review"])                 // :526 — เข้า in_review ได้จาก "writing" เท่านั้น
```
→ `canTransition` = false (`repository.mjs:4759-4773`) → `production_state` ถูกตัดออกจาก patch เงียบ ๆ →
`upsertWorkflowModel` เขียนแค่ `publication_state`/`place_review_flag` ที่ไม่เปลี่ยน → `stateChanged=false`
→ ไม่มี transition row ใหม่ — ตรงกับ DB จริง: transition ล่าสุดของ item 39 คือ id 405 (assignment→submitted)
ไม่มี production_state row ต่อจากนั้น, `workflow_head.production_state` ยังเป็น `"writing_assigned"`

Path สำรอง (`publishableSource?.ready_for_publish_source`, `index.mjs:4481`) ก็ไม่ช่วยเช่นกัน:
`buildPublishableSourceByItem` (`repository.mjs:8835-8906`) ต้องการ `assignmentAccepted` เป็น true
(`isSelectedAssignmentAccepted`, `collector/services/publishable-assignment-candidate.mjs:59-62`,
ต้องการ `assignment_state ∈ {"accepted","closed"}`) — แต่ assignment 39 จริงคือ `state:"submitted"`
(ยังไม่ accepted) → `assignmentAccepted=false` → `ready_for_publish_source=false` แม้ precondition
อีก 4 ข้อ (`latest_submission_id`, `article_draft`, `article_text`, `deliverables_review_usable`)
จะผ่านหมดก็ตาม (เป็น AND-chain เดียว, `repository.mjs:8879-8883`)

**สรุป root cause**: ทั้งสอง path ล้มด้วยเหตุผลคนละแบบและทั้งคู่ "ถูกต้องในตัวเอง" —
path หลักชนกับ ladder edge ที่ไม่มีอยู่จริง, path สำรองทำงานตามดีไซน์ (submission ที่ยังไม่ accept
ไม่ควรนับว่า publish-source พร้อม) จุดที่ลึกกว่านั้นคือ **ไม่มีจุดใดในระบบเคยเขียน
`production_state:"writing"`** สำหรับ place items เลย — two-hop ladder
(`writing_assigned → writing → in_review`) ที่ schema เขียนไว้เป็น dead code เพราะไม่มี trigger
ใดเดินทาง edge แรก (`writing_assigned→writing`, `repository.mjs:525`)

---

## 3. "approved" บนหน้าจอ มาจาก field ไหน

**ไม่ใช่ทั้ง `production_state`, `publication_state`, หรือ `compatibilityStatus`** —
`renderSyncSummary()` (`collector/server/public/article-submit-page.js:193-225`) emit
ข้อความ `<span class="ok">approved</span>` เป็น **hardcoded literal** ที่บรรทัด `:201` และ `:220`
(ทั้งสอง branch ของฟังก์ชัน) ไม่ได้ผูกกับ state ตัวแปรใด ๆ ทั้งสิ้น เรียกทุกครั้งที่ `renderAll()`
(`:973`) รัน (ถูกเรียกจาก action handler หลายจุด `:1073/1111/1133/1240/1288/1309/1323`)

`app.js:712-741` (`getItemWorkflowSnapshot`) คำนวณ `compatibilityStatus` จาก `production_state`/
`publication_state`/`place_review_flag` จริง แต่เป็นของหน้า **dashboard/queue** คนละหน้ากับ
article-submit-page ถ้าคำนวณด้วยค่าจริงของ item 39 (`writing_assigned`/`draft`/`none`) จะตกลงมาที่
`else compatibilityStatus = "raw"` (`app.js:732`) — ไม่ใช่ `"approved"`

→ ทั้งสอง field **ไม่ sync กันโดยดีไซน์** เพราะ label บน article-submit-page ไม่ใช่ field เลย
เป็น placeholder ข้อความคงที่ที่ไม่เคยถูกทำให้ขึ้นกับ state จริง (ข้อความบังเอิญตรงกับ end-state
ที่ถูกต้องเฉพาะตอน item ไปถึง `ready_for_sync`/`synced_to_admin` เท่านั้น แต่ก็โชว์เหมือนกันทุก stage)

---

## 4. Blast radius — จุดอื่นที่อ่าน status นี้ไปตัดสินใจ

- `collector/server/public/article-submit-page.js:934/940/950` — ปุ่ม request-revision/approve-sync/send-main-site
- `collector/server/public/article-workspace-page.js:1717-1739` — `btn-submit-review` (enable เมื่อ
  `status ∈ {"drafting","revision_requested"}`, `:1723`), `btn-withdraw-to-drafting` (`:1733-1738`)
  — เพราะ item 39 ค้างที่ `"drafting"` ปุ่มนี้จะ enable กลับมาทั้งที่ resubmit จริงจะโดน 403
  (editorial assignment lookup `index.mjs:9420-9426` ไม่ match `state:"submitted"` แล้ว)
- `collector/server/public/event-submit-page.js:130,196,460,503,551-562` — `getArticleStatus()` gate เดียวกัน
- `collector/server/public/article-preview-page.js:49`, `event-preview-page.js:66` — เลือก preview mode
- `index.mjs:8546-8552` (`release-main`) — gate sync ด้วย `currentStatus ∈ {"ready_for_sync","synced_to_admin"}`
- `index.mjs:13269-13284` (admin-review-ingest) — gate ด้วย `processStatus === "ready_for_sync"`
- `app.js:712-759` (`getItemWorkflowSnapshot`/`resolveQueueBucket`) — bucket การแสดงผลใน dashboard/queue
  (แกนคนละตัวกับ article-process status แต่ใช้ raw `production_state`/`publication_state` เดียวกัน)

---

## 5. จุดแก้ที่เล็กที่สุด (เสนอเท่านั้น — ห้ามแก้)

**`collector/db/repository.mjs:525`** — เพิ่ม edge `"in_review"` เข้าไปใน
`writing_assigned: Set([...])` ของ place production ladder โดยตรง
(`writing_assigned: Set(["writing", "ready_for_writer", "field_review", "in_review"])`)
เป็น pattern เดียวกับที่เคยทำมาแล้ว 2 ครั้งในโซนนี้ (commit `4e2d48b` เพิ่ม
`writing_assigned→field_review`, commit `7438306` เพิ่ม `field_review→field_working`)
วิธีนี้ทำให้ transition ที่ `submit-review` พยายามทำอยู่แล้ว (`writing_assigned → in_review`
ผ่าน `mapArticleProcessStatusToWorkflowPatch`, `index.mjs:4566-4572`) ถูกต้องตามกฎ
โดยไม่ต้องประดิษฐ์ transition ใหม่ที่ไม่มีอยู่จริงในระบบ

ทำไมจุดอื่นไม่ใช่:
- **`mapArticleProcessStatusToWorkflowPatch` (`:4551-4585`)** — ใช้ร่วมกับทุก content type/ทุก
  transition endpoint เป็น pure function ไม่เห็น state ปัจจุบัน แก้ตรงนี้ต้องเปลี่ยน signature +
  ทุกจุดที่เรียก — blast radius ใหญ่กว่ามาก
- **`resolvePlaceLadderWorkflowPatch` (`:4298-4313`)** — เป็น safety net ใช้ร่วมกับทุก place
  production write รวมถึง backward-transition routes ทั้งหมด เปลี่ยนให้ throw/auto-correct ที่นี่
  จะโผล่ปัญหาให้เห็นแต่ไม่ได้ตัดสินว่า target state ที่ถูกต้องคืออะไร
- **`buildPublishableSourceByItem`/`isSelectedAssignmentAccepted` (`repository.mjs:8835-8906`,
  `publishable-assignment-candidate.mjs:59-62`)** — ถ้าคลาย `assignmentAccepted` ให้นับ
  `"submitted"` ด้วย จะทำให้ draft ที่ยังไม่ผ่านตรวจนับว่า publish-source พร้อมในทุกที่ที่ฟังก์ชันนี้
  ถูกใช้ (รวม `finalizeArticleProcessReadyForSync`) — เป็น data-integrity regression ที่ไกลกว่า item เดียว
- **hardcoded "approved" label (`article-submit-page.js:200-201/219-220`)** — แก้แค่นี้เป็นการแก้
  cosmetic mismatch เท่านั้น สถานะจริงของ item 39 ยัง `"drafting"` เหมือนเดิม
- **สร้าง write path ใหม่ `writing_assigned→writing`** (mirror field-kind ที่ `index.mjs:11143-11185`)
  — "ถูกต้อง" กว่าเชิงสถาปัตยกรรมแต่ต้องตัดสิน trigger ใหม่ + ยังต้องมี hop ที่สอง (`writing→in_review`)
  — เปลี่ยนพฤติกรรม 2 จุดและมี surface area มากกว่าการขยาย ladder edge เดียว

---

## Files/lines อ้างอิงหลัก

- `collector/server/index.mjs:4227-4296, 4298-4313, 4315-4350, 4352-4449, 4455-4502, 4551-4590,
  4644-4700, 9315-9330, 9332-9384, 9386-9555, 11073-11185, 11322-11471, 8546-8552, 13230-13284`
- `collector/db/repository.mjs:449, 484-538, 3693-3715, 3724-3729, 4759-4773, 4802-4816,
  4860-5035, 8835-8933`
- `collector/services/publishable-assignment-candidate.mjs:36-71`
- `collector/server/public/article-workflow-core.js:417-419`
- `collector/server/public/article-submit-page.js:193-225, 927-960, 962-979`
- `collector/server/public/article-workspace-page.js:1717-1739`
- `collector/server/public/event-submit-page.js:130,196,460,503,551-562`
- `collector/server/public/app.js:712-759`
- DB (read-only, query จริง): `content_workflow_models` id 231 (item 39),
  `content_workflow_transitions` ids 290-405 (item 39), `content_assignments` ids 29/39,
  `content_assignment_submissions` id 19, `content_assignment_submission_deliverables` id 106,
  `content_items` id 39 (`type:"place"`)
