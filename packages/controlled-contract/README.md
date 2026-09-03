# @agent-chassis/controlled-contract

Deterministic controlled-contract validation and proof-plan assessment.

The package has bounded proof-intent discovery, selection, authoring, and
assessment commands:

```sh
controlled-contract --input contract.json

controlled-contract-discover-proof-intents

controlled-contract-discover-proof-intents \
  --query "compact result omissions"

controlled-contract-select-proof-packs \
  --input contract.json \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-describe-proof-pack \
  --profile-id proof.completeness.lossless-projection \
  --profile-version 1.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-inspect-proof-pack-bindings \
  --input contract.json \
  --profile-id proof.completeness.lossless-projection \
  --profile-version 1.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-build-proof-plan \
  --input contract.json \
  --request proof-plan-request.json

controlled-contract \
  --input contract.json \
  --proof-plan proof-plan.json
```

It checks the v0.34 controlled graph and writes a bounded assessment to stdout.
The lossless reports are stored beneath
`.cache/controlled-contract/assessments/sha256/<assessment-digest>/`.

## What the result means

The planning assessment keeps four questions separate when an exact-bound pack is selected:

- `structure`: is the authored controlled graph internally valid?
- `profile_discrimination`: does it satisfy a release-certified proof pack?
- `exact_binding`: do the complete captured inputs satisfy that pack's exact
  binding declaration?
- `residue_status`: what meaning remains explicitly outside the controlled graph?

The command is non-authoritative. It never turns authored claims into runtime
truth, and honest residue does not make a structurally valid contract invalid.
There is no unqualified `pass` result.

The checker cannot discover an obligation omitted from the authored contract.
Repository grounding is only a structural anchor; it does not prove that a path
or symbol exists or is honest. Delivered runtime behavior is outside this
planning assessment, and a clean structural assessment alone does not prove that
a WK is implementation-ready.

## Discover controlled proof intents

`controlled-contract-discover-proof-intents` is the preceding discovery step.
With no arguments it returns all 36 controlled intents exactly once. Each compact
summary contains the exact intent ID, its one-sentence definition, controlled
discovery terms, exact capable pack IDs and versions, and authored distinctions
from commonly confused intents. It reads only the intrinsic
`proof-intents/catalog.json`; complete profiles, adequacy controls, certification
corpora, and the raw catalog do not appear in the result.

Search mode accepts ordinary local text:

```sh
controlled-contract-discover-proof-intents \
  --query "refusal before effects"
```

Search normalizes case, punctuation, Unicode compatibility forms, repetition,
and query-term order. Exact all-token matches are the strongest result class.
When none exists, any catalog entries sharing at least one term are returned as
explicit `partial_match` candidates with matched and unmatched terms. A true
zero-overlap query remains `no_match`; both outcomes include bounded remediation
guidance rather than dumping the catalog. Exact IDs are mechanically matched
without suppressing another entry in the same strongest class. All catalog
entries are evaluated before the optional `--limit` is applied. Every result
includes exact source values and match coverage plus `evaluated_intent_count`,
`total_match_count`, `returned_count`, `omitted_count`, and `truncated`; zero
matches reports `no_match`. Candidate order is stable intent-ID order, not a
ranking, and partial discovery never calls any candidate best or authoritative.

The pure `discoverProofIntents` API accepts only `query` and, in search mode,
`limit`. The CLI and API accept no path, root, catalog, executable, module, or
environment override. They never select, combine, invoke, or admit a pack. The
canonical UTF-8 JSON result is bounded to 65,536 bytes and fails closed rather
than omitting fields required to interpret the result.

## Select proof packs mechanically

`proof-intents/catalog.json` is the single intrinsic mapping from stable
controlled proof-intent IDs to exact admitted pack IDs and versions. It records
the intent definition, mechanically checkable compatibility, required inputs,
exact-binding requirement, and distinctions from commonly confused intents.

After discovery, explicitly choose controlled intent IDs. The pure
`selectProofPacks` API accepts only a controlled contract and those explicitly
requested controlled intents. It never infers an intent from prose or graph
omission. A missing obligation therefore leaves the requested candidate visible
as `requires_bindings`; unknown or stale-digest requests fail closed; multiple
mechanically valid candidates remain an explicit ambiguity with no ranking.
The compact selector command returns only relevant intent definitions and
distinctions, pack guarantees and exclusions, required inputs, remediation
codes, an exact authoring-projection digest and pattern counts, and
substrate/source digests. It does not return the 36 profile definitions or
certification corpora.

## Author one selected proof pack

