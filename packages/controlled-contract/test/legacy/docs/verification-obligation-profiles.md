# Verification Obligation Profiles

> **Experimental design and status specification.** The frozen v0.1 and
> vocabulary-derived v0.2 profile schemas, deterministic matcher, local CLI,
> and P1-P4 reference packs are implemented under `packages/controlled-contract`.
> P1-P3 fixed-fixture migration (including the implemented P2/P3 packs), the
> broader pack catalog, applicability policy,
> and authoritative resolver/evidence integrations remain pending. Nothing here
> is CCE authority, evidence sufficiency, dispatch
> admission, or a claim that arbitrary proof plans can be judged semantically.

## Purpose

The native contract carrier can say:

```text
verification V verifies behavior B
verification V names falsifying proposition F
```

The exact resolver can determine that those objects and edges exist, whether a
closed behavior population has verification coverage, and whether several
behaviors share one verifier or falsifier. It cannot generally determine that
the planned proof discriminates the behavior it names.

For example, this is a falsifiable test plan:

```text
issue one transfer request
assert status 200
```

It can fail when routing, authentication, or availability is broken. It does not
distinguish an idempotent transfer implementation from one that creates a second
transfer when the request is repeated.

A verification obligation profile supplies the missing behavior-specific proof
contract. For idempotency, it can require two equivalent invocations, observations
of the relevant effect, and a comparison showing that the second invocation
produced no additional effect. A particular work contract binds the abstract
operation, request equivalence, effect, and result equivalence.

The intended boundary is:

```text
controlled-contract substrate
  represents claims, relations, collections and falsifiers

verification obligation profile
  defines the controlled graph pattern accepted as planned proof

contract binding
  supplies the concrete operation, inputs, effects and identities

evidence resolver
  later establishes authoritative static facts or delivered execution evidence
```

The profile is not a natural-language instruction to a model. It is a versioned,
schema-valid controlled graph pattern evaluated deterministically.

These are proof profiles, not test templates. A behavioral profile may require a
planned experiment. A structural profile may instead require a code-graph fact,
an export-population fact, or a type/shape fact. An enforcement profile may
require an authority-owned observation such as the actual mutation set or runtime
namespace. Composite profiles can require more than one of those proof sources.

## Design principles

### Profiles define acceptable proof, not truth

A pre-dispatch profile result establishes that the authored proof plan contains a
required controlled pattern. It does not establish that source code implements the
behavior or that a delivered test implements the plan.

### Pack selection is external to the contract author

An author must not evade an idempotency profile by declining to select it. The
profile evaluator consumes an externally supplied applicable-profile set. In the
experiment this set is a frozen local input. In production, organization policy or
CCE would own applicability and authorization.

`no_applicable_profile` is an explicit result, not a clean result.

### Profiles reuse the controlled language

Profiles do not introduce free-text predicates or a second grammar. Proposition
patterns use controlled operators, value kinds, applicability modes, type
terms, modalities, claim kinds, relation roles and collection kinds. Profile-local
role names are placeholders bound to typed contract references; they are not new
contract vocabulary.

The v0.2 schema derives its proposition language from the intrinsic
`cv.experimental.0.34` artifact and binds that artifact's signature, algebra,
definitions, and complete digests. The complete artifact remains authoritative for validation; queried
authoring slices are advisory context only.

If a pack cannot express its required pattern with controlled fields, that is a
vocabulary or carrier gap to evaluate. It must not be hidden in an explanatory
string.

### Proof mode is explicit

A profile obligation selects one of three existing satisfaction families:

- `authored_claim`: the planned contract contains a matching controlled claim or
  relation pattern;
- `authoritative_resolver_fact`: an owning resolver attests a required static or
  runtime fact; or
- `delivered_evidence`: post-delivery evidence establishes the obligation.

A composite profile can require all of several obligations or permit controlled
alternative proof branches. An alternative is schema data, not prose discretion.

### Structural guarantees remain separate from semantic adequacy

The evaluator can prove that a contract matches the selected profile. The selected
profile remains an organization or domain assertion about what counts as adequate
proof for that behavior class.

