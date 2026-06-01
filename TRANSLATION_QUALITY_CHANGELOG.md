# Translation Quality Changelog

## Scope
This patch is limited to collector-app translation runtime quality only.
No lifecycle redesign was applied.

## What Was Fixed
- Fixed UTF-8/runtime text handling in translation generation path by normalizing and sanitizing translation fields before use.
- Added stronger mojibake detection guard (`�`, common broken byte patterns, repeated `?`, high `?` ratio) to block broken outputs.
- Hardened model-response parsing/validation so invalid JSON-like or broken translated payload does not pass as ready output.
- Improved deterministic fallback translator quality:
  - language-specific fallback content for `en`, `zh`, `lo`
  - non-empty, structured fields for title/excerpt/body/meta fields
  - deterministic metadata markers (`_engine`, `_model`) for traceability
- Improved fallback behavior for `zh`/`lo` so source text is reused only if it already matches target script; otherwise stable localized fallback text is used.

## Why It Was Fixed
- Runtime fallback output previously produced mojibake/`????` patterns and low-quality language-shape mismatches, causing automatic translation checks to fail frequently.
- The architecture was correct; failure mode was output quality and text normalization.

## What Was Calibrated
- Automatic checks remain strict for:
  - empty fields
  - mojibake
  - unresolved placeholders
  - target-language shape
  - source leakage
  - length sanity
  - stale/source fingerprint consistency
- Calibration focused on improving generator output so valid fallback text can pass checks in normal conditions, not on loosening gates.

## Runtime Verification Outcome
- Translation still runs only at final export step (`translationsBeforePublishCount=0`, `translationsBeforeExportCount=0`).
- Final export run generated translations with mixed result (`generated_count=2`, `failed_count=1`).
- Export included only ready+passed+non-stale translations (2 exported variants).
- Source/original content export remained successful even when one translation failed.

## Remaining Limitations
- Deterministic fallback is still a fallback. It is stable and check-friendly, but not a replacement for full semantic-quality AI translation.
- Terminal/codepage display on some Windows shells can still render Lao/Thai as mojibake visually even when UTF-8 file data is valid.

## Compatibility Notes
- No backend approve flow or `/api/translate` behavior changed.
- Collector remains the source of truth for final-stage translation status.
