# UbonCity Web - UAT E2E Master Checklist

> เอกสารนี้แทนชุด checklist เดิมสำหรับการทดสอบใช้งานจริงแบบครบ flow  
> เวอร์ชันพิมพ์: `UAT_E2E_MASTER_CHECKLIST.print.html`

## กติกาการติ๊ก

- ผ่าน: `[ / ]`
- ไม่ผ่าน: `[ ]` และบันทึก Failure Log
- ทุกข้อบันทึกหลักฐาน: URL/ID งาน/ภาพ/เวลา/ผู้ทดสอบ

## Metadata

- Date: __________
- Environment: __________
- Build/Commit: __________
- Tester Lead: __________

---

## Phase A: Owner ทำงานจริง 1 รอบ (Raw -> Backend Display)

### A1) Owner content lifecycle
- [ ] สร้างงานจาก raw data source สำเร็จ
- [ ] ตรวจ/แก้ข้อมูลสำคัญก่อนสร้าง content
- [ ] สร้าง item/content สำเร็จ
- [ ] วิ่ง workflow จนถึงสถานะที่ต้องแสดงบน backend
- [ ] ยืนยันว่า backend แสดงผลตรงกับข้อมูลที่คาด
- [ ] เก็บหลักฐาน: item_id / status timeline / backend screen

### A2) Owner quality gate
- [ ] ตรวจ metadata สำคัญครบ (title/slug/status/time)
- [ ] ตรวจว่าไม่มีข้อมูลหายระหว่างขั้นตอน
- [ ] ตรวจ log/activity ว่าตรงกับ action จริง

---

## Phase B: Admin และ User ทำงานจริง 1 รอบ (Raw -> Backend Display)

### B1) Admin full cycle
- [ ] Admin ทำ flow เดียวกับ Owner ตั้งแต่ raw ถึง backend display สำเร็จ
- [ ] ตรวจว่า admin ถูกกันจาก owner-only surface ที่ไม่ควรเข้า
- [ ] หลักฐานครบ (item_id, timeline, screen)

### B2) User full cycle
- [ ] User ทำ flow เดียวกับ Owner ตั้งแต่ raw ถึง backend display สำเร็จ
- [ ] ตรวจว่า user ยังถูกกัน action ที่เกินสิทธิ์
- [ ] หลักฐานครบ (item_id, timeline, screen)

---

## Phase C: Assignment รอบใหญ่

### C1) Owner/Admin assign ให้ทุก role ภายใต้การดูแล
- [ ] Owner assign งานให้ Editor (อย่างน้อย 1 งาน)
- [ ] Owner assign งานให้ Freelance (อย่างน้อย 1 งาน)
- [ ] Admin assign งานให้ Editor (อย่างน้อย 1 งาน)
- [ ] Admin assign งานให้ Freelance (อย่างน้อย 1 งาน)
- [ ] ตรวจ visibility ว่าเห็นเฉพาะงานในขอบเขตที่ดูแล

### C2) User assign ให้ทุก role ภายใต้การดูแล
- [ ] User assign งานให้ Editor ได้
- [ ] User assign งานให้ Freelance ได้
- [ ] งานที่ assign โดย User ไม่หลุดขอบเขตการดูแล
- [ ] หลักฐานครบ (assignment_id / assignee / assigned_by)

---

## Phase D: Freelance Loop (รับงาน -> ส่งกลับ -> แก้ไข -> ส่งกลับ -> User รับต่อ)

### D1) Freelance execution
- [ ] Freelance เห็นเฉพาะงานของตัวเอง
- [ ] เปิดงานจาก `tab=work` ได้
- [ ] ส่งงานรอบแรกสำเร็จ
- [ ] ได้รับ revision request แล้วกลับมาแก้ไขได้
- [ ] ส่งงานรอบสองสำเร็จ

### D2) User handoff receive
- [ ] User เห็นงานส่งกลับจาก freelance
- [ ] User รับงานไปทำต่อได้โดยสถานะถูกต้อง
- [ ] สถานะ workflow หลังรับต่อถูกต้อง

---

## Phase E: Editor Loop (เขียน -> ส่งงาน -> แก้ไข -> ส่งงาน -> User รับต่อ)

### E1) Editor execution
- [ ] Editor เข้า `article-workspace`/`event-workspace` ได้
- [ ] เขียนและบันทึกงานสำเร็จ
- [ ] ส่งงานรอบแรกสำเร็จ
- [ ] ได้รับ revision request แล้วกลับมาแก้ไขได้
- [ ] ส่งงานรอบสองสำเร็จ

### E2) User handoff receive
- [ ] User เห็นงานส่งกลับจาก editor
- [ ] User รับงานไปทำต่อได้โดยสถานะถูกต้อง
- [ ] ตรวจความครบของเนื้อหา/asset หลังรับต่อ

---

## Phase F: Internal Matrix (Owner/Admin/User)

### F1) Access & capability matrix
- [ ] Owner/Admin/User เข้า surfaces ที่ควรเข้าได้ครบ
- [ ] Owner/Admin/User ถูกกันจากส่วนที่ไม่ควรเข้า
- [ ] ไม่มี role ที่เห็นงานนอกขอบเขตการดูแล

### F2) Action boundary matrix
- [ ] Owner action set ถูกต้องตาม design
- [ ] Admin action set ถูกต้องตาม design
- [ ] User action set ถูกต้องตาม design
- [ ] ไม่พบ privilege escalation ผ่าน direct URL/query params

---

## Phase G: เพิ่มเติมที่ควรทดสอบ (แนะนำ)

### G1) Reliability
- [ ] session หมดอายุระหว่างทำงานแล้ว recovery ได้
- [ ] deep link/return_to ยังพากลับปลายทางถูก
- [ ] direct-hit หน้า legacy ไม่หลุด role boundary

### G2) Data safety
- [ ] upload/download asset ไม่ข้ามงาน/ข้าม role
- [ ] history/timeline ตรงกับเหตุการณ์จริง
- [ ] ไม่มีข้อมูลหายหลัง revise-resubmit loop

---

## Failure Log

| ID | Severity | Phase | Role | URL/Page | Steps / Expected / Actual | Owner |
|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |

---

## Release Gate

- [ ] ไม่มี P1 ค้าง
- [ ] P2 มี workaround ชัดเจนหรือปิดครบ
- [ ] Phase A-F ผ่านครบ
- [ ] หลักฐานทดสอบครบและตรวจสอบย้อนกลับได้
- [ ] อนุมัติปล่อยใช้งาน

- Decision: [ ] GO  [ ] NO-GO
- Approved by: __________
- Date: __________

