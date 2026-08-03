# Audit: Clean → crawl → merge shortcut (`codex/clean-crawl-merge-shortcut` vs `main`)

วิธีการ: ตรวจจากต้นไม้จริงทั้งหมดด้วยตนเอง (diff/grep/read/รันเทส) ไม่ได้อ่านจาก
`audit/clean-crawl-shortcut-implementation.md` เป็นหลักฐาน — ใช้เป็นเพียงข้อกล่าวอ้างที่ต้องยืนยันแยก
วิธีวัด gate: สลับ checkout ในที่เดิม (`D:\uboncity_web`) ไม่ใช้ worktree ตามที่กำหนด

---

## A. ขอบเขต — **PASS (ตัวเลขในคำสั่ง audit ไม่ตรง ต้องแก้)**

คำสั่งจริงที่รัน: `git diff main...HEAD --stat` และ `--numstat`

```
audit/clean-crawl-shortcut-implementation.md       | 52 ++++++
collector/server/public/app.js                     | 42 +++++--
collector/server/public/clean-item.html            |  1 -
collector/server/public/item-editor.js             | 31 +++--
collector/tests/clean-crawl-shortcut.surface.test.mjs | 50 ++++
5 files changed, 159 insertions(+), 17 deletions(-)
```

numstat แยกไฟล์ (ins/del): audit doc 52/0, app.js 34/8, clean-item.html 0/1, item-editor.js 23/8, test 50/0

- ✅ 5 ไฟล์จริง ตรงกับที่อ้าง
- ❌ **ตัวเลข "+184-42" ในคำสั่ง audit และ "app.js +54-28" ไม่ตรงกับต้นไม้จริง** ตัวเลขจริงคือ **+159/-17 รวม 5 ไฟล์** และ **app.js คือ +34/-8**. ตัวเลขนี้ไม่ปรากฏในรายงาน implementer เช่นกัน (รายงานระบุ app.js +34/-8 ถูกต้อง) จึงเป็นความคลาดเคลื่อนของโจทย์ตรวจเอง ไม่ใช่ false claim ของ implementer — บันทึกไว้เพื่อแก้ไขความเข้าใจ
- ✅ ไม่มี endpoint ใหม่: `git diff` ไม่แตะ `index.mjs`/backend route ใด ๆ
- ✅ ไม่มีการแก้ transition rule/state machine: ไม่แตะ `workflow.mjs`, `repository.mjs`
- ✅ ไม่มี CSS class ใหม่: ไม่แตะ `styles.css` เลย (ดูข้อ F)
- ✅ `node --check collector/server/public/app.js` และ `item-editor.js` ผ่าน (syntax ปลอดภัยสำหรับหน้าแรกที่ใช้ไฟล์ร่วมกัน)
- ✅ พฤติกรรมเดิมเมื่อไม่มี `crawl_merge_item_id`: ทุกจุดที่แก้ใน `app.js` ใช้ pattern `forcedExistingItemId ? X : <ของเดิม>` หรือ `forcedExistingItemId || <ของเดิม>` — เมื่อ `getCrawlMergeExistingItemId()` คืน 0 (ไม่มี query param) นิพจน์ทั้งหมดลดรูปเหลือพฤติกรรมเดิมทุกจุด (ตรวจโค้ดทีละ hunk ยืนยันแล้ว)

## B. Role gating — **PASS**

- `item-editor.js:451-454`: `isAdminUser()` → `role === "admin" || role === "owner"`
- ปุ่มสร้างเฉพาะ `isCleanMode && isAdminUser() && state.itemId` (`item-editor.js:2027`)
- `/api/collect` (`index.mjs:14032-14044`): ตรวจ role ในตัว handler เอง — อนุญาตเฉพาะ `owner`/`admin` มิฉะนั้น 403
- `/api/source-raw-items/import` (`index.mjs:13953`): ใช้ `requireRole("admin")`
- **แต่** `requireRole()` (`auth-integration.mjs:563-583`) มี special case: `if (currentRole === "owner") { next(); return; }` ก่อนเช็ค `roles.includes(...)` เสมอ → owner ผ่านทุก endpoint แม้ไม่อยู่ใน list
- สรุป: `admin` เห็นปุ่ม → เรียกได้ทั้ง `/api/collect` และ `/api/source-raw-items/import` จบ flow ได้จริง; `owner` เห็นปุ่ม → เรียกได้ทั้งสอง endpoint เช่นกัน (ผ่าน owner-bypass) จบ flow ได้จริง ไม่ตันที่ import; `user` → `isAdminUser()` เป็น false ปุ่มไม่ถูกสร้างเลย และต่อให้พิมพ์ URL เองก็ยังโดน 403 ทั้งสอง endpoint
- ไม่มี role ใดเห็นปุ่มแล้วเจอ 403

