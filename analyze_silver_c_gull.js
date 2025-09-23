const fs = require('fs');
const readline = require('readline');

async function analyzeSilverCGull() {
    const fileStream = fs.createReadStream('/Users/ryanwood/GitHub/WeGlide-API/australian_flights_2025_details.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const silverBadgeJuniors = [];
    const stats = {
        totalFlights: 0,
        totalJuniors: 0,
        totalSilverBadges: 0,
        juniorSilverBadges: 0
    };

    for await (const line of rl) {
        if (line.trim().length > 0) {
            try {
                const flight = JSON.parse(line);
                stats.totalFlights++;

                if (flight.junior) {
                    stats.totalJuniors++;
                }

                // Check for silver badge achievement
                if (flight.achievement && Array.isArray(flight.achievement)) {
                    const silverBadge = flight.achievement.find(a => a.badge_id === 'silver');
                    if (silverBadge) {
                        stats.totalSilverBadges++;

                        if (flight.junior) {
                            stats.juniorSilverBadges++;

                            // Check if we already have this pilot
                            const existingPilot = silverBadgeJuniors.find(p => p.userId === flight.user.id);
                            if (!existingPilot) {
                                silverBadgeJuniors.push({
                                    userId: flight.user.id,
                                    pilotName: flight.user.name,
                                    flightId: flight.id,
                                    flightDate: flight.scoring_date,
                                    distance: getBestDistance(flight),
                                    duration: formatDuration(flight.total_seconds),
                                    points: getBestPoints(flight),
                                    takeoffAirport: flight.takeoff_airport?.name,
                                    club: flight.club?.name
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                // Skip invalid JSON lines
            }
        }
    }

    console.log('========================================');
    console.log('SILVER C-GULL TROPHY ANALYSIS');
    console.log('========================================');
    console.log(`Total flights: ${stats.totalFlights}`);
    console.log(`Total junior flights: ${stats.totalJuniors}`);
    console.log(`Total silver badge achievements: ${stats.totalSilverBadges}`);
    console.log(`Junior silver badge achievements: ${stats.juniorSilverBadges}`);
    console.log('');
    console.log('JUNIOR PILOTS WITH SILVER BADGE:');
    console.log('=================================');

    // Sort by pilot name
    silverBadgeJuniors.sort((a, b) => a.pilotName.localeCompare(b.pilotName));

    silverBadgeJuniors.forEach((pilot, index) => {
        console.log(`${index + 1}. ${pilot.pilotName}`);
        console.log(`   Flight ID: ${pilot.flightId}`);
        console.log(`   Date: ${pilot.flightDate}`);
        console.log(`   Distance: ${pilot.distance}`);
        console.log(`   Duration: ${pilot.duration}`);
        console.log(`   Points: ${pilot.points}`);
        console.log(`   Airport: ${pilot.takeoffAirport || 'Unknown'}`);
        console.log(`   Club: ${pilot.club || 'Unknown'}`);
        console.log('');
    });

    return silverBadgeJuniors;
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

analyzeSilverCGull().catch(console.error);