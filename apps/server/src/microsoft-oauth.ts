/**
 * Microsoft OAuth 2.0 Service — Microsoft Identity Platform (v2.0)
 *
 * Handles OAuth flow for Microsoft Graph API access (Teams Education, etc.).
 * Tokens are stored in the user_connections table under "teams" service
 * as JSON credentials: { accessToken, refreshToken, expiresAt, source }.
 *
 * Microsoft identity platform docs:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 */

import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { RuntimeStore } from "./store.js";

const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/api/auth/microsoft/callback";

/**
 * Resolve the callback URL — prefer explicit config, fall back to OAUTH_REDIRECT_BASE_URL.
 */
function resolveCallbackUrl(): string {
  const explicit = config.MICROSOFT_OAUTH_CALLBACK_URL;
  if (explicit && !explicit.startsWith("http://localhost")) return explicit;
  if (config.OAUTH_REDIRECT_BASE_URL) {
    const base = config.OAUTH_REDIRECT_BASE_URL.replace(/\/+$/, "");
    return `${base}${CALLBACK_PATH}`;
  }
  return explicit;
}

/**
 * Scopes requested for Graph API.
 * offline_access is required for refresh tokens.
 */
const SCOPES = [
  "openid",
  "offline_access",
  "User.Read",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "EduAssignments.Read"
].join(" ");

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface StoredCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  source?: string;
}

export class MicrosoftOAuthService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly pendingStates = new Map<string, number>();

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
  }

  private hasOAuthCredentials(): boolean {
    return Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET);
  }

  private cleanupExpiredStates(nowMs = Date.now()): void {
    for (const [state, expiresAt] of this.pendingStates.entries()) {
      if (expiresAt <= nowMs) this.pendingStates.delete(state);
    }
  }

  private consumeState(state: string | null): boolean {
    this.cleanupExpiredStates();
    if (!state || state.trim().length === 0) return false;
    const expiresAt = this.pendingStates.get(state);
    if (!expiresAt || expiresAt < Date.now()) return false;
    this.pendingStates.delete(state);
    return true;
  }

  private createState(): string {
    this.cleanupExpiredStates();
    const state = randomBytes(18).toString("hex");
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    return state;
  }

  private getStoredCredentials(): StoredCredentials | null {
    const connection = this.store.getUserConnection(this.userId, "teams");
    if (!connection?.credentials) return null;
    try {
      return JSON.parse(connection.credentials) as StoredCredentials;
    } catch {
      return null;
    }
  }

  private storeCredentials(creds: StoredCredentials): void {
    this.store.upsertUserConnection({
      userId: this.userId,
      service: "teams",
      credentials: JSON.stringify(creds),
      displayLabel: "Microsoft Teams"
    });
  }

  /**
   * Exchange an authorization code or refresh token for new tokens.
   */
  private async requestToken(params: {
    grantType: "authorization_code" | "refresh_token";
    code?: string;
    refreshToken?: string;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresAt: string; scope?: string }> {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    const form = new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID!,
      client_secret: config.MICROSOFT_CLIENT_SECRET!,
      grant_type: params.grantType,
      scope: SCOPES
    });

    if (params.grantType === "authorization_code") {
      form.set("code", params.code!);
      form.set("redirect_uri", resolveCallbackUrl());
    } else if (params.grantType === "refresh_token") {
      form.set("refresh_token", params.refreshToken!);
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });

    const raw = await response.text();
    let payload: MicrosoftTokenResponse;

    try {
      payload = JSON.parse(raw) as MicrosoftTokenResponse;
    } catch {
      throw new Error(`Microsoft token response parse error (HTTP ${response.status})`);
    }

    if (!response.ok || payload.error) {
      const desc = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
      throw new Error(`Microsoft OAuth token error: ${desc}`);
    }

    if (!payload.access_token) {
      throw new Error("Microsoft OAuth response missing access_token");
    }

    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? Math.max(60, payload.expires_in)
      : 3600;

    return {
      accessToken: payload.access_token,
      ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      ...(payload.scope ? { scope: payload.scope } : {})
    };
  }

  /**
   * Build the Microsoft OAuth authorization URL.
   */
  getAuthUrl(): string {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Microsoft OAuth credentials not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)");
    }

    const state = this.createState();
    const params = new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID!,
      response_type: "code",
      redirect_uri: resolveCallbackUrl(),
      response_mode: "query",
      scope: SCOPES,
      state,
      prompt: "consent"
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback — exchange code for tokens and store them.
   */
  async handleCallback(code: string, state: string | null): Promise<void> {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    if (!this.consumeState(state)) {
      throw new Error("Invalid or expired Microsoft OAuth state");
    }

    const token = await this.requestToken({ grantType: "authorization_code", code });
    const existing = this.getStoredCredentials();

    this.storeCredentials({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? existing?.refreshToken,
      expiresAt: token.expiresAt,
      source: "oauth"
    });
  }

  /**
   * Get a valid access token, refreshing if expired.
   * Used by TeamsSyncService before each sync.
   */
  async getValidAccessToken(): Promise<string> {
    const creds = this.getStoredCredentials();
    if (!creds?.accessToken && !creds?.refreshToken) {
      throw new Error("Microsoft Teams not connected — no tokens available");
    }

    // Check if current access token is still valid (with 60s margin)
    const expiresAtMs = creds.expiresAt ? Date.parse(creds.expiresAt) : Number.NaN;
    const hasUsableToken =
      Boolean(creds.accessToken) &&
      (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now() + 60_000);

    if (hasUsableToken) {
      return creds.accessToken!;
    }

    // Refresh the token
    if (!creds.refreshToken) {
      throw new Error("Microsoft access token expired and no refresh token available");
    }

    const refreshed = await this.requestToken({
      grantType: "refresh_token",
      refreshToken: creds.refreshToken
    });

    this.storeCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresAt,
      source: "oauth"
    });

    return refreshed.accessToken;
  }

  isConnected(): boolean {
    const creds = this.getStoredCredentials();
    return Boolean(creds?.refreshToken || creds?.accessToken);
  }

  getConnectionInfo(): {
    connected: boolean;
    hasRefreshToken?: boolean;
    hasAccessToken?: boolean;
    tokenExpiresAt?: string;
    source?: string;
  } {
    const creds = this.getStoredCredentials();
    if (!creds) return { connected: false };

    return {
      connected: Boolean(creds.refreshToken || creds.accessToken),
      hasRefreshToken: Boolean(creds.refreshToken),
      hasAccessToken: Boolean(creds.accessToken),
      ...(creds.expiresAt ? { tokenExpiresAt: creds.expiresAt } : {}),
      ...(creds.source ? { source: creds.source } : {})
    };
  }
}
