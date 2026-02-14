# Contributing to Companion

Thank you for your interest in contributing to Companion!

## Agent Workflow

This project uses an **agent coordination workflow** where GitHub Copilot and Codex-style agents collaborate on tasks.

### Getting Started

1. **Pick a task** from [docs/agent-backlog.md](docs/agent-backlog.md) or create a new issue using the [Copilot Agent Task template](.github/ISSUE_TEMPLATE/copilot-agent-task.yml)

2. **Create a branch** following the naming convention:
   ```bash
   git checkout -b agent/<issue-number>-<short-description>
   ```

3. **Make your changes** following the acceptance criteria in the issue

4. **Verify your work** by running the commands specified in the issue's verification section:
   ```bash
   npm run typecheck
   npm run build
   npm test  # when tests are available
   ```

5. **Commit with descriptive messages**:
   ```bash
   git add .
   git commit -m "feat: add feature X
   
   - Implements acceptance criterion 1
   - Implements acceptance criterion 2
   
   Closes #<issue-number>"
   ```

6. **Push and create a PR**:
   ```bash
   git push origin agent/<issue-number>-<short-description>
   ```
   
   Then create a PR using the template and add the `agent-task` label.

## PR Guidelines

- Use the PR template provided
- Reference the issue number with "Closes #X"
- Include verification output showing tests/checks passed
- Add `agent-task` label for automation
- Add `agent-automerge` label if the PR should auto-merge after checks pass

## Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Questions?

Refer to [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed workflow guidance.
