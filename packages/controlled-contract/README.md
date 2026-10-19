# @agent-chassis/controlled-contract

Deterministic controlled-contract validation and proof-plan assessment.

The package manifest declares version 0.11.0. Package versions, schema versions
and proof-definition versions are independent identities. This package provides
authenticated, pack-owned parameter and construction metadata.
Import `@agent-chassis/controlled-contract/pack-parameters` for
`loadPackParameterContract`, `validatePackParameterContract`,
`describePackParameters`, `inspectPackParameterCoverage`,
`loadCurrentParameterPopulation` and deterministic documentation APIs.
The package owns the closed schema and every current exact companion; authored
WK values and generic instance resolution remain separate consumers.

Current admissions use v3 and bind `parameter_contract_digest`. The proof-intent
catalog and multi-pack assessment use v2. The catalog publishes one current version per proof: ordinary packs use 4.0.0,
idempotency, forbidden noninvocation and lossless projection use 5.0.0, and test-validity uses 12.0.0. Named and
exact loads reject other versions with `proof_pack_exact_version_not_current`.
The current definition-format section below describes schema and certification
boundaries; the generated pack index is the complete current version inventory.
See [durable parameter guidance](../../docs/proof-pack-parameters.md) and the
[complete generated pack index](../../docs/proof-pack-parameters/index.md).

The installed package can generate or check a supplied documentation directory:

```sh
node node_modules/@agent-chassis/controlled-contract/bin/proof-pack-parameter-docs.mjs --write ./pack-docs
node node_modules/@agent-chassis/controlled-contract/bin/proof-pack-parameter-docs.mjs --check ./pack-docs
```

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
  --profile-version 5.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-inspect-proof-pack-bindings \
  --input contract.json \
  --profile-id proof.completeness.lossless-projection \
  --profile-version 5.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-build-proof-plan \
  --input contract.json \
  --request proof-plan-request.json

controlled-contract \
  --input contract.json \
  --proof-plan proof-plan.json
