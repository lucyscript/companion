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
    description: "10 AI messages/day, schedule & deadlines, Canvas + TP sync.",
    priceMonthlyNok: 0,
    dailyChatLimit: 10,
    features: new Set<FeatureId>(["chat", "schedule", "connectors"]),
    connectors: ["canvas", "tp_schedule"] as ConnectorService[],
    maxChatHistory: 50,
    trialDays: 0,
    badge: "Free"
  },
  plus: {
    id: "plus",
    name: "Plus",
    description: "Food tracking, AI tools, custom themes, and more chat.",
    priceMonthlyNok: 49,
    dailyChatLimit: 75,
    features: new Set<FeatureId>([
      "chat", "schedule", "nutrition",
      "connectors", "gemini_tools", "chat_history", "custom_moods"
    ]),
    // 3 integrations total: Gemini counts as 1, so 2 user-chosen slots
    connectors: ["canvas", "mcp", "tp_schedule"] as ConnectorService[],
    maxChatHistory: 500,
    trialDays: 7,
    badge: "Plus"
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Growth analytics, health tracking, and unlimited everything.",
    priceMonthlyNok: 99,
    dailyChatLimit: 0, // unlimited
    features: new Set<FeatureId>([
      "chat", "schedule", "nutrition", "habits",
      "connectors", "gemini_tools", "chat_history", "analytics", "custom_moods"
    ]),
    // Unlimited integrations — all connector types available
    connectors: ["canvas", "mcp", "withings", "tp_schedule"] as ConnectorService[],
    maxChatHistory: 0,
    trialDays: 0,
    badge: "Pro"
  }
};

// ── Tool tier mapping: which Gemini tools each plan can access ───────────

/** Tools available to all plans (free + paid) — schedule & deadline basics */
const FREE_TIER_TOOLS: ReadonlySet<string> = new Set([
  "getSchedule",
  "getRoutinePresets",
  "getDeadlines",
  "createDeadline",
  "deleteDeadline",
  "queueDeadlineAction",
  "createScheduleBlock",
  "updateScheduleBlock",
  "deleteScheduleBlock",
  "clearScheduleWindow",
  "queueCreateRoutinePreset",
  "queueUpdateRoutinePreset",
  "scheduleReminder",
  "getReminders",
  "cancelReminder",
  "setResponseMood"
]);

/** Additional tools unlocked at Plus tier — nutrition */
const PLUS_TIER_TOOLS: ReadonlySet<string> = new Set([
  "getNutritionSummary",
  "getNutritionHistory",
  "getNutritionTargets",
  "updateNutritionTargets",
  "getNutritionMeals",
  "getNutritionPlanSnapshots",
  "saveNutritionPlanSnapshot",
  "applyNutritionPlanSnapshot",
  "deleteNutritionPlanSnapshot",
  "getNutritionCustomFoods",
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

/** Additional tools unlocked at Pro tier — habits, goals, withings */
const PRO_TIER_TOOLS: ReadonlySet<string> = new Set([
  "getWithingsHealthSummary",
  "getHabitsGoalsStatus",
  "updateHabitCheckIn",
  "checkInGym",
  "updateGoalCheckIn",
  "createHabit",
  "deleteHabit",
  "createGoal",
  "deleteGoal"
]);

/**
 * Get the set of allowed tool names for a given plan.
 * Each tier includes all tools from lower tiers.
 */
export function getAllowedToolNames(planId: PlanId): ReadonlySet<string> {
  const allowed = new Set(FREE_TIER_TOOLS);
  if (planId === "plus" || planId === "pro") {
    for (const t of PLUS_TIER_TOOLS) allowed.add(t);
  }
  if (planId === "pro") {
    for (const t of PRO_TIER_TOOLS) allowed.add(t);
  }
  return allowed;
}

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
