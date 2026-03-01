import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { RuntimeStore } from "./store.js";
import { refreshGoogleAccessToken } from "./oauth-login.js";

const MCP_MIN_TOOLS_PER_SERVER = 4;
const MCP_MAX_TOOLS_PER_SERVER = 16;
const MCP_TOOLS_TOTAL_BASE = 12;
const MCP_TOOLS_TOTAL_STEP_PER_SERVER = 8;
const MCP_TOOLS_TOTAL_CAP = 48;
const MCP_FETCH_TOOLS_HARD_CAP = 128;
const MCP_TOOL_LIST_CACHE_MS = 2 * 60 * 1000;
const TOOL_NAME_REGEX = /^[a-zA-Z0-9_]+$/;

interface McpStoredConfig {
  servers?: unknown;
}

interface McpStoredServer {
  id?: unknown;
  label?: unknown;
  serverUrl?: unknown;
  token?: unknown;
  enabled?: unknown;
  toolAllowlist?: unknown;
}

export interface McpServerConfig {
  id: string;
  label: string;
  serverUrl: string;
  token?: string;
  enabled: boolean;
  toolAllowlist: string[];
}

export interface McpServerPublicConfig {
  id: string;
  label: string;
  serverUrl: string;
  enabled: boolean;
  toolAllowlist: string[];
  hasToken: boolean;
}

export interface McpServerInput {
  id?: string;
  label: string;
  serverUrl: string;
  token?: string;
  enabled?: boolean;
  toolAllowlist?: string[];
}

export interface McpToolBinding {
  server: McpServerConfig;
  remoteToolName: string;
}

export interface McpToolContext {
  declarations: FunctionDeclaration[];
  bindings: Map<string, McpToolBinding>;
  summary: string;
}

interface CachedServerTools {
  expiresAt: number;
  tools: RemoteMcpTool[];
}

interface RemoteMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const toolCache = new Map<string, CachedServerTools>();

interface GoogleOAuthTokenBlob {
  type: "google_oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

function isGoogleOAuthTokenBlob(obj: unknown): obj is GoogleOAuthTokenBlob {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as GoogleOAuthTokenBlob).type === "google_oauth" &&
    typeof (obj as GoogleOAuthTokenBlob).accessToken === "string" &&
    typeof (obj as GoogleOAuthTokenBlob).refreshToken === "string" &&
    typeof (obj as GoogleOAuthTokenBlob).expiresAt === "string"
  );
}

/**
 * Resolves the effective bearer token for an MCP server.
 * For plain strings, returns as-is.
 * For Google OAuth JSON blobs, checks expiry and auto-refreshes.
 * If store+userId are provided, persists the refreshed token back to the DB.
 */
async function resolveOAuthBearerToken(
  server: McpServerConfig,
  store?: RuntimeStore,
  userId?: string
): Promise<string | undefined> {
  if (!server.token) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(server.token);
  } catch {
    // Not JSON — plain bearer token
    return server.token;
  }

  if (!isGoogleOAuthTokenBlob(parsed)) {
    // JSON but not our OAuth blob — return raw
    return server.token;
  }

  const expiresAt = new Date(parsed.expiresAt).getTime();
  const now = Date.now();
  const MARGIN_MS = 60_000; // refresh 60s before expiry

  if (expiresAt - now > MARGIN_MS) {
    // Still valid
    return parsed.accessToken;
  }

  // Token expired or about to expire — refresh
  try {
    const refreshed = await refreshGoogleAccessToken(parsed.refreshToken);
    const updatedBlob: GoogleOAuthTokenBlob = {
      type: "google_oauth",
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? parsed.refreshToken,
      expiresAt: refreshed.expiresAt
    };
    const updatedToken = JSON.stringify(updatedBlob);

    // Update server object in-place for current request
    server.token = updatedToken;

    // Persist to DB if store context is available
    if (store && userId) {
      const servers = getMcpServers(store, userId);
      const target = servers.find((s) => s.id === server.id);
      if (target) {
        target.token = updatedToken;
        writeMcpServers(store, userId, servers);
      }
    }

    return refreshed.accessToken;
  } catch (err) {
    console.error(`[mcp] Failed to refresh Google OAuth token for server ${server.id}:`, err);
    // Fall back to existing (possibly expired) access token
    return parsed.accessToken;
  }
}

