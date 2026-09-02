# Audit สุดท้ายก่อน merge — fix/submit-gate-active-batch และ fix/backward-reload-deliverables-bundle

โหมด: Discovery/verification (read-only) — เครื่อง Runtime `D:\UbonRuntime\repos\UbonCity_Web`
Pipeline: `audit-scanner` → `audit-deep-reasoner` (static) + `test-runner` ×2-3 (execution: revert-proof,
rebase-check, gate) ทั้งหมดทำใน git worktree แยก ไม่แตะ main working tree ไม่ commit ไม่ merge
ไม่ restart process

**อัปเดต (รอบ v3 — final)**: บั๊ก body-double-read ถูกแก้แล้วบน commit `9cab55c` revert proof
รันสำเร็จด้วย recipe v2 เดิม (worktree นอก OS temp + copy `.env` + junction `node_modules` +
`--detach`) **ผลออกมาตรงตามที่คาดหวังทุกจุด — A2 ปิดได้แล้ว** เคส 1 pass บนโค้ดจริง และ fail ด้วย
`assert.strictEqual` 409-vs-201 (ไม่ใช่ crash) บนโค้ดที่ revert แล้ว เคส 2/3 pass ทั้งสองสถานะ ดู
หัวข้อ A2 ที่อัปเดตด้านล่างสำหรับ raw output เต็ม

---

## สรุปสั้นที่สุด (อัปเดตหลัง v3 — อ่านอันนี้)

| | ผล |
|---|---|
| **fix/submit-gate-active-batch (9cab55c)** | **revert proof ผ่านแล้ว — blocker หลัก (A2) ปิดได้** เคส 1 pass บนโค้ดจริง (`ok 1`), fail ด้วย `assert.strictEqual(status, 201)` ได้ 409 จริงตอน revert (`not ok 1`, ไม่ใช่ crash) เคส 2/3 pass ทั้งสองสถานะ hash หลัง restore ตรง เป็นครั้งแรกที่มีหลักฐานรันจริงว่า fix ทำงานถูกต้อง ผลข้างเคียงที่ดี: assertion เคส 1 ถูกแก้จาก `200\|\|201` หลวมๆ เป็น `strictEqual(201)` แล้ว (แก้ A4 ไปในตัว) และเคส 3 ถูกเปลี่ยนชื่อเป็น "...(not reset gate)" (ยอมรับ finding A5 แต่ยังไม่ได้เพิ่ม coverage จริง) A3 (fixture ใช้ `state:"assigned"` แทน `revision_requested` จริง) ยังไม่ได้แก้ — เหลือเป็น finding รองที่ยังควรพิจารณา ไม่ใช่ blocker |
| **fix/backward-reload-deliverables-bundle (bafdb46)** | **merge ไปแล้วจริง** (`git merge-base --is-ancestor` = ancestor ของ main ที่ commit `8c329ad`) ไม่มีอะไรให้ verify ก่อน merge อีก — ไม่เปลี่ยนจากรอบก่อน |
| **revert proof เคส 1** | **ผ่านแล้ว ยืนยันด้วยหลักฐานจริง** ทั้ง RUN 1 (unmodified) และ RUN 2 (reverted) — ดู raw output ในหัวข้อ A2 |
| **เลข gate** | ไม่ได้วัดซ้ำรอบนี้ตามคำสั่ง (out of scope) เลขล่าสุดจากรอบ v2: `TOTAL 1016 / PASS 949 / FAIL 66` เทียบ baseline `1013/947/65/1` — fail ส่วนเกิน 1 ตัวตอนนั้นคือเคส 1 ที่เพิ่งถูกแก้ในรอบนี้ **คาดว่า gate จะกลับมาที่ 65 fail พอดี** (ตามที่ผู้ขอสั่งให้สันนิษฐานไว้ ไม่ต้องวัดซ้ำ) แต่ยังเป็นการคาดการณ์ ไม่ใช่ตัวเลขที่วัดจริงบน `9cab55c` |

