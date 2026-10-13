const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSilverCalendarLeaderboards, selectSilverCalendarCandidates } = require('../lib/silver-calendar');
const { publicDobVerifications } = require('../lib/public-dob');

function silverFlight(id, pilotId, date) {
    return { id, junior: true, user: { id: pilotId, name: `Pilot ${pilotId}` }, scoring_date: date,
        achievement: [{ badge_id: 'silver' }], contest: [{ distance: 100, points: 150 }], total_seconds: 18000 };
}

test('Silver calendar years include January and October, end at December 31, and use earliest achievement', () => {
    const flights = [
        silverFlight(1, 1, '2026-01-01'), silverFlight(2, 2, '2026-10-01'),
        silverFlight(3, 3, '2026-12-31'), silverFlight(4, 4, '2027-01-01'),
        silverFlight(5, 1, '2027-02-01'), silverFlight(6, 5, '2025-12-31'),
        silverFlight(7, 5, '2026-03-01'), silverFlight(3, 3, '2026-12-31'),
        { ...silverFlight(8, 6, '2026-08-01'), junior: false },
        { ...silverFlight(9, 7, '2026-08-01'), achievement: [] }
    ];
    const result = buildSilverCalendarLeaderboards(flights.reverse(), 2026, 2027);
    assert.deepEqual(result[2026].map(p => p.userId), [1, 2, 3]);
    assert.deepEqual(result[2027].map(p => p.userId), [4]);
    assert.equal(result[2026][0].date, '2026-01-01');
    assert.equal(result[2026][0].duration, '5h 0m');
});

test('calendar selection recalculates private age ranks for the selected achievement year', () => {
    const data = { meta: { silverCalendarYear: 2026 }, silverCgullLeaderboardsByYear: {
        2026: [{ userId: 1, date: '2026-01-01' }], 2027: [{ userId: 2, date: '2027-01-01' }]
    } };
    const entries = { 1: { dateOfBirth: '2005-01-02' }, 2: { dateOfBirth: '2006-01-02' } };
    const first = publicDobVerifications(entries, selectSilverCalendarCandidates(data));
    const next = publicDobVerifications(entries, selectSilverCalendarCandidates(data, '2027'));
    assert.equal(first[1].awardRank, 1);
    assert.equal(first[2].awardRank, undefined);
    assert.equal(next[1].awardRank, undefined);
    assert.equal(next[2].awardRank, 1);
    assert.equal(JSON.stringify(next).includes('dateOfBirth'), false);
});

test('archived season verification uses the shared calendar candidates and exposes no birth dates', async () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('node:vm');
    const root = path.join(__dirname, '..');
    const currentDataPath = path.join(root, 'public/leaderboard_data.json');
    const data = { meta: { silverCalendarYear: 2026 }, silverCgullLeaderboardsByYear: {
        2026: [{ userId: 1, date: '2026-10-15' }], 2027: [{ userId: 2, date: '2027-01-01' }]
    } };
    const entries = { 1: { dateOfBirth: '2005-01-02' }, 2: { dateOfBirth: '2006-01-02' } };
    let picSeason;
    const dependencies = {
        fs: { existsSync: file => file === currentDataPath, readFileSync: () => JSON.stringify(data) },
        path,
        '../lib/seasons': require('../lib/seasons'),
        '../lib/silver-calendar': require('../lib/silver-calendar'),
        '../lib/season-verifications': { selectSeasonPicVerifications: (_, season) => { picSeason = season; return {}; } },
        '../lib/verification-store': {
            defaultState: () => ({}), loadVerificationState: async () => ({ dobVerifications: entries }),
            sanitizeVerificationState: require('../lib/verification-store').sanitizeVerificationState
        }
    };
    const sandbox = { module: { exports: {} }, require: name => dependencies[name], console,
        process: { cwd: () => root, env: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'api/verification-state.js'), 'utf8'), sandbox);
    for (const year of ['2026', '2027']) {
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await sandbox.module.exports({ method: 'GET', query: { season: '2025-26', silverYear: year } }, res);
        assert.equal(res.code, 200);
        assert.equal(picSeason, '2025-26');
        assert.equal(res.body.dobVerifications[year === '2026' ? 1 : 2].awardRank, 1);
        assert.equal(JSON.stringify(res.body).includes('dateOfBirth'), false);
    }
});

test('shared Silver data response contains only calendar candidates and year', async () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('node:vm');
    const data = { meta: { silverCalendarYear: 2026 }, silverCgullLeaderboardsByYear: { 2026: [] }, pilotVerifications: { picHoursVerifications: { 1: { picHours: 100 } } } };
    const dependencies = {
        fs: { existsSync: () => true, readFileSync: () => JSON.stringify(data) }, path,
        '../lib/seasons': require('../lib/seasons')
    };
    const sandbox = { module: { exports: {} }, require: name => dependencies[name], console,
        process: { cwd: () => path.join(__dirname, '..') } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/serve-data.js'), 'utf8'), sandbox);
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await sandbox.module.exports({ method: 'GET', query: { season: '2026-27', silverOnly: '1' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.silverCalendarYear, 2026);
    assert.equal('pilotVerifications' in res.body, false);
});
