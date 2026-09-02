# Handoff Queue Filter — Debt Note

**Status**: ยังไม่แก้ — เก็บเป็นหนี้

**Summary**: `isSelectedAssignmentAccepted` (publishable-assignment-candidate.mjs:59-62) เช็คแค่ accepted/closed ทำให้ item ที่มี assignment เปิดอยู่กลับเข้าคิว handoff

**Impact**: app.js หลายจุด + article-intake.js:457,463,471,511 — บั๊กเก่ากว่า branch นี้

**Plan**: รอทำเป็นงานแยกหลัง DOM split จบ
