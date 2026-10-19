import { mkdir, mkdtemp, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildAgyNativeConfiguration } from "./workspace-agent-agy-launch-preflight.mjs";
import { buildFamilyExecutorBwrapPlan } from "./workspace-agent-family-bwrap-plan.mjs";
import { buildBubblewrapLaunchPlan, mergeFamilyRuntimeReadOnlyRoots,
  buildFamilyRuntimeCommandResolution } from "./launch-isolation.mjs";
import { resolveAdvisoryReviewGitMetadataProjection } from "./workspace-agent-advisory-review-contract.mjs";
import { consumeAdvisoryExecutionSubstrate } from "./workspace-agent-advisory-execution-substrate.mjs";
import { deriveWritableMountsFromWriteScope, deriveWritableMountsFromResolvedScope } from "./workspace-agent-write-scope.mjs";
import { SHARED_FAMILY_BWRAP_ENV_ALLOWLIST } from "./workspace-agent-launch-core.mjs";

export async function buildAgyRuntime({ prepared, conduit, env, retainedStateRoot = null }) {
  const root = await mkdtemp(path.join(prepared.runtimeStateDir, "agy-"));
  const configRoot = path.join(root, "home");
  const stateRoot = retainedStateRoot ?? path.join(root, "native");
  const config = path.join(configRoot, ".gemini/config");
  for (const dir of [config, stateRoot, path.join(stateRoot, "projects"), path.join(stateRoot, "cache")]) await mkdir(dir, { recursive: true, mode: 0o700 });
  if (prepared.nativeOnboarding !== null) await writeFile(path.join(stateRoot, "cache/onboarding.json"),
    JSON.stringify(prepared.nativeOnboarding), { mode: 0o600 });
  if (retainedStateRoot === null) await symlink(prepared.credentialsFile, path.join(stateRoot, "antigravity-oauth-token"));
  await symlink(stateRoot, path.join(configRoot, ".gemini/antigravity-cli"));
  await symlink(path.join(stateRoot, "projects"), path.join(config, "projects"));
  await writeFile(path.join(config, "mcp_config.json"), JSON.stringify(buildAgyNativeConfiguration({ conduitBinding: conduit })), { mode: 0o600 });
  await writeFile(path.join(configRoot, ".gemini/GEMINI.md"), prepared.guide, { mode: 0o600 });
  return { configRoot, stateRoot, env: { ...env, HOME: configRoot, XDG_CONFIG_HOME: path.join(configRoot, ".config"),
    XDG_DATA_HOME: path.join(stateRoot, "data"), XDG_STATE_HOME: stateRoot, XDG_CACHE_HOME: path.join(stateRoot, "cache") },
    envPolicy: { allow: [...SHARED_FAMILY_BWRAP_ENV_ALLOWLIST] },
    masks: [".agents", ".agent", ".gemini"].map(name => path.join(prepared.workspaceDir, name)).filter(existsSync) };
}

export function buildAgyBwrapPlan({ input, prepared, runtime, conduit, scope, gitBinding,
  advisory, workerTestRuntime }) {
  return buildFamilyExecutorBwrapPlan({ command: prepared.commandLine.command, args: prepared.commandLine.args,
    workspaceDir: input.workspace_dir, env: runtime.env, envPolicy: runtime.envPolicy, writeScope: [],
    runtimeRoots: [runtime.stateRoot], readOnlyRoots: [runtime.configRoot,
      ...(advisory === null ? [] : consumeAdvisoryExecutionSubstrate(advisory).read_only_binds)],
    additionalMaskTmpfsDirs: runtime.masks,
    homePolicy: { reads: [prepared.credentialsFile] },
    workerScopeAuthority: scope, workerTestRuntime, provisionedWorktreeGitBinding: gitBinding,
    gitMetadataProjection: advisory === null ? null : resolveAdvisoryReviewGitMetadataProjection(advisory),
    stdioMcpConduit: conduit, launchRole: input.role, familyRuntimePolicyProfile: prepared.profile,
    executableLabel: "agyExecutable", shareNet: true,
    resolveExecutable: () => prepared.executable, mergeRuntimeReadOnlyRoots: mergeFamilyRuntimeReadOnlyRoots,
    deriveWritableMounts: scope === null ? deriveWritableMountsFromWriteScope
      : () => deriveWritableMountsFromResolvedScope({ workspaceDir: input.workspace_dir, resolvedScope: scope.resolved_scope }),
    buildBubblewrapLaunchPlan,
    buildCommandResolution: buildFamilyRuntimeCommandResolution });
}
