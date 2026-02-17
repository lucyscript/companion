import { useEffect, useState } from "react";
import { getNotificationInteractions } from "../lib/api";
import { apiUrl } from "../lib/config";
import { NotificationInteraction, NotificationInteractionType, AgentName } from "../types";

async function retriggerNotification(title: string, message: string, priority: string): Promise<void> {
  try {
    await fetch(apiUrl("/api/push/test"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title, message, priority })
    });
  } catch (error) {
    console.error("Failed to retrigger notification:", error);
  }
}

export function NotificationHistoryView(): JSX.Element {
  const [interactions, setInteractions] = useState<NotificationInteraction[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<NotificationInteractionType | "all">("all");
  const [filterSource, setFilterSource] = useState<AgentName | "all">("all");

  useEffect(() => {
    void refresh();
  }, []);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setError("");

    const response = await getNotificationInteractions({ limit: 100 });
    setInteractions(response);
    setBusy(false);
  };

  const handleRetrigger = async (interaction: NotificationInteraction): Promise<void> => {
    const message = `Re-triggered: ${interaction.notificationTitle}`;
    await retriggerNotification(
      interaction.notificationTitle,
      message,
      interaction.notificationPriority
    );
  };

  const filteredInteractions = interactions.filter((interaction) => {
    if (filterType !== "all" && interaction.interactionType !== filterType) {
      return false;
    }
    if (filterSource !== "all" && interaction.notificationSource !== filterSource) {
      return false;
    }
    return true;
  });

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const formatTimeToInteraction = (ms?: number): string => {
    if (!ms) {
      return "";
    }
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }
    return `${Math.round(ms / 60000)}m`;
  };

  const getInteractionIcon = (type: NotificationInteractionType): string => {
    switch (type) {
      case "tap":
        return "👆";
      case "dismiss":
        return "❌";
      case "action":
        return "⚡";
      default:
        return "📋";
    }
  };

  return (
    <section className="panel notification-history-panel">
      <header className="panel-header">
        <h2>Notification History</h2>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Loading..." : "Refresh"}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="notification-history-filters">
        <label>
          Type:
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as NotificationInteractionType | "all")}
          >
            <option value="all">All</option>
            <option value="tap">Tapped</option>
            <option value="dismiss">Dismissed</option>
            <option value="action">Action</option>
          </select>
        </label>
        <label>
          Source:
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as AgentName | "all")}
          >
            <option value="all">All</option>
            <option value="orchestrator">Orchestrator</option>
            <option value="notes">Notes</option>
            <option value="lecture-plan">Lecture Plan</option>
            <option value="assignment-tracker">Assignment Tracker</option>
          </select>
        </label>
      </div>

      {filteredInteractions.length === 0 ? (
        <p className="notification-history-empty">
          {busy ? "Loading..." : "No notification interactions found."}
        </p>
      ) : (
        <ul className="notification-history-list">
          {filteredInteractions.map((interaction) => (
            <li
              key={interaction.id}
              className={`notification-history-item priority-${interaction.notificationPriority}`}
            >
              <div className="notification-history-header">
                <span className="notification-history-icon">
                  {getInteractionIcon(interaction.interactionType)}
                </span>
                <div className="notification-history-title-row">
                  <strong>{interaction.notificationTitle}</strong>
                  <span className="notification-history-timestamp">
                    {formatTimestamp(interaction.timestamp)}
                  </span>
                </div>
              </div>
              <div className="notification-history-details">
                <span className="notification-history-badge">
                  {interaction.notificationSource}
                </span>
                <span className="notification-history-badge">
                  {interaction.notificationPriority}
                </span>
                <span className="notification-history-badge">
                  {interaction.interactionType}
                </span>
                {interaction.actionType && (
                  <span className="notification-history-badge">
                    Action: {interaction.actionType}
                  </span>
                )}
                {interaction.timeToInteractionMs && (
                  <span className="notification-history-time">
                    Response: {formatTimeToInteraction(interaction.timeToInteractionMs)}
                  </span>
                )}
              </div>
              {interaction.interactionType === "dismiss" && (
                <button
                  type="button"
                  className="notification-history-retrigger"
                  onClick={() => void handleRetrigger(interaction)}
                >
                  Re-trigger
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
