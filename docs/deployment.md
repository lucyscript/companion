# Deployment

Companion runs as a split deployment: static frontend on GitHub Pages, backend on Railway.

---

## Architecture

```
┌─────────────────┐         ┌───────────────────┐
│  GitHub Pages   │  /api   │    Railway         │
│  (Static PWA)   │ ──────► │  (Node.js Server)  │
│  apps/web/dist  │         │  apps/server       │
└─────────────────┘         │                    │
                            │  ┌──────────┐      │
                            │  │ SQLite    │      │
                            │  │ runtime   │      │
                            │  └────┬─────┘      │
                            │       │ snapshot    │
                            │  ┌────▼─────┐      │
                            │  │PostgreSQL│      │
                            │  │ (Railway)│      │
                            │  └──────────┘      │
                            └───────────────────┘
```

---

## Frontend (GitHub Pages)

The frontend auto-deploys via GitHub Actions when changes to `apps/web/` merge to `main`.

### Configuration

- **Base path**: `/companion/` (set in `vite.config.ts`)
- **Build output**: `apps/web/dist/`
- **Workflow**: `.github/workflows/deploy.yml`

### Local development

```bash
cd apps/web
npm run dev        # Vite dev server on :5173
                   # Proxies /api/* → localhost:8787
```

### Manual build

```bash
cd apps/web
npm run build
npm run preview    # Preview at localhost:4173
```

---

## Backend (Railway)

The server runs on Railway with a Dockerfile.

### Key files

| File | Purpose |
|------|---------|
| `apps/server/Dockerfile` | Multi-stage build (Node 20 → distroless) |
| `apps/server/railway.toml` | Railway build + deploy config |
| `apps/server/ENV.md` | Full env var reference |

### Railway setup

1. Create a new Railway project
2. Add a **PostgreSQL** database (for snapshot persistence)
3. Connect the repo, set root directory to `apps/server`
4. Set environment variables (see [environment.md](environment.md))
5. Railway auto-detects the Dockerfile and deploys

### Required env vars for production

```bash
# Minimum viable production config
PORT=8787
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}   # Railway PostgreSQL reference

TIMEZONE=Europe/Oslo
USER_NAME=Lucy

AUTH_REQUIRED=true
AUTH_ADMIN_EMAIL=your@email.com
AUTH_ADMIN_PASSWORD=<strong-password>

GEMINI_VERTEX_PROJECT_ID=your-gcp-project
GOOGLE_SERVICE_ACCOUNT_JSON='{ ... }'

VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_SUBJECT=mailto:your@email.com

CONNECTOR_CREDENTIALS_SECRET=<random-32-chars>
FRONTEND_URL=https://invaron.github.io/companion
OAUTH_REDIRECT_BASE_URL=https://your-railway-domain.up.railway.app
```

### Health check

```bash
curl https://your-railway-domain.up.railway.app/api/health
# → {"status":"ok","storage":{...}}
```

---

## Database Strategy

- **Runtime**: SQLite file (`companion.db`) — all reads/writes
- **Durability**: PostgreSQL stores periodic snapshots (every 30s by default)
- **Startup**: Latest snapshot is restored from PostgreSQL to SQLite
- **No migrations**: Schema is created in-code (`RuntimeStore` constructor)

This means Railway's ephemeral filesystem is fine — data survives redeploys via PostgreSQL snapshots.

---

## Testing

```bash
cd apps/server
npx vitest run           # Run all 488+ tests
npx tsc --noEmit         # Type check

cd apps/web
npx tsc --noEmit         # Type check frontend
```

---

## Domain & CORS

The server sets CORS to allow the frontend origin. In production, ensure `FRONTEND_URL` matches your GitHub Pages URL (e.g., `https://invaron.github.io/companion`).

For OAuth flows, `OAUTH_REDIRECT_BASE_URL` must be set to the Railway server URL so callbacks resolve correctly.
