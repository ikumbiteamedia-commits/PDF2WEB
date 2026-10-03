// js/firebase.js
// Firebase initialization for PDF2WEB
// Public web config only (Firebase Console > Project settings).
// No secrets belong in frontend code.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9Ubfs6yunL3_YRGMjRCunuldTE6g0t6k",
  authDomain: "pdf2web-8b229.firebaseapp.com",
  projectId: "pdf2web-8b229",
  storageBucket: "pdf2web-8b229.firebasestorage.app",
  messagingSenderId: "740146376065",
  appId: "1:740146376065:web:3007221c60838d06cd0c80"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const fns = getFunctions(app);

// === Connect to local emulators when running on localhost ===
if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.log("🔥 Connected to Firebase emulators");
}

console.log("✅ Firebase initialized for PDF2WEB");