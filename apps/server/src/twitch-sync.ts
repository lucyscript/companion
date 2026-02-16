import { RuntimeStore } from "./store.js";
import { TwitchClient } from "./twitch-client.js";
import { TwitchData, TwitchStream, TwitchChannel, Notification } from "./types.js";
import { sendPushNotification } from "./push.js";

export interface TwitchSyncResult {
  success: boolean;
  liveStreamsCount: number;
  newLiveStreamsCount: number;
  notificationsSent: number;
  error?: string;
}

export class TwitchSyncService {
  private readonly store: RuntimeStore;
  private readonly client: TwitchClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private previousLiveStreamIds: Set<string> = new Set();

  constructor(store: RuntimeStore, client?: TwitchClient) {
    this.store = store;
    this.client = client ?? new TwitchClient();
  }

  /**
   * Start the Twitch sync service with periodic polling every 15 minutes
   */
  start(intervalMs: number = 15 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    // Sync immediately on start
    void this.sync();

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      void this.sync();
    }, intervalMs);
  }

  /**
   * Stop the Twitch sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Perform a Twitch sync - check for live streams and send notifications
   */
  async sync(): Promise<TwitchSyncResult> {
    if (!this.client.isConfigured()) {
      return {
        success: false,
        liveStreamsCount: 0,
        newLiveStreamsCount: 0,
        notificationsSent: 0,
        error: "Twitch API not configured"
      };
    }

    try {
      // Get the current Twitch data from the store
      const currentData = this.store.getTwitchData();
      const favoriteChannels = currentData?.favoriteChannels || [];

      if (favoriteChannels.length === 0) {
        // No favorite channels configured yet
        return {
          success: true,
          liveStreamsCount: 0,
          newLiveStreamsCount: 0,
          notificationsSent: 0
        };
      }

      // Check which favorite channels are currently live
      const favoriteUserIds = favoriteChannels.map(ch => ch.id);
      const liveStreams = await this.client.getStreamsByUserIds(favoriteUserIds);

      // Track which streams are new (just went live)
      const currentLiveStreamIds = new Set(liveStreams.map(s => s.id));
      const newLiveStreams = liveStreams.filter(
        stream => !this.previousLiveStreamIds.has(stream.id)
      );

      // Update the store with current live streams
      const twitchData: TwitchData = {
        favoriteChannels,
        liveStreams,
        lastCheckedAt: new Date().toISOString()
      };
      this.store.setTwitchData(twitchData);

      // Send push notifications for newly live streams
      let notificationsSent = 0;
      for (const stream of newLiveStreams) {
        const notificationsSent = await this.sendLiveNotification(stream);
        if (notificationsSent > 0) {
          notificationsSent++;
        }
      }

      // Update the set of previously live stream IDs
      this.previousLiveStreamIds = currentLiveStreamIds;

      return {
        success: true,
        liveStreamsCount: liveStreams.length,
        newLiveStreamsCount: newLiveStreams.length,
        notificationsSent
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      return {
        success: false,
        liveStreamsCount: 0,
        newLiveStreamsCount: 0,
        notificationsSent: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Send a push notification when a favorite channel goes live
   */
  private async sendLiveNotification(stream: TwitchStream): Promise<number> {
    const notification: Notification = {
      id: `twitch-live-${stream.id}`,
      title: `${stream.userName} is now live!`,
      message: `${stream.title}${stream.gameName ? ` • ${stream.gameName}` : ""}`,
      priority: "medium",
      source: "orchestrator",
      timestamp: new Date().toISOString(),
      url: `https://twitch.tv/${stream.userLogin}`,
      metadata: {
        streamId: stream.id,
        userId: stream.userId,
        userLogin: stream.userLogin
      }
    };

    // Get all push subscriptions and send to each
    const subscriptions = this.store.getPushSubscriptions();
    let sent = 0;

    for (const subscription of subscriptions) {
      try {
        const result = await sendPushNotification(subscription, notification);
        if (result.delivered) {
          sent++;
        }
        if (result.shouldDropSubscription) {
          this.store.removePushSubscription(subscription.endpoint);
        }
      } catch (error) {
        console.error("Failed to send Twitch live notification:", error);
      }
    }

    return sent;
  }

  /**
   * Manually trigger a sync
   */
  async triggerSync(): Promise<TwitchSyncResult> {
    return this.sync();
  }

  /**
   * Add a favorite channel
   */
  addFavoriteChannel(channel: TwitchChannel): void {
    const currentData = this.store.getTwitchData();
    const favoriteChannels = currentData?.favoriteChannels || [];
    
    // Check if already a favorite
    if (favoriteChannels.some(ch => ch.id === channel.id)) {
      return;
    }

    const updatedData: TwitchData = {
      favoriteChannels: [...favoriteChannels, { ...channel, isFavorite: true }],
      liveStreams: currentData?.liveStreams || [],
      lastCheckedAt: currentData?.lastCheckedAt || null
    };

    this.store.setTwitchData(updatedData);
  }

  /**
   * Remove a favorite channel
   */
  removeFavoriteChannel(channelId: string): void {
    const currentData = this.store.getTwitchData();
    const favoriteChannels = currentData?.favoriteChannels || [];
    
    const updatedData: TwitchData = {
      favoriteChannels: favoriteChannels.filter(ch => ch.id !== channelId),
      liveStreams: currentData?.liveStreams || [],
      lastCheckedAt: currentData?.lastCheckedAt || null
    };

    this.store.setTwitchData(updatedData);
  }
}
