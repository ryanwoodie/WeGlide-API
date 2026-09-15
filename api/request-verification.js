const { createVerificationToken } = require('../lib/verification-token');
const { isValidDateOfBirth } = require('../lib/dob-validation');
const { sendVerificationEmail } = require('../lib/verification-email');
const { loadVerificationState, saveVerificationState } = require('../lib/verification-store');

function getRequestBody(req) {
    if (!req.body) {
        return {};
    }

    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch (error) {
            return {};
        }
    }

    return req.body;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_URL;
    const protocol = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
    return `${protocol}://${host}`;
}

function normalizePicRequest(body) {
    const picHours = Number(body.picHours);
    if (!Number.isFinite(picHours) || picHours < 0 || picHours > 50000) {
        throw new Error('Invalid PIC hours');
    }

    return {
        type: 'pic',
        pilotId: String(body.pilotId || '').trim(),
        pilotName: String(body.pilotName || '').trim(),
        email: String(body.email || '').trim().toLowerCase(),
        picHours: Number(picHours.toFixed(1))
    };
}

function normalizeDobRequest(body) {
    const dateOfBirth = String(body.dateOfBirth || '').trim();
    if (!isValidDateOfBirth(dateOfBirth)) {
        throw new Error('Invalid date of birth');
    }

    return {
        type: 'dob',
        pilotId: String(body.pilotId || '').trim(),
        pilotName: String(body.pilotName || '').trim(),
        email: String(body.email || '').trim().toLowerCase(),
        dateOfBirth
    };
}

function validateCommonFields(payload) {
    if (!payload.pilotId) {
        throw new Error('Pilot ID is required');
    }
    if (!payload.pilotName) {
        throw new Error('Pilot name is required');
    }
    if (!isValidEmail(payload.email)) {
        throw new Error('Valid email is required');
    }
}

function getRequestMetadata(req) {
    return {
        requestedAt: new Date().toISOString(),
        ipAddress: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
        userAgent: String(req.headers['user-agent'] || '').trim()
    };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = getRequestBody(req);
        const payload = body.type === 'silver-dismiss'
            ? { type: 'silver-dismiss', pilotId: String(body.pilotId || '').trim(), pilotName: String(body.pilotName || '').trim(), email: String(body.email || '').trim().toLowerCase() }
            : body.type === 'dob' ? normalizeDobRequest(body) : normalizePicRequest(body);
        validateCommonFields(payload);
        const state = await loadVerificationState({ requireRemote: true });
        state.verificationRequests.push({
            ...payload,
            ...getRequestMetadata(req)
        });
        const saved = await saveVerificationState(
            state,
            `chore: log verification request for ${payload.pilotName} (${payload.pilotId})`
        );
        if (!saved?.persisted) {
            return res.status(503).json({ ok: false, error: 'Verification storage is temporarily unavailable. Please try again later.' });
        }

        const token = createVerificationToken(payload, 3600);
        const verificationLink = `${getBaseUrl(req)}/api/complete-verification?token=${encodeURIComponent(token)}`;

        await sendVerificationEmail({
            ...payload,
            verificationLink
        });

        return res.status(200).json({
            ok: true,
            message: 'Verification email sent'
        });
    } catch (error) {
        console.error('[request-verification] Error:', error);
        const statusCode = error.code === 'EMAIL_CONFIG_ERROR' || error.code === 'EAUTH'
            ? 503
            : 400;

        return res.status(statusCode).json({
            ok: false,
            error: error.publicMessage || 'Failed to request verification'
        });
    }
};
