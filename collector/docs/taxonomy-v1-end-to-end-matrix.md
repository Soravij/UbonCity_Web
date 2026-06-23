# Taxonomy V1 End-To-End Matrix

Static acceptance status: COMPLETE
Runtime acceptance status: PENDING

This document is static-only. It proves catalog parity, closure matrix completeness, and source contract markers.
It does not claim runtime acceptance.

## Scope Summary

- Taxonomy v1 categories are place-only.
- Canonical taxonomy keys are the approved catalog keys in the collector catalog and backend key list.
- `category`, `subtype`, `tags`, and `custom.*` remain excluded from canonical taxonomy facts.
- Published homepage behavior is unchanged by this document.
- PR `#25` remains Draft.

## Canonical Source Contract

collector catalog:
`collector/server/taxonomy-catalog.mjs`

collector handoff marker:
`collector/server/review-ingest-mapping.mjs`

backend ingest marker:
`backend/services/reviewIngestService.js`

backend approval marker:
`backend/services/reviewDecisionService.js`

homepage candidate marker:
`backend/services/homepageCurationService.js`

candidate controller marker:
`backend/controllers/homepageCurationController.js`

homepage curation route marker:
`backend/routes/homepageCurationRoutes.js`

admin consumer marker:
`admin/src/pages/HomepageCuration.jsx`

Canonical static chain:
`taxonomy catalog -> requested checks -> requested_check_returns -> confirmed_taxonomy_json -> review_source_kind -> handoff_snapshot_json -> review_contents -> curated_taxonomy_json -> homepage candidates -> admin taxonomy_filters`

## Source Contract Markers

| Layer | File | Marker | Status |
| --- | --- | --- | --- |
| Collector catalog | `collector/server/taxonomy-catalog.mjs` | approved category matrix, place-only item types, downstream consumers | VERIFIED |
| Collector handoff | `collector/server/review-ingest-mapping.mjs` | `review_source_kind` | VERIFIED |
| Backend ingest | `backend/services/reviewIngestService.js` | `review_source_kind`, `handoff_snapshot_json` | VERIFIED |
| Backend approval | `backend/services/reviewDecisionService.js` | `curated_taxonomy_json` | VERIFIED |
| Homepage candidate service | `backend/services/homepageCurationService.js` | `curated_taxonomy_json` | VERIFIED |
| Candidate controller | `backend/controllers/homepageCurationController.js` | `taxonomy_filters` | VERIFIED |
| Homepage curation routes | `backend/routes/homepageCurationRoutes.js` | `protect, authorizeAdmin` and candidate/taxonomy-options routes | VERIFIED |
| Admin consumer | `admin/src/pages/HomepageCuration.jsx` | `taxonomy_filters` | VERIFIED |

## Category Closure Summary

| Category | Required keys | Agent-triggered keys | Static status | Runtime status |
| --- | --- | --- | --- | --- |
| attractions | 6 | 5 | VERIFIED | PENDING |
| activities | 8 | 5 | VERIFIED | PENDING |
| hotels | 8 | 6 | VERIFIED | PENDING |
| cafes | 8 | 5 | VERIFIED | PENDING |
| restaurants | 8 | 4 | VERIFIED | PENDING |
| transport | 6 | 5 | VERIFIED | PENDING |

## Taxonomy Key Closure Matrix

