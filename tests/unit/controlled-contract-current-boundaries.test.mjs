

import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  adaptRawSchemaDiagnostic,
  projectBoundedDiagnostics
} from "../../packages/controlled-contract/lib/bounded-diagnostic-projection.mjs";
import {
  compileControlledContractAuthoringProspectiveMembers,
  settleControlledContractAuthoringProspectiveMembers
} from "../../packages/wiki-core/src/operations/controlled-contract/authoring-prospective-settlement.mjs";
import {
  classifyControlledContractDesignWorkbenchActionability,
  projectClassifiedControlledContractDesignWorkbench,
  semanticDescriptor
} from
  "../../packages/wiki-core/src/operations/controlled-contract/design-workbench-actionability.mjs";
import { controlledContractAnswerLimits, withControlledContractAnswerLimits } from
  "../../packages/wiki-core/src/operations/controlled-contract/design-workbench-response-input.mjs";
import { validateRecordAuthoringChanges } from "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";
import { createSaveRecordInputContract } from "../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs";

test("the shared schema adapter preserves escaped fields and definition identities", () => {
  const document = { test_proofs: [{ test_proof_id: "proof-one",
    verification_claim_id: "claim-one", "extra/~field": true }] };
  const extra = adaptRawSchemaDiagnostic({ instancePath: "/test_proofs/0",
    keyword: "additionalProperties", params: { additionalProperty: "extra/~field" },
    message: "unexpected" }, { code: "stable_contract_schema_invalid", document });
  const missing = adaptRawSchemaDiagnostic({ instancePath: "/test_proofs/0",
    keyword: "required", params: { missingProperty: "test_selector" },
    message: "missing" }, { code: "stable_contract_schema_invalid", document });
  const secondExtra = adaptRawSchemaDiagnostic({ instancePath: "/test_proofs/0",
    keyword: "additionalProperties", params: { additionalProperty: "another" },
    message: "unexpected" }, { code: "stable_contract_schema_invalid", document });

  assert.equal(extra.field_pointer, "/test_proofs/0/extra~1~0field");
  assert.equal(extra.definition_pointer, "/test_proofs/0");
  assert.equal(extra.test_proof_id, "proof-one");
  assert.equal(extra.verification_claim_id, "claim-one");
  assert.deepEqual([extra.property_name, missing.property_name],
    ["extra/~field", "test_selector"]);
  const projected = projectBoundedDiagnostics([extra, missing, secondExtra]);
  assert.equal(projected.total_count, 3);
  assert.equal(projected.returned_count, 3,
    "property-level diagnostics must not collapse during normalization or grouping");
  const longName = `field/${"x".repeat(5_000)}~tail`;
  const completeLong = adaptRawSchemaDiagnostic({ instancePath: "/test_proofs/0",
    keyword: "additionalProperties", params: { additionalProperty: longName } },
  { code: "stable_contract_schema_invalid", document });
  assert.equal(completeLong.property_name, longName);
  assert.ok(completeLong.field_pointer.endsWith("~0tail"));
  const boundedLong = projectBoundedDiagnostics([completeLong]);
  assert.equal(boundedLong.diagnostics[0].content_truncated, true);
  assert.notEqual(boundedLong.diagnostics[0].property_name, longName,
    "bounded delivery may truncate only after the complete diagnostic is retained");
});

