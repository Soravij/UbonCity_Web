# UbonCity_Web Agent Guide

## Current Project State

- Collector raw intake UX now defaults to `manual` for every role.
- `google_maps` is hidden by default in initial HTML and only becomes available to `owner` after client-side role sync.
- Non-owner roles must not see or select `google_maps` in the raw source adapter UI.
- Server-side raw collect guard remains unchanged: the UI restriction is not the security boundary.
- Local verification for the collector raw adapter change was completed before runtime rollout.

## Runtime Test Stack Canonical Commands

Use the repo-local stack script on runtime machines. Do not hardcode `RuntimeRoot` unless there is a machine-specific reason.

```powershell
cd D:\UbonRuntime\repos\UbonCity_Web
git pull --ff-only origin codex/collector-login-sync-post-auth
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\UbonRuntime\repos\UbonCity_Web\ops\windows\test-stack.ps1 -Action stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\UbonRuntime\repos\UbonCity_Web\ops\windows\test-stack.ps1 -Action start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\UbonRuntime\repos\UbonCity_Web\ops\windows\test-stack.ps1 -Action status
```

## Git Push Default Policy (Enforced)

When user says "fix" and then asks to "push git", follow this workflow by default.

### Branch model
- Baseline stabilization branch: `release/v0.1-stabilization`
- Bugfix branch pattern: `fix/<area>-<issue>`
- Do not push feature/fix work directly to `release/v0.1-stabilization` unless user explicitly says urgent hotfix.

### Tag model
- `v0.1.0-rc1`: first UAT baseline
- `v0.1.0-rc2`, `v0.1.0-rc3`: stabilization rounds
- `v0.1.0`: production-ready baseline

### Commit policy
- 1 commit = 1 issue
- Keep scope single-purpose and minimal
- Do not mix unrelated systems (`collector`, `frontend`, `admin`) in one commit unless required by one bug
- Commit message format:
  - `fix(<scope>): <what>`
  - `chore(<scope>): <what>`
  - `refactor(<scope>): <what>`
- Every commit must include:
  - problem fixed
  - impact summary
  - minimum verification performed

### PR policy
- Preferred PR title format: `fix(<scope>): <user-visible issue>`
- Require at least 1 reviewer before merge
- UI/typography PRs must include before/after screenshots
- If scope drifts, split into a new PR

### Execution order for push
1. Create/switch to bugfix branch from `release/v0.1-stabilization`
2. Apply minimal scoped fix
3. Run targeted verification for changed area
4. Commit using policy above
5. Push bugfix branch
6. Open PR back to `release/v0.1-stabilization`

เอกสารนี้ใช้กำหนดวิธีสั่งงานโมเดลในโปรเจกต์นี้ โดยเฉพาะเมื่อใช้ `DeepSeek` ผ่าน `Continue` ใน VS Code

## เป้าหมาย

- ลดการใช้โควต้า `Codex` กับงานที่ไม่จำเป็นต้องใช้ reasoning ระดับสูง
- บังคับ workflow สั้นและตรวจสอบได้: `review` -> `plan` -> `fix`
- จำกัด scope การแก้ให้ชัดเจน ลดการ refactor เกินเหตุ

## กติกาหลัก

- ตอบตรงไปตรงมา ไม่อวย
- ถ้ามีทางที่ดีกว่า ให้เสนอความเห็นแย้งพร้อมเหตุผล
- เน้นความถูกต้องก่อนความเร็ว
- ถ้าข้อมูลไม่พอหรือความเสี่ยงสูง ให้ถามก่อนแก้
- ห้ามทำงานยาวแบบ autonomous โดยไม่จำเป็น
- เวลาเสนอ patch ต้องอ่านง่าย ตรวจได้ และระบุผลกระทบสั้น ๆ

## Workflow บังคับ

ทุกงานให้เริ่มด้วยการเลือก 1 stage เท่านั้น

1. `review`
- ใช้เพื่อทำความเข้าใจงาน, ระบุไฟล์ที่เกี่ยวข้อง, และประเมินความเสี่ยง
- ห้ามกระโดดไปเสนอ patch ทันทีถ้าบริบทยังไม่พอ

2. `plan`
- ใช้เพื่อแตกงานเป็นขั้นสั้น ๆ
- ต้องระบุ file scope และจุดตรวจสอบหลังแก้

3. `fix`
- ใช้เมื่อ scope ชัดและความเสี่ยงยอมรับได้
- ต้องแก้แบบจำกัดขอบเขตที่สุด

## มาตรฐานการทำงานข้ามเครื่อง

ใช้ workflow นี้เป็นค่า default ของโปรเจกต์

บทบาทของแต่ละเครื่อง:
- Main Machine: แก้โค้ด, review, plan, fix, local verification, commit, push
- Runtime Machine: pull diff, manual test, integration test, runtime validation, headless validation

ลำดับการทำงานมาตรฐาน:
1. `review` ระบุ scope และความเสี่ยง
2. `plan` จำกัดขอบเขต diff ให้เล็กที่สุด
3. `fix` และแก้บน Main Machine เท่านั้น
4. ทดสอบบน Main Machine ให้เสร็จเท่าที่ทำได้ก่อน push
5. push diff
6. pull ที่ Runtime Machine
7. ทดสอบซ้ำบน Runtime Machine เพื่อยืนยัน integration/runtime behavior

