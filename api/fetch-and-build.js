const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { spawn } = require('child_process');
const { get: getBlob, list: listBlobs } = require('@vercel/blob');

// Default to GitHub-backed persistence. Blob fallback is opt-in because list() is billed
// as an advanced operation and the dataset/profiles already sync back to the repo.
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null;
const RUNNING_ON_VERCEL = Boolean(process.env.VERCEL);
const BLOB_FALLBACK_ENABLED = /^(1|true|yes)$/i.test((process.env.ENABLE_BLOB_FALLBACK || '').trim());
const DATASET_BLOB_KEY = process.env.DATASET_BLOB_KEY || 'canadian_flights_2026_details.jsonl';
const PROFILES_BLOB_KEY = process.env.PROFILES_BLOB_KEY || 'canadian_user_profiles.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ryanwoodie/WeGlide-API';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BOOTSTRAP_FILES = {
    [DATASET_BLOB_KEY]: path.join(process.cwd(), 'bootstrap', 'canadian_flights_2026_details.bootstrap'),
    [PROFILES_BLOB_KEY]: path.join(process.cwd(), 'bootstrap', 'canadian_user_profiles.bootstrap')
};

const usingBlobFallback = () => Boolean(BLOB_TOKEN) && BLOB_FALLBACK_ENABLED;
const TMP_DIR = RUNNING_ON_VERCEL ? '/tmp' : process.cwd();

const DATASET_FILE = path.join(TMP_DIR, process.env.CANADIAN_FLIGHTS_FILE || 'canadian_flights_2026_details.jsonl');
const PROFILES_FILE = path.join(TMP_DIR, process.env.CANADIAN_PROFILES_FILE || 'canadian_user_profiles.json');
const COMBINED_HOURS_FILE = path.join(TMP_DIR, process.env.CANADIAN_COMBINED_HOURS_FILE || 'canadian_combined_hours.json');
const LOCK_FILE = path.join('/tmp', 'fetch_and_build.lock');

const trimEnv = (val, fallback) => (val && typeof val === 'string') ? val.trim() : fallback;
const WEGLIDE_API_BASE = trimEnv(process.env.WEGLIDE_API_BASE, 'https://api.weglide.org');
const SEASON_START = trimEnv(process.env.SEASON_START, '2025-09-23');
const SEASON_END = trimEnv(process.env.SEASON_END, '2026-09-30');
const SEASON_BASELINE_DATE = trimEnv(process.env.SEASON_BASELINE_DATE, '2025-10-01');
const MAX_FLIGHTS_PER_RUN = Number(trimEnv(process.env.MAX_FLIGHTS_PER_RUN, 150));
const UPDATE_TOKEN = trimEnv(process.env.UPDATE_TOKEN, '');
// WeGlide pagination expects skip to be a multiple of 100, so we page in 100-flight blocks
const FLIGHT_BATCH_SIZE = 100;
const FLIGHT_DETAIL_DELAY_MS = Number(trimEnv(process.env.FLIGHT_DETAIL_DELAY_MS, 200));
const RECENT_REFRESH_DAYS = Number(trimEnv(process.env.RECENT_REFRESH_DAYS, 14));
const DEFAULT_OLC_DB_PATH = path.resolve(process.cwd(), '../OLC-downloader/olc_stats.sqlite');
const OLC_DB_PATH = trimEnv(process.env.OLC_DB_PATH, fs.existsSync(DEFAULT_OLC_DB_PATH) ? DEFAULT_OLC_DB_PATH : '');

let globalLogBuffer = [];
function log(...args) {
    const msg = args.join(' ');
    console.log('[fetch-and-build]', msg);
    if (globalLogBuffer) globalLogBuffer.push(msg);
}


function getBlobPrefix(key) {
    const extension = path.extname(key);
    return extension ? key.slice(0, -extension.length) : key;
}

function matchesLogicalBlobKey(pathname, key) {
    if (pathname === key) {
        return true;
    }

    const extension = path.extname(key);
    if (!extension) {
        return pathname.startsWith(`${key}-`);
    }

    const prefix = key.slice(0, -extension.length);
    return pathname.startsWith(`${prefix}-`) && pathname.endsWith(extension);
}

async function resolveLatestBlob(key) {
    if (!usingBlobFallback()) return null;

    let cursor;
    const matches = [];

    do {
        const response = await listBlobs({
            limit: 1000,
            prefix: getBlobPrefix(key),
            cursor,
            token: BLOB_TOKEN
        });

        matches.push(...response.blobs.filter(blob => matchesLogicalBlobKey(blob.pathname, key)));
        cursor = response.hasMore ? response.cursor : undefined;
    } while (cursor);

    if (matches.length === 0) {
        log(`No blob matches for key: ${key}`);
        return null;
    }

    matches.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    log(`Resolved blob for ${key}: ${matches[0].pathname}`);
    return matches[0];
}

async function readBlobStreamAsText(stream) {
    return new Response(stream).text();
}

