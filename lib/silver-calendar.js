'use strict';

function buildSilverCalendarLeaderboards(flights, firstYear, lastYear) {
    const earliestByPilot = new Map();
    for (const flight of flights) {
        const date = String(flight.scoring_date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !flight.junior || !flight.user?.id ||
            !flight.achievement?.some(badge => badge.badge_id === 'silver')) continue;
        const id = String(flight.user.id);
        const previous = earliestByPilot.get(id);
        if (!previous || date < previous.scoring_date) earliestByPilot.set(id, { ...flight, scoring_date: date });
    }
    const years = {};
    for (let year = firstYear; year <= lastYear; year++) years[year] = [];
    for (const flight of earliestByPilot.values()) {
        const year = Number(flight.scoring_date.slice(0, 4));
        if (!years[year]) continue;
        const seconds = Number(flight.total_seconds) || 0;
        const distance = Math.max(0, ...(flight.contest || []).map(contest => Number(contest.distance) || 0));
        const points = Math.max(0, ...(flight.contest || []).map(contest => Number(contest.points) || 0));
        years[year].push({
            pilot: flight.user.name, userId: flight.user.id, flightId: flight.id,
            date: flight.scoring_date,
            distance: distance ? `${distance.toFixed(1)} km` : 'Unknown',
            points: points ? `${points.toFixed(1)} pts` : 'Unknown',
            duration: seconds ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m` : 'Unknown',
            takeoff: flight.takeoff_airport?.name || 'Unknown', club: flight.club?.name || 'Unknown'
        });
    }
    for (const pilots of Object.values(years)) pilots.sort((a, b) => a.pilot.localeCompare(b.pilot));
    return years;
}

function selectSilverCalendarCandidates(data, requestedYear) {
    if (!data.silverCgullLeaderboardsByYear) return data.silverCgullLeaderboard || [];
    const year = String(requestedYear || data.meta?.silverCalendarYear);
    return data.silverCgullLeaderboardsByYear[year] || [];
}

module.exports = { buildSilverCalendarLeaderboards, selectSilverCalendarCandidates };
