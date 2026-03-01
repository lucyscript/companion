import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RuntimeStore } from "./store.js";
import { handleListGitHubOrgRepos, handleListGitHubUserOrgs, getGitHubMcpToken } from "./chat.js";

/**
 * Tests for native GitHub org tools (listGitHubOrgRepos, listGitHubUserOrgs).
 * These tools bypass MCP and call the GitHub REST API directly using the
 * user's stored OAuth token.
 */

function createTestUser(store: RuntimeStore): string {
  const user = store.createUser({ email: `test-${Math.random()}@test.com`, passwordHash: "hash", role: "user" });
  return user.id;
}

function setupGitHubMcp(store: RuntimeStore, userId: string, token = "ghp_test_token_123") {
  store.upsertUserConnection({
    userId,
    service: "mcp",
    credentials: JSON.stringify({
      servers: [
        {
          id: "github-1",
          label: "GitHub",
          serverUrl: "https://api.githubcopilot.com/mcp/readonly",
          enabled: true,
          toolAllowlist: ["get_me"],
          token
        }
      ]
    }),
    displayLabel: "1 server"
  });
}

describe("getGitHubMcpToken", () => {
  let store: RuntimeStore;
  let userId: string;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    userId = createTestUser(store);
  });

  it("returns token when GitHub MCP is connected and enabled", () => {
    setupGitHubMcp(store, userId, "ghp_abc123");
    expect(getGitHubMcpToken(store, userId)).toBe("ghp_abc123");
  });

  it("returns undefined when no MCP servers configured", () => {
    expect(getGitHubMcpToken(store, userId)).toBeUndefined();
  });

  it("returns undefined when GitHub MCP is disabled", () => {
    store.upsertUserConnection({
      userId,
      service: "mcp",
      credentials: JSON.stringify({
        servers: [
          {
            id: "github-1",
            label: "GitHub",
            serverUrl: "https://api.githubcopilot.com/mcp/readonly",
            enabled: false,
            toolAllowlist: [],
            token: "ghp_disabled"
          }
        ]
      }),
      displayLabel: "1 server"
    });
    expect(getGitHubMcpToken(store, userId)).toBeUndefined();
  });

  it("returns undefined when MCP server has no token", () => {
    store.upsertUserConnection({
      userId,
      service: "mcp",
      credentials: JSON.stringify({
        servers: [
          {
            id: "github-1",
            label: "GitHub",
            serverUrl: "https://api.githubcopilot.com/mcp/readonly",
            enabled: true,
            toolAllowlist: []
          }
        ]
      }),
      displayLabel: "1 server"
    });
    expect(getGitHubMcpToken(store, userId)).toBeUndefined();
  });

  it("ignores non-GitHub MCP servers", () => {
    store.upsertUserConnection({
      userId,
      service: "mcp",
      credentials: JSON.stringify({
        servers: [
          {
            id: "notion-1",
            label: "Notion",
            serverUrl: "https://mcp.notion.so/sse",
            enabled: true,
            toolAllowlist: [],
            token: "ntn_token"
          }
        ]
      }),
      displayLabel: "1 server"
    });
    expect(getGitHubMcpToken(store, userId)).toBeUndefined();
  });
});

describe("handleListGitHubUserOrgs", () => {
  let store: RuntimeStore;
  let userId: string;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    userId = createTestUser(store);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns error when GitHub is not connected", async () => {
    const result = await handleListGitHubUserOrgs(store, userId);
    expect(result).toEqual({ error: expect.stringContaining("not connected") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists organizations on success", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { login: "dat560-2026", description: "University course org" },
        { login: "my-startup", description: null }
      ]
    });

    const result = await handleListGitHubUserOrgs(store, userId) as any;
    expect(result.count).toBe(2);
    expect(result.orgs).toEqual([
      { login: "dat560-2026", description: "University course org" },
      { login: "my-startup", description: null }
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/user/orgs?per_page=100");
    expect(opts.headers.Authorization).toBe("Bearer ghp_test_token_123");
    expect(opts.headers.Accept).toBe("application/vnd.github+json");
  });

  it("returns error on API failure", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Bad credentials"
    });

    const result = await handleListGitHubUserOrgs(store, userId) as any;
    expect(result.error).toContain("GitHub API error 403");
    expect(result.error).toContain("Bad credentials");
  });

  it("returns error on network failure", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await handleListGitHubUserOrgs(store, userId) as any;
    expect(result.error).toContain("Network timeout");
  });
});

describe("handleListGitHubOrgRepos", () => {
  let store: RuntimeStore;
  let userId: string;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    userId = createTestUser(store);
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns error when GitHub is not connected", async () => {
    const result = await handleListGitHubOrgRepos(store, userId, { org: "myorg" });
    expect(result).toEqual({ error: expect.stringContaining("not connected") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error when org is missing", async () => {
    setupGitHubMcp(store, userId);
    const result = await handleListGitHubOrgRepos(store, userId, {});
    expect(result).toEqual({ error: "Missing required 'org' parameter" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists repos for an org on success", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          name: "assignment-1",
          full_name: "dat560-2026/assignment-1",
          private: true,
          description: "First assignment",
          updated_at: "2025-09-01T08:00:00Z",
          default_branch: "main",
          stargazers_count: 0,
          fork: false
        },
        {
          name: "course-materials",
          full_name: "dat560-2026/course-materials",
          private: false,
          description: null,
          updated_at: "2025-08-15T12:00:00Z",
          default_branch: "main"
        }
      ]
    });

    const result = await handleListGitHubOrgRepos(store, userId, { org: "dat560-2026" }) as any;
    expect(result.org).toBe("dat560-2026");
    expect(result.count).toBe(2);
    expect(result.repos).toEqual([
      {
        name: "assignment-1",
        full_name: "dat560-2026/assignment-1",
        private: true,
        description: "First assignment",
        updated_at: "2025-09-01T08:00:00Z",
        default_branch: "main"
      },
      {
        name: "course-materials",
        full_name: "dat560-2026/course-materials",
        private: false,
        description: null,
        updated_at: "2025-08-15T12:00:00Z",
        default_branch: "main"
      }
    ]);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/orgs/dat560-2026/repos?type=all&per_page=100&sort=updated");
    expect(opts.headers.Authorization).toBe("Bearer ghp_test_token_123");
  });

  it("passes type parameter to GitHub API", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    await handleListGitHubOrgRepos(store, userId, { org: "myorg", type: "private" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("type=private");
  });

  it("URL-encodes org name", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    await handleListGitHubOrgRepos(store, userId, { org: "org with spaces" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("org%20with%20spaces");
  });

  it("returns error on API failure", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '{"message":"Not Found"}'
    });

    const result = await handleListGitHubOrgRepos(store, userId, { org: "nonexistent" }) as any;
    expect(result.error).toContain("GitHub API error 404");
  });

  it("returns error on network failure", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockRejectedValueOnce(new Error("DNS resolution failed"));

    const result = await handleListGitHubOrgRepos(store, userId, { org: "myorg" }) as any;
    expect(result.error).toContain("DNS resolution failed");
  });

  it("defaults type to 'all' when not provided", async () => {
    setupGitHubMcp(store, userId);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    await handleListGitHubOrgRepos(store, userId, { org: "myorg" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("type=all");
  });
});
