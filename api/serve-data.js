const fs = require('fs');
const path = require('path');

const DATA_FILE = 'leaderboard_data.json';

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Serve from public/ directory
        const filePath = path.join(process.cwd(), 'public', DATA_FILE);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Data not found. Please wait for the next build.' });
        }

        const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Serve JSON
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        res.status(200).json(jsonData);

    } catch (error) {
        console.error('Error serving data:', error);
        res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
};
