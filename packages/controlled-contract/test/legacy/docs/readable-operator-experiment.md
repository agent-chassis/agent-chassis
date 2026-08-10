# Readable Operator Experiment

## Determination

Opaque `o###` operators are not required by Vertex for the current v0.32
grammar. They should not remain on the model-facing surface.

This experiment does not establish that readable operators are more accurate.
It establishes two narrower facts:

1. Vertex accepts the readable v0.32 schema on the fixed challenging cohort.
2. The readable schema is smaller in model-context tokens because it does not
   need an embedded opaque-code dictionary.

## Controlled change

The readable variant is structurally identical to v0.32. It changes only the
operator enum presented to the model:

```text
o045  -> reference:replaces
o072  -> boolean:fails_when
```

The readable value is deterministically decoded to the same internal operator
before compilation. Claim families, operand tokens, reference catalog,
source bindings, array bounds, compiler, prompt, model, and request settings
are unchanged.

The comparison implementation is
`internal/scratch/controlled-contract-general-v032-readable.mjs`.

## Fixed cohort and transport

Each of these five criteria was generated once under each operator surface,
without retry or repetition:

- `work record:criteria:0005` — long amplification research criterion;
- `work record:criteria:0005` — delete-versus-repoint analysis;
- `work record:criteria:0002` — duplicate-detector verification;
- `work record:criteria:0001` — withdrawn visibility-gate account;
- `work record:criteria:0004` — frozen-base replay test.

Vertex accepted all five readable schemas and returned schema-constrained JSON
for all five. The long criterion therefore answers the transport question that
motivated the experiment: readable operators do not cross the current schema
complexity boundary.

## Token result

Across the five requests:

- opaque prompt tokens: 138,076;
- readable prompt tokens: 130,156;
- reduction: 7,920 prompt tokens, or 5.7%;
- opaque total tokens: 152,309;
- readable total tokens: 144,085;
- reduction: 8,224 total tokens, or 5.4%.

The opaque form is larger because its schema description must carry the full
`o### -> value-kind:predicate` mapping. Readable enum values carry their own
meaning and need only a short description. At v0.32, opacity is not a schema
compression.

## Semantic comparison

The five single generations do not establish comparative accuracy. Results
were mixed:

- the readable duplicate-detector result selected `returns` for
  `duplicate_record_id` and `emits` for the surfaced evidence path, materially
  better than the opaque result;
- the readable withdrawn-gate result more naturally represented the worker as
  reading, performing, and failing the relevant check;
- the opaque amplification result captured the explicit `replaces` statement
  that the readable generation omitted;
- the opaque frozen-base replay result was less wrong than the readable
  generation, which selected `replaces` between the slice and frozen base;
- both surfaces mishandled some review questions and historical statements as
  operative assertions.

These differences are model-generation differences, not evidence that one
operator surface is semantically equivalent or superior. They do show why
schema validity and admitted-claim counts are not accuracy metrics.

## Decision boundary

The original opaque operator form was load-bearing in the larger v0.28 schema:
shortening predicate enum strings was the smallest tested change that crossed
Vertex's serving boundary. That historical fact does not carry forward after
the grammar was compacted.

For v0.32:

- readable operators pass transport;
- readable operators use fewer context tokens;
- opaque operators have no demonstrated semantic advantage;
- opaque operators require the model to resolve an unnecessary description-
  embedded codebook.

Therefore the next experimental grammar should expose readable operators to
the model. An internal code may still be derived after generation if a real
storage requirement appears, but the current prototype has no such
requirement.

This experiment covers operator serialization only. Invocation-bound operand
and reference identities remain a separate question.
