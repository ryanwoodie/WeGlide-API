#!/usr/bin/env node

// Fetch and cache WeGlide user profile data for a set of user IDs
// - Reads IDs from the current season's JSONL file by default.
// - Requests users in batches via /v1/user?id_in=...
// - Writes full profile data: { "<userId>": { total_flight_duration, name, club, ... }, ... }

const fs = require('fs');
const readline = require('readline');
const { getSeason } = require('./lib/seasons');

const INPUT_FILE = process.argv[2] || getSeason().dataset;
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

function mergeProfile(previous, user) {
  const merged = { ...(previous || {}) };
  for (const field of ['total_flight_duration', 'total_free_distance', 'avg_speed', 'flight_count',
    'avg_glide_speed', 'avg_glide_detour', 'achievement_count']) {
    if (typeof user[field] === 'number') merged[field] = user[field];
  }
  for (const field of ['name', 'gender']) {
    if (typeof user[field] === 'string' && user[field]) merged[field] = user[field];
  }
  for (const field of ['is_junior', 'is_senior']) {
    if (typeof user[field] === 'boolean') merged[field] = user[field];
  }
  if (user.club) merged.club = user.club;
  return merged;
}

async function main() {
  console.log(`Reading user IDs from ${INPUT_FILE} ...`);
  const ids = await readUserIdsFromJsonl(INPUT_FILE);
  console.log(`Found ${ids.length} unique user IDs.`);

  // Profiles contain lifetime totals and are shared across seasons.
  const profiles = fs.existsSync(OUTPUT_FILE)
    ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
    : {};
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Fetching users ${i + 1}-${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length} ... `);
    try {
      const arr = await fetchUsersBatch(chunk);
      let hit = 0;
      for (const u of arr) {
        if (u && typeof u.id === 'number') {
          // Store full profile data
          profiles[u.id] = mergeProfile(profiles[u.id], u);
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
            profiles[u.id] = mergeProfile(profiles[u.id], u);
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
