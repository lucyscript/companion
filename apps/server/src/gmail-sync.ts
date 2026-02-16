import { google } from "googleapis";
import { RuntimeStore } from "./store.js";
import { GmailOAuthService } from "./gmail-oauth.js";
import { GmailMessage } from "./types.js";

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RESULTS = 50;

// Keywords that indicate actionable items
const ACTIONABLE_KEYWORDS = [
  "canvas",
  "assignment",
  "deadline",
  "due",
  "reminder",
  "professor",
  "instructor",
  "exam",
  "quiz",
  "submission",
  "grade",
  "feedback"
];

// Important sender domains
const IMPORTANT_DOMAINS = [
  "stavanger.instructure.com",
  "uis.no",
  "github.com",
  "noreply@github.com"
];

export class GmailSyncService {
  private store: RuntimeStore;
  private gmailOAuthService: GmailOAuthService;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(store: RuntimeStore, gmailOAuthService: GmailOAuthService) {
    this.store = store;
    this.gmailOAuthService = gmailOAuthService;
  }

  start(): void {
    console.log("[gmail-sync] Starting Gmail sync service");
    
    // Initial sync
    this.syncMessages().catch((error) => {
      console.error("[gmail-sync] Initial sync failed:", error);
    });

    // Schedule periodic syncs
    this.syncIntervalId = setInterval(() => {
      this.syncMessages().catch((error) => {
        console.error("[gmail-sync] Periodic sync failed:", error);
      });
    }, SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      console.log("[gmail-sync] Stopped Gmail sync service");
    }
  }

  async syncMessages(): Promise<void> {
    if (this.isSyncing) {
      console.log("[gmail-sync] Sync already in progress, skipping");
      return;
    }

    if (!this.gmailOAuthService.isConnected()) {
      console.log("[gmail-sync] Gmail not connected, skipping sync");
      return;
    }

    this.isSyncing = true;

    try {
      const oauth2Client = await this.gmailOAuthService.getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // Fetch recent messages
      const response = await gmail.users.messages.list({
        userId: "me",
        maxResults: MAX_RESULTS,
        q: "newer_than:7d" // Last 7 days
      });

      const messageIds = response.data.messages || [];
      const messages: GmailMessage[] = [];

      // Fetch details for each message
      for (const msgRef of messageIds) {
        if (!msgRef.id) continue;

        try {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: msgRef.id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"]
          });

          const headers = msg.data.payload?.headers || [];
          const fromHeader = headers.find((h: any) => h.name === "From");
          const subjectHeader = headers.find((h: any) => h.name === "Subject");
          const dateHeader = headers.find((h: any) => h.name === "Date");

          const isUnread = msg.data.labelIds?.includes("UNREAD") || false;
          const labels = msg.data.labelIds || [];

          messages.push({
            id: msg.data.id || msgRef.id,
            threadId: msg.data.threadId || "",
            subject: subjectHeader?.value || "(No subject)",
            from: fromHeader?.value || "",
            snippet: msg.data.snippet || "",
            timestamp: dateHeader?.value || new Date().toISOString(),
            isUnread,
            labels
          });
        } catch (error) {
          console.error(`[gmail-sync] Failed to fetch message ${msgRef.id}:`, error);
        }
      }

      // Store messages
      this.store.setGmailMessages(messages);
      console.log(`[gmail-sync] Synced ${messages.length} messages`);
    } catch (error) {
      console.error("[gmail-sync] Sync failed:", error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Build email summary for Gemini context
   */
  buildEmailSummary(): string {
    const summary = this.store.getGmailSummary();
    
    if (!summary || summary.unreadCount === 0) {
      return "";
    }

    const parts: string[] = [];
    parts.push(`**Email Summary:** ${summary.unreadCount} unread message${summary.unreadCount === 1 ? "" : "s"}`);

    // Important senders
    if (summary.importantSenders.length > 0) {
      const topSenders = summary.importantSenders.slice(0, 3);
      const senderList = topSenders.map((s) => `${s.email} (${s.count})`).join(", ");
      parts.push(`- Important senders: ${senderList}`);
    }

    // Actionable items
    if (summary.actionableItems.length > 0) {
      parts.push("- Actionable items:");
      summary.actionableItems.slice(0, 3).forEach((item) => {
        parts.push(`  • ${item.subject} from ${item.from}`);
      });
    }

    return parts.join("\n");
  }

  /**
   * Check if an email is actionable based on subject and snippet
   */
  private isActionableEmail(subject: string, snippet: string, from: string): boolean {
    const searchText = `${subject} ${snippet} ${from}`.toLowerCase();
    return ACTIONABLE_KEYWORDS.some((keyword) => searchText.includes(keyword));
  }

  /**
   * Check if sender is from an important domain
   */
  private isImportantSender(from: string): boolean {
    const email = this.extractEmail(from).toLowerCase();
    return IMPORTANT_DOMAINS.some((domain) => email.includes(domain));
  }

  /**
   * Extract email address from "Name <email@domain.com>" format
   */
  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from;
  }
}
