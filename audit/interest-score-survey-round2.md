# Survey รอบ 2: `/api/items` ไม่แนบ `interestingness`

ขอบเขต: source `main` `e59a1da`, dev checkout `D:\UbonCity_Web`, และความพยายามรัน Collector จริงแบบไม่แก้ DB เมื่อ 2026-08-03. ไม่มีการแก้ code, migration, commit หรือ push.

## Executive verdict

รายงานรอบก่อน **ผิดที่สรุปพฤติกรรมของ runtime จาก source อย่างเดียว**. Source ที่ checkout นี้ระบุชัดว่า route `/api/items` ต้องแนบ `interestingness` ทุก item ที่ผ่าน visibility filter ทั้ง normal และ `?in_flight=1`; แต่ยังไม่มี runtime response จาก process ที่สตาร์ทจาก checkout นี้ เพราะ server เปิดไม่ได้กับ dev DB ปัจจุบันก่อนเริ่ม listen. จึงไม่สามารถยืนยันหรือโต้หลักฐาน runtime 200 ที่ผู้ใช้ให้มาด้วย JSON ที่สร้างเองได้.

ถ้าหลักฐาน runtime ว่า `200` และ item ไม่มี key `interestingness` ถูกต้อง สาเหตุ **ไม่สามารถอยู่ใน `attachItemMatchFields` หรือสอง branch ของ route ใน source `e59a1da` นี้**: ไม่มี branch ที่คืน item โดยไม่ผ่าน function นั้น และไม่มี JSON replacer/middleware หลัง route ที่ลบ key. ต้องเป็น process/route/asset/proxy คนละตัวจาก process ที่สตาร์ทด้วย DB นี้ หรือ runtime source/route ที่ไม่ตรงกับไฟล์ที่ตรวจ แม้ URL จะบ่งชี้ว่ามี feature อื่นจาก commit เดียวกันก็ตาม.

## 1. `attachItemMatchFields` แนบแบบมีเงื่อนไขหรือไม่

### ข้อเท็จจริงจาก source

- `collector/server/index.mjs:1304-1307`: function รับ `items`, สร้าง `matchedItems` ด้วย `.map`; ไม่มี early return ระดับ function ก่อน map.
- `:1308-1345`: สำหรับแต่ละ item เรียก `repo.listSourceRecordsByItem`, `repo.getCurrentFieldPackByItem`, `repo.getWorkflowModelByItem`, แล้วสร้าง object `next`.
- `:1342-1345`: object `next` มี property literal `interestingness: scorePlaceInterestingness(...)` โดยไม่มี `if`, feature policy หรือ request flag ครอบ.
- `:1347-1349`: flag เดียวใน function คือ `includeBulkPreview`; มันเติม `bulk_preview` เท่านั้น ไม่เกี่ยวกับ `interestingness`.
- `:1350-1368`: หลัง map มีเงื่อนไขเฉพาะเติม `manual_completeness`; return ทั้ง item เดิมหรือ spread item พร้อม field เพิ่ม จึงไม่ลบ `interestingness`.
- ไม่มี `try/catch` ใน `attachItemMatchFields` หรือ `scorePlaceInterestingness` (ทั้งสองอยู่ที่ `collector/server/index.mjs:1082-1368`).
- `rg "interestingness"` ใน collector source (ตัด `node_modules`, data, docs/audit) พบ write-to-response เพียงจุดเดียวที่ `:1342`.

### Output จริงจากการรัน

สตาร์ทด้วย `node server/index.mjs` จาก `collector/`, `PORT=5069`, `COLLECTOR_BIND_HOST=127.0.0.1`, ใช้ `DB_PATH` ค่า default คือ `D:\UbonCity_Web\collector\data\collector.db`. Process หยุดก่อน bind และไม่มี endpoint response:

```text
Error: content_workflow_models.place_review_flag is missing;
run npm run migrate:place-review-flags before opening Collector
    at assertPlaceReviewFlagMigrationApplied
    at openDatabase
    at collector/server/index.mjs:131
```

