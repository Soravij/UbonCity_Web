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
