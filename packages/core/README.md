# AgentChassis

[![npm version](https://img.shields.io/npm/v/@agent-chassis/core)](https://www.npmjs.com/package/@agent-chassis/core)
[![Node.js 24.20.0 or newer](https://img.shields.io/badge/Node.js-24.20.0%2B-339933)](docs/package-install.md#runtime-prerequisite)
[![License: Elastic 2.0](https://img.shields.io/badge/License-Elastic_2.0-blue)](LICENSE)

AgentChassis is a local orchestration system for building and maintaining
complex software with coding agents. It coordinates planning, parallel
implementation, verification and delivery while enforcing each agent’s
permissions. Mix Codex, Claude Code, OpenCode and Antigravity, with shared work records
that preserve decisions, results and progress across sessions.

## Install

Requires Node.js 24.20+, npm, Git 2.40+, and Linux with
[bubblewrap](docs/quickstart.md#sandbox-prerequisite-bubblewrap).
Install and authenticate your preferred coding agent first.

From your repository root:

```bash
npm install --save-dev @agent-chassis/core
npx agent-chassis setup
```

Setup selects the only detected CLI or prompts when several are installed.

Complete the instructions printed by setup, then start your first session:

```bash
npx agent-launch orchestrator IN-0001
```

Describe what you want to build or change.

[Setup and configuration](docs/quickstart.md) ·
[Resume existing work](docs/agent-launch-operator-entrypoints.md#operator-orchestrator-entrypoints) ·
[Troubleshooting](docs/local-test-runtime-setup.md)

## What you get

- **Your choice of agent, anytime:** Use Codex, Claude Code, OpenCode or Antigravity—or
  mix them. Committed work records capture what was done, why it was done and
  what’s in progress. New agents can pick up existing work or reconstruct
  months-old work with a search.

- **Agent boundaries are enforced:** The system assigns tool access by role and
  file access by task. The tool server and operating system enforce those limits.

- **Work in parallel without overwriting each other’s edits:** Separate Git
  worktrees keep each assignment’s changes isolated.

- **Write tests that enforce your requirements:** Agents use a library of
  reusable specifications to build tests that prove specific behaviors, such as
  idempotency, ordering and failure recovery.

- **17 tools define the entire workflow:** Project knowledge, assignments,
  verification, execution and delivery share one small toolset.

## Private beta

- **Organizational rules enforced across agent work:** The system checks proposed
  actions against configured policy and blocks actions that policy does not permit.

- **Enforced specifications:** Required specifications must pass compilation and
  completeness checks before implementation can start.

- **Integrated code index for JavaScript, Python and more:** Agents can follow
  definitions, references and dependencies to understand how your system fits
  together without relying on text searches.

[Request beta access](https://forms.gle/YBJc1TnxoEPea3kx6).

## Learn more

- Explore workflow tools: [operation reference](docs/mcp-operation-reference.md).
- Configure agents and models: [role defaults](docs/quickstart.md#6-configure-role-launch-defaults)
  and [agent requirements](docs/agent-launch-family-runtime-state.md#per-family-runtime-state).
- Launch or resume work: [operator commands](docs/agent-launch-operator-entrypoints.md#operator-orchestrator-entrypoints).
- Understand permissions and test execution: [permissions](docs/enforcement-model.md)
  and [test execution](docs/test-proof-execution.md#host-execution).
- Browse all documentation: [documentation index](docs/index.md).

Agents start with [the agent guide](docs/README-agents.md).

Source-available under the [Elastic License 2.0](LICENSE).
