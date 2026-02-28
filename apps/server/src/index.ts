import cors from "cors";
import express from "express";
import { resolve } from "path";
import { z } from "zod";
import { AuthService, parseBearerToken, generateSessionToken, hashSessionToken } from "./auth.js";
import { BackgroundSyncService } from "./background-sync.js";
import { buildCalendarImportPreview, parseICS } from "./calendar-import.js";
import { config } from "./config.js";
import {
  googleOAuthEnabled,
  getGoogleOAuthUrl,
  exchangeGoogleCode,
  githubOAuthEnabled,
  getGitHubOAuthUrl,
  exchangeGitHubCode,
  exchangeGitHubCodeWithToken
} from "./oauth-login.js";
import { buildDeadlineDedupResult } from "./deadline-dedup.js";
import { generateDeadlineSuggestions } from "./deadline-suggestions.js";
import { executePendingChatAction } from "./gemini-tools.js";
import {
  createIntegrationDateWindow,
  filterCanvasAssignmentsByDateWindow,
  filterTPEventsByDateWindow
} from "./integration-date-window.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import { EmailDigestService } from "./email-digest.js";
import { getVapidPublicKey, hasStaticVapidKeys, sendPushNotification } from "./push.js";
import { sendChatMessage, compressChatContext, GeminiError, RateLimitError, flushJournalSessionBuffer } from "./chat.js";
import { getGeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { fetchTPSchedule, diffScheduleEvents } from "./tp-sync.js";
import { TPSyncService } from "./tp-sync-service.js";
import { TimeEditSyncService } from "./timeedit-sync-service.js";
import { CanvasSyncService } from "./canvas-sync.js";
import type { CanvasSyncOptions } from "./canvas-sync.js";
import { CanvasClient } from "./canvas-client.js";
import { BlackboardSyncService } from "./blackboard-sync.js";
import { TeamsSyncService } from "./teams-sync.js";
import { MicrosoftOAuthService } from "./microsoft-oauth.js";
import { WithingsOAuthService } from "./withings-oauth.js";
import { WithingsSyncService } from "./withings-sync.js";
import { buildStudyPlanCalendarIcs } from "./study-plan-export.js";
import { generateWeeklyStudyPlan } from "./study-plan.js";
import { generateAnalyticsCoachInsight } from "./analytics-coach.js";
import {
  buildWeeklyGrowthSundayPushSummary,
  generateWeeklyGrowthReview,
  isSundayInOslo
} from "./weekly-growth-review.js";
import { maybeGenerateDailySummaryVisual } from "./growth-visuals.js";
import { PostgresRuntimeSnapshotStore } from "./postgres-persistence.js";
import { isGithubMcpServer, scheduleTpGithubDeadlineSubAgent } from "./tp-github-deadlines.js";
import { TPExamDeadlineBridge, type TPExamDeadlineBridgeResult } from "./tp-exam-deadline-bridge.js";
import type { PostgresPersistenceDiagnostics } from "./postgres-persistence.js";
import { Notification, NotificationPreferencesPatch } from "./types.js";
import type {
  AnalyticsCoachInsight,
  AuthProvider,
  AuthUser,
  Goal,
  Habit,
  NutritionCustomFood,
  NutritionMeal,
  IntegrationSyncName,
  IntegrationSyncRootCause
} from "./types.js";
import {
  PLAN_TIERS,
  getEffectivePlan,
  planHasFeature,
  planAllowsConnector,
  type PlanId,
  type FeatureId,
  type UserPlanInfo
} from "./plan-config.js";
import { SyncFailureRecoveryTracker, SyncRecoveryPrompt } from "./sync-failure-recovery.js";
import {
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  parseWebhookEvent,
  getStripeStatus,
  getPriceForPlan
} from "./stripe-integration.js";
import {
  isVippsConfigured,
  createAgreement,
  getAgreement,
  stopAgreement,
  getVippsStatus,
  processWebhookPayload,
  planIdFromAmount,
  type VippsWebhookPayload
} from "./vipps-integration.js";
import { nowIso } from "./utils.js";
import {
  clearMcpServers,
  getMcpServersPublic,
  removeMcpServer,
  upsertMcpServer,
  validateMcpServerConnection
} from "./mcp.js";
import { getMcpServerTemplateById, getMcpServerTemplates } from "./mcp-catalog.js";

const app = express();
const MAX_API_JSON_BODY_SIZE = "10mb";

interface RuntimePersistenceContext {
  store: RuntimeStore;
  sqlitePath: string;
  backend: "sqlite" | "postgres-snapshot";
  postgresSnapshotStore: PostgresRuntimeSnapshotStore | null;
  restoredSnapshotAt: string | null;
}

function fallbackStorageDiagnostics(sqlitePath: string): PostgresPersistenceDiagnostics {
  return {
    backend: "sqlite",
    sqlitePath: resolve(sqlitePath),
    snapshotRestoredAt: null,
    snapshotPersistedAt: null,
    snapshotSizeBytes: 0,
    lastError: null
  };
}

async function initializeRuntimeStore(): Promise<RuntimePersistenceContext> {
  const sqlitePath = config.SQLITE_DB_PATH;
  const postgresUrl = config.DATABASE_URL;

  if (!postgresUrl) {
    return {
      store: new RuntimeStore(sqlitePath),
      sqlitePath,
      backend: "sqlite",
      postgresSnapshotStore: null,
      restoredSnapshotAt: null
    };
  }

  const postgresSnapshotStore = new PostgresRuntimeSnapshotStore(postgresUrl);
  await postgresSnapshotStore.initialize();
  const restoreResult = await postgresSnapshotStore.restoreToSqliteFile(sqlitePath);
  const store = new RuntimeStore(sqlitePath);

  await postgresSnapshotStore.persistSnapshot(store.serializeDatabase());
  postgresSnapshotStore.startAutoSync(() => store.serializeDatabase(), config.POSTGRES_SNAPSHOT_SYNC_MS);

  return {
    store,
    sqlitePath,
    backend: "postgres-snapshot",
    postgresSnapshotStore,
    restoredSnapshotAt: restoreResult.updatedAt
  };
}

const persistenceContext = await initializeRuntimeStore();
const store = persistenceContext.store;
const authService = new AuthService(store, {
  required: config.AUTH_REQUIRED,
  adminEmail: config.AUTH_ADMIN_EMAIL,
  adminPassword: config.AUTH_ADMIN_PASSWORD,
  sessionTtlHours: config.AUTH_SESSION_TTL_HOURS,
  proWhitelistEmails: config.PRO_WHITELIST_EMAILS
});
const bootstrappedAdmin = authService.bootstrapAdminUser();
if (config.AUTH_REQUIRED && bootstrappedAdmin) {
  console.info(`[auth] Admin user ready: ${bootstrappedAdmin.email}`);
}
const storageDiagnostics = (): PostgresPersistenceDiagnostics =>
  persistenceContext.postgresSnapshotStore
    ? persistenceContext.postgresSnapshotStore.getDiagnostics(persistenceContext.sqlitePath)
    : fallbackStorageDiagnostics(persistenceContext.sqlitePath);

// ── Per-user background service management ──
// Services that need to run per-user are created on-demand as users become known.
// A periodic scan ensures new users get services spun up.
const runtime = new OrchestratorRuntime(store);
const digestServicesByUser = new Map<string, EmailDigestService>();
const tpSyncServicesByUser = new Map<string, TPSyncService>();
const timeEditSyncServicesByUser = new Map<string, TimeEditSyncService>();

function ensurePerUserServices(userId: string): void {
  if (!userId) return;

  if (!digestServicesByUser.has(userId)) {
    const ds = new EmailDigestService(store, userId);
    digestServicesByUser.set(userId, ds);
    ds.start();
  }
  if (!tpSyncServicesByUser.has(userId)) {
    const ts = new TPSyncService(store, userId);
    tpSyncServicesByUser.set(userId, ts);
    ts.start();
  }
  if (!timeEditSyncServicesByUser.has(userId)) {
    const te = new TimeEditSyncService(store, userId);
    timeEditSyncServicesByUser.set(userId, te);
    te.start();
  }
  // Blackboard & Teams sync are connection-gated AND plan-gated:
  // only start when the user has actually connected the service
  // and their plan allows the connector.
  const user = store.getUserById(userId);
  const userPlan = user ? getEffectivePlan(user.plan as PlanId, user.role, user.trialEndsAt) : ("free" as PlanId);

  if (!blackboardSyncServicesByUser.has(userId)) {
    if (planAllowsConnector(userPlan, "blackboard")) {
      const bbConn = store.getUserConnection(userId, "blackboard");
      if (bbConn?.credentials) {
        const bb = new BlackboardSyncService(store, userId);
        blackboardSyncServicesByUser.set(userId, bb);
        bb.start();
      }
    }
  }
  if (!teamsSyncServicesByUser.has(userId)) {
    if (planAllowsConnector(userPlan, "teams")) {
      const tmConn = store.getUserConnection(userId, "teams");
      if (tmConn?.credentials) {
        const tm = new TeamsSyncService(store, userId);
        teamsSyncServicesByUser.set(userId, tm);
        tm.start();
      }
    }
  }
}

/** Periodically scan for new users and spin up their background services. */
function refreshPerUserServices(): void {
  for (const uid of store.getAllUserIds()) {
    ensurePerUserServices(uid);
  }
}

// BackgroundSyncService operates on a global queue (not user-scoped) — one instance is fine.
const syncService = new BackgroundSyncService(store, "");
const syncFailureRecovery = new SyncFailureRecoveryTracker();
const CANVAS_ON_DEMAND_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
const CANVAS_ON_DEMAND_SYNC_STALE_MS = 25 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const MAX_ANALYTICS_CACHE_ITEMS = 15;
const ANALYTICS_COACH_MIN_REFRESH_MS = config.GROWTH_ANALYTICS_MIN_REFRESH_MINUTES * 60 * 1000;
const DAILY_SUMMARY_MIN_REFRESH_MS = 15 * 60 * 1000;

interface AnalyticsCoachCacheEntry {
  signature: string;
  insight: AnalyticsCoachInsight;
}

const analyticsCoachCache = new Map<string, AnalyticsCoachCacheEntry>();

import type { DailyGrowthSummary } from "./types.js";
const dailySummaryCache = new Map<string, DailyGrowthSummary>();
const canvasSyncServicesByUser = new Map<string, CanvasSyncService>();
const blackboardSyncServicesByUser = new Map<string, BlackboardSyncService>();
const teamsSyncServicesByUser = new Map<string, TeamsSyncService>();
const microsoftOAuthServicesByUser = new Map<string, MicrosoftOAuthService>();
const withingsOAuthServicesByUser = new Map<string, WithingsOAuthService>();
const withingsSyncServicesByUser = new Map<string, WithingsSyncService>();

interface PendingOAuthState {
  userId: string;
  expiresAt: number;
}

interface PendingMcpGitHubOAuthState extends PendingOAuthState {
  templateId: string;
}

const withingsPendingOAuthStates = new Map<string, PendingOAuthState>();
const microsoftPendingOAuthStates = new Map<string, PendingOAuthState>();
const mcpGitHubPendingOAuthStates = new Map<string, PendingMcpGitHubOAuthState>();
const tpSyncInFlightUsers = new Set<string>();

interface CanvasConnectorCredentials {
  token?: string;
  baseUrl?: string;
}

interface TPUserSyncOptions {
  icalUrl?: string;
  semester?: string;
  courseIds?: string[];
  pastDays?: number;
  futureDays?: number;
}

interface TPUserSyncResult {
  success: boolean;
  eventsProcessed: number;
  lecturesCreated: number;
  lecturesUpdated: number;
  lecturesDeleted: number;
  examDeadlineBridge?: TPExamDeadlineBridgeResult;
  appliedScope?: {
    semester: string;
    courseIds: string[];
    pastDays: number;
    futureDays: number;
    icalUrl?: string;
  };
  error?: string;
}

function parseConnectionCredentials(credentials: string | undefined): Record<string, unknown> | null {
  if (!credentials) {
    return null;
  }

  try {
    const parsed = JSON.parse(credentials);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeHttpUrl(
  value: string | undefined,
  options: { stripTrailingSlash?: boolean } = {}
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    let normalized = url.toString();
    if (options.stripTrailingSlash) {
      normalized = normalized.replace(/\/+$/, "");
    }
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeCanvasBaseUrl(value: string | undefined): string | undefined {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return undefined;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return undefined;
  }
}

function getCanvasConnectorCredentials(userId: string): CanvasConnectorCredentials | null {
  const connection = store.getUserConnection(userId, "canvas");
  const parsed = parseConnectionCredentials(connection?.credentials);
  if (!parsed) {
    return null;
  }

  const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
  const baseUrlRaw = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
  const baseUrl = normalizeCanvasBaseUrl(baseUrlRaw);

  return {
    ...(token ? { token } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function resolveCanvasSyncOptions(userId: string, requested: Partial<CanvasSyncOptions> = {}): CanvasSyncOptions {
  const connected = getCanvasConnectorCredentials(userId);
  const requestedToken = typeof requested.token === "string" ? requested.token.trim() : "";
  const requestedBaseUrlRaw = typeof requested.baseUrl === "string" ? requested.baseUrl.trim() : "";
  // Only use the user's own Canvas credentials or explicitly requested ones.
  // Do NOT fall back to config.CANVAS_API_TOKEN — that would leak admin data to other users.
  const token = requestedToken || connected?.token;
  const baseUrl = normalizeCanvasBaseUrl(requestedBaseUrlRaw || connected?.baseUrl || config.CANVAS_BASE_URL);

  return {
    ...(token ? { token } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(requested.courseIds ? { courseIds: requested.courseIds } : {}),
    ...(typeof requested.pastDays === "number" ? { pastDays: requested.pastDays } : {}),
    ...(typeof requested.futureDays === "number" ? { futureDays: requested.futureDays } : {})
  };
}

function getConnectedTPIcalUrl(userId: string): string | undefined {
  const connection = store.getUserConnection(userId, "tp_schedule");
  const parsed = parseConnectionCredentials(connection?.credentials);
  if (!parsed) {
    return undefined;
  }

  const raw = typeof parsed.icalUrl === "string" ? parsed.icalUrl.trim() : "";
  return normalizeHttpUrl(raw);
}

function getCanvasSyncServiceForUser(userId: string): CanvasSyncService {
  const existing = canvasSyncServicesByUser.get(userId);
  if (existing) {
    return existing;
  }

  const created = new CanvasSyncService(store, userId);
  canvasSyncServicesByUser.set(userId, created);
  return created;
}

function getBlackboardSyncServiceForUser(userId: string): BlackboardSyncService {
  const existing = blackboardSyncServicesByUser.get(userId);
  if (existing) {
    return existing;
  }

  const created = new BlackboardSyncService(store, userId);
  blackboardSyncServicesByUser.set(userId, created);
  return created;
}

function getTeamsSyncServiceForUser(userId: string): TeamsSyncService {
  const existing = teamsSyncServicesByUser.get(userId);
  if (existing) {
    return existing;
  }

  const created = new TeamsSyncService(store, userId, getMicrosoftOAuthServiceForUser(userId));
  teamsSyncServicesByUser.set(userId, created);
  return created;
}

function getMicrosoftOAuthServiceForUser(userId: string): MicrosoftOAuthService {
  const existing = microsoftOAuthServicesByUser.get(userId);
  if (existing) return existing;
  const created = new MicrosoftOAuthService(store, userId);
  microsoftOAuthServicesByUser.set(userId, created);
  return created;
}

function getWithingsOAuthServiceForUser(userId: string): WithingsOAuthService {
  const existing = withingsOAuthServicesByUser.get(userId);
  if (existing) {
    return existing;
  }

  const created = new WithingsOAuthService(store, userId);
  withingsOAuthServicesByUser.set(userId, created);
  return created;
}

function getWithingsSyncServiceForUser(userId: string): WithingsSyncService {
  const existing = withingsSyncServicesByUser.get(userId);
  if (existing) {
    return existing;
  }

  const created = new WithingsSyncService(store, userId, getWithingsOAuthServiceForUser(userId));
  created.start();
  withingsSyncServicesByUser.set(userId, created);
  return created;
}

function stopWithingsServicesForUser(userId: string): void {
  const syncServiceForUser = withingsSyncServicesByUser.get(userId);
  if (syncServiceForUser) {
    syncServiceForUser.stop();
    withingsSyncServicesByUser.delete(userId);
  }

  withingsOAuthServicesByUser.delete(userId);
  clearPendingOAuthStatesForUser(withingsPendingOAuthStates, userId);
}

function syncOAuthConnectorConnections(userId: string): void {
  const withingsInfo = getWithingsOAuthServiceForUser(userId).getConnectionInfo();
  const withingsConnection = store.getUserConnection(userId, "withings");
  if (withingsInfo.connected && !withingsConnection) {
    store.upsertUserConnection({
      userId,
      service: "withings",
      credentials: JSON.stringify({ source: withingsInfo.source ?? "oauth" }),
      displayLabel: "Withings Health"
    });
  }
}

function cleanupPendingOAuthStates<T extends PendingOAuthState>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [state, entry] of map.entries()) {
    if (entry.expiresAt <= now) {
      map.delete(state);
    }
  }
}

function registerPendingOAuthState(map: Map<string, PendingOAuthState>, state: string, userId: string): void {
  cleanupPendingOAuthStates(map);
  map.set(state, {
    userId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });
}

function consumePendingOAuthStateUserId(map: Map<string, PendingOAuthState>, state: string | null): string | null {
  cleanupPendingOAuthStates(map);
  if (!state) {
    return null;
  }

  const entry = map.get(state);
  if (!entry || entry.expiresAt <= Date.now()) {
    map.delete(state);
    return null;
  }

  map.delete(state);
  return entry.userId;
}

function clearPendingOAuthStatesForUser<T extends PendingOAuthState>(map: Map<string, T>, userId: string): void {
  for (const [state, entry] of map.entries()) {
    if (entry.userId === userId) {
      map.delete(state);
    }
  }
}

function registerPendingMcpGitHubOAuthState(state: string, userId: string, templateId: string): void {
  cleanupPendingOAuthStates(mcpGitHubPendingOAuthStates);
  mcpGitHubPendingOAuthStates.set(state, {
    userId,
    templateId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });
}

function consumePendingMcpGitHubOAuthState(state: string | null): PendingMcpGitHubOAuthState | null {
  cleanupPendingOAuthStates(mcpGitHubPendingOAuthStates);
  if (!state) {
    return null;
  }

  const entry = mcpGitHubPendingOAuthStates.get(state);
  if (!entry || entry.expiresAt <= Date.now()) {
    mcpGitHubPendingOAuthStates.delete(state);
    return null;
  }

  mcpGitHubPendingOAuthStates.delete(state);
  return entry;
}

function extractStateFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("state");
  } catch {
    return null;
  }
}

async function runTPSyncForUser(userId: string, options: TPUserSyncOptions = {}): Promise<TPUserSyncResult> {
  const requestedIcalUrl = normalizeHttpUrl(options.icalUrl);
  const connectedIcalUrl = getConnectedTPIcalUrl(userId);
  const appliedIcalUrl = requestedIcalUrl ?? connectedIcalUrl;
  const explicitCourseIds =
    options.courseIds && options.courseIds.length > 0
      ? options.courseIds.map((value) => value.trim()).filter(Boolean)
      : [];

  // If user has no iCal URL configured and didn't provide explicit courseIds,
  // there's nothing to sync — don't fall back to hardcoded course IDs.
  if (!appliedIcalUrl && explicitCourseIds.length === 0) {
    return {
      success: true,
      eventsProcessed: 0,
      lecturesCreated: 0,
      lecturesUpdated: 0,
      lecturesDeleted: 0,
      appliedScope: {
        semester: options.semester ?? "26v",
        courseIds: [],
        pastDays: options.pastDays ?? config.INTEGRATION_WINDOW_PAST_DAYS,
        futureDays: options.futureDays ?? config.INTEGRATION_WINDOW_FUTURE_DAYS
      }
    };
  }

  tpSyncInFlightUsers.add(userId);

  try {
    const tpEvents = await fetchTPSchedule({
      ...(appliedIcalUrl
        ? { icalUrl: appliedIcalUrl }
        : { semester: options.semester, courseIds: explicitCourseIds }),
      pastDays: options.pastDays,
      futureDays: options.futureDays
    });
    const existingEvents = store.getScheduleEvents(userId);
    const diff = diffScheduleEvents(existingEvents, tpEvents);
    const result = store.upsertScheduleEvents(userId, diff.toCreate, diff.toUpdate, diff.toDelete);
    const examDeadlineBridge = new TPExamDeadlineBridge(store, userId).syncExamDeadlines(tpEvents);

    return {
      success: true,
      eventsProcessed: tpEvents.length,
      lecturesCreated: result.created,
      lecturesUpdated: result.updated,
      lecturesDeleted: result.deleted,
      ...(examDeadlineBridge.candidates > 0 ? { examDeadlineBridge } : {}),
      appliedScope: {
        semester: options.semester ?? "26v",
        courseIds: appliedIcalUrl ? [] : explicitCourseIds,
        pastDays: options.pastDays ?? config.INTEGRATION_WINDOW_PAST_DAYS,
        futureDays: options.futureDays ?? config.INTEGRATION_WINDOW_FUTURE_DAYS,
        ...(appliedIcalUrl ? { icalUrl: appliedIcalUrl } : {})
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      eventsProcessed: 0,
      lecturesCreated: 0,
      lecturesUpdated: 0,
      lecturesDeleted: 0
    };
  } finally {
    tpSyncInFlightUsers.delete(userId);
  }
}

function maybeTriggerTpGithubDeadlineSubAgent(userId: string, githubServerId: string): void {
  const tpIcalUrl = getConnectedTPIcalUrl(userId);
  if (!tpIcalUrl) {
    return;
  }

  const scheduled = scheduleTpGithubDeadlineSubAgent({
    store,
    userId,
    tpIcalUrl,
    githubServerId
  });

  if (scheduled) {
    console.info(
      `[tp-github-sub-agent] scheduled background import for user=${userId} githubServer=${githubServerId}`
    );
  }
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startsWithDateKey(value: string, dateKey: string): boolean {
  return typeof value === "string" && value.startsWith(dateKey);
}

function latestIso(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), "");
}

function toDateMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isCacheEntryFresh(generatedAt: string | undefined, minRefreshMs: number, nowMs: number): boolean {
  if (!generatedAt) {
    return false;
  }
  const generatedAtMs = toDateMs(generatedAt);
  if (generatedAtMs === null) {
    return false;
  }
  return nowMs - generatedAtMs < minRefreshMs;
}

function parseBooleanQueryFlag(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isWithinWindow(value: string, startMs: number, endMs: number): boolean {
  const valueMs = toDateMs(value);
  return valueMs !== null && valueMs >= startMs && valueMs <= endMs;
}

function toAnalyticsPeriodDays(value: number | undefined): AnalyticsCoachInsight["periodDays"] {
  if (value === 14 || value === 30) {
    return value;
  }
  return 7;
}

function buildAnalyticsCoachSignature(
  userId: string,
  periodDays: AnalyticsCoachInsight["periodDays"],
  now: Date
): { cacheKey: string; signature: string } {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const windowEndIso = now.toISOString();
  const cacheKey = `${periodDays}:${toDateKey(now)}`;

  const deadlines = store
    .getDeadlines(userId, now, false)
    .filter((deadline) => isWithinWindow(deadline.dueDate, windowStartMs, nowMs))
    .map((deadline) => `${deadline.id}:${deadline.dueDate}:${deadline.completed ? 1 : 0}:${deadline.priority}`)
    .sort()
    .join(",");

  const habits = store
    .getHabitsWithStatus(userId)
    .map((habit) => {
      const recent = habit.recentCheckIns.map((day) => `${day.date}:${day.completed ? 1 : 0}`).join(";");
      return `${habit.id}:${habit.createdAt}:${habit.streak}:${habit.completionRate7d}:${habit.todayCompleted ? 1 : 0}:${recent}`;
    })
    .sort()
    .join(",");

  const goals = store
    .getGoalsWithStatus(userId)
    .map((goal) => {
      const recent = goal.recentCheckIns.map((day) => `${day.date}:${day.completed ? 1 : 0}`).join(";");
      return `${goal.id}:${goal.createdAt}:${goal.progressCount}:${goal.targetCount}:${goal.todayCompleted ? 1 : 0}:${goal.dueDate ?? ""}:${recent}`;
    })
    .sort()
    .join(",");

  const reflections = store.getReflectionEntriesInRange(userId, windowStartIso, windowEndIso, 420);
  const reflectionSig = `${reflections.length}:${latestIso(reflections.map((entry) => entry.updatedAt || entry.timestamp))}`;

  const adherence = store.getStudyPlanAdherenceMetrics(userId, {
    windowStart: windowStartIso,
    windowEnd: windowEndIso
  });
  const trends = store.getContextTrends(userId).latestContext;

  const signature = [
    `p:${periodDays}`,
    `d:${deadlines}`,
    `h:${habits}`,
    `g:${goals}`,
    `r:${reflectionSig}`,
    `a:${adherence.sessionsPlanned}:${adherence.sessionsDone}:${adherence.sessionsSkipped}:${adherence.completionRate}`,
    `ctx:${trends.energyLevel}:${trends.stressLevel}:${trends.mode}`
  ].join("|");

  return { cacheKey, signature };
}

function setCachedAnalyticsCoachInsight(cacheKey: string, entry: AnalyticsCoachCacheEntry): void {
  analyticsCoachCache.delete(cacheKey);
  analyticsCoachCache.set(cacheKey, entry);

  while (analyticsCoachCache.size > MAX_ANALYTICS_CACHE_ITEMS) {
    const oldestKey = analyticsCoachCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    analyticsCoachCache.delete(oldestKey);
  }
}

// Boot per-user services for all existing users, then check periodically for new ones.
refreshPerUserServices();
const perUserServiceRefreshTimer = setInterval(refreshPerUserServices, 60_000);

syncService.start();

async function maybeAutoSyncCanvasData(userId: string): Promise<void> {
  try {
    const syncOptions = resolveCanvasSyncOptions(userId);
    if (!syncOptions.token) {
      return;
    }

    const canvasService = getCanvasSyncServiceForUser(userId);
    const syncStartedAt = Date.now();
    const result = await canvasService.syncIfStale({
      staleMs: CANVAS_ON_DEMAND_SYNC_STALE_MS,
      minIntervalMs: CANVAS_ON_DEMAND_SYNC_MIN_INTERVAL_MS,
      syncOptions
    });

    if (!result) {
      return;
    }

    if (result.success) {
      syncFailureRecovery.recordSuccess("canvas");
      recordIntegrationAttempt("canvas", syncStartedAt, true);
      return;
    }

    const recoveryPrompt = syncFailureRecovery.recordFailure("canvas", result.error ?? "Canvas sync failed");
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("canvas", syncStartedAt, false, result.error ?? "Canvas sync failed");
  } catch {
    // Keep reads resilient when Canvas is temporarily unavailable.
  }
}

function hasUpcomingScheduleEvents(reference: Date, lookAheadHours = 36, userId = ""): boolean {
  const nowMs = reference.getTime();
  const lookAheadMs = nowMs + lookAheadHours * 60 * 60 * 1000;
  return store.getScheduleEvents(userId).some((event) => {
    const startMs = Date.parse(event.startTime);
    return Number.isFinite(startMs) && startMs >= nowMs && startMs <= lookAheadMs;
  });
}

function publishSyncRecoveryPrompt(prompt: SyncRecoveryPrompt | null, userId = ""): void {
  if (!prompt) {
    return;
  }

  const details = [prompt.rootCauseHint, ...prompt.suggestedActions.slice(0, 2)].join(" ");
  store.pushNotification(userId, {
    source: "orchestrator",
    title: prompt.title,
    message: `${prompt.message} ${details}`.trim(),
    priority: prompt.severity === "high" ? "high" : "medium",
    url: "/companion/?tab=settings&section=integrations",
    metadata: {
      integration: prompt.integration,
      failureCount: prompt.failureCount,
      rootCauseHint: prompt.rootCauseHint,
      suggestedActions: prompt.suggestedActions
    }
  });
}

function categorizeSyncRootCause(message: string | undefined): IntegrationSyncRootCause {
  if (!message) {
    return "unknown";
  }

  const text = message.toLowerCase();
  if (/(unauthor|forbidden|oauth|token|credential|permission|401|403)/.test(text)) {
    return "auth";
  }
  if (/(rate limit|quota|resource exhausted|429)/.test(text)) {
    return "rate_limit";
  }
  if (/(timeout|network|socket|econn|enotfound|dns|fetch failed|connect)/.test(text)) {
    return "network";
  }
  if (/(invalid|validation|zod|schema|payload|400 bad request)/.test(text)) {
    return "validation";
  }
  if (/(provider|upstream|internal|5\\d\\d)/.test(text)) {
    return "provider";
  }

  return "unknown";
}

function recordIntegrationAttempt(
  integration: IntegrationSyncName,
  startedAtMs: number,
  success: boolean,
  errorMessage?: string
): void {
  store.recordIntegrationSyncAttempt({
    integration,
    status: success ? "success" : "failure",
    latencyMs: Math.max(0, Date.now() - startedAtMs),
    rootCause: success ? "none" : categorizeSyncRootCause(errorMessage),
    errorMessage: success ? null : errorMessage ?? null,
    attemptedAt: nowIso()
  });
}

interface AuthenticatedRequest extends express.Request {
  authUser?: AuthUser;
  authToken?: string;
}

function resolveRequestUserId(req: express.Request): string | null {
  const authReq = req as AuthenticatedRequest;
  if (authReq.authUser?.id) {
    return authReq.authUser.id;
  }

  const authContext = authService.authenticateFromAuthorizationHeader(req.headers.authorization);
  if (authContext?.user.id) {
    return authContext.user.id;
  }

  return authService.isRequired() ? null : "";
}

function isPublicApiRoute(method: string, path: string): boolean {
  return (
    (method === "GET" && path === "/api/health") ||
    (method === "POST" && path === "/api/auth/login") ||
    (method === "GET" && path === "/api/auth/status") ||
    (method === "GET" && path === "/api/auth/google") ||
    (method === "GET" && path === "/api/auth/google/callback") ||
    (method === "GET" && path === "/api/auth/github") ||
    (method === "GET" && path === "/api/auth/github/callback") ||
    (method === "GET" && path === "/api/auth/withings") ||
    (method === "GET" && path === "/api/auth/withings/callback") ||
    (method === "GET" && path === "/api/auth/microsoft/callback") ||
    (method === "GET" && path === "/api/plan/tiers") ||
    (method === "POST" && path === "/api/stripe/webhook") ||
    (method === "POST" && path === "/api/vipps/webhook")
  );
}

app.use(cors());

// Stripe webhook needs raw body — register BEFORE express.json()
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  try {
    const event = parseWebhookEvent(req.body as Buffer, signature);
    console.log(`[stripe] webhook: ${event.type} userId=${event.userId} plan=${event.planId}`);

    switch (event.type) {
      case "checkout.session.completed": {
        if (event.userId && event.planId) {
          store.updateUserPlan(event.userId, event.planId);
        }
        if (event.userId && event.stripeCustomerId) {
          store.updateStripeCustomerId(event.userId, event.stripeCustomerId);
        }
        break;
      }
      case "customer.subscription.updated": {
        // Subscription change (upgrade/downgrade)
        const user = event.userId
          ? store.getUserById(event.userId)
          : event.stripeCustomerId
            ? store.getUserByStripeCustomerId(event.stripeCustomerId)
            : null;
        if (user && event.planId && event.status === "active") {
          store.updateUserPlan(user.id, event.planId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        // Subscription cancelled — downgrade to free
        const cancelledUser = event.userId
          ? store.getUserById(event.userId)
          : event.stripeCustomerId
            ? store.getUserByStripeCustomerId(event.stripeCustomerId)
            : null;
        if (cancelledUser) {
          store.updateUserPlan(cancelledUser.id, "free");
        }
        break;
      }
      case "invoice.payment_failed": {
        console.warn(`[stripe] payment failed for customer=${event.stripeCustomerId}`);
        break;
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("[stripe] webhook error:", err);
    return res.status(400).json({ error: "Webhook verification failed" });
  }
});

app.use(express.json({ limit: MAX_API_JSON_BODY_SIZE }));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const maybeError = error as { type?: string; status?: number; statusCode?: number; body?: unknown } | undefined;
  const isPayloadTooLarge =
    maybeError?.type === "entity.too.large" || maybeError?.status === 413 || maybeError?.statusCode === 413;

  if (isPayloadTooLarge) {
    return res.status(413).json({
      error: `Payload too large. Reduce attachment size and retry (max request body ${MAX_API_JSON_BODY_SIZE}).`
    });
  }

  if (error instanceof SyntaxError && maybeError && Object.prototype.hasOwnProperty.call(maybeError, "body")) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  return next(error);
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  if (!authService.isRequired()) {
    return next();
  }

  if (isPublicApiRoute(req.method, req.path)) {
    return next();
  }

  const authContext = authService.authenticateFromAuthorizationHeader(req.headers.authorization);
  if (!authContext) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  (req as AuthenticatedRequest).authUser = authContext.user;
  (req as AuthenticatedRequest).authToken = authContext.token;
  getWithingsSyncServiceForUser(authContext.user.id);
  return next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    storage: storageDiagnostics()
  });
});

app.get("/api/auth/status", (_req, res) => {
  return res.json({
    required: authService.isRequired(),
    providers: {
      google: googleOAuthEnabled(),
      github: githubOAuthEnabled(),
      local: Boolean(config.AUTH_ADMIN_EMAIL)
    }
  });
});

app.post("/api/auth/login", (req, res) => {
  const parsed = authLoginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload", issues: parsed.error.issues });
  }

  const session = authService.login(parsed.data.email, parsed.data.password);
  if (!session) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Ensure background services are running for this user
  ensurePerUserServices(session.user.id);

  return res.status(200).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user
  });
});

