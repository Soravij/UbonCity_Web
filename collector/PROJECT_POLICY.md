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

Current work boundaries:
- Current project focus is CTA & Curation.
- Media workflow is complete for current pipeline testing and must not be reopened unless a confirmed regression is found.
- Media Library deduplication is separate follow-up work and must not be mixed with CTA / Curation changes.
- Runtime DB/test data exists only on the Runtime machine.
- Dev code audit must not assume Runtime records are locally available.
- No merge, commit, or push without explicit approval.