import { createHash } from "node:crypto";
import path from "node:path";
import {
  controlledContractGenerationDigest,
  digestBytes,
  validateControlledContractAttachmentGenerationDescriptors
} from "./controlled-contract-tool-shared.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  ControlledContractCarrierSetManifestError,
  parseControlledContractCarrierSetManifest
} from "./controlled-contract-carrier-set-manifest.mjs";

export const CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_SCHEMA_VERSION =
  "controlled-contract-authenticated-generation.v1";
export const CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_METADATA_SCHEMA_VERSION =
  "controlled-contract-authenticated-generation-metadata.v1";

export const CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES = Object.freeze({
  MALFORMED: "controlled_contract_generation_authentication.malformed.v1",
  MISSING: "controlled_contract_generation_authentication.missing.v1",
  CONTRADICTORY: "controlled_contract_generation_authentication.contradictory.v1",
  INCOMPLETE: "controlled_contract_generation_authentication.incomplete.v1"
});

const WK_ID_PATTERN = /^WK-[0-9]{4}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GENERATION_ID_PATTERN = /^[0-9a-f]{64}$/u;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const AUTHENTICATED_FIELDS = Object.freeze([
  "schema_version",
  "repository",
  "wk_id",
  "record_source_digest",
  "wk_tip_sha",
  "generation_digest",
  "count",
  "manifest_identity",
  "manifest_descriptors",
  "descriptors"
]);
const METADATA_FIELDS = Object.freeze([
  "schema_version",
  "wk_id",
  "generation_digest",
  "count",
  "manifest_identity",
  "descriptors"
]);
const authenticatedEnvelopes = new WeakSet();

export class ControlledContractGenerationAuthenticationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractGenerationAuthenticationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractGenerationAuthenticationError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function assertExactKeys(value, keys, subject) {
  if (!isPlainObject(value)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      `${subject} must be one plain object`);
  }
  const actual = Reflect.ownKeys(value);
  const expected = new Set(keys);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unexpected = actual.filter((key) => typeof key !== "string" || !expected.has(key));
  if (missing.length > 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MISSING,
      `${subject} is missing required fields`, { fields: missing });
  }
  if (unexpected.length > 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      `${subject} contains unsupported fields`, {
        fields: unexpected.map(String).sort()
      });
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function canonicalManifestPath(wkId, focus) {
  return `wiki/contracts/${focus === null ? wkId : `${wkId}-${focus}`}` +
    ".carrier-set-manifest.json";
}

function validateIdentityFields({ repository, wkId, wkTipSha }) {
  if (typeof repository !== "string" || !path.isAbsolute(repository) ||
      path.normalize(repository) !== repository ||
      typeof wkId !== "string" || !WK_ID_PATTERN.test(wkId) ||
      typeof wkTipSha !== "string" || !OID_PATTERN.test(wkTipSha) || /^0+$/u.test(wkTipSha)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "authenticated generation repository, WK, record, or exact-W identity is malformed");
  }
}

function normalizeRecordObservation(wkId, observed) {
  assertExactKeys(observed, ["path", "content_digest", "byte_length", "bytes_base64"],
    "exact-W canonical-record observation");
  const expectedPath = `wiki/work-records/${wkId}.json`;
  if (observed.path !== expectedPath ||
      typeof observed.content_digest !== "string" ||
      !DIGEST_PATTERN.test(observed.content_digest) ||
      !Number.isInteger(observed.byte_length) || observed.byte_length < 1 ||
      typeof observed.bytes_base64 !== "string") {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "exact-W canonical-record observation is malformed or renamed");
  }
  const bytes = Buffer.from(observed.bytes_base64, "base64");
  if (bytes.toString("base64") !== observed.bytes_base64 ||
      bytes.byteLength !== observed.byte_length || digestBytes(bytes) !== observed.content_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "exact-W canonical-record bytes contradict their authenticated descriptor");
  }
  let record;
  try {
    record = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "exact-W canonical-record bytes are not valid JSON");
  }
  if (!isPlainObject(record) || record.id !== wkId) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "exact-W canonical-record identity contradicts the authenticated WK");
  }
  return observed.content_digest;
}

function normalizeManifestSelection(wkId, value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE,
      "manifest-selected generation requires a complete nonempty manifest selection");
  }
  let previousPath = null;
  const normalized = value.map((entry) => {
    assertExactKeys(entry, ["focus", "generation", "manifest_content_digest"],
      "manifest selection entry");
    const focus = entry.focus ?? null;
    const selectedPath = canonicalManifestPath(wkId, focus);
    if ((focus !== null && (typeof focus !== "string" || focus.length === 0)) ||
        typeof entry.generation !== "string" || !GENERATION_ID_PATTERN.test(entry.generation) ||
        typeof entry.manifest_content_digest !== "string" ||
        !DIGEST_PATTERN.test(entry.manifest_content_digest)) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
        "manifest selection entry is malformed", { path: selectedPath });
    }
    if (previousPath !== null && selectedPath <= previousPath) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "manifest selection is duplicated or not deterministically ordered", {
          path: selectedPath
        });
    }
    previousPath = selectedPath;
    return {
      focus,
      generation: entry.generation,
      manifest_content_digest: entry.manifest_content_digest
    };
  });
  return normalized;
}

