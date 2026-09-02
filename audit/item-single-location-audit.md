# Audit — item ต้องอยู่ที่เดียว: current state + ตำแหน่งที่แสดง

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web` — HEAD = `main` @ `7012786` (working tree clean)
- Mode: READ-ONLY. ไม่แก้โค้ด / ไม่ commit / ไม่ merge / ไม่รัน gate|test:all
- DB: `collector/data/collector.db` (live, 33 items, ทั้งหมด type=place ยกเว้น #24=event; 0 soft-deleted ในชุดนี้)
- Sub agents: `audit-scanner` (เสร็จ, surface map). `audit-deep-reasoner` ไม่เรียก — ไล่ call chain + จำลอง bucket ของทั้ง 33 item บน DB จริงครบแล้ว
- Acceptance ที่ตรวจ (จากคำสั่ง ผู้ใช้): item 1 ใบต้องปรากฏ "ที่เดียว" ทั้งระบบ = จุดที่งานทำอยู่ตอนนี้ — ห้ามซ้ำข้ามตาราง/tab/หน้า และห้ามแสดงจาก state เก่า / assignment ใบเก่า
  **ข้อสังเกต: acceptance ข้อนี้ไม่มีเขียนใน `PROJECT_POLICY.md` เลย** — ใกล้ที่สุดคือ `PROJECT_POLICY.md:568`
  "The current (newest) round is the source of truth for display; superseded rounds must not shadow it" (จำกัดที่ field round เท่านั้น)

---

## Q1 — "current state" อ่านได้จากแหล่งไหน ใครเขียน ตัวไหนคือ SSOT

| แหล่ง | อ่านที่ | เขียนที่ | สถานะจริง |
|-------|---------|---------|-----------|
| **workflow head `content_workflow_models.production_state` / `.publication_state` / `.place_review_flag`** | server: `listStmt` JOIN `repository.mjs:2922-2928`; `attachWorkflowHeadFields` `index.mjs:1400-1401`; `attachItemScopeMetadata`; `ensureWorkflowModel` `repository.mjs:4942-4950` (throw ถ้าไม่มี ไม่สร้าง). client: `getItemWorkflowSnapshot` `app.js:713-714` | `upsertWorkflowModel` `repository.mjs:4952+` (มี `assertValidTransition`); `advanceWorkflowHead` `repository.mjs:4311`; INSERT ครั้งแรก `repository.mjs:3694` | **SSOT ตามโค้ดจริง** — ทุก UI decision ที่ item-centric อ่านตัวนี้ |
| **`content_items.workflow_status` (legacy)** | **ไม่มีจุดไหนอ่าน** — `SELECT i.*` (`repository.mjs:2922`) พาไปติด client object ผ่าน `mapItem` `repository.mjs:2701-2707` แต่ไม่มี consumer (grep client = เจอแต่ `transport_routes_v2`) | **write-dead** — server ลบ key นี้ทิ้งทุก payload: `index.mjs:8326, 8766, 8873, 13893`; repo map เฉพาะถ้ามีใน itemInput (ไม่มีวันมี) | **legacy cruft** — column ไม่อยู่ใน `schema.sql` (`content_items` block ไม่มี `workflow_status`; ที่ `schema.sql:353` คือตาราง `transport_routes_v2`) แต่ยังอยู่ใน DB จริง ค่าค้าง `raw`=24 / `analyzed`=9 (ตรงข้ามกับ head) |
| **`content_assignments.state`** | `hasOpenAssignment` `publishable-assignment-candidate.mjs:68-71`; `selectPrimaryOpenAssignment` `index.mjs:3981`; `selectPrimaryEditorialAssignment` `index.mjs:4638`; assignment lists `index.mjs:3621-3707`, `10829-10950`; client badge `renderAssignmentsTable` `app.js:9020+` | `updateAssignmentStateStmt` `repository.mjs:3830`, run ที่ `repository.mjs:5598` (`updateAssignmentState`) | current ของ "งาน" 1 ใบ — **ไม่ผูกกับ head**; assignment lists อ่านตัวนี้อย่างเดียว ไม่เคยเช็ค production_state |
| **article-process status (derived)** | `deriveArticleProcessStatus` / `deriveQueuedArticleProcessStatus` ผ่าน `buildArticleProcessPayload` `index.mjs:4648+`; อ่าน head + `buildPublishableSourceByItem` + transitions | ไม่เขียน (derived) | สรุปจาก head + assignment ไม่ใช่แหล่งเก็บ |
| **`publication_state`** | เหมือน head แถวบน (คอลัมน์เดียวกัน) | `upsertWorkflowModel` | ใน 33 item ปัจจุบัน = `draft` ทุกตัว |

**สรุป Q1**: SSOT ตามโค้ด = **workflow head (`content_workflow_models`)**. `content_assignments.state` เป็น SSOT แยกของ "งานแต่ละใบ" ที่ไม่ถูก reconcile กับ head. `content_items.workflow_status` = ตายแล้วทั้งอ่านและเขียน แต่ยังส่งค่าค้างไป client.

---

## Q2 — แหล่งไหนปัจจุบัน / แหล่งไหนประวัติ + บรรทัดที่ควรกรองประวัติแต่ไม่กรอง

**ปัจจุบัน**: workflow head; assignment ที่ `state != 'closed'`; field pack ที่ `is_current=1 AND archived_at IS NULL` (`repository.mjs:3284-3290`)

**ประวัติ**: `content_workflow_transitions` (append-only log); assignment ที่ `state='closed'` (รวมรอบเก่าที่ถูก `closed_by_backward_transition`); field pack ที่ `is_current=0` / archived; **assignment `state='accepted'` ของ field kind = "รอบที่จบแล้ว"** ตาม `PROJECT_POLICY.md:564` ("An accepted field assignment is a finished round")

จุดที่ควรกรองประวัติออกแต่ไม่กรอง:

1. **`buildManagedAssignmentsForActor` `index.mjs:3687-3707`** — กรองแค่ `dropClosedAssignments` (`index.mjs:3614-3618`, `state != 'closed'`). **`field:accepted` (รอบจบแล้ว) ผ่าน** → โผล่ในตาราง "งานที่ดูแล" คู่กับ editorial ที่ active ของ item เดียวกัน
2. **`/api/assignments/mine` default path `index.mjs:10919, 10924`** — `dropClosedAssignments` อย่างเดียว เช่นกัน → `field:accepted` โผล่
3. **`hasOpenAssignment` `publishable-assignment-candidate.mjs:64-66`** — นับ `accepted` เป็น "open" → item ที่ field งานจบแล้วแต่ยังไม่ปิด ถูกจัดเป็น bucket `assignment` (ดู Q3/Q5)
4. **assignment lists ทั้งหมด (`buildActionable...` `index.mjs:3621`, `buildReview...` `:3654`, `buildSubmitted...` `:3639`)** — กรองด้วย `state` เท่านั้น **ไม่มีบรรทัดไหนเช็คว่า assignment ใบนั้นสอดคล้องกับ `production_state` ปัจจุบันของ item** → assignment ที่ค้างจาก state เก่า (item ถอย production กลับแต่ assignment ไม่ปิด) ยังแสดงเป็นงาน active
5. **`resolveQueueBucket` `app.js:747-801`** — ไม่อ่าน `content_workflow_transitions` และไม่เช็คว่า assignment ใบที่ทำให้ `has_open_assignment=true` เป็นรอบปัจจุบันของ kind นั้นหรือไม่ (logic supersession อยู่ที่ `isActiveAssignmentCandidate` `publishable-assignment-candidate.mjs:26-29` แต่ **ไม่ถูกเรียกจาก path ของ `has_open_assignment`** — ดู `resolveItemScopeContext` `index.mjs:3992-4017`)

---

## Q3 — ทุกจุดที่ item โผล่ได้บน UI

Dashboard (`index.html`) เข้าถึงโดย role owner/admin/user เท่านั้น (`/api/items` gate `index.mjs:7998`). editor/freelance ใช้ assignment panel + `editor-home.html` / `freelance-home.html` (สองหน้านี้เป็น redirect page ล้วน ไม่มี list — `editor-home.js` / `freelance-home.js` ทำแค่ auth)

| # | หน้า / tab / table id | ไฟล์:บรรทัดที่คัด item | ฟิลด์ที่ใช้ตัดสิน | ฟิลด์ที่ใช้แสดงสถานะ | อ่านจากใบเก่า/ประวัติ? |
|---|----------------------|----------------------|------------------|---------------------|------------------------|
| 1 | dashboard › tab "เตรียมคอนเทนต์" › **`table-raw-intake`** | `getPreparationQueueItems` `app.js:5090-5096` → `splitRawQueueByFieldPack` `app.js:5157-5172` → `splitRawIntakeAndCleanPrep` `app.js:5100-5113` | bucket=`raw_prep` (`resolveQueueBucket`) **และ** `!(claimed_by_user_id>0 && cleaned_at)` | `buildRawQueueStatusLabel` `app.js:5174-5183` (bucket + `isRawPreparationItem`→`productionState==='collected'`) | fallthrough (ดู Q4) |
| 2 | dashboard › tab "เตรียมคอนเทนต์" › **`table-clean-prep`** | เหมือน #1 แต่ `claimed && cleaned_at` `app.js:5104-5107` | `claimed_by_user_id` + `cleaned_at` (**ไม่ใช่ production_state** — comment `app.js:5098-5099**) | label "กำลังทำ Clean" | ใช้สัญญาณ user-save ไม่ใช่ head — by design |
| 3 | dashboard › tab "เตรียมคอนเทนต์" › **`table-raw-review`** | `splitRawQueueByFieldPack` `app.js:5163` | bucket=`field_pack_review` | bucket + `isHandoffEligibleItem` `app.js:5179-5181` | — |
| 4 | dashboard › tab "เตรียมคอนเทนต์" › **`table-raw-workflow-unknown`** | `splitRawQueueByFieldPack` `app.js:5167` | bucket=`unknown_workflow` (`reportUnknownWorkflowState` `workflow-state-catalog.js:20-38`) | `getUnknownWorkflowState` | 0 item (ทุก production_state อยู่ใน `PRODUCTION_STATES` `repository.mjs:440-458`) |
| 5 | dashboard › tab "ส่งงานไปทำ" › pageMode **handoff** › `table-assignments-handoff` | `getAssignmentHandoffQueueItems` `app.js:3597-3607` → `isHandoffEligibleItem` `app.js:960-963` | bucket=`handoff` | `renderHandoffQueueStatusBadge` `app.js:2046-2047` (= `isHandoffEligibleItem`) | item-centric — OK |
| 6 | tab "ส่งงานไปทำ" › pageMode **work** › `table-assignments-work` (actionable) | `/api/assignments/mine?scope=actionable` → `buildActionableAssignmentsForActor` `index.mjs:3621-3637` | `content_assignments.state ∈ {assigned,in_progress,revision_requested}` | assignment.state | **ไม่เช็ค production_state** |
| 7 | tab "ส่งงานไปทำ" › pageMode **work** › `table-assignments-managed` | `/api/assignments/mine?scope=managed` → `buildManagedAssignmentsForActor` `index.mjs:3687-3707` (แสดงเฉพาะ owner/admin: `canSeeManagedAssignmentsTable`, gate `app.js:6275`) | `state != 'closed'` (`dropClosedAssignments`) — owner = **ทุกใบทั้งระบบ** | assignment.state | **`field:accepted` (รอบจบ) ผ่าน; ไม่เช็ค production_state** |
| 8 | tab "ส่งงานไปทำ" › pageMode **work** › `assignment-submitted-list` | `/api/assignments/mine?scope=submitted` → `buildSubmittedAssignmentsForActor` `index.mjs:3639-3652` | `state ∈ {submitted,resubmitted}` (own) | assignment.state | ไม่เช็ค production_state |
| 9 | tab "ส่งงานไปทำ" › pageMode **review** › `table-assignments-review` | `/api/assignments/mine?scope=review` → `buildReviewAssignmentsForActor` `index.mjs:3654-3685` | `state ∈ {submitted,resubmitted}`, scope ตาม management line | assignment.state | ไม่เช็ค production_state |
| 10 | Data Cleanup zone › **"งานค้างระหว่างทาง" (in-flight)** | `GET /api/items?in_flight=1` → `listInFlightItems` `repository.mjs:4383-4392` | head: `production_state ∉ {'', 'collected', 'completed'}` **AND** `publication_state != 'published'` **AND** head ต้องมี | `inFlightStalledSortValue` `app.js:2925` + age | **ตั้งใจให้ทับทุก bucket** — diagnostic, owner-only, read-only (`PROJECT_POLICY.md:151-154`) |

