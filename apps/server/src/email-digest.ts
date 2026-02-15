import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "./config.js";
import { RuntimeStore } from "./store.js";
import { DigestContent, DigestFrequency, Deadline, LectureEvent, JournalEntry } from "./types.js";
import { nowIso } from "./utils.js";

/**
 * Check if SMTP email is configured
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    config.AXIS_SMTP_HOST &&
    config.AXIS_SMTP_PORT &&
    config.AXIS_SMTP_USER &&
    config.AXIS_SMTP_PASSWORD &&
    config.AXIS_SMTP_FROM &&
    config.AXIS_DIGEST_EMAIL
  );
}

/**
 * Create email transporter if configured
 */
function createTransporter(): Transporter | null {
  if (!isEmailConfigured()) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.AXIS_SMTP_HOST,
    port: config.AXIS_SMTP_PORT,
    secure: config.AXIS_SMTP_PORT === 465,
    auth: {
      user: config.AXIS_SMTP_USER,
      pass: config.AXIS_SMTP_PASSWORD
    }
  });
}

/**
 * Generate digest content from store
 */
export function generateDigestContent(
  store: RuntimeStore,
  frequency: DigestFrequency,
  fallbackReason?: "push_failures" | "user_inactive"
): DigestContent {
  const now = new Date();
  const userName = config.AXIS_USER_NAME || "friend";
  
  // Get upcoming deadlines (next 7 days for daily, next 14 days for weekly)
  const daysAhead = frequency === "daily" ? 7 : 14;
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  const allDeadlines = store.getDeadlines();
  const upcomingDeadlines = allDeadlines
    .filter(d => !d.completed && new Date(d.dueDate) <= futureDate)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 5);

  // Get today's schedule
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  
  const allSchedule = store.getScheduleEvents();
  const todaySchedule = allSchedule
    .filter(event => {
      const eventTime = new Date(event.startTime);
      return eventTime >= startOfDay && eventTime <= endOfDay;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Get recent journal entries
  const allJournals = store.getJournalEntries();
  const recentJournalHighlights = allJournals.slice(0, 3);

  // Get pending habits for today
  const habits = store.getHabits();
  const pendingHabits = habits.filter(h => !h.todayCompleted).slice(0, 5);

  let weeklyStats;
  if (frequency === "weekly") {
    const weeklySummary = store.getWeeklySummary();
    weeklyStats = {
      deadlinesCompleted: weeklySummary.deadlinesCompleted,
      journalEntries: allJournals.filter(j => {
        const entryDate = new Date(j.timestamp);
        return entryDate >= new Date(weeklySummary.windowStart);
      }).length,
      habitsCompleted: habits.reduce((sum, h) => {
        const completedLast7d = (h.recentCheckIns || []).filter(c => c.completed).length;
        return sum + completedLast7d;
      }, 0)
    };
  }

  const greeting = frequency === "daily"
    ? `Good morning, ${userName}! Here's what's on your plate today:`
    : `Hi ${userName}! Here's your weekly roundup:`;

  return {
    type: frequency,
    generatedAt: nowIso(),
    summary: {
      greeting,
      upcomingDeadlines,
      todaySchedule,
      recentJournalHighlights,
      pendingHabits,
      weeklyStats
    },
    fallbackReason
  };
}

/**
 * Format digest content as HTML email
 */
export function formatDigestAsHTML(content: DigestContent): string {
  const { summary, fallbackReason, type } = content;
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #4a5568; font-size: 24px; margin-bottom: 10px; }
    h2 { color: #2d3748; font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin-bottom: 20px; border-radius: 4px; }
    .item { background: #f7fafc; padding: 12px; margin-bottom: 8px; border-radius: 4px; border-left: 3px solid #4299e1; }
    .priority-high { border-left-color: #f56565; }
    .priority-critical { border-left-color: #c53030; }
    .deadline { font-weight: 600; color: #2d3748; }
    .course { color: #4a5568; }
    .time { color: #718096; font-size: 14px; }
    .empty { color: #a0aec0; font-style: italic; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${summary.greeting}</h1>
`;

  if (fallbackReason) {
    const reason = fallbackReason === "push_failures"
      ? "We noticed push notifications haven't been reaching you lately."
      : "You haven't checked the app recently.";
    html += `  <div class="alert">📧 ${reason} Sending this email digest as a backup!</div>\n`;
  }

  // Upcoming deadlines
  html += `  <h2>📋 Upcoming Deadlines</h2>\n`;
  if (summary.upcomingDeadlines.length === 0) {
    html += `  <p class="empty">No upcoming deadlines. Nice!</p>\n`;
  } else {
    summary.upcomingDeadlines.forEach(deadline => {
      const dueDate = new Date(deadline.dueDate);
      const priorityClass = deadline.priority === "high" || deadline.priority === "critical" ? `priority-${deadline.priority}` : "";
      html += `  <div class="item ${priorityClass}">
    <div class="deadline">${deadline.task}</div>
    <div class="course">${deadline.course}</div>
    <div class="time">Due: ${dueDate.toLocaleDateString()} ${dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  </div>\n`;
    });
  }

  // Today's schedule (only for daily)
  if (type === "daily") {
    html += `  <h2>📅 Today's Schedule</h2>\n`;
    if (summary.todaySchedule.length === 0) {
      html += `  <p class="empty">No classes scheduled today.</p>\n`;
    } else {
      summary.todaySchedule.forEach(event => {
        const startTime = new Date(event.startTime);
        html += `  <div class="item">
    <div class="deadline">${event.title}</div>
    <div class="time">${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${event.durationMinutes} min)</div>
  </div>\n`;
      });
    }
  }

  // Pending habits
  if (summary.pendingHabits.length > 0) {
    html += `  <h2>✅ Habits to Check In</h2>\n`;
    summary.pendingHabits.forEach(habit => {
      html += `  <div class="item">
    <div class="deadline">${habit.name}</div>
    <div class="time">Streak: ${habit.streak} days</div>
  </div>\n`;
    });
  }

  // Recent journal highlights
  if (summary.recentJournalHighlights.length > 0) {
    html += `  <h2>📝 Recent Journal Entries</h2>\n`;
    summary.recentJournalHighlights.forEach(entry => {
      const timestamp = new Date(entry.timestamp);
      const preview = entry.content.length > 100 ? entry.content.substring(0, 100) + "..." : entry.content;
      html += `  <div class="item">
    <div>${preview}</div>
    <div class="time">${timestamp.toLocaleDateString()}</div>
  </div>\n`;
    });
  }

  // Weekly stats (only for weekly)
  if (type === "weekly" && summary.weeklyStats) {
    html += `  <h2>📊 This Week's Stats</h2>\n`;
    html += `  <div class="item">
    <div>✅ Deadlines completed: ${summary.weeklyStats.deadlinesCompleted}</div>
    <div>📝 Journal entries: ${summary.weeklyStats.journalEntries}</div>
    <div>🎯 Habits completed: ${summary.weeklyStats.habitsCompleted}</div>
  </div>\n`;
  }

  html += `  <div class="footer">
    <p>This is an automated ${type} digest from your Companion app.</p>
    <p>To manage your digest preferences, open the Companion app and visit Settings.</p>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Format digest content as plain text email (fallback)
 */
export function formatDigestAsText(content: DigestContent): string {
  const { summary, fallbackReason, type } = content;
  
  let text = `${summary.greeting}\n\n`;

  if (fallbackReason) {
    const reason = fallbackReason === "push_failures"
      ? "We noticed push notifications haven't been reaching you lately."
      : "You haven't checked the app recently.";
    text += `📧 ${reason} Sending this email digest as a backup!\n\n`;
  }

  text += `📋 UPCOMING DEADLINES\n${"=".repeat(40)}\n`;
  if (summary.upcomingDeadlines.length === 0) {
    text += `No upcoming deadlines. Nice!\n\n`;
  } else {
    summary.upcomingDeadlines.forEach(deadline => {
      const dueDate = new Date(deadline.dueDate);
      text += `• ${deadline.task}\n  ${deadline.course}\n  Due: ${dueDate.toLocaleString()}\n\n`;
    });
  }

  if (type === "daily") {
    text += `📅 TODAY'S SCHEDULE\n${"=".repeat(40)}\n`;
    if (summary.todaySchedule.length === 0) {
      text += `No classes scheduled today.\n\n`;
    } else {
      summary.todaySchedule.forEach(event => {
        const startTime = new Date(event.startTime);
        text += `• ${event.title}\n  ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${event.durationMinutes} min)\n\n`;
      });
    }
  }

  if (summary.pendingHabits.length > 0) {
    text += `✅ HABITS TO CHECK IN\n${"=".repeat(40)}\n`;
    summary.pendingHabits.forEach(habit => {
      text += `• ${habit.name} (Streak: ${habit.streak} days)\n`;
    });
    text += `\n`;
  }

  if (summary.recentJournalHighlights.length > 0) {
    text += `📝 RECENT JOURNAL ENTRIES\n${"=".repeat(40)}\n`;
    summary.recentJournalHighlights.forEach(entry => {
      const timestamp = new Date(entry.timestamp);
      const preview = entry.content.length > 100 ? entry.content.substring(0, 100) + "..." : entry.content;
      text += `• ${preview}\n  ${timestamp.toLocaleDateString()}\n\n`;
    });
  }

  if (type === "weekly" && summary.weeklyStats) {
    text += `📊 THIS WEEK'S STATS\n${"=".repeat(40)}\n`;
    text += `✅ Deadlines completed: ${summary.weeklyStats.deadlinesCompleted}\n`;
    text += `📝 Journal entries: ${summary.weeklyStats.journalEntries}\n`;
    text += `🎯 Habits completed: ${summary.weeklyStats.habitsCompleted}\n\n`;
  }

  text += `${"=".repeat(40)}\n`;
  text += `This is an automated ${type} digest from your Companion app.\n`;
  text += `To manage your digest preferences, open the Companion app and visit Settings.\n`;

  return text;
}

/**
 * Send email digest
 */
export async function sendEmailDigest(
  store: RuntimeStore,
  frequency: DigestFrequency,
  fallbackReason?: "push_failures" | "user_inactive"
): Promise<{ sent: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { sent: false, error: "Email not configured" };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false, error: "Failed to create email transporter" };
  }

  const content = generateDigestContent(store, frequency, fallbackReason);
  const html = formatDigestAsHTML(content);
  const text = formatDigestAsText(content);

  const subject = frequency === "daily"
    ? `Daily Digest — ${new Date().toLocaleDateString()}`
    : `Weekly Roundup — ${new Date().toLocaleDateString()}`;

  try {
    await transporter.sendMail({
      from: config.AXIS_SMTP_FROM,
      to: config.AXIS_DIGEST_EMAIL,
      subject,
      text,
      html
    });

    // Update last sent time in store
    const digestConfig = store.getEmailDigestConfig();
    store.updateEmailDigestConfig({
      ...digestConfig,
      lastSentAt: nowIso()
    });

    return { sent: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error sending email";
    return { sent: false, error: errorMessage };
  }
}

/**
 * Check if digest should be sent as fallback
 */
export function shouldSendFallbackDigest(store: RuntimeStore): {
  shouldSend: boolean;
  reason?: "push_failures" | "user_inactive";
} {
  const digestConfig = store.getEmailDigestConfig();
  
  if (!digestConfig.enabled || !digestConfig.fallbackEnabled) {
    return { shouldSend: false };
  }

  const thresholdMs = digestConfig.fallbackThresholdHours * 60 * 60 * 1000;
  const now = Date.now();

  // Check for push delivery failures
  const pushMetrics = store.getPushDeliveryMetrics();
  const recentFailureCount = pushMetrics.recentFailures.filter(f => {
    const failedAt = new Date(f.failedAt).getTime();
    return now - failedAt < thresholdMs;
  }).length;

  // If 3+ failures in the threshold period, trigger fallback
  if (recentFailureCount >= 3) {
    return { shouldSend: true, reason: "push_failures" };
  }

  // Check for user inactivity (no notification interactions)
  const thresholdDate = new Date(now - thresholdMs).toISOString();
  const recentInteractions = store.getNotificationInteractions({
    since: thresholdDate,
    limit: 1
  });

  // If no interactions in threshold period, trigger fallback
  if (recentInteractions.length === 0) {
    return { shouldSend: true, reason: "user_inactive" };
  }

  return { shouldSend: false };
}

/**
 * Check if scheduled digest should be sent
 */
export function shouldSendScheduledDigest(store: RuntimeStore): boolean {
  const digestConfig = store.getEmailDigestConfig();
  
  if (!digestConfig.enabled) {
    return false;
  }

  const now = new Date();
  const lastSent = digestConfig.lastSentAt ? new Date(digestConfig.lastSentAt) : null;

  if (!lastSent) {
    return true; // Never sent, should send now
  }

  if (digestConfig.frequency === "daily") {
    // Send daily at 8am local time
    const lastSentDate = new Date(lastSent);
    const isSameDay = lastSentDate.toDateString() === now.toDateString();
    const isAfter8AM = now.getHours() >= 8;
    
    return !isSameDay && isAfter8AM;
  } else {
    // Send weekly on Sunday at 8am
    const isSunday = now.getDay() === 0;
    const isAfter8AM = now.getHours() >= 8;
    const daysSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
    
    return isSunday && isAfter8AM && daysSinceLastSent >= 7;
  }
}
