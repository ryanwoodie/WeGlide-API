# 🔥 Firebase Setup for Australian Leaderboard

Two automated setup options to get your verification system running:

## Option 1: Fully Automated Setup

```bash
node setup_firebase.js
```

This will:
- Install Firebase CLI if needed
- Login to Firebase
- Create a new Firebase project automatically
- Set up Firestore database
- Deploy security rules
- Update your leaderboard code with the config

## Option 2: Manual Setup (Recommended)

If automatic project creation fails, use this method:

### Step 1: Create Firebase Project Manually
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Name it (e.g., "australian-leaderboard")
4. Disable Google Analytics
5. Copy the project ID

### Step 2: Run Setup Script
```bash
node setup_firebase_manual.js
```
Enter your project ID when prompted.

## What This Sets Up

✅ **Firestore Database**: Stores pilot verifications
✅ **Security Rules**: Prevents data abuse
✅ **Web App Config**: Connects your HTML to Firebase
✅ **Automatic Integration**: Updates your leaderboard code

## After Setup

1. **Generate HTML**: `node create_australian_leaderboard_from_jsonl.js`
2. **Deploy**: Commit `australian_leaderboard.html` to GitHub
3. **Live**: Verification system works immediately for all users

## Verification Flow

```
Pilot visits GitHub Pages →
Clicks "< 200 hrs PIC" →
Sees "Verify PIC hours" button →
Enters hours →
Data saves to Firebase →
All users see "✓ Verified" badge
```

## Cost

**FREE** for pilot leaderboards:
- 50,000 reads/day
- 20,000 writes/day
- 1GB storage

## Troubleshooting

If setup fails:
1. Check [Firebase Console](https://console.firebase.google.com/)
2. Enable Firestore Database manually
3. Run: `firebase deploy --only firestore:rules`
4. Get config from Project Settings → General → Your apps