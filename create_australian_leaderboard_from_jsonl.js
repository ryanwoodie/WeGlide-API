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

function calculateContestScore(flight, contestName) {
    if (!flight?.contest || !Array.isArray(flight.contest)) {
        return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
    }

    const contest = flight.contest.find(c => c && c.name === contestName && typeof c.points === 'number' && c.points > 0);
    if (!contest) {
        return { score: 0, distance: 0, speed: 0, contestType: 'none', declared: false };
    }

    const distance = typeof contest.distance === 'number' ? contest.distance
        : typeof contest?.score?.distance === 'number' ? contest.score.distance
        : (typeof flight.distance === 'number' ? flight.distance : 0);
    const speed = typeof contest.speed === 'number' ? contest.speed
        : typeof contest?.score?.speed === 'number' ? contest.score.speed
        : 0;
    const declared = contest?.score?.declared === true;

    return {
        score: contest.points,
        distance,
        speed,
        contestType: contest.name,
        declared
    };
}

const TASK_KIND_LABELS = {
    FR4: 'Start, 2-3 Turnpoints, Finish',
    Triangle: 'FAI Triangle',
    TR: 'FAI Triangle',
    OR: 'Out & Return',
    GL: 'Goal Flight',
    RT: 'Rectangle',
    MTR: 'Multi-Lap Triangle/Rectangle',
    SP: 'Speed Task',
    OL: 'Optimized Task',
    FR: 'Free Task',
    unknown: 'Other Task'
};

function getDMSTShapeBonus(kind) {
    if (!kind) return 0;
    const normalized = String(kind).toUpperCase();
    switch (normalized) {
        case 'TR':
        case 'TRIANGLE':
        case 'DECLARATION':
            return 0.40; // FAI Triangle
        case 'OR':
        case 'OUT_RETURN':
            return 0.30; // Out & Return
        case 'GL':
        case 'OUT':
        case 'GOAL':
            return 0.30; // Straight Out / Goal
        case 'RT':
        case 'RECTANGLE':
            return 0.40; // Rectangle bonus
        case 'MTR':
            return 0.20; // Multi-lap triangle/rectangle
        case 'SP':
        case 'SPEED':
        case 'FR':
        case 'FR4':
            return 0.0; // No bonus
        default:
            return 0.0;
    }
}

