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
- The reference-cleanup UI panel is reachable from the Data Cleanup table after the owner clicks
  `ตรวจ`: `#reference-cleanup-panel`, `#reference-cleanup-item-id`, and
  `#btn-reference-cleanup-execute` let the owner sweep eligible candidates before confirmation and Purge.

Current work boundaries:
- Current project focus is CTA & Curation.
- Media workflow is complete for current pipeline testing and must not be reopened unless a confirmed regression is found.
- Media Library deduplication is separate follow-up work and must not be mixed with CTA / Curation changes.
- Runtime DB/test data exists only on the Runtime machine.
- Dev code audit must not assume Runtime records are locally available.
- No merge, commit, or push without explicit approval.
