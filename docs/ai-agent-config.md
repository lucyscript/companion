# AI Agent Configuration Guide

This guide explains how to configure different AI backends for the autonomous agent loop.

## Overview

The agent system tries methods in this priority order:

1. **Codex CLI** 🚀 PRIMARY - Most integrated and reliable
2. **OpenAI API (gpt-5.3-codex)** 🧠 Fallback - Direct API access
3. **Web Agent Mode** 🌐 Alternative - Manual trigger with Playwright
4. **Pattern-Based Mode** 🔧 Last Resort - Rule-based handlers

## 1. Codex CLI (PRIMARY - Recommended)

The Codex CLI is the best option - it's designed specifically for autonomous code generation.

### Setup

```bash
# Install globally
npm i -g @openai/codex

# Run once to authenticate
codex
# Follow prompts to sign in with your ChatGPT account or API key
```

### Features

- ✅ **Best-in-class code generation** - Uses GPT-5.3-Codex model
- ✅ **Repository awareness** - Understands your codebase structure
- ✅ **Direct file editing** - Can inspect, edit, and run commands
- ✅ **Cloud and local modes** - Works in CI/CD (cloud) or locally
- ✅ **Uses your ChatGPT Pro subscription** - No additional API costs
- ✅ **Zero additional configuration** - Just install and authenticate

### Authentication

Two options:

**Option A: ChatGPT Account (Recommended)**
```bash
codex
# Choose "Sign in with ChatGPT"
# Authenticate in browser
```

**Option B: API Key**
```bash
codex
# Choose "Use API key"
# Enter your OpenAI API key
```

### Cloud Mode (for GitHub Actions)

Codex CLI supports cloud mode which works great in CI/CD:
```bash
codex --cloud --execute-commands
```

This runs Codex's model in the cloud without needing local resources.

### Cost

- **With ChatGPT Pro**: Included in your $20/month subscription
- **With API key**: ~$0.01-0.10 per issue (gpt-5.3-codex pricing)

### When It Runs

The agent executor automatically tries Codex CLI first on every issue:
- Installed in the workflow via `npm i -g @openai/codex`
- Authenticates using stored credentials or API key
- Falls back to other methods if unavailable

## 2. OpenAI API Mode (Fallback)

If Codex CLI is unavailable, the system uses direct API calls.

### Setup

Add your OpenAI API key as a GitHub secret:
   ```bash
   gh secret set OPENAI_API_KEY --body "sk-proj-..."
   ```

   Or via GitHub UI:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `OPENAI_API_KEY`
   - Value: Your API key

3. The agent executor will automatically use OpenAI when the secret is set

### Features

- ✅ Generates actual code changes (not just documentation)
- ✅ Understands codebase context
- ✅ Follows existing patterns
- ✅ Works with complex issues
- ✅ No browser interaction needed

### Cost

- ~$0.01-0.10 per issue (depending on complexity)
- GPT-4 Turbo pricing: $0.01/1K input tokens, $0.03/1K output tokens
- Budget ~$10/month for moderate usage (100-1000 issues)

### Models

Current model: `gpt-5.3-codex` (optimized for code generation)

You can modify this in `.github/scripts/agent-executor.js`:
```javascript
model: 'gpt-5.3-codex'  // Best for code
// or 'gpt-4-turbo-preview' for general tasks
// or 'gpt-3.5-turbo' for faster/cheaper
```

## 3. Pattern-Based Mode (Last Resort)

### Setup

No setup required. This is the default when `OPENAI_API_KEY` is not set.

### Features

- ✅ Zero cost
- ✅ Fast execution
- ✅ No external dependencies
- ⚠️  Limited to specific task types
- ⚠️  Creates documentation instead of code for complex tasks

### Task Types Supported

| Task Type | Handler | What It Does |
|-----------|---------|--------------|
| Documentation | ✅ Full | Creates/updates docs, README, guides |
| New Agent | ✅ Full | Generates agent class boilerplate |
| Configuration | ✅ Partial | Updates config files |
| Bug Fix | 📝 Docs | Creates bug analysis document |
| Feature | 📝 Docs | Creates feature specification |
| Refactor | 📝 Docs | Creates refactor plan |
| Test | 📝 Docs | Creates test plan |

### When to Use

- Development/testing without API costs
- Simple documentation tasks
- Creating boilerplate code
- When AI is unavailable

##When AI is unavailable

## 4. Web Agent Mode (Manual 
This mode uses Playwright to interact with web-based AI interfaces (ChatGPT, Claude, Gemini).

1. Install Playwright:
   ```bash
   npm install playwright
   npx playwright install chromium
   ```

2. Choose your agent and run manually:
   ```bash
   gh workflow run web-agent.yml \
     --field issue_number=<issue> \
     --field agent_type=chatgpt  # or claude, gemini
   ```

### Authentication

Web agents require authentication:

**Option A: Manual Login (Simplest)**
- Run workflow with `headless: false` in web-agent.js
- Log in through the browser
- Save session cookies

