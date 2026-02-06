# 🏆 Canadian Gliding Leaderboard 2025

A comprehensive leaderboard for Canadian gliding pilots during the 2025 season (October 1, 2024 - September 30, 2025).

## 🎯 Features

- **Best 5 flights per pilot** ranked by total points
- **Task vs Free scoring** - uses the higher of the two for each flight
- **Complete season data** - All 824 Canadian flights from WeGlide API
- **Interactive design** - Beautiful, responsive HTML interface
- **Direct WeGlide links** - Click any flight to view full details
- **Task flight identification** - "TASK" badges for declared flights

## 🚀 View Leaderboard

**Live Leaderboard:** [canadian_leaderboard_2025_embedded.html](./canadian_leaderboard_2025_embedded.html)

## 🔧 Technical Details

### Data Source
- **WeGlide API** - `https://api.weglide.org/v1/flight`
- **Season filter** - `season_in=2025` 
- **Country filter** - `country_id_in=CA`

### Scoring Logic
For each flight, the system:
1. Fetches basic flight data from `/v1/flight` endpoint
2. Gets detailed scoring from `/v1/flightdetail/{flight_id}` endpoint  
3. Compares Free flight score vs Task (declaration) score
4. Uses whichever score is higher
5. Takes best 5 flights per pilot for final ranking

### Files

- `canadian_leaderboard_2025_embedded.html` - Standalone leaderboard (main file)
- `canadian_flights_2025.json` - Raw flight data (824 flights)
- `leaderboard_enhanced.json` - Processed leaderboard data
- `process_leaderboard.js` - Data processing script
- `enhance_leaderboard.js` - Task scoring enhancement script
- `embed_data.js` - HTML data embedding script

## 🏁 Season Period

The 2025 gliding season runs from **October 1, 2024** to **September 30, 2025** following standard international gliding competition seasons.

---

*Data updated: December 2024*  
*Powered by WeGlide API*
