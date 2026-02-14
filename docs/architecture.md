# AXIS Architecture

## Purpose

This document describes the system architecture and data flow of **AXIS** (Autonomous eXtensible Intelligent System) — a personal AI companion web app that proactively manages day-to-day life through specialized agents.

## High-Level Architecture

AXIS follows a **client-server architecture** with an event-driven agent orchestration model:

```
┌─────────────────┐         HTTP/REST         ┌──────────────────┐
│   React Web     │ ←─────────────────────→  │   Express API    │
│   Dashboard     │      JSON payloads        │   (Node + TS)    │
│  (apps/web)     │                           │  (apps/server)   │
└─────────────────┘                           └──────────────────┘
                                                       │
                                                       │ manages
                                                       ▼
                                              ┌──────────────────┐
                                              │  Orchestrator    │
                                              │    Runtime       │
                                              └──────────────────┘
                                                       │
                                       ┌───────────────┼───────────────┐
                                       │               │               │
                                       ▼               ▼               ▼
                                  ┌────────┐     ┌────────┐     ┌────────┐
                                  │ Notes  │     │Lecture │ ... │ Video  │
                                  │ Agent  │     │ Agent  │     │ Agent  │
                                  └────────┘     └────────┘     └────────┘
                                       │               │               │
                                       └───────────────┼───────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │  RuntimeStore    │
                                              │  (in-memory)     │
                                              └──────────────────┘
```

## Core Components

### Frontend (`apps/web`)

**Technology**: React 18 + Vite + TypeScript

**Responsibilities**:
- Render dashboard UI with agent status, notifications, and summary tiles
- Poll backend for dashboard updates via `/api/dashboard`
- Allow user to update context (stress level, energy level, mode) via `/api/context`
- Display real-time agent events and notifications

**Key Files**:
- `src/main.tsx` — Application entry point
- `src/App.tsx` — Main dashboard layout and data orchestration
- `src/hooks/useDashboard.ts` — Data fetching and refresh logic
- `src/components/` — UI components (AgentStatusList, NotificationFeed, SummaryTiles, etc.)

**Data Flow**:
1. User opens dashboard → `useDashboard` hook polls `/api/dashboard` every 6 seconds
2. Receives `DashboardSnapshot` with agent states, notifications, events
3. Renders tiles and feeds
4. User updates context → POST to `/api/context` → triggers immediate `refresh()`

### Backend (`apps/server`)

**Technology**: Express + TypeScript + Node.js

**Responsibilities**:
- Serve REST API for dashboard data and context updates
- Instantiate and manage the OrchestratorRuntime
- Maintain in-memory RuntimeStore with agent states, events, and notifications
- Handle graceful shutdown on SIGINT/SIGTERM

**Key Files**:
- `src/index.ts` — Express server setup and API endpoints
- `src/orchestrator.ts` — OrchestratorRuntime manages agent lifecycle
- `src/store.ts` — RuntimeStore holds system state
- `src/types.ts` — TypeScript definitions for all data structures
- `src/agent-base.ts` — BaseAgent abstract class
- `src/agents/` — Concrete agent implementations

**API Endpoints**:
- `GET /api/health` — Health check (returns `{ status: "ok" }`)
- `GET /api/dashboard` — Returns full `DashboardSnapshot`
- `POST /api/context` — Updates user context (stressLevel, energyLevel, mode)

### Orchestrator Runtime

**Location**: `apps/server/src/orchestrator.ts`

**Responsibilities**:
- Initialize all agents (Notes, Lecture Plan, Assignment Tracker, Food Tracking, Social Highlights, Video Editor)
- Schedule each agent to run at its defined interval
- Collect events emitted by agents
- Transform events into notifications
- Update RuntimeStore with agent states and events
- Provide graceful start/stop lifecycle

**Lifecycle**:
```typescript
start() → for each agent:
  1. Run agent immediately
  2. Schedule periodic runs via setInterval(agent.intervalMs)
  3. Catch errors and mark agent as error state
  4. Emit boot notification

stop() → clearInterval on all timers
```

**Event Handling**:
- Agents emit typed events (e.g., `assignment.deadline`, `lecture.reminder`)
- Orchestrator receives events via callback
- Events are recorded in RuntimeStore
- Events are transformed into user-facing notifications with title/message/priority

### Runtime Store

**Location**: `apps/server/src/store.ts`

**Responsibilities**:
- Hold in-memory state for the entire system
- Track agent states (idle, running, error) and last run timestamps
- Maintain circular buffers for events (max 100) and notifications (max 40)
- Store and compute user context (stress level, energy level, mode)
- Generate dashboard snapshots on demand

**Key Methods**:
- `markAgentRunning(name)` — Set agent status to "running"
- `markAgentError(name)` — Set agent status to "error"
- `recordEvent(event)` — Append event and update agent status to "idle"
- `pushNotification(notification)` — Add notification to feed
- `setUserContext(context)` — Update user context
- `getSnapshot()` — Generate `DashboardSnapshot` with summary, states, notifications, events

