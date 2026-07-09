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
  buildCanonicalSummary,
  evaluateWorkerAdmissionDecision,
  refuseCallerSuppliedWorkerIdentity,
} from "./workspace-agent-worker-admission.mjs";
import {
  attachWorkerAdmissionRemediation,
  buildModelUnsetRefusal,
  buildVectorConstructionRefusal,
  evaluateVectorConstructionRefusal,
  resolveRemoteWorkerAdmissionProvenance
} from "./codex-worker-plan-refusals.mjs";

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

export {
  attachWorkerAdmissionRemediation
} from "./codex-worker-plan-refusals.mjs";

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

export async function buildWorkerPlan({
  role,
  wk,
  promptArgs,
  env,
  cwd,
  resolvedProfile = null,
  sourceToolSurface = null,
  provisionedWorktreeGitBinding = null,
  provisionedWorktreeGitIdentity = null,
  provisioned_worktree_git_binding = null,
  provisioned_worktree_git_identity = null
}) {
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
  const serverProvisionedWorktreeGitBinding = provisionedWorktreeGitBinding
    ?? provisioned_worktree_git_binding
    ?? provisionedWorktreeGitIdentity
    ?? provisioned_worktree_git_identity
    ?? null;

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
  if (serverProvisionedWorktreeGitBinding !== null) {
    headlessPlan.provisionedWorktreeGitBinding = serverProvisionedWorktreeGitBinding;
    headlessPlan.provisioned_worktree_git_binding = serverProvisionedWorktreeGitBinding;
  }

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
