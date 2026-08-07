import path from "node:path";
import { realpathSync } from "node:fs";

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
  "AGENT_OPERATOR_WRITE_SCOPE",
  "WIKI_MCP_COMMIT_BINDING",
  "WIKI_MCP_COMMIT_LAUNCH_REF",
  "WIKI_MCP_COMMIT_RUN_ID",
  "WIKI_MCP_COMMIT_RETRY_ID"
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

function callerSuppliedCommitCredentialRefusal(env) {
  if (!env || typeof env !== "object") return null;
  const carrier = WORKER_IDENTITY_CARRIER_ENV_KEYS
    .filter((key) => key.startsWith("WIKI_MCP_COMMIT_"))
    .find((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined);
  if (!carrier) return null;
  return Object.freeze({
    schema_version: "agent-dispatch-identity.v1",
    accepted: false,
    refusal_code: "agent_dispatch_identity.caller_supplied_role.v1",
    refusal_message: `caller-supplied commit credential is not authority: env.${carrier}`,
    detail: Object.freeze({ carrier: `env.${carrier}` })
  });
}

function assertManagedProvisioningMainRepo(worktreeProvisioning, sliceBinding) {
  if (worktreeProvisioning === null) return null;
  if (!worktreeProvisioning || typeof worktreeProvisioning !== "object" ||
      Array.isArray(worktreeProvisioning) || !Object.isFrozen(worktreeProvisioning)) {
    throw new Error("managed worker provisioning must be the exact frozen launcher-owned object");
  }
  const mainRepo = worktreeProvisioning.main_repo;
  if (typeof mainRepo !== "string" || mainRepo.length === 0 || mainRepo.trim() !== mainRepo ||
      !path.isAbsolute(mainRepo) || path.resolve(mainRepo) !== mainRepo) {
    throw new Error("managed worker provisioning main_repo must be an absolute canonical path");
  }
  let canonicalMainRepo;
  try {
    canonicalMainRepo = realpathSync(mainRepo);
  } catch {
    throw new Error("managed worker provisioning main_repo must resolve to the canonical main checkout");
  }
  if (canonicalMainRepo !== mainRepo) {
    throw new Error("managed worker provisioning main_repo must be an absolute canonical path");
  }
  const sliceWorktree = sliceBinding?.worktree_path;
  if (typeof sliceWorktree !== "string" || !path.isAbsolute(sliceWorktree) ||
      path.resolve(sliceWorktree) !== sliceWorktree || realpathSync(sliceWorktree) !== sliceWorktree ||
      worktreeProvisioning.worktree_path !== sliceWorktree) {
    throw new Error("managed worker provisioning sparse worktree must be an absolute canonical path");
  }
  if (mainRepo === sliceWorktree) {
    throw new Error("managed worker provisioning main_repo must be distinct from the sparse slice worktree");
  }
  return mainRepo;
}

import {
  buildCodexWritableSandboxArgs,
  buildFastDecommissionedRefusalPlan,
  buildHeadlessPlan,
  findRepoRoot,
  ROLE_CONFIG
} from "../commands/codex-role.mjs";
import {
  assertCodexWorkerCommitCredentialBinding,
  assertNoConfiguredCodexWorkerCommitCredential
} from "./codex-role-mcp-env.mjs";
import {
  buildAdmittedCodexWorkerPlan
} from "./codex-worker-plan-admitted.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";

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

export async function resolveWorkerPlanRepoRoots({
  managedCanonicalMainRepo,
  worktreeProvisioning,
  cwd,
  findRepoRoot: findRepoRootImpl = findRepoRoot
}) {
  if (managedCanonicalMainRepo !== null && managedCanonicalMainRepo !== undefined) {
    return {
      repo: worktreeProvisioning.worktree_path,
      canonicalReadRepo: managedCanonicalMainRepo
    };
  }
  const repo = await findRepoRootImpl(cwd);
  return { repo, canonicalReadRepo: repo };
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
  provisioned_worktree_git_identity = null,
  worker_scope_authority = null,
  worktree_provisioning = null,

  terminalStructuredRoleResultMode = undefined
}) {
  if (role === "worker-fast" || role === "worker_fast") {
    return buildFastDecommissionedRefusalPlan({ role, subject: wk, env });
  }

  const workerIdentityRefusal = callerSuppliedCommitCredentialRefusal(env) ??
    refuseCallerSuppliedWorkerIdentity(snapshotWorkerCallerSuppliedIdentityProbe({ env }));
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
  const frozenWorkerScopeAuthority = assertFrozenWorkerScopeAuthority(worker_scope_authority, {
    role,
    subject: wk,
    worktreeProvisioning: worktree_provisioning,
    provisionedWorktreeGitBinding: serverProvisionedWorktreeGitBinding,
    required: serverProvisionedWorktreeGitBinding !== null || worktree_provisioning !== null || worker_scope_authority !== null
  });
  const serverOwnedSliceBinding = worktree_provisioning?.slice_binding ?? null;
  const managedWorkerCommitRequired = frozenWorkerScopeAuthority !== null ||
    serverProvisionedWorktreeGitBinding !== null || worktree_provisioning !== null;

  const managedCanonicalMainRepo =
    assertManagedProvisioningMainRepo(worktree_provisioning, serverOwnedSliceBinding);
  if (managedWorkerCommitRequired) {
    assertNoConfiguredCodexWorkerCommitCredential({ env });
  }
  assertCodexWorkerCommitCredentialBinding({
    assignedUnit: wk,
    managedWorker: managedWorkerCommitRequired,
    worktreeProvisioning: worktree_provisioning,
    sliceBinding: serverOwnedSliceBinding
  });

  const unit = parseWorkRecordUnitAddress(wk);
  if (!unit.ok) {
    throw new Error(`codex-${role}: expected unit address like WK-0348 or WK-0348#slice-id, got: ${wk}`);
  }

  const { repo, canonicalReadRepo } = await resolveWorkerPlanRepoRoots({
    managedCanonicalMainRepo,
    worktreeProvisioning: worktree_provisioning,
    cwd
  });
  const unitAddress = unit.value.address;
  const recordId = unit.value.record_id;
  const sliceId = unit.value.slice_id;
  const now = env.AGENT_LAUNCH_TIMESTAMP || new Date().toISOString();
  const initialReadiness = await validateWorkRecordDispatch({
    dir: canonicalReadRepo,
    unitAddress,
    now
  });
  const bridgeResult = await applyGraphImpactBridge({
    readiness: initialReadiness,
    env,
    repo: canonicalReadRepo,
    envVar: CODEX_WORKER_GRAPH_IMPACT_BRIDGE_ENV_VAR,
    validate: (evidence) =>
      validateWorkRecordDispatch({
        dir: canonicalReadRepo,
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

  const loaded = await loadWorkRecordById({ dir: canonicalReadRepo, id: recordId });
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
    dir: canonicalReadRepo,
    record: loaded.record,
    unit: unit.value,
    env
  });
  const canonicalSummary = buildCanonicalSummary(loaded.record, readiness, unit.value);
  const agentBriefResult = await renderWorkRecordAgentBriefById({
    dir: canonicalReadRepo,
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

      remoteWorkerAdmission: remoteAdmissionProvenance,
      terminalStructuredRoleResultMode
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
    supplementalInstructions: promptArgs,

    terminalStructuredRoleResultMode
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
  return buildAdmittedCodexWorkerPlan({
    role,
    wk,
    env,
    repo,
    resolvedProfile,
    sourceToolSurface,
    frozenWorkerScopeAuthority,
    gate,
    loaded,
    sliceId,
    recordId,
    unitAddress,
    managedWorkerCommitRequired,
    worktree_provisioning,
    serverProvisionedWorktreeGitBinding,
    remoteAdmissionProvenance,
    terminalStructuredRoleResultMode,
    buildCodexWritableSandboxArgs,
    buildHeadlessPlan,
    ROLE_CONFIG
  });
}
