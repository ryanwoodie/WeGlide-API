/**
 * Vercel Serverless Function: notify the top-5 under-200hr pilots that they're
 * on the leaderboard, asking them to verify or dismiss.
 *
 * Modes:
 *   GET /api/notify-top5?token=<UPDATE_TOKEN>            → dry-run (default).
 *      Returns the candidate list and the message body that would be sent.
 *      Never calls WeGlide. Never writes state.
 *
 *   GET /api/notify-top5?token=...&send=1                → send mode.
 *      Picks AT MOST ONE candidate (the best-ranked, not-yet-notified one),
 *      sends them a WeGlide DM, then writes notifiedPilots[pilotId] to state
 *      so the same pilot is not messaged again.
 *
 * Hard cap: 1 message per request invocation. Combined with the cron's
 * ~5 min cadence this drains the queue in N*5 minutes for N candidates,
 * with each send checked individually against runaway-messaging risk.
 *
 * Env:
 *   UPDATE_TOKEN              auth gate (same as api/trigger-update.js)
 *   PUBLIC_BASE_URL           base URL for verify/dismiss/leaderboard links
 *                             in message bodies (e.g. https://sac-leaderboard.vercel.app)
 *   WEGLIDE_USERNAME, WEGLIDE_PASSWORD  required for send mode
 *   VERIFICATION_TOKEN_SECRET required for token signing
 */

const fs = require('fs');
const path = require('path');

const {
    computeNotificationCandidates,
    buildMessageLinks,
    buildMessageBody,
    DEFAULT_TOP_N
} = require('../lib/notify-top5');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');
const { sendUserMessage } = require('../lib/weglide-message');

const LEADERBOARD_DATA_FILE = process.env.LEADERBOARD_DATA_FILE
    || path.join('public', 'leaderboard_data.json');
const MAX_SENDS_PER_RUN = 1;

function isAuthorized(req) {
    const providedToken = (req.headers['x-update-token'] || req.query?.token || req.body?.token || '').trim();
    if (process.env.UPDATE_TOKEN && providedToken !== process.env.UPDATE_TOKEN) {
        return false;
    }
    return true;
}

function loadLeaderboardData() {
    const localPath = path.isAbsolute(LEADERBOARD_DATA_FILE)
        ? LEADERBOARD_DATA_FILE
        : path.join(process.cwd(), LEADERBOARD_DATA_FILE);
    if (!fs.existsSync(localPath)) {
        const error = new Error(`Leaderboard data file not found: ${localPath}`);
        error.code = 'LEADERBOARD_DATA_MISSING';
        throw error;
    }
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
}

function resolveBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) {
        return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    }
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (!host) {
        throw new Error('Cannot resolve base URL: no Host header and PUBLIC_BASE_URL is not set');
    }
    return `${proto}://${host}`;
}

function isTrueish(v) {
    return v === '1' || v === 'true' || v === 'yes';
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const sendRequested = isTrueish((req.query?.send || '').toString().toLowerCase());
        const topN = req.query?.topN
            ? Math.max(1, Math.min(50, parseInt(req.query.topN, 10) || DEFAULT_TOP_N))
            : DEFAULT_TOP_N;

        const leaderboardData = loadLeaderboardData();
        const state = await loadVerificationState();
        const baseUrl = resolveBaseUrl(req);

        const result = computeNotificationCandidates({ leaderboardData, state, topN });

        const candidatesWithMessages = result.candidates.map(candidate => {
            const links = buildMessageLinks({ baseUrl, candidate });
            return {
                ...candidate,
                messageBody: buildMessageBody({ candidate, links }),
                links
            };
        });

        if (!sendRequested) {
            return res.status(200).json({
                ok: true,
                mode: 'dry-run',
                note: 'No `send=1` query — nothing was transmitted and state was not modified.',
                topN,
                baseUrl,
                seasonLabel: leaderboardData.meta?.seasonLabel || null,
                generatedAt: leaderboardData.meta?.generatedAt || null,
                counts: {
                    candidates: candidatesWithMessages.length,
                    alreadyVerifiedSkipped: result.skipped.alreadyVerified.length,
                    alreadyNotifiedSkipped: result.skipped.alreadyNotified.length,
                    missingPilotNameSkipped: result.skipped.missingPilotName.length
                },
                candidates: candidatesWithMessages,
                skipped: result.skipped
            });
        }

        // ----- send mode -----
        if (candidatesWithMessages.length === 0) {
            return res.status(200).json({
                ok: true,
                mode: 'send',
                sent: [],
                skippedSendQueueFull: false,
                note: 'No candidates to notify. Queue is empty.',
                counts: {
                    candidates: 0,
                    alreadyVerifiedSkipped: result.skipped.alreadyVerified.length,
                    alreadyNotifiedSkipped: result.skipped.alreadyNotified.length,
                    missingPilotNameSkipped: result.skipped.missingPilotName.length
                },
                skipped: result.skipped
            });
        }

        const queueRemaining = candidatesWithMessages.slice(MAX_SENDS_PER_RUN);
        const toSend = candidatesWithMessages.slice(0, MAX_SENDS_PER_RUN);

        const sent = [];
        for (const candidate of toSend) {
            const sendResponse = await sendUserMessage({
                recipientId: candidate.pilotId,
                message: candidate.messageBody
            });

            const stateNow = await loadVerificationState();
            stateNow.notifiedPilots = stateNow.notifiedPilots || {};
            stateNow.notifiedPilots[String(candidate.pilotId)] = {
                pilotName: candidate.pilotName,
                ranks: candidate.ranks,
                defaultContest: candidate.defaultContest,
                picHoursEstimate: candidate.picHoursEstimate,
                notifiedAt: new Date().toISOString(),
                channel: 'weglide-direct-message'
            };

            const persistResult = await saveVerificationState(
                stateNow,
                `chore: notify under-200 top-5 pilot ${candidate.pilotName} (${candidate.pilotId})`
            );

            sent.push({
                pilotId: candidate.pilotId,
                pilotName: candidate.pilotName,
                ranks: candidate.ranks,
                statePersisted: Boolean(persistResult && persistResult.persisted),
                weglideStatus: sendResponse?.status ?? null
            });
        }

        return res.status(200).json({
            ok: true,
            mode: 'send',
            sent,
            sendCap: MAX_SENDS_PER_RUN,
            queueRemaining: queueRemaining.map(c => ({
                pilotId: c.pilotId,
                pilotName: c.pilotName,
                ranks: c.ranks
            })),
            counts: {
                candidates: candidatesWithMessages.length,
                alreadyVerifiedSkipped: result.skipped.alreadyVerified.length,
                alreadyNotifiedSkipped: result.skipped.alreadyNotified.length,
                missingPilotNameSkipped: result.skipped.missingPilotName.length
            },
            skipped: result.skipped
        });
    } catch (error) {
        console.error('[notify-top5] Error:', error);
        return res.status(500).json({
            ok: false,
            error: error.message,
            code: error.code
        });
    }
};
