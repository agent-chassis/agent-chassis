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
  (`readSpilledMcpContentReference`) and measures the complete structured frame
  (`measureMcpInlineResultBytes`).
- `createTaskResultSnapshotRegistry` is the only pager, snapshot identity, cursor,
  expiry, field and scalar-range mechanism. The composition injects its
  complete-frame measurement, original-order paging and a scalar range bound
  whose base64 frame fits (three source bytes per four characters, published
  once).
- `buildNextCall` and `buildPublicMechanicalRefusal` own emitted calls and refusals.

The readiness adapter lives in
`packages/wiki-mcp/src/lib/validate-dispatch-response-selection.mjs`.

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

A route may publish the retained source WITHOUT a selected-response session, by
emitting `workspace_read_mcp_content_reference` for the locator and letting the
caller reassemble by `next_offset` — decoding each page's base64 separately and
concatenating the decoded bytes, never the encoded strings — then verify `sha256`
and parse the envelope. It emits no `length`: the reader owns its per-call bound and reports `total_bytes`
and `max_length` on its first page, so the publisher carries no second copy of
that config. This path adds no pager, cursor or expiry — the retained bytes, the
digest check and the missing/corrupt refusals are the incumbent reader's. The
monitor route's terminal-candidate authored contracts use it — see
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

A value holding a reserved controlled-contract assessment envelope is never
emitted whole. Its row and field inventories advertise its parts, and the
readiness adapter applies `assertNoControlledContractRawResponse` to the emitted
controlled-semantic value.

## Refusals

| Condition | Code | Continuation |
| --- | --- | --- |
| Snapshot identity or cursor unknown, expired, evicted or from another host | `selected_response_snapshot_unavailable` | The same selection bound to its source, without the lost identity or cursor. A read that already carried no identity declares no supported route. |
| Unknown collection, invalid selector, field path, ordinal or range; source bound to another route, repository or unit; locator that is not a selected-response source | `selected_response_query_invalid` | No supported route; the deciding facts carry the exact reason. |
| Retained bytes missing | `mcp_response.content_reference_ranged_read_unavailable.v1` | The incumbent reader's refusal, unchanged. |
| Retained bytes whose digest does not match, or that do not parse | `mcp_response.content_reference_ranged_read_unavailable.v1` | No supported route; `content_reference.failed_step` names the integrity failure. |

## Readiness summary

For readiness, a presenter carrier that fits is returned whole with
`selected_detail.complete: true`. Otherwise the summary spends the complete-frame
budget in this order, measuring each step on the complete frame:

1. Reserved: the header (schema version, repository, record, unit, dispatch
   role, `dispatchable`, `decision_code`, `reasons_total` and `cluster_count`);
   next action, graph failure code, auto-recovery, recovery and state when each
   fits whole; the decision scalars of admissibility and controlled acceptance;
   exact counts (`selected_detail.reasons.total` and `distinct_total`,
   `selected_detail.owner_next_calls.total`, collection counts); the locator,
   the snapshot identity and the detail calls.
2. `reasons` and owner `next_calls`, each whole when it fits.
3. Otherwise their identities, alternating between the two populations in
   original order: a distinct reason as its first ordinal and exact count, an
   owner call as its ordinal, tool and recommendation.
4. Long values of listed distinct reasons that fit.
5. Refusals, structural readiness, admissibility, controlled acceptance and
   inventories, whole while they fit.

A member is inlined whole under its original key or named in
`selected_detail.omitted_members`, never truncated. Owner-identical reasons are
counted together; differing ones are never collapsed. Each identity population
carries `inline: {complete, listed}`. When `complete` is `false`, the listed
identities are an original-order prefix, not the whole population, and
`selected_detail.next_calls` includes a detail call for that population's
original collection (`reasons` or `next_calls`) next to the call for the first
omitted member. Cardinality alone never refuses valid readiness.

A chosen reason or owner call is read directly: send that collection call with
`selector: {id: "<ordinal>"}`. The row is the original value, or its field
inventory and scalar ranges when it is too large, so a chosen row never needs
preceding pages or another readiness evaluation. Following the collection's
continuations recovers every occurrence, multiplicity and unchanged call argument
when the complete population is needed.
