# proof.state.bounded-interval-nonmutation@1.0.0

This `pre_dispatch` proof pack certifies that one declared actor neither writes
nor mutates any member of one complete, exact, nonempty protected-resource
population between a declared start event and end event. The verification must
observe that same actor, interval, boundary pair, and protected population.

The executable controls use independent database-snapshot, credential-audit,
and artifact-publication histories. They kill a write during the interval, a
mutation during the interval, mutation followed by restoration, observation of
the wrong actor, observation of only part of the protected population,
collapsed boundaries, and reversed boundaries. Endpoint equality alone is not
accepted: mutate-then-restore is still a violation.

## Explicit exclusions

The pack does not establish behavior by undiscovered actors or against
undiscovered resources, behavior outside the declared interval, deletion or
creation unless represented as a write or mutation, absence of omitted or
unreported transient activity, or real-time clock, trace, evidence, identity,
population, interval, and grounding truth.

The fixed-negative files contain no embedded profile. Every critical surface is
paired with a rebound weakened-profile witness and single-patch ablation checks.
