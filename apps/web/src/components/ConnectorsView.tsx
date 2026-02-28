import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConnectorService,
  UserConnection,
  CanvasStatus,
  GeminiStatus,
  McpServerConfig,
  McpServerTemplate,
  UserPlanInfo
} from "../types";
import { IconLock } from "./Icons";
import {
  connectService,
  connectMcpTemplate,
  getMcpCatalogTemplates,
  deleteMcpServer,
  disconnectService,
  getCanvasStatus,
  getConnectors,
  getGeminiStatus,
  getMcpServers,
  triggerCanvasSync
} from "../lib/api";
import type { ConnectServiceResponse } from "../lib/api";
import { useI18n } from "../lib/i18n";
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
  readMoreItems: string[];
  type: "token" | "oauth" | "config" | "url";
  placeholder?: string;
  configFields?: { key: string; label: string; placeholder: string; type?: "text" | "password" | "url" }[];
}

interface GeminiCard {
  service: "gemini";
  label: string;
  icon: { src: string; alt: string };
  description: string;
  readMoreItems: string[];
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
    readMoreItems: [
      "Import assignments and due dates into your schedule and deadline tracking.",
      "Sync course names and modules to improve planning and chat context.",
      "Set Canvas course scope so only selected courses are tracked."
    ],
    type: "token",
    placeholder: "Paste your Canvas access token"
  },
  {
    service: "mcp",
    label: "Connected Apps",
    icon: { src: iconPath("icons/integrations/connected-apps-custom.svg"), alt: "Connected apps" },
    description: "Connect trusted external apps like GitHub and Notion.",
    readMoreItems: [
      "Connect external tools so Gemini can pull context from services you already use.",
      "Use connected app data in chat, then write outcomes back into Companion schedules and deadlines.",
      "Tool exposure is budgeted automatically and scales with how many apps you connect."
    ],
    type: "config"
  },
  {
    service: "withings",
    label: "Withings Health",
    icon: { src: iconPath("icons/integrations/withings.png"), alt: "Withings" },
    description: "Sleep, weight, and health data from Withings devices.",
    readMoreItems: [
      "Sync sleep, weight, and body metrics for trend-aware coaching.",
      "Use health context in Gemini summaries and nudges.",
      "Disconnect anytime to stop future sync."
    ],
    type: "oauth"
  },
  {
    service: "tp_schedule",
    label: "TP EduCloud Schedule",
    icon: { src: iconPath("icons/integrations/tp.svg"), alt: "TP EduCloud" },
    description: "Event schedule via iCal subscription from TP.",
    readMoreItems: [
      "Import events from TP into your schedule timeline.",
      "Keep schedule blocks refreshed when the iCal feed changes.",
      "Use course context from TP when importing external deadlines."
    ],
    type: "url",
    placeholder: "Paste your TP iCal URL here"
  },
  {
    service: "timeedit",
    label: "TimeEdit Schedule",
    icon: { src: iconPath("icons/integrations/timeedit.svg"), alt: "TimeEdit" },
    description: "Import your timetable from TimeEdit.",
    readMoreItems: [
      "Sync lecture and lab events from your TimeEdit subscription feed.",
      "Automatically refresh schedule blocks when the timetable changes.",
      "Works with any university that uses TimeEdit (timeedit.net)."
    ],
    type: "url",
    placeholder: "Paste your TimeEdit iCal URL here"
  },
  {
    service: "blackboard",
    label: "Blackboard Learn",
    icon: { src: iconPath("icons/integrations/blackboard.svg"), alt: "Blackboard" },
    description: "Courses, assignments, and grades from Blackboard Learn.",
    readMoreItems: [
      "Import assignments and due dates into your deadline tracking.",
      "Sync course content and announcements for chat context.",
      "Works with any university using Blackboard Learn (NTNU, UiB, etc.)."
    ],
    type: "token",
    placeholder: "Paste your Blackboard REST API token"
  },
  {
    service: "teams",
    label: "Microsoft Teams",
    icon: { src: iconPath("icons/integrations/teams.svg"), alt: "Teams" },
    description: "Class teams, assignments, and lecture recordings.",
    readMoreItems: [
      "Surface Teams assignments alongside Canvas and Blackboard deadlines.",
      "Access lecture recordings and class notebook links in chat.",
      "Connects via your university Microsoft 365 account."
    ],
    type: "oauth"
  }
];

const GEMINI_CARD: GeminiCard = {
  service: "gemini",
  label: "Gemini AI",
  icon: { src: iconPath("icons/integrations/gemini.svg"), alt: "Gemini" },
  description: "Conversational AI, summaries, coaching",
  readMoreItems: [
    "Ask Gemini to create or update schedule blocks, deadlines, habits, and food logs.",
    "Get summaries and coaching from your recent activity.",
    "Live hydration refreshes affected tabs after tool-driven updates."
  ]
};

const GITHUB_MCP_ICON = { src: iconPath("icons/integrations/github.svg"), alt: "GitHub" };
const NOTION_MCP_ICON = { src: iconPath("icons/integrations/notion.svg"), alt: "Notion" };
const GOOGLE_CALENDAR_MCP_ICON = { src: iconPath("icons/integrations/google-calendar.svg"), alt: "Google Calendar" };

// ── Connector grouping ──────────────────────────────────────────────────

/** Services rendered inside the collapsed "Academic Sources" abstraction pill. */
const UNIVERSITY_SERVICES: ConnectorService[] = ["canvas", "blackboard", "tp_schedule", "timeedit"];

