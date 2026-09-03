

import { deepFreeze } from "./deterministic-projection-primitives.mjs";

const PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION = "controlled-proof-graph-proposal.v1";

const PROOF_GRAPH_PROPOSAL_FIELDS = Object.freeze([
  "schema_version",
  "wk_id",
  "focus",
  "contract_content_digest",
  "selected_pack",
  "requested_intents",
  "skeleton_continuation",
  "carrier_operations"
]);

const PROOF_GRAPH_PROPOSAL_LIMITS = Object.freeze({
  carrier_operations: 64,
  projection_bytes: 1048576
});

const PROOF_GRAPH_CARRIER_KINDS = Object.freeze([
  "contract", "evaluation_input", "proof_plan_request"
]);

const PROOF_GRAPH_OPERATION_KINDS = Object.freeze([
  "carrier_patch", "verification_bundle"
]);

const CARRIER_PATCH_OPERATION_FIELDS = Object.freeze([
  "kind", "carrier_kind", "op", "target", "id", "value"
]);
const CARRIER_PATCH_OPERATION_REQUIRED = Object.freeze([
  "kind", "carrier_kind"
]);
const VERIFICATION_BUNDLE_OPERATION_FIELDS = Object.freeze([
  "kind", "op", "verification_id", "bundle"
]);
const SELECTED_PACK_FIELDS = Object.freeze(["profile_id", "profile_version"]);
const SKELETON_CONTINUATION_FIELDS = Object.freeze([
  "continuation", "unresolved_required_roles"
]);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class ProofGraphProposalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofGraphProposalError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

function refuse(code, message, details = {}) {
  throw new ProofGraphProposalError(code, message, details);
}

function invalid(pointer, message, details = {}) {
  refuse("controlled_contract_proof_graph_proposal_invalid", message,
    { pointer, ...details });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function closedObjectKeys(value, allowed, pointer, { required = allowed } = {}) {
  if (!isPlainObject(value)) invalid(pointer, "value must be one closed plain object");
  const permitted = new Set(allowed);
  const unknown = Reflect.ownKeys(value)
    .filter((key) => typeof key !== "string" || !permitted.has(key))
    .map(String).sort();
  const missing = [...required].filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) invalid(pointer,
    "value carries unknown or missing closed fields", { unknown, missing });
  return value;
}

function nonEmptyString(value, pointer, label) {
  if (typeof value !== "string" || value.length === 0) invalid(pointer,
    `${label} must be one nonempty string`);
  return value;
}

function projectProofGraphProposal(proposal) {
  const projection = {};
  for (const field of PROOF_GRAPH_PROPOSAL_FIELDS) {
    projection[field] = structuredClone(proposal[field]);
  }
  return projection;
}

function measureProofGraphProposalBytes(serverProjection) {
  return Buffer.byteLength(JSON.stringify(serverProjection), "utf8");
}

function assertProposalEnvelope(proposal) {
  closedObjectKeys(proposal, PROOF_GRAPH_PROPOSAL_FIELDS, "");
  if (proposal.schema_version !== PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION) {
    invalid("/schema_version", "proposal schema version is unsupported", {
      expected: PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
      actual: proposal.schema_version ?? null
    });
  }

  nonEmptyString(proposal.wk_id, "/wk_id", "wk_id");
  if (proposal.focus !== null) nonEmptyString(proposal.focus, "/focus", "focus");
  if (typeof proposal.contract_content_digest !== "string" ||
      !DIGEST_PATTERN.test(proposal.contract_content_digest)) {
    invalid("/contract_content_digest",
      "contract_content_digest must be one exact sha256 digest");
  }
  closedObjectKeys(proposal.selected_pack, SELECTED_PACK_FIELDS, "/selected_pack");
  nonEmptyString(proposal.selected_pack.profile_id,
    "/selected_pack/profile_id", "profile_id");
  nonEmptyString(proposal.selected_pack.profile_version,
    "/selected_pack/profile_version", "profile_version");
  if (!Array.isArray(proposal.requested_intents)) {
    invalid("/requested_intents", "requested_intents must be one array");
  }
  const intents = new Set();
  for (const [index, intent] of proposal.requested_intents.entries()) {
    nonEmptyString(intent, `/requested_intents/${index}`, "requested intent");
    if (intents.has(intent)) invalid(`/requested_intents/${index}`,
      "requested_intents must not repeat one intent", { intent_id: intent });
    intents.add(intent);
  }

  closedObjectKeys(proposal.skeleton_continuation, SKELETON_CONTINUATION_FIELDS,
    "/skeleton_continuation");
  if (!isPlainObject(proposal.skeleton_continuation.continuation)) {
    invalid("/skeleton_continuation/continuation",
      "the opaque continuation must be one plain object supplied by continueProofAuthoring");
  }
  if (!Array.isArray(proposal.skeleton_continuation.unresolved_required_roles)) {
    invalid("/skeleton_continuation/unresolved_required_roles",
      "unresolved_required_roles must be the array continueProofAuthoring reported");
  }
  if (!Array.isArray(proposal.carrier_operations)) {
    invalid("/carrier_operations", "carrier_operations must be one ordered array");
  }
}

