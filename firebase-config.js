import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Replace every placeholder below with the values from Firebase Console:
// Project settings > General > Your apps > SDK setup and configuration.
const firebaseConfig = {
  apiKey: "AIzaSyBhH3B-yd6nl2o7rGuRvRQYUYp8xkw39a8",
  authDomain: "brodal.firebaseapp.com",
  projectId: "brodal",
  storageBucket: "brodal.firebasestorage.app",
  messagingSenderId: "721940714734",
  appId: "1:721940714734:web:922f4d70511ac3165bcfff",
  measurementId: "G-2JD3FG7MGY"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_")
);

let auth = null;
let db = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager()
    })
  });
}

export { auth, db };
