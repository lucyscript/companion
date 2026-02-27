/**
 * Detects if the user is on iOS Safari
 */
export function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isChrome = /CriOS|Chrome/.test(ua);

  // iOS Safari is iOS + WebKit but NOT Chrome
  return isIOS && isWebkit && !isChrome;
}

/**
 * Detects if the app is running in standalone mode (installed to home screen)
 */
export function isStandalone(): boolean {
  // Check for iOS standalone mode
  if ('standalone' in window.navigator) {
    return (window.navigator as { standalone?: boolean }).standalone === true;
  }

  // Check for display-mode: standalone (works on Android and other browsers)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  return false;
}

/**
 * Determines if the install prompt should be shown
 * Shows on iOS Safari (manual instructions) OR when beforeinstallprompt fires (Chrome/Edge/Android)
 */
export function shouldShowInstallPrompt(): boolean {
  if (isStandalone()) return false;
  return isIOSSafari() || hasDeferredInstallPrompt();
}

/**
 * Check if the install prompt has been dismissed by the user
 */
export function isInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem('install-prompt-dismissed') === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark the install prompt as dismissed
 */
export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem('install-prompt-dismissed', 'true');
  } catch {
    // Silently fail if localStorage is not available
  }
}

/* ── beforeinstallprompt support (Chrome / Edge / Android) ── */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners: Array<() => void> = [];

/** Returns true if we captured a beforeinstallprompt event */
export function hasDeferredInstallPrompt(): boolean {
  return deferredPrompt !== null;
}

/** Trigger the native install prompt. Returns the user's choice. */
export async function triggerNativeInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome;
  } catch {
    return "unavailable";
  }
}

/** Subscribe to know when a deferred prompt becomes available */
export function onInstallPromptAvailable(cb: () => void): () => void {
  listeners.push(cb);
  // If already available, fire immediately
  if (deferredPrompt) {
    queueMicrotask(cb);
  }
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// Capture the event globally as early as possible
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((cb) => cb());
  });
}
