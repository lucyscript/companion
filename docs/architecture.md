# Architecture Diagrams

Visual reference for Companion's system architecture using Mermaid diagrams.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph Client ["Frontend (React PWA)"]
        UI[Tab Views]
        API_CLIENT[API Client]
        SW[Service Worker]
        STORAGE[localStorage / IndexedDB]
    end

    subgraph Server ["Backend (Node.js + Express)"]
        ROUTES[Express Routes<br/>113 endpoints]
        AUTH[Auth Middleware<br/>Session-based]
        CHAT[Chat Pipeline<br/>Context + Gemini + Tools]
        ORCH[Orchestrator<br/>Background Jobs]
        STORE[RuntimeStore<br/>SQLite · 45 tables]
    end

    subgraph External ["External Services"]
        GEMINI[Google Gemini<br/>Vertex AI Live API]
        CANVAS[Canvas LMS]
        TP[TP EduCloud / TimeEdit]
        WITHINGS[Withings Health]
        STRIPE[Stripe / Vipps]
        PG[(PostgreSQL<br/>Snapshots)]
    end

    UI --> API_CLIENT
    API_CLIENT -->|HTTP/SSE| ROUTES
    SW -->|Push| API_CLIENT

    ROUTES --> AUTH
    AUTH --> CHAT
    AUTH --> STORE
    CHAT -->|WebSocket| GEMINI
    ORCH --> STORE
    STORE -->|Snapshot sync| PG

    ORCH -->|iCal sync| TP
    ORCH -->|API sync| CANVAS
    ORCH -->|OAuth sync| WITHINGS
    ROUTES -->|Billing| STRIPE
```

---

## Chat Request Flow

```mermaid
sequenceDiagram
    participant U as User (PWA)
    participant S as Server
    participant G as Gemini (Vertex AI)
    participant DB as SQLite Store

    U->>S: POST /api/chat/stream
    S->>DB: Load user context (schedule, deadlines, habits, nutrition, journal)
    S->>S: Assemble context window + system prompt
    S->>G: Open Live API WebSocket
    S->>G: Send messages + tool declarations + context

    loop Tool Calling Loop
        G-->>S: FunctionCall (e.g. createDeadline)
        S->>DB: Execute tool (write to DB)
        S->>G: FunctionResponse (result)
    end

    G-->>S: Final text response + mood
    S->>DB: Store chat message + metadata
    S-->>U: SSE stream (text chunks + citations + mood)
```

---

## Data Flow: Integrations

```mermaid
flowchart LR
    subgraph Sources ["External Data Sources"]
        CANVAS[Canvas LMS<br/>REST API]
        TP_ICAL[TP EduCloud<br/>iCal Feed]
        TE_ICAL[TimeEdit<br/>iCal Feed]
        BB[Blackboard<br/>REST API]
        TEAMS[MS Teams<br/>REST API]
        WH[Withings<br/>OAuth API]
    end

    subgraph Bridge ["Deadline / Event Bridges"]
        CB[Canvas Bridge<br/>Assignments → Deadlines]
        TB[TP Bridge<br/>Events → Lectures + Exam Deadlines]
        BBB[Blackboard Bridge<br/>Content → Deadlines]
        TMB[Teams Bridge<br/>Assignments → Deadlines]
    end

    subgraph Store ["SQLite Runtime"]
        EVENTS[(schedule_events)]
        DL[(deadlines)]
        WD[(withings_data)]
        CD[(canvas_data)]
    end

    CANVAS --> CB --> DL
    CANVAS --> CD
    TP_ICAL --> TB --> EVENTS
    TB --> DL
    TE_ICAL --> EVENTS
    BB --> BBB --> DL
    TEAMS --> TMB --> DL
    WH --> WD
```

---

## Database Persistence

```mermaid
flowchart LR
    subgraph Runtime ["Runtime (Hot Path)"]
        SQLITE[(SQLite<br/>companion.db)]
    end

    subgraph Durable ["Durable Storage"]
        PG[(PostgreSQL<br/>runtime_snapshots)]
    end

    SQLITE -->|"Serialize & upload<br/>every 30s"| PG
    PG -->|"Restore on startup"| SQLITE

    style SQLITE fill:#4a9eff,color:#fff
    style PG fill:#336791,color:#fff
