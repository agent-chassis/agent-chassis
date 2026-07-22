

import { isDeepStrictEqual } from "node:util";
import {
  BACKEND_CODE_BACKEND_UNAVAILABLE,
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  REFUSAL_REASON_TO_BACKEND_CODE,
  isPlainObject
} from "./protocol-constants.mjs";
import {
  findForbiddenTokenInLaunchInput
} from "./forbidden-token-scan.mjs";
import {
  buildHostWriteAuthorityCommitSliceEnvelope,
  buildHostWriteAuthorityCommitSliceRequest,
  buildHostWriteAuthorityIntegrateSliceEnvelope,
  buildHostWriteAuthorityIntegrateSliceRequest,
  buildHostWriteAuthorityPrepareSliceReviewSurfaceEnvelope,
  buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest,
  buildHostWriteAuthorityProbeEnvelope,
  buildHostWriteAuthorityProvisionWorktreeEnvelope,
  buildHostWriteAuthorityStartLaunchEnvelope,
  isCompleteCommitSliceRequestIdentity,
  isCompleteIntegrateSliceRequestIdentity,
  isCompletePrepareSliceReviewSurfaceRequestIdentity,
  isWorkerGateRefusalDetail,
  validateHostWriteAuthorityResponseEnvelope,
  validateSliceCommittedCommitResult,
  validateSliceIntegratedResult,
  validateSliceReviewSurfacePreparationResult
} from "./request-envelopes.mjs";

import {
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  MANAGED_SLICE_CHECKOUT_MODE_FULL
} from "../worktree-provisioning-dispatch.mjs";

import {
  HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_COMPLETED_RESPONSE_FIELDS,
  buildHostWriteAuthorityWkForgeHandoffEnvelope,
  buildHostWriteAuthorityWkForgeHandoffRequest,
  isCompleteWkForgeHandoffRequestIdentity,
  validateWkForgeHandoffResult
} from "./request-envelopes-wk-forge-handoff.mjs";

const MANAGED_PROVISIONING_CARRIER_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id", "slice_id",
  "unit_address", "retry_id", "wk_binding", "slice_binding",
  "worktree_path", "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
  "index_sparse", "validation_worktree_path", "shared_git_exposed"
]);

const MANAGED_PROVISIONING_CARRIER_FIELDS_V2 = Object.freeze([
  ...MANAGED_PROVISIONING_CARRIER_FIELDS.filter(
    (field) => field !== "cone_dirs" && field !== "index_sparse"
  ),
  "checkout_mode"
]);

function managedCarrierCheckoutMode(value) {
  if (!isPlainObject(value)) return null;
  const has = (field) => Object.prototype.hasOwnProperty.call(value, field);
  const hasCone = has("cone_dirs");
  const hasIndexSparse = has("index_sparse");
  const hasCheckoutMode = has("checkout_mode");
  if (hasCheckoutMode && !hasCone && !hasIndexSparse) {
    return value.checkout_mode === MANAGED_SLICE_CHECKOUT_MODE_FULL ? "full" : null;
  }
  if (!hasCheckoutMode && hasCone && hasIndexSparse) return "sparse";
  return null;
}

