#!/usr/bin/env node

/**
 * Fetch Canadian flights from WeGlide API for the 2025-26 season
 * Season: Oct 1, 2025 - Sep 30, 2026
 * Special: Free scoring starts Sep 23, 2025
 *
 * Fetches detailed flight data and saves to JSONL format (one JSON object per line)
 */

const fs = require('fs');
const https = require('https');

// Season configuration
const FREE_SEASON_START = '2025-09-23';
const REGULAR_SEASON_START = '2025-10-01';
const SEASON_END = '2026-09-30';

// Configuration
const COUNTRY_CODE = 'CA';
const OUTPUT_FILE = 'canadian_flights_2026_details.jsonl';
const BATCH_SIZE = 100; // WeGlide allows up to 100 flights per request
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay to be nice to the API

// Helper function to make API requests
function fetchFromAPI(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.weglide.org',
            path: path,
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'User-Agent': 'SAC-Leaderboard-Fetcher/1.0'
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
    try {
        const detail = await fetchFromAPI(`/v1/flightdetail/${flightId}`);
        return detail;
    } catch (error) {
        console.error(`  ✗ Error fetching detail for flight ${flightId}: ${error.message}`);
        return null;
    }
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
            const path = `/v1/flight?country=${COUNTRY_CODE}&scoring_date_from=${FREE_SEASON_START}&scoring_date_to=${SEASON_END}&limit=${BATCH_SIZE}&offset=${offset}`;
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
            hasMore = false;
        }
    }

    console.log('');
    console.log(`Phase 1 complete: ${totalFetched} flights fetched`);
    console.log('');

    // Phase 2: Fetch detailed data for each flight
    console.log('Phase 2: Fetching detailed flight data...');
    console.log('');

    // Clear output file if it exists
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.unlinkSync(OUTPUT_FILE);
    }

    let detailsSuccessCount = 0;
    let detailsFailCount = 0;

    for (let i = 0; i < allFlights.length; i++) {
        const basicFlight = allFlights[i];
        const flightId = basicFlight.id;

        console.log(`  [${i + 1}/${allFlights.length}] Fetching detail for flight ${flightId}...`);

        const flightDetail = await fetchFlightDetail(flightId);

        if (flightDetail) {
            // Append to JSONL file (one JSON object per line)
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(flightDetail) + '\n');
            detailsSuccessCount++;
            console.log(`    ✓ Saved (${flightDetail.user?.name || 'unknown'})`);
        } else {
            detailsFailCount++;
        }

        // Progress update every 10 flights
        if ((i + 1) % 10 === 0) {
            console.log('');
            console.log(`    Progress: ${i + 1}/${allFlights.length} flights processed`);
            console.log(`    Success: ${detailsSuccessCount} | Failed: ${detailsFailCount}`);
            console.log('');
        }

        // Small delay to avoid overwhelming the API
        await delay(200);
    }

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