Every implemented pack must therefore carry an executable adequacy contract in
addition to schema-valid patterns. That contract names positive implementations,
inadequate mutants the pack must reject, profile-level rejections,
explicit exclusions, and expected outcomes across materially different storage
implementations. A
passing pattern matcher is not evidence that the pattern list entails the
property named by the pack.

The declaration validates against
`schema/controlled-contract-proof-pack-adequacy.experimental.v0.1.schema.json`.
It binds the guarantee digest and canonical profile digest and declares a
standardized executable module. The module independently reports the exact
profile digest its controls cover, so a re-digested weakening cannot make the
controls silently move with the profile. The pack loader refuses a missing,
stale, identity-mismatched, or orphaned declaration. The adequacy runner validates the
module result against
`schema/controlled-contract-proof-pack-adequacy-run.experimental.v0.1.schema.json`
and requires every declared control to execute exactly once. Neither declaration
nor result is delivered evidence for a consuming contract.

An adequacy declaration may additionally pair `negative_contract_fixtures` with
`guarantee_critical_profile_surfaces` and an explicit
`noncritical_profile_surfaces` partition. Each fixed negative fixture is a separate
digest-bound JSON document that contains a contract and evaluation input but no
candidate profile. The loader derives mandatory coverage for claim deletion,
claim modalities, reference-role types, semantically viable cardinality
broadenings, bindings, falsifier contexts, individual collection semantics,
relations, and satisfaction branches. It fails closed on unknown or unclassified
profile fields, validates the bounded reasons permitted for noncritical aggregates,
and requires exact bidirectional fixture-to-surface and weakening-class bindings.
Nested claim semantics are recursively classified at stable pattern-derived IDs:
required stage, claim kind, modalities, proposition and falsifier subject/operator,
applicability mode and roles, every semantic operand leaf, and verification methods.
An unclassified leaf fails closed. A noncritical leaf is accepted only when the
validator recomputes that every controlled independent alternative is schema- or
semantics-invalid, every remaining numeric alternative is directionally strict
strengthening, or a separately classified falsifier surface mechanically forces the
same value. A missing witness or an exact-match substitution is not a noncritical
reason. Aggregate leaves may use `no_valid_weaker_profile_value` only when the
runtime mechanically establishes the closed domain: an intrinsic nonnegative-
integer cardinality number role, an already-subsequence sequence, a closed-set
exact match, or a collection whose required stage is the profile's only stage.

One fixture may carry a fixed `variations` census: a profile-independent base
contract/input plus digest-bound, replace-only contract and input patches. Expansion
is deterministic and fails closed on missing, ambiguous, conflicting, or no-op
targets. Every expanded contract/input pair receives a canonical digest in the
result.

The declaration also binds one `coverage_witness_index`. It contains exactly one
replace-only weakened-profile witness for every critical-surface/weakening/fixture
binding. Each witness must change the exact value of the surface it names through
an exact, ancestor, or descendant replacement and may additionally patch
non-overlapping mechanically coupled surfaces. It binds the complete weakened-
profile digest and names the exact fixed-fixture variant that must become satisfied.
The loader refuses missing, extra, stale, mis-tagged, overlapping, or no-op
witnesses. The adequacy runner applies every witness, requires its named negative
fixture to survive, restores the exact named surface and rejects any still-valid
survivor, then removes every whole patch in turn and rejects any surviving
ablation. This makes causal rebound discrimination part of pack admission rather
than a repository-test convention.

Ordinary admission uses the versioned structural index. It discharges only a
recognized single semantic dimension with an exact claim binding and evaluator-exact
value mismatch; mixed or unknown dimensions are evaluated. Each variation result
states the index version and mode and counts total expanded, structurally discharged,
and evaluated variants. Release/review census runs use
`check-proof-pack.mjs --variation-mode full_census`, which evaluates every expanded
variant. `semantic-variation-census.test.mjs` additionally rebinds the candidate
profile to every fixed variant and requires indexed/full parity and zero canonical
survivors.