function hasExactManagedProvisioningFields(value) {
  const mode = managedCarrierCheckoutMode(value);
  if (mode === null) return false;
  const fields = mode === "full"
    ? MANAGED_PROVISIONING_CARRIER_FIELDS_V2
    : MANAGED_PROVISIONING_CARRIER_FIELDS;
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function validateManagedProvisioningCarrier(carrier, expectedRetryId) {
  if (!hasExactManagedProvisioningFields(carrier) ||
      carrier.schema_version !== MANAGED_WORKTREE_BINDING_SCHEMA_VERSION ||
      carrier.complete !== true) {
    return { ok: false, detail: { issue: "carrier_incomplete_or_extended_schema" } };
  }
  const sliceBinding = carrier.slice_binding;
  const wkBinding = carrier.wk_binding;
  if (!isPlainObject(sliceBinding) || !isPlainObject(wkBinding)) {
    return { ok: false, detail: { issue: "carrier_missing_nested_bindings" } };
  }
  if (typeof carrier.main_repo !== "string" || carrier.main_repo.length === 0 ||
      carrier.worktree_path !== sliceBinding.worktree_path ||
      carrier.retry_id !== sliceBinding.retry_id ||
      carrier.retry_id !== wkBinding.retry_id ||
      carrier.unit_address !== sliceBinding.unit_address) {
    return { ok: false, detail: { issue: "carrier_internally_inconsistent" } };
  }
  if (!Number.isInteger(carrier.retry_id) || carrier.retry_id < 0) {
    return { ok: false, detail: { issue: "carrier_retry_id_invalid", retry_id: carrier.retry_id ?? null } };
  }
  if (!Number.isInteger(expectedRetryId) || expectedRetryId < 0 || carrier.retry_id !== expectedRetryId) {
    return {
      ok: false,
      detail: {
        issue: "carrier_retry_id_mismatch",
        expected_retry_id: Number.isInteger(expectedRetryId) ? expectedRetryId : null,
        actual_retry_id: carrier.retry_id
      }
    };
  }
  return { ok: true };
}

function deepFreezeManagedProvisioningCarrier(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreezeManagedProvisioningCarrier(child);
  return Object.freeze(value);
}

function adapterRefusal(reason, detail) {
  const code =
    REFUSAL_REASON_TO_BACKEND_CODE[reason] ?? BACKEND_CODE_BACKEND_UNAVAILABLE;
  return {
    accepted: false,
    refusal: {
      code,
      reason,
      detail: Object.freeze({
        substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
        protocol_version: HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
        ...(detail ?? {})
      })
    }
  };
}

export function createHostWriteAuthoritySubstrateAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthoritySubstrateAdapter(input) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        {
          missing_backend:
            "host_write_authority_substrate_channel"
        }
      );
    }

    const forbiddenInputToken = findForbiddenTokenInLaunchInput(input ?? null);
    if (forbiddenInputToken) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORBIDDEN_TOKEN_IN_LAUNCH_INPUT,
        { token: forbiddenInputToken }
      );
    }

    const requestEnvelope = buildHostWriteAuthorityStartLaunchEnvelope(input);

    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (err) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: err?.message ?? String(err)
      });
    }

    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.START_LAUNCH
    );
    if (!validation.ok) {
      return adapterRefusal(validation.reason, validation.detail);
    }
    const response = validation.response;

    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      const brokerRefusalDetail = response.refusal?.detail ?? null;
      const detail = {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string"
            ? response.refusal.reason
            : null,
        broker_refusal_detail: brokerRefusalDetail
      };

      if (isWorkerGateRefusalDetail(brokerRefusalDetail)) {
        detail.worker_gate_refusal = true;
        detail.wrapper_gate_code = brokerRefusalDetail.wrapper_gate_code ?? null;
      }
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED,
        detail
      );
    }

    const runHandle = response.run_handle;

    return {
      accepted: true,
      status: response.status,
      pid: typeof response.pid === "number" ? response.pid : null,
      probe: async () => {
        const probeEnvelope = buildHostWriteAuthorityProbeEnvelope(runHandle);
        let rawProbe;
        try {
          rawProbe = await channel(probeEnvelope);
        } catch (err) {

          return {
            status: "failed",
            exit: {
              code: null,
              signal: null,
              error: `${HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW}: ${
                err?.message ?? String(err)
              }`
            },
            final_result: null
          };
        }
        const probeValidation = validateHostWriteAuthorityResponseEnvelope(
          rawProbe,
          HOST_WRITE_AUTHORITY_OPS.PROBE_RUN
        );
        if (!probeValidation.ok) {
          return {
            status: "failed",
            exit: {
              code: null,
              signal: null,
              error: probeValidation.reason
            },
            final_result: null
          };
        }
        const probeResponse = probeValidation.response;
        if (probeResponse.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
          return {
            status: "failed",
            exit: {
              code: null,
              signal: null,
              error: HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED
            },
            final_result: null
          };
        }
        return {
          status: probeResponse.status,
          exit: probeResponse.exit ?? null,
          final_result: probeResponse.final_result ?? null
        };
      }
    };
  };
}

export function createHostWriteAuthorityProvisioningAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthorityProvisioningAdapter(request) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        { missing_backend: "host_write_authority_substrate_channel" }
      );
    }

    const requestEnvelope = buildHostWriteAuthorityProvisionWorktreeEnvelope(request);

    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (err) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: err?.message ?? String(err)
      });
    }

    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.PROVISION_WORKTREE
    );
    if (!validation.ok) {
      return adapterRefusal(validation.reason, validation.detail);
    }
    const response = validation.response;

    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED, {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string" ? response.refusal.reason : null,
        broker_refusal_detail: response.refusal?.detail ?? null
      });
    }

    const carrier = response.provisioning;
    const carrierCheck = validateManagedProvisioningCarrier(carrier, request?.retry_id);
    if (!carrierCheck.ok) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROVISIONING_CARRIER_INVALID,
        carrierCheck.detail
      );
    }

    let roundTripped;
    try {
      roundTripped = JSON.parse(JSON.stringify(carrier));
    } catch (err) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROVISIONING_CARRIER_INVALID,
        { issue: "carrier_not_json_serializable", message: err?.message ?? String(err) }
      );
    }
    if (!isDeepStrictEqual(roundTripped, carrier)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.PROVISIONING_CARRIER_INVALID,
        { issue: "carrier_lossy_over_json" }
      );
    }

    return {
      accepted: true,
      provisioning: deepFreezeManagedProvisioningCarrier(carrier)
    };
  };
}

export function createHostWriteAuthorityCommitAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthorityCommitAdapter(request) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        { missing_backend: "host_write_authority_substrate_channel" }
      );
    }

    const boundRequest = buildHostWriteAuthorityCommitSliceRequest(request);
    if (!isCompleteCommitSliceRequestIdentity(boundRequest)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.COMMIT_RESULT_INVALID,
        { issue: "commit_request_identity_incomplete" }
      );
    }

    const requestEnvelope = buildHostWriteAuthorityCommitSliceEnvelope(boundRequest);

    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (err) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: err?.message ?? String(err)
      });
    }

    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.COMMIT_SLICE
    );
    if (!validation.ok) {
      return adapterRefusal(validation.reason, validation.detail);
    }
    const response = validation.response;

    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED, {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string" ? response.refusal.reason : null,
        broker_refusal_detail: response.refusal?.detail ?? null
      });
    }

    const commitResult = response.commit_result;
    const resultCheck = validateSliceCommittedCommitResult(
      commitResult,
      boundRequest.assigned_unit
    );
    if (!resultCheck.ok) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.COMMIT_RESULT_INVALID,
        resultCheck.detail
      );
    }

    let roundTripped;
    try {
      roundTripped = JSON.parse(JSON.stringify(commitResult));
    } catch (err) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.COMMIT_RESULT_INVALID,
        { issue: "commit_result_not_json_serializable", message: err?.message ?? String(err) }
      );
    }
    if (!isDeepStrictEqual(roundTripped, commitResult)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.COMMIT_RESULT_INVALID,
        { issue: "commit_result_lossy_over_json" }
      );
    }
    return {
      accepted: true,
      commit_result: deepFreezeManagedProvisioningCarrier(commitResult)
    };
  };
}

export function createHostWriteAuthoritySliceReviewPreparationAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthoritySliceReviewPreparationAdapter(request) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        { missing_backend: "host_write_authority_substrate_channel" }
      );
    }
    if (!isCompletePrepareSliceReviewSurfaceRequestIdentity(request)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.SLICE_REVIEW_PREPARATION_RESULT_INVALID,
        { issue: "prepare_slice_review_surface_request_identity_incomplete" }
      );
    }
    const boundRequest = buildHostWriteAuthorityPrepareSliceReviewSurfaceRequest(request);
    const requestEnvelope = buildHostWriteAuthorityPrepareSliceReviewSurfaceEnvelope(boundRequest);
    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (error) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: error?.message ?? String(error)
      });
    }
    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.PREPARE_SLICE_REVIEW_SURFACE
    );
    if (!validation.ok) return adapterRefusal(validation.reason, validation.detail);
    const response = validation.response;
    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED, {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string" ? response.refusal.reason : null,
        broker_refusal_detail: response.refusal?.detail ?? null
      });
    }
    const preparation = response.preparation;
    const resultCheck = validateSliceReviewSurfacePreparationResult(preparation, boundRequest);
    if (!resultCheck.ok) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.SLICE_REVIEW_PREPARATION_RESULT_INVALID,
        resultCheck.detail
      );
    }
    let roundTripped;
    try {
      roundTripped = JSON.parse(JSON.stringify(preparation));
    } catch (error) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.SLICE_REVIEW_PREPARATION_RESULT_INVALID,
        { issue: "slice_review_surface_preparation_not_json_serializable", message: error?.message ?? String(error) }
      );
    }
    if (!isDeepStrictEqual(roundTripped, preparation)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.SLICE_REVIEW_PREPARATION_RESULT_INVALID,
        { issue: "slice_review_surface_preparation_lossy_over_json" }
      );
    }
    return {
      accepted: true,
      preparation: deepFreezeManagedProvisioningCarrier(preparation)
    };
  };
}

export function createHostWriteAuthorityIntegrationAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthorityIntegrationAdapter(request) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        { missing_backend: "host_write_authority_substrate_channel" }
      );
    }

    const boundRequest = buildHostWriteAuthorityIntegrateSliceRequest(request);
    if (!isCompleteIntegrateSliceRequestIdentity(boundRequest)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.INTEGRATION_RESULT_INVALID,
        { issue: "integrate_request_identity_incomplete" }
      );
    }

    const requestEnvelope = buildHostWriteAuthorityIntegrateSliceEnvelope(boundRequest);

    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (err) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: err?.message ?? String(err)
      });
    }

    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.INTEGRATE_SLICE
    );
    if (!validation.ok) {
      return adapterRefusal(validation.reason, validation.detail);
    }
    const response = validation.response;

    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED, {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string" ? response.refusal.reason : null,
        broker_refusal_detail: response.refusal?.detail ?? null
      });
    }

    const integration = response.integration;
    const resultCheck = validateSliceIntegratedResult(integration, boundRequest);
    if (!resultCheck.ok) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.INTEGRATION_RESULT_INVALID,
        resultCheck.detail
      );
    }

    let roundTripped;
    try {
      roundTripped = JSON.parse(JSON.stringify(integration));
    } catch (err) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.INTEGRATION_RESULT_INVALID,
        { issue: "integration_not_json_serializable", message: err?.message ?? String(err) }
      );
    }
    if (!isDeepStrictEqual(roundTripped, integration)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.INTEGRATION_RESULT_INVALID,
        { issue: "integration_lossy_over_json" }
      );
    }
    return {
      accepted: true,
      integration: deepFreezeManagedProvisioningCarrier(integration)
    };
  };
}

export function createHostWriteAuthorityWkForgeHandoffAdapter(options = {}) {
  const { channel = null } = options;

  return async function hostWriteAuthorityWkForgeHandoffAdapter(request) {
    if (typeof channel !== "function") {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_MISSING,
        { missing_backend: "host_write_authority_substrate_channel" }
      );
    }

    const boundRequest = buildHostWriteAuthorityWkForgeHandoffRequest(request);
    if (!isCompleteWkForgeHandoffRequestIdentity(boundRequest)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORGE_HANDOFF_RESULT_INVALID,
        { issue: "forge_handoff_request_identity_incomplete" }
      );
    }

    const requestEnvelope = buildHostWriteAuthorityWkForgeHandoffEnvelope(boundRequest);

    let rawResponse;
    try {
      rawResponse = await channel(requestEnvelope);
    } catch (err) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.CHANNEL_THREW, {
        message: err?.message ?? String(err)
      });
    }

    const validation = validateHostWriteAuthorityResponseEnvelope(
      rawResponse,
      HOST_WRITE_AUTHORITY_OPS.WK_FORGE_HANDOFF
    );
    if (!validation.ok) {
      return adapterRefusal(validation.reason, validation.detail);
    }
    const response = validation.response;

    if (response.kind === HOST_WRITE_AUTHORITY_RESPONSE_KINDS.REFUSAL) {
      return adapterRefusal(HOST_WRITE_AUTHORITY_REFUSAL_REASONS.BROKER_REFUSED, {
        broker_refusal_code:
          typeof response.refusal?.code === "string" ? response.refusal.code : null,
        broker_refusal_reason:
          typeof response.refusal?.reason === "string" ? response.refusal.reason : null,
        broker_refusal_detail: response.refusal?.detail ?? null
      });
    }

    if (response.kind !== HOST_WRITE_AUTHORITY_RESPONSE_KINDS.WK_FORGE_HANDOFF_COMPLETED) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        { issue: "non_forge_handoff_kind_for_wk_forge_handoff", received_kind: response.kind }
      );
    }
    const responseKeys = Object.keys(response);
    const outerExact =
      responseKeys.length === HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_COMPLETED_RESPONSE_FIELDS.length &&
      HOST_WRITE_AUTHORITY_WK_FORGE_HANDOFF_COMPLETED_RESPONSE_FIELDS.every(
        (field) => Object.prototype.hasOwnProperty.call(response, field)
      );
    if (!outerExact) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.RESPONSE_MALFORMED,
        { issue: "wk_forge_handoff_outer_envelope_not_exact", keys: [...responseKeys].sort() }
      );
    }

    const forgeHandoff = response.forge_handoff;
    const resultCheck = validateWkForgeHandoffResult(forgeHandoff, boundRequest);
    if (!resultCheck.ok) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORGE_HANDOFF_RESULT_INVALID,
        resultCheck.detail
      );
    }
    let roundTripped;
    try {
      roundTripped = JSON.parse(JSON.stringify(forgeHandoff));
    } catch (err) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORGE_HANDOFF_RESULT_INVALID,
        { issue: "forge_handoff_result_not_json_serializable", message: err?.message ?? String(err) }
      );
    }
    if (!isDeepStrictEqual(roundTripped, forgeHandoff)) {
      return adapterRefusal(
        HOST_WRITE_AUTHORITY_REFUSAL_REASONS.FORGE_HANDOFF_RESULT_INVALID,
        { issue: "forge_handoff_result_lossy_over_json" }
      );
    }
    return {
      accepted: true,
      forge_handoff: deepFreezeManagedProvisioningCarrier(forgeHandoff)
    };
  };
}
