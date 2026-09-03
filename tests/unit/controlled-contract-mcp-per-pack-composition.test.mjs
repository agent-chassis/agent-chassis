import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  createControlledContractCarrierOperation,
  inspectProofPackBindingsOperation,
  patchControlledContractCarrierOperation,
  queryControlledContractCarrierOperation,
  readControlledContractCarrierOperation,
  writeControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  controlledContractCarrierFilename,
  controlledContractPackCarrierFilename,
  withCanonicalControlledContractSourceLease,
  writeControlledContractCarrierSet
} from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const SOURCE = path.join(REPO, "wiki", "contracts");

const FIXTURE_WK = "WK-2327";

const FOREIGN_WK = "WK-2064";
const VALIDITY_PACK = Object.freeze({
  profileId: "proof.verification.test-validity",
  profileVersion: "2.0.0"
});
const FORBIDDEN_PACK = Object.freeze({
  profileId: "proof.operation.forbidden-noninvocation",
  profileVersion: "2.0.0"
});
const UNSELECTED_PACK = Object.freeze({
  profileId: "proof.scope.write-confinement",
  profileVersion: "2.0.0"
});
const VALIDITY_INTENT = "controlled-proof-intent.test-verification-validity";
const FORBIDDEN_INTENT = "controlled-proof-intent.forbidden-operation-noninvocation";

async function json(filename) {
  return JSON.parse(await readFile(path.join(SOURCE, filename), "utf8"));
}

async function fixture(t, focus = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stable-v1-per-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "wiki", "contracts");
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  await writeFile(path.join(root, "wiki", "work-records", `${FIXTURE_WK}.json`),
    await readFile(path.join(REPO, "wiki", "work-records", `${FIXTURE_WK}.json`)));
  const stem = focus === null ? FIXTURE_WK : `${FIXTURE_WK}-${focus}`;
  const contract = await json(`${FIXTURE_WK}.controlled-acceptance.json`);
  await writeFile(path.join(directory, `${stem}.controlled-acceptance.json`),
    `${JSON.stringify(contract, null, 2)}\n`);
  return {
    root,
    directory,
    contract,
    validityInput: await json(controlledContractPackCarrierFilename({
      wkId: FIXTURE_WK, ...VALIDITY_PACK
    })),
    forbiddenInput: await json(controlledContractPackCarrierFilename({
      wkId: FIXTURE_WK, ...FORBIDDEN_PACK
    }))
  };
}

async function carrierBasenames(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return [...new Set(entries.filter((entry) => entry.isFile()).map(({ name }) => name))];
}

function operationIdentity({ root, wkId, focus = null }, pack, carrierKind = "evaluation_input") {
  return {
    repoRoot: root,
    wkId,
    focus,
    carrierKind,
    profileId: pack.profileId,
    profileVersion: pack.profileVersion
  };
}

function request(selectedPacks = [VALIDITY_PACK, FORBIDDEN_PACK]) {
  return {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: [VALIDITY_INTENT, FORBIDDEN_INTENT],
    selected_packs: selectedPacks.map(({ profileId, profileVersion }) => ({
      profile_id: profileId,
      profile_version: profileVersion
    }))
  };
}

async function refusalCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.envelope?.warning?.payload?.reason_code ?? null;
  }
  assert.fail("operation should refuse");
}

