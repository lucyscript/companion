import { useCallback, useEffect, useState } from "react";
import {
  ConnectorService,
  UserConnection,
  CanvasStatus,
  GeminiStatus,
  McpServerConfig,
  McpServerTemplate,
  UserPlanInfo
} from "../types";
import {
  connectService,
  connectMcpTemplate,
  getMcpCatalogTemplates,
  deleteMcpServer,
  disconnectService,
  getCanvasStatus,
  getConnectors,
  getGeminiStatus,
  getMcpServers
} from "../lib/api";
import {
  loadCanvasSettings,
  loadIntegrationScopeSettings,
  saveCanvasSettings,
  saveCanvasStatus,
  saveIntegrationScopeSettings
} from "../lib/storage";

interface ConnectorMeta {
  service: ConnectorService;
  label: string;
  icon: { src: string; alt: string };
  description: string;
  type: "token" | "oauth" | "config" | "url";
  placeholder?: string;
  configFields?: { key: string; label: string; placeholder: string; type?: "text" | "password" | "url" }[];
}

interface GeminiCard {
  service: "gemini";
  label: string;
  icon: { src: string; alt: string };
  description: string;
}

interface ConnectorsViewProps {
  planInfo: UserPlanInfo | null;
  onUpgrade: () => void;
}

