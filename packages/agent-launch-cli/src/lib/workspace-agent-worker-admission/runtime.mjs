import {
  parseWorkRecordUnitAddress
} from "@agent-chassis/agent-launch-core";
import { randomBytes } from "node:crypto";
import {
  loadWorkRecordById,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import {
  IDENTITY_REFUSAL_CODES,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";

import {
  createSelectedUnitWorkerAdmissionDomainPackInput
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import {
  createReviewAttestationBindingFromRemoteNeedsReview,
  preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult
} from "@agent-chassis/wiki-core/src/lib/review-attestation-pack-carry.mjs";

import {
  executeWorkerAdmissionDomainPackValidation,
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  PACK_CLIENT_DISPOSITIONS,
  resolveClientConfig,
  resolveRequestContractDigest,
  resolveWorkerAdmissionAuthorityBinding,
  resolveWorkerAdmissionRoute,
  WORKER_ADMISSION_PACK_EFFECTS
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

import {
  projectValidateDispatchPackInputCarrier
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch-node-engine-admissibility.mjs";

import {
  ensureNewWorkerWriteRoots as helperEnsureNewWorkerWriteRoots
} from "../codex-worker-write-scope-plan.mjs";

import {
  buildNeedsReviewRecoveryDetail,
  buildRejectRecoveryDetail,
  buildRouteProblemRecoveryDetail,
  buildRemoteGateRefusalRecoveryDetail
} from "../workspace-agent-worker-admission-recovery.mjs";
import {
  findRepoRoot
} from "../../commands/codex-role.mjs";

export const ensureNewWorkerWriteRoots = helperEnsureNewWorkerWriteRoots;

const ADMISSION_RUN_ID_PREFIX = "wkadm_";

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function defaultAdmissionRunIdFactory() {
  return `${ADMISSION_RUN_ID_PREFIX}${randomBytes(8).toString("hex")}`;
}

export function refuseCallerSuppliedWorkerIdentity(request) {
  const refusal = refuseCallerSuppliedIdentityFields(request);
  if (refusal === null) {
    return null;
  }
  return Object.freeze({
    ...refusal,
    refusal_code: refusal.refusal_code ?? IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE
  });
}

export function normalizeRemoteWorkerAdmissionPackResultForDecision(remoteResult) {
  if (!remoteResult || typeof remoteResult !== "object" || Array.isArray(remoteResult)) {
    return null;
  }
  const disposition = typeof remoteResult.disposition === "string" ? remoteResult.disposition : null;
  const engaged = disposition !== PACK_CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN;
  const effect = WORKER_ADMISSION_PACK_EFFECTS.includes(remoteResult.effect)
    ? remoteResult.effect
    : null;
  const bindingStatus = typeof remoteResult.node_engine_binding_status === "string"
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
      bindingStatus === NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
    outcome: typeof remoteResult.outcome === "string" ? remoteResult.outcome : null,
    reason_code: typeof remoteResult.reason_code === "string" ? remoteResult.reason_code : null
  });
}

export function buildRedactedRemoteAdmissionDiagnostic(remoteResult) {
  if (!remoteResult || typeof remoteResult !== "object" || Array.isArray(remoteResult)) {
    return null;
  }
  const disposition = typeof remoteResult.disposition === "string" ? remoteResult.disposition : null;
  return Object.freeze({
    engaged: disposition !== null && disposition !== PACK_CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
    disposition,
    outcome: typeof remoteResult.outcome === "string" ? remoteResult.outcome : null,
    reason_code: typeof remoteResult.reason_code === "string" ? remoteResult.reason_code : null,
    effect: WORKER_ADMISSION_PACK_EFFECTS.includes(remoteResult.effect) ? remoteResult.effect : null,
    pack_backed: remoteResult.pack_backed === true,
    node_engine_backed_success: remoteResult.node_engine_backed_success === true,
    node_engine_binding_status: typeof remoteResult.node_engine_binding_status === "string"
      ? remoteResult.node_engine_binding_status
      : null,
    request_contract_digest_source: typeof remoteResult.request_contract_digest_source === "string"
      ? remoteResult.request_contract_digest_source
      : null,
    request_contract_digest_present: remoteResult.request_contract_digest_present === true,
    worker_admission_route_source: typeof remoteResult.worker_admission_route_source === "string"
      ? remoteResult.worker_admission_route_source
      : null,
    worker_admission_route_present: remoteResult.worker_admission_route_present === true,
    service_url_source: typeof remoteResult.service_url_source === "string"
      ? remoteResult.service_url_source
      : null,
    key_source: typeof remoteResult.key_source === "string" ? remoteResult.key_source : null
  });
}

export const NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION =
  "node-engine-admission-runtime-diagnostic.v1";

export function buildNodeEngineAdmissionRuntimeDiagnostic(env = process.env) {
  const config = resolveClientConfig(env ?? {});
  const sources = config?.sources ?? {};

  const authorityBinding = resolveWorkerAdmissionAuthorityBinding({ config });
  return Object.freeze({
    schema_version: NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION,
    node_engine_config: Object.freeze({
      service_url_source: typeof sources.service_url_source === "string"
        ? sources.service_url_source
        : null,
      service_url_present: Boolean(config?.serviceUrl),
      key_source: typeof sources.key_source === "string" ? sources.key_source : null,
      key_present: Boolean(config?.apiKey),
      worker_admission_route_source: typeof sources.worker_admission_route_source === "string"
        ? sources.worker_admission_route_source
        : null,
      worker_admission_route_present: sources.worker_admission_route_present === true,
      request_contract_digest_source: typeof sources.request_contract_digest_source === "string"
        ? sources.request_contract_digest_source
        : null,
      request_contract_digest_present: Boolean(config?.requestContractDigest),
      worker_admission_authority_binding_source:
        typeof authorityBinding.source === "string" ? authorityBinding.source : null,
      worker_admission_authority_binding_present: authorityBinding.present === true
    }),
    worker_admission_remote_observability: Object.freeze({

      backend_result_carries_remote_admission:
        typeof buildRedactedRemoteAdmissionDiagnostic === "function" &&
        typeof evaluateWorkerAdmissionForBackend === "function",

      dispatch_accept_envelope_supports_worker_admission:
        typeof buildRedactedRemoteAdmissionDiagnostic === "function"
    })
  });
}

export function evaluateWorkerAdmissionDecision({ unit, remote }) {
  const remoteResult = normalizeRemoteWorkerAdmissionPackResultForDecision(remote);
  const recordId = unit?.record_id ?? null;
  const detail = {
    record_id: recordId,
    remote_effect: remoteResult ? remoteResult.effect : null,
    remote_disposition: remoteResult ? remoteResult.disposition : null,
    remote_outcome: remoteResult ? remoteResult.outcome : null,
    remote_reason_code: remoteResult ? remoteResult.reason_code : null,
    node_engine_binding_status: remoteResult ? remoteResult.binding_status : null,
    node_engine_backed_success: remoteResult ? remoteResult.node_engine_backed_success : false
  };

  if (!remoteResult) {
    return {
      allowed: false,
      reason: "worker_admission_node_engine_unavailable",
      detail: {
        ...detail,
        remote_worker_admission_recovery: buildRemoteGateRefusalRecoveryDetail({
          unit,
          remoteGateCode: "remote_enforcement_absent"
        })
      }
    };
  }

  if (!remoteResult.engaged) {
    return {
      allowed: true,
      reason: "worker_admission_remote_enforcement_local_only",
      detail: {
        ...detail,
        enforced: false
      }
    };
  }

  if (
    remoteResult.effect === "admit" &&
    remoteResult.pack_backed &&
    remoteResult.node_engine_backed_success &&
    remoteResult.ratified
  ) {
    return { allowed: true, reason: "worker_admission_remote_admit", detail };
  }

  if (remoteResult.effect === "admit") {
    return {
      allowed: false,
      reason: "worker_admission_remote_admit_unratified",
      detail: {
        ...detail,
        remote_worker_admission_recovery: buildRemoteGateRefusalRecoveryDetail({
          unit,
          remoteGateCode: "remote_admit_unratified"
        })
      }
    };
  }
  if (remoteResult.effect === "needs_review") {

    return {
      allowed: false,
      reason: "worker_admission_remote_needs_review",
      detail: {
        ...detail,
        remote_needs_review_recovery: buildNeedsReviewRecoveryDetail({ unit, remote })
      }
    };
  }
  if (remoteResult.effect === "reject") {

    return {
      allowed: false,
      reason: "worker_admission_remote_reject",
      detail: {
        ...detail,
        remote_reject_recovery: buildRejectRecoveryDetail({ unit, remote })
      }
    };
  }

  const routeProblemRecovery = buildRouteProblemRecoveryDetail({ unit, remote });

  return {
    allowed: false,
    reason: "worker_admission_remote_enforcement_unavailable",
    detail: {
      ...detail,
      remote_worker_admission_recovery:
        routeProblemRecovery ??
        buildRemoteGateRefusalRecoveryDetail({
          unit,
          remoteGateCode: "remote_enforcement_unavailable"
        })
    }
  };
}

export async function evaluateWorkerAdmissionForBackend({ workspaceDir, subject, env = process.env }) {
  if (!subject || typeof subject !== "string") {
    return { allowed: false, reason: "invalid_subject", detail: { subject: subject ?? null } };
  }
  const unit = parseWorkRecordUnitAddress(subject);
  if (!unit.ok) {
    return { allowed: false, reason: "invalid_subject_address", detail: { subject } };
  }
  const unitAddress = unit.value.address;
  const recordId = unit.value.record_id;
  let repo;
  try {
    repo = await findRepoRoot(workspaceDir ?? ".");
  } catch {
    return {
      allowed: false,
      reason: "workspace_repo_not_found",
      detail: { workspace_dir: workspaceDir ?? null }
    };
  }
  const now = new Date().toISOString();
  const readiness = await validateWorkRecordDispatch({ dir: repo, unitAddress, now });
  if (!readiness.dispatchable) {
    return {
      allowed: false,
      reason: "readiness_not_dispatchable",
      detail: { decision_code: readiness.decision_code, unit_address: unitAddress }
    };
  }

  const loaded = await loadWorkRecordById({ dir: repo, id: recordId });
  if (!loaded.record) {
    return { allowed: false, reason: "worker_admission_record_not_found", detail: { record_id: recordId } };
  }

  const remoteResult = await resolveRemoteWorkerAdmissionPackResultForUnit({
    dir: repo,
    record: loaded.record,
    unit: unit.value,
    env,

    readiness,
    admittingRunId: defaultAdmissionRunIdFactory()
  });
  const decision = evaluateWorkerAdmissionDecision({ unit: unit.value, remote: remoteResult });

  const remoteDiagnostic = buildRedactedRemoteAdmissionDiagnostic(remoteResult);
  return remoteDiagnostic
    ? { ...decision, remote_admission: remoteDiagnostic }
    : decision;
}

export async function resolveRemoteWorkerAdmissionPackResultForUnit({
  dir,
  record,
  unit,
  env,

  readiness = null,
  admittingRunId = null
}) {
  const config = resolveClientConfig(env ?? {});
  const workerAdmissionRoute = resolveWorkerAdmissionRoute({ config });
  const admissionRunId = normalizeNonEmptyString(admittingRunId) ?? defaultAdmissionRunIdFactory();

  let packInput = null;

  let resolvedReadiness = null;
  const canSendPackRequest =
    Boolean(config.serviceUrl) &&
    Boolean(config.apiKey) &&
    workerAdmissionRoute.present &&
    resolveRequestContractDigest({ config }).present;
  if (canSendPackRequest) {
    try {
      packInput = await createSelectedUnitWorkerAdmissionDomainPackInput({ dir, record, unit });
    } catch {
      packInput = null;
    }

    if (packInput && typeof packInput === "object" && !Array.isArray(packInput)) {
      if (readiness && typeof readiness === "object" && !Array.isArray(readiness)) {
        resolvedReadiness = readiness;
      } else {

        try {
          resolvedReadiness = await validateWorkRecordDispatch({
            dir,
            unitAddress: unit?.address ?? null,
            now: new Date().toISOString()
          });
        } catch {
          resolvedReadiness = null;
        }
      }
      packInput = projectValidateDispatchPackInputCarrier(packInput, resolvedReadiness);
    }
  }

  const firstResult = await executeWorkerAdmissionDomainPackValidation({
    config,
    packInput,
    route: workerAdmissionRoute.value
  });
  const reviewAttestationBinding = createReviewAttestationBindingFromRemoteNeedsReview(firstResult, {
    admitting_run_id: admissionRunId
  });
  let result = firstResult;
  if (canSendPackRequest && reviewAttestationBinding) {
    let secondPackInput = null;
    try {
      secondPackInput = await createSelectedUnitWorkerAdmissionDomainPackInput({
        dir,
        record,
        unit,
        review_attestation_binding: reviewAttestationBinding
      });
    } catch {
      secondPackInput = null;
    }
    if (Array.isArray(secondPackInput?.review_attestations) && secondPackInput.review_attestations.length > 0) {

      secondPackInput = projectValidateDispatchPackInputCarrier(secondPackInput, resolvedReadiness);
      const secondResult = await executeWorkerAdmissionDomainPackValidation({
        config,
        packInput: secondPackInput,
        route: workerAdmissionRoute.value
      });
      result = preserveFirstPassReviewThresholdReasonsForOpaqueRetryResult(secondResult, {
        firstResult,
        review_attestation_binding: reviewAttestationBinding
      });
    }
  }

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...result,
      worker_admission_route_source: workerAdmissionRoute.source ?? null,
      worker_admission_route_present: workerAdmissionRoute.present === true
    };
  }
  return result;
}

export function buildCanonicalSummary(record, readiness, unit) {
  const selectedSlice = unit.slice_id
    ? Array.isArray(record.slices)
      ? record.slices.find((slice) => slice && slice.id === unit.slice_id) || null
      : null
    : null;
  const selectedUnit = selectedSlice
    ? {
        id: selectedSlice.id,
        title: selectedSlice.title,
        work_kind: selectedSlice.work_kind,
        status: selectedSlice.status,
        docs: Array.isArray(selectedSlice.docs) ? selectedSlice.docs : [],
        repo_paths: Array.isArray(selectedSlice.repo_paths) ? selectedSlice.repo_paths : [],
        write_scope: Array.isArray(selectedSlice.write_scope) ? selectedSlice.write_scope : [],
        acceptance: selectedSlice.acceptance || null,
        dispatch_intent: selectedSlice.dispatch_intent || null
      }
    : null;

  return {
    record_id: record.id,
    repo: record.repo,
    title: record.title,
    docs: selectedUnit && selectedUnit.docs.length > 0
      ? selectedUnit.docs
      : Array.isArray(record.docs)
        ? record.docs
        : [],
    repo_paths: selectedUnit && selectedUnit.repo_paths.length > 0
      ? selectedUnit.repo_paths
      : Array.isArray(record.repo_paths)
        ? record.repo_paths
        : [],
    write_scope: selectedUnit ? selectedUnit.write_scope : (Array.isArray(record.write_scope) ? record.write_scope : []),
    acceptance_criteria: selectedUnit
      ? Array.isArray(selectedUnit.acceptance?.criteria)
        ? selectedUnit.acceptance.criteria
        : []
      : Array.isArray(record.acceptance?.criteria)
        ? record.acceptance.criteria
        : [],
    validation_commands: selectedUnit
      ? Array.isArray(selectedUnit.acceptance?.validation)
        ? selectedUnit.acceptance.validation
        : []
      : Array.isArray(record.acceptance?.validation)
        ? record.acceptance.validation
        : [],
    dispatch_intent: selectedUnit ? selectedUnit.dispatch_intent : record.dispatch_intent || null,
    selected_unit: selectedUnit,
    accepted_escalations: Array.isArray(readiness.accepted_escalations) ? readiness.accepted_escalations : [],
    canonical_refs: Array.isArray(readiness.canonical_refs) ? readiness.canonical_refs : [],
    derived_evidence: Array.isArray(readiness.derived_evidence) ? readiness.derived_evidence : [],
    state: readiness.state || null
  };
}
