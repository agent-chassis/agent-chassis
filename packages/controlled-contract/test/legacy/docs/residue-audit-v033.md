# v0.33 residue-audit comparison

> **Noncanonical experimental evidence.** work record owns durable coordination. These classifications do not authorize a grammar change and are not a review of the source WKs.

## Frozen cohort

Three audits were asked to classify the same 522 non-empty residue spans selected from 89 slice criteria in the frozen work record through work record v0.33 corpus ledger. The original criterion selection retained the corpus's one schema-invalid criterion, but the Vertex runner split only non-empty residue lists and therefore omitted that criterion from both Vertex audits. The local audit inspected it explicitly.

The source ledger is `the project documentationl`. The deterministic selection is `the project documentationl`.

## Results

The local Agy audit wrote `the project documentationl` and `summary.md`. It reported 523 audited items because it counted the schema-invalid criterion alongside the 522 non-empty residue spans:

- nonoperative material: 480;
- defective contracts: 25;
- model translation failures: 17;
- compiler/schema defects: 1;
- grammar opportunities: 0.

The Vertex Gemini 3.6 Flash HIGH audit used one constrained call per residue span, no retry, and completed all 522 calls without a transport error. It wrote `the project documentationl` and `summary.json`:

- nonoperative material: 257;
- model translation failures: 245;
- grammar opportunities: 20.

The Vertex Gemini 3.1 Pro Preview HIGH audit used the same one-span, no-retry shape and also completed all 522 calls. It wrote `the project documentationl` and `summary.json`:

- nonoperative material: 231;
- model translation failures: 201;
- defective contracts: 44;
- grammar opportunities: 37;
- compiler/schema defects: 5;
- mixed causes: 4.

Flash and Pro assigned the same primary cause to 357 of 522 spans (68.4%). All three audits agreed on 194 of 522 spans (37.2%). Those agreement figures describe model classifications, not correctness.

Earlier multi-span Vertex runs are retained as transport evidence only. Repeating the large operator enum inside an array of findings caused Vertex constraint-state failures; one-span calls removed that transport confound.

## Determination

Residue extraction and cohort selection are mechanical only after segmentation and audit invocation are correct. Causal classification is not. The audits disagree materially, and the local audit includes at least one doubtful class: it proposes a `MUST_NOT modifies` claim for empty-write-scope language even though `write_scope` is already the authoritative carrier.

Neither distribution is a performance score or a vocabulary ballot. Gemini's classifications are useful hypotheses, but a proposed primitive still needs exact proposition preservation, recurrence across unrelated criteria, carrier and closed-world checks, and operator disposition. A local-agent assertion that something is nonoperative likewise does not remove it from the source contract.

The joined review exposed four deterministic defects that are now covered by regressions in the tracked package:

1. comma-formatted numbers were fragmented into several numeric terminals;
2. Markdown headings and list items leaked into adjacent source elements;
3. schema-invalid criteria with no residue spans were retained by selection but dropped before invocation;
4. the compact wire grammar allowed one range claim to carry multiple lower and upper bounds even though downstream normalization permits only one pair.

The corrected model-facing schema constrains operand families directly and limits a range claim to one lower/upper pair. The audit runner emits a dedicated schema-invalid assessment when no residue span exists. Frozen ledgers are not rewritten.

The Pro proposals cluster around a typed proposition/evaluation target, idempotent behavior, ordering by a named property, and repository-specific review controls. These remain design candidates, not adopted v0.34 additions. Review controls require an ownership check against CCE and a repository-profile decision; aggregate model counts alone justify no grammar change.