จุดที่อ่านจาก assignment ใบเก่า/ประวัติแทน production_state: **#6, #7, #8, #9** (assignment lists ทั้งหมด — ตัดสินจาก `content_assignments.state` ล้วน ไม่แตะ head)

หน้า single-item (ไม่ใช่ queue): `article-workspace.html`, `article-submit.html`, `article-intake.html`, `item-editor.html`, `clean-item.html` — เปิดด้วย `?id=X` ไม่ list

---

## Q4 — mutually exclusive / exhaustive?

### `resolveQueueBucket` (`app.js:747-801`) เอง

เป็น total function มี early-return ต่อเนื่อง → **คืน bucket เดียวเสมอ ต่อ 1 snapshot** → ที่ระดับ resolver: mutually exclusive + exhaustive (fallback สุดท้าย `raw_prep` `app.js:800`)

**แต่ bucket ไม่ได้เป็นฟังก์ชันของ `production_state` ตัวเดียว** — ขึ้นกับ (`production_state`, `publication_state`, `has_open_assignment`, `has_field_pack` = head `current_field_pack_id>0` OR มี field pack `is_current=1`, `field_pack_status`) ร่วมกัน

### ตาราง production_state × bucket ที่เป็นไปได้

`P` = publication_state, `O` = has_open_assignment (มี assignment state ∈ {assigned,in_progress,submitted,resubmitted,revision_requested,accepted}), `F` = has_field_pack, `R` = field_pack_status ∈ {ready_for_field, ready_for_handoff}