async function blobFetchText(key) {
    if (!usingBlobFallback()) return null;
    const blob = await resolveLatestBlob(key);
    if (!blob) return null;

    const result = await getBlob(blob.url, {
        access: 'public',
        token: BLOB_TOKEN
    });

    if (!result) {
        return null;
    }

    if (result.statusCode !== 200 || !result.stream) {
        throw new Error(`Blob fetch failed for ${key} (${blob.pathname}): status ${result.statusCode}`);
    }

    return readBlobStreamAsText(result.stream);
}

function loadCombinedHoursCache() {
    if (!fs.existsSync(COMBINED_HOURS_FILE)) {
        return {};
    }
    try {
        const payload = JSON.parse(fs.readFileSync(COMBINED_HOURS_FILE, 'utf8'));
        return payload && payload.pilots ? payload.pilots : {};
    } catch (error) {
        log(`Failed to parse combined hours cache: ${error.message}`);
        return {};
    }
}

async function runOlcCombinedHoursSync(pilotIds) {
    if (!OLC_DB_PATH || !fs.existsSync(OLC_DB_PATH)) {
        return { skipped: true, reason: 'OLC DB not configured' };
    }

    const syncScriptPath = path.join(process.cwd(), 'sync_weglide_to_olc_db.js');
    if (!fs.existsSync(syncScriptPath)) {
        return { skipped: true, reason: 'sync_weglide_to_olc_db.js not found' };
    }

    const args = [
        syncScriptPath,
        '--db', OLC_DB_PATH,
        '--profiles', PROFILES_FILE,
        '--flights', DATASET_FILE,
        '--user-directory', path.join(process.cwd(), 'weglide_users_all.jsonl'),
        '--export-combined-hours', COMBINED_HOURS_FILE,
        '--cutoff-date', SEASON_BASELINE_DATE
    ];

    if (pilotIds.length) {
        args.push('--pilot-ids', pilotIds.join(','));
    } else {
        args.push('--rebuild-only');
    }

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: process.cwd(),
            env: process.env
        });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => {
            const text = chunk.toString();
            stdout += text;
            text.trim().split('\n').forEach(line => {
                if (line.trim()) log(line.trim());
            });
        });
        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderr += text;
            text.trim().split('\n').forEach(line => {
                if (line.trim()) log(line.trim());
            });
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`OLC combined-hours sync failed (${code}): ${stderr || stdout || 'no output'}`));
                return;
            }
            resolve({
                skipped: false,
                syncedPilotCount: pilotIds.length,
                stdout
            });
        });
    });
}

function jsonRequest(url, { method = 'GET', body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const requestOptions = {
            method,
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: parsedUrl.port || 443,
            headers: Object.assign({
                'Accept': 'application/json',
                'Origin': 'https://www.weglide.org',
                'Referer': 'https://www.weglide.org/',
                'User-Agent': process.env.HTTP_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            }, headers)
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${data || 'No body returned'}`));
                }

                if (!data) {
                    return resolve(null);
                }

                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`Failed to parse JSON response: ${error.message}`));
                }
            });
        });

        req.on('error', reject);

        if (body) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            req.write(payload);
        }

        req.end();
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRepoFilePath(filename) {
    return path.join(process.cwd(), filename);
}

async function fetchGithubRepoText(filename) {
    const encodedPath = filename.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
    const headers = {
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'SAC-Leaderboard-Bot/1.0'
    };

    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`GitHub fetch failed for ${filename}: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

async function loadPersistentText(filename) {
    const repoPath = getRepoFilePath(filename);
    if (fs.existsSync(repoPath)) {
        return fs.readFileSync(repoPath, 'utf8');
    }

    const bootstrapPath = BOOTSTRAP_FILES[filename];
    if (bootstrapPath && fs.existsSync(bootstrapPath)) {
        return fs.readFileSync(bootstrapPath, 'utf8');
    }

    try {
        const githubText = await fetchGithubRepoText(filename);
        if (githubText) {
            return githubText;
        }
    } catch (error) {
        log(`GitHub fallback failed for ${filename}: ${error.message}`);
    }

    if (!usingBlobFallback()) {
        return null;
    }

    try {
        return await blobFetchText(filename);
    } catch (error) {
        log(`Blob fallback failed for ${filename}: ${error.message}`);
        return null;
    }
}

function extractContestFingerprint(flight, contestName) {
    if (!flight || !Array.isArray(flight.contest)) return null;
    // For 'ca' the WeGlide listing endpoint may return either 'ca' or 'au' depending on country.
    const names = contestName === 'ca' ? ['ca', 'au'] : [contestName];
    for (const n of names) {
        const c = flight.contest.find(e => e && e.name === n);
        if (c) {
            return {
                points: typeof c.points === 'number' ? c.points : null,
                distance: typeof c.distance === 'number' ? c.distance : null,
                speed: typeof c.speed === 'number' ? c.speed : null
            };
        }
    }
    return null;
}

function fingerprintsDiffer(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    const eq = (x, y) => {
        const xv = x ?? 0;
        const yv = y ?? 0;
        return Math.abs(xv - yv) < 0.01;
    };
    return !(eq(a.points, b.points) && eq(a.distance, b.distance) && eq(a.speed, b.speed));
}

async function loadExistingFlights() {
    const ids = new Set();
    const fingerprints = new Map();
    const takeoffTimes = new Map();
    let total = 0;
    let latestDate = null;

    const ingest = (flight) => {
        total += 1;
        if (flight.id) {
            ids.add(flight.id);
            fingerprints.set(flight.id, {
                free: extractContestFingerprint(flight, 'free'),
                ca: extractContestFingerprint(flight, 'ca')
            });
            const takeoffMs = flight.takeoff_time ? Date.parse(flight.takeoff_time) : NaN;
            if (Number.isFinite(takeoffMs)) {
                takeoffTimes.set(flight.id, takeoffMs);
            }
        }
        if (flight.scoring_date) {
            const ts = Date.parse(flight.scoring_date);
            if (!Number.isNaN(ts) && (!latestDate || ts > latestDate)) {
                latestDate = ts;
            }
        }
    };

    let sourceStream;
    if (fs.existsSync(DATASET_FILE)) {
        sourceStream = fs.createReadStream(DATASET_FILE);
        const rl = readline.createInterface({ input: sourceStream, crlfDelay: Infinity });

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                ingest(JSON.parse(trimmed));
            } catch (error) {
                log('Skipping invalid flight row:', error.message);
            }
        }
    } else {
        const text = await loadPersistentText(DATASET_BLOB_KEY);
        if (!text) return { ids, total, latestDate, fingerprints };
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                ingest(JSON.parse(trimmed));
            } catch (error) {
                log('Skipping invalid flight row:', error.message);
            }
        }
    }

    return {
        ids,
        total,
        latestDate: latestDate ? new Date(latestDate).toISOString() : null,
        fingerprints,
        takeoffTimes
    };
}

