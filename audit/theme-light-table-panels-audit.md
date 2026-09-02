# Audit — ธีม light ไม่ทำงานใน tab=raw / tab=handoff

MACHINE: Runtime — D:\UbonRuntime\repos\UbonCity_Web
MODE: READ-ONLY (ไม่แก้โค้ด / ไม่ commit / ไม่ merge)
Pipeline: audit-scanner (Layer 1) → audit-deep-reasoner (Layer 2)
Baseline: internal consistency + DOM-split exception branch `fix/pipeline-round-15aug` (commit `a52a9bc`)

อาการ (verify ผ่าน browser จริง — collector-test.uboncity.com):
- tab=work สลับ light ได้ปกติ
- tab=raw: ตาราง Raw Intake / Clean Prep / Field Pack Review + ถัง ⚠ ค้าง dark
- tab=handoff: กล่อง "เลือกงานที่พร้อมส่งไปทำ" ค้าง dark

---

## Q1 — กลไกสลับธีม

- ใช้ **data-attribute บน root**: `document.documentElement.setAttribute('data-theme', mode)` — `collector/server/public/theme-bootstrap.js:29`
- toggle/สลับค่า + sync checkbox — `collector/server/public/theme-control.js:87` (checkbox id = `"input"`, inject ลง `document.body` — `theme-control.js:7`)
- ค่าที่เป็นไปได้: `"light"` / `"dark"` / `"system"` (`system` → อ่าน `prefers-color-scheme`)
- ชุด token จริงที่ใช้: CSS custom properties กลุ่ม `--theme-*`
  - `--theme-surface: #ffffff` (light) — `styles.css:4`
  - `--card: var(--theme-surface)` — `styles.css:18`
  - dark override: `:root[data-theme="dark"]` block — `styles.css:1217` (และ block ซ้อนที่ `styles.css:8233`)
- selector guard 3 แบบในไฟล์: `:root[data-theme="dark"]`, `:root:not([data-theme="dark"])`, `@media (prefers-color-scheme: dark)`

---

## Q2 — เทียบ markup ตารางที่ทำงาน vs ไม่ทำงาน

| panel | render fn | wrapper / container | ไฟล์:บรรทัด |
|---|---|---|---|
| tab=work (ทำงาน) | `renderAssignmentsTable()` | `#table-assignments-work` ใน `#assignment-list-panel-work`, อยู่ใต้ `#panel-assignments.as-scope` | `app.js:9034` (fn), `app.js:4529` (เติม `.as-scope`), `app.js:4534` (เติม `as-list-panel`) |
| tab=handoff (ค้าง dark) | `renderAssignmentsTable()` | `#table-assignments-handoff` ใน **`#assignment-list-panel-handoff`** (class `secondary-panel as-list-panel`) ใต้ `#panel-assignments.as-scope` | `app.js:9036`, `app.js:9039`; `<h3>` = "…ขั้น 1: เลือกงานที่พร้อมส่งไปทำ" set ที่ `app.js:9054`; element = `index.html:348-349` |
| tab=raw — Raw Intake / Clean Prep / Field Pack Review | `renderRawTable()` → เติมด้วย `renderRawQueueTable()` | `<div class="card">` ใน `<div class="table-wrap">` ใน `#raw-table-wrap` ใน **`#panel-raw`** | `app.js:5690` / `app.js:5716`,`5728`,`5739`,`5752` (card), `app.js:5209` (queue table), `index.html:330` (`#panel-raw`) |
| tab=raw — ถัง ⚠ anomaly | `renderRawTable()` → `#table-raw-workflow-unknown` | เหมือนข้างบน (`<div class="card">`) | `app.js:5752` |

**ความต่างสำคัญ:**
- tab=work และ tab=handoff อยู่ **ใต้ `#panel-assignments.as-scope`** → โดน rule ตระกูล `#panel-assignments.as-scope …` ทั้งชุด
- tab=raw อยู่ใน `#panel-raw` ซึ่งเป็น **sibling ระดับบนของ `#panel-assignments`** สลับด้วย `.app-shell.*-mode` display (`styles.css:9574-9582`) — **ไม่เคยได้รับ class `.as-scope`** (มีแต่ `#panel-assignments` เท่านั้น — `app.js:4529`)
- ต่างจาก work: handoff ใช้ container `#assignment-list-panel-handoff` (id เฉพาะ) ที่มี rule dark เจาะจง id นี้

---

## Q3 — CSS rule ที่ทำให้ค้าง dark

### กล่อง handoff — ยืนยันเป็นบั๊ก (Issue 1)

