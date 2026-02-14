# E2E Testing with Playwright

This directory contains end-to-end tests for the Companion project using Playwright.

## Overview

The E2E tests automate browser interactions to test scenarios that cannot be covered by unit tests or API-level tests. A key use case is testing GitHub UI automation for triggering the Claude coding agent.

## Why Playwright for Claude Assignment?

As documented in `.github/scripts/orchestrator.js`:

> **Claude can only be triggered via the GitHub UI (internal dispatch).**
> **There is no public API to trigger it programmatically.**

Unlike GitHub Copilot (which has an API via `agent_assignment` payload) and Codex (triggered via `@codex` comment), Claude must be assigned through the GitHub web interface. Playwright enables us to automate this UI interaction.

## Test Structure

```
tests/e2e/
├── claude-assignment.spec.ts    # Tests for Claude assignment automation
└── ...                          # Other E2E tests
```

## Prerequisites

1. **Install Playwright**: Already done via `npm install`
2. **Install browsers**: Run `npx playwright install chromium`
3. **Set environment variables**:
   ```bash
   export GITHUB_TOKEN="your_github_token"
   export GITHUB_REPO="lucyscript/companion"
   export TEST_ISSUE_NUMBER="123"
   ```

## Running Tests

### Run all E2E tests
```bash
npm run test:e2e
```

### Run with visible browser (headed mode)
```bash
npm run test:e2e:headed
```

### Run with Playwright UI (interactive mode)
```bash
npm run test:e2e:ui
```

### Run in debug mode
```bash
npm run test:e2e:debug
```

### Run specific test file
```bash
npm run test:e2e tests/e2e/claude-assignment.spec.ts
```

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `GITHUB_TOKEN` | Yes | GitHub Personal Access Token with issues:write | `ghp_xxx...` |
| `GITHUB_REPO` | Yes | Repository in owner/repo format | `lucyscript/companion` |
| `TEST_ISSUE_NUMBER` | No | Specific issue number to test on | `42` (default: `1`) |

## Test Cases

### 1. Claude Assignment via UI
Tests the complete flow of assigning Claude to a GitHub issue through the web interface.

**Steps:**
1. Navigate to issue page
2. Click on assignees section
3. Search for Claude/anthropic-code-agent[bot]
4. Click to assign
5. Verify assignment succeeded

### 2. Verify Agent Workflow Trigger
Confirms that assigning Claude actually triggers the agent workflow by checking for bot activity.

**Checks:**
- Claude bot appears in assignees
- Claude bot has commented on the issue
- Agent workflow has started

### 3. API Limitation Test
Demonstrates that the GitHub API cannot trigger Claude's coding agent workflow, even though it can perform basic assignment.

**Purpose:** Document the limitation and confirm UI automation is necessary.

## CI/CD Integration

To run these tests in GitHub Actions, you'll need to:

1. Add repository secrets:
   - `GITHUB_TOKEN` (or use the default `${{ secrets.GITHUB_TOKEN }}`)
   - Create a test issue or use a dedicated testing label

2. Example workflow:
   ```yaml
   - name: Run E2E tests
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
       GITHUB_REPO: ${{ github.repository }}
       TEST_ISSUE_NUMBER: ${{ env.TEST_ISSUE }}
     run: npm run test:e2e
   ```

3. Note: These tests interact with real GitHub issues, so consider:
   - Running on a schedule or manually
   - Using a dedicated test repository
   - Cleaning up test data after runs

## Troubleshooting

### "GITHUB_TOKEN environment variable is required"
Set the token before running tests:
```bash
export GITHUB_TOKEN="your_token_here"
```

### "Claude is not available as an assignee"
Claude needs to be enabled for your repository. This may require:
- Repository admin permissions
- GitHub Enterprise or specific plan
- Enabling Anthropic Claude integration

### Tests fail on CI but pass locally
- Ensure the GitHub runner has network access to github.com
- Check that secrets are properly configured
- Verify browser installation on CI runner
- Consider using `playwright install --with-deps` for system dependencies

## Best Practices

1. **Use test issues**: Create dedicated test issues to avoid polluting production data
2. **Clean up**: Unassign agents after tests complete
3. **Rate limiting**: Add delays between tests to respect GitHub's rate limits
4. **Idempotent tests**: Design tests that can be run multiple times safely
5. **Authentication**: Never commit tokens; always use environment variables

## Further Reading

- [Playwright Documentation](https://playwright.dev)
- [GitHub API - Issues](https://docs.github.com/en/rest/issues)
- [Companion Project Brief](../docs/project-brief.md)
- [Orchestrator Script](../.github/scripts/orchestrator.js)
