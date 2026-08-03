# Audit รอบ 2: Clean → crawl → merge shortcut — batch-scoped lock fix

วิธีการ: ตรวจต้นไม้จริงด้วยตนเองทั้งหมด (diff/grep/read/รันเทส/execute ฟังก์ชันจริง) ไม่ได้เชื่อ
`audit/clean-crawl-shortcut-implementation.md` เป็นหลักฐาน — ใช้เป็นข้อกล่าวอ้างที่ต้องพิสูจน์แยก

**สิ่งสำคัญที่ต้องแก้ความเข้าใจก่อน**: การแก้ไขรอบนี้ **ไม่ใช่ commit ใหม่** อย่างที่ระบุในบริบท —
`git log` ยืนยันว่า HEAD ยังเป็น commit เดิม `6051850` เหมือนรอบ 1 การแก้ไขทั้งหมดของรอบนี้เป็น
**การแก้ไขที่ยังไม่ commit** (`git status` แสดง `M` ใน 3 ไฟล์: `app.js`, เทส, และรายงาน implementer)
สิ่งนี้ไม่กระทบความถูกต้องของการตรวจ (ตรวจจากเนื้อหาไฟล์จริงในต้นไม้เหมือนเดิม) แต่ต้องระบุไว้เพราะ
กระทบวิธีการวัด gate (ต้อง stash ก่อนสลับ checkout ไป `main` แล้ว pop กลับ ไม่ใช่แค่สลับ branch เฉย ๆ)

ตัวเลข diff ที่วัดได้จริงจากต้นไม้ (เพื่อใช้เป็นหลักฐานอ้างอิงตลอดรายงานนี้):

```
git diff main --numstat   (รวมทุกอย่าง: commit เดิม + การแก้ที่ยังไม่ commit)
66  0  audit/clean-crawl-shortcut-implementation.md
73 12  collector/server/public/app.js
 0  1  collector/server/public/clean-item.html
23  8  collector/server/public/item-editor.js
91  0  collector/tests/clean-crawl-shortcut.surface.test.mjs
→ 5 files, 253 insertions(+), 21 deletions(-)   ✅ ตรงกับที่อ้าง "+253/-21 ใน 5 ไฟล์" เป๊ะ

git diff HEAD --numstat   (เฉพาะการแก้ของรอบนี้ ที่ยังไม่ commit บน commit 6051850)
18  4  audit/clean-crawl-shortcut-implementation.md
40  5  collector/server/public/app.js
41  0  collector/tests/clean-crawl-shortcut.surface.test.mjs
→ 3 files, 99 insertions(+), 9 deletions(-)     ❌ ไม่ตรงกับที่อ้าง "รอบแก้นี้ = 3 ไฟล์ +131-41"
```

**ข้อค้นพบ**: ตัวเลข "+253/-21" ที่อ้างว่าเป็น "ข้อกล่าวอ้างของ implementer" ถูกต้องจริง (ตรงกับตาราง
Files changed ในรายงาน implementer เป๊ะทุกไฟล์ — ดูข้อ 6) ส่วนตัวเลข "+131-41" สำหรับ "รอบแก้นี้" **ไม่ปรากฏ
อยู่จริงในรายงาน implementer เลย** (รายงานไม่มีตัวเลข delta เฉพาะรอบ 2 แยกไว้ มีแต่ตัวเลขสะสมเทียบ main)
และไม่ตรงกับตัวเลขจริงที่วัดได้ (+99/-9) เหมือนกับที่ "+184-42" ในรอบ 1 ก็ไม่ตรง — สรุปว่าเป็นความ
คลาดเคลื่อนของโจทย์ตรวจเอง ไม่ใช่ false claim ของ implementer (แยกตามที่ขอในข้อ 6)

---

## 1. ข้อ C ปิดจริงไหม (หลัก) — **PASS**

โค้ดที่เปลี่ยน (`git diff HEAD -- collector/server/public/app.js`, อ่านเต็มแล้ว):

