# AgentChassis 0.4.3

All publishable `@agent-chassis/*` packages bump `0.4.2` to `0.4.3`; internal dependency ranges were updated to match.

## New Features

### Headless Orchestrator Mode

`orchestrator --headless` runs the orchestrator to completion non-interactively. Use `--log-file <path>` to redirect output. Headless launch requires bubblewrap isolation and refuses under DEC-0060 direct mode.

### Worker Commit Tool and Automatic Worktrees

Worker dispatch now provisions a dedicated git worktree using the new `WIKI_MCP_DISPATCH_WORKTREE_ROOT` contract. Worktrees are reaped when the unit completes, is cancelled, or by operator direction.

A new worker commit tool delivers changes from the provisioned worktree. It accepts only an empty input object: the launcher supplies git identity, branch, base commit, and write scope out of band. Caller-supplied branch, path, message, identity, write scope, and binding fields are refused. The tool commits the provisioned worktree, verifies the result stays within assigned write scope, advances the work-record branch ref, and moves the unit to review. Commit messages are server-generated.

### Tool-Discovery Corpus Expanded 82 to 87

- `workspace_tool_router_recommend`: recommends the first tool to call for a task, backed by `tool-routing-intents.v1.json` and the new tool-router operation.
- `workspace_integration_status`: reports local integration coordination status.
- `workspace_integration_promote_check`: checks readiness to promote work into the integration branch.
- `workspace_tool_usage_audit`: compact telemetry for agent tool usage, with historical extraction, live recording, aggregation, and redaction.
- `workspace_initiative_status`: already served in 0.4.2, now also listed in the tool-discovery manifest.

### Delivery Envelopes

Work records and org policy can now declare expected delivery metrics, including changed lines/files and scope counts, with per-metric tolerances.

## Behavior Changes

### Worker wiki-mcp Profile Slimmed to Commit

The worker MCP profile previously exposed roughly 22 read/validate tools. It now exposes only the worker commit tool. Workers still use native file/edit/search tools inside the sandboxed worktree; only the MCP surface changed.

### Large-Record Reads Are Compact-First

Verbose/full reads on large tracker records now require the compact-first flow and usually a selected slice or unit. Compact reads are unaffected. Short-lived, source-bound `compact_read_token` values support bounded continuation, but they do not authorize dumping an unselected full tracker.

## Improvements

- Blocked dispatches and refusals now return more actionable next-step guidance, including accepted subjects, authorized targets, retry hints, and broader structured validation diagnostics.
- Agent-safe tool exposure is now derived from checked-in tool descriptors instead of a hand-maintained list.
- Setup no longer auto-creates guidance placeholder files; operators adapt the provided `AGENTS.md` boilerplate manually.
- Documentation was updated across MCP integration, dispatch runtime contracts, tool discovery, adoption, quickstart, provenance, and initiative status.

## Internal Refactors

- Large `codex-role` and `codex-worker-plan` modules were split into focused support modules for orchestration runtime, sidecar dispatch, read-only handling, reasoning effort, sandbox args, sandbox fail-open detection, and worker-plan refusals.
- The MCP server's inline review-result-evidence route was extracted into its own module.
- Tool discovery was reorganized into per-domain fragments for integration, MCP coordination, MCP launcher, MCP work-record, and tool-usage audit surfaces.
- Much of this is extraction of existing logic into focused modules; user-visible behavior changes are called out above.
