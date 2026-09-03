import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deriveControlledContractAcceptanceCoverage,
  queryControlledContractAcceptanceCoverage
} from "../../packages/wiki-core/src/lib/controlled-contract-acceptance-coverage.mjs";
import { deriveCriterionIdentitySet } from "../../packages/controlled-contract/lib/acceptance-coverage-identity.mjs";
import { controlledContractContentDigest } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  createControlledContractAcceptanceCoverageOperation,
  describeControlledContractAcceptanceCoverageOperation,
  queryControlledContractAcceptanceCoverageOperation,
  rebaseControlledContractAcceptanceCoverageOperation,
  removeControlledContractAcceptanceCoverageOperation,
  upsertControlledContractAcceptanceCoverageOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  patchControlledContractAcceptanceCoverageOperation,
  patchControlledContractObligationCoverageOperation
} from "../../packages/wiki-core/src/operations/controlled-contract/acceptance-coverage-operations.mjs";
import {
  applyCompleteRebaseResolution,
  assertConflictSetCurrent,
  planAcceptanceCoverageRebase,
  planObligationCoverageRebase,
  projectRebaseConflictPage
} from "../../packages/wiki-core/src/operations/controlled-contract/acceptance-coverage-rebase.mjs";

const BINDINGS = {
  contractDigest: "sha256:contract",
  proofPlanDigest: "sha256:proof",
  selectedPackDigest: "sha256:pack",
  mappingDigest: "sha256:mapping"
};

const AXES = [
  "covered", "uncovered", "duplicate", "unknown", "stale", "outside_pack",
  "retained_residue", "infeasible"
];

function criterion(number) {
  return `criterion ${number}`;
}

function input({ criteria = Array.from({ length: 30 }, (_, index) => criterion(index)), mappings = [],
  contractNodes = [{ id: "node-covered", mandatory: true }], selectedPackNodeIds = ["node-covered"],
  criterionAxes, priorCriterionIdentities, scopeFacts, proofCoverage, resultFacts } = {}) {
  const identities = deriveCriterionIdentitySet({
    criteria, selectedUnitDigest: "sha256:unit", bindings: BINDINGS
  }).identities;
  const axes = criterionAxes ?? criteria.map((_, index) => ({
    criterionIdentity: identities[index].identity,
    structuralVerification: "covered",
    implementationOwnership: "covered",
    verificationOwnership: "covered",
    scopeFeasibility: "covered"
  }));
  return {
    unit: { id: "WK-2053#SLICE-006", kind: "slice", digest: "sha256:unit" },
    criteria,
    bindings: BINDINGS,
    mappings,
    contractNodes,
    selectedPackNodeIds,
    criterionAxes: axes,
    ...(priorCriterionIdentities === undefined ? {} : { priorCriterionIdentities }),
    ...(scopeFacts === undefined ? {} : { scopeFacts }),
    ...(proofCoverage === undefined ? {} : { proofCoverage }),
    ...(resultFacts === undefined ? {} : { resultFacts })
  };
}

function stateFor(state) {
  const criteria = AXES.map((_, index) => criterion(index));
  const ids = deriveControlledContractAcceptanceCoverage(input({ criteria })).criterion_identities.identities;
  const mappings = [
    { criterionIdentity: ids[0].identity, nodeIds: ["node-covered"] },
    { criterionIdentity: ids[1].identity, nodeIds: [] },
    { criterionIdentity: ids[2].identity, nodeIds: ["node-covered", "node-covered"] },
    { criterionIdentity: ids[3].identity, nodeIds: ["missing-node"] },
    { criterionIdentity: ids[4].identity, nodeIds: ["node-outside"] },
    { criterionIdentity: ids[5].identity, residue: true },
    { criterionIdentity: ids[6].identity, infeasible: true },
    { criterionIdentity: "unknown-criterion", nodeIds: ["node-covered"] }
  ];
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria,
    mappings,
    contractNodes: [
      { id: "node-covered", mandatory: true },
      { id: "node-outside", mandatory: false }
    ],
    selectedPackNodeIds: ["node-covered"],
    criterionAxes: criteria.map((_, index) => ({
      criterionIdentity: ids[index].identity,
      structuralVerification: state,
      implementationOwnership: state,
      verificationOwnership: state,
      scopeFeasibility: state
    }))
  }));
  return { adapted, ids };
}

test("direct adapter preserves canonical identity, facts, axes, and evaluator states", () => {
  const { adapted, ids } = stateFor("covered");
  assert.equal(adapted.unit_digest, "sha256:unit");
  assert.deepEqual(adapted.criterion_identities.identities, ids);
  assert.deepEqual(adapted.scope_facts, { status: "absent", source: "WK-2025", facts: null });
  assert.deepEqual(adapted.evaluation.states.map(({ state }) => state), [
    "covered", "uncovered", "duplicate", "unknown", "outside_pack",
    "retained_residue", "infeasible", "uncovered"
  ]);
  assert.equal(adapted.evaluation.unknown_mappings.length, 1);
  assert.equal(adapted.projection.claim, "present");
  assert.equal(adapted.next_calls.length, 0);
});

test("canonical WK-2031 and WK-2024 omissions retain exact gap attribution", () => {
  const criteria = ["WK-2031 omission: proof coverage", "WK-2024 omission: ownership"];
  const base = input({ criteria, mappings: [] });
  const identities = deriveControlledContractAcceptanceCoverage(base)
    .criterion_identities.identities;
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria,
    mappings: [
      { criterionIdentity: identities[0].identity, nodeIds: [] },
      { criterionIdentity: identities[1].identity, nodeIds: ["node-owner"] }
    ],
    contractNodes: [{ id: "node-proof", mandatory: true }, { id: "node-owner", mandatory: true }],
    selectedPackNodeIds: ["node-proof", "node-owner"],
    criterionAxes: identities.map((entry) => ({
      criterionIdentity: entry.identity,
      structuralVerification: "covered",
      implementationOwnership: "uncovered",
      verificationOwnership: "covered",
      scopeFeasibility: "covered"
    }))
  }));
  const gaps = adapted.projection.page.items.filter((item) => item.kind === "criterion");
  assert.deepEqual(gaps.map(({ criterion_identity, axis, state, node_ids }) =>
    ({ criterion_identity, axis, state, node_ids })), [
    { criterion_identity: identities[0].identity, axis: "authored_contract_coverage",
      state: "uncovered", node_ids: [] },
    { criterion_identity: identities[0].identity, axis: "implementation_ownership",
      state: "uncovered", node_ids: [] },
    { criterion_identity: identities[1].identity, axis: "implementation_ownership",
      state: "uncovered", node_ids: ["node-owner"] }
  ]);
  assert.deepEqual(adapted.projection.unmapped_mandatory_node_ids, ["node-proof"]);
  assert.deepEqual(adapted.scope_facts, { status: "absent", source: "WK-2025", facts: null });
});

test("direct adapter exposes every contract-enumerated axis and result distinction", () => {
  const criteria = AXES.map((axis) => `criterion ${axis}`);
  const identities = deriveCriterionIdentitySet({
    criteria, selectedUnitDigest: "sha256:unit", bindings: BINDINGS
  }).identities;
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria,
    mappings: identities.map((entry, index) => ({
      criterionIdentity: entry.identity,
      nodeIds: index === 0 ? ["node-covered"] : []
    })),
    contractNodes: [{ id: "node-covered", mandatory: true }],
    selectedPackNodeIds: ["node-covered"],
    criterionAxes: identities.map((entry, index) => ({
      criterionIdentity: entry.identity,
      structuralVerification: AXES[index],
      implementationOwnership: AXES[index],
      verificationOwnership: AXES[index],
      scopeFeasibility: AXES[index]
    }))
  }));
  assert.deepEqual(adapted.projection.axes.map(({ axis, state }) => ({ axis, state })), [
    { axis: "authored_contract_coverage", state: "uncovered" },
    { axis: "structural_verification", state: "stale" },
    { axis: "selected_pack_guarantee_coverage", state: "uncovered" },
    { axis: "implementation_ownership", state: "stale" },
    { axis: "verification_ownership", state: "stale" },
    { axis: "scope_feasibility", state: "stale" }
  ]);
  assert.deepEqual(adapted.projection.axes[1].totals_by_state, {
    covered: 1, uncovered: 1, duplicate: 1, unknown: 1, stale: 1,
    outside_pack: 1, retained_residue: 1, infeasible: 1
  });
  assert.deepEqual(adapted.proof_coverage, []);
  assert.equal(adapted.result_facts, null);
});

test("direct adapter preserves exact package error codes and details", () => {
  assert.throws(() => deriveControlledContractAcceptanceCoverage(input({
    proofCoverage: [{ criterionIdentity: "x", state: "covered", unsupported: true }]
  })), (error) => error.code === "acceptance_coverage_field_forbidden" &&
    error.details.name === "proofCoverage[0]" &&
    error.details.fields.includes("unsupported"));
  assert.throws(() => deriveControlledContractAcceptanceCoverage(input({
    resultFacts: { resultPopulation: [], unsupported: true }
  })), (error) => error.code === "acceptance_coverage_field_forbidden" &&
    error.details.name === "resultFacts" && error.details.fields.includes("unsupported"));
  assert.throws(() => deriveControlledContractAcceptanceCoverage(input({
    mappings: [{ criterionIdentity: "x", nodeIds: "node-covered" }]
  })), (error) => error.code === "acceptance_coverage_input_invalid" &&
    error.details.name === "mappings[0].nodeIds");
});

