import { useEffect, useState } from "react";
import { confirmDeadlineStatus, getDeadlines } from "../lib/api";
import { hapticSuccess } from "../lib/haptics";
import { useI18n } from "../lib/i18n";
import { Deadline } from "../types";
import { IconTarget } from "./Icons";

const EMPTY_DEADLINES_SVG = `${(import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "")}/illustrations/empty-deadlines.svg`;

interface DeadlineListProps {
  focusDeadlineId?: string;
}

const INITIAL_DEADLINE_BATCH_SIZE = 6;
const DEADLINE_BATCH_STEP = 6;

function normalizeDueDateInput(dueDate: string): string {
  const trimmed = dueDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Date-only deadlines are interpreted as local end-of-day.
    return `${trimmed}T23:59:00`;
  }
  return trimmed;
}

function dueTimestamp(dueDate: string): number {
  return new Date(normalizeDueDateInput(dueDate)).getTime();
}

function formatDeadlineTaskLabel(task: string): string {
  return task.replace(/^Assignment\s+Lab\b/i, "Lab");
}

/** Normalise course codes like "DAT600-1 26V" → "DAT600" */
function normalizeCourseCode(course: string): string {
  // Strip trailing section + semester suffix (e.g. "-1 26V", "-2 25H")
  return course.replace(/[-–]\d+\s+\d{2}[VHvh]$/, "").trim();
}

