# API Reference

All endpoints served by the Express backend at `apps/server/src/index.ts`. Base URL: `http://localhost:8787` (dev) or your Railway deployment URL.

**Auth**: Unless marked "Public", all endpoints require `Authorization: Bearer <session-token>` header.

---

## Health & System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | Public | Health check + storage diagnostics |
| `GET` | `/api/dashboard` | Yes | Full user state snapshot (summary, agents, notifications, events) |
| `GET` | `/api/export` | Yes | Export all user data as JSON download |
| `POST` | `/api/import` | Yes | Import schedule/deadlines/habits/goals/context |

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/status` | Public | Auth config: required?, providers enabled |
| `POST` | `/api/auth/login` | Public | Email/password login → session token |
| `GET` | `/api/auth/me` | Yes | Current user profile |
| `POST` | `/api/auth/logout` | Yes | Revoke session |
| `GET` | `/api/auth/google` | Public | Initiate Google OAuth redirect |
| `GET` | `/api/auth/google/callback` | Public | Google OAuth callback |
| `GET` | `/api/auth/github` | Public | Initiate GitHub OAuth redirect |
| `GET` | `/api/auth/github/callback` | Public | GitHub OAuth callback |
| `GET` | `/api/auth/withings` | Yes | Initiate Withings OAuth redirect |
| `GET` | `/api/auth/withings/callback` | Public | Withings OAuth callback |

---

## Consent / GDPR

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/consent/status` | Yes | Check if TOS/privacy acceptance needed |
| `POST` | `/api/consent/accept` | Yes | Accept TOS + privacy policy versions |
| `DELETE` | `/api/user/data` | Yes | Delete all user data (GDPR right to erasure) |

---

## Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat` | Yes | Send message, get AI reply (non-streaming) |
| `POST` | `/api/chat/stream` | Yes | Send message, get AI reply via SSE stream |
| `POST` | `/api/chat/context/compress` | Yes | Compress chat history into long-term memory |
| `GET` | `/api/chat/history` | Yes | Paginated chat history (`?page=&pageSize=`) |
| `GET` | `/api/chat/actions/pending` | Yes | List pending actions awaiting confirmation |
| `POST` | `/api/chat/actions/:id/confirm` | Yes | Confirm and execute a pending action |
| `POST` | `/api/chat/actions/:id/cancel` | Yes | Cancel a pending action |

---

## Schedule

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/schedule` | Yes | Create a schedule event |
| `GET` | `/api/schedule` | Yes | List all events (auto-syncs Canvas if stale) |
| `GET` | `/api/schedule/suggestion-mutes` | Yes | Get muted suggestion windows |
| `GET` | `/api/schedule/:id` | Yes | Get specific event |
| `PATCH` | `/api/schedule/:id` | Yes | Update event |
| `DELETE` | `/api/schedule/:id` | Yes | Delete event |

---

## Deadlines

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/deadlines` | Yes | Create a deadline |
| `GET` | `/api/deadlines` | Yes | List all deadlines (auto-syncs Canvas if stale) |
| `GET` | `/api/deadlines/duplicates` | Yes | Find duplicate deadlines |
| `GET` | `/api/deadlines/suggestions` | Yes | AI deadline priority suggestions |
| `GET` | `/api/deadlines/:id` | Yes | Get specific deadline |
| `PATCH` | `/api/deadlines/:id` | Yes | Update deadline |
| `POST` | `/api/deadlines/:id/confirm-status` | Yes | Confirm/toggle completion status |
| `DELETE` | `/api/deadlines/:id` | Yes | Delete deadline |

---

## Study Planner

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/study-plan/generate` | Yes | Generate weekly study plan from deadlines + schedule |
| `GET` | `/api/study-plan/sessions` | Yes | List study sessions (filterable) |
| `POST` | `/api/study-plan/sessions/:id/check-in` | Yes | Check in on a session (done/skipped + notes) |
| `GET` | `/api/study-plan/adherence` | Yes | Study plan adherence metrics |
| `GET` | `/api/study-plan/export` | Yes | Export as ICS calendar file |

---

## Habits

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/habits` | Yes | List habits with status (streak, completion rate) |
| `POST` | `/api/habits` | Yes | Create a habit |
| `POST` | `/api/habits/:id/check-ins` | Yes | Toggle habit check-in |
| `PATCH` | `/api/habits/:id` | Yes | Update habit |
| `DELETE` | `/api/habits/:id` | Yes | Delete habit |

