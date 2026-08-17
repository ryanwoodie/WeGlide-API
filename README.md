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
- `/api/check-flights` is the lightweight target for the external five-minute poll. When it detects a new flight, it dispatches the serialized `update-on-flight.yml` workflow.
- `/api/trigger-update` accepts authenticated POST requests from the scheduled GitHub workflows and invokes the update pipeline.
- `/api/fetch-and-build` fetches new flight details, rebuilds the leaderboard, persists the large season dataset and update marker in Vercel Blob, and syncs smaller generated artifacts back to GitHub.
- Immediate updates use `newOnly=true`, avoiding the daily re-analysis and recent-flight refresh work. The daily and weekly workflows retain those maintenance passes.

Required production env vars:

- `UPDATE_TOKEN`
- `GITHUB_TOKEN` with repository contents and Actions workflow permissions
- `BLOB_READ_WRITE_TOKEN`
- `SEASON_START`
- `SEASON_END`

Optional fallback env vars:

- `ENABLE_BLOB_FALLBACK` for non-dataset fallback reads

## Local-Only Material

Scratch files, archived prototypes, AI chat logs, and other working notes belong in ignored paths such as `.local_archive/`, `.claude/`, `.gemini/`, and `.history/`.
