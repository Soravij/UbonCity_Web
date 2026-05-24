# Media Library

## Purpose
Store collected images as raw assets before any content attachment.

## Key Entities
- `media_assets`: source URL, checksum, status, metadata, storage fields
- `content_image_usages`: relation between asset and entity (`place`, `event`, `article`) with usage type (`cover`, `gallery`, `inline`)

## Review States
- `pending`
- `approved`
- `rejected`
- `archived`

## Notes
- Admin can review, edit metadata, approve/reject, and delete assets.
- Raw assets are not auto-attached to content.
