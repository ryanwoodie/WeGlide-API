#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

console.log('🔥 Manual Firebase Setup for Australian Leaderboard');
console.log('=================================================\n');

async function main() {
    try {
        console.log('This script will help you set up Firebase after you\'ve created a project manually.\n');

        // Get project ID
        const projectId = await question('Enter your Firebase project ID: ');
        if (!projectId.trim()) {
            console.log('❌ Project ID is required');
            process.exit(1);
        }

        console.log(`\n🏗️ Setting up Firebase for project: ${projectId}`);

        // Check Firebase CLI
        try {
            execSync('firebase --version', { stdio: 'ignore' });
            console.log('✅ Firebase CLI is available');
        } catch (error) {
            console.log('❌ Firebase CLI not found. Please install with:');
            console.log('npm install -g firebase-tools');
            process.exit(1);
        }

        // Login check
        try {
            execSync('firebase projects:list', { stdio: 'ignore' });
            console.log('✅ Already logged into Firebase');
        } catch (error) {
            console.log('🔑 Please login to Firebase...');
            execSync('firebase login', { stdio: 'inherit' });
        }

        // Use project
        try {
            execSync(`firebase use ${projectId}`, { stdio: 'inherit' });
            console.log(`✅ Set active project to: ${projectId}`);
        } catch (error) {
            console.error('❌ Failed to use project. Please check the project ID.');
            process.exit(1);
        }

        // Create firebase.json
        const firebaseConfig = {
            firestore: {
                rules: "firestore.rules",
                indexes: "firestore.indexes.json"
            }
        };

        fs.writeFileSync('firebase.json', JSON.stringify(firebaseConfig, null, 2));
        console.log('✅ Created firebase.json');

        // Create Firestore security rules
        const firestoreRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read access to pilot verifications for everyone
    match /pilot_verifications/{pilotId} {
      allow read: if true;
      allow write: if request.auth == null &&
                      resource == null && // Only allow creating new documents
                      request.resource.data.keys().hasAll(['pilotId', 'pilotName', 'picHours', 'verifiedDate', 'eligible']) &&
                      request.resource.data.picHours is number &&
                      request.resource.data.picHours >= 0 &&
                      request.resource.data.picHours < 200;
    }
  }
}`;

        fs.writeFileSync('firestore.rules', firestoreRules);
        console.log('✅ Created firestore.rules');

        // Create empty indexes file
        fs.writeFileSync('firestore.indexes.json', JSON.stringify({ indexes: [] }, null, 2));
        console.log('✅ Created firestore.indexes.json');

        // Deploy rules
        console.log('\n🗄️ Deploying Firestore rules...');
        try {
            execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });
            console.log('✅ Deployed Firestore security rules');
        } catch (error) {
            console.log('⚠️ Failed to deploy rules. You may need to:');
            console.log('1. Enable Firestore in Firebase Console');
            console.log('2. Run: firebase deploy --only firestore:rules');
        }

        // Get Firebase config
        console.log('\n📋 Getting Firebase web app configuration...');

        // Check if web app exists, create if not
        try {
            const appName = 'australian-leaderboard-web';
            console.log('Creating web app...');
            execSync(`firebase apps:create web ${appName}`, { stdio: 'pipe' });
            console.log(`✅ Created web app: ${appName}`);
        } catch (error) {
            // App might already exist
            console.log('ℹ️ Web app may already exist, continuing...');
        }

        // Get the config
        try {
            const configOutput = execSync(`firebase apps:sdkconfig web --project ${projectId}`, { encoding: 'utf8' });

            // Parse and update the script
            const configMatch = configOutput.match(/const firebaseConfig = ({[\s\S]*?});/);
            if (configMatch) {
                const configString = configMatch[1];
                console.log('✅ Retrieved Firebase configuration');

                // Update the leaderboard script
                const scriptPath = './create_australian_leaderboard_from_jsonl.js';
                let content = fs.readFileSync(scriptPath, 'utf8');

                const placeholderConfig = `const firebaseConfig = {
            apiKey: "AIzaSyBGliding2025ApiKey", // You'll need to replace with real config
            authDomain: "australian-leaderboard.firebaseapp.com",
            projectId: "australian-leaderboard",
            storageBucket: "australian-leaderboard.appspot.com",
            messagingSenderId: "123456789",
            appId: "1:123456789:web:abcdef123456"
        };`;

                const newConfig = `const firebaseConfig = ${configString};`;
                content = content.replace(placeholderConfig, newConfig);
                fs.writeFileSync(scriptPath, content);

                console.log('✅ Updated leaderboard script with Firebase configuration');
            } else {
                throw new Error('Could not parse Firebase config');
            }
        } catch (error) {
            console.log('⚠️ Could not automatically get Firebase config');
            console.log('\nPlease manually:');
            console.log('1. Go to Firebase Console → Project Settings → General');
            console.log('2. Scroll to "Your apps" and find your web app');
            console.log('3. Copy the firebaseConfig object');
            console.log('4. Replace the config in create_australian_leaderboard_from_jsonl.js');
        }

        console.log('\n🎉 Firebase setup completed!');
        console.log('\n📋 Next steps:');
        console.log('1. Ensure Firestore is enabled in Firebase Console');
        console.log('2. Run: node create_australian_leaderboard_from_jsonl.js');
        console.log('3. Commit and push australian_leaderboard.html to GitHub');
        console.log('4. Your verification system is ready!');
        console.log(`\n🔗 Firebase Console: https://console.firebase.google.com/project/${projectId}`);

    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
    } finally {
        rl.close();
    }
}

main();