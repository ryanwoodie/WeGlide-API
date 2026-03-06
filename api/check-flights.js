/**
 * Vercel Serverless Function: Check for New Canadian Flights
 */

const https = require('https');
// fetch is global in Node 18+

const trimEnv = (val, fallback) => (val && typeof val === 'string') ? val.trim() : fallback;
const WEGLIDE_API_BASE = trimEnv(process.env.WEGLIDE_API_BASE, 'https://api.weglide.org');
const SEASON_START = trimEnv(process.env.SEASON_START, '2025-09-23');
const SEASON_END = trimEnv(process.env.SEASON_END, '2026-09-30');
const UPDATE_TOKEN = trimEnv(process.env.UPDATE_TOKEN, '');
const GITHUB_REPO = process.env.GITHUB_REPO || 'ryanwoodie/WeGlide-API';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const DATASET_BLOB_KEY = process.env.DATASET_BLOB_KEY || 'canadian_flights_2026_details.jsonl';

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
 * Get all known flight IDs from the local dataset file
 */
async function getKnownFlightIds() {
    const fs = require('fs');
    const path = require('path');

    try {
        const datasetPath = path.join(process.cwd(), DATASET_BLOB_KEY);
        let text = null;

        if (fs.existsSync(datasetPath)) {
            text = fs.readFileSync(datasetPath, 'utf8');
        } else {
            text = await fetchGithubRepoText(DATASET_BLOB_KEY);
            if (!text) {
                console.log('[check-flights] Dataset file not found locally or on GitHub, assuming no flights known yet');
                return null;
            }
        }

        const lines = text.trim().split('\n');

        if (lines.length === 0) return null;

        const ids = new Set();
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const f = JSON.parse(line);
                if (f.id) ids.add(f.id);
            } catch (e) {
                // Skip malformed lines
            }
        }

        return ids; // Return the Set of all known IDs
    } catch (err) {
        console.error('[check-flights] Error reading dataset file:', err);
        return null;
    }
}

/**
 * Trigger the fetch-and-build process
 */
async function triggerBuild() {
    const base = process.env.VERCEL_URL
        ? (process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`)
        : 'http://localhost:3000';
    const url = `${base}/api/fetch-and-build`;

    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    if (UPDATE_TOKEN) {
        options.headers['x-update-token'] = UPDATE_TOKEN;
    }
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
        options.headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }

    const res = await fetch(url, options);
    return { status: res.status };
}

/**
 * Main handler function
 */
module.exports = async (req, res) => {
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

        // Get all known IDs from local dataset
        const knownIds = await getKnownFlightIds();

        const isNew = !knownIds || !knownIds.has(latestFlightId);

        if (isNew) {
            console.log(`[check-flights] New flight detected: ${latestFlightId}. Triggering build...`);

            // Trigger the build process
            try {
                const buildResult = await triggerBuild();
                return res.status(200).json({
                    status: 'new_data_available',
                    message: 'New flight detected, build triggered',
                    latestFlightId,
                    buildStatus: buildResult.status
                });
            } catch (buildErr) {
                return res.status(500).json({
                    status: 'error',
                    message: 'New flight detected but build trigger failed',
                    error: buildErr.message
                });
            }
        } else {
            console.log(`[check-flights] Flight ${latestFlightId} already known.`);
            return res.status(200).json({
                status: 'no_changes',
                message: 'No new flights since last check',
                latestFlightId
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
