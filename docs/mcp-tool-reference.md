
# MCP Tool And Operation Reference

This page is the MCP reference surface for `agent-chassis`: the per-operation reference pointer, dispatch identity and bootstrap review, the runtime blocker taxonomy and coordination preflight, the agent-facing MCP tool and resource profiles, and code index interface parity. It is reference material split out of [docs/mcp-integration.md](mcp-integration.md); start there for setup and the workflow narrative.

## Operation Reference

The full per-operation reference is
[docs/mcp-operation-reference.md](mcp-operation-reference.md): every MCP tool
and CLI fallback, contract-edit compact/verbose/stale-source/validate-before-write
behavior, and graph-impact compact-default and verbose opt-in contract.
[docs/mcp-integration.md](mcp-integration.md) stays the MCP setup and
mental-model entry point.

## Dispatch Identity And Bootstrap Review

[Detailed dispatch identity, bootstrap review, run-status, launcher-owned host wiki-MCP conduit, and caller/session identity contract.](mcp-dispatch-runtime-contract.md)
### workspace_agent_dispatch And workspace_agent_run_status

[Detailed dispatch and monitor contract.](mcp-dispatch-runtime-contract.md#launch-and-monitoring)

In the free/local tier, `workspace_agent_run_wait` and `workspace_agent_run_status`
may report terminal success while `structured_role_result.valid:false`, because
`decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting.
That is expected, non-attesting state — not a failed child run, a failed dispatch,
or missing findings. A schema-valid structured role result is a CCE capability
enabled only by a configured CCE key.

Tool discovery, MCP registration, live tool descriptions, the agent FAQ, and
mixed-route default output are **tier-projected** by the registered CCE/Node Engine
key posture. Free/local registrations see only source-available coordination tools
and explanations; CCE policy, admission, attestation, diagnostics,
graph-impact/blast-radius, and recovery detail are exposed only after a canonical
CCE-key posture is positively resolved. The registered tier is resolved from the
canonical key posture (`decision`/`decision`/`decision`), never from caller input.
See [docs/tool-discovery.md](tool-discovery.md) "Registered-Tier Exposure And
Projection".
### Launcher-Owned Host Wiki-MCP Conduit

[Detailed host-server and named-FIFO stdio conduit contract.](mcp-integration.md#transport)
### Caller/Session Identity

[Detailed caller/session identity contract.](mcp-dispatch-runtime-contract.md#launch-and-monitoring)
## Runtime Blocker Taxonomy And Coordination Preflight

[Detailed runtime blocker and fail-closed launch contract.](mcp-dispatch-runtime-contract.md#trusted-operation-ownership)
### MCP Tools

[Runtime blocker/preflight MCP tool details.](mcp-operation-reference.md)
## Available MCP Tools

[Agent-facing MCP tool profile lists.](mcp-tool-registry-reference.md#available-mcp-tools)
## Available MCP Resources

[Agent-facing MCP resources reference.](mcp-tool-registry-reference.md#available-mcp-resources)

## Code Index Interface Parity

Repo code index MCP tools must expose machine-readable result data in `structuredContent`. The equivalent CLI `code-index` surface must expose the same data as JSON through a stable `--json` mode. The older `sidecar` CLI and MCP tool names remain compatibility aliases in the full tool profile.

Repo code index parity comparisons require both MCP and CLI JSON results to
carry the same trust-envelope fields, including `schema_version`, `source_kind`,
`canonicality`, `evidence_basis`, `index_head`, `index_tree`, `dirty_state`,
`dirty_details`, `staleness`, canonical references, and derived evidence.

SCIP symbol navigation parity is exposed through CLI `wiki code-index
find-references --json` / `wiki code-index definition --json` and MCP
`workspace_code_index_find_references` / `workspace_code_index_definition`.
Those tools return derived, non-canonical SCIP evidence only: provider
descriptor(s), coverage, freshness/dirty-worktree state, and per-result
`resolution.state` remain part of the machine-readable envelope. When the SCIP
overlay is absent or degraded, the tools report the unavailable SCIP state
explicitly instead of returning an empty complete-looking answer.