## C. การล็อกปลายทาง merge — **CONDITIONAL**

สิ่งที่ตรวจแล้วยืนยันว่าถูกต้อง:

- `crawl_merge_item_id` อ่านจริงผ่าน `getCrawlMergeExistingItemId()` (`app.js:5983-5985`) ด้วย `parsePositiveInt` (ปฏิเสธค่า ≤0/NaN)
- ล็อกจริง ไม่ใช่แค่ default: `renderSourceIntakeModal` ใส่ `disabled` บนทั้งสอง `<select>` เมื่อมี forced id (`app.js:6032,6039`) **และ** event handler ของทั้งสอง select มี early-return `if (getForcedSourceIntakeExistingItemId()) return;` (`app.js` ในบล็อก `wireSourceIntakeModal`) — แม้แก้ DOM ผ่าน devtools เปลี่ยนค่า select ก็ไม่มีผล เพราะปุ่ม "accept recommended" และปุ่ม "confirm" อ่าน `forcedExistingItemId` ก่อนเสมอ (`app.js:10908-10935`) ไม่ใช้ `state.sourceIntake.selectedExistingItemId` เป็นตัวตัดสินเมื่อมี forced id
- ไม่ติด limit 50: forced item ถูก `push` เข้า `prioritized` **ก่อน** loop ของ `state.items` ที่มี `if (prioritized.length >= 50) break;` (`app.js:5949-5974`) จึงไม่มีทางถูกตัดออกจาก cap
- item id ไม่มีจริง/ถูกลบ: server ตรวจ `repo.getItem(targetItemId)` (`index.mjs:13991-14002`) และ SQL `getStmt` มี `WHERE i.id=? AND i.is_deleted=0` (`repository.mjs:2919-2924`) → item ที่ถูกลบ (soft-delete) จะคืน null → ทั้ง request import ถูกปฏิเสธด้วย 400 ไม่มีการ merge บางส่วนแบบเงียบ ๆ ฝั่ง client (`app.js:10964-10966`) catch แล้วโชว์ error ใน `source-intake-status` และ**ไม่**เรียก `closeSourceIntakeModal()` — ผู้ใช้เห็น error ชัดเจน ไม่เงียบ

**ข้อค้นพบจริง (ไม่ใช่แค่ทฤษฎี) ที่ต้องพิจารณาก่อน merge:**

ล็อกนี้ผูกกับ **URL ของแท็บ ไม่ใช่ผูกกับ batch การ crawl ครั้งเดียว** `getCrawlMergeExistingItemId()` อ่านจาก `window.location.search` ใหม่ทุกครั้งที่ `openSourceIntakeModal()` ถูกเรียก (`app.js:6135`) และไม่มีจุดใดใน diff ที่ลบ query string `crawl_merge_item_id` ออกจาก address bar เลย (`closeSourceIntakeModal` reset แค่ state ในหน่วยความจำ ไม่แตะ URL — `app.js:6165-6172`) เพราะหน้านี้เป็น SPA ไม่ reload ระหว่างการ crawl แต่ละครั้ง ผลคือ: ถ้า admin/owner กดปุ่ม shortcut ครั้งหนึ่งแล้วยังอยู่ในแท็บเดิม ต่อมา crawl ข้อมูลอื่นที่ไม่เกี่ยวข้องกับ item นั้นอีกหลายรอบในเซสชันเดียวกัน (โดยไม่ปิดแท็บ/แก้ URL เอง) **ทุกรอบ crawl ถัดไปในแท็บนั้นจะถูกบังคับเป็นโหมด merge เข้า item เดิมโดยอัตโนมัติ** โดยไม่มี banner แจ้งเตือนบนหน้า raw dashboard ก่อนเปิด modal เลย จุดเดียวที่เห็นคือ dropdown ที่ถูก disable ในตัว modal ซึ่งอาจถูกมองข้ามได้หากรีบกดยืนยัน

