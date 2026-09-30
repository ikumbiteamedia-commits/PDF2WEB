const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Initialize once, safely, no matter which file loads first
if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FV = admin.firestore.FieldValue;

exports.db = db;
exports.FV = FV;
exports.HttpsError = HttpsError;

exports.need = r => {
  if (!r.auth) throw new HttpsError("unauthenticated", "Sign in required");
  return r.auth.uid;
};

exports.isPrem = async u => {
  const d = (await db.doc(`users/${u}`).get()).data();
  return d?.plan === "premium"
      && d.subscriptionStatus === "active"
      && d.subscriptionExpiresAt?.toMillis() > Date.now();
};

exports.audit = (type, uid, meta) =>
  db.collection("auditLogs").add({
    type, uid, meta: meta || {}, ts: FV.serverTimestamp()
  });