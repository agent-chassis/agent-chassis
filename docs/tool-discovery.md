
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

The assembled corpus is exactly 174 tool entries. The checked-in manifest owns
the per-fragment counts and corpus total
(31 + 1 + 44 + 9 + 7 + 2 + 1 + 7 + 7 + 10 + 7 + 28 + 9 + 10 + 1 + 0 = 174).

The forty-four entries in `controlled-contract-tools.json` describe the supported
repository-local controlled-contract routes. Discovery records their exact role
audience, side effects, authority, non-authoritative boundaries, and durable
operation docs; package manifests, private package files, and historical CLI
examples are not support evidence for this surface.
The proof-pack selection descriptor points to the package-owned
`controlled-contract-proof-pack-selection.v2` result. Its route adds canonical
context, exact inspection calls, and bounded transport; it does not expose the
package-only v1 compatibility projection or define selection semantics.
The two atomic coverage-patch descriptors preserve the
`controlled-contract-authoring` task identity and point to
[Acceptance-coverage MCP](acceptance-coverage-mcp.md#atomic-patch-operations)
for their strict current-carrier and role contract.
The obligation- and acceptance-coverage describe descriptors are the only
authoring entry routes. They return one owner-selected `authoring_action`, keep
read pagination separate, require an atomic complete population for initial
create, and route existing carriers to patch/upsert without discovery
inspecting state or selecting a mutation itself.

Every installed, supported MCP registration must have a descriptor row and a
session-role access-policy row before registration. The registration boundary
composes actual registration, session role, registered tier,
`tier_visibility`, `install_state`, and `runtime_posture`; `audience` remains
descriptive and cannot grant or deny a live route. New or changed rows must also
carry complete routing controls. Existing gaps are pinned by entry digest in
the manifest's owner-bound conformance-debt ledger, which may shrink but may not
accept a new or changed gap.

The checked-in fragment manifest owns two monotonic-shrinking implementation
debt records. `agent_tool_conformance_debt` accounts for incomplete routing
controls and the five live `workspace_sidecar_*` compatibility aliases.
`agent_tool_token_budget_debt` accounts for the still-outstanding 64,305/62,000
raw-notes aggregate and 44,003/28,000 paid/operator live-description aggregate.
Both use exact integrity-pinned per-tool baselines: additions fail mechanically,
while reductions retire debt and never authorize an upward rebase. See
[Agent-tool compliance and surface rationalization](agent-tool-compliance-and-surface-rationalization.md)
for the exact denominators, owners, alias records, and enforcement tests.

The proof-graph continuation descriptor publishes the supported write route,
server-held authority boundary, and durable reference without copying the route
contract. See
[Controlled-contract Operations](mcp-controlled-contract-operations.md)
for its exact schema, roles, bounds, failures, and output.
The dedicated task IDs `controlled-contract-authoring`,
`controlled-contract-proof-selection`, `controlled-contract-proof-plan`, and
`controlled-contract-assessment` keep these routes separate from generic
work-record and decision editors.

## Dispatch-readiness generated write surface

Graph-index refresh may use the fixed eight exclusively claimed candidate names
`.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. An existing persistent shared lock
prevents candidate attempts; slot exhaustion falls back to an independent
atomic build. Candidate files are retained but never reused or authoritative.

## A published next call names a registered tool

A refusal's continuation names a tool from this corpus and nothing else. A
private launcher action token (`retry_workspace_agent_dispatch_after_...`) is not
a tool name, and a `cli_command` entry is an operator example rather than an
agent-callable route, so neither can occupy a callable next-call slot.

Where a refusal offers a callable continuation, its arguments are checked against
the request schema the named tool itself publishes at registration: a missing
required argument, an argument the tool does not declare, and a wrong-shaped
value are each refused, and so is the absence of that schema authority. No
refusal keeps its own copy of another tool's request contract.

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
router, FAQ, and runtime output describe unsupported families or missing
confinement prerequisites as typed mechanical refusals rather than silently
changing to a broader launch shape.

For that contract, let `R` be the normalized union of the canonical unit's
`read_scope` and `repo_paths`, and let `W` be the normalized canonical
`write_scope`. The launcher freezes both sets before launch.
the worker's repository visibility is exactly `R union W`, and repository
mutation is permitted exactly within `W`; a target in `W` is visible without
also appearing in `R`.

Codex `exec_command` and Claude `Bash` are directly authorized without interactive
approval inside the visible `R union W` namespace. Commands may mutate `W`; bwrap,
not command classification, prevents reads or writes elsewhere. The initial
implementation-worker profile exposes no worker validation or general MCP tools,
including the discovery routes documented here. This keeps role routing clear
and avoids irrelevant tool descriptions and tokens; it is not a least-access or
security profile. Its sole delivery operation is the closed-input commit
capability in the launcher-owned host/runtime boundary, using the server-resolved
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
confinement capabilities refuse rather than changing to broader visibility or
mutation. The bootstrap composition retains readable
launcher-provided Codex auth/sourceHome and `shareNet=true` model-API egress as
ordinary runtime requirements; it is not a digest-bound or per-dispatch
mechanical risk-acceptance mechanism.

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

`packages/wiki-core/src/lib/tool-discovery/descriptor.mjs` is the executable
owner of the controlled task vocabulary. The JSON launcher metadata is validated
against that vocabulary, and this documentation is its durable projection. In
particular, `query-terminal-review-candidate` selects the existing terminal
candidate status route and `advance-terminal-review-candidate` selects the
existing advance route without changing either route's authority or side
effects; an unknown task ID remains an `invalid_task_id` diagnostic.

Live input schemas are also discovery projections of their semantic owners.
`workspace_create_record.type` is derived from the contract manifest's canonical
record kinds and aliases, including its case-insensitive normalization branch;
controlled-contract authoring targets are derived from package-owned
`CARRIER_TARGETS`; the `workspace_controlled_verification_bundle_patch` bundle
shape is derived from the package-owned verification-bundle vocabulary in
`packages/controlled-contract/lib/test-proof-contract-v1.mjs`; and the
integration-prefix capture route's accepted pack identity is the package-owned
admitted profile identity rather than a version pinned in the MCP surface.
Consumers should inspect these schemas rather than maintain a second vocabulary
registry.

Coverage-authoring describe schemas distinguish exact `authoring_row` reads
from bounded `authoring_context` population reads. The former returns one bound
criterion row with mechanically owner-linked context and exact accounting; the
latter is the callable continuation for explicitly omitted ambiguous
alternatives. Discovery routes callers to describe and does not choose either a
mapping or mutation.

Canonical `IN-*` initiative and `DEC-*` decision records are JSON records read
through the existing discovery and read surfaces. Their co-located Markdown
files are generated projections, not canonical sources, and a failed canonical
JSON read never falls back to one. Discovery remains the authority for which
read routes are currently available and for their live input schemas; this
document does not duplicate route metadata or handler behavior.

The controlled-contract fragment is itself a checked projection: a parity test
requires its rows to be exactly the registered controlled-contract inventory,
requires each row's declared source files to exist, and rejects any row whose
notes enumerate the authoring-stage vocabulary, which would make discovery a
parallel state machine instead of a pointer to its owner.

`workspace_tool_router_recommend` composes this assembled descriptor with the
checked-in routing-intent vocabulary. The vocabulary is the only owner of match
phrases, semantic intent identities, prerequisite declarations, and
intent-to-operation mappings. The descriptor remains the owner of task IDs,
support state, recommended-first-call metadata, and broad discovery ordering;
generic next-call construction owns canonical call validation. The MCP adapter
applies the same central role-visibility predicate used by discovery to the
launcher/server-minted role and tier before route selection. Caller request
fields, prompt text, argv, and ambient environment cannot widen that profile.
When an intent matches but its operation is outside that profile, the router
returns a closed `visibility_withheld` result without disclosing the hidden
operation or publishing a recovery call.

## Ranking And Query Behavior

Query results must be deterministic.

The work record task-minimal default is bound to the immutable 106/106
orchestrator-visible census at descriptor digest
`sha256:f523d121f07a351e70553ad84dd9d0f003165237d76dc366319afb8405b46adb`.
Ordinary `workspace_tools_list` rows contain `tool_name` and `task_ids` but omit
`rank`; count metadata, deterministic ordering, and pagination are unchanged.
Compact `workspace_tools_describe` omits only `kind`, `entrypoint`,
`runtime_posture`, `priority`, and `rank`. It retains the other compact routing
identity and task-contract fields, including `tool_name`, `display_name`,
`task_ids`, `recommended_route`, `tier_visibility`, and `summary` when present.

These omissions are lossless for the same caller. A targeted
`workspace_tools_describe({tool_name, verbose:true})` returns the complete entry,
including all five compact-description omissions and the selected tool's rank
in the full role- and tier-visible ordering. The query projection is unchanged.

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

Query results and verbose descriptions include a 1-based `rank` field so callers
can inspect the chosen ordering without recomputing it. Ordinary list and compact
description results use the task-minimal omissions above.

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

## Work-record creation and design-first authoring

Structured discovery publishes one allocator-backed workspace creation route: `workspace_create_record`. For a `WK-*`, it allocates the canonical inbox template and nothing more. Its schema does not accept controlled-contract/proof carriers, slices, readiness, proof posture, or lifecycle status, and discovery must not recommend an unregistered birth operation.

Post-allocation work follows the [design-first operating model](../AGENTS.md#wk-first-work). Semantic controlled-contract and proof operations own their respective authoring stages, while `workspace_work_record_ready_slice` owns atomic executable-unit shaping. CCE exclusively owns action sequencing and admissibility; descriptor routing is advisory and never a local lifecycle gate.

For an existing canonical WK or slice, discovery routes ordinary authored
scalar/list/task repairs to `workspace_work_record_edit`. Its descriptor does
not carry a copied field inventory: the live MCP input union is derived from
`WORK_RECORD_EDIT_FIELD_REGISTRY`, and the durable complete projection is
[documented once](mcp-operation-reference.md#bounded-ordinary-authored-field-editor).
The role-policy owner exposes the route only to orchestrator and operator
sessions; omission denies reviewer, worker, and redteam sessions. The route is
write-capable, validates a complete prospective record, and may perform one
CAS-protected canonical record write. It has no CLI parity and grants no
lifecycle, review, dispatch, integration, publication, or completion authority.

The production census is the assembled canonical fragment registry, and the role census is `session-role-tool-access.json`. Tests derive both populations from those owners so adding a registration, stale descriptor recommendation, role grant, alias, tombstone, or recovery-only operation fails the same boundary.

## Representative Coverage

`workspace_agent_dispatch` is the only callable review route. Its original
terminal result carries the complete advisory text and schema diagnostics;
nonadherent text remains usable. Ordinary reviews do not request formal
attestation. When the canonical selected result contract requests one, the same
dispatch settlement derives and durably publishes it or reports a precise
unavailable annotation. Discovery exposes no later evidence, provenance, or
attestation append operation and recommends no monitor repair or replacement
review merely because optional metadata is unavailable.

The checked-in descriptor should cover at least one representative tool in each
of these categories:

- wiki search, read, and create
- work-record edit routes for bounded ordinary fields, status, task compatibility, and closure; validate, migrate, and refresh
- dispatch readiness
- graph impact and code index
- worker, reviewer, and redteam dispatch
- orchestrator start, resume, and list
- diagnostics, provenance, and cleanup
- deactivated and historical blackboard surfaces

That coverage is about discoverability, not support promotion. A historical or
refusal-only surface is still useful if the descriptor says so clearly.

## Discovery As A Routing Input

Discovery is also consumed programmatically. The descriptor's per-tool
`source_files` and `docs_refs` are the advertised references
`workspace_authoring_ergonomics_report` follows when it resolves which canonical
record owns a producer boundary: it reads the assembled descriptor at call time,
takes the source files the boundary advertises, and looks for a canonical work
record whose declared write scope covers all of them. Nothing is cached and no
tool-to-record table exists, so a descriptor entry with accurate `source_files`
is what makes that routing resolvable.

Two consequences follow for descriptor authors. A missing or stale
`source_files` list does not produce a wrong owner — it produces
`owner_unresolved`, because no record can cover a surface that was never
advertised. And a descriptor that cannot be assembled at all degrades routing to
`lookup_degraded` rather than to an ownership gap: an unavailable discovery
route never establishes that a boundary is unowned.

`workspace_authoring_ergonomics_report` is the compact snapshot-creation route.
It returns summary counts, source redactions and limitations, a completeness
inventory, one authenticated immutable snapshot identity, and exactly one
`workspace_authoring_ergonomics_report_query` next call. The query route owns
typed retrieval for coverage declarations, workflows, episodes, metric entries,
finding observations, clusters, axis classifications, conformance evaluations,
owner-routing results, and diagnostics. Its descriptor states the direct-call
and cursor contracts, exact page and scalar accounting, selector vocabulary,
source and domain isolation, and the canonical initial-report rerun for expired
or evicted state when complete recovery arguments remain available. After restart
or tombstone loss, journal recovery remains callable; retained-smoke recovery
without the caller's original bounded envelope names that prerequisite and emits
no report call that would fail schema validation. Conformance evaluation context
appears once per query page rather than once per gate row. The query has no
standalone first-call placeholder: its required prior state and executable
continuation come from the report. Completeness covers nested fields, including
the conformance envelope, and an unrouted cluster beyond the routing bound says
that no lookup occurred instead of fabricating `lookup_degraded`. Neither route exposes raw events, a legacy whole report,
report-local spill, admission authority, or mutation authority. Every role
granted the report is also granted the query.

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
