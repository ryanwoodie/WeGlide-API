const fs = require('fs');
const readline = require('readline');

async function debugGoalCalculation() {
    const flightData = [];

    const fileStream = fs.createReadStream('/Users/ryanwood/GitHub/WeGlide-API/australian_flights_2025_details.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.trim().length > 0) {
            try {
                const flight = JSON.parse(line);
                if (flight.task && flight.task.kind === 'GL') {
                    flightData.push(flight);
                }
            } catch (e) {}
        }
    }

    console.log('Debugging Goal flight calculation...');

    let bestFlight = null;
    let bestScore = 0;

    flightData.forEach(flight => {
        if (!flight.contest || !Array.isArray(flight.contest)) return;

        let contestToUse = null;
        let scoreToUse = 0;

        const auContest = flight.contest.find(c => c.name === 'au' && c.points > 0);
        const declarationContest = flight.contest.find(c => c.name === 'declaration' && c.points > 0);

        if (auContest && auContest.score && auContest.score.declared) {
            contestToUse = auContest;
            scoreToUse = auContest.points;
        } else if (declarationContest && declarationContest.score && declarationContest.score.declared) {
            contestToUse = declarationContest;
            scoreToUse = declarationContest.points;
        }

        if (contestToUse && scoreToUse > bestScore) {
            bestScore = scoreToUse;
            console.log('New best goal flight:');
            console.log('  ID:', flight.id);
            console.log('  Pilot:', flight.user?.name);
            console.log('  Points:', scoreToUse);
            console.log('  Distance from contest:', contestToUse.distance);
            console.log('  Speed from contest:', contestToUse.speed);
            console.log('  TaskName from flight:', flight.task?.name);
            console.log('  Contest Type:', contestToUse.name);

            bestFlight = {
                id: flight.id,
                distance: contestToUse.distance,
                speed: contestToUse.speed,
                taskName: flight.task?.name
            };
        }
    });

    console.log('');
    console.log('Final result for display logic:');
    console.log('Distance:', bestFlight?.distance);
    console.log('Speed:', bestFlight?.speed);
    console.log('TaskName:', bestFlight?.taskName);

    const distanceText = bestFlight?.distance ? `${bestFlight.distance.toFixed(1)} km` : '';
    const speedText = bestFlight?.speed ? `${bestFlight.speed.toFixed(1)} km/h` : '';
    const taskDisplay = bestFlight?.taskName ||
        (distanceText && speedText ? `${distanceText} at ${speedText}` :
         distanceText ? distanceText :
         speedText ? speedText : 'Unnamed Task');

    console.log('Final display text:', taskDisplay);
}

debugGoalCalculation().catch(console.error);