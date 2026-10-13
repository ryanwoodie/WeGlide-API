'use strict';

function publicDobVerifications(entries, candidates = []) {
    const ranked = candidates.flatMap(pilot => {
        const id = String(pilot.userId || pilot.pilotId);
        const entry = entries[id];
        if (!entry?.dateOfBirth || entry.eligible === false) return [];
        const days = (Date.parse(pilot.date) - Date.parse(entry.dateOfBirth)) / 86400000;
        if (!Number.isFinite(days) || days < 0) return [];
        return [{ id, days, name: pilot.pilot || entry.pilotName || '' }];
    }).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
    const result = {};
    for (const [id, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const rank = ranked.findIndex(pilot => pilot.id === id);
        result[id] = {
            pilotName: entry.pilotName,
            verifiedDate: entry.verifiedDate,
            dataSource: entry.dataSource,
            eligible: entry.eligible !== false,
            verified: entry.eligible !== false && Boolean(entry.dateOfBirth || entry.verified),
            ...(rank >= 0 ? { awardRank: rank + 1 }
                : entry.verified && Number.isFinite(entry.awardRank)
                    ? { awardRank: entry.awardRank } : {})
        };
    }
    return result;
}

module.exports = { publicDobVerifications };
