

export const REMOTE_WORKER_ADMISSION_GATE_SCHEMA_VERSION =
  "work-record-wrapper-gate-remote-admission.v1";

export const REMOTE_WORKER_ADMISSION_PACK_EFFECTS = Object.freeze([
  "admit",
  "needs_review",
  "reject"
]);

export const NODE_ENGINE_UNRATIFIED_PLACEHOLDER_MARKER =
  "node_engine_unratified_placeholder";

export const NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER =
  "node_engine_worker_admission_authority_bound.v1";

export const REMOTE_WORKER_ADMISSION_LOCAL_ONLY_FAIL_OPEN_DISPOSITION =
  "local_only_fail_open";

export const REMOTE_WORKER_ADMISSION_GATE_CODES = Object.freeze([

  "remote_enforcement_absent",

  "remote_enforcement_local_only",

  "local_refusal_preserved",

  "remote_admit",

  "remote_admit_unratified",

  "remote_needs_review",

  "remote_reject",

  "remote_enforcement_unavailable"
]);

export const DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY = Object.freeze({
  placeholderBindingStatus: NODE_ENGINE_UNRATIFIED_PLACEHOLDER_MARKER,

  ratifiedBindingStatus: NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER,
  localOnlyFailOpenDisposition: REMOTE_WORKER_ADMISSION_LOCAL_ONLY_FAIL_OPEN_DISPOSITION,
  recognizedEffects: REMOTE_WORKER_ADMISSION_PACK_EFFECTS
});

function resolvePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY;
  }
  const placeholderBindingStatus =
    typeof policy.placeholderBindingStatus === "string" && policy.placeholderBindingStatus.length > 0
      ? policy.placeholderBindingStatus
      : DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY.placeholderBindingStatus;
  const ratifiedBindingStatus =
    typeof policy.ratifiedBindingStatus === "string" && policy.ratifiedBindingStatus.length > 0
      ? policy.ratifiedBindingStatus
      : DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY.ratifiedBindingStatus;
  const localOnlyFailOpenDisposition =
    typeof policy.localOnlyFailOpenDisposition === "string" && policy.localOnlyFailOpenDisposition.length > 0
      ? policy.localOnlyFailOpenDisposition
      : DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY.localOnlyFailOpenDisposition;
  const recognizedEffects = Array.isArray(policy.recognizedEffects) && policy.recognizedEffects.length > 0
    ? policy.recognizedEffects.filter((e) => typeof e === "string" && e.length > 0)
    : DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY.recognizedEffects;
  return Object.freeze({
    placeholderBindingStatus,
    ratifiedBindingStatus,
    localOnlyFailOpenDisposition,
    recognizedEffects:
      recognizedEffects.length > 0
        ? recognizedEffects
        : DEFAULT_REMOTE_WORKER_ADMISSION_GATE_POLICY.recognizedEffects
  });
}

export function normalizeSuppliedRemoteWorkerAdmissionPackResult(remoteResult, policy) {
  if (!remoteResult || typeof remoteResult !== "object" || Array.isArray(remoteResult)) {
    return null;
  }
  const resolved = resolvePolicy(policy);
  const disposition =
    typeof remoteResult.disposition === "string" ? remoteResult.disposition : null;
  const engaged = disposition !== resolved.localOnlyFailOpenDisposition;
  const effect = resolved.recognizedEffects.includes(remoteResult.effect)
    ? remoteResult.effect
    : null;
  const bindingStatus =
    typeof remoteResult.node_engine_binding_status === "string"
      ? remoteResult.node_engine_binding_status
      : null;
  return Object.freeze({
    engaged,
    disposition,
    effect,
    pack_backed: remoteResult.pack_backed === true,
    node_engine_backed_success: remoteResult.node_engine_backed_success === true,
    binding_status: bindingStatus,

    ratified:
      remoteResult.node_engine_binding_ratified === true ||
      (bindingStatus !== null && bindingStatus === resolved.ratifiedBindingStatus),
    outcome: typeof remoteResult.outcome === "string" ? remoteResult.outcome : null,
    reason_code: typeof remoteResult.reason_code === "string" ? remoteResult.reason_code : null
  });
}

function remoteDetail(unitAddress, normalized) {
  return {
    unit_address: typeof unitAddress === "string" ? unitAddress : null,
    remote_effect: normalized ? normalized.effect : null,
    remote_disposition: normalized ? normalized.disposition : null,
    remote_outcome: normalized ? normalized.outcome : null,
    remote_reason_code: normalized ? normalized.reason_code : null,
    node_engine_binding_status: normalized ? normalized.binding_status : null,
    node_engine_backed_success: normalized ? normalized.node_engine_backed_success : false,
    pack_backed: normalized ? normalized.pack_backed : false,
    ratified: normalized ? normalized.ratified : false
  };
}

export function evaluateRemoteWorkerAdmissionWrapperGate({
  localAllowed,
  remote,
  unitAddress = null,
  policy
} = {}) {
  const resolved = resolvePolicy(policy);
  const normalized = normalizeSuppliedRemoteWorkerAdmissionPackResult(remote, resolved);
  const engaged = normalized !== null && normalized.engaged;
  const detail = remoteDetail(unitAddress, normalized);

  const result = (allowed, code) =>
    Object.freeze({
      schema_version: REMOTE_WORKER_ADMISSION_GATE_SCHEMA_VERSION,
      allowed,
      engaged,
      remote_gate_code: code,
      detail
    });

  if (localAllowed !== true) {
    return result(false, "local_refusal_preserved");
  }

  if (!normalized) {
    return result(false, "remote_enforcement_absent");
  }

  if (!normalized.engaged) {
    return result(true, "remote_enforcement_local_only");
  }

  if (normalized.effect === "admit") {
    if (normalized.pack_backed && normalized.node_engine_backed_success && normalized.ratified) {
      return result(true, "remote_admit");
    }

    return result(false, "remote_admit_unratified");
  }
  if (normalized.effect === "needs_review") {
    return result(false, "remote_needs_review");
  }
  if (normalized.effect === "reject") {
    return result(false, "remote_reject");
  }

  return result(false, "remote_enforcement_unavailable");
}
