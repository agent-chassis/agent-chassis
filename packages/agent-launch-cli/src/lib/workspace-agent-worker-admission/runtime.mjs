import {
  parseWorkRecordUnitAddress
} from "@agent-chassis/agent-launch-core";
import { randomBytes } from "node:crypto";
import {
  computeWorkRecordSourceDigest,
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
import {
  assertFrozenWorkerScopeAuthority
} from "../workspace-agent-launch-core.mjs";

export const ensureNewWorkerWriteRoots = helperEnsureNewWorkerWriteRoots;

const ADMISSION_RUN_ID_PREFIX = "wkadm_";

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function defaultAdmissionRunIdFactory() {
  return `${ADMISSION_RUN_ID_PREFIX}${randomBytes(8).toString("hex")}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDeepFrozenCanonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeepFrozenCanonicalValue(child, seen));
}

function normalizeCarrierScope(value, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return null;
  }
  return [...new Set(value)].sort();
}

function sameStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

function managedAdmissionCarrierRefusal(reason, detail = null) {
  return {
    ok: false,
    decision: {
      allowed: false,
      reason: "worker_scope_authority_invalid",
      detail: {
        reason,
        ...(detail ?? {})
      }
    }
  };
}

function resolveManagedAdmissionCarrier({
  subject,
  unit,
  canonicalWorkRecord,
  canonicalSelectedUnit,
  sourceRecordDigest,
  workerScopeAuthority
}) {
  const carrierValues = [
    canonicalWorkRecord,
    canonicalSelectedUnit,
    sourceRecordDigest,
    workerScopeAuthority
  ];
  const managed = carrierValues.some((value) => value !== null && value !== undefined);
  if (!managed) return { ok: true, managed: false, record: null };
  if (carrierValues.some((value) => value === null || value === undefined)) {
    return managedAdmissionCarrierRefusal("managed_admission_carrier_partial");
  }
  if (!isPlainObject(canonicalWorkRecord) || !isDeepFrozenCanonicalValue(canonicalWorkRecord)) {
    return managedAdmissionCarrierRefusal("canonical_work_record_mutable_or_malformed");
  }
  if (!isPlainObject(canonicalSelectedUnit) || !isDeepFrozenCanonicalValue(canonicalSelectedUnit)) {
    return managedAdmissionCarrierRefusal("canonical_selected_unit_mutable_or_malformed");
  }
  try {
    assertFrozenWorkerScopeAuthority(workerScopeAuthority, {
      role: "worker",
      subject,
      required: true
    });
  } catch (error) {
    return managedAdmissionCarrierRefusal("worker_scope_authority_mutable_or_malformed", {
      message: error?.message ?? String(error)
    });
  }
  const selectedFromRecord = Array.isArray(canonicalWorkRecord.slices)
    ? canonicalWorkRecord.slices.find((candidate) => candidate?.id === unit.slice_id)
    : null;
  if (selectedFromRecord !== canonicalSelectedUnit) {
    return managedAdmissionCarrierRefusal("canonical_selected_unit_substituted");
  }
  const selectedIdentityMatches =
    canonicalWorkRecord.id === unit.record_id &&
    canonicalSelectedUnit.id === unit.slice_id &&
    canonicalSelectedUnit.work_kind === "implementation" &&
    workerScopeAuthority.selected_unit.address === unit.address &&
    workerScopeAuthority.selected_unit.record_id === unit.record_id &&
    workerScopeAuthority.selected_unit.slice_id === unit.slice_id &&
    workerScopeAuthority.selected_unit.repo === (canonicalWorkRecord.repo ?? null) &&
    workerScopeAuthority.source_version === (canonicalWorkRecord.schema_version ?? null);
  if (!selectedIdentityMatches) {
    return managedAdmissionCarrierRefusal("canonical_selected_unit_identity_mismatch");
  }
  const computedDigest = computeWorkRecordSourceDigest(canonicalWorkRecord);
  if (typeof sourceRecordDigest !== "string" || sourceRecordDigest !== computedDigest ||
      workerScopeAuthority.source_digest !== sourceRecordDigest) {
    return managedAdmissionCarrierRefusal("canonical_source_digest_mismatch", {
      expected_source_digest: workerScopeAuthority.source_digest ?? null,
      actual_source_digest: computedDigest
    });
  }
  const expectedReadScope = normalizeCarrierScope(canonicalSelectedUnit.read_scope);
  const expectedRepoPaths = normalizeCarrierScope(canonicalSelectedUnit.repo_paths);
  const expectedWriteScope = normalizeCarrierScope(canonicalSelectedUnit.write_scope, { required: true });
  if (expectedReadScope === null || expectedRepoPaths === null || expectedWriteScope === null ||
      !sameStringArray(workerScopeAuthority.read_scope, expectedReadScope) ||
      !sameStringArray(workerScopeAuthority.repo_paths, expectedRepoPaths) ||
      !sameStringArray(workerScopeAuthority.write_scope, expectedWriteScope)) {
    return managedAdmissionCarrierRefusal("canonical_selected_unit_scope_mismatch");
  }
  return {
    ok: true,
    managed: true,
    record: canonicalWorkRecord,
    sourceRecordDigest
  };
}

async function validateCurrentManagedAdmissionSource({ repo, recordId, expectedDigest }) {
  const loaded = await loadWorkRecordById({ dir: repo, id: recordId });
  const actualDigest = loaded.record === null
    ? null
    : computeWorkRecordSourceDigest(loaded.record);
  if (!loaded.valid || loaded.record === null || actualDigest !== expectedDigest) {
    return managedAdmissionCarrierRefusal("canonical_source_digest_changed", {
      expected_source_digest: expectedDigest,
      actual_source_digest: actualDigest
    });
  }
  return { ok: true, loaded };
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

export async function evaluateWorkerAdmissionForBackend({
  workspaceDir,
  subject,
  env = process.env,
  canonical_work_record = null,
  canonical_selected_unit = null,
  source_record_digest = null,
  worker_scope_authority = null
}) {
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
  const managedCarrier = resolveManagedAdmissionCarrier({
    subject,
    unit: unit.value,
    canonicalWorkRecord: canonical_work_record,
    canonicalSelectedUnit: canonical_selected_unit,
    sourceRecordDigest: source_record_digest,
    workerScopeAuthority: worker_scope_authority
  });
  if (!managedCarrier.ok) return managedCarrier.decision;
  let currentManagedSource = null;
  if (managedCarrier.managed) {
    currentManagedSource = await validateCurrentManagedAdmissionSource({
      repo,
      recordId,
      expectedDigest: managedCarrier.sourceRecordDigest
    });
    if (!currentManagedSource.ok) return currentManagedSource.decision;
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

  if (managedCarrier.managed) {
    currentManagedSource = await validateCurrentManagedAdmissionSource({
      repo,
      recordId,
      expectedDigest: managedCarrier.sourceRecordDigest
    });
    if (!currentManagedSource.ok) return currentManagedSource.decision;
  }

  const loaded = managedCarrier.managed
    ? { record: managedCarrier.record }
    : await loadWorkRecordById({ dir: repo, id: recordId });
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