The runner evaluates the captured fixture bytes against the captured candidate profile and
fails on a satisfied, indeterminate, malformed, missing, stale, ambiguous, or
mismatched fixture. Fixture authorship and review remain responsible for whether
the witness is substantively relevant to the declared surface.

The fixed-fixture mechanism is optional only as a migration boundary. P1 through
P4 are migrated: idempotency carries 44 fixed fixtures over 119 critical surfaces,
refusal-before-effects carries 32 over 76, atomicity carries 62 over 183, and
failed-attempt nonconsumption carries 85 over 157. A fixture may
cover more than one type surface when profile roles intentionally share one
bound reference. Each migrated pack retains its independent executable controls;
the fixed corpus is an additional gate rather than a generated view of those
controls or of the candidate profile.

### Missing facts remain missing

An unavailable resolver, unbound role, missing claim pattern, or absent delivered
evidence produces a typed unsatisfied or indeterminate result. It never becomes an
implicit pass.

## Proposed profile carrier

Current schema identity:

```text
controlled-contract-verification-profile.experimental.v0.2
```

This shape is now emitted as the tracked experimental profile schema. Its
matching semantics and current limitations are documented in
`docs/verification-profile-sdk.md`.

```json
{
  "schema_version": "controlled-contract-verification-profile.experimental.v0.2",
  "profile_id": "proof.idempotency.effect-nonduplication",
  "profile_version": "2.0.0",
  "contract_schema_version": "controlled-acceptance-contract.experimental.v0.2",
  "vocabulary_version": "cv.experimental.0.34",
  "vocabulary_signature_digest": "<sha256>",
  "vocabulary_algebra_digest": "<sha256>",
  "vocabulary_definitions_digest": "<sha256>",
  "vocabulary_complete_digest": "<sha256>",
  "falsifier_condition_bindings": [],
  "evaluation_stages": ["pre_dispatch", "post_delivery"],
  "reference_roles": [],
  "claim_patterns": [],
  "relation_patterns": [],
  "collection_patterns": [],
  "resolver_fact_patterns": [],
  "evidence_patterns": [],
  "satisfaction_expression": {},
  "unresolved_effect": "review_required"
}
```

### Profile identity

- `profile_id` is a stable namespaced identity.
- `profile_version` changes when accepted proof semantics change.
- The evaluator result binds both values.
- Display title, rationale and examples belong in documentation or
  nonoperative metadata. They do not control evaluation.

### Reference roles

Each role declares a typed placeholder:

```json
{
  "role": "operation",
  "allowed_type_terms": ["cc:operation"],
  "cardinality": "exactly_one"
}
```

Proposed cardinalities:

- `exactly_one`
- `one_or_more`
- `zero_or_more` (v0.2 only)
- `zero_or_one`

Role bindings are supplied separately from the profile. This permits the same
profile to bind to a payment operation, queue submission, database create, or
another domain without changing the profile graph.

The v0.2 profile can bind a closed contract population with a
`complete_population` reference-binding pattern. The population identity uses
an `exactly_one` role and its complete member list uses `one_or_more` or
`zero_or_more`. A claim pattern can then use `for_each` to introduce one fresh
local member role and require the proposition or verification-falsifier pair for
every bound member. This is aggregate universal matching, not expansion into
independently addressable claim patterns.

### Claim patterns

A claim pattern reuses the current proposition-template shape and adds an optional
falsifier template for verification claims:

```json
{
  "pattern_id": "second-invocation",
  "required_by_stage": "pre_dispatch",
  "satisfaction_mode": "authored_claim",
  "claim_kind": "behavior",
  "allowed_modalities": ["MUST"],
  "proposition_template": {
    "subject_role": "second_invocation",
    "operator": "reference:performs",
    "applicability_context": {
      "mode": "after",
      "operand_roles": ["first_invocation"]
    },
    "operands": [
      { "kind": "reference", "role": "operation" }
    ]
  }
}
```

A verification pattern can additionally require:

```json
{
  "verification_method": ["test_execution", "analysis"],
  "falsifying_proposition_template": {
    "subject_role": "effect_after_second",
    "operator": "reference:not_equals",
    "applicability_context": {
      "mode": "when",
      "operand_roles": ["duplicate_effect_enabled"]
    },
    "operands": [
      { "kind": "reference", "role": "effect_after_first" }
    ]
  }
}
```

The falsifier is counterfactual because it occupies
`falsifying_proposition_template`; `when` only names its triggering condition.
Counterfactual is not a v0.34 applicability mode. The exact final shape avoids
duplicating the native claim schema. A profile
pattern describes constraints on carrier objects; matched contract objects remain
the only operative claims.

### Relation patterns

The current organization-policy prototype matches claims but not required
claim-to-claim relations. Proof profiles need relation patterns:

```json
{
  "pattern_id": "proof-verifies-idempotency",
  "role": "verifies",
  "source_claim_pattern_id": "idempotency-verification",
  "target_claim_pattern_id": "idempotency-behavior"
}
```

Relation patterns can also require `precedes`, `depends_on`, or `refines`. The
evaluator matches pattern endpoints to the concrete claim identities selected for
their claim patterns.

Required relation matching is the first material extension beyond
`prototype-org-authorization.mjs`.

### Collection patterns

Profiles may require a closed set or ordered sequence of matched claims:

```json
{
  "pattern_id": "invocation-sequence",
  "collection_kind": "ordered_sequence",
  "member_claim_pattern_ids": [
    "first-invocation",
    "first-observation",
    "second-invocation",
    "second-observation",
    "effect-comparison"
  ]
}
```

An ordered collection states that the proof plan includes an authored order. It
does not itself prove that delivered execution followed that order.

### Authoritative resolver-fact patterns

Static or enforcement-oriented profiles can require facts rather than tests:

```json
{
  "pattern_id": "no-production-reachability",
  "required_by_stage": "pre_dispatch",
  "satisfaction_mode": "authoritative_resolver_fact",
  "resolver_kind": "code_reachability",
  "fact_key": "no_path",
  "argument_roles": ["production_root", "dormant_component"]
}
```

The profile evaluator validates that the fact is present, bound to the required
roles, issued by the selected resolver, and satisfied. The resolver owns the fact's
truth semantics. The profile evaluator must not reimplement code reachability,
sandbox enforcement, namespace resolution, or another external authority.

The current prototype accepts a bare `fact_key`. The proposed profile must bind
facts to arguments and resolver identity to prevent an unrelated true fact from
satisfying an obligation.

### Delivered-evidence patterns

Post-delivery profiles can require evidence bound to a planned verification:

```json
{
  "pattern_id": "idempotency-test-executed",
  "required_by_stage": "post_delivery",
  "satisfaction_mode": "delivered_evidence",
  "evidence_kind": "test_result",
  "verification_claim_pattern_id": "idempotency-verification"
}
```

A stronger pattern can require evidence that a named falsifier or mutation was
executed and changed the verification result from pass to fail. That extension is
not required for the first pre-dispatch experiment.

### Satisfaction expression

The profile combines patterns with a closed boolean structure:

```json
{
  "all_of": [
    { "pattern": "idempotency-behavior" },
    { "pattern": "proof-verifies-idempotency" },
    { "pattern": "invocation-sequence" },
    {
      "any_of": [
        { "pattern": "effect-equivalence-comparison" },
        { "pattern": "no-cardinality-increase-comparison" }
      ]
    }
  ]
}
```

Only `all_of`, `any_of`, and pattern references are proposed initially. Negation is
expressed through existing modalities and controlled predicates, not a second
boolean language. Arbitrary scripts or expressions are forbidden.

## Evaluation inputs and result

The deterministic evaluator receives:

```text
native controlled contract
selected profile identities and versions
profile-local reference bindings
authoritative resolver fact attestations
delivered evidence attestations
evaluation stage
```

The result keeps separate axes:

```json
{
  "profile_valid": true,
  "binding_valid": true,
  "evaluation_stage": "pre_dispatch",
  "satisfaction": "unsatisfied",
  "fact_completeness": "complete",
  "authority": {
    "kind": "prototype_local",
    "authoritative": false
  },
  "matched_patterns": [],
  "unmatched_patterns": [],
  "indeterminate_patterns": [],
  "diagnostics": []
}
```