- `state.crawlMergePendingExistingItemId = getCrawlMergeExistingItemId();` — อ่าน URL **ครั้งเดียว** ตอน state ถูกสร้าง (ตอนโหลดหน้า)
- `consumePendingCrawlMergeContext(batchUid)` (`app.js:5988-6000`): อ่านค่า pending, **set กลับเป็น 0 ทันที** (consume), ถ้ามีค่าอยู่จะเรียก `history.replaceState` ลบ `crawl_merge_item_id` ออกจาก URL จริง
- `getForcedSourceIntakeExistingItemId()` (`app.js:6003-6007`): เพิ่มเงื่อนไข `forcedBatchUid !== intakeBatchUid → return 0` — ผูกกับ batch UID ของ modal ที่เปิดอยู่จริง ไม่ใช่แค่ global state
- `openSourceIntakeModal({..., forcedMergeContext})`: forcedExistingItemId คำนวณจาก `forcedMergeContext.batchUid === batchUid` ของ modal นั้นเท่านั้น

**ตรวจแต่ละประเด็นย่อย:**

| ประเด็น | ผล | หลักฐาน |
| --- | --- | --- |
| consume ครั้งเดียว + ลบจาก URL จริง | ✅ PASS | รันเทส "Crawl merge context is consumed..." เอง — เรียก `consumeContext("batch-first")` จริงได้ `{batchUid:"batch-first", existingItemId:42}`, `state.crawlMergePendingExistingItemId` กลาย 0, `historyCalls[0]` = `[{page:"raw"}, "", "/?tab=raw"]` ยืนยัน `history.replaceState` ถูกเรียกด้วย URL ที่ลบ query ออกแล้วจริง |
| lock ผูกกับ batch เดียว ไม่ใช่แท็บ | ✅ PASS | รันเทสเดียวกันต่อ — เรียก `consumeContext("batch-second")` ได้ `{batchUid:"batch-second", existingItemId:0}` พิสูจน์ว่า batch ที่สองไม่ถูกบังคับ นอกจากนี้ตรวจ call site ที่สอง (`app.js:4917`, ปุ่ม "เปิด review" ของ batch เก่าในตาราง ingestion history) **ไม่ส่ง** `forcedMergeContext` เลย → ปลอดภัยจากการถูกบังคับ merge ย้อนหลังด้วย (แก้ collateral case ที่รอบ 1 ไม่เคยครอบคลุม) |
| reset ครบทั้ง 3 ทาง | ⚠️ PASS แต่ต้องแก้คำ | ในโค้ดจริงมีจุดเรียก `closeSourceIntakeModal()` แค่ **2 จุด**: (1) `btn-source-intake-confirm` handler หลัง import สำเร็จ (`app.js:10993` แนวเดิม) (2) `btn-source-intake-close` (`app.js:10941-10942`) ปุ่มนี้มีปุ่มเดียวในหน้า HTML label ว่า "ปิดหน้าต่าง" (`index.html:940`) **ไม่มีปุ่ม "ยกเลิก" แยกต่างหาก** — "ยกเลิก" กับ "ปิด modal" คือปุ่มเดียวกันในโค้ดจริง ไม่ใช่ 3 กลไกแยกกัน ทั้งสองจุดเรียก `buildClosedSourceIntakeState()` ที่ reset `forcedBatchUid`/`forcedExistingItemId` ครบถูกต้อง — พฤติกรรม reset ถูกต้อง แต่คำว่า "3 ทาง" ในโจทย์ตรวจไม่ตรงกับ UI จริงซึ่งมีแค่ 2 action |
| crawl รอบสองในแท็บเดิมเลือกปลายทางเองได้จริง — ต้องพิสูจน์ | ✅ PASS (execute จริง) | เหมือนแถวที่ 2 — พิสูจน์ด้วยการรัน `consumeContext("batch-second")` จริงแล้วได้ `existingItemId:0` ไม่ใช่แค่อ่านโค้ดเฉย ๆ |
| import ล้มเหลวกลางทาง (network/500) — lock ค้างไหม | ✅ PASS (ไม่ค้างแบบเสีย) | ตรวจ catch block ของ `btn-source-intake-confirm`: เมื่อ `api(...)` throw จะเข้า `catch (err) { setStatus("source-intake-status", err.message, true); }` **ไม่เรียก** `closeSourceIntakeModal()` — modal ยังเปิดอยู่ `forcedBatchUid`/`forcedExistingItemId` ยังอยู่ครบ (เก็บใน `state.sourceIntake` ไม่ใช่ URL) เพราะฉะนั้น retry ซ้ำยังล็อกเป้าหมายถูกต้อง ไม่ใช่สถานะพัง/เสีย ผู้ใช้กด "ปิดหน้าต่าง" เองได้เมื่อต้องการยกเลิกจริง ๆ ซึ่ง reset ครบ |
| reload หน้ากลางทางหลัง URL ถูกล้างแล้ว | ✅ PASS (ปลอดภัย) | URL ถูกล้างทันทีที่ `/api/collect` สำเร็จ (ก่อนเปิด modal ด้วยซ้ำ) reload ที่จุดใดก็ตามหลังจากนั้นจะรัน state init ใหม่ทั้งหมด `getCrawlMergeExistingItemId()` จะอ่านได้ 0 เพราะ URL ไม่มี param แล้ว — ไม่มีทาง "ฟื้น" lock เดิมกลับมาได้ ถือเป็นผลลัพธ์ปลอดภัยที่สุด (เทียบกับ reload ก่อนเริ่ม crawl เลย ซึ่ง URL ยังมี param อยู่ — พฤติกรรมยังคงเดิมถูกต้องคือยังพร้อมใช้ shortcut ได้) |

