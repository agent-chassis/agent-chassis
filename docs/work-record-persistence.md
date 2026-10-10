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

Carrier population construction and read-only inspection belong to
`controlled-contract-carrier-set-validation.mjs`; canonical authoring population
and validation belong to `controlled-contract-authoring-validation.mjs`.
The publisher retains locks, effects, settlement and exact rollback. Contract-only
authoring uses the narrow shared contract and evaluation-input schema owners;
only a supplied proof-plan request loads the memoized narrow proof-plan compiler.

## Public authoring boundary

The production surface creates with `workspace_create_record` and updates with
`save_record({unit,revision,changes})`. The revision is the current combined
source-bound authoring revision returned by `workspace_read_wiki` context.
Creation and save compose the existing store, semantic participants, assessment
and maintenance owners; they add no transaction or fallback publication path.
Original responses are authenticated `workspace_read_wiki` references. Reading
an original performs no save, maintenance or retry. Saving dispositions has no
integration effect. Completion is an explicit save change with existing native
checks and receipt semantics.

The shared authoring schema composes three work-item declarations from one
applicability owner, `WORK_ITEM_SLICE_CONTRACT_MEMBERS`: `work_kind`,
`target_unit`, `agent_role`, `expected_edit_targets` and
`expected_changed_line_budget` are slice contract members. Only the
existing-slice declaration carries them. The record-unit declaration and the
birth declaration omit them, and birth is always the record. An existing save
derives record or slice applicability from the unit address it names
(`WK-…` or `WK-…#SLICE-…`); no request member selects it. `save_record`
enforces one closed `changes` branch per address form. It publishes a work item
once, as the slice-unit declaration, with each slice contract member marked
slice-unit only; the unit address decides applicability at the server.
`workspace_create_record` advertises and enforces the birth declaration.

A slice contract member authored on the record unit or at birth is refused
before any canonical write or allocation with
`record_authoring_member_not_applicable`. Every such member in the request is
reported together at its authored path, and each diagnostic names the two
supported placements: the same member on an existing slice unit, or the
corresponding member of a `ready_slices` or `slices` row
(`dispatch_intent.target_unit` and `dispatch_intent.intended_agent_role` for
`target_unit` and `agent_role`). The diagnostic moves nothing and names no
slice identity, revision or replacement request; the caller chooses the slice.

An ordinary slice's `expected_edit_targets` has one structural declaration,
`WORK_RECORD_EXPECTED_EDIT_TARGET_SCHEMA`, owned beside the work-record
validator that enforces it. A `slices` row at birth and on save and the
existing-slice member all carry it. Each target is an object that requires
non-blank `path`, `name`, `kind` and `operation` and may carry `activity_kind`,
`artifact_kind`, `granularity`, `facet_provenance` and `optional`. The
declaration refuses a string, a target missing a required member, and an
optional member of the wrong type or outside its exact vocabulary, before any
canonical write or allocation. The validator compares `kind` and `operation`
after trimming and lowercasing and checks each `facet_provenance` value, so the
declaration states those vocabularies and the validator refuses an unsupported
value, still before any write. The validator reads no other member, so the
target object is declared open and a further member is stored as authored; the
authored request-schema converter serves an object closed unless it declares
`additionalProperties: true`. A supplied list replaces the saved one whole, and
a change that omits the member keeps it. A `ready_slices` row keeps the
ready-slice owner's own closed target declaration, with its coarse facets and
shaping rules.

A `ready_slices` row that carries `key` creates a slice, and its declaration
requires the creation fields the ready-slice owner requires of every shaping
mode: `title`, `depends_on`, `read_scope`, `repo_paths` and `acceptance`.
Implementation shaping, the creation default, also requires `write_scope` and
`expected_edit_targets`; reviewer and redteam shaping derive the write scope
and need no target plan. A row that carries `id` updates a saved
slice and may omit any of them; an omitted member keeps its saved value.
`acceptance`, wherever it is authored, is the complete `criteria` and
`validation` arrays. The ready-slice owner holds the one list and the
acceptance structure, and the save and birth declarations state them from it.
A creation that omits several of these fields is refused before any canonical
write, with every missing field reported together at its authored path
(`changes.ready_slices[<index>].<field>`); no value is supplied on the
caller's behalf, and no other change in the same request is saved. The same
refusal names every completeness member the row authored empty: `read_scope`,
`repo_paths`, `acceptance.criteria`, `acceptance.validation` and, for
implementation shaping, `write_scope` and `expected_edit_targets`, each under
the ready-slice owner's own code. An omitted target plan keeps the
`ready_slice_implementation_targets_empty` identity its empty form has. Only a
present, well-typed, empty member is reported this way; a malformed member is
refused as malformed and nothing is derived from it. An empty `depends_on` is
valid. An update reports the members it empties together and gains no creation
requirement, and an ordinary `slices` row may stay an incomplete draft.

