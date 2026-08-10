# v0.33 Recent-Corpus Baseline

> **Noncanonical experimental evidence.** Durable determinations belong in
> work record. This document records a frozen run; it does not adopt a vocabulary,
> set a threshold, or make a CCE decision.

## Run identity

- Cohort: slice acceptance criteria in work record through work record.
- Records present: 75.
- Criteria selected: 1,962.
- Model: Vertex `gemini-3.6-flash`.
- Grammar: readable-only v0.33.
- Generation: one call per criterion, concurrency 12, no retry, no repetition.
- Schema digest: `16c919168792654c5aa4af16ff63a300b787d204e100974d8c29e8181f13ad99`.
- Compiler digest: `e912f8d3ed4b094afc24a20c5c3fc36f0704f02c1ba408daaaf4017b2fa1aba9`.
- Ledger: `the project documentationl`.

All 1,962 requested calls returned a payload. No result was replaced by a retry
or replay.

## Mechanical result

- Complete: 342 criteria.
- Partial: 1,575 criteria.
- Residue-only: 44 criteria.
- Schema-invalid after compiler normalization: 1 criterion.
- Criteria with admitted structure: 1,917 of 1,962.
- Criteria with at least one residue entry: 1,393 of 1,962.
- Admitted claims: 8,168.
- Admitted relations: 2,058.
- Unique criterion-bound residue spans: 5,544.

The source segmenter produced 7,426 segments. Of these, 4,241 had no residue
text mapped into them and 3,185 did, yielding 57.1% segment-level structural
coverage. This is a mechanical coverage measure, not a claim that 57.1% of
operative meaning was captured. The segmenter does not decide whether a span
is operative, and a structurally admitted claim may still select the wrong
operator or operands.

The run consumed 36,169,015 prompt tokens and 39,558,832 total tokens. Most of
that is the dynamically bound schema and reference catalog repeated for each
criterion; this is an optimization issue, not a vocabulary finding.

## Residue diagnostics

Diagnostic reasons overlap when one exact span has multiple problems:

- `unrepresented_enumerated_operand`: 2,313 attachments;
- `unsupported_by_controlled_grammar`: 2,139 attachments;
- `rejected_claim_operand`: 1,063 attachments;
- `invalid_controlled_claim`: 131 attachments.

These labels state what the deterministic compiler observed. They do not state
why the meaning was lost. In particular, `unsupported_by_controlled_grammar`
does not itself prove a missing vocabulary primitive.

Repeated residue immediately shows why the strong audit is necessary. The
most frequent exact spans include `BINDING.`, `Claim:`, `role reviewer`,
`readiness`, `medium`, `severity`, `AUTHORITY.`, and `SCOPE DISCIPLINE.`. This
mix includes discourse headers, likely carrier or lifecycle concepts, enum-like
policy values, and possible model omissions. Treating the list as a vocabulary
backlog would reproduce the defect the residue method is meant to prevent.

The highest-residue criteria are dominated by long blueteam binding and review
briefs containing run identities, evidence history, prior findings, measured
baselines, and scope instructions. They are useful stress cases but are not
representative of a short implementation criterion.

## One definite schema/compiler mismatch

`work record:criteria:0005` was the sole schema-invalid result. Its text
contains two measured time ranges. The compact v0.33 wire grammar allowed one
range claim to carry multiple lower and upper bound tokens, while the
downstream claim grammar permits at most one of each. Constrained decoding
therefore produced a v0.33-shaped payload that compiler normalization could
not represent.

This is not a bad contract and not a missing predicate. The model should have
emitted separate range claims, but the model-facing grammar also failed to make
the invalid combined form impossible. It belongs in the compiler/schema-defect
cohort before any vocabulary evaluation.

## Next audit cohort

Select once from this frozen ledger and do not regenerate:

1. the 20 most repeated exact residue texts, with several source contexts;
2. the 20 criteria with the most residue spans;
3. five spread examples for each of the four mechanical residue reasons;
4. the sole schema/compiler mismatch above.

Deduplicate overlaps. A strong agent then inspects the source criterion,
payload, catalog, admitted structures, compiler diagnostics, and residue. Each
case is classified as grammar opportunity, defective or ambiguous contract,
model translation failure, nonoperative material, compiler/schema defect, or
mixed. The audit must also test whether an apparently missing concept is
already entailed by a structured MUST or stored in an existing carrier such as
write scope or dependencies.

No v0.34 vocabulary change is justified until that classification exists.
