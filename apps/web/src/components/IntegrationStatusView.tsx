import { useEffect, useState } from "react";
import {
  getCanvasStatus,
  getGeminiStatus,
  getIntegrationHealthLog,
  getIntegrationHealthSummary,
  triggerCanvasSync
} from "../lib/api";
import { loadCanvasSettings, saveCanvasStatus } from "../lib/storage";
import type {
  CanvasStatus,
  GeminiStatus,
  IntegrationHealthAttempt,
  IntegrationHealthSummary,
  IntegrationSyncAttemptStatus,
  IntegrationSyncName
} from "../types";

const DEFAULT_HEALTH_WINDOW_HOURS = 24 * 7;

type IntegrationFilter = IntegrationSyncName | "all";
type StatusFilter = IntegrationSyncAttemptStatus | "all";

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

function formatRootCause(rootCause: string): string {
  return rootCause.replace(/_/g, " ");
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
  const [healthSummary, setHealthSummary] = useState<IntegrationHealthSummary | null>(null);
  const [healthAttempts, setHealthAttempts] = useState<IntegrationHealthAttempt[]>([]);

  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");

  const [healthLoading, setHealthLoading] = useState(false);
  const [healthMessage, setHealthMessage] = useState("");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("failure");
  const [windowHours, setWindowHours] = useState(DEFAULT_HEALTH_WINDOW_HOURS);

  const loadIntegrationHealth = async (
    options: {
      integration?: IntegrationFilter;
      status?: StatusFilter;
      window?: number;
    } = {}
  ): Promise<void> => {
    setHealthLoading(true);
    setHealthMessage("");

    const selectedIntegration = options.integration ?? integrationFilter;
    const selectedStatus = options.status ?? statusFilter;
    const selectedWindow = options.window ?? windowHours;

    try {
      const [summary, attempts] = await Promise.all([
        getIntegrationHealthSummary(selectedWindow),
        getIntegrationHealthLog({
          integration: selectedIntegration === "all" ? undefined : selectedIntegration,
          status: selectedStatus === "all" ? undefined : selectedStatus,
          limit: 8,
          hours: selectedWindow
        })
      ]);
      setHealthSummary(summary);
      setHealthAttempts(attempts);
    } catch {
      setHealthMessage("Could not load integration health right now.");
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    const loadStatuses = async (): Promise<void> => {
      const [canvas, gemini] = await Promise.all([getCanvasStatus(), getGeminiStatus()]);
      setCanvasStatus(canvas);
      setGeminiStatus(gemini);
      await loadIntegrationHealth({
        integration: "all",
        status: "failure",
        window: DEFAULT_HEALTH_WINDOW_HOURS
      });
    };

    void loadStatuses();
  }, []);

  const handleCanvasSync = async (): Promise<void> => {
    setCanvasSyncing(true);
    setCanvasMessage("");

    const settings = loadCanvasSettings();
    const result = await triggerCanvasSync(settings);
    setCanvasMessage(result.success ? "Canvas synced successfully." : result.error ?? "Canvas sync failed.");

    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);

    await loadIntegrationHealth();
  };

  const handleRefreshHealth = async (): Promise<void> => {
    await loadIntegrationHealth();
  };

  const handleIntegrationFilterChange = (value: IntegrationFilter): void => {
    setIntegrationFilter(value);
    void loadIntegrationHealth({ integration: value });
  };

  const handleStatusFilterChange = (value: StatusFilter): void => {
    setStatusFilter(value);
    void loadIntegrationHealth({ status: value });
  };

  const handleWindowChange = (value: number): void => {
    setWindowHours(value);
    void loadIntegrationHealth({ window: value });
  };

  const canvasStatusLabel = canvasSyncing
    ? "Syncing..."
    : canvasStatus.lastSyncedAt
      ? "Connected"
      : "Not synced yet";
  const canvasStatusClass = canvasSyncing
    ? "status-running"
    : canvasStatus.lastSyncedAt
      ? "status-running"
      : "status-idle";

  const geminiStatusLabel = geminiStatus.apiConfigured ? "Configured" : "Not configured";
  const geminiStatusClass = geminiStatus.apiConfigured ? "status-running" : "status-idle";
  const geminiRateLimitLabel =
    geminiStatus.rateLimitRemaining === null ? "Provider-managed" : String(geminiStatus.rateLimitRemaining);

  const healthStatusLabel = healthSummary
    ? `${healthSummary.totals.successRate}% success`
    : "No sync data";
  const healthStatusClass =
    (healthSummary?.totals.failures ?? 0) > 0 ? "status-error" : "status-running";

  return (
    <section id="integration-status-panel" className="panel">
      <header className="panel-header">
        <h2>Integrations</h2>
      </header>

      <div className="settings-stack">
        <div className="panel">
          <header className="panel-header">
            <h3>Canvas LMS</h3>
            <span className={`status ${canvasStatusClass}`}>{canvasStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Last synced</p>
              <strong>{formatRelative(canvasStatus.lastSyncedAt)}</strong>
            </div>
            <button type="button" onClick={() => void handleCanvasSync()} disabled={canvasSyncing}>
              {canvasSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          {canvasMessage && <p>{canvasMessage}</p>}

          <div>
            <p className="muted">Synced courses: {canvasStatus.courses.length}</p>
          </div>
        </div>

        <div className="panel">
          <header className="panel-header">
            <h3>TP EduCloud Schedule</h3>
            <span className="status status-idle">Manual import</span>
          </header>
          <p className="muted">TP lecture plans are imported from your iCal URL in the Calendar Import section below.</p>
        </div>

        <div className="panel">
          <header className="panel-header">
            <h3>Gemini AI</h3>
            <span className={`status ${geminiStatusClass}`}>{geminiStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Model</p>
              <strong>{geminiStatus.model}</strong>
            </div>
          </div>

          <div className="panel-header">
            <div>
              <p className="muted">Last request</p>
              <strong>{formatRelative(geminiStatus.lastRequestAt)}</strong>
            </div>
            <div>
              <p className="muted">Rate limit</p>
              <strong>{geminiRateLimitLabel}</strong>
            </div>
          </div>

          {geminiStatus.error && <p className="error">{geminiStatus.error}</p>}
        </div>

        <div className="panel">
          <header className="panel-header">
            <h3>Integration Health</h3>
            <span className={`status ${healthStatusClass}`}>{healthStatusLabel}</span>
          </header>

          <div className="panel-header integration-health-controls">
            <label>
              <span className="muted">Integration</span>
              <select
                value={integrationFilter}
                onChange={(event) => handleIntegrationFilterChange(event.target.value as IntegrationFilter)}
              >
                <option value="all">All</option>
                <option value="tp">TP</option>
                <option value="canvas">Canvas</option>
                <option value="gmail">Gmail</option>
              </select>
            </label>
            <label>
              <span className="muted">Status</span>
              <select value={statusFilter} onChange={(event) => handleStatusFilterChange(event.target.value as StatusFilter)}>
                <option value="failure">Failures</option>
                <option value="success">Successes</option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              <span className="muted">Window</span>
              <select value={windowHours} onChange={(event) => handleWindowChange(Number(event.target.value))}>
                <option value={24}>24h</option>
                <option value={72}>72h</option>
                <option value={24 * 7}>7d</option>
              </select>
            </label>
            <button type="button" onClick={() => void handleRefreshHealth()} disabled={healthLoading}>
              {healthLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="integration-health-metrics">
            {healthSummary?.integrations.map((item) => (
              <div key={item.integration} className="integration-health-metric-card">
                <p className="muted">{item.integration.toUpperCase()}</p>
                <strong>{item.successRate}% success</strong>
                <p className="muted">Avg latency: {item.averageLatencyMs}ms</p>
                <p className="muted">Last attempt: {formatRelative(item.lastAttemptAt)}</p>
              </div>
            ))}
          </div>

          <div className="integration-health-attempts">
            <p className="muted">Recent attempts</p>
            {healthAttempts.length === 0 ? (
              <p className="muted">No matching attempts in this window.</p>
            ) : (
              <ul>
                {healthAttempts.map((attempt) => (
                  <li key={attempt.id} className="integration-health-attempt-item">
                    <div>
                      <strong>{attempt.integration.toUpperCase()}</strong>
                      <span className={`status ${attempt.status === "success" ? "status-running" : "status-error"}`}>
                        {attempt.status}
                      </span>
                      <span className="status status-idle">{formatRootCause(attempt.rootCause)}</span>
                    </div>
                    <p className="muted">
                      {attempt.latencyMs}ms • {formatRelative(attempt.attemptedAt)}
                    </p>
                    {attempt.errorMessage && <p className="muted">{attempt.errorMessage}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {healthMessage && <p className="error">{healthMessage}</p>}
        </div>
      </div>
    </section>
  );
}