function normalizedResolvedGeneration(wkId, generation) {
  assertExactKeys(generation, [
    "schema_version", "record_id", "count", "generation_digest",
    "manifest_selection", "descriptors"
  ], "resolved controlled-contract generation");
  if (generation.schema_version !== "controlled-contract-resolved-generation.v1" ||
      generation.record_id !== wkId || !Number.isInteger(generation.count) ||
      generation.count < 1 || !Array.isArray(generation.descriptors) ||
      generation.descriptors.length !== generation.count ||
      typeof generation.generation_digest !== "string" ||
      !DIGEST_PATTERN.test(generation.generation_digest)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "resolved controlled-contract generation is malformed or identity-mismatched");
  }
  const manifestSelection = normalizeManifestSelection(wkId, generation.manifest_selection);
  return {
    normalized: {
      schema_version: generation.schema_version,
      record_id: generation.record_id,
      count: generation.count,
      generation_digest: generation.generation_digest,
      manifest_selection: manifestSelection,
      descriptors: clone(generation.descriptors)
    },
    manifestSelection,
    descriptors: generation.descriptors
  };
}

export function assertResolvedControlledContractGenerationsEqual({
  wkId, expected, observed
} = {}) {
  const left = normalizedResolvedGeneration(wkId, expected).normalized;
  const right = normalizedResolvedGeneration(wkId, observed).normalized;
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "resolved controlled-contract generation moved or contradicts its binding");
  }
  return observed;
}

function normalizedCarrierObservations(wkId, expectedDescriptors, observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE,
      "exact-W carrier observation is empty or incomplete");
  }
  if (observations.length !== expectedDescriptors.length) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE,
      "exact-W carrier observation does not cover the complete selected generation", {
        expected_count: expectedDescriptors.length,
        actual_count: observations.length
      });
  }
  let previousPath = null;
  return observations.map((observed, index) => {
    const expected = expectedDescriptors[index];
    assertExactKeys(observed, [
      "path", "basename", "carrier_kind", "focus", "pack_digest",
      "content_digest", "byte_length", "bytes_base64"
    ], "exact-W carrier observation");
    if (typeof observed.path !== "string" ||
        (previousPath !== null && observed.path <= previousPath)) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "exact-W carrier observations are duplicated or reordered", {
          path: observed.path ?? null
        });
    }
    previousPath = observed.path;
    if (!isPlainObject(expected) ||
        JSON.stringify(observed) !== JSON.stringify(expected)) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "exact-W carrier observation differs from the authoritative manifest selection", {
          expected_path: expected?.path ?? null,
          observed_path: observed.path
        });
    }
    return clone(observed);
  });
}

function parseObservedManifest(wkId, selected, observed, descriptors) {
  assertExactKeys(observed, ["path", "content_digest", "byte_length", "bytes_base64"],
    "exact-W manifest observation");
  const expectedPath = canonicalManifestPath(wkId, selected.focus);
  if (observed.path !== expectedPath ||
      typeof observed.content_digest !== "string" ||
      !DIGEST_PATTERN.test(observed.content_digest) ||
      !Number.isInteger(observed.byte_length) || observed.byte_length < 1 ||
      typeof observed.bytes_base64 !== "string") {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "exact-W manifest observation is malformed or renamed", {
        expected_path: expectedPath,
        observed_path: observed.path ?? null
      });
  }
  const bytes = Buffer.from(observed.bytes_base64, "base64");
  if (bytes.toString("base64") !== observed.bytes_base64 ||
      bytes.byteLength !== observed.byte_length || digestBytes(bytes) !== observed.content_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "exact-W manifest bytes contradict their authenticated descriptor", {
        path: observed.path
      });
  }
  let manifest;
  try {
    manifest = parseControlledContractCarrierSetManifest(bytes, {
      wkId,
      focus: selected.focus,
      generation: selected.generation
    });
  } catch (error) {
    if (!(error instanceof ControlledContractCarrierSetManifestError)) throw error;
    const code = error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED_JSON ||
      error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED
      ? CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED
      : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MISSING ||
          error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE
        ? CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE
        : CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY;
    fail(code, error.message, { path: observed.path, manifest_code: error.code });
  }
  if (observed.content_digest !== selected.manifest_content_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "exact-W manifest digest contradicts its authoritative selection", {
        path: observed.path
      });
  }
  const selectedDescriptors = descriptors.filter((descriptor) => descriptor.focus === selected.focus);
  const selectedMembers = manifest.carrier_census.filter((member) =>
    member.member_kind === "carrier" || member.member_kind === "evaluation_input");
  if (selectedMembers.length !== selectedDescriptors.length ||
      selectedMembers.some((member, index) => {
        const descriptor = selectedDescriptors[index];
        return descriptor?.basename !== member.filename ||
          descriptor?.carrier_kind !== member.carrier_kind ||
          descriptor?.content_digest !== member.content_digest ||
          descriptor?.byte_length !== member.byte_length;
      })) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE,
      "exact-W manifest census does not cover the authenticated carrier population", {
        path: observed.path,
        manifest_count: selectedMembers.length,
        carrier_count: selectedDescriptors.length
      });
  }
  return {
    path: observed.path,
    focus: selected.focus,
    generation: selected.generation,
    content_digest: observed.content_digest,
    byte_length: observed.byte_length,
    bytes_base64: observed.bytes_base64
  };
}

