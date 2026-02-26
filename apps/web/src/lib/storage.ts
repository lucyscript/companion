import {
  CanvasSettings,
  CanvasStatus,
  ChatMood,
  NotificationPreferences,
  IntegrationScopeSettings,
  Locale,
  ThemePreference,
  UserContext
} from "../types";
import { DEFAULT_THEME, normalizeThemePreference } from "./theme";

// Storage version - increment when data structures change to auto-clear cache
const STORAGE_VERSION = "1.0.2";  // Changed to trigger cache clear
const VERSION_KEY = "companion:version";

// Auto-clear storage if version changed (prevents cached data bugs)
const storedVersion = localStorage.getItem(VERSION_KEY);
if (storedVersion !== STORAGE_VERSION) {
  console.log(`Storage version changed (${storedVersion} → ${STORAGE_VERSION}), clearing cache`);
  localStorage.clear();
  localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
}

const STORAGE_KEYS = {
  dashboard: "companion:dashboard",
  context: "companion:context",
  syncQueue: "companion:sync-queue",
  notificationPreferences: "companion:notification-preferences",
  theme: "companion:theme",
  locale: "companion:locale",
  talkModeEnabled: "companion:talk-mode-enabled",
  canvasSettings: "companion:canvas-settings",
  canvasStatus: "companion:canvas-status",
  integrationScopeSettings: "companion:integration-scope-settings",
  authToken: "companion:auth-token",
  chatMood: "companion:chat-mood"
} as const;

export interface SyncQueueItem {
  id: string;
  operationType: "deadline" | "context" | "habit-checkin" | "goal-checkin" | "schedule-update";
  payload: Record<string, unknown>;
  dedupeKey?: string;
  createdAt: string;
}

const defaultContext: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced"
};

function normalizeCanvasBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let origin = "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    origin = parsed.origin;
  } catch {
    return "";
  }

  // Generic Canvas root isn't a tenant URL and confuses users in the connector form.
  if (origin.toLowerCase() === "https://canvas.instructure.com" || origin.toLowerCase() === "https://stavanger.instructure.com") {
    return "";
  }

  return origin;
}

const defaultCanvasSettings: CanvasSettings = {
  baseUrl: "",
  token: ""
};

const defaultCanvasStatus: CanvasStatus = {
  baseUrl: defaultCanvasSettings.baseUrl,
  lastSyncedAt: null,
  courses: []
};

const defaultIntegrationScopeSettings: IntegrationScopeSettings = {
  semester: "26v",
  tpCourseIds: [],
  canvasCourseIds: [],
  pastDays: 7,
  futureDays: 180
};


const defaultNotificationPreferences: NotificationPreferences = {
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 7
  },
  minimumPriority: "low",
  allowCriticalInQuietHours: true,
  categoryToggles: {
    notes: true,
    "lecture-plan": true,
    "assignment-tracker": true,
    orchestrator: true
  }
};

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notificationPreferences);
    if (raw) return JSON.parse(raw) as NotificationPreferences;
  } catch {
    // corrupted
  }
  return defaultNotificationPreferences;
}

export function saveNotificationPreferences(preferences: NotificationPreferences): void {
  localStorage.setItem(STORAGE_KEYS.notificationPreferences, JSON.stringify(preferences));
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme);
    if (!raw) {
      return DEFAULT_THEME;
    }
    // Backward compatibility with old theme values.
    if (raw === "light" || raw === "dark" || raw === "system") {
      return DEFAULT_THEME;
    }
    return normalizeThemePreference(raw);
  } catch {
    // corrupted
  }
  return DEFAULT_THEME;
}

export function saveThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEYS.theme, preference);
}

export function loadLocalePreference(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.locale);
    if (raw === "en" || raw === "no") {
      return raw;
    }
  } catch {
    // corrupted
  }
  return "en";
}

export function saveLocalePreference(locale: Locale): void {
  localStorage.setItem(STORAGE_KEYS.locale, locale);
}

export function loadTalkModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.talkModeEnabled) === "true";
  } catch {
    return false;
  }
}

export function saveTalkModeEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.talkModeEnabled, enabled ? "true" : "false");
}

const VALID_MOODS: ChatMood[] = ["neutral", "encouraging", "focused", "celebratory", "empathetic", "urgent"];

export function loadChatMood(): ChatMood {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.chatMood);
    if (raw && VALID_MOODS.includes(raw as ChatMood)) {
      return raw as ChatMood;
    }
    return "neutral";
  } catch {
    return "neutral";
  }
}

export function saveChatMood(mood: ChatMood): void {
  localStorage.setItem(STORAGE_KEYS.chatMood, mood);
}

export function loadAuthToken(): string | null {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.authToken);
    if (!token || token.trim().length === 0) {
      return null;
    }
    return token.trim();
  } catch {
    return null;
  }
}

export function saveAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.authToken, token.trim());
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEYS.authToken);
}

export function clearCompanionSessionData(options: { keepTheme?: boolean } = {}): void {
  const keepTheme = options.keepTheme ?? true;
  const keepLocale = true;
  const themeValue = keepTheme ? localStorage.getItem(STORAGE_KEYS.theme) : null;
  const localeValue = keepLocale ? localStorage.getItem(STORAGE_KEYS.locale) : null;

  Object.values(STORAGE_KEYS).forEach((key) => {
    if (keepTheme && key === STORAGE_KEYS.theme) {
      return;
    }
    if (keepLocale && key === STORAGE_KEYS.locale) {
      return;
    }
    localStorage.removeItem(key);
  });

  if (keepTheme && themeValue) {
    localStorage.setItem(STORAGE_KEYS.theme, themeValue);
  }
  if (keepLocale && localeValue) {
    localStorage.setItem(STORAGE_KEYS.locale, localeValue);
  }

  localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
}

