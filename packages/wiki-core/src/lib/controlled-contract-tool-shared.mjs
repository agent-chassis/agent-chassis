import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";
import { assertRuntimeBlockerSubset } from "./runtime-blocker-taxonomy.mjs";

import {
  loadControlledContractPackage,
  loadEvaluationInputSchema
} from "../operations/controlled-contract/package-runtime.mjs";

export const CONTROLLED_CONTRACT_CARRIER_KINDS = Object.freeze([
  "contract",
  "evaluation_input",
  "proof_plan_request",
  "proof_plan"
]);

export const CONTROLLED_CONTRACT_WRITABLE_CARRIER_KINDS = Object.freeze([
  "contract",
  "evaluation_input"
]);

export const CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS = Object.freeze([
  ...CONTROLLED_CONTRACT_WRITABLE_CARRIER_KINDS, "proof_plan_request"
]);

export const CONTROLLED_CONTRACT_PATCH_LIMITS = Object.freeze({
  query_index_bytes: 4096,
  query_selected_bytes: 16384,
  selectors: 64,
  operations: 64,
  operation_bytes: 16384,
  request_bytes: 65536,
  receipt_bytes: 8192
});

export const CONTROLLED_CONTRACT_ARTIFACT_FILES = Object.freeze([
  "assessment.json",
  "assessment.md",
  "structural.full.json",
  "proof-packs.full.json",
  "manifest.json"
]);

export const CONTROLLED_CONTRACT_MAX_JSON_BYTES = 1024 * 1024;
export const CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const CONTROLLED_CONTRACT_FOCUS_MAX_BYTES = 128;

const WK_ID_PATTERN = /^WK-[0-9]{4}$/;
const FOCUS_PATTERN = /^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ASSESSMENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const PROFILE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const AUTHORING_CONTINUATION_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;
const CANONICAL_AUTHORING_PROFILE_ID = "canonical_authoring";
const CANONICAL_AUTHORING_PROFILE_VERSION = "1.0.0";

export const CONTROLLED_CONTRACT_FOCUS_GRAMMAR = Object.freeze({
  pattern: FOCUS_PATTERN.source,
  maximum_bytes: CONTROLLED_CONTRACT_FOCUS_MAX_BYTES,
  measurement: "utf8_bytes",
  accepted_form:
    "omit focus for the root carrier, or supply one canonical lowercase slug of at most 128 UTF-8 bytes; wk-[0-9] prefixes and exact slice-<digits> forms are reserved",
  examples: Object.freeze(["implementation-readiness", "scale"])
});

const CONTROLLED_CONTRACT_MODULE_SPECIFIER = "@agent-chassis/controlled-contract";
const CONTROLLED_CONTRACT_TEST_PROOF_SPECIFIER =
  "@agent-chassis/controlled-contract/test-proof";

const CONTROLLED_CONTRACT_EVALUATION_INPUT_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-verification-profile-input.v1.schema.json";

let controlledContractTestProofPromise = null;
function loadControlledContractTestProofPackage() {
  controlledContractTestProofPromise ??= import(CONTROLLED_CONTRACT_TEST_PROOF_SPECIFIER);
  return controlledContractTestProofPromise;
}

export const CONTROLLED_CONTRACT_RECOVERY_REASON_CODES = Object.freeze([
  "controlled_contract_proof_plan_request_missing",
  "controlled_contract_evaluation_input_missing",
  "controlled_contract_proof_plan_missing",
  "controlled_contract_proof_plan_stale"
]);
assertRuntimeBlockerSubset(CONTROLLED_CONTRACT_RECOVERY_REASON_CODES);

const CARRIER_SUFFIX = Object.freeze({
  contract: "controlled-acceptance.json",
  evaluation_input: "evaluation-input.json",
  proof_plan_request: "proof-plan-request.json",
  proof_plan: "proof-plan.json"
});

export class ControlledContractToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractToolError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, details);
}

function isPlainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function assertControlledContractOperationInput(value, allowedKeys) {
  if (!isPlainObject(value)) {
    fail("controlled_contract_request_invalid", "request must be one plain object");
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Reflect.ownKeys(value).filter(
    (key) => typeof key !== "string" || !allowed.has(key)
  );
  if (unexpected.length > 0) {
    fail(
      "controlled_contract_request_field_forbidden",
      "request contains a caller-controlled substrate or unsupported field",
      { fields: unexpected.map(String).sort() }
    );
  }
  return value;
}

function isCanonicalFocusSlug(focus) {
  if (typeof focus !== "string" ||
      Buffer.byteLength(focus, "utf8") > CONTROLLED_CONTRACT_FOCUS_MAX_BYTES ||
      !FOCUS_PATTERN.test(focus)) return false;
  return true;
}

function controlledContractFocusCause(value) {
  const byteLength = typeof value === "string" ? Buffer.byteLength(value, "utf8") : null;
  return Object.freeze({
    field: "focus",
    cause: "controlled_contract_focus_identity_invalid",
    accepted_form: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form,
    pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern,
    measurement: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.measurement,
    byte_length: byteLength,
    maximum_bytes: CONTROLLED_CONTRACT_FOCUS_MAX_BYTES,
    rejected_value: typeof value === "string" &&
      byteLength <= CONTROLLED_CONTRACT_FOCUS_MAX_BYTES
      ? value
      : "[bounded-invalid-focus]",
    recovery: Object.freeze({ action: "omit_focus_or_supply_canonical_slug" })
  });
}

export function normalizeControlledContractIdentity({ wkId, focus = null }) {
  if (typeof wkId !== "string" || !WK_ID_PATTERN.test(wkId)) {
    fail("controlled_contract_wk_identity_invalid", "wk_id must be a canonical WK-#### identity");
  }
  if (focus === undefined || focus === null) return { wkId, focus: null };
  if (!isCanonicalFocusSlug(focus)) {
    const cause = controlledContractFocusCause(focus);
    fail(
      cause.cause,
      CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form,
      cause
    );
  }
  return { wkId, focus };
}

function carrierStem({ wkId, focus }) {
  return focus === null ? wkId : `${wkId}-${focus}`;
}

export function controlledContractCarrierFilename({ wkId, focus = null, carrierKind }) {
  const identity = normalizeControlledContractIdentity({ wkId, focus });
  if (!CONTROLLED_CONTRACT_CARRIER_KINDS.includes(carrierKind)) {
    fail("controlled_contract_carrier_kind_invalid", "carrier_kind is unsupported");
  }
  return `${carrierStem(identity)}.${CARRIER_SUFFIX[carrierKind]}`;
}

export function normalizeControlledContractPackIdentity({ profileId, profileVersion }) {
  if (typeof profileId !== "string" || !PROFILE_ID_PATTERN.test(profileId) ||
      typeof profileVersion !== "string" || !PROFILE_VERSION_PATTERN.test(profileVersion)) {
    fail(
      "controlled_contract_pack_identity_invalid",
      "pack identity must be one exact profile_id and profile_version"
    );
  }
  return { profileId, profileVersion };
}

function packIdentityDigest({ profileId, profileVersion }) {
  return createHash("sha256").update(`${JSON.stringify({
    profile_id: profileId,
    profile_version: profileVersion
  }, null, 2)}\n`, "utf8").digest("hex");
}

export function controlledContractPackCarrierFilename({
  wkId,
  focus = null,
  profileId,
  profileVersion
}) {
  const identity = normalizeControlledContractIdentity({ wkId, focus });
  const pack = normalizeControlledContractPackIdentity({ profileId, profileVersion });
  return `${carrierStem(identity)}.pack-sha256-${packIdentityDigest(pack)}.` +
    CARRIER_SUFFIX.evaluation_input;
}

const PACK_NAMESPACE_EXACT_PATTERN = /^pack-sha256-([0-9a-f]{64})$/;

function carrierNonMembership({
  wkId,
  basename,
  reason,
  sameWk,
  classification
}) {
  return Object.freeze({
    schema_version: "controlled-contract-carrier-basename-classification.v1",
    classification,
    member: false,
    wk_id: wkId,
    basename: typeof basename === "string" ? basename : null,
    reason,
    same_wk_candidate: sameWk
  });
}

export function classifyControlledContractCarrierBasename({ wkId, basename }) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  const leaf = typeof basename === "string" ? path.basename(basename) : "";
  const sameWkCandidate = leaf === wkId || leaf.startsWith(`${wkId}-`) ||
    leaf.startsWith(`${wkId}.`);
  const candidateClass = sameWkCandidate
    ? "malformed_active_candidate"
    : "unsupported_nonmember";
  if (typeof basename === "string" && leaf === basename &&
      new RegExp(`^${wkId}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\\.carrier-set-manifest\\.json$`, "u")
        .test(basename)) {
    return carrierNonMembership({
      wkId, basename, reason: "server_owned_carrier_set_manifest", sameWk: false,
      classification: "unsupported_nonmember"
    });
  }
  if (typeof basename !== "string" || basename.length === 0 || leaf !== basename ||
      basename.includes("\0")) {
    return carrierNonMembership({
      wkId, basename, reason: "not_one_basename", sameWk: sameWkCandidate,
      classification: candidateClass
    });
  }

  let carrierKind = null;
  let stem = basename;
  for (const kind of CONTROLLED_CONTRACT_CARRIER_KINDS) {
    const suffix = `.${CARRIER_SUFFIX[kind]}`;
    if (basename.endsWith(suffix)) {
      if (carrierKind !== null) {
        return carrierNonMembership({
          wkId, basename, reason: "ambiguous_suffix", sameWk: sameWkCandidate,
          classification: candidateClass
        });
      }
      carrierKind = kind;
      stem = basename.slice(0, -suffix.length);
    }
  }
  if (carrierKind === null) {
    return carrierNonMembership({
      wkId, basename, reason: "unsupported_suffix", sameWk: sameWkCandidate,
      classification: "unsupported_nonmember"
    });
  }

  let packNamespace = null;
  let packDigest = null;
  if (carrierKind === "evaluation_input") {
    const separator = stem.indexOf(".");
    if (separator >= 0) {
      if (stem.indexOf(".", separator + 1) >= 0) {
        return carrierNonMembership({
          wkId, basename, reason: "malformed_pack_namespace", sameWk: sameWkCandidate,
          classification: candidateClass
        });
      }
      packNamespace = stem.slice(separator + 1);
      stem = stem.slice(0, separator);
      const match = PACK_NAMESPACE_EXACT_PATTERN.exec(packNamespace);
      if (match === null) {
        return carrierNonMembership({
          wkId, basename, reason: "malformed_pack_namespace", sameWk: sameWkCandidate,
          classification: candidateClass
        });
      }
      packDigest = match[1];
    }
  } else if (stem.includes(".")) {
    return carrierNonMembership({
      wkId, basename, reason: "unexpected_namespace", sameWk: sameWkCandidate,
      classification: candidateClass
    });
  }

  let focus = null;
  if (stem === wkId) {
    focus = null;
  } else if (stem.startsWith(`${wkId}-`)) {
    focus = stem.slice(wkId.length + 1);
    if (!isCanonicalFocusSlug(focus)) {
      return carrierNonMembership({
        wkId, basename, reason: "malformed_focus", sameWk: true,
        classification: "malformed_active_candidate"
      });
    }
  } else {
    return carrierNonMembership({
      wkId, basename, reason: "different_wk", sameWk: false,
      classification: "unsupported_nonmember"
    });
  }

  return Object.freeze({
    schema_version: "controlled-contract-carrier-basename-classification.v1",
    classification: "active_member",
    member: true,
    wk_id: wkId,
    basename,
    carrier_kind: carrierKind,
    focus,
    pack_namespace: packNamespace,
    pack_digest: packDigest
  });
}

