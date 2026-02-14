# Multi-Agent Loop Architecture

This document describes the autonomous, recursive agent loop that enables continuous development.

## Overview

The multi-agent loop is a self-sustaining system where AI agents continuously:
1. Find work to do (issues)
2. Implement solutions
3. Create PRs that auto-merge
4. Repeat indefinitely

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Agent Orchestrator                     │
│              (Every 15 minutes or manual)                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ├─ Check for issues with `agent-task`
                     ├─ Filter out blocked/in-progress
                     └─ Pick oldest ready issue
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    Agent Executor                         │
│              (Triggered per issue)                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ├─ Mark issue as in-progress
                     ├─ Analyze issue content
                     ├─ Determine task type
                     ├─ Execute appropriate handler
                     └─ Create branch & commit
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Auto-PR Creation                       │
│              (On push to agent/* branch)                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ├─ Create PR from branch
                     ├─ Extract issue number
                     ├─ Add labels (agent-task, agent-automerge)
                     └─ Push trigger commit
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  PR Automation                           │
│              (On PR creation/update)                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ├─ Rebase onto latest main
                     ├─ Wait for checks
                     ├─ Auto-merge if `agent-automerge` label
                     └─ Delete branch
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Issue Closed                            │
│              (Via PR merge)                              │
└─────────────────────────────────────────────────────────┘
                     │
                     └─► Loop continues with next issue
```

## Components

### 1. Agent Orchestrator

**File**: `.github/workflows/agent-orchestrator.yml`

**Triggers**:
- Schedule: Every 15 minutes (`cron: '*/15 * * * *'`)
- Manual: `workflow_dispatch`

**Jobs**:
- `check-for-work`: Queries GitHub API for ready issues
- `trigger-agent`: Dispatches agent executor workflow

**Logic**:
```javascript
// Get all open issues with agent-task label
const issues = await github.rest.issues.listForRepo({
  labels: 'agent-task',
  state: 'open',
  sort: 'created',
  direction: 'asc'
});

// Filter for ready issues (not blocked, not in-progress)
const readyIssues = issues.filter(issue => {
  const labels = issue.labels.map(l => l.name);
  return !labels.includes('blocked') && !labels.includes('in-progress');
});

// Pick oldest issue
const issue = readyIssues[0];
```

### 2. Agent Executor

**File**: `.github/workflows/agent-executor.yml`

**Triggers**:
- Workflow dispatch from orchestrator

**Inputs**:
- `issue_number`: Issue to work on
- `issue_title`: For branch naming

**Jobs**:
1. Mark issue as `in-progress`
2. Fetch issue details (body, scope, deliverable)
3. Create working branch `agent/<issue-number>-<slug>`
4. Run agent logic script (with OpenAI API if available)
5. Commit and push changes
6. Update issue with status

**AI Integration**:
- If `OPENAI_API_KEY` is set, uses GPT-4 to generate code
- Falls back to pattern-based handlers if AI unavailable
- See [docs/ai-agent-config.md](ai-agent-config.md) for configuration

### 3. Issue Discovery Agent

**File**: `.github/workflows/issue-discovery.yml`

**Triggers**:
- Schedule: Daily at 2am UTC
- Manual: `workflow_dispatch`

**Capabilities**:
- Scans for TODO/FIXME comments
- Analyzes test coverage gaps
- Checks documentation completeness
- Reviews package.json scripts
- **AI Analysis**: Uses OpenAI to suggest high-priority improvements

**Creates Issues For**:
- Outstanding TODOs in code
- Files without test coverage
- Missing documentation
- AI-suggested improvements

### 4. Web Agent (Alternative)

**File**: `.github/workflows/web-agent.yml`

**Triggers**:
- Manual workflow dispatch only

**Purpose**:
Alternative agent executor that uses Playwright to interact with web-based AI interfaces (ChatGPT, Claude, Gemini) when API access is limited.

**Usage**:
```bash
gh workflow run web-agent.yml \
  --field issue_number=42 \
  --field agent_type=chatgpt
```

See [docs/ai-agent-config.md](ai-agent-config.md) for setup instructions.

### 5. Agent Logic Script

**File**: `.github/scripts/agent-executor.js`

**Responsibilities**:
- Analyze issue content
- Pattern match to determine task type
- Execute appropriate handler
- Generate code changes

**Task Types**:
- **Documentation**: Update/create docs, README, guides
- **New Agent**: Create new agent class and register
- **Bug Fix**: Create bug fix documentation (AI enhancement needed)
- **Feature**: Create feature spec and implementation plan
- **Refactor**: Plan and execute refactoring
- **Test**: Create test plans and implementations
- **Config**: Update configuration files

**Example Handler** (New Agent):
```javascript
function handleNewAgentTask(issue) {
  // Extract agent name
  const agentName = extractAgentName(issue.title);
  
  // Generate agent file from template
  const agentFile = generateAgentFile(agentName);
  fs.writeFileSync(`apps/server/src/agents/${agentName}-agent.ts`, agentFile);
  
  // Update orchestrator to register agent
  updateOrchestratorRegistry(agentName);
  
  return { success: true, files: [...] };
}
```

### 4. Auto-PR Creation

**File**: `.github/workflows/agent-auto-pr.yml`

**Triggers**:
- Push to branches matching `agent/**`

**Flow**:
1. Extract issue number from branch name
2. Check last commit for `[automerge]` tag
3. Create PR with template
4. Add labels: `agent-task`, `agent-automerge` (if applicable)
5. Link to issue
6. Push trigger commit (to activate next workflow)

### 5. PR Automation

**File**: `.github/workflows/agent-pr-automation.yml`

**Jobs**:
- **auto-rebase**: Rebase PR onto latest main
- **auto-merge**: Merge PR if `agent-automerge` label present

**Merge Strategy**: Squash merge with descriptive commit message

## Task Type Handlers

The agent uses pattern matching to determine task types:

| Pattern | Handler | Action |
|---------|---------|--------|
| `doc\|documentation\|readme\|guide` | Documentation | Update/create documentation files |
| `add\|create.*agent\|provider` | New Agent | Generate agent class, register in orchestrator |
| `fix\|bug\|error` | Bug Fix | Create bug analysis document (AI needed for actual fix) |
| `feature\|implement\|add` | Feature | Create feature spec and implementation plan |
| `refactor\|improve\|optimize` | Refactor | Plan and execute code refactoring |
| `test\|testing\|spec` | Test | Create test plans and test files |
| `config\|configuration\|setup` | Config | Update configuration files |

## Extending the Agent

### Adding New Task Types

1. Add pattern matcher to `taskAnalyzers` in `agent-executor.js`:
```javascript
{
  name: 'my-task-type',
  pattern: /\b(keyword1|keyword2)\b/i,
  handler: handleMyTaskType
}
```

2. Implement handler function:
```javascript
function handleMyTaskType(issue) {
  console.log('🎯 Handling my task type...');
  
  // Analyze issue
  // Make changes
  // Return result
  
  return {
    success: true,
    files: ['path/to/changed/file.ts']
  };
}
```

### Adding AI Integration

The agent script can be enhanced with AI APIs for more intelligent code generation:

```javascript
// In handleBugFixTask or handleFeatureTask
async function handleWithAI(issue) {
  const prompt = `
    Analyze this issue and generate code changes:
    ${issue.title}
    ${issue.body}
  `;
  
  const response = await callAI(prompt);
  const changes = parseAIResponse(response);
  
  applyChanges(changes);
  
  return { success: true, files: changes.affectedFiles };
}
```

**Suggested AI Integrations**:
- OpenAI GPT-4 API for code generation
- GitHub Copilot API for suggestions
- Claude API for complex analysis
- Custom fine-tuned models for project-specific patterns

## Issue Lifecycle

```
New Issue (agent-task label)
  ↓
[Orchestrator picks up]
  ↓
In Progress (label added)
  ↓
[Agent works on it]
  ↓
Branch Created → PR Created → Auto-Merged
  ↓
Issue Closed (via PR merge)
  ↓
Ready for Next Issue
```

## Labels

| Label | Purpose |
|-------|---------|
| `agent-task` | Marks issue as eligible for agent processing |
| `in-progress` | Issue currently being worked on by agent |
| `blocked` | Issue cannot be processed (requires manual intervention) |
| `needs-manual-work` | Agent could not generate changes |
| `agent-automerge` | PR should be automatically merged |

## Configuration

### Orchestrator Frequency

Edit `.github/workflows/agent-orchestrator.yml`:
```yaml
schedule:
  - cron: '*/15 * * * *'  # Every 15 minutes
  # - cron: '0 * * * *'   # Every hour
  # - cron: '0 */6 * * *' # Every 6 hours
```

### Branch Naming

Pattern: `agent/<issue-number>-<title-slug>`

Example: `agent/42-add-notifications-agent`

### Commit Message Format

Pattern: `[Agent Task] <title> [automerge]`

The `[automerge]` tag triggers automatic merging.

## Monitoring

### Check Orchestrator Status
```bash
gh workflow view agent-orchestrator.yml
gh run list --workflow=agent-orchestrator.yml --limit 10
```

### Check Agent Executor Status
```bash
gh workflow view agent-executor.yml
gh run list --workflow=agent-executor.yml --limit 10
```

### View Agent Activity
```bash
# List issues being processed
gh issue list --label agent-task,in-progress

# List recent agent PRs
gh pr list --label agent-task --state all --limit 10

# Check agent branch activity
git branch -r | grep agent/
```

## Troubleshooting

### Agent Not Picking Up Issues

1. Check orchestrator is running:
   ```bash
   gh run list --workflow=agent-orchestrator.yml --limit 1
   ```

2. Verify issue has `agent-task` label:
   ```bash
   gh issue view <issue-number> --json labels
   ```

3. Check for blocking labels:
   - Issue should NOT have `blocked` or `in-progress` labels

### Agent Executor Fails

1. View executor logs:
   ```bash
   gh run view <run-id> --log
   ```

2. Common failures:
   - Missing dependencies (run `npm install`)
   - Invalid issue format
   - No changes generated

3. Issue will be labeled `blocked` or `needs-manual-work`

### PR Not Auto-Merging

1. Check PR has `agent-automerge` label
2. Verify commit message contains `[automerge]`
3. Check PR automation workflow status:
   ```bash
   gh pr view <pr-number> --json statusCheckRollup
   ```

## Best Practices

### Creating Agent-Friendly Issues

Good issue structure:
```markdown
## Scope
Clear description of what's in/out of scope

## Deliverable
Specific, verifiable outcome

## Verification
Command to verify completion

## Context
Links to relevant files, issues, or documentation
```

### Issue Prioritization

- Agents process issues oldest-first
- Use issue numbers to control order
- Create issues in batches for sequential work

### Monitoring Agent Quality

- Review agent-created PRs regularly
- Check for successful merges vs. failures
- Update agent logic based on patterns

### Safety Measures

- PRs are squash-merged (safe to revert)
- Branches auto-delete after merge
- Failed attempts are labeled for review
- Manual override always available

## Future Enhancements

1. **AI Integration**: Connect to GPT-4/Claude for intelligent code generation
2. **Multi-Agent Types**: Different agent personalities (conservative, experimental, docs-focused)
3. **Learning Loop**: Agents learn from successful/failed attempts
4. **Parallel Execution**: Process multiple issues concurrently
5. **Quality Metrics**: Track agent success rate, code quality, test coverage
6. **Human Review**: Optional PR review step before merge
7. **Rollback Detection**: Automatic revert of problematic changes
8. **Cross-Repo**: Share agents across multiple repositories

## References

- [Copilot Instructions](.github/copilot-instructions.md)
- [Agent Backlog](../docs/agent-backlog.md)
- [Orchestration Protocol](../.agents/ORCHESTRATION.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
