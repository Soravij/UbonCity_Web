# Audit — Bug B: `has_open_assignment` ไม่นับ field assignment

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web`
- Mode: READ-ONLY. ไม่แก้โค้ด ไม่ commit ไม่รัน gate/test
- DB: `collector/data/collector.db` (live, 27 MB, mtime 2026-08-27 21:18 — ยืนยันเป็นตัวที่ collector ใช้: `config/paths.mjs:9` + `ops/windows/test-stack.ps1:288` WorkDir=`collector/`)
- Sub agents: `audit-scanner` (เสร็จ, ผลตรงกับการไล่โค้ดเอง). ไม่เรียก `audit-deep-reasoner` — ไล่ call chain จบครบทั้ง 5 ข้อพร้อม DB history แล้ว
- Method: static code read + query workflow_transitions บน DB จริง

---

## Q1 — `has_open_assignment` คำนวณจากอะไร กรองอะไร ตัด field ตรงไหน

**ไม่ใช่ SQL query เลย — เป็น JS ที่หยิบ assignment "ใบเดียว" มาเช็ค state**

1. `resolveItemScopeContext(item)` — `collector/server/index.mjs:3992-4018`
   - `collector/server/index.mjs:3999-4000` — `editorialAssignments` = กรอง `assignment_kind === "editorial"`
   - `collector/server/index.mjs:4001` — `activeEditorialAssignment = selectPrimaryEditorialAssignment(editorialAssignments)`
   - `collector/server/index.mjs:4002` — `openAssignment = selectPrimaryOpenAssignment(listAssignments)` (ทุก kind)
   - **`collector/server/index.mjs:4003`** — `primaryAssignment = activeEditorialAssignment || openAssignment || listAssignments[0]`
   - `collector/server/index.mjs:4016` — `hasOpenAssignment: hasOpenAssignment(primaryAssignment)`
2. ส่งออก response ที่ `collector/server/index.mjs:4038` (`attachItemScopeMetadata`) และ `:1403` (`attachWorkflowHeadFields`) และ `:1344` (list decoration อ่านค่าที่ตั้งไว้แล้ว)
3. `hasOpenAssignment()` — `collector/services/publishable-assignment-candidate.mjs:68-71`
   - state set — `collector/services/publishable-assignment-candidate.mjs:64-66` =
     `{assigned, in_progress, submitted, resubmitted, revision_requested, accepted}`
   - **ไม่มีการกรอง `assignment_kind` เลย** — ผลลัพธ์ขึ้นกับว่า "ใบไหน" ถูกส่งเข้ามา
4. `selectPrimaryEditorialAssignment()` — `collector/server/index.mjs:4638-4642`
   - active states = `{assigned, in_progress, submitted, resubmitted, revision_requested}` — **ไม่รวม `accepted`, ไม่รวม `closed`**
5. `selectPrimaryOpenAssignment()` — `collector/server/index.mjs:3981-3990`; priority — `:3972-3979` =
   `[revision_requested, in_progress, assigned, resubmitted, submitted, accepted]` (ทุก kind, ไม่รวม closed)

**จุดที่ field ถูก "ตัดทิ้ง": `collector/server/index.mjs:4003`** — ถ้า `activeEditorialAssignment` ไม่เป็น null
(มี editorial ใบใดใน state active อยู่) `primaryAssignment` จะเป็น editorial ทันที field assignment
ไม่มีทางถูกส่งเข้า `hasOpenAssignment()` เลย ต่อให้ field ยัง `accepted`/`in_progress` อยู่จริง
field จะถูกพิจารณาก็ต่อเมื่อ editorial ทุกใบเป็น `closed` หรือ `accepted` (fallthrough ไป `selectPrimaryOpenAssignment` ที่ `:4002`)

> หมายเหตุ: ฝั่ง repository มี guard คนละตัว `assertNoOpenFieldRound` (`collector/db/repository.mjs:5251-5263`)
> ที่ OPEN_FIELD_ROUND_STATES (`:1019-1026`) **รวม `accepted`** — คนละนิยาม "open" กับที่ UI ใช้ก็จริง แต่ตรงกัน

---

## Q2 — `ensureArticleProcessTransitionAccess` หยิบ assignment ใบไหน มี ORDER BY/LIMIT ไหม

`ensureArticleProcessTransitionAccess` — `collector/server/index.mjs:4204-4225`

- **ตัวฟังก์ชันนี้ไม่ได้ "หยิบใบเดียว" เลย** ไม่มี pick / ORDER BY / LIMIT
- `nextStatus === "ready_for_review"` → `hasEditorialAssignmentAccess(req, item, {submitted, resubmitted})` — `:4218`
- อื่น ๆ → `ensureArticleComposerEditAccess` (`:4185-4202`) → `hasEditorialAssignmentEditAccess` (`:4117-4119`)
  → `hasEditorialAssignmentAccess(req, item, {assigned, in_progress, revision_requested})`
- `hasEditorialAssignmentAccess` — `collector/server/index.mjs:4121-4132`
  - `repo.listAssignmentsByItem(itemId)` แล้ว **`.some()`** ว่ามีใบใด `assignment_kind === "editorial"`
    `&& assignee_user_id === actorId && allowedStates.has(state)` — เป็นการเช็ค "มีอย่างน้อยหนึ่ง" ไม่ต้องเรียงลำดับ
  - **กรอง editorial เท่านั้น — field ไม่ถูกพิจารณาเลย** ในจุดนี้

**จุดที่ "หยิบใบเดียว" จริง ๆ อยู่ใน `transitionArticleProcessState`** (`collector/server/index.mjs:4227+`):
- `getPrimaryEditorialAssignment(itemId)` ที่ `:4231` และ `:4264`
- `getPrimaryEditorialAssignment` — `:4644-4646` → `selectPrimaryEditorialAssignment(listEditorialAssignmentsByItem(itemId))`
  → **`.find()` เอาใบแรก** ของ `listAssignmentsByItem`
- `listAssignmentsByItemStmt` — `collector/db/repository.mjs:3791-3795`:
  `... WHERE a.content_item_id=? ORDER BY a.id DESC`
- **มี ORDER BY `a.id DESC`** — ลำดับ deterministic (id เป็น INTEGER PRIMARY KEY AUTOINCREMENT)
  ถ้ามี editorial active หลายใบ ใบ id สูงสุด (ใหม่สุด) ชนะเสมอ ไม่ใช่ rowid-order nondeterminism

---

## Q3 — ใบที่สองเกิดจาก path ไหน call site ที่ INSERT + จุดที่ควรมีเช็คแต่ไม่มี

**INSERT statement มีที่เดียว**: `insertAssignmentStmt` — `collector/db/repository.mjs:3759-3764`
รันจาก `createAssignment` — `collector/db/repository.mjs:5265-5345` (`.run()` ที่ `:5311`) เท่านั้น

**Guard ใน `createAssignment`** — `collector/db/repository.mjs:5299-5301`:
```
if (assignmentKind === "field") {
  assertNoOpenFieldRound(contentItemId);
}
```
**ไม่มี branch สำหรับ `editorial` และไม่มีเช็คข้าม kind** — นี่คือบรรทัดที่ "ควรมีเช็คแต่ไม่มี"

### call site ทั้งหมดที่สร้าง assignment

| # | path | endpoint | kind | เช็คใบเปิดก่อน insert? |
|---|------|----------|------|----------------------|
| a | `createAssignmentWithWorkflow` (`repository.mjs:5347-5368`) ← `index.mjs:10509` | `POST /api/items/:id/article-editorial-assignments` (`index.mjs:10409`) | editorial | **เช็คเฉพาะ editorial ใบอื่น** ที่ `index.mjs:10458` (`getPrimaryEditorialAssignment`) → 409 ถ้าไม่ส่ง `replace_active=true` (`:10473-10483`). **ไม่เช็ค field ที่เปิดอยู่** |
| b | `createAssignmentFromReadiness` (`repository.mjs:9071-9124`) ← `index.mjs:10274`, `index.mjs:10712` | `POST /api/items/:id/assignments` (field branch `:10705`) / readiness route | field | **เช็ค** — `assertNoOpenFieldRound` ที่ `repository.mjs:9084` + อีกครั้งใน `createAssignment:5300` |
| c | `repo.createAssignment` โดยตรง — `index.mjs:10729` | `POST /api/items/:id/assignments` (else branch เมื่อ kind ≠ "field", `:10728`) | editorial (หรืออื่น) | **ไม่มีเช็คใด ๆ** |

### editorial กับ field ใช้คนละ path

- **field**: b เท่านั้น → ผ่าน `assertNoOpenFieldRound` เสมอ → กัน "field round เปิดซ้อน" ได้จริง
- **editorial**: a (เช็คแค่ editorial-vs-editorial) หรือ c (ไม่เช็คเลย)
- **ไม่มี path ใดกันการสร้าง editorial ขณะที่ field ยังเปิด (`accepted`/อื่น) อยู่** และในทางกลับกัน
  `assertNoOpenFieldRound` ก็ไม่กันการสร้าง field ใหม่ตอนที่มี editorial เปิดอยู่

### ยืนยันจาก DB (workflow_transitions, scope='assignment')

- **item 27**: aid 8 `submitted→accepted` (field) เวลา `2026-08-15 16:12:27` → aid 9 `→assigned`
  reason `article_editorial_assignment_created` เวลาเดียวกัน → production `field_review→writing_assigned`
  ⇒ ใบที่สอง = editorial ผ่าน path **a**
- **item 39**: aid 29 `resubmitted→accepted` (field, round 6) `2026-08-27 14:44:18` → aid 39 `→assigned`
  `article_editorial_assignment_created` `14:44:27` (ห่าง 9 วินาที) ⇒ ใบที่สอง = editorial ผ่าน path **a**

### schema — ไม่มี constraint กันซ้ำ

`collector/database/schema.sql:1004-1038` — `content_assignments`:
- `assignment_kind TEXT NOT NULL DEFAULT 'field'`, `state TEXT NOT NULL DEFAULT 'assigned'`
- index: `idx_content_assignments_item (content_item_id, created_at DESC)` (`:1036`),
  `_assignee (assignee_user_id, state, updated_at DESC)` (`:1037`), `_state (state, updated_at DESC)` (`:1038`)
- **ไม่มี UNIQUE / partial index บน `(content_item_id, assignment_kind)` แบบกรอง open state**

---

## Q4 — DB จริง: กี่ item มี assignment เปิดพร้อมกัน >1 ใบ

นิยาม "เปิด" = `state != 'closed'` (นับ `accepted` เป็นเปิด ตาม `OPEN_ASSIGNMENT_STATES` และ `OPEN_FIELD_ROUND_STATES`)

**3 items** — ทุกใบเป็นคู่ **1 field + 1 editorial** (ไม่มีเคส 2 editorial หรือ 2 field เปิดพร้อมกัน):

| item | คู่ที่เปิด (kind:state#id) | production_state | ประเมิน |
|------|---------------------------|-----------------|---------|
| **9**  | `field:accepted#2` + `editorial:revision_requested#4` | **`analyzed`** | **ขยะค้าง** — `field_pack_return_to_clean` (transitions 2026-08-03) เดิน production ถอยจาก `writing` → `analyzed` และ `place_backward_in_process` (2026-08-15) ถอยอีก แต่ **ไม่ปิด** aid 2 / aid 4 เลย. assignment ค้างขณะ item อยู่ก่อนขั้น field pack |
| **27** | `field:accepted#8` + `editorial:assigned#9` | `writing_assigned` | **ปกติของ workflow** — field accept → assign editor → writing_assigned (transitions 7-9 ต่อเนื่อง). field:accepted คือ §7A accepted baseline ที่คงอยู่ระหว่างเขียน |
| **39** | `field:accepted#29` (round 6) + `editorial:submitted#39` | `in_review` | **ปกติของ state** — บทความเขียนเสร็จ ส่งตรวจแล้ว, field round เป็น baseline. editorial ที่ปิด #31-38 (8 ใบ) คือ `closed_by_backward_transition` จากวน `place_backward_in_process` ซ้ำ ๆ — audit trail ไม่ใช่ขยะ |

