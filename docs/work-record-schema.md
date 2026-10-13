
# Work-Record Schema

Work records are the machine-readable contract for `WK-*` work. They carry the
scope, dispatch shape, validation expectations, and closure evidence that agents
and tooling need before a work unit can be assigned or reviewed.

The canonical record for current and migrated work is JSON under
`wiki/work-records/WK-*.json`. `wiki/issues/WK-*.md`, generated briefs, catalog
rows, queue views, and other rendered outputs are projections or compatibility
surfaces; they are useful for reading, but they do not replace the JSON record as
authority.

## Public Contract Sources

Use these public files first:

- [Work-record ontology](work-record-ontology.md) explains authored versus
  derived vocabularies and which fields are ordinary authoring burden.
- `packages/wiki-core/contract/schema.md` defines the portable wiki contract and
  names `wiki/work-records/WK-*.json` as the current `WK-*` authority.
- `packages/wiki-core/contract/manifest.json` carries the versioned contract
  metadata, including `workRecordAuthority`.

Maintainer-level detail lives in the internal schema notes:

- `the project documentation`
- `the project documentation`
- `the project documentation`
- `the project documentation`
- `the project documentation`
- `the project documentation`

Those internal pages explain design history and implementation boundaries. This
page is the public landing page for snapshot consumers and agents that need the
stable shape without the full maintainer narrative.

## Record Shape

A `work-record.v1` JSON record identifies the work item and its lifecycle:
`id`, `repo`, `title`, `record_kind`, `work_kind`, `status`, `priority`,
`owner`, `created`, and `updated`. Records also carry structured relationship
and scope arrays such as `read_scope`, `repo_paths`, `write_scope`, `depends_on`,
`blocks`, and `related`.

`base_branch`, when present, is the WK-level local branch from which the
persistent WK fork is first captured. It is an ordinary record-level scalar and
must be a canonical short local branch name such as `main`, `master`, or
`release/next`; full refs and revision expressions are invalid. The field is
optional in stored records so historical records remain schema-valid. A WK with
no existing authenticated allocation must author it before first dispatch.
Slices do not carry or choose a base: they start from the evolving parent WK
tip. Once allocated, the WK's captured `base_ref` and fixed `base_sha` remain
authoritative for retries, adoption, recovery, and forge handoff. Adding or
changing `base_branch` later cannot rebase an existing WK.

The public schema distinction is:

- `record_kind` says what kind of record this is. Current `WK-*` records use
  `record_kind: "work_item"`.
- `work_kind` says how the unit is handled. Common values include `tracker`,
  `design`, `implementation`, `review`, and `redteam`.
- `sections` carries human-readable summary, scope, tasks, references, agent
  notes, and closure prose. Dispatch-critical facts should be present in the
  structured fields, not only in prose.
- `sections.user_requirements`, when present, is an optional root-only string:
  the orchestrator's organized statement of the user's current outcomes,
  constraints, tasks and clarifications. It is trusted authoring context edited
  through the ordinary `workspace_work_record_edit` route under normal type,
  CAS and publication rules, at any ordinary-prose-editable lifecycle state. It
  is not a controlled-contract generation input, review identity, approval
  token or proof of semantic coverage, and editing it adds no lifecycle or
  generation gate. Absent or empty means no current user requirements are
  recorded; it is never backfilled from derived acceptance or code. The user's
  original wording and clarifications stay in immutable `sections.entries`
  versions. Slices have no such field; slice assignments carry the relevant
  requirements explicitly. Generated Markdown renders the field before derived
  narrative, search indexes it, and agent briefs list it as omitted.
