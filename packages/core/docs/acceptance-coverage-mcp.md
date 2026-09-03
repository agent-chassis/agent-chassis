
# Acceptance-coverage MCP

This page owns the public protocol for authoring the upstream controlled-contract
obligation source and for authoring and inspecting its downstream acceptance-
coverage mapping carrier. Both surfaces extend the existing canonical resolver,
currentness, carrier/schema, bounds, CAS, pagination, content-reference, role,
discovery, and routing owners. They do not define another obligation census,
evaluator, cursor, coverage vocabulary, state machine, authority owner, or
documentation catalog.

## No confidentiality or security posture

This protocol defines no confidentiality boundary and makes no claim that
repository facts are secret from agents. `server-resolved` means only that the
server owns canonical identity, currentness, and mutation integrity; it does not
authorize withholding context that an agent needs to perform the selected task.
Omission is justified only when information is irrelevant or duplicative for
that task. It is never justified as secrecy, least privilege, or minimum
disclosure.

The ergonomic objective is complete task-relevant context at the lowest total
workflow cost. Measure the whole workflow: useful semantic payload, repeated
envelope bytes, calls, continuations, retries, and final-state verification. A
smaller individual response is not an improvement when it creates avoidable
round trips or prevents the caller from making the required semantic decision.

## Shared semantic authoring skeleton

The existing obligation and acceptance `describe` operations are the sole
semantic-authoring bootstraps. The controlled-contract package composes the
complete authoring skeleton from canonical facts already resolved by
wiki-core, and wiki-core retains that population server-side for validation,
count derivation, continuation composition, and mutation or rebase preparation.
The MCP result is a task-complete projection. It returns the criteria, contract
nodes, proof choices, row identities, and field contracts needed for the
selected authoring operation while omitting unrelated contract material and
repeated representations. No public input accepts a path, raw carrier, selected
pack, arbitrary digest, authority claim, or authored semantic choice on behalf
of the caller; those restrictions protect canonical integrity rather than
confidentiality.

The controlled population is exactly these ordered identities and terms. Every
table term has the exact `wk-2439-` prefix; the table shows the suffix once to
keep the exhaustive population readable.

| Entry | Controlled term | Authority |
| --- | --- | --- |
| 01 | `common-unit-address-server-string` | server |
| 02 | `common-selected-unit-server-nullable-string` | server |
| 03 | `common-focus-server-nullable-slug` | server |
| 04 | `common-selected-unit-digest-server-sha256` | server |
| 05 | `common-criterion-identity-population-server` | server |
| 06 | `common-contract-content-digest-server-sha256` | server |
| 07 | `common-contract-node-population-server` | server |
| 08 | `common-proof-plan-content-digest-server-nullable-sha256` | server |
| 09 | `common-selected-pack-population-server` | server |
| 10 | `common-carrier-status-server-enum` | server |
| 11 | `common-currentness-changed-bindings-server` | server |
| 12 | `common-mutation-operation-server-tool-identity` | server |
| 13 | `common-mutation-stable-fixed-arguments-server-object` | server |
| 14 | `common-mutation-cas-state-receipt-fed-sha256` | evolving CAS |
| 15 | `common-authored-unresolved-slot-population` | server |
| 16 | `common-projection-total-server-integer-39` | server |
| 17 | `common-projection-returned-server-integer` | server |
| 18 | `common-projection-omitted-server-integer` | server |
| 19 | `common-projection-inline-entry-population-server` | server |
| 20 | `common-projection-complete-content-reference-existing-transport` | legacy transport term; not an authoring input |
| 21 | `common-metric-call-count-integer` | metric |
| 22 | `common-metric-request-utf8-bytes-integer` | metric |
| 23 | `common-metric-result-utf8-bytes-integer` | metric |
| 24 | `common-metric-unresolved-slot-count-integer` | metric |
| 25 | `common-metric-retry-count-integer` | metric |
| 26 | `common-metric-source-inspection-escape-count-integer` | metric |
| 27 | `common-metric-final-carrier-equivalence-boolean` | metric |
| 28 | `obligation-row-obligation-id-authored-string` | caller-authored |
| 29 | `obligation-row-statement-authored-trimmed-single-line-string` | caller-authored |
| 30 | `obligation-row-criterion-selector-server-current-criterion` | server |
| 31 | `obligation-row-contract-node-ids-authored-current-reference-list` | caller-authored |
| 32 | `obligation-row-mechanism-authored-package-enum` | caller-authored |
| 33 | `obligation-row-gap-authored-typed-alternative` | caller-authored |
| 34 | `obligation-row-pack-component-authored-admitted-alternative` | caller-authored |
| 35 | `obligation-mutation-expected-authoring-identity-server-string` | server |
| 36 | `obligation-mutation-source-identity-server-object` | server |
| 37 | `acceptance-row-criterion-identity-server-current-criterion` | server |
| 38 | `acceptance-row-node-ids-authored-current-reference-list` | caller-authored |
| 39 | `acceptance-row-axes-authored-complete-six-axis-state-map` | caller-authored |

