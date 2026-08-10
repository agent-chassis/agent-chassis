import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
export {
  applyControlledContractCarrierPatch,
  diffControlledContractCarrierContent,
  getControlledContractNodeSpills,
  getControlledContractProjectionSpills,
  projectControlledContractCarrierQuery as queryControlledContractCarrierContent
} from "./controlled-contract-authoring-projections.mjs";

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

const WK_ID_PATTERN = /^WK-[0-9]{4}$/;
const FOCUS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ASSESSMENT_ID_PATTERN = /^[0-9a-f]{64}$/;

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

export function normalizeControlledContractIdentity({ wkId, focus = null }) {
  if (typeof wkId !== "string" || !WK_ID_PATTERN.test(wkId)) {
    fail("controlled_contract_wk_identity_invalid", "wk_id must be a canonical WK-#### identity");
  }
  if (focus === undefined || focus === null) return { wkId, focus: null };
  if (typeof focus !== "string" || !FOCUS_PATTERN.test(focus) || /^wk-[0-9]/i.test(focus)) {
    fail(
      "controlled_contract_focus_identity_invalid",
      "focus must be one canonical lowercase slug and cannot carry another WK identity"
    );
  }
  return { wkId, focus };
}

export function controlledContractCarrierFilename({ wkId, focus = null, carrierKind }) {
  const identity = normalizeControlledContractIdentity({ wkId, focus });
  if (!CONTROLLED_CONTRACT_CARRIER_KINDS.includes(carrierKind)) {
    fail("controlled_contract_carrier_kind_invalid", "carrier_kind is unsupported");
  }
  const stem = identity.focus === null ? identity.wkId : `${identity.wkId}-${identity.focus}`;
  return `${stem}.${CARRIER_SUFFIX[carrierKind]}`;
}

function bindSelectedProofPackToCanonicalEvaluationInput({ wkId, focus, selectedPack }) {
  if (!isPlainObject(selectedPack)) return structuredClone(selectedPack);
  const evaluationInputPath = controlledContractCarrierFilename({
    wkId,
    focus,
    carrierKind: "evaluation_input"
  });
  if (Object.hasOwn(selectedPack, "evaluation_input_path") &&
      selectedPack.evaluation_input_path !== evaluationInputPath) {
    fail(
      "controlled_contract_proof_input_path_forbidden",
      "selected-pack evaluation_input_path is server-derived and must not select another path"
    );
  }
  return { ...structuredClone(selectedPack), evaluation_input_path: evaluationInputPath };
}

export function bindProofPlanRequestEvaluationInputPaths({ wkId, focus = null, content }) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!isPlainObject(content) || !Array.isArray(content.selected_packs)) {
    return structuredClone(content);
  }
  return {
    ...structuredClone(content),
    selected_packs: content.selected_packs.map((selectedPack) =>
      bindSelectedProofPackToCanonicalEvaluationInput({ wkId, focus, selectedPack }))
  };
}

