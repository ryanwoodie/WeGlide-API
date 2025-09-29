const fs = require('fs');
const readline = require('readline');

function addFlight(variantMap, pilotName, flightData) {
    if (!variantMap[pilotName]) {
        variantMap[pilotName] = [];
    }
    variantMap[pilotName].push(flightData);
}

function buildLeaderboard(flightsByPilot, topN = 5) {
    const leaderboard = [];
    Object.entries(flightsByPilot).forEach(([pilot, flights]) => {
        const sorted = flights
            .filter(f => Number.isFinite(f.points) && f.points > 0)
            .sort((a, b) => b.points - a.points)
            .slice(0, topN);
        if (sorted.length > 0) {
            const totalPoints = sorted.reduce((sum, f) => sum + f.points, 0);
            const totalDistance = sorted.reduce((sum, f) => sum + (f.distance || 0), 0);
            leaderboard.push({ pilot, pilotId: sorted[0].pilotId, totalPoints, totalDistance, bestFlights: sorted });
        }
    });
    leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
    return leaderboard;
}

function buildRankingMap(leaderboard) {
    const ranking = new Map();
    leaderboard.forEach((entry, index) => {
        ranking.set(entry.pilot, index + 1);
    });
    return ranking;
}

function summarizeDifferences(label, baselineMap, comparisonMap) {
    const diffs = [];
    baselineMap.forEach((baselineRank, pilot) => {
        if (comparisonMap.has(pilot)) {
            const compRank = comparisonMap.get(pilot);
            diffs.push(Math.abs(baselineRank - compRank));
        }
    });

    diffs.sort((a, b) => a - b);
    const avg = diffs.reduce((sum, v) => sum + v, 0) / (diffs.length || 1);
    const median = diffs.length === 0 ? 0
        : diffs.length % 2 === 1
            ? diffs[(diffs.length - 1) / 2]
            : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2;

    const distribution = diffs.reduce((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});

    const distributionLines = Object.keys(distribution)
        .map(Number)
        .sort((a, b) => a - b)
        .map(diff => {
            const count = distribution[diff];
            const bar = '#'.repeat(Math.min(count, 40));
            return `${String(diff).padStart(2, ' ')} | ${bar} (${count})`;
        });

    return {
        label,
        comparedPilots: diffs.length,
        averageChange: avg,
        medianChange: median,
        distributionLines
    };
}

async function loadAuFlights(jsonlPath) {
    const flights = [];
    const fileStream = fs.createReadStream(jsonlPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const flight = JSON.parse(line);
            const auContest = flight.contest?.find(c => c && c.name === 'au' && typeof c.points === 'number' && c.points > 0);
            if (!auContest) continue;
            flights.push(flight);
        } catch (err) {
            // Skip malformed lines
        }
    }
    return flights;
}

