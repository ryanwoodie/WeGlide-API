'use strict';

const { createVerificationToken } = require('./verification-token');
const { isQuebecPilotContext } = require('./club-alert');

const DEFAULT_TOP_N = 5;
const TARGET_BOARDS = [
    { key: 'sacDscLeaderboard', slug: 'sac-dsc', label: 'SAC-DSC' },
    { key: 'freeLeaderboard', slug: 'free', label: 'Free Contest' }
];
// SAC-DSC wins ties for default contest tab when a pilot is top-5 on both boards
const DEFAULT_CONTEST_PRIORITY = ['sac-dsc', 'free'];
// Tokens in messages live for 30 days. WeGlide DMs are persistent; pilots may
// take a while to respond.
const TOKEN_TTL_SECONDS = 30 * 24 * 3600;
// Match the in-app label exactly (see getCurrentVerificationCutoffLabel in
// create_canadian_leaderboard_from_jsonl.js).
function getSeasonStartLabel(date = new Date()) {
    const year = date.getUTCMonth() >= 9 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    return `October 1st, ${year}`;
}

function getFirstName(pilotName) {
    return String(pilotName || '').trim().split(/\s+/)[0] || '';
}

function getEstimatedHours(pilotCombinedHours, pilotId) {
    const entry = pilotCombinedHours && pilotCombinedHours[String(pilotId)];
    if (!entry) return null;
    // Use the *beforeCutoff* combined hours — that's the figure the leaderboard uses
    // for the under-200 eligibility test, and matches what the verify form pre-fills.
    return Number(entry.combinedHoursBeforeCutoff ?? entry.combinedHours ?? 0) || 0;
}

function isEligibleUnder200(pilotCombinedHours, pilotId) {
    const entry = pilotCombinedHours && pilotCombinedHours[String(pilotId)];
    return Boolean(entry && entry.eligibleUnder200);
}

function isAlreadyVerified(state, pilotId) {
    const key = String(pilotId);
    const picMap = (state && state.picHoursVerifications) || {};
    return Boolean(picMap[key]);
}

function isAlreadyNotified(state, pilotId) {
    const key = String(pilotId);
    const notifiedMap = (state && state.notifiedPilots) || {};
    return Boolean(notifiedMap[key]);
}

function pickDefaultContest(ranks) {
    for (const slug of DEFAULT_CONTEST_PRIORITY) {
        if (ranks[slug] != null) return slug;
    }
    return DEFAULT_CONTEST_PRIORITY[0];
}

/**
 * Compute the dedup'd set of pilots who are top-N on either target leaderboard,
 * are eligible-under-200, are not already verified, and have not yet been notified.
 *
 * Pure function — no I/O, no env reads. Caller passes `state` and `leaderboardData`.
 *
 * Returns { candidates, skipped } where:
 *   candidates: [{ pilotId, pilotName, firstName, picHoursEstimate, ranks, defaultContest }]
 *   skipped:    { ineligible, alreadyVerified, alreadyNotified, missingPilotName }
 *
 * `candidates` is ordered: by best (lowest) rank across boards, then by pilotId for stability.
 */
function computeNotificationCandidates({ leaderboardData, state, topN = DEFAULT_TOP_N } = {}) {
    if (!leaderboardData || typeof leaderboardData !== 'object') {
        throw new Error('leaderboardData is required');
    }

    const pilotCombinedHours = leaderboardData.pilotCombinedHours || {};
    const pilotProfiles = leaderboardData.pilotProfiles || {};

    // For each target board: filter to eligibleUnder200 *first*, THEN take top N.
    // Rank within the under-200 sub-leaderboard (1..N), not the overall board rank.
    const byPilot = new Map(); // pilotId -> { pilotId, pilotName, ranks: { slug: rank } }
    for (const board of TARGET_BOARDS) {
        const entries = Array.isArray(leaderboardData[board.key]) ? leaderboardData[board.key] : [];
        const eligibleEntries = entries.filter(entry =>
            entry && entry.pilotId != null && isEligibleUnder200(pilotCombinedHours, entry.pilotId)
        );
        const top = eligibleEntries.slice(0, topN);
        top.forEach((entry, idx) => {
            const pilotId = entry.pilotId;
            const rank = idx + 1;
            const existing = byPilot.get(pilotId) || {
                pilotId,
                pilotName: entry.pilot || entry.pilotName || '',
                ranks: {},
                flights: []
            };
            existing.ranks[board.slug] = rank;
            if (!existing.pilotName && (entry.pilot || entry.pilotName)) {
                existing.pilotName = entry.pilot || entry.pilotName;
            }
            if (Array.isArray(entry.bestFlights)) {
                existing.flights.push(...entry.bestFlights);
            }
            byPilot.set(pilotId, existing);
        });
    }

    const candidates = [];
    const skipped = {
        alreadyVerified: [],
        alreadyNotified: [],
        missingPilotName: []
    };

    for (const item of byPilot.values()) {
        const { pilotId, pilotName, ranks } = item;
        if (!pilotName) {
            skipped.missingPilotName.push({ pilotId, ranks });
            continue;
        }
        if (isAlreadyVerified(state, pilotId)) {
            skipped.alreadyVerified.push({ pilotId, pilotName, ranks });
            continue;
        }
        if (isAlreadyNotified(state, pilotId)) {
            skipped.alreadyNotified.push({ pilotId, pilotName, ranks });
            continue;
        }

        const defaultContest = pickDefaultContest(ranks);
        candidates.push({
            pilotId,
            pilotName,
            firstName: getFirstName(pilotName),
            picHoursEstimate: getEstimatedHours(pilotCombinedHours, pilotId),
            ranks,
            defaultContest,
            bilingual: isQuebecPilotContext({
                profile: pilotProfiles[String(pilotId)] || pilotProfiles[pilotId] || null,
                flights: item.flights || []
            })
        });
    }

    // Order: best rank first (lowest number), then pilotId for stability
    candidates.sort((a, b) => {
        const aBest = Math.min(...Object.values(a.ranks));
        const bBest = Math.min(...Object.values(b.ranks));
        if (aBest !== bBest) return aBest - bBest;
        return a.pilotId - b.pilotId;
    });

    return { candidates, skipped };
}

