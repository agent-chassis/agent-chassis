# Failure settlement and cleanup proof pack 1.0.0

`proof.failure.settlement-and-cleanup@1.0.0` is the v0.34 composite profile for
an injected failure followed by cleanup, settlement with no declared residue,
and preservation of the original failure cause.

## Exact local guarantee

Given one grounded operation attempt, one declared failure injection and
injected failure carrying one grounded original cause, one cleanup event, one
settlement event after both failure and cleanup, one complete declared residue
population whose integer cardinality may be zero or greater, complete cause-
state observations at failure and after settlement, and a settled failure
record, satisfaction establishes only in the declared controlled graph that:

1. the injected failure targets the operation during the attempt;
2. the cleanup event follows the failure and targets the residue population;
3. settlement follows both failure and cleanup;
4. the declared complete residue population has cardinality zero after
   settlement;
5. the settled failure record retains the same grounded failure cause; and
6. the cause state after settlement equals its observed state at failure.

Separate verification claims read the residue and cause observations. Their
controlled falsifiers are a nonzero post-settlement residue count and unequal
cause states under distinct failure conditions.

## Explicit exclusions

- transient residue that is removed before the settlement observation;
- residue that reappears after the declared observation;
- resources or side effects outside the elected residue population;
- concurrency, interference, distributed settlement, or linearizability;
- truthfulness of the declared cause and observations beyond local structural
  grounding;
- cleanup side effects outside the elected population;
- failure prevention, retry, compensation quality, or idempotency;
- authenticity or mutation sensitivity of delivered evidence; and
- proof-pack applicability or policy consequences.

## Controlled proof shape

The profile uses 18 exactly-one reference roles, one integer residue-count
binding with minimum zero, 21 claim patterns, two verifies relations, and two
all-covering collections. Sixteen operational roles require repository-path,
code-symbol, durable-id, or runtime-parameter identities. Only the two abstract
falsifier conditions accept profile-term identities.

The residue population is complete relative to the caller's declared exact
cardinality. Satisfaction requires that bound cardinality to be zero at the
settlement observation; it does not claim that no transient residue existed.
Cause preservation uses one grounded cause reference plus equality of its two
distinct observed state references, so replacing the cause or merely wrapping
it in a generic failure does not satisfy the pack.

## Executable adequacy

The release gate contains 40 executable controls: 10 positives across file
upload, job dispatch, and schema migration domains; seven executed mutants; 14
profile rejections; and nine boundary demonstrations. The mutants cover absent
failure injection, missing or partial cleanup, premature settlement, replaced
or dropped cause, and residue reappearance before observation.

Fifteen fixed negative-fixture wrappers carry claim-semantic, reference-role,
and aggregate relation, collection, binding, and satisfaction attacks. The
adequacy declaration classifies 150 critical and 85
mechanically noncritical surfaces. Indexed admission and exhaustive
`full_census` mode both evaluate the fixed corpus.
