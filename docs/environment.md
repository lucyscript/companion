# Environment Variables

All server environment variables. Defined in `apps/server/src/config.ts` with Zod validation.

---

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | HTTP server port |
| `NODE_ENV` | — | Node.js environment (`production` / `development`) |

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_DB_PATH` | `companion.db` | SQLite runtime database file path |
| `DATABASE_URL` | — | PostgreSQL connection string for snapshot persistence |
| `POSTGRES_SNAPSHOT_SYNC_MS` | `30000` | SQLite→PostgreSQL sync interval (ms) |

## User

| Variable | Default | Description |
|----------|---------|-------------|
| `TIMEZONE` | `Europe/Oslo` | User timezone (IANA format) |
| `USER_NAME` | `friend` | Display name for personalization |

## AI / Gemini

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | — | API key (used for non-Vertex SDK-based calls) |
| `GEMINI_USE_LIVE_API` | `true` | Use Vertex AI Live API (WebSocket) for chat |
| `GEMINI_LIVE_MODEL` | `gemini-3-flash-preview` | Vertex model for chat + tool calling |
| `GEMINI_THINKING_LEVEL` | `MEDIUM` | Thinking budget: `MINIMAL` / `LOW` / `MEDIUM` / `HIGH` |
| `GEMINI_GROWTH_IMAGE_MODEL` | `nano-banana-pro` | Model alias for growth visual generation |
| `GEMINI_LIVE_ENDPOINT` | — | Override Vertex Live WebSocket endpoint |
| `GEMINI_VERTEX_PROJECT_ID` | — | GCP project ID (alias: `GCP_PROJECT_ID`) |
| `GEMINI_VERTEX_LOCATION` | `global` | Vertex region (alias: `GCP_LOCATION`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Raw JSON credentials (alias: `GOOGLE_APPLICATION_CREDENTIALS_JSON`) |
| `GEMINI_LIVE_TIMEOUT_MS` | `60000` | Live socket read timeout (ms) |
| `GROWTH_DAILY_SUMMARY_MIN_REFRESH_MINUTES` | `180` | Min interval for daily summary regeneration |
| `GROWTH_ANALYTICS_MIN_REFRESH_MINUTES` | `480` | Min interval for analytics coach regeneration |

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_REQUIRED` | `true` (prod) / `false` (dev) | Require login for `/api/*` routes |
| `AUTH_ADMIN_EMAIL` | — | Admin login email |
| `AUTH_ADMIN_PASSWORD` | — | Admin login password (min 8 chars) |
| `AUTH_SESSION_TTL_HOURS` | `720` | Session expiration (30 days) |
| `PRO_WHITELIST_EMAILS` | — | Comma-separated emails that get Pro access |

## OAuth

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Google OAuth client secret |
| `GITHUB_OAUTH_CLIENT_ID` | — | GitHub OAuth client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | GitHub OAuth client secret |
| `OAUTH_REDIRECT_BASE_URL` | — | Base URL for OAuth redirects (production) |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for post-auth redirects |

## Push Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `VAPID_PUBLIC_KEY` | — | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | — | VAPID private key |
| `VAPID_SUBJECT` | `mailto:companion@example.com` | VAPID subject |

Generate keys: `npx web-push generate-vapid-keys`

## Integrations

| Variable | Default | Description |
|----------|---------|-------------|
| `CONNECTOR_CREDENTIALS_SECRET` | `dev-only-…` | Encryption key for connector credentials at rest |
| `CANVAS_API_TOKEN` | — | Canvas personal access token (global fallback) |
| `CANVAS_BASE_URL` | `https://stavanger.instructure.com` | Canvas instance URL fallback |
| `TP_EDUCLOUD_BASE_URL` | `https://tp.educloud.no/timeplan/ical.php` | TP iCal endpoint fallback |
| `INTEGRATION_WINDOW_PAST_DAYS` | `7` | Keep synced items this many days in the past |
| `INTEGRATION_WINDOW_FUTURE_DAYS` | `180` | Keep synced items this many days in the future |

## Withings

| Variable | Default | Description |
|----------|---------|-------------|
| `WITHINGS_API_ENDPOINT` | `https://wbsapi.withings.net` | Withings API base URL |
| `WITHINGS_CLIENT_ID` | — | OAuth client ID |
| `WITHINGS_API_SECRET` | — | OAuth client secret |
| `WITHINGS_CALLBACK_URL` | `http://localhost:8787/api/auth/withings/callback` | OAuth redirect |
| `WITHINGS_SCOPE` | `user.metrics,user.activity` | OAuth scopes |
| `WITHINGS_ACCESS_TOKEN` | — | Bootstrap token (optional) |
| `WITHINGS_REFRESH_TOKEN` | — | Bootstrap refresh token (optional) |

## Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATION_DIGEST_MORNING_HOUR` | `8` | Morning digest hour (0-23) |
| `NOTIFICATION_DIGEST_EVENING_HOUR` | `18` | Evening digest hour (0-23) |

## Feature Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTES_PROVIDER` | `local` | Journal provider |
| `ASSIGNMENT_PROVIDER` | `manual` | Assignment provider |
| `FOOD_PROVIDER` | `manual` | Food tracking provider |
