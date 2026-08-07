
# Tool Discovery v1
`workspace_initiative_status` is the adopted compact read-only coordinator
action lens for initiative and unit next-action triage. Discovery should
present it as the next-step surface, not as a pre-adoption or replacement path.
Use summary, validate-dispatch, dispatch, run-status, lint, and setter tools
for the underlying operations they own.

`tool-discovery.v1` is the machine-readable contract for telling agents which
agent-chassis command or MCP function should handle a job. It exists so
agents can choose a tool from structured data instead of guessing from wrapper
filenames, package metadata, executable bits, or historical WK pages.

The assembled corpus is exactly 101 tool entries. The manifest fragment counts
are (17 + 11 + 5 + 2 + 1 + 6 + 7 + 9 + 7 + 18 + 7 + 10 + 1 + 0 = 101); the
checked-in manifest remains the source of truth for both values.

## Canonical document map

This page is the entry point for the `tool-discovery.v1` contract. It carries the
discovery-contract overview, the initial managed implementation-worker discovery
contract, and the ranking, diagnostics, coverage, and adoption rules. The rest of
the normative text lives on four focused canonical pages:

| Page | Sections it owns |
| --- | --- |
| [Tool Discovery Fragment Registry](tool-discovery-fragment-registry.md) | Canonical Fragment Registry; Fragment Layout; Deterministic Fragment Order; Duplicate `tool_name` Handling; Descriptor Digest Semantics; Package Install Expectations |
| [Tool Discovery Surfaces](tool-discovery-surfaces.md) | Discovery Surfaces; CCE Worker-Admission Recovery Projection; Findings-only reviewer validation; Omitted Repo Behavior; Trusted Work-Record Edit Discovery; Schema-Aware Contract/Slice Edit Routes; Non-Completion Review-Result Evidence Discovery |
| [Tool Discovery Registered-Tier Exposure](tool-discovery-tiers.md) | Registered-Tier Exposure And Projection; Registered tiers; Tier resolution is canonical, never caller-asserted; Free/local messaging boundary (decision / decision); CCE projection; Per-tier prose (`tier_text`); Free vs CCE boundary examples; `agent-safe` / `agent-authoritative` are not tier labels; Terminology disambiguation; Free-tier run monitoring under decision |
| [Tool Discovery Schema](tool-discovery-schema.md) | Authority And Trust; Envelope Schema; Freshness; Tool Entry Schema; Routing Metadata Fields; Controlled Task IDs; Status Model (`install_state`, `runtime_posture`, `recommended_route`); Side-Effect And Authority Vocabularies |

