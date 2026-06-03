'use strict';

const { loadVerificationState } = require('../lib/verification-store');
const { resolveShortLink } = require('../lib/short-links');

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderError(message) {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Link unavailable</title>
</head>
<body style="margin:0;font-family:Arial,sans-serif;background:#f2f5f8;color:#222;">
    <main style="max-width:640px;margin:40px auto;padding:24px;">
        <div style="background:#f8d7da;color:#721c24;padding:20px;border-radius:10px;">
            <h1 style="margin:0 0 12px 0;font-size:28px;">Link unavailable</h1>
            <p style="margin:0 0 16px 0;">${escapeHtml(message)}</p>
            <p style="margin:0;"><a href="/" style="color:inherit;font-weight:700;">Return to the leaderboard</a></p>
        </div>
    </main>
</body>
</html>`;
}

function isAllowedTarget(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        const expectedBase = (process.env.PUBLIC_BASE_URL || 'https://sac-leaderboard.vercel.app').replace(/\/+$/, '');
        const expected = new URL(expectedBase);
        return parsed.origin === expected.origin &&
            (
                parsed.pathname === '/' ||
                parsed.pathname === '/api/verify-pic-hours' ||
                parsed.pathname === '/api/dismiss-pic-verification'
            );
    } catch (error) {
        return false;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(405).send(renderError('This short link only accepts GET requests.'));
    }

    try {
        const code = String(req.query?.code || '').trim();
        const state = await loadVerificationState();
        const entry = resolveShortLink(state, code);

        if (!isAllowedTarget(entry.targetUrl)) {
            throw new Error('Short link target is not allowed.');
        }

        res.statusCode = 302;
        res.setHeader('Location', entry.targetUrl);
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.status(statusCode).send(renderError(error.message || 'This short link is unavailable.'));
    }
};
