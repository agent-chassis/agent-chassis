

import {
  AUTHORING_CONTINUATION_PATTERN,
  loadControlledContractPackage,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";
import { continuationContentDigest } from "./controlled-contract-continuation-encoding.mjs";

export const CONTINUATION_SCHEMA = "controlled-contract-authoring-continuation.v1";
export const CONTROLLED_CONTRACT_DESIGN_RESPONSE_KINDS = Object.freeze([
  "declare_controlled_acceptance_applies", "explicitly_opt_out_controlled_acceptance",

  "contract_requirements"
]);
export const CONTROLLED_CONTRACT_DESIGN_SEMANTIC_OWNERS = Object.freeze([
  "proof_posture", "contract_carrier"
]);

export function continuationFailure(code, message, details = {}) {
  fail(`controlled_contract_authoring_continuation_${code}`, message, details);
}

export function continuationHex(identity) {
  if (typeof identity !== "string" || !AUTHORING_CONTINUATION_PATTERN.test(identity)) {
    return null;
  }
  return identity.startsWith("sha256:") ? identity.slice(7) : identity;
}

export function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertServerOwnedSourceDeclaration(expectedSources, requiredKinds) {
  const invalid = (message, details = {}) => continuationFailure("invalid", message, details);
  if (!Array.isArray(expectedSources)) invalid(
    "a public continuation requires the server-owned source declaration");
  const declared = expectedSources.map((expectation) => expectation?.carrier_kind ?? null);
  if (declared.length !== requiredKinds.length ||
      requiredKinds.some((kind, index) => declared[index] !== kind)) {
    invalid("the server-owned source declaration is not one expectation per addressable carrier", {
      required_expected_source_kinds: [...requiredKinds],
      declared_expected_source_kinds: declared
    });
  }
  for (const expectation of expectedSources) {
    const present = expectation.presence === "present";
    if (!present && expectation.presence !== "absent") invalid(
      "a server-owned source expectation declares neither presence nor absence", {
        carrier_kind: expectation.carrier_kind
      });
    if (present === (expectation.expected_content_digest === null)) invalid(
      "a server-owned source expectation carries the wrong content-digest shape", {
        carrier_kind: expectation.carrier_kind,
        presence: expectation.presence
      });
  }
}

export function assertOneControlledContractSemanticOwner(record) {
  const skeleton = record.skeleton;
  if (!isPlainObject(skeleton)) continuationFailure("invalid",
    "a continuation record carries no validated skeleton");
  if (record.skeleton_digest !== continuationContentDigest(skeleton)) {
    continuationFailure("tampered",
      "the stored validated skeleton does not match its recorded digest", {
        field: "skeleton_digest"
      });
  }
  if (!sameJsonValue(record.semantic_bindings, skeleton.evaluation_input)) {
    continuationFailure("tampered",
      "a semantic compatibility projection diverged from the validated skeleton", {
        field: "semantic_bindings"
      });
  }
  const identity = record.package_continuation?.identity;
  if (identity && (
    !sameJsonValue(identity.chosen_bindings, skeleton.evaluation_input) ||
      !sameJsonValue(identity.pack, skeleton.selected_pack) ||
      !sameJsonValue(identity.intents, skeleton.requested_intents) ||
      identity.package_version !== record.package_generation)) {
    continuationFailure("tampered",
      "the package continuation no longer authenticates the stored skeleton", {
        field: "package_continuation"
      });
  }
  return record;
}

export function contentAddressedContinuation(value) {
  const body = structuredClone(value);
  delete body.identity;
  const identity = continuationContentDigest(body);
  return deepFreezePlainData({ identity, ...body });
}

const RECORD_KEYS = Object.freeze([
  "schema_version", "identity", "wk_id", "focus", "contract_content_digest",
  "package_generation", "package_continuation", "skeleton", "skeleton_digest",
  "semantic_bindings", "proof_graph"
].sort());
const REFACTOR_RECORD_KEYS = Object.freeze([
  "schema_version", "identity", "wk_id", "focus", "contract_content_digest",
  "package_generation", "refactor"
].sort());
const WORKBENCH_RECORD_KEYS = Object.freeze([
  "schema_version", "identity", "wk_id", "focus", "workbench"
].sort());
const WORKBENCH_KEYS = Object.freeze([
  "status", "attempt", "row_id", "row_digest", "source_identity", "dependencies",
  "semantic_owner", "response_kinds", "owner_context", "response_digest",
  "result_digest"
].sort());

function authenticateWorkbenchRecord(value, expectedIdentity) {
  const workbench = value?.workbench;
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(WORKBENCH_RECORD_KEYS) || value.schema_version !== CONTINUATION_SCHEMA ||
      value.identity !== expectedIdentity || !isPlainObject(workbench) ||
      JSON.stringify(Object.keys(workbench).sort()) !== JSON.stringify(WORKBENCH_KEYS)) {
    continuationFailure("tampered", "durable workbench continuation has an invalid shape");
  }
  try {
    normalizeControlledContractIdentity({ wkId: value.wk_id, focus: value.focus });
  } catch (error) {
    continuationFailure("tampered", "durable workbench continuation scope is invalid", {
      cause_code: error?.code ?? null
    });
  }
  const validKinds = Array.isArray(workbench.response_kinds) &&
    workbench.response_kinds.length > 0 &&
    new Set(workbench.response_kinds).size === workbench.response_kinds.length &&
    workbench.response_kinds.every((kind) =>
      CONTROLLED_CONTRACT_DESIGN_RESPONSE_KINDS.includes(kind));
  if (!["issued", "applying", "retryable", "applied"].includes(workbench.status) ||
      !Number.isSafeInteger(workbench.attempt) || workbench.attempt < 0 ||
      typeof workbench.row_id !== "string" || workbench.row_id.length === 0 ||
      typeof workbench.row_digest !== "string" || !isPlainObject(workbench.source_identity) ||
      !Array.isArray(workbench.dependencies) || !validKinds ||
      !CONTROLLED_CONTRACT_DESIGN_SEMANTIC_OWNERS.includes(workbench.semantic_owner) ||
      !isPlainObject(workbench.owner_context) ||
      (workbench.status === "issued" &&
        (workbench.attempt !== 0 || workbench.response_digest !== null ||
          workbench.result_digest !== null)) ||
      (["applying", "retryable"].includes(workbench.status) &&
        (typeof workbench.response_digest !== "string" || workbench.result_digest !== null)) ||
      (workbench.status === "applied" &&
        (typeof workbench.response_digest !== "string" ||
          typeof workbench.result_digest !== "string"))) {
    continuationFailure("tampered", "durable workbench continuation payload is malformed");
  }
  const recomputed = contentAddressedContinuation(value);
  if (recomputed.identity !== expectedIdentity) continuationFailure("tampered",
    "durable workbench continuation content does not match its identity");
  return deepFreezePlainData(structuredClone(value));
}

