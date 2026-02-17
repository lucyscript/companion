import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { RuntimeStore } from "./store.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import type { Notification } from "./types.js";

describe("orchestrator digest batching", () => {
  let store: RuntimeStore;
  let runtime: OrchestratorRuntime;
  const testDbPath = "test-orchestrator-digest.db";

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new RuntimeStore(testDbPath);
    runtime = new OrchestratorRuntime(store);
  });

  afterEach(() => {
    runtime.stop();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("batches due low/medium scheduled notifications into one digest notification", () => {
    const received: Notification[] = [];
    const unsubscribe = store.onNotification((notification) => received.push(notification));

    const now = new Date(Date.now() - 1000);
    store.scheduleNotification(
      {
        source: "assignment-tracker",
        title: "Deadline alert",
        message: "Task A",
        priority: "medium"
      },
      now
    );
    store.scheduleNotification(
      {
        source: "notes",
        title: "Journal prompt",
        message: "Task B",
        priority: "low"
      },
      now
    );

    (runtime as unknown as { processScheduledNotifications: () => void }).processScheduledNotifications();

    const digest = received.find((notification) => notification.title.toLowerCase().includes("digest"));
    expect(digest).toBeDefined();
    expect(digest?.source).toBe("orchestrator");
    expect(digest?.message).toContain("2 non-urgent updates");
    expect(store.getDueScheduledNotifications()).toHaveLength(0);

    unsubscribe();
  });

  it("delivers high-priority scheduled notifications immediately (no batching)", () => {
    const received: Notification[] = [];
    const unsubscribe = store.onNotification((notification) => received.push(notification));

    store.scheduleNotification(
      {
        source: "assignment-tracker",
        title: "Urgent deadline",
        message: "Task C",
        priority: "high"
      },
      new Date(Date.now() - 1000)
    );

    (runtime as unknown as { processScheduledNotifications: () => void }).processScheduledNotifications();

    expect(received.some((notification) => notification.title === "Urgent deadline")).toBe(true);
    expect(received.some((notification) => notification.title.toLowerCase().includes("digest"))).toBe(false);
    expect(store.getDueScheduledNotifications()).toHaveLength(0);

    unsubscribe();
  });
});
