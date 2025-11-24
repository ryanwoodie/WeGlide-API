/**
 * Vercel Serverless Function: Check for New Canadian Flights
 *
 * This function is called by Vercel Cron every 5 minutes.
 * It checks if there are new Canadian flights on WeGlide API.
 * If new flights are detected, it triggers the fetch-and-build process.
 *
 * Cron Schedule: every 5 minutes
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const trimEnv = (val, fallback) => (val && typeof val === 'string') ? val.trim() : fallback;
const WEGLIDE_API_BASE = trimEnv(process.env.WEGLIDE_API_BASE, 'https://api.weglide.org');
const SEASON_START = trimEnv(process.env.SEASON_START, '2025-09-23');
const SEASON_END = trimEnv(process.env.SEASON_END, '2026-09-30');
const UPDATE_TOKEN = trimEnv(process.env.UPDATE_TOKEN, '');

// Cache file to store last known flight ID
const CACHE_FILE = path.join('/tmp', 'last_flight_id.json');

/**
 * Fetch latest Canadian flight from WeGlide API
 */
async function fetchLatestFlight() {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({
            country_id_in: 'CA',
            scoring_date_start: SEASON_START,
            scoring_date_end: SEASON_END,
            limit: '1',
            skip: '0'
        });
        const url = `${WEGLIDE_API_BASE}/v1/flight?${params.toString()}`;

        const headers = {
            'Accept': 'application/json',
            'Origin': 'https://www.weglide.org',
            'Referer': 'https://www.weglide.org/',
            'User-Agent': process.env.HTTP_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        };

        const req = https.get(url, { headers }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json && json.length > 0) {
                        resolve(json[0]);
                    } else {
                        resolve(null);
                    }
                } catch (err) {
                    const message = `Failed to parse WeGlide response (status ${res.statusCode}, length ${data.length})`;
                    reject(new Error(message));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Get last known flight ID from cache
 */
function getLastKnownFlightId() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const cache = JSON.parse(data);
            return cache.lastFlightId;
        }
    } catch (err) {
        console.error('Error reading cache:', err);
    }
    return null;
}

/**
 * Save flight ID to cache
 */
function saveLastFlightId(flightId) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({
            lastFlightId: flightId,
            timestamp: new Date().toISOString()
        }));
    } catch (err) {
        console.error('Error writing cache:', err);
    }
}

/**
 * Trigger the fetch-and-build process
 */
async function triggerBuild() {
    return new Promise((resolve, reject) => {
        const base = process.env.VERCEL_URL
            ? (process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`)
            : 'http://localhost:3000';
        const url = `${base}/api/fetch-and-build`;

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (UPDATE_TOKEN) {
            options.headers['x-update-token'] = UPDATE_TOKEN;
        }
        if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
            options.headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        }

        const req = https.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({ status: res.statusCode, data });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

/**
 * Main handler function
 */
module.exports = async (req, res) => {
    try {
        console.log('[check-flights] Checking for new Canadian flights...');

        // Fetch latest flight from WeGlide
        const latestFlight = await fetchLatestFlight();

        if (!latestFlight) {
            return res.status(200).json({
                status: 'no_flights',
                message: 'No flights found for the season',
                timestamp: new Date().toISOString()
            });
        }

        const latestFlightId = latestFlight.id;
        const lastKnownId = getLastKnownFlightId();

        console.log(`[check-flights] Latest flight ID: ${latestFlightId}, Last known ID: ${lastKnownId}`);

        // Check if there are new flights
        if (lastKnownId === null || latestFlightId !== lastKnownId) {
            console.log('[check-flights] New flights detected! Triggering build...');

            // Save the new flight ID
            saveLastFlightId(latestFlightId);

            // Trigger the build process
            try {
                const buildResult = await triggerBuild();
                console.log('[check-flights] Build triggered successfully');

                return res.status(200).json({
                    status: 'new_data_available',
                    message: 'New flights detected, build triggered',
                    latestFlightId,
                    previousFlightId: lastKnownId,
                    buildStatus: buildResult.status,
                    timestamp: new Date().toISOString()
                });
            } catch (buildErr) {
                console.error('[check-flights] Error triggering build:', buildErr);
                return res.status(500).json({
                    status: 'error',
                    message: 'New flights detected but build trigger failed',
                    error: buildErr.message,
                    timestamp: new Date().toISOString()
                });
            }
        } else {
            console.log('[check-flights] No new flights detected');

            return res.status(200).json({
                status: 'no_changes',
                message: 'No new flights since last check',
                latestFlightId,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('[check-flights] Error:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Failed to check for new flights',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
