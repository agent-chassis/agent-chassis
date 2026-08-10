# Effect-nonduplication idempotency profile 1.7.0

This version corrects the remaining falsifier and collection-scope defects found
in the 1.6.0 pressure test.

On the behavioral-equivalence branch, the final state must be a distinct
reference from the first state. That requirement is branch-scoped: the
cardinality branch may reuse one state reference because its before/after
cardinality assertions remain distinct through their temporal contexts.

The counterfactual reset binds a separate state reference. The continuity
verification's falsifier requires the affected subject to acquire that state
under the reset condition. The reset state must be distinct from both the first
and final states.

The three observation references remain distinct artifacts or evidence records.
The final post-second state may be the same state reference or a distinct but
behaviorally equivalent state, depending on the proof branch.

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
is unrelated. Purpose is author-declared; dishonest relabeling remains visible
but is not semantically resolved by the local matcher.

The first state must persist until the second invocation. A separate continuity
verification uses an intervening-reset falsifier. The final comparison remains
either behavioral equivalence or matching caller-bound cardinality. Each branch
has its own verification pattern: equivalence is falsified by unequal final
state, while cardinality is falsified by a final cardinality unequal to the
caller-bound expectation. Cardinality bindings are nonnegative integers.

`proof` joins `analysis`, `demonstration`, and `test_execution` as an accepted
verification method. `audit` and `inspection` remain excluded because their
labels alone do not establish a discriminating temporal proof.

Exact input reuse is established by the reference bindings. Distinct input
references require an explicitly verified semantic-equivalence behavior.

Versions 1.0.0 through 1.6.0 remain unchanged as frozen experimental artifacts.

## Limits

This profile checks declared proof structure. It cannot discover undeclared
actions, dishonest grounding, or delivered behavior. A contract can still
declare both a reset and a false persistence assertion until a separate
contradiction analyzer supplies operator-interference and interval rules.

The profile has one affected subject and one aggregate verification subject.
Multi-subject operations require separate evaluations or a later collection-
valued extension.
