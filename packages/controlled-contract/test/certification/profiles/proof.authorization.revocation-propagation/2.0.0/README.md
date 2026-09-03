# `proof.authorization.revocation-propagation@1.0.0` prototype

## Determination

**EXPRESSIBLE** in `cv.experimental.0.34`. No surviving concrete attack and no
generic vocabulary/evaluator fix are required for this bounded safety property.

## Exact bounded guarantee

For one declared authority and revocation event, the profile binds a complete
declared enforcement-consumer population, a finite propagation interval after
revocation, a complete declared post-revocation attempt population, an equal
complete refused-attempt population, and a complete declared protected-effect
population. Every declared consumer reads the same authority and has the exact
revoked state during the propagation interval. That interval follows revocation
and precedes every declared attempt. Every attempt uses the same authority,
targets the same consumer population, has refused state, and neither writes nor
mutates any declared protected effect. Complete singleton applied-state and
revoked-state populations are equal during propagation.

This is finite-population safety. It does not establish that propagation will
eventually happen.

## Why a dedicated pack is justified

Composition with settlement visibility and refusal-before-effects cannot require
the composed proofs to share one authority, one revocation event, one consumer
population, one attempt population, or one protected-effect population. It also
cannot introduce the universal consumer-to-propagation-interval and
attempt-to-propagation-interval obligations. This profile adds mechanically
checked shared bindings, complete populations, exact counts, per-member claims,
and one ordered propagation boundary. The fixed refusal-only contract is rejected
even though all attempts are refused without effects.

## Executed adequacy

- Positive domains: API gateway credential (2 consumers, 3 attempts, 2 effects),
  edge-cache session (1, 1, 1), and distributed signing key (4, 5, 3).
- Required mutants killed: one stale consumer and one protected write after
  revocation.
- Additional attacks killed: an accepted attempt, a split authority binding, and
  missing propagation order.
- Independently authored fixed negatives: one stale member in an otherwise
  complete consumer population, and a refusal-only contract with no propagation
  proof. `fixed-negatives.mjs` does not import or inspect the profile or pattern
  list.
- Six guarantee-critical weakenings are applied to full profile objects, pass
  v0.34 schema and semantic validation, and have frozen canonical digests. The
  universal-application weakening admits the fixed stale-consumer negative.
- Fixture/evaluation repeatability and declaration/binding-order invariance are
  executed. The harness scans itself for filesystem-write, subprocess, and
  network primitives.

Run:

```sh
node --test --test-reporter=tap /tmp/proof-authorization-revocation-propagation-v1-prototype/prototype.test.mjs
```

## Explicit exclusions

- Consumers, attempts, resources, or effects outside the declared complete
  populations.
- Eventual delivery, propagation liveness, and any wall-clock propagation bound.
- Concurrency not represented by the declared revocation -> propagation interval
  -> attempt order.
- Runtime truth or authenticity of delivered evidence.
- Dishonest caller grounding, population declarations, identities, or role
  assignment.
- Effects outside the declared protected-effect population.

## v0.34 modeling note

The first candidate used an attempt-population reference itself as a `before`
context. Pressure testing replaced that with a declared propagation interval
typed as an event/process, ordered after revocation and before every attempt.
This avoids depending on an untyped population as a lifecycle point. The
remaining use of caller-supplied identities is an explicit framework boundary,
not a defect specific to this profile.
