import { useEffect, useState } from "react";
import { getScheduledReminders, cancelScheduledReminder, ScheduledReminder } from "../lib/api";

function formatReminderTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isToday) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function recurrenceLabel(recurrence: string | null): string | null {
  if (!recurrence || recurrence === "none") return null;
  if (recurrence === "daily") return "Repeats daily";
  if (recurrence === "weekly") return "Repeats weekly";
  if (recurrence === "monthly") return "Repeats monthly";
  return null;
}

export function RemindersWidget(): JSX.Element | null {
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const data = await getScheduledReminders();
        if (!disposed) setReminders(data);
      } catch {
        /* offline — keep empty */
      }
      if (!disposed) setLoading(false);
    };

    void load();
    return () => { disposed = true; };
  }, []);

  const handleCancel = async (id: string): Promise<void> => {
    setCancellingId(id);
    try {
      await cancelScheduledReminder(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } catch {
      /* swallow */
    }
    setCancellingId(null);
  };

  if (loading) return null;
  if (reminders.length === 0) return null;

  return (
    <div className="reminders-card">
      <div className="reminders-card-header">
        <div className="reminders-card-title-row">
          <span className="reminders-card-icon">🔔</span>
          <h2>Reminders</h2>
        </div>
        <span className="reminders-badge">{reminders.length} upcoming</span>
      </div>
      <ul className="reminders-list">
        {reminders.map((r) => {
          const repeat = recurrenceLabel(r.recurrence);
          return (
            <li key={r.id} className="reminder-item">
              <div className="reminder-content">
                <div className="reminder-header">
                  <span className="reminder-title">
                    {r.icon && <span className="reminder-icon">{r.icon}</span>}
                    {r.title}
                  </span>
                  <button
                    className="reminder-cancel-btn"
                    onClick={() => handleCancel(r.id)}
                    disabled={cancellingId === r.id}
                    title="Cancel reminder"
                    aria-label={`Cancel reminder: ${r.title}`}
                  >
                    {cancellingId === r.id ? "…" : "✕"}
                  </button>
                </div>
                <p className="reminder-message">{r.message}</p>
                <div className="reminder-meta">
                  <span className="reminder-time">{formatReminderTime(r.scheduledFor)}</span>
                  {repeat && <span className="reminder-recurrence">{repeat}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