The package marks `complete_population` as `internal_only`, keeps it in controlled order, and separately
compute a deterministic gap-first `inline_projection`. The 39-entry population
is implementation bookkeeping, not a security boundary and not useful payload
by itself. MCP need not return that redundant representation, but it must return
every semantic fact from it that the caller needs for the selected task.
Neither an internal population object nor a generic content-reference dump is a
substitute for a task-complete authoring projection.

The historical runtime schema name
`controlled-contract-coverage-describe-least-disclosure.v1` is a compatibility
label, not a normative security or ergonomics policy. Implementations must not
use that label to justify omitting task-required context.

The public result reports `family`, `mode`, `unit`, `carrier_state`,
`currentness`, exact counts, unresolved authoring rows, fixed mutation or
recovery arguments, executable continuation when needed, and bounded
diagnostics. It returns a batch containing as many complete task-required row
descriptors as the active transport can carry efficiently. Shared schemas,
criterion facts, node choices, proof choices, and other reusable context appear
once per result rather than being repeated for every row. A row descriptor
contains its opaque server-minted identity plus all criterion, contract-node,
proof, and field-contract context needed for the caller to author that row.

Reusable choices use lossless normalized forms. `contract_nodes` reports an
exact `total` and ordered, disjoint `mandatory_ids` and `optional_ids`; the two
array lengths sum to `total`. For obligation authoring,
`admitted_pack_components` reports its exact total and the field-by-field
derivation of every mapping from each returned selected pack's
requested-intent and selector cross-product. That derivation preserves every
callable pack-mapping choice while emitting the shared pack, intent, selector,
profile, and evaluation-stage facts once. These forms are semantic
normalization, not omission, byte-cut JSON, a content reference, generic spill,
or a source-inspection recovery path.

One-row-at-a-time traversal is not the canonical design. A one-row result is
valid only when one unresolved row exists or adding the next complete row would
cross an actual transport ceiling. If the required population does not fit in
one result, the operation returns lossless integrity-bound pages with exact
total/returned/remaining accounting and a directly callable continuation. It
does not optimize toward a predetermined token count, fixed row count, or
minimum response size. JSON is never byte-cut, and no omitted task input must
be reconstructed from source or guessed by the caller.

Caller-authored fields remain unresolved until the caller supplies them. The
task projection provides every relevant current node and proof choice needed to
make those decisions; it never chooses statements, mechanisms, proof adequacy,
gaps, axis states, or lifecycle outcomes for the caller. Its diagnostics are
local data only;
work record remains the owner of public state classification, `next_calls`, blind-
retry prevention, and dependency recovery.

