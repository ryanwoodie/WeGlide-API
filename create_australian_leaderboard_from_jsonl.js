const fs = require('fs');
const readline = require('readline');

// Function to calculate best score from flight contest data (Mixed scoring)
function calculateBestScore(flight) {
    if (!flight.contest || !Array.isArray(flight.contest)) {
        return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
    }

    // Find the "au" (task), "declaration", and "free" contests specifically
    const auContest = flight.contest.find(contest => contest.name === 'au' && contest.points > 0);
    const declarationContest = flight.contest.find(contest => contest.name === 'declaration' && contest.points > 0);
    const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

    let bestContest = null;
    let bestScore = 0;

    // Check if contests are declared (have declared: true in their score object)
    const isAuDeclared = auContest?.score?.declared === true;
    const isDeclarationDeclared = declarationContest?.score?.declared === true;

    // Always start with free contest as baseline
    if (freeContest) {
        bestContest = freeContest;
        bestScore = freeContest.points;
    }

    // Check if AU contest should be used (higher than free AND declared)
    if (auContest && isAuDeclared && auContest.points > bestScore) {
        bestContest = auContest;
        bestScore = auContest.points;
    }

    // Check if Declaration contest should be used (higher than current best AND declared)
    if (declarationContest && isDeclarationDeclared && declarationContest.points > bestScore) {
        bestContest = declarationContest;
        bestScore = declarationContest.points;
    }

    // If no au/declaration/free found, fall back to any other contest with points
    if (!bestContest) {
        flight.contest.forEach(contest => {
            if (contest.points && contest.points > bestScore) {
                bestScore = contest.points;
                bestContest = contest;
            }
        });
    }

    if (bestContest) {
        // Mark as declared if using au or declaration contest that was declared
        const isDeclaredTask = (bestContest.name === 'au' && isAuDeclared) ||
                              (bestContest.name === 'declaration' && isDeclarationDeclared);

        return {
            score: bestScore,
            distance: bestContest.distance || 0,
            speed: bestContest.speed || 0,
            contestType: bestContest.name || 'unknown',
            declared: isDeclaredTask
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
                            userId: flight.user?.id,
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
                            userId: flight.user?.id,
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
                        pilotId: bestFlights[0].userId || bestFlights[0].id,
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

        // Function to generate Silver C-Gull Trophy leaderboard (juniors with silver badge)
        function generateSilverCGullLeaderboard() {
            const silverBadgeJuniors = [];

            // Re-read the file to find silver badge achievements
            const fileStream = fs.createReadStream('/Users/ryanwood/GitHub/WeGlide-API/australian_flights_2025_details.jsonl');

            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: fileStream,
                    crlfDelay: Infinity
                });

                rl.on('line', (line) => {
                    if (line.trim().length > 0) {
                        try {
                            const flight = JSON.parse(line);

                            // Check for silver badge achievement in junior pilots
                            if (flight.junior && flight.achievement && Array.isArray(flight.achievement)) {
                                const silverBadge = flight.achievement.find(a => a.badge_id === 'silver');
                                if (silverBadge) {
                                    // Check if we already have this pilot
                                    const existingPilot = silverBadgeJuniors.find(p => p.userId === flight.user.id);
                                    if (!existingPilot) {
                                        silverBadgeJuniors.push({
                                            pilot: flight.user.name,
                                            flightId: flight.id,
                                            date: flight.scoring_date,
                                            distance: getBestDistance(flight),
                                            duration: formatDuration(flight.total_seconds),
                                            points: getBestPoints(flight),
                                            takeoff: flight.takeoff_airport?.name || 'Unknown',
                                            club: flight.club?.name || 'Unknown',
                                            userId: flight.user.id
                                        });
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                });

                rl.on('close', () => {
                    // Sort by pilot name
                    silverBadgeJuniors.sort((a, b) => a.pilot.localeCompare(b.pilot));
                    resolve(silverBadgeJuniors);
                });
            });
        }

        function getBestDistance(flight) {
            if (!flight.contest || !Array.isArray(flight.contest)) return 'Unknown';

            let bestDistance = 0;
            flight.contest.forEach(contest => {
                if (contest.distance && contest.distance > bestDistance) {
                    bestDistance = contest.distance;
                }
            });

            return bestDistance > 0 ? `${bestDistance.toFixed(1)} km` : 'Unknown';
        }

        function getBestPoints(flight) {
            if (!flight.contest || !Array.isArray(flight.contest)) return 'Unknown';

            let bestPoints = 0;
            flight.contest.forEach(contest => {
                if (contest.points && contest.points > bestPoints) {
                    bestPoints = contest.points;
                }
            });

            return bestPoints > 0 ? `${bestPoints.toFixed(1)} pts` : 'Unknown';
        }

        function formatDuration(seconds) {
            if (!seconds) return 'Unknown';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }

        // Generate Silver C-Gull leaderboard
        const silverCGullLeaderboard = await generateSilverCGullLeaderboard();

        // Calculate aircraft type awards for free leaderboard
        function calculateAircraftAwards(pilotFlights) {
            let bestGliderScore = 0;
            let bestGliderPilot = null;
            let bestGliderPilotId = null;
            let bestMotorGliderScore = 0;
            let bestMotorGliderPilot = null;
            let bestMotorGliderPilotId = null;

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
                        bestGliderPilotId = bestGliderFlights[0].userId;
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
                        bestMotorGliderPilotId = bestMotorGliderFlights[0].userId;
                    }
                }
            });

            return {
                bestGliderPilot,
                bestGliderPilotId,
                bestGliderScore,
                bestMotorGliderPilot,
                bestMotorGliderPilotId,
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

        // Write detailed flight data to separate file to avoid embedding large data
        fs.writeFileSync('australian_flight_details.json', JSON.stringify(australianFlights, null, 2));
        console.log(`💾 Saved detailed flight data to australian_flight_details.json`);

        // Write minimal flight data for task stats to separate file
        const minimalFlightData = allFlightData.map(f => ({
            id: f.id,
            user: f.user ? { id: f.user.id, name: f.user.name } : null,
            task: f.task,
            task_achieved: f.task_achieved,
            contest: f.contest ? f.contest.map(c => ({
                name: c.name,
                points: c.points,
                distance: c.distance,
                speed: c.speed,
                score: c.score ? { declared: c.score.declared } : null
            })) : null
        }));
        fs.writeFileSync('australian_flight_stats.json', JSON.stringify(minimalFlightData, null, 2));
        console.log(`💾 Saved flight stats data to australian_flight_stats.json`);

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
                if (flight.contest && Array.isArray(flight.contest)) {
                    const auContest = flight.contest.find(contest => contest.name === 'au' && contest.points > 0);
                    const declarationContest = flight.contest.find(contest => contest.name === 'declaration' && contest.points > 0);
                    const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

                    // Check if declared AU or Declaration scored higher than free
                    const isAuDeclared = auContest?.score?.declared === true;
                    const isDeclarationDeclared = declarationContest?.score?.declared === true;

                    if (freeContest) {
                        if (auContest && isAuDeclared && auContest.points > freeContest.points) {
                            totalTasksHigherThanFree++;
                        } else if (declarationContest && isDeclarationDeclared && declarationContest.points > freeContest.points) {
                            totalTasksHigherThanFree++;
                        }
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

        // Helper: server-side fetch of pilot durations (no CORS in Node)
        async function fetchUserDurationsServer(pilotIds) {
            const out = {};
            const chunk = 100;
            for (let i = 0; i < pilotIds.length; i += chunk) {
                const slice = pilotIds.slice(i, i + chunk);
                const url = `https://api.weglide.org/v1/user?id_in=${slice.join(',')}`;
                try {
                    const resp = await fetch(url);
                    if (!resp.ok) continue;
                    const arr = await resp.json();
                    arr.forEach(u => {
                        if (u && typeof u.id === 'number' && typeof u.total_flight_duration === 'number') {
                            out[u.id] = u.total_flight_duration;
                        }
                    });
                } catch (e) {
                    console.warn('Server-side duration fetch failed for batch:', e.message || e);
                }
            }
            return out;
        }

        // Compute unique pilot IDs and prefetch durations server-side
        const allPilotIds = Array.from(new Set([...mixedLeaderboard, ...freeLeaderboard].map(p => p.pilotId)));
        let pilotDurationsEmbedded = {};
        try {
            const cachePath = 'australian_user_durations.json';
            let loaded = false;
            if (fs.existsSync(cachePath)) {
                pilotDurationsEmbedded = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                if (pilotDurationsEmbedded && Object.keys(pilotDurationsEmbedded).length > 0) {
                    console.log('ℹ️ Loaded cached australian_user_durations.json');
                    loaded = true;
                } else {
                    console.log('ℹ️ Cache exists but empty, refetching durations...');
                }
            }
            if (!loaded) {
                console.log('⏬ Fetching pilot durations from WeGlide...');
                pilotDurationsEmbedded = await fetchUserDurationsServer(allPilotIds);
                fs.writeFileSync(cachePath, JSON.stringify(pilotDurationsEmbedded, null, 2));
                console.log('💾 Saved pilot durations to australian_user_durations.json');
            }
        } catch (e) {
            console.warn('⚠️ Could not load/save australian_user_durations.json:', e.message || e);
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

        // Build script content with embedded durations
        const newScriptContent = `<script>
        // Global variables for leaderboard data
        let mixedLeaderboard = [];
        let freeLeaderboard = [];
        let fullFlightData = [];
        let detailedFlightData = [];
        let leaderboard = [];
        const HOURS_200_SEC = 200 * 3600;
        let under200Enabled = false;
        // Embedded pilot durations (seconds), keyed by pilotId
        const pilotDurations = __PILOT_DURATIONS_PLACEHOLDER__;

        // Embedded aircraft awards data
        const aircraftAwards = ${JSON.stringify(aircraftAwards)};

        // Durations embedded at build time; no client-side fetch required

        function applyUnder200Filter(list) {
            if (!under200Enabled) return list;
            return list.filter(p => (typeof pilotDurations[p.pilotId] === 'number') && pilotDurations[p.pilotId] < HOURS_200_SEC);
        }

        async function loadLeaderboard() {
            try {
                // Embedded leaderboard data
                mixedLeaderboard = ${JSON.stringify(mixedLeaderboard)};
                freeLeaderboard = ${JSON.stringify(freeLeaderboard)};
                silverCGullLeaderboard = ${JSON.stringify(silverCGullLeaderboard)};

                // Embedded detailed flight data for tooltips (compressed)
                detailedFlightData = ${JSON.stringify(australianFlights)};

                // Embedded minimal flight data for task stats (compressed)
                fullFlightData = ${JSON.stringify(minimalFlightData)};

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
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();

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

                // Update main stats for Combined mode (all flights)
                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();

            } else if (mode === 'silverCGull') {
                leaderboard = silverCGullLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Junior pilots with Silver Badge achievement • Single qualifying flight • Sorted by last name';

                // Clear the <200 filter when switching to Silver C-Gull mode
                under200Enabled = false;
                const underBtn = document.getElementById('under200Btn');
                if (underBtn) {
                    underBtn.classList.remove('active');
                    updateUnder200ButtonLabel();
                }

                // Update main stats for Silver C-Gull mode
                document.getElementById('pilotCount').textContent = silverCGullLeaderboard.length;
                document.getElementById('flightCount').textContent = silverCGullLeaderboard.length; // 1 flight per pilot
                const silverKms = silverCGullLeaderboard.reduce((sum, pilot) => {
                    const distance = parseFloat(pilot.distance) || 0;
                    return sum + distance;
                }, 0);
                document.getElementById('totalKms').textContent = Math.round(silverKms).toLocaleString();

            } else {
                leaderboard = freeLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Best 5 flights per pilot • Free scoring only • Oct 2024 - Sep 2025';

                // Update main stats for Free mode (use total dataset stats, not leaderboard stats)
                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();
            }

            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            const activeBtn = mode === 'mixed' ? 'combinedBtn' : mode === 'silverCGull' ? 'silverCGullBtn' : 'freeBtn';
            document.getElementById(activeBtn).classList.add('active');

            // Update task stats (only relevant for mixed/free modes)
            if (mode !== 'silverCGull') {
                updateTaskStats(mode, {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `
                });
            }
            // Keep the 200hrs toggle visual state consistent across modes
            const underBtn = document.getElementById('under200Btn');
            if (underBtn) {
                underBtn.classList.toggle('active', under200Enabled);
                if (typeof updateUnder200ButtonLabel === 'function') updateUnder200ButtonLabel();
            }
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

                // Find detailed flight data from the loaded dataset
                const detailedFlight = detailedFlightData.find(f => f.id === flightId);

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
                } else if (flightData.contestType === 'declaration') {
                    scoringTypeBadge = '<span class="flight-type declared">Declaration Score</span>';
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
                } else if (flightData.contestType === 'declaration') {
                    scoringTypeBadge = '<span class="flight-type declared">Declaration Score</span>';
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

        // Function to calculate aircraft awards for visible pilots
        function calculateVisibleAircraftAwards(visiblePilots) {
            let bestGliderScore = 0;
            let bestGliderPilotId = null;
            let bestMotorGliderScore = 0;
            let bestMotorGliderPilotId = null;

            visiblePilots.forEach(pilot => {
                // Separate flights by aircraft type
                const gliderFlights = pilot.bestFlights.filter(f => f.aircraftKind === 'GL');
                const motorGliderFlights = pilot.bestFlights.filter(f => f.aircraftKind === 'MG');

                // Calculate total scores for each aircraft type
                if (gliderFlights.length > 0) {
                    const totalGliderScore = gliderFlights.reduce((sum, flight) => sum + flight.points, 0);
                    if (totalGliderScore > bestGliderScore) {
                        bestGliderScore = totalGliderScore;
                        bestGliderPilotId = pilot.pilotId;
                    }
                }

                if (motorGliderFlights.length > 0) {
                    const totalMotorGliderScore = motorGliderFlights.reduce((sum, flight) => sum + flight.points, 0);
                    if (totalMotorGliderScore > bestMotorGliderScore) {
                        bestMotorGliderScore = totalMotorGliderScore;
                        bestMotorGliderPilotId = pilot.pilotId;
                    }
                }
            });

            return {
                bestGliderPilotId,
                bestMotorGliderPilotId
            };
        }

        // Function to build the leaderboard table
        function buildLeaderboard() {
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '';
            const isFreeMode = leaderboard === freeLeaderboard;
            const isSilverCGull = leaderboard === silverCGullLeaderboard;
            const visible = applyUnder200Filter(leaderboard);

            // Calculate aircraft awards for visible pilots in free mode
            const visibleAwards = isFreeMode ? calculateVisibleAircraftAwards(visible) : null;

            visible.forEach((pilot, index) => {
                const row = document.createElement('tr');

                let rankDisplay = index + 1;
                if (!isFreeMode && !isSilverCGull) {
                    if (index === 0) rankDisplay = '<span class="medal gold">🥇</span>' + rankDisplay;
                    else if (index === 1) rankDisplay = '<span class="medal silver">🥈</span>' + rankDisplay;
                    else if (index === 2) rankDisplay = '<span class="medal bronze">🥉</span>' + rankDisplay;
                }

                // Create pilot name with link to WeGlide profile
                let pilotName;
                if (isSilverCGull) {
                    // For Silver C-Gull, check if pilotId is available
                    if (pilot.userId) {
                        pilotName = \`<a href="https://www.weglide.org/user/\${pilot.userId}" target="_blank" class="pilot-link">\${pilot.pilot}</a>\`;
                    } else {
                        pilotName = pilot.pilot;
                    }
                } else {
                    pilotName = \`<a href="https://www.weglide.org/user/\${pilot.pilotId}" target="_blank" class="pilot-link">\${pilot.pilot}</a>\`;
                }

                // Add aircraft award badges in free mode (calculated for visible pilots)
                if (isFreeMode && visibleAwards) {
                    const badges = [];
                    // Check if this pilot is the best glider pilot among visible pilots
                    if (visibleAwards.bestGliderPilotId === pilot.pilotId) {
                        badges.push('<span class="award-badge glider" title="Best Pure Glider Free Score">🪁 Best Pure Glider</span>');
                    }
                    // Check if this pilot is the best motor glider pilot among visible pilots
                    if (visibleAwards.bestMotorGliderPilotId === pilot.pilotId) {
                        badges.push('<span class="award-badge motor-glider" title="Best Motor Glider Free Score">⚙️ Best Motor Glider</span>');
                    }
                    if (badges.length > 0) {
                        pilotName = \`\${pilotName} \${badges.join('')}\`;
                    }
                }

                // Handle different data structures
                if (isSilverCGull) {
                    // Silver C-Gull candidates have a different structure
                    const flightUrl = \`https://www.weglide.org/flight/\${pilot.flightId}\`;
                    const pointsDisplay = pilot.points === 'Unknown' ? 'Unknown' : pilot.points;
                    row.innerHTML = \`
                        <td class="rank">\${rankDisplay}</td>
                        <td class="pilot-name">\${pilotName}</td>
                        <td class="total-points">\${pointsDisplay}</td>
                        <td class="flight-cell">
                            <div class="flight-details">
                                <div class="flight-points">\${pointsDisplay}</div>
                                <div class="flight-distance">\${pilot.distance}</div>
                                <div class="flight-speed">\${pilot.duration}</div>
                                <div class="flight-date">\${pilot.date}</div>
                                <div class="flight-aircraft">\${pilot.club}</div>
                                <div class="flight-location">\${pilot.takeoff} • <a href="\${flightUrl}" target="_blank" class="weglide-link">View on WeGlide →</a></div>
                            </div>
                        </td>
                        <td class="flight-cell">-</td>
                        <td class="flight-cell">-</td>
                        <td class="flight-cell">-</td>
                        <td class="flight-cell">-</td>
                    \`;
                } else {
                    // Regular leaderboard structure
                    row.innerHTML = \`
                        <td class="rank">\${rankDisplay}</td>
                        <td class="pilot-name">\${pilotName}</td>
                        <td class="total-points">\${pilot.totalPoints.toFixed(1)}</td>
                        \${pilot.bestFlights.map(flight => createFlightCell(flight)).join('')}
                        \${Array(5 - pilot.bestFlights.length).fill('<td class="flight-cell">-</td>').join('')}
                    \`;
                }

                tbody.appendChild(row);
            });

            // Update stats based on current visibility (only for <200 hour filter or Silver C-Gull mode)
            if (under200Enabled || isSilverCGull) {
                const visibleStatsList = visible;
                document.getElementById('pilotCount').textContent = visibleStatsList.length;
                if (isSilverCGull) {
                    // Silver C-Gull shows 1 flight per pilot
                    document.getElementById('flightCount').textContent = visibleStatsList.length;
                } else {
                    // For <200 hour filter, show ALL flights in database from visible pilots
                    const visiblePilotIds = new Set(visibleStatsList.map(p => p.pilotId));
                    const totalFlightsVisible = (fullFlightData || []).filter(f =>
                        f && f.user && visiblePilotIds.has(f.user.id)
                    ).length;
                    document.getElementById('flightCount').textContent = totalFlightsVisible;
                }
                if (isSilverCGull) {
                    // For Silver C-Gull, use the distance from the Silver Badge flights
                    const totalKmsVisible = Math.round(visibleStatsList.reduce((sum, p) => sum + (p.totalDistance || 0), 0));
                    document.getElementById('totalKms').textContent = totalKmsVisible.toLocaleString();
                } else {
                    // For <200 hour filter, calculate total km from ALL flights in database from visible pilots
                    const visiblePilotIds = new Set(visibleStatsList.map(p => p.pilotId));
                    const totalKmsVisible = (fullFlightData || []).filter(f =>
                        f && f.user && visiblePilotIds.has(f.user.id)
                    ).reduce((sum, flight) => {
                        // Use the same logic as main stats calculation
                        const bestScore = calculateBestScoreForFlight(flight);
                        return sum + (bestScore.distance || 0);
                    }, 0);
                    document.getElementById('totalKms').textContent = Math.round(totalKmsVisible).toLocaleString();
                }
            } else if (!isSilverCGull) {
                // When <200 filter is off, restore original dataset stats for Combined/Free modes
                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();
            }

            // Recompute task stats for visible pilots using embedded fullFlightData (only when filtering)
            if (under200Enabled && !isSilverCGull) {
                try {
                    const visibleStatsList = visible;
                    const pilotIdSet = new Set(visibleStatsList.map(p => p.pilotId));
                let tasksDeclared = 0;
                let tasksCompleted = 0;
                let tasksHigherThanFree = 0;
                (fullFlightData || []).forEach(f => {
                    if (!f || !f.user || !pilotIdSet.has(f.user.id)) return;
                    if (f.task) {
                        tasksDeclared++;
                        if (f.task_achieved === true) {
                            tasksCompleted++;
                            if (Array.isArray(f.contest)) {
                                const au = f.contest.find(c => c && c.name === 'au' && c.points > 0);
                                const decl = f.contest.find(c => c && c.name === 'declaration' && c.points > 0);
                                const fr = f.contest.find(c => c && c.name === 'free' && c.points > 0);

                                const isAuDeclared = au?.score?.declared === true;
                                const isDeclDeclared = decl?.score?.declared === true;

                                if (fr) {
                                    if (au && isAuDeclared && au.points > fr.points) {
                                        tasksHigherThanFree++;
                                    } else if (decl && isDeclDeclared && decl.points > fr.points) {
                                        tasksHigherThanFree++;
                                    }
                                }
                            }
                        }
                    }
                });
                // Get the filtered totals we just calculated
                const filteredPilots = visibleStatsList.length;
                const filteredFlights = (fullFlightData || []).filter(f =>
                    f && f.user && pilotIdSet.has(f.user.id)
                ).length;
                const filteredKms = Math.round((fullFlightData || []).filter(f =>
                    f && f.user && pilotIdSet.has(f.user.id)
                ).reduce((sum, flight) => {
                    const bestScore = calculateBestScoreForFlight(flight);
                    return sum + (bestScore.distance || 0);
                }, 0));

                updateTaskStats(isFreeMode ? 'free' : 'mixed', {
                    totalPilots: filteredPilots,
                    totalFlights: filteredFlights,
                    totalKms: filteredKms,
                    totalTasksDeclared: tasksDeclared,
                    totalTasksCompleted: tasksCompleted,
                    totalTasksHigherThanFree: tasksHigherThanFree
                });
                } catch (e) {
                    console.warn('Task stats recompute failed:', e);
                }
            } else if (!isSilverCGull) {
                // When filter is off, restore original stats for Combined/Free modes
                const currentMode = leaderboard === mixedLeaderboard ? 'mixed' : 'free';
                updateTaskStats(currentMode, {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            }
        }

        function updateUnder200ButtonLabel() {
            const btn = document.getElementById('under200Btn');
            if (!btn) return;
            btn.textContent = under200Enabled ? '< 200 hrs PIC (ON)' : '< 200 hrs PIC';
        }

        // Trophy calculation functions
        function calculateTrophyWinners() {
            const trophies = {
                canadair: calculateCanadairTrophy(),
                trophy200: calculateTrophy200(),
                baic: calculateBAICTrophy(),
                dow: calculateDowTrophies()
            };

            displayTrophyWinners(trophies);
        }

        function calculateCanadairTrophy() {
            // Top pilot from mixed leaderboard (top 5 flights combined)
            const mixedWinner = mixedLeaderboard[0];
            const freeWinner = freeLeaderboard[0];

            const result = {
                combined: mixedWinner,
                free: null,
                sameWinner: false,
                explanation: ''
            };

            if (mixedWinner && freeWinner && mixedWinner.pilot === freeWinner.pilot) {
                result.sameWinner = true;
                result.explanation = 'Combined and Free score same person - 1 award';
            } else if (freeWinner) {
                result.free = freeWinner;
                result.explanation = 'Different winners in Combined vs Free scoring - 2 awards';
            }

            return result;
        }

        function calculateTrophy200() {
            // Always use <200 hrs pilots regardless of current filter state
            const mixed200 = mixedLeaderboard.filter(p =>
                (typeof pilotDurations[p.pilotId] === 'number') &&
                pilotDurations[p.pilotId] < HOURS_200_SEC
            );
            const free200 = freeLeaderboard.filter(p =>
                (typeof pilotDurations[p.pilotId] === 'number') &&
                pilotDurations[p.pilotId] < HOURS_200_SEC
            );

            const result = {
                combined: mixed200[0] || null,
                free: null,
                sameWinner: false,
                explanation: ''
            };

            if (mixed200[0] && free200[0] && mixed200[0].pilot === free200[0].pilot) {
                result.sameWinner = true;
                result.explanation = 'Combined and Free score same person - 1 award';
            } else if (free200[0]) {
                result.free = free200[0];
                result.explanation = 'Different winners in Combined vs Free scoring - 2 awards';
            } else if (!mixed200[0]) {
                result.explanation = 'No pilots found with <200 hours';
            }

            return result;
        }

        function calculateBAICTrophy() {
            // Single highest scoring flight - need to check ALL flights, not just top 5
            let bestCombinedFlight = null;
            let bestFreeFlight = null;
            let bestCombinedScore = 0;
            let bestFreeScore = 0;

            // Check ALL flights in the full flight data
            fullFlightData.forEach(flight => {
                if (!flight.contest || !Array.isArray(flight.contest)) return;

                // Calculate combined score (our standard logic)
                const combinedScoring = calculateBestScoreForFlight(flight);
                if (combinedScoring.score > bestCombinedScore) {
                    bestCombinedScore = combinedScoring.score;
                    bestCombinedFlight = {
                        id: flight.id,
                        pilot: flight.user?.name,
                        pilotId: flight.user?.id,
                        points: combinedScoring.score,
                        distance: combinedScoring.distance,
                        speed: combinedScoring.speed,
                        contestType: combinedScoring.contestType,
                        declared: combinedScoring.declared
                    };
                }

                // Calculate free-only score
                const freeContest = flight.contest.find(c => c.name === 'free' && c.points > 0);
                if (freeContest && freeContest.points > bestFreeScore) {
                    bestFreeScore = freeContest.points;
                    bestFreeFlight = {
                        id: flight.id,
                        pilot: flight.user?.name,
                        pilotId: flight.user?.id,
                        points: freeContest.points,
                        distance: freeContest.distance || 0,
                        speed: freeContest.speed || 0,
                        contestType: 'free',
                        declared: false
                    };
                }
            });

            const sameWinner = bestCombinedFlight?.id === bestFreeFlight?.id;

            return {
                combined: bestCombinedFlight,
                free: sameWinner ? null : bestFreeFlight,
                sameWinner: sameWinner,
                explanation: sameWinner ?
                    'Same flight wins both Combined and Free - 1 award' :
                    'Different flights win Combined vs Free - 2 awards'
            };
        }

        function calculateDowTrophies() {
            const triangleBest = findBestByTaskType(['TR']);
            const orBest = findBestByTaskType(['OR']);
            const goalBest = findBestByTaskType(['GL'], true); // Goal requires declared tasks only

            return {
                triangle: triangleBest,
                outReturn: orBest,
                goal: goalBest
            };
        }

        function findBestByTaskType(taskTypes, declaredOnly = false) {
            let bestFlight = null;
            let bestScore = 0;

            // Look through all flight data to find task types
            fullFlightData.forEach(flight => {
                if (!flight.task || !taskTypes.includes(flight.task.kind)) return;
                if (!flight.contest || !Array.isArray(flight.contest)) return;

                let contestToUse = null;
                let scoreToUse = 0;

                // For Dow trophies, compare scores and use the higher one
                if (taskTypes.includes('TR')) {
                    // Triangle: compare triangle contest vs au/declaration (if declared)
                    const triangleContest = flight.contest.find(c => c.name === 'triangle' && c.points > 0);
                    const auContest = flight.contest.find(c => c.name === 'au' && c.points > 0);
                    const declarationContest = flight.contest.find(c => c.name === 'declaration' && c.points > 0);
                    const freeContest = flight.contest.find(c => c.name === 'free' && c.points > 0);

                    const candidates = [];

                    if (triangleContest) {
                        candidates.push({ contest: triangleContest, score: triangleContest.points });
                    }
                    if (auContest?.score?.declared) {
                        candidates.push({ contest: auContest, score: auContest.points });
                    }
                    if (declarationContest?.score?.declared) {
                        candidates.push({ contest: declarationContest, score: declarationContest.points });
                    }
                    if (!declaredOnly && freeContest && candidates.length === 0) {
                        candidates.push({ contest: freeContest, score: freeContest.points });
                    }

                    // Use the highest scoring contest
                    const bestCandidate = candidates.reduce((best, current) =>
                        current.score > best.score ? current : best,
                        { score: 0 }
                    );

                    if (bestCandidate.contest) {
                        contestToUse = bestCandidate.contest;
                        scoreToUse = bestCandidate.score;
                    }
                } else if (taskTypes.includes('OR')) {
                    // Out & Return: compare out_return contest vs au/declaration (if declared)
                    const orContest = flight.contest.find(c => c.name === 'out_return' && c.points > 0);
                    const auContest = flight.contest.find(c => c.name === 'au' && c.points > 0);
                    const declarationContest = flight.contest.find(c => c.name === 'declaration' && c.points > 0);
                    const freeContest = flight.contest.find(c => c.name === 'free' && c.points > 0);

                    const candidates = [];

                    if (orContest) {
                        candidates.push({ contest: orContest, score: orContest.points });
                    }
                    if (auContest?.score?.declared) {
                        candidates.push({ contest: auContest, score: auContest.points });
                    }
                    if (declarationContest?.score?.declared) {
                        candidates.push({ contest: declarationContest, score: declarationContest.points });
                    }
                    if (!declaredOnly && freeContest && candidates.length === 0) {
                        candidates.push({ contest: freeContest, score: freeContest.points });
                    }

                    // Use the highest scoring contest
                    const bestCandidate = candidates.reduce((best, current) =>
                        current.score > best.score ? current : best,
                        { score: 0 }
                    );

                    if (bestCandidate.contest) {
                        contestToUse = bestCandidate.contest;
                        scoreToUse = bestCandidate.score;
                    }
                } else {
                    // For other task types (like GL/Goal), only use au/declaration if declared
                    const auContest = flight.contest.find(c => c.name === 'au' && c.points > 0);
                    const declarationContest = flight.contest.find(c => c.name === 'declaration' && c.points > 0);

                    if (auContest?.score?.declared) {
                        contestToUse = auContest;
                        scoreToUse = auContest.points;
                    } else if (declarationContest?.score?.declared) {
                        contestToUse = declarationContest;
                        scoreToUse = declarationContest.points;
                    }
                }

                if (contestToUse && scoreToUse > bestScore) {
                    bestScore = scoreToUse;

                    // Ensure distance and speed are present. Some contests (au/declaration) omit them.
                    // Fall back to task distance or free contest metrics for display only.
                    const freeContestFallback = flight.contest.find(c => c.name === 'free' && c.points > 0);

                    const rawDistance = contestToUse.distance;
                    const rawSpeed = contestToUse.speed;
                    const distance = (typeof rawDistance === 'number') ? rawDistance
                                   : (typeof flight.task?.distance === 'number') ? flight.task.distance
                                   : (typeof freeContestFallback?.distance === 'number') ? freeContestFallback.distance
                                   : 0;
                    const speed = (typeof rawSpeed === 'number') ? rawSpeed
                                : (typeof freeContestFallback?.speed === 'number') ? freeContestFallback.speed
                                : 0;

                    // Derive a sensible task display name if missing (e.g., "1029km Goal")
                    let taskName = flight.task?.name;
                    const taskKind = flight.task?.kind;
                    if ((!taskName || taskName.trim().length === 0) && taskKind) {
                        const kindLabel = taskKind === 'TR' ? 'Triangle'
                                        : taskKind === 'OR' ? 'Out & Return'
                                        : taskKind === 'GL' ? 'Goal'
                                        : null;
                        if (kindLabel && distance > 0) {
                            taskName = String(Math.round(distance)) + 'km ' + kindLabel;
                        } else if (kindLabel) {
                            taskName = kindLabel;
                        }
                    }

                    bestFlight = {
                        id: flight.id,
                        pilot: flight.user?.name,
                        pilotId: flight.user?.id,
                        points: scoreToUse,
                        distance,
                        speed,
                        taskName,
                        taskKind: taskKind,
                        declared: contestToUse.score?.declared || false,
                        contestType: contestToUse.name
                    };

                }
            });

            return bestFlight;
        }

        function calculateBestScoreForFlight(flight) {
            // Reuse the existing calculateBestScore logic
            if (!flight.contest || !Array.isArray(flight.contest)) {
                return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
            }

            const auContest = flight.contest.find(contest => contest.name === 'au' && contest.points > 0);
            const declarationContest = flight.contest.find(contest => contest.name === 'declaration' && contest.points > 0);
            const freeContest = flight.contest.find(contest => contest.name === 'free' && contest.points > 0);

            let bestContest = null;
            let bestScore = 0;

            const isAuDeclared = auContest?.score?.declared === true;
            const isDeclarationDeclared = declarationContest?.score?.declared === true;

            if (freeContest) {
                bestContest = freeContest;
                bestScore = freeContest.points;
            }

            if (auContest && isAuDeclared && auContest.points > bestScore) {
                bestContest = auContest;
                bestScore = auContest.points;
            }

            if (declarationContest && isDeclarationDeclared && declarationContest.points > bestScore) {
                bestContest = declarationContest;
                bestScore = declarationContest.points;
            }

            if (bestContest) {
                const isDeclaredTask = (bestContest.name === 'au' && isAuDeclared) ||
                                      (bestContest.name === 'declaration' && isDeclarationDeclared);

                return {
                    score: bestScore,
                    distance: bestContest.distance || 0,
                    speed: bestContest.speed || 0,
                    contestType: bestContest.name || 'unknown',
                    declared: isDeclaredTask
                };
            }

            return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
        }

        function formatTrophyWinner(trophy, type) {
            if (!trophy || (!trophy.combined && !trophy.free)) {
                return '<p class="no-winner">No eligible winner found</p>';
            }

            let html = '';

            if (trophy.combined) {
                const score = trophy.combined.totalPoints || trophy.combined.points || 0;
                html += \`
                    <div class="winner combined-winner">
                        <strong>Combined Scoring:</strong>
                        <a href="https://www.weglide.org/user/\${trophy.combined.pilotId}" target="_blank" class="pilot-link">
                            \${trophy.combined.pilot}
                        </a>
                        <span class="trophy-score">\${score.toFixed(1)} pts</span>
                        \${type === 'flight' && trophy.combined.id ?
                            \`<a href="https://www.weglide.org/flight/\${trophy.combined.id}" target="_blank" class="flight-link">View Flight →</a>\` : ''}
                    </div>
                \`;
            }

            if (trophy.free && !trophy.sameWinner) {
                const score = trophy.free.totalPoints || trophy.free.points || 0;
                html += \`
                    <div class="winner free-winner">
                        <strong>Free Scoring:</strong>
                        <a href="https://www.weglide.org/user/\${trophy.free.pilotId}" target="_blank" class="pilot-link">
                            \${trophy.free.pilot}
                        </a>
                        <span class="trophy-score">\${score.toFixed(1)} pts</span>
                        \${type === 'flight' && trophy.free.id ?
                            \`<a href="https://www.weglide.org/flight/\${trophy.free.id}" target="_blank" class="flight-link">View Flight →</a>\` : ''}
                    </div>
                \`;
            }

            return html;
        }

        function formatSingleFlightWinner(flight) {
            if (!flight) {
                return '<p class="no-winner">No eligible flights found</p>';
            }


            // Format distance and speed for display - same logic as main leaderboard
            const distanceText = flight.distance ? \`\${flight.distance.toFixed(1)} km\` : '';
            const speedText = flight.speed ? \`\${flight.speed.toFixed(1)} km/h\` : '';
            const taskDisplay = flight.taskName ||
                (distanceText && speedText ? \`\${distanceText} at \${speedText}\` :
                 distanceText ? distanceText :
                 speedText ? speedText : 'Unnamed Task');

            return \`
                <div class="winner flight-winner">
                    <a href="https://www.weglide.org/user/\${flight.pilotId}" target="_blank" class="pilot-link">
                        <strong>\${flight.pilot}</strong>
                    </a>
                    <div class="flight-details">
                        <span class="trophy-score">\${flight.points.toFixed(1)} pts</span>
                        <span class="task-name">\${taskDisplay}</span>
                    </div>
                    <a href="https://www.weglide.org/flight/\${flight.id}" target="_blank" class="flight-link">View Flight →</a>
                </div>
            \`;
        }

        function displayTrophyWinners(trophies) {
            const container = document.getElementById('trophyWinners');

            let html = '<div class="trophy-grid">';

            // Canadair Trophy
            html += \`
                <div class="trophy-item">
                    <h4>🏆 Canadair Trophy</h4>
                    <p class="trophy-desc">Overall Champion (Top 5 flights)</p>
                    \${formatTrophyWinner(trophies.canadair, 'leaderboard')}
                    <p class="calculation-note">\${trophies.canadair.explanation}</p>
                </div>
            \`;

            // 200 Trophy
            html += \`
                <div class="trophy-item">
                    <h4>🏆 200 Trophy</h4>
                    <p class="trophy-desc">Under 200 Hours Champion</p>
                    \${formatTrophyWinner(trophies.trophy200, 'leaderboard')}
                    <p class="calculation-note">\${trophies.trophy200.explanation}</p>
                </div>
            \`;

            // BAIC Trophy
            html += \`
                <div class="trophy-item">
                    <h4>🏆 BAIC Trophy</h4>
                    <p class="trophy-desc">Single Best Flight</p>
                    \${formatTrophyWinner(trophies.baic, 'flight')}
                    <p class="calculation-note">\${trophies.baic.explanation}</p>
                </div>
            \`;

            // Dow Trophy - Triangle
            html += \`
                <div class="trophy-item">
                    <h4>🏆 Dow Trophy - Triangle</h4>
                    <p class="trophy-desc">Best Triangle Flight</p>
                    \${formatSingleFlightWinner(trophies.dow.triangle)}
                </div>
            \`;

            // Dow Trophy - Out & Return
            html += \`
                <div class="trophy-item">
                    <h4>🏆 Dow Trophy - Out & Return</h4>
                    <p class="trophy-desc">Best Out & Return Flight</p>
                    \${formatSingleFlightWinner(trophies.dow.outReturn)}
                </div>
            \`;

            // Dow Trophy - Goal
            html += \`
                <div class="trophy-item">
                    <h4>🏆 Dow Trophy - Goal</h4>
                    <p class="trophy-desc">Best Goal Flight (Declared Tasks Only)</p>
                    \${formatSingleFlightWinner(trophies.dow.goal)}
                </div>
            \`;

            html += '</div>';

            container.innerHTML = html;
        }

        function toggleTrophySection() {
            const content = document.getElementById('trophyContent');
            const arrow = document.getElementById('trophyArrow');

            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.textContent = '▼';
            } else {
                content.style.display = 'none';
                arrow.textContent = '▶';
            }
        }

        function toggleTaskStatsSection() {
            const content = document.getElementById('taskStatsContent');
            const arrow = document.getElementById('taskStatsArrow');

            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.textContent = '▼';
            } else {
                content.style.display = 'none';
                arrow.textContent = '▶';
            }
        }

        function calculateTaskTypeStats() {
            const taskStats = {};
            const taskDescriptions = {
                'FR4': { name: 'FR4', desc: 'Start, 2-3 TP, Finish' },
                'Triangle': { name: 'Triangle', desc: 'FAI Triangle' },
                'TR': { name: 'Triangle', desc: 'FAI Triangle' },
                'OR': { name: 'Out & Return', desc: 'Out & Return' },
                'GL': { name: 'Goal', desc: 'Goal Flight' },
                'RT': { name: 'Rectangle', desc: 'Rectangle' },
                'MTR': { name: 'MTR', desc: 'Multi-Lap Triangle/Rectangle' },
                'SP': { name: 'Speed', desc: 'Speed Task' },
                'OL': { name: 'Optimized', desc: 'Optimized Task' },
                'FR': { name: 'Free', desc: 'Start, 4+ TP, Finish' },
                'unknown': { name: 'Other', desc: 'Unknown Task Type' }
            };

            // Count all task types from full flight data
            fullFlightData.forEach(flight => {
                if (!flight.task) return;

                const taskType = flight.task.kind || 'unknown';
                const isFinished = flight.contest && flight.contest.some(c =>
                    (c.name === 'au' || c.name === 'declaration') && c.score && c.score.declared
                );
                const isIgcTask = flight.task.from_igcfile === true;

                if (!taskStats[taskType]) {
                    taskStats[taskType] = {
                        count: 0,
                        finished: 0,
                        igcCount: 0,
                        weglideCount: 0,
                        igcFinished: 0,
                        weglideFinished: 0
                    };
                }

                taskStats[taskType].count++;
                if (isFinished) taskStats[taskType].finished++;
                if (isIgcTask) {
                    taskStats[taskType].igcCount++;
                    if (isFinished) taskStats[taskType].igcFinished++;
                } else {
                    taskStats[taskType].weglideCount++;
                    if (isFinished) taskStats[taskType].weglideFinished++;
                }
            });

            // Generate HTML for table rows
            let tableHtml = '';
            Object.entries(taskStats)
                .sort(([,a], [,b]) => b.count - a.count) // Sort by count descending
                .forEach(([taskType, stats]) => {
                    const taskInfo = taskDescriptions[taskType] || { name: taskType, desc: 'Unknown' };
                    const igcCompletionRate = stats.igcCount > 0 ? Math.round((stats.igcFinished / stats.igcCount) * 100) : 0;
                    const weglideCompletionRate = stats.weglideCount > 0 ? Math.round((stats.weglideFinished / stats.weglideCount) * 100) : 0;

                    tableHtml += \`
                        <tr>
                            <td class="task-code">\${taskType}</td>
                            <td class="task-description">\${taskInfo.desc}</td>
                            <td class="task-count">\${stats.count}</td>
                            <td class="task-finished">\${stats.finished}</td>
                            <td class="task-igc">\${stats.igcCount}</td>
                            <td class="task-igc-completed">\${stats.igcFinished} (\${igcCompletionRate}%)</td>
                            <td class="task-weglide">\${stats.weglideCount}</td>
                            <td class="task-weglide-completed">\${stats.weglideFinished} (\${weglideCompletionRate}%)</td>
                        </tr>
                    \`;
                });

            // Update the display
            document.getElementById('taskStatsTableBody').innerHTML = tableHtml;
        }

        document.addEventListener('DOMContentLoaded', async function() {
            await loadLeaderboard();
            calculateTrophyWinners();
            calculateTaskTypeStats();

            document.getElementById('combinedBtn').addEventListener('click', () => switchScoringMode('mixed'));
            document.getElementById('freeBtn').addEventListener('click', () => switchScoringMode('free'));
            document.getElementById('silverCGullBtn').addEventListener('click', () => switchScoringMode('silverCGull'));
            const underBtn = document.getElementById('under200Btn');
            if (underBtn) {
                underBtn.addEventListener('click', () => {
                    under200Enabled = !under200Enabled;
                    underBtn.classList.toggle('active', under200Enabled);
                    updateUnder200ButtonLabel();
                    buildLeaderboard();
                    // No need to recalculate trophies - 200 Trophy is always <200 list
                });
                updateUnder200ButtonLabel();
            }
        });
        </script>`
        .replace('__PILOT_DURATIONS_PLACEHOLDER__', JSON.stringify(pilotDurationsEmbedded));

        australianHTML = australianHTML.substring(0, scriptStart) +
                        newScriptContent +
                        australianHTML.substring(scriptEnd);

        // Inject embedded pilot durations JSON into the script
        australianHTML = australianHTML.replace('__PILOT_DURATIONS_PLACEHOLDER__', JSON.stringify(pilotDurationsEmbedded));

        // Remove Canadian-specific under-table filter bar to avoid duplicate buttons
        australianHTML = australianHTML.replace(/<div class="scoring-toggle" id="filtersBar"[\s\S]*?<\/div>\s*/g, '');

        // Add scoring toggle buttons and trophy section after the stats section
        australianHTML = australianHTML.replace(
            /(<div class="stats">.*?<\/div>\s*)<\/div>/s,
            '$1</div><div class="scoring-toggle"><button class="toggle-btn active" id="combinedBtn">Combined Scoring</button><button class="toggle-btn" id="freeBtn">Free Only</button><button class="toggle-btn" id="under200Btn">< 200 hrs PIC</button></div><div class="trophy-section"><div class="trophy-header" onclick="toggleTrophySection()"><h3>🏆 Trophy Standings (YTD - unofficial) <span class="toggle-arrow" id="trophyArrow">▼</span></h3></div><div class="trophy-content" id="trophyContent"><div id="trophyWinners">Loading trophy winners...</div><div class="silver-cgull-section"><button class="toggle-btn" id="silverCGullBtn">Silver C-Gull Candidates</button></div></div></div><div class="task-stats-section"><div class="task-stats-header" onclick="toggleTaskStatsSection()"><h5>📊 Task Type Statistics <span class="toggle-arrow" id="taskStatsArrow">▶</span></h5></div><div class="task-stats-content" id="taskStatsContent" style="display: none;"><table class="task-stats-table"><thead><tr><th>Task Type</th><th>Description</th><th>Total</th><th>Finished</th><th>IGC Task</th><th>IGC Completed</th><th>WeGlide Task</th><th>WeGlide Completed</th></tr></thead><tbody id="taskStatsTableBody"></tbody></table></div></div>'
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
            background: rgba(76, 175, 80, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(76, 175, 80, 1);
        }

        .flight-type.declared-incomplete {
            background: rgba(255, 152, 0, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(255, 152, 0, 1);
        }

        .flight-type.free {
            background: rgba(158, 158, 158, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(158, 158, 158, 1);
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
        }

        /* Trophy section styling */
        .trophy-section {
            margin: 20px auto;
            max-width: 1200px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            overflow: hidden;
        }

        .trophy-header {
            background: rgba(255,255,255,0.1);
            padding: 15px 20px;
            cursor: pointer;
            user-select: none;
            transition: background 0.3s ease;
        }

        .trophy-header:hover {
            background: rgba(255,255,255,0.15);
        }

        .trophy-header h3 {
            margin: 0;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .toggle-arrow {
            transition: transform 0.3s ease;
            font-size: 0.8em;
        }

        .trophy-content {
            padding: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }

        .silver-cgull-section {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #444;
            text-align: center;
        }

        .trophy-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
        }

        .trophy-item {
            background: rgba(255,255,255,0.08);
            border-radius: 6px;
            padding: 15px;
            border-left: 4px solid #ffd700;
        }

        .trophy-item h4 {
            margin: 0 0 8px 0;
            color: #ffd700;
            font-size: 1.1em;
        }

        .trophy-desc {
            color: #ccc;
            font-size: 0.9em;
            margin: 0 0 12px 0;
            font-style: italic;
        }

        .winner {
            margin: 8px 0;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .winner:last-child {
            border-bottom: none;
        }

        .winner strong {
            color: white;
            margin-right: 8px;
        }

        .trophy-score {
            color: #4CAF50;
            font-weight: bold;
            margin-left: 8px;
        }

        .flight-details {
            margin: 4px 0;
            font-size: 0.9em;
        }

        .flight-details .task-badge {
            margin-right: 12px;
            color: white;
        }

        .flight-details span {
            margin-right: 12px;
        }

        .flight-distance {
            color: #64b5f6 !important;
        }

        .flight-speed {
            color: #ff9800 !important;
        }

        .task-name {
            color: #9c27b0 !important;
            font-style: italic;
        }

        .flight-link {
            color: #64b5f6;
            text-decoration: none;
            font-size: 0.85em;
            margin-left: 8px;
        }

        .flight-link:hover {
            text-decoration: underline;
        }

        .calculation-note {
            color: #888;
            font-size: 0.8em;
            margin: 8px 0 0 0;
            font-style: italic;
        }

        .no-winner {
            color: #888;
            font-style: italic;
            margin: 8px 0;
        }

        .combined-winner {
            border-left: 3px solid #4CAF50;
            padding-left: 8px;
        }

        .free-winner {
            border-left: 3px solid #2196F3;
            padding-left: 8px;
        }

        .flight-winner {
            border-left: 3px solid #ffd700;
            padding-left: 8px;
        }

        /* Mobile responsive */
        @media (max-width: 768px) {
            .trophy-grid {
                grid-template-columns: 1fr;
                gap: 15px;
            }

            .trophy-item {
                padding: 12px;
            }

            .trophy-header {
                padding: 12px 15px;
            }

            .trophy-content {
                padding: 15px;
            }
        }

        /* Task stats section styling */
        .task-stats-section {
            margin: 10px auto;
            max-width: 800px;
            background: rgba(255,255,255,0.95);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px;
            overflow: hidden;
            font-size: 0.85em;
        }

        .task-stats-header {
            background: rgba(255,255,255,0.1);
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .task-stats-header:hover {
            background: rgba(255,255,255,0.15);
        }

        .task-stats-header h5 {
            margin: 0;
            font-size: 0.9em;
            color: #2c3e50;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 500;
        }

        .task-stats-content {
            padding: 10px 12px;
            background: rgba(255,255,255,0.98);
        }

        .task-stats-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8em;
        }

        .task-stats-table th {
            background: #f8f9fa;
            padding: 6px 8px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
            font-weight: 600;
            color: #495057;
        }

        .task-stats-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f1f3f4;
            color: #333;
        }

        .task-stats-table .task-code {
            font-family: monospace;
            font-weight: bold;
            color: #0056b3;
        }

        .task-stats-table .task-count {
            text-align: center;
            font-weight: 600;
        }

        .task-stats-table .task-finished {
            text-align: center;
            font-weight: 600;
            color: #28a745;
        }

        .task-stats-table .task-igc {
            text-align: center;
            font-weight: 600;
            color: #6c757d;
        }

        .task-stats-table .task-weglide {
            text-align: center;
            font-weight: 600;
            color: #007bff;
        }

        .task-description {
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
