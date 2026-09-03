
# Structured workflow convergence

This document defines the test-only convergence substrate for public structured
workflows. The implementation owner is
`tests/helpers/structured-workflow-convergence-harness.mjs`. Product workflow
implementations, registered schemas, discovery classification, and lifecycle
policy remain owned by their existing boundaries.

## Provider contract

A scenario provider owns every semantic choice. It supplies the initial public
call; extracts later calls from the preceding public result; observes the
authoritative state; normalizes opaque values; identifies continuations and
terminal effects; projects exact and semantic identities; interprets refusals
and their deciding fact; detects caller-restated arguments; and classifies
replay. The generic runner contains none of those product facts.

The initial call is the provider's one semantic choice. Every later call is
executed byte-for-byte from the preceding public result. `extractEmittedCalls`
must always return an array: explicit `[]` is the provider-owned truthful
terminal no-route declaration, while `undefined`, `null`, and every other
non-array value fail as `emitted_call_extraction_malformed`. A call reconstructed
from fixture knowledge, or a correction that requires
the caller to repeat an argument the server should have emitted, fails loudly.

Every call is checked against the schema captured from live registration before
its production wrapper is invoked. A missing schema, failed import, or provider
initialization error is not evidence of a downstream brick. A downstream
falsifier must record entry into the downstream registered wrapper and inject
its failure only after that trace boundary.

## Authoritative observations and fixed points

Scenario constants and refusal prose are not authoritative state. The provider
must observe the deciding state from the product owner: a public state route,
canonical persisted carrier, launcher-owned result, or another documented
authoritative observer. Missing authority or an incomplete observation is an
error, not an empty projection.

The runner records both exact and semantic state/call tuples. Exact projection
retains every provider-selected opaque identity. Semantic projection removes
only differences that the provider's product contract declares irrelevant.
Repeating either tuple is explicit non-progress. Reaching the step bound is the
distinct `bounded_step_exhausted` failure; it never becomes success or a skip.

A changed refusal code, spelling, supported-next-call name, or diagnostic is not
progress when the provider reports the same authoritative deciding fact.
Conversely, a changed deciding fact is not hidden merely because the refusal
shape stayed the same.

## Replay

Successful scenarios replay the unchanged original request through the same
registered schemas, production wrappers, emitted calls, observations, and
bounded attempt engine as the first execution. The provider must classify the
complete replay attempt as exactly one of:

- `no_op`: the effect is already present and no durable write is repeated;
- `same_running_attempt`: the request names the same authenticated in-flight
  attempt; or
- `settled_supported`: the public result is settled and exposes its supported
  continuation.

Any other classification is replay divergence. A caller-reconstructed
continuation or a second durable effect cannot satisfy replay.

## Inventory and strict mode

`loadToolDiscoveryDescriptor` is the only denominator source. Its assembled,
current descriptor owns tool identity, install state, runtime posture, tier
visibility, and side-effect classification. The inventory consumes all tiers
and selects effectful rows from their declared `side_effects`; it does not copy
route lists, inspect filenames or manifests, infer from tier/runtime posture, or
classify names heuristically. Unsupported and unowned rows remain denominator
members.

Explicit scenario ownership is joined onto both the descriptor-derived route
population and every initiative known-brick denominator member. Inventory
completeness and workflow convergence are separate fields:

- inventory completeness asks whether every denominator route and known brick
  has an explicit provider and every known brick carries its required facts;
- workflow convergence additionally requires every known brick to have loaded-
  fix confirmation from initiative. Loaded confirmation without scenario ownership
  remains an inventory gap and fails strict mode.

Inventory mode is always reportable and names ownership gaps, missing facts,
unconfirmed bricks, and denominator shrinkage. Strict mode refuses any of those
conditions. Known debt is never a skip, omission, or passing result.

## Brick and debt transitions

initiative is the sole canonical owner of brick identity, current owner,
reproduction, per-brick state, and loaded-fix confirmation. work record reads the
machine-readable `sections.known_bricks` carrier and does not reinterpret a
product WK's status as loaded-runtime confirmation.

A product WK retires a brick by landing its own fix and preserving the original
reproduction. initiative then records the evidence that the loaded fix makes that
reproduction converge. Only after both an explicit scenario provider exists
and `loaded_fix_confirmed` is true can strict inventory treat the member as
passing. Historical identities remain in the carrier; improvement changes their
confirmation state rather than deleting their evidence.

Product WKs own their initial choices, emitted-call extraction, authoritative
observer, normalization, continuation identity, settlement oracle, and tests.
They hand those scenario facts to this substrate without transferring product
semantics into the generic helper.

work record consumes the report as evidence of denominator size, explicit ownership,
named non-passing debt, and observed workflow outcomes. The report does not
close work record, change lifecycle state, or grant dispatch, integration, review,
or publication authority.

## Fail-loud boundary

Missing live registration, missing authoritative observation, malformed emitted
calls, caller-restated arguments, repeated tuples, changed refusal shape without
a changed deciding fact, replay divergence, incomplete debt evidence, and
denominator shrinkage are typed failures. There is no fallback provider, copied
inventory, compatibility loop, inferred continuation, skip, or graceful-
degradation pass.
