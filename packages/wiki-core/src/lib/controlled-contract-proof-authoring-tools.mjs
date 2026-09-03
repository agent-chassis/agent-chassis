import {
  lstat,
  readFile,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";
import {
  CONTROLLED_CONTRACT_ARTIFACT_FILES,
  CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES,
  ASSESSMENT_ID_PATTERN,
  loadControlledContractPackage,
  loadControlledContractTestProofPackage,
  ControlledContractToolError,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  normalizeControlledContractPackIdentity,
  readStableControlledContractGeneration,
  parseCarrierJson,
  controlledContractPackCarrierFilename,
  inspectCarrierFile
} from "./controlled-contract-tool-shared.mjs";
import {
  selectedPackIdentityKey,
  readCanonicalProofPlanRequest,
  persistedEvaluationInputBindings,
  readControlledContractCarrierFile,
  writeControlledContractCarrierFileInternal,
  writeControlledContractCarrierFile,
  projectedSelectedPackCount
} from "./controlled-contract-carrier-set-tools.mjs";

export async function composeSelectedProofPack({
  store, canonicalSet = null, packageApi, wkId, focus, selectedPack, bindings,
  selectedPackCount
}) {
  if (!isPlainObject(selectedPack)) return structuredClone(selectedPack);
  const identity = normalizeControlledContractPackIdentity({
    profileId: selectedPack.profile_id,
    profileVersion: selectedPack.profile_version
  });
  const bound = bindings.get(`${identity.profileId}@${identity.profileVersion}`);
  const packFilename = controlledContractPackCarrierFilename({
    wkId, focus, ...identity
  });
  let evaluationInputPath = bound;
  if (evaluationInputPath === undefined) {
    if (selectedPackCount > 1) {
      evaluationInputPath = packFilename;
    } else {
      const exists = canonicalSet === null
        ? await inspectCarrierFile(path.join(store.contracts, packFilename), {
          required: false
        }).then((entry) => entry !== null)
        : Object.hasOwn(canonicalSet.members_by_basename, packFilename);
      evaluationInputPath = exists
        ? packFilename
        : packageApi.canonicalEvaluationFilename(wkId, focus);
    }
  }
  if (Object.hasOwn(selectedPack, "evaluation_input_path") &&
      selectedPack.evaluation_input_path !== evaluationInputPath) {
    fail(
      "controlled_contract_proof_input_path_forbidden",
      "selected-pack evaluation_input_path is server-derived and must not select another path"
    );
  }
  return { ...structuredClone(selectedPack), evaluation_input_path: evaluationInputPath };
}

export async function describeControlledContractTestProofAuthoring() {
  const packageApi = await loadControlledContractPackage();
  return packageApi.describeStableTestProofAuthoring();
}

async function queryControlledContractTestProofBindingsInternal({
  repoRoot,
  wkId,
  focus = null,
  verificationIds,
  includeGenerationCarriers,
  runtimePopulation
}) {
  normalizeControlledContractIdentity({ wkId, focus });

  const generation = await readStableControlledContractGeneration({ repoRoot, wkId });
  const carrier = await readControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract"
  });
  const filename = carrier.filename;
  const generationCarrier = generation.carriers.find((entry) => entry.filename === filename);
  if (!generationCarrier || generationCarrier.content_digest !== carrier.content_digest) {
    fail("controlled_contract_carrier_not_found",
      "canonical carrier does not exist in the authenticated same-WK generation");
  }
  const content = parseCarrierJson(generationCarrier.bytes);
  const packageApi = await loadControlledContractPackage();
  const projection = runtimePopulation
    ? packageApi.resolveStableTestProofBindingPopulation({
      contract: content, verificationIds
    })
    : packageApi.queryStableTestProofBindings({ contract: content, verificationIds });
  return Object.freeze({
    ...structuredClone(projection),
    wk_id: wkId,
    focus: focus ?? null,
    filename,
    content_digest: generationCarrier.content_digest,
    controlled_contract_generation: generation.projection.generation_digest,
    controlled_contract_generation_schema_version: generation.projection.schema_version,
    controlled_contract_generation_carrier_count: generation.projection.carrier_count,
    ...(includeGenerationCarriers ? {
      controlled_contract_generation_carriers: structuredClone(generation.carriers.map(
        ({ filename: memberFilename, content_digest: contentDigest, source_member: sourceMember }) => ({
          filename: memberFilename,
          content_digest: contentDigest,
          source_member: sourceMember
        })
      ))
    } : {})
  });
}
export async function queryControlledContractTestProofBindings(input) {
  return queryControlledContractTestProofBindingsInternal({
    ...input, includeGenerationCarriers: false, runtimePopulation: false
  });
}