const CONTROLLED_CONTRACT_GENERATION_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function classifyControlledContractRepositoryPath({
  wkId,
  repositoryPath,
  path: repositoryPathAlias
}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  const pathValue = typeof repositoryPath === "string"
    ? repositoryPath
    : typeof repositoryPathAlias === "string" ? repositoryPathAlias : "";
  const normalizedPath = pathValue.replace(/^\.\//u, "");
  const basename = path.posix.basename(normalizedPath);
  const basenameClassification = classifyControlledContractCarrierBasename({
    wkId,
    basename
  });
  const flatActivePath = `wiki/contracts/${basename}`;
  const archiveMatch = /^wiki\/contracts\/\.carrier-generations\/([0-9a-f]{64})\/([^/]+)$/u
    .exec(normalizedPath);
  const isCanonicalArchivePath = archiveMatch !== null &&
    CONTROLLED_CONTRACT_GENERATION_DIGEST_PATTERN.test(archiveMatch[1]) &&
    archiveMatch[2] === basename;
  const isActive = normalizedPath === flatActivePath && basename !== ".";
  const closedClassification = isActive
    ? basenameClassification.classification
    : "unsupported_nonmember";

  if (isActive) {
    return Object.freeze({
      ...basenameClassification,
      schema_version: "controlled-contract-repository-path-classification.v1",
      classification: closedClassification,
      path: pathValue,
      active: true,
      accumulated: closedClassification === "unsupported_nonmember",
      location: "active"
    });
  }

  const reason = isCanonicalArchivePath
    ? "canonical_archive_or_source_path"
    : pathValue.length === 0
      ? "not_one_repository_path"
      : "noncanonical_repository_path";
  return Object.freeze({
    ...basenameClassification,
    schema_version: "controlled-contract-repository-path-classification.v1",
    classification: closedClassification,
    member: false,
    path: pathValue,
    active: false,
    accumulated: closedClassification === "unsupported_nonmember",
    location: isCanonicalArchivePath ? "archive_or_source" : "non_active",
    reason
  });
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJsonBytes(value) {
  let text;
  try {
    text = `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    fail("controlled_contract_json_not_serializable", "content must be bounded JSON data");
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
    fail("controlled_contract_json_too_large", "content exceeds the controlled carrier byte limit", {
      maximum_bytes: CONTROLLED_CONTRACT_MAX_JSON_BYTES,
      byte_length: bytes.byteLength
    });
  }
  return bytes;
}

export function controlledContractContentDigest(value) {
  return digestBytes(canonicalJsonBytes(value));
}

export function assertControlledContractAuthorableCarrierKind(carrierKind) {
  if (!CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS.includes(carrierKind)) {
    fail("controlled_contract_carrier_write_forbidden",
      "only contract, evaluation_input, and proof_plan_request carriers are authorable");
  }
}

async function assertDirectoryNoSymlink(directory, code) {
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(code, "server-resolved directory is not a real directory");
  }
  return realpath(directory);
}

export async function resolveControlledContractRepository(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    fail("controlled_contract_repository_unavailable", "configured repository root is unavailable");
  }
  try {
    const repository = await realpath(path.resolve(repoRoot));
    await assertDirectoryNoSymlink(repository, "controlled_contract_repository_invalid");
    const wiki = path.join(repository, "wiki");
    await assertDirectoryNoSymlink(wiki, "controlled_contract_wiki_directory_invalid");
    const contracts = path.join(wiki, "contracts");
    const contractsReal = await assertDirectoryNoSymlink(
      contracts,
      "controlled_contract_store_invalid"
    );
    if (contractsReal !== contracts) {
      fail("controlled_contract_store_escape", "canonical contract store escaped the repository");
    }
    return Object.freeze({ repository, contracts: contractsReal });
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    fail("controlled_contract_repository_unavailable", "canonical contract store is unavailable", {
      cause_code: error?.code ?? null
    });
  }
}

async function inspectCarrierFile(file, { required }) {
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("controlled_contract_carrier_escape", "canonical carrier is not a real file");
    }
    const resolved = await realpath(file);
    if (resolved !== file) {
      fail("controlled_contract_carrier_escape", "canonical carrier escaped its deterministic path");
    }
    const bytes = await readFile(file);
    if (bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
      fail("controlled_contract_carrier_too_large", "canonical carrier exceeds its byte limit");
    }
    return { bytes, digest: digestBytes(bytes) };
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    if (error?.code === "ENOENT" && !required) return null;
    if (error?.code === "ENOENT") {
      fail("controlled_contract_carrier_not_found", "canonical carrier does not exist");
    }
    fail("controlled_contract_carrier_read_failed", "canonical carrier could not be read", {
      cause_code: error?.code ?? null
    });
  }
}

const CONTROLLED_CONTRACT_GENERATION_SCHEMA_VERSION = "controlled-contract-generation.v1";

function sameWkCanonicalCarrierPattern(wkId) {
  return new RegExp(`^${wkId}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?` +
    "(?:\\.pack-sha256-[a-f0-9]{64})?\\." +
    "(?:controlled-acceptance|evaluation-input|proof-plan-request|proof-plan)\\.json$");
}

let carrierSetToolsPromise = null;
function loadCarrierSetTools() {
  carrierSetToolsPromise ??= import("./controlled-contract-carrier-set-tools.mjs");
  return carrierSetToolsPromise;
}

let carrierSetResolutionPromise = null;
function loadCarrierSetResolution() {
  carrierSetResolutionPromise ??= import("./controlled-contract-carrier-set-resolution.mjs");
  return carrierSetResolutionPromise;
}

async function resolveManifestSelectedGeneration({ repoRoot, wkId }) {
  const { resolveCanonicalControlledContractGenerationSelection } =
    await loadCarrierSetTools();
  return resolveCanonicalControlledContractGenerationSelection({ repoRoot, wkId });
}

async function manifestSelectedGenerationCarriers(selection) {
  const { authenticatedControlledContractRuntimeMembers } =
    await loadCarrierSetResolution();
  const runtimeMembers = authenticatedControlledContractRuntimeMembers(selection);
  const runtimeByFilename = new Map(runtimeMembers.map((member) =>
    [member.logical_filename, member]));
  return selection.descriptors.map((descriptor) => ({
    filename: descriptor.basename,
    content_digest: descriptor.content_digest,
    bytes: Buffer.from(descriptor.bytes_base64, "base64"),
    source_member: runtimeByFilename.get(descriptor.basename)
  }));
}

async function observeLegacyRootControlledContractGeneration(store, wkId) {
  const pattern = sameWkCanonicalCarrierPattern(wkId);
  const names = (await readdir(store.contracts, { withFileTypes: true }))
    .filter((entry) => pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const carriers = [];
  for (const filename of names) {
    const inspected = await inspectCarrierFile(path.join(store.contracts, filename), {
      required: true
    });
    carriers.push({
      filename,
      content_digest: inspected.digest,
      bytes: inspected.bytes,
      source_member: deepFreezePlainData({
        schema_version: "controlled-contract-authenticated-runtime-member.v1",
        storage_mode: "legacy_root",
        logical_filename: filename,
        repository_relative_path: path.relative(
          store.repository, path.join(store.contracts, filename)
        ).split(path.sep).join("/"),
        content_digest: inspected.digest,
        manifest_generation: null,
        manifest_content_digest: null
      })
    });
  }
  return carriers;
}

function controlledContractGenerationProjection(wkId, carriers) {
  const body = {
    schema_version: CONTROLLED_CONTRACT_GENERATION_SCHEMA_VERSION,
    wk_id: wkId,
    carriers: carriers.map(({ filename, content_digest: contentDigest }) => ({
      filename,
      content_digest: contentDigest
    }))
  };
  return Object.freeze({
    ...body,
    carrier_count: body.carriers.length,
    generation_digest: digestBytes(Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf8"))
  });
}

async function observeCurrentControlledContractGeneration({ repoRoot, wkId, store }) {
  const selection = await resolveManifestSelectedGeneration({ repoRoot, wkId });
  return selection === null
    ? observeLegacyRootControlledContractGeneration(store, wkId)
    : await manifestSelectedGenerationCarriers(selection);
}

async function readStableControlledContractGeneration({ repoRoot, wkId }) {
  normalizeControlledContractIdentity({ wkId });
  const store = await resolveControlledContractRepository(repoRoot);
  const first = await observeCurrentControlledContractGeneration({ repoRoot, wkId, store });
  const second = await observeCurrentControlledContractGeneration({ repoRoot, wkId, store });
  const firstProjection = controlledContractGenerationProjection(wkId, first);
  const secondProjection = controlledContractGenerationProjection(wkId, second);
  if (firstProjection.generation_digest !== secondProjection.generation_digest) {
    fail("controlled_contract_generation_stale",
      "canonical same-WK controlled-contract generation moved while it was authenticated", {
        first_generation_digest: firstProjection.generation_digest,
        second_generation_digest: secondProjection.generation_digest
      });
  }
  return { projection: secondProjection, carriers: second };
}

export async function readControlledContractGeneration(input) {
  return (await readStableControlledContractGeneration(input)).projection;
}

function parseCarrierJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!isPlainObject(value)) {
      fail("controlled_contract_carrier_json_invalid", "canonical carrier must contain one JSON object");
    }
    return value;
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    fail("controlled_contract_carrier_json_invalid", "canonical carrier is not valid JSON");
  }
}

function deepFreezePlainData(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezePlainData(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreezePlainData(item);
    return Object.freeze(value);
  }
  return value;
}

export function controlledContractGenerationDigest({ wkId, descriptors }) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    fail("controlled_contract_generation_empty", "complete controlled-contract generation is empty");
  }
  const digest = createHash("sha256");
  digest.update("controlled-contract-generation.v1\0", "utf8");
  digest.update(wkId, "utf8");
  digest.update("\0", "utf8");
  for (const descriptor of descriptors) {
    digest.update(descriptor.path, "utf8");
    digest.update("\0", "utf8");
    digest.update(descriptor.content_digest, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function generationEvaluationInputValidator() {
  return loadEvaluationInputSchema();
}

function generationInvalid(message, details = {}) {
  fail("controlled_contract_generation_invalid", message, details);
}

function attachmentGenerationInvalid(message, details = {}) {
  fail("controlled_contract_attachment_invalid", message, details);
}

async function validateResolvedGenerationAssociations({ wkId, descriptors, parsedByBasename }) {
  const pkg = await loadControlledContractPackage();
  const validateEvaluationInput = await generationEvaluationInputValidator(pkg);
  const evaluationInputs = {};
  const referencedEvaluationInputs = new Set();
  const groups = new Map();
  for (const descriptor of descriptors) {
    const key = descriptor.focus ?? "";
    if (!groups.has(key)) groups.set(key, {
      contract: null, request: null, plan: null
    });
    const group = groups.get(key);
    const content = parsedByBasename.get(descriptor.basename);
    if (descriptor.carrier_kind === "evaluation_input") {
      evaluationInputs[descriptor.basename] = content;
    } else {
      group[descriptor.carrier_kind === "proof_plan_request" ? "request" :
        descriptor.carrier_kind === "proof_plan" ? "plan" : "contract"] = {
        descriptor, content
      };
    }
  }

  for (const [focus, group] of groups) {
    if (group.contract !== null) {
      const resolved = pkg.validateStableTestProofContract(group.contract.content);
      if (!resolved.valid) {
        generationInvalid("contract failed public package validation", {
          focus: focus || null,
          contract_family: resolved.family,
          diagnostics: resolved.diagnostics
        });
      }
    }
    if (group.request === null && group.plan === null) continue;
    if (group.contract === null || group.request === null) {
      generationInvalid("proof-plan association is incomplete", { focus: focus || null });
    }
    const selectedPacks = group.request.content?.selected_packs;
    if (!Array.isArray(selectedPacks)) {
      generationInvalid("proof-plan request selected pack population is malformed", {
        focus: focus || null
      });
    }
    const selectedInputs = {};
    for (const selected of selectedPacks) {
      const evaluationPath = selected?.evaluation_input_path;
      const classified = classifyControlledContractCarrierBasename({
        wkId,
        basename: evaluationPath
      });
      if (classified.member !== true || classified.carrier_kind !== "evaluation_input") {
        generationInvalid("proof-plan request carries a non-canonical evaluation input", {
          focus: focus || null
        });
      }
      if (classified.pack_namespace !== null &&
          (classified.focus !== (focus || null) ||
           typeof selected?.profile_id !== "string" ||
           typeof selected?.profile_version !== "string" ||
           classified.pack_namespace !== `pack-sha256-${packIdentityDigest({
             profileId: selected.profile_id,
             profileVersion: selected.profile_version
           })}`)) {
        generationInvalid("proof-plan request pack evaluation input identity is mismatched", {
          focus: focus || null
        });
      }
      if (Object.hasOwn(evaluationInputs, evaluationPath)) {
        referencedEvaluationInputs.add(evaluationPath);
        selectedInputs[evaluationPath] = evaluationInputs[evaluationPath];
      }
    }
    let rebuilt;
    try {
      rebuilt = await pkg.buildProofPlan({
        contract: group.contract.content,
        request: group.request.content,
        evaluationInputs: selectedInputs
      });
    } catch (error) {
      generationInvalid("proof-plan sources failed public package validation", {
        focus: focus || null,
        cause_code: error?.code ?? null,
        diagnostics: structuredClone(
          error?.details?.diagnostics ??
          error?.details?.evaluation_input_diagnostics ??
          []
        )
      });
    }
    if (group.plan !== null &&
        controlledContractContentDigest(rebuilt) !== group.plan.descriptor.content_digest) {
      generationInvalid("persisted proof plan is stale against the current generation", {
        focus: focus || null
      });
    }
  }
  for (const [basename, content] of Object.entries(evaluationInputs)) {
    if (referencedEvaluationInputs.has(basename)) continue;
    if (!validateEvaluationInput(content)) {
      generationInvalid("unreferenced evaluation input failed public package-schema validation", {
        basename,
        diagnostics: structuredClone(validateEvaluationInput.errors)
      });
    }
  }
}

async function validateControlledContractGenerationDescriptorMechanics({
  wkId, descriptors, generationDigest, invalid
}) {
  normalizeControlledContractIdentity({ wkId, focus: null });
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    fail("controlled_contract_generation_empty",
      "complete controlled-contract generation must contain at least one carrier");
  }
  const parsedByBasename = new Map();
  let previousPath = null;
  for (const descriptor of descriptors) {
    if (!isPlainObject(descriptor) || typeof descriptor.path !== "string" ||
        typeof descriptor.basename !== "string" ||
        typeof descriptor.bytes_base64 !== "string" ||
        typeof descriptor.content_digest !== "string" ||
        !DIGEST_PATTERN.test(descriptor.content_digest)) {
      invalid("controlled-contract generation descriptor is malformed");
    }
    if (previousPath !== null && previousPath >= descriptor.path) {
      invalid("controlled-contract generation paths are duplicate or unsorted");
    }
    previousPath = descriptor.path;
    const classification = classifyControlledContractCarrierBasename({
      wkId, basename: descriptor.basename
    });
    if (classification.member !== true ||
        descriptor.path !== `wiki/contracts/${descriptor.basename}` ||
        descriptor.carrier_kind !== classification.carrier_kind ||
        (descriptor.focus ?? null) !== classification.focus ||
        (descriptor.pack_digest ?? null) !== classification.pack_digest) {
      invalid("controlled-contract generation descriptor identity is mismatched", {
        basename: descriptor.basename
      });
    }
    let bytes;
    try {
      bytes = Buffer.from(descriptor.bytes_base64, "base64");
    } catch {
      invalid("controlled-contract generation descriptor bytes are malformed", {
        basename: descriptor.basename
      });
    }
    if (bytes.toString("base64") !== descriptor.bytes_base64 ||
        bytes.byteLength !== descriptor.byte_length ||
        digestBytes(bytes) !== descriptor.content_digest) {
      invalid("controlled-contract generation descriptor digest is mismatched", {
        basename: descriptor.basename
      });
    }
    parsedByBasename.set(descriptor.basename, parseCarrierJson(bytes));
  }
  const actualGenerationDigest = controlledContractGenerationDigest({ wkId, descriptors });
  if (generationDigest !== null && generationDigest !== actualGenerationDigest) {
    invalid("complete controlled-contract generation digest is mismatched");
  }
  return { parsedByBasename, actualGenerationDigest };
}

export async function validateControlledContractAttachmentGenerationDescriptors({
  wkId, descriptors, generationDigest = null
} = {}) {
  const { actualGenerationDigest } =
    await validateControlledContractGenerationDescriptorMechanics({
      wkId,
      descriptors,
      generationDigest,
      invalid: attachmentGenerationInvalid
    });
  return Object.freeze({
    count: descriptors.length,
    generation_digest: actualGenerationDigest
  });
}

export async function validateControlledContractGenerationDescriptors({
  wkId, descriptors, generationDigest = null
} = {}) {
  const { parsedByBasename, actualGenerationDigest } =
    await validateControlledContractGenerationDescriptorMechanics({
      wkId,
      descriptors,
      generationDigest,
      invalid: generationInvalid
    });
  await validateResolvedGenerationAssociations({ wkId, descriptors, parsedByBasename });
  return Object.freeze({
    count: descriptors.length,
    generation_digest: actualGenerationDigest
  });
}

async function resolveManifestSelectedGenerationPopulation({
  repoRoot,
  wkId,
  absentAsNull,
  validateDescriptors,
  invalid,
  selection
}) {
  if (selection.descriptors.length === 0) {
    if (absentAsNull) return null;
    fail("controlled_contract_generation_empty",
      "canonical same-WK controlled-contract generation contains no carriers");
  }
  const descriptors = selection.descriptors.map((descriptor) => ({ ...descriptor }));
  for (const descriptor of descriptors) {
    parseCarrierJson(Buffer.from(descriptor.bytes_base64, "base64"));
  }
  await validateDescriptors({ wkId, descriptors });

  const observed = await resolveManifestSelectedGeneration({ repoRoot, wkId });
  if (observed === null ||
      JSON.stringify(observed.manifests) !== JSON.stringify(selection.manifests) ||
      JSON.stringify(observed.descriptors) !== JSON.stringify(selection.descriptors)) {
    invalid("canonical generation changed during resolution");
  }
  return deepFreezePlainData({
    schema_version: "controlled-contract-resolved-generation.v1",
    record_id: wkId,
    count: descriptors.length,
    generation_digest: controlledContractGenerationDigest({ wkId, descriptors }),

    manifest_selection: selection.manifests.map((manifest) => ({ ...manifest })),
    descriptors
  });
}

async function resolveControlledContractGenerationPopulation({
  repoRoot,
  wkId,
  absentAsNull,
  validateDescriptors,
  invalid
}) {
  const selection = await resolveManifestSelectedGeneration({ repoRoot, wkId });
  if (selection !== null) {
    return resolveManifestSelectedGenerationPopulation({
      repoRoot, wkId, absentAsNull, validateDescriptors, invalid, selection
    });
  }
  const store = await resolveControlledContractRepository(repoRoot);
  let entries;
  try {
    entries = await readdir(store.contracts, { withFileTypes: true });
  } catch (error) {
    fail("controlled_contract_generation_enumeration_failed",
      "canonical controlled-contract generation could not be enumerated", {
        cause_code: error?.code ?? null
      });
  }
  const classifiedEntries = entries.map((entry) => ({
    entry,
    classification: classifyControlledContractCarrierBasename({
      wkId, basename: entry.name
    })
  }));
  const malformed = classifiedEntries.find(({ classification }) =>
    classification.classification === "malformed_active_candidate");
  if (malformed) {
    invalid("malformed same-WK controlled-contract carrier is present", {
      basename: malformed.entry.name,
      reason: malformed.classification.reason
    });
  }
  const members = classifiedEntries.filter(({ classification }) =>
    classification.member === true).sort((left, right) =>
    left.entry.name < right.entry.name ? -1 : left.entry.name > right.entry.name ? 1 : 0);
  if (members.length === 0) {
    if (absentAsNull) return null;
    fail("controlled_contract_generation_empty",
      "canonical same-WK controlled-contract generation contains no carriers");
  }

  const descriptors = [];
  for (const { entry, classification } of members) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      invalid("canonical generation member is not a regular file", {
        basename: entry.name
      });
    }
    const inspected = await inspectCarrierFile(path.join(store.contracts, entry.name), {
      required: true
    });
    parseCarrierJson(inspected.bytes);
    descriptors.push({
      path: `wiki/contracts/${entry.name}`,
      basename: entry.name,
      carrier_kind: classification.carrier_kind,
      focus: classification.focus,
      pack_digest: classification.pack_digest,
      content_digest: inspected.digest,
      byte_length: inspected.bytes.byteLength,
      bytes_base64: inspected.bytes.toString("base64")
    });
  }
  await validateDescriptors({ wkId, descriptors });

  for (const descriptor of descriptors) {
    const observed = await inspectCarrierFile(path.join(store.repository, descriptor.path), {
      required: true
    });
    if (observed.digest !== descriptor.content_digest ||
        observed.bytes.toString("base64") !== descriptor.bytes_base64) {
      invalid("canonical generation changed during resolution", {
        basename: descriptor.basename
      });
    }
  }

  let finalEntries;
  try {
    finalEntries = await readdir(store.contracts, { withFileTypes: true });
  } catch (error) {
    invalid("canonical generation changed during final enumeration", {
      cause_code: error?.code ?? null
    });
  }
  const finalClassifications = finalEntries.map((entry) => ({
    entry,
    classification: classifyControlledContractCarrierBasename({
      wkId, basename: entry.name
    })
  }));
  if (finalClassifications.some(({ classification }) =>
    classification.classification === "malformed_active_candidate")) {
    invalid("malformed same-WK carrier appeared during resolution");
  }
  const finalMembers = finalClassifications.filter(({ classification }) =>
    classification.member === true).sort((left, right) =>
    left.entry.name < right.entry.name ? -1 : left.entry.name > right.entry.name ? 1 : 0);
  if (finalMembers.length !== descriptors.length || finalMembers.some(({ entry }, index) =>
    entry.name !== descriptors[index].basename || !entry.isFile() || entry.isSymbolicLink())) {
    invalid("canonical generation identity or type changed during resolution");
  }

  const result = {
    schema_version: "controlled-contract-resolved-generation.v1",
    record_id: wkId,
    count: descriptors.length,
    generation_digest: controlledContractGenerationDigest({ wkId, descriptors }),
    manifest_selection: null,
    descriptors
  };
  return deepFreezePlainData(result);
}

export async function resolveControlledContractAttachmentGeneration({ repoRoot, wkId } = {}) {
  assertControlledContractOperationInput(arguments[0] ?? {}, ["repoRoot", "wkId"]);
  normalizeControlledContractIdentity({ wkId, focus: null });
  return resolveControlledContractGenerationPopulation({
    repoRoot,
    wkId,
    absentAsNull: true,
    validateDescriptors: validateControlledContractAttachmentGenerationDescriptors,
    invalid: attachmentGenerationInvalid
  });
}

export async function resolveControlledContractGeneration({ repoRoot, wkId } = {}) {
  assertControlledContractOperationInput(arguments[0] ?? {}, ["repoRoot", "wkId"]);
  normalizeControlledContractIdentity({ wkId, focus: null });
  return resolveControlledContractGenerationPopulation({
    repoRoot,
    wkId,
    absentAsNull: false,
    validateDescriptors: validateControlledContractGenerationDescriptors,
    invalid: generationInvalid
  });
}

export {
  WK_ID_PATTERN,
  FOCUS_PATTERN,
  DIGEST_PATTERN,
  ASSESSMENT_ID_PATTERN,
  PROFILE_ID_PATTERN,
  PROFILE_VERSION_PATTERN,
  AUTHORING_CONTINUATION_PATTERN,
  CANONICAL_AUTHORING_PROFILE_ID,
  CANONICAL_AUTHORING_PROFILE_VERSION,
  CONTROLLED_CONTRACT_MODULE_SPECIFIER,
  CONTROLLED_CONTRACT_TEST_PROOF_SPECIFIER,
  CONTROLLED_CONTRACT_EVALUATION_INPUT_SCHEMA_SPECIFIER,
  controlledContractTestProofPromise,
  loadControlledContractPackage,
  loadControlledContractTestProofPackage,
  CARRIER_SUFFIX,
  fail,
  isPlainObject,
  isCanonicalFocusSlug,
  controlledContractFocusCause,
  carrierStem,
  packIdentityDigest,
  PACK_NAMESPACE_EXACT_PATTERN,
  carrierNonMembership,
  digestBytes,
  canonicalJsonBytes,
  assertDirectoryNoSymlink,
  inspectCarrierFile,
  CONTROLLED_CONTRACT_GENERATION_SCHEMA_VERSION,
  sameWkCanonicalCarrierPattern,
  observeLegacyRootControlledContractGeneration,
  observeCurrentControlledContractGeneration,
  controlledContractGenerationProjection,
  readStableControlledContractGeneration,
  parseCarrierJson,
  deepFreezePlainData,
  generationEvaluationInputValidator,
  generationInvalid,
  attachmentGenerationInvalid,
  validateResolvedGenerationAssociations,
  validateControlledContractGenerationDescriptorMechanics,
  resolveManifestSelectedGeneration,
  resolveManifestSelectedGenerationPopulation,
  resolveControlledContractGenerationPopulation
};
