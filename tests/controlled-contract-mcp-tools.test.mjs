import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034
} from "../packages/controlled-contract/current.mjs";
import {
  compactProofPackDescription,
  getControlledContractProjectionSpills
} from "../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";

import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  createControlledContractCarrierOperation,
  describeControlledContractAuthoringOperation,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  patchControlledContractCarrierOperation,
  queryControlledContractCarrierOperation,
  queryControlledVocabularyOperation,
  readControlledContractAssessmentArtifactOperation,
  readControlledContractCarrierOperation,
  selectProofPacksOperation,
  writeControlledContractCarrierOperation
} from "../packages/wiki-core/src/operations/controlled-contract.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");

async function fixtureRepo(files = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-tools-"));
  await mkdir(path.join(root, "wiki", "contracts"), { recursive: true });
  for (const file of files) {
    await cp(path.join(CONTRACTS, file), path.join(root, "wiki", "contracts", file));
  }
  return root;
}

async function rejectionCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.envelope?.warning?.payload?.reason_code ?? null;
  }
  assert.fail("operation should have refused");
}

function assertSelectedCounts(result) {
  assert.equal(result.requested_count, result.matched_count + result.missing_selector_count);
  assert.equal(result.matched_count,
    result.returned_count + result.byte_omitted_matched_count);
  assert.equal(result.missing_selector_count,
    result.missing_selector_returned_count + result.missing_selector_omitted_count);
}

test("canonical carrier read/write is deterministic, CAS-protected, and exact-target only", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = {
    input_version: "controlled-contract-verification-profile-input.experimental.v0.2",
    evaluation_stage: "pre_dispatch",
    reference_bindings: [],
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
  const write = await writeControlledContractCarrierOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus: "adapter-test",
    carrierKind: "evaluation_input",
    expectedContentDigest: null,
    content
  });
  assert.equal(write.written, true);
  assert.equal(write.filename, "WK-2012-adapter-test.evaluation-input.json");
  assert.deepEqual(await readdir(path.join(root, "wiki", "contracts")), [write.filename]);

  const read = await readControlledContractCarrierOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus: "adapter-test",
    carrierKind: "evaluation_input"
  });
  assert.deepEqual(read.content, content);
  assert.equal(read.content_digest, write.content_digest);

  assert.equal(await rejectionCode(writeControlledContractCarrierOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus: "adapter-test",
    carrierKind: "evaluation_input",
    expectedContentDigest: `sha256:${"0".repeat(64)}`,
    content: { ...content, evaluation_stage: "post_dispatch" }
  })), "controlled_contract_stale_content_digest");
  assert.deepEqual((await readControlledContractCarrierOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus: "adapter-test",
    carrierKind: "evaluation_input"
  })).content, content);
});

test("caller substrate and malformed stable identities refuse before repository reads", async () => {
  const missing = path.join(os.tmpdir(), "wk2012-repository-must-not-be-read");
  for (const input of [
    { repoRoot: missing, wkId: "../../WK-2012", carrierKind: "contract" },
    { repoRoot: missing, wkId: "/WK-2012", carrierKind: "contract" },
    { repoRoot: missing, wkId: "wk-2012", carrierKind: "contract" },
    { repoRoot: missing, wkId: "WK-2012", focus: "../escape", carrierKind: "contract" },
    { repoRoot: missing, wkId: "WK-2012", focus: "WK-2003", carrierKind: "contract" }
  ]) {
    assert.match(await rejectionCode(readControlledContractCarrierOperation(input)), /identity_invalid/u);
  }
  for (const key of [
    "path", "root", "cwd", "env", "module", "module_url", "executable",
    "package_directory", "profile_directory", "output_path", "artifact_uri", "catalog"
  ]) {
    const code = await rejectionCode(readControlledContractCarrierOperation({
      repoRoot: missing,
      wkId: "WK-2012",
      carrierKind: "contract",
      [key]: "forged"
    }));
    assert.equal(code, "controlled_contract_request_field_forbidden", key);
  }
});

test("carrier and artifact symlink escapes fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-symlink-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "wk2012-artifact-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "wk2012-outside-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(artifactRoot, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  await mkdir(path.join(root, "wiki"), { recursive: true });
  await symlink(outside, path.join(root, "wiki", "contracts"));
  assert.equal(await rejectionCode(readControlledContractCarrierOperation({
    repoRoot: root,
    wkId: "WK-2012",
    carrierKind: "contract"
  })), "controlled_contract_store_invalid");

  await mkdir(path.join(artifactRoot, "wiki", "contracts"), { recursive: true });
  const artifactStore = path.join(
    artifactRoot, ".cache", "controlled-contract", "assessments", "sha256"
  );
  await mkdir(artifactStore, { recursive: true });
  const identity = "a".repeat(64);
  await symlink(outside, path.join(artifactStore, identity));
  assert.equal(await rejectionCode(readControlledContractAssessmentArtifactOperation({
    repoRoot: artifactRoot,
    assessmentIdentity: identity,
    artifactFile: "manifest.json"
  })), "controlled_contract_artifact_store_escape");
});

