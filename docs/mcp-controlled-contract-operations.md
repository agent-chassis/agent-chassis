# Controlled-contract operations

The public MCP surface exposes semantic proof authoring, inspection, validation,
and verification. Callers author requirement and obligation meaning directly;
they do not construct carriers, proof graphs, bundles, plans, or publication
sessions.

Orchestrators MUST be able to use these operations through tool discovery,
input contracts, targeted tool guidance and operation responses alone. Those
surfaces must explain the required inputs, their relationships, derived values
and supported corrections. Documentation, FAQ access and agent-chassis source
inspection must not be prerequisites or required recovery paths. Missing
operational information is a tool-interface defect; optional explanatory
material does not discharge this requirement.

Proof selection, execution-case authoring and optional falsification are separate
steps; see [Acceptance coverage](acceptance-coverage-mcp.md). Discovery separates
`save.missing_inputs` for the proof decision from `save.execution_case_inputs` for
a caller choosing to supply a case. The family’s `target.provider` belongs in a
supplied native target; the proof-selection template supplies no partial case.

A scope-save refusal preserves the declared base and its actual resolution
failure. Its focused parent read provides the current revision and base-branch
save grammar. A different base requires the caller’s explicit choice; acquire a
fresh revision for the intended unit before retrying the scope save.

## Public operations

The registered family is `workspace_find_proofs`, `workspace_read_wiki`,
`save_record`, `workspace_assess_contract` and execution-only `verify_proof`.
Create records through `workspace_create_record`. Retained and recorded execution
results use `get_run_result`. The old discovery, upsert, query, removal and
validation routes are not public aliases.

Route proof discovery by intent: `workspace_find_proofs` with no arguments
browses the complete catalogue of proof names and short descriptions. A held
proof name goes directly to its read; a caller-authored property query goes
directly to search. Browsing is not a mandatory preliminary step. Matches are complete by lexical tier;
a summary returns the exact call to the complete retained index. Select complete
assertion, exclusions, capability and authoring facts before binding a proof.
No pagination or first-page ranking shortcut decides semantic eligibility.

A proof's authoring facts list in `save.missing_inputs` only what the author must
supply. Whether a case identity is one of them is read from the registered save
schema's own case variants, and `case_choices` carries the case owner's statement
of the two conditional inputs: `identity` (omitted for the obligation's own case;
`case.id` chooses a different or shared saved case and `case.key` labels a new
one) and `association` (the `test_execution` method an eligible claim has, the
`obligations[].case.verification` member, when it is omitted, when it is a
choice, and how an unresolved draft is reported and resolved). Neither is stated
as an unconditional missing input, and no consumer reads the method from prose.

Read the selected unit's context with `workspace_read_wiki({subject})` and follow
its coverage or obligation selection using the returned reference. Save semantic
changes with `{unit,revision,changes}` using that context's combined authoring
revision. Assessment diagnoses saved meaning without execution; verification
executes against authenticated source. These meanings have one owner each.

Assessment's shared `save_guidance.changes_schema_from` supplies a current
root or slice read and an `input_contract` selection for `save_record`. Use
that read's returned `reference` with the selection in `workspace_read_wiki`;
the compact `tools/list` declaration defers nested schemas to this route.
Case-only repair selects `obligations`; an absent requirement/verification chain
selects `requirements` and `obligations`. Definition and unresolved-meaning
corrections read the parent and select `requirements`. Reuse sufficient held
schemas. The write revision is always the current write unit's context revision,
never historical assessment evidence or its digest. Frozen and focused
assessments supply no supported save route beyond their existing authority.

When requirements were refused but criteria and proof-name obligations saved,
the compact guidance points to the missing-case diagnosis. Its selected
`save_guidance.recovery_sequence` connects the missing inputs: author faithful
parent requirements with exact source passages and independent verification
meaning, then link the affected unit's obligations through `claims` and supply
the selected provider's case fields. Use request-local labels within one save
or returned identities across saves, and read each write unit's current revision.
The sequence selects existing batch and case guidance and returns reassessment
and preview calls for the exact affected unit. It supplies no task meaning,
native binding, executable save or applicability change. Recording unresolved
meaning preserves it but leaves the specification incomplete and does not clear
the controlled-acceptance blocker; bare unresolved text creates no source link.

Proof authoring recovery checks the receiving session's actual registered
reader schema. An entitled unit-context read is offered unchanged; a frozen
assignment observation cannot substitute for saved authoring context, and a
reference is usable only when its owner returned it. If the role cannot acquire
that context, recovery reports
`verify_proof.authoring_acquisition_unavailable.v1`, the missing
`read_saved_proof_authoring_context` capability, requested subject, saved source
identity, obligation identities and the `workspace_read_wiki` correction boundary.
Frozen review-source observation also supplies no current authoring correction.
The current reader has no focused authoring selection. A new acquisition or
authority grant requires an operator decision. The original proof diagnosis and
competing verification identities remain evidence; unavailable acquisition
executes no proof and performs no authoring mutation.

Discovery ranks candidates by the property the query describes. Query terms are
normalized words; each matched term contributes, once per source kind that
contains it, that kind's weight times its inverse document frequency among the
admitted candidates for that kind. Assertions, intent definitions and
constraints weigh 2, proof names, intent identities and discovery terms weigh
1, and exclusions weigh 0. A term every candidate carries at one kind, such as
shared constraint grammar, contributes nothing there. Candidates are ordered by
match tier, then relevance score, then identity; the package result reports
each candidate's score, matched, unmatched and semantic terms, and every match
reason.

A registered identity term of a listed test provider family (a language,
toolchain, runner, ecosystem or family name) is provider context, not
relevance. Both the query and the registered term are normalized by the same
owner, and a term is recognized where its tokens occur contiguously and in
order in the query, so a multiword registered spelling such as `node:test`,
`node-test` or `go test` names its family. Scanning left to right, the longest
registered term at each position is taken, so a generic constituent (`node`)
never displaces the exact identity it belongs to; reordered words or a
lookalike (`nodetest`) are not that identity. Only the recognized occurrence is
provider context: it is reported in `provider_context` and
`ranking.provider_terms` and never changes the order, so one property phrased
for Go, Rust, JavaScript or no provider ranks identically, while the same word
occurring elsewhere in the query (the second `test` in `node:test selected
test`) stays a property word. `provider_context` is `identified` when the terms
fit one family, `ambiguous` for several (`node` alone), `conflicting` for none,
and `unspecified` when no such term appears. Unrecognized words stay ordinary
query text and are never treated as an unsupported provider. A query with only
provider terms matches no proof. Recognition says which family the query
names; it is not availability, executability or proof sufficiency.

`workspace_find_proofs` accepts an optional `query`. With one, it retains the
package's complete ranked matches and returns every match, once, grouped by
match tier in rank order; without one, it returns every listed proof of the
catalogue, once, in the catalogue owner's order. A query never appends
unmatched proofs, and zero lexical matches is not proof absence. The answer is
complete or it is a bounded summary, never a partial list: a catalogue or index
wider than the selected-response compact class,
`min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, active inline limit)`
(currently at most 8192 UTF-8 bytes across both MCP carriers), is answered
with exact counts and the one call that returns the complete retained
catalogue or index in one answer. There is no page, cursor, continuation or
remaining count, and no proof has to be read to follow one already listed.

A complete catalogue or index names each proof and carries its short
description; it carries no proof's assertion, exclusions, parameter contracts
or definition digests. `population` distinguishes query matches from the
listed catalogue, and `meaning` states that no proof is selected. Lexical overlap
establishes neither applicability nor requirement satisfaction.

On a nonempty catalogue or match index, `next_calls.select` is an incomplete
call form: `tool` names `workspace_find_proofs`, `executable: false` distinguishes
it from a concrete call, `known_arguments` preserves the returned `result`, and
`missing_caller_input: ["selection.proof_name"]` requires the caller's choice.
It contains no executable `arguments` and names no default proof. Choose an
identity from the complete returned population, copy `known_arguments` unchanged,
and add `selection: {proof_name: chosenProofName}` to compose the retained-selection
request. Here `chosenProofName` denotes the caller's chosen listed identity,
not a literal argument or a placeholder to execute. An optional later part goes
inside `selection.part`. No-match answers offer no proof-selection form. They offer an exact browse
call and incomplete refine/name forms, preserving explicit target-family context.
An unknown-name refusal carries the same alternatives beside the rejected name.
An empty catalogue explicitly states that it lists no proofs. No branch invents
a property, selects a nearby proof or recommends an exception.

A selected proof defaults to its `overview`; authoring is never added just
because it fits the delivery limit. The overview offers its exact retained
authoring call. Named parameter/constraint alternatives are incomplete forms
with `known_arguments` and `missing_caller_input`; fill the named member from
the proof's returned index, preserving the result and selected proof. No first
parameter or constraint is chosen. Parameter answers offer exact calls for each
applicable constraint; a constraint answer can finish without another read.
The `overview` carries the catalogue’s
`short_description` and required `usage`: concrete prerequisites, one illustrative
fit and why, and one nearby misuse and its specific boundary. These inline
scenarios distinguish insufficient evidence, false propositions, excluded
behavior and unsupported mechanism shapes; an excluded conclusion need not cause
evaluator refusal, and a fit does not establish applicability to the caller’s
source. The overview also carries the complete admitted assertion, exclusions,
intent comparisons, parameter index, constraint
count and the constraint selectors no parameter names, its observations, and
`verification_capability`: the fact a caller selects a usable proof by, null
when the proof declares no test execution. The overview and the bounded proof
summary carry no constructor, resolver or evaluation inventory and no
admission, profile, parameter-contract or vocabulary digest. Saved pin
correctness is the save owner's: the unit's `workspace_read_wiki` selection
`{obligation, parameters: true}` reports the saved pin as current, unselected,
unpinned or stale with its reason, and a save with `proof.refresh` re-pins it.
For a stale closure spanning the parent and slices, read the root WK's current
revision and call `save_record({unit: "WK-…", revision, changes: {refresh_proofs: true}})`.
Recovery keeps that root read executable. Its subsequent `then` form is
explicitly `executable:false`, with `known_arguments` containing the root unit
and sole refresh change, and `missing_caller_input:["revision"]`. Copy those
known arguments and add the revision returned by the root read before submitting;
the incomplete form supplies no executable save or placeholder revision.
This root-only change must be sent alone. It refreshes saved pin metadata across
every current slice, including done slices, at each selected exact name/version.
It preserves requirements, parameters, cases, associations and historical
execution evidence, creates no absent source and selects or executes no proof.
Unavailable exact definitions or incompatible unchanged inputs refuse the whole
refresh with affected unit/obligation identities. Diagnostic reads do not repair
authored inputs; cross-unit authored correction is unavailable through refresh.
The existing exact-definition loader remains authoritative for availability.
Retired selections refuse the whole refresh with
`proof_pack_exact_version_not_current`, without writes or automatic upgrades.
An already-current closure returns `no_op` only after the same revision, source
lease and definition fences. `refresh` counts and membership describe the full
inspection; changed units remain owned by `effects.semantic_sources_written`.
Oversized detail uses the existing retained-result read.
A parameter part keeps its value kind, accepted value schema, source policy,
complete admitted refinements and constraint selectors; a constraint part is
the admitted constraint itself. Fresh and retained selections return the same
complete parts, and a retained read ranks, loads and executes nothing again.

Four facts stay separate, and the response never collapses them:

- **Query recognition.** A query that unambiguously identifies one family selects
  that authoring context without choosing a proof or authorizing execution.
  Explicit `target_family` wins over contradictory query wording; an observation
  explains that conflict. Routine selection-origin bookkeeping is omitted.
  Ambiguous/conflicting queries select no family and expose the ambiguity and
  meaningful family choices. When no family is named or explicitly selected,
  an index makes no family claim.
- **Catalog listing.** Missing-family authoring choices come from the provider
  catalogue, restricted to recognized alternatives for an ambiguous query.
  Each lists `family_id`, runner, source suffixes and authored selector fields,
  with an exact fresh read. These distinguish formats, not environment support.
  A selected family's complete target/provider and falsification facts remain
  inline only in its authoring answer. Path/field patterns, required/forbidden
  strategy fields, target constraints and supported/rejected examples retain
  their owner. No mechanism label or derived-field inventory is authored.
- **Proof applicability.** Provider facts appear only where a candidate declares
  a test-execution verification capability, published per row as
  `verification_capability` and taken from that proof's own admitted profile —
  never from a proof name or a language. A proof declaring no such capability gains no case-authoring requirement.
- **Target support.** `not_established` repeats the authoring owner's own
  support states: a lexical match is not a capability fact, a listed family
  is not a target fact, and test existence and falsifier target shape are
  checked only when `verify_proof` runs.

A selected proof that declares a verification capability carries, in its
`authoring` part, that a case is required only for execution, the selected family's provider,
target and falsification facts with the `target_constraint` its strategies
mutate under (production code is never reshaped to fit it), the save changes
the answer establishes and every input that remains the caller's for a new
complete selection. `save.missing_inputs` derives required configurable
`proof.parameters` members from retained source policies and cardinalities;
optional, canonical and derived values are not requested, parameter parts still
own their schemas, and test-validity’s component/suite stay case-derived.
Discovery does not inspect an existing unit for missing values, and incomplete
drafts remain savable. Prefix-safety’s captured DAG, integration partition,
path/branch sources and exact derived census are prerequisites, not invented
parameters or a promise of an available preparation route. Its calls
read only its own retained result. A proof that declares no such capability
states `case: none`, lists no case input or family, and makes no claim either
way.

Selected proof detail preserves the admitted assertion and exclusion rows, then
appends each associated intent's existing distinction as
`{comparison: {intent_id, from_intent_id, explanation}}`. These source-exact
comparison rows are usage guidance, not additional admitted guarantees. A
candidate's detail is what a caller reads before binding it: a row is a
lexical candidate, not a selection. Direct `proof_name` lookup and row-emitted
detail actions expose the same exact detail population under the same
complete-frame class; a part wider than that class is delivered whole through
the selected-full class, so long explanations and constraints arrive complete
in one answer.

Proof-discovery responses expose the result handle for retained selections and
proof name/version to distinguish meaning. Source scope and currentness remain
available for judging historical reads; composite source fingerprints and routine
retention/effect bookkeeping remain internal. Global save-schema member inventories
are not repeated in proof authoring. Reuse held coherent save grammar or acquire
it through the existing current authoring context and selected input-contract read.
The save checklist is explicitly `executable:false`: it states only established
changes, missing caller inputs and conditional execution-case inputs, not a call.

## Ordinary authoring

Read the unit's compact context and its returned complete contract selection.
The selected contract contains requirements, deduplicated references, every linked
verification, cases and obligation selections. It supplies meaning, while the
unit context supplies the current combined authoring revision for `save_record`.

A save's closed `changes` can combine record fields, semantic requirements,
obligations, cases and controlled-acceptance posture. New members use caller-local
keys; existing members use returned identities. The server resolves those keys,
compiles native meaning and applies the existing transaction under one source
lease. Caller input is not a carrier, proof graph, bundle, plan or execution
observation. Follow the advertised kind-specific schema and returned corrections.

Incomplete cases remain valid drafts. Assessment reports missing runtime meaning
without inventing a target. Selecting a named proof does not establish the saved
case's runtime support. Requirement meaning, proof applicability, native target
resolution and execution success remain distinct. Proof posture exemptions need
the existing applicability and rationale checks; small scope does not invent one.

A verification identity belongs to one saved case. A conflicting new case leaves
all saved meaning intact and reports the verification, known saved case IDs,
requested case IDs and affected obligations. Its current `save_record` correction
templates carry the selected unit and revision, and disclose the remaining caller
choices. For the same test, explicitly resubmit the obligation's authored key or
saved id, meaning and claims with `case:{id:<saved-case-id>}`. This associates only
that selected unit's obligation; it does not change the shared case or sibling uses.
An ineligible explicit case association offers the current `workspace_read_wiki`
unit context and `save_record` template. Correct the obligation's `claims` or the
selection; `case.verification` is omitted to keep a saved selection or adopt a
sole eligible one, and `case:{id}` is supplied only to choose a different or
shared saved case. An omitted association with none or several eligible
verifications is not refused: the save commits, and the assessment's selected
diagnosis lists the candidates and the one choice that remains.

When several amended unbound cases propose the same sole verification, the save
adopts none of them, independently of request order. Its follow-up observation
and targeted assessment identify the shared verification and the complete
current competing case, obligation and unit population. The whole-unit observation
exposes this independently as `unbound_case_recovery`. Unbound products are
not existing owners. The verification can still be explicitly selected for one
case; current assessment does not reconstruct historical save intent.

For different tests, follow the existing additional-verification guidance and
complete requirement schema, author distinct verification meanings, then
explicitly associate each case. A grouped requirement stays grouped; additional
verifications of the same row use successive saves at current revisions.
For genuinely shared evidence, explicitly associate one case and reuse it only
where that test establishes the intended behaviors. Preserve original requirement
meanings, source links and intended evidence mappings. Never replace unrelated
claims with a successful case's claim to clear validation. Reading guidance
chooses nothing, writes no authored state and executes no proof or proof credit.

For a genuinely different test, resubmit the unchanged requirement meaning in
`changes.requirements` without `id`, with distinct verification meaning and a
`verification.key`. The returned `bindings.verification` supplies the identity to
link in the different obligation's `claims` and `case.verification`. The existing
requirement, verification and case keep their meaning. These templates require
authored choices and are not executable until those values are supplied. Removing
an obligation does not delete its case. No correction deletes, reassigns or reuses
a case automatically.

## Query and restart

`workspace_read_wiki` selects the authenticated workspace, worker assignment or
frozen findings source through the existing query owner. Complete selections
retain every applicable requirement/reference/case population. Known returned
resources are source-bound; current reads report current facts while original
references preserve their authenticated observation. A restart does not execute,
refresh proof pins or rewrite canonical state.

For saved meaning, start with `{contract:"requirements",view:"summary"}` using
that unit's returned reference. Ordinary context offers it in `next_calls` as
optional `saved_requirements_summary` inspection. Requirements-focused editing
retains this inspection there; notes-only editing does not recommend it.
The summary reports compilation/definition state and exact row and unresolved
counts, without row previews. Its `selection_context` declares a requirements
`choices` template: reuse the reference and select and supply the caller's own
nonblank `query`. Concrete optional detail calls remain in `next_calls`.
For dependent authoring, use the save receipt's keyed issued bindings and current
revision directly. When saved-row information is missing, the optional
`requirement_identities` call selects
`{contract:"requirements",view:"identities"}` and returns the complete
authorized row/claim inventory, including grouped rows, verification associations
and collection identities, without full authored meaning or generated compilation.
Saved receipts retain all issued requirement/verification key bindings and row
mappings even when assessment/maintenance detail is compacted. Their identity
inspection can select this same view. An inventory cannot reconstruct lost
caller-local keys by row order. Use a row's `row_id` to restate the whole
authored row and its individual `claim_ids` for claim associations; they are
different identities. Reuse a held current revision; reacquire context when
freshness is no longer established or a stale write is refused. Retained
identities and historical observations do not establish
current source availability or authorize stale revisions.
Unknown saved-row refusals recommend that same focused identity selection;
schema guidance remains available without substituting for the issued IDs.
`view:"choices",query:<caller words>` returns every matching row in source order.
Each whitespace-separated term matches literally, ignoring case, within a scalar
of that row's own authored statement; terms may match different values and
punctuation is literal.
Metadata, rendered vocabulary and transitive definitions are not searched.
The response preserves the query, matching rule and exact population/match counts.
No lexical match offers query refinement and an explicit complete-inventory call;
it establishes no applicability and remains distinct from an absent source, an
empty present population or unavailable source. Omitting `query` explicitly
selects the complete choice inventory.
Choices distinguish rows using the exact structured
`authored_statement`, source state and any pending input. They carry authored
subjects, modalities, normative relations/operands and applicability metadata,
without rendered vocabulary or definition expansions. A defining row retains
`definition:true` and marks its defining value as `definition_body:"selected_row"`;
the complete defining body stays in the selected row. Identical public descriptions
remain separate rows with `choice_state:"ambiguous"`; the reader invents no
distinction or slice applicability. Existing row/verification/dependency selection
bindings retain their exact identities.
`view:"row",row_id:<returned row id>` reads one complete saved row;
its emitted `view:"verifications",row_id:<same row id>` call reads all linked
native verification meanings, requirement-to-verification identities and the
referenced entities needed to restate them. It uses the existing verification
projection, including declared runtime-test boundaries and falsifiers, without
the full requirement population or generated compilation. Both reads are
complete selections subject to the existing delivery bound; neither truncates
required meaning or executes proof.
`view:"dependencies",row_id:<returned row id>` reads its transitive definition
context, including lexical scopes, from the descriptions owner's root graph.
`view:"compiled"` explicitly reads generated CEL and bindings; `view:"unresolved"`
reads the complete saved unresolved population. Omit the modifier for the full
requirements population and row inventory. Modifiers apply only to requirements;
row, verification and dependency views require a row id, and other views forbid it.
Only choices accepts `query`; blank, non-string and wrong-view queries refuse
without becoming implicit inventories. Queries issue no write revision. Every view
keeps the existing authenticated unit, worker assignment, frozen source and
source-currentness bounds. A row outside that population is refused.

## Validation and correction

Use `workspace_assess_contract` for authored validity, stale definition pins,
requirements, obligation coverage and route diagnosis. It reuses the assessment
owner used by save and creation. It runs no proof provider and grants no dispatch
or integration authority. Follow exact selected correction calls; after a save,
read the current combined revision before another mutation. Stale or malformed
saves preserve the publisher's native atomicity and certainty facts.

Specification meaning is assessed even before obligations are saved. Its existing
`specification` status and definition/source/lowering facts remain independent
of missing obligations, proof selection and `authored.status`. Missing contracts
are `not_assessed`. Missing definitions, unresolved authored meaning, unavailable
canonical sources and engine failures retain their distinct causes. Compact
issues carry unresolved identity, location and authored reason when it fits;
omitted causes are counted, and the retained original offers the complete,
revision-bound diagnosis and addressed authoring correction. No assessment
executes or credits a proof.

Obligation statements must be trimmed single-line strings: surrounding whitespace,
CR and LF are the atomicity conditions. Refusals name each failing condition,
its statement location and the correction to author a faithful trimmed single-line
obligation while preserving `user_requirements` and exact source links. Sentence
count and punctuation impose no additional restriction.

Assessment corrections use the host selection captured by the serving registration.
Saved requirements and diagnostic facts remain readable when compilation is
unavailable, but that session receives no compilation schema, correction shape
or grammar-authoring call. Required meaning and applicability remain unchanged;
an unavailable operation establishes no operator repair or exemption.

