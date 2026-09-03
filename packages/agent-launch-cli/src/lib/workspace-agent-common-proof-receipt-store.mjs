import { createHash } from "node:crypto";
import path from "node:path";
import {
  mkdir, readFile, readdir, rm
} from "node:fs/promises";

import {
  ensureLauncherOwnedWorkspaceDurableStateRoot,
  resolveLauncherOwnedWorkspaceDurableStateRoot
} from "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";
import {
  assertLauncherTestProofAttemptContext
} from "./workspace-agent-test-proof-runtime-identity.mjs";
import {
  projectTestProofRuntimeEvidenceReceipt
} from "./workspace-agent-test-proof-evidence.mjs";
import {
  projectWriteConfinementEvidence
} from "./workspace-agent-write-confinement-evidence.mjs";
import {
  assertBehavioralPreservationPublication
} from "./workspace-agent-behavioral-preservation-evidence.mjs";
import {
  publishImmutableEvidenceOnce,
  syncDirectory,
  typedRefusal,
  withStoreLock,
  writeAtomicPublished
} from "./workspace-agent-dispatch-run-receipt-store-io.mjs";

export const COMMON_PROOF_RECEIPT_LAYOUT_VERSION =
  "workspace-agent-common-proof-receipt-layout.v1";
export const COMMON_PROOF_RECEIPT_SCHEMA_VERSION =
  "workspace-agent-common-proof-receipt.v1";
export const COMMON_PROOF_RECEIPT_EVENT_SCHEMA_VERSION =
  "workspace-agent-common-proof-receipt-event.v1";
export const COMMON_PROOF_RECEIPT_SELECTOR_SCHEMA_VERSION =
  "workspace-agent-common-proof-receipt-selector.v1";
export const COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION =
  "wiki-core-common-proof-capture-receipt-identity.v1";
export const COMMON_PROOF_RECEIPT_IDENTITY_HEAD_SCHEMA_VERSION =
  "workspace-agent-common-proof-identity-head.v1";
export const COMMON_PROOF_RECEIPT_DIRECTORY = "common-proof-receipts-v1";
const COMMON_PROOF_RECEIPT_STALE_SCHEMA_VERSION =
  "workspace-agent-common-proof-receipt-stale.v1";

export const COMMON_PROOF_RECEIPT_LIMITS = Object.freeze({
  request_bytes: 2 * 1024 * 1024,
  selector_fields: 12,
  selector_string_bytes: 4096,
  record_bytes: 2 * 1024 * 1024,
  event_count: 1,
  population_count: 1024,
  returned_bytes: 1024 * 1024
});

export const COMMON_PROOF_RECEIPT_REFUSAL_CODES = Object.freeze({
  ABSENT: "common_proof_receipt_absent",
  AUTHORITY_REJECTED: "common_proof_receipt_authority_rejected",
  CAPABILITY_FAILED: "common_proof_receipt_capability_failed",
  CONFLICT: "common_proof_receipt_conflict",
  CORRUPT: "common_proof_receipt_corrupt",
  FAMILY_UNSUPPORTED: "common_proof_receipt_family_unsupported",
  INPUT_OVERFLOW: "common_proof_receipt_input_overflow",
  INCOMPLETE_BEHAVIORAL_GROUP: "common_proof_receipt_incomplete_behavioral_group",
  LAYOUT_UNSUPPORTED: "common_proof_receipt_layout_unsupported",
  POPULATION_OVERFLOW: "common_proof_receipt_population_overflow",
  PROJECTION_REJECTED: "common_proof_receipt_projection_rejected",
  RECORD_OVERFLOW: "common_proof_receipt_record_overflow",
  RETURN_OVERFLOW: "common_proof_receipt_return_overflow",
  SELECTOR_INVALID: "common_proof_receipt_selector_invalid",
  SELECTOR_MISMATCH: "common_proof_receipt_selector_mismatch",
  UNAVAILABLE: "common_proof_receipt_unavailable",
  STALE: "common_proof_receipt_stale"
});

const CODES = COMMON_PROOF_RECEIPT_REFUSAL_CODES;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const WK_RE = /^WK-[0-9]{4}$/u;
const UNIT_RE = /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,511}$/u;
const SELECTOR_FIELDS = Object.freeze([
  "schema_version", "repository", "wk_id", "unit_address", "focus", "family",
  "artifact", "side", "profile_id", "profile_version", "verification_id", "lifecycle"
]);
const IDENTITY_FIELDS = Object.freeze([
  "schema_version", "repository_alias", "wk_id", "unit_address", "focus", "family",
  "artifact", "side", "profile_id", "profile_version", "verification_id"
]);
const FACTORY_FIELDS = Object.freeze(["workspaceDir", "repositoryAlias", "faultInjector"]);
const HEAD_FIELDS = Object.freeze([
  "schema_version", "identity_key", "members", "group_digest", "head_digest"
]);
const HEAD_MEMBER_FIELDS = Object.freeze([
  "identity", "selector_digest", "content_identity"
]);
const BEHAVIORAL_REPORT_ARTIFACT = "behavioral_preservation_observable_report";

export const COMMON_PROOF_RECEIPT_FAMILIES = Object.freeze({
  test_verification_validity: Object.freeze({
    artifact: "test_proof_runtime_evidence_receipt",
    profile_id: "proof.verification.test-validity",
    profile_version: "2.0.0"
  }),
  write_confinement: Object.freeze({
    artifact: "write_confinement_evidence_projection",
    profile_id: "proof.scope.write-confinement",
    profile_version: "2.0.0"
  }),
  behavioral_preservation: Object.freeze({
    artifact: "behavioral_preservation_pair_receipt",
    profile_id: "proof.compatibility.behavioral-preservation",
    profile_version: "2.0.0"
  })
});

