const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreNameMatch, buildOlcMatchReviews, buildOlcReviewEmail, notifyOlcMatchReviews } = require('../lib/olc-match-review');

const payload = {
    cutoffDate: '2025-10-01', pilots: {},
    olcNameTotals: {
        gondasinagowitz: { olcPilotId: '45025', pilotName: 'Gonda Sinagowitz', olcHours: 545.16, olcHoursBeforeCutoff: 545.16 },
        jeffreyrunciman: { olcPilotId: '35922', pilotName: 'Jeffrey Runciman', olcHours: 84.23, olcHoursBeforeCutoff: 84.23 }
    }
};
const profiles = { 38629: { name: 'Gonda-Bastian Sinagowitz' }, 38955: { name: 'Jeff Runciman' } };

test('partial-name heuristic recognises compound names, initials, nicknames, and long surname typos', () => {
    for (const [left, right] of [
        ['Gonda-Bastian Sinagowitz', 'Gonda Sinagowitz'], ['Jeff Runciman', 'Jeffrey Runciman'],
        ['Alexander Ackerman', 'Alex Ackerman'], ['J. Smith', 'John Smith'],
        ['Jean-François Lefèvre', 'Jean Francois Lefevre'], ['Gonda Sinagowitz', 'Gonda Sinagowits']
    ]) assert.ok(scoreNameMatch(left, right), `${left} / ${right}`);
    for (const [left, right] of [
        ['John Smith', 'Jane Smith'], ['Gonda Sinagowitz', 'Gonda Jones'], ['Smith', 'John Smith'],
        ['J. Smith', 'John Smyth'], ['Alex Jones', 'Alexander Smith']
    ]) assert.equal(scoreNameMatch(left, right), null, `${left} / ${right}`);
});

test('reviews preserve ambiguous candidates, skip linked pilots, and deduplicate identical suggestions', () => {
    const data = structuredClone(payload);
    data.olcNameDuplicates = { gondasinagowitz: [{ olcPilotId: '999', pilotName: 'Gonda Sinagowitz' }] };
    const reviews = buildOlcMatchReviews({ profiles, payload: data });
    const gonda = reviews.find(review => review.pilotId === '38629');
    assert.equal(gonda.matches.length, 2);
    const notifications = { 38629: { fingerprint: gonda.fingerprint } };
    assert.deepEqual(buildOlcMatchReviews({ profiles, payload: data, notifications }).map(r => r.pilotId), ['38955']);
    data.pilots['38955'] = { olcPilotId: '35922' };
    assert.equal(buildOlcMatchReviews({ profiles, payload: data, notifications }).length, 0);
    data.olcNameDuplicates.gondasinagowitz.push({ olcPilotId: '998', pilotName: 'Gonda Sinagowitz' });
    assert.equal(buildOlcMatchReviews({ profiles, payload: data, notifications })[0].pilotId, '38629');
});

test('review email identifies IDs, reasons, snapshot hours, and manual confirmation', () => {
    const email = buildOlcReviewEmail(buildOlcMatchReviews({ profiles, payload }), payload.cutoffDate);
    assert.equal(email.email, 'sacleaderboard@gmail.com');
    assert.match(email.text, /Gonda-Bastian Sinagowitz \(ID 38629\)/);
    assert.match(email.text, /Gonda Sinagowitz \(ID 45025\)/);
    assert.match(email.text, /545.16/);
    assert.match(email.text, /2025-10-01/);
    assert.match(email.text, /Reply with the confirmed WeGlide ID and OLC ID/);
});

