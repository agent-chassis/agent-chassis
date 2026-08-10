# Residue Semantics and the v0.32 Corrections

## Status

This is a noncanonical experimental report. Its implementation now lives in
the tracked `packages/controlled-contract` package; it is not CCE policy,
contract admission authority, or a dispatch rule.

v0.32 was produced after a source-span audit showed that raw residue entries
were not a defensible vocabulary-gap metric. The compiler sometimes emitted
one span under multiple reasons, treated uppercase prose as unresolved
identity, constructed reference sets across unrelated prose sections, paired
apostrophes as quotation marks, and separated semicolon-linked parts of one
obligation. Rejected claims also hid enumerated operands, while a bound source
span alone was accepted as a verification falsifier.

## Current definition of residue

Residue is exact source meaning that has not been represented by an admitted
controlled claim or relation. A residue span is evidence for investigation,
not a determination that vocabulary is missing.

An audit classifies each unique source span in this order:

1. explicitly represented;
2. mechanically entailed by a fully structured closed solution slot;
3. redundant restatement;
4. model translation failure, demonstrated by a valid encoding under the
   current grammar;
5. schema, compiler, binding, or segmentation defect;
6. defective or indeterminate source contract;
7. review-only, historical, rationale, or other nonoperative material;
8. vocabulary opportunity, demonstrated only after the preceding explanations
   fail.

`MUST` closure is important to this ordering. Once the complete subject,
predicate, applicability context, and allowed value set are structured, other
values in that slot are excluded. Corresponding `MUST_NOT` prose is derived or
redundant rather than a missing vocabulary term. Closure of one slot does not
close another slot.

## Mechanical corrections

The current compiler makes the following changes:

- residue is unique by exact source text; additional causes are retained in
  `diagnostic_reasons` rather than emitted as duplicate residue entries;
- uppercase words are not identities merely because they are uppercase;
- source-derived requirement sets require a checklist-like header and stop at
  the next section header;
- apostrophes inside words do not delimit string literals;
- semicolons do not split one source element; multiple controlled claims may
  cite the same element;
- enumerated operands are checked for attempted claims even when the claim is
  rejected;
- a verification falsifier must name both a counterfactual transformation and
  a discriminating outcome; a bound span containing only historical or
  hypothetical prose is rejected.

Local regression tests cover each correction.

## The v0.32 claim carrier

The v0.31 claim carrier allowed reference-valued claims with an empty value
array. The compiler rejected them, but the constrained generator was still
allowed to produce them.

An initial v0.32 design split claims into eight claim-family/value-kind arrays.
It was valid JSON Schema but Vertex rejected the response schema before
inference. That representation was withdrawn.

The working v0.32 carrier retains two arrays:

- `declarative_claims`;
- `verification_claims`.

Every claim has one non-empty `operand_tokens` array. Its members are
invocation-bound controlled terminals:

- `r:<reference-id>`;
- `b:true` or `b:false`;
- `n:<number>`;
- `min:<number>` or `max:<number>`.

The operator code fixes the expected operand family. The schema prevents an
empty claim and prevents free operand invention. The deterministic compiler
rejects an operator paired with the wrong controlled operand family. A live
Vertex probe confirmed that this compact schema reaches inference.

## Single-pass counterfactual audit

Five recent criteria were selected once, without repetitions:

- `work record:criteria:0005`, the amplification measurement proposal;
- `work record:criteria:0005`, delete-versus-repoint design review;
- `work record:criteria:0002`, the blanket dot-directory control;
- `work record:criteria:0001`, the withdrawn visibility-gate account;
- `work record:criteria:0004`, the frozen-base replay test.

All five reached Vertex inference under the compact v0.32 schema. The first
admitted seven claims and two relations; the remaining four respectively
admitted zero, one, fifteen, and seven claims. These counts are diagnostic and
are not capture-quality scores.

The cases do not support adding `counterfactual` to
`applicability_context`:

- delete-versus-repoint is an unconditional instruction to perform an
  analysis, not an obligation that applies only in a hypothetical world;
- the blanket dot-directory counterfactual explains why the live detector
  control matters, while the operative requirement concerns the delivered
  filter;
- the visibility-gate statement is historical evidence about a withdrawn
  design;
- the frozen-base replay is a decision procedure with two conditional
  outcomes over a named historical base;
- the amplification proposal specifies an analysis over historical defects,
  proposed detection mechanisms, and avoided downstream cost.

The last and first cases may share an evaluation-scenario structure:
historical input state, proposed intervention, observed or derived output.
That abstraction is not yet demonstrated across the set. The correct status is
`candidate vocabulary opportunity — abstraction unresolved`, not adoption.

## Current conclusion

Do not optimize raw residue count and do not add a vocabulary term merely
because similar prose recurs. First determine whether the meaning is entailed,
redundant, mis-translated, mechanically lost, defective, or nonoperative. A
new primitive is justified only when recurring legitimate operative meaning
cannot be encoded or derived and the proposed abstraction generalizes beyond
the examples that exposed it.
