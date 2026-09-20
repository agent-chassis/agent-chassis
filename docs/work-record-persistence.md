# Work-Record Persistence

Canonical `WK-*` records are written through the validated store operations in
`packages/wiki-core/src/operations/work-records-store-io.mjs`. That module owns
validation, source-digest and full-persistence-snapshot compare-and-swap (CAS),
canonical publication, immutable admission-sidecar inventory, and transaction
composition. The internal write-lock implementation is owned by
`packages/wiki-core/src/operations/work-record-write-lock.mjs`; store operations
consume that single implementation while retaining the existing public store
API. The crash-durable substrate still interprets publication and lock effect
plans. This page defines the result of the composed transaction; it does not
grant lifecycle or launcher authority.

## Failure identity

A persistence failure uses `work_record_write_failed` for `code`, `category`,
and `operation`, and carries `authority_limb: "mechanical"`. Its `phase` is the
boundary that failed:

- `staging`
- `lock_acquisition`
- `transaction_preparation`
- `sidecar_publication`
- `canonical_publication`
- `lock_release`
- `cleanup`

Lock acquisition, code executed while holding the lock, and lock release are
separate phases. The write-lock module remains responsible for lock-state and
liveness facts. The sidecar publisher remains responsible for its operation,
category, and filesystem cause. Store composition adds phase and publication
outcome without reclassifying those producer facts. A primary failure and a
later release or cleanup failure are retained as separate diagnostics with
`failure_role`.

Typed producer cause codes and ordinary diagnostic values are preserved in
full, including nested JSON, paths, Unicode, and long strings. A primitive or
otherwise untyped throw uses `cause_code: "unknown_internal_cause"` and retains
its complete ordinary value. Error diagnostics are serialized explicitly from
their own data properties, including non-enumerable `message` and `stack` plus
attached record or payload properties. Application-defined accessors are never
invoked; an accessor, cycle, proxy, or non-JSON value is an explicit
serialization failure rather than a replacement or silent omission. On
runtimes that expose `Error.stack` through their shared intrinsic lazy
descriptor, that one runtime-owned stack value is materialized. A
`structured-diagnostic.v1` carrier contributes its diagnostic value unchanged.
Its sensitive-value declarations do not remove, mask, or suppress diagnostic
data, and persistence
results do not carry `diagnostic_redactions` compatibility fields.

## Publication outcome

Operation success and canonical publication are independent facts:

| Outcome | `publication_state` | `written` | `contract_persisted` | `no_op` | `ok` |
| --- | --- | ---: | ---: | ---: | ---: |
| Demonstrated prepublication failure | `not_published` | `false` | `false` | `false` | `false` |
| Confirmed publication followed by an error | `published` | `true` | `true` | `false` | `false` |
| Indeterminate publication | `unknown` | `null` | `null` | `false` | `false` |
| Clean confirmed publication | `published` | `true` | `true` | `false` | `true` |

`contract_persisted` is present on ready-slice results. Publication is derived
from the completed-effect trace and observed effects. Once the canonical rename
is confirmed, a later directory-sync, lock-release, or temporary-cleanup error
does not undo publication; confirmed digests and newly referenced sidecars stay
available. When the rename effect itself fails after it may have occurred,
publication is `unknown`: the writer does not invent a digest, remove a
potentially referenced sidecar, replay the mutation, or coerce the nullable
fields to `false`.

For `published` with an error or `unknown`, inspect the canonical record through
the read-only `workspace_read_page` operation before deciding any later
mutation. Do not repeat the write based only on the error response. Genuine
no-ops and refusals that never enter persistence retain their existing result
contract.

## Admission artifact references

`packages/wiki-core/src/lib/work-record-admission-artifact-references.mjs` is
the single owner of current-format admission-artifact recognition in the flat
`wiki/work-records/evidence/` directory:

- immutable evidence: `WK-####[.<unit>].sha256-<64 hex>.admission.json`
- publication stage: `.WK-####[.<unit>].sha256-<64 hex>.stage-<32 hex>.admission.tmp`

Every other name there, including legacy fixed-path `WK-####.admission.json`
files and graph sidecars, is not a current-format admission artifact.

The owner provides two projections. The retention projection collects every
concrete repository-relative current-format path found in any string value or
object key of a canonical WK's parsed JSON, including completed records,
retained entry prose, and repo-qualified or absolute text that contains the
path. A glob or directory grant names no artifact. The structural projection
collects exact paths from record- and slice-level `read_scope` and `repo_paths`
and from every `sidecar_path` field.

Both canonical writers, `writeValidatedWorkRecord` and the admission
transaction, compare the proposed record's structural projection with the
current record they reloaded under the repository writer lock. Every newly
introduced path must be a regular file at that moment; a missing, unreadable,
symlinked or directory target refuses with
`admission_artifact_reference_unavailable`, `publication_state:
not_published`, and no canonical change. The admission transaction checks after
publishing its own immutable sidecars and before canonical replacement, and a
refusal rolls back only the sidecars that attempt created. Unchanged references,
including dangling historical ones, are not rechecked, and prose never refuses.
Because the check and maintenance deletion share the writer lock, a reference
published first keeps its artifact, and a deletion that wins first makes a later
new structural reference to that path refuse.

