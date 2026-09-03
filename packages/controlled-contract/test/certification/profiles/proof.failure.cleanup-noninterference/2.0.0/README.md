# Cleanup noninterference proof pack 1.0.0

`proof.failure.cleanup-noninterference@1.0.0` is the v0.34 endpoint-state
profile for checking that one declared failed attempt is cleaned and settled
without changing a distinct declared protected population or consuming a
distinct selected authority needed by a later successful attempt.

## Exact declared-world guarantee

Satisfaction establishes only in the declared controlled contract that:

1. one failed attempt uses its failure authority, has the declared failure
   state, and precedes cleanup, which precedes settlement;
2. cleanup deletes the complete declared residue population and its exact
   after-settlement cardinality is zero;
3. a distinct complete protected-resource population is the subject of both
   endpoint observations through the same bound population identity;
4. the complete before- and after-settlement protected-state populations each
   have the protected-resource cardinality and the after population equals the
   before population;
5. cleanup preserves a separately selected authority distinct from the failed
   attempt's authority, and that authority's declared after state equals its
   declared before state;
6. settlement precedes a valid attempt, the selected unrelated authority
   authorizes and is used by that attempt, and the returned result equals the
   expected successful result; and
7. cleanup, protected-state equality, authority-state equality, and later
   authorization each have a distinct verifier, verifies relation, and
   controlled-complement falsifier.

The guarantee compares declared endpoint observations. It does not establish
continuous nonmutation between those observations.

## Explicit exclusions

- truthfulness of caller-authored complete populations;
- identity provenance or existence;
- requirements omitted from the authored contract;
- runtime evidence or execution truthfulness;
- protected-resource mutation followed by restoration before the after-
  settlement observation;
- undiscovered resources outside the declared populations;
- mutation of resources outside the declared protected population;
- residue created after the settlement observation;
- authority validity outside the selected later attempt; and
- concurrent interleavings outside the declared sequence.

Thus a transient mutate-and-restore execution may still satisfy the endpoint
declarations and is intentionally demonstrated as an escaping exclusion, not a
killed mutant.

## Controlled proof shape

The profile binds 31 reference roles and two integer number roles. Four closed
population bindings cover residue, protected resources, and protected state at
both endpoints; four role-count bindings connect them to zero residue and one
shared protected-resource count. Seven distinct-role sets separate attempts,
events, observations, residue/protected populations, authorities, four
verifiers, and four falsifier conditions. Twenty-five claim patterns and four
verification relations bind the complete cleanup, state, authority, and later-
attempt spine.

## Executable adequacy

The bespoke module exercises database-import cleanup, plugin-deployment cleanup,
and cloud-provisioning cleanup. It kills cleanup mutation of the protected
population, authority consumption, remaining residue, wrong comparison and
observation subjects, collapsed populations, one verifier substituted for all
four roles, cleanup-verifier substitution, missing later authorization, failed
later result, and an incomplete after-state population. Every one of the 25
claim patterns also has a missing-obligation rejection control. Ten exclusion
controls retain the declared boundary.

The fixed negative census classifies every semantic profile field: 176 critical
surfaces have independently authored JSON fixtures and rebound weakening
witnesses; 114 surfaces carry mechanically validated noncritical reasons.
Full-census certification rejects all 176 fixed negatives, validates all 176
weakening witnesses and every individual patch ablation, and is deterministic
across repeated runs.