test("exact per-pack carriers compose both WK-2327 proof packs deterministically", async (t) => {
  const wkId = FIXTURE_WK;
  const setup = await fixture(t);
  const validityIdentity = operationIdentity({ ...setup, wkId }, VALIDITY_PACK);
  const forbiddenIdentity = operationIdentity({ ...setup, wkId }, FORBIDDEN_PACK);

  const validityCreate = await createControlledContractCarrierOperation({
    ...validityIdentity,
    expectedContentDigest: null,
    content: setup.validityInput
  });
  const forbiddenCreate = await createControlledContractCarrierOperation({
    ...forbiddenIdentity,
    expectedContentDigest: null,
    content: setup.forbiddenInput
  });
  const validityFilename = controlledContractPackCarrierFilename({ wkId, ...VALIDITY_PACK });
  const forbiddenFilename = controlledContractPackCarrierFilename({ wkId, ...FORBIDDEN_PACK });
  assert.equal(validityCreate.content_digest.startsWith("sha256:"), true);
  assert.equal(forbiddenCreate.content_digest.startsWith("sha256:"), true);
  assert.notEqual(validityFilename, forbiddenFilename);
  assert.match(validityFilename,
    new RegExp(`^${FIXTURE_WK}\\.pack-sha256-[0-9a-f]{64}\\.evaluation-input\\.json$`, "u"));
  assert.deepEqual((await carrierBasenames(setup.directory)).filter((name) =>
    name.includes(".pack-sha256-")).sort(), [forbiddenFilename, validityFilename].sort());

  const validityQuery = await queryControlledContractCarrierOperation({
    ...validityIdentity,
    selectors: ["component"]
  });
  assert.equal(validityQuery.items[0].value.role, "component");
  const forbiddenInspection = await inspectProofPackBindingsOperation({
    repoRoot: setup.root,
    wkId,
    evaluationFocus: null,
    ...FORBIDDEN_PACK,
    requestedIntents: [FORBIDDEN_INTENT]
  });
  assert.equal(forbiddenInspection.status, "valid");
  assert.equal(forbiddenInspection.diagnostic_total, 0);

  const createdRequest = await createControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: request()
  });
  const storedRequest = await readControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan_request"
  });
  assert.deepEqual(storedRequest.content.selected_packs.map(({ evaluation_input_path }) =>
    evaluation_input_path).sort(), [forbiddenFilename, validityFilename].sort());

  const built = await buildProofPlanOperation({
    repoRoot: setup.root,
    wkId,
    expectedContentDigest: null
  });
  assert.deepEqual(built.plan.packs.map(({ profile_id, profile_version }) =>
    `${profile_id}@${profile_version}`), [
    `${FORBIDDEN_PACK.profileId}@${FORBIDDEN_PACK.profileVersion}`,
    `${VALIDITY_PACK.profileId}@${VALIDITY_PACK.profileVersion}`
  ]);
  assert.notEqual(built.plan.packs[0].source_digests.evaluation_input,
    built.plan.packs[1].source_digests.evaluation_input);
  const metadata = await queryControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan"
  });
  assert.equal(metadata.source_binding_status, "current");

  const evidence = {
    evidence_kind: "test-execution",
    verification_claim_id: "claim-verify-result-shape",
    satisfied: true
  };
  const patched = await patchControlledContractCarrierOperation({
    ...validityIdentity,
    expectedContentDigest: validityCreate.content_digest,
    operations: [{
      op: "upsert",
      target: "delivered_evidence",
      id: `${evidence.evidence_kind}=>${evidence.verification_claim_id}`,
      value: evidence
    }]
  });
  assert.equal(patched.written, true);
  const stale = await queryControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan"
  });

  assert.equal(stale.exists, false);
  assert.equal(stale.source_binding_status, "absent");
  assert.deepEqual(stale.next_calls, [{
    tool: "workspace_controlled_proof_plan_build",
    arguments: { wk_id: wkId, expected_content_digest: null },
    recommended: true
  }]);
  const rebuilt = await buildProofPlanOperation({
    repoRoot: setup.root,
    wkId,
    expectedContentDigest: null
  });
  assert.equal(rebuilt.carrier.written, true);
  assert.notEqual(rebuilt.carrier.content_digest, built.carrier.content_digest);
  assert.equal((await queryControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan"
  })).source_binding_status, "current");

  const assessment = await assessControlledContractOperation({ repoRoot: setup.root, wkId });
  assert.equal(assessment.structure, "proven");
  assert.equal(assessment.selected_pack_count, 2);
  assert.deepEqual(assessment.per_pack.map(({ profile_id, profile_discrimination }) =>
    [profile_id, profile_discrimination]), [
    [FORBIDDEN_PACK.profileId, "not_proven"],
    [VALIDITY_PACK.profileId, "not_proven"]
  ]);
  const narrowedRequest = await patchControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan_request",
    expectedContentDigest: createdRequest.content_digest,
    operations: [
      { op: "remove", target: "requested_intents", id: FORBIDDEN_INTENT },
      { op: "remove", target: "selected_packs",
        id: `${FORBIDDEN_PACK.profileId}@${FORBIDDEN_PACK.profileVersion}` }
    ]
  });
  assert.equal(narrowedRequest.written, true);
  const requestOnlyRebuild = await buildProofPlanOperation({
    repoRoot: setup.root,
    wkId,
    expectedContentDigest: null
  });
  assert.equal(requestOnlyRebuild.carrier.written, true);
  assert.deepEqual(requestOnlyRebuild.plan.packs.map(({ profile_id }) => profile_id),
    [VALIDITY_PACK.profileId]);
  assert.equal((await queryControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan"
  })).source_binding_status, "current");
  assert.equal(createdRequest.validation_status, "valid");
});