For an absent carrier, `authoring_action` is the one typed mutation contract. It
names the existing create operation, stable server arguments, the complete
`authored_rows` population, and the describe-based completion predicate. Each authored row carries
the exact opaque identity returned by the continuation plus only caller-authored
fields. The server requires every identity from one session exactly once,
resolves and injects the current criterion identity, then consumes the session
only after successful persistence. Row identities are random 256-bit values,
expire after 30 minutes, are retained in an expired-first LRU registry of 32
sessions, and bind family, WK/slice, focus, unit digest, criterion, skeleton
version, source/currentness state, ordinal, and continuation state. Forged,
expired, replayed, cross-family, cross-unit, cross-focus, or source-mismatched
identities refuse before a write. Process restart makes outstanding identities
unavailable; callers restart from describe. `read_pagination.continuation` is a
separate read-only field and never competes with, replaces, or terminates that
mutation action. An exact `authoring_row` selector returns only its bound row.
The selected row contains only canonical obligation-source relationships and
the contract-node and proof-choice population members mechanically linked by
those relationships. A relationship is admitted only by its canonical source
locator after a per-row check against the current criterion identity, identity-
set digest, contract nodes, and proof-plan member. Stale or reordered source rows
are not rebound by position. `contract_nodes.total` always names the complete
source population; `returned` and `omitted` name the current projection. Selected
packs retain their pack/profile identity and separately account for requested
intents, selectors, and admitted components. Every selected population reports
exact `total`, `returned`, and `omitted` counts. When caller-authored ambiguity
leaves further alternatives, each affected `field_contract.choices_ref` names
its returned population and lists the omitted populations whose bounded typed
`authoring_context` calls appear in `shared_context.context_continuations`.
Pack-member and admitted-component continuations are available in both coverage
families. A request for a population that does not apply to the selected family
returns `coverage_authoring_context_population_not_applicable`; it is not
misreported as an offset failure. The projection does not inline unrelated
complete populations or expose raw contracts or content references. For a stale
carrier the action names the
exact server-owned rebase or recovery operation. For a current carrier,
the existing single-row mutation is executed sequentially. Stable non-CAS
arguments are retained once; `expected_content_digest` and each digest-bearing
carrier/source identity slot come from the immediately prior describe or
mutation receipt. Acceptance mutation receipts carry the complete next
`carrier_identity` and unchanged `source_identity` so no digest slot is rebuilt
or guessed. Every ordinary create, upsert, and remove success, including a
no-op success, advertises exactly one unfiltered query for its own family. That
query call contains only the canonical unit and optional non-null focus and is
the final-state verification continuation. Describe remains the
authoring/currentness bootstrap and the recovery route after an uncertain
post-commit outcome.
The work record atomic patch is advertised only when that independent owner makes it
canonically available. Authoring-context batching and mutation atomicity are
separate concerns: describe must batch useful context even when mutations are
later submitted through an existing sequential route.

The fixed-fixture proof records this raw schema without interpreting it:

```json
{
  "call_count": 0,
  "request_utf8_bytes": 0,
  "result_utf8_bytes": 0,
  "unresolved_slot_count": 0,
  "retry_count": 0,
  "source_inspection_escape_count": 0,
  "final_carrier_equivalence": false
}
```

work record owns only this raw capture and exact persisted-byte comparison. work record
owns composed-versus-manual denominators, conclusions, and publication; no such
workflow conclusion is part of `authoring_skeleton` or this protocol.

## Obligation-source authoring operations

The controlled-contract registrar exposes exactly these upstream operations:

- `workspace_controlled_contract_obligation_coverage_describe`
- `workspace_controlled_contract_obligation_coverage_create`
- `workspace_controlled_contract_obligation_coverage_upsert`
- `workspace_controlled_contract_obligation_coverage_remove`
- `workspace_controlled_contract_obligation_coverage_query`
- `workspace_controlled_contract_obligation_coverage_rebase`
- `workspace_controlled_contract_obligation_coverage_patch`

`describe` is absence-safe and is the only authoring bootstrap. For a selected
`WK-####` or `WK-####\#SLICE-###` plus optional controlled-contract `focus`, the
server resolves the work record and unit, manifest-selected contract generation
and nodes, proof-plan generation and admitted pack, canonical source locator,
currentness, exact write scope, and prospective carrier. The result includes an
opaque `authoring_identity`, expected absence, the two independent bounds, and
an exact executable create identity. The caller supplies none of those facts.

