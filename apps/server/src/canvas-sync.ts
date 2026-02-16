import { config } from "./config.js";
import { RuntimeStore } from "./store.js";
import { CanvasAnnouncement, CanvasAssignment, CanvasCourse, CanvasModule } from "./types.js";

export class CanvasAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CanvasAPIError";
  }
}

interface CanvasCourseResponse {
  id: number;
  name: string;
  course_code: string;
  enrollment_term_id?: number;
  start_at: string | null;
  end_at: string | null;
  workflow_state: string;
}

interface CanvasAssignmentResponse {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  submission_types: string[];
  has_submitted_submissions: boolean;
  workflow_state: string;
  html_url: string;
}

interface CanvasModuleResponse {
  id: number;
  name: string;
  position: number;
  unlock_at: string | null;
  require_sequential_progress: boolean;
  state: string;
}

interface CanvasDiscussionTopicResponse {
  id: number;
  title: string;
  message: string;
  posted_at: string;
  author?: {
    display_name: string;
  };
}

export class CanvasSyncService {
  private timer: NodeJS.Timeout | null = null;
  private readonly syncIntervalMs: number;
  private syncing = false;

  constructor(
    private readonly store: RuntimeStore,
    syncIntervalMinutes = 30
  ) {
    this.syncIntervalMs = syncIntervalMinutes * 60 * 1000;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    // Run initial sync
    void this.runSync();

    // Schedule periodic syncs
    this.timer = setInterval(() => {
      void this.runSync();
    }, this.syncIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runSync(): Promise<void> {
    if (!config.CANVAS_API_TOKEN || !config.CANVAS_BASE_URL) {
      console.log("Canvas sync skipped: CANVAS_API_TOKEN or CANVAS_BASE_URL not configured");
      return;
    }

    if (this.syncing) {
      console.log("Canvas sync already in progress, skipping");
      return;
    }

    this.syncing = true;
    const errors: string[] = [];
    const startTime = new Date();

    try {
      this.store.updateCanvasSyncStatus({
        syncing: true,
        nextSyncAt: new Date(Date.now() + this.syncIntervalMs).toISOString()
      });

      console.log("Starting Canvas sync...");

      // Fetch courses
      const courses = await this.fetchCourses();
      this.store.storeCanvasCourses(courses);
      console.log(`Synced ${courses.length} Canvas courses`);

      // Fetch assignments for all courses
      let totalAssignments = 0;
      let totalModules = 0;
      let totalAnnouncements = 0;

      for (const course of courses) {
        try {
          const assignments = await this.fetchAssignments(course.id);
          this.store.storeCanvasAssignments(assignments);
          totalAssignments += assignments.length;

          const modules = await this.fetchModules(course.id);
          this.store.storeCanvasModules(modules);
          totalModules += modules.length;

          const announcements = await this.fetchAnnouncements(course.id);
          this.store.storeCanvasAnnouncements(announcements);
          totalAnnouncements += announcements.length;
        } catch (error) {
          const errorMsg = `Error syncing course ${course.name}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      console.log(
        `Canvas sync complete: ${courses.length} courses, ${totalAssignments} assignments, ${totalModules} modules, ${totalAnnouncements} announcements`
      );

      this.store.updateCanvasSyncStatus({
        lastSyncAt: startTime.toISOString(),
        syncing: false,
        errors
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("Canvas sync failed:", errorMsg);
      errors.push(errorMsg);

      this.store.updateCanvasSyncStatus({
        syncing: false,
        errors
      });
    } finally {
      this.syncing = false;
    }
  }

  private async fetchCourses(): Promise<CanvasCourse[]> {
    const response = await this.canvasRequest<CanvasCourseResponse[]>(
      "/api/v1/courses?enrollment_state=active&per_page=100"
    );

    return response.map((course) => ({
      id: course.id,
      name: course.name,
      courseCode: course.course_code,
      enrollmentTermId: course.enrollment_term_id,
      startAt: course.start_at,
      endAt: course.end_at,
      workflowState: course.workflow_state
    }));
  }

  private async fetchAssignments(courseId: number): Promise<CanvasAssignment[]> {
    const response = await this.canvasRequest<CanvasAssignmentResponse[]>(
      `/api/v1/courses/${courseId}/assignments?per_page=100`
    );

    return response.map((assignment) => ({
      id: assignment.id,
      courseId,
      name: assignment.name,
      description: assignment.description,
      dueAt: assignment.due_at,
      pointsPossible: assignment.points_possible,
      submissionTypes: assignment.submission_types,
      hasSubmittedSubmissions: assignment.has_submitted_submissions,
      workflowState: assignment.workflow_state,
      htmlUrl: assignment.html_url
    }));
  }

  private async fetchModules(courseId: number): Promise<CanvasModule[]> {
    const response = await this.canvasRequest<CanvasModuleResponse[]>(
      `/api/v1/courses/${courseId}/modules?per_page=100`
    );

    return response.map((module) => ({
      id: module.id,
      courseId,
      name: module.name,
      position: module.position,
      unlockAt: module.unlock_at,
      requireSequentialProgress: module.require_sequential_progress,
      state: module.state
    }));
  }

  private async fetchAnnouncements(courseId: number): Promise<CanvasAnnouncement[]> {
    const response = await this.canvasRequest<CanvasDiscussionTopicResponse[]>(
      `/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=50`
    );

    return response.map((announcement) => ({
      id: announcement.id,
      courseId,
      title: announcement.title,
      message: announcement.message,
      postedAt: announcement.posted_at,
      author: announcement.author
        ? { displayName: announcement.author.display_name }
        : undefined
    }));
  }

  private async canvasRequest<T>(endpoint: string): Promise<T> {
    if (!config.CANVAS_API_TOKEN || !config.CANVAS_BASE_URL) {
      throw new CanvasAPIError("Canvas API not configured");
    }

    const url = `${config.CANVAS_BASE_URL}${endpoint}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.CANVAS_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        throw new CanvasAPIError(
          `Canvas API request failed: ${response.statusText}`,
          response.status
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CanvasAPIError) {
        throw error;
      }

      throw new CanvasAPIError(
        `Canvas API request error: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error
      );
    }
  }
}