สาเหตุ guard อยู่ที่ `collector/db/client.mjs:40-46`; server เปิด database และ assert schema ที่ `collector/server/index.mjs:130-132`. ไม่รัน migration เพราะจะละเมิด read-only.

### สรุป

ไม่มีเงื่อนไขที่ทำให้ field นี้ถูกข้าม. ข้อสรุป source ของรอบก่อนว่า “route นี้แนบ field” ถูกต้องสำหรับ code path ที่อ่าน แต่ข้อสรุปว่ารันไทม์จริงทำเช่นนั้น **ผิดและไม่มีหลักฐาน runtime**.

## 2. หน้าตารางใช้ response ไหน และ `in_flight=1` ต่างหรือไม่

### ข้อเท็จจริงจาก source

- Bootstrap ของ Raw Intake / Clean Prep ใช้ `api("/api/items")` แล้วตั้ง `state.items` ที่ `collector/server/public/app.js:10336-10338,10369-10371`.
- Raw Intake / Clean Prep render จาก `state.items`: `collector/server/public/app.js:5687-5779`. คอลัมน์ “น่าสนใจ” เปิดเฉพาะ `table-raw-intake` (`:5773-5779`), ไม่ใช่ Data Cleanup in-flight table.
- Data Cleanup “งานค้างระหว่างทาง” ใช้ `api("/api/items?in_flight=1")` ที่ `collector/server/public/app.js:3087-3089` และ bootstrap `:10350-10353`.
- Server แยก dataset: `collector/server/index.mjs:8202-8205` ใช้ `repo.listInFlightItems()` เมื่อ query `in_flight=1`; normal path ใช้ `repo.listItems()` ที่ `:8207-8209`.
- แต่ทั้งสอง path ครอบผลด้วย `attachItemMatchFields(...)` เหมือนกัน: `:8204` และ `:8208`. ดังนั้น source ไม่มี response-shape difference เรื่อง `interestingness`.
- `listInFlightItems` คัดเฉพาะ item ที่ออกจาก `production_state=collected` และยังไม่ terminal (`collector/db/repository.mjs:4363-4373`); เป็นความต่างด้านรายการ ไม่ใช่ field decoration.

### Output จริงจากการรัน

ไม่มี JSON response ทั้งสอง URL เนื่องจาก process ถูก schema guard หยุดก่อน listen ตามข้อ 1. การใส่ JSON ปลอมจาก source จะขัดกับวัตถุประสงค์ของรอบนี้.

### สรุป

ตารางที่มีคอลัมน์ “น่าสนใจ” ใช้ normal `/api/items`, ไม่ใช่ `in_flight=1`. ถึงอย่างนั้น source บังคับแนบ field ทั้งสอง path.

## 3. พิสูจน์ด้วยการรันจริง

### สิ่งที่ตรวจจริง

- ก่อน start: `content_items` และ `published_articles` ไม่มี slug ผิดรูปแบบ จึงไม่มีงาน backfill ที่คาดว่าจะเขียนข้อมูล; DB mtime ก่อนรันคือ `2026-07-21T14:08:36.7551602Z`.
- เริ่ม process บน port แยก 5069 เพื่อไม่กระทบ runtime อื่น.
- Process ตายก่อนเปิด HTTP ตาม error ในข้อ 1. ตรวจ port 5060, 5061, 5062, 5069 แล้วไม่มี listener ในช่วงตรวจ.
- ไม่รัน `npm run migrate:place-review-flags`, ไม่สร้าง DB copy, และไม่ชี้ไป runtime นอก `D:\UbonCity_Web`; ทั้งหมดจะเกิน read-only scope.

### JSON ที่ขอ

ไม่มี JSON ของ item จาก endpoint ที่สตาร์ทได้ใน checkout นี้. หลักฐาน runtime ที่ผู้ใช้ให้ (“200 แต่ไม่มี `interestingness`”) ไม่ได้มี body แนบมา จึงไม่สามารถวาง key ทั้งหมดของ item จริงโดยไม่แต่งข้อมูล. นี่เป็น blocker ของข้อ 3 ไม่ใช่ผลว่าค่าเป็น `null` หรือถูก filter.

