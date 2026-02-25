import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  getCanvasStatus,
  getGeminiStatus,
  triggerCanvasSync
} from "../lib/api";
import { saveCanvasStatus } from "../lib/storage";
import type {
  CanvasStatus,
  GeminiStatus
} from "../types";
import { IconGradCap, IconSparkles, IconCalendar } from "./Icons";

function formatRelative(timestamp: string | null): string {
  if (!timestamp) return "Never";

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

type IntegrationId = "canvas" | "gemini" | "ical";

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  description: string;
  icon: ReactNode;
  status: "connected" | "configured" | "not-configured" | "syncing";
  detail?: string;
  action?: { label: string; handler: () => void; disabled?: boolean };
}

export function IntegrationStatusView(): JSX.Element {
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({
    baseUrl: "",
    lastSyncedAt: null,
    courses: []
  });
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({
    apiConfigured: false,
    model: "unknown",
    rateLimitRemaining: null,
    rateLimitSource: "provider",
    lastRequestAt: null
  });
  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");

  useEffect(() => {
    const loadStatuses = async (): Promise<void> => {
      const [canvas, gemini] = await Promise.all([getCanvasStatus(), getGeminiStatus()]);
      setCanvasStatus(canvas);
      setGeminiStatus(gemini);
    };

    void loadStatuses();
  }, []);

  const handleCanvasSync = async (): Promise<void> => {
    setCanvasSyncing(true);
    setCanvasMessage("");

    const result = await triggerCanvasSync(undefined);
    setCanvasMessage(result.success ? "Synced successfully" : result.error ?? "Sync failed");

    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);
    setTimeout(() => setCanvasMessage(""), 3000);
  };

  const integrations: IntegrationDef[] = [
    {
      id: "canvas",
      name: "Canvas LMS",
      description: "Courses, assignments, deadlines, grades",
      icon: <IconGradCap size={18} />,
      status: canvasSyncing ? "syncing" : canvasStatus.lastSyncedAt ? "connected" : "not-configured",
      detail: canvasStatus.lastSyncedAt
        ? `${canvasStatus.courses.length} courses · Synced ${formatRelative(canvasStatus.lastSyncedAt)}`
        : "Connect Canvas in Integrations to start syncing",
      action: {
        label: canvasSyncing ? "Syncing…" : "Sync",
        handler: () => void handleCanvasSync(),
        disabled: canvasSyncing
      }
    },
    {
      id: "gemini",
      name: "Gemini AI",
      description: "Conversational AI, summaries, coaching",
      icon: <IconSparkles size={18} />,
      status: geminiStatus.apiConfigured ? "connected" : "not-configured",
      detail: geminiStatus.apiConfigured
        ? `${geminiStatus.model} · Last used ${formatRelative(geminiStatus.lastRequestAt)}`
        : "Add GEMINI_API_KEY to connect"
    },
    {
      id: "ical",
      name: "TP EduCloud (iCal)",
      description: "Schedule events from your iCal timetable feed",
      icon: <IconCalendar size={18} />,
      status: "configured",
      detail: "Configured via your TP iCal subscription · Syncs weekly"
    }
  ];

  const statusBadge = (status: IntegrationDef["status"]): JSX.Element => {
    const classes: Record<IntegrationDef["status"], string> = {
      connected: "intg-badge intg-badge-connected",
      configured: "intg-badge intg-badge-configured",
      "not-configured": "intg-badge intg-badge-inactive",
      syncing: "intg-badge intg-badge-syncing"
    };
    const labels: Record<IntegrationDef["status"], string> = {
      connected: "Connected",
      configured: "Configured",
      "not-configured": "Not connected",
      syncing: "Syncing…"
    };
    return <span className={classes[status]}>{labels[status]}</span>;
  };

  return (
    <section className="intg-hub">
      {canvasMessage && <p className="intg-toast">{canvasMessage}</p>}

      <div className="intg-grid">
        {integrations.map((intg) => (
          <div key={intg.id} className={`intg-card ${intg.status === "not-configured" ? "intg-card-inactive" : ""}`}>
            <div className="intg-card-header">
              <span className="intg-card-icon">{intg.icon}</span>
              <div className="intg-card-title">
                <h4>{intg.name}</h4>
                {statusBadge(intg.status)}
              </div>
            </div>
            <p className="intg-card-desc">{intg.description}</p>
            <p className="intg-card-detail">{intg.detail}</p>
            {intg.action && (
              <button
                type="button"
                className="intg-card-action"
                onClick={intg.action.handler}
                disabled={intg.action.disabled}
              >
                {intg.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