test("every package-backed operation runs through canonical WK-2012 carriers", async () => {
  const vocabulary = await queryControlledVocabularyOperation({
    text: "reference:contains",
    kinds: ["operator"]
  });
  assert.equal(vocabulary.results[0].term, "reference:contains");

  const discovery = await discoverControlledProofIntentsOperation({
    query: "refusal before effects",
    limit: 5
  });
  assert.equal(discovery.authority, "non_authoritative");
  assert.ok(discovery.intents.some(({ intent_id: id }) =>
    id === "controlled-proof-intent.refusal-before-effects"));

  const selection = await selectProofPacksOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    requestedIntents: ["controlled-proof-intent.result-shape-conformance"]
  });
  assert.equal(selection.authority, "non_authoritative");
  assert.equal(selection.candidates[0].profile_id, "proof.result-shape.conformance");

  const description = await describeProofPackOperation({
    profileId: "proof.result-shape.conformance",
    profileVersion: "1.0.0",
    requestedIntents: ["controlled-proof-intent.result-shape-conformance"]
  });
  assert.equal(description.authority, "non_authoritative");
  assert.ok(description.detail_sections.includes("proof_obligations"));
  assert.equal(Object.hasOwn(description, "proof_obligations"), false);
  const detailed = await describeProofPackOperation({
    profileId: "proof.result-shape.conformance", profileVersion: "1.0.0",
    requestedIntents: ["controlled-proof-intent.result-shape-conformance"],
    sections: ["proof_obligations"], selectors: ["operation-returns-result"]
  });
  assert.equal(detailed.entries[0].selector, "operation-returns-result");

  const inspected = await inspectProofPackBindingsOperation({
    repoRoot: REPO,
    wkId: "WK-2012",
    focus: "caller-substrate-refusal",
    evaluationFocus: "caller-substrate-refusal",
    profileId: "proof.authorization.refusal-before-effects",
    profileVersion: "1.0.0",
    requestedIntents: ["controlled-proof-intent.refusal-before-effects"]
  });
  assert.equal(inspected.status, "valid");
  assert.equal(inspected.authority, "non_authoritative");
});

test("proof-plan build uses complete canonical inputs and writes only the exact plan carrier", async (t) => {
  const focus = "caller-substrate-refusal";
  const names = [
    `WK-2012-${focus}.controlled-acceptance.json`,
    `WK-2012-${focus}.evaluation-input.json`,
    `WK-2012-${focus}.proof-plan-request.json`,
    `WK-2012-${focus}.proof-plan.json`
  ];
  const root = await fixtureRepo(names);
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus, carrierKind: "proof_plan"
  });
  const built = await buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: before.content_digest
  });
  assert.equal(built.authority, "non_authoritative");
  assert.equal(built.carrier.no_op, true);
  assert.deepEqual((await readdir(path.join(root, "wiki", "contracts"))).sort(), names.sort());

  assert.equal(await rejectionCode(buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: `sha256:${"0".repeat(64)}`
  })), "controlled_contract_stale_content_digest");
  assert.deepEqual((await readdir(path.join(root, "wiki", "contracts"))).sort(), names.sort());

  const requestPath = path.join(root, "wiki", "contracts", names[2]);
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  request.selected_packs[0].evaluation_input_path = "../../outside.json";
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  assert.equal(await rejectionCode(buildProofPlanOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    expectedContentDigest: before.content_digest
  })), "controlled_contract_proof_input_path_forbidden");
});

test("assessment publishes only the package bundle and explicit retrieval is lossless", async (t) => {
  const focus = "caller-substrate-refusal";
  const names = [
    `WK-2012-${focus}.controlled-acceptance.json`,
    `WK-2012-${focus}.evaluation-input.json`,
    `WK-2012-${focus}.proof-plan.json`
  ];
  const root = await fixtureRepo(names);
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await rejectionCode(assessControlledContractOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus,
    output_path: "/tmp/forged"
  })), "controlled_contract_request_field_forbidden");
  assert.equal(await rejectionCode(readControlledContractAssessmentArtifactOperation({
    repoRoot: root,
    assessmentIdentity: "f".repeat(64),
    artifactFile: "manifest.json",
    artifact_uri: `controlled-contract-assessment://sha256/${"f".repeat(64)}/manifest.json`
  })), "controlled_contract_request_field_forbidden");
  assert.deepEqual(await readdir(root), ["wiki"]);
  const beforeContracts = await readdir(path.join(root, "wiki", "contracts"));
  const assessment = await assessControlledContractOperation({
    repoRoot: root,
    wkId: "WK-2012",
    focus
  });
  assert.equal(assessment.structure, "proven");
  assert.equal(assessment.profile_discrimination, "proven");
  assert.equal(assessment.runtime_evidence, "not_assessed");
  assert.equal(assessment.authority, "non_authoritative");
  assert.deepEqual(await readdir(path.join(root, "wiki", "contracts")), beforeContracts);
  const identity = assessment.artifact.match(/sha256\/([0-9a-f]{64})\//u)?.[1];
  assert.ok(identity);
  assert.deepEqual((await readdir(root)).sort(), [".cache", "wiki"]);
  assert.deepEqual((await readdir(path.join(
    root, ".cache", "controlled-contract", "assessments", "sha256", identity
  ))).sort(), [
    "assessment.json",
    "assessment.md",
    "manifest.json",
    "proof-packs.full.json",
    "structural.full.json"
  ]);

  const artifact = await readControlledContractAssessmentArtifactOperation({
    repoRoot: root,
    assessmentIdentity: identity,
    artifactFile: "proof-packs.full.json"
  });
  assert.equal(artifact.content_reference,
    `controlled-contract-assessment://sha256/${identity}/proof-packs.full.json`);
  assert.equal(artifact.content.assessment_identity, identity);
  assert.equal(await rejectionCode(readControlledContractAssessmentArtifactOperation({
    repoRoot: root,
    assessmentIdentity: identity,
    artifactFile: "../../manifest.json"
  })), "controlled_contract_artifact_file_invalid");
  assert.equal(await rejectionCode(readControlledContractAssessmentArtifactOperation({
    repoRoot: root,
    assessmentIdentity: "f".repeat(64),
    artifactFile: "manifest.json"
  })), "controlled_contract_artifact_not_found");
});