Proposed satisfaction values:

- `satisfied`
- `unsatisfied`
- `indeterminate`
- `invalid`

The local experiment emits no allow/refuse result. A later policy layer decides the
effect of an unsatisfied or indeterminate mandatory profile.

## Pack taxonomy

Profiles are classified by acceptable proof source, not by product domain.

### Behavioral experiment profiles

These require planned stimuli, observation points and assertions:

- repeat safety and effect idempotency;
- atomicity under injected failure;
- failed-attempt nonconsumption;
- single-use consumption and replay refusal;
- readiness before success;
- failure settlement and cleanup; and
- cancellation or generation isolation.

### Static structural profiles

These primarily require authoritative resolver facts:

- dependency acyclicity;
- no production reachability to a dormant component;
- forbidden import or call absence;
- complete export or member population;
- result shape and required members; and
- architecture ownership topology.

### Runtime enforcement profiles

These require enforcement or audit facts stronger than a sampled test:

- observed writes remain within authorized scope;
- a capability belongs to an exact owner;
- a process executes in the required namespace;
- an unauthorized operation creates no protected mutation; and
- a secret or authority is unavailable to the agent process.

### Composite profiles

These require multiple proof families:

- dormant construction succeeds directly while remaining production-unreachable;
- a projection is structurally coherent and behaviorally executable;
- authorization refusal occurs before effects and preserves later valid authority;
- a migration preserves a closed observable population and remains within scope.

## Initial pack specifications

The first pressure test should use three profiles whose proof shapes differ.

### Pack P1: repeat safety and effect nonduplication

Frozen first-evaluation identity:

```text
proof.idempotency.effect-nonduplication@1.0.0
```

Version 1.1 keeps the assertion outside the four-step temporal sequence and
permits a controlled cardinality comparison whose expected number is supplied
by a typed numeric binding. It is frozen as the work record pressure-test artifact.

Version 1.2 additionally requires distinct invocation and observation roles and
requires the selected verification to cover both cardinality behaviors. It is
frozen as the second pressure-test artifact.

Version 1.3 is frozen after its pressure test. It models one affected resource
through two distinct state snapshots and requires a contiguous temporal proof
spine. Its adjacency rule is intentionally not carried forward: it rejects
harmless interleaving and a parallel clean sequence can conceal a polluted one.

Version 1.4 replaces adjacency
with an explicit observation before the second invocation, a
between-invocation continuity behavior, and a verification claim whose falsifier
is an intervening reset. Its ordered collection preserves relative order and
requires every declared sequence covering the full proof population to agree.

Version 1.5 separates distinct
observation occurrences from the `cc:state` values they record. Several
observations may record the same unchanged state reference, while the observation
artifacts remain distinct. It also accepts `proof` as a verification method.
Its pressure test found that the first and pre-second state roles were not
required to bind the same reference and that a clean closed set could conceal a
parallel polluted covering set. It is frozen as a rejected historical version.

Version 1.6 requires literal
state continuity between the first and pre-second observations, applies
all-covering consistency to the exact proof population, and restricts caller-
bound effect cardinality to a nonnegative integer.
Its pressure test found a vacuous final-state falsifier, reset/final state
aliasing, and over-broad closed-set comparison. It is frozen as a rejected
historical version.

Version 1.7 gave the behavioral-equivalence and cardinality branches separate
verification falsifiers, scoped final-state distinctness to the equivalence
branch, and introduced purpose-scoped proof populations. Its pressure test found
that `reference:not_equals` is not the controlled complement of
`reference:behaviorally_equivalent`; it is frozen as a rejected historical
version.

Version 1.8 corrected the exact-state branch but is frozen as rejected: its
cardinality behavior used `number:has_cardinality` while its falsifier used
`number:not_equals`, and one final-state falsifier was also allowed to discharge
an unrelated semantic-input-equivalence behavior.