The guard covers these two store writers only. A reference that arrives through
Git or another external edit protects an existing artifact from the next
maintenance scan; a reference to an artifact that was already reclaimed is
historical data. Maintenance reads only the current checkout's
`wiki/work-records/WK-####.json` files, never other worktrees or Git history.
An eligible artifact that Git tracks becomes an unstaged working-tree deletion;
maintenance never stages, commits, or moves refs.

## Admission evidence capture

A consumer that selected a compact admission entry from a record it loaded
earlier must not open that entry's `sidecar_path` later, because maintenance may
have reclaimed the path after a newer publication. `captureWorkRecordAdmissionEvidence`
in `packages/wiki-core/src/lib/work-record-admission-evidence-sidecar.mjs`
takes the existing canonical read lease, confirms that the locked canonical
record still contains the selected entry identity (record id, unit,
`source_record_digest`, `sidecar_path` and `sidecar_digest`), optionally
confirms an expected authored source digest for a managed carrier, and reads
and validates the immutable bytes before the lease is released. Unrelated
derived publications on the same WK do not change that identity. The lease is
released before any graph, index or network work, write, or launch.

A capture is an opaque frozen value minted by that module;
`readCapturedWorkRecordAdmissionEvidence` returns a private copy and refuses any
other object with `admission_evidence_capture_invalid`. Captured content stays
usable for the life of the consumer after its pathname is deleted, and no
consumer reopens the path. A selected identity that is missing or changed, a
missing canonical record, or a mismatched expected authored source raises
`admission_evidence_snapshot_changed` before any sidecar is opened. Capture
never substitutes a newer entry, retries a missing file, or regenerates
evidence; genuine read, digest, parse and binding failures of the selected bytes
keep their `sidecar_*` codes.

Consumers report the typed outcome at their own boundary:

| Consumer | Outcome for `admission_evidence_snapshot_changed` |
| --- | --- |
| Admission evaluation rehydration | `admission_refusal.code` |
| Admission refresh attestation carry-forward | `written: false` with the diagnostic; nothing published |
| Recovery classification | `recoverable_stale` with the issue code |
| Slice-review acceptance mint and resolution | target-stale refusal naming the code |
| Dispatch private-handoff revalidation | `issue` carries the code |
| Node Engine admissibility pack assembly, first pass and attestation retry | non-pack outcome carrying the code; no request is sent |
| Launcher pack assembly, first pass and attestation retry | typed result with `capture_pass`; the decision refuses with the code and no worker is provisioned; a failed retry never returns the first-pass result |
| Original review-attestation settlement | `recorded: false` with the code as `reason` |

## Automatic admission maintenance

The admission transaction maintains the affected WK's current-format admission
artifacts exactly after confirmed canonical publication of a transaction that
published at least one admission sidecar, whether the immutable bytes were newly
created or reused byte-for-byte. Zero-sidecar transactions, ordinary writer
edits, refusals, demonstrated prepublication failures and unknown publication do
not run it. The operator cleanup command selects the same pass explicitly in
report or remove mode.

The pass runs inside the transaction's existing writer lock:

1. Enumerate the evidence directory once. Only regular files whose
   current-format name carries the affected WK id are candidates; symlinks,
   directories, other WKs' artifacts, legacy names, graph sidecars and canonical
   record staging are never candidates.
2. Retain every candidate referenced by the published record or published by
   this transaction. If an immutable candidate remains, capture the store-owned
   canonical inventory once and parse and traverse each other canonical WK once
   with the retention projection. Evidence payloads are never read for
   retention.
3. Any enumeration, inventory, read or parse failure ends the pass before the
   first unlink.
4. Attempt one unlink for each unreferenced immutable candidate and each of the
   WK's admission stages. Stages are abandoned by construction: production
   publishers create and remove them only while holding the same writer lock.

The result carries `admission_sidecar_cleanup` with the inspected immutable
files and stages, retained, unreferenced, removed and failed paths, and the
number of canonical records scanned. When the pass fails after confirmed
publication, the result stays `publication_state: published` and
`written: true` with `ok: false` and `valid: false`, plus a cleanup-phase
`work_record_write_failed` diagnostic whose producer diagnostic is
`sidecar_cleanup_failed` with its operation (`cleanup_inventory`,
`cleanup_reference_inventory`, `cleanup_reference_read`,
`cleanup_reference_parse` or `cleanup_remove`). Do not repeat the write.

A successful pass removes every eligible artifact present at that moment. A
failed or partial pass is retried only by a later qualifying publication for the
same WK: there is no scheduler, persistent cache, age-based rule, or collection
for WKs that receive no further admission publication. The pass is linear in
evidence-directory entries plus canonical corpus bytes and reference
occurrences; it never rescans the corpus per candidate. Graph payloads are
outside this maintenance.

