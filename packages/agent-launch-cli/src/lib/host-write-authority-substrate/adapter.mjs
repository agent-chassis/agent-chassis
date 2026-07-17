

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
  buildHostWriteAuthorityProbeEnvelope,
  buildHostWriteAuthorityProvisionWorktreeEnvelope,
  buildHostWriteAuthorityStartLaunchEnvelope,
  isCompleteCommitSliceRequestIdentity,
  isCompleteIntegrateSliceRequestIdentity,
  isWorkerGateRefusalDetail,
  validateHostWriteAuthorityResponseEnvelope,
  validateSliceCommittedCommitResult,
  validateSliceIntegratedResult
} from "./request-envelopes.mjs";

import {
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION
} from "../worktree-provisioning-dispatch.mjs";

const MANAGED_PROVISIONING_CARRIER_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id", "slice_id",
  "unit_address", "retry_id", "run_authority", "wk_binding", "slice_binding",
  "worktree_path", "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
  "index_sparse", "validation_worktree_path", "shared_git_exposed"
]);

function hasExactManagedProvisioningFields(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === MANAGED_PROVISIONING_CARRIER_FIELDS.length &&
    MANAGED_PROVISIONING_CARRIER_FIELDS.every(
      (field) => Object.prototype.hasOwnProperty.call(value, field)
    );
}

function validateManagedProvisioningCarrier(carrier) {
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
      typeof carrier.run_authority !== "string" || carrier.run_authority.length === 0 ||
      carrier.worktree_path !== sliceBinding.worktree_path ||
      carrier.retry_id !== sliceBinding.retry_id ||
      carrier.unit_address !== sliceBinding.unit_address) {
    return { ok: false, detail: { issue: "carrier_internally_inconsistent" } };
  }
  if (carrier.retry_id !== 0) {
    return { ok: false, detail: { issue: "carrier_retry_id_not_initial", retry_id: carrier.retry_id } };
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
    const carrierCheck = validateManagedProvisioningCarrier(carrier);
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