กติกาบังคับ:
- ห้าม push diff ที่ยังไม่ผ่าน local verification ตามประเภทงาน
- ให้ถือ Runtime Machine เป็นด่านยืนยันสุดท้าย ไม่ใช่ด่าน debug แรก
- ถ้างานเป็น UI/frontend หรือ bug เล็ก ต้องพยายามตรวจให้จบบน Main Machine ก่อน
- ถ้างานผูกกับ auth, runtime flow, collector flow, integration, หรือ environment-specific behavior ต้องยืนยันซ้ำบน Runtime Machine เสมอ
- ทุก patch ต้องอธิบายได้ว่าหลัง pull ไปแล้วควรทดสอบอะไรบน Runtime Machine

แนวทางออกแบบ patch ให้ push ง่าย:
- 1 issue = 1 patch
- แก้แบบ single-purpose diff
- หลีกเลี่ยง rename, mass format, file move, และ unrelated cleanup
- แยก UI cleanup ออกจาก logic change คนละรอบ
- ถ้างานเริ่มลามเกิน 3 ไฟล์ ให้หยุดประเมินก่อนทำต่อ

ตัวอย่าง local verification ก่อน push:
- frontend/admin UI: build, smoke view, responsive spot check
- backend bug เล็ก: targeted smoke, affected endpoint check, log/error review
- collector/runtime-related change: ตรวจได้เท่าที่ทำได้บน Main Machine แล้วค่อยยืนยันซ้ำบน Runtime Machine

## เมื่อไรเหมาะใช้ DeepSeek

เหมาะ:
- อธิบาย code
- สรุป flow ของไฟล์หรือ module
- หาไฟล์ที่เกี่ยวข้องกับ feature/bug
- ร่าง TODO list
- ร่าง unit test หรือ smoke test
- แก้ bug เล็กใน scope จำกัด
- แก้ logic ในไฟล์เดียวหรือไม่เกิน 3 ไฟล์ที่ผลกระทบตรงไปตรงมา
- ช่วยร่าง prompt, commit message, PR summary, changelog

ไม่เหมาะ:
- refactor ข้ามหลาย subsystem
- schema/database migration
- auth, permission, security-sensitive logic
- deploy, infra, environment config ที่เสี่ยง production
- payment, queue, background jobs, retry logic
- งานที่ contract ไม่ชัดหรือ side effect ซ่อนอยู่
- งานที่ต้องคุม regression สูง

กฎตัดสินใจ:
- ถ้าแตะเกิน 3 ไฟล์ หรือแตะมากกว่า 1 subsystem ให้หยุดประเมินก่อน
- ถ้ามี migration, permission boundary, public API contract, หรือ data integrity risk ให้ย้ายไป `Codex` หรือ human review

## รูปแบบคำตอบที่ต้องการจากโมเดล

ทุกคำตอบควรสั้น ชัด และตรวจสอบได้

รูปแบบขั้นต่ำ:

```text
review | plan | fix
Goal:
Scope:
Risks:
Next step:
```

ถ้าเสนอการแก้ ให้เพิ่ม:

```text
Files to change:
Why this is the smallest safe change:
Verification:
Impact:
```

## ถ้าผู้ใช้ขอ "prompt สำหรับ DeepSeek"

ให้ตอบเป็น prompt ที่พร้อมนำไปวางใน VS Code Continue ทันที โดยต้องมี:

- บทบาทของโมเดล
- stage ที่ต้องทำ (`review`, `plan`, `fix`)
- เป้าหมายงาน
- file scope ที่อนุญาต
- สิ่งที่ห้ามทำ
- รูปแบบผลลัพธ์ที่บังคับ
- เกณฑ์ว่าควรหยุดและ escalate เมื่อไร

Template กลาง:

```text
You are acting as a strict senior engineer for the UbonCity_Web repository.

Stage: [review|plan|fix]
Goal: [describe the task]
Allowed file scope: [list files or modules]
Do not:
- refactor unrelated code
- rename existing structures unless required
- guess missing behavior
- continue if risk is high and context is incomplete

Required output:
1. Stage label
2. Goal understood
3. Relevant files
4. Risks/blockers
5. Proposed plan or fix
6. Verification steps
7. Routing decision: continue on DeepSeek or escalate
```

## คำสั่งแนะนำสำหรับผู้ใช้

ตัวอย่างคำสั่งไทย:

```text
/review-th ตรวจ flow การสร้าง article ตั้งแต่ collector ถึง backend และบอกว่าควรแก้ต่อบน DeepSeek หรือไม่
```

```text
/plan-th วางแผนแก้ bug นี้แบบแตะให้น้อยที่สุด: [อธิบาย bug]
```

```text
/fix-th แก้เฉพาะไฟล์ต่อไปนี้: [list files] เป้าหมายคือ [goal]
```

ตัวอย่างคำสั่งอังกฤษ:

```text
/review-en Review this bug scope and decide whether it is safe to keep on DeepSeek.
```

```text
/plan-en Create a minimal change plan for this task and keep the file scope explicit.
```

```text
/fix-en Propose the smallest safe patch for this issue and list verification steps.
```

## หมายเหตุด้านความปลอดภัย

- ห้ามฝัง API key ลง repo
- ถ้ามีไฟล์ config ตัวอย่างเก่าที่มี key จริง ต้องถือว่า key รั่วและควร rotate
- ใน repo นี้ให้เก็บเฉพาะ template หรือ placeholder เท่านั้น