test("direct adapter replays prior identity changes as stale and retains optional WK-2025 facts", () => {
  const criteria = [criterion(0)];
  const base = deriveControlledContractAcceptanceCoverage(input({ criteria }));
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria,
    priorCriterionIdentities: {
      ...base.criterion_identities,
      identities: [{ ...base.criterion_identities.identities[0], text: "old text" }]
    },
    scopeFacts: { status: "available", source: "WK-2025", facts: { owner: "team-wiki" } },
    proofCoverage: [{ criterionIdentity: "x", nodeId: "n", state: "covered", attribution: { source: "pack" } }],
    resultFacts: { resultPopulation: ["r"], operation: { result: "ok" } }
  }));
  assert.equal(adapted.evaluation.states[0].state, "stale");
  assert.deepEqual(adapted.scope_facts.facts, { owner: "team-wiki" });
  assert.deepEqual(adapted.proof_coverage[0].attribution, { source: "pack" });
  assert.deepEqual(adapted.result_facts, { resultPopulation: ["r"], operation: { result: "ok" } });
});

test("direct adapter preserves absent and stale optional facts plus binding attribution", () => {
  const criteria = [criterion(0)];
  const current = input({ criteria });
  const prior = deriveControlledContractAcceptanceCoverage(current);
  const adapted = deriveControlledContractAcceptanceCoverage({
    ...current,
    bindings: { ...BINDINGS, mappingDigest: "sha256:changed" },
    priorCriterionIdentities: prior.criterion_identities,
    scopeFacts: { status: "stale", source: "WK-2025", facts: { reason: "changed" } }
  });
  assert.equal(adapted.evaluation.states[0].state, "stale");
  assert.deepEqual(adapted.evaluation.identity_comparison.bindingChanges, ["mappingDigest"]);
  assert.deepEqual(adapted.scope_facts, { status: "stale", source: "WK-2025", facts: { reason: "changed" } });
  assert.deepEqual(deriveControlledContractAcceptanceCoverage(input()).scope_facts, {
    status: "absent", source: "WK-2025", facts: null
  });
});
test("direct query returns bounded gap detail and rejects oversized adapted state", () => {
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria: [criterion(0)], contractNodes: [], selectedPackNodeIds: []
  }));
  const result = queryControlledContractAcceptanceCoverage({
    state: adapted, query: { unit: "WK-2053#SLICE-006" }
  });
  assert.equal(result.page.returned, 1);
  assert.equal(result.next_calls.length, 0);
  const oversized = deriveControlledContractAcceptanceCoverage(input());
  assert.throws(() => queryControlledContractAcceptanceCoverage({
    state: oversized, query: { unit: oversized.unit.id }
  }), (error) => error.code === "acceptance_coverage_query_oversize");
});

test("selectors return exact criterion or node attribution and preserve selected-unit identity", () => {
  const criteria = [criterion(0)];
  const ids = deriveCriterionIdentitySet({
    criteria, selectedUnitDigest: "sha256:unit", bindings: BINDINGS
  }).identities;
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria,
    mappings: [{ criterionIdentity: ids[0].identity, nodeIds: ["node-covered"] }]
  }));
  const criterionResult = queryControlledContractAcceptanceCoverage({
    state: adapted, query: { unit: "WK-2053#SLICE-006", criterionIdentity: ids[0].identity }
  });
  assert.deepEqual(criterionResult.page.items.map(({ criterion_identity }) => criterion_identity), [ids[0].identity]);
  assert.deepEqual(criterionResult.page.items[0].node_ids, ["node-covered"]);

  const nodeResult = queryControlledContractAcceptanceCoverage({
    state: adapted, query: { unit: "WK-2053#SLICE-006", nodeId: "node-covered" }
  });
  assert.ok(nodeResult.page.items.some(({ criterion_identity }) => criterion_identity === ids[0].identity));
  assert.throws(() => queryControlledContractAcceptanceCoverage({
    state: adapted, query: { unit: "other-unit" }
  }), (error) => error.code === "acceptance_coverage_unit_mismatch");
});

test("direct query rejects a continuation bound to different selected-unit facts", () => {
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria: [], mappings: [], criterionAxes: [],
    contractNodes: [], selectedPackNodeIds: []
  }));
  const cursor = Buffer.from(JSON.stringify({
    version: "wiki-core-acceptance-coverage-cursor.v1",
    unit_digest: "different",
    projection_cursor: "opaque"
  }), "utf8").toString("base64url");
  assert.throws(() => queryControlledContractAcceptanceCoverage({
    state: adapted, query: { unit: adapted.unit.id, cursor }
  }), (error) => error.code === "acceptance_coverage_cursor_stale");
});

test("direct adapter rejects unsupported functions, extra arguments, selectors, and malformed input", () => {
  assert.throws(() => deriveControlledContractAcceptanceCoverage({ ...input(), function: "derive" }),
    (error) => error.code === "acceptance_coverage_field_forbidden");
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria: [criterion(0)], contractNodes: [], selectedPackNodeIds: []
  }));
  for (const query of [
    { unit: adapted.unit.id, function: "query" },
    { unit: adapted.unit.id, args: {} },
    { unit: adapted.unit.id, criterionIdentity: "a", nodeId: "b" },
    { unit: adapted.unit.id, cursor: "not-base64-json" }
  ]) {
    assert.throws(() => queryControlledContractAcceptanceCoverage({ state: adapted, query }),
      /ControlledContractAcceptanceCoverageError/);
  }
  assert.throws(() => queryControlledContractAcceptanceCoverage({ state: adapted, query: null }),
    (error) => error.code === "acceptance_coverage_request_invalid");
});
test("direct adapter preserves exact malformed fact and selector error details", () => {
  const adapted = deriveControlledContractAcceptanceCoverage(input({
    criteria: [criterion(0)], contractNodes: [], selectedPackNodeIds: []
  }));
  assert.throws(() => deriveControlledContractAcceptanceCoverage(input({
    proofCoverage: [{ criterionIdentity: "x", state: 1 }]
  })), (error) => error.code === "acceptance_coverage_proof_facts_invalid" &&
    error.message === "proofCoverage[0].state must be a non-empty string");
  assert.throws(() => deriveControlledContractAcceptanceCoverage(input({
    scopeFacts: { status: "available", facts: null }
  })), (error) => error.code === "acceptance_coverage_scope_facts_invalid");
  assert.throws(() => queryControlledContractAcceptanceCoverage({ state: adapted,
    query: { unit: adapted.unit.id, criterionIdentity: "a", nodeId: "b" } }),
  (error) => error.code === "acceptance_coverage_selector_invalid");
});

const OPERATION_BINDINGS = Object.freeze({
  workRecordLocatorDigest: controlledContractContentDigest("work-record-locator"),
  contractDigest: controlledContractContentDigest("contract"),
  contractNodeDigest: controlledContractContentDigest("contract-nodes"),
  proofPlanDigest: controlledContractContentDigest("proof-plan"),
  selectedPackDigest: controlledContractContentDigest("selected-pack"),
  mappingDigest: controlledContractContentDigest("obligation-source"),
  assessmentDigest: controlledContractContentDigest("assessment"),
  proofAssessmentDigest: controlledContractContentDigest("proof-assessment"),
  profileVersionDigest: controlledContractContentDigest("profile-version"),
  selectorArtifactDigest: controlledContractContentDigest("selector-artifact"),
  ownershipDigest: controlledContractContentDigest("ownership"),
  verificationDigest: controlledContractContentDigest("verification"),
  optionalScopeDigest: controlledContractContentDigest("optional-scope"),
  sourceDigest: controlledContractContentDigest("obligation-source"),
  sourceKind: "obligation-coverage"
});

function operationSelectedPacks(referenceIds) {
  const evaluationInput = {
    reference_bindings: [{
      role: "fixture-contract-nodes",
      reference_ids: structuredClone(referenceIds)
    }]
  };
  return [{
    pack_id: "proof.fixture",
    profile_id: "proof.fixture",
    profile_version: "1.0.0",
    requested_intents: ["verification"],
    evaluation_input_path: "WK-2053.proof.fixture.evaluation-input.json",
    evaluation_input_digest: controlledContractContentDigest(evaluationInput),
    source_digests: {},
    selectors: [{
      kind: "reference_binding",
      component_id: "fixture-contract-nodes",
      evaluation_stage: "pre_execution"
    }]
  }];
}

function operationRow(criterionIdentity, {
  nodeIds = ["node-covered"], structural = "covered",
  implementation = "covered", verification = "covered", scope = "covered"
} = {}) {
  return {
    criterion_identity: criterionIdentity,
    node_ids: nodeIds,
    axes: {
      authored_contract_coverage: "covered",
      structural_verification: structural,
      selected_pack_guarantee_coverage: "covered",
      implementation_ownership: implementation,
      verification_ownership: verification,
      scope_feasibility: scope
    }
  };
}

