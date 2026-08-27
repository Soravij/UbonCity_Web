# Audit: branch `fix/writing-assigned-to-in-review` (af3d341) vs `main`

- โหมด: READ-ONLY สำหรับผู้ตรวจ (แก้ไฟล์ชั่วคราว 1 ครั้งเฉพาะ revert-proof แล้วคืนค่า, ยืนยันด้วย git hash-object)
- เครื่อง: Runtime, checked out ที่ `fix/writing-assigned-to-in-review` (af3d341) อยู่แล้ว
- ไม่มีการ merge / kill / restart collector

## Verdict: **BLOCKER**

เหตุผลหลัก: gate fail count ไม่ตรง baseline (69 vs 59 ที่แจ้งมา) และ 2 ใน fail เหล่านั้น
เป็น **regression ที่เกิดจาก branch นี้โดยตรง** — มี hardcoded ladder snapshot อีกไฟล์หนึ่ง
(`collector/tests/content-type-transition-rules.test.mjs`) ที่ branch ไม่ได้อัปเดตให้ตรงกัน

---

## 1. diff ทั้ง branch แตะอะไรบ้างจริง ๆ

`git diff main..af3d341 --stat`:
```
collector/db/repository.mjs                                          | 2 +-
collector/tests/place-ladder-writing-assigned-in-review.test.mjs     | 77 +++++++++
2 files changed, 78 insertions(+), 1 deletion(-)
```
ยืนยัน: มีแค่ 1 บรรทัดจริงใน `repository.mjs:525` (เพิ่ม `"in_review"` เข้า Set) +
ไฟล์เทสใหม่ 1 ไฟล์ (77 บรรทัด, ทั้งไฟล์เป็นไฟล์ใหม่ ไม่แตะไฟล์เทสเดิม) — **ไม่มี scope creep**
ในความหมายที่ diff แคบจริง แต่ (ดูข้อ 6) diff นี้ "แคบเกินไป" เพราะไม่ได้อัปเดตไฟล์เทสอื่นที่พึ่งพา
ค่าเดิมของ ladder เดียวกัน

## 2. edge ใหม่ทำให้ submit-review เดินผ่าน resolvePlaceLadderWorkflowPatch จริงหรือไม่

ยืนยันจากโค้ดจริง:
- `resolvePlaceLadderWorkflowPatch` (`collector/server/index.mjs:4298-4313`) เรียก
  `repo.canTransition("place","production",currentProductionState,attemptedProductionState,itemId)`
  (`:4303`) — ถ้า true จะ `return patch` ทั้งก้อนโดยไม่ตัดอะไรออก
- `canTransition` (`collector/db/repository.mjs:4759-4773`) เช็ค
  `rulesForGroup?.[fromState].has(toState)` จาก `TRANSITION_RULES.place.production`
- หลัง fix, `repository.mjs:525`:
  `writing_assigned: new Set(["writing", "ready_for_writer", "field_review", "in_review"])`
  → `canTransition("place","production","writing_assigned","in_review")` = **true**
- `submit-review` route (`index.mjs:9541`) เรียก
  `transitionArticleProcessState(req, item, currentStatus, "ready_for_review", ...)` →
  `mapArticleProcessStatusToWorkflowPatch("ready_for_review","place")` (`:4566-4572`) คืน
  `{production_state:"in_review", ...}` → ผ่าน `resolvePlaceLadderWorkflowPatch` แล้ว **ไม่ถูกตัด**
  `production_state` อีกต่อไป

**สรุป: ใช่ — edge ใหม่ทำให้ patch เดินผ่านโดยไม่ถูกตัด `production_state` จริง** (ยืนยันด้วย
โค้ดสถิต และยืนยันซ้ำด้วย test ใหม่ที่ผ่าน: `ok 701 - canTransition place writing_assigned →
in_review = true`)

## 3. ผลข้างเคียงของการเปิด edge นี้

**Caller อื่นนอกจาก submit-review ที่ยิง transition นี้ได้**: มี — generic route
`POST /api/items/:id/article-process/transition` (`index.mjs:9332-9384`) ก็เรียก
`transitionArticleProcessState(..., nextStatus, ...)` เดียวกัน (call site `:9375`) โดยไม่ผ่าน
เงื่อนไข assignment lookup ที่ `submit-review` มี (`:9420-9426` เช็ค editorial assignment
state `assigned/in_progress/revision_requested`) — ดังนั้นถ้า role มีสิทธิ์
(`canTransitionArticleProcessByRole`, `:9352`) และ `currentStatus→"ready_for_review"` ผ่าน
`canTransitionArticleProcess` (`:9363`, ใช้ `ARTICLE_PROCESS_TRANSITIONS.drafting.has("ready_for_review")`
ที่ `:2848` เป็น true อยู่แล้ว) ก็เรียก transition ตรงได้เลยโดยไม่ต้องผ่านการ submit-review ก่อน

