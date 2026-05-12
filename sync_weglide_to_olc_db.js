#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_HEADERS = {
    'Accept': 'application/json',
    'Origin': 'https://www.weglide.org',
    'Referer': 'https://www.weglide.org/',
    'User-Agent': process.env.HTTP_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

const PROVINCE_PREFIXES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);

function parseArgs(argv) {
    const options = {
        dbPath: '',
        profilesPath: 'canadian_user_profiles.json',
        flightsPath: 'canadian_flights_2026_details.jsonl',
        userDirectoryPath: 'weglide_users_all.jsonl',
        exportCombinedHoursPath: '',
        cutoffDate: '',
        pilotIds: [],
        profileBatchSize: 50,
        userBatchSize: 25,
        flightPageSize: 100,
        delayMs: 200,
        refreshAll: false,
        rebuildOnly: false,
        maxPilots: 0
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--db') {
            options.dbPath = argv[++i] || '';
        } else if (arg === '--profiles') {
            options.profilesPath = argv[++i] || options.profilesPath;
        } else if (arg === '--flights') {
            options.flightsPath = argv[++i] || options.flightsPath;
        } else if (arg === '--user-directory') {
            options.userDirectoryPath = argv[++i] || options.userDirectoryPath;
        } else if (arg === '--export-combined-hours') {
            options.exportCombinedHoursPath = argv[++i] || '';
        } else if (arg === '--cutoff-date') {
            options.cutoffDate = argv[++i] || '';
        } else if (arg === '--pilot-ids') {
            options.pilotIds = String(argv[++i] || '')
                .split(',')
                .map(value => Number(String(value).trim()))
                .filter(value => Number.isInteger(value) && value > 0);
        } else if (arg === '--profile-batch-size') {
            options.profileBatchSize = Number(argv[++i] || options.profileBatchSize);
        } else if (arg === '--user-batch-size') {
            options.userBatchSize = Number(argv[++i] || options.userBatchSize);
        } else if (arg === '--flight-page-size') {
            options.flightPageSize = Number(argv[++i] || options.flightPageSize);
        } else if (arg === '--delay-ms') {
            options.delayMs = Number(argv[++i] || options.delayMs);
        } else if (arg === '--max-pilots') {
            options.maxPilots = Number(argv[++i] || 0);
        } else if (arg === '--refresh-all') {
            options.refreshAll = true;
        } else if (arg === '--rebuild-only') {
            options.rebuildOnly = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.dbPath) {
        throw new Error('Missing required --db <path>');
    }

    if (!Number.isInteger(options.profileBatchSize) || options.profileBatchSize < 1) {
        throw new Error('Invalid --profile-batch-size');
    }
    if (!Number.isInteger(options.userBatchSize) || options.userBatchSize < 1) {
        throw new Error('Invalid --user-batch-size');
    }
    if (!Number.isInteger(options.flightPageSize) || options.flightPageSize < 1 || options.flightPageSize > 100) {
        throw new Error('Invalid --flight-page-size (must be 1-100)');
    }

    return options;
}

function printHelp() {
    console.log('Usage: node sync_weglide_to_olc_db.js --db /path/to/olc_stats.sqlite [options]');
    console.log('');
    console.log('Options:');
    console.log('  --profiles <path>           WeGlide profile cache JSON (default: canadian_user_profiles.json)');
    console.log('  --flights <path>            WeGlide Canada flights JSONL seed (default: canadian_flights_2026_details.jsonl)');
    console.log('  --user-directory <path>     Full WeGlide user directory JSONL seed (default: weglide_users_all.jsonl)');
    console.log('  --pilot-ids <csv>           Only sync these WeGlide user IDs (comma-separated)');
    console.log('  --export-combined-hours <path>  Write combined-hours cache JSON for leaderboard use');
    console.log('  --cutoff-date <YYYY-MM-DD>  Combined-hours eligibility cutoff date');
    console.log('  --profile-batch-size <n>    Number of user profiles per /v1/user call (default: 50)');
    console.log('  --user-batch-size <n>       Number of pilot IDs per /v1/flight user_id_in batch (default: 25)');
    console.log('  --flight-page-size <n>      WeGlide flight page size, max 100 (default: 100)');
    console.log('  --delay-ms <n>              Delay between WeGlide requests (default: 200)');
    console.log('  --max-pilots <n>            Limit pilots synced in this run (for testing)');
    console.log('  --refresh-all               Re-fetch flights even if imported count matches WeGlide flight_count');
    console.log('  --rebuild-only              Skip WeGlide API sync and rebuild match/composite tables from DB');
}

function log(message) {
    console.log(`[weglide-sync] ${message}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function currentVerificationCutoffDate() {
    const now = new Date();
    const year = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    return `${year}-10-01`;
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function compactName(value) {
    return asciiName(value).replace(/[^a-z0-9]+/g, '');
}

function asciiName(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function nameParts(value) {
    return asciiName(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function firstNameFromParts(parts) {
    return parts.length ? parts[0] : null;
}

function lastNameFromParts(parts) {
    return parts.length ? parts[parts.length - 1] : null;
}

function sharedPrefixLength(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    let count = 0;
    while (count < a.length && count < b.length && a[count] === b[count]) {
        count += 1;
    }
    return count;
}

function isCanadianStateCode(stateCode) {
    if (!stateCode) return false;
    const prefix = String(stateCode).split('/')[0].trim().toUpperCase();
    return PROVINCE_PREFIXES.has(prefix);
}

function canadianPilotSql(alias) {
    return `(${alias}.nationality_code = 'CA' OR ` +
        `${alias}.state_code LIKE 'AB/%' OR ${alias}.state_code LIKE 'BC/%' OR ${alias}.state_code LIKE 'MB/%' OR ` +
        `${alias}.state_code LIKE 'NB/%' OR ${alias}.state_code LIKE 'NL/%' OR ${alias}.state_code LIKE 'NS/%' OR ` +
        `${alias}.state_code LIKE 'NT/%' OR ${alias}.state_code LIKE 'NU/%' OR ${alias}.state_code LIKE 'ON/%' OR ` +
        `${alias}.state_code LIKE 'PE/%' OR ${alias}.state_code LIKE 'QC/%' OR ${alias}.state_code LIKE 'SK/%' OR ` +
        `${alias}.state_code LIKE 'YT/%')`;
}

function isCanadianClubRegion(regionValue) {
    const normalized = String(regionValue || '').trim().toUpperCase().replace(/_/g, '-');
    return normalized.startsWith('CA-');
}

function isCanadianProfile(profile, canadaSeedIds) {
    if (!profile || typeof profile.id !== 'number') {
        return false;
    }
    if (canadaSeedIds.has(profile.id)) {
        return true;
    }
    return isCanadianClubRegion(profile?.club?.region);
}

function seasonYearFromDate(dateString) {
    if (!dateString) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 10 ? year + 1 : year;
}

function isoTimestampMs(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

function dateMs(value) {
    if (!value) return null;
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : null;
}

function durationSecondsFromFlight(flight) {
    const startMs = isoTimestampMs(flight?.takeoff_time);
    const endMs = isoTimestampMs(flight?.landing_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return null;
    }
    return Math.round((endMs - startMs) / 1000);
}

function splitDisplayName(displayName) {
    const parts = nameParts(displayName);
    return {
        firstName: firstNameFromParts(parts),
        lastName: lastNameFromParts(parts)
    };
}

function sqlValue(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return 'NULL';
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'NULL';
    }
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    return `'${String(value).replace(/'/g, "''")}'`;
}

function sqliteExec(dbPath, sql) {
    execFileSync('sqlite3', [dbPath], {
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024
    });
}