function operationRefusalCode(error) {
  return error?.envelope?.warning?.payload?.reason_code ?? error?.code;
}

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function operationHarness({
  criteria = ["criterion 0"],
  contractNodes = [
    { id: "node-covered", mandatory: true },
    { id: "node-mandatory-gap", mandatory: true }
  ],
  selectedPackNodeIds = ["node-covered"],
  selectedPacks = operationSelectedPacks(["node-covered"])
} = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "wk-2053-coverage-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  let bindings = structuredClone(OPERATION_BINDINGS);
  let activeCriteria = structuredClone(criteria);
  let activeContractNodes = structuredClone(contractNodes);
  let activeSelectedPackNodeIds = structuredClone(selectedPackNodeIds);
  const refreshMappingDigest = () => {
    const { mappingDigest: _mappingDigest, ...joined } = bindings;
    bindings.mappingDigest = controlledContractContentDigest(joined);
  };
  refreshMappingDigest();
  const carrierFile = path.join(
    repoRoot, "wiki", "contracts", "WK-2053.controlled-acceptance-coverage.json"
  );
  const readCarrier = async () => {
    try {
      const content = JSON.parse(await readFile(carrierFile, "utf8"));
      return { content, content_digest: controlledContractContentDigest(content), file: carrierFile };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  const resolveFacts = async (_input, { requireCarrier = false } = {}) => {
    const carrier = await readCarrier();
    if (requireCarrier && carrier === null) {
      const error = new Error("carrier absent");
      error.code = "acceptance_coverage_carrier_not_found";
      error.details = { changed: false };
      throw error;
    }
    const currentBindings = structuredClone(bindings);
    const unitDigest = controlledContractContentDigest({
      unit: "WK-2053", bindings: currentBindings,
      carrier: carrier?.content_digest ?? null
    });
    return {
      wkId: "WK-2053",
      focus: null,
      selectedUnit: null,
      unit: { id: "WK-2053" },
      unit_digest: unitDigest,
      criteria: structuredClone(activeCriteria),
      contractNodes: structuredClone(activeContractNodes),
      selectedPackNodeIds: structuredClone(activeSelectedPackNodeIds),
      selectedPacks: structuredClone(selectedPacks),
      carrier,
      contract: { content_digest: currentBindings.contractDigest },
      plan: { content_digest: currentBindings.proofPlanDigest },
      source: {
        source_kind: "obligation-coverage",
        content_digest: currentBindings.sourceDigest
      },
      bindings: currentBindings,
      rows: structuredClone(carrier?.content.rows ?? []),
      scope_facts: {
        status: "available", source: "WK-2025", facts: { owner: "scope-owner" }
      },
      proof_coverage: [],
      result_facts: null
    };
  };
  const criterionIdentities = async () => {
    const described = await describeControlledContractAcceptanceCoverageOperation({
      repoRoot, wkId: "WK-2053"
    }, { resolveFacts });
    return described.criterion_identities.identities;
  };
  return {
    repoRoot,
    carrierFile,
    resolveFacts,
    withSourceLease: async (_input, callback) => callback(),
    readCarrier,
    criterionIdentities,
    setBinding(name, value) {
      bindings = { ...bindings, [name]: value };
      if (name !== "mappingDigest") refreshMappingDigest();
    },
    setCriteria(value) { activeCriteria = structuredClone(value); },
    setContractNodes(value) { activeContractNodes = structuredClone(value); },
    setSelectedPackNodeIds(value) {
      activeSelectedPackNodeIds = structuredClone(value);
    },
    bindings() { return structuredClone(bindings); },
    async cleanup() { await rm(repoRoot, { recursive: true, force: true }); }
  };
}

function operationBaseInput(harness, carrierDigest) {
  return {
    repoRoot: harness.repoRoot,
    wkId: "WK-2053",
    carrierIdentity: {
      carrier_kind: "controlled-acceptance",
      wk_id: "WK-2053",
      focus: null,
      selected_unit: null,
      content_digest: carrierDigest
    },
    sourceIdentity: {
      source_kind: "obligation-coverage",
      content_digest: harness.bindings().sourceDigest
    }
  };
}

async function exactPatchInput(harness, operations) {
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  return {
    ...operationBaseInput(harness, described.carrier_identity.content_digest),
    expectedUnitDigest: described.unit.digest,
    expectedAuthoringIdentity: described.authoring_identity,
    expectedContentDigest: described.carrier_identity.content_digest,
    operations
  };
}

function acceptanceAtomicBaseline(request, {
  contentDigest, finalRowCount, status, commitState, failureCode,
  previousContentDigest = request.expectedContentDigest
}) {
  const operationCount = request.operations.length;
  const result = {
    schema_version: "controlled-contract-acceptance-coverage-patch.v1",
    carrier_kind: "controlled-acceptance",
    previous_content_digest: previousContentDigest,
    content_digest: contentDigest,
    operation_count: operationCount,
    upsert_count: request.operations.filter(({ op }) => op === "upsert").length,
    remove_count: request.operations.filter(({ op }) => op === "remove").length,
    final_row_count: finalRowCount,
    carrier_identity: { ...request.carrierIdentity, content_digest: contentDigest },
    source_identity: structuredClone(request.sourceIdentity),
    authority: { authoritative: false, authors_mappings_only: true, grants: [] }
  };
  if (status === "post_commit_failure") return {
    ...result, status, commit_state: commitState, failure_code: failureCode,
    next_calls: [{
      tool: "workspace_controlled_contract_acceptance_coverage_describe",
      arguments: { unit: "WK-2053" }
    }]
  };
  return {
    ...result, status, changed: status === "updated",
    next_calls: [{
      tool: "workspace_controlled_contract_acceptance_coverage_query",
      arguments: { unit: "WK-2053" }
    }]
  };
}

async function exactCreateInput(harness, rows) {
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  return {
    repoRoot: harness.repoRoot,
    wkId: "WK-2053",
    carrierIdentity: described.carrier_identity,
    sourceIdentity: described.source_identity,
    expectedUnitDigest: described.unit.digest,
    expectedContentDigest: null,
    rows
  };
}

test("coverage describe separates fixed arguments from caller-authored fields", async (t) => {
  const harness = await operationHarness();
  t.after(() => harness.cleanup());
  const [identity] = await harness.criterionIdentities();
  const absent = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.equal(absent.next_calls[0].tool,
    "workspace_controlled_contract_acceptance_coverage_create");
  assert.deepEqual(absent.next_calls[0].required_authored_fields, ["rows"]);
  assert.equal(absent.next_calls[0].fixed_arguments.expected_content_digest, null);
  assert.equal("rows" in absent.next_calls[0].fixed_arguments, false);

  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, [operationRow(identity.identity)]),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  const current = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.deepEqual(current.next_calls.map(({ tool }) => tool), [
    "workspace_controlled_contract_acceptance_coverage_query",
    "workspace_controlled_contract_acceptance_coverage_upsert",
    "workspace_controlled_contract_acceptance_coverage_remove"
  ]);
  assert.deepEqual(current.next_calls[1].required_authored_fields,
    ["criterion_selector", "row"]);
  assert.deepEqual(current.next_calls[2].required_authored_fields,
    ["criterion_selector"]);
  assert.equal(current.next_calls[1].fixed_arguments.expected_content_digest,
    current.carrier_identity.content_digest);
  assert.equal("criterion_selector" in current.next_calls[1].fixed_arguments, false);

  await assert.rejects(queryControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot,
    wkId: "WK-2053",
    selector: { kind: "criterion_identity", criterion_identity: "not-current" }
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }), (error) => {
    const details = error.envelope.warning.payload.details;
    assert.equal(error.code, "acceptance_coverage_criterion_selector_invalid");
    assert.deepEqual(details.next_calls.map(({ tool }) => tool), [
      "workspace_controlled_contract_acceptance_coverage_describe",
      "workspace_controlled_contract_acceptance_coverage_query"
    ]);
    assert.equal(details.next_calls[1].arguments.unit, "WK-2053");
    return true;
  });
});

