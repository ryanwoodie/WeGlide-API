# Repository Guidelines

## Project Structure & Module Organization
- Root Node scripts drive the Canadian pipeline. `fetch_canadian_flights.js` and the Vercel updater ingest raw WeGlide exports; `create_canadian_leaderboard_from_jsonl.js` emits the HTML and JSON artifacts served from `public/`.
- Runtime persistence files such as `canadian_flights_2026_details.jsonl` and `canadian_user_profiles.json` live at the repo root because the Vercel update path syncs them back to GitHub.
- Public deployment assets live in `public/`. Local scratch, archived prototypes, and AI/tooling files belong in ignored locations such as `.local_archive/`, `.history/`, `.claude/`, and `.gemini/`.

## Build, Test, and Development Commands
- `npm install` — install `firebase-admin` prior to running Node utilities.
- `node fetch_canadian_flights.js` — fetch the Canadian season dataset from WeGlide.
- `node fetch_user_profiles.js canadian_flights_2026_details.jsonl canadian_user_profiles.json` — refresh cached pilot profiles.
- `node fetch_user_durations.js canadian_flights_2026_details.jsonl canadian_user_durations.json` — refresh cached pilot duration totals.
- `node create_canadian_leaderboard_from_jsonl.js` — rebuild `SAC_leaderboard.html`, `SAC_leaderboard_sac_dsc.html`, and `leaderboard_data.json`.

## Coding Style & Naming Conventions
- Follow the established Node style: 4-space indents, single quotes, synchronous `fs` reads, and explicit progress logging for long jobs.
- Keep comments focused on non-obvious math (e.g., DMSt multipliers) and maintain predictable file names so automation can glob inputs without extra directories.

## Testing Guidelines
- Run the relevant local builders after data or scoring changes and inspect the generated artifacts in `public/`.
- Verify the deployed update path with `/api/check-flights` and, when needed, an authenticated POST to `/api/trigger-update`.

## Commit & Pull Request Guidelines
- Use the Conventional Commit prefixes already in history (`feat:`, `fix:`) and add scopes when touching a specific script or dataset.
- Capture data refresh context (API filters, pull date, manual edits) plus updated screenshots in PR descriptions, and list the pipeline commands executed for reproducibility.

## Security & Configuration Tips
- Keep tokens, local chat logs, and AI/editor settings out of Git. Use `.env*.local`, `.local_archive/`, `.claude/`, and `.gemini/` for machine-local material.
- Do not expose debug-only endpoints or temporary diagnostics in `api/` without authentication and a clear need.
