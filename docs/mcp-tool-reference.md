
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
### Start And Observe

`start_agent` starts authorized work; `get_run_result` observes the returned
subject/attempt or reads an authenticated original. Follow producer-returned
references for details. Review text is advisory evidence even when formal
attestation is unavailable; missing attestation does not authorize a rerun.

Tool discovery, MCP registration, live tool descriptions, the agent FAQ, and
mixed-route default output are **tier-projected** by the registered CCE/Node Engine
key posture. Free/local registrations see only source-available coordination tools
and explanations; CCE policy, admission, attestation, diagnostics,
graph-impact/blast-radius, and recovery detail are exposed only after a canonical
CCE-key posture is positively resolved. The registered tier is resolved from the
canonical key posture (`decision`/`decision`/`decision`), never from caller input.
See [docs/tool-discovery-tiers.md](tool-discovery-tiers.md) "Registered-Tier
Exposure And Projection".
### Launcher-Owned Host Wiki-MCP Conduit

[Detailed host-server and local socket stdio conduit contract.](mcp-integration.md#transport)
### Caller/Session Identity

[Detailed caller/session identity contract.](mcp-dispatch-runtime-contract.md#launch-and-monitoring)
## Runtime Blocker Taxonomy And Coordination Preflight

[Detailed runtime blocker and fail-closed launch contract.](mcp-dispatch-runtime-contract.md#trusted-operation-ownership)
### MCP Tools

[Runtime blocker/preflight MCP tool details.](mcp-operation-reference.md)
## Tool Declarations And Input Contracts

Every agent session receives the full `tools/list` payload, so each declaration
must remain within the enforced per-tool byte budget. The current task tools publish ordinary request fields and supported selector alternatives.

The registration boundary validates the complete `inputSchema` on every call.
Unknown fields and malformed nested values are rejected before the handler.
An `advertisedInputSchema`, when present, is only a compact discovery
projection; it never admits input. `workspace_read_wiki` returns selected authoring input contracts from the saved unit or record-kind reference.

A registration may also declare a `publishedInputSchemaProjection`: a pure
JSON Schema rewrite of what the SDK converts from the schema it publishes. The
registrar lists the projected schema in `tools/list` and retains it as that
tool's published request schema, so both state one declaration. The projection
is declaration-only, like the schema it rewrites: it admits and refuses
nothing, and the complete `inputSchema` still validates every call. It exists
for equivalent forms the SDK conversion cannot state; an intersection member
loses `additionalProperties: false` there. `save_record` uses it to publish
each keyed row as one closed object of the row's shared members joined with
its new-row and existing-row identity alternatives, each keeping its own
required members and forbidding the other identity. A registrar created after
its server installed `tools/list` refuses a projected registration.

Contract-level requirements and controlled-acceptance applicability are authored
through `save_record`; saved projections use `workspace_read_wiki`, and
`workspace_assess_contract` reports contract problems.
Removed response-kind payloads and construction-session shapes are not accepted
or translated.

Structural projections report whether their constraint coverage is exact or
partial. Unprojected refinements are named with their request path and reason.
The shared request-constraint vocabulary remains the owner for declared byte,
field-combination, and selector rules.

## Available MCP Tools

[Agent-facing MCP tool profile lists.](mcp-tool-registry-reference.md#available-mcp-tools)
## Available MCP Resources

[Agent-facing MCP resources reference.](mcp-tool-registry-reference.md#available-mcp-resources)

## Code Index Interface Parity

Repo code index MCP tools must expose machine-readable result data in `structuredContent`. The equivalent CLI `code-index` surface must expose the same data as JSON through a stable `--json` mode. The retired `sidecar_*` and `workspace_sidecar_*` MCP names and the `impact-paths`, `graph-impact-paths`, and `graph-impact-diff` CLI commands are not registered.

Repo code index parity comparisons require both MCP and CLI JSON results to
carry the same trust-envelope fields, including `schema_version`, `source_kind`,
`canonicality`, `evidence_basis`, `index_head`, `index_tree`, `dirty_state`,
`dirty_details`, `staleness`, canonical references, and derived evidence.

Query parity is exposed through CLI `wiki code-index context-for-path`,
`impact`, `find-references`, `definition`, `callers`, and `callees` with
`--json`, and the MCP `query_code_index` route, whose retained complete
answer for each question is the same envelope.
Those tools return derived, non-canonical SCIP evidence only: provider
descriptor(s), coverage, freshness/dirty-worktree state, and per-result
`resolution.state` remain part of the machine-readable envelope. When the SCIP
overlay is absent or degraded, the tools report the unavailable SCIP state
explicitly instead of returning an empty complete-looking answer.

## Request Selection And Recovery

`get_run_result` publishes exclusive request alternatives derived from its owner
schemas, sharing field definitions once. Its object-root declaration places the
alternatives beneath `not: { not: { anyOf: [...] } }`, preserving their JSON
Schema meaning without a root `anyOf`, `oneOf`, or `allOf`. Native Gemini 3.8
Flash worker/reviewer fixtures through OpenCode 1.19.3 demonstrate acceptance by
the installed Google Vertex SDK and provider.
The strict runtime union, request forms,
authorization and handler remain unchanged; provider acceptance does not replace
server validation. Observation uses `subject` with optional
`attempt_id` and `timeout_ms`; assignment observation uses `assigned:true`.
Retained reads use a returned `result`; recorded verification reads use the
returned invocation with either the worker assignment or the coordinator's exact
subject and attempt. Coordinator inventory and outcome selections publish their
specific `detail.member` values. The serving role and producer enforce access.

One common declaration projection runs after each task tool's existing
publication logic. Boolean literals retain their type and value through negation
of the opposite constant; repeated simple constraints share local references
when that reduces declaration size, keeping boolean types inline at every use.
Existing references, required fields,
selector combinations, closed objects and annotations retain their meaning.
Boolean schema nodes and example/default instance data are not rewritten.
The registrar retains the exact served declaration. Strict server validators
still reject `false` and string `"true"` where a true literal is required,
before handlers or their effects; provider acceptance does not replace this
enforcement. No family adapter rewrites tool schemas.

Rejected fields require an explicit caller choice about their intended meaning.
Schema-valid removal alone cannot authorize a corrected execution. Owner-authored
recovery calls remain available when the owner can establish the correction.

Retained ordinary test reads follow `next_view` in forward order and finish
without wrapping to the first view. `next_failed_result` selects additional
failure detail. Unattempted streams, empty capture and truncated content remain
distinct; retained views never rerun the test.

Code queries use one-based lines and zero-based characters. Use exact returned
SCIP symbols unchanged; a symbol may accompany a path only for a document-local
symbol. Empty `paths`, `patchText` or `diffRecords` explicitly select no changes;
`liveGit:false` alone selects nothing. The navigation and impact owners validate
these meanings.

`workspace_advance_candidate` updates a stale candidate to the observed workspace
base. Its `version` is the exact `version_identity` from
`workspace_inspect_candidate`. Review the resulting candidate before using
`workspace_publish_work` to hand the current selection to the configured hosted
pull request or local/Git destination. Publication does not merge or complete work.

The operator `agent-launch review <unit>` command uses the canonical unit-address
parser: a WK such as `WK-0001` or a slice such as `WK-0001#SLICE-001` reaches the
same authorized reviewer dispatch. Invalid addresses receive address diagnostics
before dispatch. Address syntax confers no review authorization.
