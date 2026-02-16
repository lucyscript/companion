import { BaseAgent, AgentContext } from "../agent-base.js";

interface CanvasAssignment {
  id: string;
  course: string;
  task: string;
  hoursLeft: number;
  submitted: boolean;
}

const canvasAssignments: CanvasAssignment[] = [
  { id: "canvas-1", course: "Algorithms", task: "Problem Set 4", hoursLeft: 28, submitted: false },
  { id: "canvas-2", course: "Databases", task: "Schema Design Report", hoursLeft: 54, submitted: false },
  { id: "canvas-3", course: "Operating Systems", task: "Lab 3", hoursLeft: 12, submitted: false },
  { id: "canvas-4", course: "AI Ethics", task: "Reading Reflection", hoursLeft: 6, submitted: true }
];

function dueDateFromHours(hoursLeft: number): string {
  return new Date(Date.now() + hoursLeft * 60 * 60 * 1000).toISOString();
}

export class AssignmentTrackerAgent extends BaseAgent {
  readonly name = "assignment-tracker" as const;
  readonly intervalMs = 20_000;

  async run(ctx: AgentContext): Promise<void> {
    const assignments = canvasAssignments.map((assignment) => ({
      ...assignment,
      dueDate: dueDateFromHours(assignment.hoursLeft)
    }));

    const pendingAssignments = assignments.filter((assignment) => !assignment.submitted);
    const next =
      pendingAssignments[Math.floor(Math.random() * pendingAssignments.length)] ?? assignments[0];
    const priority = next.hoursLeft <= 12 ? "critical" : next.hoursLeft <= 24 ? "high" : "medium";

    ctx.emit(
      this.event(
        "assignment.deadline",
        {
          canvasId: next.id,
          course: next.course,
          task: next.task,
          hoursLeft: next.hoursLeft,
          dueDate: next.dueDate,
          submitted: next.submitted,
          assignments: assignments.map((assignment) => ({
            canvasId: assignment.id,
            course: assignment.course,
            task: assignment.task,
            dueDate: assignment.dueDate,
            submitted: assignment.submitted,
            hoursLeft: assignment.hoursLeft
          }))
        },
        next.submitted ? "low" : priority
      )
    );
  }
}