selector-list ตระกูล "dark assignments refinement" ถูก copy-paste ~11 ครั้ง ทุกครั้ง member `#panel-assignments.as-scope #assignment-list-panel-handoff` **ไม่มี prefix `:root[data-theme="dark"]`** ทั้งที่ member อื่นในกลุ่มเดียวกันมี → match ใน light ด้วย และเป็น `!important`

| ไฟล์:บรรทัด (member) | block | ค่าที่ hardcode |
|---|---|---|
| `styles.css:7522-7523` | 7518-7532 | `background:#0f172a !important; border-color:#334155 !important` |
| `styles.css:7686-7687` | 7685-7691 | `background:#0f172a !important; border-color:#334155 !important` |
| `styles.css:8259-8260` | 8258-8271 | `background:#111827 !important` |
| `styles.css:8328-8329` | 8326-8334 | `background:linear-gradient(180deg,#111827 0%,#0f172a 100%) !important` |
| `styles.css:9397-9398` | 9396-9401 | `background:color-mix(in srgb,#111827 92%,#0f172a 8%) !important` ← **ตัวสุดท้ายใน source order = ตัวที่ทาสีจริง** |
| `styles.css:7157`, `7192`, `8402`, `8557`, `9164`, `9308` | — | props อื่น (padding/border/box-shadow / `var(--as-layer-card)` ที่ไม่ได้นิยามใน light → no-op) — ไม่ทาสีพื้น แต่ทำ metric เพี้ยน |

- rule light ที่ตั้งใจให้ถูก: `styles.css:8642-8648` → `background: var(--as-light-card)` (`#ffffff`), member ที่ `styles.css:8643` ก็ **ไม่มี prefix** เช่นกัน; specificity เท่ากัน `(0,2,1)` แต่แพ้ `9400` เพราะมาก่อนใน source order
- `#assignment-list-panel-review` และ `#assignment-detail-panel-handoff` อยู่ใน block เดียวกันเป๊ะ แต่ **มี guard ครบ** → สลับธีมถูก (ตรงกับอาการที่ค้างเฉพาะกล่อง handoff)

### ตาราง tab=raw — ไม่พบสาเหตุฝั่ง CSS (ดู Q ท้าย)

- ไล่ทั้งไฟล์: **ไม่มี** declaration `background` สี dark ที่ไม่มี guard ซึ่ง match `#panel-raw` หรือลูกได้เลย
- chain: `.card { background: var(--card) }` (`styles.css:1447`) → `--card: var(--theme-surface)` (`styles.css:18`) → `#ffffff` (`styles.css:4`)
- `#panel-raw table/th/td` (`styles.css:10411-10433`, `9623-9650`) ใช้แต่ `var(--card)` / `var(--theme-surface-soft)` / `color-mix` ของ token
- rule `#panel-assignments.as-scope …` (รวม stray rule ของ Issue 1) match `#panel-raw` ไม่ได้ เพราะ `#panel-raw` ไม่เคยมี `.as-scope`

---

## Q4 — class/selector มีปัญหาถูกใช้ที่อื่นไหม (blast radius)

- selector ที่พังคือ **`#panel-assignments.as-scope #assignment-list-panel-handoff`** — เจาะจง id `#assignment-list-panel-handoff` ตัวเดียว
  - `#assignment-list-panel-handoff` ใช้ที่: `index.html:348-349` (นิยาม), `app.js:9036`,`9039` (render เข้า table), `app.js:4534` (เติม class)
  - **ไม่ถูกใช้ในหน้าอื่น** — เป็น container เฉพาะ tab=handoff ของ Assignment Work
- id พี่น้องในกลุ่ม comma เดียวกัน (จะโดนด้วยถ้าแก้ทั้ง group แบบเหมารวม): `#assignment-list-panel-review`, `#assignment-detail-panel-handoff`, `#assignment-detail-panel-review`, `#assignment-detail-panel-work` — ปัจจุบัน theme ถูกอยู่แล้ว → การแก้ต้องแตะเฉพาะ member `#assignment-list-panel-handoff` ไม่ใช่ทั้ง group
- class `.as-scope` เติมโดย `app.js:4529` ให้ `#panel-assignments` เท่านั้น — Assignment Work flow (work/handoff/review) ทั้งหมดอยู่ใต้ scope นี้; อยู่ในขอบเขต contract "Assignment Work behavior" ของ CLAUDE.md
- `.secondary-panel` / `.as-list-panel` เป็น class ทั่วไป ใช้หลายที่ — แต่ **ไม่ใช่** ตัวที่ตั้งสี (สีมาจาก selector ที่ผูก id) จึงไม่ใช่จุดแก้

---

## Q5 — มี class/rule ที่ theme ถูกอยู่แล้ว ใช้แทนได้ไหม

