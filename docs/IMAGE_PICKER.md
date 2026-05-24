# Content Image Picker

## Purpose
Allow editors to manually pick approved images from Media Library for content.

## Implemented
- Place editor: pick and queue `cover/gallery/inline` usage
- Event editor: pick and queue `cover/gallery/inline` usage
- Cover usage can sync to legacy `image` field for compatibility

## Data Model
- Usage links are saved in `content_image_usages`
- `cover/gallery/inline` is stored as `usage_type`
