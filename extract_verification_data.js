#!/usr/bin/env node

const fs = require('fs');

/**
 * Script to extract verification data from localStorage console output
 * and save it to pilot_pic_hours_verification.json
 *
 * Usage:
 * 1. Open browser dev tools on your leaderboard page
 * 2. Run: console.log(JSON.stringify(JSON.parse(localStorage.getItem('pilot_verifications')), null, 2))
 * 3. Copy the output
 * 4. Paste it into a text file called 'verification_data_temp.json'
 * 5. Run: node extract_verification_data.js
 */

console.log('Extracting verification data from localStorage...');

try {
    // Check if temp file exists
    if (!fs.existsSync('verification_data_temp.json')) {
        console.log('❌ verification_data_temp.json not found!');
        console.log('\nTo extract verification data:');
        console.log('1. Open browser dev tools on your leaderboard page');
        console.log('2. Run this command in console:');
        console.log('   console.log(JSON.stringify(JSON.parse(localStorage.getItem("pilot_verifications")), null, 2))');
        console.log('3. Copy the JSON output');
        console.log('4. Save it as "verification_data_temp.json"');
        console.log('5. Run this script again');
        process.exit(1);
    }

    // Read the temp file
    const tempData = JSON.parse(fs.readFileSync('verification_data_temp.json', 'utf-8'));

    // Read existing verification file or create empty one
    let existingData = { description: "Pilot PIC hours verification data for <200hrs eligibility", verifications: {} };
    if (fs.existsSync('pilot_pic_hours_verification.json')) {
        existingData = JSON.parse(fs.readFileSync('pilot_pic_hours_verification.json', 'utf-8'));
    }

    // Merge data
    if (tempData.verifications) {
        existingData.verifications = { ...existingData.verifications, ...tempData.verifications };
    }

    // Save to main file
    fs.writeFileSync('pilot_pic_hours_verification.json', JSON.stringify(existingData, null, 2));

    // Clean up temp file
    fs.unlinkSync('verification_data_temp.json');

    console.log('✅ Successfully extracted and merged verification data!');
    console.log(`📊 Total verifications: ${Object.keys(existingData.verifications).length}`);
    console.log('\nVerified pilots:');
    Object.entries(existingData.verifications).forEach(([id, data]) => {
        console.log(`  - ${data.pilotName}: ${data.picHours} hours PIC (${data.verifiedDate.split('T')[0]})`);
    });

    console.log('\n🚀 You can now commit and push the updated pilot_pic_hours_verification.json file');

} catch (error) {
    console.error('❌ Error extracting verification data:', error.message);
    process.exit(1);
}