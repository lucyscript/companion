# Companion

Personal AI companion for university students — a mobile-first PWA powered by Google Gemini with deep schedule, nutrition, and LMS integration.

## What It Does

- **Chat-first UX** — Talk to Gemini about your day; it manages your schedule, deadlines, meals, habits, and goals
- **LMS Integration** — Canvas, Blackboard, TP EduCloud, TimeEdit sync your courses automatically
- **Nutrition Tracking** — Log meals, set macro targets, save meal plans
- **Growth System** — Habits, goals, streaks with AI coaching insights
- **Health Data** — Withings weight/sleep integration for context-aware advice
- **Extensible** — MCP servers, Microsoft Teams, custom tool connectors

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · Vite 5 · TypeScript · PWA |
| Backend | Node.js · Express · SQLite · PostgreSQL (snapshots) |
| AI | Gemini 3 Flash (Vertex AI Live API) · 46+ tools |
| Payments | Stripe · Vipps MobilePay |
| Deploy | GitHub Pages (frontend) · Railway (backend) |

## Quick Start

```bash
# Backend
cd apps/server
cp ../../.env.example .env       # Edit with your keys
npm install && npm run dev       # Starts on :8787

# Frontend
cd apps/web
npm install && npm run dev       # Starts on :5173, proxies /api → :8787
```

## Documentation

See [`docs/`](docs/README.md) for full documentation:

- [System Overview](docs/system-overview.md) — Architecture, data model, core concepts
- [API Reference](docs/api-reference.md) — All 113 endpoints
- [Architecture Diagrams](docs/architecture.md) — Mermaid visual reference
- [Frontend Guide](docs/frontend.md) — Components, hooks, theming
- [Environment Variables](docs/environment.md) — Every env var
- [Deployment](docs/deployment.md) — Railway + GitHub Pages

## Project Structure

```
apps/
  server/    → Node.js Express API + background services
  web/       → React PWA (mobile-first)
docs/        → Current documentation
  legacy/    → Agent-era docs (preserved for reference)
.github/     → CI/CD workflows + copilot instructions
.agents/     → Legacy agent coordination configs
```

## Testing

```bash
cd apps/server
npx vitest run          # 488+ tests
npx tsc --noEmit        # Type check

cd apps/web
npx tsc --noEmit        # Type check
```

## Origin

This project was originally built through a **recursive self-improvement agent workflow** — AI coding agents autonomously created issues, PRs, and merged code. The legacy orchestration docs are preserved in [`docs/legacy/`](docs/legacy/README.md) for reuse in future projects.
