// ─── Firebase Configuration ──────────────────────────────
// To sync your expenses across your phone and laptop:
// 1. Go to https://console.firebase.google.com/ and create a free project.
// 2. Enable "Authentication" (Email/Password and/or Google provider).
// 3. Enable "Cloud Firestore" database (in test mode or production mode).
// 4. Register a Web App ("</>" icon) in Project Settings, copy the `firebaseConfig` object,
//    and paste your values below (or use the "⚙️ Cloud Setup" button in the app).

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Check if user has saved credentials in localStorage or use the file defaults
function getFirebaseConfig() {
  const stored = localStorage.getItem("firebase_user_config");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    } catch (e) {
      console.warn("Invalid stored firebase config", e);
    }
  }
  return DEFAULT_FIREBASE_CONFIG;
}

