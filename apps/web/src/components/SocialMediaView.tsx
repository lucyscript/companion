import { useEffect, useState } from "react";
import { SocialMediaData } from "../types";

type PlatformFilter = "all" | "youtube" | "x";

export function SocialMediaView(): JSX.Element {
  const [data, setData] = useState<SocialMediaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlatformFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/social-media");
      
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      
      const result = await response.json() as SocialMediaData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load social media data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    // Handle future dates or invalid dates
    if (diffMs < 0 || isNaN(diffMs)) {
      return date.toLocaleDateString();
    }
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatDuration = (isoDuration: string): string => {
    // Handle empty or invalid durations
    if (!isoDuration || isoDuration === "PT" || isoDuration === "PT0S") {
      return "0:00";
    }
    
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return "0:00";
    
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    
    // Handle all-zero duration
    if (hours === 0 && minutes === 0 && seconds === 0) {
      return "0:00";
    }
    
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (loading && !data) {
    return (
      <div className="social-media-view">
        <div className="social-media-header">
          <h2>Social Media Digest</h2>
        </div>
        <p className="loading-message">Loading social media updates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="social-media-view">
        <div className="social-media-header">
          <h2>Social Media Digest</h2>
        </div>
        <p className="error-message">{error}</p>
        <button type="button" onClick={handleRefresh} disabled={refreshing}>
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="social-media-view">
        <div className="social-media-header">
          <h2>Social Media Digest</h2>
        </div>
        <p>No data available</p>
      </div>
    );
  }

  const videos = data.youtube.videos || [];
  const tweets = data.x.tweets || [];
  const hasYouTubeData = videos.length > 0;
  const hasXData = tweets.length > 0;

  const filteredVideos = filter === "all" || filter === "youtube" ? videos : [];
  const filteredTweets = filter === "all" || filter === "x" ? tweets : [];

  return (
    <div className="social-media-view">
      <div className="social-media-header">
        <h2>Social Media Digest</h2>
        <button 
          type="button" 
          className="refresh-button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh social media"
        >
          {refreshing ? "Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      <div className="platform-filters">
        <button
          type="button"
          className={`filter-button ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`filter-button ${filter === "youtube" ? "active" : ""}`}
          onClick={() => setFilter("youtube")}
          disabled={!hasYouTubeData}
        >
          📺 YouTube
        </button>
        <button
          type="button"
          className={`filter-button ${filter === "x" ? "active" : ""}`}
          onClick={() => setFilter("x")}
          disabled={!hasXData}
        >
          𝕏 Twitter
        </button>
      </div>

      <div className="social-media-content">
        {filteredVideos.length === 0 && filteredTweets.length === 0 && (
          <p className="empty-state">
            {filter === "youtube" && "No YouTube videos available"}
            {filter === "x" && "No tweets available"}
            {filter === "all" && "No social media updates available"}
          </p>
        )}

        {filteredVideos.length > 0 && (
          <section className="youtube-section">
            <h3 className="section-title">
              📺 YouTube {data.youtube.lastSyncedAt && (
                <span className="sync-time">
                  (synced {formatDate(data.youtube.lastSyncedAt)})
                </span>
              )}
            </h3>
            <div className="video-grid">
              {filteredVideos.slice(0, 20).map((video) => (
                <a
                  key={video.id}
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="video-card"
                >
                  <div className="video-thumbnail">
                    <img src={video.thumbnailUrl} alt={video.title} />
                    {video.duration && (
                      <span className="video-duration">{formatDuration(video.duration)}</span>
                    )}
                  </div>
                  <div className="video-info">
                    <h4 className="video-title">{video.title}</h4>
                    <p className="video-channel">{video.channelTitle}</p>
                    <div className="video-meta">
                      <span>{formatDate(video.publishedAt)}</span>
                      {video.viewCount > 0 && (
                        <span> • {video.viewCount.toLocaleString()} views</span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {filteredTweets.length > 0 && (
          <section className="twitter-section">
            <h3 className="section-title">
              𝕏 Twitter {data.x.lastSyncedAt && (
                <span className="sync-time">
                  (synced {formatDate(data.x.lastSyncedAt)})
                </span>
              )}
            </h3>
            <div className="tweet-list">
              {filteredTweets.slice(0, 20).map((tweet) => (
                <a
                  key={tweet.id}
                  href={`https://twitter.com/${tweet.authorUsername}/status/${tweet.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tweet-card"
                >
                  <div className="tweet-header">
                    <span className="tweet-author-name">{tweet.authorName}</span>
                    <span className="tweet-author-handle">@{tweet.authorUsername}</span>
                    <span className="tweet-time">{formatDate(tweet.createdAt)}</span>
                  </div>
                  <p className="tweet-text">{tweet.text}</p>
                  <div className="tweet-stats">
                    <span>💬 {tweet.replyCount}</span>
                    <span>🔄 {tweet.retweetCount}</span>
                    <span>❤️ {tweet.likeCount}</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
