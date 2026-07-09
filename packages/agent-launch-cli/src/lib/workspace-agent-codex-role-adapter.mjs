

import path from "node:path";
import {
  mkdir,
  mkdtemp
} from "node:fs/promises";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";
import { summarizeDispatchReadinessDependencies } from "@agent-chassis/agent-launch-core/src/lib/work-record-gate.mjs";

import { resolveAgentRoleResultSchemaPath } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES
} from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { validateWorkRecordDispatchById } from "@agent-chassis/wiki-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  REVIEWER_WRITE_SCOPE_NONEMPTY_REASON,
  buildReviewerEmptyScopeAssertion,
  buildReviewerWriteScopeRefusalDetail
} from "../commands/agent-role.mjs";
import {
  AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
  appendGraphImpactBridgeDiagnostic,
  applyGraphImpactBridge
} from "./graph-impact-bridge.mjs";
import {
  FAST_PROFILE_REFUSAL_DIAGNOSTIC
} from "./agent-launch-profiles.mjs";
import { HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR } from "./host-write-authority-substrate.mjs";
import { assembleRoleIsolationInputs } from "./workspace-agent-launch-core.mjs";
import {
  assertFile,
  isDirectory
} from "./codex-role-io.mjs";

import {
  classifyCodexBinaryDir,
  collectExtraRuntimeRootsFromEnv,
  ensureWritableDirectory,
  resolveCodexSourceHome,
  sanitizeCodexChildEnv,
  setupCodexRuntimeHome
} from "./workspace-agent-codex-runtime-facts.mjs";
import { buildCodexWritableSandboxArgs } from "./codex-role-write-scope.mjs";
import {
  orchestratorPrompt,
  redteamPrompt,
  reviewPrompt
} from "./codex-role-prompts.mjs";
import {
  runtimeDirFor,
  subjectKey,
  titleFromPage,
  writeMeta
} from "./codex-role-orchestrator-history.mjs";

import {
  buildOrchestratorThreadName
} from "./orchestrator-launch-settings.mjs";

import { resolveHeadlessLogTarget } from "./orchestrator-launch-runtime.mjs";
import {
  CODEX_WIKI_MCP_SERVER_NAME,
  buildCodexWorkerWikiMcpEnvOverrides,
  buildCodexWorkspaceMcpEnvOverrides,
  injectCodexConfigOverridesBeforeFinalPositional,
  resolveWikiMcpServerPath
} from "./codex-role-mcp-env.mjs";
import {
  buildCodexWikiMcpServerOverrides
} from "./codex-role-wiki-mcp-override.mjs";
import {
  buildOrchestratorMcpSandboxProfileRequest
} from "./mcp-sandbox-profile.mjs";
import {
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  launcherRoleWritableRootPolicy,
  resolveLauncherRoleWritePosture
} from "./workspace-agent-family-policy.mjs";
import { gateRoleWriteScope } from "./workspace-agent-launch-adapter-contract.mjs";
import { buildBubblewrapLaunchPlan } from "./launch-isolation.mjs";
import { CODEX_BWRAP_ENV_POLICY } from "./codex-role-isolation.mjs";
import { buildWorkerSecretMaskInputs } from "./workspace-agent-family-bwrap-plan.mjs";

import {
  codexArgsWithSandboxRepoRealpath,
  envToSetenvMap,
  extractRepoInternalAddDirRoots,
  isCodexOrchestratorRole
} from "./codex-role-sandbox-args.mjs";
import {
  buildCodexReasoningEffortConfigOverrides,
  codexModelArgs
} from "./codex-role-reasoning-effort.mjs";
export {
  buildCodexReasoningEffortConfigOverrides
} from "./codex-role-reasoning-effort.mjs";
import {
  buildCodexFactResolutionRefusalPlan,
  isCodexFactResolutionRefusal
} from "./codex-role-fact-refusal.mjs";
import {
  buildReadOnlyRolePreparationAudit,
  classifyReadOnlySubject,
  loadReviewerSubjectScope
} from "./codex-role-read-only-support.mjs";

export const CODEX_ROLE_ISOLATION_SCHEMA_VERSION = "codex-role-isolation.v1";
export const CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE = "bubblewrap";

