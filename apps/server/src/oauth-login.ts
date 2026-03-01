/**
 * OAuth login flows for Google and GitHub.
 *
 * Users sign in via OAuth provider → we get their profile (email, name, avatar)
 * → upsert into the users table → create a session token → redirect back to the
 * frontend with the token in a URL fragment.
 */

import { config } from "./config.js";

export interface OAuthUserProfile {
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface OAuthUserProfileWithAccessToken {
  profile: OAuthUserProfile;
  accessToken: string;
}

// ── Google OAuth ──

export function googleOAuthEnabled(): boolean {
  return Boolean(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function getGoogleOAuthUrl(state: string): string {
  const redirectUri = getGoogleRedirectUri();
  const params = new URLSearchParams({
    client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthUserProfile> {
  const redirectUri = getGoogleRedirectUri();

  // Exchange code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Google token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokens = (await tokenResponse.json()) as { access_token: string; id_token?: string };

  // Fetch user profile
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });

  if (!profileResponse.ok) {
    throw new Error(`Google profile fetch failed: ${profileResponse.status}`);
  }

  const profile = (await profileResponse.json()) as {
    email: string;
    name?: string;
    picture?: string;
    verified_email?: boolean;
  };

  if (!profile.email) {
    throw new Error("Google profile did not return an email address");
  }

  return {
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture
  };
}

function getGoogleRedirectUri(): string {
  const base = config.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${config.PORT}`;
  return `${base}/api/auth/google/callback`;
}

// ── Google Calendar OAuth (MCP integration — same Google client, Calendar scopes) ──

const GOOGLE_CALENDAR_SCOPES = "openid email profile https://www.googleapis.com/auth/calendar";

export function getGoogleCalendarOAuthUrl(state: string): string {
  const redirectUri = getGoogleRedirectUri();
  const params = new URLSearchParams({
    client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleCalendarTokenExchange {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

export async function exchangeGoogleCalendarCode(code: string): Promise<GoogleCalendarTokenExchange> {
  const redirectUri = getGoogleRedirectUri();
  console.log(`[google-cal-oauth] Exchanging code: redirectUri=${redirectUri} clientId=${config.GOOGLE_OAUTH_CLIENT_ID?.slice(0, 20)}...`);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    console.error(`[google-cal-oauth] Token exchange HTTP error: ${tokenResponse.status} body=${body.slice(0, 500)}`);
    throw new Error(`Google Calendar token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (tokens.error || !tokens.access_token) {
    console.error(`[google-cal-oauth] Token exchange response error: ${tokens.error_description ?? tokens.error ?? "no access_token"}`);
    throw new Error(`Google Calendar OAuth error: ${tokens.error_description ?? tokens.error ?? "no access_token"}`);
  }

  const expiresIn = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
    ? Math.max(60, tokens.expires_in)
    : 3600;

  console.log(`[google-cal-oauth] Token exchange success: expiresIn=${expiresIn}s refreshToken=${tokens.refresh_token ? "present" : "MISSING"}`);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  };
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleCalendarTokenExchange> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Google token refresh failed: ${tokenResponse.status} ${body}`);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (tokens.error || !tokens.access_token) {
    throw new Error(`Google token refresh error: ${tokens.error ?? "no access_token"}`);
  }

  const expiresIn = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
    ? Math.max(60, tokens.expires_in)
    : 3600;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  };
}

// ── GitHub OAuth ──

export function githubOAuthEnabled(): boolean {
  return Boolean(config.GITHUB_OAUTH_CLIENT_ID && config.GITHUB_OAUTH_CLIENT_SECRET);
}

export function getGitHubOAuthUrl(
  state: string,
  options: { scope?: string; redirectUri?: string } = {}
): string {
  const scope = options.scope?.trim() || "user:email read:user";
  const redirectUri = options.redirectUri?.trim() || getGitHubRedirectUri();
  const params = new URLSearchParams({
    client_id: config.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope,
    state
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function exchangeGitHubCodeForAccessToken(
  code: string,
  redirectUri = getGitHubRedirectUri()
): Promise<string> {
  // Exchange code for access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      client_id: config.GITHUB_OAUTH_CLIENT_ID!,
      client_secret: config.GITHUB_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenResponse.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenData.access_token || tokenData.error) {
    throw new Error(`GitHub OAuth error: ${tokenData.error_description ?? tokenData.error ?? "no access_token"}`);
  }

  return tokenData.access_token;
}

async function fetchGitHubProfile(accessToken: string): Promise<OAuthUserProfile> {
  // Fetch user profile
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Companion-App"
    }
  });

  if (!profileResponse.ok) {
    throw new Error(`GitHub profile fetch failed: ${profileResponse.status}`);
  }

  const profile = (await profileResponse.json()) as {
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string;
  };

  let email = profile.email;

  // If email is private, fetch from /user/emails
  if (!email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Companion-App"
      }
    });

    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? emails.find((e) => e.verified)?.email ?? emails[0]?.email;
    }
  }

  if (!email) {
    throw new Error("GitHub did not provide an email address. Ensure your GitHub email settings allow apps to access your email.");
  }

  return {
    email,
    name: profile.name ?? profile.login,
    avatarUrl: profile.avatar_url
  };
}

export async function exchangeGitHubCode(
  code: string,
  options: { redirectUri?: string } = {}
): Promise<OAuthUserProfile> {
  const accessToken = await exchangeGitHubCodeForAccessToken(code, options.redirectUri);
  return await fetchGitHubProfile(accessToken);
}

export async function exchangeGitHubCodeWithToken(
  code: string,
  options: { redirectUri?: string } = {}
): Promise<OAuthUserProfileWithAccessToken> {
  const accessToken = await exchangeGitHubCodeForAccessToken(code, options.redirectUri);
  const profile = await fetchGitHubProfile(accessToken);
  return {
    profile,
    accessToken
  };
}

function getGitHubRedirectUri(): string {
  const base = config.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${config.PORT}`;
  return `${base}/api/auth/github/callback`;
}

// ── Notion MCP OAuth ──
// The remote Notion MCP server at mcp.notion.com uses its own OAuth system
// (MCP OAuth with PKCE + dynamic client registration per RFC 7591/9470/8414),
// NOT the Notion REST API OAuth at api.notion.com.

import { randomBytes, createHash } from "crypto";

interface NotionMcpClientRegistration {
  clientId: string;
  registeredAt: number;
}

// Cache dynamic client registration per redirect URI
const notionMcpRegistrationCache = new Map<string, NotionMcpClientRegistration>();

export function notionOAuthEnabled(): boolean {
  // MCP OAuth uses dynamic client registration — no env vars needed
  return true;
}

function getNotionMcpRedirectUri(): string {
  const base = config.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${config.PORT}`;
  return `${base}/api/auth/notion/callback`;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function ensureNotionMcpClientRegistration(): Promise<string> {
  const redirectUri = getNotionMcpRedirectUri();
  const cached = notionMcpRegistrationCache.get(redirectUri);
  // Re-register every 24 hours or on first use
  if (cached && Date.now() - cached.registeredAt < 24 * 60 * 60 * 1000) {
    return cached.clientId;
  }

  console.log(`[notion-mcp-oauth] Registering dynamic client at mcp.notion.com/register...`);
  const response = await fetch("https://mcp.notion.com/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "Companion AI",
      client_uri: config.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${config.PORT}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[notion-mcp-oauth] Client registration failed: ${response.status} body=${body.slice(0, 500)}`);
    throw new Error(`Notion MCP client registration failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { client_id: string };
  console.log(`[notion-mcp-oauth] Client registered: client_id=${data.client_id.slice(0, 12)}...`);
  notionMcpRegistrationCache.set(redirectUri, {
    clientId: data.client_id,
    registeredAt: Date.now(),
  });

  return data.client_id;
}

export interface NotionMcpOAuthInit {
  redirectUrl: string;
  codeVerifier: string;
  clientId: string;
}

/**
 * Initiates the Notion MCP OAuth flow:
 * 1. Performs dynamic client registration (cached)
 * 2. Generates PKCE code verifier + challenge
 * 3. Returns the authorization URL, code verifier, and client ID
 */
export async function initNotionMcpOAuth(state: string): Promise<NotionMcpOAuthInit> {
  const clientId = await ensureNotionMcpClientRegistration();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const redirectUri = getNotionMcpRedirectUri();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return {
    redirectUrl: `https://mcp.notion.com/authorize?${params.toString()}`,
    codeVerifier,
    clientId,
  };
}

export interface NotionMcpTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

/**
 * Exchanges an authorization code for tokens at mcp.notion.com/token (with PKCE).
 */
export async function exchangeNotionMcpCode(
  code: string,
  codeVerifier: string,
  clientId: string
): Promise<NotionMcpTokenResponse> {
  const redirectUri = getNotionMcpRedirectUri();

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch("https://mcp.notion.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[notion-mcp-oauth] Token exchange error: ${response.status} body=${body.slice(0, 500)}`);
    throw new Error(`Notion MCP token exchange failed: ${response.status} ${body}`);
  }

  const tokens = (await response.json()) as NotionMcpTokenResponse;
  if (!tokens.access_token) {
    throw new Error("Notion MCP token exchange: missing access_token");
  }

  console.log(`[notion-mcp-oauth] Token exchange success (expires_in=${tokens.expires_in ?? "unknown"}s)`);
  return tokens;
}

/**
 * Refreshes an expired Notion MCP access token using the refresh token.
 */
export async function refreshNotionMcpToken(
  refreshToken: string,
  clientId: string
): Promise<NotionMcpTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetch("https://mcp.notion.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[notion-mcp-oauth] Token refresh error: ${response.status} body=${body.slice(0, 500)}`);
    throw new Error(`Notion MCP token refresh failed: ${response.status} ${body}`);
  }

  const tokens = (await response.json()) as NotionMcpTokenResponse;
  console.log(`[notion-mcp-oauth] Token refresh success (expires_in=${tokens.expires_in ?? "unknown"}s)`);
  return tokens;
}