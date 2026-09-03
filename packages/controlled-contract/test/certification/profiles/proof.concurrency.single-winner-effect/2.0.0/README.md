# proof.concurrency.single-winner-effect@1.0.0

This `pre_dispatch` proof pack certifies a bounded two-attempt safety experiment.
Two distinct attempts name one operation and scoped key, and overlap is established
by requiring both start events to precede both terminal events. Exactly one elected
winner is accepted and creates the sole member of the complete effect population;
the elected loser is rejected and creates no such effect. Post-terminal observations
read the same durable resource, and loser final state equals winner post-state.

The executable adequacy module uses independent database unique-insert, queue
deduplicated-enqueue, and filesystem create-if-absent models, plus legitimate
terminal-order and simultaneous-start variants. It kills serialization, two-winner,
zero-winner, duplicate-effect, wrong-winner attribution, diverged loser state, and
wrong-resource mutants.

## Explicit exclusions

This pack does not establish arbitrary histories beyond exactly two attempts,
absence of hidden or out-of-population effects, authoritative runtime grounding,
clock or event-order truth, or absence of a transient duplicate later restored to
one durable effect. The pack discriminates the declared proof shape; it does not
upgrade caller-supplied identities or trace facts into runtime authority.

The three fixed-negative files contain only contracts, evaluation inputs, and
patch variations. They contain no embedded profile. Every critical surface is
paired with a rebound weakened-profile witness and single-patch ablation checks.
