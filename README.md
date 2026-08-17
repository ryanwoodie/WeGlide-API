# SAC Leaderboard

Canadian gliding leaderboard tooling and the Vercel deployment that publishes `sac-leaderboard.vercel.app`.

## What Lives Here

- `api/` contains the Vercel serverless functions that serve the leaderboard and run the WeGlide update pipeline.
- `public/` contains the published HTML and JSON artifacts that the deployed site serves.
- `create_canadian_leaderboard_from_jsonl.js` builds the leaderboard HTML and API payload from the Canadian JSONL dataset.
- `fetch_canadian_flights.js`, `fetch_user_profiles.js`, and `fetch_user_durations.js` support local data refreshes.

## Core Commands

```bash
npm install
node fetch_canadian_flights.js
node fetch_user_profiles.js canadian_flights_2026_details.jsonl canadian_user_profiles.json
node fetch_user_durations.js canadian_flights_2026_details.jsonl canadian_user_durations.json
node create_canadian_leaderboard_from_jsonl.js
```

## Deployment Notes

- Production is hosted on Vercel.
- `/api/check-flights` performs an authenticated, read-only poll of WeGlide and the small `canadian_flights_update_state.json` marker. It never launches a rebuild.
- `/api/trigger-update` accepts authenticated POST requests from the scheduled GitHub workflows and invokes the update pipeline.
- `/api/fetch-and-build` fetches new flight details, rebuilds the leaderboard, updates the marker, and syncs the artifacts back to GitHub.

Required production env vars:

- `UPDATE_TOKEN`
- `GITHUB_TOKEN`
- `SEASON_START`
- `SEASON_END`

Optional fallback env vars:

- `BLOB_READ_WRITE_TOKEN`
- `ENABLE_BLOB_FALLBACK`

## Local-Only Material

Scratch files, archived prototypes, AI chat logs, and other working notes belong in ignored paths such as `.local_archive/`, `.claude/`, `.gemini/`, and `.history/`.
