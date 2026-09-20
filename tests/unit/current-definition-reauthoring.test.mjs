import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  qualifyStableCurrentDefinitionReauthoring,
  reauthorStableCurrentDefinitionBindings,
  validateStableTestProofContract
} from "../../packages/controlled-contract/current.mjs";
import {
  adaptRawSchemaDiagnostic,
  projectBoundedDiagnostics
} from "../../packages/controlled-contract/lib/bounded-diagnostic-projection.mjs";
import { validateStableV1ContractFamily } from
  "../../packages/controlled-contract/lib/stable-v1-family-validation.mjs";
import {
  compileControlledContractAuthoringProspectiveMembers,
  settleControlledContractAuthoringProspectiveMembers
} from "../../packages/wiki-core/src/operations/controlled-contract/authoring-prospective-settlement.mjs";
import { assertPackageValidContract } from
  "../../packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs";
import { composeControlledContractRuntimeTestSelectorCorrection } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-runtime-proof.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(repository, "tests", "fixtures",
  "controlled-contract-carrier-sets", "WK-2518");
const fixtureRepository = path.join(fixtureRoot, "repository");

const diagnosticIdentity = ({ code, definition_pointer: definitionPointer,
  field_pointer: fieldPointer, property_name: propertyName,
  property_kind: propertyKind, keyword, test_proof_id: testProofId,
  verification_claim_id: verificationClaimId }) => ({
  code,
  definition_pointer: definitionPointer,
  field_pointer: fieldPointer,
  property_name: propertyName,
  property_kind: propertyKind,
  keyword,
  test_proof_id: testProofId,
  verification_claim_id: verificationClaimId
});
const sortedDiagnosticIdentities = (rows) => rows.map(diagnosticIdentity).sort(
  (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

async function rejectedWk2518Contract() {
  const contracts = path.join(fixtureRepository, "wiki", "contracts");
  const manifest = JSON.parse(await readFile(path.join(contracts,
    "WK-2518.carrier-set-manifest.json"), "utf8"));
  const member = manifest.carriers.find(({ carrier_kind: kind }) => kind === "contract");
  return JSON.parse(await readFile(path.join(contracts, member.path), "utf8"));
}

async function expectedWk2518Diagnostics() {
  return JSON.parse(await readFile(path.join(fixtureRoot,
    "expected-current-definition-diagnostics.json"), "utf8"));
}

function correctionPopulation(contract, qualification) {
  const stored = new Map(contract.test_proofs.map((proof) =>
    [proof.verification_claim_id, proof]));
  return qualification.definitions.map((definition, index) => ({
    op: "replace",
    verification_id: definition.verification_claim_id,
    binding: composeControlledContractRuntimeTestSelectorCorrection({
      storedBinding: stored.get(definition.verification_claim_id),
      runtimeTest: { selector: {
        name: `WK-2518 explicitly selected assertion ${index + 1}`,
        nesting: index % 3
      } },
      retireFields: [...definition.unexpected_fields],
      expectedRetiredFields: definition.unexpected_fields,
      field: `definitions[${index}]`
    })
  }));
}

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

test("WK-2518's exact stable-v1 cutover shape qualifies all 17 definitions", async () => {
  const contract = await rejectedWk2518Contract();
  const expected = await expectedWk2518Diagnostics();
  const validation = validateStableV1ContractFamily(contract);
  assert.equal(validation.valid, false);
  assert.equal(validation.diagnostic_details.length, expected.diagnostic_count);
  assert.equal(validation.diagnostics.total_count, expected.diagnostic_count);
  assert.deepEqual(sortedDiagnosticIdentities(validation.diagnostic_details),
    sortedDiagnosticIdentities(expected.diagnostics),
    "the frozen source has a separately enumerated diagnostic oracle");
  const qualification = qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: validation.diagnostic_details });
  assert.equal(qualification.affected_definition_count, 17);
  assert.ok(qualification.definitions.every((definition) =>
    definition.unexpected_fields.length === 1 &&
    definition.unexpected_fields[0] === "coverage_disposition" &&
    definition.missing_fields[0] === "test_selector"));

  const unsupported = structuredClone(validation.diagnostic_details);
  unsupported.push({ ...unsupported[0], property_name: "corrupt_field",
    field_pointer: "/test_proofs/0/corrupt_field" });
  assert.equal(qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: unsupported }), null,
  "unsupported corruption retains the incumbent validation failure");
  const mismatchedIdentity = structuredClone(validation.diagnostic_details);
  mismatchedIdentity[0].verification_claim_id = "claim-another-definition";
  assert.equal(qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: mismatchedIdentity }), null);
  assert.equal(qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: validation.diagnostic_details.filter(({ keyword }) =>
      keyword !== "required") }), null,
  "a retired field without its missing current selector is not this cutover shape");
});

