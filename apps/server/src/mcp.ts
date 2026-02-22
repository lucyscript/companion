import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { RuntimeStore } from "./store.js";

const MAX_MCP_TOOLS_PER_SERVER = 8;
const MAX_MCP_TOOLS_TOTAL = 24;
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

async function withMcpClient<T>(server: McpServerConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const headers: Record<string, string> = {};
  if (server.token) {
    headers.Authorization = `Bearer ${server.token}`;
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

async function listRemoteTools(userId: string, server: McpServerConfig): Promise<RemoteMcpTool[]> {
  const cacheKey = `${userId}:${server.id}`;
  const cached = toolCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.tools;
  }

  const response = await withMcpClient(server, async (client) => client.listTools());
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

  tools = tools.slice(0, MAX_MCP_TOOLS_PER_SERVER);
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

  for (const server of servers) {
    try {
      const tools = await listRemoteTools(userId, server);
      const addedToolNames: string[] = [];
      for (const tool of tools) {
        if (totalTools >= MAX_MCP_TOOLS_TOTAL) {
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
      const message = error instanceof Error ? error.message : "unknown error";
      summaryParts.push(`${server.label}: unavailable (${message})`);
    }
  }

  return {
    declarations,
    bindings,
    summary: summaryParts.length > 0 ? summaryParts.join(" | ") : "No MCP tools discovered."
  };
}

function normalizeMcpToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = value as {
    content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
    structuredContent?: unknown;
    isError?: boolean;
  };

  const textChunks = Array.isArray(result.content)
    ? result.content
        .filter((item) => item && item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
    : [];

  return {
    ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
    ...(textChunks.length > 0 ? { text: textChunks.join("\n\n") } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    raw: value
  };
}

export async function executeMcpToolCall(binding: McpToolBinding, args: Record<string, unknown>): Promise<unknown> {
  const response = await withMcpClient(binding.server, async (client) =>
    client.callTool({
      name: binding.remoteToolName,
      arguments: args
    })
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

  await listRemoteTools("validate", server);
}
