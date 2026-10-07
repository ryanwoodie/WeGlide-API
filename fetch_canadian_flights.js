#!/usr/bin/env node

/**
 * Fetch Canadian flights from WeGlide API for the active soaring season.
 *
 * Fetches detailed flight data and saves to JSONL format (one JSON object per line)
 */

const fs = require('fs');
const https = require('https');
const { getSeason } = require('./lib/seasons');

// Season configuration
const season = getSeason(process.env.SEASON_ID);
const FREE_SEASON_START = season.fetchStart;
const REGULAR_SEASON_START = season.start;
const SEASON_END = season.end;

// Configuration
const COUNTRY_CODE = 'CA';
const OUTPUT_FILE = season.dataset;
const TEMP_FILE = `${OUTPUT_FILE}.download`;
const BATCH_SIZE = 100; // WeGlide allows up to 100 flights per request
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay to be nice to the API
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 3);
const DETAIL_BATCH_DELAY_MS = Number(process.env.DETAIL_BATCH_DELAY_MS || 500);

// Helper function to make API requests
function fetchFromAPI(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.weglide.org',
            path: path,
            method: 'GET',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                'origin': 'https://www.weglide.org',
                'referer': 'https://www.weglide.org/',
                'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not.A/Brand";v="8"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`API returned status ${res.statusCode}: ${data}`));
                    return;
                }

                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });

        req.end();
    });
}

// Helper function to add delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch flight detail
async function fetchFlightDetail(flightId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await fetchFromAPI(`/v1/flightdetail/${flightId}`);
        } catch (error) {
            console.error(`  ✗ Flight ${flightId}, attempt ${attempt}: ${error.message}`);
            // A blank 202 from the AWS WAF is a challenge, not a flight detail.
            if (/status 202\b/.test(error.message)) throw error;
            if (attempt < 3) await delay(1000 * attempt);
        }
    }
    return null;
}

// Main fetching function
async function fetchCanadianFlights() {
    console.log('='.repeat(60));
    console.log('SAC Leaderboard - Canadian Flights Fetcher');
    console.log('='.repeat(60));
    console.log(`Season: ${REGULAR_SEASON_START} to ${SEASON_END}`);
    console.log(`Free scoring starts: ${FREE_SEASON_START}`);
    console.log(`Country: ${COUNTRY_CODE}`);
    console.log('='.repeat(60));
    console.log('');

    let allFlights = [];
    let offset = 0;
    let hasMore = true;
    let totalFetched = 0;

    // Phase 1: Fetch basic flight list
    console.log('Phase 1: Fetching basic flight list...');
    console.log('');

    while (hasMore) {
        try {
            const path = `/v1/flight?country_id_in=${COUNTRY_CODE}&scoring_date_start=${FREE_SEASON_START}&scoring_date_end=${SEASON_END}&limit=${BATCH_SIZE}&skip=${offset}`;
            console.log(`  Fetching batch at offset ${offset}...`);

            const flights = await fetchFromAPI(path);

            if (!flights || flights.length === 0) {
                hasMore = false;
                console.log('  ✓ No more flights found');
                break;
            }

            allFlights = allFlights.concat(flights);
            totalFetched += flights.length;

            console.log(`  ✓ Fetched ${flights.length} flights (total: ${totalFetched})`);

            // If we got fewer flights than the batch size, we've reached the end
            if (flights.length < BATCH_SIZE) {
                hasMore = false;
                console.log('  ✓ Reached end of available flights');
            } else {
                offset += BATCH_SIZE;
                await delay(DELAY_BETWEEN_BATCHES);
            }

        } catch (error) {
            console.error(`  ✗ Error fetching batch: ${error.message}`);
            throw error;
        }
    }

    console.log('');
    console.log(`Phase 1 complete: ${totalFetched} flights fetched`);
    console.log('');

    // Phase 2: Fetch detailed data for each flight
    console.log('Phase 2: Fetching detailed flight data...');
    console.log('');

    let detailsSuccessCount = 0;
    let detailsFailCount = 0;
    const cachedDetails = new Map();
    for (const cacheFile of [OUTPUT_FILE, TEMP_FILE, process.env.EXTRA_CACHE_FILE].filter(Boolean)) {
        if (!fs.existsSync(cacheFile)) continue;
        for (const line of fs.readFileSync(cacheFile, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const flight = JSON.parse(line);
                if (flight.id) cachedDetails.set(flight.id, flight);
            } catch (error) { /* Ignore a damaged cached line. */ }
        }
    }
    // The previous partial download is now in memory and can be rebuilt in list order.
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);

    for (let i = 0; i < allFlights.length; i += DETAIL_CONCURRENCY) {
        const batch = allFlights.slice(i, i + DETAIL_CONCURRENCY);
        const details = await Promise.all(batch.map(flight =>
            cachedDetails.get(flight.id) || fetchFlightDetail(flight.id)));
        for (const detail of details) {
            if (detail) {
                fs.appendFileSync(TEMP_FILE, JSON.stringify(detail) + '\n');
                detailsSuccessCount++;
            } else {
                detailsFailCount++;
            }
        }
        if ((i + batch.length) % 100 < DETAIL_CONCURRENCY || i + batch.length === allFlights.length) {
            console.log(`  Progress: ${i + batch.length}/${allFlights.length} | saved: ${detailsSuccessCount} | failed: ${detailsFailCount}`);
        }
        await delay(DETAIL_BATCH_DELAY_MS);
    }

    if (detailsFailCount > 0) {
        throw new Error(`${detailsFailCount} flight details failed; existing dataset was preserved`);
    }
    if (!fs.existsSync(TEMP_FILE)) fs.writeFileSync(TEMP_FILE, '');
    fs.renameSync(TEMP_FILE, OUTPUT_FILE);

    console.log('');
    console.log('='.repeat(60));
    console.log('FETCH COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total flights found: ${totalFetched}`);
    console.log(`Details fetched successfully: ${detailsSuccessCount}`);
    console.log(`Details failed: ${detailsFailCount}`);
    console.log(`Output file: ${OUTPUT_FILE}`);
    console.log('='.repeat(60));

    // Display some statistics
    if (detailsSuccessCount > 0) {
        console.log('');
        console.log('Flight Statistics:');

        // Read back the file to get stats
        const fileContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const lines = fileContent.trim().split('\n');
        const flights = lines.map(line => JSON.parse(line));

        // Count pilots
        const pilots = new Set(flights.map(f => f.user?.name).filter(Boolean));
        console.log(`  Unique pilots: ${pilots.size}`);

        // Date range
        const dates = flights.map(f => f.scoring_date).filter(Boolean).sort();
        console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);

        // Count by contest type
        const withCA = flights.filter(f =>
            f.contest?.some(c => c.name === 'ca' && c.points > 0)
        ).length;
        console.log(`  Flights with 'ca' scoring: ${withCA}`);

        console.log('');
        console.log('Ready for leaderboard generation!');
        console.log(`Run: node create_canadian_leaderboard_from_jsonl.js`);
    }
}

// Run the fetcher
fetchCanadianFlights().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