---

## A. fix/submit-gate-active-batch (cf4a755)

### A1 — test ใหม่ยิง HTTP จริงหรือไม่

**ใช่ ยืนยันแล้ว** `collector/tests/submit-gate-active-batch.test.mjs` (246 บรรทัด, แทนที่เวอร์ชัน mock
เดิมที่พบในรอบ audit ก่อนหน้า) spawn collector server จริงผ่าน `withServer()`/`reservePort()`/
`ownerToken()` (pattern เดียวกับ `backward-autoclose-scope.test.mjs`) ไม่ mock repository — ยืนยันจาก
git diff stat: `collector/tests/submit-gate-active-batch.test.mjs | 246 ++++++++++++++++++++++`
(เพิ่มใหม่ทั้งไฟล์ 2 commit บน branch: `5221300` แก้ logic, `cf4a755` แทนที่ test เดิมด้วย
endpoint-level test) — เคส 1/2/3 ทั้งหมดยิงผ่าน `fetch()` เข้า route จริง ไม่ใช่เรียกฟังก์ชันตรงๆ

### A2 — REVERT PROOF: **blocker ยืนยันแล้ว — ไม่ใช่ปัญหา environment แต่เป็นบั๊กในไฟล์ test เอง**

**รอบแรก + รอบสอง (v1, มี caveat)**: ทำใน worktree ที่ไม่มี `.env` → server บูตไม่ขึ้นทุกเคส
(`requireCollectorSecurityConfig`, `index.mjs:2343`) verify ไม่ได้ ถือเป็น environment artifact
(root cause: `collector/.env` ถูก gitignore, `git worktree add` ไม่ copy ให้) — ดูรายละเอียดวิธีแก้ที่
`docs/TEST_SUITE_BASELINE.md` หัวข้อ "Worktree measurement traps" (4 กับดัก: `.env`, ห้ามวางใน OS
temp dir เพราะชน `smoke-safety.test.mjs`, ต้องมี `node_modules`, ห้าม checkout `main` ใน worktree)

**รอบ v2 (แก้ครบทั้ง 4 กับดัก — worktree นอก OS temp, copy `.env`, junction `node_modules`,
`--detach` ที่ commit แทน checkout branch)**: server **บูตขึ้นจริง** คราวนี้ ไม่มี env crash แล้ว —
แต่เจอ blocker ใหม่ที่หนักกว่าเดิม:

**Step A (boot proof, standalone, โค้ดจริงที่ยังไม่ revert)**:
```
not ok 1 - revision_round=2 with round=1 assets passes submit gate (active batch semantics)
  error: 'Body is unusable: Body has already been read'
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
```
เคส 2, 3 **pass** ปกติ — เคส 1 อย่างเดียวพังด้วย `TypeError` ก่อนจะถึง assertion เรื่อง status code
เลยด้วยซ้ำ

**Step B (revert proof, standalone, หลัง `git apply -R` กลับเป็น `listAssignmentRoundAssetsByType`
เดิม)**:
```
not ok 1 - revision_round=2 with round=1 assets passes submit gate (active batch semantics)
  error: 'expected 200/201 but got 409: {"error":"บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"}'
  code: 'ERR_ASSERTION'
```
เคส 2, 3 pass เหมือนเดิม — คราวนี้เคส 1 fail ด้วย assertion error ที่ตรงกับที่ควรเห็น (409 แทน
200/201) ไม่ใช่ crash

**Step C (gate เต็ม suite, บนโค้ดจริงที่ restore แล้ว, hash ตรง `c9ec9be0bf...` ยืนยันแล้ว)**:
`TOTAL 1016 / PASS 949 / FAIL 66` — fail เพิ่มจาก baseline 65 อยู่ตัวเดียว ตรงกับชื่อ
`revision_round=2 with round=1 assets passes submit gate (active batch semantics)` พอดี (ไม่มี
รายชื่อ fail อื่นที่ไม่รู้จักเพิ่มมา) แปลว่า full-suite run ก็ล้มด้วยสาเหตุเดียวกันกับ Step A

