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
