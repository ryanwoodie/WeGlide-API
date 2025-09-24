#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔥 Firebase Setup Script for Australian Leaderboard');
console.log('================================================\n');

// Check if Firebase CLI is installed
function checkFirebaseCLI() {
    try {
        execSync('firebase --version', { stdio: 'ignore' });
        console.log('✅ Firebase CLI is installed');
        return true;
    } catch (error) {
        console.log('❌ Firebase CLI not found');
        console.log('📥 Installing Firebase CLI...');
        try {
            execSync('npm install -g firebase-tools', { stdio: 'inherit' });
            console.log('✅ Firebase CLI installed successfully');
            return true;
        } catch (installError) {
            console.error('❌ Failed to install Firebase CLI');
            console.log('Please run: npm install -g firebase-tools');
            return false;
        }
    }
}

// Login to Firebase
function firebaseLogin() {
    console.log('\n🔑 Logging into Firebase...');
    try {
        execSync('firebase login', { stdio: 'inherit' });
        console.log('✅ Successfully logged into Firebase');
        return true;
    } catch (error) {
        console.error('❌ Failed to login to Firebase');
        return false;
    }
}

// Create Firebase project
function createFirebaseProject() {
    console.log('\n🏗️ Creating Firebase project...');

    const projectId = 'australian-leaderboard-' + Math.random().toString(36).substr(2, 8);
    const projectName = 'Australian Gliding Leaderboard';

    try {
        // Create project
        const createCommand = `firebase projects:create ${projectId} --display-name "${projectName}"`;
        console.log(`Running: ${createCommand}`);
        execSync(createCommand, { stdio: 'inherit' });
        console.log(`✅ Created Firebase project: ${projectId}`);
        return projectId;
    } catch (error) {
        console.error('❌ Failed to create Firebase project');
        console.log('You may need to create the project manually at: https://console.firebase.google.com/');
        return null;
    }
}

// Initialize Firebase in project
function initializeFirebase(projectId) {
    console.log('\n⚙️ Initializing Firebase project...');

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

    // Use the project
    try {
        execSync(`firebase use ${projectId}`, { stdio: 'inherit' });
        console.log(`✅ Set active project to: ${projectId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to set active Firebase project');
        return false;
    }
}

// Enable Firestore and deploy rules
function setupFirestore(projectId) {
    console.log('\n🗄️ Setting up Firestore...');

    try {
        // Deploy Firestore rules
        execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });
        console.log('✅ Deployed Firestore security rules');

        return true;
    } catch (error) {
        console.error('❌ Failed to setup Firestore');
        console.log('You may need to enable Firestore manually at: https://console.firebase.google.com/');
        return false;
    }
}

// Get Firebase config
function getFirebaseConfig(projectId) {
    console.log('\n📋 Getting Firebase configuration...');

    try {
        // Create a web app
        const appName = 'australian-leaderboard-web';
        execSync(`firebase apps:create web ${appName}`, { stdio: 'inherit' });
        console.log(`✅ Created web app: ${appName}`);

        // Get the config
        const configOutput = execSync(`firebase apps:sdkconfig web --project ${projectId}`, { encoding: 'utf8' });

        // Parse the config from the output
        const configMatch = configOutput.match(/const firebaseConfig = ({[\s\S]*?});/);
        if (configMatch) {
            const configString = configMatch[1];
            console.log('✅ Retrieved Firebase configuration');
            return configString;
        } else {
            throw new Error('Could not parse Firebase config');
        }
    } catch (error) {
        console.error('❌ Failed to get Firebase config');
        console.log('Please get your config manually from: https://console.firebase.google.com/');
        return null;
    }
}

// Update the leaderboard script with Firebase config
function updateLeaderboardScript(firebaseConfig) {
    console.log('\n📝 Updating leaderboard script with Firebase config...');

    try {
        const scriptPath = './create_australian_leaderboard_from_jsonl.js';
        let content = fs.readFileSync(scriptPath, 'utf8');

        // Replace the placeholder config
        const placeholderConfig = `const firebaseConfig = {
            apiKey: "AIzaSyBGliding2025ApiKey", // You'll need to replace with real config
            authDomain: "australian-leaderboard.firebaseapp.com",
            projectId: "australian-leaderboard",
            storageBucket: "australian-leaderboard.appspot.com",
            messagingSenderId: "123456789",
            appId: "1:123456789:web:abcdef123456"
        };`;

        const newConfig = `const firebaseConfig = ${firebaseConfig};`;

        content = content.replace(placeholderConfig, newConfig);
        fs.writeFileSync(scriptPath, content);

        console.log('✅ Updated leaderboard script with Firebase configuration');
        return true;
    } catch (error) {
        console.error('❌ Failed to update leaderboard script');
        console.log('Please update the Firebase config manually in create_australian_leaderboard_from_jsonl.js');
        return false;
    }
}

// Main setup function
async function main() {
    try {
        // Step 1: Check Firebase CLI
        if (!checkFirebaseCLI()) {
            process.exit(1);
        }

        // Step 2: Login to Firebase
        if (!firebaseLogin()) {
            process.exit(1);
        }

        // Step 3: Create Firebase project
        const projectId = createFirebaseProject();
        if (!projectId) {
            console.log('\n⚠️ Please create a Firebase project manually and run:');
            console.log('firebase use YOUR_PROJECT_ID');
            process.exit(1);
        }

        // Step 4: Initialize Firebase
        if (!initializeFirebase(projectId)) {
            process.exit(1);
        }

        // Step 5: Setup Firestore
        if (!setupFirestore(projectId)) {
            console.log('⚠️ Please enable Firestore manually in the Firebase console');
        }

        // Step 6: Get Firebase config
        const firebaseConfig = getFirebaseConfig(projectId);
        if (firebaseConfig && updateLeaderboardScript(firebaseConfig)) {
            console.log('\n🎉 Firebase setup completed successfully!');
            console.log('\n📋 Next steps:');
            console.log('1. Run: node create_australian_leaderboard_from_jsonl.js');
            console.log('2. Commit and push australian_leaderboard.html to GitHub');
            console.log('3. Your verification system is ready!');
            console.log(`\n🔗 Firebase Console: https://console.firebase.google.com/project/${projectId}`);
        } else {
            console.log('\n⚠️ Setup completed with manual steps required');
            console.log(`Please visit: https://console.firebase.google.com/project/${projectId}`);
            console.log('And update the Firebase config in create_australian_leaderboard_from_jsonl.js');
        }

    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    }
}

// Run the setup
if (require.main === module) {
    main();
}