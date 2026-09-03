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

1. `workspace_tools_list`, `workspace_tools_describe`, and
   `workspace_tools_query` provide repository-local **selection metadata** for
   the current session. That metadata covers availability, authority, side
   effects, support posture, documentation routes, and the inputs advertised by
   the repository-local descriptor projection. Use the list surface for a
   paged catalog scan, describe for targeted detail, and query when a task ID or
   exact tool name is already known. The complete projection and continuation
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

## Public mechanical refusal envelope

Compatibility pointer: refusal vocabulary and recovery routing are not
restated here. Start at
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md), which is a
navigation page subordinate to decision's enforcement boundary and decision's
mechanical-failure versus returned-policy split. The focused producers and
projectors linked from that page retain their distributed ownership; the entry
page is not a sole semantic owner.

## Controlled-contract operations

The durable contract for controlled-contract authoring, proof planning,
assessment, persistence, and recovery is
[Controlled-contract operations](mcp-controlled-contract-operations.md).
Discover the session-visible route through the repository-local selection
layer, then obtain its exact request schema from MCP `tools/list`.

`workspace_controlled_proof_packs_select` routes the package-owned
`controlled-contract-proof-pack-selection.v2` result. Wiki-core adds canonical
WK/focus context and populated inspection calls; wiki-MCP adds bounded paging.
The frozen v1 result remains a mechanically derived package compatibility
projection and is not exposed by this route.

### Declared proof-population verification

`workspace_verify_proof` accepts required canonical `subject`, optional
configured `repo`, and orchestrator-only optional `git_sha`. `subject` may be a
WK, slice, test-proof ID, or obligation ID; all four resolve to the same stable
aggregate pipeline and result shape. Read its live closed schema
from MCP `tools/list`; there are no path, command, target, environment, provider,
evaluator, receipt, policy, or authority inputs. The session role is
launcher-authenticated. Managed workers and reviewers remain confined to their
launcher-bound candidates and cannot provide `git_sha`.

An orchestrator SHA request requires the configured repository's lowercase full
object-width commit identity. The review-shared immutable-candidate substrate
resolves its commit/tree, creates an authenticated private detached worktree
under the launcher-owned root, executes there, and cleans it afterward. It does
not select or depend on existing worktrees at that SHA. Without `git_sha`, the
configured repository worktree is used directly whether clean or dirty, and its
identity is checked before and after the confined declared tests without source
mutation.