// Recent-window backstop: return flight IDs whose takeoff is within the last
// `days` days. Catches WeGlide flag-only validity flips that the listing-based
// change-detector misses (its diff only sees points/distance/speed).
function findRecentWindowIds(existing, days) {
    const out = new Set();
    if (!existing || !existing.takeoffTimes || days <= 0) return out;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    for (const [id, takeoffMs] of existing.takeoffTimes) {
        if (takeoffMs >= cutoffMs) out.add(id);
    }
    return out;
}

function buildFlightListUrl({ limit, skip, contest }) {
    const params = new URLSearchParams({
        country_id_in: 'CA',
        scoring_date_start: SEASON_START,
        scoring_date_end: SEASON_END,
        limit: String(limit),
        skip: String(skip),
        order_by: '-created'
    });
    if (contest) {
        params.set('contest', contest);
    }

    return `${WEGLIDE_API_BASE}/v1/flight?${params.toString()}`;
}

async function detectChangedFlights(existing, contestName) {
    const changed = new Map(); // id -> { contestName, before, after }
    let pagesScanned = 0;
    for (let batch = 0; ; batch++) {
        const skip = batch * FLIGHT_BATCH_SIZE;
        const url = buildFlightListUrl({ limit: FLIGHT_BATCH_SIZE, skip, contest: contestName });
        let flights;
        try {
            flights = await jsonRequest(url);
        } catch (error) {
            log(`[change-detect/${contestName}] Failed at skip ${skip}: ${error.message}`);
            break;
        }
        if (!Array.isArray(flights) || flights.length === 0) break;
        pagesScanned += 1;

        for (const flight of flights) {
            if (!flight || typeof flight.id !== 'number') continue;
            if (!existing.ids.has(flight.id)) continue;
            const stored = existing.fingerprints.get(flight.id) || {};
            const storedFp = stored[contestName] || null;
            const liveFp = flight.contest
                ? {
                    points: typeof flight.contest.points === 'number' ? flight.contest.points : null,
                    distance: typeof flight.contest.distance === 'number' ? flight.contest.distance : null,
                    speed: typeof flight.contest.speed === 'number' ? flight.contest.speed : null
                }
                : null;
            if (fingerprintsDiffer(storedFp, liveFp)) {
                if (!changed.has(flight.id)) {
                    changed.set(flight.id, { contestName, before: storedFp, after: liveFp });
                }
            }
        }

        if (flights.length < FLIGHT_BATCH_SIZE) break;
        await delay(200);
    }
    log(`[change-detect/${contestName}] scanned ${pagesScanned} page(s), found ${changed.size} changed flight(s).`);
    for (const [id, diff] of changed) {
        const before = diff.before || { points: null, distance: null, speed: null };
        const after = diff.after || { points: null, distance: null, speed: null };
        log(`[change-detect/${contestName}] flight ${id}: ` +
            `points ${before.points} -> ${after.points}, ` +
            `distance ${before.distance} -> ${after.distance}, ` +
            `speed ${before.speed} -> ${after.speed}`);
    }
    return changed;
}

async function fetchRecentFlights(existingIds, limitOverride) {
    const newFlights = [];
    const effectiveLimit = limitOverride || MAX_FLIGHTS_PER_RUN;
    const maxBatches = Math.ceil(effectiveLimit / FLIGHT_BATCH_SIZE) + 5; // Add buffer batches

    for (let batch = 0; batch < maxBatches; batch++) {
        const skip = batch * FLIGHT_BATCH_SIZE;
        const url = buildFlightListUrl({ limit: FLIGHT_BATCH_SIZE, skip });
        log(`Fetching flight batch skip=${skip} ...`);
        let flights;
        try {
            flights = await jsonRequest(url);
        } catch (error) {
            throw new Error(`Failed to fetch flight batch at skip ${skip}: ${error.message}`);
        }

        if (!Array.isArray(flights) || flights.length === 0) {
            break;
        }
        for (const flight of flights) {
            if (!flight || typeof flight.id !== 'number') continue;
            if (existingIds.has(flight.id)) {
                continue;
            }
            newFlights.push(flight);
            if (newFlights.length >= effectiveLimit) {
                return newFlights;
            }
        }

        await delay(200);
    }

    return newFlights;
}