| production_state | published | assignment | handoff | field_pack_review | raw_prep | มีในDB (id → bucket) |
|-----------------|-----------|-----------|---------|-------------------|----------|----------------------|
| `collected` | P=published | O | — | — | ✅ else | 15,24,35 → raw_prep |
| `analyzed` | P=published | O | — | F | ✅ else | 3,9,14,17→assignment; 8,12,13,18→fpr; 2,4,5,6,7,16→raw_prep |
| `brief_generated` | P=published | O | — | F | ✅ else | (none) |
| `generated` | P=published | O | — | F | ✅ else | 19,22 → raw_prep |
| `ready_for_content` | P=published | O | F∧R | F | ✅ else | 32 → handoff |
| `field_working` | P=published | ✅ O | F∧R | F | else | 25,31,40→assignment; 30→handoff |
| `field_review` | P=published | ✅ O | F∧R | F | else | 28→assignment; 26,29→handoff; 20→raw_prep |
| `ready_for_writer` | P=published | O | F∧R | F | else | (none) |
| `writing_assigned` | P=published | ✅ O | F∧R | F | else | 27→assignment; 21→raw_prep |
| `writing` | P=published | O | F∧R | F | else | (none) |
| `content_in_progress` | ✅ (rule4) | O (rule3 ก่อน) | — | — | — | (none) |
| `in_review` | ✅ (rule4) | ✅ O (rule3 ก่อน) | (rule4 บัง rule5) | — | — | 39→assignment |
| `needs_revision` | ✅ (rule4) | O | — | — | — | (none) |
| `ready_for_publish` | ✅ (rule4) | O | (บัง) | — | — | (none) |
| `submitted_for_admin_review` | ✅ (rule4) | O | (บัง) | — | — | (none) |
| `rejected` | P | O | — | F | ✅ else | (none) |
| `completed` | ✅ (rule2, ก่อน O) | — | — | — | — | 23→published |