## 2. ข้อความเตือน + theme — **PASS**

- ตรวจลำดับโค้ดจริง (`app.js:10909-10932`): `consumePendingCrawlMergeContext(result.batch_uid)` (บรรทัด 10909) → `setStatus("source-status", ...ข้อความเตือน...)` (บรรทัด 10917-10922) → `await api(/api/source-raw-items...)` (10924) → `openSourceIntakeModal(...)` (10925) — ข้อความเตือนถูกเซ็ตจริงตามลำดับ **ก่อน** เปิด modal เสมอ ไม่ใช่แค่มีข้อความอยู่ในซอร์ส
- ข้อความ: `` `ดึงข้อมูล batch ${result.batch_uid} สำเร็จ (พบ ${rawCount} รายการ) กำลังจะรวมเข้า item #${forcedMergeContext.existingItemId} ในขั้น review` `` — ค่า `existingItemId` มาจาก `forcedMergeContext` ตัวเดียวกับที่จะถูกส่งเข้า `openSourceIntakeModal` และเข้าล็อกจริง (แหล่งเดียวกัน ไม่มีจุดคำนวณซ้ำที่อาจไม่ตรงกัน) — ระบุ item ถูกตัวจริง
- ไม่มี CSS ใหม่: ข้อความใช้ `setStatus("source-status", ...)` กลไกเดิมทุกประการ ไม่มี class ใหม่ ไม่มีการแก้ `styles.css` เลย (ยืนยันจาก diff --numstat ไม่มีบรรทัด styles.css)
- light/dark: ปุ่ม/สถานะยังใช้กลไกเดิมทั้งหมดจากรอบ 1 ที่ตรวจแล้วว่า `.utility-action` มี rule ครบทั้ง `styles.css:3925-3927` (light) และ `:5705-5719` (dark) — รอบนี้ไม่มีการเพิ่ม element ใหม่ที่ต้องใช้สไตล์เพิ่ม

## 3. เทสต์ — **PASS กลไก mutation-proof / ระบุประเภทเทสชัดเจน**

Mutation-proof ทำเองอิสระ (revert ไฟล์ production ทั้ง 3, ไม่แตะไฟล์เทส):

```
git hash-object ก่อน revert: app.js=217679f (dirty ยังไม่ commit) item-editor.js=9c9e1c8 clean-item.html=0510aad
git checkout main -- app.js item-editor.js clean-item.html
git hash-object หลัง revert: af43ba8 671f334 94c04c8   ✅ ตรงกับ main
node --test tests/clean-crawl-shortcut.surface.test.mjs → fail 5, pass 0   (ครบทั้ง 5 เคส)
คืนค่า: cp <backup>/app.js.dirty กลับ (เพราะ git checkout HEAD จะคืนได้แค่ก่อนรอบ 2) +
        git checkout HEAD -- item-editor.js clean-item.html
git hash-object หลังคืน: 217679f (ตรงกับ dirty เดิมเป๊ะ) 9c9e1c8 0510aad
node --test ... → pass 5, fail 0
```