A criterion is readable text where it is authored and an identity where it is
referenced. `changes.criteria[].text` is a criterion of the selected unit, and
its `key` is the only criterion label. `changes.obligations[].criteria` takes
criterion identities or those same-request labels as `$<key>`, and a label
resolves to the identity the owner issues, never to the row's text.
`slices[].acceptance.criteria` and `ready_slices[].acceptance.criteria` are the
slice's own readable outcomes: a string there is saved as literal text, and an
object states `text` beside `verification_method`, `evidence_target` or
`facet_provenance`. A parent criterion label copies no text and transfers no
coverage to a slice; a slice's criteria and their obligations are authored on
that slice unit. The declaration states this on the label rule and on those
members, and the `save_record_inputs` guidance topic states it as
`criterion_text`.

The existing-record declaration states the choice between the two slice lists
where it is made, as `WORK_ITEM_SLICE_LIST_NOTES` on `slices`, `ready_slices`
and `shaping_mode`. Both lists are authored on the parent work item, never on
`WK-…#SLICE-…`. A `slices` row creates or edits an ordinary slice definition,
including an incomplete draft, and a supplied `dispatch_intent` replaces the
saved object whole. A `ready_slices` row creates or updates a slice through the
ready-slice owner and its structural completeness checks; it does not approve
dispatch, start an agent or grant proof credit. That owner derives the agent
role and target unit, and a `ready_slices` `dispatch_intent` is a partial
update. In either list `key` creates a slice and `id` selects an existing one:
the server allocates the identity and returns it as `bindings.slice[<key>]`,
and later selected-unit operations address `WK-…#<returned id>`.
`shaping_mode` stays an open string whose supported values and creation default
are read from the ready-slice owner's `WORK_RECORD_READY_SLICE_SHAPING_MODES`
(`implementation`, `reviewer`, `redteam`; creation defaults to
`implementation`). An update that omits it uses the saved shape when that is a
supported one, and an unsupported saved shape is refused rather than
defaulted. The birth declaration selects and updates no slice, so its lists
carry no such note; its creation row states the same `shaping_mode`.

A `ready_slices` row's `dispatch_intent.intended_agent_role` and
`dispatch_intent.target_unit` are optional consistency assertions, normally
omitted because shaping derives both. `target_unit` is the assignment
category, not a WK address. Each member's description, composed as
`WORK_ITEM_READY_DISPATCH_ASSERTION_NOTES`, states the accepted values read
from the ready-slice owner's
`WORK_RECORD_READY_SLICE_DISPATCH_INTENT_ASSERTION_VALUES` (`worker`,
`reviewer`, `redteam`; `slice`), on the birth creation row as well. Both
members stay open strings: the declaration describes the values and enforces
none, and the owner validates a stated value after trimming surrounding
whitespace, without ignoring case. An unsupported value is refused as
`ready_slice_invalid_field` at the member, with the accepted values in the
message and in `constraint.allowedValues` and the correction to omit the member
or state the derived value. A supported role that disagrees with `shaping_mode`
is refused as `ready_slice_shaping_conflict` at `dispatch_intent`.

A `ready_slices` row's `status`, `priority`, `work_kind`, `review_purpose` and
`completion_policy` are closed values that likewise stay open strings. Each
member's description, composed as `WORK_ITEM_READY_CLOSED_VALUE_NOTES`, states
the accepted values read from the ready-slice owner's
`WORK_RECORD_READY_SLICE_ACCEPTED_VALUES`, which the owner's validator reads
too. The owner trims surrounding whitespace and keeps case significant. An
unsupported value of any closed ready-slice member, a target's `kind` or
`operation` included, is refused as `ready_slice_invalid_field` at the member,
with the accepted values in the message and in `constraint.allowedValues`. An
accepted value that contradicts the shaping mode keeps its own shaping or
purpose refusal.

