/**
 * Vercel Serverless Function: Check for New Canadian Flights
 */

const { get: getBlob } = require('@vercel/blob');
// fetch is global in Node 18+

const trimEnv = (val, fallback) => (val && typeof val === 'string') ? val.trim() : fallback;
const WEGLIDE_API_BASE = trimEnv(process.env.WEGLIDE_API_BASE, 'https://api.weglide.org');
const SEASON_START = trimEnv(process.env.SEASON_START, '2025-09-23');
const SEASON_END = trimEnv(process.env.SEASON_END, '2026-09-30');
const GITHUB_REPO = process.env.GITHUB_REPO || 'ryanwoodie/WeGlide-API';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_UPDATE_WORKFLOW = process.env.GITHUB_UPDATE_WORKFLOW || 'update-on-flight.yml';
const UPDATE_STATE_KEY = process.env.UPDATE_STATE_KEY || 'canadian_flights_update_state.json';

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

/**
 * Fetch latest Canadian flight from WeGlide API
 */
async function fetchLatestFlight() {
    const params = new URLSearchParams({
        country_id_in: 'CA',
        scoring_date_start: SEASON_START,
        scoring_date_end: SEASON_END,
        limit: '1',
        skip: '0',
        order_by: '-created'
    });
    const url = `${WEGLIDE_API_BASE}/v1/flight?${params.toString()}`;

    const headers = {
        'Accept': 'application/json',
        'Origin': 'https://www.weglide.org',
        'Referer': 'https://www.weglide.org/',
        'User-Agent': process.env.HTTP_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`WeGlide API error: ${response.status}`);
    }
    const json = await response.json();
    return (json && json.length > 0) ? json[0] : null;
}

/**
 * Read the small durable update marker from the canonical GitHub branch.
 * Never inspect the bundled dataset here: it is large and can be stale while
 * a newer deployment is building.
 */
async function getUpdateState() {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
            const result = await getBlob(UPDATE_STATE_KEY, {
                access: 'public',
                token: process.env.BLOB_READ_WRITE_TOKEN
            });
            if (result?.statusCode === 200 && result.stream) {
                return JSON.parse(await new Response(result.stream).text());
            }
        } catch (err) {
            console.error('[check-flights] Blob update-state read failed:', err);
        }
    }

    try {
        const text = await fetchGithubRepoText(UPDATE_STATE_KEY);
        if (!text) {
            console.log('[check-flights] Update state is not initialized yet');
            return null;
        }
        return JSON.parse(text);
    } catch (err) {
        console.error('[check-flights] Error reading update state:', err);
        return null;
    }
}

/**
 * Dispatch the serialized GitHub workflow instead of starting heavyweight work
 * in this polling invocation. GitHub concurrency coalesces repeated detections
 * while an earlier update is still running.
 */
async function dispatchNewFlightUpdate() {
    if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN is required to dispatch the update workflow');
    }

    const workflow = encodeURIComponent(GITHUB_UPDATE_WORKFLOW);
    const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SAC-Leaderboard-Bot/1.0',
            'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ ref: GITHUB_BRANCH })
    });

    if (!response.ok) {
        throw new Error(`GitHub workflow dispatch failed: ${response.status} ${response.statusText}`);
    }
}

/**
 * Main handler function
 */
module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Fetch latest flight from WeGlide
        const latestFlight = await fetchLatestFlight();

        if (!latestFlight) {
            return res.status(200).json({
                status: 'no_flights',
                message: 'No flights found for the season'
            });
        }

        const latestFlightId = latestFlight.id;

        const updateState = await getUpdateState();
        if (!updateState || !updateState.latestFlightId) {
            return res.status(200).json({
                status: 'state_unavailable',
                message: 'Update state will be initialized by the next scheduled batch',
                latestFlightId,
                buildTriggered: false
            });
        }

        const isNew = updateState.latestFlightId !== latestFlightId;

        if (isNew) {
            console.log(`[check-flights] New flight detected: ${latestFlightId}. Dispatching serialized update.`);
            await dispatchNewFlightUpdate();
            return res.status(200).json({
                status: 'new_data_available',
                message: 'New flight detected; an immediate serialized update was dispatched',
                latestFlightId,
                knownLatestFlightId: updateState.latestFlightId,
                buildTriggered: true,
                trigger: 'github_workflow'
            });
        } else {
            console.log(`[check-flights] Flight ${latestFlightId} already known.`);
            return res.status(200).json({
                status: 'no_changes',
                message: 'No new flights since last check',
                latestFlightId,
                buildTriggered: false
            });
        }

    } catch (error) {
        console.error('[check-flights] Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to check for new flights',
            error: error.message
        });
    }
};
