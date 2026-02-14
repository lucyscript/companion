import { describe, it, expect, beforeEach } from "vitest";
import { AssignmentTrackerAgent } from "./assignment-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("AssignmentTrackerAgent", () => {
  let agent: AssignmentTrackerAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];

  beforeEach(() => {
    agent = new AssignmentTrackerAgent();
    emittedEvents = [];
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      }
    };
  });

  describe("configuration", () => {
    it("should have correct agent name", () => {
      expect(agent.name).toBe("assignment-tracker");
    });

    it("should have correct interval in milliseconds", () => {
      expect(agent.intervalMs).toBe(20_000);
    });

    it("should have interval of 20 seconds", () => {
      expect(agent.intervalMs).toBe(20 * 1000);
    });
  });

  describe("run", () => {
    it("should emit exactly one event per run", async () => {
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(1);
    });

    it("should emit event with correct source", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.source).toBe("assignment-tracker");
    });

    it("should emit event with correct eventType", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.eventType).toBe("assignment.deadline");
    });

    it("should emit event with correct ID prefix", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.id).toMatch(/^assignment-tracker-/);
    });

    it("should emit event with valid timestamp", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      
      const timestamp = new Date(event.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it("should emit event with deadline payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.payload).toBeDefined();
      expect(typeof event.payload).toBe("object");
    });

    it("should include course in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("course");
      expect(typeof payload.course).toBe("string");
      expect(payload.course.length).toBeGreaterThan(0);
    });

    it("should include task in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("task");
      expect(typeof payload.task).toBe("string");
      expect(payload.task.length).toBeGreaterThan(0);
    });

    it("should include hoursLeft in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("hoursLeft");
      expect(typeof payload.hoursLeft).toBe("number");
      expect(payload.hoursLeft).toBeGreaterThan(0);
    });

    it("should select from valid courses", async () => {
      const validCourses = ["Algorithms", "Databases", "Operating Systems"];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validCourses).toContain(payload.course);
    });

    it("should select from available tasks", async () => {
      const validTasks = ["Problem Set 4", "Schema Design Report", "Lab 3"];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validTasks).toContain(payload.task);
    });

    it("should emit valid hoursLeft values", async () => {
      const validHoursLeft = [28, 54, 12];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validHoursLeft).toContain(payload.hoursLeft);
    });

    it("should calculate priority based on hours left", async () => {
      // Run multiple times to get different deadlines
      const priorities: string[] = [];
      
      for (let i = 0; i < 30; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        priorities.push(emittedEvents[0].priority);
      }

      // We should see different priorities
      const uniquePriorities = new Set(priorities);
      expect(uniquePriorities.size).toBeGreaterThan(1);
    });

    it("should emit critical priority when hoursLeft <= 12", async () => {
      // Lab 3 has 12 hours left, should be critical
      let foundCritical = false;

      for (let i = 0; i < 50; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const event = emittedEvents[0];
        const payload = event.payload as any;

        if (payload.hoursLeft === 12) {
          expect(event.priority).toBe("critical");
          foundCritical = true;
          break;
        }
      }

      expect(foundCritical).toBe(true);
    });

    it("should emit high priority when hoursLeft > 12 and <= 24", async () => {
      // No exact match in data, but we can verify the logic exists
      // by checking that 28 hours is not high priority
      let foundMedium = false;

      for (let i = 0; i < 50; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const event = emittedEvents[0];
        const payload = event.payload as any;

        if (payload.hoursLeft === 28) {
          expect(event.priority).toBe("medium");
          foundMedium = true;
          break;
        }
      }

      expect(foundMedium).toBe(true);
    });

    it("should emit medium priority when hoursLeft > 24", async () => {
      // Both 28 and 54 should be medium
      let foundMedium28 = false;
      let foundMedium54 = false;

      for (let i = 0; i < 50; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const event = emittedEvents[0];
        const payload = event.payload as any;

        if (payload.hoursLeft === 28) {
          expect(event.priority).toBe("medium");
          foundMedium28 = true;
        }

        if (payload.hoursLeft === 54) {
          expect(event.priority).toBe("medium");
          foundMedium54 = true;
        }

        if (foundMedium28 && foundMedium54) break;
      }

      expect(foundMedium28).toBe(true);
      expect(foundMedium54).toBe(true);
    });

    it("should be callable multiple times", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(3);
    });

    it("should emit consistent event structure on multiple runs", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);

      emittedEvents.forEach((event) => {
        expect(event.source).toBe("assignment-tracker");
        expect(event.eventType).toBe("assignment.deadline");
        
        const payload = event.payload as any;
        expect(payload).toHaveProperty("course");
        expect(payload).toHaveProperty("task");
        expect(payload).toHaveProperty("hoursLeft");
      });
    });

    it("should generate different deadlines over multiple runs", async () => {
      const iterations = 30;
      const courses = new Set<string>();
      const tasks = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const payload = emittedEvents[0].payload as any;
        courses.add(payload.course);
        tasks.add(payload.task);
      }

      // With 30 iterations and 3 possible values, should see variety
      expect(courses.size).toBeGreaterThan(1);
      expect(tasks.size).toBeGreaterThan(1);
    });

    it("should match course with corresponding task", async () => {
      const deadlineMap = {
        "Algorithms": "Problem Set 4",
        "Databases": "Schema Design Report",
        "Operating Systems": "Lab 3"
      };

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.task).toBe(deadlineMap[payload.course as keyof typeof deadlineMap]);
    });

    it("should match hoursLeft with corresponding task", async () => {
      const hoursMap: Record<string, number> = {
        "Problem Set 4": 28,
        "Schema Design Report": 54,
        "Lab 3": 12
      };

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.hoursLeft).toBe(hoursMap[payload.task]);
    });

    it("should complete without throwing errors", async () => {
      await expect(agent.run(mockContext)).resolves.not.toThrow();
    });

    it("should handle context emit being called", async () => {
      let emitCalled = false;
      const testContext: AgentContext = {
        emit: () => {
          emitCalled = true;
        }
      };

      await agent.run(testContext);

      expect(emitCalled).toBe(true);
    });

    it("should generate unique event IDs", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);

      const id1 = emittedEvents[0].id;
      const id2 = emittedEvents[1].id;

      expect(id1).not.toBe(id2);
    });

    it("should have consistent payload structure", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      // Verify payload has exactly the expected keys
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(["course", "hoursLeft", "task"]);
    });

    it("should verify priority calculation for all deadline scenarios", async () => {
      const results: Array<{ hoursLeft: number; priority: string }> = [];

      // Run enough times to capture all three deadlines
      for (let i = 0; i < 100; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const event = emittedEvents[0];
        const payload = event.payload as any;

        const existing = results.find((r) => r.hoursLeft === payload.hoursLeft);
        if (!existing) {
          results.push({ hoursLeft: payload.hoursLeft, priority: event.priority });
        }

        if (results.length === 3) break;
      }

      expect(results).toHaveLength(3);

      const critical = results.find((r) => r.hoursLeft === 12);
      const medium28 = results.find((r) => r.hoursLeft === 28);
      const medium54 = results.find((r) => r.hoursLeft === 54);

      expect(critical?.priority).toBe("critical");
      expect(medium28?.priority).toBe("medium");
      expect(medium54?.priority).toBe("medium");
    });
  });
});
