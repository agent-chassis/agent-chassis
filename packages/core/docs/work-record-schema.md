
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
and scope arrays such as `docs`, `repo_paths`, `write_scope`, `depends_on`,
`blocks`, and `related`.

The public schema distinction is:

- `record_kind` says what kind of record this is. Current `WK-*` records use
  `record_kind: "work_item"`.
- `work_kind` says how the unit is handled. Common values include `tracker`,
  `design`, `implementation`, `review`, and `redteam`.
- `sections` carries human-readable summary, scope, tasks, references, agent
  notes, and closure prose. Dispatch-critical facts should be present in the
  structured fields, not only in prose.

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
the unit complete. `acceptance.validation` lists the commands or structured
checks expected to verify the result.

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
