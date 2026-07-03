

import { existsSync } from "node:fs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function readSearchPathFromEnv(env) {
  const envPath = env && typeof env === "object" ? env.PATH : null;
  return typeof envPath === "string" && envPath.length > 0 ? envPath : null;
}

export function deriveFamilyWritableMountsFromWriteScope({
  workspaceDir,
  writeScope = [],
  deriveWritableMounts
} = {}) {
  if (typeof deriveWritableMounts !== "function") {
    throw new TypeError(
      "deriveFamilyWritableMountsFromWriteScope requires an injected deriveWritableMounts function"
    );
  }
  const result = deriveWritableMounts({
    workspaceDir,
    writeScope: asArray(writeScope)
  });
  return {
    writableRoots: asArray(result?.writableRoots),
    writableFiles: asArray(result?.writableFiles)
  };
}

export function buildFamilyExecutorBwrapPlan({
  command,
  args,
  workspaceDir,
  env,
  writeScope = [],

  runtimeRoots = [],
  readOnlyRoots = [],

  additionalMaskTmpfsDirs = [],
  envPolicy = null,
  familyRuntimeReadOnlyRoots = [],
  familySystemReadOnlyRoots = null,
  familyRuntimeWritableRoots = null,
  familyRuntimeMountPrefixes = undefined,
  familyRuntimePolicyProfile = null,
  homePolicy = null,
  executableLabel,
  shareNet = undefined,
  resolveExecutable,
  mergeRuntimeReadOnlyRoots,
  deriveWritableMounts,
  buildBubblewrapLaunchPlan,
  buildCommandResolution = () => null
} = {}) {
  if (typeof resolveExecutable !== "function") {
    throw new TypeError(
      "buildFamilyExecutorBwrapPlan requires an injected resolveExecutable function"
    );
  }
  if (typeof mergeRuntimeReadOnlyRoots !== "function") {
    throw new TypeError(
      "buildFamilyExecutorBwrapPlan requires an injected mergeRuntimeReadOnlyRoots function"
    );
  }
  if (typeof buildBubblewrapLaunchPlan !== "function") {
    throw new TypeError(
      "buildFamilyExecutorBwrapPlan requires an injected buildBubblewrapLaunchPlan function"
    );
  }

  const resolverPathEnv = readSearchPathFromEnv(env);
  const approvedRuntimePrefixes = Array.isArray(familyRuntimePolicyProfile?.executablePrefixes)
    ? familyRuntimePolicyProfile.executablePrefixes
    : undefined;
  const resolved = resolveExecutable({
    executablePath: command,
    pathEnv: resolverPathEnv,
    approvedRuntimePrefixes,
    familyRuntimePolicyProfile,
    label: executableLabel
  });
  const mergedFamilyRuntimeReadOnlyRoots = mergeRuntimeReadOnlyRoots(
    familyRuntimeReadOnlyRoots,
    resolved?.readOnlyRoots
  );

  const commandResolution = buildCommandResolution(resolved) ?? null;

  const { writableRoots, writableFiles } = deriveFamilyWritableMountsFromWriteScope({
    workspaceDir,
    writeScope,
    deriveWritableMounts
  });
  const workerSecretMaskInputs = buildWorkerSecretMaskInputs({ workspaceDir });

  return buildBubblewrapLaunchPlan({
    repo: workspaceDir,
    command,
    args,
    cwd: workspaceDir,
    env: env ?? null,
    envPolicy,
    readOnlyRoots: [...workerSecretMaskInputs.readOnlyRoots, ...asArray(readOnlyRoots)],
    maskTmpfsDirs: [...workerSecretMaskInputs.maskTmpfsDirs, ...asArray(additionalMaskTmpfsDirs)],
    writableRoots,
    writableFiles,
    runtimeRoots: asArray(runtimeRoots),
    familyRuntimeReadOnlyRoots: mergedFamilyRuntimeReadOnlyRoots,
    familySystemReadOnlyRoots,
    familyRuntimeWritableRoots,
    familyRuntimeMountPrefixes,
    familyRuntimePolicyProfile,
    homePolicy,
    commandResolution,
    shareNet
  });
}

