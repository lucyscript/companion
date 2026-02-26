import { useEffect, useState } from "react";
import { getScheduledReminders, cancelScheduledReminder, ScheduledReminder } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { IconBell } from "./Icons";

function formatReminderTime(
  iso: string,
  t: (text: string, vars?: Record<string, string | number>) => string,
  localeTag: string
): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", hour12: false });

  if (isToday) return t("Today {time}", { time });
  if (isTomorrow) return t("Tomorrow {time}", { time });
  return `${d.toLocaleDateString(localeTag, { month: "short", day: "numeric" })} ${time}`;
}

function recurrenceLabel(
  recurrence: string | null,
  t: (text: string, vars?: Record<string, string | number>) => string
): string | null {
  if (!recurrence || recurrence === "none") return null;
  if (recurrence === "daily") return t("Repeats daily");
  if (recurrence === "weekly") return t("Repeats weekly");
  if (recurrence === "monthly") return t("Repeats monthly");
  return null;
}

export function RemindersWidget(): JSX.Element | null {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
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

  return (
    <div className="reminders-card">
      <div className="reminders-card-header">
        <div className="reminders-card-title-row">
          <span className="reminders-card-icon"><IconBell size={18} /></span>
          <h2>{t("Reminders")}</h2>
        </div>
        {reminders.length > 0 && <span className="reminders-badge">{t("{count} upcoming", { count: reminders.length })}</span>}
      </div>
      {reminders.length === 0 ? (
        <p className="reminders-empty">{t("No active reminders")}</p>
      ) : (
      <ul className="reminders-list">
        {reminders.map((r) => {
          const repeat = recurrenceLabel(r.recurrence, t);
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
                    title={t("Cancel reminder")}
                    aria-label={t("Cancel reminder: {title}", { title: r.title })}
                  >
                    {cancellingId === r.id ? "…" : "✕"}
                  </button>
                </div>
                <p className="reminder-message">{r.message}</p>
                <div className="reminder-meta">
                  <span className="reminder-time">{formatReminderTime(r.scheduledFor, t, localeTag)}</span>
                  {repeat && <span className="reminder-recurrence">{repeat}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}
