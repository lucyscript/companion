import { config } from "./config.js";

export interface TwitchStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameId: string;
  gameName: string;
  type: "live";
  title: string;
  viewerCount: number;
  startedAt: string;
  language: string;
  thumbnailUrl: string;
  tags: string[];
  isMature: boolean;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  type: string;
  broadcasterType: string;
  description: string;
  profileImageUrl: string;
  offlineImageUrl: string;
  viewCount: number;
  createdAt: string;
}

export class TwitchAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TwitchAPIError";
  }
}

export class TwitchAuthError extends TwitchAPIError {
  constructor(message = "Twitch API authentication failed") {
    super(message, 401);
    this.name = "TwitchAuthError";
  }
}

/**
 * Twitch API (Helix) client
 * Uses OAuth 2.0 Client Credentials flow for app access token
 */
export class TwitchClient {
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly baseUrl = "https://api.twitch.tv/helix";
  private readonly authUrl = "https://id.twitch.tv/oauth2/token";
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(clientId?: string, clientSecret?: string) {
    this.clientId = clientId ?? config.TWITCH_CLIENT_ID ?? null;
    this.clientSecret = clientSecret ?? config.TWITCH_CLIENT_SECRET ?? null;
  }

  isConfigured(): boolean {
    return this.clientId !== null && this.clientSecret !== null;
  }