**ใครเคยพึ่งพาว่า edge นี้ "ไม่ถูกกฎ"**: พบจริง 1 จุด —
`collector/tests/content-type-transition-rules.test.mjs` มี hardcoded mirror ของ ladder เดียวกัน
คนละชุดกับ `repository.mjs`:
- `PLACE_PRODUCTION_RULES.writing_assigned` (`:61`) ยังเป็น
  `["writing", "ready_for_writer", "field_review"]` — **ไม่มี "in_review"**
- ใช้ยืนยัน 2 เทส:
  - `"place contains only its final positional ladder..."` (`:149`) เรียก
    `assertAllTypeRulesMatchExpectedGraph()` (`:137-147`) ที่ทำ
    `assert.deepEqual(serializeRules(TRANSITION_RULES.place), expectedPlace)` — array length ไม่
    เท่ากันแล้ว (4 vs 3) → **fail แน่นอนตาม logic นิ่ง ไม่ต้องรันก็คาดได้**, และ gate run ยืนยันแล้วว่า fail จริง
  - `"each content type accepts exactly its expected transition graph"` (`:263`) วนเช็ค
    `expectedAllowed` จาก `PLACE_PRODUCTION_RULES` เดิม แล้วคาดหวังว่า
    `writing_assigned→in_review` ต้องถูก reject (`assert.throws(...)`) — แต่ตอนนี้ผ่านแล้วจึงไม่ throw
    → fail ด้วยข้อความ `"Missing expected exception: place production writing_assigned -> in_review
    should remain rejected"` (ตรงกับ gate output จริง)
