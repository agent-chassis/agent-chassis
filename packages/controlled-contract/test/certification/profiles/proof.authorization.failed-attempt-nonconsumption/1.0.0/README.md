# Failed-attempt nonconsumption proof pack 1.0.0

`proof.authorization.failed-attempt-nonconsumption@1.0.0` is the current v0.34
profile for a refused attempt followed by a valid use of the same authority.

## Exact local guarantee

Given one declared failed attempt, one distinct later valid attempt, one reusable
operation, one legitimate authority, distinct failed and valid inputs, one refusal,
complete authority-state observations before the failed attempt and after refusal,
and one declared expected successful result state, satisfaction establishes only
in the declared controlled graph that:

1. the failed attempt performs the operation and uses both the authority and failed
   input;
2. the authority does not authorize the failed input for that operation;
3. the refusal rejects the exact failed attempt after it occurs;
4. the authority's complete declared state after refusal equals its complete
   declared state before the failed attempt;
5. a distinct later attempt follows the refusal, performs the same operation, uses
   the same authority and a separately authorized input, and is accepted;
6. the later result's observed complete state equals a declared expected state that
   conforms to the bound success criterion; and
7. separate verification claims read the authority-state and later-result
   observations and carry controlled `not_equals` falsifiers under distinct
   conditions.

The guarantee means persistent consumption is absent at the post-refusal
observation and the same declared authority remains usable by the later attempt.
It does not claim that no transient mutation occurred between observations.

## Explicit exclusions

- transient consumption followed by restoration before the post-refusal
  observation;
- concurrency, interference, isolation, or linearizability;
- truthfulness of caller-supplied reference grounding or state observations;
- effects on resources outside the elected authority;
- single-use or replay behavior after the valid success;
- refusal-before-protected-effects, which belongs to
  `proof.authorization.refusal-before-effects`;
- proof-pack applicability or external policy consequences.

## Controlled proof shape

The profile uses 20 exactly-one reference roles, 26 claim patterns, two verifies
relations with separate falsifier-condition bindings, and one exact all-covering
closed proof population. The three remaining distinct-role declarations are
load-bearing: attempt/refusal/result occurrences, verification claims, and
falsifier conditions cannot collapse.

The nonconsumption branch compares two distinct `cc:state` references using
`reference:equals`; its falsifier uses the controlled complement
`reference:not_equals`. The later-use branch independently compares the observed
result state with the declared expected success state using the same complement
pair. A single verification claim cannot discharge both behaviors.

## Executable adequacy

The release gate contains 59 controls:

- 11 positive controls across channel capability, tenant lease, and queue permit
  implementations, all five verification methods, alternate authority types, and
  coexistence with another pack's proof population;
- 5 executed mutants covering persistent consumption, replenishment only after
  observation, later-use failure, different-authority substitution, and missing
  refusal;
- 36 profile-rejection controls covering every required observation, state,
  attempt, input, authorization, result, verification, falsifier condition, role
  collapse, and competing population; and
- 7 explicit boundary demonstrations.

The implementation oracle is driven by executed store state. A mutant is killed
only when the exact refusal is observed, the before/after authority states differ,
the later attempt uses another authority, or the later result differs from its
expected success state. The truthful contract is derived from those observations
and then evaluated by the profile.

The adequacy declaration binds the canonical profile and guarantee plus the raw
SHA-256 of the adequacy module, fixture, and harness. It also binds 79 fixed
negative contract fixtures bidirectionally to their guarantee-critical profile
surfaces and weakening classes. The generic runner evaluates those captured
fixture bytes against the candidate profile and executes captured verified module
bytes rather than re-reading their original paths.

## Composition

This pack does not subsume refusal-before-effects. The two packs can apply to the
same contract: refusal-before-effects constrains protected effects before refusal;
this pack constrains the authority's post-refusal state and a later use. Their
roles and proof populations remain profile-local.