A provider-resolution failure of a derived native test binding
(`obligation_coverage_native_binding_provider_unresolved`) is reported as
observed. In its selected diagnosis each subject names the obligation and case,
the provider owner's original code as `owner_code`, and `owner_diagnostics`: the
owner's own bounded diagnostics with `total_count`, `omitted_count`, `truncated`
and, for every returned row, its `code`, the failing member as `pointer`, and the
`expected_identity` and `actual_identity` compared there. Every mismatch the
owner returned is listed, so a binding refused on several members shows each
one; no other owner detail, message or log is published. The code declares no
recovery: `recovery.actor_recovery` is `none`, `instructions` and the correction
call are null, and the explanation states the failure, the owner's code and that
the diagnosis establishes no supported recovery. That is not a statement that an
operator can clear it or that authoring cannot, and no correction, replacement
strategy, execution or proof credit is inferred from it. A derived binding
refused for the authored case's own unfinished content
(`obligation_coverage_native_binding_case_incomplete`) keeps its `failed_fields`,
correction clauses and addressed correction call.

## Removal and shared meaning

Removal is an explicit save change in the owner's closed removal vocabulary.
Removing a proof selection preserves the obligation for reselection; removing an
obligation removes that row. Shared case definitions, sibling uses, requirements
and historical evidence retain their existing owners and protections.

## Verification

`verify_proof` consumes the same saved map used by query and
validation. It resolves the exact candidate identity before execution and binds
the result to:

- the requested proof subject and, when supplied, its explicit
  `source: {unit, focus?}` selection;
- the canonical saved source (its selected unit and focus) and case revision;
- the resolved proof definition;
- the exact candidate commit and source snapshot;
- the invoked provider and its truthful outcome.