After choosing an exact candidate, use
`controlled-contract-describe-proof-pack` with its exact profile ID and version.
The command accepts no path, catalog, root, module, executable, or environment
override. An optional repeated `--intent` narrows the projection and fails when
the intent does not map to that exact pack.

The result is a typed `controlled-contract-proof-pack-authoring.v1` projection.
It contains the selected guarantee, every explicit exclusion, relevant intent
distinctions, every reference and number binding requirement, distinctness and
population/count constraints, compact claim propositions, falsifiers,
verification relations, collections, resolver/evidence requirements, and the
exact satisfaction expression. Its evaluation-input skeleton names where the
caller must supply contract reference IDs and numbers without copying the
pack's example identities into a new contract.

Claim propositions use a display notation only: `$role` is a profile role,
`number($role)` is a number-role operand, brackets contain the operand list, and
`@mode($role)` is the applicability context. The profile remains the enforcing
artifact; the projection is a digest-bound authoring view, not a second grammar.
Every shipped pack must project within 65,536 UTF-8 bytes. An oversized
projection fails closed instead of truncating. Certification controls,
mutation corpora, profile source paths, and executable modules never appear.

### Generic v0.34 profile controls

The v0.34 profile grammar has three opt-in controls; profiles that omit them
retain their existing evaluation behavior.

- A `for_each` over a `zero_or_more` role may select
  `quantifier: "universal"` and `empty_behavior: "vacuously_satisfied"` only
  when it names the dominating `complete_population` pattern through
  `complete_population_pattern_id`. An explicitly bound, mechanically closed
  empty population then satisfies the iteration and is reported as vacuous.
  Missing, incomplete, invented, existential, or witness-producing input does
  not. Iterated relations and collections expand by member; only a relation
  whose two endpoints share the same empty iteration, or a collection whose
  complete membership is wholly vacuous, can be vacuous. A nonempty iterated
  relation requires exactly one same-member edge per member and rejects
  duplicate, cross-member, or other edges incident to the selected endpoint
  populations.
- `binding_constraint_patterns` are satisfaction leaves that refine a role's
  global cardinality on a selected branch. An `any_of` may request
  `branch_cardinality: "exactly_one"`; every route then carries one exact guard
  for each branch-local optional role, including an exact-zero guard on sibling
  routes. Selection comes from those satisfaction leaves, not from caller
  labels; a role used only by constraint leaves is invalid. The selected route
  still has to satisfy its claims, bindings,
  relations, resolver facts, and delivered-evidence leaves; unused routes do
  not make their inputs globally mandatory.
- `falsifier_occurrence_bindings` attach to a `verifies` relation pattern and
  name reference-role positions, number roles, and applicability joining for
  the target proposition, verification proposition, and controlled falsifier.
  `exact_scope` joins the complete applicability context;
  `shared_operands` permits mode differences but requires every applicability
  operand on each surface to be explicitly covered by the occurrence joins.
  Reference joins
  compare equality-normalized identities while retaining the exact raw role ID,
  so an equality alias cannot substitute a different occurrence. Missing or
  mismatched occurrence, target, source, population, version, condition,
  temporal operand, or other named role is a non-pass.

The authoring projection exposes these controls and their counts, and binding
assistance reports their role usage. Admission adequacy treats their deletion
or weakening as guarantee-relevant. They are domain-neutral profile grammar:
they do not define pagination, authentication, tri-state status, or negative
observation vocabulary.

An iterated claim may participate in a `closed_set` collection. It may not
participate in an `ordered_sequence`: the v0.34 grammar has no semantic ordering
source for a set-valued population, and deriving order from reference IDs would
make identifier renaming observable.

## Inspect evaluation-input bindings

After describing an exact admitted pack, run
`controlled-contract-inspect-proof-pack-bindings` with the contract, exact
profile ID/version, optional repeated controlled intents, and optionally an
existing `--evaluation-input`. The pure `inspectProofPackBindings` API accepts
the corresponding in-memory JSON values.

For every reference and number role, the result reports allowed types, identity
kinds, cardinality or numeric constraints, every mechanically compatible
contract candidate, exact compatibility facts, any supplied binding, and a
typed `unbound`, `one_compatible_candidate`, `ambiguous`, `incompatible`, or
`validly_bound` status. It also identifies profile patterns, population uses,
distinctness sets, and count constraints that consume the role. A single
candidate remains unselected: neither the API nor CLI writes an evaluation
input, interprets identity names, or treats compatibility as semantic truth.

