# Backend Project Policy

See [../PROJECT_POLICY.md](../PROJECT_POLICY.md) for the canonical project-wide policy.

## Backend-specific rules

- Backend is not the source of Work Return taxonomy resolution.
- Backend receives and publishes approved resolved data only.
- Collector handoff snapshots are the workflow source for assignment questions.
- Published taxonomy must use stable keys.
- Future publication mapping must not reinterpret assignment questions retroactively.

## Collection entity limits

- shortcuts: สูงสุด 6 รายการ — บังคับใน `createShortcut()` (backend/repositories/shortcutRepository.js) ด้วย `SELECT COUNT(*) ... FOR UPDATE` แล้ว throw `SHORTCUT_LIMIT_REACHED` → controller ตอบ 409
- situations: สูงสุด 7 รายการ — pattern เดียวกัน error code `SITUATION_LIMIT_REACHED`
- เพดานนี้จำกัดจำนวน "หมวด" ไม่ใช่จำนวน places ต่อหมวด — `/:slug/places` ไม่มี LIMIT คืน places ทั้งหมดเรียงตาม sort_order
- เทสที่ล็อกกฎนี้ไว้: backend/tests/shortcuts.test.mjs