Each requested proof, obligation relationship and the aggregate is `proven`,
`unproven` or reason-coded `not_executable`, for the requested proofs against
the tested source only. The result presents two evidence dimensions beside that
verdict. `selected_test` and `selected_status` in the compact result and
`test_observation` in full evidence report which test ran and what it did
(`passed`, `failed`, `skipped`, or `not_observed` when no selected-test event
was recorded); `mutation_evidence` reports per-member falsification for that
same proof. A detected mutation adds falsification evidence and a surviving
supported mutation is counterevidence that makes the proof `unproven`.
Unavailable mutation is a capability limitation that neither earns nor
withholds credit: a passing selected test whose other required checks hold is
`proven` with that limitation, and the limitation never excuses a survivor
elsewhere. Incomplete or unevaluable mutation evidence for a passing candidate
is `not_executable` with its reason codes. Failed test execution is separate
from all three and retains its reason and diagnostics. Compact rows carry the
actual evaluator diagnostic codes and a recovery only where a correction is
known; the complete evidence retrieval preserves the original observations,
outcomes, limitations, relationships, and evaluator diagnostics. Selected
`check_limitations` preserves each original check, code and reason, names its
strategy and source when the retained result establishes them, explains known
incompatible shapes, and states that the result supplies no retry, waiver or
production-code repair. It does not infer a function name the result lacks or
runner-wide absence from a component descriptor. See
[test-proof runtime identity](test-proof-results.md#capability-limitations).

An ID saved in more than one source refuses and lists every authorized source
as a ready retry call; the explicit `source` selects exactly one of them and
never searches another. See the
[operation reference](mcp-operation-reference.md) for the request forms.

Ordinary verification does not require preparation, a skeleton, a plan, a
carrier, publication, or prior validation. Missing source or capability facts
produce a nonexecution result. Authoring and validation remain nonexecuting.

## Closed grammar and declared objects

The controlled grammar is closed. Within a declared subject, relation and
applicability context, undeclared behavior and values are forbidden. Closure
is part of the specification's meaning; authors do not add `only` or list
every forbidden alternative to obtain it.

Current authoring admits exactly `MUST`, `MUST_NOT` and `MAY`. `SHOULD` and
`SHOULD_NOT` are refused with the accepted values; neither is converted.
`MUST_NOT` is an explicit prohibition, with its existing positive falsifier.
Modality determines whether declared behavior is required or permitted:

- `MUST returns x` requires the declared return whenever its applicability
  holds. With no declared alternative, the result is x: neither y nor x plus y.
- `MAY returns x` permits that return without requiring it. It allows optional
  occurrence; it neither requires occasional occurrence nor permits an
  undeclared y.
- A condition explicitly limits applicability. It does not turn `MUST` into
  `MAY` within that condition. One conforming observation does not establish
  that every applicable invocation conforms.

For typed values, a conditional positive row contributes permission only while
active. `MUST_NOT` prohibits a value and supplies no positive permitted domain;
a negative-only declaration does not permit its complement. For example, an
empty-search rule requiring “No results” alone does not authorize “3 results
found” for a nonempty search. State the intended complementary behavior or keep
that source decision unresolved. Missing meaning does not justify arbitrary
outputs or a blanket permission.

The closure governs the identified subject, relation and context. An incomplete
description does not create an open permission: retain its missing meaning as
unresolved, rather than guessing the boundary or granting completeness.

A referenced object such as `correct-result` must resolve to a described object:
either an existing code-bound object identified through explicit code references
(including SCIP where available), or an object defined in the specification
through the existing grammar. The name identifies that object; it does not
define its properties or behavior. A type-only declaration or a bare symbol
name does not supply the missing description.

Preserve the existing controlled grammar and compiler. Authors express meaning
through that grammar; generated CEL is compiler output, not a directly authored
replacement. A schema, generated definition or compiler mapping that admits
undeclared alternatives is an enforcement discrepancy, not permission to weaken
the specification or introduce another grammar. Unrepresented meaning remains explicitly incomplete.

Typed selections compose recursively: a map key or list index may itself select
a value. The selected key must retain the map's exact scalar key type; a list
index must be provably `int`; mixed unions and dynamic types do not narrow
implicitly to integer indexes. Computed integer selectors remain supported. Missing keys and out-of-range indexes remain absent,
separate from present null. Invalid selectors return addressed diagnostics.
Missing operative operands, collection domains and lexical comprehension bodies
name the exact referent, active scope, constraint and nested use path; dependent failures retain their original cause. Independently resolved
rows remain identifiable while whole compilation withholds conformance.

`value:contains` takes string haystack and needle operands and defines a Boolean
subject using CEL's exact case-sensitive substring operation, including its
empty-needle behavior. It applies no Unicode normalization. `value:equal_to`
compares two compatible declared value types and defines a Boolean subject using
the same typed equality as value equations: complete structures, ordered lists
with repeated elements, typed map keys and optional-field presence. It performs
no numeric coercion: int `3` differs from double `3.0`. This is a local
application restriction, distinct from upstream CEL heterogeneous numeric
equality. Required missing operands or captures cannot establish
equality. `value:equals` continues to equate its subject with its one operand.
Their selected relation definitions link the pinned CEL source separately from
these local application constraints.

The selected `compact_record_comparison` example uses before-entry and
after-settlement snapshots of the same record at one edit occurrence. Its
observer must supply exactly the protected-field projection; a typed record
does not extract those fields from a larger object. Authors can instead use
supported field paths into their actual captured root. Changes outside the
projection are allowed by that invariant. Missing required observations never
establish compliance, and equality at settlement does not prohibit transient
UI editing followed by restoration. Any intended UI prohibition needs its own
specified observation boundary.

The example's returned calls select `independent_expected` and
`conditional_boundary` beneath that same guidance path. The former compares an
actual reply with configuration captured independently for the same occurrence;
copying the reply into the expected observation is not an independent check.
CEL evaluates supplied facts: it authenticates no observer and executes no saved
verification declaration.

The conditional example exercises both branches. `choose(condition, predicate,
true)` expresses a one-way predicate whose false-condition branch remains
unconstrained by that predicate. It neither changes closed permissions nor
completes an otherwise unresolved behavioral specification. It is not an
automatic repair for a conditional positive row, and an empty-search rule still
does not authorize arbitrary nonempty-search messages. Retain missing source
decisions as unresolved; do not invent complementary behavior or blanket `MAY`
permissions. A separately labelled bounded fragment can be evaluated without
transferring its conformance or completeness to the unresolved original.

The public requirements array describes its eight-row bound per request beside
`maxItems`: subsequent `save_record` saves append new rows and retain omitted
existing rows. Creation supplies initial rows; additions use subsequent saves.
The limit bounds one `save_record` requirement batch. Larger persisted
specifications use successive batches against the returned unit revision, sharing
definitions and exact source passage and occurrence links. Read selected
requirements and assessment after saving, including after restart. A refused
later batch leaves earlier saved state unchanged. The experimental local
`author()` route evaluates one whole document; it cannot append a document.

## Internal owners

Carrier compilation, requirement compilation, proof-posture disposition,
generation persistence, assessment, graph integrity, semantic projection, and
runtime evaluation may remain internal when retained consumers use them.
Internal module names do not create public endpoints or caller-authored
construction steps.

The canonical-specification compiler is package code in
`@agent-chassis/controlled-contract`. Four modules own it, each published
under its own package export. They start no subprocess and perform no I/O
beyond the package's load-time reads of its four schema files
(`controlled-acceptance-contract.v1.schema.json`,
`controlled-acceptance-test-proof-definitions.v1.schema.json`,
`controlled-acceptance-requirement-definitions.v1.schema.json` and
`controlled-acceptance-proposition-definitions.v1.schema.json` and
`controlled-acceptance-value-definitions.v1.schema.json`), which the
stable contract schema is composed from when `cel-lowering` is loaded:

| Export | Owns |
| --- | --- |
| `canonical-specification` | One constraint per complete statement or closed membership, its identity (a digest of the work unit and the constraint), its rendering, canonical collections (a closed set sorted, an ordered sequence as given), and the compiled specification. |
| `cel-lowering` | The generated CEL predicate of each constraint, closed conformance and admissibility (`cel.recommended` remains null), the typed input bindings, and the input contract. Every lowering rule is derived from what the controlled vocabulary declares of a relation; a relation with no rule is returned as a named gap. |
| `closed-membership` | Clause validity, required and permitted members, and the conformity expression of a closed MUST/MAY membership, in which every unlisted member is forbidden. |
| `cel-observation-model` | The CEL language reference and the type and meaning of the population-member observation. |

Their import closure is published package code only: the controlled
vocabulary, the mandatory-modality list, the equality normalization with the
deterministic projection primitives it canonicalizes by, and the stable
contract schema with the test-proof provider registry and provider modules
its composition is checked against. They import no comparison, catalog, authoring-state,
evaluator or test code.

The separate `@agent-chassis/controlled-contract/cel-definition-reference`
export owns documentation loading. `celDefinitionIndex()` returns a compact
catalogue; `selectCelDefinition(['operations', 'cel.in'])` reads one exact CEL
definition, and `selectCelDefinition(['relations', 'reference:supports'])`
reads one local application relation. Selected upstream reads return structured
operation identifiers and signatures, literal source text, prerequisite
selections, immutable source URLs, byte and line ranges, SHA-256 digests,
versions, commits and license provenance. Unknown selections raise
`cel_definition_selection_not_found` with the missing selection and the exact
package index call for recovery. Source or section corruption fails explicitly;
it never substitutes another reference.

Importing this owner or the requirement authoring schema generates no lowering
examples. The first index or local-relation request synchronously generates the
complete inventory through the existing `loweringInventory()` owner. The
requirement guidance's `cel_definitions` member requests that index when read.
Each module instance caches only successful generation; requested generation
failures propagate and leave later explicit requests able to retry. Returned
objects are isolated from later reads. Upstream operation-only selections read
their pinned manifest and source sections without generating local mappings.

The unchanged bundled language definition is cel-expr/cel-spec **v0.25.2**,
commit `cb51b4176013ad19bd00df94be273c322916a620`, `doc/langdef.md`
(SHA-256 `46a377cde5a4b0fe1d3023bf7e663d91dfabf6c30868c6b5c2867e057a79ae5b`).
The unchanged extension documentation is cel-expr/cel-java **v0.14.0**,
commit `5cf3ab3c9f0a2ccb4ac449527d41689ed6aa6879`,
`extensions/src/main/java/dev/cel/extensions/README.md`
(SHA-256 `8172385b89c6fde06cb34b4cbf508ec64988e071209e6a33682824f86de6e254`).
Both Apache-2.0 licenses ship with their source. The package's
`vendor/cel-reference-sources.json` records each immutable original path,
source digest and indexed section. Its selected ranges index equality,
membership, comparisons, Boolean operations, conditional expressions,
`all`/`exists` macros, list size, numeric conversion and their semantic
prerequisites. `lists.distinct()` is a **CEL Java extension**, introduced in
extension version 2, rather than a core CEL function.

Local relations retain the exact definitions and signatures of
`CONTROLLED_VOCABULARY`. The reader derives their generated predicates,
observation types and input contracts from `loweringInventory()`; operation
links are indexed from those generated examples. Selected reads distinguish
the predicate's observations from the observations read by its input-contract
examples, including mirrored subjects needed to illustrate cross-subject laws.
Examples describe the compiler's sample scope; they require no observations of
subjects a compiled specification does not read. Lowering `reference:supports`
to list membership does not define the business meaning of supporting evidence
in CEL. The `number:returns` relation describes a singular result, observed as a
`list<double>` so absence and extra values remain evaluable. Applicable
`MUST returns 5` accepts only 5; `MAY returns 5` accepts absence or 5; both
reject undeclared values. Each mandatory return constrains the singular value
separately, so distinct mandatory values remain contradictory and MAY cannot
weaken MUST. Closure belongs to conformance rather than evidence admission.
Permissions use their actual applicability, not an inactive obligation's
vacuously true implication. Whole conformance requires known condition bindings.
Set-valued relations, described returned collections, numeric ranges, population
completeness and equality/algebraic laws retain their existing owners.
`boolean:deterministic` consumes a supplied Boolean observation and establishes
no independent proof of determinism. Observations must carry the locally
defined meaning; this facility acquires and evaluates none.

Requirement authoring exposes the same compact index as `cel_definitions`
through `workspace_read_wiki {subject:{requirement_guidance:true}}`. Using its
returned reference, select
`{guidance:['cel_definitions','operations','cel.in']}` or
`{guidance:['cel_definitions','relations','reference:supports']}`. A selected
definition returns exact prerequisite calls. A missing key reports the missing
path and the existing guidance-context recovery call. Ordinary discovery and
whole guidance carry the index only; no response embeds a complete manual.
The guidance revision includes a digest of the definition index, vocabulary
and generated inventory, binding selected reads to that content.

To update a pin, choose immutable upstream commits, copy the source and license
bytes unchanged, update the manifest's paths, digests, section ranges and
structured signatures, and update the compiler's pinned `CEL_REFERENCE`.
Validate byte integrity, linked sections, attribution, response bounds and the
offline installed-package read before landing. A reference update does not
upgrade the CEL Java runtime or change compiler semantics. The compiler loads
no documentation; the reader works offline from published package files,
without a network, Java process or additional runtime dependency.

`save_record` and work-item birth compile requirements through these modules.
`changes.requirements`, and `initial.requirements` at birth, is one batch
`{entities?, requirements?, collections?, unresolved?}`: an entity is declared
once by id and named by id, each requirement row is one statement or one
closed membership, a collection groups rows, and unresolved meaning is kept
word for word. There is no array form of the member, no public compile
operation and no member that carries an expression. The batch schema, its
admission and its normalization have one owner each in `wiki-core`
(`controlled-requirement-authoring-schema.mjs`,
`contract-requirement-normalization.mjs`), which the description-coverage
authoring prototype under
`internal/controlled-contract/description-coverage/semantic-builder/` uses as
well; the prototype keeps no copy of them or of the compiler, and its own
comparison, authoring state and CEL evaluator are not production code.

Behavioral relation availability has one positional policy owner:
`RELATION_AUTHORING_AVAILABILITY` and `relationAvailableForAuthoring()` in the
controlled-contract vocabulary module. New requirement `behavior` and
`verification.fails_when` submissions admit 66 of the underlying 93 relations.
The cutoff applies to every modality and claim nature, to `save_record` and
`workspace_create_record`, and to amendments addressed by row or claim identity.
Schema and admission refuse an unavailable relation before publication, naming
its exact authored path and rejected relation with a callable selected-contract
read for correction. The batch owner also enforces availability when preparing
submitted rows. It does not reinterpret or rewrite saved contracts.

The 12 excluded relations are `reference:supports`, `reference:uses`,
`reference:targets`, `reference:has_property`, `reference:covers`,
`reference:conforms_to`, `reference:complete_against`,
`reference:behaviorally_equivalent`, `reference:semantically_equivalent`,
`reference:conflicts_with`, `reference:matches` and `number:matches`.
The 15 unavailable pending resolved definitions are
`reference:classifies_as`, `reference:has_identity`, `reference:has_type`,
`reference:has_state`, `reference:has_status`, `reference:has_value`,
`reference:resolves_to`, `reference:completes`, `reference:invalidates`,
`reference:preserves`, `reference:replaces`,
`reference:unchanged_from_frozen_base`, `boolean:authoritative`,
`boolean:deterministic` and `boolean:immutable`.

Verification observation authoring is a separate position: `verification.observes`
retains all 93 relations, particularly `reference:covers`. The shared batch and
prototype schemas separate `behavior` from `observation`, sharing retained
signature branches and operand shapes by reference. Requirement guidance's
`vocabulary` publishes the 66 behavioral/falsification choices;
`observation_vocabulary` publishes the 93 observation choices. Their relation
groups, signatures and accounting derive from the same availability owner as
admission. `required_object_shapes.observation_statement` names the observation
vocabulary; the ordinary statement shape names the behavioral vocabulary.
The underlying relation definitions and reference reads remain available.

Relation availability and described-object completeness are separate checks.
`contract-requirement-descriptions.mjs` indexes existing references,
propositions, behavior claims and authored closed memberships by owning scope
and identity. It includes every operative defining statement and its recursive
operands and contexts. Shared dependencies appear once; cycles terminate while
missing leaves propagate to every dependent root. Name/type, prose, aliases,
verification assertions, coverage links and passing tests supply no missing
behavior. The existing population and compiler owners determine completeness;
a newly specified object need not terminate at implemented code.

Resolution is specific to the reference's use and applicability. A condition
needs a defined predicate determining whether it holds. Its generated
`holds` observation is constrained to the conjunction of its operative predicate
statements, with their actual relations,
operands and comparison; an independent flag cannot override it. The input
contract carries this consistency clause and its exact defining constraints and
reads. Disagreement is inadmissible observation evidence. Both aggregates
require the flag and predicate inputs before evaluating, including when another
clause is false or a guard is inactive; missing evidence remains not evaluated.
Missing or
ambiguous Boolean meaning receives no conformance credit. A guarded definition
cannot supply the truth needed to decide its own guard.
Existing supported Boolean and numeric comparisons and range statements supply
their existing typed observations and predicate lowering. They are usable on
specification-defined and code-backed objects; source location alone supplies no
runtime truth. Multiple contributing predicates form a compound definition,
not an ambiguity. Competing identities, ambiguous scopes and independently
authored contradictions retain their distinct outcomes.
Predicate truth is independent of the statement's
MUST, MUST_NOT or MAY force: a false predicate makes an `if` requirement inactive,
and a MAY definition does not require the predicate to be true. Independently
authored MUST/MUST_NOT statements retain their own conformance predicates,
including when their subjects are referenced as conditions. Selected compilation
retains these obligations and their recursive guards as definition context;
they do not become additional assigned objectives. Dependencies reached only
through a scoped equality retain that path's relevance in governing clauses,
extension closure and input laws. An inactive alias edge does not impose the
other subject's return closure on a selected permission. The equality still
requires matching denotations where applicable, and whole compilation retains
independent obligations on both subjects regardless of the edge's activity.
For example, MAY `range:has_range` defines the in-range predicate without
requiring it to hold; an operation guarded by `unless` that predicate applies
outside the range. MUST `range:has_range` remains an independent range obligation.
Undefined predicates and unsupported bindings remain explicitly incomplete.

A returned reference needs its defined value, structure, complete population,
callable behavior or exact value source. An existence or other Boolean property
does not define an arbitrary returned value. Reference resolution requires a
definition; authors do not add redundant `exists` clauses. An actual requirement
about existence keeps its existing Boolean predicate. Undefined meaning remains
incomplete rather than becoming false.

Definitions must cover the use's scope: unconditional definitions cover every
use, and scoped definitions match the exact equality-normalized applicability
supported by the existing owner. No entailment between different scopes is
inferred. Each shared identity is delivered once, with separate resolution facts
for its uses and scopes. All operative statements and qualifiers remain in
canonical/readback data. A qualifier without a compiler mapping is explicitly
unresolved and withholds whole conformance.

`contract-requirement-description-sources.mjs` uses the existing committed-source,
published-snapshot and symbol owners. Repository/path/symbol is the minimum
explicit identity; `scip_symbol` is optional and used when available. Non-SCIP
resolution parses declarations in exact committed source, retaining missing,
ambiguous and unsupported outcomes. It is not a bare-name existence check.
An available supplied SCIP identity must agree with the defining declaration;
external symbol information without definition source is insufficient. Successful
exact committed file or declaration resolution supplies the `identity` meaning
required by typed observation references. A working-tree-only declaration supplies
no committed identity. This identifies the source reference; it supplies no
Boolean condition truth, arbitrary runtime value, behavioral satisfaction or
proof credit, and never executes the target.

A path describes its committed file, not an unstated value within it. Symbol
resolution supplies its actual declaration source. Configuration, state and
population types are not refused categorically: static literal value/structure
and collection definitions can supply those respective meanings; callable
definitions supply callable meaning. Unsupported computed value/population
bindings still need operative specification definitions. Resolving source
does not establish implementation conformance.

Source preparation follows the same transitive description dependencies as
compilation, save/birth and selected readback, including stored/native defining
statements and shared definitions changed by a correction or retirement.
Unrelated verification references do not trigger source resolution. An edit
prepares affected roots and dependencies; selected reads prepare their selected
roots and dependencies. Neither represents that scope as whole-contract
completeness; unresolved descriptions remain saveable and explicit.

Preparation captures one concrete committed tree and, only when SCIP is used,
one published index snapshot. Plain files and non-SCIP names require no index.
The description route neither requests nor joins an index build. An older
publication retains its own provenance and can be used when the relevant
defining source is demonstrated unchanged; a changed file is checked against
its exact declaration rather than accepting stale line positions. Missing,
ambiguous, unavailable and stale-source outcomes keep distinct recovery routes.
Publication rechecks the definitions and dependencies actually used through
`record-authoring-plan.mjs`'s prepublication `assertDefinitions` hook. Read
composition uses that same adapter and exposes both committed-source and index
generations beside the derived descriptions. Unrelated commits or index
republications do not invalidate unchanged relevant resolution and source;
changed, deleted or newly ambiguous definitions refuse publication. Strict
current-HEAD index operations for other consumers remain unchanged.
Source facts are ephemeral; there is no definition store
or caller-supplied resolved flag. Filesystem/index access remains outside the
pure compiler. Authoring executes no target code, observations, CEL or proofs.

Overall specification assessment combines definition resolution with the saved
unfinished meaning in `authored_requirements.unresolved`. Any such meaning keeps
the specification incomplete, including meaning deliberately recorded as a
grammar exception. An exception accounts for its author's decision; it supplies
no definition, enforcement or proof credit. `specification.definitions` retains
the selected definition state and finding count independently of overall
`authored_meaning`; lowering support and source availability retain their own
states. `unfinished_meaning` counts the owning unit's unfinished entries.

Definition assessment follows the selected obligation or slice dependency
closure. Unrelated sibling definition holes do not contaminate it. Unfinished
meaning belongs to the parent specification as a whole: the selected answer
states that broader unit qualification without inventing an obligation mapping
or a local missing operand. Each unfinished entry has its revision-bound `uN`
identity and saved location in the selected diagnosis, which retains its full
text and any recorded exception. Follow that diagnosis's current parent read
and requirement-batch guidance, author the intended typed behavior with its
source passages, and retain only the entries still unfinished in `unresolved`.
Resolving all unfinished meaning and other specification findings makes the
next assessment complete. Assessment and guidance reads author nothing;
completeness does not certify equivalence to arbitrary prose.

Completeness means complete authored meaning, not implementation conformance or
proof credit. Definition changes recompute dependent descriptions; stable
reference identity does not grant unchanged meaning or automatically rebind
cases. Changing the vocabulary
source also requires rebuilding its packaged proof-intent metadata with
`npm run build:intent-metadata` in `packages/controlled-contract`; startup
refuses stale metadata and never substitutes another catalogue.

Compact `workspace_assess_contract` responses keep diagnosis navigation separate
from issue bodies. `diagnostic_navigation.diagnoses` identifies native causes,
their owner family and category, subject counts and affected obligation IDs.
`obligations_omitted` counts any IDs beyond the preview; IDs are never shortened.
Each returned diagnosis has its exact retained read in `next_calls`.
`diagnosis_selection` counts all retained diagnoses, returned calls and omitted
calls. Admission tries representatives of independent native cause classes
before repeated causes, and skips an oversized body so smaller later issues can
still appear. An invalid obligation and unresolved definitions remain separate
facts with separate targeted reads; repairing a bad claim link establishes
nothing about the missing definitions.

When the first response cannot offer every diagnosis, its
`purpose:"diagnostic_inventory"` call selects
`{original:{source:{ref_id},view:"diagnoses"}}` on the same tool. `view` is
exclusive with nested `diagnosis_id` and `obligation_id`. This explicitly selected
view delivers the complete diagnostic-only inventory through the shared selected
transport: exact diagnosis IDs, native codes and meanings, full affected
obligation identities and counts, owner-family availability, unselectable source
findings and exact diagnosis reads. It includes no compiler output, subject
payloads or correction schemas. Unknown diagnoses in a complete inventory remain
distinct from diagnoses an unavailable owner could not observe.

Whole-unit, slice and selected-obligation assessments use the same retained
inventory projection. A selected diagnosis also offers the inventory read for
sibling causes. Originals and inventory reads authenticate the same source,
repository and role, never reassess, and report source currentness separately
from their captured facts. If retention fails, no historical read is invented;
the complete facts and native retention failure must fit or delivery refuses.
When a summary envelope alone exceeds the active bound, its refusal points to
the retained diagnostic-only inventory.

Selected definition diagnoses retain the native code and source cause, the
exact entity, affected requirement rows and claims, obligation associations,
use paths, required meaning/type and applicability. `diagnosis.subjects` retains
each obligation association through `definition_id`; `subject_definitions` holds
each equal complete set of facts once. Recovery authoring subjects reference
those same definition IDs and `corrections` IDs in their local
`correction_definitions`, which carry an addressed, non-executable correction shape and callable reads
of the relevant accepted definitions from the existing requirement-batch schema.
Follow those schema reads and supply the missing semantic inputs. For a
definition-only repair, append the missing definition rows in a subsequent
`save_record` using the current read's revision, without resending or replacing
existing operative rows. Identity corrections separately require restating the
affected rows through their addressed correction. Guidance neither repairs the
finding nor executes a proof. The complete existing-row
schema is available at `save_record_inputs.requirement_batch.schema`, and its
individual owner nodes at `save_record_inputs.requirement_batch.accepted_definitions`.
Sharing compares complete facts and complete corrections independently, including
applicability, source causes, candidates and correction addresses. Restriction to
an obligation happens before sharing: only its facts and corrections are exposed.
Returned and original subject counts count associations, not shared definitions.
Retained originals remain unchanged; rereading them is historical retrieval.

A missing committed path in the same repository, a missing source symbol, or an
ambiguous symbol with declaration candidates offers two author choices: correct
the intended existing-source identity, or declare a new specification-owned
identity and define its intended behavior. The server chooses neither intent
nor values. At the first compact assessment that delivers this identity finding,
the exact diagnosis selection precedes generic inspection calls. Its
`recovery.purpose:"definition_identity_intent"` identifies the read's recovery
purpose, and its `alternatives` disclose the existing-reference and
planned-functionality choices from the selected correction owner. Planned
functionality's selected correction says KEEP behavior, conditions, source links
and intended evidence associations; CHANGE the diagnosed identity at the listed
uses under a new entity id; SUPPLY the required typed meaning under its stated
applicability. These refer to the diagnosed entity, row/claim addresses and use
facts, not meaning inferred from prose. The planned choice's `construction_read`
first selects `["compact_record_comparison","planned_operation"]` through the
existing requirement-guidance reader. Follow its returned selection for a compact
structured-result construction: typed actual/expected captures plus a required
value relationship. The author supplies the paths, types, relationship, conditions
and source passage. A type declaration or existence assertion alone supplies no
behavioral rule. Its implementation symbol or file need not exist. Existing schema
reads remain available; the complete batch schema is not the required first step.
The construction's `preservation_read` separately offers the incumbent protected-field
pattern. Select it only for intended before/after preservation, projecting the
protected fields at the stated boundary rather than comparing a larger object.
Construction bodies stay behind selection; compact contexts and unrelated topics
carry no new example bodies. Unresolved source decisions remain incomplete and
reading, saving or evaluating these predicates grants zero implementation proof credit. The call retains
`purpose:"historical_retrieval"`: it reads the captured diagnosis, supplies no
live write revision and does not reassess current source. Full correction shapes,
examples and schemas remain behind targeted selections. A record read or full
assessment is not required to discover the choice.
Repository, snapshot, provider, non-regular-file and unsupported-reader
failures keep their source-owner recovery. Saved entity bindings are immutable: an identity change corrects the affected rows through
the existing row addressing and case rebinding mechanisms, preserving behavior,
source passages, cases, obligation associations and unrelated rows. Add applicable
definitions wherever possible. Existence assertions, arbitrary file identities,
performs and constant falsifiers cannot replace the requested missing meaning;
their legitimate meanings remain supported. Slice diagnoses address definitions
on their parent, frozen review authority supplies no authoring permission, and
historical originals supply no live write revision.

Binding refusals retain complete submitted and established type/identity facts
and affected uses. A differing identity is a binding conflict even when types
agree. Their shared, nonexecutable correction leaves the choice to the author:
intentionally reuse the saved object, or declare the intended different object
under a fresh id and correct its uses through existing row and case/obligation
amendments. Removing a differing declaration is not a neutral syntax repair.
Identical declared identities likewise establish an input collision, not equality
of intended objects. Genuine aliases may be consolidated with applicable source
and evidence mappings preserved; a mistaken identity declaration needs its
intended identity corrected while distinct uses remain distinct. Detection never
selects either intent, changes a saved binding or merges a source mapping.

What a batch stores and what a read returns have one owner,
`contract-requirement-projection.mjs`. Stored declarations plus additions and
corrections minus retirements determine prospective meaning. Selection follows
that derivation: assigned roots retain required definition/permission context,
without assigning dependency clauses as extra objectives. The compiler derives
permissions and equality from the owning specification before selecting the
conformance objectives. Unrelated siblings are excluded from selected delivery;
missing visibility, unresolved scope or delivery capacity remains explicit and
withholds whole conformance. Restart derives the same meaning from saved inputs.

The stored shape and projection preserve these rules:

- Authored rows are additive over the native claim graph, under the contract's
  optional `authored_requirements` member. A row keeps its statement as
  written with each entity bound, its exact unfinished fields, the canonical
  constraint identities and native claim identities it emits, and its optional
  source link. Native operative claims without rows participate in the same whole-specification derivation.
- A row has a durable `row_id`, kept through correction. `key` labels a new
  row, `row_id` restates a saved row as a whole, and `id` corrects one saved
  requirement claim as before. `remove.requirement_rows` removes whole rows or
  collections; `remove.requirements` retires native claims as before. A claim
  that is one of several its row emits is corrected or retired through its
  row.
- Restating a row keeps every claim both declarations emit, with its links. A
  claim only the old declaration emitted retires; a claim only the new one emits
  is new. Correction-induced retirement never authorizes deleting obligations
  or cases. A dependent use or case that still names a retiring identity refuses
  the entire save, including unrelated explicit removals, before publication.
  The refusal names affected rows, claims, verifications, obligations, cases and
  units and returns corrective reads. Nothing maps old members to new ones or
  transfers proof credit. Explicit `remove.requirements` and
  `remove.requirement_rows` retain their deliberate scope-removal semantics.
- For a single-claim correction, choose `id` instead of `row_id` and explicitly
  list retained affected cases in `rebind_case_ids` when their verification
  changes. The existing rebinding owner updates dependent links across units
  while preserving obligation and case identities. For a grouped correction,
  first save the intended replacement verification on the unchanged saved row
  using `row_id`, unchanged behavior and a request-local verification key. Use
  that saved verification binding to amend each affected unit's existing
  obligations by `id` and explicitly choose `case.verification` through its
  target's owning unit. Shared-case uses can retain both old and chosen
  verification links during these amendments; change the case selection, then
  remove changed old claim and verification links. Retry the original `row_id`
  correction and restore intended requirement associations using its saved
  claim bindings. This supports opposing corrections without publishing
  contradictory requirement rows or guessing unsaved identities. Without a
  replacement verification, explicitly clear only changed claim associations
  before correction and restore them afterwards; retained bound cases require
  an authored valid `test_execution` verification. Unchanged associations stay.
  Unchanged source links, verification definitions, case targets and other
  authored fields remain with their existing owners throughout this process.
- A complete statement emits one constraint and one native claim per object
  where its relation is a set of pairs. A closed membership emits a constraint
  and no native claim. An incomplete row (a missing modality, objects,
  applicability or entity type, or a value stated as `{"pending": true}`) emits
  neither and is saved as written. A verification or an obligation claim that
  names a row emitting no claim is refused; a row label in an obligation's
  claims is every claim the row emits.
- An independently authored verification is compiled once and verifies every
  claim its row emits. Its falsifying statement is about the requirement's
  subject as written, also where the stored statement names its two entities
  the other way round.
- Canonical constraints, renderings, generated CEL, typed bindings and the
  input contract are derived from the stored rows at save and at read by the
  same function. A row whose recorded constraint identities are not the ones
  its input compiles to is refused by name. A specification with an incomplete
  row, an incomplete collection, unresolved meaning or a statement with no
  lowering has no aggregate expression; each gap is named.
- Identities are minted in the unit's captured `{wk_id, focus}` scope, the
  native compiler's own.

Paid completeness also requires **source accounting** over the parent work item's
current saved `sections.user_requirements` and every authored row in the shared
contract. `parent_source_accounting` labels that parent population separately
from a selected slice or obligation. The owner and preview report
`measurement_performed` separately from
`accounting_status: complete | incomplete | unknown`: every non-whitespace
span needs a current formal source link or a deliberate source-bound exception.
Missing or empty source is unknown. Exact raw residual segments, including
whitespace, retain their UTF-16 positions. Overlapping intervals count once;
formal and excepted lengths are reported separately and may overlap.

Incomplete `parent_source_accounting` in validation and assessment explains the
missing current exact associations between original passages and caller-authored
requirements. Its parent context read supplies the current revision; public
assessment also promotes its source-link, row-addressing and requirement-schema
guidance reads into `next_calls`. Follow returned selections for complete guidance,
then author faithful requirements or restate saved rows with the exact passages
each represents, choosing occurrences explicitly. Preserve the original prose;
the guidance supplies no requirement meaning or blanket passage attachment.
Declaring acceptance required resolves missing applicability independently and
does not clear source accounting. Historical assessment retrieval supplies no
repair or write revision. Source association establishes neither semantic
completeness, criterion coverage, execution capability nor proof credit.
Unavailable compilation, frozen review authority and named focused contracts
retain their restrictions; assessment offers no requirement repair through an
unsupported save or a redirected root write.

The existing explicit `save_record({unit,revision,exception})` route accepts
optional `source_passages` on grammar and controlled-acceptance **apply** only:
1–64 exact `{user_requirement, user_requirement_occurrence?}` selections.
The existing literal resolver supplies the digest and offsets; callers cannot
supply them. Omission saves an unfinished accounting draft with zero exception
coverage; an explicitly empty list is invalid. Explicit exception discovery
includes the optional selections in applicable apply templates and caller inputs;
the template stays nonexecutable until authored. Selecting `members:["exception"]`
is a misuse: on a supported saved work item or slice the refusal returns the
exact `input_contract:{tool:"save_record",operation:"exception"}` read through
the same reference. Mixed members are refused intact; ordinary changes must be
selected separately. Unavailable bindings, roles and unit kinds retain their
precise refusals. Proof exceptions and withdrawals
take no passages. Grammar links persist with that saved unresolved meaning's
`grammar_exception`; whole-unit links persist in the parent
`proof_posture.controlled_contract`. Whole-unit documentation accounting needs
no CEL contract. The rationale remains caller-authored and unassessed.

When a saved applicable exception has absent or stale passage bindings and source
accounting remains incomplete, recovery names those binding gaps separately from
the saved exemption. Follow its current parent context read, then select the
supported exception operation through that context's reference. Use the returned
parent revision to reapply the existing exception with caller-selected exact
passages, preserving the saved rationale, intended scope and existing intended
bindings: reapplying replaces the passage list. Slice assessments use this same
parent route. Discovery returns recorded passage bindings for preservation.
Recovery selects no passage, supplies no rationale and does not propose expanding
the exception across remaining text. Faithful formal authoring remains available;
role, tier and focused-contract restrictions still apply.

Opting out of controlled acceptance leaves its disposition visible and still
requires source accounting for specification completeness. An exception covers only its
selected current passages. Source edits leave digest-bound links stale until
explicitly rebound. Withdrawal or retirement removes only that evidence's
contribution; other current evidence may still cover the same text. Saved
exceptions without passages receive no inferred coverage. An exception grants
no CEL enforcement or proof credit, and grammar residue remains NOT ENFORCED
and keeps authored specification completeness open. A link on an unfinished
row accounts for its source independently of the row's unresolved meaning.
Literal linkage establishes association, never semantic equivalence to prose.
Invalid quotation, occurrence or stale revision refuses the existing transaction
without partial publication. Omitting a failed link can save a draft but leaves
an accounting gap; follow the addressed parent read and author the correction.

A row may name the exact passage of the work item's `sections.user_requirements`
it represents, as `user_requirement`, with `user_requirement_occurrence` where
the passage repeats (`contract-requirement-source-links.mjs`):

- The passage is compared literally against the text the same save leaves:
  no trimming, case folding or Unicode normalization. Occurrences are counted
  from 1, left to right, overlapping occurrences included.
- A passage that occurs once is occurrence 1. One that occurs more than once
  requires the explicit occurrence. A passage that is not found, a missing
  choice or an occurrence out of range refuses the whole save with the match
  count, each match location and the correction.
- The stored link is the passage, the chosen occurrence, the source
  `{wk_id, field, digest}` and the location in UTF-16 code units. It is
  provenance: it changes no identity and no expression, and does not establish
  that the passage and the compiled meaning agree. A read reports it with every
  constraint and claim of its row.
- A link is `current` while the source text has the digest it was resolved in
  and `stale` afterwards, as saved, until the row is restated with
  `user_requirement`. Omitting the passage keeps a saved link and creates none.

For a source-passage repair, the existing requirement-authoring guidance owns
the complete-restatement procedure at
`save_record_inputs.requirement_batch.source_link.repair`. Source-link refusals
link to that selected guidance. The procedure distinguishes provenance intent
from the full row payload, identifies the saved-row and native verification
reads, and requires reporting any unavailable read before claiming a faithful
repair. `row_id` continues to replace authored meaning; omitted fields are not
a patch.

Requirement compilation and retirement (`requirements`, `remove.requirements`,
`remove.requirement_rows`, at save and at birth) require the serving host’s captured authoring capability. The session publishes only supported authoring syntax and guidance. Unavailable mutations refuse atomically with `record_authoring_operation_unavailable`; no request field grants a capability. Ordinary written requirements, criteria, scopes, validation and slices remain supported. Required controlled acceptance stays required and incomplete when compilation is unavailable; capability inspection chooses no exemption.

The `{contract: "requirements"}` selection of a unit returns its native
requirement projection and, as `authored`, the authored-row projection from
the same stored contract. A save answer states each row's `row_id`, state and
full `constraint_ids` and `claim_ids`, and names that selected read as the
exact call for what it leaves out. Saving and reading evaluate no expression
and execute no proof.

Public registration, discovery, role policy, routing metadata, and active
guidance must agree on the public population. Unknown removed names are refused
by the MCP call boundary.

## Experimental required-policy assessment

This is an experimental, in-process capability. It is disabled by default: no
registration, role policy, tool profile or public request supplies it, and
`workspace_assess_contract` neither accepts nor returns anything for it. A
caller cannot supply policies, roots or trust flags.

The private current-assessment composition accepts one trusted host dependency.
When a host passes it, the composition's carrier gains an
`experimental_required_policy` member for the same resolved source, unit and
focus. The composition passes the authoring revision its ordinary assessment
was computed at, and the policy stage is bound by the same revision owner. If
the source moved between the two stages, the member is `unavailable` with
reason `source_revision_moved` and every expectation is kept unresolved; two
revisions are never presented as one assessment. Without the dependency the
carrier is exactly the ordinary one. If the dependency fails, the member states
the failure and that the required population was not assessed; it is never
dropped.

A policy is supplied as explicit data: its identity and provenance, the exact
unit and focus it applies to, a pattern bundle in the verification-profile
grammar, the typed identity each bundle role stands for, and the claim patterns
that also require an obligation. The bundle is matched directly. It needs no
admitted proof, proof name or definition digests, and no obligation has to
select a proof.

The existing grammar is the only authoring authority. The assessment adds no
rule of its own about what a contract or a bundle may state:

- A verification claim carries one controlled falsifying proposition, which
  the native contract schema requires and the native validator checks for
  existence. A bundle's verification pattern states the falsifying proposition
  it requires, and the matcher matches an authored verification only when its
  falsifier is that one. No rule here derives or restricts a falsifier.
- `verification_falsifier_policy: "controlled_complement_per_target"` is an
  optional member of the pattern-bundle grammar. A bundle is not required to
  state it. A bundle that does state it is held to it by the profile
  validator, like any profile: a verified `MUST` behavior must then be
  falsified by its operator's controlled complement, and a bundle that is not
  is invalid, not assessed, and its whole population is kept unresolved.
- A closed population's membership is whatever the vocabulary's population
  semantics admit: `reference:contains` and `reference:member_of`, in one
  claim or several, in the exact scope or as unconditional facts, with member
  identity taken by reference-equality class.

The expected population is every pattern the bundle states, of every kind the
matcher evaluates: claims, relationships (including `depends_on` between
required claims), collections and binding constraints. It comes from the policy
alone and never shrinks to what was authored:

- An authored contract is matched by the verification-profile owner's
  experimental entry. That entry is the stable matcher with one precondition
  changed: a schema-valid contract with native structural diagnostics, including
  an empty claim population and dangling relation ends, is matched as it
  stands, and those diagnostics are returned unchanged beside the per-pattern
  results. Family identities, schemas, profile semantics, binding validity and
  resource bounds refuse as they do for stable evaluation, which is itself
  unchanged. A bundle asking for evidence, resolver facts, stable semantics or
  test validity is refused, and its whole population is kept unresolved.
- A role is bound only to a referent the authored contract declares. A policy
  naming an identity declares nothing.
- A binding follows the bundle's own role cardinality. A role bound to exactly
  one referent takes one typed identity. Every other role is a member set and
  takes an array of typed identities. `null` is unavailable meaning, for a
  whole binding or for one member of a set. An empty array is an intentional
  empty set and is refused for a role that requires a member; a set for a
  single-referent role, or a single identity for a set role, is refused.
- A member set is resolved member by member and each distinct supplied
  identity counts once, in one order. The matcher is given the members that
  resolved, and the role is bound only when all of them did: a pattern over a
  partly resolved set is `missing` when the other members are simply not
  declared and `unresolved` when one is unavailable or declared more than
  once. It is never read as the smaller set.
- Population closure and member counts are the matcher's own
  complete-population and binding-count patterns over those bindings,
  including equality aliases and membership split across claims. Their
  diagnostics are the reasons on those findings. The assessment checks no
  closure, equality or cardinality itself, and nothing reads the keys of a
  runtime object: a field population is declared membership.
- Reference equality can supply a required population's declarations. Under
  the vocabulary, `reference:equals` denotes the same controlled value and is
  applied as substitution, so a population equated with another referent is
  read together with that referent's membership and cardinality claims; four
  declared members with cardinality five become a closed population of five
  when an equated referent contains the fifth. The assessment does not
  overrule that, and does not leave it silent: each complete-population
  expectation carries `population_sources`, naming the membership and
  cardinality claims the closed-population owner combined and every other
  authored referent its scoped equality joins to the population or to a
  member. It is reporting only and changes no status.
- Each expectation is `supported`, `affected`, `missing` or `unresolved`, with
  reasons. `affected` means the declaration is matched but a native structural
  diagnostic names that definition; it is reported and never counted as
  support. A duplicated identity on a matched node, an absent binding, an
  ambiguous referent or match, a policy scoped to another unit or focus, and a
  bundle the matcher refuses all leave the affected expectations `unresolved`.
- A diagnostic that names no assessed definition changes no expectation. The
  contract's structural validity is reported separately and accurately.
- Definition coverage is complete only when the matcher's own verdict for the
  whole bundle is satisfied, every expectation is `supported` and every
  required obligation is supported. Nothing recomputes the matcher's verdict.
- Obligation support is a separate, labeled join. Obligations are saved rows
  outside the native graph, read against the matched claim by the one
  required-obligation join the required-property preview also uses.
- A selected-obligation request states no whole-unit policy completeness.

The result states definition coverage only. It is not a policy decision,
implementation satisfaction, proof execution, authorization or dispatch
admission, and nothing generated from a policy counts as authored support.
Applicability is not discovered: the host states each policy's scope.

### Prototype decision comparison

`packages/wiki-cli/scripts/required-policy-decision-prototype.mjs` is a
prototype script, not a registered operation. Its importable
`compareContractToDecision` takes a decision carrying rule references, the
resolved pattern sidecars those rules name, a separately supplied input
inventory, and a directly supplied authored contract with its obligation rows.
It resolves which rule applies to which input, hands those instances to the
assessment above, and returns one comparison result. It reads no file.
`loadDecisionPatternSidecars` and the script's command line are the file
boundary: they read each referenced sidecar from beside the decision file, and
the command line prints the same result as text or JSON.

A rule's patterns live in a sidecar: one unchanged pattern bundle in the
existing verification-profile schema, and nothing else. The rule in the
decision's `enforcement` block is a prototype reference shape,
`decision-required-patterns.prototype.v2`, that is not a canonical decision
schema. It states only what the bundle schema has no place for:

- `patterns`: the sidecar's location, relative to and inside the decision's
  directory, and its expected content digest;
- `clauses`: for every pattern in the bundle, the decision clauses that require
  it;
- `obligation_pattern_ids`: the claim patterns that also need an obligation;
- `applies_to.inventory_kind`: which supplied inventory entries the rule binds
  to.

There is one rule source. A rule that embeds patterns, or the earlier reference
shape, is refused. A sidecar that was not supplied, whose content is not the
pinned digest, or that is not a schema- and semantically valid bundle is
refused, as is a clause attributed to a pattern the bundle does not define, a
bundle pattern left without a clause, and an obligation required of anything
but one of the bundle's claim patterns. A rule is never skipped.

The result names the decision once, with its status and content identity, each
rule with its pinned sidecar, each input the rules apply to, the assessment's
totals once, the authored contract's own graph validity, and one finding for
every required item that is not supported. A finding gives the input and
interface, the unit and focus, what is expected (rendered from the bundle's
pattern data and the input's bindings), and the requiring decision, rule and
the clauses of that finding's own pattern. An obligation is required through
the claim it must name, so its finding cites that claim pattern's clauses and
names the claim pattern. `missing`, `unresolved` and structurally `affected`
findings stay distinct. An inventory binding uses the assessment's binding
contract: one typed identity for a single-referent role, an array for a
member-set role. A closed-population finding names the population and its whole
required member set, and a member-count finding names the required count and
set. `population_equalities` lists every required population the authored
contract declares through reference equality, with the equated referents, the
claims combined, the expectation's status and the requiring rule and clauses;
the text form prints each as a note.

An inventory entry may also carry two things the rules do not:

- `boundary`: the explicit facts that make the input a boundary the decision
  applies to, such as its provider and its independent consumers. They are
  echoed in the result's `boundaries` and judged nowhere.
- `unresolved_requirements`: requirements the decision places on the input
  that no rule states, because the sources leave their meaning undecided or
  because no existing controlled statement expresses it. Each names its
  requirement, the decision clauses that require it, a statement and a reason.

A decision may also state its policy, and an interface entry the facts the
policy applies to:

- `enforcement.policy`: the policy in the decision's own required-properties
  shape, and the only statement of it. `properties` declares the contract
  `reference:complete_against` each category. `structure` gives each category
  its aspects (`reference:includes`) and says what each aspect is required of
  (`reference:targets` an applies-to referent: the interface, or one kind of
  fact such as each input or each outcome), with the text of the requirement.
  The aspects the comparison applies are derived from these controlled
  statements; nothing else describes them. Data that does not hold together,
  such as a member with no stated applicability, is refused.
- an entry's `facts`: the interface's inputs, outcomes or other facts, each
  with its kind, a statement and its source.
- an entry's `coverage`: for an aspect and, where the aspect is per fact, a
  fact, exactly one of `stated_by` (the rule claim patterns that state it),
  `not_applicable` (a reason and the source that shows it) or `unresolved_as`
  (one of the entry's unresolved requirements).

The required cells are derived from the aspects and the facts alone, never
from what was authored or classified, and are returned in `policy_coverage`. A
cell is `stated`, with `support` saying whether every pattern it names and that
pattern's obligation is supported; `not_applicable`, with its reason and
source; or `unresolved`. A cell nobody classified, an exclusion without both a
reason and a source, and an aspect asked of a fact kind for which no fact was
supplied are all unresolved and are added to the unresolved requirements under
the aspect's clause. Naming a pattern says where a cell is stated; it does not
establish that the cell is stated in full.

A rule may require an existing proof instead of referencing a sidecar. Its
`required_proof` carries the proof's definition pin (`proof_name`,
`proof_version`, `profile_digest`, `parameter_contract_digest`,
`admission_digest`) and `parameters`: for each constrained parameter of the
proof's own parameter contract, either a fixed `value` or
`{ "from": "context", "key": ... }` naming one of the inventory entry's
bindings. `required_by_clauses` names the decision clauses that require it.
The proof-definition owner resolves the pin, and the admitted definition is the
rule's pattern bundle, unaltered; the decision copies none of it. A pin that is
not the admitted definition, a definition that was not resolved, and a
parameter the proof does not define are refused. A parameter the rule does not
constrain, or a key the entry does not supply, is an unknown binding: the
structure that depends on it is reported as unresolved, never as missing and
never as supported. Where the definition ties a number to the size of a member
set, the number is that size.

For each such rule and input the result's `proof_recommendations` names the
decision and its status, the clauses, the proof pin, each parameter's concrete
binding, the unknown parameters, and the proof's required structure that the
authored contract is missing, has authored without valid support, or that
cannot be resolved. Its `fit` is `partial` when any parameter is unknown: the
proof is then not offered as a complete repair, its missing items are authored
support for the bound part only, and its unresolved items are prerequisites of
the proof that the decision data does not establish, not facts to author.
Authoring the structure states it in the contract. It does not select, execute
or pass the proof, and naming the proof without authoring its structure
supplies nothing. A binding is taken from the decision data as given; the
comparison cannot tell whether it describes the interface correctly.

Every supplied inventory entry is a candidate boundary of its own unless it
says, with `part_of`, that it is a further input of another entry's interface.
A candidate that supplies no facts and no classification keeps every aspect as
a required, unresolved cell: missing data never removes a requirement.

The boundary is classified from the entry's boundary facts alone: `shared`
when it names independent consumers, `private` when it names none and gives a
reason, and otherwise `unclassified`, which is an unresolved requirement and
never an exclusion. The cells of a private boundary are not required.
Malformed policy or coverage data is refused.

Unresolved requirements are returned in every result with their clauses and
are never counted as stated, supported or missing. The result's `status` is
`complete` only when every stated requirement is supported and no requirement
is unresolved; `unresolved_requirements_remain` when everything stated is
supported and some requirement is unresolved; `incomplete` otherwise. A
completeness claim cannot exceed the established population. The command line
exits 1 for both of the last two.

A rule bundle is a supplied interpretation. Nothing derives it from a
decision's text, and the comparison establishes only that authored structure
matches it, not that the bundle states the right meaning; the result's scope
note says so. The tracked draft interpretation of the proposed shared-interface
decision for one model-endpoint usage callback
(`tests/fixtures/required-policy-dec0194-codex-usage.mjs`) keeps these apart
explicitly:

- the decision's policy as aspects quoted from its clause 2, and for every
  clause what represents it, the existing owner that enforces it, its inputs,
  what can be observed and what is left: only clause 2 is contract structure,
  and the other clauses are assessment behavior, not interface claims;
- the boundary facts and the interface's facts, as supplied;
- which requirement states which aspect-and-fact cell;
- the interface's requirements, each a behavior with its verification
  definition, verifies relationship and obligation, the source sentence it is
  read from, and what establishes that its falsifier violates it (a declared
  complement, a native contradiction, a prohibition's own act, or the two
  operators' definitions alone);
- the requirements kept unresolved, each under one disposition that is not
  interchangeable with the others: intent that is genuinely ambiguous, a limit
  of the existing grammar with the place it is fixed, or a behavior whose
  verification description is unresolved because no falsifier is established;
- the parts excluded for a reason that can be checked against documented
  behavior.

A behavior with no established falsifier stays required with its obligation,
and the fixture authors it without a verification: none is made up to obtain a
valid graph. The native validator then reports the behavior unverified, the
comparison reports it as declared but not valid support, and the verification
description it lacks stays among the unresolved requirements.

That decision's enforcement block is the policy the fixture uses: it declares
the contract complete against six categories, gives each category its aspects
and says what each aspect is required of. The fixture reads it from the
decision record and hands it to the comparison unaltered; it keeps no copy of
the aspects. The decision is proposed, and reading its data adopts nothing.
The fixture's interface requirements are authored by hand from the interface's
sources; they are not part of the decision record and are not derived from it.

The script matches and counts nothing itself, writes nothing into the authored
contract and adds no origin marker to it. The inventory and its bindings are
supplied, not discovered or authenticated. A decision that is not accepted is
read only when the caller states the draft-experiment use, and every finding
says so. Malformed decision or inventory data is refused.

The selected guidance path
`["save_record_inputs","requirement_batch","compact_record_comparison"]`
shows two typed before/after record observations, one equality and a contrary
verification. Use this compact pattern only when the protected fields share
applicability, observation boundary and comparison semantics. Capture exactly
those fields; equality of the whole object would also protect unrelated fields.
The example changes an unprotected field while preserving the protected projection.
Overview and batch guidance link the selected example without repeating it.

New rows append in successive batches. The request bound remains eight rows and
claim retirements counted together, with whole-row retirements bounded separately.
Declare entities used in the current batch. Bindings held in saved row inputs
remain reusable without redeclaration; matching declarations are accepted and
conflicts refuse. A verifier-only alias is not a saved row binding: repeat its
matching typed identity declaration in each batch that uses it, in the same
save. The native verifier reference is reused; no name registry or extra save is
involved. Preserve exact source links and all unresolved meaning when grouping.

Definition recovery preserves operative behavior, applicability, source links and intended
verification/case associations. A specification-owned entity keeps its identity;
only a diagnosed identity mistake requires identity correction. Selected recovery
routes typed result/object uses to `compact_record_comparison.planned_operation`,
Boolean condition uses to `compact_record_comparison.conditional_boundary`, and
population uses to the existing membership schema. These selections illustrate
supported inputs and relationships; authors supply their actual meaning and
capture boundaries. Preservation requires explicitly bounded before/after
observations. Types, existence and unrelated source-symbol equality supply no
missing behavioral definition. Source-symbol equality establishes only equality,
not mutation, ordering, preservation or subscription behavior.

A `restates_requirement` refusal retains every repeated constraint, authored row
and `first_stated_by` fact. Each conflict carries the stable recovery code
`state_once_or_define_distinct_behaviors` under `resubmit_corrected_batch`;
the batch projection places its shared correction in `details.recovery.corrections`
before the factual findings. Each finding references that correction by code;
headlines and findings describe identical or overlapping formal predicates and
contain no competing consolidation command. The author chooses whether genuinely
repeated meaning is stated once with all applicable source/evidence associations,
or distinct requested behaviors need their actual definitions completed through
the existing grammar. Requested clauses, source occurrences and intended evidence
mappings must survive either choice. Renaming or choosing unrelated symbols does
not repair meaning. A duplicate-encoding or batch-size refusal establishes no
unsupported concept and does not establish that every concept is expressible.
No row, requirement, passage or evidence mapping is automatically merged or
deleted. Shared binding corrections use the same projection; their full conflict
facts remain at each finding.

Native `irreflexive_proposition` diagnostics can concern any proposition.
Where candidate verification links establish an authored row and
`verification.fails_when`, `falsifier_recovery` scopes its advice and verification
guidance to those mapped `proposition_ids` only. A subject differing from itself
cannot be a contrary outcome: the author must supply a falsifier tied to required
behavior. Unmapped causes retain their native facts and identities, listed as
`unmapped_contradiction_ids`, with a neutral location limitation and no inferred
authored field. Mixed responses keep both populations distinct; no behavior-field
mapping is supplied. Native validation and the effect-free refusal are unchanged.

## Typed values and definitions in requirement batches

`save_record.changes.requirements` accepts explicit `definition:true` rows beside
normative rows. A definition names one typed value; it has no modality, nature,
applicability, verification, or normative force. It is stored in
`authored_requirements.rows` with canonical constraint identities and no claim
identities. A normative equation constrains the observed value and contributes
its existing claim and independently authored verification. It does not supply
an expected value in place of an observation. Each save remains bounded to
eight requirement rows and retirements together; larger specifications are
assembled through successive saves.

A value operand has exactly one payload: `{value:V}`, `{type:T}`, or
`{observation:O}`. A comprehension binding uses `{scope,bind}`. The native carrier
adds `kind:"value"` and carries the binding as `{kind:"value",binding:B}`.
Public batch references are entity ids, native references are issued reference
ids, and lexical locals normalize to depth and slot. The shared value schema
fragment owns these recursive shapes; the request converter preserves their
recursion and positional operand checks.
Selected `requirement_schema` reads for `existing` and `birth` publish these
meanings beside their owning fields, including recursively reached definitions.
Public local names and scope labels describe lexical lookup; native locals
describe depth and slot. The selected `cel_definitions` entries `cel.value_format`
and `cel.type_format` retain the pinned format definitions; `value:equal_to`
retains the complete-value equality definition.
Complete request discovery publishes finite local references for self-recursive
and mutually recursive value/type shapes, preserving each positional operand's
type, required arity and allowed tail. Unknown references and cycles consisting
only of references fail explicitly. Nested values still pass the authoritative
save validator; discovery does not execute or establish their meaning. Genuine
unprojected refinements and exhaustion of unrelated deep acyclic schemas remain
visible in the complete request contract.

`V` is a CEL Value literal, a typed referent, a lexical local, a typed list/map
constructor, a closed record constructor, or an ordered field/key/index
selection. Literal data uses the restricted `cel.expr.Value` ProtoJSON profile:
`int64Value` is a canonical signed decimal string, `doubleValue` is a finite
JSON number, strings are Unicode scalar sequences without normalization, and
`{nullValue:null}` is present null. Empty `listValue` and `mapValue` objects
represent empty containers. Any values admit only standard Timestamp and
Duration representations. `uint` and bytes are unsupported. Numbers are never
implicitly converted; observed int and double remain distinct, including in
nested containers and map keys. Lists preserve order and repetitions. Records
and maps sort meaning-insignificant authored fields/entries for identity and
refuse duplicate semantic keys.

`T` admits `bool`, `string`, `null_type`, `int`, `double`, `timestamp`, `duration`,
lists, typed-key maps, closed records with required/optional fields, and distinct
non-nested `one_of` alternatives. Optional absence differs from present null.
Expected output shape is a conformity predicate. A well-formed wrong output is
an evaluable violation; unavailable capture or malformed transport receives no
conformance result.

For example, these rows name a future operation's result without an
implementation symbol and constrain its exact negative result:

```json
{
  "entities": {"op":"cc:operation","call":"cc:event","out":"cc:entity"},
  "requirements": [
    {"subject":"out","definition":true,"behavior":{"relation":"value:observed_at","objects":[{"observation":{"operation":"op","occurrence":"call","root":"completion","path":[{"field":"payload"}],"type":{"record":{"fields":[{"name":"ok","type":"bool","presence":"required"},{"name":"code","type":"string","presence":"required"}]}}}}]}},
    {"subject":"out","modality":"MUST","behavior":{"relation":"value:equals","objects":[{"value":{"record":{"fields":[{"name":"ok","value":{"literal":{"boolValue":false}}},{"name":"code","value":{"literal":{"stringValue":"retry_limit_negative"}}}]}}}]}}
  ]
}
```

The example states requirement meaning; a behavior claim's independently
written verification and executable proof binding remain separate authoring
inputs. Exact user-source passage and occurrence are provenance and do not
change canonical semantic identity. Corrections use the stored row id; reads
recompute the same types, scopes, dependencies, bindings and CEL from those
rows. Selected compilation retains transitive definitions and independent
mandatory constraints on dependencies. Definitions alone grant no permission.
When a quantified row is corrected, mutation planning rederives dependent
claimless definition identities from the complete prospective lexical graph,
including nested scopes and definitions saved in earlier batches. Their row
identities, authored inputs, source passage/occurrence and collection membership
remain intact. This internal derivation does not count as submitted authoring
and does not expand the eight-row request bound. Stored identities must agree
with their incumbent meaning before planning; genuine mismatches still refuse.
Dependent normative rows must be explicitly addressed when their identities
change. Native claim correction, retirement and explicit case rebinding retain
their existing rules; definition rederivation migrates no native associations
and grants no proof credit. The prospective graph publishes in the existing
atomic save transaction, and an identical correction is a no-op.
Active positive MUST/MAY equations close a governed value's permitted domain;
inactive clauses and MUST_NOT clauses grant no permission.

## Fixed value composition and lexical domains

The registered value vocabulary declares each relation's positional payloads,
arity, type rule, allowed authoring roles and definition capability. Its fixed
relations cover typed equality, arithmetic, ordered comparisons, Boolean
composition, conditional choice, size, presence, refined type tests, code-point
substring, homogeneous numeric sum, timestamps/durations, observation selection,
and `exists_in`, `map_over`, `filter_over`. Free CEL, ASTs, caller function names,
callbacks, implicit casts and general reduce are not authored forms.

A normative row's `for_each` is an ordered list of
`{scope,domain:V,bind:{key?|index?,value}}` declarations. Map domains bind keys
and values; list domains bind indices and values, preserving duplicate-element
indices. Each domain sees only outer binders. A defining row selects one scope
with `within`; it does not restate `for_each` or become a universal requirement.
Shadowing, duplicate locals, sibling capture and forward-domain references are
refused. Scope/local alpha-renaming preserves semantic identity.
Canonical scope identity retains the declaring row's normalized meaning,
its declaration occurrence, ancestry and structural position. Distinct declarations do not
merge merely because they share a subject, position or domain. An inner
definition cannot replace a visible ancestor definition or observed value.
Selected compilation retains the structural ancestor domains and their value
dependencies without assigning unrelated assertions from the declaring row.
Governing assertions inside a comprehension also apply when its calculated
result is unused. A governing assertion without supported lowering withholds
complete compilation.

`map_over` returns a list for list and map domains. `filter_over` retains list
values or map keys. Map traversal order is unspecified. A closed membership row
uses either entity member clauses or typed domain clauses, never a mixture:
`{domain:V,modality:"MUST"|"MAY"}`. Every value in a MUST domain must occur, and
every observed value must belong to a MUST/MAY domain, with typed equality.
Order and repetition have no membership meaning. Empty domains are meaningful;
unavailable domains are not empty. Duplicate authored domain clauses refuse.
Enumeration-only diagnostic helpers report dynamic comparison as not computed
when runtime domains are unavailable.

Shared acyclic values are bound once in each lexical scope using `cel.bind`.
Generated source follows authored node, edge and literal size, without sampling
domains. Conditional choice retains inactive-branch laziness. Structural
observation type/presence guards precede use and cannot be hidden by a true
Boolean disjunct. The CEL portability minimum of 12 nested function calls is not
an authoring cap or a measured host capacity.

The generated environment declares bindings, strings, math.isFinite,
two-variable comprehensions and the admitted Kubernetes numeric-list sum
overloads. Its Type descriptors and the test transport derive from the same
observation-model owner. Source sections, licenses and hashes are selected
through `@agent-chassis/controlled-contract/cel-definition-reference`, including
Value/Type proto definitions and Kubernetes apiserver v0.34.0 sum semantics.
There is no production evaluator dependency. The test-only pinned Java consumer
uses one current Type/Value protocol and independently supplied actual values;
missing runtime, extensions, timeouts, capacity failures and truncated output
are unavailable evaluation, never successful checks.

## Occurrences, outcomes and completeness

`value:observed_at` carries operation, occurrence, root, ordered path and refined
type. Roots are `arguments`, `completion`, `settlement`, `before`, `after`,
`events`, and `timing`. `before`/`after` require snapshot subject and boundary;
other roots forbid snapshot metadata. A root binding is dynamic captured data:
the requirement does not substitute expected data or silently change roots.

Completion distinguishes normal, throw, pending and aborted. Settlement
separately distinguishes pending, fulfilled and rejected. Terminal states have
terminal timestamps; normal/throw and fulfilled/rejected explicitly state
payload presence. Events retain id, kind, raw int position and optional timestamp
within the declared occurrence and clock. Bound-event `reference:precedes` and
`reference:follows` compare positions strictly with common provenance. Equal
positions are evaluable violations. Caller relation-extension lists cannot
repair missing or mixed bound-event provenance.
Every participant is checked: binding either side requires the other side's
typed event definition and the same occurrence and ordering provenance. With
no bound participant, the existing entity relation keeps its declared meaning.

Timing declares clock, start and observed-through horizon. Supported duration
quantities use exact whole `s` or `ms`, through the shared production duration
normalizer. Deadline witnesses distinguish inclusive/exclusive endpoints, late
completion, chronology errors and insufficient horizon. Capture completeness
and clock/chronology assumptions belong to the evidence boundary; recorded
fixtures establish expression meaning, not all real effects or a production
collector. Generation, evaluator availability, capture completeness, execution
readiness and satisfaction remain separate facts. Unresolved definitions,
cycles, overloads, scopes and unsupported qualifiers name their exact cause,
subject, unchanged effects, responsible actor and recovery. These diagnostics
supply facts and grant no local policy authority.

Controlled-acceptance applicability is the author’s deliberate choice. An opt-out requires a nonempty rationale recorded unassessed, grants zero proof credit and waives no native tests, review or repository policy. It has no invented no-implementation eligibility condition.

## Authoring and source handoffs

Create and save return the current edit revision. Reuse it and the issued keyed
bindings directly for dependent obligations and cases. A keyed requirement
binding names its row and every claim; a keyed verification has its own binding.
No creation-history or coverage read is required to recover these identities.
A historical row inventory does not recreate a lost caller-key mapping.

Private save assessment and public assessment distinguish invalid authored
meaning from unavailable validation. Independently established authored defects
remain invalid even beside a validator failure. Unavailability is neither
invalid meaning nor permission to proceed. Correction follows the selected
assessment diagnosis and preserves the originally requested reassessment.

Definition reads carry exact authored identities, definition text and source
limitations. Committed-source meaning is labeled as such. Capture generations,
blob identities, parser providers and index occurrence carriers remain private
checker inputs; public projection does not change definition checks or credit.
Historical graph evidence with unknown freshness can be retained unchanged;
current-source acceptance still requires its own demonstrated freshness.

For a compact saved obligation-to-proof lookup, select
`{contract:"obligations",view:"proofs"}` through the unit reference. Read a known
returned proof name directly through `workspace_find_proofs`. A missing saved
selection remains a caller choice, using the obligation's meaning for a query;
a unique family or lexical match is not a selected proof or execution authority.