export const CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC = FAST_PROFILE_REFUSAL_DIAGNOSTIC;

export const CODEX_ROLE_FAST_REFUSAL_GATE_CODE = "wrapper.role.worker_fast_decommissioned.v1";

function resolveCodexScopeMountWritePosture(role) {
  const resolved = resolveLauncherRoleWritePosture({
    role,
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT
  });
  if (!resolved.ok) {
    throw new Error(`codex-${role}: ${resolved.reason}`);
  }
  return resolved;
}

function buildCodexSandboxArgsForRole(role) {
  const writePosture = resolveCodexScopeMountWritePosture(role);
  const sandboxMode = writePosture.scopeMount?.sandboxMode;
  if (typeof sandboxMode !== "string" || sandboxMode.length === 0) {
    throw new Error(`codex-${role}: launcher write posture did not resolve a Codex sandbox mode`);
  }
  return ["-s", sandboxMode];
}

function buildCodexWritableSandboxArgsForRole(role, repo, options) {
  const writePosture = resolveCodexScopeMountWritePosture(role);
  if (writePosture.scopeMount?.sandboxMode !== "workspace-write") {
    throw new Error(`codex-${role}: launcher write posture did not grant Codex writable sandbox`);
  }
  return buildCodexWritableSandboxArgs(repo, options);
}

function buildCodexApprovalArgsForRole(role) {
  const writePosture = resolveCodexScopeMountWritePosture(role);
  const args = ["-a", "never"];
  if (writePosture.coordinationWrite) {
    args.push("-c", 'approvals_reviewer="auto_review"');
  }
  return args;
}

export const ROLE_CONFIG = {
  worker: {
    envRole: "worker",
    profileEnv: "CODEX_WORKER_PROFILE",
    defaultProfile: "worker",
    defaultModel: "gpt-5.4-mini",
    verboseEnv: "CODEX_WORKER_VERBOSE",
    logPrefix: "codex-worker"
  },
  review: {
    envRole: "reviewer",
    profileEnv: "CODEX_REVIEWER_PROFILE",
    defaultProfile: "reviewer",
    verboseEnv: "CODEX_REVIEWER_VERBOSE",
    logPrefix: "codex-review"
  },
  redteam: {
    envRole: "redteam",
    profileEnv: "CODEX_REDTEAM_PROFILE",
    defaultProfile: "redteam",
    verboseEnv: "CODEX_REDTEAM_VERBOSE",
    logPrefix: "codex-redteam"
  }
};

export function buildCodexRoleIsolationInputs({
  role,
  repo,
  env = {},
  writableProjectRoots = [],
  writableFiles = [],
  runtimeDir = null
} = {}) {
  const sourceHomeResult = resolveCodexSourceHome(env);
  if (!sourceHomeResult.ok) return sourceHomeResult;
  const sourceHome = sourceHomeResult.sourceHome;
  const { binDir: codexBinDir, underSystemRoot: codexBinUnderSystemRoot } = classifyCodexBinaryDir(env);

  const readOnlyRoots = codexBinDir && !codexBinUnderSystemRoot ? [codexBinDir] : [];
  const extraRuntimeRoots = collectExtraRuntimeRootsFromEnv(env);
  const isolation = assembleRoleIsolationInputs({
    role,
    repo,
    sourceHome,
    readOnlyRoots,
    extraRuntimeRoots,
    writableProjectRoots,
    writableFiles,
    runtimeDir,
    schemaVersion: CODEX_ROLE_ISOLATION_SCHEMA_VERSION,
    failClosedMode: CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE,
    shareNet: true
  });
  if (!isCodexOrchestratorRole(role)) {
    return isolation;
  }
  return Object.freeze({
    ...isolation,
    mcp_sandbox_profile: buildOrchestratorMcpSandboxProfileRequest()
  });
}

export function stripNestedCodexSandboxArgs(args) {
  if (!Array.isArray(args)) return args;
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-s" || a === "--sandbox") && i + 1 < args.length) {
      i += 1;
      continue;
    }
    if (a === "--add-dir" && i + 1 < args.length) {
      i += 1;
      continue;
    }
    out.push(a);
  }
  out.unshift("-s", "danger-full-access");
  return out;
}

