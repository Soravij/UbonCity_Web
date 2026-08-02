# Step 5 — Field-pack `must_capture` blocker survey

Date: 2026-08-02  
Scope: source and SQLite inspection only. No HTTP mutation, migration, schema change, code change, or direct database write was performed.

## Conclusion

The failure is a contract validation on the **new field-pack object returned by the AI agent**, before it is saved. It is not a lookup requiring a pre-existing field pack. A current field pack can be created through the supported API, but that alone does **not** make `POST /api/run/ai-draft` pass: the stage calls `generateFieldPack(...)` and validates that freshly generated object first. The agent/provider must return a non-empty `must_capture` entry with a valid `capture_type`.

The new database has zero rows in every `field_pack_*` table. The retained old database has 22 field packs, 294 checklist rows (including 158 `must_capture` rows), and 26 references. The reset script explicitly deletes these content-domain tables. Therefore the difference is data removed by the wipe. This is not evidence of a required schema/default seed: field packs are runtime content records and can be created through the API, but their absence does not explain this particular validation error by itself.

## 1. Validation and definition

| Question | Source evidence | Result |
| --- | --- | --- |
| Exact failing validation | `collector/services/workflow.mjs:2114-2137` (`assertAgentFieldPackContract`) | It counts checklist rows at `:2109-2111`; error is thrown at `:2125` when `mustCaptureCount < 1`. |
| When it runs | `collector/services/workflow.mjs:2364-2369` | `runAiDraftStage` calls `agentEngine.generateFieldPack(...)`, then validates the returned `finalFieldPack` **before** saving or transitioning the item. |
| Checklist storage | `collector/database/schema.sql:652-669` | Table `field_pack_checklists`; key columns are `field_pack_id`, `checklist_type`, `item_text`, `capture_type`, `item_order`, `status`, and `note`. |
| Meaning of `must_capture` | `collector/services/agent-generation.mjs:109-133,188-193`; `collector/services/workflow.mjs:2128-2137` | It is the value of `checklist_type`, not a boolean flag. A row counts only when `checklist_type = "must_capture"` and `item_text` is non-empty. Every such row must also have `capture_type` exactly `photo`, `video`, or `both`. |
| Other required contract parts | `collector/services/workflow.mjs:2118-2126` | A non-empty `ai_summary`, `story_angle`, or `social_hook`, plus at least one each of `must_verify_fact`, `must_capture`, and `must_ask_question`. |

The repository performs matching write-time input validation at `collector/db/repository.mjs:2595-2622`: `must_capture` requires `capture_type` (`photo`/`video`/`both`), while all checklist rows require a valid type, non-empty `item_text`, and valid status. The database has the corresponding `CHECK` constraints at `collector/database/schema.sql:655-663`.

## 2. Where field packs and checklists can come from

### Supported API

| Operation | Endpoint and access | Source |
| --- | --- | --- |
| Create a field pack and its supplied checklist rows | `POST /api/items/:id/field-packs`; declared roles `owner`, `admin`, `user`; item mutation-access check also applies | `collector/server/index.mjs:12774-12805` |
| Update an existing field pack/checklist list | `PUT /api/field-packs/:fieldPackId`; same declared roles and item mutation-access check | `collector/server/index.mjs:12809-12851` |
| Ask the agent to generate/regenerate a pack | `POST /api/items/:id/field-pack/regenerate`; agent output is converted then saved | `collector/server/index.mjs:12856-12935` |

For `owner`, the auth middleware permits the request regardless of the route's declared list; see `collector/server/auth-integration.mjs:563-580`. `admin` and `user` still have the route role declaration and item mutation-access condition above.

### Automatic creation and seeds/templates

- `runAiDraftStage` is the pipeline path that saves a generated field pack: `collector/services/workflow.mjs:2171-2208` prepares the payload and calls `repo.createFieldPack` at `:2206`; the AI generation/validation call is at `:2364-2369`.
- Static call-site review found no `repo.createFieldPack` in the import/collect or clean-stage paths. Import/clean do not automatically create a field pack; AI-draft does.
- A mock data script exists at `collector/scripts/seed-mock-work-stage-jobs.mjs:242-273`, but it is an optional test/fixture script, not runtime default seeding. Its capture rows use `checklist_type: "must_capture_shot"` at `:262-268`, which is not one of the current schema's accepted checklist types; it is not a current valid template for this contract.
- There is no automatic default field-pack/checklist seed located in the runtime code paths reviewed. The domain reset list explicitly includes `field_pack_assignments`, `field_pack_media_hints`, `field_pack_references`, `field_pack_checklists`, and `field_packs` at `collector/scripts/reset-collector-content-domain.mjs:12-18`.

## 3. Read-only database comparison

Read using Node SQLite with `readOnly: true`.

| Table | New `collector/data/collector.db` | Old `collector/data/collector.db.old-2026-08-02` |
| --- | ---: | ---: |
| `field_packs` | 0 | 22 |
| `field_pack_checklists` | 0 | 294 |
| `field_pack_references` | 0 | 26 |
| `field_pack_media_hints` | 0 | 0 |
| `field_pack_assignments` | 0 | 0 |

Old checklist breakdown: `must_capture` 158, `must_ask_question` 78, `must_verify_fact` 58. The new DB has no checklist rows.

Finding: the old DB contains field-pack content while the new DB contains none, and the content-domain reset script names all of those tables for deletion. The field-pack records were wiped with content-domain data. They are runtime/generated content data, not a schema migration requirement or built-in seed that the service silently restores.

## 4. Smallest supported creation payload

No direct SQL is required to create a syntactically valid field pack. The smallest payload that satisfies both the repository's checklist validation and the AI-field-pack contract shape is below (replace `ITEM_ID`; authorization is omitted deliberately):

```http
POST /api/items/ITEM_ID/field-packs
Content-Type: application/json

{
  "status": "draft",
  "ai_summary": "Synthetic field brief",
  "field_pack_checklists": [
    {
      "checklist_type": "must_verify_fact",
      "item_text": "Verify the place name on site"
    },
    {
      "checklist_type": "must_capture",
      "item_text": "Take one exterior cover photo",
      "capture_type": "photo"
    },
    {
      "checklist_type": "must_ask_question",
      "item_text": "Ask for current opening hours"
    }
  ]
}
```

The server supplies `content_item_id` from the route and `updated_by` from the authenticated actor (`collector/server/index.mjs:12791-12795`). Omitted checklist `status` defaults to `todo` and `item_order` defaults to array order in `collector/db/repository.mjs:2605-2620`.

Important limitation: this endpoint payload can create a valid stored field pack, but it does **not** bypass the current AI-draft failure. `runAiDraftStage` validates `finalFieldPack` returned by `agentEngine.generateFieldPack` at `collector/services/workflow.mjs:2364-2369`; its update payload takes `source.field_pack_checklists` from that new output at `:2016`. Therefore the corrective operational input is for the configured agent/provider to emit the three checklist categories above, especially at least one valid `must_capture`; adding an old seed or manually creating an unrelated pack is insufficient to make an invalid new agent response pass.

## Constraints observed

- All inspection was read-only.
- No endpoints were invoked for this survey.
- No migrations, schema changes, code edits, or database writes were made.
