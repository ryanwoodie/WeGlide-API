const { fetch } = require('undici'); // Vercel Node.js runtimes include fetch, but just in case
// In Node 18+ fetch is global.

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_BASE_URL = process.env.BLOB_BASE_URL || 'https://blob.vercel-storage.com';
const LEADERBOARD_KEY = 'SAC_leaderboard_sac_dsc.html';

module.exports = async (req, res) => {
    // If no Blob token, we might be in a build where we just want to serve the static file
    // But this is an API route.
    if (!BLOB_TOKEN) {
        return res.status(500).send('Missing BLOB_READ_WRITE_TOKEN');
    }

    try {
        const blobUrl = `${BLOB_BASE_URL.replace(/\/$/, '')}/${LEADERBOARD_KEY}`;
        const response = await fetch(blobUrl, {
            headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
        });

        if (response.status === 404) {
             // Fallback: if not in blob yet, maybe redirect to the static file?
             // But we can't easily redirect to "myself" if I'm replacing the route.
             return res.status(404).send('Leaderboard not found in storage');
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch leaderboard: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Cache for 60 seconds
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        res.send(html);
    } catch (error) {
        console.error('Error serving leaderboard:', error);
        res.status(500).send('Internal Server Error');
    }
};
