/**
 * Microsoft Teams Sync Service
 *
 * Periodically fetches classes, assignments, and announcements from
 * Microsoft Graph Education API and bridges assignments into deadlines.
 *
 * Cron cadence: every 30 minutes (same as Canvas / Blackboard).
 */

import { RuntimeStore } from "./store.js";
import { TeamsClient } from "./teams-client.js";
import { MicrosoftOAuthService } from "./microsoft-oauth.js";
import { TeamsData, Deadline, Priority } from "./types.js";
import { publishNewDeadlineReleaseNotifications } from "./deadline-release-notifications.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";
import { makeId } from "./utils.js";

export interface TeamsSyncResult {
  success: boolean;
  classesCount: number;
  assignmentsCount: number;
  announcementsCount: number;
  deadlineBridge?: TeamsDeadlineBridgeResult;
  error?: string;
}

export interface TeamsDeadlineBridgeResult {
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  createdDeadlines: Deadline[];
}

export class TeamsSyncService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly msOAuth: MicrosoftOAuthService | null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 30 * 60 * 1000;
  private syncInFlight: Promise<TeamsSyncResult> | null = null;

  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "teams",
    baseBackoffMs: 30_000,
    maxBackoffMs: 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 20 * 60 * 1000
  });

  constructor(store: RuntimeStore, userId: string, msOAuth?: MicrosoftOAuthService) {
    this.store = store;
    this.userId = userId;
    this.msOAuth = msOAuth ?? null;
  }

  /**
   * Resolve OAuth access token from the user's stored connection.
   * Uses MicrosoftOAuthService for automatic token refresh when available.
   */
  private async resolveClient(): Promise<TeamsClient | null> {
    // Prefer the OAuth service for automatic token refresh
    if (this.msOAuth) {
      try {
        const accessToken = await this.msOAuth.getValidAccessToken();
        return new TeamsClient(accessToken);
      } catch {
        return null;
      }
    }

    // Fallback: read raw access token from connection credentials
    const connection = this.store.getUserConnection(this.userId, "teams");
    if (!connection?.credentials) return null;

    try {
      const parsed = JSON.parse(connection.credentials) as { accessToken?: string };
      if (!parsed.accessToken) return null;
      return new TeamsClient(parsed.accessToken);
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    if (this.msOAuth) return this.msOAuth.isConnected();
    const connection = this.store.getUserConnection(this.userId, "teams");
    if (!connection?.credentials) return false;
    try {
      const parsed = JSON.parse(connection.credentials) as { accessToken?: string };
      return Boolean(parsed.accessToken);
    } catch {
      return false;
    }
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

  private async runSync(): Promise<TeamsSyncResult> {
    if (this.syncInFlight) return this.syncInFlight;

    const execute = async (): Promise<TeamsSyncResult> => {
      const client = await this.resolveClient();
      if (!client || !client.isConfigured()) {
        return {
          success: true,
          classesCount: 0,
          assignmentsCount: 0,
          announcementsCount: 0,
          error: "Teams not configured"
        };
      }

      try {
        const classes = await client.getClasses();
        const assignments = await client.getAllAssignments(classes);
        const announcements = await client.getAllAnnouncements(classes);

        const data: TeamsData = {
          classes,
          assignments,
          announcements,
          lastSyncedAt: new Date().toISOString()
        };

        this.store.setTeamsData(this.userId, data);

        // Bridge assignments into deadlines
        const deadlineBridge = this.bridgeAssignments(classes, assignments);
        publishNewDeadlineReleaseNotifications(this.store, this.userId, "teams", deadlineBridge.createdDeadlines);

        return {
          success: true,
          classesCount: classes.length,
          assignmentsCount: assignments.length,
          announcementsCount: announcements.length,
          deadlineBridge
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          classesCount: 0,
          assignmentsCount: 0,
          announcementsCount: 0,
          error: errorMessage
        };
      } finally {
        this.syncInFlight = null;
      }
    };

    this.syncInFlight = execute();
    return this.syncInFlight;
  }

  /**
   * Bridge Teams Education assignments into shared deadline system.
   */
  private bridgeAssignments(
    classes: import("./types.js").TeamsClass[],
    assignments: import("./types.js").TeamsAssignment[]
  ): TeamsDeadlineBridgeResult {
    const result: TeamsDeadlineBridgeResult = {
      created: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      createdDeadlines: []
    };

    const classMap = new Map<string, string>();
    for (const cls of classes) {
      classMap.set(cls.id, cls.displayName ?? cls.id);
    }

    const existingDeadlines = this.store.getDeadlines(this.userId, new Date(), false);
    const teamsDeadlineMap = new Map<string, Deadline>();
    for (const deadline of existingDeadlines) {
      if (deadline.teamsAssignmentId) {
        teamsDeadlineMap.set(deadline.teamsAssignmentId, deadline);
      }
    }

    const seenIds = new Set<string>();

    for (const assignment of assignments) {
      seenIds.add(assignment.id);

      if (!assignment.dueDateTime) {
        result.skipped++;
        continue;
      }

      const className = classMap.get(assignment.classId ?? "") ?? "Teams Class";
      const existing = teamsDeadlineMap.get(assignment.id);

      if (existing) {
        const existingSourceDueDate = existing.sourceDueDate ?? existing.dueDate;
        const userOverrodeDueDate = existing.dueDate !== existingSourceDueDate;
        const sourceDueDateChanged = existingSourceDueDate !== assignment.dueDateTime;
        const nextDueDate = sourceDueDateChanged && !userOverrodeDueDate ? assignment.dueDateTime : existing.dueDate;

        const needsUpdate =
          existing.task !== assignment.displayName ||
          existing.sourceDueDate !== assignment.dueDateTime ||
          existing.dueDate !== nextDueDate ||
          existing.course !== className;

        if (needsUpdate) {
          this.store.updateDeadline(this.userId, existing.id, {
            task: assignment.displayName,
            dueDate: nextDueDate,
            sourceDueDate: assignment.dueDateTime,
            course: className
          });
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        const priority: Priority = assignment.grading?.maxPoints && assignment.grading.maxPoints >= 100 ? "high"
          : assignment.grading?.maxPoints && assignment.grading.maxPoints >= 50 ? "medium"
          : "low";

        const deadline: Omit<Deadline, "id"> = {
          course: className,
          task: assignment.displayName,
          dueDate: assignment.dueDateTime,
          sourceDueDate: assignment.dueDateTime,
          priority,
          completed: assignment.status === "assigned" ? false : true,
          teamsAssignmentId: assignment.id
        };

        const created = this.store.createDeadline(this.userId, deadline);
        result.created++;
        result.createdDeadlines.push(created);
      }
    }

    // Remove stale Teams-linked deadlines
    for (const [assignmentId, deadline] of teamsDeadlineMap.entries()) {
      if (seenIds.has(assignmentId)) continue;
      if (this.store.deleteDeadline(this.userId, deadline.id)) {
        result.removed++;
      }
    }

    return result;
  }

  async sync(): Promise<TeamsSyncResult> {
    return this.runSync();
  }

  async triggerSync(): Promise<TeamsSyncResult> {
    return this.runSync();
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