export function buildCodexRoleBubblewrapPlan(plan, {
  commandOverride = null,
  argsOverride = null,
  envOverride = null,
  cwdOverride = null,

  envPolicy = isCodexOrchestratorRole(plan?.role) ? null : CODEX_BWRAP_ENV_POLICY
} = {}) {
  if (!plan || plan.mode === "refusal" || !plan.isolation) {
    throw new Error(
      "buildCodexRoleBubblewrapPlan: plan must include role isolation inputs"
    );
  }
  const childCommand = commandOverride ?? plan.command;
  const realpathArgs = codexArgsWithSandboxRepoRealpath(argsOverride ?? plan.args, plan.repo);

  const childArgs = childCommand === "codex"
    ? stripNestedCodexSandboxArgs(realpathArgs)
    : realpathArgs;
  const workerSecretMaskInputs = isCodexOrchestratorRole(plan.role)
    ? { readOnlyRoots: [], maskTmpfsDirs: [] }
    : buildWorkerSecretMaskInputs({ workspaceDir: plan.repo });
  const serverProvisionedWorktreeGitIdentity = plan.provisionedWorktreeGitIdentity
    ?? plan.provisionedWorktreeGitBinding
    ?? plan.provisioned_worktree_git_identity
    ?? plan.provisioned_worktree_git_binding
    ?? null;
  return buildBubblewrapLaunchPlan({
    repo: plan.repo,
    command: childCommand,
    args: childArgs,
    cwd: cwdOverride ?? plan.repo,
    env: envToSetenvMap(envOverride ?? plan.env),
    writableRoots: [...plan.isolation.writable_roots],
    writableFiles: Array.isArray(plan.isolation.writable_files)
      ? [...plan.isolation.writable_files]
      : [],
    runtimeRoots: [...plan.isolation.runtime_roots],
    mcpSandboxProfile: plan.isolation.mcp_sandbox_profile ?? null,
    readOnlyRoots: Array.isArray(plan.isolation.read_only_roots)
      ? [...plan.isolation.read_only_roots, ...workerSecretMaskInputs.readOnlyRoots]
      : [...workerSecretMaskInputs.readOnlyRoots],
    maskTmpfsDirs: [...workerSecretMaskInputs.maskTmpfsDirs],
    ...(serverProvisionedWorktreeGitIdentity !== null
      ? { provisionedWorktreeGitIdentity: serverProvisionedWorktreeGitIdentity }
      : {}),
    homePolicy: plan.isolation.home_policy_reads.length > 0
      ? { reads: [...plan.isolation.home_policy_reads] }
      : null,
    shareNet: plan.isolation.share_net !== false,
    envPolicy
  });
}

export function isolationSummaryForPublic(isolation) {
  if (!isolation) return null;
  return {
    schema_version: isolation.schema_version,
    fail_closed_mode: isolation.fail_closed_mode,
    share_net: isolation.share_net,
    repo_read_only: true,
    writable_roots: [...isolation.writable_roots],
    writable_files: Array.isArray(isolation.writable_files)
      ? [...isolation.writable_files]
      : [],
    runtime_roots: [...isolation.runtime_roots],
    read_only_roots: Array.isArray(isolation.read_only_roots)
      ? [...isolation.read_only_roots]
      : [],
    home_policy_reads: [...isolation.home_policy_reads],
    mcp_sandbox_profile: isolation.mcp_sandbox_profile ?? null
  };
}

export function buildFastDecommissionedRefusalPlan({ role, subject, env = process.env }) {
  const subjectString = typeof subject === "string" ? subject : "";
  const refusalEnv = {
    ...env,
    AGENT_ROLE: "worker",
    AGENT_SUBJECT: subjectString
  };
  if (subjectString.startsWith("WK-")) {
    const parsed = parseWorkRecordUnitAddress(subjectString);
    if (parsed.ok) {
      refusalEnv.AGENT_WK = parsed.value.record_id;
    } else {
      refusalEnv.AGENT_WK = subjectString.split("#")[0];
    }
  }
  return {
    mode: "refusal",
    role,
    subject: subjectString,
    repo: null,
    command: "codex",
    args: [],
    env: refusalEnv,
    refusal: {
      wrapper_gate_code: CODEX_ROLE_FAST_REFUSAL_GATE_CODE,
      allowed: false,
      role,
      unit_address: subjectString,
      expected_unit_address: subjectString,
      diagnostics: [
        {
          code: CODEX_ROLE_FAST_REFUSAL_GATE_CODE,
          message: CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC,
          path: "role"
        }
      ],
      readiness: null,
      agent_brief: null,
      launch_packet: null,
      worker_admission: null,
      dependency_evidence: null
    }
  };
}

