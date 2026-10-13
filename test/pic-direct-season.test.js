const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

test('direct PIC links display and save the signed season cutoff', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../api/verify-pic-hours.js'), 'utf8');
    for (const seasonId of ['2025-26', '2026-27']) {
        const state = { picHoursVerifications: {} };
        const payload = { type: 'pic-direct', pilotId: '123', pilotName: 'Test Pilot', seasonId };
        const dependencies = {
            '../lib/verification-token': { verifyVerificationToken: () => payload },
            '../lib/verification-store': { loadVerificationState: async () => state, saveVerificationState: async () => ({ persisted: true }) },
            '../lib/notify-top5': { getSeasonStartLabel: date => `October 1st, ${date.getUTCFullYear()}` },
            '../lib/short-links': {},
            '../lib/seasons': require('../lib/seasons')
        };
        const sandbox = { module: { exports: {} }, require: name => dependencies[name], console, URLSearchParams, Buffer };
        vm.runInNewContext(source, sandbox);
        const response = () => ({ setHeader() {}, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } });
        const cutoffLabel = `October 1st, ${seasonId.slice(0, 4)}`;
        const form = response();
        await sandbox.module.exports({ method: 'GET', query: { token: 'test' } }, form);
        assert.equal(form.statusCode, 200);
        assert.ok(form.body.includes(cutoffLabel));
        const invalid = response();
        await sandbox.module.exports({ method: 'POST', body: { token: 'test', picHours: '-1' } }, invalid);
        assert.equal(invalid.statusCode, 400);
        assert.ok(invalid.body.includes(cutoffLabel));
        const submitted = response();
        await sandbox.module.exports({ method: 'POST', body: { token: 'test', picHours: '200' } }, submitted);
        assert.equal(submitted.statusCode, 200);
        const key = seasonId === '2025-26' ? '123' : '2026-27:123';
        assert.equal(state.picHoursVerifications[key].cutoffDate, `${seasonId.slice(0, 4)}-10-01`);
        assert.equal(state.picHoursVerifications[key].eligible, false);
    }
});
