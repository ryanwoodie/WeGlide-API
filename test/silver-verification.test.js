const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { computeSilverCandidates, buildSendQueue, buildSilverMessageBody, buildSilverLinks } = require('../lib/notify-silver');
const { computeNotificationCandidates, MESSAGE_SECTION_GAP } = require('../lib/notify-top5');
const { isValidDateOfBirth } = require('../lib/dob-validation');
const root = path.join(__dirname, '..');

test('generated and future-generated email validators accept real addresses', () => {
    const generator = fs.readFileSync(path.join(root, 'create_canadian_leaderboard_from_jsonl.js'), 'utf8');
    const source = generator.match(/function isValidVerificationEmail\(email\) \{[\s\S]*?\n        \}/)[0];
    const emitted = vm.runInNewContext('`' + source + '`');
    for (const code of [emitted, ...['SAC_leaderboard.html', 'SAC_leaderboard_sac_dsc.html'].map(file =>
        fs.readFileSync(path.join(root, 'public', file), 'utf8').match(/function isValidVerificationEmail\(email\) \{[\s\S]*?\n        \}/)[0])]) {
        const valid = vm.runInNewContext(`(${code})`);
        for (const email of ['ali.askari@example.com', 'test+silver@gmail.com', 'a@b.ca']) assert.equal(valid(email), true, email);
        for (const email of ['a b@example.com', 'a@b', 'a@@b.com', 'a@b com']) assert.equal(valid(email), false, email);
    }
});

test('Silver candidates dedupe and exclude verified or previously notified DOB pilots', () => {
    const leaderboardData = { silverCgullLeaderboard: [1, 2, 3, 3].map(userId => ({ userId, pilot: `Pilot ${userId}` })) };
    const state = { dobVerifications: { 1: { dateOfBirth: '2000-01-01' } }, notifiedPilots: { 2: { silverNotifiedAt: '2026-01-01' }, 3: { notifiedAt: '2026-01-01' } } };
    assert.deepEqual(computeSilverCandidates({ leaderboardData, state }).map(c => c.pilotId), [3]);
});

test('priority: top three on either board, Silver, ranks four/five, reminders', () => {
    const initial = [{ pilotId: 4, ranks: { free: 4 } }, { pilotId: 1, ranks: { free: 5, 'sac-dsc': 1 } }];
    assert.deepEqual(buildSendQueue(initial, [{ pilotId: 8 }], [{ pilotId: 9 }]).map(c => c.pilotId), [1, 8, 4, 9]);
});

test('Silver notice does not mark PIC notice sent', () => {
    const leaderboardData = { sacDscLeaderboard: [{ pilotId: 3, pilot: 'Pilot Three' }], pilotCombinedHours: { 3: { eligibleUnder200: true } } };
    const result = computeNotificationCandidates({ leaderboardData, state: { notifiedPilots: { 3: { silverNotifiedAt: '2026-01-01' } } } });
    assert.equal(result.candidates.length, 1);
});

test('Silver messages use spacing, canonical DOB form link and French when needed', () => {
    const candidate = { pilotId: 3, firstName: 'Ali', bilingual: true };
    const links = buildSilverLinks({ baseUrl: 'https://sac-leaderboard.vercel.app', candidate });
    const body = buildSilverMessageBody({ candidate, links });
    assert.match(links.verify, /verifyDob=3/);
    assert.ok(body.includes(MESSAGE_SECTION_GAP));
    assert.ok(body.includes('Bonjour Ali'));
    assert.ok(body.length < 5000);
});

test('Quebec flight triggers bilingual Silver notice without a Quebec profile', () => {
    const leaderboardData = { silverCgullLeaderboard: [{ userId: 3, pilot: 'Test Pilot' }], minimalFlights: [{ user: { id: 3 }, takeoff_airport: { region: 'CA-QC' } }] };
    assert.equal(computeSilverCandidates({ leaderboardData, state: {} })[0].bilingual, true);
});

test('DOB rejects impossible dates and future dates', () => {
    assert.equal(isValidDateOfBirth('2004-02-29'), true);
    for (const date of ['2003-02-29', '2000-13-01', 'x', '2099-01-01']) assert.equal(isValidDateOfBirth(date), false);
});

function loadHandler(file, dependencies) {
    const sandbox = { module: { exports: {} }, require: name => dependencies[name], console: { error() {} }, process: { env: { PUBLIC_BASE_URL: 'https://sac-leaderboard.vercel.app' } } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'api', file), 'utf8'), sandbox);
    return sandbox.module.exports;
}
function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
}

test('DOB request emails confirmation without verifying; confirmation saves shared DOB only', async () => {
    const state = { verificationRequests: [], dobVerifications: {}, picHoursVerifications: {} };
    let email;
    let payload;
    let persists = true;
    const store = { loadVerificationState: async () => state, saveVerificationState: async () => ({ persisted: persists }) };
    const dependencies = {
        '../lib/verification-token': { createVerificationToken: value => { payload = value; return 'test-token'; }, verifyVerificationToken: () => payload },
        '../lib/dob-validation': { isValidDateOfBirth },
        '../lib/verification-store': store,
        '../lib/verification-email': { sendVerificationEmail: async value => { email = value; } }
    };
    const request = loadHandler('request-verification.js', dependencies);
    const res = response();
    await request({ method: 'POST', headers: { host: 'stale-deploy.vercel.app' }, body: { type: 'dob', pilotId: '123', pilotName: 'Test Pilot', email: 'test@example.com', dateOfBirth: '2004-02-29' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(Object.keys(state.dobVerifications).length, 0);
    assert.equal(email.verificationLink, 'https://sac-leaderboard.vercel.app/api/complete-verification?token=test-token');
    const complete = loadHandler('complete-verification.js', dependencies);
    const confirmed = response();
    await complete({ method: 'GET', query: { token: 'test-token' } }, confirmed);
    assert.equal(confirmed.statusCode, 200);
    assert.equal(state.dobVerifications['123'].dateOfBirth, '2004-02-29');
    assert.equal(state.dobVerifications['123'].dataSource, 'email-verified');
    assert.equal(Object.keys(state.picHoursVerifications).length, 0);
    persists = false;
    const failed = response();
    await complete({ method: 'GET', query: { token: 'test-token' } }, failed);
    assert.equal(failed.statusCode, 503);
    assert.match(failed.body, /Verification not saved/);
});
