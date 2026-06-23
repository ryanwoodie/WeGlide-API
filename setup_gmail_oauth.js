const http = require('http');
const { spawn } = require('child_process');
const { google } = require('googleapis');
const { GMAIL_API_SCOPE } = require('./lib/verification-email');

const DEFAULT_REDIRECT_URI = process.env.GMAIL_OAUTH_REDIRECT_URI || 'http://127.0.0.1:3005/oauth2callback';
const OAUTH_SCOPES = [
    GMAIL_API_SCOPE,
    'https://www.googleapis.com/auth/userinfo.email'
];

function getArg(name) {
    const prefix = `--${name}=`;
    const entry = process.argv.find((value) => value.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : '';
}

function getRequiredConfig() {
    const clientId = getArg('client-id') || process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = getArg('client-secret') || process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = getArg('redirect-uri') || DEFAULT_REDIRECT_URI;

    if (!clientId || !clientSecret) {
        throw new Error(
            'Missing OAuth client credentials. Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET or pass --client-id and --client-secret.'
        );
    }

    return {
        clientId,
        clientSecret,
        redirectUri
    };
}

function parseRedirectUri(redirectUri) {
    const parsed = new URL(redirectUri);

    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
        throw new Error('Redirect URI must use localhost or 127.0.0.1 for the local OAuth helper.');
    }

    return {
        hostname: parsed.hostname,
        port: Number(parsed.port || 80),
        pathname: parsed.pathname
    };
}

function openBrowser(url) {
    const candidates = process.platform === 'darwin'
        ? [['open', [url]]]
        : process.platform === 'win32'
            ? [['cmd', ['/c', 'start', '', url]]]
            : [['xdg-open', [url]]];

    for (const [command, args] of candidates) {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore'
        });

        child.on('error', () => {});
        child.unref();
        return;
    }
}

function waitForCode(serverConfig) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const requestUrl = new URL(req.url, `http://${req.headers.host}`);

            if (requestUrl.pathname !== serverConfig.pathname) {
                res.statusCode = 404;
                res.end('Not found');
                return;
            }

            const error = requestUrl.searchParams.get('error');
            const code = requestUrl.searchParams.get('code');

            if (error) {
                res.statusCode = 400;
                res.end('Google returned an OAuth error. You can close this tab.');
                server.close();
                reject(new Error(`Google OAuth error: ${error}`));
                return;
            }

            if (!code) {
                res.statusCode = 400;
                res.end('Missing authorization code. You can close this tab.');
                return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><body style="font-family: Arial, sans-serif; padding: 32px;"><h1>Authorization complete</h1><p>You can return to the terminal.</p></body></html>');

            server.close();
            resolve(code);
        });

        server.on('error', reject);
        server.listen(serverConfig.port, serverConfig.hostname, () => {
            console.log(`Listening for Google OAuth callback on ${serverConfig.hostname}:${serverConfig.port}${serverConfig.pathname}`);
        });
    });
}

async function main() {
    const config = getRequiredConfig();
    const serverConfig = parseRedirectUri(config.redirectUri);
    const oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret,
        config.redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: OAUTH_SCOPES
    });

    console.log('Open this URL and sign into the Gmail account you want the app to send from:');
    console.log(authUrl);
    console.log('');

    openBrowser(authUrl);

    const code = await waitForCode(serverConfig);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token. Remove prior access for this OAuth client and rerun with prompt=consent.');
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({
        version: 'v2',
        auth: oauth2Client
    });
    const profile = await oauth2.userinfo.get();
    const emailAddress = String(profile.data.email || '').trim();

    if (!emailAddress) {
        throw new Error('Google OAuth completed, but no email address was returned for the authorized account.');
    }

    console.log('Set these Vercel production env vars:');
    console.log(`GMAIL_OAUTH_CLIENT_ID=${config.clientId}`);
    console.log(`GMAIL_OAUTH_CLIENT_SECRET=${config.clientSecret}`);
    console.log(`GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GMAIL_OAUTH_REDIRECT_URI=${config.redirectUri}`);
    console.log(`GMAIL_OAUTH_USER=${emailAddress}`);
    console.log(`EMAIL_FROM=${emailAddress}`);
    console.log('');
    console.log('After setting those, redeploy and verify the request-verification endpoint.');
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
