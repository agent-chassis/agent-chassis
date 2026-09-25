
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
`node:path.posix` interpretation. One terminal slash records explicit directory
intent: `docs/` has canonical lookup path `docs`, while `docs` has no explicit
directory hint. Authored selectors retain that distinction in authoritative
scope carriers. Repeated separators, including repeated trailing slashes, are
invalid, as are absolute paths, backslashes, and paths containing traversal
components. Glob selectors use Node's `path.posix.matchesGlob()` semantics:
`*.go` matches only root-level Go files, while `**/*.go` also matches nested Go
files. A glob grants only paths it matches; its containing directory is not an
implicit scope grant. Matching never rewrites the authored selector stored in an
authenticated scope carrier.

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

`terminal_whole_wk` is reviewer-only. An authored value is always preserved
exactly. Omission defaults to `standalone` for `review` work only; an omitted
redteam purpose stays ABSENT on every read surface and is never manufactured,
migrated, or inferred.

Omission and contradiction are different facts and are treated differently. An
omitted redteam purpose is absence: a record at rest carrying one validates
clean, and only the authoring routes below refuse it. A conflicting role or an
incompatible purpose value is a contradiction and is an error wherever it is
read.

The `workspace_work_record_ready_slice` authoring operation additionally
requires an explicitly authored `review_purpose: "standalone"` for redteam
shaping, on create and on update alike. Omission refuses before persistence,
naming the field path `review_purpose`, the accepted value `standalone`, and the
retry. That requirement is a property of the authoring call, not a lifecycle
status and not a property of a stored record: a historical redteam unit that
omitted the purpose remains valid and is never rewritten.

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
