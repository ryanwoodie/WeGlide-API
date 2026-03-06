#!/usr/bin/env node

/**
 * Firebase Import Script for Critical Verifications
 *
 * This script imports the WeGlide-calculated verifications (>=200 hours)
 * to Firebase Firestore for persistence and real-time access.
 *
 * Usage: node firebase-import-script.js
 */

const fs = require('fs');

async function importCriticalVerificationsToFirebase() {
    console.log('🔄 Starting Firebase import of critical verifications...');

    // Check if export file exists
    const exportFile = 'firebase_critical_verifications.json';
    if (!fs.existsSync(exportFile)) {
        console.error('❌ Export file not found:', exportFile);
        console.log('💡 Run the leaderboard generation first: node create_canadian_leaderboard_from_jsonl.js');
        return;
    }

    // Load the export data
    let exportData;
    try {
        exportData = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
        console.log(`📊 Found ${Object.keys(exportData.criticalVerifications).length} critical verifications to import`);
    } catch (error) {
        console.error('❌ Failed to read export file:', error.message);
        return;
    }

    // Initialize Firebase Admin SDK
    let db;
    try {
        // Try to use existing Firebase CLI configuration
        const { initializeApp } = require('firebase-admin/app');
        const { getFirestore } = require('firebase-admin/firestore');

        // Initialize with default project (uses Firebase CLI configuration)
        const app = initializeApp();
        db = getFirestore(app);
        console.log('✅ Connected to Firebase using CLI configuration');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
        console.log('💡 Make sure Firebase Admin SDK is installed: npm install firebase-admin');
        console.log('💡 And that you\'re authenticated with Firebase CLI: firebase login');

        // Fallback: Show manual import instructions
        console.log('');
        console.log('🔧 MANUAL IMPORT INSTRUCTIONS:');
        console.log('1. Go to your Firebase Console project and open Firestore');
        console.log('2. Navigate to the "pilot_verifications" collection');
        console.log('3. Import the data from:', exportFile);
        console.log('4. Or copy/paste individual records for pilots with >=200 hours');

        // Show sample data
        const samplePilots = Object.entries(exportData.criticalVerifications).slice(0, 3);
        console.log('');
        console.log('📋 Sample records to import:');
        samplePilots.forEach(([pilotId, data]) => {
            console.log(`   Pilot ID: ${pilotId} (${data.pilotName}) - ${data.picHours} hours`);
        });

        return;
    }

    // Import to Firestore
    let successCount = 0;
    let errorCount = 0;

    console.log('📤 Starting batch import...');

    for (const [pilotId, verificationData] of Object.entries(exportData.criticalVerifications)) {
        try {
            await db.collection('pilot_verifications').doc(pilotId).set(verificationData);
            successCount++;

            if (successCount % 10 === 0) {
                console.log(`   Imported ${successCount} records...`);
            }
        } catch (error) {
            console.error(`❌ Failed to import pilot ${pilotId} (${verificationData.pilotName}):`, error.message);
            errorCount++;
        }
    }

    console.log('');
    console.log(`✅ Import completed! ${successCount} successful, ${errorCount} errors`);

    if (successCount > 0) {
        console.log(`📊 Successfully imported ${successCount} critical verifications to Firebase`);
        console.log('🎯 These pilots are now marked as ineligible for Under 200 Hours trophy');
    }

    if (errorCount > 0) {
        console.log(`⚠️  ${errorCount} records failed to import - check Firebase permissions`);
    }
}

// Run the import
importCriticalVerificationsToFirebase().catch(console.error);
