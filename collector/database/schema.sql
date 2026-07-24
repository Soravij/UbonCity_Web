PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  profile_json TEXT,
  password_hash TEXT NOT NULL DEFAULT '',
  managed_by_user_id INTEGER,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_uid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  category TEXT,
  lang TEXT NOT NULL DEFAULT 'th',
  title TEXT NOT NULL,
  normalized_title TEXT,
  slug TEXT,
  description_raw TEXT NOT NULL,
  description_clean TEXT,
  summary TEXT,
  meta_title TEXT,
  meta_description TEXT,
  event_period_text TEXT,
  location_text TEXT,
  latitude REAL,
  longitude REAL,
  map_url TEXT,
  google_place_id TEXT,
  image_url TEXT,
  tags TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'raw',
  claimed_by_user_id INTEGER,
  claimed_at TEXT,
  claim_note TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(claimed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  source_type TEXT,
  source_name TEXT,
  source_url TEXT,
  source_entity_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_records_url ON source_records(source_url) WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS reviews_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  review_text TEXT,
  source_name TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  title TEXT,
  description_clean TEXT,
  summary TEXT,
  meta_title TEXT,
  meta_description TEXT,
  generated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  UNIQUE(content_item_id, version_no)
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staging_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL UNIQUE,
  draft_id INTEGER,
  review_report_id INTEGER,
  staged_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  staged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uid TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  output_path TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_uid TEXT NOT NULL UNIQUE,
  storage_disk TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, variant_name)
);

CREATE TABLE IF NOT EXISTS content_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'unused',
  selected_in_clean INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0,
  placement_type TEXT NOT NULL DEFAULT 'unused',
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption VARCHAR(255),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_reference_media_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  reference_media_id TEXT NOT NULL,
  selected_for_ai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  UNIQUE(content_item_id, reference_media_id)
);
CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_item
ON content_reference_media_selections(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_selected
ON content_reference_media_selections(content_item_id, selected_for_ai);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  assignment_id INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);

CREATE TABLE IF NOT EXISTS collector_sync_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS source_ingestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL UNIQUE,
  adapter TEXT NOT NULL,
  source_label TEXT,
  status TEXT NOT NULL DEFAULT 'collected',
  item_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS source_raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  source_ref TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'social',
  title_raw TEXT,
  description_raw TEXT,
  payload_json TEXT,
  normalized_json TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_raw_items_batch ON source_raw_items(batch_uid);
CREATE INDEX IF NOT EXISTS idx_source_raw_items_status ON source_raw_items(status);

CREATE TABLE IF NOT EXISTS source_raw_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_item_id INTEGER NOT NULL,
  media_url TEXT,
  checksum TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'raw',
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(raw_item_id) REFERENCES source_raw_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_raw_media_raw_item ON source_raw_media(raw_item_id);