**สรุปที่แท้จริง**: เคส 1 **fail ทุกสถานการณ์ที่ทดสอบ** ไม่ว่าจะเป็นโค้ด fix จริง (Step A/C) หรือ
โค้ดที่ revert แล้ว (Step B) — ต่างกันแค่ *สาเหตุ* การ fail (`TypeError` บนโค้ดจริง vs `409 assertion`
บนโค้ดเก่า) root cause ของ `TypeError: Body is unusable: Body has already been read` คือโค้ดใน test
อ่าน `response` body ซ้ำสองครั้ง (เช่น เรียก `.json()`/`.text()` ไปแล้วครั้งหนึ่งเพื่อดึง `body` มาใช้
ใน assertion ที่สอง แล้วดันไปอ่านซ้ำอีกครั้งตอนสร้างข้อความ error สำหรับ assert แรก — JS จะ evaluate
template literal ของ message argument เสมอไม่ว่า assertion จะผ่านหรือไม่ผ่าน) — เป็น**บั๊กในไฟล์ test
เอง ไม่ใช่ environment และไม่ใช่ gate logic**

**ผลกระทบ (ตอนนั้น)**: revert proof ตามความหมายจริง ยังพิสูจน์ไม่ได้ เพราะเคส 1 ไม่เคยผ่านเลยสักครั้ง
ด้วยเหตุผลที่ไม่เกี่ยวกับ gate logic — ต้องแก้บั๊ก body-double-read ในไฟล์ test ก่อน แล้ว verify ใหม่

### A2 (v3) — revert proof รอบสุดท้าย บน commit `9cab55c` (หลังแก้บั๊ก body-double-read): **ผ่าน**

ใช้ worktree recipe เดิม (`../wt-submit-gate-v3`, `--detach 9cab55c`, copy `.env`, junction
`node_modules`) เพดานการรัน 2 ครั้ง (unmodified + reverted) ตามที่สั่ง ไม่รัน gate รอบนี้

**RUN 1 — โค้ดจริง ไม่ revert**:
```
ok 1 - revision_round=2 with round=1 assets passes submit gate (active batch semantics)
ok 2 - no assets at all -> 409 deliverables gate
ok 3 - no assets with image_reset_required=1 -> 409 deliverables gate (not reset gate)
```
ทั้ง 3 เคสผ่าน — บั๊ก body-double-read หายแล้วจริง

**RUN 2 — revert `server/index.mjs:11354-11361` กลับเป็น `listAssignmentRoundAssetsByType` เดิม**:
```
not ok 1 - revision_round=2 with round=1 assets passes submit gate (active batch semantics)
ok 2 - no assets at all -> 409 deliverables gate
ok 3 - no assets with image_reset_required=1 -> 409 deliverables gate (not reset gate)
```
เคส 1 error block:
```
expected 201 but got 409: {"error":"บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"}

409 !== 201

AssertionError [ERR_ASSERTION]
  expected: 201
  actual: 409
  operator: 'strictEqual'
  file:///D:/UbonRuntime/repos/wt-submit-gate-v3/collector/tests/submit-gate-active-batch.test.mjs:166:14
```
เคส 1 fail ด้วย **`assert.strictEqual` จริง** (409 แทน 201) ไม่ใช่ crash เคส 2/3 ยัง pass — ตรงตาม
ที่ revert proof ควรแสดงผลทุกประการ

