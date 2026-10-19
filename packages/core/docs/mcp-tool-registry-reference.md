# MCP Tool Registry Reference

Navigation reference for the live MCP tool and resource registry used by
[MCP integration](mcp-integration.md). This page deliberately contains no
hand-maintained per-role or equivalent exhaustive operation list.

## Available MCP Tools

Availability is a runtime fact, not a documentation inventory. Registration,
launcher-minted role and tier visibility, installation, and runtime posture can
all change the set visible to one session.

Use the live MCP `tools/list` declaration for the registered request contract.
For intent-specific discovery, use the [task surfaces](tool-discovery-surfaces.md):
`workspace_read_wiki` for canonical material, search and selected authoring
contracts, `workspace_find_proofs` for proof discovery, and
`start_agent` previews for capability or selected-action assessment. Follow
producer-returned references and next calls unchanged. Session role and tier
grants still apply; retained registrar code does not make a route callable.

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

Saved contract and requirement reads use `workspace_read_wiki`; authoring uses
`save_record` with the saved unit's selected input contract. Explicit assessment
uses `workspace_assess_contract`, and proof execution uses `verify_proof` within
its role grants. `workspace_tools_list`, `workspace_tools_describe` and the old
scalar/editor endpoints are not registered public routes.

## Available MCP Resources

Use MCP protocol `resources/list` for the live resource population and
`resources/read` for the selected resource. This reference does not snapshot
resource URIs because registration and exposure are runtime-dependent.

Shared contract resources describe the packaged contract and templates; they do
not transfer ownership of consumer-maintained files. In particular,
`sync_contract` must not clobber consumer-owned `wiki/schema.md`,
`wiki/conventions.md`, or `wiki/index.md`. Those files are locally owned once
present, and shared tooling only bootstraps them when missing.