async function fetchFlightDetail(flightId) {
    const url = `${WEGLIDE_API_BASE}/v1/flightdetail/${flightId}`;
    return jsonRequest(url);
}

async function fetchFlightDetails(flights) {
    const details = [];
    for (const flight of flights) {
        try {
            const detail = await fetchFlightDetail(flight.id);
            if (detail) {
                details.push(detail);
            }
        } catch (error) {
            log(`Failed to fetch detail for flight ${flight.id}: ${error.message}`);
        }
        await delay(FLIGHT_DETAIL_DELAY_MS);
    }
    return details;
}

async function appendFlightsToDataset(newFlightDetails) {
    if (!fs.existsSync(DATASET_FILE)) {
        const datasetText = await loadPersistentText(DATASET_BLOB_KEY);
        if (datasetText) {
            fs.writeFileSync(DATASET_FILE, datasetText);
        }
    }

    const payload = newFlightDetails.map(flight => JSON.stringify(flight)).join('\n') + '\n';

    // Write to the working dataset file in /tmp or local directory
    await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(DATASET_FILE, { flags: 'a' });
        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.write(payload);
        stream.end();
    });
}

async function replaceFlightsInDataset(updatedFlightDetails) {
    if (!updatedFlightDetails.length) return 0;
    if (!fs.existsSync(DATASET_FILE)) {
        const datasetText = await loadPersistentText(DATASET_BLOB_KEY);
        if (datasetText) {
            fs.writeFileSync(DATASET_FILE, datasetText);
        } else {
            return 0;
        }
    }

    const replacements = new Map(updatedFlightDetails.map(f => [f.id, f]));
    const text = fs.readFileSync(DATASET_FILE, 'utf8');
    const lines = text.split('\n');
    let replacedCount = 0;
    const outLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        try {
            const flight = JSON.parse(trimmed);
            if (flight && replacements.has(flight.id)) {
                replacedCount += 1;
                return JSON.stringify(replacements.get(flight.id));
            }
        } catch (e) {
            // leave malformed lines untouched
        }
        return line;
    });
    fs.writeFileSync(DATASET_FILE, outLines.join('\n'));
    return replacedCount;
}

async function loadProfiles() {
    if (fs.existsSync(PROFILES_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
        } catch (error) {
            log('Failed to parse working profiles file, rebuilding from persistence:', error.message);
        }
    }

    const text = await loadPersistentText(PROFILES_BLOB_KEY);
    if (text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            log('Failed to parse persisted profiles:', e.message);
            return {};
        }
    }
    if (!fs.existsSync(PROFILES_FILE)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    } catch (error) {
        log('Failed to parse profiles file, rebuilding from scratch:', error.message);
        return {};
    }
}

async function fetchUserProfiles(pilotIds) {
    const chunkSize = 50;
    const result = [];
    for (let i = 0; i < pilotIds.length; i += chunkSize) {
        const chunk = pilotIds.slice(i, i + chunkSize);
        const params = new URLSearchParams({ id_in: chunk.join(',') });
        const url = `${WEGLIDE_API_BASE}/v1/user?${params.toString()}`;
        try {
            const data = await jsonRequest(url);
            if (Array.isArray(data)) {
                result.push(...data);
            }
        } catch (error) {
            log(`Failed to fetch user profiles for chunk starting at index ${i}: ${error.message}`);
        }
        await delay(200);
    }
    return result;
}

function persistProfiles(profiles) {
    const serialized = JSON.stringify(profiles, null, 2);

    fs.writeFileSync(PROFILES_FILE, serialized);
}