export function calculateMcpToolBudgets(serverCount: number): {
  totalBudget: number;
  perServerBudget: number;
} {
  if (!Number.isFinite(serverCount) || serverCount <= 0) {
    return { totalBudget: 0, perServerBudget: 0 };
  }

  const normalizedServerCount = Math.max(1, Math.floor(serverCount));
  const totalBudget = Math.min(
    MCP_TOOLS_TOTAL_CAP,
    MCP_TOOLS_TOTAL_BASE + normalizedServerCount * MCP_TOOLS_TOTAL_STEP_PER_SERVER
  );
  const perServerBudget = Math.max(
    MCP_MIN_TOOLS_PER_SERVER,
    Math.min(MCP_MAX_TOOLS_PER_SERVER, Math.floor(totalBudget / normalizedServerCount))
  );

  return {
    totalBudget,
    perServerBudget
  };
}

function normalizeServerUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "MCP Server";
}

function normalizeToolAllowlist(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && TOOL_NAME_REGEX.test(value));
  return Array.from(new Set(cleaned));
}

function makeServerId(label: string, serverUrl: string): string {
  const labelSegment = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "server";
  const hash = createHash("sha1").update(`${label}:${serverUrl}`).digest("hex").slice(0, 10);
  return `${labelSegment}-${hash}`;
}

function parseStoredServer(raw: McpStoredServer): McpServerConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const label = typeof raw.label === "string" ? sanitizeLabel(raw.label) : "";
  const serverUrlRaw = typeof raw.serverUrl === "string" ? raw.serverUrl : "";
  const serverUrl = normalizeServerUrl(serverUrlRaw);
  if (!label || !serverUrl) {
    return null;
  }

  const token = typeof raw.token === "string" && raw.token.trim().length > 0
    ? raw.token.trim()
    : undefined;
  const toolAllowlist = Array.isArray(raw.toolAllowlist)
    ? normalizeToolAllowlist(
        raw.toolAllowlist.filter((value): value is string => typeof value === "string")
      )
    : [];
  const id = typeof raw.id === "string" && raw.id.trim().length > 0
    ? raw.id.trim()
    : makeServerId(label, serverUrl);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  return {
    id,
    label,
    serverUrl,
    ...(token ? { token } : {}),
    enabled,
    toolAllowlist
  };
}

function parseMcpConfig(credentials: string | undefined): McpServerConfig[] {
  if (!credentials) {
    return [];
  }

  try {
    const parsed = JSON.parse(credentials) as McpStoredConfig;
    const rawServers = Array.isArray(parsed.servers) ? parsed.servers : [];
    const servers = rawServers
      .map((entry) => parseStoredServer(entry as McpStoredServer))
      .filter((entry): entry is McpServerConfig => entry !== null);

    const seen = new Set<string>();
    return servers.filter((server) => {
      if (seen.has(server.id)) {
        return false;
      }
      seen.add(server.id);
      return true;
    });
  } catch {
    return [];
  }
}

function writeMcpServers(store: RuntimeStore, userId: string, servers: McpServerConfig[]): void {
  if (servers.length === 0) {
    store.deleteUserConnection(userId, "mcp");
    return;
  }

  store.upsertUserConnection({
    userId,
    service: "mcp",
    credentials: JSON.stringify({ servers }),
    displayLabel: servers.length === 1 ? "1 server" : `${servers.length} servers`
  });
}

export function getMcpServers(store: RuntimeStore, userId: string): McpServerConfig[] {
  const connection = store.getUserConnection(userId, "mcp");
  return parseMcpConfig(connection?.credentials);
}