test("provider compatibility failures expose complete details to the carrier consumer",
  async () => {
    const contract = await rejectedWk2518Contract();
    const validation = validateStableV1ContractFamily(contract);
    const qualification = qualifyStableCurrentDefinitionReauthoring({ contract,
      diagnosticDetails: validation.diagnostic_details });
    const current = reauthorStableCurrentDefinitionBindings({ contract, qualification,
      replacements: correctionPopulation(contract, qualification) }).contract;
    const invalid = structuredClone(current);
    invalid.test_proofs[0].candidate_execution_provider.provider_id =
      "launcher.missing-provider";

    const result = validateStableTestProofContract(invalid);
    assert.equal(result.valid, false);
    assert.deepEqual(result.diagnostic_details.map(({ code, pointer }) => ({ code, pointer })),
      [{ code: "stable_test_proof_provider_unknown",
        pointer: "/test_proofs/0/candidate_execution_provider/provider_id" }]);
    assert.equal(result.diagnostics.total_count, result.diagnostic_details.length);
    assert.throws(() => assertPackageValidContract(result), (error) => {
      assert.equal(error.code, "controlled_contract_carrier_validation_failed");
      assert.deepEqual(error.details.diagnostic_details, result.diagnostic_details);
      assert.notDeepEqual(error.details.diagnostic_details, []);
      return true;
    });
  });

test("qualification and composition retire both allowed fields exactly", async () => {
  const contract = await rejectedWk2518Contract();
  contract.test_proofs[0].runtime_test_identity = "historical-runtime-identity";
  const validation = validateStableV1ContractFamily(contract);
  const qualification = qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: validation.diagnostic_details });
  const definition = qualification.definitions[0];
  assert.deepEqual(definition.unexpected_fields,
    ["coverage_disposition", "runtime_test_identity"]);
  const stored = contract.test_proofs[0];
  const selector = { name: "both retired fields are explicitly replaced", nesting: 2 };
  assert.throws(() => composeControlledContractRuntimeTestSelectorCorrection({
    storedBinding: stored,
    runtimeTest: { selector },
    retireFields: ["coverage_disposition"],
    expectedRetiredFields: definition.unexpected_fields,
    field: "definitions[0]"
  }), (error) =>
    error.code === "controlled_contract_current_definition_retirement_confirmation_invalid");
  const composed = composeControlledContractRuntimeTestSelectorCorrection({
    storedBinding: stored,
    runtimeTest: { selector },
    retireFields: ["runtime_test_identity", "coverage_disposition"],
    expectedRetiredFields: definition.unexpected_fields,
    field: "definitions[0]"
  });
  assert.equal(Object.hasOwn(composed, "coverage_disposition"), false);
  assert.equal(Object.hasOwn(composed, "runtime_test_identity"), false);
  assert.deepEqual(composed.test_selector, selector);
  assert.deepEqual(composed.falsifiers, stored.falsifiers);
  assert.deepEqual(composed.system_under_test_boundary,
    stored.system_under_test_boundary);
  assert.deepEqual(composed.observable_result, stored.observable_result);
  assert.deepEqual(composed.prohibited_shortcuts, stored.prohibited_shortcuts);
});

test("complete explicit reauthoring changes only selectors and confirmed retired fields", async () => {
  const contract = await rejectedWk2518Contract();
  const validation = validateStableV1ContractFamily(contract);
  const qualification = qualifyStableCurrentDefinitionReauthoring({ contract,
    diagnosticDetails: validation.diagnostic_details });
  const replacements = correctionPopulation(contract, qualification);
  assert.throws(() => reauthorStableCurrentDefinitionBindings({ contract, qualification,
    replacements: replacements.slice(0, -1) }), (error) =>
    error.code === "stable_current_definition_reauthoring_population_incomplete");

  const result = reauthorStableCurrentDefinitionBindings({ contract, qualification,
    replacements });
  assert.equal(validateStableTestProofContract(result.contract).valid, true);
  assert.equal(result.changed_verification_ids.length, 17);
  for (const [index, before] of contract.test_proofs.entries()) {
    const after = result.contract.test_proofs[index];
    const expected = structuredClone(before);
    delete expected.coverage_disposition;
    expected.test_selector = replacements[index].binding.test_selector;
    assert.deepEqual(after, expected);
    assert.deepEqual(after.falsifiers, before.falsifiers);
    assert.deepEqual(after.system_under_test_boundary, before.system_under_test_boundary);
  }
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
