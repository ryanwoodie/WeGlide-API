const { fetch } = require('undici');

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_BASE_URL = process.env.BLOB_BASE_URL || 'https://blob.vercel-storage.com';
const LEADERBOARD_KEY = 'SAC_leaderboard_sac_dsc.html';

module.exports = async (req, res) => {
    if (!BLOB_TOKEN) {
        return res.status(500).send('Missing BLOB_READ_WRITE_TOKEN');
    }

    try {
        // 1. List blobs to find the latest URL for our key
        const listUrl = `${BLOB_BASE_URL.replace(/\/$/, '')}?limit=500`; // Fetch enough to find recent uploads
        const listResponse = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
        });

        if (!listResponse.ok) {
            throw new Error(`Failed to list blobs: ${listResponse.status} ${listResponse.statusText}`);
        }

        const data = await listResponse.json();
        
        // 2. Find all matches for our key
        const matches = (data.blobs || []).filter(b => b.pathname === LEADERBOARD_KEY);

        if (matches.length === 0) {
            return res.status(404).send('Leaderboard not found in storage');
        }

        // 3. Sort by uploadedAt desc to get the latest
        matches.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const latestBlob = matches[0];

        // 4. Fetch the content from the unique URL
        const response = await fetch(latestBlob.url);

        if (!response.ok) {
            throw new Error(`Failed to fetch blob content: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Cache for 60 seconds, allow stale-while-revalidate
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        res.send(html);

    } catch (error) {
        console.error('Error serving leaderboard:', error);
        res.status(500).send('Internal Server Error: ' + error.message);
    }
};