export function loadCanvasSettings(): CanvasSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.canvasSettings);
    if (raw) {
      const parsed = JSON.parse(raw) as CanvasSettings;
      return {
        ...defaultCanvasSettings,
        ...parsed,
        baseUrl: normalizeCanvasBaseUrl(parsed.baseUrl)
      };
    }
  } catch {
    // corrupted
  }
  return defaultCanvasSettings;
}

export function saveCanvasSettings(settings: CanvasSettings): void {
  localStorage.setItem(
    STORAGE_KEYS.canvasSettings,
    JSON.stringify({
      ...settings,
      baseUrl: normalizeCanvasBaseUrl(settings.baseUrl)
    })
  );
}

export function loadCanvasStatus(): CanvasStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.canvasStatus);
    if (raw) return { ...defaultCanvasStatus, ...(JSON.parse(raw) as CanvasStatus) };
  } catch {
    // corrupted
  }
  return defaultCanvasStatus;
}

export function saveCanvasStatus(status: CanvasStatus): void {
  localStorage.setItem(STORAGE_KEYS.canvasStatus, JSON.stringify(status));
}

export function loadIntegrationScopeSettings(): IntegrationScopeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.integrationScopeSettings);
    if (!raw) {
      return defaultIntegrationScopeSettings;
    }

    const parsed = JSON.parse(raw) as Partial<IntegrationScopeSettings>;
    const tpCourseIds = Array.isArray(parsed.tpCourseIds)
      ? parsed.tpCourseIds.map((value) => value.trim()).filter(Boolean)
      : defaultIntegrationScopeSettings.tpCourseIds;
    const canvasCourseIds = Array.isArray(parsed.canvasCourseIds)
      ? parsed.canvasCourseIds.filter((value): value is number => Number.isInteger(value) && value > 0)
      : [];

    return {
      semester: typeof parsed.semester === "string" && parsed.semester.trim() ? parsed.semester.trim() : "26v",
      tpCourseIds,
      canvasCourseIds,
      pastDays:
        typeof parsed.pastDays === "number" && Number.isFinite(parsed.pastDays)
          ? Math.max(0, Math.min(30, Math.round(parsed.pastDays)))
          : defaultIntegrationScopeSettings.pastDays,
      futureDays:
        typeof parsed.futureDays === "number" && Number.isFinite(parsed.futureDays)
          ? Math.max(1, Math.min(730, Math.round(parsed.futureDays)))
          : defaultIntegrationScopeSettings.futureDays
    };
  } catch {
    return defaultIntegrationScopeSettings;
  }
}

export function saveIntegrationScopeSettings(settings: IntegrationScopeSettings): void {
  const normalized: IntegrationScopeSettings = {
    semester: settings.semester.trim() || "26v",
    tpCourseIds: settings.tpCourseIds.map((value) => value.trim()).filter(Boolean),
    canvasCourseIds: settings.canvasCourseIds.filter((value) => Number.isInteger(value) && value > 0),
    pastDays: Math.max(0, Math.min(365, Math.round(settings.pastDays))),
    futureDays: Math.max(1, Math.min(730, Math.round(settings.futureDays)))
  };
  localStorage.setItem(STORAGE_KEYS.integrationScopeSettings, JSON.stringify(normalized));
}

export function loadContext(): UserContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.context);
    if (raw) return JSON.parse(raw) as UserContext;
  } catch {
    // corrupted — fall through
  }
  return defaultContext;
}

export function saveContext(ctx: UserContext): void {
  localStorage.setItem(STORAGE_KEYS.context, JSON.stringify(ctx));
}


// Sync Queue management
export function loadSyncQueue(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.syncQueue);
    if (raw) return JSON.parse(raw) as SyncQueueItem[];
  } catch {
    // corrupted
  }
  return [];
}

export function saveSyncQueue(items: SyncQueueItem[]): void {
  localStorage.setItem(STORAGE_KEYS.syncQueue, JSON.stringify(items));
}

export function enqueueSyncOperation(
  operationType: SyncQueueItem["operationType"],
  payload: Record<string, unknown>,
  options: { dedupeKey?: string } = {}
): void {
  const queue = loadSyncQueue();
  const dedupeKey = options.dedupeKey?.trim();

  if (dedupeKey) {
    const existingIndex = queue.findIndex(
      (item) => item.operationType === operationType && item.dedupeKey === dedupeKey
    );
    if (existingIndex >= 0) {
      const existing = queue[existingIndex]!;
      queue[existingIndex] = {
        ...existing,
        payload,
        createdAt: new Date().toISOString(),
        dedupeKey
      };
      saveSyncQueue(queue);
      return;
    }
  }

  queue.push({
    id: crypto.randomUUID(),
    operationType,
    payload,
    ...(dedupeKey ? { dedupeKey } : {}),
    createdAt: new Date().toISOString()
  });
  saveSyncQueue(queue);
}

export function removeSyncQueueItem(id: string): void {
  const queue = loadSyncQueue().filter((item) => item.id !== id);
  saveSyncQueue(queue);
}

export function clearSyncQueue(): void {
  saveSyncQueue([]);
}
