const fs = require('fs');
const path = require('path');
const { get: getBlob, put: putBlob } = require('@vercel/blob');

const STATE_FILE = process.env.VERIFICATION_STATE_FILE || path.join('data', 'verification_state.json');
const STATE_BLOB_KEY = process.env.VERIFICATION_STATE_BLOB_KEY || 'verification_state.json';
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null;

function defaultState() {
    return {
        picHoursVerifications: {},
        dobVerifications: {},
        verificationRequests: []
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
            : base.verificationRequests
    };
}

function getLocalStatePath() {
    return path.join(process.cwd(), STATE_FILE);
}

function usingBlob() {
    return Boolean(BLOB_TOKEN);
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

async function loadVerificationState() {
    try {
        if (usingBlob()) {
            const blobText = await blobGetText();
            if (blobText) {
                return normalizeState(JSON.parse(blobText));
            }
        }
    } catch (error) {
        console.warn('[verification-store] Blob load failed:', error.message);
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

    if (usingBlob()) {
        await putBlob(STATE_BLOB_KEY, serialized, {
            access: 'private',
            token: BLOB_TOKEN,
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: true
        });

        return { persisted: true, target: 'blob', message };
    }

    return { persisted: false, target: 'local-only', reason: 'BLOB_READ_WRITE_TOKEN not set', message };
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
