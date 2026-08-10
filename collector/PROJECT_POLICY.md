# Collector Project Policy

See [../PROJECT_POLICY.md](../PROJECT_POLICY.md) for the canonical project-wide policy.

## Collector-specific rules

- Collector owns Clean, Field Pack drafting, assignment handoff construction, and Work Return UI behavior.
- `handoffPackage.niche` is collector's current category context from Clean.
- Collector Work Return UI must not resolve taxonomy from the live catalog or call AI at render time.
- Future collector handoff construction may emit real resolved taxonomy checks; the current UI only consumes the snapshot it receives.
- Reserved rows `taxonomy.category`, `taxonomy.subtype`, and `taxonomy.tags` stay hidden in Work Return.
- `condition_note` remains part of the existing `requested_check_returns` contract.
- Hidden legacy draft rows and `custom.*` rows must be preserved through draft merge and payload handling.
- Collector must not introduce auto-save, auto-submit, or auto-publish behavior through this UI path.
- After Work Return is reviewed and accepted, Article Writers must not confirm CTA or Taxonomy again in Article Workspace; see root `PROJECT_POLICY.md` §7A Acceptance Boundary for the full contract.
  - TH: หลัง Work Return ผ่านการตรวจและอนุมัติแล้ว ผู้เขียนบทความใน Article Workspace ต้องไม่ยืนยัน CTA หรือ Taxonomy ซ้ำอีก — ดูรายละเอียดเต็มที่ root `PROJECT_POLICY.md` §7A Acceptance Boundary

## Delete / purge (collector-owned)

The canonical rules are root `PROJECT_POLICY.md` §3 Delete Tier Contract. Collector owns the code that
enforces them; these are the collector-side facts that contract depends on:

- The three purge tiers are declared as data in `db/repository.mjs`: `REFERENCE_CLEANUP_CANDIDATE_DEFS`,
  `REFERENCE_CONFIRM_REQUIRED_DEFS`, `REFERENCE_HARD_BLOCKER_DEFS`. A reference group must belong to
  exactly one of them. Adding a dependency table without adding a def leaves it ungated at purge.
  - TH: การเพิ่มตารางที่ผูกกับ item โดยไม่เพิ่ม def ทำให้ตารางนั้นหลุดจากเกณฑ์ purge
- `services/raw-delete.mjs` holds the gate logic as pure functions (`getNeverOverrideBlockersForItem`,
  `planBulkItemDelete`, `classifyPurgeGroups`, `planDeletedItemPurge`) so it is testable without a live
  server; `server/index.mjs` keeps only the transaction, the audit write and the HTTP shape. New gate
  rules belong in the service, not inline in the endpoint.
- `server/public/app.js` keeps a hand-maintained client copy of the group keys
  (`REFERENCE_CLEANUP_CANDIDATE_KEYS`, `REFERENCE_CONFIRM_REQUIRED_KEYS`). It must be updated in the
  same change whenever the server defs change — there is no runtime check that they agree.
  - TH: สอง Set นี้เป็นสำเนาที่ต้อง sync มือ ถ้า server defs เปลี่ยนต้องแก้ที่นี่ด้วยในครั้งเดียวกัน
- Manual-place category vocabulary is also hand-mirrored: client
  `CONTENT_CATEGORY_OPTIONS` (`server/public/app.js`) and server `CONTENT_ITEM_CATEGORIES`
  (`server/index.mjs`) must be changed together. Their six values currently agree
  (`attractions`, `activities`, `hotels`, `cafes`, `restaurants`, `transport`), but neither is derived
  from the other and there is no runtime agreement check. The client list is a user-visible hard gate
  for manual places (it throws during validation), not merely a label source; changing only one side
  can reject a category that is otherwise valid.
  - TH: รายการ category ของ manual place เป็นสำเนาที่ต้อง sync มือสองจุดเสมอ เพราะฝั่ง client
    ใช้เป็น validation gate จริง ถ้าแก้เพียงฝั่งเดียวอาจปฏิเสธค่าที่ server รับได้
- Manual-place deduplication does not compare against pending intake rows. `findCandidateMatches` only
  compares `state.items` from `GET /api/items` (imported `content_items`, filtered by visibility scope),
  not queued `source_raw_items`. This is a known limitation shared by all adapters: two people can enter
  the same place before either confirms it without being flagged as a duplicate. Manual place makes it
  more likely because it is the path where people independently type the same data.
  - TH: Dedupe ยังไม่เทียบกับ raw item ที่รออยู่ในคิว intake จึงอาจไม่พบรายการซ้ำเมื่อมีคนกรอก
    สถานที่เดียวกันก่อนมีใคร confirm; เป็น known limitation ของทุก adapter
