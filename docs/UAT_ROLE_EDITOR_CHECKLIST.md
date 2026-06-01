# UbonCity Web - UAT Checklist (Editor)

อ้างอิงจาก:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

## Metadata

- วันที่: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________
- Role: Editor

## 1) ความพร้อมก่อนเริ่ม

- [ ] เข้า `collector-test.uboncity.com` ได้
- [ ] ผ่าน Cloudflare Access OTP ได้ก่อน login ระบบ ถ้า route นี้ถูกครอบ
- [ ] login ด้วยบัญชี editor ได้
- [ ] มี assignment สำหรับ editor พร้อมทดสอบอย่างน้อย 1 งาน

## 2) Global Smoke

- [ ] login สำเร็จ
- [ ] logout สำเร็จ
- [ ] session หมดอายุแล้วระบบพากลับหน้า login ถูกต้อง
- [ ] login กลับมาแล้ว deep-link / return_to ถูกต้อง

## 3) ขอบเขตสิทธิ์ Editor

- [ ] เข้าเฉพาะ `editor-home`, `article-workspace`, `event-workspace` หรือหน้าที่อยู่ใน scope
- [ ] ถูกกันจาก owner/admin/user-only management surfaces
- [ ] direct-hit ไปหน้าที่ไม่ควรเข้า ถูก redirect ถูกปลายทาง

## 4) Editor Assignment Intake

- [ ] เห็นเฉพาะงานที่ถูก assign ให้ตัวเอง
- [ ] เปิด assignment จาก work queue ได้
- [ ] item / assignment metadata ตรงกับงานที่ได้รับ

## 5) Editor Execution

- [ ] แก้ content ได้
- [ ] save งานได้
- [ ] upload / select asset ได้
- [ ] submit รอบแรกได้

## 6) Editor Revision Loop

- [ ] ได้รับ revision request ได้
- [ ] reopen งานเดิมกลับมาแก้ได้
- [ ] แก้และ resubmit รอบถัดไปได้
- [ ] งานเดิมไม่หายหลัง reopen / resubmit

## 7) Regression Hotspots

- [ ] editor portal redirect ยังถูกต้อง
- [ ] work queue links ไม่หลุด item context
- [ ] asset operations ไม่ข้าม assignment
- [ ] returned status / timeline ถูกต้อง

## 8) Failure Log

| ID | Severity | URL/Page | Item/Assignment ID | Steps / Expected / Actual | Evidence |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 9) Editor Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround หรือปิดแล้ว
- [ ] editor submit และ revision loop ผ่าน
- [ ] editor ยังอยู่ใน role boundary ที่ถูกต้อง

- Decision: [ ] PASS  [ ] FAIL
- Approved by: __________