export const DEFAULT_VALIDATION_ENV_ALLOWLIST = Object.freeze(["PATH", "HOME", "TMPDIR"]);
export const VALIDATION_EPHEMERAL_TMPDIR = "/agent-validation-tmp";
export const DEFAULT_AGENT_LAUNCH_DIR_NAME = ".agent-launch";
export const DEFAULT_REPO_ENV_FILE_NAME = ".env";
const VALIDATION_SECRET_MASK_SOURCE = "/dev/null";
export const WORKER_SECRET_MASK_SOURCE = "/dev/null";

function joinRepoChild(repo, name) {
  if (typeof repo !== "string" || repo.length === 0) {
    throw new TypeError(
      "joinRepoChild requires a non-empty workspaceDir string"
    );
  }
  return repo.endsWith("/") ? `${repo}${name}` : `${repo}/${name}`;
}

export function buildWorkerSecretMaskInputs({
  workspaceDir,
  agentLaunchDirName = DEFAULT_AGENT_LAUNCH_DIR_NAME,
  envFileName = DEFAULT_REPO_ENV_FILE_NAME,
  envFileExists = existsSync
} = {}) {
  const envFilePath = joinRepoChild(workspaceDir, envFileName);
  const agentLaunchPath = joinRepoChild(workspaceDir, agentLaunchDirName);
  const envMaskBinds = envFileExists(envFilePath)
    ? [Object.freeze({ src: WORKER_SECRET_MASK_SOURCE, dst: envFilePath })]
    : [];
  return Object.freeze({
    readOnlyRoots: Object.freeze(envMaskBinds),
    maskTmpfsDirs: Object.freeze([agentLaunchPath])
  });
}

export function buildValidationConfinementPlan({
  workspaceDir,
  command,
  args = [],
  env = null,
  envAllowlist = DEFAULT_VALIDATION_ENV_ALLOWLIST,
  ephemeralTmpdir = VALIDATION_EPHEMERAL_TMPDIR,
  agentLaunchDirName = DEFAULT_AGENT_LAUNCH_DIR_NAME,
  envFileName = DEFAULT_REPO_ENV_FILE_NAME,
  envFileExists = existsSync,
  buildBubblewrapLaunchPlan
} = {}) {
  if (typeof buildBubblewrapLaunchPlan !== "function") {
    throw new TypeError(
      "buildValidationConfinementPlan requires an injected buildBubblewrapLaunchPlan function"
    );
  }

  const allowlist = asArray(envAllowlist).filter(
    (name) => typeof name === "string" && name.length > 0
  );
  const envValues = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  const mintedEnv = {};
  for (const name of allowlist) {
    if (name === "TMPDIR") continue;
    if (typeof envValues[name] === "string") {
      mintedEnv[name] = envValues[name];
    }
  }
  mintedEnv.TMPDIR = ephemeralTmpdir;
  const allowWithTmpdir = allowlist.includes("TMPDIR")
    ? allowlist
    : [...allowlist, "TMPDIR"];

  const envFilePath = joinRepoChild(workspaceDir, envFileName);
  const agentLaunchPath = joinRepoChild(workspaceDir, agentLaunchDirName);

  return buildBubblewrapLaunchPlan({
    repo: workspaceDir,
    command,
    args: asArray(args),
    cwd: workspaceDir,

    readOnlyRoots: envFileExists(envFilePath)
      ? [{ src: VALIDATION_SECRET_MASK_SOURCE, dst: envFilePath }]
      : [],

    maskTmpfsDirs: [agentLaunchPath],

    tmpfsDirs: [ephemeralTmpdir],

    shareNet: false,

    env: mintedEnv,
    envPolicy: { allow: allowWithTmpdir }
  });
}
