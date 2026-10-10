

import {
  createHash
} from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  realpath
} from "node:fs/promises";
import path from "node:path";
import {
  resolveCanonicalControlledContractCarrierSet
} from "./controlled-contract-carrier-set-tools.mjs";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES,
  CANONICAL_AUTHORING_PROFILE_ID,
  CANONICAL_AUTHORING_PROFILE_VERSION,
  loadControlledContractPackage,
  ControlledContractToolError,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  carrierStem,
  controlledContractCarrierFilename,
  normalizeControlledContractPackIdentity,
  classifyControlledContractCarrierBasename,
  classifyControlledContractRepositoryPath,
  digestBytes,
  canonicalJsonBytes,
  resolveControlledContractRepository,
  inspectCarrierFile,
  parseCarrierJson,
  deepFreezePlainData,
  generationEvaluationInputValidator
} from "./controlled-contract-tool-shared.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES,
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION,
  ControlledContractCarrierSetManifestError,
  constructControlledContractCarrierSetManifest,
  canonicalControlledContractCarrierSetManifestBytes,
  controlledContractCarrierSetArtifactFilename,
  parseControlledContractCarrierSetManifest
} from "./controlled-contract-carrier-set-manifest.mjs";

export function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const CARRIER_SET_SCHEMA_VERSION =
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION;

const CARRIER_SET_CORE_KINDS = Object.freeze([
  "contract", "proof_plan_request", "proof_plan"
]);

const CARRIER_SET_INPUT_KEYS = Object.freeze([
  "contract", "evaluation_inputs", "proof_plan_request", "proof_plan"
]);

export const INTEGRATION_CAPTURE_PROFILE = Object.freeze({
  profileId: "proof.integration.prefix-safety",
  profileVersion: "1.0.0"
});

export function carrierSetFailure(code, message, details = {}, cause = undefined) {
  fail(`controlled_contract_carrier_set_${code}`, message, details, cause);
}

function validatedCarrierSetManifest(value, expected) {
  try {
    return parseControlledContractCarrierSetManifest(value, expected);
  } catch (error) {
    if (!(error instanceof ControlledContractCarrierSetManifestError)) throw error;
    const code = error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MISSING ||
      error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE
      ? "partial_generation"
      : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER
        ? "member_mismatch"
        : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.DIGEST
          ? "manifest_mismatch"
          : "manifest_mismatch";
    carrierSetFailure(code, error.message, error.details);
  }
}

function exactObjectKeys(value, expected) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function strictBase64Bytes(value) {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function artifactFilename({ wkId, focus, artifactRole }) {
  normalizeControlledContractIdentity({ wkId, focus });
  return controlledContractCarrierSetArtifactFilename({ wkId, focus, artifactRole });
}

async function validateCarrierSetEvaluationPopulation({ wkId, focus, request, evaluations }) {
  if (!isPlainObject(evaluations) || Object.keys(evaluations).length === 0) {
    carrierSetFailure("evaluation_population_invalid",
      "evaluation_inputs must be one nonempty filename-addressed population");
  }
  if (!isPlainObject(request) || !Array.isArray(request.selected_packs) ||
      request.selected_packs.length === 0) {
    carrierSetFailure("evaluation_population_invalid",
      "proof-plan request must select at least one evaluation input");
  }
  const expectedEvaluationNames = new Set();
  const canonicalEvaluationName = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "evaluation_input"
  });
  for (const selected of request.selected_packs) {
    if (!isPlainObject(selected) || typeof selected.evaluation_input_path !== "string") {
      carrierSetFailure("evaluation_population_invalid",
        "every selected pack must carry one server-derived evaluation basename");
    }
    const basename = selected.evaluation_input_path;
    const classified = classifyControlledContractCarrierBasename({ wkId, basename });
    if (classified.member !== true || classified.carrier_kind !== "evaluation_input" ||
        classified.focus !== focus) {
      carrierSetFailure("evaluation_basename_invalid",
        "selected evaluation basename is foreign, cross-focus, unsupported, or noncanonical",
        { basename });
    }
    let expectedName = canonicalEvaluationName;
    if (classified.pack_namespace !== null) {
      try {
        expectedName = controlledContractPackCarrierFilename({
          wkId,
          focus,
          profileId: selected.profile_id,
          profileVersion: selected.profile_version
        });
      } catch (error) {
        carrierSetFailure("evaluation_basename_invalid",
          "selected evaluation basename has no exact pack identity",
          { basename, cause_code: error?.code ?? null });
      }
    }
    if (basename !== expectedName || expectedEvaluationNames.has(basename)) {
      carrierSetFailure("evaluation_basename_ambiguous",
        "selected evaluation basenames must be exact and unique", { basename });
    }
    expectedEvaluationNames.add(basename);
  }
  const evaluationNames = Object.keys(evaluations).sort();
  for (const basename of evaluationNames) {
    const classified = classifyControlledContractCarrierBasename({ wkId, basename });
    if (classified.member !== true || classified.carrier_kind !== "evaluation_input" ||
        classified.focus !== focus) {
      carrierSetFailure("evaluation_basename_invalid",
        "evaluation member basename is foreign, cross-focus, unsupported, or noncanonical",
        { basename });
    }
  }
  if (JSON.stringify(evaluationNames) !==
      JSON.stringify([...expectedEvaluationNames].sort())) {
    carrierSetFailure("evaluation_population_mismatch",
      "evaluation population must exactly match the selected pack basenames");
  }
  const pkg = await loadControlledContractPackage();
  const validateEvaluationInput = await generationEvaluationInputValidator(pkg);
  for (const filename of evaluationNames) {
    if (!isPlainObject(evaluations[filename]) || !validateEvaluationInput(evaluations[filename])) {
      carrierSetFailure("evaluation_invalid",
        "evaluation member failed the public verification-profile-input schema", {
          filename,
          diagnostics: structuredClone(validateEvaluationInput.errors ?? [])
        });
    }
  }
  return evaluationNames;
}

