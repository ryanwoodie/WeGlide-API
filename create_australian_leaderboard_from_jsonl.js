const fs = require('fs');
const readline = require('readline');

// Function to calculate best score from flight contest data (Mixed scoring)
function calculateBestScore(flight) {
    if (!flight.contest || !Array.isArray(flight.contest)) {
        return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
    }

    // Find the "au" (task) and "free" contests specifically
    const auContest = flight.contest.find(contest => contest.name === 'au' && contest.points > 0);
    const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

    let bestContest = null;
    let bestScore = 0;

    // Check if task was achieved at flight level
    const taskAchieved = flight.task_achieved === true;

    // Scoring logic: Use Free if it's higher than AU OR if task_achieved=false
    if (auContest && freeContest) {
        if (freeContest.points > auContest.points || !taskAchieved) {
            bestContest = freeContest;
            bestScore = freeContest.points;
        } else {
            bestContest = auContest;
            bestScore = auContest.points;
        }
    } else if (freeContest) {
        bestContest = freeContest;
        bestScore = freeContest.points;
    } else if (auContest) {
        bestContest = auContest;
        bestScore = auContest.points;
    } else {
        // Fall back to any other contest with points
        flight.contest.forEach(contest => {
            if (contest.points && contest.points > bestScore) {
                bestScore = contest.points;
                bestContest = contest;
            }
        });
    }

    if (bestContest) {
        // Task badge only shows when task was achieved AND AU score is being used
        const isDeclaredTask = taskAchieved && bestContest.name === 'au';

        return {
            score: bestScore,
            distance: bestContest.distance || 0,
            speed: bestContest.speed || 0,
            contestType: bestContest.name || 'unknown',
            declared: isDeclaredTask  // Mark as declared only if task achieved AND using AU score
        };
    }

    return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
}

// Function to calculate Free-only score from flight contest data
function calculateFreeScore(flight) {
    if (!flight.contest || !Array.isArray(flight.contest)) {
        return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
    }

    // Only use Free contest
    const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

    if (freeContest) {
        return {
            score: freeContest.points,
            distance: freeContest.distance || 0,
            speed: freeContest.speed || 0,
            contestType: 'free',
            declared: false  // No task badges in Free-only mode
        };
    }

    return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
}

