# Content Lifecycle Audit

## Inspected Areas
- `collector-app` generation, quality, workflow, repository, server API, internal UI.
- Existing staging/export pipeline and compatibility with current raw->clean->draft->quality flow.

## Key Gaps Found
1. Draft generation existed but lacked structured draft storage and generation run tracking.
2. Quality checks existed but lacked mandatory review queue + review actions.
3. No controlled publish state; existing flow jumped to staging/export without explicit publish lifecycle.
4. Internal link suggestions were missing.

## Safety Constraints Applied
- No direct auto-publish from collection.
- Existing import/export and legacy scripts kept working.
- Status flow introduced incrementally via new tables and APIs.
