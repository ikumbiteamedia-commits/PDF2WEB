// js/auth.js
// Authentication helpers for PDF2WEB

import { auth, db } from "./firebase.js";
import * as A from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================================================
// PROVIDERS
// ============================================================
const P = {
  google: () => new A.GoogleAuthProvider(),
  facebook: () => new A.FacebookAuthProvider(),
  apple: () => new A.OAuthProvider("apple.com")
};

// ============================================================
// FRIENDLY ERROR MESSAGES
// ============================================================
export const friendly = (e) => ({
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "That email already has an account. Try logging in.",
  "auth/weak-password": "Use at least 6 characters.",
  "auth/user-not-found": "No account found with that email.",
  "auth/wrong-password": "Wrong password. Please try again.",
  "auth/too-many-requests": "Too many attempts. Please wait and try again.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/cancelled-popup-request": "Sign-in was cancelled.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled.",
  "auth/unauthorized-domain": "This domain isn't authorized. Contact support."
}[e?.code] || e?.message || "Something went wrong. Please try again.");

// ============================================================
// SIGN UP
// ============================================================
export const signUp = async (name, email, password) => {
  const cred = await A.createUserWithEmailAndPassword(auth, email, password);
  await A.updateProfile(cred.user, { displayName: name });
  try { await A.sendEmailVerification(cred.user); } catch {}
  return cred.user;
};

// ============================================================
// LOG IN / OUT
// ============================================================
export const logIn = (email, password) =>
  A.signInWithEmailAndPassword(auth, email, password);

export const logOut = () => A.signOut(auth);

// ============================================================
// PASSWORD RESET
// ============================================================
export const reset = (email) => {
  if (!email) throw new Error("Please enter your email first.");
  return A.sendPasswordResetEmail(auth, email);
};

// ============================================================
// SOCIAL SIGN-IN
// ============================================================
export const social = (name) => {
  const provider = P[name]();
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  return isMobile
    ? A.signInWithRedirect(auth, provider)
    : A.signInWithPopup(auth, provider);
};

// ============================================================
// WATCH USER — runs whenever auth state changes
// Falls back to a minimal profile if Firestore read fails,
// so the header still switches to "logged in" state.
// ============================================================
let unsub = () => {};

export function watchUser(cb) {
  return A.onAuthStateChanged(auth, async (user) => {
    unsub();
    if (!user) return cb(null, null);

    const ref = doc(db, "users", user.uid);

    // Minimal fallback profile so UI can render even if Firestore is unreachable
    const fallback = {
      uid: user.uid,
      displayName: user.displayName || user.email || "User",
      email: user.email || "",
      photoURL: user.photoURL || "",
      plan: "free",
      subscriptionStatus: "none",
      uploadCount: 0
    };

    try {
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        const fresh = {
          uid: user.uid,
          displayName: user.displayName || "",
          email: user.email || "",
          photoURL: user.photoURL || "",
          provider: user.providerData[0]?.providerId || "password",
          plan: "free",
          subscriptionStatus: "none",
          uploadCount: 0,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp()
        };
        try {
          await setDoc(ref, fresh);
        } catch (writeErr) {
          console.warn("Could not write profile (rules?):", writeErr);
        }
        unsub = onSnapshot(
          ref,
          (s) => cb(user, s.data() || fallback),
          () => cb(user, fallback)
        );
      } else {
        // Existing user — bump lastLoginAt silently
        // Fire-and-forget: rules may allow or deny this; we don't block on it.
        try {
          updateDoc(ref, { lastLoginAt: serverTimestamp() }).catch(() => {});
        } catch (_) {
          // Ignore
        }
        unsub = onSnapshot(
          ref,
          (s) => cb(user, s.data() || fallback),
          (err) => {
            console.warn("Profile snapshot error:", err);
            cb(user, fallback);
          }
        );
      }
    } catch (readErr) {
      // Firestore unreachable or rules denied — still treat user as signed in
      console.warn("Could not read profile, using fallback:", readErr);
      cb(user, fallback);
    }
  });
}