/**
 * Blackboard Learn Sync Service
 *
 * Mirrors CanvasSyncService — periodically fetches courses, assignments,
 * and announcements, bridges assignments into the deadline system, and
 * stores data for Gemini context injection.
 *
 * Cron cadence: every 30 minutes (same as Canvas).
 */

import { RuntimeStore } from "./store.js";
import { BlackboardClient } from "./blackboard-client.js";
import { BlackboardData } from "./types.js";
import { BlackboardDeadlineBridge, BlackboardDeadlineBridgeResult } from "./blackboard-deadline-bridge.js";
import { publishNewDeadlineReleaseNotifications } from "./deadline-release-notifications.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

export interface BlackboardSyncResult {
  success: boolean;
  coursesCount: number;
  assignmentsCount: number;
  announcementsCount: number;
  deadlineBridge?: BlackboardDeadlineBridgeResult;
  error?: string;
}

export interface BlackboardSyncOptions {
  baseUrl?: string;
  token?: string;
}

export class BlackboardSyncService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly deadlineBridge: BlackboardDeadlineBridge;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 30 * 60 * 1000;
  private syncInFlight: Promise<BlackboardSyncResult> | null = null;

  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "blackboard",
    baseBackoffMs: 30_000,
    maxBackoffMs: 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 20 * 60 * 1000
  });

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
    this.deadlineBridge = new BlackboardDeadlineBridge(store, userId);
  }

  /**
   * Resolve credentials from the user's stored connection.
   */
  private resolveClient(): BlackboardClient | null {
    const connection = this.store.getUserConnection(this.userId, "blackboard");
    if (!connection?.credentials) return null;

    try {
      const parsed = JSON.parse(connection.credentials) as { token?: string; baseUrl?: string };
      if (!parsed.token) return null;
      return new BlackboardClient(parsed.baseUrl, parsed.token);
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    return this.resolveClient()?.isConfigured() ?? false;
  }

  start(intervalMs: number = 30 * 60 * 1000): void {
    if (this.syncInterval) return;
    this.autoSyncIntervalMs = intervalMs;
    void this.runAutoSync();
    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
    }, intervalMs);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  private async runSync(options?: BlackboardSyncOptions): Promise<BlackboardSyncResult> {
    const hasOverride = Boolean(options?.baseUrl || options?.token);

    if (!hasOverride && this.syncInFlight) {
      return this.syncInFlight;
    }

    const execute = async (): Promise<BlackboardSyncResult> => {
      const client = hasOverride
        ? new BlackboardClient(options?.baseUrl, options?.token)
        : this.resolveClient();

      if (!client || !client.isConfigured()) {
        return {
          success: true,
          coursesCount: 0,
          assignmentsCount: 0,
          announcementsCount: 0,
          error: "Blackboard not configured"
        };
      }

      try {
        const courses = await client.getCourses();
        const assignments = await client.getAllAssignments(courses);
        const announcements = await client.getAllAnnouncements(courses);

        const data: BlackboardData = {
          courses,
          assignments,
          announcements,
          lastSyncedAt: new Date().toISOString()
        };

        this.store.setBlackboardData(this.userId, data);

        // Bridge assignments into deadlines
        const deadlineBridge = this.deadlineBridge.syncAssignments(courses, assignments);
        publishNewDeadlineReleaseNotifications(this.store, this.userId, "blackboard", deadlineBridge.createdDeadlines);

        return {
          success: true,
          coursesCount: courses.length,
          assignmentsCount: assignments.length,
          announcementsCount: announcements.length,
          deadlineBridge
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          coursesCount: 0,
          assignmentsCount: 0,
          announcementsCount: 0,
          error: errorMessage
        };
      } finally {
        if (!hasOverride) {
          this.syncInFlight = null;
        }
      }
    };

    if (hasOverride) return execute();
    this.syncInFlight = execute();
    return this.syncInFlight;
  }

  async sync(options?: BlackboardSyncOptions): Promise<BlackboardSyncResult> {
    return this.runSync(options);
  }

  async triggerSync(options?: BlackboardSyncOptions): Promise<BlackboardSyncResult> {
    return this.runSync(options);
  }

  getAutoHealingStatus(): SyncAutoHealingState {
    return this.autoHealing.getState();
  }

  private scheduleAutoRetry(): void {
    if (!this.syncInterval || this.retryTimeout) return;
    const nextAttemptAt = this.autoHealing.getState().nextAttemptAt;
    if (!nextAttemptAt) return;
    const delay = Date.parse(nextAttemptAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay >= this.autoSyncIntervalMs) return;

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      void this.runAutoSync();
    }, delay);
  }

  private async runAutoSync(): Promise<void> {
    if (this.autoSyncInProgress) return;
    const decision = this.autoHealing.canAttempt();
    if (!decision.allowed) {
      this.autoHealing.recordSkip(decision.reason ?? "backoff");
      return;
    }

    this.autoSyncInProgress = true;
    try {
      const result = await this.runSync();
      if (result.success) {
        this.autoHealing.recordSuccess();
      } else {
        this.autoHealing.recordFailure(result.error);
        this.scheduleAutoRetry();
      }
    } finally {
      this.autoSyncInProgress = false;
    }
  }
}
