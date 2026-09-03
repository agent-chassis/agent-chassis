

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertControlledContractSourceLease,
  resolveCanonicalControlledContractCarrierSet
} from "./controlled-contract-carrier-set-tools.mjs";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES,
  DIGEST_PATTERN,
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

function sameJsonValue(left, right) {
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
const INTEGRATION_CAPTURE_PROFILE = Object.freeze({
  profileId: "proof.integration.prefix-safety",
  profileVersion: "1.0.0"
});

export function carrierSetFailure(code, message, details = {}) {
  fail(`controlled_contract_carrier_set_${code}`, message, details);
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

let canonicalAuthoringPublisherHook = null;
let controlledContractAuthorityExclusionHook = null;
const controlledContractAuthorityContexts = new WeakMap();

export function setCanonicalAuthoringPublisherHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("canonical authoring publisher hook must be a function or null");
  }
  canonicalAuthoringPublisherHook = hook;
}

export function setControlledContractAuthorityExclusionHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("controlled-contract authority exclusion hook must be a function or null");
  }
  controlledContractAuthorityExclusionHook = hook;
}

async function controlledContractAuthorityBoundary(boundary, details = {}) {
  if (controlledContractAuthorityExclusionHook !== null) {
    await controlledContractAuthorityExclusionHook(boundary, Object.freeze(details));
  }
}