**State Schema**:
```typescript
{
  events: AgentEvent[],           // max 100, newest first
  notifications: Notification[],  // max 40, newest first
  agentStates: AgentState[],      // 7 agents + orchestrator
  userContext: UserContext        // stress, energy, mode
}
```

### Agents

**Base Class**: `apps/server/src/agent-base.ts`

**Contract**:
```typescript
abstract class BaseAgent {
  abstract name: AgentName;        // e.g., "notes", "lecture-plan"
  abstract intervalMs: number;     // run frequency in milliseconds
  abstract run(ctx: AgentContext): Promise<void>;
}
```

**Concrete Agents** (in `apps/server/src/agents/`):
1. **NotesAgent** — Prompts for journaling, reflection
2. **LecturePlanAgent** — Reminds about upcoming lectures
3. **AssignmentTrackerAgent** — Alerts on approaching deadlines
4. **FoodTrackingAgent** — Nudges for meal logging
5. **SocialHighlightsAgent** — Aggregates social media highlights
6. **VideoEditorAgent** — Generates daily video digests

**Agent Execution Model**:
- Each agent runs independently on its own interval
- Agents are stateless across runs (no persistent memory yet)
- Agents emit events via `ctx.emit(event)`
- Events include: `id`, `source`, `eventType`, `priority`, `timestamp`, `payload`

**Event Flow**:
```
Agent.run() → emit(event) → OrchestratorRuntime.handleEvent()
  → RuntimeStore.recordEvent() + pushNotification()
  → Available in next /api/dashboard response
```

## Data Flow Diagrams

### Startup Flow

```
1. npm run dev
   ├─ apps/server: tsx watch src/index.ts
   └─ apps/web: vite dev server

2. Express server starts
   ├─ Instantiate RuntimeStore
   ├─ Instantiate OrchestratorRuntime(store)
   └─ runtime.start()
        ├─ Emit boot notification
        └─ For each agent:
             ├─ Run immediately
             └─ Schedule setInterval(run, agent.intervalMs)

3. User opens http://localhost:5173
   ├─ React renders App.tsx
   ├─ useDashboard() polls /api/dashboard
   └─ Displays dashboard snapshot
```

### Agent Execution Flow

```
setInterval fires for Agent
   │
   ├─ store.markAgentRunning(name)
   │
   ├─ agent.run({ emit })
   │     │
   │     ├─ Agent logic executes (e.g., check deadlines)
   │     └─ emit(event) if conditions met
   │           │
   │           └─ OrchestratorRuntime.handleEvent(event)
   │                 │
   │                 ├─ store.recordEvent(event)
   │                 │     └─ Update agent state to "idle"
   │                 │
   │                 └─ Transform event → notification
   │                       └─ store.pushNotification(...)
   │
   └─ Catch errors → store.markAgentError(name)
```

### Dashboard Refresh Flow

```
User opens dashboard or clicks "Refresh"
   │
   ├─ useDashboard() → fetch('/api/dashboard')
   │
   ├─ Backend: store.getSnapshot()
   │     │
   │     ├─ Compute summary (focus, deadlines, compliance, digest)
   │     ├─ Collect agent states
   │     ├─ Collect notifications (newest 40)
   │     └─ Collect events (newest 100)
   │
   ├─ Return JSON: DashboardSnapshot
   │
   └─ Frontend: renders tiles, agent list, notification feed
```

### Context Update Flow

```
User adjusts context controls (stress, energy, mode)
   │
   ├─ POST /api/context with new values
   │
   ├─ Backend validates with Zod schema
   │
   ├─ store.setUserContext(newContext)
   │     └─ Merge with existing context
   │
   ├─ Return updated context
   │
   └─ Frontend: calls refresh() to update dashboard
```

## Technology Stack

### Frontend
- **React 18** — UI library
- **TypeScript 5** — Type safety
- **Vite 5** — Build tool and dev server
- **CSS** — Styling (no framework, custom CSS in `index.css`)

### Backend
- **Node.js 20+** — Runtime
- **Express 4** — Web framework
- **TypeScript 5** — Type safety
- **Zod 3** — Runtime schema validation
- **CORS** — Cross-origin support for dev
- **tsx** — TypeScript execution and watch mode

### Development
- **npm workspaces** — Monorepo management
- **concurrently** — Parallel dev server execution
- **ESLint** — Linting (configured per workspace)

## State Management

### Backend State (RuntimeStore)
- **Persistence**: None (in-memory only)
- **Lifecycle**: Lives for duration of server process
- **Reset**: On server restart, all state is lost
- **Capacity**: Circular buffers limit events (100) and notifications (40)

### Frontend State
- **Polling**: Dashboard polls `/api/dashboard` every 6 seconds automatically
- **Manual refresh**: User can click "Refresh" button for immediate update
- **No local cache**: Fresh data fetched on every poll
- **Context updates**: Optimistic UI not implemented; relies on immediate `/api/context` response + auto-refresh

