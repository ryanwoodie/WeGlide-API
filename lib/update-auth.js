const crypto = require('crypto');

function trimSecret(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function secretsMatch(provided, expected) {
    const providedBuffer = Buffer.from(trimSecret(provided));
    const expectedBuffer = Buffer.from(trimSecret(expected));

    if (!providedBuffer.length || providedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function getHeader(req, name) {
    const headers = req && req.headers ? req.headers : {};
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function getBearerToken(req) {
    const authorization = trimSecret(getHeader(req, 'authorization'));
    return authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';
}

function isUpdateAuthorized(req, { allowCronSecret = false } = {}) {
    const updateToken = trimSecret(process.env.UPDATE_TOKEN);
    const providedUpdateToken = getHeader(req, 'x-update-token');

    if (secretsMatch(providedUpdateToken, updateToken)) {
        return true;
    }

    if (allowCronSecret) {
        return secretsMatch(getBearerToken(req), process.env.CRON_SECRET);
    }

    return false;
}

module.exports = {
    isUpdateAuthorized,
    secretsMatch
};
