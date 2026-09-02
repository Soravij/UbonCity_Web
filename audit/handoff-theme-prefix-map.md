# Audit — styles.css: บรรทัด `#assignment-list-panel-handoff` ที่ไม่มี theme prefix ตั้งใจเป็นธีมไหน

MACHINE: Runtime — D:\UbonRuntime\repos\UbonCity_Web
BRANCH: `fix/handoff-panel-theme` @ `13e87f6` ("fix: add light theme prefix to handoff list panel selector")
MODE: READ-ONLY (ไม่แก้ / ไม่ commit / ไม่ merge)
ไฟล์: `collector/server/public/styles.css` (ตรวจ full-file, `git status` = clean, ไม่มี uncommitted diff)

เกณฑ์จัดกลุ่ม (ตามที่สั่ง):
- block set สี dark (`#0f172a` `#111827` `#334155` `rgba(148,163,184,*)` / `var(--as-dark-*)` / `var(--as-layer-*)`) → **ควรมี prefix dark**
- block set สีขาว / `var(--as-light-*)` → **ควรมี prefix light**
- block set แต่ layout/padding/border-radius/margin (ไม่มีสี) → **base ไม่ต้องมี prefix**
- block set สีด้วย `var(--card)` / `var(--as-surface-*)` (ตาม theme เอง) → **base (ตั้งใจ) — token สลับเอง**

---

## ตารางต่อบรรทัด

### กลุ่ม A — `.as-scope #assignment-list-panel-handoff` (ไม่มี `#panel-assignments`, ไม่มี theme prefix)

| บรรทัด | member อื่นในกลุ่ม comma ขึ้นต้นด้วย | property ที่ block set (ย่อ) | โทนสี | สรุป |
|---|---|---|---|---|
| **6533** (6532–6540) | `.as-scope #assignment-list-panel-review/-work`, `.as-scope #assignment-detail-panel-handoff` — bare `.as-scope` ทั้งหมด | `border-color:var(--as-border-subtle); border-radius:16px; background:color-mix(var(--card) 92%,var(--as-surface-sunken)); box-shadow` | var ตาม theme | **base (ตั้งใจ)** |
| **6696** (6695–6700) | เหมือน 6533 — bare `.as-scope` | `background:color-mix(var(--card) 88%,var(--as-surface-sunken)) !important` | var | **base (ตั้งใจ)** |
| **6809** (6808–6817) | + `.assignment-brief-card/-workspace-section/-deliverables-card/.table-wrap` — bare `.as-scope` | `border-radius:var(--as-radius-card) !important` | — | **base (ตั้งใจ)** |
| **6902** (6901–6913) | + brief-card/workspace-section/deliverables-card/review-submission-section/table-wrap — bare `.as-scope` | `border:1px solid var(--as-border-subtle); box-shadow:none; background:color-mix(var(--card) 90%,var(--as-surface-sunken)) !important` | var | **base (ตั้งใจ)** |
| **7008** (7007–7012) | review/work/detail-handoff — bare `.as-scope`; **มีคู่ dark แยกที่ 7014–7019** | `box-shadow:0 1px 0 rgba(255,255,255,.34), 0 12px 24px rgba(15,23,42,.04) !important` | เงาโทน light | **ควรเป็น light** (เงาเท่านั้น, คู่ dark อยู่ 7014) |

### กลุ่ม B — `#panel-assignments.as-scope #assignment-list-panel-handoff` (ไม่มี theme prefix)