test("a post-commit closeout failure reports established publication and forbids retry", async () => {
  const source = { canonical_set: { generation: "generation-one" },
    canonical_members: { "WK-9000.controlled-acceptance.json": { before: true } },
    manifest_content_digest: "sha256:manifest-one", record_source_digest: "sha256:record",
    record: { repo: "agent-chassis/agent-chassis" }, lease: { identity: "lease" } };
  const prospective = compileControlledContractAuthoringProspectiveMembers({
    wkId: "WK-9000", source, contributions: [{ owner: "test_proof",
      carrier_kind: "contract", filename: "WK-9000.controlled-acceptance.json",
      content: { after: true } }]
  });
  let retainCalls = 0;
  await assert.rejects(settleControlledContractAuthoringProspectiveMembers({
    repoRoot: "/unused", wkId: "WK-9000", source, prospective
  }, {
    retain: async () => {
      retainCalls += 1;
      if (retainCalls === 1) return { identity: "finalized-one" };
      const error = new Error("receipt store unavailable");
      error.code = "receipt_store_unavailable";
      error.details = { changed: false };
      throw error;
    },
    prepareCarrierSettlement: async () => ({
      commit: async () => ({ generation: "generation-two",
        manifest_content_digest: "sha256:manifest-two", no_op: false }),
      compensate: async () => {}
    }),
    settle: async ({ participants }) => {
      const prepared = await participants[0].prepare();
      await prepared.commit();
      return { status: "committed", committed_participants: ["canonical_generation"] };
    }
  }), (error) => {
    assert.equal(error.code, "receipt_store_unavailable");
    assert.equal(error.details.changed, true);
    assert.equal(error.details.retry_safe, false);
    assert.equal(error.details.publication_outcome, "established");
    assert.equal(error.details.target_generation, "generation-two");
    return true;
  });
});

test("legacy cutover behavior is absent from current authoring surfaces", async () => {
  const absent = (namespace, names, surface) => {
    for (const name of names) assert.equal(name in namespace, false, `${surface} still exports ${name}`);
  };
  absent(await import("../../packages/controlled-contract/current.mjs"), [
    "CURRENT_DEFINITION_REAUTHORING_SCHEMA", "RETIRED_CURRENT_DEFINITION_FIELDS",
    "qualifyStableCurrentDefinitionReauthoring", "reauthorStableCurrentDefinitionBindings"
  ], "the package");
  const operations = "../../packages/wiki-core/src/operations/";
  absent(await import(`${operations}controlled-contract.mjs`),
    ["reauthorControlledContractCurrentDefinitions"], "the core facade");
  absent(await import(`${operations}controlled-contract/contract-requirement-runtime-proof.mjs`),
    ["composeControlledContractRuntimeTestSelectorCorrection"], "the runtime-proof owner");
  absent(await import(`${operations}controlled-contract/design-workbench-row-offers.mjs`),
    ["currentDefinitionReauthoringOffer"], "the row-offer owner");
  await assert.rejects(import(`${operations}controlled-contract/current-definition-reauthoring.mjs`),
    { code: "ERR_MODULE_NOT_FOUND" });

  const qualification = { schema_version: "controlled-contract-current-definition-reauthoring.v1",
    source_shape: "stable_v1_retired_definition_fields", affected_definition_count: 1,
    definitions: [{ definition_pointer: "/test_proofs/0", test_proof_id: "proof-one",
      verification_claim_id: "claim-one", unexpected_fields: ["coverage_disposition"],
      missing_fields: ["test_selector"] }],
    selector: { required_fields: ["name", "nesting"] } };
  const dimension = { dimension_id: "contract_assessment", owner_result: {
    current_definition_reauthoring: qualification,
    source: { controlled_contract_digest: `sha256:${"a".repeat(64)}` } } };
  assert.equal(semanticDescriptor({ dimensions: [] }, dimension, { reasons: [], evidence: {} }), null);

  const served = createSaveRecordInputContract(z).inputSchema;
  const save = { unit: "WK-9000", revision: `sha256:${"a".repeat(64)}`, changes: { title: "A current ordinary change" } };
  const retired = { ...save, changes: { ...save.changes, current_definition_reauthoring: qualification } };
  assert.equal(served.safeParse(save).success, true, "the current save is the accepted baseline");
  assert.deepEqual(validateRecordAuthoringChanges("work_item", "existing", save.changes), []);
  assert.equal(served.safeParse(retired).success, false, "the retired cutover payload is not a served input");
  assert.deepEqual(validateRecordAuthoringChanges("work_item", "existing", retired.changes)
    .map(({ code, path, constraint }) => [code, path, constraint]),
  [["record_authoring_change_invalid", "changes.current_definition_reauthoring",
    { keyword: "additionalProperties", additionalProperty: "current_definition_reauthoring" }]]);

  const kind = "current_definition_reauthoring";
  const [limits] = controlledContractAnswerLimits([kind]);
  assert.deepEqual([limits.response_kind, limits.batching.supported], [kind, false]);
  const population = { publication: "complete_population_atomic" };
  const projected = withControlledContractAnswerLimits({ population_authoring: population }, [kind]);
  assert.deepEqual(projected.population_authoring, population);
  assert.equal(projected.complete_answer_limits[0].batching.supported, false);
});

