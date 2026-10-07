const fs = require('fs');
const http = require('http');
const path = require('path');
const { getSeason } = require('./lib/seasons');

const PORT = Number(process.env.PORT || 8765);

http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let season;
    try {
        season = getSeason(url.searchParams.get('season') || undefined);
    } catch (error) {
        res.writeHead(400).end('Unknown soaring season');
        return;
    }

    if (req.method !== 'GET') {
        res.writeHead(405).end('Local preview is read only');
        return;
    }

    let filename;
    let contentType;
    if (url.pathname === '/' || url.pathname === '/sac-dsc') {
        filename = path.join(season.publicDir, 'SAC_leaderboard_sac_dsc.html');
        contentType = 'text/html; charset=utf-8';
    } else if (url.pathname === '/api/data') {
        filename = path.join(season.publicDir, 'leaderboard_data.json');
        contentType = 'application/json; charset=utf-8';
    } else if (url.pathname === '/api/verification-state') {
        filename = season.verificationFile;
        contentType = 'application/json; charset=utf-8';
    } else {
        res.writeHead(404).end('Not found');
        return;
    }

    try {
        const body = fs.readFileSync(path.join(__dirname, filename));
        res.writeHead(200, { 'Content-Type': contentType }).end(body);
    } catch (error) {
        res.writeHead(404).end('Preview artifact not found');
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log(`SAC preview: http://localhost:${PORT}/`);
});
