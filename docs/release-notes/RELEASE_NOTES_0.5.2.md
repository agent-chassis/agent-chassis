# AgentChassis 0.5.2

_Released 2026-07-21_

This release closes the managed-worker loop end to end: an implementation slice now flows commit → exact-SHA review → automatic integration → findings-only whole-WK review, and a completed WK can be handed off to a Git forge as a pull request — with dispatch-readiness that repairs its own graph evidence instead of blocking on it.

The six workspace packages are bumped `0.5.1 → 0.5.2`, with cross-package pins moved to `^0.5.2`: `@agent-chassis/agent-launch-cli`, `@agent-chassis/agent-launch-core`, `@agent-chassis/core`, `@agent-chassis/wiki-cli`, `@agent-chassis/wiki-core`, `@agent-chassis/wiki-mcp`.

## Highlights

- **Land completed work to a Git forge.** A new orchestrator/operator MCP tool, `workspace_wk_forge_handoff`, takes a terminal WK and publishes it as one deterministic squash commit on a forge branch, then opens or recovers exactly one pull request against your configured landing branch (via `gh`, run host-side so credentials never touch the wire). Review, checks, and merge stay with the forge. You get one of four typed outcomes — `no_changes`, `handed_off`, `human_action_required`, or `human_reconciliation_required` — and an already-published branch or PR is recovered, never duplicated.
- **Automatic exact-slice review lifecycle.** Commit a slice and it is frozen at its exact SHA, reviewed, and integrated into the WK automatically — no manual integrate step — followed by a findings-only review of the frozen whole-WK context. On paid/CCE, integration requires exact review proof; on free/local, review stays mandatory policy but does not park progress. `changes_requested` findings are folded into the next same-slice worker prompt as corrective context, never as new authority.
- **Dispatch-readiness repairs its own graph evidence.** When required graph-impact evidence is stale or missing, `workspace_validate_dispatch` and worker dispatch now rebuild the current-HEAD code-index graph automatically (writing only ignored cache artifacts and a bounded set of lock/candidate files) instead of refusing and demanding a separate refresh step. Concurrent readiness checks coalesce in-process to avoid redundant rebuilds.
- **Dirty working trees no longer block dispatch.** The graph baseline is derived from the current committed HEAD, so a dirty tree — or a graph anchored to an older commit — is rebuilt at HEAD rather than producing spurious `rebuild_required` / `artifact_missing` / `unknown_state` blockers. A valid dirty-worktree overlay is optional enrichment; only a genuinely unbuildable current-HEAD baseline still refuses.
- **Node Engine is the sole admissibility authority.** Readiness forwards the measured facts (scoped LOC, breadth, blast radius, cluster count) and the configured Node Engine returns the admit / review / reject verdict; the local layer renders no threshold judgment of its own. On a free/local install admissibility is inert and those facts remain advisory evidence; on paid/CCE the readiness envelope carries the Node-Engine verdict and recovery.

## Upgrading

Upgrade the whole `@agent-chassis/*` set to `0.5.2` together — the packages import each other and mixed versions are unsupported. Installing `@agent-chassis/core` pulls the set in at aligned `^0.5.2`.

## Fixed

- Stale, dirty, older-base, and "rebuild required" graph states no longer block a dispatch that is otherwise ready; they rebuild at current HEAD automatically, and worker dispatch no longer fails closed just because a separate graph-persistence tool is absent.
- Exact-slice review state now survives a backend or MCP restart: in-flight review receipts and their acceptance proof are recovered from durable, lock-guarded state rather than dropped or silently re-derived.
- Superseded by work record: confined roles now use the launcher-owned host wiki-MCP server and named-FIFO stdio conduit with typed construction, readiness, and cleanup blockers.
- The initiative-status "admission evidence" nudge now points at read-only `workspace_validate_dispatch`, matching the self-refreshing flow, so there is no separate manual metrics-refresh step to run before dispatch.

Internal module refactors; public import surfaces preserved.

## Package versions

All at `0.5.2`: `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, `@agent-chassis/core`.
