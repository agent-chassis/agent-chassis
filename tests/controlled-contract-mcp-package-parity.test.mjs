import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessProofPlanFiles,
  buildProofPlan,
  compactMultiPackAssessment,
  compactProofIntentSelection,
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindings,
  inspectProofPackBindingsPage,
  searchVocabulary,
  selectProofPacks
} from "../packages/controlled-contract/current.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "../packages/controlled-contract/test/proof-packs/refusal-before-effects-fixture.mjs";
import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  queryControlledVocabularyOperation,
  readControlledContractCarrierOperation,
  selectProofPacksOperation
} from "../packages/wiki-core/src/operations/controlled-contract.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");

async function json(name) {
  return JSON.parse(await readFile(path.join(CONTRACTS, name), "utf8"));
}

async function refusalCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.envelope?.warning?.payload?.reason_code ?? null;
  }
  assert.fail("operation should refuse");
}

test("vocabulary, discovery, exact selection, description, and binding inspection preserve package semantics", async () => {
  const vocabularyInput = { text: "population", kinds: ["type_term", "operator"] };
  assert.deepEqual(await queryControlledVocabularyOperation(vocabularyInput),
    searchVocabulary(vocabularyInput));

  const discoveryInput = { query: "lossless projection", limit: 4 };
  assert.deepEqual(await discoverControlledProofIntentsOperation(discoveryInput),
    discoverProofIntents(discoveryInput));

  const contract = await json("WK-2012.controlled-acceptance.json");
  const intents = ["controlled-proof-intent.result-shape-conformance"];
  assert.deepEqual(await selectProofPacksOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    requestedIntents: intents
  }), compactProofIntentSelection(selectProofPacks({
    contract,
    requestedIntents: intents
  })));

  const descriptionInput = {
    profileId: "proof.result-shape.conformance",
    profileVersion: "1.0.0",
    requestedIntents: intents
  };
  const packageDescription = await describeProofPackAuthoring(descriptionInput);
  const description = await describeProofPackOperation(descriptionInput);
  for (const key of ["profile_id", "profile_version", "requested_intents",
    "intent_definitions", "intent_distinctions", "guarantee", "explicit_exclusions",
    "counts", "source_digests", "projection_digest", "authority"]) {
    assert.deepEqual(description[key], packageDescription[key], key);
  }
  assert.equal(Object.hasOwn(description, "proof_obligations"), false);

  const focusedContract = await json(
    "WK-2012-caller-substrate-refusal.controlled-acceptance.json"
  );
  const evaluationInput = await json(
    "WK-2012-caller-substrate-refusal.evaluation-input.json"
  );
  const inspectionIntents = ["controlled-proof-intent.refusal-before-effects"];
  const packageInspection = await inspectProofPackBindings({
    contract: focusedContract,
    profileId: "proof.authorization.refusal-before-effects",
    profileVersion: "1.0.0",
    requestedIntents: inspectionIntents,
    evaluationInput
  });
  const packagePage = await inspectProofPackBindingsPage({
    contract: focusedContract, profileId: "proof.authorization.refusal-before-effects",
    profileVersion: "1.0.0", requestedIntents: inspectionIntents,
    evaluationInput, maximumItems: 0
  });
  const inspection = await inspectProofPackBindingsOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus: "caller-substrate-refusal",
    evaluationFocus: "caller-substrate-refusal",
    profileId: "proof.authorization.refusal-before-effects",
    profileVersion: "1.0.0",
    requestedIntents: inspectionIntents
  });
  assert.equal(inspection.status, packageInspection.summary.status);
  assert.equal(inspection.digests.contract, packagePage.digests.contract);
  assert.equal(inspection.digests.evaluation_input, packagePage.digests.evaluation_input);
  assert.equal(inspection.digests.result, packagePage.digests.result);
  assert.equal(JSON.stringify(inspection).includes("compatible_candidates"), false);
});

