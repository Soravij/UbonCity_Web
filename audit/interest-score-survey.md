# Survey: คอลัมน์ “น่าสนใจ” ใน Raw Intake / Clean Prep

ขอบเขต: ตรวจ source ที่ `main` `e59a1da` และ query แบบ read-only ที่ `collector/data/collector.db` บน dev เมื่อ 2026-08-03. ไม่มีการแก้โค้ด, migration, commit หรือ push

## ข้อสรุป

คอลัมน์นี้ไม่ได้อ่านคะแนนที่ persist ใน DB เลย ชื่อ field ที่ UI อ่านคือ `interestingness` (object: `score`, `rank`, `label`, `reasons`, `source_labels`) ซึ่ง `/api/items` คำนวณสดจาก `content_items` และ `source_records.payload_json` ทุกครั้งที่ตอบ request. ไม่มี write site ของ `interestingness` และไม่มีคอลัมน์ `interestingness` หรือ `interest_score` ใน `content_items`.

ดังนั้นตาราง `place_intelligence_scores` และ social tables เป็นคนละระบบกับคอลัมน์นี้ แม้ชื่อจะคล้ายกัน. ใน DB dev ตารางเหล่านั้นมีอยู่จริงแต่เป็นศูนย์แถวทั้งหมดสำหรับทั้งฐาน และ item 1–8. จาก source + DB ปัจจุบัน item 1–8 ควรได้รับ `interestingness` ที่มีค่า (คำนวณตามฟังก์ชันได้ #3 หรือ #4) และเป็น `production_state=collected` จึงควรถูก render เป็น badge. อาการ “ช่องว่าง” ทุกแถวจึงไม่อธิบายได้ด้วย collect/calculation/persist ของ source ปัจจุบัน; จุดที่ยังเป็นไปได้จาก source คือ UI เลือกไม่ render เมื่อ `isRawPreparationItem(item)` เป็น false หรือ runtime กำลังให้ JS/response คนละ version กับ source นี้. การตรวจ browser/HTTP runtime อยู่นอกขอบเขต read-only source survey นี้.

## 1. เส้นทาง UI → response → endpoint → DB

ข้อเท็จจริง:

- `collector/server/public/app.js:5253-5254` อ่าน `item.interestingness` และ `interestingness.reasons`.
- `collector/server/public/app.js:5281-5284` render badge เป็น `(interestingness.label || "ข้อมูลยังบาง") + " #" + Number(interestingness.score || 0)`. จึงแม้ไม่มี field นี้ก็ต้องเห็น fallback `ข้อมูลยังบาง #0` **หาก** แถวนั้นผ่าน `isRawRow`.
- `collector/server/public/app.js:778-780` กำหนด `isRawRow` เป็น queue `raw_prep` และ `production_state === "collected"` เท่านั้น. ถ้าไม่ผ่าน เฉพาะ cell นี้จะเป็น `<td>` ว่าง.
- `collector/server/public/app.js:10336-10338,10369-10371` โหลด `state.items` จาก `GET /api/items` แล้วส่งเข้าการ render table.
- `collector/server/index.mjs:8180-8208` endpoint `/api/items` เรียก `repo.listItems()` แล้วส่งผลผ่าน `attachItemMatchFields(...)`.
- `collector/server/index.mjs:1307-1345` โหลด `repo.listSourceRecordsByItem(itemId)` และเพิ่ม response field `interestingness: scorePlaceInterestingness(...)`.
- `collector/db/repository.mjs:2912-2918,4338-4340` `listItems()` อ่าน `content_items` ร่วม canonical state จาก `content_workflow_models`; `collector/db/repository.mjs:9400-9404` อ่าน `source_records` ของ item และ parse `payload_json`.
- ตารางฐานสำหรับ input คือ `content_items` (`collector/database/schema.sql:11-43`) และ `source_records` (`collector/database/schema.sql:46-59`); ไม่มี storage field ชื่อ `interestingness`, `interest_score`, หรือ `interestScore` ใน schema.

สรุปจุดติด: **ไม่ติด DB/API ตาม design**. `interestingness` เป็น response-only derived field. ช่องว่างจะเกิดที่ UI ได้เฉพาะเมื่อ `isRawPreparationItem` เป็น false; แต่ DB dev ของ item 1–8 ระบุ canonical production state เป็น `collected` และไม่มี field-pack row ตามชุดข้อมูลที่ตรวจ จึงตรงเงื่อนไข raw จาก source.

## 2. ใครเขียนค่า และเขียนเมื่อใด

### `interestingness` ที่แสดงในตาราง

ไม่มีผู้เขียนลง DB และไม่มี job แยก. `scorePlaceInterestingness` เป็น pure calculation ที่เกิดระหว่างตอบ `/api/items`:

- จุดคำนวณ: `collector/server/index.mjs:1082-1302`.
- จุดแนบผลเข้า response: `collector/server/index.mjs:1342-1345`.
- input คือ fields บน item และ source record/payload (Google, Wongnai, official/institutional, address, hours, phone, image, rating/review/photo/review text): `collector/server/index.mjs:1103-1218`.

กล่าวให้ตรงเวลา: collect เขียน `content_items`/`source_records`; clean และ agent ไม่ได้เขียน `interestingness`; ทุก `GET /api/items` เป็นผู้คำนวณค่าที่หน้าเห็นใหม่.

### ระบบคะแนนอื่นที่ชื่อคล้าย แต่ไม่ใช่คอลัมน์นี้

- `place_intelligence_scores.priority_score` ถูก INSERT เฉพาะเมื่อ admin เรียก `POST /api/items/:id/recompute-intelligence` (`collector/server/index.mjs:12373-12405`; repository INSERT ที่ `collector/db/repository.mjs:11729-11841`). ไม่ได้ถูกรันใน collect/clean/agent โดยอัตโนมัติจาก source ที่พบ.
- `social_signal_sources` เขียนโดย `addSocialSignalSource` จาก API mutation (`collector/db/repository.mjs:11878-11901`; route `collector/server/index.mjs:12486-12490`).
- `social_momentum_snapshots.momentum_score` เขียนเมื่อ admin เรียก recompute momentum (`collector/db/repository.mjs:11940-12031`; route `collector/server/index.mjs:12544-12546`).

สรุปจุดติด: **ไม่มี persist stage สำหรับ `interestingness` โดยตั้งใจ**. ถ้าผู้ใช้คาด “collect แล้วมีคะแนนใน DB” นั่นไม่ใช่พฤติกรรมของ field นี้ใน source ปัจจุบัน.

## 3. ตรวจว่า collect ทำให้ค่าว่างหรือไม่

ข้อเท็จจริงจาก DB dev:

- item 1–8 ทุก item เป็น `type=place`, มี `production_state=collected`, มี `source_records` Google Maps 1 แถว และมี source payload ที่มี `extracted_metadata`/`extracted_reviews`. Query dev DB เพิ่มเติมพบ `field_packs` ของ item 1–8 = 0 แถว จึงไม่มี field-pack ที่จะทำให้ queue เปลี่ยนจาก `raw_prep`.
- payload ของทั้งแปดมี photo และ review text; item 1–6,8 มี address และ opening hours, item 7 ไม่มี hours. ทุก item มี description/image ของ item.
- read-only recreation ของ logic `scorePlaceInterestingness` ตาม source ได้: item 1–6,8 = `ต้องตรวจเอง #4`; item 7 = `ต้องตรวจเอง #3`. นี่เป็นการคำนวณจาก source/DB ไม่ใช่การเรียก API ที่กำลังรัน.

ข้อสังเกตเชิง source: `scorePlaceInterestingness` เริ่ม `googleUserRatingCount` และ `googleRating` เป็น `null` แล้วส่งเป็น argument แรกของ `pickFirstFiniteNumber` (`collector/server/index.mjs:1096-1099,1176-1180`). แต่ `toFiniteNumberOrNull(null)` ใช้ `Number(null)` จึงได้ `0` (`collector/server/index.mjs:984-989,6783-6785`). ทำให้ scorer ไม่ได้ใช้ rating/user-rating-count ใน payload ของชุดนี้ แม้มีข้อมูลจริง; อย่างไรก็ตาม photo + review + richness ยังทำให้ได้ 3/4 ไม่ใช่ค่าว่าง.

สรุปแยก stage:

| Stage | ผล |
| --- | --- |
| collect | ไม่ติด: source record และ input signals มีอยู่ |
| calculation | ไม่ติดเรื่องค่าว่าง: source คำนวณได้ 3/4; มี defect แยกที่ทำให้ Google rating/count กลายเป็น 0 |
| persist | ไม่มี step นี้สำหรับ `interestingness` โดยออกแบบ |
| API | source endpoint แนบ object `interestingness` ทุก item |
| UI | เป็นจุดเดียวที่ source render cell ว่างได้ (`isRawRow === false`); แต่ canonical state ใน DB ของ 1–8 ผ่านเงื่อนไข raw |

## 4. Schema และการมีอยู่ของตาราง intelligence/social

ข้อเท็จจริง:

- ข้อสมมติที่ว่าตารางสามตัวอยู่เฉพาะ boot helper ไม่ตรงกับ `main e59a1da`: schema ประกาศ `place_intelligence_scores` ที่ `collector/database/schema.sql:878-895`, `social_signal_sources` ที่ `:897-914`, และ `social_momentum_snapshots` ที่ `:916-930`.
- Query `sqlite_master` ของ dev DB พบทั้งสาม table จริง.
- จำนวนแถวทั้งฐาน: `place_intelligence_scores=0`, `social_signal_sources=0`, `social_momentum_snapshots=0`.

สรุปจุดติด: ตารางมีจริงและ schema มีจริง แต่ **ไม่มีข้อมูล**. ถึงมีข้อมูลก็ API/table นี้ไม่ได้ใช้ `place_intelligence_scores.priority_score` หรือ social score เป็น `interestingness`.

## 5. Query DB dev: item 1–8

Query read-only ที่ใช้ (ตัดชื่อ/รายละเอียดออก):

```sql
SELECT i.id,
  (SELECT COUNT(*) FROM source_records s WHERE s.content_item_id=i.id) AS source_records,
  (SELECT COUNT(*) FROM place_intelligence_scores p WHERE p.content_item_id=i.id) AS place_scores,
  (SELECT COUNT(*) FROM social_signal_sources ss WHERE ss.content_item_id=i.id) AS social_sources,
  (SELECT COUNT(*) FROM social_momentum_snapshots sm WHERE sm.content_item_id=i.id) AS momentum_snapshots
FROM content_items i
WHERE i.id BETWEEN 1 AND 8
ORDER BY i.id;
```

| Item | source_records | `place_intelligence_scores` | `social_signal_sources` | `social_momentum_snapshots` | `interestingness` stored? |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 2 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 3 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 4 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 5 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 6 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 7 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |
| 8 | 1 | 0 rows | 0 rows | 0 rows | ไม่มี column/row; derived ตอน API |

คำตอบตรงคำถาม NULL/0/no-row: ไม่มี `interestingness` ให้เป็น NULL หรือ 0 ใน DB; `place_intelligence_scores.priority_score` ไม่ใช่ field นี้และไม่มีแถวเลย (ไม่ใช่ค่า 0); ตาราง social ก็ไม่มีแถว. Source inputs อยู่ใน `source_records.payload_json` ไม่ได้หาย.

## ทางเลือกแก้ (ยังไม่ลงมือ)

1. ตรวจ runtime contract ก่อน: เปิด Network ของหน้าจอที่พบอาการและเทียบ `/api/items` ของ item เดียวกับ source ว่ามี `interestingness` และ `production_state=collected` หรือไม่. ถ้าไม่ตรง ให้แก้ deployment/cache/version drift ไม่ใช่เพิ่ม database score.
2. ถ้า UI ต้องแสดงคะแนนทุก queue state ให้เปลี่ยนเงื่อนไข render จาก `isRawRow` ให้แสดง badge สำหรับ Clean Prep ด้วย แล้วกำหนด UX ที่ชัดเจนว่า score เป็น derived สด ไม่ใช่ canonical intelligence priority.
3. แก้ numeric sentinel ใน scorer (`null` ต้องไม่ถูกแปลงเป็น 0 ก่อนพิจารณา Google rating/count) และเพิ่ม regression tests สำหรับ Google Maps payload. นี่แก้ความแม่นยำของคะแนน แต่ไม่ใช่สาเหตุที่ควรทำให้ cell ว่างใน source ปัจจุบัน.