test("live source lease includes request inputs and the unreferenced canonical root", async (t) => {
  const wkId = FIXTURE_WK;
  const setup = await fixture(t);
  const records = path.join(setup.root, "wiki", "work-records");
  await mkdir(records, { recursive: true });
  await writeFile(path.join(records, `${wkId}.json`), await readFile(
    path.join(REPO, "wiki", "work-records", `${wkId}.json`)
  ));
  const rootFilename = controlledContractCarrierFilename({
    wkId, carrierKind: "evaluation_input"
  });
  const rootCreate = await createControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "evaluation_input",
    expectedContentDigest: null,
    content: setup.forbiddenInput
  });
  const forbiddenIdentity = operationIdentity({ ...setup, wkId }, FORBIDDEN_PACK);
  await createControlledContractCarrierOperation({
    ...forbiddenIdentity,
    expectedContentDigest: null,
    content: setup.forbiddenInput
  });
  const packFilename = controlledContractPackCarrierFilename({ wkId, ...FORBIDDEN_PACK });
  await createControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [FORBIDDEN_INTENT],
      selected_packs: [{
        profile_id: FORBIDDEN_PACK.profileId,
        profile_version: FORBIDDEN_PACK.profileVersion
      }]
    }
  });

  let releasedLease;
  await withCanonicalControlledContractSourceLease({
    repoRoot: setup.root, wkId
  }, async ({ lease, source_digests: sourceDigests }) => {
    releasedLease = lease;
    assert.equal(typeof sourceDigests[rootFilename], "string");
    assert.equal(typeof sourceDigests[packFilename], "string");
    assert.equal(await refusalCode(writeControlledContractCarrierOperation({
      repoRoot: setup.root,
      wkId,
      carrierKind: "evaluation_input",
      expectedContentDigest: rootCreate.content_digest,
      content: setup.forbiddenInput
    })), "controlled_contract_carrier_busy");
    await assert.rejects(writeControlledContractCarrierSet({
      repoRoot: setup.root,
      repository: "agent-chassis/agent-chassis",
      wkId: FOREIGN_WK,
      profile: {
        profileId: "proof.integration.prefix-safety",
        profileVersion: "1.0.0"
      },
      expected_manifest_digest: null,
      sourceLease: lease,
      carriers: {}
    }), { code: "controlled_contract_source_lease_identity_mismatch" });
  });

  for (const sourceLease of [releasedLease, Object.freeze({})]) {
    await assert.rejects(writeControlledContractCarrierSet({
      repoRoot: setup.root,
      repository: "agent-chassis/agent-chassis",
      wkId,
      profile: {
        profileId: "proof.integration.prefix-safety",
        profileVersion: "1.0.0"
      },
      expected_manifest_digest: null,
      sourceLease,
      carriers: {}
    }), { code: "controlled_contract_source_lease_expired" });
  }

  const afterRelease = await writeControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "evaluation_input",
    expectedContentDigest: rootCreate.content_digest,
    content: setup.forbiddenInput
  });
  assert.equal(afterRelease.no_op, true);
});