On the opaque row-slot path an authored row contains only the returned
`row_slot_identity`, `obligation_id`, one trimmed single-line `statement`,
current `controlled_contract_node_ids`, one package-typed `mechanism`, and
either an explicit typed gap or an admitted pack component selector. The server
injects the current criterion selector bound to the row slot. For a pack mapping,
the server derives the selected pack ID, profile ID/version, and admitted
requested intent from the canonical proof plan. It also derives
`source_locator` and `source_locator_digest`. Caller paths, refs, writers,
transports, generations, canonical digests other than mutation CAS, pack IDs,
census/completeness claims, and authority sources are forbidden by the closed
public schemas.

`create` requires exact source absence, `expected_content_digest: null`, the
unchanged describe-emitted authoring identity, and every opaque row identity
from one continuation traversal exactly once. `upsert` and `remove` require the
current content digest and a typed `obligation_id` selector. Every population
must cover every selected-unit criterion. Before writing and again at final
compare, the host validates the server-resolved target's repository containment
and real-file integrity. Persistence uses the existing lock, synchronized
temporary file, final comparison, and atomic rename boundary.

The row and byte limits are independent hard ceilings: at most 4,096 rows and at
most 1,048,576 canonical UTF-8 bytes. A carrier succeeds only if it satisfies
both. The count ceiling does not promise that 4,096 schema-valid rows fit under
the byte ceiling. The first count overflow and first byte overflow refuse with
their specific deciding bound; neither truncates or mutates state.

`query` is read-only, non-authoritative, deterministic, gap-first, and completely
paginated in fixed pages. It accepts no selector, or one typed obligation,
criterion, contract-node, mechanism, or proof-kind selector. Its opaque cursor
binds the source and all joined canonical currentness identities, so any mutation
or canonical change makes an old cursor stale. Oversized MCP results use the
existing integrity-bound content-reference transport.

When `describe` reports `source_present_stale`, orchestrator and operator callers
may use `rebase`. Its closed `attempt` variant accepts only the selected unit,
optional focus, and the exact describe-emitted authoring and stale-source
identities. The server compares the stale authored rows with the current
criteria, contract nodes, and proof-plan pack. Exact semantic identity permits
a safe rebind with no caller-authored replacement. Otherwise the attempt returns
a digest-bound conflict set containing deterministic changed, removed,
new-unmapped, duplicate, absent-node, ambiguous, or invalid classifications.
The `page` variant accepts only that set identity and its opaque continuation;
every conflict is returned exactly once in stable order, and each page is at
most 16,384 canonical UTF-8 bytes. Any relevant canonical or carrier mutation
makes the continuation and set stale. The `resolve` variant accepts a complete,
one-per-conflict population of typed retain, replace, add, or remove
dispositions. Omitted, duplicate, unknown, extra, stale, or class-incompatible
dispositions refuse before persistence.

All success and refusal envelopes deny proof, requirement, admission, dispatch,
review, integration, publication, and completion authority. Orchestrator and
operator sessions see all seven operations; reviewer and redteam sessions see
describe/query only; worker sessions see none. Hidden mutation invocations and
all worker invocations refuse at the public session boundary.

## Acceptance-mapping operations

The single controlled-contract registration family exposes exactly:

- `workspace_controlled_contract_acceptance_coverage_describe`
- `workspace_controlled_contract_acceptance_coverage_create`
- `workspace_controlled_contract_acceptance_coverage_upsert`
- `workspace_controlled_contract_acceptance_coverage_remove`
- `workspace_controlled_contract_acceptance_coverage_query`
- `workspace_controlled_contract_acceptance_coverage_rebase`
- `workspace_controlled_contract_acceptance_coverage_patch`