**Restore + hash**: `git checkout -- collector/server/index.mjs` แล้ว
`git rev-parse HEAD:collector/server/index.mjs` = `c9ec9be0bf740453a97d2361967aad357314af10` ตรงกับ
ต้นฉบับ — **ยืนยัน byte-exact restore** `git diff --stat` สะอาด cleanup worktree เรียบร้อย branch ref
`fix/submit-gate-active-batch` ยังอยู่ที่ `9cab55c` ไม่ถูกแตะ

**สรุป A2 (final)**: **revert proof ผ่านสมบูรณ์** — พิสูจน์แล้วด้วยการรันจริงว่า:
1. Fix ทำงานถูกต้องบนโค้ดจริง (เคส 1 pass)
2. ถ้าไม่มี fix (revert กลับไปใช้ `listAssignmentRoundAssetsByType` เดิม) เคส 1 จะ fail จริงด้วย 409
   (พิสูจน์ว่า fix นี้จำเป็นจริง ไม่ใช่ test ที่ผ่านได้แม้ไม่มี fix)
3. เคส 2/3 ไม่ถูกกระทบจาก revert (ตรงกับที่วิเคราะห์ไว้ตั้งแต่ต้นว่า gate เก่า/ใหม่ให้ผลเหมือนกันเมื่อ
   ไม่มี asset เลย)

**ผลข้างเคียงที่สังเกตได้ (ดีกว่าที่คาด)**: assertion เคส 1 ถูกเปลี่ยนจาก `response.status === 200 ||
response.status === 201` (หลวม, ตามที่ A4 เคย flag) เป็น `assert.strictEqual(status, 201)` แล้ว —
**A4 ถูกแก้ไปด้วยระหว่างที่แก้บั๊ก body-double-read** ไม่ต้องแก้เพิ่ม
เคส 3 ถูกเปลี่ยนชื่อเป็น "...(not reset gate)" — ยอมรับว่าไม่ได้ทดสอบ reset gate จริง (ตรงกับ A5) แต่
**ยังไม่ได้เพิ่ม test case ที่ทดสอบ reset-per-shot requirement จริง** — B3 ยังเปิดอยู่ ไม่ใช่ blocker
แต่ยังเป็นช่องว่างของ coverage

ตาม STOP RULE ของรอบนี้ (2 การรัน unmodified+reverted ครบแล้ว, ไม่รัน gate) — **หยุดตรงนี้**

### A3 — fixture ตรงกับสภาพจริงของ assignment #29 (item 39) หรือไม่: **ไม่ตรง บางส่วน**

จาก `audit/item39-review-page-audit.md:9-22` (อ่านจาก DB จริงตอนพบบั๊ก):
- `content_assignments.state = "revision_requested"` (ไม่ใช่ `"assigned"`)
- `revision_round = 2`
- `internal_note = "reopened by backward workflow transition: ready_for_writer -> field_review"` —
  ถึง field_review ผ่าน **backward transition** ไม่ใช่เดินหน้า forward ladder
- `content_assets`: 7 แถว (photo 5 + video 2) ที่ `assignment_round=1` ทั้งหมด, ไม่มีที่ round=2

fixture ของเคส 1 (`submit-gate-active-batch.test.mjs:128-172`):
- `advancePlaceProductionState(ctx.repo, itemId, "field_review")` (บรรทัด 132) — เดิน **forward
  ladder** (`collected → analyzed → generated → ready_for_content → field_working → field_review`,
  `collector/tests/test-helpers/fixture-ladder.mjs:1-8`) ซึ่ง**ไม่มี** `ready_for_writer` เป็น key
  ในลัดเดอร์นี้เลย — helper นี้จำลอง backward-reopen path ของจริงไม่ได้โดยโครงสร้าง