test("fresh bounded authoring creates a zero-pack root and never echoes a carrier", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const contract = JSON.parse(await readFile(path.join(
    CONTRACTS, "WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const created = await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: null, content: contract
  });
  assert.equal(created.validation_status, "valid");
  assert.equal(Object.hasOwn(created, "content"), false);
  const request = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: [], selected_packs: []
  };
  const requestCreated = await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan_request",
    expectedContentDigest: null, content: request
  });
  assert.equal(Object.hasOwn(requestCreated, "content"), false);
  const emptyIndex = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan_request"
  });
  assert.deepEqual([emptyIndex.population_total, emptyIndex.returned_count,
    emptyIndex.remaining_count, emptyIndex.continuation], [0, 0, 0, null]);
  const index = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  assert.ok(Buffer.byteLength(JSON.stringify(index, null, 2), "utf8") <= 4096);
  assert.equal(Object.hasOwn(index, "content"), false);
  const selected = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    selectors: [contract.references[0].reference_id]
  });
  assertSelectedCounts(selected);
  assert.deepEqual([selected.requested_count, selected.matched_count, selected.returned_count,
    selected.byte_omitted_matched_count, selected.missing_selector_count], [1, 1, 1, 0, 0]);
  assert.ok(Buffer.byteLength(JSON.stringify(selected, null, 2), "utf8") <= 16384);
  assert.equal(JSON.stringify(selected).includes(contract.claims[0].claim_id), false);
  const onePage = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    target: "references", filter: contract.references[0].reference_id
  });
  assert.deepEqual([onePage.matched_total, onePage.returned_count,
    onePage.remaining_count, onePage.continuation], [1, 1, 0, null]);

  const present = contract.references.slice(0, 2).map(({ reference_id: id }) => id);
  for (const [selectors, expected] of [
    [present, [2, 2, 2, 0, 0]],
    [[present[0], "ref-does-not-exist"], [2, 1, 1, 0, 1]],
    [["ref-missing-one", "ref-missing-two"], [2, 0, 0, 0, 2]]
  ]) {
    const result = await queryControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract", selectors
    });
    assertSelectedCounts(result);
    assert.deepEqual([result.requested_count, result.matched_count, result.returned_count,
      result.byte_omitted_matched_count, result.missing_selector_count], expected);
    assert.equal(result.missing_selectors.length, result.missing_selector_returned_count);
  }
  const longMissing = Array.from({ length: 64 }, (_, index) =>
    `missing-${index}-${"x".repeat(4085 - String(index).length)}`);
  const missingBounded = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", selectors: longMissing
  });
  assertSelectedCounts(missingBounded);
  assert.equal(missingBounded.missing_selector_count, 64);
  assert.ok(missingBounded.missing_selector_returned_count > 0);
  assert.ok(missingBounded.missing_selector_omitted_count > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(missingBounded, null, 2), "utf8") <= 16384);
  const built = await buildProofPlanOperation({
    repoRoot: root, wkId: "WK-2012", expectedContentDigest: null
  });
  assert.deepEqual(built.plan.packs, []);
  const assessed = await assessControlledContractOperation({ repoRoot: root, wkId: "WK-2012" });
  assert.equal(assessed.structure, "proven");
  assert.equal(assessed.selected_pack_count, 0);
  assert.equal(await rejectionCode(createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: null, content: contract
  })), "controlled_contract_stale_content_digest");
});

