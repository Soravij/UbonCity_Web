# Step 4 Warning / Checklist Mapping V1

## เป้าหมาย

ล็อก mapping สำหรับรอบ 4 ว่า warning/checklist ที่เกี่ยวกับ `เตรียมงานก่อนมอบหมาย` ต้องย้ายจาก assignment/legacy flow มาอยู่ใน `step 4: ตรวจแก้และจัดชุดสั่งงาน` ตรงไหนบ้าง

เอกสารนี้ตั้งใจใช้เป็น guardrail ก่อนลงมือย้าย UI จริง เพื่อกัน scope ไหลไปแตะ warning ฝั่ง execution เช่น submission, review, deliverable acceptance

## Product decision

- `assignment` ไม่ใช่ quality gate ของ content อีกแล้ว
- warning/checklist ที่ใช้ตัดสินว่า brief พร้อมพอให้มอบหมายหรือยัง ต้องอยู่ใน `step 4`
- `step 4` ต้องแสดง warning เป็น 3 ชั้น
  - `Top summary`
  - `Section warning`
  - `Field marker`
- ห้ามย้าย warning ฝั่ง `submission/review/deliverable execution` เข้ามาปนในรอบนี้

## ชั้นการแสดงผลใน Step 4

### 1. Top summary

ใช้สำหรับบอกภาพรวมว่า `ยังไม่พร้อมมอบหมาย` เพราะอะไรบ้าง

ตำแหน่งปัจจุบัน:
- `renderPackagingSummary()` ใน [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2450)

หน้าที่:
- รวม blocker สำคัญที่กระทบการมอบหมายทั้งก้อน
- แยก `hard blocker` กับ `soft guidance` ให้ชัดในรอบ implement

### 2. Section warning

ใช้สำหรับเตือนใต้ section ที่เกี่ยวข้องโดยตรง

ตัวอย่าง section:
- `ความคืบหน้างานภาคสนาม`
- `สรุปหลังตรวจแก้`
- `ข้อมูลที่ต้องยืนยันหน้างาน`
- `Shot List`
- `คำถามที่ต้องถาม`
- `ภาพอ้างอิงจาก assets ที่เลือกไว้`
- `แหล่งอ้างอิงที่ดึงมาแล้ว`

### 3. Field marker

ใช้กับ field ที่ต้องให้คนกรอกหรือเติมก่อนมอบหมาย

ตำแหน่งปัจจุบัน:
- `updatePackagingRequirementMarkers()` ใน [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2408)

หน้าที่:
- ติด `ต้องระบุ`
- highlight container
- แสดง note ใต้ field

## Source เดิมของ warning/checklist

### A. Step 4 ปัจจุบันที่มีอยู่แล้ว

มาจาก `buildPackagingRequirements()` ใน [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2322)

รายการปัจจุบัน:
- `fp-status`
- `fp-editor-summary`
- `fp-media-hints-editor`
- `fp-must-verify-facts`
- `fp-must-capture-shots`
- `fp-must-ask-questions`

สรุป:
- ก้อนนี้คือฐานของรอบ 4
- ควรเก็บไว้และขยายต่อ ไม่ควรย้าย logic ออกไปที่ assignment

### B. Legacy assignment brief / handoff summary

มาจาก `renderAssignmentHandoffBrief()` ใน [app.js](/D:/UbonCity_Web/collector/server/public/app.js:2306)

สิ่งที่ assignment brief เคย render:
- brief summary
- recommended angle
- hook
- niche
- writer notes
- field notes
- expected deliverables
- source metadata ของ brief

สรุป:
- รายการพวก `summary / angle / hook / field notes` ควรถือเป็นของ `step 4`
- `expected deliverables` เป็นข้อมูลประกอบการมอบหมาย แต่ไม่ใช่ warning เตรียมงานหลักในรอบนี้
- `source metadata` แบบ `Readiness #...` เป็น legacy technical metadata ไม่ควรย้ายเข้าหน้าใช้งานหลัก

### C. Legacy utility / readiness / governance warning

สิ่งที่ยังเหลือในระบบฝั่ง assignment/backend:
- `handoff`
- `governance`
- `readiness`
- `missing_requirements`
- `blockers`
- `reason_codes`

สรุป:
- warning ที่อธิบายเป็นภาษางานได้และเกี่ยวกับการเตรียม brief ต้อง map กลับมา step 4
- warning ที่เป็น execution utility ของ assignment หรือเป็น technical metadata ไม่ต้องย้ายในรอบนี้

## Mapping หลัก: warning ไหนไปอยู่ตรงไหนใน Step 4

