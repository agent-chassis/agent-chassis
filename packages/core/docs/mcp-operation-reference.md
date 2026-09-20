# MCP Operation Reference

> **This is conceptual and navigation reference material.** For setup, start
> with [Quickstart](quickstart.md). For the MCP transport and runtime model, use
> [MCP integration](mcp-integration.md).

This page explains how to select operations, where their exact live signatures
come from, and which durable documents own their behavior and authority. It
does not inventory the current catalog. That catalog varies by registration,
role, tier, installation, and runtime posture, so a checked-in list would be a
stale snapshot by construction.

## Operations

There are two distinct discovery layers:

1. `workspace_tools_list` and `workspace_tools_describe` provide
   repository-local **selection metadata** for
   the current session. That metadata covers availability, authority, side
   effects, support posture, documentation routes, and the inputs advertised by
   the repository-local descriptor projection. Use the list surface for a
   paged catalog scan, filtered by `task_id` when the task is known, and
   describe for targeted detail of an exact tool name. The complete projection and continuation
   rules are owned by [Tool discovery surfaces](tool-discovery-surfaces.md).
2. MCP protocol `tools/list` owns each registered tool's live
   `inputSchema`. After selecting a tool, read that exact entry before calling
   it. The repository-local descriptor projection does not own, replace, or
   certify the protocol schema. The registration boundary and schema-publication
   rules are documented in
   [MCP integration](mcp-integration.md#tool-input-schema-publication).

These paths are lossless under [decision](../wiki/decisions/decision.json):
follow the discovery continuation until the role-visible set is complete, and
use the registered tool's `tools/list` entry for its exact request shape. A tool
absent from either the session's visibility projection or the live registry is
not made available by appearing in documentation.

The advisory router is a selection aid within those same boundaries. A matched
result contains exactly one recommended first operation, every server-known
argument, explicit caller-authored fields still required, and exact next-call
completeness accounting. It never invokes or pre-validates the owning operation.
Ambiguous results recommend nothing and preserve the exact complete candidate
set through their `candidate_view: "complete"` continuation. Role-hidden
operations are not named: the closed `visibility_withheld` outcome reports only
that the launcher/server-minted session profile does not expose the operation.

Stable operation families route as follows. These are conceptual boundaries,
not a catalog of tool names:

| Family | Durable owner and navigation |
| --- | --- |
| Repository setup, shared contract, generated views, search, and lint | [MCP integration](mcp-integration.md) and [Operating model](operating-model.md) |
| Repository, work-record, package-document, and large-content reads | [MCP repository model](mcp-repository-model.md), [Tool discovery surfaces](tool-discovery-surfaces.md), and [Work-record schema](work-record-schema.md) |
| Work-record allocation and semantic authoring | [Operating model](operating-model.md), [Work-record schema](work-record-schema.md), and the compatibility sections below |
| Controlled-contract authoring, proof, assessment, and recovery | [Controlled-contract operations](mcp-controlled-contract-operations.md) and [Acceptance-coverage MCP](acceptance-coverage-mcp.md) |
| Code index and graph-impact evidence | [Tool discovery surfaces](tool-discovery-surfaces.md) and [MCP integration](mcp-integration.md); graph output remains derived, non-canonical evidence |
| Dispatch, monitoring, integration, and terminal publication | [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) and its focused document map |
| Enforcement, authority, refusal, and recovery | [Enforcement model](enforcement-model.md), [decision](../wiki/decisions/decision.json), [decision](../wiki/decisions/decision.json), and the runtime-contract entry page |

CLI commands are a separate operator surface. Their current arguments come
from the CLI's own `--help` output; MCP `tools/list` does not publish CLI
signatures.

### Search and exact selected-source recovery

`workspace_search_repo` accepts a new query and optional semantic scope, or an
opaque continuation by itself (with the repository selector only). Limit
defaults to 8 and is capped at 50. Results report exact totals, material
diagnostics, concise previews, and executable continuation and selected-read
calls. `workspace_read_page({repo?,path,search_match,length?})` is the separate
selected-source branch for file hits; length defaults to 512 Unicode scalars and
is capped at 1024. Its opaque calls own identity and offsets, and stale or
incompatible bindings refuse before returning source text. Work-record entry
hits instead return `workspace_work_record_entry_read` calls, described under
[Durable work-record entries](#durable-work-record-entries).

## Public mechanical refusal envelope

Compatibility pointer: refusal vocabulary and recovery routing are not
restated here. Start at
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md), which is a
navigation page subordinate to decision's enforcement boundary and decision's
mechanical-failure versus returned-policy split. The focused producers and
projectors linked from that page retain their distributed ownership; the entry
page is not a sole semantic owner.

## Controlled-contract operations

The public proof surface uses ordinary semantic operations:

- `workspace_controlled_proof_intents_discover`
- `workspace_controlled_contract_obligation_coverage_upsert`
- `workspace_controlled_contract_obligation_coverage_query`
- `workspace_controlled_contract_obligation_coverage_remove`
- `workspace_validate_proof`
- `workspace_verify_proof`

Contract requirements and controlled-acceptance disposition are ordinary
upsert inputs and ordinary query outputs. Callers first query the combined
revision, then upsert authored meaning; no preparation route is registered or
required.

### Proof-intent discovery

The primary discovery call accepts no arguments or one optional search query and
returns the complete admitted proof catalogue in one
`controlled-proof-selection-catalogue.v1` response. A query ranks matches first
without filtering the catalogue. Each row includes the proof identity, version,
exact assertion and exclusions, associated intent identities, applicability
facts and a selector for optional snapshot-bound detail; genuinely shared
capability facts occur once at catalogue level. Catalogue selection has no
`limit`, pagination cursor, or content-reference continuation, and configured
generic response budgets do not fragment it. Exact `proof_name` and emitted
snapshot selectors retain targeted detail, currentness checks, and field/range
continuation for wide detail. The package owns proof names and parameter
contracts. Discovery does not select a proof or publish a plan.

### Ordinary upsert

The upsert request identifies one `unit`, carries the current
`expected_content_digest`, and may combine supported obligation changes,
`contract_requirements`, and `controlled_acceptance`. Requirement compilation
and proof-posture disposition use their existing backend owners. The mutation
settles atomically; stale CAS, invalid requirements, invalid exemptions, and
conflicting case edits fail before effects.

`contract_requirements` carries `requirements`, `retire_claim_ids`, or both.
Together they hold one to eight entries, and a supplied list is never empty.
`notes` and `unrepresentable_meaning` only supplement those entries: an answer
with neither list is refused as `controlled_contract_requirement_invalid`
before effects, with its requirement and retirement counts. The refusal locates
`$.contract_requirements` and selects
`required_object_shapes.requirement_retirement`, which states the rule. The
published declaration and the guidance overview state it too; the requirement
compiler enforces it.

The upsert's registered authoring guidance is read through
`workspace_tools_describe` `input_contract` `kind:"guidance"`. The default read
is a concise authoring overview; a literal path returns one complete topic,
such as `behavioral_example`, `runtime_test_authoring`, or
`required_object_shapes.requirement_rebinding`, and `[]` returns the complete
reference. The tool router recommends these selections for explicit authoring
help requests.

A refused upsert names what to correct. A request-schema refusal lists the
rejected request paths, and `failed_fields` gives each one a `guidance_call`
for the guidance member its location is bound to. A malformed requirement item
selects `required_object_shapes.requirement`; its `subject` and `behavior`
select the `referent` and `statement` shapes, and `modality` selects
`vocabulary.modalities`. A path outside every bound location is reported as
`request_location_guidance_undeclared`. The `structural_contract` describe call
remains named as the complete authority. A semantic
refusal keeps the owner's reason code and authority limb in
`input_contract_recovery.refusal` and lists each failed field with a
`guidance_call` selecting the registered guidance member that states its
correction; a member that no longer resolves is reported as
`guidance_unavailable`. A stale combined revision is refused with `next_calls`
naming the query that returns the current revision; the refused digest is never
resubmitted.

`failed_fields` is grouped by correction, not by occurrence. Each entry carries
one complete executable correction and an `occurrences` list naming every input
that needs it — its `field`, `field_path`, and any `code` or `claim_id` the owner
attributed. Twelve requirements broken against one rule therefore return twelve
occurrences and one `guidance_call`, not twelve copies of it; twelve genuinely
different causes still return twelve corrections. Nothing is merged whose
corrections differ, and `rejected_field_paths` still lists every affected path.
The validator's own issues are carried once, as `details.issues`.

An incomplete case is a valid atomic draft. The save receipt reports the unit,
resulting digest, and saved/unchanged counts. When the request supplies
`contract_requirements`, the receipt also carries `requirement_bindings`: one
row per submitted requirement, in submission order, with the zero-based
`input_index`, the resulting `claim_id`, and `verification_claim_id`,
`test_proof_id` and `replaced_claim_id`, each `null` when absent. The rows come
from the final requirement compilation and are returned only after the saved
state reads back, including for a save that changes nothing. Requests without
`contract_requirements` return no bindings, and refusals and
`post_commit_failure` responses never carry them.

### Query and removal

Query returns the canonical saved obligation population, case projections, and
contract inputs. Its `content_digest` and `contract_inputs.revision` are the
combined revision the upsert and removal CAS compares. The revision is `null`
only when no authored participant exists anywhere in the work record: no
obligation source for the record or a slice, no contract carrier, no validation
target on the record or a slice, and no proof posture. It supports one exact
obligation selector and bounded
continuation. When the obligation source is absent, it reports that source fact
while retaining any saved contract-input projection.

Removal accepts one obligation identity and current digest. It removes that
selection while preserving the obligation, shared case meaning, sibling uses,
and contract requirements.

### Explicit validation

`workspace_validate_proof` reports saved-source, contract-input, construction,
parameter, proof-name, and association problems without executing providers.
Grouped diagnostic detail remains bounded and losslessly selectable. Correction
uses one ordinary upsert with the returned current identity and digest.

Validation does not repeat the full contract-input projection. Every successful
response, including source-absent, selected-obligation, selected diagnostic
group, grouped root and continuation pages, carries `contract_inputs_summary`:
the saved `contract_content_digest` (null without a contract carrier),
`controlled_acceptance` `status` and `disposition`, and requirement `status`,
`total_requirements`, `reference_count`, `residue_count` and `note_count`. Its
`detail_call` is an executable `workspace_controlled_contract_obligation_coverage_query`
for the same unit and focus. The call deliberately omits obligation,
diagnostic-group and cursor selectors, so it returns the complete unfiltered
contract inputs, including requirement meaning, references, notes, residue and
proof posture, through the query's ordinary lossless delivery.

The query reads current canonical state; it does not recover an earlier
validation snapshot. When its `content_digest` equals the validation
`content_digest`, the retrieved contract inputs are the ones validation
assessed. A different digest identifies a newer contract, and the caller
revalidates before relying on matching findings.

### Saved-proof verification

`workspace_verify_proof` resolves the selected WK, slice, proof, or obligation
against the canonical saved map and the exact candidate. It binds results to the
source revision, proof definition, candidate commit, and source snapshot.
Authoring and validation execute nothing. Verification reports truthful
nonexecution when required source or runtime capabilities are unavailable.

Execution is provider-neutral. Each saved proof names its selector kind through
its providers: node:test selections run through the node:test providers, and a
provider-qualified native selection (`{provider_id, provider_version, node_id}`,
currently the installed `launcher.pytest` family) runs through its installed
native candidate, falsifier (`launcher.pytest-scalar-return`) and traversal
(`launcher.pytest-call-trace`) providers. A native form whose capability is not
installed, or a falsifier shape the installed mechanism does not support, is an
explicit `not_executable` outcome; nothing substitutes another execution.

The request accepts `subject`, optional `source: {unit, focus?}`, optional
`repo`, optional `timeout`, and the orchestrator-only `git_sha`. `timeout` is
`short` (30 seconds), `medium` (300
seconds, the default when omitted), `long` (1800 seconds), or the closed object
`{seconds: N}` with integer `N` from 1 to 2147483. No other value is coerced.

`subject` names exactly one existing saved proof selection per call; verify
several subjects with separate calls. Accepted forms:

| Form | Example | Selects |
| --- | --- | --- |
| Canonical WK ID | `work record` | The WK's saved proof population |
| Slice address | `work record` | That slice's saved proof population |
| Saved `test_proof_id` | `test-proof-00170a30e83e042b20d409d42a2bb49cd3da7cda` | Only the obligations that proof qualifies |
| Saved `obligation_id` | `ANON-BOUNDS` | Only that obligation |

A test-proof or obligation ID is located across canonical saved sources. An
unknown subject refuses with `verify_proof.subject_unknown.v1`. A subject that
matches more than one WK, or that is both a proof and an obligation in one
source, refuses with `verify_proof.subject_ambiguous.v1`. An ID that matches
more than one saved source of the same WK, such as a parent and a slice,
refuses with `verify_proof.source_tuple_ambiguous.v1`. Refusals execute
nothing. A launcher-managed worker or reviewer may select only its
launcher-bound unit.

`source` qualifies a saved `test_proof_id` or `obligation_id` with exactly one
saved source. `unit` is that source's WK ID or slice address and `focus` its
controlled-contract focus, in the same canonical forms and byte limit as
proof authoring; omitted `focus` selects the root source. The subject must exist
in that source: an unknown ID there refuses in that source, and no other source
is searched. `source` is refused with a WK or slice subject
(`verify_proof.source_subject_conflict.v1`), and malformed, null, or extra
members are refused before any execution (the registered schema, or
`verify_proof.source_invalid.v1` with the rejected field and cause). Selection
grants no execution or declaration authority: a managed worker or reviewer may
name only its launcher-bound unit (`verify_proof.source_unit_forbidden.v1`
otherwise), `git_sha` stays orchestrator-only, and a selected source without its
own executable declaration keeps `verify_proof.declared_target_missing.v1`.
Execution runs root-generation proofs; a selected focused source refuses
without executing. For example:

```json
{"subject": "test-proof-00170a30e83e042b20d409d42a2bb49cd3da7cda",
 "source": {"unit": "work record"}}
```

A bare ID refusal with `verify_proof.source_tuple_ambiguous.v1`, or a cross-WK
`verify_proof.subject_ambiguous.v1`, lists every authorized source as
`recovery.action: "select_source"` with the complete ordered
`recovery.choices` and its exact `recovery.choice_count`. Each choice is a
ready `workspace_verify_proof` call that keeps the subject and the accepted
call's `repo`, `timeout`, and `git_sha` and adds one `source`; root choices omit
`focus`. A source that cannot resolve the subject, such as a same-source
proof/obligation collision, is never offered, so a refusal may carry an empty
population. Large populations are delivered losslessly through the ordinary
spilled-response reference. The selected unit and focus are part of the
execution source binding and of a managed worker's retained request.
One monotonic execution budget starts after the canonical proof population and
its runtime bindings are resolved. Provider preparation, currentness checks and
every candidate, falsifier and traversal attempt share its remaining time;
canonical resolution, worktree provisioning and result persistence are outside
it. The MCP request cancellation signal is forwarded unchanged to the same
budget, and a request cancelled before execution starts no attempt.

When the budget expires or the request is cancelled, the running attempt's
owned process tree is killed and reaped (bounded by a five-second live cleanup
allowance), no further attempt starts, and completed results keep their facts
and causes. The interrupted proof reports `execution_status: "interrupted"`
with `verify_proof.execution_timed_out.v1` or `verify_proof.execution_cancelled.v1`;
proofs never reached report `execution_status: "not_started"` with
`verify_proof.execution_budget_exhausted_before_start.v1` or
`verify_proof.execution_cancelled_before_start.v1`. Unsatisfied aggregate
precedence is unchanged and an interruption never grants proof credit. A
failure to deliver an already settled result is reported as
`verify_proof.result_delivery_failed.v1` and never re-executes the invocation.

Removed construction, manual mapping, assessment, public refactoring, and
duplicate execution routes are unknown at the MCP call boundary. Their former
request shapes and response-kind payloads are not compatibility inputs.

## Public mechanical refusal envelopes

Compatibility pointer for the former plural heading: use
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) to navigate to
the focused refusal producer, taxonomy, projection, and recovery owners. This
page intentionally carries no second normative refusal stack.

