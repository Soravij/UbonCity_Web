# Internal Linking Workflow

Link suggestions are generated during quality review for relevant items.

Suggestion rules:
- shared category
- shared tags
- title token overlap
- capped and score-based, no keyword stuffing automation

Reviewer actions:
- `POST /api/internal-links/:id/review` with `accept` or `reject`

Only accepted links are attached to published articles.
