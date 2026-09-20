
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

The assembled corpus size is derived from the checked-in fragment manifest.
The controlled-contract fragment contains the currently registered semantic
proof operations. Discovery records their role audience, side effects,
authority, non-authoritative boundaries, and durable operation docs; package
manifests, private package files, and historical examples do not establish
public support.

The durable surface provides named-proof discovery, ordinary obligation and
contract-input upsert/query/remove, explicit validation, and exact-candidate
verification. A temporary design-preparation entry remains present only until
the ordinary contract-input cutover is complete. Discovery does not expose
carrier construction, manual acceptance-axis editing, caller-built proof
graphs, separate assessment, public refactoring, or duplicate execution and
capture workflows.

Every installed, supported MCP registration must have a descriptor row and a
session-role access-policy row before registration. The registration boundary
composes actual registration, session role, registered tier,
`tier_visibility`, `install_state`, and `runtime_posture`; `audience` remains
descriptive and cannot grant or deny a live route. New or changed rows must also
carry complete routing controls. Existing gaps are pinned by entry digest in
the manifest's owner-bound conformance-debt ledger, which may shrink but may not
accept a new or changed gap.

For the controlled-contract fragment, the assembled descriptor is the census
owner: every row has exactly one entry in the central disposition map. The
closed vocabulary is `direct`, `closed_typed_front_door`,
`server_issued_continuation`, `operator_recovery_only`, and
`outside_current_contract`. Role grants and dispositions are validated
together; no module-local role table or verb-derived operation list exists.

