const fs = require('fs');
const path = require('path');
const { getSeason } = require('./lib/seasons');

const season = getSeason('2025-26');
const source = path.join(__dirname, season.dataset);
const output = path.join(__dirname, 'season_flight_hours_2025_26.json');
const secondsByPilot = {};
const seenFlightIds = new Set();

for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const flight = JSON.parse(line);
    const date = String(flight.scoring_date || '').slice(0, 10);
    const pilotId = flight.user?.id;
    if (!pilotId || date < season.start || date > season.end) continue;
    if (flight.id && seenFlightIds.has(flight.id)) continue;
    if (flight.id) seenFlightIds.add(flight.id);

    const takeoff = Date.parse(flight.takeoff_time);
    const landing = Date.parse(flight.landing_time);
    const elapsed = Number.isFinite(takeoff) && Number.isFinite(landing) && landing >= takeoff
        ? Math.round((landing - takeoff) / 1000) : 0;
    const seconds = Number(flight.total_seconds) || elapsed;
    if (seconds > 0) secondsByPilot[pilotId] = (secondsByPilot[pilotId] || 0) + seconds;
}

fs.writeFileSync(output, JSON.stringify(secondsByPilot, null, 2) + '\n');
console.log(`Saved ${Object.keys(secondsByPilot).length} pilot flight-hour totals to ${output}`);