Every call selects `unit` as either `WK-####` or
`WK-####\#SLICE-###`. Optional `focus` retains the global controlled-contract
lowercase-slug grammar and selects the controlled-contract carrier family. A
slice selected in `unit` is a work-record identity, not a carrier focus; the two
dimensions are resolved and bound separately. Callers may select the configured
repository alias but cannot provide repository paths, source paths, carrier
paths, subject digests, generations, counts, census members, completeness or
currentness claims, outcomes, or provider authority.

`describe` is the legitimate first call. It works before the derived carrier
exists and returns bounded selected-unit state, exact population counts,
currentness, a transport-efficient batch of opaque authoring-row identities,
the task-relevant criterion, contract-node, and proof context for those rows,
server-fixed mutation/recovery arguments, and a callable continuation when
more rows remain. Raw digests outside the fixed action and the redundant
39-entry implementation skeleton are omitted because they are not authoring
inputs, not because they are confidential.

Every row reports the current criterion identity and text, caller-authored
fields, and owner-produced applicability. Canonical obligation rows mechanically
bind their criterion source locator, controlled-contract node identities,
mechanism, and proof choice to the selected criterion for both coverage
families. An exact row selection projects only those bound members. When the
semantic owner has no criterion relationship, the row records an explicit
caller decision, returns zero unrelated population members inline, reports the
complete exact accounting, and exposes bounded typed context continuations for
any further alternatives the caller elects to inspect.

`create` requires `expected_content_digest: null`, the server-issued
`expected_unit_digest`, server-proven carrier absence, the exact carrier and
source identities returned by `describe`, and every opaque row identity from
one continuation traversal exactly once. The unit digest binds criteria,
contract, proof-plan, ownership, validation, selected-unit, and source facts; it
is compared at admission and again immediately before persistence. Its `rows`
are a complete bounded population. `upsert` and `remove` require the current
carrier digest in both carrier identity and `expected_content_digest`, plus a
closed `criterion_selector` of kind `criterion_identity`. An upsert row must
match that selector. Mutations perform one lock, final source comparison,
temporary-file sync, and atomic rename. They author mappings only.

`query` is read-only and gap-first. Its optional closed selector is either a
current criterion identity or a current controlled-contract node identity. The
controlled-contract package remains the owner of deterministic projection,
ordering, page size, selection, and its private projection cursor. Wiki-core
wraps each nonterminal package cursor exactly once in the public operation
cursor, binding it to the server-derived joined unit/currentness digest. The
package cursor is never a public continuation.

One public cursor is published byte-for-byte through both
`page.continuation` and `next_calls[0].arguments.cursor`. `next_calls` remains
the sole executable follow-up contract: it carries the exact selected `unit`,
optional `focus`, normalized selector when one was supplied, and public cursor.
The selector-plus-cursor input shape exists only to validate a continuation;
wiki-core passes the selector through to package projection, whose embedded
selector comparison decides whether it matches. Callers should traverse by
executing the returned next call, not by constructing a continuation request.

Totals and page accounting are snapshot totals and therefore remain identical
on every page of one current traversal. `totals.all_items` is the unfiltered
population for the active projection mode: the package gap population for the
default gap-first mode, or the complete criterion-plus-unmapped-mandatory-node
detail population for selector mode. `totals.matched_items` and `page.total`
are the selected population. `page.offset` is its zero-based starting offset,
`page.returned` is the number of returned occurrences, and
`page.remaining = totals.matched_items - page.offset - page.returned`.
`page.complete` is true exactly when remaining is zero. Items retain the
package-defined deterministic order and each selected occurrence is returned
exactly once in a complete traversal.

Every continuation call re-resolves canonical facts. A public cursor remains
valid without wall-clock expiry while its joined currentness and embedded
projection selection remain current. Cursors have no consumption state: replay
of the same still-valid cursor deterministically returns the same page. Changed
joined identities refuse as stale. A structurally valid current cursor whose
embedded offset is at or beyond the current selected population refuses
statelessly as exhausted; exhaustion is not evidence that a cursor was used
before. A terminal page has `page.continuation: null` and an empty `next_calls`
collection, so the server emits no terminal continuation.