Two further contracts were split out earlier and remain canonical on their own
page: [Dispatch Identity And Bootstrap
States](tool-discovery-dispatch-runtime.md#dispatch-identity-and-bootstrap-states)
and [Runtime Blocker Taxonomy And Coordination
Preflight](tool-discovery-dispatch-runtime.md#runtime-blocker-taxonomy-and-coordination-preflight).
Both are summarized below with a pointer to their detailed home.

Quick answers to common lookups:

- *Which MCP route do I call to find a tool?* — [Discovery
  Surfaces](tool-discovery-surfaces.md#discovery-surfaces).
- *What fields does a result entry carry?* — [Tool Entry
  Schema](tool-discovery-schema.md#tool-entry-schema).
- *What does this `task_id` mean?* — [Controlled Task
  IDs](tool-discovery-schema.md#controlled-task-ids).
- *Why is a tool invisible to my registration?* — [Registered-Tier Exposure And
  Projection](tool-discovery-tiers.md#registered-tier-exposure-and-projection).
- *Where does the descriptor data actually live, and how is its digest computed?*
  — [Canonical Fragment
  Registry](tool-discovery-fragment-registry.md#canonical-fragment-registry).
- *How do I edit a work record through discovery-recommended routes?* — [Trusted
  Work-Record Edit
  Discovery](tool-discovery-surfaces.md#trusted-work-record-edit-discovery).

## Initial managed implementation-worker discovery contract

The managed implementation-worker contract is active for confined Claude and
Codex launches whose backend and bubblewrap contracts validate. Discovery,
router, FAQ, and runtime output must describe unsupported families or missing
confinement prerequisites as typed fail-closed states, never as permission to
fall back to a broader launch.

For that contract, let `R` be the normalized union of the canonical unit's
`read_scope` and `repo_paths`, and let `W` be the normalized canonical
`write_scope`. The launcher freezes both sets before launch.
the worker's repository visibility is exactly `R union W`, and repository
mutation is permitted exactly within `W`; a target in `W` is visible without
also appearing in `R`.

Codex `exec_command` and Claude `Bash` are directly authorized without interactive
approval inside the visible `R union W` namespace. Commands may mutate `W`; bwrap,
not command classification, prevents reads or writes elsewhere. The initial implementation-worker profile
exposes no worker validation or general MCP tools, including the discovery
routes documented here. Its sole delivery authority is the closed-input commit
capability in the trusted host/runtime boundary, using the server-resolved
binding without giving the worker repository git metadata or a general commit
shell.

This worker-specific profile does not change the existing reviewer or redteam
launcher-owned validation contracts. In particular, the reviewer/redteam
`node_check` and confined `node_test` operations documented in [Findings-only
reviewer validation](tool-discovery-surfaces.md#findings-only-reviewer-validation)
remain
available when authorized by their own declared validation. Discovery must not
project those findings-only role capabilities into the initial implementation
worker profile.

Every supported family/backend path must preserve the same frozen namespace and
worker tool surface. Unsupported families, backends, scope shapes, or
confinement capabilities fail closed rather than falling back to broader
visibility or mutation. The bootstrap posture retains readable
launcher-provided Codex auth/sourceHome and `shareNet=true` model-API egress as
operator-accepted residual risks under prompt governance; it is not a
digest-bound or per-dispatch mechanical risk-acceptance mechanism.

For each confined Claude or Codex dispatch, the launcher starts exactly one host
wiki-MCP server and creates exactly two private named FIFOs. It binds those two
objects into the final bubblewrap namespace and registers only the pinned
copy-only relay: Claude uses launcher-authored strict MCP configuration; Codex
uses the exact launcher-authored `mcp_servers.wiki` projection. The real client
must complete `initialize` and `tools/list` against the launcher-derived role
profile. Agy is unsupported and fails closed. No caller, prompt, repository/user
configuration, environment, or arbitrary argv can select the server, FIFO, relay,
tool profile, or lifecycle.

This document is the durable operator contract for the discovery schema. The
canonical checked-in registry is the set of JSON fragments under
`packages/wiki-core/data/tool-discovery/`, assembled at load time into one
`tool-discovery.v1` descriptor (see [Canonical Fragment
Registry](tool-discovery-fragment-registry.md#canonical-fragment-registry)).
Runtime transports must expose the assembled fragment registry without
rewriting support status or inventing policy from prose.

## Ranking And Query Behavior

Query results must be deterministic.

For a `task_id` query:

1. Match the requested `task_id` exactly.
2. Rank by curated `priority` integer, with higher numbers first.
3. Break ties alphabetically by `tool_name`.
4. If still tied, break ties by `entrypoint`.

For a `tool_name` query:

1. Match the requested `tool_name` exactly.
2. Rank by curated `priority` integer, with higher numbers first.
3. Break ties alphabetically by `tool_name`.
4. If still tied, break ties by `entrypoint`.

The envelope should also include a 1-based `rank` field in each result when the
response is queryable, so callers can see the chosen ordering without
recomputing it.

## Diagnostics

Diagnostics are deterministic machine-readable records that explain why an
entry is missing, degraded, stale, historical, or route-limited.

Recommended diagnostic shape:

```json
{
  "code": "descriptor_digest_mismatch",
  "level": "degraded",
  "message": "Runtime descriptor digest does not match the checked-in JSON.",
  "paths": ["packages/wiki-core/data/tool-discovery/manifest.json"],
  "task_ids": ["inspect-provenance"]
}
```

Diagnostics should be ordered by:

1. `level`
2. `code`
3. `paths[0]`

The code values must be stable. The message text should be concise and
actionable, but it does not need to be a verbatim user-facing sentence.

## Dispatch Identity And Bootstrap States

`workspace_agent_dispatch_identity_contract` is the read-only MCP
introspection surface for dispatch identity and bootstrap review. Agents route
worker/reviewer/redteam dispatch through `workspace_agent_dispatch`, treat
wrapper_command rows as operator-facing inventory, and use the stable bootstrap
states `bootstrap_exception_active`, `bootstrap_review_missing`,
`bootstrap_exception_consumed`, and `graph_impact_persistence_unavailable`.
See
[Dispatch Identity And Bootstrap States](tool-discovery-dispatch-runtime.md#dispatch-identity-and-bootstrap-states)
for the detailed identity, audience, registration, backend, and lifecycle
contract.

## Runtime Blocker Taxonomy And Coordination Preflight

`workspace_runtime_blocker_taxonomy` exposes the schema-backed code set in
`packages/wiki-core/data/runtime-blocker-codes.v1.json` for orchestrator
preflight, dispatch readiness, and launcher diagnostics. The canonical
taxonomy categories are `role_policy`, `caller_identity`,
`work_record_readiness`, `transport`, `backend`, `filesystem`, `validation`,
`route`, `review_transport`, `bootstrap`, `graph_impact`,
`graph_impact_persistence`, and `operator_recovery`.
`workspace_coordination_preflight` composes the coordinator preflight envelope
against those codes. See
[Runtime Blocker Taxonomy And Coordination Preflight](tool-discovery-dispatch-runtime.md#runtime-blocker-taxonomy-and-coordination-preflight)
for the detailed taxonomy and preflight contract.

Its `capabilities` projection keeps nine planes separate:
`structured_dispatch`, `native_edit`, `repository_read_boundary`, `commit`,
`managed_worktree_provisioning`, `slice_to_wk_integration`,
`wk_context_review`, `validation_ownership`, and
`automatic_main_promotion`. Every plane includes a server-owned source and
freshness state. Missing, unknown, or stale facts fail closed and are not
inferred from neighboring planes. With the production composition installed, the
current release reports the repository read boundary, managed provisioning,
slice integration, and WK-context review available alongside structured
dispatch, native edit, commit, and validation ownership; automatic main
promotion remains unavailable. Free/local and paid/CCE projections preserve
identical capability meaning and differ only in enforcement metadata.

The stable Phase-1 managed-lifecycle blockers are
`managed_lifecycle_required` and
`managed_worktree_provisioning_unavailable`. Their taxonomy entries identify
the responsible actor and route recovery through
`workspace_coordination_preflight`.

## Representative Coverage

The checked-in descriptor should cover at least one representative tool in each
of these categories:

- wiki search, read, and create
- work-record edit routes for status, task, and closure; validate, migrate, and refresh
- dispatch readiness
- graph impact and code index
- worker, reviewer, and redteam dispatch
- orchestrator start, resume, and list
- diagnostics, provenance, and cleanup
- deactivated and historical blackboard surfaces

That coverage is about discoverability, not support promotion. A historical or
refusal-only surface is still useful if the descriptor says so clearly.

## Cross-Repo Adoption

This schema is local to this repository, but the pattern is reusable.

A consuming repo may either:

- ship its own `tool-discovery.v1` descriptor and compatible discovery
  surface, or
- explicitly replace the command names and MCP methods in its own `AGENTS.md`
  while keeping the same schema contract

If a consuming repo replaces the names, it must say so explicitly. Agents must
not infer support from wrapper files, package metadata, or historical records.

## What This Document Does Not Do

This document does not:

- change tool behavior
- promote unsupported surfaces to supported ones
- define launcher policy
- replace repo-local `AGENTS.md` instructions
- make a checked-in descriptor authoritative for runtime execution

It only defines how discovery should be described, surfaced, and compared.