An obligation that names a criterion identity the selected unit does not
currently have is refused as `obligation_coverage_acceptance_criterion_unknown`
with the unknown identities and no effect. Its correction is the unit read,
`workspace_read_wiki({subject: unit})` with the slice suffix intact, followed by
that reference with `select: {contract: "criteria"}` for the unit's current
identities. A `slices` row that supplies `sections.tasks` for an existing slice
is refused as `field_owner_mismatch`: the refusal names the slice unit, its
read, and `save_record` on that unit with `changes.tasks`, and states that the
task action and its value or selector are the author's. Neither refusal
supplies a revision, task or identity on the author's behalf.

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

Decision and initiative JSON use the existing kind-record writer. JSON and its
Markdown projection publish through sequential renames under one lock, with
independent `participants.canonical_json` and `participants.generated_markdown`
certainty. A throwing rename is unknown; an unattempted rename is not published.
Confirmed JSON publication retains its digest even when projection or cleanup
fails. Mechanical failures retain native causes, phase, and primary/secondary
cleanup diagnostics through kind edit, save, and creation results. Failed saves
and creations run no maintenance and provide no successful original receipt;
inspect their reported effects before another mutation. Canonical JSON occupies
its allocated decision or initiative ID even without a Markdown projection.

`contract_persisted` is present on ready-slice results. Publication is derived
from the completed-effect trace and observed effects. Once the canonical rename
is confirmed, a later directory-sync, lock-release, or temporary-cleanup error
does not undo publication; confirmed digests and newly referenced sidecars stay
available. When the rename effect itself fails after it may have occurred,
publication is `unknown`: the writer does not invent a digest, remove a
potentially referenced sidecar, replay the mutation, or coerce the nullable
fields to `false`.

For `published` with an error or `unknown`, inspect the canonical record through
the read-only `workspace_read_wiki` operation before deciding any later
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
the inline MCP limit, the existing response owner retains the original and
returns a semantic `workspace_read_wiki({reference})` selection. The authenticated
read delivers permitted meaning through the complete selected-response class.
Retrieval is read-only and never reruns the mutation.

## Ordinary task and note projections

The ordinary save writer preserves publication outcomes for note replacement,
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

The ordinary writer, the admission transaction and the terminal test-target
participant share one store-owned retained-history guard: each refuses a change
to archival `review_provenance` with `review_provenance_history_mutation` and a
change to retained entry versions with `work_record_entry_history_mutation`
before publication. The terminal participant's selected-validation and
proof-posture scope check compares authored-source digests, which omit archival
provenance, so that check alone does not see a provenance change; the shared
guard does.

The crash-durable canonical publisher, the ordinary writer's under-lock
prepublication guard and settlement, and exact-byte restoration live in an
internal publication module that only the store calls. The store still owns
locking, leases, CAS and the retained-history guard, and its public API is
unchanged.

The store also has an internal prepared participant for one existing valid work
record. It runs inside a canonical read lease as the last, terminal participant
of the existing settlement coordinator and is not a public route. Preparation
takes an owned copy of the candidate, applies the validated writer's own
candidate validation and prepublication guard, captures the exact prior bytes,
and has no staging, sidecar, publication or maintenance effect. A candidate may
not change `id`, `repo`, `proof_posture`, `derived_evidence` or `projections`;
that refuses with `work_record_settlement_managed_field_mutation` naming the
members. A `proof_posture` exception requires a result prepared by the posture owner:
its preparation result is bound to the record and the captured source digest,
and the store admits the change only when that exact result matches the leased
source, the current posture and the candidate's posture. The result is internal
state, not a public permission, parameter or receipt member; a missing, copied,
hand-built or mismatched result grants nothing, removing a posture is never
admitted, and that result covers no other managed member. Commit is single-use: it requires an unexpired lease and unchanged prior
bytes, consumes the lease's source token, and publishes through the validated
writer under the already-held lock, so the writer rechecks every guard. A
candidate equal to the current record commits as a no-op with no effect. A
writer refusal or failure is thrown with its diagnostics and its actual
publication certainty (`not_published`, `published` or `unknown`), which a later
restoration never rewrites.

