import { describe, it, expect, beforeEach } from "vitest";
import { SocialHighlightsAgent } from "./social-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("SocialHighlightsAgent - Edge Cases", () => {
  let agent: SocialHighlightsAgent;
  let mockContext: AgentContext;

  beforeEach(() => {
    agent = new SocialHighlightsAgent();
    mockContext = {
      emit: (event: AgentEvent) => {
        // Default mock implementation
      }
    };
  });

  describe("edge cases", () => {
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

    it("should complete run without throwing errors", async () => {
      await expect(agent.run(mockContext)).resolves.not.toThrow();
    });
  });
});