async function computeSeasonSecondsForPilots(pilotIds) {
    const totals = {};
    if (!pilotIds.length) {
        return totals;
    }
    const pilotSet = new Set(pilotIds.map(id => Number(id)));
    const baselineTimestamp = Date.parse(`${SEASON_BASELINE_DATE}T00:00:00Z`);
    let text = null;
    if (fs.existsSync(DATASET_FILE)) {
        text = fs.readFileSync(DATASET_FILE, 'utf8');
    } else {
        text = await loadPersistentText(DATASET_BLOB_KEY);
    }
    if (text) {
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let flight;
            try {
                flight = JSON.parse(trimmed);
            } catch (error) {
                continue;
            }
            const pilotId = flight?.user?.id;
            if (!pilotSet.has(Number(pilotId))) continue;
            const dateStr = flight.scoring_date || flight.date;
            if (!dateStr) continue;
            const normalizedDate = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00Z`;
            const flightTimestamp = Date.parse(normalizedDate);
            if (Number.isNaN(flightTimestamp) || flightTimestamp < baselineTimestamp) continue;
            const seconds = Number(flight.total_seconds) || 0;
            if (seconds > 0) {
                totals[pilotId] = (totals[pilotId] || 0) + seconds;
            }
        }
        return totals;
    }

    if (!fs.existsSync(DATASET_FILE)) {
        return totals;
    }

    const fileStream = fs.createReadStream(DATASET_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let flight;
        try {
            flight = JSON.parse(trimmed);
        } catch (error) {
            continue;
        }
        const pilotId = flight?.user?.id;
        if (!pilotSet.has(Number(pilotId))) {
            continue;
        }
        const dateStr = flight.scoring_date || flight.date;
        if (!dateStr) continue;
        const normalizedDate = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00Z`;
        const flightTimestamp = Date.parse(normalizedDate);
        if (Number.isNaN(flightTimestamp) || flightTimestamp < baselineTimestamp) {
            continue;
        }
        const seconds = Number(flight.total_seconds) || 0;
        if (seconds > 0) {
            totals[pilotId] = (totals[pilotId] || 0) + seconds;
        }
    }

    return totals;
}