test("legacy one-pack requests extend lazily while exact pack authority fails closed", async (t) => {
  const wkId = FIXTURE_WK;
  const focus = "composition";
  const setup = await fixture(t, focus);
  const stem = `${wkId}-${focus}`;
  const legacyFilename = `${stem}.evaluation-input.json`;
  await writeFile(path.join(setup.directory, legacyFilename),
    `${JSON.stringify(setup.forbiddenInput, null, 2)}\n`);

  const legacyRequest = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: [FORBIDDEN_INTENT],
    selected_packs: [{
      profile_id: FORBIDDEN_PACK.profileId,
      profile_version: FORBIDDEN_PACK.profileVersion
    }]
  };
  const created = await createControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: legacyRequest
  });
  assert.equal((await readControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    carrierKind: "proof_plan_request"
  })).content.selected_packs[0].evaluation_input_path, legacyFilename);
  assert.equal(await refusalCode(createControlledContractCarrierOperation({
    ...operationIdentity({ ...setup, wkId, focus }, FORBIDDEN_PACK),
    expectedContentDigest: null,
    content: setup.forbiddenInput
  })), "controlled_contract_stale_content_digest");
  assert.equal((await readdir(setup.directory)).includes(
    controlledContractPackCarrierFilename({ wkId, focus, ...FORBIDDEN_PACK })
  ), false);

  const validityIdentity = operationIdentity({ ...setup, wkId, focus }, VALIDITY_PACK);
  await createControlledContractCarrierOperation({
    ...validityIdentity,
    expectedContentDigest: null,
    content: setup.validityInput
  });
  const extension = await patchControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    carrierKind: "proof_plan_request",
    expectedContentDigest: created.content_digest,
    operations: [
      { op: "upsert", target: "requested_intents", id: VALIDITY_INTENT, value: VALIDITY_INTENT },
      { op: "upsert", target: "selected_packs",
        id: `${VALIDITY_PACK.profileId}@${VALIDITY_PACK.profileVersion}`,
        value: { profile_id: VALIDITY_PACK.profileId, profile_version: VALIDITY_PACK.profileVersion } }
    ]
  });
  const extended = await readControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    carrierKind: "proof_plan_request"
  });
  const bindings = Object.fromEntries(extended.content.selected_packs.map((pack) => [
    `${pack.profile_id}@${pack.profile_version}`,
    pack.evaluation_input_path
  ]));
  assert.equal(bindings[`${FORBIDDEN_PACK.profileId}@${FORBIDDEN_PACK.profileVersion}`],
    legacyFilename);
  assert.equal(bindings[`${VALIDITY_PACK.profileId}@${VALIDITY_PACK.profileVersion}`],
    controlledContractPackCarrierFilename({ wkId, focus, ...VALIDITY_PACK }));
  assert.equal((await buildProofPlanOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    expectedContentDigest: null
  })).plan.packs.length, 2);

  assert.equal(await refusalCode(patchControlledContractCarrierOperation({
    ...validityIdentity,
    expectedContentDigest: `sha256:${"0".repeat(64)}`,
    operations: [{ op: "upsert", target: "evaluation_stage", value: "pre_dispatch" }]
  })), "controlled_contract_stale_content_digest");
  assert.equal(await refusalCode(queryControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    focus,
    carrierKind: "contract",
    profileId: VALIDITY_PACK.profileId,
    profileVersion: VALIDITY_PACK.profileVersion
  })), "controlled_contract_pack_identity_forbidden");
  assert.equal(await refusalCode(readControlledContractCarrierOperation({
    ...validityIdentity,
    profileVersion: undefined
  })), "controlled_contract_pack_identity_invalid");

  const wrongPaths = [
    `../${legacyFilename}`,
    `${FOREIGN_WK}-${focus}.evaluation-input.json`,
    controlledContractPackCarrierFilename({ wkId, focus: "other", ...VALIDITY_PACK }),
    controlledContractPackCarrierFilename({ wkId, focus, ...FORBIDDEN_PACK })
  ];
  for (const evaluation_input_path of wrongPaths) {
    const attempted = request([VALIDITY_PACK]);
    attempted.requested_intents = [VALIDITY_INTENT];
    attempted.selected_packs[0].evaluation_input_path = evaluation_input_path;
    const isolated = await fixture(t, focus);
    assert.equal(await refusalCode(createControlledContractCarrierOperation({
      repoRoot: isolated.root,
      wkId: FIXTURE_WK,
      focus,
      carrierKind: "proof_plan_request",
      expectedContentDigest: null,
      content: attempted
    })), "controlled_contract_proof_input_path_forbidden");
  }
  assert.equal(extension.validation_status, "valid");
});