test("proof-plan request create and patch derive root and focused evaluation-input bindings", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceFocus = "caller-substrate-refusal";
  const contract = JSON.parse(await readFile(path.join(
    CONTRACTS, `WK-2012-${sourceFocus}.controlled-acceptance.json`
  ), "utf8"));
  const evaluation = JSON.parse(await readFile(path.join(
    CONTRACTS, `WK-2012-${sourceFocus}.evaluation-input.json`
  ), "utf8"));
  const request = JSON.parse(await readFile(path.join(
    CONTRACTS, `WK-2012-${sourceFocus}.proof-plan-request.json`
  ), "utf8"));
  delete request.selected_packs[0].evaluation_input_path;
  const intent = request.requested_intents[0];
  const selectedPack = request.selected_packs[0];
  const cases = [
    { wkId: "WK-1995", focus: null, mode: "create" },
    { wkId: "WK-2012", focus: "agent-authoring-ergonomics", mode: "create" },
    { wkId: "WK-2982", focus: null, mode: "patch" },
    { wkId: "WK-2983", focus: "agent-authoring-ergonomics", mode: "patch" }
  ];
  for (const { wkId, focus, mode } of cases) {
    const stem = focus === null ? wkId : `${wkId}-${focus}`;
    await writeFile(path.join(root, "wiki/contracts", `${stem}.controlled-acceptance.json`),
      `${JSON.stringify(contract, null, 2)}\n`);
    await writeFile(path.join(root, "wiki/contracts", `${stem}.evaluation-input.json`),
      `${JSON.stringify(evaluation, null, 2)}\n`);
    if (mode === "create") {
      await createControlledContractCarrierOperation({ repoRoot: root, wkId, focus,
        carrierKind: "proof_plan_request", expectedContentDigest: null, content: request });
    } else {
      const empty = await createControlledContractCarrierOperation({ repoRoot: root, wkId, focus,
        carrierKind: "proof_plan_request", expectedContentDigest: null,
        content: { schema_version: request.schema_version, requested_intents: [], selected_packs: [] } });
      await patchControlledContractCarrierOperation({ repoRoot: root, wkId, focus,
        carrierKind: "proof_plan_request", expectedContentDigest: empty.content_digest,
        operations: [
          { op: "upsert", target: "requested_intents", id: intent, value: intent },
          { op: "upsert", target: "selected_packs",
            id: `${selectedPack.profile_id}@${selectedPack.profile_version}`, value: selectedPack }
        ] });
    }
    const stored = await readControlledContractCarrierOperation({ repoRoot: root, wkId, focus,
      carrierKind: "proof_plan_request" });
    assert.equal(stored.content.selected_packs[0].evaluation_input_path,
      `${stem}.evaluation-input.json`);
    const built = await buildProofPlanOperation({ repoRoot: root, wkId, focus,
      expectedContentDigest: null });
    assert.deepEqual(built.plan.requested_intents, [intent]);
    assert.deepEqual(built.plan.packs.map(({ profile_id, profile_version }) =>
      `${profile_id}@${profile_version}`),
    [`${selectedPack.profile_id}@${selectedPack.profile_version}`]);
  }

  const prepare = async (wkId, { evaluationInput = true } = {}) => {
    await writeFile(path.join(root, "wiki/contracts", `${wkId}.controlled-acceptance.json`),
      `${JSON.stringify(contract, null, 2)}\n`);
    if (evaluationInput) await writeFile(path.join(root, "wiki/contracts", `${wkId}.evaluation-input.json`),
      `${JSON.stringify(evaluation, null, 2)}\n`);
  };
  await prepare("WK-2984", { evaluationInput: false });
  assert.equal(await rejectionCode(createControlledContractCarrierOperation({ repoRoot: root,
    wkId: "WK-2984", carrierKind: "proof_plan_request", expectedContentDigest: null,
    content: request })), "proof_plan_request_missing_inputs");
  assert.equal((await readdir(path.join(root, "wiki/contracts")))
    .includes("WK-2984.proof-plan-request.json"), false);

  await prepare("WK-2985");
  for (const evaluation_input_path of [
    "WK-2999.evaluation-input.json",
    "../WK-2985.evaluation-input.json",
    "/tmp/WK-2985.evaluation-input.json",
    "file:///tmp/WK-2985.evaluation-input.json"
  ]) {
    const invalid = structuredClone(request);
    invalid.selected_packs[0].evaluation_input_path = evaluation_input_path;
    assert.equal(await rejectionCode(createControlledContractCarrierOperation({ repoRoot: root,
      wkId: "WK-2985", carrierKind: "proof_plan_request", expectedContentDigest: null,
      content: invalid })), "controlled_contract_proof_input_path_forbidden");
  }
  assert.equal((await readdir(path.join(root, "wiki/contracts")))
    .includes("WK-2985.proof-plan-request.json"), false);

  await prepare("WK-2986");
  const empty = await createControlledContractCarrierOperation({ repoRoot: root, wkId: "WK-2986",
    carrierKind: "proof_plan_request", expectedContentDigest: null,
    content: { schema_version: request.schema_version, requested_intents: [], selected_packs: [] } });
  const invalidPack = { ...selectedPack,
    evaluation_input_path: "../WK-2986.evaluation-input.json" };
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({ repoRoot: root,
    wkId: "WK-2986", carrierKind: "proof_plan_request",
    expectedContentDigest: empty.content_digest,
    operations: [
      { op: "upsert", target: "selected_packs",
        id: `${selectedPack.profile_id}@${selectedPack.profile_version}`, value: invalidPack },
      { op: "remove", target: "selected_packs",
        id: `${selectedPack.profile_id}@${selectedPack.profile_version}` }
    ] })), "controlled_contract_proof_input_path_forbidden");
  assert.equal((await readControlledContractCarrierOperation({ repoRoot: root, wkId: "WK-2986",
    carrierKind: "proof_plan_request" })).content_digest, empty.content_digest);
});

test("fresh-session target pages enumerate all 167 root nodes and bind every cursor input", async (t) => {
  const root = await fixtureRepo([
    "WK-2012.controlled-acceptance.json",
    "WK-2012-agent-authoring-ergonomics.controlled-acceptance.json"
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const selectors = []; let cursor = null; let firstCursor;
  do {
    const page = await queryControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract", cursor
    });
    assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= 4096);
    assert.equal(page.population_total, 167);
    assert.equal(page.matched_total, 167);
    assert.equal(page.returned_count + page.remaining_count + selectors.length, 167);
    firstCursor ??= page.continuation;
    selectors.push(...page.items.map(({ selector }) => selector));
    cursor = page.continuation;
  } while (cursor !== null);
  assert.equal(selectors.length, 167);
  assert.equal(new Set(selectors).size, 167);
  const references = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", target: "references"
  });
  assert.equal(references.matched_total, references.population_by_target.references);
  const filtered = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", filter: "carrier-query"
  });
  assert.ok(filtered.items.every(({ id }) => id.includes("carrier-query")));
  for (const extra of [
    { target: "claims" }, { filter: "other" }, { focus: "agent-authoring-ergonomics" }
  ]) assert.equal(await rejectionCode(queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", cursor: firstCursor, ...extra
  })), "controlled_contract_query_cursor_mismatch");

  const carrier = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [{ op: "upsert", target: "annotations", id: "ann-cursor-stale",
      value: { annotation_id: "ann-cursor-stale", kind: "provenance", text: "cursor" } }]
  });
  assert.equal(await rejectionCode(queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", cursor: firstCursor
  })), "controlled_contract_query_cursor_mismatch");
});