export async function resolveControlledContractTestProofRuntimeBindings(input) {
  return queryControlledContractTestProofBindingsInternal({
    ...input, includeGenerationCarriers: true, runtimePopulation: true
  });
}

export async function patchControlledContractTestProofBindings({
  repoRoot,
  wkId,
  focus = null,
  expectedContentDigest,
  operations
}) {
  const carrier = await readControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract"
  });
  if (carrier.content_digest !== expectedContentDigest) fail(
    "controlled_contract_stale_content_digest", "canonical carrier content changed", {
      expected_content_digest: expectedContentDigest,
      actual_content_digest: carrier.content_digest
    }
  );
  const packageApi = await loadControlledContractPackage();
  const prospective = packageApi.replaceStableTestProofBindings({
    contract: carrier.content, replacements: operations
  });
  const receipt = await writeControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract",
    expectedContentDigest, content: prospective.contract
  });
  return Object.freeze({
    schema_version: "controlled-contract-test-proof-binding-patch.v1",
    wk_id: wkId,
    focus: focus ?? null,
    previous_content_digest: receipt.previous_content_digest,
    content_digest: receipt.content_digest,
    written: receipt.written,
    changed_verification_ids: structuredClone(prospective.changed_verification_ids),
    semantic_judgment: prospective.semantic_judgment
  });
}

export async function patchControlledContractVerificationBundles({
  repoRoot,
  wkId,
  focus = null,
  expectedContentDigest,
  operations
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  for (const [index, operation] of (operations ?? []).entries()) {
    const prefix = /^WK-[0-9]{4}#/u.exec(operation?.verification_id)?.[0];
    if (prefix && prefix !== `${wkId}#`) fail(
      "controlled_contract_verification_bundle_cross_wk",
      "verification bundle identity belongs to another work record",
      { pointer: `/operations/${index}/verification_id`, wk_id: wkId,
        verification_id: operation.verification_id }
    );
  }
  const carrier = await readControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract"
  });
  if (carrier.content_digest !== expectedContentDigest) fail(
    "controlled_contract_stale_content_digest", "canonical carrier content changed", {
      expected_content_digest: expectedContentDigest,
      actual_content_digest: carrier.content_digest
    }
  );
  const packageApi = await loadControlledContractTestProofPackage();
  const prospective = packageApi.applyStableVerificationBundles({
    contract: carrier.content, operations
  });
  const receipt = await writeControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract",
    expectedContentDigest, content: prospective.contract
  });
  return Object.freeze({
    schema_version: "controlled-contract-verification-bundle-patch.v1",
    wk_id: wkId,
    focus: focus ?? null,
    previous_content_digest: receipt.previous_content_digest,
    content_digest: receipt.content_digest,
    written: receipt.written,
    no_op: receipt.no_op,
    changed_verification_ids: structuredClone(prospective.changed_verification_ids),
    semantic_judgment: prospective.semantic_judgment
  });
}

export async function writeControlledContractProofPlanFile(input) {
  return writeControlledContractCarrierFileInternal({
    ...input,
    carrierKind: "proof_plan",
    allowPackageProducedWrite: true
  });
}

export async function composeProofPlanRequestEvaluationInputPaths({
  repoRoot,
  wkId,
  focus = null,
  content,
  canonicalSet = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!isPlainObject(content) || !Array.isArray(content.selected_packs)) {
    return structuredClone(content);
  }
  const { store, canonicalSet: resolvedSet, content: persisted } =
    await readCanonicalProofPlanRequest({
    repoRoot, wkId, focus, canonicalSet
  });
  const bindings = persistedEvaluationInputBindings({ wkId, focus, content: persisted });
  const packageApi = await loadControlledContractPackage();
  const selectedPackCount = new Set(content.selected_packs.filter(isPlainObject)
    .map(selectedPackIdentityKey)).size;
  const selectedPacks = [];
  for (const selectedPack of content.selected_packs) {
    selectedPacks.push(await composeSelectedProofPack({
      store, canonicalSet: resolvedSet, packageApi, wkId, focus, selectedPack, bindings,
      selectedPackCount
    }));
  }
  return { ...structuredClone(content), selected_packs: selectedPacks };
}

