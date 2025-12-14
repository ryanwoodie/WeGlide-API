const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = 'SAC_leaderboard_sac_dsc.html';

module.exports = async (req, res) => {
    try {
        // Serve from public/ directory
        const filePath = path.join(process.cwd(), 'public', LEADERBOARD_FILE);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Leaderboard not found. Please wait for the next build.');
        }

        const html = fs.readFileSync(filePath, 'utf8');

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Cache for 60 seconds, allow stale-while-revalidate
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        res.send(html);

    } catch (error) {
        console.error('Error serving leaderboard:', error);
        res.status(500).send('Internal Server Error: ' + error.message);
    }
};