| Key | Applicable categories | Activation mode by category | Answer type | Closure status |
| --- | --- | --- | --- | --- |
| age_restriction | activities | required: activities | boolean_with_conditions | YES |
| air_conditioning | hotels, cafes, restaurants, transport | required: hotels, cafes, restaurants, transport | boolean_with_conditions | YES |
| airport_shuttle | hotels | agent-triggered: hotels | boolean_with_conditions | PARTIAL |
| airport_transfer | transport | agent-triggered: transport | boolean_with_conditions | PARTIAL |
| average_price_per_person | activities, cafes, restaurants | required: activities, cafes, restaurants | number_with_unit | YES |
| booking_required | activities, transport | required: activities, transport | boolean_with_conditions | YES |
| breakfast_available | hotels | required: hotels | boolean_with_conditions | YES |
| cashless_payment | transport | agent-triggered: transport | boolean_with_conditions | PARTIAL |
| charter_available | transport | agent-triggered: transport | boolean_with_conditions | PARTIAL |
| child_friendly | attractions, activities | agent-triggered: attractions, activities | boolean_with_conditions | PARTIAL |
| child_seat_available | transport | agent-triggered: transport | boolean_with_conditions | PARTIAL |
| delivery_available | restaurants | agent-triggered: restaurants | boolean_with_conditions | PARTIAL |
| dietary_options | restaurants | required: restaurants | multi_select | YES |
| entry_fee_required | attractions | required: attractions | boolean_with_conditions | YES |
| equipment_provided | activities | required: activities | boolean_with_conditions | YES |
| family_room_available | hotels | agent-triggered: hotels | boolean_with_conditions | PARTIAL |
| group_seating_available | restaurants | agent-triggered: restaurants | boolean_with_conditions | PARTIAL |
| guide_available | activities | agent-triggered: activities | boolean_with_conditions | PARTIAL |
| gym_available | hotels | agent-triggered: hotels | boolean_with_conditions | PARTIAL |
| hiking_required | attractions | agent-triggered: attractions | boolean_with_conditions | PARTIAL |
| kids_area | cafes | agent-triggered: cafes | boolean_with_conditions | PARTIAL |
| luggage_supported | transport | required: transport | boolean_with_conditions | YES |
| meal_available | cafes | agent-triggered: cafes | boolean_with_conditions | PARTIAL |
| meeting_room_available | hotels | agent-triggered: hotels | boolean_with_conditions | PARTIAL |
| onsite_restaurant | hotels | agent-triggered: hotels | boolean_with_conditions | PARTIAL |
| outdoor_seating | cafes, restaurants | required: cafes, restaurants | boolean_with_conditions | YES |
| parking | attractions, activities, hotels, cafes, restaurants | required: attractions, hotels, cafes, restaurants; agent-triggered: activities | boolean_with_conditions | PARTIAL |
| pet_friendly | attractions, hotels, cafes, restaurants | required: attractions, hotels, cafes, restaurants | boolean_with_conditions | YES |
| pet_transport_allowed | transport | agent-triggered: transport | boolean_with_conditions | PARTIAL |
| physical_difficulty | activities | required: activities | select | YES |
| price_level | activities, hotels, cafes, restaurants | required: activities, hotels, cafes, restaurants | select | YES |
| pricing_model | transport | required: transport | select | YES |
| private_group_available | activities | agent-triggered: activities | boolean_with_conditions | PARTIAL |
| private_room_available | restaurants | agent-triggered: restaurants | boolean_with_conditions | PARTIAL |
| religious_dress_code | attractions | agent-triggered: attractions | boolean_with_conditions | PARTIAL |
| reservation_available | cafes, restaurants | required: restaurants; agent-triggered: cafes | boolean_with_conditions | PARTIAL |
| service_scope | transport | required: transport | multi_select | YES |
| setting_type | attractions | required: attractions | select | YES |
| specialty_coffee | cafes | agent-triggered: cafes | boolean_with_conditions | PARTIAL |
| swimming_allowed | attractions | agent-triggered: attractions | boolean_with_conditions | PARTIAL |
| swimming_pool | hotels | required: hotels | boolean_with_conditions | YES |
| toilet_available | attractions | required: attractions | boolean_with_conditions | YES |
| typical_duration | activities | required: activities | number_with_unit | YES |
| waterfront | attractions, cafes, hotels, restaurants | agent-triggered: attractions, cafes, hotels, restaurants | boolean_with_conditions | PARTIAL |
| weather_dependent | activities | required: activities | boolean_with_conditions | YES |
| wheelchair_accessible | attractions, activities, hotels, transport | required: attractions, hotels, transport; agent-triggered: activities | boolean_with_conditions | PARTIAL |
| wifi_available | hotels, cafes | required: hotels, cafes | boolean_with_conditions | YES |
| work_power_outlets | cafes | required: cafes | boolean_with_conditions | YES |

## Runtime Acceptance Checklist

Runtime acceptance status: PENDING

| Category | Runtime fixture | Status |
| --- | --- | --- |
| attractions | representative place fixture | PENDING |
| activities | representative place fixture | PENDING |
| hotels | representative place fixture | PENDING |
| cafes | representative place fixture | PENDING |
| restaurants | representative place fixture | PENDING |
| transport | representative place fixture | PENDING |

## Static Acceptance Notes

- `confirmed_taxonomy_json` is the collector-to-backend bridge marker.
- `curated_taxonomy_json` is the backend approval bridge marker.
- `taxonomy_filters` is the internal homepage candidate/admin consumer marker.
- No runtime evidence is claimed here.
- No production source files are modified by this document.