export async function composeProofPlanRequestPatchEvaluationInputPaths({
  repoRoot,
  wkId,
  focus = null,
  operations,
  canonicalSet = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!Array.isArray(operations)) return operations;
  const { store, canonicalSet: resolvedSet, content: persisted } =
    await readCanonicalProofPlanRequest({
    repoRoot, wkId, focus, canonicalSet
  });
  const bindings = persistedEvaluationInputBindings({ wkId, focus, content: persisted });
  const packageApi = await loadControlledContractPackage();
  const selectedPackCount = projectedSelectedPackCount({ content: persisted, operations });
  const composed = [];
  for (const operation of operations) {
    if (!isPlainObject(operation) || operation.op !== "upsert" ||
        operation.target !== "selected_packs") {
      composed.push(structuredClone(operation));
      continue;
    }
    composed.push({
      ...structuredClone(operation),
      value: await composeSelectedProofPack({
        store, canonicalSet: resolvedSet, packageApi, wkId, focus,
        selectedPack: operation.value, bindings,
        selectedPackCount
      })
    });
  }
  return composed;
}

async function resolveArtifactStore(repoRoot) {
  const repository = await realpath(path.resolve(repoRoot));
  const segments = [".cache", "controlled-contract", "assessments", "sha256"];
  let current = repository;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(current) !== current) {
        fail("controlled_contract_artifact_store_escape", "assessment store escaped its fixed root");
      }
    } catch (error) {
      if (error instanceof ControlledContractToolError) throw error;
      if (error?.code === "ENOENT") {
        fail("controlled_contract_artifact_not_found", "assessment artifact does not exist");
      }
      fail("controlled_contract_artifact_read_failed", "assessment artifact store is unavailable");
    }
  }
  return current;
}

export async function readControlledContractAssessmentArtifactFile({
  repoRoot,
  assessmentIdentity,
  artifactFile
}) {
  if (typeof assessmentIdentity !== "string" || !ASSESSMENT_ID_PATTERN.test(assessmentIdentity)) {
    fail("controlled_contract_assessment_identity_invalid", "assessment_identity must be an exact sha256 identity");
  }
  if (!CONTROLLED_CONTRACT_ARTIFACT_FILES.includes(artifactFile)) {
    fail("controlled_contract_artifact_file_invalid", "artifact_file is not part of the package bundle");
  }
  const root = await resolveArtifactStore(repoRoot);
  const directory = path.join(root, assessmentIdentity);
  let directoryEntry;
  try {
    directoryEntry = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("controlled_contract_artifact_not_found", "assessment artifact does not exist");
    }
    throw error;
  }
  if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink() ||
      await realpath(directory) !== directory) {
    fail("controlled_contract_artifact_store_escape", "assessment artifact directory escaped its fixed identity");
  }
  const file = path.join(directory, artifactFile);
  let fileEntry;
  try {
    fileEntry = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("controlled_contract_artifact_not_found", "assessment artifact file does not exist");
    }
    throw error;
  }
  if (!fileEntry.isFile() || fileEntry.isSymbolicLink() || await realpath(file) !== file) {
    fail("controlled_contract_artifact_store_escape", "assessment artifact file escaped its fixed identity");
  }
  const fileStat = await stat(file);
  if (fileStat.size > CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES) {
    fail("controlled_contract_artifact_too_large", "assessment artifact exceeds its retrieval byte limit");
  }
  const source = await readFile(file, "utf8");
  const mediaType = artifactFile.endsWith(".json") ? "application/json" : "text/markdown";
  let content = source;
  if (mediaType === "application/json") {
    try {
      content = JSON.parse(source);
    } catch {
      fail("controlled_contract_artifact_json_invalid", "package assessment artifact is not valid JSON");
    }
  }
  return Object.freeze({
    schema_version: "controlled-contract-assessment-artifact-read.v1",
    assessment_identity: assessmentIdentity,
    artifact_file: artifactFile,
    content_reference:
      `controlled-contract-assessment://sha256/${assessmentIdentity}/${artifactFile}`,
    media_type: mediaType,
    byte_count: Buffer.byteLength(source, "utf8"),
    content
  });
}