ผลกระทบ: มีความเสี่ยงจริงที่ raw item ชุดใหม่ที่ไม่เกี่ยวข้องจะถูก merge เข้า item เดิมโดยไม่ตั้งใจ ถ้าผู้ใช้ไม่รู้ตัวว่า URL ยังพก `crawl_merge_item_id` ค้างอยู่ ไม่ใช่ silent-wrong-merge ในความหมาย "ไม่มี error" (ระบบยังบันทึกถูก item ที่ id นั้นจริง ไม่ crash) แต่เป็น "ล็อกเกินขอบเขตที่ตั้งใจ" (เกินกว่า 1 ครั้งของการกดปุ่ม) — ควรตัดสินใจว่าเป็นพฤติกรรมที่ยอมรับได้หรือไม่ก่อน merge ไม่ควรปล่อยผ่านเงียบ ๆ

## D. เทสต์ (`clean-crawl-shortcut.surface.test.mjs`) — **PASS กลไก mutation-proof / CONDITIONAL การจัดประเภทเทส**

ทำ mutation-proof เองอิสระ (ไม่เชื่อคำอ้างของ implementer):

```
git rev-parse HEAD:.../app.js .../item-editor.js .../clean-item.html
  → 34fb57a... 9c9e1c8... 0510aad...
git checkout main -- <3 ไฟล์ production>
git hash-object <3 ไฟล์>            → af43ba8... 671f334... 94c04c8...  (ตรงกับฝั่ง main ใน diff)
node --test tests/clean-crawl-shortcut.surface.test.mjs
  → fail 3, pass 0  (test1 fail ที่ btn-prev-step ยังอยู่, test2/3 fail ที่ regex หา getCrawlMergeExistingItemId/role-gate ไม่เจอ)
git checkout HEAD -- <3 ไฟล์>
git hash-object <3 ไฟล์>            → 34fb57a... 9c9e1c8... 0510aad...  (คืนตรงเป๊ะ 100%)
node --test tests/clean-crawl-shortcut.surface.test.mjs
  → pass 3, fail 0
```

ยืนยัน: revert แล้ว fail จริงทั้ง 3 กรณี ตามที่รายงานอ้าง, restore แล้ว hash ตรงเป๊ะ, รันซ้ำ 3/3 pass

**ธรรมชาติของเทสจริง (อ่านซอร์สทั้งไฟล์แล้ว):**

- Test 1 (`clean-crawl-shortcut.surface.test.mjs:26-32`): ส่วนใหญ่เป็น `assert.match(source, /regex/)` แต่มีส่วนที่เป็น**พฤติกรรมจริง** — ดึงซอร์สของฟังก์ชัน `buildCleanCrawlMergeUrl` ด้วย string search แล้ว `eval` ผ่าน `Function(...)` และเรียกจริงด้วย `buildUrl(42)` เทียบผลลัพธ์ตรง ๆ ส่วนนี้คือ unit test จริง ไม่ใช่ regex
- Test 2 (`:34-44`) และ Test 3 (`:46-50`) ส่วนที่เหลือ: **เป็น regex จับข้อความในซอร์สทั้งหมด** ไม่มีการเรียก `renderSourceIntakeModal()`, event handler, หรือ import จริงเลย
- สิ่งที่พิสูจน์ได้จริง: บรรทัดโค้ดที่กำหนด (การประกาศฟังก์ชัน, เงื่อนไข role-gate, การ push forced item, การ disable select) **ยังอยู่ในซอร์สคำต่อคำ** ป้องกัน regression แบบลบ/เปลี่ยนคำในอนาคตได้ดี
- สิ่งที่พิสูจน์ไม่ได้: ว่า `renderSourceIntakeModal()` เมื่อรันจริงจะ render disabled attribute ถูกจุด, ว่า event listener ผูกถูก element, ว่า DOM แสดงผลถูกต้องจริงในเบราว์เซอร์ — regex เจอ pattern แม้โค้ดจุดนั้นเป็น dead code ที่ไม่เคยถูกเรียกก็ยังผ่าน
- ข้อสรุป: เทสนี้ควรเรียกว่า **source-text regression test** (มี unit test จริง 1 จุดปนอยู่) ไม่ใช่ behavioral test แบบเต็มรูปแบบ ควรระบุให้ชัดในรายงานเพื่อไม่ให้เข้าใจผิดว่าครอบคลุมพฤติกรรมจริงทั้งหมด