test("acceptance-axis rows are observed and never classified as authored transitions", () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const criterion = { criterion_identity: "derived:one", source_locator: "/acceptance/criteria/0" };
  const source = { source_kind: "obligation_coverage", content_digest: digest };

  const absent = { row_id: "acceptance_coverage:absent", state: "missing",
    reason_codes: ["acceptance_coverage_carrier_absent"], semantic_identity: { population: "absent" },
    evidence: { carrier_absent: true, criterion_count: 1, criteria: [criterion] } };
  const stored = { row_id: "acceptance_coverage:row", state: "missing", reason_codes: ["uncovered"],
    semantic_identity: { criterion_identity: "derived:one", position: 0 }, evidence: {} };
  const acceptance = (carrier, rows) => ({ dimension_id: "acceptance_coverage", rows, owner_result: {
    carrier, source, wkId: "WK-9000", focus: null, selectedUnit: null, selected_unit_digest: digest,
    unit_digest: digest, authoring_identity: digest, changed_bindings: [] } });
  const obligation = { row_id: "obligation_coverage:one", state: "missing",
    reason_codes: ["obligation_coverage_statement_missing"], semantic_identity: { obligation_id: "OBL-1" },
    evidence: { obligation_id: "OBL-1", statement: null, source_locator: criterion.source_locator,
      source_locator_digest: digest, controlled_contract_node_ids: [], mechanism: null, proof: null } };
  const manifest = { subject: { wk_id: "WK-9000", controlled_acceptance_state: "required" }, dimensions: [
    acceptance(null, [absent]), acceptance({ content_digest: digest }, [stored]),
    { dimension_id: "obligation_coverage", rows: [obligation], owner_result: { sourceCurrent: true,
      source: { content_digest: digest }, criterionIdentities: { digest }, selectedUnit: null,
      criteria: [{ source_locator: criterion.source_locator, identity: criterion.criterion_identity }] } }] };
  for (const index of [0, 1]) assert.equal(
    semanticDescriptor(manifest, manifest.dimensions[index], manifest.dimensions[index].rows[0]), null);

  let classified = manifest;
  for (let pass = 0; pass < 2; pass += 1) {
    const classification = classifyControlledContractDesignWorkbenchActionability(classified);
    assert.deepEqual([...classification.descriptors.keys()], [obligation.row_id]);
    assert.equal(classification.descriptors.get(obligation.row_id).semantic_owner, "obligation_coverage");
    classified = projectClassifiedControlledContractDesignWorkbench(classified, classification);
    assert.deepEqual(classified.actionable_rows.map(({ row_id: id }) => id), [obligation.row_id]);
    for (const row of classified.non_actionable_rows) {
      assert.equal(row.non_actionable_reason, "no_single_incumbent_semantic_transition");
      assert.equal(Object.hasOwn(row, "eligible_response_forms"), false);
      assert.equal(JSON.stringify(row).includes("acceptance_coverage_population"), false);
    }
    assert.deepEqual(classified.non_actionable_rows.map(({ row_id: id }) => id).sort(),
      [absent.row_id, stored.row_id]);
  }
});
