import {
  parseWorkRecordUnitAddress,
  WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core";
import {
  createWorkUnitFeatureVectorFromCanonicalRecord,
  WorkRecordFeatureVectorSourceError
} from "@agent-chassis/wiki-core/src/lib/work-record-feature-vector.mjs";
import {
  bootstrapNodeEngineEnvFromFile,
  resolveNodeEngineEnvFilePath
} from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";
import {
  evaluateWorkerAdmissionDecision,
  normalizeRemoteWorkerAdmissionPackResultForDecision,
  resolveRemoteWorkerAdmissionPackResultForUnit
} from "./workspace-agent-worker-admission.mjs";
import {
  buildRemoteGateRefusalRecoveryDetail
} from "./workspace-agent-worker-admission-recovery.mjs";

export async function resolveRemoteWorkerAdmissionProvenance({
  dir,
  record,
  unit,
  env
}) {

  const admissionEnv = { ...(env && typeof env === "object" ? env : {}) };
  bootstrapNodeEngineEnvFromFile({
    env: admissionEnv,
    envFilePath: resolveNodeEngineEnvFilePath(typeof dir === "string" ? dir : "")
  });
  const remoteResult = await resolveRemoteWorkerAdmissionPackResultForUnit({
    dir,
    record,
    unit,
    env: admissionEnv
  });
  const descriptor = normalizeRemoteWorkerAdmissionPackResultForDecision(remoteResult);
  if (!descriptor) {

    return null;
  }

  if (!descriptor.engaged) {
    const decision = unit
      ? evaluateWorkerAdmissionDecision({ unit, remote: remoteResult })
      : null;
    return Object.freeze({
      schema_version: "worker-admission-remote-pack-result-provenance.v1",
      authority: "launcher_rederived_config_readiness",
      enforced: false,
      engaged: false,
      effect: descriptor.effect,
      disposition: descriptor.disposition,
      pack_backed: descriptor.pack_backed,
      node_engine_backed_success: descriptor.node_engine_backed_success,
      node_engine_binding_status: descriptor.binding_status,
      ratified: descriptor.ratified,
      outcome: descriptor.outcome,
      reason_code: descriptor.reason_code,
      decision: decision
        ? Object.freeze({ allowed: decision.allowed === true, reason: decision.reason ?? null })
        : null
    });
  }

  const decision = unit
    ? evaluateWorkerAdmissionDecision({ unit, remote: remoteResult })
    : null;
  return Object.freeze({
    schema_version: "worker-admission-remote-pack-result-provenance.v1",
    authority: "node_engine_remote_reference",

    enforced: true,
    engaged: true,
    effect: descriptor.effect,
    disposition: descriptor.disposition,
    pack_backed: descriptor.pack_backed,
    node_engine_backed_success: descriptor.node_engine_backed_success,
    node_engine_binding_status: descriptor.binding_status,
    ratified: descriptor.ratified,
    outcome: descriptor.outcome,
    reason_code: descriptor.reason_code,
    decision: decision
      ? Object.freeze({ allowed: decision.allowed === true, reason: decision.reason ?? null })
      : null
  });
}

export function attachWorkerAdmissionRemediation(refusal) {

  const remediation = refusal && typeof refusal.worker_admission_remediation === "object"
    && refusal.worker_admission_remediation !== null
    && !Array.isArray(refusal.worker_admission_remediation)
    ? refusal.worker_admission_remediation
    : refusal?.worker_admission?.remediation;
  if (!remediation || typeof remediation !== "object" || Array.isArray(remediation)) {

    return attachRemoteGateRefusalRecovery(refusal);
  }

  const summary = typeof remediation.summary === "string" && remediation.summary.trim() !== ""
    ? remediation.summary.trim()
    : null;
  const nextSteps = [];
  for (const item of Array.isArray(remediation.items) ? remediation.items : []) {
    const label = remediationStepLabel(item?.next_step);
    if (label) {
      nextSteps.push(label);
    }
  }
  if (!summary && nextSteps.length === 0) {
    return refusal;
  }

  const diagnostics = Array.isArray(refusal.diagnostics) ? [...refusal.diagnostics] : [];
  diagnostics.push({
    code: "worker_admission.remediation.v1",
    message: `worker-admission remediation: ${summary ?? "next steps available"}${nextSteps.length > 0 ? ` Next steps: ${nextSteps.join("; ")}` : ""}`,
    path: "worker_admission.remediation"
  });
  return {
    ...refusal,
    diagnostics,
    worker_admission_remediation: remediation
  };
}

function attachRemoteGateRefusalRecovery(refusal) {
  const remoteWorkerAdmission = refusal && typeof refusal.remote_worker_admission === "object"
    && refusal.remote_worker_admission !== null
    && !Array.isArray(refusal.remote_worker_admission)
    ? refusal.remote_worker_admission
    : null;
  const remoteGateCode = typeof remoteWorkerAdmission?.remote_gate_code === "string"
    ? remoteWorkerAdmission.remote_gate_code
    : null;
  if (!remoteGateCode) {
    return refusal;
  }
  const parsedUnit = typeof refusal.unit_address === "string"
    ? parseWorkRecordUnitAddress(refusal.unit_address)
    : null;
  const unit = parsedUnit && parsedUnit.ok ? parsedUnit.value : null;
  const recovery = buildRemoteGateRefusalRecoveryDetail({ unit, remoteGateCode });
  if (!recovery) {
    return refusal;
  }
  const nextSteps = Array.isArray(recovery.next_actions) ? recovery.next_actions : [];
  const diagnostics = Array.isArray(refusal.diagnostics) ? [...refusal.diagnostics] : [];
  diagnostics.push({
    code: "worker_admission.remote_gate_refusal_recovery.v1",
    message: `Node Engine worker-admission refusal (${remoteGateCode})${nextSteps.length > 0 ? `. Next steps: ${nextSteps.join("; ")}` : ""}`,
    path: "remote_worker_admission"
  });
  return {
    ...refusal,
    diagnostics,
    remote_worker_admission_recovery: recovery
  };
}

function remediationStepLabel(nextStep) {
  switch (nextStep) {
    case "add_target_plan_evidence":
      return "add target-plan evidence first";
    case "split_or_narrow_write_scope":
      return "split or narrow write_scope";
    case "refine_expected_edit_targets_or_budget":
      return "add or refine expected_edit_targets or expected_changed_line_budget";
    case "extract_smaller_seam":
      return "extract a smaller seam";
    case "approved_large_file_review_path":
      return "route through an approved large-file review path";
    default:
      return null;
  }
}

export function evaluateVectorConstructionRefusal({
  role,
  env,
  repo,
  recordId,
  unitAddress,
  readiness,
  record,
  sliceId
}) {
  const selectedSlice = sliceId
    ? Array.isArray(record.slices)
      ? record.slices.find((slice) => slice && slice.id === sliceId) || null
      : null
    : null;

  if (sliceId && !selectedSlice) {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.stale_feature_vector.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.stale_feature_vector.v1",
          message: `selected slice ${sliceId} could not be resolved from the canonical record`,
          path: "record.slices"
        }
      ]
    });
  }

  let featureVector;
  try {
    featureVector = createWorkUnitFeatureVectorFromCanonicalRecord(record, {
      repo,
      recordId,
      sliceId,
      selectedSliceId: sliceId
    });
  } catch (error) {
    if (!(error instanceof WorkRecordFeatureVectorSourceError)) {
      throw error;
    }
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.invalid_feature_vector.v1",
      diagnostics: error.diagnostics
    });
  }

  if (!featureVector || featureVector.schema_version !== "work-unit-feature-vector.v1") {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.invalid_feature_vector.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.invalid_feature_vector.v1",
          message: "feature vector schema_version must be work-unit-feature-vector.v1",
          path: "feature_vector.schema_version"
        }
      ]
    });
  }

  if (featureVector.vocabulary_version !== "wk-ontology.v1") {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.invalid_feature_vector.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.invalid_feature_vector.v1",
          message: "feature vector vocabulary_version must be wk-ontology.v1",
          path: "feature_vector.vocabulary_version"
        }
      ]
    });
  }

  const workUnitAddress = featureVector.work_unit_address ?? {};
  if (
    workUnitAddress.address !== unitAddress ||
    workUnitAddress.record_id !== record.id ||
    workUnitAddress.slice_id !== sliceId
  ) {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.stale_feature_vector.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.stale_feature_vector.v1",
          message: `feature vector work_unit_address does not match ${unitAddress}`,
          path: "feature_vector.work_unit_address.address"
        }
      ]
    });
  }

  const blockingDegradation = Array.isArray(featureVector.degradations)
    ? featureVector.degradations.find((entry) => entry && entry.effect === "blocks_vector_construction")
    : null;
  if (blockingDegradation) {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.invalid_feature_vector.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.invalid_feature_vector.v1",
          message: blockingDegradation.reason || "feature vector construction is blocked",
          path: blockingDegradation.field_path || "feature_vector.degradations"
        }
      ]
    });
  }

  return null;
}

