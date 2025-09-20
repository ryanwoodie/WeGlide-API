#!/usr/bin/env node

const fs = require('fs');

// Read the leaderboard data
console.log('Reading leaderboard data...');
const leaderboardData = JSON.parse(fs.readFileSync('leaderboard_enhanced.json', 'utf8'));

// Read the HTML template
console.log('Reading HTML template...');
const htmlContent = fs.readFileSync('canadian_leaderboard_2025.html', 'utf8');

// Replace the fetch call with embedded data
const embeddedHtml = htmlContent.replace(
    /\/\/ Load the processed leaderboard data[\s\S]*?const leaderboard = await response\.json\(\);/,
    `// Embedded leaderboard data
                const leaderboard = ${JSON.stringify(leaderboardData, null, 16)};`
);

// Write the new HTML file
fs.writeFileSync('canadian_leaderboard_2025_embedded.html', embeddedHtml);

console.log('✅ Created canadian_leaderboard_2025_embedded.html with embedded data');
console.log('This file can be opened directly in a browser without CORS issues!');