- `sections.entries`, when present, is a root- or slice-owned array of durable
  entries. An entry has a WK-wide numeric identity, a current-version pointer,
  and immutable retained versions.
  Entry content uses the closed `{text}`, `{ref}`, or flat nonempty `{parts}`
  union. Bodies are retained only in versions; metadata projections do not
  implicitly render them. Titles are nonempty and limited to 256 Unicode
  scalars and 1,024 UTF-8 bytes; kinds are limited to 64 scalars and 256 UTF-8
  bytes. A create must resolve to nonempty content, while a later immutable
  version may be empty. References carry exact repository, WK, optional slice,
  entry, version, scalar range, and total-length identity. Empty ranges are
  valid. Read calls are not stored formats: they name the entry, version, and
  offsets explicitly, and the retired `wkentryread.v1` page cursor is not
  accepted. The current-version pointer may move only to an appended immutable
  version, and deleting an owning slice or mutating/removing any retained
  version is invalid history.
  The `workspace_work_record_entry_upsert` input publishes this same closed
  content grammar; its create and version input requirements are owned by
  [Durable work-record entries](mcp-operation-reference.md#durable-work-record-entries).
- Under accepted decision, retained history may also hold the earlier entry
  representation. A historical entry is exactly
  `{id,current_version,versions,receipt}` with an inert
  `receipt:{request_key,fingerprint,version_id}` naming one of its historical
  versions; a historical version is exactly `{id,title,kind,content,provenance}`
  with both lengths absent and precedes every appended version. A historical
  reference is `wkentry.v1.` followed by canonical base64url UTF-8 JSON exactly
  `{r,w,u,e,v}` and no checksum; it selects the whole immutable version. Missing
  lengths are derived on each resolution and never written back. Both shapes are
  closed: a lengthless version outside a receipt-bearing entry, one present
  length, extra fields, or any reference containing a checksum separator is
  validated only as the current form and refuses when that fails. New entries,
  appended versions and every issued reference use the current form.
- `sections.material_refs`, when present at the root or on a slice, is an
  ordered array of closed `{ref}` leaves naming immutable entry versions or
  ranges. Effective assignment material is root material followed by selected
  slice material, with exact duplicate refs removed at their first occurrence.
  The combined population is limited to 16 references and 65,536 rendered
  UTF-8 bytes. References remain identities, not capabilities: preparation
  rechecks repository and source visibility (for a managed worker, coverage by
  the frozen resolved read/write membership at the scope-existence base minus
  launcher exclusions), captures the referenced
  WK closure through the launcher-owned frozen source set, and grants no worker
  MCP access or additional authority.
- `sections.dispositions`, when present at the root or on a slice, is an array
  of saved review judgments. Each row is the closed object
  `{id, review_run_id, entry, selection, disposition, rationale?}`: a
  unit-unique positive `id` the store allocates, the producer run identity, the
  immutable `entry:{entry_id, version_id}` the judgment is about, exactly one
  `selection` (`{finding_id}` for a producer finding, or `{offset, length}` for
  an exact Unicode-scalar extent of that entry version), and an `accept`,
  `reject` or `defer` judgment. A row's source is never caller-attested: the
  named entry version must be a single capture of authenticated original
  findings, and `review_run_id` is read from that version's own provenance. A
  judgment or its rationale may change; its source cannot, and one occurrence
  holds at most one judgment. Rows are authored meaning, so they are part of
  the work-record source digest. They record a coordinator's judgment only:
  saving one runs no review, mints no approval and integrates nothing. An
  explicit integration attempt reads them at the revision it holds and learns
  `present` with that revision and the rows, `absent`, a `source_mismatch`
  against a revision that moved, or `unavailable` with the original cause.
  Before returning `present`, the reader resolves every row's exact entry
  version within that unit, requires captured-findings provenance and the
  matching producer run, checks finding membership through the shared
  disposition validator, and bounds prose extents against that version's text
  in Unicode scalars. It validates and computes the revision from one loaded
  snapshot; a revision mismatch takes precedence over invalid source references.
  Invalid references return `unavailable` with the specific source-owner cause,
  without dropping rows or substituting a newer version. Valid reads preserve
  judgments and rationale and perform no writes, integration, recapture or retry;
  `accept`, `reject` and `defer` grant no integration authority.
- `proof_posture` is the sole persistent controlled-acceptance disposition
  carrier. Required posture records `controlled_contract.required:true` with no
  exemption. Explicit opt-out records `required:false`, the canonical exemption,
  and a trimmed, nonempty `classification_rationale` of at most 8,192 UTF-8
  bytes. A bare inbox omits `proof_posture` and projects
  `controlled_acceptance_state: absent`. The other derived-only states are
  `incomplete`, `complete`, and `opted_out`; none is persisted. Malformed,
  partial, or contradictory posture fails closed, and generic record editors
  cannot mutate `proof_posture` or controlled-acceptance state.
  A record whose only structural error is a retired or malformed
  `proof_posture` may replace that field only through the current
  controlled-contract disposition semantic owner under source-digest CAS;
  generic editing remains forbidden.
  A historical `controlled_contract.content_digest` does not pin a required
  disposition to one generation; current completion is always recomputed from
  the authenticated current generation. Retired enforcement, authoring-state,
  guidance, next-action, optional-carrier, and emitted-action keys are invalid.

## Trackers, Children, and Slices

A tracker WK groups related work and is not directly implementation-dispatchable
as a single unit. It may contain:

- `children`: references to allocator-created child WK records that have their
  own lifecycle, owner, write scope, acceptance criteria, review history, and
  closure.
- `slices`: tracker-local dispatch units that share the parent tracker contract.
  A slice address is `<WK-ID>#<slice-id>`, for example
  `work record`.

Use a slice when the subunit belongs inside the parent tracker lifecycle. Use a
child WK when the subunit needs independent ownership, review and closure
history, or cross-repo tracking.

## Scope Fields

Work records separate reading context from write authority:

- `read_scope` names canonical docs and records a worker should read before
  acting. It is context, not permission to edit.
- `repo_paths` names likely source, test, docs, or fixture surfaces relevant to
  the work. It helps retrieval and review, but it is not write authority.
- `write_scope` is the allowed edit boundary for the assigned unit. Workers
  should stop and report a blocker before changing files outside it.

Scope entries use repository-relative POSIX syntax with host-independent
`node:path.posix` interpretation, and each entry in `read_scope`, `repo_paths`,
and `write_scope` names one individual file, including an intended new write
file such as `bin/new-tool`. Globs and directory scopes are unsupported:
`workspace_work_record_ready_slice`, `workspace_work_record_edit`, and slice
upsert refuse an entry with glob syntax (any component containing `*`, `?`, `[`,
`]`, `{`, or `}`), a terminal slash, or the repository root (`.` or `./`) with
diagnostic `unsupported_repository_scope_selector`, whose message names the
field and entry and says to enumerate each required repository-relative file,
then retry. Authoring does not inspect a checkout, so a literal entry such as
`docs` that names a directory is refused by managed admission at the scope base
instead (see [Enforcement Model](enforcement-model.md)). Repeated separators,
absolute paths, backslashes, and traversal components keep their generic
invalid-path diagnostic. When more files are needed, correct the canonical
assignment through these routes; no selector is expanded on the author's behalf.

Canonical persistence accepts `read_scope` directly and rejects an enumerable
obsolete `docs` property at record or slice level before filesystem effects. It
does not canonicalize, migrate, or serialize `docs` as an alias. See
[Work-record persistence](work-record-persistence.md) for failure phases,
publication outcomes, inspection guidance, and lossless MCP diagnostic
retrieval, including Error stacks and attached record or payload data.

For implementation work, `write_scope` should be non-empty and paired with
concrete acceptance and validation. For review or redteam work, `write_scope` is
normally empty unless the assignment explicitly authorizes writing findings to a
coordination surface.

Ready-slice shaping fixes the findings case. Selecting reviewer or redteam
shaping (`shaping_mode: "reviewer"` or `"redteam"`) determines that the slice
edits nothing, so the shaping owner persists `write_scope: []` when a slice is
created and when an existing slice is explicitly reshaped; the author does not
supply the field. An explicit `[]` is accepted and changes nothing. A non-empty
`write_scope` contradicts the selected shaping and refuses before anything is
written. Nothing is derived in the other direction: creating an implementation
slice, or reshaping a slice to implementation, requires an authored non-empty
`write_scope`. Edit authority is never inferred from `read_scope`,
`repo_paths`, or `expected_edit_targets`.

### Slice regression tests

A slice may carry `regression_tests`: an ordered list of existing test files
that a verification of that slice runs beside its saved proofs. The field is
optional and exists on slices only; a work record that carries it at the top
level is invalid.

- Each entry is one literal repository-relative file, held to the same rule as
  a scope entry: a malformed, absolute or escaping path, a directory and a glob
  are refused. An entry listed twice is refused, so each file runs exactly
  once. No file extension is required, and no runner, command or selector is
  part of an entry.
- An omitted list and an empty list are both valid and both declare no
  regression run.
- The list is stored in the order and spelling it was authored in. It is
  authored on a selected slice unit (`regression_tests` of a `save_record` on
  `WK#SLICE`) or on a slice row (`ready_slices[]` or `slices[]` of a save on the
  parent), and both routes store the same value. Authoring it on the parent
  record is refused with the slice placements named.
- The list changes no scope and is checked against none. A listed file may be
  outside the slice's `read_scope`, and may be inside its `write_scope`:
  choosing tests the worker is not asked to edit is authoring advice, not a
  rule. Nothing about the list prevents a listed file from being edited.
- Choosing the list is authoring advice carried by the orchestrator role guide:
  use `query_code_index` references and impact information to find affected
  callers and relevant existing tests, including consumers outside the edit
  scope, inspect the candidates, declare the appropriate files on the slices
  whose workers they concern, and put the supporting context those workers need
  in `read_scope`. Index coverage can be incomplete, so a file absent from the
  results is not thereby irrelevant. The guide asks for a relevant selection,
  not a whole-suite run.

The selected-slice read, the slice brief and the worker assignment summary
carry the list as authored. How the files run is described in
[Test Proof Execution](test-proof-execution.md#declared-regression-files).

### Findings units

A findings unit is one whose `work_kind` is `review` or `redteam`. `work_kind` is
the semantic axis, and the technical dispatch role follows from it: `review`
requires `reviewer` and `redteam` requires `redteam`. A
`dispatch_intent.intended_agent_role` that contradicts the unit's `work_kind` is
a contradiction, not a default to be resolved: the record asserts two
incompatible things about the same unit, and preferring either half would invent
the author's intent.

That contradiction is enforced at every boundary. The authoring routes refuse it
before persistence rather than normalizing it — whatever status the caller asks
for — and pure schema validation reports it as an **error** at the exact path
`dispatch_intent.intended_agent_role`, so a record carrying one fails validation
loudly. Validation never repairs it: no role and no `work_kind` is rewritten, and
no historical record is migrated. A canonical record that already carries the
contradiction stays unresolved and fail-loud until an author decides which half
was meant.

The validation error reaches live work only. A unit whose own `status` is `done`
or `cancelled` is history, and so is every slice of a record with that status:
their contradiction records what was authored rather than a decision anyone still
has to make, and failing them would freeze canonical writes to records whose live
work is coherent. Reading terminality at both levels is deliberate — a closed
conflicting slice must not freeze its otherwise live parent, and a finished or
abandoned WK is finished whatever status a stray subunit still carries. This
scopes only the error's reach; it is not a repair, an exemption from the rule, or
a licence to author a new conflict on a terminal unit.

Findings units may use `review_purpose` to distinguish standalone findings work
from terminal whole-WK review. The accepted vocabulary is closed:

| `work_kind` | required role | authored purpose | effective purpose |
| --- | --- | --- | --- |
| `review` | `reviewer` | omitted | `standalone`, from the documented reviewer default |
| `review` | `reviewer` | `standalone` | `standalone` |
| `review` | `reviewer` | `terminal_whole_wk` | `terminal_whole_wk` |
| `redteam` | `redteam` | `standalone` | `standalone` |
| `redteam` | `redteam` | omitted | absent |
| non-findings | unchanged | any | invalid |

The table describes a record as it is read. `terminal_whole_wk` is
reviewer-only. A stored value is always preserved exactly. Reading supplies
`standalone` for an absent purpose on `review` work only; a redteam unit stored
without a purpose reads as ABSENT on every read surface, and no read, projection,
validation pass, or launcher step manufactures, migrates, or infers one.

Omission and contradiction are different facts and are treated differently. A
stored redteam unit with no purpose is absence: the record validates clean and
is never rewritten by reading it. A conflicting role or an incompatible purpose
value is a contradiction and is an error wherever it is read.

Shaping is where the redteam purpose is written. Selecting redteam shaping
(`shaping_mode: "redteam"`) states the standalone adversarial intent once, so
the ready-slice shaping owner derives and persists `review_purpose: "standalone"`
when a slice is created and when an existing slice is explicitly reshaped,
including one stored without a purpose. The author does not supply the field. An
explicit `standalone` is accepted and changes nothing. An explicit
`terminal_whole_wk`, a value outside the vocabulary, or a conflicting
`work_kind` or dispatch role refuses before anything is written; a supplied
contradiction is never overwritten by the derived value. An update that selects
no shaping derives nothing: it preserves the stored purpose, and it refuses for a
stored redteam slice that has none. That refusal names the correction: retry the
same call with `shaping_mode: "redteam"`, and the owner derives the purpose.

Terminal whole-WK review stays a distinct, explicit choice: it is authored only
as `review_purpose: "terminal_whole_wk"` under reviewer shaping. Redteam shaping
never selects it and never sets or changes the record's completion policy.

Raw slice upsert and scaffold construction derive the technical role from
`work_kind` when the caller omitted it, so a findings unit is never silently
assigned the default worker role, and refuse an explicitly conflicting role.

## Acceptance and Validation

`acceptance.criteria` lists the behavioral or documentation outcomes that make
the unit complete. A criterion is either a non-empty string or an object whose
only fields are `text` and the optional authoring metadata `verification_method`
(one of the controlled feature-vector verification methods, or null),
`evidence_target` (a repository-relative path, or null) and `facet_provenance`.
Any other field is refused at the authoring boundary. Coverage identifies a
criterion by its position and `text`, so adding or changing this metadata leaves
criterion identity and saved coverage rows intact while still moving the
acceptance-coverage source bindings that own staleness.

`acceptance.validation` accepts human note strings,
`{note, verification_ids}` relationship-bearing notes, and one executable shape:
`{operation: "node_test", target, verification_ids}`. The target is one canonical
repository-relative `.mjs` test-module path. Strings never authorize execution.
Command-bearing objects, unknown operations, extra fields, duplicate executable
verification bindings, and `sections.structured_validation` are invalid.

Validation strings are part of the work contract. They do not by themselves
prove a result passed; workers and reviewers should report the validation they
actually ran, including failures, skips, or runtime blockers.

## Dispatch Intent

`dispatch_intent` describes whether and how a unit is intended to launch:

- `intended_agent_role` names the expected role, such as `worker`, `reviewer`,
  or `redteam`, or stays null when no direct role dispatch is intended.
- `target_unit` identifies whether dispatch targets the record, a tracker-local
  slice, or no unit.
- `requires_graph_impact` records whether graph-impact evidence is expected for
  launch readiness.
- `requires_escalation` records whether the work needs accepted escalation
  evidence before launch.

The persisted `dispatch_intent` is always the complete four-member object.
What an author supplies depends on the operation:

- Ready-slice shaping (`changes.ready_slices` on `save_record`, and the same
  member at record creation) takes a **partial** `dispatch_intent`. Every
  member is optional, and an author states only the control flags being
  changed, for example
  `{ id: "SLICE-001", dispatch_intent: { requires_graph_impact: true } }`.
  `intended_agent_role` and `target_unit` are derived from the selected or
  saved shaping. Each omitted control flag is resolved on its own: an update
  keeps that flag's saved value, and creation uses `false`. An explicit
  `false` overrides a saved `true`. An empty object, like an omitted
  `dispatch_intent`, changes no flag. The shaping owner then persists the
  complete object.
- A supplied `intended_agent_role` or `target_unit` is a consistency
  assertion, not a second source: a value that contradicts the shaping refuses
  with `ready_slice_shaping_conflict` or `ready_slice_invalid_field`. An
  unknown member, a non-boolean control flag, and a non-object value refuse too.
  On an update that selects no `shaping_mode`, a saved slice whose shape is not
  one of implementation, reviewer, or redteam refuses with
  `ready_slice_unsupported_effective_shape` at `shaping_mode`; an update never
  defaults a control flag the saved slice does not carry as a boolean, and
  refuses with the same code at that flag until the author states it. No refusal
  publishes any member of its save.
- Every other route that writes `dispatch_intent`, including a raw slice
  definition (`changes.slices`), replaces the whole field with the object
  supplied. It does not merge with the saved value, so a partial object there is
  not completed on the author's behalf.

Dispatch readiness is read-only derived evidence. It evaluates a selected record
or slice against the work-record contract and returns a decision such as
`dispatchable`, `tracker_not_dispatchable`, `missing_write_scope`, or
`missing_validation`. Worker admission is a launch-time envelope that combines
dispatch readiness with runtime, policy, graph, and atomicity evidence; it does
not change the canonical record schema.

## Review and Closure Evidence

Implementation work requires findings-only review before it is treated as done.
Worker reports and role results are evidence about what changed, which
validation ran, and what blockers or follow-ups remain. The coordinator or a
trusted ingestion path is responsible for incorporating that evidence into the
canonical work record and applying final status transitions.

`sections.closure`, status fields, resolution fields, and structured report
pointers should summarize the durable result. Remaining work should move into a
new or existing WK or slice rather than staying as unchecked tasks on a closed
unit.

Review execution uses `workspace_agent_dispatch`; its original result is the
review observation and the coordinator consumes its advisory text directly.
Schema diagnostics never make captured text unusable. If the canonical selected
result contract requests formal attestation, derivation and durable publication
occur during that same result settlement. No later evidence, provenance, or
attestation append operation exists.

Historical top-level `review_provenance` entries remain parseable only as inert
archival bytes so existing canonical records retain their valid shape. Runtime
paths preserve the field exactly but do not read it to admit, refuse, complete,
recover, classify, or otherwise settle an ordinary review.

## Generated Projections

Generated Markdown, agent briefs, catalog summaries, and queue views exist for
reading, handoff, and compatibility. They may compact or omit fields for a
specific audience, and persisted projections record source metadata such as the
source record id and digest.

Generated projections must not add dispatch authority. If a projection conflicts
with `wiki/work-records/WK-*.json`, the JSON record remains authoritative and
the projection should be treated as stale or invalid.

Canonical frozen-contract and source-digest projection removes archival
`review_provenance` before hashing; it never partially normalizes or
reinterprets the field. Records that predate it remain valid, and existing bytes
must be preserved exactly.

## Public Versus Internal Authority

Public consumers should rely on the JSON work-record location and the portable
contract files named above. The internal schema pages are maintainer references
for exact validation behavior, implementation boundaries, rollout notes, and
future export candidates.

Do not infer schema authority from generated views, scratch notes, runtime
artifacts, package examples, or benchmark fixtures. When public contract files
and internal implementation notes appear to disagree, treat that as a
coordination issue and resolve the authority split before changing work-record
state.