**สรุป Q4**: การมี "2 ใบเปิด (field+editorial)" ตัวมันเอง = by design (field baseline + งานเขียน) —
ไม่ผิดในตัว. item 27, 39 ถูกต้อง. **มี 1 item (item 9) ที่เป็นขยะจริง** เพราะ production ถอยกลับโดยไม่ปิด assignment

---

## Q5 — ถ้ามีทั้ง editorial + field พร้อมกัน ใครชนะโดยพฤตินัย ในแต่ละจุด

| จุด | เกณฑ์ที่ใช้ | ใครชนะเมื่อ field+editorial เปิดพร้อมกัน |
|-----|-----------|----------------------------------------|
| **`has_open_assignment`** (`index.mjs:4003`, `:4016`) | `activeEditorialAssignment \|\| openAssignment \|\| listAssignments[0]` แล้วเช็ค state ของ **ใบเดียว** | **editorial ชนะ** ถ้ามี editorial ใน `{assigned,in_progress,submitted,resubmitted,revision_requested}`. field ชนะเฉพาะเมื่อ editorial ทุกใบ `closed`/`accepted` |
| **transition access** (`ensureArticleProcessTransitionAccess` `:4204`, `hasEditorialAssignmentAccess` `:4121`) | `.some()` เฉพาะ `assignment_kind === "editorial"` ของ actor ใน allowed state | **editorial เท่านั้น** — field ไม่ถูกมองเลย ไม่มีแนวคิด "ผู้ชนะ" เป็นแค่ผ่าน/ไม่ผ่าน |
| **queue/bucket filter** (`resolveQueueBucket` `app.js:747`, ใช้ที่ `:765`) | อ่าน field `has_open_assignment` จาก response ตรง ๆ | **ตามข้อ 1 ทุกประการ** (editorial-preferred). branch `handoff` (`app.js:779-796`) แยกต่างหาก คีย์จาก `production_state` + field pack pointer ไม่ใช่ assignment kind |

