# Effect-nonduplication idempotency profile 1.3.0

This version separates the affected resource from its two temporal state
snapshots. One grounded resource is observed after two distinct invocation
events; the two snapshot identities, rather than the resource identity, must be
distinct. The comparison is between those snapshots.

The two invocations now bind `first_input` and `second_input` separately. A
required controlled behavior claim states that the second input is semantically
equivalent to the first. The same reference may satisfy both roles when the
input is literally identical; distinct references require the explicit
equivalence claim.

The required temporal proof spine is a contiguous ordered subsequence:

```text
first invocation
-> first resource-state snapshot
-> first observation
-> second invocation
-> second resource-state snapshot
-> second observation
```

Additional claims may appear before or after that spine. A declared claim may
not intervene inside it. This prevents an authored cleanup or reset step from
being inserted between the first observation and the second invocation while
still satisfying the profile.

One `verification` reference may denote an aggregate focused suite or process.
The profile does not require every constituent test process to be represented as
the verification subject.

The comparison remains a controlled alternative:

- the second snapshot is behaviorally equivalent to the first; or
- both snapshots have the caller-bound expected cardinality.

The selected verification must verify the input-equivalence behavior and every
comparison behavior used by the selected branch.

Versions 1.0.0, 1.1.0, and 1.2.0 remain unchanged as frozen experimental
artifacts.

## Limits

Contiguity covers the authored ordered sequence. It cannot discover an operative
step omitted from that sequence. Distinct grounded identities and semantic-input
equivalence are declarations whose honesty remains the contract author's
responsibility unless an external identity or semantic resolver supplies a
stronger fact.
