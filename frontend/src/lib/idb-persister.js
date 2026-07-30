/**
 * idb-persister.js  –  Phase 7: Frontend Offline Upgrade
 * ========================================================
 * IndexedDB persister for TanStack Query v5.
 *
 * Persists the entire TanStack Query cache to IndexedDB so that
 * data is available immediately on app restart without a network
 * round-trip. This makes POS, customer lookup, and inventory
 * reads work correctly even before the first successful API call.
 *
 * API surface mirrors @tanstack/query-persist-client-core's
 * Persister interface so it slots in without an extra package:
 *   { persistClient, restoreClient, removeClient }
 *
 * Storage details:
 *   • DB:    istore_query_cache  (version 1)
 *   • Store: query_store
 *   • Key:   "tanstack-query-cache" (single blob, compressed via JSON)
 *   • Max age: 24 hours (stale cache is silently discarded on restore)
 */

const IDB_NAME    = "istore_query_cache";
const IDB_VERSION = 1;
const STORE_NAME  = "query_store";
const CACHE_KEY   = "tanstack-query-cache";
const MAX_AGE_MS  = 24 * 60 * 60 * 1000;  // 24 h

// ── Open IDB ─────────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Persister interface ──────────────────────────────────────────────────

/**
 * persistClient(client) – Serialize & save the full query cache to IDB.
 * Called by TanStack Query automatically on cache changes.
 *
 * @param {import('@tanstack/react-query').DehydratedState} dehydratedState
 */
export async function persistClient(dehydratedState) {
  try {
    const payload = JSON.stringify({
      state:     dehydratedState,
      timestamp: Date.now(),
    });
    await idbSet(CACHE_KEY, payload);
  } catch (err) {
    // IDB not available (private mode, etc.) – fail silently
    console.warn("[idb-persister] persistClient failed:", err.message);
  }
}

/**
 * restoreClient() – Load the persisted cache from IDB.
 * Returns undefined if cache is missing or expired.
 *
 * @returns {Promise<import('@tanstack/react-query').DehydratedState | undefined>}
 */
export async function restoreClient() {
  try {
    const raw = await idbGet(CACHE_KEY);
    if (!raw) return undefined;

    const { state, timestamp } = JSON.parse(raw);

    // Discard stale cache
    if (Date.now() - timestamp > MAX_AGE_MS) {
      await idbDelete(CACHE_KEY);
      return undefined;
    }

    return state;
  } catch (err) {
    console.warn("[idb-persister] restoreClient failed:", err.message);
    return undefined;
  }
}

/**
 * removeClient() – Wipe the persisted cache (call on logout or cache bust).
 */
export async function removeClient() {
  try {
    await idbDelete(CACHE_KEY);
  } catch {/* silent */}
}

/**
 * createIdbPersister() – Returns a persister object compatible with
 * TanStack Query's PersistQueryClientProvider.
 *
 * @example
 * import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
 * import { createIdbPersister } from './idb-persister'
 *
 * <PersistQueryClientProvider
 *   client={queryClient}
 *   persistOptions={{ persister: createIdbPersister() }}
 * >
 */
export function createIdbPersister() {
  return {
    persistClient,
    restoreClient,
    removeClient,
  };
}