app.get("/api/auth/me", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({ user: authReq.authUser });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  authService.logout(token);
  return res.status(204).send();
});

// ── OAuth Login Routes ──

function createOAuthSession(user: AuthUser): { token: string; expiresAt: string } {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + config.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  store.createAuthSession({ userId: user.id, tokenHash, expiresAt });
  // Ensure background services are running for this user
  ensurePerUserServices(user.id);
  return { token, expiresAt };
}

function getOAuthFrontendRedirect(token: string): string {
  // Redirect to the FRONTEND (not the server) with token in URL fragment
  const base = config.FRONTEND_URL;
  // Ensure trailing slash for GitHub Pages paths
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}#auth_token=${encodeURIComponent(token)}`;
}

function getIntegrationFrontendRedirect(
  connector: "withings" | "mcp" | "teams",
  status: "connected" | "failed",
  message?: string,
): string {
  const url = new URL(config.FRONTEND_URL);
  const params = url.searchParams;
  params.set("tab", "settings");
  params.set("section", "integrations");
  params.set("connector", connector);
  params.set("oauthStatus", status);
  if (message && message.trim().length > 0) {
    params.set("oauthMessage", message.trim().slice(0, 220));
  } else {
    params.delete("oauthMessage");
  }
  return url.toString();
}

