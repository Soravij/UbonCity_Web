# UbonCity Web - UAT Checklist (Freelance)

อ้างอิงจาก:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

## Metadata

- วันที่: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________
- Role: Freelance

## 1) ความพร้อมก่อนเริ่ม

- [ ] เข้า `collector-test.uboncity.com` ได้
- [ ] ผ่าน Cloudflare Access OTP ได้ก่อน login ระบบ ถ้า route นี้ถูกครอบ
- [ ] login ด้วยบัญชี freelance ได้
- [ ] มี assignment สำหรับ freelance พร้อมทดสอบอย่างน้อย 1 งาน

## 2) Global Smoke

- [ ] login สำเร็จ
- [ ] logout สำเร็จ
- [ ] session หมดอายุแล้วระบบพากลับหน้า login ถูกต้อง
- [ ] login กลับมาแล้ว deep-link / return_to ถูกต้อง

## 3) ขอบเขตสิทธิ์ Freelance

- [ ] เข้าเฉพาะ `freelance-home` และหน้าทำงานของตัวเอง
- [ ] `/?tab=work` หรือ route งานที่เทียบเท่า เปิดได้ถูกต้อง
- [ ] ถูกกันจาก owner/admin/user/editor-only surfaces
- [ ] direct-hit ไปหน้าที่ไม่ควรเข้า ถูก redirect ถูกปลายทาง

## 4) Freelance Assignment Intake

- [ ] เห็นเฉพาะงานที่ถูก assign ให้ตัวเอง
- [ ] เปิด assignment จาก work queue ได้
- [ ] item / assignment metadata ตรงกับงานที่ได้รับ

## 5) Freelance Execution

- [ ] ทำงานที่ได้รับมอบหมายได้สำเร็จ
- [ ] upload / select asset ได้ ถ้าอยู่ใน scope
- [ ] submit รอบแรกได้

## 6) Freelance Revision Loop

- [ ] ได้รับ revision request ได้
- [ ] reopen assignment เดิมกลับมาแก้ได้
- [ ] แก้และ resubmit รอบถัดไปได้
- [ ] งานเดิมไม่หายหลัง reopen / resubmit

## 7) Regression Hotspots

- [ ] freelance work tab ไม่หลุด context
- [ ] portal redirect ยังถูกต้อง
- [ ] legacy fallback ไม่ข้าม role boundary
- [ ] asset operations ไม่ข้าม assignment

## 8) Failure Log

| ID | Severity | URL/Page | Item/Assignment ID | Steps / Expected / Actual | Evidence |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 9) Freelance Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround หรือปิดแล้ว
- [ ] freelance submit และ revision loop ผ่าน
- [ ] freelance ยังอยู่ใน role boundary ที่ถูกต้อง

- Decision: [ ] PASS  [ ] FAIL
- Approved by: __________
