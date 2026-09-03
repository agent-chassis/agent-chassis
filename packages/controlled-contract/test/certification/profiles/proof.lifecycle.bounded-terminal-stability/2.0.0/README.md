# Bounded terminal stability proof pack 1.0.0

`proof.lifecycle.bounded-terminal-stability@1.0.0` is the v0.34 endpoint-
observation profile for checking declared terminal-state stability and absence of
declared reactivation events through one explicit bounded horizon.

## Exact declared-world guarantee

For one declared lifecycle entity, terminal event, terminal state, and explicit
bounded horizon, satisfaction establishes only in the controlled contract that:

1. the terminal event completes the entity and has the declared terminal state;
2. a complete horizon-scoped observation population is nonempty;
3. for every bound observation, the terminal event precedes it, it precedes the
   horizon, it reads the lifecycle entity, and it records the terminal state;
4. complete terminal-state and observed-state populations each have exact
   singleton cardinality and the observed-state population equals the terminal-
   state population;
5. a complete horizon-scoped reactivation-event population has exact
   cardinality zero; and
6. separate verification claims target observed-state stability and zero
   reactivation with separate controlled-complement falsifiers.

The horizon is part of the proof subject. The guarantee ends at that declared
boundary and samples only the complete elected observation population.

## Explicit exclusions

- forever-after stability;
- post-horizon observations, state changes, or reactivations;
- transient state changes between elected observations;
- observations, events, actors, and resources outside declared populations;
- real-time truth, duration, or clock accuracy;
- honest or authoritative identity, population, state, event, observation, and
  horizon grounding; and
- delivered-evidence authenticity or implementation of the matched plan.

Accordingly, an unobserved transient regression or a post-horizon regression may
coexist with satisfaction and is intentionally outside the claim.

## Controlled proof shape

The profile binds 16 reference roles and three integer number roles. Four
complete populations cover bounded observations, the terminal-state singleton,
the observed-state singleton, and bounded reactivation events. Four count
bindings require at least one observation, exact singleton state populations,
and zero reactivations. Four `for_each` patterns enforce the terminal-to-horizon
ordering and state record for every elected observation. Twelve claim patterns,
two distinct-role sets, two verification relations, and two condition bindings
complete the proof shape.

## Executable adequacy

The bespoke module exercises workflow completion with one observation,
credential revocation with three observations, and upload abort with five
observations. Executed mutants cover a bounded state regression, an in-horizon
reactivation, and one observation outside the terminal/horizon interval. All 12
claim-pattern omissions reject, while seven exclusion controls preserve the
declared boundary.

The fixed negative census classifies every semantic profile field: 71 critical
surfaces have independently authored JSON fixtures and rebound weakening
witnesses; 82 surfaces carry mechanically validated noncritical reasons.
Full-census certification rejects all 71 fixed negatives, validates all 71
weakening witnesses and every individual patch ablation, and is deterministic
across repeated runs.