function sqliteQueryJson(dbPath, sql) {
    const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024
    }).trim();
    if (!output) {
        return [];
    }
    return JSON.parse(output);
}

function ensureSchema(dbPath) {
    sqliteExec(dbPath, `
BEGIN;
CREATE TABLE IF NOT EXISTS weglide_sync_pilots (
    pilot_id TEXT PRIMARY KEY,
    weglide_user_id INTEGER NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    club_name TEXT,
    club_region TEXT,
    flight_count INTEGER NOT NULL DEFAULT 0,
    total_flight_duration_seconds INTEGER NOT NULL DEFAULT 0,
    is_canadian INTEGER NOT NULL DEFAULT 0,
    seed_reason TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL,
    last_profile_fetched_at TEXT NOT NULL,
    last_flights_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weglide_sync_pilots_canadian
    ON weglide_sync_pilots (is_canadian, updated_at);

CREATE TABLE IF NOT EXISTS pilot_match_overrides (
    weglide_pilot_id TEXT PRIMARY KEY,
    olc_pilot_id TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_name_matches (
    weglide_pilot_id TEXT PRIMARY KEY,
    weglide_display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    olc_pilot_id TEXT,
    olc_display_name TEXT,
    match_kind TEXT NOT NULL,
    match_score REAL NOT NULL DEFAULT 0,
    candidate_json TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pilot_name_matches_olc
    ON pilot_name_matches (olc_pilot_id, match_kind);

CREATE TABLE IF NOT EXISTS pilot_composite_hours (
    composite_key TEXT PRIMARY KEY,
    pilot_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    olc_pilot_id TEXT,
    weglide_pilot_id TEXT,
    match_kind TEXT NOT NULL,
    olc_flight_count INTEGER NOT NULL DEFAULT 0,
    weglide_flight_count INTEGER NOT NULL DEFAULT 0,
    olc_flight_days INTEGER NOT NULL DEFAULT 0,
    weglide_flight_days INTEGER NOT NULL DEFAULT 0,
    overlap_flight_days INTEGER NOT NULL DEFAULT 0,
    combined_flight_days INTEGER NOT NULL DEFAULT 0,
    olc_hours REAL NOT NULL DEFAULT 0,
    weglide_hours REAL NOT NULL DEFAULT 0,
    combined_deduped_hours REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pilot_composite_hours_total
    ON pilot_composite_hours (combined_deduped_hours DESC, pilot_name);
COMMIT;
`);
}

function loadCachedProfiles(profilesPath) {
    if (!profilesPath || !fs.existsSync(profilesPath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse profiles cache ${profilesPath}: ${error.message}`);
    }
}

function loadDirectoryProfiles(userDirectoryPath) {
    const profiles = new Map();
    if (!userDirectoryPath || !fs.existsSync(userDirectoryPath)) {
        return profiles;
    }

    const lines = fs.readFileSync(userDirectoryPath, 'utf8').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        let profile;
        try {
            profile = JSON.parse(line);
        } catch (error) {
            continue;
        }
        if (profile && typeof profile.id === 'number') {
            profiles.set(profile.id, profile);
        }
    }
    return profiles;
}

function collectCanadaSeedIds(flightsPath, cachedProfiles, directoryProfiles) {
    const ids = new Set();

    if (flightsPath && fs.existsSync(flightsPath)) {
        const lines = fs.readFileSync(flightsPath, 'utf8').split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            let row;
            try {
                row = JSON.parse(line);
            } catch (error) {
                continue;
            }
            if (typeof row?.user?.id === 'number') {
                ids.add(row.user.id);
            }
            if (typeof row?.co_user?.id === 'number') {
                ids.add(row.co_user.id);
            }
        }
    }

    Object.entries(cachedProfiles).forEach(([profileId, profile]) => {
        const numericId = Number(profileId);
        if (!Number.isFinite(numericId)) return;
        if (isCanadianClubRegion(profile?.club?.region)) {
            ids.add(numericId);
        }
    });

    directoryProfiles.forEach((profile, profileId) => {
        if (isCanadianClubRegion(profile?.club?.region)) {
            ids.add(profileId);
        }
    });

    return ids;
}

function loadExistingWeGlideIds(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT CAST(SUBSTR(pilot_id, 4) AS INTEGER) AS weglide_user_id
FROM pilots
WHERE pilot_id LIKE 'wg:%'
UNION
SELECT weglide_user_id
FROM weglide_sync_pilots;
`);
    return rows
        .map(row => Number(row.weglide_user_id))
        .filter(value => Number.isFinite(value));
}

function loadImportedPrimaryFlightCounts(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT fp.pilot_id, COUNT(DISTINCT fp.flight_tid) AS flights
FROM flight_people fp
WHERE fp.role = 'pilot'
  AND fp.pilot_id LIKE 'wg:%'
GROUP BY fp.pilot_id;
`);
    const counts = new Map();
    rows.forEach(row => {
        counts.set(row.pilot_id, Number(row.flights) || 0);
    });
    return counts;
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`);
    }
    return response.json();
}

async function fetchProfilesForIds(ids, batchSize, delayMs) {
    const profiles = new Map();
    const chunks = chunkArray(ids, batchSize);
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const url = `https://api.weglide.org/v1/user?id_in=${chunk.join(',')}`;
        log(`Fetching profile batch ${index + 1}/${chunks.length} (${chunk.length} pilots)`);
        let rows;
        try {
            rows = await fetchJson(url);
        } catch (error) {
            if (!String(error.message || '').includes('HTTP 405')) {
                throw error;
            }
            log(`Batch profile endpoint rejected GET; falling back to ${chunk.length} single-user requests`);
            rows = [];
            for (let idIndex = 0; idIndex < chunk.length; idIndex++) {
                try {
                    const profile = await fetchJson(`https://api.weglide.org/v1/user/${chunk[idIndex]}`);
                    rows.push(profile);
                } catch (singleError) {
                    if (!String(singleError.message || '').includes('HTTP 404')) {
                        throw singleError;
                    }
                    log(`Skipping missing WeGlide user ${chunk[idIndex]}`);
                }
                if (idIndex < chunk.length - 1) {
                    await delay(delayMs);
                }
            }
        }
        if (Array.isArray(rows)) {
            rows.forEach(profile => {
                if (profile && typeof profile.id === 'number') {
                    profiles.set(profile.id, profile);
                }
            });
        }
        if (index < chunks.length - 1) {
            await delay(delayMs);
        }
    }
    return profiles;
}

async function fetchFlightsForPilotBatch(pilotIds, pageSize, delayMs) {
    const flights = [];
    let skip = 0;
    while (true) {
        const params = new URLSearchParams({
            user_id_in: pilotIds.join(','),
            order_by: '-created',
            limit: String(pageSize),
            skip: String(skip)
        });
        const url = `https://api.weglide.org/v1/flight?${params.toString()}`;
        const page = await fetchJson(url);
        if (!Array.isArray(page) || page.length === 0) {
            break;
        }
        flights.push(...page);
        if (page.length < pageSize) {
            break;
        }
        skip += pageSize;
        await delay(delayMs);
    }
    return flights;
}

