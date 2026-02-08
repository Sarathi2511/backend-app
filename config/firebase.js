const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin SDK
// Service account credentials can be provided via:
// 1. FIREBASE_SERVICE_ACCOUNT_KEY environment variable (single-line JSON string — set on Render/hosting dashboard)
// 2. firebase-service-account.json file in backend-app folder (for local development)
// 3. GOOGLE_APPLICATION_CREDENTIALS environment variable (path to JSON file)

let firebaseApp = null;

function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    let serviceAccount = null;

    // Option 1: Use service account from environment variable (for production/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        // Trim whitespace and handle potential escaped newlines in the JSON string
        let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
        serviceAccount = JSON.parse(rawKey);

        // Some hosting platforms escape newlines in the private_key — fix them
        if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }

        console.log('Using Firebase credentials from environment variable');
      } catch (parseError) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', parseError.message);
        console.error('Ensure FIREBASE_SERVICE_ACCOUNT_KEY is a valid single-line JSON string.');
      }
    }

    // Option 2: Use local file (for development)
    if (!serviceAccount) {
      const localFilePath = path.join(__dirname, '..', 'firebase-service-account.json');
      if (fs.existsSync(localFilePath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localFilePath, 'utf8'));
        console.log('Using Firebase credentials from local file');
      }
    }

    // Option 3: Use GOOGLE_APPLICATION_CREDENTIALS path
    if (!serviceAccount && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      console.log('Using Firebase credentials from GOOGLE_APPLICATION_CREDENTIALS');
    }

    if (serviceAccount) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin initialized successfully');
    } else {
      throw new Error('No Firebase credentials found. Please provide firebase-service-account.json or set FIREBASE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    return firebaseApp;
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error.message);
    throw error;
  }
}

// Get Firebase Messaging instance
function getMessaging() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.messaging();
}

module.exports = {
  initializeFirebase,
  getMessaging,
  admin,
};