async function canonicalAuthoringPublisherBoundary(boundary, details = {}) {
  if (canonicalAuthoringPublisherHook !== null) {
    await canonicalAuthoringPublisherHook(boundary, Object.freeze(details));
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

async function carrierSetInputs(input) {
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

function carrierSetCapture(input) {
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

function carrierSetEntryIdentity(entry) {
  return {
    member_kind: entry.member_kind,
    ...(entry.carrier_kind === undefined ? {} : { carrier_kind: entry.carrier_kind }),
    ...(entry.artifact_role === undefined ? {} : { artifact_role: entry.artifact_role }),
    filename: entry.filename,
    byte_length: entry.bytes.byteLength,
    bytes_base64: entry.bytes.toString("base64")
  };
}

function carrierSetGenerationDigest({ repository, wkId, focus, profile, entries, capture }) {
  return createHash("sha256").update(canonicalJsonBytes({
    repository,
    wk_id: wkId,
    focus: focus ?? null,
    profile: { profile_id: profile.profileId, profile_version: profile.profileVersion },
    carriers: entries.map(carrierSetEntryIdentity),
    ...capture
  })).digest("hex");
}

function carrierSetManifest({ input, entries, generation, generationPath, profile, capture }) {
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

function canonicalAuthoringProfile() {
  return Object.freeze({
    profile_id: CANONICAL_AUTHORING_PROFILE_ID,
    profile_version: CANONICAL_AUTHORING_PROFILE_VERSION
  });
}

function isCanonicalAuthoringProfile(value) {
  return value === CANONICAL_AUTHORING_PROFILE_ID ||
    value?.profileId === CANONICAL_AUTHORING_PROFILE_ID ||
    value?.profile_id === CANONICAL_AUTHORING_PROFILE_ID;
}

function canonicalAuthoringEntries(input) {
  if (!isPlainObject(input.canonical_members) ||
      Object.keys(input.canonical_members).length === 0) {
    carrierSetFailure("carrier_missing",
      "canonical authoring requires one complete nonempty basename-addressed population");
  }
  const entries = [];
  for (const filename of Object.keys(input.canonical_members).sort()) {
    const classification = classifyControlledContractCarrierBasename({
      wkId: input.wkId, basename: filename
    });
    if (classification.member !== true ||
        classification.focus !== (input.focus ?? null)) {
      carrierSetFailure("member_mismatch",
        "canonical authoring member basename is foreign or noncanonical", { filename });
    }
    const content = input.canonical_members[filename];
    if (!isPlainObject(content)) carrierSetFailure("carrier_invalid",
      "canonical authoring carriers must be plain JSON objects", { filename });
    const bytes = canonicalJsonBytes(content);
    if (bytes.byteLength === 0 || bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
      carrierSetFailure("carrier_invalid",
        "canonical authoring carrier exceeds its byte boundary", { filename });
    }
    entries.push({
      member_kind: classification.carrier_kind === "evaluation_input"
        ? "evaluation_input" : "carrier",
      carrier_kind: classification.carrier_kind,
      filename,
      content: structuredClone(content),
      bytes
    });
  }
  return entries;
}

async function validateCanonicalAuthoringEntries({ wkId, focus, entries }) {
  const byKind = new Map();
  for (const entry of entries) {
    const values = byKind.get(entry.carrier_kind) ?? [];
    values.push(entry);
    byKind.set(entry.carrier_kind, values);
  }
  for (const kind of ["contract", "proof_plan_request", "proof_plan"]) {
    if ((byKind.get(kind)?.length ?? 0) > 1) carrierSetFailure("member_mismatch",
      "canonical authoring generation repeats one singleton carrier kind", {
        carrier_kind: kind
      });
  }
  const pkg = await loadControlledContractPackage();
  const contract = byKind.get("contract")?.[0]?.content ?? null;
  if (contract !== null) {
    const validation = pkg.validateStableTestProofContract(contract);
    if (!validation.valid) carrierSetFailure("contract_invalid",
      "canonical authoring contract failed package validation", {
        diagnostics: validation.diagnostics
      });
  }
  const validateEvaluationInput = await generationEvaluationInputValidator(pkg);
  for (const evaluation of byKind.get("evaluation_input") ?? []) {
    if (!validateEvaluationInput(evaluation.content)) carrierSetFailure("evaluation_invalid",
      "canonical authoring evaluation input failed package schema validation", {
        filename: evaluation.filename,
        diagnostics: structuredClone(validateEvaluationInput.errors ?? [])
      });
  }
  const request = byKind.get("proof_plan_request")?.[0]?.content ?? null;
  if (request !== null) {
    if (contract === null || !Array.isArray(request.selected_packs)) {
      carrierSetFailure("generated_binding_invalid",
        "canonical proof-plan request has no complete contract binding");
    }
    const evaluations = Object.fromEntries((byKind.get("evaluation_input") ?? [])
      .map((entry) => [entry.filename, entry.content]));
    const missing = request.selected_packs.filter(({ evaluation_input_path: filename }) =>
      typeof filename !== "string" || !Object.hasOwn(evaluations, filename));
    if (missing.length > 0) carrierSetFailure("evaluation_population_mismatch",
      "canonical request references an absent generation member");
    let plan;
    try {
      plan = await pkg.buildProofPlan({ contract, request, evaluationInputs: evaluations });
    } catch (error) {
      carrierSetFailure("generated_binding_invalid",
        "canonical authoring population cannot build one proof plan", {
          cause_code: error?.code ?? null
        });
    }
    const persistedPlan = byKind.get("proof_plan")?.[0]?.content ?? null;
    if (persistedPlan !== null && !samePlainData(plan, persistedPlan)) {
      carrierSetFailure("proof_plan_stale",
        "canonical authoring proof plan differs from its exact generation sources");
    }
  } else if (byKind.has("proof_plan")) {
    carrierSetFailure("proof_plan_stale",
      "canonical proof plan cannot exist without its request");
  }
  void wkId;
  void focus;
}

function canonicalAuthoringGeneration({ input, entries }) {
  return createHash("sha256").update(canonicalJsonBytes({
    repository: input.repository,
    wk_id: input.wkId,
    focus: input.focus ?? null,
    profile: canonicalAuthoringProfile(),
    carriers: entries.map(carrierSetEntryIdentity)
  })).digest("hex");
}

function canonicalAuthoringManifest({ input, entries, generation, generationPath }) {
  const census = entries.map((entry) => ({
    member_kind: entry.member_kind,
    carrier_kind: entry.carrier_kind,
    filename: entry.filename,
    path: path.posix.join(generationPath, entry.filename),
    content_digest: digestBytes(entry.bytes),
    byte_length: entry.bytes.byteLength
  }));
  return constructControlledContractCarrierSetManifest({
    repository: input.repository,
    wkId: input.wkId,
    focus: input.focus ?? null,
    profile: canonicalAuthoringProfile(),
    generation,
    generationPath,
    members: census
  });
}

async function validateCanonicalAuthoringDirectory({ directory, entries, manifest }) {
  const expected = [...entries.map(({ filename }) => filename), "manifest.json"].sort();
  const observed = (await readdir(directory)).sort();
  if (!sameJsonValue(expected, observed)) carrierSetFailure("member_mismatch",
    "canonical authoring generation contains a missing or extra member");
  for (const entry of entries) {
    const inspected = await inspectCarrierSetMember(
      path.join(directory, entry.filename), CONTROLLED_CONTRACT_MAX_JSON_BYTES
    );
    if (inspected.digest !== digestBytes(entry.bytes) ||
        !inspected.bytes.equals(entry.bytes)) carrierSetFailure("digest_mismatch",
      "canonical authoring generation member bytes differ", { filename: entry.filename });
  }
  const embedded = await inspectCarrierSetMember(
    path.join(directory, "manifest.json"), CONTROLLED_CONTRACT_MAX_JSON_BYTES
  );
  const expectedManifest = canonicalControlledContractCarrierSetManifestBytes(manifest);
  if (!embedded.bytes.equals(expectedManifest)) carrierSetFailure("manifest_mismatch",
    "embedded canonical authoring manifest bytes differ");
}

export async function processStartIdentity(pid) {
  try {
    const statText = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = statText.lastIndexOf(")");
    const fields = statText.slice(close + 2).trim().split(/\s+/u);
    return fields[19] ?? null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const WK_AUTHORITY_LOCK_DIRECTORY = ".wk-authority-locks";
const WK_AUTHORITY_LOCK_OWNER_FILE = "owner.json";
const WK_AUTHORITY_LOCK_SCHEMA_VERSION = "controlled-contract-wk-authority-lock.v1";

function wkAuthorityLockFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wkAuthorityContextFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wkAuthorityLockRecord({ token, processStart }) {
  return Object.freeze({
    schema_version: WK_AUTHORITY_LOCK_SCHEMA_VERSION,
    token,
    process_id: process.pid,
    process_start_identity: processStart
  });
}

function validWkAuthorityLockRecord(value) {
  return isPlainObject(value) &&
    value.schema_version === WK_AUTHORITY_LOCK_SCHEMA_VERSION &&
    typeof value.token === "string" && /^[0-9a-f-]{36}$/u.test(value.token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" && value.process_start_identity.length > 0;
}

async function acquireWkAuthorityLock({ contracts, wkId }) {
  const processStart = await processStartIdentity(process.pid);
  if (processStart === null) throw wkAuthorityLockFailure(
    "controlled_contract_wk_authority_lock_unavailable",
    "controlled-contract WK authority lock cannot bind the current process identity"
  );
  const directory = path.join(contracts, WK_AUTHORITY_LOCK_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const record = wkAuthorityLockRecord({ token, processStart });
  const candidate = path.join(directory, `.${wkId}.candidate-${token}`);
  const lock = path.join(directory, `${wkId}.lock`);
  await mkdir(candidate, { mode: 0o700 });
  try {
    await writeFile(path.join(candidate, WK_AUTHORITY_LOCK_OWNER_FILE), canonicalJsonBytes(record), {
      flag: "wx", mode: 0o600
    });
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await rename(candidate, lock);
        return Object.freeze({ lock, token });
      } catch (error) {
        if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      }
      let owner;
      try {
        owner = parseCarrierJson(await readFile(path.join(lock, WK_AUTHORITY_LOCK_OWNER_FILE)));
      } catch (error) {
        if (error?.code === "ENOENT") {
          await delay(10);
          continue;
        }
        throw wkAuthorityLockFailure(
          "controlled_contract_wk_authority_lock_unavailable",
          "controlled-contract WK authority lock owner is unverifiable"
        );
      }
      if (!validWkAuthorityLockRecord(owner)) throw wkAuthorityLockFailure(
        "controlled_contract_wk_authority_lock_unavailable",
        "controlled-contract WK authority lock owner is malformed"
      );
      let observedStart;
      try {
        observedStart = await processStartIdentity(owner.process_id);
      } catch {
        throw wkAuthorityLockFailure(
          "controlled_contract_wk_authority_lock_unavailable",
          "controlled-contract WK authority lock owner liveness is unverifiable"
        );
      }
      if (observedStart === owner.process_start_identity) {
        await delay(10);
        continue;
      }
      const stale = path.join(directory, `.${wkId}.stale-${owner.token}-${token}`);
      try {
        await rename(lock, stale);
        await rm(stale, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EEXIST" &&
            error?.code !== "ENOTEMPTY") throw error;
      }
      await delay(10);
    }
    throw wkAuthorityLockFailure(
      "controlled_contract_wk_authority_lock_timeout",
      "controlled-contract WK authority lock acquisition timed out"
    );
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

async function releaseWkAuthorityLock(locked) {
  if (locked === null) return;
  const owner = parseCarrierJson(await readFile(path.join(locked.lock, WK_AUTHORITY_LOCK_OWNER_FILE)));
  if (!validWkAuthorityLockRecord(owner) || owner.token !== locked.token) {
    throw wkAuthorityLockFailure(
      "controlled_contract_wk_authority_lock_ownership_changed",
      "controlled-contract WK authority lock ownership changed"
    );
  }
  const released = `${locked.lock}.released-${locked.token}`;
  await rename(locked.lock, released);
  await rm(released, { recursive: true, force: true });
  try {
    await rmdir(path.dirname(locked.lock));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
}

export async function withControlledContractAuthorityExclusion({ repoRoot, wkId, run } = {}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (typeof run !== "function") throw new TypeError("controlled-contract authority exclusion requires one callback");
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot) || path.resolve(repoRoot) !== repoRoot) {
    throw new TypeError("controlled-contract authority exclusion requires one normalized absolute repository root");
  }

  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true, mode: 0o700 });
  const locked = await acquireWkAuthorityLock({ contracts, wkId });
  const authorityContext = Object.freeze({});
  const contextState = { repoRoot, wkId, active: true };
  controlledContractAuthorityContexts.set(authorityContext, contextState);
  try {
    await controlledContractAuthorityBoundary("authority_lock_acquired", { wk_id: wkId });
    return await run(authorityContext);
  } finally {
    contextState.active = false;
    try {
      await controlledContractAuthorityBoundary("authority_lock_releasing", { wk_id: wkId });
    } finally {
      await releaseWkAuthorityLock(locked);
    }
  }
}

export async function runWithControlledContractAuthorityContext({
  repoRoot, wkId, authorityContext, run
} = {}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (typeof run !== "function") {
    throw new TypeError("controlled-contract authority context requires one callback");
  }
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot) ||
      path.resolve(repoRoot) !== repoRoot) {
    throw new TypeError(
      "controlled-contract authority context requires one normalized absolute repository root"
    );
  }
  if ((typeof authorityContext !== "object" || authorityContext === null) &&
      typeof authorityContext !== "function") {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_invalid",
      "controlled-contract WK authority context is invalid"
    );
  }
  const state = controlledContractAuthorityContexts.get(authorityContext);
  if (state === undefined) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_invalid",
      "controlled-contract WK authority context is not owner-authenticated"
    );
  }
  if (state.active !== true) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_stale",
      "controlled-contract WK authority context is outside its live callback"
    );
  }
  if (state.repoRoot !== repoRoot || state.wkId !== wkId) {
    throw wkAuthorityContextFailure(
      "controlled_contract_wk_authority_context_mismatch",
      "controlled-contract WK authority context does not match repository and WK"
    );
  }
  return await run();
}