function refusal(code, message, cause = undefined) {
  return typedRefusal(message, code, cause);
}

function failed(code, message, detail = null) {
  return Object.freeze({ ok: false, status: "refused", code, message, detail });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertExactKeys(value, keys, subject, code = CODES.AUTHORITY_REJECTED) {
  if (!hasExactKeys(value, keys)) {
    const observed = isObject(value) ? Object.keys(value).sort() : [];
    throw refusal(code,
      `${subject} accepts exactly {${keys.join(",")}}; observed {${observed.join(",")}}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, canonicalize(value[key])]));
}

function canonicalBytes(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function digest(value) {
  return digestBytes(canonicalBytes(value));
}

function deepFreeze(value) {
  if (!isObject(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function bytesOf(value) {
  try {
    return Buffer.byteLength(canonicalBytes(value), "utf8");
  } catch (cause) {
    throw refusal(CODES.AUTHORITY_REJECTED,
      "common-proof receipt input must be canonical JSON data", cause);
  }
}

function assertRequestBound(value) {
  if (bytesOf(value) > COMMON_PROOF_RECEIPT_LIMITS.request_bytes) {
    throw refusal(CODES.INPUT_OVERFLOW, "common-proof publication request exceeds its byte limit");
  }
}

function assertString(value, subject, pattern = ID_RE) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") === 0 ||
      Buffer.byteLength(value, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.selector_string_bytes ||
      !pattern.test(value)) {
    throw refusal(CODES.SELECTOR_INVALID, `${subject} is not one bounded canonical string`);
  }
  return value;
}

function repositoryIdentity(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value ||
      Buffer.byteLength(value, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.selector_string_bytes) {
    throw refusal(CODES.PROJECTION_REJECTED,
      "the authenticated projection does not bind one canonical absolute repository identity");
  }
  return value;
}

function identityWithoutEvidenceId(receipt) {
  const { evidence_id: evidenceId, ...identity } = receipt.evidence_identity ?? {};
  if (typeof evidenceId !== "string" || evidenceId.length === 0) {
    throw refusal(CODES.PROJECTION_REJECTED,
      "the test-verification projection lacks its owner-derived evidence identity");
  }
  return identity;
}

function selectorFor({
  repository, wkId, unitAddress, family, verificationId, lifecycle,
  artifact = null, side = null
}) {
  const descriptor = COMMON_PROOF_RECEIPT_FAMILIES[family];
  if (descriptor === undefined) {
    throw refusal(CODES.FAMILY_UNSUPPORTED, "common-proof receipt family is unsupported");
  }
  const selector = canonicalize({
    schema_version: COMMON_PROOF_RECEIPT_SELECTOR_SCHEMA_VERSION,
    repository,
    wk_id: wkId,
    unit_address: unitAddress,
    focus: null,
    family,
    artifact: artifact ?? descriptor.artifact,
    side,
    profile_id: descriptor.profile_id,
    profile_version: descriptor.profile_version,
    verification_id: verificationId,
    lifecycle
  });
  validateSelector(selector);
  return deepFreeze(selector);
}

function validateLifecycle(value) {
  if (!isObject(value) || value.state !== "current" || Object.keys(value).length < 2 ||
      Object.entries(value).some(([key, item]) => typeof key !== "string" ||
        !["string", "number"].includes(typeof item) ||
        (typeof item === "string" && Buffer.byteLength(item, "utf8") >
          COMMON_PROOF_RECEIPT_LIMITS.selector_string_bytes))) {
    throw refusal(CODES.SELECTOR_INVALID,
      "common-proof selector lifecycle must be one complete currentness identity");
  }
}

export function validateCommonProofReceiptSelector(selector) {
  return validateSelector(selector);
}

function validateSelector(selector) {
  assertExactKeys(selector, SELECTOR_FIELDS, "common-proof receipt selector",
    CODES.SELECTOR_INVALID);
  if (Object.keys(selector).length > COMMON_PROOF_RECEIPT_LIMITS.selector_fields) {
    throw refusal(CODES.SELECTOR_INVALID, "common-proof selector field limit exceeded");
  }
  if (selector.schema_version !== COMMON_PROOF_RECEIPT_SELECTOR_SCHEMA_VERSION &&
      selector.schema_version !== COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION) {
    throw refusal(CODES.LAYOUT_UNSUPPORTED, "common-proof selector layout is unsupported");
  }
  const descriptor = COMMON_PROOF_RECEIPT_FAMILIES[selector.family];
  if (descriptor === undefined) {
    throw refusal(CODES.FAMILY_UNSUPPORTED, "common-proof selector family is unsupported");
  }
  repositoryIdentity(selector.repository);
  assertString(selector.wk_id, "wk_id", WK_RE);
  assertString(selector.unit_address, "unit_address", UNIT_RE);
  if (selector.unit_address !== selector.wk_id &&
      !selector.unit_address.startsWith(`${selector.wk_id}#`)) {
    throw refusal(CODES.SELECTOR_INVALID, "selector unit is not bound to its WK");
  }
  const pairMember = selector.family === "behavioral_preservation" &&
    selector.artifact === descriptor.artifact && selector.side === null;
  const reportMember = selector.family === "behavioral_preservation" &&
    selector.artifact === BEHAVIORAL_REPORT_ARTIFACT &&
    ["baseline", "candidate"].includes(selector.side);
  if (selector.focus !== null || (!pairMember && !reportMember &&
      (selector.side !== null || selector.artifact !== descriptor.artifact)) ||
      selector.profile_id !== descriptor.profile_id ||
      selector.profile_version !== descriptor.profile_version) {
    throw refusal(CODES.SELECTOR_MISMATCH,
      "common-proof selector does not match its closed family identity");
  }
  if (selector.verification_id !== null) {
    assertString(selector.verification_id, "verification_id");
  }
  if (selector.family === "test_verification_validity" && selector.verification_id === null) {
    throw refusal(CODES.SELECTOR_INVALID,
      "test-verification selector requires an exact verification identity");
  }
  validateLifecycle(selector.lifecycle);
  if (bytesOf(selector) > COMMON_PROOF_RECEIPT_LIMITS.request_bytes) {
    throw refusal(CODES.INPUT_OVERFLOW, "common-proof selector exceeds its byte limit");
  }
  return deepFreeze(canonicalize(selector));
}

function identityFor(selector, repositoryAlias) {
  return validateIdentity(canonicalize({
    schema_version: COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION,
    repository_alias: repositoryAlias,
    wk_id: selector.wk_id,
    unit_address: selector.unit_address,
    focus: selector.focus,
    family: selector.family,
    artifact: selector.artifact,
    side: selector.side,
    profile_id: selector.profile_id,
    profile_version: selector.profile_version,
    verification_id: selector.verification_id
  }));
}

function validateIdentity(identity) {
  assertExactKeys(identity, IDENTITY_FIELDS, "common-proof receipt identity",
    CODES.SELECTOR_INVALID);
  if (identity.schema_version !== COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION) {
    throw refusal(CODES.LAYOUT_UNSUPPORTED,
      "common-proof receipt identity layout is unsupported");
  }
  assertString(identity.repository_alias, "repository_alias", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
  assertString(identity.wk_id, "wk_id", WK_RE);
  assertString(identity.unit_address, "unit_address", UNIT_RE);
  if (identity.unit_address !== identity.wk_id &&
      !identity.unit_address.startsWith(`${identity.wk_id}#`)) {
    throw refusal(CODES.SELECTOR_INVALID, "receipt identity unit is not bound to its WK");
  }
  if (identity.focus !== null) {
    throw refusal(CODES.SELECTOR_MISMATCH, "common-proof receipt identity focus is unsupported");
  }
  const descriptor = COMMON_PROOF_RECEIPT_FAMILIES[identity.family];
  if (descriptor === undefined) {
    throw refusal(CODES.FAMILY_UNSUPPORTED, "common-proof receipt identity family is unsupported");
  }
  const pairMember = identity.family === "behavioral_preservation" &&
    identity.artifact === descriptor.artifact && identity.side === null;
  const reportMember = identity.family === "behavioral_preservation" &&
    identity.artifact === BEHAVIORAL_REPORT_ARTIFACT &&
    ["baseline", "candidate"].includes(identity.side);
  if ((!pairMember && !reportMember &&
      (identity.artifact !== descriptor.artifact || identity.side !== null)) ||
      identity.profile_id !== descriptor.profile_id ||
      identity.profile_version !== descriptor.profile_version) {
    throw refusal(CODES.SELECTOR_MISMATCH,
      "common-proof receipt identity does not match its closed family identity");
  }
  if (identity.verification_id !== null) assertString(identity.verification_id, "verification_id");
  if (identity.family === "test_verification_validity" && identity.verification_id === null) {
    throw refusal(CODES.SELECTOR_INVALID,
      "test-verification receipt identity requires an exact verification identity");
  }
  if (bytesOf(identity) > COMMON_PROOF_RECEIPT_LIMITS.request_bytes) {
    throw refusal(CODES.INPUT_OVERFLOW, "common-proof receipt identity exceeds its byte limit");
  }
  return deepFreeze(canonicalize(identity));
}

function identityKey(identity) {
  const normalized = identity.family === "behavioral_preservation"
    ? { ...identity, artifact: null, side: null }
    : identity;
  return digest(normalized);
}

function publicationRecord(selector, projection) {
  const projectionBytes = canonicalBytes(projection);
  const selectorDigest = digest(selector);
  const projectionDigest = digestBytes(projectionBytes);
  const eventBody = canonicalize({
    schema_version: COMMON_PROOF_RECEIPT_EVENT_SCHEMA_VERSION,
    sequence: 1,
    prior_event_digest: null,
    selector_digest: selectorDigest,
    projection_digest: projectionDigest,
    projection_bytes: projectionBytes
  });
  const event = canonicalize({ ...eventBody, event_digest: digest(eventBody) });
  const body = canonicalize({
    schema_version: COMMON_PROOF_RECEIPT_SCHEMA_VERSION,
    layout_version: COMMON_PROOF_RECEIPT_LAYOUT_VERSION,
    selector,
    selector_digest: selectorDigest,
    content_identity: projectionDigest,
    events: [event]
  });
  const record = canonicalize({ ...body, record_digest: digest(body) });
  const bytes = canonicalBytes(record);
  if (Buffer.byteLength(bytes, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.record_bytes) {
    throw refusal(CODES.RECORD_OVERFLOW, "common-proof receipt exceeds its record byte limit");
  }
  return { record: deepFreeze(record), bytes, selectorDigest, projectionDigest };
}

function validateRecord(record, expectedSelector = null) {
  const recordKeys = ["schema_version", "layout_version", "selector", "selector_digest",
    "content_identity", "events", "record_digest"];
  if (!isObject(record) || record.layout_version !== COMMON_PROOF_RECEIPT_LAYOUT_VERSION ||
      record.schema_version !== COMMON_PROOF_RECEIPT_SCHEMA_VERSION) {
    throw refusal(CODES.LAYOUT_UNSUPPORTED, "common-proof receipt layout is unsupported");
  }
  if (!hasExactKeys(record, recordKeys)) {
    throw refusal(CODES.CORRUPT, "common-proof receipt has an open or incomplete record shape");
  }
  const selector = validateSelector(record.selector);
  if (record.selector_digest !== digest(selector) || !DIGEST_RE.test(record.content_identity)) {
    throw refusal(CODES.CORRUPT, "common-proof receipt selector or content identity is corrupt");
  }
  const { record_digest: _recordDigest, ...body } = record;
  if (record.record_digest !== digest(body)) {
    throw refusal(CODES.CORRUPT, "common-proof receipt digest does not reproduce its bytes");
  }
  if (!Array.isArray(record.events) || record.events.length === 0) {
    throw refusal(CODES.CORRUPT, "common-proof receipt carries no complete event");
  }
  if (record.events.length > COMMON_PROOF_RECEIPT_LIMITS.event_count) {
    throw refusal(CODES.CONFLICT, "common-proof receipt contains a conflicting event population");
  }
  const event = record.events[0];
  const eventKeys = ["schema_version", "sequence", "prior_event_digest", "selector_digest",
    "projection_digest", "projection_bytes", "event_digest"];
  if (!hasExactKeys(event, eventKeys) ||
      event.schema_version !== COMMON_PROOF_RECEIPT_EVENT_SCHEMA_VERSION ||
      event.sequence !== 1 || event.prior_event_digest !== null ||
      event.selector_digest !== record.selector_digest ||
      event.projection_digest !== record.content_identity ||
      typeof event.projection_bytes !== "string") {
    throw refusal(CODES.CORRUPT, "common-proof receipt event is malformed or misbound");
  }
  const { event_digest: _eventDigest, ...eventBody } = event;
  if (event.event_digest !== digest(eventBody) ||
      digestBytes(event.projection_bytes) !== event.projection_digest) {
    throw refusal(CODES.CORRUPT, "common-proof receipt event integrity check failed");
  }
  if (expectedSelector !== null && canonicalBytes(selector) !== canonicalBytes(expectedSelector)) {
    throw refusal(CODES.SELECTOR_MISMATCH,
      "stored common-proof receipt does not match the exact requested selector");
  }
  let projection;
  try {
    projection = JSON.parse(event.projection_bytes);
  } catch (cause) {
    throw refusal(CODES.CORRUPT, "common-proof projection bytes are truncated or invalid", cause);
  }
  if (event.projection_bytes !== canonicalBytes(projection)) {
    throw refusal(CODES.CORRUPT,
      "common-proof projection bytes are not in their authenticated canonical encoding");
  }
  return { record: deepFreeze(canonicalize(record)), selector, projection: deepFreeze(projection) };
}

function parseCanonicalRecord(raw, expectedSelector = null) {
  if (Buffer.byteLength(raw, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.record_bytes) {
    throw refusal(CODES.RECORD_OVERFLOW,
      "stored common-proof receipt exceeds its record byte limit");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw refusal(CODES.CORRUPT,
      "stored common-proof receipt is truncated or invalid JSON", cause);
  }
  if (raw !== canonicalBytes(parsed)) {
    throw refusal(CODES.CORRUPT,
      "stored common-proof receipt is not in its authenticated canonical encoding");
  }
  return validateRecord(parsed, expectedSelector);
}

function validateStaleMarker(raw, expectedSelectorDigest) {
  if (Buffer.byteLength(raw, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.record_bytes) {
    throw refusal(CODES.RECORD_OVERFLOW,
      "stored common-proof stale marker exceeds its byte limit");
  }
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (cause) {
    throw refusal(CODES.CORRUPT,
      "stored common-proof stale marker is truncated or invalid JSON", cause);
  }
  if (raw !== canonicalBytes(marker) || !hasExactKeys(marker,
    ["schema_version", "selector_digest"]) ||
      marker.schema_version !== COMMON_PROOF_RECEIPT_STALE_SCHEMA_VERSION ||
      marker.selector_digest !== expectedSelectorDigest) {
    throw refusal(CODES.CORRUPT,
      "stored common-proof stale marker is noncanonical or misbound");
  }
  return marker;
}

function publicSelector(selector) {
  return deepFreeze(canonicalize({ ...selector,
    schema_version: COMMON_PROOF_RECEIPT_SELECTOR_SCHEMA_VERSION }));
}

function createIdentityHead(members) {
  const sorted = [...members].sort((left, right) =>
    canonicalBytes(left.identity).localeCompare(canonicalBytes(right.identity)));
  const key = identityKey(sorted[0].identity);
  if (sorted.some((member) => identityKey(member.identity) !== key)) {
    throw refusal(CODES.INCOMPLETE_BEHAVIORAL_GROUP,
      "common-proof visibility-group members do not share one canonical identity head");
  }
  const normalizedMembers = sorted.map((member) => canonicalize({
    identity: validateIdentity(member.identity),
    selector_digest: member.selectorDigest,
    content_identity: member.contentIdentity
  }));
  const groupDigest = digest(normalizedMembers);
  const body = canonicalize({
    schema_version: COMMON_PROOF_RECEIPT_IDENTITY_HEAD_SCHEMA_VERSION,
    identity_key: key,
    members: normalizedMembers,
    group_digest: groupDigest
  });
  return {
    head: deepFreeze(canonicalize({ ...body, head_digest: digest(body) })),
    bytes: canonicalBytes({ ...body, head_digest: digest(body) }),
    key
  };
}

function parseIdentityHead(raw, expectedIdentity) {
  if (Buffer.byteLength(raw, "utf8") > COMMON_PROOF_RECEIPT_LIMITS.record_bytes) {
    throw refusal(CODES.RECORD_OVERFLOW, "common-proof identity head exceeds its byte limit");
  }
  let head;
  try { head = JSON.parse(raw); } catch (cause) {
    throw refusal(CODES.CORRUPT, "common-proof identity head is invalid JSON", cause);
  }
  if (raw !== canonicalBytes(head) || !hasExactKeys(head, HEAD_FIELDS) ||
      head.schema_version !== COMMON_PROOF_RECEIPT_IDENTITY_HEAD_SCHEMA_VERSION) {
    throw refusal(head?.schema_version &&
      head.schema_version !== COMMON_PROOF_RECEIPT_IDENTITY_HEAD_SCHEMA_VERSION
      ? CODES.LAYOUT_UNSUPPORTED : CODES.CORRUPT,
    "common-proof identity head layout or encoding is invalid");
  }
  const { head_digest: _headDigest, ...body } = head;
  if (head.head_digest !== digest(body) || head.group_digest !== digest(head.members) ||
      head.identity_key !== identityKey(expectedIdentity)) {
    throw refusal(CODES.CORRUPT, "common-proof identity head integrity is invalid");
  }
  if (!Array.isArray(head.members) || head.members.length < 1 || head.members.length > 3) {
    throw refusal(CODES.INCOMPLETE_BEHAVIORAL_GROUP,
      "common-proof identity head member population is incomplete or over-bound");
  }
  const members = head.members.map((member) => {
    if (!hasExactKeys(member, HEAD_MEMBER_FIELDS) ||
        !DIGEST_RE.test(member.selector_digest) || !DIGEST_RE.test(member.content_identity)) {
      throw refusal(CODES.CORRUPT, "common-proof identity head member is malformed");
    }
    const identity = validateIdentity(member.identity);
    if (identityKey(identity) !== head.identity_key) {
      throw refusal(CODES.SELECTOR_MISMATCH,
        "common-proof identity head contains a member from another identity");
    }
    return { ...member, identity };
  });
  const behavioral = expectedIdentity.family === "behavioral_preservation";
  if (behavioral) {
    const expected = [
      `${COMMON_PROOF_RECEIPT_FAMILIES.behavioral_preservation.artifact}:null`,
      `${BEHAVIORAL_REPORT_ARTIFACT}:baseline`,
      `${BEHAVIORAL_REPORT_ARTIFACT}:candidate`
    ].sort();
    const observed = members.map(({ identity }) => `${identity.artifact}:${identity.side}`).sort();
    if (canonicalBytes(observed) !== canonicalBytes(expected)) {
      throw refusal(CODES.INCOMPLETE_BEHAVIORAL_GROUP,
        "behavioral common-proof identity head does not expose the complete ordered group");
    }
  } else if (members.length !== 1) {
    throw refusal(CODES.CORRUPT, "non-behavioral common-proof identity head has extra members");
  }
  const selected = members.find(({ identity }) =>
    canonicalBytes(identity) === canonicalBytes(expectedIdentity));
  if (selected === undefined) {
    throw refusal(CODES.SELECTOR_MISMATCH,
      "common-proof identity head does not contain the exact requested identity");
  }
  return { head: deepFreeze(canonicalize(head)), members, selected };
}

function resultFromError(error) {
  const known = new Set(Object.values(CODES));
  if (known.has(error?.code)) return failed(error.code, error.message);
  throw error;
}

export function createCommonProofReceiptStore(options = {}) {
  const normalized = options === undefined ? {} : options;
  if (!isObject(normalized)) {
    throw refusal(CODES.AUTHORITY_REJECTED, "common-proof store options must be one object");
  }
  for (const key of Object.keys(normalized)) {
    if (!FACTORY_FIELDS.includes(key)) {
      throw refusal(CODES.AUTHORITY_REJECTED,
        `common-proof store rejects caller-selected ${key}`);
    }
  }
  const workspaceDir = normalized.workspaceDir;
  const repositoryAlias = normalized.repositoryAlias ?? path.basename(workspaceDir ?? "");
  const faultInjector = normalized.faultInjector ?? null;
  if (typeof workspaceDir !== "string" || typeof faultInjector !== "function" &&
      faultInjector !== null || typeof repositoryAlias !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(repositoryAlias)) {
    throw refusal(CODES.AUTHORITY_REJECTED,
      "common-proof store requires one workspace identity and optional fault injector");
  }

  function authenticatedWorkspaceRoot() {
    const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
    if (resolved.ok !== true) throw refusal(
      resolved.code ?? CODES.AUTHORITY_REJECTED,
      resolved.reason ?? "launcher durable root is unavailable");
    return resolved.workspace_root;
  }

  function bindProjectionRepository(projectedRepository) {
    const projected = repositoryIdentity(projectedRepository);
    const authenticated = authenticatedWorkspaceRoot();
    if (projected !== authenticated) {
      throw refusal(CODES.PROJECTION_REJECTED,
        "the projected repository does not match the launcher-authenticated durable workspace");
    }
    return authenticated;
  }

  async function publicationDirectory() {
    const ensured = await ensureLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
    if (ensured.ok !== true) throw refusal(
      ensured.code ?? CODES.AUTHORITY_REJECTED,
      ensured.reason ?? "launcher durable root is unavailable");
    const dir = path.join(ensured.root, COMMON_PROOF_RECEIPT_DIRECTORY);
    const records = path.join(dir, "records");
    const heads = path.join(dir, "heads");
    await mkdir(records, { recursive: true, mode: 0o700 });
    await mkdir(heads, { recursive: true, mode: 0o700 });
    await syncDirectory(records);
    await syncDirectory(heads);
    await syncDirectory(dir);
    return { dir, records, heads };
  }

  function readDirectory() {
    const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
    if (resolved.ok !== true) throw refusal(
      resolved.code ?? CODES.AUTHORITY_REJECTED,
      resolved.reason ?? "launcher durable root is unavailable");
    const dir = path.join(resolved.root, COMMON_PROOF_RECEIPT_DIRECTORY);
    return { dir, records: path.join(dir, "records"), heads: path.join(dir, "heads") };
  }

  async function population(records) {
    let entries;
    try {
      entries = await readdir(records);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const receiptState = entries.filter(
      (entry) => /^[0-9a-f]{64}\.(?:json|stale)$/u.test(entry));
    if (receiptState.length > COMMON_PROOF_RECEIPT_LIMITS.population_count) {
      throw refusal(CODES.POPULATION_OVERFLOW,
        "common-proof receipt population exceeds its closed bound");
    }
    return receiptState;
  }

  async function publishProjectionGroup(entries, {
    expectedPriorSelectorDigest = undefined
  } = {}) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 3 ||
        (expectedPriorSelectorDigest !== undefined && expectedPriorSelectorDigest !== null &&
          !DIGEST_RE.test(expectedPriorSelectorDigest))) {
      throw refusal(CODES.AUTHORITY_REJECTED,
        "common-proof publication group or expected-prior identity is invalid");
    }
    assertRequestBound({ entries, expectedPriorSelectorDigest });
    const publications = entries.map(({ selector, projection }) => ({
      selector,
      identity: identityFor(selector, repositoryAlias),
      projection,
      ...publicationRecord(selector, projection)
    }));
    const head = createIdentityHead(publications.map((entry) => ({
      identity: entry.identity,
      selectorDigest: entry.selectorDigest,
      contentIdentity: entry.projectionDigest
    })));
    const { dir, records, heads } = await publicationDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      const entries = await population(records);
      const headPath = path.join(heads, `${head.key.slice(7)}.json`);
      let priorHeadRaw = null;
      try {
        priorHeadRaw = await readFile(headPath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      let prior = null;
      if (priorHeadRaw !== null) {
        prior = parseIdentityHead(priorHeadRaw, publications[0].identity);
        const priorSelectors = prior.members.map((member) => member.selector_digest).sort();
        const nextSelectors = publications.map((entry) => entry.selectorDigest).sort();
        const exactHead = canonicalBytes(prior.head) === canonicalBytes(head.head);
        if (expectedPriorSelectorDigest !== undefined &&
            !priorSelectors.includes(expectedPriorSelectorDigest)) {
          throw refusal(CODES.CONFLICT,
            "common-proof identity-head expected-prior comparison failed");
        }
        if (!exactHead && expectedPriorSelectorDigest === undefined) {
          throw refusal(CODES.CONFLICT,
            "common-proof identity head requires an exact expected-prior selector");
        }
        if (exactHead && canonicalBytes(priorSelectors) !== canonicalBytes(nextSelectors)) {
          throw refusal(CODES.CONFLICT, "common-proof identity-head replay is divergent");
        }
      } else if (expectedPriorSelectorDigest !== undefined &&
          expectedPriorSelectorDigest !== null) {
        throw refusal(CODES.CONFLICT,
          "common-proof identity-head expected-prior names an absent head");
      }
      const missingCount = publications.filter((entry) =>
        !entries.includes(`${entry.selectorDigest.slice(7)}.json`)).length;
      if (entries.length + missingCount > COMMON_PROOF_RECEIPT_LIMITS.population_count) {
        throw refusal(CODES.POPULATION_OVERFLOW,
          "common-proof receipt population cannot accept the complete visibility group");
      }
      for (const published of publications) {
        const target = path.join(records, `${published.selectorDigest.slice(7)}.json`);
        let existing = null;
        try { existing = await readFile(target, "utf8"); } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        if (existing !== null) {
          parseCanonicalRecord(existing, published.selector);
          if (existing !== published.bytes) throw refusal(CODES.CONFLICT,
            "divergent common-proof bytes already occupy one immutable selector identity");
          continue;
        }
        await publishImmutableEvidenceOnce(target, published.bytes, faultInjector,
          publications.length === 3 ? "common_proof_behavioral_group_record" :
            "common_proof_receipt");
        const observed = await readFile(target, "utf8");
        parseCanonicalRecord(observed, published.selector);
        if (observed !== published.bytes) throw refusal(CODES.CONFLICT,
          "a concurrent common-proof publisher occupied one immutable selector identity");
      }
      await faultInjector?.("common_proof_identity_head_before_publish");
      await writeAtomicPublished(headPath, head.bytes, faultInjector,
        publications.length === 3 ? "common_proof_behavioral_group_head" :
          "common_proof_identity_head");
      parseIdentityHead(await readFile(headPath, "utf8"), publications[0].identity);
      return deepFreeze({
        ok: true,
        status: priorHeadRaw === null ? "published" :
          canonicalBytes(prior.head) === canonicalBytes(head.head) ? "replayed" : "advanced",
        selector: publicSelector(publications[0].selector),
        identity: publications[0].identity,
        content_identity: publications[0].projectionDigest,
        group_member_count: publications.length
      });
    });
  }

  async function publishProjection(selector, projection, options) {
    return publishProjectionGroup([{ selector, projection }], options);
  }

  async function publishTestVerification(input, options) {
    assertExactKeys(input, ["context", "attempt"], "test-verification publication");
    assertRequestBound(input);
    const context = assertLauncherTestProofAttemptContext(input.context);
    const projection = projectTestProofRuntimeEvidenceReceipt(input.attempt);
    if (canonicalBytes(identityWithoutEvidenceId(projection)) !==
        canonicalBytes(context.evidence_identity)) {
      throw refusal(CODES.PROJECTION_REJECTED,
        "the live test-proof attempt is not bound to its authenticated attempt context");
    }
    const identity = projection.evidence_identity;
    const authority = context.authority;
    if (authority.wk_id !== identity.wk_id ||
        authority.selected_unit !== identity.selected_unit) {
      throw refusal(CODES.PROJECTION_REJECTED,
        "the authenticated test-proof boundary disagrees on WK or exact unit");
    }
    const lifecycle = canonicalize({
      state: "current",
      controlled_contract_generation: identity.controlled_contract_generation,
      contract_digest: projection.contract_binding.contract_digest,
      contract_schema_version: projection.contract_binding.contract_schema_version,
      source_snapshot_digest: identity.source_snapshot_digest,
      run_id: identity.run_id,
      attempt: identity.attempt
    });
    const selector = selectorFor({
      repository: bindProjectionRepository(authority.main_repo), wkId: identity.wk_id,
      unitAddress: identity.selected_unit, family: "test_verification_validity",
      verificationId: identity.verification_id, lifecycle
    });
    return publishProjection(selector, projection, options);
  }

  async function publishWriteConfinement(input, options) {
    assertExactKeys(input, ["authenticatedDelivery", "receiptBinding", "observedAt"],
      "write-confinement publication");
    assertRequestBound(input);
    const projection = projectWriteConfinementEvidence(input);
    if (projection?.projected !== true || projection.refusal !== null) {
      throw refusal(projection?.refusal?.code ?? CODES.PROJECTION_REJECTED,
        projection?.refusal?.reason ?? "write-confinement owner refused publication");
    }
    const evidence = projection.evidence;
    const lifecycle = canonicalize({ state: "current", run_id: evidence.run_id,
      attempt: evidence.attempt, base_commit: evidence.base_commit,
      delivery_commit: evidence.delivery_commit, delivery_tree: evidence.delivery_tree });
    const selector = selectorFor({ repository: bindProjectionRepository(evidence.repository),
      wkId: evidence.record_id, unitAddress: evidence.unit_address,
      family: "write_confinement", verificationId: null, lifecycle });
    return publishProjection(selector, projection, options);
  }

  async function publishBehavioralPreservation(input, options) {
    const publication = assertBehavioralPreservationPublication(input);
    assertRequestBound(publication);
    const projection = publication.pair;
    const shared = projection.pair_evidence.shared_invariants;
    const sides = projection.pair_evidence.sides;
    if (!Array.isArray(sides) || sides.length !== 2 ||
        sides[0]?.position !== "baseline" || sides[1]?.position !== "candidate") {
      throw refusal(CODES.PROJECTION_REJECTED,
        "behavioral-preservation owner did not return one ordered pair");
    }
    const lifecycle = canonicalize({ state: "current", pair_id: projection.pair_id,
      controlled_contract_generation: shared.controlled_contract_generation,
      baseline_source_snapshot_digest: sides[0].source_snapshot_digest,
      candidate_source_snapshot_digest: sides[1].source_snapshot_digest });
    const selector = selectorFor({
      repository: bindProjectionRepository(projection.pair_evidence.repository),
      wkId: shared.wk_id, unitAddress: shared.selected_unit,
      family: "behavioral_preservation", verificationId: shared.verification_id,
      lifecycle
    });
    const baselineReport = publication.reports.baseline;
    const candidateReport = publication.reports.candidate;
    const baselineSelector = selectorFor({
      repository: selector.repository, wkId: selector.wk_id,
      unitAddress: selector.unit_address, family: selector.family,
      verificationId: selector.verification_id, lifecycle,
      artifact: BEHAVIORAL_REPORT_ARTIFACT, side: "baseline"
    });
    const candidateSelector = selectorFor({
      repository: selector.repository, wkId: selector.wk_id,
      unitAddress: selector.unit_address, family: selector.family,
      verificationId: selector.verification_id, lifecycle,
      artifact: BEHAVIORAL_REPORT_ARTIFACT, side: "candidate"
    });
    return publishProjectionGroup([
      { selector, projection },
      { selector: baselineSelector, projection: baselineReport },
      { selector: candidateSelector, projection: candidateReport }
    ], options);
  }

  async function select(input) {
    let selector;
    try {
      selector = validateSelector(input);
      await faultInjector?.("common_proof_receipt_before_select");
      const { records } = readDirectory();
      await population(records);
      const selectorDigest = digest(selector);
      const target = path.join(records, `${selectorDigest.slice(7)}.json`);
      try {
        const stale = await readFile(
          path.join(records, `${selectorDigest.slice(7)}.stale`), "utf8");
        validateStaleMarker(stale, selectorDigest);
        return failed(CODES.STALE,
          "the exact common-proof receipt lifecycle is no longer current");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      let raw;
      try {
        raw = await readFile(target, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return failed(CODES.ABSENT,
          "no common-proof receipt exists for the exact selector");
        throw error;
      }
      const validated = parseCanonicalRecord(raw, selector);
      const returnedBytes = bytesOf(validated.projection);
      if (returnedBytes > COMMON_PROOF_RECEIPT_LIMITS.returned_bytes) {
        return failed(CODES.RETURN_OVERFLOW,
          "common-proof projection exceeds its returned byte limit");
      }
      return deepFreeze({ ok: true, status: "selected", selector: publicSelector(selector),
        content_identity: validated.record.content_identity,
        projection: validated.projection });
    } catch (error) {
      return resultFromError(error);
    }
  }

  async function selectIdentity(input) {
    try {
      const identity = validateIdentity(input);
      await faultInjector?.("common_proof_identity_before_select");
      if (identity.repository_alias !== repositoryAlias) {
        throw refusal(CODES.SELECTOR_MISMATCH,
          "common-proof receipt identity names another launcher-bound repository alias");
      }
      const { heads, records } = readDirectory();
      let headRaw;
      try {
        headRaw = await readFile(path.join(heads, `${identityKey(identity).slice(7)}.json`), "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return failed(CODES.ABSENT,
          "no common-proof identity head exists for the exact identity");
        throw error;
      }
      const parsedHead = parseIdentityHead(headRaw, identity);
      let selectedProjection = null;
      let selectedContentIdentity = null;
      for (const member of parsedHead.members) {
        const recordPath = path.join(records, `${member.selector_digest.slice(7)}.json`);
        let raw;
        try { raw = await readFile(recordPath, "utf8"); } catch (error) {
          if (error?.code === "ENOENT") throw refusal(
            identity.family === "behavioral_preservation"
              ? CODES.INCOMPLETE_BEHAVIORAL_GROUP : CODES.CORRUPT,
            "common-proof identity head references a missing immutable record");
          throw error;
        }
        const validated = parseCanonicalRecord(raw);
        bindProjectionRepository(validated.selector.repository);
        if (validated.record.selector_digest !== member.selector_digest ||
            validated.record.content_identity !== member.content_identity) {
          throw refusal(CODES.CORRUPT,
            "common-proof identity head does not reproduce its immutable record binding");
        }
        const observedIdentity = identityFor(validated.selector, repositoryAlias);
        if (canonicalBytes(observedIdentity) !== canonicalBytes(member.identity)) {
          throw refusal(CODES.SELECTOR_MISMATCH,
            "common-proof immutable record does not match its exact identity-head member");
        }
        try {
          const stale = await readFile(
            path.join(records, `${member.selector_digest.slice(7)}.stale`), "utf8");
          validateStaleMarker(stale, member.selector_digest);
          throw refusal(CODES.STALE,
            "the exact common-proof receipt lifecycle is no longer current");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        if (canonicalBytes(member.identity) === canonicalBytes(identity)) {
          selectedProjection = validated.projection;
          selectedContentIdentity = validated.record.content_identity;
        }
      }
      if (selectedProjection === null) throw refusal(CODES.SELECTOR_MISMATCH,
        "common-proof identity head omitted the exact requested projection");
      const returnedBytes = bytesOf(selectedProjection);
      if (returnedBytes > COMMON_PROOF_RECEIPT_LIMITS.returned_bytes) {
        return failed(CODES.RETURN_OVERFLOW,
          "common-proof projection exceeds its returned byte limit");
      }
      return deepFreeze({
        ok: true,
        status: "selected",
        identity,
        content_identity: selectedContentIdentity,
        projection: selectedProjection
      });
    } catch (error) {
      return resultFromError(error);
    }
  }

  async function markStale(selector) {
    const validated = validateSelector(selector);
    const selectorDigest = digest(validated);
    const marker = canonicalBytes({
      schema_version: COMMON_PROOF_RECEIPT_STALE_SCHEMA_VERSION,
      selector_digest: selectorDigest
    });
    const { dir, records } = await publicationDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      const entries = await population(records);
      const receiptPath = path.join(records, `${selectorDigest.slice(7)}.json`);
      let receiptBytes;
      try {
        receiptBytes = await readFile(receiptPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") throw refusal(CODES.ABSENT,
          "cannot mark an absent common-proof receipt stale");
        throw error;
      }
      parseCanonicalRecord(receiptBytes, validated);
      const target = path.join(records, `${selectorDigest.slice(7)}.stale`);
      if (!entries.includes(path.basename(target)) &&
          entries.length >= COMMON_PROOF_RECEIPT_LIMITS.population_count) {
        throw refusal(CODES.POPULATION_OVERFLOW,
          "common-proof receipt population cannot accept another stale marker");
      }
      await publishImmutableEvidenceOnce(target, marker, faultInjector,
        "common_proof_receipt_stale");
      validateStaleMarker(await readFile(target, "utf8"), selectorDigest);

      return Object.freeze({ ok: true, status: "stale", selector: publicSelector(validated) });
    });
  }

  async function cleanup({ retainSelectors } = {}) {
    if (!Array.isArray(retainSelectors)) {
      throw refusal(CODES.AUTHORITY_REJECTED,
        "common-proof cleanup requires one exact retained-selector population");
    }
    if (retainSelectors.length > COMMON_PROOF_RECEIPT_LIMITS.population_count) {
      throw refusal(CODES.POPULATION_OVERFLOW,
        "retained common-proof selector population exceeds its bound");
    }
    const retained = new Set(retainSelectors.map((selector) => digest(validateSelector(selector)).slice(7)));
    const { dir, records, heads } = await publicationDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      const entries = await population(records);
      const headEntries = (await readdir(heads)).filter((entry) => /^[0-9a-f]{64}\.json$/u.test(entry));
      if (headEntries.length > COMMON_PROOF_RECEIPT_LIMITS.population_count) {
        throw refusal(CODES.POPULATION_OVERFLOW,
          "common-proof identity-head population exceeds its closed bound");
      }
      for (const entry of headEntries) {
        const raw = await readFile(path.join(heads, entry), "utf8");
        let parsed;
        try { parsed = JSON.parse(raw); } catch (cause) {
          throw refusal(CODES.CORRUPT, "common-proof identity head is invalid JSON", cause);
        }
        const firstIdentity = parsed?.members?.[0]?.identity;
        const head = parseIdentityHead(raw, validateIdentity(firstIdentity));
        const memberDigests = head.members.map((member) => member.selector_digest.slice(7));
        if (memberDigests.some((member) => retained.has(member))) {
          for (const member of memberDigests) retained.add(member);
        } else {
          await rm(path.join(heads, entry));
        }
      }
      let removed = 0;
      for (const entry of entries) {
        if (retained.has(entry.slice(0, 64))) continue;
        await rm(path.join(records, entry));
        removed += 1;
      }
      if (removed > 0) await syncDirectory(records);
      if (headEntries.length > 0) await syncDirectory(heads);
      return Object.freeze({ ok: true, status: "cleaned", removed,
        retained: entries.length - removed });
    });
  }

  return Object.freeze({
    publishTestVerification,
    publishWriteConfinement,
    publishBehavioralPreservation,
    select,
    selectIdentity,
    markStale,
    cleanup
  });
}
