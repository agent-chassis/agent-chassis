# MCP Tool Registry Reference

Navigation reference for the live MCP tool and resource registry used by
[MCP integration](mcp-integration.md). This page deliberately contains no
hand-maintained `full`, `agent-safe`, or equivalent exhaustive operation list.

## Available MCP Tools

Availability is a runtime fact, not a documentation inventory. Registration,
launcher-minted role and tier visibility, installation, and runtime posture can
all change the set visible to one session.

Use the two discovery layers for different questions:

| Question | Authoritative live surface |
| --- | --- |
| Which repository-local tools are visible and supported for this session, and what authority, side effects, support posture, documentation, and advertised inputs help select one? | `workspace_tools_list`, `workspace_tools_describe`, and `workspace_tools_query`; see [Tool discovery surfaces](tool-discovery-surfaces.md) |
| What exact request object does a registered MCP tool accept now? | MCP protocol `tools/list`, using that tool's live `inputSchema`; see [Tool input schema publication](mcp-integration.md#tool-input-schema-publication) |

The repository-local descriptor projection is selection metadata. It does not
own, replace, or certify `tools/list` schema publication. Conversely,
`tools/list` publishes registered protocol signatures but does not replace the
repository-local authority, side-effect, support, and documentation guidance.

For a complete role-visible catalog, page `workspace_tools_list` with unchanged
filters until `has_more` is false, as required by decision. Use targeted
describe or query calls for detail, then re-read the selected name in
`tools/list` before invocation. If a name is absent from the current live
registry, prose elsewhere does not make it callable.

Profiles are routing and context-shaping projections, not security
classifications. They do not independently establish least privilege,
confidentiality, or an enforcement boundary. Tool exposure and launcher-minted
role/tier facts remain runtime-owned; authority is consumed and never minted by
this reference.

Stable behavior belongs to focused durable contracts rather than the catalog.
Start with [MCP Operation Reference](mcp-operation-reference.md) for operation
families, [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) for
dispatch and recovery navigation,
[Controlled-contract operations](mcp-controlled-contract-operations.md) for
controlled authoring, and [MCP repository model](mcp-repository-model.md) for
bounded content retrieval.

`workspace_work_record_edit` is an orchestrator/operator-only, write-capable
selection entry. Its live `tools/list` schema is mechanically built from
`WORK_RECORD_EDIT_FIELD_REGISTRY`; the complete field/action/scope/value/owner
projection and refusal contract are in [Bounded ordinary authored-field
editor](mcp-operation-reference.md#bounded-ordinary-authored-field-editor).
Reviewer, worker, and redteam sessions are denied by
`session-role-tool-access.json`. The older list-field and task tools remain
registered compatibility adapters; no scalar setter or CLI-equivalent general
editor is registered.

## Available MCP Resources

Use MCP protocol `resources/list` for the live resource population and
`resources/read` for the selected resource. This reference does not snapshot
resource URIs because registration and exposure are runtime-dependent.

Shared contract resources describe the packaged contract and templates; they do
not transfer ownership of consumer-maintained files. In particular,
`sync_contract` must not clobber consumer-owned `wiki/schema.md`,
`wiki/conventions.md`, or `wiki/index.md`. Those files are locally owned once
present, and shared tooling only bootstraps them when missing.
