# Effect-nonduplication idempotency profile 1.0.0

This free-tier reference pack requires a proof plan that distinguishes an
idempotent operation from an implementation that produces an additional effect
when the same logical input is repeated.

The same profile is tested against payment, queue-submission, and database-create
contracts. No domain identity or repository path appears in `profile.json`.

## Required proof shape

```text
first equivalent invocation
  -> first effect observation
  -> second equivalent invocation
  -> second effect observation
  -> behavioral-equivalence requirement
```

The verification must target the idempotency behavior and name a counterfactual
falsifier in which the second effect differs from the first because an additional
effect is enabled.

The pack rejects a one-request `assert 200` plan. Such a plan can fail, but it
does not distinguish idempotent from non-idempotent behavior.

## Role binding

The caller binds:

- `operation`;
- `first_invocation` and `second_invocation`;
- the shared `equivalent_input` population;
- `effect_after_first` and `effect_after_second`;
- `verification`; and
- `duplicate_effect_condition`.

Every role is bound to a typed reference already present in the native controlled
contract. The evaluator does not infer which product effect should count as the
idempotency observable.

## Limitations

Version 1.0.0 requires behavioral equivalence of the two bound effect states. It
does not yet provide the alternative cardinality-based branch described in the
broader design specification. It also cannot detect a dishonest binding that
selects an irrelevant observable with an otherwise valid type.