| บรรทัด | member อื่นในกลุ่ม comma ขึ้นต้นด้วย | property ที่ block set (ย่อ) | โทนสี | สรุป |
|---|---|---|---|---|
| **7114 / 7116** (7112–7118) | `#panel-assignments.as-scope #assignment-{detail-panel-handoff,list-panel-review,list-panel-handoff,list-panel-work}` + `.as-scope #assignment-list-panel-handoff` — **ทั้งกลุ่มไม่มี prefix** | `border-color:color-mix(var(--line) 58%,transparent) !important` | var | **base (ตั้งใจ)** |
| **7157** (7153–7167) | member อื่น = `:root[data-theme="dark"] #panel-assignments.as-scope …` (detail-handoff/list-review/list-handoff/list-work/workspace/…) — **ยกเว้น 7157 และ 7158 (`…#assignment-list-panel-work`) ที่ไม่มี prefix** | `border-color:color-mix(#334155 56%,transparent) !important` | **#334155 dark** | **ควรมี prefix dark** (เฉพาะ border; 7158 work รั่วด้วย) |
| **7192** (7190–7204) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (7190) + dark-prefixed detail-handoff/workspace/review-submission/brief/deliverables/summary/table-wrap | `background:var(--as-dark-surface); border-color:var(--as-dark-line); box-shadow:none !important` | var dark (`--as-dark-surface`=`#111722`, นิยามใต้ `:root[data-theme="dark"] #panel-assignments.as-scope` ที่ 7174–7182) | **ควรมี prefix dark** — แต่ var ไม่นิยามใน light → **no-op ใน light** |
| **7398** (7394–7401) | `#panel-assignments.as-scope {.panel,.secondary-panel,.table-wrap,#assignment-list-panel-review,#assignment-detail-panel-handoff}` — **ทั้งกลุ่มไม่มี prefix** | `border-color:color-mix(var(--line) 62%,transparent) !important` | var | **base (ตั้งใจ)** |
| **7500** (7496–7509) | `#panel-assignments.as-scope {,.panel,.secondary-panel,#assignment-list-panel-review,#assignment-detail-panel-handoff,workspace-section,review-submission-section,brief-card,deliverables-card,table-wrap}` — **ทั้งกลุ่มไม่มี prefix**; คู่ dark ที่ 7518–7532 | `border-color:#cbd5e1; background:#ffffff !important` | **#ffffff / #cbd5e1 light** | **ควรมี prefix light** (ทั้งกลุ่ม base=light, คู่ dark 7518) |
| **7523** (7518–7532) | member = `:root[data-theme="dark"] #panel-assignments.as-scope {,.panel,.secondary-panel,#assignment-list-panel-review}` (7518–7521) + dark-prefixed detail-handoff/workspace/…/table-wrap | `border-color:#334155; background:#0f172a !important` | **#0f172a / #334155 dark** | **ควรมี prefix dark — ทาสีพื้นหลัง dark literal รั่วเข้า light** |
| **7649** (7648–7653) | `#panel-assignments.as-scope {#assignment-list-panel-review,#assignment-detail-panel-handoff}` — **ทั้งกลุ่มไม่มี prefix**; คู่ dark 7685 | `border:1px solid #cbd5e1; background:#ffffff !important` | **#ffffff light** | **ควรมี prefix light** (คู่ dark 7685) |
| **7687** (7685–7691) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (7685) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (7688) | `border-color:#334155; background:#0f172a !important` | **#0f172a / #334155 dark** | **ควรมี prefix dark — ทาสีพื้นหลัง dark literal รั่วเข้า light** |
| **7774** (7772–7781) | `#panel-assignments.as-scope {#assignment-page-summary,#assignment-list-panel-review,#assignment-detail-panel-handoff,workspace-section,review-submission-section}` — bare | `margin-top:16px; padding-top/bottom:14px !important` | — | **base (ตั้งใจ)** |
| **8204** (8200–8207) | `#panel-assignments.as-scope {.page-actions-strip,#assignment-page-summary,#assignment-manual-create-panel,#assignment-list-panel-review,#assignment-detail-panel-handoff}` — bare | `margin:0 !important` | — | **base (ตั้งใจ)** |
| **8210** (8209–8213) | `#panel-assignments.as-scope {#assignment-list-panel-review,#assignment-detail-panel-handoff}` — bare | `padding:24px !important` | — | **base (ตั้งใจ)** |
| **8226** (8225–8229, `@media max-width:900px`) | เหมือน 8210 — bare | `padding:16px !important` | — | **base (ตั้งใจ)** |
| **8260** (8258–8271) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (8258) + dark-prefixed detail-handoff/workspace/review-submission/brief/deliverables/secondary-panel/table-wrap | `background:#111827; border-color:rgba(255,255,255,.06); box-shadow:none !important` | **#111827 dark** | **ควรมี prefix dark — ทาสีพื้นหลัง dark literal รั่วเข้า light** |
| **8329** (8327–8334) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (8327) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (8330) | `border:1px solid rgba(255,255,255,.05); background:linear-gradient(180deg,#111827 0%,#0f172a 100%); box-shadow:0 8px 24px rgba(0,0,0,.22) !important` | **#111827/#0f172a dark** | **ควรมี prefix dark — ทาสีพื้นหลัง (gradient) dark รั่วเข้า light** |
| **8402** (8400–8405) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (8400) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (8403) | `padding:28px !important` | — | **base** (layout เท่านั้น — แม้กลุ่มเป็น dark ก็ไม่กระทบสี) |
| **8557** (8555–8562) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (8555) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (8558) | `background:var(--as-layer-card); border-color:rgba(255,255,255,.045); box-shadow !important` | var dark (`--as-layer-card`=`#0f1622`, นิยามใต้ `:root[data-theme="dark"]` ที่ 8535–8541) | **ควรมี prefix dark** — var ไม่นิยามใน light → **no-op ใน light** |
| **8936** (8935–8939) | `#panel-assignments.as-scope {#assignment-list-panel-review,#assignment-detail-panel-handoff}` — bare | `padding:22px !important` | — | **base (ตั้งใจ)** |
| **9002** (9001–9005, `@media max-width:900px`) | เหมือน 8936 — bare | `padding:16px !important` | — | **base (ตั้งใจ)** |
| **9114** (9112–9123) | `#panel-assignments.as-scope {.page-actions-strip,#assignment-list-panel-review,#assignment-detail-panel-handoff,workspace-section,review-submission-section,brief-card,deliverables-card,secondary-panel,table-wrap}` — bare | `border-radius:var(--as-radius-md) !important` | — | **base (ตั้งใจ)** |
| **9164** (9162–9167) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (9162) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (9165) | `box-shadow:0 6px 18px rgba(0,0,0,.2) !important` | เงาโทน dark | **ควรมี prefix dark** (เงาเท่านั้น) |
| **9288** (9287–9291) | `#panel-assignments.as-scope {#assignment-list-panel-review,#assignment-detail-panel-handoff}` — bare *(ไม่ได้อยู่ในลิสต์ที่ให้ แต่รวมไว้ให้ครบ)* | `border-color:color-mix(var(--line) 56%,transparent) !important` | var | **base (ตั้งใจ)** |
| **9308** (9306–9311) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (9306) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (9309) | `border-color:rgba(148,163,184,.2) !important` | slate โปร่ง (โทน dark-border) | **ควรมี prefix dark** (border เท่านั้น) |
| **9374** (9373–9377) | `#panel-assignments.as-scope {#assignment-list-panel-review,#assignment-detail-panel-handoff}` — bare | `background:color-mix(var(--card) 98%,var(--as-surface-sunken) 2%) !important` | var ตาม theme (light → `--card`=#ffffff → ~ขาว) | **base (ตั้งใจ)** |
| **9398** (9396–9401) | member = `:root[data-theme="dark"] …#assignment-list-panel-review` (9396) + `:root[data-theme="dark"] …#assignment-detail-panel-handoff` (9399) | `background:color-mix(in srgb,#111827 92%,#0f172a 8%) !important` | **#111827/#0f172a dark** | **ควรมี prefix dark — ทาสีพื้นหลัง dark literal** |

### บรรทัด `.as-scope {…}` เปล่า (ที่สั่งให้เช็ค: 6533, 6696, 6809, 6902, 7008)
ทั้งหมดคือกลุ่ม A ข้างบน (เป็น comma-member ของ `#assignment-list-panel-handoff` ไม่ใช่ selector `.as-scope {}` เปล่า) — ดูแถว 6533/6696/6809/6902/7008 แล้ว
> หมายเหตุ: มี selector `.as-scope {…}` เปล่าจริง ๆ ที่ 6520, 6669, 6801, 6887, 7323, 7390, 7427, 7470 — พวกนี้ตั้ง **CSS variable ระดับ `.as-scope`** (เช่น `--card`, `--as-surface-*`, `--line`) และ **แต่ละอันมีคู่ `:root[data-theme="dark"] .as-scope {…}` / `:root[data-theme="dark"] #panel-assignments.as-scope {…}`** override ตามหลัง (6526, 6674, 6894, 7384, 7434, 7483) → base ตั้งใจ

---

## บรรทัดที่ "ทาสีพื้นหลัง" และไม่มี prefix — เรียงตาม source order

| # | บรรทัด | ค่า background | โทน | ผลใน light mode |
|---|---|---|---|---|
| 1 | 6533 | `color-mix(var(--card) 92%, var(--as-surface-sunken))` | var | ~ขาว (ถูก) |
| 2 | 6696 | `color-mix(var(--card) 88%, var(--as-surface-sunken)) !important` | var | ~ขาว (ถูก) |
| 3 | 6902 | `color-mix(var(--card) 90%, var(--as-surface-sunken)) !important` | var | ~ขาว (ถูก) |
| 4 | 7192 | `var(--as-dark-surface) !important` | var-dark | **no-op** (var ไม่นิยามใน light) |
| 5 | 7500 | `#ffffff !important` | light | ขาว (ถูก) |
| 6 | **7523** | `#0f172a !important` | **dark** | **ทา dark ทับ** ✗ |
| 7 | 7649 | `#ffffff !important` | light | ขาว (ถูก) |
| 8 | **7687** | `#0f172a !important` | **dark** | **ทา dark ทับ** ✗ |
| 9 | **8260** | `#111827 !important` | **dark** | **ทา dark ทับ** ✗ |
| 10 | **8329** | `linear-gradient(180deg,#111827,#0f172a) !important` | **dark** | **ทา dark ทับ** ✗ |
| 11 | 8557 | `var(--as-layer-card) !important` | var-dark | **no-op** (var ไม่นิยามใน light) |
| — | 8643 | `var(--as-light-card)` (`#ffffff`) | light | **มี prefix `:root:not([data-theme="dark"])` แล้ว** (แก้โดย `13e87f6`) |
| 12 | 9374 | `color-mix(var(--card) 98%, var(--as-surface-sunken) 2%) !important` | var | ~ขาว (ถูก) |
| 13 | **9398** | `color-mix(in srgb,#111827 92%,#0f172a 8%) !important` | **dark** | **ทา dark ทับ — ตัวสุดท้ายใน source order** ✗ |

### ตัวที่ชนะจริง

**`styles.css:9398`** (block 9396–9401) — `background: color-mix(in srgb, #111827 92%, #0f172a 8%) !important`
เป็น declaration ทา background ตัวสุดท้ายในไฟล์ที่ member `#panel-assignments.as-scope #assignment-list-panel-handoff` ไม่มี prefix และเป็นโทน dark

ลำดับ dark literal ที่รั่ว (source order): **7523 → 7687 → 8260 → 8329 → 9398** — ทั้ง 5 ตัว `!important` specificity เท่ากัน `(2,1,0)` → ตัวหลังสุด (**9398**) ทับตัวหน้า

---

## หมายเหตุ: commit `13e87f6` แก้อะไร / พอไหม

- diff = 1 บรรทัด: บรรทัด 8643 เปลี่ยนจาก `#panel-assignments.as-scope #assignment-list-panel-handoff,` → `:root:not([data-theme="dark"]) #panel-assignments.as-scope #assignment-list-panel-handoff,`
- ผล: specificity ของ member handoff ที่บรรทัด 8643 = **`(2,3,0)`** (`:root` + `.as-scope` + `:not([data-theme="dark"])` = 3 ใน b, 2 IDs) — สูงกว่าทุก member dark ที่รั่ว (`(2,1,0)`)
- block 8642–8648 ตั้ง **`background` + `border-color` + `box-shadow`** ครบ → ใน light mode ตอนนี้ทับ 7523 / 7687 / 8260 / 8329 / 9398 (background), 7157 / 7523 / 9308 (border-color), 9164 (box-shadow) ได้ทั้งหมด → **กล่อง handoff ควร render ขาวใน light mode หลัง `13e87f6`**
- ที่ยังเหลือ (ไม่กระทบสีพื้นเพราะ 8643 ทับ แต่ยังผิดรูปแบบ):
  - stray dark member ที่ยังไม่มี prefix: 7157, 7192, 7523, 7687, 8260, 8329, 8557, 9164, 9308, 9398 (+ 7158 ที่เป็น `#assignment-list-panel-work`)
  - 8643 พึ่ง **specificity** ทับ ไม่ใช่ source order — ถ้ามี unprefixed dark rule ใหม่ที่เติม `:root` หรือ id เพิ่ม จะพังซ้ำ
  - บรรทัด 7158 = `#panel-assignments.as-scope #assignment-list-panel-work` ไม่มี prefix ในกลุ่ม dark (border `#334155`) → **work panel ก็มี border รั่ว** (แต่แค่ border-color จึงไม่เห็นชัด)
- **ไม่แตะ**: ตาราง tab=raw (คนละ container `#panel-raw` ไม่มี `.as-scope`) และคำถามค้าง "ตอนดู raw `data-theme` เป็น light จริงไหม" จาก `audit/theme-light-table-panels-audit.md`
