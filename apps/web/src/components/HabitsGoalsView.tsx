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
  return String(targetPerWeek);
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
    setBusy({ type: "habit", id: habit.id });
    const result = await toggleHabitCheckIn(habit.id, !habit.todayCompleted);
    if (result.item) {
      setHabits((prev) => prev.map((h) => (h.id === habit.id ? result.item! : h)));
      hapticSuccess();
    }
    setBusy(null);
  };

  const handleGoalCheckIn = async (goal: Goal): Promise<void> => {
    setBusy({ type: "goal", id: goal.id });
    const result = await toggleGoalCheckIn(goal.id, !goal.todayCompleted);
    if (result.item) {
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? result.item! : g)));
      hapticSuccess();
    }
    setBusy(null);
  };

  const renderHabit = (habit: Habit): JSX.Element => {
    const isBusy = busy?.type === "habit" && busy.id === habit.id;
    const completionPercent = Math.max(0, Math.min(100, Math.round(habit.completionRate7d)));

    return (
      <article key={habit.id} className="habit-card habit-card-compact">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">{t("Habit")}</p>
            <h3>{habit.name}</h3>
            <p className="muted">
              {formatHabitCadence(habit.cadence, t)} • {t("Target")} {formatHabitTarget(habit.targetPerWeek)}
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
            {isBusy ? "…" : habit.todayCompleted ? "✓" : "○"}
          </button>
        </header>
        <div className="habit-visual-progress">
          <div className={`habit-visual-progress-fill${habit.streakGraceUsed ? " habit-visual-progress-grace" : ""}`} style={{ width: `${completionPercent}%` }} />
        </div>
      </article>
    );
  };

  const renderGoal = (goal: Goal): JSX.Element => {
    const progressPercent = Math.min(100, Math.round((goal.progressCount / goal.targetCount) * 100));
    const dueLabel =
      goal.dueDate &&
      new Date(goal.dueDate).toLocaleDateString(localeTag, { month: "short", day: "numeric" });
    const isBusy = busy?.type === "goal" && busy.id === goal.id;

    return (
      <article key={goal.id} className="habit-card goal-card habit-card-compact">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">{t("Goal")}</p>
            <h3>{goal.title}</h3>
            <p className="muted">
              {t("{progress}/{target} check-ins", { progress: goal.progressCount, target: goal.targetCount })}
              {dueLabel ? t(" • due {date}", { date: dueLabel }) : ""}
              {goal.streak > 0 ? t(" • {count} day streak", { count: goal.streak }) : ""}
            </p>
            {goal.motivation && <p className="muted">{goal.motivation}</p>}
          </div>
          <button
            type="button"
            className={`habit-checkin-button ${goal.todayCompleted ? "habit-checkin-done" : ""}`}
            onClick={() => void handleGoalCheckIn(goal)}
            disabled={isBusy}
            aria-label={goal.todayCompleted ? t("Undo check-in") : t("Check in")}
          >
            {isBusy ? "…" : goal.todayCompleted ? "✓" : "○"}
          </button>
        </header>
        <div className="goal-progress">
          <div className="goal-progress-bar">
            <div className={`goal-progress-fill${goal.streakGraceUsed ? " goal-progress-grace" : ""}`} style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
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
        {habits.length === 0 && <p className="muted">{t("No habits yet — ask Gemini to create one.")}</p>}
      </div>

      <div className="habit-grid">
        {goals.map(renderGoal)}
        {goals.length === 0 && <p className="muted">{t("No goals yet — ask Gemini to create one.")}</p>}
      </div>
    </section>
  );
}
