export interface McpServerTemplate {
  id: string;
  provider: string;
  label: string;
  description: string;
  serverUrl: string;
  docsUrl: string;
  verified: boolean;
  authType: "bearer";
  tokenLabel: string;
  tokenPlaceholder: string;
  tokenHelp: string;
  suggestedToolAllowlist: string[];
}

const MCP_SERVER_TEMPLATES: readonly McpServerTemplate[] = [
  {
    id: "github_repos_readonly",
    provider: "GitHub",
    label: "GitHub MCP (repos read-only)",
    description:
      "Read repositories, files, and commit history with a narrow read-only toolset URL.",
    serverUrl: "https://api.githubcopilot.com/mcp/x/repos/readonly",
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    verified: true,
    authType: "bearer",
    tokenLabel: "GitHub personal access token",
    tokenPlaceholder: "ghp_xxx or github_pat_xxx",
    tokenHelp:
      "Create a fine-grained GitHub token and grant read-only access to the repositories you want Gemini to use.",
    suggestedToolAllowlist: [
      "search_repositories",
      "search_code",
      "get_file_contents",
      "list_branches",
      "list_commits",
      "get_commit",
      "list_releases",
      "get_latest_release"
    ]
  },
  {
    id: "stripe_read_focus",
    provider: "Stripe",
    label: "Stripe MCP (read-focused)",
    description:
      "Read account, balances, customers, subscriptions, and payment insights without write tools by default.",
    serverUrl: "https://mcp.stripe.com",
    docsUrl: "https://docs.stripe.com/mcp",
    verified: true,
    authType: "bearer",
    tokenLabel: "Stripe restricted API key",
    tokenPlaceholder: "rk_live_xxx or rk_test_xxx",
    tokenHelp:
      "Use a restricted Stripe key with read permissions when possible. It is sent as a Bearer token.",
    suggestedToolAllowlist: [
      "get_stripe_account_info",
      "retrieve_balance",
      "list_products",
      "list_prices",
      "list_customers",
      "list_subscriptions",
      "list_payment_intents",
      "search_stripe_documentation"
    ]
  }
];

export function getMcpServerTemplates(): McpServerTemplate[] {
  return MCP_SERVER_TEMPLATES.map((template) => ({
    ...template,
    suggestedToolAllowlist: [...template.suggestedToolAllowlist]
  }));
}
