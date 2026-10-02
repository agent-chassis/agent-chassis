

import path from "node:path";
import os from "node:os";
import { existsSync, statSync } from "node:fs";
import { lstat, readlink, stat, readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_REFUSAL_CODES,
  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";
import {
  resolveAgentRoleResultSchemaJson
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import {
  deriveFamilyRuntimeHomePolicyProfile,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan,
  buildFamilyRuntimeCommandResolution,
  isWithinRepo,
  mergeFamilyRuntimeReadOnlyRoots,
  resolveFamilyRuntimeExecutable,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import { ensureLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  buildMissingResultPayload,
  detectNoFindingsLine,
  gateRoleWriteScope,
  SHARED_FAMILY_BWRAP_ENV_ALLOWLIST
} from "./workspace-agent-launch-core.mjs";
import {
  resolveCanonicalWriteScope,
  deriveWritableMountsFromWriteScope,
  deriveWritableMountsFromResolvedScope,
  deriveDirectoryScopedWritableMountsFromWriteScope
} from "./workspace-agent-write-scope.mjs";
import {
  renderLauncherFamilyRoleContract,
  LauncherRoleContractError
} from "./codex-role-prompts.mjs";

import {
  resolveTerminalStructuredRoleResultMode
} from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  buildFinalResultEnvelope,
  buildFindingsPayload,
  buildNoFindingsPayload,
  buildRefusalEnvelope,
  createApprovedReadOnlyFileGuard,
  probeRuntimeSymlink
} from "./workspace-agent-family-adapter-core.mjs";
import { buildFamilyExecutorBwrapPlan } from "./workspace-agent-family-bwrap-plan.mjs";
import { resolveLaunchRoleGuideDirectory } from "./launch-isolation-plan.mjs";
import { assertGitMetadataProjectionComposed } from "./launch-isolation-findings-git-metadata.mjs";
import { resolveAdvisoryReviewGitMetadataProjection } from
  "./workspace-agent-advisory-review-contract.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
  deriveLauncherRuntimeHomePolicyFacts,
  resolveLauncherOwnedHostHome
} from "./launcher-runtime-home-policy.mjs";
import {
  LAUNCHER_WRITE_POSTURES,
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  resolveFamilyModelDisposition,
  buildFamilyModelFlagArgs,
  resolveLauncherRoleWritePosture
} from "./workspace-agent-family-policy.mjs";
import {
  neutralEffortMapping,
  resolveDispatchedRoleModel,
  resolveEffectiveRoleEffort
} from "./agent-launch-profiles.mjs";

import {
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
} from "./workspace-agent-launch-adapter-contract.mjs";

export const CLAUDE_FAMILY_SOURCE_READ_MODE = LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM;
export const CLAUDE_FAMILY_NATIVE_READ_CAPABILITY = LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO;
export const CLAUDE_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION =
  "claude-workspace-agent-launch-executor.v1";

export const CLAUDE_WORKER_DENY_TOOLS = Object.freeze([
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "Workflow",
  "Skill",
  "Monitor"
]);

export const CLAUDE_NATIVE_COMMAND_TOOL = "Bash";

export const CLAUDE_REPO_SETTINGS_DIR_NAME = ".claude";
export const CLAUDE_MANAGED_SETTINGS_DIR = "/etc/claude-code";

function normalizeEditAllowPattern({ repoRoot, raw }) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const dirHint = trimmed.endsWith("/");
  const entry = dirHint ? trimmed.replace(/\/+$/, "") : trimmed;
  if (entry.length === 0) return null;
  const abs = path.isAbsolute(entry)
    ? path.normalize(entry)
    : path.resolve(repoRoot, entry);
  const rel = path.relative(repoRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const relPosix = rel.split(path.sep).join("/");
  let isDir = dirHint;
  if (!isDir) {
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
  }
  return isDir ? `Edit(${relPosix}/**)` : `Edit(${relPosix})`;
}

export function deriveClaudeEditAllowPatterns({ workspaceDir, writeScope } = {}) {
  const patterns = [];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return patterns;
  }
  const repoRoot = path.resolve(workspaceDir);
  for (const raw of Array.isArray(writeScope) ? writeScope : []) {
    const pattern = normalizeEditAllowPattern({ repoRoot, raw });
    if (pattern && !patterns.includes(pattern)) patterns.push(pattern);
  }
  return patterns;
}

function claudeAbsoluteReadPattern(dir) {
  return `Read(//${dir.replace(/^\/+/, "")}/**)`;
}