test("production handlers persist create, upsert, remove, and query without false success", async (t) => {
  const harness = await operationHarness();
  t.after(() => harness.cleanup());
  const [identity] = await harness.criterionIdentities();
  const createInput = await exactCreateInput(harness, [operationRow(identity.identity)]);
  const created = await createControlledContractAcceptanceCoverageOperation(createInput, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(created.changed, true);
  assert.equal((await harness.readCarrier()).content.rows.length, 1);

  const queried = await queryControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053",
    selector: { kind: "criterion_identity", criterion_identity: identity.identity }
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.equal(queried.claim, "present");
  assert.ok(queried.unmapped_mandatory_node_ids.includes("node-mandatory-gap"));
  const criterionItem = queried.page.items.find((item) => item.kind === "criterion");
  assert.equal(criterionItem.axes.authored_contract_coverage, "covered");
  assert.equal(criterionItem.axes.selected_pack_guarantee_coverage, "covered");

  const current = await harness.readCarrier();
  const changedRow = operationRow(identity.identity, { implementation: "uncovered" });
  const upserted = await upsertControlledContractAcceptanceCoverageOperation({
    ...operationBaseInput(harness, current.content_digest),
    expectedContentDigest: current.content_digest,
    criterionSelector: { kind: "criterion_identity", criterion_identity: identity.identity },
    row: changedRow
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.equal(upserted.changed, true);
  assert.equal((await harness.readCarrier()).content.rows[0]
    .axes.implementation_ownership, "uncovered");

  const afterUpsert = await harness.readCarrier();
  const removed = await removeControlledContractAcceptanceCoverageOperation({
    ...operationBaseInput(harness, afterUpsert.content_digest),
    expectedContentDigest: afterUpsert.content_digest,
    criterionSelector: { kind: "criterion_identity", criterion_identity: identity.identity }
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.equal(removed.changed, true);
  assert.deepEqual((await harness.readCarrier()).content.rows, []);

  const noCarrier = await operationHarness();
  t.after(() => noCarrier.cleanup());
  const [noCarrierIdentity] = await noCarrier.criterionIdentities();
  const falseInput = await exactCreateInput(
    noCarrier, [operationRow(noCarrierIdentity.identity)]
  );
  await assert.rejects(
    createControlledContractAcceptanceCoverageOperation(falseInput, {
      resolveFacts: noCarrier.resolveFacts,
      persistCarrier: async ({ content }) => ({
        changed: true, content_digest: controlledContractContentDigest(content)
      })
    }),
    (error) => operationRefusalCode(error) ===
      "acceptance_coverage_persistence_receipt_mismatch" &&
      error.details.changed === false
  );
  assert.equal(await noCarrier.readCarrier(), null);
});

test("acceptance patch composes typed operations without a count-only ceiling", async (t) => {
  const criteria = Array.from({ length: 70 }, (_, index) => `criterion ${index}`);
  const harness = await operationHarness({
    criteria, contractNodes: [{ id: "node-covered", mandatory: true }]
  });
  t.after(() => harness.cleanup());
  const identities = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, identities.map(({ identity }) => operationRow(identity))),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  const operations = identities.slice(0, 65).map(({ identity }, index) => ({
    op: "upsert",
    criterionSelector: { kind: "criterion_identity", criterion_identity: identity },
    row: operationRow(identity, {
      implementation: index % 2 === 0 ? "uncovered" : "covered"
    })
  }));
  const request = await exactPatchInput(harness, operations);
  const updated = await patchControlledContractAcceptanceCoverageOperation(request, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.operation_count, 65);
  assert.equal(updated.upsert_count, 65);
  assert.equal(updated.remove_count, 0);
  assert.equal(updated.final_row_count, 70);
  assert.equal(Object.hasOwn(updated, "rows"), false);
  const updatedCarrier = await harness.readCarrier();
  assert.deepEqual(updated, acceptanceAtomicBaseline(request, {
    contentDigest: updatedCarrier.content_digest, finalRowCount: 70, status: "updated"
  }));
  assert.equal(updatedCarrier.content.rows[0]
    .axes.implementation_ownership, "uncovered");

  const replay = await patchControlledContractAcceptanceCoverageOperation(request, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(replay.status, "already_satisfied");
  assert.equal(replay.changed, false);
  assert.deepEqual(replay, acceptanceAtomicBaseline(request, {
    contentDigest: updatedCarrier.content_digest,
    finalRowCount: 70,
    status: "already_satisfied",
    previousContentDigest: updatedCarrier.content_digest
  }));

  const noChangeRequest = await exactPatchInput(harness, operations);
  const noChange = await patchControlledContractAcceptanceCoverageOperation(
    noChangeRequest,
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  assert.deepEqual(noChange, acceptanceAtomicBaseline(noChangeRequest, {
    contentDigest: updatedCarrier.content_digest, finalRowCount: 70, status: "no_change"
  }));

  const current = await exactPatchInput(harness, [{
    op: "remove",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identities[69].identity
    }
  }, {
    op: "upsert",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identities[66].identity
    },
    row: operationRow(identities[66].identity, { verification: "uncovered" })
  }]);
  const mixed = await patchControlledContractAcceptanceCoverageOperation(current, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(mixed.status, "updated");
  assert.deepEqual([mixed.upsert_count, mixed.remove_count, mixed.final_row_count],
    [1, 1, 69]);

  await assert.rejects(patchControlledContractAcceptanceCoverageOperation({
    ...await exactPatchInput(harness, []), operations: []
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }),
  (error) => operationRefusalCode(error) ===
    "controlled_contract_patch_request_too_large");
});

test("acceptance patch validates selector equality, currentness, and stale conflicts", async (t) => {
  const harness = await operationHarness({ criteria: ["criterion 0", "criterion 1"] });
  t.after(() => harness.cleanup());
  const identities = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, identities.map(({ identity }) => operationRow(identity))),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  const mismatch = await exactPatchInput(harness, [{
    op: "upsert",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identities[0].identity
    },
    row: operationRow(identities[1].identity)
  }]);
  await assert.rejects(patchControlledContractAcceptanceCoverageOperation(mismatch, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  }), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_criterion_selector_invalid");

  const stale = await exactPatchInput(harness, [{
    op: "upsert",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identities[0].identity
    },
    row: operationRow(identities[0].identity, { scope: "uncovered" })
  }]);
  const first = await patchControlledContractAcceptanceCoverageOperation(stale, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(first.status, "updated");
  stale.operations[0].row = operationRow(identities[0].identity, {
    scope: "infeasible"
  });
  await assert.rejects(patchControlledContractAcceptanceCoverageOperation(stale, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  }), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_content_digest_mismatch" && error.details.changed === false);

  const current = await exactPatchInput(harness, [{
    op: "remove",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identities[1].identity
    }
  }]);
  harness.setBinding("ownershipDigest", "sha256:ownership-stale");
  await assert.rejects(patchControlledContractAcceptanceCoverageOperation(current, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  }), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_unit_currentness_stale");
});

test("acceptance patch preserves bytes at every injected pre-commit boundary", async (t) => {
  for (const phase of ["temporary_write", "file_sync", "rename"]) {
    await t.test(phase, async (subtest) => {
      const harness = await operationHarness({ criteria: ["criterion 0", "criterion 1"] });
      subtest.after(() => harness.cleanup());
      const identities = await harness.criterionIdentities();
      await createControlledContractAcceptanceCoverageOperation(
        await exactCreateInput(harness,
          identities.map(({ identity }) => operationRow(identity))),
        { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
      );
      const before = await readFile(harness.carrierFile);
      const request = await exactPatchInput(harness, identities.map(({ identity }) => ({
        op: "upsert",
        criterionSelector: { kind: "criterion_identity", criterion_identity: identity },
        row: operationRow(identity, { implementation: "uncovered" })
      })));
      const failure = Object.assign(new Error(`injected ${phase}`), {
        code: `injected_${phase}`
      });
      const effects = phase === "rename"
        ? { renameFile: async () => { throw failure; } }
        : { openFile: async (...args) => {
            const handle = await open(...args);
            return {
              writeFile: phase === "temporary_write"
                ? async () => { throw failure; }
                : handle.writeFile.bind(handle),
              sync: phase === "file_sync"
                ? async () => { throw failure; }
                : handle.sync.bind(handle),
              close: handle.close.bind(handle)
            };
          } };
      await assert.rejects(patchControlledContractAcceptanceCoverageOperation(request, {
        resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease, persistenceEffects: effects
      }), (error) => operationRefusalCode(error) === failure.code);
      assert.deepEqual(await readFile(harness.carrierFile), before);
    });
  }
});

test("acceptance patch classifies post-rename durability and receipt failures", async (t) => {
  for (const [name, effects, commitState, failureCode] of [
    ["directory sync", { syncDirectory: async () => {
      throw Object.assign(new Error("sync failed"), { code: "injected_directory_sync" });
    } }, "committed", "injected_directory_sync"],
    ["receipt", { readReceipt: async () => {
      throw Object.assign(new Error("read failed"), { code: "injected_receipt" });
    } }, "committed", "injected_receipt"],
    ["indeterminate receipt", {
      readReceipt: async () => { throw new Error("read failed"); },
      resolveCommitted: async () => { throw new Error("resolution failed"); }
    }, "indeterminate", "acceptance_coverage_post_commit_failure"]
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await operationHarness();
      subtest.after(() => harness.cleanup());
      const [identity] = await harness.criterionIdentities();
      await createControlledContractAcceptanceCoverageOperation(
        await exactCreateInput(harness, [operationRow(identity.identity)]),
        { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
      );
      const request = await exactPatchInput(harness, [{
        op: "upsert",
        criterionSelector: {
          kind: "criterion_identity", criterion_identity: identity.identity
        },
        row: operationRow(identity.identity, { verification: "uncovered" })
      }]);
      const result = await patchControlledContractAcceptanceCoverageOperation(request, {
        resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease, persistenceEffects: effects
      });
      assert.equal(result.status, "post_commit_failure");
      assert.equal(result.commit_state, commitState);
      assert.equal(Object.hasOwn(result, "changed"), false);
      assert.equal(result.next_calls[0].tool,
        "workspace_controlled_contract_acceptance_coverage_describe");
      const committedCarrier = await harness.readCarrier();
      assert.deepEqual(result, acceptanceAtomicBaseline(request, {
        contentDigest: committedCarrier.content_digest,
        finalRowCount: 1,
        status: "post_commit_failure",
        commitState,
        failureCode
      }));
      assert.equal(committedCarrier.content.rows[0]
        .axes.verification_ownership, "uncovered");
    });
  }
});

test("canonical source lease excludes work-record and carrier mutation through receipt", async (t) => {
  const harness = await operationHarness();
  t.after(() => harness.cleanup());
  const [identity] = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, [operationRow(identity.identity)]),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  const request = await exactPatchInput(harness, [{
    op: "upsert",
    criterionSelector: {
      kind: "criterion_identity", criterion_identity: identity.identity
    },
    row: operationRow(identity.identity, { implementation: "uncovered" })
  }]);
  let leaseHeld = false;
  const events = [];
  const attemptExcludedMutation = (owner) => {
    assert.equal(leaseHeld, true, `${owner} interleaving must meet the held lease`);
    events.push(`blocked:${owner}`);
  };
  const result = await patchControlledContractAcceptanceCoverageOperation(request, {
    resolveFacts: async (...args) => {
      if (leaseHeld) events.push("leased:final-compare");
      return harness.resolveFacts(...args);
    },
    withSourceLease: async (_identity, callback) => {
      assert.equal(leaseHeld, false);
      leaseHeld = true;
      events.push("lease:entered");
      try {
        return await callback();
      } finally {
        events.push("lease:released");
        leaseHeld = false;
      }
    },
    persistenceEffects: {
      renameFile: async (...args) => {
        attemptExcludedMutation("work-record-writer");
        return rename(...args);
      },
      syncDirectory: async () => {
        assert.equal(leaseHeld, true);
        events.push("leased:directory-sync");
      },
      readReceipt: async () => {
        attemptExcludedMutation("carrier-generation-writer");
        return harness.readCarrier();
      }
    }
  });
  assert.equal(result.status, "updated");
  assert.equal(leaseHeld, false);
  assert.ok(events.filter((event) => event === "leased:final-compare").length >= 2);
  assert.deepEqual(events.slice(-3), [
    "leased:directory-sync", "blocked:carrier-generation-writer", "lease:released"
  ]);
  assert.ok(events.includes("blocked:work-record-writer"));
});

test("obligation patch materializes typed rows and validates the complete population", async () => {
  const sourceIdentity = {
    source_kind: "obligation-coverage",
    wk_id: "WK-2438",
    controlled_focus: null,
    selected_unit: null,
    locator_digest: `sha256:${"b".repeat(64)}`,
    content_digest: `sha256:${"a".repeat(64)}`
  };
  const resolved = {
    repoRoot: "/tmp/not-used-by-injected-persistence",
    wkId: "WK-2438",
    focus: null,
    selectedUnit: null,
    source: { content_digest: sourceIdentity.content_digest },
    sourceCurrent: true,
    staleReasons: [],
    authoringIdentity: `sha256:${"c".repeat(64)}`,
    prospectiveIdentity: Object.fromEntries(Object.entries(sourceIdentity)
      .filter(([key]) => key !== "content_digest")),
    rows: [],
    criteria: [{
      identity: "criterion-current",
      criterion: "The patch remains atomic.",
      source_locator: "/acceptance/criteria/0"
    }],
    criterionIdentities: { digest: `sha256:${"d".repeat(64)}` },
    contractNodes: [{ id: "node-family" }],
    selectedPacks: []
  };
  const input = {
    repoRoot: resolved.repoRoot,
    wkId: resolved.wkId,
    sourceIdentity,
    expectedAuthoringIdentity: resolved.authoringIdentity,
    expectedContentDigest: sourceIdentity.content_digest,
    operations: [{
      op: "upsert",
      obligationSelector: { kind: "obligation_id", obligation_id: "OBL-WK2438-FAMILY" },
      row: {
        obligation_id: "OBL-WK2438-FAMILY",
        statement: "The family adapter validates the complete prospective population.",
        criterion_selector: {
          kind: "criterion_identity", criterion_identity: "criterion-current"
        },
        controlled_contract_node_ids: ["node-family"],
        mechanism: {
          owner: "wiki-core", kind: "test", selector: "family-patch"
        },
        proof: {
          kind: "explicit_gap", gap_kind: "no_proof_required",
          reason: "Executable family validation is the proof."
        }
      }
    }]
  };
  const result = await patchControlledContractObligationCoverageOperation(input, {
    resolveFacts: async () => resolved,
    persistCarrier: async ({ content, bytes, write }) => ({
      content_digest: controlledContractContentDigest(content),
      byte_length: bytes.byteLength,
      changed: write
    })
  });
  assert.equal(result.status, "updated");
  assert.deepEqual([result.operation_count, result.upsert_count,
    result.remove_count, result.final_row_count], [1, 1, 0, 1]);
  assert.equal(Object.hasOwn(result, "obligations"), false);

  await assert.rejects(patchControlledContractObligationCoverageOperation({
    ...input,
    operations: [{
      op: "remove",
      obligationSelector: { kind: "obligation_id", obligation_id: "OBL-WK2438-FAMILY" }
    }]
  }, {
    resolveFacts: async () => ({
      ...resolved,
      rows: [{
        obligation_id: "OBL-WK2438-FAMILY",
        source_locator: "/acceptance/criteria/0",
        source_locator_digest: `sha256:${"e".repeat(64)}`,
        statement: "The family adapter validates the complete prospective population.",
        controlled_contract_node_ids: ["node-family"],
        mechanism: { owner: "wiki-core", kind: "test", selector: "family-patch" },
        proof: { kind: "explicit_gap", gap_kind: "no_proof_required",
          reason: "Executable family validation is the proof." }
      }]
    }),
    persistCarrier: async () => assert.fail("incomplete population reached persistence")
  }), (error) => operationRefusalCode(error) ===
    "obligation_coverage_population_incomplete" && error.details.changed === false);
});

function obligationAtomicFixture() {
  const sourceIdentity = {
    source_kind: "obligation-coverage",
    wk_id: "WK-2438",
    controlled_focus: null,
    selected_unit: null,
    locator_digest: `sha256:${"b".repeat(64)}`,
    content_digest: `sha256:${"a".repeat(64)}`
  };
  const resolved = {
    repoRoot: "/tmp/not-used-by-injected-persistence",
    wkId: "WK-2438",
    focus: null,
    selectedUnit: null,
    source: { content_digest: sourceIdentity.content_digest },
    sourceCurrent: true,
    staleReasons: [],
    authoringIdentity: `sha256:${"c".repeat(64)}`,
    prospectiveIdentity: Object.fromEntries(Object.entries(sourceIdentity)
      .filter(([key]) => key !== "content_digest")),
    rows: [],
    criteria: [{
      identity: "criterion-current",
      criterion: "The patch remains atomic.",
      source_locator: "/acceptance/criteria/0"
    }],
    criterionIdentities: { digest: `sha256:${"d".repeat(64)}` },
    contractNodes: [{ id: "node-family" }],
    selectedPacks: []
  };
  const row = {
    obligation_id: "OBL-WK2438-FAMILY",
    statement: "The family adapter validates the complete prospective population.",
    criterion_selector: {
      kind: "criterion_identity", criterion_identity: "criterion-current"
    },
    controlled_contract_node_ids: ["node-family"],
    mechanism: { owner: "wiki-core", kind: "test", selector: "family-patch" },
    proof: {
      kind: "explicit_gap", gap_kind: "no_proof_required",
      reason: "Executable family validation is the proof."
    }
  };
  const request = {
    repoRoot: resolved.repoRoot,
    wkId: resolved.wkId,
    sourceIdentity,
    expectedAuthoringIdentity: resolved.authoringIdentity,
    expectedContentDigest: sourceIdentity.content_digest,
    operations: [{
      op: "upsert",
      obligationSelector: { kind: "obligation_id", obligation_id: row.obligation_id },
      row
    }]
  };
  let persisted = null;
  const persistCarrier = async ({ content, bytes, write }) => {
    const contentDigest = controlledContractContentDigest(content);
    persisted = { content: structuredClone(content), contentDigest,
      byteLength: bytes.byteLength };
    if (write) {
      resolved.rows = structuredClone(content.obligations);
      resolved.source = { content_digest: contentDigest };
    }
    return { content_digest: contentDigest, byte_length: bytes.byteLength, changed: write };
  };
  return {
    resolved, request, persistCarrier,
    resolveFacts: async () => resolved,
    persisted: () => persisted
  };
}

function obligationAtomicBaseline(request, persisted, {
  status, commitState, failureCode,
  previousContentDigest = request.expectedContentDigest
}) {
  const result = {
    schema_version: "controlled-contract-obligation-coverage-patch.v1",
    source_kind: "obligation-coverage",
    previous_content_digest: previousContentDigest,
    content_digest: persisted.contentDigest,
    operation_count: request.operations.length,
    upsert_count: request.operations.filter(({ op }) => op === "upsert").length,
    remove_count: request.operations.filter(({ op }) => op === "remove").length,
    final_row_count: persisted.content.obligations.length,
    byte_length: persisted.byteLength,
    source_identity: { ...request.sourceIdentity,
      content_digest: persisted.contentDigest },
    authority: {
      authoritative: false, authors_obligations_only: true, grants: [],
      denies: ["proof", "requirement", "admission", "dispatch", "review",
        "integration", "publication", "completion"]
    }
  };
  if (status === "post_commit_failure") return {
    ...result, status, commit_state: commitState, failure_code: failureCode,
    next_calls: [{
      tool: "workspace_controlled_contract_obligation_coverage_describe",
      arguments: { unit: "WK-2438" }
    }]
  };
  return {
    ...result, status, changed: status === "updated",
    next_calls: [{
      tool: "workspace_controlled_contract_obligation_coverage_query",
      arguments: { unit: "WK-2438" }
    }]
  };
}

test("obligation atomic results retain five exact complete-object baselines", async (t) => {
  const fixture = obligationAtomicFixture();
  const updated = await patchControlledContractObligationCoverageOperation(
    fixture.request,
    { resolveFacts: fixture.resolveFacts, persistCarrier: fixture.persistCarrier }
  );
  assert.deepEqual(updated, obligationAtomicBaseline(
    fixture.request, fixture.persisted(), { status: "updated" }
  ));

  const replay = await patchControlledContractObligationCoverageOperation(
    fixture.request,
    { resolveFacts: fixture.resolveFacts, persistCarrier: fixture.persistCarrier }
  );
  assert.deepEqual(replay, obligationAtomicBaseline(
    fixture.request, fixture.persisted(), {
      status: "already_satisfied", previousContentDigest: updated.content_digest
    }
  ));

  const currentRequest = {
    ...fixture.request,
    sourceIdentity: { ...fixture.request.sourceIdentity,
      content_digest: updated.content_digest },
    expectedContentDigest: updated.content_digest
  };
  const noChange = await patchControlledContractObligationCoverageOperation(
    currentRequest,
    { resolveFacts: fixture.resolveFacts, persistCarrier: fixture.persistCarrier }
  );
  assert.deepEqual(noChange, obligationAtomicBaseline(
    currentRequest, fixture.persisted(), { status: "no_change" }
  ));

  for (const [commitState, failureCode] of [
    ["committed", "injected_obligation_receipt"],
    ["indeterminate", "obligation_coverage_post_commit_failure"]
  ]) {
    await t.test(`${commitState} post-commit recovery`, async () => {
      const recovery = obligationAtomicFixture();
      let persisted;
      const result = await patchControlledContractObligationCoverageOperation(
        recovery.request,
        {
          resolveFacts: recovery.resolveFacts,
          persistCarrier: async ({ content, bytes }) => {
            persisted = {
              content: structuredClone(content),
              contentDigest: controlledContractContentDigest(content),
              byteLength: bytes.byteLength
            };
            return {
              status: "post_commit_failure", commit_state: commitState,
              content_digest: persisted.contentDigest,
              byte_length: persisted.byteLength,
              failure_code: failureCode
            };
          }
        }
      );
      assert.deepEqual(result, obligationAtomicBaseline(
        recovery.request, persisted,
        { status: "post_commit_failure", commitState, failureCode }
      ));
    });
  }
});

test("mutation final CAS binds every consumed identity and leaves state unchanged on races", async (t) => {
  const harness = await operationHarness();
  t.after(() => harness.cleanup());
  const [identity] = await harness.criterionIdentities();
  const createInput = await exactCreateInput(harness, [operationRow(identity.identity)]);
  let resolutions = 0;
  const racingResolver = async (...args) => {
    resolutions += 1;
    if (resolutions === 3) {
      harness.setBinding("contractNodeDigest", "sha256:contract-nodes-raced");
    }
    return harness.resolveFacts(...args);
  };
  await assert.rejects(
    createControlledContractAcceptanceCoverageOperation(createInput, {
      resolveFacts: racingResolver,
      withSourceLease: harness.withSourceLease
    }),
    (error) => operationRefusalCode(error) ===
      "acceptance_coverage_final_compare_stale" && error.details.changed === false
  );
  assert.equal(await harness.readCarrier(), null);
});

test("query marks all contracted currentness changes stale and rejects stale continuation", async (t) => {
  const currentnessKeys = Object.keys(OPERATION_BINDINGS);
  for (const key of currentnessKeys) {
    const harness = await operationHarness();
    t.after(() => harness.cleanup());
    const [identity] = await harness.criterionIdentities();
    const createInput = await exactCreateInput(harness, [operationRow(identity.identity)]);
    await createControlledContractAcceptanceCoverageOperation(createInput, {
      resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
    });
    harness.setBinding(key, `${harness.bindings()[key]}-changed`);
    const queried = await queryControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053",
      selector: { kind: "criterion_identity", criterion_identity: identity.identity }
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
    const criterionItem = queried.page.items.find((item) => item.kind === "criterion");
    assert.equal(Object.values(criterionItem.axes).every((state) => state === "stale"), true, key);
  }

  const paged = await operationHarness({
    criteria: [],
    contractNodes: Array.from({ length: 30 }, (_, index) => ({
      id: `mandatory-${index}`, mandatory: true
    })),
    selectedPackNodeIds: [],
    selectedPacks: []
  });
  t.after(() => paged.cleanup());
  const createInput = await exactCreateInput(paged, []);
  await createControlledContractAcceptanceCoverageOperation(createInput, {
    resolveFacts: paged.resolveFacts,
    withSourceLease: paged.withSourceLease
  });
  const first = await queryControlledContractAcceptanceCoverageOperation({
    repoRoot: paged.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: paged.resolveFacts });
  assert.equal(first.page.returned, 25);
  assert.equal(first.next_calls.length, 1);
  paged.setBinding("selectorArtifactDigest", "sha256:selector-artifact-changed");
  await assert.rejects(
    queryControlledContractAcceptanceCoverageOperation({
      repoRoot: paged.repoRoot,
      wkId: "WK-2053",
      cursor: first.next_calls[0].arguments.cursor
    }, { resolveFacts: paged.resolveFacts }),
    (error) => operationRefusalCode(error) === "acceptance_coverage_cursor_stale"
  );
});

test("operation cursor wrapping, selector binding, stateless refusals, and page accounting are exact", async (t) => {
  const criteria = Array.from({ length: 55 }, (_, index) => `selected ${index}`);
  const harness = await operationHarness({
    criteria,
    contractNodes: [
      { id: "node-shared", mandatory: true },
      { id: "node-other", mandatory: false }
    ],
    selectedPackNodeIds: ["node-shared", "node-other"],
    selectedPacks: operationSelectedPacks(["node-shared", "node-other"])
  });
  t.after(() => harness.cleanup());
  const identities = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, identities.map(({ identity }) =>
      operationRow(identity, { nodeIds: ["node-shared"] }))
    ),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  const selector = { kind: "contract_node", node_id: "node-shared" };
  const query = (cursor, selected = selector) =>
    queryControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot,
      wkId: "WK-2053",
      selector: selected,
      ...(cursor === undefined ? {} : { cursor })
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });

  const pages = [];
  let cursor;
  do {
    const page = await query(cursor);
    pages.push(page);
    cursor = page.next_calls[0]?.arguments.cursor;
  } while (cursor !== undefined);

  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map(({ totals }) =>
    [totals.all_items, totals.matched_items]), [[55, 55], [55, 55], [55, 55]]);
  assert.deepEqual(pages.map(({ page }) => [
    page.offset, page.returned, page.remaining, page.complete
  ]), [[0, 25, 30, false], [25, 25, 5, false], [50, 5, 0, true]]);
  assert.deepEqual(pages.flatMap(({ page }) => page.items)
    .map(({ criterion_identity: identity }) => identity),
  identities.map(({ identity }) => identity));
  assert.equal(new Set(pages.flatMap(({ page }) => page.items)
    .map(({ criterion_identity: identity }) => identity)).size, 55);
  assert.equal(pages.filter(({ page }) => page.complete).length, 1);
  for (const result of pages.slice(0, -1)) {
    assert.equal(result.page.continuation,
      result.next_calls[0].arguments.cursor);
    assert.deepEqual(result.next_calls[0].arguments, {
      unit: "WK-2053",
      selector,
      cursor: result.page.continuation
    });
    const operationCursor = decodeCursor(result.page.continuation);
    assert.equal(operationCursor.version,
      "wiki-core-acceptance-coverage-operation-cursor.v1");
    assert.equal(decodeCursor(operationCursor.projection_cursor).version,
      "acceptance-coverage-projection-cursor.v1");
  }
  assert.equal(pages.at(-1).page.continuation, null);
  assert.deepEqual(pages.at(-1).next_calls, []);

  const secondCursor = pages[0].page.continuation;
  const replayOne = await query(secondCursor);
  const replayTwo = await query(secondCursor);
  assert.deepEqual(replayTwo, replayOne,
    "a still-current cursor is deterministic and is not consumed");

  await assert.rejects(query("not-base64-json"),
    (error) => operationRefusalCode(error) === "acceptance_coverage_cursor_invalid");
  const decodedPublic = decodeCursor(secondCursor);
  const projectionCursor = decodeCursor(decodedPublic.projection_cursor);
  await assert.rejects(query(decodedPublic.projection_cursor),
    (error) => operationRefusalCode(error) ===
      "acceptance_coverage_cursor_wrong_layer");
  await assert.rejects(query(encodeCursor({
    ...decodedPublic,
    projection_cursor: "not-a-projection-cursor"
  })), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_cursor_invalid");
  await assert.rejects(query(encodeCursor({
    ...decodedPublic,
    projection_cursor: `${decodedPublic.projection_cursor}!`
  })), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_cursor_invalid");
  await assert.rejects(query(encodeCursor({
    ...decodedPublic,
    projection_cursor: encodeCursor({
      ...projectionCursor,
      projection_digest: projectionCursor.projection_digest === "0".repeat(64)
        ? "1".repeat(64) : "0".repeat(64)
    })
  })), (error) => operationRefusalCode(error) ===
    "acceptance_coverage_cursor_invalid");
  await assert.rejects(query(secondCursor,
    { kind: "contract_node", node_id: "node-other" }),
  (error) => operationRefusalCode(error) ===
    "acceptance_coverage_projection_cursor_selector_mismatch");

  for (const offset of [55, 56]) {
    await assert.rejects(query(encodeCursor({
      ...decodedPublic,
      projection_cursor: encodeCursor({ ...projectionCursor, offset })
    })), (error) => operationRefusalCode(error) ===
      "acceptance_coverage_cursor_exhausted");
  }

  harness.setBinding("selectorArtifactDigest", "sha256:selector-changed");
  await assert.rejects(query(secondCursor),
    (error) => operationRefusalCode(error) === "acceptance_coverage_cursor_stale");

  const invalidSource = new Error("canonical source is independently invalid");
  invalidSource.code = "acceptance_coverage_canonical_source_invalid";
  await assert.rejects(queryControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: async () => { throw invalidSource; } }),
  (error) => operationRefusalCode(error) ===
    "acceptance_coverage_canonical_source_invalid");
});

