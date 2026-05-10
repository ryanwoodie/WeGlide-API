/**
 * Vercel Serverless Function: Compute who should be notified about being in the
 * SAC under-200hr top-5 (SAC-DSC + Free Contest).
 *
 * STEP 1 of the rollout: dry-run only. This endpoint never sends a message and
 * never writes state. It exists so we can review the candidate list before any
 * sending code lives in the codebase.
 *
 * Auth: same pattern as api/trigger-update.js (UPDATE_TOKEN).
 *
 * Usage:
 *   GET /api/notify-top5?token=<UPDATE_TOKEN>
 */

const fs = require('fs');
const path = require('path');

const { computeNotificationCandidates, DEFAULT_TOP_N } = require('../lib/notify-top5');
const { loadVerificationState } = require('../lib/verification-store');

const LEADERBOARD_DATA_FILE = process.env.LEADERBOARD_DATA_FILE
    || path.join('public', 'leaderboard_data.json');

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

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const topN = req.query?.topN ? Math.max(1, Math.min(50, parseInt(req.query.topN, 10) || DEFAULT_TOP_N)) : DEFAULT_TOP_N;

        const leaderboardData = loadLeaderboardData();
        const state = await loadVerificationState();

        const result = computeNotificationCandidates({ leaderboardData, state, topN });

        return res.status(200).json({
            ok: true,
            mode: 'dry-run',
            note: 'STEP 1 of rollout — this endpoint never sends or writes state',
            topN,
            seasonLabel: leaderboardData.meta?.seasonLabel || null,
            generatedAt: leaderboardData.meta?.generatedAt || null,
            counts: {
                candidates: result.candidates.length,
                alreadyVerifiedSkipped: result.skipped.alreadyVerified.length,
                alreadyNotifiedSkipped: result.skipped.alreadyNotified.length,
                missingPilotNameSkipped: result.skipped.missingPilotName.length
            },
            candidates: result.candidates,
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
