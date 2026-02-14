import { describe, it, expect, beforeEach } from "vitest";
import { SocialHighlightsAgent } from "./social-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("SocialHighlightsAgent", () => {
  let agent: SocialHighlightsAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];

  beforeEach(() => {
    agent = new SocialHighlightsAgent();
    emittedEvents = [];
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      }
    };
  });

  describe("configuration", () => {
    it("should have correct agent name", () => {
      expect(agent.name).toBe("social-highlights");
    });

    it("should have correct interval in milliseconds", () => {
      expect(agent.intervalMs).toBe(25_000);
    });

    it("should have interval of 25 seconds", () => {
      expect(agent.intervalMs).toBe(25 * 1000);
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
      expect(event.source).toBe("social-highlights");
    });

    it("should emit event with correct eventType", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.eventType).toBe("social.highlight");
    });

    it("should emit event with correct ID prefix", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.id).toMatch(/^social-highlights-/);
    });

    it("should emit event with medium priority", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("medium");
    });

    it("should emit event with valid timestamp", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      
      const timestamp = new Date(event.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it("should emit event with social media payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.payload).toBeDefined();
      expect(typeof event.payload).toBe("object");
    });

    it("should include platform in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("platform");
      expect(typeof payload.platform).toBe("string");
    });

    it("should include title in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("title");
      expect(typeof payload.title).toBe("string");
      expect(payload.title.length).toBeGreaterThan(0);
    });

    it("should include relevance score in payload", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("relevance");
      expect(typeof payload.relevance).toBe("number");
    });

    it("should emit relevance score between 0 and 1", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.relevance).toBeGreaterThan(0);
      expect(payload.relevance).toBeLessThanOrEqual(1);
    });

    it("should select from valid platforms", async () => {
      const validPlatforms = ["YouTube", "Reddit", "X"];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validPlatforms).toContain(payload.platform);
    });

    it("should select from available topics", async () => {
      const validTopics = [
        "AI tooling workflow update",
        "Best study systems for CS students",
        "Productivity thread with strong signal"
      ];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validTopics).toContain(payload.title);
    });

    it("should emit valid relevance scores", async () => {
      const validRelevances = [0.86, 0.79, 0.73];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validRelevances).toContain(payload.relevance);
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
        expect(event.source).toBe("social-highlights");
        expect(event.eventType).toBe("social.highlight");
        expect(event.priority).toBe("medium");
        
        const payload = event.payload as any;
        expect(payload).toHaveProperty("platform");
        expect(payload).toHaveProperty("title");
        expect(payload).toHaveProperty("relevance");
      });
    });

    it("should generate different topics over multiple runs", async () => {
      const iterations = 30;
      const platforms = new Set<string>();
      const titles = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const payload = emittedEvents[0].payload as any;
        platforms.add(payload.platform);
        titles.add(payload.title);
      }

      // With 30 iterations and 3 possible values, should see variety
      expect(platforms.size).toBeGreaterThan(1);
      expect(titles.size).toBeGreaterThan(1);
    });

    it("should match platform with corresponding title", async () => {
      const topicMap = {
        "YouTube": "AI tooling workflow update",
        "Reddit": "Best study systems for CS students",
        "X": "Productivity thread with strong signal"
      };

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.title).toBe(topicMap[payload.platform as keyof typeof topicMap]);
    });

    it("should match relevance with corresponding topic", async () => {
      const relevanceMap: Record<string, number> = {
        "AI tooling workflow update": 0.86,
        "Best study systems for CS students": 0.79,
        "Productivity thread with strong signal": 0.73
      };

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.relevance).toBe(relevanceMap[payload.title]);
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
      expect(keys).toEqual(["platform", "relevance", "title"]);
    });
  });
});
