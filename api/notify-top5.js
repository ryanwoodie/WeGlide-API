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
 *   GET /api/notify-top5?token=...&pilotId=<id>          → restrict to that
 *      pilot only. Combine with send=1 for a one-off targeted send. The
 *      pilot must still satisfy all candidate criteria (under-200, not
 *      verified, not already notified) — the filter cannot bypass them.
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

const {
    computeNotificationCandidates,
    buildMessageLinks,
    buildMessageBody,
    DEFAULT_TOP_N
} = require('../lib/notify-top5');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');
const { sendUserMessage } = require('../lib/weglide-message');

const MAX_SENDS_PER_RUN = 1;

function isAuthorized(req) {
    const expected = (process.env.UPDATE_TOKEN || '').trim();
    const providedToken = (req.headers['x-update-token'] || req.query?.token || req.body?.token || '').trim();
    if (expected && providedToken !== expected) {
        return false;
    }
    return true;
}

async function loadLeaderboardData(baseUrl) {
    const url = `${baseUrl}/leaderboard_data.json`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        const error = new Error(`Leaderboard data fetch failed: ${response.status} ${response.statusText} (${url})`);
        error.code = 'LEADERBOARD_DATA_FETCH_FAILED';
        throw error;
    }
    return response.json();
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
        const pilotIdFilter = (req.query?.pilotId || '').toString().trim();

        const baseUrl = resolveBaseUrl(req);
        const leaderboardData = await loadLeaderboardData(baseUrl);
        const state = await loadVerificationState();

        const result = computeNotificationCandidates({ leaderboardData, state, topN });

        let filteredCandidates = result.candidates;
        if (pilotIdFilter) {
            filteredCandidates = result.candidates.filter(c => String(c.pilotId) === pilotIdFilter);
        }

        const candidatesWithMessages = filteredCandidates.map(candidate => {
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
                pilotIdFilter: pilotIdFilter || null,
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
            const note = pilotIdFilter
                ? `No candidate matched pilotId=${pilotIdFilter}. Either the pilot is not in the under-200 top-${topN}, has already been verified or notified, or pilotId does not exist.`
                : 'No candidates to notify. Queue is empty.';
            return res.status(200).json({
                ok: true,
                mode: 'send',
                sent: [],
                pilotIdFilter: pilotIdFilter || null,
                note,
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
        const failures = [];
        for (const candidate of toSend) {
            const startedAt = new Date().toISOString();
            console.log('[notify-top5] sending', JSON.stringify({
                event: 'weglide_send_attempt',
                pilotId: candidate.pilotId,
                pilotName: candidate.pilotName,
                ranks: candidate.ranks,
                triggeredVia: pilotIdFilter ? 'one-off-pilotId-filter' : 'top-5-queue',
                startedAt
            }));

            let sendResponse;
            try {
                sendResponse = await sendUserMessage({
                    recipientId: candidate.pilotId,
                    message: candidate.messageBody
                });
            } catch (sendError) {
                console.error('[notify-top5] send failed', JSON.stringify({
                    event: 'weglide_send_failed',
                    pilotId: candidate.pilotId,
                    pilotName: candidate.pilotName,
                    code: sendError.code,
                    status: sendError.status,
                    message: sendError.message,
                    responseBody: sendError.responseBody
                }));
                failures.push({
                    pilotId: candidate.pilotId,
                    pilotName: candidate.pilotName,
                    error: sendError.message,
                    code: sendError.code,
                    status: sendError.status
                });
                continue;
            }

            console.log('[notify-top5] send ok', JSON.stringify({
                event: 'weglide_send_ok',
                pilotId: candidate.pilotId,
                pilotName: candidate.pilotName,
                weglideStatus: sendResponse.status
            }));

            const stateNow = await loadVerificationState();
            stateNow.notifiedPilots = stateNow.notifiedPilots || {};
            stateNow.notifiedPilots[String(candidate.pilotId)] = {
                pilotName: candidate.pilotName,
                ranks: candidate.ranks,
                defaultContest: candidate.defaultContest,
                picHoursEstimate: candidate.picHoursEstimate,
                notifiedAt: startedAt,
                channel: 'weglide-direct-message',
                weglideStatus: sendResponse.status,
                triggeredVia: pilotIdFilter ? 'one-off-pilotId-filter' : 'top-5-queue'
            };

            const persistResult = await saveVerificationState(
                stateNow,
                `chore: notify under-200 top-5 pilot ${candidate.pilotName} (${candidate.pilotId})`
            );

            console.log('[notify-top5] state persisted', JSON.stringify({
                event: 'state_persisted',
                pilotId: candidate.pilotId,
                target: persistResult?.target,
                persisted: Boolean(persistResult?.persisted)
            }));

            sent.push({
                pilotId: candidate.pilotId,
                pilotName: candidate.pilotName,
                ranks: candidate.ranks,
                statePersisted: Boolean(persistResult && persistResult.persisted),
                statePersistTarget: persistResult?.target,
                weglideStatus: sendResponse.status
            });
        }

        return res.status(failures.length > 0 && sent.length === 0 ? 502 : 200).json({
            ok: failures.length === 0,
            mode: 'send',
            sent,
            failures,
            sendCap: MAX_SENDS_PER_RUN,
            pilotIdFilter: pilotIdFilter || null,
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