test("oversized carrier identities and proof details page with deterministic lossless progress", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const positions = {
    first: ["res-a-oversized-", "res-z"],
    middle: ["res-a", "res-m-oversized-", "res-z"],
    final: ["res-a", "res-z-oversized-"]
  };
  const traces = {};
  let caseIndex = 0;
  for (const [position, prefixes] of Object.entries(positions)) {
    const wkId = `WK-${2970 + caseIndex}`;
    caseIndex += 1;
    const expected = prefixes.map((prefix) => prefix.includes("oversized")
      ? `${prefix}${"x".repeat(5000)}` : prefix).sort();
    await writeFile(path.join(root, "wiki/contracts", `${wkId}.controlled-acceptance.json`),
      `${JSON.stringify({ residue: expected.map((residue_id) =>
        ({ residue_id, reason: "review_only", text: "x" })) }, null, 2)}\n`);
    const recovered = []; const trace = []; let cursor = null;
    do {
      const supplied = cursor;
      const page = await queryControlledContractCarrierOperation({ repoRoot: root, wkId,
        carrierKind: "contract", target: "residue", cursor });
      assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= 4096);
      assert.ok(page.returned_count > 0);
      cursor = page.continuation;
      if (cursor !== null) assert.notEqual(cursor, supplied);
      for (let index = 0; index < page.items.length; index += 1) {
        const item = page.items[index];
        if (item.item_spilled === true) {
          const spill = getControlledContractProjectionSpills(page)
            .find((candidate) => candidate.collection === "items" && candidate.index === index);
          assert.ok(spill);
          recovered.push(spill.value.selector);
        } else recovered.push(item.selector);
      }
      trace.push({ returned: page.returned_count, remaining: page.remaining_count,
        continuation_offset: cursor === null ? null
          : JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).offset,
        spilled: page.items.some(({ item_spilled }) => item_spilled === true) });
    } while (cursor !== null);
    assert.deepEqual(recovered, expected);
    assert.equal(new Set(recovered).size, expected.length);
    traces[position] = trace;
  }

  const makeDescription = (entries) => ({
    profile_id: "proof.pagination.repro", profile_version: "1.0.0",
    requested_intents: [], intent_definitions: [], intent_distinctions: [], guarantee: {},
    explicit_exclusions: [], evaluation_input_skeleton: { allowed_evaluation_stages: [] },
    counts: {}, source_digests: {}, projection_digest: `sha256:${"a".repeat(64)}`,
    authority: "non_authoritative", compatibility: [], role_constraints: [],
    proof_obligations: entries
  });
  for (const [position, prefixes] of Object.entries(positions)) {
    const expected = prefixes.map((prefix) => prefix.includes("oversized")
      ? `${prefix}${"x".repeat(18000)}` : prefix);
    const full = makeDescription(expected.map((pattern_id) => ({ pattern_id, text: "x" })));
    const recovered = []; let cursor = null;
    do {
      const supplied = cursor;
      const page = compactProofPackDescription(full, {
        sections: ["proof_obligations"], cursor
      });
      assert.ok(Buffer.byteLength(JSON.stringify(page, null, 2)) <= 16384);
      assert.ok(page.returned_count > 0);
      cursor = page.continuation;
      if (cursor !== null) assert.notEqual(cursor, supplied);
      for (let index = 0; index < page.entries.length; index += 1) {
        const entry = page.entries[index];
        if (entry.entry_spilled === true) {
          const spill = getControlledContractProjectionSpills(page)
            .find((candidate) => candidate.collection === "entries" && candidate.index === index);
          assert.ok(spill);
          recovered.push(spill.value.selector);
        } else recovered.push(entry.selector);
      }
    } while (cursor !== null);
    assert.deepEqual(recovered, expected);
    assert.equal(new Set(recovered).size, expected.length);
  }
  t.diagnostic(`oversized carrier cursor traces ${JSON.stringify(traces)}`);
});

test("package-backed authoring descriptions cover every mutable family with valid bounded templates", async () => {
  const requestSchema = JSON.parse(await readFile(path.join(
    REPO, "packages/controlled-contract/schema/controlled-contract-proof-plan-request.v1.schema.json"
  ), "utf8"));
  const schemas = { contract: NATIVE_CONTRACT_SCHEMA_V034,
    evaluation_input: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
    proof_plan_request: requestSchema };
  const targets = {
    contract: ["references", "propositions", "claims", "relations", "collections", "residue", "annotations"],
    evaluation_input: ["reference_bindings", "number_bindings", "claim_pattern_bindings",
      "resolver_facts", "delivered_evidence", "evaluation_stage"],
    proof_plan_request: ["requested_intents", "selected_packs"]
  };
  for (const [carrierKind, carrierTargets] of Object.entries(targets)) {
    const compact = await describeControlledContractAuthoringOperation({ carrierKind });
    assert.deepEqual(compact.targets.map(({ target }) => target), carrierTargets);
    assert.ok(Buffer.byteLength(JSON.stringify(compact, null, 2)) <= 4096);
    for (const target of carrierTargets) {
      const detail = await describeControlledContractAuthoringOperation({ carrierKind, target });
      assert.ok(Buffer.byteLength(JSON.stringify(detail, null, 2)) <= 16384, `${carrierKind}:${target}`);
      const source = schemas[carrierKind].properties[target];
      const resolved = source.$ref ? schemas[carrierKind].$defs[source.$ref.split("/").at(-1)] : source;
      const validate = new Ajv2020({ strict: false }).compile({
        ...(resolved.items ?? resolved), $defs: schemas[carrierKind].$defs
      });
      assert.equal(validate(detail.minimal_valid_template), true,
        `${carrierKind}:${target} ${JSON.stringify(validate.errors)}`);
      if (carrierKind === "proof_plan_request" && target === "selected_packs") {
        assert.deepEqual(detail.server_derived_fields, [{ field: "evaluation_input_path",
          derivation: "canonical evaluation-input carrier basename from wk_id and optional focus",
          caller_authored: false }]);
        assert.equal(Object.hasOwn(detail.minimal_valid_template, "evaluation_input_path"), false);
      }
    }
  }
});