### Future Persistence Options
- Add database (SQLite, PostgreSQL) for durable storage
- Implement event sourcing for audit trail
- Add Redis for shared state across server instances

## Deployment Model

### Development
```bash
npm install
npm run dev
```
- Server: `http://localhost:8787`
- Web: `http://localhost:5173`

### Production Build
```bash
npm run build
npm run start --workspace @axis/server
```
- Builds TypeScript to `dist/` in both workspaces
- Serve `apps/web/dist/` via static file server or CDN
- Run `apps/server/dist/index.js` with Node.js

### Environment Variables
See `.env.example` for configuration:
- `PORT` — Server port (default: 8787)
- Additional config in `apps/server/src/config.ts`

### Mobile Access
- Deploy to HTTPS URL
- Add to iPhone Home Screen via Safari "Add to Home Screen"
- Configure iPhone Shortcuts to launch AXIS URL

## Extensibility

### Adding a New Agent

1. Create `apps/server/src/agents/my-agent.ts`:
```typescript
import { BaseAgent, AgentContext } from "../agent-base.js";

export class MyAgent extends BaseAgent {
  readonly name = "my-agent";
  readonly intervalMs = 60_000; // 1 minute

  async run(ctx: AgentContext): Promise<void> {
    // Your logic here
    ctx.emit(this.event("my-agent.event", { data: "value" }, "medium"));
  }
}
```

2. Register in `apps/server/src/orchestrator.ts`:
```typescript
import { MyAgent } from "./agents/my-agent.js";

private readonly agents: BaseAgent[] = [
  // ...existing agents
  new MyAgent()
];
```

3. Add event type to `types.ts` and handle in `handleEvent()` method

4. Update `RuntimeStore` agent list if new agent name is introduced

### Adding a New API Endpoint

1. Add route in `apps/server/src/index.ts`:
```typescript
app.get("/api/my-endpoint", (req, res) => {
  res.json({ data: store.getSomeData() });
});
```

2. Document in `docs/contracts.md`

3. Consume in frontend via `useDashboard` or new hook

### Adding Persistent Storage

1. Add database client (e.g., `better-sqlite3`, `pg`)
2. Refactor `RuntimeStore` to read/write from DB
3. Implement migration system
4. Update agent event recording to persist events
5. Add `.env` configuration for DB connection

## Security Considerations

### Current State
- **No authentication** — App is personal, single-user
- **No authorization** — All endpoints are public
- **CORS enabled** — Allows any origin in dev mode
- **No input sanitization** — Beyond Zod validation on `/api/context`

### Recommended for Production
- Add authentication (e.g., API key, OAuth, session cookies)
- Restrict CORS to specific origin
- Add rate limiting
- Sanitize user inputs
- Use HTTPS only
- Implement CSP headers

## Performance Characteristics

### Backend
- **Agent intervals**: Range from 30s to 5 minutes depending on agent
- **Concurrent agents**: All agents run in parallel via setInterval
- **Memory usage**: Bounded by circular buffers (140 items max)
- **Bottlenecks**: None identified in current single-user scope

### Frontend
- **Polling interval**: 6 seconds automatic refresh
- **Bundle size**: Minimal (React + small app code)
- **Load time**: Sub-second on modern connection

## Testing Strategy

### Current State
- No automated tests implemented yet
- Manual verification via:
  - `npm run dev` and inspect dashboard
  - Check agent status transitions
  - Verify notifications appear

### Recommended Tests
- **Backend**: Unit tests for agents, RuntimeStore methods
- **Frontend**: Component tests with React Testing Library
- **Integration**: E2E tests with Playwright
- **API**: Contract tests to ensure `/api/*` matches `docs/contracts.md`

## Monitoring and Observability

### Current Capabilities
- Agent status visible in dashboard (idle, running, error)
- Last run timestamps for each agent
- Event feed shows agent activity
- Notification feed shows user-facing alerts

### Future Enhancements
- Structured logging with timestamps and levels
- Metrics collection (agent run duration, event counts)
- Error tracking (Sentry, Rollbar)
- Health check endpoint enhancement with detailed status

## Related Documentation

- [API Contracts](./contracts.md) — REST API request/response schemas
- [Development Environment](./dev-environment.md) — Setup and launch instructions
- [Project Brief](./project-brief.md) — Product vision and goals
- [Agent Coordination](./.agents/ORCHESTRATION.md) — Multi-agent workflow rules
- [Task Template](./task-template.md) — Issue format for agent assignments

## Verification

To verify this architecture documentation is accurate:

```bash
# Start the system
npm run dev

# Verify backend starts and agents initialize
curl http://localhost:8787/api/health
# Expected: {"status":"ok"}

curl http://localhost:8787/api/dashboard
# Expected: JSON with generatedAt, summary, agentStates, notifications, events

# Verify frontend loads
open http://localhost:5173
# Expected: Dashboard with agent status tiles and notification feed

# Verify type checking passes
npm run typecheck
# Expected: No errors
```
