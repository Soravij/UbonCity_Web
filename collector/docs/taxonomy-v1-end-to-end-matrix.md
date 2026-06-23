# Taxonomy V1 End-To-End Matrix

Static acceptance status: COMPLETE
Runtime acceptance: PENDING

This document is static-only. It proves catalog parity, closure matrix completeness, and source contract markers.
It does not claim runtime acceptance.

Collector owns the human confirmation workflow.
Backend owns published storage and filtering.
AI suggestions never auto-confirm taxonomy facts.
Issued assignment snapshots remain immutable.
Public homepage behavior remains unchanged.
Homepage selection remains human-controlled.

## Canonical Transport Contract

Collector catalog
→ requested checks / assignment snapshot
→ Work Return requested_check_returns
→ accepted field review snapshot.confirmed_taxonomy_json
→ Collector review ingest mapping sends the accepted snapshot as handoff_snapshot_json
→ Backend review ingest stores review_contents.handoff_snapshot_json
→ approval reads handoff_snapshot_json.confirmed_taxonomy_json
→ places.curated_taxonomy_json
→ GET /api/homepage-curation/candidates
→ Admin Signals / Content Pool taxonomy_filters

`review_source_kind` identifies review source integrity.
`handoff_snapshot_json` is the immutable review transport/storage container.
Neither is a canonical taxonomy fact itself.

## Source Contract Markers

| Layer | File | Marker | Status |
| --- | --- | --- | --- |
| Collector accepted snapshot | `collector/tests/review-ingest-handoff-snapshot.behavior.test.mjs` | `confirmed_taxonomy_json` | VERIFIED |
| Collector review mapping | `collector/server/review-ingest-mapping.mjs` | `buildAcceptedFieldReviewSnapshotByItem`, `handoff_snapshot_json` | VERIFIED |
| Backend review storage | `backend/services/reviewIngestService.js` | `handoffSnapshotJson`, `handoff_snapshot_json` | VERIFIED |
| Backend storage schema | `backend/migrations/012_review_contents.sql` | `handoff_snapshot_json` | VERIFIED |
| Backend approval extraction | `backend/services/reviewDecisionService.js` | `confirmed_taxonomy_json`, `curated_taxonomy_json`, `extractCuratedTaxonomyFromReviewSnapshot` | VERIFIED |
| Homepage candidate service | `backend/services/homepageCurationService.js` | `curated_taxonomy_json` | VERIFIED |
| Candidate controller | `backend/controllers/homepageCurationController.js` | `taxonomy_filters` | VERIFIED |
| Admin consumer | `admin/src/pages/HomepageCuration.jsx` | `taxonomy_filters` | VERIFIED |

## Canonical Key Matrix

| Taxonomy key | Applicable categories | Answer type | Confirmed snapshot source | Backend review storage | Published destination | Internal consumer | Static status | Runtime status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `age_restriction` | activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `air_conditioning` | hotels, cafes, restaurants, transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `airport_shuttle` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `airport_transfer` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `average_price_per_person` | activities, cafes, restaurants | number_with_unit | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `booking_required` | activities, transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `breakfast_available` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `cashless_payment` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `charter_available` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `child_friendly` | attractions, activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `child_seat_available` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `delivery_available` | restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `dietary_options` | restaurants | multi_select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `entry_fee_required` | attractions | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `equipment_provided` | activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `family_room_available` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `group_seating_available` | restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `guide_available` | activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `gym_available` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `hiking_required` | attractions | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `kids_area` | cafes | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `luggage_supported` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `meal_available` | cafes | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `meeting_room_available` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `onsite_restaurant` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `outdoor_seating` | cafes, restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `parking` | attractions, activities, hotels, cafes, restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `pet_friendly` | attractions, hotels, cafes, restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `pet_transport_allowed` | transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `physical_difficulty` | activities | select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `price_level` | activities, hotels, cafes, restaurants | select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `pricing_model` | transport | select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `private_group_available` | activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `private_room_available` | restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `religious_dress_code` | attractions | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `reservation_available` | cafes, restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `service_scope` | transport | multi_select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `setting_type` | attractions | select | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `specialty_coffee` | cafes | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `swimming_allowed` | attractions | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `swimming_pool` | hotels | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `toilet_available` | attractions | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `typical_duration` | activities | number_with_unit | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `waterfront` | attractions, cafes, hotels, restaurants | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `weather_dependent` | activities | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `wheelchair_accessible` | attractions, activities, hotels, transport | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `wifi_available` | hotels, cafes | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |
| `work_power_outlets` | cafes | boolean_with_conditions | accepted field review snapshot.confirmed_taxonomy_json | review_contents.handoff_snapshot_json | places.curated_taxonomy_json | Homepage Signals / Content Pool | VERIFIED | PENDING |

## Intentional Exclusions

| Excluded value | Reason | Storage compatibility | Homepage Signals availability |
| --- | --- | --- | --- |
| `category` | Legacy classification field, not curated taxonomy fact | Legacy stored values remain preserved | Not available |
| `subtype` | Legacy classification field, not curated taxonomy fact | Legacy stored values remain preserved | Not available |
| `tags` | Legacy classification field, not curated taxonomy fact | Legacy stored values remain preserved | Not available |
| `custom.*` | Disabled for new canonical taxonomy | Legacy stored values remain preserved | Not available |
| unknown/non-catalog observations | Guidance, `must_ask_question`, or Work Return additional notes only | Legacy observations remain preserved | Not available |
| Event taxonomy | Taxonomy v1 is place-only | Event workflows remain separate | Not available |

## Runtime Acceptance Checklist

Runtime acceptance status: PENDING

| Category | Representative item ID | Field Pack generated | Assignment issued | Work Return accepted | confirmed_taxonomy_json verified | Backend review ingest verified | Approval/published storage verified | Candidate API filter verified | Admin Content Pool verified | CTA path verified | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attractions | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| activities | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| hotels | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| cafes | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| restaurants | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| transport | TBD | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

## Static Acceptance Notes

- `confirmed_taxonomy_json` is the accepted snapshot taxonomy payload.
- `review_contents.handoff_snapshot_json` is the backend review storage container.
- `places.curated_taxonomy_json` is the published place destination.
- `taxonomy_filters` is the internal homepage candidate/admin consumer marker.
- No runtime evidence is claimed here.
- No production source files are modified by this document.
