import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocialHighlightsAgent } from "./social-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("SocialHighlightsAgent - Topic Variations", () => {
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

  describe("topic variations", () => {
    it("should include YouTube topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.1); // Force first topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("YouTube");
      expect(payload.title).toBe("AI tooling workflow update");
      expect(payload.relevance).toBe(0.86);

      mockRandom.mockRestore();
    });

    it("should include Reddit topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.4); // Force second topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("Reddit");
      expect(payload.title).toBe("Best study systems for CS students");
      expect(payload.relevance).toBe(0.79);

      mockRandom.mockRestore();
    });

    it("should include X (Twitter) topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.9); // Force third topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("X");
      expect(payload.title).toBe("Productivity thread with strong signal");
      expect(payload.relevance).toBe(0.73);

      mockRandom.mockRestore();
    });
  });
});
