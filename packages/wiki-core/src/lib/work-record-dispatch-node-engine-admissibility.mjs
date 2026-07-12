

import {
  executeWorkerAdmissionDomainPackValidation,
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  resolveClientConfig,
  resolveWorkerAdmissionRoute
} from "./node-engine-api-client.mjs";
import {
  createSelectedUnitWorkerAdmissionDomainPackInput,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER
} from "./work-record-admission-derived-evidence.mjs";
import {
  createReviewAttestationBindingFromRemoteNeedsReview,
  preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult
} from "./review-attestation-pack-carry.mjs";
import {
  clone,
  isNonEmptyString,
  isObject
} from "./work-record-dispatch-shared.mjs";

export const NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE =
  "node_engine_admissibility_undetermined";
export const NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE =
  "node_engine_admissibility_unavailable";
export const NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE =
  "node_engine_admissibility_denied";
export const NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE =
  "node_engine_admissibility_needs_review";

export const NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE =
  "node_engine_admissibility_unratified";

export const NODE_ENGINE_NON_PACK_ADMISSIBILITY_MAP = Object.freeze({
  service_url_unconfigured: ["unavailable", "node_engine_config_unavailable"],
  api_key_unconfigured: ["unavailable", "node_engine_config_unavailable"],
  route_unratified_placeholder: ["unavailable", "node_engine_route_unratified"],
  request_contract_digest_missing: ["unavailable", "node_engine_request_contract_unbound"],
  pack_input_missing: ["unavailable", "node_engine_pack_input_missing"],
  pack_input_assembly_failed: ["unavailable", "node_engine_pack_input_assembly_failed"],
  auth_rejected: ["undetermined", "node_engine_auth_rejected"],
  entitlement_rejected: ["undetermined", "node_engine_entitlement_rejected"],
  invalid_request: ["undetermined", "node_engine_request_invalid"],
  pack_input_required: ["undetermined", "node_engine_pack_input_required"],
  pack_input_invalid: ["undetermined", "node_engine_pack_input_invalid"],
  request_schema_digest_mismatch: [
    "undetermined",
    "node_engine_request_schema_digest_mismatch"
  ],
  precondition_graph_too_large: [
    "undetermined",
    "node_engine_precondition_graph_too_large"
  ],
  non_object_data: ["undetermined", "node_engine_non_object_data"],
  non_json: ["undetermined", "node_engine_unrecognized_response"],
  problem: ["undetermined", "node_engine_unrecognized_response"],
  malformed_result: ["undetermined", "node_engine_unrecognized_response"],
  availability_failure: ["unavailable", "node_engine_unavailable"],
  timeout_abort: ["unavailable", "node_engine_unavailable"],
  transport_failure: ["unavailable", "node_engine_unavailable"]
});

export function buildNodeEngineAdmissibilityOutcome(status, admissible, diagnosticCode, extra = {}) {
  return {
    evaluated: true,
    authority: "node_engine",
    status,
    admissible: admissible === true,
    effect: isNonEmptyString(extra.effect) ? extra.effect : null,
    pack_backed: extra.pack_backed === true,
    node_engine_backed: extra.node_engine_backed === true,

    binding_status: isNonEmptyString(extra.binding_status) ? extra.binding_status : null,
    ratified: extra.ratified === true,
    diagnostic_code: diagnosticCode,
    reasons: Array.isArray(extra.reasons) ? extra.reasons : [],
    ...(isObject(extra.recovery) ? { recovery: extra.recovery } : {}),
    ...(typeof extra.authenticated_request_sent === "boolean"
      ? { authenticated_request_sent: extra.authenticated_request_sent }
      : {})
  };
}

export function packResultIsRatified(packResult) {
  if (!isObject(packResult)) {
    return false;
  }
  if (packResult.node_engine_binding_ratified === true) {
    return true;
  }
  return packResult.node_engine_binding_status === NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS;
}

const KNOWN_NODE_ENGINE_BINDING_STATUSES = new Set([
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER
]);

export function clampNodeEngineBindingStatus(value) {
  return KNOWN_NODE_ENGINE_BINDING_STATUSES.has(value) ? value : null;
}

export {
  foldNodeEngineAdmissibilityIntoReadiness,
  interpretNodeEngineAdmissibility
} from "./work-record-dispatch-node-engine-admissibility-interpret.mjs";

function createValidateDispatchAdmissionOperationId(unit) {
  const address = isNonEmptyString(unit?.address)
    ? String(unit.address).trim()
    : isNonEmptyString(unit?.record_id)
      ? String(unit.record_id).trim()
      : "unknown";
  return `workspace_validate_dispatch:${address}:node_engine_admissibility`;
}