export function buildClaudeNativePermissionSettings({
  workspaceDir,
  writeScope,
  role = "worker",

  mcpToolNames = []
} = {}) {
  const repoAbs = path.resolve(
    typeof workspaceDir === "string" && workspaceDir.length > 0 ? workspaceDir : "."
  );

  const repoReadPattern = claudeAbsoluteReadPattern(repoAbs);
  const implementationWorker = role === "worker";
  const roleGuideDir = resolveLaunchRoleGuideDirectory(role);
  const allow = [
    repoReadPattern,
    ...(roleGuideDir === null ? [] : [claudeAbsoluteReadPattern(roleGuideDir)]),
    CLAUDE_NATIVE_COMMAND_TOOL,
    ...(implementationWorker
      ? deriveClaudeEditAllowPatterns({ workspaceDir: repoAbs, writeScope })
      : []),
    ...buildClaudeMcpPermissionEntries(mcpToolNames)
  ];
  return {
    permissions: {
      allow,
      deny: [
        ...CLAUDE_WORKER_DENY_TOOLS,
        ...(implementationWorker ? [] : CLAUDE_WORKER_DISALLOWED_NATIVE_WRITE_TOOLS)
      ],

      disableBypassPermissionsMode: "disable"
    }
  };
}

export function buildClaudeMcpPermissionEntries(toolNames) {
  return [...new Set(Array.isArray(toolNames) ? toolNames : [])]
    .filter((name) => typeof name === "string" && /^[a-z0-9_]+$/u.test(name))
    .sort()
    .map((name) => `mcp__wiki__${name}`);
}

export const CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON =
  BACKEND_FAMILY_UNAVAILABLE_REASONS.claude;
export const CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH =
  "workspace_agent_dispatch_backend.launch_executors.claude";

export const CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM = true;

export const CLAUDE_COMMAND_LINE_CONTRACT_SCHEMA_VERSION = "claude-command-line.v2";

export const CLAUDE_ARGV_OPTION_TERMINATOR = "--";

export const CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON =
  "claude_command_line_prompt_contract_invalid";

export function composeClaudeArgv({ optionArgs = [], prompt = null } = {}) {
  const options = Array.isArray(optionArgs) ? [...optionArgs] : [];
  if (prompt === null || prompt === undefined) return options;
  return [...options, CLAUDE_ARGV_OPTION_TERMINATOR, prompt];
}

export function verifyClaudeArgvPromptContract({ argv, prompt } = {}) {
  const args = Array.isArray(argv) ? argv : null;
  if (args === null) {
    return { ok: false, detail: { cause: "argv_not_an_array" } };
  }
  if (typeof prompt !== "string" || prompt.length === 0) {
    return {
      ok: false,
      detail: { cause: "prompt_missing", prompt_type: prompt === null ? "null" : typeof prompt }
    };
  }
  for (const entry of args) {
    if (typeof entry !== "string") {
      return { ok: false, detail: { cause: "argv_entry_not_a_string", entry_type: typeof entry } };
    }
  }
  const terminatorCount = args.filter((entry) => entry === CLAUDE_ARGV_OPTION_TERMINATOR).length;
  if (terminatorCount !== 1) {
    return {
      ok: false,
      detail: { cause: "option_terminator_count_invalid", terminators: terminatorCount }
    };
  }
  if (args[args.length - 2] !== CLAUDE_ARGV_OPTION_TERMINATOR) {
    return {
      ok: false,
      detail: {
        cause: "option_terminator_misplaced",
        terminator_index: args.indexOf(CLAUDE_ARGV_OPTION_TERMINATOR),
        args_length: args.length
      }
    };
  }
  if (args[args.length - 1] !== prompt) {
    return { ok: false, detail: { cause: "prompt_not_final_positional" } };
  }

  const occurrences = args.filter((entry) => entry === prompt).length;
  if (occurrences !== 1) {
    return { ok: false, detail: { cause: "prompt_duplicated", occurrences } };
  }
  return { ok: true };
}

export const CLAUDE_WORKER_DISALLOWED_NATIVE_WRITE_TOOLS = Object.freeze([
  "Edit",
  "Write",
  "NotebookEdit"
]);

export const CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON =
  "claude_worker_scratch_unavailable";

export const CLAUDE_WORKER_SCRATCH_DIRNAME = "claude-worker-scratch";

export function defaultReadLauncherOwnedHostHome() {
  return os.userInfo().homedir;
}