Profiles, admissions, catalogs, and intent mappings are package-owned. Stale
identity, incompatible intent, malformed contract, and malformed evaluation
input fail closed. Semantically invalid supplied bindings remain explicit as
`incompatible` and make the CLI exit 2. Canonical output binds contract,
evaluation-input, profile, admission, catalog, vocabulary, profile-population,
intent-artifact, and authoring-projection digests; it fails instead of
truncating beyond 65,536 UTF-8 bytes.

Population remediation reports name both accepted membership declarations,
`reference:contains` and `reference:member_of`, together with the affected
population, applicability scope, declared members, membership claims, declared
cardinality, and observed member count. Empty populations still require an
explicit exact cardinality of zero, and enforcement is unchanged.

## Build a canonical proof plan

After authoring every required evaluation input, put only the remaining caller
choices in a schema-valid `controlled-contract-proof-plan-request.v1` document:

```json
{
  "schema_version": "controlled-contract-proof-plan-request.v1",
  "requested_intents": [
    "controlled-proof-intent.lossless-projection"
  ],
  "selected_packs": [
    {
      "profile_id": "proof.completeness.lossless-projection",
      "profile_version": "1.0.0",
      "evaluation_input_path": "lossless-projection.evaluation-input.json"
    }
  ]
}
```

Then compile it mechanically:

```sh
controlled-contract-build-proof-plan \
  --input contract.json \
  --request proof-plan-request.json > proof-plan.json
```

The compiler reruns intrinsic selection, loads only exact admitted package-owned
packs, verifies that each requested intent is assigned to exactly one explicitly
selected capable pack, validates supplied evaluation-input bindings, and computes
the contract, catalog, vocabulary, profile-population, intent-artifact, profile,
admission, guarantee, adequacy, evaluation-input, and exact-binding digests. For
exact-bound packs, the selected-pack request must also declare `exact_capture`
with its capture root, normalized relative contract and evaluation-input paths,
and exact sources. Paths in the request are resolved relative to the request
file; the emitted plan binds resolved evaluation-input and capture-root paths.

Missing inputs are returned together as stable typed diagnostics. Omitted or
unknown intents, ambiguous assignments, uncovered or incompatible intents,
duplicate or stale packs, malformed or incompatible evaluation inputs,
unexpected exact capture, unsafe exact paths, and conflicting exact file
identities fail closed. The request cannot contain digests, placeholders,
caller catalogs, profile paths, modules, executables, environment overrides,
alternate package roots, or an output path. The compiler never infers an intent,
selects a pack, or binds a role. Its canonical JSON is deterministic under
property, intent, and selected-pack reordering and is bounded to 131,072 UTF-8
bytes.

The complete authoring workflow is:

```text
discover-proof-intents
→ select-proof-packs
→ describe-proof-pack
→ inspect-proof-pack-bindings
→ author evaluation input
→ build-proof-plan
→ assess-contract
```

## Assess proof packs

The package contains only each pack's compact runtime carriers. Ordinary packs
ship a profile, evaluation-input template, and release admission. Exact-bound
packs also ship an exact-binding declaration and its release certification.
Assessment verifies those digest bindings; it does not ship or rerun the large
mutation, negative-fixture, and coverage-witness corpora used to certify a pack
release.

Every admitted assessment, including a one-pack assessment, requires a
schema-valid `controlled-contract-proof-plan.v1` document. The CLI has no
single-pack flags and never assigns proof intent implicitly. Exact-bound pack
entries carry their capture root, relative contract and evaluation paths, and
source declaration inside that plan.

`proof.compatibility.behavioral-preservation` binds complete baseline and
candidate behavior-report artifacts to the same contract/evaluation snapshot.
It requires equal captured bytes and distinct caller-selected source
descriptors. Different paths are not proof of different filesystem objects,
producers, or honest baseline/candidate provenance; byte-identical copies and
hard links remain inside that explicit grounding boundary.

## Projected-evaluation binding

Exact binding v1 proves that the captured artifacts are exactly the declared
ones and that the declared role bindings are exactly the projected populations
and references. On its own it does not require the contract nodes a profile
selects to be the nodes the deterministic projection derived, so a caller could
author additional graph material that satisfies the profile beside a satisfied
exact binding.

An exact-bound declaration may close that gap with the optional versioned opt-in
`projected_evaluation_binding`, naming the deterministic projection's result
requirement and one package-owned graph projection of that transformer. The
field is optional: a declaration without it keeps its unchanged v1 meaning, and
no admitted pack currently declares it.

