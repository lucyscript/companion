# System Overview

Companion is a **personal AI companion** designed for university students. It runs as a mobile-first PWA backed by a Node.js server, with Google Gemini as the conversational AI engine.

The user interacts primarily through **natural language chat**. Gemini has tool access to manage the user's schedule, deadlines, nutrition, habits, goals, and integrations — making the chat interface the control surface for the entire app.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 · TypeScript · Vite 5 (PWA) |
| **Backend** | Node.js · Express 4 · TypeScript |
| **Database** | SQLite (runtime) · PostgreSQL (snapshot persistence) |
| **AI** | Google Gemini (Vertex AI) — `gemini-3-flash-preview` (chat), `gemini-2.5-flash` (fallback) |
| **Payments** | Stripe · Vipps MobilePay (Norwegian market) |
| **Push** | Web Push (VAPID) |
| **Auth** | Session-based (local + Google OAuth + GitHub OAuth) |
| **Deployment** | Railway (server) · GitHub Pages (frontend) |

---

## Monorepo Structure

```
companion/
├── apps/
│   ├── server/          # Express API + background services
│   │   └── src/
│   │       ├── index.ts           # 4800-line Express app (all routes)
│   │       ├── store.ts           # SQLite data layer (8300 lines, 45 tables)
│   │       ├── gemini.ts          # Gemini client (Live API + REST fallback)
│   │       ├── gemini-tools.ts    # 46+ tool declarations & handlers
│   │       ├── chat.ts            # Chat pipeline (context assembly, tool loop, memory)
│   │       ├── orchestrator.ts    # Background jobs (reminders, digests, proactive triggers)
│   │       ├── config.ts          # Zod-validated env vars
│   │       ├── auth.ts            # Session auth + OAuth
│   │       ├── plan-config.ts     # Free / Plus / Pro tier definitions
│   │       ├── types.ts           # Shared TypeScript types (1100 lines)
│   │       └── ...                # 50+ modules (sync services, bridges, utilities)
│   └── web/             # React PWA
│       └── src/
│           ├── App.tsx            # Root — auth, tabs, mood theming
│           ├── components/        # 34 view/widget components
│           ├── hooks/             # useDashboard, usePlan, usePullToRefresh, useSwipeAction
│           ├── lib/               # API client, i18n, push, storage, sync, theme
│           └── types.ts           # Frontend type definitions (814 lines)
├── docs/                # ← You are here
│   ├── legacy/          # Agent-era docs (preserved for reference)
│   └── ...              # Current documentation
└── .github/             # CI/CD workflows
```

---

## Core Concepts

### Chat-First UX

The chat tab is the primary interface. Users talk to Gemini about their day, and the AI can:

- Create/update/delete **schedule events**, **deadlines**, **habits**, **goals**, **meals**
- Set **reminders** and **mood** for the UI
- Read the user's **full context** (schedule, nutrition, health data, journal, Canvas)
- **Cite sources** inline (schedule items, deadlines, Canvas announcements, web search results)
- Propose **pending actions** for destructive operations — the user must confirm before execution

### Multi-Tenant Architecture

Every data table includes a `userId` column. Users authenticate via local login, Google OAuth, or GitHub OAuth. Background services (email digest, schedule sync, Canvas sync) are spun up per-user on demand.

### Plan Gating

Features, tool access, and connectors are gated by plan tier:

| | **Free** | **Plus** (49 NOK/mo) | **Pro** (99 NOK/mo) |
|---|---|---|---|
| Chat messages/day | 10 | 75 | Unlimited |
| Chat history | 50 msgs | 500 msgs | Unlimited |
| Features | Chat, Schedule, Connectors | + Nutrition, Gemini tools, Custom moods | + Habits/Goals, Analytics |
| Connectors | Canvas, Blackboard, TP, TimeEdit | + MCP, Teams, Withings | All |
| Gemini tools | 16 (schedule/deadline CRUD) | + 22 nutrition tools | + 8 growth tools |

Admin users always get Pro access. Free users with an active trial get Plus.

### Gemini Integration

The app uses **Vertex AI Live API** (WebSocket) as the primary chat transport:

- **Model**: `gemini-3-flash-preview` (configurable via `GEMINI_LIVE_MODEL`)
- **Fallback**: `gemini-2.5-flash` (REST API, used when Live API is unavailable)
- **Thinking level**: `MEDIUM` (configurable via `GEMINI_THINKING_LEVEL`: MINIMAL / LOW / MEDIUM / HIGH)
- **Tool calling**: Gemini executes server-side functions in a loop until the final text response
- **Context window**: Every request includes today's schedule, upcoming deadlines, recent journal reflections, nutrition targets, habit/goal status, and Canvas data
- **Long-term memory**: When chat history exceeds token limits, it's compressed into a summary stored in `chat_long_term_memory`

### Data Persistence

```
┌─────────────┐     snapshot every 30s     ┌──────────────┐
│   SQLite     │ ──────────────────────►    │  PostgreSQL   │
│  (runtime)   │                            │  (snapshots)  │
│  companion.db│ ◄──────────────────────    │              │
└─────────────┘     restore on startup      └──────────────┘
```

- **SQLite** (`better-sqlite3`) is the runtime database — all reads and writes go here
- **PostgreSQL** stores periodic snapshots of the SQLite file for durability
- On startup, the latest PostgreSQL snapshot is restored to the SQLite path
- Auto-sync interval is configurable (`POSTGRES_SNAPSHOT_SYNC_MS`, default 30s)

---

## Background Services

| Service | Scope | Frequency | Description |
|---------|-------|-----------|-------------|
| **OrchestratorRuntime** | Global | 30s–60s | Deadline reminders, scheduled notifications, proactive chat triggers |
| **BackgroundSyncService** | Global | Continuous | Processes offline sync queue |
| **TPSyncService** | Per-user | Periodic | Syncs TP EduCloud iCal schedule |
| **TimeEditSyncService** | Per-user | Periodic | Syncs TimeEdit iCal schedule |
| **CanvasSyncService** | Per-user | On-demand (stale after 25min) | Canvas LMS assignment/course sync |
| **BlackboardSyncService** | Per-user | Periodic (plan-gated) | Blackboard Learn sync |
| **TeamsSyncService** | Per-user | Periodic (plan-gated) | Microsoft Teams assignments sync |
| **WithingsSyncService** | Per-user | Periodic | Withings weight & sleep data |
| **EmailDigestService** | Per-user | Periodic | Email digest notifications |
| **PostgresSnapshotStore** | Global | 30s | SQLite → PostgreSQL persistence |

---

## Integration Connectors

Users connect external services through the Connectors settings page:

| Connector | Auth Method | Data Synced |
|-----------|-------------|------------|
| **Canvas LMS** | Personal access token + base URL | Courses, assignments → deadlines |
| **Blackboard Learn** | Credentials | Courses, assignments → deadlines |
| **Microsoft Teams** | Credentials (plan-gated) | Assignments → deadlines |
| **TP EduCloud** | iCal URL (public, no auth) | Lecture schedule → events |
| **TimeEdit** | iCal URL (public, no auth) | Lecture schedule → events |
| **Withings** | OAuth 2.0 | Weight, sleep data → health context |
| **MCP Servers** | Token / OAuth (per-server) | Extensible tools for Gemini |

---

## Database Schema (45 Tables)

Organized by domain:

| Domain | Tables |
|--------|--------|
| **Auth** | `users`, `auth_sessions`, `user_connections` |
| **Chat** | `chat_messages`, `chat_pending_actions`, `chat_long_term_memory`, `reflection_entries` |
| **Journal** | `journal_entries`, `journal_entry_tags`, `tags` |
| **Schedule** | `schedule_events`, `schedule_suggestion_mutes`, `routine_presets` |
| **Deadlines** | `deadlines`, `deadline_reminder_state` |
| **Study Planner** | `study_plan_sessions` |
| **Growth** | `habits`, `habit_check_ins`, `goals`, `goal_check_ins` |
| **Nutrition** | `nutrition_meals`, `nutrition_custom_foods`, `nutrition_target_profiles`, `nutrition_plan_snapshots`, `nutrition_plan_settings` |
| **Notifications** | `notifications`, `scheduled_notifications`, `notification_interactions`, `notification_preferences` |
| **Push** | `push_subscriptions`, `push_delivery_failures`, `push_delivery_metrics` |
| **Email** | `email_digests` |
| **Context** | `user_context`, `context_history` |
| **Locations** | `locations`, `location_history` |
| **Sync** | `sync_queue`, `integration_sync_attempts` |
| **Integrations** | `canvas_data`, `blackboard_data`, `teams_data`, `withings_data` |
| **Agents** | `agent_events`, `agent_states` |

All user-scoped tables include a `userId` column for multi-tenant data isolation.
