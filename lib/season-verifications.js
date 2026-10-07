const previousSeasonSeconds = require('../season_flight_hours_2025_26.json');

const AUTOMATIC_SOURCES = new Set([
    'weglide-calculated',
    'combined-hours-calculated',
    'weglide-automatic',
    'combined-hours-automatic',
    'prior-verified-projection'
]);

function isManualPicVerification(entry) {
    return !!(entry && entry.dataSource && !AUTOMATIC_SOURCES.has(entry.dataSource));
}

function selectSeasonPicVerifications(manualState, seasonId) {
    const entries = manualState.picHoursVerifications || {};
    const selected = {};

    for (const [key, entry] of Object.entries(entries)) {
        if (seasonId === '2025-26' && /^\d+$/.test(key)) selected[key] = entry;
        if (seasonId === '2026-27' && key.startsWith('2026-27:')) {
            selected[key.slice('2026-27:'.length)] = entry;
        }
    }

    if (seasonId === '2026-27') {
        for (const [key, entry] of Object.entries(entries)) {
            if (!/^\d+$/.test(key) || !isManualPicVerification(entry)) continue;
            const previousHours = Number(entry.picHours);

            // A confirmed 200+ result at the earlier cutoff cannot become eligible later.
            if (entry.eligible === false || (Number.isFinite(previousHours) && previousHours >= 200)) {
                selected[key] = { ...entry, eligible: false };
                continue;
            }

            // Under-200 confirmations become an estimate until the new cutoff is verified.
            if (selected[key] || !Number.isFinite(previousHours) || previousHours < 0) continue;
            const seasonHours = (previousSeasonSeconds[key] || 0) / 3600;
            const estimatedHours = Number((previousHours + seasonHours).toFixed(1));
            selected[key] = {
                pilotName: entry.pilotName,
                picHours: estimatedHours,
                cutoffDate: '2026-10-01',
                eligible: estimatedHours < 200,
                dataSource: 'prior-verified-projection',
                calculation: {
                    priorVerifiedHours: previousHours,
                    seasonWeGlideHours: Number(seasonHours.toFixed(1))
                }
            };
        }
    }

    return selected;
}

module.exports = { isManualPicVerification, selectSeasonPicVerifications };
