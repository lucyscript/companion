/**
 * assign-claude.mjs
 *
 * Uses Playwright to assign Claude (anthropic-code-agent[bot]) to a GitHub issue
 * via GitHub's internal GraphQL endpoint. This is necessary because:
 *
 * 1. Claude's runtime only triggers from the GitHub UI assignment flow
 * 2. The REST/public GraphQL APIs can assign Claude but don't trigger its runtime
 * 3. The internal /_graphql endpoint requires a browser session context (cookies + CSRF nonce)
 *
 * Usage:
 *   ISSUE_NODE_ID=I_kwDO... GH_SESSION_COOKIE=<user_session_value> node assign-claude.mjs
 *
 * Required environment variables:
 *   - ISSUE_NODE_ID: The GraphQL node ID of the issue (e.g., I_kwDORQSEMc7q_Y9k)
 *   - GH_SESSION_COOKIE: The `user_session` cookie value from a logged-in GitHub session
 *   - REPO_NWO: Repository in owner/repo format (e.g., lucyscript/companion)
 *   - ISSUE_NUMBER: The issue number (used to navigate to the page)
 *
 * Constants:
 *   - CLAUDE_BOT_ID: BOT_kgDODnPHJg (anthropic-code-agent[bot])
 */

import { chromium } from 'playwright';

const CLAUDE_BOT_ID = 'BOT_kgDODnPHJg';

async function assignClaude() {
  const {
    ISSUE_NODE_ID,
    GH_SESSION_COOKIE,
    REPO_NWO = 'lucyscript/companion',
    ISSUE_NUMBER,
  } = process.env;

  if (!ISSUE_NODE_ID || !GH_SESSION_COOKIE || !ISSUE_NUMBER) {
    console.error('Missing required env vars: ISSUE_NODE_ID, GH_SESSION_COOKIE, ISSUE_NUMBER');
    process.exit(1);
  }

  const issueUrl = `https://github.com/${REPO_NWO}/issues/${ISSUE_NUMBER}`;
  console.log(`Assigning Claude to ${issueUrl} (node: ${ISSUE_NODE_ID})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Set session cookies before navigating
  await context.addCookies([
    {
      name: 'user_session',
      value: GH_SESSION_COOKIE,
      domain: 'github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: '__Host-user_session_same_site',
      value: GH_SESSION_COOKIE,
      domain: 'github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
    {
      name: 'logged_in',
      value: 'yes',
      domain: '.github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  try {
    // Navigate to the issue page (this establishes _gh_sess + fetch-nonce)
    console.log('Navigating to issue page...');
    await page.goto(issueUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Verify we're logged in
    const loggedIn = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="user-login"]');
      return meta?.content || null;
    });

    if (!loggedIn) {
      throw new Error('Not logged in — session cookie may have expired. Update GH_SESSION_COOKIE secret.');
    }
    console.log(`Logged in as: ${loggedIn}`);

    // Execute the assignment via page.evaluate (inside browser context)
    // This is the ONLY method that works — the CSRF nonce is validated within the page context
    const result = await page.evaluate(
      async ({ claudeBotId, issueNodeId }) => {
        const nonce = document.querySelector('meta[name="fetch-nonce"]')?.content;
        if (!nonce) throw new Error('No fetch-nonce found on page');

        const resp = await fetch('/_graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'GitHub-Verified-Fetch': 'true',
            'X-Requested-With': 'XMLHttpRequest',
            'Scoped-CSRF-Token': nonce,
          },
          body: JSON.stringify({
            persistedQueryName: 'replaceActorsForAssignableRelayMutation',
            query: '19abeaf03278462751d1cf808a3f00f5',
            variables: {
              input: {
                actorIds: [claudeBotId],
                assignableId: issueNodeId,
              },
            },
          }),
        });

        const body = await resp.json();
        return { status: resp.status, body };
      },
      { claudeBotId: CLAUDE_BOT_ID, issueNodeId: ISSUE_NODE_ID }
    );

    if (result.status !== 200) {
      throw new Error(`GraphQL returned ${result.status}: ${JSON.stringify(result.body)}`);
    }

    const assignedActors = result.body?.data?.replaceActorsForAssignable?.assignable?.assignedActors?.nodes || [];
    const claudeAssigned = assignedActors.some(a => a.id === CLAUDE_BOT_ID);

    if (!claudeAssigned) {
      throw new Error(`Claude not in assigned actors: ${JSON.stringify(assignedActors.map(a => a.displayName))}`);
    }

    console.log(`✓ Claude assigned successfully. Assigned actors: ${assignedActors.map(a => a.displayName).join(', ')}`);
  } finally {
    await browser.close();
  }
}

assignClaude().catch((err) => {
  console.error(`✗ Failed to assign Claude: ${err.message}`);
  process.exit(1);
});