async function main() {
    const jsonlPath = 'australian_flights_2025_details.jsonl';
    if (!fs.existsSync(jsonlPath)) {
        console.error(`Input file not found: ${jsonlPath}`);
        process.exit(1);
    }

    const flights = await loadAuFlights(jsonlPath);
    console.log(`Loaded ${flights.length} AU-contest flights`);

    const variantMaps = {
        combined: {},
        auContest: {},
        weglideFree: {}
    };

    flights.forEach(flight => {
        const pilotName = flight.user?.name;
        const pilotId = flight.user?.id;
        if (!pilotName) return;

        const auContest = flight.contest.find(c => c && c.name === 'au' && typeof c.points === 'number' && c.points > 0);
        const freeContest = flight.contest.find(c => c && c.name === 'free' && typeof c.points === 'number' && c.points > 0);

        const auPoints = typeof auContest?.points === 'number' ? auContest.points : null;
        const freePoints = typeof freeContest?.points === 'number' ? freeContest.points : null;

        const baseFlightInfo = {
            id: flight.id,
            pilotId,
            date: flight.scoring_date,
            distance: typeof auContest?.distance === 'number' ? auContest.distance : (typeof freeContest?.distance === 'number' ? freeContest.distance : null)
        };

        if (Number.isFinite(auPoints) && auPoints > 0) {
            addFlight(variantMaps.auContest, pilotName, { ...baseFlightInfo, points: auPoints, variant: 'AU Contest' });
        }

        if (Number.isFinite(freePoints) && freePoints > 0) {
            addFlight(variantMaps.weglideFree, pilotName, { ...baseFlightInfo, points: freePoints, variant: 'WeGlide Free' });
        }

        const combinedPoints = Math.max(
            Number.isFinite(auPoints) ? auPoints : 0,
            Number.isFinite(freePoints) ? freePoints : 0
        );
        if (combinedPoints > 0) {
            addFlight(variantMaps.combined, pilotName, { ...baseFlightInfo, points: combinedPoints, variant: 'Combined' });
        }
    });

    const leaderboards = {
        combined: buildLeaderboard(variantMaps.combined),
        auContest: buildLeaderboard(variantMaps.auContest),
        weglideFree: buildLeaderboard(variantMaps.weglideFree)
    };

    console.log('\nLeaderboard pilot counts (top 5 flights per pilot):');
    Object.entries(leaderboards).forEach(([key, list]) => {
        console.log(`- ${key}: ${list.length}`);
    });

    const pilotIdLookup = new Map();
    Object.values(leaderboards).forEach(list => {
        list.forEach(entry => {
            if (!pilotIdLookup.has(entry.pilot)) {
                pilotIdLookup.set(entry.pilot, entry.pilotId || '');
            }
        });
    });

    const rankingMaps = Object.fromEntries(
        Object.entries(leaderboards).map(([key, list]) => [key, buildRankingMap(list)])
    );

    const csvHeader = ['pilot_id', 'pilot_name', 'rank_combined', 'rank_au_contest', 'rank_weglide_free'];
    const csvRows = [csvHeader.join(',')];
    const pilotNamesForCsv = new Set([
        ...rankingMaps.combined.keys(),
        ...rankingMaps.auContest.keys(),
        ...rankingMaps.weglideFree.keys()
    ]);

    const csvEscape = value => {
        if (value == null) return '';
        const str = String(value);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    pilotNamesForCsv.forEach(pilot => {
        const row = [
            csvEscape(pilotIdLookup.get(pilot) || ''),
            csvEscape(pilot),
            csvEscape(rankingMaps.combined.get(pilot) ?? ''),
            csvEscape(rankingMaps.auContest.get(pilot) ?? ''),
            csvEscape(rankingMaps.weglideFree.get(pilot) ?? '')
        ];
        csvRows.push(row.join(','));
    });

    fs.writeFileSync('scoring_rankings.csv', csvRows.join('\n'));
    console.log('\nSaved raw rank data to scoring_rankings.csv');

    const comparisons = [
        ['AU Contest vs Combined', 'auContest'],
        ['WeGlide Free vs Combined', 'weglideFree']
    ].map(([label, key]) =>
        summarizeDifferences(label, rankingMaps.combined, rankingMaps[key])
    );

    const trioPairs = [
        ['AU Contest vs WeGlide Free', 'auContest', 'weglideFree']
    ].map(([label, a, b]) =>
        summarizeDifferences(label, rankingMaps[a], rankingMaps[b])
    );

    console.log('\nRank-change summary (absolute position change relative to Combined):');
    comparisons.forEach(summary => {
        console.log(`\n${summary.label}`);
        console.log(`Pilots compared: ${summary.comparedPilots}`);
        console.log(`Average change: ${summary.averageChange.toFixed(2)} positions`);
        console.log(`Median change: ${summary.medianChange.toFixed(2)} positions`);
        console.log('Distribution:');
        summary.distributionLines.forEach(line => console.log(`  ${line}`));
    });

    console.log('\nPairwise comparisons between specific scoring variants:');
    trioPairs.forEach(summary => {
        console.log(`\n${summary.label}`);
        console.log(`Pilots compared: ${summary.comparedPilots}`);
        console.log(`Average change: ${summary.averageChange.toFixed(2)} positions`);
        console.log(`Median change: ${summary.medianChange.toFixed(2)} positions`);
        console.log('Distribution:');
        summary.distributionLines.forEach(line => console.log(`  ${line}`));
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
