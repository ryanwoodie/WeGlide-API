#!/usr/bin/env node

// Fetch and cache WeGlide user profile data for a set of user IDs
// - Reads IDs from a JSONL flights file (default: canadian_flights_2026_details.jsonl)
// - Requests users in batches via /v1/user?id_in=...
// - Writes full profile data: { "<userId>": { total_flight_duration, name, club, ... }, ... }

const fs = require('fs');
const readline = require('readline');

const INPUT_FILE = process.argv[2] || 'canadian_flights_2026_details.jsonl';
const OUTPUT_FILE = process.argv[3] || 'canadian_user_profiles.json';
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

  const profiles = {};
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Fetching users ${i + 1}-${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length} ... `);
    try {
      const arr = await fetchUsersBatch(chunk);
      let hit = 0;
      for (const u of arr) {
        if (u && typeof u.id === 'number') {
          // Store full profile data
          profiles[u.id] = {
            total_flight_duration: u.total_flight_duration || 0,
            total_free_distance: u.total_free_distance || 0,
            avg_speed: u.avg_speed || 0,
            flight_count: u.flight_count || 0,
            avg_glide_speed: u.avg_glide_speed || 0,
            avg_glide_detour: u.avg_glide_detour || 0,
            achievement_count: u.achievement_count || 0,
            name: u.name || '',
            gender: u.gender || '',
            club: u.club || null
          };
          hit++;
        }
      }
      console.log(`ok (${hit} profiles)`);
    } catch (e) {
      console.log(`failed (${e.message || e})`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profiles, null, 2));
  console.log(`Saved ${Object.keys(profiles).length} profiles to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