app.get("/api/auth/google", (_req, res) => {
  if (!googleOAuthEnabled()) {
    return res.status(404).json({ error: "Google OAuth not configured" });
  }
  const state = Math.random().toString(36).slice(2);
  return res.redirect(getGoogleOAuthUrl(state));
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing OAuth code");

    const profile = await exchangeGoogleCode(code);
    const adminEmail = authService.getAdminEmail();
    const isAdmin = adminEmail !== null && profile.email.toLowerCase() === adminEmail;
    const user = store.upsertOAuthUser({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      provider: "google",
      role: isAdmin ? "admin" : undefined
    });
    // Auto-promote whitelisted emails to pro plan
    if (!isAdmin && user.plan !== "pro" && authService.isProWhitelisted(profile.email)) {
      store.updateUserPlan(user.id, "pro");
    }
    const session = createOAuthSession(user);
    return res.redirect(getOAuthFrontendRedirect(session.token));
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return res.status(500).send("OAuth login failed. Please try again.");
  }
});

app.get("/api/auth/github", (_req, res) => {
  if (!githubOAuthEnabled()) {
    return res.status(404).json({ error: "GitHub OAuth not configured" });
  }
  const state = Math.random().toString(36).slice(2);
  return res.redirect(getGitHubOAuthUrl(state));
});

app.get("/api/auth/github/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const pendingMcpOAuth = consumePendingMcpGitHubOAuthState(state);
  if (pendingMcpOAuth) {
    try {
      const code = req.query.code as string;
      if (!code) {
        return res.redirect(getIntegrationFrontendRedirect("mcp", "failed", "Missing OAuth code"));
      }

      const template = getMcpServerTemplateById(pendingMcpOAuth.templateId);
      if (!template) {
        return res.redirect(getIntegrationFrontendRedirect("mcp", "failed", "MCP template no longer exists"));
      }

      const exchange = await exchangeGitHubCodeWithToken(code);
      const { server } = await upsertMcpTemplateServerWithToken(
        pendingMcpOAuth.userId,
        template.id,
        exchange.accessToken
      );
      if (isGithubMcpServer(server)) {
        maybeTriggerTpGithubDeadlineSubAgent(pendingMcpOAuth.userId, server.id);
      }
      return res.redirect(getIntegrationFrontendRedirect("mcp", "connected", `${template.label} connected`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub OAuth callback failed";
      return res.redirect(getIntegrationFrontendRedirect("mcp", "failed", message));
    }
  }

  try {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing OAuth code");

    const profile = await exchangeGitHubCode(code);
    const adminEmail = authService.getAdminEmail();
    const isAdmin = adminEmail !== null && profile.email.toLowerCase() === adminEmail;
    const user = store.upsertOAuthUser({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      provider: "github",
      role: isAdmin ? "admin" : undefined
    });
    // Auto-promote whitelisted emails to pro plan
    if (!isAdmin && user.plan !== "pro" && authService.isProWhitelisted(profile.email)) {
      store.updateUserPlan(user.id, "pro");
    }
    const session = createOAuthSession(user);
    return res.redirect(getOAuthFrontendRedirect(session.token));
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    return res.status(500).send("OAuth login failed. Please try again.");
  }
});

// ── Consent / TOS / Privacy ──

const CURRENT_TOS_VERSION = "1.0";
const CURRENT_PRIVACY_VERSION = "1.0";

app.get("/api/consent/status", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const consent = store.getConsentStatus(authReq.authUser.id);
  const needsConsent =
    consent.tosVersion !== CURRENT_TOS_VERSION ||
    consent.privacyVersion !== CURRENT_PRIVACY_VERSION;

  return res.json({
    needsConsent,
    currentTosVersion: CURRENT_TOS_VERSION,
    currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
    ...consent
  });
});

app.post("/api/consent/accept", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const { tosVersion, privacyVersion } = (req.body ?? {}) as { tosVersion?: string; privacyVersion?: string };
  if (tosVersion !== CURRENT_TOS_VERSION || privacyVersion !== CURRENT_PRIVACY_VERSION) {
    return res.status(400).json({ error: "Version mismatch — please review the latest terms" });
  }

  store.acceptConsent(authReq.authUser.id, tosVersion, privacyVersion);
  return res.json({ accepted: true });
});

// ── GDPR: Data Deletion ──

app.delete("/api/user/data", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  store.deleteAllUserData(authReq.authUser.id);
  clearPendingOAuthStatesForUser(withingsPendingOAuthStates, authReq.authUser.id);
  clearPendingOAuthStatesForUser(mcpGitHubPendingOAuthStates, authReq.authUser.id);
  return res.json({ deleted: true });
});

// ── User Connections / Connectors ──

const connectorServiceSchema = z.enum(["canvas", "blackboard", "withings", "tp_schedule", "timeedit", "teams", "mcp"]);
const canvasConnectorCredentialsSchema = z.object({
  token: z.string().trim().min(1),
  baseUrl: z.string().url().optional()
});
const mcpTemplateConnectSchema = z.object({
  token: z.string().trim().min(1).max(4096).optional()
});

async function upsertMcpTemplateServerWithToken(
  userId: string,
  templateId: string,
  token: string
): Promise<{
  server: ReturnType<typeof upsertMcpServer>;
  publicServers: ReturnType<typeof getMcpServersPublic>;
}> {
  const template = getMcpServerTemplateById(templateId);
  if (!template) {
    throw new Error("MCP template not found");
  }

  const mcpInput = {
    label: template.label,
    serverUrl: template.serverUrl,
    token: token.trim(),
    toolAllowlist: template.suggestedToolAllowlist
  };

  await validateMcpServerConnection(mcpInput);
  const server = upsertMcpServer(store, userId, mcpInput);
  const publicServers = getMcpServersPublic(store, userId);
  return { server, publicServers };
}

app.get("/api/connectors", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  syncOAuthConnectorConnections(authReq.authUser.id);
  const connections = store.getUserConnections(authReq.authUser.id);
  // Strip credentials from response — only send service + status
  const result = connections.map((c) => ({
    service: c.service,
    displayLabel: c.displayLabel,
    connectedAt: c.connectedAt,
    updatedAt: c.updatedAt
  }));
  return res.json({ connections: result });
});

app.get("/api/mcp/servers", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  return res.json({
    servers: getMcpServersPublic(store, authReq.authUser.id)
  });
});

app.get("/api/mcp/catalog", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const templates = getMcpServerTemplates().map((template) => ({
    ...template,
    oauthEnabled:
      template.authType === "oauth" && template.oauthProvider === "github"
        ? githubOAuthEnabled()
        : false
  }));

  return res.json({
    templates
  });
});

app.post("/api/mcp/templates/:templateId/connect", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const effectivePlan = getEffectivePlan(authReq.authUser.plan, authReq.authUser.role, authReq.authUser.trialEndsAt);
  if (!planAllowsConnector(effectivePlan, "mcp")) {
    return res.status(403).json({
      error: "Your plan does not include this integration",
      upgradeRequired: true,
      service: "mcp"
    });
  }

  const templateId = typeof req.params.templateId === "string" ? req.params.templateId.trim() : "";
  if (!templateId) {
    return res.status(400).json({ error: "Template ID is required" });
  }

  const template = getMcpServerTemplateById(templateId);
  if (!template) {
    return res.status(404).json({ error: "MCP template not found" });
  }

  const parsedPayload = mcpTemplateConnectSchema.safeParse(req.body ?? {});
  if (!parsedPayload.success) {
    return res.status(400).json({
      error: "Invalid template payload",
      issues: parsedPayload.error.issues
    });
  }

  const token = parsedPayload.data.token?.trim();
  if (token && token.length > 0) {
    try {
      const { server, publicServers } = await upsertMcpTemplateServerWithToken(authReq.authUser.id, template.id, token);
      if (isGithubMcpServer(server)) {
        maybeTriggerTpGithubDeadlineSubAgent(authReq.authUser.id, server.id);
      }
      return res.json({
        ok: true,
        service: "mcp",
        displayLabel: publicServers.length === 1 ? "1 server" : `${publicServers.length} servers`,
        server: {
          id: server.id,
          label: server.label,
          serverUrl: server.serverUrl,
          enabled: server.enabled,
          toolAllowlist: server.toolAllowlist,
          hasToken: Boolean(server.token)
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect to MCP template";
      return res.status(400).json({ error: message });
    }
  }

  if (template.authType === "oauth" && template.oauthProvider === "github") {
    if (!githubOAuthEnabled()) {
      return res.status(400).json({
        error: "GitHub OAuth is not configured on this server. Paste a GitHub token instead."
      });
    }

    const state = `mcp_${Math.random().toString(36).slice(2)}`;
    registerPendingMcpGitHubOAuthState(state, authReq.authUser.id, template.id);
    const redirectUrl = getGitHubOAuthUrl(state, {
      scope: "user:email read:user repo read:org"
    });
    return res.json({ redirectUrl });
  }

  return res.status(400).json({
    error: `${template.tokenLabel} is required for this MCP template`
  });
});

app.delete("/api/mcp/servers/:serverId", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const serverId = typeof req.params.serverId === "string" ? req.params.serverId.trim() : "";
  if (!serverId) {
    return res.status(400).json({ error: "Server ID is required" });
  }

  const removed = removeMcpServer(store, authReq.authUser.id, serverId);
  if (!removed) {
    return res.status(404).json({ error: "MCP server not found" });
  }

  return res.json({ ok: true });
});

app.post("/api/connectors/:service/connect", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const parsed = connectorServiceSchema.safeParse(req.params.service);
  if (!parsed.success) return res.status(400).json({ error: "Unknown service" });
  const service = parsed.data;

  // Plan gate: check if user's plan allows this connector
  const effectivePlan = getEffectivePlan(authReq.authUser.plan, authReq.authUser.role, authReq.authUser.trialEndsAt);
  if (!planAllowsConnector(effectivePlan, service)) {
    return res.status(403).json({
      error: "Your plan does not include this integration",
      upgradeRequired: true,
      service
    });
  }

  // Token/config connectors
  if (service === "canvas") {
    const parsedCanvasCredentials = canvasConnectorCredentialsSchema.safeParse(req.body ?? {});
    if (!parsedCanvasCredentials.success) {
      return res.status(400).json({
        error: "Canvas API token is required and Canvas base URL must be a valid URL if provided",
        issues: parsedCanvasCredentials.error.issues
      });
    }

    const normalizedBaseUrl = normalizeCanvasBaseUrl(parsedCanvasCredentials.data.baseUrl);

    store.upsertUserConnection({
      userId: authReq.authUser.id,
      service: "canvas",
      credentials: JSON.stringify({
        token: parsedCanvasCredentials.data.token.trim(),
        ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {})
      }),
      displayLabel: "Canvas LMS"
    });

    // Fetch available courses so the user can choose which ones to sync.
    // Don't do a full sync yet — let the user pick courses first.
    let availableCourses: Array<{ id: number; name: string; course_code: string; term?: { id: number; name: string; start_at: string | null; end_at: string | null } }> = [];
    let fetchError: string | undefined;
    try {
      const syncOptions = resolveCanvasSyncOptions(authReq.authUser.id);
      const client = new CanvasClient(syncOptions.baseUrl, syncOptions.token);
      const courses = await client.getCourses();
      availableCourses = courses.map((c) => ({
        id: c.id,
        name: c.name,
        course_code: c.course_code,
        ...(c.term ? { term: { id: c.term.id, name: c.term.name, start_at: c.term.start_at, end_at: c.term.end_at } } : {})
      }));
      console.log(`[canvas] connect: userId=${authReq.authUser.id} availableCourses=${availableCourses.length}`);
    } catch (err) {
      console.error(`[canvas] course fetch on connect failed:`, err);
      fetchError = err instanceof Error ? err.message : "Failed to fetch courses";
    }

    return res.json({
      ok: true,
      service: "canvas",
      availableCourses,
      fetchError
    });
  }

  if (service === "mcp") {
    return res.status(403).json({
      error: "Manual MCP server connect is disabled. Use a verified template.",
      templateOnly: true
    });
  }

  if (service === "tp_schedule") {
    const { icalUrl } = req.body as { icalUrl?: string };
    if (!icalUrl || typeof icalUrl !== "string" || !icalUrl.trim().startsWith("http")) {
      return res.status(400).json({ error: "A valid iCal URL is required" });
    }
    store.upsertUserConnection({
      userId: authReq.authUser.id,
      service: "tp_schedule",
      credentials: JSON.stringify({ icalUrl: icalUrl.trim() }),
      displayLabel: "TP Schedule"
    });

    // Kick off an immediate schedule sync for TP iCal connection.
    const autoSync = await runTPSyncForUser(authReq.authUser.id, { icalUrl: icalUrl.trim() });
    return res.json({
      ok: true,
      service: "tp_schedule",
      autoSync
    });
  }

  if (service === "timeedit") {
    const { icalUrl } = req.body as { icalUrl?: string };
    if (!icalUrl || typeof icalUrl !== "string" || !icalUrl.trim().startsWith("http")) {
      return res.status(400).json({ error: "A valid TimeEdit iCal URL is required" });
    }
    store.upsertUserConnection({
      userId: authReq.authUser.id,
      service: "timeedit",
      credentials: JSON.stringify({ icalUrl: icalUrl.trim() }),
      displayLabel: "TimeEdit Schedule"
    });

    // Kick off an immediate schedule sync for TimeEdit iCal connection.
    const teService = timeEditSyncServicesByUser.get(authReq.authUser.id);
    let autoSync: { success: boolean; eventsProcessed: number; lecturesCreated: number; lecturesUpdated: number; lecturesDeleted: number; error?: string } | undefined;
    if (teService) {
      autoSync = await teService.sync();
    }
    return res.json({
      ok: true,
      service: "timeedit",
      autoSync
    });
  }

  // For OAuth connectors, redirect to their OAuth flow
  if (service === "withings") {
    const authUrl = getWithingsOAuthServiceForUser(authReq.authUser.id).getAuthUrl();
    const state = extractStateFromUrl(authUrl);
    if (!state) {
      return res.status(500).json({ error: "Failed to initialize Withings OAuth state" });
    }
    registerPendingOAuthState(withingsPendingOAuthStates, state, authReq.authUser.id);
    return res.json({ redirectUrl: authUrl });
  }

  // Blackboard Learn — token-based, same pattern as Canvas
  if (service === "blackboard") {
    const { token, baseUrl } = req.body as { token?: string; baseUrl?: string };
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ error: "Blackboard REST API token is required" });
    }
    store.upsertUserConnection({
      userId: authReq.authUser.id,
      service: "blackboard",
      credentials: JSON.stringify({
        token: token.trim(),
        ...(baseUrl && typeof baseUrl === "string" ? { baseUrl: baseUrl.trim() } : {})
      }),
      displayLabel: "Blackboard Learn"
    });

    // Kick off an immediate sync now that credentials are stored
    const bbService = getBlackboardSyncServiceForUser(authReq.authUser.id);
    if (!blackboardSyncServicesByUser.has(authReq.authUser.id)) {
      blackboardSyncServicesByUser.set(authReq.authUser.id, bbService);
      bbService.start();
    }
    const syncResult = await bbService.triggerSync().catch(() => ({ success: false }));

    return res.json({ ok: true, service: "blackboard", autoSync: syncResult });
  }

  // Microsoft Teams — OAuth flow (Graph API integration)
  if (service === "teams") {
    const msOAuth = getMicrosoftOAuthServiceForUser(authReq.authUser.id);
    try {
      const authUrl = msOAuth.getAuthUrl();
      const state = extractStateFromUrl(authUrl);
      if (!state) {
        return res.status(500).json({ error: "Failed to initialize Microsoft OAuth state" });
      }
      registerPendingOAuthState(microsoftPendingOAuthStates, state, authReq.authUser.id);
      return res.json({ redirectUrl: authUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microsoft OAuth error";
      return res.status(500).json({ error: message });
    }
  }

  return res.status(400).json({ error: "Unknown connector service" });
});