When it is declared, the assessment additionally requires that every
captured-contract claim, relation, and collection the internally computed
profile evaluation actually selected is a node of the projected contract graph
derived from the captured projection-result bytes in the same capture cycle, and
that every node of that graph — claims, propositions, references, relations,
collections — appears exactly once in the captured contract with byte-equal
canonical content. Contract material the profile did not select and the
projection did not emit stays permitted. Equality normalization may not merge a
projected reference with any other captured reference.

The check binds the contract, profile, evaluation-input, admission,
declaration, certification, vocabulary, projection-result, and opt-in
identities, and refuses a declared opt-in with no derived graph, a derived graph
with no declared opt-in, and any pattern kind whose selected contract nodes the
evaluator does not name. Its failures appear as `assessment_binding` diagnostics
under `exact_binding.projected_evaluation`, prevent `exact_binding: proven`, and
are reported on `verification_scope.projected_evaluation_binding`. They are
never structural or runtime-evidence findings.

Two selection points consume contract claims the pattern results do not name:
a `complete_population` reference binding, and a `for_each` claim pattern's
`association_bindings`. Both are reported by a write-only evaluator trace that
callers cannot supply or alter, and both fail closed without it.

For association bindings the trace is per member. The evaluator announces the
exact member population it is about to iterate and the number of associations
the pattern declares, then emits one record per (member, declared association)
pair carrying the member, the association index, its local role and cardinality,
its outcome, and the complete population of claims it selected. The binding
accepts only a trace that exactly accounts for that announced iteration: a
missing record, a surplus record, a record for an unannounced member, a record
whose role or cardinality disagrees with the profile, a record left unsatisfied
by a failed or ambiguous association, a selection whose size contradicts its
cardinality, and one claim attributed to two members are each refused with a
stable typed diagnostic. A universal iteration over a mechanically complete
empty population announces itself as vacuous and is accepted only when it
selected nothing at all, which is what separates legitimate vacuity from a trace
whose records went missing. Every claim the trace reports is then subject to the
same projected-node and transitive-closure comparison as any other selected
node.

A `same_reference` comparison over distinct references remains unsupported: the
evaluator does not name the equality claims it relied on, so a profile declaring
the comparison is refused up front.

## Assess a proof plan

Use a schema-valid `controlled-contract-proof-plan.v1` document for zero, one,
or several packs:

```sh
controlled-contract \
  --input contract.json \
  --proof-plan proof-plan.json
```

Each pack entry independently binds its profile ID and version, requested
controlled intents, evaluation-input location and digest, admission/profile
digests, and—when required—its capture root, relative contract and evaluation
paths, exact source declaration, and exact-binding digests. Plan-level digests
bind the contract, admitted catalog, vocabulary, profile population, and intent
artifact. Duplicate identities, conflicting inputs, unknown intents, stale
digests, and pack/intent mismatches fail closed.

The aggregate result proves profile discrimination only when every selected
pack proves its own guarantee. Every v2 pack runs its own deterministic exact
capture. Per-pack guarantees are not collapsed, and all diagnostics, exclusions,
and missing inputs retain their pack ID/version provenance. Zero packs leaves
profile discrimination and exact binding `not_assessed`; authority is always
`non_authoritative`. Delivered runtime behavior is outside the assessment rather
than an incomplete proof intent or axis.

The complete machine-readable list is `profiles/catalog.json`. A missing pack is
reported as not assessed; a different proof pack cannot silently substitute.

## Compact output

The multi-pack terminal result is intentionally small:

```json
{
  "requested_proof_intents": ["controlled-proof-intent.lossless-projection"],
  "selected_pack_count": 1,
  "evaluated_pack_count": 1,
  "structure": "proven",
  "profile_discrimination": "proven",
  "exact_binding": "not_assessed",
  "assessment_scope": "planning",
  "authority": "non_authoritative",
  "per_pack": [{
    "profile_id": "proof.completeness.lossless-projection",
    "profile_version": "1.0.0",
    "profile_discrimination": "proven",
    "exact_binding": "not_applicable"
  }],
  "diagnostic_count": 0,
  "exclusion_count": 0,
  "missing_input_count": 0,
  "artifact": "controlled-contract-assessment://sha256/.../manifest.json"
}
```

The bundle uses the fixed files `assessment.json`, `assessment.md`,
`structural.full.json`, `proof-packs.full.json`, and `manifest.json`.
`proof-packs.full.json` losslessly preserves every independently evaluated pack,
its admission, diagnostics, exclusions, missing inputs, source digests, and exact
capture result without filename collisions. Caller plan paths and capture-root
paths do not participate in the content identity.

## Library API