function assertProposalBounds(operationCount, projectionBytes) {
  if (!Number.isInteger(operationCount) || operationCount < 0 ||
      operationCount > PROOF_GRAPH_PROPOSAL_LIMITS.carrier_operations) {
    refuse("controlled_contract_proof_graph_bound_exceeded",
      "carrier_operations.length is measured inclusively over 0 through 64", {
        pointer: "/carrier_operations",
        bound: "carrier_operations",
        minimum: 0,
        maximum: PROOF_GRAPH_PROPOSAL_LIMITS.carrier_operations,
        actual: operationCount
      });
  }
  if (projectionBytes > PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes) {
    refuse("controlled_contract_proof_graph_bound_exceeded",
      "the fixed-key proposal projection is measured inclusively over 0 through 1,048,576 UTF-8 bytes", {
        pointer: "",
        bound: "projection_bytes",
        minimum: 0,
        maximum: PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes,
        actual: projectionBytes
      });
  }
}

function assertCarrierOperation(operation, index) {
  const pointer = `/carrier_operations/${index}`;
  if (!isPlainObject(operation)) invalid(pointer,
    "each carrier operation must be one closed plain object");
  if (!PROOF_GRAPH_OPERATION_KINDS.includes(operation.kind)) {
    invalid(`${pointer}/kind`, "carrier operation kind is unsupported", {
      supported: [...PROOF_GRAPH_OPERATION_KINDS], actual: operation.kind ?? null
    });
  }
  if (operation.kind === "verification_bundle") {

    closedObjectKeys(operation, VERIFICATION_BUNDLE_OPERATION_FIELDS, pointer);
    return { kind: "verification_bundle", index, carrier_kind: "contract" };
  }

  closedObjectKeys(operation, CARRIER_PATCH_OPERATION_FIELDS, pointer,
    { required: CARRIER_PATCH_OPERATION_REQUIRED });
  if (!PROOF_GRAPH_CARRIER_KINDS.includes(operation.carrier_kind)) {
    invalid(`${pointer}/carrier_kind`, "carrier kind is unsupported", {
      supported: [...PROOF_GRAPH_CARRIER_KINDS], actual: operation.carrier_kind ?? null
    });
  }
  return { kind: "carrier_patch", index, carrier_kind: operation.carrier_kind };
}

function validateProofGraphProposal(proposal) {
  assertProposalEnvelope(proposal);
  const serverProjection = projectProofGraphProposal(proposal);
  const projectionBytes = measureProofGraphProposalBytes(serverProjection);
  const operationCount = proposal.carrier_operations.length;
  assertProposalBounds(operationCount, projectionBytes);

  const routes = proposal.carrier_operations.map(assertCarrierOperation);

  const addressed = PROOF_GRAPH_CARRIER_KINDS.filter((kind) =>
    routes.some((route) => route.carrier_kind === kind));
  return deepFreeze({
    schema_version: proposal.schema_version,
    wk_id: proposal.wk_id,
    focus: proposal.focus,
    contract_content_digest: proposal.contract_content_digest,
    selected_pack: structuredClone(proposal.selected_pack),
    requested_intents: structuredClone(proposal.requested_intents),
    skeleton_continuation: structuredClone(proposal.skeleton_continuation),
    carrier_operations: structuredClone(proposal.carrier_operations),
    routes,
    addressed_carrier_kinds: addressed,
    server_projection: serverProjection,
    projection_bytes: projectionBytes,
    operation_count: operationCount,
    carrier_patch_operation_count: routes.filter(
      ({ kind }) => kind === "carrier_patch").length,
    verification_bundle_operation_count: routes.filter(
      ({ kind }) => kind === "verification_bundle").length
  });
}

export {
  PROOF_GRAPH_CARRIER_KINDS,
  PROOF_GRAPH_OPERATION_KINDS,
  PROOF_GRAPH_PROPOSAL_FIELDS,
  PROOF_GRAPH_PROPOSAL_LIMITS,
  PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
  ProofGraphProposalError,
  measureProofGraphProposalBytes,
  projectProofGraphProposal,
  validateProofGraphProposal
};
