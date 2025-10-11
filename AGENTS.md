# Repository Guidelines

## Project Structure & Module Organization
- Root Node scripts (`process_leaderboard.js`, `enhance_leaderboard.js`, `embed_data.js`) drive the Canadian pipeline: ingest raw exports, enrich with flight detail, then embed the static HTML.
- Regional datasets stay beside the scripts; use lowercase underscore names such as `canadian_flights_2025.json`, adding `_enhanced` or `_embedded` for derived artifacts.
- The Australian leaderboard is regenerated exclusively through `create_australian_leaderboard_from_jsonl.js`; update that script, run it, and treat `australian_leaderboard.html` as read-only output. Support tooling (`qa_verify_scoring.py`, `setup_firebase*.js`, Firebase configs) sits nearby for scoring checks and verification badges.

## Build, Test, and Development Commands
- `npm install` — install `firebase-admin` prior to running Node utilities.
- `node process_leaderboard.js` — roll up `canadian_flights_2025.json` into `leaderboard_data.json` with the five-best flights per pilot.
- `node enhance_leaderboard.js` — fetch `/v1/flightdetail/{id}` records and emit `leaderboard_enhanced.json` with updated points.
- `node embed_data.js` — inline the enhanced payload into `canadian_leaderboard_2025_embedded.html` for offline use.
- `node create_australian_leaderboard_from_jsonl.js` — rebuild `australian_leaderboard.html` from `australian_flights_2025_details.jsonl` instead of editing the HTML manually.
- `python3 qa_verify_scoring.py` — recompute DMSt scores and flag deviations greater than 0.2 points.

## Coding Style & Naming Conventions
- Follow the established Node style: 4-space indents, single quotes, synchronous `fs` reads, and explicit progress logging for long jobs.
- Keep comments focused on non-obvious math (e.g., DMSt multipliers) and maintain predictable file names so automation can glob inputs without extra directories.

## Testing Guidelines
- Run `python3 qa_verify_scoring.py` after any scoring or handicap change and resolve mismatches before publishing data.
- Manually open `canadian_leaderboard_2025_embedded.html` or the regenerated Australian HTML to confirm totals, badges, and scoring toggles.

## Commit & Pull Request Guidelines
- Use the Conventional Commit prefixes already in history (`feat:`, `fix:`) and add scopes when touching a specific script or dataset.
- Capture data refresh context (API filters, pull date, manual edits) plus updated screenshots in PR descriptions, and list the pipeline commands executed for reproducibility.

## Security & Configuration Tips
- Keep Firebase credentials out of Git; authenticate through the CLI and supply WeGlide tokens via environment variables when running enrichment scripts.
- Test changes to `firestore.rules` in a staging project, then deploy with `firebase deploy --only firestore:rules` to avoid accidental write exposure.
