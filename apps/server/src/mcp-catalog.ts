export interface McpServerTemplate {
  id: string;
  provider: string;
  label: string;
  description: string;
  serverUrl: string;
  docsUrl: string;
  verified: boolean;
  authType: "bearer" | "oauth";
  oauthProvider?: "github" | "google" | "notion";
  oauthEnabled?: boolean;
  tokenLabel: string;
  tokenPlaceholder: string;
  tokenHelp: string;
  suggestedToolAllowlist: string[];
}

const MCP_SERVER_TEMPLATES: readonly McpServerTemplate[] = [
  {
    id: "github_repos_readonly",
    provider: "GitHub",
    label: "GitHub (read-only repos)",
    description: "Read repository files, history, and releases. Search finds public repos only; direct file access works on private repos too.",
    serverUrl: "https://api.githubcopilot.com/mcp/x/repos/readonly",
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    verified: true,
    authType: "oauth",
    oauthProvider: "github",
    tokenLabel: "GitHub access token",
    tokenPlaceholder: "ghp_xxx or github_pat_xxx",
    tokenHelp:
      "Optional fallback if OAuth is unavailable. Create a fine-grained token with read access to the repositories you want Gemini to use.",
    suggestedToolAllowlist: [
      "search_repositories",
      "get_file_contents",
      "list_branches",
      "list_commits",
      "get_commit",
      "list_releases",
      "get_latest_release"
    ]
  },
  {
    id: "notion_workspace",
    provider: "Notion",
    label: "Notion Workspace",
    description: "Search and work with your Notion pages and databases.",
    serverUrl: "https://mcp.notion.com/mcp",
    docsUrl: "https://www.notion.com/help/notion-mcp-server",
    verified: true,
    authType: "oauth",
    oauthProvider: "notion",
    tokenLabel: "Notion integration token",
    tokenPlaceholder: "ntn_xxx",
    tokenHelp:
      "Optional fallback if OAuth is unavailable. Create a Notion integration at notion.so/my-integrations, grant access to the pages or databases you want, then paste its token.",
    suggestedToolAllowlist: [
      "notion-search",
      "search",
      "notion-fetch",
      "fetch",
      "notion-create-pages",
      "notion-update-page",
      "notion-query-data-sources",
      "notion-query-database-view"
    ]
  },
  {
    id: "google_calendar",
    provider: "Google",
    label: "Google Calendar",
    description: "View and manage your Google Calendar events, schedules, and reminders.",
    serverUrl: "https://calendar.google.com/.well-known/mcp",
    docsUrl: "https://developers.google.com/calendar/api/guides/overview",
    verified: false,
    authType: "oauth",
    oauthProvider: "google",
    tokenLabel: "Google OAuth access token",
    tokenPlaceholder: "ya29.xxx",
    tokenHelp:
      "Optional fallback if OAuth is unavailable. Generate an OAuth 2.0 access token with Calendar read/write scope from the Google Cloud Console or OAuth Playground (developers.google.com/oauthplayground).",
    suggestedToolAllowlist: [
      "list_calendars",
      "list_events",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
      "quick_add_event"
    ]
  }
];

export function getMcpServerTemplates(): McpServerTemplate[] {
  return MCP_SERVER_TEMPLATES.map((template) => ({
    ...template,
    suggestedToolAllowlist: [...template.suggestedToolAllowlist]
  }));
}

export function getMcpServerTemplateById(templateId: string): McpServerTemplate | null {
  const match = MCP_SERVER_TEMPLATES.find((template) => template.id === templateId);
  if (!match) {
    return null;
  }
  return {
    ...match,
    suggestedToolAllowlist: [...match.suggestedToolAllowlist]
  };
}
