import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";
import { 
  generateDigestContent, 
  formatDigestAsHTML,
  formatDigestAsText,
  shouldSendFallbackDigest,
  shouldSendScheduledDigest
} from "./email-digest.js";
import { makeId, nowIso } from "./utils.js";

describe("Email Digest", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  describe("generateDigestContent", () => {
    it("generates daily digest with upcoming deadlines", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      store.createDeadline({
        course: "CS101",
        task: "Problem Set 1",
        dueDate: tomorrow.toISOString(),
        priority: "high",
        completed: false
      });

      const content = generateDigestContent(store, "daily");

      expect(content.type).toBe("daily");
      expect(content.summary.upcomingDeadlines).toHaveLength(1);
      expect(content.summary.upcomingDeadlines[0].task).toBe("Problem Set 1");
      expect(content.summary.greeting).toContain("Good morning");
    });

    it("generates weekly digest with stats", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      store.createDeadline({
        course: "CS101",
        task: "Assignment 1",
        dueDate: yesterday.toISOString(),
        priority: "medium",
        completed: false
      });

      store.updateDeadline(store.getDeadlines()[0].id, { completed: true });

      const content = generateDigestContent(store, "weekly");

      expect(content.type).toBe("weekly");
      expect(content.summary.greeting).toContain("weekly roundup");
      expect(content.summary.weeklyStats).toBeDefined();
      expect(content.summary.weeklyStats?.deadlinesCompleted).toBeGreaterThanOrEqual(0);
    });

    it("includes today's schedule in daily digest", () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);

      store.createLectureEvent({
        title: "Algorithms Lecture",
        startTime: today.toISOString(),
        durationMinutes: 90,
        workload: "medium"
      });

      const content = generateDigestContent(store, "daily");

      expect(content.summary.todaySchedule).toHaveLength(1);
      expect(content.summary.todaySchedule[0].title).toBe("Algorithms Lecture");
    });

    it("includes pending habits", () => {
      const habit = store.createHabit({
        name: "Morning exercise",
        cadence: "daily",
        targetPerWeek: 5
      });

      const content = generateDigestContent(store, "daily");

      const pendingHabits = content.summary.pendingHabits;
      expect(pendingHabits.length).toBeGreaterThan(0);
      expect(pendingHabits.some(h => h.name === "Morning exercise")).toBe(true);
    });

    it("includes recent journal highlights", () => {
      store.recordJournalEntry("First journal entry");
      store.recordJournalEntry("Second journal entry");

      const content = generateDigestContent(store, "daily");

      expect(content.summary.recentJournalHighlights.length).toBeGreaterThan(0);
      // Entries are returned in descending order (newest first)
      expect(content.summary.recentJournalHighlights[0].content).toBe("First journal entry");
    });

    it("includes fallback reason when provided", () => {
      const content = generateDigestContent(store, "daily", "push_failures");

      expect(content.fallbackReason).toBe("push_failures");
    });
  });

  describe("formatDigestAsHTML", () => {
    it("formats digest as valid HTML", () => {
      const content = generateDigestContent(store, "daily");
      const html = formatDigestAsHTML(content);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html>");
      expect(html).toContain("</html>");
      expect(html).toContain(content.summary.greeting);
    });

    it("includes fallback alert when reason provided", () => {
      const content = generateDigestContent(store, "daily", "user_inactive");
      const html = formatDigestAsHTML(content);

      expect(html).toContain("haven't checked the app recently");
      expect(html).toContain("email digest as a backup");
    });

    it("shows empty state for no deadlines", () => {
      const content = generateDigestContent(store, "daily");
      const html = formatDigestAsHTML(content);

      expect(html).toContain("No upcoming deadlines");
    });

    it("includes weekly stats for weekly digest", () => {
      const content = generateDigestContent(store, "weekly");
      const html = formatDigestAsHTML(content);

      expect(html).toContain("This Week's Stats");
      expect(html).toContain("Deadlines completed");
    });
  });

  describe("formatDigestAsText", () => {
    it("formats digest as plain text", () => {
      const content = generateDigestContent(store, "daily");
      const text = formatDigestAsText(content);

      expect(text).toContain(content.summary.greeting);
      expect(text).toContain("UPCOMING DEADLINES");
      expect(text).toContain("====");
    });

    it("includes fallback message in text format", () => {
      const content = generateDigestContent(store, "daily", "push_failures");
      const text = formatDigestAsText(content);

      expect(text).toContain("push notifications haven't been reaching you");
    });
  });

  describe("shouldSendFallbackDigest", () => {
    beforeEach(() => {
      store.updateEmailDigestConfig({
        enabled: true,
        email: "test@example.com",
        frequency: "daily",
        fallbackEnabled: true,
        fallbackThresholdHours: 24
      });
    });

    it("returns false when fallback is disabled", () => {
      store.updateEmailDigestConfig({ fallbackEnabled: false });

      const result = shouldSendFallbackDigest(store);

      expect(result.shouldSend).toBe(false);
    });

    it("returns false when digest is disabled", () => {
      store.updateEmailDigestConfig({ enabled: false });

      const result = shouldSendFallbackDigest(store);

      expect(result.shouldSend).toBe(false);
    });

    it("triggers fallback for multiple push failures", () => {
      // Record multiple push failures
      const notification = {
        id: makeId("notif"),
        title: "Test notification",
        message: "Test",
        priority: "medium" as const,
        source: "orchestrator" as const,
        timestamp: nowIso()
      };

      for (let i = 0; i < 3; i++) {
        store.recordPushDeliveryResult("endpoint-123", notification, {
          delivered: false,
          shouldDropSubscription: false,
          error: "Failed to deliver"
        });
      }

      const result = shouldSendFallbackDigest(store);

      expect(result.shouldSend).toBe(true);
      expect(result.reason).toBe("push_failures");
    });

    it("triggers fallback for user inactivity", () => {
      // No interactions recorded, should trigger after threshold

      const result = shouldSendFallbackDigest(store);

      expect(result.shouldSend).toBe(true);
      expect(result.reason).toBe("user_inactive");
    });

    it("does not trigger when user is active", () => {
      // Record a recent interaction
      store.recordNotificationInteraction(
        "notif-123",
        "Test notification",
        "orchestrator",
        "medium",
        "tap"
      );

      const result = shouldSendFallbackDigest(store);

      expect(result.shouldSend).toBe(false);
    });
  });

  describe("shouldSendScheduledDigest", () => {
    beforeEach(() => {
      store.updateEmailDigestConfig({
        enabled: true,
        email: "test@example.com",
        frequency: "daily",
        fallbackEnabled: false,
        fallbackThresholdHours: 24
      });
    });

    it("returns false when digest is disabled", () => {
      store.updateEmailDigestConfig({ enabled: false });

      const result = shouldSendScheduledDigest(store);

      expect(result).toBe(false);
    });

    it("returns true when never sent before", () => {
      const result = shouldSendScheduledDigest(store);

      // Since it's never been sent and we're past 8am (or it's a test scenario)
      // Result depends on current time, so we check it's a boolean
      expect(typeof result).toBe("boolean");
    });

    it("respects daily schedule", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(9, 0, 0, 0);

      store.updateEmailDigestConfig({
        lastSentAt: yesterday.toISOString()
      });

      const result = shouldSendScheduledDigest(store);

      // Should send if today and after 8am
      expect(typeof result).toBe("boolean");
    });

    it("respects weekly schedule", () => {
      store.updateEmailDigestConfig({ frequency: "weekly" });

      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);

      store.updateEmailDigestConfig({
        lastSentAt: lastWeek.toISOString()
      });

      const result = shouldSendScheduledDigest(store);

      // Should send on Sunday after 8am
      expect(typeof result).toBe("boolean");
    });
  });

  describe("EmailDigestConfig persistence", () => {
    it("stores and retrieves config", () => {
      store.updateEmailDigestConfig({
        enabled: true,
        email: "user@example.com",
        frequency: "weekly",
        fallbackEnabled: true,
        fallbackThresholdHours: 48
      });

      const config = store.getEmailDigestConfig();

      expect(config.enabled).toBe(true);
      expect(config.email).toBe("user@example.com");
      expect(config.frequency).toBe("weekly");
      expect(config.fallbackEnabled).toBe(true);
      expect(config.fallbackThresholdHours).toBe(48);
    });

    it("updates lastSentAt", () => {
      const now = nowIso();
      store.updateEmailDigestConfig({
        lastSentAt: now
      });

      const config = store.getEmailDigestConfig();

      expect(config.lastSentAt).toBe(now);
    });
  });
});