function publicationLockRecord({ operationToken, generation, stagingName,
  temporaryManifestName, processStart }) {
  return {
    schema_version: "controlled-contract-carrier-set-lock.v1",
    operation_token: operationToken,
    process_id: process.pid,
    process_start_identity: processStart,
    generation,
    staging_name: stagingName,
    temporary_manifest_name: temporaryManifestName
  };
}

function validPublicationLockRecord(value) {
  return isPlainObject(value) &&
    value.schema_version === "controlled-contract-carrier-set-lock.v1" &&
    typeof value.operation_token === "string" &&
    /^[0-9a-f-]{36}$/u.test(value.operation_token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" &&
    value.process_start_identity.length > 0 &&
    typeof value.generation === "string" && /^[0-9a-f]{64}$/u.test(value.generation) &&
    value.staging_name === `.carrier-set-staging-${value.operation_token}` &&
    value.temporary_manifest_name === `.carrier-set-manifest-tmp-${value.operation_token}`;
}

async function createPublicationLock(lockPath, record) {
  await writeFile(lockPath, canonicalJsonBytes(record), { flag: "wx", mode: 0o600 });
  return { lock: lockPath, record };
}

async function reconcileDeadPublication({ store, manifestPath, dead, quarantine }) {
  await rm(path.join(store.contracts, dead.staging_name), {
    recursive: true, force: true
  });
  await rm(path.join(path.dirname(manifestPath), dead.temporary_manifest_name), {
    force: true
  });
  let selectedGeneration = null;
  try {
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    selectedGeneration = visible === null
      ? null : parseControlledContractCarrierSetManifest(visible.bytes).generation.id;
  } catch {
    selectedGeneration = null;
  }
  if (selectedGeneration !== dead.generation) {
    await rm(path.join(store.contracts, ".carrier-generations", dead.generation), {
      recursive: true, force: true
    });
  }
  await rm(quarantine, { force: true });
}

async function acquireCarrierSetPublicationLock({ store, manifestPath, record }) {
  const lockPath = `${manifestPath}.cas-lock`;
  try {
    return await createPublicationLock(lockPath, record);
  } catch (error) {
    if (error?.code !== "EEXIST") carrierSetFailure("busy",
      "canonical carrier set lock could not be created", {
        cause_code: error?.code ?? null
      });
  }
  let dead;
  try {
    dead = parseCarrierJson((await readFile(lockPath)).toString("utf8"));
  } catch {
    carrierSetFailure("busy",
      "canonical carrier set owner is unverifiable and remains untouched", {
        owner_state: "unverifiable"
      });
  }
  if (!validPublicationLockRecord(dead)) carrierSetFailure("busy",
    "canonical carrier set owner is unverifiable and remains untouched", {
      owner_state: "unverifiable"
    });
  let observedStart;
  try {
    observedStart = await processStartIdentity(dead.process_id);
  } catch {
    carrierSetFailure("busy",
      "canonical carrier set owner liveness is unverifiable and remains untouched", {
        owner_state: "unverifiable"
      });
  }
  if (observedStart === dead.process_start_identity) carrierSetFailure("busy",
    "canonical carrier set has a live concurrent writer", { owner_state: "live" });
  const quarantine = `${lockPath}.stale-${dead.operation_token}-${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch (error) {
    carrierSetFailure("busy", "stale-lock quarantine lost the ownership race", {
      cause_code: error?.code ?? null
    });
  }
  let acquired;
  try {
    acquired = await createPublicationLock(lockPath, record);
  } catch (error) {
    carrierSetFailure("busy", "fresh exclusive carrier-set acquisition lost", {
      cause_code: error?.code ?? null
    });
  }
  await reconcileDeadPublication({ store, manifestPath, dead, quarantine });
  return acquired;
}

async function releaseCarrierSetPublicationLock(locked) {
  if (!locked) return;
  await unlink(locked.lock).catch(() => {});
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

async function validateCarrierSetPopulation({
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
  const exactCapture = selected[0].exact_capture;
  const expectedSources = Object.fromEntries([...CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES].sort()
    .map((role) => [role, {
      kind: "artifact_file",
      relative_path: artifacts.get(role).filename
    }]));
  if (!isPlainObject(exactCapture) || exactCapture.capture_root !== "." ||
      exactCapture.contract_path !== core.get("contract").filename ||
      exactCapture.evaluation_input_path !== selected[0].evaluation_input_path ||
      !samePlainData(exactCapture.sources, expectedSources)) {
    carrierSetFailure("artifact_unresolvable",
      "exact capture does not resolve the material generation member population");
  }

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

export async function inspectCarrierSetMember(file, maximumBytes) {
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || await realpath(file) !== file) {
      carrierSetFailure("member_mismatch", "generation member is not one exact regular file");
    }
    const bytes = await readFile(file);
    if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
      carrierSetFailure("member_mismatch", "generation member exceeds its exact byte boundary");
    }
    return { bytes, digest: digestBytes(bytes) };
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("partial_generation", "generation member is absent or unreadable", {
      cause_code: error?.code ?? null
    });
  }
}

async function validateCarrierSetDirectory({ directory, entries, profile }) {
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
        ? CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES : CONTROLLED_CONTRACT_MAX_JSON_BYTES
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
    if (result?.profile_discrimination !== "proven" || result?.exact_binding !== "proven") {
      carrierSetFailure("artifact_unresolvable",
        "staged exact-capture population did not prove the selected profile", {
          profile_discrimination: result?.profile_discrimination ?? null,
          exact_binding: result?.exact_binding ?? null
        });
    }
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("artifact_unresolvable",
      "exact-binding consumer could not resolve the staged artifact population", {
        cause_code: error?.code ?? null
      });
  }
}

export async function readControlledContractCarrierSetManifestDigest({
  repoRoot, wkId, focus = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await resolveControlledContractRepository(repoRoot);
  const inspected = await inspectCarrierFile(
    carrierSetManifestPath(store, wkId, focus), { required: false }
  );
  return inspected?.digest ?? null;
}

export async function settleControlledContractRefactorTransaction({
  assertSourceLease,
  participants
}) {
  if (typeof assertSourceLease !== "function" || !Array.isArray(participants) ||
      participants.length === 0 || participants.some((participant) =>
        !isPlainObject(participant) || typeof participant.name !== "string" ||
        typeof participant.prepare !== "function") ||
      participants.filter(({ terminal }) => terminal === true).length > 1 ||
      (participants.some(({ terminal }) => terminal === true) &&
        participants.at(-1).terminal !== true)) {
    carrierSetFailure("input_invalid",
      "refactor settlement requires one lease assertion and closed participant population");
  }
  const prepared = [];
  const committed = [];
  let terminalCommitted = false;
  try {
    await assertSourceLease();
    await canonicalAuthoringPublisherBoundary("refactor_source_lease_verified");
    for (const participant of participants) {
      await canonicalAuthoringPublisherBoundary("refactor_prepare", {
        participant: participant.name
      });
      const value = await participant.prepare();
      if (!isPlainObject(value) || typeof value.commit !== "function" ||
          typeof value.compensate !== "function" ||
          (value.finalize !== undefined && typeof value.finalize !== "function")) {
        carrierSetFailure("input_invalid",
        "refactor participant preparation returned no commit/compensate pair", {
          participant: participant.name
        });
      }
      prepared.push({ name: participant.name, value,
        terminal: participant.terminal === true });
      await assertSourceLease();
    }
    const receipts = {};
    const terminal = prepared.find(({ terminal: isTerminal }) => isTerminal) ?? null;
    for (const entry of prepared.filter(({ terminal: isTerminal }) => !isTerminal)) {
      await assertSourceLease();
      await canonicalAuthoringPublisherBoundary("refactor_commit", {
        participant: entry.name
      });
      receipts[entry.name] = await entry.value.commit();
      committed.push(entry);
    }
    await assertSourceLease();
    await canonicalAuthoringPublisherBoundary("refactor_settlement_verified");
    if (terminal !== null) {
      receipts[terminal.name] = await terminal.value.commit();
      committed.push(terminal);
      terminalCommitted = true;
    }
    for (const entry of [...prepared].reverse()) {
      if (entry !== terminal && typeof entry.value.finalize === "function") {
        await entry.value.finalize();
      }
    }
    return Object.freeze({
      schema_version: "controlled-contract-refactor-atomic-settlement.v1",
      status: "committed",
      receipts: deepFreezePlainData(receipts),
      committed_participants: Object.freeze(committed.map(({ name }) => name))
    });
  } catch (error) {
    if (terminalCommitted) throw error;
    const failures = [];
    for (const entry of [...prepared].reverse()) {
      try {
        await canonicalAuthoringPublisherBoundary("refactor_compensate", {
          participant: entry.name
        });
        await entry.value.compensate({
          committed: committed.includes(entry)
        });
      } catch (compensationError) {
        failures.push({ participant: entry.name,
          cause_code: compensationError?.code ?? null });
      }
    }
    if (failures.length > 0) carrierSetFailure("write_failed",
      "refactor settlement compensation could not prove fully uncommitted state", {
        cause_code: error?.code ?? null,
        compensation_failures: failures
      });
    throw error;
  }
}

export async function prepareControlledContractRefactorCarrierSettlement(input) {
  if (!isPlainObject(input) || input.profile !== CANONICAL_AUTHORING_PROFILE_ID) {
    carrierSetFailure("input_invalid",
      "refactor carrier settlement requires one canonical-authoring publication");
  }
  const store = await resolveControlledContractRepository(input.repoRoot);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const prior = await inspectCarrierFile(manifestPath, { required: false });
  if ((prior?.digest ?? null) !== input.expected_manifest_digest) carrierSetFailure(
    "stale_manifest", "visible carrier-set manifest changed before refactor preparation", {
      expected_manifest_digest: input.expected_manifest_digest,
      actual_manifest_digest: prior?.digest ?? null
    });
  const entries = canonicalAuthoringEntries(input);
  await validateCanonicalAuthoringEntries({ wkId: input.wkId,
    focus: input.focus ?? null, entries });
  const prospectiveGeneration = canonicalAuthoringGeneration({ input, entries });
  const generationDir = path.join(store.contracts, ".carrier-generations",
    prospectiveGeneration);
  const generationExisted = (await lstat(generationDir).catch(() => null)) !== null;
  let publication = null;
  return Object.freeze({
    commit: async () => {
      publication = await writeControlledContractCarrierSet(input);
      return publication;
    },
    compensate: async () => {
      if (publication === null || publication.no_op === true) return;
      await withControlledContractAuthorityExclusion({ repoRoot: store.repository,
        wkId: input.wkId, run: async () => {
          const current = await inspectCarrierFile(manifestPath, { required: false });
          if (current?.digest !== publication.manifest_content_digest) carrierSetFailure(
            "stale_manifest",
            "refactor compensation cannot replace a concurrently selected generation", {
              expected_manifest_digest: publication.manifest_content_digest,
              actual_manifest_digest: current?.digest ?? null
            });
          const rollback = `${manifestPath}.rollback-${randomUUID()}`;
          if (prior === null) await unlink(manifestPath);
          else {
            await writeFile(rollback, prior.bytes, { flag: "wx", mode: 0o600 });
            await rename(rollback, manifestPath);
          }
          if (!generationExisted) await rm(generationDir, { recursive: true, force: false });
          const restored = await inspectCarrierFile(manifestPath, { required: false });
          if ((restored?.digest ?? null) !== (prior?.digest ?? null) ||
              (!generationExisted && (await lstat(generationDir).catch(() => null)) !== null)) {
            carrierSetFailure("write_failed",
              "refactor carrier compensation could not verify the exact prior selection");
          }
        } });
    }
  });
}

async function publishCanonicalAuthoringGenerationUnderAuthority({
  input, store, expectedManifestDigest, publicationOwner, assertSources
}) {
  const entries = canonicalAuthoringEntries(input);
  await validateCanonicalAuthoringEntries({
    wkId: input.wkId, focus: input.focus ?? null, entries
  });
  const generation = canonicalAuthoringGeneration({ input, entries });
  const generationPath = path.posix.join(".carrier-generations", generation);
  const generationDir = path.join(store.contracts, generationPath);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const operationToken = publicationOwner.operationToken;
  const stagingName = `.carrier-set-staging-${operationToken}`;
  const temporaryManifestName = `.carrier-set-manifest-tmp-${operationToken}`;
  const staging = path.join(store.contracts, stagingName);
  const temporaryManifest = path.join(store.contracts, temporaryManifestName);
  const processStart = publicationOwner.processStart;
  const lockRecord = publicationLockRecord({
    operationToken, generation, stagingName, temporaryManifestName, processStart
  });
  const manifest = canonicalAuthoringManifest({
    input, entries, generation, generationPath
  });
  const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);
  let locked;
  let generationCreated = false;
  let manifestSwitched = false;
  let priorManifestBytes = null;
  try {
    locked = await acquireCarrierSetPublicationLock({
      store, manifestPath, record: lockRecord
    });
    await canonicalAuthoringPublisherBoundary("publication_lock_acquired");
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    if ((visible?.digest ?? null) !== expectedManifestDigest) carrierSetFailure(
      "stale_manifest", "visible carrier-set manifest changed", {
        expected_manifest_digest: expectedManifestDigest,
        actual_manifest_digest: visible?.digest ?? null
      });
    priorManifestBytes = visible?.bytes ?? null;
    await assertSources();
    await canonicalAuthoringPublisherBoundary("initial_sources_verified");

    if (visible?.bytes.equals(manifestBytes)) {
      await validateCanonicalAuthoringDirectory({
        directory: generationDir, entries, manifest
      });
      const resolved = await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null
      });
      if (resolved.generation !== generation || resolved.members.length !== entries.length ||
          entries.some((entry) =>
            resolved.members_by_basename[entry.filename]?.content_digest !==
              digestBytes(entry.bytes))) carrierSetFailure("manifest_mismatch",
        "exact replay did not re-resolve the planned canonical generation");
      return Object.freeze({
        schema_version: CARRIER_SET_SCHEMA_VERSION,
        profile: CANONICAL_AUTHORING_PROFILE_ID,
        wk_id: input.wkId,
        focus: input.focus ?? null,
        generation,
        manifest_digest: manifest.manifest_digest,
        manifest_content_digest: digestBytes(manifestBytes),
        manifest_path: path.basename(manifestPath),
        carrier_count: entries.length,
        written: false,
        no_op: true
      });
    }

    await mkdir(staging, { recursive: false, mode: 0o700 });
    await canonicalAuthoringPublisherBoundary("staging_created", { stagingName });
    for (const entry of entries) {
      await writeFile(path.join(staging, entry.filename), entry.bytes,
        { flag: "wx", mode: 0o600 });
      await canonicalAuthoringPublisherBoundary("member_written", {
        filename: entry.filename
      });
    }
    await writeFile(path.join(staging, "manifest.json"), manifestBytes,
      { flag: "wx", mode: 0o600 });
    await canonicalAuthoringPublisherBoundary("embedded_manifest_written");
    await validateCanonicalAuthoringDirectory({ directory: staging, entries, manifest });
    await canonicalAuthoringPublisherBoundary("staging_verified");
    await mkdir(path.dirname(generationDir), { recursive: true });
    await canonicalAuthoringPublisherBoundary("before_generation_rename");
    try {
      await rename(staging, generationDir);
      generationCreated = true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      await rm(staging, { recursive: true, force: true });
    }
    await canonicalAuthoringPublisherBoundary("after_generation_rename", { generation });
    await validateCanonicalAuthoringDirectory({ directory: generationDir, entries, manifest });
    await canonicalAuthoringPublisherBoundary("generation_verified", { generation });
    await assertSources();
    await canonicalAuthoringPublisherBoundary("pre_manifest_sources_verified");
    await canonicalAuthoringPublisherBoundary("before_temporary_manifest_write");
    await writeFile(temporaryManifest, manifestBytes, { flag: "wx", mode: 0o600 });
    await canonicalAuthoringPublisherBoundary("after_temporary_manifest_write", {
      temporaryManifestName
    });
    const temporary = await inspectCarrierFile(temporaryManifest, { required: true });
    if (!temporary.bytes.equals(manifestBytes)) carrierSetFailure("manifest_mismatch",
      "temporary canonical manifest bytes differ before switch");
    await canonicalAuthoringPublisherBoundary("temporary_manifest_verified");
    await assertSources();
    await canonicalAuthoringPublisherBoundary("pre_switch_sources_verified");
    await canonicalAuthoringPublisherBoundary("before_manifest_switch");
    await rename(temporaryManifest, manifestPath);
    manifestSwitched = true;
    await canonicalAuthoringPublisherBoundary("after_manifest_switch", { generation });
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null
    });
    if (resolved.generation !== generation || resolved.members.length !== entries.length ||
        entries.some((entry) =>
          resolved.members_by_basename[entry.filename]?.content_digest !==
            digestBytes(entry.bytes))) carrierSetFailure("manifest_mismatch",
      "post-publication canonical generation re-resolution differs");
    await canonicalAuthoringPublisherBoundary("published_generation_verified", { generation });
    return Object.freeze({
      schema_version: CARRIER_SET_SCHEMA_VERSION,
      profile: CANONICAL_AUTHORING_PROFILE_ID,
      wk_id: input.wkId,
      focus: input.focus ?? null,
      generation,
      manifest_digest: manifest.manifest_digest,
      manifest_content_digest: digestBytes(manifestBytes),
      manifest_path: path.basename(manifestPath),
      carrier_count: entries.length,
      written: true,
      no_op: false
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(temporaryManifest, { force: true }).catch(() => {});
    if (manifestSwitched) {
      if (priorManifestBytes === null) await unlink(manifestPath).catch(() => {});
      else {
        const rollback = `${manifestPath}.rollback-${operationToken}`;
        await writeFile(rollback, priorManifestBytes, { flag: "wx", mode: 0o600 })
          .then(() => rename(rollback, manifestPath))
          .catch(() => {});
      }
    }
    if (generationCreated) {
      const current = await inspectCarrierFile(manifestPath, { required: false })
        .catch(() => null);
      const currentManifest = current === null
        ? null : parseControlledContractCarrierSetManifest(current.bytes);
      if (currentManifest?.generation?.id !== generation) {
        await rm(generationDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("write_failed", "canonical carrier set could not be published", {
      cause_code: error?.code ?? null
    });
  } finally {
    await releaseCarrierSetPublicationLock(locked);
  }
}

async function publishCanonicalAuthoringGeneration(args) {
  return withControlledContractAuthorityExclusion({
    repoRoot: args.store.repository,
    wkId: args.input.wkId,
    run: () => publishCanonicalAuthoringGenerationUnderAuthority(args)
  });
}

export async function writeControlledContractCarrierSet(input) {
  if (!isPlainObject(input)) carrierSetFailure("input_invalid", "input must be one plain object");
  normalizeControlledContractIdentity({ wkId: input.wkId, focus: input.focus ?? null });
  if (typeof input.repository !== "string" || input.repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  const canonicalAuthoring = isCanonicalAuthoringProfile(input.profile);
  const profile = canonicalAuthoring
    ? null : normalizeControlledContractPackIdentity(input.profile ?? {});
  if (!canonicalAuthoring && (profile.profileId !== INTEGRATION_CAPTURE_PROFILE.profileId ||
      profile.profileVersion !== INTEGRATION_CAPTURE_PROFILE.profileVersion)) {
    carrierSetFailure("wrong_profile",
      "carrier-set publication supports only the exact integration-prefix profile");
  }
  const expectedManifestDigest = input.expected_manifest_digest;
  if (expectedManifestDigest !== null && (typeof expectedManifestDigest !== "string" ||
      !DIGEST_PATTERN.test(expectedManifestDigest))) carrierSetFailure("expected_manifest_invalid",
    "expected_manifest_digest must be null or one exact sha256 digest");
  const store = await resolveControlledContractRepository(input.repoRoot);
  const leaseState = await assertControlledContractSourceLease(input.sourceLease, {
    repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
    repository: input.repository
  });
  if (canonicalAuthoring) {
    return publishCanonicalAuthoringGeneration({
      input,
      store,
      expectedManifestDigest,
      publicationOwner: leaseState.publicationOwner,
      assertSources: () => assertControlledContractSourceLease(input.sourceLease, {
        repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
        repository: input.repository
      })
    });
  }
  const entries = await carrierSetInputs(input);
  const capture = carrierSetCapture(input);
  await validateCarrierSetPopulation({
    wkId: input.wkId, focus: input.focus ?? null, profile, entries, capture
  });
  const generation = carrierSetGenerationDigest({
    repository: input.repository, wkId: input.wkId, focus: input.focus ?? null,
    profile, entries, capture
  });
  const generationPath = path.posix.join(".carrier-generations", generation);
  const generationDir = path.join(store.contracts, generationPath);
  const manifestPath = carrierSetManifestPath(store, input.wkId, input.focus ?? null);
  const operationToken = leaseState.publicationOwner.operationToken;
  const stagingName = `.carrier-set-staging-${operationToken}`;
  const temporaryManifestName = `.carrier-set-manifest-tmp-${operationToken}`;
  const staging = path.join(store.contracts, stagingName);
  const temporaryManifest = path.join(store.contracts, temporaryManifestName);
  const processStart = leaseState.publicationOwner.processStart;
  let setLock;
  let generationCreated = false;
  setLock = await acquireCarrierSetPublicationLock({
    store,
    manifestPath,
    record: publicationLockRecord({
      operationToken, generation, stagingName, temporaryManifestName, processStart
    })
  });
  try {
    const visible = await inspectCarrierFile(manifestPath, { required: false });
    if ((visible?.digest ?? null) !== expectedManifestDigest) carrierSetFailure("stale_manifest",
      "visible carrier-set manifest changed", {
        expected_manifest_digest: expectedManifestDigest,
        actual_manifest_digest: visible?.digest ?? null
      });
    await mkdir(staging, { recursive: false, mode: 0o700 });
    for (const entry of entries) await writeFile(path.join(staging, entry.filename), entry.bytes,
      { flag: "wx", mode: 0o600 });
    const manifest = carrierSetManifest({
      input, entries, generation, generationPath, profile, capture
    });
    const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);
    await writeFile(path.join(staging, "manifest.json"), manifestBytes,
      { flag: "wx", mode: 0o600 });
    await validateCarrierSetDirectory({ directory: staging, entries, profile });
    await mkdir(path.dirname(generationDir), { recursive: true });
    try {
      await rename(staging, generationDir);
      generationCreated = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await rm(staging, { recursive: true, force: true });
    }
    await validateCarrierSetDirectory({ directory: generationDir, entries, profile });
    await assertControlledContractSourceLease(input.sourceLease, {
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
      repository: input.repository
    });
    await writeFile(temporaryManifest, manifestBytes, { flag: "wx", mode: 0o600 });
    await assertControlledContractSourceLease(input.sourceLease, {
      repoRoot: store.repository, wkId: input.wkId, focus: input.focus ?? null,
      repository: input.repository
    });
    await rename(temporaryManifest, manifestPath);
    return Object.freeze({
      schema_version: CARRIER_SET_SCHEMA_VERSION,
      wk_id: input.wkId,
      focus: input.focus ?? null,
      generation,
      manifest_digest: manifest.manifest_digest,
      manifest_content_digest: digestBytes(manifestBytes),
      manifest_path: path.basename(manifestPath),
      carrier_count: entries.length,
      written: true
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (generationCreated) {
      await rm(generationDir, { recursive: true, force: true }).catch(() => {});
    }
    await rm(temporaryManifest, { force: true }).catch(() => {});
    if (error instanceof ControlledContractToolError) throw error;
    carrierSetFailure("write_failed", "canonical carrier set could not be published",
      { cause_code: error?.code ?? null });
  } finally {
    await releaseCarrierSetPublicationLock(setLock);
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
        ? CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES : CONTROLLED_CONTRACT_MAX_JSON_BYTES
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

export const CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION =
  "controlled-contract-carrier-generation-receipt.v1";

export const CONTROLLED_CONTRACT_CARRIER_ROLLBACK_CAUSE_CODES = Object.freeze([
  "carrier_manifest_concurrently_mutated",
  "carrier_generation_concurrently_mutated",
  "carrier_manifest_removal_failed",
  "carrier_generation_removal_failed",
  "carrier_rollback_absence_unverified",
  "carrier_rollback_lock_unavailable"
]);

function carrierGenerationReceipt({ wkId, focus, store, manifestPath, published, entries }) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION,
    wk_id: wkId,
    focus: focus ?? null,
    generation: published.generation,
    generation_path: path.posix.join(".carrier-generations", published.generation),
    manifest_basename: path.basename(manifestPath),
    manifest_digest: published.manifest_digest,
    manifest_content_digest: published.manifest_content_digest,
    carrier_count: published.carrier_count,
    members: Object.freeze(entries.map((entry) => Object.freeze({
      carrier_kind: entry.carrier_kind,
      filename: entry.filename,
      content_digest: digestBytes(entry.bytes)
    }))),
    repository_root: store.repository
  });
}

export async function validateNewControlledContractCarrierMembers({
  wkId, focus = null, repository, members
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof repository !== "string" || repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  if (!isPlainObject(members) || Object.keys(members).length === 0) {
    carrierSetFailure("carrier_missing",
      "new-generation publication requires one nonempty basename-addressed carrier population");
  }
  const entries = canonicalAuthoringEntries({
    repository, wkId, focus: focus ?? null, canonical_members: members
  });
  await validateCanonicalAuthoringEntries({ wkId, focus: focus ?? null, entries });
  return entries.map((entry) => Object.freeze({
    carrier_kind: entry.carrier_kind,
    filename: entry.filename,
    content_digest: digestBytes(entry.bytes),
    byte_length: entry.bytes.byteLength
  }));
}

export async function publishNewControlledContractCarrierGeneration({
  repoRoot, wkId, focus = null, repository, members
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof repository !== "string" || repository.length === 0) {
    carrierSetFailure("repository_missing", "carrier set requires one durable repository identity");
  }
  if (!isPlainObject(members) || Object.keys(members).length === 0) {
    carrierSetFailure("carrier_missing",
      "new-generation publication requires one nonempty basename-addressed carrier population");
  }
  const store = await resolveControlledContractRepository(repoRoot);
  const processStart = await processStartIdentity(process.pid).catch(() => null);
  if (processStart === null) {
    carrierSetFailure("busy", "carrier-set publication cannot bind the current process identity");
  }
  const input = {
    repoRoot: store.repository,
    repository,
    wkId,
    focus: focus ?? null,
    profile: CANONICAL_AUTHORING_PROFILE_ID,
    canonical_members: members
  };
  const entries = canonicalAuthoringEntries(input);
  const published = await publishCanonicalAuthoringGeneration({
    input,
    store,
    expectedManifestDigest: null,
    publicationOwner: Object.freeze({ operationToken: randomUUID(), processStart }),
    assertSources: async () => {}
  });
  if (published.written !== true) {
    carrierSetFailure("manifest_mismatch",
      "new-generation publication resolved an already-published generation for a new identity", {
        generation: published.generation
      });
  }
  return carrierGenerationReceipt({
    wkId,
    focus: focus ?? null,
    store,
    manifestPath: carrierSetManifestPath(store, wkId, focus ?? null),
    published,
    entries
  });
}

function carrierRollbackFailure(causeCode, details = {}) {
  return Object.freeze({
    ok: false,
    verified_absent: false,
    cause_code: causeCode,
    removed: Object.freeze({ manifest: false, generation: false }),
    details: Object.freeze(details)
  });
}

async function readVisibleManifestDigest(manifestPath) {
  const inspected = await inspectCarrierFile(manifestPath, { required: false });
  return inspected?.digest ?? null;
}

async function embeddedGenerationManifestDigest(generationDir) {
  const inspected = await inspectCarrierFile(path.join(generationDir, "manifest.json"), {
    required: false
  });
  return inspected?.digest ?? null;
}

export async function rollbackControlledContractCarrierSetPublication({ repoRoot, receipt }) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      reason: "receipt is not one exact carrier-generation publication receipt"
    });
  }
  try {
    return await withControlledContractAuthorityExclusion({
      repoRoot,
      wkId: receipt.wk_id,
      run: () => rollbackControlledContractCarrierSetPublicationUnderAuthority({ repoRoot, receipt })
    });
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_lock_unavailable", {
      cause: error?.code ?? null
    });
  }
}

async function rollbackControlledContractCarrierSetPublicationUnderAuthority({ repoRoot, receipt }) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== CONTROLLED_CONTRACT_CARRIER_GENERATION_RECEIPT_SCHEMA_VERSION) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      reason: "receipt is not one exact carrier-generation publication receipt"
    });
  }
  let store;
  try {
    store = await resolveControlledContractRepository(repoRoot);
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      cause: error?.code ?? null
    });
  }
  const manifestPath = carrierSetManifestPath(store, receipt.wk_id, receipt.focus ?? null);
  const generationDir = path.join(store.contracts, receipt.generation_path);
  let locked = null;
  let removedManifest = false;
  let removedGeneration = false;
  try {
    try {

      const operationToken = randomUUID();
      locked = await acquireCarrierSetPublicationLock({
        store,
        manifestPath,
        record: publicationLockRecord({
          operationToken,
          generation: receipt.generation,
          stagingName: `.carrier-set-staging-${operationToken}`,
          temporaryManifestName: `.carrier-set-manifest-tmp-${operationToken}`,
          processStart: await processStartIdentity(process.pid).catch(() => null)
        })
      });
    } catch (error) {
      return carrierRollbackFailure("carrier_rollback_lock_unavailable", {
        cause: error?.code ?? null
      });
    }

    const visibleDigest = await readVisibleManifestDigest(manifestPath);
    if (visibleDigest !== null) {
      if (visibleDigest !== receipt.manifest_content_digest) {
        return carrierRollbackFailure("carrier_manifest_concurrently_mutated", {
          expected_manifest_content_digest: receipt.manifest_content_digest,
          actual_manifest_content_digest: visibleDigest
        });
      }
      try {
        await unlink(manifestPath);
        removedManifest = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return carrierRollbackFailure("carrier_manifest_removal_failed", {
            cause: error?.code ?? null
          });
        }
      }
    }

    const generationEntry = await lstat(generationDir).catch(() => null);
    if (generationEntry !== null) {
      const embedded = await embeddedGenerationManifestDigest(generationDir);
      if (embedded !== receipt.manifest_content_digest) {
        return carrierRollbackFailure("carrier_generation_concurrently_mutated", {
          expected_manifest_content_digest: receipt.manifest_content_digest,
          actual_embedded_manifest_content_digest: embedded
        });
      }
      try {
        await rm(generationDir, { recursive: true, force: false });
        removedGeneration = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return carrierRollbackFailure("carrier_generation_removal_failed", {
            cause: error?.code ?? null
          });
        }
      }
    }

    const manifestStillVisible = (await readVisibleManifestDigest(manifestPath)) !== null;
    const generationStillPresent = (await lstat(generationDir).catch(() => null)) !== null;
    if (manifestStillVisible || generationStillPresent) {
      return carrierRollbackFailure("carrier_rollback_absence_unverified", {
        manifest_present: manifestStillVisible,
        generation_present: generationStillPresent
      });
    }
    return Object.freeze({
      ok: true,
      verified_absent: true,
      cause_code: null,
      removed: Object.freeze({ manifest: removedManifest, generation: removedGeneration }),
      details: Object.freeze({})
    });
  } catch (error) {
    return carrierRollbackFailure("carrier_rollback_absence_unverified", {
      cause: error?.code ?? null
    });
  } finally {
    await releaseCarrierSetPublicationLock(locked);
  }
}
