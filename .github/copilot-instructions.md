# Copilot Instructions

## Product Context

Companion is a **personal AI companion for university students**. It's a mobile-first PWA with a chat-first UX powered by Google Gemini (Vertex AI). The chat interface is the primary control surface — Gemini has tool access to manage schedules, deadlines, nutrition, habits, goals, and external integrations.

**Full documentation**: [`docs/`](../docs/README.md)

## Quick Reference

| Doc | What's in it |
|-----|-------------|
| [`docs/system-overview.md`](../docs/system-overview.md) | Architecture, tech stack, core concepts |
| [`docs/api-reference.md`](../docs/api-reference.md) | All 113 HTTP endpoints |
| [`docs/architecture.md`](../docs/architecture.md) | Mermaid diagrams (request flow, data model, deployment) |
| [`docs/frontend.md`](../docs/frontend.md) | React components, hooks, theming |
| [`docs/environment.md`](../docs/environment.md) | All environment variables |
| [`docs/deployment.md`](../docs/deployment.md) | Railway + GitHub Pages setup |

## Codebase Conventions

- **Server**: `apps/server/src/` — TypeScript, Node.js, Express, SQLite
- **Web**: `apps/web/src/` — React 18 + Vite 5 PWA, mobile-first
- **Tests**: `npx vitest run` in `apps/server/` — all tests must pass (488+)
- **Types**: `npx tsc --noEmit` in both `apps/server/` and `apps/web/` — zero errors
- **GitHub Pages**: Deploys automatically when `apps/web/` changes merge to `main`

## Key Architecture Facts

- **AI**: Gemini 3 Flash (Vertex Live API, WebSocket) with 46+ tools, MEDIUM thinking level
- **Database**: SQLite runtime → PostgreSQL snapshot persistence (every 30s)
- **Auth**: Session-based (local + Google OAuth + GitHub OAuth), multi-tenant
- **Plans**: Free / Plus (49 NOK) / Pro (99 NOK) — features, tools, and connectors are tier-gated
- **Integrations**: Canvas LMS, Blackboard, Teams, TP EduCloud, TimeEdit, Withings, MCP servers
- **Payments**: Stripe + Vipps MobilePay

## Agent Workflow (Legacy Reference)

This repo was originally built through a recursive self-improvement agent workflow. The original agent orchestration docs are preserved in [`docs/legacy/`](../docs/legacy/README.md) for reuse in future projects. The `.github/agents/`, `.agents/`, and `.github/scripts/orchestrator.js` remain functional but are not actively used for current development.
