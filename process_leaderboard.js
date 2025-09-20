#!/usr/bin/env node

const fs = require('fs');

// Load the flight data
console.log('Loading Canadian flights data...');
const flightsData = JSON.parse(fs.readFileSync('canadian_flights_2025.json', 'utf8'));
console.log(`Loaded ${flightsData.length} flights`);

// Process flights to get pilot leaderboards
const pilots = {};

console.log('Processing flights...');
flightsData.forEach((flight, index) => {
    if (!flight.user || !flight.user.name) return;
    
    const pilotName = flight.user.name;
    const pilotId = flight.user.id;
    
    if (!pilots[pilotName]) {
        pilots[pilotName] = {
            id: pilotId,
            name: pilotName,
            flights: []
        };
    }
    
    // For now, use the free flight score from the basic data
    // Later we'll need to fetch detailed scoring for task flights
    const flightData = {
        id: flight.id,
        date: flight.scoring_date,
        distance: flight.contest.distance,
        speed: flight.contest.speed,
        points: flight.contest.points,
        takeoff: flight.takeoff_airport.name,
        region: flight.takeoff_airport.region,
        declared: false, // Will need to get from flightdetail
        contestType: 'free' // Will need to determine from flightdetail
    };
    
    pilots[pilotName].flights.push(flightData);
    
    if (index % 100 === 0) {
        console.log(`Processed ${index + 1}/${flightsData.length} flights`);
    }
});

// Calculate best 5 flights for each pilot
console.log('Calculating leaderboards...');
const leaderboard = [];

Object.values(pilots).forEach(pilot => {
    // Sort flights by points descending
    pilot.flights.sort((a, b) => b.points - a.points);
    
    // Take top 5 flights
    const bestFlights = pilot.flights.slice(0, 5);
    const totalPoints = bestFlights.reduce((sum, flight) => sum + flight.points, 0);
    const totalDistance = bestFlights.reduce((sum, flight) => sum + flight.distance, 0);
    
    if (bestFlights.length > 0) {
        leaderboard.push({
            pilot: pilot.name,
            pilotId: pilot.id,
            totalPoints: totalPoints,
            totalDistance: totalDistance,
            flightCount: bestFlights.length,
            bestFlights: bestFlights
        });
    }
});

// Sort leaderboard by total points
leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);

// Save processed data
fs.writeFileSync('leaderboard_data.json', JSON.stringify(leaderboard, null, 2));

console.log(`\nLeaderboard created with ${leaderboard.length} pilots`);
console.log('Top 5 pilots:');
leaderboard.slice(0, 5).forEach((pilot, index) => {
    console.log(`${index + 1}. ${pilot.pilot}: ${pilot.totalPoints.toFixed(1)} points (${pilot.flightCount} flights)`);
});

console.log('\nData saved to leaderboard_data.json');