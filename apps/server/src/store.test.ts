import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent, AgentName, UserContext } from "./types.js";

describe("RuntimeStore", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("agent state management", () => {
    it("should initialize with all agents in idle state", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.agentStates).toHaveLength(7);
      snapshot.agentStates.forEach((state) => {
        expect(state.status).toBe("idle");
        expect(state.lastRunAt).toBeNull();
      });
    });

    it("should mark agent as running", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentRunning("notes");

      const snapshot = store.getSnapshot();
      const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

      expect(notesAgent?.status).toBe("running");
      expect(notesAgent?.lastRunAt).toBe(now.toISOString());
    });

    it("should mark agent as error", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentError("orchestrator");

      const snapshot = store.getSnapshot();
      const orchestratorAgent = snapshot.agentStates.find((s) => s.name === "orchestrator");

      expect(orchestratorAgent?.status).toBe("error");
      expect(orchestratorAgent?.lastRunAt).toBe(now.toISOString());
    });

    it("should handle multiple agent state changes", () => {
      store.markAgentRunning("notes");
      store.markAgentRunning("lecture-plan");
      store.markAgentError("video-editor");

      const snapshot = store.getSnapshot();

      const notes = snapshot.agentStates.find((s) => s.name === "notes");
      const lecturePlan = snapshot.agentStates.find((s) => s.name === "lecture-plan");
      const videoEditor = snapshot.agentStates.find((s) => s.name === "video-editor");

      expect(notes?.status).toBe("running");
      expect(lecturePlan?.status).toBe("running");
      expect(videoEditor?.status).toBe("error");
    });
  });

  describe("event recording", () => {
    it("should record an event", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: now.toISOString(),
        payload: { test: "data" },
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toEqual(event);
    });

    it("should update agent status to idle after recording event", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentRunning("notes");

      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: now.toISOString(),
        payload: {},
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

      expect(notesAgent?.status).toBe("idle");
      expect(notesAgent?.lastEvent).toEqual(event);
    });

    it("should keep events in reverse chronological order", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: "2024-01-15T10:00:00Z",
        payload: {},
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "lecture-plan",
        eventType: "food.nudge",
        priority: "low",
        timestamp: "2024-01-15T11:00:00Z",
        payload: {},
      };

      store.recordEvent(event1);
      store.recordEvent(event2);

      const snapshot = store.getSnapshot();
      expect(snapshot.events[0]).toEqual(event2);
      expect(snapshot.events[1]).toEqual(event1);
    });

    it("should limit events to maximum of 100", () => {
      for (let i = 0; i < 150; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "notes",
          eventType: "assignment.deadline",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: {},
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(100);
      expect(snapshot.events[0].id).toBe("evt-149");
      expect(snapshot.events[99].id).toBe("evt-50");
    });
  });

  describe("notification system", () => {
    it("should push a notification with generated id and timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.pushNotification({
        priority: "low",
        source: "notes",
        title: "Test Notification",
        message: "Test message",
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(1);
      expect(snapshot.notifications[0].title).toBe("Test Notification");
      expect(snapshot.notifications[0].message).toBe("Test message");
      expect(snapshot.notifications[0].priority).toBe("low");
      expect(snapshot.notifications[0].source).toBe("notes");
      expect(snapshot.notifications[0].id).toMatch(/^notif-/);
      expect(snapshot.notifications[0].timestamp).toBe(now.toISOString());
    });

    it("should keep notifications in reverse chronological order", () => {
      vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
      store.pushNotification({
        priority: "low",
        source: "notes",
        title: "First",
        message: "Message 1",
      });

      vi.setSystemTime(new Date("2024-01-15T11:00:00Z"));
      store.pushNotification({
        priority: "high",
        source: "orchestrator",
        title: "Second",
        message: "Message 2",
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications[0].title).toBe("Second");
      expect(snapshot.notifications[1].title).toBe("First");
    });

    it("should limit notifications to maximum of 40", () => {
      for (let i = 0; i < 60; i++) {
        store.pushNotification({
          priority: "low",
          source: "notes",
          title: `Notification ${i}`,
          message: `Message ${i}`,
        });
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(40);
      expect(snapshot.notifications[0].title).toBe("Notification 59");
      expect(snapshot.notifications[39].title).toBe("Notification 20");
    });
  });

  describe("user context", () => {
    it("should return default user context", () => {
      const context = store.getUserContext();
      expect(context).toEqual({
        stressLevel: "medium",
        energyLevel: "medium",
        mode: "balanced",
      });
    });

    it("should update user context partially", () => {
      store.setUserContext({ stressLevel: "high" });

      const context = store.getUserContext();
      expect(context).toEqual({
        stressLevel: "high",
        energyLevel: "medium",
        mode: "balanced",
      });
    });

    it("should update multiple fields", () => {
      store.setUserContext({
        stressLevel: "low",
        energyLevel: "high",
        mode: "focus",
      });

      const context = store.getUserContext();
      expect(context).toEqual({
        stressLevel: "low",
        energyLevel: "high",
        mode: "focus",
      });
    });

    it("should return updated context from setUserContext", () => {
      const updated = store.setUserContext({ mode: "recovery" });
      expect(updated.mode).toBe("recovery");
      expect(updated.stressLevel).toBe("medium");
      expect(updated.energyLevel).toBe("medium");
    });

    it("should preserve context across multiple updates", () => {
      store.setUserContext({ stressLevel: "high" });
      store.setUserContext({ energyLevel: "low" });
      store.setUserContext({ mode: "recovery" });

      const context = store.getUserContext();
      expect(context).toEqual({
        stressLevel: "high",
        energyLevel: "low",
        mode: "recovery",
      });
    });
  });

  describe("snapshot generation", () => {
    it("should generate a snapshot with current timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      const snapshot = store.getSnapshot();
      expect(snapshot.generatedAt).toBe(now.toISOString());
    });

    it("should include agent states in snapshot", () => {
      store.markAgentRunning("notes");

      const snapshot = store.getSnapshot();
      expect(snapshot.agentStates).toHaveLength(7);

      const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");
      expect(notesAgent?.status).toBe("running");
    });

    it("should include events and notifications in snapshot", () => {
      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      store.recordEvent(event);
      store.pushNotification({
        priority: "low",
        source: "notes",
        title: "Test",
        message: "Test",
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.notifications).toHaveLength(1);
    });

    it("should calculate pending deadlines from assignment events", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "critical",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      store.recordEvent(event1);
      store.recordEvent(event2);

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.pendingDeadlines).toBe(2);
    });

    it("should calculate meal compliance from food nudge events", () => {
      // No food events = 100% compliance
      let snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(100);

      // 1 food nudge = 92% compliance (100 - 8)
      const event1: AgentEvent = {
        id: "evt-1",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "low",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event1);

      snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(92);

      // Multiple food nudges
      for (let i = 2; i <= 5; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "low",
          timestamp: new Date().toISOString(),
          payload: {},
        };
        store.recordEvent(event);
      }

      snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(60); // 100 - (5 * 8)
    });

    it("should ensure meal compliance has a floor of 10", () => {
      // Add many food nudges to test floor
      for (let i = 0; i < 20; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "low",
          timestamp: new Date().toISOString(),
          payload: {},
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(10);
    });

    it("should detect when video digest is ready", () => {
      const event: AgentEvent = {
        id: "evt-1",
        source: "video-editor",
        eventType: "video.digest-ready",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.digestReady).toBe(true);
    });

    it("should return false for digestReady when no video events", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.summary.digestReady).toBe(false);
    });

    describe("todayFocus computation", () => {
      it("should return focus mode message when mode is focus", () => {
        store.setUserContext({ mode: "focus" });

        const snapshot = store.getSnapshot();
        expect(snapshot.summary.todayFocus).toBe("Deep work + assignment completion");
      });

      it("should return recovery mode message when mode is recovery", () => {
        store.setUserContext({ mode: "recovery" });

        const snapshot = store.getSnapshot();
        expect(snapshot.summary.todayFocus).toBe("Light planning + recovery tasks");
      });

      it("should return balanced mode message when mode is balanced", () => {
        store.setUserContext({ mode: "balanced" });

        const snapshot = store.getSnapshot();
        expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
      });

      it("should default to balanced message for default context", () => {
        const snapshot = store.getSnapshot();
        expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
      });
    });
  });

  describe("edge cases", () => {
    it("should handle recording events for all agent types", () => {
      const agentNames: AgentName[] = [
        "notes",
        "lecture-plan",
        "assignment-tracker",
        "food-tracking",
        "social-highlights",
        "video-editor",
        "orchestrator",
      ];

      agentNames.forEach((name, index) => {
        const event: AgentEvent = {
          id: `evt-${index}`,
          source: name,
          eventType: "assignment.deadline",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: {},
        };
        store.recordEvent(event);
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(7);
    });

    it("should handle empty payload in events", () => {
      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      expect(snapshot.events[0].payload).toEqual({});
    });

    it("should handle complex payload in events", () => {
      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {
          nested: { data: "value" },
          array: [1, 2, 3],
          boolean: true,
        },
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      expect(snapshot.events[0].payload).toEqual(event.payload);
    });
  });
});
