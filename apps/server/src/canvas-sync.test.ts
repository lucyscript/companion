import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CanvasSyncService } from "./canvas-sync.js";
import { RuntimeStore } from "./store.js";
import { unlinkSync } from "fs";

describe("CanvasSyncService", () => {
  let store: RuntimeStore;
  let service: CanvasSyncService;
  const testDbPath = "test-canvas-sync.db";

  beforeEach(() => {
    store = new RuntimeStore(testDbPath);
    service = new CanvasSyncService(store, 1); // 1 minute interval for tests
  });

  afterEach(() => {
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore if file doesn't exist
    }
  });

  describe("store integration", () => {
    it("should store and retrieve Canvas courses", () => {
      const courses = [
        {
          id: 1,
          name: "DAT520 Distributed Systems",
          courseCode: "DAT520",
          enrollmentTermId: 100,
          startAt: "2026-01-01T00:00:00Z",
          endAt: "2026-06-01T00:00:00Z",
          workflowState: "available"
        },
        {
          id: 2,
          name: "DAT560 Generative AI",
          courseCode: "DAT560",
          startAt: null,
          endAt: null,
          workflowState: "available"
        }
      ];

      store.storeCanvasCourses(courses);
      const retrieved = store.getCanvasCourses();

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]?.name).toBe("DAT520 Distributed Systems");
      expect(retrieved[1]?.name).toBe("DAT560 Generative AI");
    });

    it("should store and retrieve Canvas assignments", () => {
      const courses = [
        {
          id: 1,
          name: "Test Course",
          courseCode: "TEST101",
          startAt: null,
          endAt: null,
          workflowState: "available"
        }
      ];
      store.storeCanvasCourses(courses);

      const assignments = [
        {
          id: 101,
          courseId: 1,
          name: "Assignment 1",
          description: "Test assignment",
          dueAt: "2026-02-20T23:59:00Z",
          pointsPossible: 100,
          submissionTypes: ["online_text_entry"],
          hasSubmittedSubmissions: false,
          workflowState: "published",
          htmlUrl: "https://canvas.test/courses/1/assignments/101"
        }
      ];

      store.storeCanvasAssignments(assignments);
      const retrieved = store.getCanvasAssignments();

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]?.name).toBe("Assignment 1");
      expect(retrieved[0]?.pointsPossible).toBe(100);
      expect(retrieved[0]?.hasSubmittedSubmissions).toBe(false);
    });

    it("should store and retrieve Canvas modules", () => {
      const courses = [
        {
          id: 1,
          name: "Test Course",
          courseCode: "TEST101",
          startAt: null,
          endAt: null,
          workflowState: "available"
        }
      ];
      store.storeCanvasCourses(courses);

      const modules = [
        {
          id: 201,
          courseId: 1,
          name: "Module 1: Introduction",
          position: 1,
          unlockAt: null,
          requireSequentialProgress: false,
          state: "unlocked"
        },
        {
          id: 202,
          courseId: 1,
          name: "Module 2: Advanced Topics",
          position: 2,
          unlockAt: "2026-03-01T00:00:00Z",
          requireSequentialProgress: true,
          state: "locked"
        }
      ];

      store.storeCanvasModules(modules);
      const retrieved = store.getCanvasModules();

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]?.name).toBe("Module 1: Introduction");
      expect(retrieved[1]?.requireSequentialProgress).toBe(true);
    });

    it("should store and retrieve Canvas announcements", () => {
      const courses = [
        {
          id: 1,
          name: "Test Course",
          courseCode: "TEST101",
          startAt: null,
          endAt: null,
          workflowState: "available"
        }
      ];
      store.storeCanvasCourses(courses);

      const announcements = [
        {
          id: 301,
          courseId: 1,
          title: "Welcome to the course!",
          message: "Looking forward to working with you all.",
          postedAt: "2026-01-15T10:00:00Z",
          author: {
            displayName: "Professor Smith"
          }
        }
      ];

      store.storeCanvasAnnouncements(announcements);
      const retrieved = store.getCanvasAnnouncements();

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]?.title).toBe("Welcome to the course!");
      expect(retrieved[0]?.author?.displayName).toBe("Professor Smith");
    });

    it("should filter assignments by course", () => {
      const courses = [
        {
          id: 1,
          name: "Course 1",
          courseCode: "C1",
          startAt: null,
          endAt: null,
          workflowState: "available"
        },
        {
          id: 2,
          name: "Course 2",
          courseCode: "C2",
          startAt: null,
          endAt: null,
          workflowState: "available"
        }
      ];
      store.storeCanvasCourses(courses);

      const assignments = [
        {
          id: 101,
          courseId: 1,
          name: "Assignment C1-1",
          description: null,
          dueAt: null,
          pointsPossible: 10,
          submissionTypes: ["online"],
          hasSubmittedSubmissions: false,
          workflowState: "published",
          htmlUrl: "https://canvas.test/1/101"
        },
        {
          id: 102,
          courseId: 2,
          name: "Assignment C2-1",
          description: null,
          dueAt: null,
          pointsPossible: 20,
          submissionTypes: ["online"],
          hasSubmittedSubmissions: false,
          workflowState: "published",
          htmlUrl: "https://canvas.test/2/102"
        }
      ];

      store.storeCanvasAssignments(assignments);
      const course1Assignments = store.getCanvasAssignmentsByCourse(1);

      expect(course1Assignments).toHaveLength(1);
      expect(course1Assignments[0]?.name).toBe("Assignment C1-1");
    });

    it("should track Canvas sync status", () => {
      const status1 = store.getCanvasSyncStatus();
      expect(status1.syncing).toBe(false);
      expect(status1.coursesCount).toBe(0);

      store.updateCanvasSyncStatus({
        syncing: true,
        lastSyncAt: "2026-02-16T12:00:00Z"
      });

      const status2 = store.getCanvasSyncStatus();
      expect(status2.syncing).toBe(true);
      expect(status2.lastSyncAt).toBe("2026-02-16T12:00:00Z");
    });

    it("should handle sync errors in status", () => {
      store.updateCanvasSyncStatus({
        errors: ["Network timeout", "Course 5 not found"]
      });

      const status = store.getCanvasSyncStatus();
      expect(status.errors).toHaveLength(2);
      expect(status.errors[0]).toBe("Network timeout");
    });
  });

  describe("service lifecycle", () => {
    it("should start and stop service", () => {
      service.start();
      service.stop();
      // Should not throw
      expect(true).toBe(true);
    });

    it("should handle multiple start calls gracefully", () => {
      service.start();
      service.start();
      service.stop();
      expect(true).toBe(true);
    });
  });
});