- ยืนยันว่าไฟล์นี้ไม่ได้ถูกแตะโดย branch นี้เลย (`git show af3d341 --stat` ไม่มีไฟล์นี้) และ commit
  ล่าสุดที่แตะไฟล์นี้คือ `da3305d` ("fix(test): update place fixture for writing_assigned->field_review
  backward edge") ซึ่งเป็น pattern เดียวกัน (ต้องอัปเดตไฟล์นี้คู่กับทุกครั้งที่ ladder เปลี่ยน) —
  branch นี้พลาด step นั้น

## 4. deriveArticleProcessStatus เมื่อ production_state = in_review

`collector/server/index.mjs:4481`:
```js
if (productionState === "in_review" || publishableSource?.ready_for_publish_source) return "ready_for_review";
```
เมื่อ `production_state==="in_review"` → คืนค่า `"ready_for_review"` **ตรงกับที่ปุ่มต้องการพอดี**:
- `revisionBtn` (`article-submit-page.js:934`): ต้องการ status ∈
  `["ready_for_review","ready_for_sync","submitted_for_admin_review"]` — ผ่าน
- `approveBtn` (`article-submit-page.js:936-943`): ต้องการ `status==="ready_for_review"` — ผ่าน
  (ยังมีเงื่อนไขเพิ่มเติม `validation.ok`, `translationGate.allReady`,
  `translationRecheckGate.allReady` ที่ต้องเช็คแยกต่างหาก ไม่ใช่ scope ของ audit นี้)

## 5. item 39 ใน DB จริงตอนนี้

Query ตรงจาก `collector/data/collector.db` (read-only):
```
content_workflow_models (id 231, content_item_id 39):
  production_state: "writing_assigned"
  publication_state: "draft"
  place_review_flag: "none"
content_assignments (content_item_id 39, editorial, id 39):
  state: "submitted"
  latest_submission_id: 19
```
Item 39 ยัง **อยู่ที่ `writing_assigned` เป๊ะ** — คือ fromState ที่ edge ใหม่นี้ปลดล็อกพอดี ดังนั้น
**เมื่อมีการยิง transition ไป `ready_for_review` อีกครั้ง** (ผ่าน generic transition route
`:9332` หรือถ้ามี retry ทาง submit-review) จะผ่าน ladder ได้ทันทีโดยไม่ต้องรอ assignment
เปลี่ยนจาก `"submitted"` เป็น `"accepted"` เลย — เพราะ path หลัก (`production_state==="in_review"`)
ไม่ได้ผูกกับ assignment state ใด ๆ, ส่วน path สำรอง (`ready_for_publish_source`) ที่ติดเงื่อนไข
`assignmentAccepted` ยังคงเป็น false เหมือนเดิม แต่ตอนนี้ **ไม่จำเป็นต้องพึ่ง path สำรองแล้ว**

ข้อควรระวัง (นอก scope ข้อนี้แต่ต้องบันทึกไว้): production_state ปัจจุบันยังไม่ขยับเพราะ
transition ครั้งก่อน (submit-review ตอน 14:44:27) ถูก patch ตัดทิ้งไปแล้ว (ตามที่รายงานรอบก่อน)
edge ใหม่ **ไม่ได้ trigger การเขียนย้อนหลังให้ item 39 อัตโนมัติ** — ต้องมีการยิง action ใหม่อีกครั้ง
(เช่น submit-review ซ้ำ หรือ generic transition) หลัง merge ถึงจะเห็นผลกับ item 39 จริง ๆ
และปุ่ม submit-review ของ writer อาจกดซ้ำไม่ได้เพราะ assignment state เป็น `"submitted"` แล้ว
(`editorialAssignment` lookup `index.mjs:9420-9426` ไม่ match) — น่าจะต้องใช้ generic transition
route โดย role ที่มีสิทธิ์แทน

## 6. Gate measurement (รันครั้งเดียว) + revert proof

รัน `npm run gate` 1 ครั้งบน branch นี้ผ่าน agent `test-runner`:
```
TOTAL: 1044   PASS: 974   FAIL: 69   (baseline ที่แจ้งมา = 59)
```
**เลขไม่ตรง baseline (69 ≠ 59) → รายงานแล้วหยุดตาม stop rule ไม่รันซ้ำ ไม่ไล่แก้ fail เดิม**

จาก fail ทั้ง 69 รายการ มี 2 รายการที่ **สืบสาวได้ชัดเจนว่าเป็น regression จาก branch นี้โดยตรง**
(ข้อความ error พูดถึง `writing_assigned -> in_review` ตรง ๆ):
```
not ok 387 - place contains only its final positional ladder while non-place types retain the complete legacy graph
  location: collector/tests/content-type-transition-rules.test.mjs:149:1
  error: place must contain exactly its positional ladder without parking edges

not ok 390 - each content type accepts exactly its expected transition graph
  location: collector/tests/content-type-transition-rules.test.mjs:263:1
  error: Missing expected exception: place production writing_assigned -> in_review should remain rejected
```
ไฟล์เทสใหม่ของ branch เอง (`place-ladder-writing-assigned-in-review.test.mjs`) ผ่านทั้ง 4 เทส
(`ok 700-703`) อีก ~67 รายการที่เหลือดูไม่เกี่ยวกับ ladder นี้ (translation/UI/assignment-scope
เทสต่าง ๆ) น่าจะเป็น pre-existing failures แต่ **ยืนยันไม่ได้ว่าตรงกับ baseline 59 เป๊ะหรือไม่**
เพราะไม่มีรายการ baseline ตัวจริงให้ diff เทียบ (มีแต่ตัวเลข 59) — ค้างเป็นจุดที่ต้องเช็คแยกต่างหาก
ไม่ใช่ scope ของ branch นี้

**Revert proof**:
1. บันทึก hash เดิมของ `repository.mjs` ก่อนแก้: `git hash-object` =
   `cde258844758c33dfab2cafd3655aa3643f016df`
2. ถอด `"in_review"` ออกจาก `writing_assigned` Set ที่ `:525` ชั่วคราว
3. รัน `node --test collector/tests/place-ladder-writing-assigned-in-review.test.mjs` เฉพาะไฟล์นี้
   → เทสแรก **fail ตามคาด**:
   ```
   not ok 1 - writing_assigned forward targets include in_review (revert-proof)
   error: 'writing_assigned targets must include in_review; got [field_review, ready_for_writer, writing]'
   ```
   (เทส 2-4 พังด้วย ENOENT เรื่อง path schema.sql — เป็นปัญหาการเรียกคำสั่งผิด cwd ของผู้ตรวจ ไม่ใช่
   ปัญหาโค้ด จึงไม่ใช้เป็นหลักฐาน — เทส 1 พอเป็นหลักฐาน revert-proof เพียงพอแล้วเพราะเช็ค
   `TRANSITION_RULES` ตรง ๆ โดยไม่พึ่ง DB)
4. คืนบรรทัดกลับ แล้วยืนยันด้วย `git hash-object` อีกครั้ง =
   `cde258844758c33dfab2cafd3655aa3643f016df` — **ตรงกับ hash เดิมทุกตัวอักษร**, `git diff`/
   `git status --short` ของไฟล์นี้ว่างเปล่า ยืนยันคืนค่าสำเร็จ 100%

---

## สรุป

Fix ที่แท้จริง (`repository.mjs:525`) ถูกต้องตามที่ audit รอบก่อนเสนอ และ revert-proof ยืนยันว่า
เทสใหม่ผูกกับโค้ดจริง ไม่ใช่ tautology — **แต่ branch ยังไม่ mergeable** เพราะพลาดอัปเดตไฟล์เทส
คู่ขนาน (`content-type-transition-rules.test.mjs` ที่มี hardcoded ladder snapshot ของตัวเอง)
ทำให้เกิด regression 2 รายการ และ gate fail count ไม่ตรง baseline ที่แจ้งมา (69 vs 59) ซึ่งต้อง
สอบทานเพิ่มก่อนพิจารณา merge

## Files/lines อ้างอิงหลัก
- `collector/db/repository.mjs:525` (fix), `:4759-4773` (`canTransition`)
- `collector/server/index.mjs:4298-4313, 4470-4502, 4551-4590, 9315-9384, 9386-9555`
- `collector/tests/content-type-transition-rules.test.mjs:53-71, 137-168, 263-296`
  (**ต้องอัปเดตคู่กับ fix นี้ — ยังไม่ได้ทำ**)
- `collector/tests/place-ladder-writing-assigned-in-review.test.mjs` (ไฟล์ใหม่ทั้งไฟล์, 4 เทสผ่านหมด)
- DB (read-only): `content_workflow_models` id 231, `content_assignments` id 39 (item 39)
