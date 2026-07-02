import path from "node:path";

import {
  evaluateWorkRecordWrapperGate,
  parseWorkRecordUnitAddress,
  WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION
} from "@agent-chassis/agent-launch-core";
import {
  appendGraphImpactBridgeDiagnostic,
  applyGraphImpactBridge,
  CODEX_WORKER_GRAPH_IMPACT_BRIDGE_ENV_VAR
} from "./graph-impact-bridge.mjs";
import { normalizeWorkUnitFeatureVector } from "@agent-chassis/wiki-core/src/lib/work-record-feature-vector.mjs";
import {
  computeWorkRecordSourceDigest,
  loadWorkRecordById,
  renderWorkRecordAgentBriefById,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  bootstrapNodeEngineEnvFromFile,
  resolveNodeEngineEnvFilePath
} from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

import {
  buildCanonicalSummary,
  evaluateWorkerAdmissionDecision,
  normalizeRemoteWorkerAdmissionPackResultForDecision,
  refuseCallerSuppliedWorkerIdentity,
  resolveRemoteWorkerAdmissionPackResultForUnit
} from "./workspace-agent-worker-admission.mjs";

import {
  buildRemoteGateRefusalRecoveryDetail
} from "./workspace-agent-worker-admission-recovery.mjs";

const WORKER_IDENTITY_CARRIER_ENV_KEYS = Object.freeze([
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE"
]);

function snapshotWorkerCallerSuppliedIdentityProbe({ env }) {
  const probe = {};
  if (env && typeof env === "object") {
    const envCarriers = {};
    for (const key of WORKER_IDENTITY_CARRIER_ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) {
        envCarriers[key] = env[key];
      }
    }
    if (Object.keys(envCarriers).length > 0) {
      probe.env = envCarriers;
    }
  }
  return probe;
}

import {
  buildCodexWritableSandboxArgs,
  buildFastDecommissionedRefusalPlan,
  buildHeadlessPlan,
  findRepoRoot,
  ROLE_CONFIG
} from "../commands/codex-role.mjs";
import {
  AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES,
  assertCodexCallableSourceToolSurface,
  isScopedChildToolSurfaceRefusal,
  isSourceToolSurfaceNotConfigured
} from "./agent-child-tool-surface.mjs";
import {
  collectSliceDeclaredWritableFiles,
  isolationWritableDirectoriesForLaunch,
  planWorkerWriteScopeNewDirectories,
  projectPermissionWritesForWorkerLaunch
} from "./codex-worker-write-scope-plan.mjs";
import {
  buildCodexWorkerWikiMcpEnvOverrides,
  injectCodexConfigOverridesBeforeFinalPositional,
  quoteTomlString,
  resolveWikiMcpServerPath
} from "./codex-role-mcp-env.mjs";
import {
  buildCodexWikiMcpServerOverrides
} from "./codex-role-wiki-mcp-override.mjs";

import { resolveDispatchedRoleModel } from "./agent-launch-profiles.mjs";

export {
  ensureNewWorkerWriteRoots,
  evaluateWorkerAdmissionDecision,
  evaluateWorkerAdmissionForBackend,
  refuseCallerSuppliedWorkerIdentity,
  buildCanonicalSummary
} from "./workspace-agent-worker-admission.mjs";

function buildCodexCallableSourceSurfaceRefusalPlan({ role, wk, env, callableSourceToolSurface }) {
  const recordIdHint = typeof wk === "string" && wk.startsWith("WK-")
    ? wk.split("#")[0]
    : null;
  return {
    mode: "refusal",
    role,
    subject: typeof wk === "string" ? wk : null,
    repo: null,
    command: "codex",
    args: [],
    env: {
      ...env,
      AGENT_ROLE: "worker",
      ...(recordIdHint ? { AGENT_WK: recordIdHint } : {}),
      AGENT_SUBJECT: typeof wk === "string" ? wk : ""
    },
    refusal: {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      role,
      unit_address: typeof wk === "string" ? wk : null,
      expected_unit_address: typeof wk === "string" ? wk : null,
      diagnostics: [
        {
          code: RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE,
          message: "codex-worker source-edit launch requires callable launcher-owned scoped source tools",
          path: "source_tool_surface.codex_child_runtime",
          reason: "single_launcher_source_tool_surface_not_callable_for_codex_worker",
          detail: {
            required_backend_kind: "filesystem_mcp",
            required_surface: "launcher_owned_scoped_source_read_write",
            reason_code: callableSourceToolSurface.refusal_code
              ?? AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
            refusal: callableSourceToolSurface
          }
        }
      ],
      readiness: null,
      worker_admission: null,
      dependency_evidence: null
    }
  };
}