| Warning / Checklist เดิม | ความหมายในงานจริง | ปลายทางใน Step 4 | ชั้นการแสดงผล |
| --- | --- | --- | --- |
| `field_pack.status` ยังต่ำกว่า `ready_for_field` | ชุดงานยังไม่พร้อมส่งทีม | section `ความคืบหน้างานภาคสนาม` | top summary + section warning + field marker |
| ไม่มี `editor_summary` หรือ brief summary สั้นเกินไป | คนรับงานยังไม่เห็นสารหลักของงาน | section `สรุปหลังตรวจแก้` | top summary + field marker |
| ไม่มี `must_verify_facts` | ยังไม่รู้ว่าต้องยืนยันอะไรหน้างาน | section `ข้อมูลที่ต้องยืนยันหน้างาน` | top summary + section warning + field marker |
| ไม่มี `must_capture_shots` | ยังไม่รู้ว่าต้องเก็บภาพอะไร | section `Shot List` | top summary + section warning + field marker |
| ไม่มี `must_ask_questions` | ยังไม่รู้ว่าต้องถามอะไร | section `คำถามที่ต้องถาม` | top summary + section warning + field marker |
| ไม่มีภาพอ้างอิงจาก selected assets | ทีมหน้างานไม่มี visual reference ขั้นต้น | section `ภาพอ้างอิงจาก assets ที่เลือกไว้` | top summary + section warning + field marker |
| ไม่มี `story_angle` หรือ angle หลักไม่ชัด | งานยังไม่ชัดว่าจะเล่าอะไร | section `มุมเล่าเรื่อง` | top summary + section warning |
| ไม่มี reference summary ที่พอใช้ | คนจัดงานยังไม่ได้ดึงที่มาประกอบ brief | section `แหล่งอ้างอิงที่ดึงมาแล้ว` | section warning |
| ไม่มี `field_notes` | ไม่มี note พิเศษ แต่ไม่ควร block | section `หมายเหตุหน้างาน` | section warning แบบ soft เท่านั้น |
| `expected_deliverables` ยังไม่ชัด | รู้ว่าจะให้ส่งอะไรกลับไม่ชัด | section assignment summary ใน step 4 ภายหลัง | ยังไม่ย้ายในรอบนี้ |
| `Readiness #...` / source metadata / governance ids | metadata เชิงระบบ | ไม่ควร render ใน UX หลัก | ไม่ย้าย |

## Warning ที่ตั้งใจไม่ย้ายในรอบนี้

ห้ามแตะ warning ต่อไปนี้:

### Submission / Review / Deliverable execution
- submission decision
- review decision
- deliverable readiness
- deliverables summary
- handoff utility ที่ใช้หลังมี assignment แล้ว
- governance summary ที่ใช้ประเมินผลงานส่งกลับ

เหตุผล:
- เป็น warning ของ execution หลังมอบหมายงานแล้ว
- ถ้าย้ายเข้ามาใน step 4 จะทำให้ `step 4` กลายเป็นหน้า assignment อีกรอบ

## Hard blocker vs soft warning

### Hard blocker ที่ควรอยู่ใน top summary
- สถานะภาคสนามยังไม่ถึง `พร้อมลงหน้างาน`
- ไม่มี brief summary ที่พอใช้
- ไม่มีสิ่งที่ต้องยืนยัน
- ไม่มี shot list
- ไม่มีคำถามที่ต้องถาม

### Soft warning ที่ควรเป็น section warning
- ยังไม่มีภาพอ้างอิง
- angle ยังไม่ชัด
- ยังไม่มี reference summary
- ยังไม่มี field notes

หมายเหตุ:
- ร่างนี้ตั้งใจ conservative
- ถ้ารอบ implement ต้องลด friction เพิ่ม อาจลดบางข้อจาก hard blocker เป็น soft warning ได้ แต่ต้องตัดสินใจแยกในรอบ implement ไม่ใช่ระหว่างย้ายแบบ ad hoc

## ปลายทางในโค้ดที่ควรใช้

### Top summary
- [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2450)

### Field marker
- [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2408)

### Requirement builder
- [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:2322)

### Reference summary
- [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:728)

### Media hints / selected assets
- [item-editor.js](/D:/UbonCity_Web/collector/server/public/item-editor.js:1942)

## Implementation order for รอบ 4

1. ขยาย `buildPackagingRequirements()` ให้ครอบ warning ที่ต้องอยู่ใน step 4 จริง
2. เพิ่ม `section warning` renderer สำหรับ section ที่ยังมีแต่ field marker
3. แยก `hard blocker` กับ `soft warning` ใน `renderPackagingSummary()`
4. อย่าแตะ submission/review/deliverable utility เดิมในรอบเดียวกัน

## Audit guardrails

Reviewer ควรจับต่อในรอบ implement ถัดไป:
- มี warning ไหนของ assignment execution หลุดเข้ามาใน step 4 หรือไม่
- มี technical metadata เช่น `Readiness #...` หรือ `governance` โผล่ใน UX step 4 หรือไม่
- top summary พูดว่าไม่พร้อม แต่ field/section ไม่ชี้จุดให้แก้หรือไม่
- field marker ขึ้นถาวรเกินกว่าที่ logic จริงกำหนดหรือไม่
- assignment page ยังตรวจ content preparation ซ้ำอยู่หรือไม่