test("operation boundary rejects caller authority and enforces complete carrier limits", async (t) => {
  const authority = await operationHarness();
  t.after(() => authority.cleanup());
  let resolved = false;
  await assert.rejects(
    queryControlledContractAcceptanceCoverageOperation({
      repoRoot: authority.repoRoot,
      wkId: "WK-2053",
      repositoryPath: "/caller/path"
    }, { resolveFacts: async (...args) => {
      resolved = true;
      return authority.resolveFacts(...args);
    } }),
    (error) => operationRefusalCode(error) ===
      "controlled_contract_request_field_forbidden"
  );
  assert.equal(resolved, false);

  const [identity] = await authority.criterionIdentities();
  const tooMany = Array.from({ length: 4097 }, () => operationRow(identity.identity));
  await assert.rejects(
    createControlledContractAcceptanceCoverageOperation(
      await exactCreateInput(authority, tooMany),
      { resolveFacts: authority.resolveFacts }),
    (error) => operationRefusalCode(error) === "acceptance_coverage_carrier_oversize" &&
      error.details.maximum_rows === 4096 &&
      error.details.maximum_bytes === 1048576 &&
      error.details.changed === false
  );
  assert.equal(await authority.readCarrier(), null);

  const byteBound = await operationHarness();
  t.after(() => byteBound.cleanup());
  const [byteIdentity] = await byteBound.criterionIdentities();
  let padding = 1048577;
  let exactByteInput;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    exactByteInput = await exactCreateInput(byteBound, [
      operationRow(byteIdentity.identity, {
        nodeIds: [`node-${"x".repeat(padding)}`]
      })
    ]);
    let observed;
    await assert.rejects(
      createControlledContractAcceptanceCoverageOperation(exactByteInput, {
        resolveFacts: byteBound.resolveFacts
      }),
      (error) => {
        observed = error.details.byte_length;
        return operationRefusalCode(error) === "acceptance_coverage_carrier_oversize";
      }
    );
    padding += 1048577 - observed;
  }
  await assert.rejects(
    createControlledContractAcceptanceCoverageOperation(exactByteInput, {
      resolveFacts: byteBound.resolveFacts
    }),
    (error) => error.details.byte_length === 1048577 &&
      error.details.maximum_rows === 4096 &&
      error.details.maximum_bytes === 1048576 && error.details.changed === false
  );
  assert.equal(await byteBound.readCarrier(), null);
});