The complete public continuation refusal partition is:

| Condition | Reason code |
| --- | --- |
| Malformed operation cursor, including a malformed embedded projection cursor | `acceptance_coverage_cursor_invalid` |
| Package projection cursor supplied directly to the public cursor input | `acceptance_coverage_cursor_wrong_layer` |
| Supplied selector differs from the selector embedded by package projection | `acceptance_coverage_projection_cursor_selector_mismatch` |
| Public cursor's joined unit/currentness digest differs from current canonical facts | `acceptance_coverage_cursor_stale` |
| Structurally valid current cursor offset is at or beyond the current selected population | `acceptance_coverage_cursor_exhausted` |
| Canonical source is independently present but invalid | `acceptance_coverage_canonical_source_invalid` |

Cursor-layer, selection, currentness, and exhaustion defects never collapse
into canonical-source invalidity. An independently unavailable canonical source
keeps its existing source-unavailable refusal. Obligation-coverage query
pagination retains its already-correct public operation cursor and is unchanged.

When `describe` reports `carrier_present_stale` and its upstream obligation
source is current, `rebase` follows the same closed `attempt`, `page`, and
`resolve` protocol as source rebase. Attempt accepts only the exact
describe-emitted carrier, source, and unit identities. Exact semantic identity
performs a safe rebind; semantic changes produce the bounded conflict set.
Resolution must disposition the complete set and must produce a complete valid
mapping population under the existing independent 4,096-row and 1,048,576-byte
carrier ceilings.

## Atomic patch operations

`workspace_controlled_contract_acceptance_coverage_patch` and
`workspace_controlled_contract_obligation_coverage_patch` are the public
multi-operation mutations for current carriers. They are available only when
`describe` reports `carrier_present_current` or `source_present_current`.
Current-state describe results advertise the matching patch operation, put all
immutable identity and CAS fields in `fixed_arguments`, and name only
`operations` in `required_authored_fields`. Absent and stale results never
advertise patch.

The acceptance request is the closed object `{repo?, unit, focus?,
carrier_identity, source_identity, expected_unit_digest,
expected_authoring_identity, expected_content_digest, operations}`. Each
operation is exactly either `{op: "upsert", criterion_selector, row}`,
`{op: "upsert", row_slot_identity, row: {node_ids, axes}}`, or
`{op: "remove", criterion_selector}`. The row-slot form resolves and injects
the criterion identity server-side. The obligation request is the closed
object `{repo?, unit, focus?, source_identity, expected_authoring_identity,
expected_content_digest, operations}`. Its operations are exactly either
`{op: "upsert", obligation_selector, row}`, `{op: "upsert",
obligation_selector, row_slot_identity, row}`, or `{op: "remove",
obligation_selector}`. The row-slot upsert omits the criterion selector and has
it injected server-side. All other selectors and rows retain the closed family
schemas described above. `operations` must be non-empty; the MCP adapter adds no local
operation-count ceiling. The existing independent carrier row and canonical
byte ceilings remain authoritative.

Wiki-MCP only converts the public snake-case fields to the existing wiki-core
adapter inputs. Wiki-core resolves the current carrier, verifies every
describe-emitted identity and currentness fact, applies the ordered operation
sequence to a private clone, validates and canonicalizes the complete
prospective carrier once, and crosses the persistence boundary at most once.
It uses the existing family source lease, final comparison, synchronized atomic
write, and receipt classification. There is no generic carrier mutation,
per-operation write, raw-carrier input, alternate primitive, or fallback path.

Ordinary results have status `updated`, `no_change`, or `already_satisfied`.
Only `updated` has `changed: true`; both other statuses have `changed: false`.
A replay whose stale request already describes the current prospective bytes is
`already_satisfied`, while a stale request that would change current bytes
refuses before effects. Results include the previous and final content digests,
operation/upsert/remove counts, final row count, current carrier or source
identity, non-authority declaration, and a query next call; they never include
raw rows or carrier bytes.