```

It checks the stable-v1 controlled graph and writes a bounded assessment to stdout.
The lossless reports are stored beneath
`.cache/controlled-contract/assessments/sha256/<assessment-digest>/`.

## What the result means

The planning assessment keeps three questions separate:

- `structure`: is the authored controlled graph internally valid?
- `profile_discrimination`: does it satisfy a release-certified proof pack?
- `residue_status`: what meaning remains explicitly outside the controlled graph?

Runtime observations never appear in a planning assessment. Executing a
definition against a candidate, collecting its observations, and binding the
result to that exact definition is owned by `workspace_verify_proof`.

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
With no arguments it returns all 37 controlled intents exactly once. Each compact
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
and distinctions from commonly confused intents.

After discovery, explicitly choose controlled intent IDs. The pure
`selectProofPacks` API accepts only a controlled contract and those explicitly
requested controlled intents. It never infers an intent from prose or graph
omission. A missing obligation therefore leaves the requested candidate visible
as `requires_bindings`; unknown or stale-digest requests fail closed; multiple
mechanically valid candidates remain an explicit ambiguity with no ranking.
The compact selector command returns only relevant intent definitions and
distinctions, pack guarantees and exclusions, required inputs, remediation
codes, an exact authoring-projection digest and pattern counts, and
substrate/source digests. It does not return the 37 catalog profile definitions or
certification corpora.

## Author one selected proof pack

After choosing an exact candidate, use
`controlled-contract-describe-proof-pack` with its exact profile ID and version.
The command accepts no path, catalog, root, module, executable, or environment
override. An optional repeated `--intent` narrows the projection and fails when
the intent does not map to that exact pack.

The result is a typed `controlled-contract-proof-pack-authoring.v2` projection.
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

### Generic stable-v1 profile controls

The stable-v1 profile grammar has three opt-in controls; profiles that omit them
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
participate in an `ordered_sequence`: the stable-v1 grammar has no semantic ordering
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
      "profile_version": "5.0.0",
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
admission, guarantee, adequacy, and evaluation-input digests. Paths in the
request are resolved relative to the request file; the emitted plan binds
resolved evaluation-input paths. No capture root, exact source declaration, or
execution observation is part of a plan.

Missing inputs are returned together as stable typed diagnostics. Omitted or
unknown intents, ambiguous assignments, uncovered or incompatible intents,
duplicate or stale packs, and malformed or incompatible evaluation inputs
fail closed. The request cannot contain digests, placeholders,
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

The package contains only each pack's compact runtime carriers: a profile, an
evaluation-input template, and a release admission.
Assessment verifies those digest bindings; it does not ship or rerun the large
mutation, negative-fixture, and coverage-witness corpora used to certify a pack
release.

Every admitted assessment, including a one-pack assessment, requires a
schema-valid `controlled-contract-proof-plan.v1` document. The CLI has no
single-pack flags and never assigns proof intent implicitly.

`proof.compatibility.behavioral-preservation@4.0.0` retains its original
captured full-report byte-equality requirement. Generic assessment returns
`proof_evaluation_unavailable` with `outcome: unsupported` and zero credit:
it matches authored declarations but neither binds captures nor invokes the
supplied-report checker. Mixed assessments continue and remain `not_proven`.
No requirement or saved binding is replaced with a narrower comparison.

`proof.result-shape.cross-representation-parity@5.0.0` is the independently
selected declaration comparison: complete declared typed-descriptor populations,
exact count declarations, one selected canonical-value equality declaration,
and the associated read/complement verification structure. Its guarantee
explicitly excludes actual report comparison, captured bytes and implementation
behavior. Version 4.0.0 is retired; saved selections require explicit refresh
and receive no automatic credit or binding transfer.

A separate call to `verifyBehavioralPreservationReports` actually reads two
supplied typed reports. It compares descriptor sets, consistent exact counts,
selection identity and one selected canonical value pair. Its v2 result retains
those comparison outcomes in `comparison_matches` and states their scope in
`comparison_scope`. Matching the selected value while an unselected value differs
can yield `comparison_matches: true`; full captured-report equality and implementation
behavioral preservation remain explicitly unsupported with reasons and zero
credit. No provenance, runtime completeness or general equivalence is established.

## Evaluator selection trace

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
digests. Plan-level digests
bind the contract, admitted catalog, vocabulary, profile population, and intent
artifact. Duplicate identities, conflicting inputs, unknown intents, stale
digests, and pack/intent mismatches fail closed.

The aggregate result proves profile discrimination only when every selected
pack proves its own guarantee. Per-pack guarantees are not collapsed, and all
diagnostics, exclusions, and missing inputs retain their pack ID/version
provenance. Zero packs leaves profile discrimination `not_assessed`; authority
is always
`non_authoritative`. Delivered runtime behavior is outside the assessment rather
than an incomplete proof intent or axis.

The complete machine-readable list is `profiles/catalog.json`. A missing pack is
reported as not assessed; a different proof pack cannot silently substitute.

## Compact output

The following terminal-result excerpt is illustrative and has not been executed
as part of this README. It shows the planning result shape, not runtime evidence:

```json
{
  "requested_proof_intents": ["controlled-proof-intent.lossless-projection"],
  "selected_pack_count": 1,
  "evaluated_pack_count": 1,
  "structure": "proven",
  "profile_discrimination": "proven",
  "assessment_scope": "planning",
  "authority": "non_authoritative",
  "per_pack": [{
    "profile_id": "proof.completeness.lossless-projection",
    "profile_version": "5.0.0",
    "profile_discrimination": "proven"
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
always uses the complete intrinsic stable-v1 vocabulary and its declared algebra.

## Deterministic projection bounds

### Declared bounded-policy proofs

Two independent packs cover different bounded-policy obligations:

- `proof.policy.declared-boundary-record-consistency@4.0.0` retains the requirement to check an exact
  `caller_asserted` observation record against an exact declared policy and
  captured UTF-8 subjects. Its `declared-boundary-record-consistency.v1`
  transformer applies the closed character/byte/UTF-16 unit and measurement
  classes, derives every nonzero N-1/N/N+1 census (N/N+1 for a zero maximum),
  validates the complete direction/inclusivity/refuse-or-truncate disposition
  table, and emits complete populations and counts bound to the source-set
  digest. `captured_execution_transcript` is a recognized but refused
  provenance value because this package has no mechanism that can establish it.
  Assessment independently matches authored declarations and neither invokes
  that transformer nor binds its report to the exact source inputs. It therefore
  reports `proof_evaluation_unavailable`, `outcome: unsupported`, and zero guarantee
  credit through the shared unsupported outcome. Declaration matches remain
  visible without guarantee participation. Mixed assessment continues other
  proofs and cannot report complete success. The transformer and CLI remain
  usable for their supplied-data checks; the observation stays `caller_asserted`,
  with no production enforcement claim or authentication prerequisite. Separating
  declaration matching and transformer verification into independently supported
  definitions remains later work; the full saved guarantee is unchanged.
- `proof.policy.declared-limit-propagation@4.0.0` retains the requirement to check one exact raw UTF-8
  guidance artifact against the exact declared policy. Its
  `declared-limit-guidance-propagation.v1` transformer requires exactly one
  plain-decimal value and exact unit token per policy key and refuses missing,
  duplicate, stale, conflicting, substituted, wrong-unit, and unrelated-number
  guidance.
  Assessment neither invokes the transformer nor binds its report to the exact
  policy and raw guidance text. It returns the shared unsupported outcome with
  that specific missing connection and zero guarantee credit. The transformer
  and CLI retain their supplied-text checks and source-bound reports; matching
  graph declarations cannot certify captured guidance. Its complete requirement,
  discovery and authoring remain available. Independent declaration and
  raw-guidance definitions have not been separated.

Both profiles declare case/association-to-limit and limit-to-unit edges in the
projected graph; these declarations alone do not connect assessment to the
transformer and its sources. They are independently
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

`proof.input.caller-authority-confinement@4.0.0` implements
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

`proof.observation.sound-negative@4.0.0` implements
`controlled-proof-intent.sound-negative-observation` with the package-owned
`sound-negative-observation-capture.v1` transformer and its
`observation-contract` projection. Its profile
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

`proof.failure.supplementary-isolation@4.0.0` implements
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

`proof.ordering.lexicographic-conformance@4.0.0` is an exact-capture planning
proof pack for
`controlled-proof-intent.deterministic-lexicographic-ordering`. It binds four
canonical artifacts—the declared input, complete ordered result, closed ordering
policy, and complete item-key/comparator evidence—to one package-derived
`deterministic-lexicographic-conformance.v1` report. The package derivation
derives that report from the four artifacts' bytes, repeats the derivation,
compares the canonical bytes, and projects the declared-item, result-item, and
policy-key populations from the derived report. The profile accepts no caller-authored
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

- `proof.pagination.snapshot-consistency@4.0.0` binds every declared page
  attempt and returned page to one immutable exact snapshot across a relevant
  live-source mutation, and compares the complete stable and interleaved ordered
  member-occurrence sequences.
- `proof.pagination.versioned-cursor-refusal@4.0.0` binds cursors and successful
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

`proof.authentication.direct-source-provenance@4.0.0` binds one exact captured
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

Outside any writing repository there is no cache root. Declaring a group still
succeeds, so importing the package, `--help` and repository-independent
description work from any directory; each declared validator refuses, when it is
called, with `validator_cache_root_unresolved`. Nothing is read, compiled or
published, and there is no alternate root.

The proof-intent metadata that the package exports as constants
(`PROOF_INTENT_ARTIFACT`, `PROOF_INTENT_DIGESTS`,
`PROOF_INTENT_DISCOVERY_CATALOG`, its digest and `PROOF_VERIFICATION_CAPABILITIES`)
is validated when the package is built, not at import. `npm run
build:intent-metadata` derives it through the same validators and writes
`proof-intents/metadata.v1.json`, which records the sha256 of every package input
it was derived from. Import reads that file and checks those bindings without
validating or compiling; a changed input refuses with
`proof_intent_metadata_stale` and an absent file with
`proof_intent_metadata_missing`, each naming the rebuild command. Startup does
not repeat full discovery or selection derivation inside or outside a writing
repository. Full semantic metadata parity is enforced by the builder's
`--check` mode. Startup hashing does not independently detect arbitrary edits
to metadata bodies or input lists, or changes to unhashed derivation/schema code.

Read-only catalog search (`discoverProofIntents`) is repository-independent. The
metadata also carries the admitted discovery population, and every discovery
result is checked by one package-built validator group: the same command
generates it through the cache's own compiler and writes it to
`validators/proof-intent-discovery-result/`, and `packagedCompiledValidators`
loads it through the cache's verified load path -- toolchain and schema identity
and code digest -- inside and outside Git. It never compiles or writes at load;
a missing or stale artifact refuses with `validator_packaged_artifact_unavailable`
and a corrupt one with the verifier's own code. This is the only package-built
group, not a second cache. Pack selection and authoring projections consume
profile and admission meaning parsed from the exact bytes already read for
hashing in their one metadata capture, including the checked catalogue's paths
and order. Their profile and admission digests come from that same metadata
document's discovery provenance, bound to the complete admitted population by
exact profile id and version. Duplicate, mismatched (including wrong-version),
and missing provenance identities refuse in that order, then in code-unit
identity order. A package maintainer rebuilds in the writing repository; an
installed consumer installs or reinstalls a corrected package.

Captured meaning is frozen and is not an admitted execution snapshot. Selection
and authoring remain synchronous and still require the repository-bound cache
for their validators; unavailable validators refuse with
`validator_cache_root_unresolved`. The capture retains source bytes privately only
until parsing and provides no live reload or cross-capture cache.

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
self-heals a containment violation. Every directory the publisher creates -- the
cache root, its missing ancestors, the toolchain directory, and each group
artifact -- is owner-only (`0700`) regardless of the process umask; an existing
directory keeps its mode, so unsafe pre-existing backing is never re-permissioned.

Validators behave exactly as their `ajv.compile` equivalents, including the
complete diagnostic surface: the boolean result and `errors` entries carrying
`instancePath`, `schemaPath`, `keyword`, `params`, and `message`.

Warming and diagnostics are optional and use the same cache:

```
node bin/prepare-validator-cache.mjs            # generate and publish on a miss
node bin/prepare-validator-cache.mjs --verify   # fail unless an exact artifact exists
node bin/prepare-validator-cache.mjs --json     # emit the status record
```

Neither form is a startup prerequisite and neither keeps a second cache. Runtime behavior and recovery are described in
[public validator startup guidance](../../docs/mcp-integration.md#controlled-contract-validator-startup).
The development-only runbook is not an installed-package prerequisite.

## Supported public surface

The published artifact contains the current stable-v1 runtime, bounded discovery,
selection, authoring, binding-inspection, proof-plan compilation, and assessment
commands, current schemas, the intrinsic
vocabulary, and compact admitted packs. Historical carriers, prototype policy
tools, pack fixtures, mutation corpora, coverage witnesses, and
release-certification executables are development sources and are not
published.
## Supported native-v1 surface

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

## Current proof definition format and certification

Proofs are declared during design and consumed after implementation. Definition
certification checks the adequacy of the reusable definition; it produces no
implementation evidence. Graph-pattern profile definitions, shared input and planning-result
schemas use v2; the bounded test-execution definition uses its closed v1 schema.
Saved-source proof execution results and authored obligation
coverage use v3. These versions describe separate contracts.
They contain no `evaluation_stages`, `required_by_stage`, or `evaluation_stage`.
Every graph-pattern satisfaction leaf is assessed under its substantive applicability and
binding semantics. Event ordering, observation intervals, complete populations,
controlled complements, exclusions and attribution requirements are unchanged.
There is no default stage, stage rank, inactive-rule credit or stage in a pack
identity, authoring offer, component selector or verification result.

Current schema identities include:

- `controlled-contract-verification-profile.v2`
- `controlled-contract-test-execution-profile.v1` (authenticated test execution)
- `controlled-contract-proof-pack-authoring.v2`
- `controlled-contract-proof-verification-result.v3` (saved-source execution)
- `controlled-contract-obligation-coverage.v3` (authored draft)
- `resolved-obligation-coverage.v1` (derived saved selections and design diagnostics)
- `controlled-contract-verification-profile-input.v2`
- `controlled-contract-component-exclusion-applicability.v2`
- `controlled-contract-verification-profile-result.v2`

Selection uses `controlled-contract-proof-pack-selection.v4`; embedded saved
authoring selections use their separately declared v3 contract.

Stable-v1 JavaScript evaluator names refer to the controlled-acceptance contract
and vocabulary family; their current proof definition, input and result formats
are v2. Selector indexes, proof resolutions, and assessment component-applicability
projections also use v2. No old-format parser or alias is supplied. Exact loading validates the
current closed definition schema and the exact profile/admission digests.
Retired definitions and their certifications are deleted, not kept as a
compatibility surface; see
[certification retirement and storage](../../docs/versioning.md#certification-retirement-and-storage).

The runtime catalog contains 37 selectable profile identities, each with
one current exact version. Ordinary profiles use 4.0.0; idempotency, forbidden
noninvocation and lossless projection use 5.0.0; test-validity uses 12.0.0.
The verifier consumes that same current test-validity identity. Its closed
`controlled-contract-test-execution-profile.v1` definition names the existing
authenticated execution evaluator, with no fixed behavioral graph pattern.
Native case authoring preserves authored requirement, verification and falsification
meanings. Definition assessment reports execution pending; passing execution,
detected mutations and traversal establish no assertion-to-requirement adequacy
or requirement-satisfaction credit. Retired
`proof.scope.write-confinement` is not selectable and has no catalog entry.
Historical cutover tables are not runtime selections. Use the
[generated current pack index](../../docs/proof-pack-parameters/index.md) or
`controlled-contract-discover-proof-intents` for the exact current population;
exact loading refuses obsolete pins instead of supplying compatibility.

`proof-obligation-runtime-resolver` consumes prepared native bindings and shared
saved-application resolutions. Its v3 results carry the selected definition,
resolved node and immutable execution-source binding, with no plan identities.
The verifier graph owner preserves native mandatory/disagreement semantics and
join arity. Shared design incompleteness is not runtime evidence or a prerequisite;
actual required-input and integrity failures prevent execution. The wiki-core
population resolver and MCP execution/detail/summary consumers use v3 together;
aggregate and summary remain v1, as do their lossless retrieval semantics.

`test/support/build-admitted-proof-pack-catalog.mjs` remains the publication
owner. It executes every current generic definition through
`runProofPackAdequacy(..., { variationMode: "full_census" })` and the one current
test-validity population through its existing execution certification owner. It never copies a historical passing result as
current certification. Changed profile, guarantee, adequacy, executable closure,
negative-fixture and witness bindings are regenerated before admission. The
result remains `experimental_local`, `authoritative: false`.

Each current definition's certification documents (adequacy declaration, negative
fixtures, witness index, corpus and full-census result) are stored in one
deterministic `test/certification/profiles/<id>/<version>/certification.json.gz`
archive beside an optional README. `test/support/certification-artifact.mjs` is
the single bounded reader and writer. Member bytes are the certified document
bytes, so fixture and witness digests are unchanged by storage. Runtime metadata
is read only from `profiles/<id>/<version>/`. The certification tree, generator and
test support are development-only and never enter the npm tarball. Storage bounds,
refusal codes and recovery are defined in
[Versioning](../../docs/versioning.md#certification-retirement-and-storage).

Certification is definition evidence, not delivered-implementation evidence.
Archived control counts describe their particular certified definition generation;
they are not current production execution totals. The build executes the current
certification owners and publishes only authenticated current definitions.
Validator declarations load independently of the admitted catalog, so schema
cutovers can be certified before their admissions exist.

## Proof obligation drafts

`validateObligationCoverageDraft`, `upsertProofAuthoringSelection`, and
`removeProofAuthoringSelection` operate on the single v3 authored representation.
Amendments preserve omitted values; explicit clearing is separate from JSON null.
Selections automatically bind exact admitted versions and definition digests.
`resolveProofAuthoring` consumes validated drafts and canonical context, including
the source owner's `source_digest`; it reports exact parameter, construction and
dependency facts without provider execution. Complete readers use
`validateObligationCoverageCarrier` on derived v1 mappings and reject raw drafts
as requiring resolution. No old-source parser or automatic migration is provided.

The package manifest still declares 0.11.0; current source edits are not a
new npm release. Existing implemented-capability bindings remain separate
from package version labels. Local packaging checks do not authorize a release or
republication under an existing release identity.

### Forbidden-operation noninvocation

`proof.operation.forbidden-noninvocation@5.0.0` uses the current grammar:
one identified subject `MUST_NOT reference:calls` any member of an exact,
complete, nonempty forbidden-operation population while the declared execution
context applies. A call to even one member violates the prohibition; calls by
another subject or outside that context do not. The positive-calls falsifier
and verification bind the same subject, context and complete population.

This corrects the former broad dependency/consumption guarantee to invocation.
The full-census certification exercises the declared proof model and its
synthetic controls. It establishes no actual execution or mutation result,
truthful grounding, unmodeled dynamic/reflection/environment calls, undeclared
operations, out-of-context calls, or production call-graph discovery. Runtime
publication contains only 5.0.0; saved selections are never automatically
rewritten or credited under the changed guarantee.
