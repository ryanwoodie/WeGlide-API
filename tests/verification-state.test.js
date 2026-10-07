const test = require('node:test');
const assert = require('node:assert/strict');
const previousSeasonSeconds = require('../season_flight_hours_2025_26.json');

const storePath = require.resolve('../lib/verification-store');
const store = require(storePath);
const originalLoad = store.loadVerificationState;

const previousState = {
    picHoursVerifications: {
        '900001': { pilotName: 'One', picHours: 190, dataSource: 'email-verified' },
        '900002': { pilotName: 'Two', picHours: 100, dataSource: 'email-verified' },
        '900003': { pilotName: 'Three', picHours: 200, dataSource: 'email-verified' },
        '900004': { pilotName: 'Four', picHours: 180, dataSource: 'weglide-calculated' },
        '900005': { pilotName: 'Five', picHours: 100, dataSource: 'email-verified' },
        '2026-27:900002': { pilotName: 'Two', picHours: 95, dataSource: 'email-verified' },
        '2026-27:900003': { pilotName: 'Three', picHours: 90, dataSource: 'email-verified' }
    },
    dobVerifications: {}
};

store.loadVerificationState = async () => previousState;
previousSeasonSeconds['900001'] = 39600;
previousSeasonSeconds['900002'] = 36000;
const handler = require('../api/verification-state');

async function requestSeason(season) {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    await handler({ method: 'GET', query: { season } }, res);
    assert.equal(res.statusCode, 200);
    return res.body.picHoursVerifications;
}

test('verified prior PIC hours seed the new estimate and 200+ exclusions persist', async () => {
    try {
        const current = await requestSeason('2026-27');
        assert.equal(current['900001'].picHours, 201);
        assert.equal(current['900001'].eligible, false);
        assert.equal(current['900001'].dataSource, 'prior-verified-projection');
        assert.equal(current['900005'].picHours, 100);
        assert.equal(current['900005'].eligible, true);
        assert.equal(current['900005'].dataSource, 'prior-verified-projection');
        assert.equal(current['900002'].picHours, 95);
        assert.equal(current['900002'].dataSource, 'email-verified');
        assert.equal(current['900003'].picHours, 200);
        assert.equal(current['900003'].dataSource, 'email-verified');
        assert.equal(current['900004'], undefined);

        const previous = await requestSeason('2025-26');
        assert.equal(previous['900001'].picHours, 190);
        assert.equal(previous['900003'].picHours, 200);
        assert.equal(previous['900002'].picHours, 100);
    } finally {
        store.loadVerificationState = originalLoad;
        delete previousSeasonSeconds['900001'];
        delete previousSeasonSeconds['900002'];
    }
});