### ทับกัน (คู่ production_state → หลาย bucket ได้)

- `analyzed` → {assignment, field_pack_review, raw_prep}
- `generated` → {raw_prep, field_pack_review, assignment, handoff*}
- `field_working` → {assignment, handoff, field_pack_review, raw_prep}
- `field_review` → {assignment, handoff, field_pack_review, raw_prep}
- `writing_assigned` → {assignment, handoff, field_pack_review, raw_prep}
- `ready_for_content` → {handoff, field_pack_review, assignment, raw_prep}
- `in_review` → {assignment, published}

→ bucket **ไม่** ถูกกำหนดโดย production_state; ตัวแปรตัดสินจริงคือ `has_open_assignment` (rule3, `app.js:765`) กับ `has_field_pack`/`field_pack_status`

### ตกหล่น

- **ไม่มี production_state ค่าไหนที่ route ไม่ได้** — `raw_prep` เป็น catch-all (`app.js:800`) → exhaustive: **ใช่**
- ผลข้างเคียง: production_state ที่ล้ำ pipeline แล้ว (`generated`/`field_review`/`writing_assigned`) แต่ไม่มี field pack + ไม่มี open assignment → **หล่นเข้า `raw_prep` = ตาราง "Raw Intake"** (ดู Q5)

---