export async function buildOrchestratorPlan({ role, initiative, promptArgs, env, cwd, resolvedProfile = null, headless = false, logFile = null }) {
  assertId(initiative, /^IN-[0-9]+$/, "initiative id like IN-0004", role);
  const repo = await findRepoRoot(env.CODEX_ORCH_REPO || cwd);
  const initiativePath = path.join(repo, "wiki", "initiatives", `${initiative}.md`);
  await assertFile(initiativePath, `${role}: missing initiative page`);
  const repoName = path.basename(repo);
  const runtimeDir = runtimeDirFor({ env, repo, subject: initiative });
  await mkdir(runtimeDir, { recursive: true });
  const title = await titleFromPage(initiativePath);
  const baseThreadName = buildOrchestratorThreadName({
    subject: initiative,
    repoName,
    roleLabel: "orchestrator"
  });
  const threadName = env.CODEX_ORCH_THREAD_NAME || baseThreadName;
  const action = role === "orch-resume" ? "resume" : "launch";
  await writeMeta(runtimeDir, {
    repo,
    repo_name: repoName,
    initiative,
    title,
    thread_name: threadName,
    last_action: action,
    last_used_utc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  });

  const writableRootPolicy = launcherRoleWritableRootPolicy({ role });
  if (!writableRootPolicy.ok) {
    throw new Error(`codex-${role}: ${writableRootPolicy.reason}`);
  }
  const sandboxArgs = buildCodexWritableSandboxArgsForRole(role, repo, {
    writableProjectRoots: writableRootPolicy.writableProjectRoots,
    writableAbsoluteRoots: [runtimeDir]
  });
  const approvalArgs = buildCodexApprovalArgsForRole(role);
  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : "orchestrator";
  const modelArgs = codexModelArgs(resolvedProfile);

  const isHeadless = headless === true && role !== "orch-resume";
  const prompt = role === "orch-resume"
    ? null
    : orchestratorPrompt({ initiative, threadName, focus: promptArgs.join(" "), headless: isHeadless });
  const execSubcommandArgs = isHeadless ? ["exec", "--ignore-rules"] : [];
  const codexArgs = role === "orch-resume"
    ? [
        "--disable", "shell_snapshot",
        "resume",
        "-C", repo,
        ...sandboxArgs,
        ...approvalArgs,
        "-p", profile,
        ...modelArgs,
        threadName
      ]
    : [
        "--disable", "shell_snapshot",
        "-C", repo,
        ...sandboxArgs,
        ...approvalArgs,
        "-p", profile,
        ...execSubcommandArgs,
        ...modelArgs,
        prompt
      ];

  const orchEnv = {
    ...env,
    AGENT_ROLE: "orchestrator",
    AGENT_IN: initiative,
    CODEX_ORCH_THREAD_NAME: threadName,
    CODEX_ORCH_RUNTIME_DIR: runtimeDir
  };

  delete orchEnv[HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR];
  const isolation = buildCodexRoleIsolationInputs({
    role,
    repo,
    env,
    runtimeDir
  });
  if (isCodexFactResolutionRefusal(isolation)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject: initiative,
      repo,
      env: orchEnv,
      result: isolation
    });
  }

  const dispatchSidecar = {
    kind: "host_write_authority_localhost",
    host: "127.0.0.1",
    envVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,

    mcpServerName: CODEX_WIKI_MCP_SERVER_NAME
  };

  const headlessLogTarget = isHeadless
    ? resolveHeadlessLogTarget({ runtimeDir, logFileOverride: logFile })
    : null;
  return {
    mode: isHeadless ? "orchestrator-headless" : "interactive",
    role,
    subject: initiative,
    repo,
    runtimeDir,
    command: "codex",
    args: codexArgs,
    env: orchEnv,
    isolation,
    dispatchSidecar,
    headless: isHeadless,
    headlessLogTarget
  };
}

