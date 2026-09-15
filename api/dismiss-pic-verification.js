/**
 * Vercel Serverless Function: One-click "I'm over 200hr PIC, remove me from
 * the under-200 leaderboard". Records pilotId as ineligible (picHours=200).
 *
 * Also accepts type='silver-dismissal' for Silver C-Gull removal only.
 * Tokens must be signed with VERIFICATION_TOKEN_SECRET.
 * Tokens are issued by the WeGlide direct-message notification flow.
 *
 * Usage (clicked by pilot from a WeGlide DM):
 *   GET /api/dismiss-pic-verification?token=<signed>
 */

const { verifyVerificationToken } = require('../lib/verification-token');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPage(title, message, success = false) {
    const color = success ? '#155724' : '#721c24';
    const background = success ? '#d4edda' : '#f8d7da';
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;font-family:Arial,sans-serif;background:#f2f5f8;color:#222;">
    <main style="max-width:640px;margin:40px auto;padding:24px;">
        <div style="background:${background};color:${color};padding:20px;border-radius:10px;">
            <h1 style="margin:0 0 12px 0;font-size:28px;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 16px 0;">${escapeHtml(message)}</p>
            <p style="margin:0;"><a href="/" style="color:inherit;font-weight:700;">Return to the leaderboard</a></p>
        </div>
    </main>
</body>
</html>`;
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(405).send(renderPage('Method not allowed', 'This dismissal link only accepts GET requests.'));
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');

    try {
        const token = String(req.query?.token || '').trim();
        const payload = verifyVerificationToken(token);

        if (!['dismissal', 'silver-dismissal'].includes(payload.type)) {
            return res.status(400).send(renderPage(
                'Invalid link',
                'This link is not a dismissal link. Please use the original link from the message.'
            ));
        }
        if (!payload.pilotId) {
            return res.status(400).send(renderPage('Invalid link', 'Token is missing pilot identity.'));
        }

        const isSilver = payload.type === 'silver-dismissal';
        const state = await loadVerificationState({ requireRemote: true });
        const verifiedDate = new Date().toISOString();
        const pilotName = payload.pilotName || 'Pilot';

        if (isSilver) {
            state.dobVerifications[String(payload.pilotId)] = {
                pilotName,
                verifiedDate,
                eligible: false,
                reason: 'silver-before-season',
                dataSource: 'self-claim-via-direct-message-dismissal'
            };
        } else {
            state.picHoursVerifications[String(payload.pilotId)] = {
                pilotName,
                picHours: 200,
                verifiedDate,
                eligible: false,
                dataSource: 'self-claim-via-direct-message-dismissal'
            };
        }

        const saved = await saveVerificationState(
            state,
            `chore: dismiss ${isSilver ? 'Silver C-Gull' : 'under-200'} status for ${pilotName} (${payload.pilotId})`
        );
        if (!saved?.persisted) {
            return res.status(503).send(renderPage('Removal not saved', 'The shared database is temporarily unavailable. Please try this link again later.'));
        }

        if (isSilver) {
            return res.status(200).send(renderPage('Removed from Silver C-Gull list',
                `${pilotName}, you've confirmed that you received your Silver badge before this season. You will no longer appear on the Silver C-Gull candidate list. Your PIC-hours status has not changed.`, true));
        }

        return res.status(200).send(renderPage(
            'Removed from under-200 list',
            `${pilotName}, you've been recorded as ≥200 hours PIC. You'll no longer appear on the SAC under-200 leaderboard. Thanks for helping keep it accurate.`,
            true
        ));
    } catch (error) {
        console.error('[dismiss-pic-verification] Error:', error);
        return res.status(400).send(renderPage(
            'Dismissal failed',
            error.message || 'This link is invalid or expired.'
        ));
    }
};
