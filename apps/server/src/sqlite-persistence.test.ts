import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRuntimeStorePersistence } from "./sqlite-persistence.js";
import { RuntimeStoreStateSnapshot } from "./store.js";

describe("SqliteRuntimeStorePersistence", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves and loads runtime snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-sqlite-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "runtime.sqlite");

    const persistence = new SqliteRuntimeStorePersistence(dbPath);
    expect(persistence.load()).toBeNull();

    const snapshot: RuntimeStoreStateSnapshot = {
      events: [],
      notifications: [],
      journalEntries: [],
      scheduleEvents: [],
      deadlines: [],
      deadlineReminderState: {},
      pushSubscriptions: [],
      pushDeliveryMetricsBase: {
        attempted: 1,
        delivered: 1,
        failed: 0,
        droppedSubscriptions: 0,
        totalRetries: 0
      },
      pushDeliveryFailures: [],
      agentStates: [
        { name: "notes", status: "idle", lastRunAt: null },
        { name: "lecture-plan", status: "idle", lastRunAt: null },
        { name: "assignment-tracker", status: "idle", lastRunAt: null },
        { name: "orchestrator", status: "idle", lastRunAt: null }
      ],
      userContext: {
        stressLevel: "medium",
        energyLevel: "high",
        mode: "focus"
      },
      notificationPreferences: {
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
      }
    };

    persistence.save(snapshot);
    persistence.close();

    const reloadedPersistence = new SqliteRuntimeStorePersistence(dbPath);
    const loaded = reloadedPersistence.load();
    reloadedPersistence.close();

    expect(loaded).not.toBeNull();
    expect(loaded?.userContext.mode).toBe("focus");
    expect(loaded?.pushDeliveryMetricsBase.attempted).toBe(1);
  });
});