export function DeadlineList({ focusDeadlineId }: DeadlineListProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [syncMessage, setSyncMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_DEADLINE_BATCH_SIZE);

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const next = await getDeadlines();
        if (!disposed) {
          setDeadlines(next);
        }
      } catch { /* remain empty */ }
      if (!disposed) setLoading(false);
    };

    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void load();

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!focusDeadlineId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const target = document.getElementById(`deadline-${focusDeadlineId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusDeadlineId, deadlines]);

  const formatTimeRemaining = (dueDate: string): string => {
    const due = dueTimestamp(dueDate);
    const now = Date.now();
    const diffMs = due - now;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) return t("Overdue");
    if (diffHours < 1) return t("{count}m left", { count: diffMinutes });
    if (diffHours < 24) return t("{count}h left", { count: diffHours });
    if (diffDays === 1 && diffHours % 24 > 0) return t("1 day {hours}h left", { hours: diffHours % 24 });
    if (diffDays === 1) return t("1 day left");
    return t("{count} days left", { count: diffDays });
  };

  const formatDueDate = (dueDate: string): string => {
    const date = new Date(normalizeDueDateInput(dueDate));
    return date.toLocaleString(localeTag, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const getUrgencyClass = (dueDate: string): string => {
    const due = dueTimestamp(dueDate);
    const now = Date.now();
    const hoursLeft = (due - now) / (1000 * 60 * 60);

    if (hoursLeft < 0) return "deadline-overdue";
    if (hoursLeft <= 12) return "deadline-critical";
    if (hoursLeft <= 24) return "deadline-urgent";
    return "";
  };

  const setCompletion = async (id: string, completed: boolean): Promise<boolean> => {
    setUpdatingId(id);
    setSyncMessage("");

    const before = deadlines;
    const optimistic = deadlines.map((deadline) => (deadline.id === id ? { ...deadline, completed } : deadline));
    setDeadlines(optimistic);

    const confirmation = await confirmDeadlineStatus(id, completed);

    if (!confirmation) {
      setDeadlines(before);
      setSyncMessage(t("Could not sync deadline status right now."));
      setUpdatingId(null);
      return false;
    }

    const synced = optimistic.map((deadline) =>
      deadline.id === confirmation.deadline.id ? confirmation.deadline : deadline
    );
    setDeadlines(synced);
    if (completed) {
      hapticSuccess();
    }
    setSyncMessage(completed ? t("Marked complete.") : t("Saved as still working."));
    setUpdatingId(null);
    return true;
  };

  const sortedDeadlines = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return dueTimestamp(a.dueDate) - dueTimestamp(b.dueDate);
  });
  const visibleDeadlines = sortedDeadlines.slice(0, visibleCount);
  const hasMoreDeadlines = sortedDeadlines.length > visibleCount;

  const activeCount = deadlines.filter((deadline) => !deadline.completed).length;

  useEffect(() => {
    if (!focusDeadlineId) {
      return;
    }
    const focusedIndex = sortedDeadlines.findIndex((deadline) => deadline.id === focusDeadlineId);
    if (focusedIndex >= 0 && focusedIndex >= visibleCount) {
      setVisibleCount(focusedIndex + 1);
    }
  }, [focusDeadlineId, sortedDeadlines, visibleCount]);

  return (
    <section className="deadline-card">
      <div className="deadline-card-header">
        <div className="deadline-card-title-row">
          <span className="deadline-card-icon"><IconTarget size={18} /></span>
          <h2>{t("Deadlines")}</h2>
        </div>
        <div className="deadline-card-meta">
          {activeCount > 0 ? (
            <span className="deadline-badge">{t("{count} pending", { count: activeCount })}</span>
          ) : (
            <span className="deadline-badge deadline-badge-clear">{t("All clear")}</span>
          )}
          {!isOnline && <span className="deadline-badge deadline-badge-offline">{t("Offline")}</span>}
        </div>
      </div>

      {syncMessage && <p className="deadline-sync-toast">{syncMessage}</p>}

      <div className="deadline-list-container">
        {loading ? (
          <div className="deadline-loading">
            <span className="deadline-loading-dot" />
            <span className="deadline-loading-dot" />
            <span className="deadline-loading-dot" />
          </div>
        ) : sortedDeadlines.length > 0 ? (
          <>
            <ul className="dl-list">
            {visibleDeadlines.map((deadline) => {
              const urgency = getUrgencyClass(deadline.dueDate);
              return (
                <li
                  key={deadline.id}
                  id={`deadline-${deadline.id}`}
                  className={`dl-item ${deadline.completed ? "" : urgency} ${deadline.completed ? "dl-item--done" : ""} ${focusDeadlineId === deadline.id ? "dl-item--focused" : ""}`}
                >
                  <div className="dl-item-row">
                    <label className="dl-checkbox-label">
                      <input
                        type="checkbox"
                        checked={deadline.completed}
                        onChange={() => void setCompletion(deadline.id, !deadline.completed)}
                        className="dl-checkbox"
                        disabled={updatingId === deadline.id}
                      />
                      <span className="dl-checkbox-custom" />
                    </label>
                    <div className="dl-item-content">
                      <div className="dl-item-top">
                        <h3 className="dl-task">{formatDeadlineTaskLabel(deadline.task)}</h3>
                        <span className={`dl-time-badge ${urgency}`}>
                          {deadline.completed && urgency === "deadline-overdue"
                            ? t("Completed")
                            : formatTimeRemaining(deadline.dueDate)}
                        </span>
                      </div>
                      <div className="dl-item-bottom">
                        <span className="dl-course">{normalizeCourseCode(deadline.course)}</span>
                        <span className="dl-due">{formatDueDate(deadline.dueDate)}</span>
                      </div>
                    </div>
                  </div>
                  {!deadline.completed && urgency === "deadline-overdue" && (
                    <div className="dl-actions">
                      <button
                        type="button"
                        className="dl-action-btn dl-action-complete"
                        onClick={() => void setCompletion(deadline.id, true)}
                        disabled={updatingId === deadline.id}
                      >
                        ✓ {t("Complete")}
                      </button>
                      <button
                        type="button"
                        className="dl-action-btn dl-action-working"
                        onClick={() => void setCompletion(deadline.id, false)}
                        disabled={updatingId === deadline.id}
                      >
                        {t("Still working")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            </ul>
            {(hasMoreDeadlines || visibleCount > INITIAL_DEADLINE_BATCH_SIZE) && (
              <div className="deadline-list-actions">
                {hasMoreDeadlines ? (
                  <button
                    type="button"
                    className="deadline-list-more-btn"
                    onClick={() => setVisibleCount((count) => count + DEADLINE_BATCH_STEP)}
                  >
                    {t("Load more")}
                  </button>
                ) : null}
                {visibleCount > INITIAL_DEADLINE_BATCH_SIZE ? (
                  <button
                    type="button"
                    className="deadline-list-more-btn deadline-list-less-btn"
                    onClick={() => setVisibleCount(INITIAL_DEADLINE_BATCH_SIZE)}
                  >
                    {t("Show less")}
                  </button>
                ) : null}
                <p className="deadline-list-count">
                  {t("Showing {shown} of {total}", { shown: Math.min(visibleCount, sortedDeadlines.length), total: sortedDeadlines.length })}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="deadline-empty-state">
            <img className="empty-state-illustration" src={EMPTY_DEADLINES_SVG} alt="" width="120" height="120" />
            <p>{t("No deadlines tracked")}</p>
            <p className="deadline-empty-hint">{t("Add assignments to stay on top of your work")}</p>
            <p className="deadline-empty-hint connector-hint">{t("Connect Canvas or Blackboard in Settings → Integrations to auto-import deadlines")}</p>
          </div>
        )}
      </div>

    </section>
  );
}
