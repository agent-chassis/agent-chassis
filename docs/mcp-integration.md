
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

Registration conformance is also exercised end to end by a three-task
integration composition over the production stdio server: an ordinary
work-record task edit, exact recovery of an independently seeded search passage
through unchanged ranked and source continuations, and a schema-invalid editor
request followed by the correction route its refusal returns. Requests are
classified by provenance. A call a delivered server response emitted executes
unchanged and is bound to the captured stdout frame that offered it and the
captured stdin frame that carried it. Initial queries, the invalid request, its
caller-authored correction, spill-page retrieval and protocol requests are
counted separately and are not emitted-call evidence. Both result carriers are
read. Comparisons use the incumbent owners:
`evaluateMcpCallableContractConformance` for schema, discovery, population and
corrected-call facts, with continuation facts taken from transmitted request
bytes; the ordinary fixture's record and namespace oracles for effects,
including the complete root record and unrelated namespace around the final
correction; the fixture's `accounting(trace)` recount for calls, frames, bytes,
setup/discovery/journey/recovery/shutdown phases, the named lost-response
restart and invalid-request correction recovery sequences, and latency, with
explicit source, client and role identities on each report; and source bytes
fixed before any fixture child executes, compared with the observed child
scripts, registration data and fixture modules. Child servers inherit the
ordinary environment but not the parent's `NODE_OPTIONS` or Node test-runner
identity. Same-process calls to the search, source-read, summary and work-record
store owners are reported separately from the public stdio witnesses. Raw
stdin, stdout and stderr captures are owner-private fixture state, verified by
byte count and SHA-256 and removed with the fixture. Model token usage, external
client capture, authenticated entitlement and launcher provenance are reported
as unavailable, never derived from byte counts.

The launcher owns one host-side `@agent-chassis/wiki-mcp` process for each
confined Claude or Codex dispatch. The model sandbox never contains a Node
interpreter, package tree, dependency installation, or wiki-MCP runtime.

## Result channels

A structured tool result carries its complete value once, in
`structuredContent`, with `content: []`. No serialized JSON copy, abbreviated
copy or textual pointer to the value is published beside it; the repository
supports only this current contract and keeps no text mirror for clients that
read only rendered text. Structured error envelopes, translated thrown errors,
input-recovery refusals, spill references, persistence refusals and
continuation pages obey exactly the same shaping, and error results
additionally retain `isError: true`. An unstructured thrown error is translated into the registered
public mechanical refusal envelope. Its ordinary diagnostic remains separate
from deciding identities and is preserved byte-for-byte. Diagnostic/free-form/
untrusted text is not inherently sensitive; only an explicit structured
sensitive component is removed, with its genuine closed reason.

`structuredToolResult` in `packages/wiki-mcp/src/lib/mcp-response.mjs` is the
one constructor of that frame, and the contract is enforced at the public guard
boundary, not only inside the `jsonContent` and `errorContent` helpers. Every
result a registered handler returns passes through the guard, so a handler that
shapes its own result — or that mutates a helper-produced `structuredContent`
afterwards, as tool discovery does when it re-attaches `package_versions` and the
work-record write routes do when they re-attach `selected_unit` — leaves on the
structured contract: any text block beside `structuredContent` is removed,
independently meaningful non-text blocks (resource, image, audio) and top-level
protocol metadata such as `_meta` are preserved, and the final frame is admitted
or spilled as below. Normalization is idempotent: a result already in that form
whose complete serialization fits is returned untouched. A result with no
`structuredContent` — an ordinary unstructured text result or the SDK's own
request-validation refusal — passes through unchanged.

Inline admission is decided on the UTF-8 byte size of the complete prospective
`CallToolResult` as serialized — the compact structured value with its string
escaping, the frame keys, and preserved top-level result metadata such as
`_meta`. `measureMcpInlineResultBytes` is the one measurement owner; route pagers
use it to make the same decision without probing persistence. Nothing is added
to the frame afterwards, so no inline result exceeds the configured limit.

A result that does not fit is persisted once to the existing file-backed
reference, and `structuredContent` then carries the bounded
`wiki-mcp-spilled-response.v1` envelope: reason, byte counts, a bounded preview,
and the content reference with its digest and ranged-continuation window. An
oversized structured error retains `isError: true`, and reading the reference
through `workspace_read_mcp_content_reference` reconstructs the original envelope
byte-for-byte. A spill or refusal envelope is terminal — it is never spilled a
second time.

### The spill envelope names two different byte quantities

`total_bytes` and `inline_byte_limit` are **not comparable**, and an envelope in
which `total_bytes` is smaller than `inline_byte_limit` is not a contradiction:

- `inline_byte_limit` is compared against the complete serialized
  `CallToolResult` described above — compact `structuredContent`, the frame keys
  and any preserved protocol metadata.
- `total_bytes` measures the **retained payload alone**, as persisted: one
  two-space-indented JSON document with no frame. Indentation and frame overhead
  differ, so either quantity can be the larger.

The envelope therefore carries `measurement`, an
`mcp-response-spill-measurement.v1` block that states both quantities and which
one admission compared:

```json
{
  "schema_version": "mcp-response-spill-measurement.v1",
  "compared": "complete_frame_bytes_exceeded_inline_byte_limit",
  "complete_frame_bytes": 181432,
  "inline_byte_limit": 131072,
  "retained_payload_bytes": 84167,
  "retained_payload_encoding": "application/json; charset=utf-8; indent=2",
  "meaning": "inline admission compares complete_frame_bytes … against inline_byte_limit."
}
```

`complete_frame_bytes` is the measurement admission actually made, so it always
exceeds `inline_byte_limit` when `compared` is
`complete_frame_bytes_exceeded_inline_byte_limit`. A payload the producer
retained deliberately — a selected-response source or an evidence bundle — was
never offered for inline admission, so it reports `compared:
"not_compared_retention_forced"` with `complete_frame_bytes: null` rather than
claiming a comparison it did not make. Normalization is different: when it
measures an already formed complete result, finds that result oversized, and
then uses the retention path, it carries that measured frame size into the same
block and reports `complete_frame_bytes_exceeded_inline_byte_limit`. This block
explains the arithmetic; it changes no threshold and no admission decision.

When persistence itself fails, the boundary returns one deterministic bounded
structured refusal rather than the oversized original or a generic unstructured
fallback:

- `isError: true`, the refusal in `structuredContent`, and `content: []`.
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

