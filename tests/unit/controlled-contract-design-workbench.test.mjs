import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deriveControlledContractAcceptanceCoverage
} from "../../packages/wiki-core/src/lib/controlled-contract-acceptance-coverage.mjs";
import {
  deriveControlledContractAuthoringState
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-state.mjs";
import {
  CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS,
  deriveControlledContractDesignWorkbench
} from "../../packages/wiki-core/src/lib/controlled-contract-design-workbench.mjs";
import { deriveCriterionIdentitySet } from
  "../../packages/controlled-contract/lib/acceptance-coverage-identity.mjs";

const SHA = (character) => `sha256:${character.repeat(64)}`;
const SUBJECT = Object.freeze({ wk_id: "WK-2504", focus: null,
  generation_id: "generation-one", manifest_digest: SHA("9") });
const BINDINGS = Object.freeze({
  workRecordLocatorDigest: SHA("0"), contractDigest: SHA("a"),
  contractNodeDigest: SHA("1"), proofPlanDigest: SHA("b"),
  selectedPackDigest: SHA("c"), mappingDigest: SHA("d"),
  assessmentDigest: SHA("2"), proofAssessmentDigest: SHA("3"),
  profileVersionDigest: SHA("4"), selectorArtifactDigest: SHA("5"),
  ownershipDigest: SHA("6"), verificationDigest: SHA("7"),
  optionalScopeDigest: null, sourceDigest: SHA("8"),
  sourceKind: "obligation-coverage"
});

function authoringState() {
  const carrier = (kind, contentDigest, content = {}) => ({
    carrier_kind: kind, content_digest: contentDigest, content
  });
  return deriveControlledContractAuthoringState({
    wkId: SUBJECT.wk_id,
    carriers: {
      contract: carrier("contract", BINDINGS.contractDigest, { residue: [] }),
      evaluation_input: carrier("evaluation_input", SHA("e")),
      proof_plan_request: carrier("proof_plan_request", SHA("f"), {
        requested_intents: ["intent"], selected_packs: []
      }),
      proof_plan: carrier("proof_plan", BINDINGS.proofPlanDigest)
    },
    proofPlanBinding: { status: "current", content_digest: BINDINGS.proofPlanDigest }
  });
}

function acceptanceCoverage(size, state = "covered") {
  const criteria = Array.from({ length: size }, (_, index) => `criterion ${index}`);
  const identities = deriveCriterionIdentitySet({
    criteria, selectedUnitDigest: SHA("1"), bindings: BINDINGS
  }).identities;
  const result = deriveControlledContractAcceptanceCoverage({
    unit: { id: SUBJECT.wk_id, kind: "work_item", digest: SHA("1") },
    criteria,
    bindings: BINDINGS,
    mappings: identities.map((entry, index) => ({
      criterionIdentity: entry.identity, nodeIds: [`node-${index}`]
    })),
    contractNodes: identities.map((_, index) => ({ id: `node-${index}`, mandatory: true })),
    selectedPackNodeIds: identities.map((_, index) => `node-${index}`),
    criterionAxes: identities.map((entry) => ({
      criterionIdentity: entry.identity,
      structuralVerification: state,
      implementationOwnership: state,
      verificationOwnership: state,
      scopeFeasibility: state
    }))
  });
  return { ...result,
    wkId: SUBJECT.wk_id, focus: SUBJECT.focus, selectedUnit: null,
    carrier: { content_digest: SHA("e") },
    source: { source_kind: "obligation-coverage", content_digest: SHA("8") },
    authoring_identity: SHA("6"), changed_bindings: [],
    criteria_with_locators: result.criterion_identities.identities.map((criterion, index) => ({
      ...criterion, source_locator: `/acceptance/criteria/${index}`
    })) };
}

function obligationCoverage(acceptance, { explicitGaps = 0, stale = false,
  designStatus = {}, withoutSelection = [] } = {}) {
  const size = acceptance.criterion_identities.identities.length;
  const criteria = acceptance.criterion_identities.identities.map((criterion, index) => ({
    ...criterion, source_locator: `/acceptance/criteria/${index}`
  }));
  const rows = criteria.map((criterion, index) => {
    const gap = index >= size - explicitGaps;
    const proof = gap
      ? { kind: "explicit_gap", gap_kind: "review_only", reason: "review evidence" }
      : { kind: "pack_mapping", pack_id: "proof.test", requested_intent: "intent",
        profile_id: "proof.test", profile_version: "1.0.0",
        selector: { kind: "claim", component_id: `claim-${index}` }, };
    const selection = gap || withoutSelection.includes(index) ? null
      : { proof_name: proof.profile_id, proof_version: proof.profile_version, parameters: {} };
    return {
      obligation_id: `OBLIGATION-${index}`,
      source_locator: criterion.source_locator,
      source_locator_digest: SHA(String(index % 10)),
      statement: `obligation ${index}`,
      controlled_contract_node_ids: gap
        ? [`claim-gap-${index}`]
        : [`claim-target-${index}`, `claim-verify-${index}`],
      mechanism: { owner: "coordinator", kind: "test", selector: `test-${index}` },
      proof,
      selection,
      ...(selection === null ? {} : { design_status: designStatus[index] ?? "valid" })
    };
  });
  return {
    wkId: SUBJECT.wk_id, focus: SUBJECT.focus,
    canonicalSet: { generation: SUBJECT.generation_id,
      manifest_content_digest: SUBJECT.manifest_digest },
    criteria, rows, sourceCurrent: !stale,
    staleReasons: stale ? ["source_locator_digest"] : [],
    bindings: { contractDigest: BINDINGS.contractDigest,
      proofPlanDigest: BINDINGS.proofPlanDigest },
    prospectiveIdentity: { wk_id: SUBJECT.wk_id, content_digest: SHA("8") },
    criterionIdentities: acceptance.criterion_identities,
    authoringApplicability: {
      criterion_relationships: stale ? [] : rows.map((row) => ({
        obligation_id: row.obligation_id, source_locator: row.source_locator,
        criterion_identity_digest: acceptance.criterion_identities.digest
      }))
    }
  };
}

function readyBinding(index) {
  return {
    verification_claim_id: `claim-verify-${index}`,
    test_selector: { name: `claim ${index} assertion`, nesting: 0 }
  };
}

function completeInput(size = 3, options = {}) {
  const acceptance = acceptanceCoverage(size);
  const explicitGaps = options.explicitGaps ?? 0;
  return {
    subject: SUBJECT,
    authoringState: authoringState(),
    workRecordValidation: [],
    contractAssessment: {
      schema_version: "controlled-contract-proof-assessment-summary.v1",
      family: "proof", state: options.assessmentState ??
        "structure_proven__profile_proven",
      source_current: options.assessmentCurrent ?? true,
      source: { work_record_id: SUBJECT.wk_id, focus: SUBJECT.focus,
        generation_id: SUBJECT.generation_id, manifest_digest: SUBJECT.manifest_digest,
        controlled_contract_digest: BINDINGS.contractDigest,
        proof_plan_digest: BINDINGS.proofPlanDigest },
      cross_carrier_integrity: { state: "pass", counts: { findings: 0 },
        returned_count: 0, omitted_count: 0 },
      counts: { per_pack_outcomes: 2, diagnostics: 0 },
      total_count: 2, omitted_count: 2,
      continuation: "task-result-snapshot.v1",
      supported_next_call: null,
      first_actionable_gaps: []
    },
    obligationCoverage: obligationCoverage(acceptance, options),
    acceptanceCoverage: acceptance,
    testProofBindings: Array.from({ length: size - explicitGaps },
      (_, index) => readyBinding(index)),
    testProofSource: { wk_id: SUBJECT.wk_id, focus: SUBJECT.focus,
      carrier_kind: "contract", content_digest: BINDINGS.contractDigest }
  };
}

function byId(result, dimensionId) {
  return result.dimensions.find(({ dimension_id: id }) => id === dimensionId);
}

test("mechanically complete manifests preserve incumbent results and exact populations", () => {
  const input = completeInput(3, { explicitGaps: 1 });
  const result = deriveControlledContractDesignWorkbench(input);

  assert.equal(result.schema_version, "controlled-contract-design-workbench.v1");
  assert.equal(result.mechanically_complete, true);
  assert.equal(result.dimension_count, 8);
  assert.equal(result.actionable_row_count, 0);
  assert.deepEqual(result.authority, {
    semantic_quality: false, review_sufficiency: false, lifecycle_readiness: false,
    dispatch: false, admissibility: false, completion: false, cce_exclusive: true
  });
  const obligations = byId(result, "obligation_coverage");
  assert.deepEqual(obligations.counts, {
    complete: 2, missing: 0, stale: 0, conflicting: 0, not_applicable: 1,
    total: 3, returned: 3, omitted: 0
  });
  assert.equal(obligations.owner,
    CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS.obligation_coverage);
  assert.deepEqual(obligations.owner_result, input.obligationCoverage);
  const declaration = byId(result, "runtime_proof_declaration");
  assert.equal(declaration.counts.complete, 2);
  assert.equal(declaration.owner,
    CONTROLLED_CONTRACT_DESIGN_WORKBENCH_OWNERS.runtime_proof_declaration);

  for (const row of declaration.rows) {
    assert.deepEqual(row.evidence.declared_runtime_test.selector,
      { name: `claim ${row.semantic_identity.verification_id.slice(-1)} assertion`,
        nesting: 0 });
    assert.equal(row.evidence.execution_evidence, "owned_by_workspace_verify_proof");
  }
  const serialized = JSON.stringify(result);
  for (const executionFact of ["proof_execution_readiness", "execution_readiness_gaps",
    "structural_status", "coverage_baseline", "runtime_test_identity"]) {
    assert.equal(serialized.includes(executionFact), false, executionFact);
  }
  assert.equal(byId(result, "omitted_obligations").counts.complete, 3);
  assert.deepEqual(byId(result, "contract_assessment").counts, {
    complete: 1, missing: 0, stale: 0, conflicting: 0, not_applicable: 0,
    total: 1, returned: 1, omitted: 0
  });
});

test("declaration completeness requires each declared claim's saved valid selection", () => {
  const complete = deriveControlledContractDesignWorkbench(completeInput(2));
  assert.equal(complete.mechanically_complete, true);
  assert.equal(byId(complete, "runtime_proof_declaration").counts.complete, 2);
  for (const options of [{ withoutSelection: [0] }, { designStatus: { 0: "invalid" } }]) {
    const input = completeInput(2, options);
    const result = deriveControlledContractDesignWorkbench(input);
    const label = JSON.stringify(options);
    assert.equal(result.mechanically_complete, false, label);
    const declaration = byId(result, "runtime_proof_declaration");
    assert.deepEqual({ complete: declaration.counts.complete, missing: declaration.counts.missing,
      total: declaration.counts.total }, { complete: 1, missing: 1, total: 2 }, label);
    const row = (verificationId) => declaration.rows.find(({ semantic_identity: identity }) =>
      identity.verification_id === verificationId);
    assert.equal(row("claim-verify-0").state, "missing", label);
    assert.deepEqual(row("claim-verify-0").reason_codes, ["runtime_proof_obligation_missing"], label);
    assert.equal(row("claim-verify-0").evidence.runtime_eligible, false, label);
    assert.equal(row("claim-verify-1").state, "complete", label);
    assert.deepEqual(declaration.owner_result.eligibility.map(({ verification_id: id,
      obligation_id: obligation, classification }) => [id, obligation, classification]), [
      ["claim-verify-0", null, "unresolved"],
      ["claim-verify-1", "OBLIGATION-1", "runtime"]
    ], label);
  }
});

test("shared verification keeps one declaration and distinct stable relationship rows", () => {
  const input = completeInput(2);
  input.obligationCoverage.rows[1].controlled_contract_node_ids =
    ["claim-target-1", "claim-verify-0"];
  input.testProofBindings.pop();
  const result = deriveControlledContractDesignWorkbench(input);
  const declaration = byId(result, "runtime_proof_declaration");
  assert.equal(result.mechanically_complete, true);
  assert.deepEqual(declaration.owner_result.counts, {
    declarations: 1, relationships: 2, joined_rows: 2,
    eligibility_population: 2, unresolved: 0, runtime_eligible: 2,
    non_runtime: 0, conflicting: 0
  });
  assert.deepEqual(declaration.rows.map(({ semantic_identity: identity, state }) =>
    [identity.verification_id, identity.obligation_id, state]).sort(), [
    ["claim-verify-0", "OBLIGATION-0", "complete"],
    ["claim-verify-0", "OBLIGATION-1", "complete"]
  ]);
  assert.equal(new Set(declaration.rows.map(({ row_id: id }) => id)).size, 2);
});

test("absent and partial owner populations remain visible and incomplete", () => {
  const absent = deriveControlledContractDesignWorkbench({ subject: SUBJECT });
  assert.equal(absent.mechanically_complete, false);

  assert.equal(absent.incomplete_row_count, 15);
  assert.equal(absent.actionable_row_count, 0);
  assert.equal(absent.non_actionable_row_count, 15);
  assert.deepEqual(byId(absent, "cross_owner_consistency").rows.map(
    ({ semantic_identity: identity }) => identity.identity_kind).sort(), [
    "acceptance_criterion_identity_digest", "contract_digest", "controlled_focus",
    "criterion_identity_population", "generation_id", "manifest_digest",
    "obligation_criterion_identity_digest", "selected_unit", "wk_id"
  ]);
  assert.equal(byId(absent, "cross_owner_consistency").counts.missing, 8);
  assert.ok(absent.non_actionable_rows.every((row) =>
    row.eligible_response_forms.length === 0 &&
    row.non_actionable_reason === "semantic_continuation_not_resolved"));
  for (const id of ["authoring_stage", "work_record_validation", "contract_assessment",
    "obligation_coverage", "acceptance_coverage",
    "runtime_proof_declaration", "omitted_obligations"]) {
    assert.equal(byId(absent, id).counts.missing, 1, id);
  }

  const input = completeInput(4);
  input.obligationCoverage.rows.pop();
  input.obligationCoverage.criteria = [];
  input.obligationCoverage.authoringApplicability.criterion_relationships.pop();
  const partial = deriveControlledContractDesignWorkbench(input);
  assert.equal(partial.mechanically_complete, false);
  const omitted = byId(partial, "omitted_obligations");
  assert.equal(omitted.counts.total, 4);
  assert.equal(omitted.counts.missing, 1);
  assert.equal(omitted.rows.find(({ state }) => state === "missing").reason_codes[0],
    "controlled_contract_obligation_omitted");
});

test("stale, unsupported, conflicting, and unresolved facts block completion", () => {
  const stale = completeInput(2, { stale: true, assessmentCurrent: false });
  let result = deriveControlledContractDesignWorkbench(stale);
  assert.equal(result.mechanically_complete, false);
  assert.equal(byId(result, "contract_assessment").counts.stale, 1);
  assert.equal(byId(result, "obligation_coverage").counts.stale, 2);

  const unsupported = completeInput(2, {
    assessmentState: "structure_proven__profile_not_proven"
  });
  unsupported.contractAssessment.first_actionable_gaps = [{ code: "unsupported_assertion" }];
  result = deriveControlledContractDesignWorkbench(unsupported);
  assert.equal(byId(result, "contract_assessment").counts.conflicting, 1);
  assert.deepEqual(byId(result, "contract_assessment").rows[0]
    .evidence.first_actionable_gaps, [{ code: "unsupported_assertion" }]);

  const conflicting = completeInput(2);
  conflicting.acceptanceCoverage = structuredClone(acceptanceCoverage(2, "duplicate"));

  conflicting.obligationCoverage.authoringApplicability
    .criterion_relationships[0].criterion_identity_digest = SHA("f");
  conflicting.workRecordValidation = [{ code: "invalid_record", path: "acceptance" }];

  conflicting.testProofBindings[1].test_selector = { name: "", nesting: 0 };
  conflicting.obligationCoverage.rows.push(
    structuredClone(conflicting.obligationCoverage.rows[0]));
  result = deriveControlledContractDesignWorkbench(conflicting);
  assert.equal(result.mechanically_complete, false);
  assert.ok(byId(result, "acceptance_coverage").counts.conflicting > 0);
  assert.equal(byId(result, "work_record_validation").counts.conflicting, 1);
  const declaration = byId(result, "runtime_proof_declaration");
  assert.equal(declaration.counts.conflicting, 3);
  const declarationReasons = (verificationId) => declaration.rows.find(
    ({ semantic_identity: identity }) => identity.verification_id === verificationId).reason_codes;
  assert.deepEqual(declarationReasons("claim-verify-0"),
    ["obligation_coverage_obligation_id_duplicate"]);
  assert.ok(declarationReasons("claim-verify-1").includes("stable_test_proof_selector_invalid"));
  assert.equal(byId(result, "obligation_coverage").counts.conflicting, 2);
  assert.equal(byId(result, "cross_owner_consistency").counts.conflicting, 1);
});

test("stable row identities and exact denominators do not depend on population size", () => {
  const small = deriveControlledContractDesignWorkbench(completeInput(1));
  const large = deriveControlledContractDesignWorkbench(completeInput(7, { explicitGaps: 2 }));
  for (const [result, size] of [[small, 1], [large, 7]]) {
    for (const id of ["obligation_coverage", "acceptance_coverage",
      "omitted_obligations"]) {
      const projected = byId(result, id);
      assert.equal(projected.counts.total, size, id);
      assert.equal(projected.counts.returned + projected.counts.omitted, size, id);
      assert.equal(new Set(projected.rows.map(({ row_id: rowId }) => rowId)).size,
        size, id);
    }
    assert.equal(byId(result, "runtime_proof_declaration").counts.total,
      size === 7 ? 5 : 1);
  }
  const obligationZero = (result) => byId(result, "obligation_coverage").rows.find(
    ({ semantic_identity: identity }) => identity.obligation_id === "OBLIGATION-0"
  ).row_id;
  assert.equal(obligationZero(small), obligationZero(large));
});

test("accepted assessment and accounting dispositions preserve incumbent facts", () => {
  const result = deriveControlledContractDesignWorkbench(completeInput(2));
  const assessment = byId(result, "contract_assessment");
  assert.equal(assessment.rows[0].evidence.overall_code,
    "structure_proven__profile_proven");
  assert.deepEqual(assessment.owner_accounting.find(({ path }) => path === "/")
    .denominators, { total_count: 2, omitted_count: 2 });
  assert.deepEqual(assessment.owner_accounting.find(({ path }) => path === "/")
    .continuation, {
      continuation: "task-result-snapshot.v1"
    });
  assert.deepEqual(assessment.owner_accounting.find(({ path }) => path === "/counts")
    .denominators, { per_pack_outcomes: 2, diagnostics: 0 });
  assert.deepEqual(byId(result, "acceptance_coverage").owner_accounting.find(
    ({ path }) => path === "/projection/page").denominators,
  { returned: 0, total: 0 });
  const invented = completeInput(2, { assessmentState: "proven" });
  assert.equal(deriveControlledContractDesignWorkbench(invented).mechanically_complete, false);
  delete invented.contractAssessment.continuation;
  delete invented.contractAssessment.supported_next_call;
  invented.contractAssessment.state =
    "structure_proven__profile_proven";
  assert.equal(byId(deriveControlledContractDesignWorkbench(invented),
    "contract_assessment").counts.conflicting, 1);
  const invalidAccounting = completeInput(1);
  delete invalidAccounting.contractAssessment.omitted_count;
  assert.throws(() => deriveControlledContractDesignWorkbench(invalidAccounting),
    (error) => error.code ===
      "controlled_contract_design_workbench_owner_accounting_invalid");
});

test("empty populations and obligation-to-runtime-proof join defects cannot complete", () => {
  const empty = deriveControlledContractDesignWorkbench(completeInput(0));
  for (const id of ["obligation_coverage", "acceptance_coverage",
    "runtime_proof_declaration", "omitted_obligations"]) {
    assert.equal(byId(empty, id).counts.missing, 1, id);
  }
  const emptyCriteriaInput = completeInput(1);
  emptyCriteriaInput.obligationCoverage.criteria = [];
  assert.ok(byId(deriveControlledContractDesignWorkbench(emptyCriteriaInput),
    "obligation_coverage").rows.some(({ reason_codes: reasons }) =>
    reasons.includes("obligation_criterion_population_empty")));
  const emptyAssessmentInput = completeInput(1);
  emptyAssessmentInput.contractAssessment.total_count = 0;
  emptyAssessmentInput.contractAssessment.omitted_count = 0;
  assert.equal(byId(deriveControlledContractDesignWorkbench(emptyAssessmentInput),
    "contract_assessment").counts.missing, 1);
  const missing = completeInput(2);
  missing.testProofBindings.pop();
  let result = deriveControlledContractDesignWorkbench(missing);
  assert.equal(result.mechanically_complete, false);
  assert.ok(byId(result, "obligation_coverage").rows.some(({ reason_codes: reasons }) =>
    reasons.includes("obligation_runtime_proof_binding_missing")));

  const duplicateBinding = completeInput(2);
  duplicateBinding.testProofBindings.push(readyBinding(0));
  result = deriveControlledContractDesignWorkbench(duplicateBinding);
  assert.ok(byId(result, "obligation_coverage").rows.some(({ reason_codes: reasons }) =>
    reasons.includes("obligation_runtime_proof_binding_ambiguous")));

  const gap = completeInput(2, { explicitGaps: 1 });
  gap.testProofBindings.push(readyBinding(1));
  gap.obligationCoverage.rows[1].controlled_contract_node_ids.push("claim-verify-1");
  result = deriveControlledContractDesignWorkbench(gap);
  const gapRow = byId(result, "obligation_coverage").rows.find(
    ({ semantic_identity: identity }) => identity.obligation_id === "OBLIGATION-1");
  assert.equal(gapRow.state, "not_applicable");
  assert.equal(gapRow.evidence.mapping_completeness.classification, "unresolved");
  assert.equal(gapRow.reason_codes.includes(
    "explicit_gap_retains_runtime_proof_binding"), false);
});

test("real manifest and criterion identities are joined without fabricated fields", () => {
  const input = completeInput(2);
  let consistency = byId(deriveControlledContractDesignWorkbench(input),
    "cross_owner_consistency");
  assert.equal(consistency.status, "complete");
  assert.equal(Object.hasOwn(input.acceptanceCoverage, "bindings"), false);
  assert.equal(byId(deriveControlledContractDesignWorkbench(input),
    "acceptance_coverage").owner_identity,
  input.acceptanceCoverage.authoring_identity);
  assert.ok(consistency.owner_result.manifest_digest.includes(SUBJECT.manifest_digest));

  assert.ok(consistency.owner_result.acceptance_criterion_identity_digest.includes(
    input.acceptanceCoverage.criterion_identities.digest));
  assert.ok(consistency.owner_result.obligation_criterion_identity_digest.includes(
    input.obligationCoverage.criterionIdentities.digest));
  assert.equal(new Set(consistency.owner_result.criterion_identity_population).size, 1);

  input.obligationCoverage.authoringApplicability.criterion_relationships[0]
    .criterion_identity_digest = SHA("f");
  input.obligationCoverage.canonicalSet.manifest_content_digest = SHA("e");
  consistency = byId(deriveControlledContractDesignWorkbench(input),
    "cross_owner_consistency");
  assert.ok(consistency.rows.some(({ semantic_identity: identity, state }) =>
    identity.identity_kind === "obligation_criterion_identity_digest" &&
      state === "conflicting"));

  assert.ok(consistency.rows.some(({ semantic_identity: identity, state }) =>
    identity.identity_kind === "acceptance_criterion_identity_digest" &&
      state === "complete"));
  assert.ok(consistency.rows.some(({ semantic_identity: identity, state }) =>
    identity.identity_kind === "manifest_digest" && state === "conflicting"));
});

test("mandatory acceptance gaps explicitly conflict with reassuring coverage projections", () => {
  const input = completeInput(2);
  input.acceptanceCoverage = structuredClone(input.acceptanceCoverage);
  input.acceptanceCoverage.evaluation.unmapped_mandatory_node_ids = ["claim-unmapped"];
  const originalObligation = structuredClone(input.obligationCoverage);
  const result = deriveControlledContractDesignWorkbench(input);
  const obligations = byId(result, "obligation_coverage");
  const omitted = byId(result, "omitted_obligations");
  const consistency = byId(result, "cross_owner_consistency");
  assert.equal(result.mechanically_complete, false);
  assert.equal(obligations.status, "incomplete");
  assert.equal(omitted.status, "incomplete");
  assert.deepEqual(obligations.owner_result, originalObligation);
  assert.ok(consistency.rows.some((row) =>
    row.reason_codes.includes("controlled_contract_cross_owner_mandatory_claim_unmapped")));
  const mandatoryConflict = consistency.rows.find((row) =>
    row.reason_codes.includes("controlled_contract_cross_owner_mandatory_claim_unmapped"));
  assert.deepEqual(mandatoryConflict.evidence.unmapped_mandatory_node_ids,
    ["claim-unmapped"]);
  assert.deepEqual(obligations.reconciliation, {
    status: "conflicting",
    reason_codes: ["controlled_contract_cross_owner_mandatory_claim_unmapped"],
    unmapped_mandatory_count: 1
  });
});

test("cross-owner method conflicts preserve both authored values and exact identities", () => {
  const input = completeInput(1);
  input.runtimeProofEligibility = [{
    obligation_id: "OBLIGATION-0",
    verification_id: "claim-verify-0",
    classification: "conflicting",
    reason_code: "controlled_contract_cross_owner_verification_method_conflict",
    mechanism_kind: "inspection",
    verification_method: "test_execution",
    proof_kind: "saved_selection",
    mapping_classification: "mapped",
    mapping_reason_code: null
  }];
  const result = deriveControlledContractDesignWorkbench(input);
  const conflict = byId(result, "cross_owner_consistency").rows.find((entry) =>
    entry.reason_codes.includes(
      "controlled_contract_cross_owner_verification_method_conflict"));
  assert.deepEqual(conflict.semantic_identity, {
    identity_kind: "verification_method", obligation_id: "OBLIGATION-0"
  });
  assert.deepEqual({ obligation_id: conflict.evidence.obligation_id,
    verification_id: conflict.evidence.verification_id,
    mechanism_kind: conflict.evidence.mechanism_kind,
    verification_method: conflict.evidence.verification_method }, {
    obligation_id: "OBLIGATION-0", verification_id: "claim-verify-0",
    mechanism_kind: "inspection", verification_method: "test_execution"
  });
});

test("duplicate remediation preserves the first semantic row identity", () => {
  const baselineInput = completeInput(2);
  const baseline = deriveControlledContractDesignWorkbench(baselineInput);
  const firstId = byId(baseline, "obligation_coverage").rows.find(
    ({ semantic_identity: identity }) => identity.obligation_id === "OBLIGATION-0").row_id;
  baselineInput.obligationCoverage.rows.push(
    structuredClone(baselineInput.obligationCoverage.rows[0]));
  const duplicated = deriveControlledContractDesignWorkbench(baselineInput);
  const duplicateRows = byId(duplicated, "obligation_coverage").rows.filter(
    ({ semantic_identity: identity }) => identity.obligation_id === "OBLIGATION-0");
  assert.equal(duplicateRows.find(({ semantic_identity: identity }) =>
    !Object.hasOwn(identity, "duplicate_ordinal")).row_id, firstId);
  assert.equal(duplicateRows.find(({ semantic_identity: identity }) =>
    identity.duplicate_ordinal === 1).row_id,
  byId(deriveControlledContractDesignWorkbench(baselineInput), "obligation_coverage")
    .rows.find(({ semantic_identity: identity }) => identity.duplicate_ordinal === 1).row_id);
  const runtimeFirstId = byId(baseline, "runtime_proof_declaration").rows.find(
    ({ semantic_identity: identity }) => identity.verification_id === "claim-verify-0").row_id;

  const declarationInput = completeInput(2);
  declarationInput.testProofBindings.push(structuredClone(declarationInput.testProofBindings[0]));
  declarationInput.testProofBindings.push(structuredClone(declarationInput.testProofBindings[0]));

  const ordinal = ({ semantic_identity: identity }) => identity.duplicate_ordinal ?? 0;
  const declarationRows = (input) => byId(deriveControlledContractDesignWorkbench(input),
    "runtime_proof_declaration").rows.filter(({ semantic_identity: identity }) =>
    identity.verification_id === "claim-verify-0").sort((left, right) =>
    ordinal(left) - ordinal(right));
  const duplicatedResult = deriveControlledContractDesignWorkbench(declarationInput);
  const runtimeRows = declarationRows(declarationInput);

  assert.deepEqual(runtimeRows.map(({ semantic_identity: identity }) => identity), [
    { verification_id: "claim-verify-0", obligation_id: "OBLIGATION-0" },
    { verification_id: "claim-verify-0", obligation_id: "OBLIGATION-0", duplicate_ordinal: 1 },
    { verification_id: "claim-verify-0", obligation_id: "OBLIGATION-0", duplicate_ordinal: 2 }
  ]);
  assert.equal(runtimeRows[0].row_id, runtimeFirstId);
  assert.deepEqual(declarationRows(declarationInput).map(({ row_id: rowId }) => rowId),
    runtimeRows.map(({ row_id: rowId }) => rowId));
  assert.equal(new Set(runtimeRows.map(({ row_id: rowId }) => rowId)).size, 3);
  for (const row of runtimeRows) {
    assert.equal(row.state, "conflicting");
    assert.deepEqual(row.reason_codes, ["runtime_proof_identity_duplicate"]);
    assert.equal(row.evidence.runtime_eligible, true);
    assert.deepEqual(row.evidence.obligation_ids, ["OBLIGATION-0"]);
  }
  const duplicatedDeclarations = byId(duplicatedResult, "runtime_proof_declaration");
  assert.equal(duplicatedResult.mechanically_complete, false);
  assert.deepEqual({ complete: duplicatedDeclarations.counts.complete,
    conflicting: duplicatedDeclarations.counts.conflicting },
  { complete: 1, conflicting: 3 });
  assert.deepEqual(duplicatedDeclarations.owner_result.eligibility.map(
    ({ verification_id: id, obligation_id: obligation, classification }) =>
      [id, obligation, classification]), [
    ["claim-verify-0", "OBLIGATION-0", "runtime"],
    ["claim-verify-1", "OBLIGATION-1", "runtime"]
  ]);

  declarationInput.testProofBindings.splice(2);
  const restored = deriveControlledContractDesignWorkbench(declarationInput);
  assert.equal(restored.mechanically_complete, true);
  assert.deepEqual(declarationRows(declarationInput).map(({ row_id: rowId, state }) =>
    [rowId, state]), [[runtimeFirstId, "complete"]]);
});

test("diagnostic shape, positional axes, and semantic judgments fail loudly or incomplete", () => {
  assert.throws(() => deriveControlledContractDesignWorkbench({
    ...completeInput(1), workRecordValidation: { diagnostics: [] }
  }), (error) => error.code === "controlled_contract_design_workbench_owner_projection_invalid");
  const positional = completeInput(2);
  positional.acceptanceCoverage = structuredClone(positional.acceptanceCoverage);
  positional.acceptanceCoverage.criterion_axes.reverse();
  assert.throws(() => deriveControlledContractDesignWorkbench(positional),
    /positionally inconsistent/);

  for (const code of ["unjustified_not_applicable", "unresolved_semantic_judgment"]) {
    const input = completeInput(2, { explicitGaps: 1,
      assessmentState: "structure_proven__profile_not_proven" });
    input.contractAssessment.first_actionable_gaps = [{ code }];
    const result = deriveControlledContractDesignWorkbench(input);
    assert.equal(result.mechanically_complete, false, code);
    assert.deepEqual(byId(result, "contract_assessment").rows[0]
      .evidence.first_actionable_gaps, [{ code }]);
  }
});

test("the aggregation module imports semantic owners and contains no effects or policy verdict", async () => {
  const source = await readFile(new URL(
    "../../packages/wiki-core/src/lib/controlled-contract-design-workbench.mjs",
    import.meta.url
  ), "utf8");
  for (const owner of [
    "projectStableTestProofSelector", "isAcceptanceCoverageComplete",
    "CONTROLLED_CONTRACT_AUTHORING_STAGES", "CONTROLLED_CONTRACT_AUTHORING_TERMINAL_STAGE"
  ]) assert.match(source, new RegExp(`import[\\s\\S]{0,240}${owner}`));
  for (const forbidden of [
    "writeControlledContractCarrierSet", "publishNewControlledContractCarrierGeneration",
    "rememberControlledContractAuthoringContinuation", "session-role-tool-access",
    "workspace_agent_dispatch", "node_engine_decision"
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
