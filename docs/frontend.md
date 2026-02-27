# Frontend Guide

The frontend is a **React 18 + TypeScript PWA** built with Vite. Located in `apps/web/src/`.

---

## Tab Structure

The app uses a bottom tab bar with 5 primary views:

| Tab | Component | Feature Gate | Description |
|-----|-----------|-------------|-------------|
| **Chat** | `ChatTab` → `ChatView` | `chat` | AI conversation with Gemini — primary interface |
| **Schedule** | `ScheduleTab` | `schedule` | Calendar, deadlines, study planner |
| **Food** | `NutritionView` | `nutrition` | Meal tracking, macros, targets (Plus+) |
| **Growth** | `HabitsGoalsView` | `habits` | Habits, goals, streaks, analytics (Pro) |
| **Settings** | `SettingsView` | always | Connectors, notifications, theme, account |

Tabs gated behind a higher plan tier show an `UpgradePrompt` overlay.

---

## Component Inventory (34 Components)

### Core Navigation
- **`App.tsx`** — Root component. Auth flow, tab routing, mood theming, deep links
- **`TabBar.tsx`** — Bottom navigation bar with animated icons
- **`InstallPrompt.tsx`** — PWA install banner for mobile browsers
- **`ConsentGate.tsx`** — GDPR consent screen (TOS + privacy)
- **`LoginView.tsx`** — Login form (local, Google OAuth, GitHub OAuth)
- **`OnboardingFlow.tsx`** — First-run setup wizard

### Chat
- **`ChatTab.tsx`** — Chat container with floating action button
- **`ChatView.tsx`** — Message list, input, streaming, citations, pending actions
- **`ChatFab.tsx`** — Floating chat button (opens overlay from non-chat tabs)
- **`FloatingQuickCapture.tsx`** — Quick thought capture widget

### Schedule & Deadlines
- **`ScheduleTab.tsx`** — Schedule container with sub-views
- **`ScheduleView.tsx`** — Calendar/timeline view of events
- **`DeadlineList.tsx`** — Deadline cards with status, priority, effort
- **`StudyPlanView.tsx`** — Generated study plan with session check-ins
- **`CalendarImportView.tsx`** — ICS file import UI
- **`RemindersWidget.tsx`** — Upcoming reminders display
- **`FocusTimer.tsx`** — Pomodoro-style focus timer

### Nutrition
- **`NutritionView.tsx`** — Meal tracker with daily summary
- **`NutritionTrackingChart.tsx`** — Chart.js macro/calorie charts

### Growth
- **`HabitsGoalsView.tsx`** — Habits + Goals display with check-in buttons
- **`AnalyticsDashboard.tsx`** — Charts, insights, challenge prompts, daily summary
- **`AnimatedIcons.tsx`** — Rich SVG animations (flame streaks, trophy completion)

### Settings & Integration
- **`SettingsView.tsx`** — Theme, language, account, data management
- **`ConnectorsView.tsx`** — Connect/disconnect external services
- **`IntegrationStatusView.tsx`** — Health status of all integrations
- **`IntegrationScopeSettings.tsx`** — Date window configuration for syncs
- **`NotificationSettings.tsx`** — Push preferences, quiet hours, digest timing
- **`NotificationFeed.tsx`** — Notification history list
- **`NotificationHistoryView.tsx`** — Full notification history with metrics

### Shared
- **`Icons.tsx`** — 56 animated SVG icons with CSS keyframe animations
- **`UpgradePrompt.tsx`** — Plan upgrade modal + locked feature overlay
- **`AgentStatusList.tsx`** — Background agent status indicators
- **`PullToRefreshIndicator.tsx`** — Pull-to-refresh spinner
- **`SwipeableListItem.tsx`** — Swipe-to-act list item wrapper
- **`SyncStatusBadge.tsx`** — Integration sync health indicator

---

## Hooks

| Hook | Purpose |
|------|---------|
| `useDashboard` | Fetches `/api/dashboard` with polling, returns `{ data, loading, error }` |
| `usePlan` | Fetches `/api/plan`, provides `planHasFeature()` and `planAllowsConnector()` |
| `usePullToRefresh` | Touch gesture handler for pull-to-refresh on mobile |
| `useSwipeAction` | Horizontal swipe gesture for list items (delete, complete, etc.) |

---

## Libraries (`apps/web/src/lib/`)

| Module | Purpose |
|--------|---------|
| `api.ts` | HTTP client — 100+ endpoint wrappers with auth headers, offline queuing |
| `config.ts` | API base URL resolution |
| `deepLink.ts` | Parse `?tab=&deadline=&section=` URL parameters |
| `haptics.ts` | Vibration API wrappers for tactile feedback |
| `i18n.tsx` | Internationalization (Norwegian bokmål + English) |
| `install.ts` | PWA install prompt handler |
| `push.ts` | Web Push subscription management (VAPID) |
| `storage.ts` | `localStorage` helpers (auth token, theme, settings, offline cache) |
| `sync.ts` | Offline sync queue + background sync listeners |
| `theme.ts` | Theme application (4 themes: dark, ocean-gold, emerald-dusk, sunset-indigo) |

---

## Theming

4 built-in themes, all dark-mode:

| Theme | Palette |
|-------|---------|
| **Dark** (default) | Neutral grays, blue accents |
| **Ocean Gold** | Deep navy, gold highlights |
| **Emerald Dusk** | Dark green, soft mint accents |
| **Sunset Indigo** | Deep purple, warm orange/pink accents |

Themes are applied via CSS custom properties on `:root`. The `applyTheme()` function in `lib/theme.ts` sets all `--color-*` variables.

### Chat Mood Backgrounds

Gemini can set a response mood that tints the chat background:

| Mood | Visual |
|------|--------|
| `neutral` | Default surface |
| `encouraging` | Soft green gradient |
| `focused` | Soft blue gradient |
| `celebratory` | Warm gold-green gradient |
| `empathetic` | Soft purple gradient |
| `urgent` | Soft red gradient |

---

## Icon System

All 56 icons live in `components/Icons.tsx` as inline SVG functions. Each icon has:

- A CSS class (`icon-sparkles`, `icon-bell`, etc.) for animation targeting
- Shared `.icon-svg` entrance animation (scale 0.6 → 1 + fade in)
- Unique idle animation matching its meaning (bell swings, heart beats, gear spins, etc.)
- All animations respect `prefers-reduced-motion: reduce`

Two special icons in `AnimatedIcons.tsx`:
- **`AnimatedFlame`** — Multi-layer fire with gradient, glow, and flicker animation
- **`AnimatedTrophy`** — Gold trophy with star emblem, shimmer sweep, and bounce

---

## Offline Support

The frontend handles offline/unreachable server gracefully:

1. **Sync Queue** — Mutations are queued in `localStorage` when offline
2. **Background Sync** — `sync.ts` listens for connectivity changes and processes queue
3. **Cached Data** — Dashboard, settings, and preferences are cached in `localStorage`
4. **Optimistic UI** — Some mutations update local state immediately before server confirmation

---

## Build & Dev

```bash
# Development
cd apps/web
npm run dev          # Vite dev server on :5173, proxies /api → localhost:8787

# Production build
npm run build        # Output: apps/web/dist/
npm run preview      # Preview production build locally

# Type check
npx tsc --noEmit
```

Vite config sets `base: "/companion/"` for GitHub Pages deployment.
