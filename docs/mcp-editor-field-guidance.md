## MCP editor field guidance

`workspace_tools_describe` supports targeted editor guidance through
`input_contract: { kind: "field", field, scope }`. The selected response is
derived from `WORK_RECORD_EDIT_FIELD_REGISTRY`; it includes the selected
field's applicable actions, value constraints, request shapes, and a schema-
valid example for each request shape. The response retains the editor source
identity and digest/no-op guidance needed to perform a safe edit.

Selected guidance is intentionally field-local. It does not repeat semantics
for unrelated fields or action shapes belonging to sibling fields. Scalar,
list, task, notes, and acceptance fields each receive only their applicable
replacement/value-carrier rule. Notes and task examples retain their existing
`{text}`, `{ref}`, or `parts` carrier requirements.

The complete field inventory remains available through
`input_contract: { kind: "fields" }`. The complete editor input schema remains
available through the verbose `workspace_tools_describe` path. See
[Tool Discovery](tool-discovery-surfaces.md) for the discovery and continuation
surface, and [Tool Discovery ranking and query behavior](tool-discovery.md)
for the selector contract.

## The inventory is navigation

`input_contract: { kind: "fields" }` answers which field, target and action a
caller can select. Each row carries `field`, `kind`, `applicability`, the
`actions` the field accepts as names, and `selectors` only for an action that
requires one. It carries no per-action value constraints, request contracts or
examples: those are the selected route's answer, and a caller reads them once,
for the one field it is editing.

Each traversal opens with a response-level `navigation` statement naming the two
axes a row carries — `kind` is the edit shape (`scalar|list|task`),
`applicability` is the edit target (`record|slice`) named by `unit` — and the
exact `kind:"field"` selector that returns the omitted detail. It is emitted on
the page that opens the traversal; a later page is reachable only through that
response's own source-pinned continuation, so the caller already holds it.

Paging is unchanged in mechanism. Every page states its complete window
(`offset`, `returned_count`, `truncated_count`, `limit_applied`, `byte_limit`,
`result_byte_limit`, `count_truncated`, `byte_truncated`, `truncated`,
`has_more`, `next_offset`) and, while rows remain, exactly one executable
continuation pinned to the traversal's `source_digest`. A page cut short by the
byte ceiling resumes at the first row it dropped.

### The whole inventory is one response

The shipped population is twenty navigation rows, about 3.4KB pretty-printed —
a complete answer to one question. Under the generic discovery-list ceilings
(3,840 structured / 4,096 complete-frame) it took three calls, so a caller paid
three requests, three envelopes and two continuations to reassemble something
one response carries. A small per-response byte number is not a saving when it
forces the caller to reconstruct a small complete answer.

This inventory is therefore bounded by the response transport's OWN inline
admission limit, less a reserve for the describe envelope it is nested inside —
a real transport limitation rather than a second invented threshold — and its
default requested count is the population itself. Consequences:

- An unqualified `kind:"fields"` request, or one whose `limit` covers the
  population, returns every row exactly once in **one** call, with
  `has_more:false`, no continuation and no truncation.
- A smaller explicit `limit` still wins exactly: `limit:3` returns three rows,
  `has_more:true` and a source-pinned continuation.
- A genuinely larger field population still pages completely, in order, pinned
  to one `source_digest`, with executable continuations and a page cut short at
  a resumable row.
- Rows stay navigation-sized. No per-field schema, constraint or example was
  restored to fill the larger budget; that remains the selected route's answer.
- `byte_limit` and `result_byte_limit` are reported on every page, so a caller
  reads the active ceiling from the response rather than assuming a constant.

Measured over the shipped population through the registered route: the complete
inventory went from three calls and 11,444 request-plus-response bytes to one
call and 6,637; the inventory-plus-one-selected-field journey went from four
calls and 22,324 bytes to two calls and 17,517. These are UTF-8 transport bytes,
not model tokens. This ceiling applies to this inventory only —
`workspace_tools_list` and every other discovery route keep theirs.

## Shared constraints are stated once per response

A selected-field response states a repeated rule once and refers to it, rather
than repeating it per request shape or per occurrence. Nothing is dropped: every
distinct occurrence keeps its own position and identity.

- `request_contract.extends: "common_request.contract"` means the contract omits
  only properties byte-identical to `common_request.contract.properties`. Merge
  them in. A variant that genuinely refines a common property restates it, and
  `required` and `additionalProperties` already describe the composed object.
- `constraint_definitions` maps a constraint identity to its complete statement.
  An occurrence that omits `statement` carries that identity and takes its text
  from this map. A constraint identity that appears with two different
  statements is not shared: each occurrence keeps its own statement.

`semantics.shared_contract` states both rules in the same response. Recomposing
a served shape by merging the common properties and resolving the definitions
reproduces the registered request contract exactly.
