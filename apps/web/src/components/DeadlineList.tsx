import { useEffect, useState } from "react";
import { confirmDeadlineStatus, getDeadlines } from "../lib/api";
import { hapticSuccess } from "../lib/haptics";
import { useI18n } from "../lib/i18n";
import { Deadline } from "../types";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

interface DeadlineListProps {
  focusDeadlineId?: string;
}

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

export function DeadlineList({ focusDeadlineId }: DeadlineListProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [syncMessage, setSyncMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const next = await getDeadlines();
      setDeadlines(next);
      setSyncMessage(t("Deadlines refreshed"));
      setTimeout(() => setSyncMessage(""), 2000);
    } catch { /* keep current state */ }
    setRefreshing(false);
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

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

  const activeCount = deadlines.filter((deadline) => !deadline.completed).length;

  return (
    <section className="deadline-card">
      <div className="deadline-card-header">
        <div className="deadline-card-title-row">
          <span className="deadline-card-icon">🎯</span>
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

      <div 
        ref={containerRef}
        className="pull-to-refresh-container"
      >
        {(isPulling || isRefreshing) && (
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            threshold={80}
            isRefreshing={isRefreshing}
          />
        )}
        {loading ? (
          <div className="deadline-loading">
            <span className="deadline-loading-dot" />
            <span className="deadline-loading-dot" />
            <span className="deadline-loading-dot" />
          </div>
        ) : sortedDeadlines.length > 0 ? (
          <ul className="dl-list">
            {sortedDeadlines.map((deadline) => {
              const urgency = getUrgencyClass(deadline.dueDate);
              return (
                <li
                  key={deadline.id}
                  id={`deadline-${deadline.id}`}
                  className={`dl-item ${urgency} ${deadline.completed ? "dl-item--done" : ""} ${focusDeadlineId === deadline.id ? "dl-item--focused" : ""}`}
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
                          {formatTimeRemaining(deadline.dueDate)}
                        </span>
                      </div>
                      <div className="dl-item-bottom">
                        <span className="dl-course">{deadline.course}</span>
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
        ) : (
          <div className="deadline-empty-state">
            <span className="deadline-empty-icon">✅</span>
            <p>{t("No deadlines tracked")}</p>
            <p className="deadline-empty-hint">{t("Add assignments to stay on top of your work")}</p>
          </div>
        )}
      </div>

    </section>
  );
}
