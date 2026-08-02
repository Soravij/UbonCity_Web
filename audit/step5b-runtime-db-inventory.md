# Step 5B — Runtime DB identity and migration ledger

Audit date: 2026-08-02 (Runtime).  Database inspection used SQLite URI read-only mode (`mode=ro`) and `PRAGMA query_only=ON`. No database write, migration, or service start/restart was performed.

## 1. Runtime DB identity

**Configured Collector database:** `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db`

How identified: the `UbonCity Test Stack Startup` Scheduled Task starts `collector` with working directory `D:\UbonRuntime\repos\UbonCity_Web\collector` and does not supply `DB_PATH`. `collector/config/paths.mjs` therefore resolves the DB to `<working directory>\data\collector.db`. The Collector was not running during the audit (no listener on configured port 5070); this does not alter the configured runtime path.

- Size: **48,476,160 bytes**
- Last modified (UTC): **2026-07-29T09:48:10.048044+00:00**
- Application tables: **65**
- Non-empty tables: **34**
- Empty tables: **31**

### Row counts — substantive/non-empty tables

| Table | Rows |
|---|---:|
| `agent_profiles` | 1 |
| `ai_feature_policies` | 5 |
| `approved_context_blocks` | 507 |
| `assets` | 292 |
| `audit_logs` | 36,730 |
| `collector_sync_state` | 1 |
| `content_assets` | 277 |
| `content_assignment_handoff_snapshots` | 11 |
| `content_assignment_submission_deliverables` | 371 |
| `content_assignment_submissions` | 41 |
| `content_assignments` | 34 |
| `content_drafts` | 8 |
| `content_items` | 52 |
| `content_readiness_briefs` | 1 |
| `content_reference_media_selections` | 213 |
| `content_translations` | 18 |
| `content_workflow_models` | 52 |
| `content_workflow_transitions` | 475 |
| `draft_input_snapshots` | 110 |
| `evidence_blocks` | 1,681 |
| `field_pack_checklists` | 294 |
| `field_pack_references` | 26 |
| `field_packs` | 22 |
| `generation_runs` | 76 |
| `pipeline_runs` | 89 |
| `quality_checks` | 6 |
| `review_actions` | 26 |
| `review_reports` | 13 |
| `source_ingestions` | 64 |
| `source_raw_items` | 211 |
| `source_raw_media` | 1,927 |
| `source_records` | 51 |
| `translation_runs` | 38 |
| `users` | 16 |

The four specifically requested main-table results are: `content_items` **52**, `content_workflow_models` **52**, `content_assignments` **34**, and `media_assets` **not present** (there is no table named `media_assets`, so no row count is applicable). The project uses `assets`, which has **292** rows, and `content_assets`, which has **277** rows.

**Identity conclusion:** this is a substantial, plausible production-volume database, not an empty or near-empty leftover. The evidence supports: **the configured real runtime DB exists here, and the place-review schema migration has genuinely not run against it.** The conditional broad search for an alternative production DB was therefore not required.

## 2. Schema markers

| Database | `place_review_flag` on `content_workflow_models` | legacy `assignment_state` on `content_workflow_models` |
|---|---|---|
| Runtime: `D:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db` | **Absent** | **Present** |
| Dev: `C:\UbonRuntime\repos\UbonCity_Web\collector\data\collector.db` | **Absent** | **Present** |

Dev DB reference facts: size **774,144 bytes**; last modified **2026-05-13T13:01:46.316725+00:00 UTC**; `content_items` **0**; `content_workflow_models` **0**. It is not a production-volume DB.

## 3. Migration ledger

There is **no migration ledger or migration runner** for the Collector SQLite database:

- No migration/ledger table exists in the 65 SQLite application tables.
- `collector/database/migrations/011_drop_release_snapshots.sql` explicitly says: “Manual execution required: no migration runner or ledger is configured.”
- `collector/scripts/init-db.mjs` opens `database/schema.sql`; it does not record per-migration application.
- `collector/scripts/migrate-place-review-flags.mjs` records transition history only for migrated legacy place rows; it does not create or update a migration ledger.

Accordingly, the numbered files cannot be honestly marked applied or pending from this DB. Their state is **unverifiable (no ledger)**. The separate place-review script is **not applied**, proven by the missing `place_review_flag` column and the still-present legacy `assignment_state` column.

### Collector migration artifacts, in repository order

| Artifact | State on Runtime DB |
|---|---|
| `001_source_ingestion.sql` | Unverifiable — no ledger |
| `002_content_lifecycle.sql` | Unverifiable — no ledger |
| `003_publish_traceability_columns.sql` | Unverifiable — no ledger |
| `004_translation_workflow.sql` | Unverifiable — no ledger |
| `005_image_workflow_guardrails.sql` | Unverifiable — no ledger |
| `006_published_article_location_snapshot.sql` | Unverifiable — no ledger |
| `007_reference_media_selections.sql` | Unverifiable — no ledger |
| `009_content_asset_caption.sql` | Unverifiable — no ledger |
| `010_review_submission_snapshots.sql` | Unverifiable — no ledger |
| `011_drop_release_snapshots.sql` | Unverifiable — no ledger |
| `012_content_asset_name_sequences.sql` | Unverifiable — no ledger |
| `scripts/migrate-place-review-flags.mjs` | **Not applied** — schema markers prove this |

Collector split: **0 ledger-confirmed applied; 1 proven not applied; 11 unverifiable.** There is no evidence-based “pending” count for the 11 numbered files because the project records no application state.

The repository also contains 23 **backend** SQL migrations. They target the backend datastore rather than this Collector SQLite DB, so all are **not applicable to this DB**: `000_baseline_schema.sql`, `001_schema_alignment_core.sql`, `002_safe_constraints_if_missing.sql`, `003_media_library.sql`, `004_places_decision_metadata.sql`, `005_user_lifecycle_model.sql`, `006_user_profile_json.sql`, `007_user_avatar_columns.sql`, `008_collector_import_reviews.sql`, `009_collector_import_review_actions.sql`, `010_homepage_curation_layouts.sql`, `011_places_location_snapshot.sql`, `012_review_contents.sql`, `013_review_content_assets.sql`, `014_review_actions.sql`, `015_cta_analytics.sql`, `016_cta_analytics_facebook_website_click.sql`, `018_drop_events_is_published.sql`, `019_drop_places_lat_lng.sql`, `020_drop_places_curated_taxonomy_json.sql`, `021_review_submission_snapshot_provenance.sql`, `022_review_content_translations.sql`, and `023_drop_lifecycle_tables.sql`.

## 4. Runtime repository state

- HEAD: `cacb737f459c6fb3f217193369319fce0e255b73` — `test: guard smoke targets by server database` (2026-07-31 14:03:02 +0700)
- Branch: `codex/harden-runtime-smoke-target-guard`
- Working tree: **clean** (`git status --porcelain` produced no entries)
- Local `origin/main`: `0b4f105fad4687f3b2659cbd44f2d4d0ef07ffa3`
- Relative to the locally stored `origin/main`: **1 ahead, 0 behind**.
- The remote advertised `main` tip is `51796ecc57d0c9ce5dfd4dbd9c78614a16a5a25b`. GitHub’s read-only comparison reports this runtime HEAD is **17 ahead and 0 behind** that advertised tip (merge base is this HEAD).

Therefore, the absence of `audit/step5b-round1-audit-findings.md` is not evidence that this working copy is behind `main`; the Git evidence shows it is ahead of `main`.