function buildPilotRowFromProfile(profile, isCanadian, seedReason, nowIso) {
    const displayName = String(profile?.name || '').trim();
    const parts = splitDisplayName(displayName);
    const clubName = profile?.club?.name || null;
    const clubRegion = profile?.club?.region || null;
    const pilotId = `wg:${profile.id}`;
    const sourceUrl = `https://www.weglide.org/user/${profile.id}`;
    return {
        pilot_id: pilotId,
        display_name: displayName,
        first_name: parts.firstName,
        last_name: parts.lastName,
        nationality_code: isCanadian ? 'CA' : null,
        state_code: clubRegion && String(clubRegion).toUpperCase().startsWith('CA-') ? String(clubRegion).slice(3).replace('-', '/') : null,
        source_url: sourceUrl,
        first_seen_season: null,
        last_seen_season: null,
        created_at: nowIso,
        updated_at: nowIso,
        weglide_user_id: profile.id,
        club_name: clubName,
        club_region: clubRegion,
        flight_count: Number(profile?.flight_count) || 0,
        total_flight_duration_seconds: Math.round(Number(profile?.total_flight_duration) || 0),
        is_canadian: isCanadian ? 1 : 0,
        seed_reason: seedReason || '',
        first_seen_at: nowIso,
        last_profile_fetched_at: nowIso,
        last_flights_synced_at: null
    };
}

function inferScoringCountry(flight, profileRow) {
    const takeoffRegion = String(flight?.takeoff_airport?.region || '');
    if (takeoffRegion) {
        return takeoffRegion.split('-')[0] || null;
    }
    const clubRegion = String(profileRow?.club_region || '');
    if (clubRegion) {
        return clubRegion.split('-')[0] || null;
    }
    return null;
}

function inferScoringSubcountry(flight, profileRow) {
    const takeoffRegion = String(flight?.takeoff_airport?.region || '');
    if (takeoffRegion.includes('-')) {
        return takeoffRegion.split('-').slice(1).join('-') || null;
    }
    const clubRegion = String(profileRow?.club_region || '');
    if (clubRegion.includes('-')) {
        return clubRegion.split('-').slice(1).join('-') || null;
    }
    return null;
}

function buildFlightRows(flights, profileRowsByPilotId, nowIso) {
    const flightRows = [];
    const flightPeopleRows = [];
    const discoveredCoUserIds = new Set();

    flights.forEach(flight => {
        if (!flight || typeof flight.id !== 'number' || typeof flight?.user?.id !== 'number') {
            return;
        }

        const pilotId = `wg:${flight.user.id}`;
        const profileRow = profileRowsByPilotId.get(pilotId) || {};
        const dateOfFlight = String(flight.scoring_date || '').trim() || null;
        const seasonYear = seasonYearFromDate(dateOfFlight);
        if (!dateOfFlight || !seasonYear) {
            return;
        }
        const flightTid = `wg:${flight.id}`;
        const durationSeconds = durationSecondsFromFlight(flight);
        const scoringCountry = inferScoringCountry(flight, profileRow);
        const scoringSubcountry = inferScoringSubcountry(flight, profileRow);

        flightRows.push({
            flight_tid: flightTid,
            season_year: seasonYear,
            date_of_flight: dateOfFlight,
            date_of_flight_ms: dateMs(dateOfFlight),
            start_time_utc: flight.takeoff_time || null,
            start_time_ms: isoTimestampMs(flight.takeoff_time),
            end_time_utc: flight.landing_time || null,
            end_time_ms: isoTimestampMs(flight.landing_time),
            duration_seconds: durationSeconds,
            aircraft: flight?.aircraft?.name || null,
            takeoff_id: flight?.takeoff_airport?.id != null ? String(flight.takeoff_airport.id) : null,
            takeoff_name: flight?.takeoff_airport?.name || null,
            takeoff_url: flight?.takeoff_airport?.id != null ? `https://www.weglide.org/flight/${flight.id}` : null,
            club_id: flight?.club?.id != null ? String(flight.club.id) : null,
            club_name: flight?.club?.name || null,
            club_url: flight?.club?.id != null ? `https://www.weglide.org/club/${flight.club.id}` : null,
            scoring_country: scoringCountry,
            scoring_subcountry: scoringSubcountry,
            igc_valid_code: null,
            igc_valid_label: null,
            comment_words: null,
            has_story: flight?.story ? 1 : 0,
            user_comments: null,
            ranking_type: 'weglide',
            olc_alps: 0,
            first_seen_pilot_id: pilotId,
            first_seen_source_url: `https://www.weglide.org/flight/${flight.id}`,
            created_at: nowIso,
            updated_at: nowIso
        });

        flightPeopleRows.push({
            flight_tid: flightTid,
            pilot_id: pilotId,
            role: 'pilot',
            display_name: String(flight?.user?.name || '').trim(),
            nationality_code: profileRow?.nationality_code || null,
            state_code: profileRow?.state_code || null,
            source_url: `https://www.weglide.org/user/${flight.user.id}`,
            created_at: nowIso,
            updated_at: nowIso
        });

        if (typeof flight?.co_user?.id === 'number') {
            const coUserId = `wg:${flight.co_user.id}`;
            discoveredCoUserIds.add(flight.co_user.id);
            flightPeopleRows.push({
                flight_tid: flightTid,
                pilot_id: coUserId,
                role: 'co_user',
                display_name: String(flight?.co_user?.name || '').trim(),
                nationality_code: null,
                state_code: null,
                source_url: `https://www.weglide.org/user/${flight.co_user.id}`,
                created_at: nowIso,
                updated_at: nowIso
            });
        }
    });

    return {
        flightRows,
        flightPeopleRows,
        discoveredCoUserIds
    };
}

function upsertProfiles(dbPath, profileRows) {
    if (!profileRows.length) return;
    const statements = ['BEGIN IMMEDIATE;'];

    profileRows.forEach(row => {
        statements.push(`
INSERT INTO pilots (
    pilot_id, display_name, first_name, last_name, nationality_code, state_code,
    source_url, first_seen_season, last_seen_season, created_at, updated_at
) VALUES (
    ${sqlValue(row.pilot_id)}, ${sqlValue(row.display_name)}, ${sqlValue(row.first_name)}, ${sqlValue(row.last_name)},
    ${sqlValue(row.nationality_code)}, ${sqlValue(row.state_code)}, ${sqlValue(row.source_url)},
    ${sqlValue(row.first_seen_season)}, ${sqlValue(row.last_seen_season)}, ${sqlValue(row.created_at)}, ${sqlValue(row.updated_at)}
)
ON CONFLICT(pilot_id) DO UPDATE SET
    display_name = excluded.display_name,
    first_name = COALESCE(excluded.first_name, pilots.first_name),
    last_name = COALESCE(excluded.last_name, pilots.last_name),
    nationality_code = COALESCE(excluded.nationality_code, pilots.nationality_code),
    state_code = COALESCE(excluded.state_code, pilots.state_code),
    source_url = COALESCE(excluded.source_url, pilots.source_url),
    updated_at = excluded.updated_at;
`);

        statements.push(`
INSERT INTO weglide_sync_pilots (
    pilot_id, weglide_user_id, display_name, club_name, club_region, flight_count,
    total_flight_duration_seconds, is_canadian, seed_reason, first_seen_at,
    last_profile_fetched_at, last_flights_synced_at, created_at, updated_at
) VALUES (
    ${sqlValue(row.pilot_id)}, ${sqlValue(row.weglide_user_id)}, ${sqlValue(row.display_name)},
    ${sqlValue(row.club_name)}, ${sqlValue(row.club_region)}, ${sqlValue(row.flight_count)},
    ${sqlValue(row.total_flight_duration_seconds)}, ${sqlValue(row.is_canadian)}, ${sqlValue(row.seed_reason)},
    ${sqlValue(row.first_seen_at)}, ${sqlValue(row.last_profile_fetched_at)}, ${sqlValue(row.last_flights_synced_at)},
    ${sqlValue(row.created_at)}, ${sqlValue(row.updated_at)}
)
ON CONFLICT(pilot_id) DO UPDATE SET
    display_name = excluded.display_name,
    club_name = excluded.club_name,
    club_region = excluded.club_region,
    flight_count = excluded.flight_count,
    total_flight_duration_seconds = excluded.total_flight_duration_seconds,
    is_canadian = excluded.is_canadian,
    seed_reason = excluded.seed_reason,
    last_profile_fetched_at = excluded.last_profile_fetched_at,
    updated_at = excluded.updated_at;
`);
    });

    statements.push('COMMIT;');
    sqliteExec(dbPath, statements.join('\n'));
}