test("complete create accepts the 263-row, 86,504-byte reauthoring payload", async (t) => {
  const criteria = Array.from({ length: 263 }, (_, index) => ({
    text: `criterion ${index}`, typed_identity: `criterion-${index}`
  }));
  const harness = await operationHarness({
    criteria,
    contractNodes: [{ id: "node-covered", mandatory: true }]
  });
  t.after(() => harness.cleanup());
  const identities = await harness.criterionIdentities();
  const rows = identities.map(({ identity }) => operationRow(identity));
  const currentBytes = Buffer.byteLength(JSON.stringify(rows), "utf8");
  rows[0].node_ids[0] += "x".repeat(86504 - currentBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(rows), "utf8"), 86504);
  const input = await exactCreateInput(harness, rows);
  const result = await createControlledContractAcceptanceCoverageOperation(input, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease
  });
  assert.equal(result.changed, true);
  assert.equal((await harness.readCarrier()).content.rows.length, 263);
});

function acceptanceRebaseAttempt(described) {
  return {
    repoRoot: null,
    wkId: "WK-2053",
    mode: "attempt",
    carrierIdentity: described.carrier_identity,
    sourceIdentity: described.source_identity,
    expectedUnitDigest: described.unit.digest
  };
}

const CURRENT_SOURCE_FACTS = Object.freeze({ sourceCurrent: true });