The checked-in fragment manifest owns two monotonic-shrinking implementation
debt records. `agent_tool_conformance_debt` accounts for incomplete routing
controls and the five retired `workspace_sidecar_*` compatibility alias records.
`agent_tool_token_budget_debt` records historical raw-notes and paid/operator
live-description baselines against their 62,000- and 28,000-character targets.
Both use exact integrity-pinned historical per-tool baselines. Per-tool growth is
debt only for rows still missing structured routing metadata; metadata-complete
rows remain subject to the aggregate and universal prose bounds. Reductions retire
debt and never authorize an upward rebase. Descriptor
notes, tier overrides, and live descriptions follow the
[Discovery Prose Boundary](tool-discovery-schema.md#discovery-prose-boundary). See
[Agent-tool compliance and surface rationalization](agent-tool-compliance-and-surface-rationalization.md)
for the exact denominators, owners, alias records, and enforcement tests.

See [Controlled-contract Operations](mcp-controlled-contract-operations.md) for
the current schemas, roles, bounds, failures, and result behavior.

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
| [Tool Discovery Schema](tool-discovery-schema.md) | Authority And Trust; Envelope Schema; Freshness; Tool Entry Schema; Discovery Prose Boundary; Routing Metadata Fields; Controlled Task IDs; Status Model (`install_state`, `runtime_posture`, `recommended_route`); Side-Effect And Authority Vocabularies |

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
router, and runtime output describe unsupported families or missing
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
not command classification, prevents reads or writes elsewhere. The
implementation-worker MCP profile is exactly the closed-input commit capability
and the launcher-bound `workspace_verify_proof`; it exposes no declared-test or
node_test execution route and no general MCP tools, including the discovery
routes documented here. This keeps role routing clear and avoids irrelevant tool
descriptions and tokens; it is not a least-access or security profile. Its sole
delivery operation is the closed-input commit capability in the launcher-owned
host/runtime boundary, using the server-resolved binding without giving the
worker repository git metadata or a general commit shell.

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

For each confined Claude or Codex dispatch, the launcher establishes a private
Unix-domain socket admission service and projects its endpoint, credential file,
pinned stdio connector, and connector Node executable into the final bubblewrap
namespace. Each authenticated MCP command invocation gets an independent
connection and host wiki-MCP server generation. Claude uses launcher-authored
strict MCP configuration; Codex uses the exact launcher-authored
`mcp_servers.wiki` projection. Server registration must succeed before MCP bytes
are forwarded, and the real client must complete `initialize` and `tools/list`
against the launcher-derived role profile. Agy is unsupported and fails closed.
No caller, prompt, repository/user configuration, environment, or arbitrary argv
can select the server, endpoint, connector, tool profile, or lifecycle. See the
[transport contract](mcp-integration.md#transport).

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
record kinds and aliases, including its case-insensitive normalization branch.
Proof-intent discovery derives its named population from the package owner.
Ordinary proof upsert derives requirement, disposition, case, mechanism, and
proof parameters from their semantic schemas. Consumers inspect those live
schemas rather than maintaining a second vocabulary registry.

Those `tools/list` declarations are sufficient for a valid first request. The
obligation-coverage upsert publishes closed requirement and obligation
structures; the controlled natures and case-sensitive modalities; every relation
with its operand kind, operand cardinality and admitted applicability modes;
type terms, identity kinds, residue reasons and note kinds; required
`verification` for behavior requirements with a mandatory modality; the complete
`runtime_test` object for `test_execution`, including the fields the installed
falsifier strategy leaves open; and `rebind_case_ids` only with
`replace_claim_id`. Each fact comes from its semantic owner. A shared owner node
is published once and reused through JSON pointers within the same served
schema. The declaration never decides a request: the authoritative schema and
semantic owners refuse with their own reason codes and recovery. Current state
is not a static constraint. `expected_content_digest` is the `content_digest`
returned by `workspace_controlled_contract_obligation_coverage_query`, null only
when that read returns null, and existing selectors and case identities come
from the same read. Verbose describe and guidance selection remain optional
selected detail, not a prerequisite. `workspace_work_record_ready_slice`
publishes `completion_policy` with the canonical work-record completion-policy
vocabulary; the core planner still refuses an incompatible placement.

Decisive static constraints are published on the fields they constrain.
`workspace_read_page` states that `length` exists only with `search_match` and
takes its bound from the selected-source reader, and ordinary read selectors
refuse alongside `search_match`. `workspace_get_record` takes the canonical `id`.
A ready-slice `acceptance.validation[].target` publishes and enforces the closed
node_test target owned by the work-record validation projection: one canonical
repository-relative `.mjs` node:test module path, never a command.
No public MCP route executes a declared node_test target: the
`workspace_run_validation` and `workspace_worker_run_declared_test`
registrations are retired and have no descriptor, role grant, or live
registration. A saved proof's runtime prerequisites are resolved when it is
prepared for `workspace_verify_proof`. Task edits take their action
vocabulary from the ordinary editor registry: an unsupported task action is
refused with the registered actions and a selection of that field's editor
guidance, and `replace_text` keeps the selected task's status.

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

Classification is phrase-based over the normalized task text, so the vocabulary
carries the ordinary paraphrases of each supported request rather than one
canonical wording. Match words may be separated by filler — articles,
possessives, pronouns, bare auxiliaries, prepositions, run-role qualifiers, and
the parts of a durable identifier — so "where things stand", "where does
initiative stand", and "check where initiative initiative stands" select the same
status lens. Asking what to do next selects the next-action lens instead, by
the declared overlap rule. A prospective question about a unit ("can we send a
worker on WK-0001?") stays `dispatch_readiness` and never launches; an explicit
start ("start WK-0001") selects the canonical dispatch operation with the named
subject preserved and the role left to that operation's owner.

An unbounded read is a declared request property, like a write request. When a
task asks to read everything relevant to an initiative or unit, the matched
intent declares `broad_read_request` in `ambiguity_when_state_present`, so the
router returns bounded clarification: the initiative/unit status lens is the
one executable alternative and the caller is asked to name the exact record,
slice, entry, or page instead. No record, slice, or page sampling is inferred
from the breadth of the request.

Explicit requests for obligation-coverage authoring help match the
`controlled_contract_input_guidance` intent. Its routes recommend one
`workspace_tools_describe` guidance selection of
`workspace_controlled_contract_obligation_coverage_upsert` with a literal path:
`overview`, `behavioral_example`, `runtime_test_authoring`,
`required_object_shapes.requirement_rebinding`, or
`vocabulary.relation_details`. The call needs no unit, a unit or slice named as
context does not change it, and following it returns the complete selected
value. Only explanatory phrases select these routes. A request that uses a write
verb without asking for an explanation is a write request: it never selects
them, keeps its query or upsert route, and never receives a synthesized save
call. A request that asks for an explanation and also asks to write stays
ambiguous and recommends nothing: the guidance selection remains an unflagged
alternative, and the requested write is neither synthesized nor silently
dropped. A describe recipe is visible only when both
`workspace_tools_describe` and the described tool are visible in the session
profile; otherwise the result is `visibility_withheld` and names neither the
target nor its arguments.

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
in the full role- and tier-visible ordering. A task-only
`workspace_tools_describe({task_id, verbose:true})` instead ranks each selected
tool within that task's population. `task_id` and `tool_name` are alternative
selectors and a request naming both is refused, so select a row from the
task-only detailed result when a task-relative rank is needed.

`workspace_tools_describe` also owns the targeted, read-only `input_contract`
selector. Its closed alternatives are `{kind:"field",field,scope}` and
`{kind:"fields",offset?,limit?,expected_source_digest?}` for
`workspace_work_record_edit`, and
`{kind:"guidance",path?,expected_source_digest?}` for the authoring guidance
any compact declaration registers. Every alternative requires one exact
`tool_name`; the editor alternatives use the nested limit instead of
describe's top-level limit, and `kind:"guidance"` refuses `task_id`, top-level
`limit`, or `verbose:true` with `tool_input_guidance_exact_tool_required` or
`tool_input_guidance_arguments_conflict`.

The editor alternatives have the same declared refusals, owned by the editor
selector rather than by the generic handler boundary. A selector sent with no
`tool_name`, a padded `tool_name`, or a `task_id` refuses with
`editor_input_contract_exact_tool_required`; one sent to any other tool refuses
with `editor_input_contract_tool_unsupported`; one sent with describe's
top-level `limit` refuses with `editor_input_contract_limit_conflict`. Each
states `authority_limb:"mechanical_failure"`, and each carries the one
replacement describe call that re-addresses the caller's own selection to
`workspace_work_record_edit`: a `field` selector keeps its field and scope, and
a `fields` selector keeps its window, except that a nonzero offset with no
`expected_source_digest` cannot bind a page and restarts at the first one. No
authored value is invented, and the top-level `limit` is dropped rather than
reinterpreted as the field-inventory limit. The recovery and the supported tool
name are emitted only to a session whose role can see the editor; to any other
session the refusal names neither the tool nor a route to it. A producer defect
— a replacement the registered describe request schema would reject — remains
an untyped handler failure and is never reported as caller misuse. The guidance alternative has no
paging arguments; `offset` or `limit` inside it is refused by the request
schema. The server applies the existing role/tier visibility predicate before
looking up or constructing guidance, so a hidden tool returns the same empty
result as an unknown tool, with no name, guidance, or digest. Ordinary list
results and unrelated descriptions never carry the editor catalog or the
selector union. A named editor description includes the minimal
schema-checked notes replacement and calls into the detailed route.

Named `verbose:true` on a tool that registers an input contract returns its
complete structural contract: the closed schema, every declared constraint, and
truthful `completeness` with every `unprojected` enforcement rule. The contract
is projected from the registration's selected input-contract source: the
authoritative request schema by default, the advertised declaration when the
registration selects it, or a **served declaration** for a route whose request
boundary is deliberately permissive because a named canonical owner decides the
body (see below). The obligation-coverage upsert selects its advertised
declaration, so verbose discovery states the same owner-derived natures,
modalities, relation signatures, verification methods, mandatory verification,
`runtime_test` fields and strategies, and rebinding conditions as `tools/list`;
the authoritative schema and semantic owners still decide every request.
Numeric bounds keep their meaning: an inclusive bound is `minimum` or
`maximum`, an exclusive bound is a numeric `exclusiveMinimum` or
`exclusiveMaximum`, repeated bounds keep the strongest, and inclusive and
exclusive bounds on the same side are both stated. When the tool
registers authoring guidance, that contract carries
`authoring_guidance_locator: {call}` instead of the guidance body. The call
selects the registered `overview`, and an `unprojected` rule owned by guidance
carries a `guidance_call`. Every registered guidance object owns a nonempty
string `overview`; registration refuses guidance without one.

### A served declaration: a contract the request boundary does not decide

`workspace_work_record_upsert_slice` takes its slice body as an unconstrained
object on purpose: `work-record.v1` structure validation, not the request
boundary, decides slice validity, and a second enforcing copy at the boundary
could only drift from it. The consequence was that verbose discovery had no
contract to serve at all — it answered a schema request with routing metadata
(rank, priority, audience, documentation state), and a caller learned that
`status` is a closed vocabulary only by being refused.

That route therefore registers a **served declaration**: the bounded portion of
the applied slice contract that can be restated faithfully from its owners,
published for discovery only. Verbose describe serves it with

- `advertised_declaration: "permissive_request_boundary"`,
- `enforcement: "canonical_owner_on_every_call"`, and
- `enforced_by`, naming the owners that actually decide — for this route,
  canonical unit-address parsing, shared prose-carrier resolution, and
  `work-record.v1` canonical structure validation before any write.

Every stated closed vocabulary and pattern is read from its owner's constants:
the slice `status` enum, slice id pattern, every canonical slice `work_kind`
except record-only `tracker`, and record- or slice-scoped unit-address grammar.
The acceptance declaration matches canonical cardinality and openness: criteria
and validation are required arrays that may be empty, criteria may be strings or
structured objects, and extra acceptance and criterion members pass through.
Repository and write scopes are arrays of strings here; this route does not
apply ready-slice's repository-path predicate. It does not advertise a priority
vocabulary because canonical slice validation does not enforce one.
`completeness` is `partial` and `unprojected` names what the declaration cannot
state, beginning with the fact that the complete slice contract is decided when
the edit is applied and that members beyond those stated are accepted by the
request and decided there.

A served declaration **decides nothing**. The route neither parses nor enforces
it; its acceptance, its refusals and their exact diagnostic paths are unchanged,
and an invalid slice is still refused by `invalid_record` naming the exact path.
`tools/list` is unchanged too, so no session pays for the contract up front — it
is charged only to a caller that asks for it by name.

Guidance is selected by `path`, an array of literal string segments from the
registered root. An omitted `path` selects `overview`, `[]` selects the
complete registered reference object, and any other path selects exactly that
member. Object segments are own member keys taken literally, so dots, slashes
and index-like strings are neither split nor converted; array segments must be
canonical in-range index strings, and `length` and other keys are refused. A
successful selection is `{ok:true, source_digest, value}`, where `value` is
the complete selected JSON value of any type. There are no inventories, row
selections, pages or continuations to reconstruct. Shipped overview and topic
explanations arrive inline; only an explicitly selected value above the
response inline limit uses the incumbent lossless spill transport. For
example, this request returns the complete relation catalog the
obligation-coverage upsert registers:

```json
{
  "tool_name": "workspace_controlled_contract_obligation_coverage_upsert",
  "input_contract": {
    "kind": "guidance",
    "path": ["vocabulary", "relation_details"]
  }
}
```

### The relation catalog states the complete applicability set once

The obligation-coverage upsert's registered vocabulary declares eleven
applicability modes and ninety-three relations, and eighty-four of those
relations admit every declared mode. Each of those rows used to carry its own
verbatim copy of the same eleven-element array — a third statement of something
the same value already makes twice, at `vocabulary.applicability_modes` and, for
the narrowing rows, at `vocabulary.restricted_applicability`.

A relation row now states its applicability once:

- `applicability: "all_declared_modes"` and **no** `applicability_modes`, meaning
  it admits every mode in this same value's `applicability_modes`; or
- `applicability: "restricted_modes"` with its own exact `applicability_modes`,
  which is the same list `restricted_applicability` gives for that term.

`vocabulary.relation_applicability_statement` states that rule inside the value,
so a caller reads it from the answer rather than inferring it. The enforced
request schema is built from this same published value through the same
resolution, so the marker cannot mean something the enforced contract does not:
every relation branch of the declaration still admits exactly the modes its row
resolves to.

Nothing was removed, capped or moved behind another call. Measured over the
registered source: the whole guidance reference fell from 64,387 to 57,637
bytes, its `vocabulary` member from 25,036 to 18,286, and `relation_details`
from 20,381 to 13,304. The consequence for a caller is larger than the ratio
suggests — an explicit `[]` whole-reference selection was a 130,212-byte
response that spilled to a 64-page ranged read, and now returns complete and
inline in one call at 104,654 bytes.

`source_digest` is the digest of the exact tool's registered guidance and the
current selector contract, `workspace-tools-describe-input-guidance-selector.v2`.
Every emitted guidance call carries it as `expected_source_digest`; a fresh
read may omit it. There is no server-side cursor or time expiry. A supplied
digest is checked before the path is resolved, and a changed source refuses
with `tool_input_guidance_stale_source` and a call repeating the selection
against the current source at its deepest path that still resolves. The
remaining refusals are `tool_input_guidance_unavailable` for a visible tool
without registered guidance, `tool_input_guidance_invalid_path`, and
`tool_input_guidance_path_not_found`; a path refusal recovers with a call
selecting its deepest valid ancestor. Each states
`authority_limb:"mechanical_failure"` and returns a callable recovery. A
refused compact-route request returns `input_contract_recovery` built only from
facts its owners declared. `refusal` carries the owner's `reason_code` and
`authority_limb` unchanged; a refusal that declares no limb reports
`authority_gap` rather than an inferred limb. A request-schema refusal lists
`rejected_field_paths` from the validator issues. When the route registered
request locations with its guidance, `failed_fields` gives each rejected path a
`guidance_call` for the member bound to the deepest location containing it
(`[]` matches any array index). A path no location contains is reported as
`request_location_guidance_undeclared`. The `structural_contract` describe call
follows as the complete authority. A binding that does not resolve is refused
at registration. A semantic refusal lists `failed_fields`,
each with its authored `field_path` (an empty owner field names the authored
root) and a `guidance_call` selecting the exact registered guidance member its
owner names, such as `["vocabulary","modalities"]` or the conditional rule that
requires `verification`. A named member that no longer resolves is
reported as `guidance_unavailable` with the selector refusal code, and recovery
never falls back to a broader guidance selection.

Those recovery facts describe refusals a route owner returns. A request the
registered input schema itself refuses fails before any owner runs, with
`tool_input_validation_failed` and the validator's complete generated
diagnostics; see [MCP integration](mcp-integration.md#tool-input-schema-publication).
That failure is complete on its own: a verbose `workspace_tools_describe` read of
the tool's input contract remains optional information and is never required to
recognize or explain misuse.

Every discovery selector (no selector, `task_id`, or `tool_name`) uses one
ordering rule, owned by the shared descriptor filter and rank owner in
`packages/wiki-core/src/lib/tool-discovery/projection.mjs`:

1. Keep the canonical descriptor rows eligible for the launcher-minted role and
   registered tier, then match the selector exactly: `task_id` membership or the
   exact `tool_name`.
2. Order by curated `priority` integer, with higher numbers first.
3. Break ties alphabetically by `tool_name`.
4. If still tied, break ties by `entrypoint`.

`workspace_tools_list` pages, `workspace_tools_describe`, and the
`tools-describe` CLI envelope all order through this rule, so paging a filtered
list and describing the same selector return the same population in the same
order. Verbose descriptions include a 1-based `rank` field: the position in the
complete role- and tier-visible ordering for an unfiltered or named request,
and the position within the task for a task-only request. Ordinary list and
compact description results use the task-minimal omissions above.

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
contract. The same route reads the launcher's current app and model for a
proposed `dispatch_selection` without dispatching; see
[Reading the current dispatch selection](mcp-dispatch-launch-and-admission.md#reading-the-current-dispatch-selection).

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
dispatch, native edit, commit, and validation ownership where
`workspace_verify_proof` is registered; the operator profile has no grant for
that route and reports validation ownership unavailable. Automatic main
promotion remains unavailable. That plane uses
`automatic_main_promotion_unavailable`, not `managed_lifecycle_required`, and
does not point back to preflight as a recovery that cannot enable promotion.
Explicit `workspace_wk_forge_handoff` publication is separate from automatic
promotion and from forge-owned merge. If the handoff route is registered, both
compact and verbose preflight guidance point to the read-only
`workspace_tools_describe({tool_name:"workspace_wk_forge_handoff",verbose:true})`
call for the route contract and prerequisites. Route registration alone proves
neither candidate readiness, forge configuration or permission, successful
publication, nor merge. A missing route remains reported as missing with no
handoff discovery call; an unknown or stale automatic-promotion authority fact
retains that state. `validation_ownership` reports only whether this
server registered `workspace_verify_proof`
(`mcp.runtime_registration.workspace_verify_proof`); it is a registration fact
and does not establish that any unit has an executable proof or node_test run.
Free/local and paid/CCE projections preserve identical capability meaning and
differ only in enforcement metadata.

The stable Phase-1 managed-lifecycle blockers are
`managed_lifecycle_required` and
`managed_worktree_provisioning_unavailable`. Their taxonomy entries identify
the responsible actor and route recovery through
`workspace_coordination_preflight`.

## Work-record creation and design-first authoring

Structured discovery publishes one allocator-backed workspace creation route: `workspace_create_record`. For a `WK-*`, it allocates the canonical inbox template and nothing more, then returns `workspace_controlled_contract_obligation_coverage_query` as the post-allocation read and identifies ordinary obligation-coverage upsert as its follow-up authoring operation. Its schema does not accept controlled-contract/proof carriers, slices, readiness, proof posture, or lifecycle status, and discovery must not recommend an unregistered birth operation.

Post-allocation work follows the [design-first operating model](../AGENTS.md#wk-first-work). Semantic controlled-contract and proof operations own their respective authoring stages, while `workspace_work_record_ready_slice` owns atomic executable-unit shaping. CCE exclusively owns action sequencing and admissibility; descriptor routing is advisory and never a local lifecycle gate.

For an existing canonical WK or slice, discovery routes ordinary authored
scalar/list/task repairs to `workspace_work_record_edit`. Its descriptor does
not carry a copied field inventory: the live MCP input union is derived from
`WORK_RECORD_EDIT_FIELD_REGISTRY`, and the durable complete projection is
[documented once](mcp-operation-reference.md#bounded-ordinary-authored-field-editor).
The named describe route derives selected detail and source-digest-bound field
pages from that same registry and the enforced schema facts; it does not add a
second field or action registry.
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

## One-Call Closeout And Truthful Check Results

A route that performs bookkeeping should also perform the checks that bookkeeping
requires, rather than publishing a follow-up chore. Closeout is the case: the
call that records closure or the closeout status transition also runs the
generated-view and lint checks, through the one executor that owns them.

Discovery says two things about it. The checks are part of the call, so a caller
reading the result is reading what already happened rather than a list of what to
do next. And the reported outcome is the executor's own: a failing check is
published as failing and an unavailable one as not run with its cause, so a
discovery consumer never reads an absent check as a passing one.

The bookkeeping is one write as well as one call. Discovery publishes the closure
route's explicit optional completion argument, so a consumer learns that one
request can record authored closure and the final transition together, and that
omitting the argument records closure without changing status. The distinction is
published rather than inferred: routing a request to record notes never proposes
completion, no separate completion tool exists, and an unretrieved or absent
argument is never read as a completion request.

## Common Fixed-Fork Squash Candidate And Conditional Review

A published route can depend on a repository workflow without exposing that
workflow as a caller choice. Forge handoff is the case: it publishes one squash
candidate built from the selected integrated WK tip and the fixed authenticated
fork, and whether a terminal review is also authenticated is resolved by the
server from the repository's own selected workflow.

Discovery therefore advertises no mode, no repository-name branch and no caller
switch for it. What discovery does say is which authentication is unconditional —
candidate identity, tree and sole parent, version selection and controlled
generation — and which is conditional on the workflow, so a caller can read the
published result's workflow field without inferring that it chose it.

## Recorded Worker Proof Verification

Discovery for `workspace_agent_run_status` says that managed-worker status
reports the attempt's recorded explicit `workspace_verify_proof` calls. It also
says that the `proof_verification` detail kind pages those records and that
`invocation_id` reads one of them.

Discovery states three facts about these records:

- they are read, never executed, by observation, and settlement runs no
  verification of its own;
- `none_recorded` is not a pass;
- a recorded result is worker evidence rather than authority. Discovery does
  not list it as a route to admission, review, integration or lifecycle
  permission.

## Canonical Slice Start And Existing Readiness Orchestration

`workspace_agent_dispatch` publishes `role` as optional. Discovery says so
because starting a canonical unit does not ask the caller to restate the agent
that unit's `dispatch_intent` already declares: the wiki-core dispatch owner
derives it, and a unit declaring no agent is refused before launch. An explicit
role remains the way to ask for an advisory reviewer or redteam run, which is a
caller decision rather than a property of the reviewed unit.

Discovery also publishes what the route will not take. The assignment is built
by the system from the canonical unit and authenticated launcher facts, so a
caller-authored prompt, request, argv or env is refused rather than accepted and
ignored, and readiness runs internally through its existing owner rather than as
a required caller pre-call. `workspace_validate_dispatch` stays listed for the
explicit "can this start?" question.

## One Ordinary Reader, Several Owners

`workspace_read_page` is the ordinary selected canonical reader, and the same
two rules that keep a consolidating operation honest apply to it. Its published
selectors decide the read — `path`, `id` or `unit`, plus the delegated `entry`
and `content_reference` selections — and that decision has one owner rather than
a copy inside the registered schema.

Delegation does not move a contract. The entry route still owns the entry read
grammar and the content-reference route still owns retained spills; the reader
reaches those owners and re-addresses the calls they emit to itself, so a caller
can follow a returned call without changing route while the owning contract, its
refusals and its role grants stay exactly where they were. A descriptor for a
delegating route therefore lists the owners it reaches in `source_files`, which
is what keeps ownership routing resolvable for the whole surface.

## Published Selectors As The Routing Rule

Some registered operations answer more than one question and choose between
existing owners from their own parameters. `workspace_code_index_impact` is the
current example: a change subject asks impact, a symbol or source location asks
the navigation owners, and a path alone asks file context.

Discovery carries that rule rather than leaving it to a caller's guess. The
descriptor's `notes`, `use_when` and the registered description publish the same
precedence the runtime applies, so a router or an agent reading discovery learns
which parameters produce which answer before calling. Two rules keep that
honest. Selection stays in one owner, never duplicated into the registered
schema, so discovery text and runtime behaviour cannot drift apart. And a
consolidating operation must not change any grant: it and every route it
delegates to keep identical `access` and `dispositions` entries in
`session-role-tool-access.json` and identical descriptor `audience` and
`tier_visibility`, so routing a question through it neither broadens nor
destroys a role or tier path.

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
