// fetch is global in Node 18+

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_BASE_URL = process.env.BLOB_BASE_URL || 'https://blob.vercel-storage.com';
const DATA_KEY = 'leaderboard_data.json';

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!BLOB_TOKEN) {
        return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });
    }

    try {
        // 1. List blobs to find the latest URL for our key
        const listUrl = `${BLOB_BASE_URL.replace(/\/$/, '')}?limit=500`; 
        const listResponse = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
        });

        if (!listResponse.ok) {
            throw new Error(`Failed to list blobs: ${listResponse.status} ${listResponse.statusText}`);
        }

        const data = await listResponse.json();
        
        // 2. Find all matches for our key
        const matches = (data.blobs || []).filter(b => b.pathname === DATA_KEY);

        if (matches.length === 0) {
            return res.status(404).json({ error: 'Data not found in storage' });
        }

        // 3. Sort by uploadedAt desc to get the latest
        matches.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const latestBlob = matches[0];

        // 4. Fetch the content from the unique URL
        const response = await fetch(latestBlob.url);

        if (!response.ok) {
            throw new Error(`Failed to fetch blob content: ${response.status} ${response.statusText}`);
        }

        const jsonData = await response.json();
        
        // Serve JSON
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        res.status(200).json(jsonData);

    } catch (error) {
        console.error('Error serving data:', error);
        res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
};
