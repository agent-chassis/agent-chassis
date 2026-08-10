# Effect-nonduplication idempotency profile 1.6.0

This version corrects the continuity and closed-population defects found in the
1.5.0 pressure test. The state immediately after the first invocation and the
state immediately before the second invocation must bind the same reference.
Distinct state references cannot satisfy continuity merely by appearing in
separate `has_state` claims.

The counterfactual reset binds a separate state reference. The continuity
verification's falsifier requires the affected subject to acquire that distinct
state under the reset condition; it does not assert that one reference differs
from itself.

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
the complete population must preserve this order. Population containment is the
only purpose discriminator: an unrelated sequence containing the entire same
claim population is also checked.

The contract must also declare those eleven claims as one exact `closed_set`.
Every declared closed set containing the complete population must match exactly;
a parallel clean set cannot conceal a polluted covering set. This does not
discover an omitted action. It makes the claim that the proof population is
complete explicit and attributable instead of leaving omission silent.

The first state must persist until the second invocation. A separate continuity
verification uses an intervening-reset falsifier. The final comparison remains
either behavioral equivalence or matching caller-bound cardinality. Cardinality
bindings are nonnegative integers.

`proof` joins `analysis`, `demonstration`, and `test_execution` as an accepted
verification method. `audit` and `inspection` remain excluded because their
labels alone do not establish a discriminating temporal proof.

Exact input reuse is established by the reference bindings. Distinct input
references require an explicitly verified semantic-equivalence behavior.

Versions 1.0.0 through 1.5.0 remain unchanged as frozen experimental artifacts.

## Limits

This profile checks declared proof structure. It cannot discover undeclared
actions, dishonest grounding, or delivered behavior. A contract can still
declare both a reset and a false persistence assertion until a separate
contradiction analyzer supplies operator-interference and interval rules.

The profile has one affected subject and one aggregate verification subject.
Multi-subject operations require separate evaluations or a later collection-
valued extension.