- `assignment.state: "assigned"` (บรรทัด 136) vs ของจริง `"revision_requested"` — **ต่างกันจริง
  และมีผล**: ถ้าใช้ state จริง (`revision_requested`) พร้อม `action: "submit"` (ตามที่ test ส่งจริง)
  จะโดน 409 ที่ `index.mjs:11344-11346` (`normalizedSubmissionState==="submitted"` แต่
  `assignmentState==="revision_requested"`) **ก่อนถึง gate ที่ fix แก้เลย** — การเลือก
  `state: "assigned"` ของผู้เขียน test คือสิ่งที่ทำให้ทดสอบไปถึง code ที่ fix แก้ได้ แต่แปลว่า
  **combination จริงที่ทำให้เกิดบั๊ก (`revision_requested` + `action: resubmit`) ไม่เคยถูกทดสอบเลย**
  ในไฟล์นี้ (แม้ gate logic เองจะไม่แยกพฤติกรรมระหว่าง submit/resubmit ก็ตาม)
- asset 3 ชิ้น (2 image, 1 video) ที่ round=1 vs ของจริง 7 ชิ้น — จำนวนต่างแต่โครงสร้าง (round-1
  asset ใต้ revision_round=2) ตรงกัน ไม่กระทบผลลัพธ์ gate

### A4 — assertion "200 || 201" หลวมไปไหม: **ใช่ หลวมจริง**

`server/index.mjs:11442` คือจุดเดียวที่ตอบ success ทั้ง handler:
`res.status(201).json({ ok: true, submission });` — **ไม่มี branch ไหนตอบ 200 เลย** ตรวจอ่านทั้ง
handler (11299-11448) แล้ว route นี้ตอบ **201 เสมอ** เมื่อสำเร็จ
Assertion ที่ `submit-gate-active-batch.test.mjs:165`
(`response.status === 200 || response.status === 201`) จึงหลวมเกินจำเป็น — ถ้ามี regression ที่
เปลี่ยน 201 เป็นเลข 2xx อื่น (รวม 200) test นี้จะไม่จับ ควรแก้เป็น `assert.equal(response.status, 201)`

### A5 — เคส 3 ได้ 409 จาก deliverables gate จริงหรือไม่: **ใช่ ยืนยันด้วยการไล่โค้ดทีละบรรทัด**

fixture เคส 3: `state="assigned"`, `image_reset_required=1` (ผ่าน
`updateAssignmentMediaResetPolicy`, `submit-gate-active-batch.test.mjs:223`), ไม่มี content_assets
เลย ไล่ path จริง:
1. `11305-11309` พบ assignment
2. `11311-11319` role=owner ผ่านหมด (`hasAssignmentSubmissionAccess`, `index.mjs:2700` return true
   ทันทีถ้า role owner)
3. `11329-11346` state="assigned" ไม่ตรงเงื่อนไข revision_requested ใดๆ ผ่าน
4. `11354-11363`: `countActiveAssignmentWorkAssetsByType` คืน `{image:0, video:0}` (ไม่มี asset เลย)
   → `activeDeliverablesCount=0 < 1` → **`res.status(409)` ที่บรรทัด 11359-11363 พร้อม return ทันที**
5. ไม่มีทางไปถึง `enforceAssignmentSubmissionRequiredFields` (11371) หรือ
   `enforceResetPerShotRequirements` (11372) เพราะ `return` ตัดไปแล้วที่ข้อ 4

ยืนยันด้วย error message ก็ตรง (`"บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"` ตรงกับ
gate message ที่ 11360-11362 ไม่ใช่ message ของ `enforceAssignmentSubmissionRequiredFields`
ซึ่งเป็นคนละข้อความและคนละ status code (400) — ไม่มีทางสับสนกัน)

