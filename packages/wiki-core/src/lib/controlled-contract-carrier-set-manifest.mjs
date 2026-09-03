import { createHash } from "node:crypto";

import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  classifyControlledContractCarrierBasename
} from "./controlled-contract-tool-shared.mjs";

export const CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION =
  "controlled-contract-carrier-set-manifest.v1";

export const CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES = Object.freeze({
  MALFORMED_JSON: "controlled_contract_carrier_set_manifest.malformed_json.v1",
  MALFORMED: "controlled_contract_carrier_set_manifest.malformed.v1",
  MISSING: "controlled_contract_carrier_set_manifest.missing.v1",
  CONTRADICTORY: "controlled_contract_carrier_set_manifest.contradictory.v1",
  INCOMPLETE: "controlled_contract_carrier_set_manifest.incomplete.v1",
  MEMBER: "controlled_contract_carrier_set_manifest.member.v1",
  DIGEST: "controlled_contract_carrier_set_manifest.digest.v1"
});

const WK_ID_PATTERN = /^WK-[0-9]{4}$/u;
const FOCUS_PATTERN = /^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GENERATION_ID_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const PROFILE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const CAPTURE_FIELDS = Object.freeze([
  "dag", "evaluation_inputs", "request", "integration_units", "source_map", "paths",
  "branches", "bound_digests"
]);
const BASE_FIELDS = Object.freeze([
  "schema_version", "repository", "wk_id", "focus", "profile", "generation",
  "carriers", "carrier_census", "manifest_digest"
]);
const MEMBER_FIELDS = Object.freeze([
  "member_kind", "carrier_kind", "filename", "path", "content_digest", "byte_length"
]);
const ARTIFACT_FIELDS = Object.freeze([
  "member_kind", "artifact_role", "filename", "path", "content_digest", "byte_length"
]);
const ARTIFACT_SUFFIXES = Object.freeze({
  "dag-source": "integration-prefix-dag.json",
  "execution-paths": "integration-prefix-paths.json",
  "integration-units": "integration-prefix-units.json",
  "prefix-census": "integration-prefix-census.json"
});

export const CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES = Object.freeze(
  Object.keys(ARTIFACT_SUFFIXES));

export class ControlledContractCarrierSetManifestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractCarrierSetManifestError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractCarrierSetManifestError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
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

function exactKeys(value, expected, subject) {
  if (!isPlainObject(value)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      `${subject} must be one plain object`);
  }
  const expectedSet = new Set(expected);
  const actual = Reflect.ownKeys(value);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = actual.filter((key) => typeof key !== "string" || !expectedSet.has(key));
  if (missing.length > 0) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MISSING,
      `${subject} is missing required fields`, { fields: missing });
  }
  if (unexpected.length > 0) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      `${subject} contains unsupported fields`, {
        fields: unexpected.map(String).sort()
      });
  }
}

function normalizedJson(value) {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJson(value[key])]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(normalizedJson(left)) === JSON.stringify(normalizedJson(right));
}

