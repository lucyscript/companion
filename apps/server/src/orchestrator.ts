import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly agents: BaseAgent[] = [
    new NotesAgent(),
    new LecturePlanAgent(),
    new AssignmentTrackerAgent()
  ];

  constructor(private readonly store: RuntimeStore) {}

  start(): void {
    this.emitBootNotification();

    for (const agent of this.agents) {
      const runOnce = async (): Promise<void> => {
        this.store.markAgentRunning(agent.name);

        try {
          await agent.run({
            emit: (event) => this.handleEvent(event)
          });
        } catch (error) {
          this.store.markAgentError(agent.name);
          this.store.pushNotification({
            source: "orchestrator",
            title: `${agent.name} failed`,
            message: error instanceof Error ? error.message : "unknown runtime error",
            priority: "high"
          });
        }
      };

      void runOnce();
      const timer = setInterval(() => {
        void runOnce();
      }, agent.intervalMs);

      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }

    this.timers = [];
  }

  private handleEvent(event: AgentEvent): void {
    if (event.eventType === "assignment.deadline") {
      const payload = event.payload as {
        course?: string;
        task?: string;
        dueDate?: string;
        submitted?: boolean;
        hoursLeft?: number;
        assignments?: Array<{
          course?: string;
          task?: string;
          dueDate?: string;
          submitted?: boolean;
          hoursLeft?: number;
        }>;
      };

      const assignments =
        Array.isArray(payload?.assignments) && payload.assignments.length > 0
          ? payload.assignments
          : [payload];

      for (const assignment of assignments) {
        const priority =
          typeof assignment.hoursLeft === "number"
            ? assignment.hoursLeft <= 12
              ? "critical"
              : assignment.hoursLeft <= 24
                ? "high"
                : "medium"
            : event.priority;

        this.store.syncDeadlineFromAssignment({
          course: assignment.course ?? payload?.course,
          task: assignment.task ?? payload?.task,
          dueDate: assignment.dueDate ?? payload?.dueDate,
          priority,
          submitted: assignment.submitted ?? payload?.submitted ?? false
        });
      }
    }

    this.store.recordEvent(event);
    const context = this.store.getUserContext();
    if (event.eventType === "assignment.deadline" && (event.payload as { submitted?: boolean } | undefined)?.submitted) {
      return;
    }
    const nudge = buildContextAwareNudge(event, context);

    if (nudge) {
      this.store.pushNotification(nudge);
      return;
    }

    this.store.pushNotification({
      source: "orchestrator",
      title: "Unknown event",
      message: `Unhandled event type: ${event.eventType}`,
      priority: "low"
    });
  }

  private emitBootNotification(): void {
    this.store.pushNotification({
      source: "orchestrator",
      title: "Companion online",
      message: "All agents scheduled and running.",
      priority: "medium"
    });
  }
}