restore แล้ว hash ตรงเป๊ะทุกไฟล์ 100% (verify ด้วย `git hash-object` เทียบค่าที่บันทึกไว้ก่อนเริ่ม)

**แยกประเภทเทสทีละตัว (อ่านซอร์สเทสทั้งไฟล์แล้ว):**

| เทส | ประเภท | รายละเอียด |
| --- | --- | --- |
| 1. "sends the current item as an explicit merge context" | ผสม | มี `Function(...)` eval เรียก `buildCleanCrawlMergeUrl(42)` จริง (behavioral) + regex อีก 2 เส้น |
| 2. "locks merge mode and injects the target..." | regex ล้วน | `assert.match` 8 ครั้ง ไม่ execute อะไรเลย |
| 3. **"Crawl merge context is consumed by one batch and expires for the next crawl"** (ใหม่) | **behavioral จริง** | ดึงซอร์สจริงของ `consumePendingCrawlMergeContext` และ `buildClosedSourceIntakeState` มา eval แล้วเรียกจริงด้วย fake `state`/`window` — ยืนยันครบ 4 กรณีที่อ้างไว้: consume ครั้งเดียว ✅, URL ถูกลบ (`historyCalls`) ✅, batch สองไม่ถูกบังคับ ✅, closed-state reset ครบทุก field ✅ |
| 4. **"Locked crawl announces its merge target before opening intake review"** (ใหม่) | **regex ล้วน** ⚠️ | ทั้ง 3 assertion เป็น `assert.match(appSource, /regex/)` ไม่มีการ execute ใด ๆ ชื่อเทสสื่อว่าเป็น behavioral (เช็คลำดับ/การแสดงผลจริง) แต่จริง ๆ พิสูจน์ได้แค่ว่า literal string/property name เหล่านั้นมีอยู่ในไฟล์ ไม่ได้พิสูจน์ลำดับการทำงานจริง (ลำดับนั้นผมตรวจแยกด้วยการอ่านโค้ดเองในข้อ 2 แล้ว) |
| 5. "absent for role user..." | regex ล้วน | เหมือนรอบ 1 |

**สรุปข้อ 3.4 ในโจทย์** ("behavioral test ที่เพิ่มมาครอบ 4 กรณีที่อ้างไว้จริงไหม") — **จริง ครบทั้ง 4 กรณี** อยู่ในเทสตัวที่ 3 ตัวเดียว ยืนยันด้วยการรันเองแล้ว ไม่ใช่แค่อ่านคำกล่าวอ้าง แต่เทสตัวที่ 4 (เรื่อง "ข้อความเตือน") **ไม่ใช่ behavioral** ตามที่ชื่อบอกเป็นนัย ควรระบุในรายงานให้ตรงว่าเป็น source-text guard ไม่ใช่การพิสูจน์ลำดับการทำงานจริงด้วยตัวเทสเอง (ลำดับจริงต้องอ่านโค้ดแยกต่างหากแบบที่ทำในข้อ 2)

## 4. ผลข้างเคียงต่อ app.js/role gating — **PASS**

- `item-editor.js` และ `clean-item.html` **ไม่มีการแก้ไขในรอบนี้เลย** (ไม่อยู่ใน `git diff HEAD --numstat`, hash ตรงกับ HEAD/round-1 เป๊ะ: `9c9e1c8`, `0510aad`) → role gating (`isAdminUser()`, เงื่อนไขสร้างปุ่ม) **ไม่ถูกแตะต้องเลยในทางกายภาพ** ผลตรวจรอบ 1 (PASS) ยังใช้ได้เต็มร้อย
- ตรวจโค้ด `app.js` ทุกจุดที่แก้เพื่อยืนยัน backward-compatible เมื่อไม่มี context:
  - `getCrawlMergeExistingItemId()` คืน 0 เมื่อไม่มี query param — ปลอดภัยบนทุกหน้าที่ใช้ `app.js` ร่วม (เช่นหน้าแรก) เพราะเป็นแค่การอ่าน URL เฉย ๆ ไม่มี side effect
  - เมื่อ `forcedMergeContext` เป็น `null` (ค่า default พารามิเตอร์ของ `openSourceIntakeModal`) — `String(forcedMergeContext?.batchUid || "").trim()` ได้ `""` อย่างปลอดภัย (ไม่ได้ `"undefined"` string) และ `forcedExistingItemId` ลงเอยที่ 0 เสมอในทุก branch คำนวณ — ข้อความสถานะกลับไปเป็นข้อความเดิมทุกตัวอักษร (`ดึงข้อมูล batch ... สำเร็จ (พบ ... รายการ รอคัดรับเข้า raw)`) ตรงกับพฤติกรรมก่อนรอบ 2 เป๊ะ
