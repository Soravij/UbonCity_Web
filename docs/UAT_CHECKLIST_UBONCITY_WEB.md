# UbonCity Web - UAT Checklist (Markdown Report)

> ใช้ไฟล์พิมพ์จริง: `UAT_CHECKLIST_UBONCITY_WEB.print.html`  
> ใช้ template อนาคต: `CHECKLIST_PRINT_TEMPLATE_A4.html`

## วิธีติ๊กผลในไฟล์นี้

- ผ่าน: ใส่ `/` ในช่อง `[ ]` เป็น `[ / ]`
- ไม่ผ่าน: คง `[ ]` แล้วลงรายละเอียดใน Failure Log
- ใช้รูปแบบเดียวกันทั้งไฟล์

## Metadata

- Date: __________
- Environment: __________
- Build/Commit: __________
- Tester: __________

## 1) Scope & Readiness

| รายการตรวจ | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| ใช้ environment ปัจจุบัน (ไม่ใช้ Docker) | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| ทุก service ที่ต้องใช้รันครบ (`frontend`,`collector`,`backend admin/API`) | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| `.env` ชี้ endpoint ถูกต้อง (auth, API base URL, CORS) | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| มี test accounts ครบทุก role | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

## 2) Global Smoke (ทุก role)

| รายการตรวจ | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| login สำเร็จ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| logout สำเร็จ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| session หมดอายุแล้วระบบพากลับ login ถูกต้อง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| login กลับมาแล้ว `return_to` / deep-link recovery ถูกต้อง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| direct-hit หน้า legacy ที่ไม่ควรเข้า ถูก redirect ถูกปลายทาง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| ไม่มี loop ด้วย `auth=expired` | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

## 3) Role Matrix Access

| รายการตรวจ | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| Owner เข้า owner-only surfaces ได้ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| Admin เข้า internal operational + contributor management ได้ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| User create/assign งาน และทำงานเองใน manager pages ได้ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| Editor เข้าเฉพาะ `editor-home/article-workspace/event-workspace` | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| Freelance เข้าเฉพาะ `freelance-home` และ `/?tab=work` ของตัวเอง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

## 4) E2E Flow (ชุดสั้น)

| รายการตรวจ | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| internal สร้าง item ใหม่สำเร็จ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| assign งานให้ editor/freelance สำเร็จ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| editor/freelance เปิดงาน แก้ content upload asset submit ได้ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| review/revision loop ทำงานครบ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

## 5) Regression Hotspots

| รายการตรวจ | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| portal redirects ยังถูกต้อง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| fallback จาก legacy ไม่พา external ไป shared intake ผิด role | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| `/?tab=work` ของ freelance ไม่หลุดหน้า | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

## 6) Failure Log

| ID | Severity | Role | URL/Page | Steps / Expected / Actual | Owner |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

## 7) Release Gate

| เกณฑ์ตัดสิน | Owner | Admin | User | Editor | Freelance | Result | Evidence / Note |
|---|---|---|---|---|---|---|---|
| ไม่มี P1 ค้าง | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| P2 มี workaround ชัดเจนหรือปิดครบ | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |
| role matrix ผ่านตาม scope release | [ ] | [ ] | [ ] | [ ] | [ ] |  |  |

- Decision: [ ] GO  [ ] NO-GO
- Approved by: __________
- Date: __________

