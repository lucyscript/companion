import { processSyncQueue } from "./api";

// Type declarations for Background Sync API
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly sync: SyncManager;
}

/**
 * Register background sync to automatically sync when connectivity is restored
 */
export async function registerBackgroundSync(): Promise<void> {
  if ("serviceWorker" in navigator && "sync" in ServiceWorkerRegistration.prototype) {
    try {
      const registration = await navigator.serviceWorker.ready;
      // @ts-expect-error - Background Sync API is not in all TypeScript definitions
      await registration.sync.register("sync-operations");
    } catch (error) {
      console.error("Background sync registration failed:", error);
    }
  }
}

/**
 * Manually trigger sync queue processing
 */
export async function triggerManualSync(): Promise<{ processed: number; failed: number }> {
  return processSyncQueue();
}

/**
 * Set up listeners for online/offline events to trigger sync
 */
export function setupSyncListeners(): void {
  // Sync when coming back online
  window.addEventListener("online", () => {
    void registerBackgroundSync();
    void processSyncQueue();
  });

  // Also sync when the page becomes visible (app reopens)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && navigator.onLine) {
      void processSyncQueue();
    }
  });

  // Sync when service worker is activated
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (navigator.onLine) {
        void processSyncQueue();
      }
    });
  }
}
