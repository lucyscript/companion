import { useCallback, useEffect, useState } from "react";
import { ConnectorService, UserConnection } from "../types";
import { connectService, disconnectService, getConnectors } from "../lib/api";

interface ConnectorMeta {
  service: ConnectorService;
  label: string;
  icon: string;
  description: string;
  type: "token" | "oauth" | "config" | "url";
  placeholder?: string;
  configFields?: { key: string; label: string; placeholder: string }[];
}

const CONNECTORS: ConnectorMeta[] = [
  {
    service: "canvas",
    label: "Canvas LMS",
    icon: "🎓",
    description: "Access courses, assignments, deadlines, and grades from UiS Canvas.",
    type: "token",
    placeholder: "Paste your Canvas access token"
  },
  {
    service: "gmail",
    label: "Gmail",
    icon: "📧",
    description: "Read inbox summaries and email digests for the AI context.",
    type: "oauth"
  },
  {
    service: "github_course",
    label: "GitHub (Course Orgs)",
    icon: "🐙",
    description: "Access lab assignments and repos from course organizations.",
    type: "token",
    placeholder: "Paste your GitHub personal access token"
  },
  {
    service: "withings",
    label: "Withings Health",
    icon: "💪",
    description: "Sync sleep, weight, and health data from Withings devices.",
    type: "oauth"
  },
  {
    service: "tp_schedule",
    label: "TP EduCloud Schedule",
    icon: "📅",
    description: "Import your lecture schedule via iCal subscription link from TP.",
    type: "url",
    placeholder: "Paste your TP iCal URL here"
  }
];

export function ConnectorsView(): JSX.Element {
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState<ConnectorService | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<ConnectorService | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await getConnectors();
      setConnections(data);
    } catch {
      // Silently fail — user may not have any connections yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const isConnected = (service: ConnectorService): boolean =>
    connections.some((c) => c.service === service);

  const getConnection = (service: ConnectorService): UserConnection | undefined =>
    connections.find((c) => c.service === service);

  const handleToggleExpand = (service: ConnectorService): void => {
    if (isConnected(service)) return; // Don't expand if already connected
    setExpandedService((prev) => (prev === service ? null : service));
    setError(null);
  };

  const handleInputChange = (key: string, value: string): void => {
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleConnect = async (connector: ConnectorMeta): Promise<void> => {
    setSubmitting(connector.service);
    setError(null);

    try {
      if (connector.type === "oauth") {
        // For OAuth connectors, redirect to the connect endpoint to get the OAuth URL
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
        await connectService(connector.service, { token });
      } else if (connector.type === "config") {
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
      } else if (connector.type === "url") {
        const url = inputValues[connector.service]?.trim();
        if (!url || !url.startsWith("http")) {
          setError("Please enter a valid URL");
          setSubmitting(null);
          return;
        }
        await connectService(connector.service, { icalUrl: url });
      }

      // Refresh connections list
      await fetchConnections();
      setExpandedService(null);
      setInputValues({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        setError(parsed.error ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setSubmitting(null);
    }
  };

  const handleDisconnect = async (service: ConnectorService): Promise<void> => {
    setSubmitting(service);
    setError(null);

    try {
      await disconnectService(service);
      await fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setSubmitting(null);
    }
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
      {CONNECTORS.map((connector) => {
        const connected = isConnected(connector.service);
        const connection = getConnection(connector.service);
        const expanded = expandedService === connector.service && !connected;
        const busy = submitting === connector.service;

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
              onKeyDown={(e) => e.key === "Enter" && handleToggleExpand(connector.service)}
            >
              <span className="connector-icon">{connector.icon}</span>
              <div className="connector-info">
                <span className="connector-label">{connector.label}</span>
                {connected && connection?.displayLabel && (
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
                <span className="connector-connected-since">
                  Connected {new Date(connection!.connectedAt).toLocaleDateString()}
                </span>
                <button
                  className="connector-disconnect-btn"
                  onClick={() => void handleDisconnect(connector.service)}
                  disabled={busy}
                >
                  {busy ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            )}

            {expanded && (
              <div className="connector-setup">
                {connector.type === "token" && (
                  <div className="connector-token-input">
                    <input
                      type="password"
                      placeholder={connector.placeholder}
                      value={inputValues[connector.service] ?? ""}
                      onChange={(e) => handleInputChange(connector.service, e.target.value)}
                      disabled={busy}
                    />
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy || !inputValues[connector.service]?.trim()}
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

                {connector.type === "config" && connector.configFields && (
                  <div className="connector-config-fields">
                    {connector.configFields.map((field) => (
                      <div key={field.key} className="connector-config-field">
                        <label>{field.label}</label>
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={inputValues[`${connector.service}_${field.key}`] ?? ""}
                          onChange={(e) =>
                            handleInputChange(`${connector.service}_${field.key}`, e.target.value)
                          }
                          disabled={busy}
                        />
                      </div>
                    ))}
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy}
                    >
                      {busy ? "Saving..." : "Save & Connect"}
                    </button>
                  </div>
                )}

                {connector.type === "url" && (
                  <div className="connector-url-input">
                    <input
                      type="url"
                      placeholder={connector.placeholder}
                      value={inputValues[connector.service] ?? ""}
                      onChange={(e) => handleInputChange(connector.service, e.target.value)}
                      disabled={busy}
                    />
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

                {connector.service === "canvas" && (
                  <p className="connector-help-text">
                    Go to <strong>Canvas</strong> → click your profile picture → <strong>Settings</strong> → scroll to <strong>Approved Integrations</strong> → <strong>+ New Access Token</strong>. Give it a name and copy the token.
                  </p>
                )}
                {connector.service === "github_course" && (
                  <p className="connector-help-text">
                    Go to <strong>GitHub</strong> → <strong>Settings</strong> → <strong>Developer settings</strong> → <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong>. Select the course organizations and grant read access to repositories.
                  </p>
                )}
                {connector.service === "tp_schedule" && (
                  <p className="connector-help-text">
                    Go to <strong>tp.educloud.no</strong> → find your courses → click <strong>Verktøy</strong> → <strong>Kopier abonnementlenken til timeplanen</strong>. Paste the iCal URL here (starts with https://tp.educloud.no/...).
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
