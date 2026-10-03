// js/tools/storage.js
// Persistent workspace state per tool — survives reloads for 1 week.
// - Files (blobs) go to IndexedDB (localStorage would overflow)
// - Options go to localStorage (small JSON)
// - Both are wiped when the user downloads the result, or after 1 week.

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const DB_NAME = "pdf2web_tools";
const DB_VERSION = 1;
const STORE = "files";

// ============================================================
// IndexedDB — for file blobs
// ============================================================
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Save the full workspace state for a tool.
 * @param {string} toolId
 * @param {Object} opts       - serializable options object
 * @param {File[]} files      - array of File objects (may be empty)
 */
export async function saveState(toolId, opts, files = []) {
  const metaKey = `tools_${toolId}_meta`;
  const filesKey = `tools_${toolId}_files`;

  // Save options + timestamp to localStorage
  try {
    localStorage.setItem(
      metaKey,
      JSON.stringify({
        opts,
        savedAt: Date.now(),
        expiresAt: Date.now() + TTL_MS,
        fileCount: files.length
      })
    );
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }

  // Save files to IndexedDB
  if (files.length) {
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          type: f.type,
          lastModified: f.lastModified,
          blob: f  // File objects are structured-cloneable
        }))
      );
      await idbPut(filesKey, payload);
    } catch (e) {
      console.warn("IndexedDB save failed:", e);
    }
  } else {
    try { await idbDelete(filesKey); } catch {}
  }
}

/**
 * Load the workspace state.
 * @returns {Promise<{opts:Object, files:File[]} | null>}
 */
export async function loadState(toolId) {
  const metaKey = `tools_${toolId}_meta`;
  const filesKey = `tools_${toolId}_files`;

  let meta;
  try {
    const raw = localStorage.getItem(metaKey);
    if (!raw) return null;
    meta = JSON.parse(raw);
  } catch { return null; }

  // Expired?
  if (!meta.expiresAt || Date.now() > meta.expiresAt) {
    await clearState(toolId);
    return null;
  }

  // Load files from IndexedDB
  let files = [];
  if (meta.fileCount > 0) {
    try {
      const stored = await idbGet(filesKey);
      if (stored) {
        files = stored.map((s) => new File([s.blob], s.name, {
          type: s.type || "application/pdf",
          lastModified: s.lastModified || Date.now()
        }));
      }
    } catch (e) {
      console.warn("IndexedDB load failed:", e);
    }
  }

  return { opts: meta.opts || {}, files };
}

/**
 * Wipe all state for a tool.
 */
export async function clearState(toolId) {
  const metaKey = `tools_${toolId}_meta`;
  const filesKey = `tools_${toolId}_files`;
  try { localStorage.removeItem(metaKey); } catch {}
  try { await idbDelete(filesKey); } catch {}
}

/**
 * Wipe ALL tool state (all tools).
 */
export async function clearAllState() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("tools_") && k.endsWith("_meta"));
  keys.forEach((k) => localStorage.removeItem(k));
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
  });
}