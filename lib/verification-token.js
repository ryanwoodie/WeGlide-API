const crypto = require('crypto');

function getSecret() {
    const secret = process.env.VERIFICATION_TOKEN_SECRET;
    if (!secret) {
        throw new Error('VERIFICATION_TOKEN_SECRET is not configured');
    }
    return secret;
}

function base64urlEncode(value) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function signTokenPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', getSecret())
        .update(encodedPayload)
        .digest('base64url');
}

function createVerificationToken(payload, expiresInSeconds = 3600) {
    const tokenPayload = {
        ...payload,
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    };
    const encodedPayload = base64urlEncode(JSON.stringify(tokenPayload));
    const signature = signTokenPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

function verifyVerificationToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        throw new Error('Verification token is missing or malformed');
    }

    const [encodedPayload, providedSignature] = token.split('.');
    const expectedSignature = signTokenPayload(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw new Error('Verification token signature is invalid');
    }

    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Verification token has expired');
    }

    return payload;
}

module.exports = {
    createVerificationToken,
    verifyVerificationToken
};
