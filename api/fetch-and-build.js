const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { spawn } = require('child_process');

// Prefer Vercel Blob for persistence when available; fall back to local FS during dev
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null;
const BLOB_BASE_URL = process.env.BLOB_BASE_URL || 'https://blob.vercel-storage.com';
const DATASET_BLOB_KEY = process.env.DATASET_BLOB_KEY || 'canadian_flights_2026_details.jsonl';
const PROFILES_BLOB_KEY = process.env.PROFILES_BLOB_KEY || 'canadian_user_profiles.json';

const usingBlob = () => Boolean(BLOB_TOKEN);
const TMP_DIR = usingBlob() ? '/tmp' : process.cwd();

const DATASET_FILE = path.join(TMP_DIR, process.env.CANADIAN_FLIGHTS_FILE || 'canadian_flights_2026_details.jsonl');
const PROFILES_FILE = path.join(TMP_DIR, process.env.CANADIAN_PROFILES_FILE || 'canadian_user_profiles.json');
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

function log(...args) {
    console.log('[fetch-and-build]', ...args);
}


async function blobFetchText(key) {
    if (!usingBlob()) return null;
    const res = await fetch(`${BLOB_BASE_URL.replace(/\/$/, '')}/${key}`, {
        headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Blob fetch failed for ${key}: ${res.status} ${res.statusText}`);
    }
    return res.text();
}

async function blobPutText(key, body, contentType = 'application/octet-stream') {
    if (!usingBlob()) return;
    const res = await fetch(`${BLOB_BASE_URL.replace(/\/$/, '')}/${key}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${BLOB_TOKEN}`,
            'Content-Type': contentType
        },
        body
    });
    if (!res.ok) {
        throw new Error(`Blob write failed for ${key}: ${res.status} ${res.statusText}`);
    }
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

async function loadExistingFlights() {
    const ids = new Set();
    let total = 0;
    let latestDate = null;

    let sourceStream;
    if (usingBlob()) {
        const text = await blobFetchText(DATASET_BLOB_KEY);
        if (!text) return { ids, total, latestDate };
        // Simulate streaming by iterating lines
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const flight = JSON.parse(trimmed);
                total += 1;
                if (flight.id) ids.add(flight.id);
                if (flight.scoring_date) {
                    const ts = Date.parse(flight.scoring_date);
                    if (!Number.isNaN(ts) && (!latestDate || ts > latestDate)) {
                        latestDate = ts;
                    }
                }
            } catch (error) {
                log('Skipping invalid flight row:', error.message);
            }
        }
    } else {
        if (!fs.existsSync(DATASET_FILE)) {
            return { ids, total, latestDate };
        }
        sourceStream = fs.createReadStream(DATASET_FILE);
        const rl = readline.createInterface({ input: sourceStream, crlfDelay: Infinity });

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const flight = JSON.parse(trimmed);
                total += 1;
                if (flight.id) {
                    ids.add(flight.id);
                }
                if (flight.scoring_date) {
                    const timestamp = Date.parse(flight.scoring_date);
                    if (!Number.isNaN(timestamp) && (!latestDate || timestamp > latestDate)) {
                        latestDate = timestamp;
                    }
                }
            } catch (error) {
                log('Skipping invalid flight row:', error.message);
            }
        }
    }

    return {
        ids,
        total,
        latestDate: latestDate ? new Date(latestDate).toISOString() : null
    };
}

function buildFlightListUrl({ limit, skip }) {
    const params = new URLSearchParams({
        country_id_in: 'CA',
        scoring_date_start: SEASON_START,
        scoring_date_end: SEASON_END,
        limit: String(limit),
        skip: String(skip)
    });

    return `${WEGLIDE_API_BASE}/v1/flight?${params.toString()}`;
}

async function fetchRecentFlights(existingIds) {
    const newFlights = [];
    const maxBatches = Math.ceil(MAX_FLIGHTS_PER_RUN / FLIGHT_BATCH_SIZE) + 1;

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
            if (newFlights.length >= MAX_FLIGHTS_PER_RUN) {
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
    const payload = newFlightDetails.map(flight => JSON.stringify(flight)).join('\n') + '\n';

    if (usingBlob()) {
        const existing = await blobFetchText(DATASET_BLOB_KEY);
        const combined = (existing || '') + payload;
        await blobPutText(DATASET_BLOB_KEY, combined, 'application/x-jsonlines');
        fs.writeFileSync(DATASET_FILE, combined);
    } else {
        await new Promise((resolve, reject) => {
            const stream = fs.createWriteStream(DATASET_FILE, { flags: 'a' });
            stream.on('error', reject);
            stream.on('finish', resolve);
            stream.write(payload);
            stream.end();
        });
    }
}

async function loadProfiles() {
    if (usingBlob()) {
        const text = await blobFetchText(PROFILES_BLOB_KEY);
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch (e) {
            log('Failed to parse blob profiles:', e.message);
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
    if (usingBlob()) {
        fs.writeFileSync(PROFILES_FILE, serialized);
        return blobPutText(PROFILES_BLOB_KEY, serialized, 'application/json');
    }
    fs.writeFileSync(PROFILES_FILE, serialized);
}

async function computeSeasonSecondsForPilots(pilotIds) {
    const totals = {};
    if (!pilotIds.length) {
        return totals;
    }
    const pilotSet = new Set(pilotIds.map(id => Number(id)));
    const baselineTimestamp = Date.parse(`${SEASON_BASELINE_DATE}T00:00:00Z`);
    const text = usingBlob() ? await blobFetchText(DATASET_BLOB_KEY) : null;
    if (usingBlob()) {
        if (!text) return totals;
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

async function uploadPilotVerifications(newProfiles, seasonSecondsMap) {
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
        const baselineHours = Math.max(0, lifetimeHours - seasonHours);
        const eligible = baselineHours < 200;

        const verificationData = {
            pilotName: profile.name || 'Unknown Pilot',
            picHours: Number(baselineHours.toFixed(1)),
            verifiedDate: new Date().toISOString(),
            dataSource: 'weglide-automatic',
            eligible,
            calculation: {
                totalWeGlideHours: Number(lifetimeHours.toFixed(1)),
                hoursSinceSeasonStart: Number(seasonHours.toFixed(1)),
                baselineHours: Number(baselineHours.toFixed(1)),
                note: 'Baseline = lifetime hours - post-season-start hours'
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
const builder = require('../create_canadian_leaderboard_from_jsonl.js');

async function ensureLocalCopiesFromBlob() {
    if (!usingBlob()) return;

    // 1. Dataset Bootstrap
    const datasetText = await blobFetchText(DATASET_BLOB_KEY);
    if (datasetText) {
        fs.writeFileSync(DATASET_FILE, datasetText);
    } else {
        // Bootstrap from local repo file if Blob is empty
        const localPath = path.join(process.cwd(), 'canadian_flights_2026_details.jsonl');
        if (fs.existsSync(localPath)) {
             log('Bootstrapping dataset from local repo file...');
             const content = fs.readFileSync(localPath, 'utf8');
             fs.writeFileSync(DATASET_FILE, content);
             // Upload to Blob so next time it's there
             await blobPutText(DATASET_BLOB_KEY, content, 'application/x-jsonlines');
        } else if (!fs.existsSync(DATASET_FILE)) {
            // If we can't find it in Blob OR local repo, we can't build.
            // (Note: DATASET_FILE is in /tmp, so checking it here just confirms we failed to write it)
            throw new Error('Dataset blob is empty and local repo file not found; cannot build leaderboard');
        }
    }

    // 2. Profiles Bootstrap
    const profilesText = await blobFetchText(PROFILES_BLOB_KEY);
    if (profilesText) {
        fs.writeFileSync(PROFILES_FILE, profilesText);
    } else {
        const localProfiles = path.join(process.cwd(), 'canadian_user_profiles.json');
        if (fs.existsSync(localProfiles)) {
             log('Bootstrapping profiles from local repo file...');
             const content = fs.readFileSync(localProfiles, 'utf8');
             fs.writeFileSync(PROFILES_FILE, content);
             await blobPutText(PROFILES_BLOB_KEY, content, 'application/json');
        }
    }
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
    const summary = {
        status: 'ok',
        trigger: options.trigger || 'unknown',
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
        summary.meta.persistence = usingBlob() ? 'blob' : 'filesystem';

        const newFlights = await fetchRecentFlights(existing.ids);
        summary.meta.newFlights = newFlights.length;

        if (newFlights.length === 0) {
            summary.status = 'no_changes';
            summary.message = 'No new flights detected';
            return summary;
        }

        const flightDetails = await fetchFlightDetails(newFlights);
        summary.meta.detailsFetched = flightDetails.length;

        if (!flightDetails.length) {
            summary.status = 'error';
            summary.message = 'Failed to fetch flight details for new flights';
            return summary;
        }

        await appendFlightsToDataset(flightDetails);
        summary.meta.datasetUpdated = true;

        const profiles = await loadProfiles();
        const currentIds = new Set(Object.keys(profiles).map(id => Number(id)));
        const newPilotIds = [];
        const pendingPilotSet = new Set();
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

        const firebaseSummary = await uploadPilotVerifications(newProfiles, seasonSecondsMap);
        summary.meta.firebase = firebaseSummary;

        // Ensure local copies exist for the build step when using blob
        await ensureLocalCopiesFromBlob();

        const buildResult = await runLeaderboardBuild();
        summary.meta.build = { success: true, outputLines: buildResult.stdout.split('\n').length };

        if (usingBlob()) {
            const htmlFiles = ['SAC_leaderboard_sac_dsc.html', 'SAC_leaderboard.html'];
            for (const file of htmlFiles) {
                const filePath = path.join(TMP_DIR, file);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    await blobPutText(file, content, 'text/html');
                    log(`Successfully uploaded ${file} to Blob.`);
                } else {
                    log(`Warning: ${file} not found at ${filePath}. Not uploaded to Blob.`);
                }
            }
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
