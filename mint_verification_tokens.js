#!/usr/bin/env node
'use strict';

/*
 * Mint pic-direct and dismissal verification tokens for a given pilotId,
 * and print the verify/dismiss URLs you can paste into a browser to
 * manually test the deployed flow.
 *
 * Usage:
 *   node mint_verification_tokens.js --pilot-id 20723 \
 *       [--name "Ryan Wood"] [--estimate 147.8] \
 *       [--base-url https://sac-leaderboard.vercel.app] \
 *       [--ttl 3600]
 *
 * Env:
 *   VERIFICATION_TOKEN_SECRET (required) — loaded from .env.local if present.
 */

const fs = require('fs');
const path = require('path');

function findEnvLocal() {
    let dir = __dirname;
    while (true) {
        const candidate = path.join(dir, '.env.local');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function loadEnvLocal() {
    const envPath = findEnvLocal();
    if (!envPath) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function parseArgs(argv) {
    const args = {
        baseUrl: 'https://sac-leaderboard.vercel.app',
        ttlSeconds: 3600
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--pilot-id') args.pilotId = argv[++i];
        else if (a === '--name') args.name = argv[++i];
        else if (a === '--estimate') args.estimate = argv[++i];
        else if (a === '--base-url') args.baseUrl = argv[++i].replace(/\/+$/, '');
        else if (a === '--ttl') args.ttlSeconds = parseInt(argv[++i], 10);
        else if (a === '--help' || a === '-h') args.help = true;
        else { console.error(`Unknown argument: ${a}`); process.exit(2); }
    }
    return args;
}

function printHelp() {
    console.log(`Usage: node mint_verification_tokens.js --pilot-id <id> [options]

Options:
  --pilot-id <id>     WeGlide pilot ID (required)
  --name <string>     Pilot display name (optional, default "Pilot")
  --estimate <hours>  Pre-fill value for the PIC hours form (optional)
  --base-url <url>    Deployed base URL (default https://sac-leaderboard.vercel.app)
  --ttl <seconds>     Token TTL (default 3600 — 1 hour for tests)
  --help, -h          Show this help
`);
}

(async () => {
    loadEnvLocal();
    const args = parseArgs(process.argv.slice(2));

    if (args.help) { printHelp(); return; }
    if (!args.pilotId) { printHelp(); process.exit(2); }

    const { createVerificationToken } = require('./lib/verification-token');

    const pilotName = args.name || 'Pilot';
    const picHoursEstimate = args.estimate != null ? Number(args.estimate) : null;

    const verifyToken = createVerificationToken({
        type: 'pic-direct',
        pilotId: String(args.pilotId),
        pilotName,
        picHoursEstimate
    }, args.ttlSeconds);

    const dismissToken = createVerificationToken({
        type: 'dismissal',
        pilotId: String(args.pilotId),
        pilotName
    }, args.ttlSeconds);

    const verifyUrl = `${args.baseUrl}/api/verify-pic-hours?token=${encodeURIComponent(verifyToken)}`;
    const dismissUrl = `${args.baseUrl}/api/dismiss-pic-verification?token=${encodeURIComponent(dismissToken)}`;

    console.log(`Pilot:       ${pilotName} (${args.pilotId})`);
    console.log(`Estimate:    ${picHoursEstimate != null ? picHoursEstimate.toFixed(1) : '(none — form will be empty)'}`);
    console.log(`TTL:         ${args.ttlSeconds}s`);
    console.log(`Base URL:    ${args.baseUrl}`);
    console.log('');
    console.log('Verify form (GET → form, POST → records picHours):');
    console.log(`  ${verifyUrl}`);
    console.log('');
    console.log('Dismiss link (GET → records picHours=200, eligible=false):');
    console.log(`  ${dismissUrl}`);
})();