```js
import {
  assessContractFiles,
  assessExactBoundContractFiles,
  assessProofPlanFiles,
  assessStructuralContractFile,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents,
  inspectProofPackBindings,
  selectProofPacks,
  loadAdmittedProofPack,
  readProofPackCatalog,
  describeProofPackAuthoring,
  searchVocabulary
} from "@agent-chassis/controlled-contract";
```

Vocabulary queries return advisory slices for authoring convenience. Validation
always uses the complete intrinsic v0.34 vocabulary and its declared algebra.

## Deterministic projection bounds

### Declared bounded-policy proofs

Two independent exact-binding packs cover different bounded-policy obligations:

- `proof.policy.declared-boundary-record-consistency@1.0.0` checks an exact
  `caller_asserted` observation record against an exact declared policy and
  captured UTF-8 subjects. Its `declared-boundary-record-consistency.v1`
  transformer applies the closed character/byte/UTF-16 unit and measurement
  classes, derives every nonzero N-1/N/N+1 census (N/N+1 for a zero maximum),
  validates the complete direction/inclusivity/refuse-or-truncate disposition
  table, and emits complete populations and counts bound to the source-set
  digest. `captured_execution_transcript` is a recognized but refused
  provenance value because this package has no mechanism that can establish it.
- `proof.policy.declared-limit-propagation@1.0.0` checks one exact raw UTF-8
  guidance artifact against the exact declared policy. Its
  `declared-limit-guidance-propagation.v1` transformer requires exactly one
  plain-decimal value and exact unit token per policy key and refuses missing,
  duplicate, stale, conflicting, substituted, wrong-unit, and unrelated-number
  guidance.

Both profiles use projected-evaluation binding for transformer-derived
case/association-to-limit and limit-to-unit edges. They are independently
selectable and neither entails the other. Neither proves that a captured unit is
the unit enforced by production code, runtime truth, authority, applicability,
CCE consequence, or shared policy identity across separate assessments. The
guidance pack covers one captured surface only, and the boundary pack does not
prove execution provenance for caller-asserted observations.

```sh
controlled-contract-derive-declared-boundary-record-consistency \
  --policy policy.json --observations observations.json --subjects subjects.json

controlled-contract-derive-declared-limit-guidance-propagation \
  --policy policy.json --guidance guidance.md
```

### Exact caller-input authority confinement

`proof.input.caller-authority-confinement@1.0.0` implements
`controlled-proof-intent.caller-input-authority-confinement` with the
package-owned `caller-input-surface-capture.v1` transformer. It consumes exactly
five positionally bound canonical artifacts: the closed accepted-input policy,
accepted request bytes, forbidden request bytes, authenticated sound-negative
observation evidence, and its matching capture proof. It emits one combined
result and one `caller-input-authority-contract` graph; the profile's sole
projected-evaluation binding names that result and graph.

The transformer exhaustively traverses both request payloads with typed structural
token vectors for object keys and array carrier/index positions. It applies the
captured NFC, decode-once, and closed alias rules; rejects unknown, colliding,
cyclic, parser-ignored, or ambiguous supply; derives classification only from the
captured policy; and closes every forbidden member through its exact nonempty
coordinate, operation, and protected-effect associations. The accepted request
must contain the exact path-looking opaque control, contain only declared allowed
members, select no coordinate, and be accepted. The forbidden request must contain
an exact authority-bearing member and be refused.

The same graph exactly joins request, attempt, disposition, acceptance, refusal,
observation cut, source census, operation, effect, and trace occurrence identities.
The policy-derived mandatory source census must equal the sound-negative declared
and observed source populations. Before the exact refusal cut, the forbidden
attempt may have no resolver, loader, filesystem, environment, module, catalog,
subprocess, return, or success occurrence. The transformer reuses the internal
sound-negative validator without changing or widening
`proof.observation.sound-negative`; that separate pack supplies no identity or
evidence to this pack.

The pack excludes canonical-policy or adapter fidelity outside the capture,
instrumentation completeness outside the policy-derived source census,
post-refusal behavior and later requests, runtime truth beyond the exact capture,
CCE consequences or publication authority, and cross-pack occurrence joins. It
does not exclude any member, source, operation, effect, or classification inside
the captured policy, exact requests, and required source census.

### Exact absence-only sound-negative observation

`proof.observation.sound-negative@1.0.0` implements
`controlled-proof-intent.sound-negative-observation` with the package-owned
`sound-negative-observation-capture.v1` transformer and its
`observation-contract` projection. The pack is exact-binding-only. Its profile
contains one conjunctive `all_of` and no `present` or `unavailable` branch.