The final frozen v0.33 identity is
`proof.idempotency.effect-nonduplication@1.9.0`. The current v0.34 identity is
`proof.idempotency.effect-nonduplication@2.0.0`. Version 2.0 is an equality-only
sequential three-observation complete-state proof for one elected durable effect resource. It
binds all four vocabulary digests and opts into vocabulary-derived
controlled-complement validation for every profile-authored verification
target. Cardinality stability, concurrency, partial-failure recovery, and
idempotency-key scope are separate obligations rather than weaker alternative
branches. Distinct-but-semantically-equivalent inputs remain deferred until the
vocabulary carries semantic inequality; this pack requires literal input reuse.
Intervening reset or mutation history is also outside the guarantee: the pack
compares three declared observations and does not infer trajectories between them.

Required roles:

- `operation`: exactly one `cc:operation`;
- `first_invocation`: exactly one `cc:event`;
- `second_invocation`: exactly one `cc:event`;
- `first_input` and `second_input`: exactly one `cc:entity`,
  `cc:configuration`, or `cc:artifact` each;
- `effect_subject`: one affected durable `cc:resource` that the operation is
  declared to write;
- `state_after_first` and `state_before_second`: distinct `cc:state` observations
  whose equality is explicitly asserted and falsified;
- `state_after_second`: a `cc:state` value compared with the first state;
- `observation_after_first`, `observation_before_second`, and
  `observation_after_second`: distinct `cc:artifact` or `cc:evidence` records;
- `intervening_reset_condition`: exactly one `cc:state` or
  `cc:configuration`;
- `duplicate_effect_condition`: exactly one `cc:state` or
  `cc:configuration`;
- `verification`: exactly one `cc:test` or `cc:process`.

The reset and duplicate-effect condition roles must bind distinct references so
the two verification falsifiers cannot collapse onto one condition.

Required pre-dispatch pattern:

1. first invocation performs the operation;
2. second invocation performs the operation after the first;
3. each invocation uses the same contract-bound input reference;
4. distinct observation records capture the subject's state after the first
   invocation, before the second, and after the second, and the verification
   reads each record;
5. the immediately pre-second state is required to equal the first observed state
   before the second invocation, and its verification is falsified by controlled inequality
   under the intervening-reset condition;
6. the temporal spine is declared both as an ordered sequence and as an exact
   closed proof population; every declared covering collection must conform, so
   a parallel clean population cannot conceal a polluted one;
7. outside that temporal sequence, the final state is required to equal the
   first state using distinct references;
8. the equality verification's falsifier requires unequal state values under
   the duplicate-effect condition, and each verification relation separately
   binds its intended falsifier condition; and
9. the ordered proof sequence declares purpose `profile_proof_sequence`, the
   exact closed proof population declares purpose
   `profile_proof_population`; covering collections with another purpose are
   surfaced as an advisory mismatch; every collection claiming the selected
   proof-sequence or closed-population purpose, including a disjoint one, must
   conform.

Response bytes cannot be elected as the effect resource. The executable
adequacy contract demonstrates that response equality may survive a duplicate
durable effect.

Canonical invalid plan:

```text
one invocation
assert status 200
```

Expected unmatched patterns:

- second invocation;
- second observation;
- complete-state equality over the elected durable effect resource; and
- duplicate-effect falsifier.

The same domain-neutral proof shape is exercised against three storage
architectures:

- payment request -> complete durable charge-state observation;
- queue submission -> complete durable queue-state observation; and
- database creation -> complete durable database-state observation.

### Pack P2: authorization refusal before protected effects

Implemented identity:

```text
proof.authorization.refusal-before-effects@1.0.0
```

The pack binds one attempt occurrence, reusable operation, authority,
unauthorized subject, refusal, protected-interval witness, exact caller-supplied
protected-effect population, and verification. The authority must not authorize
the subject for the operation; the attempt must perform the operation, use the
subject, precede the interval witness, and be rejected by the refusal after that
witness. Pointwise `MUST_NOT` write and mutation obligations cover every protected
member before refusal. The verification reads the exact attempt, refusal,
operation, and protected population; its positive same-attempt write and mutation
propositions are the corresponding falsifiers.

