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

## Public operations

The registered family is `workspace_find_proofs`, `workspace_read_wiki`,
`save_record`, `workspace_assess_contract` and execution-only `verify_proof`.
Create records through `workspace_create_record`. Retained and recorded execution
results use `get_run_result`. The old discovery, upsert, query, removal and
validation routes are not public aliases.

Find proofs by browsing: `workspace_find_proofs` with no arguments returns the
complete catalogue of proof names and short descriptions. A query or known
identity is optional. Matches are complete by lexical tier;
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
listed catalogue, `meaning` states that a listed proof is a lexical candidate
and not a selection, and `next_calls.select` is the call that reads one listed
proof from the same retained result.

A selected proof is read by semantic part. Its `overview` carries the catalogue’s
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
A parameter part keeps its value kind, accepted value schema, source policy,
complete admitted refinements and constraint selectors; a constraint part is
the admitted constraint itself. Fresh and retained selections return the same
complete parts, and a retained read ranks, loads and executes nothing again.

Four facts stay separate, and the response never collapses them:

- **Query recognition.** `family.query_recognition`, on a search index and in a
  selected proof's `authoring.family`, is the package's
  `provider_context.status` under a name that says what it is about. It reports
  which listed family the QUERY NAMED. `unspecified` means the query named
  none, never that the catalogue lists none. An ambiguous or conflicting query
  selects no family and no runner is guessed for it.
- **Catalog listing.** The listed families are the provider catalogue's own
  population and are never derived from the query: when authoring needs a
  family and none is selected, `next_calls.choose_family.choices` lists every
  one by `family_id` and `runner`. It is a catalogue fact, not a
  statement about what the execution environment can run; discovery reports no
  such statement at all. When a family is selected, by `target_family` or by a
  query that identifies exactly one, its complete case-authoring facts are
  inlined in `authoring.family`; otherwise `authoring.family.missing_input`
  names the exact input a per-family read needs. Those
  facts state the enforced format of the plain-string members a caller
  authors: `target.path_pattern` for the case target path and
  `falsification.field_patterns` for `module_path` and `function_name`. An
  agent client that renders a patterned request member as a plain string
  delivers these formats nowhere else. A selected family's `falsification`
  states each strategy by the fields an author writes (`required`) and may
  not write (`not_allowed`), with those patterns and the `target_constraint`.
  Beside that constraint, inline supported/rejected code pairs are authored once
  per mechanism and necessary language variant, and selected by the family’s
  existing language facts. Scalar examples include a distinct replacement and
  concern the mutated function, not necessarily the test method; module examples
  distinguish missing invocation evidence from export-identity refusal.
  The selected falsification names neither the falsifier mechanism nor the fields the save derives.
  The provider identity and version, the actual runner, the accepted source
  suffixes, the selector form, `path_owner` (where `path` is declared) and
  every target field stay, because they are how the test is declared. The
  target lists its fields inline and repeats no variant label, and the
  authoring part states whether a case is required without repeating
  `verification_capability`, which stays on the overview and the summary.
- **Proof applicability.** Provider facts appear only where a candidate declares
  a test-execution verification capability, published per row as
  `verification_capability` and taken from that proof's own admitted profile —
  never from a proof name or a language. An answer with no such candidate
  carries no provider verdict; the gap route remains available.
- **Target support.** `not_established` repeats the authoring owner's own
  support states: a lexical match is not a capability fact, a listed family
  is not a target fact, and test existence and falsifier target shape are
  checked only when `verify_proof` runs.

A selected proof that declares a verification capability carries, in its
`authoring` part, that a case is required, the selected family's provider,
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

## Validation and correction

Use `workspace_assess_contract` for authored validity, stale definition pins,
requirements, obligation coverage and route diagnosis. It reuses the assessment
owner used by save and creation. It runs no proof provider and grants no dispatch
or integration authority. Follow exact selected correction calls; after a save,
read the current combined revision before another mutation. Stale or malformed
saves preserve the publisher's native atomicity and certainty facts.

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
[test-proof runtime identity](test-proof-runtime-identity.md#capability-limitations).

An ID saved in more than one source refuses and lists every authorized source
as a ready retry call; the explicit `source` selects exactly one of them and
never searches another. See the
[operation reference](mcp-operation-reference.md) for the request forms.

Ordinary verification does not require preparation, a skeleton, a plan, a
carrier, publication, or prior validation. Missing source or capability facts
produce a nonexecution result. Authoring and validation remain nonexecuting.

## Internal owners

Carrier compilation, requirement compilation, proof-posture disposition,
generation persistence, assessment, graph integrity, semantic projection, and
runtime evaluation may remain internal when retained consumers use them.
Internal module names do not create public endpoints or caller-authored
construction steps.

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