### สรุป

การพิสูจน์ runtime ที่ทำซ้ำได้จาก checkout/DB นี้ถูก block ด้วย schema mismatch. ต้องเลือกหนึ่งอย่างในรอบถัดไป: อนุญาตให้ใช้ runtime ที่ผู้ใช้ตรวจพบพร้อม capture body, หรืออนุญาต DB/database copy ที่ผ่าน migration สำหรับ smoke read. รอบนี้ไม่มีสิทธิ์ทำทั้งสองอย่าง.

## 4. ถ้า `scorePlaceInterestingness` throw

### ข้อเท็จจริงจาก source

- ไม่มี try/catch รอบ call `scorePlaceInterestingness` ที่ `collector/server/index.mjs:1342-1345`.
- route `/api/items` เป็น synchronous handler (`:8180-8218`) และไม่มี try/catch รอบ `attachItemMatchFields`.
- Express error middleware สุดท้าย log error ด้วย `console.error(err)` ที่ `collector/server/index.mjs:15438-15440` แล้วคืน HTTP 500 `{ "error": "Internal server error" }` ที่ `:15467`.

### Output จริงจากการรัน

ไม่มี request ถึง route เพราะ boot fail. แต่จาก control flow นี้ ถ้า scorer throw จะไม่ใช่ “field หายเงียบ”: response ทั้ง request จะเป็น 500 และ stack/error ถูกส่งไป stdout/stderr ผ่าน `console.error` ของ middleware. ไม่มี log เฉพาะชื่อ `interestingness` หรือ item id ใน scorer.

### สรุป

throw ไม่อธิบาย 200 ที่มี items แต่ไม่มี key; 200 แบบนั้นต้องเกิดก่อน/นอก route นี้ หรือไม่ได้ execute source path นี้.

## 5. Endpoint อื่นที่ส่ง `interestingness`

### ข้อเท็จจริงจาก source

ค้นทุก source ใน `collector/` พบ producer/transport ของ field นี้เพียง:

1. `GET /api/items` ที่ `collector/server/index.mjs:8180-8218`, ผ่าน `attachItemMatchFields`.
2. UI consumer ใน `collector/server/public/app.js`.

ไม่มี endpoint อื่นที่ส่ง property ชื่อ `interestingness` ออกมาโดยตรง. `GET /api/items/:id` ที่ `collector/server/index.mjs:8400` เป็นคนละ handler และ source ไม่เรียก `attachItemMatchFields` ใน route นั้น; ไม่ใช่ทางเลือกที่พิสูจน์ field นี้.

### Output จริงจากการรัน

ไม่มี endpoint อื่นที่สามารถทดลองได้ก่อน boot ผ่าน; ไม่มี endpoint ที่ source ระบุว่าส่ง `interestingness` ให้เทียบกับ `/api/items`.

### สรุปสาเหตุ

ไม่มี “endpoint อื่นที่ส่งได้แต่ `/api/items` ส่งไม่ได้” ใน source นี้. ความต่างที่เห็นใน runtime ต้องตรวจที่ process/HTTP capture จริง ไม่ใช่เปลี่ยน logic score หรือเพิ่ม persistence.

## Correction ของรายงานรอบก่อน

`audit/interest-score-survey.md` ควรถือว่าผิดเฉพาะคำยืนยันเชิง runtime ว่า `/api/items` “แนบให้ทุก item” และคำวินิจฉัยว่าปัญหาอยู่ที่ UI/runtime drift โดยไม่มี HTTP evidence. รายงานรอบแรกควรระบุเพียงว่า **source แสดง intent** ให้แนบ field. รอบนี้ source ยังยืนยัน intent เดิม แต่ไม่สามารถ override หลักฐาน response 200 ที่ผู้ใช้เห็นได้.
