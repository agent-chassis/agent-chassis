import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { buildOpenCodeNativeConfiguration } from "./workspace-agent-opencode-launch-preflight.mjs";
import { buildFamilyExecutorBwrapPlan } from "./workspace-agent-family-bwrap-plan.mjs";
import { buildBubblewrapLaunchPlan, mergeFamilyRuntimeReadOnlyRoots,
  buildFamilyRuntimeCommandResolution } from "./launch-isolation.mjs";
import { resolveAdvisoryReviewGitMetadataProjection } from "./workspace-agent-advisory-review-contract.mjs";
import { consumeAdvisoryExecutionSubstrate } from "./workspace-agent-advisory-execution-substrate.mjs";
import { deriveWritableMountsFromWriteScope, deriveWritableMountsFromResolvedScope } from "./workspace-agent-write-scope.mjs";
import { SHARED_FAMILY_BWRAP_ENV_ALLOWLIST } from "./workspace-agent-launch-core.mjs";
import { createLauncherNativePermissionFacts } from "./workspace-agent-native-permission-facts.mjs";

export async function buildOpenCodeRuntime({ prepared, conduit, env, retainedStateRoot = null,
  workerScopeAuthority = null, responseStateDir = null, managedWorktreeRoot = null }) {
  const root = await mkdtemp(path.join(prepared.runtimeStateDir, "opencode-"));
  const configRoot = path.join(root, "config");
  const stateRoot = retainedStateRoot ?? path.join(root, "state");
  const configFile = path.join(configRoot, "opencode.json");
  for (const dir of [path.join(configRoot, "opencode"), ...["home", "data", "state", "cache"]
    .map(name => path.join(stateRoot, name))]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(configRoot, "opencode", ".gitignore"),
    "node_modules\npackage.json\npackage-lock.json\nbun.lock\nbun.lockb\n.gitignore\n", { mode: 0o600 });
  const config = buildOpenCodeNativeConfiguration({ conduitBinding: conduit, model: prepared.model,
    guideDelivery: prepared.guideDelivery, effort: prepared.effort, opencode: prepared.opencode,
    permissionFacts: createLauncherNativePermissionFacts({ ...prepared.nativePermissionContext,
      workerScopeAuthority, responseStateDir, managedWorktreeRoot, mcpToolNames: conduit.toolNames }) });
  await writeFile(configFile, JSON.stringify({ ...config,
    ...(prepared.provider === null ? {} : { provider: { ...config.provider, ...prepared.provider } }) }), { mode: 0o600 });
  const controls = { OPENCODE_CONFIG: configFile, OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true",
    ...(prepared.commandLine.nativePrompt === undefined ? {} : {
      OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("hex"), OPENCODE_SERVER_USERNAME: "opencode" }) };
  return { configRoot, stateRoot, env: { ...env, ...controls, HOME: path.join(stateRoot, "home"),
    XDG_CONFIG_HOME: configRoot, XDG_DATA_HOME: path.join(stateRoot, "data"),
    XDG_STATE_HOME: path.join(stateRoot, "state"), XDG_CACHE_HOME: path.join(stateRoot, "cache") },
    envPolicy: { allow: [...SHARED_FAMILY_BWRAP_ENV_ALLOWLIST, ...Object.keys(controls)] },

    masks: existsSync("/etc/opencode") ? ["/etc/opencode"] : [] };
}

export function buildOpenCodeBwrapPlan({ input, prepared, runtime, conduit, scope, gitBinding,
  advisory, workerTestRuntime }) {
  return buildFamilyExecutorBwrapPlan({ command: prepared.commandLine.command, args: prepared.commandLine.args,
    workspaceDir: input.workspace_dir, env: runtime.env, envPolicy: runtime.envPolicy, writeScope: [],
    runtimeRoots: [runtime.stateRoot], readOnlyRoots: [runtime.configRoot,
      ...(advisory === null ? [] : consumeAdvisoryExecutionSubstrate(advisory).read_only_binds)],
    additionalMaskTmpfsDirs: runtime.masks,
    homePolicy: { reads: prepared.credentialsFile === null ? [] : [prepared.credentialsFile] },
    workerScopeAuthority: scope, workerTestRuntime, provisionedWorktreeGitBinding: gitBinding,
    familyRuntimeReadOnlyRoots: prepared.runtimeReadOnlyRoots,
    gitMetadataProjection: advisory === null ? null : resolveAdvisoryReviewGitMetadataProjection(advisory),
    stdioMcpConduit: conduit, launchRole: input.role, familyRuntimePolicyProfile: prepared.profile,
    executableLabel: "opencodeExecutable", shareNet: true,
    resolveExecutable: () => prepared.executable, mergeRuntimeReadOnlyRoots: mergeFamilyRuntimeReadOnlyRoots,
    deriveWritableMounts: scope === null ? deriveWritableMountsFromWriteScope
      : () => deriveWritableMountsFromResolvedScope({ workspaceDir: input.workspace_dir, resolvedScope: scope.resolved_scope }),
    buildBubblewrapLaunchPlan,
    buildCommandResolution: buildFamilyRuntimeCommandResolution });
}
