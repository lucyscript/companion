import { useEffect, useState } from "react";
import {
  getGoals,
  getHabits,
  toggleHabitCheckIn,
  toggleGoalCheckIn
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Goal, Habit } from "../types";
import { hapticSuccess } from "../lib/haptics";
import { AnimatedFlame, AnimatedTrophy } from "./AnimatedIcons";

const EMPTY_GROWTH_SVG = `${(import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "")}/illustrations/empty-growth.svg`;

interface BusyState {
  type: "habit" | "goal";
  id: string;
}

const UNBOUNDED_HABIT_TARGET = -1;

function formatHabitCadence(
  cadence: string,
  t: (text: string, vars?: Record<string, string | number>) => string
): string {
  const trimmed = cadence.trim();
  if (!trimmed) {
    return t("Flexible");
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatHabitTarget(targetPerWeek: number): string {
  if (!Number.isFinite(targetPerWeek) || targetPerWeek <= UNBOUNDED_HABIT_TARGET) {
    return "∞";
  }
  if (targetPerWeek === 7) {
    return "Daily";
  }
  return `${targetPerWeek}×/week`;
}

/** Count completed check-ins in recent history for the habit's cadence window */
function computeHabitProgress(habit: Habit): { done: number; target: number; label: string } {
  const cadence = habit.cadence.toLowerCase().trim();
  const recent = habit.recentCheckIns || [];
  const done = recent.filter((d) => d.completed).length;

  if (cadence === "daily" || habit.targetPerWeek === 7) {
    return { done, target: 7, label: `${done}×/week` };
  }
  if (cadence === "weekly") {
    return { done, target: habit.targetPerWeek > 0 ? habit.targetPerWeek : 7, label: `${done}×/week` };
  }
  // Default: show against the targetPerWeek
  const t = habit.targetPerWeek > 0 ? habit.targetPerWeek : 7;
  return { done, target: t, label: `${done}×/week` };
}

export function HabitsGoalsView(): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [habits, setHabits] = useState<Habit[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [busy, setBusy] = useState<BusyState | null>(null);

  useEffect(() => {
    let disposed = false;

    const sync = async (): Promise<void> => {
      try {
        const [habitData, goalData] = await Promise.all([getHabits(), getGoals()]);
        if (!disposed) {
          setHabits(habitData);
          setGoals(goalData);
        }
      } catch {
        // offline fallback already handled by API helpers
      }
    };

    void sync();
    return () => {
      disposed = true;
    };
  }, []);

  const handleHabitCheckIn = async (habit: Habit): Promise<void> => {
    const nextCompleted = !habit.todayCompleted;
    // Optimistic UI: update immediately so the checkmark appears on tap
    setBusy({ type: "habit", id: habit.id });
    setHabits((prev) => prev.map((h) => (h.id === habit.id ? { ...h, todayCompleted: nextCompleted } : h)));
    hapticSuccess();
    const result = await toggleHabitCheckIn(habit.id, nextCompleted);
    if (result.item) {
      setHabits((prev) => prev.map((h) => (h.id === habit.id ? result.item! : h)));
    } else {
      // Revert on failure
      setHabits((prev) => prev.map((h) => (h.id === habit.id ? { ...h, todayCompleted: !nextCompleted } : h)));
    }
    setBusy(null);
  };

  const handleGoalCheckIn = async (goal: Goal): Promise<void> => {
    const nextCompleted = !goal.todayCompleted;
    // Optimistic UI: update immediately so the checkmark appears on tap
    setBusy({ type: "goal", id: goal.id });
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, todayCompleted: nextCompleted } : g)));
    hapticSuccess();
    const result = await toggleGoalCheckIn(goal.id, nextCompleted);
    if (result.item) {
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? result.item! : g)));
    } else {
      // Revert on failure
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, todayCompleted: !nextCompleted } : g)));
    }
    setBusy(null);
  };

  const renderHabit = (habit: Habit): JSX.Element => {
    const isBusy = busy?.type === "habit" && busy.id === habit.id;
    const isUnbounded = habit.targetPerWeek <= UNBOUNDED_HABIT_TARGET;
    const progress = computeHabitProgress(habit);
    const barPercent = Math.max(0, Math.min(100, Math.round((progress.done / progress.target) * 100)));

    return (
      <article key={habit.id} className="habit-card habit-card-compact">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">{t("Habit")}</p>
            <h3>{habit.name}</h3>
            <p className="muted">
              {formatHabitTarget(habit.targetPerWeek)}
              {habit.streak > 0 ? t(" • {count} day streak", { count: habit.streak }) : ""}
            </p>
            {habit.motivation && <p className="muted">{habit.motivation}</p>}
          </div>
          <button
            type="button"
            className={`habit-checkin-button ${habit.todayCompleted ? "habit-checkin-done" : ""}`}
            onClick={() => void handleHabitCheckIn(habit)}
            disabled={isBusy}
            aria-label={habit.todayCompleted ? t("Undo check-in") : t("Check in")}
          >
            {habit.todayCompleted ? "✓" : isBusy ? "…" : "○"}
          </button>
        </header>
        {isUnbounded ? (
          /* Unbounded habits: streak is the primary metric */
          <div className="habit-streak-display">
            {habit.streak > 0 ? (
              <span className="habit-streak-badge"><AnimatedFlame size={16} className="habit-streak-flame" /> {habit.streak} {t("day streak")}</span>
            ) : (
              <span className="habit-streak-badge habit-streak-badge-empty">{t("Start your streak today")}</span>
            )}
          </div>
        ) : (
          /* Bounded habits: show progress bar labeled with actual check-in count */
          <div className="habit-visual-progress-wrapper">
            <div className="habit-visual-progress">
              <div className={`habit-visual-progress-fill${habit.streakGraceUsed ? " habit-visual-progress-grace" : ""}`} style={{ width: `${barPercent}%` }} />
            </div>
            <span className="habit-progress-label">{progress.label}</span>
          </div>
        )}
      </article>
    );
  };

  const renderGoal = (goal: Goal): JSX.Element => {
    const progressPercent = Math.min(100, Math.round((goal.progressCount / goal.targetCount) * 100));
    const dueLabel =
      goal.dueDate &&
      new Date(goal.dueDate).toLocaleDateString(localeTag, { month: "short", day: "numeric" });
    const isBusy = busy?.type === "goal" && busy.id === goal.id;
    const isComplete = goal.remaining <= 0 && goal.progressCount > 0;
    const isTrivial = goal.targetCount <= 1;

    // Days remaining until due date
    const daysRemaining = goal.dueDate
      ? Math.max(0, Math.ceil((new Date(goal.dueDate).getTime() - Date.now()) / 86_400_000))
      : null;

    return (
      <article key={goal.id} className={`habit-card goal-card habit-card-compact${isComplete ? " goal-card-complete" : ""}`}>
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">{t("Goal")}</p>
            <h3>{goal.title}</h3>
            <p className="muted">
              {isComplete
                ? t("✓ Completed — {count} check-ins", { count: goal.progressCount })
                : isTrivial
                  ? (dueLabel ? t("due {date}", { date: dueLabel }) : t("Single check-in"))
                  : t("{progress}/{target} check-ins", { progress: goal.progressCount, target: goal.targetCount })}
              {!isComplete && dueLabel && !isTrivial ? t(" • due {date}", { date: dueLabel }) : ""}
              {!isComplete && daysRemaining !== null && daysRemaining <= 7 && daysRemaining > 0
                ? t(" • {count}d left", { count: daysRemaining })
                : ""}
              {goal.streak > 0 && !isComplete ? t(" • {count} day streak", { count: goal.streak }) : ""}
            </p>
            {goal.motivation && <p className="muted">{goal.motivation}</p>}
          </div>
          {!isComplete && (
            <button
              type="button"
              className={`habit-checkin-button ${goal.todayCompleted ? "habit-checkin-done" : ""}`}
              onClick={() => void handleGoalCheckIn(goal)}
              disabled={isBusy}
              aria-label={goal.todayCompleted ? t("Undo check-in") : t("Check in")}
            >
              {goal.todayCompleted ? "✓" : isBusy ? "…" : "○"}
            </button>
          )}
          {isComplete && (
            <span className="goal-complete-badge" aria-label={t("Goal complete")}><AnimatedTrophy size={28} /></span>
          )}
        </header>
        {/* Only show progress bar for multi-step goals that aren't complete */}
        {!isComplete && !isTrivial && (
          <div className="goal-progress">
            <div className="goal-progress-bar">
              <div className={`goal-progress-fill${goal.streakGraceUsed ? " goal-progress-grace" : ""}`} style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="habit-progress-label">{t("{progress}/{target} check-ins", { progress: goal.progressCount, target: goal.targetCount })}</span>
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="panel habit-goal-panel">
      <header className="panel-header">
        <h2>{t("Habits & Goals")}</h2>
        <div className="pill-group">
          <span className="pill-muted">{t("{count} habits", { count: habits.length })}</span>
          <span className="pill-muted">{t("{count} goals", { count: goals.length })}</span>
        </div>
      </header>

      <div className="habit-grid">
        {habits.map(renderHabit)}
        {habits.length === 0 && (
          <div className="growth-empty-state">
            <img className="empty-state-illustration" src={EMPTY_GROWTH_SVG} alt="" width="100" height="100" />
            <p>{t("No habits yet — ask Gemini to create one.")}</p>
            <p className="growth-empty-hint">{t("Try saying \"Create a gym habit\" in Chat")}</p>
          </div>
        )}
      </div>

      <div className="habit-grid">
        {goals.map(renderGoal)}
        {goals.length === 0 && (
          <div className="growth-empty-state">
            <p className="muted">{t("No goals yet — ask Gemini to create one.")}</p>
            <p className="growth-empty-hint">{t("Try saying \"Set a goal to exercise 3x/week\" in Chat")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