app.delete("/api/connectors/:service", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const parsed = connectorServiceSchema.safeParse(req.params.service);
  if (!parsed.success) return res.status(400).json({ error: "Unknown service" });

  if (parsed.data === "canvas") {
    store.clearCanvasData(authReq.authUser.id);
  }
  if (parsed.data === "blackboard") {
    store.clearBlackboardData(authReq.authUser.id);
    const bbService = blackboardSyncServicesByUser.get(authReq.authUser.id);
    if (bbService) {
      bbService.stop();
      blackboardSyncServicesByUser.delete(authReq.authUser.id);
    }
  }
  if (parsed.data === "teams") {
    store.clearTeamsData(authReq.authUser.id);
    const tmService = teamsSyncServicesByUser.get(authReq.authUser.id);
    if (tmService) {
      tmService.stop();
      teamsSyncServicesByUser.delete(authReq.authUser.id);
    }
    microsoftOAuthServicesByUser.delete(authReq.authUser.id);
    clearPendingOAuthStatesForUser(microsoftPendingOAuthStates, authReq.authUser.id);
  }
  if (parsed.data === "mcp") {
    clearMcpServers(store, authReq.authUser.id);
    clearPendingOAuthStatesForUser(mcpGitHubPendingOAuthStates, authReq.authUser.id);
  }
  if (parsed.data === "withings") {
    store.clearWithingsTokens(authReq.authUser.id);
  }
  store.deleteUserConnection(authReq.authUser.id, parsed.data);
  if (parsed.data === "withings") {
    stopWithingsServicesForUser(authReq.authUser.id);
  }
  return res.json({ ok: true });
});

// ── Plan / Tier Endpoints ──

/** Build the plan info object for a user */
function buildUserPlanInfo(user: AuthUser): UserPlanInfo {
  const effectivePlan = getEffectivePlan(user.plan, user.role, user.trialEndsAt);
  const tier = PLAN_TIERS[effectivePlan];
  const chatUsedToday = store.getDailyChatUsage(user.id);

  return {
    plan: effectivePlan,
    isTrial: user.plan === "free" && effectivePlan !== "free",
    trialEndsAt: user.trialEndsAt,
    chatUsedToday,
    chatLimitToday: tier.dailyChatLimit,
    features: [...tier.features] as FeatureId[],
    connectors: tier.connectors,
    planName: tier.name,
    badge: tier.badge
  };
}

/** Public: list available tiers (no auth needed) */
app.get("/api/plan/tiers", (_req, res) => {
  const tiers = Object.values(PLAN_TIERS).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    priceMonthlyNok: t.priceMonthlyNok,
    dailyChatLimit: t.dailyChatLimit,
    features: [...t.features],
    connectors: t.connectors,
    maxChatHistory: t.maxChatHistory,
    trialDays: t.trialDays,
    badge: t.badge
  }));
  return res.json({ tiers });
});

/** Authenticated: get current user's plan, usage, and features */
app.get("/api/plan", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  return res.json(buildUserPlanInfo(authReq.authUser));
});

/** Authenticated: start a free trial (requires card — stubbed for now) */
app.post("/api/plan/start-trial", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const user = authReq.authUser;
  if (user.plan !== "free") {
    return res.status(400).json({ error: "Already on a paid plan" });
  }
  if (user.trialEndsAt) {
    return res.status(400).json({ error: "Trial already used" });
  }

  // TODO: Verify payment card via Vipps/Stripe before starting trial
  // For now, start the 7-day trial immediately
  store.startTrial(user.id, PLAN_TIERS.plus.trialDays);

  // Re-fetch user to get updated plan info
  const updated = store.getUserById(user.id);
  if (!updated) return res.status(500).json({ error: "Failed to update" });
  return res.json(buildUserPlanInfo(updated));
});

/** Create a Stripe Checkout Session for plan upgrade */
app.post("/api/stripe/create-checkout", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Payment system not configured yet" });
  }

  const { planId } = req.body as { planId?: string };
  if (!planId || (planId !== "plus" && planId !== "pro")) {
    return res.status(400).json({ error: "Invalid plan. Choose 'plus' or 'pro'." });
  }

  if (!getPriceForPlan(planId as PlanId)) {
    return res.status(400).json({ error: `No price configured for plan "${planId}"` });
  }

  try {
    const result = await createCheckoutSession({
      userId: authReq.authUser.id,
      email: authReq.authUser.email,
      planId: planId as PlanId,
      stripeCustomerId: authReq.authUser.stripeCustomerId
    });
    return res.json(result);
  } catch (err) {
    console.error("[stripe] checkout error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/** Create a Stripe Customer Portal session for managing subscription */
app.post("/api/stripe/portal", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  if (!authReq.authUser.stripeCustomerId) {
    return res.status(400).json({ error: "No active subscription found" });
  }

  try {
    const url = await createPortalSession(authReq.authUser.stripeCustomerId);
    return res.json({ url });
  } catch (err) {
    console.error("[stripe] portal error:", err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
});

/** Get Stripe configuration status */
app.get("/api/stripe/status", (_req, res) => {
  return res.json(getStripeStatus());
});

// ── Vipps MobilePay Recurring ────────────────────────────────────────────

/** Create a Vipps agreement (redirect user to approve in Vipps app) */
app.post("/api/vipps/create-agreement", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  if (!isVippsConfigured()) {
    return res.status(503).json({ error: "Vipps is not configured yet" });
  }

  const { planId, phoneNumber } = req.body as { planId?: string; phoneNumber?: string };
  if (!planId || (planId !== "plus" && planId !== "pro")) {
    return res.status(400).json({ error: "Invalid plan. Choose 'plus' or 'pro'." });
  }

  try {
    const result = await createAgreement({
      userId: authReq.authUser.id,
      planId: planId as PlanId,
      phoneNumber
    });

    // Store the pending agreement ID on the user
    store.updateVippsAgreementId(authReq.authUser.id, result.agreementId);

    return res.json({
      agreementId: result.agreementId,
      redirectUrl: result.vippsConfirmationUrl
    });
  } catch (err) {
    console.error("[vipps] create agreement error:", err);
    return res.status(500).json({ error: "Failed to create Vipps agreement" });
  }
});

/** Check Vipps agreement status (poll after user returns from Vipps) */
app.get("/api/vipps/agreement-status", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const agreementId = authReq.authUser.vippsAgreementId;
  if (!agreementId) {
    return res.json({ status: "none", message: "No Vipps agreement found" });
  }

  try {
    const agreement = await getAgreement(agreementId);

    // If agreement became ACTIVE, update user plan
    if (agreement.status === "ACTIVE" && authReq.authUser.plan === "free") {
      const plan = planIdFromAmount(agreement.pricing.amount);
      if (plan) {
        store.updateUserPlan(authReq.authUser.id, plan);
      }
    }

    return res.json({
      status: agreement.status,
      agreementId: agreement.id,
      productName: agreement.productName,
      amount: agreement.pricing.amount,
      currency: agreement.pricing.currency
    });
  } catch (err) {
    console.error("[vipps] get agreement error:", err);
    return res.status(500).json({ error: "Failed to fetch agreement status" });
  }
});

/** Cancel Vipps agreement */
app.post("/api/vipps/cancel-agreement", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) return res.status(401).json({ error: "Unauthorized" });

  const agreementId = authReq.authUser.vippsAgreementId;
  if (!agreementId) {
    return res.status(400).json({ error: "No active Vipps agreement" });
  }

  try {
    await stopAgreement(agreementId);
    store.updateUserPlan(authReq.authUser.id, "free");
    return res.json({ success: true });
  } catch (err) {
    console.error("[vipps] cancel agreement error:", err);
    return res.status(500).json({ error: "Failed to cancel Vipps agreement" });
  }
});

/** Get Vipps configuration status */
app.get("/api/vipps/status", (_req, res) => {
  return res.json(getVippsStatus());
});

/** Vipps webhook for agreement and charge events */
app.post("/api/vipps/webhook", (req, res) => {
  try {
    const payload = req.body as VippsWebhookPayload;
    const event = processWebhookPayload(payload);
    console.log(`[vipps] webhook: ${event.eventType} agreementId=${event.agreementId} userId=${event.userId}`);

    switch (event.eventType) {
      case "recurring.agreement-activated.v1": {
        // Agreement was approved by user in Vipps
        if (event.agreementId) {
          const user = event.userId
            ? store.getUserById(event.userId)
            : store.getUserByVippsAgreementId(event.agreementId);
          if (user) {
            // Fetch agreement to get the plan amount
            void getAgreement(event.agreementId).then((agreement) => {
              const plan = planIdFromAmount(agreement.pricing.amount);
              if (plan) {
                store.updateUserPlan(user.id, plan);
              }
            }).catch((err) => {
              console.error("[vipps] webhook: failed to fetch agreement for plan update:", err);
            });
          }
        }
        break;
      }
      case "recurring.agreement-stopped.v1":
      case "recurring.agreement-expired.v1": {
        // Agreement stopped or expired — downgrade to free
        if (event.agreementId) {
          const user = event.userId
            ? store.getUserById(event.userId)
            : store.getUserByVippsAgreementId(event.agreementId);
          if (user) {
            store.updateUserPlan(user.id, "free");
          }
        }
        break;
      }
      case "recurring.charge-captured.v1": {
        console.log(`[vipps] charge captured: ${event.chargeId} amount=${event.amount}`);
        break;
      }
      case "recurring.charge-failed.v1": {
        console.warn(`[vipps] charge failed: ${event.chargeId} agreementId=${event.agreementId}`);
        break;
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("[vipps] webhook error:", err);
    return res.status(400).json({ error: "Webhook processing failed" });
  }
});


app.get("/api/dashboard", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  res.json(store.getSnapshot(userId));
});

app.get("/api/weekly-review", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const referenceDate = typeof req.query.referenceDate === "string" ? req.query.referenceDate : undefined;
  const summary = store.getWeeklySummary(userId, referenceDate);
  return res.json({ summary });
});

app.get("/api/weekly-growth-review", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const now = new Date();
  const review = await generateWeeklyGrowthReview(store, userId, { now });

  const notifySunday = parseBooleanQueryFlag(req.query.notifySunday);
  const forcePush = parseBooleanQueryFlag(req.query.forcePush);
  let sundayPushSent = false;

  if (notifySunday && (forcePush || isSundayInOslo(now))) {
    const message = buildWeeklyGrowthSundayPushSummary(review);
    store.pushNotification(userId, {
      source: "orchestrator",
      title: "Weekly growth review",
      message,
      priority: "medium",
      actions: ["view"],
      url: "/companion/?tab=habits",
      metadata: {
        triggerType: "weekly-growth-review",
        periodDays: review.periodDays,
        commitments: review.commitments
      }
    });
    sundayPushSent = true;
  }

  return res.json({
    review,
    sundayPushSent
  });
});

app.get("/api/trends", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const trends = store.getContextTrends(userId);
  return res.json({ trends });
});

app.get("/api/analytics/coach", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  // Flush any buffered journal entries before analytics generation
  await flushJournalSessionBuffer(store, userId);

  const parsed = analyticsCoachQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid analytics coach query", issues: parsed.error.issues });
  }

  const forceRefreshRaw = typeof req.query.force === "string" ? req.query.force.trim().toLowerCase() : "";
  const forceRefresh = forceRefreshRaw === "1" || forceRefreshRaw === "true" || forceRefreshRaw === "yes";
  const periodDays = toAnalyticsPeriodDays(parsed.data.periodDays);
  const now = new Date();
  const nowMs = now.getTime();
  const { cacheKey, signature } = buildAnalyticsCoachSignature(userId, periodDays, now);
  const cached = analyticsCoachCache.get(cacheKey);

  if (!forceRefresh && cached) {
    if (isCacheEntryFresh(cached.insight.generatedAt, ANALYTICS_COACH_MIN_REFRESH_MS, nowMs)) {
      return res.json({ insight: cached.insight });
    }
    if (cached.signature === signature) {
      return res.json({ insight: cached.insight });
    }
  }

  const insight = await generateAnalyticsCoachInsight(store, userId, {
    periodDays,
    now,
    userName: (req as AuthenticatedRequest).authUser?.name
  });
  setCachedAnalyticsCoachInsight(cacheKey, {
    signature,
    insight
  });

  return res.json({ insight });
});

