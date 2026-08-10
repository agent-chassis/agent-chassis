# proof.failure.retry-convergence@1.0.0

This `pre_dispatch` proof pack certifies a bounded two-attempt safety plan. The
declared history contains exactly one failed attempt followed by cleanup and
settlement, then exactly one retry of the same operation and input. Declared
residue is empty after settlement. The retry succeeds and creates exactly one
declared final effect; the failed attempt does not create it. The selected final
durable state equals the caller-declared expected state.

The profile binds complete attempt, residue, and final-effect populations; exact
counts of two, zero, and one; distinct attempts and lifecycle events; the full
temporal chain; same operation/input roles; refusal and success outcomes; effect
attribution; a final-state observation; a complete verification read spine; and
six controlled falsifier/verifies pairs.

The executable controls use independent multipart-upload, schema-migration, and
message-projection models. They kill retry before settlement, surviving residue,
failed-attempt contribution, duplicate final effects, changed retry input, wrong
final state, and false retry success.

## Explicit exclusions

The pack does not establish arbitrary retry histories, scheduling or retry
liveness, backoff or fairness, concurrent/linearizable/distributed convergence,
effects or resources outside the declared populations, transient effects between
the selected observations, or authoritative runtime provenance and honest
grounding.

The fixed-negative files contain no embedded profile. Every critical surface is
paired with a rebound weakened-profile witness and single-patch ablation checks.