export function deriveLauncherOwnedHostHome({
  readHostHome = defaultReadLauncherOwnedHostHome
} = {}) {
  return resolveLauncherOwnedHostHome({
    readHostHome,
    source: "claude_launcher_owned_host_home"
  });
}

export const CLAUDE_CONFIGURED_EXECUTABLE_UNRESOLVABLE_REASON =
  "claude_configured_executable_unresolvable";

export function deriveLauncherOwnedClaudeRuntimeFacts({
  launcherOwnedHostHome,
  configuredExecutable,
  pathEnv = null,
  platform = process.platform === "darwin" ? "darwin" : "linux",
  resolveExecutable = resolveFamilyRuntimeExecutable,

  preResolvedExecutable = false
} = {}) {
  const facts = deriveLauncherRuntimeHomePolicyFacts({
    launcherOwnedHostHome,
    platform
  });
  const familyRuntimePolicyProfile = deriveFamilyRuntimeHomePolicyProfile({ policyFacts: facts });
  if (typeof configuredExecutable !== "string" || configuredExecutable.trim().length === 0) {
    const error = new Error(
      "launcher registry does not declare a Claude executable: "
        + "agents.claude.base_argv[0] must be a non-blank string"
    );
    error.code = CLAUDE_CONFIGURED_EXECUTABLE_UNRESOLVABLE_REASON;
    error.detail = {
      configuration_key: "agents.claude.base_argv[0]",
      received_type: configuredExecutable === null ? "null" : typeof configuredExecutable,
      operator_recovery:
        "run `agent-launch init-config` or set agents.claude.base_argv[0] in "
        + "<workspace>/.agent-launch/launchers.v1.json"
    };
    throw error;
  }

  const resolved = preResolvedExecutable
    ? Object.freeze({
        executablePath: configuredExecutable.trim(),
        realExecutablePath: null,
        isSymlink: false,
        installRoot: null,
        readOnlyRoots: Object.freeze([])
      })
    : resolveExecutable({
        executablePath: configuredExecutable.trim(),
        pathEnv,
        approvedRuntimePrefixes: familyRuntimePolicyProfile.executablePrefixes,
        familyRuntimePolicyProfile,
        label: "claudeConfiguredExecutable"
      });
  return Object.freeze({
    launcherOwnedHostHome: facts.launcherOwnedHostHome,
    configuredExecutable: configuredExecutable.trim(),
    symlink: resolved.executablePath,
    resolvedExecutable: resolved,
    readOnlyRoot: facts.paths.readOnlyRoot,
    credentialsFile: facts.paths.credentialsFile,
    policyFacts: facts,
    familyRuntimePolicyProfile
  });
}

export function resolveLauncherOwnedClaudeRuntimeFacts({
  readHostHome = defaultReadLauncherOwnedHostHome,
  launcherOwnedHostHome,
  configuredExecutable,
  pathEnv = null,
  platform = process.platform === "darwin" ? "darwin" : "linux",
  resolveExecutable = resolveFamilyRuntimeExecutable,
  preResolvedExecutable = false
} = {}) {
  const hostHome = typeof launcherOwnedHostHome === "string"
    ? { ok: true, launcherOwnedHostHome }
    : deriveLauncherOwnedHostHome({ readHostHome });
  if (!hostHome.ok) return hostHome;
  try {
    return {
      ok: true,
      facts: deriveLauncherOwnedClaudeRuntimeFacts({
        launcherOwnedHostHome: hostHome.launcherOwnedHostHome,
        configuredExecutable,
        pathEnv,
        platform,
        resolveExecutable,
        preResolvedExecutable
      })
    };
  } catch (err) {

    const isExecutableFault = typeof err?.code === "string"
      && err.code !== LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON;
    return {
      ok: false,
      reason: isExecutableFault ? err.code : LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      detail: {
        fact: isExecutableFault
          ? "claude_configured_executable"
          : "claude_launcher_owned_host_home",
        failure: isExecutableFault
          ? "claude_configured_executable_invalid"
          : "claude_runtime_facts_invalid",
        launcherOwnedHostHome: hostHome.launcherOwnedHostHome,
        configured_executable: typeof configuredExecutable === "string"
          ? configuredExecutable
          : null,
        message: err?.message ?? String(err),
        code: err?.code ?? null,
        ...(err?.detail && typeof err.detail === "object" ? err.detail : {})
      }
    };
  }
}

const DEFAULT_CLAUDE_RUNTIME_HOME_FACTS = deriveLauncherRuntimeHomePolicyFacts({
  launcherOwnedHostHome: defaultReadLauncherOwnedHostHome(),
  platform: process.platform === "darwin" ? "darwin" : "linux"
});

