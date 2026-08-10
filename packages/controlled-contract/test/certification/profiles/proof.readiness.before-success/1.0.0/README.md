# Readiness before success proof pack 1.0.0

`proof.readiness.before-success@1.0.0` is the v0.34 profile for proving that a
reported successful initialization is not earlier than a successful use of the
capability it exposes.

## Exact local guarantee

Given one grounded capability, distinct grounded initialization and readiness
operations, one initialization attempt, one readiness probe and result, one
completion report, one observed complete ready state, and one declared expected
ready state, satisfaction establishes only in the declared controlled graph that:

1. the initialization attempt performs the initialization operation and targets
   the exact capability;
2. a distinct later probe performs the readiness operation against that same
   capability;
3. the readiness result accepts the exact probe, carries an observed complete
   state, and is captured by a distinct observation record;
4. the observed state equals a separately declared expected state that conforms
   to the bound success criterion;
5. the completion report completes the initialization attempt and does not
   precede the readiness result, permitting readiness strictly before or at the
   reported completion point; and
6. separate verification claims read the state and temporal proof subjects, verify
   the corresponding behaviors, and carry controlled falsifiers for a non-ready
   state and premature completion.

The profile constrains the capability and both operations to repository-path,
code-symbol, durable-domain, or (for the capability only) runtime-parameter
identities. An abstract `profile_term` cannot ground those three roles.

## Explicit exclusions

- readiness lost after the successful probe, including before or after the
  completion report;
- concurrency, interference, linearizability, or repeated initialization;
- existence or truthfulness of a syntactically eligible repository, symbol,
  durable-domain, or runtime-parameter identity;
- completeness or side effects of the elected readiness operation;
- continued capability usability after reported completion;
- initialization-failure rollback, cleanup, or retry behavior;
- resources or capabilities outside the elected capability;
- proof-pack applicability, evidence authority, or external policy consequences.

## Controlled proof shape

The profile uses 15 exactly-one roles and 18 claim patterns. Two verification
relations keep readiness-state equality separate from temporal ordering. The
state behavior uses `reference:equals` with a `reference:not_equals` falsifier.
The temporal behavior uses negative modality over `reference:precedes`; its
falsifier is the identical positive proposition, as required by the v0.34
controlled-complement policy for a negative target.

The temporal obligation is deliberately `completion_report MUST_NOT precede
readiness_result`. It accepts distinct occurrences at one logical point without
requiring an irreflexive self-edge and rejects a report observed before the
successful result. One exact all-covering closed population prevents a second
same-purpose thin proof population from concealing omitted proof subjects.

A plan that issues no readiness operation and merely asserts a success status is
unsatisfied. It lacks the grounded probe, accepted result, complete-state
comparison, exact observations, and temporal falsifier.

## Executable adequacy

The adequacy module executes message-broker publication, database-pool query, and
inference-worker use implementations. Its positive controls cover readiness
strictly before and at completion, every accepted verification method, alternate
role types, and every admitted grounding kind. Executed mutants cover a
success-status-only plan, premature completion, failed use, use of another
capability, and a missing completion report.

The fixed negative corpus is digest-bound and classifies every profile surface.
It independently rejects weakened modalities and operators, role substitutions,
broadened role types and identities, omitted proof subjects, missing relations,
unscoped falsifiers, competing populations, and broadened satisfaction.