test('successful digest is recorded once without changing PIC, DOB, or combined-hour matches', async () => {
    let state = { picHoursVerifications: { 38629: { picHours: 200, eligible: false } }, dobVerifications: { 1: { verified: true } } };
    const originalPayload = JSON.stringify(payload);
    let emails = 0;
    const dependencies = {
        profiles, payload, loadState: async () => structuredClone(state),
        saveState: async saved => { state = saved; return { persisted: true }; },
        sendEmail: async email => { assert.equal(email.email, 'sacleaderboard@gmail.com'); emails++; }
    };
    assert.equal((await notifyOlcMatchReviews(dependencies)).sent, 2);
    assert.equal((await notifyOlcMatchReviews(dependencies)).sent, 0);
    assert.equal(emails, 1);
    assert.equal(state.picHoursVerifications[38629].picHours, 200);
    assert.equal(state.dobVerifications[1].verified, true);
    assert.equal(JSON.stringify(payload), originalPayload);
});

test('failed email remains retryable, and dry run sends or saves nothing', async () => {
    let saved = 0;
    const dependencies = { profiles, payload, loadState: async () => ({}), saveState: async () => { saved++; }, sendEmail: async () => { throw new Error('SMTP failure'); } };
    await assert.rejects(notifyOlcMatchReviews(dependencies), /SMTP failure/);
    assert.equal(saved, 0);
    const preview = await notifyOlcMatchReviews({ ...dependencies, dryRun: true });
    assert.equal(preview.previews.length, 2);
    assert.equal(preview.sent, 0);
    assert.equal(saved, 0);
});

test('notification fingerprints survive encrypted-store normalization but stay out of public responses', async () => {
    const { sanitizeVerificationState } = require('../lib/verification-store');
    const state = { olcMatchReviewNotifications: { 38629: { fingerprint: 'private' } } };
    assert.equal(JSON.stringify(sanitizeVerificationState(state)).includes('olcMatchReview'), false);
    const fs = require('fs');
    const path = require('path');
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '../lib/verification-store.js'), 'utf8');
    const fn = source.match(/function normalizeState\(value\) \{[\s\S]*?\n\}/)[0];
    const normalize = vm.runInNewContext(`(${fn})`, { defaultState: () => ({}) });
    assert.equal(normalize(state).olcMatchReviewNotifications[38629].fingerprint, 'private');
});

test('season exports that omit OLC IDs retain earlier confirmed links for review suppression', () => {
    const { combineReviewPayload } = require('../lib/olc-match-review');
    const snapshot = structuredClone(payload);
    snapshot.pilots[38955] = { olcPilotId: '35922', combinedHours: 84.23 };
    const current = { cutoffDate: '2026-10-01', pilots: { 38955: { combinedHours: 100 } } };
    const combined = combineReviewPayload(current, snapshot);
    assert.equal(combined.pilots[38955].olcPilotId, '35922');
    assert.equal(combined.pilots[38955].combinedHours, 100);
    assert.equal(combined.cutoffDate, '2025-10-01');
    assert.deepEqual(buildOlcMatchReviews({ profiles, payload: combined }).map(r => r.pilotId), ['38629']);
});

test('review notification and verification emails both use the existing SMTP delivery', async () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('node:vm');
    const sent = [];
    const dependencies = {
        nodemailer: { createTransport: () => ({ sendMail: async mail => sent.push(mail) }) },
        googleapis: { google: {} }
    };
    const sandbox = { module: { exports: {} }, require: name => dependencies[name], console, Buffer,
        process: { env: { GMAIL_SMTP_USER: 'sender@example.com', GMAIL_SMTP_APP_PASSWORD: 'test-only' } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/verification-email.js'), 'utf8'), sandbox);
    await sandbox.module.exports.sendNotificationEmail({ email: 'sacleaderboard@gmail.com', subject: 'Review identities', text: 'Review <candidate>' });
    await sandbox.module.exports.sendVerificationEmail({ email: 'pilot@example.com', type: 'pic', pilotName: 'Pilot', picHours: 100, verificationLink: 'https://example.com/verify' });
    assert.equal(sent[0].to, 'sacleaderboard@gmail.com');
    assert.equal(sent[0].subject, 'Review identities');
    assert.match(sent[0].html, /Review &lt;candidate&gt;/);
    assert.equal(sent[1].to, 'pilot@example.com');
    assert.match(sent[1].subject, /Confirm PIC hours verification/);
});
