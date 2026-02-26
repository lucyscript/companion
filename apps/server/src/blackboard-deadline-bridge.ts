/**
 * Blackboard → Deadline Bridge
 *
 * Mirrors CanvasDeadlineBridge — converts Blackboard assignments
 * into the shared deadline system with dedup and completion tracking.
 */

import { RuntimeStore } from "./store.js";
import { BlackboardAssignment, BlackboardCourse, Deadline, Priority } from "./types.js";
import { makeId } from "./utils.js";

export interface BlackboardDeadlineBridgeResult {
  created: number;
  updated: number;
  completed: number;
  removed: number;
  skipped: number;
  createdDeadlines: Deadline[];
}

export class BlackboardDeadlineBridge {
  private readonly store: RuntimeStore;
  private readonly userId: string;

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
  }

  syncAssignments(courses: BlackboardCourse[], assignments: BlackboardAssignment[]): BlackboardDeadlineBridgeResult {
    const result: BlackboardDeadlineBridgeResult = {
      created: 0,
      updated: 0,
      completed: 0,
      removed: 0,
      skipped: 0,
      createdDeadlines: []
    };

    const courseMap = new Map<string, string>();
    for (const course of courses) {
      courseMap.set(course.id, course.name ?? course.courseId ?? course.id);
    }

    // Get existing deadlines tagged with blackboardContentId
    const existingDeadlines = this.store.getDeadlines(this.userId, new Date(), false);
    const bbDeadlineMap = new Map<string, Deadline>();
    for (const deadline of existingDeadlines) {
      if (deadline.blackboardContentId) {
        bbDeadlineMap.set(deadline.blackboardContentId, deadline);
      }
    }

    const seenContentIds = new Set<string>();

    for (const assignment of assignments) {
      seenContentIds.add(assignment.id);

      // Skip assignments without due dates
      if (!assignment.availability?.adaptiveRelease?.end) {
        result.skipped++;
        continue;
      }

      const dueDate = assignment.availability.adaptiveRelease.end;
      const courseName = courseMap.get(assignment.courseId ?? "") ?? "Unknown Course";

      const existingDeadline = bbDeadlineMap.get(assignment.id);

      if (existingDeadline) {
        const existingSourceDueDate = existingDeadline.sourceDueDate ?? existingDeadline.dueDate;
        const userOverrodeDueDate = existingDeadline.dueDate !== existingSourceDueDate;
        const sourceDueDateChanged = existingSourceDueDate !== dueDate;
        const nextDueDate = sourceDueDateChanged && !userOverrodeDueDate ? dueDate : existingDeadline.dueDate;

        const needsUpdate =
          existingDeadline.task !== assignment.title ||
          existingDeadline.sourceDueDate !== dueDate ||
          existingDeadline.dueDate !== nextDueDate ||
          existingDeadline.course !== courseName;

        if (needsUpdate) {
          this.store.updateDeadline(this.userId, existingDeadline.id, {
            task: assignment.title,
            dueDate: nextDueDate,
            sourceDueDate: dueDate,
            course: courseName
          });
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        const priority = this.inferPriority(assignment);
        const deadline: Omit<Deadline, "id"> = {
          course: courseName,
          task: assignment.title,
          dueDate,
          sourceDueDate: dueDate,
          priority,
          completed: false,
          blackboardContentId: assignment.id
        };

        const created = this.store.createDeadline(this.userId, deadline);
        result.created++;
        result.createdDeadlines.push(created);
      }
    }

    // Remove stale Blackboard-linked deadlines
    for (const [contentId, deadline] of bbDeadlineMap.entries()) {
      if (seenContentIds.has(contentId)) continue;
      if (this.store.deleteDeadline(this.userId, deadline.id)) {
        result.removed++;
      }
    }

    return result;
  }

  private inferPriority(assignment: BlackboardAssignment): Priority {
    const points = assignment.score?.possible ?? 0;
    if (points >= 100) return "high";
    if (points >= 50) return "medium";
    return "low";
  }
}