export function buildModelUnsetRefusal({ role, env, repo, recordId, unitAddress, reason, detail }) {
  return {
    mode: "refusal",
    role,
    subject: unitAddress,
    repo,
    command: "codex",
    args: [],
    env: {
      ...env,
      AGENT_ROLE: "worker",
      AGENT_WK: recordId,
      AGENT_SUBJECT: unitAddress
    },
    refusal: {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: reason,
      role,
      unit_address: unitAddress,
      expected_unit_address: unitAddress,
      diagnostics: [
        {
          code: reason,
          message: detail?.message
            ?? `worker model is unset: set ${detail?.env_key ?? "WORKER_MODEL"} in <workspace>/.env`,
          path: "model"
        }
      ],
      readiness: null,
      agent_brief: null,
      launch_packet: null,
      worker_admission: null
    }
  };
}

export function buildVectorConstructionRefusal({
  role,
  env,
  repo,
  recordId,
  unitAddress,
  readiness,
  wrapperGateCode,
  diagnostics
}) {
  return {
    mode: "refusal",
    role,
    subject: unitAddress,
    repo,
    command: "codex",
    args: [],
    env: {
      ...env,
      AGENT_ROLE: "worker",
      AGENT_WK: recordId,
      AGENT_SUBJECT: unitAddress
    },
    refusal: {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: wrapperGateCode,
      role,
      unit_address: unitAddress,
      expected_unit_address: readiness.unit.address,
      diagnostics,
      readiness,
      agent_brief: null,
      launch_packet: null,
      worker_admission: null
    }
  };
}