export function createValidateDispatchNodeEngineCarrierFacts(readiness) {
  const normalizedClusterCount = Array.isArray(readiness?.clusters)
    ? readiness.clusters.length
    : null;
  const clusterCount = normalizedClusterCount === 0 && readiness?.dispatchable === true
    ? 1
    : normalizedClusterCount;
  if (!Number.isInteger(clusterCount) || clusterCount < 0) {
    return null;
  }

  const localBlastRadius = isNonEmptyString(readiness?.blast_radius?.level)
    ? String(readiness.blast_radius.level).trim().toLowerCase()
    : null;
  const blastRadiusSeverity = {
    low: "none",
    medium: "elevated",
    elevated: "elevated",
    critical: "critical"
  }[localBlastRadius] ?? null;

  return {
    cluster_count: clusterCount,
    ...(blastRadiusSeverity ? { blast_radius_severity: blastRadiusSeverity } : {})
  };
}

export function projectValidateDispatchPackInputCarrier(packInput, readiness) {
  if (!isObject(packInput)) {
    return packInput;
  }
  const carrierFacts = createValidateDispatchNodeEngineCarrierFacts(readiness);
  if (!carrierFacts) {
    return packInput;
  }
  const normalizedFacts = isObject(packInput.normalized_portfolio_facts)
    ? packInput.normalized_portfolio_facts
    : {};

  const existingMetrics = isObject(normalizedFacts.work_unit_metrics)
    ? normalizedFacts.work_unit_metrics
    : {};
  return {
    ...packInput,
    normalized_portfolio_facts: {
      ...normalizedFacts,
      schema_version: isNonEmptyString(normalizedFacts.schema_version)
        ? String(normalizedFacts.schema_version).trim()
        : "worker-admission-request.v1",
      decision_kind: isNonEmptyString(normalizedFacts.decision_kind)
        ? String(normalizedFacts.decision_kind).trim()
        : "work_unit_atomicity",
      subject: clone(normalizedFacts.subject ?? null),
      claim: null,
      ...(isNonEmptyString(packInput.source_record_digest)
        ? { source_digest: String(packInput.source_record_digest).trim() }
        : {}),
      work_unit_metrics: { ...existingMetrics, ...carrierFacts }
    }
  };
}

export async function resolveNodeEngineAdmissibility({ request, record, selectedUnit, unit, dir, readiness }) {
  const bundle = isObject(request) ? request : {};
  try {
    if (typeof bundle.resolver === "function") {
      return await bundle.resolver({ record, selectedUnit, unit, dir });
    }
    const config = isObject(bundle.config)
      ? bundle.config
      : resolveClientConfig(bundle.env ?? process.env);

    const createPackInput = async (review_attestation_binding = null) =>
      typeof bundle.packInputAssembler === "function"
        ? bundle.packInputAssembler({
            dir,
            record,
            selectedUnit,
            unit,
            review_attestation_binding,
            now: bundle.now ?? null
          })
        : createSelectedUnitWorkerAdmissionDomainPackInput({
            dir,
            record,
            unit,
            review_attestation_binding,
            now: bundle.now ?? null
          });
    let packInput = null;
    try {
      packInput = await createPackInput();
    } catch {
      return {
        outcome: "pack_input_assembly_failed",
        authenticated_request_sent: false
      };
    }
    if (!isObject(packInput)) {
      return {
        outcome: "pack_input_missing",
        authenticated_request_sent: false
      };
    }
    packInput = projectValidateDispatchPackInputCarrier(packInput, readiness);

    const routeInfo = resolveWorkerAdmissionRoute({ config, route: bundle.route ?? null });
    const firstResult = await executeWorkerAdmissionDomainPackValidation(
      {
        config,
        packInput,
        route: routeInfo.value,
        requestContractDigest: bundle.requestContractDigest ?? null
      },
      bundle.fetchImpl
    );
    const reviewAttestationBinding = createReviewAttestationBindingFromRemoteNeedsReview(
      firstResult,
      {
        admitting_run_id:
          bundle.admitting_run_id ??
          bundle.admittingRunId ??
          createValidateDispatchAdmissionOperationId(unit)
      }
    );
    if (!reviewAttestationBinding) {
      return firstResult;
    }

    let secondPackInput = null;
    try {
      secondPackInput = await createPackInput(reviewAttestationBinding);
    } catch {
      return firstResult;
    }
    if (
      !isObject(secondPackInput) ||
      !Array.isArray(secondPackInput.review_attestations) ||
      secondPackInput.review_attestations.length === 0
    ) {
      return firstResult;
    }
    secondPackInput = projectValidateDispatchPackInputCarrier(secondPackInput, readiness);

    const secondResult = await executeWorkerAdmissionDomainPackValidation(
      {
        config,
        packInput: secondPackInput,
        route: routeInfo.value,
        requestContractDigest: bundle.requestContractDigest ?? null
      },
      bundle.fetchImpl
    );
    return preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult(secondResult, {
      firstResult,
      review_attestation_binding: reviewAttestationBinding
    });
  } catch {
    return null;
  }
}