export function ensureRefusalDependencyEvidence(plan) {
  if (!plan || plan.mode !== "refusal" || !plan.refusal || typeof plan.refusal !== "object") {
    return plan;
  }
  if (plan.refusal.dependency_evidence !== undefined && plan.refusal.dependency_evidence !== null) {
    return plan;
  }
  plan.refusal.dependency_evidence = summarizeDispatchReadinessDependencies(plan.refusal.readiness);
  return plan;
}

export async function buildReadOnlyPlan({
  role,
  subject,
  promptArgs,
  env,
  cwd,
  resolvedProfile = null,
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null,
  acceptanceCriteria = [],
  acceptanceValidation = [],
  terminalStructuredRoleResultMode = undefined
}) {
  const config = ROLE_CONFIG[role];
  const classified = classifyReadOnlySubject(role, subject);
  if (!classified.ok) {
    throw new Error(classified.error);
  }
  const repo = await findRepoRoot(cwd);
  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : config.defaultProfile;
  const model = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  const renderedRolePrompt = role === "review"
    ? reviewPrompt(subject, { acceptanceCriteria, acceptanceValidation, terminalStructuredRoleResultMode })
    : redteamPrompt(subject, { acceptanceCriteria, acceptanceValidation, terminalStructuredRoleResultMode });
  const prompt = promptArgs.length > 0
    ? `${renderedRolePrompt}\n\nAdditional instructions:\n\n${promptArgs.join(" ")}`
    : renderedRolePrompt;
  const roleEnv = {
    ...env,
    AGENT_ROLE: config.envRole,
    AGENT_SUBJECT: subject
  };
  if (classified.kind === "work_record") {
    roleEnv.AGENT_WK = classified.record_id;
  } else {
    roleEnv.AGENT_IN = classified.subject;
  }

  let reviewerEmptyScopeAssertion = null;

  if (classified.kind === "work_record") {
    const now = typeof env.AGENT_LAUNCH_TIMESTAMP === "string" && env.AGENT_LAUNCH_TIMESTAMP.length > 0
      ? env.AGENT_LAUNCH_TIMESTAMP
      : new Date().toISOString();
    const preparationAudit = buildReadOnlyRolePreparationAudit({
      role: config.envRole,
      profile,
      unitAddress: classified.unit_address,
      repoRoot: repo,
      now
    });
    const initialReadiness = await validateWorkRecordDispatchById({
      dir: repo,
      unitAddress: classified.unit_address,
      dispatch_role: "read_only",
      preparation_audit: preparationAudit,
      now
    });
    const bridgeResult = await applyGraphImpactBridge({
      readiness: initialReadiness,
      env,
      repo,
      envVar: AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
      validate: (evidence) =>
        validateWorkRecordDispatchById({
          dir: repo,
          unitAddress: classified.unit_address,
          dispatch_role: "read_only",
          graph_impact: evidence,
          preparation_audit: preparationAudit,
          now
        })
    });
    const readiness = bridgeResult.readiness;
    const graphImpactBridge = bridgeResult.bridge;
    if (!readiness.dispatchable) {
      const dependencyEvidence = summarizeDispatchReadinessDependencies(readiness);
      const reasons = Array.isArray(readiness.reasons) ? readiness.reasons : [];
      const diagnostics = reasons.length > 0
        ? reasons.map((message) => ({
            code: "readiness_not_dispatchable",
            message,
            path: "readiness.reasons"
          }))
        : [{
            code: "readiness_not_dispatchable",
            message: `dispatch readiness is ${readiness.decision_code}`,
            path: "readiness.decision_code"
          }];
      appendGraphImpactBridgeDiagnostic(diagnostics, graphImpactBridge);
      return {
        mode: "refusal",
        role,
        subject,
        repo,
        command: "codex",
        args: [],
        env: roleEnv,
        refusal: {
          wrapper_gate_code: "readiness_not_dispatchable",
          allowed: false,
          role,
          unit_address: classified.unit_address,
          expected_unit_address: readiness.unit?.address ?? classified.unit_address,
          diagnostics,
          readiness,
          worker_admission: null,
          dependency_evidence: dependencyEvidence
        }
      };
    }

    if (role === "review") {
      const reviewerScope = await loadReviewerSubjectScope({
        repo,
        recordId: classified.record_id,
        sliceId: classified.slice_id
      });
      const reviewerWriteScopeGate = gateRoleWriteScope({
        role: "reviewer",
        write_scope: reviewerScope ? reviewerScope.write_scope : []
      });
      if (!reviewerWriteScopeGate.ok) {
        return buildCodexReviewerWriteScopeRefusal({
          role,
          subject,
          repo,
          env: roleEnv,
          readiness,
          unitAddress: classified.unit_address,
          recordId: classified.record_id,
          sliceId: classified.slice_id,
          subjectTitle: reviewerScope ? reviewerScope.title : null,
          observedWriteScope: reviewerScope ? reviewerScope.write_scope : [],
          repoPaths: reviewerScope ? reviewerScope.repo_paths : []
        });
      }
      reviewerEmptyScopeAssertion = buildReviewerEmptyScopeAssertion(
        reviewerWriteScopeGate.write_scope ?? [],
          true
      );
    }
  }

  const headlessPlan = await buildHeadlessPlan({
    role,
    subject,
    repo,
    env: roleEnv,
    logPrefix: config.logPrefix,
    verbose: env[config.verboseEnv] === "1",
    argsPrefix: [
      "--disable", "shell_snapshot",
      "-C", repo,
      ...buildCodexSandboxArgsForRole(role),
      ...buildCodexApprovalArgsForRole(role),
      "-p", profile,
      "exec",
      "--ignore-rules"
    ],
    model,
    prompt,
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot,

    terminalStructuredRoleResultMode
  });
  const wikiMcpServerPath = resolveWikiMcpServerPath();
  if (!wikiMcpServerPath) {
    throw new Error(`codex-${role}: failed to resolve @agent-chassis/wiki-mcp server entrypoint`);
  }
  const workerWikiMcpOverrides = [
    ...buildCodexWikiMcpServerOverrides({ serverPath: wikiMcpServerPath, repo }),
    ...buildCodexWorkerWikiMcpEnvOverrides({ assignedUnit: subject })
  ];
  if (Array.isArray(headlessPlan.args)) {
    injectCodexConfigOverridesBeforeFinalPositional(headlessPlan.args, workerWikiMcpOverrides);
  }
  if (reviewerEmptyScopeAssertion && headlessPlan && typeof headlessPlan === "object") {
    headlessPlan.reviewer_empty_scope_assertion = reviewerEmptyScopeAssertion;
  }
  return headlessPlan;
}

