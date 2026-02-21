import { config } from "./config.js";

export interface GitHubFileContent {
  content: string;
  encoding: string;
  name: string;
  path: string;
  sha: string;
}

interface GitHubRepositoryTree {
  sha: string;
  tree: Array<{
    path: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
  }>;
}

export interface TreeEntry {
  path: string;
  blobSha: string;
  size: number;
}

export interface RepoCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  previousPath?: string;
}

export class GitHubCourseClient {
  private readonly token: string | undefined;
  private readonly baseUrl = "https://api.github.com";

  constructor(token?: string) {
    this.token = token ?? config.GITHUB_PAT;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  /** Expose token for lightweight HEAD ref checks (watcher). */
  getToken(): string | undefined {
    return this.token;
  }

  private decodeContent(data: GitHubFileContent): string {
    if (data.encoding === "base64") {
      // GitHub often inserts newlines in base64 payloads.
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    }

    return data.content;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!this.token) {
      throw new Error("GitHub PAT not configured (set GITHUB_PAT)");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Companion-App"
      }
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) {
          errorDetail = body.message;
        }
      } catch {
        // Keep default status text when body isn't JSON.
      }
      throw new Error(`GitHub API error (${response.status}): ${errorDetail}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch the content of a file from a GitHub repository
   */
  async getFileContent(owner: string, repo: string, path: string): Promise<string> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const data = await this.fetch<GitHubFileContent>(
      `/repos/${owner}/${repo}/contents/${encodedPath}`
    );

    return this.decodeContent(data);
  }

  /**
   * Fetch README from a repository (supports non-root paths via GitHub's readme endpoint).
   */
  async getReadme(owner: string, repo: string): Promise<string> {
    const data = await this.fetch<GitHubFileContent>(`/repos/${owner}/${repo}/readme`);
    return this.decodeContent(data);
  }

  /**
   * List repository file paths using a recursive tree lookup.
   */
  async listRepositoryFiles(owner: string, repo: string): Promise<string[]> {
    const data = await this.fetch<GitHubRepositoryTree>(
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    );

    return data.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path);
  }

  /**
   * List repository files with blob SHAs for change detection.
   * Returns [treeSha, entries[]] — treeSha is the HEAD commit tree SHA.
   */
  async listRepositoryTree(owner: string, repo: string): Promise<{ treeSha: string; entries: TreeEntry[] }> {
    const data = await this.fetch<GitHubRepositoryTree>(
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    );

    const entries = data.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => ({
        path: entry.path,
        blobSha: entry.sha,
        size: entry.size ?? 0
      }));

    return { treeSha: data.sha, entries };
  }

  /**
   * Fetch recent commits for a repository.
   */
  async listCommits(owner: string, repo: string, perPage = 5): Promise<RepoCommit[]> {
    interface GitHubCommitResponse {
      sha: string;
      commit: {
        message: string;
        author: { name: string; date: string } | null;
        committer: { date: string } | null;
      };
    }

    const data = await this.fetch<GitHubCommitResponse[]>(
      `/repos/${owner}/${repo}/commits?per_page=${perPage}`
    );

    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      date: c.commit.author?.date ?? c.commit.committer?.date ?? "",
      author: c.commit.author?.name ?? "unknown"
    }));
  }

  /**
   * Compare two commits and return changed file paths.
   * Uses the compare API: /repos/{owner}/{repo}/compare/{base}...{head}
   */
  async getChangedFiles(owner: string, repo: string, baseSha: string, headSha: string): Promise<ChangedFile[]> {
    interface CompareFile {
      filename: string;
      status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
      additions: number;
      deletions: number;
      changes: number;
      previous_filename?: string;
    }

    interface CompareResponse {
      status: string;
      total_commits: number;
      files?: CompareFile[];
    }

    const data = await this.fetch<CompareResponse>(
      `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`
    );

    return (data.files ?? []).map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      previousPath: f.previous_filename,
    }));
  }
}
