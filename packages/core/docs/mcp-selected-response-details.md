# MCP Selected Response Details

This page owns the internal composition that lets a wiki-MCP route answer with a
bounded summary and explicitly selected detail instead of an oversized ordinary
response. The public route contracts that use it are described in
[MCP Dispatch Runtime Contract](mcp-dispatch-runtime-contract.md) and
[MCP Integration](mcp-integration.md).

## Owners

The composition lives in `packages/wiki-mcp/src/lib/selected-response-snapshot.mjs`.
It composes incumbent owners and adds no store, codec, limit or authority:

- `mcp-response.mjs` retains bytes (`jsonContent` forced spill), reads them back
  whole and verified (`readRetainedArtifactBytes`, the one internal byte reader
  it shares with the managed verify-proof cache) and measures the complete
  structured frame (`measureMcpInlineResultBytes`).
- `createTaskResultSnapshotRegistry` is the only pager, snapshot identity, cursor,
  expiry, field and scalar-range mechanism. The composition injects its
  complete-frame measurement, original-order paging and a scalar range bound
  whose base64 frame fits (three source bytes per four characters, published
  once).
- `buildNextCall` and `buildPublicMechanicalRefusal` own emitted calls and refusals.

The readiness adapter lives in
`packages/wiki-mcp/src/lib/validate-dispatch-response-selection.mjs`. The
obligation-coverage query adapter lives in
`packages/wiki-mcp/src/lib/controlled-contract-query-response.mjs`; its source and
authority identity come from `controlled-contract-query-context.mjs` (see
[Acceptance Coverage MCP](acceptance-coverage-mcp.md)).

Write receipts have a separate compact projection: see
[MCP editor response projections](mcp-editor-response-projections.md). In
particular, compact task-write receipts omit authored text and point to a
source-digest-pinned read-only continuation; `verbose: true` retains the task
detail.

## Delivery bound

Every summary, detail page, empty page, refusal and recovery frame fits
`min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, activeMcpInlineByteLimit())`,
measured on the complete serialized result including escaping, frame keys and
emitted calls. The bound is a delivery bound, not a content cap: every omitted member or
value stays reachable through a collection page, a field inventory or scalar ranges.

Proof-intent discovery candidate pages and selected proof detail use the same
class and the same scalar-range arithmetic
(`scalarRangeBytesWithinDeliveryBound`), for page admission and for every
emitted range continuation. They keep their own session: `proof_name`
selectors and the package catalogue's source-change refusal are proof
semantics, not a retained-carrier source.

## Retained source

A route retains one envelope, once:

```json
{
  "schema_version": "selected-response-source.v1",
  "binding": { "route": "…", "repository": "…", "unit": "…", "query_identity": null, "observation_identity": "…" },
  "carrier": { "…": "the route's complete permitted presentation, unchanged" }
}
```

The returned locator `{ref_id, sha256}` authenticates the whole envelope.
Reconstruction equality refers to `carrier`. The retained file is an ignored
transport artifact, not canonical evidence or a lifecycle write.

A retention that fails throws an error carrying the response boundary's
`spill_persistence_failed` refusal, whose `cause_diagnostic` is the original
filesystem failure. A producer whose operation already settled reports that
error through `describeRetentionFailure` (see
[MCP integration](mcp-integration.md)) rather than only its code, and
advertises no locator.

### Protected task sources

A producer whose retained source is a selected task result passes its owner
call to `retainSelectedResponseSource` (`ownerCall(locator)` and that route's
request schema). The same retention writes, beside the bytes, the one owner
call that reads them. The
public ranged reader then refuses those bytes with
`mcp_response.content_reference_ranged_read_unavailable.v1`
(`content_reference.failed_limb: "selected_access"`) and offers that owner call
as its exact next call; both public entrypoints, `workspace_read_mcp_content_reference`
and the `workspace_read_page` `content_reference` delegate, go through that
reader. Internal reads never pass through the guard. The current protected
producers are:

| Producer | Binding | Owner read |
| --- | --- | --- |
| `workspace_verify_proof` (standalone) | route, repository, unit, `{subject, source}`, result identity and authenticated orchestrator session for source ambiguity | `workspace_verify_proof` with `result` and a subject; a retained ambiguity also accepts one exact source tuple |
| `workspace_work_record_set_status` / `workspace_work_record_set_closure` receipt | producing operation, repository, unit, `{source_digest, publication_state}` | `workspace_work_record_summary` with the unit and `receipt` |
| The four code-index navigation routes, `workspace_code_index_context_for_path` and `workspace_code_index_impact` | route, repository, query arguments, index HEAD | the same route with `detail` naming the answer's first semantic subject (see [Code-index answers](#code-index-answers)) |
| `workspace_agent_run_status` authored documents (terminal-candidate contracts, controlled generation, written record) | route, repository, observed subject, question `authored_documents`, attempt and candidate | `workspace_agent_run_status` with `attempt_id` and `detail.kind: "authored_document"` naming the first retained document (see [MCP dispatch monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md#retrieving-the-omitted-documents)) |
| `workspace_agent_run_status` captured retry assessment | route, repository, subject, question `retry_assessment`, attempt | `workspace_agent_run_status` with `attempt_id` and `detail.kind: "retry_assessment"` (see [MCP dispatch monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md#the-retry-assessment-detail)) |

For a standalone source ambiguity, this protected source retains the complete
original refusal once. The public answer gives up to three exact source
identities and read calls; any recorded tuple can be selected by its exact
`source:{unit,focus?}` alongside `result`. The owner read returns that tuple's
original execution descriptor without executing it. This is a semantic read
of the one retained original; no collection page, byte range or second source
is created. A failed retention reports its cause and supplies no locator.

`workspace_record_graph_impact_evidence` reads an impact source internally when
given `graph_impact_source`, requires the impact route and an `impact` answer,
and persists that complete original; it serves no bytes, evaluates nothing and
reports the retained `observation` (`current`, `changed` or `unavailable`
against the repository's committed HEAD). Evidence a dispatch-family
route retains for the operator (`retainOperatorOnlyEvidence`) has no public
owner read and is refused with no supported route.

Readers that are not the producing route pass `route` separately to
`readSelectedResponseSource` so a refusal names the reading route, and check the
retained producer route themselves.

A route that answers from a retained source WITHOUT a selected-response session
reads it with `readSelectedResponseSource`, checks the stored binding (including
the question its `query_identity` names) against the server-resolved request,
and presents a semantic selection of it; the caller never reassembles bytes. The
monitor route's authored documents and captured retry assessment are answered
this way — see
[MCP dispatch monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md#retrieving-the-omitted-documents).

The carrier is paged as collections. `members` has one row per top-level member
in carrier order, either `{id, value}` or, for a top-level array, `{id,
collection, count}`. Each top-level array is its own collection of `{id, value}`
rows, where `id` is the array index.

## Detail requests

A detail request is `{source, snapshot_identity?, cursor?, collection, selector?,
ordinal?, field_path?, offset?, length?}`:

- With `snapshot_identity` or `cursor`, the read is served from this host's
  registry.
- Without either, the composition reads every retained byte, verifies the digest
  before parsing, checks the stored route, repository and unit against the
  server-resolved request, and then serves the same selection.
- `ordinal` restarts a collection or field inventory at a page boundary the
  original traversal emitted.

Every emitted continuation carries the explicit locator and selection, so it
stays executable after the cursor that accompanies it can no longer
authenticate. A detail read never revalidates, evaluates CCE, rebuilds a graph or
presents a fresh result as the retained one.

Each detail page carries `retained_source`: route, locator, repository, unit,
query identity digest and observation identity. `observation.state` is
`current`, `changed` or `unavailable`, from a read-only comparison performed
outside the registry.

## Authority identity

A session created with `requireAuthorityIdentity: true` authenticates its
callers. Its binding carries a server-resolved `authority_identity`: the retained
envelope stores it whole and the hot summary (`retained_source`) stores its
`authority_identity_sha256`, so a hot cursor or snapshot identity is compared with
exactly what a cold locator read compares. Retention without an identity is
refused, and every detail read — hot cursor, snapshot identity or cold retained
locator — requires the caller's re-resolved identity to be present and equal to the
retained one before any page is returned. An absent expected identity refuses with
`authority_identity_missing`; an absent or different retained identity refuses with
`source_binding_mismatch` naming `binding_field: "authority_identity"`. A session
that does not declare the requirement retains its exact binding shape and
semantics. The obligation-coverage query is the declaring route.

A session may also reserve `navigationReserveBytes` for navigation the route
appends to a detail response. The reserve applies to scalar ranges and to every
registry page the route's `pageAppendsNavigation(page)` says it will extend
(by default, every page). A page the route serves unchanged is admitted against
the whole delivery bound. The obligation-coverage query extends a page with a
descend template for a row projection or field inventory, or with the
next-collection call when a whole-collection page carries no continuation. A
mid-collection page that already continues by cursor is served unchanged. The
complete frame is still measured against the delivery bound.

A value holding a reserved controlled-contract assessment envelope is never
emitted whole. Its row and field inventories advertise its parts, and the
readiness adapter applies `assertNoControlledContractRawResponse` to the emitted
controlled-semantic value.

## Code-index answers

The six code-index query routes do not use the paging session. Their owner,
`createCodeIndexAnswerSelection` in
`packages/wiki-mcp/src/lib/code-index-query-response.mjs`, composes only
`retainSelectedResponseSource` (one protected retention per answer) and
`readSelectedResponseSource` (the whole, digest-verified read). It adds no
registry, cursor, snapshot identity, codec or store.

The ordinary answer is the route's bounded summary plus `selected_detail`
`{schema_version: "code-index-selected-summary.v2", source, collections}` —
the opaque locator and the exact row count of every selectable collection — and
one top-level `next_calls` entry selecting the answer's first semantic subject
(the first affected file by `path`, or the first definition, reference, caller
or callee by its hit identity). That call is also the owner call the public
reader returns for the retained bytes. Calls are published once, never inside
`selected_detail`.

Navigation summaries (the four navigation routes and a composed code question)
fit the same complete frame, `selected_detail` and `next_calls` included, at
their projection owner, `fitNavigationSummary` in
`packages/wiki-core/src/lib/sidecar-navigation-projection.mjs`. The largest
leading prefix of rows and candidates whose identities fit is shown with exact
totals. At that prefix, displayed region texts are first represented by
`omitted.source_text.utf8_bytes`, and hit entries that only repeat a displayed
row are dropped with an exact `counts.source_hits`; texts are then restored in
answer order while the frame fits. A composed answer shares one row limit
across its parts, states an identical publication `graph_snapshot` once, and
offers each non-empty relationship collection as its own call after the first
subject. An ambiguous composed target may therefore show no rows, only its
resolution, candidate counts and totals, with those calls and an explicit
`candidates` call.

A detail request is `{source, collection, selector?: {id}, path?, symbol?,
relationship?, input_path?, lines?: {start_line, end_line}}` and nothing else; `cursor`, `ordinal`, `offset`, `length`,
`field_path` and `snapshot_identity` are not part of the schema and are refused
by the handler as `detail_invalid`. `collection` names one top-level row
collection of the retained answer or one top-level result member (such as
`graph_state` or `source`). The caller's own query material
(`input_diff_sources`, a supplied patch) stays retained and is never
selectable. Every supplied filter must hold:

- `selector.id` — a returned row's own identity (`hit_id`, `region_id`,
  `edge_id` or `id`), or the value of a path row.
- `path` — a row naming that file (`path`, `document_path`, `input_path`,
  `newPath` or `oldPath`, or the row itself).
- `symbol` — a row naming that symbol (`symbol`, `symbol_key`, `symbol_id`,
  `caller_symbol`, `callee_symbol` or `symbol_keys`).
- `relationship` — a row of that `kind`, or a row whose relationship lists are
  reduced to entries of that kind.
- `input_path` — within one selected `affected_files` row, the exact input path
  of its retained relationships, optionally narrowed by `relationship`.
- `lines` — absolute, inclusive, one-based source lines within one retained
  `context_regions` row selected by `selector.id` or one `complete_files` row
  selected by `path`. The selected text preserves Unicode, BOM and line endings.

`candidates` selects the original `symbol_resolution.candidates` population by
symbol or path. A composed answer keeps candidates distinct by relationship;
the `relationship` filter selects that part. Multiple matches remain explicit.

A detail response (`code-index-selected-detail.v1`) carries `observation`
(`current`, `changed` or `unavailable` from a read-only comparison of the
retained index HEAD with the current committed HEAD), `selected_detail` with the
source, collection, selection, `presentation` and exact `counts` (`total`,
`matched`, `returned`, `truncated`), the selected rows under the collection's
own name, and `next_calls`. When the whole matched selection fits the delivery
bound it is returned as the original rows (`presentation: "complete"`).
Otherwise a single row answers with its compact view: every member of at most
512 UTF-8 bytes unchanged, and each larger member under `omitted` with its exact
`count` (plus relationship `kinds`) or `utf8_bytes`; `next_calls` then select
each relationship kind and, within a selected kind, actual `input_path` choices,
or an actual source location within a region or file whose text was omitted.
A broad selection answers with the leading compact rows
in original order, exact counts, and calls selecting its first rows by their
own subject. Nothing is clipped, continued by position or assembled from
fragments; a text larger than the delivery bound is represented by its exact
size. A source-line call identifies a code location; it is not a consecutive
window protocol for reconstructing a file. A requested line range that cannot
fit refuses without clipping; an indivisible line larger than the frame remains
a stated limit.

A detail read never evaluates the question, prepares or rebuilds the index, or
retains a new source, and a restarted host reads the same retained observation.
A detail request that also carries query arguments is refused as
`detail_excludes_query_arguments` with the exact detail-only call as its
callable next call, but only after its selection resolves; otherwise the
selection's own refusal is returned. `collection_unknown` (with the selectable
collection names, and `retained_query_material: true` for the patch),
`selection_matched_nothing`, `selection_not_applicable` (a filter on a result
member) and `source_binding_mismatch` (a source retained by another route or
repository) name the exact cause and disclose no other result.

## Refusals

| Condition | Code | Continuation |
| --- | --- | --- |
| Snapshot identity or cursor unknown, expired, evicted or from another host | `selected_response_snapshot_unavailable` | The same selection bound to its source, without the lost identity or cursor. A read that already carried no identity declares no supported route. |
| `field_path` without a row (`field_requires_exact_row_identity`) | `selected_response_query_invalid` | One callable correction: the same retained source, identity form and collection without `selector`, `field_path`, `ordinal` or range. It inspects the collection's rows and their valid field paths; it does not return the requested field. |
| `field_path` whose field the exact selected row does not carry (`field_unknown`) | `selected_response_query_invalid` | One callable correction: the same retained source, identity form, collection and `selector` without `field_path`, `ordinal` or range. It inspects that row's valid structure; it does not return the requested field. |
| Unknown collection, invalid selector, unknown or non-unique row, any other invalid field path, ordinal or range; source bound to another route, repository, unit or authority identity; locator that is not a selected-response source | `selected_response_query_invalid` | No supported route; the deciding facts carry the exact reason. |
| Retained bytes missing | `mcp_response.content_reference_ranged_read_unavailable.v1` | No supported route; `content_reference.failed_step` is `content_reference_not_found`. |
| Retained bytes whose digest does not match, or that do not parse | `mcp_response.content_reference_ranged_read_unavailable.v1` | No supported route; `content_reference.failed_step` names the integrity failure. |

A field correction is offered only after the same snapshot serves the corrected
selection through the source, route, repository, unit, authority and selection
checks; a foreign, unavailable or otherwise invalid selection keeps no supported
route. The correction never prepends a field, guesses a row, re-executes the
query or retains the source again.

## Readiness summary

For readiness, a presenter carrier that fits is returned whole with
`selected_detail.complete: true`. Otherwise the summary spends the complete-frame
budget in this order, measuring each step on the complete frame:

1. Reserved: the header (schema version, repository, record, unit, dispatch
   role, `dispatchable`, `decision_code`, `reasons_total` and `cluster_count`);
   the locator, the snapshot identity, collection counts and the required detail
   calls; the next action; `reasons` and owner `next_calls`, each whole when it
   fits and otherwise as exact counts (`selected_detail.reasons.total` and
   `distinct_total`, `selected_detail.owner_next_calls.total`) with the call for
   its original collection; and the decision scalars of admissibility and
   controlled acceptance.
2. The optional navigation call for the first omitted member, when it fits.
3. Graph failure code, auto-recovery, recovery and state, each whole when it
   fits.
4. Otherwise reason and owner-call identities, alternating between the two
   populations in original order: a distinct reason as its first ordinal and
   exact count, an owner call as its ordinal, tool and recommendation.
5. Long values of listed distinct reasons that fit.
6. Refusals, structural readiness, admissibility, controlled acceptance and
   inventories, whole while they fit.

The call for the first omitted member is recommended until the owner's own
`next_calls` are inline; after that it is optional navigation. Optional
navigation that does not fit after the reserved content is left out, but only
when it serves no required purpose and a required detail call for the same
retained source remains. The member stays named in
`selected_detail.omitted_members` and is read by sending that remaining call
with `collection: "members"` and `selector: {id: "<member>"}`. The last detail
route, and a call that is also required, are never left out.

A member is inlined whole under its original key or named in
`selected_detail.omitted_members`, never truncated. Owner-identical reasons are
counted together; differing ones are never collapsed. Each identity population
carries `inline: {complete, listed}`. When `complete` is `false`, the listed
identities are an original-order prefix, not the whole population, and
`selected_detail.next_calls` includes a detail call for that population's
original collection (`reasons` or `next_calls`), beside the call for the first
omitted member when that call is offered. Cardinality alone never refuses valid readiness.

A chosen reason or owner call is read directly: send that collection call with
`selector: {id: "<ordinal>"}`. The row is the original value, or its field
inventory and scalar ranges when it is too large, so a chosen row never needs
preceding pages or another readiness evaluation. Following the collection's
continuations recovers every occurrence, multiplicity and unchanged call argument
when the complete population is needed.

## Obligation-coverage query

The query adapter returns a result that fits whole with `selected_detail.complete:
true`. Otherwise it retains the result once. The compact view carries the identity,
disposition, source authority and population members, then the contract digests,
controlled acceptance and inventory summary while they fit, naming the rest in
`selected_detail.omitted_members`, with collection counts and one `next_calls` entry
that starts complete retrieval. A `parameter_detail` read of one known obligation
places `parameter_selection` before the optional members, at the largest size that
fits. A partial size names every parameter-contract field it leaves out in
`not_inline`, and leads `next_calls` with the exact field read of the first of them
on that retained obligation instead of recommending the first collection; each such
read names the next, until every named field is delivered. `view: "complete"` returns that retrieval's first
page directly. When a whole-collection traversal ends, the adapter appends the call
for the next non-empty collection in carrier order after `members`; a page whose
row or value arrives as a field inventory also carries a `descend` template, to
which the caller adds each listed `field_path`.