CREATE TABLE IF NOT EXISTS transport_base_maps_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  bounds_min_lat REAL NOT NULL,
  bounds_min_lng REAL NOT NULL,
  bounds_max_lat REAL NOT NULL,
  bounds_max_lng REAL NOT NULL,
  viewbox_x REAL NOT NULL DEFAULT 0,
  viewbox_y REAL NOT NULL DEFAULT 0,
  viewbox_width REAL NOT NULL DEFAULT 4000,
  viewbox_height REAL NOT NULL DEFAULT 5600,
  projection_type TEXT NOT NULL DEFAULT 'linear-bbox-fit',
  base_svg_asset_id INTEGER,
  preview_asset_id INTEGER,
  candidate_map_asset_id INTEGER,
  annotation_map_asset_id INTEGER,
  published_map_asset_id INTEGER,
  active_label_layout_id INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(base_svg_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(preview_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(candidate_map_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(annotation_map_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(published_map_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(active_label_layout_id) REFERENCES transport_label_layouts_v2(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transport_base_map_labels_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_map_id INTEGER NOT NULL,
  label_key TEXT NOT NULL,
  label_category TEXT NOT NULL DEFAULT 'landmark',
  anchor_x REAL NOT NULL,
  anchor_y REAL NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  min_zoom_hint REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(base_map_id) REFERENCES transport_base_maps_v2(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transport_base_map_labels_v2_map
  ON transport_base_map_labels_v2(base_map_id, priority DESC, id ASC);

CREATE TABLE IF NOT EXISTS transport_label_layouts_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layout_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transport_label_layout_items_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label_layout_id INTEGER NOT NULL,
  label_key TEXT NOT NULL,
  label_category TEXT NOT NULL DEFAULT 'landmark',
  anchor_x REAL NOT NULL,
  anchor_y REAL NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  min_zoom_hint REAL,
  locale_offsets_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(label_layout_id) REFERENCES transport_label_layouts_v2(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_label_layout_items_v2_key
  ON transport_label_layout_items_v2(label_layout_id, label_key);

CREATE INDEX IF NOT EXISTS idx_transport_label_layout_items_v2_layout
  ON transport_label_layout_items_v2(label_layout_id, priority DESC, id ASC);

CREATE TABLE IF NOT EXISTS transport_routes_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_map_id INTEGER,
  route_name TEXT NOT NULL,
  route_number TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'songthaew',
  vehicle_thumbnail_asset_id INTEGER,
  color TEXT NOT NULL DEFAULT '#ff6600',
  description TEXT NOT NULL DEFAULT '',
  workflow_status TEXT NOT NULL DEFAULT 'draft',
  assignee_user_id INTEGER,
  route_revision INTEGER NOT NULL DEFAULT 1,
  resolved_revision INTEGER NOT NULL DEFAULT 0,
  poster_revision INTEGER NOT NULL DEFAULT 0,
  routing_status TEXT NOT NULL DEFAULT 'missing',
  poster_status TEXT NOT NULL DEFAULT 'missing',
  poster_svg_asset_id INTEGER,
  poster_webp_asset_id INTEGER,
  resolved_distance_km REAL NOT NULL DEFAULT 0,
  resolved_bbox_json TEXT,
  last_routed_at TEXT,
  last_poster_generated_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(base_map_id) REFERENCES transport_base_maps_v2(id) ON DELETE SET NULL,
  FOREIGN KEY(assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(vehicle_thumbnail_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(poster_svg_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY(poster_webp_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_routes_v2_route_number ON transport_routes_v2(route_number);
CREATE INDEX IF NOT EXISTS idx_transport_routes_v2_base_map ON transport_routes_v2(base_map_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_routes_v2_statuses
  ON transport_routes_v2(workflow_status, routing_status, poster_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS transport_route_control_points_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  point_order INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  label TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(route_id) REFERENCES transport_routes_v2(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_route_control_points_v2_order
  ON transport_route_control_points_v2(route_id, point_order);

CREATE TABLE IF NOT EXISTS transport_route_stops_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  stop_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  stop_type TEXT NOT NULL DEFAULT 'stop',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(route_id) REFERENCES transport_routes_v2(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_route_stops_v2_order
  ON transport_route_stops_v2(route_id, stop_order);

CREATE TABLE IF NOT EXISTS transport_route_resolved_paths_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  route_revision INTEGER NOT NULL,
  routing_engine TEXT NOT NULL DEFAULT 'osrm',
  routing_profile TEXT NOT NULL DEFAULT 'driving',
  geometry_json TEXT NOT NULL,
  distance_km REAL NOT NULL DEFAULT 0,
  bbox_json TEXT,
  point_count INTEGER NOT NULL DEFAULT 0,
  osrm_summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(route_id) REFERENCES transport_routes_v2(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transport_route_resolved_paths_v2_route
  ON transport_route_resolved_paths_v2(route_id, route_revision DESC, id DESC);

CREATE TABLE IF NOT EXISTS transport_route_poster_paths_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  route_revision INTEGER NOT NULL,
  source_resolved_path_id INTEGER NOT NULL,
  geometry_json TEXT NOT NULL,
  bbox_json TEXT,
  point_count INTEGER NOT NULL DEFAULT 0,
  simplification_profile TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(route_id) REFERENCES transport_routes_v2(id) ON DELETE CASCADE,
  FOREIGN KEY(source_resolved_path_id) REFERENCES transport_route_resolved_paths_v2(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transport_route_poster_paths_v2_route
  ON transport_route_poster_paths_v2(route_id, route_revision DESC, id DESC);

CREATE TABLE IF NOT EXISTS transport_route_render_jobs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  route_revision INTEGER NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(route_id) REFERENCES transport_routes_v2(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transport_route_render_jobs_v2_route
  ON transport_route_render_jobs_v2(route_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_record_type TEXT,
  source_record_id TEXT,
  source_url TEXT,
  source_label TEXT,
  lang TEXT,
  attribution_text TEXT,
  text_value TEXT,
  numeric_value REAL,
  list_value_json TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_blocks_item ON evidence_blocks(content_item_id);
CREATE INDEX IF NOT EXISTS idx_evidence_blocks_status ON evidence_blocks(status);

CREATE TABLE IF NOT EXISTS approved_context_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  evidence_block_id INTEGER NOT NULL,
  context_type TEXT NOT NULL DEFAULT 'fact',
  selected_text TEXT,
  selected_numeric REAL,
  selected_list_json TEXT,
  note TEXT,
  editor_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'active',
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(evidence_block_id) REFERENCES evidence_blocks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approved_context_item ON approved_context_blocks(content_item_id);
CREATE INDEX IF NOT EXISTS idx_approved_context_status ON approved_context_blocks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approved_context_active_unique
  ON approved_context_blocks(content_item_id, evidence_block_id)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS draft_input_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'approved_context_preview',
  run_uid TEXT NOT NULL,
  payload_json TEXT,
  input_json TEXT NOT NULL,
  context_hash TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_draft_input_snapshots_item ON draft_input_snapshots(content_item_id);
CREATE INDEX IF NOT EXISTS idx_draft_input_snapshots_run_uid ON draft_input_snapshots(run_uid);

CREATE TABLE IF NOT EXISTS generation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'deterministic',
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  generation_run_uid TEXT NOT NULL,
  draft_title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  suggested_related_json TEXT,
  ai_quality_score INTEGER,
  confirmed_cta_contact_json TEXT NOT NULL DEFAULT '{}',
  confirmed_taxonomy_json TEXT NOT NULL DEFAULT '{}',
  confirmed_meta_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (confirmed_meta_status IN ('not_started', 'in_review', 'confirmed')),
  confirmed_by_user_id INTEGER,
  confirmed_at TEXT,
  confirmed_note TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(content_item_id, generation_run_uid)
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_item ON content_drafts(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status);

CREATE TABLE IF NOT EXISTS review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  draft_id INTEGER,
  duplication_score INTEGER NOT NULL DEFAULT 0,
  seo_risk_score INTEGER NOT NULL DEFAULT 0,
  metadata_score INTEGER NOT NULL DEFAULT 0,
  grounding_score INTEGER NOT NULL DEFAULT 0,
  ai_quality_score INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT,
  report_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_reports_item ON review_reports(content_item_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status);

CREATE TABLE IF NOT EXISTS field_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  source_draft_id INTEGER,
  source_review_report_id INTEGER,
  source_draft_input_snapshot_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready_for_field', 'field_in_progress', 'field_done', 'on_hold')),
  is_current INTEGER NOT NULL DEFAULT 1
    CHECK (is_current IN (0, 1)),
  ai_summary TEXT,
  ai_highlights_json TEXT NOT NULL DEFAULT '[]',
  ai_unknowns_json TEXT NOT NULL DEFAULT '[]',
  editor_summary TEXT,
  verified_facts_json TEXT NOT NULL DEFAULT '[]',
  uncertain_facts_json TEXT NOT NULL DEFAULT '[]',
  story_angle TEXT,
  field_notes TEXT,
  social_hook TEXT,
  social_shot_emphasis_json TEXT NOT NULL DEFAULT '[]',
  social_on_camera_points_json TEXT NOT NULL DEFAULT '[]',
  social_caption_angle TEXT,
  ai_cta_contact_json TEXT NOT NULL DEFAULT '{}',
  ai_taxonomy_json TEXT NOT NULL DEFAULT '{}',
  requested_checks_json TEXT NOT NULL DEFAULT '{"version":1,"groups":[]}',
  curated_cta_contact_json TEXT NOT NULL DEFAULT '{}',
  curated_taxonomy_json TEXT NOT NULL DEFAULT '{}',
  curation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (curation_status IN ('not_started', 'in_review', 'curated')),
  curated_by_user_id INTEGER,
  curated_at TEXT,
  curation_note TEXT,
  writer_ready INTEGER NOT NULL DEFAULT 0
    CHECK (writer_ready IN (0, 1)),
  writer_angle TEXT,
  writer_key_points_json TEXT NOT NULL DEFAULT '[]',
  writer_notes TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
  FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
  FOREIGN KEY(source_draft_input_snapshot_id) REFERENCES draft_input_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY(curated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_packs_current_per_item
  ON field_packs(content_item_id)
  WHERE is_current = 1 AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_field_packs_item ON field_packs(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_packs_status ON field_packs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS field_pack_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_pack_id INTEGER NOT NULL,
  checklist_type TEXT NOT NULL
    CHECK (checklist_type IN ('must_verify_fact', 'must_capture_shot', 'must_ask_question')),
  item_text TEXT NOT NULL,
  item_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'done', 'skip')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_pack_checklists_pack_type
  ON field_pack_checklists(field_pack_id, checklist_type, item_order, id);

CREATE TABLE IF NOT EXISTS field_pack_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_pack_id INTEGER NOT NULL,
  reference_scope TEXT NOT NULL DEFAULT 'general'
    CHECK (reference_scope IN ('general', 'writer')),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  source_family TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_family IN ('official', 'institutional', 'google_maps', 'wongnai', 'manual', 'system')),
  note TEXT,
  item_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_pack_references_pack_scope
  ON field_pack_references(field_pack_id, reference_scope, item_order, id);

CREATE TABLE IF NOT EXISTS field_pack_media_hints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_pack_id INTEGER NOT NULL,
  content_asset_id INTEGER,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reference'
    CHECK (kind IN ('cover', 'gallery', 'raw', 'reference')),
  caption TEXT,
  selected INTEGER NOT NULL DEFAULT 0
    CHECK (selected IN (0, 1)),
  item_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE,
  FOREIGN KEY(content_asset_id) REFERENCES content_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_field_pack_media_hints_pack
  ON field_pack_media_hints(field_pack_id, kind, item_order, id);

CREATE TABLE IF NOT EXISTS field_pack_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_pack_id INTEGER NOT NULL,
  assignment_scope TEXT NOT NULL
    CHECK (assignment_scope IN ('field', 'writer')),
  linked_assignment_id INTEGER,
  assigned_user_id INTEGER,
  assigned_name TEXT,
  assigned_role TEXT,
  assigned_at TEXT,
  due_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(field_pack_id) REFERENCES field_packs(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_assignment_id) REFERENCES content_assignments(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_pack_assignments_scope
  ON field_pack_assignments(field_pack_id, assignment_scope);
CREATE INDEX IF NOT EXISTS idx_field_pack_assignments_linked
  ON field_pack_assignments(linked_assignment_id, due_at);

CREATE TABLE IF NOT EXISTS review_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  report_id INTEGER,
  action TEXT NOT NULL,
  reviewer_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(report_id) REFERENCES review_reports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS internal_link_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  target_content_item_id INTEGER NOT NULL,
  anchor_text TEXT NOT NULL,
  relevance_score INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewer_email TEXT,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(target_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_internal_link_suggestions_item ON internal_link_suggestions(content_item_id, status);

CREATE TABLE IF NOT EXISTS publish_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS published_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL UNIQUE,
  draft_id INTEGER,
  review_report_id INTEGER,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  event_period_text TEXT,
  location_text TEXT,
  latitude REAL,
  longitude REAL,
  map_url TEXT,
  google_place_id TEXT,
  related_json TEXT,
  internal_links_json TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);



CREATE TABLE IF NOT EXISTS content_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_content_item_id INTEGER NOT NULL,
  source_published_article_id INTEGER,
  source_draft_id INTEGER,
  source_review_report_id INTEGER,
  source_fingerprint TEXT NOT NULL,
  lang TEXT NOT NULL,
  translated_title TEXT,
  translated_excerpt TEXT,
  translated_body TEXT,
  translated_meta_title TEXT,
  translated_meta_description TEXT,
  translation_status TEXT NOT NULL DEFAULT 'pending',
  automatic_check_status TEXT NOT NULL DEFAULT 'pending',
  automatic_check_report_json TEXT,
  translation_recheck_status TEXT NOT NULL DEFAULT 'not_checked',
  translation_recheck_score REAL,
  accuracy_score REAL,
  fluency_score REAL,
  term_score REAL,
  back_translation_th TEXT,
  recheck_summary_th TEXT,
  recheck_issues_json TEXT,
  recheck_model TEXT,
  rechecked_at TEXT,
  repair_attempt_count INTEGER NOT NULL DEFAULT 0,
  stale_flag INTEGER NOT NULL DEFAULT 0,
  translator_engine TEXT,
  translator_model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(source_published_article_id) REFERENCES published_articles(id) ON DELETE SET NULL,
  FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
  FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
  UNIQUE(source_content_item_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_source ON content_translations(source_content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_translations_lang ON content_translations(lang);
CREATE INDEX IF NOT EXISTS idx_content_translations_publishable ON content_translations(automatic_check_status, stale_flag, translation_status);

CREATE TABLE IF NOT EXISTS translation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT 'final-prefrontend',
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);





CREATE TABLE IF NOT EXISTS search_enrichment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  query TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  ingestion_mode TEXT NOT NULL DEFAULT 'manual',
  top_results_json TEXT,
  official_urls_json TEXT,
  web_presence_score REAL,
  content_gap_score REAL,
  entity_confidence_score REAL,
  search_angle_hints_json TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_search_enrichment_item ON search_enrichment_records(content_item_id);
CREATE INDEX IF NOT EXISTS idx_search_enrichment_created ON search_enrichment_records(created_at DESC);

CREATE TABLE IF NOT EXISTS place_intelligence_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  rating_score REAL NOT NULL DEFAULT 0,
  review_volume_score REAL NOT NULL DEFAULT 0,
  visual_score REAL NOT NULL DEFAULT 0,
  content_gap_score REAL NOT NULL DEFAULT 0,
  priority_score REAL NOT NULL DEFAULT 0,
  score_mode TEXT NOT NULL DEFAULT 'maps_only',
  why_selected_json TEXT,
  best_content_angles_json TEXT,
  recommended_action TEXT NOT NULL DEFAULT 'monitor',
  payload_json TEXT,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_place_intelligence_item ON place_intelligence_scores(content_item_id);
CREATE INDEX IF NOT EXISTS idx_place_intelligence_priority ON place_intelligence_scores(priority_score DESC, computed_at DESC);

CREATE TABLE IF NOT EXISTS social_signal_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  ingestion_mode TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  external_id TEXT,
  published_at TEXT,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  author_label TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_social_signal_item ON social_signal_sources(content_item_id);
CREATE INDEX IF NOT EXISTS idx_social_signal_platform ON social_signal_sources(platform);
CREATE INDEX IF NOT EXISTS idx_social_signal_published ON social_signal_sources(published_at DESC);

CREATE TABLE IF NOT EXISTS social_momentum_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  engagement_score REAL NOT NULL DEFAULT 0,
  recency_score REAL NOT NULL DEFAULT 0,
  momentum_score REAL NOT NULL DEFAULT 0,
  momentum_reason TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_social_momentum_item ON social_momentum_snapshots(content_item_id);
CREATE INDEX IF NOT EXISTS idx_social_momentum_platform ON social_momentum_snapshots(platform);
CREATE INDEX IF NOT EXISTS idx_social_momentum_snapshot_date ON social_momentum_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS content_direction_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  priority_band TEXT NOT NULL DEFAULT 'low',
  direction_status TEXT NOT NULL DEFAULT 'weak_signal',
  primary_angle TEXT,
  secondary_angles_json TEXT,
  why_now_json TEXT,
  why_not_now_json TEXT,
  recommended_next_action TEXT NOT NULL DEFAULT 'hold',
  recommended_capture_plan_json TEXT,
  recommended_content_formats_json TEXT,
  signal_summary_json TEXT,
  gaps_json TEXT,
  payload_json TEXT,
  computed_from_mode TEXT NOT NULL DEFAULT 'maps_only',
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_direction_item ON content_direction_reports(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_direction_priority ON content_direction_reports(priority_band, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_direction_status ON content_direction_reports(direction_status, computed_at DESC);

CREATE TABLE IF NOT EXISTS content_workflow_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL UNIQUE,
  production_state TEXT NOT NULL DEFAULT 'collected',
  publication_state TEXT NOT NULL DEFAULT 'draft',
  assignment_state TEXT,
  current_draft_id INTEGER,
  current_review_report_id INTEGER,
  current_field_pack_id INTEGER,
  state_version INTEGER NOT NULL DEFAULT 1,
  content_version INTEGER NOT NULL DEFAULT 0,
  last_actor_email TEXT,
  last_transition_at TEXT,
  last_transition_note TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_production ON content_workflow_models(production_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_publication ON content_workflow_models(publication_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_assignment ON content_workflow_models(assignment_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_draft ON content_workflow_models(current_draft_id);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_review ON content_workflow_models(current_review_report_id);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_field_pack ON content_workflow_models(current_field_pack_id);

CREATE TABLE IF NOT EXISTS content_workflow_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  assignment_id INTEGER,
  state_group TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_email TEXT,
  actor_role TEXT,
  reason_code TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_item ON content_workflow_transitions(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_group ON content_workflow_transitions(state_group, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_actor ON content_workflow_transitions(actor_email, created_at DESC);

CREATE TABLE IF NOT EXISTS content_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_uid TEXT NOT NULL UNIQUE,
  content_item_id INTEGER NOT NULL,
  assignment_kind TEXT NOT NULL DEFAULT 'field',
  assignee_user_id INTEGER,
  assignee_name TEXT,
  assignee_contact TEXT,
  external_assignee_profile_json TEXT,
  assigned_by_user_id INTEGER,
  state TEXT NOT NULL DEFAULT 'assigned',
  brief_json TEXT,
  requirements_json TEXT,
  due_at TEXT,
  latest_submission_id INTEGER,
  latest_submission_at TEXT,
  revision_round INTEGER NOT NULL DEFAULT 0,
  contributor_note TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(assignee_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_assignments_item ON content_assignments(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_assignments_assignee ON content_assignments(assignee_user_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_assignments_state ON content_assignments(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS content_assignment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  submitted_by_user_id INTEGER NOT NULL,
  submission_state TEXT NOT NULL DEFAULT 'submitted',
  article_payload_json TEXT,
  media_payload_json TEXT,
  field_return_payload_json TEXT,
  contributor_note TEXT,
  reviewer_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON content_assignment_submissions(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_item ON content_assignment_submissions(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_state ON content_assignment_submissions(submission_state, created_at DESC);

CREATE TABLE IF NOT EXISTS content_assignment_submission_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  submission_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  deliverable_type TEXT NOT NULL,
  title TEXT,
  lang TEXT NOT NULL DEFAULT 'th',
  text_content TEXT,
  payload_json TEXT,
  source_asset_id INTEGER,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(submission_id) REFERENCES content_assignment_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_submission ON content_assignment_submission_deliverables(submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_assignment ON content_assignment_submission_deliverables(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_submission_deliverables_type ON content_assignment_submission_deliverables(deliverable_type, created_at DESC);

CREATE TABLE IF NOT EXISTS content_intelligence_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'v1',
  quality_score REAL,
  popularity_score REAL,
  momentum_score REAL,
  confidence_score REAL,
  source_coverage_signal REAL,
  fact_completeness_signal REAL,
  official_presence_signal REAL,
  review_presence_signal REAL,
  social_presence_signal REAL,
  visual_signal REAL,
  local_uniqueness_signal REAL,
  content_gap_signal REAL,
  evidence_summary_json TEXT,
  signals_json TEXT,
  scores_json TEXT,
  niche_json TEXT,
  gaps_json TEXT,
  next_actions_json TEXT,
  brief_json TEXT,
  readiness_json TEXT,
  reasons_json TEXT,
  payload_json TEXT,
  computed_by TEXT,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_intelligence_item ON content_intelligence_models(content_item_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_intelligence_quality ON content_intelligence_models(quality_score DESC, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_intelligence_momentum ON content_intelligence_models(momentum_score DESC, computed_at DESC);

CREATE TABLE IF NOT EXISTS content_readiness_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  readiness_json TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  reasons_json TEXT,
  blockers_json TEXT,
  missing_requirements_json TEXT,
  computed_from_model_id INTEGER,
  computed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(computed_from_model_id) REFERENCES content_intelligence_models(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_readiness_briefs_item ON content_readiness_briefs(content_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_execution_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  source_readiness_brief_id INTEGER NOT NULL,
  source_intelligence_model_id INTEGER,
  must_include_points_json TEXT NOT NULL,
  must_avoid_points_json TEXT NOT NULL,
  blockers_json TEXT,
  missing_requirements_json TEXT,
  reasons_json TEXT,
  payload_json TEXT,
  computed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(source_readiness_brief_id) REFERENCES content_readiness_briefs(id) ON DELETE CASCADE,
  FOREIGN KEY(source_intelligence_model_id) REFERENCES content_intelligence_models(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_controls_item ON content_execution_controls(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_controls_readiness ON content_execution_controls(source_readiness_brief_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_submission_snapshots (
  submission_id TEXT PRIMARY KEY,
  content_item_id INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_review_submission_snapshots_item
ON review_submission_snapshots(content_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_submission_snapshots_item_hash
ON review_submission_snapshots(content_item_id, manifest_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_submission_snapshots_active_item
ON review_submission_snapshots(content_item_id)
WHERE superseded_at IS NULL;
CREATE TABLE IF NOT EXISTS content_execution_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  source_readiness_brief_id INTEGER,
  channel TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'th',
  derived_controls_json TEXT,
  recommended_version_json TEXT,
  alternatives_json TEXT,
  validation_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(source_readiness_brief_id) REFERENCES content_readiness_briefs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_execution_channels_item ON content_execution_channels(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_execution_channels_item_channel ON content_execution_channels(content_item_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_execution_channels_channel_status ON content_execution_channels(channel, status, created_at DESC);

CREATE TABLE IF NOT EXISTS content_assignment_handoff_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  content_item_id INTEGER NOT NULL,
  readiness_brief_id INTEGER,
  handoff_package_json TEXT NOT NULL,
  guard_status TEXT NOT NULL DEFAULT 'ready',
  force_reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(assignment_id) REFERENCES content_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(readiness_brief_id) REFERENCES content_readiness_briefs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_handoff_assignment ON content_assignment_handoff_snapshots(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_handoff_item ON content_assignment_handoff_snapshots(content_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_feature_policies (
  feature_key TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_feature_policies_updated_at ON ai_feature_policies(updated_at DESC);