The same participant accepts an internal store-issued birth lease from
`withCanonicalWorkRecordBirthLease({dir, id, title, date, repo,
maximumDurationMs}, callback)`. Creation holds the allocator lock outside its
non-reentrant record lock; the issuer allocates nothing and captures the single
`buildCreatedIssueWorkRecord` builder after the existing read-scope
canonicalization. Its callback receives an opaque `lease`, detached `record`,
`baseline_source_digest` and `canonical_record_path`; that digest describes the
pristine baseline, never a persisted revision. The separate
`assertCanonicalWorkRecordBirthLease` binds the resolved root, ID and at most
60-second lifetime. Every target path entry refuses, and only `lstat` ENOENT
proves absence. Preparation retains the private baseline and candidate, protects
the same managed members, and admits only matching posture-owner contributions.
Even an equal pristine candidate commits once as a real publication through the
validated writer, with an owner-private absence fence rechecked before rename.
Compensation restores captured absence only by removing this attempt's exact
regular-file bytes and verifying absence under the still-held lock; changed
bytes, symlinks and directories remain untouched. Consumed or expired tokens
can restore while the callback holds its lock, but released handles cannot.
Native persistence and compensation failures retain their causes and certainty;
cleanup-only confirmed publication remains established. These interfaces are
internal and register no public route.

Restoration has one owner, shared by that participant and the terminal
test-target participant. It does nothing before a publication attempt or when
the record already holds the captured prior bytes. Otherwise it restores those
exact bytes only while the record still holds this participant's own published
bytes; any other authored, derived, archival or formatting change is refused
with `work_record_target_compensation_stale` and never overwritten. Restoration
authority is the lease's real lock, not its source token: a consumed or
time-expired token still restores while the lease callback is running, and no
handle commits or restores after that callback returns.

An internal joint settlement composes that participant with the existing
semantic settlement owners: an ordinary owner's prospective record and the
semantic owner's prepared candidate publish through the same source lease and
coordinator, with this participant as the single terminal record writer. That
lease is the only exclusion a settlement takes: an obligation source has no lock
of its own, and a `.lock` file beside one is never read and governs no write.
Publication decisions compare the final candidate with the
original captured state, a moved original refuses even a no-op, and an equal
candidate publishes and retains nothing. The managed-member protection above
still applies: a candidate whose `proof_posture` differs is refused before any
canonical effect unless the semantic owner prepared that posture against the
original captured record source, in which case the settlement hands the owner's
result to the participant and the posture publishes in the same record write.
The semantic-only routes keep their narrow test-target participant. Once the terminal record commit has returned, a later
finalization, receipt or readback failure is reported as an established
publication that is not safe to retry, never as unchanged or compensated. It
is not a registered route.

The trusted root-birth composition borrows the already-held store birth lease.
`readCanonicalWorkRecordBirthLease(lease, {dir, id})` returns its owned frozen
pristine record and rechecks the selected identity, lifetime and actual absence.
`resolveBirthProofAuthoringSource({repoRoot, wkId, recordLease, focus,
selectedUnit})` accepts only null focus and root selection, projects that record
through the saved-source owner and binds the resulting capture privately to the
issuer. A detached copy cannot grant absent-source authority. Existing saved
reads still require a canonical record. Any existing record, native generation
or selected obligation source refuses without adoption or replacement.

The caller passes that capture to `prepareRecordAuthoringChange` with
`context: "birth"`. The same ordinary and semantic owners prepare the complete
candidate without publication. The closed birth schema accepts empty initial
meaning and new rows with owner-issued labels. Initiative assignments use the
same canonical target inspection and correction as existing saves. Authenticated findings capture and dispositions reuse the entry and judgment
owners, including same-request labels and exact versions. Capture preserves the
producer's reviewed subject; it does not claim that a new WK was reviewed.
Retained graph contributions are prepared by the shared planner after all
authored meaning, against that exact prospective source. Their private grant
also binds the genuine birth lease, repository root and pristine baseline.
Graph and immutable admission sidecars use the existing participants and
admission transaction, with the store's private absence fence and exact-byte
compensation. Existing evidence destinations are preserved as collisions.

For source and area initial values, `recordAuthoringChangeSchema(kind, "birth")`
consumes the detached `sourceAreaBirthSchema(kind)` supplied by the creation
owner. It memoizes that schema per trusted kind, preserving the manifest and
template vocabulary, required source metadata and optional area lists. The
creation wrapper owns whether `initial` must be present. Source and area have
no existing-record change schema or save editing branch.

`settlePreparedRecordAuthoring` adopts the genuine record lease through the
internal `withBirthControlledContractSourceLease` mutation path, without
reacquiring the non-reentrant record lock. The order remains allocator, record,
then controlled source. Its population includes every
prospective new slice with an absent semantic source. Birth grants no execution,
continuation or draft authority. Source absence is reasserted before participant
effects; native parameter inspection uses the authenticated complete prospective
population. Even a pristine equal candidate publishes one real terminal record.
The existing native and obligation participants, coordinator, guarded writer
and exact readback comparison retain their publication and compensation roles.