function upsertFlights(dbPath, flightRows, flightPeopleRows, syncedPilotIds, nowIso) {
    if (!flightRows.length && !flightPeopleRows.length && !syncedPilotIds.length) return;
    const statements = ['BEGIN IMMEDIATE;'];

    flightRows.forEach(row => {
        statements.push(`
INSERT INTO flights (
    flight_tid, season_year, date_of_flight, date_of_flight_ms, start_time_utc, start_time_ms,
    end_time_utc, end_time_ms, duration_seconds, aircraft, takeoff_id, takeoff_name, takeoff_url,
    club_id, club_name, club_url, scoring_country, scoring_subcountry, igc_valid_code, igc_valid_label,
    comment_words, has_story, user_comments, ranking_type, olc_alps, first_seen_pilot_id,
    first_seen_source_url, created_at, updated_at
) VALUES (
    ${sqlValue(row.flight_tid)}, ${sqlValue(row.season_year)}, ${sqlValue(row.date_of_flight)}, ${sqlValue(row.date_of_flight_ms)},
    ${sqlValue(row.start_time_utc)}, ${sqlValue(row.start_time_ms)}, ${sqlValue(row.end_time_utc)}, ${sqlValue(row.end_time_ms)},
    ${sqlValue(row.duration_seconds)}, ${sqlValue(row.aircraft)}, ${sqlValue(row.takeoff_id)}, ${sqlValue(row.takeoff_name)},
    ${sqlValue(row.takeoff_url)}, ${sqlValue(row.club_id)}, ${sqlValue(row.club_name)}, ${sqlValue(row.club_url)},
    ${sqlValue(row.scoring_country)}, ${sqlValue(row.scoring_subcountry)}, ${sqlValue(row.igc_valid_code)},
    ${sqlValue(row.igc_valid_label)}, ${sqlValue(row.comment_words)}, ${sqlValue(row.has_story)},
    ${sqlValue(row.user_comments)}, ${sqlValue(row.ranking_type)}, ${sqlValue(row.olc_alps)},
    ${sqlValue(row.first_seen_pilot_id)}, ${sqlValue(row.first_seen_source_url)}, ${sqlValue(row.created_at)}, ${sqlValue(row.updated_at)}
)
ON CONFLICT(flight_tid) DO UPDATE SET
    season_year = COALESCE(excluded.season_year, flights.season_year),
    date_of_flight = COALESCE(excluded.date_of_flight, flights.date_of_flight),
    date_of_flight_ms = COALESCE(excluded.date_of_flight_ms, flights.date_of_flight_ms),
    start_time_utc = COALESCE(excluded.start_time_utc, flights.start_time_utc),
    start_time_ms = COALESCE(excluded.start_time_ms, flights.start_time_ms),
    end_time_utc = COALESCE(excluded.end_time_utc, flights.end_time_utc),
    end_time_ms = COALESCE(excluded.end_time_ms, flights.end_time_ms),
    duration_seconds = COALESCE(excluded.duration_seconds, flights.duration_seconds),
    aircraft = COALESCE(excluded.aircraft, flights.aircraft),
    takeoff_id = COALESCE(excluded.takeoff_id, flights.takeoff_id),
    takeoff_name = COALESCE(excluded.takeoff_name, flights.takeoff_name),
    takeoff_url = COALESCE(excluded.takeoff_url, flights.takeoff_url),
    club_id = COALESCE(excluded.club_id, flights.club_id),
    club_name = COALESCE(excluded.club_name, flights.club_name),
    club_url = COALESCE(excluded.club_url, flights.club_url),
    scoring_country = COALESCE(excluded.scoring_country, flights.scoring_country),
    scoring_subcountry = COALESCE(excluded.scoring_subcountry, flights.scoring_subcountry),
    has_story = COALESCE(excluded.has_story, flights.has_story),
    updated_at = excluded.updated_at;
`);
    });

    flightPeopleRows.forEach(row => {
        statements.push(`
INSERT INTO flight_people (
    flight_tid, pilot_id, role, display_name, nationality_code, state_code, source_url, created_at, updated_at
) VALUES (
    ${sqlValue(row.flight_tid)}, ${sqlValue(row.pilot_id)}, ${sqlValue(row.role)}, ${sqlValue(row.display_name)},
    ${sqlValue(row.nationality_code)}, ${sqlValue(row.state_code)}, ${sqlValue(row.source_url)},
    ${sqlValue(row.created_at)}, ${sqlValue(row.updated_at)}
)
ON CONFLICT(flight_tid, pilot_id, role) DO UPDATE SET
    display_name = COALESCE(excluded.display_name, flight_people.display_name),
    nationality_code = COALESCE(excluded.nationality_code, flight_people.nationality_code),
    state_code = COALESCE(excluded.state_code, flight_people.state_code),
    source_url = COALESCE(excluded.source_url, flight_people.source_url),
    updated_at = excluded.updated_at;
`);
    });

    syncedPilotIds.forEach(pilotId => {
        statements.push(`
UPDATE weglide_sync_pilots
SET last_flights_synced_at = ${sqlValue(nowIso)},
    updated_at = ${sqlValue(nowIso)}
WHERE pilot_id = ${sqlValue(pilotId)};
`);
    });

    statements.push('COMMIT;');
    sqliteExec(dbPath, statements.join('\n'));
}

function loadOlcCanadianPilots(dbPath) {
    return loadOlcPilotGroups(dbPath).map(group => ({
        pilot_id: group.pilot_id,
        display_name: group.display_name,
        normalized_name: group.normalized_name,
        parts: group.parts,
        member_pilot_ids: group.member_pilot_ids
    }));
}

function loadWeGlideCanadianPilots(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT p.pilot_id, p.display_name, wsp.is_canadian
FROM pilots p
JOIN weglide_sync_pilots wsp ON wsp.pilot_id = p.pilot_id
WHERE p.pilot_id LIKE 'wg:%';
`);
    return rows
        .filter(row => Number(row.is_canadian) === 1)
        .map(row => ({
            pilot_id: row.pilot_id,
            display_name: row.display_name,
            normalized_name: compactName(row.display_name),
            parts: nameParts(row.display_name)
        }));
}

function loadMatchOverrides(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT weglide_pilot_id, olc_pilot_id
FROM pilot_match_overrides;
`);
    const map = new Map();
    rows.forEach(row => {
        map.set(row.weglide_pilot_id, row.olc_pilot_id);
    });
    return map;
}