function getContestLabel(slug) {
    const board = TARGET_BOARDS.find(b => b.slug === slug);
    return board ? board.label : slug;
}

function describeBoards(ranks) {
    const slugs = TARGET_BOARDS.map(b => b.slug).filter(s => ranks[s] != null);
    if (slugs.length === 0) return getContestLabel(DEFAULT_CONTEST_PRIORITY[0]);
    if (slugs.length === 1) return getContestLabel(slugs[0]);
    return slugs.map(getContestLabel).join(' and ');
}

/**
 * Build the verify, dismiss, and leaderboard URLs for a candidate.
 * `baseUrl` should NOT have a trailing slash.
 */
function buildMessageLinks({ baseUrl, candidate, tokenTtlSeconds = TOKEN_TTL_SECONDS }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!candidate || !candidate.pilotId) throw new Error('candidate.pilotId is required');

    const verifyToken = createVerificationToken({
        type: 'pic-direct',
        pilotId: String(candidate.pilotId),
        pilotName: candidate.pilotName || '',
        picHoursEstimate: candidate.picHoursEstimate ?? null
    }, tokenTtlSeconds);

    const dismissToken = createVerificationToken({
        type: 'dismissal',
        pilotId: String(candidate.pilotId),
        pilotName: candidate.pilotName || ''
    }, tokenTtlSeconds);

    return {
        verifyLink: `${baseUrl}/api/verify-pic-hours?token=${encodeURIComponent(verifyToken)}`,
        dismissLink: `${baseUrl}/api/dismiss-pic-verification?token=${encodeURIComponent(dismissToken)}`,
        leaderboardLink: `${baseUrl}/?contest=${encodeURIComponent(candidate.defaultContest)}&under200=1`
    };
}

function buildMessageBody({ candidate, links, seasonStartLabel = getSeasonStartLabel() }) {
    const boardsDescription = describeBoards(candidate.ranks);
    const english = `Hi ${candidate.firstName},

You're currently in the top 5 of the ${boardsDescription} under-200hr standings.

To keep the leaderboard accurate, please confirm your PIC hours:

• Under 200 hrs PIC as of ${seasonStartLabel}? Verify here:
  ${links.verifyLink}

• Over 200 hrs PIC as of ${seasonStartLabel}? Simply clicking this link will remove yourself from the under-200 list:
  ${links.dismissLink}

See your current standing here:
${links.leaderboardLink}

— Ryan Wood, SAC Sporting Committee`;

    if (!candidate.bilingual) {
        return english;
    }

    return `${english}

---

Bonjour ${candidate.firstName},

Vous êtes actuellement dans le top 5 du classement moins de 200 h (${boardsDescription}).

Pour garder le classement exact, veuillez confirmer vos heures PIC :

• Moins de 200 h PIC au ${seasonStartLabel} ? Confirmez ici :
  ${links.verifyLink}

• Plus de 200 h PIC au ${seasonStartLabel} ? Il suffit de cliquer sur ce lien pour vous retirer de la liste moins de 200 h :
  ${links.dismissLink}

Consultez votre classement ici :
${links.leaderboardLink}

— Ryan Wood, SAC Sporting Committee`;
}

module.exports = {
    computeNotificationCandidates,
    buildMessageLinks,
    buildMessageBody,
    getFirstName,
    getSeasonStartLabel,
    getContestLabel,
    describeBoards,
    DEFAULT_TOP_N,
    TARGET_BOARDS,
    TOKEN_TTL_SECONDS
};
