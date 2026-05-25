# UbonCity Web - UAT Checklist (Admin)

อ้างอิงจาก:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

## Metadata

- วันที่: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________
- Role: Admin

## 1) ความพร้อมก่อนเริ่ม

- [ ] เข้า `admin-test.uboncity.com` และ `collector-test.uboncity.com` ได้
- [ ] ผ่าน Cloudflare Access OTP ได้ก่อน login ระบบ
- [ ] login ด้วยบัญชี admin ได้
- [ ] backend, collector, frontend, admin รันครบ

## 2) Global Smoke

- [ ] login สำเร็จ
- [ ] logout สำเร็จ
- [ ] session หมดอายุแล้วระบบพากลับหน้า login ถูกต้อง
- [ ] login กลับมาแล้ว deep-link / return_to ถูกต้อง
- [ ] ไม่มี auth redirect loop

## 3) ขอบเขตสิทธิ์ Admin

- [ ] เข้า internal operational surfaces ได้
- [ ] เข้า contributor-management surfaces ที่ design อนุญาตได้
- [ ] ถูกกันจาก owner-only surfaces
- [ ] direct URL / query string ไม่ทำให้ admin ทำ owner-only action ได้

## 4) Admin Full Lifecycle

- [ ] ทำ flow จาก raw/source ไป backend display ได้สำเร็จ 1 รอบ
- [ ] แก้ metadata ก่อนสร้าง content ได้
- [ ] workflow ไปถึง backend-visible state ที่คาดไว้
- [ ] backend แสดงผลตรงกับ content ที่สร้าง

## 5) Admin Assignment Flow

- [ ] assign งานให้ editor ได้อย่างน้อย 1 งาน
- [ ] assign งานให้ freelance ได้อย่างน้อย 1 งาน
- [ ] assignee เห็นเฉพาะงานที่ตั้งใจส่ง
- [ ] assignment metadata ถูกต้อง

## 6) Admin Review / Approval Flow

- [ ] เห็นงานส่งกลับจาก editor ได้
- [ ] เห็นงานส่งกลับจาก freelance ได้
- [ ] revision request flow ทำงานได้
- [ ] review preview เปิดได้
- [ ] publish / release action ที่ admin มีสิทธิ์ใช้งานได้ ถ้าอยู่ใน scope รอบนี้

## 7) Regression Hotspots

- [ ] portal redirect ของ admin ยังถูกต้อง
- [ ] legacy fallback ไม่ทำให้ข้าม role
- [ ] ไม่มี privilege escalation ผ่าน direct URL
- [ ] timeline / history ตรงกับ action จริง

## 8) Failure Log

| ID | Severity | URL/Page | Item/Assignment ID | Steps / Expected / Actual | Evidence |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 9) Admin Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround หรือปิดแล้ว
- [ ] admin lifecycle flow ผ่าน end-to-end
- [ ] admin ยังถูกกันจาก owner-only scope ถูกต้อง

- Decision: [ ] PASS  [ ] FAIL
- Approved by: __________
