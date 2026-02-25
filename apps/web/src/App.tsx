import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatFab } from "./components/ChatFab";
import { ChatTab } from "./components/ChatTab";
import { ConsentGate } from "./components/ConsentGate";
import { LoginView } from "./components/LoginView";
import { ScheduleTab } from "./components/ScheduleTab";
import { InstallPrompt } from "./components/InstallPrompt";
import { SettingsView } from "./components/SettingsView";
import { HabitsGoalsView } from "./components/HabitsGoalsView";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { NutritionView } from "./components/NutritionView";
import { TabBar, TabId } from "./components/TabBar";
import { LockedFeatureOverlay, UpgradePrompt } from "./components/UpgradePrompt";
import { useDashboard } from "./hooks/useDashboard";
import { usePlan } from "./hooks/usePlan";
import { getAuthMe, getAuthStatus, logout } from "./lib/api";
import { useI18n } from "./lib/i18n";
import { enablePushNotifications, isPushEnabled, supportsPushNotifications } from "./lib/push";
import { setupSyncListeners } from "./lib/sync";
import { applyTheme, DEFAULT_THEME } from "./lib/theme";
import {
  clearAuthToken,
  clearCompanionSessionData,
  loadThemePreference,
  loadAuthToken,
  loadChatMood,
  saveThemePreference,
  saveAuthToken,
  saveChatMood
} from "./lib/storage";
import { hapticCriticalAlert } from "./lib/haptics";
import { parseDeepLink } from "./lib/deepLink";
import { ChatMood, FeatureId, ThemePreference } from "./types";

type PushState = "checking" | "ready" | "enabled" | "unsupported" | "denied" | "error";
type AuthState = "checking" | "required-login" | "consent-pending" | "ready";

/** Map tab IDs to the feature gate that controls access. */
const TAB_FEATURE_MAP: Record<TabId, FeatureId> = {
  chat: "chat",
  schedule: "schedule",
  nutrition: "nutrition",
  habits: "habits",
  settings: "chat" // settings is always accessible (same gate as chat)
};

const SCHEDULE_MUTATION_TOOLS = new Set([
  "queueDeadlineAction",
  "createDeadline",
  "deleteDeadline",
  "createScheduleBlock",
  "updateScheduleBlock",
  "deleteScheduleBlock",
  "clearScheduleWindow",
  "scheduleReminder",
  "cancelReminder"
]);

const NUTRITION_MUTATION_TOOLS = new Set([
  "updateNutritionTargets",
  "saveNutritionPlanSnapshot",
  "applyNutritionPlanSnapshot",
  "deleteNutritionPlanSnapshot",
  "createNutritionCustomFood",
  "updateNutritionCustomFood",
  "deleteNutritionCustomFood",
  "logMeal",
  "createNutritionMeal",
  "updateNutritionMeal",
  "addNutritionMealItem",
  "updateNutritionMealItem",
  "removeNutritionMealItem",
  "moveNutritionMeal",
  "setNutritionMealOrder",
  "deleteMeal"
]);

const HABITS_MUTATION_TOOLS = new Set([
  "updateHabitCheckIn",
  "checkInGym",
  "updateGoalCheckIn",
  "createHabit",
  "deleteHabit",
  "createGoal",
  "deleteGoal"
]);

const CHAT_MOOD_BACKGROUNDS: Record<ChatMood, string> = {
  neutral: "var(--surface-soft)",
  encouraging: "linear-gradient(160deg, rgba(125, 211, 168, 0.18) 0%, rgba(125, 211, 168, 0.06) 50%, var(--surface-soft) 85%)",
  focused: "linear-gradient(160deg, rgba(100, 160, 240, 0.18) 0%, rgba(100, 160, 240, 0.06) 50%, var(--surface-soft) 85%)",
  celebratory: "linear-gradient(160deg, rgba(246, 195, 127, 0.22) 0%, rgba(125, 211, 168, 0.10) 50%, var(--surface-soft) 100%)",
  empathetic: "linear-gradient(160deg, rgba(180, 140, 220, 0.18) 0%, rgba(180, 140, 220, 0.06) 50%, var(--surface-soft) 85%)",
  urgent: "linear-gradient(160deg, rgba(255, 138, 128, 0.18) 0%, rgba(255, 138, 128, 0.06) 50%, var(--surface-soft) 85%)"
};

function parseApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = error.message?.trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
  } catch {
    return raw;
  }

  return raw;
}

export default function App(): JSX.Element {
  const { t } = useI18n();
  const initialDeepLink = parseDeepLink(typeof window === "undefined" ? "" : window.location.search);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authProviders, setAuthProviders] = useState<{ local: boolean; google: boolean; github: boolean }>({
    local: true, google: false, github: false
  });
  const { data, loading, error } = useDashboard(authState === "ready");
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");

  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [nutritionRevision, setNutritionRevision] = useState(0);
  const [habitsRevision, setHabitsRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>(initialDeepLink.tab ?? "chat");
  const [focusDeadlineId, setFocusDeadlineId] = useState<string | null>(initialDeepLink.deadlineId);
  const [focusLectureId, setFocusLectureId] = useState<string | null>(initialDeepLink.lectureId);
  const [settingsSection, setSettingsSection] = useState<string | null>(initialDeepLink.section);
  const [chatMood, setChatMood] = useState<ChatMood>(loadChatMood);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeatureLabel, setUpgradeFeatureLabel] = useState<string | undefined>(undefined);
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  const [isIosTouchDevice, setIsIosTouchDevice] = useState(false);
  const overlayLaunchSourceTabRef = useRef<TabId | null>(null);
  const overlayLaunchGuardUntilRef = useRef(0);
  const seenCriticalNotifications = useRef<Set<string>>(new Set());
  const { planInfo, hasFeature } = usePlan(authState === "ready");
  const isChatTab = activeTab === "chat";
  const isOverlayDocked = chatOverlayOpen && !isChatTab && isIosTouchDevice;

  useEffect(() => {
    let disposed = false;

    const initializeAuth = async (): Promise<void> => {
      setAuthState("checking");
      setAuthError(null);

      // Handle OAuth redirect: extract token from URL fragment (#auth_token=...)
      const hash = window.location.hash;
      if (hash.startsWith("#auth_token=")) {
        const token = hash.slice("#auth_token=".length);
        if (token) {
          saveAuthToken(token);
        }
        // Clean the URL fragment without triggering navigation
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      // Handle OAuth error from redirect
      if (hash.startsWith("#auth_error=")) {
        const errorMsg = decodeURIComponent(hash.slice("#auth_error=".length));
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setAuthError(errorMsg || "OAuth sign-in failed");
        setAuthState("required-login");
        return;
      }

      try {
        const status = await getAuthStatus();
        if (disposed) {
          return;
        }

        setAuthRequired(status.required);
        setAuthProviders(status.providers ?? { local: true, google: false, github: false });
        if (!status.required) {
          setAuthState("consent-pending");
          return;
        }

        if (!loadAuthToken()) {
          setAuthState("required-login");
          return;
        }

        const me = await getAuthMe();
        if (disposed) {
          return;
        }

        setAuthUserEmail(me.user.email);
        setAuthState("consent-pending");
      } catch (error) {
        if (disposed) {
          return;
        }

        clearAuthToken();
        setAuthUserEmail(null);
        const message = parseApiErrorMessage(error, "");
        if (message.includes("404")) {
          // Backward-compatible fallback for older server versions without auth endpoints.
          setAuthRequired(false);
          setAuthState("consent-pending");
          return;
        }

        setAuthState("required-login");
      }
    };

    void initializeAuth();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!planInfo) {
      applyTheme(themePreference);
      return;
    }

    const allowCustomThemes = planInfo.plan !== "free";
    const effectiveTheme = allowCustomThemes ? themePreference : DEFAULT_THEME;

    if (!allowCustomThemes && themePreference !== DEFAULT_THEME) {
      setThemePreference(DEFAULT_THEME);
      saveThemePreference(DEFAULT_THEME);
    }

    applyTheme(effectiveTheme);
  }, [planInfo, themePreference]);

  useEffect(() => {
    document.documentElement.style.setProperty("--chat-mood-active-bg", CHAT_MOOD_BACKGROUNDS[chatMood]);
  }, [chatMood]);

  // Set up background sync listeners
  useEffect(() => {
    setupSyncListeners();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const KEYBOARD_GAP_THRESHOLD_PX = 40;
    const VIEWPORT_DROP_THRESHOLD_PX = 70;
    let baselineViewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
    const isCoarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const isIOS =
      /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    document.body.classList.toggle("ios-touch", isIOS);
    setIsIosTouchDevice(isIOS);

    const hasEditableFocus = (): boolean => {
      const active = document.activeElement;
      if (!active) {
        return false;
      }
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return true;
      }
      return (active as HTMLElement).isContentEditable;
    };

    const updateViewportVars = (): void => {
      const viewport = window.visualViewport;
      const viewportHeight = Math.round(viewport?.height ?? window.innerHeight);
      const viewportOffsetTop = Math.round(viewport?.offsetTop ?? 0);

      const editableFocused = hasEditableFocus();
      const chatTabActive = document.body.classList.contains("chat-tab-active");
      const chatOverlayActive = document.body.classList.contains("chat-overlay-active");
      const mobileChatInputFocused = editableFocused && (chatTabActive || chatOverlayActive) && (isIOS || isCoarsePointer);
      if (!mobileChatInputFocused) {
        baselineViewportHeight = Math.max(baselineViewportHeight, viewportHeight);
      }

      const effectiveAppViewportHeight = mobileChatInputFocused ? baselineViewportHeight : viewportHeight;
      root.style.setProperty("--app-viewport-height", `${effectiveAppViewportHeight}px`);
      root.style.setProperty("--app-viewport-offset-top", `${viewportOffsetTop}px`);
      // Keep raw visual viewport metrics for keyboard-aware overlays.
      root.style.setProperty("--visual-viewport-height", `${viewportHeight}px`);
      root.style.setProperty("--visual-viewport-offset-top", `${viewportOffsetTop}px`);

      const keyboardGap = Math.max(0, Math.round(window.innerHeight - viewportHeight - viewportOffsetTop));
      const viewportDrop = Math.max(0, baselineViewportHeight - viewportHeight);
      const keyboardOpen =
        mobileChatInputFocused &&
        (keyboardGap > KEYBOARD_GAP_THRESHOLD_PX || viewportDrop > VIEWPORT_DROP_THRESHOLD_PX);
      const minimumTouchKeyboardGap = isIOS || isCoarsePointer ? 44 : 0;
      const maximumReasonableKeyboardGap = Math.round(window.innerHeight * 0.5);
      let effectiveKeyboardGap = 0;
      if (keyboardOpen) {
        // Prefer direct visual viewport keyboard gap. Only fall back to viewport drop
        // when Safari under-reports gap during keyboard transitions.
        const rawGap = keyboardGap > KEYBOARD_GAP_THRESHOLD_PX ? keyboardGap : viewportDrop;
        effectiveKeyboardGap = Math.max(rawGap, minimumTouchKeyboardGap);
        effectiveKeyboardGap = Math.min(effectiveKeyboardGap, maximumReasonableKeyboardGap);
      }
      root.style.setProperty("--keyboard-gap", `${effectiveKeyboardGap}px`);

      document.body.classList.toggle("keyboard-open", keyboardOpen);

      // iOS PWA: paint html bg so the area behind the keyboard matches the UI.
      // For chat overlays, override to solid scrim; for chat tab, html default
      // (mood-tint + --bg) already handles it.
      if (keyboardOpen && isIOS && chatOverlayActive) {
        const voidFill = getComputedStyle(root).getPropertyValue("--ios-keyboard-void-fill").trim() || "#070F18";
        root.style.setProperty("background", voidFill, "important");
      } else {
        root.style.removeProperty("background");
      }
    };

    const handleFocusEvent = (): void => {
      window.setTimeout(updateViewportVars, 40);
    };
    const handleOrientationChange = (): void => {
      baselineViewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
      window.setTimeout(updateViewportVars, 80);
    };

    updateViewportVars();

    window.addEventListener("resize", updateViewportVars);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("focusin", handleFocusEvent);
    window.addEventListener("focusout", handleFocusEvent);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("focusin", handleFocusEvent);
      window.removeEventListener("focusout", handleFocusEvent);
      window.visualViewport?.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportVars);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-offset-top");
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-offset-top");
      root.style.removeProperty("--keyboard-gap");
      root.style.removeProperty("background");
      document.body.classList.remove("keyboard-open");
      document.body.classList.remove("ios-touch");
      setIsIosTouchDevice(false);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const syncPushState = async (): Promise<void> => {
      if (!supportsPushNotifications()) {
        if (!disposed) {
          setPushState("unsupported");
        }
        return;
      }

      if (Notification.permission === "denied") {
        if (!disposed) {
          setPushState("denied");
          setPushMessage("Notification permission is blocked in browser settings.");
        }
        return;
      }

      const enabled = await isPushEnabled();
      if (!disposed) {
        setPushState(enabled ? "enabled" : "ready");
      }
    };

    void syncPushState();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!data?.notifications) return;

    let triggered = false;
    const seen = seenCriticalNotifications.current;

    for (const notification of data.notifications) {
      if (notification.priority !== "critical") continue;
      if (!seen.has(notification.id)) {
        seen.add(notification.id);
        triggered = true;
      }
    }

    if (triggered) {
      hapticCriticalAlert();
    }
  }, [data?.notifications]);

  const applyDeepLinkFromUrl = useCallback((): void => {
    const next = parseDeepLink(window.location.search);
    if (next.tab) {
      setActiveTab(next.tab);
    }
    setFocusDeadlineId(next.deadlineId);
    setFocusLectureId(next.lectureId);
    setSettingsSection(next.section);
  }, []);

  useLayoutEffect(() => {
    const isChatActive = activeTab === "chat";
    document.body.classList.toggle("chat-tab-active", isChatActive);
    document.body.dataset.activeTab = activeTab;

    return () => {
      document.body.classList.remove("chat-tab-active");
      delete document.body.dataset.activeTab;
    };
  }, [activeTab]);

  useEffect(() => {
    document.body.classList.toggle("chat-overlay-active", chatOverlayOpen);
    return () => {
      document.body.classList.remove("chat-overlay-active");
    };
  }, [chatOverlayOpen]);

  useEffect(() => {
    document.body.classList.toggle("chat-overlay-docked", isOverlayDocked);
    return () => {
      document.body.classList.remove("chat-overlay-docked");
    };
  }, [isOverlayDocked]);

  useEffect(() => {
    if (!chatOverlayOpen) {
      overlayLaunchSourceTabRef.current = null;
      overlayLaunchGuardUntilRef.current = 0;
      return;
    }

    const originTab = overlayLaunchSourceTabRef.current;
    const guardUntil = overlayLaunchGuardUntilRef.current;
    const guardStillActive = guardUntil > Date.now();
    if (originTab && originTab !== "chat" && activeTab === "chat" && guardStillActive) {
      setActiveTab(originTab);
    }
  }, [activeTab, chatOverlayOpen]);

  useLayoutEffect(() => {
    const tabContent = document.querySelector(".tab-content-area");
    if (!(tabContent instanceof HTMLElement)) {
      return;
    }

    const isFormControl = (
      element: HTMLElement
    ): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement;

    const lockFocusableTree = (root: HTMLElement): void => {
      const focusables = root.querySelectorAll<HTMLElement>("input, textarea, select, button, [tabindex], [contenteditable='true']");
      focusables.forEach((element) => {
        if (element.hasAttribute("data-overlay-focus-lock")) {
          return;
        }
        element.setAttribute("data-overlay-focus-lock", "1");

        const previousTabIndex = element.getAttribute("tabindex");
        element.setAttribute("data-overlay-prev-tabindex", previousTabIndex ?? "");
        element.setAttribute("tabindex", "-1");

        if (isFormControl(element)) {
          element.setAttribute("data-overlay-prev-disabled", element.disabled ? "1" : "0");
          element.disabled = true;
        }

        if (element.hasAttribute("contenteditable")) {
          element.setAttribute("data-overlay-prev-contenteditable", element.getAttribute("contenteditable") ?? "");
          element.setAttribute("contenteditable", "false");
        }
      });
    };

    const unlockFocusableTree = (root: HTMLElement): void => {
      const locked = root.querySelectorAll<HTMLElement>("[data-overlay-focus-lock='1']");
      locked.forEach((element) => {
        const previousTabIndex = element.getAttribute("data-overlay-prev-tabindex");
        if (previousTabIndex === "") {
          element.removeAttribute("tabindex");
        } else if (previousTabIndex) {
          element.setAttribute("tabindex", previousTabIndex);
        }
        element.removeAttribute("data-overlay-prev-tabindex");

        if (isFormControl(element)) {
          const previousDisabled = element.getAttribute("data-overlay-prev-disabled");
          element.disabled = previousDisabled === "1";
          element.removeAttribute("data-overlay-prev-disabled");
        }

        if (element.hasAttribute("data-overlay-prev-contenteditable")) {
          const previousContentEditable = element.getAttribute("data-overlay-prev-contenteditable");
          if (previousContentEditable === "") {
            element.removeAttribute("contenteditable");
          } else if (previousContentEditable) {
            element.setAttribute("contenteditable", previousContentEditable);
          }
          element.removeAttribute("data-overlay-prev-contenteditable");
        }

        element.removeAttribute("data-overlay-focus-lock");
      });
    };

    const lockFocusableOutsideOverlay = (): void => {
      const overlayPanel = document.querySelector(".chat-overlay-panel");
      if (!(overlayPanel instanceof HTMLElement)) {
        return;
      }

      const focusables = document.body.querySelectorAll<HTMLElement>(
        "input, textarea, select, button, [tabindex], [contenteditable='true']"
      );

      focusables.forEach((element) => {
        if (overlayPanel.contains(element)) {
          return;
        }
        if (element.closest(".tab-bar")) {
          return;
        }
        if (element.hasAttribute("data-overlay-global-focus-lock")) {
          return;
        }
        element.setAttribute("data-overlay-global-focus-lock", "1");

        const previousTabIndex = element.getAttribute("tabindex");
        element.setAttribute("data-overlay-global-prev-tabindex", previousTabIndex ?? "");
        element.setAttribute("tabindex", "-1");

        if (isFormControl(element)) {
          element.setAttribute("data-overlay-global-prev-disabled", element.disabled ? "1" : "0");
          element.disabled = true;
        }

        if (element.hasAttribute("contenteditable")) {
          element.setAttribute("data-overlay-global-prev-contenteditable", element.getAttribute("contenteditable") ?? "");
          element.setAttribute("contenteditable", "false");
        }
      });
    };

    const unlockFocusableOutsideOverlay = (): void => {
      const locked = document.body.querySelectorAll<HTMLElement>("[data-overlay-global-focus-lock='1']");
      locked.forEach((element) => {
        const previousTabIndex = element.getAttribute("data-overlay-global-prev-tabindex");
        if (previousTabIndex === "") {
          element.removeAttribute("tabindex");
        } else if (previousTabIndex) {
          element.setAttribute("tabindex", previousTabIndex);
        }
        element.removeAttribute("data-overlay-global-prev-tabindex");

        if (isFormControl(element)) {
          const previousDisabled = element.getAttribute("data-overlay-global-prev-disabled");
          element.disabled = previousDisabled === "1";
          element.removeAttribute("data-overlay-global-prev-disabled");
        }

        if (element.hasAttribute("data-overlay-global-prev-contenteditable")) {
          const previousContentEditable = element.getAttribute("data-overlay-global-prev-contenteditable");
          if (previousContentEditable === "") {
            element.removeAttribute("contenteditable");
          } else if (previousContentEditable) {
            element.setAttribute("contenteditable", previousContentEditable);
          }
          element.removeAttribute("data-overlay-global-prev-contenteditable");
        }

        element.removeAttribute("data-overlay-global-focus-lock");
      });
    };

    const shouldIsolateOverlay = chatOverlayOpen && activeTab !== "chat" && !isOverlayDocked;
    if (shouldIsolateOverlay) {
      tabContent.setAttribute("inert", "");
      tabContent.setAttribute("aria-hidden", "true");
      lockFocusableTree(tabContent);
      lockFocusableOutsideOverlay();
    } else {
      tabContent.removeAttribute("inert");
      tabContent.removeAttribute("aria-hidden");
      unlockFocusableTree(tabContent);
      unlockFocusableOutsideOverlay();
    }

    return () => {
      tabContent.removeAttribute("inert");
      tabContent.removeAttribute("aria-hidden");
      unlockFocusableTree(tabContent);
      unlockFocusableOutsideOverlay();
    };
  }, [chatOverlayOpen, activeTab, isOverlayDocked]);

  useEffect(() => {
    if (!chatOverlayOpen || activeTab === "chat") {
      return;
    }

    const scrollOverlayMessagesToBottom = (): void => {
      const panel = document.querySelector(".chat-overlay-panel");
      const messages = panel?.querySelector(".chat-messages");
      if (!(messages instanceof HTMLElement)) {
        return;
      }
      messages.scrollTo({ top: messages.scrollHeight, behavior: "auto" });
    };

    requestAnimationFrame(scrollOverlayMessagesToBottom);
    const timer = window.setTimeout(scrollOverlayMessagesToBottom, 140);
    return () => {
      window.clearTimeout(timer);
    };
  }, [chatOverlayOpen, activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleNavigation = (): void => {
      applyDeepLinkFromUrl();
    };

    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    applyDeepLinkFromUrl();

    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
    };
  }, [applyDeepLinkFromUrl]);

  useEffect(() => {
    if (activeTab !== "settings" || !settingsSection) {
      return;
    }

    const targetBySection: Record<string, string> = {
      integrations: "integration-status-panel"
    };
    const targetId = targetBySection[settingsSection];
    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTab, settingsSection]);

  const handleEnablePush = async (): Promise<void> => {
    setPushState("checking");
    const result = await enablePushNotifications();
    setPushState(result.status === "enabled" ? "enabled" : result.status);
    setPushMessage(result.message ?? "");
  };

  const closeChatOverlay = useCallback((): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
    document.body.classList.remove("chat-input-focused");
    document.body.classList.remove("keyboard-open");
    document.documentElement.style.setProperty("--keyboard-gap", "0px");
    // Clear void-fill background override
    document.documentElement.style.removeProperty("background");

    const tabContent = document.querySelector(".tab-content-area");
    const tabBar = document.querySelector(".tab-bar");
    tabContent?.removeAttribute("inert");
    tabContent?.removeAttribute("aria-hidden");
    tabBar?.removeAttribute("inert");
    tabBar?.removeAttribute("aria-hidden");

    const lockedScoped = document.querySelectorAll<HTMLElement>("[data-overlay-focus-lock='1']");
    lockedScoped.forEach((element) => {
      const previousTabIndex = element.getAttribute("data-overlay-prev-tabindex");
      if (previousTabIndex === "") {
        element.removeAttribute("tabindex");
      } else if (previousTabIndex) {
        element.setAttribute("tabindex", previousTabIndex);
      }
      element.removeAttribute("data-overlay-prev-tabindex");

      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLButtonElement
      ) {
        const previousDisabled = element.getAttribute("data-overlay-prev-disabled");
        element.disabled = previousDisabled === "1";
        element.removeAttribute("data-overlay-prev-disabled");
      }

      if (element.hasAttribute("data-overlay-prev-contenteditable")) {
        const previousContentEditable = element.getAttribute("data-overlay-prev-contenteditable");
        if (previousContentEditable === "") {
          element.removeAttribute("contenteditable");
        } else if (previousContentEditable) {
          element.setAttribute("contenteditable", previousContentEditable);
        }
        element.removeAttribute("data-overlay-prev-contenteditable");
      }

      element.removeAttribute("data-overlay-focus-lock");
    });

    const lockedGlobal = document.querySelectorAll<HTMLElement>("[data-overlay-global-focus-lock='1']");
    lockedGlobal.forEach((element) => {
      const previousTabIndex = element.getAttribute("data-overlay-global-prev-tabindex");
      if (previousTabIndex === "") {
        element.removeAttribute("tabindex");
      } else if (previousTabIndex) {
        element.setAttribute("tabindex", previousTabIndex);
      }
      element.removeAttribute("data-overlay-global-prev-tabindex");

      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLButtonElement
      ) {
        const previousDisabled = element.getAttribute("data-overlay-global-prev-disabled");
        element.disabled = previousDisabled === "1";
        element.removeAttribute("data-overlay-global-prev-disabled");
      }

      if (element.hasAttribute("data-overlay-global-prev-contenteditable")) {
        const previousContentEditable = element.getAttribute("data-overlay-global-prev-contenteditable");
        if (previousContentEditable === "") {
          element.removeAttribute("contenteditable");
        } else if (previousContentEditable) {
          element.setAttribute("contenteditable", previousContentEditable);
        }
        element.removeAttribute("data-overlay-global-prev-contenteditable");
      }

      element.removeAttribute("data-overlay-global-focus-lock");
    });

    setChatOverlayOpen(false);
  }, []);

  const handleTabChange = (tab: TabId): void => {
    const guardStillActive = overlayLaunchGuardUntilRef.current > Date.now();
    const overlayOriginTab = overlayLaunchSourceTabRef.current;
    const leakedOverlayLaunchToChatTab =
      tab === "chat" &&
      guardStillActive &&
      overlayOriginTab !== null &&
      overlayOriginTab !== "chat" &&
      activeTab === overlayOriginTab;
    if (leakedOverlayLaunchToChatTab) {
      setChatOverlayOpen(true);
      return;
    }

    closeChatOverlay();
    setActiveTab(tab);

    if (tab !== "schedule") {
      setFocusDeadlineId(null);
      setFocusLectureId(null);
    }
    if (tab !== "settings") {
      setSettingsSection(null);
    }
  };

  const openChatOverlayFromFab = useCallback((): void => {
    overlayLaunchSourceTabRef.current = activeTab;
    overlayLaunchGuardUntilRef.current = Date.now() + 1500;
    setChatOverlayOpen(true);
  }, [activeTab]);

  const openUpgradeModal = useCallback((featureLabel?: string) => {
    setUpgradeFeatureLabel(featureLabel);
    setShowUpgradeModal(true);
  }, []);

  const isTabLocked = useCallback((tab: TabId): boolean => {
    if (!planInfo) return false; // still loading, don't lock
    const feature = TAB_FEATURE_MAP[tab];
    return !hasFeature(feature);
  }, [planInfo, hasFeature]);

  const handleMoodChange = useCallback((mood: ChatMood): void => {
    setChatMood(mood);
    saveChatMood(mood);
  }, []);

  const handleThemeChange = useCallback((theme: ThemePreference): void => {
    if (!planInfo) {
      return;
    }
    const canCustomizeThemes = planInfo.plan !== "free";
    if (!canCustomizeThemes) {
      openUpgradeModal(t("Custom chat themes"));
      return;
    }
    setThemePreference(theme);
    saveThemePreference(theme);
    applyTheme(theme);
  }, [openUpgradeModal, planInfo, t]);

  const handleDataMutated = useCallback((tools: string[]): void => {
    if (tools.some((tool) => SCHEDULE_MUTATION_TOOLS.has(tool))) {
      setScheduleRevision((r) => r + 1);
    }
    if (tools.some((tool) => NUTRITION_MUTATION_TOOLS.has(tool))) {
      setNutritionRevision((r) => r + 1);
    }
    if (tools.some((tool) => HABITS_MUTATION_TOOLS.has(tool))) {
      setHabitsRevision((r) => r + 1);
    }
  }, []);

  const handleLogout = async (): Promise<void> => {
    setAuthSubmitting(true);
    try {
      await logout();
    } catch {
      // Local session clear still guarantees sign-out even when network is unavailable.
    } finally {
      clearCompanionSessionData({ keepTheme: true });
      setAuthUserEmail(null);
      setAuthError(null);
      setAuthState(authRequired ? "required-login" : "ready");
      setAuthSubmitting(false);
    }
  };

  if (authState === "checking") {
    return (
      <main className="app-shell">
        <section className="login-view">
          <div className="login-card">
            <div className="login-brand">
              <div className="login-logo">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <p className="login-subtitle">{t("Connecting...")}</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (authState === "required-login") {
    return (
      <main className="app-shell">
        <LoginView loading={authSubmitting} error={authError} providers={authProviders} />
      </main>
    );
  }

  if (authState === "consent-pending") {
    return <ConsentGate onAccepted={() => setAuthState("ready")} />;
  }

  const handleOverlayPanelFocus = (): void => {
    // When the input inside the overlay gets focus, scroll messages to bottom
    // so the composer remains visible during iOS keyboard animation.
    const scrollOverlayMessages = (): void => {
      const panel = document.querySelector(".chat-overlay-panel");
      const msgs = panel?.querySelector(".chat-messages");
      if (msgs) {
        msgs.scrollTo({ top: msgs.scrollHeight, behavior: "auto" });
      }
    };

    requestAnimationFrame(scrollOverlayMessages);
    setTimeout(scrollOverlayMessages, 150);
    setTimeout(scrollOverlayMessages, 400);
  };

  const dockedOverlayPortal = isOverlayDocked && typeof document !== "undefined"
    ? createPortal(
        <>
          <div className="chat-overlay-panel chat-overlay-panel-docked" onFocus={handleOverlayPanelFocus}>
            <ChatTab mood={chatMood} onMoodChange={handleMoodChange} onDataMutated={handleDataMutated} />
          </div>
          <button
            type="button"
            className="chat-overlay-docked-close-btn"
            onClick={closeChatOverlay}
            aria-label={t("Close chat overlay")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </>,
        document.body
      )
    : null;

  return (
    <main className={`app-shell chat-mood-${chatMood} ${isChatTab ? "app-shell-chat-active" : ""}`}>
      <InstallPrompt />

      {loading && <p>{t("Loading...")}</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          {/* Tab content area */}
          <div className="tab-content-area">
            {/* Chat panel — full tab mode */}
            <div className={`tab-panel ${isChatTab ? "tab-panel-active" : "tab-panel-hidden"}`}>
              {isChatTab && <ChatTab mood={chatMood} onMoodChange={handleMoodChange} onDataMutated={handleDataMutated} />}
            </div>
            {activeTab === "schedule" && (
              isTabLocked("schedule")
                ? <LockedFeatureOverlay featureName={t("Schedule")} onUpgradeClick={() => openUpgradeModal(t("Schedule"))} />
                : <ScheduleTab
                    scheduleKey={`schedule-${scheduleRevision}`}
                    focusDeadlineId={focusDeadlineId ?? undefined}
                    focusLectureId={focusLectureId ?? undefined}
                  />
            )}
            {activeTab === "nutrition" && (
              isTabLocked("nutrition")
                ? <LockedFeatureOverlay featureName={t("Food")} onUpgradeClick={() => openUpgradeModal(t("Food"))} />
                : <NutritionView key={`nutrition-${nutritionRevision}`} />
            )}
            {activeTab === "habits" && (
              isTabLocked("habits")
                ? <LockedFeatureOverlay featureName={t("Growth")} onUpgradeClick={() => openUpgradeModal(t("Growth"))} />
                : <div key={`habits-${habitsRevision}`} className="habits-tab-container habits-analytics-stack">
                    <HabitsGoalsView />
                    <AnalyticsDashboard />
                  </div>
            )}
            {activeTab === "settings" && (
              <SettingsView
                planInfo={planInfo}
                onUpgrade={() => openUpgradeModal()}
                themePreference={themePreference}
                themesLocked={!planInfo || planInfo.plan === "free"}
                onThemeChange={handleThemeChange}
                userEmail={authUserEmail}
                authRequired={authRequired}
                onSignOut={() => void handleLogout()}
                signingOut={authSubmitting}
                pushState={pushState}
                onEnablePush={() => void handleEnablePush()}
                pushMessage={pushMessage}
              />
            )}

          </div>

          {/* Chat overlay — docked viewport mode on iOS touch */}
          {dockedOverlayPortal}

          {/* Chat overlay — floating bottom sheet on non-chat tabs */}
          {chatOverlayOpen && !isChatTab && !isOverlayDocked && (
            <>
              <div className="chat-overlay-backdrop" onClick={closeChatOverlay} />
              <div
                className="chat-overlay-panel"
                onFocus={handleOverlayPanelFocus}
              >
                <div className="chat-overlay-header">
                  <span className="chat-overlay-title">{t("Chat")}</span>
                  <button
                    type="button"
                    className="chat-overlay-close-btn"
                    onClick={closeChatOverlay}
                    aria-label={t("Close chat overlay")}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <ChatTab mood={chatMood} onMoodChange={handleMoodChange} onDataMutated={handleDataMutated} />
              </div>
            </>
          )}

          {/* Floating chat button — visible on non-chat tabs when overlay is closed */}
          <ChatFab
            visible={!isChatTab && !chatOverlayOpen}
            onClick={openChatOverlayFromFab}
          />

          {/* Bottom tab bar */}
          <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
        </>
      )}

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <UpgradePrompt feature={upgradeFeatureLabel} onDismiss={() => setShowUpgradeModal(false)} />
      )}
    </main>
  );
}
