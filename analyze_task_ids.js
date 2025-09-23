const fs = require('fs');
const readline = require('readline');

async function analyzeTaskIds() {
    let totalFlights = 0;
    let flightsWithTasks = 0;
    let flightsWithTaskIds = 0;
    let flightsWithTasksButNoIds = 0;

    const fileStream = fs.createReadStream('australian_flights_2025_details.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.trim().length > 0) {
            try {
                const flight = JSON.parse(line);
                totalFlights++;

                if (flight.task) {
                    flightsWithTasks++;

                    if (flight.task.id) {
                        flightsWithTaskIds++;
                    } else {
                        flightsWithTasksButNoIds++;
                        console.log(`Flight ${flight.id} has task but no task.id:`, JSON.stringify(flight.task, null, 2));
                    }
                }
            } catch (e) {
                console.error('Error parsing line:', e);
            }
        }
    }

    console.log('\n=== TASK ID ANALYSIS ===');
    console.log(`Total flights: ${totalFlights}`);
    console.log(`Flights with tasks: ${flightsWithTasks}`);
    console.log(`Flights with task.id: ${flightsWithTaskIds}`);
    console.log(`Flights with tasks but NO task.id: ${flightsWithTasksButNoIds}`);
    console.log(`Flights without tasks: ${totalFlights - flightsWithTasks}`);

    console.log('\n=== COMPARISON ===');
    console.log(`Generation script counts: 5,593 tasks declared`);
    console.log(`Actual JSONL analysis: ${flightsWithTasks} flights with tasks`);
    console.log(`Difference: ${5593 - flightsWithTasks}`);
}

analyzeTaskIds().catch(console.error);