## Q5 — บน DB จริง: item ที่แสดง >1 จุด หรือผิดจุด

### A. แสดง >1 จุด (ข้ามตาราง — ไม่นับตาราง in-flight diagnostic #10)

ทั้งหมดอยู่ในกรณีเดียว: **pageMode "work" ของ owner/admin แสดง `table-assignments-work` (actionable) + `table-assignments-managed` พร้อมกัน** และ assignment ใบเดียวกันเข้าเกณฑ์ทั้งสองตาราง (managed = ทุกใบ non-closed, actionable = subset)

| item | production_state | actionable table | managed table (owner) | แถวส่วนเกินมาจาก |
|------|-----------------|------------------|----------------------|-----------------|
| #3 | analyzed | `editorial#1` | `editorial:assigned#1` | ใบเดียวกัน 2 ตาราง |
| #9 | analyzed | `editorial#4` | `editorial:revision_requested#4` **+ `field:accepted#2`** | ใบเดียวกัน 2 ตาราง **+ field รอบจบ #2 เกินมาใน managed** |
| #14 | analyzed | `field#5` | `field:assigned#5` | ใบเดียวกัน 2 ตาราง |
| #17 | analyzed | `editorial#12` | `editorial:in_progress#12` | ใบเดียวกัน 2 ตาราง |
| #25 | field_working | `field#6` | `field:in_progress#6` | ใบเดียวกัน 2 ตาราง |
| #27 | writing_assigned | `editorial#9` | `editorial:assigned#9` **+ `field:accepted#8`** | ใบเดียวกัน 2 ตาราง **+ field รอบจบ #8 เกินมาใน managed** |
| #28 | field_review | (review pageMode: `field#21`) | `field:submitted#21` | ใบเดียวกัน review + managed |
| #31 | field_working | `field#25` | `field:revision_requested#25` | ใบเดียวกัน 2 ตาราง |
| #39 | in_review | (review pageMode: `editorial#39`) | `editorial:submitted#39` **+ `field:accepted#29`** | review + managed **+ field รอบจบ #29 เกินมาใน managed** |
| #40 | field_working | `field#30` | `field:in_progress#30` | ใบเดียวกัน 2 ตาราง |

