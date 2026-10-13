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
node fetch_user_profiles.js canadian_flights_2027_details.jsonl canadian_user_profiles.json
node fetch_user_durations.js canadian_flights_2027_details.jsonl canadian_user_durations.json
node create_canadian_leaderboard_from_jsonl.js
```

The default season is 2026–27. The season picker switches between 2026–27 and the archived 2025–26 board. Build the archive with `SEASON_ID=2025-26 node create_canadian_leaderboard_from_jsonl.js`; its artifacts are written under `public/seasons/2025-26/`. Regenerate `season_flight_hours_2025_26.json` with `node build_season_flight_hours.js` after updating the historical flight dataset.

The Under 200 Hours estimate for 2026–27 uses October 1, 2026 as its cutoff. Pilots who verified their October 1, 2025 PIC hours start from that confirmed total plus their 2025–26 WeGlide flight hours; this is still an estimate until the new cutoff is verified. A confirmed 200+ PIC total from 2025–26 stays excluded in 2026–27. New PIC verifications and notifications are keyed by season; existing 2025–26 records remain intact.

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

Season dates are defined in `lib/seasons.js`; legacy `SEASON_START` and `SEASON_END` deployment variables are ignored by the updater.

Optional fallback env vars:

- `ENABLE_BLOB_FALLBACK` for non-dataset fallback reads

## Local-Only Material

Scratch files, archived prototypes, AI chat logs, and other working notes belong in ignored paths such as `.local_archive/`, `.claude/`, `.gemini/`, and `.history/`.

### Silver C-Gull calendar candidates

The Silver C-Gull view is an unofficial list of WeGlide-detected Silver achievements, grouped by calendar year (January 1–December 31), independently of the soaring-season selector. Both season pages load the shared calendar candidates from the current data endpoint. Candidates are assigned to the year of their earliest stored WeGlide Silver achievement; repeated detections do not create a new candidate in a later year. The stored season datasets cover full calendar-year history starting in 2026, so 2025 is not offered as a complete year.

Age verification only establishes the order of these candidates. It does not confirm an official FAI badge or trophy eligibility, and the list may omit claims submitted outside WeGlide. Pilots must submit their official badge claim through SAC. The UI links to [SAC FAI badge requirements and directions](https://sac.ca/fai-badges/); SAC badge and trophy coordinators confirm official eligibility and the award recipient. Birth dates and numeric ages remain excluded from public data; candidates are sorted by age at achievement.

### OLC identity review emails

Each update checks cached WeGlide profiles for possible OLC matches, including when no new flights arrive. The review heuristic accepts shared surnames with shared or partial given names, common nicknames, or matching initials; a single-character difference in a long surname also requires a shared given name. Suggestions never apply OLC hours or alter pilot verifications automatically.

One digest (up to 20 pilots per update, up to three suggestions each) goes to `sacleaderboard@gmail.com` through the existing Gmail delivery service. It contains WeGlide profile links, both pilot IDs, match reasons, and the OLC snapshot hours and cutoff. The recipient can reply with confirmed ID pairs for manual mapping, or flag incorrect suggestions. Reply processing is manual; there is no email-driven automatic approval.

The original OLC name index is used when the current season cache contains only linked totals. Previously linked IDs are retained for review purposes even when a later export omits them. Notification fingerprints are stored in the encrypted verification state, so unchanged suggestions are not repeatedly emailed. Failed sends remain eligible for retry. This notification state is excluded from the public verification API.

### Confirmed OLC identity mappings

Operator-confirmed WeGlide/OLC ID pairs are stored in `olc_pilot_match_overrides.json`. The SQLite synchronization script imports these pairs into `pilot_match_overrides` on rebuild, so they survive future name changes and matching-table rebuilds. The five initial pairs were confirmed on October 13, 2026, and their WeGlide profiles and flights were refreshed against the existing OLC snapshot for the October 1, 2025 and October 1, 2026 cutoffs. Only those five entries were added to each season cache; pilot-submitted PIC verifications retain priority.

Confirmed matches use their calculated pre-cutoff hours for eligibility, keeping the baseline fixed as later flights are logged. The identity-review email heuristic skips already linked pairs.
