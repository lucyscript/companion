import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { BlackboardClient } from "./blackboard-client.js";
import { BlackboardSyncService } from "./blackboard-sync.js";
import { BlackboardDeadlineBridge } from "./blackboard-deadline-bridge.js";
import {
  BlackboardCourse,
  BlackboardAssignment,
  BlackboardAnnouncement,
  BlackboardData
} from "./types.js";

describe("Blackboard Integration", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("BlackboardClient", () => {
    it("should construct with default config", () => {
      const client = new BlackboardClient();
      expect(client).toBeDefined();
    });

    it("should construct with custom config", () => {
      const client = new BlackboardClient("https://myuni.blackboard.com", "test-token");
      expect(client).toBeDefined();
    });

    it("reports configured state correctly", () => {
      const configured = new BlackboardClient("https://bb.example.com", "token");
      expect(configured.isConfigured()).toBe(true);

      const noToken = new BlackboardClient("https://bb.example.com", undefined);
      expect(noToken.isConfigured()).toBe(false);

      const noUrl = new BlackboardClient("", "token");
      expect(noUrl.isConfigured()).toBe(false);

      const empty = new BlackboardClient();
      expect(empty.isConfigured()).toBe(false);
    });

    it("should throw error when fetching without token", async () => {
      const client = new BlackboardClient("https://bb.example.com", undefined);
      await expect(client.getCourses()).rejects.toThrow("Blackboard API token not configured");
    });
  });

  describe("BlackboardSyncService", () => {
    it("should construct with store", () => {
      const service = new BlackboardSyncService(store, userId);
      expect(service).toBeDefined();
    });

    it("returns not-configured when no credentials stored", async () => {
      const service = new BlackboardSyncService(store, userId);
      const result = await service.triggerSync();
      expect(result.success).toBe(true);
      expect(result.coursesCount).toBe(0);
      expect(result.error).toContain("not configured");
    });

    it("should start and stop cleanly", () => {
      const service = new BlackboardSyncService(store, userId);
      service.start(60 * 60 * 1000); // long interval to avoid actual sync
      service.stop();
    });

    it("reports auto-healing status", () => {
      const service = new BlackboardSyncService(store, userId);
      const status = service.getAutoHealingStatus();
      expect(status).toBeDefined();
      expect(status.integration).toBe("blackboard");
    });
  });

  describe("BlackboardDeadlineBridge", () => {
    let bridge: BlackboardDeadlineBridge;

    beforeEach(() => {
      bridge = new BlackboardDeadlineBridge(store, userId);
    });

    const makeCourse = (id: string, name: string): BlackboardCourse => ({
      id,
      courseId: `COURSE-${id}`,
      name
    });

    const makeAssignment = (
      id: string,
      title: string,
      courseId: string,
      dueDate: string,
      points?: number
    ): BlackboardAssignment => ({
      id,
      title,
      courseId,
      availability: { adaptiveRelease: { end: dueDate } },
      score: points !== undefined ? { possible: points } : undefined
    });

    it("creates deadlines from assignments with due dates", () => {
      const courses = [makeCourse("c1", "DAT520 Distributed Systems")];
      const assignments = [
        makeAssignment("a1", "Lab 1: UDP Echo", "c1", "2026-02-15T23:59:00.000Z", 100)
      ];

      const result = bridge.syncAssignments(courses, assignments);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.createdDeadlines).toHaveLength(1);
      expect(result.createdDeadlines[0].task).toBe("Lab 1: UDP Echo");
      expect(result.createdDeadlines[0].course).toBe("DAT520 Distributed Systems");
      expect(result.createdDeadlines[0].blackboardContentId).toBe("a1");

      const deadlines = store.getDeadlines(userId, new Date(), false);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].blackboardContentId).toBe("a1");
    });

    it("skips assignments without due dates", () => {
      const courses = [makeCourse("c1", "Test")];
      const assignments: BlackboardAssignment[] = [{
        id: "a1",
        title: "No Due Date",
        courseId: "c1"
      }];

      const result = bridge.syncAssignments(courses, assignments);
      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
    });

    it("updates assignments when data changes", () => {
      const courses = [makeCourse("c1", "Test Course")];
      const assignments = [
        makeAssignment("a1", "Lab 1", "c1", "2026-02-15T23:59:00.000Z")
      ];

      bridge.syncAssignments(courses, assignments);

      // Change the title
      const updated = [
        makeAssignment("a1", "Lab 1 (Updated)", "c1", "2026-02-15T23:59:00.000Z")
      ];

      const result = bridge.syncAssignments(courses, updated);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);

      const deadlines = store.getDeadlines(userId, new Date(), false);
      expect(deadlines[0].task).toBe("Lab 1 (Updated)");
    });

    it("removes stale blackboard-linked deadlines", () => {
      const courses = [makeCourse("c1", "Test")];
      const assignments = [
        makeAssignment("a1", "Lab 1", "c1", "2026-02-15T23:59:00.000Z"),
        makeAssignment("a2", "Lab 2", "c1", "2026-03-15T23:59:00.000Z")
      ];

      bridge.syncAssignments(courses, assignments);
      expect(store.getDeadlines(userId, new Date(), false)).toHaveLength(2);

      // Only sync Lab 1 — Lab 2 should be removed
      const remaining = [
        makeAssignment("a1", "Lab 1", "c1", "2026-02-15T23:59:00.000Z")
      ];

      const result = bridge.syncAssignments(courses, remaining);
      expect(result.removed).toBe(1);
      expect(store.getDeadlines(userId, new Date(), false)).toHaveLength(1);
    });

    it("infers priority from score.possible", () => {
      const courses = [makeCourse("c1", "Test")];
      const assignments = [
        makeAssignment("a1", "High", "c1", "2026-02-15T23:59:00.000Z", 150),
        makeAssignment("a2", "Medium", "c1", "2026-03-15T23:59:00.000Z", 60),
        makeAssignment("a3", "Low", "c1", "2026-04-15T23:59:00.000Z", 10)
      ];

      bridge.syncAssignments(courses, assignments);

      const deadlines = store.getDeadlines(userId, new Date(), false);
      const byTask = new Map(deadlines.map((d) => [d.task, d]));

      expect(byTask.get("High")!.priority).toBe("high");
      expect(byTask.get("Medium")!.priority).toBe("medium");
      expect(byTask.get("Low")!.priority).toBe("low");
    });

    it("does not touch non-blackboard deadlines", () => {
      // Manually create a non-Blackboard deadline
      store.createDeadline(userId, {
        course: "Manual",
        task: "Do homework",
        dueDate: "2026-05-01T23:59:00.000Z",
        priority: "medium",
        completed: false
      });

      const courses = [makeCourse("c1", "Test")];
      const assignments = [
        makeAssignment("a1", "BB Lab", "c1", "2026-02-15T23:59:00.000Z")
      ];

      bridge.syncAssignments(courses, assignments);

      const deadlines = store.getDeadlines(userId, new Date(), false);
      expect(deadlines).toHaveLength(2);
    });
  });

  describe("Store: Blackboard Data CRUD", () => {
    it("stores and retrieves Blackboard data", () => {
      const data: BlackboardData = {
        courses: [{ id: "c1", courseId: "CS101", name: "Intro to CS" }],
        assignments: [{ id: "a1", title: "Lab 1" }],
        announcements: [{ id: "ann1", title: "Welcome", body: "Hello", created: "2026-01-01T00:00:00Z" }],
        lastSyncedAt: "2026-01-01T12:00:00Z"
      };

      store.setBlackboardData(userId, data);
      const retrieved = store.getBlackboardData(userId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.courses).toHaveLength(1);
      expect(retrieved!.courses[0].name).toBe("Intro to CS");
      expect(retrieved!.assignments).toHaveLength(1);
      expect(retrieved!.announcements).toHaveLength(1);
      expect(retrieved!.lastSyncedAt).toBe("2026-01-01T12:00:00Z");
    });

    it("returns null when no data", () => {
      expect(store.getBlackboardData(userId)).toBeNull();
    });

    it("clears Blackboard data", () => {
      store.setBlackboardData(userId, {
        courses: [],
        assignments: [],
        announcements: [],
        lastSyncedAt: null
      });
      expect(store.getBlackboardData(userId)).not.toBeNull();

      store.clearBlackboardData(userId);
      expect(store.getBlackboardData(userId)).toBeNull();
    });

    it("overwrites on subsequent set", () => {
      store.setBlackboardData(userId, {
        courses: [{ id: "c1", courseId: "CS101", name: "Old" }],
        assignments: [],
        announcements: [],
        lastSyncedAt: null
      });

      store.setBlackboardData(userId, {
        courses: [{ id: "c1", courseId: "CS101", name: "New" }],
        assignments: [],
        announcements: [],
        lastSyncedAt: "2026-02-01T00:00:00Z"
      });

      const retrieved = store.getBlackboardData(userId);
      expect(retrieved!.courses[0].name).toBe("New");
      expect(retrieved!.lastSyncedAt).toBe("2026-02-01T00:00:00Z");
    });
  });
});
