/**
 * Plan Tier Configuration
 *
 * Defines what each subscription plan allows. The server enforces these
 * limits; the frontend reads them via /api/plan to decide what to show/lock.
 */

import type { ConnectorService } from "./types.js";

// ── Plan identifiers ─────────────────────────────────────────────────────

export type PlanId = "free" | "plus" | "pro";

// ── Feature flags exposed to the frontend ────────────────────────────────

export type FeatureId =
  | "chat"            // AI chat (all plans, just rate-limited)
  | "schedule"        // Schedule / deadlines tab
  | "nutrition"       // Nutrition tracking tab
  | "habits"          // Habits + analytics (Growth) tab
  | "connectors"      // Connect external apps
  | "gemini_tools"    // Gemini tool calls (search, course content, etc.)
  | "chat_history"    // Full chat history (free: last 50 msgs only)
  | "analytics"       // Growth analytics dashboard
  | "custom_moods";   // Custom chat mood themes

// ── Per-plan configuration ───────────────────────────────────────────────

export interface PlanTier {
  id: PlanId;
  name: string;
  description: string;
  /** NOK per month (0 = free) */
  priceMonthlyNok: number;
  /** Daily Gemini chat messages allowed (0 = unlimited) */
  dailyChatLimit: number;
  /** Which tabs/features are unlocked */
  features: Set<FeatureId>;
  /** Which connector services are allowed */
  connectors: ConnectorService[];
  /** Max stored chat history messages (0 = unlimited) */
  maxChatHistory: number;
  /** Whether the plan offers a free trial */
  trialDays: number;
  /** Badge label shown in the UI */
  badge: string;
}

export const PLAN_TIERS: Record<PlanId, PlanTier> = {
  free: {
    id: "free",
    name: "Free",
    description: "Get started with basic AI chat and your schedule.",
    priceMonthlyNok: 0,
    dailyChatLimit: 10,
    features: new Set<FeatureId>(["chat", "schedule"]),
    connectors: [],
    maxChatHistory: 50,
    trialDays: 0,
    badge: "Free"
  },
  plus: {
    id: "plus",
    name: "Plus",
    description: "Unlock all features, more chat, and app integrations.",
    priceMonthlyNok: 49,
    dailyChatLimit: 100,
    features: new Set<FeatureId>([
      "chat", "schedule", "nutrition", "habits",
      "connectors", "gemini_tools", "chat_history", "analytics"
    ]),
    connectors: ["canvas", "mcp", "tp_schedule"] as ConnectorService[],
    maxChatHistory: 0, // unlimited
    trialDays: 7,
    badge: "Plus"
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Unlimited everything — power users and early supporters.",
    priceMonthlyNok: 99,
    dailyChatLimit: 0, // unlimited
    features: new Set<FeatureId>([
      "chat", "schedule", "nutrition", "habits",
      "connectors", "gemini_tools", "chat_history", "analytics", "custom_moods"
    ]),
    connectors: ["canvas", "mcp", "withings", "tp_schedule"] as ConnectorService[],
    maxChatHistory: 0,
    trialDays: 7,
    badge: "Pro"
  }
};

// ── Helper: resolve a user's effective plan ─────────────────────────────

export interface UserPlanInfo {
  plan: PlanId;
  /** True if the user is currently in an active trial */
  isTrial: boolean;
  /** ISO date when the trial ends (null if not on trial) */
  trialEndsAt: string | null;
  /** Daily chat messages used today */
  chatUsedToday: number;
  /** Daily chat limit for this plan (0 = unlimited) */
  chatLimitToday: number;
  /** Feature IDs this plan unlocks */
  features: FeatureId[];
  /** Allowed connector services */
  connectors: ConnectorService[];
  /** Plan display name */
  planName: string;
  /** Plan badge */
  badge: string;
}

/**
 * Determine if a user is within their trial period.
 * A trial is active when trialEndsAt is in the future.
 */
export function isTrialActive(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

/**
 * Get the effective plan for a user, considering trial state.
 * Admin users always get "pro" access.
 */
export function getEffectivePlan(
  userPlan: PlanId,
  userRole: string,
  trialEndsAt: string | null
): PlanId {
  // Admins always have full access
  if (userRole === "admin") return "pro";

  // If user is on free but has an active trial, they get the trial plan
  if (userPlan === "free" && isTrialActive(trialEndsAt)) {
    return "plus"; // trial grants Plus access
  }

  return userPlan;
}

/**
 * Check if a plan allows a specific feature.
 */
export function planHasFeature(planId: PlanId, feature: FeatureId): boolean {
  return PLAN_TIERS[planId].features.has(feature);
}

/**
 * Check if a plan allows a specific connector.
 */
export function planAllowsConnector(planId: PlanId, connector: ConnectorService): boolean {
  return PLAN_TIERS[planId].connectors.includes(connector);
}
