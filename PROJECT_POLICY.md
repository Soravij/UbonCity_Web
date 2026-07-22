# UbonCity Project Policy

This document is the root single source of truth for project-wide policy. Every section is written in
English and Thai together, in the same section — the two languages are not split into separate files or
separate documents. English is the normative text; Thai carries the same meaning in natural, readable
Thai (not a literal word-for-word gloss). When policy changes, both languages must be updated in the
same edit — see §11.

เอกสารนี้คือแหล่งอ้างอิงหลัก (single source of truth) ของนโยบายทั้งโปรเจกต์ในระดับราก (root) ทุก section
มีเนื้อหาภาษาอังกฤษและภาษาไทยอยู่ด้วยกันใน section เดียวกัน ไม่แยกคนละไฟล์หรือคนละเอกสาร
ภาษาอังกฤษถือเป็นข้อความหลัก (normative) ส่วนภาษาไทยแปลความหมายให้ตรงและอ่านง่าย ไม่ใช่แปลคำต่อคำจนกำกวม
เมื่อแก้ไขนโยบายต้องแก้ทั้งสองภาษาพร้อมกันในการแก้ไขครั้งเดียวกัน — ดู §11

## 1. Product / Scope Policy

**English**

- UbonCity is a tourism/content platform for Ubon Ratchathani.
- Components:
  - frontend: public Next.js website
  - backend: Express/API and public media serving
  - admin: back-office/admin panel
  - collector: internal ingest/workflow/AI preparation tool
- Collector is an internal workflow tool, not a public asset server.
- Backend/public storage is the source for published public media.

**ภาษาไทย**

- UbonCity คือแพลตฟอร์มเนื้อหา/ท่องเที่ยวสำหรับจังหวัดอุบลราชธานี
- องค์ประกอบของระบบ:
  - frontend: เว็บไซต์สาธารณะที่สร้างด้วย Next.js
  - backend: ระบบ Express/API และการให้บริการสื่อสาธารณะ
  - admin: แผงควบคุมฝ่ายจัดการ/หลังบ้าน
  - collector: เครื่องมือภายในสำหรับรับข้อมูล/workflow/เตรียมข้อมูลให้ AI
- Collector เป็นเครื่องมือ workflow ภายในเท่านั้น ไม่ใช่ตัวให้บริการไฟล์สื่อสาธารณะ
- backend และพื้นที่จัดเก็บสาธารณะ (public storage) คือแหล่งข้อมูลของสื่อที่เผยแพร่จริง

## 2. Role / Permission Policy

**English**

- Owner has global visibility/management.
- Admin/user visibility may be scoped by assignment, claim, or workflow.
- Claimed work should not accidentally appear to unrelated users/admins unless policy explicitly allows it.
- Raw pool first-claim behavior is allowed for eligible unclaimed raw items.

Placeholders:

- Detailed owner/admin/user capability matrix: TBD / update later.
- Reviewer/operator policy: TBD / update later.

**ภาษาไทย**

- Owner มองเห็นและจัดการได้ทั้งระบบ (global visibility/management)
- การมองเห็นของ Admin/user อาจถูกจำกัดขอบเขตตาม assignment, การ claim งาน หรือ workflow
- งานที่ถูก claim แล้วไม่ควรไปปรากฏให้ user/admin ที่ไม่เกี่ยวข้องเห็นโดยไม่ตั้งใจ เว้นแต่ policy จะอนุญาตไว้ชัดเจน
- การ claim งานดิบ (raw pool) แบบ first-claim ทำได้เฉพาะรายการดิบที่ยังไม่มีใคร claim และเข้าเงื่อนไข

ส่วนที่ยังไม่กำหนด (Placeholders):

- ตารางสิทธิ์ (capability matrix) ของ owner/admin/user แบบละเอียด: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบายของ reviewer/operator: ยังไม่กำหนด (TBD) / ทำภายหลัง

## 2A. Revision Asset Replacement Policy

**English**

- Retain prior media across revision requests until it is replaced by a new upload for the same slot or removed by a matching reset.
- New upload for the same assignment + surface + slot + media type replaces the previous active batch for that key, whether the previous batch was uploaded in the same round or an earlier round.
- The replacement key is assignment_id + assignment_surface + slot slug + assignment_media_type. The active batch for a key is the batch with the highest assignment_round (ties broken by the newest content_assets row); every file in that batch is active and all other batches for that key are superseded.
- UI, readiness, and deliverable binding must resolve and use every asset in the latest active batch for each key. Superseded or reset assets must never be shown again or accepted for deliverable binding.
- Old and new assets must not remain active together.
- Matching reset removes every retained assignment_work link of that media type, across all rounds, not just the current round.
- Never derive assignment work round as revision_round + 1.
- One batch = one round is a guaranteed invariant: chunked-upload finalize must use the assignment_round captured in the upload manifest at /uploads/start, never a live re-read of the assignment (a revision request landing mid-upload must not split a batch across rounds).
- Active-batch resolution has exactly one implementation: resolveActiveAssignmentWorkBatchRows in collector/db/repository.mjs. Visibility, deliverable binding, and any future consumer must call it instead of re-deriving the grouping.
- Promotion boundary: a content_assets row selected in Article Workspace (selected_in_clean=1 or role other than 'unused') is owned by the editorial lifecycle. Assignment lifecycle deletions (replacement-on-insert, revision reset, draft expiry) must never delete such a row or its file; they detach the row instead by clearing assignment_id, assignment_round, assignment_media_type, assignment_surface, and assignment_sync_batch_id.

**ภาษาไทย**

- เก็บสื่อเดิมไว้ตลอดรอบ revision จนกว่าจะถูกแทนที่ด้วยไฟล์อัปโหลดใหม่ในช่อง (slot) เดียวกัน หรือถูกลบด้วยการ reset ที่ตรงเงื่อนไข
- การอัปโหลดใหม่สำหรับ assignment + surface + slot + media type เดียวกัน จะแทนที่ batch ที่ active เดิมของ key นั้น ไม่ว่า batch เดิมจะอัปโหลดในรอบเดียวกันหรือรอบก่อนหน้า
- key ของการแทนที่คือ assignment_id + assignment_surface + slot slug + assignment_media_type ส่วน batch ที่ active ของแต่ละ key คือ batch ที่มี assignment_round สูงสุด (ถ้าเท่ากันให้ดู content_assets row ที่ใหม่ที่สุด) ทุกไฟล์ใน batch นั้นถือว่า active และ batch อื่นของ key เดียวกันถือว่าถูกแทนที่ (superseded)
- UI, การเช็ค readiness, และการผูก deliverable ต้องดึงและใช้ทุกไฟล์ใน batch ที่ active ล่าสุดของแต่ละ key เท่านั้น ไฟล์ที่ถูกแทนที่หรือถูก reset ต้องไม่แสดงซ้ำหรือถูกใช้ผูก deliverable อีก
- ห้ามให้ไฟล์เก่าและไฟล์ใหม่ active พร้อมกัน
- การ reset ที่ตรงเงื่อนไขต้องลบ assignment_work link ของ media type นั้นทั้งหมดทุกรอบ ไม่ใช่แค่รอบปัจจุบัน
- ห้ามคำนวณ assignment work round จาก revision_round + 1
- กติกาที่ต้องคงไว้เสมอคือ 1 batch = 1 round: ขั้นตอน finalize ของ chunked upload ต้องใช้ assignment_round ที่บันทึกไว้ใน upload manifest ตอนเรียก /uploads/start เท่านั้น ห้ามอ่านค่า assignment สดใหม่ (ถ้ามีคำขอ revision เข้ามาระหว่างอัปโหลด ต้องไม่ทำให้ batch เดียวถูกแบ่งข้ามรอบ)
- การหา active batch มี implementation เดียวคือ resolveActiveAssignmentWorkBatchRows ใน collector/db/repository.mjs การแสดงผล การผูก deliverable และผู้ใช้งานในอนาคตต้องเรียกฟังก์ชันนี้ ห้ามคำนวณการจัดกลุ่มขึ้นใหม่เอง
- ขอบเขตของการ promote: content_assets row ที่ถูกเลือกใน Article Workspace (selected_in_clean=1 หรือ role อื่นที่ไม่ใช่ 'unused') ถือว่าเป็นของ editorial lifecycle แล้ว การลบในวงจรของ assignment (แทนที่ตอน insert, revision reset, draft หมดอายุ) ต้องไม่ลบ row หรือไฟล์นั้น แต่ให้ปลด (detach) แทน โดยล้างค่า assignment_id, assignment_round, assignment_media_type, assignment_surface, และ assignment_sync_batch_id

## 3. Raw Intake / Claim / Delete Policy

**English**

- Raw-only hard delete is allowed only for safe raw-only items.
- Hard delete must be blocked once submission deliverables or protected workflow artifacts exist.
- Raw pool first claim is allowed only for eligible unclaimed raw pool items.

Placeholders:

- Raw intake validation policy: TBD / update later.
- Duplicate/raw merge policy: TBD / update later. (The merge *gate* is covered below; how merge itself
  resolves duplicates is not.)

### Delete Tier Contract (locked)

