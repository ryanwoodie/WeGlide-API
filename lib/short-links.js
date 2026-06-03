'use strict';

const crypto = require('crypto');

const SHORT_LINK_TTL_SECONDS = 30 * 24 * 3600;
const CODE_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

function createShortCode(existingLinks = {}) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const code = crypto.randomBytes(6).toString('base64url');
        if (!existingLinks[code]) {
            return code;
        }
    }
    throw new Error('Unable to allocate a unique short link code');
}

function pruneExpiredShortLinks(state, now = new Date()) {
    const links = state.shortLinks || {};
    const nowMs = now.getTime();
    Object.entries(links).forEach(([code, entry]) => {
        if (!entry || !entry.expiresAt) return;
        const expiresMs = Date.parse(entry.expiresAt);
        if (Number.isFinite(expiresMs) && expiresMs < nowMs) {
            delete links[code];
        }
    });
    state.shortLinks = links;
}

function createShortLinksForTargets({
    state,
    baseUrl,
    targets,
    pilotId,
    pilotName,
    ttlSeconds = SHORT_LINK_TTL_SECONDS
}) {
    if (!state || typeof state !== 'object') throw new Error('state is required');
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!targets || typeof targets !== 'object') throw new Error('targets are required');

    state.shortLinks = state.shortLinks || {};
    pruneExpiredShortLinks(state);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString();
    const shortened = {};
    const entries = [];

    Object.entries(targets).forEach(([purpose, targetUrl]) => {
        if (!targetUrl) return;
        const code = createShortCode(state.shortLinks);
        state.shortLinks[code] = {
            targetUrl,
            purpose,
            pilotId: pilotId != null ? String(pilotId) : null,
            pilotName: pilotName || '',
            createdAt: createdAt.toISOString(),
            expiresAt
        };
        shortened[purpose] = `${baseUrl}/v/${code}`;
        entries.push({ code, purpose, expiresAt });
    });

    return { shortened, entries };
}

function resolveShortLink(state, code) {
    const normalizedCode = String(code || '').trim();
    if (!CODE_PATTERN.test(normalizedCode)) {
        const error = new Error('Short link is missing or invalid');
        error.statusCode = 400;
        throw error;
    }

    const entry = state?.shortLinks?.[normalizedCode];
    if (!entry || !entry.targetUrl) {
        const error = new Error('Short link was not found');
        error.statusCode = 404;
        throw error;
    }

    if (entry.expiresAt) {
        const expiresMs = Date.parse(entry.expiresAt);
        if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
            const error = new Error('Short link has expired');
            error.statusCode = 410;
            throw error;
        }
    }

    return entry;
}

module.exports = {
    SHORT_LINK_TTL_SECONDS,
    createShortLinksForTargets,
    resolveShortLink,
    pruneExpiredShortLinks
};
