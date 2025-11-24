#!/usr/bin/env node

/**
 * Bulk Upload Canadian Pilot Verifications to Firebase
 *
 * This script uploads WeGlide-calculated pilot verifications to Firebase Firestore
 * for the Canadian leaderboard. It processes all pilots and marks those with
 * >= 200 hours as ineligible for the Under 200 Hours PIC trophy.
 *
 * Usage: node bulk_upload_canadian_verifications.js
 */

const fs = require('fs');

async function bulkUploadToFirebase() {
    console.log('🔄 Starting bulk upload of Canadian pilot verifications to Firebase...');

    // Load Canadian pilot profiles
    const profilesPath = 'canadian_user_profiles.json';
    if (!fs.existsSync(profilesPath)) {
        console.error('❌ Canadian user profiles not found:', profilesPath);
        console.log('💡 Run: node fetch_user_profiles.js canadian_flights_2026_details.jsonl canadian_user_profiles.json');
        return;
    }

    let profiles;
    try {
        profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
        console.log(`📊 Loaded ${Object.keys(profiles).length} pilot profiles`);
    } catch (error) {
        console.error('❌ Failed to read profiles:', error.message);
        return;
    }

    // Initialize Firebase Admin SDK
    let db;
    try {
        const { initializeApp } = require('firebase-admin/app');
        const { getFirestore } = require('firebase-admin/firestore');

        // Initialize with explicit project ID (using Australian project for now)
        const app = initializeApp({
            projectId: 'australian-leaderboard'
        });
        db = getFirestore(app);
        console.log('✅ Connected to Firebase (project: australian-leaderboard)');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
        console.log('💡 Make sure Firebase Admin SDK is installed: npm install firebase-admin');
        console.log('💡 And that you\'re authenticated with Firebase CLI: firebase login');
        console.log('');
        console.log('🔧 ALTERNATIVE: Use the leaderboard HTML interface');
        console.log('   1. Open SAC_leaderboard.html?sync_firebase=true');
        console.log('   2. This will sync all verifications to Firebase');
        return;
    }

    // Process pilot verifications
    let successCount = 0;
    let errorCount = 0;
    let under200Count = 0;
    let over200Count = 0;

    console.log('📤 Starting batch upload...');
    console.log('');

    const pilotIds = Object.keys(profiles);
    for (let i = 0; i < pilotIds.length; i++) {
        const pilotId = pilotIds[i];
        const profile = profiles[pilotId];

        // Calculate PIC hours from total_flight_duration
        const picHours = (profile.total_flight_duration / 3600).toFixed(1);
        const eligible = profile.total_flight_duration < 200 * 3600;

        // Create verification data
        const verificationData = {
            pilotName: profile.name,
            picHours: parseFloat(picHours),
            verifiedDate: new Date().toISOString(),
            dataSource: 'weglide-calculated',
            eligible: eligible,
            calculation: {
                totalWeGlideHours: parseFloat(picHours),
                note: 'Lifetime total flight duration from WeGlide API'
            }
        };

        try {
            // Upload to Firestore
            await db.collection('pilot_verifications').doc(pilotId).set(verificationData);
            successCount++;

            if (eligible) {
                under200Count++;
            } else {
                over200Count++;
            }

            // Progress update
            if ((i + 1) % 10 === 0 || (i + 1) === pilotIds.length) {
                console.log(`   [${i + 1}/${pilotIds.length}] ${profile.name}: ${picHours} hrs ${eligible ? '✓ Eligible' : '✗ Ineligible'}`);
            }
        } catch (error) {
            console.error(`❌ Failed to upload pilot ${pilotId} (${profile.name}):`, error.message);
            errorCount++;
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Bulk upload completed!');
    console.log('='.repeat(60));
    console.log(`Total pilots processed: ${pilotIds.length}`);
    console.log(`Successful uploads: ${successCount}`);
    console.log(`Failed uploads: ${errorCount}`);
    console.log('');
    console.log(`< 200 hrs PIC (Eligible): ${under200Count}`);
    console.log(`>= 200 hrs PIC (Ineligible): ${over200Count}`);
    console.log('='.repeat(60));

    if (successCount > 0) {
        console.log('');
        console.log('🎯 Next steps:');
        console.log('   1. Open SAC_leaderboard.html in a browser');
        console.log('   2. Click "⚬ < 200 hrs PIC" filter to see eligible pilots');
        console.log('   3. Pilots can verify their own hours through the web interface');
    }
}

// Run the upload
bulkUploadToFirebase().catch(console.error);