app.get("/api/growth/daily-summary", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = growthDailySummaryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid daily summary query", issues: parsed.error.issues });
  }

  const forceRefresh = parseBooleanQueryFlag(req.query?.force);
  const referenceDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return res.status(400).json({ error: "Invalid date parameter" });
  }

  const dateKey = toDateKey(referenceDate);
  const nowMs = Date.now();

  // Check cache
  if (!forceRefresh) {
    const cached = dailySummaryCache.get(dateKey);
    if (cached && isCacheEntryFresh(cached.generatedAt, DAILY_SUMMARY_MIN_REFRESH_MS, nowMs)) {
      return res.json({ summary: cached });
    }
  }

  const dayStartIso = `${dateKey}T00:00:00.000Z`;
  const dayEndIso = `${dateKey}T23:59:59.999Z`;

  // Flush any buffered journal entries before reading reflections
  await flushJournalSessionBuffer(store, userId);

  const reflections = store.getReflectionEntriesInRange(userId, dayStartIso, dayEndIso, 280);
  const chats = store
    .getRecentChatMessages(userId, 280)
    .filter(
      (message) =>
        message.role === "user" &&
        message.content.trim().length > 0 &&
        startsWithDateKey(message.timestamp, dateKey)
    );

  const habits = store.getHabitsWithStatus(userId);
  const goals = store.getGoalsWithStatus(userId);
  const nutritionSummary = store.getNutritionDailySummary(userId, referenceDate);
  // For AI context, only count meals actually marked as eaten (not pre-planned templates)
  const eatenMeals = store.getNutritionMeals(userId, { date: dateKey, limit: 1000, skipBaselineHydration: true, eatenOnly: true });
  const eatenTotals = eatenMeals.reduce(
    (acc, meal) => {
      if (meal.items.length > 0) {
        for (const item of meal.items) {
          acc.calories += item.caloriesPerUnit * item.quantity;
          acc.proteinGrams += item.proteinGramsPerUnit * item.quantity;
        }
      } else {
        acc.calories += meal.calories;
        acc.proteinGrams += meal.proteinGrams;
      }
      return acc;
    },
    { calories: 0, proteinGrams: 0 }
  );
  const withingsData = store.getWithingsData(userId);
  const todayWeight = withingsData.weight.find((w) => w.measuredAt.startsWith(dateKey));
  const scheduleEvents = store.getScheduleEvents(userId).filter((e) => e.startTime.startsWith(dateKey));

  // Build Gemini prompt for cross-domain reasoning
  const habitLines = habits
    .map((h) => {
      const daysHit = Math.round((h.completionRate7d / 100) * 7);
      return `- ${h.name}: ${h.todayCompleted ? "done" : "not done"}, ${daysHit}/7 days this week, streak=${h.streak}${h.streakGraceUsed ? " (grace)" : ""}`;
    })
    .join("\n");

  const goalLines = goals
    .map((g) => `- ${g.title}: ${g.todayCompleted ? "done" : "not done"}, ${g.progressCount}/${g.targetCount}, streak=${g.streak}`)
    .join("\n");

  const calActual = Math.round(eatenTotals.calories);
  const calTarget = nutritionSummary.targetProfile?.targetCalories ? Math.round(nutritionSummary.targetProfile.targetCalories) : null;
  const proteinActual = Math.round(eatenTotals.proteinGrams);
  const proteinTarget = nutritionSummary.targetProfile?.targetProteinGrams ? Math.round(nutritionSummary.targetProfile.targetProteinGrams) : null;
  const nutritionLine = calTarget
    ? `Calories eaten: ${calActual}/${calTarget} kcal, Protein eaten: ${proteinActual}/${proteinTarget ?? "?"}g, ${eatenMeals.length} meals eaten of ${nutritionSummary.mealsLogged} planned`
    : `Calories eaten: ${calActual} kcal, Protein eaten: ${proteinActual}g, ${eatenMeals.length} meals eaten`;

  const bodyCompLine = todayWeight
    ? `Weight: ${todayWeight.weightKg.toFixed(1)} kg${todayWeight.fatRatioPercent ? `, BF: ${todayWeight.fatRatioPercent.toFixed(1)}%` : ""}${todayWeight.muscleMassKg ? `, MM: ${todayWeight.muscleMassKg.toFixed(1)} kg` : ""}`
    : "No weigh-in today";

  const scheduleLines = scheduleEvents
    .slice(0, 6)
    .map((e) => {
      const startHHMM = e.startTime.slice(11, 16);
      const endDate = new Date(new Date(e.startTime).getTime() + e.durationMinutes * 60_000);
      const endHHMM = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
      return `- ${startHHMM}-${endHHMM} ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
    })
    .join("\n");

  const reflectionLines = reflections
    .slice(0, 10)
    .map((r) => `- [${r.event}] feeling=${r.feelingStress || "?"}, intent=${r.intent || "?"}, outcome=${r.outcome || "?"}`)
    .join("\n");

  const dataAvailable = reflections.length > 0 || calActual > 0 || habits.length > 0 || todayWeight;

  let summary: string;
  let highlights: string[];
  let challenges: import("./types.js").ChallengePrompt[] | undefined;

  if (!dataAvailable) {
    summary = "No data yet today. Share an update, log a meal, or check in on a habit so I can start connecting the dots.";
    highlights = [];
  } else {
    const gemini = getGeminiClient();
    if (gemini.isConfigured()) {
      try {
        const prompt = `Write a daily coaching reflection for ${dateKey}.
Address the user directly (you/your). Be warm, concise, and honest.

STYLE RULES (critical):
- Be CONCISE. The summary should be 2-3 sentences. Each highlight should be 1 sentence.
- NEVER parrot raw numbers from the data. The user can see the data themselves. Interpret what the data MEANS.
- BAD: "You logged 45 chat messages and 43 journal entries" — they know that.
- GOOD: "Your planning energy today was intense — now channel it into execution." — this interprets.
- Use natural counts: "4/6 days" not "67%".
- Write like a trusted coach, not a dashboard.

Return strict JSON only:
{
  "summary": "2-3 sentence coaching take on the day. Connect domains naturally. Interpret, don't describe.",
  "highlights": ["2-3 short coaching insights — one sentence each, actionable."],
  "challenges": [
    {"type": "connect", "question": "...", "hint": "Optional"},
    {"type": "predict", "question": "...", "hint": "Optional"},
    {"type": "reflect", "question": "...", "hint": "Optional"},
    {"type": "commit", "question": "...", "hint": "Optional"}
  ]
}

Challenge types:
- "connect": Draw a connection ("What happened differently on days you hit the gym vs days you didn't?")
- "predict": Predict an outcome ("If you eat all 5 meals tomorrow, how do you think your energy will be at the gym?")
- "reflect": Reflection prompt ("What's the one thing that would make tomorrow easier?")
- "commit": Micro-commitment ("Name one meal you'll prep tonight.")

Generate EXACTLY 2 challenges for EACH of the 4 types (8 total). Each type must have exactly 2 prompts. They should feel like a coach prompting active thinking.

CONTEXT:
- "weightKg" in nutrition targets is the user's BASELINE weight for macros, NOT a goal weight.
- Nutrition reflects ONLY eaten meals, not pre-planned templates.

Today's data:

Nutrition: ${nutritionLine}
Body: ${bodyCompLine}
Habits: ${habitLines || "none"}
Goals: ${goalLines || "none"}
Schedule: ${scheduleLines || "no events"}
Journal (${reflections.length}): ${reflectionLines || "none"}`;

        const response = await gemini.generateChatResponse({
          systemInstruction: "You are a personal performance coach — warm, direct, concise. Interpret data into coaching. NEVER parrot raw statistics. Return strict JSON only. Never truncate.",
          messages: [{ role: "user", parts: [{ text: prompt }] }]
        });

        const raw = response.text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed2 = JSON.parse(jsonMatch[0]) as { summary?: string; highlights?: string[]; challenges?: unknown[] };
          summary = typeof parsed2.summary === "string" ? parsed2.summary : "";
          highlights = Array.isArray(parsed2.highlights)
            ? parsed2.highlights.filter((h): h is string => typeof h === "string").slice(0, 3)
            : [];
          const VALID_TYPES = new Set(["connect", "predict", "reflect", "commit"]);
          challenges = Array.isArray(parsed2.challenges)
            ? (parsed2.challenges as Array<Record<string, unknown>>)
                .filter((c) => typeof c === "object" && c !== null && typeof c.type === "string" && VALID_TYPES.has(c.type as string) && typeof c.question === "string")
                .map((c) => ({
                  type: c.type as import("./types.js").ChallengePrompt["type"],
                  question: String(c.question),
                  ...(typeof c.hint === "string" ? { hint: c.hint } : {})
                }))
                .slice(0, 12)
            : undefined;
          if (challenges && challenges.length === 0) challenges = undefined;
        } else {
          summary = buildFallbackSummary(reflections.length, habits, goals);
          highlights = buildFallbackHighlights(reflections);
        }
      } catch {
        summary = buildFallbackSummary(reflections.length, habits, goals);
        highlights = buildFallbackHighlights(reflections);
      }
    } else {
      summary = buildFallbackSummary(reflections.length, habits, goals);
      highlights = buildFallbackHighlights(reflections);
    }
  }

  const result: DailyGrowthSummary = {
    date: dateKey,
    generatedAt: nowIso(),
    summary,
    highlights,
    ...(challenges ? { challenges } : {}),
    journalEntryCount: reflections.length,
    reflectionEntryCount: reflections.length,
    chatMessageCount: chats.length
  };

  // Generate visual
  try {
    const gemini = getGeminiClient();
    if (gemini.isConfigured()) {
      const visual = await maybeGenerateDailySummaryVisual(gemini, result);
      if (visual) {
        result.visual = visual;
      }
    }
  } catch {
    // visual generation failed — continue without it
  }

  // Cache result
  dailySummaryCache.set(dateKey, result);
  // Evict old entries
  if (dailySummaryCache.size > 10) {
    const oldestKey = dailySummaryCache.keys().next().value;
    if (oldestKey) dailySummaryCache.delete(oldestKey);
  }

  return res.json({ summary: result });
});

function buildFallbackSummary(
  reflectionCount: number,
  habits: Array<{ todayCompleted: boolean }>,
  goals: Array<{ todayCompleted: boolean }>
): string {
  const habitsDone = habits.filter((h) => h.todayCompleted).length;
  const goalsDone = goals.filter((g) => g.todayCompleted).length;
  if (reflectionCount === 0) {
    return "No structured journal entries yet today. Share one quick update so I can tune your plan.";
  }
  return `You logged ${reflectionCount} structured journal entr${reflectionCount === 1 ? "y" : "ies"} today, with ${habitsDone} habit and ${goalsDone} goal check-ins completed.`;
}

function buildFallbackHighlights(reflections: Array<{ event: string; evidenceSnippet: string }>): string[] {
  return reflections
    .slice(0, 5)
    .map((entry) => `${entry.event}: ${entry.evidenceSnippet}`)
    .filter((item) => item.length > 0)
    .map((item) => (item.length > 120 ? `${item.slice(0, 120)}...` : item));
}

app.post("/api/chat", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat payload", issues: parsed.error.issues });
  }

  // Rate limit based on user plan
  const authReq = req as AuthenticatedRequest;
  if (authReq.authUser) {
    const planInfo = buildUserPlanInfo(authReq.authUser);
    if (planInfo.chatLimitToday > 0 && planInfo.chatUsedToday >= planInfo.chatLimitToday) {
      return res.status(429).json({
        error: "Daily chat limit reached",
        limit: planInfo.chatLimitToday,
        used: planInfo.chatUsedToday,
        plan: planInfo.plan,
        upgradeRequired: true
      });
    }
    store.incrementDailyChatUsage(authReq.authUser.id);
  }

  try {
    const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
    const effectivePlan = authReq.authUser
      ? getEffectivePlan(authReq.authUser.plan, authReq.authUser.role, authReq.authUser.trialEndsAt)
      : undefined;
    const userName = (req as AuthenticatedRequest).authUser?.name;
    await Promise.all([maybeAutoSyncCanvasData(userId)]);
    const result = await sendChatMessage(store, userId, parsed.data.message.trim(), {
      attachments: parsed.data.attachments,
      planId: effectivePlan,
      userName
    });
    return res.json({
      reply: result.reply,
      message: result.assistantMessage,
      userMessage: result.userMessage,
      finishReason: result.finishReason,
      usage: result.usage,
      citations: result.citations,
      history: result.history
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(429).json({ error: error.message });
    }
    if (error instanceof GeminiError) {
      return res.status(error.statusCode ?? 500).json({ error: error.message });
    }

    return res.status(500).json({ error: "Chat request failed" });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat payload", issues: parsed.error.issues });
  }

  // Rate limit based on user plan
  const authReq = req as AuthenticatedRequest;
  if (authReq.authUser) {
    const planInfo = buildUserPlanInfo(authReq.authUser);
    if (planInfo.chatLimitToday > 0 && planInfo.chatUsedToday >= planInfo.chatLimitToday) {
      return res.status(429).json({
        error: "Daily chat limit reached",
        limit: planInfo.chatLimitToday,
        used: planInfo.chatUsedToday,
        plan: planInfo.plan,
        upgradeRequired: true
      });
    }
    store.incrementDailyChatUsage(authReq.authUser.id);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
  });

  const sendSse = (event: string, payload: Record<string, unknown>): void => {
    if (clientDisconnected || res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
    const effectivePlan = authReq.authUser
      ? getEffectivePlan(authReq.authUser.plan, authReq.authUser.role, authReq.authUser.trialEndsAt)
      : undefined;
    const userName = (req as AuthenticatedRequest).authUser?.name;
    await Promise.all([maybeAutoSyncCanvasData(userId)]);
    const result = await sendChatMessage(store, userId, parsed.data.message.trim(), {
      attachments: parsed.data.attachments,
      planId: effectivePlan,
      userName,
      onTextChunk: (chunk: string) => sendSse("token", { delta: chunk })
    });

    sendSse("done", {
      reply: result.reply,
      message: result.assistantMessage,
      userMessage: result.userMessage,
      finishReason: result.finishReason,
      usage: result.usage,
      citations: result.citations,
      mood: result.mood,
      history: result.history,
      executedTools: result.executedTools
    });
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      sendSse("error", { error: error.message, status: 429 });
    } else if (error instanceof GeminiError) {
      sendSse("error", { error: error.message, status: error.statusCode ?? 500 });
    } else {
      sendSse("error", { error: "Chat request failed", status: 500 });
    }
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
});

app.post("/api/chat/context/compress", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = chatContextCompressionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat context compression payload", issues: parsed.error.issues });
  }

  try {
    const result = await compressChatContext(store, userId, {
      maxMessages: parsed.data.maxMessages,
      preserveRecentMessages: parsed.data.preserveRecentMessages,
      targetSummaryChars: parsed.data.targetSummaryChars
    });

    store.upsertChatLongTermMemory(userId, {
      summary: result.summary,
      sourceMessageCount: result.sourceMessageCount,
      totalMessagesAtCompression: result.totalMessagesAtCompression,
      compressedMessageCount: result.compressedMessageCount,
      preservedMessageCount: result.preservedMessageCount,
      fromTimestamp: result.fromTimestamp,
      toTimestamp: result.toTimestamp,
      usedModelMode: result.usedModelMode
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(429).json({ error: error.message });
    }

    if (error instanceof GeminiError) {
      return res.status(error.statusCode ?? 500).json({ error: error.message });
    }

    return res.status(500).json({ error: "Chat context compression failed" });
  }
});

app.get("/api/chat/history", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = chatHistoryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid history query", issues: parsed.error.issues });
  }

  const history = store.getChatHistory(userId, {
    page: parsed.data.page ?? 1,
    pageSize: parsed.data.pageSize ?? 20
  });

  return res.json({ history });
});

app.get("/api/chat/actions/pending", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({ actions: store.getPendingChatActions(userId) });
});

app.post("/api/chat/actions/:id/confirm", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.authUser?.id ?? "default";
  const pendingAction = store.getPendingChatActionById(userId, req.params.id);

  if (!pendingAction) {
    return res.status(404).json({ error: "Pending chat action not found" });
  }

  const result = executePendingChatAction(pendingAction, store, userId);
  store.deletePendingChatAction(userId, pendingAction.id);

  return res.json({
    result,
    pendingActions: store.getPendingChatActions(userId)
  });
});

app.post("/api/chat/actions/:id/cancel", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const pendingAction = store.getPendingChatActionById(userId, req.params.id);

  if (!pendingAction) {
    return res.status(404).json({ error: "Pending chat action not found" });
  }

  store.deletePendingChatAction(userId, pendingAction.id);

  return res.json({
    actionId: pendingAction.id,
    cancelled: true,
    pendingActions: store.getPendingChatActions(userId)
  });
});

app.get("/api/export", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const exportData = store.getExportData(userId);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="companion-export.json"');
  return res.json(exportData);
});

// Import validation schemas
const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().positive().max(365).optional(),
  count: z.number().int().positive().max(365).optional(),
  until: z.string().datetime().optional(),
  byWeekDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional()
}).refine(
  (data) => {
    if (data.count !== undefined && data.until !== undefined) {
      return false;
    }
    return true;
  },
  { message: "Cannot specify both count and until" }
);

const lectureImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(120).optional(),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"]),
  recurrence: recurrenceRuleSchema.optional(),
  recurrenceParentId: z.string().min(1).optional()
});

const deadlineImportSchema = z.object({
  id: z.string().min(1),
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean(),
  effortHoursRemaining: z.number().min(0).max(200).optional(),
  effortConfidence: z.enum(["low", "medium", "high"]).optional()
});

const UNBOUNDED_HABIT_TARGET = -1;
const MAX_HABIT_TARGET = 10000;
const HABIT_INFINITY_TOKENS = new Set([
  "∞",
  "inf",
  "infinite",
  "infinity",
  "unlimited",
  "unbounded",
  "nolimit",
  "no-limit",
  "no_limit",
  "no limit"
]);

function normalizeHabitTarget(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.toLowerCase().replace(/\s+/g, "");
    if (HABIT_INFINITY_TOKENS.has(normalized)) {
      return UNBOUNDED_HABIT_TARGET;
    }
    if (/^-?\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }

  return null;
}

const habitTargetSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const target = normalizeHabitTarget(value);
  if (target === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "targetPerWeek must be an integer or '∞'/'infinity'."
    });
    return z.NEVER;
  }
  if (target === UNBOUNDED_HABIT_TARGET) {
    return target;
  }
  if (target < 1 || target > MAX_HABIT_TARGET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `targetPerWeek must be ${UNBOUNDED_HABIT_TARGET} (infinite) or between 1 and ${MAX_HABIT_TARGET}.`
    });
    return z.NEVER;
  }
  return target;
});

const habitImportSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  cadence: z.string().trim().min(1).max(60),
  targetPerWeek: habitTargetSchema,
  motivation: z.string().trim().max(300).optional(),
  createdAt: z.string().datetime()
});

const goalImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  cadence: z.enum(["daily", "weekly"]),
  targetCount: z.number().int().positive(),
  dueDate: z.string().datetime().nullable(),
  motivation: z.string().trim().max(300).optional(),
  createdAt: z.string().datetime()
});

const userContextImportSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const notificationPreferencesImportSchema = z.object({
  quietHours: z.object({
    enabled: z.boolean().optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional()
  }).optional(),
  minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  allowCriticalInQuietHours: z.boolean().optional(),
  categoryToggles: z.record(z.string(), z.boolean()).optional()
});

const importDataSchema = z.object({
  version: z.string().optional(),
  schedule: z.array(lectureImportSchema).optional(),
  deadlines: z.array(deadlineImportSchema).optional(),
  habits: z.array(habitImportSchema).optional(),
  goals: z.array(goalImportSchema).optional(),
  userContext: userContextImportSchema.optional(),
  notificationPreferences: notificationPreferencesImportSchema.optional()
});

app.post("/api/import", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = importDataSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid import data", issues: parsed.error.issues });
  }

  const result = store.importData(userId, parsed.data);
  return res.json(result);
});

const contextSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 1_500_000;
const chatImageAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  dataUrl: z.string().trim().startsWith("data:image/").max(MAX_CHAT_IMAGE_DATA_URL_LENGTH),
  mimeType: z.string().trim().min(1).max(120).optional(),
  fileName: z.string().trim().min(1).max(240).optional()
});

const chatRequestSchema = z.object({
  message: z.string().max(10000).default(""),
  attachments: z.array(chatImageAttachmentSchema).max(3).optional()
}).refine(
  (payload) => payload.message.trim().length > 0 || (payload.attachments?.length ?? 0) > 0,
  {
    message: "Either message text or at least one image attachment is required.",
    path: ["message"]
  }
);

const chatContextCompressionSchema = z.object({
  maxMessages: z.coerce.number().int().min(10).max(500).optional(),
  preserveRecentMessages: z.coerce.number().int().min(0).max(100).optional(),
  targetSummaryChars: z.coerce.number().int().min(300).max(12000).optional()
});

const chatHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
});

const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const analyticsCoachQuerySchema = z
  .object({
    periodDays: z.coerce.number().int().optional()
  })
  .refine(
    (payload) => payload.periodDays === undefined || payload.periodDays === 7 || payload.periodDays === 14 || payload.periodDays === 30,
    {
      message: "periodDays must be one of 7, 14, or 30",
      path: ["periodDays"]
    }
  );

const growthDailySummaryQuerySchema = z.object({
  date: z.string().trim().optional()
});

const tagIdSchema = z.string().trim().min(1);
const tagIdsSchema = z.array(tagIdSchema).max(20);

const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(60)
});

const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60)
});

const calendarImportSchema = z
  .object({
    ics: z.string().min(1).optional(),
    url: z.string().url().optional()
  })
  .refine((value) => Boolean(value.ics || value.url), "Either ics or url is required");

const scheduleCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(120).optional(),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"]),
  recurrence: recurrenceRuleSchema.optional(),
  recurrenceParentId: z.string().min(1).optional()
});

const scheduleUpdateSchema = scheduleCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineBaseSchema = z.object({
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean().optional().default(false),
  effortHoursRemaining: z.number().min(0).max(200).optional(),
  effortConfidence: z.enum(["low", "medium", "high"]).optional()
});

const deadlineCreateSchema = deadlineBaseSchema;

const deadlineUpdateSchema = deadlineBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineStatusConfirmSchema = z.object({
  completed: z.boolean()
});

const habitCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cadence: z.string().trim().min(1).max(60).default("daily"),
  targetPerWeek: habitTargetSchema.default(5),
  motivation: z.string().trim().max(240).optional()
});

const habitUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    cadence: z.string().trim().min(1).max(60).optional(),
    targetPerWeek: habitTargetSchema.optional(),
    motivation: z.string().trim().max(240).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const habitCheckInSchema = z.object({
  completed: z.boolean().optional(),
  date: z.string().datetime().optional(),
  note: z.string().trim().max(240).optional()
});

const goalCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  cadence: z.enum(["daily", "weekly"]).default("daily"),
  targetCount: z.number().int().min(1).max(365),
  dueDate: z.string().datetime().optional().nullable(),
  motivation: z.string().trim().max(240).optional()
});

const goalUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    cadence: z.enum(["daily", "weekly"]).optional(),
    targetCount: z.number().int().min(1).max(365).optional(),
    dueDate: z.string().datetime().nullable().optional(),
    motivation: z.string().trim().max(240).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const goalCheckInSchema = z.object({
  completed: z.boolean().optional(),
  date: z.string().datetime().optional()
});

const nutritionDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const nutritionMealItemSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(160),
  quantity: z.number().min(0.1).max(1000).default(1),
  unitLabel: z.string().trim().min(1).max(40).default("serving"),
  caloriesPerUnit: z.number().min(0).max(10000),
  proteinGramsPerUnit: z.number().min(0).max(1000).default(0),
  carbsGramsPerUnit: z.number().min(0).max(1500).default(0),
  fatGramsPerUnit: z.number().min(0).max(600).default(0),
  customFoodId: z.string().trim().min(1).max(120).optional()
});

const nutritionMealCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]).default("other"),
  consumedAt: z.string().datetime().optional(),
  items: z.array(nutritionMealItemSchema).max(200).default([]),
  calories: z.number().min(0).max(10000).optional(),
  proteinGrams: z.number().min(0).max(1000).default(0),
  carbsGrams: z.number().min(0).max(1500).default(0),
  fatGrams: z.number().min(0).max(600).default(0),
  notes: z.string().trim().max(300).optional()
}).refine(
  (value) => value.items.length > 0 || typeof value.calories === "number",
  "Provide at least one meal item or explicit macro totals."
);

const nutritionMealUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]).optional(),
    consumedAt: z.string().datetime().optional(),
    items: z.array(nutritionMealItemSchema).max(200).optional(),
    calories: z.number().min(0).max(10000).optional(),
    proteinGrams: z.number().min(0).max(1000).optional(),
    carbsGrams: z.number().min(0).max(1500).optional(),
    fatGrams: z.number().min(0).max(600).optional(),
    notes: z.string().trim().max(300).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const nutritionMealsQuerySchema = z.object({
  date: nutritionDateSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const nutritionSummaryQuerySchema = z.object({
  date: nutritionDateSchema.optional()
});

const nutritionCustomFoodCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  unitLabel: z.string().trim().min(1).max(40).default("serving"),
  caloriesPerUnit: z.number().min(0).max(10000),
  proteinGramsPerUnit: z.number().min(0).max(1000).default(0),
  carbsGramsPerUnit: z.number().min(0).max(1500).default(0),
  fatGramsPerUnit: z.number().min(0).max(600).default(0)
});

const nutritionCustomFoodUpdateSchema = nutritionCustomFoodCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const nutritionCustomFoodsQuerySchema = z.object({
  query: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional()
});

const nutritionTargetProfileUpsertSchema = z
  .object({
    date: nutritionDateSchema.optional(),
    weightKg: z.number().min(0).max(500).nullable().optional(),
    maintenanceCalories: z.number().min(0).max(10000).nullable().optional(),
    surplusCalories: z.number().min(-5000).max(5000).nullable().optional(),
    targetCalories: z.number().min(0).max(15000).nullable().optional(),
    targetProteinGrams: z.number().min(0).max(1000).nullable().optional(),
    targetCarbsGrams: z.number().min(0).max(1500).nullable().optional(),
    targetFatGrams: z.number().min(0).max(600).nullable().optional(),
    proteinGramsPerLb: z.number().min(0).max(2).nullable().optional(),
    fatGramsPerLb: z.number().min(0).max(2).nullable().optional()
  })
  .refine(
    (value) =>
      [
        "weightKg",
        "maintenanceCalories",
        "surplusCalories",
        "targetCalories",
        "targetProteinGrams",
        "targetCarbsGrams",
        "targetFatGrams",
        "proteinGramsPerLb",
        "fatGramsPerLb"
      ].some((field) => Object.prototype.hasOwnProperty.call(value, field)),
    "At least one target profile field is required"
  );

const nutritionPlanSnapshotsQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const nutritionPlanSnapshotCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: nutritionDateSchema.optional(),
  replaceId: z.string().trim().min(1).max(160).optional()
});

const nutritionPlanSnapshotApplySchema = z.object({
  date: nutritionDateSchema.optional(),
  replaceMeals: z.boolean().default(true),
  setAsDefault: z.boolean().default(true)
});

const nutritionPlanSettingsUpdateSchema = z
  .object({
    defaultSnapshotId: z.string().trim().min(1).max(160).nullable().optional()
  })
  .refine((value) => Object.prototype.hasOwnProperty.call(value, "defaultSnapshotId"), {
    message: "defaultSnapshotId is required"
  });

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional().default(null),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url()
});

const pushTestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(500).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional()
});

const canvasSyncSchema = z.object({
  token: z.string().trim().min(1).optional(),
  baseUrl: z.string().url().optional(),
  courseIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const tpSyncSchema = z.object({
  icalUrl: z.string().url().optional(),
  semester: z.string().trim().min(1).max(16).optional(),
  courseIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const withingsSyncSchema = z.object({
  daysBack: z.coerce.number().int().min(1).max(90).optional()
});

const integrationScopePreviewSchema = z.object({
  semester: z.string().trim().min(1).max(16).optional(),
  tpCourseIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
  canvasCourseIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const integrationHealthLogQuerySchema = z.object({
  integration: z.enum(["tp", "canvas", "withings"]).optional(),
  status: z.enum(["success", "failure"]).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(200),
  hours: z.coerce.number().int().min(1).max(24 * 365).optional()
});

const integrationHealthSummaryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 365).optional().default(24 * 7)
});

const notificationPreferencesSchema = z.object({
  quietHours: z
    .object({
      enabled: z.boolean().optional(),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional()
    })
    .optional(),
  minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  allowCriticalInQuietHours: z.boolean().optional(),
  categoryToggles: z
    .object({
      notes: z.boolean().optional(),
      "lecture-plan": z.boolean().optional(),
      "assignment-tracker": z.boolean().optional(),
      orchestrator: z.boolean().optional()
    })
    .optional()
});

const studyPlanGenerateSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(14).optional().default(7),
    minSessionMinutes: z.number().int().min(30).max(180).optional().default(45),
    maxSessionMinutes: z.number().int().min(45).max(240).optional().default(120)
  })
  .refine((value) => value.maxSessionMinutes >= value.minSessionMinutes, {
    message: "maxSessionMinutes must be greater than or equal to minSessionMinutes"
  });

const studyPlanExportQuerySchema = z
  .object({
    horizonDays: z.coerce.number().int().min(1).max(14).optional().default(7),
    minSessionMinutes: z.coerce.number().int().min(30).max(180).optional().default(45),
    maxSessionMinutes: z.coerce.number().int().min(45).max(240).optional().default(120)
  })
  .refine((value) => value.maxSessionMinutes >= value.minSessionMinutes, {
    message: "maxSessionMinutes must be greater than or equal to minSessionMinutes"
  });

const studyPlanSessionCheckInSchema = z.object({
  status: z.enum(["done", "skipped"]),
  checkedAt: z.string().datetime().optional(),
  energyLevel: z.number().int().min(1).max(5).optional(),
  focusLevel: z.number().int().min(1).max(5).optional(),
  checkInNote: z.string().trim().min(1).max(500).optional()
});

const studyPlanSessionsQuerySchema = z.object({
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  status: z.enum(["pending", "done", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const studyPlanAdherenceQuerySchema = z.object({
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional()
});

const locationCreateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  label: z.string().trim().min(1).max(100).optional()
});

const locationUpdateSchema = locationCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const locationHistorySchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  context: z.string().trim().max(500).optional()
});

store.onNotification((notification: Notification) => {
  void broadcastNotification(notification);
});

async function broadcastNotification(notification: Notification): Promise<void> {
  const targetUserId = notification.userId ?? "";
  if (!targetUserId) {
    // No userId on the notification — can't route it. Skip push delivery.
    return;
  }

  if (!store.shouldDispatchNotification(targetUserId, notification)) {
    return;
  }

  const subscriptions = store.getPushSubscriptions(targetUserId);

  if (subscriptions.length === 0) {
    console.log(`[push] no subscriptions — notification "${notification.title}" not delivered`);
    return;
  }

  console.log(`[push] delivering "${notification.title}" to ${subscriptions.length} subscription(s)`);
  const deliveryResults = await Promise.all(
    subscriptions.map((subscription) => sendPushNotification(subscription, notification))
  );

  for (let i = 0; i < subscriptions.length; i += 1) {
    const endpoint = subscriptions[i].endpoint;
    const result = deliveryResults[i];

    console.log(`[push] result: delivered=${result.delivered} status=${result.statusCode ?? "n/a"} attempts=${result.attempts}${result.error ? ` error="${result.error}"` : ""}${result.shouldDropSubscription ? " (dropping subscription)" : ""}`);
    store.recordPushDeliveryResult(endpoint, notification, result);

    if (result.shouldDropSubscription) {
      store.removePushSubscription(targetUserId, endpoint);
    }
  }
}

app.post("/api/context", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = contextSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid context payload", issues: parsed.error.issues });
  }

  const updated = store.setUserContext(userId, parsed.data);
  return res.json({ context: updated });
});

app.post("/api/locations", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = locationCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location payload", issues: parsed.error.issues });
  }

  const location = store.recordLocation(
    userId,
    parsed.data.latitude,
    parsed.data.longitude,
    parsed.data.accuracy,
    parsed.data.label
  );

  return res.status(201).json({ location });
});

app.get("/api/locations", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const locations = store.getLocations(userId, limit);
  return res.json({ locations });
});

app.get("/api/locations/current", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const location = store.getCurrentLocation(userId);

  if (!location) {
    return res.status(404).json({ error: "No location recorded" });
  }

  return res.json({ location });
});

app.get("/api/locations/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const location = store.getLocationById(userId, req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
});

app.patch("/api/locations/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = locationUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location payload", issues: parsed.error.issues });
  }

  const location = store.updateLocation(userId, req.params.id, parsed.data);

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
});

app.delete("/api/locations/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteLocation(userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.status(204).send();
});

app.post("/api/locations/:id/history", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = locationHistorySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location history payload", issues: parsed.error.issues });
  }

  const history = store.recordLocationHistory(
    userId,
    req.params.id,
    parsed.data.stressLevel,
    parsed.data.energyLevel,
    parsed.data.context
  );

  if (!history) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.status(201).json({ history });
});

app.get("/api/locations/:id/history", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const history = store.getLocationHistory(userId, req.params.id, limit);
  return res.json({ history });
});

app.get("/api/location-history", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const history = store.getLocationHistory(userId, undefined, limit);
  return res.json({ history });
});

app.get("/api/tags", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const tags = store.getTags(userId);
  return res.json({ tags });
});

app.post("/api/tags", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = tagCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tag payload", issues: parsed.error.issues });
  }

  try {
    const tag = store.createTag(userId, parsed.data.name);
    return res.status(201).json({ tag });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return res.status(409).json({ error: "Tag name already exists" });
    }

    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create tag" });
  }
});

app.patch("/api/tags/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = tagUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tag payload", issues: parsed.error.issues });
  }

  try {
    const tag = store.updateTag(userId, req.params.id, parsed.data.name);

    if (!tag) {
      return res.status(404).json({ error: "Tag not found" });
    }

    return res.json({ tag });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return res.status(409).json({ error: "Tag name already exists" });
    }

    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update tag" });
  }
});

app.delete("/api/tags/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteTag(userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Tag not found" });
  }

  return res.status(204).send();
});

app.post("/api/calendar/import", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = calendarImportSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid calendar import payload", issues: parsed.error.issues });
  }

  const icsContent = parsed.data.ics ?? (await fetchCalendarIcs(parsed.data.url!));

  if (!icsContent) {
    return res.status(400).json({ error: "Unable to load ICS content" });
  }

  const preview = buildCalendarImportPreview(filterTPEventsByDateWindow(parseICS(icsContent)));
  const lectures = preview.lectures.map((lecture) => store.createLectureEvent(userId, lecture));
  const deadlines = preview.deadlines.map((deadline) => store.createDeadline(userId, deadline));

  return res.status(201).json({
    importedEvents: preview.importedEvents,
    lecturesCreated: preview.lecturesPlanned,
    deadlinesCreated: preview.deadlinesPlanned,
    lectures,
    deadlines
  });
});

app.post("/api/calendar/import/preview", async (req, res) => {
  const parsed = calendarImportSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid calendar import payload", issues: parsed.error.issues });
  }

  const icsContent = parsed.data.ics ?? (await fetchCalendarIcs(parsed.data.url!));

  if (!icsContent) {
    return res.status(400).json({ error: "Unable to load ICS content" });
  }

  const preview = buildCalendarImportPreview(filterTPEventsByDateWindow(parseICS(icsContent)));

  return res.status(200).json(preview);
});

app.post("/api/schedule", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = scheduleCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.createLectureEvent(userId, parsed.data);
  return res.status(201).json({ lecture });
});

app.get("/api/schedule", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  await maybeAutoSyncCanvasData(userId);
  return res.json({ schedule: store.getScheduleEvents(userId) });
});

app.get("/api/schedule/suggestion-mutes", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const dayParam = typeof req.query.day === "string" ? req.query.day.trim() : "";
  let day: Date | undefined;
  if (dayParam.length > 0) {
    const parsedDay = new Date(`${dayParam}T00:00:00`);
    if (Number.isNaN(parsedDay.getTime())) {
      return res.status(400).json({ error: "Invalid day query parameter. Use YYYY-MM-DD." });
    }
    day = parsedDay;
  }

  const mutes = store.getScheduleSuggestionMutes(userId, { day });
  return res.json({ mutes });
});

app.get("/api/schedule/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const lecture = store.getScheduleEventById(userId, req.params.id);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.patch("/api/schedule/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = scheduleUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.updateScheduleEvent(userId, req.params.id, parsed.data);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.delete("/api/schedule/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteScheduleEvent(userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.status(204).send();
});

app.post("/api/deadlines", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = deadlineCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.createDeadline(userId, parsed.data);
  return res.status(201).json({ deadline });
});

app.get("/api/deadlines", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  await maybeAutoSyncCanvasData(userId);
  return res.json({ deadlines: store.getDeadlines(userId) });
});

app.get("/api/deadlines/duplicates", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json(buildDeadlineDedupResult(store.getDeadlines(userId)));
});

app.get("/api/deadlines/suggestions", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  await maybeAutoSyncCanvasData(userId);
  const deadlines = store.getDeadlines(userId);
  const scheduleEvents = store.getScheduleEvents(userId);
  const userContext = store.getUserContext(userId);

  const suggestions = generateDeadlineSuggestions(
    deadlines,
    scheduleEvents,
    userContext,
    new Date()
  );

  return res.json({ suggestions });
});

app.post("/api/study-plan/generate", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = studyPlanGenerateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan payload", issues: parsed.error.issues });
  }

  const plan = generateWeeklyStudyPlan(store.getDeadlines(userId), store.getScheduleEvents(userId), {
    horizonDays: parsed.data.horizonDays,
    minSessionMinutes: parsed.data.minSessionMinutes,
    maxSessionMinutes: parsed.data.maxSessionMinutes,
    now: new Date()
  });

  store.upsertStudyPlanSessions(userId, plan.sessions, plan.generatedAt, {
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd
  });
  const adherence = store.getStudyPlanAdherenceMetrics(userId, {
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd
  });

  return res.json({ plan, adherence });
});

app.get("/api/study-plan/sessions", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = studyPlanSessionsQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan sessions query", issues: parsed.error.issues });
  }

  const sessions = store.getStudyPlanSessions(userId, {
    windowStart: parsed.data.windowStart,
    windowEnd: parsed.data.windowEnd,
    status: parsed.data.status,
    limit: parsed.data.limit
  });

  return res.json({ sessions });
});

app.post("/api/study-plan/sessions/:id/check-in", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = studyPlanSessionCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan session check-in payload", issues: parsed.error.issues });
  }

  const session = store.setStudyPlanSessionStatus(userId, req.params.id, parsed.data.status, parsed.data.checkedAt ?? nowIso(), {
    energyLevel: parsed.data.energyLevel,
    focusLevel: parsed.data.focusLevel,
    checkInNote: parsed.data.checkInNote
  });

  if (!session) {
    return res.status(404).json({ error: "Study plan session not found" });
  }

  return res.json({ session });
});

app.get("/api/study-plan/adherence", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = studyPlanAdherenceQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan adherence query", issues: parsed.error.issues });
  }

  const metrics = store.getStudyPlanAdherenceMetrics(userId, {
    windowStart: parsed.data.windowStart,
    windowEnd: parsed.data.windowEnd
  });

  return res.json({ metrics });
});

app.get("/api/study-plan/export", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = studyPlanExportQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan export query", issues: parsed.error.issues });
  }

  const plan = generateWeeklyStudyPlan(store.getDeadlines(userId), store.getScheduleEvents(userId), {
    horizonDays: parsed.data.horizonDays,
    minSessionMinutes: parsed.data.minSessionMinutes,
    maxSessionMinutes: parsed.data.maxSessionMinutes,
    now: new Date()
  });

  const ics = buildStudyPlanCalendarIcs(plan);
  const generatedOn = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"study-plan-${generatedOn}.ics\"`);
  return res.status(200).send(ics);
});

