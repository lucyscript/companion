/**
 * Lightweight conversion event tracking.
 *
 * Events are emitted as CustomEvents on `window` so any external analytics
 * provider (GA, Plausible, PostHog, etc.) can pick them up without coupling.
 * They are also stored in sessionStorage for debugging and local reporting.
 */

export type ConversionEvent =
  | "view_pricing"
  | "start_trial"
  | "start_checkout"
  | "subscribe"
  | "view_referral"
  | "share_referral";

interface ConversionPayload {
  event: ConversionEvent;
  plan?: string;
  method?: string;
  feature?: string;
  timestamp: string;
}

const SESSION_KEY = "companion:conversion-events";

function loadEvents(): ConversionPayload[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ConversionPayload[]) : [];
  } catch {
    return [];
  }
}

function persistEvent(payload: ConversionPayload): void {
  try {
    const events = loadEvents();
    events.push(payload);
    // Keep only latest 50 events per session
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(events.slice(-50)));
  } catch {
    // sessionStorage unavailable — silently fail
  }
}

/**
 * Track a conversion event. Dispatches a `companion:conversion` CustomEvent
 * on `window` and persists the event in sessionStorage.
 */
export function trackConversion(
  event: ConversionEvent,
  meta?: { plan?: string; method?: string; feature?: string }
): void {
  const payload: ConversionPayload = {
    event,
    plan: meta?.plan,
    method: meta?.method,
    feature: meta?.feature,
    timestamp: new Date().toISOString(),
  };

  persistEvent(payload);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("companion:conversion", { detail: payload })
    );
  }
}

/** Get all conversion events stored in the current session. */
export function getSessionConversionEvents(): ConversionPayload[] {
  return loadEvents();
}