export async function carrierSetInputs(input) {
  if (!isPlainObject(input.carriers)) carrierSetFailure("input_invalid",
    "carriers must be one plain object");
  const keys = Object.keys(input.carriers).sort();
  const expected = [...CARRIER_SET_INPUT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) carrierSetFailure("carrier_missing",
    "carrier set must contain contract, evaluation population, request, and proof plan");
  const entries = CARRIER_SET_CORE_KINDS.map((carrierKind) => {
    const content = input.carriers[carrierKind];
    if (!isPlainObject(content)) carrierSetFailure("carrier_invalid",
      "each carrier must contain one JSON object", { carrier_kind: carrierKind });
    const filename = controlledContractCarrierFilename({
      wkId: input.wkId, focus: input.focus ?? null, carrierKind
    });
    return {
      member_kind: "carrier",
      carrier_kind: carrierKind,
      filename,
      content,
      bytes: canonicalJsonBytes(content)
    };
  });

  const request = input.carriers.proof_plan_request;
  const evaluations = input.carriers.evaluation_inputs;
  const evaluationNames = await validateCarrierSetEvaluationPopulation({
    wkId: input.wkId,
    focus: input.focus ?? null,
    request,
    evaluations
  });
  for (const filename of evaluationNames) {
    const content = evaluations[filename];
    entries.push({
      member_kind: "evaluation_input",
      carrier_kind: "evaluation_input",
      filename,
      content,
      bytes: canonicalJsonBytes(content)
    });
  }

  if (!Array.isArray(input.artifact_members) ||
      input.artifact_members.length !== CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES.length) {
    carrierSetFailure("artifact_population_invalid",
      "artifact_members must contain exactly the four controlled integration artifacts");
  }
  const artifactRoles = new Set();
  const artifactFilenames = new Set();
  for (const descriptor of input.artifact_members) {
    if (!exactObjectKeys(descriptor, [
      "artifact_role", "filename", "byte_length", "content_digest", "bytes_base64"
    ])) carrierSetFailure("artifact_member_invalid",
      "artifact member descriptor has an unsupported or incomplete shape");
    const artifactRole = descriptor.artifact_role;
    if (!CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES.includes(artifactRole) ||
        artifactRoles.has(artifactRole)) carrierSetFailure("artifact_role_invalid",
      "artifact roles must be the exact unique controlled role population",
      { artifact_role: artifactRole ?? null });
    const expectedFilename = artifactFilename({
      wkId: input.wkId, focus: input.focus ?? null, artifactRole
    });
    if (descriptor.filename !== expectedFilename || artifactFilenames.has(descriptor.filename)) {
      carrierSetFailure("artifact_basename_invalid",
        "artifact basename is foreign, cross-focus, duplicate, or noncanonical", {
          artifact_role: artifactRole, filename: descriptor.filename ?? null
        });
    }
    const bytes = strictBase64Bytes(descriptor.bytes_base64);
    if (bytes === null || bytes.byteLength === 0 ||
        bytes.byteLength > CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES ||
        descriptor.byte_length !== bytes.byteLength ||
        descriptor.content_digest !== digestBytes(bytes)) {
      carrierSetFailure("artifact_digest_mismatch",
        "artifact bytes, length, and digest must identify one exact controlled member", {
          artifact_role: artifactRole
        });
    }
    const content = parseCarrierJson(bytes);
    artifactRoles.add(artifactRole);
    artifactFilenames.add(descriptor.filename);
    entries.push({
      member_kind: "artifact",
      artifact_role: artifactRole,
      filename: descriptor.filename,
      content,
      bytes
    });
  }
  return entries.sort((left, right) => left.filename.localeCompare(right.filename));
}