The live runtime-blocker taxonomy registers only codes current routes emit;
retired codes are removed rather than kept as aliases. The refusal-emission
census is point-in-time evidence: its registry membership and categories are
checked against the exact taxonomy publication it was created with, held as
test-only evidence, never against the live registry and never by production
code.

## Authoring-ergonomics report operation

`workspace_authoring_ergonomics_report` is a bounded, read-only compact
diagnostic lens. It creates one authenticated immutable snapshot of the complete
semantic report and returns only task-directed summary evidence.
`workspace_authoring_ergonomics_report_query` pages or selects structured values
from that snapshot. Both are advisory: they grant no write, dispatch,
admission, review, integration, closure, or policy authority. Discovery owns
availability; MCP `tools/list` owns both exact live input schemas.

### The two source forms

The stable source boundary has exactly two forms: `workspace_errors_log`, which
reads the configured repository's fixed `errors.log`, and
`retained_smoke_evidence`, which accepts a bounded retained-smoke envelope. The
operation does not accept an arbitrary filesystem path.

Both first calls are directly executable:

```json
{ "source_kind": "workspace_errors_log" }
```

```json
{
  "source_kind": "retained_smoke_evidence",
  "retained_smoke_evidence": {
    "schema_version": "authoring-ergonomics-retained-smoke.v1"
  }
}
```

The live schema owns the complete retained-smoke payload and its bounds.

### Compact initial response

The initial response carries source kind, redactions, coverage class and
limitations, snapshot identity/currentness/expiry, event/workflow/episode
denominators, evaluated and unevaluable check counts, finding and cluster
totals, severity/category/owner-state summaries, stable vocabularies, and a
complete nested-field omission inventory, including the conformance evaluation
envelope rather than only its gates. It contains exactly one recommended `next_calls`
entry for the query route. It does not contain episode evidence, finding or
cluster rows, full classifications, raw events, an old full response, or a
report-local content reference.

### Typed inspection

The closed query collections are `coverage_declarations`, `workflows`,
`episodes`, `metric_entries`, `finding_observations`, `clusters`,
`axis_classifications`, `conformance_evaluations`, `owner_routing_results`, and
`diagnostics`. The query requires prior report state and is invoked through the
executable continuation that report emits; it has no standalone first-call
placeholder. A direct query binds `source_kind`, `snapshot_identity`, and
`collection`, while cursor continuation retains the declared `source_kind`.
`selector` narrows a stable row; `cursor` is exclusive with
identity, collection, selector, range, and caller paging inputs. A selected
scalar may use `field_path` with paired byte `offset` and `length`. Every page
reports exact `total`, `offset`, `returned`, `remaining`, and `continuation`.
The published `complete` field means exactly that no rows remain after the
current page (`remaining === 0`); it does not mean that the current response
contains the whole selected population. A terminal continuation page therefore
has `complete: true` even when its `offset` is nonzero. Conformance gate rows
contain only gate-specific fields; their shared `evaluation_context` appears
once at page level on every direct or continuation page.

Selected findings carry stable identity, severity, category, symptom, deciding
facts, whether owner routing was performed, owner-routing state and resolved owner where present, exact evidence
selectors, and the supported next inspection. Ordinary finding retrieval uses
neither base64 nor whole-response reconstruction.

### Semantic authoring recovery

