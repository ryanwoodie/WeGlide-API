'use strict';

const crypto = require('crypto');

const REVIEW_EMAIL = 'sacleaderboard@gmail.com';
const NICKNAME_GROUPS = [
    ['alex', 'alexander'], ['andy', 'andrew'], ['ben', 'benjamin'], ['bill', 'william'],
    ['bob', 'robert', 'rob'], ['chris', 'christopher'], ['dan', 'daniel'], ['dave', 'david'],
    ['jeff', 'jeffrey'], ['jim', 'james'], ['joe', 'joseph'], ['ken', 'kenneth'], ['mike', 'michael']
];

function nameParts(name) {
    return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss').toLowerCase().match(/[a-z]+/g) || [];
}

function oneEditApart(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (left.length >= right.length) i++;
        if (right.length >= left.length) j++;
    }
    return edits + (left.length - i) + (right.length - j) === 1;
}

function scoreNameMatch(weglideName, olcName) {
    const left = nameParts(weglideName);
    const right = nameParts(olcName);
    if (left.length < 2 || right.length < 2) return null;
    const leftSurname = left[left.length - 1];
    const rightSurname = right[right.length - 1];
    const exactSurname = leftSurname === rightSurname;
    const similarSurname = Math.min(leftSurname.length, rightSurname.length) >= 6 && oneEditApart(leftSurname, rightSurname);
    if (!exactSurname && !similarSurname) return null;
    const leftGiven = left.slice(0, -1);
    const rightGiven = right.slice(0, -1);
    if (left.join('') === right.join('')) return { score: 100, reason: 'Exact normalized name, but no linked OLC record' };
    if (leftGiven.some(a => a.length >= 3 && rightGiven.includes(a))) {
        return { score: exactSurname ? 90 : 75, reason: exactSurname ? 'Same surname and a shared given name' : 'Shared given name and a one-character surname difference' };
    }
    if (!exactSurname) return null;
    if (leftGiven.some(a => rightGiven.some(b => NICKNAME_GROUPS.some(group => group.includes(a) && group.includes(b))))) {
        return { score: 80, reason: 'Same surname and a common first-name variant' };
    }
    if (leftGiven.some(a => rightGiven.some(b => Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))))) {
        return { score: 70, reason: 'Same surname and a partial given-name match' };
    }
    if (leftGiven.some(a => rightGiven.some(b => Math.min(a.length, b.length) === 1 && a[0] === b[0]))) {
        return { score: 60, reason: 'Same surname and a matching first initial' };
    }
    return null;
}

function combineReviewPayload(current, snapshot) {
    const pilots = { ...(snapshot.pilots || {}) };
    for (const [id, entry] of Object.entries(current.pilots || {})) pilots[id] = { ...pilots[id], ...entry };
    const hasIndex = Object.keys(current.olcNameTotals || {}).length > 0;
    return { ...(hasIndex ? current : snapshot), pilots };
}

function buildOlcMatchReviews({ profiles = {}, payload = {}, notifications = {} }) {
    const olcById = new Map();
    for (const entry of Object.values(payload.olcNameTotals || {})) {
        if (entry.olcPilotId && entry.pilotName) olcById.set(String(entry.olcPilotId), entry);
    }
    for (const entries of Object.values(payload.olcNameDuplicates || {})) {
        for (const entry of entries) {
            if (entry.olcPilotId && entry.pilotName && !olcById.has(String(entry.olcPilotId))) olcById.set(String(entry.olcPilotId), entry);
        }
    }
    const reviews = [];
    for (const [pilotId, profile] of Object.entries(profiles)) {
        if (!/^\d+$/.test(pilotId) || !profile?.name || payload.pilots?.[pilotId]?.olcPilotId) continue;
        const matches = [];
        for (const [olcPilotId, entry] of olcById) {
            const match = scoreNameMatch(profile.name, entry.pilotName);
            if (match) matches.push({
                olcPilotId, pilotName: entry.pilotName,
                olcHours: entry.olcHours, olcHoursBeforeCutoff: entry.olcHoursBeforeCutoff,
                ...match
            });
        }
        matches.sort((a, b) => b.score - a.score || a.olcPilotId.localeCompare(b.olcPilotId));
        if (!matches.length) continue;
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
            name: nameParts(profile.name),
            matches: matches.map(entry => [entry.olcPilotId, nameParts(entry.pilotName)])
        })).digest('hex');
        if (notifications[pilotId]?.fingerprint === fingerprint) continue;
        reviews.push({ pilotId, pilotName: profile.name, fingerprint, matches: matches.slice(0, 3), totalMatches: matches.length });
    }
    return reviews.sort((a, b) => b.matches[0].score - a.matches[0].score || Number(a.pilotId) - Number(b.pilotId));
}