The trusted caller supplies `observeCommitted` using the single exported
`observeRecordAuthoringAssessment({repoRoot, wkId, selectedUnit, focus},
snapshot, options)` in the save owner. Existing save uses that observer too.
Readback returns the unchanged revision owner's actual `authoringIdentity`,
usable for a following save even when empty semantic meaning has null revision.
Source-absent, moved and unavailable assessment remain distinct. These internal
exports allocate no ID and add no public parameter or registration. They do not activate a creation route or confer public creation authority.

An internal typed save composes one closed change over that joint settlement.
It resolves the selected unit and its one combined authoring revision, refuses
a revision that is not current before it considers a no-op, and plans the whole
change without effects: ordinary fields, tasks, entries, slices, ready-slice
shaping, criteria, judgments, status and closure through their existing
planners, and requirement, obligation, case and applicability meaning through
the semantic preparation owner against the prospective record. Several explicit
obligation removals and selected-row edits are prepared in order, each against
the state the previous one left, and settle as one candidate. Request-local
labels resolve only to the identities those owners issue. A malformed or stale
batch publishes nothing; a structurally valid incomplete draft is saved, including
a case whose verification is left unresolved because none or several are
eligible. Every supplied valid change commits together with that draft, and an
explicit selection that is nonexistent or ineligible refuses the whole batch. An
external entry source captured during planning is confirmed again under the
settlement locks. Initiative and decision records go through their own kind
store under one actor and time, and an equal state stamps no provenance. The
result names the next revision, the resolved labels and the participants that
actually changed. Its assessment is the standalone assessment owner's, computed
while the settlement still holds its locks and returned only when it names the
exact revision the save left; an assessment of any other source is reported as
unavailable with both sources. A save executes no proof, starts no agent,
integrates no delivery and establishes no landing. It is not a registered
route in the shipped server. Its importable registrar is available for explicit
private composition, independently of production registration, grants and discovery.

Retained graph evidence is composed through the graph and admission producers,
the same settlement coordinator and the guarded terminal writer. Its input is
only the authenticated retained impact locator; producer, repository, query,
unit and source bindings are preserved. The graph owner issues an opaque
contribution bound to the captured source, exact prior and prepared
`derived_evidence`, and prospective authored record. The guarded store admits
only that exact contribution; no permission flag covers derived evidence or
any other managed member. The graph sidecar is a settlement participant with
owned-byte compensation. Immutable admission sidecars publish through the
existing admission transaction before the terminal canonical record. The
preparation availability guard excludes only the exact artifact this
transaction will publish; every other new artifact remains guarded and commit
checks availability again. Malformed, stale, foreign or hand-built
contributions publish nothing. Publication or compensation errors preserve the
owners' exact surviving-effects facts. Re-saving the same authenticated graph
observation at the same selected source verifies its existing graph and
admission artifacts and leaves canonical and sidecar bytes unchanged.

The same `createSaveRecordMaintenance` owner also exposes
`settleCreation(created, {unit, kind, source, readIdentity, recordSourceDigest})`
for a trusted creation producer after it releases allocator and record locks.
It accepts a known `created` outcome with `effects.published: true`, preserves
the complete original unchanged, and binds it to `workspace_create_record`,
operation `create`, its exact subject and the current repository/session
identity. `source` and `readIdentity` come from the creation owner; source and
area receive no save-capable revision. Retry authenticates the finite producer
binding before interpreting the original and runs the existing durable attempt
engine. The closed retry branch admits an authenticated SRC identity or area
slug; the editing branches remain WK, IN and DEC only. An established outcome
without readable creation facts retains unavailable-original and not-run
maintenance facts. Refused or unknown publication runs no checks.

For source, area, initiative and decision, the current check owner supplies no
per-page checked identity. The attempt preserves the exact original creation
source/read identity and reports `creation_checked_page_identity_unavailable`;
a later disk read never substitutes for the source actually checked. WK
creation uses the check owner's captured work-record corpus digest. These are
provider seams; original-read routing and production create adoption remain
separate composition responsibilities.

