import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

describe("RuntimeStore - Snapshot Details", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getSnapshot", () => {
    it("should include generated timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      const snapshot = store.getSnapshot();

      expect(snapshot.generatedAt).toBe(now.toISOString());
    });

    it("should calculate todayFocus based on mode", () => {
      store.setUserContext({ mode: "focus" });
      let snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Deep work + assignment completion");

      store.setUserContext({ mode: "recovery" });
      snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Light planning + recovery tasks");

      store.setUserContext({ mode: "balanced" });
      snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
    });

    it("should count pending deadlines", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      const event3: AgentEvent = {
        id: "evt-3",
        source: "notes",
        eventType: "note.created",
        priority: "low",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event1);
      store.recordEvent(event2);
      store.recordEvent(event3);

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.pendingDeadlines).toBe(2);
    });

    it("should calculate meal compliance based on food nudges", () => {
      const snapshot1 = store.getSnapshot();
      expect(snapshot1.summary.mealCompliance).toBe(100);

      const event1: AgentEvent = {
        id: "evt-1",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event1);
      const snapshot2 = store.getSnapshot();
      expect(snapshot2.summary.mealCompliance).toBe(92);

      const event2: AgentEvent = {
        id: "evt-2",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event2);
      const snapshot3 = store.getSnapshot();
      expect(snapshot3.summary.mealCompliance).toBe(84);
    });

    it("should have minimum meal compliance of 10", () => {
      for (let i = 0; i < 20; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: {}
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(10);
    });

    it("should detect if digest is ready", () => {
      const snapshot1 = store.getSnapshot();
      expect(snapshot1.summary.digestReady).toBe(false);

      const event: AgentEvent = {
        id: "evt-1",
        source: "video-editor",
        eventType: "video.digest-ready",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event);

      const snapshot2 = store.getSnapshot();
      expect(snapshot2.summary.digestReady).toBe(true);
    });

    it("should include all agent states", () => {
      const snapshot = store.getSnapshot();

      const expectedAgents = [
        "notes",
        "lecture-plan",
        "assignment-tracker",
        "orchestrator"
      ];

      expect(snapshot.agentStates.map((s) => s.name)).toEqual(expectedAgents);
    });
  });
});
