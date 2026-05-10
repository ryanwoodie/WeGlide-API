#!/usr/bin/env node
'use strict';

/*
 * Send a WeGlide direct message via api.weglide.org/v1/usermessage.
 *
 * Defaults to --dry-run: prints the exact HTTP request that *would* be sent,
 * with the bearer token redacted, but does NOT actually POST.
 *
 * Pass --send to actually transmit the message.
 *
 * Usage:
 *   WEGLIDE_AUTH_TOKEN=xxx node send_weglide_message.js \
 *       --to 20675 --message "hello"
 *   WEGLIDE_AUTH_TOKEN=xxx node send_weglide_message.js \
 *       --to 20675 --message "hello" --send
 *
 * Loads WEGLIDE_AUTH_TOKEN from .env.local if present.
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
    const args = { dryRun: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--to') {
            args.to = argv[++i];
        } else if (a === '--message' || a === '-m') {
            args.message = argv[++i];
        } else if (a === '--send') {
            args.dryRun = false;
        } else if (a === '--dry-run') {
            args.dryRun = true;
        } else if (a === '--help' || a === '-h') {
            args.help = true;
        } else {
            console.error(`Unknown argument: ${a}`);
            process.exit(2);
        }
    }
    return args;
}

function printHelp() {
    console.log(`Usage: node send_weglide_message.js --to <userId> --message "..." [--send]

Options:
  --to <userId>      WeGlide recipient user ID (integer, required)
  --message, -m      Message body (required)
  --send             Actually send the message (default is dry-run)
  --dry-run          Explicit dry-run (default)
  --help, -h         Show this help

Environment:
  WEGLIDE_AUTH_TOKEN Bearer token for api.weglide.org (required)
                     Loaded from .env.local if present.
`);
}

(async () => {
    loadEnvLocal();
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        return;
    }
    if (!args.to || !args.message) {
        printHelp();
        process.exit(2);
    }

    const { sendUserMessage } = require('./lib/weglide-message');

    try {
        const result = await sendUserMessage({
            recipientId: args.to,
            message: args.message,
            dryRun: args.dryRun
        });

        if (result.dryRun) {
            console.log('[dry-run] Would send the following request:\n');
        } else {
            console.log(`[sent] HTTP ${result.status}\n`);
        }
        console.log(JSON.stringify(result, null, 2));

        if (result.dryRun) {
            console.log('\nTo actually send, re-run with --send');
        }
    } catch (error) {
        console.error(`[error] ${error.message}`);
        if (error.responseBody) {
            console.error('Response body:', error.responseBody);
        }
        process.exit(1);
    }
})();