function canonicalBytes(value) {
  let text;
  try {
    text = `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest is not serializable JSON");
  }
  let roundTrip;
  try {
    roundTrip = JSON.parse(text);
  } catch {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest canonical serialization is not valid JSON");
  }
  if (!sameJson(roundTrip, value)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest contains values outside the JSON data model");
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest exceeds the controlled JSON byte limit", {
        maximum_bytes: CONTROLLED_CONTRACT_MAX_JSON_BYTES
      });
  }
  return bytes;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJsonBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest bytes must be one byte sequence");
  }
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0 || buffer.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest byte length is invalid", { byte_length: buffer.byteLength });
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED_JSON,
      "carrier-set manifest bytes are not valid JSON");
  }
}

function canonicalCarrierStem(wkId, focus) {
  return focus === null ? wkId : `${wkId}-${focus}`;
}

export function controlledContractCarrierSetArtifactFilename({ wkId, focus = null, artifactRole }) {
  const suffix = ARTIFACT_SUFFIXES[artifactRole];
  if (suffix === undefined) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
      "carrier-set manifest artifact role is unsupported", { artifact_role: artifactRole ?? null });
  }
  return `${canonicalCarrierStem(wkId, focus)}.${suffix}`;
}

function normalizeMember({ member, wkId, focus, generationPath, previousFilename, seen }) {
  const fields = member?.member_kind === "artifact" ? ARTIFACT_FIELDS : MEMBER_FIELDS;
  exactKeys(member, fields, "carrier-set manifest member");
  if (typeof member.filename !== "string" || member.filename.length === 0 ||
      member.filename.includes("/") || seen.has(member.filename) ||
      (previousFilename !== null && previousFilename.localeCompare(member.filename) >= 0)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
      "carrier-set manifest members must be unique and ordered by canonical filename", {
        filename: member.filename ?? null
      });
  }
  if (member.path !== `${generationPath}/${member.filename}` ||
      !DIGEST_PATTERN.test(member.content_digest ?? "") ||
      !Number.isInteger(member.byte_length) || member.byte_length < 1) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
      "carrier-set manifest member descriptor is malformed", {
        filename: member.filename
      });
  }
  if (member.member_kind === "artifact") {
    const suffix = ARTIFACT_SUFFIXES[member.artifact_role];
    if (suffix === undefined || member.filename !== controlledContractCarrierSetArtifactFilename({
      wkId, focus, artifactRole: member.artifact_role
    })) {
      fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
        "carrier-set manifest artifact identity is noncanonical", {
          filename: member.filename
        });
    }
    return {
      member_kind: "artifact",
      artifact_role: member.artifact_role,
      filename: member.filename,
      path: member.path,
      content_digest: member.content_digest,
      byte_length: member.byte_length
    };
  }
  if (member.member_kind !== "carrier" && member.member_kind !== "evaluation_input") {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
      "carrier-set manifest member kind is unsupported", { filename: member.filename });
  }
  const classification = classifyControlledContractCarrierBasename({
    wkId,
    basename: member.filename
  });
  const expectedMemberKind = classification.carrier_kind === "evaluation_input"
    ? "evaluation_input" : "carrier";
  if (classification.member !== true || classification.focus !== focus ||
      classification.carrier_kind !== member.carrier_kind ||
      member.member_kind !== expectedMemberKind) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER,
      "carrier-set manifest carrier identity is noncanonical", {
        filename: member.filename
      });
  }
  return {
    member_kind: member.member_kind,
    carrier_kind: member.carrier_kind,
    filename: member.filename,
    path: member.path,
    content_digest: member.content_digest,
    byte_length: member.byte_length
  };
}

function normalizeManifest(value, expected) {
  if (!isPlainObject(value)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest must be one plain object");
  }
  const capturePresent = CAPTURE_FIELDS.some((field) => Object.hasOwn(value, field));
  exactKeys(value, capturePresent ? [...BASE_FIELDS, ...CAPTURE_FIELDS] : BASE_FIELDS,
    "carrier-set manifest");
  if (value.schema_version !== CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest schema version is unsupported", {
        schema_version: value.schema_version ?? null
      });
  }
  if (typeof value.repository !== "string" || value.repository.length === 0 ||
      !WK_ID_PATTERN.test(value.wk_id ?? "") ||
      (value.focus !== null && !FOCUS_PATTERN.test(value.focus ?? ""))) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest identity fields are malformed");
  }
  if ((expected.wkId !== undefined && value.wk_id !== expected.wkId) ||
      (expected.focus !== undefined && value.focus !== expected.focus) ||
      (expected.repository !== undefined && value.repository !== expected.repository)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest identity contradicts the expected selection", {
        expected_wk_id: expected.wkId ?? null,
        expected_focus: expected.focus ?? null,
        expected_repository: expected.repository ?? null
      });
  }
  exactKeys(value.profile, ["profile_id", "profile_version"], "carrier-set manifest profile");
  if (!PROFILE_ID_PATTERN.test(value.profile.profile_id ?? "") ||
      !PROFILE_VERSION_PATTERN.test(value.profile.profile_version ?? "")) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MALFORMED,
      "carrier-set manifest profile identity is malformed");
  }
  exactKeys(value.generation, ["id", "path"], "carrier-set manifest generation");
  const generationId = value.generation.id;
  const generationPath = `.carrier-generations/${generationId}`;
  if (!GENERATION_ID_PATTERN.test(generationId ?? "") || value.generation.path !== generationPath) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest generation identity is invalid");
  }
  if (expected.generation !== undefined && generationId !== expected.generation) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest generation contradicts the expected selection", {
        expected_generation: expected.generation,
        observed_generation: generationId
      });
  }
  if (!Array.isArray(value.carriers) || value.carriers.length === 0 ||
      !Array.isArray(value.carrier_census) || value.carrier_census.length === 0) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE,
      "carrier-set manifest census must be one nonempty complete population");
  }
  if (!sameJson(value.carriers, value.carrier_census)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest carriers and census disagree");
  }
  if (capturePresent && CAPTURE_FIELDS.some((field) => value[field] === null ||
      value[field] === undefined)) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE,
      "carrier-set manifest capture population is incomplete");
  }
  const members = [];
  const seen = new Set();
  let previousFilename = null;
  for (const member of value.carrier_census) {
    const normalized = normalizeMember({
      member,
      wkId: value.wk_id,
      focus: value.focus,
      generationPath,
      previousFilename,
      seen
    });
    seen.add(normalized.filename);
    previousFilename = normalized.filename;
    members.push(normalized);
  }
  if (!members.some((member) => member.member_kind === "carrier" ||
      member.member_kind === "evaluation_input")) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE,
      "carrier-set manifest has no controlled-contract carrier population");
  }
  if (!DIGEST_PATTERN.test(value.manifest_digest ?? "")) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.DIGEST,
      "carrier-set manifest digest is malformed");
  }
  const body = structuredClone(value);
  delete body.manifest_digest;
  const computedDigest = digest(canonicalBytes(body));
  if (value.manifest_digest !== computedDigest) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.DIGEST,
      "carrier-set manifest digest does not authenticate its canonical body", {
        declared_digest: value.manifest_digest,
        computed_digest: computedDigest
      });
  }
  const normalized = {
    schema_version: CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION,
    repository: value.repository,
    wk_id: value.wk_id,
    focus: value.focus,
    profile: {
      profile_id: value.profile.profile_id,
      profile_version: value.profile.profile_version
    },
    generation: { id: generationId, path: generationPath },
    carriers: members.map((member) => structuredClone(member)),
    carrier_census: members.map((member) => structuredClone(member)),
    ...(capturePresent
      ? Object.fromEntries(CAPTURE_FIELDS.map((field) => [field, structuredClone(value[field])]))
      : {}),
    manifest_digest: value.manifest_digest
  };
  return deepFreeze(normalized);
}

export function parseControlledContractCarrierSetManifest(input, expected = {}) {
  const hasBytes = Buffer.isBuffer(input) || input instanceof Uint8Array;
  const value = hasBytes ? parseJsonBytes(input) : structuredClone(input);
  const normalized = normalizeManifest(value, expected);
  if (hasBytes && !Buffer.from(input).equals(canonicalBytes(normalized))) {
    fail(CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.CONTRADICTORY,
      "carrier-set manifest bytes are not the deterministic canonical serialization");
  }
  return normalized;
}

export function constructControlledContractCarrierSetManifest({
  repository,
  wkId,
  focus = null,
  profile,
  generation,
  generationPath,
  members,
  capture = null
}) {
  const census = structuredClone(members);
  const body = {
    schema_version: CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION,
    repository,
    wk_id: wkId,
    focus,
    profile: structuredClone(profile),
    generation: { id: generation, path: generationPath },
    carriers: structuredClone(census),
    carrier_census: structuredClone(census),
    ...(capture === null ? {} : Object.fromEntries(CAPTURE_FIELDS.map((field) => [
      field,
      structuredClone(capture[field])
    ])))
  };
  return parseControlledContractCarrierSetManifest({
    ...body,
    manifest_digest: digest(canonicalBytes(body))
  }, { repository, wkId, focus, generation });
}

export function canonicalControlledContractCarrierSetManifestBytes(manifest) {
  const normalized = parseControlledContractCarrierSetManifest(manifest);
  return canonicalBytes(normalized);
}

export function computeControlledContractCarrierSetManifestDigest(manifest) {
  const normalized = parseControlledContractCarrierSetManifest(manifest);
  return normalized.manifest_digest;
}
