# Taxonomy v1 Scope

Last Updated: 2026-06-20

## Scope

This document closes the CTA/contact milestone on `feature/taxonomy-catalog-resolver` and records the approved planning baseline for Taxonomy v1.

Implementation note:
- The taxonomy code present at commit `372bb50` is implementation scaffolding.
- Its current defaults are not the approved final Taxonomy v1 catalog.
- Final catalog implementation belongs to `feature/taxonomy-v1-catalog`.

## CTA Milestone Final Contract

- CTA/contact is separate from taxonomy.
- CTA/contact is place-only.
- Standard CTA checks are always requested for place:
  - `phone`
  - `line_url`
  - `facebook_url`
  - `website_url`
  - `primary_cta`
- `requested=true` means a human must verify the field, including confirming false, absent, or not found.
- AI may suggest values, but AI cannot confirm CTA facts.
- Work Return and human review remain the confirmation source.
- Existing issued assignment snapshots remain immutable.

## Boundary Between CTA And Taxonomy

CTA:
- human-verified contact/call-to-action fields for place items
- confirmed through Work Return and human review

Taxonomy:
- structured, filterable, human-confirmed factual facets for the approved category matrix
- used later for internal Homepage Signals / Content Pool filtering only

Excluded from taxonomy:
- coordinates
- map identity/link fields
- Google Maps opening hours
- CTA/contact fields

## Required Versus Agent-Triggered

- `required` means the field worker must answer the check.
- `required` does not mean the value must be true.
- `agent-triggered` means the key is approved in the catalog, but the Field Pack Agent adds it only when the context makes it relevant.
- AI may activate approved Agent-triggered catalog keys and may provide suggested values.
- AI must not create canonical unknown keys, override catalog schema, or remove required defaults.

## Taxonomy v1 Approved Category Matrix

### Attractions

Required:
- `parking`
- `pet_friendly`
- `wheelchair_accessible`
- `toilet_available`
- `entry_fee_required`
- `setting_type`

Agent-triggered:
- `waterfront`
- `child_friendly`
- `swimming_allowed`
- `hiking_required`
- `religious_dress_code`

### Activities

Required:
- `booking_required`
- `price_level`
- `average_price_per_person`
- `typical_duration`
- `physical_difficulty`
- `age_restriction`
- `equipment_provided`
- `weather_dependent`

Agent-triggered:
- `guide_available`
- `private_group_available`
- `parking`
- `wheelchair_accessible`
- `child_friendly`

### Hotels

Required:
- `parking`
- `pet_friendly`
- `air_conditioning`
- `price_level`
- `wifi_available`
- `breakfast_available`
- `swimming_pool`
- `wheelchair_accessible`

Agent-triggered:
- `family_room_available`
- `airport_shuttle`
- `onsite_restaurant`
- `gym_available`
- `meeting_room_available`
- `waterfront`

### Cafes

Required:
- `price_level`
- `average_price_per_person`
- `air_conditioning`
- `parking`
- `outdoor_seating`
- `pet_friendly`
- `work_power_outlets`
- `wifi_available`

Agent-triggered:
- `waterfront`
- `specialty_coffee`
- `meal_available`
- `kids_area`
- `reservation_available`

### Restaurants

Required:
- `price_level`
- `average_price_per_person`
- `air_conditioning`
- `parking`
- `outdoor_seating`
- `pet_friendly`
- `reservation_available`
- `dietary_options`

Agent-triggered:
- `waterfront`
- `private_room_available`
- `group_seating_available`
- `delivery_available`

### Transport

Required:
- `booking_required`
- `pricing_model`
- `service_scope`
- `luggage_supported`
- `air_conditioning`
- `wheelchair_accessible`

Agent-triggered:
- `cashless_payment`
- `airport_transfer`
- `charter_available`
- `child_seat_available`
- `pet_transport_allowed`

## Existing Eight Key Disposition

- `waterfront`: agent-triggered for attractions, hotels, cafes, restaurants
- `price_level`: required for activities, hotels, cafes, restaurants
- `average_price_per_person`: required for activities, cafes, restaurants
- `air_conditioning`: required for hotels, cafes, restaurants, transport
- `parking`: required for attractions, hotels, cafes, restaurants; agent-triggered for activities
- `outdoor_seating`: required for cafes, restaurants
- `pet_friendly`: required for attractions, hotels, cafes, restaurants
- `work_power_outlets`: required for cafes

## custom.* Disabled Policy

- No new `custom` requested-check groups.
- No new `custom.*` keys.
- No new UI creation for custom requested checks.
- Field Pack Agent must not output or route unknown taxonomy ideas into `custom.*`.
- Do not include any `custom` group or `custom.*` row in newly created handoff snapshots, including legacy stored rows.
- No canonical taxonomy projection from `custom.*`.
- No Homepage Signals filtering from `custom.*`.
- Preserve legacy custom data at rest.
- Already-issued immutable snapshots containing custom checks remain readable and returnable for compatibility.
- Do not delete legacy stored data.

## Unknown Observation Flow

- Unknown/non-catalog ideas do not become catalog keys automatically.
- They go to:
  - handoff guidance
  - `must_ask_question`
  - Work Return additional notes
- These observations are writer/editor consideration only.
- They do not enter canonical taxonomy facts.
- They are not available for Homepage Signals filtering.

## Canonical Work Return Contract

- `field_return_payload_json.requested_check_returns` remains the canonical Work Return payload.
- `condition_note` remains unchanged.
- Do not create a second Work Return payload.

## Next Implementation Phases

1. Build the final Taxonomy v1 catalog on `feature/taxonomy-v1-catalog`.
2. Add final catalog metadata per key:
   - Thai label
   - answer type
   - category applicability
   - condition prompt
   - evidence requirement
   - downstream filtering use
3. Complete backend curated taxonomy storage/filtering.
4. Bridge confirmed taxonomy facts into internal Homepage Signals / Content Pool filtering.
5. Keep public homepage behavior unchanged and keep human selection manual.
