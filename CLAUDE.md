# Claude Code Instructions

## Important: HTML File Generation

⚠️ **DO NOT EDIT `australian_leaderboard.html` DIRECTLY** ⚠️

The `australian_leaderboard.html` file is **automatically generated** by the script `create_australian_leaderboard_from_jsonl.js`. Any manual changes made directly to the HTML file will be **completely overwritten** the next time the generation script is run.

## How to Make Changes

### ✅ Correct Approach
1. **Edit the generation script**: `create_australian_leaderboard_from_jsonl.js`
2. **Run the script**: `node create_australian_leaderboard_from_jsonl.js`
3. **The HTML file will be regenerated** with your changes

### ❌ Wrong Approach
- Editing `australian_leaderboard.html` directly
- Your changes will be lost when the script runs again

## Key Areas in the Generation Script

⚠️ **Note**: Line numbers may change with updates. Use search patterns to find these sections.

### Adding UI Elements
- **HTML template modifications**: Search for `australianHTML.replace()` calls containing `scoring-toggle`
- **Button additions**: Add to the div containing `combinedBtn`, `freeBtn`, etc.
- **CSS additions**: Search for `toggleCSS` variable

### JavaScript Function Updates
- **Event listeners**: Search for `addEventListener('click'` in the DOMContentLoaded section
- **Function definitions**:
  - `switchScoringMode()`: Search for `function switchScoringMode(`
  - `buildLeaderboard()`: Search for `function buildLeaderboard(`
  - Other functions: Search by function name

### Data Processing
- **Leaderboard generation**: Search for `generateLeaderboard(pilotFlightsMixed)`
- **Silver C-Gull data**: Search for `generateSilverCGullLeaderboard()`
- **Data embedding**: Search for `silverCGullLeaderboard = ${JSON.stringify(`

## Common Tasks

### Adding a New Scoring Mode
1. Add button to HTML template (search for `scoring-toggle` div)
2. Add event listener (search for `addEventListener('click'` in DOMContentLoaded)
3. Update `switchScoringMode()` function (search for `function switchScoringMode(`)
4. Update `buildLeaderboard()` function if data structure is different (search for `function buildLeaderboard(`)
5. Generate/embed the new leaderboard data (search for leaderboard assignments like `silverCGullLeaderboard =`)

### Modifying Display Logic
1. Find the relevant function in the generation script
2. Make your changes
3. Regenerate the HTML file

### Adding New Data Sources
1. Add data processing logic (around line 300-400)
2. Generate the new leaderboard
3. Embed it in the HTML template

## Files Overview

- `create_australian_leaderboard_from_jsonl.js` - **EDIT THIS** ✅
- `australian_leaderboard.html` - **DO NOT EDIT** ❌ (auto-generated)
- `analyze_silver_c_gull.js` - Analysis script for Silver C-Gull candidates
- `australian_flights_2025_details.jsonl` - Source data file

## Workflow

1. Make changes to `create_australian_leaderboard_from_jsonl.js`
2. Run: `node create_australian_leaderboard_from_jsonl.js`
3. Test the generated `australian_leaderboard.html`
4. Repeat as needed

Remember: Always work with the generation script, never the output HTML file!