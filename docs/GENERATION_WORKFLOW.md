# Generation Workflow

1. Collect/promote raw item into `content_items`.
2. Run `POST /api/run/ai-draft`.
3. System stores:
- generation run (`generation_runs`)
- structured draft (`content_drafts`)
- content version (`content_versions`)

Draft fields include:
- draft_title
- excerpt
- body
- meta_title
- meta_description
- suggested_related