test("proof-plan metadata recovers absent, current, and stale digests without plan content", async (t) => {
  const files = ["WK-2012.controlled-acceptance.json", "WK-2012.proof-plan-request.json",
    "WK-2012.proof-plan.json"];
  const root = await fixtureRepo(files);
  t.after(() => rm(root, { recursive: true, force: true }));
  const absentRoot = await fixtureRepo(files.slice(0, 2));
  t.after(() => rm(absentRoot, { recursive: true, force: true }));
  const absent = await queryControlledContractCarrierOperation({
    repoRoot: absentRoot, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.deepEqual([absent.exists, absent.content_digest, absent.source_binding_status],
    [false, null, "absent"]);
  const current = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.equal(current.exists, true);
  assert.equal(current.source_binding_status, "current");
  assert.match(current.content_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(current, "content"), false);
  const contract = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: contract.content_digest,
    operations: [{ op: "upsert", target: "annotations", id: "ann-plan-stale",
      value: { annotation_id: "ann-plan-stale", kind: "provenance", text: "stale" } }]
  });
  const stale = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan"
  });
  assert.equal(stale.source_binding_status, "stale");
  assert.equal(stale.rebuild_expected_content_digest, current.content_digest);
  assert.equal(Object.hasOwn(stale, "content"), false);
});

test("typed patch families validate the prospective graph and refuse without mutation", async (t) => {
  const files = [
    "WK-2012.controlled-acceptance.json",
    "WK-2012-implementation-readiness.controlled-acceptance.json",
    "WK-2012-implementation-readiness.evaluation-input.json",
    "WK-2012-implementation-readiness.proof-plan-request.json"
  ];
  const root = await fixtureRepo(files);
  t.after(() => rm(root, { recursive: true, force: true }));
  const contract = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  const families = [
    ["references", "reference_id", contract.content.references[0]],
    ["propositions", "proposition_id", contract.content.propositions[0]],
    ["claims", "claim_id", contract.content.claims[0]],
    ["relations", "relation_id", contract.content.relations[0]],
    ["residue", "residue_id", contract.content.residue[0]],
    ["collections", "collection_id", { collection_id: "set-patch-test",
      collection_kind: "closed_set", member_claim_ids: [contract.content.claims[0].claim_id] }],
    ["annotations", "annotation_id", { annotation_id: "ann-patch-test",
      kind: "provenance", text: "patch test" }]
  ];
  const operations = families.flatMap(([target, key, source]) => {
    const value = { ...source, [key]: `${source[key]}-patch-test` };
    return [{ op: "upsert", target, id: value[key], value },
      { op: "remove", target, id: value[key] }];
  });
  const receipt = await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: contract.content_digest, operations
  });
  assert.equal(receipt.content_digest, contract.content_digest);
  assert.equal(Object.hasOwn(receipt, "content"), false);
  assert.deepEqual(receipt.changed, {});
  assert.deepEqual([receipt.written, receipt.no_op], [false, true]);
  assert.deepEqual(receipt.invalidation, { proof_plan: "unchanged", assessment: "unchanged" });

  const evaluation = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus: "implementation-readiness",
    carrierKind: "evaluation_input"
  });
  const binding = evaluation.content.reference_bindings[0];
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus: "implementation-readiness",
    carrierKind: "evaluation_input", expectedContentDigest: evaluation.content_digest,
    operations: [{ op: "upsert", target: "reference_bindings",
      id: binding.role, value: binding }]
  });
  const standaloneEvaluation = {
    input_version: "controlled-contract-verification-profile-input.experimental.v0.2",
    evaluation_stage: "pre_dispatch", reference_bindings: [], number_bindings: [],
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: []
  };
  const standalone = await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2996", carrierKind: "evaluation_input",
    expectedContentDigest: null, content: standaloneEvaluation
  });
  const resolver = { resolver_kind: "test-resolver", fact_key: "test-fact",
    argument_reference_ids: ["ref-example"], satisfied: true };
  const evaluationValues = [
    ["reference_bindings", "reference_role", { role: "reference_role", reference_ids: ["ref-example"] }],
    ["number_bindings", "number_role", { role: "number_role", value: 1 }],
    ["claim_pattern_bindings", "pattern-example=>claim-example",
      { pattern_id: "pattern-example", claim_id: "claim-example" }],
    ["resolver_facts", Buffer.from(JSON.stringify([resolver.resolver_kind, resolver.fact_key,
      resolver.argument_reference_ids])).toString("base64url"), resolver],
    ["delivered_evidence", "test-evidence=>claim-example",
      { evidence_kind: "test-evidence", verification_claim_id: "claim-example", satisfied: true }],
    ["evaluation_stage", "evaluation_stage", "post_delivery"]
  ];
  const evaluationChanged = await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2996", carrierKind: "evaluation_input",
    expectedContentDigest: standalone.content_digest,
    operations: evaluationValues.map(([target, id, value]) => ({ op: "upsert", target, id, value }))
  });
  const selectedEvaluation = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2996", carrierKind: "evaluation_input",
    selectors: evaluationValues.map(([, id]) => id)
  });
  assertSelectedCounts(selectedEvaluation);
  assert.equal(selectedEvaluation.returned_count, evaluationValues.length);
  const evaluationRemoved = await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2996", carrierKind: "evaluation_input",
    expectedContentDigest: evaluationChanged.content_digest,
    operations: [...evaluationValues.slice(0, -1).map(([target, id]) => ({ op: "remove", target, id })),
      { op: "upsert", target: "evaluation_stage", id: "evaluation_stage", value: "pre_dispatch" }]
  });
  assert.notEqual(evaluationRemoved.content_digest, evaluationChanged.content_digest);
  const request = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus: "implementation-readiness",
    carrierKind: "proof_plan_request"
  });
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus: "implementation-readiness",
    carrierKind: "proof_plan_request", expectedContentDigest: request.content_digest,
    operations: [
      { op: "upsert", target: "requested_intents", id: "controlled-proof-intent.temporary", value: "controlled-proof-intent.temporary" },
      { op: "remove", target: "requested_intents", id: "controlled-proof-intent.temporary" },
      { op: "upsert", target: "selected_packs", id: "proof.temporary@1.0.0",
        value: { profile_id: "proof.temporary", profile_version: "1.0.0" } },
      { op: "remove", target: "selected_packs", id: "proof.temporary@1.0.0" }
    ]
  });
  const requestSelected = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", focus: "implementation-readiness",
    carrierKind: "proof_plan_request", selectors: [request.content.requested_intents[0],
      `${request.content.selected_packs[0].profile_id}@${request.content.selected_packs[0].profile_version}`]
  });
  assert.deepEqual(requestSelected.items.map(({ target }) => target),
    ["requested_intents", "selected_packs"]);

  const before = await readFile(path.join(root, "wiki/contracts/WK-2012.controlled-acceptance.json"));
  for (const attempted of [
    { expectedContentDigest: `sha256:${"0".repeat(64)}`, operations: [] },
    { expectedContentDigest: contract.content_digest, operations: Array.from({ length: 65 }, (_, index) =>
      ({ op: "remove", target: "references", id: `ref-limit-${index}` })) },
    { expectedContentDigest: contract.content_digest,
      operations: [{ op: "remove", target: "references", id: contract.content.references[0].reference_id }] }
  ]) await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract", ...attempted
  }));
  assert.deepEqual(await readFile(path.join(root, "wiki/contracts/WK-2012.controlled-acceptance.json")), before);
  assert.equal(await rejectionCode(queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    selectors: Array.from({ length: 65 }, (_, index) => `ref-${index}`)
  })), "controlled_contract_query_selectors_invalid");
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "proof_plan",
    expectedContentDigest: contract.content_digest, operations: []
  })), "controlled_contract_carrier_write_forbidden");
});