async function processAustralianFlights() {
    console.log('🇦🇺 Processing Australian flights from JSONL...');

    const pilotFlightsMixed = {};  // Mixed scoring (AU/Free)
    const pilotFlightsFree = {};   // Free-only scoring
    let totalProcessed = 0;
    let australianCount = 0;
    let australianFlights = []; // Store all flight data for detailed tooltips
    let allFlightData = []; // Store all original flight data for statistics

    try {
        const fileStream = fs.createReadStream('australian_flights_2025_details.jsonl');
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (line.trim().length > 0) {
                totalProcessed++;

                try {
                    const flight = JSON.parse(line);

                    // All flights in this file are Australian
                    australianCount++;
                    const pilotName = flight.user?.name;

                    // Store original flight data for statistics
                    allFlightData.push(flight);

                    // Skip invalid pilot names or club names
                    if (!pilotName || pilotName.toLowerCase().includes('soaring club') ||
                        pilotName.toLowerCase().includes('gliding club') ||
                        pilotName.toLowerCase().includes('club')) {
                        continue;
                    }

                    // Initialize pilot arrays for both scoring modes
                    if (!pilotFlightsMixed[pilotName]) {
                        pilotFlightsMixed[pilotName] = [];
                    }
                    if (!pilotFlightsFree[pilotName]) {
                        pilotFlightsFree[pilotName] = [];
                    }

                    // Calculate scores for both modes
                    const mixedScoringData = calculateBestScore(flight);
                    const freeScoringData = calculateFreeScore(flight);

                    // Add to mixed scoring leaderboard
                    if (mixedScoringData.score > 0) {
                        pilotFlightsMixed[pilotName].push({
                            id: flight.id,
                            date: flight.scoring_date,
                            distance: mixedScoringData.distance,
                            speed: mixedScoringData.speed,
                            points: mixedScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: mixedScoringData.declared,
                            contestType: mixedScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    // Add to free-only leaderboard
                    if (freeScoringData.score > 0) {
                        pilotFlightsFree[pilotName].push({
                            id: flight.id,
                            date: flight.scoring_date,
                            distance: freeScoringData.distance,
                            speed: freeScoringData.speed,
                            points: freeScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: freeScoringData.declared,
                            contestType: freeScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',  // Track aircraft type
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    // Store comprehensive flight stats for tooltip use if it has scoring data
                    if (mixedScoringData.score > 0 || freeScoringData.score > 0) {
                        // Get stats from both contest types
                        const auContest = flight.contest?.find(c => c.name === 'au' && c.points > 0);
                        const freeContest = flight.contest?.find(c => c.name === 'free' && c.points > 0);
                        const taskAchieved = flight.task_achieved === true;

                        if (freeContest || auContest) {
                            const flightStats = {
                                id: flight.id,
                                taskAchieved: taskAchieved,
                                hasTask: !!flight.task, // Track if a task was declared
                                // Store both free and task stats for dynamic switching
                                freeStats: null,
                                taskStats: null
                            };

                            // Extract comprehensive stats from free contest
                            if (freeContest?.score) {
                                flightStats.freeStats = {
                                    glide_ratio: freeContest.score.glide_ratio,
                                    thermal_avg: freeContest.score.thermal_avg,
                                    glide_speed: freeContest.score.glide_speed,
                                    glide_speed_lift: freeContest.score.glide_speed_lift,
                                    glide_speed_sink: freeContest.score.glide_speed_sink,
                                    altitude_avg: freeContest.score.altitude_avg,
                                    agl_avg: freeContest.score.agl_avg,
                                    thermal_count: freeContest.score.thermal_count,
                                    thermal_gain: freeContest.score.thermal_gain,
                                    thermal_radius: freeContest.score.thermal_radius,
                                    thermal_start_agl: freeContest.score.thermal_start_agl,
                                    thermal_bank: freeContest.score.thermal_bank,
                                    glide_percentage: freeContest.score.glide_percentage,
                                    glide_percentage_lift: freeContest.score.glide_percentage_lift,
                                    duration: freeContest.score.duration,
                                    thermal_time: freeContest.score.thermal_time,
                                    glide_time: freeContest.score.glide_time,
                                    wind_speed: freeContest.score.wind_speed,
                                    wind_direction: freeContest.score.wind_direction,
                                    attempt_count: freeContest.score.attempt_count,
                                    attempt_avg: freeContest.score.attempt_avg,
                                    attempt_speed_loss: freeContest.score.attempt_speed_loss,
                                    // All altitude threshold stats
                                    below_1000_agl: freeContest.score.below_1000_agl,
                                    below_800_agl: freeContest.score.below_800_agl,
                                    below_600_agl: freeContest.score.below_600_agl,
                                    below_400_agl: freeContest.score.below_400_agl,
                                    below_200_agl: freeContest.score.below_200_agl,
                                    below_100_agl: freeContest.score.below_100_agl,
                                    track_distance: freeContest.score.track_distance,
                                    glide_detour: freeContest.score.glide_detour,
                                    glide_distance: freeContest.score.glide_distance,
                                    glide_alt_avg: freeContest.score.glide_alt_avg,
                                    end_time: freeContest.score.end_time,
                                    start_time: freeContest.score.start_time,
                                    // Get finish altitude from last leg
                                    finish_alt: freeContest.score.leg?.[freeContest.score.leg.length - 1]?.end_alt
                                };
                            }

                            // Extract comprehensive stats from AU task contest
                            if (auContest?.score) {
                                flightStats.taskStats = {
                                    glide_ratio: auContest.score.glide_ratio,
                                    thermal_avg: auContest.score.thermal_avg,
                                    glide_speed: auContest.score.glide_speed,
                                    glide_speed_lift: auContest.score.glide_speed_lift,
                                    glide_speed_sink: auContest.score.glide_speed_sink,
                                    altitude_avg: auContest.score.altitude_avg,
                                    agl_avg: auContest.score.agl_avg,
                                    thermal_count: auContest.score.thermal_count,
                                    thermal_gain: auContest.score.thermal_gain,
                                    thermal_radius: auContest.score.thermal_radius,
                                    thermal_start_agl: auContest.score.thermal_start_agl,
                                    thermal_bank: auContest.score.thermal_bank,
                                    glide_percentage: auContest.score.glide_percentage,
                                    glide_percentage_lift: auContest.score.glide_percentage_lift,
                                    duration: auContest.score.duration,
                                    thermal_time: auContest.score.thermal_time,
                                    glide_time: auContest.score.glide_time,
                                    wind_speed: auContest.score.wind_speed,
                                    wind_direction: auContest.score.wind_direction,
                                    attempt_count: auContest.score.attempt_count,
                                    attempt_avg: auContest.score.attempt_avg,
                                    attempt_speed_loss: auContest.score.attempt_speed_loss,
                                    // All altitude threshold stats
                                    below_1000_agl: auContest.score.below_1000_agl,
                                    below_800_agl: auContest.score.below_800_agl,
                                    below_600_agl: auContest.score.below_600_agl,
                                    below_400_agl: auContest.score.below_400_agl,
                                    below_200_agl: auContest.score.below_200_agl,
                                    below_100_agl: auContest.score.below_100_agl,
                                    track_distance: auContest.score.track_distance,
                                    glide_detour: auContest.score.glide_detour,
                                    glide_distance: auContest.score.glide_distance,
                                    glide_alt_avg: auContest.score.glide_alt_avg,
                                    end_time: auContest.score.end_time,
                                    start_time: auContest.score.start_time,
                                    // Get finish altitude from last leg
                                    finish_alt: auContest.score.leg?.[auContest.score.leg.length - 1]?.end_alt,
                                    // Task-specific timing
                                    task_duration: auContest.score.duration,
                                    total_duration: freeContest?.score?.duration || auContest.score.duration
                                };
                            }

                            australianFlights.push(flightStats);
                        }
                    }
                } catch (e) {
                    // Skip malformed lines
                }
            }

            // Progress indicator
            if (totalProcessed % 10000 === 0) {
                console.log(`Processed ${totalProcessed} lines, found ${australianCount} Australian flights...`);
            }
        }

        console.log(`✅ Processed ${totalProcessed} total flights, found ${australianCount} Australian flights`);

        // Function to generate leaderboard from pilot flights
        function generateLeaderboard(pilotFlights) {
            const leaderboard = [];

            Object.keys(pilotFlights).forEach(pilotName => {
                const flights = pilotFlights[pilotName];

                // Sort flights by points (descending) and take top 5
                const bestFlights = flights
                    .sort((a, b) => b.points - a.points)
                    .slice(0, 5);

                if (bestFlights.length > 0) {
                    const totalPoints = bestFlights.reduce((sum, flight) => sum + flight.points, 0);
                    const totalDistance = bestFlights.reduce((sum, flight) => sum + flight.distance, 0);

                    leaderboard.push({
                        pilot: pilotName,
                        pilotId: bestFlights[0].id,
                        totalPoints: totalPoints,
                        totalDistance: totalDistance,
                        flightCount: bestFlights.length,
                        bestFlights: bestFlights
                    });
                }
            });

            // Sort leaderboard by total points
            leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
            return leaderboard;
        }

        // Generate both leaderboards
        const mixedLeaderboard = generateLeaderboard(pilotFlightsMixed);
        const freeLeaderboard = generateLeaderboard(pilotFlightsFree);

        // Calculate aircraft type awards for free leaderboard
        function calculateAircraftAwards(pilotFlights) {
            let bestGliderScore = 0;
            let bestGliderPilot = null;
            let bestMotorGliderScore = 0;
            let bestMotorGliderPilot = null;

            Object.keys(pilotFlights).forEach(pilotName => {
                const flights = pilotFlights[pilotName];

                // Separate flights by aircraft type
                const gliderFlights = flights.filter(f => f.aircraftKind === 'GL');
                const motorGliderFlights = flights.filter(f => f.aircraftKind === 'MG');

                // Calculate total scores for each aircraft type (best 5 flights each)
                if (gliderFlights.length > 0) {
                    const bestGliderFlights = gliderFlights
                        .sort((a, b) => b.points - a.points)
                        .slice(0, 5);
                    const totalGliderScore = bestGliderFlights.reduce((sum, flight) => sum + flight.points, 0);

                    if (totalGliderScore > bestGliderScore) {
                        bestGliderScore = totalGliderScore;
                        bestGliderPilot = pilotName;
                    }
                }

                if (motorGliderFlights.length > 0) {
                    const bestMotorGliderFlights = motorGliderFlights
                        .sort((a, b) => b.points - a.points)
                        .slice(0, 5);
                    const totalMotorGliderScore = bestMotorGliderFlights.reduce((sum, flight) => sum + flight.points, 0);

                    if (totalMotorGliderScore > bestMotorGliderScore) {
                        bestMotorGliderScore = totalMotorGliderScore;
                        bestMotorGliderPilot = pilotName;
                    }
                }
            });

            return {
                bestGliderPilot,
                bestGliderScore,
                bestMotorGliderPilot,
                bestMotorGliderScore
            };
        }

        const aircraftAwards = calculateAircraftAwards(pilotFlightsFree);

        // Add award badges to free leaderboard pilots
        freeLeaderboard.forEach(pilot => {
            pilot.awards = [];
            if (pilot.pilot === aircraftAwards.bestGliderPilot) {
                pilot.awards.push({ type: 'glider', score: aircraftAwards.bestGliderScore });
            }
            if (pilot.pilot === aircraftAwards.bestMotorGliderPilot) {
                pilot.awards.push({ type: 'motorGlider', score: aircraftAwards.bestMotorGliderScore });
            }
        });

        console.log(`🛩️ Best Pure Glider Score: ${aircraftAwards.bestGliderPilot} (${aircraftAwards.bestGliderScore.toFixed(1)} pts)`);
        console.log(`⚙️ Best Motor Glider Score: ${aircraftAwards.bestMotorGliderPilot} (${aircraftAwards.bestMotorGliderScore.toFixed(1)} pts)`);

        // Collect flight IDs that are actually used in the leaderboards
        const usedFlightIds = new Set();
        [...mixedLeaderboard, ...freeLeaderboard].forEach(pilot => {
            pilot.bestFlights.forEach(flight => {
                usedFlightIds.add(flight.id);
            });
        });

        // Filter australianFlights to only include flights used in leaderboards
        australianFlights = australianFlights.filter(flight => usedFlightIds.has(flight.id));
        console.log(`📊 Storing ${australianFlights.length} flight details for tooltips`);

        // Calculate statistics from ALL flights (not just top 5 used for leaderboard)
        // Note: Need to access original flight data to check actual task objects
        function calculateAllFlightStats(originalFlightData) {
            const pilotSet = new Set();
            let totalFlights = 0;
            let totalKms = 0;
            let totalTasksDeclared = 0;
            let totalTasksCompleted = 0;
            let totalTasksHigherThanFree = 0;

            originalFlightData.forEach(flight => {
                const pilotName = flight.user?.name;

                // Skip invalid pilot names or club names
                if (!pilotName || pilotName.toLowerCase().includes('soaring club') ||
                    pilotName.toLowerCase().includes('gliding club') ||
                    pilotName.toLowerCase().includes('club')) {
                    return;
                }

                pilotSet.add(pilotName);
                totalFlights++;

                // Calculate distance from contest data
                const mixedScoringData = calculateBestScore(flight);
                if (mixedScoringData.score > 0) {
                    totalKms += mixedScoringData.distance;
                }

                // Check for task declaration and completion using actual flight task data
                if (flight.task) {
                    totalTasksDeclared++;

                    // Task is completed if task_achieved is true
                    if (flight.task_achieved === true) {
                        totalTasksCompleted++;
                    }
                }

                // Count completed tasks that scored higher than free scoring
                if (flight.task && flight.task_achieved === true && flight.contest && Array.isArray(flight.contest)) {
                    const auContest = flight.contest.find(contest => contest.name === 'au' && contest.points > 0);
                    const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

                    if (auContest && freeContest && auContest.points > freeContest.points) {
                        totalTasksHigherThanFree++;
                    }
                }
            });

            return {
                totalPilots: pilotSet.size,
                totalFlights,
                totalKms: Math.round(totalKms),
                totalTasksDeclared,
                totalTasksCompleted,
                totalTasksHigherThanFree
            };
        }

        // Use ALL flights for meta statistics
        const allFlightStats = calculateAllFlightStats(allFlightData);
        const totalPilots = allFlightStats.totalPilots;
        const totalFlights = allFlightStats.totalFlights;
        const totalKms = allFlightStats.totalKms;
        const totalTasksDeclared = allFlightStats.totalTasksDeclared;
        const totalTasksCompleted = allFlightStats.totalTasksCompleted;
        const totalTasksHigherThanFree = allFlightStats.totalTasksHigherThanFree;

        console.log(`Combined Leaderboard: ${totalPilots} pilots, ${totalFlights} flights, ${totalKms} km total`);
        console.log(`Tasks: ${totalTasksDeclared} declared, ${totalTasksCompleted} completed, ${totalTasksHigherThanFree} > free score`);
        console.log(`Free Leaderboard: ${freeLeaderboard.length} pilots, ${freeLeaderboard.reduce((sum, pilot) => sum + pilot.flightCount, 0)} flights`);

        if (mixedLeaderboard.length === 0) {
            console.log('❌ No pilots found with valid scoring data');
            return;
        }

        // Read the Canadian HTML template
        const canadianHTML = fs.readFileSync('canadian_leaderboard_2025_embedded.html', 'utf-8');

        // Replace Canadian-specific content with Australian content
        let australianHTML = canadianHTML
            .replace(/Canadian Gliding Leaderboard 2025/g, 'Australian Gliding Leaderboard 2025')
            .replace(/🏆 Canadian Gliding Leaderboard 2025/g, '🇦🇺 Australian Gliding Leaderboard 2025')
            .replace(/Soaring Association of Canada/g, 'Gliding Federation of Australia')
            .replace(/sac_logo\.png/g, 'gfa_logo.png')
            .replace(/Canadian gliding season runs October 1, 2024 to September 30, 2025/g, 'Australian gliding season runs October 1, 2024 to September 30, 2025')
            .replace(/Oct 2024 - Sep 2025/g, 'Oct 2024 - Sep 2025')
            .replace(/Best 5 flights per pilot • Higher of Free or Task scoring/g, 'Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025')
            .replace(/Scoring uses the higher of Free flight or Task \(declared\) scoring for each flight/g, 'Scoring uses the higher of Free flight or WeGlide Task scoring for each flight')
            // Remove the logo image
            .replace(/<img src="[^"]*logo[^"]*"[^>]*>/g, '')
            // Add ID to scoring description for dynamic updates
            .replace(/<p>Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025<\/p>/g, '<p id="scoringDescription">Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025</p>')
            // Replace season period with task stats
            .replace(/<div class="stat">\s*<span class="stat-number" id="seasonPeriod">Oct 2024 - Sep 2025<\/span>\s*<span class="stat-label">Season Period<\/span>\s*<\/div>/g,
                `<div class="stat">
                    <span class="stat-number" id="tasksDeclared">${totalTasksDeclared.toLocaleString()}</span>
                    <span class="stat-label">Tasks Declared</span>
                </div>
                <div class="stat">
                    <span class="stat-number" id="tasksCompleted">${totalTasksCompleted.toLocaleString()}</span>
                    <span class="stat-label">Tasks Completed</span>
                </div>
                <div class="stat">
                    <span class="stat-number" id="tasksHigherThanFree">${totalTasksHigherThanFree.toLocaleString()}</span>
                    <span class="stat-label">Task Score > Free</span>
                </div>`);

        // Replace the script section with our custom implementation
        const scriptStart = australianHTML.indexOf('<script>');
        const scriptEnd = australianHTML.indexOf('</script>') + 9;

        const newScriptContent = `<script>
        // Global variables for leaderboard data
        let mixedLeaderboard = [];
        let freeLeaderboard = [];
        let fullFlightData = [];
        let leaderboard = [];

        async function loadLeaderboard() {
            try {
                // Embedded leaderboard data
                mixedLeaderboard = ${JSON.stringify(mixedLeaderboard, null, 16)};
                freeLeaderboard = ${JSON.stringify(freeLeaderboard, null, 16)};
                fullFlightData = ${JSON.stringify(australianFlights, null, 16)};

                // ALL flight statistics (not just top 5 used for leaderboard)
                const allFlightStats = {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                };

                leaderboard = mixedLeaderboard; // Default to mixed scoring

                // Update stats - use ALL flight stats, not just leaderboard stats
                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = ` + totalKms + `;

                // Show task stats only in Combined mode
                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `
                });

                // Build leaderboard table
                const tbody = document.getElementById('leaderboardBody');
                tbody.innerHTML = '';

                leaderboard.forEach((pilot, index) => {
                    const row = document.createElement('tr');

                    // Rank with medal for top 3
                    let rankDisplay = index + 1;
                    if (index === 0) rankDisplay = '<span class="medal gold">🥇</span>' + rankDisplay;
                    else if (index === 1) rankDisplay = '<span class="medal silver">🥈</span>' + rankDisplay;
                    else if (index === 2) rankDisplay = '<span class="medal bronze">🥉</span>' + rankDisplay;

                    row.innerHTML = \`
                        <td class="rank">\${rankDisplay}</td>
                        <td class="pilot-name"><a href="https://www.weglide.org/user/\${pilot.pilotId}" target="_blank" class="pilot-link">\${pilot.pilot}</a></td>
                        <td class="total-points">\${pilot.totalPoints.toFixed(1)}</td>
                        \${pilot.bestFlights.map(flight => createFlightCell(flight)).join('')}
                        \${Array(5 - pilot.bestFlights.length).fill('<td class="flight-cell">-</td>').join('')}
                    \`;

                    tbody.appendChild(row);
                });

                // Show table and hide loading
                document.getElementById('loading').style.display = 'none';
                document.getElementById('leaderboardTable').style.display = 'table';

            } catch (error) {
                console.error('Error loading leaderboard:', error);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('errorMessage').textContent = error.message;
            }
        }

        function createFlightCell(flight) {
            const declaredBadge = flight.declared ? '<span class="declared-task">TASK</span>' : '';
            const flightUrl = \`https://www.weglide.org/flight/\${flight.id}\`;

            // Create aircraft display with name and index if available
            let aircraftDisplay = '';
            if (flight.aircraftName && flight.dmstIndex) {
                aircraftDisplay = \`\${flight.aircraftName} - index \${flight.dmstIndex}\`;
            } else if (flight.aircraftName) {
                aircraftDisplay = flight.aircraftName;
            } else if (flight.aircraftKind) {
                aircraftDisplay = flight.aircraftKind === 'GL' ? 'Glider' :
                                flight.aircraftKind === 'MG' ? 'Motor Glider' : flight.aircraftKind;
            } else {
                aircraftDisplay = 'N/A';
            }

            return \`
                <td class="flight-cell" onmouseover="showFlightPreview(\${flight.id}, event)" onmouseout="hideFlightPreview()">
                    <div class="flight-details">
                        <div class="flight-points">\${flight.points.toFixed(1)} pts\${declaredBadge}</div>
                        <div class="flight-distance">\${flight.distance.toFixed(1)} km</div>
                        <div class="flight-speed">\${flight.speed.toFixed(1)} km/h</div>
                        <div class="flight-date">\${formatDate(flight.date)}</div>
                        <div class="flight-aircraft">\${aircraftDisplay}</div>
                        <div class="flight-location">\${flight.takeoff} • <a href="\${flightUrl}" target="_blank" class="weglide-link">View on WeGlide →</a></div>
                    </div>
                </td>
            \`;
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }

        // Update task stats visibility (now always visible in main stats)
        function updateTaskStats(mode, stats) {
            // Task stats are now always visible in the main stats area
            // Just update the values - no need to show/hide
            if (document.getElementById('tasksDeclared') && stats && stats.totalTasksDeclared !== undefined) {
                document.getElementById('tasksDeclared').textContent = stats.totalTasksDeclared.toLocaleString();
            }
            if (document.getElementById('tasksCompleted') && stats && stats.totalTasksCompleted !== undefined) {
                document.getElementById('tasksCompleted').textContent = stats.totalTasksCompleted.toLocaleString();
            }
            if (document.getElementById('tasksHigherThanFree') && stats && stats.totalTasksHigherThanFree !== undefined) {
                document.getElementById('tasksHigherThanFree').textContent = stats.totalTasksHigherThanFree.toLocaleString();
            }
        }

        // Switch between scoring modes
        function switchScoringMode(mode) {
            if (mode === 'mixed') {
                leaderboard = mixedLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025';
            } else {
                leaderboard = freeLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Best 5 flights per pilot • Free scoring only • Oct 2024 - Sep 2025';
            }

            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(mode === 'mixed' ? 'combinedBtn' : 'freeBtn').classList.add('active');
            updateTaskStats(mode, {
                totalPilots: ` + totalPilots + `,
                totalFlights: ` + totalFlights + `,
                totalKms: ` + totalKms + `,
                totalTasksDeclared: ` + totalTasksDeclared + `,
                totalTasksCompleted: ` + totalTasksCompleted + `
            });
            buildLeaderboard();
        }

        // Flight preview functionality
        let previewTimeout;
        let previewElement;

        function showFlightPreview(flightId, event) {
            // Clear any existing timeout
            if (previewTimeout) {
                clearTimeout(previewTimeout);
            }

            // Delay showing preview by 300ms to avoid showing on quick hovers
            previewTimeout = setTimeout(() => {
                // Find the flight data in our current leaderboard
                let basicFlightData = null;
                for (const pilot of leaderboard) {
                    const flight = pilot.bestFlights.find(f => f.id === flightId);
                    if (flight) {
                        basicFlightData = { ...flight, pilot: pilot.pilot };
                        break;
                    }
                }

                // Find detailed flight data from the full dataset
                const detailedFlight = fullFlightData.find(f => f.id === flightId);

                if (basicFlightData && detailedFlight) {
                    showFlightTooltip(basicFlightData, detailedFlight, event);
                } else if (basicFlightData) {
                    showFlightTooltip(basicFlightData, null, event);
                }
            }, 300);
        }

        function showFlightTooltip(flightData, detailedFlight, event) {
            hideFlightPreview(); // Hide any existing preview

            previewElement = document.createElement('div');
            previewElement.className = 'flight-preview';

            // Determine task status and scoring type separately
            let taskStatusBadge = '';
            let scoringTypeBadge = '';

            if (detailedFlight) {

                // Task status badge - check if a task was declared in the original flight
                if (detailedFlight.hasTask) {
                    if (detailedFlight.taskAchieved) {
                        taskStatusBadge = '<span class="flight-type declared">✓ Task Completed</span>';
                    } else {
                        taskStatusBadge = '<span class="flight-type declared-incomplete">✗ Task Declared</span>';
                    }
                }

                // Scoring type badge - check the actual contestType used
                if (flightData.contestType === 'au') {
                    scoringTypeBadge = '<span class="flight-type declared">Task Score</span>';
                } else {
                    scoringTypeBadge = '<span class="flight-type free">Free Score</span>';
                }
            } else {
                // Fallback for flights without detailed data
                if (flightData.declared) {
                    taskStatusBadge = '<span class="flight-type declared">✓ Task Declared</span>';
                }
                // Use the actual contestType from the flight data
                if (flightData.contestType === 'au') {
                    scoringTypeBadge = '<span class="flight-type declared">Task Score</span>';
                } else {
                    scoringTypeBadge = '<span class="flight-type free">Free Score</span>';
                }
            }

            const statusBadges = [taskStatusBadge, scoringTypeBadge].filter(badge => badge).join(' ');

            // Helper functions for conversions
            const metersToFeet = (m) => Math.round(m * 3.28084);
            const msToKnots = (ms) => Math.round(ms * 1.94384 * 10) / 10;
            const formatDuration = (seconds) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return \`\${hours}h \${minutes}m\`;
            };

            let detailedStatsHtml = '';
            let flightImageHtml = '';

            if (detailedFlight) {
                // Determine which stats to use based on current leaderboard mode
                const isFreeMode = leaderboard === freeLeaderboard;
                let stats = null;

                if (isFreeMode) {
                    // In Free mode, always use free stats
                    stats = detailedFlight.freeStats;
                } else {
                    // In Mixed mode, use task stats if available and flight achieved task, otherwise free stats
                    if (detailedFlight.taskStats && detailedFlight.taskAchieved) {
                        stats = detailedFlight.taskStats;
                    } else {
                        stats = detailedFlight.freeStats;
                    }
                }

                if (!stats) {
                    console.log('No relevant stats found for flight', flightData.id, 'in mode', isFreeMode ? 'Free' : 'Mixed');
                    return;
                }

                const isTaskMode = stats === detailedFlight.taskStats;

                // Flight preview image
                flightImageHtml = \`
                    <div class="flight-image-section">
                        <img src="https://weglidefiles.b-cdn.net/flight/\${flightData.id}.jpg"
                             alt="Flight preview"
                             class="flight-preview-img"
                             onerror="this.style.display='none'"
                             onload="this.style.opacity=1">
                    </div>
                \`;

                detailedStatsHtml = \`
                    <div class="stats-section">
                        <div class="stats-header">Flight Performance (\${isTaskMode ? 'Task' : 'Free'})</div>
                        <div class="stats-grid-3col">
                            <div class="stat-item">
                                <span class="stat-label">Glide Ratio:</span>
                                <span class="stat-value">\${stats.glide_ratio ? stats.glide_ratio.toFixed(1) : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Avg Climb:</span>
                                <span class="stat-value">\${stats.thermal_avg ? msToKnots(stats.thermal_avg) + ' kts' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Thermals:</span>
                                <span class="stat-value">\${stats.thermal_count || 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Glide Speed:</span>
                                <span class="stat-value">\${stats.glide_speed ? stats.glide_speed.toFixed(0) + ' km/h' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">In Lift:</span>
                                <span class="stat-value">\${stats.glide_speed_lift ? stats.glide_speed_lift.toFixed(0) + ' km/h' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">In Sink:</span>
                                <span class="stat-value">\${stats.glide_speed_sink ? stats.glide_speed_sink.toFixed(0) + ' km/h' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Avg Altitude:</span>
                                <span class="stat-value">\${stats.altitude_avg ? metersToFeet(stats.altitude_avg) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Height Gain:</span>
                                <span class="stat-value">\${stats.thermal_gain ? metersToFeet(stats.thermal_gain) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Thermal Radius:</span>
                                <span class="stat-value">\${stats.thermal_radius ? metersToFeet(stats.thermal_radius) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Thermal Bank:</span>
                                <span class="stat-value">\${stats.thermal_bank ? stats.thermal_bank.toFixed(1) + '°' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Start AGL:</span>
                                <span class="stat-value">\${stats.thermal_start_agl ? metersToFeet(stats.thermal_start_agl) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Gliding %:</span>
                                <span class="stat-value">\${stats.glide_percentage ? Math.round(stats.glide_percentage * 100) + '%' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Glide Distance:</span>
                                <span class="stat-value">\${stats.glide_distance ? stats.glide_distance.toFixed(1) + ' km' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Glide % in Lift:</span>
                                <span class="stat-value">\${stats.glide_percentage_lift ? Math.round(stats.glide_percentage_lift * 100) + '%' : 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="stats-section">
                        <div class="stats-header">Time & Wind</div>
                        <div class="stats-grid-3col">
                            \${isTaskMode && stats.task_duration !== stats.total_duration ? \`
                                <div class="stat-item">
                                    <span class="stat-label">Task Duration:</span>
                                    <span class="stat-value">\${stats.task_duration ? formatDuration(stats.task_duration) : 'N/A'}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Total Duration:</span>
                                    <span class="stat-value">\${stats.total_duration ? formatDuration(stats.total_duration) : 'N/A'}</span>
                                </div>
                            \` : \`
                                <div class="stat-item">
                                    <span class="stat-label">Duration:</span>
                                    <span class="stat-value">\${stats.duration ? formatDuration(stats.duration) : 'N/A'}</span>
                                </div>
                            \`}
                            <div class="stat-item">
                                <span class="stat-label">Thermal Time:</span>
                                <span class="stat-value">\${stats.thermal_time ? formatDuration(stats.thermal_time) : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Glide Time:</span>
                                <span class="stat-value">\${stats.glide_time ? formatDuration(stats.glide_time) : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Wind Speed:</span>
                                <span class="stat-value">\${stats.wind_speed ? stats.wind_speed.toFixed(1) + ' km/h' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Wind Dir:</span>
                                <span class="stat-value">\${stats.wind_direction ? stats.wind_direction + '°' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Track Distance:</span>
                                <span class="stat-value">\${stats.track_distance ? stats.track_distance.toFixed(1) + ' km' : 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="stats-section">
                        <div class="stats-header">Efficiency & Risk</div>
                        <div class="stats-grid-3col">
                            <div class="stat-item">
                                <span class="stat-label">Thermal Attempts:</span>
                                <span class="stat-value">\${stats.attempt_count || 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Avg Climb Attempt:</span>
                                <span class="stat-value">\${stats.attempt_avg ? msToKnots(stats.attempt_avg) + ' kts' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Attempt Loss:</span>
                                <span class="stat-value">\${stats.attempt_speed_loss ? stats.attempt_speed_loss.toFixed(1) + ' km/h' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Avg Th. Start AGL:</span>
                                <span class="stat-value">\${stats.thermal_start_agl ? metersToFeet(stats.thermal_start_agl) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Avg AGL:</span>
                                <span class="stat-value">\${stats.agl_avg ? metersToFeet(stats.agl_avg) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Finish Alt:</span>
                                <span class="stat-value">\${stats.finish_alt ? metersToFeet(stats.finish_alt) + ' ft' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Glide Detour:</span>
                                <span class="stat-value">\${stats.glide_detour ? stats.glide_detour.toFixed(2) : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Below 3280ft:</span>
                                <span class="stat-value">\${stats.below_1000_agl ? Math.round(stats.below_1000_agl * 100) + '%' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Below 2625ft:</span>
                                <span class="stat-value">\${stats.below_800_agl ? Math.round(stats.below_800_agl * 100) + '%' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Below 1312ft:</span>
                                <span class="stat-value">\${stats.below_400_agl ? Math.round(stats.below_400_agl * 100) + '%' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Below 656ft:</span>
                                <span class="stat-value">\${stats.below_200_agl ? Math.round(stats.below_200_agl * 100) + '%' : 'N/A'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Below 328ft:</span>
                                <span class="stat-value">\${stats.below_100_agl ? Math.round(stats.below_100_agl * 100) + '%' : 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                \`;
            } else {
                console.log('No detailed flight found for ID:', flightData.id);
            }

            // Create aircraft display for tooltip header
            let aircraftHeaderDisplay = '';
            if (flightData.aircraftName && flightData.dmstIndex) {
                aircraftHeaderDisplay = \`\${flightData.aircraftName} - index \${flightData.dmstIndex}\`;
            } else if (flightData.aircraftName) {
                aircraftHeaderDisplay = flightData.aircraftName;
            } else if (flightData.aircraftKind) {
                aircraftHeaderDisplay = flightData.aircraftKind === 'GL' ? 'Glider' :
                                      flightData.aircraftKind === 'MG' ? 'Motor Glider' : flightData.aircraftKind;
            }

            previewElement.innerHTML = \`
                <button class="tooltip-close-btn" onclick="this.parentElement.remove()">&times;</button>
                <div class="flight-tooltip-header">
                    <strong>\${flightData.pilot}</strong>
                    \${aircraftHeaderDisplay ? \`<span class="aircraft-info">\${aircraftHeaderDisplay}</span>\` : ''}
                    \${statusBadges}
                </div>
                <div class="flight-tooltip-content">
                    \${flightImageHtml}
                    \${detailedStatsHtml}
                </div>
            \`;

            document.body.appendChild(previewElement);

            // Center the tooltip in the viewport
            previewElement.style.left = '50%';
            previewElement.style.top = '50%';
            previewElement.style.transform = 'translate(-50%, -50%)';

            // Fade in the tooltip
            setTimeout(() => {
                if (previewElement) {
                    previewElement.style.opacity = '1';
                }
            }, 10);
        }

        function hideFlightPreview() {
            if (previewTimeout) {
                clearTimeout(previewTimeout);
                previewTimeout = null;
            }

            if (previewElement) {
                previewElement.remove();
                previewElement = null;
            }
        }

        // Function to build the leaderboard table
        function buildLeaderboard() {
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '';

            leaderboard.forEach((pilot, index) => {
                const row = document.createElement('tr');
                const isFreeMode = leaderboard === freeLeaderboard;

                let rankDisplay = index + 1;
                if (!isFreeMode) {
                    if (index === 0) rankDisplay = '<span class="medal gold">🥇</span>' + rankDisplay;
                    else if (index === 1) rankDisplay = '<span class="medal silver">🥈</span>' + rankDisplay;
                    else if (index === 2) rankDisplay = '<span class="medal bronze">🥉</span>' + rankDisplay;
                }

                // Create pilot name with link to WeGlide profile
                let pilotName = \`<a href="https://www.weglide.org/user/\${pilot.pilotId}" target="_blank" class="pilot-link">\${pilot.pilot}</a>\`;

                // Add aircraft award badges in free mode
                if (isFreeMode && pilot.awards && pilot.awards.length > 0) {
                    const badges = pilot.awards.map(award => {
                        if (award.type === 'glider') {
                            return '<span class="award-badge glider" title="Best Pure Glider Free Score">🪁 Best Pure Glider</span>';
                        } else if (award.type === 'motorGlider') {
                            return '<span class="award-badge motor-glider" title="Best Motor Glider Free Score">⚙️ Best Motor Glider</span>';
                        }
                        return '';
                    }).join('');
                    pilotName = \`\${pilotName} \${badges}\`;
                }

                row.innerHTML = \`
                    <td class="rank">\${rankDisplay}</td>
                    <td class="pilot-name">\${pilotName}</td>
                    <td class="total-points">\${pilot.totalPoints.toFixed(1)}</td>
                    \${pilot.bestFlights.map(flight => createFlightCell(flight)).join('')}
                    \${Array(5 - pilot.bestFlights.length).fill('<td class="flight-cell">-</td>').join('')}
                \`;

                tbody.appendChild(row);
            });

            // Update stats - always show ALL flight stats, not just leaderboard stats
            document.getElementById('pilotCount').textContent = ` + totalPilots + `;
            document.getElementById('flightCount').textContent = ` + totalFlights + `;
            document.getElementById('totalKms').textContent = ` + totalKms + `;

            // Task stats are handled by updateTaskStats function
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadLeaderboard();
            document.getElementById('combinedBtn').addEventListener('click', () => switchScoringMode('mixed'));
            document.getElementById('freeBtn').addEventListener('click', () => switchScoringMode('free'));
        });
    </script>`;

        australianHTML = australianHTML.substring(0, scriptStart) +
                        newScriptContent +
                        australianHTML.substring(scriptEnd);

        // Add scoring toggle buttons after the stats section (Task Analysis removed)
        australianHTML = australianHTML.replace(
            /(<div class="stats">.*?<\/div>\s*)<\/div>/s,
            '$1</div><div class="scoring-toggle"><button class="toggle-btn active" id="combinedBtn">Combined Scoring</button><button class="toggle-btn" id="freeBtn">Free Only</button></div>'
        );

        // Add CSS for toggle buttons and award badges
        const toggleCSS = `
        /* Scoring toggle buttons */
        .scoring-toggle {
            margin: 20px 0;
            display: flex;
            gap: 10px;
            justify-content: center;
            padding: 0 20px;
        }

        .toggle-btn {
            padding: 8px 16px;
            border: 2px solid rgba(255,255,255,0.3);
            background: rgba(255,255,255,0.1);
            color: white;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
            font-weight: 500;
        }

        .toggle-btn:hover {
            background: rgba(255,255,255,0.2);
            border-color: rgba(255,255,255,0.5);
        }

        .toggle-btn.active {
            background: rgba(255,255,255,0.9);
            color: #2c5aa0;
            border-color: rgba(255,255,255,0.9);
        }

        /* Award badges */
        .award-badge {
            font-size: 0.85em;
            margin-left: 6px;
            opacity: 0.7;
            display: inline;
            white-space: nowrap;
        }

        .award-badge.glider {
            color: #4a90e2;
        }

        .award-badge.motor-glider {
            color: #f39c12;
        }

        /* Aircraft info styling */
        .aircraft-info {
            font-size: 0.85em;
            opacity: 0.8;
            margin: 0 8px;
        }

        .flight-aircraft {
            font-size: 0.8em;
            color: #888;
            font-style: italic;
        }


        /* Close button for mobile */
        .tooltip-close-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border: none;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        }

        .tooltip-close-btn:hover {
            background: rgba(0, 0, 0, 0.9);
        }

        /* Mobile responsive tooltip */
        @media (max-width: 768px) {
            .flight-preview {
                width: 95vw !important;
                height: 95vh !important;
                max-width: none !important;
                max-height: none !important;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) !important;
                border-radius: 8px;
                overflow-y: auto;
            }

            .tooltip-close-btn {
                display: flex;
            }

            .flight-tooltip-content {
                padding: 15px;
                padding-top: 50px;
            }
        }

        /* Flight preview tooltip */
        .flight-preview {
            position: fixed;
            z-index: 10000;
            background: #1a1a1a;
            color: white;
            border: 1px solid #333;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            padding: 0;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .flight-tooltip-header {
            background: #2c5aa0;
            padding: 10px 12px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.9em;
        }

        .flight-type {
            font-size: 0.8em;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: normal;
        }

        .flight-type.declared {
            background: rgba(76, 175, 80, 0.8);
        }

        .flight-type.declared-incomplete {
            background: rgba(255, 152, 0, 0.8);
        }

        .flight-type.free {
            background: rgba(158, 158, 158, 0.8);
        }

        .flight-tooltip-content {
            padding: 10px 12px;
        }

        .tooltip-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 0.85em;
        }

        .tooltip-row:last-child {
            margin-bottom: 0;
        }

        .flight-tooltip-link {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #333;
        }

        .flight-tooltip-link a {
            color: #64b5f6;
            text-decoration: none;
            font-size: 0.8em;
        }

        .flight-tooltip-link a:hover {
            text-decoration: underline;
        }

        /* Detailed stats styling */
        .stats-section {
            padding-top: 8px;
            margin-top: 8px;
        }

        .stats-header {
            font-weight: bold;
            font-size: 0.85em;
            margin-bottom: 6px;
            color: #ccc;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px 8px;
        }

        .stats-grid-3col {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 4px 8px;
        }

        .stat-item {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
        }

        .stat-label {
            color: #aaa;
        }

        .stat-value {
            color: white;
            font-weight: 500;
        }

        /* Flight image styling */
        .flight-image-section {
            padding: 10px 12px;
            text-align: center;
            border-bottom: 1px solid #333;
        }

        .flight-preview-img {
            max-width: 100%;
            max-height: 200px;
            border-radius: 4px;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .flight-cell {
            cursor: pointer;
            position: relative;
        }

        .flight-cell:hover {
            background-color: rgba(255,255,255,0.05);
        }

        /* Pilot and WeGlide links */
        .pilot-link {
            color: inherit;
            text-decoration: none;
        }

        .pilot-link:hover {
            text-decoration: underline;
            color: #0066cc;
        }

        .weglide-link {
            font-size: 0.8em;
            color: #666;
            text-decoration: none;
        }

        .weglide-link:hover {
            color: #0066cc;
            text-decoration: underline;
        }

        /* Smaller flight details */
        .flight-details {
            font-size: 0.85em;
            line-height: 1.3;
        }

        .flight-location {
            font-size: 0.8em;
            color: #666;
        }`;

        australianHTML = australianHTML.replace('</style>', toggleCSS + '\n    </style>');


        // Write the Australian leaderboard HTML
        fs.writeFileSync('australian_leaderboard.html', australianHTML);

        console.log('✅ Created australian_leaderboard.html');
        console.log(`📊 Top 10 pilots (Mixed Scoring):`);
        mixedLeaderboard.slice(0, 10).forEach((pilot, index) => {
            console.log(`${index + 1}. ${pilot.pilot}: ${pilot.totalPoints.toFixed(1)} points (${pilot.flightCount} flights, ${pilot.totalDistance.toFixed(0)} km)`);
        });

    } catch (error) {
        console.error('❌ Error processing flights:', error.message);
    }
}

processAustralianFlights();
