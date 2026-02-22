import { nowIso } from "./utils.js";

export type SyncIntegration = "canvas" | "tp" | "withings";

type PromptSeverity = "medium" | "high";

interface IntegrationFailureState {
  consecutiveFailures: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastPromptFailureCount: number;
}

export interface SyncRecoveryPrompt {
  id: string;
  integration: SyncIntegration;
  severity: PromptSeverity;
  title: string;
  message: string;
  failureCount: number;
  lastError: string;
  rootCauseHint: string;
  suggestedActions: string[];
  isDataStale: boolean;
  generatedAt: string;
}

export interface SyncIntegrationHealth {
  integration: SyncIntegration;
  consecutiveFailures: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  isDataStale: boolean;
}

export interface SyncRecoverySnapshot {
  generatedAt: string;
  prompts: SyncRecoveryPrompt[];
  integrations: SyncIntegrationHealth[];
}

const PROMPT_THRESHOLD = 2;

const staleMinutesByIntegration: Record<SyncIntegration, number> = {
  canvas: 180,
  tp: 24 * 60,
  withings: 24 * 60
};

function defaultState(): IntegrationFailureState {
  return {
    consecutiveFailures: 0,
    firstFailureAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastPromptFailureCount: 0
  };
}

function inferRootCause(error: string): string {
  const lowered = error.toLowerCase();
  if (lowered.includes("401") || lowered.includes("403") || lowered.includes("unauthorized") || lowered.includes("invalid")) {
    return "Authentication or credentials are invalid.";
  }
  if (lowered.includes("not connected") || lowered.includes("missing")) {
    return "Integration is not connected or required config is missing.";
  }
  if (lowered.includes("429") || lowered.includes("rate limit")) {
    return "Provider rate limit reached.";
  }
  if (lowered.includes("network") || lowered.includes("fetch") || lowered.includes("timeout") || lowered.includes("econn")) {
    return "Network or provider API appears unreachable.";
  }
  return "Sync failed for an unknown reason.";
}

function buildSuggestedActions(integration: SyncIntegration, error: string): string[] {
  const lowered = error.toLowerCase();
  const actions = ["Open Settings > Integrations and run a manual sync retry."];

  if (integration === "canvas") {
    actions.push("Verify Canvas API token and base URL are correct.");
    actions.push("Check Canvas course scope filters to avoid restricted courses.");
  } else if (integration === "tp") {
    actions.push("Verify TP semester/course IDs and that the iCal endpoint is reachable.");
    actions.push("Retry TP sync after confirming network connectivity.");
  } else {
    actions.push("Reconnect Withings OAuth and verify Body+ Sleep scopes are granted.");
    actions.push("Retry Withings sync after reconnecting.");
  }

  if (lowered.includes("429") || lowered.includes("rate limit")) {
    actions.push("Wait a few minutes for provider rate limits to reset before retrying.");
  }

  return actions;
}

function isDataStaleForState(
  integration: SyncIntegration,
  state: IntegrationFailureState,
  referenceDate: Date
): boolean {
  if (!state.lastSuccessAt) {
    return state.consecutiveFailures > 0;
  }

  const successDate = new Date(state.lastSuccessAt);
  if (Number.isNaN(successDate.getTime())) {
    return state.consecutiveFailures > 0;
  }

  const maxAgeMs = staleMinutesByIntegration[integration] * 60 * 1000;
  return referenceDate.getTime() - successDate.getTime() > maxAgeMs;
}

export class SyncFailureRecoveryTracker {
  private readonly byIntegration: Record<SyncIntegration, IntegrationFailureState> = {
    canvas: defaultState(),
    tp: defaultState(),
    withings: defaultState()
  };

  recordSuccess(integration: SyncIntegration, syncedAt: string = nowIso()): void {
    const state = this.byIntegration[integration];
    state.consecutiveFailures = 0;
    state.firstFailureAt = null;
    state.lastFailureAt = null;
    state.lastError = null;
    state.lastSuccessAt = syncedAt;
    state.lastPromptFailureCount = 0;
  }

  recordFailure(
    integration: SyncIntegration,
    error: string,
    failedAt: string = nowIso()
  ): SyncRecoveryPrompt | null {
    const state = this.byIntegration[integration];
    state.consecutiveFailures += 1;
    state.lastFailureAt = failedAt;
    state.lastError = error;
    if (!state.firstFailureAt) {
      state.firstFailureAt = failedAt;
    }

    if (state.consecutiveFailures < PROMPT_THRESHOLD) {
      return null;
    }

    const referenceDate = new Date(failedAt);
    const stale = isDataStaleForState(integration, state, referenceDate);
    const shouldPrompt = stale || state.consecutiveFailures >= 3;

    if (!shouldPrompt || state.consecutiveFailures <= state.lastPromptFailureCount) {
      return null;
    }

    const prompt = this.buildPrompt(integration, referenceDate);
    state.lastPromptFailureCount = state.consecutiveFailures;
    return prompt;
  }

  getSnapshot(referenceDate: Date = new Date()): SyncRecoverySnapshot {
    const prompts: SyncRecoveryPrompt[] = [];
    const integrations: SyncIntegrationHealth[] = [];

    for (const integration of Object.keys(this.byIntegration) as SyncIntegration[]) {
      const state = this.byIntegration[integration];
      const isStale = isDataStaleForState(integration, state, referenceDate);

      integrations.push({
        integration,
        consecutiveFailures: state.consecutiveFailures,
        firstFailureAt: state.firstFailureAt,
        lastFailureAt: state.lastFailureAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        isDataStale: isStale
      });

      if (state.consecutiveFailures >= PROMPT_THRESHOLD && state.lastError) {
        prompts.push(this.buildPrompt(integration, referenceDate));
      }
    }

    return {
      generatedAt: referenceDate.toISOString(),
      prompts: prompts
        .sort((a, b) => b.failureCount - a.failureCount)
        .slice(0, 6),
      integrations
    };
  }

  private buildPrompt(integration: SyncIntegration, referenceDate: Date): SyncRecoveryPrompt {
    const state = this.byIntegration[integration];
    const error = state.lastError ?? "Unknown sync error";
    const stale = isDataStaleForState(integration, state, referenceDate);
    const rootCauseHint = inferRootCause(error);
    const actions = buildSuggestedActions(integration, error);
    const severity: PromptSeverity = stale || state.consecutiveFailures >= 4 ? "high" : "medium";
    const titlePrefix = integration === "tp" ? "TP" : integration === "withings" ? "Withings" : "Canvas";

    return {
      id: `sync-recovery-${integration}-${state.consecutiveFailures}`,
      integration,
      severity,
      title: `${titlePrefix} sync needs attention`,
      message: `${titlePrefix} sync failed ${state.consecutiveFailures} times in a row.`,
      failureCount: state.consecutiveFailures,
      lastError: error,
      rootCauseHint,
      suggestedActions: actions,
      isDataStale: stale,
      generatedAt: referenceDate.toISOString()
    };
  }
}
