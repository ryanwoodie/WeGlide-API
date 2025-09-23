const fs = require('fs');
const readline = require('readline');

async function findCompletionDiscrepancies() {
    const discrepancies = [];
    let totalAnalyzed = 0;
    let taskAchievedTrue = 0;
    let contestBasedTrue = 0;
    let bothTrue = 0;

    const fileStream = fs.createReadStream('/Users/ryanwood/GitHub/WeGlide-API/australian_flights_2025_details.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.trim().length > 0) {
            try {
                const flight = JSON.parse(line);

                if (flight.task) {
                    totalAnalyzed++;

                    // Method 1: task_achieved === true (main stats method)
                    const method1 = flight.task_achieved === true;

                    // Method 2: contest-based (old task type stats method)
                    const method2 = flight.contest && flight.contest.some(c =>
                        (c.name === 'au' || c.name === 'declaration') && c.score && c.score.declared
                    );

                    if (method1) taskAchievedTrue++;
                    if (method2) contestBasedTrue++;
                    if (method1 && method2) bothTrue++;

                    // Find discrepancies
                    if (method1 !== method2) {
                        discrepancies.push({
                            flightId: flight.id,
                            pilotName: flight.user?.name,
                            taskType: flight.task?.kind,
                            taskAchieved: flight.task_achieved,
                            method1Result: method1,
                            method2Result: method2,
                            hasContests: !!flight.contest,
                            contestTypes: flight.contest ? flight.contest.map(c => c.name) : [],
                            contestWithDeclaration: flight.contest ? flight.contest.filter(c =>
                                (c.name === 'au' || c.name === 'declaration') && c.score && c.score.declared
                            ).map(c => ({name: c.name, points: c.points, declared: c.score?.declared})) : [],
                            fullFlightData: flight
                        });
                    }
                }
            } catch (e) {
                // Skip invalid JSON
            }
        }
    }

    console.log('=== COMPLETION METHOD COMPARISON ===');
    console.log(`Total flights with tasks analyzed: ${totalAnalyzed}`);
    console.log(`Method 1 (task_achieved === true): ${taskAchievedTrue}`);
    console.log(`Method 2 (contest-based): ${contestBasedTrue}`);
    console.log(`Both methods agree (true): ${bothTrue}`);
    console.log(`Discrepancies found: ${discrepancies.length}`);
    console.log('');

    // Show first few examples
    console.log('=== EXAMPLE DISCREPANCIES ===');
    discrepancies.slice(0, 5).forEach((disc, index) => {
        console.log(`${index + 1}. Flight ${disc.flightId} (${disc.pilotName})`);
        console.log(`   Task Type: ${disc.taskType}`);
        console.log(`   task_achieved: ${disc.taskAchieved}`);
        console.log(`   Method 1 (task_achieved): ${disc.method1Result}`);
        console.log(`   Method 2 (contest-based): ${disc.method2Result}`);
        console.log(`   Contest types: ${disc.contestTypes.join(', ')}`);
        console.log(`   Declared contests: ${JSON.stringify(disc.contestWithDeclaration)}`);
        console.log('');
    });

    // Save detailed data for first discrepancy
    if (discrepancies.length > 0) {
        const firstExample = discrepancies[0];
        fs.writeFileSync('completion_discrepancy_example.json', JSON.stringify(firstExample.fullFlightData, null, 2));
        console.log(`Saved detailed flight data to completion_discrepancy_example.json`);
        console.log(`Example flight: ${firstExample.flightId} by ${firstExample.pilotName}`);
    }

    // Save summary
    const summary = {
        totalAnalyzed,
        taskAchievedTrue,
        contestBasedTrue,
        bothTrue,
        discrepancyCount: discrepancies.length,
        discrepancyExamples: discrepancies.slice(0, 10).map(d => ({
            flightId: d.flightId,
            pilotName: d.pilotName,
            taskType: d.taskType,
            taskAchieved: d.taskAchieved,
            method1: d.method1Result,
            method2: d.method2Result,
            contestTypes: d.contestTypes,
            declaredContests: d.contestWithDeclaration
        }))
    };

    fs.writeFileSync('completion_methods_comparison.json', JSON.stringify(summary, null, 2));
    console.log('Saved comparison summary to completion_methods_comparison.json');
}

findCompletionDiscrepancies().catch(console.error);