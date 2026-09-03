
# MCP integration

## Registration conformance boundary

Every MCP registration passes through the shared `registerTool` boundary. Once
the session-role gate says a route is visible, the boundary requires that route
to exist in the assembled canonical descriptor and in the manifest-backed
registration-eligible set before applying the registered-tier gate. This check
runs for free/local, paid CCE, and operator-only registrations; paid or full
operator posture is not an escape hatch.

Eligibility composes the session-role access policy, `tier_visibility`,
`install_state`, `runtime_posture`, and actual registration. `audience` is
descriptive only. A missing descriptor or changed/new incomplete routing row is
a startup error, not a hidden route or a best-effort warning. Only a genuinely
missing installed descriptor asset uses the existing fixed free/local
compatibility fallback; malformed or nonconformant canonical data fails loudly.

Description registration has one runtime safety/conformance threshold:
`AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS`, owned by
`packages/wiki-core/src/lib/tool-discovery/descriptor.mjs`. A role-visible tool
must publish a nonempty description no longer than 1,500 JavaScript string
characters. Exceeding the ceiling fails registration with the tool name,
observed length, and hard limit. The manifest's exact historical per-tool
lengths and the 28,000-character paid/operator aggregate target are CI/lint debt
accounting and reduction evidence only; neither is consulted to admit server
startup, initialize, or `tools/list`.

The launcher owns one host-side `@agent-chassis/wiki-mcp` process for each
confined Claude or Codex dispatch. The model sandbox never contains a Node
interpreter, package tree, dependency installation, or wiki-MCP runtime.

## Result channels

A structured tool result carries the same value through both channels. The
`structuredContent` object stays the authoritative machine-readable payload, and
the single text block in `content` holds JSON text that parses to a value deeply
equivalent to it. A client that reads only the rendered text channel therefore
recovers the same stable fields as a client that understands `structuredContent`.
Structured error envelopes obey exactly the same shaping and additionally retain
`isError: true`. An unstructured thrown error is translated into the registered
public mechanical refusal envelope. Its ordinary diagnostic remains separate
from deciding identities and is preserved byte-for-byte. Diagnostic/free-form/
untrusted text is not inherently sensitive; only an explicit structured
sensitive component is removed, with its genuine closed reason.

That contract is enforced at the public guard boundary, not only inside the
`jsonContent` and `errorContent` helpers. Every result a registered handler
returns passes through the guard, so a handler that shapes its own result — or
that mutates a helper-produced `structuredContent` afterwards, as tool discovery
does when it re-attaches `package_versions` and the work-record write routes do
when they re-attach `selected_unit` — is normalized back onto the two-channel
contract before it leaves the server. Normalization is idempotent: a result whose
text channel already parses to an equivalent value and whose complete
serialization already fits is returned untouched. A result with no
`structuredContent` passes through unchanged.

Inline admission is decided on the UTF-8 byte size of the complete prospective
`CallToolResult` — both channels, the JSON-string escaping the text channel pays
for embedding JSON inside a JSON string, the frame keys, and preserved top-level
result metadata such as `_meta`. Nothing is added to the frame afterwards, so no
inline result exceeds the configured limit. Because
both channels are counted, a payload that would have fit a single-copy budget can
legitimately spill.

A result that does not fit is persisted once to the existing file-backed
reference, and both channels then carry the same bounded
`wiki-mcp-spilled-response.v1` envelope: reason, byte counts, a bounded preview,
and the content reference with its digest and ranged-continuation window. An
oversized structured error retains `isError: true`, and reading the reference
through `workspace_read_mcp_content_reference` reconstructs the original envelope
byte-for-byte. A spill or refusal envelope is terminal — it is never spilled a
second time.

When persistence itself fails, the boundary returns one deterministic bounded
refusal through both channels rather than the oversized original or a generic
unstructured fallback:

- `isError: true`, and `content` JSON that parses to a value deeply equivalent to
  `structuredContent`.
- `schema_version: mcp-response-refusal.v1` and
  `code: mcp_response.spill_persistence_failed.v1`.
- `reason`, `inline_byte_limit`, and `total_bytes` describing what could not be
  admitted, plus `cause_diagnostic` and `cause_diagnostic_redactions`. The text
  is uncapped; only structured sensitive components are removed.
- No content reference and no continuation, because nothing was persisted.

Task-specific compact projections and pagination run before this common shaping;
the response boundary does not change projections, authority decisions, tool
schemas, the MCP SDK, or the transport.

## Canonical initiative and decision reads

The public MCP surface for canonical initiative and decision records consists
only of the existing `workspace_get_record` and `workspace_read_page` routes.
The former admits a registered `IN-####` or `DEC-####` durable ID. The latter
admits only the exact repository-relative canonical JSON path resolved for that
ID by the kind-record authority. A co-located Markdown path remains an explicit
projection read; it is not a canonical-record alias.

A successful canonical read is classified as `json-kind-record` and preserves
the durable identity and record kind, canonical source classification and path,
source digest, validity, and diagnostics. The default response is bounded: it
does not include the complete `record`, and its compact omission ledger names
every retained and omitted top-level record member with exact source, compact,
omitted, and accounted totals. When `sections` is omitted, the ledger enumerates
each `sections.<member>` identity in its source, omitted, accounted, and recovered
populations; the member values remain omitted from the compact result.

The compact result advertises the route-local acknowledged complete-read call.
Following it with the same ID or path plus `include_record: true` and
`accept_full_read: true` returns the complete canonical record, including all
omitted top-level members and `sections`. Compatibility continuation tokens are
bound to the route, repository, identity, selector, and source digest. A token
that cannot be decoded or fails the structural shape checks returns
`compact_read_token_malformed`. A structurally valid token with an altered
binding returns the corresponding wrong-schema, wrong-tool-family, wrong-scope,
wrong-selector, stale-source-digest, or expired diagnostic; a changed canonical
source specifically returns `compact_read_token_stale_source_digest`.

Admission and loading fail loudly. Missing, unreadable, invalid JSON, and
record-identity-mismatched canonical sources retain their mechanical
diagnostics (`missing_json_record`, `unreadable_json_record`, `invalid_json`,
and `record_identity_mismatch`). No failure falls back to Markdown. An
unregistered or merely similar JSON path is rejected rather than becoming an
arbitrary JSON or filesystem read.

Ownership remains singular. The kind-record store owns registered kind and
identity authority, exact canonical-path resolution, loading, validation, and
canonical-versus-projection classification. The shared compact-read gate owns
bounded disclosure, omission accounting, continuation validation, and recovery
next calls for both routes. Tool discovery owns current route metadata and live
input schemas; see [Tool discovery](tool-discovery.md). The broader canonical
record ownership model remains in [Operating model](operating-model.md), so this
section neither defines another route nor restates those owners' algorithms or
schemas.

## Authoring-ergonomics evidence boundary

`workspace_authoring_ergonomics_report` is a read-only compact evidence route,
not a gate. It reads exactly one of two closed sources — the configured
repository's fixed `errors.log`, or an
`authoring-ergonomics-retained-smoke.v1` envelope the caller supplies — and
returns decisive counts, source redactions, coverage limitations, a nested-field
completeness inventory, and one authenticated immutable snapshot identity. Finding rows,
episodes, clusters, full classifications, and raw events are absent from the
initial response. `workspace_authoring_ergonomics_report_query` is the only
typed inspection route for the omitted structured report values. Neither route
accepts a filesystem path, alternate filename, environment override, or
authority carrier, and neither mutates a record, changes status, dispatches,
edits source, publishes an artifact, or decides policy.