export function enforceReviewerWriteScope(role, declaredWriteScope) {
  if (role === "review" || role === "reviewer") {
    return [];
  }
  return Array.isArray(declaredWriteScope) ? declaredWriteScope : [];
}

export function buildCodexReviewerWriteScopeRefusal({
  role,
  subject,
  repo,
  env,
  readiness = null,
  unitAddress,
  recordId = null,
  sliceId = null,
  subjectTitle = null,
  observedWriteScope = [],
  repoPaths = []
}) {
  const observedScope = Array.isArray(observedWriteScope) ? observedWriteScope : [];
  const detail = buildReviewerWriteScopeRefusalDetail({
    subject: unitAddress ?? subject ?? null,
    role: "reviewer",
    subjectKind: "work_record",
    subjectTitle,
    recordId,
    sliceId,
    observedWriteScopeSize: observedScope.length,
    repoPaths
  });
  return {
    mode: "refusal",
    role,
    subject,
    repo,
    command: "codex",
    args: [],
    env,
    refusal: {
      wrapper_gate_code: RUNTIME_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
      allowed: false,
      role,
      unit_address: unitAddress ?? null,
      expected_unit_address: readiness?.unit?.address ?? unitAddress ?? null,
      diagnostics: [
        {
          code: RUNTIME_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
          message: `codex-${role}: reviewer dispatch requires write_scope: [] (got ${observedScope.length} entries)`,
          path: "scope.write_scope",
          reason: REVIEWER_WRITE_SCOPE_NONEMPTY_REASON,
          detail
        }
      ],
      readiness: readiness ?? null,
      worker_admission: null,
      dependency_evidence: readiness
        ? summarizeDispatchReadinessDependencies(readiness)
        : null,
      reviewer_empty_scope_assertion: buildReviewerEmptyScopeAssertion(observedScope,   false),
      reviewer_write_scope_refusal: detail
    }
  };
}