Recovery follows the owner and supported next call returned for the observed
condition. The report operation's closed semantic refusal vocabulary is `request_invalid`,
`unknown_request_field`, `caller_supplied_path_or_authority_rejected`,
`source_selection_missing`, `source_selection_ambiguous`,
`unsupported_source_kind`, `retained_evidence_missing`,
`retained_evidence_invalid_type`, `workspace_root_unresolved`,
`errors_log_unavailable`, `errors_log_unreadable`, `errors_log_too_large`,
`adapter_refused`, `trace_refused`, and `conformance_refused`. An upstream
semantic-owner refusal remains nested as that owner's refusal rather than being
renamed here. Public query-mechanics refusals use the canonical public envelope
and registered codes `authoring_ergonomics_snapshot_unavailable` and
`authoring_ergonomics_query_invalid`. Expired or evicted state with an authenticated
tombstone returns the initial report rerun route and its complete stored arguments.
After restart, tombstone loss, or an unknown identity, journal recovery remains
callable because the server can reread its fixed source. Retained-smoke recovery
without the original bounded envelope emits no report call: the refusal identifies
`retained_smoke_evidence` as caller-supplied prior state required to rerun. A diagnostic does not
authorize raw edits, shell substitution, or a different lifecycle operation.

### Coverage honesty

The report must disclose what it examined and what it omitted. Missing required
coverage is reported as `unevaluable_missing_coverage`; it is not silently
treated as success. Compact output is acceptable only with complete counts and
the typed retrieval route required by decision. Failure-only coverage and every
unevaluable check remain individually inspectable.

### Dynamic ownership routing

The report projects the owner of each causal cluster rather than maintaining a
second static ownership table. Follow the linked durable contract for behavior
and use live discovery for current availability. The exact result states remain
`owner_resolved`, `owner_unresolved`, and `lookup_degraded`; degraded evidence
never becomes an ownership gap. Routing is attempted for at most 1,000 clusters.
A cluster beyond that bound reports `owner_routing_performed: false` with null
routing state and owner; no lookup occurred, so it is not labelled degraded.

### Typed outcomes

Typed outcomes remain evidence produced by the operation. The neutral snapshot,
cursor, paging, and scalar-range mechanics live below wiki packages in
`@agent-chassis/controlled-contract`; wiki-owned page projection and byte
measurement are injected. The current contract has no aliases, shims, dual
responses, fallback parser, deprecated entrypoint, migration window,
compatibility-only export, or legacy full-response preservation.

The current compact report/query contract is owned by `work record`.

## Managed-run terminal semantics

