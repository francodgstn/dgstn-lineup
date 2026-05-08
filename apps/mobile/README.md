# HMD Student App

A React Native mobile application for students/contacts to access their profile and team information.

## Features

- **Passwordless Authentication**: Login via secure token sent by email
- **Profile View**: View personal contact information
- **Team Information**: Access team public profile data

## Tech Stack

- React Native with Expo
- TypeScript
- Firebase Firestore
- React Navigation
- AsyncStorage for local data persistence

## Prerequisites

- Node.js 16+
- npm or pnpm
- Expo CLI
- iOS Simulator (Mac) or Android Emulator

## Installation

```bash
cd student-app
npm install
```

## Running the App

### Development Mode

```bash
# Start the Expo development server
npm start

# Run on iOS simulator (Mac only)
npm run ios

# Run on Android emulator
npm run android

# Run in web browser
npm run web
```

### Scan QR Code

Use the Expo Go app on your physical device to scan the QR code from the terminal.

## Authentication Flow

1. Admin sends email with authentication link containing a token
2. User clicks link which opens the app with the token (or enters token manually)
3. App validates token against Firestore `student_auth_tokens` collection
4. On successful validation, user is logged in and can access their profile

## Firestore Collections Used

- `student_auth_tokens`: Stores authentication tokens
  - Fields: `token`, `contactId`, `expiresAt`, `createdAt`
- `contacts`: Student/contact profile data
- `teams`: Team data with `public_profile` field

## Project Structure

```
src/
├── config/
│   └── firebase.ts          # Firebase configuration
├── contexts/
│   └── AuthContext.tsx      # Authentication state management
├── navigation/
│   └── AppNavigator.tsx     # App navigation setup
├── screens/
│   ├── LoginScreen.tsx      # Login/token entry screen
│   └── ProfileScreen.tsx    # User profile and team info screen
├── services/
│   ├── firestore.ts         # Firestore data operations
│   └── storage.ts           # Local storage operations
└── types/
    └── index.ts             # TypeScript interfaces
```

## Backend Setup Required

To support this app, you'll need to create a Firebase Cloud Function to generate authentication tokens and send email links. Similar to the membership signup flow.

Example function structure:

```javascript
exports.sendStudentAuthLink = functions.https.onCall(async (data, context) => {
  // Generate token
  // Store in student_auth_tokens collection
  // Send email with deep link containing token
});
```

## Deep Linking Setup

To enable opening the app from email links, configure deep linking in [app.json](app.json):

```json
{
  "expo": {
    "scheme": "hmdstudent",
    "ios": {
      "associatedDomains": ["applinks:your-domain.com"]
    },
    "android": {
      "intentFilters": [...]
    }
  }
}
```

## Building for Production

```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## Store Deployment (CI/CD)

Store submissions are handled by `.github/workflows/student-app-store-submit.yml`.

**Automatic**: bump `version` in `app.config.js`, open a PR, merge to `master` — the pipeline triggers automatically and submits to both Play Store and App Store.

**Manual**: go to **Actions > Student App Store Submit > Run workflow** in GitHub to trigger a build for a specific platform or to re-submit the latest existing EAS build (`skip_build`).

The native build numbers (`versionCode` / `buildNumber`) are managed remotely by EAS and auto-incremented on each store build (`autoIncrement: true` in `eas.json`).

## Environment Configuration

The app uses the staging Firebase project configuration. Update [src/config/firebase.ts](src/config/firebase.ts) to switch environments.

## License

See main project LICENSE