export async function buildHeadlessPlan({
  role,
  subject,
  repo,
  env,
  logPrefix,
  verbose,
  argsPrefix,
  prompt,
  model = null,
  writableProjectRoots: explicitWritableProjectRoots = null,
  writableFiles: explicitWritableFiles = null,
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null,
  terminalStructuredRoleResultMode = undefined
}) {
  const runtimeHomeResult = await setupCodexRuntimeHome({ env, repo, subject, role });
  if (isCodexFactResolutionRefusal(runtimeHomeResult)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject,
      repo,
      env,
      result: runtimeHomeResult
    });
  }
  const runtimeEnv = sanitizeCodexChildEnv(runtimeHomeResult);
  const modelArgs = typeof model === "string" && model.trim() !== "" ? ["-m", model.trim()] : [];

  const schemaConstraintArgs =
    terminalStructuredRoleResultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      ? ["--output-schema", resolveAgentRoleResultSchemaPath()]
      : [];
  const workspaceMcpEnvOverrides = buildCodexWorkspaceMcpEnvOverrides({
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot
  });
  const writePosture = resolveCodexScopeMountWritePosture(role);
  const runDirBase = path.join(runtimeEnv.CODEX_HOME, "tmp");
  await ensureWritableDirectory(runDirBase, role, "launcher runtime directory");

  const writableProjectRoots = Array.isArray(explicitWritableProjectRoots)
    ? explicitWritableProjectRoots
    : (writePosture.scopeMount?.writableProjectRoots?.length > 0
        ? writePosture.scopeMount.writableProjectRoots
        : extractRepoInternalAddDirRoots(argsPrefix, repo));
  const writableFiles = Array.isArray(explicitWritableFiles)
    ? explicitWritableFiles
    : [];
  const isolation = buildCodexRoleIsolationInputs({
    role,
    repo,
    env: runtimeEnv,
    writableProjectRoots,
    writableFiles,
    runtimeDir: runtimeEnv.CODEX_HOME
  });
  if (isCodexFactResolutionRefusal(isolation)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject,
      repo,
      env: runtimeEnv,
      result: isolation
    });
  }
  if (verbose) {
    const args = [...argsPrefix, ...modelArgs, ...schemaConstraintArgs, prompt];
    injectCodexConfigOverridesBeforeFinalPositional(args, [
      ...buildCodexReasoningEffortConfigOverrides({ role, repo, model }),
      ...workspaceMcpEnvOverrides
    ]);
    return {
      mode: "headless-verbose",
      role,
      subject,
      repo,
      command: "codex",
      args,
      env: runtimeEnv,
      isolation
    };
  }

  const runDir = await mkdtemp(path.join(runDirBase, `${logPrefix}.${subjectKey(subject)}.`));
  const finalPath = path.join(runDir, "final.md");
  const logPath = path.join(runDir, "run.log");
  const args = [...argsPrefix, ...modelArgs, "--output-last-message", finalPath, ...schemaConstraintArgs, prompt];
  injectCodexConfigOverridesBeforeFinalPositional(args, [
    ...buildCodexReasoningEffortConfigOverrides({ role, repo, model }),
    ...workspaceMcpEnvOverrides
  ]);
  return {
    mode: "headless",
    role,
    subject,
    repo,
    command: "codex",
    args,
    env: runtimeEnv,
    runDir,
    finalPath,
    logPath,
    logPrefix,
    isolation
  };
}

function assertId(value, pattern, expected, role) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`codex-${role}: expected ${expected}, got: ${value}`);
  }
}

export async function findRepoRoot(start) {
  let current = path.resolve(start);
  if (!(await isDirectory(current))) {
    current = path.dirname(current);
  }
  while (true) {
    if (await isDirectory(path.join(current, "wiki")) && await isDirectory(path.join(current, "docs"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`expected repo with wiki/ and docs/ at or above: ${start}`);
    }
    current = parent;
  }
}