export function buildCodexFilesystemMcpChildMountConfigOverrides(callableSourceToolSurface) {
  const mount = callableSourceToolSurface?.codex_child_runtime?.child_mount ?? null;
  if (!mount || typeof mount !== "object") {
    return [];
  }
  const serverName = typeof mount.mcp_server_name === "string" && mount.mcp_server_name.length > 0
    ? mount.mcp_server_name
    : "filesystem_mcp";
  if (typeof mount.command !== "string" || mount.command.length === 0 || !Array.isArray(mount.args)) {
    return [];
  }
  const overrides = [
    `mcp_servers.${serverName}.command=${quoteTomlString(mount.command)}`,
    `mcp_servers.${serverName}.args=${JSON.stringify(mount.args)}`
  ];
  const env = mount.env && typeof mount.env === "object" ? mount.env : {};
  for (const key of Object.keys(env).sort()) {
    overrides.push(`mcp_servers.${serverName}.env.${key}=${quoteTomlString(env[key])}`);
  }
  return overrides;
}

export async function buildWorkerPlan({ role, wk, promptArgs, env, cwd, resolvedProfile = null, sourceToolSurface = null }) {
  if (role === "worker-fast" || role === "worker_fast") {
    return buildFastDecommissionedRefusalPlan({ role, subject: wk, env });
  }

  const workerIdentityRefusal = refuseCallerSuppliedWorkerIdentity(
    snapshotWorkerCallerSuppliedIdentityProbe({ env })
  );
  if (workerIdentityRefusal) {
    const recordIdHint = typeof wk === "string" && wk.startsWith("WK-")
      ? wk.split("#")[0]
      : null;
    return {
      mode: "refusal",
      role,
      subject: typeof wk === "string" ? wk : null,
      repo: null,
      command: "codex",
      args: [],
      env: {
        ...env,
        AGENT_ROLE: "worker",
        ...(recordIdHint ? { AGENT_WK: recordIdHint } : {}),
        AGENT_SUBJECT: typeof wk === "string" ? wk : ""
      },
      refusal: {
        schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
        allowed: false,
        wrapper_gate_code: RUNTIME_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
        role,
        unit_address: typeof wk === "string" ? wk : null,
        expected_unit_address: typeof wk === "string" ? wk : null,
        diagnostics: [
          {
            code: RUNTIME_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
            message: workerIdentityRefusal.refusal_message
              ?? "caller-supplied identity is not authority",
            path: workerIdentityRefusal.detail?.carrier ?? "env",

            identity_refusal_code: workerIdentityRefusal.refusal_code
          }
        ],
        readiness: null,
        agent_brief: null,
        launch_packet: null,
        identity_refusal: workerIdentityRefusal
      }
    };
  }

  const unit = parseWorkRecordUnitAddress(wk);
  if (!unit.ok) {
    throw new Error(`codex-${role}: expected unit address like WK-0348 or WK-0348#slice-id, got: ${wk}`);
  }
  const repo = await findRepoRoot(cwd);
  const unitAddress = unit.value.address;
  const recordId = unit.value.record_id;
  const sliceId = unit.value.slice_id;
  const now = env.AGENT_LAUNCH_TIMESTAMP || new Date().toISOString();
  const initialReadiness = await validateWorkRecordDispatch({
    dir: repo,
    unitAddress,
    now
  });
  const bridgeResult = await applyGraphImpactBridge({
    readiness: initialReadiness,
    env,
    repo,
    envVar: CODEX_WORKER_GRAPH_IMPACT_BRIDGE_ENV_VAR,
    validate: (evidence) =>
      validateWorkRecordDispatch({
        dir: repo,
        unitAddress,
        graph_impact: evidence,
        now
      })
  });
  let readiness = bridgeResult.readiness;
  const graphImpactBridge = bridgeResult.bridge;
  if (!readiness.dispatchable) {
    const diagnostics = [
      {
        code: "readiness_not_dispatchable",
        message: `dispatch readiness is ${readiness.decision_code}`,
        path: "readiness.decision_code"
      }
    ];
    appendGraphImpactBridgeDiagnostic(diagnostics, graphImpactBridge);
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
        wrapper_gate_code: "readiness_not_dispatchable",
        role,
        unit_address: unitAddress,
        expected_unit_address: readiness.unit.address,
        diagnostics,
        readiness,
        agent_brief: null,
        launch_packet: null,
        graph_impact_bridge: graphImpactBridge
      }
    };
  }

  const loaded = await loadWorkRecordById({ dir: repo, id: recordId });
  if (!loaded.record) {
    return buildVectorConstructionRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      readiness,
      wrapperGateCode: "wrapper.vector_construction.missing_record.v1",
      diagnostics: [
        {
          code: "wrapper.vector_construction.missing_record.v1",
          message: `canonical work record ${recordId} could not be loaded`,
          path: "record"
        },
        ...(Array.isArray(loaded.diagnostics) ? loaded.diagnostics : [])
      ]
    });
  }

  if (!loaded.valid) {
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
          message: `canonical work record ${recordId} could not be validated for feature-vector construction`,
          path: "record"
        },
        ...(Array.isArray(loaded.diagnostics) ? loaded.diagnostics : [])
      ]
    });
  }

  const vectorConstructionRefusal = evaluateVectorConstructionRefusal({
    role,
    env,
    repo,
    recordId,
    unitAddress,
    readiness,
    record: loaded.record,
    sliceId
  });
  if (vectorConstructionRefusal) {
    return vectorConstructionRefusal;
  }

  const remoteAdmissionProvenance = await resolveRemoteWorkerAdmissionProvenance({
    dir: repo,
    record: loaded.record,
    unit: unit.value,
    env
  });
  const canonicalSummary = buildCanonicalSummary(loaded.record, readiness, unit.value);
  const agentBriefResult = await renderWorkRecordAgentBriefById({
    dir: repo,
    id: recordId,
    sliceId
  });
  if (!agentBriefResult.valid || !agentBriefResult.brief || !agentBriefResult.projection) {
    const refusal = evaluateWorkRecordWrapperGate({
      role,
      unitAddress,
      readiness,
      agentBrief: null,
      sourceDigest: computeWorkRecordSourceDigest(loaded.record),
      canonicalSummary,
      launchTimestamp: env.AGENT_LAUNCH_TIMESTAMP || new Date().toISOString(),
      supplementalInstructions: promptArgs,

      remoteWorkerAdmission: remoteAdmissionProvenance
    });
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
      refusal,
      ...(remoteAdmissionProvenance ? { workerAdmissionRemote: remoteAdmissionProvenance } : {})
    };
  }
  const sourceDigest = computeWorkRecordSourceDigest(loaded.record);
  const gate = evaluateWorkRecordWrapperGate({
    role,
    unitAddress,
    readiness,
    sourceDigest,
    canonicalSummary,
    agentBrief: {
      brief: agentBriefResult.brief,
      projection: agentBriefResult.projection
    },

    remoteWorkerAdmission: remoteAdmissionProvenance,
    launchTimestamp: env.AGENT_LAUNCH_TIMESTAMP || new Date().toISOString(),
    supplementalInstructions: promptArgs
  });
  if (!gate.allowed) {
    const refusal = attachWorkerAdmissionRemediation(gate);
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
      refusal,
      ...(remoteAdmissionProvenance ? { workerAdmissionRemote: remoteAdmissionProvenance } : {})
    };
  }

  let callableSourceToolSurface = null;
  let preparedNewWriteRoots = [];
  let isolationWritableProjectRoots = [];
  let isolationWritableFiles = [];
  let sandboxArgs = [];
  if (isSourceToolSurfaceNotConfigured(sourceToolSurface)) {

    const writeScope = gate.launch_packet.canonical_summary.write_scope;
    const projectPermissionWrites = await projectPermissionWritesForWorkerLaunch(repo, writeScope);
    preparedNewWriteRoots = await planWorkerWriteScopeNewDirectories(repo, writeScope);
    const selectedSliceForWritables = sliceId && Array.isArray(loaded.record.slices)
      ? loaded.record.slices.find((slice) => slice && slice.id === sliceId) || null
      : null;
    const declaredWritableFiles = await collectSliceDeclaredWritableFiles({
      repo,
      record: loaded.record,
      selectedSlice: selectedSliceForWritables,
      writeScope
    });
    isolationWritableProjectRoots = await isolationWritableDirectoriesForLaunch(repo, writeScope);
    isolationWritableFiles = declaredWritableFiles.map((relPath) => path.resolve(repo, relPath));
    sandboxArgs = buildCodexWritableSandboxArgs(repo, {
      writableProjectRoots: projectPermissionWrites
    });
  } else {
    callableSourceToolSurface = assertCodexCallableSourceToolSurface(sourceToolSurface);
    if (isScopedChildToolSurfaceRefusal(callableSourceToolSurface)) {
      return buildCodexCallableSourceSurfaceRefusalPlan({
        role,
        wk,
        env,
        callableSourceToolSurface
      });
    }
  }

  const roleModel = resolveDispatchedRoleModel({ role, resolvedProfile, dir: repo });
  if (!roleModel.ok) {
    return buildModelUnsetRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      reason: roleModel.reason,
      detail: roleModel.detail
    });
  }
  const model = roleModel.model;
  const config = ROLE_CONFIG[role];

  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : config.defaultProfile;
  const prompt = gate.launch_packet.prompt;
  const baseArgs = [
    "--disable", "shell_snapshot",
    "-C", repo,
    ...sandboxArgs,
    "-a", "never",
    "-p", profile,
    "exec",
    "--ignore-rules"
  ];
  const headlessPlan = await buildHeadlessPlan({
    role,
    subject: unitAddress,
    repo,
    env: {
      ...env,
      AGENT_ROLE: config.envRole,
      AGENT_WK: recordId,
      AGENT_SUBJECT: unitAddress,
      ...(callableSourceToolSurface?.descriptor?.descriptor_digest
        ? { AGENT_LAUNCH_SOURCE_TOOL_SURFACE_DIGEST: callableSourceToolSurface.descriptor.descriptor_digest }
        : {}),
      ...(callableSourceToolSurface?.decision?.accepted_handshake_digest
        ? { AGENT_LAUNCH_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST: callableSourceToolSurface.decision.accepted_handshake_digest }
        : {})
    },
    logPrefix: config.logPrefix,
    verbose: env[config.verboseEnv] === "1",
    model,
    argsPrefix: baseArgs,
    prompt,
    writableProjectRoots: isolationWritableProjectRoots,
    writableFiles: isolationWritableFiles
  });
  headlessPlan.preparedNewWriteRoots = preparedNewWriteRoots;

  headlessPlan.sourceToolSurface = callableSourceToolSurface ?? sourceToolSurface;

  const filesystemMcpOverrides = buildCodexFilesystemMcpChildMountConfigOverrides(callableSourceToolSurface);
  if (filesystemMcpOverrides.length > 0 && Array.isArray(headlessPlan.args)) {
    injectCodexConfigOverridesBeforeFinalPositional(headlessPlan.args, filesystemMcpOverrides);
  }
  const wikiMcpServerPath = resolveWikiMcpServerPath();
  if (!wikiMcpServerPath) {
    throw new Error("codex-worker: failed to resolve @agent-chassis/wiki-mcp server entrypoint");
  }
  const workerWikiMcpOverrides = [
    ...buildCodexWikiMcpServerOverrides({ serverPath: wikiMcpServerPath, repo }),
    ...buildCodexWorkerWikiMcpEnvOverrides({ assignedUnit: unitAddress })
  ];
  if (Array.isArray(headlessPlan.args)) {
    injectCodexConfigOverridesBeforeFinalPositional(headlessPlan.args, workerWikiMcpOverrides);
  }
  if (remoteAdmissionProvenance) {
    headlessPlan.workerAdmissionRemote = remoteAdmissionProvenance;
  }
  return headlessPlan;
}

async function resolveRemoteWorkerAdmissionProvenance({
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

function evaluateVectorConstructionRefusal({
  role,
  env,
  repo,
  recordId,
  unitAddress,
  readiness,
  record,
  sliceId
}) {
  const featureVector = normalizeWorkUnitFeatureVector(
    {
      ...record,
      schema_version: "work-unit-feature-vector.v1",
      vocabulary_version: "wk-ontology.v1"
    },
    { repo, recordId, sliceId, selectedSliceId: sliceId }
  );
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

function buildModelUnsetRefusal({ role, env, repo, recordId, unitAddress, reason, detail }) {
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

function buildVectorConstructionRefusal({
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
