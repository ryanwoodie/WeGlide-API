#!/usr/bin/env node

const fs = require('fs');
const https = require('https');

// Helper function to make API requests
function fetchFlightDetail(flightId) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.weglide.org',
            path: `/v1/flightdetail/${flightId}`,
            method: 'GET',
            headers: {
                'accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const flightDetail = JSON.parse(data);
                    resolve(flightDetail);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON for flight ${flightId}: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`Request failed for flight ${flightId}: ${error.message}`));
        });
        
        req.end();
    });
}

// Helper function to add delay between requests
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function enhanceLeaderboard() {
    console.log('Loading basic leaderboard data...');
    const leaderboard = JSON.parse(fs.readFileSync('leaderboard_data.json', 'utf8'));
    
    console.log(`Enhancing ${leaderboard.length} pilots with detailed flight data...`);
    
    let totalFlights = 0;
    let processedFlights = 0;
    
    // Count total flights to process
    leaderboard.forEach(pilot => {
        totalFlights += pilot.bestFlights.length;
    });
    
    console.log(`Total flights to process: ${totalFlights}`);
    
    // Process each pilot
    for (const pilot of leaderboard) {
        console.log(`\nProcessing ${pilot.pilot} (${pilot.bestFlights.length} flights)...`);
        
        // Process each flight for this pilot
        for (const flight of pilot.bestFlights) {
            try {
                console.log(`  Fetching flight ${flight.id}...`);
                const flightDetail = await fetchFlightDetail(flight.id);
                
                // Find the best scoring method
                let bestScore = flight.points; // Start with free flight score
                let contestType = 'free';
                let declared = false;
                
                if (flightDetail.contest && Array.isArray(flightDetail.contest)) {
                    // Look for declared task scoring (declared can be true or null for valid tasks)
                    const declarationContest = flightDetail.contest.find(c => 
                        c.name === 'declaration'
                    );
                    
                    if (declarationContest && declarationContest.points > bestScore) {
                        bestScore = declarationContest.points;
                        contestType = 'declaration';
                        declared = true;
                        
                        // Also update distance if available
                        if (declarationContest.distance) {
                            flight.distance = declarationContest.distance;
                        }
                    }
                }
                
                // Update flight data
                flight.points = bestScore;
                flight.declared = declared;
                flight.contestType = contestType;
                
                processedFlights++;
                console.log(`    ✓ ${flight.points.toFixed(1)} pts (${contestType}${declared ? ', declared' : ''})`);
                
                // Add delay to avoid rate limiting
                await delay(100);
                
            } catch (error) {
                console.log(`    ✗ Error fetching flight ${flight.id}: ${error.message}`);
                // Keep original data if fetch fails
                processedFlights++;
            }
            
            // Progress update
            if (processedFlights % 10 === 0) {
                console.log(`\nProgress: ${processedFlights}/${totalFlights} flights processed`);
            }
        }
        
        // Re-sort flights by updated points (higher scores first)
        pilot.bestFlights.sort((a, b) => b.points - a.points);
        
        // Recalculate pilot's total with updated scores
        pilot.totalPoints = pilot.bestFlights.reduce((sum, flight) => sum + flight.points, 0);
    }
    
    // Re-sort leaderboard with updated scores
    leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
    
    // Save enhanced data
    fs.writeFileSync('leaderboard_enhanced.json', JSON.stringify(leaderboard, null, 2));
    
    console.log(`\n✅ Enhanced leaderboard saved!`);
    console.log(`Processed ${processedFlights}/${totalFlights} flights`);
    console.log('\nTop 5 pilots (with enhanced scoring):');
    leaderboard.slice(0, 5).forEach((pilot, index) => {
        const taskFlights = pilot.bestFlights.filter(f => f.declared).length;
        console.log(`${index + 1}. ${pilot.pilot}: ${pilot.totalPoints.toFixed(1)} points (${taskFlights} task flights)`);
    });
}

enhanceLeaderboard().catch(console.error);