```

---

## Authentication Flow

```mermaid
flowchart TD
    START[User opens app] --> CHECK{Auth required?}

    CHECK -->|No| READY[App ready]
    CHECK -->|Yes| LOGIN[Login screen]

    LOGIN --> LOCAL[Email + Password]
    LOGIN --> GOOGLE[Google OAuth]
    LOGIN --> GITHUB[GitHub OAuth]

    LOCAL --> SESSION[Create session token]
    GOOGLE -->|Redirect flow| SESSION
    GITHUB -->|Redirect flow| SESSION

    SESSION --> CONSENT{TOS accepted?}
    CONSENT -->|No| GATE[Consent Gate]
    CONSENT -->|Yes| READY

    GATE -->|Accept| READY
```

---

## Plan Tier Gating

```mermaid
flowchart TD
    REQ[API Request] --> AUTH[Auth Middleware]
    AUTH --> PLAN{Check user plan}

    PLAN -->|Free| FREE[16 tools<br/>10 msgs/day<br/>Basic connectors]
    PLAN -->|Plus| PLUS[38 tools<br/>75 msgs/day<br/>+ Nutrition, MCP, Teams]
    PLAN -->|Pro| PRO[46+ tools<br/>Unlimited<br/>All features]

    FREE --> GATE{Feature gated?}
    PLUS --> GATE
    PRO --> EXEC[Execute]

    GATE -->|Allowed| EXEC
    GATE -->|Blocked| UPGRADE[UpgradePrompt overlay]
```

---

## Frontend Component Tree

```mermaid
graph TD
    APP[App.tsx]
    APP --> CONSENT_GATE[ConsentGate]
    APP --> LOGIN[LoginView]
    APP --> ONBOARD[OnboardingFlow]
    APP --> TABS[TabBar]

    TABS --> CHAT_TAB[ChatTab]
    TABS --> SCHED_TAB[ScheduleTab]
    TABS --> NUTR_TAB[NutritionView]
    TABS --> HABITS_TAB[HabitsGoalsView]
    TABS --> SETTINGS[SettingsView]

    CHAT_TAB --> CHAT_VIEW[ChatView]
    CHAT_TAB --> CHAT_FAB[ChatFab]

    SCHED_TAB --> SCHED_VIEW[ScheduleView]
    SCHED_TAB --> DEADLINE_LIST[DeadlineList]
    SCHED_TAB --> STUDY_PLAN[StudyPlanView]
    SCHED_TAB --> CAL_IMPORT[CalendarImportView]

    SETTINGS --> CONNECTORS[ConnectorsView]
    SETTINGS --> NOTIF_SETTINGS[NotificationSettings]
    SETTINGS --> INTEGRATION_STATUS[IntegrationStatusView]

    APP --> OVERLAY_CHAT[ChatView Overlay<br/>createPortal]
    APP --> INSTALL_PROMPT[InstallPrompt]
    APP --> UPGRADE_MODAL[UpgradePrompt]

    style APP fill:#4a9eff,color:#fff
    style CHAT_TAB fill:#7dd3a8,color:#000
    style SCHED_TAB fill:#64a0f0,color:#fff
    style NUTR_TAB fill:#f6c37f,color:#000
    style HABITS_TAB fill:#81c784,color:#000
    style SETTINGS fill:#b48cdc,color:#fff
```

---

## Background Service Lifecycle

```mermaid
flowchart TD
    START[Server startup] --> INIT_STORE[Initialize RuntimeStore]
    INIT_STORE --> RESTORE{PostgreSQL snapshot?}

    RESTORE -->|Yes| LOAD[Restore SQLite from snapshot]
    RESTORE -->|No| FRESH[Fresh SQLite DB]

    LOAD --> BOOT
    FRESH --> BOOT

    BOOT[Bootstrap services] --> GLOBAL_SVCS[Global services]
    BOOT --> USER_SCAN[Scan users every 60s]

    GLOBAL_SVCS --> ORCH[OrchestratorRuntime<br/>Reminders · Digests · Triggers]
    GLOBAL_SVCS --> SYNC[BackgroundSyncService<br/>Offline queue]
    GLOBAL_SVCS --> PG_SNAP[PostgresSnapshotStore<br/>Auto-sync every 30s]

    USER_SCAN --> PER_USER[Per-user services]
    PER_USER --> EMAIL[EmailDigestService]
    PER_USER --> TP[TPSyncService]
    PER_USER --> TE[TimeEditSyncService]
    PER_USER --> GATED{Plan allows?}

    GATED -->|Yes + Connected| BB[BlackboardSyncService]
    GATED -->|Yes + Connected| TM[TeamsSyncService]
```