export const CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS = Object.freeze([
  DEFAULT_CLAUDE_RUNTIME_HOME_FACTS.paths.readOnlyRoot
]);

export const CLAUDE_CREDENTIALS_READ_ONLY_FILE =
  DEFAULT_CLAUDE_RUNTIME_HOME_FACTS.paths.credentialsFile;

export const CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES = Object.freeze([
  CLAUDE_CREDENTIALS_READ_ONLY_FILE
]);

export const CLAUDE_BWRAP_ENV_ALLOWLIST = SHARED_FAMILY_BWRAP_ENV_ALLOWLIST;
export const CLAUDE_BWRAP_ENV_POLICY = Object.freeze({
  allow: CLAUDE_BWRAP_ENV_ALLOWLIST
});

export const CLAUDE_RUNTIME_SETUP_REASONS = Object.freeze({
  PATH_UNREADABLE: "claude_runtime_path_unreadable",
  SYMLINK_TARGET_MISSING: "claude_runtime_symlink_target_missing",
  NOT_FILE: "claude_runtime_not_file",
  NOT_EXECUTABLE: "claude_runtime_not_executable",
  TARGET_REPLACED: "claude_runtime_target_replaced",
  PROBE_THREW: "claude_runtime_probe_threw",
  PROBE_INVALID_RESULT: "claude_runtime_probe_invalid_result"
});

export const CLAUDE_RUNTIME_IDENTITY_SCHEMA_VERSION = "claude-runtime-identity.v1";

export const CLAUDE_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION = "claude-final-message.v1";

const CLAUDE_SCHEMA_CONSTRAINED_TERMINAL_RESULT_ROLES = new Set([
  "worker",
  "reviewer",
  "redteam"
]);

export function makeRefusal(code, reason, detail) {
  const { schema_version: _schemaVersion, ...envelope } = buildRefusalEnvelope({
    code,
    reason,
    detail
  });
  return envelope;
}

export function buildUnavailableRefusal(reasonDetail, probeDetail, extra) {
  return makeRefusal(
    BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
    CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
    {
      app: "claude",
      missing_backend: CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
      reason_detail: reasonDetail,
      probe: probeDetail ?? null,
      ...(extra ?? {})
    }
  );
}

function buildFindingsEnvelope({ text, role, subject, source }) {
  return buildFinalResultEnvelope({
    kind: "findings",
    payload: buildFindingsPayload({
      schemaVersion: CLAUDE_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
      format: "text",
      role,
      subject,
      source,
      text
    })
  });
}

const claudeCredentialsReadOnlyFileGuard = createApprovedReadOnlyFileGuard({
  approvedFiles: CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,
  refusalCode: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  reason: "claude_executor_credentials_path_invalid",
  valueKey: "credentialsReadOnlyFile",
  allowedKey: "allowed_credentials_read_only_files",
  errorClass: BubblewrapIsolationError,
  messagePrefix: "agent-launch isolation: "
});
export const isClaudeCredentialsReadOnlyFileRefusal =
  claudeCredentialsReadOnlyFileGuard.isRefusal;

function buildNoFindingsEnvelope({ reasonLine, text, source }) {
  return buildFinalResultEnvelope({
    kind: "no_findings",
    payload: buildNoFindingsPayload({
      reason: reasonLine,
      format: "text",
      text,
      source
    })
  });
}