Failure after the atomic commit point is returned as
`status: "post_commit_failure"`, `commit_state: "committed"` or
`"indeterminate"`, a stable `failure_code`, and a describe next call. This
shape intentionally has no `changed` field: callers must follow describe before
retrying and must not infer rollback or repeat the original mutation. All patch
results use the normal bounded MCP response/content-reference transport without
rewriting the wiki-core result.

All source and mapping mutations share one lock order: obligation source before
acceptance mapping. The currentness vector remains locked through final CAS,
temporary-file synchronization, atomic rename, and receipt verification.
Source and mapping remain separate transactions; a source rebase never also
rewrites mapping bytes. Mapping rebase refuses while source rebase is still
required. Every refusal is all-or-nothing and preserves the pre-call carrier.

## Outcomes and state preservation

Missing or invalid canonical sources never become an empty population. Missing
provider/source, missing carrier, invalid selector, stale described-unit
currentness, stale carrier currentness, duplicate credit, oversize input, busy
lock contention, and final-compare races retain distinct typed reason codes.
Every refusal preserves the carrier bytes. The
observable persistent transitions are absence-preserving describe,
absent-to-present create, present-to-present upsert, present-to-present-or-empty
remove, and before-state-preserving refusal.

Describe reports `carrier_absent`, `carrier_present_current`, or
`carrier_present_stale`. A stale carrier remains queryable as stale evidence but
cannot be upserted or removed. Concurrent create has one admitted winner;
digest-CAS losers, lock losers, and final-compare losers do not write.

## Authority and visibility

Describe and query are read-only and non-authoritative. Mutation results state
`authors_mappings_only: true`; no result grants proof, admission, CCE, dispatch,
review, integration, publication, completion, CI-gating, or runtime-proof
authority. `workspace_controlled_contract_assess` retains its existing meaning
and is not part of this family.

Role visibility is exact:

| Role | Visible operations |
| --- | --- |
| orchestrator | describe, create, upsert, remove, query, rebase, patch |
| operator | describe, create, upsert, remove, query, rebase, patch |
| reviewer | describe, query |
| redteam | describe, query |
| worker | none |

Registration, published schemas, tool-discovery descriptors, the central role
policy, routing vocabulary, invocation, and every advertised next-call
population must contain the same seven identities. Discovery begins this family
at `describe`; it does not route through assessment or generic carrier recovery.

## Refactor coverage settlement

Controlled-contract `replace_subgraph` planning changes the prospective
contract-node census but does not create another coverage model. The existing
obligation and acceptance rebase owners still own row currentness, conflict
classification, complete dispositions, normalization, locks, CAS behavior, and
receipt classification. The finalization form of
`workspace_controlled_contract_refactor_plan` delegates both complete
disposition populations to those owners before releasing an apply continuation.
`workspace_controlled_contract_refactor_apply` accepts no dispositions.

At apply, obligation coverage and acceptance coverage remain separate canonical
files outside controlled-contract carrier-set membership. Their existing
persistence owners expose prepare, commit, and exact reverse compensation under
the same canonical source lease used by the existing generation publisher.
Preparation authenticates both source digests, obtains coverage locks in stable
order, validates prospective bytes, and stages private files. Settlement commits
the prepared coverage and generation participants, verifies the source lease at
each boundary, and either records the immutable continuation receipt or
compensates every prepared participant in reverse order. Compensation restores
the exact prior bytes, prior manifest selection, and generation-directory
presence. No generic coverage writer, second rebase classifier, caller-managed
CAS sequence, or coverage-to-carrier-set membership transfer is introduced.

For `rename_identity`, the package-projected coverage bytes contain the same
identity-only rewrite and require no rebase disposition. For semantic
replacement, removed, added, split, merged, or changed requirements retain the
existing rebase disposition semantics and produce explicit proof gaps; proof
credit is never copied to a new identity by correspondence alone. Source or
generation drift returns the existing owner refusal and a fresh refactor-plan
call. Historical coverage evidence and all superseded canonical generations
remain immutable.