Four delete paths exist and each gates on a **different** rule. They must not be collapsed into one
gate: the cost of being wrong differs per path, because only purge destroys data irreversibly.

- **Soft delete** (`DELETE /api/items/:id`, `is_deleted=1`, reversible) gates **only on NEVER-level
  blockers** — published articles, review actions, and translations bound to a published article.
  Everything else (drafts, field packs, assignments, workflow state) must not block it: the row stays
  in `content_items` and the full gate still runs at merge and at purge. Every successful soft delete
  writes an `item.delete` audit row carrying the item snapshot and the NEVER-check result.
  The NEVER keys are derived from `REFERENCE_HARD_BLOCKER_DEFS` — they must not be restated as
  separate SQL. They are currently the whole of that list, but the derivation stays **opt-in** (a
  per-key remediation map in `services/raw-delete.mjs`): a hard blocker added later does not join the
  soft-delete gate until it is named there. The NEVER set is exactly
  `published_articles`, `review_actions`, `translations_published` and is locked by a test.
- **Bulk soft delete** (`POST /api/items/bulk-delete`) is **partial success**: items hitting a NEVER
  blocker are skipped into `blocked_rows` with per-item reasons, the rest are deleted, and the
  response reports both. When *every* selected item is blocked it must fail (400), never report
  success with 0 deleted.
- **Merge** (`mergeContentItems`) keeps the **full dependency gate** (`getMergeBlockersForItem`).
- **Purge** (`POST /api/admin/deleted-items/:id/purge`, `DELETE FROM content_items`, irreversible)
  classifies every reference group into exactly one of three tiers:
  - `hard_blocker` — always rejected (409). No override exists, at any role. Exactly three groups:
    `published_articles`, `review_actions`, `translations_published`. A group belongs here only when
    **no workflow action can clear it** — it is already public, or it is audit history. Anything an
    owner could legitimately resolve (closing an assignment, discarding a draft) is `confirm_required`
    instead: a tier nothing can clear is a dead end, not a gate. Each def's `hint` is user-facing —
    it renders verbatim under the disabled Purge button, so it must state what to do.
  - `cleanup_candidate` — rejected (409) until cleared through the reference-cleanup endpoint first.
  - `confirm_required` — groups holding human work: drafts, field packs, approved context,
    unpublished translations, and the **assignment family** (`assignments`,
    `content_assignment_submissions`, `content_assignment_submission_deliverables`,
    `content_assignment_handoff_snapshots`). Rejected (400, listing `missing_confirmations`) unless the
    owner names **every one** of them in the `confirmed_overrides` request field. Each def must carry
    per-record detail naming *whose* work is being destroyed (assignee/submitter, state, date). The
    `item.purge` audit row must record which groups were overridden, why confirmation was required,
    and the per-record detail.