A published save is retained once as an immutable original before any check
runs; a no-op and a refusal allocate no maintenance original or attempt and run no checks. Every maintenance
attempt, the first one the save makes and each explicit retry, is recorded
against that original in a small owner-private index beside the response state:
the original's locator, each attempt's ordinal, state and members, and the
locator of each retained outcome. One cross-process mutex is held from the
durable publication of an attempt's running intent, across the repository's
generate-and-lint checks, to the durable publication of its settled state. A
retry authenticates the original and reruns only the members that failed or did
not run; concurrent retries of one original share one attempt, and a retry
after a successful attempt runs nothing. An attempt whose host died stays
recorded as unknown while an explicit retry takes the next ordinal, and an
attempt whose coordination state could not be published is reported as unknown
with the original still retryable. Corrupt coordination state is reported and
left as found. The checked source in an outcome is what the check owner itself
captured: the identity of the work-record corpus it read and the source digest
it captured for the saved record, beside what was saved, so a source that moved
is never relabeled as the original's. A retry writes no canonical record,
semantic source or documentation.

The coordinator compensates prepared participants in reverse order when a
participant fails up to and including the terminal commit. A failure while
another participant finalizes after the terminal commit leaves the published
record in place and is reported as that failure; this is not crash recovery or
rollback beyond that boundary.

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

The trusted save composition binds its calling session through the existing
assessment session owner, permits the orchestrator and operator profiles, and
binds retained originals and outcomes to repository, unit and the complete
session authority identity. A different repository or session authority cannot
read an original or retry its maintenance. After each save or retry, the complete
observed result is retained separately from immutable pre-check save facts and
independently retained maintenance outcomes. Later attempts never rewrite any
of them. Retention failure is reported alongside the save's actual effects and
does not replay the mutation.

The importable `registerSaveRecordTools` registers `save_record` with exactly
`{unit, revision, changes}` or `{unit, maintenance_retry: {save_result}}` through
the real handler and response guard. A notes/entry-only work-item save delivers
a concise receipt with its outcome, unit, revision, actual changed fields and
entry identities, publication effects, maintenance result and actionable
failures. Its complete exact-source assessment stays in the immutable retained
observation; `complete: false` and `assessment_detail` describe the inline
omission and retained assessment availability. The returned authenticated
original-read call retrieves that observation across restart without repeating
the save, assessment or checks. Pre-existing contract findings are not failures
of the prose save. Assessment unavailability, including a source mismatch,
still reports its exact cause inline. Every other change, including a mixed
save, disposition, status or closure, keeps its applicable assessment and
closeout facts under the ordinary delivery rule. Assessment computation and
required maintenance run before this presentation choice; no-op and refusal
semantics are unchanged.

An ordinary result that fits is delivered complete and recommends no read of
its own retained copy: the `observation` locator keeps that copy readable as
history. A save that published a change moved its unit, so a record reference
issued before it now refuses with `source_moved`. Such a save offers
`workspace_read_wiki({subject: unit})` for the saved unit, slice suffix
included, on its complete and bounded forms alike. That call reads the current
record and returns its fresh reference and revision; it is not a read of the
saved receipt and not maintenance recovery. It is the recommended call when
the save names no other, and follows a required omitted-detail retrieval or
maintenance retry unrecommended. The save does not run the read or issue a
reference itself, the call is offered only when the registered reader accepts
it, and a no-op, a refusal, a settlement failure and a maintenance retry offer
none. A refusal whose owner supplies the exact unit read as its correction
recommends that read when the registered reader accepts it; an owner call that
still needs authored members is never completed into a call. A settlement
failure has no receipt, so its retained failure observation stays recommended;
a larger result delivers bounded population/effect facts and an executable
`workspace_read_wiki` original-read call. The existing verified selected-full
response owner delivers that complete immutable carrier, including indivisible
values, without rerunning save, assessment or maintenance. An explicit original
read uses that owner's complete delivery class rather than the inline admission
class. Failed or not-run maintenance emits an executable retry against the
immutable save receipt. A `save_record_revision_stale` refusal, identified by
its typed diagnostic, recommends exactly one call:
`workspace_read_wiki({subject: unit})` for the refused unit, slice suffix
included, which returns that unit's current context and revision. Its retained
refusal stays readable through the `observation` locator and is not
recommended, because it is historical evidence rather than current context. The
unit read is offered only when the registered reader accepts it, and no
replacement save or revision is proposed. Continuation builders require the
adopter's canonical
save/read descriptors before any publication; private test registrations supply
builders validated against their actual SDK schemas. Production adoption must
wire the original reader into the existing read owner's retained-producer
routing, install the save grants and canonical descriptors, migrate active
callers and retire the displaced routes together. Private SDK and installed
module witnesses do not establish that production adoption.
