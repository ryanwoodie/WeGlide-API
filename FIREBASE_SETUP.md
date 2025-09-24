# Firebase Setup for Australian Leaderboard Verification System

This guide explains how to set up Firebase Firestore to handle pilot PIC hours verification for your GitHub Pages hosted leaderboard.

## 🚀 Quick Setup

### Step 1: Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Name it "australian-leaderboard" (or similar)
4. Disable Google Analytics (not needed)
5. Click "Create project"

### Step 2: Set up Firestore Database
1. In your Firebase project, click "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (we'll set security rules later)
4. Choose a location (australia-southeast1 recommended)
5. Click "Done"

### Step 3: Get Firebase Configuration
1. Click the gear icon → "Project settings"
2. Scroll to "Your apps" section
3. Click the web icon (`</>`) to add a web app
4. Name it "Australian Leaderboard"
5. Don't check "Firebase Hosting"
6. Click "Register app"
7. **Copy the firebaseConfig object**

### Step 4: Update Your Code
In `create_australian_leaderboard_from_jsonl.js`, find this section:
```javascript
const firebaseConfig = {
    apiKey: "AIzaSyBGliding2025ApiKey", // You'll need to replace with real config
    authDomain: "australian-leaderboard.firebaseapp.com",
    projectId: "australian-leaderboard",
    storageBucket: "australian-leaderboard.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};
```

Replace it with your actual firebaseConfig from Step 3.

### Step 5: Set Firestore Security Rules
1. Go to Firestore Database → Rules
2. Replace the default rules with:
```javascript
rules_version = '2';
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
}
```
3. Click "Publish"

## 🔧 How It Works

### For Pilots (End Users):
1. Visit your GitHub Pages leaderboard
2. Click "< 200 hrs PIC" filter to see eligible pilots
3. Click "Verify PIC hours" button next to their name
4. Enter PIC hours as of October 1, 2024
5. Data is saved to Firebase Firestore instantly
6. All users see the verification immediately

### For You (Admin):
- Firebase handles all the database operations
- No server maintenance required
- Free tier supports 50,000 reads/day, 20,000 writes/day
- View/manage data in Firebase Console
- Export data if needed

## 🛡️ Security Features

- **Read-only for everyone**: Anyone can see verification status
- **Write restrictions**:
  - Only allows creating new verifications (no updates)
  - Validates PIC hours are between 0-199.9
  - Requires all mandatory fields
- **No authentication required**: Simple for pilots to use
- **Prevents abuse**: One verification per pilot ID

## 💾 Data Structure

Each verification is stored as:
```json
{
  "pilotId": "12345",
  "pilotName": "John Smith",
  "picHours": 150.5,
  "verifiedDate": "2024-09-23T10:30:00.000Z",
  "eligible": true,
  "timestamp": "Firebase Server Timestamp"
}
```

## 🚨 Alternative: localStorage Fallback

If Firebase fails to load, the system automatically falls back to localStorage. This means:
- Verification works even if Firebase is down
- Data is saved locally on user's browser
- You can export this data using the admin panel (Ctrl+Shift+A)

## 📱 GitHub Pages Deployment

1. Update your Firebase config
2. Run `node create_australian_leaderboard_from_jsonl.js`
3. Commit and push `australian_leaderboard.html` to GitHub
4. GitHub Pages automatically serves the updated page
5. Verification system is immediately available to all users

## 💰 Cost

Firebase Free tier includes:
- 50,000 document reads/day
- 20,000 document writes/day
- 1 GiB stored data
- 10 GiB/month bandwidth

This is more than sufficient for a pilot leaderboard with hundreds of users.