// js/documents.js
// Document upload + library for PDF2WEB

import { db, storage, auth } from "./firebase.js";
import {
  collection,
  doc,
  writeBatch,
  increment,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytesResumable,
  getBytes
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export const FREE_UPLOADS = 2;
export const FREE_PAGES = 49;

// ============================================================
// SLUG HELPER
// ============================================================
const slug = (name) =>
  name
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "document";

// ============================================================
// WATCH USER'S DOCUMENTS
// ============================================================
export const watchDocs = (cb) => {
  const user = auth.currentUser;
  if (!user) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "users", user.uid, "documents"),
      orderBy("createdAt", "desc")
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("watchDocs error:", err);
      cb([]);
    }
  );
};

// ============================================================
// UPLOAD PDF
// ============================================================
export function upload(file, onProgress) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to upload.");
  const uid = user.uid;

  const d = doc(collection(db, "users", uid, "documents"));
  const path = `users/${uid}/documents/${d.id}/original.pdf`;

  const task = uploadBytesResumable(ref(storage, path), file, {
    contentType: "application/pdf"
  });

  const done = new Promise((res, rej) =>
    task.on(
      "state_changed",
      (s) => onProgress && onProgress(s.bytesTransferred / s.totalBytes),
      rej,
      async () => {
        try {
          const b = writeBatch(db);
          // Firestore rules re-check the limit and that uploadCount rises by exactly 1
          b.set(d, {
            displayName: file.name.replace(/\.pdf$/i, ""),
            safeFilename: slug(file.name) + ".pdf",
            slug: slug(file.name),
            size: file.size,
            storagePath: path,
            status: "uploaded",
            pages: 0,
            createdAt: serverTimestamp()
          });
          b.update(doc(db, "users", uid), { uploadCount: increment(1) });
          await b.commit();
          res(d.id);
        } catch (e) {
          rej(e);
        }
      }
    )
  );

  return { task, done };
}

// ============================================================
// FETCH PDF BYTES
// ============================================================
export const fetchPdf = (d) => getBytes(ref(storage, d.storagePath));