# UbonCity Web - ดัชนี UAT Checklist แยกตาม Role

เอกสารอ้างอิงต้นแบบ:
- `UAT_CHECKLIST_UBONCITY_WEB.md`
- `UAT_E2E_MASTER_CHECKLIST.md`

วัตถุประสงค์:
- แยก UAT ออกเป็นชุดตาม role
- ให้ tester แต่ละคนใช้เฉพาะ checklist ของ role ตัวเอง
- คงรูปแบบหลักให้เทียบผลข้าม role ได้

วิธีใช้:
1. ให้แต่ละ tester ใช้ checklist ตาม role ของตัวเอง
2. ใช้ build/commit และ environment เดียวกันในรอบ UAT เดียวกัน
3. บันทึกหลักฐานทุกข้อที่ไม่ผ่านหรือมีข้อสังเกต
4. สรุปผลรวมทุก role ก่อนตัดสิน GO / NO-GO

รายการไฟล์:
- `UAT_ROLE_OWNER_CHECKLIST.md`
- `UAT_ROLE_ADMIN_CHECKLIST.md`
- `UAT_ROLE_USER_CHECKLIST.md`
- `UAT_ROLE_EDITOR_CHECKLIST.md`
- `UAT_ROLE_FREELANCE_CHECKLIST.md`

หมายเหตุ environment ปัจจุบัน:
- public frontend: `https://test.uboncity.com`
- admin: `https://admin-test.uboncity.com`
- collector: `https://collector-test.uboncity.com`
- `admin-test` และ `collector-test` มี 2 ชั้น
  - Cloudflare Access OTP
  - login ของระบบ
