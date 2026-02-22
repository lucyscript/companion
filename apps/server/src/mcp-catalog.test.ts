import { describe, expect, it } from "vitest";
import { getMcpServerTemplates } from "./mcp-catalog.js";

describe("mcp catalog", () => {
  it("returns vetted templates with bounded allowlists", () => {
    const templates = getMcpServerTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);

    const seenIds = new Set<string>();
    templates.forEach((template) => {
      expect(template.id.length).toBeGreaterThan(0);
      expect(template.provider.length).toBeGreaterThan(0);
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.serverUrl.startsWith("https://")).toBe(true);
      expect(template.docsUrl.startsWith("https://")).toBe(true);
      expect(template.authType).toBe("bearer");
      expect(template.suggestedToolAllowlist.length).toBeLessThanOrEqual(8);

      expect(seenIds.has(template.id)).toBe(false);
      seenIds.add(template.id);
    });
  });

  it("returns cloned arrays so callers cannot mutate shared state", () => {
    const first = getMcpServerTemplates();
    first[0].suggestedToolAllowlist.push("malicious_tool");

    const second = getMcpServerTemplates();
    expect(second[0].suggestedToolAllowlist.includes("malicious_tool")).toBe(false);
  });
});
