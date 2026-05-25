# UbonCity Web - UAT Checklist (Owner)

อ้างอิงจาก:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

## Metadata

- วันที่: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________
- Role: Owner

## 1) ความพร้อมก่อนเริ่ม

- [ ] เข้า `admin-test.uboncity.com` และ `collector-test.uboncity.com` ได้
- [ ] ผ่าน Cloudflare Access OTP ได้ก่อน login ระบบ
- [ ] login ด้วยบัญชี owner ได้
- [ ] backend, collector, frontend, admin รันครบ
- [ ] เตรียม item ID / assignment ID / โฟลเดอร์เก็บหลักฐานพร้อม

## 2) Global Smoke

- [ ] login สำเร็จ
- [ ] logout สำเร็จ
- [ ] session หมดอายุแล้วระบบพากลับหน้า login ถูกต้อง
- [ ] login กลับมาแล้ว deep-link / return_to ถูกต้อง
- [ ] direct-hit หน้า legacy ไม่ทำให้ auth flow พัง
- [ ] ไม่มี loop จาก `auth=expired`

## 3) ขอบเขตสิทธิ์ Owner

- [ ] เข้า owner-only surfaces ได้
- [ ] เข้า internal operational surfaces ได้
- [ ] เข้า flow จัดการ contributor / assignment ได้
- [ ] ไม่เจอ permission denied ใน flow ที่ owner ควรทำได้

## 4) Owner Full Lifecycle

- [ ] สร้างงานจาก raw/source flow ได้สำเร็จ 1 รอบ
- [ ] ตรวจและแก้ metadata สำคัญก่อนสร้าง content ได้
- [ ] สร้าง content item สำเร็จ
- [ ] ดัน workflow ไปถึงสถานะที่ backend ควรเห็นได้
- [ ] backend แสดงผลตรงกับข้อมูลจาก collector/source
- [ ] เก็บหลักฐาน item ID / status / screen ครบ

## 5) Owner Assignment Flow

- [ ] assign งานให้ editor ได้อย่างน้อย 1 งาน
- [ ] assign งานให้ freelance ได้อย่างน้อย 1 งาน
- [ ] assignee / assignment state / item target ถูกต้อง
- [ ] งานที่ assign เห็นเฉพาะผู้รับที่ถูกต้อง
- [ ] เก็บหลักฐาน assignment ครบ

## 6) Owner Review / Handoff Verification

- [ ] เห็นงานส่งกลับจาก freelance ได้
- [ ] เห็นงานส่งกลับจาก editor ได้
- [ ] revision request loop ทำงานได้ทั้ง 2 แบบ
- [ ] รับงานกลับมาทำต่อได้โดยสถานะถูกต้อง
- [ ] ไม่มี content หรือ asset หายหลัง revise / resubmit

## 7) Owner Publish / Release Surface

- [ ] review preview เปิดได้
- [ ] publish / release action ทำงานได้ ถ้าอยู่ใน scope รอบนี้
- [ ] backend / frontend หลัง publish ตรงกับ approved content
- [ ] media แสดงผลถูกต้องบน public surface

## 8) Regression Hotspots

- [ ] role boundary ยังถูกต้องเมื่อเปิด direct URL
- [ ] fallback จาก legacy path ไม่ข้าม role
- [ ] upload / download asset ไม่ข้าม item หรือ role
- [ ] timeline / history ตรงกับ action จริง

## 9) Failure Log

| ID | Severity | URL/Page | Item/Assignment ID | Steps / Expected / Actual | Evidence |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 10) Owner Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround หรือปิดแล้ว
- [ ] owner lifecycle flow ผ่าน end-to-end
- [ ] assignment และ handoff verification ผ่าน

- Decision: [ ] PASS  [ ] FAIL
- Approved by: __________