export async function defaultProbeClaudeRuntime({
  claudePath,
  fsLstat = lstat,
  fsReadlink = readlink,
  fsStat = stat
} = {}) {

  if (typeof claudePath !== "string" || claudePath.length === 0) {
    return {
      available: false,
      reason: CLAUDE_CONFIGURED_EXECUTABLE_UNRESOLVABLE_REASON,
      detail: {
        symlink_path: null,
        configuration_key: "agents.claude.base_argv[0]",
        received_type: claudePath === null ? "null" : typeof claudePath,
        operator_recovery:
          "set agents.claude.base_argv[0] in <workspace>/.agent-launch/launchers.v1.json"
      }
    };
  }
  const symlinkPath = claudePath;
  const probed = await probeRuntimeSymlink({
    symlinkPath,
    reasons: CLAUDE_RUNTIME_SETUP_REASONS,
    fsLstat,
    fsReadlink,
    fsStat
  });
  if (probed?.available !== true) return probed;
  if (probed.detail?.target_visibility === "deferred_to_worker_bwrap") {
    return {
      available: false,
      reason: CLAUDE_RUNTIME_SETUP_REASONS.SYMLINK_TARGET_MISSING,
      detail: {
        symlink_path: probed.detail.symlink_path ?? symlinkPath,
        target_path: probed.detail.target_path ?? null,
        code: probed.detail.follow_error?.code ?? "ENOENT",
        message: probed.detail.follow_error?.message
          ?? "launcher-owned Claude runtime symlink target is not resolvable on the host",
        operator_recovery:
          "reinstall or repair the Claude runtime so the launcher-owned symlink resolves to a real executable"
      }
    };
  }

  const identity = await readClaudeRuntimeIdentity(symlinkPath, fsStat);
  if (identity === null) {
    return {
      available: false,
      reason: CLAUDE_RUNTIME_SETUP_REASONS.PATH_UNREADABLE,
      detail: { symlink_path: symlinkPath, target_path: probed.detail?.target_path ?? null }
    };
  }
  return {
    ...probed,
    detail: { ...probed.detail, runtime_identity: identity }
  };
}

async function readClaudeRuntimeIdentity(symlinkPath, fsStat) {
  try {
    const stats = await fsStat(symlinkPath);
    if (!stats.isFile()) return null;
    return Object.freeze({
      schema_version: CLAUDE_RUNTIME_IDENTITY_SCHEMA_VERSION,
      dev: Number(stats.dev),
      ino: Number(stats.ino),
      size: Number(stats.size),
      mode: Number(stats.mode) & 0o7777,

      ctime_ms: Number(stats.ctimeMs),
      mtime_ms: Number(stats.mtimeMs)
    });
  } catch {
    return null;
  }
}

export async function verifyClaudeRuntimeIdentityUnchanged({
  claudePath,
  identity,
  fsStat = stat
} = {}) {
  if (!identity || identity.schema_version !== CLAUDE_RUNTIME_IDENTITY_SCHEMA_VERSION) {

    return { ok: true, verified: false };
  }
  const current = await readClaudeRuntimeIdentity(claudePath, fsStat);
  if (current === null) {
    return {
      ok: false,
      reason: CLAUDE_RUNTIME_SETUP_REASONS.SYMLINK_TARGET_MISSING,
      detail: {
        symlink_path: claudePath,
        message: "launcher-selected Claude executable disappeared between probe and spawn"
      }
    };
  }
  if (current.dev !== identity.dev || current.ino !== identity.ino ||
      current.size !== identity.size || current.mode !== identity.mode ||
      current.ctime_ms !== identity.ctime_ms || current.mtime_ms !== identity.mtime_ms) {
    return {
      ok: false,
      reason: CLAUDE_RUNTIME_SETUP_REASONS.TARGET_REPLACED,
      detail: {
        symlink_path: claudePath,
        probed: identity,
        current,
        message: "launcher-selected Claude executable was replaced between probe and spawn"
      }
    };
  }
  return { ok: true, verified: true };
}

export async function defaultCaptureClaudeFinalResult({
  status,
  exit,
  role,
  subject,
  capturedStdout
}) {
  if (typeof capturedStdout !== "string" || capturedStdout.length === 0) {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "claude_stdout_empty",
      {
        status: status ?? null,
        exit_code: exit?.code ?? null,
        exit_signal: exit?.signal ?? null
      }
    );
  }
  if (capturedStdout.trim().length === 0) {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "claude_stdout_blank",
      { bytes: capturedStdout.length }
    );
  }
  const noFindingsLine = detectNoFindingsLine(capturedStdout);
  if (noFindingsLine !== null) {
    return buildNoFindingsEnvelope({
      reasonLine: noFindingsLine,
      text: capturedStdout,
      source: { kind: "claude_stdout", bytes: capturedStdout.length }
    });
  }
  return buildFindingsEnvelope({
    text: capturedStdout,
    role,
    subject,
    source: { kind: "claude_stdout", bytes: capturedStdout.length }
  });
}

export { resolveCanonicalWriteScope };
export function deriveClaudeWritableMountsFromWriteScope(options = {}) {
  return deriveWritableMountsFromWriteScope(options);
}

export function resolveClaudeLauncherRoleWritePosture(role) {
  return resolveLauncherRoleWritePosture({
    role,
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT
  });
}