Managed-run state is larger than child-process exit. Monitoring, post-worker
settlement, exact-target review preparation, integration continuation, and
terminal publication have separate owners. Start at the
[runtime-contract document map](mcp-dispatch-runtime-contract.md#canonical-document-map),
then follow the focused pages for
[launch and admission](mcp-dispatch-launch-and-admission.md),
[managed-run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md), and
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

The focused observation route is:

- `workspace_agent_run_status` observes a canonical subject and optionally an exact retained backend run id. Omitted `timeout_ms` performs one immediate observation; an explicit integer from 1 through 300000 waits within the same mechanical call budget and returns `settled:false` on expiry without cancellation. A client or harness may keep that one call running after its foreground display bound; while the call remains pending, continue the same call/task identity rather than submitting another status request. Only an actually returned `settled:false` response starts the documented later-call continuation. `include_final_result:true` returns the complete existing public result projection. The two read-only detail modes page complete failure history or attempt summaries with snapshot-bound cursors and cannot be combined with a timeout. Ordinary observation is **Not read-only for a managed exact-slice worker run**: observing a terminal managed worker with a committed delivery requests canonical committed-slice integration for that exact subject and may advance only that attempt's post-worker lifecycle. It never requires, prepares, or dispatches a review; review is available only through an explicit `workspace_agent_dispatch`. Historical attempt selection and detail reads never advance it. Side effects: `workspace_write`, `record_write`. The former public run-list and run-wait operations are retired. Detailed selection, restart, durability, failure-history, timeout, and cancellation rules belong to [Subject-addressed observation and lifecycle side effects](mcp-dispatch-monitoring-and-ownership.md#subject-addressed-observation-and-lifecycle-side-effects).

Three facts are
reported separately and must not be conflated:

- `child_terminal` — only that the dispatched **child process** reached a
  terminal state.
- `terminal` — the **complete managed run** is finalized.
- A finalized
  projection is the only stable terminal result.

Polling a
terminal managed worker advances its launcher-owned post-worker lifecycle; it
is not merely a passive child-process query. The focused monitoring contract
owns the detailed result fields, lifecycle-resolution ring, timeout behavior,
and replay rules.

Exact monitor inputs come from MCP `tools/list`. The result's stable status,
blocker, and supported next call govern continuation; callers do not reconstruct
run identity or transfer authority between operations.

### Findings-sensitive closeout continuation

Findings and no-findings results are advisory evidence. They neither authorize
nor veto integration or publication. Continue only through the exact
coordinator action returned for the settled target, as documented by the
focused runtime owners linked above.

## Bounded selected proof retrieval

The ordinary obligation-coverage query owns bounded selected reads. Callers use
its returned cursor and selectors to recover exact saved obligation, case, and
contract-input detail. No public raw-carrier or separate carrier-query route is
part of the current contract.

## Compact-first work-record reads

Work-record reads use compact selection views for routine retrieval and expose
a documented complete path for selected or full content. The lossless
projection rule is decision; the durable shapes and canonicality rules are in
[Work-record schema](work-record-schema.md) and
[MCP repository model](mcp-repository-model.md). Live opt-in fields belong to
the selected operation's `tools/list` schema.

A default `workspace_work_record_summary` read of a root or slice unit, and a
default `workspace_read_page` read of a canonical WK path (optionally with
`selected_slice`), return only `{ok,unit,status,summary,next_calls}`: the
selected unit's actual status, its title bounded within a 1,024-byte payload,
and at most three `{tool,arguments}` calls pinned to the server-resolved
repository and unit. The calls read the unit's notes, else tasks, else root
summary text; its entries or, for a root, its slices; and its `details` menu. A
call the session role cannot make is not emitted. The default carries no
summary matrices, digests, acknowledgment tokens or lifecycle advice. A missing
slice keeps its `missing_slice` diagnostic on the summary route and its
selected-identity refusal on the page route.

`details:{offset?,limit?}` (default 3, maximum 5) is a live page of the
role-visible selected routes for that unit, in fixed order: enrolled ordinary
fields, entries, root slices, root contract fields, and the unit's members.
Each page reports `total_count` and at most one next-page call. A menu holds no
snapshot, revision or cursor, so a caller wanting a fresh complete inventory
restarts at offset 0; content reads still enforce source currentness. `details`
excludes every other scoping argument.

Ordinary agent reads have no whole-record, full-summary, raw, or verbose mode.
`accept_full_read`, `compact_read_token`, `include_record`, `include_raw`,
`verbose`, and `include_full_summary` are not arguments of
`workspace_get_record`, `workspace_read_page`, or
`workspace_work_record_summary`, so each fails schema validation for small and
large records alike. `include_body` remains a Markdown page-body read and is
refused for canonical WK, IN, and DEC records and their Markdown projections.
Its published parameter names the alternatives: `member:{path}` for record
content, and, on `workspace_read_page`, `entry:{entry_id,include_body:true}` for
one entry body. It does not combine with `member`, `entry`, or
`content_reference`.

Top-level `expected_source_digest` has two modes. On `workspace_get_record` and
the summary route it pins a slice enumeration and requires `slice_offset`,
`slice_limit`, or `slice_status`. The summary route also accepts it with
`ordinary_field`. A member read never uses it: `member.expected_source_digest`
pins member pages, and `workspace_read_page` publishes no top-level digest.
There, a top-level digest is refused as `tool_input_validation_failed` with the
validator's report unchanged. `diagnostic.digest_placement` names the selected
read, the placement that pins it (`member.expected_source_digest`,
`entry.expected_source_digest`, or none), and every accepted placement. `next_calls` offers the same read
without the digest when that request is valid. The digest is never moved into a
selector or applied.
Explicit selected reads remain: `selected_record:true` returns the root contract
fields, slice paging the root's slices, `selected_slice` a bounded slice
projection, and ordinary fields and entries their own routes.

`member:{path, offset?, limit?, length?, expected_source_digest?}` reads one
current member of a canonical WK, a selected slice (`selected_slice`, or
`unit:"WK-####"#slice-id"` on the summary route), an initiative, or a decision.
Path segments are exact own object keys (strings) and array indexes (integers);
`path: []` selects the record or slice itself. There is no dotted-path parsing,
wildcard, or recursive expansion. A container answers with its complete
immediate-member total and a page of immediate descriptors (key or index, kind,
string length or member count, and an exact member call), default 25 and
maximum 50, fitted to the normal read target unless `limit` is explicit and
then to the 8,192-byte compact bound. A string answers with one Unicode-scalar
range, default 512 and explicit `length` up to 8,192, fitted the same way, with
at most one continuation. Other JSON values are returned directly. Descendant
values and sibling bodies are never included. Every result carries
`source_digest`; every emitted call pins it, and a changed record refuses the
continuation with `stale_source_digest` and a fresh call. A missing member, a
path segment of the wrong type, or an out-of-range offset refuses with
`record_member_path_missing`, `record_member_path_type_mismatch`, or
`record_member_range_invalid`, and names the nearest containing member's call.
Compact IN and DEC reads advertise the root member call as their recovery for
every omitted member.

Summary reads resolve their repository through the same frozen-aware resolver
as page and entry reads, with the same alias and binding refusals. Reviewer and
redteam findings prompts for a WK unit request snapshot acceptance as one
`workspace_read_page` member read of `["acceptance"]` on the canonical path,
with the bare `selected_slice` for a slice; the agent follows the returned
member calls for criteria and validation. For a slice the prompt also names the
same read of the parent record. Those reads and every call they return resolve
the launcher-bound review materialization, so later changes on the live
repository do not change them.

## Work-record allocation and post-allocation authoring

Allocator-backed creation produces an inbox record, not an executable contract
or readiness claim. Design, review disposition, semantic controlled-contract
and proof authoring, and independently executable slice shaping occur through
their owning operations. [AGENTS.md](../AGENTS.md#wk-first-work) owns the
repository workflow; CCE owns action sequencing and admissibility. Local wiki
operations do not acquire that authority.

## Atomic ready-slice contract

Ready-slice authoring is one semantic, atomic work-record operation for a
complete independently executable unit. It is not arbitrary JSON patching and
does not accept caller-selected write authority. The canonical work-record
shape belongs to [Work-record schema](work-record-schema.md); the exact live
request object belongs to MCP `tools/list`.

### Published JSON Schema and runtime-owned rules

The published work-record schema owns durable record structure. Runtime-only
validation, identity resolution, and atomic-write mechanics stay with the
registered operation and are not redefined by this reference.

### Selector and control fields

Selectors identify a canonical repository and unit; concurrency controls bind
the intended source generation. Consult the live `tools/list` schema for the
currently accepted fields and the operation result for typed stale-source or
identity recovery.

### Slice payload fields

Slice payload semantics are defined in [Work-record schema](work-record-schema.md).
The three registry-owned prose destinations are `sections.summary`,
`sections.why_it_matters`, and `sections.agent_notes`. Slice upsert accepts them
inside `slice.sections`; ready-slice accepts the corresponding top-level
`summary`, `why_it_matters`, and `agent_notes` shaping inputs. Every supplied
value uses the same closed `{text}`, `{ref}`, or flat nonempty `{parts}` carrier,
is resolved while the writer lock is held, and persists only the resulting
string. Bare strings and string arrays are not accepted authoring forms.
`agent_notes` resolves to at most 8,192 UTF-8 bytes; the other two fields do not
share that bound. Omission preserves an existing value, slice `sections` merge
key-wise, and unrelated direct slice keys remain untouched. On creation,
omitted optional prose fields remain absent. The complete live request shape
remains reachable through `tools/list` and targeted verbose discovery.

#### Omission-first target authoring

Optional target detail is omitted unless the contract needs it. An omission is
not a wildcard grant: the owning schema and runtime derive or validate what the
operation can safely resolve.

### Atomicity, generations, and digests

One accepted semantic authoring call performs at most one canonical record
write. Source digests protect against stale mutation; server-derived generations
and identities are not caller authority.

Current WK and slice content remains editable through the ordinary editor,
root-addressed slice upsert, and `workspace_work_record_ready_slice` regardless
of submission or completion status. Status is not an edit lock. A purpose change
is a `new_generation` and requires contract-dependent artifact reassessment;
same-purpose editing does not rebind or rewrite prior execution, commit, review,
or evidence identity and does not start execution. Canonical schema, identity,
confinement, source-digest CAS, transactional persistence, retained-entry
history, and archival review-provenance guards still apply. In particular, a
mechanically valid slice may be deleted at any status, while deletion that would
remove protected retained history is refused by that history owner.

### Save acknowledgement and detailed nonclean results

`workspace_work_record_ready_slice` acknowledges the save; it does not return a
transaction or readiness inventory on a clean result. A clean known-slice
update or semantic no-op returns exactly `{"ok":true}`. Clean creation returns
exactly `{"ok":true,"slice_id":<actual server-allocated ID>}` so the caller can
select the saved unit. `ok` means only that the caller-authored slice data was
saved cleanly. It does not certify proof, policy, dispatch, integration, or
lifecycle readiness.

Actionable core or reload warnings, structural blockers, pre-write refusals,
failed or uncertain publication, and supported required recovery remain
detailed nonclean results. Their diagnostics, publication/effect certainty,
selected identity, and recovery instructions are not reduced to the clean
acknowledgement. The bounded `ready_slice_diff_truncated` advisory described the
retired changed-path inventory and does not cause that inventory to be rebuilt.

The operation still performs at most one core mutation. The backend remains the
owner of strict validation, optional source-digest and private-snapshot
concurrency guards, server allocation, persisted-diff checks, persistence,
proof-posture classification, and generation processing. The route reloads the
persisted record and evaluates the existing structural projection before it
classifies a result as clean; it does not invoke dispatch, CCE, proof execution,
or another persistence owner.

Saved slice details remain available through `workspace_work_record_summary` or
`workspace_read_page` with `selected_slice`. Those current reads also provide
the current `source_digest` when a caller wants a later optional-CAS write. The
extra current read is deliberate; callers must not reconstruct a retired
ready-slice transaction inventory.

### Forge-confirmed completion

Forge-confirmed completion belongs to the configured forge and terminal
publication lifecycle. Work-record authoring cannot manufacture merge evidence
or bypass the exact-candidate route. Follow
[Terminal review](mcp-dispatch-terminal-review.md) and the runtime-contract
entry page for navigation.

- `workspace_wk_forge_handoff` publishes an already-reviewed exact candidate through the launcher-owned forge route. Cold recovery reads only `refs/agent-launch/terminal-current-v2/<WK>` and accepts an already-present, directly commit-valued raw target. If that ref is absent, cold recovery fails closed with `terminal_candidate_recovery_current_ref_absent`; construction from absence belongs only to the hot post-worker lifecycle, where absence is the expected-old CAS state. Findings remain advisory and caller input supplies no forge authority.

## Contract-edit compact default, verbose opt-in, stale-source protection, and validate-before-write

Work-record contract edits are narrow semantic operations: they validate the
resulting canonical record, use stale-source protection when supplied, and
write at most the owned surface. Compact results provide the normal
continuation; full/debug retrieval remains an explicit, lossless path. Exact
operation fields are live `tools/list` data, while durable record semantics are
owned by [Work-record schema](work-record-schema.md).

### Durable work-record entries

`workspace_work_record_entry_upsert` creates an addressable entry or appends a
new immutable version. Every mutation requires `expected_source_digest`.
Creates require `unit`, `title`, and `content`; updates require a returned
`entry_id`. The content grammar is the same closed reusable-text union as the
ordinary editor. `workspace_work_record_entry_read` accepts `repo?`, `unit`,
and exactly one closed branch: entry metadata (`limit`, `offset`,
`expected_source_digest`); `entry_id` with `view:"history"` and the same paging
fields; selected metadata (`entry_id`, optional `version`); a body page
(`include_body:true`, optional `version`, `offset`, `length`); a reference
(`reference_only:true`, optional `version`, `offset`, `length`); an initial
selection (`selection:{text}`, optional `version`); or a returned
`continuation`. Fields outside the selected branch, invalid numbers, and the
retired `wkentryread.v1` page cursor refuse before any source is read. Bodies and
references are returned only when requested. An uncertain publication is
reconciled through canonical reads; there is no create-replay key or receipt
mode.

A completed managed reviewer/redteam result exposes a bounded reusable source
reference for its exact original advisory text through ordinary status/wait
monitoring. Supplying that ref as entry content captures the literal text and
original run/value provenance under the incumbent monitor-handle, caller,
subject, repository, and source-access checks. Unavailable, expired, changed,
corrupt, and denied sources remain distinct failures. The ref is neither an
attestation nor acceptance and grants no authority after capture.

Entry titles are nonempty Unicode-scalar strings capped at 256 scalars and
1,024 UTF-8 bytes; optional kinds are capped at 64 scalars and 256 UTF-8 bytes.
Create content must resolve to at least one scalar, including when it is a
reference or composition. Updates may publish an empty version, and returned
zero-length ranges remain valid reusable references. A body read without
`length` returns the complete remainder of the version, and an explicit `length`
or reference range accepts any positive safe integer. Entry/history metadata pages default to 25
rows and request at most 50; exact selection literals are nonempty and at most
4,096 UTF-8 bytes. There is no entry-specific graph,
version-size, or retained-storage quota beyond the shared interface, schema,
safe-integer, and canonical persistence limits.

Successful create, update, and no-op responses contain compact publication,
digest, entry/version identity, and immutable-reference fields, never the full
WK or entry bodies. Successful reads return `ok:true` and only the requested
facts. Entry pages return `{source_digest,offset,total_count,entries,next_calls}`
and history pages also return `entry_id` with `versions`; each row carries its
entry or version identity, title, kind, and one `next_call` opening that exact
immutable version. Limits default to 25 and cap at 50, offsets default to 0, and
a later page must supply `expected_source_digest`; a generation change refuses
with `stale_source_digest` and one call to the fresh first page. Selected
metadata returns scalar/UTF-8 lengths and at most three calls: body, reference,
and history.

Body pages return `{entry_id,version_id,body:{value,offset,length,total},next_calls}`
with exact text. Without `length` the body is the complete remainder from
`offset` and `next_calls` is empty. An explicit `length` returns exactly that
many scalars, or the remainder when fewer remain, and one continuation when text
remains. A later page must name its `version`, an offset equal to the total
returns an empty body, and a larger offset refuses with
`work_record_entry_range_invalid`. The continuation pins the version, the next
offset, the requested length and the source digest; a changed generation refuses
it with `stale_source_digest` and one fresh call for the same immutable version,
offset and length, which reads the same text after current advances or the
server restarts.
`reference_only` returns `{entry_id,version_id,reference}` for the whole version,
for `offset` to its end, or for an explicit range, without echoing the body.

Metadata and choice results target 2,048 serialized UTF-8 bytes by shrinking
rows or choices; one item that cannot fit is returned alone. Every result other
than a body, including refusals, fits 8,192 bytes in both structured and
model-visible carriers or becomes the bounded compact refusal. A body carries
the selected text with no reader byte or scalar cap. The general MCP response
boundary returns it inline when the complete two-channel result fits the
configured inline limit (128 KB by default) and otherwise spills it once behind a
content reference that `workspace_read_mcp_content_reference` reads losslessly. Returned calls
contain only `tool` and `arguments` and retain the server-resolved repository,
including when the initiating request omitted `repo`.

Spilled delivery is lossless but not free, because a content reference is read
in pages of its `range.max_length`. Measured through the deterministic stdio
fixture, counting serialized JSON-RPC frames rather than tokens: a 360 KB entry
body returns in one call plus 27 content-reference reads, about 1.21 MB of
response frames, while explicit 25,000-scalar pages read the same text in 8
calls and about 1.05 MB; a 16 MB entry body returns in one call plus 1,025
content-reference reads, about 45.8 MB of response frames, at a 16,384-byte page
size. These are samples from one fixture, not a threshold: a caller that needs
only part of a large version, or that wants fewer round trips once a result
spills, requests an explicit `length`, and the default stays the complete
remainder with no reader cap.

A unique selection returns `before_ref`, `match_ref`, and `after_ref`. An
ambiguous selection refuses with `work_record_entry_selection_ambiguous` and a
`selection` of `state`, `total_count`, `offset`, and `choices`; each choice has
its occurrence, offset, length, and one `next_call`, and the top-level
`next_calls` holds only the next choice page. Choice calls carry a `continuation`
of the form
`wkchoice.v2.<entry>.<version>.<literal_start>.<literal_length>.<choice_offset>.<occurrence|->.<checksum>`,
with canonical decimal slots and an unpadded base64url SHA-256 checksum over the
JSON array of the prefix, resolved repository, unit, and the six slots. The
checksum detects corruption and a different repository or unit; it grants no
access. The literal is rebuilt from its immutable extent rather than repeated, so
an accepted 4,096-byte literal keeps every choice call small.

The ordinary editor and ready-slice route accept `sections.material_refs` (the
ready-slice request field is `material_refs`) using the shared immutable-entry
schema. Authoring binds each reference to the server-resolved workspace
repository: a reference naming another repository is denied, and authoring
without that identity refuses nonempty material. Authoring does not traverse
sources; source closure and the 16-reference/65,536-byte combined limits are
checked when material is prepared. Worker briefs and reviewer/redteam descriptors
resolve the same ordered, deduplicated material against the launcher-configured
repository, never an identity taken from a reference or `record.repo`, and freeze
its identities, provenance, and exact text. Historical decision whole-version
references resolve their original version, with the resolved length as extent.

The local operator command `wiki work-record-render agent-brief` renders the
same material when the operator supplies `--repository <alias>`, the namespace
configured for the selected `--dir` (the alias that `WIKI_MCP_REPOS` or the
workspace alias maps to that directory). The CLI does not infer it from a
reference, `record.repo`, or the directory name, has no default, and refuses a
supplied option without a nonblank value. Without the option, a brief with no
material renders unchanged, while nonempty material refuses with
`work_record_material_repository_unavailable`; a reference from another
namespace refuses with `work_record_material_source_denied`. The option is local
render configuration only: it does not override MCP server or launcher identity
and grants no read scope, role, admission or lifecycle authority.

Lexical preparation obtains entry bodies from
`projectWorkRecordEntrySearchSources({record,repository,dir,history,loadWorkRecordById})`.
The default population contains each root- and slice-owned current version;
`history:true` includes every retained version. The producer returns
`{descriptors, diagnostics}`: each selected version whose content cannot resolve
contributes one diagnostic carrying the resolver's code with its `unit`,
`entry_id`, and `version_id` instead of a descriptor, and unexpected errors
propagate. `searchRepo` refuses `history:true` without a repository identity
with `work_record_entry_search_requires_repository`. Each descriptor carries exact
rendered text, scalar/byte lengths, an immutable full-body reference, and a
root-first, first-seen closure of retained entry/version identities bound to
canonical version-content digests. Assignment `material_refs` do not add source
documents. Search-owned callers obtain an executable
`workspace_work_record_entry_read` call from
`buildWorkRecordEntryBodyReadCall({repository,unit,entryId,version,offset,length})`;
the entry owner returns the explicit version-pinned body request, and the
registered reader validates the range and returns the selected body.
`workspace_search_repo` returns those calls unchanged for each entry hit, one
starting 160 scalars before the match and one from the version start, together
with the version's unit, entry and version identity, reference, lengths, and
source closure. `workspace_work_record_entry_read` resolves its repository
through the same frozen-aware read resolver as search and page reads;
`workspace_work_record_entry_upsert` keeps configured-workspace resolution.

### Bounded ordinary authored-field editor

`workspace_work_record_edit` is the single general MCP facade for ordinary
authored fields. It accepts one strict registry-derived request variant.
Ordinary scalar fields outside the reusable-text enrollment use
`{kind:"scalar",field,action:"replace",value:string}`;
`{kind:"list",field,action:"replace",value:string[]}`;
`{kind:"list",field,action:"append",value:string}`; or a task request on
`sections.tasks` using `mark_done` (one `text` or `index` selector),
`replace_text` (selector plus `value`), or `append_todo` (`value`, no selector).
For root/slice `sections.summary`, `sections.why_it_matters`, and
`sections.agent_notes`, and both task-text value positions, `value` is exactly
`{text:string}`, `{ref:opaqueReturnedString}`
or `{parts:[...]}` with one to 256 flat `{text}`/`{ref}` leaves. Bare public
strings, mixed or unknown members, null, nested/empty parts and invalid Unicode
refuse. Empty literal text is structurally valid; the destination planner still
owns nonempty and size rules. Extra properties refuse.

The editor publishes a compact informational declaration and points directly to
`workspace_tools_describe({tool_name:"workspace_work_record_edit"})`. That
targeted read returns a schema-validated complete-notes replacement example,
the common request keys and replacement effects, the current field count, and
callable field-detail and first-inventory-page requests. Add
`input_contract:{kind:"field",field,scope}` for one field/scope contract, or
`input_contract:{kind:"fields",offset?,limit?,expected_source_digest?}` for the
bounded inventory. The selector requires this exact `tool_name`, permits no
`task_id`, and uses the nested limit rather than describe's top-level limit.
`verbose:true` on the named describe call losslessly restores the complete
enforced union and labels route-enforced constraints that are not structural
Zod checks. The same describe `input_contract` union also has a
`kind:"guidance"` alternative that returns complete registered authoring
guidance of other compact tools, the overview by default or the value at a
literal path; the editor registers no such guidance. A guidance selection
requires one exact `tool_name` and cannot combine with `task_id`, top-level
`limit`, or `verbose:true`; `verbose:false` is accepted. The published selector
states this rule. A conflicting request is refused as
`tool_input_guidance_arguments_conflict`, and its recommended call repeats the
same selection without the conflicting arguments.
See [Tool Discovery](tool-discovery.md#ranking-and-query-behavior).

Inventory pages retain the discovery projection owner's count and byte limits
and its `total_count`, `returned_count`, `truncated_count`, `offset`,
`next_offset`, and `has_more` vocabulary. Follow the returned call exactly. A
nonzero offset requires the prior page's `editor_input_contract` source digest;
a changed source refuses before returning rows and supplies a fresh page-zero
call. The digest covers the complete registry- and schema-derived editor input
contract, has no time expiry or server-side cursor, and is distinct from the
editor mutation's top-level `expected_source_digest`, which guards one canonical
work record and is checked before no-op detection.

`WORK_RECORD_EDIT_FIELD_REGISTRY` is the sole field vocabulary. The following
table is its complete durable projection.

| Registry entry | Kind | Scope | Actions | Value | Owning planner |
| --- | --- | --- | --- | --- | --- |
| `title` | scalar | record | replace | trimmed non-empty string | `editWorkRecordByUnit` |
| `priority` | scalar | record | replace | `critical\|high\|medium\|low` | `editWorkRecordByUnit` |
| `owner` | scalar | record | replace | trimmed non-empty string | `editWorkRecordByUnit` |
| `sections.summary` | scalar | record, slice | replace | exact content | `editWorkRecordByUnit` |
| `sections.why_it_matters` | scalar | record, slice | replace | exact content | `editWorkRecordByUnit` |
| `sections.agent_notes` | scalar | record, slice | replace | exact content, destination at most 8,192 UTF-8 bytes | `editWorkRecordByUnit` |
| `tags` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.scope.items` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.scope.out_of_scope` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.references` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.material_refs` | list | record, slice | replace, append | `{ref}` object array, at most 16 / one `{ref}` object | `setListField` |
| `read_scope` | list | record, slice | replace, append | string array / one string | `setListField` |
| `repo_paths` | list | record, slice | replace, append | string array / one string | `setListField` |
| `write_scope` | list | record, slice | replace, append | string array / one string | `setListField` |
| `depends_on` | list | record, slice | replace, append | string array / one string | `setListField` |
| `related` | list | record | replace, append | string array / one string | `setListField` |
| `blocks` | list | record | replace, append | string array / one string | `setListField` |
| `acceptance.criteria` | list | record, slice | replace, append | criterion string or `{text, verification_method?, evidence_target?, facet_provenance?}` array / one criterion | `editWorkRecordByUnit` |
| `acceptance.validation` | list | record, slice | replace, append | note string or `{note, verification_ids}` array / one note | `planAcceptanceNarrativeValidation` |
| `sections.tasks` | task | record, slice | mark_done, replace_text, append_todo | bounded task union; text values use exact content | `setWorkRecordTaskByUnit` |

Scalar edits replace only the selected address. List action `append` adds exactly one
entry and an identical entry is a digest-stable no-op. Task replacement
preserves status; task action `append_todo` creates one `todo` entry. Resolved
task text refuses when trimming would change it, so exact content never reaches
the task planner through silent normalization. Existing-slice upsert
refuses supplied `sections.tasks`, while new-slice creation may provide its
initial tasks. `workspace_work_record_edit` delegates list operations to the
shared `setListField` planner. The operator `set-list-field` CLI uses the same
planner for its current ordinary string-list fields.

Acceptance criteria and validation notes are ordinary list fields at record and
selected-slice scope. Criteria use the same `normalizeAcceptanceCriteria` owner
as `workspace_work_record_ready_slice`. `acceptance.validation` accepts only
note strings and `{note, verification_ids}` objects; a note's verification IDs
are narrative links, not executable bindings or proof credit. Replacement
supplies the complete note list and persists it followed by every stored
executable `node_test` entry with its exact value and relative order. A request
equal to the stored notes, or an append of a note already present, is a
digest-stable no-op, and an empty replacement removes only notes. Executable or
hybrid input refuses before any effect: the MCP closed schema rejects it with
the registered input-refusal envelope, and direct core callers receive
`acceptance_narrative_input_invalid` (`mechanical_failure`).
`workspace_work_record_ready_slice` and `workspace_work_record_upsert_slice`
compose their supplied `acceptance.validation` through the same owner against
the selected slice. Executable `node_test` bindings are authored only by the
controlled-contract proof operations (case creation, target amendment, removal
and requirement rebinding through
`workspace_controlled_contract_obligation_coverage_upsert` and its siblings);
ordinary edits change neither proof source nor proof posture and grant no
execution credit. Every ordinary edit refuses an invalid canonical base record.

Task completion is the editor's
`kind: task`, `field: sections.tasks`, `action: mark_done` request over the shared
`setWorkRecordTaskByUnit` owner; there is no dedicated task-completion MCP route
and no `workspace_work_record_set_scalar`.

The server resolves only configured repositories and canonical WK/slice units.
It authenticates target write access independently from every referenced source
read and rejects cross-repository refs. The incumbent non-reentrant writer lock
encloses canonical source reload/generation checks, exact concatenation, target
reload and optional `expected_source_digest` checking, destination planning,
complete prospective-record validation, and at most one CAS-protected canonical
write. References grant no
authority and stale, missing, denied, corrupt and unsupported sources remain
distinct. Results always retain canonical
`changed_fields` and `source_digest`; exact replay and duplicate list/task
append do not churn the digest.

The route refuses caller filesystem roots, arbitrary paths or JSON Pointers,
deep merges, whole-record or whole-`sections` payloads, wrong scope/action/kind,
owner mismatches, task deletion/bulk replacement/caller status, and identity,
lifecycle, authority, acceptance, closure, controlled-contract, proof,
evidence, projection, migration, or derived fields. Known fields name their
specialized semantic owner or state that no general owner exists. The facade
mints no authority and has no CLI counterpart.

Invalid editor input is rejected by the same strict registry-derived schema
before audit or mutation. The returned `work-record-selector-refusal.v1`
envelope contains every applicable editor-owned diagnostic, with common-key
faults first and selected field/action/value faults ordered by path and code.
Each diagnostic has `authority_limb:"mechanical_failure"`. A known field and
resolved record/slice scope yields a callable field-detail request; unresolved
identity or scope yields the first callable inventory page. These requests are
carried only in envelope `next_calls`, never as `corrected_call` or
`supported_calls` owner facts.

The following inert JSON records document stable fields rather than runnable
calls. Owner-minted reference identity and byte metadata are intentionally not
hardcoded.

<!-- editor-error-example:start -->
```json
{
  "example_kind": "editor_input_refusal",
  "schema_version": "work-record-selector-refusal.v1",
  "accepted": false,
  "refusal_code": "unsupported_edit_action",
  "diagnostic": {
    "code": "unsupported_edit_action",
    "path": "$.action",
    "authority_limb": "mechanical_failure"
  }
}
```
<!-- editor-error-example:end -->

<!-- editor-guidance-example:start -->
```json
{
  "example_kind": "editor_input_guidance",
  "known_field_call": "workspace_tools_describe",
  "unresolved_identity_call": "workspace_tools_describe",
  "carrier": "next_calls"
}
```
<!-- editor-guidance-example:end -->

The complete raw Zod failure is captured once as
`work-record-edit-input-validation-failure.v1` for the already-rejected
request. Its owner-minted `content_reference` is carried unchanged. Read it
with `workspace_read_mcp_content_reference`, follow `next_offset` through
`eof`, concatenate decoded base64 bytes before UTF-8 decoding, and verify
`byte_count` and `sha256` before parsing and comparing the captured JSON. This
retrieval never replays the editor mutation.

<!-- editor-retrieval-example:start -->
```json
{
  "example_kind": "editor_input_raw_retrieval",
  "captured_schema_version": "work-record-edit-input-validation-failure.v1",
  "read_tool": "workspace_read_mcp_content_reference",
  "reassembly": "base64_bytes_then_utf8",
  "terminal_persistence_failure": {
    "code": "mcp_response.spill_persistence_failed.v1",
    "response_spilled": false,
    "core_result": { "outcome": "succeeded", "accepted": false }
  }
}
```
<!-- editor-retrieval-example:end -->

If raw-capture persistence fails, the incumbent terminal materializer refusal
is returned unchanged instead of the editor projection. It reports
`mcp_response.spill_persistence_failed.v1`, `response_spilled:false`, the
complete serialized cause, and `core_result:{outcome:"succeeded",accepted:false}`:
diagnostic capture succeeded for a rejected request, but publication did not.
It does not claim that an editor mutation ran or succeeded and fabricates no
reference.

The editor's internal request-contract ownership is split without duplicating
its vocabulary. `packages/wiki-mcp/src/lib/work-record-edit-input-contract.mjs`
is the sole Zod factory for the strict general-editor union and its common
request helpers. It projects that same schema through the shared
`projectZodRequestContract` machinery and declares the UTF-8 byte refinement
through the shared request-constraint declarations. The resulting request facts
explicitly distinguish structural schema coverage from repository resolution,
unit resolution, record-source CAS, applicability, semantic-owner routing, and
whole-record validation that run after schema parsing.

`packages/wiki-core/src/lib/work-record-edit-input-guidance.mjs` is the pure
owner-derived view over the registry and those supplied MCP request facts. It
can return the complete unpaged `facade:true` inventory or detail for one field
and record/slice scope, including every action, value constraint, task-selector
shape, and schema-valid example shape. It imports no MCP module and performs no
mutation dispatch.
Unsupported future registry shapes fail with an entry-specific coverage error
instead of receiving fabricated guidance. This internal view is not yet an MCP
discovery publication surface; delivery paging, budgets,
continuations, descriptors, and shared write-semantics prose remain owned by
their existing MCP/discovery layers.

## One-call closeout with forge-owned completion and truthful check results

Closing a WK is one call. Recording the closure or the status transition, and the
generated-view and lint work that transition requires, are mechanics of that same
request rather than a chore handed back to the caller.

- **One explicit request, one canonical write.** `workspace_work_record_set_closure`
  accepts an optional explicit `status: "done"`. Supplied, the authored closure
  patch and that final transition are composed into a single validated canonical
  write through the same CAS, persistence and completion-policy owners, so a stale
  digest, an invalid field or a persistence conflict leaves neither of them
  applied. Omitted, the same route records closure information and changes no
  status: authoring closure and completing a unit stay distinct requests.
  Completion is never inferred from authored prose, a completing slice never
  closes its parent, and `workspace_work_record_set_status` remains the route for
  a status change on its own.

- **One call, one executor.** A closeout mutation that lands runs
  `generateAndLint` once, against the workspace it just wrote, and reports that
  executor's actual result. `generateAndLint` remains the sole executor of those
  checks; the closeout route decides only when they apply. A completed check
  emits no follow-up generate/lint instruction, and no second report is authored.
- **Not every transition has something to check.** When nothing was written, when
  what was written is invalid, or when the transition is not a closeout one, the
  checks do not apply and the result says which of those it was instead of
  running anything.
- **No canonical mutation, no checks.** A valid request that changes no canonical
  bytes leaves the repository in exactly the state its last verification already
  observed. It preserves those bytes and their digest, executes zero post-write
  checks, and reports them as not run; only a mutation that actually changed the
  canonical record runs `generateAndLint`, and it runs it exactly once.
- **Input validation precedes classification.** A malformed expected digest, a
  digest that does not match the loaded record, or an invalid field is answered
  before the request is classified, so a stale or malformed assertion can never
  ride an otherwise identical unchanged request to a reported success. Storage's
  under-lock compare-and-set remains the authority over a race that lands between
  the read and the write.
- **Uncertainty stays uncertain.** Where canonical publication could not be
  established, the result says so. It is never degraded into a write that was not
  applied, a rollback, or a safe retry.
- **Results are truthful, including the bad ones.** A lint that ran and failed is
  reported as a failing lint with its exact error and warning totals. An executor
  that could not run at all is reported as not run, with its own cause code, and
  never as a passing check. Neither claims the completed write was rolled back:
  the record was written, that stays true, and the result says so.
- **Nothing is invented.** No waiver, accepted risk, follow-on, disposition or
  proof credit is added by a closeout call, and unknown effects stay unknown.
- **Ordinary completion and forge confirmation have distinct authority.**
  An ordinary status or composed closure/status write must not be refused solely
  because the record has `completion_policy: forge_confirmed_merge` and the
  requested status is `done`. This applies to both edit composition and shared
  validated persistence. Completion policy is enforced only through an actual
  returned CCE decision; absent a decision, mechanically valid writes proceed.
  Schema, CAS, identity, integrity and publication checks remain in force, and
  each refusal identifies its mechanical failure or returned policy decision.
  Marking a record `done` supplies no evidence that a forge merge occurred.
- **Forge confirmation remains authenticated.** The trusted forge helper retains
  its exact candidate, pull-request head and mergeability checks, two
  work-record-only closeout commits, confirmed merge and exact reconciliation.
  An unconfirmed merge remains unconfirmed regardless of local record status;
  reconciliation failure after a confirmed merge remains typed partial success.
  Ordinary edits neither invoke those operations nor manufacture their evidence.
  Non-forge and operator-authorized direct-`main` paths require no fabricated
  candidate, forge or proof dependency.
- **A bounded result still leads to the whole one.** A run with more findings
  than the compact preview reports exact totals and names its own complete
  retrieval, preserving every error class and its selected evidence. No internal
  task or hidden helper is needed to continue.
- **The original result is retained, not replayed.** A closeout call asks its
  executor for the complete result, not a default page of it, and retains the
  complete permitted receipt once through the same response owner an oversized
  result already uses. The bounded frame carries that retained answer's
  authenticated content reference in `full_result`, and
  `workspace_read_mcp_content_reference` reads it back. Retrieval is a read: it
  performs no second write and runs no second check. Re-calling the mutation is
  never the route to the detail, because the mutation has already landed and
  repeating it is a no-op that runs nothing and returns no findings. The
  generator's own target directory and build never appear in what is retained or
  returned.
- **A retained original that could not be kept is disclosed.** When retention
  fails, the call still reports exactly the effects it had and the checks it ran,
  and says the original detail is unavailable. It never advertises a reference
  that cannot be read, and it never converts a transport failure into a claim
  about the write.
- **An unknown publication stays unknown.** Where storage could not establish
  canonical publication, the response says so and keeps the cause: `written` is
  null, `publication_state` is `unknown`, and the closeout half reports
  `publication_unknown` without running checks over an indeterminate tree. It is
  never reported as a write that was not applied, a rollback, or a safe retry,
  and the caller is told to inspect the canonical record rather than repeat the
  write.

## Common fixed-fork squash candidate, conditional review and exact forge lifecycle

Every forge publication publishes the same thing, whichever delivery workflow the
repository selected.

- **One candidate.** For the selected integrated WK tip `W` and the fixed
  authenticated fork `B`, the existing trusted constructor builds the squash
  candidate `C` with `tree(C) = tree(W)` and sole parent `B`, and handoff
  publishes `C` unchanged. The current base tip is not a construction input.
  There is no direct-`W` alternative, no second constructor and no additional
  candidate store or ref family.
- **Terminal review is conditional; candidate authentication is not.** Terminal
  review belongs to the repository's selected workflow, not to construction. A
  workflow that selects it hands publication a reviewer materialization, and that
  checkout is authenticated. A workflow that does not select it hands publication
  no materialization: no terminal-review unit is invented, no review evidence is
  fabricated and no reviewer checkout is required. The candidate object binding,
  its tree and sole-parent topology, its version selection and the controlled
  generation authority are authenticated on every publication alike, and the
  published result names which workflow it ran under.
- **A selected candidate is publishable on its own terms.** When no terminal
  review target exists, publication state is recovered from the candidate already
  selected on its durable current ref: its base, tree and sole parent come from
  the candidate object itself, and the WK ref is named by the canonical record
  that candidate carries. Recovery consults no current landing state.
- **The fence holds before any external effect.** Repository, WK, fork, tip,
  candidate identity, tree, parent and controlled generation are rechecked under
  the existing exclusion before the branch or the proposal is touched. A moved or
  foreign input, an inconsistent candidate identity, tree or parent, or
  generation drift refuses with zero publication. Configured CCE denial is
  enacted; the absence of a configured decision is not a local denial.
- **Publication is create-or-observe and nothing more.** The result reports the
  exact candidate and proposal identity and the truthful effects. Repeating a
  handoff recovers the same proposal rather than opening a duplicate, a branch
  already present at different bytes refuses rather than being republished, and
  publication neither merges nor completes the WK.
- **Closeout preserves the published bytes.** Both workflows keep `C` beneath
  exactly two WK-only commits carrying the actual applicable closure evidence and
  then the parent review-to-done transition; a workflow without terminal review
  has no terminal-review record fabricated for it. Merge takes the exact
  authenticated pull-request head only on confirmed mergeability, and an
  unmerged, unknown, moved or foreign state leaves the canonical parent in
  review. The confirmed merged base record is canonical, and a reconciliation
  failure is a typed partial success.

## Recorded managed-worker proof verification

A coordinator can see which proof verification a managed worker actually ran.
The worker's explicit `workspace_verify_proof` calls are retained for the
authenticated attempt that made them. Delivery settlement runs no verification
of its own.

- **Only explicit calls are recorded.** Every authorized managed-worker call
  executes its requested saved selection through the complete verifier. A
  repeated call executes again and is recorded under a new server-minted
  `invocation_id`, even when its evidence bytes match. Observation, lifecycle
  settlement, integration and restart never start, repeat or schedule
  verification.
- **The attempt comes from launcher authority.** The candidate context verifies
  the worker's identity-store slice binding before minting the branded worker
  runtime authority. The attempt is the one retained dispatch binding for the
  same unit and launch ref. The canonical binding-pair derivation proves that
  its launcher-owned dispatch run id pairs with the slice binding's run id,
  launch ref, retry id and unit address. Request fields, environment strings
  and worker output never select the attempt. A mismatched or unverified
  binding records nothing.
- **Results come first, then the journal reference.** The complete public
  result, or the modeled refusal, is written once beneath the workspace's
  launcher durable-state root, in the `verify-proof-evidence` namespace. The
  write goes through the existing response persistence owner. One informational
  `proof_verification_recorded` journal event then names it; that event
  advances no attempt lifecycle.
  - A request refused by its schema, or cancelled before it reaches the
    authenticated invocation boundary, records nothing.
  - Modeled refusals are recorded, including timeout and cancellation after
    that boundary.
- **Each record is bound to what was tested.** It carries:
  - the original binding identity: launch ref, `.slice`-qualified run id and
    retry id;
  - the retained dispatch tuple;
  - the request;
  - the verifier's tested source snapshot, candidate, contract generation,
    contract digests and case revisions;
  - the result identity.

  A later source or proof change is a new invocation and never relabels an
  earlier record. A record covers only its requested selection
  (`coverage_scope: requested_selection_only`). It is worker evidence, not
  independent verification.
- **Recording failures are reported as themselves.** If the cached result or
  its journal event cannot be written, the call returns
  `verify_proof.run_cache_unavailable.v1` with `stage` (`evidence_persistence`
  or `journal_publication`) and the executed status, reason and result
  identity. The call is not re-run, and no reference to unpublished bytes is
  returned.
- **Observation reads what was recorded.** `workspace_agent_run_status`
  publishes the records as a compact `proof_verification` fact and through
  `detail: {kind:"proof_verification", invocation_id?}`. The fact takes one of
  three states: `recorded`, `none_recorded` (not a pass) or `unavailable`.
  - The coordinator reads the cached result from the durable root of its own
    authenticated workspace.
  - For an aggregate it returns a fresh evidence reference readable in its own
    session. It never reads another session's spill directory or a caller path.
  - Recorded facts carry `grants_authority: false`. They add no review,
    admission, integration or completion authority, and the coverage query
    keeps its meaning.

## Canonical slice start and existing readiness orchestration

Dispatch is "start this canonical unit". The caller names the unit; everything
the worker needs is resolved by the system:

- **The agent comes from the unit.** `role` is optional on
  `workspace_agent_dispatch`. Omitted, the dispatch target is derived from the
  unit's own `dispatch_intent.intended_agent_role` by the wiki-core dispatch
  owner, so a caller never restates a fact the canonical record already carries,
  and can never restate it inconsistently. A unit that declares no agent is
  refused before launch, with the derived-axis readiness refusal naming what the
  record is missing and with zero worker spawned. An explicitly named role keeps
  today's selection exactly, which is what reviewer and redteam dispatch use:
  an advisory role is the caller's decision, not a property of the reviewed unit.
- **The assignment comes from the record.** Task, scope, acceptance, validation,
  selected material and runtime are resolved from the canonical slice and its
  parent together with authenticated launcher facts. A caller-authored `prompt`,
  `request`, `argv` or `env` is refused at the boundary rather than accepted and
  discarded, because accepting it would tell a caller its instructions took
  effect when the assignment came from the record. No sibling unit's material is
  injected, and frozen material is never replaced live.
- **Readiness is internal.** One ordinary start runs
  `orchestrateAgentDispatchReadiness`, the existing readiness owner, including
  the currentness and worker revalidation that start needs. There is no second
  readiness algorithm and no mandatory caller pre-call;
  `workspace_validate_dispatch` remains available for an explicit "can this
  start?" question.
- **Authority is unchanged.** Equivalent admitted inputs preserve the worker's
  read and write namespace, role and tier, completion transport and
  launcher-resolved runtime. Review material and reviewer launch identity stay
  launcher-owned, so a bare caller locator grants no authority. CCE alone decides
  policy, and mechanical refusals stay distinct from policy decisions.

## Ordinary selected canonical reads and authoring continuity

`workspace_read_page` is the ordinary selected canonical reader. One read is
addressed exactly one way, and the selector owner decides which:

- `path` names a repo-relative workspace file.
- `id` names a canonical record, and `unit` names a record and its slice, so a
  caller reaches canonical content without reconstructing a storage address. A
  canonical identity is served by the same id-addressed reader
  `workspace_get_record` uses; nothing derives a path from an id to get there.
- `entry:{...}` delegates one exact entry of that unit to the entry owner, which
  keeps its whole published grammar — metadata, history, bodies, references and
  literal selections — underneath. The calls that owner emits come back
  re-addressed to this reader, so a caller that entered here never changes route
  to follow them.
- `content_reference:{ref_id, offset, length}` delegates one retained spill to
  its owner and accepts no other selector.

Exactly one of `path`, `id` and `unit` is required; supplying none, supplying
two, naming a slice twice (a `unit` that already carries one plus
`selected_slice`), addressing an entry without its unit, or combining a retained
reference with a page selection each return a precise selector correction naming
the argument at fault. A foreign or absent identity is reported as absent and
never answers with another record's content.

Consolidation preserves what each owner already guaranteed. Identity, source
digest and version travel with every page; entitlement resolves through the same
frozen-aware read resolver the page and entry routes already used; Unicode
scalar and UTF-8 byte semantics are the entry owner's unchanged; and following
only the returned calls reconstructs complete selected notes, tasks, entries and
oversized content with exact totals. A currentness or version fence rejects a
cross-generation selection rather than combining generations, and a rejected or
absent selection mutates nothing and substitutes no unrelated content.

`decision`'s retained-entry exception is preserved exactly and only as written:
historical publication receipts, versions without stored text lengths and
unchecksummed whole-version references stay readable through this reader and
survive ordinary updates, while new publication uses the replacement forms only
and a malformed modern reference is refused rather than reinterpreted as an
older form.

Authoring is unchanged. Allocation, selected editing, task and entry reuse and
the semantic requirement writers remain ordinary actions reached through their
own registered routes; an incomplete requirement draft still saves without
claiming proof or readiness; a stale or invalid edit still reports no write and
mutates nothing. The dedicated `workspace_work_record_entry_read` and
`workspace_read_mcp_content_reference` routes stay registered and unchanged, and
role grants for the reader and every route it delegates to are untouched.

## Ordinary code-question selectors, grounding and complete retrieval

`workspace_code_index_impact` is the one ordinary committed code question. Which
existing query answers it is decided only by its documented parameters, in a
fixed precedence that the registered schema publishes and the runtime applies:

1. A change subject — exactly one of `paths`, `patchText`, `diffRecords` or
   `liveGit:true` — asks committed impact. A compatible `path` or `symbol`
   narrows that subject to the paths it names; narrowing only removes subject
   paths and never introduces one the change did not touch. The answer reports
   `subject_paths_before_narrowing` and `narrowing_excluded_paths` beside its
   other denominators, and a narrowing that removes every path is truthfully
   `no_change`, not an invalid request.
2. `symbol`, or `path` with `line` and optional `character`, asks the existing
   definition, reference, caller and callee owners. Without `relationship` the answer
   composes all four; `relationship` narrows it to one of `definition`,
   `references`, `callers` or `callees`.
3. `path` alone asks that file's committed context.

Parameters name the information wanted. No argument selects an engine, cache or
algorithm, no question prose is interpreted, and no model-based classifier runs.
Conflicting, empty or undeclared selectors return a specific correction that
names every reachable question instead of guessing one; the correction carries
those alternatives in its published diagnostic. Selection lives in one owner,
`normalizeSidecarCodeQuestionInput`; the registered schema validates selector
shape and is never a second selector.

Grounding is unchanged by consolidation. Every branch answers from the committed
HEAD publication, names that basis, and reports repository identity. A dirty or
untracked worktree neither moves nor blocks the committed graph — it is
disclosed and excluded — and uncommitted patch content is attributed to the
caller rather than to indexed source. No inferred adjacency is labelled
graph-derived.

Each branch keeps the response contract of the owner that answered it. Impact
answers with the bounded summary and the executable `selected_detail` call over
its retained original; file context and the composed symbol answer keep their
complete original at `full_result`. Compact counts are exact against the whole
population in every branch, and following only the returned detail,
continuation or content-reference calls reconstructs every result, including
Unicode and rows past the ranked preview. A selection retained at an earlier
HEAD reports that its observation `changed` rather than combining generations.

Role grants are unchanged and come solely from
`session-role-tool-access.json`: the question and each route it delegates to
carry the same grants, disposition, audience and tier, so asking through the
question neither broadens nor destroys a path. The dedicated file-context and
navigation routes stay registered and answer exactly as before.

## Graph-impact compact default and verbose opt-in

Graph-impact output is derived, non-canonical evidence. Compact projections
must retain exact counts, binding, and a complete retrieval route; verbose/full
retrieval is for diagnostic detail, not a different authority posture. Verbose
does not guarantee inline output: a verbose response larger than the inline
limit spills losslessly, and its content reference reconstructs the complete
response. The
selection guidance is in [Tool discovery surfaces](tool-discovery-surfaces.md),
and decision governs completeness. Persisting graph evidence does not turn it
into dispatch or policy authority.

`workspace_validate_dispatch` may refresh stale required graph impact through
the shared automatic preparation owner. A publication already tagged with the
captured commit is reused. Otherwise the Git diff to the captured HEAD and the output
of every applicable SCIP provider are applied in one owned
`.graph-candidate-*.sqlite` file, which is published by rename under the single
updater lock. A candidate is never
reused or treated as authority.

`workspace_coordination_preflight` discloses each fact-family using the closed
local-handling vocabulary `evaluated_locally`, `projected`, or
`not_evaluated`. A projected fact retains its originating semantic owner;
preflight does not re-evaluate it. Compact output carries complete counts and
omissions, while `verbose:true` is the complete per-family retrieval path.

## Native-v1 controlled-contract operation policy

Compatibility pointer for the former second H1: controlled-contract normal
paths use the stable native-v1 contract documented in
[Controlled-contract operations](mcp-controlled-contract-operations.md).
Adapters may project package-owned results but do not redefine lifecycle,
authority, refusal, recovery, persistence, or schema ownership. Use
repository-local discovery to select the supported operation and MCP
`tools/list` for its exact registered input schema.

`workspace_controlled_contract_generation_persist` is an exceptional direct
recovery/diagnostic operation; managed dispatch owns the normal implementation
path. See [MCP integration](mcp-integration.md) for that authority boundary.

## Internal controlled-contract refactoring

Graph integrity and refactoring algorithms remain internal where canonical
persistence or validation consumes them. They do not expose public plan, query,
or apply operations, and their retained backend state is not a caller workflow.

### Selected ordinary reusable text and tasks

`workspace_work_record_summary` accepts `ordinary_field` at record or slice
scope, with exactly one existing `id`, `unit`, or canonical `path` selector.
The selected value and `source_digest` come from one canonical load. An ordinary
selection returns no broad summary or dependency traversal. Missing slices are
resolved before dependencies; invalid sources retain their owning diagnostics.

| `ordinary_field` | Meaning |
| --- | --- |
| `{field:"sections.summary"}` | First root-summary body page |
| `{field:"sections.summary",reference_only:true}` | Whole root-summary ref without body bytes |
| `{field:"sections.why_it_matters"}` | First root/slice rationale body page |
| `{field:"sections.agent_notes"}` | First root/slice note body page |
| `{field:"sections.agent_notes",offset:0,length:100}` | Unicode-scalar body range |
| `{field:"sections.agent_notes",selection:{text:"exact passage"}}` | Unique before/match/after refs, or distinct no-match/ambiguity result |
| `{field:"sections.tasks",offset:0,limit:25}` | Task page, default 25, maximum 50 |
| `{field:"sections.tasks",all:true}` | Complete population from one generation |
| `{field:"sections.tasks",index:0}` | One occurrence, requiring a source pin |
| `{field:"sections.tasks",text:"Prepare the draft"}` | Unique trimmed exact match |
| `{field:"sections.tasks",index:0,member:"text",reference_only:true}` | Whole selected task-text ref |
| `{field:"sections.tasks",index:0,member:"text",offset:0,length:100}` | Selected task-text body range |

Individual tasks also support `member:"index"` and `member:"status"`. Index and
text selectors are mutually exclusive. Paging, `all:true`, and individual
selection are separate forms. Reference-only and exact-literal selection on tasks
require an individual selector and `member:"text"`; enumeration, status/index
members, slice summary and arbitrary fields are not reference sources. Scalar
offsets count Unicode scalar values and invalid Unicode refuses. Without
`length` a body read returns the complete remainder from `offset`; an explicit
positive `length` returns exactly that range and one continuation when text
remains. An offset at or past the end returns an empty final range. A plain text read returns only `valid`, the one current
`source_digest`, the field identity with its applied offset, returned length and
complete total, the exact body or, with `reference_only:true`, the reusable
reference, and at most one continuation in `next_calls`; unit identity, response
size and duplicate continuation flags are not repeated. Exact selections keep
their selection object. Task pages, compound `selected_record` or slice-page
reads, and refusals keep their composed envelopes with complete counts and
executable `next_calls`.

Exact selection scans the complete selected value case-sensitively, detects
overlapping matches, and accepts at most 4,096 UTF-8 bytes of nonempty literal.
A unique match returns opaque `before_ref`, `match_ref`, and `after_ref`, including
empty complements. No-match and ambiguity have distinct diagnostic codes.
Ambiguity returns contextual choices (five by default, at most 25), one complete
owner-produced occurrence call per returned choice, total/returned counts and a
truthful `has_more`; it never silently chooses the first match.

Supply `expected_source_digest` for every index read and noninitial range/page.
With `ordinary_field`, this pin alone never requests slice enumeration. Only
explicit `slice_offset`, `slice_limit`, or `slice_status` requests a slice page.
Every slice page carries the record `source_digest`, and a continued page pins
it. When the record changed, the page refuses with `accepted:false`, reason
`selected_read_stale_source_digest` (`read_disclosure`, `caller_retry`,
non-blocking), both `expected_source_digest` and the current `source_digest`, a
null `slice_page`, and one recommended restart call at `slice_offset` 0 pinned
to the current digest that keeps the requested `slice_limit` and
`slice_status`. No acknowledgement token is issued or refreshed.
Root `selected_record:true` or explicit root slice paging composes its existing
projection with the ordinary value from the same load and pin. Existing conflicts
between selected-record, selected-slice and slice-page requests remain. Requests
without `ordinary_field` retain their existing selector/pin contract.

Widening flags do not enlarge ordinary selections. Reference-only and
exact-selection results fit 8,192 actual serialized UTF-8 bytes in both the
structured and model-visible MCP carriers. Choice populations and composed
slice-page rows are bounded after optional selected-record metadata and all
continuations have been assembled; encoded references and JSON text are never
truncated. If required metadata alone cannot fit, such a read returns the
bounded `ordinary_field_compact_result_too_large` refusal. Body reads carry the
selected text without that reader bound: the general MCP response boundary
returns the complete result inline when it fits the configured inline limit and
otherwise spills it losslessly behind a content reference. When `repo` is
omitted, references use the repository identity resolved by the server, never
the record's authored `repo` value or a caller guess. Whole-value
`reference_only:true` returns a reusable reference without the body. Task `all:true` retains its existing contract and may use
the general lossless response materializer. Semantic scalar ranges and
serialized content-reference byte ranges are distinct.

All edits in the ordinary journey carry the current digest. Clean task results
return index, status and digest for direct chaining; the authored text is read
back through the emitted source-pinned continuation, and `verbose:true` retains
it in the receipt. A stale task edit or
selected occurrence emits a fresh tasks page at offset zero, without the old
index or digest; a stale note emits a fresh note read. Compound stale recovery
retains explicit projections and slice filters while restarting offsets. Existing
editor callers retain their optional-pin contract. An unpinned index edit has
no digest-bound occurrence guarantee.

After an uncertain write or lost response, read current state before deciding a
new mutation. Finding the intended state establishes goal satisfaction, not
historical request attribution. Competing or ambiguous state needs explicit
reconciliation; no ordinary replay receipt or automatic resubmission is added.