export function carrierSetCapture(input) {
  if (!isPlainObject(input.integration) || !isPlainObject(input.bound_digests)) {
    carrierSetFailure("capture_missing", "integration capture and bound_digests are required");
  }
  const required = [
    "dag", "evaluation_inputs", "request", "integration_units", "source_map", "paths", "branches"
  ];
  if (required.some((field) => input.integration[field] === undefined ||
      input.integration[field] === null)) carrierSetFailure("capture_missing",
    "integration capture is incomplete");
  return {
    ...Object.fromEntries(required.map((field) => [field,
      structuredClone(input.integration[field])])),
    bound_digests: structuredClone(input.bound_digests)
  };
}

export function carrierSetEntryIdentity(entry) {
  return {
    member_kind: entry.member_kind,
    ...(entry.carrier_kind === undefined ? {} : { carrier_kind: entry.carrier_kind }),
    ...(entry.artifact_role === undefined ? {} : { artifact_role: entry.artifact_role }),
    filename: entry.filename,
    byte_length: entry.bytes.byteLength,
    bytes_base64: entry.bytes.toString("base64")
  };
}

export function carrierSetGenerationDigest({ repository, wkId, focus, profile, entries, capture }) {
  return createHash("sha256").update(canonicalJsonBytes({
    repository,
    wk_id: wkId,
    focus: focus ?? null,
    profile: { profile_id: profile.profileId, profile_version: profile.profileVersion },
    carriers: entries.map(carrierSetEntryIdentity),
    ...capture
  })).digest("hex");
}

export function carrierSetManifest({ input, entries, generation, generationPath, profile, capture }) {
  const census = entries.map((entry) => ({
    member_kind: entry.member_kind,
    ...(entry.carrier_kind === undefined ? {} : { carrier_kind: entry.carrier_kind }),
    ...(entry.artifact_role === undefined ? {} : { artifact_role: entry.artifact_role }),
    filename: entry.filename,
    path: path.posix.join(generationPath, entry.filename),
    content_digest: digestBytes(entry.bytes),
    byte_length: entry.bytes.byteLength
  }));
  return constructControlledContractCarrierSetManifest({
    repository: input.repository,
    wkId: input.wkId,
    focus: input.focus ?? null,
    profile: { profile_id: profile.profileId, profile_version: profile.profileVersion },
    generation,
    generationPath,
    members: census,
    capture
  });
}

export function carrierSetManifestPath(store, wkId, focus) {
  return path.join(store.contracts,
    `${carrierStem({ wkId, focus: focus ?? null })}.carrier-set-manifest.json`);
}

export function isCanonicalAuthoringProfile(value) {
  return value === CANONICAL_AUTHORING_PROFILE_ID ||
    value?.profileId === CANONICAL_AUTHORING_PROFILE_ID ||
    value?.profile_id === CANONICAL_AUTHORING_PROFILE_ID;
}

function normalizedPlainData(value) {
  if (Array.isArray(value)) return value.map(normalizedPlainData);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, normalizedPlainData(value[key])]
  ));
  return value;
}

export function samePlainData(left, right) {
  return JSON.stringify(normalizedPlainData(left)) === JSON.stringify(normalizedPlainData(right));
}