The executable adequacy contract contains 59 controls across capability-channel,
cross-tenant record/index, and unauthenticated queue/deduplication domains. It
rejects status-only evidence, incomplete populations, unrelated falsifiers, role
collapse, and temporal concealment. Production-path discovery, truthful grounding,
evidence authority, applicability, and completeness beyond the declared population
remain explicit exclusions.

### Pack P3: atomic compound operation

Implemented identity:

```text
proof.atomicity.failure-boundary@1.0.0
```

The pack binds one compound-operation attempt, an exact caller-supplied
constituent-effect population of at least two members, an ordered earlier/later
effect pair, a failure boundary between that pair, an injected failure, and a
settlement event after both the failure and later effect. Settlement observations
cover the population and classify the settled result into a closed two-member set:
fully committed or fully uncommitted. A declared partial state is excluded, and
membership outside the allowed set is the verification falsifier.

The executable adequacy contract contains 46 controls across ledger,
catalog/event-publication, and multi-resource platform stores. It kills partial,
torn, repaired-after-settlement, missing-failure, and wrong-boundary executions;
it also independently rejects incomplete populations, count disagreement,
unclassified results, temporal cycles, and guarantee-critical profile deletion.
Transient pre-settlement state, concurrency, resources outside the declared
population, and per-effect obligations beyond the pinned boundary pair remain
explicit exclusions.

### Pack P4: failed-attempt nonconsumption

Implemented identity:

```text
proof.authorization.failed-attempt-nonconsumption@1.0.0
```

The pack binds one failed attempt and refusal, one distinct later valid attempt,
one legitimate authority reused by both attempts, distinct unauthorized and
authorized inputs, complete authority-state observations before the failed attempt
and after refusal, and one expected successful result state. One verification
proves equality of the two authority-state observations. A separate verification
proves that the later result state equals the declared expected success state.
Each verification has its own controlled inequality falsifier and condition.

The executable adequacy contract contains 59 controls across channel capability,
tenant lease, and queue permit implementations plus 79 digest-bound fixed
negative fixtures covering the mechanically required profile surfaces. Persistent consumption,
replenishment only after the post-refusal observation, later-use failure,
different-authority substitution, and missing refusal are executed mutants.
Transient consume-and-restore before observation, concurrency, truthful grounding,
and refusal-before-effects remain explicit exclusions.

## Implemented and candidate follow-on packs

P1-P7, P9, P10, P12, and P14 now show that one profile carrier can express
repetition, authorization refusal, ordering, failure injection, state
preservation, later successful use, result populations, recoverable projection,
ownership isolation, and cancellation isolation without domain-specific terms.
The remaining candidates extend that demonstrated carrier rather than redesigning
it.

| Priority | Status | Pack | Principal distinguishing requirement |
|---|---|---|---|
| P5 | implemented | single-use and replay refusal | first valid use succeeds exactly once; replay refuses without duplicate effect |
| P6 | implemented | readiness before success | capability is usable at or before reported completion |
| P7 | implemented | failure settlement and cleanup | injected failure, settled state, closed residue population, preserved cause |
| P8 | candidate | behavioral preservation | closed observable population compared against frozen baseline |
| P9 | implemented | result shape conformance | result type and closed required-member population, plus forbidden shapes |
| P10 | implemented | exact ownership and isolation | cross-owner refusal plus nonconsumption of legitimate authority |
| P11 | deferred | dormancy and nonactivation | direct construction succeeds; authoritative graph proves no production reachability |
| P12 | implemented in lossless projection | projection coherence | projections share source identities and recovered population equals the complete source |
| P13 | deferred | write-scope confinement | observed mutation set is a subset of authorized closed set |
| P14 | implemented | cancellation isolation | cancelling one generation does not alter another generation |

Advanced concurrency, linearizability, eventual convergence, distributed
exactly-once delivery and bounded-resource profiles are explicitly deferred. They
require more formal semantics or authoritative execution traces and should not
shape the first carrier.

## Pressure-test protocol

