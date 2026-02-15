import { useState } from "react";
import { confirmDeadlineStatus } from "../lib/api";
import { Notification } from "../types";

interface NotificationFeedProps {
  notifications: Notification[];
}

export function NotificationFeed({ notifications }: NotificationFeedProps): JSX.Element {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const extractDeadlineId = (message: string): string | null => {
    const match = message.match(/\/api\/deadlines\/([^/]+)\/confirm-status/);
    return match ? match[1] : null;
  };

  const isDeadlineStatusCheck = (notification: Notification): boolean => {
    return notification.title === "Deadline status check" && notification.source === "assignment-tracker";
  };

  const handleConfirmStatus = async (deadlineId: string, completed: boolean): Promise<void> => {
    setUpdatingId(deadlineId);
    setStatusMessage("");

    const confirmation = await confirmDeadlineStatus(deadlineId, completed);

    if (!confirmation) {
      setStatusMessage("Could not sync deadline status right now.");
      setUpdatingId(null);
      return;
    }

    setStatusMessage(completed ? "Marked complete." : "Saved as still working.");
    setUpdatingId(null);

    setTimeout(() => {
      setStatusMessage("");
    }, 3000);
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Notifications</h2>
      </header>
      {statusMessage && <p className="notification-status-message">{statusMessage}</p>}
      <ul className="feed">
        {notifications.slice(0, 10).map((item) => {
          const deadlineId = isDeadlineStatusCheck(item) ? extractDeadlineId(item.message) : null;

          return (
            <li key={item.id} className={`feed-item priority-${item.priority}`}>
              <div className="feed-title-row">
                <strong>{item.title}</strong>
                <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
              <p>{item.message}</p>
              {deadlineId && (
                <div className="notification-actions">
                  <button
                    type="button"
                    onClick={() => void handleConfirmStatus(deadlineId, true)}
                    disabled={updatingId === deadlineId}
                    className="action-button action-complete"
                  >
                    Mark complete
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmStatus(deadlineId, false)}
                    disabled={updatingId === deadlineId}
                    className="action-button action-working"
                  >
                    Still working
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
