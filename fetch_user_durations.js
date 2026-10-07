#!/usr/bin/env node

// Fetch and cache WeGlide user total_flight_duration values for a set of user IDs
// - Reads IDs from the current season's JSONL file by default.
// - Requests users in batches via /v1/user?id_in=...
// - Writes a simple JSON map: { "<userId>": <total_flight_duration_seconds>, ... }

const fs = require('fs');
const readline = require('readline');
const { getSeason } = require('./lib/seasons');
const { weglideHeaders } = require('./lib/weglide-headers');

const INPUT_FILE = process.argv[2] || getSeason().dataset;
const OUTPUT_FILE = process.argv[3] || 'canadian_user_durations.json';
const BATCH_SIZE = 100;

async function readUserIdsFromJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const ids = new Set();
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const uid = obj?.user?.id;
      if (typeof uid === 'number') ids.add(uid);
    } catch {}
  }
  return Array.from(ids);
}

async function fetchUsersBatch(idChunk) {
  const url = `https://api.weglide.org/v1/user?id_in=${idChunk.join(',')}`;
  const res = await fetch(url, { headers: weglideHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchUserById(id) {
  const res = await fetch(`https://api.weglide.org/v1/user/${id}`, { headers: weglideHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} for user ${id}`);
  return res.json();
}

async function main() {
  console.log(`Reading user IDs from ${INPUT_FILE} ...`);
  const ids = await readUserIdsFromJsonl(INPUT_FILE);
  console.log(`Found ${ids.length} unique user IDs.`);

  const durations = fs.existsSync(OUTPUT_FILE)
    ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
    : {};
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Fetching users ${i + 1}-${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length} ... `);
    try {
      const arr = await fetchUsersBatch(chunk);
      let hit = 0;
      for (const u of arr) {
        if (u && typeof u.id === 'number' && typeof u.total_flight_duration === 'number') {
          durations[u.id] = u.total_flight_duration;
          hit++;
        }
      }
      console.log(`ok (${hit} durations)`);
    } catch (e) {
      process.stdout.write(`batch failed (${e.message || e}); fetching individually ... `);
      let hit = 0;
      for (const id of chunk) {
        try {
          const user = await fetchUserById(id);
          if (typeof user?.total_flight_duration === 'number') {
            durations[id] = user.total_flight_duration;
            hit++;
          }
        } catch (error) {
          console.warn(`User ${id}: ${error.message}`);
        }
      }
      console.log(`ok (${hit} durations)`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(durations, null, 2));
  console.log(`Saved ${Object.keys(durations).length} durations to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