test("missing, duplicate, and sibling-role inputs refuse before persistence", async (t) => {
  const missing = await fixture(t);

  await writeFile(path.join(missing.directory, controlledContractPackCarrierFilename({
    wkId: FIXTURE_WK, ...VALIDITY_PACK
  })), `${JSON.stringify(missing.validityInput, null, 2)}\n`);
  assert.equal(await refusalCode(createControlledContractCarrierOperation({
    repoRoot: missing.root,
    wkId: FIXTURE_WK,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: request()
  })), "proof_plan_request_missing_inputs");
  assert.equal((await carrierBasenames(missing.directory))
    .includes(`${FIXTURE_WK}.proof-plan-request.json`), false);
  const missingRequest = request();
  missingRequest.selected_packs = missingRequest.selected_packs.map((pack) => ({
    ...pack,
    evaluation_input_path: controlledContractPackCarrierFilename({
      wkId: FIXTURE_WK,
      profileId: pack.profile_id,
      profileVersion: pack.profile_version
    })
  }));
  await writeFile(path.join(missing.directory, `${FIXTURE_WK}.proof-plan-request.json`),
    `${JSON.stringify(missingRequest, null, 2)}\n`);
  const recovery = await queryControlledContractCarrierOperation({
    repoRoot: missing.root,
    wkId: FIXTURE_WK,
    carrierKind: "proof_plan"
  });
  assert.equal(recovery.source_binding_status, "incomplete");
  assert.equal(recovery.missing_input_count, 1);
  assert.deepEqual(recovery.next_calls, [{
    tool: "workspace_controlled_contract_authoring_describe",
    arguments: { carrier_kind: "evaluation_input" },
    recommended: true
  }]);

  const duplicate = await fixture(t);

  await createControlledContractCarrierOperation({
    ...operationIdentity({ ...duplicate, wkId: FIXTURE_WK }, VALIDITY_PACK),
    expectedContentDigest: null,
    content: duplicate.validityInput
  });
  await createControlledContractCarrierOperation({
    ...operationIdentity({ ...duplicate, wkId: FIXTURE_WK }, FORBIDDEN_PACK),
    expectedContentDigest: null,
    content: duplicate.forbiddenInput
  });
  const duplicated = request([VALIDITY_PACK, VALIDITY_PACK, FORBIDDEN_PACK]);
  assert.equal(await refusalCode(createControlledContractCarrierOperation({
    repoRoot: duplicate.root,
    wkId: FIXTURE_WK,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: duplicated
  })), "proof_plan_request_duplicate_pack");

  const extraneous = await fixture(t);
  const mixed = structuredClone(extraneous.forbiddenInput);

  mixed.reference_bindings.push(structuredClone(
    extraneous.validityInput.reference_bindings.find(({ role }) => role === "component")
  ));
  assert.equal(await refusalCode(createControlledContractCarrierOperation({
    ...operationIdentity({ ...extraneous, wkId: FIXTURE_WK }, FORBIDDEN_PACK),
    expectedContentDigest: null,
    content: mixed
  })), "proof_plan_request_evaluation_input_invalid");
  assert.equal((await carrierBasenames(extraneous.directory)).some((name) =>
    name.includes(".pack-sha256-")), false);
});

async function legacyBoundRequest(t, wkId, { extend }) {
  const setup = await fixture(t);
  const identity = { ...setup, wkId };
  const legacyFilename = `${wkId}.evaluation-input.json`;
  await writeFile(path.join(setup.directory, legacyFilename),
    `${JSON.stringify(setup.forbiddenInput, null, 2)}\n`);
  const created = await createControlledContractCarrierOperation({
    repoRoot: setup.root,
    wkId,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: { ...request([FORBIDDEN_PACK]), requested_intents: [FORBIDDEN_INTENT] }
  });
  if (extend) {
    await createControlledContractCarrierOperation({
      ...operationIdentity(identity, VALIDITY_PACK),
      expectedContentDigest: null,
      content: setup.validityInput
    });
    await patchControlledContractCarrierOperation({
      repoRoot: setup.root,
      wkId,
      carrierKind: "proof_plan_request",
      expectedContentDigest: created.content_digest,
      operations: [
        { op: "upsert", target: "requested_intents", id: VALIDITY_INTENT, value: VALIDITY_INTENT },
        { op: "upsert", target: "selected_packs",
          id: `${VALIDITY_PACK.profileId}@${VALIDITY_PACK.profileVersion}`,
          value: { profile_id: VALIDITY_PACK.profileId,
            profile_version: VALIDITY_PACK.profileVersion } }
      ]
    });
  }
  return { ...setup, wkId, legacyFilename };
}

