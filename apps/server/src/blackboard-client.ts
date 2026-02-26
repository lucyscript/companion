/**
 * Blackboard Learn REST API Client
 *
 * Mirrors the CanvasClient pattern — fetches courses, assignments (contents),
 * and announcements from Blackboard Learn's REST API.
 *
 * Blackboard Learn REST docs:
 *   https://developer.anthology.com/portal/displayApi
 *
 * Auth: Bearer token (application key or user token).
 */

import {
  BlackboardCourse,
  BlackboardAssignment,
  BlackboardAnnouncement
} from "./types.js";

export class BlackboardClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? "").replace(/\/+$/, "");
    this.token = token;
  }

  isConfigured(): boolean {
    return Boolean(this.token) && Boolean(this.baseUrl);
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!this.token) {
      throw new Error("Blackboard API token not configured");
    }
    if (!this.baseUrl) {
      throw new Error("Blackboard base URL not configured");
    }

    const url = `${this.baseUrl}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json"
        }
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Blackboard request failed for ${url}${reason}`);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      const compactBody = responseBody.trim().slice(0, 200);
      const details = compactBody ? ` — ${compactBody}` : "";
      throw new Error(`Blackboard API error for ${url}: ${response.status} ${response.statusText}${details}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch courses where the authenticated user is enrolled.
   */
  async getCourses(): Promise<BlackboardCourse[]> {
    const data = await this.fetch<{ results: BlackboardCourse[] }>(
      "/learn/api/public/v1/users/me/courses?availability.available=Yes"
    );
    return data.results ?? [];
  }

  /**
   * Fetch graded content items (assignments) for a course.
   */
  async getCourseAssignments(courseId: string): Promise<BlackboardAssignment[]> {
    const data = await this.fetch<{ results: BlackboardAssignment[] }>(
      `/learn/api/public/v1/courses/${courseId}/contents?contentHandler.id=resource/x-bb-assignment`
    );
    return data.results ?? [];
  }

  /**
   * Fetch course announcements.
   */
  async getCourseAnnouncements(courseId: string): Promise<BlackboardAnnouncement[]> {
    const data = await this.fetch<{ results: BlackboardAnnouncement[] }>(
      `/learn/api/public/v1/courses/${courseId}/announcements`
    );
    return data.results ?? [];
  }

  /**
   * Fetch assignments across all given courses.
   */
  async getAllAssignments(courses: BlackboardCourse[]): Promise<BlackboardAssignment[]> {
    const assignments: BlackboardAssignment[] = [];
    for (const course of courses) {
      try {
        const courseAssignments = await this.getCourseAssignments(course.id);
        // Tag each assignment with courseId for bridge use
        for (const a of courseAssignments) {
          a.courseId = course.id;
        }
        assignments.push(...courseAssignments);
      } catch (error) {
        console.error(`Failed to fetch Blackboard assignments for course ${course.id}:`, error);
      }
    }
    return assignments;
  }

  /**
   * Fetch announcements across all given courses.
   */
  async getAllAnnouncements(courses: BlackboardCourse[]): Promise<BlackboardAnnouncement[]> {
    const announcements: BlackboardAnnouncement[] = [];
    for (const course of courses) {
      try {
        const courseAnnouncements = await this.getCourseAnnouncements(course.id);
        announcements.push(...courseAnnouncements);
      } catch (error) {
        console.error(`Failed to fetch Blackboard announcements for course ${course.id}:`, error);
      }
    }
    return announcements;
  }
}