For one exact captured target, attempt, interval, declared source population,
and raw observation population, the transformer validates complete declared and
observed source coverage, one stable endpoint pair per source outcome, and every
valid observation's authentication and exact target, source-of-record, attempt,
position, and raw-observation grounding. The profile universally requires every
valid observation not to match the selected target, exactly binds the empty
invalidating-condition population, and selects the sole projected `absent`
conclusion from the same exact capture cycle. A `present` or `unavailable`
projection cannot satisfy this pack.

A complete captured source population may be empty. In that case its exact
source, source-outcome, endpoint, raw-observation, valid-observation, and position
populations and their declared count signals are all bound at zero. The
per-member obligations are therefore vacuously satisfied relative to that exact
declared captured population, while the empty invalidating-condition population
and exact projected `absent` conclusion remain affirmative requirements. This
does not claim that pre-capture source discovery was correct or complete.

The pack excludes runtime or post-capture truth, pre-capture source-discovery
authority, evidence or applicability authority and CCE consequences, external
PKI or legal identity, undeclared sources or mutations, derived provenance,
cross-pack occurrence joins, authenticated-presence proof, and
evidenced-unavailability proof.

### Exact supplementary-failure isolation

`proof.failure.supplementary-isolation@1.0.0` implements
`controlled-proof-intent.supplementary-failure-isolation` with the package-owned
`supplementary-isolation-attempt-record.v1` transformer. It consumes the exact
attempt, core-settlement, supplementary-failure, and final-result records and
projects one self-contained controlled contract for that attempt.

The transformer derives the selected operation and attempt, the sole settlement,
failure, and final-result occurrences, both complete core-member populations, the
complete final membership, the observed supplementary-result population, and the
closed reason and disclosure populations. It emits core-preservation claims only
when the exact captured value and complete core population are preserved, and it
derives supplementary absence from the captured result population rather than a
caller-authored empty set. Projected-evaluation binding pins every selected profile
node to that transformer output. The profile uses one overall conjunctive `all_of`;
its present-unavailable and omitted-disclosed alternatives are one expression-local
`any_of` with `branch_cardinality: exactly_one`.

The pack excludes runtime truth outside the capture, acquisition completeness
before capture, successful supplementary computation, core-computation failure,
concurrency outside the attempt, retries and later attempts, undeclared effects or
components, semantic reason quality beyond closed-population membership, and
applicability, evidence authority, or CCE consequence.

### Exact lexicographic-ordering conformance

`proof.ordering.lexicographic-conformance@1.0.0` is an exact-capture planning
proof pack for
`controlled-proof-intent.deterministic-lexicographic-ordering`. It binds four
canonical artifacts—the declared input, complete ordered result, closed ordering
policy, and complete item-key/comparator evidence—to one package-derived
`deterministic-lexicographic-conformance.v1` report. The exact-binding runner
derives that report from the captured bytes, repeats the derivation, compares the
canonical bytes, and projects the declared-item, result-item, and policy-key
populations from the derived report. The profile accepts no caller-authored
resolver facts.

The policy contains at least two keys. Each key declares its extractor, type,
contiguous precedence, direction, exact equality, Unicode collation and
normalization, and punctuation behavior. The tie-breaker is a separately declared
Unicode-scalar comparison of `item_id`. Evidence contains every item/key value,
every unordered distinguishable item pair, and nonidentity input, declaration,
and equivalent-serialization observations. The transformer checks complete
mutually inclusive populations and exact counts, the first unequal key,
fallthrough only across equal higher-priority keys, tie-breaking only after all
policy keys are equal, non-equality of distinct identities, the complete result,
and invariant results for all supplied permutation observations.

The public derivation command is:

```sh
controlled-contract-derive-lexicographic-conformance \
  --comparator-evidence comparator-evidence.json \
  --input input.json \
  --policy policy.json \
  --result result.json
```

This guarantees only conformance of the four exact captured artifacts. It does
not establish source authority, acquisition completeness before capture,
behavior after capture, runtime deployment behavior, pack applicability, or
undeclared coercion, null, NaN, locale, collation, normalization, or punctuation
semantics. Empty and singleton populations and policies with fewer than two keys
are intentionally excluded.

The package-owned `integration-prefix-census.v1` transformer is a bounded local
materialization mechanism. It deterministically expands an exact captured slice
DAG, its exact integration-unit partition, and its exact execution-path and
required-branch population into the complete supplied prefix-case census. It is
not an unbounded symbolic proof engine.