function normalizedManifestObservations(wkId, selection, observations, descriptors) {
  if (selection === null) {
    if (!Array.isArray(observations) || observations.length !== 0) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "legacy generation cannot carry invented manifest observations");
    }
    return [];
  }
  if (!Array.isArray(observations) || observations.length !== selection.length) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.INCOMPLETE,
      "exact-W manifest observation does not cover the complete selection", {
        expected_count: selection.length,
        actual_count: Array.isArray(observations) ? observations.length : null
      });
  }
  let previousPath = null;
  return observations.map((observed, index) => {
    if (previousPath !== null && observed?.path <= previousPath) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "exact-W manifest observations are duplicated or reordered", {
          path: observed?.path ?? null
        });
    }
    previousPath = observed?.path ?? null;
    return parseObservedManifest(wkId, selection[index], observed, descriptors);
  });
}

function manifestIdentity({ wkId, manifests, descriptors }) {
  const digest = createHash("sha256");
  digest.update("controlled-contract-manifest-identity.v1\0", "utf8");
  digest.update(wkId, "utf8");
  digest.update("\0manifests\0", "utf8");
  for (const descriptor of manifests) {
    digest.update(descriptor.path, "utf8");
    digest.update("\0", "utf8");
    digest.update(descriptor.focus ?? "", "utf8");
    digest.update("\0", "utf8");
    digest.update(descriptor.generation, "utf8");
    digest.update("\0", "utf8");
    digest.update(descriptor.content_digest, "utf8");
    digest.update("\0", "utf8");
    digest.update(Buffer.from(descriptor.bytes_base64, "base64"));
    digest.update("\0", "utf8");
  }
  digest.update("carriers\0", "utf8");
  for (const descriptor of descriptors) {
    digest.update(descriptor.path, "utf8");
    digest.update("\0", "utf8");
    digest.update(descriptor.content_digest, "utf8");
    digest.update("\0", "utf8");
    digest.update(Buffer.from(descriptor.bytes_base64, "base64"));
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

export async function constructAuthenticatedControlledContractGeneration(input = {}) {
  assertExactKeys(input, [
    "repository", "wkId", "wkTipSha", "recordObservation",
    "resolvedGeneration", "carrierObservations", "manifestObservations"
  ], "authenticated generation construction request");
  validateIdentityFields(input);
  const resolved = normalizedResolvedGeneration(input.wkId, input.resolvedGeneration);
  const recordSourceDigest = normalizeRecordObservation(input.wkId, input.recordObservation);
  const descriptors = normalizedCarrierObservations(
    input.wkId, resolved.descriptors, input.carrierObservations);
  let validated;
  try {
    validated = await validateControlledContractAttachmentGenerationDescriptors({
      wkId: input.wkId,
      descriptors,
      generationDigest: input.resolvedGeneration.generation_digest
    });
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "exact-W carrier observations do not form one valid complete generation", {
        cause_code: error?.code ?? null
      });
  }
  const generationDigest = controlledContractGenerationDigest({
    wkId: input.wkId, descriptors
  });
  if (validated.generation_digest !== generationDigest ||
      generationDigest !== input.resolvedGeneration.generation_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "exact-W carrier generation digest contradicts the resolved generation");
  }
  const manifestDescriptors = normalizedManifestObservations(
    input.wkId, resolved.manifestSelection, input.manifestObservations, descriptors);
  const envelope = deepFreeze({
    schema_version: CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_SCHEMA_VERSION,
    repository: input.repository,
    wk_id: input.wkId,
    record_source_digest: recordSourceDigest,
    wk_tip_sha: input.wkTipSha,
    generation_digest: generationDigest,
    count: descriptors.length,
    manifest_identity: resolved.manifestSelection === null ? null : manifestIdentity({
      wkId: input.wkId, manifests: manifestDescriptors, descriptors
    }),
    manifest_descriptors: manifestDescriptors,
    descriptors
  });
  authenticatedEnvelopes.add(envelope);
  return envelope;
}

