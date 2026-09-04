# Admin Project State

Last Updated: 2026-06-19

## Active Branch Context

- Root branch in progress: `feature/assignment-return-cta-taxonomy-ui`

## Current State

- No admin code changes were made in the current CTA/Curation Work Return patch.
- Admin review should treat collector handoff snapshots as the issued checklist source.
- Admin may inspect resolved taxonomy answers but should not rebuild live assignment checklists for issued work.
- Homepage Curation tab "อีเวนต์" is active: controls block `featured_events` (enable/disable, title/subtitle, pinned items). No max_items selector — always shows 5 items (1 large card + 4 small). First pinned item = large card; remaining slots auto-filled from latest approved events (dedupe via pushUnique).
- Tab menu split into 2 groups: left = Layout, ไฮไลต์, สถานการณ์, อีเวนต์ (in page order); right = Signals / Content Pool.

## Pending

- Any future category correction flow must be explicit and upstream of issued assignment snapshots.