export function bindProofPlanRequestPatchEvaluationInputPaths({
  wkId,
  focus = null,
  operations
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!Array.isArray(operations)) return operations;
  return operations.map((operation) => {
    if (!isPlainObject(operation) || operation.op !== "upsert" ||
        operation.target !== "selected_packs") return structuredClone(operation);
    return {
      ...structuredClone(operation),
      value: bindSelectedProofPackToCanonicalEvaluationInput({
        wkId,
        focus,
        selectedPack: operation.value
      })
    };
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

export async function readControlledContractCarrierFile({
  repoRoot,
  wkId,
  focus = null,
  carrierKind
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const filename = controlledContractCarrierFilename({ wkId, focus, carrierKind });
  const store = await resolveControlledContractRepository(repoRoot);
  const file = path.join(store.contracts, filename);
  const inspected = await inspectCarrierFile(file, { required: true });
  return Object.freeze({
    schema_version: "controlled-contract-canonical-carrier.v1",
    wk_id: wkId,
    focus: focus ?? null,
    carrier_kind: carrierKind,
    filename,
    content_digest: inspected.digest,
    content: parseCarrierJson(inspected.bytes)
  });
}

function assertExpectedDigest(value) {
  if (value !== null && (typeof value !== "string" || !DIGEST_PATTERN.test(value))) {
    fail(
      "controlled_contract_expected_digest_invalid",
      "expected_content_digest must be null for absence or an exact sha256 digest"
    );
  }
}

async function acquireCarrierLock(file) {
  const lock = `${file}.cas-lock`;
  try {
    const handle = await open(lock, "wx", 0o600);
    return { lock, handle };
  } catch (error) {
    fail("controlled_contract_carrier_busy", "canonical carrier has a concurrent writer", {
      cause_code: error?.code ?? null
    });
  }
}

export async function assertControlledContractCarrierExpectedDigest({
  repoRoot,
  wkId,
  focus = null,
  carrierKind,
  expectedContentDigest
}) {
  assertExpectedDigest(expectedContentDigest);
  const filename = controlledContractCarrierFilename({ wkId, focus, carrierKind });
  const store = await resolveControlledContractRepository(repoRoot);
  const file = path.join(store.contracts, filename);
  const observed = await inspectCarrierFile(file, { required: false });
  const actualDigest = observed?.digest ?? null;
  if (actualDigest !== expectedContentDigest) {
    fail("controlled_contract_stale_content_digest", "canonical carrier content changed", {
      expected_content_digest: expectedContentDigest,
      actual_content_digest: actualDigest
    });
  }
  return Object.freeze({ store, file, filename, actualDigest });
}

async function releaseCarrierLock(locked) {
  try {
    await locked.handle.close();
  } finally {
    await unlink(locked.lock).catch(() => {});
  }
}

async function writeControlledContractCarrierFileInternal({
  repoRoot,
  wkId,
  focus = null,
  carrierKind,
  content,
  expectedContentDigest,
  allowPackageProducedWrite = false
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS.includes(carrierKind) &&
      !(allowPackageProducedWrite === true && carrierKind === "proof_plan")) {
    fail(
      "controlled_contract_carrier_write_forbidden",
      "this carrier is package-produced and cannot be written through the canonical authoring route"
    );
  }
  if (!isPlainObject(content)) {
    fail("controlled_contract_carrier_content_invalid", "carrier content must be one JSON object");
  }
  const bytes = canonicalJsonBytes(content);
  const preflight = await assertControlledContractCarrierExpectedDigest({
    repoRoot,
    wkId,
    focus,
    carrierKind,
    expectedContentDigest
  });
  const { store, file, filename } = preflight;

  const locked = await acquireCarrierLock(file);
  let temporary = null;
  try {
    const current = await inspectCarrierFile(file, { required: false });
    const actualDigest = current?.digest ?? null;
    if (actualDigest !== expectedContentDigest) {
      fail("controlled_contract_stale_content_digest", "canonical carrier content changed", {
        expected_content_digest: expectedContentDigest,
        actual_content_digest: actualDigest
      });
    }
    const nextDigest = digestBytes(bytes);
    if (actualDigest === nextDigest) {
      return Object.freeze({
        schema_version: "controlled-contract-canonical-carrier-write.v1",
        wk_id: wkId,
        focus: focus ?? null,
        carrier_kind: carrierKind,
        filename,
        previous_content_digest: actualDigest,
        content_digest: nextDigest,
        written: false,
        no_op: true
      });
    }
    temporary = path.join(store.contracts, `.${filename}.tmp-${process.pid}-${randomUUID()}`);
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    const temporaryEntry = await lstat(temporary);
    if (!temporaryEntry.isFile() || temporaryEntry.isSymbolicLink()) {
      fail("controlled_contract_carrier_write_failed", "temporary carrier is not a real file");
    }
    await rename(temporary, file);
    temporary = null;
    return Object.freeze({
      schema_version: "controlled-contract-canonical-carrier-write.v1",
      wk_id: wkId,
      focus: focus ?? null,
      carrier_kind: carrierKind,
      filename,
      previous_content_digest: actualDigest,
      content_digest: nextDigest,
      written: true,
      no_op: false
    });
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    fail("controlled_contract_carrier_write_failed", "canonical carrier write failed", {
      cause_code: error?.code ?? null
    });
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    await releaseCarrierLock(locked);
  }
}

export async function writeControlledContractCarrierFile(input) {
  return writeControlledContractCarrierFileInternal({
    ...input,
    allowPackageProducedWrite: false
  });
}

export async function writeControlledContractProofPlanFile(input) {
  return writeControlledContractCarrierFileInternal({
    ...input,
    carrierKind: "proof_plan",
    allowPackageProducedWrite: true
  });
}

export function assertBoundedStringArray(value, {
  field,
  maximumItems = 32,
  maximumBytes = 4096,
  allowEmpty = false
}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.length > maximumItems || value.some((item) =>
        typeof item !== "string" || item.length === 0 ||
        Buffer.byteLength(item, "utf8") > maximumBytes)) {
    fail("controlled_contract_bounded_input_invalid", `${field} is not a bounded string array`, {
      field
    });
  }
  return [...value];
}

export async function readCanonicalProofPlanInputs({
  repoRoot, wkId, focus = null, requestContent, evaluationOverrides = {}
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const contract = await readControlledContractCarrierFile({
    repoRoot, wkId, focus, carrierKind: "contract"
  });
  const request = requestContent === undefined
    ? await readControlledContractCarrierFile({
      repoRoot, wkId, focus, carrierKind: "proof_plan_request"
    })
    : { content: requestContent };
  const store = await resolveControlledContractRepository(repoRoot);
  const selectedPacks = request.content?.selected_packs;
  if (!Array.isArray(selectedPacks)) {
    fail("controlled_contract_proof_plan_request_invalid", "proof-plan request has no selected_packs array");
  }
  const prefix = `${wkId}-`;
  const rootEvaluation = `${wkId}.${CARRIER_SUFFIX.evaluation_input}`;
  const evaluationInputs = {};
  for (const selected of selectedPacks) {
    const evaluationPath = selected?.evaluation_input_path;
    if (typeof evaluationPath !== "string") continue;
    const safe = evaluationPath === rootEvaluation ||
      (evaluationPath.startsWith(prefix) &&
       evaluationPath.endsWith(`.${CARRIER_SUFFIX.evaluation_input}`) &&
       path.basename(evaluationPath) === evaluationPath);
    if (!safe) {
      fail(
        "controlled_contract_proof_input_path_forbidden",
        "proof-plan request references a non-canonical or cross-WK evaluation input"
      );
    }
    if (Object.hasOwn(evaluationOverrides, evaluationPath)) {
      evaluationInputs[evaluationPath] = evaluationOverrides[evaluationPath];
    } else {
      const inspected = await inspectCarrierFile(path.join(store.contracts, evaluationPath), {
        required: false
      });
      if (inspected) evaluationInputs[evaluationPath] = parseCarrierJson(inspected.bytes);
    }
  }
  return Object.freeze({ store, contract, request, evaluationInputs });
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
