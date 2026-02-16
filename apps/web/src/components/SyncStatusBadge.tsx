import { useEffect, useState } from "react";
import { getSyncQueueStatus } from "../lib/api";
import { loadSyncQueue } from "../lib/storage";
import { SyncQueueStatus } from "../types";

interface SyncStatusData {
  isOnline: boolean;
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  lastSyncTimestamp: string | null;
  isProcessing: boolean;
}

export function SyncStatusBadge(): JSX.Element {
  const [syncStatus, setSyncStatus] = useState<SyncStatusData>({
    isOnline: navigator.onLine,
    pendingCount: 0,
    processingCount: 0,
    failedCount: 0,
    lastSyncTimestamp: null,
    isProcessing: false
  });

  const updateSyncStatus = async (): Promise<void> => {
    const isOnline = navigator.onLine;
    const localQueue = loadSyncQueue();

    try {
      if (isOnline) {
        const response = await getSyncQueueStatus();
        const serverStatus = response.status;

        // Get most recent sync timestamp from server items
        const lastSync = serverStatus.recentItems.length > 0
          ? serverStatus.recentItems.reduce((latest, item) => {
              const itemTime = item.lastAttemptAt || item.createdAt;
              return !latest || itemTime > latest ? itemTime : latest;
            }, null as string | null)
          : null;

        setSyncStatus({
          isOnline: true,
          pendingCount: serverStatus.pending + localQueue.length,
          processingCount: serverStatus.processing,
          failedCount: serverStatus.failed,
          lastSyncTimestamp: lastSync,
          isProcessing: response.isProcessing
        });
      } else {
        // Offline: show local queue only
        setSyncStatus({
          isOnline: false,
          pendingCount: localQueue.length,
          processingCount: 0,
          failedCount: 0,
          lastSyncTimestamp: null,
          isProcessing: false
        });
      }
    } catch {
      // Fallback to local data on error
      setSyncStatus({
        isOnline,
        pendingCount: localQueue.length,
        processingCount: 0,
        failedCount: 0,
        lastSyncTimestamp: null,
        isProcessing: false
      });
    }
  };

  useEffect(() => {
    void updateSyncStatus();

    // Update every 5 seconds
    const intervalId = setInterval(() => {
      void updateSyncStatus();
    }, 5000);

    // Listen for online/offline events
    const handleOnline = (): void => void updateSyncStatus();
    const handleOffline = (): void => void updateSyncStatus();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for visibility changes
    const handleVisibilityChange = (): void => {
      if (!document.hidden) {
        void updateSyncStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return "Never";

    const now = Date.now();
    const syncTime = new Date(timestamp).getTime();
    const diffMs = now - syncTime;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 10) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    return `${diffDay}d ago`;
  };

  const totalPending = syncStatus.pendingCount + syncStatus.processingCount;
  const hasIssues = syncStatus.failedCount > 0;

  return (
    <div className={`sync-status-badge ${!syncStatus.isOnline ? "sync-status-offline" : hasIssues ? "sync-status-warning" : ""}`}>
      <div className="sync-status-indicator">
        <span className={`sync-status-dot ${syncStatus.isOnline ? "online" : "offline"}`} />
        <span className="sync-status-text">
          {syncStatus.isOnline ? "Online" : "Offline"}
        </span>
      </div>

      {totalPending > 0 && (
        <div className="sync-status-queue">
          <span className="sync-status-count">{totalPending}</span>
          <span className="sync-status-label">pending</span>
        </div>
      )}

      {hasIssues && (
        <div className="sync-status-failed">
          <span className="sync-status-count">{syncStatus.failedCount}</span>
          <span className="sync-status-label">failed</span>
        </div>
      )}

      {syncStatus.isProcessing && (
        <div className="sync-status-processing">
          <span className="sync-status-spinner" />
          <span className="sync-status-label">syncing</span>
        </div>
      )}

      <div className="sync-status-timestamp">
        Last sync: {formatTimestamp(syncStatus.lastSyncTimestamp)}
      </div>
    </div>
  );
}