test("an unbound pack never adopts another pack's request-bound legacy carrier", async (t) => {
  for (const [wkId, extend] of [[FIXTURE_WK, false], [FIXTURE_WK, true]]) {
    const setup = await legacyBoundRequest(t, wkId, { extend });
    const identity = { ...setup, wkId };
    const label = extend ? "multi-pack request" : "one-pack request";
    const legacyPath = path.join(setup.directory, setup.legacyFilename);
    const beforeBytes = await readFile(legacyPath, "utf8");

    const bound = await readControlledContractCarrierOperation(
      operationIdentity(identity, FORBIDDEN_PACK));
    assert.equal(bound.filename, setup.legacyFilename, label);

    const addressed = operationIdentity(identity, UNSELECTED_PACK);
    assert.equal(await refusalCode(readControlledContractCarrierOperation(addressed)),
      "controlled_contract_proof_input_path_forbidden", `${label} read`);
    assert.equal(await refusalCode(patchControlledContractCarrierOperation({
      ...addressed,
      expectedContentDigest: bound.content_digest,
      operations: [{ op: "upsert", target: "evaluation_stage", value: "pre_dispatch" }]
    })), "controlled_contract_proof_input_path_forbidden", `${label} patch`);
    assert.equal(await refusalCode(writeControlledContractCarrierOperation({
      ...addressed,
      expectedContentDigest: bound.content_digest,
      content: setup.validityInput
    })), "controlled_contract_proof_input_path_forbidden", `${label} recovery write`);

    assert.equal(await readFile(legacyPath, "utf8"), beforeBytes, label);
    assert.equal((await readControlledContractCarrierOperation(
      operationIdentity(identity, FORBIDDEN_PACK))).content_digest, bound.content_digest, label);
    if (extend) {
      assert.equal((await readControlledContractCarrierOperation(
        operationIdentity(identity, VALIDITY_PACK))).filename,
      controlledContractPackCarrierFilename({ wkId, ...VALIDITY_PACK }), label);
    }
  }

  const wkId = FIXTURE_WK;
  const unbound = await fixture(t);
  const legacyFilename = `${wkId}.evaluation-input.json`;
  await writeFile(path.join(unbound.directory, legacyFilename),
    `${JSON.stringify(unbound.forbiddenInput, null, 2)}\n`);
  const adopted = await readControlledContractCarrierOperation(
    operationIdentity({ ...unbound, wkId }, FORBIDDEN_PACK));
  assert.equal(adopted.filename, legacyFilename);
  assert.equal((await patchControlledContractCarrierOperation({
    ...operationIdentity({ ...unbound, wkId }, FORBIDDEN_PACK),
    expectedContentDigest: adopted.content_digest,
    operations: [{ op: "upsert", target: "evaluation_stage", value: "pre_dispatch" }]
  })).validation_status, "valid");
});

test("absent proof-plan metadata separates an unauthored request from a missing contract",
  async (t) => {
    const wkId = FIXTURE_WK;
    const setup = await fixture(t);
    const identity = { ...setup, wkId };
    const metadata = { repoRoot: setup.root, wkId, carrierKind: "proof_plan" };

    const contractOnly = await queryControlledContractCarrierOperation(metadata);
    assert.equal(contractOnly.exists, false);
    assert.equal(contractOnly.content_digest, null);
    assert.equal(contractOnly.rebuild_expected_content_digest, null);
    assert.equal(contractOnly.source_binding_status, "absent");
    assert.deepEqual(contractOnly.next_calls, [{
      tool: "workspace_controlled_proof_plan_build",
      arguments: { wk_id: wkId, expected_content_digest: null },
      recommended: true
    }]);

    await createControlledContractCarrierOperation({
      ...operationIdentity(identity, FORBIDDEN_PACK),
      expectedContentDigest: null,
      content: setup.forbiddenInput
    });
    await createControlledContractCarrierOperation({
      repoRoot: setup.root,
      wkId,
      carrierKind: "proof_plan_request",
      expectedContentDigest: null,
      content: { ...request([FORBIDDEN_PACK]), requested_intents: [FORBIDDEN_INTENT] }
    });
    assert.deepEqual(await queryControlledContractCarrierOperation(metadata), contractOnly);

    const empty = await mkdtemp(path.join(os.tmpdir(), "stable-v1-no-contract-"));
    t.after(() => rm(empty, { recursive: true, force: true }));
    await mkdir(path.join(empty, "wiki", "contracts"), { recursive: true });
    assert.equal(await refusalCode(queryControlledContractCarrierOperation({
      repoRoot: empty, wkId, carrierKind: "proof_plan"
    })), "controlled_contract_carrier_not_found");
  });
