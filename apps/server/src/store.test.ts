import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent, Notification } from "./types.js";

describe("RuntimeStore", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should initialize with 7 agent states", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.agentStates).toHaveLength(7);
    });

    it("should initialize all agents as idle", () => {
      const snapshot = store.getSnapshot();
      snapshot.agentStates.forEach((agent) => {
        expect(agent.status).toBe("idle");
        expect(agent.lastRunAt).toBeNull();
      });
    });

    it("should initialize with empty events array", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.events).toEqual([]);
    });

    it("should initialize with empty notifications array", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toEqual([]);
    });

    it("should initialize with default user context", () => {
      const context = store.getUserContext();
      expect(context).toEqual({
        stressLevel: "medium",
        energyLevel: "medium",
        mode: "balanced"
      });
    });

    it("should initialize with all expected agent names", () => {
      const snapshot = store.getSnapshot();
      const agentNames = snapshot.agentStates.map((a) => a.name);
      
      expect(agentNames).toContain("notes");
      expect(agentNames).toContain("lecture-plan");
      expect(agentNames).toContain("assignment-tracker");
      expect(agentNames).toContain("food-tracking");
      expect(agentNames).toContain("social-highlights");
      expect(agentNames).toContain("video-editor");
      expect(agentNames).toContain("orchestrator");
    });
  });

  describe("markAgentRunning", () => {
    it("should update agent status to running", () => {
      const now = new Date("2026-02-14T12:00:00Z");
      vi.setSystemTime(now);

      store.markAgentRunning("notes");
      const snapshot = store.getSnapshot();
      const notesAgent = snapshot.agentStates.find((a) => a.name === "notes");

      expect(notesAgent?.status).toBe("running");
      expect(notesAgent?.lastRunAt).toBe("2026-02-14T12:00:00.000Z");
    });

    it("should update correct agent without affecting others", () => {
      store.markAgentRunning("lecture-plan");
      const snapshot = store.getSnapshot();

      const lecturePlan = snapshot.agentStates.find((a) => a.name === "lecture-plan");
      const notes = snapshot.agentStates.find((a) => a.name === "notes");

      expect(lecturePlan?.status).toBe("running");
      expect(notes?.status).toBe("idle");
    });
  });

  describe("markAgentError", () => {
    it("should update agent status to error", () => {
      const now = new Date("2026-02-14T12:00:00Z");
      vi.setSystemTime(now);

      store.markAgentError("assignment-tracker");
      const snapshot = store.getSnapshot();
      const agent = snapshot.agentStates.find((a) => a.name === "assignment-tracker");

      expect(agent?.status).toBe("error");
      expect(agent?.lastRunAt).toBe("2026-02-14T12:00:00.000Z");
    });

    it("should update correct agent without affecting others", () => {
      store.markAgentError("orchestrator");
      const snapshot = store.getSnapshot();

      const orchestrator = snapshot.agentStates.find((a) => a.name === "orchestrator");
      const notes = snapshot.agentStates.find((a) => a.name === "notes");

      expect(orchestrator?.status).toBe("error");
      expect(notes?.status).toBe("idle");
    });
  });

  describe("recordEvent", () => {
    it("should record event and update agent to idle", () => {
      const now = new Date("2026-02-14T12:00:00Z");
      vi.setSystemTime(now);

      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "note.created",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: { title: "Test note" }
      };

      store.recordEvent(event);
      const snapshot = store.getSnapshot();

      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toEqual(event);

      const notesAgent = snapshot.agentStates.find((a) => a.name === "notes");
      expect(notesAgent?.status).toBe("idle");
      expect(notesAgent?.lastRunAt).toBe("2026-02-14T12:00:00.000Z");
      expect(notesAgent?.lastEvent).toEqual(event);
    });

    it("should add events to the beginning of the array", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "note.created",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "lecture-plan",
        eventType: "lecture.reminder",
        priority: "high",
        timestamp: "2026-02-14T12:01:00.000Z",
        payload: {}
      };

      store.recordEvent(event1);
      store.recordEvent(event2);

      const snapshot = store.getSnapshot();
      expect(snapshot.events[0]).toEqual(event2);
      expect(snapshot.events[1]).toEqual(event1);
    });

    it("should limit events to 100 items", () => {
      for (let i = 0; i < 150; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "notes",
          eventType: "note.created",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: { index: i }
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(100);
      
      // Most recent event should be first
      const firstEvent = snapshot.events[0];
      expect((firstEvent.payload as any).index).toBe(149);
    });

    it("should handle events from different agents", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "note.created",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: "2026-02-14T12:01:00.000Z",
        payload: {}
      };

      store.recordEvent(event1);
      store.recordEvent(event2);

      const snapshot = store.getSnapshot();
      
      const notesAgent = snapshot.agentStates.find((a) => a.name === "notes");
      const assignmentAgent = snapshot.agentStates.find((a) => a.name === "assignment-tracker");

      expect(notesAgent?.lastEvent).toEqual(event1);
      expect(assignmentAgent?.lastEvent).toEqual(event2);
    });
  });

  describe("pushNotification", () => {
    it("should create notification with id and timestamp", () => {
      const now = new Date("2026-02-14T12:00:00Z");
      vi.setSystemTime(now);

      store.pushNotification({
        title: "Test Notification",
        message: "This is a test",
        priority: "high",
        source: "orchestrator"
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(1);

      const notification = snapshot.notifications[0];
      expect(notification.id).toMatch(/^notif-/);
      expect(notification.timestamp).toBe("2026-02-14T12:00:00.000Z");
      expect(notification.title).toBe("Test Notification");
      expect(notification.message).toBe("This is a test");
      expect(notification.priority).toBe("high");
      expect(notification.source).toBe("orchestrator");
    });

    it("should add notifications to the beginning of the array", () => {
      store.pushNotification({
        title: "First",
        message: "First notification",
        priority: "medium",
        source: "notes"
      });

      store.pushNotification({
        title: "Second",
        message: "Second notification",
        priority: "high",
        source: "orchestrator"
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications[0].title).toBe("Second");
      expect(snapshot.notifications[1].title).toBe("First");
    });

    it("should limit notifications to 40 items", () => {
      for (let i = 0; i < 60; i++) {
        store.pushNotification({
          title: `Notification ${i}`,
          message: `Message ${i}`,
          priority: "medium",
          source: "orchestrator"
        });
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(40);
      
      // Most recent notification should be first
      expect(snapshot.notifications[0].title).toBe("Notification 59");
    });

    it("should generate unique IDs for each notification", () => {
      store.pushNotification({
        title: "Notification 1",
        message: "Message 1",
        priority: "medium",
        source: "notes"
      });

      store.pushNotification({
        title: "Notification 2",
        message: "Message 2",
        priority: "medium",
        source: "notes"
      });

      const snapshot = store.getSnapshot();
      const id1 = snapshot.notifications[0].id;
      const id2 = snapshot.notifications[1].id;

      expect(id1).not.toBe(id2);
    });
  });

  describe("setUserContext", () => {
    it("should update user context and return new context", () => {
      const result = store.setUserContext({ stressLevel: "high" });

      expect(result).toEqual({
        stressLevel: "high",
        energyLevel: "medium",
        mode: "balanced"
      });
    });

    it("should merge partial updates", () => {
      store.setUserContext({ stressLevel: "low" });
      const result = store.setUserContext({ energyLevel: "high" });

      expect(result).toEqual({
        stressLevel: "low",
        energyLevel: "high",
        mode: "balanced"
      });
    });

    it("should update multiple fields at once", () => {
      const result = store.setUserContext({
        stressLevel: "high",
        energyLevel: "low",
        mode: "recovery"
      });

      expect(result).toEqual({
        stressLevel: "high",
        energyLevel: "low",
        mode: "recovery"
      });
    });

    it("should preserve other fields when updating one field", () => {
      store.setUserContext({ mode: "focus" });
      const context = store.getUserContext();

      expect(context.stressLevel).toBe("medium");
      expect(context.energyLevel).toBe("medium");
      expect(context.mode).toBe("focus");
    });
  });

  describe("getUserContext", () => {
    it("should return current user context", () => {
      const context = store.getUserContext();

      expect(context).toEqual({
        stressLevel: "medium",
        energyLevel: "medium",
        mode: "balanced"
      });
    });

    it("should return updated context after changes", () => {
      store.setUserContext({ stressLevel: "high", mode: "focus" });
      const context = store.getUserContext();

      expect(context.stressLevel).toBe("high");
      expect(context.mode).toBe("focus");
    });
  });

  describe("getSnapshot", () => {
    it("should return snapshot with current timestamp", () => {
      const now = new Date("2026-02-14T12:00:00Z");
      vi.setSystemTime(now);

      const snapshot = store.getSnapshot();

      expect(snapshot.generatedAt).toBe("2026-02-14T12:00:00.000Z");
    });

    it("should include all agent states", () => {
      const snapshot = store.getSnapshot();

      expect(snapshot.agentStates).toHaveLength(7);
      expect(snapshot.agentStates.every((a) => a.name && a.status)).toBe(true);
    });

    it("should include all events", () => {
      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "note.created",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      };

      store.recordEvent(event);
      const snapshot = store.getSnapshot();

      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toEqual(event);
    });

    it("should include all notifications", () => {
      store.pushNotification({
        title: "Test",
        message: "Test message",
        priority: "medium",
        source: "orchestrator"
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(1);
    });

    it("should compute summary with focus based on mode", () => {
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

    it("should count pending deadlines from events", () => {
      store.recordEvent({
        id: "evt-1",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      });

      store.recordEvent({
        id: "evt-2",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "critical",
        timestamp: "2026-02-14T12:01:00.000Z",
        payload: {}
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.pendingDeadlines).toBe(2);
    });

    it("should calculate meal compliance based on food nudges", () => {
      // No food nudges = 100% compliance
      let snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(100);

      // 1 food nudge = 92% compliance (100 - 8)
      store.recordEvent({
        id: "evt-1",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      });

      snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(92);

      // 5 food nudges = 60% compliance (100 - 40)
      for (let i = 2; i <= 5; i++) {
        store.recordEvent({
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "medium",
          timestamp: "2026-02-14T12:00:00.000Z",
          payload: {}
        });
      }

      snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(60);

      // Many food nudges = minimum 10% compliance
      for (let i = 6; i <= 20; i++) {
        store.recordEvent({
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "medium",
          timestamp: "2026-02-14T12:00:00.000Z",
          payload: {}
        });
      }

      snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(10);
    });

    it("should detect digest ready from events", () => {
      let snapshot = store.getSnapshot();
      expect(snapshot.summary.digestReady).toBe(false);

      store.recordEvent({
        id: "evt-1",
        source: "video-editor",
        eventType: "video.digest-ready",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      });

      snapshot = store.getSnapshot();
      expect(snapshot.summary.digestReady).toBe(true);
    });

    it("should return independent snapshots", () => {
      const snapshot1 = store.getSnapshot();
      
      store.recordEvent({
        id: "evt-1",
        source: "notes",
        eventType: "note.created",
        priority: "medium",
        timestamp: "2026-02-14T12:00:00.000Z",
        payload: {}
      });

      const snapshot2 = store.getSnapshot();

      expect(snapshot1.events).toHaveLength(0);
      expect(snapshot2.events).toHaveLength(1);
    });
  });
});
