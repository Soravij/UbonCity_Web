# Review Workflow

Quality step (`POST /api/run/quality`) creates review reports and queue entries.

Checks include:
- duplication risk
- SEO risk
- metadata completeness
- source grounding
- AI output quality

Reviewer actions (`POST /api/review/action`):
- approve
- reject
- request_changes

Status flow:
- generated -> reviewed -> approved/rejected/needs_revision