test("patch receipts compare only the final carrier and skip every net-no-op write", async (t) => {
  const root = await fixtureRepo(["WK-2012.controlled-acceptance.json"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const carrier = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract"
  });
  const reference = carrier.content.references[0];
  const temporary = { ...reference, reference_id: "ref-temporary-net-no-op" };
  const replacement = { ...reference, identity: { ...reference.identity, value: "temporary" } };
  const file = path.join(root, "wiki/contracts/WK-2012.controlled-acceptance.json");
  const before = await stat(file, { bigint: true });
  for (const operations of [
    [{ op: "upsert", target: "references", id: temporary.reference_id, value: temporary },
      { op: "remove", target: "references", id: temporary.reference_id }],
    [{ op: "remove", target: "references", id: reference.reference_id },
      { op: "upsert", target: "references", id: reference.reference_id, value: reference }],
    [{ op: "upsert", target: "references", id: reference.reference_id, value: replacement },
      { op: "upsert", target: "references", id: reference.reference_id, value: reference }]
  ]) {
    const receipt = await patchControlledContractCarrierOperation({
      repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
      expectedContentDigest: carrier.content_digest, operations
    });
    assert.deepEqual(receipt.changed, {});
    assert.deepEqual([receipt.prior_content_digest, receipt.content_digest],
      [carrier.content_digest, carrier.content_digest]);
    assert.deepEqual([receipt.written, receipt.no_op], [false, true]);
    assert.deepEqual(receipt.invalidation, { proof_plan: "unchanged", assessment: "unchanged" });
  }
  assert.equal((await stat(file, { bigint: true })).mtimeNs, before.mtimeNs);

  const residue = carrier.content.residue[0];
  const changed = await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2012", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [
      { op: "upsert", target: "references", id: temporary.reference_id, value: temporary },
      { op: "upsert", target: "residue", id: residue.residue_id,
        value: { ...residue, text: `${residue.text} Final-diff regression.` } },
      { op: "remove", target: "references", id: temporary.reference_id }
    ]
  });
  assert.deepEqual(changed.changed, { residue: [residue.residue_id] });
  assert.deepEqual([changed.written, changed.no_op], [true, false]);
  assert.deepEqual(changed.invalidation, { proof_plan: "stale", assessment: "stale" });
});