### สามจุดใช้เกณฑ์เดียวกันไหม — **ไม่**

- **จุด 1 (`has_open_assignment`) กับ จุด 3 (queue bucket) ใช้เกณฑ์เดียวกันเป๊ะ** — queue อ่าน flag ที่ server คำนวณ
  (`/api/items` → per-item `resolveItemScopeContext` → `attachItemScopeMetadata`, `index.mjs:8004-8011`)
- **จุด 2 (transition access) ต่าง** — แคบกว่า: editorial-kind เท่านั้น, ไม่ pick ใบเดียว (ใช้ `.some()`),
  ไม่สน field, ไม่สน `accepted` (allowed states ไม่รวม accepted)

### เกี่ยวกับ backlog 4 — "item หลุดคิวก่อน assign เสร็จ"

- filter คิว (จุด 3) กับ flag (จุด 1) **เป็นตัวเดียวกัน** ⇒ item จะไม่หลุด bucket "assignment" เพียงเพราะมี 2 kind เปิด
  ตราบใดที่ `primaryAssignment` resolve เป็นแถวที่ state เปิด
- ช่องโหว่จริง: `hasOpenAssignment` สะท้อน state ของ **assignment ใบเดียว** ถ้า primary = editorial ที่ `closed`
  แต่ field ยัง `accepted` (หรือกลับกัน) flag จะสะท้อนแค่ primary. `selectPrimaryOpenAssignment` (`:4002`)
  มักช่วยจับ field:accepted ไว้ได้ก่อน fallthrough ไป `listAssignments[0]` — แต่ถ้า newest-id เป็น closed
  และไม่มีใบเปิดเลยในสายตา priority list ก็จะได้ closed → flag = false → **หลุดคิว**