The transformer accepts at most 20 integration units and materializes at most
100,000 prefix/path/branch cases. Inputs at either bound are accepted. An input
that would exceed either bound fails closed with the stable
`projection_population_limit_exceeded` diagnostic; the transformer never
truncates or samples the census. A larger population therefore needs a different
package-owned derivation strategy rather than an author-selected cap.

The registry is transformer-owned: each registered deterministic transformer
validates its source count, parses canonical sources, validates its result
schema/version, performs its derivation, and exposes its named set and singleton
projections. `mutation-pagination-trace.v1` consumes one closed canonical event
trace plus its exact captured states. It retains ordered member occurrences in
the captured result while projecting normalized identity sets, and gives every
occurrence a content-derived identity so repeated semantic member values remain
observable. Singleton projections bind the exact selected traversal, page
attempt, cursor, mutation, versions, snapshot, refusal, page-return,
cursor-advancement, and protected-effect population used by the pagination
packs; callers do not choose plausible identities.

`controlled-proof-intent.mutation-consistent-pagination` has two alternative
packs, selected explicitly according to policy. It is not an `any_of` profile
and selection never turns the two policies into simultaneous obligations:

- `proof.pagination.snapshot-consistency@1.0.0` binds every declared page
  attempt and returned page to one immutable exact snapshot across a relevant
  live-source mutation, and compares the complete stable and interleaved ordered
  member-occurrence sequences.
- `proof.pagination.versioned-cursor-refusal@1.0.0` binds cursors and successful
  pages to their traversal version, then proves that the exact stale next-page
  attempt is refused before any page artifact, return event, cursor advancement,
  protected write, or protected mutation. An unrelated-source control remains
  accepted.

Both packs require exact binding and use content digests, including
`distinct_content_sha256` when two captured states or versions must differ.
They establish planning-time discrimination over exact captured evidence only.
They exclude capture provenance, evidence authority, runtime truth, undeclared
mutations and effects, retention/isolation semantics, and standalone complete
pagination. Completeness of one stable traversal remains a separate proof
obligation.

## Direct-source authentication and provenance

`proof.authentication.direct-source-provenance@1.0.0` binds one exact captured
evidence occurrence, target, singular provenance/source-of-record source, and
observation attempt. Its four mandatory behaviors are `authenticates`,
`originates_from`, `has_source_of_record`, and `observed_in`; each has an
independent verification claim, its positive controlled-complement falsifier,
and a same-occurrence `verifies` edge.

The package-owned
`authentication-provenance-occurrence-capture.v1` transformer consumes exactly
six sources: raw evidence bytes plus target-resolution, source-authentication,
source-of-record, attempt-binding, and aggregate-authentication witnesses. It
requires each witness to embed its exact Ed25519 proof, grounds every proof
signer in the captured public-key bytes, verifies the signature over closed
typed mechanism-specific claims, and checks the retained proof digest. The
source-authentication signer must be the exact grounded `S`; target resolution
and source-of-record assignment must share one registry authority; aggregate
authentication and attempt binding must share the capture authority. It derives the occurrence
identity from the capture authority, bound attempt, evidence digest, and
attempt-binding proof; validates every witness join; emits one canonical
E/T/S/A record with all witness and proof digests; and exposes four singleton
projections for exact binding. Local labels, source descriptors, paths, opaque
digest strings, and equal bytes do not select those projections.

The pack establishes only planning-time discrimination for the exact direct
capture and its selected singleton target/source populations. It does not
establish authorship, issuance, authorization, ownership, containment, decision
authority, generic integrity, runtime truth, caller honesty, source-discovery
completeness, freshness beyond attempt membership, or derived/copy provenance.
The grounded provenance source is the exact captured key identity, so an
unrelated self-authored key cannot attest a different `S`. The pack does not
establish external PKI trust, legal identity, or honesty beyond that exact
cryptographic identity. The derived/copy relation remains outside the active
vocabulary.

## Compiled-validator startup cache

Every JSON-Schema validator this package compiles is owned by
`lib/compiled-validator-cache.mjs`. No other module in the package, and no
wiki-core controlled-contract surface, constructs Ajv or calls `compile`. Modules
declare a compilation group and receive the named validators back:

```js
import { compiledValidators } from "./compiled-validator-cache.mjs";

const { validateSchema } = await compiledValidators(
  "controlled-contract.obligation-coverage-carrier.v1",
  { validators: { validateSchema: OBLIGATION_COVERAGE_SCHEMA } }
);
```

Reuse is decided per group. On an exact hit that group's validators are loaded
from generated code and Ajv is never imported, let alone constructed. On a miss
one generation pass runs in a worker over the declared population -- enumerated
by `lib/validator-population.mjs` -- reusing every group whose published artifact
is already valid and compiling only the groups whose artifacts are absent or
invalid. Each is published atomically and then loaded from that exact artifact.
There is no fallback to repeated per-module compilation: an artifact that cannot
be obtained is a typed `CompiledValidatorCacheError`.