async function uploadPilotVerifications(newProfiles, seasonSecondsMap, combinedHoursMap) {
    if (!newProfiles.length) {
        return { uploaded: 0, skipped: true, reason: 'no new pilots' };
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT || null;

    if (!projectId && !serviceAccountJSON) {
        return { uploaded: 0, skipped: true, reason: 'Missing Firebase credentials' };
    }

    let admin;
    try {
        admin = require('firebase-admin');
    } catch (error) {
        return { uploaded: 0, skipped: true, reason: 'firebase-admin not installed' };
    }

    if (!admin.apps.length) {
        if (serviceAccountJSON) {
            let credentials;
            try {
                credentials = JSON.parse(serviceAccountJSON);
            } catch (error) {
                return { uploaded: 0, skipped: true, reason: 'Invalid FIREBASE_SERVICE_ACCOUNT JSON' };
            }
            admin.initializeApp({
                credential: admin.credential.cert(credentials),
                projectId: credentials.project_id || projectId
            });
        } else {
            admin.initializeApp({ projectId });
        }
    }

    const db = admin.firestore();
    let uploaded = 0;

    for (const profile of newProfiles) {
        if (!profile || typeof profile.id !== 'number') continue;
        const lifetimeHours = (Number(profile.total_flight_duration) || 0) / 3600;
        const seasonHours = ((seasonSecondsMap[profile.id] || 0) / 3600);
        const combinedHours = combinedHoursMap[String(profile.id)] || null;
        const totalCombinedHours = combinedHours && typeof combinedHours.combinedHours === 'number'
            ? combinedHours.combinedHours
            : lifetimeHours;
        const olcOnlyHours = combinedHours && typeof combinedHours.olcOnlyHours === 'number'
            ? combinedHours.olcOnlyHours
            : 0;
        const baselineHours = combinedHours && typeof combinedHours.combinedHoursBeforeCutoff === 'number'
            ? combinedHours.combinedHoursBeforeCutoff
            : Math.max(0, lifetimeHours - seasonHours);
        const eligible = baselineHours < 200;

        const verificationData = {
            pilotName: profile.name || 'Unknown Pilot',
            picHours: Number(baselineHours.toFixed(1)),
            verifiedDate: new Date().toISOString(),
            dataSource: olcOnlyHours > 0 ? 'combined-hours-automatic' : 'weglide-automatic',
            eligible,
            calculation: {
                cutoffDate: SEASON_BASELINE_DATE,
                totalCombinedHours: Number(totalCombinedHours.toFixed(1)),
                totalWeGlideHours: Number(lifetimeHours.toFixed(1)),
                olcOnlyHours: Number(olcOnlyHours.toFixed(1)),
                hoursSinceSeasonStart: Number(seasonHours.toFixed(1)),
                baselineHours: Number(baselineHours.toFixed(1)),
                note: olcOnlyHours > 0
                    ? 'Baseline uses combined OLC + WeGlide hours before cutoff date'
                    : 'Baseline = lifetime WeGlide hours - post-season-start hours'
            }
        };

        try {
            await db.collection('pilot_verifications').doc(String(profile.id)).set(verificationData, { merge: true });
            uploaded += 1;
        } catch (error) {
            log(`Failed to upload verification for pilot ${profile.id}: ${error.message}`);
        }
    }

    return { uploaded, skipped: false };
}

// Import the builder directly to ensure it's bundled and avoids spawn issues
// Revert to clean state (re-deploy)
const builder = require('../create_canadian_leaderboard_from_jsonl.js');

async function ensureLocalCopiesFromRepo() {
    if (!fs.existsSync(DATASET_FILE)) {
        const datasetText = await loadPersistentText('canadian_flights_2026_details.jsonl');
        if (datasetText) {
            log('Loading dataset from repository/GitHub persistence...');
            fs.writeFileSync(DATASET_FILE, datasetText);
        } else {
            throw new Error('Dataset file not found in repository; cannot build leaderboard');
        }
    }

    if (!fs.existsSync(PROFILES_FILE)) {
        const profilesText = await loadPersistentText('canadian_user_profiles.json');
        if (profilesText) {
            log('Loading profiles from repository/GitHub persistence...');
            fs.writeFileSync(PROFILES_FILE, profilesText);
        }
    }

    if (!fs.existsSync(COMBINED_HOURS_FILE)) {
        const combinedHoursText = await loadPersistentText('canadian_combined_hours.json');
        if (combinedHoursText) {
            log('Loading combined hours cache from repository/GitHub persistence...');
            fs.writeFileSync(COMBINED_HOURS_FILE, combinedHoursText);
        }
    }
}

async function syncArtifactsToGitHub(artifacts) {
    if (!process.env.GITHUB_TOKEN) {
        return { pushed: false, skipped: true, reason: 'GITHUB_TOKEN not set' };
    }

    const githubHeaders = (accept = 'application/vnd.github+json') => ({
        'Accept': accept,
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'User-Agent': 'SAC-Leaderboard-Bot/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
    });

    const encodedBranch = encodeURIComponent(GITHUB_BRANCH);
    const apiBase = `https://api.github.com/repos/${GITHUB_REPO}`;

    const refResponse = await fetch(`${apiBase}/git/ref/heads/${encodedBranch}`, {
        headers: githubHeaders()
    });
    if (!refResponse.ok) {
        const details = await refResponse.text();
        throw new Error(`GitHub ref lookup failed: ${refResponse.status} ${refResponse.statusText} ${details}`);
    }
    const refData = await refResponse.json();
    const currentCommitSha = refData.object.sha;

    const commitResponse = await fetch(`${apiBase}/git/commits/${currentCommitSha}`, {
        headers: githubHeaders()
    });
    if (!commitResponse.ok) {
        const details = await commitResponse.text();
        throw new Error(`GitHub commit lookup failed: ${commitResponse.status} ${commitResponse.statusText} ${details}`);
    }
    const commitData = await commitResponse.json();

    const changedArtifacts = [];
    for (const artifact of artifacts) {
        if (!artifact || !fs.existsSync(artifact.localPath)) {
            continue;
        }

        const localContent = fs.readFileSync(artifact.localPath, 'utf8');
        let remoteContent = null;
        try {
            remoteContent = await fetchGithubRepoText(artifact.repoPath);
        } catch (error) {
            log(`GitHub compare failed for ${artifact.repoPath}: ${error.message}`);
        }

        if (remoteContent === localContent) {
            continue;
        }

        const blobResponse = await fetch(`${apiBase}/git/blobs`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, githubHeaders()),
            body: JSON.stringify({
                content: Buffer.from(localContent, 'utf8').toString('base64'),
                encoding: 'base64'
            })
        });
        if (!blobResponse.ok) {
            const details = await blobResponse.text();
            throw new Error(`GitHub blob create failed for ${artifact.repoPath}: ${blobResponse.status} ${blobResponse.statusText} ${details}`);
        }

        const blobData = await blobResponse.json();
        changedArtifacts.push({
            path: artifact.repoPath,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
        });
    }

    if (!changedArtifacts.length) {
        return { pushed: false, skipped: true, reason: 'No changes to commit' };
    }

    const timestamp = new Date().toISOString();
    const treeResponse = await fetch(`${apiBase}/git/trees`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, githubHeaders()),
        body: JSON.stringify({
            base_tree: commitData.tree.sha,
            tree: changedArtifacts
        })
    });
    if (!treeResponse.ok) {
        const details = await treeResponse.text();
        throw new Error(`GitHub tree create failed: ${treeResponse.status} ${treeResponse.statusText} ${details}`);
    }
    const treeData = await treeResponse.json();

    const newCommitResponse = await fetch(`${apiBase}/git/commits`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, githubHeaders()),
        body: JSON.stringify({
            message: `Auto-update leaderboard - ${timestamp} [skip ci]`,
            tree: treeData.sha,
            parents: [currentCommitSha]
        })
    });
    if (!newCommitResponse.ok) {
        const details = await newCommitResponse.text();
        throw new Error(`GitHub commit create failed: ${newCommitResponse.status} ${newCommitResponse.statusText} ${details}`);
    }
    const newCommitData = await newCommitResponse.json();

    const updateRefResponse = await fetch(`${apiBase}/git/refs/heads/${encodedBranch}`, {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, githubHeaders()),
        body: JSON.stringify({
            sha: newCommitData.sha,
            force: false
        })
    });
    if (!updateRefResponse.ok) {
        const details = await updateRefResponse.text();
        throw new Error(`GitHub ref update failed: ${updateRefResponse.status} ${updateRefResponse.statusText} ${details}`);
    }

    return { pushed: true, skipped: false, files: changedArtifacts.map(file => file.path) };
}

