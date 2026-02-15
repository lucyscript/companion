import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - habits and goals", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates habits and tracks daily streaks", () => {
    const habit = store.createHabit({
      name: "Evening stretch",
      cadence: "daily",
      targetPerWeek: 6,
      motivation: "Stay loose after study sessions"
    });

    store.toggleHabitCheckIn(habit.id, { date: "2026-02-14T18:00:00.000Z", completed: true });
    const updated = store.toggleHabitCheckIn(habit.id, { date: "2026-02-15T07:30:00.000Z", completed: true });

    expect(updated).not.toBeNull();
    expect(updated?.todayCompleted).toBe(true);
    expect(updated?.streak).toBe(2);
    expect(updated?.recentCheckIns[6].completed).toBe(true);
    expect(updated?.completionRate7d).toBeGreaterThan(0);
  });

  it("tracks goal progress, remaining counts, and allows toggling check-ins", () => {
    const goal = store.createGoal({
      title: "Ship resume updates",
      cadence: "daily",
      targetCount: 3,
      dueDate: "2026-02-20T00:00:00.000Z"
    });

    store.toggleGoalCheckIn(goal.id, { date: "2026-02-14T12:00:00.000Z", completed: true });
    const status = store.toggleGoalCheckIn(goal.id, { completed: true });

    expect(status).not.toBeNull();
    expect(status?.progressCount).toBeGreaterThanOrEqual(2);
    expect(status?.remaining).toBeLessThanOrEqual(1);
    expect(status?.streak).toBeGreaterThanOrEqual(1);

    const reversed = store.toggleGoalCheckIn(goal.id, { completed: false });
    expect(reversed?.progressCount).toBe(status?.progressCount ? status.progressCount - 1 : 0);
  });

  it("allows grace period recovery for habits - one missed day within 24hrs", () => {
    const habit = store.createHabit({
      name: "Morning workout",
      cadence: "daily",
      targetPerWeek: 7
    });

    // Build a streak of 5 days
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-10T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-11T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-12T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-13T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-14T08:00:00.000Z", completed: true });

    // Miss Feb 15 (today in test) but complete Feb 16 - should use grace period
    // Since we're at Feb 15 12:00:00, let's advance time
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));

    const status = store.toggleHabitCheckIn(habit.id, { completed: true });

    // Streak should be 6 (5 previous days + today, with one grace period used for missed day)
    expect(status?.streak).toBe(6);
  });

  it("allows grace period recovery for goals - one missed day within 24hrs", () => {
    const goal = store.createGoal({
      title: "Daily coding practice",
      cadence: "daily",
      targetCount: 30
    });

    // Build a streak of 3 days
    store.toggleGoalCheckIn(goal.id, { date: "2026-02-12T20:00:00.000Z", completed: true });
    store.toggleGoalCheckIn(goal.id, { date: "2026-02-13T20:00:00.000Z", completed: true });
    store.toggleGoalCheckIn(goal.id, { date: "2026-02-14T20:00:00.000Z", completed: true });

    // Miss Feb 15 but complete Feb 16 - grace period should apply
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));

    const status = store.toggleGoalCheckIn(goal.id, { completed: true });

    // Streak should be 4 (3 previous + today with grace period for missed day)
    expect(status?.streak).toBe(4);
  });

  it("breaks streak after TWO consecutive missed days - grace period only covers one miss", () => {
    const habit = store.createHabit({
      name: "Meditation",
      cadence: "daily",
      targetPerWeek: 7
    });

    // Build a streak
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-11T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-12T08:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(habit.id, { date: "2026-02-13T08:00:00.000Z", completed: true });

    // Miss both Feb 14 and Feb 15, then check in on Feb 16
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));

    const status = store.toggleHabitCheckIn(habit.id, { completed: true });

    // Streak should be 1 (only today) because two consecutive days were missed
    expect(status?.streak).toBe(1);
  });
});
