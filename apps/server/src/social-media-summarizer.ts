import { GeminiClient, GeminiChatRequest } from "./gemini.js";
import { YouTubeData, XData } from "./types.js";

export type DigestTopic = "AI news" | "tech" | "entertainment" | "general";

export interface DigestOptions {
  summaryLength?: "brief" | "detailed" | "comprehensive";
  focusAreas?: DigestTopic[];
  maxVideos?: number;
  maxTweets?: number;
  timeWindow?: "24h" | "7d" | "30d";
}

export interface TopicContent {
  topic: DigestTopic;
  items: Array<{
    type: "video" | "tweet";
    title?: string;
    text: string;
    author: string;
    url?: string;
    timestamp: string;
    engagement?: number;
  }>;
  summary: string;
}

export interface SocialMediaDigest {
  generatedAt: string;
  timeWindow: string;
  topics: TopicContent[];
  totalVideos: number;
  totalTweets: number;
  metadata: {
    summaryLength: string;
    focusAreas: DigestTopic[];
  };
}

export class SocialMediaSummarizer {
  private readonly geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }

  /**
   * Generate a newsletter-style digest from YouTube and X data
   */
  async generateDigest(
    youtubeData: YouTubeData | null,
    xData: XData | null,
    options?: DigestOptions
  ): Promise<SocialMediaDigest> {
    const opts = this.normalizeOptions(options);
    
    // Filter data by time window
    const filteredVideos = this.filterByTimeWindow(
      youtubeData?.videos ?? [],
      opts.timeWindow
    ).slice(0, opts.maxVideos);

    const filteredTweets = this.filterByTimeWindow(
      xData?.tweets ?? [],
      opts.timeWindow
    ).slice(0, opts.maxTweets);

    // Categorize content by topic
    const categorizedContent = await this.categorizeContent(
      filteredVideos,
      filteredTweets,
      opts.focusAreas
    );

    // Generate summaries for each topic
    const topics = await this.summarizeTopics(categorizedContent, opts.summaryLength);

    return {
      generatedAt: new Date().toISOString(),
      timeWindow: opts.timeWindow,
      topics,
      totalVideos: filteredVideos.length,
      totalTweets: filteredTweets.length,
      metadata: {
        summaryLength: opts.summaryLength,
        focusAreas: opts.focusAreas
      }
    };
  }

  private normalizeOptions(options?: DigestOptions): Required<DigestOptions> {
    return {
      summaryLength: options?.summaryLength ?? "detailed",
      focusAreas: options?.focusAreas ?? ["AI news", "tech", "entertainment"],
      maxVideos: options?.maxVideos ?? 20,
      maxTweets: options?.maxTweets ?? 30,
      timeWindow: options?.timeWindow ?? "7d"
    };
  }

  private filterByTimeWindow<T extends { publishedAt?: string; createdAt?: string }>(
    items: T[],
    timeWindow: "24h" | "7d" | "30d"
  ): T[] {
    const now = Date.now();
    const windowMs = this.getTimeWindowMs(timeWindow);
    const cutoff = now - windowMs;

    return items.filter((item) => {
      const timestamp = item.publishedAt || item.createdAt;
      if (!timestamp) return false;
      return new Date(timestamp).getTime() >= cutoff;
    });
  }

  private getTimeWindowMs(timeWindow: "24h" | "7d" | "30d"): number {
    switch (timeWindow) {
      case "24h":
        return 24 * 60 * 60 * 1000;
      case "7d":
        return 7 * 24 * 60 * 60 * 1000;
      case "30d":
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Use Gemini to categorize content into topics
   */
  private async categorizeContent(
    videos: YouTubeData["videos"],
    tweets: XData["tweets"],
    focusAreas: DigestTopic[]
  ): Promise<Map<DigestTopic, TopicContent["items"]>> {
    const categorized = new Map<DigestTopic, TopicContent["items"]>();

    // Initialize categories
    focusAreas.forEach((topic) => {
      categorized.set(topic, []);
    });

    // Add "general" as catch-all
    if (!focusAreas.includes("general")) {
      categorized.set("general", []);
    }

    // Build content list for categorization
    const contentItems: string[] = [];
    const itemMap: Array<{
      type: "video" | "tweet";
      index: number;
      data: YouTubeData["videos"][number] | XData["tweets"][number];
    }> = [];

    videos.forEach((video, idx) => {
      contentItems.push(`${idx + 1}. [VIDEO] ${video.title} by ${video.channelTitle}`);
      itemMap.push({ type: "video", index: idx + 1, data: video });
    });

    tweets.forEach((tweet, idx) => {
      const tweetNum = videos.length + idx + 1;
      const preview = tweet.text.slice(0, 100);
      contentItems.push(`${tweetNum}. [TWEET] @${tweet.authorUsername}: ${preview}...`);
      itemMap.push({ type: "tweet", index: tweetNum, data: tweet });
    });

    if (contentItems.length === 0) {
      return categorized;
    }

    // Use Gemini to categorize
    const categorizationPrompt = `Categorize the following social media content into these topics: ${focusAreas.join(", ")}, or "general" if none fit.

Content list:
${contentItems.join("\n")}

For each item, respond with just the item number and topic, one per line:
Format: "<number>: <topic>"

Example:
1: AI news
2: tech
3: entertainment`;

    try {
      const request: GeminiChatRequest = {
        messages: [
          {
            role: "user",
            parts: [{ text: categorizationPrompt }]
          }
        ],
        systemInstruction:
          "You are a content categorization assistant. Categorize social media content into topics based on keywords and context."
      };

      const response = await this.geminiClient.generateChatResponse(request);
      const lines = response.text.split("\n").filter((line) => line.trim());

      // Parse categorization results
      lines.forEach((line) => {
        const match = line.match(/^(\d+):\s*(.+)$/);
        if (!match) return;

        const itemNum = parseInt(match[1]!, 10);
        const topicRaw = match[2]!.trim().toLowerCase();
        
        // Normalize topic name
        let topic: DigestTopic = "general";
        if (topicRaw.includes("ai")) {
          topic = "AI news";
        } else if (topicRaw.includes("tech")) {
          topic = "tech";
        } else if (topicRaw.includes("entertain")) {
          topic = "entertainment";
        }

        const item = itemMap.find((i) => i.index === itemNum);
        if (!item) return;

        const formattedItem = this.formatContentItem(item.type, item.data);
        const topicItems = categorized.get(topic);
        if (topicItems) {
          topicItems.push(formattedItem);
        }
      });
    } catch (error) {
      // Fallback: categorize based on simple keyword matching
      console.warn("Gemini categorization failed, using fallback:", error);
      this.fallbackCategorization(videos, tweets, categorized);
    }

    return categorized;
  }

  private formatContentItem(
    type: "video" | "tweet",
    data: YouTubeData["videos"][number] | XData["tweets"][number]
  ): TopicContent["items"][number] {
    if (type === "video") {
      const video = data as YouTubeData["videos"][number];
      return {
        type: "video",
        title: video.title,
        text: video.description || video.title,
        author: video.channelTitle,
        url: `https://youtube.com/watch?v=${video.id}`,
        timestamp: video.publishedAt,
        engagement: video.viewCount + video.likeCount
      };
    } else {
      const tweet = data as XData["tweets"][number];
      return {
        type: "tweet",
        text: tweet.text,
        author: `@${tweet.authorUsername}`,
        url: `https://twitter.com/${tweet.authorUsername}/status/${tweet.id}`,
        timestamp: tweet.createdAt,
        engagement: tweet.likeCount + tweet.retweetCount + tweet.replyCount
      };
    }
  }

  private fallbackCategorization(
    videos: YouTubeData["videos"],
    tweets: XData["tweets"],
    categorized: Map<DigestTopic, TopicContent["items"]>
  ): void {
    const aiKeywords = ["ai", "gpt", "llm", "machine learning", "neural", "openai", "anthropic", "gemini"];
    const techKeywords = ["software", "coding", "programming", "developer", "startup", "tech", "api"];
    const entertainmentKeywords = ["game", "gaming", "movie", "music", "stream", "entertainment"];

    videos.forEach((video) => {
      const text = `${video.title} ${video.description}`.toLowerCase();
      let topic: DigestTopic = "general";

      if (aiKeywords.some((kw) => text.includes(kw))) {
        topic = "AI news";
      } else if (techKeywords.some((kw) => text.includes(kw))) {
        topic = "tech";
      } else if (entertainmentKeywords.some((kw) => text.includes(kw))) {
        topic = "entertainment";
      }

      const items = categorized.get(topic);
      if (items) {
        items.push(this.formatContentItem("video", video));
      }
    });

    tweets.forEach((tweet) => {
      const text = tweet.text.toLowerCase();
      let topic: DigestTopic = "general";

      if (aiKeywords.some((kw) => text.includes(kw))) {
        topic = "AI news";
      } else if (techKeywords.some((kw) => text.includes(kw))) {
        topic = "tech";
      } else if (entertainmentKeywords.some((kw) => text.includes(kw))) {
        topic = "entertainment";
      }

      const items = categorized.get(topic);
      if (items) {
        items.push(this.formatContentItem("tweet", tweet));
      }
    });
  }

  /**
   * Generate summaries for each topic using Gemini
   */
  private async summarizeTopics(
    categorized: Map<DigestTopic, TopicContent["items"]>,
    summaryLength: "brief" | "detailed" | "comprehensive"
  ): Promise<TopicContent[]> {
    const topics: TopicContent[] = [];

    for (const [topic, items] of categorized.entries()) {
      if (items.length === 0) continue;

      // Sort by engagement
      items.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));

      const summary = await this.generateTopicSummary(topic, items, summaryLength);

      topics.push({
        topic,
        items,
        summary
      });
    }

    return topics;
  }

  private async generateTopicSummary(
    topic: DigestTopic,
    items: TopicContent["items"],
    summaryLength: "brief" | "detailed" | "comprehensive"
  ): Promise<string> {
    const lengthGuidelines = {
      brief: "1-2 sentences, highlight only the most important point",
      detailed: "2-4 sentences, cover key trends and notable items",
      comprehensive: "4-6 sentences, provide context and analysis"
    };

    // Build content list for summarization
    const contentList = items.slice(0, 10).map((item, idx) => {
      if (item.type === "video") {
        return `${idx + 1}. VIDEO: "${item.title}" by ${item.author}`;
      } else {
        return `${idx + 1}. TWEET: ${item.author}: "${item.text.slice(0, 150)}..."`;
      }
    });

    const summaryPrompt = `Generate a ${summaryLength} newsletter-style summary for the "${topic}" section based on these items:

${contentList.join("\n")}

Guidelines:
- Length: ${lengthGuidelines[summaryLength]}
- Style: Conversational, engaging, like an AI newsletter
- Focus: Key trends, interesting developments, notable mentions
- Tone: Informative but friendly

Write the summary:`;

    try {
      const request: GeminiChatRequest = {
        messages: [
          {
            role: "user",
            parts: [{ text: summaryPrompt }]
          }
        ],
        systemInstruction:
          "You are a social media digest writer. Create engaging newsletter-style summaries that capture trends and key insights."
      };

      const response = await this.geminiClient.generateChatResponse(request);
      return response.text.trim();
    } catch (error) {
      console.error(`Failed to generate summary for ${topic}:`, error);
      // Fallback: simple summary
      return this.generateFallbackSummary(topic, items, summaryLength);
    }
  }

  private generateFallbackSummary(
    topic: DigestTopic,
    items: TopicContent["items"],
    summaryLength: "brief" | "detailed" | "comprehensive"
  ): string {
    const videoCount = items.filter((i) => i.type === "video").length;
    const tweetCount = items.filter((i) => i.type === "tweet").length;

    if (summaryLength === "brief") {
      return `${items.length} items in ${topic}: ${videoCount} videos and ${tweetCount} tweets.`;
    } else if (summaryLength === "detailed") {
      const topItems = items.slice(0, 3).map((i) => i.title || i.text.slice(0, 50));
      return `${items.length} items in ${topic} (${videoCount} videos, ${tweetCount} tweets). Notable: ${topItems.join("; ")}.`;
    } else {
      const topItems = items.slice(0, 5).map((i) => i.title || i.text.slice(0, 50));
      return `This week in ${topic}: ${items.length} items tracked (${videoCount} videos, ${tweetCount} tweets). Highlights: ${topItems.join("; ")}. Check out the full list for more details.`;
    }
  }
}
