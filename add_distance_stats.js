#!/usr/bin/env node

const fs = require('fs');

console.log('Adding distance statistics to enhanced leaderboard...');

// Read the enhanced leaderboard data
const leaderboard = JSON.parse(fs.readFileSync('leaderboard_enhanced.json', 'utf8'));

// Add total distance for each pilot
leaderboard.forEach(pilot => {
    pilot.totalDistance = pilot.bestFlights.reduce((sum, flight) => sum + flight.distance, 0);
});

// Save the updated data
fs.writeFileSync('leaderboard_enhanced.json', JSON.stringify(leaderboard, null, 2));

console.log(`✅ Updated ${leaderboard.length} pilots with distance statistics`);

// Calculate overall stats
const totalFlights = leaderboard.reduce((sum, pilot) => sum + pilot.flightCount, 0);
const totalDistance = leaderboard.reduce((sum, pilot) => sum + pilot.totalDistance, 0);

console.log(`\nOverall Statistics:`);
console.log(`- ${leaderboard.length} pilots`);
console.log(`- ${totalFlights} flights`);
console.log(`- ${Math.round(totalDistance).toLocaleString()} total kilometers`);
console.log(`- ${Math.round(totalDistance/totalFlights)} km average per flight`);

console.log(`\nTop 5 with distances:`);
leaderboard.slice(0, 5).forEach((pilot, index) => {
    console.log(`${index + 1}. ${pilot.pilot}: ${pilot.totalPoints.toFixed(1)} points, ${Math.round(pilot.totalDistance)} km`);
});