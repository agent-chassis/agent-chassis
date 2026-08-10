# Effect-nonduplication idempotency profile 1.1.0

This version preserves the generic two-invocation proof shape from 1.0.0 and
corrects two issues exposed by the frozen work record evaluation.

The ordered proof sequence now contains only temporal steps:

```text
first invocation -> first observation -> second invocation -> second observation
```

The assertion over those observations is deliberately outside that sequence.
One of two comparison branches must be present:

- the second effect state is behaviorally equivalent to the first; or
- both observed effect populations have the caller-bound expected cardinality.

The numeric binding keeps the profile domain-neutral. A create-if-missing
contract may bind cardinality `1`; another domain may bind a different expected
population. The profile never invents that number.

Both branches still require two equivalent invocations, both observations, a
verification attached to the selected comparison behavior, and a falsifier in
which the second effect differs under a duplicate-effect condition.

Version 1.0.0 remains unchanged as the frozen input used by the first real-WK
evaluation.

## Limits

The evaluator establishes authored proof-plan shape only. It does not determine
whether the selected effect is honest, execute the verification, or establish
that delivered code and tests implement the plan.
