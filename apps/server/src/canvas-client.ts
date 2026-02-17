import { config } from "./config.js";
import {
  CanvasCourse,
  CanvasAssignment,
  CanvasModule,
  CanvasAnnouncement
} from "./types.js";

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

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!this.token) {
      throw new Error("Canvas API token not configured");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getCourses(): Promise<CanvasCourse[]> {
    return this.fetch<CanvasCourse[]>("/api/v1/courses?enrollment_state=active&include[]=enrollments");
  }

  async getCourseAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.fetch<CanvasAssignment[]>(`/api/v1/courses/${courseId}/assignments?include[]=submission`);
  }

  async getCourseModules(courseId: number): Promise<CanvasModule[]> {
    return this.fetch<CanvasModule[]>(`/api/v1/courses/${courseId}/modules`);
  }

  async getAnnouncements(): Promise<CanvasAnnouncement[]> {
    return this.fetch<CanvasAnnouncement[]>("/api/v1/announcements?context_codes[]=course_all&active_only=true");
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
