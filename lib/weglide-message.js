'use strict';

const WEGLIDE_API_BASE = 'https://api.weglide.org';
const WEGLIDE_TOKEN_ENDPOINT = `${WEGLIDE_API_BASE}/v1/auth/token`;
const WEGLIDE_MESSAGE_ENDPOINT = `${WEGLIDE_API_BASE}/v1/usermessage`;

// Public client_id embedded in WeGlide's front-end JS bundle
// (https://www.weglide.org/assets/router-*.js). Not a secret.
const WEGLIDE_CLIENT_ID = 'hhUwyOpRS1SXlPryZTc7sLE2';
const WEGLIDE_SCOPE = 'declare upload';

const MAX_MESSAGE_LENGTH = 5000;

// Browser-mimicking headers; WeGlide's edge (Cloudflare) returns 403 on
// requests that look too "bot-like". The cURL captured from DevTools used
// these, and dropping them produced a 403.
const BROWSER_HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en',
    'origin': 'https://www.weglide.org',
    'referer': 'https://www.weglide.org/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
};

// In-process cache so multiple sends in one Node invocation share a login.
let cachedToken = null; // { access_token, expires_at }

function getCredentials() {
    const username = process.env.WEGLIDE_USERNAME;
    const password = process.env.WEGLIDE_PASSWORD;
    if (!username || !password) {
        const error = new Error('WEGLIDE_USERNAME and WEGLIDE_PASSWORD must be set');
        error.code = 'WEGLIDE_AUTH_MISSING';
        throw error;
    }
    return { username, password };
}

function redact(value) {
    if (!value) return '<missing>';
    if (value.length <= 8) return '***';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function login() {
    const { username, password } = getCredentials();
    const body = new URLSearchParams({
        grant_type: 'password',
        username,
        password,
        client_id: WEGLIDE_CLIENT_ID,
        scope: WEGLIDE_SCOPE
    }).toString();

    const response = await fetch(WEGLIDE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            ...BROWSER_HEADERS,
            'content-type': 'application/x-www-form-urlencoded'
        },
        body
    });

    const text = await response.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch (_) { /* leave as text */ }

    if (!response.ok) {
        const error = new Error(`WeGlide login failed: ${response.status} ${response.statusText}`);
        error.code = 'WEGLIDE_LOGIN_FAILED';
        error.status = response.status;
        error.responseBody = parsed;
        throw error;
    }

    if (!parsed || !parsed.access_token) {
        const error = new Error('WeGlide login response missing access_token');
        error.code = 'WEGLIDE_LOGIN_MALFORMED';
        error.responseBody = parsed;
        throw error;
    }

    return {
        access_token: parsed.access_token,
        // 30s safety margin so we don't use a token that expires mid-request
        expires_at: Date.now() + ((parsed.expires_in || 3600) - 30) * 1000
    };
}

async function getAccessToken() {
    if (cachedToken && cachedToken.expires_at > Date.now()) {
        return cachedToken.access_token;
    }
    cachedToken = await login();
    return cachedToken.access_token;
}

function buildSendRequest({ recipientId, message }) {
    const numericRecipient = Number(recipientId);
    if (!Number.isInteger(numericRecipient) || numericRecipient <= 0) {
        throw new Error(`Invalid recipientId: ${recipientId}`);
    }

    const trimmed = String(message || '').trim();
    if (!trimmed) {
        throw new Error('Message is empty');
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters`);
    }

    return {
        url: WEGLIDE_MESSAGE_ENDPOINT,
        method: 'POST',
        headers: {
            ...BROWSER_HEADERS,
            'content-type': 'application/json'
        },
        body: {
            recipient_id: numericRecipient,
            message: trimmed
        }
    };
}

async function sendUserMessage({ recipientId, message, dryRun = false }) {
    const request = buildSendRequest({ recipientId, message });

    if (dryRun) {
        // Validate credentials are present (so dry-run catches missing env)
        // but do NOT actually log in.
        getCredentials();
        return {
            dryRun: true,
            request: {
                url: request.url,
                method: request.method,
                headers: {
                    ...request.headers,
                    authorization: 'Bearer <fetched at send time>'
                },
                body: request.body
            }
        };
    }

    const accessToken = await getAccessToken();
    const response = await fetch(request.url, {
        method: request.method,
        headers: {
            ...request.headers,
            authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(request.body)
    });

    const responseText = await response.text();
    let responseBody = responseText;
    try { responseBody = JSON.parse(responseText); } catch (_) { /* leave as text */ }

    if (!response.ok) {
        const error = new Error(`WeGlide message send failed: ${response.status} ${response.statusText}`);
        error.code = 'WEGLIDE_SEND_FAILED';
        error.status = response.status;
        error.responseBody = responseBody;
        throw error;
    }

    return {
        dryRun: false,
        status: response.status,
        request: {
            url: request.url,
            method: request.method,
            headers: {
                ...request.headers,
                authorization: `Bearer ${redact(accessToken)}`
            },
            body: request.body
        },
        response: responseBody
    };
}

module.exports = {
    sendUserMessage,
    login,
    getAccessToken,
    buildSendRequest,
    WEGLIDE_API_BASE,
    WEGLIDE_TOKEN_ENDPOINT,
    WEGLIDE_MESSAGE_ENDPOINT,
    WEGLIDE_CLIENT_ID
};