export function resolveClaudeLauncherWriteScope({
  role,
  writeScope
}) {
  const writePosture = resolveClaudeLauncherRoleWritePosture(role);
  if (
    writePosture.ok === true &&
    writePosture.posture === LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY
  ) {
    const gated = gateRoleWriteScope({
      role: writePosture.role,
      write_scope: writeScope
    });
    return gated.ok ? { ok: true, writeScope: gated.write_scope } : { ok: false, refusal: gated.refusal.refusal };
  }
  return { ok: true, writeScope };
}

export async function mintClaudeWorkerScratchRoot({
  workspaceDir,
  env = process.env,
  ensureRuntimeStateDir = ensureLauncherRuntimeStateDir,
  ensureScratchBaseDir = (dir) => mkdir(dir, { recursive: true }),
  makeScratchDir = mkdtemp
} = {}) {
  let ensured;
  try {
    ensured = await ensureRuntimeStateDir({ workspaceDir, env });
  } catch (err) {
    return {
      ok: false,
      code: CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
      reason: "launcher runtime-state dir probe threw while minting worker scratch",
      detail: { message: err?.message ?? String(err), code: err?.code ?? null }
    };
  }
  if (!ensured || ensured.ok !== true || typeof ensured.dir !== "string" || ensured.dir.length === 0) {
    return {
      ok: false,
      code: CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
      reason: "launcher runtime-state dir unavailable; cannot mint worker scratch",
      detail: {
        runtime_state_code: ensured?.code ?? null,
        runtime_state_reason: ensured?.reason ?? null,
        runtime_state_dir: ensured?.dir ?? null
      }
    };
  }
  const scratchBase = path.join(ensured.dir, CLAUDE_WORKER_SCRATCH_DIRNAME);
  let scratchRoot;
  try {

    await ensureScratchBaseDir(scratchBase);
    scratchRoot = await makeScratchDir(path.join(scratchBase, "run-"));
  } catch (err) {
    return {
      ok: false,
      code: CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
      reason: "launcher could not mint a per-run worker scratch directory",
      detail: { scratchBase, message: err?.message ?? String(err), code: err?.code ?? null }
    };
  }

  if (
    typeof workspaceDir === "string" &&
    workspaceDir.length > 0 &&
    isWithinRepo(scratchRoot, path.resolve(workspaceDir))
  ) {
    return {
      ok: false,
      code: CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
      reason: "minted worker scratch resolved inside the repo write root",
      detail: { scratchRoot, workspaceDir }
    };
  }
  return { ok: true, scratchRoot };
}

export function deriveClaudeSettingsMaskDirs({
  workspaceDir,
  managedSettingsDir = CLAUDE_MANAGED_SETTINGS_DIR,
  pathExists = existsSync
} = {}) {
  const dirs = [];
  if (typeof workspaceDir === "string" && workspaceDir.length > 0) {
    const repoClaude = path.join(path.resolve(workspaceDir), CLAUDE_REPO_SETTINGS_DIR_NAME);
    if (pathExists(repoClaude)) dirs.push(repoClaude);
  }
  if (typeof managedSettingsDir === "string" && managedSettingsDir.length > 0 && pathExists(managedSettingsDir)) {
    dirs.push(managedSettingsDir);
  }
  return dirs;
}

