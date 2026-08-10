# Effect-nonduplication idempotency profile 1.2.0

This version closes two proof-shape gaps found by pressure-testing 1.1.0 against
work record.

The profile now declares two pairs of roles that must resolve to distinct
grounded references:

- `first_invocation` and `second_invocation`; and
- `effect_after_first` and `effect_after_second`.

The carrier independently rejects several reference IDs for one grounded
identity. Together, these checks prevent an author from satisfying the
two-invocation proof shape by aliasing or reusing one declared event or one
declared observation.

The cardinality alternative now requires the selected verification to verify
both cardinality behaviors. This agrees with the native DAG rule that every
mandatory behavior must have declared verification coverage.

The temporal sequence remains:

```text
first invocation -> first observation -> second invocation -> second observation
```

Profile matching treats those four claims as a required ordered subsequence. A
contract may include additional ordered proof steps without invalidating the
profile, but it may not omit or reorder the required four.

Version 1.1.0 remains unchanged as the artifact evaluated in the work record
pressure test. Version 1.0.0 remains unchanged as the original reference pack.

## Limits

Distinct declared references establish distinctness only inside the controlled
artifact. The evaluator does not prove that an author assigned honest identities,
that delivered code performs the two invocations, or that a delivered test
observes the declared effects.
