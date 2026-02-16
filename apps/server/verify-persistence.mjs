#!/usr/bin/env node
/**
 * Verification script for SQLite-backed persistence in RuntimeStore.
 * 
 * This script demonstrates that:
 * 1. RuntimeStore uses SQLite for file-backed persistence (companion.db by default)
 * 2. Data persists across multiple store instances (simulating app restarts)
 * 3. All data types are correctly stored and retrieved: schedules, deadlines, preferences, journals
 * 
 * Run: node verify-persistence.mjs
 */

import { RuntimeStore } from "./dist/store.js";
import fs from "fs";
import path from "path";

const testDbPath = "/tmp/companion-persistence-test.db";

console.log("╔═════════════════════════════════════════════════════════════╗");
console.log("║  Verifying SQLite-Backed Persistence in RuntimeStore       ║");
console.log("╚═════════════════════════════════════════════════════════════╝\n");

// Clean up any existing test database
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
  console.log("🧹 Cleaned up previous test database\n");
}

// ==================== PHASE 1: Create and populate ====================
console.log("📝 PHASE 1: Creating RuntimeStore and adding data...");
console.log("─────────────────────────────────────────────────────────────");

const store1 = new RuntimeStore(testDbPath);

// Add a schedule event
store1.createLectureEvent({
  title: "DAT520 Distributed Systems",
  startTime: new Date("2026-02-17T10:15:00Z").toISOString(),
  durationMinutes: 90,
  workload: "medium"
});

// Add a deadline
store1.createDeadline({
  course: "DAT560",
  task: "Assignment 1: VAE Implementation",
  dueDate: new Date("2026-02-24T23:59:00Z").toISOString(),
  priority: "high",
  completed: false
});

// Add a journal entry
store1.recordJournalEntry(
  "Today was productive! Finished the MapReduce lab and started on the VAE assignment.",
  []
);

// Update user context
store1.setUserContext({
  stressLevel: "low",
  energyLevel: "high",
  mode: "focused"
});

// Update notification preferences
store1.setNotificationPreferences({
  quietHours: {
    enabled: true,
    startHour: 22,
    endHour: 7
  }
});

const snapshot1 = {
  schedule: store1.getScheduleEvents(),
  deadlines: store1.getDeadlines(),
  journal: store1.getJournalEntries(),
  context: store1.getUserContext()
};
console.log(`✓ Added ${snapshot1.schedule.length} schedule event(s)`);
console.log(`✓ Added ${snapshot1.deadlines.length} deadline(s)`);
console.log(`✓ Added ${snapshot1.journal.length} journal entry(ies)`);
console.log(`✓ Updated user context: ${snapshot1.context.stressLevel}/${snapshot1.context.energyLevel}/${snapshot1.context.mode}`);
const prefs1 = store1.getNotificationPreferences();
console.log(`✓ Updated notification preferences: quiet hours ${prefs1.quietHours.startHour}:00-${prefs1.quietHours.endHour}:00`);

// Check that the database file was created
const dbStats = fs.statSync(testDbPath);
console.log(`\n📦 Database file created at: ${testDbPath}`);
console.log(`   Size: ${(dbStats.size / 1024).toFixed(2)} KB`);

// ==================== PHASE 2: Simulate restart ====================
console.log("\n🔄 PHASE 2: Simulating app restart...");
console.log("─────────────────────────────────────────────────────────────");
console.log("   (Creating new RuntimeStore instance from same database file)");

const store2 = new RuntimeStore(testDbPath);
const snapshot2 = {
  schedule: store2.getScheduleEvents(),
  deadlines: store2.getDeadlines(),
  journal: store2.getJournalEntries(),
  context: store2.getUserContext()
};

