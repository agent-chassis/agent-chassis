# Effect-nonduplication idempotency profile 1.4.0

This version replaces the 1.3 contiguous proof spine with an explicit state-
continuity proof. The plan must observe the affected subject after the first
invocation, observe it again before the second invocation, and require the
first observed state to persist until the second invocation. A separate
verification claim must target that continuity behavior and name an
intervening-reset counterfactual as its falsifier.

The required ordered sequence is a relative-order constraint rather than an
adjacency constraint:

```text
first invocation
-> first effect observation
-> pre-second effect observation
-> second invocation
-> second effect observation
```

Other declared steps may be interleaved. Every declared ordered sequence that
contains the complete proof population must preserve the required order; a
parallel clean sequence cannot conceal a conflicting ordering.

Effect-observation roles accept `cc:state`, `cc:artifact`, `cc:evidence`, or
`cc:resource`. This permits a plan to bind actual query results, response
artifacts, or recorded evidence rather than minting synthetic state identities.
The three temporal observations must still use distinct reference IDs and must
all be attached to the same affected subject.

First and second inputs remain separate roles. The same reference may bind both
when the operation literally receives the same input twice; the binding itself
satisfies that branch and no self-equivalence claim is required. Distinct input
references require the explicit semantic-equivalence behavior and verification
edge. In both cases the bindings and any equivalence claim remain declarations;
this free-tier profile does not
independently resolve real-world input identity or equivalence.

One `verification` reference may denote an aggregate suite or process. The
profile requires separate verification claims for effect nonduplication and
between-invocation continuity, but both claims may use that aggregate subject.

The effect comparison remains a controlled alternative:

- the second observation is behaviorally equivalent to the first; or
- the first and second observations have the caller-bound expected cardinality.

Versions 1.0.0 through 1.3.0 remain unchanged as frozen experimental artifacts.

## Limits

The profile checks the declared proof plan. It cannot discover an operative step
or affected subject omitted from the contract, dishonest identity grounding, or
an implementation that fails to execute the declared plan. An author can still
make a false continuity assertion; the improvement is that reset continuity is
now an explicit behavior with a targeted falsifier rather than an inference from
collection adjacency.

The profile has one affected subject. Multi-subject operations require separate
profile evaluations or a later collection-valued extension. Resolver facts may
strengthen identity or equivalence in a policy tier, but they are not required by
this free-tier pack.
