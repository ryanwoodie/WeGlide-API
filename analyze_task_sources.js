const fs = require('fs');
const readline = require('readline');

async function analyzeTaskSources() {
    const fileStream = fs.createReadStream('/Users/ryanwood/GitHub/WeGlide-API/australian_flights_2025_details.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const stats = {
        total: 0,
        withTasks: 0,
        igcTasks: 0,
        weGlideTasks: 0,
        byTaskType: {}
    };

    for await (const line of rl) {
        if (line.trim().length > 0) {
            try {
                const flight = JSON.parse(line);
                stats.total++;

                if (flight.task) {
                    stats.withTasks++;
                    const taskKind = flight.task.kind || 'unknown';
                    const fromIgc = flight.task.from_igcfile === true;

                    if (fromIgc) {
                        stats.igcTasks++;
                    } else {
                        stats.weGlideTasks++;
                    }

                    if (!stats.byTaskType[taskKind]) {
                        stats.byTaskType[taskKind] = {
                            total: 0,
                            igc: 0,
                            weglide: 0
                        };
                    }

                    stats.byTaskType[taskKind].total++;
                    if (fromIgc) {
                        stats.byTaskType[taskKind].igc++;
                    } else {
                        stats.byTaskType[taskKind].weglide++;
                    }
                }
            } catch (e) {}
        }
    }

    console.log('========================================');
    console.log('TASK SOURCE ANALYSIS');
    console.log('========================================');
    console.log(`Total flights: ${stats.total}`);
    console.log(`Flights with tasks: ${stats.withTasks}`);
    console.log('');
    console.log(`IGC Tasks (from_igcfile: true): ${stats.igcTasks} (${(stats.igcTasks/stats.withTasks*100).toFixed(1)}%)`);
    console.log(`WeGlide Tasks (from_igcfile: false): ${stats.weGlideTasks} (${(stats.weGlideTasks/stats.withTasks*100).toFixed(1)}%)`);
    console.log('');
    console.log('BREAKDOWN BY TASK TYPE:');
    console.log('========================');

    // Sort by total count descending
    const sortedTypes = Object.entries(stats.byTaskType).sort(([,a], [,b]) => b.total - a.total);

    sortedTypes.forEach(([taskType, data]) => {
        const igcPct = (data.igc / data.total * 100).toFixed(1);
        const weglPct = (data.weglide / data.total * 100).toFixed(1);
        console.log(`${taskType}: ${data.total} total`);
        console.log(`  IGC: ${data.igc} (${igcPct}%) | WeGlide: ${data.weglide} (${weglPct}%)`);
        console.log('');
    });
}

analyzeTaskSources().catch(console.error);