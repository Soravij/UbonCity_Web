# Step 2 test triage

ฐานเปรียบเทียบมี 60 failures; รอบนี้มี 10 ชื่อเพิ่ม. ตรวจจาก test และ error
ของรอบ `npm run test:all` แล้วได้ A=9, B=1, C=0.

| Test (file:line) | Assert / error จริง | กลุ่ม |
| --- | --- | --- |
| `item claim repository support exists for process-1 locking` (`collector/tests/assignment-ui-scope.test.mjs:634`) | สแกน source เพื่อหา `function ensureItemClaimSupport(db) {` และ `ALTER TABLE content_items ...`; fail: `repository should include item claim support snippet: function ensureItemClaimSupport(db) {` | **A** — ยืนยัน helper ที่ตั้งใจลบ ไม่ได้เรียก API claim จริงใน test นี้; เสนอให้ลบ test นี้ |
| `assignments API data contract includes assignee display fields for linked summaries` (`collector/tests/assignment-ui-scope.test.mjs:967`) | สแกน repository หา JOIN/COALESCE และ DDL `assignee_name TEXT`, `assignee_contact TEXT`; fail ที่ `assignee_name TEXT` ไม่มีแล้ว | **A** — JOIN/COALESCE ยังอยู่ที่ `repository.mjs:3781`; DDL string หายพร้อม `ensureAssignmentTableSupport`, ไม่เกี่ยวกับ `server/index.mjs` ที่ลบ |
| `repository self-heals assignment-related foreign keys after legacy assignment migration` (`collector/tests/assignment-ui-scope.test.mjs:2345`) | ต้องพบ `ensureFieldPackAssignmentForeignKeySupport` และ rebuild/rename/drop legacy table; fail: helper ไม่พบ | **A** — เป็น legacy repair ที่ระบุให้ทิ้ง; เสนอให้ลบ test |
| `repository migration adds schema foundation columns for field packs drafts and submissions` (`collector/tests/schema-foundation.repository.test.mjs:104`) | สร้าง legacy table แล้วคาดว่า `createRepository()` เติม 6 columns; fail: `table content_drafts has no column named confirmed_cta_contact_json` ขณะ prepare ที่ `repository.mjs:3174` | **A** — ทดสอบ legacy repair ที่เลิกรองรับ; เสนอให้ลบ test |
| `legacy field pack rows load with safe metadata defaults after migration` (`collector/tests/schema-foundation.repository.test.mjs:124`) | สร้าง legacy `field_packs`, แล้วคาด metadata defaults หลัง `createRepository`; fail: `table field_packs has no column named ai_cta_contact_json` ที่ `repository.mjs:3244` | **A** — dependency คือ helper migration ที่เลิกสนับสนุน; เสนอให้ลบ test |
| `invalid requested_checks_json on legacy field pack row loads as safe default` (`collector/tests/schema-foundation.repository.test.mjs:165`) | legacy row มี JSON เสีย แล้วคาด safe default; fail ก่อนถึง assertion: `table field_packs has no column named ai_cta_contact_json` ที่ `repository.mjs:3244` | **A** — legacy repair test; เสนอให้ลบ test |
| `legacy draft and submission rows load with safe metadata defaults after migration` (`collector/tests/schema-foundation.repository.test.mjs:195`) | สร้าง legacy draft/submission แล้วคาด defaults; fail: `table content_drafts has no column named confirmed_cta_contact_json` ที่ `repository.mjs:3174` | **A** — legacy repair test; เสนอให้ลบ test |
| `repository migration adds recheck columns to existing nullable-source table that lacks them` (`collector/tests/translation-recheck.repository.test.mjs:269`) | สร้าง legacy `content_translations` แล้วคาด `createRepository()` เติม recheck columns และ `updateTranslationRecheck` ใช้ได้; fail: `table content_translations has no column named translation_recheck_status` ที่ `repository.mjs:3553` | **A** — legacy migration test; เสนอให้ลบ test |
| `repository migration rebuild path does not duplicate columns and leaves recheck columns present` (`collector/tests/translation-recheck.repository.test.mjs:318`) | ทดสอบ rebuild legacy translation table; fail: `table content_translations has no column named translation_recheck_status` ที่ `repository.mjs:3553` | **A** — legacy migration/rebuild test; เสนอให้ลบ test |
| `migration adds the database CHECK and bootstrap refuses an unmigrated workflow-head table` (`collector/tests/place-review-flag-migration.test.mjs:234`) | ต้องให้ทั้ง `openDatabase()` และ `createRepository()` ปฏิเสธ workflow-head ที่ขาด `place_review_flag`; `openDatabase()` ยังเรียก guards ที่ `client.mjs:46-47`, แต่ `createRepository()` ไม่มี call แล้วและ fail ที่ line 246 เป็น `table content_workflow_models has no column named place_review_flag` จาก prepare `repository.mjs:3706` แทน error guard ที่คาด | **B** — guard ไม่ตายทั้งหมด แต่ wiring ใน `createRepository()` หาย; ต้องเรียก guards ก่อน prepare statements (ไม่ใช่คืน schema helper) |

## กลุ่ม C

ไม่มี. โดยเฉพาะ test assignee ไม่ใช่ regression จากการลบ 286 บรรทัดใน
`server/index.mjs`: error ตรงกับ DDL text ของ `ensureAssignmentTableSupport`
ที่ถูกลบ ขณะที่ query display fields ยังอยู่.

ไม่มีโค้ดหรือ test ถูกแก้/ลบในรอบนี้.
