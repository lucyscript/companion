import type { Deadline } from "./types.js";

const ASSIGNMENT_OR_EXAM_PATTERNS = [
  /\bassignment(s)?\b/i,
  /\bexam(s)?\b/i,
  /\beksamen\b/i,
  /\bmidterm\b/i,
  /\bfinal\b/i,
  /\boblig\b/i,
  /\binnlevering\b/i
];

export function hasAssignmentOrExamKeyword(text: string): boolean {
  return ASSIGNMENT_OR_EXAM_PATTERNS.some((pattern) => pattern.test(text));
}

const LAB_PATTERNS = [/\blab\b/i, /\blaboratorium\b/i];

export function hasLabKeyword(text: string): boolean {
  return LAB_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAssignmentOrExamDeadline(
  deadline: Pick<Deadline, "course" | "task" | "canvasAssignmentId">
): boolean {
  if (typeof deadline.canvasAssignmentId === "number" && Number.isFinite(deadline.canvasAssignmentId)) {
    return true;
  }

  const text = `${deadline.course} ${deadline.task}`.trim();
  if (hasAssignmentOrExamKeyword(text)) {
    return true;
  }

  // Treat lab deadlines from any course as eligible
  if (hasLabKeyword(deadline.task)) {
    return true;
  }

  return false;
}
