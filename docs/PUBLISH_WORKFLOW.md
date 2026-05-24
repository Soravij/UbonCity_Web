# Publish Workflow

Publish is controlled and explicit:

1. Approve items in review queue.
2. Publish via `POST /api/run/publish`.
3. System writes `published_articles` and updates item status to `published`.
4. Optional staging sync via `POST /api/run/stage`.
5. Export via `POST /api/run/export`.

Safety:
- no direct publish from raw/source collection
- publish requires explicit admin action