app.get("/api/deadlines/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deadline = store.getDeadlineById(userId, req.params.id);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.patch("/api/deadlines/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = deadlineUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const existing = store.getDeadlineById(userId, req.params.id, false);
  if (!existing) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const deadline = store.updateDeadline(userId, req.params.id, parsed.data);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.post("/api/deadlines/:id/confirm-status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = deadlineStatusConfirmSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline status payload", issues: parsed.error.issues });
  }

  const existing = store.getDeadlineById(userId, req.params.id, false);
  if (!existing) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const confirmation = store.confirmDeadlineStatus(userId, req.params.id, parsed.data.completed);

  if (!confirmation) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json(confirmation);
});

app.delete("/api/deadlines/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const existing = store.getDeadlineById(userId, req.params.id, false);
  if (!existing) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const deleted = store.deleteDeadline(userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.status(204).send();
});

app.get("/api/habits", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({ habits: store.getHabitsWithStatus(userId) });
});

app.post("/api/habits", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = habitCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit payload", issues: parsed.error.issues });
  }

  const habit = store.createHabit(userId, parsed.data);
  return res.status(201).json({ habit });
});

app.post("/api/habits/:id/check-ins", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = habitCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit check-in payload", issues: parsed.error.issues });
  }

  const habit = store.toggleHabitCheckIn(userId, req.params.id, parsed.data);

  if (!habit) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.json({ habit });
});