test("selection candidate result preserves the package-authored projection exactly", async () => {
  const result = await selectProofPacksOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus: "proof-pack-selection-result-shape",
    requestedIntents: ["controlled-proof-intent.result-shape-conformance"]
  });
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), [
    "authoring_projection",
    "exact_binding_required",
    "explicit_exclusions",
    "guarantee",
    "intent_definitions",
    "intent_distinctions",
    "missing_compatible_reference_types",
    "profile_id",
    "profile_version",
    "requested_intents",
    "required_inputs",
    "source_digests"
  ].sort());
  assert.equal(Object.hasOwn(result.candidates[0], "applicability_claim"), false);
  assert.equal(Object.hasOwn(result.candidates[0], "authorization_claim"), false);
  assert.equal(JSON.stringify(result).includes("/home/"), false);
});

test("proof-plan construction is byte-structurally equal to the package function", async () => {
  const focus = "proof-pack-authoring-lossless";
  const contract = await json(`WK-2012-${focus}.controlled-acceptance.json`);
  const request = await json(`WK-2012-${focus}.proof-plan-request.json`);
  const evaluation = await json(`WK-2012-${focus}.evaluation-input.json`);
  const expected = await buildProofPlan({
    contract,
    request,
    evaluationInputs: {
      [request.selected_packs[0].evaluation_input_path]: evaluation
    }
  });
  const carrier = await readControlledContractCarrierOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus,
    carrierKind: "proof_plan"
  });
  const actual = await buildProofPlanOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: carrier.content_digest
  });
  assert.deepEqual(actual.plan, expected);
  assert.equal(actual.carrier.no_op, true);
});

test("assessment compact output and identities are identical to current WK-2003 and WK-2010 focused package assessments", async () => {
  for (const [wkId, focus] of [
    ["WK-2003", "exact-selector-refusal"],
    ["WK-2010", "dispatch-refusal"]
  ]) {
    const packageProjected = await assessProofPlanFiles({
      inputPath: path.join(CONTRACTS, `${wkId}-${focus}.controlled-acceptance.json`),
      proofPlanPath: path.join(CONTRACTS, `${wkId}-${focus}.proof-plan.json`)
    });
    const expected = compactMultiPackAssessment(packageProjected.assessment);
    const actual = await assessControlledContractOperation({ repoRoot: REPO, wkId, focus });
    assert.deepEqual(actual, expected, `${wkId}-${focus}`);
    assert.equal(actual.authority, "non_authoritative");
    assert.equal(actual.runtime_evidence, "not_assessed");
  }
});

test("oversized legacy assistance pages while complete validation-only compilation succeeds", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-scale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });
  const fixture = buildRefusalBeforeEffectsFixture();
  fixture.contract.references.push(...Array.from({ length: 900 }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      reference_id: `ref-scale-${suffix}`,
      type_term: "cc:operation",
      identity: {
        kind: "durable_id",
        domain: "proof-plan-scaling-regression",
        value: `resource-${suffix}`
      }
    };
  }));
  const focus = "scale";
  const contractName = `WK-2012-${focus}.controlled-acceptance.json`;
  const evaluationName = `WK-2012-${focus}.evaluation-input.json`;
  const requestName = `WK-2012-${focus}.proof-plan-request.json`;
  await writeFile(path.join(directory, contractName), `${JSON.stringify(fixture.contract, null, 2)}\n`);
  await writeFile(path.join(directory, evaluationName), `${JSON.stringify(fixture.input, null, 2)}\n`);
  await writeFile(path.join(directory, requestName), `${JSON.stringify({
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: ["controlled-proof-intent.refusal-before-effects"],
    selected_packs: [{
      profile_id: "proof.authorization.refusal-before-effects",
      profile_version: "1.0.0",
      evaluation_input_path: evaluationName
    }]
  }, null, 2)}\n`);

  const summary = await inspectProofPackBindingsOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    evaluationFocus: focus,
    profileId: "proof.authorization.refusal-before-effects",
    profileVersion: "1.0.0",
    requestedIntents: ["controlled-proof-intent.refusal-before-effects"]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(summary, null, 2)) <= 4096);
  const page = await inspectProofPackBindingsOperation({ repoRoot: root,
    wkId: "WK-2012", focus, evaluationFocus: focus,
    profileId: "proof.authorization.refusal-before-effects", profileVersion: "1.0.0",
    requestedIntents: ["controlled-proof-intent.refusal-before-effects"],
    roles: ["operation"] });
  assert.ok(page.returned_count > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= 16384);

  const built = await buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: null
  });
  assert.equal(built.plan.packs[0].profile_id, "proof.authorization.refusal-before-effects");
  assert.equal(built.carrier.written, true);

  const invalid = structuredClone(fixture.input);
  invalid.reference_bindings.find(({ role }) => role === "operation").reference_ids =
    ["ref-subject"];
  await writeFile(path.join(directory, evaluationName), `${JSON.stringify(invalid, null, 2)}\n`);
  const invalidInspection = await inspectProofPackBindingsOperation({ repoRoot: root,
    wkId: "WK-2012", focus, evaluationFocus: focus,
    profileId: "proof.authorization.refusal-before-effects", profileVersion: "1.0.0",
    roles: ["operation"] });
  assert.equal(invalidInspection.status, "invalid");
  assert.equal(invalidInspection.counts.incompatible, 1);
  assert.equal(await refusalCode(buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: built.carrier.content_digest
  })), "proof_plan_request_evaluation_input_invalid");
});

