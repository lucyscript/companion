# Companion — Documentation

> Personal AI companion for university students. Chat-first mobile PWA with schedule management, nutrition tracking, habit building, and deep LMS integration.

## Quick Links

| Document | Description |
|----------|-------------|
| [System Overview](system-overview.md) | Architecture, tech stack, how everything fits together |
| [Architecture Diagrams](architecture.md) | Mermaid diagrams — request flow, data model, deployment |
| [API Reference](api-reference.md) | All 113 HTTP endpoints organized by domain |
| [Frontend Guide](frontend.md) | React components, views, hooks, theming |
| [Environment Variables](environment.md) | Every env var with defaults and descriptions |
| [Deployment](deployment.md) | Railway (backend) + GitHub Pages (frontend) setup |

## Legacy Docs

The original documentation from the agent-orchestrated development phase is preserved in [`docs/legacy/`](legacy/). This includes:

- **Agent profiles** — Role definitions for the AI coding agents that built this system
- **Orchestration config** — GitHub Actions workflows, issue templates, PR automation
- **Original project brief** — Phase-by-phase roadmap used during autonomous development
- **API contracts** — Earlier payload shape documentation (now superseded by [api-reference.md](api-reference.md))

These are kept as reference for the recursive self-improvement workflow methodology. They are not maintained and may be outdated.