- `hasTraceableReference()` in `services/clean-context.mjs` reads `item.source_url`, but
  `content_items` has no such column; source URLs live in `source_records`. Keep this behavior: a
  place passes the reference part of the Clean gate only through `map_url`, `google_place_id`, or a
  complete coordinate pair, making the gate stricter than the apparent source-URL branch. Do not make
  it read `source_records` alone: a URL-only place could then reach public output without coordinates
  and be placed incorrectly on the map. If this is changed in future, add a required-coordinate gate
  for `type=place` at the same time; never change only this reference check.
  - TH: ห้ามแก้ `hasTraceableReference()` ให้ใช้ source_records เพียงอย่างเดียว แม้ `source_url` ไม่ได้
    อยู่ใน content_items เพราะพฤติกรรมปัจจุบันบังคับให้ place มี map reference หรือพิกัดครบคู่; หาก
    จะแก้ในอนาคตต้องเพิ่มกฎบังคับพิกัดสำหรับ type=place ใน Clean gate พร้อมกันเสมอ
- `applyBlockerBadge()` owns its `delete-blocker-badge` element in a raw-title cell. Its post-render
  `annotateRawTableBlockers()` pass removes only `[data-badge="blocker-summary"]` before appending a
  replacement. Any new badge in the same cell must use and remove its own marker; never remove every
  `.delete-blocker-badge`, which would delete another feature's badge. Reusing a CSS class to avoid a
  new class can still collide with selector-based cleanup that is not obvious from markup, so grep for
  queries that remove or mutate that class before reusing it.
  - TH: `delete-blocker-badge` มีเจ้าของคือ applyBlockerBadge; badge อื่นในเซลล์เดียวกันต้องมี marker
    และ cleanup ของตัวเอง ห้ามลบด้วย class รวมทั้งหมด และต้อง grep หา selector ที่ลบหรือแก้ class นั้น
    ก่อน reuse เสมอ
- The reference-cleanup UI panel is reachable from the Data Cleanup table after the owner clicks
  `ตรวจ`: `#reference-cleanup-panel`, `#reference-cleanup-item-id`, and
  `#btn-reference-cleanup-execute` let the owner sweep eligible candidates before confirmation and Purge.

## Wongnai review extraction contracts

- **Byte limit**: `MAX_HTML_BYTES` = 3MB default (`manual.mjs:13`, env override `MAX_HTML_BYTES`). Applied at fetch time before decoding; truncation is UTF-8 safe (drops trailing incomplete multi-byte sequence). No per-host char cap remains.
  - TH: byte limit 3MB เป็น guard เดียว ตัดที่ buffer ก่อน decode, ไม่มี char cap แยก per-host อีก
- **Raw HTML buffer retention**: controlled by `RAW_HTML_BUFFER_ENABLED` env flag (default off). When enabled, writes the raw (pre-decode, post-truncation) buffer to `RAW_HTML_BUFFER_DIR` (default `raw/html-buffer/`). Filename = sha256(url) + timestamp. Write failures are logged and swallowed.
  - TH: เก็บ buffer ดิบลงดิสก์เปิด/ปิดด้วย env flag, เขียนล้มเหลวไม่กระทบ crawl
  - **Debug-only tool**: `RAW_HTML_BUFFER_ENABLED` is a temporary debug aid. There is no auto-cleanup by design — files must be deleted manually. Must never be left enabled on Runtime.
- **Review scoping**: `extractWongnaiReviewsFromStructuredState` (`manual.mjs:990`) filters by `reviewedItem.id === businessId` first. Name matching is a fallback only (when `businessId` is null). This is because wongnai storefront pages embed 20+ neighboring shop reviews in the same `window._wn` state; name-only matching would leak them.
  - TH: กรองด้วย business id ก่อน ชื่อเป็น fallback เท่านั้น เพราะหน้าร้าน wongnai มีรีวิวร้านข้างเคียง 20+ ร้านปนใน `window._wn`
- **`extraction_note` values** (`manual.mjs:1513-1516`):
  - `null` — all reviews matched scope (happy path)
  - `"wongnai_state_not_found"` — `window._wn` script tag missing or truncated by byte limit
  - `"wongnai_state_has_N_raw_reviews_but_0_matched_scope"` — state found, N reviews exist, but none passed the business-id/name filter
  - `"wongnai_partial_skip_N_of_M_reviews_name_mismatch: <names>"` — name fallback active, N of M reviews skipped because their `reviewedItem.name` differed from the page title

Current work boundaries:
- Current project focus is CTA & Curation.
- Media workflow is complete for current pipeline testing and must not be reopened unless a confirmed regression is found.
  - Confirmed regression (10 Aug 2026, verified from Network tab):
    - Fixed in this commit: `img.wongnai.com/p/_-x_/` images fail with `net::ERR` (normalised to `/p/400x0/`); `rsrc.php` UI assets bypassed junk filter on source_raw_media read/write paths.
    - Open: `scontent.fbcdn.net` images return HTTP 403 — no code fix yet.
- Media Library deduplication is separate follow-up work and must not be mixed with CTA / Curation changes.
- Runtime DB/test data exists only on the Runtime machine.
- Dev code audit must not assume Runtime records are locally available.
- No merge, commit, or push without explicit approval.