test("current WK-2003 and WK-2010 contracts remain canonical readable package inputs", async () => {
  for (const wkId of ["WK-2003", "WK-2010"]) {
    const carrier = await readControlledContractCarrierOperation({
      repoRoot: REPO,
      wkId,
      carrierKind: "contract"
    });
    assert.deepEqual(carrier.content, await json(`${wkId}.controlled-acceptance.json`));
    const selection = await selectProofPacksOperation({
      repoRoot: REPO,
      wkId,
      requestedIntents: ["controlled-proof-intent.implementation-readiness"]
    });
    assert.equal(selection.authority, "non_authoritative");
  }
});

test("unknown profiles and arbitrary pack locations fail without fallback", async () => {
  assert.equal(await refusalCode(describeProofPackOperation({
    profileId: "proof.unknown",
    profileVersion: "9.9.9"
  })), "proof_pack_authoring_identity_unknown");
  for (const key of ["profilePath", "packDirectory", "catalog", "module", "executable"]) {
    assert.equal(await refusalCode(describeProofPackOperation({
      profileId: "proof.result-shape.conformance",
      profileVersion: "1.0.0",
      [key]: "/tmp/forged"
    })), "controlled_contract_request_field_forbidden");
  }
});

test("the semantic engine is public and resolved as a wiki-core runtime dependency", async () => {
  const controlledPackage = JSON.parse(await readFile(path.join(
    REPO, "packages/controlled-contract/package.json"
  ), "utf8"));
  const wikiCorePackage = JSON.parse(await readFile(path.join(
    REPO, "packages/wiki-core/package.json"
  ), "utf8"));
  assert.equal(Object.hasOwn(controlledPackage, "private"), false);
  assert.equal(controlledPackage.version, "0.1.0");
  assert.equal(controlledPackage.publishConfig?.access, "public");
  assert.equal(
    wikiCorePackage.dependencies?.["@agent-chassis/controlled-contract"],
    "^0.1.0"
  );
  const operationSource = await readFile(path.join(
    REPO, "packages/wiki-core/src/operations/controlled-contract.mjs"
  ), "utf8");
  assert.equal(operationSource.includes("node:child_process"), false);
  assert.equal(operationSource.includes("/bin/"), false);
  assert.match(operationSource, /import\(CONTROLLED_CONTRACT_MODULE_SPECIFIER\)/u);
  assert.match(operationSource, /import\.meta\.resolve\(PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER\)/u);
  assert.equal(operationSource.includes("../../../controlled-contract"), false);
});