Coverage travels with the evidence rather than with the caller's intent. A
failure journal declares a `failure_only` population, so every conformance
identity that requires a complete normal-success population returns
`unevaluable_missing_coverage`; failure-only evidence cannot green such a check
and cannot condemn it either. Ownership is resolved per call from structured
discovery, the canonical work-record corpus, and the code index, and a lookup
that was unavailable, incomplete, or stale returns `lookup_degraded` rather than
an ownership gap. A cluster past the 1,000-cluster routing bound performs no
lookup and is exposed with `owner_routing_performed: false` and a null routing
state, never as fabricated degradation. Query pages are bound to one immutable snapshot and report
exact `total`, `returned`, `remaining`, and `continuation`. An expired, unknown,
forged, wrong-domain, or source-mismatched identity refuses loudly; an
expired or evicted snapshot with a live authenticated tombstone returns the
canonical initial-report rerun route with its complete stored arguments. After
restart or tombstone loss, journal recovery stays callable, while retained-smoke
recovery without the original bounded envelope emits no unusable call and names
`retained_smoke_evidence` as caller-supplied prior state required to rerun.
Conformance gates carry only gate-specific data; their common evaluation envelope
appears once at page level on every page. The query has no standalone first-call
shape: callers use the executable continuation emitted by the report. There
is no live reread across pages, old full response, report-local spill, alias,
fallback parser, or compatibility export. The complete request examples,
collections, routing states, and typed refusal codes are in
[docs/mcp-operation-reference.md](mcp-operation-reference.md#authoring-ergonomics-report-operation).

This compact report/query contract is owned by `work record`.

## Controlled-contract adapter boundary

Test-proof authoring uses three dedicated package-backed operations. Use
`workspace_controlled_test_proof_authoring_describe` for the current binding
schema and closed vocabulary, `workspace_controlled_test_proof_query` with exact
same-WK verification identities for bounded selective reads, and
`workspace_controlled_test_proof_patch` for typed digest-CAS mutation. The core
and MCP layers resolve canonical carriers and transport package results; they do
not define test-proof fields, enums, defaults, migration rules, or validity.
Valid v0.2 carriers remain readable and return `migration_required`; mutation
does not perform implicit migration.

Structured validation graph authoring uses the separate
`workspace_controlled_verification_bundle_patch`, whose accepted bundle schema
version and complete required-field population are owned by
`packages/controlled-contract/lib/test-proof-contract-v1.mjs` and derived by both
the MCP schema and the authoring state's emitted template. Its input contains only the
resolved WK identity, optional focus, current carrier digest, and at most 64
strict upsert/remove operations over complete
`controlled-contract-verification-bundle.v1` values. The package applies the
entire operation population to one private clone, validates and canonicalizes
only the complete prospective stable-v1 carrier, and returns bounded typed
diagnostics. Wiki-core performs at most one CAS write, so claim-only and
proof-only intermediate state is neither returned nor persisted. This route
cannot replace an existing proof; exact proof replacement remains the dedicated
test-proof patch operation.

The structured controlled-contract routes are thin repository adapters over
the public `@agent-chassis/controlled-contract` library. Wiki-core resolves
canonical `wiki/contracts` carriers and the fixed ignored assessment store;
wiki-MCP supplies only the configured repository and existing role, schema,
response, error-envelope, compact/spill, and discovery machinery. The adapters
do not spawn package CLIs or reproduce vocabulary, validation, intent, pack,
binding, proof-plan, assessment, exact-binding, capture, or digest semantics.

Upstream obligation-source authoring and downstream acceptance-coverage mapping
authoring/inspection use the same registration and response boundary. Their
selected-unit/currentness, CAS, failure, independent row/byte bounds, pagination,
fail-loud no-spill behavior, authority, and role contract is owned by
[Acceptance-coverage MCP](acceptance-coverage-mcp.md).
That protocol also owns the two current-carrier-only atomic public mutations,
`workspace_controlled_contract_acceptance_coverage_patch` and
`workspace_controlled_contract_obligation_coverage_patch`; this integration
surface adds no handler-local role grant, operation ceiling, persistence
primitive, or fallback.

Proof-pack selection and coverage describe have no confidentiality posture.
Server resolution owns canonical identity, currentness, continuation integrity,
and atomic persistence, not secrecy or caller authorization. Those workflows
return all task-required semantic context, share reusable facts once, and page
losslessly at the active MCP transport ceiling. Opaque continuations bind the
task and current source state for ownership, freshness, replay handling, and
cross-session noninterference; they are not an adversarial security mechanism.
Neither workflow
has a raw-carrier, generic content-reference, operator-recovery, or shell
fallback. An enforced confinement backend applies the documented filesystem
scope projection; direct or otherwise unenforced execution does not. Neither
mode establishes a separate AgentChassis confidentiality posture.

The same boundary exposes the experimental read-only
`workspace_controlled_contract_integration_test_design_assess` operation. Its
strict public request contains only `{repo?, unit, focus?,
axis_applicability, declared_integration_tests, integration_scenarios,
interaction_requirements, review_questions}`. The registered schema owns that
exact accepted-key census. Any extra authority-bearing key—including carrier
digests or generations, requirements, obligations, acceptance mappings,
census populations/counts/completeness, provider identity/currentness,
outcomes, assessment state, or authority claims—is refused before repository
resolution or evaluation.

Wiki-core reuses the acceptance/obligation-coverage resolver and its canonical
currentness decisions to select the repository, WK/unit, work record,
manifest-selected controlled-contract generation, proof-plan generation and
pack, 63-row-or-current canonical obligation source, and current acceptance
mapping population. It then invokes only the registered route, exact
role/tool-profile, result-schema-state, and manifest-selected mutant census
providers. Each provider supplies its own identity, generation/digest, exact
population/count, completeness, omissions, and currentness. Unsupported axes
remain visible and non-pass; no caller population is treated as canonical.

The package evaluator is pure and preserves the five states `pass`, `fail`,
`incomplete`, `unevaluable`, and `review_only`, exact set/join denominators, and
deterministic diagnostics. One wiki-MCP response materializer owns each complete
assessment envelope for both assessment families. It reserves every adapter
field—including proof `workspaceRepo` and both families' 256-bit
`assessment_identity`—then gives wiki-core only the remaining summary
allowance. MCP returns descriptor-owned task-relevant semantic summaries and
pages: 8,192-byte final summaries and 16,384-byte/64-item detail deliveries.
These are delivery bounds, not source-row or scalar-content caps. A projection,
identity, exact count, field path, range, cursor, or currentness state that
cannot satisfy the contract fails loudly; it is never byte-cut, spilled, or
replaced by a content-reference envelope. The
operation writes no carrier, scenario, question, cursor, draft, or assessment
state and grants no proof, requirement, admission, dispatch, review,
integration, publication, or completion authority. It never substitutes for
the existing proof-plan `workspace_controlled_contract_assess` operation or the
post-integration runtime-proof operation.

Every caller input is typed and bounded. Repository roots, canonical carrier
paths, evaluation-input filenames named by a canonical proof-plan request,
package resources, profiles, capture roots, and bundle publication locations
are resolved server-side. Canonical contract/evaluation-input authoring and
package-produced proof-plan publication use exact content-digest CAS. Normal
agent authoring uses expected-absence create, bounded selective query, and typed
server-side patch; fresh sessions first request only the needed package-backed
schema target, page/filter identities, query exact nodes, patch by returned
identity, recover proof-plan metadata, rebuild by its current digest, assess,
and retrieve only targeted proof/artifact detail. Complete-carrier
read/replacement is operator recovery only.

### Controlled-contract generation-persistence lifecycle

This section is the authoritative explanation of when the controlled-contract
generation is persisted, who owns that timing, and what a persistence call
returns. The live tool description, the checked-in tool-discovery descriptor,
and [docs/mcp-operation-reference.md](mcp-operation-reference.md) point here
rather than restating the sequence.

Nonempty-write-scope managed implementation dispatch is the normal persistence
path.
`packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-managed.mjs`
is the sole runtime owner of normal generation-persistence timing: it resolves
the immutable controlled generation exactly once before persistent-WK
allocation/adoption, then binds that generation to the allocated lifecycle,
persists and verifies that exact generation, and rebinds the WK tip to the
receipt's `final_tip` before record snapshotting, slice allocation, attempt
recording, command construction, or execution binding. Empty-write-scope
findings actions retain the generation inside their immutable snapshot and do
not call this persistence owner. No implementation generation is a no-op. A coordinator
that dispatches a managed worker therefore never needs to persist the generation
itself, before dispatch or as a completion step.

For findings actions, wiki-MCP is a transport boundary only. Every accepted call
is independently authenticated and launches with a fresh run, monitor, source
carrier, and action-private materialization. Prior runs, receipts, results,
failures, roles, or metadata cannot select, satisfy, suppress, resume, replace,
veto, or refuse a later call. Run and monitor observation is process-local, so
an old findings handle may truthfully be unknown after restart. Receipts, logs,
outcomes, and provenance are optional action-local audit evidence; capture
failure cannot block another dispatch. Implementation and integration
persistence, recovery, settlement, generation, CAS, and forge behavior remain
separately owned and unchanged.

Migration-review acknowledgement is not a read-only findings prerequisite. The
same canonical reviewer or redteam unit has identical findings admission before
and after that historical acknowledgement; the implementation-worker migration
policy is unchanged. Findings results and history likewise carry no downstream
authority. Schema-valid clean and critical/blocking results, schema-invalid
zero-exit output, absent output, and execution failure cannot change later
findings or implementation admission, executor-visible implementation input,
integration eligibility, forge eligibility or input, completion posture,
canonical WK bytes, or Git refs.

The public findings result keeps four facts independent: execution occurrence,
advisory text availability/usability, optional schema conformance, and optional
formal-attestation availability. Any captured reviewer/redteam response is
explicitly usable advisory evidence, including invalid JSON, a worker-only
outcome, missing or unknown fields, extra fields, and ordinary prose. Bounded
parser diagnostics annotate the schema observation and do not emit
`invalid_result`, operator recovery, mandatory retry, or replacement guidance.
No captured text means unavailable/unusable because content is absent; a nonzero
execution with captured text preserves it as usable while separately reporting
the failure.

Ordinary calls report formal attestation as not requested. An explicit formal
attestation may be unavailable because the schema is non-adherent, but the
underlying text stays usable and retrievable. Compact status publishes a bounded
content reference and explicit coordinator guidance; full status returns the
complete response. The coordinator reads and dispositions that response normally,
and neither its content nor schema observation carries automatic lifecycle
authority.

Forge authenticates current publication state only: current candidate, exact
candidate version or controlled generation, base, current forge facts, and an
applicable authenticated CCE decision. It does not require or consume a findings
receipt, result, or provenance. Retained findings evidence is optional audit
data and cannot authorize, veto, recover, replay, replace, or settle publication.

Whole-generation persistence remains a host-only managed lifecycle primitive. It
is not registered on any agent MCP surface, role profile, discovery projection,
or routing family. Semantic operations may consume its verified receipts without
conferring access to complete carrier bytes.

Which carriers are persisted is the carrier-set manifest's decision. Canonical
authoring publishes each generation into
`wiki/contracts/.carrier-generations/<generation>/` and switches the visible
`wiki/contracts/<WK>[-<focus>].carrier-set-manifest.json` to name it.
`packages/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs` is the
pure owner of the manifest schema, canonical body and digest, exact shape, census,
member ordering, and normalized projection. Resolution, exact-`W` authentication,
slice integration, and publication independently obtain bytes at their own trust
boundaries but pass those bytes or construction facts to that owner; none parses,
canonicalizes, or reinterprets a manifest locally.
Publication uses the same owner-produced canonical bytes for embedded and visible
writes, byte comparison, and publication content digests, so an owner-level
canonicalization change reaches authoring and integration-capture publication
without a publication-side algorithm change. Carrier-set resolution remains
the owner of filesystem selection, and a published manifest is an absolute read
fence for the whole record: managed persistence, semantic controlled-contract query, `workspace_controlled_test_proof_query`, and
`workspace_controlled_contract_assess` all consume the same
manifest-selected generation that `workspace_controlled_contract_authoring_state`
reports, and none of them scans, materializes, binds, or assesses the legacy
top-level `wiki/contracts/<WK>.*` copies.
`workspace_controlled_contract_runtime_prove` reads that same manifest-selected
root generation, but from the private detached checkout it materializes at the
authenticated integrated WK tip rather than from the landing checkout. The manifest names the exact bytes;
`wiki/contracts/<basename>` remains the canonical repository identity those bytes
are persisted under on the WK ref. The legacy top-level population is read only
while no manifest is published for the record, and a malformed, incomplete, or
contradictory manifest fails typed rather than falling back to it.

Selection is not authentication. The separate
`packages/wiki-core/src/lib/controlled-contract-generation-authentication.mjs`
module is the sole owner of the authenticated-generation schema, closed tuple
validation, immutable normalization, descriptor ordering/completeness, and
manifest-selection identity. Resolution returns selection facts and carrier
descriptors but never a partial authentication envelope or a manifest identity.
The launcher exact-`W` attachment primitive performs one awaited Git observation of
the exact canonical-record, carrier, and visible-manifest blobs and passes those raw
observations to that owner. Callers and downstream coordinator, runtime, candidate,
and forge layers can transport or compare only the resulting envelope; they cannot
reconstruct it from a resolver projection, metadata, a digest, or a proper subset.
Manifest-free legacy generations retain their non-terminal compatibility but cannot
enter terminal candidate or forge mutation paths.

Terminal-review candidate binding is similarly single-owned.
`packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs` constructs
and validates `agent_launch.terminal_review_contract_binding.v1`, serializes and
digests it canonically, and owns equality/currentness comparison. The coordinator
passes its one canonical-record projection to that owner. Forge independently reads
and projects the current canonical record, passes those facts to the same owner, and
compares the owner-produced identity with the candidate binding. Candidate metadata
is transport evidence, never a substitute for forge's current canonical observation.
Forge source-record CAS and closeout comparisons use wiki-core's
`computeWorkRecordSourceDigest`; generated `derived_evidence` and `projections` do
not move that digest, while authored contract edits do.

Persistence is receipt-or-typed-error. The success shape is exactly one verified
`controlled-contract-generation-persistence-receipt.v1` for the exact complete
generation. Before that receipt is returned, the launcher re-reads every
descriptor as a Git blob reachable from the authoritative persistent WK ref at
the receipt's `final_tip`, and wiki-core validates the receipt's `record_id`,
`initiative`, `ref`, `bound_tip`, `final_tip`, `disposition`, `invocation`, and
generation count/digest/descriptors against the bound generation. Source-checkout
equality alone is never sufficient, and transport-level MCP completion is never
application success. A valid exact-winner convergence may return the verified
winner receipt; a no-op without that proof fails typed.

The empty-corpus boundary is owned by wiki-core because it is reached before a
launcher attachment request exists. It keeps its `contract_required` stage and
its exact
`workspace_controlled_contract_authoring_describe({carrier_kind:"contract"})`
continuation, but carries them inside a typed
`controlled_contract_generation_empty` refusal: a persistence call never returns
authoring state as its normal result, and neither launcher binding nor
persistence is invoked. The launcher primitive owns only persistent-ref
resolution after a non-empty validated generation reaches it. A confirmed absent
or dangling lifecycle ref exposes the typed prerequisite facts plus the supported
operator recovery route, now additionally typed as
`recovery_route_kind: "operator_lifecycle_action"` with
`recovery_route_callable: false` — that route is an operator action and is never
advertised as an MCP tool. The direct route's public refusal adds only supported
structured `next_calls`, beginning with `workspace_work_record_summary` for that
WK so an orchestrator can select and dispatch the canonical implementation unit.
An operational Git failure — a non-1 exit or a runner error — is
`agent_launch.controlled_contract_generation.git_failed.v1` and carries no
lifecycle or dispatch recovery guidance. No MCP projection copies lifecycle-ref
policy or attempts to turn empty authoring state into a launcher failure.

All public controlled-contract `focus` inputs reuse one wiki-core grammar. The
root carrier omits `focus`; a focused carrier supplies one canonical lowercase
slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Live MCP schemas and descriptions
publish that rule, and stable focus refusals return the accepted root-or-slug
form before any path or carrier resolution. Slice identities, WK/slice
addresses, paths, uppercase values, and noncanonical slugs never become
launcher or filesystem selectors.

Ordinary proof authoring starts with
`workspace_controlled_contract_authoring_state({wk_id, focus?})`. The compact
result exposes its stage, selected resource identities, unresolved decision
identities/count, disclosed non-authorizing `authoring_evidence`, and exactly one
directly callable `next_calls` entry or one `stop_condition`. Every nonterminal
state's action already binds every server-known argument and leaves only genuine
author semantics open, each enumerated with its exact pointer, target type, and
server-known compatible candidates, so no stage is advanced by guessing a shape
or by retrying a schema-discovery call.

Once the caller has explicitly selected a pack, intents, and bindings,
`workspace_controlled_proof_authoring_skeleton` returns the separately measured
evaluation-input and COMPOSED proof-plan-request skeleton. The composed request
carries the canonical selected-pack population with each pack's exact
evaluation-input basename, not just the pack being authored. Supplying the
optional `proposal_draft` alongside `requested_intents` and exactly one of
`bindings` or `evaluation_input` issues the server-held continuation; without it
the result reports `continuation_issued: false` and names the re-issue call in
`next_action`. `digests.continuation` is the package identity digest, never a
server continuation. No accepted semantic choice is sent again after skeleton
generation.

When authoring reaches `proof_graph_required`, the returned proof-graph
continuation binds the coordinator-authored proposal server-side. Executing its
published next call delegates canonical-generation composition, the live source
lease, one atomic carrier-set publication, manifest validation, replay, and
owner-local recovery to wiki-core. An incomplete proposal advances only the
server-held continuation and returns its state-derived recovery call; a stale
lease, conflicting carrier set, failed publication, or indeterminate manifest
never becomes a partial success. The MCP adapter neither reconstructs the
proposal nor writes an individual carrier. See
[Controlled-contract Operations](mcp-controlled-contract-operations.md)
for the exact route contract.

Before that sequence can converge, the authoring state resolves every
structured acceptance-validation identity and its actual canonical method. An
absent, inspection, or analysis identity yields `verification_graph_required`
with the exact identity, observed method, required `test_execution` method,
bounded missing bundle pointers, and a closed atomic-bundle argument skeleton.
The skeleton is explicitly non-executable until the caller supplies every
semantic value. A `test_execution` claim with a missing or invalid stable proof
yields `stable_test_proof_required` with the exact describe, targeted query, and
complete-replacement patch order. Neither state advertises generic carrier patch
or operator complete-carrier recovery. These checks use the canonical work-record
binding facts and stable proof evaluator shared with strict dispatch, whose
fail-closed admission behavior is unchanged.

The fixed real-MCP comparison uses these complete sequences:

```text
low level: intent discover -> pack select -> pack describe -> binding inspect ->
           evaluation-input describe/create -> request describe/create ->
           plan metadata -> plan build -> assess
task-directed: authoring state -> intent discover -> pack select -> skeleton ->
               continue evaluation input -> continue request -> plan build -> assess
```

The comparison holds the scenario fixed and varies only the call sequence: the
fixed work record low-level sequence against the task-directed sequence, both driven
over the same shared authoring scenario. That shared scenario is the work record
carriers projected under the work record workflow identity, so the benchmark does not
read or measure the canonical work record carriers. Both paths consume the identical
input, which is what makes the difference attributable to the trajectory.

The reduction comes from the trajectory itself — fewer round trips, and no
accepted semantic choice retransmitted after the continuation — not from any
response-size ceiling. Bounded projections cap individual responses; they are
not the mechanism being measured here.

`tests/controlled-contract-authoring-workflow.test.mjs` emits these
measurements. The low-level sequence measures 11 calls, 2,502 request bytes,
44,467 result bytes, 46,969 combined bytes, and zero refusals. The task-directed
sequence measures 8 calls, 1,925 request bytes, 41,573 result bytes, 43,498
combined bytes, and zero refusals. Its separately counted skeleton result is
1,764 bytes and its initial state result is 449 bytes. Both paths produce
byte-identical canonicalized carrier meaning and the same exact proof-plan pack
selection.

Result-byte totals track the proof-intent catalog, since both sequences begin
with intent discovery; the call counts and the direction of the comparison do
not. Reproduce the totals from a checkout whose `@agent-chassis/*` workspace
links resolve inside the tree under test, because those links otherwise resolve
into the surrounding checkout and measure code other than the committed state.

For structured proof-plan-request create and selected-pack upsert, callers omit
`evaluation_input_path`. Exact-pack evaluation-input create, query, patch,
operator recovery, and binding inspection use canonical `wk_id`, optional
`focus`, and the indivisible `profile_id`/`profile_version` pair. Creation
derives a disjoint basename by applying `sha256-canonical-json-v1` to the exact
profile object:

```text
WK-####.pack-sha256-<64-lowercase-hex>.evaluation-input.json
WK-####-<focus>.pack-sha256-<64-lowercase-hex>.evaluation-input.json
```

The dot-separated pack namespace cannot collide with root or focused carrier
grammar. Wiki-core validates an addressed input against only that pack. Reads,
queries, patches, inspection, and recovery prefer an exact canonical request
binding, then an existing exact-pack carrier, then the compatible legacy
root/focused carrier. Expected-absence exact-pack creation always selects the
digest namespace, which permits input-first one-pack adoption.

Request persistence composes bindings server-side. A new one-pack request
adopts a pre-existing exact-pack carrier and otherwise retains its legacy
basename. Extending a legacy request preserves its original binding and assigns
only added packs disjoint basenames; a fresh multi-pack request assigns every
pack its own basename. Existing legacy root/focused requests remain readable
and buildable without migration. Caller-supplied paths are never resolution
authority and must equal the server result when present; absolute, traversal,
alias, cross-WK, differently focused, wrong-pack, duplicate, missing, and
substrate-selecting values refuse before persistence.

Proof-plan metadata remains bounded. Missing per-pack input returns the total
missing count and the first deterministic exact-pack skeleton-description call;
the caller repeats metadata recovery after authoring that input. Absent or stale
plans return the exact build call and current plan CAS digest. Build reloads the
canonical request and all request-bound inputs, validates complete isolated role
sets, and deterministically CAS-replaces the plan, including request-only
changes. No recovery result exposes or accepts a filesystem path.

Bounded controlled-contract projections use the package-owned ceilings: 4,096
bytes for index/list results, 8,192 bytes for the complete materialized
assessment summary, 16,384 bytes for detail and census deliveries, and 64 items
per collection or structured-field page. Opaque assessment snapshots are random
256-bit identities, live for 30 minutes, use capacity 32 with expired-first LRU
eviction, and confer no path or persistence authority. They retain every
complete task-relevant public row. The existing server-authenticated cursor
owner binds collection and typed structured-field continuation to assessment
identity, exact row selector, source currentness, limits, ordinal, and expiry;
oversized scalars use identity-bound UTF-8-byte `offset`/`length` retrieval with
an exact `total`. Registered handlers forward the bounded result through the
common MCP response guard, which validates descriptor fields, exact counts,
typed continuation, and shared non-authority. An unexpected exception from
either assessment handler reaches that same boundary's common complete internal-
exception diagnostic unchanged; its eleven-field contract is defined once in
the controlled-contract operations page.

The role profile remains the sole exposure policy. All five canonical profiles
(orchestrator, reviewer, worker, redteam, and operator) expose the bounded
assessment queries and private-scope census. No profile exposes a complete
carrier, proof artifact, persistence, raw recovery, shell, CLI, filename,
JSON-pointer, filesystem path, or caller-selected raw-mode route. Assessment
scalar ranges are typed semantic continuation within the existing query routes,
not a raw byte-offset route. See
[Controlled-contract Operations](mcp-controlled-contract-operations.md)
for the exact operation population.

## Controlled-contract validator startup

The wiki MCP server's controlled-contract surfaces compile no JSON Schema of
their own, and exactly one wiki-core module loads that validator.
`packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs` is
the sole owner of controlled-contract package resolution and evaluation-input
validator loading; it resolves the validator from the repository-local
compiled-validator cache exported as
`@agent-chassis/controlled-contract/validator-cache`, which is the single owner
of Ajv construction, schema compilation, cache identity, regeneration, and
failure policy for both packages.

`packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs` used to carry a
second copy of that loader — its own package import, its own schema read, its own
validator-cache import, and its own `wiki-core.controlled-contract-tool-shared`
evaluation-input group over the identical schema, which compiled the same bytes
under a second group identity and published a second artifact for them. It now
forwards `loadControlledContractPackage` and `generationEvaluationInputValidator`
to `package-runtime.mjs`, so every existing importer keeps its exact call shape
while one schema is compiled under one declared group. Only
`wiki-core.controlled-contract-operations.evaluation-input.v1` is declared in the
package's validator population; requesting the retired tool-shared identity is a
typed `validator_cache_group_undeclared` refusal rather than a silent second
compilation.

Every memoized loader on that path — the package import, the proof-plan-request
schema read, the evaluation-input schema read, the evaluation-input validator,
and, inside the cache, its toolchain identity, its population pass, its
population status, and each per-group resolution — settles through one named
evict-on-rejection mechanism owned by
`packages/controlled-contract/lib/compiled-validator-cache.mjs` and exported as
`createEvictOnRejectionMemo`. Concurrent callers still share one pending attempt
and a successful load is still cached for the life of the process, but a REJECTED
attempt is evicted before the next authorized attempt, at every layer of the
chain. A transient fault — a read that lost a race with a concurrent publish, a
generation worker killed on a full device — therefore no longer poisons the
memo so that every later caller in the process replays the same rejection. This
is settlement policy only: it adds no circuit breaker, no retry or backoff
framework, and no public recovery action, and whether to attempt again remains
the caller's own authorized decision.

An exact cache hit loads generated validator code without constructing Ajv, so a
warm server process reaches controlled-contract readiness without the schema
compilation that previously dominated its startup. Reuse is decided per
compilation group, on a shared toolchain identity plus that group's own schema
digest; no source-tree digest participates, so editing a module that declares no
schemas invalidates nothing. A miss runs one generation pass in a worker that
compiles only the groups whose artifacts are absent or invalid, publishes each
atomically under the fixed `.cache/controlled-contract/validators` suffix of the
writing repository root, and loads those exact artifacts. The process working
context supplies its enclosing `.git` root once; package schema and runtime
bytes determine identity but the installed package and its `node_modules` tree
own no mutable cache state. Caller input, prompt text, MCP request content,
`HOME`, `XDG_*`, `TMPDIR`, and environment policy never select executable cache
content. Retired package-installation caches are not read or migrated, and no
cached code runs before its identity, containment, file type, and code digest are
verified.

Managed dispatch ensures that same cache immediately before it invokes the
family executor, so a launch never pays schema compilation inside the spawn.

This is a startup-cost change only. Conduit ordering, acknowledgement timing, MCP
byte forwarding, authentication, generation ownership, client timeouts, retries,
and close classification under `decision` are untouched. Operators who want to
warm the cache ahead of a launch, or to diagnose one, use
`node packages/controlled-contract/bin/prepare-validator-cache.mjs` as described
in `the project documentation`.

## Transport

The only model-to-server transport is transparent stdio over one launcher-minted
named-FIFO pair. The launcher creates exactly two mode-0600 FIFOs in a fresh
mode-0700 directory outside repositories and worktrees. It verifies ownership,
type, mode, directory membership, object identity, and dispatch association,
then holds Linux `O_PATH|O_NOFOLLOW` references. Bubblewrap binds those two
objects read-only at fixed launcher paths in the role's one namespace.

The client registration is frozen by family:

- Claude receives launcher-authored `--mcp-config` plus
  `--strict-mcp-config` and the role-derived `mcp__wiki__*` allowlist.
- Codex receives only launcher-authored `mcp_servers.wiki` command and args
  overrides in an isolated runtime home.

Both registrations run the same pinned base-system copy relay. The relay opens
the fixed bound FIFO paths; it does not inherit conduit descriptors. The host
wiki-MCP process directly owns the opposite FIFO ends. There is no listener,
endpoint discovery, proxy, intermediary, credential, or alternative transport.

The host process also receives one launcher-private, inherited common-proof
resolver descriptor at fixed descriptor 5. This descriptor is not part of the
model-to-server transport: `stdio-mcp-conduit-core` creates it from the
launcher-resolved workspace/store binding, unlinks its mode-private bounded
carrier, and passes only the open descriptor to the wiki-MCP process. The
versioned carrier contains only the canonical workspace directory and repository
alias. Arguments, environment, MCP input, prompts, caller paths, and generic IPC
cannot mint or retarget it. The wiki-MCP direct entrypoint consumes it once,
constructs the exact read-only resolver, and injects that function through
`startWikiMcpServer` and `registerControlledContractTools`. A standalone or
explicitly unbound server has no resolver and returns
`common_proof_capture_launcher_resolver_unavailable` for launcher-derived
capture.

The server reports its exact registered tool surface on a launcher-only pipe.
The real client must then complete MCP `initialize`, send `initialized`, and
request `tools/list`. Only after the client has opened both bound objects does
the launcher close anchors and unlink both FIFO names. Timeout, early EOF,
client/relay/server exit, type or identity mismatch, tool-surface mismatch,
cancellation, cleanup failure, and reaping failure are typed and fail closed.

For reviewer and redteam, the expected set comes only from the launcher role
profile. It retains `workspace_tools_list`, `workspace_tools_describe`, and
`workspace_tools_query` but excludes the operator-only
`workspace_frozen_review_contract_query`. Readiness compares the real confined
client's returned `tools/list` exactly: missing and extra tools both fail before
inference. The reduced population does not make any tool optional. Host
registration, configured lists, and in-process registry projections are not
client-surface proof.

Lifecycle compatibility is established by the host wiki-MCP process that was
actually spawned. Its initial launcher-only
`wiki-mcp-launcher-readiness.v2` registration includes
`lifecycle_protocol_generation: stdio-mcp-conduit-lifecycle-vocabulary.v2`,
loaded from that process's conduit contract. The long-lived launcher compares
the announcement with its own loaded generation. No request field, environment
value, filesystem fingerprint, backend generation, or historical state supplies
the comparison.

The generation names the whole launcher-only event grammar — schema versions,
required keys, permitted keys, and exact values — so any grammar change moves the
producer and consumer generations together, and new evidence takes a new schema
version instead of a new key on an existing one. Because the local transport does
not spawn the host server until a confined client has authenticated, the launcher
additionally probes the ON-DISK producer in one short-lived process immediately
before conduit construction, and refuses a mismatched or unreadable producer
there — before the family executor can spawn a confined worker, reviewer,
redteam, or orchestrator.

That same fresh-process probe imports the installed common-proof capability
consumer and compares its version with the launcher's producer version. A
version mismatch or unreadable consumer refuses before host spawn; the runtime
never attempts a permissive descriptor parse or an unbound fallback for a
present malformed capability.

Only equality permits initialize and exact `tools/list`. Old, missing,
malformed, unknown, or incompatible generation evidence returns the existing
`stdio_mcp_lifecycle_protocol_incompatible` blocker and bounded
coherent-build/restart detail. The projection preserves that originating modeled
startup identity; it does not replace it with `operator_recovery_needed`.
It authenticates no delivery, creates no review or integration transition, and
opens no retry or fallback. A legacy consumer may instead return its existing
unknown-lifecycle readiness blocker for the v2 registration, still before child
spawn.

After registration, the launcher enforces a single-generation phase machine:
await server registration/generation, server compatible, await initialize,
await exact `tools/list`, ready, client closed, and terminal (or failed).
Duplicates, close-before-readiness, evidence after close, unknown schemas, and
impossible transitions preserve the first typed failure and use the same
exactly-once cleanup settlement.

The first typed transport or tool-surface failure remains primary through child
settlement, receipt persistence, restart, status/wait, and provenance. A zero
exit or captured but invalid child payload cannot replace it with success;
`role_outcome_mismatch` is secondary diagnostic evidence only. Such an attempt
records no usable verdict, consumes no review obligation, changes no
implementation state, and cannot veto a later independently authenticated
attempt.

The public dispatch-facing taxonomy is producer-complete. Construction and
binding failures use `stdio_mcp_conduit_input_invalid`,
`stdio_mcp_conduit_family_unsupported`,
`stdio_mcp_conduit_private_root_unavailable`,
`stdio_mcp_conduit_directory_invalid`,
`stdio_mcp_conduit_fifo_create_failed`, `stdio_mcp_conduit_fifo_invalid`,
`stdio_mcp_conduit_fifo_identity_mismatch`,
`stdio_mcp_conduit_binding_consumed`, and
`stdio_mcp_conduit_stdio_shape_unsupported`.

Host-server failures use `stdio_mcp_host_server_unavailable`,
`stdio_mcp_host_server_start_failed`,
`stdio_mcp_host_server_readiness_failed`,
`stdio_mcp_host_server_startup_timeout`, and
`stdio_mcp_conduit_server_exit`. Exact role/tool verification uses
`stdio_mcp_tool_surface_mismatch` and
`stdio_mcp_client_tool_surface_mismatch`. Client lifecycle failures use
`stdio_mcp_client_readiness_failed`,
`stdio_mcp_client_readiness_timeout`, and
`stdio_mcp_client_relay_restarted`.

Namespace and teardown failures use
`stdio_mcp_conduit_requires_bubblewrap`, `stdio_mcp_conduit_cancelled`,
`stdio_mcp_conduit_cleanup_failed`, `stdio_mcp_conduit_reap_failed`, and the
family-neutral terminal projection `stdio_mcp_cleanup_failed`. Every code is
registered in `packages/wiki-core/data/runtime-blocker-codes.v1.json`, has a
production producer, and is a blocking dispatch-facing failure.

## Role authority

Tool authority comes from the launcher-resolved role profile, never prompt,
repository settings, user settings, environment, arbitrary argv, or caller MCP
configuration. Workers receive only the closed-input `commit` capability.
Reviewers and redteam are findings-only and have empty write scope.
Orchestrators receive the coordinator tool profile. Agy is unsupported for this
confinement contract and is refused before launch.

The frozen per-run binding covers family, assigned unit, role profile, worktree
identity, R union W visibility, write authority, host-server process, both FIFO
objects, exact relay registration, and lifecycle owner. A binding is immutable
and cannot be reconstructed or replayed across runs or families.

## Trusted mutations

Launcher/runtime code performs `start_launch`, `probe_run`,
`provision_worktree`, `prepare_slice_review_surface`, and `integrate_slice`
in-process. The host wiki-MCP server performs `commit_slice` in-process using
the existing closed-input, server-resolved, object-first and compare-and-swap
pipeline. Its worker tool accepts no path, ref, branch, message, author, writer,
shell, Git API, or repository selection. The orchestrator-only
`wk_forge_handoff` tool invokes the launcher-owned host executor in-process.

An exact-slice submission may deliver the authenticated base tree unchanged. In
that case `commit_slice` performs the canonical implementation-to-review
transition without publishing a meaningless suffix commit, and integration
records the lifecycle result without moving the WK ref. Integration replays
non-empty deliveries from immutable commit objects and never depends on mutable
retained-checkout cleanliness. Parent-WK review state and slice dependency state
are policy facts for the configured CCE boundary, not local chassis vetoes.
After a successful integration, current-slice cleanup uses the launcher-proven
path/ref binding and tolerates checkout dirt; a cleanup failure is reported as a
separate post-integration outcome and does not undo or relabel the integration.

When no trusted conduit plan is supplied, the generic bubblewrap planner and
spawn primitive retain their ordinary behavior.

## Node Engine and CCE result handling

The Node Engine seam has three modules and one contract between them: the API
client (`packages/wiki-core/src/lib/node-engine-api-client.mjs`) reads the
response, the admissibility interpreter
(`packages/wiki-core/src/lib/work-record-dispatch-node-engine-admissibility-interpret.mjs`)
folds it into readiness, and the registered dispatch route
(`packages/wiki-mcp/src/lib/dispatch-tools/register.mjs`) publishes it. An
authenticated Chassis Control Engine decision must survive that path exactly.

**What crosses verbatim.** The client recognizes the current closed CCE
`pack_result`, including required `schema_version`, `pack`, `operation`,
authoritative `decision`, and `accounting`; non-admit decisions also require
nonempty reasons, while recovery is optional. It publishes
`response_provenance` with exactly `schema_version`, `pack`, and `operation`
copied from that result. The interpreter carries that provenance plus the
request-contract digest and operator authority-binding evidence onto the typed
admissibility result. The MCP route publishes the complete reasons and optional
remediation under `policy_result` without adding, reinterpreting, or replacing
anything. It does not publish response-side identity, manifest-derived identity,
top-level provenance, or effect/verdict aliases; similarly named request and
anti-laundering fields remain separate contracts.

The recovery subtree crosses a stricter ownership boundary. CCE produces the
value and chooses its actions; wiki-core mechanically validates it once and owns
the typed result plus the independently retained diagnostic carrier. wiki-MCP
consumes only that typed result. It does not parse or revalidate the raw CCE
member, define a parallel recovery vocabulary, select another action, or change
the returned effect. Ordinary `workspace_validate_dispatch` output carries only
bounded diagnostic metadata; those presentation bounds do not affect
conformance. The `verbose:true` projection and ranged content-reference
transport carry the complete typed result, reasons, response provenance, and
retained recovery carrier value-identically and in producer order.

The existing `jsonContent` boundary serializes that complete envelope before it
decides whether to inline or spill. A spilled response is therefore lossless:
successive `workspace_read_mcp_content_reference` ranges reconstruct the exact
JSON bytes, including the retained recovery and its canonical digest, byte
count, member count, and ordered census. The range reader transports stored
bytes; it does not reconstruct values or acquire recovery-schema authority.
Credentials, headers, request bodies, unrelated response members, work-record
contents, and unrelated runtime state are not members of the carrier.

**Admission policy ownership.** The authoritative CCE admission state table,
including the clean authenticated-admit boundary and the separate
exact-returned-policy publication boundary, is owned by [The authority boundary
at MCP dispatch admission](enforcement-model.md#the-authority-boundary-at-mcp-dispatch-admission-wk-2316).
This integration document describes the carriers and transport only; the client
classifies the response and the interpreter and MCP route forward its typed
result without duplicating or re-evaluating that policy.

No repository runtime-blocker code, local threshold conclusion, or substituted
split/review/escalation action is generated for an authenticated needs_review or
reject. The retired `worker_admission_review_threshold_exceeded` identity — a
local threshold conclusion this repository never computed — is gone from the
active taxonomy and from every active dispatch constant and alias.

Silence and caller assertion never establish the confirmed no-authority posture.
An absent admissibility block is a missing declaration and fails closed, and the
closed authority-input schema refuses caller-supplied Node Engine authority
fields before admission.

These Node Engine and CCE states are worker-admission facts only. Findings-only
reviewer and redteam initialization does not evaluate them and cannot be blocked
by `authority_binding_unratified` or another worker-only condition.

## Work-record allocation in an orchestrator session

Use `workspace_create_record` for allocator-backed record creation in a configured workspace. Creating a `WK-*` produces the canonical inbox template only; the route accepts no caller filesystem root and no birth-time controlled contract, proof bundle, slice graph, readiness claim, or lifecycle status.

Continue through the [design-first operating model](../AGENTS.md#wk-first-work): design and review disposition precede semantic controlled-contract/proof authoring, and `workspace_work_record_ready_slice` shapes independently executable units. CCE alone owns lifecycle sequencing and admissibility. The MCP server does not implement a local readiness gate or recovery protocol for an unregistered creation operation.

The durable operation details are in [Work-record allocation and post-allocation authoring](mcp-operation-reference.md#work-record-allocation-and-post-allocation-authoring).

## Coordination preflight coverage

`workspace_coordination_preflight` is a coordination-scope check, not a launch
gate. Its result discloses every fact family a coordinator needs before dispatch
and, for each one, the evaluation origin, the local handling, and the boundary
that owns it. `local_handling` is exactly `evaluated_locally`, `projected`, or
`not_evaluated`.

Read the disclosure before treating a `proceed` as readiness. Preflight owns the
mount, writeback, route-registration, and role-consistency facts. It does not own
structural or mechanical dispatch readiness, which belongs to
`workspace_validate_dispatch`, and it does not own CCE declaration,
admissibility, or policy, which belongs to CCE. Facts it does not own are
reported as projections of their owner or listed as deferred to that owner; they
are visible rather than enforced, so neither a projection nor a deferral turns
into a local verdict or a local refusal.

Compact output carries the complete family count, the omission counts, the
deferred boundaries, and `verbose:true` on the same route as the path to every
fact family in full. The normative contract is
[Preflight discloses its coverage and its deferrals](mcp-dispatch-runtime-contract.md#preflight-discloses-its-coverage-and-its-deferrals).

## Prospective work-record preflight

`workspace_preflight_dispatch` is the read-only companion to
`workspace_validate_dispatch`. It accepts a proposed, unpersisted work-record
or slice body and returns the same readiness projection that
`workspace_validate_dispatch` returns for a persisted record. This lets an
author inspect the proposed contract before writing it, instead of persisting,
being refused, rewriting, and re-persisting one revision at a time.

This exists because admission reports one control at a time. A proposal that
trips several constraints is refused once per constraint: after the first is
cleared, the next becomes visible. While shaping this work record, a slice was
first refused for `write_scope_total_loc`; only after that was cleared did
`write_scope_count` surface behind it. The preflight exposes that sequence
before any canonical write, so authors can see the projection in advance.

The route is non-mutating with respect to canonical records and admission
sidecars. It may write only the git-ignored code-index derived cache authorized
by accepted decision section 5: the artifact and its directory, the lease
directory, and the lock, candidate-slot, lease, heartbeat, publication, and
release files. Those files may be produced on any `index_action` rebuild
verdict, not only when HEAD is stale.

The route reports whatever admission returns and defines none of it: it sets no
thresholds, verdicts, or remedy selection, and does not duplicate admission
policy. Admission remains the authority for the projection and its refusal
reason.

## Advisory tool-router continuations

`workspace_tool_router_recommend` is a compact read-only selector, not an
authority boundary. A matched result contains exactly one recommended canonical
`next_calls` entry, all server-known arguments, explicit
`required_authored_fields`, and `next_calls_completeness`. It does not append a
family inventory, disallowed catalog, or unrelated alternative. The result does
not decide readiness, admission, mutation, dispatch, lifecycle, or policy; the
named operation independently validates its request and owns every such
decision.

An ambiguous result recommends no operation. It returns ordered
`clarification_choices`; each visible choice names the exact operation, known
arguments, and missing authored fields. The unflagged calls are alternatives,
not recommendations.
`candidate_intents` and `clarification_choices` normally show at most the
configured bound, while `candidate_count_total` always reports
the exact task-selected population. If the bounded view omits candidates,
`candidate_set_complete` is false and `complete_candidate_set_next_call` is an
unflagged canonical call back to the router with `candidate_view: "complete"`.
That call returns the whole candidate set without selecting or recommending a
candidate. This is a router-specific complete-set view, not a general paging
protocol. No string or structured value is cut, and exact complete/displayed
counts distinguish the bounded projection from the complete result.

An unknown result has exactly one operative limb. When the caller already
supplied an exact discovery selector (`known_resources.task_id` or
`known_resources.tool_name`) or a docs/wiki path, `next_calls` contains one
bounded executable recovery and `recovery.state` is `callable`. Otherwise the
list is empty and `no_supported_route`, `stop_condition`, and `recovery.state`
all explicitly report `no_supported_route`; prose guidance is never the only
termination signal.

Routing uses the checked-in intent vocabulary and module-relative discovery
metadata. The intent vocabulary alone owns match phrases, semantic intent
identities, prerequisite declarations, and intent-to-operation mappings. The
assembled descriptor owns task identities, recommended-first-call metadata,
availability, and broad ordering. The generic next-calls descriptor constructs
and validates the resulting call list. The MCP adapter scopes the descriptor by
the launcher/server-minted role and tier before selection; request fields,
prompt text, argv, and ambient caller data cannot widen it. A matched but hidden
operation returns `visibility_withheld` with the closed reason
`operation_not_visible_in_session_profile`, no operation identity, no recovery,
and no refusal claim.

The router neither reads nor derives authority from repository-root
`AGENTS.md`, so construction is identical when that file is present, empty, or
absent. Responses remain task-selected and do not expose a flat tool catalog.

### work record live routing baseline

The complete delivered regression population contains eleven cases: WK
allocation, acceptance editing, controlled authoring entry, obligation and
acceptance coverage describes, explicit proof-pack selection, unknown proof
intent discovery, known-unit review dispatch readiness, known-handle
monitoring, documentation lookup, and one role-invisible operation. The
2026-09-02 baseline is classification accuracy `11/11`, first-operation/outcome
accuracy `11/11` (including the expected withheld outcome), recommended-call
count `10/11`, duplicate count `0/10`, populated server-known argument rate
`15/15`, and calls before the owning operation `0/10`. The compact JSON results
total 5,926 UTF-8 bytes under the test's sum-of-serialized-results measurement.
That byte value is trajectory evidence, not a content limit or acceptance
threshold.

## Tool input schema publication

Every MCP tool registers through the single `createRegisterTool` boundary in
`packages/wiki-mcp/src/lib/register-tool.mjs`. The SDK publishes a tool's
`inputSchema` on `tools/list` only when it recognizes an object schema — through
a zod v3 `.shape` or a zod v4 `_zod.def.type === "object"`. A zod v3 `ZodEffects`
— what `.refine()` or `.superRefine()` on a `z.object()` produces — exposes
neither, so the SDK substitutes an empty `{ "type": "object", "properties": {} }`
sentinel that carries no `$schema` key. The affected tool then advertises "no
arguments" even though the SDK's own `validateToolInput` falls back to the full
schema and still enforces every field and refinement at call time. It is a
publication-only defect: the advertised contract says "no arguments" while the
enforced contract is the full strict object plus its cross-field guards.

The boundary repairs this centrally, without editing any tool: when a tool's
`inputSchema` is a `ZodEffects` that, after unwrapping any chained effects, wraps
a `ZodObject`, `createRegisterTool` registers that inner `ZodObject` with the SDK
so its properties, `$schema`, and `additionalProperties: false` (from `.strict()`)
convert and publish, and re-runs the full effects schema inside the wrapped
handler before delegating so every refinement still rejects exactly the inputs it
rejected before (the offending field is still identified; only the rejection layer
may move from schema to handler). Plain `ZodObject`, raw-shape, and genuine
no-argument (`z.object({})`) inputSchemas are untouched, and because the fix is at
the shared boundary a future tool authored with `.refine()` / `.superRefine()` is
normalized automatically. Tool authors may therefore use refinements freely. The
`$schema`-absent empty-object sentinel on `tools/list` is the symptom to watch
for; `tests/mcp-startup-regression.test.mjs` fails on any argument-accepting tool
that publishes it.
# Stable controlled-contract routes

Controlled-contract MCP authoring is stable-v1 only. The supported sequence is
carrier validation, intent discovery, exact pack selection and description,
binding inspection, evaluation-input/request authoring, plan compilation,
assessment, generation validation, and targeted artifact reading. Paths are
server-derived from `wk_id` and optional focus; callers never supply filesystem
authority. Test-proof mutation is exact replacement of an existing same-carrier
binding and is guarded by the carrier content digest.
## Confined findings client contract (work record)

The ordinary MCP caller may provide a complete `reviewed_sha` and `diff_base_sha`
pair as an ordinary findings locator. The `subject` remains the canonical WK or
review slice, and both SHA fields are added to that same
`workspace_agent_dispatch` request. The registered boundary forwards the pair to
the same read-only normalizer used for canonical slice and terminal whole-WK
selectors. It never becomes `authority_kind: authenticated_operator` and needs no
special carrier, attestation, receipt, provenance record, or persistent review
identity. Pair validation proves only the facts needed to read the immutable
range; failures remain local to the current call.

A commit SHA supplied as `subject` is refused because it is a review locator, not
a coordination identity. The bounded refusal states that the server cannot derive
the missing canonical subject from that call and identifies the supported
same-tool correction without publishing a placeholder call. The same registered
dispatcher performs the corrected review; no external reviewer, shell command,
wrapper, alternate transport, terminal candidate, ref creation, attestation
append, or provenance repair is required.

For an operator-authorized direct-to-main review, commit the exact scoped
implementation candidate first, then call `workspace_agent_dispatch` with its
canonical subject and complete landed `diff_base_sha`/`reviewed_sha` pair. The
reviewer is read-only and never creates Git objects. Terminal-candidate status,
terminal-candidate advance, and forge handoff are not part of this route.

Reviewer and redteam confined clients must expose the exact policy-derived tool
surface before inference. It includes `workspace_tools_list`,
`workspace_tools_describe`, and `workspace_tools_query` and excludes the
operator-only `workspace_frozen_review_contract_query`. Omission of any required
tool, or addition of any non-profile tool, fails before inference with the
registered stdio client/tool surface mismatch and bounded
expected-versus-observed facts. A zero child exit cannot overwrite that primary
failure with a success-shaped findings result.

For standalone, exact-slice, and terminal findings, the shared launcher role
contract directs Codex and Claude to the assigned unit's canonical WK JSON inside
the already-bound immutable snapshot and states the exact selected unit address.
That snapshot-local unit's acceptance criteria and validation are the acceptance
source. Live `main`, inline mutable current-record bytes, and the operator
diagnostic frozen query are not acceptance sources or launch prerequisites.
Findings surfaces remain launcher-selected, exact, confined, and read-only.

Each findings dispatch remains an independent advisory action. A failed action is
not repaired or resumed, and it does not select, satisfy, suppress, or veto any
later fresh action.

Run and monitor observation is process-local. An old handle may truthfully be
unknown after restart, while a new call authenticates and launches independently.
Receipts, logs, outcomes, and provenance are optional action-local audit evidence;
capture failure cannot prevent a later dispatch. Prior actions and their roles or
metadata cannot mechanically refuse another action. Implementation and integration
lifecycle allocation, persistence, recovery, ref, CAS, and forge behavior remain
independently owned and unchanged.

## Refactor adapter and bounded transport

The controlled-contract registrar exposes
`workspace_controlled_contract_refactor_plan`,
`workspace_controlled_contract_refactor_query`, and
`workspace_controlled_contract_refactor_apply` through the
`controlled_contract_refactor` routing intent. The adapters resolve `repo` to a
server workspace and otherwise forward the exact wiki-core schemas and outcomes.
They do not accept roots or paths, reconstruct carrier state, classify graph or
coverage semantics, mint policy, or alter owner reason codes. Plan and query use
`writeSemantics:none`; apply uses whole-field replacement semantics for its
single opaque continuation.

Wiki-core returns the exact semantic binding for each next plan or receipt page.
The adapter passes that object unchanged to
`createControlledContractTaskCursorCodec`, and authenticates/decodes a supplied
cursor before invoking wiki-core. Authentication is not implemented in
wiki-core and semantic pagination is not recomputed in wiki-MCP. Malformed,
forged, expired, cross-kind, cross-resource, wrong-snapshot, and stale cursors
therefore retain the task-cursor or wiki-core semantic owner that detected them.

If one plan or receipt semantic item exceeds the 16 KiB inline item threshold,
the adapter asks the existing MCP response owner to persist only that item. The
returned `controlled-contract-refactor-item-reference.v1` embeds the existing
`wiki_mcp_response_content_reference` descriptor. Call
`workspace_read_mcp_content_reference` with successive bounded offsets to
recover the exact item and verify its byte count and SHA-256. The rest of the
page stays inline and its counts remain truthful. This helper is not available
as a generic artifact write or query API and does not change whole-response
spill behavior.

Role policy grants plan and apply to orchestrator and operator. Query is also
visible to reviewer, worker, and redteam. None of the three grants proof,
evidence, acceptance, review, dispatch, integration, publication, completion,
or CCE authority; apply's publication effect remains owned by wiki-core's
existing source lease, canonical publisher, coverage persistence, continuation,
reconciliation, and receipt machinery.