async function runLeaderboardBuild() {
    log('Starting leaderboard build (in-process)...');
    
    // Set env vars that the builder expects
    process.env.INPUT_FILE = DATASET_FILE;
    process.env.OUTPUT_DIR = TMP_DIR;
    process.env.TEMPLATE_FILE = path.join(__dirname, '../canadian_leaderboard_2025_embedded.html');
    // Also pass the firebase/verification paths if needed (the script resolves them relative to CWD or OUTPUT_DIR?)
    // The script uses resolvePath() which joins OUTPUT_DIR. 
    // But it reads 'canadian_user_durations.json' etc. using resolvePath too? 
    // No, it uses resolvePath for input/output.
    
    // We need to ensure the builder can find the template. 
    // The builder uses fs.readFileSync(TEMPLATE_FILE).
    // We set TEMPLATE_FILE above to the absolute path.
    
    // Capture console logs from the builder?
    // The builder logs to console.log, which will show up in Vercel logs automatically.
    
    try {
        await builder.processCanadianFlights();
        return { success: true, stdout: 'Build completed successfully via module import' };
    } catch (error) {
        console.error('Build failed:', error);
        throw error;
    }
}

function acquireLock() {
    if (fs.existsSync(LOCK_FILE)) {
        throw new Error('Fetch-and-build already running');
    }
    fs.writeFileSync(LOCK_FILE, String(Date.now()));
}

function releaseLock() {
    if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
    }
}

