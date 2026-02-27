# Dev Environment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- VSCode

## Recommended VSCode Extensions

- ESLint
- Prettier
- GitHub Copilot Chat
- TypeScript and JavaScript Language Features

## Start Development

```bash
npm install
npm run dev
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`

## iPhone PWA Install

1. Deploy to GitHub Pages (auto-deploys on merge to main via `.github/workflows/deploy.yml`).
2. On iPhone, open the GitHub Pages URL in Safari.
3. Share → Add to Home Screen.

## Working With Multiple Coding Agents

1. Put assignment in an issue with explicit path ownership.
2. Tag one agent owner (`Codex`, `Claude`, or `Copilot`).
3. Agent creates a branch `agent/<issue-number>-<description>`.
4. Workflows auto-create PR, auto-rebase, auto-approve, and auto-merge.
5. Merge backend contracts first, then frontend consumers.
6. After completing a feature, update `docs/project-brief.md` roadmap status to `✅ done`.
