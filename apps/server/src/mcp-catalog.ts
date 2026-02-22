export interface McpServerTemplate {
  id: string;
  provider: string;
  label: string;
  description: string;
  serverUrl: string;
  docsUrl: string;
  verified: boolean;
  authType: "bearer" | "oauth";
  oauthProvider?: "github";
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
    description: "Read repository files, history, and releases with read-only access.",
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