---

## Goals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/goals` | Yes | List goals with status (streak, progress) |
| `POST` | `/api/goals` | Yes | Create a goal |
| `POST` | `/api/goals/:id/check-ins` | Yes | Toggle goal check-in |
| `PATCH` | `/api/goals/:id` | Yes | Update goal |
| `DELETE` | `/api/goals/:id` | Yes | Delete goal |

---

## Nutrition

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/nutrition/summary` | Yes | Daily summary (calories, macros, targets) — `?date=YYYY-MM-DD` |
| `GET` | `/api/nutrition/history` | Yes | Multi-day history |
| `GET` | `/api/nutrition/custom-foods` | Yes | Custom food library |
| `POST` | `/api/nutrition/custom-foods` | Yes | Create custom food |
| `PATCH` | `/api/nutrition/custom-foods/:id` | Yes | Update custom food |
| `DELETE` | `/api/nutrition/custom-foods/:id` | Yes | Delete custom food |
| `GET` | `/api/nutrition/targets` | Yes | Get target profile |
| `PUT` | `/api/nutrition/targets` | Yes | Update target profile |
| `GET` | `/api/nutrition/meals` | Yes | List meals (filterable by date) |
| `POST` | `/api/nutrition/meals` | Yes | Log a meal |
| `PATCH` | `/api/nutrition/meals/:id` | Yes | Update meal |
| `DELETE` | `/api/nutrition/meals/:id` | Yes | Delete meal |
| `GET` | `/api/nutrition/plan-settings` | Yes | Meal plan settings |
| `PUT` | `/api/nutrition/plan-settings` | Yes | Update plan settings |
| `GET` | `/api/nutrition/plan-snapshots` | Yes | List saved meal plans |
| `POST` | `/api/nutrition/plan-snapshots` | Yes | Save current meals as snapshot |
| `POST` | `/api/nutrition/plan-snapshots/:id/apply` | Yes | Apply saved plan to a date |
| `DELETE` | `/api/nutrition/plan-snapshots/:id` | Yes | Delete saved plan |

---

## Analytics & Growth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/weekly-review` | Yes | Weekly summary (deadlines, habits, schedule) |
| `GET` | `/api/weekly-growth-review` | Yes | AI weekly growth review + optional Sunday push |
| `GET` | `/api/trends` | Yes | User context trends (stress, energy, mode) |
| `GET` | `/api/analytics/coach` | Yes | AI coach insight (7/14/30-day, cached) |
| `GET` | `/api/growth/daily-summary` | Yes | AI daily coaching summary |

---

## User Context

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/context` | Yes | Update context (stressLevel, energyLevel, mode) |

---

## Locations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/locations` | Yes | Record GPS location |
| `GET` | `/api/locations` | Yes | List locations |
| `GET` | `/api/locations/current` | Yes | Most recent location |
| `GET` | `/api/locations/:id` | Yes | Get specific |
| `PATCH` | `/api/locations/:id` | Yes | Update |
| `DELETE` | `/api/locations/:id` | Yes | Delete |
| `POST` | `/api/locations/:id/history` | Yes | Record context at location |
| `GET` | `/api/locations/:id/history` | Yes | History for location |
| `GET` | `/api/location-history` | Yes | All location history |

---

## Tags

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/tags` | Yes | List tags |
| `POST` | `/api/tags` | Yes | Create tag |
| `PATCH` | `/api/tags/:id` | Yes | Rename tag |
| `DELETE` | `/api/tags/:id` | Yes | Delete tag |

---

## Calendar Import

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/calendar/import` | Yes | Import ICS data (creates lectures + deadlines) |
| `POST` | `/api/calendar/import/preview` | Yes | Preview ICS import without persisting |

---

