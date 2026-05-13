const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { get: getBlob, put: putBlob } = require('@vercel/blob');

const STATE_FILE = process.env.VERIFICATION_STATE_FILE || path.join('data', 'verification_state.json');
const STATE_BLOB_KEY = process.env.VERIFICATION_STATE_BLOB_KEY || 'verification_state.json';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null;
const BLOB_FALLBACK_ENABLED = /^(1|true|yes)$/i.test((process.env.ENABLE_BLOB_FALLBACK || '').trim());
const STATE_GITHUB_FILE = process.env.VERIFICATION_STATE_GITHUB_FILE || 'data/verification_state.secure.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ryanwoodie/WeGlide-API';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

function defaultState() {
    return {
        picHoursVerifications: {},
        dobVerifications: {},
        verificationRequests: [],
        notifiedPilots: {},
        notifiedNoClubPilots: {}
    };
}

function normalizeState(value) {
    const base = defaultState();
    if (!value || typeof value !== 'object') {
        return base;
    }

    return {
        picHoursVerifications: (value.picHoursVerifications && typeof value.picHoursVerifications === 'object')
            ? value.picHoursVerifications
            : base.picHoursVerifications,
        dobVerifications: (value.dobVerifications && typeof value.dobVerifications === 'object')
            ? value.dobVerifications
            : base.dobVerifications,
        verificationRequests: Array.isArray(value.verificationRequests)
            ? value.verificationRequests
            : base.verificationRequests,
        notifiedPilots: (value.notifiedPilots && typeof value.notifiedPilots === 'object')
            ? value.notifiedPilots
            : base.notifiedPilots,
        notifiedNoClubPilots: (value.notifiedNoClubPilots && typeof value.notifiedNoClubPilots === 'object')
            ? value.notifiedNoClubPilots
            : base.notifiedNoClubPilots
    };
}

function getLocalStatePath() {
    return path.join(process.cwd(), STATE_FILE);
}

function usingBlobFallback() {
    return Boolean(BLOB_TOKEN) && BLOB_FALLBACK_ENABLED;
}

function getStorageSecret() {
    return process.env.VERIFICATION_STORAGE_SECRET || process.env.VERIFICATION_TOKEN_SECRET || '';
}

function getGithubHeaders(accept = 'application/vnd.github.raw') {
    const headers = {
        'Accept': accept,
        'User-Agent': 'SAC-Leaderboard-Bot/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    return headers;
}

function encryptState(serialized) {
    const secret = getStorageSecret();
    if (!secret) {
        throw new Error('VERIFICATION_STORAGE_SECRET or VERIFICATION_TOKEN_SECRET is required for encrypted persistence');
    }

    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
        v: 1,
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
    });
}

function decryptState(encryptedPayload) {
    const secret = getStorageSecret();
    if (!secret) {
        throw new Error('VERIFICATION_STORAGE_SECRET or VERIFICATION_TOKEN_SECRET is required for encrypted persistence');
    }

    const payload = JSON.parse(encryptedPayload);
    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),
        decipher.final()
    ]);

    return decrypted.toString('utf8');
}

async function blobGetText() {
    const result = await getBlob(STATE_BLOB_KEY, {
        access: 'private',
        token: BLOB_TOKEN,
        useCache: false
    });

    if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
    }

    return new Response(result.stream).text();
}

async function fetchGithubFile() {
    if (!process.env.GITHUB_TOKEN) {
        return null;
    }

    const encodedPath = STATE_GITHUB_FILE.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
    const response = await fetch(url, { headers: getGithubHeaders() });

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`GitHub state fetch failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

async function saveGithubFile(encryptedPayload, message) {
    if (!process.env.GITHUB_TOKEN) {
        return { persisted: false, target: 'local-only', reason: 'GITHUB_TOKEN not set', message };
    }

    const encodedPath = STATE_GITHUB_FILE.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const existingUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
    const existingResponse = await fetch(existingUrl, { headers: getGithubHeaders('application/vnd.github+json') });

    let existing = null;
    if (existingResponse.status !== 404) {
        if (!existingResponse.ok) {
            throw new Error(`GitHub state metadata fetch failed: ${existingResponse.status} ${existingResponse.statusText}`);
        }
        existing = await existingResponse.json();
    }

    const writeUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodedPath}`;
    const payload = {
        message,
        content: Buffer.from(encryptedPayload, 'utf8').toString('base64'),
        branch: GITHUB_BRANCH
    };

    if (existing && existing.sha) {
        payload.sha = existing.sha;
    }

    const response = await fetch(writeUrl, {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getGithubHeaders('application/vnd.github+json')),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`GitHub state save failed: ${response.status} ${response.statusText} ${details}`);
    }

    return { persisted: true, target: 'github-encrypted', message };
}

async function loadVerificationState() {
    try {
        const githubText = await fetchGithubFile();
        if (githubText) {
            return normalizeState(JSON.parse(decryptState(githubText)));
        }
    } catch (error) {
        console.warn('[verification-store] GitHub load failed:', error.message);
    }

    try {
        if (usingBlobFallback()) {
            const blobText = await blobGetText();
            if (blobText) {
                return normalizeState(JSON.parse(blobText));
            }
        }
    } catch (error) {
        console.warn('[verification-store] Blob fallback load failed:', error.message);
    }

    const localPath = getLocalStatePath();
    if (fs.existsSync(localPath)) {
        try {
            return normalizeState(JSON.parse(fs.readFileSync(localPath, 'utf8')));
        } catch (error) {
            console.warn('[verification-store] Local parse failed:', error.message);
        }
    }

    return defaultState();
}

async function saveVerificationState(state, message) {
    const normalized = normalizeState(state);
    const serialized = JSON.stringify(normalized, null, 2) + '\n';
    const localPath = getLocalStatePath();

    try {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, serialized);
    } catch (error) {
        console.warn('[verification-store] Local save failed:', error.message);
    }

    try {
        return await saveGithubFile(encryptState(serialized), message);
    } catch (error) {
        console.warn('[verification-store] GitHub save failed:', error.message);
    }

    if (usingBlobFallback()) {
        try {
            await putBlob(STATE_BLOB_KEY, serialized, {
                access: 'private',
                token: BLOB_TOKEN,
                contentType: 'application/json',
                addRandomSuffix: false,
                allowOverwrite: true
            });

            return { persisted: true, target: 'blob', message };
        } catch (error) {
            console.warn('[verification-store] Blob fallback save failed:', error.message);
        }
    }

    return {
        persisted: false,
        target: 'local-only',
        reason: 'No remote verification store available',
        message
    };
}

function sanitizeVerificationState(state) {
    const normalized = normalizeState(state);
    const sanitizeMap = (entries) => {
        const result = {};
        Object.entries(entries).forEach(([pilotId, value]) => {
            if (!value || typeof value !== 'object') {
                return;
            }

            const sanitized = { ...value };
            delete sanitized.email;
            result[pilotId] = sanitized;
        });
        return result;
    };

    return {
        picHoursVerifications: sanitizeMap(normalized.picHoursVerifications),
        dobVerifications: sanitizeMap(normalized.dobVerifications)
    };
}

module.exports = {
    STATE_FILE,
    defaultState,
    loadVerificationState,
    saveVerificationState,
    sanitizeVerificationState
};