app.patch("/api/habits/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = habitUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit payload", issues: parsed.error.issues });
  }

  const patch: Partial<Pick<Habit, "name" | "cadence" | "targetPerWeek" | "motivation">> = {};

  if (parsed.data.name !== undefined) {
    patch.name = parsed.data.name;
  }
  if (parsed.data.cadence !== undefined) {
    patch.cadence = parsed.data.cadence;
  }
  if (parsed.data.targetPerWeek !== undefined) {
    patch.targetPerWeek = parsed.data.targetPerWeek;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "motivation")) {
    const motivation = parsed.data.motivation;
    patch.motivation = motivation && motivation.trim().length > 0 ? motivation : undefined;
  }

  const habit = store.updateHabit(userId, req.params.id, patch);
  if (!habit) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.json({ habit });
});

app.delete("/api/habits/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteHabit(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.status(204).send();
});

app.get("/api/goals", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({ goals: store.getGoalsWithStatus(userId) });
});

app.post("/api/goals", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = goalCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal payload", issues: parsed.error.issues });
  }

  const goal = store.createGoal(userId, {
    ...parsed.data,
    dueDate: parsed.data.dueDate ?? null
  });

  return res.status(201).json({ goal });
});

app.post("/api/goals/:id/check-ins", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = goalCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal check-in payload", issues: parsed.error.issues });
  }

  const goal = store.toggleGoalCheckIn(userId, req.params.id, parsed.data);

  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.json({ goal });
});

app.patch("/api/goals/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = goalUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal payload", issues: parsed.error.issues });
  }

  const patch: Partial<Pick<Goal, "title" | "cadence" | "targetCount" | "dueDate" | "motivation">> = {};

  if (parsed.data.title !== undefined) {
    patch.title = parsed.data.title;
  }
  if (parsed.data.cadence !== undefined) {
    patch.cadence = parsed.data.cadence;
  }
  if (parsed.data.targetCount !== undefined) {
    patch.targetCount = parsed.data.targetCount;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "motivation")) {
    const motivation = parsed.data.motivation;
    patch.motivation = motivation && motivation.trim().length > 0 ? motivation : undefined;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "dueDate")) {
    patch.dueDate = parsed.data.dueDate ?? null;
  }

  const goal = store.updateGoal(userId, req.params.id, patch);
  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.json({ goal });
});

app.delete("/api/goals/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteGoal(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.status(204).send();
});

app.get("/api/nutrition/summary", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionSummaryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition summary query", issues: parsed.error.issues });
  }

  if (parsed.data.date) {
    store.ensureNutritionBaselineForDate(userId, parsed.data.date);
  } else {
    store.ensureNutritionBaselineForDate(userId, new Date());
  }
  const summary = store.getNutritionDailySummary(userId, parsed.data.date ?? new Date());
  return res.json({ summary });
});

app.get("/api/nutrition/history", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const schema = z.object({
    from: nutritionDateSchema.optional(),
    to: nutritionDateSchema.optional(),
    days: z.coerce.number().int().min(1).max(3650).optional()
  });
  const parsed = schema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition history query", issues: parsed.error.issues });
  }

  let fromDate: string;
  let toDate: string;

  if (parsed.data.from && parsed.data.to) {
    fromDate = parsed.data.from;
    toDate = parsed.data.to;
  } else {
    const days = parsed.data.days ?? 30;
    const end = parsed.data.to ? new Date(parsed.data.to + "T00:00:00Z") : new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  }

  const entries = store.getNutritionDailyHistory(userId, fromDate, toDate, { eatenOnly: true });
  return res.json({ entries, from: fromDate, to: toDate });
});

app.get("/api/nutrition/custom-foods", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionCustomFoodsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom foods query", issues: parsed.error.issues });
  }

  const foods = store.getNutritionCustomFoods(userId, {
    query: parsed.data.query,
    limit: parsed.data.limit
  });
  return res.json({ foods });
});

app.post("/api/nutrition/custom-foods", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionCustomFoodCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom food payload", issues: parsed.error.issues });
  }

  const food: NutritionCustomFood = store.createNutritionCustomFood(userId, parsed.data);
  return res.status(201).json({ food });
});

app.patch("/api/nutrition/custom-foods/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionCustomFoodUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom food payload", issues: parsed.error.issues });
  }

  const food: NutritionCustomFood | null = store.updateNutritionCustomFood(userId, req.params.id, parsed.data);
  if (!food) {
    return res.status(404).json({ error: "Custom food not found" });
  }
  return res.json({ food });
});

app.delete("/api/nutrition/custom-foods/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteNutritionCustomFood(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Custom food not found" });
  }
  return res.status(204).send();
});

app.get("/api/nutrition/targets", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionSummaryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition target-profile query", issues: parsed.error.issues });
  }

  const profile = store.getNutritionTargetProfile(userId, parsed.data.date ?? new Date());
  return res.json({ profile });
});

app.put("/api/nutrition/targets", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionTargetProfileUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition target-profile payload", issues: parsed.error.issues });
  }

  const profile = store.upsertNutritionTargetProfile(userId, parsed.data);
  return res.json({ profile });
});

app.get("/api/nutrition/meals", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionMealsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meals query", issues: parsed.error.issues });
  }

  if (parsed.data.date) {
    store.ensureNutritionBaselineForDate(userId, parsed.data.date);
  }
  const meals = store.getNutritionMeals(userId, parsed.data);
  return res.json({ meals });
});

app.post("/api/nutrition/meals", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionMealCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meal payload", issues: parsed.error.issues });
  }

  const meal: NutritionMeal = store.createNutritionMeal(userId, {
    ...parsed.data,
    consumedAt: parsed.data.consumedAt ?? nowIso()
  });

  return res.status(201).json({ meal });
});

app.patch("/api/nutrition/meals/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionMealUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meal payload", issues: parsed.error.issues });
  }

  const meal: NutritionMeal | null = store.updateNutritionMeal(userId, req.params.id, parsed.data);
  if (!meal) {
    return res.status(404).json({ error: "Meal not found" });
  }

  return res.json({ meal });
});

app.delete("/api/nutrition/meals/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteNutritionMeal(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Meal not found" });
  }
  return res.status(204).send();
});

app.get("/api/nutrition/plan-settings", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const settings = store.getNutritionPlanSettings(userId);
  return res.json({ settings });
});

app.put("/api/nutrition/plan-settings", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionPlanSettingsUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan settings payload", issues: parsed.error.issues });
  }

  const settings = store.setNutritionDefaultPlanSnapshot(userId, parsed.data.defaultSnapshotId ?? null);
  if (!settings) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
  }
  return res.json({ settings });
});

app.get("/api/nutrition/plan-snapshots", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionPlanSnapshotsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot query", issues: parsed.error.issues });
  }

  const snapshots = store.getNutritionPlanSnapshots(userId, {
    query: parsed.data.query,
    limit: parsed.data.limit
  });
  return res.json({ snapshots });
});

app.post("/api/nutrition/plan-snapshots", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionPlanSnapshotCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot payload", issues: parsed.error.issues });
  }

  const snapshot = store.createNutritionPlanSnapshot(userId, {
    name: parsed.data.name,
    date: parsed.data.date,
    replaceId: parsed.data.replaceId
  });
  if (!snapshot) {
    return res.status(400).json({ error: "Unable to save nutrition plan snapshot. Add at least one meal first." });
  }

  return res.status(201).json({ snapshot });
});

app.post("/api/nutrition/plan-snapshots/:id/apply", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = nutritionPlanSnapshotApplySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot apply payload", issues: parsed.error.issues });
  }

  const applied = store.applyNutritionPlanSnapshot(userId, req.params.id, parsed.data);
  if (!applied) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
  }

  const settings = store.getNutritionPlanSettings(userId);

  return res.json({
    snapshot: applied.snapshot,
    appliedDate: applied.appliedDate,
    mealsCreated: applied.mealsCreated,
    targetProfile: applied.targetProfile,
    settings
  });
});

app.delete("/api/nutrition/plan-snapshots/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const deleted = store.deleteNutritionPlanSnapshot(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
  }
  return res.status(204).send();
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  return res.json({
    publicKey: getVapidPublicKey(),
    source: hasStaticVapidKeys() ? "configured" : "generated",
    subject: config.VAPID_SUBJECT
  });
});

app.get("/api/push/delivery-metrics", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({ metrics: store.getPushDeliveryMetrics() });
});

app.get("/api/notification-preferences", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({ preferences: store.getNotificationPreferences(userId) });
});

app.put("/api/notification-preferences", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = notificationPreferencesSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid notification preferences payload", issues: parsed.error.issues });
  }

  const next = parsed.data as NotificationPreferencesPatch;
  const preferences = store.setNotificationPreferences(userId, next);
  return res.json({ preferences });
});

const notificationInteractionSchema = z.object({
  notificationId: z.string().min(1),
  notificationTitle: z.string().min(1),
  notificationSource: z.enum(["notes", "lecture-plan", "assignment-tracker", "orchestrator"]),
  notificationPriority: z.enum(["low", "medium", "high", "critical"]),
  interactionType: z.enum(["tap", "dismiss", "action"]),
  actionType: z.string().optional(),
  timeToInteractionMs: z.number().int().min(0).optional()
});

const notificationSnoozeSchema = z.object({
  notificationId: z.string().min(1),
  snoozeMinutes: z.number().int().min(1).max(1440).optional().default(30)
});

app.post("/api/notification-interactions", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = notificationInteractionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid notification interaction payload", issues: parsed.error.issues });
  }

  const interaction = store.recordNotificationInteraction(
    userId,
    parsed.data.notificationId,
    parsed.data.notificationTitle,
    parsed.data.notificationSource,
    parsed.data.notificationPriority,
    parsed.data.interactionType,
    parsed.data.actionType,
    parsed.data.timeToInteractionMs
  );

  return res.status(201).json({ interaction });
});

app.get("/api/notification-interactions", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const until = typeof req.query.until === "string" ? req.query.until : undefined;
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;

  const interactions = store.getNotificationInteractions(userId, { since, until, limit });
  return res.json({ interactions });
});

app.get("/api/notification-interactions/metrics", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const until = typeof req.query.until === "string" ? req.query.until : undefined;

  const metrics = store.getNotificationInteractionMetrics(userId, { since, until });
  return res.json({ metrics });
});

app.post("/api/notifications/snooze", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = notificationSnoozeSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid snooze payload", issues: parsed.error.issues });
  }

  const scheduled = store.snoozeNotification(userId, parsed.data.notificationId, parsed.data.snoozeMinutes);

  if (!scheduled) {
    return res.status(404).json({ error: "Notification not found" });
  }

  return res.json({ scheduled });
});

app.get("/api/scheduled-notifications", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const upcoming = store.getUpcomingScheduledNotifications(userId, "user-reminder");
  return res.json({
    reminders: upcoming.map((s) => ({
      id: s.id,
      title: s.notification.title,
      message: s.notification.message,
      icon: s.notification.icon ?? null,
      priority: s.notification.priority,
      scheduledFor: s.scheduledFor,
      createdAt: s.createdAt,
      recurrence: s.recurrence ?? null
    }))
  });
});

app.delete("/api/scheduled-notifications/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const removed = store.removeScheduledNotification(userId, req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Scheduled notification not found" });
  }
  return res.json({ success: true });
});

app.post("/api/push/subscribe", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = pushSubscriptionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push subscription payload", issues: parsed.error.issues });
  }

  const subscription = store.addPushSubscription(userId, parsed.data);
  console.log(`[push] new subscription registered for user=${userId || "(default)"}`);
  return res.status(201).json({ subscription });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = pushUnsubscribeSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid unsubscribe payload", issues: parsed.error.issues });
  }

  const removed = store.removePushSubscription(userId, parsed.data.endpoint);

  if (!removed) {
    return res.status(404).json({ error: "Push subscription not found" });
  }

  return res.status(204).send();
});

app.post("/api/push/test", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = pushTestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push test payload", issues: parsed.error.issues });
  }

  store.pushNotification(userId, {
    source: "orchestrator",
    title: parsed.data.title ?? "Companion test push",
    message: parsed.data.message ?? "Push notifications are connected and ready.",
    priority: parsed.data.priority ?? "medium"
  });

  return res.status(202).json({ queued: true, subscribers: store.getPushSubscriptions(userId).length });
});

// Background Sync API endpoints
const syncOperationSchema = z.object({
  operationType: z.enum([
    "deadline",
    "context",
    "habit-checkin",
    "goal-checkin",
    "schedule-update"
  ]),
  payload: z.record(z.unknown())
});

app.post("/api/sync/queue", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = syncOperationSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid sync operation payload", issues: parsed.error.issues });
  }

  const item = store.enqueueSyncOperation(parsed.data.operationType, parsed.data.payload);
  return res.status(201).json({ item });
});