**Option B: Stored Credentials**
- Store auth tokens as GitHub secrets
- Update web-agent.js to inject them

**Option C: Persistent Context**
- Use Playwright's persistent context
- Store browser profile with saved sessions

### Features

- ✅ Works with ChatGPT Plus (GPT-4)
- ✅ Works with Claude Pro
- ✅ No API key needed
- ⚠️  Requires authentication setup
- ⚠️  Slower than API mode
- ⚠️  Less reliable (UI changes break it)

### When to Use

- You have ChatGPT Plus but not API access
- Testing different AI models
- API quota exceeded
- Want to use specific model versions (GPT-4, Claude Opus, etc.)

## Comparison Matrix

| Feature | OpenAI API | Pattern-Based | Web Agent |
|---------|------------|---------------|-----------|
| **Cost** | ~$0.01-0.10/issue | Free | Free (if you have subscription) |
| **Setup** | API key | None | Auth + Playwright |
| **Reliability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Code Quality** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Speed** | Fast (5-10s) | Instant | Slow (30-60s) |
| **Complexity** | Any | Simple only | Any |
| **Maintenance** | Low | Low | High |

## Recommended Configuration

### For Production

```bash
# Use OpenAI API
gh secret set OPENAI_API_KEY --body "sk-..."
```

Budget $10-20/month for consistent development.

### For Development/Testing

Don't set `OPENAI_API_KEY` - uses pattern-based mode for free.

### For Personal Projects

Use Web Agent with your existing ChatGPT/Claude subscription:
- One-time setup with authentication
- Trigger manually for specific issues
- No API costs

## Issue Discovery Agent

The issue discovery agent also uses OpenAI API to analyze the codebase:

```bash
# Enable AI-powered issue discovery
gh secret set OPENAI_API_KEY --body "sk-..."
```

Discovery agent runs daily and:
- Scans for TODOs/FIXMEs
- Analyzes test coverage
- Checks documentation
- Uses AI to suggest improvements

Cost: ~$0.05-0.10 per discovery run = ~$3/month

## Advanced: Using GitHub Copilot tokens

If you have GitHub Copilot/Pro, you have some free inference tokens.

### Option 1: GitHub Models API

```javascript
// In agent-executor.js, change the API endpoint:
const response = await fetch('https://models.github.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,  // Use GITHUB_TOKEN instead
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4',  // GitHub provides access to various models
    messages: [...]
  })
});
```

Set in workflow:
```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Limitations:**
- Limited free tier
- Rate limits apply
- May not have latest models

### Option 2: VS Code Extension API

If you want to use the Codex extension from VS Code:

1. The extension runs locally in your IDE
2. Can't easily be automated in GitHub Actions
3. Better for manual agent-assisted development

For automation, OpenAI API or Web Agent are better choices.

## Monitoring Usage

### OpenAI API

Check usage at: https://platform.openai.com/usage

Set usage limits to avoid surprises:
1. Go to Settings → Limits
2. Set monthly budget (e.g., $20)
3. Enable email alerts

### Pattern-Based Mode

No monitoring needed - always free.

### Web Agent

Monitor your subscription:
- ChatGPT Plus: $20/month (already paid)
- Claude Pro: $20/month (already paid)
- Gemini: Free for now

## Troubleshooting

### "OpenAI API error 401"

API key is invalid or not set correctly:
```bash
# Verify secret exists
gh secret list | grep OPENAI_API_KEY

# Re-set if needed
gh secret set OPENAI_API_KEY --body "sk-..."
```

### "OpenAI API error 429"

Rate limit exceeded:
- Wait a few minutes
- Reduce: agent runs (schedule less frequently)
- Upgrade to higher tier plan

### "AI handler failed, falling back..."

This is normal! The system falls back to pattern-based handlers:
- Check the logs for the specific error
- Verify API key is correct
- Check OpenAI status: https://status.openai.com/

### Web Agent Login Required

```bash
# Run with visible browser for manual login
# Edit web-agent.js: headless: false
gh workflow run web-agent.yml --field issue_number=X --field agent_type=chatgpt
```

Then save the session cookies for future runs.

## Best Practices

1. **Start with Pattern-Based** - Test the system without costs
2. **Add OpenAI for Production** - When you're ready for full automation
3. **Monitor Costs** - Set budgets and alerts
4. **Use Web Agent as Backup** - If API quota exceeded
5. **Adjust Model Based on Task** - GPT-3.5 for simple, GPT-4 for complex

## Security

⚠️ **NEVER commit API keys to git**

- Always use GitHub Secrets
- `.env` is in `.gitignore` - don't remove it
- Don't log API keys in console output
- Rotate keys periodically

## Questions?

- OpenAI API: [platform.openai.com/docs](https://platform.openai.com/docs)
- GitHub Secrets: [docs.github.com/actions/security-guides/encrypted-secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- Playwright Auth: [playwright.dev/docs/auth](https://playwright.dev/docs/auth)
