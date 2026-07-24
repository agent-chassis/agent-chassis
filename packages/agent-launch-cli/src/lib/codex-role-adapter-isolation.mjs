

import path from "node:path";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";
import {
  FAST_PROFILE_REFUSAL_DIAGNOSTIC
} from "./agent-launch-profiles.mjs";
import { assembleRoleIsolationInputs } from "./workspace-agent-launch-core.mjs";
import { isDirectory } from "./codex-role-io.mjs";

import {
  classifyCodexBinaryDir,
  collectExtraRuntimeRootsFromEnv,
  resolveCodexSourceHome
} from "./workspace-agent-codex-runtime-facts.mjs";
import { buildCodexWritableSandboxArgs } from "./codex-role-write-scope.mjs";
import {
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  resolveLauncherRoleWritePosture
} from "./workspace-agent-family-policy.mjs";
import { buildBubblewrapLaunchPlan } from "./launch-isolation.mjs";
import { CODEX_BWRAP_ENV_POLICY } from "./codex-role-isolation.mjs";
import { buildWorkerSecretMaskInputs } from "./workspace-agent-family-bwrap-plan.mjs";
import {
  prepareLauncherOwnedDispatchWorktreeRoot
} from "./orchestrator-launch-isolation.mjs";

import {
  codexArgsWithSandboxRepoRealpath,
  envToSetenvMap,
  isCodexOrchestratorRole
} from "./codex-role-sandbox-args.mjs";

export const CODEX_ROLE_ISOLATION_SCHEMA_VERSION = "codex-role-isolation.v1";
export const CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE = "bubblewrap";

export const CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC = FAST_PROFILE_REFUSAL_DIAGNOSTIC;

export const CODEX_ROLE_FAST_REFUSAL_GATE_CODE = "wrapper.role.worker_fast_decommissioned.v1";

export function resolveCodexScopeMountWritePosture(role) {
  const resolved = resolveLauncherRoleWritePosture({
    role,
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT
  });
  if (!resolved.ok) {
    throw new Error(`codex-${role}: ${resolved.reason}`);
  }
  return resolved;
}

export function buildCodexSandboxArgsForRole(role) {
  const writePosture = resolveCodexScopeMountWritePosture(role);
  const sandboxMode = writePosture.scopeMount?.sandboxMode;
  if (typeof sandboxMode !== "string" || sandboxMode.length === 0) {
    throw new Error(`codex-${role}: launcher write posture did not resolve a Codex sandbox mode`);
  }
  return ["-s", sandboxMode];
}

export function buildCodexWritableSandboxArgsForRole(role, repo, options) {
  const writePosture = resolveCodexScopeMountWritePosture(role);
  if (writePosture.scopeMount?.sandboxMode !== "workspace-write") {
    throw new Error(`codex-${role}: launcher write posture did not grant Codex writable sandbox`);
  }
  return buildCodexWritableSandboxArgs(repo, options);
}

export function buildCodexApprovalArgsForRole(role) {
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
  runtimeDir = null,
  workerScopeAuthority = null,
  subject = null
} = {}) {
  const sourceHomeResult = resolveCodexSourceHome(env, { workerScopeAuthority, role, subject });
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
    shareNet: true,
    workerScopeAuthority: sourceHomeResult.workerScopeAuthority
  });
  return isolation;
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
  stdioMcpConduit = null,

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
  const orchestratorManagedWorktreeReadRoots = isCodexOrchestratorRole(plan.role)
    ? [prepareLauncherOwnedDispatchWorktreeRoot({
        repo: plan.repo,
        dispatchWorktreeRoot: plan.dispatchWorktreeRoot ?? null
      })]
    : [];
  const serverProvisionedWorktreeGitIdentity = plan.provisionedWorktreeGitIdentity
    ?? plan.provisionedWorktreeGitBinding
    ?? plan.provisioned_worktree_git_identity
    ?? plan.provisioned_worktree_git_binding
    ?? null;
  const findingsRole = plan.role === "review" || plan.role === "reviewer"
    ? "reviewer"
    : plan.role === "redteam"
      ? "redteam"
      : null;
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
    findingsRole,
    readOnlyRoots: Array.isArray(plan.isolation.read_only_roots)
      ? [
          ...plan.isolation.read_only_roots,
          ...workerSecretMaskInputs.readOnlyRoots,
          ...orchestratorManagedWorktreeReadRoots
        ]
      : [...workerSecretMaskInputs.readOnlyRoots, ...orchestratorManagedWorktreeReadRoots],
    requiredReadOnlyFiles: Array.isArray(plan.isolation.required_read_only_files)
      ? [...plan.isolation.required_read_only_files]
      : [],
    maskTmpfsDirs: [...workerSecretMaskInputs.maskTmpfsDirs],
    workerScopeAuthority: plan.isolation.worker_scope_authority,
    ...(serverProvisionedWorktreeGitIdentity !== null
      ? { provisionedWorktreeGitIdentity: serverProvisionedWorktreeGitIdentity }
      : {}),
    homePolicy: plan.isolation.home_policy_reads.length > 0
      ? { reads: [...plan.isolation.home_policy_reads] }
      : null,
    shareNet: plan.isolation.share_net !== false,
    stdioMcpConduit,
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
    home_policy_reads: [...isolation.home_policy_reads]
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
