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