**พบเพิ่ม (สำคัญสำหรับคนแก้ test ต่อ)**: `image_reset_required=1` ในเคส 3 **ไม่มีผลอะไรเลย** ต่อผลลัพธ์
409 ที่ได้ — 409 มาจากการไม่มี asset ล้วนๆ (กลไกเดียวกับเคส 2 เป๊ะ) เพราะ `return` ตัดก่อนถึงจุดที่
reset flag ถูกอ่าน (บรรทัด 11365 ไม่มีทางถูกรัน) ชื่อเคส 3 ("image_reset_required=1 with no assets")
สื่อว่า reset flag มีผล แต่จริงๆ ไม่มี — เคส 3 **ไม่ได้เพิ่ม coverage อะไรเหนือเคส 2** ตรงกับช่องโหว่ B3
ที่เคย flag ไว้ใน `audit/item39-bug1-bug3-diff-audit.md:188-191` ("ไม่มี test case สำหรับสถานการณ์
image_reset_required=1 ที่มีผลจริงต่อ gate") — **ยังเปิดอยู่ ไม่ถูกปิดโดย test ใหม่นี้**

---

## B. fix/backward-reload-deliverables-bundle (bafdb46)

### สถานะจริง: **merge ไปแล้ว** ไม่ใช่ branch รอ merge

ตรวจสอบด้วยวิธีที่ถูกต้อง (ไม่ใช่ `git diff main...branch --stat` ซึ่งไม่นิ่งเมื่อ main เดินหน้าต่อ):
```
git merge-base --is-ancestor fix/backward-reload-deliverables-bundle main
```
**exit 0** = เป็น ancestor ของ main จริง ยืนยันด้วย
`git merge-base main fix/backward-reload-deliverables-bundle` = `bafdb46...` ตรงกับ tip ของ branch
เป๊ะ (คือ merge ไปแล้วที่ commit `8c329ad` "Merge fix/backward-reload-deliverables-bundle into main")

**หมายเหตุกับดักที่เจอ**: `git diff main fix/backward-reload-deliverables-bundle --stat` (ไม่ใช้
`...`) ตอนนี้ไม่ว่างเปล่า (โชว์ `scripts/gate.mjs`/`scripts/testAll.mjs` เปลี่ยน) — **ไม่ใช่หลักฐานว่า
ยังไม่ merge** สาเหตุคือ main มี commit ทีหลัง (`216ca12` "fix: gate reads summary from file...")
แก้ไฟล์เดียวกันนี้ต่อ **หลัง** จุด merge — เป็นการเดินหน้าปกติของ main ไม่ใช่ของค้าง

### B1 (rebase) / B2 (verdict ยังใช้ได้ไหม): **ตกไปเอง — ไม่มีอะไรให้ rebase**

เพราะ branch มีอยู่ใน main แล้วทั้งหมด (0 commit unique) คำถาม "rebase สะอาดไหม" ไม่มีความหมายอีกต่อไป
verdict "mergeable" จากรอบก่อนใช้ได้แน่นอนเพราะ merge ไปแล้วจริง

**ปัญหาปฏิบัติการที่เจอระหว่างพยายาม verify (ไม่กระทบ verdict)**: agent ที่รับงาน rebase-check เจอ
`git checkout`/`git switch` ถูก permission classifier บล็อก และพบ worktree เก่าที่มีอยู่แล้ว
(`.claude/worktrees/agent-a82263fdc01b870c5`) ผูกกับ branch นี้อยู่ก่อน ทำให้สร้าง worktree ใหม่ชื่อ
branch เดียวกันไม่ได้ — **ไม่ได้ลบหรือแตะ worktree นั้น** ตามกฎ (ไม่ใช้ destructive action โดยไม่ถาม)
แจ้ง Sor ให้เช็คว่า worktree นี้เป็นของ session ใครและควร cleanup เองหรือไม่

---

## C. เลข gate 2 ตัว

| branch | ผล | baseline main |
|---|---|---|
| fix/submit-gate-active-batch — **v2, worktree ตั้งค่าครบ (`.env` copy + `node_modules` junction + นอก OS temp + `--detach`)** | **TOTAL 1016 / PASS 949 / FAIL 66** | tests=1013 pass=947 fail=65 skipped=1 |
| fix/backward-reload-deliverables-bundle (ยังเป็นเลขรอบก่อน ไม่ได้วัดซ้ำในรอบ v2 นี้ — งานรอบนี้สั่งเฉพาะ branch A) | TOTAL 1013 / PASS 919 / FAIL 93 / SKIPPED 1 (ผ่าน `testAll.mjs` ตรง เพราะ `npm run gate` เองพังในนั้น — ดู caveat เดิมเรื่อง gate script เก่ากว่า main) | เดียวกัน |

**Branch A (v2, เชื่อถือได้แล้ว)**: fail เพิ่มจาก baseline สุทธิ **+1 ตัวเท่านั้น** และตรงกับชื่อ
`revision_round=2 with round=1 assets passes submit gate (active batch semantics)` เป๊ะ — คือเคส 1
ของ test ใหม่ที่พังเพราะบั๊ก body-double-read (อธิบายใน A2) **ไม่มี fail อื่นที่ไม่รู้จักเพิ่มมา** ตัวเลข
1016 (รวม) vs baseline 1013 ต่างกัน 3 ข้อ ตรงกับ 3 test case ใหม่ในไฟล์นี้พอดี (`+3 total, +1 fail,
+2 pass` สอดคล้องกับ 246 บรรทัดใหม่ที่มี 3 cases) ยืนยันว่าตัวเลขชุดนี้สะอาด ไม่มี noise จาก
environment เหมือนรอบก่อนแล้ว

**Branch B**: ยังไม่ได้วัดซ้ำในรอบ v2 (คำสั่งรอบนี้ระบุเฉพาะ branch A) เลข 93 จากรอบก่อนยังมี caveat
เดิม (environment + gate-script-version) ค้างอยู่ — ถ้าต้องการเลขที่เชื่อถือได้ของ branch B ต้องวัดซ้ำ
ด้วยวิธี v2 เช่นกัน (แต่เนื่องจาก branch B merge ไปแล้วจริง เลขนี้ไม่ใช่ blocker ต่อการ merge อีกต่อไป
— ข้าม ไม่จำเป็นต้องวัดซ้ำ เว้นแต่ต้องการ sanity-check main ปัจจุบันเอง)

`npm run gate` เองก็พังใน worktree ของ branch B ด้วยข้อความ
`GATE: could not parse summary line from test output` (fail 2 ครั้งติด ตาม stop rule agent จึงหยุด
แล้วรัน `node scripts/testAll.mjs` ตรงแทนเพื่อได้ตัวเลขดิบมา) — สาเหตุที่พบคือ branch B
(`bafdb46`) เป็น**ancestor ของ main ที่เก่ากว่า** commit `216ca12` ("fix: gate reads summary from
file แทนการ parse pipe output") การรัน `npm run gate` บน snapshot ของ `bafdb46` เองจึงเจอ
gate script เวอร์ชันก่อนแก้ ซึ่งเป็นพฤติกรรมที่คาดหมายได้ ไม่ใช่บั๊กใหม่ — แต่ก็แปลว่า **เลข gate
ของ branch B ในตารางนี้ไม่ได้วัดผ่าน gate script จริงที่ user อ้างถึง** ("gate ใช้ได้แล้ว") เพราะ
branch B เองไม่มี fix นั้นอยู่ (main มีแล้วเพราะ merge ทีหลัง)

**คำแนะนำ**: เลข gate ที่เชื่อถือได้จริงสำหรับเปรียบเทียบ ต้องรันจาก working copy ที่มี `.env` จริง
(เช่น copy `collector/.env` เข้า worktree ก่อนรัน หรือรันจาก branch ที่ checkout ทับ Runtime
โดยตรงแทน worktree แยก) — ไม่ควรใช้ตัวเลข 96/93 ข้างต้นเป็นเหตุผล block หรือ approve การ merge

---

## รายการ blocker/สิ่งที่ต้องทำก่อน merge (อัปเดตหลัง v3 — final)

1. **A2 — ✅ ปิดแล้ว**: revert proof ผ่านสมบูรณ์บน `9cab55c` (RUN 1/RUN 2 ด้านบน) fix ทำงานถูกต้อง
   จริงตามที่ตั้งใจ ไม่มี blocker เหลือจากข้อนี้แล้ว
2. **A3 (ยังไม่แก้ — finding รอง ไม่ block merge)**: fixture เคส 1 ใช้ `state: "assigned"` ไม่ใช่
   `"revision_requested"` ของจริง — ควรเพิ่มเคสที่ทดสอบ combination จริง (`revision_requested` +
   `action: resubmit`) เพื่อคุม scenario ที่ทำให้เกิดบั๊กจริงบน assignment #29 แนะนำให้ทำเป็น
   follow-up แยก ไม่จำเป็นต้อง block merge รอบนี้เพราะ gate logic เองไม่แยกพฤติกรรม submit/resubmit
3. **A4 — ✅ แก้แล้วโดยผลข้างเคียง**: assertion เคส 1 เปลี่ยนเป็น `assert.strictEqual(status, 201)`
   แล้วระหว่างแก้บั๊ก body-double-read ไม่ต้องทำอะไรเพิ่ม
4. **A5/B3 (ยังไม่แก้เต็ม — finding รอง ไม่ block merge)**: เคส 3 เปลี่ยนชื่อเป็น "...(not reset
   gate)" แล้ว (ยอมรับว่าไม่ได้ทดสอบ reset gate) แต่ยังไม่มี test case ที่ทดสอบ
   `image_reset_required=1` ร่วมกับ asset ที่ผ่าน deliverables gate จริงเพื่อดูว่า
   reset-per-shot requirement บล็อกตามที่ตั้งใจหรือไม่ — แนะนำ follow-up แยกเช่นกัน
5. **Branch B**: ไม่มี blocker — merge ไปแล้ว ปิดเรื่องนี้ได้

## Verdict สุดท้าย

**fix/submit-gate-active-batch (9cab55c): merge ได้** — blocker หลัก (A2 revert proof) ปิดแล้วด้วย
หลักฐานรันจริง 2 รอบ (unmodified pass, reverted fail-with-real-assertion) เหลือ A3/A5 เป็น
test-coverage gap ระดับ "ควรทำต่อ" ไม่ใช่ "ต้องทำก่อน merge" แนะนำให้ Sor ตัดสินใจว่าจะ merge เลย
แล้วเปิด follow-up ticket สำหรับ A3/A5 หรือจะรอแก้ก่อน — ไม่มีข้อมูลทางเทคนิคที่บังคับให้ต้องรอ
เลข gate ที่แท้จริงบน `9cab55c` ยังไม่ได้วัด (ตามคำสั่งไม่ให้รันรอบนี้) คาดว่าจะกลับมาที่ baseline
65 fail พอดี แต่ควรวัดจริงอีกครั้งเมื่อสะดวก (ไม่ใช่เงื่อนไข block)

**fix/backward-reload-deliverables-bundle (bafdb46): merge ไปแล้ว** ไม่มีอะไรต้องทำต่อ

## บันทึกเพิ่มสำหรับรอบตรวจถัดไป

เมื่อแก้บั๊ก body-double-read แล้ว การ verify รอบถัดไปสามารถใช้ recipe ของ v2 ได้เลย (ไม่ต้องคิดใหม่):
worktree นอก OS temp dir + copy `collector/.env` + junction `node_modules` (`collector/` และ
`backend/`) + `git worktree add <path> --detach <commit>` แทนการ checkout branch — วิธีนี้ทำให้
server บูตขึ้นจริงและเลข gate สะอาด (ตรวจสอบแล้วว่า +3 total ตรงกับ 3 test case ใหม่พอดี ไม่มี
environment noise) ใช้เพดาน 3 การรัน (boot proof + revert proof + gate) ตามเดิมได้
