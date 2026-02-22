import { describe, expect, it } from "vitest";
import { calculateMcpToolBudgets } from "./mcp.js";

describe("MCP tool budget scaling", () => {
  it("returns zero budgets when no servers are connected", () => {
    expect(calculateMcpToolBudgets(0)).toEqual({
      totalBudget: 0,
      perServerBudget: 0
    });
  });

  it("allocates more tools per server when fewer servers are connected", () => {
    const one = calculateMcpToolBudgets(1);
    const two = calculateMcpToolBudgets(2);
    const four = calculateMcpToolBudgets(4);

    expect(one.perServerBudget).toBeGreaterThan(two.perServerBudget);
    expect(two.perServerBudget).toBeGreaterThan(four.perServerBudget);
  });

  it("scales total budget with server count up to a cap", () => {
    const one = calculateMcpToolBudgets(1);
    const three = calculateMcpToolBudgets(3);
    const six = calculateMcpToolBudgets(6);
    const ten = calculateMcpToolBudgets(10);

    expect(three.totalBudget).toBeGreaterThan(one.totalBudget);
    expect(six.totalBudget).toBeGreaterThanOrEqual(three.totalBudget);
    expect(ten.totalBudget).toBe(six.totalBudget);
  });
});