There is no complete-record read. The compact result advertises the same
route's member call, `member: {path: []}`, which lists the record's immediate
members; each listed member carries its own exact member call. Every omitted
top-level member and every `sections.<member>` is recovered by following those
calls, one bounded page or string range at a time, with the canonical
`source_digest` that each emitted call pins. `include_record`, `include_raw`,
`verbose`, `accept_full_read`, and `compact_read_token` are not route arguments
and fail schema validation for records of every size. The member route is
described in [MCP operation reference](mcp-operation-reference.md#compact-first-work-record-reads).

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

## Bounded search and selected-source reads

`workspace_search_repo` returns ranked pages with a default limit of 8 and a
maximum of 50. Exact totals remain visible, while complete ranked traversal uses
only the executable `next_calls` continuation; callers do not supply offsets or
bulk-expansion switches. Every page frame fits the compact complete-frame class:
the route trims only a contiguous suffix of served hits, and its continuation
resumes at the first unserved hit. A page whose first hit or continuation alone
exceeds that class is retained once and answered with a bounded summary whose
`detail` reads recover every hit, token, and call exactly through scalar ranges;
see [MCP Selected Response Details](mcp-selected-response-details.md). A search
refusal whose recovery calls exceed the class keeps its code and recovers those
calls the same way. Canonical WK/IN/DEC JSON and the
supported Markdown source classes are captured and hashed from the bytes fed to
their incumbent parsers. Persisted index publication remains a separate
operator-owned operation. It publishes only through real cache directories
inside the repository and refuses a symbolic-link or non-regular index
destination instead of writing through it.
Registered searches also index addressable work-record entries: one rendered
source per current root or slice entry version, or per retained version with
`history:true`, independent of how many assignments reference it.

Every file hit supplies a strict `workspace_read_page` search-selection call near
its match, and a separate source-start call only when that call differs; without
one, the targeted call already begins at the first scalar.
That branch returns exact 512-default/1024-maximum Unicode-scalar pages of one
selected Markdown section or JSON scalar, with EOF, range metadata, positive
progress, a continuation, and a source-start call. It cannot mix with ordinary
full/raw/profile/namespace/slice reads. Every entry hit instead supplies the
entry owner's `workspace_work_record_entry_read` body calls, near the match and,
when different, from the version start, bound to that immutable version. Search, selected
reads, work-record summary reads, and entry reads use the same frozen-aware
repository resolver for reviewer and redteam sessions, so those sessions read
only their launcher-bound materialization, and navigation calls emitted by a
lean WK read never redirect them to the live repository.

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
- **Forge confirmation remains authenticated.** Trusted forge handoff prepares
  the two work-record-only closeout commits before publication, and the trusted
  forge merge helper retains its exact candidate, pull-request head and
  mergeability checks, confirmed merge and exact reconciliation.
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
- **A publication outcome is reported only where one exists.** `written` and
  `publication_state` are forwarded from the storage result through one shared
  projection, so every write receipt states the same facts the same way. A
  request that never entered persistence — a genuine no-op, or a refusal
  answered before the record is loaded — declares no publication outcome at all
  rather than a null one, because there is no attempted write to describe.

## Common fixed-fork squash candidate, independent review and exact forge lifecycle

Every forge publication publishes the same thing, whichever delivery workflow the
repository selected.

- **One candidate.** For the selected integrated WK tip `W` and the fixed
  authenticated fork `B`, the existing trusted constructor builds the squash
  candidate `C` with `tree(C) = tree(W)` and sole parent `B`, and handoff
  publishes `C` unchanged. The current base tip is not a construction input.
  There is no direct-`W` alternative, no second constructor and no additional
  candidate store or ref family.
- **The candidate is publication material; review is an independent consumer.**
  Every fresh final integration constructs `C` and materializes its squashed
  candidate worktree, whether or not the canonical record designates a terminal
  review unit. No review unit, review contract, review evidence or retained
  reviewer context is an input to construction, reconstruction, recovery,
  materialization or publication, and the candidate bytes carry no review field.
  Publication requires the squashed candidate worktree bound to exactly `C`; its
  presence says nothing about whether a review ran. The candidate object binding,
  its tree and sole-parent topology, the worktree, the selected version and the
  controlled generation are authenticated on every publication, and the result
  carries no review-selection fact. A terminal review, when one is dispatched,
  consumes this same exact candidate.
- **A selected candidate is resolved from durable state on every call.** Forge
  publication resolves `C` from the fixed current-selection ref through the
  terminal-candidate coordinator: it authenticates the exact-`W` generation,
  re-derives and verifies `C`, converges its selected version and materializes
  the worktree. Process memory does not participate, so a fresh process and a
  warm one resolve the same state. When the current ref is absent but the durable
  fork and WK refs survive, the same candidate is reconstructed byte for byte; when
  either durable ref is absent the stable
  `terminal_candidate_recovery_current_ref_absent` verdict is genuine absence. A
  failed read, an invalid candidate or an authentication failure is never absence:
  it keeps its authenticated cause, stops that attempt before any forge effect,
  and the registered `workspace_wk_forge_handoff` route reports it with
  `stage: "candidate_resolution"`. Recovery consults no current landing state.
- **The fence holds before any external effect.** Repository, WK, fork, tip,
  candidate identity, tree, parent and controlled generation are rechecked under
  the existing exclusion before the branch or the proposal is touched. A moved or
  foreign input, an inconsistent candidate identity, tree or parent, or
  generation drift refuses with zero publication. Configured CCE denial is
  enacted; the absence of a configured decision is not a local denial.
- **Publication is create-or-observe and nothing more.** The result reports the
  exact candidate and proposal identity and the truthful effects. Repeating a
  handoff recovers the same proposal and the already-published closeout chain
  rather than opening a duplicate or appending closeout commits again, a branch
  already present at different bytes refuses rather than being republished, and
  publication neither merges nor completes the WK on the base branch.
- **Closeout preserves the published bytes.** Before initial publication, both
  workflows keep `C` beneath exactly two WK-only commits carrying the actual
  applicable closure evidence and then the parent review-to-done transition, so
  the initially published pull request already carries parent status `done`;
  that status is branch-local until a confirmed merge. A workflow without
  terminal review has no terminal-review record fabricated for it. Merge takes
  the exact authenticated pull-request head only on confirmed mergeability and
  adds no commits, and an unmerged, unknown, moved or foreign state leaves the
  canonical parent in review. The confirmed merged base record is canonical, and a reconciliation
  failure is a typed partial success.

## Recorded worker proof verification and observation

Delivery settlement runs no proof verification. What a coordinator sees is what
the managed worker explicitly ran: each authenticated worker
`workspace_verify_proof` call is recorded for that worker's attempt.

- **Each record is the call itself.** It holds the call's result or modeled
  refusal, including timeout and cancellation, and a server-minted
  `invocation_id`. A repeated call executes again and gets a new record.
- **Each record is bound to identity.** It keeps:
  - the original launcher binding identity and the retained dispatch tuple;
  - the requested selection;
  - the tested source snapshot, contract generation and case revisions.

  A record covers only its requested selection and is worker evidence, not
  independent verification.
- **Observation only reads.** `workspace_agent_run_status` reports a compact
  `proof_verification` fact (`recorded`, `none_recorded` or `unavailable`).
  `none_recorded` is not a pass. `detail: {kind:"proof_verification"}` pages the
  records, and `invocation_id` reads one complete recorded result. Observation,
  settlement and restart execute nothing.
- **It authorizes nothing.** Recorded facts grant no admission, review,
  integration or completion authority.

See
[MCP Operation Reference](mcp-operation-reference.md#recorded-managed-worker-proof-verification).

## Canonical slice start and existing readiness orchestration

`workspace_agent_dispatch` starts a canonical unit. `role` is optional and, when
omitted, is derived from that unit's `dispatch_intent.intended_agent_role` by the
wiki-core dispatch owner; a unit declaring no agent is refused before launch with
zero worker spawned. The assignment itself is resolved by the system from the
canonical slice, its parent and authenticated launcher facts, so caller-authored
`prompt`, `request`, `argv` and `env` are refused at the boundary. Readiness runs
internally through `orchestrateAgentDispatchReadiness`, and
`workspace_validate_dispatch` remains available as the explicit readiness
question rather than a required pre-call. Worker namespace, role and tier,
completion transport, launcher-resolved runtime, launcher-owned review material
and CCE policy ownership are unchanged. Full rules are in
[MCP Operation Reference](mcp-operation-reference.md#canonical-slice-start-and-existing-readiness-orchestration).

## Ordinary selected canonical reads and authoring continuity

`workspace_read_page` addresses one read by repo-relative `path`, canonical `id`
or `unit`, and delegates `entry:{...}` to the entry owner and
`content_reference:{...}` to the retained-spill owner. Exactly one of the three
identities is required; a canonical identity is served by the same id-addressed
reader `workspace_get_record` uses, so no storage address is derived to reach a
record. Emitted calls repeat the caller's identity form, and a delegated entry's
calls come back addressed to this reader.

Each delegated owner keeps its own contract, refusals and grants, and the
dedicated `workspace_work_record_entry_read` and
`workspace_read_mcp_content_reference` routes stay registered unchanged.
Identity, source digest, version, entitlement, Unicode and byte ranges and
complete traversal are preserved, `decision`'s retained-entry exception is
preserved exactly as written, and every ordinary authoring route remains
reachable with incomplete requirement drafts still saveable. The complete rules
are in
[MCP Operation Reference](mcp-operation-reference.md#ordinary-selected-canonical-reads-and-authoring-continuity).

## Code-index query preparation boundary

Workspace code-index file context, consolidated impact, and the four SCIP
navigation routes automatically consume one committed-HEAD SQLite publication
through the shared core preparation owner. Adapters do not implement their own
refresh loop. Preparation may write the ignored derived cache, but dirty
worktree state is only disclosed and never enters the committed pair, its
source bytes, or its inference.

`workspace_code_index_impact` is the ordinary code question over three of those
owners. Its documented selectors decide which one answers, in a fixed published
precedence: a change subject (exactly one of `paths`, `patchText`, `diffRecords`
or `liveGit:true`) asks impact and a compatible `path` or `symbol` narrows that
subject; `symbol`, or `path` with `line` and optional `character`, asks the
definition, reference, caller and callee owners, narrowed by `relationship`; `path`
alone asks file context. Selection has one owner in wiki-core, the registered
schema validates selector shape only, and a conflicting, empty or undeclared
selection returns a correction naming every reachable question. The dedicated
file-context and navigation routes stay registered and unchanged, and role and
tier grants for all six are identical, so the question adds no capability. The
complete rules are in
[MCP Operation Reference](mcp-operation-reference.md#ordinary-code-question-selectors-grounding-and-complete-retrieval).

Before any compact omission, each of those six routes retains its complete
original answer through the authenticated content-reference owner; a retention
failure is returned as that owner's failure. File context and the four
navigation routes bind that answer at `full_result`, as does the composed
symbol answer the code question returns. Impact retains it as a
route-bound selected-response source: its compact response is a bounded summary
with exact counts, the committed identity, `impact_state`, leading affected-file
paths with relationship counts, and an executable `selected_detail` call.
`workspace_code_index_impact` with `detail` reads the retained answer's rows,
fields, and ranges without evaluating, preparing, or rebuilding anything, and
refuses query arguments beside it. Its pages label the retained observation
`current`, `changed`, or `unavailable` against the committed HEAD; see
[MCP Selected Response Details](mcp-selected-response-details.md).
`verbose:true` is a new evaluation, not recovery of an earlier answer.

The prepared cache is `.cache/repo-code-index/graph.sqlite`. Fixed selected
queries capture publication identity, rows, counts, and independent provider
coverage in one read transaction and return copied data after closing SQLite
and lifecycle handles. Responses carry that captured identity as
`graph_snapshot`; adapters preserve it unchanged rather than restamping it.
Stored graph-impact evidence certifies only the publication it captured: when
dispatch readiness knows the current publication, evidence with a missing or
different `graph_snapshot` is not consumed as current, and the current graph
state and existing recovery classification decide instead. Historical evidence
keeps its recorded snapshot.

`workspace_code_index_status` is strictly read-only and reports independent
base and `scip_state` freshness without running the builder or providers.
Provider execution is a backend setup boundary: preparation resolves the fixed
installed `scip-typescript` and `scip-python` names to absolute executable paths
and spawns them with `shell:false` in the committed snapshot. Query arguments do
not select executables, install or acquire packages, or alter environment
authority. The Python invocation receives the validated captured commit as its
explicit `--project-version`; it does not infer a version from archive metadata,
guess one, or add `.git` to the snapshot. Provider failures remain explicit and
may coexist with independent partial evidence.

The shared SCIP decoder uses the official `@scip-code/scip` generated bindings.
Its provider publication stores native `symbol_occurrences` independently of
aggregate graph edges, retaining repeated positions, same-line candidates,
document-local identities, roles, resolution, and coarse one-based inclusive
whole-line source/enclosing regions. End-exclusive multiline ranges ending at
column zero exclude that final producer line. Coverage reports invalid or
unsupported ranges; adapters must not treat these regions as precise cursor
selection or synthesize relationships from proximity.

Provider availability is independent of committed-input freshness. A partial or
unavailable overlay remains fresh and reusable while its committed HEAD and
generator identity match, so provisioning followed only by a normal query does
not replace it. After provisioning, an operator must request a one-time rebuild
with SCIP enabled through a runtime surface that exposes that capability, then
retry. The current role may not expose such a rebuild route; status remains
read-only and cannot perform this recovery.

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

The MCP adapter registers the semantic proof surface from one authoritative
registry. Production registration, discovery, role policy, and routing must
contain the same names. Removed public names are unknown to `tools/call`.

Ordinary proof authoring uses obligation-coverage upsert, query, and remove.
Upsert validates complete request input before invoking the semantic owner and
can atomically combine obligation edits, contract requirements, and explicit
controlled-acceptance disposition. Query returns saved meaning and currentness;
validation reports problems without executing providers. Named-proof discovery
and exact-candidate verification remain separate read and execution operations.

The design-preparation route is temporarily registered during its contract-input
cutover. It exposes no former construction or publication response kinds and is
not required by ordinary save, validation, or verification. Once cutover
evidence is complete, the registry contains only the six durable semantic
operations.

The adapter preserves structured semantic responses, bounded continuation,
strict errors, CAS/currentness, and response serialization. It does not compile
a second schema, translate old payloads, infer missing author intent, or expose
internal carrier, assessment, graph-refactor, or runtime-capture owners.

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
fence for the whole record. Managed persistence, semantic obligation query,
validation, and verification consume the same manifest-selected generation,
and none scans, materializes, binds, or assesses legacy top-level
`wiki/contracts/<WK>.*` copies. Verification reads that generation from the
exact candidate selected by its runtime authority. The manifest names the exact bytes;
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
launcher attachment request exists. It reports the missing canonical contract
source as a typed `controlled_contract_generation_empty` refusal without
inventing a callable correction whose required authored meaning is unknown. A
persistence call never returns authoring state as its normal result, and neither
launcher binding nor persistence is invoked. The launcher primitive owns only persistent-ref
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

Ordinary proof authoring starts with the obligation-coverage query or upsert.
Callers can save incomplete typed case meaning, amend it under the current
digest, read it after restart, validate it explicitly, and remove one selection
without entering a separate preparation or publication session.

The same upsert accepts contract-level requirements and an explicit
controlled-acceptance disposition. It compiles and settles those inputs through
the incumbent owners. Query returns the saved projection, and validation reports
actual missing or invalid inputs. A required disposition needs no inferred
rationale; an explicit exemption requires a nonempty authored rationale.

Named-proof discovery supplies package-owned proof identities and parameter
contracts. `workspace_verify_proof` resolves the saved map against the exact
candidate and is the only public proof operation that executes providers.
Authoring and validation remain nonexecuting.

Preparation refusals keep semantic classification and original diagnostics as
separate facts. A recognized refusal remains `not_executable` when a nested
cause is unknown; the first diagnostic node's `details.evidence` contains the
plain-JSON `agent_launch.diagnostic_evidence.v1` capture made before traversal.
The encoder contract is owned by
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) and
[Launch and admission](mcp-dispatch-launch-and-admission.md), not restated here.
Inline delivery, retained refusal readback, and oversized ranged
`workspace_read_mcp_content_reference` delivery preserve the same evidence.
None of those paths retries provider preparation, repairs a validator cache, or
turns an unclassified cause into execution or recovery authority.

The temporary design-preparation registration remains only for the contract-input
cutover and accepts no retired workflow response kinds. It is not a prerequisite
for ordinary authoring or verification.

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

MCP clients receive a stdio command. For confined Claude and Codex roles,
[decision](../wiki/decisions/decision.md) requires a launcher-owned private
Unix-domain socket adapter. Each command invocation opens one independent
connection and, after authentication, receives one fresh host wiki-MCP process,
protocol session, readiness observer, and lifecycle settlement. Connections may
overlap; they do not share a protocol byte stream. This is a server per MCP
command invocation, not per tool call or per whole dispatch. Direct unconfined
stdio may connect to a directly spawned server. Named-FIFO relays are not a
supported confined transport.

The launcher establishes admission before the confined client starts. It creates
the socket and mode-0600 credential file beneath a private mode-0700 root outside
repositories and worktrees. Bubblewrap projects the endpoint and credential at
`/run/agent-launch/mcp.sock` and `/run/agent-launch/mcp.token`, together with the
launcher-pinned connector and the exact Node executable running the launcher.
The host wiki-MCP server and its dependencies remain outside the namespace.

The client registration is frozen by family:

- Claude receives launcher-authored `--mcp-config` plus
  `--strict-mcp-config` and the role-derived `mcp__wiki__*` allowlist.
- Codex receives only launcher-authored `mcp_servers.wiki` command and args
  overrides in an isolated runtime home.

Both registrations run the same pinned stdio connector. It connects to the fixed
socket path, proves possession of the launcher-minted credential, and waits for
the admission acknowledgement before reading and forwarding client stdin.
Admission spawns a server only after authentication and acknowledges only after
that generation registers and becomes ready. It forwards bytes between that
connection and the server's independent stdin/stdout pipes. The credential
authenticates the already-bound launch and carries no role or routing authority.
There is no TCP, HTTP, remote listener, or URL-based MCP registration.

Each server reports its exact registered tool surface on a launcher-only pipe.
The real client must then complete MCP `initialize`, send `initialized`, and
request `tools/list`. Admission remains available for independent connections
until teardown. Rejected authentication creates no server generation; a failed
generation is settled through its own lifecycle. Conduit teardown closes
admission, settles every owned generation once, reaps owned processes, and
removes endpoint and credential state. Readiness, expected transport EOF,
abnormal server loss, and cleanup classification are detailed in the
[conduit lifecycle](agent-launch-confinement-mcp-conduit.md).

For reviewer and redteam, the expected set comes only from the launcher role
profile. It retains `workspace_tools_list` and `workspace_tools_describe` but
excludes the operator-only
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

Only equality permits initialize and exact `tools/list`. Old, missing,
malformed, unknown, or incompatible generation evidence returns the existing
`stdio_mcp_lifecycle_protocol_incompatible` blocker and bounded
coherent-build/restart detail. The projection preserves that originating modeled
startup identity; it does not replace it with `operator_recovery_needed`.
It authenticates no delivery, creates no review or integration transition, and
opens no retry or fallback.

For each generation, the launcher enforces its own phase machine:
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

The public dispatch-facing taxonomy is registered in
`packages/wiki-core/data/runtime-blocker-codes.v1.json`. Construction and
binding codes include `stdio_mcp_conduit_input_invalid`,
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
family-neutral terminal projection `stdio_mcp_cleanup_failed`. Some retained
identifiers contain `fifo` or `relay`; their names do not establish a supported
FIFO transport. Production composition selects the local socket channel.

## Anonymous metrics

The registration boundary wraps every registered handler exactly once. When the
host setting `AGENT_CHASSIS_MCP_METRICS_ROOT` names a valid destination, that
wrapper records anonymous numeric metrics — registered tool name, UTC hour,
outcome, handler duration, and handler-JSON byte counts — into compressed local
files, and otherwise forwards calls unchanged. It never records arguments,
results, errors, or caller, session, or repository identity, and it never changes
a tool's result or thrown value. There is no MCP route for reading metrics; the
files are the interface. The server's existing shutdown close hook flushes them.
See [Anonymous MCP metrics](mcp-telemetry.md) for the format, retention, limits,
and crash-loss behavior.

## Role authority

Tool authority comes from the launcher-resolved role profile, never prompt,
repository settings, user settings, environment, arbitrary argv, or caller MCP
configuration. Workers receive only the closed-input `commit` capability.
Reviewers and redteam are findings-only and have empty write scope.
Orchestrators receive the coordinator tool profile. Agy is unsupported for this
confinement contract and is refused before launch.

The frozen per-run binding covers family, assigned unit, role profile, worktree
identity, R union W visibility, write authority, host-server factory, local
admission endpoint and credential, exact connector registration, and lifecycle
owner. Each admitted connection has its own server generation. A binding is
immutable and cannot be reconstructed or replayed across runs or families.

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

The submission outcome is reported as truthfully as the write it depends on.
`commit_slice` and `workspace_submit_for_review` share one response owner, and
its `submitted` field (surfaced by the commit response as
`submitted_for_review`) carries the same three outcomes as `written`: true where
the canonical implementation-to-review transition demonstrably landed or was
already in place, false where it demonstrably did not, and null where storage
could not establish canonical publication. A null is not a success and not a
demonstrated failure; it is the same uncertainty the receipt beside it reports,
and the caller inspects the canonical record rather than repeating the
submission. Reporting an outcome truthfully grants no additional authority:
the route still moves only the assigned unit to review and still advances no WK
ref and authorizes no integration or completion.

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
the returned effect. The sole ordinary `workspace_validate_dispatch` response
and ranged content-reference transport carry the complete relevant typed result,
reasons, response provenance, and retained recovery carrier value-identically
and in producer order. The normative request, response, recovery, detail-owner,
and size contract is in [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md).

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

Use `workspace_create_record` for allocator-backed record creation in a configured workspace. Creating a `WK-*` produces the canonical inbox template only; the route accepts no caller filesystem root and no birth-time controlled contract, proof bundle, slice graph, readiness claim, or lifecycle status. Its response names ordinary obligation-coverage query as the next call so the caller can obtain the combined revision before authoring contract requirements and explicit controlled-acceptance disposition through ordinary upsert.

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
by accepted decision section 5: `graph.sqlite`, the owned same-directory
`.graph-candidate-*.sqlite` preparation file and its rollback journal, and the
small `lifecycle.sqlite` updater lock. Publication identity is recorded in the
graph database, and an update publishes by renaming a complete candidate over
`graph.sqlite`; there are no lease rows or filesystem lock, candidate-slot,
heartbeat, or release files. A publication already tagged with the captured
commit is reused without writing; these cache files are produced only when
automatic preparation finds the committed index missing, stale, incompatible, or
without complete provider coverage.

The route reports whatever admission returns and defines none of it: it sets no
thresholds, verdicts, or remedy selection, and does not duplicate admission
policy. Admission remains the authority for the projection and its refusal
reason.

## Advisory tool-router continuations

`workspace_tool_router_recommend` is a compact read-only selector, not an
authority boundary. A matched result names its `suggested_arguments`, explicit
`required_authored_fields`, and `next_calls_completeness`. When the proposal is
complete it contains exactly one recommended canonical `next_calls` entry. When
a route-authored field or an unconditionally required request property is
missing, the result stays `matched`, names the `operation`, and returns an empty
`next_calls` with zero completeness counts: an incomplete proposal is guidance,
never an executable partial call. A missing field that the route declares as
server state is not an authored choice. It appears in `server_state_fields` with
the `result_field` of its declared read, and when that read is visible and its
arguments are complete, `next_calls` contains the read as the one recommended
call. For example, proof-obligation authoring names the obligation-coverage
upsert, requires authored `obligations[]` items that each carry their
`obligation_id`, and recommends
`workspace_controlled_contract_obligation_coverage_query({unit})`, whose
`content_digest` is the upsert's `expected_content_digest`. Obligation removal
reports the same server state. An explicitly supplied supported `focus` is
carried into both the proposed write and that digest read, so the digest always
belongs to the selected focus; an unsupported focus is dropped rather than
proposed. A hidden read is
not named, and its field stays in `required_authored_fields`. It does not append a family inventory,
disallowed catalog, or unrelated alternative. The result does not decide
readiness, admission, mutation, dispatch, lifecycle, or policy; the named
operation independently validates its request and owns every such decision.

An ambiguous result recommends no operation. It returns ordered
`clarification_choices`; each visible choice names the exact operation, known
arguments, and missing authored fields. Only a complete choice also appears in
`next_calls`, as an unflagged alternative rather than a recommendation;
`candidate_count_total` counts choices and `next_calls_completeness` counts only
emitted callable entries.
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
`known_resources.tool_name`) or a docs/wiki path, and that recovery operation is
visible, `next_calls` contains one bounded executable recovery
(`workspace_tools_list({task_id})`, `workspace_tools_describe({tool_name,
limit:1})`, or `workspace_search_repo({query})`) and `recovery.state` is
`callable`. Otherwise the list is empty and `no_supported_route`,
`stop_condition`, and `recovery.state` all explicitly report
`no_supported_route`; prose guidance is never the only termination signal.

Every executable call the router emits, including ambiguous alternatives, the
complete-candidate continuation, recovery calls, and their nested copies, is
checked against the named tool's registered request contract before it is
built. The published request schema of that tool must accept the exact
arguments under the shared next-calls request-contract check, and the tool's
original full input schema must accept them too, so an undeclared field, a
union member, a pattern, or a refinement that a compact declaration cannot
express still decides. Emitted arguments are never replaced by parser output.
A missing registration, an unprojectable schema, or server-authored arguments
that fail either check are producer defects: the route fails visibly with
`tool_router_request_schema_unavailable` or
`tool_router_request_contract_invalid`, naming only the selected tool and the
failing stage. Neither error nor any ordinary response carries a schema, a
schema registry, field values, or validator trees, and no automatic verbose
discovery is added; a caller that wants a tool's complete contract uses
`workspace_tools_describe` with that `tool_name` and `verbose: true`.

Role and subject routing follows the current target contracts. A worker start
or dispatch request recommends `workspace_validate_dispatch` with
`dispatch_role: "implementation"`. An explicit reviewer or redteam dispatch
recommends `workspace_agent_dispatch({subject, role})` directly and never enters
worker readiness; an explicitly known `diff_base_sha` and `reviewed_sha` are
forwarded from `known_resources` unchanged, and a selected initiative is an
eligible subject only for redteam. A readiness question maps worker or
implementation to `dispatch_role: "implementation"`, explicit `read_only` to
`read_only`, and omits the role when it is role-agnostic; a reviewer or redteam
readiness question selects compact `workspace_tools_describe` for
`workspace_agent_dispatch`, whose findings operation assesses its own material.
A missing or unsupported role is an authored choice and is never remapped.
Monitoring recommends `workspace_agent_run_status({subject})` from an explicit
canonical WK, slice, or IN subject or the selected context; a monitor handle is
never a status argument, and a proof identity never becomes an agent-run
subject. List editing uses the ordinary editor with the known `unit` and
`kind: "list"` and requires the authored `field`, `action`, and `value`.
Replacing a summary uses the same editor with `kind: "scalar"`,
`field: "sections.summary"`, and `action: "replace"` and requires the authored
`value`; descriptive task text is never used as replacement content. A request
to read one known entry recommends
`workspace_work_record_entry_read({unit, entry_id, include_body: true})`, and a
request to list a unit's entries recommends it with the unit alone. Other
selected-context requests, such as acceptance criteria or write scope, keep the
compact summary route. A request for a unit's contract requirements and claims
recommends `workspace_controlled_contract_obligation_coverage_query({unit})`.

Phrases match as normalized substrings, or when their words occur in order
separated only by articles, possessives, prepositions, run-role qualifiers such
as `reviewer`, and parts of durable identifiers. "Replace the summary of
WK-0001" therefore matches the phrase "replace summary", and "Monitor the
reviewer run" matches "monitor run". A task that uses a write verb without
asking for an explanation is a write request; explanatory guidance and entry
reads do not match it. A field name such as `write_scope` is not a write verb.
A request for the initiative or unit status lens selects
`workspace_initiative_status` rather than run monitoring, and a slice address
inside a monitoring request is that run's subject rather than a request for the
slice record; a genuinely additional request keeps the result ambiguous.

A task that asks for an explanation and also asks to write is not answered as
pure help. The result is ambiguous, states that reading the guidance alone would
drop the requested write, and offers the explanation as an unflagged
alternative; no save is synthesized, and the authoring operation's missing
authored fields stay the caller's to supply.

Routing uses the checked-in intent vocabulary and module-relative discovery
metadata. The intent vocabulary alone owns match phrases, semantic intent
identities, prerequisite declarations, and intent-to-operation mappings. The
assembled descriptor owns task identities, recommended-first-call metadata,
availability, and broad ordering. The generic next-calls descriptor constructs
and validates the resulting call list. The MCP adapter scopes the descriptor by
the launcher/server-minted role and tier before selection; request fields,
prompt text, argv, and ambient caller data cannot widen it. The adapter also
passes the request-contract lookup of the registrar it was registered through
(see Registered request contracts below); a hidden operation is withheld before
any lookup. A matched but hidden
operation returns `visibility_withheld` with the closed reason
`operation_not_visible_in_session_profile`, no operation identity, no recovery,
and no refusal claim.

The router neither reads nor derives authority from repository-root
`AGENTS.md`, so construction is identical when that file is present, empty, or
absent. Responses remain task-selected and do not expose a flat tool catalog.

The router is optional. A caller that already knows the exact supported
operation calls it directly, and that operation's registered request contract,
refusals, and results remain authoritative. The router serves requests whose
tool choice is uncertain. Neither the router nor `workspace_tools_list` or
`workspace_tools_describe` discovery is a prerequisite for a known call.
Discovery answers actual discovery needs, such as an unknown capability,
availability, or a tool's complete contract.

### work record live routing baseline

The current regression population contains nine cases: WK allocation,
acceptance editing (guidance with required authored fields and no executable
call), controlled authoring entry, obligation coverage query, unknown proof
intent discovery, known-unit reviewer dispatch, known-handle monitoring by
canonical subject, documentation lookup, and one role-invisible operation. The
baseline is classification accuracy `9/9`, first-operation/outcome accuracy
`9/9` (including the expected guidance and withheld outcomes), recommended-call
count `7/9`, duplicate count `0/7`, populated server-known argument rate
`10/10`, and calls before the owning operation `0/7`. The compact JSON results
total 4,599 UTF-8 bytes under the test's sum-of-serialized-results measurement.
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
normalized automatically. A refined route that also declares an input-failure
projector registers that inner object as a declaration-only view, so the full
schema in the handler is the one validator and its unknown-field and type
refusals reach the projector too. Tool authors may therefore use refinements
freely. The `$schema`-absent empty-object sentinel on `tools/list` is the
symptom to watch for; `tests/mcp-startup-regression.test.mjs` fails on any
argument-accepting tool that publishes it.

A request the enforced schema refuses inside that wrapper fails unchanged as a
typed input failure, not as an internal handler exception. The result is
`isError: true` with `ok: false` and a `diagnostic` whose `code` is
`tool_input_validation_failed` and whose `authority_limb` is
`mechanical_failure`. The diagnostic is generated from the validator itself:
`message` is the tool name followed by the complete validator message,
`validator_diagnostics` is the complete issue list (issue codes, paths, expected
and received types, enum options, bounds, and every nested union branch), and
`rejected_field_paths` renders each issue path. An owner projection carried on an
issue, or a route's input-failure projector result, keeps precedence. Route details
passed to `createToolInputValidationError` may add facts but cannot overwrite its
generated diagnostic fields. Proof
discovery adds `allowed_field_sets`, the fields each alternative of its request
union permits, read from that union. `workspace_read_page` adds
`digest_placement` for a misplaced top-level `expected_source_digest`. The
failure carries `next_calls` only when a route names a call it checked against
its own complete schema; `workspace_read_page` offers the same read without the
misplaced digest. The server does not retry, reduce a bound, substitute a value,
or require a discovery call first, and an oversized diagnostic spills through
the same content-reference transport as any other result. A validator,
projector, or handler that throws is still an unexpected internal failure, and
a plain object schema is still refused by the SDK with `-32602` before any
handler runs. Proof discovery defines each request field once and composes both
its strict alternatives and its compact advertisement from those definitions.

A compact registration declares `advertisedInputSchema` beside its authoritative
`inputSchema` and may declare `inputContractSchemaSource`: `authoritative`, the
default, or `advertised`. The boundary consumes both declarations and neither
reaches the SDK. The SDK receives a declaration-only view of the advertised
schema, the compact declaration register keeps the advertised schema itself, and
the source selects only which of the two schemas verbose discovery projects as
the complete input contract. The handler enforces the authoritative schema
whichever source is selected. An unrecognized source refuses registration with
`agent_tool_input_contract_schema_source_invalid`, and `advertised` without an
advertised schema refuses with
`agent_tool_input_contract_schema_source_without_advertised_schema`; both fail
before the SDK registers the tool.

### Registered request contracts

The same boundary retains, per registrar, the request contract of every tool it
actually registers, in `packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs`.
`createRegisterTool` creates one store for the registrar it returns. After the
profile and tier gates and a successful SDK registration, the store keeps a
reference to the original `inputSchema` and to the effective schema handed to
the SDK (the compact advertisement, the inner object of a refined schema, the
raw shape, or no schema for a deliberately argument-free tool). Hidden, skipped,
and failed registrations retain nothing, and a lookup for an unregistered tool
returns nothing rather than an empty contract. A second registration of the same
name with a different declaration is refused and withdraws the retained
contract. `registeredToolRequestContracts(registerTool)` returns the lookup of
exactly that registrar, so server instances never share contracts and a wrapped
registrar has none of its own. Lookups read the live store, so a tool registered
after a consumer obtained the lookup resolves at request time.

The store is an internal handoff: it is not a tool, a protocol surface, or a
copied argument table, and nothing in it is serialized. For one selected tool it
projects the published JSON Schema lazily with the installed SDK's own
`normalizeObjectSchema` and `toJsonSchemaCompat` conversion, using the same
`strictUnions: true` and `pipeStrategy: "input"` options as `tools/list`, and
caches it for the registrar's lifetime. Full validation uses the retained
original schema's async parser. No handler, audit wrapper, input-failure
projector, repository resolver, or dispatch backend runs during either check.
Retention costs one entry per registered tool; projection and validation happen
only for the tools a consumer selects.
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
surface before inference. It includes `workspace_tools_list` and
`workspace_tools_describe` and excludes the
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