export function getMcpServersPublic(store: RuntimeStore, userId: string): McpServerPublicConfig[] {
  return getMcpServers(store, userId).map((server) => ({
    id: server.id,
    label: server.label,
    serverUrl: server.serverUrl,
    enabled: server.enabled,
    toolAllowlist: server.toolAllowlist,
    hasToken: Boolean(server.token)
  }));
}

export function upsertMcpServer(store: RuntimeStore, userId: string, input: McpServerInput): McpServerConfig {
  const label = sanitizeLabel(input.label);
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (!serverUrl) {
    throw new Error("MCP server URL must be a valid http/https URL");
  }

  const token = input.token?.trim();
  const normalizedToken = token && token.length > 0 ? token : undefined;
  const normalizedAllowlist = normalizeToolAllowlist(input.toolAllowlist);
  const requestedId = input.id?.trim();
  const id = requestedId && requestedId.length > 0 ? requestedId : makeServerId(label, serverUrl);

  const current = getMcpServers(store, userId);
  const nextServer: McpServerConfig = {
    id,
    label,
    serverUrl,
    ...(normalizedToken ? { token: normalizedToken } : {}),
    enabled: input.enabled ?? true,
    toolAllowlist: normalizedAllowlist
  };

  const existingIndex = current.findIndex((server) => server.id === id);
  if (existingIndex >= 0) {
    current.splice(existingIndex, 1, nextServer);
  } else {
    current.push(nextServer);
  }

  writeMcpServers(store, userId, current);
  return nextServer;
}

export function removeMcpServer(store: RuntimeStore, userId: string, serverId: string): boolean {
  const current = getMcpServers(store, userId);
  const next = current.filter((server) => server.id !== serverId);
  if (next.length === current.length) {
    return false;
  }

  writeMcpServers(store, userId, next);
  toolCache.delete(`${userId}:${serverId}`);
  return true;
}

export function clearMcpServers(store: RuntimeStore, userId: string): void {
  const current = getMcpServers(store, userId);
  current.forEach((server) => toolCache.delete(`${userId}:${server.id}`));
  store.deleteUserConnection(userId, "mcp");
}

function sanitizeToolSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return cleaned.length > 0 ? cleaned : "tool";
}

