

import {
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  isPlainObject
} from "./protocol-constants.mjs";
import {
  findForbiddenToken,
  findForbiddenTokenInLaunchInput
} from "./forbidden-token-scan.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES,
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS,
  brokerBuildRefusalResponse
} from "./broker-refusals.mjs";

export const PROVISION_WORKTREE_REQUEST_FIELDS = Object.freeze([
  "role", "subject", "initiative", "launch_ref", "run_id", "retry_id"
]);

export const PROVISION_WORKTREE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "provision_request"
]);
export const EXACT_IMPLEMENTATION_SLICE_SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;
export const INITIATIVE_ID_RE = /^IN-\d{4}$/u;

export function brokerValidateRequestEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: { issue: "request_not_object" }
    });
  }
  if (envelope.schema_version !== HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: {
        issue: "request_schema_version_mismatch",
        expected: HOST_WRITE_AUTHORITY_REQUEST_SCHEMA_VERSION,
        received: envelope.schema_version ?? null
      }
    });
  }
  if (envelope.substrate_id !== HOST_WRITE_AUTHORITY_SUBSTRATE_ID) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
      detail: {
        issue: "request_substrate_id_mismatch",
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
        received: envelope.substrate_id ?? null
      }
    });
  }
  if (envelope.protocol_version !== HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PROTOCOL_VERSION_UNSUPPORTED,
      detail: {
        expected: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
        received: envelope.protocol_version ?? null
      }
    });
  }
  const validOps = Object.values(HOST_WRITE_AUTHORITY_OPS);
  if (!validOps.includes(envelope.op)) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.OP_UNRECOGNIZED,
      detail: {
        received_op: typeof envelope.op === "string" ? envelope.op : null
      }
    });
  }
  const forbidden = envelope.op === HOST_WRITE_AUTHORITY_OPS.START_LAUNCH
    ? findForbiddenTokenInLaunchInput(envelope.launch_input ?? null)
    : findForbiddenToken(envelope);
  if (forbidden) {
    return brokerBuildRefusalResponse({
      code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
      reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.FORBIDDEN_TOKEN_IN_REQUEST,
      detail: { token: forbidden }
    });
  }
  return { ok: true, envelope };
}