function loadOverrideTargetOlcIds(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT DISTINCT olc_pilot_id
FROM pilot_match_overrides
WHERE olc_pilot_id IS NOT NULL;
`);
    return new Set(rows.map(row => row.olc_pilot_id).filter(Boolean));
}

function loadOlcPilotGroups(dbPath) {
    const overrideTargetIds = loadOverrideTargetOlcIds(dbPath);
    const rows = sqliteQueryJson(dbPath, `
SELECT
    p.pilot_id,
    p.display_name,
    p.nationality_code,
    p.state_code,
    COALESCE(t.total_hours, 0) AS total_hours
FROM pilots p
LEFT JOIN pilot_total_hours t ON t.pilot_id = p.pilot_id
WHERE p.pilot_id NOT LIKE 'wg:%';
`);
    const groups = new Map();

    rows.forEach(row => {
        const isCanadian = row.nationality_code === 'CA' || isCanadianStateCode(row.state_code);
        if (!isCanadian && !overrideTargetIds.has(row.pilot_id)) {
            return;
        }

        const normalizedName = compactName(row.display_name);
        if (!normalizedName) {
            return;
        }

        if (!groups.has(normalizedName)) {
            groups.set(normalizedName, {
                normalized_name: normalizedName,
                display_name: row.display_name,
                pilot_id: row.pilot_id,
                parts: nameParts(row.display_name),
                member_pilot_ids: [],
                representative_hours: Number(row.total_hours) || 0
            });
        }

        const group = groups.get(normalizedName);
        const totalHours = Number(row.total_hours) || 0;
        group.member_pilot_ids.push(row.pilot_id);

        if (
            totalHours > group.representative_hours ||
            (totalHours === group.representative_hours && String(row.pilot_id) < String(group.pilot_id))
        ) {
            group.display_name = row.display_name;
            group.pilot_id = row.pilot_id;
            group.parts = nameParts(row.display_name);
            group.representative_hours = totalHours;
        }
    });

    return Array.from(groups.values());
}

function scoreCandidateMatch(weglidePilot, olcPilot) {
    const wgParts = weglidePilot.parts;
    const olcParts = olcPilot.parts;
    if (!wgParts.length || !olcParts.length) {
        return 0;
    }
    let score = 0;
    const wgFirst = firstNameFromParts(wgParts);
    const wgLast = lastNameFromParts(wgParts);
    const olcFirst = firstNameFromParts(olcParts);
    const olcLast = lastNameFromParts(olcParts);

    if (wgLast && olcLast && wgLast === olcLast) {
        score += 4;
    }
    if (wgFirst && olcFirst && wgFirst === olcFirst) {
        score += 4;
    } else if (wgFirst && olcFirst) {
        const prefix = sharedPrefixLength(wgFirst, olcFirst);
        if (prefix >= 4) {
            score += 3;
        } else if (prefix >= 3) {
            score += 2;
        } else if (wgFirst[0] === olcFirst[0]) {
            score += 1;
        }
    }

    const sharedTokens = wgParts.filter(part => olcParts.includes(part)).length;
    score += Math.min(sharedTokens, 3);

    return score;
}

function rebuildMatchTable(dbPath) {
    const weglidePilots = loadWeGlideCanadianPilots(dbPath);
    const olcPilots = loadOlcCanadianPilots(dbPath);
    const overrides = loadMatchOverrides(dbPath);
    const olcById = new Map();
    const exactBuckets = new Map();

    olcPilots.forEach(pilot => {
        const memberIds = Array.isArray(pilot.member_pilot_ids) && pilot.member_pilot_ids.length
            ? pilot.member_pilot_ids
            : [pilot.pilot_id];
        memberIds.forEach(memberId => {
            olcById.set(memberId, pilot);
        });
        if (!pilot.normalized_name) return;
        if (!exactBuckets.has(pilot.normalized_name)) {
            exactBuckets.set(pilot.normalized_name, []);
        }
        exactBuckets.get(pilot.normalized_name).push(pilot);
    });

    const rows = [];

    weglidePilots.forEach(weglidePilot => {
        const overridePilotId = overrides.get(weglidePilot.pilot_id);
        if (overridePilotId && olcById.has(overridePilotId)) {
            const olcPilot = olcById.get(overridePilotId);
            rows.push({
                weglide_pilot_id: weglidePilot.pilot_id,
                weglide_display_name: weglidePilot.display_name,
                normalized_name: weglidePilot.normalized_name,
                olc_pilot_id: olcPilot.pilot_id,
                olc_display_name: olcPilot.display_name,
                match_kind: 'override',
                match_score: 100,
                candidate_json: null
            });
            return;
        }

        const exactMatches = exactBuckets.get(weglidePilot.normalized_name) || [];
        if (weglidePilot.normalized_name && exactMatches.length === 1) {
            rows.push({
                weglide_pilot_id: weglidePilot.pilot_id,
                weglide_display_name: weglidePilot.display_name,
                normalized_name: weglidePilot.normalized_name,
                olc_pilot_id: exactMatches[0].pilot_id,
                olc_display_name: exactMatches[0].display_name,
                match_kind: 'exact_normalized',
                match_score: 1,
                candidate_json: null
            });
            return;
        }

        const suggestions = olcPilots
            .map(olcPilot => ({
                pilot_id: olcPilot.pilot_id,
                display_name: olcPilot.display_name,
                score: scoreCandidateMatch(weglidePilot, olcPilot)
            }))
            .filter(candidate => candidate.score >= 6)
            .sort((left, right) => right.score - left.score || left.display_name.localeCompare(right.display_name))
            .slice(0, 5);

        rows.push({
            weglide_pilot_id: weglidePilot.pilot_id,
            weglide_display_name: weglidePilot.display_name,
            normalized_name: weglidePilot.normalized_name,
            olc_pilot_id: null,
            olc_display_name: null,
            match_kind: suggestions.length ? 'candidate_only' : 'unmatched',
            match_score: suggestions.length ? suggestions[0].score : 0,
            candidate_json: suggestions.length ? JSON.stringify(suggestions) : null
        });
    });

    const nowIso = new Date().toISOString();
    const statements = ['BEGIN IMMEDIATE;', 'DELETE FROM pilot_name_matches;'];

    rows.forEach(row => {
        statements.push(`
INSERT INTO pilot_name_matches (
    weglide_pilot_id, weglide_display_name, normalized_name, olc_pilot_id, olc_display_name,
    match_kind, match_score, candidate_json, updated_at
) VALUES (
    ${sqlValue(row.weglide_pilot_id)}, ${sqlValue(row.weglide_display_name)}, ${sqlValue(row.normalized_name)},
    ${sqlValue(row.olc_pilot_id)}, ${sqlValue(row.olc_display_name)}, ${sqlValue(row.match_kind)},
    ${sqlValue(row.match_score)}, ${sqlValue(row.candidate_json)}, ${sqlValue(nowIso)}
);
`);
    });

    statements.push('COMMIT;');
    sqliteExec(dbPath, statements.join('\n'));

    const exactCount = rows.filter(row => row.match_kind === 'exact_normalized').length;
    const overrideCount = rows.filter(row => row.match_kind === 'override').length;
    const candidateCount = rows.filter(row => row.match_kind === 'candidate_only').length;
    const unmatchedCount = rows.filter(row => row.match_kind === 'unmatched').length;
    log(`Pilot matches rebuilt: ${overrideCount} overrides, ${exactCount} exact, ${candidateCount} candidate-only, ${unmatchedCount} unmatched`);
}

function loadOlcDailyTotals(dbPath) {
    const olcGroups = loadOlcPilotGroups(dbPath);
    const memberToGroup = new Map();

    olcGroups.forEach(group => {
        const memberIds = Array.isArray(group.member_pilot_ids) && group.member_pilot_ids.length
            ? group.member_pilot_ids
            : [group.pilot_id];
        memberIds.forEach(memberId => {
            memberToGroup.set(memberId, group);
        });
    });

    const relevantPilotIds = Array.from(memberToGroup.keys());
    if (!relevantPilotIds.length) {
        return [];
    }

    const rows = sqliteQueryJson(dbPath, `
SELECT
    fp.pilot_id,
    p.display_name,
    f.date_of_flight,
    COUNT(DISTINCT f.flight_tid) AS flight_count,
    SUM(COALESCE(f.duration_seconds, 0)) AS duration_seconds
FROM flight_people fp
JOIN flights f ON f.flight_tid = fp.flight_tid
JOIN pilots p ON p.pilot_id = fp.pilot_id
WHERE fp.role = 'pilot'
  AND fp.pilot_id NOT LIKE 'wg:%'
  AND fp.pilot_id IN (${relevantPilotIds.map(sqlValue).join(', ')})
  AND f.date_of_flight IS NOT NULL
GROUP BY fp.pilot_id, p.display_name, f.date_of_flight;
`);

    const groupedRows = new Map();

    rows.forEach(row => {
        const group = memberToGroup.get(row.pilot_id);
        if (!group) {
            return;
        }
        const key = `${group.pilot_id}::${row.date_of_flight}`;
        if (!groupedRows.has(key)) {
            groupedRows.set(key, {
                pilot_id: group.pilot_id,
                display_name: group.display_name,
                date_of_flight: row.date_of_flight,
                flight_count: 0,
                duration_seconds: 0
            });
        }
        const target = groupedRows.get(key);
        target.flight_count += Number(row.flight_count) || 0;
        target.duration_seconds += Number(row.duration_seconds) || 0;
    });

    return Array.from(groupedRows.values());
}

function loadWeGlideDailyTotals(dbPath, roles = ['pilot']) {
    const roleList = roles.map(sqlValue).join(', ');
    return sqliteQueryJson(dbPath, `
SELECT
    fp.pilot_id,
    p.display_name,
    f.date_of_flight,
    COUNT(DISTINCT f.flight_tid) AS flight_count,
    SUM(COALESCE(f.duration_seconds, 0)) AS duration_seconds
FROM flight_people fp
JOIN flights f ON f.flight_tid = fp.flight_tid
JOIN pilots p ON p.pilot_id = fp.pilot_id
JOIN weglide_sync_pilots wsp ON wsp.pilot_id = fp.pilot_id
WHERE fp.pilot_id LIKE 'wg:%'
  AND fp.role IN (${roleList})
  AND wsp.is_canadian = 1
  AND f.date_of_flight IS NOT NULL
GROUP BY fp.pilot_id, p.display_name, f.date_of_flight;
`);
}

function summarizePilotDays(rows) {
    const pilots = new Map();
    rows.forEach(row => {
        const pilotId = row.pilot_id;
        if (!pilots.has(pilotId)) {
            pilots.set(pilotId, {
                pilot_id: pilotId,
                display_name: row.display_name,
                normalized_name: compactName(row.display_name),
                total_seconds: 0,
                flight_count: 0,
                days: new Map()
            });
        }
        const pilot = pilots.get(pilotId);
        const date = row.date_of_flight;
        const duration = Number(row.duration_seconds) || 0;
        const flightCount = Number(row.flight_count) || 0;
        pilot.total_seconds += duration;
        pilot.flight_count += flightCount;
        pilot.days.set(date, {
            duration_seconds: duration,
            flight_count: flightCount
        });
    });
    return pilots;
}

function rebuildCompositeHours(dbPath) {
    const weglideDaily = summarizePilotDays(loadWeGlideDailyTotals(dbPath));
    const olcDaily = summarizePilotDays(loadOlcDailyTotals(dbPath));
    const matchRows = sqliteQueryJson(dbPath, `
SELECT weglide_pilot_id, olc_pilot_id, match_kind
FROM pilot_name_matches
WHERE olc_pilot_id IS NOT NULL;
`);

    const matchedOlcIds = new Set();
    const matchedWeglideIds = new Set();
    const compositeRows = [];
    const nowIso = new Date().toISOString();

    matchRows.forEach(match => {
        const weglidePilot = weglideDaily.get(match.weglide_pilot_id);
        const olcPilot = olcDaily.get(match.olc_pilot_id);
        if (!weglidePilot && !olcPilot) {
            return;
        }
        matchedOlcIds.add(match.olc_pilot_id);
        matchedWeglideIds.add(match.weglide_pilot_id);

        const allDates = new Set([
            ...Array.from((weglidePilot?.days || new Map()).keys()),
            ...Array.from((olcPilot?.days || new Map()).keys())
        ]);

        let combinedSeconds = 0;
        let overlapDays = 0;

        allDates.forEach(date => {
            const olcDuration = olcPilot?.days.get(date)?.duration_seconds || 0;
            const weglideDuration = weglidePilot?.days.get(date)?.duration_seconds || 0;
            if (olcDuration > 0 && weglideDuration > 0) {
                overlapDays += 1;
            }
            combinedSeconds += Math.max(olcDuration, weglideDuration);
        });

        compositeRows.push({
            composite_key: `match:${match.olc_pilot_id}:${match.weglide_pilot_id}`,
            pilot_name: olcPilot?.display_name || weglidePilot?.display_name || 'Unknown Pilot',
            normalized_name: compactName(olcPilot?.display_name || weglidePilot?.display_name || ''),
            olc_pilot_id: match.olc_pilot_id,
            weglide_pilot_id: match.weglide_pilot_id,
            match_kind: match.match_kind,
            olc_flight_count: olcPilot?.flight_count || 0,
            weglide_flight_count: weglidePilot?.flight_count || 0,
            olc_flight_days: olcPilot?.days.size || 0,
            weglide_flight_days: weglidePilot?.days.size || 0,
            overlap_flight_days: overlapDays,
            combined_flight_days: allDates.size,
            olc_hours: Number((((olcPilot?.total_seconds || 0) / 3600)).toFixed(2)),
            weglide_hours: Number((((weglidePilot?.total_seconds || 0) / 3600)).toFixed(2)),
            combined_deduped_hours: Number(((combinedSeconds / 3600)).toFixed(2)),
            updated_at: nowIso
        });
    });

    olcDaily.forEach(olcPilot => {
        if (matchedOlcIds.has(olcPilot.pilot_id)) {
            return;
        }
        compositeRows.push({
            composite_key: `olc:${olcPilot.pilot_id}`,
            pilot_name: olcPilot.display_name,
            normalized_name: olcPilot.normalized_name,
            olc_pilot_id: olcPilot.pilot_id,
            weglide_pilot_id: null,
            match_kind: 'olc_only',
            olc_flight_count: olcPilot.flight_count,
            weglide_flight_count: 0,
            olc_flight_days: olcPilot.days.size,
            weglide_flight_days: 0,
            overlap_flight_days: 0,
            combined_flight_days: olcPilot.days.size,
            olc_hours: Number(((olcPilot.total_seconds / 3600)).toFixed(2)),
            weglide_hours: 0,
            combined_deduped_hours: Number(((olcPilot.total_seconds / 3600)).toFixed(2)),
            updated_at: nowIso
        });
    });

    weglideDaily.forEach(weglidePilot => {
        if (matchedWeglideIds.has(weglidePilot.pilot_id)) {
            return;
        }
        compositeRows.push({
            composite_key: `wg:${weglidePilot.pilot_id}`,
            pilot_name: weglidePilot.display_name,
            normalized_name: weglidePilot.normalized_name,
            olc_pilot_id: null,
            weglide_pilot_id: weglidePilot.pilot_id,
            match_kind: 'weglide_only',
            olc_flight_count: 0,
            weglide_flight_count: weglidePilot.flight_count,
            olc_flight_days: 0,
            weglide_flight_days: weglidePilot.days.size,
            overlap_flight_days: 0,
            combined_flight_days: weglidePilot.days.size,
            olc_hours: 0,
            weglide_hours: Number(((weglidePilot.total_seconds / 3600)).toFixed(2)),
            combined_deduped_hours: Number(((weglidePilot.total_seconds / 3600)).toFixed(2)),
            updated_at: nowIso
        });
    });

    const statements = ['BEGIN IMMEDIATE;', 'DELETE FROM pilot_composite_hours;'];

    compositeRows.forEach(row => {
        statements.push(`
INSERT INTO pilot_composite_hours (
    composite_key, pilot_name, normalized_name, olc_pilot_id, weglide_pilot_id, match_kind,
    olc_flight_count, weglide_flight_count, olc_flight_days, weglide_flight_days,
    overlap_flight_days, combined_flight_days, olc_hours, weglide_hours, combined_deduped_hours, updated_at
) VALUES (
    ${sqlValue(row.composite_key)}, ${sqlValue(row.pilot_name)}, ${sqlValue(row.normalized_name)},
    ${sqlValue(row.olc_pilot_id)}, ${sqlValue(row.weglide_pilot_id)}, ${sqlValue(row.match_kind)},
    ${sqlValue(row.olc_flight_count)}, ${sqlValue(row.weglide_flight_count)}, ${sqlValue(row.olc_flight_days)},
    ${sqlValue(row.weglide_flight_days)}, ${sqlValue(row.overlap_flight_days)}, ${sqlValue(row.combined_flight_days)},
    ${sqlValue(row.olc_hours)}, ${sqlValue(row.weglide_hours)}, ${sqlValue(row.combined_deduped_hours)},
    ${sqlValue(row.updated_at)}
);
`);
    });

    statements.push('COMMIT;');
    sqliteExec(dbPath, statements.join('\n'));
    log(`Composite hours rebuilt for ${compositeRows.length} pilots`);
}

async function syncWeGlideFlights(options) {
    const cachedProfiles = loadCachedProfiles(options.profilesPath);
    const directoryProfiles = loadDirectoryProfiles(options.userDirectoryPath);
    const canadaSeedIds = collectCanadaSeedIds(options.flightsPath, cachedProfiles, directoryProfiles);
    const existingWeGlideIds = loadExistingWeGlideIds(options.dbPath);
    const importedPrimaryCounts = loadImportedPrimaryFlightCounts(options.dbPath);
    const seenProfileIds = new Set();
    const pendingProfileIds = new Set();
    const profileRowsByPilotId = new Map();

    if (options.pilotIds.length) {
        options.pilotIds.forEach(id => pendingProfileIds.add(id));
    } else {
        canadaSeedIds.forEach(id => pendingProfileIds.add(id));
        existingWeGlideIds.forEach(id => pendingProfileIds.add(id));

        directoryProfiles.forEach((profile, profileId) => {
            if (isCanadianClubRegion(profile?.club?.region)) {
                pendingProfileIds.add(profileId);
            }
        });
    }

    if (!pendingProfileIds.size) {
        log('No seed WeGlide pilot IDs found; skipping API sync');
        return;
    }

    let syncedPilotCount = 0;
    let syncedFlightCount = 0;
    let profileFetchCount = 0;
    let queuePass = 0;

    while (pendingProfileIds.size > 0) {
        queuePass += 1;
        const batchIds = Array.from(pendingProfileIds).filter(id => !seenProfileIds.has(id));
        pendingProfileIds.clear();

        if (!batchIds.length) {
            continue;
        }

        log(`Profile discovery pass ${queuePass}: ${batchIds.length} pilot IDs to inspect`);
        const profileMap = await fetchProfilesForIds(batchIds, options.profileBatchSize, options.delayMs);
        profileFetchCount += profileMap.size;

        const canadianProfiles = [];
        const rowsToUpsert = [];

        batchIds.forEach(id => {
            seenProfileIds.add(id);
            const profile = profileMap.get(id);
            if (!profile || typeof profile.id !== 'number') {
                return;
            }
            const canadian = isCanadianProfile(profile, canadaSeedIds);
            const seedReason = canadaSeedIds.has(profile.id) ? 'canada-flight-seed' : (String(profile?.club?.region || '').toUpperCase().startsWith('CA-') ? 'canadian-club' : 'discovered');
            const pilotRow = buildPilotRowFromProfile(profile, canadian, seedReason, new Date().toISOString());
            profileRowsByPilotId.set(pilotRow.pilot_id, pilotRow);
            rowsToUpsert.push(pilotRow);

            if (canadian) {
                canadianProfiles.push(profile);
            }
        });

        upsertProfiles(options.dbPath, rowsToUpsert);

        let pilotsToSync = canadianProfiles.filter(profile => {
            const pilotId = `wg:${profile.id}`;
            const importedCount = importedPrimaryCounts.get(pilotId) || 0;
            return options.refreshAll || importedCount < (Number(profile.flight_count) || 0);
        });

        if (options.maxPilots > 0) {
            const remaining = Math.max(options.maxPilots - syncedPilotCount, 0);
            pilotsToSync = pilotsToSync.slice(0, remaining);
        }

        if (!pilotsToSync.length) {
            continue;
        }

        const pilotIdChunks = chunkArray(pilotsToSync.map(profile => profile.id), options.userBatchSize);

        for (let index = 0; index < pilotIdChunks.length; index++) {
            const chunk = pilotIdChunks[index];
            log(`Fetching flights for WeGlide pilot batch ${index + 1}/${pilotIdChunks.length} (${chunk.length} pilots)`);
            const flights = await fetchFlightsForPilotBatch(chunk, options.flightPageSize, options.delayMs);
            const nowIso = new Date().toISOString();
            const { flightRows, flightPeopleRows, discoveredCoUserIds } = buildFlightRows(flights, profileRowsByPilotId, nowIso);
            const syncedPilotIds = chunk.map(id => `wg:${id}`);
            upsertFlights(options.dbPath, flightRows, flightPeopleRows, syncedPilotIds, nowIso);

            chunk.forEach(id => {
                const pilotId = `wg:${id}`;
                const profile = pilotsToSync.find(item => item.id === id);
                if (profile) {
                    importedPrimaryCounts.set(pilotId, Number(profile.flight_count) || importedPrimaryCounts.get(pilotId) || 0);
                }
            });

            syncedPilotCount += chunk.length;
            syncedFlightCount += flightRows.length;

            discoveredCoUserIds.forEach(id => {
                if (!seenProfileIds.has(id)) {
                    pendingProfileIds.add(id);
                }
            });

            if (options.maxPilots > 0 && syncedPilotCount >= options.maxPilots) {
                break;
            }
        }

        if (options.maxPilots > 0 && syncedPilotCount >= options.maxPilots) {
            break;
        }
    }

    log(`WeGlide sync complete: ${profileFetchCount} profiles checked, ${syncedPilotCount} pilots synced, ${syncedFlightCount} flights imported/updated`);
}

function printSummary(dbPath) {
    const rows = sqliteQueryJson(dbPath, `
SELECT pilot_name, match_kind, olc_hours, weglide_hours, combined_deduped_hours, overlap_flight_days
FROM pilot_composite_hours
ORDER BY combined_deduped_hours DESC, pilot_name
LIMIT 15;
`);

    if (!rows.length) {
        log('No composite hours rows found');
        return;
    }

    log('Top combined pilots:');
    rows.forEach((row, index) => {
        console.log(
            `  ${String(index + 1).padStart(2, ' ')}. ${row.pilot_name} | combined ${row.combined_deduped_hours}h | ` +
            `OLC ${row.olc_hours}h | WG ${row.weglide_hours}h | ${row.match_kind} | overlap days ${row.overlap_flight_days}`
        );
    });
}

function combinedSecondsFromPilots(weglidePilot, olcPilot) {
    const allDates = new Set([
        ...Array.from((weglidePilot?.days || new Map()).keys()),
        ...Array.from((olcPilot?.days || new Map()).keys())
    ]);
    let combinedSeconds = 0;
    let olcOnlySeconds = 0;

    allDates.forEach(date => {
        const olcDuration = olcPilot?.days.get(date)?.duration_seconds || 0;
        const weglideDuration = weglidePilot?.days.get(date)?.duration_seconds || 0;
        combinedSeconds += Math.max(olcDuration, weglideDuration);
        olcOnlySeconds += Math.max(0, olcDuration - weglideDuration);
    });

    return {
        combinedSeconds,
        olcOnlySeconds
    };
}

function combinedSecondsBeforeCutoff(weglidePilot, olcPilot, cutoffDate) {
    if (!cutoffDate) {
        return {
            ...combinedSecondsFromPilots(weglidePilot, olcPilot),
            weglideSeconds: weglidePilot?.total_seconds || 0
        };
    }

    const allDates = new Set([
        ...Array.from((weglidePilot?.days || new Map()).keys()),
        ...Array.from((olcPilot?.days || new Map()).keys())
    ]);
    let combinedSeconds = 0;
    let olcOnlySeconds = 0;
    let weglideSeconds = 0;

    allDates.forEach(date => {
        if (String(date) >= cutoffDate) {
            return;
        }
        const olcDuration = olcPilot?.days.get(date)?.duration_seconds || 0;
        const weglideDuration = weglidePilot?.days.get(date)?.duration_seconds || 0;
        combinedSeconds += Math.max(olcDuration, weglideDuration);
        olcOnlySeconds += Math.max(0, olcDuration - weglideDuration);
        weglideSeconds += weglideDuration;
    });

    return {
        combinedSeconds,
        olcOnlySeconds,
        weglideSeconds
    };
}

function buildCombinedHoursExport(dbPath, cutoffDate) {
    const effectiveCutoffDate = cutoffDate || currentVerificationCutoffDate();
    const weglideDaily = summarizePilotDays(loadWeGlideDailyTotals(dbPath, ['pilot']));
    const weglideCoUserDaily = summarizePilotDays(loadWeGlideDailyTotals(dbPath, ['co_user']));
    const olcDaily = summarizePilotDays(loadOlcDailyTotals(dbPath));
    const matchRows = sqliteQueryJson(dbPath, `
SELECT weglide_pilot_id, olc_pilot_id, match_kind
FROM pilot_name_matches;
`);
    const pilots = {};
    const matchedWeglideIds = new Set();

    matchRows.forEach(match => {
        if (!match.weglide_pilot_id) {
            return;
        }

        const weglidePilot = weglideDaily.get(match.weglide_pilot_id);
        const weglideCoUser = weglideCoUserDaily.get(match.weglide_pilot_id);
        const olcPilot = match.olc_pilot_id ? olcDaily.get(match.olc_pilot_id) : null;
        if (!weglidePilot && !olcPilot) {
            return;
        }

        matchedWeglideIds.add(match.weglide_pilot_id);
        const total = combinedSecondsFromPilots(weglidePilot, olcPilot);
        const beforeCutoff = combinedSecondsBeforeCutoff(weglidePilot, olcPilot, effectiveCutoffDate);
        const coUserBeforeCutoff = combinedSecondsBeforeCutoff(weglideCoUser, null, effectiveCutoffDate);
        const weglideUserId = Number(String(match.weglide_pilot_id).replace(/^wg:/, ''));
        if (!Number.isInteger(weglideUserId)) {
            return;
        }

        pilots[String(weglideUserId)] = {
            pilotId: weglideUserId,
            weglidePilotId: match.weglide_pilot_id,
            olcPilotId: match.olc_pilot_id || null,
            pilotName: olcPilot?.display_name || weglidePilot?.display_name || 'Unknown Pilot',
            matchKind: match.olc_pilot_id ? match.match_kind : 'weglide_only',
            weglideHours: Number((((weglidePilot?.total_seconds || 0) / 3600)).toFixed(2)),
            weglideCoPilotHours: Number((((weglideCoUser?.total_seconds || 0) / 3600)).toFixed(2)),
            olcHours: Number((((olcPilot?.total_seconds || 0) / 3600)).toFixed(2)),
            olcOnlyHours: Number(((total.olcOnlySeconds / 3600)).toFixed(2)),
            combinedHours: Number(((total.combinedSeconds / 3600)).toFixed(2)),
            weglideHoursBeforeCutoff: Number((((beforeCutoff.weglideSeconds || 0) / 3600)).toFixed(2)),
            weglideCoPilotHoursBeforeCutoff: Number((((coUserBeforeCutoff.weglideSeconds || 0) / 3600)).toFixed(2)),
            olcOnlyHoursBeforeCutoff: Number((((beforeCutoff.olcOnlySeconds || 0) / 3600)).toFixed(2)),
            combinedHoursBeforeCutoff: Number(((beforeCutoff.combinedSeconds / 3600)).toFixed(2)),
            eligibleUnder200: (beforeCutoff.combinedSeconds / 3600) < 200
        };
    });

    weglideDaily.forEach(weglidePilot => {
        if (matchedWeglideIds.has(weglidePilot.pilot_id)) {
            return;
        }
        const beforeCutoff = combinedSecondsBeforeCutoff(weglidePilot, null, effectiveCutoffDate);
        const weglideCoUser = weglideCoUserDaily.get(weglidePilot.pilot_id);
        const coUserBeforeCutoff = combinedSecondsBeforeCutoff(weglideCoUser, null, effectiveCutoffDate);
        const weglideUserId = Number(String(weglidePilot.pilot_id).replace(/^wg:/, ''));
        if (!Number.isInteger(weglideUserId)) {
            return;
        }

        pilots[String(weglideUserId)] = {
            pilotId: weglideUserId,
            weglidePilotId: weglidePilot.pilot_id,
            olcPilotId: null,
            pilotName: weglidePilot.display_name,
            matchKind: 'weglide_only',
            weglideHours: Number(((weglidePilot.total_seconds / 3600)).toFixed(2)),
            weglideCoPilotHours: Number((((weglideCoUser?.total_seconds || 0) / 3600)).toFixed(2)),
            olcHours: 0,
            olcOnlyHours: 0,
            combinedHours: Number(((weglidePilot.total_seconds / 3600)).toFixed(2)),
            weglideHoursBeforeCutoff: Number((((beforeCutoff.weglideSeconds || 0) / 3600)).toFixed(2)),
            weglideCoPilotHoursBeforeCutoff: Number((((coUserBeforeCutoff.weglideSeconds || 0) / 3600)).toFixed(2)),
            olcOnlyHoursBeforeCutoff: 0,
            combinedHoursBeforeCutoff: Number(((beforeCutoff.combinedSeconds / 3600)).toFixed(2)),
            eligibleUnder200: (beforeCutoff.combinedSeconds / 3600) < 200
        };
    });

    return {
        generatedAt: new Date().toISOString(),
        cutoffDate: effectiveCutoffDate,
        pilots
    };
}

function writeCombinedHoursExport(outputPath, exportData) {
    if (!outputPath) {
        return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    log(`Combined-hours cache written: ${outputPath} (${Object.keys(exportData.pilots).length} pilots)`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(options.dbPath)) {
        throw new Error(`DB not found: ${options.dbPath}`);
    }

    ensureSchema(options.dbPath);

    if (!options.rebuildOnly) {
        await syncWeGlideFlights(options);
    } else {
        log('Skipping WeGlide API sync because --rebuild-only was provided');
    }

    rebuildMatchTable(options.dbPath);
    rebuildCompositeHours(options.dbPath);
    if (options.exportCombinedHoursPath) {
        writeCombinedHoursExport(
            options.exportCombinedHoursPath,
            buildCombinedHoursExport(options.dbPath, options.cutoffDate)
        );
    }
    printSummary(options.dbPath);
}

main().catch(error => {
    console.error(`[weglide-sync] Fatal error: ${error.message}`);
    process.exit(1);
});
