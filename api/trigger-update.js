const fetchAndBuild = require('./fetch-and-build');

function isAuthorized(req) {
    const providedToken = (req.headers['x-update-token'] || req.query?.token || req.body?.token || '').trim();
    if (process.env.UPDATE_TOKEN && providedToken !== process.env.UPDATE_TOKEN) {
        return false;
    }
    return true;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const summary = await fetchAndBuild.runFetchAndBuild({ trigger: req.query?.source || 'manual' });
        const statusCode = summary.status === 'error' ? 500 : 200;
        return res.status(statusCode).json(summary);
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
};