export async function validateCarrierSetPopulation({
  wkId, focus, profile, entries, capture, verifyProofPlan = true
}) {
  const classifiedCarriers = entries.filter(({ member_kind: kind }) => kind !== "artifact")
    .map((entry) => {
      const classification = classifyControlledContractRepositoryPath({
        wkId, repositoryPath: `wiki/contracts/${entry.filename}`
      });
      const expectedMemberKind = classification.carrier_kind === "evaluation_input"
        ? "evaluation_input" : "carrier";
      if (classification.classification !== "active_member" ||
          classification.focus !== focus ||
          classification.carrier_kind !== entry.carrier_kind ||
          entry.member_kind !== expectedMemberKind) {
        carrierSetFailure("member_mismatch",
          "carrier population member repository identity is noncanonical", {
            filename: entry.filename
          });
      }
      return { entry, classification };
    });
  const core = new Map(classifiedCarriers
    .filter(({ classification }) => classification.carrier_kind !== "evaluation_input")
    .map(({ entry, classification }) => [classification.carrier_kind, entry]));
  if (core.size !== CARRIER_SET_CORE_KINDS.length ||
      CARRIER_SET_CORE_KINDS.some((kind) => !core.has(kind))) {
    carrierSetFailure("carrier_missing", "carrier set core population is incomplete");
  }
  const evaluations = Object.fromEntries(classifiedCarriers
    .filter(({ classification }) => classification.carrier_kind === "evaluation_input")
    .map(({ entry }) => [entry.filename, entry.content]));
  const artifacts = new Map(entries.filter(({ member_kind: kind }) => kind === "artifact")
    .map((entry) => [entry.artifact_role, entry]));
  if (artifacts.size !== CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES.length ||
      CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES.some((role) => !artifacts.has(role))) {
    carrierSetFailure("artifact_population_invalid",
      "controlled artifact population is incomplete or ambiguous");
  }
  const expectedCapture = {
    dag: artifacts.get("dag-source").content,
    evaluation_inputs: evaluations,
    request: core.get("proof_plan_request").content,
    integration_units: artifacts.get("integration-units").content,
    source_map: capture.source_map,
    paths: artifacts.get("execution-paths").content,
    branches: capture.branches
  };
  if (!isPlainObject(capture.source_map) ||
      !samePlainData(artifacts.get("prefix-census").content, capture.source_map.projection) ||
      ["dag", "evaluation_inputs", "request", "integration_units", "paths"].some(
        (field) => !samePlainData(capture[field], expectedCapture[field]))) {
    carrierSetFailure("capture_mismatch",
      "manifest capture metadata differs from the material staged population");
  }

  const request = core.get("proof_plan_request").content;
  await validateCarrierSetEvaluationPopulation({
    wkId,
    focus,
    request,
    evaluations
  });
  const selected = request.selected_packs.filter((pack) =>
    pack?.profile_id === profile.profileId && pack?.profile_version === profile.profileVersion);
  if (selected.length !== 1) carrierSetFailure("wrong_profile",
    "proof-plan request must select the exact carrier-set profile once");
  const pkg = await loadControlledContractPackage();
  const resolved = pkg.validateStableTestProofContract(core.get("contract").content);
  if (!resolved.valid) {
    carrierSetFailure("contract_invalid", "staged contract failed public package validation", {
      contract_family: resolved.family,
      diagnostics: resolved.diagnostics
    });
  }
  if (verifyProofPlan) {
    let rebuilt;
    try {
      rebuilt = await pkg.buildProofPlan({
        contract: core.get("contract").content,
        request,
        evaluationInputs: evaluations
      });
    } catch (error) {
      carrierSetFailure("generated_binding_invalid",
        "staged contract, request, and evaluation population cannot build the proof plan", {
          cause_code: error?.code ?? null
        });
    }
    if (!samePlainData(rebuilt, core.get("proof_plan").content)) {
      carrierSetFailure("proof_plan_stale",
        "staged proof plan differs from the exact prepublication source population");
    }
  }
  return { core, evaluations, artifacts };
}

export async function inspectCarrierSetMember(file, maximumBytes, context = {}) {
  const member = {
    ...structuredClone(context),
    filename: context.filename ?? path.basename(file),
    path: file
  };
  const inspect = async (operation, read) => {
    try {
      return await read();
    } catch (error) {
      carrierSetFailure("partial_generation", "generation member is absent or unreadable", {
        ...member,
        operation,
        cause_code: typeof error?.code === "string" ? error.code : null
      }, error);
    }
  };
  const entry = await inspect("lstat", () => lstat(file));
  if (!entry.isFile() || entry.isSymbolicLink()) {
    carrierSetFailure("member_mismatch", "generation member is not one exact regular file", {
      ...member,
      operation: "validate_file_identity"
    });
  }
  const resolved = await inspect("realpath", () => realpath(file));
  if (resolved !== file) {
    carrierSetFailure("member_mismatch", "generation member is not one exact regular file", {
      ...member,
      operation: "validate_file_identity",
      resolved_path: resolved
    });
  }
  const bytes = await inspect("readFile", () => readFile(file));
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    carrierSetFailure("member_mismatch", "generation member exceeds its exact byte boundary", {
      ...member,
      operation: "validate_byte_boundary",
      observed_byte_length: bytes.byteLength,
      maximum_bytes: maximumBytes
    });
  }
  return { bytes, digest: digestBytes(bytes) };
}

