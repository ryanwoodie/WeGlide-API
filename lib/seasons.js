const SEASONS = Object.freeze({
    '2025-26': Object.freeze({
        id: '2025-26',
        start: '2025-10-01',
        fetchStart: '2025-09-23',
        end: '2026-09-30',
        dataset: 'canadian_flights_2026_details.jsonl',
        combinedHoursFile: 'canadian_combined_hours.json',
        verificationFile: 'pilot_pic_hours_verification.json',
        publicDir: 'public/seasons/2025-26'
    }),
    '2026-27': Object.freeze({
        id: '2026-27',
        start: '2026-10-01',
        fetchStart: '2026-10-01',
        end: '2027-09-30',
        dataset: 'canadian_flights_2027_details.jsonl',
        combinedHoursFile: 'canadian_combined_hours_2027.json',
        verificationFile: 'pilot_pic_hours_verification_2027.json',
        publicDir: 'public'
    })
});

const CURRENT_SEASON_ID = '2026-27';

function getSeason(id = CURRENT_SEASON_ID) {
    const season = SEASONS[id];
    if (!season) throw new Error(`Unsupported soaring season: ${id}`);
    return season;
}

module.exports = { SEASONS, CURRENT_SEASON_ID, getSeason };