function iconPath(path: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getDefaultInputValues(): Record<string, string> {
  return {
    canvas_baseUrl: loadCanvasSettings().baseUrl,
    mcp_token: ""
  };
}

const CONNECTORS: ConnectorMeta[] = [
  {
    service: "canvas",
    label: "Canvas LMS",
    icon: { src: iconPath("icons/integrations/canvas.svg"), alt: "Canvas" },
    description: "Courses, assignments, deadlines, and grades from your Canvas instance.",
    type: "token",
    placeholder: "Paste your Canvas access token"
  },
  {
    service: "mcp",
    label: "Connected Apps",
    icon: { src: iconPath("icons/integrations/connected-apps-custom.svg"), alt: "Connected apps" },
    description: "Connect trusted external apps like GitHub.",
    type: "config"
  },
  {
    service: "withings",
    label: "Withings Health",
    icon: { src: iconPath("icons/integrations/withings.png"), alt: "Withings" },
    description: "Sleep, weight, and health data from Withings devices.",
    type: "oauth"
  },
  {
    service: "tp_schedule",
    label: "TP EduCloud Schedule",
    icon: { src: iconPath("icons/integrations/tp.svg"), alt: "TP EduCloud" },
    description: "Lecture schedule via iCal subscription from TP.",
    type: "url",
    placeholder: "Paste your TP iCal URL here"
  }
];

const GEMINI_CARD: GeminiCard = {
  service: "gemini",
  label: "Gemini AI",
  icon: { src: iconPath("icons/integrations/gemini.svg"), alt: "Gemini" },
  description: "Conversational AI, summaries, coaching"
};

const GITHUB_MCP_ICON = { src: iconPath("icons/integrations/github.svg"), alt: "GitHub" };

const FREE_TIER_SERVICES: ConnectorService[] = ["canvas", "tp_schedule"];
const CONNECTED_APPS_SERVICES: ConnectorService[] = ["mcp"];

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

function formatConnectedAppLabel(label: string): string {
  const trimmed = label.trim();
  if (/^github\b/i.test(trimmed) && /repos?\s*read-?only/i.test(trimmed)) {
    return "GitHub (read-only repos)";
  }

  return trimmed
    .replace(/\bMCP\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function isGithubMcpText(value: string): boolean {
  return /github/i.test(value);
}

function getMcpTemplateIcon(template: McpServerTemplate): { src: string; alt: string } | null {
  if (isGithubMcpText(template.provider) || isGithubMcpText(template.label)) {
    return GITHUB_MCP_ICON;
  }
  return null;
}

function getMcpServerIcon(server: McpServerConfig): { src: string; alt: string } | null {
  if (isGithubMcpText(server.label) || isGithubMcpText(server.serverUrl)) {
    return GITHUB_MCP_ICON;
  }
  return null;
}

export function ConnectorsView({ planInfo, onUpgrade }: ConnectorsViewProps): JSX.Element {
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState<ConnectorService | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => getDefaultInputValues());
  const [submitting, setSubmitting] = useState<ConnectorService | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({ baseUrl: "", lastSyncedAt: null, courses: [] });
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpTemplates, setMcpTemplates] = useState<McpServerTemplate[]>([]);
  const [selectedMcpTemplateId, setSelectedMcpTemplateId] = useState<string | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({
    apiConfigured: false,
    model: "unknown",
    rateLimitRemaining: null,
    lastRequestAt: null
  });

  const fetchConnections = useCallback(async () => {
    try {
      const data = await getConnectors();
      setConnections(data);
    } catch {
      // Silent fallback for fresh accounts
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConnectorMeta = useCallback(async () => {
    try {
      const [canvas, gemini, mcp, mcpCatalog] = await Promise.all([
        getCanvasStatus(),
        getGeminiStatus(),
        getMcpServers(),
        getMcpCatalogTemplates()
      ]);
      setCanvasStatus(canvas);
      setGeminiStatus(gemini);
      setMcpServers(mcp);
      setMcpTemplates(mcpCatalog);
    } catch {
      // Best effort status hydration
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
    })();
  }, [fetchConnections, fetchConnectorMeta]);

  const isConnected = (service: ConnectorService): boolean =>
    connections.some((connection) => connection.service === service);

  const getConnection = (service: ConnectorService): UserConnection | undefined =>
    connections.find((connection) => connection.service === service);

  const withingsConnector = CONNECTORS.find((connector) => connector.service === "withings") ?? null;

  const getStatusDetail = (service: ConnectorService): string | null => {
    if (service === "canvas" && canvasStatus.lastSyncedAt) {
      return `${canvasStatus.courses.length} courses · Synced ${formatRelative(canvasStatus.lastSyncedAt)}`;
    }
    if (service === "mcp") {
      const withingsConnected = connections.some((connection) => connection.service === "withings");
      const connectedApps = mcpServers.length + (withingsConnected ? 1 : 0);
      if (connectedApps > 0) {
        return connectedApps === 1 ? "1 app connected" : `${connectedApps} apps connected`;
      }
    }
    return null;
  };

  const handleToggleExpand = (service: ConnectorService): void => {
    if (isConnected(service) && service !== "mcp") {
      return;
    }
    setExpandedService((prev) => (prev === service ? null : service));
    setError(null);
  };

  const handleInputChange = (key: string, value: string): void => {
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const selectedMcpTemplate =
    selectedMcpTemplateId !== null
      ? (mcpTemplates.find((template) => template.id === selectedMcpTemplateId) ?? null)
      : null;

  const handleApplyMcpTemplate = (template: McpServerTemplate): void => {
    setSelectedMcpTemplateId(template.id);
    setInputValues((prev) => ({
      ...prev,
      mcp_token: ""
    }));
    setExpandedService("mcp");
    setError(null);
  };

  const extractErrorMessage = (err: unknown, fallback: string): string => {
    const message = err instanceof Error ? err.message : fallback;
    try {
      const parsed = JSON.parse(message) as { error?: string };
      return parsed.error ?? message;
    } catch {
      return message;
    }
  };

  const handleConnectMcpTemplate = async (template: McpServerTemplate, token?: string): Promise<void> => {
    setSubmitting("mcp");
    setError(null);
    try {
      const result = await connectMcpTemplate(template.id, token && token.trim().length > 0 ? { token: token.trim() } : {});
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
      setExpandedService("mcp");
      setInputValues((prev) => ({
        ...prev,
        mcp_token: ""
      }));
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to connect app template"));
    } finally {
      setSubmitting(null);
    }
  };

  const handleConnect = async (connector: ConnectorMeta): Promise<void> => {
    setSubmitting(connector.service);
    setError(null);

    try {
      if (connector.type === "oauth") {
        const result = await connectService(connector.service, {});
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
      } else if (connector.type === "token") {
        const token = inputValues[connector.service]?.trim();
        if (!token) {
          setError("Please enter a token");
          setSubmitting(null);
          return;
        }

        if (connector.service === "canvas") {
          const baseUrl = inputValues.canvas_baseUrl?.trim();
          if (!baseUrl || !baseUrl.startsWith("http")) {
            setError("Please enter a valid Canvas base URL");
            setSubmitting(null);
            return;
          }

          await connectService(connector.service, { token, baseUrl });
          const current = loadCanvasSettings();
          saveCanvasSettings({ ...current, baseUrl });
        }
      } else if (connector.type === "config") {
        if (connector.service === "mcp") {
          setError("Use a verified app template to connect.");
          setSubmitting(null);
          return;
        } else {
          const body: Record<string, string> = {};
          for (const field of connector.configFields ?? []) {
            const val = inputValues[`${connector.service}_${field.key}`]?.trim();
            if (!val) {
              setError(`Please fill in ${field.label}`);
              setSubmitting(null);
              return;
            }
            body[field.key] = val;
          }
          await connectService(connector.service, body);
        }
      } else if (connector.type === "url") {
        const url = inputValues[connector.service]?.trim();
        if (!url || !url.startsWith("http")) {
          setError("Please enter a valid URL");
          setSubmitting(null);
          return;
        }

        await connectService(connector.service, { icalUrl: url });
      }

      await Promise.all([fetchConnections(), fetchConnectorMeta()]);

      if (connector.service === "mcp") {
        setExpandedService("mcp");
        setInputValues((prev) => ({
          ...prev,
          mcp_token: ""
        }));
        setSelectedMcpTemplateId(null);
      } else {
        setExpandedService(null);
        setInputValues(getDefaultInputValues());
      }
    } catch (err) {
      setError(extractErrorMessage(err, "Connection failed"));
    } finally {
      setSubmitting(null);
    }
  };

  const handleDisconnect = async (service: ConnectorService): Promise<void> => {
    setSubmitting(service);
    setError(null);

    try {
      await disconnectService(service);
      if (service === "canvas") {
        const clearedCanvasStatus: CanvasStatus = {
          baseUrl: "",
          lastSyncedAt: null,
          courses: []
        };
        setCanvasStatus(clearedCanvasStatus);
        saveCanvasStatus(clearedCanvasStatus);

        const currentScope = loadIntegrationScopeSettings();
        if (currentScope.canvasCourseIds.length > 0) {
          saveIntegrationScopeSettings({
            ...currentScope,
            canvasCourseIds: []
          });
        }
      }
      if (service === "mcp") {
        setMcpServers([]);
        setSelectedMcpTemplateId(null);
      }
      await fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setSubmitting(null);
    }
  };

  const handleDeleteMcpServer = async (serverId: string): Promise<void> => {
    setSubmitting("mcp");
    setError(null);
    try {
      await deleteMcpServer(serverId);
      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove connected app");
    } finally {
      setSubmitting(null);
    }
  };

  const handleDisconnectConnectedApps = async (): Promise<void> => {
    setSubmitting("mcp");
    setError(null);
    try {
      const pending: Promise<unknown>[] = [];
      if (isConnected("mcp")) {
        pending.push(disconnectService("mcp"));
      }
      if (isConnected("withings")) {
        pending.push(disconnectService("withings"));
      }
      if (pending.length === 0) {
        return;
      }
      await Promise.all(pending);
      setMcpServers([]);
      setSelectedMcpTemplateId(null);
      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
    } catch (err) {
      setError(extractErrorMessage(err, "Disconnect failed"));
    } finally {
      setSubmitting(null);
    }
  };

  const isPaidPlan = planInfo ? planInfo.plan !== "free" : false;
  const freeTierConnectors = FREE_TIER_SERVICES
    .map((service) => CONNECTORS.find((connector) => connector.service === service))
    .filter((connector): connector is ConnectorMeta => connector !== undefined);
  const connectedAppConnectors = CONNECTED_APPS_SERVICES
    .map((service) => CONNECTORS.find((connector) => connector.service === service))
    .filter((connector): connector is ConnectorMeta => connector !== undefined);

  const renderConnectorCard = (connector: ConnectorMeta): JSX.Element => {
    const withingsConnected = isConnected("withings");
    const mcpConnected = isConnected("mcp");
    const connected =
      connector.service === "mcp"
        ? mcpConnected || withingsConnected || mcpServers.length > 0
        : isConnected(connector.service);
    const connection = getConnection(connector.service);
    const expanded = expandedService === connector.service && (!connected || connector.service === "mcp");
    const busy =
      connector.service === "mcp"
        ? submitting === "mcp" || submitting === "withings"
        : submitting === connector.service;
    const statusDetail = connected ? getStatusDetail(connector.service) : null;

    return (
      <div
        key={connector.service}
        className={`connector-card ${connected ? "connector-connected" : ""} ${expanded ? "connector-expanded" : ""}`}
      >
        <div
          className="connector-header"
          onClick={() => handleToggleExpand(connector.service)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => event.key === "Enter" && handleToggleExpand(connector.service)}
        >
          <span className="connector-icon">
            <img className="connector-icon-image" src={connector.icon.src} alt={connector.icon.alt} />
          </span>
          <div className="connector-info">
            <span className="connector-label">{connector.label}</span>
            {connected && statusDetail && (
              <span className="connector-display-label">{statusDetail}</span>
            )}
            {connected && !statusDetail && connection?.displayLabel && (
              <span className="connector-display-label">{connection.displayLabel}</span>
            )}
            {!connected && (
              <span className="connector-desc">{connector.description}</span>
            )}
          </div>
          <div className="connector-status">
            {connected ? (
              <span className="connector-badge connector-badge-connected">Connected</span>
            ) : (
              <span className="connector-badge connector-badge-disconnected">Not connected</span>
            )}
          </div>
        </div>

        {connected && (
          <div className="connector-actions">
            {connector.service !== "mcp" && (
              <span className="connector-connected-since">
                Connected {new Date(connection!.connectedAt).toLocaleDateString()}
              </span>
            )}
            {connector.service === "mcp" && (
              <button
                className="connector-sync-btn"
                onClick={() => handleToggleExpand("mcp")}
                disabled={busy}
              >
                {expanded ? "Close" : "Manage"}
              </button>
            )}
            <button
              className="connector-disconnect-btn"
              onClick={() => void (connector.service === "mcp" ? handleDisconnectConnectedApps() : handleDisconnect(connector.service))}
              disabled={busy}
            >
              {busy ? "Disconnecting..." : connector.service === "mcp" ? "Disconnect all" : "Disconnect"}
            </button>
          </div>
        )}

        {expanded && (
          <div className="connector-setup">
            {connector.type === "token" && (
              <div className={`connector-token-input ${connector.service === "canvas" ? "connector-token-input-canvas" : ""}`}>
                {connector.service === "canvas" && (
                  <div className="connector-input-block">
                    <label className="connector-input-label" htmlFor="canvas-base-url-input">
                      Canvas base URL
                    </label>
                    <input
                      id="canvas-base-url-input"
                      type="url"
                      placeholder="https://stavanger.instructure.com"
                      value={inputValues.canvas_baseUrl ?? ""}
                      onChange={(event) => handleInputChange("canvas_baseUrl", event.target.value)}
                      disabled={busy}
                    />
                    <p className="connector-input-hint">
                      Use your school Canvas root URL (no <code>/courses</code>).
                    </p>
                  </div>
                )}
                <div className="connector-input-block">
                  {connector.service === "canvas" && (
                    <label className="connector-input-label" htmlFor="canvas-token-input">
                      Canvas API token
                    </label>
                  )}
                  <input
                    id={connector.service === "canvas" ? "canvas-token-input" : undefined}
                    type="password"
                    placeholder={connector.placeholder}
                    value={inputValues[connector.service] ?? ""}
                    onChange={(event) => handleInputChange(connector.service, event.target.value)}
                    disabled={busy}
                  />
                </div>
                {connector.service === "canvas" && (
                  <p className="connector-help-text">
                    In Canvas go to <strong>Account</strong> → <strong>Settings</strong> → <strong>Approved Integrations</strong> → <strong>+ New Access Token</strong>, then paste the token above.
                  </p>
                )}
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={
                    busy ||
                    !inputValues[connector.service]?.trim() ||
                    (connector.service === "canvas" && !inputValues.canvas_baseUrl?.trim())
                  }
                >
                  {busy ? "Connecting..." : "Connect"}
                </button>
              </div>
            )}

            {connector.type === "oauth" && (
              <div className="connector-oauth-setup">
                <p className="connector-oauth-hint">
                  You&apos;ll be redirected to {connector.label} to authorize access.
                </p>
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={busy}
                >
                  {busy ? "Redirecting..." : `Connect ${connector.label}`}
                </button>
              </div>
            )}

            {connector.type === "config" && (
              <div className="connector-config-fields">
                {connector.service === "mcp" ? (
                  <>
                    {withingsConnector && (
                      <div className="connector-mcp-addon">
                        <div className="connector-mcp-addon-head">
                          <span className="connector-mcp-addon-title-wrap">
                            <img
                              className="connector-mcp-addon-icon"
                              src={withingsConnector.icon.src}
                              alt={withingsConnector.icon.alt}
                            />
                            <span className="connector-mcp-addon-title">{withingsConnector.label}</span>
                          </span>
                          {withingsConnected ? (
                            <span className="connector-badge connector-badge-connected">Connected</span>
                          ) : (
                            <span className="connector-badge connector-badge-disconnected">Not connected</span>
                          )}
                        </div>
                        <p className="connector-help-text">{withingsConnector.description}</p>
                        {withingsConnected ? (
                          <button
                            className="connector-disconnect-btn"
                            onClick={() => void handleDisconnect("withings")}
                            disabled={busy}
                          >
                            {submitting === "withings" ? "Disconnecting..." : "Disconnect"}
                          </button>
                        ) : (
                          <button
                            className="connector-sync-btn"
                            onClick={() => void handleConnect(withingsConnector)}
                            disabled={busy}
                          >
                            {submitting === "withings" ? "Connecting..." : "Connect"}
                          </button>
                        )}
                      </div>
                    )}

                    {mcpTemplates.length > 0 && (
                      <div className="connector-mcp-templates">
                        <p className="connector-input-label">Verified templates</p>
                        <div className="connector-mcp-template-grid">
                          {mcpTemplates.map((template) => {
                            const selected = selectedMcpTemplateId === template.id;
                            const templateIcon = getMcpTemplateIcon(template);
                            return (
                              <div
                                key={template.id}
                                className={`connector-mcp-template-card ${selected ? "connector-mcp-template-card-selected" : ""}`}
                              >
                                <div className="connector-mcp-template-head">
                                  <span className="connector-mcp-template-provider-wrap">
                                    {templateIcon && (
                                      <img
                                        className="connector-mcp-provider-icon"
                                        src={templateIcon.src}
                                        alt={templateIcon.alt}
                                      />
                                    )}
                                    <span className="connector-mcp-template-provider">{template.provider}</span>
                                  </span>
                                  {template.verified && (
                                    <span className="connector-badge connector-badge-connected">Verified</span>
                                  )}
                                </div>
                                <p className="connector-mcp-template-title">{template.label}</p>
                                <p className="connector-mcp-template-description">{template.description}</p>
                                <div className="connector-mcp-template-actions">
                                  <button
                                    type="button"
                                    className="connector-sync-btn"
                                    onClick={() => handleApplyMcpTemplate(template)}
                                    disabled={busy}
                                  >
                                    {selected ? "Selected" : "Connect"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {selectedMcpTemplate && (
                      <div className="connector-mcp-quick-connect">
                        <p className="connector-input-label">{selectedMcpTemplate.label}</p>
                        <p className="connector-help-text">{selectedMcpTemplate.description}</p>
                        {selectedMcpTemplate.authType === "oauth" ? (
                          <>
                            <button
                              className="connector-sync-btn"
                              onClick={() => void handleConnectMcpTemplate(selectedMcpTemplate)}
                              disabled={busy || selectedMcpTemplate.oauthEnabled === false}
                            >
                              {busy
                                ? "Connecting..."
                                : selectedMcpTemplate.oauthEnabled === false
                                  ? "OAuth unavailable on this server"
                                  : "Connect"}
                            </button>
                            <p className="connector-help-text">
                              {selectedMcpTemplate.oauthEnabled === false
                                ? "This deployment has no OAuth client configured for this provider. Paste a token below instead."
                                : "OAuth is preferred. You can still paste a token below if needed."}
                            </p>
                          </>
                        ) : null}
                        <div className="connector-config-field">
                          <label>{selectedMcpTemplate.tokenLabel}</label>
                          <input
                            type="password"
                            placeholder={selectedMcpTemplate.tokenPlaceholder}
                            value={inputValues.mcp_token ?? ""}
                            onChange={(event) => handleInputChange("mcp_token", event.target.value)}
                            disabled={busy}
                          />
                        </div>
                        <p className="connector-help-text">{selectedMcpTemplate.tokenHelp}</p>
                        <button
                          className="connector-sync-btn"
                          onClick={() => void handleConnectMcpTemplate(selectedMcpTemplate, inputValues.mcp_token)}
                          disabled={busy || !inputValues.mcp_token?.trim()}
                        >
                          {busy ? "Connecting..." : "Connect"}
                        </button>
                      </div>
                    )}

                    <div className="connector-mcp-list">
                      {mcpServers.length === 0 ? (
                        <p className="connector-help-text">No MCP servers connected yet.</p>
                      ) : (
                        mcpServers.map((server) => {
                          const serverIcon = getMcpServerIcon(server);
                          return (
                            <div key={server.id} className="connector-actions">
                              <span className="connector-mcp-server-label">
                                {serverIcon && (
                                  <img
                                    className="connector-mcp-provider-icon"
                                    src={serverIcon.src}
                                    alt={serverIcon.alt}
                                  />
                                )}
                                <span className="connector-display-label">{formatConnectedAppLabel(server.label)}</span>
                              </span>
                              <button
                                className="connector-disconnect-btn"
                                onClick={() => void handleDeleteMcpServer(server.id)}
                                disabled={busy}
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {(connector.configFields ?? []).map((field) => (
                      <div key={field.key} className="connector-config-field">
                        <label>{field.label}</label>
                        <input
                          type={field.type ?? "text"}
                          placeholder={field.placeholder}
                          value={inputValues[`${connector.service}_${field.key}`] ?? ""}
                          onChange={(event) => handleInputChange(`${connector.service}_${field.key}`, event.target.value)}
                          disabled={busy}
                        />
                      </div>
                    ))}
                    <button className="connector-connect-btn" onClick={() => void handleConnect(connector)} disabled={busy}>
                      {busy ? "Saving..." : "Save & Connect"}
                    </button>
                  </>
                )}
              </div>
            )}

            {connector.type === "url" && (
              <div className="connector-url-input">
                <input
                  type="url"
                  placeholder={connector.placeholder}
                  value={inputValues[connector.service] ?? ""}
                  onChange={(event) => handleInputChange(connector.service, event.target.value)}
                  disabled={busy}
                />
                {connector.service === "tp_schedule" && (
                  <p className="connector-help-text">
                    Go to <strong>tp.educloud.no</strong> → find your courses → click <strong>Verktøy</strong> → <strong>Kopier abonnementlenken til timeplanen</strong>. Paste the iCal URL here (starts with https://tp.educloud.no/...).
                  </p>
                )}
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={busy || !inputValues[connector.service]?.trim()}
                >
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            )}

            {error && expandedService === connector.service && (
              <p className="connector-error">{error}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="connectors-loading">
        <div className="skeleton-text skeleton-text-lg" />
        <div className="skeleton-text skeleton-text-lg" />
        <div className="skeleton-text skeleton-text-lg" />
      </div>
    );
  }

  return (
    <div className="connectors-list">
      <section className="connector-section">
        <div className={`connector-card ${geminiStatus.apiConfigured ? "connector-connected" : ""}`}>
          <div className="connector-header connector-header-static">
            <span className="connector-icon">
              <img className="connector-icon-image" src={GEMINI_CARD.icon.src} alt={GEMINI_CARD.icon.alt} />
            </span>
            <div className="connector-info">
              <span className="connector-label">{GEMINI_CARD.label}</span>
              {geminiStatus.apiConfigured ? (
                <span className="connector-display-label connector-display-label-wrap">
                  {geminiStatus.model} · Last used {formatRelative(geminiStatus.lastRequestAt)}
                </span>
              ) : (
                <span className="connector-desc">{GEMINI_CARD.description}</span>
              )}
            </div>
            <div className="connector-status">
              {geminiStatus.apiConfigured ? (
                <span className="connector-badge connector-badge-connected">Connected</span>
              ) : (
                <span className="connector-badge connector-badge-disconnected">Not configured</span>
              )}
            </div>
          </div>
        </div>
        {freeTierConnectors.map(renderConnectorCard)}
      </section>

      <section className="connector-section">
        <div className="connector-section-head">
          <h4 className="connector-section-title">Connected Apps</h4>
        </div>
        {isPaidPlan ? (
          connectedAppConnectors.map(renderConnectorCard)
        ) : (
          <div className="connector-card connector-card-locked">
            <div className="connector-header connector-header-static">
              <span className="connector-icon">🔒</span>
              <div className="connector-info">
                <span className="connector-label">Upgrade to unlock Connected Apps</span>
                <span className="connector-desc">Connect external apps like GitHub and Withings.</span>
              </div>
              <div className="connector-status">
                <span className="connector-badge connector-badge-disconnected">Paid plan</span>
              </div>
            </div>
            <div className="connector-actions">
              <button className="connector-sync-btn" onClick={onUpgrade}>
                Upgrade
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
