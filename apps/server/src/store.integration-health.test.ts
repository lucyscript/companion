import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore integration sync health log", () => {
  it("persists and filters integration sync attempts", () => {
    const store = new RuntimeStore(":memory:");

    store.recordIntegrationSyncAttempt({
      integration: "tp",
      status: "success",
      latencyMs: 420,
      rootCause: "none",
      errorMessage: null,
      attemptedAt: "2026-02-17T15:00:00.000Z"
    });

    store.recordIntegrationSyncAttempt({
      integration: "canvas",
      status: "failure",
      latencyMs: 980,
      rootCause: "auth",
      errorMessage: "401 unauthorized",
      attemptedAt: "2026-02-17T15:01:00.000Z"
    });

    const failures = store.getIntegrationSyncAttempts({ status: "failure" });
    const tpAttempts = store.getIntegrationSyncAttempts({ integration: "tp" });

    expect(failures).toHaveLength(1);
    expect(failures[0].rootCause).toBe("auth");
    expect(tpAttempts).toHaveLength(1);
    expect(tpAttempts[0].integration).toBe("tp");
  });

  it("builds summary metrics and root-cause buckets", () => {
    const store = new RuntimeStore(":memory:");

    store.recordIntegrationSyncAttempt({
      integration: "gmail",
      status: "failure",
      latencyMs: 1100,
      rootCause: "network",
      errorMessage: "network timeout",
      attemptedAt: "2026-02-17T15:00:00.000Z"
    });

    store.recordIntegrationSyncAttempt({
      integration: "gmail",
      status: "success",
      latencyMs: 700,
      rootCause: "none",
      errorMessage: null,
      attemptedAt: "2026-02-17T15:02:00.000Z"
    });

    const summary = store.getIntegrationSyncSummary(24 * 365);
    const gmail = summary.integrations.find((item) => item.integration === "gmail");

    expect(summary.totals.attempts).toBeGreaterThanOrEqual(2);
    expect(gmail).toBeDefined();
    expect(gmail?.attempts).toBe(2);
    expect(gmail?.successes).toBe(1);
    expect(gmail?.failures).toBe(1);
    expect(gmail?.failuresByRootCause.network).toBe(1);
  });
});
