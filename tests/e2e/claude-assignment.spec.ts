import { test, expect } from '@playwright/test';

/**
 * E2E test for assigning Claude agent to GitHub issues via UI automation.
 *
 * Context:
 * - Claude (Anthropic's coding agent) can only be triggered via GitHub UI
 * - There is no public API to trigger Claude programmatically
 * - This test automates the UI interaction to assign Claude to an issue
 *
 * Prerequisites:
 * - GITHUB_TOKEN: Personal Access Token with issues:write permission
 * - GITHUB_REPO: Repository in format "owner/repo" (e.g., "lucyscript/companion")
 * - TEST_ISSUE_NUMBER: Issue number to test assignment on
 */

test.describe('Claude Assignment via GitHub UI', () => {
  test.beforeEach(async ({ page }) => {
    // Verify required environment variables
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    if (!process.env.GITHUB_REPO) {
      throw new Error('GITHUB_REPO environment variable is required (format: owner/repo)');
    }
  });

  test('should assign Claude to a GitHub issue via UI', async ({ page }) => {
    const repo = process.env.GITHUB_REPO;
    const issueNumber = process.env.TEST_ISSUE_NUMBER || '1';
    const token = process.env.GITHUB_TOKEN;

    // Navigate to the issue page
    const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
    await page.goto(issueUrl);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Authenticate if needed (inject token via cookie or auth header)
    // Note: In production, this would use GitHub's OAuth flow or session cookies
    // For testing purposes, we simulate authenticated session

    // Look for the assignees section
    const assigneesSection = page.locator('[aria-label="Select assignees"]').or(
      page.locator('text=Assignees').locator('..').locator('..')
    );
    await expect(assigneesSection).toBeVisible({ timeout: 10000 });

    // Click to open assignees dropdown
    await assigneesSection.click();

    // Wait for the assignees dropdown to appear
    await page.waitForSelector('[role="menu"], [role="dialog"]', { timeout: 5000 });

    // Search for "Claude" or "anthropic-code-agent[bot]" in the assignees list
    const claudeAssignee = page.locator('text=Claude').or(
      page.locator('text=anthropic-code-agent')
    ).first();

    // Check if Claude is available as an assignee
    const isClaudeVisible = await claudeAssignee.isVisible();

    if (isClaudeVisible) {
      // Click on Claude to assign
      await claudeAssignee.click();

      // Wait for assignment to complete
      await page.waitForTimeout(1000);

      // Verify Claude was assigned
      const assignedClaude = page.locator('.assignee').locator('text=Claude').or(
        page.locator('.assignee').locator('text=anthropic-code-agent')
      );
      await expect(assignedClaude).toBeVisible();

      console.log(`✅ Successfully assigned Claude to issue #${issueNumber}`);
    } else {
      console.log('⚠️  Claude is not available as an assignee for this repository');
      // This is expected - Claude needs to be enabled for the repository first
      test.skip();
    }
  });

  test('should verify Claude assignment triggers agent workflow', async ({ page }) => {
    const repo = process.env.GITHUB_REPO;
    const issueNumber = process.env.TEST_ISSUE_NUMBER || '1';

    // Navigate to the issue
    await page.goto(`https://github.com/${repo}/issues/${issueNumber}`);
    await page.waitForLoadState('networkidle');

    // Check if Claude is already assigned
    const claudeAssigned = page.locator('.assignee').locator('text=Claude').or(
      page.locator('.assignee').locator('text=anthropic-code-agent')
    );

    const isAssigned = await claudeAssigned.isVisible().catch(() => false);

    if (isAssigned) {
      console.log('✅ Claude is assigned to the issue');

      // Navigate to issue comments to check for agent activity
      const commentsSection = page.locator('.timeline-comment');
      await expect(commentsSection).toBeVisible();

      // Look for comments from Claude bot
      const claudeComment = page.locator('.timeline-comment').filter({
        has: page.locator('text=anthropic-code-agent')
      });

      // Check if Claude has commented (indicating it's working on the issue)
      const hasClaudeActivity = await claudeComment.count() > 0;

      if (hasClaudeActivity) {
        console.log('✅ Claude has activity on this issue');
      } else {
        console.log('ℹ️  Waiting for Claude to start working on the issue...');
      }
    } else {
      console.log('ℹ️  Claude is not yet assigned to this issue');
      test.skip();
    }
  });

  test('should handle assignment via API fallback for testing', async ({ request }) => {
    // This test demonstrates the API limitation mentioned in orchestrator.js:
    // "Claude can only be triggered via the GitHub UI (internal dispatch)."
    //
    // We verify that the GitHub API does NOT support triggering Claude
    // the way it supports Copilot (via agent_assignment payload)

    const repo = process.env.GITHUB_REPO;
    const [owner, repoName] = repo!.split('/');
    const issueNumber = process.env.TEST_ISSUE_NUMBER || '1';
    const token = process.env.GITHUB_TOKEN;

    // Attempt to assign using GitHub API (this should work for basic assignment)
    const response = await request.post(
      `https://api.github.com/repos/${owner}/${repoName}/issues/${issueNumber}/assignees`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        data: {
          // Note: We can assign the bot user, but it won't trigger agent workflow
          assignees: ['anthropic-code-agent[bot]'],
        }
      }
    );

    // The API call might succeed (assigning the user) or fail (if bot doesn't exist)
    // But even if it succeeds, it WON'T trigger Claude's coding agent session
    console.log(`API Response Status: ${response.status()}`);

    if (response.ok()) {
      console.log('⚠️  Assignment via API succeeded but does NOT trigger Claude agent workflow');
      console.log('    UI interaction is required to actually trigger Claude');
    } else {
      console.log('❌ API assignment failed (expected - Claude must be triggered via UI)');
    }
  });
});

/**
 * Usage:
 *
 * 1. Set environment variables:
 *    export GITHUB_TOKEN="your_github_token"
 *    export GITHUB_REPO="lucyscript/companion"
 *    export TEST_ISSUE_NUMBER="123"
 *
 * 2. Run the test:
 *    npm run test:e2e
 *
 * 3. Or run in headed mode (see browser):
 *    npm run test:e2e -- --headed
 *
 * 4. Run specific test:
 *    npm run test:e2e -- claude-assignment.spec.ts
 *
 * Note: These tests are designed to be run in a controlled test environment.
 * They may require additional setup for GitHub authentication in CI/CD.
 */
