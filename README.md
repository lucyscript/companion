# Companion

This repository uses an **autonomous agent loop** for continuous development.

## 🤖 Autonomous Development

This project features a **self-improving agent loop** that continuously works on issues:

- **🔄 Continuous Loop**: Agents check for work every 15 minutes
- **🎯 Auto-Pick Issues**: Tasks labeled `agent-task` are automatically selected
- **🛠️ Autonomous Work**: Agents analyze issues and implement solutions
- **✅ Auto-Merge**: Changes are automatically merged when checks pass
- **♾️ Recursive Iteration**: The loop runs indefinitely, constantly improving the project

### How It Works

1. **Orchestrator** ([`.github/workflows/agent-orchestrator.yml`](.github/workflows/agent-orchestrator.yml))
   - Runs every 15 minutes (or on-demand)
   - Checks for open issues with `agent-task` label
   - Picks the oldest ready issue
   - Triggers agent executor

2. **Agent Executor** ([`.github/workflows/agent-executor.yml`](.github/workflows/agent-executor.yml))
   - Analyzes issue content and determines task type
   - Creates a working branch (`agent/<issue-number>-<slug>`)
   - Executes appropriate handler (docs, features, bugs, etc.)
   - Commits changes with `[automerge]` tag
   - Pushes to trigger auto-PR creation

3. **Auto-PR Creation** ([`.github/workflows/agent-auto-pr.yml`](.github/workflows/agent-auto-pr.yml))
   - Detects new `agent/*` branches
   - Creates PR with appropriate labels
   - Adds `agent-automerge` label if `[automerge]` in commit

4. **Auto-Merge** ([`.github/workflows/agent-pr-automation.yml`](.github/workflows/agent-pr-automation.yml))
   - Rebases PR onto latest main
   - Merges PR with `agent-automerge` label
   - Deletes branch after merge

## Working model
- Use GitHub Issues as the source of truth for tasks
- Label issues with `agent-task` for autonomous processing
- Use `.github/ISSUE_TEMPLATE/copilot-agent-task.yml` template
- Follow `.github/copilot-instructions.md` for agent collaboration protocol

## 🧠 AI-Powered Intelligence

The agent system supports multiple AI backends:

- **OpenAI API (GPT-4)** - Generates actual code, understands complex requirements
- **Pattern-Based** - Rule-based handlers for simple tasks (free fallback)
- **Web Agents** - Playwright-driven access to ChatGPT/Claude web interfaces

See [docs/ai-agent-config.md](docs/ai-agent-config.md) for configuration.

## 🔍 Automatic Issue Discovery

Beyond working on existing issues, agents also **discover new work**:

- Daily codebase analysis
- Detects TODOs/FIXMEs
- Identifies test coverage gaps
- Spots documentation needs
- AI-powered improvement suggestions

The discovery agent runs daily and creates issues automatically.

## Quick start

### For Creating Agent Tasks
1. Create an issue using the **Copilot Agent Task** template
2. Add the `agent-task` label
3. Wait for the next orchestrator cycle (max 15 minutes)
4. Agent picks up issue, implements changes, and auto-merges

### For Enabling AI (Optional)
```bash
gh secret set OPENAI_API_KEY --body "sk-..."
```
See [.github/SETUP.md](.github/SETUP.md) for full setup instructions.

### For Manual Contributions
1. Create issues without `agent-task` label
2. Work on them manually in feature branches
3. Create PRs normally
4. Manual review and merge
