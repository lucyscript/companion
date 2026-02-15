import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";

const app = express();
const store = new RuntimeStore();
const runtime = new OrchestratorRuntime(store);

runtime.start();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/dashboard", (_req, res) => {
  res.json(store.getSnapshot());
});

const contextSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const journalEntrySchema = z.object({
  content: z.string().min(1).max(10000)
});

const scheduleCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"])
});

const scheduleUpdateSchema = scheduleCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineCreateSchema = z.object({
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean().optional().default(false)
});

const deadlineUpdateSchema = deadlineCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

app.post("/api/context", (req, res) => {
  const parsed = contextSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid context payload", issues: parsed.error.issues });
  }

  const updated = store.setUserContext(parsed.data);
  return res.json({ context: updated });
});

app.post("/api/journal", (req, res) => {
  const parsed = journalEntrySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid journal entry", issues: parsed.error.issues });
  }

  const entry = store.recordJournalEntry(parsed.data.content);
  return res.json({ entry });
});

app.get("/api/journal", (req, res) => {
  const limitParam = req.query.limit;
  const limit = limitParam ? parseInt(limitParam as string, 10) : undefined;

  if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
    return res.status(400).json({ error: "Invalid limit parameter" });
  }

  const entries = store.getJournalEntries(limit);
  return res.json({ entries });
});

app.post("/api/schedule", (req, res) => {
  const parsed = scheduleCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.createLectureEvent(parsed.data);
  return res.status(201).json({ lecture });
});

app.get("/api/schedule", (_req, res) => {
  return res.json({ schedule: store.getScheduleEvents() });
});

app.get("/api/schedule/:id", (req, res) => {
  const lecture = store.getScheduleEventById(req.params.id);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.patch("/api/schedule/:id", (req, res) => {
  const parsed = scheduleUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.updateScheduleEvent(req.params.id, parsed.data);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.delete("/api/schedule/:id", (req, res) => {
  const deleted = store.deleteScheduleEvent(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.status(204).send();
});

app.post("/api/deadlines", (req, res) => {
  const parsed = deadlineCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.createDeadline(parsed.data);
  return res.status(201).json({ deadline });
});

app.get("/api/deadlines", (_req, res) => {
  return res.json({ deadlines: store.getDeadlines() });
});

app.get("/api/deadlines/:id", (req, res) => {
  const deadline = store.getDeadlineById(req.params.id);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.patch("/api/deadlines/:id", (req, res) => {
  const parsed = deadlineUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.updateDeadline(req.params.id, parsed.data);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.delete("/api/deadlines/:id", (req, res) => {
  const deleted = store.deleteDeadline(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.status(204).send();
});

const server = app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[axis-server] listening on http://localhost:${config.PORT}`);
});

const shutdown = (): void => {
  runtime.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
