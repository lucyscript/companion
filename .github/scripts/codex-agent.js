#!/usr/bin/env node

/**
 * Codex CLI Agent
 * 
 * Uses the @openai/codex CLI to work on issues.
 * This is the primary agent mode - most integrated and reliable.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const ISSUE_NUMBER = process.env.ISSUE_NUMBER || '';
const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_SCOPE = process.env.ISSUE_SCOPE || '';
const ISSUE_DELIVERABLE = process.env.ISSUE_DELIVERABLE || '';

console.log('🚀 Codex CLI Agent Started');
console.log(`📋 Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}`);

/**
 * Check if Codex CLI is installed
 */
function isCodexInstalled() {
  try {
    execSync('which codex', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if Codex is authenticated
 */
function isCodexAuthenticated() {
  try {
    // Try to run a simple codex command
    execSync('codex --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Build prompt for Codex
 */
function buildCodexPrompt(issue) {
  return `I need your help with a GitHub issue.

**Issue #${issue.number}: ${issue.title}**

${issue.body}

**Scope:**
${issue.scope}

**Deliverable:**
${issue.deliverable}

Please:
1. Analyze the codebase to understand the context
2. Implement the changes needed to address this issue
3. Follow existing code patterns and conventions
4. Add appropriate tests if applicable
5. Ensure code is production-ready

When you're done, summarize what you changed.`;
}

/**
 * Run Codex CLI in interactive mode
 */
async function runCodex(prompt) {
  console.log('🤖 Launching Codex CLI...');
  
  return new Promise((resolve, reject) => {
    // Create temporary file with prompt
    const promptFile = path.join(process.cwd(), '.codex-prompt.txt');
    fs.writeFileSync(promptFile, prompt);
    
    try {
      // Run codex with the prompt
      // Using --execute-commands flag to let it make changes
      const result = execSync(
        `codex --execute-commands --input "${promptFile}"`,
        {
          encoding: 'utf-8',
          cwd: process.cwd(),
          timeout: 300000, // 5 minute timeout
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }
      );
      
      // Clean up prompt file
      fs.unlinkSync(promptFile);
      
      console.log('✅ Codex completed successfully');
      console.log('📝 Codex output:');
      console.log(result);
      
      resolve({
        success: true,
        output: result
      });
      
    } catch (error) {
      // Clean up prompt file
      if (fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }
      
      console.log('❌ Codex execution error:', error.message);
      reject(error);
    }
  });
}

/**
 * Alternative: Run Codex in cloud mode
 */
async function runCodexCloud(prompt) {
  console.log('☁️  Running Codex in cloud mode...');
  
  try {
    // Run codex with cloud flag
    const result = execSync(
      `echo "${prompt.replace(/"/g, '\\"')}" | codex --cloud --execute-commands`,
      {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    
    console.log('✅ Codex cloud execution completed');
    console.log('📝 Output:', result);
    
    return {
      success: true,
      output: result
    };
    
  } catch (error) {
    console.log('❌ Codex cloud error:', error.message);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Check if Codex is installed
    if (!isCodexInstalled()) {
      console.log('⚠️  Codex CLI not installed');
      console.log('   Install: npm i -g @openai/codex');
      process.exit(1);
    }
    
    console.log('✅ Codex CLI is installed');
    
    // Check authentication
    if (!isCodexAuthenticated()) {
      console.log('⚠️  Codex not authenticated');
      console.log('   Run: codex (and follow authentication prompts)');
      process.exit(1);
    }
    
    console.log('✅ Codex is authenticated');
    
    // Build prompt
    const prompt = buildCodexPrompt({
      number: ISSUE_NUMBER,
      title: ISSUE_TITLE,
      body: ISSUE_BODY,
      scope: ISSUE_SCOPE,
      deliverable: ISSUE_DELIVERABLE
    });
    
    console.log('💬 Sending task to Codex...\n');
    
    // Try cloud mode first (more reliable in CI), fall back to local
    let result;
    try {
      result = await runCodexCloud(prompt);
    } catch (cloudError) {
      console.log('⚠️  Cloud mode failed, trying local mode...');
      result = await runCodex(prompt);
    }
    
    if (result.success) {
      console.log('\n✅ Codex agent completed successfully');
      
      // Check if files were modified
      try {
        const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
        if (gitStatus.trim()) {
          console.log('\n📝 Files modified:');
          console.log(gitStatus);
        } else {
          console.log('\n⚠️  No files were modified');
        }
      } catch (error) {
        console.log('Could not check git status');
      }
    }
    
  } catch (error) {
    console.error('💥 Codex agent error:', error.message);
    process.exit(1);
  }
}

// Run Codex agent
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