export function defaultBuildClaudeBwrapPlan({
  command,
  args,
  workspaceDir,
  env,

  writeScope = [],

  runtimeRoots = [],

  readOnlyRoots = [],
  gitMetadataProjection = null,
  provisionedWorktreeGitIdentity = null,
  stdioMcpConduit = null,

  workerScopeAuthority = null,
  workerTestRuntime = null,

  launchRole = null,
  familyRuntimeReadOnlyRoots = CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS,
  familyRuntimeMountPrefixes = null,
  familyRuntimePolicyProfile = null,
  resolveExecutable = resolveFamilyRuntimeExecutable,

  credentialsReadOnlyFile = CLAUDE_CREDENTIALS_READ_ONLY_FILE,
  approvedCredentialsReadOnlyFiles = CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,

  credentialsWritable = true,

  nativeRepoWriteMechanism = CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,

  deriveWritableMounts = workerScopeAuthority !== null
    ? ({ workspaceDir: dir }) => deriveWritableMountsFromResolvedScope({
        workspaceDir: dir, resolvedScope: workerScopeAuthority.resolved_scope
      })
    : nativeRepoWriteMechanism
      ? deriveDirectoryScopedWritableMountsFromWriteScope
      : deriveWritableMountsFromWriteScope
}) {

  const credentialGuard = approvedCredentialsReadOnlyFiles === CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES
    ? claudeCredentialsReadOnlyFileGuard
    : createApprovedReadOnlyFileGuard({
        approvedFiles: approvedCredentialsReadOnlyFiles,
        refusalCode: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: "claude_executor_credentials_path_invalid",
        valueKey: "credentialsReadOnlyFile",
        allowedKey: "allowed_credentials_read_only_files",
        errorClass: BubblewrapIsolationError,
        messagePrefix: "agent-launch isolation: "
      });
  const approvedCredentialsReadOnlyFile = credentialGuard.assertAllowed(credentialsReadOnlyFile);

  const homePolicy = approvedCredentialsReadOnlyFile !== null
    ? credentialsWritable === true
      ? {
          writableFiles: [{
            src: approvedCredentialsReadOnlyFile,
            dst: approvedCredentialsReadOnlyFile
          }]
        }
      : {
          reads: [{
            src: approvedCredentialsReadOnlyFile,
            dst: approvedCredentialsReadOnlyFile
          }]
        }
    : null;

  return buildFamilyExecutorBwrapPlan({
    command,
    args,
    workspaceDir,
    env,
    writeScope,
    runtimeRoots,
    readOnlyRoots,
    gitMetadataProjection,
    provisionedWorktreeGitIdentity,
    stdioMcpConduit,
    workerScopeAuthority,
    workerTestRuntime,
    launchRole,

    additionalMaskTmpfsDirs: deriveClaudeSettingsMaskDirs({ workspaceDir }),
    envPolicy: CLAUDE_BWRAP_ENV_POLICY,
    familyRuntimeReadOnlyRoots,
    familyRuntimeMountPrefixes,
    familyRuntimePolicyProfile,
    homePolicy,
    executableLabel: "claudeExecutable",
    shareNet: true,
    resolveExecutable,
    mergeRuntimeReadOnlyRoots: mergeFamilyRuntimeReadOnlyRoots,
    deriveWritableMounts,
    buildBubblewrapLaunchPlan,

    buildCommandResolution: buildFamilyRuntimeCommandResolution
  });
}

export function createDefaultClaudeBwrapIsolatedSpawn({
  buildBwrapPlan = defaultBuildClaudeBwrapPlan,
  spawnIsolated = defaultSpawnIsolated,
  familyRuntimeReadOnlyRoots = CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS,
  familyRuntimePolicyProfile = null,
  credentialsReadOnlyFile = CLAUDE_CREDENTIALS_READ_ONLY_FILE,
  approvedCredentialsReadOnlyFiles = CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES
} = {}) {
  return function bwrapIsolatedSpawn(command, args, opts) {
    const workspaceDir = typeof opts?.cwd === "string" && opts.cwd.length > 0
      ? opts.cwd
      : null;

    const gitMetadataProjection = opts?.advisoryReviewInput === null ||
      opts?.advisoryReviewInput === undefined
      ? null
      : resolveAdvisoryReviewGitMetadataProjection(opts.advisoryReviewInput);
    const plan = buildBwrapPlan({
      command,
      args: Array.isArray(args) ? args : [],
      workspaceDir,
      env: opts?.env ?? null,

      writeScope: Array.isArray(opts?.writeScope) ? opts.writeScope : [],

      runtimeRoots: Array.isArray(opts?.runtimeRoots) ? opts.runtimeRoots : [],
      readOnlyRoots: Array.isArray(opts?.readOnlyRoots) ? opts.readOnlyRoots : [],
      gitMetadataProjection,
      provisionedWorktreeGitIdentity:
        opts?.provisionedWorktreeGitIdentity ?? opts?.provisionedWorktreeGitBinding ?? null,
      stdioMcpConduit: opts?.stdioMcpConduit ?? null,

      workerScopeAuthority: opts?.workerScopeAuthority ?? null,
      workerTestRuntime: opts?.workerTestRuntime ?? null,

      launchRole: opts?.launchRole ?? null,
      nativeRepoWriteMechanism: opts?.nativeRepoWriteMechanism ?? CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
      familyRuntimeReadOnlyRoots,
      credentialsReadOnlyFile,
      approvedCredentialsReadOnlyFiles,
      credentialsWritable: opts?.credentialsWritable !== false,
      familyRuntimePolicyProfile
    });

    opts?.attemptResources?.adopt(plan);
    if (gitMetadataProjection !== null) {
      assertGitMetadataProjectionComposed(plan, { checkout: gitMetadataProjection.checkout });
    }
    return spawnIsolated(plan, {
      env: opts?.env,
      stdio: opts?.stdio,
      detached: false
    });
  };
}