function makeGeminiToolName(serverId: string, remoteToolName: string): string {
  const base = `mcp_${sanitizeToolSegment(serverId)}__${sanitizeToolSegment(remoteToolName)}`;
  if (base.length <= 64) {
    return base;
  }
  const hash = createHash("sha1").update(`${serverId}:${remoteToolName}`).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}_${hash}`;
}

function toGeminiSchemaType(value: string | undefined): SchemaType {
  switch (value) {
    case "string":
      return SchemaType.STRING;
    case "number":
    case "integer":
      return SchemaType.NUMBER;
    case "boolean":
      return SchemaType.BOOLEAN;
    case "array":
      return SchemaType.ARRAY;
    case "object":
      return SchemaType.OBJECT;
    default:
      return SchemaType.STRING;
  }
}

function toGeminiParameterSchema(node: unknown, depth = 0): {
  type: SchemaType;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
} {
  if (!node || typeof node !== "object" || depth > 4) {
    return { type: SchemaType.OBJECT, properties: {} };
  }

  const schema = node as Record<string, unknown>;
  const schemaTypeRaw = typeof schema.type === "string" ? schema.type : "object";
  const schemaType = toGeminiSchemaType(schemaTypeRaw);
  const description = typeof schema.description === "string" ? schema.description : undefined;

  if (schemaType === SchemaType.ARRAY) {
    const items = toGeminiParameterSchema(schema.items, depth + 1);
    return {
      type: SchemaType.ARRAY,
      ...(description ? { description } : {}),
      items
    };
  }

  if (schemaType !== SchemaType.OBJECT) {
    return {
      type: schemaType,
      ...(description ? { description } : {})
    };
  }

  const properties: Record<string, unknown> = {};
  const requiredRaw = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  const requiredSet = new Set<string>(requiredRaw);

  const inputProperties =
    schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};

  Object.entries(inputProperties).forEach(([key, value]) => {
    properties[key] = toGeminiParameterSchema(value, depth + 1);
  });

  return {
    type: SchemaType.OBJECT,
    ...(description ? { description } : {}),
    properties,
    ...(requiredSet.size > 0 ? { required: Array.from(requiredSet) } : {})
  };
}

async function withMcpClient<T>(
  server: McpServerConfig,
  fn: (client: Client) => Promise<T>,
  store?: RuntimeStore,
  userId?: string
): Promise<T> {
  const headers: Record<string, string> = {};
  const bearerToken = await resolveOAuthBearerToken(server, store, userId);
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(server.serverUrl), {
    requestInit: {
      headers
    }
  });
  const client = new Client({
    name: "companion",
    version: "0.1.0"
  });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function listRemoteTools(userId: string, server: McpServerConfig, store?: RuntimeStore): Promise<RemoteMcpTool[]> {
  const cacheKey = `${userId}:${server.id}`;
  const cached = toolCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.tools;
  }

  const response = await withMcpClient(server, async (client) => client.listTools(), store, userId);
  let tools = (response.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined
  }));

  if (server.toolAllowlist.length > 0) {
    const allow = new Set(server.toolAllowlist);
    tools = tools.filter((tool) => allow.has(tool.name));
  }

  tools = tools.slice(0, MCP_FETCH_TOOLS_HARD_CAP);
  toolCache.set(cacheKey, {
    expiresAt: now + MCP_TOOL_LIST_CACHE_MS,
    tools
  });
  return tools;
}

export async function buildMcpToolContext(store: RuntimeStore, userId: string): Promise<McpToolContext> {
  const declarations: FunctionDeclaration[] = [];
  const bindings = new Map<string, McpToolBinding>();
  const servers = getMcpServers(store, userId).filter((server) => server.enabled);

  if (servers.length === 0) {
    return {
      declarations,
      bindings,
      summary: "No MCP servers connected."
    };
  }

  const summaryParts: string[] = [];
  let totalTools = 0;
  const budgets = calculateMcpToolBudgets(servers.length);

  for (const server of servers) {
    try {
      const tools = (await listRemoteTools(userId, server, store)).slice(0, budgets.perServerBudget);
      const addedToolNames: string[] = [];
      for (const tool of tools) {
        if (totalTools >= budgets.totalBudget) {
          break;
        }
        const geminiName = makeGeminiToolName(server.id, tool.name);
        if (bindings.has(geminiName)) {
          continue;
        }
        declarations.push({
          name: geminiName,
          description: `[MCP:${server.label}] ${tool.description ?? `Call ${tool.name}`}`.slice(0, 1024),
          parameters: toGeminiParameterSchema(tool.inputSchema ?? { type: "object", properties: {} }) as unknown as FunctionDeclaration["parameters"]
        });
        bindings.set(geminiName, {
          server,
          remoteToolName: tool.name
        });
        addedToolNames.push(tool.name);
        totalTools += 1;
      }

      if (addedToolNames.length > 0) {
        summaryParts.push(`${server.label}: ${addedToolNames.join(", ")}`);
      } else {
        summaryParts.push(`${server.label}: no tools exposed`);
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "unknown error";
      // Truncate error messages — HTML error pages from broken endpoints
      // can be thousands of chars and pollute the system prompt.
      const message = rawMessage.length > 120 ? rawMessage.slice(0, 120) + "…" : rawMessage;
      summaryParts.push(`${server.label}: unavailable (${message})`);
    }
  }

  return {
    declarations,
    bindings,
    summary: summaryParts.length > 0 ? summaryParts.join(" | ") : "No MCP tools discovered."
  };
}

export function normalizeMcpToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const appendIfNonEmpty = (target: string[], candidate: unknown): void => {
    if (typeof candidate !== "string") {
      return;
    }
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      return;
    }
    target.push(trimmed);
  };

  const tryDecodeBlobText = (blob: unknown, mimeType: unknown): string | null => {
    const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
    const isTextMime =
      mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("xml") ||
      mime.includes("yaml") ||
      mime.includes("markdown");
    if (!isTextMime) {
      return null;
    }

    try {
      if (typeof blob === "string") {
        return Buffer.from(blob, "base64").toString("utf8");
      }
      if (Array.isArray(blob) && blob.every((entry) => typeof entry === "number")) {
        return Buffer.from(Uint8Array.from(blob as number[])).toString("utf8");
      }
    } catch {
      return null;
    }

    return null;
  };

  const result = value as {
    content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
    structuredContent?: unknown;
    isError?: boolean;
  };

  const resourceTextChunks: string[] = [];
  const resourceUris: string[] = [];
  const textChunks = Array.isArray(result.content)
    ? result.content.flatMap((item) => {
        const chunks: string[] = [];
        if (!item || typeof item !== "object") {
          return chunks;
        }

        if (item.type === "text" && typeof item.text === "string") {
          chunks.push(item.text);
        }

        const resource = item.resource && typeof item.resource === "object"
          ? (item.resource as { text?: unknown; uri?: unknown; blob?: unknown; mimeType?: unknown; mime_type?: unknown })
          : null;
        if (resource) {
          appendIfNonEmpty(resourceTextChunks, resource.text);
          appendIfNonEmpty(resourceUris, resource.uri);
          const decodedBlob = tryDecodeBlobText(resource.blob, resource.mimeType ?? resource.mime_type);
          appendIfNonEmpty(resourceTextChunks, decodedBlob);
        }

        if (item.type === "resource_link") {
          appendIfNonEmpty(resourceUris, item.uri);
        }

        if (item.type === "json" && item.json !== undefined) {
          try {
            chunks.push(JSON.stringify(item.json));
          } catch {
            // Ignore JSON serialization failures for non-critical extra context.
          }
        }

        return chunks;
      })
    : [];

  return {
    ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
    ...(textChunks.length > 0 ? { text: textChunks.join("\n\n") } : {}),
    ...(resourceTextChunks.length > 0 ? { resourceText: resourceTextChunks.join("\n\n") } : {}),
    ...(resourceUris.length > 0 ? { resourceUris: Array.from(new Set(resourceUris)) } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    raw: value
  };
}

export async function executeMcpToolCall(
  binding: McpToolBinding,
  args: Record<string, unknown>,
  store?: RuntimeStore,
  userId?: string
): Promise<unknown> {
  const response = await withMcpClient(binding.server, async (client) =>
    client.callTool({
      name: binding.remoteToolName,
      arguments: args
    }),
    store,
    userId
  );

  return {
    serverId: binding.server.id,
    serverLabel: binding.server.label,
    tool: binding.remoteToolName,
    result: normalizeMcpToolResult(response)
  };
}

export async function validateMcpServerConnection(input: McpServerInput): Promise<void> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (!serverUrl) {
    throw new Error("MCP server URL must be a valid http/https URL");
  }

  const server: McpServerConfig = {
    id: input.id?.trim() || makeServerId(sanitizeLabel(input.label), serverUrl),
    label: sanitizeLabel(input.label),
    serverUrl,
    ...(input.token?.trim() ? { token: input.token.trim() } : {}),
    enabled: input.enabled ?? true,
    toolAllowlist: normalizeToolAllowlist(input.toolAllowlist)
  };

  console.log(`[mcp-validate] Validating connection to ${serverUrl} label=${server.label} hasToken=${!!server.token}`);
  try {
    const tools = await listRemoteTools("validate", server);
    console.log(`[mcp-validate] Connection OK: ${tools.length} tools found`);
  } catch (err) {
    console.error(`[mcp-validate] Connection FAILED for ${serverUrl}:`, err);
    throw err;
  }
}
