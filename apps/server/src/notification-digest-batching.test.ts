import { describe, expect, it } from "vitest";
import { buildDigestNotification, isDigestCandidate, resolveNextDigestWindow } from "./notification-digest-batching.js";
import type { ScheduledNotification } from "./types.js";

function makeScheduledNotification(overrides: Partial<ScheduledNotification> = {}): ScheduledNotification {
  return {
    id: overrides.id ?? "sched-notif-1",
    notification: {
      source: overrides.notification?.source ?? "assignment-tracker",
      title: overrides.notification?.title ?? "Deadline alert",
      message: overrides.notification?.message ?? "Assignment due soon",
      priority: overrides.notification?.priority ?? "low"
    },
    scheduledFor: overrides.scheduledFor ?? "2026-02-17T08:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-02-17T07:30:00.000Z",
    eventId: overrides.eventId
  };
}

describe("notification-digest-batching", () => {
  it("resolves next digest window for morning, evening, and overnight cases", () => {
    const morning = resolveNextDigestWindow(new Date(2026, 1, 17, 6, 15, 0, 0), 8, 18);
    const afternoon = resolveNextDigestWindow(new Date(2026, 1, 17, 12, 15, 0, 0), 8, 18);
    const late = resolveNextDigestWindow(new Date(2026, 1, 17, 20, 15, 0, 0), 8, 18);

    expect(morning.getHours()).toBe(8);
    expect(morning.getDate()).toBe(17);
    expect(afternoon.getHours()).toBe(18);
    expect(afternoon.getDate()).toBe(17);
    expect(late.getHours()).toBe(8);
    expect(late.getDate()).toBe(18);
  });

  it("identifies low/medium scheduled notifications as digest candidates", () => {
    expect(isDigestCandidate(makeScheduledNotification({ notification: { source: "notes", title: "Journal", message: "Prompt", priority: "low" } }))).toBe(true);
    expect(isDigestCandidate(makeScheduledNotification({ notification: { source: "lecture-plan", title: "Lecture", message: "Soon", priority: "medium" } }))).toBe(true);
    expect(isDigestCandidate(makeScheduledNotification({ notification: { source: "assignment-tracker", title: "Critical", message: "Now", priority: "high" } }))).toBe(false);
  });

  it("builds an evening digest notification with deep link", () => {
    const notifications = [
      makeScheduledNotification({
        id: "sched-1",
        notification: { source: "assignment-tracker", title: "Deadline alert", message: "Task 1", priority: "medium" }
      }),
      makeScheduledNotification({
        id: "sched-2",
        notification: { source: "assignment-tracker", title: "Deadline follow-up", message: "Task 2", priority: "low" }
      }),
      makeScheduledNotification({
        id: "sched-3",
        notification: { source: "notes", title: "Journal prompt", message: "Reflect", priority: "low" }
      })
    ];

    const digest = buildDigestNotification(notifications, new Date("2026-02-17T18:30:00.000Z"));

    expect(digest).not.toBeNull();
    expect(digest?.title).toBe("Evening digest");
    expect(digest?.priority).toBe("medium");
    expect(digest?.source).toBe("orchestrator");
    expect(digest?.url).toBe("/companion/?tab=schedule");
    expect(digest?.actions).toEqual(["view"]);
    expect(digest?.message).toContain("3 non-urgent updates");
    expect(digest?.message).toContain("assignment");
  });

  it("returns null when there is nothing to digest", () => {
    expect(buildDigestNotification([])).toBeNull();
  });
});