- **มี** — pattern ที่ถูกอยู่แล้วในไฟล์เดียวกัน คือ member `#panel-assignments.as-scope #assignment-list-panel-review` (และ `#assignment-detail-panel-*`) ในทุก block ที่กล่าวถึง — มันมี `:root[data-theme="dark"]` prefix ครบ จึงสลับธีมถูก
- rule light ที่ตั้งใจไว้แล้วสำหรับ handoff: `styles.css:8642-8648` (`--as-light-card` / `#ffffff`) — มีอยู่แล้ว เพียงแต่ตอนนี้ถูก override
- ไม่ต้องสร้าง class ใหม่: จุดที่ผิดคือ "member หนึ่งใน selector-list ลืม prefix" — เทียบกับ member `#assignment-list-panel-review` ในบรรทัดถัดกันที่ทำถูก
- token ที่ควรพึ่ง: `var(--card)` / `var(--theme-surface)` / `var(--as-light-card)` — เป็นชุดที่ `renderRawTable` และ tab=work ใช้และสลับได้

---

## Root cause (สรุป)

1. **กล่อง handoff "เลือกงานที่พร้อมส่งไปทำ" (`#assignment-list-panel-handoff`)** — ยืนยัน: regression จาก DOM-split (`a52a9bc`). ตอน re-template block "dark refinement" ให้ id ใหม่ มี ~5 block ที่ set `background` dark โดย member `#panel-assignments.as-scope #assignment-list-panel-handoff` **ไม่มี `:root[data-theme="dark"]` prefix** → ทาสี dark ทั้งสองธีมด้วย `!important`. ตัวที่ชนะจริงคือ `styles.css:9396-9401` (`color-mix(... #111827 ...)`). member `#assignment-list-panel-review` ใน block เดียวกันทำถูก. **confidence: high**

2. **ตาราง tab=raw (Raw Intake / Clean Prep / Field Pack Review / ถัง ⚠)** — static analysis **ไม่พบสาเหตุฝั่ง CSS**. `#panel-raw` ไม่เคยมี `.as-scope`, chain ของ `var(--card)` ชี้ `#ffffff` ใน light, ไม่มี dark hex ที่ไม่มี guard ที่ match ได้. **ยังไม่ยืนยันว่าเป็นบั๊กโค้ด** — ต้องเช็ค runtime

### Open question — ทำไม browser เห็น tab=raw เป็น dark
Layer 2 เสนอ 2 ความเป็นไปได้ (แยกไม่ได้ถ้าไม่เปิด browser):
1. ตอนดู tab=raw, `document.documentElement` **ไม่ได้เป็น `data-theme="light"` จริง** (เช่น preference = `"system"` + OS dark, หรือ toggle ใน `theme-control.js` ไม่ได้ re-apply กับ view นั้น) → tab=raw ทำงานถูก แต่ tab=work แค่ "ดูเหมือน light" เพราะ hardcoded `#ffffff` ที่ `styles.css:7469-7516` / `7558-7605`
2. `styles.css` ถูก cache (token `?v=__COLLECTOR_ASSET_VERSION__` ไม่ถูก substitute) → fix light ที่ใหม่กว่ายังไม่โหลด

ต้องเก็บก่อนสรุปข้อ 2: อ่าน `document.documentElement.getAttribute('data-theme')` + computed `background-color` ของ raw `.card` ขณะเห็นอาการ, และเช็คว่า `styles.css` ถูก serve พร้อม version string จริง

---

## Adjacent (นอกขอบเขต — ไว้ทีหลัง)

- `theme-control.js:7` — `CHECKBOX_ID = "input"` เป็น id ที่ชนง่ายมากที่ inject ลง `document.body`
- stray-unprefixed member pattern ของ `#assignment-list-panel-handoff` เกิดซ้ำ ~11 จุด (`styles.css` 7157, 7192, 7522, 7686, 8259, 8328, 8402, 8557, 9164, 9308, 9397) — แม้แก้ตัวที่ set background แล้ว ตัว padding/border/box-shadow ยังทำ metric dark-mode ของกล่อง handoff ต่างจาก review
- `styles.css:8642-8643` — rule light `:root:not([data-theme="dark"])` ก็มี member handoff ไม่ prefix → `var(--as-light-card)` รั่วเข้า dark mode (ตอนนี้ถูกกลบด้วย dark rule ทีหลัง)
- `styles.css:6669-6672` — `.as-scope { --card: … }` ไม่มี guard (ทั้งสองธีม) — ตอนนี้ไม่มีพิษเพราะค่า white-biased ใน light แต่รูปแบบเปราะเดียวกัน