async function runFetchAndBuild(options = {}) {
    const startTime = Date.now();
    globalLogBuffer = [];
    const summary = {
        status: 'ok',
        trigger: options.trigger || 'unknown',
        logs: globalLogBuffer,
        meta: {
            startTime: new Date(startTime).toISOString()
        }
    };

    let lockAcquired = false;

    try {
        acquireLock();
        lockAcquired = true;

        const existing = await loadExistingFlights();
        summary.meta.existingFlights = existing.total;
        summary.meta.latestFlightDate = existing.latestDate;
        summary.meta.persistence = 'github';
        summary.meta.blobFallbackEnabled = usingBlobFallback();

        await ensureLocalCopiesFromRepo();

        const newFlights = await fetchRecentFlights(existing.ids, options.limitOverride);
        summary.meta.newFlights = newFlights.length;

        // Sweep listings for re-analyzed flights — twice, once per contest.
        const changedAcrossSweeps = new Map();
        for (const contestName of ['free', 'ca']) {
            const changed = await detectChangedFlights(existing, contestName);
            for (const [id, diff] of changed) {
                if (!changedAcrossSweeps.has(id)) {
                    changedAcrossSweeps.set(id, []);
                }
                changedAcrossSweeps.get(id).push(diff);
            }
        }
        const newIdSet = new Set(newFlights.map(f => f.id));
        const changedIds = [...changedAcrossSweeps.keys()].filter(id => !newIdSet.has(id));
        summary.meta.changedFlights = changedIds.length;
        if (changedIds.length) {
            summary.meta.changedFlightDetails = changedIds.map(id => ({
                id,
                diffs: changedAcrossSweeps.get(id)
            }));
            log(`Detected ${changedIds.length} re-analyzed flight(s) needing detail refresh: ${changedIds.join(', ')}`);
        }

        // Backstop refresh — handles flag-only flips that change-detection misses.
        // fullRefresh: re-pull every stored flight (weekly).
        // Otherwise: re-pull every flight whose takeoff is within RECENT_REFRESH_DAYS days.
        const recentRefreshDays = options.fullRefresh ? null : RECENT_REFRESH_DAYS;
        const refreshSet = options.fullRefresh
            ? new Set(existing.ids)
            : findRecentWindowIds(existing, recentRefreshDays);
        // exclude IDs already covered by new-flight or change-detection paths
        for (const id of newIdSet) refreshSet.delete(id);
        for (const id of changedIds) refreshSet.delete(id);
        summary.meta.refreshMode = options.fullRefresh ? 'full' : `last_${RECENT_REFRESH_DAYS}_days`;
        summary.meta.refreshFlights = refreshSet.size;
        if (refreshSet.size) {
            log(`Backstop refresh (${summary.meta.refreshMode}): ${refreshSet.size} flight(s) to refetch.`);
        }

        if (newFlights.length === 0 && changedIds.length === 0 && refreshSet.size === 0 && !options.forceBuild) {
            summary.status = 'no_changes';
            summary.message = 'No new or changed flights detected';
            return summary;
        }

        let flightDetails = [];
        if (newFlights.length > 0) {
            flightDetails = await fetchFlightDetails(newFlights);
            summary.meta.detailsFetched = flightDetails.length;

            if (!flightDetails.length) {
                summary.status = 'error';
                summary.message = 'Failed to fetch flight details for new flights';
                return summary;
            }

            await appendFlightsToDataset(flightDetails);
            summary.meta.datasetUpdated = true;
        }

        const refreshIds = [...changedIds, ...refreshSet];
        if (refreshIds.length > 0) {
            const refreshDetails = await fetchFlightDetails(refreshIds.map(id => ({ id })));
            summary.meta.refreshDetailsFetched = refreshDetails.length;
            if (refreshDetails.length) {
                const replaced = await replaceFlightsInDataset(refreshDetails);
                summary.meta.datasetUpdated = true;
                summary.meta.flightsReplaced = replaced;
                log(`Replaced ${replaced} flight(s) in dataset (${changedIds.length} change-detected, ${refreshSet.size} window-refresh).`);
            }
        }

        const profiles = await loadProfiles();
        const currentIds = new Set(Object.keys(profiles).map(id => Number(id)));
        const newPilotIds = [];
        const pendingPilotSet = new Set();
        
        // If no new flights, flightDetails is empty, so no new pilots from this run
        flightDetails.forEach(flight => {
            const pilotId = flight?.user?.id;
            if (typeof pilotId === 'number' && !currentIds.has(pilotId) && !pendingPilotSet.has(pilotId)) {
                newPilotIds.push(pilotId);
                pendingPilotSet.add(pilotId);
            }
        });
        summary.meta.newPilotCount = newPilotIds.length;

        let newProfiles = [];
        if (newPilotIds.length) {
            newProfiles = await fetchUserProfiles(newPilotIds);
            newProfiles.forEach(profile => {
                if (profile && typeof profile.id === 'number') {
                    profiles[profile.id] = {
                        total_flight_duration: profile.total_flight_duration || 0,
                        total_free_distance: profile.total_free_distance || 0,
                        avg_speed: profile.avg_speed || 0,
                        flight_count: profile.flight_count || 0,
                        avg_glide_speed: profile.avg_glide_speed || 0,
                        avg_glide_detour: profile.avg_glide_detour || 0,
                        achievement_count: profile.achievement_count || 0,
                        name: profile.name || '',
                        gender: profile.gender || '',
                        club: profile.club || null
                    };
                }
            });
            persistProfiles(profiles);
        }

        summary.meta.profilesUpdated = newProfiles.length;

        const seasonSecondsMap = await computeSeasonSecondsForPilots(newPilotIds);
        summary.meta.seasonSecondsCalculated = Object.keys(seasonSecondsMap).length;

        let olcSyncSummary = { skipped: true, reason: 'No OLC sync attempted' };
        if (newPilotIds.length || !fs.existsSync(COMBINED_HOURS_FILE)) {
            olcSyncSummary = await runOlcCombinedHoursSync(newPilotIds);
        }
        summary.meta.olcSync = olcSyncSummary;

        const combinedHoursMap = loadCombinedHoursCache();
        summary.meta.combinedHoursCachedPilots = Object.keys(combinedHoursMap).length;

        const firebaseSummary = await uploadPilotVerifications(newProfiles, seasonSecondsMap, combinedHoursMap);
        summary.meta.firebase = firebaseSummary;

        const buildResult = await runLeaderboardBuild();
        summary.meta.build = { success: true, outputLines: buildResult.stdout.split('\n').length };

        summary.logs = [];
        const publicArtifacts = [
            { repoPath: 'public/SAC_leaderboard_sac_dsc.html', localPath: path.join(TMP_DIR, 'SAC_leaderboard_sac_dsc.html') },
            { repoPath: 'public/SAC_leaderboard.html', localPath: path.join(TMP_DIR, 'SAC_leaderboard.html') },
            { repoPath: 'public/leaderboard_data.json', localPath: path.join(TMP_DIR, 'leaderboard_data.json') }
        ];
        const persistenceArtifacts = [
            { repoPath: 'canadian_flights_2026_details.jsonl', localPath: DATASET_FILE },
            { repoPath: 'canadian_user_profiles.json', localPath: PROFILES_FILE },
            { repoPath: 'canadian_combined_hours.json', localPath: COMBINED_HOURS_FILE },
            ...publicArtifacts
        ];

        if (TMP_DIR === process.cwd()) {
            const publicDir = path.join(process.cwd(), 'public');
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }

            for (const artifact of publicArtifacts) {
                const sourcePath = artifact.localPath;
                const destPath = path.join(process.cwd(), artifact.repoPath);
                if (fs.existsSync(sourcePath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    const msg = `Successfully copied ${path.basename(sourcePath)} to ${artifact.repoPath}.`;
                    log(msg);
                    summary.logs.push(msg);
                } else {
                    const msg = `Warning: ${path.basename(sourcePath)} not found at ${sourcePath}. Not copied.`;
                    log(msg);
                    summary.logs.push(msg);
                }
            }
        }

        const syncSummary = await syncArtifactsToGitHub(persistenceArtifacts);
        summary.meta.gitSync = syncSummary;
        if (syncSummary.pushed) {
            const msg = `Synced ${syncSummary.files.length} artifact(s) to GitHub.`;
            log(msg);
            summary.logs.push(msg);
        } else {
            const msg = `GitHub sync skipped: ${syncSummary.reason}`;
            log(msg);
            summary.logs.push(msg);
        }

        summary.message = `Processed ${flightDetails.length} new flights and rebuilt leaderboard`;

    } catch (error) {
        summary.status = 'error';
        summary.message = error.message;
        summary.meta.errorStack = error.stack;
    } finally {
        if (lockAcquired) {
            releaseLock();
        }
        summary.meta.endTime = new Date().toISOString();
        summary.meta.durationMs = Date.now() - startTime;
    }

    return summary;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = (req.headers['x-update-token'] || req.query?.token || req.body?.token || '').trim();
    if (UPDATE_TOKEN && token !== UPDATE_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const trigger = req.headers['x-trigger-source'] || 'api';
    const summary = await runFetchAndBuild({ trigger });
    const statusCode = summary.status === 'error' ? 500 : 200;
    return res.status(statusCode).json(summary);
};

module.exports.runFetchAndBuild = runFetchAndBuild;