app.post("/api/sync/process", async (_req, res) => {
  try {
    const result = await syncService.triggerSync();
    return res.json({ success: true, processed: result.processed, failed: result.failed });
  } catch (error) {
    return res.status(500).json({ 
      error: "Sync processing failed", 
      message: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

app.get("/api/sync/queue-status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  return res.json({
    status: store.getSyncQueueStatus(),
    isProcessing: syncService.isCurrentlyProcessing()
  });
});

app.get("/api/sync/status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const storage = storageDiagnostics();
  const canvasData = store.getCanvasData(userId);
  const withingsData = store.getWithingsData(userId);
  const geminiClient = getGeminiClient();
  const withingsConnection = getWithingsOAuthServiceForUser(userId).getConnectionInfo();
  const mcpServers = getMcpServersPublic(store, userId);

  return res.json({
    storage,
    canvas: {
      lastSyncAt: canvasData?.lastSyncedAt ?? null,
      status: canvasData ? "ok" : "not_synced",
      coursesCount: canvasData?.courses.length ?? 0,
      assignmentsCount: canvasData?.assignments.length ?? 0
    },
    tp: {
      lastSyncAt: null, // Will be implemented when TP sync stores last sync time
      status: "ok",
      source: "ical",
      eventsCount: store.getScheduleEvents(userId).length
    },
    mcp: {
      status: mcpServers.length > 0 ? "configured" : "not_configured",
      serversCount: mcpServers.length
    },
    gemini: {
      status: geminiClient.isConfigured() ? "ok" : "not_configured",
      model: config.GEMINI_LIVE_MODEL,
      requestsToday: null,
      dailyLimit: null,
      rateLimitSource: "provider"
    },
    withings: {
      lastSyncAt: withingsData.lastSyncedAt,
      status: withingsConnection.connected ? "ok" : "not_connected",
      connected: withingsConnection.connected,
      connectionSource: withingsConnection.connected ? withingsConnection.source ?? null : null,
      hasRefreshToken: withingsConnection.connected ? withingsConnection.hasRefreshToken ?? false : false,
      hasAccessToken: withingsConnection.connected ? withingsConnection.hasAccessToken ?? false : false,
      weightsTracked: withingsData.weight.length,
      sleepDaysTracked: withingsData.sleepSummary.length
    },
    autoHealing: {
      tp: (tpSyncServicesByUser.get(userId) ?? new TPSyncService(store, userId)).getAutoHealingStatus(),
      canvas: (canvasSyncServicesByUser.get(userId) ?? getCanvasSyncServiceForUser(userId)).getAutoHealingStatus(),
      blackboard: (blackboardSyncServicesByUser.get(userId) ?? getBlackboardSyncServiceForUser(userId)).getAutoHealingStatus(),
      teams: (teamsSyncServicesByUser.get(userId) ?? getTeamsSyncServiceForUser(userId)).getAutoHealingStatus(),
      withings: getWithingsSyncServiceForUser(userId).getAutoHealingStatus()
    }
  });
});

app.delete("/api/sync/cleanup", (_req, res) => {
  const deleted = store.cleanupCompletedSyncItems(7);
  return res.json({ deleted });
});

app.post("/api/integrations/scope/preview", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = integrationScopePreviewSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration scope preview payload", issues: parsed.error.issues });
  }

  const window = createIntegrationDateWindow({
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });

  const canvasData = store.getCanvasData(userId);
  const canvasCourses = canvasData?.courses ?? [];
  const canvasAssignments = canvasData?.assignments ?? [];
  const selectedCanvasCourseIds =
    parsed.data.canvasCourseIds && parsed.data.canvasCourseIds.length > 0
      ? new Set(parsed.data.canvasCourseIds)
      : null;

  const scopedCanvasCourses =
    selectedCanvasCourseIds === null
      ? canvasCourses
      : canvasCourses.filter((course) => selectedCanvasCourseIds.has(course.id));
  const scopedCanvasAssignments = filterCanvasAssignmentsByDateWindow(canvasAssignments, {
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  }).filter((assignment) => selectedCanvasCourseIds === null || selectedCanvasCourseIds.has(assignment.course_id));

  const selectedTPCourseIds =
    parsed.data.tpCourseIds && parsed.data.tpCourseIds.length > 0
      ? parsed.data.tpCourseIds
      : [];
  const selectedTPCourseCodes = selectedTPCourseIds
    .map((value) => value.split(",")[0]?.trim().toUpperCase())
    .filter((value): value is string => Boolean(value));

  const scheduleEventsInWindow = store.getScheduleEvents(userId).filter((event) => {
    const start = new Date(event.startTime);
    if (Number.isNaN(start.getTime())) {
      return false;
    }
    return start >= window.start && start <= window.end;
  });

  const tpCandidateEvents = scheduleEventsInWindow.filter((event) => /DAT\d{3}/i.test(event.title));
  const matchedTPEvents = tpCandidateEvents.filter((event) => {
    const titleUpper = event.title.toUpperCase();
    return selectedTPCourseCodes.some((courseCode) => titleUpper.includes(courseCode));
  });

  return res.json({
    preview: {
      window: {
        pastDays: window.pastDays,
        futureDays: window.futureDays,
        start: window.start.toISOString(),
        end: window.end.toISOString()
      },
      canvas: {
        coursesMatched: scopedCanvasCourses.length,
        coursesTotal: canvasCourses.length,
        assignmentsMatched: scopedCanvasAssignments.length,
        assignmentsTotal: canvasAssignments.length
      },
      tp: {
        semester: parsed.data.semester ?? "26v",
        courseIdsApplied: selectedTPCourseIds,
        eventsMatched: matchedTPEvents.length,
        eventsTotal: tpCandidateEvents.length
      }
    }
  });
});

app.post("/api/sync/tp", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = tpSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid TP sync payload", issues: parsed.error.issues });
  }

  const result = await runTPSyncForUser(userId, {
    icalUrl: parsed.data.icalUrl,
    semester: parsed.data.semester,
    courseIds: parsed.data.courseIds,
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });

  if (result.success) {
    syncFailureRecovery.recordSuccess("tp");
    recordIntegrationAttempt("tp", syncStartedAt, true);

    return res.json({
      ...result
    });
  }

  const message = result.error ?? "TP sync failed";
  const recoveryPrompt = syncFailureRecovery.recordFailure("tp", message);
  publishSyncRecoveryPrompt(recoveryPrompt);
  recordIntegrationAttempt("tp", syncStartedAt, false, message);

  return res.status(500).json({
    ...result,
    recoveryPrompt
  });
});

app.get("/api/tp/status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const events = store.getScheduleEvents(userId);
  return res.json({
    lastSyncedAt: events.length > 0 ? new Date().toISOString() : null,
    eventsCount: events.length,
    isSyncing: tpSyncInFlightUsers.has(userId) || (tpSyncServicesByUser.get(userId)?.isCurrentlySyncing() ?? false)
  });
});

app.get("/api/canvas/status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const canvasData = store.getCanvasData(userId);
  const connectedCanvasCredentials = getCanvasConnectorCredentials(userId);
  // Only show the user's own Canvas base URL — don't leak admin env config
  const canvasBaseUrl = connectedCanvasCredentials?.baseUrl ?? "";
  return res.json({
    baseUrl: canvasBaseUrl,
    lastSyncedAt: canvasData?.lastSyncedAt ?? null,
    courses: canvasData?.courses ?? []
  });
});

app.post("/api/canvas/sync", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = canvasSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();
  const hadUpcomingScheduleBeforeSync = hasUpcomingScheduleEvents(new Date(), 36, userId);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Canvas sync payload", issues: parsed.error.issues });
  }

  const canvasService = getCanvasSyncServiceForUser(userId);
  const syncOptions = resolveCanvasSyncOptions(userId, {
    baseUrl: parsed.data.baseUrl,
    token: parsed.data.token,
    courseIds: parsed.data.courseIds,
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });
  const result = await canvasService.triggerSync(syncOptions);

  if (result.success) {
    syncFailureRecovery.recordSuccess("canvas");
    recordIntegrationAttempt("canvas", syncStartedAt, true);

    let scheduleRecoveryAttempted = false;
    let scheduleRecovered = false;

    if (!hadUpcomingScheduleBeforeSync && !hasUpcomingScheduleEvents(new Date(), 36, userId)) {
      scheduleRecoveryAttempted = true;
      const tpResult = await runTPSyncForUser(userId);
      scheduleRecovered = tpResult.success && hasUpcomingScheduleEvents(new Date(), 36, userId);
    }

    return res.json({
      ...result,
      scheduleRecovery: {
        attempted: scheduleRecoveryAttempted,
        recovered: scheduleRecovered
      }
    });
  }

  const recoveryPrompt = syncFailureRecovery.recordFailure("canvas", result.error ?? "Canvas sync failed");
  publishSyncRecoveryPrompt(recoveryPrompt);
  recordIntegrationAttempt("canvas", syncStartedAt, false, result.error ?? "Canvas sync failed");
  return res.json({
    ...result,
    recoveryPrompt
  });
});

app.get("/api/gemini/status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const geminiClient = getGeminiClient();
  const isConfigured = geminiClient.isConfigured();
  const growthImageModel = geminiClient.getGrowthImageModel();
  const chatHistory = store.getChatHistory(userId, { page: 1, pageSize: 1 });
  const lastRequestAt = chatHistory.messages.length > 0 
    ? chatHistory.messages[0]?.timestamp ?? null
    : null;

  return res.json({
    apiConfigured: isConfigured,
    model: isConfigured ? config.GEMINI_LIVE_MODEL : "unknown",
    growthImageModel: growthImageModel.configured,
    growthImageModelResolved: growthImageModel.resolved,
    rateLimitRemaining: null,
    rateLimitSource: "provider",
    lastRequestAt,
    error: isConfigured ? undefined : "Vertex Gemini credentials not configured"
  });
});

app.get("/api/auth/withings", (req, res) => {
  const userId = resolveRequestUserId(req);
  if (userId === null) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const authUrl = getWithingsOAuthServiceForUser(userId).getAuthUrl();
    const state = extractStateFromUrl(authUrl);
    if (!state) {
      return res.status(500).json({ error: "Withings OAuth flow did not return a state value" });
    }
    registerPendingOAuthState(withingsPendingOAuthStates, state, userId);
    return res.redirect(authUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Withings OAuth error: ${errorMessage}` });
  }
});

app.get("/api/auth/withings/callback", async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    const errorDescription = typeof req.query.error_description === "string" ? req.query.error_description : error;
    return res.redirect(getIntegrationFrontendRedirect("withings", "failed", errorDescription));
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  if (!code || !state) {
    return res.redirect(getIntegrationFrontendRedirect("withings", "failed", "Missing authorization code or state"));
  }

  const userId = consumePendingOAuthStateUserId(withingsPendingOAuthStates, state);
  if (!userId) {
    return res.redirect(getIntegrationFrontendRedirect("withings", "failed", "Invalid or expired Withings OAuth state"));
  }

  try {
    await getWithingsOAuthServiceForUser(userId).handleCallback(code, state);
    store.upsertUserConnection({
      userId,
      service: "withings",
      credentials: JSON.stringify({ source: "oauth" }),
      displayLabel: "Withings Health"
    });
    return res.redirect(getIntegrationFrontendRedirect("withings", "connected"));
  } catch (oauthError) {
    const errorMessage = oauthError instanceof Error ? oauthError.message : "Unknown error";
    return res.redirect(getIntegrationFrontendRedirect("withings", "failed", errorMessage));
  }
});

// ── Microsoft OAuth callback (Teams / Graph API) ──

app.get("/api/auth/microsoft/callback", async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    const errorDescription = typeof req.query.error_description === "string"
      ? req.query.error_description : error;
    return res.redirect(getIntegrationFrontendRedirect("teams", "failed", errorDescription));
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  if (!code || !state) {
    return res.redirect(getIntegrationFrontendRedirect("teams", "failed", "Missing authorization code or state"));
  }

  const userId = consumePendingOAuthStateUserId(microsoftPendingOAuthStates, state);
  if (!userId) {
    return res.redirect(getIntegrationFrontendRedirect("teams", "failed", "Invalid or expired Microsoft OAuth state"));
  }

  try {
    const msOAuth = getMicrosoftOAuthServiceForUser(userId);
    await msOAuth.handleCallback(code, state);

    // Kick off Teams sync now that we have valid tokens
    const teamsService = getTeamsSyncServiceForUser(userId);
    if (!teamsSyncServicesByUser.has(userId)) {
      teamsSyncServicesByUser.set(userId, teamsService);
      teamsService.start();
    }
    void teamsService.triggerSync().catch(() => {});

    return res.redirect(getIntegrationFrontendRedirect("teams", "connected"));
  } catch (oauthError) {
    const errorMessage = oauthError instanceof Error ? oauthError.message : "Unknown error";
    return res.redirect(getIntegrationFrontendRedirect("teams", "failed", errorMessage));
  }
});

app.get("/api/withings/status", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const connection = getWithingsOAuthServiceForUser(userId).getConnectionInfo();
  const data = getWithingsSyncServiceForUser(userId).getData();
  return res.json({
    ...connection,
    lastSyncedAt: data.lastSyncedAt,
    weightsTracked: data.weight.length,
    sleepDaysTracked: data.sleepSummary.length
  });
});

app.post("/api/withings/sync", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsed = withingsSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Withings sync payload", issues: parsed.error.issues });
  }

  try {
    const service = getWithingsSyncServiceForUser(userId);
    const result = await service.triggerSync({
      daysBack: parsed.data.daysBack
    });

    if (result.success) {
      syncFailureRecovery.recordSuccess("withings");
      recordIntegrationAttempt("withings", syncStartedAt, true);
    } else {
      const recoveryPrompt = syncFailureRecovery.recordFailure("withings", result.error ?? "Withings sync failed");
      publishSyncRecoveryPrompt(recoveryPrompt);
      recordIntegrationAttempt("withings", syncStartedAt, false, result.error ?? "Withings sync failed");
      return res.status(500).json({
        ...result,
        recoveryPrompt
      });
    }

    return res.json({
      ...result,
      startedAt: new Date(syncStartedAt).toISOString(),
      data: service.getData()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const recoveryPrompt = syncFailureRecovery.recordFailure("withings", errorMessage);
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("withings", syncStartedAt, false, errorMessage);
    return res.status(500).json({ error: errorMessage, recoveryPrompt });
  }
});

app.get("/api/withings/summary", (req, res) => {
  const userId = (req as AuthenticatedRequest).authUser?.id ?? "";
  const parsedDays = typeof req.query.daysBack === "string" ? Number(req.query.daysBack) : 14;
  const daysBack = Number.isFinite(parsedDays) ? Math.max(1, Math.min(90, Math.round(parsedDays))) : 14;
  const data = getWithingsSyncServiceForUser(userId).getData();
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const weight = data.weight.filter((entry) => Date.parse(entry.measuredAt) >= cutoff);
  const sleepSummary = data.sleepSummary.filter((entry) => {
    const dayMs = Date.parse(`${entry.date}T00:00:00.000Z`);
    return Number.isFinite(dayMs) && dayMs >= cutoff;
  });

  return res.json({
    generatedAt: nowIso(),
    daysBack,
    lastSyncedAt: data.lastSyncedAt,
    latestWeight: weight[0] ?? null,
    latestSleep: sleepSummary[0] ?? null,
    weight,
    sleepSummary
  });
});

app.get("/api/integrations/recovery-prompts", (_req, res) => {
  return res.json(syncFailureRecovery.getSnapshot());
});

app.get("/api/integrations/health-log", (req, res) => {
  const parsed = integrationHealthLogQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration health-log query", issues: parsed.error.issues });
  }

  const attempts = store.getIntegrationSyncAttempts({
    integration: parsed.data.integration,
    status: parsed.data.status,
    limit: parsed.data.limit,
    hours: parsed.data.hours
  });

  return res.json({
    generatedAt: nowIso(),
    total: attempts.length,
    attempts
  });
});

app.get("/api/integrations/health-log/summary", (req, res) => {
  const parsed = integrationHealthSummaryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration health-log summary query", issues: parsed.error.issues });
  }

  const summary = store.getIntegrationSyncSummary(parsed.data.hours);
  return res.json(summary);
});

async function fetchCalendarIcs(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

const server = app.listen(config.PORT, () => {
  const storage = storageDiagnostics();
  // eslint-disable-next-line no-console
  console.log(`[companion] listening on http://localhost:${config.PORT}`);
  // eslint-disable-next-line no-console
  console.log(
    `[companion] storage backend=${storage.backend} sqlite=${storage.sqlitePath}` +
      (persistenceContext.restoredSnapshotAt
        ? ` restoredSnapshotAt=${persistenceContext.restoredSnapshotAt}`
        : "")
  );
  // eslint-disable-next-line no-console
  console.log(`[push] VAPID keys=${hasStaticVapidKeys() ? "configured" : "auto-generated (will rotate on restart!)"} subject=${config.VAPID_SUBJECT}`);
  // eslint-disable-next-line no-console
  console.log(`[push] subscriptions=${store.getAllPushSubscriptions().length}`);
});

let shuttingDown = false;

const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  // Stop per-user services
  clearInterval(perUserServiceRefreshTimer);
  runtime.stop();
  for (const ds of digestServicesByUser.values()) ds.stop();
  digestServicesByUser.clear();
  for (const ts of tpSyncServicesByUser.values()) ts.stop();
  tpSyncServicesByUser.clear();
  for (const te of timeEditSyncServicesByUser.values()) te.stop();
  timeEditSyncServicesByUser.clear();

  syncService.stop();
  for (const service of canvasSyncServicesByUser.values()) {
    service.stop();
  }
  canvasSyncServicesByUser.clear();
  for (const service of blackboardSyncServicesByUser.values()) {
    service.stop();
  }
  blackboardSyncServicesByUser.clear();
  for (const service of teamsSyncServicesByUser.values()) {
    service.stop();
  }
  teamsSyncServicesByUser.clear();
  for (const service of withingsSyncServicesByUser.values()) {
    service.stop();
  }
  withingsSyncServicesByUser.clear();
  withingsOAuthServicesByUser.clear();
  withingsPendingOAuthStates.clear();

  const finalize = async (): Promise<void> => {
    // Flush any remaining buffered journal entries before shutdown
    try {
      for (const uid of store.getAllUserIds()) {
        await flushJournalSessionBuffer(store, uid);
      }
    } catch {
      // best-effort — don't block shutdown
    }

    if (persistenceContext.postgresSnapshotStore) {
      try {
        await persistenceContext.postgresSnapshotStore.flush(() => store.serializeDatabase());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[companion] failed final PostgreSQL snapshot flush", error);
      }

      try {
        await persistenceContext.postgresSnapshotStore.close();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[companion] failed closing PostgreSQL snapshot store", error);
      }
    }

    server.close(() => {
      process.exit(0);
    });
  };

  void finalize();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