- item 9 ตอนนี้: primary = `editorial:revision_requested#4` → flag = **true** → item ยังค้างอยู่ในคิว "assignment"
  ทั้งที่ production = `analyzed` (ควรอยู่ก่อนขั้น field pack) — คือ **ค้างในคิวผิดที่** ไม่ใช่หลุดคิว
- ความไม่ตรงกันจุด 1↔จุด 2: editor อาจเห็น item `has_open_assignment=true` (จาก field:accepted)
  แต่กด article-process transition ไม่ได้ (403) เพราะไม่มี editorial assignment ใน state ที่ต้องการ —
  flag กับ access check "ไม่เห็นตรงกัน" ว่า item นี้ assign เสร็จหรือยัง

---

## ตัวเลือกที่เป็นไปได้ + ผลกระทบ (ไม่ใช่คำแนะนำ — ผู้ตัดสินเลือกเอง)

### A. ปล่อยตามเดิม (2 ใบเปิด = by design)
- ผล: ไม่ต้องแตะโค้ด. item 9 ยังค้างในคิว "assignment" ต่อไป. flag/access ยังไม่ตรงกัน.
  เสี่ยงเกิด item-9-แบบใหม่ทุกครั้งที่มี backward transition นอกเส้นทาง auto-close

### B. เพิ่ม cross-kind guard ตอนสร้าง editorial (`repository.mjs:5299` / `index.mjs:10458`)
- บล็อกการสร้าง editorial ถ้ายังมี field เปิด (บังคับปิด field ก่อน)
- ผล: item 27/39 flow ปัจจุบัน (field:accepted → สร้าง editorial ทันที) **จะพัง** เว้นแต่เพิ่มการปิด field
  อัตโนมัติในจังหวะเดียวกัน. กระทบ `POST article-editorial-assignments` โดยตรง — เป็น freeze rule "API endpoints"
