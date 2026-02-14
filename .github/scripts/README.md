# Orchestrator System - README

## Overview
The orchestrator is a self-improving automation system that continuously discovers work in the codebase and creates well-scoped issues for agents to complete.

## How It Works

### 1. Trigger Points
The orchestrator workflow (`.github/workflows/orchestrator.yml`) runs when:
- **Manual dispatch**: Via GitHub Actions UI
- **Schedule**: Daily at 6am UTC
- **Issue close**: When an orchestrator issue (title contains "Orchestrator" + has "agent-task" label) is closed

### 2. Scan Process
The orchestrator script (`.github/scripts/orchestrator.js`) scans for:
- **TODOs/FIXMEs**: Any TODO, FIXME, HACK, or XXX comments in code
- **Missing tests**: Source files without corresponding test files
- **Documentation gaps**: Missing core documentation files
- **Code improvements**: Files exceeding 200 lines that should be refactored

### 3. Issue Creation
For each finding, the orchestrator:
- Creates a well-scoped GitHub issue with:
  - **Scope**: What to do (and what not to do)
  - **Deliverable**: Concrete output expected
  - **Verification**: How to confirm it's done
- Applies the `agent-task` label
- Assigns to `copilot-swe-agent[bot]`
- Routes to appropriate custom agent (test-engineer, backend-engineer, frontend-engineer, docs-writer)

### 4. Batching Rules
- Maximum **5 issues per run** to avoid spam
- Groups related files (e.g., 3 agent files per test issue)
- Deduplicates against existing open issues

### 5. Recursive Loop
After creating issues, the orchestrator creates a special "Orchestrator: discover and assign new work" issue assigned to itself. When this issue closes, the workflow triggers again, continuing the cycle ♻️

## Agent Assignment Logic

The orchestrator automatically routes issues to the best agent:

| Condition | Agent |
|-----------|-------|
| Title starts with "Document" or contains "readme"/"guide" | docs-writer |
| Title contains "test"/"spec"/"coverage" | test-engineer |
| File in `apps/web/` or title contains "component"/"react"/"css" | frontend-engineer |
| File in `apps/server/` or `.github/` or title contains "server"/"agent" | backend-engineer |
| Default | backend-engineer |

## File Structure

```
.github/
  scripts/
    orchestrator.js              - Main scan and issue creation script
    orchestrator-findings.md     - Latest scan results and identified work
    ORCHESTRATOR_STATUS.md       - Run history and status tracking
    ORCHESTRATOR_EXECUTION_SUMMARY.md - Detailed summary of latest run
  workflows/
    orchestrator.yml             - GitHub Actions workflow definition
```

## Running Manually

### Via GitHub UI
1. Go to Actions → Agent Orchestrator
2. Click "Run workflow"
3. Options:
   - Dry run: Preview what would be created without making changes
   - Recursive: Whether to create the next orchestrator issue (default: true)

### Via GitHub CLI
```bash
# Normal run
gh workflow run orchestrator.yml

# Dry run (preview only)
gh workflow run orchestrator.yml -f dry_run=true

# Run without creating recursive issue
gh workflow run orchestrator.yml -f recursive=false
```

### Locally (for testing)
```bash
cd .github/scripts
DRY_RUN=true node orchestrator.js
```

## Environment Variables

- `GITHUB_TOKEN`: GitHub Actions token (for creating issues)
- `AGENT_PAT`: User PAT required to assign issues to copilot-swe-agent[bot]
  - Without this, issues are created but agents aren't assigned
  - Required permissions: metadata(r), actions(rw), contents(rw), issues(rw), pull-requests(rw)
- `GITHUB_REPOSITORY`: Repository in format `owner/repo`
- `DRY_RUN`: Set to `true` to preview without creating issues
- `RECURSIVE`: Set to `false` to skip creating the next orchestrator issue

## Monitoring

### Check Status
View `.github/scripts/ORCHESTRATOR_STATUS.md` for:
- Last run timestamp and status
- Issues created in the last run
- Pending work for next run

### Check Findings
View `.github/scripts/orchestrator-findings.md` for:
- Latest scan results
- Identified work items
- Priority classifications

### Check Workflow Runs
```bash
gh workflow view "Agent Orchestrator"
gh run list --workflow=orchestrator.yml
```

## Troubleshooting

### Issues Not Created
- Check workflow run logs: `gh run view <run-id>`
- Verify `AGENT_PAT` is set (required for agent assignment)
- Check for API rate limits
- Ensure issue titles don't duplicate existing open issues

### Workflow Not Triggering
- Verify the closed issue has "agent-task" label
- Verify the issue title contains "Orchestrator"
- Check workflow conditions in `orchestrator.yml`

### False Positive Findings
Update scan logic in `orchestrator.js`:
- `findTodos()`: Adjust TODO detection patterns
- `findMissingTests()`: Modify test file matching logic
- `findDocGaps()`: Update required documentation list
- `findCodeImprovements()`: Change line count thresholds

## Best Practices

1. **Let the loop run**: Don't manually create orchestrator issues; let the system manage the recursive loop
2. **Review findings**: Periodically check `orchestrator-findings.md` to understand what work is queued
3. **Monitor agent progress**: Watch the `agent-task` labeled issues to see what's being worked on
4. **Adjust thresholds**: If too many/few issues are created, tune the detection logic
5. **Document exceptions**: If certain files should be excluded from scans, update the script's exclusion patterns

## Development

### Adding New Scan Types
1. Create a new function (e.g., `findSecurityIssues()`)
2. Add to the `allIssues` array in `main()`
3. Test with `DRY_RUN=true`

### Modifying Agent Assignment
Update the `pickAgent()` function logic to change routing rules.

### Changing Batch Size
Modify the `.slice(0, 5)` line in `main()` to change the max issues per run.

## Architecture Principles

1. **Issues are the interface**: All work flows through GitHub issues
2. **Agents are assignees**: Issues are assigned to copilot-swe-agent[bot] with custom agent routing
3. **Recursive discovery**: The system discovers its own work automatically
4. **Batched execution**: Controlled issue creation prevents spam
5. **Deduplication**: Existing issues are respected to avoid duplicates
