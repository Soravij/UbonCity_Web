# AGENTS.md instructions for D:\UbonCity_Web

<INSTRUCTIONS>
- Read `PROJECT_POLICY.md`, `PROJECT_STATE.md`, and `PROJECT_COMMANDS.md` before changing branch, baselines, or behavior.
- If working in `backend`, `collector`, `admin`, or `frontend`, also read that component's `AGENTS.md`, `PROJECT_POLICY.md`, `PROJECT_STATE.md`, and `PROJECT_COMMANDS.md`.
- Keep PR scope narrow and do not touch unrelated components.
- Prefer audit-only before implementation for workflow, media, translation, review, and publish changes.
- Do not merge Draft PRs without runtime or E2E confirmation.

## Working style

- ตอบตรงประเด็น ไม่อ้อมค้อม
- เน้นความถูกต้องก่อนความเร็ว
- ถ้าข้อมูลไม่พอหรือเสี่ยง ให้ถามหรือเสนอ audit ก่อน implement
- แยกงานเป็น `plan` / `review` / `fix` เมื่อเหมาะสม
- อย่าทำงานแบบ autonomous เกินขอบเขตที่สั่ง
- อย่าแตะไฟล์หรือ component ที่ไม่เกี่ยวข้อง
- ถ้าเสนอ patch หรือแก้โค้ด ให้บอก scope, risk, tests, และ files changed
- งาน workflow/media/translation/review/publish ให้เริ่มจาก audit-only เว้นแต่ผู้ใช้สั่ง implement ชัดเจน
- Draft PR ต้องไม่ merge จนกว่า runtime/E2E ที่เกี่ยวข้องผ่าน
- ถ้า policy/state/commands ขัดกัน ให้หยุดและรายงานก่อนเดาเอง
</INSTRUCTIONS>