console.log(`\n✓ Loaded ${snapshot2.schedule.length} schedule event(s)`);
console.log(`✓ Loaded ${snapshot2.deadlines.length} deadline(s)`);
console.log(`✓ Loaded ${snapshot2.journal.length} journal entry(ies)`);
console.log(`✓ Loaded user context: ${snapshot2.context.stressLevel}/${snapshot2.context.energyLevel}/${snapshot2.context.mode}`);
const prefs2 = store2.getNotificationPreferences();
console.log(`✓ Loaded notification preferences: quiet hours ${prefs2.quietHours.startHour}:00-${prefs2.quietHours.endHour}:00`);

// ==================== PHASE 3: Verify data integrity ====================
console.log("\n🔍 PHASE 3: Verifying data integrity...");
console.log("─────────────────────────────────────────────────────────────");

const scheduleMatch = snapshot2.schedule.some(e => e.title === "DAT520 Distributed Systems" && e.durationMinutes === 90);
const deadlineMatch = snapshot2.deadlines.some(d => d.task === "Assignment 1: VAE Implementation" && d.course === "DAT560");
const journalMatch = snapshot2.journal.some(j => j.content.includes("MapReduce lab"));
const contextMatch = snapshot2.context.stressLevel === "low" && snapshot2.context.energyLevel === "high" && snapshot2.context.mode === "focused";
const prefsMatch = prefs2.quietHours.enabled === true && prefs2.quietHours.startHour === 22 && prefs2.quietHours.endHour === 7;

console.log(`${scheduleMatch ? "✅" : "❌"} Schedule event persisted correctly`);
console.log(`${deadlineMatch ? "✅" : "❌"} Deadline persisted correctly`);
console.log(`${journalMatch ? "✅" : "❌"} Journal entry persisted correctly`);
console.log(`${contextMatch ? "✅" : "❌"} User context persisted correctly`);
console.log(`${prefsMatch ? "✅" : "❌"} Notification preferences persisted correctly`);

// ==================== PHASE 4: Add more data to verify append works ====================
console.log("\n➕ PHASE 4: Adding more data to verify append works...");
console.log("─────────────────────────────────────────────────────────────");

store2.createDeadline({
  course: "DAT600",
  task: "Thesis proposal",
  dueDate: new Date("2026-03-01T23:59:00Z").toISOString(),
  priority: "critical",
  completed: false
});

const snapshot3 = {
  deadlines: store2.getDeadlines()
};
console.log(`✓ Total deadlines after append: ${snapshot3.deadlines.length}`);

// ==================== PHASE 5: Verify with third instance ====================
console.log("\n🔄 PHASE 5: Verifying with third instance (another 'restart')...");
console.log("─────────────────────────────────────────────────────────────");

const store3 = new RuntimeStore(testDbPath);
const snapshot4 = {
  deadlines: store3.getDeadlines()
};

console.log(`✓ Total deadlines: ${snapshot4.deadlines.length}`);
const thesisDeadline = snapshot4.deadlines.find(d => d.task === "Thesis proposal");
console.log(`${thesisDeadline ? "✅" : "❌"} New deadline persisted correctly`);

// ==================== Summary ====================
console.log("\n╔═════════════════════════════════════════════════════════════╗");
console.log("║                    VERIFICATION SUMMARY                     ║");
console.log("╚═════════════════════════════════════════════════════════════╝");

const allPassed = scheduleMatch && deadlineMatch && journalMatch && contextMatch && prefsMatch && thesisDeadline;

if (allPassed) {
  console.log("\n✅ SUCCESS: SQLite-backed persistence is working correctly!\n");
  console.log("The RuntimeStore implementation:");
  console.log("  • Uses better-sqlite3 for file-backed persistence");
  console.log("  • Stores all data in SQLite (companion.db by default)");
  console.log("  • Persists schedules, deadlines, journals, preferences, and context");
  console.log("  • Data survives app restarts");
  console.log("  • All data integrity checks passed\n");
  console.log("Feature Status: ✅ COMPLETE\n");
} else {
  console.log("\n❌ FAILED: Some data did not persist correctly\n");
  process.exit(1);
}

// Clean up
fs.unlinkSync(testDbPath);
console.log(`🧹 Cleaned up test database: ${testDbPath}\n`);