export function buildClaudeEffortArgs({
  role,
  model,
  workspaceDir
} = {}) {
  const selectedModel = typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : null;
  const resolvedModel = selectedModel
    ? { ok: true, model: selectedModel }
    : resolveDispatchedRoleModel({
        role,
        dir: workspaceDir
      });
  if (!resolvedModel.ok) {
    return [];
  }
  const effortResolution = resolveEffectiveRoleEffort({
    role,
    selectedModel: resolvedModel.model,
    dir: workspaceDir
  });
  if (!effortResolution.ok) {
    return [];
  }
  const mapped = neutralEffortMapping({
    family: "claude",
    effort: effortResolution.effort
  });
  const effort = mapped?.output_config?.effort;
  return typeof effort === "string" && effort.length > 0
    ? ["--effort", effort]
    : [];
}

export function defaultBuildClaudeCommandLine({
  claudePath,
  role,
  subject,
  prompt,
  model,
  workspaceDir,

  acceptanceCriteria = [],
  acceptanceValidation = [],

  canonicalRepo = null,

  nativeRepoWriteMechanism = CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  schemaConstrainedTerminalResult = false,

  claudeSettingsPath = null,
  supplementalInstructions = null
}) {

  const roleCheck = validateLauncherFamilyRole(role);
  if (!roleCheck.ok) {
    throw new LauncherRoleContractError(
      roleCheck.kind === "missing"
        ? "launcher role contract requires a role"
        : `launcher role contract does not support role: ${role}`,
      {
        code: roleCheck.kind === "missing" ? "role_required" : "role_unsupported",
        detail: { role: role ?? null, allowed: roleCheck.allowed ?? null }
      }
    );
  }

  const writePosture = resolveClaudeLauncherRoleWritePosture(role);
  const constrained =
    schemaConstrainedTerminalResult === true &&
    CLAUDE_SCHEMA_CONSTRAINED_TERMINAL_RESULT_ROLES.has(role);
  const args = ["--print"];
  const assignedWriteWorker =
    writePosture.ok === true &&
    writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE;
  const disallowedTools = [
    ...CLAUDE_WORKER_DENY_TOOLS,
    ...(!assignedWriteWorker || !nativeRepoWriteMechanism
      ? CLAUDE_WORKER_DISALLOWED_NATIVE_WRITE_TOOLS
      : [])
  ];
  if (disallowedTools.length > 0) {
    args.push("--disallowedTools", ...new Set(disallowedTools));
  }
  if (
    assignedWriteWorker &&
    !nativeRepoWriteMechanism
  ) {

  }
  if (
    writePosture.ok === true &&
    writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
    nativeRepoWriteMechanism
  ) {

  }
  if (role === "worker" || role === "reviewer" || role === "redteam") {
    args.push("--permission-mode", "default");
  }
  if (typeof claudeSettingsPath === "string" && claudeSettingsPath.length > 0) {
    args.push("--settings", claudeSettingsPath);
  }
  args.push("--output-format", "text");
  if (constrained) {

    args.push("--json-schema", resolveAgentRoleResultSchemaJson());
  }

  const modelDisposition = resolveFamilyModelDisposition({
    model,
    isModelSupported: () => true
  });
  args.push(...buildFamilyModelFlagArgs({
    disposition: modelDisposition.disposition,
    model: modelDisposition.model,
    flag: "--model"
  }));
  args.push(...buildClaudeEffortArgs({
    role,
    model: modelDisposition.model,
    workspaceDir
  }));

  const baseText = typeof prompt === "string" && prompt.length > 0
    ? prompt
    : renderLauncherFamilyRoleContract({
        role,
        subject,
        workspaceDir,
        acceptanceCriteria,
        acceptanceValidation,
        canonicalRepo,

        terminalStructuredRoleResultMode: resolveTerminalStructuredRoleResultMode({
          schemaConstrained: constrained,
          role
        })
      });
  const text = typeof supplementalInstructions === "string" && supplementalInstructions.length > 0
    ? `${baseText}\n\n${supplementalInstructions}`
    : baseText;

  const argv = composeClaudeArgv({ optionArgs: args, prompt: text });
  return Object.freeze({
    command: claudePath,
    args: argv,
    optionArgs: Object.freeze([...args]),
    prompt: text,
    promptIndex: argv.length - 1,
    commandLineContract: CLAUDE_COMMAND_LINE_CONTRACT_SCHEMA_VERSION
  });
}
