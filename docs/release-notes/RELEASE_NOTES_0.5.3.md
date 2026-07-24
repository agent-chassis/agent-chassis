# AgentChassis 0.5.3

_Released 2026-07-23_

This release activates the managed implementation-worker contract end to end: a confined worker now gets a real command tool inside its scope, reviewers read the whole repository, and ratified decisions are protected at the kernel — all over a single self-cleaning MCP transport. The six workspace packages are bumped `0.5.2 → 0.5.3`, with cross-package pins moved to `^0.5.3`: `@agent-chassis/agent-launch-cli`, `@agent-chassis/agent-launch-core`, `@agent-chassis/core`, `@agent-chassis/wiki-cli`, `@agent-chassis/wiki-core`, `@agent-chassis/wiki-mcp`.

## Highlights

- **Managed workers can run real commands.** A confined worker now gets its family's command tool — `exec_command` for Codex, `Bash` for Claude — with no interactive approval, so it can build, generate, format, and test inside its assigned scope. There is no read-only command classifier or allowlist to fight: bubblewrap is the filesystem boundary, so a command still cannot see or mutate anything outside the task's frozen `read ∪ write` namespace. This replaces the earlier inspection-only shell.
- **Reviewers and red-team roles read the whole repository.** Findings roles now get read-only visibility of the entire repo — the same read scope an orchestrator has — instead of just the unit under review. A review is grounded in the canonical decisions, durable docs, and sibling implementation/test code it actually needs, not a narrowed slice. It stays a read-only posture: no write, commit, dispatch, or lifecycle authority.
- **Ratified decisions are protected at the kernel.** Every enforced sandbox reimposes `wiki/decisions/` read-only as the final mount overlay, so no worker — whatever a coordinator wrote into its `write_scope` — can author or overwrite an accepted decision. Ratifying a decision stays a human/operator act through the CLI, and legitimate coordination writes elsewhere under `wiki/` are unaffected.
- **Simpler, self-cleaning MCP transport for confined roles.** Each confined launch connects to one launcher-owned host wiki-MCP process over a private named-FIFO stdio conduit — no broker, socket service, background daemon, or in-sandbox MCP runtime. Teardown reaps the server and its relay deterministically in both directions, so runs don't strand helper processes. The launcher CLI now installs only the `agent-launch` command.
- **Codex and Claude are the supported families.** Agy is now explicitly unsupported and fails closed before any model, repository write, runtime-state, or transport setup, rather than launching with unfinished runtime-state exposure.

## Upgrading

Upgrade the whole `@agent-chassis/*` set to `0.5.3` together — the packages import each other and mixed versions are unsupported. Installing `@agent-chassis/core` pulls the set in at aligned `^0.5.3`.

## Fixed

- A write mis-scoped into `wiki/decisions/` now returns one clear typed dispatch refusal up front, instead of failing mid-run with a confusing `EROFS`; the kernel read-only overlay remains as the backstop beneath it.
- Confined runs no longer strand orphaned host MCP helper processes: the host wiki-MCP server and its relay are reaped deterministically on normal exit, launch refusal, readiness failure, timeout, or an interrupt signal.
- Reviewer and red-team runs no longer derive read scope from the reviewed unit, which previously hid canonical decisions and sibling code from findings roles.
- Whole-repository findings reads from a launcher-created linked review checkout now resolve that checkout's own Git metadata read-only, so a reviewer reading history no longer fails on a linked-worktree gitdir.

Internal module refactors; public import surfaces preserved.

## Package versions

All at `0.5.3`: `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, `@agent-chassis/core`.
