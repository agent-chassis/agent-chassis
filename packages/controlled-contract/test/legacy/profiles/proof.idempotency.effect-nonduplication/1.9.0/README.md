# Idempotency Effect-Nonduplication 1.9.0

This free-tier local profile checks whether a declared pre-dispatch proof plan
can discriminate an effect-nonduplication failure. It is deterministic,
non-authoritative, and domain-neutral. It evaluates only the supplied controlled
contract and bindings; it does not execute the operation or establish honest
grounding.

## Correction from 1.8.0

Version 1.8 corrected the exact-state branch but retained two unsound proof
shapes: its cardinality behavior used `number:has_cardinality` while its
falsifier used `number:not_equals`, and the final-state falsifier also discharged
an unrelated semantic-input-equivalence behavior.

Version 1.9 enables
`verification_falsifier_policy: controlled_complement_per_target`. Under that
policy every profile-authored `verifies` relation must connect one verification
falsifier to a behavior with:

- the same controlled subject role;
- the same controlled operands; and
- a registered complementary operator.

An inconsistent pack is profile-invalid before contract evaluation. Frozen
profiles remain replayable because the policy is opt-in.

## Required proof spine

Both proof branches require:

1. one operation invoked twice;
2. literal reuse of the same input reference;
3. state and observation records after the first invocation;
4. a distinct state and observation record immediately before replay;
5. an explicit equality behavior between the pre-replay and first-run states,
   with an inequality falsifier under the reset condition;
6. state and observation records after the second invocation;
7. an ordered sequence with purpose `profile_proof_sequence`; and
8. an exact closed set with purpose `profile_proof_population`.

The first-run, pre-replay, and second-run observation occurrences must be
distinct. The first-run and pre-replay state references must also be distinct;
their equality is an asserted and falsifiable behavior rather than a vacuous
self-comparison.

## Proof branches

### Exact-state equality

The final state MUST `reference:equals` the first-run state. Its verification
MUST fail under the duplicate-effect counterfactual when the final state
`reference:not_equals` the first-run state.

The two state roles remain distinct references. Equality therefore expresses a
declared semantic result rather than reference collapse.

### Positive final cardinality

The final observation record MUST `number:equals` the caller-bound expected
effect cardinality. Its verification MUST fail under the duplicate-effect
counterfactual when that observation `number:not_equals` the expected value.

The expected value is an integer with minimum `1`. This branch proves a known
positive final invariant after replay; it does not claim that two arbitrary
cardinality predicates are equivalent, and it does not accept a zero-effect
operation as an idempotency proof.

## Input limitation

Version 1.9 accepts only literal input reuse. Distinct-but-semantically-
equivalent inputs are deliberately deferred because vocabulary 0.33 has
`reference:semantically_equivalent` but no controlled complementary operator.
Reusing a final-state falsifier to verify input equivalence would reproduce the
1.8 defect. A future vocabulary version may restore the broader branch with an
explicit semantic-inequality complement and a dedicated verification.

## Collection accountability

Every declared same-purpose sequence covering the proof spine must preserve its
relative order. Every declared same-purpose closed set covering the proof
population must be exact.

The evaluator additionally reports, without changing satisfaction:

- complete covering collections excluded by purpose;
- non-covering overlaps with their shared, missing, and extra members; and
- disjoint same-purpose collections.

Absence of an all-covering collection emits `collection_pattern_no_candidate`.
These diagnostics make alternative authored populations visible; they do not
infer that an alternative purpose is dishonest.

## Limits

This profile proves conformance to a declared proof shape. It cannot discover an
undeclared operation, dishonest identity alias, incorrectly implemented test,
or delivered behavior. Resolver-backed grounding and post-delivery evidence are
separate stages. `satisfied` remains free-tier local and non-authoritative.
