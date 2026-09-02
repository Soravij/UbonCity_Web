# Audit — diff verification: `fix/has-open-assignment-any-kind` (eddd23b)

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web`
- Mode: READ-ONLY. ไม่ commit / ไม่ merge / ไม่รัน gate|test:all
- Base: `main` (7012786) → branch HEAD `eddd23b17639c678e2e117c18ca036d61861d912`
- Prior audit ในบทสนทนานี้: `audit/assignment-open-selection-audit.md` (Bug B)
- Sub agents: ไม่เรียก audit-scanner/deep-reasoner — diff เล็ก 3 ไฟล์ / logic 2 บรรทัด ไล่ได้เต็มด้วยตัวเอง + รันเทสจริง + query DB จริง
- เทสรันจาก **repo root** (`node --test collector/tests/<file>`); บางไฟล์ path-sensitive กับ cwd

---

## A1 — diff แตะกี่ไฟล์ / scope creep

`git diff main..eddd23b --stat` → **3 ไฟล์ 42 บรรทัด**:

| ไฟล์ | +/- | เนื้อหา |
|------|-----|---------|
| `collector/server/index.mjs` | +2 −2 | บรรทัด **39** (import เพิ่ม `hasAnyOpenAssignment`), บรรทัด **4016** (`hasOpenAssignment(primaryAssignment)` → `hasAnyOpenAssignment(listAssignments)`) |
| `collector/services/publishable-assignment-candidate.mjs` | +5 −0 | ฟังก์ชันใหม่ `hasAnyOpenAssignment` (บรรทัด 72‑76) |
| `collector/tests/open-assignment-any-kind.test.mjs` | +35 (ไฟล์ใหม่) | 4 unit tests |

- **index.mjs: มีแค่ 2 บรรทัดตามที่สั่ง** (import + `:4016`). ตรง.
- ไม่แตะ `repository.mjs`, `app.js`, `styles.css`, endpoint ใด ๆ, payload shape — **ไม่มี scope creep**
- ไม่ลบ/แก้เทสเดิม (แต่ทำเทสเดิมพัง — ดู A5)
- `node --check` ผ่านทั้ง `index.mjs` และ `publishable-assignment-candidate.mjs` (รันตอนเทส import ได้)

---

## A2 — `hasAnyOpenAssignment` ถูกต้องไหม (candidate.mjs:72‑76)

```js
export function hasAnyOpenAssignment(assignments) {          // :73
  if (!Array.isArray(assignments)) return false;             // :74
  return assignments.some((assignment) => hasOpenAssignment(assignment));  // :75
}
```

- **ใช้ `hasOpenAssignment` เดิมต่อจริง** (`candidate.mjs:75` เรียก `candidate.mjs:68`) — **ไม่มีการเขียน state set ใหม่ซ้อน**
- `OPEN_ASSIGNMENT_STATES` ยังมีชุดเดียว (`candidate.mjs:64‑66`)
- guard `!Array.isArray` (`:74`) — ปลอดภัยกับ input ที่ไม่ใช่ array (เดิม `hasOpenAssignment(primaryAssignment)` พึ่ง `?.` กับ null)
- ⚠️ ข้อสังเกต: `hasOpenAssignment` อ่าน `assignment?.state || assignment?.assignment_state` (`:69`). เทสใหม่ป้อน key `assignment_state` ทั้งหมด (`open-assignment-any-kind.test.mjs:12,20,28`) แต่ row จริงจาก `repo.listAssignmentsByItem` ใช้ column `state` — เทสจึงทดสอบ field ที่ production ไม่ใช้

**สรุป A2: ฟังก์ชันเขียนถูก reuse ถูก** แต่ดู A4 — มันไม่ได้เปลี่ยนพฤติกรรมของ flag ที่ call site

---

## A3 — caller เดิมของ `hasOpenAssignment` ยังอยู่ครบไหม

grep ทั้ง repo (`collector/**/*.mjs`, ไม่รวม node_modules):

| ตำแหน่ง | เดิม | หลัง diff |
|---------|------|-----------|
| `index.mjs:39` | `import { hasOpenAssignment }` | `import { hasOpenAssignment, hasAnyOpenAssignment }` |
| **`index.mjs:4016`** | `hasOpenAssignment(primaryAssignment)` | `hasAnyOpenAssignment(listAssignments)` ← **จุดเดียวที่เปลี่ยน logic** |
| `index.mjs:1403`, `:4038` | `resolvedScope?.hasOpenAssignment` (อ่าน property ของ object ไม่ใช่เรียกฟังก์ชัน) | ไม่เปลี่ยน |
| `app.js:716,737,755,765` | local var ชื่อ `hasOpenAssignment` (คนละตัว ไม่เกี่ยวกับ import) | ไม่เปลี่ยน |
| `candidate.mjs:68` | นิยาม `hasOpenAssignment` | ไม่เปลี่ยน |
| `candidate.mjs:75` | — | ผู้เรียกใหม่ (ภายใน `hasAnyOpenAssignment`) |
| `repository.mjs:7‑11` | import จาก module เดียวกันแต่เอา `getPublishableAssignmentStateRank`, `isSelectedAssignmentAccepted`, `selectBestPublishableAssignmentCandidate` — **ไม่ได้ import `hasOpenAssignment`** | ไม่เปลี่ยน |
| tests: `resolve-item-scope-primary-assignment.test.mjs:30`, `assignment-state-reader.test.mjs:14` | import `hasOpenAssignment` | ไฟล์เทสไม่ถูกแก้ (ดู A5) |

**หลัง diff `hasOpenAssignment` (ตัวเดิม) ถูกเรียกจากที่เดียว: `candidate.mjs:75`** (ภายใน `hasAnyOpenAssignment`).
production caller เดิม (`index.mjs:4016`) ย้ายไปใช้ตัวใหม่. **ทุกจุดอื่นพฤติกรรมเดิม** ยืนยันแล้ว.

---

## A4 — revert proof (index.mjs:4016 → ของเดิม)

ขั้นตอน (working tree สะอาดก่อนเริ่ม: `git status` tracked = clean, HEAD `eddd23b`, md5(index.mjs)=`eff65607867d0bb377e1c1a08e1f0d28`):

1. Edit `index.mjs:4016` → `hasOpenAssignment: hasOpenAssignment(primaryAssignment)` (= เวอร์ชัน main; import บรรทัด 39 คงไว้ตามที่สั่ง "เฉพาะ :4016")
   - `git diff` = 1 ไฟล์ 1 บรรทัด, ตรงกับ `main` เป๊ะ
2. รันเทส:

| เทส | line 4016 = branch (`hasAnyOpen`) | line 4016 = reverted (`hasOpen(primary)`) |
|-----|----------------------------------|-------------------------------------------|
| `open-assignment-any-kind.test.mjs` | 4 pass / 0 fail | **4 pass / 0 fail** (ไม่เปลี่ยน) |
| `resolve-item-scope-primary-assignment.test.mjs` | **0 pass / 4 fail** | 4 pass / 0 fail |

3. Restore `index.mjs:4016` กลับ → `git diff` ว่าง, `git status` tracked clean, **md5 = `eff65607867d0bb377e1c1a08e1f0d28` (ตรงกับก่อนแก้)**, HEAD = `eddd23b17639c678e2e117c18ca036d61861d912`

### ผล A4 — เทสใหม่ **ล้มเหลวในการทดสอบโค้ดจริง (tautological / coverage gap)**

`open-assignment-any-kind.test.mjs:7‑8` import `hasAnyOpenAssignment` จาก `candidate.mjs` โดยตรง —
**ไม่ import / ไม่รัน `collector/server/index.mjs` เลย** ไม่มี assertion ใดแตะ call site `:4016` หรือ field
`has_open_assignment` ใน response. revert `:4016` แล้วเทสยัง 4/4 pass → เทสนี้เป็น unit test ของ helper
อย่างเดียว **ไม่ได้ยืนยันว่า `resolveItemScopeContext` เปลี่ยนไปใช้ logic ใหม่จริง**

---

## A5 — regression เฉพาะจุด (ไม่รัน gate)

เทสไฟล์ที่อ้าง `has_open_assignment` / `hasOpenAssignment` / `hasAnyOpenAssignment`:

| ไฟล์ | main | branch eddd23b | ต่างกัน? |
|------|------|----------------|----------|
| `open-assignment-any-kind.test.mjs` | ไม่มีไฟล์ | 4 pass / 0 fail | ใหม่ (n/a) |
| **`resolve-item-scope-primary-assignment.test.mjs`** | **4 pass / 0 fail** | **0 pass / 4 fail** | **ใช่ — REGRESSION** |
| `queue-bucket-follows-state.test.mjs` | 6 pass / 0 fail¹ | 6 pass / 0 fail¹ | ไม่ |
| `ready-for-writer-queue-bucket.behavior.test.mjs` | 3 pass / 0 fail | 3 pass / 0 fail | ไม่ |

¹ ต้องรันจาก repo root; รันจาก `collector/` จะ ENOENT `collector\collector\...` (บั๊ก path ในเทสเอง ไม่เกี่ยว diff)

### เทสที่พัง — `resolve-item-scope-primary-assignment.test.mjs` (ทั้ง 4 ราย)

- `resolveItemScopeContext picks open field assignment when all editorial assignments are closed` (`:65`)
- `resolveItemScopeContext picks active editorial assignment over open field assignment` (`:78`)
- `resolveItemScopeContext falls back to first assignment when all are closed` (`:90`)
- `selectPrimaryOpenAssignment picks revision_requested over accepted when editorial is accepted` (`:102`)

**สาเหตุ**: เทสอ่าน source ของ `index.mjs` จาก disk (`:10`) แล้ว extract ตัวฟังก์ชัน `resolveItemScopeContext`
เป็น text (`:58`) ไปรันใน `vm.runInNewContext` (`:61`) โดย context object (`:42‑53`) inject ให้แค่
`repo`, `console`, **`hasOpenAssignment`** — **ไม่มี `hasAnyOpenAssignment`**

diff แก้ body ของ `resolveItemScopeContext` (`index.mjs:4016`) ให้เรียก `hasAnyOpenAssignment` แต่
**ไม่ได้อัปเดต sandbox context ในเทส** (`resolve-item-scope-primary-assignment.test.mjs:52` ยัง inject
เฉพาะ `hasOpenAssignment`) → รันแล้วได้ `ReferenceError: hasAnyOpenAssignment is not defined`
(stack: `resolveItemScopeContext.js:49` — ชื่อ virtual จาก `filename` ที่ `:61`)

ขัด CLAUDE.md "Confirm the failure count didn't go up vs. before your change" — **failure count +4**

---

## DB (read-only) — ค่า flag ใหม่ vs เก่า

จำลอง logic ทั้งสองบน `collector/data/collector.db` (20 items ที่มี assignment):

- **old** = `hasOpenAssignment(activeEditorial || selectPrimaryOpenAssignment(all) || list[0])`
- **new** = `list.some(hasOpenAssignment)`

| item | assignments (kind:state#id) | old flag | new flag |
|------|------------------------------|----------|----------|
| 9  | `editorial:revision_requested#4`, `field:accepted#2` | **true** (primary=#4) | **true** |
| 27 | `editorial:assigned#9`, `field:accepted#8` | **true** (primary=#9) | **true** |
| 39 | `editorial:submitted#39`, …closed×8…, `field:accepted#29` | **true** (primary=#39) | **true** |

### จำนวน item ที่ค่าพลิก: **0 จาก 20**

ไล่ทุก item — **ไม่มี item ใดที่ old ≠ new** (รวมทั้งที่ไม่ได้ตั้งใจ)

**เหตุผลเชิงตรรกะ**: `PRIMARY_OPEN_ASSIGNMENT_STATE_PRIORITY` (`index.mjs:3972‑3979`) =
`{revision_requested,in_progress,assigned,resubmitted,submitted,accepted}` เป็น **ชุดเดียวกันเป๊ะ**
กับ `OPEN_ASSIGNMENT_STATES` (`candidate.mjs:64‑66`). ดังนั้น `selectPrimaryOpenAssignment(list)` คืน non‑null
⟺ มี assignment เปิดอย่างน้อยหนึ่งใบ ⟺ `list.some(hasOpenAssignment)` เป็น true. และเมื่อมีใบเปิด
`primaryAssignment` จะเป็น `activeEditorial` (∈ active ⊂ open) หรือ `openAssignment` (∈ open) เสมอ →
`hasOpenAssignment(primary)` = true. เมื่อไม่มีใบเปิด ทั้งสองสูตร = false.
**สองสูตรให้ผลเท่ากันทุก input** — ความต่างเดียวที่เป็นไปได้ในทางทฤษฎีคือ row ที่มี key `assignment_state`
แต่ไม่มี `state` (`selectPrimaryOpenAssignment:3985` อ่าน `.state` อย่างเดียว) ซึ่ง row จาก DB จริงไม่มีเคสนี้

### ตัวอย่าง 3 item ที่ "น่าจะพลิก" แต่ไม่พลิก

- **item 9** `analyzed` + `editorial:revision_requested#4` + `field:accepted#2` → primary เดิม = editorial #4 (เปิด) → old already true
- **item 27** `writing_assigned` + `editorial:assigned#9` + `field:accepted#8` → primary เดิม = editorial #9 (เปิด) → old already true
- **item 39** `in_review` + `editorial:submitted#39` + `field:accepted#29` → primary เดิม = editorial #39 (เปิด) → old already true

ทั้งสามคือเคสที่ prior audit (Bug B) ยกมา — แต่ทั้งสาม flag เป็น **true อยู่แล้ว**ภายใต้ logic เดิม
เพราะ editorial ที่เปิดอยู่ถูกเลือกเป็น primary. Bug B ที่แท้ (transition access เป็น editorial-only,
`index.mjs:4121‑4132`) **ไม่ได้ถูกแตะโดย diff นี้**

---

## สรุปสถานะ finding (verification mode)

| # | finding เดิม / ประเด็น | สถานะกับ diff นี้ |
|---|------------------------|-------------------|
| Bug B — `has_open_assignment` สะท้อน assignment ใบเดียว (editorial-preferred) | prior audit `assignment-open-selection-audit.md` Q1/Q5 | **ไม่แก้จริง** — old logic คืน true เมื่อมีใบเปิดใด ๆ อยู่แล้ว; DB ยืนยัน 0/20 items เปลี่ยนค่า |
| transition access เป็น editorial-only (`index.mjs:4204‑4225`, `:4121‑4132`) | prior audit Q2/Q5 | ไม่ถูกแตะ |

### ปัญหาที่ diff นี้ "สร้างใหม่" (regression, scope = ไฟล์ที่แก้ + direct caller)

1. **`resolve-item-scope-primary-assignment.test.mjs` พังทั้ง 4 ราย** — `ReferenceError: hasAnyOpenAssignment is not defined`
   ใน vm sandbox (เทส `:52` ไม่ได้ inject ฟังก์ชันใหม่). failure count +4 เทียบ main
   (`resolve-item-scope-primary-assignment.test.mjs:41‑63`)
2. **เทสใหม่ `open-assignment-any-kind.test.mjs` ไม่คุ้ม call site** — revert `index.mjs:4016` แล้วยัง pass 4/4
   (เทส `:7‑8` ไม่แตะ `index.mjs`)
3. **การเปลี่ยน `index.mjs:4016` ไม่มีผลต่อค่า flag** — `hasAnyOpenAssignment(listAssignments)` กับ
   `hasOpenAssignment(primaryAssignment)` ให้ผลเท่ากันทุก input (state priority list = OPEN_ASSIGNMENT_STATES ชุดเดียวกัน)

*(ห้ามเสนอวิธีแก้ตามที่สั่ง — ส่งข้อเท็จจริงเท่านั้น)*
