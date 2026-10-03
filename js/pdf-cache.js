// js/pdf-cache.js
// Browser-side PDF cache (IndexedDB) so a document that has been opened once opens instantly next time.
// Decision: cache the raw Blob per user+document (documents are immutable after upload),
// keep at most 12 files / 250 MB, evict least-recently-used. All failures are silent: the
// cache is an optimisation, never a requirement.

import { storage } from "./firebase.js";
import { ref, getBlob } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const DB_NAME = "pdf2web_pdf_cache";
const DB_VERSION = 1;
const MAX_FILES = 12;
const MAX_BYTES = 250 * 1024 * 1024;
const MAX_ONE = 120 * 1024 * 1024;   // never cache a single file bigger than this

let dbPromise = null;
function openDB() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("no idb"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
        if (!db.objectStoreNames.contains("idx")) db.createObjectStore("idx");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const tx = (db, stores, mode) => db.transaction(stores, mode);
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function getCached(key) {
  try {
    const db = await openDB();
    const blob = await wrap(tx(db, "pdfs", "readonly").objectStore("pdfs").get(key));
    if (!blob) return null;
    // touch (LRU) — fire and forget
    const t = tx(db, "idx", "readwrite").objectStore("idx");
    wrap(t.get(key)).then((rec) => { if (rec) t.put({ ...rec, t: Date.now() }, key); }).catch(() => {});
    return blob;
  } catch { return null; }
}

export async function putCached(key, blob) {
  try {
    if (!blob || blob.size > MAX_ONE) return;
    const db = await openDB();
    await new Promise((res, rej) => {
      const t = tx(db, ["pdfs", "idx"], "readwrite");
      t.objectStore("pdfs").put(blob, key);
      t.objectStore("idx").put({ size: blob.size, t: Date.now() }, key);
      t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
    await evict(db);
  } catch (e) { console.warn("PDF cache write skipped:", e?.message || e); }
}

async function evict(db) {
  const idx = tx(db, "idx", "readonly").objectStore("idx");
  const keys = await wrap(idx.getAllKeys());
  const vals = await wrap(tx(db, "idx", "readonly").objectStore("idx").getAll());
  const rows = keys.map((k, i) => ({ k, ...vals[i] })).sort((a, b) => a.t - b.t);
  let total = rows.reduce((s, r) => s + (r.size || 0), 0);
  let count = rows.length;
  const drop = [];
  while (rows.length && (count > MAX_FILES || total > MAX_BYTES)) {
    const r = rows.shift();
    drop.push(r.k); total -= r.size || 0; count--;
  }
  if (!drop.length) return;
  await new Promise((res) => {
    const t = tx(db, ["pdfs", "idx"], "readwrite");
    drop.forEach((k) => { t.objectStore("pdfs").delete(k); t.objectStore("idx").delete(k); });
    t.oncomplete = res; t.onerror = res; t.onabort = res;
  });
}

export async function removeCached(key) {
  try {
    const db = await openDB();
    await new Promise((res) => {
      const t = tx(db, ["pdfs", "idx"], "readwrite");
      t.objectStore("pdfs").delete(key); t.objectStore("idx").delete(key);
      t.oncomplete = res; t.onerror = res; t.onabort = res;
    });
  } catch {}
}

/**
 * Get a document's PDF as a Blob: IndexedDB first, otherwise Firebase Storage (one request via getBlob),
 * then store it for next time.
 * @param {string} uid
 * @param {string} docId
 * @param {string[]} paths  candidate Storage paths, tried in order
 */
export async function getPdfBlob(uid, docId, paths) {
  const key = `${uid}:${docId}`;
  const hit = await getCached(key);
  if (hit && hit.size > 1000) return hit;

  let lastErr = null;
  for (const p of paths.filter(Boolean)) {
    try {
      const blob = await getBlob(ref(storage, p));
      if (blob.size < 1000) throw new Error("File is empty or corrupt.");
      putCached(key, blob);   // intentionally not awaited
      return blob;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Could not download this document.");
}

/** True when the document is already in the local cache (no network needed). */
export async function isCached(uid, docId) {
  return !!(await getCached(`${uid}:${docId}`));
}