- **Blocker summary display** (`GET /api/items/blocker-summary?ids=`, read-only) annotates the item
  list with each item's delete-blocker state — NEVER blockers, the `cleanup_candidate` reference total,
  the per-group `confirm_required` list, and open assignments — reusing the same reference defs as the
  purge gate so the badge cannot disagree with it. It applies the same per-item visibility filter as
  `GET /api/items` (out-of-scope ids are dropped from the response, not 403/404'd). It is display only:
  it never deletes, purges, or otherwise mutates, and adds no new gate.
- **In-flight items table** ("งานค้างระหว่างทาง", owner-only Data Cleanup zone, above the soft-deleted
  table) lists items that have left raw intake but have not finished, read from
  `GET /api/items?in_flight=1`. That param is additive: it selects on the **canonical** workflow head
  (`production_state` not `collected`/`completed`, `publication_state` not `published`, `is_deleted=0`),
  never the legacy `workflow_status` column, and its absence leaves every existing caller's response
  unchanged. An item with **no workflow head row is excluded** — a missing head means intake never
  advanced, so the item still belongs to the raw queue, where it does render (its null states classify
  as the `raw_prep` bucket). The read must not create a head as a side effect: it reads through
  `getWorkflowModelByItem`, never `ensureWorkflowModel`. The table is display only apart from a per-row delete that calls the existing
  `DELETE /api/items/:id` under the **unchanged** soft-delete contract above — a NEVER blocker still
  fails there with the server's message shown verbatim, and open assignments only raise an
  acknowledgement confirm, never a new gate. It carries **no Purge button**: purge stays on the
  soft-deleted table. Items here may also appear in the raw queue tables; that overlap is intended.

Two scripts are the verification gate for this contract, and both must be updated in the same change
as any intentional change to the rules above:

- `collector/scripts/smoke-data-cleanup.mjs` covers the API tiers — both the reject and the
  confirmed-override path.
- `collector/scripts/smoke-data-cleanup-ui-browser.mjs` covers the Data Cleanup table in a real
  browser: that a `confirm_required` group renders one tickable checkbox per group with its
  per-record detail, that Purge stays disabled until every one is ticked, that a `hard_blocker`
  offers no checkbox at all, and that the resulting `item.purge` audit row carries the overrides.
  It runs against its own backend and temp DB, so it never touches real data.

**ภาษาไทย**

- การลบถาวร (hard delete) ทำได้เฉพาะรายการที่เป็น raw-only และปลอดภัยเท่านั้น
- ต้องบล็อกการลบถาวรทันทีที่มี submission deliverable หรือ workflow artifact ที่ได้รับการป้องกันอยู่แล้ว
- การ claim จาก raw pool แบบ first-claim ทำได้เฉพาะรายการดิบที่ยังไม่มีใคร claim และเข้าเงื่อนไข

ส่วนที่ยังไม่กำหนด (Placeholders):

- นโยบายตรวจสอบข้อมูลตอนรับเข้า (raw intake validation): ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบายการรวมรายการซ้ำ/ raw merge: ยังไม่กำหนด (TBD) / ทำภายหลัง (เกณฑ์บล็อก merge อยู่ด้านล่างแล้ว
  แต่ตัว logic ว่า merge รวมรายการซ้ำอย่างไร ยังไม่กำหนด)

### สัญญาของการลบแต่ละชั้น (locked)

การลบมี 4 เส้นทาง และแต่ละเส้น **ใช้เกณฑ์คนละชุด** ห้ามยุบรวมเป็นเกณฑ์เดียว เพราะความเสียหายเมื่อ
ตัดสินผิดไม่เท่ากัน — มีแต่ purge เท่านั้นที่ลบข้อมูลแบบกู้คืนไม่ได้

- **Soft delete** (`DELETE /api/items/:id`, `is_deleted=1`, ย้อนกลับได้) เช็ค **เฉพาะ blocker ระดับ
  NEVER** — บทความที่เผยแพร่แล้ว, ประวัติ review action, และงานแปลที่ผูกกับบทความที่เผยแพร่แล้ว
  อย่างอื่น (drafts, field packs, assignment, workflow state) ต้องไม่บล็อก เพราะแถวยังอยู่ใน
  `content_items` และยังต้องผ่านเกณฑ์เต็มตอน merge กับตอน purge อยู่ดี ทุกครั้งที่ soft delete สำเร็จ
  ต้องเขียน audit `item.delete` พร้อม snapshot ของ item และผลการเช็ค NEVER
  ชุด key ของ NEVER derive มาจาก `REFERENCE_HARD_BLOCKER_DEFS` ห้ามเขียน SQL ซ้ำแยกไว้ต่างหาก
  ตอนนี้ครบทั้งลิสต์นั้นพอดี แต่การ derive ยังเป็นแบบ **opt-in** (map remediation ราย key ใน
  `services/raw-delete.mjs`) — hard blocker ที่เพิ่มทีหลังจะยังไม่เข้าเกณฑ์ soft delete จนกว่าจะถูกใส่ชื่อไว้ตรงนั้น
  ชุด NEVER คือ `published_articles`, `review_actions`, `translations_published` เท่านั้น และมี test ล็อกไว้
- **Bulk soft delete** (`POST /api/items/bulk-delete`) เป็นแบบ **partial success**: item ที่ติด NEVER
  ถูกข้ามไปอยู่ใน `blocked_rows` พร้อมเหตุผลรายตัว ที่เหลือลบตามปกติ และ response ต้องรายงานทั้งสองฝั่ง
  ถ้าติดบล็อก**ทุกตัว** ต้องตอบ fail (400) ห้ามรายงานว่าสำเร็จทั้งที่ลบได้ 0 รายการ
- **Merge** (`mergeContentItems`) ยังใช้ **เกณฑ์เต็ม** (`getMergeBlockersForItem`) ตามเดิม
- **Purge** (`POST /api/admin/deleted-items/:id/purge`, `DELETE FROM content_items`, กู้คืนไม่ได้)
  จัดกลุ่มข้อมูลอ้างอิงทุกกลุ่มเป็น 1 ใน 3 ชั้น:
  - `hard_blocker` — ปฏิเสธเสมอ (409) ไม่มี override ไม่ว่า role ไหน มีแค่ 3 กลุ่ม:
    `published_articles`, `review_actions`, `translations_published` กลุ่มจะอยู่ชั้นนี้ได้ก็ต่อเมื่อ
    **ไม่มี workflow action ไหนเคลียร์ได้** — คือเผยแพร่ไปแล้ว หรือเป็นประวัติ audit ส่วนอะไรที่ owner
    จัดการเองได้ตามขั้นตอนปกติ (ปิด assignment, ทิ้ง draft) ต้องอยู่ `confirm_required` แทน เพราะชั้นที่ไม่มี
    ทางเคลียร์คือทางตัน ไม่ใช่เกณฑ์ และ `hint` ของแต่ละ def เป็นข้อความที่ผู้ใช้เห็นจริง — ถูกแสดงตรง ๆ
    ใต้ปุ่ม Purge ที่ disabled อยู่ จึงต้องบอกว่าให้ไปทำอะไรต่อ
  - `cleanup_candidate` — ปฏิเสธ (409) จนกว่าจะล้างผ่าน endpoint reference-cleanup ก่อน
    **SAFE sweep must never cascade-delete `confirm_required` or NEVER data.** The repository enforces
    this dynamically while classifying candidates for the individual item, and reports the skip reason
    to the owner. The current FK chain is `evidence_blocks → approved_context_blocks`: when approved
    context exists, evidence remains for purge to delete together only after the owner confirms the
    approved context. Any new `confirm_required` definition or FK cascade must add its risk rule to
    `CASCADE_KILLED_CONFIRM_KEY_DEFS`.
    **SAFE sweep ต้องไม่ลบข้อมูล `confirm_required` หรือ NEVER ทางอ้อมผ่าน FK cascade**: repository จะตัด
    candidate เฉพาะ item นั้นแบบ dynamic และรายงานเหตุผลให้ owner เห็น ปัจจุบัน chain คือ
    `evidence_blocks → approved_context_blocks`; เมื่อมี approved context อยู่ จะเก็บ evidence ไว้ให้
    purge ลบพร้อมกันหลัง owner ยืนยัน approved context แทน หากเพิ่ม `confirm_required` definition หรือ FK
    cascade ใหม่ ต้องเพิ่มกติกาความเสี่ยงที่ `CASCADE_KILLED_CONFIRM_KEY_DEFS` ด้วย
  - `confirm_required` — กลุ่มที่มีงานที่คนลงแรงไว้: drafts, field packs, approved context,
    งานแปลที่ยังไม่เผยแพร่ และ**ตระกูล assignment** (`assignments`,
    `content_assignment_submissions`, `content_assignment_submission_deliverables`,
    `content_assignment_handoff_snapshots`) ปฏิเสธ (400 พร้อมรายการ `missing_confirmations`) จนกว่า owner จะระบุ
    **ครบทุกตัว** ในฟิลด์ `confirmed_overrides` ของ request แต่ละ def ต้องมี detail ราย record ที่บอกได้ว่ากำลัง
    ทิ้ง**งานของใคร** (ผู้รับงาน/ผู้ส่งงาน, สถานะ, วันที่) และ audit `item.purge` ต้องบันทึกว่ากลุ่มไหน
    ถูก override, เหตุผลที่ต้องยืนยัน, และรายละเอียดราย record
- **Blocker summary (แสดงผล)** (`GET /api/items/blocker-summary?ids=`, read-only) แปะสถานะ blocker ของการลบ
  ให้แต่ละ item บน item list — NEVER blocker, ยอดรวม `cleanup_candidate`, รายการ `confirm_required` ราย group,
  และ assignment ที่เปิดอยู่ — โดยใช้ reference defs ชุดเดียวกับ purge gate จึงไม่มีทางขัดกับเกณฑ์ purge และกรอง
  visibility ราย item แบบเดียวกับ `GET /api/items` (id นอก scope ถูกตัดออกจาก response ไม่ตอบ 403/404) เป็นการ
  แสดงผลล้วน ไม่ลบ ไม่ purge ไม่แก้ข้อมูล และไม่เพิ่มเกณฑ์ใหม่
- **ตารางงานค้างระหว่างทาง** (โซน Data Cleanup เฉพาะ owner, อยู่เหนือตารางรายการที่ soft delete แล้ว)
  แสดง item ที่พ้นขั้นรับข้อมูลดิบแล้วแต่ยังไม่จบ อ่านจาก `GET /api/items?in_flight=1` — param นี้เป็นแบบ
  additive และคัดจาก workflow head **แบบ canonical** (`production_state` ไม่ใช่ `collected`/`completed`,
  `publication_state` ไม่ใช่ `published`, `is_deleted=0`) ไม่ใช้คอลัมน์ `workflow_status` แบบเดิม และเมื่อ
  ไม่ส่ง param นี้ response ของ caller เดิมทุกตัวต้องเหมือนเดิมทุกประการ item ที่**ไม่มีแถว workflow head
  ถูกตัดออก** — head ที่หายแปลว่ายังไม่พ้นขั้นรับข้อมูล item จึงยังอยู่ในคิว raw และแสดงที่นั่นจริง (state ที่เป็น
  null ถูกจัดเป็น bucket `raw_prep`) และการอ่านนี้ต้องไม่สร้าง head เป็นผลข้างเคียง — ใช้
  `getWorkflowModelByItem` เท่านั้น ห้ามใช้ `ensureWorkflowModel` ตารางนี้เป็นการแสดงผลล้วน ยกเว้น
  ปุ่มลบรายแถวที่เรียก `DELETE /api/items/:id` เดิมภายใต้สัญญา soft delete ข้างบน**แบบไม่แก้ไข** — ติด NEVER
  blocker ก็ยังถูกปฏิเสธที่เดิมและต้องแสดงข้อความจาก server ตรง ๆ ส่วน assignment ที่เปิดอยู่แค่ขึ้น confirm
  เพื่อรับทราบ ไม่ใช่เกณฑ์บล็อกใหม่ ตารางนี้**ไม่มีปุ่ม Purge** — purge อยู่ที่ตารางรายการที่ลบแล้วเท่านั้น
  และ item ที่โผล่ในตารางนี้อาจโผล่ในตารางคิว raw ด้วย ซึ่งเป็นพฤติกรรมที่ตั้งใจ

ด่าน verify ของสัญญานี้มี 2 ตัว และต้องแก้ไปพร้อมกันในทุกครั้งที่ตั้งใจเปลี่ยนกฎด้านบน:

- `collector/scripts/smoke-data-cleanup.mjs` คลุมชั้นต่าง ๆ ฝั่ง API — ทั้งเส้นที่ถูกปฏิเสธและเส้นที่ยืนยัน
  override แล้วผ่าน
- `collector/scripts/smoke-data-cleanup-ui-browser.mjs` คลุมตาราง Data Cleanup บนเบราว์เซอร์จริง: กลุ่ม
  `confirm_required` ต้องมี checkbox ให้ติ๊กกลุ่มละ 1 ช่องพร้อม detail ราย record, ปุ่ม Purge ต้อง disabled
  จนกว่าจะติ๊กครบทุกกลุ่ม, `hard_blocker` ต้องไม่มี checkbox ให้ติ๊กเลย และ audit `item.purge` ที่ได้ต้อง
  บันทึก override ไว้ครบ — สคริปต์นี้ยิง backend กับ temp DB ของตัวเอง จึงไม่แตะข้อมูลจริง

## 4. Clean / Agent Draft Policy

**English**

- Clean stage can select reference media for AI / Field Pack context.
- Clean stage must not set cover or promote media into publish roles.
- Clean/Agent Draft's early-stage hard-block behavior follows §5 Stage-specific Media Blocker Policy: missing local publish-ready media does not hard-block this stage.
- Need at least 1 approved context remains a valid hard blocker for Agent draft.
- Clean media selection is workflow context only and does not automatically mean publish-safe.

**ภาษาไทย**

- ขั้นตอน Clean เลือกสื่ออ้างอิง (reference media) เพื่อใช้เป็นบริบทให้ AI / Field Pack ได้
- ขั้นตอน Clean ต้องไม่ตั้งค่า cover หรือเลื่อนสื่อขึ้นเป็นสื่อสำหรับเผยแพร่ (publish role)
- พฤติกรรม hard block ในขั้นต้นของ Clean/Agent Draft ให้เป็นไปตาม §5 Stage-specific Media Blocker Policy: การขาดสื่อสำหรับเผยแพร่ที่พร้อมใช้ในเครื่อง (local publish-ready) ไม่ทำให้ขั้นตอนนี้ถูกบล็อก
- เงื่อนไข "ต้องมี approved context อย่างน้อย 1 รายการ" ยังคงเป็นตัวบล็อกที่ใช้ได้จริงสำหรับ Agent draft
- การเลือกสื่อในขั้นตอน Clean เป็นแค่บริบทของ workflow เท่านั้น ไม่ได้แปลว่าสื่อนั้นพร้อมเผยแพร่ (publish-safe) โดยอัตโนมัติ

## 5. Media Policy

### Media Classes

#### Reference / Evidence Media

**English**

- Reference media and publish media are separate domains.
- Allowed in Raw Data, Clean Prep, AI analysis, Field Pack drafting, and internal planning.
- May include external URLs/images, Google/search/social references, and other research references.
- Must remain reference-only.
- Must not be materialized into `assets` / `content_assets`.
- Must not become cover/gallery/inline publish media automatically.
- Must not be treated as rights-verified.
- Must not be synced to public frontend as publish media.

**ภาษาไทย**

- สื่ออ้างอิง (reference media) กับสื่อสำหรับเผยแพร่ (publish media) เป็นคนละขอบเขตกัน
- ใช้ได้ในขั้นตอน Raw Data, Clean Prep, การวิเคราะห์ของ AI, การร่าง Field Pack และการวางแผนภายใน
- อาจรวม URL/รูปภาพจากภายนอก, ข้อมูลอ้างอิงจาก Google/การค้นหา/โซเชียล และแหล่งค้นคว้าอื่น ๆ
- ต้องคงสถานะเป็น "อ้างอิงเท่านั้น" (reference-only)
- ต้องไม่ถูกแปลงเป็นข้อมูลจริงใน `assets` / `content_assets`
- ต้องไม่กลายเป็น cover/gallery/inline publish media โดยอัตโนมัติ
- ต้องไม่ถือว่าผ่านการตรวจสอบสิทธิ์ (rights-verified)
- ต้องไม่ sync ไปยัง public frontend ในฐานะสื่อสำหรับเผยแพร่

#### Usable / Publish Media

**English**

- Used for Article Workspace cover/gallery/inline images, Admin Review, final handoff, publish/export, public frontend.
- Must come from selected local/backend-controlled `assets` + `content_assets` only.
- Eligible publish media must be collector/backend-controlled local/nas assets:
  - storage_disk in local or nas
  - non-http(s) storage_path
  - image mime type when available
- External/reference media cannot be used as publish media unless manually rights-verified, imported into controlled local/backend storage, and selected as a local usable asset.
- `image_context` must contain only local/backend-controlled selected assets.
- `reference_media_context` may contain selected external/reference media and is reference-only, not rights-verified, not publish media, and not approved cover/gallery/inline media.

**ภาษาไทย**

- ใช้สำหรับรูป cover/gallery/inline ใน Article Workspace, Admin Review, การส่งมอบขั้นสุดท้าย (final handoff), publish/export และ public frontend
- ต้องมาจาก `assets` + `content_assets` ที่เลือกไว้และอยู่ในเครื่อง/ควบคุมโดย backend เท่านั้น
- สื่อที่มีสิทธิ์เป็น publish media ต้องเป็น asset ที่ collector/backend ควบคุมและอยู่บน local/nas:
  - storage_disk เป็น local หรือ nas
  - storage_path ไม่ใช่ http(s)
  - mime type เป็นรูปภาพ (เมื่อทราบค่า)
- สื่อภายนอก/สื่ออ้างอิงจะใช้เป็น publish media ไม่ได้ เว้นแต่จะตรวจสอบสิทธิ์ด้วยมือ นำเข้ามาเก็บใน storage ที่ควบคุมได้ และถูกเลือกเป็น local usable asset แล้ว
- `image_context` ต้องมีเฉพาะ asset ที่เลือกและควบคุมโดย local/backend เท่านั้น
- `reference_media_context` อาจมีสื่ออ้างอิง/สื่อภายนอกที่เลือกไว้ได้ แต่ถือเป็น reference-only เท่านั้น ไม่ผ่านการตรวจสอบสิทธิ์ ไม่ใช่ publish media และไม่ใช่ cover/gallery/inline ที่อนุมัติแล้ว

### Stage-specific Media Blocker Policy

This is the single, canonical statement of the media hard-block rule (it also covers where the
"local-only publish media" error is and isn't correct — previously duplicated as a separate
"Error Placement" section, now merged here).

**English**

- No hard block in draft/prepare stages: Raw Data, Clean Prep, Field Pack Draft, and Clean/Agent Draft (media selection) must not hard-block only because local publish-ready media is missing. Reference media is fine at these stages; missing local publish media is at most a warning/soft-readiness signal. Clean/Agent Draft's own "at least 1 approved context" rule (§4) remains a separate, valid hard blocker.
- Article Workspace may show a missing-cover / needs-local-asset state, but must not auto-promote external/reference media into publish media, and is not itself a hard-block gate under this rule.
- Hard block applies only at the late-stage gates: Submit Admin Review, Final Handoff, and Publish/Export must block unless selected local usable cover/assets exist. External/reference media can never satisfy these gates.
- The error "usable article media must be selected from uploaded local assets" (or an equivalent local-only publish media error) is correct only at Submit Admin Review, Final Handoff, and Publish/Export. Showing it at Raw Data, Clean Prep, Field Pack Draft, or Clean/Agent Draft media selection is a bug, not policy.

**ภาษาไทย**

- ไม่มี hard block ในขั้น draft/prepare: Raw Data, Clean Prep, Field Pack Draft และการเลือกสื่อใน Clean/Agent Draft ต้องไม่ถูกบล็อกเพียงเพราะยังไม่มีสื่อสำหรับเผยแพร่ที่พร้อมใช้ในเครื่อง สื่ออ้างอิงใช้ได้ตามปกติในขั้นตอนเหล่านี้ ส่วนการขาดสื่อสำหรับเผยแพร่ในเครื่องเป็นได้แค่คำเตือน/สถานะ readiness แบบอ่อน (soft) เท่านั้น ส่วนกติกา "ต้องมี approved context อย่างน้อย 1 รายการ" ของ Clean/Agent Draft (§4) ยังคงเป็นตัวบล็อกที่ใช้ได้แยกต่างหาก
- Article Workspace แสดงสถานะ missing-cover / needs-local-asset ได้ แต่ต้องไม่เลื่อนสื่อภายนอก/สื่ออ้างอิงขึ้นเป็น publish media โดยอัตโนมัติ และตัวมันเองไม่ใช่ด่าน hard-block ตามกติกานี้
- hard block จะใช้เฉพาะด่านปลายทาง (late-stage) เท่านั้น: Submit Admin Review, Final Handoff และ Publish/Export ต้องบล็อกถ้ายังไม่มี local usable cover/asset ที่เลือกไว้ สื่อภายนอก/สื่ออ้างอิงไม่สามารถผ่านด่านเหล่านี้ได้เลย
- ข้อความ error "usable article media must be selected from uploaded local assets" (หรือ error ลักษณะเดียวกันเรื่อง local-only publish media) ถูกต้องเฉพาะที่ Submit Admin Review, Final Handoff และ Publish/Export เท่านั้น หากขึ้น error นี้ที่ Raw Data, Clean Prep, Field Pack Draft หรือการเลือกสื่อใน Clean/Agent Draft ถือเป็นบั๊ก ไม่ใช่นโยบาย

### Reference Media Policy v2 Contract

**English**

- Clean reference media endpoint is `GET /api/items/:id/reference-media`.
- Reference media selection is stored in `content_reference_media_selections`.
- `reference_media_id` is a stable synthetic id in format `rm:<url_hash>` from normalized URL.
- Clean selection/toggle must use `reference_media_id`, not `asset_id`, `content_asset_id`, or `selected_in_clean`.
- Import/collect flow must not bridge external media into `assets` / `content_assets`.
- Under policy v2, `bridged_image_count` remains `0` and `reference_media_count` may be returned for imported reference candidates.
- `repairImportedReferenceAssetsForItem()` is legacy/deprecated and must not be used by active server/import/Clean/Agent flow.
- `POST /api/items/:id/assets/repair-imported-media` is deprecated and returns `410 REFERENCE_MEDIA_POLICY_V2`.

**ภาษาไทย**

- endpoint สำหรับสื่ออ้างอิงในขั้นตอน Clean คือ `GET /api/items/:id/reference-media`
- การเลือกสื่ออ้างอิงเก็บไว้ใน `content_reference_media_selections`
- `reference_media_id` คือ id สังเคราะห์ที่คงที่ รูปแบบ `rm:<url_hash>` สร้างจาก URL ที่ normalize แล้ว
- การเลือก/toggle ในขั้นตอน Clean ต้องใช้ `reference_media_id` เท่านั้น ห้ามใช้ `asset_id`, `content_asset_id`, หรือ `selected_in_clean`
- ขั้นตอน import/collect ต้องไม่เชื่อมสื่อภายนอกเข้าไปเป็น `assets` / `content_assets`
- ภายใต้ policy v2 ค่า `bridged_image_count` ต้องเป็น `0` เสมอ ส่วน `reference_media_count` สามารถคืนค่าได้สำหรับ candidate สื่ออ้างอิงที่ import เข้ามา
- `repairImportedReferenceAssetsForItem()` เป็นของเก่า/เลิกใช้แล้ว (deprecated) ห้ามใช้ใน flow ของ server/import/Clean/Agent ที่ยัง active อยู่
- `POST /api/items/:id/assets/repair-imported-media` เลิกใช้แล้วและคืนค่า `410 REFERENCE_MEDIA_POLICY_V2`

## 6. Article / SEO Agent Policy

**English**

- Article Agent and SEO Agent are suggestion-only/manual.
- No auto-save, no auto-submit, no auto-publish.
- Human editor must review and save.
- Existing content replacement should require confirmation where implemented.
- SEO Agent fills metadata suggestions locally before save.

Placeholders:

- Detailed prompt/profile policy: TBD / update later.
- Translation policy: TBD / update later.

**ภาษาไทย**

- Article Agent และ SEO Agent เป็นแค่ตัวเสนอแนะ (suggestion-only) ทำงานแบบ manual เท่านั้น
- ห้าม auto-save, auto-submit, หรือ auto-publish
- บรรณาธิการ (human editor) ต้องตรวจและกด save เอง
- การแทนที่เนื้อหาเดิมควรมีการยืนยัน (confirmation) ในจุดที่ทำไว้แล้ว
- SEO Agent เติมคำแนะนำ metadata ไว้ในเครื่อง (local) ก่อนที่จะ save

ส่วนที่ยังไม่กำหนด (Placeholders):

- นโยบาย prompt/profile แบบละเอียด: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบายการแปลภาษา (translation policy): ยังไม่กำหนด (TBD) / ทำภายหลัง

## 7. Admin Review / Publish Policy

**English**

- Submit Admin Review and Publish are late-stage gates.
- Publish must require local usable media readiness.
- Publish must require body/meta/readiness requirements.
- External/reference media must not pass publish readiness.

**ภาษาไทย**

- Submit Admin Review และ Publish เป็นด่านปลายทาง (late-stage gate)
- Publish ต้องกำหนดให้สื่อ local usable พร้อมใช้ (readiness) ก่อนเสมอ
- Publish ต้องกำหนดให้ผ่านเงื่อนไข body/meta/readiness ที่กำหนดไว้
- สื่อภายนอก/สื่ออ้างอิงต้องไม่สามารถผ่านเงื่อนไข publish readiness ได้

## 7A. Taxonomy and Curation Policy

**English**

- Clean owns the canonical main category.
- Current canonical category path is `item.category -> buildFieldPackHandoffPackage(...) -> handoffPackage.niche`.
- CTA/contact is separate from taxonomy.
- CTA/contact is place-only.
- Standard CTA checks for place are `phone`, `line_url`, `facebook_url`, and `website_url`.
- Standard CTA checks for place are always requested for human verification.
- There is no "primary" CTA. The public place page renders every populated channel in a fixed order (map, phone, LINE, Facebook, website) as equal peers; `primary_cta` is a retired legacy column, still readable on old records, never written by new Curation answers.
- `requested=true` means a human must verify the field, including false, absent, or not found.
- AI may suggest CTA/taxonomy values but cannot confirm facts.
- Work Return and human review remain the confirmation source.
- Work Return recipients must not change category in the assignment return UI.
- Taxonomy catalog entries must use stable real check keys, not generic placeholder rows.
- `taxonomy.category`, `taxonomy.subtype`, and `taxonomy.tags` are reserved metadata keys, not editable Curation questions.
- Real taxonomy categories are `attractions`, `activities`, `hotels`, `cafes`, `restaurants`, and `transport`.
- Coordinates, map identity/link, Google Maps opening hours, and CTA/contact are excluded from taxonomy.
- Category defaults are the baseline for Curation.
- Mapping may add category-relevant checks.
- AI may activate approved Agent-triggered catalog keys and may provide suggested values.
- AI must not create canonical unknown keys, override catalog schema, or remove required defaults.
- AI must not silently remove required category defaults.
- Resolver must deduplicate by stable `taxonomy_key`.
- Resolver writes an immutable resolved checklist into the assignment handoff snapshot.
- Work Return renders only the resolved snapshot.
- Work Return must not query the live taxonomy catalog, infer category defaults, or call AI.
- One taxonomy check maps to one Work Return row.
- Each visible Curation row supports a main value plus optional `condition_note`.
- Hidden legacy rows remain preserved through draft merge and payload handling for backward compatibility.
- `requested_check_returns` remains the canonical Work Return payload.
- Issued assignments must stay stable when the live taxonomy catalog changes.
- Any change to an issued handoff requires explicit repair or reissue behavior.
- If a handoff snapshot contains no actual resolved taxonomy checks, the Work Return Curation section stays hidden.
- Required taxonomy means the field worker must answer, not that the value must be true.
- Unknown/non-catalog observations must go to handoff guidance, `must_ask_question`, or Work Return additional notes for writer consideration.
- Unknown observations do not become catalog keys automatically.
- Do not create new `custom` groups or new `custom.*` keys in the active taxonomy/requested-check flow.
- Do not include any `custom` group or `custom.*` row in newly created handoff snapshots, including legacy stored rows.
- Do not project `custom.*` into canonical taxonomy facts or Homepage Signals filtering.
- Preserve legacy custom data at rest.
- Already-issued immutable snapshots containing custom checks remain readable and returnable for compatibility.
- Do not delete legacy stored data.

**ภาษาไทย**

- Clean เป็นเจ้าของหมวดหมู่หลัก (canonical main category)
- เส้นทางของหมวดหมู่ที่เป็นทางการปัจจุบันคือ `item.category -> buildFieldPackHandoffPackage(...) -> handoffPackage.niche`
- CTA/ข้อมูลติดต่อ แยกออกจาก taxonomy
- CTA/ข้อมูลติดต่อ ใช้เฉพาะกับ place เท่านั้น
- รายการ CTA มาตรฐานสำหรับ place คือ `phone`, `line_url`, `facebook_url`, และ `website_url`
- รายการ CTA มาตรฐานของ place จะถูกขอให้มนุษย์ยืนยันเสมอ
- ไม่มี CTA "หลัก" อีกต่อไป หน้า place สาธารณะแสดงทุกช่องทางที่มีข้อมูลเรียงตามลำดับตายตัว (แผนที่, โทร, LINE, Facebook, เว็บไซต์) เท่าเทียมกัน `primary_cta` เป็นคอลัมน์เก่าที่เลิกใช้แล้ว ยังอ่านค่าของ record เก่าได้ แต่คำตอบ Curation ใหม่จะไม่เขียนค่าลงไปอีก
- `requested=true` หมายความว่ามนุษย์ต้องยืนยันฟิลด์นั้น ไม่ว่าค่าจะเป็น false, ไม่มีข้อมูล หรือหาไม่พบก็ตาม
- AI เสนอค่าของ CTA/taxonomy ได้ แต่ยืนยันข้อเท็จจริงเองไม่ได้
- Work Return และการตรวจโดยมนุษย์ (human review) ยังคงเป็นแหล่งยืนยันข้อมูล
- ผู้รับ Work Return ต้องไม่เปลี่ยนหมวดหมู่ (category) ใน UI ของการส่งงานคืน assignment
- รายการใน taxonomy catalog ต้องใช้ check key จริงที่คงที่ ไม่ใช่แถว placeholder ทั่วไป
- `taxonomy.category`, `taxonomy.subtype`, และ `taxonomy.tags` เป็น reserved metadata key ไม่ใช่คำถาม Curation ที่แก้ไขได้
- หมวดหมู่ taxonomy จริงมี `attractions`, `activities`, `hotels`, `cafes`, `restaurants`, และ `transport`
- พิกัด, ข้อมูล/ลิงก์แผนที่, เวลาเปิด-ปิดจาก Google Maps และ CTA/ข้อมูลติดต่อ ไม่ถือเป็นส่วนหนึ่งของ taxonomy
- ค่า default ของแต่ละหมวดหมู่คือฐานเริ่มต้นของ Curation
- Mapping สามารถเพิ่ม check ที่เกี่ยวข้องกับหมวดหมู่ได้
- AI สามารถเปิดใช้งาน catalog key ที่อนุมัติให้ Agent เป็นผู้กระตุ้นได้ และเสนอค่าได้
- AI ต้องไม่สร้าง key ที่ไม่รู้จักให้กลายเป็น canonical, ต้องไม่ override schema ของ catalog, และต้องไม่ลบ default ที่จำเป็น
- AI ต้องไม่ลบ default ของหมวดหมู่ที่จำเป็นออกไปโดยไม่แจ้ง
- Resolver ต้องตัดรายการซ้ำโดยอิง `taxonomy_key` ที่คงที่
- Resolver ต้องเขียน checklist ที่ resolve แล้วแบบแก้ไขไม่ได้ (immutable) ลงใน assignment handoff snapshot
- Work Return แสดงเฉพาะ resolved snapshot เท่านั้น
- Work Return ต้องไม่ query taxonomy catalog แบบสด ต้องไม่อนุมาน category default เอง และต้องไม่เรียก AI
- 1 taxonomy check ตรงกับ 1 แถวใน Work Return
- แต่ละแถว Curation ที่แสดงผลรองรับค่าหลักได้ 1 ค่า บวก `condition_note` ที่เป็นทางเลือก
- แถวเก่าที่ซ่อนไว้ (hidden legacy rows) ต้องถูกเก็บรักษาไว้ตลอดขั้นตอน merge draft และการจัดการ payload เพื่อความเข้ากันได้ย้อนหลัง
- `requested_check_returns` ยังคงเป็น payload ที่เป็นทางการของ Work Return
- assignment ที่ออกไปแล้วต้องคงที่แม้ taxonomy catalog แบบสดจะเปลี่ยนแปลง
- การเปลี่ยนแปลงใด ๆ ต่อ handoff ที่ออกไปแล้ว ต้องผ่านขั้นตอน repair หรือ reissue อย่างชัดเจนเท่านั้น
- ถ้า handoff snapshot ไม่มี taxonomy check ที่ resolve แล้วจริง ให้ซ่อนส่วน Curation ของ Work Return ไว้
- taxonomy ที่ "required" หมายถึงพนักงานภาคสนามต้องตอบ ไม่ได้แปลว่าค่าที่ตอบต้องเป็นจริง
- ข้อสังเกตที่ไม่รู้จัก/ไม่อยู่ใน catalog ต้องไปอยู่ใน handoff guidance, `must_ask_question`, หรือหมายเหตุเพิ่มเติมของ Work Return ให้นักเขียนพิจารณาแทน
- ข้อสังเกตที่ไม่รู้จักจะไม่กลายเป็น catalog key เองโดยอัตโนมัติ
- ห้ามสร้างกลุ่ม `custom` ใหม่ หรือ key `custom.*` ใหม่ใน flow taxonomy/requested-check ที่ใช้งานอยู่จริง
- ห้ามใส่กลุ่ม `custom` หรือแถว `custom.*` ใด ๆ ลงใน handoff snapshot ที่สร้างใหม่ รวมถึงแถวเก่าที่เก็บไว้ด้วย
- ห้าม project `custom.*` เข้าไปเป็น taxonomy fact ที่เป็นทางการ หรือใช้กรอง Homepage Signals
- ต้องรักษาข้อมูล custom เก่าไว้ตามที่บันทึกไว้ (preserve at rest)
- snapshot ที่ออกไปแล้วและแก้ไขไม่ได้ (immutable) ซึ่งมี custom check อยู่ ยังคงอ่านและคืนค่าได้เพื่อความเข้ากันได้
- ห้ามลบข้อมูลเก่าที่เก็บไว้แล้ว

### CTA/Taxonomy Suggestion Lifecycle (locked)

**English**

- Precedence is always: human-confirmed > deterministic (supported by approved context) > AI guess.
- A suggestion exists to save the field worker typing, not to answer for them.
- A suggestion may prefill the value of a Work Return check. A suggestion must never pre-tick a check.
- Ticking is the human verification act. A field pack must never produce a return payload that reads as verified without a human ticking it.
- Suggestions are a snapshot of the latest generation run, not an accumulator across runs.
- A regeneration rebuilds suggestions, so a value the approved context no longer supports must disappear. Stale suggestions must be clearable.
- A generation run that produced no AI output (deterministic mode, or an AI failure that fell back) must not clobber stored suggestions.
- Suggestion provenance (`source`) must come from the approved context rows that produced the value. AI-supplied provenance is not trusted and is discarded.
- A suggestion must never contradict an already human-confirmed value for the same field.
- Suggestion generation is gated by the same rules as the field it suggests: CTA suggestions are place-only.
- Generating a suggestion for an ineligible item is forbidden, but deleting that item's legacy stored data is also forbidden.

**ภาษาไทย**

- ลำดับความสำคัญเสมอ: ค่าที่มนุษย์ยืนยัน > ค่า deterministic (มีหลักฐานใน approved context รองรับ) > ค่าที่ AI เดา
- suggestion มีไว้เพื่อลดการพิมพ์ของพนักงานภาคสนาม ไม่ใช่มีไว้ตอบแทนเขา
- suggestion เติมค่า (prefill) ลงในช่องของ Work Return check ได้ แต่ต้องไม่ติ๊ก check ให้ล่วงหน้าเด็ดขาด
- การติ๊กคือการกระทำที่มนุษย์ใช้ยืนยัน field pack ต้องไม่สร้าง payload ที่อ่านได้ว่า "ยืนยันแล้ว" โดยที่ไม่มีมนุษย์ติ๊ก
- suggestion เป็นภาพ ณ รอบ generate ล่าสุด ไม่ใช่ค่าที่สะสมข้ามรอบ
- การ regenerate ต้องสร้าง suggestion ใหม่ ค่าที่ approved context ไม่รองรับแล้วต้องหายไป ค่าที่ค้างต้องลบออกได้
- รอบ generate ที่ไม่ได้ผลลัพธ์จาก AI (โหมด deterministic หรือ AI ล้มเหลวแล้ว fallback) ต้องไม่ไปเขียนทับ suggestion ที่เก็บไว้
- ที่มา (`source`) ของ suggestion ต้องมาจากแถว approved context ที่ผลิตค่านั้นจริง ที่มาที่ AI ให้มาเองไม่น่าเชื่อถือและต้องถูกทิ้ง
- suggestion ต้องไม่ขัดแย้งกับค่าที่มนุษย์ยืนยันไปแล้วในฟิลด์เดียวกัน
- การสร้าง suggestion ถูกจำกัดด้วยกฎเดียวกับฟิลด์ที่มันแนะนำ: CTA suggestion ใช้กับ place เท่านั้น
- ห้ามสร้าง suggestion ให้ item ที่ไม่เข้าเกณฑ์ แต่ก็ห้ามลบข้อมูลเก่าที่เก็บไว้ของ item นั้นเช่นกัน

### Acceptance Boundary

**English**

- After Work Return is reviewed and accepted, required CTA and Taxonomy answers are human-confirmed workflow facts.
- Confirmation responsibility ends at Work Return and reviewer acceptance.
- Article Writers must not confirm CTA or Taxonomy again.
- Before entering Article Workspace, accepted results must be persisted as confirmed metadata or an equivalent immutable accepted snapshot.
- This is not a submission blocker.
- Article Workspace must not become a second verification stage.
- Accepted CTA/Taxonomy shown in Article Workspace must be read-only verification output.
- Any later editorial correction must be a separate override flow with provenance and must not rewrite the original human-confirmed result silently.

**ภาษาไทย**

- หลังจาก Work Return ถูกตรวจและอนุมัติ (reviewed and accepted) แล้ว คำตอบ CTA และ Taxonomy ที่ required ถือเป็นข้อเท็จจริงของ workflow ที่มนุษย์ยืนยันแล้ว (human-confirmed)
- หน้าที่ในการยืนยันสิ้นสุดที่ขั้นตอน Work Return และการอนุมัติของผู้ตรวจ (reviewer acceptance)
- ผู้เขียนบทความ (Article Writer) ต้องไม่ยืนยัน CTA หรือ Taxonomy ซ้ำอีก
- ก่อนเข้าสู่ Article Workspace ผลที่ได้รับการอนุมัติแล้วต้องถูกบันทึกเป็น confirmed metadata หรือ immutable accepted snapshot ที่เทียบเท่ากัน
- ข้อนี้ไม่ใช่ตัวบล็อกการ submit (not a submission blocker)
- Article Workspace ต้องไม่กลายเป็นด่านตรวจสอบยืนยันรอบที่สอง
- CTA/Taxonomy ที่ผ่านการอนุมัติแล้วและแสดงใน Article Workspace ต้องเป็นข้อมูลแสดงผลอย่างเดียว (read-only) ในฐานะผลการตรวจสอบ
- การแก้ไขเชิงบรรณาธิการภายหลัง ต้องแยกเป็น override flow ต่างหากที่มีที่มา (provenance) ชัดเจน และต้องไม่เขียนทับผลที่มนุษย์ยืนยันไว้เดิมแบบเงียบ ๆ

### Rework Round (locked)

**English**

- An accepted field assignment is a finished round. It is never reopened, un-accepted, or rewritten.
- Going back means issuing a NEW field round: the accepted round is closed as evidence, and a new field assignment is created with its own handoff snapshot and its own provenance.
- Nothing from the finished round is deleted: its handoff snapshot, submission, and `requested_check_returns` stay as the record of what was confirmed and when.
- An item has at most one open field round. Opening a rework round closes the previous one.
- The current (newest) round is the source of truth for display; superseded rounds must not shadow it.
- Acceptance patches confirmed values, it does not replace them:
  - `checked` + found → overwrite the confirmed value
  - `checked` + not found → the human verified there is none, clear the confirmed value
  - not `checked` → not verified this round, keep what a **previous accepted FIELD round** confirmed. A value is confirmed data only if a human ticked it and a reviewer accepted a field round; a value sitting in the draft of an item that never had an accepted field round is a writer self-set leftover and must be cleared, never carried forward. An accepted round of any other kind (e.g. editorial) never counts as this baseline, even though it also sets `accepted_submission_id` — that pointer only records provenance for its own kind, it does not vouch for CTA/taxonomy data.
- A rework round shows previously confirmed answers as read-only reference. They are never pre-checked: ticking a check means a human verified it in that round.
- Confirmed values may only be displayed as reviewer-confirmed when reviewer acceptance actually wrote them (`accepted_submission_id` is set). Legacy rows self-set in Article Workspace must not be presented as confirmed facts.
- Returning an accepted round for rework requires the actor to re-authenticate with their own password.
- Authority follows the management tree, not the role name alone: `owner` is the tree root and may rework any assignment; `admin` may rework only assignments inside their own management subtree; `user` may rework only an assignment they issued themselves. An admin from another branch of the tree has no authority over this work and is refused — a higher role does not grant cross-branch authority.
- Handing the new round to a different worker is an assignment decision and must clear the same assignee gates as creating an assignment (management subtree, internal-work permission, assignee role allowed for `field`). Being the original assigner is not sufficient on its own.

**ภาษาไทย**

- งานภาคสนามที่รับผ่านแล้ว (accepted) ถือเป็นรอบที่จบแล้ว จะไม่ถูกเปิดซ้ำ ไม่ถอนการรับงาน และไม่ถูกเขียนทับย้อนหลัง
- การย้อนกลับ = การเปิด "รอบใหม่": ปิดรอบเดิมไว้เป็นหลักฐาน แล้วสร้าง field assignment ใหม่ที่มี handoff snapshot และ provenance ของตัวเอง
- ห้ามลบข้อมูลของรอบที่จบแล้ว ทั้ง handoff snapshot, submission และ `requested_check_returns` ต้องคงอยู่เป็นบันทึกว่ายืนยันอะไรไว้เมื่อใด
- หนึ่ง item มีรอบภาคสนามที่เปิดอยู่ได้ไม่เกินหนึ่งรอบ การเปิดรอบใหม่จะปิดรอบก่อนหน้าเสมอ
- รอบปัจจุบัน (ใหม่ที่สุด) คือแหล่งความจริงสำหรับการแสดงผล รอบที่ถูกแทนที่แล้วต้องไม่บังข้อมูลของรอบปัจจุบัน
- การรับงานเป็นการ "patch" ค่าที่ยืนยันไว้ ไม่ใช่การแทนที่ทั้งชุด:
  - ติ๊ก + พบข้อมูล → เขียนทับค่าที่ยืนยันไว้เดิม
  - ติ๊ก + ไม่พบข้อมูล → มนุษย์ยืนยันว่าไม่มี ให้ล้างค่าเดิม
  - ไม่ติ๊ก → รอบนี้ไม่ได้ตรวจ ให้คงเฉพาะค่าที่ **รอบภาคสนาม (field) ก่อนหน้าติ๊กแล้วผ่านการรับงาน (accept)** เท่านั้น ค่าจะนับเป็นข้อมูลที่ยืนยันแล้วก็ต่อเมื่อมีคนติ๊กและผู้ตรวจรับงานรอบภาคสนามนั้น ถ้า item นั้นไม่เคยมีรอบภาคสนามที่ถูก accept เลย ค่าที่ค้างอยู่ใน draft คือค่าที่นักเขียนตั้งเอง ต้องล้าง ห้ามอุ้มค่าเดิมมาเป็นค่าที่ยืนยันแล้ว — assignment ประเภทอื่น (เช่น editorial) ที่ถูก accept ไม่นับเป็นฐานนี้ แม้จะมี `accepted_submission_id` เหมือนกัน เพราะ pointer นั้นบันทึก provenance ของงานประเภทนั้นเท่านั้น ไม่ได้ยืนยันข้อมูล CTA/taxonomy
- รอบใหม่ต้องแสดงคำตอบที่ยืนยันไว้รอบก่อนเป็นข้อมูลอ้างอิงแบบอ่านอย่างเดียว และต้องไม่ติ๊กมาให้ล่วงหน้า เพราะการติ๊ก = มนุษย์ตรวจแล้วในรอบนั้น
- ค่าที่ยืนยันแล้วจะแสดงในฐานะ "ยืนยันโดยผู้ตรวจ" ได้เฉพาะเมื่อการรับงานเป็นผู้เขียนค่านั้นจริง (มี `accepted_submission_id`) ข้อมูลเก่าที่ผู้เขียนบทความเคยตั้งเองใน Article Workspace ต้องไม่ถูกแสดงเป็นข้อเท็จจริงที่ยืนยันแล้ว
- การส่งงานที่รับผ่านแล้วกลับไปทำรอบใหม่ ต้องยืนยันรหัสผ่านของบัญชีผู้ใช้งานนั้นซ้ำเสมอ
- สิทธิ์ยึดตามสายบังคับบัญชา (management tree) ไม่ใช่ชื่อ role อย่างเดียว: `owner` เป็น root ของ tree ทำได้ทุกงาน; `admin` ทำได้เฉพาะงานที่อยู่ใน subtree ของตัวเอง; `user` ทำได้เฉพาะงานที่ตัวเองเป็นผู้สั่ง — **admin จากอีกสายไม่มีอำนาจเหนืองานของสายอื่น และต้องถูกปฏิเสธ** role ที่สูงกว่าไม่ได้แปลว่าข้ามสายได้
- การมอบงานรอบใหม่ให้คนอื่นถือเป็นการสั่งงาน ต้องผ่านด่านเดียวกับการสร้าง assignment (อยู่ใน subtree, สิทธิ์สั่งงานภายใน, role ของผู้รับต้องรับงาน `field` ได้) การเป็นผู้สั่งงานเดิมอย่างเดียวไม่พอ

### Admin Visibility of the Curation Signal (locked)

**English**

- Confirmed CTA/Taxonomy answers, once they reach the backend's review content record, are a curation signal for internal admin decision-making only (e.g. whether/how to feature an item) — never a public fact and never shown on the public frontend.
- Only an `owner` or `admin` backend session (an admin-panel account) may read this signal. Every other caller of `GET /review-content/:id` — `editor`/`freelance` sessions and the public review-access token — receives the same scrubbed public shape, with no CTA/Taxonomy curation fields.
- The `user` role is intentionally excluded from this gate too: it works exclusively inside the collector app and never authenticates into the admin panel, so it has no path to this endpoint in practice.
- This role list must exist in exactly one place (`REVIEW_CONTENT_INTERNAL_ROLES` in `backend/middleware/authMiddleware.js`), shared by both the route gate and the response-shaping check. The two must never hardcode separate copies of the list — a past drift between them let one check pass while the other still rejected the same role.

**ภาษาไทย**

- คำตอบ CTA/Taxonomy ที่ยืนยันแล้ว เมื่อไปถึง review content record ฝั่ง backend คือ curation signal สำหรับการตัดสินใจภายในของแอดมินเท่านั้น (เช่น จะ feature รายการนี้หรือไม่/อย่างไร) ไม่ใช่ข้อมูลสาธารณะ และห้ามแสดงบน public frontend เด็ดขาด
- มีเฉพาะ backend session ของ role `owner` หรือ `admin` (บัญชี admin panel) เท่านั้นที่อ่านสัญญาณนี้ได้ ผู้เรียก `GET /review-content/:id` รายอื่นทั้งหมด — session ของ `editor`/`freelance` และ public review-access token — จะได้ shape สาธารณะแบบเดียวกัน ไม่มีฟิลด์ CTA/Taxonomy curation ติดมาด้วย
- role `user` ถูกกันออกจากด่านนี้โดยตั้งใจเช่นกัน เพราะทำงานเฉพาะใน collector app เท่านั้น ไม่เคย login เข้า admin panel เลย จึงไม่มีทางเรียก endpoint นี้ในทางปฏิบัติ
- รายชื่อ role นี้ต้องมีอยู่ที่เดียวเท่านั้น (`REVIEW_CONTENT_INTERNAL_ROLES` ใน `backend/middleware/authMiddleware.js`) ใช้ร่วมกันทั้ง route gate และ response-shaping check ห้าม hardcode แยกกัน 2 ชุด — เคย drift กันมาแล้วครั้งหนึ่ง ทำให้เช็คจุดหนึ่งผ่านแต่อีกจุดยังปฏิเสธ role เดียวกันอยู่

## 7B. Operational Rules

**English**

- No merge, commit, or push without explicit approval.
- Runtime DB/test data exists only on the Runtime machine.
- Dev code audit must not assume Runtime records are locally available.
- Media Library deduplication must not be mixed with CTA / Curation changes.

Responsibility split:
- `default`: category taxonomy defaults owned by the future taxonomy resolver/catalog
- `mapping`: category/subtype mapping-selected checks owned by the future resolver
- `AI`: additive checks and suggestions only
- `resolved handoff snapshot`: immutable checklist copied into assignment handoff
- `Work Return response`: field-worker answers stored in `requested_check_returns`

Terminology note (not the full state machine, which remains TBD below): "approved" means different things at different layers, and confusing them costs real diagnostic time. Collector's item workflow status `approved` only means the collector-side ingest/editorial workflow finished — it says nothing about backend publication. Backend `review_contents.status` is a separate gate (`pending_review` -> reviewer decision); only once a review is accepted there does it get a `public_entity_id` and a corresponding `places`/`events` row created. Homepage curation, CTA analytics, and public listing all read from that second gate (`places.is_approved` + `place_translations` existing for the requested/`th` language) — a collector-"approved" item with no backend review decision yet, or a `places` row with no translations row, is invisible everywhere downstream even though it looks "done" upstream. Check both layers before assuming a "why isn't this showing up" report is a bug.

Placeholders:

- Exact approval workflow state machine: TBD / update later.
- Rejection/revision policy: TBD / update later.
- Taxonomy/revision assignment policy: TBD / update later.

**ภาษาไทย**

หมายเหตุเรื่องคำศัพท์ (ยังไม่ใช่ state machine แบบเต็ม ซึ่งยังเป็น TBD ด้านล่าง): คำว่า "approved" มีความหมายต่างกันไปตามชั้นของระบบ และถ้าสับสนกันจะเสียเวลาวินิจฉัยจริง สถานะ workflow ของ item ฝั่ง collector ที่เป็น `approved` หมายถึงแค่ workflow รับ-เตรียมข้อมูล/บรรณาธิการฝั่ง collector เสร็จแล้วเท่านั้น ไม่ได้บอกอะไรเรื่องการเผยแพร่ฝั่ง backend เลย ส่วน `review_contents.status` ฝั่ง backend เป็นด่านแยกต่างหาก (`pending_review` -> การตัดสินใจของผู้ตรวจ) ต่อเมื่อ review ผ่านด่านนี้แล้วเท่านั้นถึงจะได้ `public_entity_id` และมีการสร้างแถว `places`/`events` ขึ้นมาจริง homepage curation, CTA analytics และ public listing ทั้งหมดอ่านจากด่านที่สองนี้ (`places.is_approved` + ต้องมีแถว `place_translations` ของภาษาที่ขอ/`th`) — item ที่ "approved" แค่ฝั่ง collector แต่ยังไม่ผ่านการตัดสินใจ review ฝั่ง backend หรือมีแถว `places` แต่ไม่มี translation จะไม่ปรากฏที่ไหนเลยในฝั่งสาธารณะ ทั้งที่ดูเหมือน "เสร็จแล้ว" จากมุมต้นทาง ให้เช็คทั้งสองชั้นก่อนจะสรุปว่า "ทำไมไม่ขึ้น" คือบั๊ก

- ห้าม merge, commit, หรือ push โดยไม่ได้รับอนุมัติชัดเจนก่อน
- ข้อมูล Runtime DB/ข้อมูลทดสอบ มีอยู่เฉพาะบนเครื่อง Runtime เท่านั้น
- การ audit code บนเครื่อง Dev ต้องไม่สมมติว่ามีข้อมูล Runtime อยู่ในเครื่องนี้
- การลบข้อมูลซ้ำใน Media Library (deduplication) ต้องไม่ปะปนกับการแก้ไข CTA / Curation

การแบ่งความรับผิดชอบ:
- `default`: ค่า default ของ taxonomy ตามหมวดหมู่ เป็นของ taxonomy resolver/catalog ในอนาคต
- `mapping`: check ที่เลือกจาก mapping ตามหมวดหมู่/subtype เป็นของ resolver ในอนาคต
- `AI`: เพิ่ม check และคำแนะนำเท่านั้น (additive)
- `resolved handoff snapshot`: checklist ที่แก้ไขไม่ได้ (immutable) ถูกคัดลอกลงใน assignment handoff
- `Work Return response`: คำตอบของพนักงานภาคสนาม เก็บใน `requested_check_returns`

ส่วนที่ยังไม่กำหนด (Placeholders):

- state machine ของขั้นตอนอนุมัติแบบละเอียด: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบายการปฏิเสธ/แก้ไขงาน (rejection/revision): ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบาย taxonomy/revision assignment: ยังไม่กำหนด (TBD) / ทำภายหลัง

## 8. Public Frontend Policy

**English**

- Public frontend must use published/backend-controlled data.
- Public frontend must not fetch arbitrary external images as publish media.
- Public indexing is controlled by NEXT_PUBLIC_INDEXING.

Placeholders:

- SEO schema policy: TBD / update later.
- Public media URL policy: TBD / update later.
- Multilingual public content policy: TBD / update later.

**ภาษาไทย**

- public frontend ต้องใช้ข้อมูลที่ publish แล้วและควบคุมโดย backend เท่านั้น
- public frontend ต้องไม่ดึงรูปภายนอกใด ๆ มาใช้เป็น publish media ตามใจชอบ
- การ indexing สาธารณะควบคุมด้วย NEXT_PUBLIC_INDEXING

ส่วนที่ยังไม่กำหนด (Placeholders):

- นโยบาย SEO schema: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบาย URL ของสื่อสาธารณะ: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบายเนื้อหาสาธารณะหลายภาษา (multilingual public content): ยังไม่กำหนด (TBD) / ทำภายหลัง

## 9. Runtime / Deployment Policy

**English**

- Main dev path: D:\UbonCity_Web or D:\uboncity_web depending on machine.
- Runtime/test path: D:\UbonRuntime\repos\UbonCity_Web.
- Preferred flow:
  - push from dev
  - pull on runtime
  - restart stack
  - smoke test

Placeholders:

- Production deployment policy: TBD / update later.
- Backup/restore policy: TBD / update later.
- Rollback policy: TBD / update later.

**ภาษาไทย**

- path ของ dev หลัก: D:\UbonCity_Web หรือ D:\uboncity_web แล้วแต่เครื่อง
- path ของ Runtime/ทดสอบ: D:\UbonRuntime\repos\UbonCity_Web
- ลำดับที่แนะนำ:
  - push จาก dev
  - pull บน runtime
  - restart stack
  - smoke test

ส่วนที่ยังไม่กำหนด (Placeholders):

- นโยบายการ deploy ขึ้น production: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบาย backup/restore: ยังไม่กำหนด (TBD) / ทำภายหลัง
- นโยบาย rollback: ยังไม่กำหนด (TBD) / ทำภายหลัง

## 10. Testing / Smoke Policy

**English**

- Run node --check for touched JS files.
- Use git diff --check before commit.
- Runtime smoke required for workflow changes.
- For media changes, test:
  - Clean select
  - Clean reference-media select
  - Clean AI Draft
  - Submit Admin Review publish readiness

Placeholders:

- Automated test coverage policy: TBD / update later.
- Browser smoke checklist: TBD / update later.

**ภาษาไทย**

- รัน node --check กับไฟล์ JS ที่แก้ไข
- ใช้ git diff --check ก่อน commit
- การเปลี่ยนแปลง workflow ต้องทำ runtime smoke test
- สำหรับการเปลี่ยนแปลงด้านสื่อ ต้องทดสอบ:
  - การเลือกใน Clean
  - การเลือก reference-media ใน Clean
  - Clean AI Draft
  - publish readiness ของ Submit Admin Review

ส่วนที่ยังไม่กำหนด (Placeholders):

- นโยบายความครอบคลุมของ automated test: ยังไม่กำหนด (TBD) / ทำภายหลัง
- checklist สำหรับ browser smoke test: ยังไม่กำหนด (TBD) / ทำภายหลัง

## 10A. MySQL Migration Compatibility

**English**

- MySQL migrations must not use `ADD COLUMN IF NOT EXISTS` or `DROP COLUMN IF EXISTS`; MySQL 8.0.46 rejects those conditional column forms.
- Every additive or destructive column migration must use dynamic DDL guarded by `information_schema.COLUMNS`, following migrations 019 and 021.
- This rule is mandatory after two runtime failures: Phase 3 migration 019 and review-submission migration 021.

**ภาษาไทย**

- migration ฝั่ง MySQL ห้ามใช้ `ADD COLUMN IF NOT EXISTS` หรือ `DROP COLUMN IF EXISTS` เพราะ MySQL 8.0.46 ไม่รองรับ syntax conditional column เหล่านี้
- การเพิ่มหรือลบ column ทุกกรณีต้องใช้ dynamic DDL ที่ guard ด้วย `information_schema.COLUMNS` ตาม pattern ของ migration 019 และ 021
- กฎนี้เป็นข้อบังคับหลังพบ runtime failure ซ้ำ 2 รอบ: Phase 3 migration 019 และ review-submission migration 021

## 11. Documentation Policy

**English**

- PROJECT_POLICY.md is the root single source of truth for main project policies.
- PROJECT_STATE.md is the root current state / changelog / active branch summary.
- Component-local docs may reference root docs but should not duplicate main policy.
- If policy changes, update PROJECT_POLICY.md in the same branch or a documentation-only follow-up commit.
- PROJECT_POLICY.md is bilingual: every section carries English and Thai together in the same section. English is normative; Thai must carry equivalent meaning.
- Any edit to a policy rule must update both the English and Thai text in the same change — a policy edit that updates only one language is incomplete.

**ภาษาไทย**

- PROJECT_POLICY.md คือแหล่งอ้างอิงหลัก (single source of truth) ของนโยบายหลักในระดับราก (root)
- PROJECT_STATE.md คือสถานะปัจจุบัน/changelog/สรุป branch ที่ active อยู่ ในระดับราก
- เอกสารเฉพาะของแต่ละ component สามารถอ้างอิงเอกสารระดับรากได้ แต่ไม่ควรคัดลอกนโยบายหลักซ้ำ
- ถ้านโยบายเปลี่ยน ต้องอัปเดต PROJECT_POLICY.md ใน branch เดียวกัน หรือ commit เอกสารตามมาแยกต่างหาก
- PROJECT_POLICY.md เป็นสองภาษา: ทุก section มีภาษาอังกฤษและภาษาไทยอยู่ด้วยกันใน section เดียวกัน ภาษาอังกฤษเป็นข้อความหลัก (normative) ส่วนภาษาไทยต้องสื่อความหมายเดียวกัน
- การแก้ไขกฎใด ๆ ต้องแก้ทั้งข้อความภาษาอังกฤษและภาษาไทยในการแก้ไขครั้งเดียวกัน การแก้ policy ที่อัปเดตแค่ภาษาเดียวถือว่ายังไม่เสร็จสมบูรณ์
