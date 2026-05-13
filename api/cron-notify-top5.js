const notifyTop5 = require('./notify-top5');

function getHeader(req, name) {
    const target = name.toLowerCase();
    const headers = req.headers || {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) {
            return Array.isArray(value) ? value[0] : value;
        }
    }
    return '';
}

function isAuthorizedCron(req) {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret) {
        return false;
    }
    return getHeader(req, 'authorization') === `Bearer ${secret}`;
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isAuthorizedCron(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.query = {
        ...(req.query || {}),
        send: '1',
        token: process.env.UPDATE_TOKEN || ''
    };

    return notifyTop5(req, res);
};