- `node --check app.js` ผ่าน (syntax ปลอดภัย)

## 5. GATE — **PASS**

รันเองอิสระทั้งสองฝั่ง สลับ checkout ในที่เดิม (ต้อง stash การแก้ที่ยังไม่ commit ก่อนสลับไป `main` แล้ว pop กลับ เพราะรอบนี้เป็น uncommitted diff ไม่ใช่ commit):

```
git stash push -u -m round2-audit-temp-stash
git checkout main   → npm run test:all
  ℹ tests 816  pass 756  fail 59  skipped 1   (เหมือนรอบ 1 ทุกประการ)

git checkout codex/clean-crawl-merge-shortcut   → git stash pop (คืนของครบ)
  → npm run test:all (สถานะ dirty รอบ 2)
  ℹ tests 821  pass 761  fail 59  skipped 1   (+2 จากรอบ 1 ตรงกับเทสใหม่ 2 ตัว)

diff(main_failnames, branch_failnames)   → ไม่มีผลต่าง (0 new, 0 missing)
```

**59/59/new 0/missing 0 ตรงตามคาด ยืนยันด้วยการรันจริงทั้งสองฝั่งของรอบนี้เอง** หลัง pop stash แล้วตรวจ `git hash-object` ของทั้ง 3 ไฟล์ dirty อีกครั้ง (`217679f`, `e35afd6`, `a7e96f7`) — ตรงกับค่าที่บันทึกไว้ตอนเริ่มต้นเป๊ะ ต้นไม้ไม่เพี้ยนจากการ stash/สลับ checkout

## 6. ความถูกต้องของรายงาน implementer — **ปรับปรุงจากรอบ 1 ถูกต้อง ไม่พบ false claim ใหม่**

| ข้ออ้างในรายงาน implementer | ตรงจริงไหม | หลักฐาน |
| --- | --- | --- |
| ตาราง Files: `app.js +73/-12` (สะสม) | ✅ ตรง | `git diff main --numstat` = 73/12 |
| ตาราง Files: **test file `+91`** (สะสม, แก้จากรอบ 1 ที่เคยผิดเป็น `+45`) | ✅ **แก้ถูกแล้ว** | numstat จริง = 91/0 ตรงเป๊ะ และรายงานเองก็อธิบายไว้ตรงว่า "at commit 6051850 the test file was +50 (not +45); ... now +91" — ยอมรับข้อผิดพลาดรอบก่อนอย่างถูกต้อง |
| ตาราง Files: `audit doc +66` | ✅ ตรง | numstat = 66/0 |
| "+253/-21 ใน 5 ไฟล์" (ยอดรวมเทียบ main) | ✅ ตรง | ตรงกับ `git diff main --numstat` เป๊ะทุกไฟล์ (ดูตารางต้นรายงานนี้) |
| "read once ... consumed only after /api/collect returns batch_uid ... removed via history.replaceState" | ✅ ตรง | ตรวจโค้ด+รันเทสยืนยันแล้ว (ข้อ 1) |
| "applied only when its batch UID matches the modal batch UID" | ✅ ตรง | ตรวจโค้ดยืนยันแล้ว (ข้อ 1) |
| "Closing, cancelling, or successfully importing resets ..." | ⚠️ **คำคลาดเคลื่อนเล็กน้อย ไม่ใช่ false claim หนัก** | ในโค้ดจริงมีแค่ 2 action (import สำเร็จ, ปุ่ม "ปิดหน้าต่าง" เดียว) ไม่มีปุ่ม "cancel" แยก คำว่า "closing, cancelling" ในรายงานหมายถึงปุ่มเดียวกัน ไม่ใช่ 2 กลไกที่ต่างกันจริง — พฤติกรรม reset ที่อธิบายยังถูกต้อง แต่ควรแก้คำให้ตรงกับ UI จริง |
| ข้อความเตือนก่อนเปิด modal ระบุ item ถูกต้อง | ✅ ตรง | ตรวจลำดับโค้ด+ค่าที่มาจากแหล่งเดียวกันแล้ว (ข้อ 2) |
| "No CSS class was added" | ✅ ตรง | ไม่มีการแก้ styles.css เลย |
| คำอธิบายเทสตัวที่ 3 (execute จริง, ครอบ 4 กรณี) | ✅ ตรง | รันเองยืนยันครบ (ข้อ 3) |
| "restoring app.js from main makes the amended test file fail ... confirms coupling" | ✅ ตรง | ทำ mutation-proof เองยืนยันแล้ว (ข้อ 3) |
| ตาราง gate รอบ 2 (59 ชื่อเดิม, new none, missing none) | ✅ ตรง | รันเองยืนยันแล้ว (ข้อ 5) |