## E. GATE — **PASS (ยืนยันด้วยการรันเองทั้งสองฝั่ง)**

รันจริงในที่เดิม สลับ checkout (ไม่ใช้ worktree):

```
git checkout main   → npm run test:all
  ℹ tests 816  pass 756  fail 59  skipped 1

git checkout codex/clean-crawl-merge-shortcut   → npm run test:all
  ℹ tests 819  pass 759  fail 59  skipped 1   (+3 test ตรงกับไฟล์เทสใหม่)
```

เทียบ "ชื่อ" failure (สกัดจากบล็อก `✖ failing tests:` ท้าย output ทั้งสองฝั่ง แล้ว sort + diff):

```
diff(main_failnames, branch_failnames)      → ไม่มีผลต่าง (0 new, 0 missing)
diff(main_failnames, implementer_claimed)   → ไม่มีผลต่าง (ตรงกับตารางในรายงาน 100%)
```

**59/59/new 0/missing 0 ตรงตามที่คาด ยืนยันด้วยการรันเองทั้ง main และ branch คนละรอบ ไม่ได้อ่านจากตัวเลขของ implementer**

หลังรันเสร็จ สลับ checkout กลับ `codex/clean-crawl-merge-shortcut` และตรวจ `git hash-object` ของทั้ง 3 ไฟล์ production อีกครั้ง → ตรงกับ branch HEAD เป๊ะ ต้นไม้ไม่เพี้ยนจากการสลับ checkout

## F. Theme — **PASS**

- ไม่มีการแก้ `styles.css` เลย (ไม่อยู่ใน diff --stat)
- ปุ่มใหม่ใน `item-editor.js` ใช้ `button.className = "utility-action";` เท่านั้น ไม่มี class ใหม่
- ตรวจตรงบรรทัดที่รายงานอ้าง: `styles.css:3925-3927` (`.utility-action { opacity: 0.88; }`) และ `:5705-5719` (`:root[data-theme="dark"] .utility-action { ... }` รวม `:hover` ที่ 5718-5719) — **มีจริง ตรงเป๊ะ** ครอบคลุมทั้ง light และ dark
- หมายเหตุเล็กน้อย (ไม่ใช่ fail): `<select id="source-intake-mode">` และ `#source-intake-existing-item` ที่ถูกใส่ `disabled` ใหม่ไม่มี custom `select:disabled` rule นอกขอบเขต `#panel-assignments` จะใช้สไตล์ disabled ของเบราว์เซอร์เอง ทั้ง light/dark ไม่ใช่ปัญหา class ใหม่ตามที่ถามใน F แต่บันทึกไว้เผื่อสนใจเรื่อง visual polish

## G. รายงาน implementer ตรงกับต้นไม้จริงไหม

ตรวจทุกข้ออ้างใน `audit/clean-crawl-shortcut-implementation.md` เทียบต้นไม้จริง:

