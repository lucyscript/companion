import { config } from "./config.js";
import {
  CanvasCourse,
  CanvasAssignment,
  CanvasModule,
  CanvasAnnouncement
} from "./types.js";

/** Maximum pages to follow during pagination to avoid infinite loops. */
const MAX_PAGES = 20;

/**
 * Parse the `Link` header returned by Canvas and extract the `next` URL.
 * Canvas uses RFC-5988 Web Linking, e.g.:
 *   <https://…?page=2&per_page=100>; rel="next", <https://…?page=5&per_page=100>; rel="last"
 */
function parseLinkHeaderNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl ?? config.CANVAS_BASE_URL;
    this.token = token ?? config.CANVAS_API_TOKEN;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private async fetchRaw(url: string): Promise<Response> {
    if (!this.token) {
      throw new Error("Canvas API token not configured");
    }

    // Sanitize token: replace non-ASCII characters (e.g. em-dash from copy-paste)
    // with their closest ASCII equivalents. HTTP headers require ByteString values.
    const safeToken = this.token.replace(/[\u2013\u2014]/g, "-").replace(/[^\x00-\x7F]/g, "");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${safeToken}`,
          Accept: "application/json"
        }
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Canvas request failed for ${url}${reason}`);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      const compactBody = responseBody.trim().slice(0, 200);
      const details = compactBody ? ` — ${compactBody}` : "";
      throw new Error(`Canvas API error for ${url}: ${response.status} ${response.statusText}${details}`);
    }

    return response;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await this.fetchRaw(url);
    return response.json() as Promise<T>;
  }

  /**
   * Fetch all pages of a paginated Canvas endpoint.
   * Canvas returns a `Link` header with rel="next" when more pages exist.
   */
  private async fetchAllPages<T>(endpoint: string): Promise<T[]> {
    const separator = endpoint.includes("?") ? "&" : "?";
    let url = `${this.baseUrl}${endpoint}${separator}per_page=100`;
    const allItems: T[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.fetchRaw(url);
      const items = (await response.json()) as T[];
      if (Array.isArray(items)) {
        allItems.push(...items);
      }

      const nextUrl = parseLinkHeaderNext(response.headers.get("Link"));
      if (!nextUrl) break;
      url = nextUrl;
    }

    return allItems;
  }

  async getCourses(): Promise<CanvasCourse[]> {
    return this.fetchAllPages<CanvasCourse>(
      "/api/v1/courses?enrollment_state=active&include[]=enrollments&include[]=term"
    );
  }

  async getCourseAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.fetchAllPages<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments?include[]=submission`
    );
  }

  async getCourseModules(courseId: number): Promise<CanvasModule[]> {
    return this.fetchAllPages<CanvasModule>(
      `/api/v1/courses/${courseId}/modules`
    );
  }

  async getAnnouncements(courseIds?: number[]): Promise<CanvasAnnouncement[]> {
    if (!courseIds || courseIds.length === 0) return [];
    // Canvas requires explicit context_codes — one per course
    const contextCodes = courseIds.map((id) => `context_codes[]=course_${id}`).join("&");
    return this.fetchAllPages<CanvasAnnouncement>(
      `/api/v1/announcements?${contextCodes}&active_only=true`
    );
  }

  async getAllAssignments(courses: CanvasCourse[]): Promise<CanvasAssignment[]> {
    const assignments: CanvasAssignment[] = [];

    for (const course of courses) {
      try {
        const courseAssignments = await this.getCourseAssignments(course.id);
        assignments.push(...courseAssignments);
      } catch (error) {
        console.error(`Failed to fetch assignments for course ${course.id}:`, error);
      }
    }

    return assignments;
  }

  async getAllModules(courses: CanvasCourse[]): Promise<CanvasModule[]> {
    const modules: CanvasModule[] = [];

    for (const course of courses) {
      try {
        const courseModules = await this.getCourseModules(course.id);
        modules.push(...courseModules);
      } catch (error) {
        console.error(`Failed to fetch modules for course ${course.id}:`, error);
      }
    }

    return modules;
  }
}
