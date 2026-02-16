import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("GitHubCourseSyncService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, COURSE_GITHUB_PAT: "test-token" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses README deadlines and upserts them into the store", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/dat520-2026/assignments")) {
        return jsonResponse({ default_branch: "main" });
      }

      if (url.endsWith("/dat560-2026/info")) {
        return jsonResponse({ default_branch: "main" });
      }

      if (url.includes("dat520-2026/assignments/contents") && !url.includes("lab1")) {
        return jsonResponse([
          { name: "lab1", type: "dir", url: "https://api.github.com/repos/dat520-2026/assignments/contents/lab1", path: "lab1" }
        ]);
      }

      if (url.includes("assignments/contents/lab1")) {
        return jsonResponse([
          {
            name: "README.md",
            type: "file",
            path: "lab1/README.md",
            download_url: "https://raw.githubusercontent.com/dat520-2026/assignments/lab1/README.md"
          }
        ]);
      }

      if (url.includes("assignments/lab1/README")) {
        return textResponse("# Lab 1: UDP Echo\n\n| Deadline: | **Jan 15, 2026 23:59** |\n");
      }

      if (url.includes("dat560-2026/info/contents") && !url.includes("project")) {
        return jsonResponse([
          { name: "project", type: "dir", url: "https://api.github.com/repos/dat560-2026/info/contents/project", path: "project" }
        ]);
      }

      if (url.includes("info/contents/project")) {
        return jsonResponse([
          {
            name: "README.md",
            type: "file",
            path: "project/README.md",
            download_url: "https://raw.githubusercontent.com/dat560-2026/info/project/README.md"
          }
        ]);
      }

      if (url.includes("info/project/README")) {
        return textResponse("## Assignment 2\n\n| Deadline: | **Feb 18, 2026 17:00** |\n");
      }

      return jsonResponse([], 404);
    });

    const { GitHubCourseSyncService } = await import("./github-course-sync.js");
    const { RuntimeStore } = await import("./store.js");

    const store = new RuntimeStore(":memory:");
    const service = new GitHubCourseSyncService(store, fetchMock as unknown as typeof fetch);

    const result = await service.sync();

    expect(result.success).toBe(true);
    expect(result.deadlinesFound).toBe(2);

    const deadlines = store.getDeadlines(new Date("2026-01-01"), false);

    expect(deadlines).toHaveLength(2);
    expect(deadlines.some((d) => d.course === "DAT520" && d.task.includes("Lab 1"))).toBe(true);
    expect(deadlines.some((d) => d.course === "DAT560" && d.task.includes("Assignment 2"))).toBe(true);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function textResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ content: Buffer.from(body, "utf-8").toString("base64") }),
    text: async () => body
  };
}