export async function validateCarrierSetDirectory({ directory, entries, profile }) {
  const expectedNames = entries.map(({ filename }) => filename).sort();
  const observedNames = (await readdir(directory)).filter((name) => name !== "manifest.json").sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(observedNames)) {
    carrierSetFailure("member_mismatch",
      "generation contains a missing, extra, or duplicate material member");
  }
  for (const entry of entries) {
    const observed = await inspectCarrierSetMember(
      path.join(directory, entry.filename),
      entry.member_kind === "artifact"
        ? CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES : CONTROLLED_CONTRACT_MAX_JSON_BYTES,
      { filename: entry.filename }
    );
    if (observed.digest !== digestBytes(entry.bytes) ||
        observed.bytes.byteLength !== entry.bytes.byteLength) {
      carrierSetFailure("digest_mismatch", "generation member content differs", {
        filename: entry.filename
      });
    }
  }
  const contract = entries.find(({ carrier_kind: kind }) => kind === "contract");
  const plan = entries.find(({ carrier_kind: kind }) => kind === "proof_plan");
  try {
    const pkg = await loadControlledContractPackage();
    const assessed = await pkg.assessProofPlanFiles({
      inputPath: path.join(directory, contract.filename),
      proofPlanPath: path.join(directory, plan.filename)
    });
    const result = assessed.assessment.per_pack.find((entry) =>
      entry.profile_id === profile.profileId && entry.profile_version === profile.profileVersion);
    if (result?.profile_discrimination !== "proven") {
      carrierSetFailure("artifact_unresolvable",
        "staged artifact population did not prove the selected profile", {
          profile_discrimination: result?.profile_discrimination ?? null
        });
    }
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("artifact_unresolvable",
      "assessment consumer could not resolve the staged artifact population", {
        cause_code: error?.code ?? null
      });
  }
}

