import {
  AgentEvent,
  AgentName,
  AgentState,
  DashboardSnapshot,
  Deadline,
  JournalEntry,
  LectureEvent,
  Notification,
  UserContext
} from "./types.js";
import { makeId, nowIso } from "./utils.js";

const agentNames: AgentName[] = [
  "notes",
  "lecture-plan",
  "assignment-tracker",
  "orchestrator"
];

export class RuntimeStore {
  private readonly maxEvents = 100;
  private readonly maxNotifications = 40;
  private readonly maxJournalEntries = 100;
  private readonly maxScheduleEvents = 200;
  private readonly maxDeadlines = 200;
  private events: AgentEvent[] = [];
  private notifications: Notification[] = [];
  private journalEntries: JournalEntry[] = [];
  private scheduleEvents: LectureEvent[] = [];
  private deadlines: Deadline[] = [];
  private agentStates: AgentState[] = agentNames.map((name) => ({
    name,
    status: "idle",
    lastRunAt: null
  }));

  private userContext: UserContext = {
    stressLevel: "medium",
    energyLevel: "medium",
    mode: "balanced"
  };

  markAgentRunning(name: AgentName): void {
    this.updateAgent(name, {
      status: "running",
      lastRunAt: nowIso()
    });
  }

  markAgentError(name: AgentName): void {
    this.updateAgent(name, {
      status: "error",
      lastRunAt: nowIso()
    });
  }

  recordEvent(event: AgentEvent): void {
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.updateAgent(event.source, {
      status: "idle",
      lastRunAt: event.timestamp,
      lastEvent: event
    });
  }

  pushNotification(notification: Omit<Notification, "id" | "timestamp">): void {
    const full: Notification = {
      ...notification,
      id: makeId("notif"),
      timestamp: nowIso()
    };
    this.notifications = [full, ...this.notifications].slice(0, this.maxNotifications);
  }

  setUserContext(next: Partial<UserContext>): UserContext {
    this.userContext = {
      ...this.userContext,
      ...next
    };
    return this.userContext;
  }

  getUserContext(): UserContext {
    return this.userContext;
  }

  recordJournalEntry(content: string): JournalEntry {
    const entry: JournalEntry = {
      id: makeId("journal"),
      content,
      timestamp: nowIso()
    };
    this.journalEntries = [entry, ...this.journalEntries].slice(0, this.maxJournalEntries);
    return entry;
  }

  getJournalEntries(limit?: number): JournalEntry[] {
    if (limit !== undefined && limit > 0) {
      return this.journalEntries.slice(0, limit);
    }
    return this.journalEntries;
  }

  createLectureEvent(entry: Omit<LectureEvent, "id">): LectureEvent {
    const lectureEvent: LectureEvent = {
      id: makeId("lecture"),
      ...entry
    };
    this.scheduleEvents = [lectureEvent, ...this.scheduleEvents].slice(0, this.maxScheduleEvents);
    return lectureEvent;
  }

  getScheduleEvents(): LectureEvent[] {
    return this.scheduleEvents;
  }

  getScheduleEventById(id: string): LectureEvent | null {
    return this.scheduleEvents.find((event) => event.id === id) ?? null;
  }

  updateScheduleEvent(id: string, patch: Partial<Omit<LectureEvent, "id">>): LectureEvent | null {
    const index = this.scheduleEvents.findIndex((event) => event.id === id);

    if (index === -1) {
      return null;
    }

    const next: LectureEvent = {
      ...this.scheduleEvents[index],
      ...patch
    };

    this.scheduleEvents = this.scheduleEvents.map((event, eventIndex) => (eventIndex === index ? next : event));
    return next;
  }

  deleteScheduleEvent(id: string): boolean {
    const before = this.scheduleEvents.length;
    this.scheduleEvents = this.scheduleEvents.filter((event) => event.id !== id);
    return this.scheduleEvents.length < before;
  }

  createDeadline(entry: Omit<Deadline, "id">): Deadline {
    const deadline: Deadline = {
      id: makeId("deadline"),
      ...entry
    };
    this.deadlines = [deadline, ...this.deadlines].slice(0, this.maxDeadlines);
    return deadline;
  }

  getDeadlines(): Deadline[] {
    return this.deadlines;
  }

  getDeadlineById(id: string): Deadline | null {
    return this.deadlines.find((deadline) => deadline.id === id) ?? null;
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id">>): Deadline | null {
    const index = this.deadlines.findIndex((deadline) => deadline.id === id);

    if (index === -1) {
      return null;
    }

    const next: Deadline = {
      ...this.deadlines[index],
      ...patch
    };

    this.deadlines = this.deadlines.map((deadline, deadlineIndex) => (deadlineIndex === index ? next : deadline));
    return next;
  }

  deleteDeadline(id: string): boolean {
    const before = this.deadlines.length;
    this.deadlines = this.deadlines.filter((deadline) => deadline.id !== id);
    return this.deadlines.length < before;
  }

  getSnapshot(): DashboardSnapshot {
    const trackedPendingDeadlines = this.deadlines.filter((deadline) => !deadline.completed).length;
    const fallbackEventDeadlines = this.events.filter((evt) => evt.eventType === "assignment.deadline").length;
    const pendingDeadlines = trackedPendingDeadlines > 0 ? trackedPendingDeadlines : fallbackEventDeadlines;
    const activeAgents = this.agentStates.filter((a) => a.status === "running").length;

    return {
      generatedAt: nowIso(),
      summary: {
        todayFocus: this.computeFocus(),
        pendingDeadlines,
        activeAgents,
        journalStreak: 0
      },
      agentStates: this.agentStates,
      notifications: this.notifications,
      events: this.events
    };
  }

  private computeFocus(): string {
    if (this.userContext.mode === "focus") {
      return "Deep work + assignment completion";
    }

    if (this.userContext.mode === "recovery") {
      return "Light planning + recovery tasks";
    }

    return "Balanced schedule with deadlines first";
  }

  private updateAgent(name: AgentName, patch: Partial<AgentState>): void {
    this.agentStates = this.agentStates.map((agent) => (agent.name === name ? { ...agent, ...patch } : agent));
  }
}