test("acceptance rebase exact-identity attempt atomically rebinds and replays idempotently", async (t) => {
  const harness = await operationHarness();
  t.after(() => harness.cleanup());
  const [identity] = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, [operationRow(identity.identity)]),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  harness.setBinding("ownershipDigest", "sha256:ownership-rebased");
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  assert.equal(described.status, "carrier_present_stale");
  assert.equal(described.next_calls[0].tool,
    "workspace_controlled_contract_acceptance_coverage_rebase");
  const attempt = {
    ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
  };
  const rebound = await rebaseControlledContractAcceptanceCoverageOperation(attempt, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
    resolveSourceFacts: async () => CURRENT_SOURCE_FACTS
  });
  assert.equal(rebound.status, "resolved");
  assert.equal(rebound.changed, true);
  assert.deepEqual((await harness.readCarrier()).content.rows, [operationRow(identity.identity)]);

  const replayed = await rebaseControlledContractAcceptanceCoverageOperation(attempt, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
    resolveSourceFacts: async () => CURRENT_SOURCE_FACTS
  });
  assert.equal(replayed.status, "already_current");
  assert.equal(replayed.changed, false);
  assert.equal((await harness.readCarrier()).content_digest, rebound.content_digest);
});

test("changed criterion identity requires one complete semantic conflict disposition", async (t) => {
  const harness = await operationHarness({ criteria: ["criterion old"] });
  t.after(() => harness.cleanup());
  const [oldIdentity] = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, [operationRow(oldIdentity.identity)]),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  harness.setCriteria(["criterion new"]);
  harness.setBinding("workRecordLocatorDigest", "sha256:work-record-locator-new");
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  const attemptInput = {
    ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
  };
  const conflicted = await rebaseControlledContractAcceptanceCoverageOperation(attemptInput, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
    resolveSourceFacts: async () => CURRENT_SOURCE_FACTS
  });
  assert.equal(conflicted.status, "conflicts");
  assert.equal(conflicted.total_count, 1);
  assert.equal(conflicted.conflicts[0].kind, "changed");
  assert.notEqual(conflicted.conflicts[0].old_identity.criterion_identity,
    conflicted.conflicts[0].current_identity.criterion_identity);
  assert.equal((await harness.readCarrier()).content.rows[0].criterion_identity,
    oldIdentity.identity);

  for (const dispositions of [
    [],
    [{ conflict_id: `sha256:${"f".repeat(64)}`, disposition: "remove" }],
    [{ conflict_id: conflicted.conflicts[0].conflict_id, disposition: "retain" }],
    [
      { conflict_id: conflicted.conflicts[0].conflict_id, disposition: "remove" },
      { conflict_id: conflicted.conflicts[0].conflict_id, disposition: "remove" }
    ]
  ]) {
    await assert.rejects(rebaseControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "resolve",
      conflictSetIdentity: conflicted.conflict_set_identity, dispositions
    }, {
      resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS
    }), (error) => [
      "controlled_contract_coverage_rebase_resolution_invalid",
      "controlled_contract_coverage_rebase_resolution_incomplete",
      "controlled_contract_coverage_rebase_disposition_invalid"
    ].includes(operationRefusalCode(error)));
    assert.equal((await harness.readCarrier()).content.rows[0].criterion_identity,
      oldIdentity.identity);
  }

  const newIdentity = described.criterion_identities.identities[0].identity;
  const resolved = await rebaseControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "resolve",
    conflictSetIdentity: conflicted.conflict_set_identity,
    dispositions: [{
      conflict_id: conflicted.conflicts[0].conflict_id,
      disposition: "replace",
      row: operationRow(newIdentity)
    }]
  }, {
    resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
    resolveSourceFacts: async () => CURRENT_SOURCE_FACTS
  });
  assert.equal(resolved.status, "resolved");
  assert.equal((await harness.readCarrier()).content.rows[0].criterion_identity, newIdentity);
});