export async function validateControlledContractCarrierSetManifest({
  repoRoot, wkId, focus = null, repository, profile, manifest = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await resolveControlledContractRepository(repoRoot);
  let value = manifest;
  if (value === null) {
    const inspected = await inspectCarrierFile(carrierSetManifestPath(store, wkId, focus), {
      required: false
    });
    if (inspected === null) carrierSetFailure("manifest_missing",
      "carrier-set manifest is not published");
    value = inspected.bytes;
  }
  value = validatedCarrierSetManifest(value, {
    repository,
    wkId,
    focus: focus ?? null
  });
  if (isCanonicalAuthoringProfile(profile) ||
      value.profile?.profile_id === CANONICAL_AUTHORING_PROFILE_ID) {
    if (!isCanonicalAuthoringProfile(profile) ||
        value.profile?.profile_id !== CANONICAL_AUTHORING_PROFILE_ID ||
        value.profile?.profile_version !== CANONICAL_AUTHORING_PROFILE_VERSION) {
      carrierSetFailure("wrong_profile",
        "canonical-authoring manifest profile identity differs");
    }
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot, wkId, focus
    });
    if (resolved.source !== "manifest" ||
        resolved.generation !== value.generation?.id ||
        resolved.manifest_digest !== value.manifest_digest) {
      carrierSetFailure("manifest_mismatch",
        "canonical-authoring manifest did not re-resolve exactly");
    }
    return Object.freeze({
      schema_version: CARRIER_SET_SCHEMA_VERSION,
      wk_id: wkId,
      focus: focus ?? null,
      generation: resolved.generation,
      manifest_digest: resolved.manifest_digest,
      carrier_count: resolved.members.length,
      manifest: deepFreezePlainData(structuredClone(value))
    });
  }
  const normalizedProfile = normalizeControlledContractPackIdentity(profile ?? {});
  if (normalizedProfile.profileId !== INTEGRATION_CAPTURE_PROFILE.profileId ||
      normalizedProfile.profileVersion !== INTEGRATION_CAPTURE_PROFILE.profileVersion) {
    carrierSetFailure("wrong_profile",
      "carrier-set validation supports only the exact integration-prefix profile");
  }
  if (value.profile?.profile_id !== normalizedProfile.profileId ||
      value.profile?.profile_version !== normalizedProfile.profileVersion) {
    carrierSetFailure("wrong_profile", "carrier-set manifest profile identity differs");
  }
  const generationId = value.generation.id;
  const generationPath = value.generation.path;
  const generationDir = path.join(store.contracts, generationPath);
  const generationEntry = await lstat(generationDir).catch(() => null);
  if (!generationEntry?.isDirectory() || generationEntry.isSymbolicLink()) {
    carrierSetFailure("partial_generation", "manifest generation is absent");
  }
  const census = value.carrier_census;
  if (census.length <
      CARRIER_SET_CORE_KINDS.length + CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES.length + 1) {
    carrierSetFailure("manifest_mismatch", "manifest carrier census is incomplete");
  }
  const names = new Set();
  const observedEntries = [];
  for (const member of census) {
    if (member.member_kind !== "artifact") {
      const classification = classifyControlledContractRepositoryPath({
        wkId, repositoryPath: `wiki/contracts/${member.filename}`
      });
      const expectedMemberKind = classification.carrier_kind === "evaluation_input"
        ? "evaluation_input" : "carrier";
      if (classification.classification !== "active_member" ||
          classification.focus !== (focus ?? null) ||
          classification.carrier_kind !== member.carrier_kind ||
          member.member_kind !== expectedMemberKind) {
        carrierSetFailure("member_mismatch",
          "manifest-selected carrier repository identity is noncanonical", {
            filename: member.filename
          });
      }
    }
    names.add(member.filename);
    const inspected = await inspectCarrierSetMember(
      path.join(generationDir, member.filename),
      member.member_kind === "artifact"
        ? CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES : CONTROLLED_CONTRACT_MAX_JSON_BYTES, {
        filename: member.filename,
        generation: generationId,
        generation_path: generationPath,
        wk_id: wkId,
        focus: focus ?? null
      }
    );
    if (inspected.digest !== member.content_digest ||
        inspected.bytes.byteLength !== member.byte_length) carrierSetFailure("digest_mismatch",
      "manifest member content differs");
    observedEntries.push({
      member_kind: member.member_kind,
      ...(member.carrier_kind === undefined ? {} : { carrier_kind: member.carrier_kind }),
      ...(member.artifact_role === undefined ? {} : { artifact_role: member.artifact_role }),
      filename: member.filename,
      bytes: inspected.bytes,
      content: parseCarrierJson(inspected.bytes)
    });
  }
  const files = (await readdir(generationDir)).filter((name) => name !== "manifest.json");
  if (files.length !== names.size || files.some((name) => !names.has(name))) {
    carrierSetFailure("member_mismatch", "generation contains an extra carrier member");
  }
  const embedded = await inspectCarrierFile(path.join(generationDir, "manifest.json"), {
    required: true
  });
  if (embedded.digest !== digestBytes(
    canonicalControlledContractCarrierSetManifestBytes(value)
  )) carrierSetFailure(
    "manifest_mismatch", "embedded generation manifest differs from the visible manifest");
  const captureFields = [
    "dag", "evaluation_inputs", "request", "integration_units", "source_map", "paths",
    "branches", "bound_digests"
  ];
  const capture = Object.fromEntries(captureFields.map((field) => [field, value[field]]));
  await validateCarrierSetPopulation({
    wkId, focus, profile: normalizedProfile, entries: observedEntries, capture,
    verifyProofPlan: false
  });
  await validateCarrierSetDirectory({
    directory: generationDir, entries: observedEntries, profile: normalizedProfile
  });
  const expectedGeneration = carrierSetGenerationDigest({
    repository, wkId, focus, profile: normalizedProfile,
    entries: observedEntries,
    capture
  });
  if (expectedGeneration !== generationId) carrierSetFailure("manifest_mismatch",
    "manifest generation digest is invalid");
  return Object.freeze({
    schema_version: CARRIER_SET_SCHEMA_VERSION,
    wk_id: wkId,
    focus: focus ?? null,
    generation: generationId,
    manifest_digest: value.manifest_digest,
    carrier_count: census.length,
    manifest: deepFreezePlainData(structuredClone(value))
  });
}
