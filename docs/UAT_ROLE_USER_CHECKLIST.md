# UbonCity Web - UAT Checklist (User)

อ้างอิงจาก:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

## Metadata

- วันที่: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________
- Role: User

## 1) ความพร้อมก่อนเริ่ม

- [ ] เข้า `collector-test.uboncity.com` ได้
- [ ] ผ่าน Cloudflare Access OTP ได้ก่อน login ระบบ ถ้า route นี้ถูกครอบ
- [ ] login ด้วยบัญชี user ได้
- [ ] backend, collector, frontend, admin รันครบ

## 2) Global Smoke

- [ ] login สำเร็จ
- [ ] logout สำเร็จ
- [ ] session หมดอายุแล้วระบบพากลับหน้า login ถูกต้อง
- [ ] login กลับมาแล้ว deep-link / return_to ถูกต้อง
- [ ] ไม่มี auth redirect loop

## 3) ขอบเขตสิทธิ์ User

- [ ] เข้า manager/work surfaces ที่ user ควรเข้าได้
- [ ] ถูกกันจาก owner-only และ admin-only surfaces
- [ ] direct URL / query string ไม่ทำให้สิทธิ์ขยายเกิน role

## 4) User Full Lifecycle

- [ ] ทำ flow จาก raw/source ไป backend display ได้สำเร็จ 1 รอบ
- [ ] สร้าง content และขยับ workflow ได้ในขอบเขตที่ user มีสิทธิ์
- [ ] backend-visible result ตรงกับ content ที่คาดไว้

## 5) User Assignment Flow

- [ ] assign งานให้ editor ได้
- [ ] assign งานให้ freelance ได้
- [ ] ไม่สามารถ assign นอกขอบเขตการดูแลได้
- [ ] assignment metadata ถูกต้อง

## 6) User Handoff Receive

- [ ] เห็นงานส่งกลับจาก freelance ได้
- [ ] เห็นงานส่งกลับจาก editor ได้
- [ ] รับงานกลับมาทำต่อได้โดยสถานะถูกต้อง
- [ ] ไม่มี content หรือ asset หายหลัง revise / resubmit

## 7) Regression Hotspots

- [ ] portal redirect ของ user ยังถูกต้อง
- [ ] legacy fallback ไม่ทำให้ข้าม role
- [ ] work queue / tab=work ไม่หลุด context
- [ ] timeline / history ตรงกับ action จริง

## 8) Failure Log

| ID | Severity | URL/Page | Item/Assignment ID | Steps / Expected / Actual | Evidence |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 9) User Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround หรือปิดแล้ว
- [ ] user lifecycle flow ผ่าน end-to-end
- [ ] assignment และ handoff flow ผ่าน

- Decision: [ ] PASS  [ ] FAIL
- Approved by: __________
