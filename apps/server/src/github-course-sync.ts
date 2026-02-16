import { Buffer } from "node:buffer";
import { config } from "./config.js";
import { RuntimeStore } from "./store.js";
import { Deadline } from "./types.js";

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

interface RepoTarget {
  owner: string;
  repo: string;
  course: string;
}

interface RepoReadme {
  path: string;
  content: string;
}

interface ParsedDeadline {
  course: string;
  task: string;
  dueDate: string;
  priority: Deadline["priority"];
}

interface SyncResult {
  success: boolean;
  deadlinesFound: number;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  error?: string;
}

export const COURSE_REPOS: RepoTarget[] = [
  { owner: "dat520-2026", repo: "assignments", course: "DAT520" },
  { owner: "dat560-2026", repo: "info", course: "DAT560" }
];

export class GitHubCourseSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(private readonly store: RuntimeStore, private readonly fetchImpl: FetchLike = fetch) {}

  start(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.timer) {
      return;
    }

    void this.sync();
    this.timer = setInterval(() => {
      void this.sync();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        error: "Sync already in progress",
        deadlinesFound: 0,
        deadlinesCreated: 0,
        deadlinesUpdated: 0
      };
    }

    this.isSyncing = true;

    try {
      const token = config.COURSE_GITHUB_PAT;

      if (!token) {
        throw new Error("COURSE_GITHUB_PAT is not configured");
      }

      const parsedDeadlines: ParsedDeadline[] = [];

      for (const repo of COURSE_REPOS) {
        const readmes = await fetchRepoReadmes(repo, token, this.fetchImpl);

        for (const readme of readmes) {
          const taskName = deriveTaskName(readme, repo);
          const deadlines = parseDeadlinesFromMarkdown(readme.content, repo.course, taskName);
          parsedDeadlines.push(...deadlines);
        }
      }

      const applyResult = this.applyDeadlines(parsedDeadlines);

      return {
        success: true,
        deadlinesFound: parsedDeadlines.length,
        ...applyResult
      };
    } catch (error) {
      return {
        success: false,
        deadlinesFound: 0,
        deadlinesCreated: 0,
        deadlinesUpdated: 0,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private applyDeadlines(deadlines: ParsedDeadline[]): Omit<SyncResult, "success" | "deadlinesFound" | "error"> {
    const existing = this.store.getDeadlines(new Date(), false);
    const seen = new Set<string>();
    let deadlinesCreated = 0;
    let deadlinesUpdated = 0;

    for (const deadline of deadlines) {
      const key = `${deadline.course.toLowerCase()}|${deadline.task.toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const current = existing.find(
        (item) =>
          item.course.toLowerCase() === deadline.course.toLowerCase() &&
          item.task.toLowerCase() === deadline.task.toLowerCase()
      );

      if (current) {
        const priority = pickHigherPriority(current.priority, deadline.priority);
        this.store.updateDeadline(current.id, {
          dueDate: deadline.dueDate,
          priority,
          completed: current.completed
        });
        deadlinesUpdated += 1;
        continue;
      }

      this.store.createDeadline({
        course: deadline.course,
        task: deadline.task,
        dueDate: deadline.dueDate,
        priority: deadline.priority,
        completed: false
      });
      deadlinesCreated += 1;
    }

    return { deadlinesCreated, deadlinesUpdated };
  }
}

function pickHigherPriority(existing: Deadline["priority"], incoming: Deadline["priority"]): Deadline["priority"] {
  const order: Deadline["priority"][] = ["low", "medium", "high", "critical"];
  return order.indexOf(incoming) > order.indexOf(existing) ? incoming : existing;
}

function deriveTaskName(readme: RepoReadme, repo: RepoTarget): string {
  const heading = extractHeading(readme.content);

  if (heading) {
    return heading;
  }

  const parts = readme.path.split("/");
  const maybeFolder = parts.length > 1 ? parts[parts.length - 2] : null;

  if (maybeFolder && maybeFolder.length > 0) {
    return maybeFolder;
  }

  return `${repo.course} lab`;
}

function extractHeading(content: string): string | null {
  const match = content.match(/^#{1,2}\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function parseDeadlinesFromMarkdown(content: string, course: string, fallbackTask: string): ParsedDeadline[] {
  const deadlines: ParsedDeadline[] = [];
  const regex = /\|\s*Deadline[^|]*\|\s*([^\|]+)\|/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]?.replace(/\*/g, "").trim();
    const dueDate = parseDate(raw);

    if (!dueDate) {
      continue;
    }

    deadlines.push({
      course,
      task: fallbackTask,
      dueDate,
      priority: "high"
    });
  }

  return deadlines;
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(/\|/g, "").trim();
  const parsed = new Date(cleaned);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const utcParsed = new Date(`${cleaned} UTC`);
  if (!Number.isNaN(utcParsed.getTime())) {
    return utcParsed.toISOString();
  }

  return null;
}

async function fetchRepoReadmes(repo: RepoTarget, token: string, fetchImpl: FetchLike): Promise<RepoReadme[]> {
  const headers = buildHeaders(token);
  const defaultBranch = await fetchDefaultBranch(repo, headers, fetchImpl);
  const rootUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents?ref=${defaultBranch}`;
  const rootResponse = await fetchImpl(rootUrl, { headers });

  if (!rootResponse.ok) {
    throw new Error(`GitHub API returned ${rootResponse.status} for ${repo.owner}/${repo.repo}`);
  }

  const rootContents = (await rootResponse.json()) as Array<Record<string, string>>;
  const readmes: RepoReadme[] = [];

  for (const entry of rootContents) {
    if (entry.type === "file" && entry.name?.toLowerCase().startsWith("readme")) {
      const content = await fetchFileContent(entry, headers, fetchImpl);
      readmes.push({ path: entry.path ?? entry.name ?? "README.md", content });
    }

    if (entry.type === "dir" && entry.url) {
      const nested = await fetchDirectoryReadmes(entry.url, defaultBranch, headers, fetchImpl);
      readmes.push(...nested);
    }
  }

  return readmes;
}

async function fetchDirectoryReadmes(
  url: string,
  branch: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike
): Promise<RepoReadme[]> {
  const response = await fetchImpl(`${url}?ref=${branch}`, { headers });
  if (!response.ok) {
    return [];
  }

  const contents = (await response.json()) as Array<Record<string, string>>;
  const readmes: RepoReadme[] = [];

  for (const entry of contents) {
    if (entry.type === "file" && entry.name?.toLowerCase().startsWith("readme")) {
      const content = await fetchFileContent(entry, headers, fetchImpl);
      readmes.push({ path: entry.path ?? entry.name ?? "README.md", content });
    }
  }

  return readmes;
}

async function fetchFileContent(
  entry: Record<string, string>,
  headers: Record<string, string>,
  fetchImpl: FetchLike
): Promise<string> {
  if (entry.download_url) {
    const response = await fetchImpl(entry.download_url, { headers });
    if (!response.ok) {
      throw new Error(`Unable to download ${entry.download_url}`);
    }

    return await response.text();
  }

  if (entry.url) {
    const response = await fetchImpl(entry.url, { headers });
    if (!response.ok) {
      throw new Error(`Unable to fetch ${entry.url}`);
    }

    const data = (await response.json()) as { content?: string };
    if (data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  }

  throw new Error("Unable to load README content");
}

async function fetchDefaultBranch(
  repo: RepoTarget,
  headers: Record<string, string>,
  fetchImpl: FetchLike
): Promise<string> {
  const resp = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, { headers });
  if (!resp.ok) {
    return "main";
  }

  const data = (await resp.json()) as { default_branch?: string };
  return data.default_branch ?? "main";
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "companion-github-sync"
  };
}
