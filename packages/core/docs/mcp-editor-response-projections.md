# MCP editor response projections

`workspace_work_record_edit` returns a receipt by default. A compact successful
receipt retains the selected task identity and status as `task: { index, status }`,
plus `changed_fields`, post-write `source_digest`, `generation_transition`,
`valid`, `written`, `no_op`, and diagnostics. It does not echo authored task
text or provide a mutation replay hint.

For a task edit, `next_calls` contains the existing read-only ordinary-field
continuation, addressed to the task this edit changed
(`ordinary_field: { field: "sections.tasks", index, member: "text" }`) and pinned
with the returned `source_digest`, so the caller reads back exactly the persisted
text through the summary route. This is an observation path, not a second write.

Pass `verbose: true` when the authored task result itself is required. Verbose
responses preserve the task detail and do not change the write semantics.

Compact receipt size is independent of authored task length apart from bounded
metadata such as the digest. Long task text must be verified through the
source-pinned read continuation and round-trip unchanged.

## Acceptance criteria edits and coverage currentness

The combined obligation-coverage `content_digest` binds the whole work record,
so an effective `acceptance.criteria` edit can leave a coverage digest the
caller already holds no longer current, and it changes the criterion identities
`obligations[].acceptance_criteria` may name. When the edit is clean and
effective (`ok`, `valid`, `written`, `publication_state: "published"`,
`no_op: false`, and `changed_fields` names `acceptance.criteria` or
`slices[SLICE-NNN].acceptance.criteria`), compact and verbose receipts append
conditional advice to `next_action` and add one
`workspace_controlled_contract_obligation_coverage_query` call to `next_calls`,
addressed to the edited unit (and carrying the request's `repo` only when one
was supplied). Before its next coverage upsert or remove, the caller uses that
query's current `content_digest` as `expected_content_digest` and its
`acceptance_criteria[].identity` values. The advice never orders an immediate
read, never suggests repeating the edit, and never offers the receipt's
work-record `source_digest` as the coverage digest.

The call reads the unit unfocused. The editor does not know a caller's focus or
other authoring contexts, so a caller resuming a focused or different unit
queries that unit and focus instead; the call does not refresh every context.
No-op, refused, stale, invalid and uncertain-publication edits add nothing and
keep their existing recovery. Other edits, including unrelated fields, add no
criteria notice, although the whole-record digest binding means they too can
supersede a held coverage digest; this notice is not an exhaustive invalidation
signal.

## Acceptance validation edits and post-run evidence

`generation_transition` reports purpose identity only. Candidate publication is
authenticated separately: the closeout owner compares acceptance fields against
the candidate and admits only new canonical entries as post-candidate
bookkeeping (see
[terminal review](mcp-dispatch-terminal-review.md)). The `acceptance.validation`
field rule, served in the editor overview and in that field's selected guidance
only, therefore routes post-run results and limitations to a new
`workspace_work_record_entry_upsert` entry that omits `entry_id` and passes the
record's current `source_digest`, keeping candidate-bound acceptance and
existing entries unchanged. A new entry records evidence only and cures no
other drift.

When an `acceptance.validation` edit is clean and effective (the same facts as
an acceptance-criteria edit, with `changed_fields` naming
`acceptance.validation` or `slices[SLICE-NNN].acceptance.validation`), compact
and verbose receipts replace the generic `next_action` with `Notes saved;
generation_transition reports purpose identity, not candidate publication
eligibility.` The receipt keeps its generation facts, diagnostics, digest and
calls, adds no call, reads no candidate state and makes no eligibility claim.
No-op, refused, stale, invalid, uncertain-publication and unrelated edits keep
their existing action.

## Generation transitions in a compact receipt

`generation_transition` states the effect of the write on the unit's generation.
Its classification is unchanged in either projection: `transition` and
`contract_dependent_artifacts_require_reassessment` come from
`work-record-generation-transition.mjs`, which the projection never consults or
re-decides.

A compact receipt carries `before_purpose` and `after_purpose` only when the two
differ — which is exactly what a `new_generation` transition means, and is the
reassessment signal itself. Completion and submission status do not create a
separate generation or lock current WK and slice authoring. A byte-identical pair
carries no such signal, so the compact receipt reports that once as
`purpose_unchanged: true` and omits both objects. Likewise, the transition does
not restate the unit the receipt already names: when the two are identical the
compact projection reports `selected_unit_is_receipt_unit: true` and omits the
duplicate, and the receipt's own `selected_unit` is the address.

`verbose: true` returns the complete transition, including both purpose objects
and the transition's own `selected_unit`. The omitted pair is therefore never a
reason to replay a mutation.

Editing the current record never rewrites or rebinds historical execution,
commit, review, or evidence identity and never launches execution. Schema,
identity, confinement, source-digest CAS, transaction, retained-entry history,
and archival review-provenance checks remain independent refusal owners; their
protection is not represented by a completion-derived generation transition.