- ต้องนิยามให้ชัดว่า field:accepted ควร `closed` เมื่อ editorial ถูกสร้าง หรืออยู่ต่อในฐานะ baseline

### C. ให้ `has_open_assignment` เป็น aggregate (มีใบเปิด ≥1 ใบ ไม่ว่า kind ใด) แทนการเช็ค primary ใบเดียว
- แก้ที่ `index.mjs:4016` — `hasOpenAssignment` รับ list ทั้งหมด
- ผล: item 9 ยัง true (ยังไม่หลุด). queue bucket ยังเหมือนเดิมเป็นส่วนใหญ่.
  แต่ item ที่ field ปิดแล้ว-editorial ปิดแล้ว-มี in_progress ค้าง จะไม่หลุดคิวอีก
- ไม่ช่วยเรื่อง flag↔transition-access ยังไม่ตรงกัน (จุด 2 ยังแยก)

### D. auto-close assignment ทุก kind เมื่อ production ถอยไปก่อนขั้นนั้น (ขยาย `index.mjs:9248` ให้ครอบ `field_pack_return_to_clean` / `place_backward_in_process` ที่ถอยลึก)
- ผล: กัน item-9 ในอนาคต. ต้องระวังไม่ปิด field:accepted ที่เป็น §7A baseline โดยไม่ตั้งใจ
  (policy `PROJECT_POLICY.md:564` — accepted field round ห้ามถูก reopen/เขียนทับ; ปิดเป็นหลักฐานได้)
- แตะ backward-transition logic — blast radius กว้าง ควร audit ก่อนเขียน

### E. ทำความสะอาด item 9 ครั้งเดียว (ปิด aid 2 + aid 4 ผ่าน flow ปกติ) โดยไม่แตะโค้ด
- ผล: item 9 ออกจากคิวผิดที่. ไม่แก้สาเหตุ — ถ้ามี backward transition แบบเดิมอีกก็เกิดซ้ำ

### F. รวมเกณฑ์จุด 2 ให้สอดคล้องกับจุด 1/3 (ให้ transition access ยอมรับ field state ด้วย หรือให้ flag เป็น editorial-only)
- ผล: flag กับ "assign เสร็จหรือยัง" หมายความตรงกัน. ต้องเลือกว่า "assign เสร็จ" = มี editorial active
  (flag ควรแคบลง) หรือ = มีใบใดเปิด (access ควรกว้างขึ้น — เสี่ยงให้ editor ที่ยังไม่ถูก assign กด transition ได้)

---

## ข้อสังเกตเพิ่มเติม (undocumented contract)

- `OPEN_FIELD_ROUND_STATES` (`repository.mjs:1019-1026`, รวม `accepted`) กับ `OPEN_ASSIGNMENT_STATES`
  (`publishable-assignment-candidate.mjs:64-66`, รวม `accepted`) กับ `selectPrimaryEditorialAssignment`
  active states (`index.mjs:4639`, **ไม่รวม `accepted`**) — สาม set นิยาม "assignment ที่ยัง active/open"
  ต่างกัน ไม่มี policy doc กล่าวถึงความต่างนี้
- `PROJECT_POLICY.md:567` / `PROJECT_STATE.md:326` ระบุแค่ "one open **field** round per item" —
  ไม่มีข้อความว่า editorial + field เปิดพร้อมกันถือว่าถูกต้องหรือไม่ และไม่มีที่ไหนบอกว่า flag
  `has_open_assignment` สะท้อน "assignment ใบเดียวที่ editorial ได้สิทธิ์ก่อน" ไม่ใช่ "มีงานค้างหรือไม่"