Artifacts live under the fixed `.cache/controlled-contract/validators` suffix of
the writing repository root. Ordinary package execution resolves the enclosing
`.git` root once from its working context. The package installation is read-only
input: its schema and runtime bytes determine cache identity but never anchor
mutable storage. Caller input, prompt text, `HOME`, `XDG_*`, `TMPDIR`, `PATH`, and
environment-selected policy take no part in root selection, and caches at the
retired package-installation location are neither read nor migrated.

Cache identity is split in two, and a group is reused only when both halves
match. *Toolchain identity* is shared by every group: the Ajv package and version
and its runtime helper bytes, the effective `strict`, `allErrors`, and
code-generation options, the definition bytes of the custom formats and keywords,
the module format, and a package-owned cache-format version. *Schema identity* is
per group: the canonical digest of that group's own resolved schemas and named
validators, computed from the schemas themselves rather than from the files that
produced them. Nothing else participates -- in particular no source-tree digest
and not the package's own version, neither of which can change a generated byte.
Editing a `lib/` module that declares no schemas therefore invalidates nothing,
and editing one group's schema recompiles that group alone.

Before any cached code runs, the loader validates that identity, the artifact's
containment in its cache root, the file type of every entry, and the sha256 of
every byte it is about to execute. On the read path an invalid artifact is a loud
typed refusal; a generation pass replaces one that is invalid for a content
reason through private temporary output and atomic publication, and never
self-heals a containment violation.

Validators behave exactly as their `ajv.compile` equivalents, including the
complete diagnostic surface: the boolean result and `errors` entries carrying
`instancePath`, `schemaPath`, `keyword`, `params`, and `message`.

Warming and diagnostics are optional and use the same cache:

```
node bin/prepare-validator-cache.mjs            # generate and publish on a miss
node bin/prepare-validator-cache.mjs --verify   # fail unless an exact artifact exists
node bin/prepare-validator-cache.mjs --json     # emit the status record
```

Neither form is a startup prerequisite and neither keeps a second cache. Runtime
behaviour, recovery, and operator procedure are in
`the project documentation`.

## Supported public surface

The published artifact contains the current v0.34 runtime, bounded discovery,
selection, authoring, binding-inspection, proof-plan compilation, and assessment
commands, current schemas, the intrinsic
vocabulary, and compact admitted packs. Historical carriers, prototype policy
tools, pack fixtures, mutation corpora, coverage witnesses, and
release-certification executables are development sources and are not
published.
# Supported native-v1 surface

The published root and explicit subpaths support only the native
`controlled-acceptance-contract.v1` family. Stable entrypoints reject
experimental, mixed, partial, and unknown identities before semantic work or
effects. The package owns validation, provider compatibility, pack semantics,
selection, binding, authoring skeletons, compilation, assessment, generation
validation, profile digests, resource policy, and diagnostic meaning.

## Stable-v1 refactor graph

The `@agent-chassis/controlled-contract` root exports
`buildControlledContractRefactorClosure` and
`planControlledContractRefactor` from the stable
`./refactor-graph-v1` subpath. One invocation accepts a complete current live
carrier population and exactly one `rename_identity` or `replace_subgraph`
mode. It returns one deeply immutable, content-addressed closure and semantic
classification used unchanged by repository planning, apply, and current-state
assessment.

The closure covers identity declarations and references across contract nodes,
relations, collections, verification bundles, stable test proofs, obligation
and acceptance coverage, proof-plan bindings, and assessment bindings.
`rename_identity` performs a bijective identity rewrite and admits no semantic
difference. `replace_subgraph` requires explicit old-to-new correspondence,
nonempty reason, and complete package carrier-patch treatment; it records
coverage-rebase inputs for the existing coverage owners, invalidates derived
plans and assessments, and emits explicit `proof_credit:"not_transferred"`
gaps for new identities.

The result is non-authoritative and writes nothing. Package failures are the
`mechanical_failure` limb with the package owner, stable code, deciding facts,
would-break invariant, and supported recovery. The primitive does not create a
policy decision, continuation, receipt, persistence owner, coverage classifier,
generic diff, migration, rollback, or audit API. Repository and MCP behavior is
documented in
[`docs/mcp-controlled-contract-operations.md`](../../docs/mcp-controlled-contract-operations.md#generation-bound-controlled-contract-refactoring).