The aggregate carries one complete `existing_worktree` or
`immutable_exact_commit` subject binding with selector, commit, tree, clean
status, and authenticated candidate identity. Exact-SHA calls have bounded
workspace and Git-administration writes for private materialization and cleanup;
omitted-SHA calls have none. The complete population is deduplicated and all targets,
providers, evaluators, inventories, and stable selections are preflighted before
attempt-context minting or provider spawn. One nonready proof refuses all
execution with bounded per-proof mechanical diagnostics. Every distinct proof
executes once and projects its result to every canonical obligation relation.
Aggregate and per-proof outcomes are `satisfied`, `unsatisfied`, or reason-coded
`not_executable`. The authoring/runtime lifecycle,
four diagnostic states, bounded candidate retrieval, and authority separation
are owned by
[Test-proof runtime identity](test-proof-runtime-identity.md#stable-v1-readiness-lifecycle);
this page does not duplicate those semantics.

Modeled execution failures never depend on the generic MCP exception envelope.
The verify-proof result carries one common subject binding plus compact
proof/verification status rows and minimal stable reason/recovery facts. A
selected assertion that ran
with valid authenticated structured events is evaluable: failure is
`unsatisfied`, not `not_executable`. Spawn/isolation/timeout failure, invalid or
incomplete reporter output, provider inability, identity movement, and missing
or cross-bound receipt evidence are mechanical/protocol `not_executable` or
refusal outcomes. Raw stdout/stderr, absolute filesystem paths, messages,
environment, commands, argv, and provider/run payloads are never projected.
The single-file process disables Node's inner test isolation inside the existing
launcher sandbox so the authenticated reporter observes the selected assertion
and its siblings. Only the predeclared selected assertion determines proof
pass/failure; siblings and the aggregate file exit remain audit facts. If the
file ends before the selected ID appears,
`test_proof_selected_identity_not_observed` returns its expected ID, bounded
wrapper status/error codes and counts, and at most eight safe relative
file/name/nesting/identity candidates. `test_proof_bound_identity_mismatch` is
reserved for a declared-versus-authenticated binding disagreement.

The structured reporter channel is not diagnostic output. Its authenticated
envelope is retained losslessly under a separate fixed 2 MiB ceiling, while
ordinary validation diagnostics and proof stderr retain the existing 262,144
byte head/tail bound. An over-ceiling envelope is drained, not parsed, and
returns `test_proof_structured_events_oversized` with bounded recovery facts.
Every public structured result is at most 65,536 UTF-8 bytes and excludes
complete inventories, output, stacks, absolute paths, commands, argv,
environment, and raw provider/reporter/receipt/run payloads.

`contract_generation` is the canonical `controlled-contract-generation.v1`
`generation_digest` over the authenticated carrier population. It is not the
carrier-set manifest's storage selector (`generation.id`/`generation.path`), and
the contract carrier's `content_digest` is authenticated separately. A binding
refusal reports bounded expected and actual status, counts, verification IDs,
content digest, and canonical generation digest. Only observed canonical
generation movement recommends restart; declaration defects use controlled
test-proof query/patch recovery and content contradictions require canonical
carrier repair.
Manifest storage remains an internal concern of the canonical carrier-set
owner. It supplies runtime-only authenticated member facts to attempt-context
minting, which verifies the selected generation member in the current-worktree
or immutable candidate without synthesizing `wiki/contracts/<filename>`.
Physical member locations are absent from the public test-proof query and from
the canonical generation digest. A missing canonical contract is projected as
`verify_proof.controlled_contract_carrier_absent.v1` and routes to canonical
contract/proof-population authoring rather than candidate preparation.
Responses and incomplete receipts cannot be replayed after restart. Every result
is advisory and grants no dispatch, review, admission, integration, completion,
CCE, lifecycle, policy, or general process-runner authority. Runtime identity is
owned solely by `workspace-agent-test-proof-runtime-identity`; the MCP adapter
does not mint or accept caller authority.

### Coverage semantic authoring skeletons

Compatibility pointer: semantic coverage authoring and its complete retrieval
paths are owned by
[Controlled-contract operations](mcp-controlled-contract-operations.md) and
[Acceptance-coverage MCP](acceptance-coverage-mcp.md). This page does not copy
their fields or operation inventory.

The live describe projection separates one typed `authoring_action` from
`read_pagination`: absent coverage uses a complete-population atomic create,
whereas existing coverage uses the owner-selected patch/upsert route. The
internal 39-entry skeleton and its overflow bookkeeping are never public
authoring payload.

An exact server-minted `authoring_row` selector returns exactly its bound row.
Its shared populations include only mechanically owner-linked contract nodes
and proof choices and report exact total/returned/omitted accounting. Genuine
caller ambiguity is explicit; omitted alternatives are available only through
the typed, transport-bounded `authoring_context` continuation advertised for
that population.

The optional controlled-contract focus retains its shared grammar,
`^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$`. The package-owned pattern reserves `wk-[0-9]` prefixes and excludes exact
`slice-<digits>` forms from caller-selected focus values. This stable identity
rule is documented here for cross-surface parity; `tools/list` remains the
authority for the live request schema.

### Coverage atomic patch operations

Compatibility pointer: atomic coverage patch behavior, identity binding, and
stale-source protection are owned by
[Controlled-contract operations](mcp-controlled-contract-operations.md). The
live `tools/list` schema is the signature authority.

### Common-proof capture

Compatibility pointer: common-proof families, admissible carriers, and capture
semantics are owned by
[Controlled-contract operations](mcp-controlled-contract-operations.md). Use
discovery for availability and `tools/list` for the live request shape.

## Public mechanical refusal envelopes

Compatibility pointer for the former plural heading: use
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) to navigate to
the focused refusal producer, taxonomy, projection, and recovery owners. This
page intentionally carries no second normative refusal stack.

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

The focused compatibility routes are:

- `workspace_agent_runs_list` is the process-local route for recovering visible monitor handles. Follow a returned handle with `workspace_agent_run_status` or `workspace_agent_run_wait`. Detailed ordering, restart limits, and reissue recovery belong to [Process-local monitoring versus restart-stable receipt authority](mcp-dispatch-managed-run-lifecycle.md#process-local-monitoring-versus-restart-stable-receipt-authority).
- `workspace_agent_run_status` reads or advances the state of one launcher-minted monitor handle. **Not read-only for a managed exact-slice worker run**: polling a terminal managed worker may prepare and freeze the slice-review surface, but it parks until the separate coordinator integration continuation completes. Side effects: `workspace_write`, `record_write`.
- `workspace_agent_run_wait` waits for the same managed-run state or a bounded timeout. **Not read-only for a managed exact-slice worker run**: polling a terminal managed worker may prepare and freeze the slice-review surface, but it parks until the separate coordinator integration continuation completes. Side effects: `workspace_write`, `record_write`.

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

## Compact-first work-record reads

Work-record reads use compact selection views for routine retrieval and expose
a documented complete path for selected or full content. The lossless
projection rule is decision; the durable shapes and canonicality rules are in
[Work-record schema](work-record-schema.md) and
[MCP repository model](mcp-repository-model.md). Live opt-in fields belong to
the selected operation's `tools/list` schema.

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
This page intentionally does not copy the field inventory; the live request
shape remains reachable through `tools/list`.

#### Omission-first target authoring

Optional target detail is omitted unless the contract needs it. An omission is
not a wildcard grant: the owning schema and runtime derive or validate what the
operation can safely resolve.

### Atomicity, generations, and digests

One accepted semantic authoring call performs at most one canonical record
write. Source digests protect against stale mutation; server-derived generations
and identities are not caller authority.

### Closed structural-readiness response

Structural-readiness output reports the authored unit's mechanical state. It
does not certify lifecycle readiness, grant dispatch authority, or substitute
for a CCE policy decision.

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

### Bounded ordinary authored-field editor

`workspace_work_record_edit` is the single general MCP facade for ordinary
authored fields. It accepts one strict registry-derived request variant:
`{kind:"scalar",field,action:"replace",value:string}`;
`{kind:"list",field,action:"replace",value:string[]}`;
`{kind:"list",field,action:"append",value:string}`; or a task request on
`sections.tasks` using `mark_done` (one `text` or `index` selector),
`replace_text` (selector plus non-empty string `value`), or `append_todo`
(non-empty string `value`, no selector). Extra properties refuse.

`WORK_RECORD_EDIT_FIELD_REGISTRY` is the sole field vocabulary. The following
table is its complete durable projection; `acceptance.criteria` is retained
only for the list-setter compatibility adapter and is not reachable through
the general facade.

| Registry entry | Kind | Scope | Actions | Value | Owning planner |
| --- | --- | --- | --- | --- | --- |
| `title` | scalar | record | replace | trimmed non-empty string | `editWorkRecordByUnit` |
| `priority` | scalar | record | replace | `critical\|high\|medium\|low` | `editWorkRecordByUnit` |
| `owner` | scalar | record | replace | trimmed non-empty string | `editWorkRecordByUnit` |
| `sections.summary` | scalar | record | replace | string | `editWorkRecordByUnit` |
| `sections.why_it_matters` | scalar | record | replace | string | `editWorkRecordByUnit` |
| `sections.agent_notes` | scalar | record | replace | string, at most 8,192 UTF-8 bytes | `editWorkRecordByUnit` |
| `sections.agent_notes` | scalar | slice | replace | string, at most 8,192 UTF-8 bytes | `upsertSlice` |
| `tags` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.scope.items` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.scope.out_of_scope` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `sections.references` | list | record | replace, append | string array / one string | `editWorkRecordByUnit` |
| `read_scope` | list | record, slice | replace, append | string array / one string | `setListField` |
| `docs` (alias of `read_scope`) | list | record, slice | replace, append | string array / one string | `setListField` |
| `repo_paths` | list | record, slice | replace, append | string array / one string | `setListField` |
| `write_scope` | list | record, slice | replace, append | string array / one string | `setListField` |
| `depends_on` | list | record, slice | replace, append | string array / one string | `setListField` |
| `blocks` | list | record | replace, append | string array / one string | `setListField` |
| `related` | list | record | replace, append | string array / one string | `setListField` |
| `sections.tasks` | task | record, slice | mark_done, replace_text, append_todo | bounded task union | `setWorkRecordTaskByUnit` |
| `acceptance.criteria` (compatibility only) | list | record, slice | replace, append | criterion array / one criterion | `setListField` |

Scalar edits replace only the selected address. List append adds exactly one
entry and an identical entry is a digest-stable no-op. Task replacement
preserves status; task append creates one `todo` entry. Existing-slice upsert
refuses supplied `sections.tasks`, while new-slice creation may provide its
initial tasks. `workspace_work_record_set_list_field` and
`workspace_work_record_set_task` remain compatibility adapters over these same
registry entries and owners; there is no `workspace_work_record_set_scalar`.

The server resolves only configured repositories and canonical WK/slice units.
It authenticates the selected unit, checks optional `expected_source_digest`
before a no-op, validates the complete prospective record, and performs at
most one CAS-protected canonical write. Results always retain canonical
`changed_fields` and `source_digest`; exact replay and duplicate list/task
append do not churn the digest.

The route refuses caller filesystem roots, arbitrary paths or JSON Pointers,
deep merges, whole-record or whole-`sections` payloads, wrong scope/action/kind,
owner mismatches, task deletion/bulk replacement/caller status, and identity,
lifecycle, authority, acceptance, closure, controlled-contract, proof,
evidence, projection, migration, or derived fields. Known fields name their
specialized semantic owner or state that no general owner exists. The facade
mints no authority and has no CLI counterpart.

## Graph-impact compact default and verbose opt-in

Graph-impact output is derived, non-canonical evidence. Compact projections
must retain exact counts, binding, and a complete retrieval route; verbose/full
retrieval is for diagnostic detail, not a different authority posture. The
selection guidance is in [Tool discovery surfaces](tool-discovery-surfaces.md),
and decision governs completeness. Persisting graph evidence does not turn it
into dispatch or policy authority.

`workspace_validate_dispatch` may refresh stale required graph impact. During
the initial absent-lock race it may use a fixed eight candidate slots named
`.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. An existing persistent shared
lock prevents additional candidate writes, and slot exhaustion falls back to
an independent atomic build. Candidate files are retained but never reused or
treated as authority.

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

## Controlled-contract refactor operations

`workspace_controlled_contract_refactor_plan` has two closed request forms. The
initial form accepts `repo?`, `wk_id`, optional canonical `focus`, exactly one of
`expected_generation` or `expected_manifest_digest`, and a `mode`:

- `rename_identity` carries `old_identity`, `new_identity`, and optional
  identity-normalized `old_node`/`new_node` witnesses.
- `replace_subgraph` carries `correspondence`, a nonempty `reason`, and optional
  bounded package carrier-patch operations. It accepts no coverage dispositions.

The finalization form accepts `repo?`, the issued `plan_identity` and
`conflict_set_identity`, and complete `obligation_dispositions` and
`acceptance_dispositions`. It returns the apply continuation only after both
existing coverage rebase owners validate their complete prospective results.

`workspace_controlled_contract_refactor_query` accepts `repo?`, an issued
`resource_identity`, `resource_kind` (`plan` or `receipt`), an optional bounded
semantic selector, and an optional server-issued cursor. It is the complete
read-only retrieval path. Nonfinal results return one next cursor; a final plan
page returns the plan-finalization call or apply continuation, and a final
receipt page returns `status:"complete"`. Oversized individual items use the
existing ranged content-reference descriptor and reader.

`workspace_controlled_contract_refactor_apply` accepts only `repo?` and the
opaque `continuation`. Success returns the immutable receipt resource identity,
the old/new generation binding, exact correspondence and reason, changed
carrier and coverage digests, invalidated derived identities, proof gaps,
package identity, counts, written/no-op outcome, and replay state. Raw carrier
bytes, paths, roots, basenames, environment, evidence, proof,
authority claims, and caller-authored derived bytes are not inputs to any of
these operations.

See [Controlled-contract operations](mcp-controlled-contract-operations.md#generation-bound-controlled-contract-refactoring)
for closure, cursor, atomicity, replay, recovery, and authority semantics, and
[Acceptance-coverage MCP](acceptance-coverage-mcp.md#refactor-coverage-settlement)
for coverage transaction ownership.
