const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

test('approved match uses its fixed cutoff hours as post-cutoff flights increase', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/SAC_leaderboard_sac_dsc.html'), 'utf8');
    const source = html.match(/function getPilotVerificationHoursSummary\(pilotId\) \{[\s\S]*?\n        \}/)[0];
    const entry = { matchKind: 'override', weglideHoursBeforeCutoff: 47.03, olcOnlyHoursBeforeCutoff: 545.16, combinedHoursBeforeCutoff: 592.19 };
    const context = {
        SEASON_ID: '2026-27', COMBINED_HOURS_CUTOFF_DATE: '2026-10-01', LATER_SEASON_SECONDS: {},
        getPilotCombinedHoursData: () => entry,
        getPilotHoursSummary: () => ({ weglideHours: 47.03, combinedHoursBeforeCutoff: 592.19 }),
        calculateWeGlideHoursSinceStart: () => 100
    };
    const calculate = vm.runInNewContext(`(${source})`, context);
    const result = calculate('38629');
    assert.equal(result.weglideHours, 47.03);
    assert.equal(result.combinedHours, 592.19);
});

test('a manual PIC declaration takes precedence over approved OLC calculations', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/SAC_leaderboard_sac_dsc.html'), 'utf8');
    const source = html.match(/function getPilotEligibilityHours\(pilotId\) \{[\s\S]*?\n        \}/)[0];
    const context = {
        pilotVerifications: { picHoursVerifications: { 1: { picHours: 123, dataSource: 'email-verified' } } },
        AUTO_PIC_DATA_SOURCES: new Set(['combined-hours-calculated']),
        getPilotVerificationHoursSummary: () => ({ combinedHours: 190 })
    };
    const calculate = vm.runInNewContext(`(${source})`, context);
    assert.equal(calculate('1'), 123);
    context.pilotVerifications.picHoursVerifications[1] = { picHours: 1500, eligible: false, dataSource: 'self-submitted-via-direct-message' };
    assert.equal(calculate('1'), 200);
});