test("bounded authoring enforces every count and UTF-8 byte boundary atomically", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(path.join(
    CONTRACTS, "WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const padded = structuredClone(source);
  padded.residue.push({ residue_id: "res-byte-limit", reason: "review_only", text: "x" });
  const fileBytes = (value) => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  padded.residue.at(-1).text += "x".repeat(1024 * 1024 - fileBytes(padded));
  assert.equal(fileBytes(padded), 1024 * 1024);
  await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: null, content: padded
  });
  const oversized = structuredClone(padded);
  oversized.residue.at(-1).text += "x";
  assert.equal(await rejectionCode(createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2999", carrierKind: "contract",
    expectedContentDigest: null, content: oversized
  })), "controlled_contract_json_too_large");
  assert.equal((await readdir(path.join(root, "wiki", "contracts"))).length, 1);
  const omitted = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    selectors: ["res-byte-limit"]
  });
  assertSelectedCounts(omitted);
  assert.deepEqual([omitted.matched_count, omitted.returned_count,
    omitted.byte_omitted_matched_count], [1, 1, 0]);
  assert.equal(omitted.items[0].value_spilled, true);
  assert.ok(Buffer.byteLength(JSON.stringify(omitted, null, 2), "utf8") <= 16384);

  const carrier = await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract"
  });
  const sizedOperation = (bytes) => {
    const operation = { op: "upsert", target: "references", id: "ref-op-limit",
      value: { reference_id: "ref-op-limit", type_term: "cc:artifact",
        identity: { kind: "durable_id", domain: "limit", value: "x" } } };
    operation.value.identity.value += "x".repeat(bytes - Buffer.byteLength(JSON.stringify(operation)));
    assert.equal(Buffer.byteLength(JSON.stringify(operation)), bytes);
    return operation;
  };
  const exactOperation = sizedOperation(16384);
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [exactOperation, { op: "remove", target: "references", id: "ref-op-limit" }]
  });
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [sizedOperation(16385)]
  })), "controlled_contract_patch_operation_too_large");
  const sixtyFour = Array.from({ length: 64 }, (_, index) =>
    ({ op: "remove", target: "references", id: `ref-count-${index}` }));
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest, operations: sixtyFour
  });
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest,
    operations: [...sixtyFour, { op: "remove", target: "references", id: "ref-count-64" }]
  })), "controlled_contract_patch_request_too_large");
  await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    selectors: Array.from({ length: 64 }, (_, index) => `ref-count-${index}`)
  });
  assert.equal(await rejectionCode(queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    selectors: Array.from({ length: 65 }, (_, index) => `ref-count-${index}`)
  })), "controlled_contract_query_selectors_invalid");

  const totalOperations = Array.from({ length: 4 }, (_, index) =>
    ({ op: "remove", target: "references", id: `ref-total-${index}-x` }));
  const requestSize = (operations) => Buffer.byteLength(JSON.stringify({
    wk_id: "WK-2998", focus: null, carrier_kind: "contract",
    expected_content_digest: carrier.content_digest, operations
  }));
  let remaining = 65536 - requestSize(totalOperations);
  for (const operation of totalOperations) {
    const available = 16384 - Buffer.byteLength(JSON.stringify(operation));
    const added = Math.min(available, remaining);
    operation.id += "x".repeat(added);
    remaining -= added;
  }
  assert.equal(remaining, 0);
  assert.equal(requestSize(totalOperations), 65536);
  assert.ok(totalOperations.every((operation) =>
    Buffer.byteLength(JSON.stringify(operation)) <= 16384));
  await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest, operations: totalOperations
  });
  totalOperations[3].id += "x";
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract",
    expectedContentDigest: carrier.content_digest, operations: totalOperations
  })), "controlled_contract_patch_request_too_large");
  assert.equal((await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2998", carrierKind: "contract"
  })).content_digest, carrier.content_digest);

  const small = await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2997", carrierKind: "contract",
    expectedContentDigest: null, content: source
  });
  const receiptTemplate = (id) => ({
    changed: { residue: [id] }, prior_content_digest: small.content_digest,
    content_digest: `sha256:${"0".repeat(64)}`, validation_status: "valid",
    written: true, no_op: false,
    invalidation: { proof_plan: "stale", assessment: "stale" }
  });
  let receiptId = "res-receipt-limit-";
  receiptId += "x".repeat(8192 - Buffer.byteLength(JSON.stringify(receiptTemplate(receiptId))));
  const exactReceipt = await patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2997", carrierKind: "contract",
    expectedContentDigest: small.content_digest,
    operations: [{ op: "upsert", target: "residue", id: receiptId,
      value: { residue_id: receiptId, reason: "review_only", text: "limit" } }]
  });
  assert.equal(Buffer.byteLength(JSON.stringify(exactReceipt)), 8192);
  const afterReceipt = exactReceipt.content_digest;
  const overReceiptId = `${receiptId}x`;
  assert.equal(await rejectionCode(patchControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2997", carrierKind: "contract",
    expectedContentDigest: afterReceipt,
    operations: [{ op: "upsert", target: "residue", id: overReceiptId,
      value: { residue_id: overReceiptId, reason: "review_only", text: "limit" } }]
  })), "controlled_contract_patch_receipt_too_large");
  assert.equal((await readControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2997", carrierKind: "contract"
  })).content_digest, afterReceipt);
});

test("selected-node inline projection accepts exactly 16,384 bytes and spills one byte over", async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(path.join(
    CONTRACTS, "WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const withText = (length) => {
    const content = structuredClone(source);
    content.residue.push({ residue_id: "res-selected-boundary", reason: "review_only",
      text: "x".repeat(length) });
    return content;
  };
  const seed = await createControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2991", carrierKind: "contract",
    expectedContentDigest: null, content: withText(1)
  });
  const seedResult = await queryControlledContractCarrierOperation({
    repoRoot: root, wkId: "WK-2991", carrierKind: "contract",
    selectors: ["res-selected-boundary"]
  });
  const padding = 16384 - Buffer.byteLength(JSON.stringify(seedResult, null, 2));
  assert.ok(padding > 0);
  for (const [wkId, length, expectedSpill] of [
    ["WK-2990", padding + 1, false], ["WK-2989", padding + 2, true]
  ]) {
    await createControlledContractCarrierOperation({ repoRoot: root, wkId,
      carrierKind: "contract", expectedContentDigest: null, content: withText(length) });
    const result = await queryControlledContractCarrierOperation({ repoRoot: root, wkId,
      carrierKind: "contract", selectors: ["res-selected-boundary"] });
    if (expectedSpill) {
      assert.equal(result.items[0].value_spilled, true);
      assert.ok(Buffer.byteLength(JSON.stringify(result, null, 2)) < 16384);
    } else {
      assert.equal(Buffer.byteLength(JSON.stringify(result, null, 2)), 16384);
      assert.equal(Object.hasOwn(result.items[0], "value"), true);
    }
    assertSelectedCounts(result);
  }
  assert.match(seed.content_digest, /^sha256:/u);
});
