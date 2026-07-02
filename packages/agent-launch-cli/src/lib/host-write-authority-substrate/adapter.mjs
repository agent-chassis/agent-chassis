

import {
  BACKEND_CODE_BACKEND_UNAVAILABLE,
  HOST_WRITE_AUTHORITY_OPS,
  HOST_WRITE_AUTHORITY_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_RESPONSE_KINDS,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_PROTOCOL_VERSION,
  REFUSAL_REASON_TO_BACKEND_CODE
} from "./protocol-constants.mjs";
import {
  findForbiddenTokenInLaunchInput
} from "./forbidden-token-scan.mjs";
import {
  buildHostWriteAuthorityProbeEnvelope,
  buildHostWriteAuthorityStartLaunchEnvelope,
  isWorkerGateRefusalDetail,
  validateHostWriteAuthorityResponseEnvelope
} from "./request-envelopes.mjs";

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