| ข้ออ้าง | ตรงจริงไหม | หลักฐาน |
| --- | --- | --- |
| ตาราง Files: `item-editor.js +23/-8` | ✅ ตรง | numstat 23/8 |
| ตาราง Files: `app.js +34/-8` | ✅ ตรง | numstat 34/8 |
| ตาราง Files: `clean-item.html -1` | ✅ ตรง | numstat 0/1 |
| ตาราง Files: **test file `+45`** | ❌ **False claim** | numstat จริงคือ **+50** (ตรงกับที่โจทย์ audit เองระบุไว้ในข้อ D ว่า `+50`) — ตัวเลขในตารางของ implementer ผิด |
| `styles.css:3925-3927`, `:5705-5719` | ✅ ตรง | อ่านไฟล์ตรงบรรทัดแล้ว ตรงเป๊ะ |
| `auth-integration.mjs:563-581` (requireRole owner bypass) | ✅ ตรง (คลาดเคลื่อนเล็กน้อย) | ฟังก์ชันจริงอยู่ 563-583 (ปิดวงเล็บที่ 582/583) ตรรกะ bypass ที่อ้างอยู่ในช่วง 570-574 ซึ่งอยู่ในช่วงที่อ้างจริง ถือว่าถูกต้องโดยรวม |
| "3/3 passes on branch" + mutation-proof คำอธิบาย | ✅ ตรง | ทำซ้ำเองแล้วยืนยันตามข้อ D |
| ตาราง gate 59 ชื่อ, "same as baseline", "new 0 / missing 0" | ✅ ตรง | รันเองทั้ง main/branch ยืนยันตามข้อ E |
| "No CSS file changed" | ✅ ตรง | ไม่อยู่ใน diff |
| "No commit, merge, push, endpoint, state-machine rule, transition, or CSS class was added" | ✅ ตรง | ยืนยันจาก diff --stat ที่จำกัดอยู่ 5 ไฟล์ที่ระบุเท่านั้น |

**ไม่พบใน implementer report** (ไม่ใช่ false claim แต่เป็นการไม่เปิดเผย): ประเด็นล็อกที่ผูกกับ URL ของแท็บเกินขอบเขตการ crawl ครั้งเดียว (ดูข้อ C) — รายงานไม่ได้พูดถึงขอบเขตของการล็อกเลย จึงไม่ถือว่าขัดแย้งโดยตรง แต่เป็นพฤติกรรมที่ควรถูกเปิดเผยก่อนตัดสินใจ merge

**แยกจาก implementer**: ตัวเลข `+184-42` และ `app.js +54-28` ที่ปรากฏในคำสั่ง audit เอง ไม่ตรงกับต้นไม้จริงและไม่ตรงกับตัวเลขใด ๆ ในรายงาน implementer ด้วย (ดูข้อ A) — เป็นความคลาดเคลื่อนของโจทย์ตรวจ ไม่ใช่ของ implementer

---

## คำตัดสินรวม

**ยังไม่ควร merge แบบไม่มีเงื่อนไข** — ประเด็น B, D(กลไก), E, F, และ scope ของ diff ผ่านการตรวจสอบอิสระทั้งหมดแล้วอย่างมั่นใจ (รันจริง ไม่ได้เชื่อรายงาน) แต่มี 2 จุดที่ต้องตัดสินใจ/แก้ก่อน:

1. **(ควรแก้ก่อน merge)** ข้อ C — ล็อกปลายทางผูกกับ URL ของแท็บ ไม่ใช่ผูกกับ batch เดียว เสี่ยง merge ข้อมูล crawl รอบถัดไปที่ไม่เกี่ยวข้องเข้า item เดิมโดยไม่ตั้งใจถ้าผู้ใช้ยังอยู่ในแท็บเดิม ควรอย่างน้อยแสดง banner ยืนยันการล็อกบนหน้า raw dashboard ก่อนเปิด modal หรือเคลียร์ query param ออกจาก URL หลัง import สำเร็จหนึ่งรอบ
2. **(แก้เอกสาร ไม่ใช่โค้ด)** ข้อ D และ G — แก้ตัวเลข `+45` เป็น `+50` ในตาราง implementer report และควรระบุในรายงานว่าเทสส่วนใหญ่เป็น source-text regression ไม่ใช่ full behavioral test เพื่อไม่ให้ผู้อ่านรายงานเข้าใจผิดขอบเขตความคุ้มครองของเทส

ส่วน role gating (B), gate parity (E), theme reuse (F), และขอบเขต diff (A) ยืนยันแล้วว่าปลอดภัยสำหรับ merge หากทีมยอมรับความเสี่ยงในข้อ 1 หรือแก้ก่อน