export function assertAuthenticatedControlledContractGeneration(value, {
  repository = null,
  wkId = null,
  wkTipSha = null,
  requireManifest = false
} = {}) {
  assertExactKeys(value, AUTHENTICATED_FIELDS, "authenticated controlled generation");
  if (!authenticatedEnvelopes.has(value)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "authenticated controlled generation was not constructed by its wiki-core owner");
  }
  if ((repository !== null && value.repository !== repository) ||
      (wkId !== null && value.wk_id !== wkId) ||
      (wkTipSha !== null && value.wk_tip_sha !== wkTipSha)) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
      "authenticated controlled generation contradicts the required repository, WK, or exact W");
  }
  if (requireManifest && value.manifest_identity === null) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MISSING,
      "terminal controlled generation requires an authenticated manifest selection");
  }
  return value;
}

export function projectAuthenticatedControlledContractGeneration(value) {
  assertAuthenticatedControlledContractGeneration(value, { requireManifest: true });
  return deepFreeze({
    schema_version: CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_METADATA_SCHEMA_VERSION,
    wk_id: value.wk_id,
    generation_digest: value.generation_digest,
    count: value.count,
    manifest_identity: value.manifest_identity,
    descriptors: value.descriptors.map(({ path: carrierPath, content_digest }) => ({
      path: carrierPath, content_digest
    }))
  });
}

function normalizeAuthenticatedControlledContractGenerationMetadata(value) {
  assertExactKeys(value, METADATA_FIELDS, "authenticated generation metadata");
  if (value.schema_version !==
        CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_METADATA_SCHEMA_VERSION ||
      typeof value.wk_id !== "string" || !WK_ID_PATTERN.test(value.wk_id) ||
      typeof value.generation_digest !== "string" ||
      !DIGEST_PATTERN.test(value.generation_digest) ||
      !Number.isInteger(value.count) || value.count < 1 ||
      typeof value.manifest_identity !== "string" ||
      !DIGEST_PATTERN.test(value.manifest_identity) ||
      !Array.isArray(value.descriptors) || value.descriptors.length !== value.count) {
    fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.MALFORMED,
      "authenticated generation metadata is malformed or incomplete");
  }
  let previousPath = null;
  const descriptors = value.descriptors.map((descriptor) => {
    assertExactKeys(descriptor, ["path", "content_digest"],
      "authenticated generation metadata descriptor");
    if (typeof descriptor.path !== "string" ||
        !descriptor.path.startsWith("wiki/contracts/") || descriptor.path.includes("..") ||
        typeof descriptor.content_digest !== "string" ||
        !DIGEST_PATTERN.test(descriptor.content_digest) ||
        (previousPath !== null && descriptor.path <= previousPath)) {
      fail(CONTROLLED_CONTRACT_GENERATION_AUTHENTICATION_CODES.CONTRADICTORY,
        "authenticated generation metadata descriptors are malformed, duplicated, or reordered");
    }
    previousPath = descriptor.path;
    return { path: descriptor.path, content_digest: descriptor.content_digest };
  });
  return deepFreeze({
    schema_version: value.schema_version,
    wk_id: value.wk_id,
    generation_digest: value.generation_digest,
    count: value.count,
    manifest_identity: value.manifest_identity,
    descriptors
  });
}

export function authenticatedControlledContractGenerationMetadataFromFields({
  wkId, generationDigest, count, manifestIdentity, descriptors
} = {}) {
  return normalizeAuthenticatedControlledContractGenerationMetadata({
    schema_version: CONTROLLED_CONTRACT_AUTHENTICATED_GENERATION_METADATA_SCHEMA_VERSION,
    wk_id: wkId,
    generation_digest: generationDigest,
    count,
    manifest_identity: manifestIdentity,
    descriptors
  });
}

export function authenticatedControlledContractGenerationMatchesMetadata(envelope, metadata) {
  const projected = projectAuthenticatedControlledContractGeneration(envelope);
  const normalized = normalizeAuthenticatedControlledContractGenerationMetadata(metadata);
  return JSON.stringify(projected) === JSON.stringify(normalized);
}

export function authenticatedControlledContractGenerationsEqual(left, right) {
  assertAuthenticatedControlledContractGeneration(left);
  assertAuthenticatedControlledContractGeneration(right);
  return JSON.stringify(left) === JSON.stringify(right);
}