async function processAustralianFlights() {
    console.log('🇦🇺 Processing Australian flights from JSONL...');

    const pilotFlightsMixed = {};  // Mixed scoring (AU/Free)
    const pilotFlightsFree = {};   // Free-only scoring
    const pilotFlightsSprint = {}; // Sprint contest scoring
    const pilotFlightsTriangle = {}; // Triangle contest scoring
    const pilotFlightsOutReturn = {}; // Out & Return contest scoring
    const pilotFlightsOut = {}; // Straight out (goal) contest scoring
    let totalProcessed = 0;
    let australianCount = 0;
    let australianFlights = []; // Store all flight data for detailed tooltips
    let allFlightData = []; // Store all original flight data for statistics
    let seasonStartDate = null;
    let seasonEndDate = null;

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

                    // Track season date range
                    if (flight.scoring_date) {
                        const scoringDate = new Date(flight.scoring_date + 'T00:00:00Z');
                        if (!Number.isNaN(scoringDate.getTime())) {
                            if (!seasonStartDate || scoringDate < seasonStartDate) {
                                seasonStartDate = scoringDate;
                            }
                            if (!seasonEndDate || scoringDate > seasonEndDate) {
                                seasonEndDate = scoringDate;
                            }
                        }
                    }

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
                    if (!pilotFlightsSprint[pilotName]) {
                        pilotFlightsSprint[pilotName] = [];
                    }
                    if (!pilotFlightsTriangle[pilotName]) {
                        pilotFlightsTriangle[pilotName] = [];
                    }
                    if (!pilotFlightsOutReturn[pilotName]) {
                        pilotFlightsOutReturn[pilotName] = [];
                    }
                    if (!pilotFlightsOut[pilotName]) {
                        pilotFlightsOut[pilotName] = [];
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

                    const sprintScoringData = calculateContestScore(flight, 'sprint');
                    if (sprintScoringData.score > 0) {
                        pilotFlightsSprint[pilotName].push({
                            id: flight.id,
                            userId: flight.user?.id,
                            date: flight.scoring_date,
                            distance: sprintScoringData.distance,
                            speed: sprintScoringData.speed,
                            points: sprintScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: sprintScoringData.declared,
                            contestType: sprintScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    const triangleScoringData = calculateContestScore(flight, 'triangle');
                    if (triangleScoringData.score > 0) {
                        pilotFlightsTriangle[pilotName].push({
                            id: flight.id,
                            userId: flight.user?.id,
                            date: flight.scoring_date,
                            distance: triangleScoringData.distance,
                            speed: triangleScoringData.speed,
                            points: triangleScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: triangleScoringData.declared,
                            contestType: triangleScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    const outReturnScoringData = calculateContestScore(flight, 'out_return');
                    if (outReturnScoringData.score > 0) {
                        pilotFlightsOutReturn[pilotName].push({
                            id: flight.id,
                            userId: flight.user?.id,
                            date: flight.scoring_date,
                            distance: outReturnScoringData.distance,
                            speed: outReturnScoringData.speed,
                            points: outReturnScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: outReturnScoringData.declared,
                            contestType: outReturnScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    const outScoringData = calculateContestScore(flight, 'out');
                    if (outScoringData.score > 0) {
                        pilotFlightsOut[pilotName].push({
                            id: flight.id,
                            userId: flight.user?.id,
                            date: flight.scoring_date,
                            distance: outScoringData.distance,
                            speed: outScoringData.speed,
                            points: outScoringData.score,
                            takeoff: flight.takeoff_airport?.name || '',
                            region: flight.takeoff_airport?.region || '',
                            declared: outScoringData.declared,
                            contestType: outScoringData.contestType,
                            aircraftKind: flight.aircraft?.kind || 'unknown',
                            aircraftName: flight.aircraft?.name || '',
                            dmstIndex: flight.dmst_index || null
                        });
                    }

                    // Store comprehensive flight stats for tooltip use if it has scoring data
                    if (mixedScoringData.score > 0 || freeScoringData.score > 0) {
                        // Get stats from both contest types
                        const auContest = flight.contest?.find(c => c.name === 'au' && c.points > 0);
                        const declarationContest = flight.contest?.find(c => c.name === 'declaration' && c.points > 0);
                        const freeContest = flight.contest?.find(c => c.name === 'free' && c.points > 0);
                        const taskAchieved = flight.task_achieved === true;

                        if (freeContest || auContest) {
                            const flightStats = {
                                id: flight.id,
                                taskAchieved: taskAchieved,
                                hasTask: !!flight.task, // Track if a task was declared
                                bestContestType: mixedScoringData.contestType || 'free',
                                // Store both free and task stats for dynamic switching
                                freeStats: null,
                                taskStats: null,
                                taskInfo: null
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

                            const hasDeclaredTask = !!flight.task;
                            const taskKind = flight.task?.kind || null;
                            const normalizedTaskKind = taskKind ? taskKind.toUpperCase() : null;
                            const taskTypeLabel = taskKind ? (TASK_KIND_LABELS[taskKind]
                                || (normalizedTaskKind ? TASK_KIND_LABELS[normalizedTaskKind] : undefined)
                                || taskKind) : 'No task declared';
                            const taskDistance = typeof flight.task?.distance === 'number'
                                ? flight.task.distance
                                : (typeof auContest?.distance === 'number' ? auContest.distance
                                    : (typeof declarationContest?.distance === 'number' ? declarationContest.distance : null));

                            const taskContestUsed = (mixedScoringData.contestType === 'au' || mixedScoringData.contestType === 'declaration')
                                ? mixedScoringData.contestType
                                : (auContest ? 'au' : declarationContest ? 'declaration' : null);

                            const taskContestPoints = taskContestUsed === 'au'
                                ? auContest?.points
                                : taskContestUsed === 'declaration'
                                    ? declarationContest?.points
                                    : null;

                            const dmstIndex = typeof flight.dmst_index === 'number' && flight.dmst_index > 0
                                ? flight.dmst_index
                                : null;
                            const dmstIndexFactor = dmstIndex ? (dmstIndex / 100) : 1;
                            const auScoreName = auContest?.score?.name || null;
                            const dmstFreeDistanceRaw = typeof auContest?.score?.distance === 'number'
                                ? auContest.score.distance
                                : (typeof auContest?.distance === 'number'
                                    ? auContest.distance
                                    : (typeof freeContest?.score?.distance === 'number'
                                        ? freeContest.score.distance
                                        : (typeof freeContest?.distance === 'number'
                                            ? freeContest.distance
                                            : null)));
                            const dmstFreeDistance = Number.isFinite(dmstFreeDistanceRaw) ? dmstFreeDistanceRaw : null;
                            const freeShapeBonus = getDMSTShapeBonus(auScoreName || taskKind);
                            const dmstFreePointsCalc = Number.isFinite(dmstFreeDistance) && dmstIndexFactor
                                ? (dmstFreeDistance * (1 + freeShapeBonus)) / dmstIndexFactor
                                : null;

                            const taskDistanceForCalc = typeof flight.task?.distance === 'number'
                                ? flight.task.distance
                                : dmstFreeDistance;
                            const taskShapeBonus = getDMSTShapeBonus(taskKind || auScoreName);
                            const declarationBonus = hasDeclaredTask ? 0.30 : 0;
                            const taskMultiplierActual = 1 + taskShapeBonus + (taskAchieved ? declarationBonus : 0);
                            const taskMultiplierPotential = 1 + taskShapeBonus + declarationBonus;
                            const dmstTaskActualPoints = taskDistanceForCalc && dmstIndexFactor
                                ? (taskDistanceForCalc * taskMultiplierActual) / dmstIndexFactor
                                : null;
                            const dmstTaskPotentialPoints = taskDistanceForCalc && dmstIndexFactor
                                ? (taskDistanceForCalc * taskMultiplierPotential) / dmstIndexFactor
                                : null;

                            flightStats.taskInfo = {
                                hasTask: !!flight.task,
                                distanceKm: typeof taskDistance === 'number' ? taskDistance : null,
                                type: taskKind,
                                typeLabel: taskTypeLabel,
                                completed: taskAchieved,
                                taskContestUsed,
                                taskContestLabel: (() => {
                                    if (!taskContestUsed) return 'Task Score';
                                    if (taskContestUsed === 'declaration') return 'WeGlide/DMSt Task Score';
                                    if (taskContestUsed === 'au') {
                                        if (!taskAchieved) {
                                            return 'WeGlide/DMSt Task Score (not finished)';
                                        }
                                        if (auContest?.score?.declared === false) {
                                            return 'DMSt Free > Task';
                                        }
                                        return 'WeGlide/DMSt Task Score';
                                    }
                                    return 'Task Score';
                                })(),
                                taskContestPoints: typeof taskContestPoints === 'number' ? taskContestPoints : null,
                                freePoints: typeof freeContest?.points === 'number' ? freeContest.points : null,
                                auPoints: typeof auContest?.points === 'number' ? auContest.points : null,
                                declarationPoints: typeof declarationContest?.points === 'number' ? declarationContest.points : null,
                                bestContestType: mixedScoringData.contestType || 'free',
                                dmstFreePoints: dmstFreePointsCalc,
                                dmstFreeDistance: dmstFreeDistance,
                                dmstTaskActualPoints: dmstTaskActualPoints,
                                dmstTaskPotentialPoints: dmstTaskPotentialPoints,
                                dmstTaskDistance: typeof taskDistanceForCalc === 'number' && Number.isFinite(taskDistanceForCalc)
                                    ? taskDistanceForCalc
                                    : (Number.isFinite(dmstFreeDistance) ? dmstFreeDistance : null),
                                weglideFreeDistance: (() => {
                                    if (Number.isFinite(freeContest?.score?.distance)) return freeContest.score.distance;
                                    if (Number.isFinite(freeContest?.distance)) return freeContest.distance;
                                    return null;
                                })(),
                                dmstIndex: dmstIndex
                            };

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
        function generateLeaderboard(pilotFlights, maxFlights = 5) {
            const leaderboard = [];

            Object.keys(pilotFlights).forEach(pilotName => {
                const flights = pilotFlights[pilotName];

                // Sort flights by points (descending) and take top N
                const bestFlights = flights
                    .sort((a, b) => b.points - a.points)
                    .slice(0, maxFlights);

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
        const sprintLeaderboard = generateLeaderboard(pilotFlightsSprint, 3);
        const triangleLeaderboard = generateLeaderboard(pilotFlightsTriangle, 3);
        const outReturnLeaderboard = generateLeaderboard(pilotFlightsOutReturn, 3);
        const outLeaderboard = generateLeaderboard(pilotFlightsOut, 3);

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
        const leaderboardsForDetails = [
            mixedLeaderboard,
            freeLeaderboard,
            sprintLeaderboard,
            triangleLeaderboard,
            outReturnLeaderboard,
            outLeaderboard,
            silverCGullLeaderboard
        ];

        leaderboardsForDetails.forEach(board => {
            (board || []).forEach(pilot => {
                (pilot.bestFlights || []).forEach(flight => {
                    if (flight && flight.id != null) {
                        usedFlightIds.add(flight.id);
                    }
                });
                if (pilot.flightId != null) {
                    usedFlightIds.add(pilot.flightId);
                }
            });
        });

        // Filter australianFlights to only include flights used in leaderboards
        australianFlights = australianFlights.filter(flight => usedFlightIds.has(flight.id));
        console.log(`📊 Storing ${australianFlights.length} flight details for tooltips`);

        // Write detailed flight data to separate file to avoid embedding large data
        fs.writeFileSync('australian_flight_details.json', JSON.stringify(australianFlights, null, 2));
        console.log(`💾 Saved detailed flight data to australian_flight_details.json`);

        // Write minimal flight data for task stats to separate file
        const minimalFlightData = allFlightData.map(f => {
            const bestContest = Array.isArray(f.contest) ? f.contest.reduce((best, current) => {
                if (!current || typeof current.points !== 'number') return best;
                if (!best || current.points > (best.points || 0)) {
                    return current;
                }
                return best;
            }, null) : null;

            const primaryDistance = (typeof bestContest?.distance === 'number')
                ? bestContest.distance
                : (typeof f.task?.distance === 'number') ? f.task.distance
                : null;

            const durationSeconds = (typeof f.total_seconds === 'number')
                ? f.total_seconds
                : (typeof bestContest?.score?.duration === 'number') ? bestContest.score.duration
                : null;

            return {
                id: f.id,
                user: f.user ? { id: f.user.id, name: f.user.name } : null,
                date: f.scoring_date || null,
                distance: typeof primaryDistance === 'number' ? primaryDistance : 0,
                duration: typeof durationSeconds === 'number' ? durationSeconds : 0,
                taskDeclared: !!f.task,
                taskCompleted: f.task_achieved === true,
                task: f.task ? {
                    kind: f.task.kind,
                    from_igcfile: f.task.from_igcfile,
                    distance: f.task.distance,
                    laps: f.task.laps,
                    name: f.task.name,
                    type: f.task.type
                } : null,
                task_achieved: f.task_achieved === true,
                contest: f.contest ? f.contest.map(c => ({
                    name: c.name,
                    points: c.points,
                    distance: c.distance,
                    speed: c.speed,
                    score: c.score ? { declared: c.score.declared } : null
                })) : null,
                takeoff_airport: f.takeoff_airport ? { name: f.takeoff_airport.name, region: f.takeoff_airport.region } : null
            };
        });
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

        // Helper: server-side fetch of pilot profile data (no CORS in Node)
        async function fetchUserProfilesServer(pilotIds) {
            const durations = {};
            const profiles = {};
            const chunk = 100;
            for (let i = 0; i < pilotIds.length; i += chunk) {
                const slice = pilotIds.slice(i, i + chunk);
                const url = `https://api.weglide.org/v1/user?id_in=${slice.join(',')}`;
                try {
                    const resp = await fetch(url);
                    if (!resp.ok) continue;
                    const arr = await resp.json();
                    arr.forEach(u => {
                        if (u && typeof u.id === 'number') {
                            // Store duration for backward compatibility
                            if (typeof u.total_flight_duration === 'number') {
                                durations[u.id] = u.total_flight_duration;
                            }
                            // Store full profile data for tooltips
                            profiles[u.id] = {
                                total_flight_duration: u.total_flight_duration || 0,
                                total_free_distance: u.total_free_distance || 0,
                                avg_speed: u.avg_speed || 0,
                                flight_count: u.flight_count || 0,
                                avg_glide_speed: u.avg_glide_speed || 0,
                                avg_glide_detour: u.avg_glide_detour || 0,
                                achievement_count: u.achievement_count || 0,
                                name: u.name || '',
                                gender: u.gender || '',
                                club: u.club || {},
                                home_airport: u.home_airport || {}
                            };
                        }
                    });
                } catch (e) {
                    console.warn('Server-side profile fetch failed for batch:', e.message || e);
                }
            }
            return { durations, profiles };
        }

        // Compute unique pilot IDs and prefetch profile data server-side
        const allPilotIds = Array.from(new Set([...mixedLeaderboard, ...freeLeaderboard].map(p => p.pilotId)));
        let pilotDurationsEmbedded = {};
        let pilotProfilesEmbedded = {};
        try {
            const durationsPath = 'australian_user_durations.json';
            const profilesPath = 'australian_user_profiles.json';
            let loaded = false;

            // Try to load both caches
            if (fs.existsSync(durationsPath) && fs.existsSync(profilesPath)) {
                pilotDurationsEmbedded = JSON.parse(fs.readFileSync(durationsPath, 'utf-8'));
                pilotProfilesEmbedded = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
                if (pilotDurationsEmbedded && Object.keys(pilotDurationsEmbedded).length > 0 &&
                    pilotProfilesEmbedded && Object.keys(pilotProfilesEmbedded).length > 0) {
                    console.log('ℹ️ Loaded cached australian_user_durations.json and profiles');
                    loaded = true;
                } else {
                    console.log('ℹ️ Cache exists but incomplete, refetching data...');
                }
            }

            if (!loaded) {
                console.log('⏬ Fetching pilot profile data from WeGlide...');
                const { durations, profiles } = await fetchUserProfilesServer(allPilotIds);
                pilotDurationsEmbedded = durations;
                pilotProfilesEmbedded = profiles;

                fs.writeFileSync(durationsPath, JSON.stringify(pilotDurationsEmbedded, null, 2));
                fs.writeFileSync(profilesPath, JSON.stringify(pilotProfilesEmbedded, null, 2));
                console.log('💾 Saved pilot durations and profiles to cache files');
            }
        } catch (e) {
            console.warn('⚠️ Could not load/save pilot profile data:', e.message || e);
        }

        // Load pilot verification data
        let pilotVerificationData = { verifications: {} };
        try {
            const verificationPath = 'pilot_pic_hours_verification.json';
            if (fs.existsSync(verificationPath)) {
                pilotVerificationData = JSON.parse(fs.readFileSync(verificationPath, 'utf-8'));
                console.log('ℹ️ Loaded pilot_pic_hours_verification.json');
            } else {
                console.log('ℹ️ No pilot verification data found - will create empty verification system');
            }
        } catch (e) {
            console.warn('⚠️ Could not load pilot_pic_hours_verification.json:', e.message || e);
        }

        // Read the Canadian HTML template
        const canadianHTML = fs.readFileSync('canadian_leaderboard_2025_embedded.html', 'utf-8');

        // Replace Canadian-specific content with Australian content
        let australianHTML = canadianHTML
            .replace(/Canadian Gliding Leaderboard 2025/g, 'Soaring Association of Canada Leaderboard 2025')
            .replace(/🏆 Canadian Gliding Leaderboard 2025/g, '🏆 Soaring Association of Canada Leaderboard 2025')
            .replace(/Soaring Association of Canada/g, 'Soaring Association of Canada')
            // Add Firebase CDN scripts before closing head tag
            .replace('</head>', `
    <!-- Firebase CDN -->
    <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js"></script>
</head>`)
            .replace(/sac_logo\.png/g, 'gfa_logo.png')
            .replace(/Canadian gliding season runs October 1, 2024 to September 30, 2025/g, 'Australian gliding season runs October 1, 2024 to September 30, 2025')
            .replace(/Oct 2024 - Sep 2025/g, 'Oct 2024 - Sep 2025')
            .replace(/Best 5 flights per pilot • Higher of Free or Task scoring/g, 'Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025')
            .replace(/Scoring uses the higher of Free flight or Task \(declared\) scoring for each flight/g, 'Scoring uses the higher of Free flight or WeGlide Task scoring for each flight')
            // Remove the logo image
            .replace(/<img src="[^"]*logo[^"]*"[^>]*>/g, '')
            // Add ID to scoring description for dynamic updates
            .replace(/<p>Best 5 flights per pilot • Higher of WeGlide Task or Free scoring • Oct 2024 - Sep 2025<\/p>/g, '<p id="scoringDescription">Best 5 flights per pilot • Higher of <span class="scoring-tooltip" data-tooltip="task">WeGlide Task</span> or <span class="scoring-tooltip" data-tooltip="free">Free scoring</span> • Oct 2024 - Sep 2025</p>\n                ')
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
        const scriptEnd = australianHTML.lastIndexOf('</script>') + 9;

        // Build script content with embedded durations
        const seasonStartIso = seasonStartDate ? seasonStartDate.toISOString().split('T')[0] : '';
        const seasonEndIso = seasonEndDate ? seasonEndDate.toISOString().split('T')[0] : '';
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const seasonLabel = (seasonStartDate && seasonEndDate)
            ? `${monthNames[seasonStartDate.getUTCMonth()]} ${seasonStartDate.getUTCFullYear()} - ${monthNames[seasonEndDate.getUTCMonth()]} ${seasonEndDate.getUTCFullYear()}`
            : 'Current Season';

        const newScriptContent = `<script>
        // Global variables for leaderboard data
        let mixedLeaderboard = [];
        let freeLeaderboard = [];
        let sprintLeaderboard = [];
        let triangleLeaderboard = [];
        let outReturnLeaderboard = [];
        let outLeaderboard = [];
        let silverCGullLeaderboard = [];
        let fullFlightData = [];
        let detailedFlightData = [];
        let leaderboard = [];
        let currentScoringMode = 'mixed';
        const HOURS_200_SEC = 200 * 3600;
        let under200Enabled = false;
        const IS_TOUCH_DEVICE = (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(hover: none)').matches));
        const SEASON_START = new Date('${seasonStartIso ? seasonStartIso + 'T00:00:00Z' : ''}');
        const SEASON_END = new Date('${seasonEndIso ? seasonEndIso + 'T23:59:59Z' : ''}');
        const SEASON_LABEL = '${seasonLabel}';

        // Tooltip functionality
        const tooltipTexts = {
            task: \`WeGlide Task
For declared tasks only

Formula: (task distance + bonuses) ÷ (index/100)

Bonuses:
Declared and completed +30%, plus one of (if applicable):
• FAI Triangle +40%
• Rectangle +40%
• Out & Return +30%
• Straight Out +30% (if declared)
• FAI/Rectangle with Multi-Laps +20% (if declared)

Max 3 turnpoints (4 for rectangles)
Points only for declared task distance\`,
            free: \`WeGlide Free
1.0 point per km, up to 6 legs

Formula: (distance + bonuses) ÷ (index/100)

Bonuses:
• FAI Triangle +30%
• Out & Return +20%

Distance and bonuses optimized/maximized
for legs/shape flown
No maximum distance bonus\`
        };

        // Pilot tooltip event listeners no longer needed - using inline HTML events like flight tooltips

        function addTooltipListeners() {
            // Remove any existing tooltips
            const existingTooltip = document.getElementById('active-tooltip');
            if (existingTooltip) {
                existingTooltip.remove();
            }

            document.querySelectorAll('.scoring-tooltip').forEach(element => {
                const tooltipType = element.getAttribute('data-tooltip');
                let touchTimeout;

                function showTooltip(e) {
                    // Remove any existing tooltip first
                    const existing = document.getElementById('active-tooltip');
                    if (existing) {
                        existing.remove();
                    }

                    const tooltip = document.createElement('div');
                    tooltip.className = 'custom-tooltip';
                    tooltip.id = 'active-tooltip';

                    // Create tooltip content with close button for mobile
                    tooltip.innerHTML = \`
                        <div class="tooltip-content">
                            \${tooltipTexts[tooltipType]}
                        </div>
                        <button class="tooltip-close" onclick="document.getElementById('active-tooltip').remove()" aria-label="Close tooltip">×</button>
                    \`;

                    document.body.appendChild(tooltip);

                    // Position tooltip responsively
                    positionTooltip(tooltip, element);
                }

                function hideTooltip() {
                    const tooltip = document.getElementById('active-tooltip');
                    if (tooltip && !tooltip.classList.contains('tooltip-touch-active')) {
                        tooltip.remove();
                    }
                }

                // Mouse events for desktop
                element.addEventListener('mouseenter', showTooltip);
                element.addEventListener('mouseleave', hideTooltip);

                // Touch events for mobile
                element.addEventListener('touchstart', function(e) {
                    e.preventDefault(); // Prevent mouse events from firing
                    clearTimeout(touchTimeout);
                    showTooltip(e);

                    // Mark tooltip as touch-active to prevent auto-hide
                    const tooltip = document.getElementById('active-tooltip');
                    if (tooltip) {
                        tooltip.classList.add('tooltip-touch-active');
                    }
                });

                // Close tooltip when tapping elsewhere on mobile
                document.addEventListener('touchstart', function(e) {
                    const tooltip = document.getElementById('active-tooltip');
                    if (tooltip && !tooltip.contains(e.target) && !element.contains(e.target)) {
                        tooltip.remove();
                    }
                });
            });
        }

        function positionTooltip(tooltip, element) {
            const rect = element.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const scrollY = window.scrollY;

            // Default positioning
            let left = rect.left + rect.width / 2;
            let top = rect.bottom + 10 + scrollY;
            let transform = 'translateX(-50%)';

            // Check if tooltip would overflow right edge
            if (left + tooltipRect.width / 2 > viewportWidth - 20) {
                left = viewportWidth - tooltipRect.width - 20;
                transform = 'none';
            }

            // Check if tooltip would overflow left edge
            if (left - tooltipRect.width / 2 < 20) {
                left = 20;
                transform = 'none';
            }

            // Check if tooltip would overflow bottom of viewport
            if (top + tooltipRect.height > viewportHeight + scrollY - 20) {
                // Position above the element instead
                top = rect.top + scrollY - tooltipRect.height - 10;
                tooltip.classList.add('tooltip-above');
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            tooltip.style.transform = transform;
        }
        // Embedded pilot durations (seconds), keyed by pilotId
        const pilotDurations = __PILOT_DURATIONS_PLACEHOLDER__;

        // Embedded pilot profile data, keyed by pilotId
        const pilotProfiles = __PILOT_PROFILES_PLACEHOLDER__;

        // Embedded pilot PIC hours verifications
        const pilotVerifications = __PILOT_VERIFICATIONS_PLACEHOLDER__;

        function isWithinSeason(dateString) {
            if (!dateString) return false;
            const normalized = dateString.includes('T') ? dateString : dateString + 'T00:00:00Z';
            const date = new Date(normalized);
            if (Number.isNaN(date.getTime())) return false;
            if (Number.isNaN(SEASON_START.getTime()) || Number.isNaN(SEASON_END.getTime())) return true;
            return date >= SEASON_START && date <= SEASON_END;
        }

        // Get pilot profile data from embedded data (no API calls needed)
        function getPilotProfile(pilotId) {
            return pilotProfiles[pilotId] || null;
        }

        // Calculate current year stats for a pilot
        function calculateCurrentYearStats(pilotId) {
            let flightCount = 0;
            let totalDistance = 0;
            let totalDuration = 0;
            let tasksDeclared = 0;
            let tasksCompleted = 0;
            let speedSum = 0;
            let speedCount = 0;

            (fullFlightData || []).forEach(flight => {
                if (!flight || !flight.user || flight.user.id != pilotId) return;
                if (!flight.date || !isWithinSeason(flight.date)) return;

                flightCount++;

                if (typeof flight.distance === 'number' && flight.distance > 0) {
                    totalDistance += flight.distance;
                }

                if (typeof flight.duration === 'number' && flight.duration > 0) {
                    totalDuration += flight.duration;
                }

                if (flight.taskDeclared) {
                    tasksDeclared++;
                    if (flight.taskCompleted) {
                        tasksCompleted++;
                    }
                }

                if (
                    typeof flight.distance === 'number' && flight.distance > 0 &&
                    typeof flight.duration === 'number' && flight.duration > 0
                ) {
                    const speed = flight.distance / (flight.duration / 3600);
                    speedSum += speed;
                    speedCount++;
                }
            });

            return {
                flights: flightCount,
                distance: Math.round(totalDistance),
                duration: totalDuration,
                tasksDeclared,
                tasksCompleted,
                averageSpeed: speedCount > 0 ? Math.round(speedSum / speedCount) : 0
            };
        }

        // Format duration from seconds to hours and minutes
        function formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return \`\${hours}h \${minutes}m\`;
        }

        // Create pilot profile tooltip
        function createPilotTooltip(pilotId, pilotName) {
            const profile = getPilotProfile(pilotId);
            const currentYearStats = calculateCurrentYearStats(pilotId);
            const currentYear = new Date().getFullYear();

            let tooltipContent = \`
                <div class="pilot-tooltip" role="dialog" aria-label="\${pilotName} season summary">
                    <button class="pilot-tooltip-close" type="button" onclick="closePilotTooltip(event)" aria-label="Close profile tooltip">×</button>
                    <div class="pilot-tooltip-header">
                        <h4>\${pilotName}</h4>
                        <a href="https://www.weglide.org/user/\${pilotId}" target="_blank" class="weglide-profile-link">View Full Profile →</a>
                    </div>
            \`;

            // WeGlide lifetime stats
            if (profile) {
                tooltipContent += \`
                    <div class="pilot-stats-section">
                        <h5>📈 Lifetime Stats (WeGlide)</h5>
                        <div class="pilot-stats-grid">
                            <div class="pilot-stat">
                                <span class="stat-label">Airtime</span>
                                <span class="stat-value">\${formatDuration(profile.total_flight_duration || 0)}</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Distance</span>
                                <span class="stat-value">\${Math.round(profile.total_free_distance || 0).toLocaleString()} km</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Flights</span>
                                <span class="stat-value">\${(profile.flight_count || 0).toLocaleString()}</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Achievements</span>
                                <span class="stat-value">\${(profile.achievement_count || 0).toLocaleString()}</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Ø Speed</span>
                                <span class="stat-value">\${Math.round(profile.avg_speed || 0)} kph</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Ø Glide Speed</span>
                                <span class="stat-value">\${Math.round(profile.avg_glide_speed || 0)} kph</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Ø Detour</span>
                                <span class="stat-value">\${(profile.avg_glide_detour || 0).toFixed(2)}</span>
                            </div>
                            <div class="pilot-stat">
                                <span class="stat-label">Home Base</span>
                                <span class="stat-value">\${profile.home_airport?.name || 'Unknown'}</span>
                            </div>
                        </div>
                    </div>
                \`;
            }

            // Current year stats from flight data
            tooltipContent += \`
                <div class="pilot-stats-section">
                    <h5>🗓️ \${SEASON_LABEL} Stats (Australian Leaderboard)</h5>
                    <div class="pilot-stats-grid">
                        <div class="pilot-stat">
                            <span class="stat-label">Flights</span>
                            <span class="stat-value">\${currentYearStats.flights}</span>
                        </div>
                        <div class="pilot-stat">
                            <span class="stat-label">Distance</span>
                            <span class="stat-value">\${currentYearStats.distance.toLocaleString()} km</span>
                        </div>
                        <div class="pilot-stat">
                            <span class="stat-label">Airtime</span>
                            <span class="stat-value">\${formatDuration(currentYearStats.duration)}</span>
                        </div>
                        <div class="pilot-stat">
                            <span class="stat-label">Tasks Declared</span>
                            <span class="stat-value">\${currentYearStats.tasksDeclared}</span>
                        </div>
                        <div class="pilot-stat">
                            <span class="stat-label">Tasks Completed</span>
                            <span class="stat-value">\${currentYearStats.tasksCompleted}</span>
                        </div>
                        <div class="pilot-stat">
                            <span class="stat-label">Avg Speed</span>
                            <span class="stat-value">\${currentYearStats.averageSpeed} kph</span>
                        </div>
                    </div>
                </div>
            </div>
            \`;

            return tooltipContent;
        }

        // Embedded aircraft awards data
        const aircraftAwards = ${JSON.stringify(aircraftAwards)};

        // Durations embedded at build time; no client-side fetch required

        function applyUnder200Filter(list) {
            if (!under200Enabled) return list;
            // Don't apply 200-hour filter to Silver C-Gull candidates (they have age-based eligibility)
            if (list === silverCGullLeaderboard) return list;
            return list.filter(p => (typeof pilotDurations[p.pilotId] === 'number') && pilotDurations[p.pilotId] < HOURS_200_SEC);
        }

        async function loadLeaderboard() {
            try {
                // Embedded leaderboard data
                mixedLeaderboard = ${JSON.stringify(mixedLeaderboard)};
                freeLeaderboard = ${JSON.stringify(freeLeaderboard)};
                sprintLeaderboard = ${JSON.stringify(sprintLeaderboard)};
                triangleLeaderboard = ${JSON.stringify(triangleLeaderboard)};
                outReturnLeaderboard = ${JSON.stringify(outReturnLeaderboard)};
                outLeaderboard = ${JSON.stringify(outLeaderboard)};
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
                currentScoringMode = 'mixed';

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

                // Build leaderboard table using shared renderer
                buildLeaderboard();

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
                <td class="flight-cell" onmouseover="showFlightPreview(\${flight.id}, event)" onmouseout="hideFlightPreview(event)">
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
            currentScoringMode = mode;

            const updateStatsFromLeaderboard = (list) => {
                if (!Array.isArray(list)) return;
                const pilotCount = list.length;
                const flightCount = list.reduce((sum, pilot) => sum + (Array.isArray(pilot.bestFlights) ? pilot.bestFlights.length : 0), 0);
                const totalDistance = Math.round(list.reduce((sum, pilot) => sum + (pilot.totalDistance || 0), 0));
                document.getElementById('pilotCount').textContent = pilotCount.toLocaleString();
                document.getElementById('flightCount').textContent = flightCount.toLocaleString();
                document.getElementById('totalKms').textContent = totalDistance.toLocaleString();
            };

            if (mode === 'mixed') {
                leaderboard = mixedLeaderboard;
                document.getElementById('scoringDescription').innerHTML = 'Best 5 flights per pilot • Higher of <span class="scoring-tooltip" data-tooltip="task">WeGlide Task</span> or <span class="scoring-tooltip" data-tooltip="free">Free scoring</span> • Oct 2024 - Sep 2025';

                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();

                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'free') {
                leaderboard = freeLeaderboard;
                document.getElementById('scoringDescription').innerHTML = 'Best 5 flights per pilot • <span class="scoring-tooltip" data-tooltip="free">Free scoring</span> only • Oct 2024 - Sep 2025';

                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();

                updateTaskStats('free', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'sprint') {
                leaderboard = sprintLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Top 3 flights per pilot • WeGlide Sprint scoring • Oct 2024 - Sep 2025';
                updateStatsFromLeaderboard(leaderboard);
                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'triangle') {
                leaderboard = triangleLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Top 3 flights per pilot • WeGlide Triangle scoring • Oct 2024 - Sep 2025';
                updateStatsFromLeaderboard(leaderboard);
                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'out_return') {
                leaderboard = outReturnLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Top 3 flights per pilot • WeGlide Out & Return scoring • Oct 2024 - Sep 2025';
                updateStatsFromLeaderboard(leaderboard);
                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'out') {
                leaderboard = outLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Top 3 flights per pilot • WeGlide Out (Goal) scoring • Oct 2024 - Sep 2025';
                updateStatsFromLeaderboard(leaderboard);
                updateTaskStats('mixed', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            } else if (mode === 'silverCGull') {
                leaderboard = silverCGullLeaderboard;
                document.getElementById('scoringDescription').textContent = 'Junior pilots with Silver Badge achievement • Single qualifying flight • Sorted by last name';

                document.getElementById('pilotCount').textContent = leaderboard.length;
                document.getElementById('flightCount').textContent = leaderboard.length;
                const silverKms = leaderboard.reduce((sum, pilot) => {
                    const distance = parseFloat(pilot.distance) || 0;
                    return sum + distance;
                }, 0);
                document.getElementById('totalKms').textContent = Math.round(silverKms).toLocaleString();
            } else {
                leaderboard = freeLeaderboard;
                document.getElementById('scoringDescription').innerHTML = 'Best 5 flights per pilot • <span class="scoring-tooltip" data-tooltip="free">Free scoring</span> only • Oct 2024 - Sep 2025';

                document.getElementById('pilotCount').textContent = ` + totalPilots + `;
                document.getElementById('flightCount').textContent = ` + totalFlights + `;
                document.getElementById('totalKms').textContent = (` + totalKms + `).toLocaleString();

                updateTaskStats('free', {
                    totalPilots: ` + totalPilots + `,
                    totalFlights: ` + totalFlights + `,
                    totalKms: ` + totalKms + `,
                    totalTasksDeclared: ` + totalTasksDeclared + `,
                    totalTasksCompleted: ` + totalTasksCompleted + `,
                    totalTasksHigherThanFree: ` + totalTasksHigherThanFree + `
                });
            }

            document.querySelectorAll('.toggle-btn, .filter-btn').forEach(btn => btn.classList.remove('active'));
            const modeToButton = {
                mixed: 'combinedBtn',
                free: 'freeBtn',
                sprint: 'sprintBtn',
                triangle: 'triangleBtn',
                out_return: 'outReturnBtn',
                out: 'outBtn',
                silverCGull: null
            };
            const activeBtn = Object.prototype.hasOwnProperty.call(modeToButton, mode) ? modeToButton[mode] : null;
            if (activeBtn) {
                const btnElement = document.getElementById(activeBtn);
                if (btnElement) {
                    btnElement.classList.add('active');
                }
            }

            const underBtn = document.getElementById('under200Btn');
            if (underBtn) {
                underBtn.classList.toggle('active', under200Enabled);
                if (typeof updateUnder200ButtonLabel === 'function') updateUnder200ButtonLabel();
            }

            buildLeaderboard();

            if (mode === 'silverCGull') {
                setTimeout(() => {
                    const leaderboardElement = document.getElementById('leaderboardTable');
                    if (leaderboardElement) {
                        leaderboardElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 100);
            }

            setTimeout(() => {
                if (typeof addTooltipListeners === 'function') addTooltipListeners();
            }, 0);
        }

        function toggleFlightColumns(maxFlights) {
            const table = document.getElementById('leaderboardTable');
            if (!table) return;
            table.classList.toggle('three-flight-mode', maxFlights === 3);
        }

        // Flight preview functionality
        let previewTimeout;
        let previewElement;
        let flightHideTimeout;
        let pilotPreviewTimeout;
        let pilotPreviewElement;
        let pilotPreviewHideTimeout;
        let pilotPreviewTrigger;

        function cancelPilotPreviewHide() {
            if (pilotPreviewHideTimeout) {
                clearTimeout(pilotPreviewHideTimeout);
                pilotPreviewHideTimeout = null;
            }
        }

        function removePilotPreview() {
            cancelPilotPreviewHide();
            if (pilotPreviewElement) {
                pilotPreviewElement.remove();
                pilotPreviewElement = null;
            }
            pilotPreviewTrigger = null;
        }

        function showPilotPreview(pilotId, pilotName, triggerElement) {
            if (pilotPreviewTimeout) {
                clearTimeout(pilotPreviewTimeout);
            }

            cancelPilotPreviewHide();
            pilotPreviewTrigger = triggerElement || null;

            pilotPreviewTimeout = setTimeout(() => {
                pilotPreviewTimeout = null;
                if (pilotPreviewElement) {
                    pilotPreviewElement.remove();
                    pilotPreviewElement = null;
                }

                const tooltipContent = createPilotTooltip(pilotId, pilotName);
                pilotPreviewElement = document.createElement('div');
                pilotPreviewElement.className = 'flight-preview';
                pilotPreviewElement.id = 'pilot-preview';
                pilotPreviewElement.innerHTML = tooltipContent;
                pilotPreviewElement.style.pointerEvents = 'auto';
                pilotPreviewElement.style.zIndex = '10000';
                pilotPreviewElement.style.opacity = '0';
                pilotPreviewElement.dataset.pilotId = String(pilotId);

                document.body.appendChild(pilotPreviewElement);

                pilotPreviewElement.addEventListener('mouseenter', cancelPilotPreviewHide);
                pilotPreviewElement.addEventListener('mouseleave', () => hidePilotPreview(null));

                pilotPreviewElement.style.left = '50%';
                pilotPreviewElement.style.top = '50%';
                pilotPreviewElement.style.transform = 'translate(-50%, -50%)';

                requestAnimationFrame(() => {
                    if (pilotPreviewElement) {
                        pilotPreviewElement.style.opacity = '1';
                    }
                });
            }, 250);
        }

        function hidePilotPreview(evt, immediate = false) {
            if (pilotPreviewTimeout) {
                clearTimeout(pilotPreviewTimeout);
                pilotPreviewTimeout = null;
            }

            if (immediate) {
                cancelPilotPreviewHide();
                removePilotPreview();
                return;
            }

            cancelPilotPreviewHide();

            const eventObj = evt || window.event || null;

            if (eventObj) {
                const related = eventObj.relatedTarget || eventObj.toElement || null;
                if (related) {
                    if (pilotPreviewElement && pilotPreviewElement.contains(related)) {
                        return;
                    }
                    if (pilotPreviewTrigger && pilotPreviewTrigger.contains(related)) {
                        return;
                    }
                }
            }

            pilotPreviewHideTimeout = setTimeout(() => {
                if (!pilotPreviewElement) return;
                if (pilotPreviewElement.matches(':hover')) return;
                removePilotPreview();
            }, 600);
        }

        function pilotHoverEnter(event, pilotId, pilotName, element) {
            if (IS_TOUCH_DEVICE) return;
            showPilotPreview(pilotId, pilotName, element);
        }

        function pilotHoverLeave(event) {
            if (IS_TOUCH_DEVICE) return;
            hidePilotPreview(event);
        }

        function pilotFocus(event, pilotId, pilotName, element) {
            showPilotPreview(pilotId, pilotName, element);
        }

        function pilotBlur(event) {
            hidePilotPreview(event);
        }

        function pilotLinkTap(event, pilotId, pilotName, element) {
            if (!IS_TOUCH_DEVICE) {
                return true;
            }

            if (pilotPreviewElement && pilotPreviewElement.dataset && pilotPreviewElement.dataset.pilotId === String(pilotId)) {
                hidePilotPreview(null, true);
                return true;
            }

            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }

            showPilotPreview(pilotId, pilotName, element);
            return false;
        }

        function closePilotTooltip(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const trigger = pilotPreviewTrigger;
            hidePilotPreview(null, true);
            if (trigger && typeof trigger.focus === 'function') {
                setTimeout(() => trigger.focus(), 0);
            }
        }

        function cancelFlightHide() {
            if (flightHideTimeout) {
                clearTimeout(flightHideTimeout);
                flightHideTimeout = null;
            }
        }

        function showFlightPreview(flightId, event) {
            if (previewTimeout) {
                clearTimeout(previewTimeout);
            }
            cancelFlightHide();

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
            hideFlightPreview(null, true); // Hide any existing preview

            previewElement = document.createElement('div');
            previewElement.className = 'flight-preview';
            previewElement.style.pointerEvents = 'auto';

        // Determine task status and scoring type separately
        let taskStatusBadge = '';
        let scoringTypeBadge = '';
        let taskScoreHtml = '';

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

                const taskInfo = detailedFlight.taskInfo || null;
                if (taskInfo) {
                    const hasDeclaredTask = !!taskInfo.hasTask;
                    const taskLengthDisplay = hasDeclaredTask
                        ? (typeof taskInfo.distanceKm === 'number' ? taskInfo.distanceKm.toFixed(1) + ' km' : 'Distance unavailable')
                        : 'No task declared';
                    const taskTypeDisplay = hasDeclaredTask ? taskInfo.typeLabel || 'Declared Task' : 'No task declared';
                    const taskCompletedDisplay = hasDeclaredTask ? (taskInfo.completed ? 'Yes' : 'No') : 'No';

                    const formatPoints = (points) => Number.isFinite(points) ? points.toFixed(1) : '—';
                    const dmstFreePoints = Number.isFinite(taskInfo.dmstFreePoints) ? taskInfo.dmstFreePoints : null;
                    const dmstTaskActualPoints = Number.isFinite(taskInfo.dmstTaskActualPoints) ? taskInfo.dmstTaskActualPoints : null;
                    const dmstTaskPotentialPoints = Number.isFinite(taskInfo.dmstTaskPotentialPoints) ? taskInfo.dmstTaskPotentialPoints : null;
                    const dmstUsedPoints = Number.isFinite(taskInfo.auPoints)
                        ? taskInfo.auPoints
                        : Number.isFinite(taskInfo.taskContestPoints)
                            ? taskInfo.taskContestPoints
                            : (dmstTaskActualPoints ?? dmstFreePoints);
                    const tolerance = 0.5;
                    const dmstFreeIsBest = dmstFreePoints != null && dmstUsedPoints != null && Math.abs(dmstFreePoints - dmstUsedPoints) < tolerance;
                    const dmstTaskIsBest = dmstTaskActualPoints != null && dmstUsedPoints != null && Math.abs(dmstTaskActualPoints - dmstUsedPoints) < tolerance;

                    const weglideFreePointsDetail = Number.isFinite(taskInfo.freePoints) ? taskInfo.freePoints : null;
                    const bestContestType = taskInfo.bestContestType || flightData.contestType || 'free';
                    const isWeGlideBest = bestContestType === 'free';

                    const dmstTaskDisplayRaw = taskInfo.completed
                        ? (dmstTaskActualPoints ?? dmstTaskPotentialPoints)
                        : (dmstTaskPotentialPoints ?? dmstTaskActualPoints);

                    const formatDistanceKm = (value) => Number.isFinite(value) ? value.toFixed(1) + ' km' : null;
                    const fallbackTaskDistance = Number.isFinite(taskInfo.distanceKm) ? taskInfo.distanceKm : null;

                    const dmstFreeDistanceDisplay = formatDistanceKm(taskInfo.dmstFreeDistance)
                        || formatDistanceKm(taskInfo.weglideFreeDistance)
                        || (fallbackTaskDistance != null ? formatDistanceKm(fallbackTaskDistance) : null)
                        || '—';
                    const dmstTaskDistanceDisplay = formatDistanceKm(taskInfo.dmstTaskDistance)
                        || (fallbackTaskDistance != null ? formatDistanceKm(fallbackTaskDistance) : null)
                        || formatDistanceKm(taskInfo.dmstFreeDistance)
                        || '—';
                    const weglideFreeDistanceDisplay = formatDistanceKm(taskInfo.weglideFreeDistance)
                        || formatDistanceKm(taskInfo.dmstFreeDistance)
                        || (fallbackTaskDistance != null ? formatDistanceKm(fallbackTaskDistance) : null)
                        || '—';

                    const dmstFreeRow = dmstFreePoints != null ? \`
                                <div class="task-score-row">
                                    <span class="score-label">DMSt Free Score - \${dmstFreeDistanceDisplay}</span>
                                    <span class="score-value">\${formatPoints(dmstFreePoints)}</span>
                                    <span class="score-check \${!isWeGlideBest && dmstFreeIsBest ? 'active' : ''}">\${!isWeGlideBest && dmstFreeIsBest ? '✓' : ''}</span>
                                </div>\` : '';

                    const dmstTaskLabel = (
                        hasDeclaredTask
                            ? (taskInfo.completed ? 'WeGlide/DMSt Task Score' : 'WeGlide/DMSt Task Score (not finished)')
                            : 'DMSt Task Score'
                    );
                    const showTaskCross = hasDeclaredTask && !taskInfo.completed && dmstTaskDisplayRaw != null;
                    const dmstTaskMarkerClass = showTaskCross
                        ? 'score-check score-cross active'
                        : 'score-check ' + (!isWeGlideBest && dmstTaskIsBest ? 'active' : '');
                    const dmstTaskMarker = showTaskCross
                        ? '✗'
                        : (!isWeGlideBest && dmstTaskIsBest ? '✓' : '');
                    const dmstTaskRow = (hasDeclaredTask && dmstTaskDisplayRaw != null) ? \`
                                <div class="task-score-row">
                                    <span class="score-label">\${dmstTaskLabel} - \${dmstTaskDistanceDisplay}</span>
                                    <span class="score-value">\${formatPoints(dmstTaskDisplayRaw)}</span>
                                    <span class="\${dmstTaskMarkerClass}">\${dmstTaskMarker}</span>
                                </div>\` : '';

                    const freeScoreRow = \`
                                <div class="task-score-row">
                                    <span class="score-label">WeGlide Free Score - \${weglideFreeDistanceDisplay}</span>
                                    <span class="score-value">\${formatPoints(weglideFreePointsDetail)}</span>
                                    <span class="score-check \${isWeGlideBest ? 'active' : ''}">\${isWeGlideBest ? '✓' : ''}</span>
                                </div>\`;

                    taskScoreHtml = \`
                        <div class="task-score-section">
                            <div class="task-score-header">Task & Scores</div>
                            <div class="task-score-grid">
                                <div class="task-score-item">
                                    <span class="task-score-label">Task Length</span>
                                    <span class="task-score-value">\${taskLengthDisplay}</span>
                                </div>
                                <div class="task-score-item">
                                    <span class="task-score-label">Task Type</span>
                                    <span class="task-score-value">\${taskTypeDisplay}</span>
                                </div>
                                <div class="task-score-item">
                                    <span class="task-score-label">Task Completed</span>
                                    <span class="task-score-value">\${taskCompletedDisplay}</span>
                                </div>
                            </div>
                            <div class="task-score-table">
                                \${dmstFreeRow}
                                \${dmstTaskRow}
                                \${freeScoreRow}
                            </div>
                        </div>
                    \`;
                }

            } else {
                console.log('No detailed flight found for ID:', flightData.id);
            }

        if (!taskScoreHtml) {
            const hasDeclaredTask = flightData.declared !== undefined;
            const taskFinished = flightData.declared === true;
            const bestContestType = flightData.contestType || 'free';
            const isWeGlideBest = bestContestType === 'free';
            const formatPoints = (points) => Number.isFinite(points) ? points.toFixed(1) : '—';
            const contestEntries = Array.isArray(flightData.contest) ? flightData.contest : [];
            const findContest = (name) => contestEntries.find(c => c && c.name === name);
            const freeContest = findContest('free');
            const auContest = findContest('au');
            const declarationContest = findContest('declaration');
            const fallbackDistance = Number.isFinite(flightData.distance) ? flightData.distance : null;
            const selectDistance = (...values) => {
                for (const value of values) {
                    if (Number.isFinite(value)) {
                        return value;
                    }
                }
                return null;
            };
            const formatDistanceKmInline = (value) => Number.isFinite(value) ? value.toFixed(1) + ' km' : '—';

            const dmstFreeDistanceValue = selectDistance(
                auContest?.distance,
                declarationContest?.distance,
                freeContest?.distance,
                fallbackDistance
            );
            const dmstTaskDistanceValue = selectDistance(
                declarationContest?.distance,
                auContest?.distance,
                fallbackDistance
            );
            const weglideFreeDistanceValue = selectDistance(
                freeContest?.distance,
                declarationContest?.distance,
                fallbackDistance
            );

            const dmstFreeDistanceDisplay = formatDistanceKmInline(dmstFreeDistanceValue);
            const dmstTaskDistanceDisplay = formatDistanceKmInline(dmstTaskDistanceValue);
            const weglideFreeDistanceDisplay = formatDistanceKmInline(weglideFreeDistanceValue);

            const dmstValueDisplay = !isWeGlideBest ? formatPoints(flightData.points) : '—';
            const freeValueDisplay = isWeGlideBest ? formatPoints(flightData.points) : '—';
            const showTaskCrossRow = hasDeclaredTask && !taskFinished;

            taskScoreHtml = \`
                <div class="task-score-section">
                    <div class="task-score-header">Task & Scores</div>
                    <div class="task-score-grid">
                        <div class="task-score-item">
                            <span class="task-score-label">Task Length</span>
                            <span class="task-score-value">\${hasDeclaredTask ? 'Declared' : 'No task declared'}</span>
                        </div>
                        <div class="task-score-item">
                            <span class="task-score-label">Task Type</span>
                            <span class="task-score-value">\${hasDeclaredTask ? 'Declared Task' : 'No task declared'}</span>
                        </div>
                        <div class="task-score-item">
                            <span class="task-score-label">Task Completed</span>
                            <span class="task-score-value">\${hasDeclaredTask ? (taskFinished ? 'Yes' : 'No') : 'No'}</span>
                        </div>
                    </div>
                    <div class="task-score-table">
                        <div class="task-score-row">
                            <span class="score-label">DMSt Free Score - \${dmstFreeDistanceDisplay}</span>
                            <span class="score-value">\${dmstValueDisplay}</span>
                            <span class="score-check \${!isWeGlideBest ? 'active' : ''}">\${!isWeGlideBest ? '✓' : ''}</span>
                        </div>
                        <div class="task-score-row">
                            <span class="score-label">WeGlide/DMSt Task Score\${showTaskCrossRow ? ' (not finished)' : ''} - \${dmstTaskDistanceDisplay}</span>
                            <span class="score-value">—</span>
                            <span class="\${showTaskCrossRow ? 'score-check score-cross active' : 'score-check'}">\${showTaskCrossRow ? '✗' : ''}</span>
                        </div>
                        <div class="task-score-row">
                            <span class="score-label">WeGlide Free Score - \${weglideFreeDistanceDisplay}</span>
                            <span class="score-value">\${freeValueDisplay}</span>
                            <span class="score-check \${isWeGlideBest ? 'active' : ''}">\${isWeGlideBest ? '✓' : ''}</span>
                        </div>
                    </div>
                </div>
            \`;
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
                <button class="tooltip-close-btn" onclick="closeFlightTooltip(event)">&times;</button>
                <div class="flight-tooltip-header">
                    <strong>\${flightData.pilot}</strong>
                    \${aircraftHeaderDisplay ? \`<span class="aircraft-info">\${aircraftHeaderDisplay}</span>\` : ''}
                    \${statusBadges}
                </div>
                <div class="flight-tooltip-content">
                    \${flightImageHtml}
                    \${detailedStatsHtml}
                    \${taskScoreHtml}
                </div>
            \`;

            document.body.appendChild(previewElement);

            previewElement.addEventListener('mouseenter', cancelFlightHide);
            previewElement.addEventListener('mouseleave', (evt) => hideFlightPreview(evt));

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

        function hideFlightPreview(evt, immediate = false) {
            if (previewTimeout) {
                clearTimeout(previewTimeout);
                previewTimeout = null;
            }

            if (immediate) {
                cancelFlightHide();
                if (previewElement) {
                    previewElement.remove();
                    previewElement = null;
                }
                return;
            }

            cancelFlightHide();

            const related = evt ? (evt.relatedTarget || evt.toElement || null) : null;
            if (related && previewElement && previewElement.contains(related)) {
                return; // Moving into tooltip; keep open
            }

            flightHideTimeout = setTimeout(() => {
                if (previewElement && !previewElement.matches(':hover')) {
                    previewElement.remove();
                    previewElement = null;
                }
            }, 300);
        }

        function closeFlightTooltip(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            hideFlightPreview(null, true);
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
            const isThreeFlightMode = currentScoringMode === 'sprint' || currentScoringMode === 'triangle' || currentScoringMode === 'out_return' || currentScoringMode === 'out';
            const maxFlightsToShow = isThreeFlightMode ? 3 : 5;

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
                const safePilotNameAttr = pilot.pilot ? pilot.pilot.replace(/'/g, "\\'") : '';
                if (isSilverCGull) {
                    // For Silver C-Gull, check if pilotId is available
                    if (pilot.userId) {
                        pilotName = \`<a href="https://www.weglide.org/user/\${pilot.userId}" target="_blank" class="pilot-link" onmouseenter="pilotHoverEnter(event, '\${pilot.userId}', '\${safePilotNameAttr}', this)" onmouseleave="pilotHoverLeave(event)" onfocus="pilotFocus(event, '\${pilot.userId}', '\${safePilotNameAttr}', this)" onblur="pilotBlur(event)" onclick="return pilotLinkTap(event, '\${pilot.userId}', '\${safePilotNameAttr}', this)">\${pilot.pilot}</a>\`;
                    } else {
                        pilotName = pilot.pilot;
                    }
                } else {
                    pilotName = \`<a href="https://www.weglide.org/user/\${pilot.pilotId}" target="_blank" class="pilot-link" onmouseenter="pilotHoverEnter(event, '\${pilot.pilotId}', '\${safePilotNameAttr}', this)" onmouseleave="pilotHoverLeave(event)" onfocus="pilotFocus(event, '\${pilot.pilotId}', '\${safePilotNameAttr}', this)" onblur="pilotBlur(event)" onclick="return pilotLinkTap(event, '\${pilot.pilotId}', '\${safePilotNameAttr}', this)">\${pilot.pilot}</a>\`;
                }

                // Add verification status for under 200 hrs mode
                let verificationButton = '';
                let verificationBadge = '';
                let rowClass = '';

                if (under200Enabled && !isSilverCGull) {
                    const pilotId = pilot.pilotId;
                    const verificationData = pilotVerifications.picHoursVerifications && pilotVerifications.picHoursVerifications[pilotId];
                    const isUserVerified = verificationData && verificationData.dataSource === 'user-entered';

                    if (isUserVerified) {
                        verificationBadge = '<div class="verification-badge verified">✓ <200hrs PIC Verified</div>';
                        rowClass = 'verified-row';
                    } else {
                        verificationButton = \`<div><button class="verify-btn unverified" onclick="showVerificationForm('\${pilotId}', '\${pilot.pilot.replace(/'/g, '\\\'')}')" title="Verify PIC hours">Verify PIC hours</button></div>\`;
                        rowClass = 'unverified-row';
                    }

                    // Add verification elements underneath pilot name
                    pilotName = \`\${pilotName}\${verificationBadge}\${verificationButton}\`;
                } else if (isSilverCGull) {
                    const pilotId = pilot.userId || pilot.pilotId;
                    const verificationData = pilotVerifications.dobVerifications && pilotVerifications.dobVerifications[pilotId];
                    const isUserVerified = verificationData && verificationData.dataSource === 'user-entered';

                    if (isUserVerified) {
                        verificationBadge = '<div class="verification-badge verified">✓ DOB Verified</div>';
                        rowClass = 'verified-row';
                    } else {
                        verificationButton = \`<div><button class="verify-btn unverified" onclick="showDOBVerificationForm('\${pilotId}', '\${pilot.pilot.replace(/'/g, '\\\'')}')" title="Verify date of birth">Verify DOB</button></div>\`;
                        rowClass = 'unverified-row';
                    }

                    // Add verification elements underneath pilot name
                    pilotName = \`\${pilotName}\${verificationBadge}\${verificationButton}\`;
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
                    const flightsToShow = Array.isArray(pilot.bestFlights)
                        ? pilot.bestFlights.slice(0, maxFlightsToShow)
                        : [];
                    row.innerHTML = \`
                        <td class="rank">\${rankDisplay}</td>
                        <td class="pilot-name">\${pilotName}</td>
                        <td class="total-points">\${pilot.totalPoints.toFixed(1)}</td>
                        \${flightsToShow.map(flight => createFlightCell(flight)).join('')}
                        \${Array(5 - flightsToShow.length).fill('<td class="flight-cell">-</td>').join('')}
                    \`;
                }

                // Apply verification row class
                if (rowClass) {
                    row.className = rowClass;
                }

                tbody.appendChild(row);
            });

            toggleFlightColumns(maxFlightsToShow);

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
            } else if (!isSilverCGull && (currentScoringMode === 'mixed' || currentScoringMode === 'free')) {
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

            // Re-add pilot tooltip listeners after leaderboard is built
            setTimeout(() => {
            }, 0);
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
                silverCGull: calculateSilverCGullTrophy(),
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

            // Find verified and unverified pilots
            const getVerificationStatus = (pilot) => {
                const verificationData = pilotVerifications.picHoursVerifications && pilotVerifications.picHoursVerifications[pilot.pilotId];
                // Only consider user-entered verifications, not WeGlide-calculated ones
                return verificationData && verificationData.dataSource === 'user-entered';
            };

            // Get top verified pilot and any higher unverified pilots
            let topVerifiedCombined = null;
            let topVerifiedFree = null;
            let higherUnverifiedCombined = [];
            let higherUnverifiedFree = [];

            // For combined scoring
            for (let i = 0; i < mixed200.length; i++) {
                const pilot = mixed200[i];
                if (getVerificationStatus(pilot)) {
                    topVerifiedCombined = pilot;
                    // Get all unverified pilots that scored higher
                    higherUnverifiedCombined = mixed200.slice(0, i).filter(p => !getVerificationStatus(p));
                    break;
                }
            }

            // For free scoring
            for (let i = 0; i < free200.length; i++) {
                const pilot = free200[i];
                if (getVerificationStatus(pilot)) {
                    topVerifiedFree = pilot;
                    // Get all unverified pilots that scored higher
                    higherUnverifiedFree = free200.slice(0, i).filter(p => !getVerificationStatus(p));
                    break;
                }
            }

            const result = {
                combined: topVerifiedCombined,
                free: null,
                sameWinner: false,
                explanation: '',
                higherUnverifiedCombined: higherUnverifiedCombined,
                higherUnverifiedFree: higherUnverifiedFree
            };

            if (topVerifiedCombined && topVerifiedFree && topVerifiedCombined.pilot === topVerifiedFree.pilot) {
                result.sameWinner = true;
                result.explanation = 'Combined and Free score same person - 1 award';
            } else if (topVerifiedFree && topVerifiedFree !== topVerifiedCombined) {
                result.free = topVerifiedFree;
                result.explanation = 'Different winners in Combined vs Free scoring - 2 awards';
            } else if (!topVerifiedCombined) {
                result.explanation = 'No verified pilots found with <200 hours';
            }

            return result;
        }

        function calculateSilverCGullTrophy() {
            // Find verified and unverified pilots in Silver C-Gull candidates
            const getDOBVerificationStatus = (pilot) => {
                return pilotVerifications.dobVerifications && pilotVerifications.dobVerifications[pilot.userId || pilot.pilotId];
            };

            let youngestVerified = null;
            let youngestAge = Infinity;
            let unverifiedCandidates = [];

            silverCGullLeaderboard.forEach(pilot => {
                const verification = getDOBVerificationStatus(pilot);

                if (verification && verification.dateOfBirth) {
                    // Calculate age at time of achievement
                    const dob = new Date(verification.dateOfBirth);
                    const achievementDate = new Date(pilot.date);
                    const ageAtAchievement = (achievementDate - dob) / (365.25 * 24 * 60 * 60 * 1000);

                    if (ageAtAchievement < youngestAge) {
                        youngestAge = ageAtAchievement;
                        youngestVerified = {
                            ...pilot,
                            ageAtAchievement: Math.floor(ageAtAchievement),
                            dateOfBirth: verification.dateOfBirth
                        };
                    }
                } else {
                    unverifiedCandidates.push(pilot);
                }
            });

            return {
                winner: youngestVerified,
                unverifiedCandidates: unverifiedCandidates.slice(0, 10), // Limit to 10
                totalUnverified: unverifiedCandidates.length,
                explanation: youngestVerified ?
                    \`Youngest verified pilot to achieve Silver C badge (age \${youngestVerified.ageAtAchievement})\` :
                    'No verified pilots found'
            };
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
                        <div class="winner-info">
                            <span class="winner-name">🥇 <a href="https://www.weglide.org/user/\${trophy.combined.pilotId}" target="_blank" class="pilot-link">\${trophy.combined.pilot}</a></span>
                            <span class="winner-score">\${score.toFixed(1)} pts</span>
                        </div>
                        <span class="winner-type">Combined</span>
                        \${type === 'flight' && trophy.combined.id ?
                            \`<a href="https://www.weglide.org/flight/\${trophy.combined.id}" target="_blank" class="flight-link">View Flight →</a>\` : ''}
                    </div>
                \`;
            }

            if (trophy.free && !trophy.sameWinner) {
                const score = trophy.free.totalPoints || trophy.free.points || 0;
                html += \`
                    <div class="winner free-winner">
                        <div class="winner-info">
                            <span class="winner-name">🥈 <a href="https://www.weglide.org/user/\${trophy.free.pilotId}" target="_blank" class="pilot-link">\${trophy.free.pilot}</a></span>
                            <span class="winner-score">\${score.toFixed(1)} pts</span>
                        </div>
                        <span class="winner-type">Free</span>
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

        function formatTrophy200Winner(trophy) {
            if (!trophy || (!trophy.combined && !trophy.free)) {
                return '<p class="no-winner">No eligible winner found</p>';
            }

            const getVerificationStatusText = (pilot) => {
                const verificationData = pilotVerifications.picHoursVerifications && pilotVerifications.picHoursVerifications[pilot.pilotId];
                // Only consider user-entered verifications, not WeGlide-calculated ones
                const isVerified = verificationData && verificationData.dataSource === 'user-entered';
                if (isVerified) {
                    return '<span class="verification-status verified">✓ <200hrs PIC Verified</span>';
                } else {
                    return '<span class="verification-status unverified">⚠ Needs PIC verification</span>';
                }
            };

            let html = '';

            // Show current verified winner
            if (trophy.combined) {
                const score = trophy.combined.totalPoints || trophy.combined.points || 0;
                html += \`
                    <div class="winner combined-winner">
                        <div class="winner-info">
                            <span class="winner-name">🥇 <a href="https://www.weglide.org/user/\${trophy.combined.pilotId}" target="_blank" class="pilot-link">\${trophy.combined.pilot}</a></span>
                            <span class="winner-score">\${score.toFixed(1)} pts</span>
                        </div>
                        <span class="winner-type">Combined</span>
                        \${getVerificationStatusText(trophy.combined)}
                    </div>
                \`;
            }

            if (!trophy.sameWinner && trophy.free) {
                const score = trophy.free.totalPoints || trophy.free.points || 0;
                html += \`
                    <div class="winner free-winner">
                        <div class="winner-info">
                            <span class="winner-name">🥇 <a href="https://www.weglide.org/user/\${trophy.free.pilotId}" target="_blank" class="pilot-link">\${trophy.free.pilot}</a></span>
                            <span class="winner-score">\${score.toFixed(1)} pts</span>
                        </div>
                        <span class="winner-type">Free</span>
                        \${getVerificationStatusText(trophy.free)}
                    </div>
                \`;
            }

            // Show higher unverified pilots that need verification (limit to top 5)
            if (trophy.higherUnverifiedCombined && trophy.higherUnverifiedCombined.length > 0) {
                const maxShow = 5;
                const totalUnverified = trophy.higherUnverifiedCombined.length;
                const pilotsToShow = trophy.higherUnverifiedCombined.slice(0, maxShow);

                html += '<div class="unverified-leaders">';

                if (totalUnverified === 1) {
                    html += '<h6 style="margin: 12px 0 6px 0; font-size: 0.75em; color: #ccc; opacity: 0.8;">1 higher scoring pilot needs verification:</h6>';
                } else if (totalUnverified <= maxShow) {
                    html += \`<h6 style="margin: 12px 0 6px 0; font-size: 0.75em; color: #ccc; opacity: 0.8;">\${totalUnverified} higher scoring pilots need verification:</h6>\`;
                } else {
                    html += \`<h6 style="margin: 12px 0 6px 0; font-size: 0.75em; color: #ccc; opacity: 0.8;">Top \${maxShow} of \${totalUnverified} higher scoring pilots need verification:</h6>\`;
                }

                pilotsToShow.forEach((pilot, index) => {
                    const score = pilot.totalPoints || pilot.points || 0;
                    html += \`
                        <div class="unverified-pilot">
                            <div class="winner-info">
                                <span class="winner-name">\${pilot.pilot}</span>
                                <span class="winner-score">\${score.toFixed(1)} pts</span>
                            </div>
                            <button class="verify-btn unverified small" onclick="showVerificationForm('\${pilot.pilotId}', '\${pilot.pilot.replace(/'/g, '\\\'')}')" title="Verify to claim trophy position">Verify PIC hours</button>
                        </div>
                    \`;
                });

                if (totalUnverified > maxShow) {
                    html += \`<p style="font-size: 0.8em; color: #cccccc; margin: 8px 0 0 0; font-style: italic;">...and \${totalUnverified - maxShow} more. Switch to "<200 hrs PIC" view to see all eligible pilots.</p>\`;
                }

                html += '</div>';
            }

            return html;
        }

        function formatSilverCGullTrophyWinner(trophy) {
            if (!trophy.winner) {
                let html = '<p class="no-winner">No verified pilots found</p>';

                // Add button to view candidates
                html += \`
                    <div style="margin-top: 10px;">
                        <button class="toggle-btn" onclick="switchScoringMode('silverCGull')" title="View Silver C-Gull candidates">View Candidates</button>
                    </div>
                \`;

                if (trophy.totalUnverified > 0) {
                    html += \`<p style="font-size: 0.8em; color: #cccccc; margin: 8px 0 0 0; font-style: italic;">\${trophy.totalUnverified} candidates need date of birth verification</p>\`;
                }

                return html;
            }

            let html = '';

            // Show verified winner
            html += \`
                <div class="winner combined-winner">
                    <div class="winner-info">
                        <span class="winner-name">🥇 <a href="https://www.weglide.org/user/\${trophy.winner.userId || trophy.winner.pilotId}" target="_blank" class="pilot-link">\${trophy.winner.pilot}</a></span>
                        <span class="winner-score">Age \${trophy.winner.ageAtAchievement} on \${new Date(trophy.winner.date).toLocaleDateString()}</span>
                    </div>
                    <span class="winner-type">Silver C Achievement</span>
                    <span class="verification-status verified">✓ DOB Verified</span>
                </div>
            \`;

            // Show unverified candidates if any (limit to 3)
            if (trophy.unverifiedCandidates && trophy.unverifiedCandidates.length > 0) {
                html += '<div class="unverified-leaders">';
                html += \`<h6 style="margin: 12px 0 6px 0; font-size: 0.75em; color: #ccc; opacity: 0.8;">Candidates need verification (\${trophy.totalUnverified} total):</h6>\`;

                const maxShow = 3;
                trophy.unverifiedCandidates.slice(0, maxShow).forEach((pilot) => {
                    html += \`
                        <div class="unverified-pilot">
                            <div class="winner-info">
                                <span class="winner-name">\${pilot.pilot}</span>
                            </div>
                            <button class="verify-btn unverified small" onclick="showDOBVerificationForm('\${pilot.userId || pilot.pilotId}', '\${pilot.pilot.replace(/'/g, '\\\'')}')" title="Verify date of birth">Verify DOB</button>
                        </div>
                    \`;
                });

                if (trophy.totalUnverified > maxShow) {
                    const remaining = trophy.totalUnverified - maxShow;
                    html += \`<p style="font-size: 0.8em; color: #cccccc; margin: 8px 0 0 0; font-style: italic;">...and \${remaining} more candidates. View Silver C-Gull candidates list.</p>\`;
                }

                html += '</div>';
            }

            // Always add Silver C candidates link
            html += \`
                <div style="margin-top: 10px;">
                    <button class="toggle-btn" onclick="switchScoringMode('silverCGull')" title="View Silver C-Gull candidates">View Silver C-Gull Candidates</button>
                </div>
            \`;

            return html;
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

            // 200 Trophy (moved beside Canadair)
            html += \`
                <div class="trophy-item">
                    <h4>🏆 200 Trophy</h4>
                    <p class="trophy-desc">Under 200 Hours Champion</p>
                    \${formatTrophy200Winner(trophies.trophy200)}
                    <p class="calculation-note">\${trophies.trophy200.explanation}</p>
                </div>
            \`;

            // BAIC Trophy (moved to third position)
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

            // Silver C-Gull Trophy (moved to last position)
            html += \`
                <div class="trophy-item">
                    <h4>🏆 Silver C-Gull Trophy</h4>
                    <p class="trophy-desc">Youngest to Achieve Silver C Badge</p>
                    \${formatSilverCGullTrophyWinner(trophies.silverCGull)}
                    <p class="calculation-note">\${trophies.silverCGull.explanation}</p>
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
                const isFinished = flight.task_achieved === true;
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

        // Admin functions for verification management
        function exportVerificationData() {
            const data = localStorage.getItem('pilot_verifications');
            if (!data) {
                alert('No verification data found in localStorage');
                return;
            }

            // Create downloadable file
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pilot_verifications_export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert('Verification data exported! Save this file and commit it to your repository as pilot_pic_hours_verification.json');
        }

        function showAdminPanel() {
            const localData = localStorage.getItem('pilot_verifications');
            const verificationCount = localData ? Object.keys(JSON.parse(localData).verifications || {}).length : 0;

            const overlay = document.createElement('div');
            overlay.className = 'verification-overlay';
            overlay.innerHTML = \`
                <div class="verification-form" style="max-width: 600px;">
                    <h3>Admin Panel - Verification Data</h3>
                    <p><strong>Stored Verifications:</strong> \${verificationCount}</p>
                    <div style="margin: 20px 0; padding: 15px; background: #f0f0f0; border-radius: 5px;">
                        <h4>For GitHub Pages Deployment:</h4>
                        <p style="font-size: 0.9em; text-align: left; line-height: 1.4; color: #333;">
                            1. Click "Export Verification Data" to download the JSON file<br>
                            2. Save it as <code>pilot_pic_hours_verification.json</code> in your repository<br>
                            3. Commit and push to GitHub<br>
                            4. Regenerate your HTML with the updated data using the Node.js script<br>
                            5. Deploy the new HTML to GitHub Pages
                        </p>
                    </div>
                    <div class="form-buttons">
                        <button class="submit-btn" onclick="exportVerificationData()">Export Verification Data</button>
                        <button class="cancel-btn" onclick="closeVerificationForm()">Close</button>
                    </div>
                </div>
            \`;
            document.body.appendChild(overlay);
        }

        // Add keyboard shortcut for admin panel (Ctrl+Shift+A)
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.shiftKey && e.key === 'A') {
                e.preventDefault();
                showAdminPanel();
            }
        });

        // DOB Verification form
        function showDOBVerificationForm(pilotId, pilotName) {
            const overlay = document.createElement('div');
            overlay.className = 'verification-overlay';
            overlay.innerHTML = \`
                <div class="verification-form">
                    <h3>Date of Birth Verification</h3>
                    <p><strong>\${pilotName}</strong></p>
                    <p>To be eligible for the Silver C-Gull trophy (youngest to achieve Silver C), please confirm your date of birth:</p>
                    <div>
                        <input type="date" id="dobInput" max="2010-12-31" />
                        <label for="dobInput">Date of Birth</label>
                    </div>
                    <p style="font-size: 0.9em; color: #888;">This is a self-declaration system. Your age at the time of achieving Silver C will be calculated.</p>
                    <div class="form-buttons">
                        <button class="submit-btn" onclick="submitDOBVerification('\${pilotId}', '\${pilotName}')">Verify</button>
                        <button class="cancel-btn" onclick="closeVerificationForm()">Cancel</button>
                    </div>
                </div>
            \`;
            document.body.appendChild(overlay);
        }

        async function submitDOBVerification(pilotId, pilotName) {
            const dobInput = document.getElementById('dobInput');
            const dateOfBirth = dobInput.value;

            if (!dateOfBirth) {
                alert('Please enter your date of birth');
                return;
            }

            const dob = new Date(dateOfBirth);
            const today = new Date();
            const age = (today - dob) / (365.25 * 24 * 60 * 60 * 1000);

            if (age < 14 || age > 100) {
                alert('Please enter a valid date of birth');
                return;
            }

            // Show loading state
            const submitBtn = document.querySelector('.submit-btn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Saving...';
            submitBtn.disabled = true;

            try {
                // Save to database
                await saveDOBVerificationToDatabase(pilotId, pilotName, dateOfBirth);

                // Update local data for immediate UI update
                pilotVerifications.dobVerifications = pilotVerifications.dobVerifications || {};
                pilotVerifications.dobVerifications[pilotId] = {
                    pilotName: pilotName,
                    dateOfBirth: dateOfBirth,
                    verifiedDate: new Date().toISOString(),
                    dataSource: 'user-entered',
                    age: Math.floor(age)
                };

                // Close form and rebuild leaderboard
                closeVerificationForm();
                buildLeaderboard();
                calculateTrophyWinners(); // Recalculate trophies

                // Show confirmation
                alert(\`Thank you \${pilotName}! Your date of birth has been verified.\`);
            } catch (error) {
                console.error('Failed to save DOB verification:', error);
                alert('Failed to save verification. Please try again or contact support.');

                // Reset button
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }

        // Verification system functions
        function calculateWeGlideHoursSinceStart(pilotId) {
            const startDate = new Date('2024-10-01');
            let totalHours = 0;

            // Look through all flight data for this pilot since Oct 1, 2024
            const allFlightData = [...mixedLeaderboard, ...freeLeaderboard, ...silverCGullLeaderboard];
            const pilotFlights = allFlightData.filter(p => p.pilotId == pilotId);

            pilotFlights.forEach(pilot => {
                if (pilot.bestFlights) {
                    pilot.bestFlights.forEach(flight => {
                        if (flight.date && new Date(flight.date) >= startDate) {
                            // Extract duration from flight data (this would need to be added to flight data structure)
                            // For now, we'll estimate based on distance and speed
                            if (flight.distance && flight.speed) {
                                const estimatedHours = flight.distance / flight.speed;
                                totalHours += estimatedHours;
                            }
                        }
                    });
                } else if (pilot.date && new Date(pilot.date) >= startDate) {
                    // Silver C-Gull structure
                    if (pilot.distance && pilot.speed) {
                        const estimatedHours = pilot.distance / pilot.speed;
                        totalHours += estimatedHours;
                    }
                }
            });

            return totalHours;
        }

        async function runAutomaticVerificationWorkflow() {
            console.log('Running automatic verification workflow...');

            // Get all pilots from the mixed leaderboard (most comprehensive)
            const allPilots = mixedLeaderboard.map(p => ({ pilotId: p.pilotId, pilot: p.pilot }));
            let updatedCount = 0;

            for (const pilot of allPilots) {
                const pilotId = pilot.pilotId;

                // Skip if user has already entered data (highest priority)
                const existingVerification = pilotVerifications.picHoursVerifications &&
                                           pilotVerifications.picHoursVerifications[pilotId];

                if (existingVerification && existingVerification.dataSource === 'user-entered') {
                    continue; // Don't overwrite user data
                }

                // Calculate WeGlide-based hours
                const weglideHoursSinceStart = calculateWeGlideHoursSinceStart(pilotId);
                const totalWeGlideHours = pilotDurations[pilotId] ? (pilotDurations[pilotId] / 3600) : 0;
                const estimatedOct1Hours = Math.max(0, totalWeGlideHours - weglideHoursSinceStart);

                // Only update if we have meaningful WeGlide data
                if (totalWeGlideHours > 0) {
                    pilotVerifications.picHoursVerifications = pilotVerifications.picHoursVerifications || {};

                    // Create/update automatic verification entry
                    pilotVerifications.picHoursVerifications[pilotId] = {
                        pilotName: pilot.pilot,
                        picHours: estimatedOct1Hours,
                        verifiedDate: new Date().toISOString(),
                        dataSource: 'weglide-calculated', // Lower priority than user data
                        eligible: estimatedOct1Hours < 200,
                        calculation: {
                            totalWeGlideHours: totalWeGlideHours,
                            hoursSinceOct1: weglideHoursSinceStart,
                            estimatedOct1Hours: estimatedOct1Hours
                        }
                    };
                    updatedCount++;

                    // Save to database if pilot is over 200 hours (important for eligibility)
                    if (estimatedOct1Hours >= 200) {
                        try {
                            await saveVerificationToDatabase(pilotId, pilot.pilot, estimatedOct1Hours, 'weglide-calculated');
                        } catch (error) {
                            console.warn(\`Failed to save auto-verification for \${pilot.pilot}:\`, error);
                        }
                    }
                }
            }

            if (updatedCount > 0) {
                console.log(\`Updated \${updatedCount} pilot verifications automatically\`);
            }
        }


        function showVerificationForm(pilotId, pilotName) {
            // Calculate WeGlide hours since Oct 1, 2024
            const weglideHoursSinceStart = calculateWeGlideHoursSinceStart(pilotId);
            const totalWeGlideHours = pilotDurations[pilotId] ? (pilotDurations[pilotId] / 3600) : 0;
            const estimatedOct1Hours = Math.max(0, totalWeGlideHours - weglideHoursSinceStart);

            const overlay = document.createElement('div');
            overlay.className = 'verification-overlay';
            overlay.innerHTML = \`
                <div class="verification-form">
                    <h3>PIC Hours Verification</h3>
                    <p><strong>\${pilotName}</strong></p>
                    <p>Please confirm your total Pilot-in-Command hours as of <strong>October 1, 2024</strong>:</p>

                    \${weglideHoursSinceStart > 0 ? \`
                    <div class="weglide-calculation" style="background: rgba(0,123,255,0.1); padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 0.9em;">
                        <strong>WeGlide Calculation:</strong><br>
                        Total WeGlide hours: \${totalWeGlideHours.toFixed(1)}h<br>
                        Hours since Oct 1, 2024: \${weglideHoursSinceStart.toFixed(1)}h<br>
                        <strong>Estimated Oct 1, 2024 hours: \${estimatedOct1Hours.toFixed(1)}h</strong>
                    </div>
                    \` : ''}

                    <div>
                        <input type="number" id="picHours" min="0" step="0.1" placeholder="Hours" value="\${estimatedOct1Hours > 0 ? estimatedOct1Hours.toFixed(1) : ''}" />
                        <label for="picHours">hours PIC</label>
                    </div>
                    <p style="font-size: 0.9em; color: #888;">
                        Self-declaration system. If you enter ≥200 hours, you'll be removed from the Under 200 Hours eligibility list.
                        \${weglideHoursSinceStart > 0 ? 'Pre-filled with WeGlide calculation - please verify or correct.' : ''}
                    </p>
                    <div class="form-buttons">
                        <button class="submit-btn" onclick="submitVerification('\${pilotId}', '\${pilotName}')">Verify</button>
                        <button class="cancel-btn" onclick="closeVerificationForm()">Cancel</button>
                    </div>
                </div>
            \`;
            document.body.appendChild(overlay);
        }

        function closeVerificationForm() {
            const overlay = document.querySelector('.verification-overlay');
            if (overlay) {
                overlay.remove();
            }
        }

        async function submitVerification(pilotId, pilotName) {
            const hoursInput = document.getElementById('picHours');
            const hours = parseFloat(hoursInput.value);

            if (isNaN(hours) || hours < 0) {
                alert('Please enter valid PIC hours (0 or greater)');
                return;
            }

            // Show loading state
            const submitBtn = document.querySelector('.submit-btn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Saving...';
            submitBtn.disabled = true;

            try {
                // Save to database (Firebase or localStorage fallback)
                await saveVerificationToDatabase(pilotId, pilotName, hours);

                // Update local data for immediate UI update
                pilotVerifications.picHoursVerifications = pilotVerifications.picHoursVerifications || {};
                pilotVerifications.picHoursVerifications[pilotId] = {
                    pilotName: pilotName,
                    picHours: hours,
                    verifiedDate: new Date().toISOString(),
                    dataSource: 'user-entered', // Mark as user data (highest priority)
                    eligible: hours < 200
                };

                // Close form and rebuild leaderboard
                closeVerificationForm();
                buildLeaderboard();

                // Show confirmation
                alert(\`Thank you \${pilotName}! Your PIC hours (\${hours}) have been verified and saved.\`);
            } catch (error) {
                console.error('Failed to save verification:', error);
                alert('Failed to save verification. Please try again or contact support.');

                // Reset button
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }

        // Firebase configuration
        const firebaseConfig = {
            apiKey: "AIzaSyCXkPOue3IVoSRCYYYoudxHo_hFl-a_TxY",
            authDomain: "australian-leaderboard.firebaseapp.com",
            projectId: "australian-leaderboard",
            storageBucket: "australian-leaderboard.firebasestorage.app",
            messagingSenderId: "839850033533",
            appId: "1:839850033533:web:083b21b92572efff878c14"
        };

        // Initialize Firebase (loaded from CDN)
        let db = null;

        async function initializeFirebase() {
            try {
                // Firebase is loaded via CDN in the HTML
                if (typeof firebase !== 'undefined') {
                    firebase.initializeApp(firebaseConfig);
                    db = firebase.firestore();
                    console.log('Firebase initialized successfully');
                } else {
                    console.warn('Firebase not loaded - using localStorage fallback');
                }
            } catch (error) {
                console.warn('Firebase initialization failed - using localStorage fallback:', error);
            }
        }

        async function saveVerificationToDatabase(pilotId, pilotName, hours, dataSource = 'user-entered') {
            const verificationData = {
                pilotId: pilotId,
                pilotName: pilotName,
                picHours: hours,
                verifiedDate: new Date().toISOString(),
                eligible: hours < 200,
                dataSource: dataSource,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (db) {
                try {
                    console.log('Attempting to save verification data:', JSON.stringify(verificationData, null, 2));
                    // Save to Firebase Firestore
                    await db.collection('pilot_verifications').doc(pilotId).set(verificationData);
                    console.log('Verification saved to Firebase');
                    return;
                } catch (error) {
                    console.error('Firebase save failed:', error);
                    console.error('Error details:', error.code, error.message);
                    console.error('Data that failed:', JSON.stringify(verificationData, null, 2));
                    // Fall back to localStorage
                }
            }

            // Fallback to localStorage
            const localData = JSON.parse(localStorage.getItem('pilot_verifications') || '{"picHoursVerifications": {}, "dobVerifications": {}}');
            localData.picHoursVerifications = localData.picHoursVerifications || {};
            localData.picHoursVerifications[pilotId] = {
                pilotName: pilotName,
                picHours: hours,
                verifiedDate: new Date().toISOString(),
                eligible: hours < 200
            };
            localStorage.setItem('pilot_verifications', JSON.stringify(localData));
            console.log('Verification saved to localStorage (fallback)');
        }

        // Mass Firebase sync function - triggered by URL parameter
        async function massFirebaseSync() {
            if (!db) {
                console.log('⚠️ Firebase not initialized - cannot perform mass sync');
                return;
            }

            console.log('🔄 Starting mass Firebase sync of all WeGlide verification data...');

            let successCount = 0;
            let skipCount = 0;
            let errorCount = 0;

            // Get all WeGlide-calculated verifications
            const allVerifications = Object.entries(pilotVerifications.picHoursVerifications || {})
                .filter(([pilotId, data]) => data.dataSource === 'weglide-calculated');

            console.log('📊 Found ' + allVerifications.length + ' WeGlide verifications to sync');

            for (const [pilotId, verificationData] of allVerifications) {
                try {
                    // Check if this pilot already exists in Firebase
                    const existingDoc = await db.collection('pilot_verifications').doc(pilotId).get();

                    if (existingDoc.exists) {
                        const existingData = existingDoc.data();
                        // Don't overwrite user-entered data
                        if (existingData.dataSource === 'user-entered') {
                            skipCount++;
                            continue;
                        }
                    }

                    // Push to Firebase
                    const firebaseData = {
                        pilotId: pilotId,
                        pilotName: verificationData.pilotName,
                        picHours: verificationData.picHours,
                        verifiedDate: verificationData.verifiedDate,
                        eligible: verificationData.eligible,
                        dataSource: verificationData.dataSource,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    // Only include calculation if it exists and has no undefined values
                    if (verificationData.calculation &&
                        typeof verificationData.calculation === 'object' &&
                        Object.values(verificationData.calculation).every(val => val !== undefined)) {
                        firebaseData.calculation = verificationData.calculation;
                    }

                    await db.collection('pilot_verifications').doc(pilotId).set(firebaseData);
                    successCount++;

                    // Progress update and throttle
                    if (successCount % 25 === 0) {
                        console.log('   📤 Synced ' + successCount + ' verifications...');
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                } catch (error) {
                    console.error('❌ Failed to sync pilot ' + pilotId + ' (' + verificationData.pilotName + '):', error.message);
                    errorCount++;
                }
            }

            console.log('📊 Mass Firebase Sync Complete:');
            if (successCount > 0) {
                console.log('✅ Successfully synced ' + successCount + ' WeGlide verifications');
            }
            if (skipCount > 0) {
                console.log('⏭️ Skipped ' + skipCount + ' pilots (user data preserved)');
            }
            if (errorCount > 0) {
                console.log('⚠️ Failed to sync ' + errorCount + ' verifications');
            }

            // Update URL to remove the parameter so sync doesn't run again on refresh
            const newUrl = new URL(window.location);
            newUrl.searchParams.delete('sync_firebase');
            window.history.replaceState({}, '', newUrl);
            console.log('🔧 Removed sync_firebase parameter from URL');
        }

        async function saveDOBVerificationToDatabase(pilotId, pilotName, dateOfBirth) {
            const verificationData = {
                pilotId: pilotId,
                pilotName: pilotName,
                dateOfBirth: dateOfBirth,
                verifiedDate: new Date().toISOString(),
                dataSource: 'user-entered',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (db) {
                try {
                    // Save to Firebase Firestore
                    await db.collection('dob_verifications').doc(pilotId).set(verificationData);
                    console.log('DOB verification saved to Firebase');
                    return;
                } catch (error) {
                    console.error('Firebase DOB save failed:', error);
                    // Fall back to localStorage
                }
            }

            // Fallback to localStorage
            const localData = JSON.parse(localStorage.getItem('pilot_verifications') || '{"picHoursVerifications": {}, "dobVerifications": {}}');
            localData.dobVerifications = localData.dobVerifications || {};
            localData.dobVerifications[pilotId] = {
                pilotName: pilotName,
                dateOfBirth: dateOfBirth,
                verifiedDate: new Date().toISOString()
            };
            localStorage.setItem('pilot_verifications', JSON.stringify(localData));
            console.log('DOB verification saved to localStorage (fallback)');
        }

        async function loadVerificationsFromDatabase() {
            if (db) {
                try {
                    // Load PIC hours verifications
                    const picSnapshot = await db.collection('pilot_verifications').get();
                    const picVerifications = {};
                    picSnapshot.forEach(doc => {
                        const data = doc.data();
                        picVerifications[doc.id] = {
                            pilotName: data.pilotName,
                            picHours: data.picHours,
                            verifiedDate: data.verifiedDate,
                            eligible: data.eligible,
                            dataSource: data.dataSource || 'user-entered' // Default to user-entered for backward compatibility
                        };
                    });

                    // Load DOB verifications
                    const dobSnapshot = await db.collection('dob_verifications').get();
                    const dobVerifications = {};
                    dobSnapshot.forEach(doc => {
                        const data = doc.data();
                        dobVerifications[doc.id] = {
                            pilotName: data.pilotName,
                            dateOfBirth: data.dateOfBirth,
                            verifiedDate: data.verifiedDate,
                            dataSource: data.dataSource || 'user-entered' // Default to user-entered for backward compatibility
                        };
                    });

                    // Merge with embedded data and update pilotVerifications
                    pilotVerifications.picHoursVerifications = {
                        ...pilotVerifications.picHoursVerifications,
                        ...picVerifications
                    };
                    pilotVerifications.dobVerifications = {
                        ...pilotVerifications.dobVerifications,
                        ...dobVerifications
                    };

                    console.log(\`Loaded \${Object.keys(picVerifications).length} PIC hour verifications from Firebase\`);
                    console.log(\`Loaded \${Object.keys(dobVerifications).length} DOB verifications from Firebase\`);
                    return;
                } catch (error) {
                    console.error('Failed to load verifications from Firebase:', error);
                }
            }

            // Fallback to localStorage
            const localData = localStorage.getItem('pilot_verifications');
            if (localData) {
                try {
                    const parsed = JSON.parse(localData);

                    if (parsed.picHoursVerifications) {
                        pilotVerifications.picHoursVerifications = {
                            ...pilotVerifications.picHoursVerifications,
                            ...parsed.picHoursVerifications
                        };
                        console.log(\`Loaded \${Object.keys(parsed.picHoursVerifications).length} PIC hour verifications from localStorage\`);
                    }

                    if (parsed.dobVerifications) {
                        pilotVerifications.dobVerifications = {
                            ...pilotVerifications.dobVerifications,
                            ...parsed.dobVerifications
                        };
                        console.log(\`Loaded \${Object.keys(parsed.dobVerifications).length} DOB verifications from localStorage\`);
                    }

                    // Handle old format for backward compatibility
                    if (parsed.verifications && !parsed.picHoursVerifications) {
                        pilotVerifications.picHoursVerifications = {
                            ...pilotVerifications.picHoursVerifications,
                            ...parsed.verifications
                        };
                        console.log(\`Migrated \${Object.keys(parsed.verifications).length} old format verifications\`);
                    }
                } catch (e) {
                    console.warn('Failed to parse localStorage verification data:', e);
                }
            }
        }

        document.addEventListener('DOMContentLoaded', async function() {
            // Initialize Firebase
            await initializeFirebase();

            // Load verification data from database
            await loadVerificationsFromDatabase();

            await loadLeaderboard();
            calculateTrophyWinners();
            calculateTaskTypeStats();

            document.getElementById('combinedBtn').addEventListener('click', () => switchScoringMode('mixed'));
            document.getElementById('freeBtn').addEventListener('click', () => switchScoringMode('free'));
            const sprintBtn = document.getElementById('sprintBtn');
            if (sprintBtn) sprintBtn.addEventListener('click', () => switchScoringMode('sprint'));
            const triangleBtn = document.getElementById('triangleBtn');
            if (triangleBtn) triangleBtn.addEventListener('click', () => switchScoringMode('triangle'));
            const outReturnBtn = document.getElementById('outReturnBtn');
            if (outReturnBtn) outReturnBtn.addEventListener('click', () => switchScoringMode('out_return'));
            const outBtn = document.getElementById('outBtn');
            if (outBtn) outBtn.addEventListener('click', () => switchScoringMode('out'));

            // Initialize tooltips
            addTooltipListeners();

            // Check for mass Firebase sync URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('sync_firebase') === 'true' && db) {
                console.log('🔄 Mass Firebase sync triggered by URL parameter...');
                setTimeout(() => {
                    massFirebaseSync();
                }, 2000); // Give Firebase extra time to initialize
            }

            const underBtn = document.getElementById('under200Btn');
            if (underBtn) {
                underBtn.addEventListener('click', () => {
                    // If currently viewing Silver C-Gull candidates, switch back to default view
                    if (leaderboard === silverCGullLeaderboard) {
                        switchScoringMode('mixed'); // Switch back to default mixed view
                    }

                    under200Enabled = !under200Enabled;
                    underBtn.classList.toggle('active', under200Enabled);
                    updateUnder200ButtonLabel();
                    buildLeaderboard();
                    // Re-add tooltip listeners after under 200 filter toggle
                    setTimeout(() => {
                        if (typeof addTooltipListeners === 'function') addTooltipListeners();
                            }, 0);
                    // No need to recalculate trophies - 200 Trophy is always <200 list
                });
                updateUnder200ButtonLabel();
            }

            // Search overlay functionality
            let searchMatches = [];
            let currentMatchIndex = -1;

            const searchOverlay = document.getElementById('searchOverlay');
            const searchInput = document.getElementById('searchInput');
            const nextBtn = document.getElementById('nextBtn');
            const closeBtn = document.getElementById('closeBtn');
            const searchStatus = document.getElementById('searchStatus');
            const openSearchBtn = document.getElementById('openSearchBtn');

            function highlightMatches(query) {
                // Clear previous highlights
                clearHighlights();
                searchMatches = [];

                if (!query) return;

                const leaderboardTable = document.querySelector('.leaderboard tbody');
                if (!leaderboardTable) return;

                const rows = leaderboardTable.querySelectorAll('tr');
                const regex = new RegExp(query, 'gi');

                rows.forEach((row, rowIndex) => {
                    const pilotCell = row.querySelector('td:nth-child(2)'); // Pilot name column
                    if (pilotCell) {
                        // Look for the pilot link first (this preserves the structure)
                        const pilotLink = pilotCell.querySelector('a.pilot-link');

                        if (pilotLink && pilotLink.textContent.match(regex)) {
                            searchMatches.push({ row, cell: pilotCell, rowIndex });

                            // Store original HTML to restore later
                            if (!pilotCell.dataset.originalHtml) {
                                pilotCell.dataset.originalHtml = pilotCell.innerHTML;
                            }

                            // Only highlight within the pilot link, preserving the link structure
                            const originalText = pilotLink.textContent;
                            const highlightedText = originalText.replace(regex, '<mark class="search-highlight">$&</mark>');
                            pilotLink.innerHTML = highlightedText;
                        } else if (!pilotLink && pilotCell.textContent.match(regex)) {
                            // Fallback for cells without pilot links
                            searchMatches.push({ row, cell: pilotCell, rowIndex });

                            // Store original HTML to restore later
                            if (!pilotCell.dataset.originalHtml) {
                                pilotCell.dataset.originalHtml = pilotCell.innerHTML;
                            }

                            const originalText = pilotCell.textContent;
                            const highlightedText = originalText.replace(regex, '<mark class="search-highlight">$&</mark>');
                            pilotCell.innerHTML = highlightedText;
                        }
                    }
                });

                updateSearchStatus();
            }

            function clearHighlights() {
                // Restore original HTML for cells that were modified during search
                const leaderboardTable = document.querySelector('.leaderboard tbody');
                if (leaderboardTable) {
                    const modifiedCells = leaderboardTable.querySelectorAll('td[data-original-html]');
                    modifiedCells.forEach(cell => {
                        cell.innerHTML = cell.dataset.originalHtml;
                        delete cell.dataset.originalHtml;
                    });
                }

                // Fallback: clear any remaining highlights
                const highlights = document.querySelectorAll('.search-highlight');
                highlights.forEach(highlight => {
                    const parent = highlight.parentNode;
                    parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
                    parent.normalize();
                });

                // Clear current match highlighting
                const currentHighlights = document.querySelectorAll('.search-current');
                currentHighlights.forEach(el => el.classList.remove('search-current'));
            }

            function updateSearchStatus() {
                if (searchMatches.length === 0) {
                    searchStatus.textContent = searchInput.value ? 'No matches found' : '';
                    nextBtn.disabled = true;
                } else {
                    if (currentMatchIndex === -1) {
                        searchStatus.textContent = searchMatches.length + ' matches found';
                    } else {
                        searchStatus.textContent = (currentMatchIndex + 1) + ' of ' + searchMatches.length;
                    }
                    nextBtn.disabled = false;
                }
            }

            function goToNextMatch() {
                if (searchMatches.length === 0) return;

                // Clear current match highlighting
                const currentHighlights = document.querySelectorAll('.search-current');
                currentHighlights.forEach(el => el.classList.remove('search-current'));

                // Move to next match (cycle through)
                currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
                const match = searchMatches[currentMatchIndex];

                // Highlight current match
                const highlight = match.cell.querySelector('.search-highlight');
                if (highlight) {
                    highlight.classList.add('search-current');
                }

                // Scroll to match
                match.row.scrollIntoView({ behavior: 'smooth', block: 'center' });

                updateSearchStatus();
            }

            function openSearch() {
                searchOverlay.style.display = 'flex';
                searchInput.focus();
            }

            function closeSearch() {
                searchOverlay.style.display = 'none';
                clearHighlights();
                searchInput.value = '';
                searchMatches = [];
                currentMatchIndex = -1;
                updateSearchStatus();
            }

            // Event listeners for search
            if (openSearchBtn) {
                openSearchBtn.addEventListener('click', openSearch);
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', closeSearch);
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', goToNextMatch);
            }

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.trim();
                    currentMatchIndex = -1;
                    highlightMatches(query);

                    // Auto-jump to first match if there's only one
                    if (searchMatches.length === 1) {
                        goToNextMatch();
                    }
                });

                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (searchMatches.length > 0) {
                            goToNextMatch();
                        }
                    } else if (e.key === 'Escape') {
                        closeSearch();
                    }
                });
            }

            // Close on overlay click
            if (searchOverlay) {
                searchOverlay.addEventListener('click', (e) => {
                    if (e.target === searchOverlay) {
                        closeSearch();
                    }
                });
            }
        });
        </script>`
        .replace('__PILOT_DURATIONS_PLACEHOLDER__', JSON.stringify(pilotDurationsEmbedded));

        australianHTML = australianHTML.substring(0, scriptStart) +
                        newScriptContent +
                        australianHTML.substring(scriptEnd);

        // Inject embedded pilot durations JSON into the script
        australianHTML = australianHTML.replace('__PILOT_DURATIONS_PLACEHOLDER__', JSON.stringify(pilotDurationsEmbedded));

        // Inject embedded pilot verification data into the script
        australianHTML = australianHTML.replace('__PILOT_VERIFICATIONS_PLACEHOLDER__', JSON.stringify(pilotVerificationData));

        // Inject embedded pilot profiles data into the script
        australianHTML = australianHTML.replace('__PILOT_PROFILES_PLACEHOLDER__', JSON.stringify(pilotProfilesEmbedded));

        // Remove Canadian-specific under-table filter bar to avoid duplicate buttons
        australianHTML = australianHTML.replace(/<div class="scoring-toggle" id="filtersBar"[\s\S]*?<\/div>\s*/g, '');

        // Add scoring toggle buttons and trophy section after the stats section
        australianHTML = australianHTML.replace(
            /(<div class="stats">.*?<\/div>\s*)<\/div>/s,
            '$1</div><div class="scoring-toggle">\n                    <div class="primary-toggle-row">\n                        <button class="toggle-btn active" id="combinedBtn">Combined Scoring</button>\n                        <button class="toggle-btn" id="freeBtn">Free Only</button>\n                        <button class="filter-btn" id="under200Btn">⚬ < 200 hrs PIC</button>\n                        <button class="find-btn" id="openSearchBtn" title="Find pilot">🔍 Find</button>\n                    </div>\n                    <div class="secondary-toggle-row">\n                        <span class="secondary-toggle-label">Contest views:</span>\n                        <button class="toggle-btn secondary" id="sprintBtn">Sprint</button>\n                        <button class="toggle-btn secondary" id="triangleBtn">Triangle</button>\n                        <button class="toggle-btn secondary" id="outReturnBtn">Out &amp; Return</button>\n                        <button class="toggle-btn secondary" id="outBtn">Out</button>\n                    </div>\n                </div><div id="searchOverlay" class="search-overlay" style="display: none;"><div class="search-widget"><input type="text" id="searchInput" placeholder="Find pilot..." autocomplete="off"><button id="nextBtn">Next</button><button id="closeBtn">✕</button><div id="searchStatus"></div></div></div><div class="trophy-section"><div class="trophy-header" onclick="toggleTrophySection()"><h3>🏆 Trophy Standings (YTD - unofficial) <span class="toggle-arrow" id="trophyArrow">▶</span></h3></div><div class="trophy-content" id="trophyContent" style="display: none;"><div id="trophyWinners">Loading trophy winners...</div></div></div><div class="task-stats-section"><div class="task-stats-header" onclick="toggleTaskStatsSection()"><h5>📊 Task Type Statistics <span class="toggle-arrow" id="taskStatsArrow">▶</span></h5></div><div class="task-stats-content" id="taskStatsContent" style="display: none;"><div class="task-stats-table-wrapper"><table class="task-stats-table"><thead><tr><th>Task Type</th><th>Description</th><th>Total</th><th>Finished</th><th>IGC Task</th><th>IGC Completed</th><th>WeGlide Task</th><th>WeGlide Completed</th></tr></thead><tbody id="taskStatsTableBody"></tbody></table></div></div></div><p class="mock-notice">(Mock leaderboard using Australian data for demonstration purposes.)</p>'
        );

        // Add CSS for toggle buttons and award badges
        const toggleCSS = `
        /* Scoring toggle buttons */
        .scoring-toggle {
            margin: 20px 0;
            display: flex;
            gap: 10px;
            justify-content: center;
            align-items: center;
            padding: 0 20px;
            flex-wrap: wrap;
        }

        .primary-toggle-row,
        .secondary-toggle-row {
            display: flex;
            gap: 10px;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
        }

        .secondary-toggle-row {
            margin-top: 6px;
            font-size: 0.85em;
        }

        .secondary-toggle-label {
            font-weight: 600;
            color: rgba(255, 255, 255, 0.85);
            margin-right: 6px;
        }

        .toggle-btn.secondary {
            padding: 4px 10px;
            font-size: 0.85em;
            border-width: 1px;
            opacity: 0.85;
            color: rgba(255, 255, 255, 0.9);
            border-color: rgba(255, 255, 255, 0.5);
        }

        .toggle-btn.secondary.active {
            opacity: 1;
            border-color: rgba(255, 255, 255, 0.85);
        }

        /* Find button */
        .find-btn {
            padding: 8px 16px;
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(40, 167, 69, 0.3);
        }

        .find-btn:hover {
            background: linear-gradient(135deg, #218838, #1ea080);
            box-shadow: 0 3px 6px rgba(40, 167, 69, 0.4);
            transform: translateY(-1px);
        }

        /* Floating search overlay */
        .search-overlay {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        }

        .search-widget {
            background: white;
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            border: 1px solid #e0e0e0;
            padding: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 300px;
        }

        #searchInput {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            outline: none;
        }

        #searchInput:focus {
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.2);
        }

        #nextBtn {
            padding: 8px 12px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }

        #nextBtn:hover:not(:disabled) {
            background: #0056b3;
        }

        #nextBtn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }

        #closeBtn {
            padding: 8px 10px;
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            line-height: 1;
        }

        #closeBtn:hover {
            background: #c82333;
        }

        #searchStatus {
            position: absolute;
            top: -25px;
            right: 0;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
        }

        /* Search highlight */
        .search-highlight {
            background: #ffeb3b !important;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 4px;
        }

        .search-current {
            background: #ff5722 !important;
            color: white;
        }

        /* Pilot profile tooltips */
        .pilot-tooltip {
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 0;
            min-width: 300px;
            max-width: 400px;
            font-size: 13px;
            line-height: 1.4;
            position: relative;
        }

        .pilot-tooltip-close {
            position: absolute;
            top: 10px;
            right: 12px;
            border: none;
            background: transparent;
            color: #888;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }

        .pilot-tooltip-close:hover {
            color: #333;
        }

        .pilot-tooltip-header {
            background: #f8f9fa;
            padding: 12px 15px;
            border-bottom: 1px solid #dee2e6;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pilot-tooltip-header h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: #333;
        }

        .weglide-profile-link {
            font-size: 11px;
            color: #007bff;
            text-decoration: none;
            font-weight: 500;
        }

        .weglide-profile-link:hover {
            text-decoration: underline;
        }

        .pilot-stats-section {
            padding: 12px 15px;
        }

        .pilot-stats-section:not(:last-child) {
            border-bottom: 1px solid #f1f3f4;
        }

        .pilot-stats-section h5 {
            margin: 0 0 8px 0;
            font-size: 12px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .pilot-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 12px;
        }

        .pilot-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pilot-stat .stat-label {
            font-size: 11px;
            color: #666;
            font-weight: 500;
        }

        .pilot-stat .stat-value {
            font-size: 12px;
            font-weight: 600;
            color: #333;
        }

        /* Mobile responsive pilot tooltips */
        @media (max-width: 768px) {
            .pilot-tooltip {
                min-width: 280px;
                max-width: 320px;
                font-size: 12px;
            }

            .pilot-stats-grid {
                grid-template-columns: 1fr;
                gap: 6px;
            }

            .pilot-tooltip-header {
                padding: 10px 12px;
            }

            .pilot-stats-section {
                padding: 10px 12px;
            }
        }

        .pilot-highlight {
            background: #ffeb3b !important;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 4px;
        }

        .pilot-current {
            background: #ff5722 !important;
            color: white !important;
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

        /* Filter button - visually distinct from scoring buttons */
        .filter-btn {
            padding: 8px 16px;
            border: 2px solid rgba(255,193,7,0.5);
            background: rgba(255,193,7,0.1);
            color: #ffc107;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
            font-weight: 500;
            position: relative;
        }

        .filter-btn::before {
            content: "🔍";
            margin-right: 6px;
            font-size: 0.8em;
        }

        .filter-btn:hover {
            background: rgba(255,193,7,0.2);
            border-color: rgba(255,193,7,0.7);
        }

        .filter-btn.active {
            background: rgba(255,193,7,0.9);
            color: #333;
            border-color: rgba(255,193,7,0.9);
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

        .task-score-section {
            margin-top: 16px;
            background: rgba(44, 90, 160, 0.15);
            border: 1px solid rgba(44, 90, 160, 0.3);
            border-radius: 8px;
            padding: 12px;
        }

        .task-score-header {
            font-weight: 600;
            font-size: 0.95em;
            margin-bottom: 8px;
            color: #f1f5ff;
        }

        .task-score-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 8px 12px;
            margin-bottom: 10px;
        }

        .task-score-item {
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.15);
            border-radius: 6px;
            padding: 8px;
        }

        .task-score-label {
            font-size: 0.75em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: rgba(255, 255, 255, 0.6);
        }

        .task-score-value {
            font-size: 0.95em;
            font-weight: 600;
            color: #ffffff;
        }

        .task-score-table {
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 10px;
            display: grid;
            gap: 6px;
        }

        .task-score-row {
            display: grid;
            grid-template-columns: 1fr auto 24px;
            align-items: center;
            font-size: 0.9em;
        }

        .score-label {
            color: rgba(255, 255, 255, 0.8);
        }

        .score-value {
            font-weight: 600;
            text-align: right;
        }

        .score-check {
            text-align: center;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.4);
        }

        .score-check.active {
            color: #4caf50;
        }

        .score-check.score-cross {
            color: #f44336;
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

        /* Scoring tooltips */
        .scoring-tooltip {
            text-decoration: underline;
            text-decoration-style: dotted;
            cursor: help;
            position: relative;
            touch-action: manipulation;
        }

        .custom-tooltip {
            position: absolute;
            background: #000000;
            color: #ffffff;
            padding: 16px 20px;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.5;
            min-width: 300px;
            max-width: 450px;
            box-shadow: 0 6px 20px rgba(0,0,0,1);
            z-index: 10000;
            border: 3px solid #ffffff;
            font-weight: 400;
            pointer-events: auto;
            white-space: pre-line;
        }

        .custom-tooltip .tooltip-content {
            margin-bottom: 0;
            padding-right: 20px;
        }

        .custom-tooltip .tooltip-close {
            position: absolute;
            top: 8px;
            right: 8px;
            background: transparent;
            border: none;
            color: #ffffff;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.2s;
            display: none;
        }

        .custom-tooltip .tooltip-close:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.1);
        }

        .custom-tooltip::before {
            content: '';
            position: absolute;
            top: -11px;
            left: 50%;
            transform: translateX(-50%);
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 8px solid #000000;
        }

        .custom-tooltip.tooltip-above::before {
            top: auto;
            bottom: -11px;
            border-bottom: none;
            border-top: 8px solid #000000;
        }

        /* Mobile-specific styles */
        @media (max-width: 768px) {
            .custom-tooltip {
                min-width: 280px;
                max-width: calc(100vw - 40px);
                font-size: 13px;
                padding: 14px 16px 14px 16px;
            }

            .custom-tooltip .tooltip-close {
                display: block;
            }

            .scoring-tooltip {
                padding: 2px 0;
            }
        }

        @media (max-width: 480px) {
            .custom-tooltip {
                min-width: 260px;
                max-width: calc(100vw - 20px);
                font-size: 12px;
                padding: 12px 14px 12px 14px;
            }
        }

        /* PIC Hours Verification System */
        .unverified-row {
            background-color: rgba(128, 128, 128, 0.1) !important;
            opacity: 0.8;
        }

        .verified-row {
            background-color: rgba(255, 255, 255, 0.95);
        }

        .verification-badge {
            font-size: 0.65em;
            padding: 1px 4px;
            border-radius: 2px;
            margin-top: 2px;
            font-weight: normal;
            display: block;
            opacity: 0.8;
        }

        .verification-badge.verified {
            background-color: #28a745;
            color: white;
        }

        .verify-btn {
            font-size: 0.65em;
            padding: 2px 6px;
            margin-top: 2px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-weight: normal;
        }

        .verify-btn.unverified {
            background-color: #dc3545;
            color: white;
        }

        .verify-btn.unverified:hover {
            background-color: #c82333;
        }

        .verify-btn.small {
            font-size: 0.6em;
            padding: 1px 4px;
        }

        .verification-status {
            font-size: 0.65em;
            padding: 1px 4px;
            border-radius: 2px;
            font-weight: normal;
            opacity: 0.8;
            display: block;
            margin-top: 2px;
        }

        .verification-status.verified {
            background-color: #28a745;
            color: white;
        }

        .unverified-leaders {
            margin-top: 8px;
            padding: 6px 8px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 3px;
            border-left: 2px solid rgba(220, 53, 69, 0.6);
            opacity: 0.85;
        }

        .unverified-pilot {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .unverified-pilot:last-child {
            border-bottom: none;
        }

        /* Verification Form Overlay */
        .verification-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .verification-form {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 90%;
            text-align: center;
        }

        .verification-form h3 {
            margin-top: 0;
            color: #333;
        }

        .verification-form p {
            color: #666;
            line-height: 1.5;
            margin: 15px 0;
        }

        .verification-form input[type="number"] {
            width: 100px;
            padding: 8px;
            font-size: 16px;
            border: 2px solid #ddd;
            border-radius: 5px;
            text-align: center;
            margin: 10px;
        }

        .verification-form .form-buttons {
            margin-top: 20px;
        }

        .verification-form button {
            padding: 10px 20px;
            margin: 5px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        }

        .verification-form .submit-btn {
            background-color: #28a745;
            color: white;
        }

        .verification-form .submit-btn:hover {
            background-color: #218838;
        }

        .verification-form .cancel-btn {
            background-color: #6c757d;
            color: white;
        }

        .verification-form .cancel-btn:hover {
            background-color: #5a6268;
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
            color: #aaa;
            font-size: 0.65em;
            margin: 4px 0 0 0;
            font-style: italic;
            opacity: 0.8;
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

        /* Table wrapper for horizontal scrolling on mobile */
        .task-stats-table-wrapper {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 0;
            border-radius: 4px;
            border: 1px solid #dee2e6;
        }

        .task-stats-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8em;
            min-width: 650px; /* Ensure minimum width to prevent crushing */
            border: none; /* Remove border since wrapper has it */
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
            .task-stats-table {
                font-size: 0.7em;
                min-width: 600px; /* Slightly smaller on mobile */
            }

            .task-stats-content {
                padding: 8px 10px;
            }

            .task-stats-table-wrapper {
                /* Add scrollbar hint on mobile */
                border-left: 3px solid #007bff;
            }

            .task-stats-table-wrapper::after {
                content: "← Scroll for more →";
                display: block;
                text-align: center;
                font-size: 0.65em;
                color: #6c757d;
                padding: 4px;
                background: #f8f9fa;
                border-top: 1px solid #dee2e6;
                font-style: italic;
            }
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
        }

        .mock-notice {
            font-size: 0.85em;
            color: rgba(255, 255, 255, 0.85);
            text-align: center;
            margin: 12px 0 0;
        }

        .mock-notice {
            font-size: 0.85em;
            color: rgba(255, 255, 255, 0.8);
        }

        #leaderboardTable.three-flight-mode th:nth-child(7),
        #leaderboardTable.three-flight-mode th:nth-child(8),
        #leaderboardTable.three-flight-mode td:nth-child(7),
        #leaderboardTable.three-flight-mode td:nth-child(8) {
            display: none;
        }`;

        australianHTML = australianHTML.replace('</style>', toggleCSS + '\n    </style>');


        // Write the Australian leaderboard HTML
        fs.writeFileSync('SAC_leaderboard.html', australianHTML);

        fs.writeFileSync('australian_leaderboard.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0; url=./SAC_leaderboard.html" />
  <title>Redirecting…</title>
</head>
<body>
  <p>Redirecting to <a href="./SAC_leaderboard.html">SAC Leaderboard</a>…</p>
</body>
</html>`);

        console.log('✅ Created SAC_leaderboard.html and redirecting australian_leaderboard.html');

        // Run server-side WeGlide verification calculation
        console.log('🔄 Running WeGlide verification calculations...');

        // Server-side WeGlide verification calculation function
        async function runServerSideVerificationCalculations() {
            const startDate = new Date('2024-10-01');
            let calculatedCount = 0;
            let updatedCount = 0;

            // Initialize verification data if not exists
            if (!pilotVerificationData.picHoursVerifications) {
                pilotVerificationData.picHoursVerifications = {};
            }

            // Process all pilots from mixed leaderboard (most comprehensive)
            for (const pilot of mixedLeaderboard) {
                const pilotId = pilot.pilotId;
                const existingVerification = pilotVerificationData.picHoursVerifications[pilotId];

                // Skip if user has already entered data (never overwrite user data)
                if (existingVerification && existingVerification.dataSource === 'user-entered') {
                    continue;
                }

                // Calculate WeGlide hours since Oct 1, 2024
                let hoursSinceStart = 0;
                if (pilot.bestFlights) {
                    pilot.bestFlights.forEach(flight => {
                        if (flight.date && new Date(flight.date) >= startDate) {
                            if (flight.distance && flight.speed) {
                                hoursSinceStart += flight.distance / flight.speed;
                            }
                        }
                    });
                }

                // Get total WeGlide hours for this pilot
                const totalWeGlideHours = pilotDurationsEmbedded[pilotId] ?
                    (pilotDurationsEmbedded[pilotId] / 3600) : 0;

                const estimatedOct1Hours = Math.max(0, totalWeGlideHours - hoursSinceStart);

                // Only process if we have meaningful WeGlide data
                if (totalWeGlideHours > 0) {
                    calculatedCount++;

                    // Update or create verification entry (only if no user data exists)
                    pilotVerificationData.picHoursVerifications[pilotId] = {
                        pilotName: pilot.pilot,
                        picHours: parseFloat(estimatedOct1Hours.toFixed(1)),
                        verifiedDate: new Date().toISOString(),
                        dataSource: 'weglide-calculated',
                        eligible: estimatedOct1Hours < 200,
                        calculation: {
                            totalWeGlideHours: parseFloat(totalWeGlideHours.toFixed(1)),
                            hoursSinceOct1: parseFloat(hoursSinceStart.toFixed(1)),
                            estimatedOct1Hours: parseFloat(estimatedOct1Hours.toFixed(1))
                        }
                    };
                    updatedCount++;
                }
            }

            // Save updated verification data back to file
            if (updatedCount > 0) {
                try {
                    fs.writeFileSync('pilot_pic_hours_verification.json',
                        JSON.stringify(pilotVerificationData, null, 2));
                    console.log(`✅ Updated ${updatedCount}/${calculatedCount} pilot verifications with WeGlide data`);

                } catch (error) {
                    console.error('❌ Failed to save verification calculations:', error);
                }
            } else {
                console.log('ℹ️ No verification updates needed');
            }

        }

        await runServerSideVerificationCalculations();
        console.log(`📊 Top 10 pilots (Mixed Scoring):`);
        mixedLeaderboard.slice(0, 10).forEach((pilot, index) => {
            console.log(`${index + 1}. ${pilot.pilot}: ${pilot.totalPoints.toFixed(1)} points (${pilot.flightCount} flights, ${pilot.totalDistance.toFixed(0)} km)`);
        });

    } catch (error) {
        console.error('❌ Error processing flights:', error.message);
    }
}


processAustralianFlights();