Each profile is frozen before evaluating its fixtures. Profile changes after seeing
an outcome create a new profile version and a correction record.

For each profile, use at least two unrelated domains and the following frozen plan
classes:

1. minimal discriminating plan;
2. superficially relevant but nondiscriminating plan;
3. missing stimulus or failure injection;
4. correct stimulus but wrong observable;
5. correct observations but missing comparison;
6. incorrect ordering;
7. one broad verifier masking several required members;
8. valid alternative proof branch;
9. negative applicability control; and
10. thin contract omitting one required role.

The audit records:

- schema validity;
- binding validity;
- matched, unmatched and indeterminate patterns;
- deterministic result under repeated evaluation;
- invariance under role/reference renaming and array ordering;
- false acceptance of a nondiscriminating plan;
- false refusal of a discriminating alternative;
- vocabulary or carrier gaps exposed by the profile; and
- any repository- or domain-specific token required by the supposedly general
  profile.

### Initial success conditions

The P1-P3 experiment succeeds only if:

- every frozen nondiscriminating plan is unsatisfied;
- every frozen minimal discriminating plan is satisfied;
- the same frozen profile works in at least two unrelated domains;
- no result depends on a model judgment at evaluation time;
- profile evaluation invents no reference, relation or proposition;
- missing applicability, role binding or resolver facts remain explicit;
- a profile failure identifies missing controlled patterns rather than emitting a
  generic quality judgment; and
- pressure testing does not require product-specific vocabulary in the profile.

### Kill conditions

Pause generalization if:

- profiles need free-text semantic predicates to distinguish their fixtures;
- a valid alternative proof requires arbitrary executable code inside the profile;
- pattern matching becomes an unrestricted theorem prover rather than bounded
  graph matching;
- pack applicability can be self-selected by the contract author without an
  external completeness signal;
- satisfaction requires trusting a claim's `verifies` label without matching the
  required proof subgraph; or
- P1-P3 require incompatible carrier models that cannot be expressed as controlled
  alternatives.

## Implemented v0.1 boundary and remaining prototype work

The implemented v0.1 includes:

1. a versioned profile JSON Schema;
2. deterministic validation for profile IDs, role cardinality and pattern
   references;
3. claim-pattern matching by extending the existing proposition-template matcher;
4. relation-pattern and ordered-collection matching;
5. all-of/any-of satisfaction over matched pattern IDs;
6. argument-bound resolver facts;
7. exact unmatched-pattern diagnostics;
8. P1 fixtures and adversarial tests across three unrelated domains; and
9. a local result explicitly marked non-authoritative.

P2 and P3 fixtures, the remaining candidate packs, and broader corpus pressure
testing remain future experimental work.

It would not add:

- CCE policy or organization pack selection;
- an LLM judge;
- arbitrary profile scripts;
- delivered test inspection;
- mutation execution;
- runtime evidence attestation; or
- public adoption of any pack.

## Open design questions

1. Whether claim patterns should reuse `prototype-org-authorization` schema
   definitions directly or both should consume a shared template module.
2. Whether proof-plan events should be ordinary `cc:event` references and behavior
   claims, or whether the native carrier needs a distinct plan-step object.
3. Whether later packs need claim-level `precedes` relation patterns in addition
   to v1.4's all-covering ordered-sequence consistency.
4. How a future vocabulary should represent a mechanically complementary
   semantic-inequality predicate. Version 2.0 deliberately requires literal
   input reuse because v0.34 explicitly declares no controlled complement for
   `reference:semantically_equivalent` or
   `reference:behaviorally_equivalent`.
5. How authoritative resolver facts bind resolver identity, arguments, source
   digest and freshness without duplicating the production authority envelope.
6. Whether applicability is supplied solely as an external selected-profile set or
   can also be derived from authoritative classification facts.
7. Whether one profile can depend on another profile, and if so whether dependency
   composition remains acyclic and version-bound.

Falsifier counterfactual status is now carried by its verification role rather
than an applicability term. Questions 5-7 are
production-policy and integration concerns and must not block a local
non-authoritative matcher experiment.