function buildOlcReviewEmail(reviews, cutoffDate) {
    const lines = [
        'Possible OLC ↔ WeGlide matches need manual review.',
        'These are identity suggestions. Confirm the pilot identity before adding a permanent mapping.',
        `OLC snapshot cutoff: ${cutoffDate || 'unknown'}.`,
        ''
    ];
    for (const review of reviews) {
        lines.push(`WeGlide: ${review.pilotName} (ID ${review.pilotId})`, `https://www.weglide.org/user/${review.pilotId}`);
        for (const match of review.matches) {
            lines.push(`  Possible OLC match: ${match.pilotName} (ID ${match.olcPilotId})`,
                `  Reason: ${match.reason}`,
                `  Cached OLC hours: ${Number.isFinite(match.olcHours) ? match.olcHours.toFixed(2) : 'not available'}`,
                `  Cached hours before cutoff: ${Number.isFinite(match.olcHoursBeforeCutoff) ? match.olcHoursBeforeCutoff.toFixed(2) : 'not available'}`);
        }
        if (review.totalMatches > review.matches.length) lines.push(`  ${review.totalMatches - review.matches.length} additional possible matches; check the OLC pilot directory.`);
        lines.push('');
    }
    lines.push('Reply with the confirmed WeGlide ID and OLC ID, or identify suggestions that are not the same person. These suggestions have not changed leaderboard hours.');
    return { email: REVIEW_EMAIL, subject: `SAC leaderboard: review possible OLC matches (${reviews.length} pilots)`, text: lines.join('\n') };
}

async function notifyOlcMatchReviews({ profiles, payload, dryRun = false, loadState, saveState, sendEmail }) {
    const state = await loadState();
    const all = buildOlcMatchReviews({ profiles, payload, notifications: state.olcMatchReviewNotifications || {} });
    const reviews = all.slice(0, 20);
    const result = { recipient: REVIEW_EMAIL, candidates: all.length, sent: 0, remaining: Math.max(0, all.length - reviews.length) };
    if (dryRun) return { ...result, previews: reviews, emailPreview: reviews.length ? buildOlcReviewEmail(reviews, payload.cutoffDate) : null };
    if (!reviews.length) return result;
    await sendEmail(buildOlcReviewEmail(reviews, payload.cutoffDate));
    const latestState = await loadState();
    latestState.olcMatchReviewNotifications = latestState.olcMatchReviewNotifications || {};
    const notifiedAt = new Date().toISOString();
    for (const review of reviews) latestState.olcMatchReviewNotifications[review.pilotId] = {
        pilotName: review.pilotName, fingerprint: review.fingerprint, notifiedAt,
        candidateOlcIds: review.matches.map(match => match.olcPilotId)
    };
    const persisted = await saveState(latestState, `chore: record OLC match review notifications for ${reviews.length} pilots`);
    return { ...result, sent: reviews.length, statePersisted: Boolean(persisted?.persisted) };
}

module.exports = { REVIEW_EMAIL, scoreNameMatch, combineReviewPayload, buildOlcMatchReviews, buildOlcReviewEmail, notifyOlcMatchReviews };
