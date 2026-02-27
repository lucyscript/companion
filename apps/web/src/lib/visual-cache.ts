/**
 * IndexedDB cache for AI-generated artwork & growth visuals.
 *
 * Stores base64 data URLs by a date-based key so repeated visits
 * to the Growth tab don't re-fetch large images from the server.
 *
 * Uses raw IndexedDB API — no dependencies. Falls back gracefully
 * if IndexedDB is unavailable (e.g. private browsing in older Safari).
 */

const DB_NAME = "companion-visual-cache";
const DB_VERSION = 1;
const STORE_NAME = "visuals";

/** Cache entries expire after 24 hours */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  storedAt: number;
  expiresAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve a cached item. Returns `null` if missing or expired.
 */
export async function getVisualCache<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry<T> | undefined;
        if (!entry || entry.expiresAt < Date.now()) {
          resolve(null);
        } else {
          resolve(entry.data);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Store an item in the cache.
 */
export async function putVisualCache<T = unknown>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  try {
    const db = await openDB();
    const entry: CacheEntry<T> = {
      key,
      data,
      storedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail — cache is best-effort
  }
}

/**
 * Evict expired entries. Call occasionally (e.g. on app start).
 */
export async function pruneVisualCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as CacheEntry;
      if (entry.expiresAt < Date.now()) {
        cursor.delete();
      }
      cursor.continue();
    };
  } catch {
    // Ignore
  }
}