/** Services rendered inside the collapsed "Connected Apps" abstraction pill. */
const CONNECTED_APPS_SERVICES: ConnectorService[] = ["mcp", "teams"];

const UNIVERSITY_PILL_ICON = { src: iconPath("icons/integrations/academic-sources-custom.svg"), alt: "Academic Sources" };

function formatRelative(
  timestamp: string | null,
  t: (text: string, vars?: Record<string, string | number>) => string
): string {
  if (!timestamp) return t("Never");
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 10) return t("Just now");
  if (diffSec < 60) return t("{value}s ago", { value: diffSec });
  if (diffMin < 60) return t("{value}m ago", { value: diffMin });
  if (diffHour < 24) return t("{value}h ago", { value: diffHour });
  return t("{value}d ago", { value: diffDay });
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

function isNotionMcpText(value: string): boolean {
  return /notion/i.test(value);
}

function isGoogleCalendarMcpText(value: string): boolean {
  return /google.*calendar|gcal/i.test(value);
}

function getMcpTemplateIcon(template: McpServerTemplate): { src: string; alt: string } | null {
  if (isGoogleCalendarMcpText(template.provider) || isGoogleCalendarMcpText(template.label) || isGoogleCalendarMcpText(template.id)) {
    return GOOGLE_CALENDAR_MCP_ICON;
  }
  if (isNotionMcpText(template.provider) || isNotionMcpText(template.label)) {
    return NOTION_MCP_ICON;
  }
  if (isGithubMcpText(template.provider) || isGithubMcpText(template.label)) {
    return GITHUB_MCP_ICON;
  }
  return null;
}

function getMcpServerIcon(server: McpServerConfig): { src: string; alt: string } | null {
  if (isGoogleCalendarMcpText(server.label) || isGoogleCalendarMcpText(server.serverUrl)) {
    return GOOGLE_CALENDAR_MCP_ICON;
  }
  if (isNotionMcpText(server.label) || isNotionMcpText(server.serverUrl)) {
    return NOTION_MCP_ICON;
  }
  if (isGithubMcpText(server.label) || isGithubMcpText(server.serverUrl)) {
    return GITHUB_MCP_ICON;
  }
  return null;
}

function getMcpTemplateReadMoreItems(template: McpServerTemplate): string[] {
  if (isGithubMcpText(template.provider) || isGithubMcpText(template.label)) {
    return [
      "Search repositories and read files for course and project context.",
      "Extract deadlines from docs and migrate them into your Companion schedule.",
      "Read-only template by default to avoid unintended repository writes."
    ];
  }

  if (isNotionMcpText(template.provider) || isNotionMcpText(template.label)) {
    return [
      "Search Notion pages and databases from your workspace.",
      "Read Notion docs in chat context for planning and study support.",
      "Use server-exposed create or update tools when available."
    ];
  }

  if (isGoogleCalendarMcpText(template.provider) || isGoogleCalendarMcpText(template.label) || isGoogleCalendarMcpText(template.id)) {
    return [
      "Sync your Google Calendar events into your Companion schedule.",
      "Let Gemini create, update, or check calendar events via chat.",
      "See university and personal events in one unified timeline."
    ];
  }

  return [
    "Expose selected external tools to Gemini inside chat.",
    "Use app context in planning flows and task execution.",
    "Remove the app at any time from Connected Apps."
  ];
}