  /**
   * Get an app access token using OAuth 2.0 Client Credentials flow
   */
  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new TwitchAuthError("Twitch API credentials not configured. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    }

    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const url = new URL(this.authUrl);
      url.searchParams.set("client_id", this.clientId!);
      url.searchParams.set("client_secret", this.clientSecret!);
      url.searchParams.set("grant_type", "client_credentials");

      const response = await fetch(url.toString(), {
        method: "POST"
      });

      if (!response.ok) {
        throw new TwitchAuthError(`Failed to get access token: ${response.statusText}`);
      }

      const data = await response.json() as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      this.accessToken = data.access_token;
      // Set expiry with 5-minute buffer
      this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

      return this.accessToken;
    } catch (error) {
      if (error instanceof TwitchAPIError) {
        throw error;
      }
      throw new TwitchAuthError(
        `Failed to authenticate with Twitch API: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Make an authenticated request to the Twitch API
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    if (!this.isConfigured()) {
      throw new TwitchAPIError("Twitch API credentials not configured. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    }

    const token = await this.getAccessToken();

    try {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.set(key, value);
        });
      }

      const response = await fetch(url.toString(), {
        headers: {
          "Client-ID": this.clientId!,
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token might be invalid, clear it and retry once
          this.accessToken = null;
          this.tokenExpiresAt = 0;
          throw new TwitchAuthError("Access token invalid or expired");
        }
        throw new TwitchAPIError(`Twitch API error: ${response.statusText}`, response.status);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof TwitchAPIError) {
        throw error;
      }
      throw new TwitchAPIError(
        `Failed to make Twitch API request: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch live streams from followed channels (requires user access token)
   * Note: This endpoint requires user authentication, not app authentication.
   * For now, we'll use the streams endpoint with specific user IDs as a workaround.
   */
  async getFollowedStreams(userId: string): Promise<TwitchStream[]> {
    if (!this.isConfigured()) {
      throw new TwitchAPIError("Twitch API credentials not configured. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    }

    try {
      const data = await this.request<{
        data: Array<{
          id: string;
          user_id: string;
          user_login: string;
          user_name: string;
          game_id: string;
          game_name: string;
          type: string;
          title: string;
          viewer_count: number;
          started_at: string;
          language: string;
          thumbnail_url: string;
          tag_ids: string[];
          tags: string[];
          is_mature: boolean;
        }>;
        pagination: { cursor?: string };
      }>("/streams/followed", { user_id: userId });

      return data.data.map(stream => ({
        id: stream.id,
        userId: stream.user_id,
        userLogin: stream.user_login,
        userName: stream.user_name,
        gameId: stream.game_id,
        gameName: stream.game_name,
        type: "live" as const,
        title: stream.title,
        viewerCount: stream.viewer_count,
        startedAt: stream.started_at,
        language: stream.language,
        thumbnailUrl: stream.thumbnail_url,
        tags: stream.tags || [],
        isMature: stream.is_mature
      }));
    } catch (error) {
      if (error instanceof TwitchAPIError) {
        throw error;
      }
      throw new TwitchAPIError(
        `Failed to fetch followed streams: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch streams by user IDs (for channels the user follows)
   */
  async getStreamsByUserIds(userIds: string[]): Promise<TwitchStream[]> {
    if (!this.isConfigured()) {
      throw new TwitchAPIError("Twitch API credentials not configured. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    }

    if (userIds.length === 0) {
      return [];
    }

    try {
      // Twitch API supports up to 100 user_id parameters
      const params: Record<string, string> = {};
      userIds.slice(0, 100).forEach((id, index) => {
        params[`user_id`] = id;
      });

      // Note: We need to pass multiple user_id params, but our request method
      // doesn't support that. Let's build the URL manually.
      const token = await this.getAccessToken();
      const url = new URL(`${this.baseUrl}/streams`);
      userIds.slice(0, 100).forEach(id => {
        url.searchParams.append("user_id", id);
      });

      const response = await fetch(url.toString(), {
        headers: {
          "Client-ID": this.clientId!,
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new TwitchAPIError(`Twitch API error: ${response.statusText}`, response.status);
      }

      const data = await response.json() as {
        data: Array<{
          id: string;
          user_id: string;
          user_login: string;
          user_name: string;
          game_id: string;
          game_name: string;
          type: string;
          title: string;
          viewer_count: number;
          started_at: string;
          language: string;
          thumbnail_url: string;
          tag_ids: string[];
          tags: string[];
          is_mature: boolean;
        }>;
        pagination: { cursor?: string };
      };

      return data.data.map(stream => ({
        id: stream.id,
        userId: stream.user_id,
        userLogin: stream.user_login,
        userName: stream.user_name,
        gameId: stream.game_id,
        gameName: stream.game_name,
        type: "live" as const,
        title: stream.title,
        viewerCount: stream.viewer_count,
        startedAt: stream.started_at,
        language: stream.language,
        thumbnailUrl: stream.thumbnail_url,
        tags: stream.tags || [],
        isMature: stream.is_mature
      }));
    } catch (error) {
      if (error instanceof TwitchAPIError) {
        throw error;
      }
      throw new TwitchAPIError(
        `Failed to fetch streams by user IDs: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch user information
   */
  async getUsers(userIds?: string[], logins?: string[]): Promise<TwitchUser[]> {
    if (!this.isConfigured()) {
      throw new TwitchAPIError("Twitch API credentials not configured. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    }

    if ((!userIds || userIds.length === 0) && (!logins || logins.length === 0)) {
      return [];
    }

    try {
      const token = await this.getAccessToken();
      const url = new URL(`${this.baseUrl}/users`);
      
      if (userIds) {
        userIds.slice(0, 100).forEach(id => {
          url.searchParams.append("id", id);
        });
      }
      
      if (logins) {
        logins.slice(0, 100).forEach(login => {
          url.searchParams.append("login", login);
        });
      }

      const response = await fetch(url.toString(), {
        headers: {
          "Client-ID": this.clientId!,
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new TwitchAPIError(`Twitch API error: ${response.statusText}`, response.status);
      }

      const data = await response.json() as {
        data: Array<{
          id: string;
          login: string;
          display_name: string;
          type: string;
          broadcaster_type: string;
          description: string;
          profile_image_url: string;
          offline_image_url: string;
          view_count: number;
          created_at: string;
        }>;
      };

      return data.data.map(user => ({
        id: user.id,
        login: user.login,
        displayName: user.display_name,
        type: user.type,
        broadcasterType: user.broadcaster_type,
        description: user.description,
        profileImageUrl: user.profile_image_url,
        offlineImageUrl: user.offline_image_url,
        viewCount: user.view_count,
        createdAt: user.created_at
      }));
    } catch (error) {
      if (error instanceof TwitchAPIError) {
        throw error;
      }
      throw new TwitchAPIError(
        `Failed to fetch users: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }
}

let defaultClient: TwitchClient | null = null;

export function getTwitchClient(): TwitchClient {
  if (!defaultClient) {
    defaultClient = new TwitchClient();
  }
  return defaultClient;
}
