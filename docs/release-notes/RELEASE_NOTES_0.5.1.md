# AgentChassis 0.5.1

_Released 2026-07-17_

This release advances the **managed implementation-worker slice lifecycle** (Phase 1, local single-repository): implementation workers run filesystem-confined, deliver work only through a closed-input `commit` capability, and the trusted host runtime performs the commit, integrates the slice into its work record, and freezes a whole-WK context for findings-only review.

The six workspace packages are bumped `0.5.0 → 0.5.1`, with cross-package pins moved to `^0.5.1`: `@agent-chassis/agent-launch-cli`, `@agent-chassis/agent-launch-core`, `@agent-chassis/core`, `@agent-chassis/wiki-cli`, `@agent-chassis/wiki-core`, `@agent-chassis/wiki-mcp`.

> **Staged.** The Phase 1 managed-worker confinement and its worker tool profile are wired and documented but should not be treated as active until the production confinement composition is installed.

## Highlights

- **Managed worker slice lifecycle (Phase 1, local single-repository).** Confined workers → closed-input commit → trusted-side slice integration → frozen whole-WK findings-only review → return to the orchestrator for disposition. No automatic Git mutation or promotion to `main`.
- **Host-write-authority broker** gains three managed, idempotent write operations — `provision_worktree`, `commit_slice`, `integrate_slice` — so writes the read-only orchestrator/worker namespaces cannot perform run trusted-side.
- **Two new MCP tools** (orchestrator/operator only): `workspace_work_record_ready_slice` and `assign_work_record_to_initiative`.
- **Fail-closed launch path:** frozen scope/admission carriers are re-validated before a worker spawns, dispatch input is strict, and caller-supplied authority is refused.
- **Test-case target resolution rewritten onto a real AST (tree-sitter)**, resolving only explicit static bindings and failing closed to degraded evidence on ambiguous input.

## Upgrading

Upgrade the whole `@agent-chassis/*` set to `0.5.1` together — the packages import each other and mixed versions are unsupported. Installing `@agent-chassis/core` pulls the set in at aligned `^0.5.1`.

## Fixed

- Managed worktree provisioning and slice integration now succeed under the read-only namespace (previously failed against read-only `.git`), with exactly-once, fail-loud integration.
- The managed worker's wiki-MCP delivery surface now starts (previously unreachable).
- Reviewer/redteam sessions are no longer mis-stamped with the `worker` tool profile.
- Closed a persisted-form drift window: work-record writes now re-verify both source and canonical-form digests under the write lock, and admission sidecars are published atomically (no orphaned/partial artifacts).
- Repeat initiative assignment and unchanged ready-slice writes are true no-ops (no digest churn).

## Security

- **Reduced worker trust surface.** Managed workers lose `workspace_submit_for_review`, retain only the closed-input `commit`, are confined to `read_scope ∪ repo_paths ∪ write_scope` with no `.git` binds, and may not fall back to an unisolated spawn.
- **Anti-forgery refusals.** Callers may not pre-seed `WIKI_MCP_COMMIT_*` credentials or supply scope/authority/provisioning state, and dispatch refuses caller-supplied Node Engine authority fields.
- **Removed the mechanical per-dispatch large-file / accepted-authority acceptance mechanism.** Residual bootstrap risks are now an explicit operator-accepted posture under prompt governance rather than a per-dispatch gate.

## Package versions

All at `0.5.1`: `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, `@agent-chassis/core`.
