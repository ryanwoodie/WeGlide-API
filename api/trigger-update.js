const fetchAndBuild = require('./fetch-and-build');
const { isUpdateAuthorized } = require('../lib/update-auth');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isUpdateAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const limitOverride = req.query?.max_flights ? parseInt(req.query.max_flights, 10) : undefined;
        const forceBuild = req.query?.force === 'true';
        const fullRefresh = req.query?.fullRefresh === 'true';
        const summary = await fetchAndBuild.runFetchAndBuild({
            trigger: req.query?.source || 'manual',
            limitOverride,
            forceBuild,
            fullRefresh
        });
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