## Connectors

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/connectors` | Yes | List connected services (no credentials) |
| `POST` | `/api/connectors/:service/connect` | Yes | Connect a service |
| `DELETE` | `/api/connectors/:service` | Yes | Disconnect service + clear data |

Services: `canvas`, `tp_schedule`, `timeedit`, `blackboard`, `teams`, `withings`, `mcp`

---

## MCP (Model Context Protocol)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/mcp/servers` | Yes | List user's MCP servers |
| `GET` | `/api/mcp/catalog` | Yes | Available MCP server templates |
| `POST` | `/api/mcp/templates/:templateId/connect` | Yes | Connect MCP template |
| `DELETE` | `/api/mcp/servers/:serverId` | Yes | Remove MCP server |

---

## Plans & Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/plan/tiers` | Public | All plan tiers |
| `GET` | `/api/plan` | Yes | Current user plan + usage |
| `POST` | `/api/plan/start-trial` | Yes | Start free trial |

---

## Stripe

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/stripe/webhook` | Public | Webhook (signature verified) |
| `POST` | `/api/stripe/create-checkout` | Yes | Create checkout session |
| `POST` | `/api/stripe/portal` | Yes | Customer portal session |
| `GET` | `/api/stripe/status` | Yes | Stripe config status |

---

## Vipps MobilePay

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/vipps/create-agreement` | Yes | Create recurring agreement |
| `GET` | `/api/vipps/agreement-status` | Yes | Poll agreement status |
| `POST` | `/api/vipps/cancel-agreement` | Yes | Cancel agreement → free |
| `GET` | `/api/vipps/status` | Yes | Vipps config status |
| `POST` | `/api/vipps/webhook` | Public | Agreement/charge events |

---

## Push Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/push/vapid-public-key` | Yes | VAPID public key |
| `GET` | `/api/push/delivery-metrics` | Yes | Delivery success/failure metrics |
| `POST` | `/api/push/subscribe` | Yes | Register push subscription |
| `POST` | `/api/push/unsubscribe` | Yes | Remove subscription |
| `POST` | `/api/push/test` | Yes | Send test notification |

---

## Notification Preferences & Interactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/notification-preferences` | Yes | Get preferences (quiet hours, etc.) |
| `PUT` | `/api/notification-preferences` | Yes | Update preferences |
| `POST` | `/api/notification-interactions` | Yes | Record interaction |
| `GET` | `/api/notification-interactions` | Yes | Interaction history |
| `GET` | `/api/notification-interactions/metrics` | Yes | Interaction metrics |
| `POST` | `/api/notifications/snooze` | Yes | Snooze notification |
| `GET` | `/api/scheduled-notifications` | Yes | Upcoming scheduled notifications |
| `DELETE` | `/api/scheduled-notifications/:id` | Yes | Cancel scheduled notification |

---

## Background Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sync/queue` | Yes | Enqueue offline sync operation |
| `POST` | `/api/sync/process` | Yes | Trigger queue processing |
| `GET` | `/api/sync/queue-status` | Yes | Queue status |
| `GET` | `/api/sync/status` | Yes | Full integration sync status |
| `DELETE` | `/api/sync/cleanup` | Yes | Clean up completed items > 7 days |

---

## Integration Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sync/tp` | Yes | Trigger TP EduCloud sync |
| `GET` | `/api/tp/status` | Yes | TP sync status |
| `GET` | `/api/canvas/status` | Yes | Canvas sync status |
| `POST` | `/api/canvas/sync` | Yes | Trigger Canvas sync |
| `GET` | `/api/gemini/status` | Yes | Gemini config & model status |
| `GET` | `/api/withings/status` | Yes | Withings connection status |
| `POST` | `/api/withings/sync` | Yes | Trigger Withings sync |
| `GET` | `/api/withings/summary` | Yes | Weight + sleep summary |

---

## Integration Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/integrations/scope/preview` | Yes | Preview date-window scope |
| `GET` | `/api/integrations/recovery-prompts` | Yes | Active failure recovery prompts |
| `GET` | `/api/integrations/health-log` | Yes | Sync attempt log (filterable) |
| `GET` | `/api/integrations/health-log/summary` | Yes | Aggregated health summary |

---

**Total: 113 endpoints** across 20 domain groups.
