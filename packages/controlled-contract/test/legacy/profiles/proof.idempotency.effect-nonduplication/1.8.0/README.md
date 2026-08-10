# Effect-nonduplication idempotency profile 1.8.0

This version corrects the semantic falsifier mismatch found in the 1.7.0
pressure test. The equality branch now requires exact equality between the first
and final effect states. Its counterfactual `reference:not_equals` proposition
is therefore the controlled complement of the required behavior, rather than a
different predicate from `reference:behaviorally_equivalent`.

On the exact-equality branch, the final state must be a distinct
reference from the first state. That requirement is branch-scoped: the
cardinality branch may reuse one state reference because its before/after
cardinality assertions remain distinct through their temporal contexts.

The counterfactual reset binds a separate state reference. The continuity
verification's falsifier requires the affected subject to acquire that state
under the reset condition. The reset state must be distinct from both the first
and final states.

The three observation references remain distinct artifacts or evidence records.
The final post-second state may be the same state reference on the cardinality
branch or a distinct reference asserted exactly equal to the first state on the
equality branch.

Each temporal observation has three controlled facts:

1. the affected subject has the bound state in the relevant temporal context;
2. a distinct observation artifact records that state; and
3. the selected verification reads that observation artifact.

The required relative order is:

```text
first invocation
-> first subject state
-> first observation record
-> verification reads first observation
-> pre-second subject state
-> pre-second observation record
-> verification reads pre-second observation
-> second invocation
-> second subject state
-> second observation record
-> verification reads second observation
```

Harmless claims may be interleaved. Every declared ordered sequence containing
the complete population must preserve this order.

The contract must also declare those eleven claims as one exact `closed_set`
with purpose `profile_proof_population`. Every covering closed set with that
purpose must match exactly, so a parallel clean set cannot conceal a polluted
set serving the same purpose. A broader population with another declared purpose
does not fail the pattern. Covering populations excluded only by purpose are
reported as `collection_covering_purpose_mismatch`; purpose relabeling is thus
visible but remains advisory because the local matcher cannot determine intent.

The first state must persist until the second invocation. A separate continuity
verification uses an intervening-reset falsifier. The final comparison is either
exact state equality or matching caller-bound cardinality. Each branch
has its own verification pattern: exact equality is falsified by unequal final
state, while cardinality is falsified by a final cardinality unequal to the
caller-bound expectation. Cardinality bindings are nonnegative integers.

`proof` joins `analysis`, `demonstration`, and `test_execution` as an accepted
verification method. `audit` and `inspection` remain excluded because their
labels alone do not establish a discriminating temporal proof.

Exact input reuse is established by the reference bindings. Distinct input
references require an explicitly verified semantic-equivalence behavior.

Versions 1.0.0 through 1.7.0 remain unchanged as frozen experimental artifacts.

## Limits

This profile checks declared proof structure. It cannot discover undeclared
actions, dishonest grounding, or delivered behavior. A falsifier is a declared
failure condition, not an asserted world proposition; it may therefore be the
controlled opposite of the behavior it tests. Cross-operator interference and
interval reasoning still require later vocabulary and analysis. Purpose
mismatch enforcement considers complete covering populations. Relabelled
subsets and other near-matches remain advisory: an authored non-covering overlap
is reported with its shared, missing, and extra members.

The profile has one affected subject and one aggregate verification subject.
Multi-subject operations require separate evaluations or a later collection-
valued extension.
