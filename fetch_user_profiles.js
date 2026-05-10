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
const WEGLIDE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'origin': 'https://www.weglide.org',
  'referer': 'https://www.weglide.org/',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

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
  const res = await fetch(url, { headers: WEGLIDE_HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchUserById(id) {
  const url = `https://api.weglide.org/v1/user/${id}`;
  const res = await fetch(url, { headers: WEGLIDE_HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const data = await res.json();
  return data && typeof data.id === 'number' ? data : null;
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
            is_junior: u.is_junior === true,
            is_senior: u.is_senior === true,
            club: u.club || null
          };
          hit++;
        }
      }
      console.log(`ok (${hit} profiles)`);
    } catch (e) {
      process.stdout.write(`batch failed (${e.message || e}); fetching individually ... `);
      let hit = 0;
      for (const id of chunk) {
        try {
          const u = await fetchUserById(id);
          if (u && typeof u.id === 'number') {
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
              is_junior: u.is_junior === true,
              is_senior: u.is_senior === true,
              club: u.club || null
            };
            hit++;
          }
        } catch {}
      }
      console.log(`ok (${hit} profiles)`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profiles, null, 2));
  console.log(`Saved ${Object.keys(profiles).length} profiles to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
