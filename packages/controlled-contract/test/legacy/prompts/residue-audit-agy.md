# TASK — audit v0.33 controlled-contract residue locally

You are auditing an experimental controlled-contract grammar. You are not
reviewing or rewriting the WKs, and you are not deciding policy.

## Canonical and experimental context

Read:

1. `AGENTS.md`.
2. `wiki/work-records/work record.json` — canonical coordination context.
3. `packages/controlled-contract/README.md` — current package boundary.
4. `packages/controlled-contract/docs/corpus-baseline-v033.md`
   — frozen run identity and measurement limits.
5. `packages/controlled-contract/schema/controlled-contract-general.experimental.v0.33.schema.json`
   — the exact readable model-facing grammar.

The frozen translation ledger is:

`the project documentationl`

Use the deterministic audit selection at:

`the project documentationl`

Do not regenerate any controlled-contract translation. Audit the stored source,
payload, reference catalog, compiler diagnostics, and residue only.

## Objective

Determine why each selected exact residue span remained after v0.33
compilation. The legacy-corpus translation is a vocabulary-development
instrument. The orchestrator writing a WK remains responsible for accurately
specifying its contract; this audit does not transfer that responsibility to a
translator, compiler, or reviewer.

Classify each selected span with exactly one primary cause:

- `grammar_opportunity`
- `defective_contract`
- `model_translation_failure`
- `nonoperative_material`
- `compiler_schema_defect`
- `mixed`
- `uncertain`

Also record:

- operative status: `operative | nonoperative | mixed | uncertain`;
- current grammar fit:
  `expressible_currently | requires_general_primitive | should_not_be_structured | uncertain`;
- whether the meaning is already entailed: `yes | no | uncertain`;
- existing carrier:
  `none | read_scope | repo_paths | write_scope | depends_on | relation | verification | evidence | other | uncertain`;
- exact existing `value-kind:predicate` operator when one faithfully expresses
  the proposition, otherwise `none`;
- recommended action:
  `no_grammar_change | fix_translation | fix_compiler_or_schema | repair_source_contract | propose_general_primitive | strong_review_required`;
- confidence: `low | medium | high`;
- a short explanation grounded in the stored source, payload, and compiler
  result;
- a generalized candidate concept only when a reusable primitive is genuinely
  missing, otherwise an empty string.

## Load-bearing classification rules

1. `expressible_currently` requires proposition-level equivalence. A related
   predicate is not enough: modality, subject, predicate, object, and
   applicability must preserve the source meaning.
2. A directive to determine, inspect, compare, prove, or review whether
   proposition P holds is not an assertion that P holds. The operative
   obligation may be an analysis or verification task while P remains
   undetermined.
3. Do not create a vocabulary primitive for a discourse heading, rationale,
   historical provenance, review label, or other nonoperative material.
4. Do not duplicate canonical carriers. Read scope, repository paths, write
   scope, dependencies, relations, verification, and evidence remain their own
   structured fields.
5. Check closed-world entailment before proposing another prohibition. A fully
   structured MUST closes its solution slot; undeclared alternatives are
   already excluded unless explicitly allowed.
6. Treat the prior translation and compiler as fallible evidence. An unused
   variable does not prove that it should be attached to the nearest available
   predicate. A compiler-produced residue span may itself be erroneous.
7. Distinguish a bad legacy contract from a grammar gap. Ambiguous alternatives,
   undefined classes, conflicting authority, and delegated design decisions
   should be repaired by the orchestrator rather than absorbed into vocabulary.
8. A grammar opportunity must be general and operative. Do not recommend
   adoption from one instance. Cite recurring examples from distinct criteria
   and state when recurrence has not been established.
9. Do not optimize for lower residue, higher admitted-claim count, or agreement
   with the prior model. The objective is faithful, controlled expression.
10. The one schema-invalid case,
    `work record:criteria:0005`, must be inspected explicitly. Determine
    whether its multiple range operands expose a model-facing/downstream grammar
    mismatch rather than a vocabulary gap.

## Required output

Write only these noncanonical scratch artifacts:

- `the project documentationl`
- `the project documentation`

The JSONL contains one row per selected residue span with the fields specified
above plus `source_criterion_id` and the exact `residue_text`. Classify every
selected span exactly once; do not silently drop uncertain cases.

The summary must report:

- selected criteria and selected residue spans;
- counts by primary cause, operative status, grammar fit, action, and
  confidence;
- recurring grammar candidates with supporting criterion IDs;
- model-translation failure patterns;
- compiler/schema defects;
- nonoperative or carrier-owned residue that should not change the grammar;
- defective contract patterns that should be refused or repaired by the
  orchestrator;
- uncertain cases requiring stronger review;
- an explicit determination of whether the residue evidence currently
  justifies any v0.34 grammar addition.

Do not edit work record, the grammar, compiler, source ledger, selection, or any
canonical repository file. The local audit is evidence for later operator
disposition, not durable state.
