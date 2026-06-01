# Content Lifecycle Plan

1. Add database structures for generation runs, drafts, review reports/actions, publish runs, published articles, and internal link suggestions.
2. Extend repository with lifecycle operations while keeping existing methods stable.
3. Upgrade generation workflow to build structured drafts (`title/excerpt/body/meta/related`) and persist run + drafts.
4. Upgrade quality workflow to output review reports/scores and enforce review queue.
5. Add admin review actions and internal link review APIs.
6. Add publish workflow (`generated -> reviewed -> approved -> published`) and safe staging/export integration.
7. Update internal UI to operate review, link acceptance, publish, stage, and export.
8. Run syntax/build checks and document usage.
