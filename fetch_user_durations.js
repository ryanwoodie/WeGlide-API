#!/usr/bin/env node

// Fetch and cache WeGlide user total_flight_duration values for a set of user IDs
// - Reads IDs from a JSONL flights file (default: australian_flights_2025_details.jsonl)
// - Requests users in batches via /v1/user?id_in=...
// - Writes a simple JSON map: { "<userId>": <total_flight_duration_seconds>, ... }

const fs = require('fs');
const readline = require('readline');

const INPUT_FILE = process.argv[2] || 'australian_flights_2025_details.jsonl';
const OUTPUT_FILE = process.argv[3] || 'australian_user_durations.json';
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
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  console.log(`Reading user IDs from ${INPUT_FILE} ...`);
  const ids = await readUserIdsFromJsonl(INPUT_FILE);
  console.log(`Found ${ids.length} unique user IDs.`);

  const durations = {};
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
      console.log(`failed (${e.message || e})`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(durations, null, 2));
  console.log(`Saved ${Object.keys(durations).length} durations to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});