## Input contract

The two canonical persistence entrypoints accept current `read_scope` fields
directly. An enumerable obsolete `docs` property on the record or any slice is
rejected before filesystem effects with a diagnostic naming `read_scope`.
Nonenumerable properties on a loaded in-memory mirror are not serialized as
aliases. Persistence does not migrate, normalize, or fall back to `docs`.

## Complete MCP diagnostics

Core and ordinary MCP write responses preserve every producer diagnostic and
report the exact `diagnostic_count`; persistence fields and nullable `written`
values cross the response boundary unchanged. If the complete response exceeds
the inline MCP limit, the existing response materializer returns a same-response
content reference. Repeated ranged calls to
`workspace_read_mcp_content_reference` reconstruct the complete JSON that was
already materialized. Retrieval is read-only and never reruns the mutation.

## Ordinary task and note projections

`workspace_work_record_edit` preserves publication outcomes for note replacement,
task append, task correction and task completion. Ordinary results do not carry
`contract_persisted`. Unknown publication retains `written:null` and
`source_digest:null`; an unsuccessful result does not present candidate task,
status or changed-field values as confirmed current state. A prepublication
ordinary failure uses the writer's observed `current_source_digest`, rather than
its candidate digest, for the public `source_digest`. Confirmed publication with
an error retains the published digest and the complete producer diagnostics.

The task facade forwards an internal `writeWorkRecord` dependency through the
existing task owner, defaulting to `writeValidatedWorkRecord`. This is a test
composition seam, not a public request option. The fault fixture exercises the
actual writer's `FILE_SYNCED`, `DIRECTORY_SYNCED`, and real-rename-then-throw
controls through the ordinary registrar, strict schema, response composer and
SDK stdio serializer. Its composition is identified separately from the
unmodified production server used for clean and lost-response journeys.

Reusable ordinary summary, note and task-text values add one internal locked
preparation path without adding a publisher or a public callback. The existing
repository writer lock encloses canonical target reload/CAS, independent source
reload and generation checks, exact reference resolution, incumbent destination
planning, complete candidate validation and the single canonical publication.
The validated writer's internal `lockAlreadyHeld` mode skips a second acquisition
only for that already-held transaction; the public MCP contract exposes no such
field, and record-mutating lock acquisition remains non-reentrant. Staging and
all publication outcome classification still belong to the existing persistence
owner, so `not_published`, `published`, `unknown`, producer diagnostics and later
lock/cleanup failures retain their original meanings.

Durable entries are canonical `sections.entries` data, not a sidecar or cache.
The entry operation reloads and checks the caller's current source digest while
holding the same writer lock, then publishes one replacement through the
established writer. Versions are append-only; both canonical writers reject
removal or mutation of retained versions. After an uncertain create outcome,
the caller reads current entry metadata/history before attempting another
mutation. A stale create is refused before identity allocation.

Both canonical writers preserve decision historical entries byte-for-byte: a
retained receipt, every historical version and each unchecksummed reference stay
unchanged through unrelated edits, entry appends and ready-slice publication.
Dropping or altering a receipt, backfilling lengths, rewriting a historical
reference, appending a lengthless version, or introducing an entry absent from
the persisted record in the historical form refuses as history mutation without
publication. An append to a historical entry, including a metadata-only update,
recaptures content through the entry owner, so the new version stores checked
lengths and replacement references while keeping the original provenance.
Receipts are inert: no request key, lookup, replay or retry uses them, and no
migration or backfill rewrites retained history.

Integrity validation measures retained entry graphs iteratively with shared
source and version memoization. It rechecks every unchanged retained version
and canonical-source generation without repeatedly materializing referenced
output. Cycles, malformed extents or identities, missing/denied/corrupt
sources, cross-repository references, and unsafe-integer arithmetic refuse the
candidate. Deleting a slice that owns any retained entry would delete history,
so both canonical writer paths refuse that deletion with
`work_record_entry_history_mutation`; callers must retain the slice and its
versions. No entry-specific version-size or aggregate retained-storage quota is
applied.

The lost-response witness observes a complete serialized append response in the
existing stdio session helper, records its request identity and bytes, then
withholds consumer delivery. Only after that observation does the fixture kill
the child. The pending request fails through the existing child-exit path;
timeouts, malformed frames and missing observations fail the test. Recovery
waits for observed exit, restarts the same fixture and reads current tasks
without another append. This demonstrates the after-serialization response-loss
boundary, not arbitrary crash or power-loss coverage.

Every isolated fixture uses its own `WIKI_MCP_RESPONSE_STATE_DIR` outside
canonical storage and retains it across restart. Fixture manifests, raw channels,
fault-hit counts, independent canonical observations and child V8 coverage are
retained as test evidence. Namespace comparisons prove endpoint byte and directory
population equality; they do not establish complete transient-write coverage.
Deterministic stdio evidence does not replace required actual client/model
captures, launcher proof construction, or source-bound CCE scope admission.
