const { verifyVerificationToken } = require('../lib/verification-token');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');

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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).send(renderPage('Method not allowed', 'This verification link only accepts GET requests.'));
    }

    try {
        const token = String(req.query?.token || '').trim();
        const payload = verifyVerificationToken(token);
        const state = await loadVerificationState();
        const verifiedDate = new Date().toISOString();

        if (payload.type === 'dob') {
            state.dobVerifications[payload.pilotId] = {
                pilotName: payload.pilotName,
                dateOfBirth: payload.dateOfBirth,
                verifiedDate,
                dataSource: 'email-verified',
                email: payload.email
            };
        } else {
            state.picHoursVerifications[payload.pilotId] = {
                pilotName: payload.pilotName,
                picHours: payload.picHours,
                verifiedDate,
                eligible: payload.picHours < 200,
                dataSource: 'email-verified',
                email: payload.email
            };
        }

        await saveVerificationState(
            state,
            `chore: update verification state for ${payload.pilotName} (${payload.pilotId})`
        );

        return res.status(200).send(renderPage(
            'Verification confirmed',
            `${payload.pilotName} has been updated on the SAC Leaderboard.`,
            true
        ));
    } catch (error) {
        console.error('[complete-verification] Error:', error);
        return res.status(400).send(renderPage(
            'Verification failed',
            error.message || 'This verification link is invalid or expired.'
        ));
    }
};