function authenticateRefactorRecord(value, expectedIdentity) {
  if (JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(REFACTOR_RECORD_KEYS) || value.schema_version !== CONTINUATION_SCHEMA ||
      value.identity !== expectedIdentity || !isPlainObject(value.refactor) ||
      typeof value.contract_content_digest !== "string" ||
      typeof value.package_generation !== "string") {
    continuationFailure("tampered", "durable refactor continuation has an invalid shape");
  }
  try {
    normalizeControlledContractIdentity({ wkId: value.wk_id, focus: value.focus });
  } catch (error) {
    continuationFailure("tampered", "durable refactor continuation scope is invalid", {
      cause_code: error?.code ?? null
    });
  }
  const required = ["status", "source", "plan_identity", "snapshot_digest",
    "transaction_identity", "receipt_identity"];
  if (JSON.stringify(Object.keys(value.refactor).sort()) !== JSON.stringify(required.sort()) ||
      !["planned", "publishing", "published"].includes(value.refactor.status) ||
      !isPlainObject(value.refactor.source) ||
      typeof value.refactor.plan_identity !== "string" ||
      typeof value.refactor.snapshot_digest !== "string" ||
      typeof value.refactor.transaction_identity !== "string" ||
      (value.refactor.receipt_identity !== null &&
        typeof value.refactor.receipt_identity !== "string")) {
    continuationFailure("tampered", "durable refactor continuation payload is malformed");
  }
  const recomputed = contentAddressedContinuation(value);
  if (recomputed.identity !== expectedIdentity) continuationFailure("tampered",
    "durable refactor continuation content does not match its identity");
  return deepFreezePlainData(structuredClone(value));
}

export async function authenticateRecord(value, expectedIdentity) {
  if (isPlainObject(value) && isPlainObject(value.workbench)) {
    return authenticateWorkbenchRecord(value, expectedIdentity);
  }
  if (isPlainObject(value) && isPlainObject(value.refactor)) {
    return authenticateRefactorRecord(value, expectedIdentity);
  }
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(RECORD_KEYS)) {
    continuationFailure("tampered", "durable continuation record has an invalid shape");
  }
  if (value.schema_version !== CONTINUATION_SCHEMA || value.identity !== expectedIdentity ||
      typeof value.contract_content_digest !== "string" ||
      typeof value.package_generation !== "string" ||
      !isPlainObject(value.package_continuation) || !isPlainObject(value.proof_graph)) {
    continuationFailure("tampered", "durable continuation record identity or fields are invalid");
  }
  try {
    normalizeControlledContractIdentity({ wkId: value.wk_id, focus: value.focus });
  } catch (error) {
    continuationFailure("tampered", "durable continuation record scope is invalid", {
      cause_code: error?.code ?? null
    });
  }
  assertOneControlledContractSemanticOwner(value);
  const pkg = await loadControlledContractPackage();
  assertServerOwnedSourceDeclaration(
    value.proof_graph.expected_sources, pkg.PROOF_GRAPH_CARRIER_KINDS);
  let admitted;
  try {
    admitted = pkg.validateProofGraphProposal(value.proof_graph.proposal);
  } catch (error) {
    continuationFailure("tampered", "durable continuation proposal is invalid", {
      cause_code: error?.code ?? null
    });
  }
  if (value.proof_graph.proposal_digest !==
      continuationContentDigest(admitted.server_projection)) {
    continuationFailure("tampered", "durable continuation proposal digest changed", {
      field: "proof_graph.proposal_digest"
    });
  }
  const recomputed = contentAddressedContinuation(value);
  if (recomputed.identity !== expectedIdentity) continuationFailure("tampered",
    "durable continuation content does not match its identity");
  return deepFreezePlainData(structuredClone(value));
}
