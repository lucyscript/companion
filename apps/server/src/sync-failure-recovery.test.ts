import { describe, expect, it } from "vitest";
import { SyncFailureRecoveryTracker } from "./sync-failure-recovery.js";

describe("SyncFailureRecoveryTracker", () => {
  it("emits actionable prompt after repeated failures when no recent successful sync exists", () => {
    const tracker = new SyncFailureRecoveryTracker();

    expect(tracker.recordFailure("gmail", "Gmail not connected", "2026-02-17T10:00:00.000Z")).toBeNull();
    const prompt = tracker.recordFailure("gmail", "Gmail not connected", "2026-02-17T10:05:00.000Z");

    expect(prompt).not.toBeNull();
    expect(prompt?.integration).toBe("gmail");
    expect(prompt?.failureCount).toBe(2);
    expect(prompt?.rootCauseHint.toLowerCase()).toContain("not connected");
    expect(prompt?.suggestedActions.length).toBeGreaterThan(1);
  });

  it("waits until third failure when recent sync success is still fresh", () => {
    const tracker = new SyncFailureRecoveryTracker();
    tracker.recordSuccess("canvas", "2026-02-17T09:00:00.000Z");

    expect(tracker.recordFailure("canvas", "401 unauthorized", "2026-02-17T09:10:00.000Z")).toBeNull();
    expect(tracker.recordFailure("canvas", "401 unauthorized", "2026-02-17T09:20:00.000Z")).toBeNull();
    const prompt = tracker.recordFailure("canvas", "401 unauthorized", "2026-02-17T09:30:00.000Z");

    expect(prompt).not.toBeNull();
    expect(prompt?.integration).toBe("canvas");
    expect(prompt?.failureCount).toBe(3);
    expect(prompt?.rootCauseHint.toLowerCase()).toContain("authentication");
  });

  it("clears failure counters after success", () => {
    const tracker = new SyncFailureRecoveryTracker();

    tracker.recordFailure("tp", "network timeout", "2026-02-17T10:00:00.000Z");
    tracker.recordFailure("tp", "network timeout", "2026-02-17T10:10:00.000Z");
    tracker.recordSuccess("tp", "2026-02-17T10:15:00.000Z");

    const snapshot = tracker.getSnapshot(new Date("2026-02-17T10:16:00.000Z"));
    const tpHealth = snapshot.integrations.find((item) => item.integration === "tp");

    expect(tpHealth?.consecutiveFailures).toBe(0);
    expect(tpHealth?.lastError).toBeNull();
    expect(snapshot.prompts.find((prompt) => prompt.integration === "tp")).toBeUndefined();
  });
});
