/**
 * Vercel Serverless Function: Direct-input PIC hours verification.
 *
 * GET  /api/verify-pic-hours?token=<signed>   → renders a one-field form,
 *                                                pre-filled with the WeGlide+OLC
 *                                                estimate from the token.
 * POST /api/verify-pic-hours                  → consumes form (token + picHours),
 *                                                writes state, renders confirmation.
 *
 * Token must be type='pic-direct' and signed with VERIFICATION_TOKEN_SECRET.
 * No email round-trip — the pilot is implicitly authenticated by being the
 * recipient of the WeGlide direct message that delivered the token.
 */

const { verifyVerificationToken } = require('../lib/verification-token');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');
const { getSeasonStartLabel } = require('../lib/notify-top5');

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderShell(title, bodyHtml) {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
        body { margin:0; font-family:Arial,sans-serif; background:#f2f5f8; color:#222; }
        main { max-width:640px; margin:40px auto; padding:24px; }
        .card { background:#fff; padding:24px; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,0.05); }
        .card.success { background:#d4edda; color:#155724; }
        .card.error { background:#f8d7da; color:#721c24; }
        h1 { margin:0 0 12px 0; font-size:24px; }
        label { display:block; font-weight:600; margin:16px 0 6px; }
        input[type=number] { width:100%; padding:10px; font-size:16px; border:1px solid #c8c8c8; border-radius:6px; box-sizing:border-box; }
        button { margin-top:20px; padding:12px 24px; font-size:16px; font-weight:700; background:#1565c0; color:#fff; border:none; border-radius:6px; cursor:pointer; }
        button:hover { background:#0b4a98; }
        .hint { color:#555; font-size:14px; margin:6px 0 0; }
        a { color:inherit; font-weight:700; }
    </style>
</head>
<body>
    <main>${bodyHtml}</main>
</body>
</html>`;
}

function renderForm({ token, pilotName, picHoursEstimate, errorMessage }) {
    const seasonStartLabel = getSeasonStartLabel();
    const errorBlock = errorMessage
        ? `<p style="background:#f8d7da;color:#721c24;padding:10px;border-radius:6px;margin:0 0 16px 0;">${escapeHtml(errorMessage)}</p>`
        : '';
    const prefillValue = (picHoursEstimate != null && Number.isFinite(Number(picHoursEstimate)))
        ? Number(picHoursEstimate).toFixed(1)
        : '';
    return renderShell('Verify your PIC hours', `
        <div class="card">
            <h1>Verify your PIC hours</h1>
            <p>Hi ${escapeHtml(pilotName || 'pilot')}, please confirm your total PIC (Pilot in Command) hours <strong>as of ${escapeHtml(seasonStartLabel)}</strong>.</p>
            ${errorBlock}
            <form method="POST" action="/api/verify-pic-hours">
                <input type="hidden" name="token" value="${escapeHtml(token)}" />
                <label for="picHours">PIC hours</label>
                <input id="picHours" name="picHours" type="number" min="0" max="50000" step="0.1" value="${escapeHtml(prefillValue)}" required />
                <p class="hint">Pre-filled with our WeGlide + OLC estimate. Adjust if you have additional hours not captured there.</p>
                <button type="submit">Submit</button>
            </form>
        </div>
    `);
}

function renderResult({ pilotName, picHours, eligible }) {
    const headline = eligible
        ? 'Verified — you remain eligible for the under-200 leaderboard'
        : 'Verified — you have been moved off the under-200 leaderboard';
    const detail = `${pilotName || 'Pilot'}: ${picHours.toFixed(1)} hrs PIC recorded. Thanks for helping keep the leaderboard accurate.`;
    return renderShell('Verification confirmed', `
        <div class="card success">
            <h1>${escapeHtml(headline)}</h1>
            <p>${escapeHtml(detail)}</p>
            <p><a href="/">Return to the leaderboard</a></p>
        </div>
    `);
}

function renderError(message) {
    return renderShell('Verification failed', `
        <div class="card error">
            <h1>Verification failed</h1>
            <p>${escapeHtml(message)}</p>
            <p><a href="/">Return to the leaderboard</a></p>
        </div>
    `);
}

async function readFormBody(req) {
    if (req.body) {
        if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
            return req.body;
        }
        const text = typeof req.body === 'string'
            ? req.body
            : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        return Object.fromEntries(new URLSearchParams(text));
    }
    // Fallback: read raw stream
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

module.exports = async (req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');

    if (req.method === 'GET') {
        try {
            const token = String(req.query?.token || '').trim();
            const payload = verifyVerificationToken(token);
            if (payload.type !== 'pic-direct') {
                return res.status(400).send(renderError('This link is not a verification link. Please use the original link from the message.'));
            }
            return res.status(200).send(renderForm({
                token,
                pilotName: payload.pilotName,
                picHoursEstimate: payload.picHoursEstimate
            }));
        } catch (error) {
            console.error('[verify-pic-hours GET] Error:', error);
            return res.status(400).send(renderError(error.message || 'This link is invalid or expired.'));
        }
    }

    if (req.method === 'POST') {
        try {
            const body = await readFormBody(req);
            const token = String(body.token || '').trim();
            const payload = verifyVerificationToken(token);
            if (payload.type !== 'pic-direct') {
                return res.status(400).send(renderError('Token is not for direct PIC verification.'));
            }
            if (!payload.pilotId) {
                return res.status(400).send(renderError('Token is missing pilot identity.'));
            }

            const picHoursRaw = Number(body.picHours);
            if (!Number.isFinite(picHoursRaw) || picHoursRaw < 0 || picHoursRaw > 50000) {
                return res.status(400).send(renderForm({
                    token,
                    pilotName: payload.pilotName,
                    picHoursEstimate: payload.picHoursEstimate,
                    errorMessage: 'Please enter a valid number of PIC hours between 0 and 50000.'
                }));
            }

            const picHours = Number(picHoursRaw.toFixed(1));
            const eligible = picHours < 200;
            const verifiedDate = new Date().toISOString();
            const pilotName = payload.pilotName || 'Pilot';

            const state = await loadVerificationState();
            state.picHoursVerifications[String(payload.pilotId)] = {
                pilotName,
                picHours,
                verifiedDate,
                eligible,
                dataSource: 'self-submitted-via-direct-message'
            };

            await saveVerificationState(
                state,
                `chore: record self-submitted PIC hours for ${pilotName} (${payload.pilotId})`
            );

            return res.status(200).send(renderResult({ pilotName, picHours, eligible }));
        } catch (error) {
            console.error('[verify-pic-hours POST] Error:', error);
            return res.status(400).send(renderError(error.message || 'Verification failed.'));
        }
    }

    return res.status(405).send(renderError('Method not allowed.'));
};