test("rebase add, remove, and retain dispositions each produce one complete current carrier", async (t) => {
  await t.test("add a newly introduced criterion", async (subtest) => {
    const harness = await operationHarness({ criteria: ["criterion retained"] });
    subtest.after(() => harness.cleanup());
    const [retained] = await harness.criterionIdentities();
    await createControlledContractAcceptanceCoverageOperation(
      await exactCreateInput(harness, [operationRow(retained.identity)]),
      { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
    );
    harness.setCriteria(["criterion retained", "criterion added"]);
    harness.setBinding("workRecordLocatorDigest", "sha256:add-disposition");
    const described = await describeControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053"
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
    const attempted = await rebaseControlledContractAcceptanceCoverageOperation({
      ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.deepEqual(attempted.conflicts.map(({ kind }) => kind), ["new_unmapped"]);
    const addedIdentity = attempted.conflicts[0].current_identity.criterion_identity;
    const resolved = await rebaseControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "resolve",
      conflictSetIdentity: attempted.conflict_set_identity,
      dispositions: [{ conflict_id: attempted.conflicts[0].conflict_id,
        disposition: "add", row: operationRow(addedIdentity) }]
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.equal(resolved.status, "resolved");
    assert.equal((await harness.readCarrier()).content.rows.length, 2);
  });

  await t.test("remove a deleted criterion", async (subtest) => {
    const harness = await operationHarness({ criteria: ["criterion kept", "criterion removed"] });
    subtest.after(() => harness.cleanup());
    const identities = await harness.criterionIdentities();
    await createControlledContractAcceptanceCoverageOperation(
      await exactCreateInput(harness, identities.map(({ identity }) => operationRow(identity))),
      { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
    );
    harness.setCriteria(["criterion kept"]);
    harness.setBinding("workRecordLocatorDigest", "sha256:remove-disposition");
    const described = await describeControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053"
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
    const attempted = await rebaseControlledContractAcceptanceCoverageOperation({
      ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.deepEqual(attempted.conflicts.map(({ kind }) => kind), ["removed"]);
    await rebaseControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "resolve",
      conflictSetIdentity: attempted.conflict_set_identity,
      dispositions: [{ conflict_id: attempted.conflicts[0].conflict_id,
        disposition: "remove" }]
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.deepEqual((await harness.readCarrier()).content.rows,
      [operationRow(identities[0].identity)]);
  });

  await t.test("retain exactly one member of a duplicate population", async (subtest) => {
    const harness = await operationHarness();
    subtest.after(() => harness.cleanup());
    const [identity] = await harness.criterionIdentities();
    await createControlledContractAcceptanceCoverageOperation(
      await exactCreateInput(harness, [operationRow(identity.identity)]),
      { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
    );
    const carrier = (await harness.readCarrier()).content;
    carrier.rows.push(structuredClone(carrier.rows[0]));
    await writeFile(harness.carrierFile, `${JSON.stringify(carrier, null, 2)}\n`);
    harness.setBinding("ownershipDigest", "sha256:retain-disposition");
    const described = await describeControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053"
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
    const attempted = await rebaseControlledContractAcceptanceCoverageOperation({
      ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.deepEqual(attempted.conflicts.map(({ kind }) => kind),
      ["duplicate", "duplicate"]);
    await rebaseControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "resolve",
      conflictSetIdentity: attempted.conflict_set_identity,
      dispositions: attempted.conflicts.map((conflict, index) => ({
        conflict_id: conflict.conflict_id,
        disposition: index === 0 ? "retain" : "remove"
      }))
    }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
      resolveSourceFacts: async () => CURRENT_SOURCE_FACTS });
    assert.deepEqual((await harness.readCarrier()).content.rows,
      [operationRow(identity.identity)]);
  });
});

test("rebase conflict cursor and conflict set reject relevant mutation but not retries", async (t) => {
  const harness = await operationHarness({
    criteria: Array.from({ length: 80 }, (_, index) => `old criterion ${index}`)
  });
  t.after(() => harness.cleanup());
  const identities = await harness.criterionIdentities();
  await createControlledContractAcceptanceCoverageOperation(
    await exactCreateInput(harness, identities.map(({ identity }) => operationRow(identity))),
    { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease }
  );
  harness.setCriteria(Array.from({ length: 80 }, (_, index) => `new criterion ${index}`));
  harness.setBinding("workRecordLocatorDigest", "sha256:work-record-locator-many-new");
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: harness.repoRoot, wkId: "WK-2053"
  }, { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease });
  const options = { resolveFacts: harness.resolveFacts, withSourceLease: harness.withSourceLease,
    resolveSourceFacts: async () => CURRENT_SOURCE_FACTS };
  const first = await rebaseControlledContractAcceptanceCoverageOperation({
    ...acceptanceRebaseAttempt(described), repoRoot: harness.repoRoot
  }, options);
  assert.equal(first.status, "conflicts");
  assert.ok(Buffer.byteLength(JSON.stringify(first), "utf8") <= 16384);
  assert.ok(first.omitted_count > 0);
  const conflictIds = first.conflicts.map(({ conflict_id: id }) => id);
  const pageInput = {
    repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "page",
    conflictSetIdentity: first.conflict_set_identity, cursor: first.continuation
  };
  const retry = await rebaseControlledContractAcceptanceCoverageOperation(pageInput, options);
  assert.deepEqual(await rebaseControlledContractAcceptanceCoverageOperation(pageInput, options),
    retry);
  let page = retry;
  while (true) {
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 16384);
    conflictIds.push(...page.conflicts.map(({ conflict_id: id }) => id));
    if (page.continuation === null) break;
    page = await rebaseControlledContractAcceptanceCoverageOperation({
      repoRoot: harness.repoRoot, wkId: "WK-2053", mode: "page",
      conflictSetIdentity: first.conflict_set_identity,
      cursor: page.continuation
    }, options);
  }
  assert.equal(conflictIds.length, first.total_count);
  assert.equal(new Set(conflictIds).size, first.total_count);
  harness.setBinding("verificationDigest", "sha256:verification-mutated");
  await assert.rejects(
    rebaseControlledContractAcceptanceCoverageOperation(pageInput, options),
    (error) => operationRefusalCode(error) ===
      "controlled_contract_coverage_rebase_stale"
  );
});

test("stale duplicate rows cannot be retained in either rebase family", async () => {
  const obligationResolved = {
    rows: [0, 1].map(() => ({
      obligation_id: "OBL-WK2427-DUPLICATE",
      source_locator: "/acceptance/criteria/0",
      source_locator_digest: "sha256:stale",
      statement: "The exact semantic identity remains current.",
      controlled_contract_node_ids: ["node-current"],
      proof: { kind: "explicit_gap" }
    })),
    criteria: [{
      identity: "criterion-current",
      criterion: "The exact semantic identity remains current.",
      source_locator: "/acceptance/criteria/0"
    }],
    contractNodes: [{ id: "node-current" }],
    selectedPacks: [],
    criterionIdentities: { digest: "sha256:criteria" },
    authoringIdentity: "sha256:authoring",
    source: { content_digest: "sha256:source" },
    bindings: { contractNodeDigest: "sha256:nodes", selectedPackDigest: "sha256:packs" },
    staleReasons: ["proof_identity"]
  };
  const obligationPlan = planObligationCoverageRebase(obligationResolved, {
    sourceLocatorDigest: () => "sha256:current"
  });
  assert.deepEqual(obligationPlan.entries.map(({ public: conflict }) => conflict.kind),
    ["changed", "changed"]);
  assert.equal(obligationPlan.entries.some(({ public: conflict }) =>
    conflict.allowed_dispositions.includes("retain")), false);

  const criterionIdentities = {
    digest: "sha256:current-identities",
    identities: [{ identity: "criterion-current", position: 0, source: "/acceptance/criteria/0" }]
  };
  const acceptancePlan = planAcceptanceCoverageRebase({
    rows: [0, 1].map(() => operationRow("criterion-current", {
      nodeIds: ["node-removed"]
    })),
    carrier: {
      content_digest: "sha256:carrier",
      content: { criterion_identities: criterionIdentities }
    },
    source: { content_digest: "sha256:source" },
    bindings: { workRecordLocatorDigest: "sha256:work-record" },
    contractNodes: [{ id: "node-current" }]
  }, criterionIdentities);
  assert.deepEqual(acceptancePlan.entries.map(({ public: conflict }) => conflict.kind),
    ["absent_node", "absent_node"]);
  assert.equal(acceptancePlan.entries.some(({ public: conflict }) =>
    conflict.allowed_dispositions.includes("retain")), false);

  for (const plan of [obligationPlan, acceptancePlan]) {
    await assert.rejects(applyCompleteRebaseResolution(plan,
      plan.entries.map(({ public: conflict }) => ({
        conflict_id: conflict.conflict_id, disposition: "retain"
      })), {
        normalizeRow: async (row) => row,
        rowMatchesCurrentIdentity: () => true
      }), (error) => error.code ===
        "controlled_contract_coverage_rebase_disposition_invalid");
  }
});

test("stale conflict sets and page limits carry exact family describe recovery", () => {
  const identities = {
    digest: "sha256:current-identities",
    identities: [{ identity: "criterion-current", position: 0, source: "/acceptance/criteria/0" }]
  };
  const acceptancePlan = planAcceptanceCoverageRebase({
    rows: Array.from({ length: 80 }, () => operationRow("criterion-current")),
    carrier: { content_digest: "sha256:carrier", content: { criterion_identities: identities } },
    source: { content_digest: "sha256:source" },
    bindings: { mappingDigest: "sha256:mapping" },
    contractNodes: [{ id: "node-covered" }]
  }, identities);
  const obligationPlan = planObligationCoverageRebase({
    rows: [{
      obligation_id: "OBL-WK2427-STALE",
      source_locator: "/acceptance/criteria/0",
      source_locator_digest: "sha256:stale",
      statement: "Recover exactly.",
      controlled_contract_node_ids: ["node-current"],
      proof: { kind: "explicit_gap" }
    }],
    criteria: [{ identity: "criterion-current", criterion: "Recover exactly.",
      source_locator: "/acceptance/criteria/0" }],
    contractNodes: [{ id: "node-current" }], selectedPacks: [],
    criterionIdentities: { digest: "sha256:criteria" },
    authoringIdentity: "sha256:authoring", source: { content_digest: "sha256:source" },
    bindings: { contractNodeDigest: "sha256:nodes", selectedPackDigest: "sha256:packs" },
    staleReasons: ["source_locator_digest"]
  }, { sourceLocatorDigest: () => "sha256:current" });
  const calls = {
    acceptance: { tool: "workspace_controlled_contract_acceptance_coverage_describe",
      arguments: { unit: "WK-2427#SLICE-005", focus: "security" } },
    obligation: { tool: "workspace_controlled_contract_obligation_coverage_describe",
      arguments: { unit: "WK-2427#SLICE-005", focus: "security" } }
  };
  for (const plan of [acceptancePlan, obligationPlan]) {
    assert.throws(() => assertConflictSetCurrent(plan, "sha256:stale", calls[plan.family]),
      (error) => error.code === "controlled_contract_coverage_rebase_stale" &&
        assert.deepEqual(error.details.next_calls, [calls[plan.family]]) === undefined);
  }
  const first = projectRebaseConflictPage(acceptancePlan, {
    staleRecovery: calls.acceptance
  });
  assert.ok(first.continuation);
  const decoded = decodeCursor(first.continuation);
  assert.equal(decoded.applied_page_limit_bytes, 16384);
  decoded.applied_page_limit_bytes = 16383;
  assert.throws(() => projectRebaseConflictPage(acceptancePlan, {
    cursor: encodeCursor(decoded), staleRecovery: calls.acceptance
  }), (error) => error.code === "controlled_contract_coverage_rebase_cursor_stale" &&
    assert.deepEqual(error.details.next_calls, [calls.acceptance]) === undefined);
});