**รวม: 10 item** แสดงซ้ำข้ามตารางใน 1 pageMode. ในนั้น **3 item (#9, #27, #39)** มีแถว `field:accepted` (รอบภาคสนามที่จบแล้วตาม `PROJECT_POLICY.md:564`) เกินมาในตาราง managed คู่กับงาน editorial ปัจจุบันของ item เดียวกัน

หมายเหตุ: dashboard queue (#1–5) กับ assignment panel (#6–9) **ไม่ทับกันที่ระดับ item** — bucket `handoff`/`raw_prep`/`field_pack_review` ต้องมี `has_open_assignment=false` (rule3 `app.js:765` ดักไปก่อน) จึงไม่มี assignment non-closed ให้โผล่ใน 6–9. ยกเว้นตาราง in-flight (#10) ที่ตั้งใจทับ **29/33 item**

### B. แสดงผิดจุด (จุดเดียว แต่ผิด)

| item | production_state (head) | ควรอยู่ | ระบบแสดงจริง | สาเหตุ (บรรทัด) |
|------|------------------------|---------|--------------|----------------|
| #19 | `generated` | field pack review / raw คัด AI | **`table-raw-intake`** | `resolveQueueBucket` fallthrough `app.js:797-800` — ไม่มี field pack ptr + editorial#13 `closed` → raw_prep |
| #20 | `field_review` | handoff / งานภาคสนาม | **`table-raw-intake`** | เหมือนบน — editorial#14 `closed`, ไม่มี field pack |
| #21 | `writing_assigned` | งานเขียน (assignment) | **`table-raw-intake`** | เหมือนบน — editorial#15 `closed`, ไม่มี field pack |
| #22 | `generated` | field pack review | **`table-raw-intake`** | เหมือนบน — editorial#16 `closed` |
| #9 | `analyzed` (ถอยจาก writing) | ก่อนขั้น field pack | **bucket `assignment`** (ไม่โชว์ dashboard) + assignment panel actionable/managed | `has_open_assignment` มาจาก `editorial:revision_requested#4` ที่ค้างหลัง `field_pack_return_to_clean`/`place_backward_in_process` (ไม่ปิด assignment); `resolveItemScopeContext` `index.mjs:4003, 4016` ไม่เช็ค production_state |
| #3, #14, #17 | `analyzed` | ก่อน/ต้นขั้น | assignment panel (จาก assignment ที่ค้าง ขณะ head ยัง analyzed) | assignment สร้างไว้ตั้งแต่ analyzed, head ไม่ขยับ; assignment list ไม่เช็ค head |

**รวม B: 4 item (#19–22)** แสดงในตาราง Raw Intake ทั้งที่ production_state ล้ำไปแล้ว + **4 item (#3, #9, #14, #17)** ถูกจัด bucket `assignment` / แสดงใน assignment panel จาก assignment ที่ค้างขณะ head อยู่ที่ `analyzed`

### สรุปตัวเลข Q5

- ซ้ำข้ามตาราง (owner work pageMode): **10 item**; ในนั้นมีแถว field:accepted รอบจบเกินมา: **3 item** (#9, #27, #39)
- แสดงผิดจุด (Raw Intake ทั้งที่ production ล้ำ): **4 item** (#19, #20, #21, #22)
- bucket=assignment จาก assignment ค้างขณะ head=analyzed: **4 item** (#3, #9, #14, #17)
- ตาราง in-flight diagnostic (ตั้งใจทับ): **29 item**

---

## Q6 — item ที่ workflow head หาย/NULL

- **DB จริง: 0 item** — LEFT JOIN `content_items` ↔ `content_workflow_models` ไม่มีแถว head เป็น NULL เลย (ทั้ง 33 item มี head)
- fallback ถ้าเกิดขึ้น:
  - **server**: `ensureWorkflowModel` `repository.mjs:4942-4950` **throw `workflow head missing for item {id}`** — ไม่สร้าง head; `upsertWorkflowModel` `repository.mjs:4956-4958` ก็ throw → ทุก endpoint ที่แตะ head (article-process, transitions, field pack) จะ 500
  - `listItemsByStatus` `repository.mjs:~4377` และ `listInFlightItems` `repository.mjs:4386` (`if (!head) return false`) — **กรอง head-less ออก**
  - `listItems()` (default `/api/items`) ใช้ `SELECT i.* LEFT JOIN` `repository.mjs:2922` → **ไม่กรอง** → head-less item ยังถูกส่งไป client โดย `production_state = null`
  - **client**: `getItemWorkflowSnapshot` `app.js:713` → `productionState = ""` → `resolveQueueBucket`: `getUnknownWorkflowState` คืน `null` (state ว่างถูก `continue` ที่ `workflow-state-catalog.js:31`) → ไม่ published → (`assignment` ถ้ามี open assignment) → ไม่ pub2 → handoff ไม่แมตช์ (`""` ไม่อยู่ในลิสต์) → (`field_pack_review` ถ้ามี field pack) → **`raw_prep`** (`app.js:800`)
- head หายจึง **ไม่** ตกเข้า `unknown_workflow` — ตกเข้า `raw_prep` (หรือ `assignment`/`field_pack_review` ตาม flag อื่น)

---

## ตัวเลือก + ผลกระทบ (ไม่ใช่คำแนะนำ — ผู้ตัดสินเลือกเอง)

### ปัญหา 1 — ตาราง actionable + managed แสดง assignment ใบเดียวกันซ้ำ (10 item)
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| A1 ปล่อยเดิม | ตาราง managed เป็น superset ของ actionable โดยตั้งใจ (owner เห็นทั้งหมด) — ผู้ใช้ต้องเข้าใจเอง |
| A2 ตัด managed ไม่ให้รวมใบที่อยู่ใน actionable แล้ว (client-side diff) | actionable + managed = partition; แตะแค่ `app.js` (renderManagedAssignmentsTable). เสี่ยง: ถ้า pageMode/role ต่างกันเห็นไม่ครบ |
| A3 รวมเป็นตารางเดียว มีคอลัมน์ "บทบาทของฉัน" | แตะ HTML + app.js เยอะ; กระทบ pageMode DOM split ที่เพิ่ง sanctioned |

### ปัญหา 2 — `field:accepted` (รอบจบ) โผล่ในตาราง managed/mine (3 item)
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| B1 ปล่อยเดิม | ขัด `PROJECT_POLICY.md:564,568` โดยพฤตินัย (รอบจบไม่ควร shadow งานปัจจุบัน) |
| B2 `dropClosedAssignments` → กรอง `field` + `accepted` ออกด้วย (`index.mjs:3614-3618`) | assignment list สะอาด; เสี่ยง: จุดอื่นที่เรียก `dropClosedAssignments` อาจต้องการเห็น accepted (ต้อง audit ทุก caller ก่อน) |
| B3 เพิ่ม filter เฉพาะ managed/mine ไม่แตะ `dropClosedAssignments` กลาง | blast radius แคบกว่า; ต้องแก้ 3–4 จุด (`buildManagedAssignmentsForActor`, default path ×2) |

### ปัญหา 3 — item แสดงผิดจุด (Raw Intake ทั้งที่ production ล้ำ) (#19–22)
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| C1 ปล่อยเดิม | item ค้างในตารางผิด ผู้ตรวจไม่เห็นว่าอยู่ขั้นไหนจริง |
| C2 `resolveQueueBucket` เพิ่ม branch: ถ้า production_state ล้ำ `analyzed` แต่ไม่มี field pack + ไม่มี open assignment → bucket ใหม่/`unknown_workflow` | ทำให้ #19–22 เด้งเข้าตาราง "ผิดปกติ"; แตะ `app.js:797-800` เท่านั้น. ต้องนิยาม bucket/behavior ให้ชัด |
| C3 แก้ข้อมูล: คืน field pack pointer / ปิด assignment ที่ค้าง / ถอย production_state ให้ตรง | แก้เฉพาะ 4 item ไม่แก้ logic — เกิดซ้ำได้ถ้า backward transition ยังไม่ปิดของครบ |

### ปัญหา 4 — assignment list ไม่ reconcile กับ production_state (#3, #9, #14, #17)
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| D1 ปล่อยเดิม | assignment ค้างแสดงเป็นงาน active ตลอดไปแม้ head ถอยกลับ |
| D2 assignment list builders กรอง item ที่ head ไม่อยู่ในขั้นที่รับ assignment kind นั้น (`index.mjs:3621, 3654, 3687`) | list ตรงกับ workflow; ต้อง join head ต่อ assignment (perf + ต้องนิยาม mapping kind→production_state) |
| D3 backward transition ปิด assignment ทุก kind ที่ค้าง (ขยาย `index.mjs:9248` auto-close ให้ครอบ `field_pack_return_to_clean` / deep `place_backward_in_process`) | แก้ที่ต้นเหตุ; blast radius กว้าง — ต้อง audit ก่อนเขียน (ดู `audit/assignment-open-selection-audit.md`) |

### ปัญหา 5 — `content_items.workflow_status` legacy column ยังส่งค่าค้างไป client
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| E1 ปล่อยเดิม | ไม่มี consumer วันนี้ แต่เป็น landmine (dev อาจหยิบไปใช้เพราะชื่อชวนเชื่อ) |
| E2 `mapItem` `repository.mjs:2701` ตัด key `workflow_status` ทิ้งก่อนส่ง | payload สะอาด; แตะจุดเดียว; ต้อง grep ยืนยันไม่มี consumer (ตอนนี้ = ไม่มี) |
| E3 migration DROP COLUMN ใน DB จริง | ถาวร; owner-managed; ต้อง backup |

### ปัญหา 6 — acceptance "item อยู่ที่เดียว" ไม่มีใน policy
| ตัวเลือก | ผลกระทบ |
|---------|---------|
| F1 ปล่อยเดิม | ไม่มีเกณฑ์กลาง แต่ละ dev ตีความเอง |
| F2 เขียนลง `PROJECT_POLICY.md` (นิยาม "จุดเดียว" ให้ชัด: dashboard bucket เป็น partition, assignment panel = assignment-centric, in-flight = diagnostic ยกเว้น) | มีสัญญาให้ audit ต่อได้; ต้องตัดสินก่อนว่า in-flight/managed นับเป็นข้อยกเว้นหรือละเมิด |