export function ConnectorsView({ planInfo, onUpgrade }: ConnectorsViewProps): JSX.Element {
  const { locale, t } = useI18n();
  const localeTag = locale === "no" ? "nb-NO" : "en-US";
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState<ConnectorService | null>(null);
  const [expandedUniversity, setExpandedUniversity] = useState(false);
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

  // ── Canvas course picker (shown after connect) ─────────────────────────
  const [canvasCoursePicker, setCanvasCoursePicker] = useState<ConnectServiceResponse["availableCourses"] | null>(null);
  const [canvasCoursePickerSelected, setCanvasCoursePickerSelected] = useState<Set<number>>(new Set());
  const [canvasCoursePickerSyncing, setCanvasCoursePickerSyncing] = useState(false);

  /** Auto-select courses whose enrollment term overlaps the current date. */
  const autoSelectCurrentSemesterCourses = useMemo(() => {
    return (courses: NonNullable<ConnectServiceResponse["availableCourses"]>): Set<number> => {
      const now = Date.now();
      const currentTermCourseIds: number[] = [];

      for (const course of courses) {
        if (course.term?.start_at && course.term?.end_at) {
          const start = Date.parse(course.term.start_at);
          const end = Date.parse(course.term.end_at);
          if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
            currentTermCourseIds.push(course.id);
          }
        }
      }

      // If term-based detection found results, use them. Otherwise select all.
      return new Set(currentTermCourseIds.length > 0 ? currentTermCourseIds : courses.map((c) => c.id));
    };
  }, []);

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
  const teamsConnector = CONNECTORS.find((connector) => connector.service === "teams") ?? null;

  const getStatusDetail = (service: ConnectorService): string | null => {
    if (service === "canvas" && canvasStatus.lastSyncedAt) {
      const courseLabel = canvasStatus.courses.length === 1 ? t("course") : t("courses");
      return `${canvasStatus.courses.length} ${courseLabel} · ${t("Synced")} ${formatRelative(canvasStatus.lastSyncedAt, t)}`;
    }
    if (service === "mcp") {
      const withingsConnected = connections.some((connection) => connection.service === "withings");
      const teamsConnected = connections.some((connection) => connection.service === "teams");
      const connectedApps = mcpServers.length + (withingsConnected ? 1 : 0) + (teamsConnected ? 1 : 0);
      if (connectedApps > 0) {
        return connectedApps === 1
          ? t("1 app connected")
          : t("{count} apps connected", { count: connectedApps });
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

  const handleMcpTemplatePrimaryAction = (template: McpServerTemplate): void => {
    if (template.authType === "oauth" && template.oauthEnabled !== false) {
      void handleConnectMcpTemplate(template);
      return;
    }
    handleApplyMcpTemplate(template);
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
      setSelectedMcpTemplateId(null);
      setInputValues((prev) => ({
        ...prev,
        mcp_token: ""
      }));
    } catch (err) {
      setError(extractErrorMessage(err, t("Failed to connect app template")));
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
          setError(t("Please enter a token"));
          setSubmitting(null);
          return;
        }

        if (connector.service === "canvas") {
          const baseUrl = inputValues.canvas_baseUrl?.trim();
          if (!baseUrl || !baseUrl.startsWith("http")) {
            setError(t("Please enter a valid Canvas base URL"));
            setSubmitting(null);
            return;
          }

          const connectResult = await connectService(connector.service, { token, baseUrl });
          const current = loadCanvasSettings();
          saveCanvasSettings({ ...current, baseUrl });

          // Show course picker if courses were fetched successfully
          if (connectResult.availableCourses && connectResult.availableCourses.length > 0) {
            const autoSelected = autoSelectCurrentSemesterCourses(connectResult.availableCourses);
            setCanvasCoursePicker(connectResult.availableCourses);
            setCanvasCoursePickerSelected(autoSelected);
            await Promise.all([fetchConnections(), fetchConnectorMeta()]);
            setSubmitting(null);
            return;
          }

          // If no courses found or fetch error, still refresh connections
          if (connectResult.fetchError) {
            setError(connectResult.fetchError);
          }
        } else {
          // Generic token connector (Blackboard, etc.)
          await connectService(connector.service, { token });
        }
      } else if (connector.type === "config") {
        if (connector.service === "mcp") {
          setError(t("Use a verified app template to connect."));
          setSubmitting(null);
          return;
        } else {
          const body: Record<string, string> = {};
          for (const field of connector.configFields ?? []) {
            const val = inputValues[`${connector.service}_${field.key}`]?.trim();
            if (!val) {
              setError(t("Please fill in {field}", { field: t(field.label) }));
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
          setError(t("Please enter a valid URL"));
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
      setError(extractErrorMessage(err, t("Connection failed")));
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
      setError(err instanceof Error ? err.message : t("Disconnect failed"));
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
      setError(err instanceof Error ? err.message : t("Failed to remove connected app"));
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
      if (isConnected("teams")) {
        pending.push(disconnectService("teams"));
      }
      if (pending.length === 0) {
        return;
      }
      await Promise.all(pending);
      setMcpServers([]);
      setSelectedMcpTemplateId(null);
      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
    } catch (err) {
      setError(extractErrorMessage(err, t("Disconnect failed")));
    } finally {
      setSubmitting(null);
    }
  };

  // ── Canvas course picker handlers ──────────────────────────────────────

  const handleCanvasCoursePickerToggle = (courseId: number): void => {
    setCanvasCoursePickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  const handleCanvasCoursePickerConfirm = async (): Promise<void> => {
    setCanvasCoursePickerSyncing(true);
    setError(null);
    const selectedIds = Array.from(canvasCoursePickerSelected);

    try {
      // Save course selection to scope settings
      const currentScope = loadIntegrationScopeSettings();
      saveIntegrationScopeSettings({
        ...currentScope,
        canvasCourseIds: selectedIds
      });

      // Trigger sync with selected courses only
      const syncResult = await triggerCanvasSync(undefined, {
        courseIds: selectedIds,
        pastDays: 7,
        futureDays: 180
      });

      if (!syncResult.success) {
        setError(syncResult.error ?? t("Canvas sync failed"));
      }

      await fetchConnectorMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Sync failed"));
    } finally {
      setCanvasCoursePickerSyncing(false);
      setCanvasCoursePicker(null);
      setExpandedService(null);
      setInputValues(getDefaultInputValues());
    }
  };

  const handleCanvasCoursePickerCancel = (): void => {
    setCanvasCoursePicker(null);
    setCanvasCoursePickerSelected(new Set());
  };

  const isPaidPlan = planInfo ? planInfo.plan !== "free" : false;
  const connectedAppConnectors = CONNECTED_APPS_SERVICES
    .map((service) => CONNECTORS.find((connector) => connector.service === service))
    .filter((connector): connector is ConnectorMeta => connector !== undefined);

  const renderConnectorCard = (connector: ConnectorMeta): JSX.Element => {
    const withingsConnected = isConnected("withings");
    const teamsConnected = isConnected("teams");
    const mcpConnected = isConnected("mcp");
    const connected =
      connector.service === "mcp"
        ? mcpConnected || withingsConnected || teamsConnected || mcpServers.length > 0
        : isConnected(connector.service);
    const connection = getConnection(connector.service);
    const expanded = expandedService === connector.service && (!connected || connector.service === "mcp");
    const busy =
      connector.service === "mcp"
        ? submitting === "mcp" || submitting === "withings" || submitting === "teams"
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
            <span className="connector-label">{t(connector.label)}</span>
            {connected && statusDetail && (
              <span className="connector-display-label">{statusDetail}</span>
            )}
            {connected && !statusDetail && connection?.displayLabel && (
              <span className="connector-display-label">{connection.displayLabel}</span>
            )}
            {!connected && (
              <span className="connector-desc">{t(connector.description)}</span>
            )}
          </div>
          <div className="connector-status">
            {connected ? (
              <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
            ) : (
              <span className="connector-badge connector-badge-disconnected">{t("Not connected")}</span>
            )}
          </div>
        </div>

        <details className="connector-read-more">
          <summary>{t("Read more")}</summary>
          <ul className="connector-read-more-list">
            {connector.readMoreItems.map((item) => (
              <li key={item}>{t(item)}</li>
            ))}
          </ul>
        </details>

        {connected && (
          <div className="connector-actions">
            {connector.service !== "mcp" && (
              <span className="connector-connected-since">
                {t("Connected {date}", { date: new Date(connection!.connectedAt).toLocaleDateString(localeTag) })}
              </span>
            )}
            {connector.service === "mcp" && (
              <button
                className="connector-sync-btn"
                onClick={() => handleToggleExpand("mcp")}
                disabled={busy}
              >
                {expanded ? t("Close") : t("Manage")}
              </button>
            )}
            <button
              className="connector-disconnect-btn"
              onClick={() => void (connector.service === "mcp" ? handleDisconnectConnectedApps() : handleDisconnect(connector.service))}
              disabled={busy}
            >
              {busy ? t("Disconnecting...") : connector.service === "mcp" ? t("Disconnect all") : t("Disconnect")}
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
                      {t("Canvas base URL")}
                    </label>
                    <input
                      id="canvas-base-url-input"
                      type="url"
                      placeholder="https://stavanger.instructure.com"
                      value={inputValues.canvas_baseUrl ?? ""}
                      onChange={(event) => handleInputChange("canvas_baseUrl", event.target.value)}
                      disabled={busy}
                    />
                    <p className="connector-input-hint" dangerouslySetInnerHTML={{ __html: t("Use your Canvas root URL (no <code>/courses</code>).") }} />
                  </div>
                )}
                <div className="connector-input-block">
                  {connector.service === "canvas" && (
                    <label className="connector-input-label" htmlFor="canvas-token-input">
                      {t("Canvas API token")}
                    </label>
                  )}
                  <input
                    id={connector.service === "canvas" ? "canvas-token-input" : undefined}
                    type="password"
                    placeholder={connector.placeholder ? t(connector.placeholder) : undefined}
                    value={inputValues[connector.service] ?? ""}
                    onChange={(event) => handleInputChange(connector.service, event.target.value)}
                    disabled={busy}
                  />
                </div>
                {connector.service === "canvas" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open Canvas <strong>in your browser</strong> (not the app) → <strong>Account</strong> (top-left) → <strong>Settings</strong> → scroll to <strong>Approved Integrations</strong> → <strong>+ New Access Token</strong>. Give it any name, then paste the token above.") }} />
                )}
                {connector.service === "blackboard" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open Blackboard <strong>in your browser</strong> → click your <strong>name / avatar</strong> (top-right) → <strong>Settings</strong> → <strong>Developer</strong> → <strong>Register a New Application</strong>. Copy the <strong>Application Key</strong> and paste it above.") }} />
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
                  {busy ? t("Connecting...") : t("Connect")}
                </button>
              </div>
            )}

            {connector.type === "oauth" && (
              <div className="connector-oauth-setup">
                <p className="connector-oauth-hint">
                  {t("You'll be redirected to {label} to authorize access.", { label: t(connector.label) })}
                </p>
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={busy}
                >
                  {busy ? t("Redirecting...") : `${t("Connect")} ${t(connector.label)}`}
                </button>
              </div>
            )}

            {connector.type === "config" && (
              <div className="connector-config-fields">
                {connector.service === "mcp" ? (
                  <>
                    {mcpTemplates.length > 0 && (
                      <div className="connector-mcp-templates">
                        <p className="connector-input-label">{t("Verified templates")}</p>
                        <div className="connector-mcp-template-grid">
                          {mcpTemplates.map((template) => {
                            const selected = selectedMcpTemplateId === template.id;
                            const templateIcon = getMcpTemplateIcon(template);
                            const matchingServer = mcpServers.find(
                              (server) => server.serverUrl === template.serverUrl || server.label === template.label
                            );
                            const templateConnected = !!matchingServer;
                            return (
                              <div
                                key={template.id}
                                className={`connector-mcp-template-card ${selected ? "connector-mcp-template-card-selected" : ""} ${templateConnected ? "connector-mcp-template-card-connected" : ""}`}
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
                                  {templateConnected ? (
                                    <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
                                  ) : template.verified ? (
                                    <span className="connector-badge connector-badge-connected">{t("Verified")}</span>
                                  ) : null}
                                </div>
                                <p className="connector-mcp-template-title">{template.label}</p>
                                <p className="connector-mcp-template-description">{template.description}</p>
                                <details className="connector-read-more connector-read-more-compact">
                                  <summary>{t("Read more")}</summary>
                                  <ul className="connector-read-more-list">
                                    {getMcpTemplateReadMoreItems(template).map((item) => (
                                      <li key={item}>{t(item)}</li>
                                    ))}
                                  </ul>
                                </details>
                                <div className="connector-mcp-template-actions">
                                  {templateConnected ? (
                                    <button
                                      type="button"
                                      className="connector-disconnect-btn"
                                      onClick={() => void handleDeleteMcpServer(matchingServer!.id)}
                                      disabled={busy}
                                    >
                                      {busy ? t("Disconnecting...") : t("Disconnect")}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="connector-sync-btn"
                                      onClick={() => handleMcpTemplatePrimaryAction(template)}
                                      disabled={busy}
                                    >
                                      {t("Connect")}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {withingsConnector && (
                      <div className="connector-mcp-addon">
                        <div className="connector-mcp-addon-head">
                          <span className="connector-mcp-addon-title-wrap">
                            <img
                              className="connector-mcp-addon-icon"
                              src={withingsConnector.icon.src}
                              alt={withingsConnector.icon.alt}
                            />
                            <span className="connector-mcp-addon-title">{t(withingsConnector.label)}</span>
                          </span>
                          {withingsConnected ? (
                            <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
                          ) : (
                            <span className="connector-badge connector-badge-disconnected">{t("Not connected")}</span>
                          )}
                        </div>
                        <p className="connector-help-text">{t(withingsConnector.description)}</p>
                        <details className="connector-read-more connector-read-more-compact">
                          <summary>{t("Read more")}</summary>
                          <ul className="connector-read-more-list">
                            {withingsConnector.readMoreItems.map((item) => (
                              <li key={item}>{t(item)}</li>
                            ))}
                          </ul>
                        </details>
                        {withingsConnected ? (
                          <button
                            className="connector-disconnect-btn"
                            onClick={() => void handleDisconnect("withings")}
                            disabled={busy}
                          >
                            {submitting === "withings" ? t("Disconnecting...") : t("Disconnect")}
                          </button>
                        ) : (
                          <button
                            className="connector-sync-btn"
                            onClick={() => void handleConnect(withingsConnector)}
                            disabled={busy}
                          >
                            {submitting === "withings" ? t("Connecting...") : t("Connect")}
                          </button>
                        )}
                      </div>
                    )}

                    {teamsConnector && (
                      <div className="connector-mcp-addon">
                        <div className="connector-mcp-addon-head">
                          <span className="connector-mcp-addon-title-wrap">
                            <img
                              className="connector-mcp-addon-icon"
                              src={teamsConnector.icon.src}
                              alt={teamsConnector.icon.alt}
                            />
                            <span className="connector-mcp-addon-title">{t(teamsConnector.label)}</span>
                          </span>
                          {teamsConnected ? (
                            <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
                          ) : (
                            <span className="connector-badge connector-badge-disconnected">{t("Not connected")}</span>
                          )}
                        </div>
                        <p className="connector-help-text">{t(teamsConnector.description)}</p>
                        <details className="connector-read-more connector-read-more-compact">
                          <summary>{t("Read more")}</summary>
                          <ul className="connector-read-more-list">
                            {teamsConnector.readMoreItems.map((item) => (
                              <li key={item}>{t(item)}</li>
                            ))}
                          </ul>
                        </details>
                        {teamsConnected ? (
                          <button
                            className="connector-disconnect-btn"
                            onClick={() => void handleDisconnect("teams")}
                            disabled={busy}
                          >
                            {submitting === "teams" ? t("Disconnecting...") : t("Disconnect")}
                          </button>
                        ) : (
                          <button
                            className="connector-sync-btn"
                            onClick={() => void handleConnect(teamsConnector)}
                            disabled={busy}
                          >
                            {submitting === "teams" ? t("Connecting...") : t("Connect")}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Show only MCP servers that don't match any catalog template */}
                    {(() => {
                      const customServers = mcpServers.filter(
                        (server) => !mcpTemplates.some(
                          (t2) => t2.serverUrl === server.serverUrl || t2.label === server.label
                        )
                      );
                      if (customServers.length === 0) return null;
                      return (
                        <div className="connector-mcp-list">
                          {customServers.map((server) => {
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
                                  {t("Remove")}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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
                      {busy ? t("Saving...") : t("Save & Connect")}
                    </button>
                  </>
                )}
              </div>
            )}

            {connector.type === "url" && (
              <div className="connector-url-input">
                <input
                  type="url"
                  placeholder={connector.placeholder ? t(connector.placeholder) : undefined}
                  value={inputValues[connector.service] ?? ""}
                  onChange={(event) => handleInputChange(connector.service, event.target.value)}
                  disabled={busy}
                />
                {connector.service === "tp_schedule" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open <strong>tp.educloud.no</strong> in your browser → log in → find your programme/courses → click <strong>Verktøy</strong> (tools icon) → <strong>Kopier abonnementlenken til timeplanen</strong>. The URL starts with <code>https://tp.educloud.no/</code>.") }} />
                )}
                {connector.service === "timeedit" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open your university's <strong>TimeEdit</strong> page in your browser → search and select your courses → click <strong>Subscribe</strong> (calendar icon) → copy the <strong>iCal/ICS link</strong>. The URL usually contains <code>timeedit.net</code>.") }} />
                )}
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={busy || !inputValues[connector.service]?.trim()}
                >
                  {busy ? t("Saving...") : t("Save")}
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

  // ── Academic Sources abstraction pill ───────────────────────────────
  const universityConnectors = UNIVERSITY_SERVICES
    .map(s => CONNECTORS.find(c => c.service === s))
    .filter((c): c is ConnectorMeta => c !== undefined);

  const universityConnectedCount = UNIVERSITY_SERVICES.filter(s => isConnected(s)).length;
  const universityAnyConnected = universityConnectedCount > 0;
  const universityBusy = UNIVERSITY_SERVICES.some(s => submitting === s);

  const handleDisconnectAllUniversity = async (): Promise<void> => {
    setSubmitting("canvas"); // use canvas as representative
    setError(null);
    try {
      const pending = UNIVERSITY_SERVICES
        .filter(s => isConnected(s))
        .map(s => disconnectService(s));
      if (pending.length > 0) {
        await Promise.all(pending);
      }
      await Promise.all([fetchConnections(), fetchConnectorMeta()]);
    } catch (err) {
      setError(extractErrorMessage(err, t("Disconnect failed")));
    } finally {
      setSubmitting(null);
    }
  };

  const renderUniversitySubCard = (connector: ConnectorMeta): JSX.Element => {
    const connected = isConnected(connector.service);
    const connection = getConnection(connector.service);
    const expanded = expandedService === connector.service;
    const busy = submitting === connector.service;
    const statusDetail = connected ? getStatusDetail(connector.service) : null;

    const toggleSubExpand = (): void => {
      setExpandedService(prev => prev === connector.service ? null : connector.service);
      setError(null);
    };

    return (
      <div
        key={connector.service}
        className={`connector-mcp-addon ${connected ? "connector-mcp-addon-connected" : ""} ${expanded ? "connector-mcp-addon-expanded" : ""}`}
        onClick={(e) => {
          // Don't toggle when clicking interactive children (buttons, inputs, details)
          const target = e.target as HTMLElement;
          if (target.closest("details, button, input, a, .connector-actions")) return;
          toggleSubExpand();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(e.target as HTMLElement).closest("details, button, input, a")) toggleSubExpand();
        }}
        style={{ cursor: "pointer" }}
      >
        <div className="connector-mcp-addon-head">
          <span className="connector-mcp-addon-title-wrap">
            <img
              className="connector-mcp-addon-icon"
              src={connector.icon.src}
              alt={connector.icon.alt}
            />
            <span className="connector-mcp-addon-title">{t(connector.label)}</span>
          </span>
          {connected ? (
            <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
          ) : (
            <span className="connector-badge connector-badge-disconnected">{t("Not connected")}</span>
          )}
        </div>
        {connected && statusDetail && (
          <p className="connector-help-text">{statusDetail}</p>
        )}
        {!connected && !expanded && (
          <p className="connector-help-text">{t(connector.description)}</p>
        )}
        <details className="connector-read-more connector-read-more-compact" onClick={(e) => e.stopPropagation()}>
          <summary>{t("Read more")}</summary>
          <ul className="connector-read-more-list">
            {connector.readMoreItems.map((item) => (
              <li key={item}>{t(item)}</li>
            ))}
          </ul>
        </details>
        {connected && (
          <div className="connector-actions" style={{ marginTop: "0.25rem" }}>
            <span className="connector-connected-since">
              {t("Connected {date}", { date: new Date(connection!.connectedAt).toLocaleDateString(localeTag) })}
            </span>
            <button
              className="connector-disconnect-btn"
              onClick={() => void handleDisconnect(connector.service)}
              disabled={busy}
            >
              {busy ? t("Disconnecting...") : t("Disconnect")}
            </button>
          </div>
        )}
        {expanded && !connected && (
          <div className="connector-setup" style={{ marginTop: "0.5rem" }}>
            {connector.type === "token" && (
              <div className={`connector-token-input ${connector.service === "canvas" ? "connector-token-input-canvas" : ""}`}>
                {connector.service === "canvas" && (
                  <div className="connector-input-block">
                    <label className="connector-input-label" htmlFor="canvas-base-url-input">
                      {t("Canvas base URL")}
                    </label>
                    <input
                      id="canvas-base-url-input"
                      type="url"
                      placeholder="https://stavanger.instructure.com"
                      value={inputValues.canvas_baseUrl ?? ""}
                      onChange={(event) => handleInputChange("canvas_baseUrl", event.target.value)}
                      disabled={busy}
                    />
                    <p className="connector-input-hint" dangerouslySetInnerHTML={{ __html: t("Use your Canvas root URL (no <code>/courses</code>).") }} />
                  </div>
                )}
                <div className="connector-input-block">
                  {connector.service === "canvas" && (
                    <label className="connector-input-label" htmlFor="canvas-token-input">
                      {t("Canvas API token")}
                    </label>
                  )}
                  <input
                    id={connector.service === "canvas" ? "canvas-token-input" : undefined}
                    type="password"
                    placeholder={connector.placeholder ? t(connector.placeholder) : undefined}
                    value={inputValues[connector.service] ?? ""}
                    onChange={(event) => handleInputChange(connector.service, event.target.value)}
                    disabled={busy}
                  />
                </div>
                {connector.service === "canvas" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open Canvas <strong>in your browser</strong> (not the app) → <strong>Account</strong> (top-left) → <strong>Settings</strong> → scroll to <strong>Approved Integrations</strong> → <strong>+ New Access Token</strong>. Give it any name, then paste the token above.") }} />
                )}
                {connector.service === "blackboard" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open Blackboard <strong>in your browser</strong> → click your <strong>name / avatar</strong> (top-right) → <strong>Settings</strong> → <strong>Developer</strong> → <strong>Register a New Application</strong>. Copy the <strong>Application Key</strong> and paste it above.") }} />
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
                  {busy ? t("Connecting...") : t("Connect")}
                </button>
              </div>
            )}
            {connector.type === "url" && (
              <div className="connector-url-input">
                <input
                  type="url"
                  placeholder={connector.placeholder ? t(connector.placeholder) : undefined}
                  value={inputValues[connector.service] ?? ""}
                  onChange={(event) => handleInputChange(connector.service, event.target.value)}
                  disabled={busy}
                />
                {connector.service === "tp_schedule" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open <strong>tp.educloud.no</strong> in your browser → log in → find your programme/courses → click <strong>Verktøy</strong> (tools icon) → <strong>Kopier abonnementlenken til timeplanen</strong>. The URL starts with <code>https://tp.educloud.no/</code>.") }} />
                )}
                {connector.service === "timeedit" && (
                  <p className="connector-help-text" dangerouslySetInnerHTML={{ __html: t("Open your university's <strong>TimeEdit</strong> page in your browser → search and select your courses → click <strong>Subscribe</strong> (calendar icon) → copy the <strong>iCal/ICS link</strong>. The URL usually contains <code>timeedit.net</code>.") }} />
                )}
                <button
                  className="connector-connect-btn"
                  onClick={() => void handleConnect(connector)}
                  disabled={busy || !inputValues[connector.service]?.trim()}
                >
                  {busy ? t("Saving...") : t("Save")}
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

  /** Scroll focused input into view on mobile keyboards so it's not hidden. */
  const handleConnectorInputFocus = (e: React.FocusEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      window.setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 320); // Wait for mobile keyboard animation
    }
  };

  return (
    <div className="connectors-list" onFocus={handleConnectorInputFocus}>
      {/* AI Assistant — always first */}
      <section className="connector-section">
        <div className={`connector-card ${geminiStatus.apiConfigured ? "connector-connected" : ""}`}>
          <div className="connector-header connector-header-static">
            <span className="connector-icon">
              <img className="connector-icon-image" src={GEMINI_CARD.icon.src} alt={GEMINI_CARD.icon.alt} />
            </span>
            <div className="connector-info">
              <span className="connector-label">{t(GEMINI_CARD.label)}</span>
              {geminiStatus.apiConfigured ? (
                <span className="connector-display-label connector-display-label-wrap">
                  {geminiStatus.model} · {t("Last used")} {formatRelative(geminiStatus.lastRequestAt, t)}
                </span>
              ) : (
                <span className="connector-desc">{t(GEMINI_CARD.description)}</span>
              )}
            </div>
            <div className="connector-status">
              {geminiStatus.apiConfigured ? (
                <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
              ) : (
                <span className="connector-badge connector-badge-disconnected">{t("Not configured")}</span>
              )}
            </div>
          </div>
          <details className="connector-read-more">
            <summary>{t("Read more")}</summary>
            <ul className="connector-read-more-list">
              {GEMINI_CARD.readMoreItems.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      {/* Academic Sources — single abstraction pill */}
      <section className="connector-section">
        <div className={`connector-card ${universityAnyConnected ? "connector-connected" : ""} ${expandedUniversity ? "connector-expanded" : ""}`}>
          <div
            className="connector-header"
            onClick={() => setExpandedUniversity(prev => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setExpandedUniversity(prev => !prev)}
          >
            <span className="connector-icon">
              <img className="connector-icon-image" src={UNIVERSITY_PILL_ICON.src} alt={UNIVERSITY_PILL_ICON.alt} />
            </span>
            <div className="connector-info">
              <span className="connector-label">{t("Academic Sources")}</span>
              {universityAnyConnected ? (
                <span className="connector-display-label">
                  {universityConnectedCount === 1
                    ? t("1 source connected")
                    : t("{count} sources connected", { count: universityConnectedCount })}
                </span>
              ) : (
                <span className="connector-desc">{t("LMS and schedule integrations — Canvas, Blackboard, TP, TimeEdit.")}</span>
              )}
            </div>
            <div className="connector-status">
              {universityAnyConnected ? (
                <span className="connector-badge connector-badge-connected">{t("Connected")}</span>
              ) : (
                <span className="connector-badge connector-badge-disconnected">{t("Not connected")}</span>
              )}
            </div>
          </div>
          <details className="connector-read-more">
            <summary>{t("Read more")}</summary>
            <ul className="connector-read-more-list">
              <li>{t("Import assignments, deadlines, and grades from your LMS.")}</li>
              <li>{t("Sync lecture schedules from TP EduCloud or TimeEdit iCal feeds.")}</li>
              <li>{t("All academic data flows into Gemini chat context and schedule views.")}</li>
            </ul>
          </details>
          {universityAnyConnected && !expandedUniversity && (
            <div className="connector-actions">
              <button
                className="connector-sync-btn"
                onClick={() => setExpandedUniversity(true)}
                disabled={universityBusy}
              >
                {t("Manage")}
              </button>
              <button
                className="connector-disconnect-btn"
                onClick={() => void handleDisconnectAllUniversity()}
                disabled={universityBusy}
              >
                {universityBusy ? t("Disconnecting...") : t("Disconnect all")}
              </button>
            </div>
          )}
          {expandedUniversity && (
            <div className="connector-setup">
              {universityConnectors.map(renderUniversitySubCard)}
            </div>
          )}
        </div>
      </section>

      {/* Connected Apps — paid tier */}
      <section className="connector-section">
        {isPaidPlan ? (
          connectedAppConnectors
            .filter(c => c.service !== "teams")
            .map(renderConnectorCard)
        ) : (
          <div className="connector-card connector-card-locked">
            <div className="connector-header connector-header-static">
              <span className="connector-icon"><IconLock size={18} /></span>
              <div className="connector-info">
                <span className="connector-label">{t("Upgrade to unlock Connected Apps")}</span>
                <span className="connector-desc">{t("Connect external apps like GitHub, Notion, Teams, and Withings.")}</span>
              </div>
              <div className="connector-status">
                <span className="connector-badge connector-badge-disconnected">{t("Paid plan")}</span>
              </div>
            </div>
            <div className="connector-actions">
              <button className="connector-sync-btn" onClick={onUpgrade}>
                {t("Upgrade")}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* MCP Template Token Connect Overlay */}
      {selectedMcpTemplate && (
        <div className="canvas-course-picker-overlay" onClick={() => setSelectedMcpTemplateId(null)} role="presentation">
          <div className="canvas-course-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={selectedMcpTemplate.label}>
            <h3 className="canvas-course-picker-title">{selectedMcpTemplate.label}</h3>
            <p className="canvas-course-picker-desc">{selectedMcpTemplate.description}</p>
            {selectedMcpTemplate.authType === "oauth" ? (
              <>
                <button
                  className="connector-sync-btn"
                  onClick={() => void handleConnectMcpTemplate(selectedMcpTemplate)}
                  disabled={submitting === "mcp" || selectedMcpTemplate.oauthEnabled === false}
                >
                  {submitting === "mcp"
                    ? t("Connecting...")
                    : selectedMcpTemplate.oauthEnabled === false
                      ? t("OAuth unavailable on this server")
                      : t("Connect with {provider}", { provider: selectedMcpTemplate.provider })}
                </button>
                <p className="connector-help-text">
                  {selectedMcpTemplate.oauthEnabled === false
                    ? t("This deployment has no OAuth client configured for this provider. Paste a token below instead.")
                    : t("OAuth is preferred. You can still paste a token below if needed.")}
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
                disabled={submitting === "mcp"}
                autoFocus
              />
            </div>
            <p className="connector-help-text">{selectedMcpTemplate.tokenHelp}</p>
            {error && <p className="connector-error">{error}</p>}
            <div className="canvas-course-picker-footer">
              <button
                type="button"
                className="connector-disconnect-btn"
                onClick={() => setSelectedMcpTemplateId(null)}
                disabled={submitting === "mcp"}
              >
                {t("Cancel")}
              </button>
              <button
                className="connector-connect-btn"
                onClick={() => void handleConnectMcpTemplate(selectedMcpTemplate, inputValues.mcp_token)}
                disabled={submitting === "mcp" || !inputValues.mcp_token?.trim()}
              >
                {submitting === "mcp" ? t("Connecting...") : t("Connect")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas Course Picker Overlay */}
      {canvasCoursePicker && canvasCoursePicker.length > 0 && (
        <div className="canvas-course-picker-overlay" onClick={handleCanvasCoursePickerCancel} role="presentation">
          <div className="canvas-course-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Select Canvas courses")}>
            <h3 className="canvas-course-picker-title">{t("Select courses to sync")}</h3>
            <p className="canvas-course-picker-desc">
              {t("Choose which Canvas courses to track. Current semester courses are pre-selected.")}
            </p>

            <div className="canvas-course-picker-actions">
              <button
                type="button"
                className="scope-settings-action-btn"
                onClick={() => setCanvasCoursePickerSelected(new Set(canvasCoursePicker.map((c) => c.id)))}
              >
                {t("Select all")}
              </button>
              <button
                type="button"
                className="scope-settings-action-btn"
                onClick={() => setCanvasCoursePickerSelected(new Set())}
              >
                {t("Clear")}
              </button>
            </div>

            <div className="scope-course-grid">
              {canvasCoursePicker.map((course) => {
                const selected = canvasCoursePickerSelected.has(course.id);
                const displayName = course.name.startsWith(course.course_code)
                  ? course.name
                  : `${course.course_code} — ${course.name}`;
                const termLabel = course.term?.name ? ` (${course.term.name})` : "";
                return (
                  <button
                    key={course.id}
                    type="button"
                    className={`scope-course-chip${selected ? " scope-course-chip-active" : ""}`}
                    onClick={() => handleCanvasCoursePickerToggle(course.id)}
                    aria-pressed={selected}
                  >
                    <span className="scope-course-check">{selected ? "✓" : ""}</span>
                    <span className="scope-course-name">{displayName}{termLabel}</span>
                  </button>
                );
              })}
            </div>

            <div className="canvas-course-picker-footer">
              <button
                type="button"
                className="connector-disconnect-btn"
                onClick={handleCanvasCoursePickerCancel}
                disabled={canvasCoursePickerSyncing}
              >
                {t("Skip")}
              </button>
              <button
                type="button"
                className="connector-connect-btn"
                onClick={() => void handleCanvasCoursePickerConfirm()}
                disabled={canvasCoursePickerSyncing || canvasCoursePickerSelected.size === 0}
              >
                {canvasCoursePickerSyncing
                  ? t("Syncing...")
                  : t("Sync {count} courses", { count: canvasCoursePickerSelected.size })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