**ไม่พบ false claim ใหม่ในรอบนี้** — implementer แก้ตัวเลขที่รอบ 1 ตรวจพบผิด (`+45→+50`) ถูกต้องครบถ้วน และรายงานความคืบหน้ารอบ 2 อ่านตรงกับต้นไม้จริงแทบทุกจุด มีเพียงคำอธิบาย "closing, cancelling" ที่ควรแก้ให้ตรงกับ UI จริง (ปุ่มเดียว ไม่ใช่ 2 กลไก) ซึ่งเป็นความคลาดเคลื่อนของถ้อยคำ ไม่ใช่ความคลาดเคลื่อนของพฤติกรรมโค้ด

**แยกจาก implementer**: ตัวเลข "+131-41" สำหรับ "รอบแก้นี้" ที่ปรากฏในคำสั่ง audit เอง ไม่ตรงกับต้นไม้จริง (+99/-9) และไม่ปรากฏในรายงาน implementer เลย เป็นความคลาดเคลื่อนของโจทย์ตรวจซ้ำเป็นครั้งที่ 2 (เหมือน "+184-42" ในรอบ 1) ควรตรวจแหล่งที่มาของตัวเลขเหล่านี้ก่อนใส่ในโจทย์ audit ครั้งต่อไป

---

## คำตัดสินรวม

**ข้อ C ที่เป็น CONDITIONAL ในรอบ 1 ปิดจริงแล้ว — ผ่าน PASS เต็มทุกประเด็นย่อย** ยืนยันด้วยการอ่านโค้ด, รันเทสจริง (ไม่ใช่แค่เชื่อผลจากรายงาน), และ trace เส้นทางการเรียกทุกจุด (รวมถึง collateral case ของปุ่ม "เปิด review" batch เก่าที่รอบ 1 ไม่เคยครอบคลุม) — batch-scoped lock ทำงานถูกต้อง, ไม่ค้างเมื่อ import ล้มเหลว, ปลอดภัยเมื่อ reload

ทุกข้อ (1-6) ผ่านการตรวจอิสระแล้ว **ไม่มี FAIL หรือ CONDITIONAL เหลืออยู่** ประเด็นที่เหลือเป็นเรื่อง
ถ้อยคำในรายงาน/โจทย์ตรวจเท่านั้น (คำว่า "cancelling" ควรแก้ให้ตรง UI จริง, ตัวเลข "+131-41" ในโจทย์ตรวจ
ไม่ตรงกับต้นไม้จริง) ไม่กระทบความถูกต้องของโค้ด

**สรุป: โค้ดพร้อม merge ได้** เมื่อทีมตัดสินใจ commit การแก้ไขที่ยังค้างอยู่ในต้นไม้ (working tree มีการแก้ที่ยังไม่ commit 3 ไฟล์ ต้อง `git add`/`git commit` ก่อนจะ merge ได้จริง — ปัจจุบันยังไม่มี commit ใหม่ต่อจาก `6051850` เลย)
