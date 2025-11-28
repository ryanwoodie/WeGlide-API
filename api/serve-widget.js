const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
    // Enable CORS so any site can load the widget
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Cache for 1 hour, immutable versioning recommended for prod but 1h fine for now
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    try {
        const filePath = path.join(process.cwd(), 'src/web-component/sac-leaderboard.js');
        const content = fs.readFileSync(filePath, 'utf8');
        res.send(content);
    } catch (error) {
        console.error('Error serving widget:', error);
        res.status(500).send('console.error("Failed to load SAC Leaderboard widget");');
    }
};
