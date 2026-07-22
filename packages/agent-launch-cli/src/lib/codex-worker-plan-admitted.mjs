import path from "node:path";

import { WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION } from "@agent-chassis/agent-launch-core";
import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
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
  injectCodexConfigOverridesBeforeFinalPositional,
  quoteTomlString,
  resolveWikiMcpServerPath
} from "./codex-role-mcp-env.mjs";
import {
  buildCodexWikiMcpServerOverrides,
  rebuildCodexPlanIsolationWithReadOnlyRoot
} from "./codex-role-wiki-mcp-override.mjs";
import {
  composeManagedRoleWikiMcpRuntimeManifest,
  preflightManagedRoleWikiMcpRuntime,
  rewriteManagedRoleLauncherArtifactArgs
} from "./managed-role-wiki-mcp-runtime-snapshot.mjs";

import { resolveDispatchedRoleModel } from "./agent-launch-profiles.mjs";
import {
  buildModelUnsetRefusal
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

export async function buildAdmittedCodexWorkerPlan({
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
  serverOwnedSliceBinding,
  hostWriteAuthorityEndpoint,
  serverProvisionedWorktreeGitBinding,
  remoteAdmissionProvenance,
  buildCodexWritableSandboxArgs,
  buildHeadlessPlan,
  ROLE_CONFIG
}) {

  let callableSourceToolSurface = null;
  let preparedNewWriteRoots = [];
  let isolationWritableProjectRoots = [];
  let isolationWritableFiles = [];
  let sandboxArgs = [];
  if (isSourceToolSurfaceNotConfigured(sourceToolSurface)) {

    const writeScope = frozenWorkerScopeAuthority?.write_scope
      ?? gate.launch_packet.canonical_summary.write_scope;
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

  const managedGitlessRepoCheckSkip = managedWorkerCommitRequired
    ? ["--skip-git-repo-check"]
    : [];
  const baseArgs = [
    "--disable", "shell_snapshot",
    "-C", repo,
    ...sandboxArgs,
    "-a", "never",
    "-p", profile,
    "exec",
    ...managedGitlessRepoCheckSkip,
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
    writableFiles: isolationWritableFiles,
    workerScopeAuthority: frozenWorkerScopeAuthority,
    workerWikiMcpAssignedUnit: wk,
    managedWorker: managedWorkerCommitRequired,
    workerWikiMcpWorktreeProvisioning: worktree_provisioning,
    workerWikiMcpSliceBinding: serverOwnedSliceBinding,

    workerWikiMcpHostWriteEndpoint: managedWorkerCommitRequired ? hostWriteAuthorityEndpoint : null
  });
  headlessPlan.preparedNewWriteRoots = preparedNewWriteRoots;

  headlessPlan.sourceToolSurface = callableSourceToolSurface ?? sourceToolSurface;
  headlessPlan.worker_scope_authority = frozenWorkerScopeAuthority;
  headlessPlan.worktree_provisioning = worktree_provisioning;
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

  const managedRuntimeManifest = await composeManagedRoleWikiMcpRuntimeManifest({
    confined: managedWorkerCommitRequired === true
      && Boolean(headlessPlan && headlessPlan.isolation)
      && Array.isArray(headlessPlan.args),
    role: "worker",
    serverPath: wikiMcpServerPath,
    buildServerOverrides: (entrypoint) =>
      buildCodexWikiMcpServerOverrides({ serverPath: entrypoint, repo })
  });
  if (managedRuntimeManifest !== null) {
    injectCodexConfigOverridesBeforeFinalPositional(
      headlessPlan.args,
      managedRuntimeManifest.config_overrides
    );
    rebuildCodexPlanIsolationWithReadOnlyRoot(
      headlessPlan,
      managedRuntimeManifest.read_only_roots
    );

    const artifactRouting = rewriteManagedRoleLauncherArtifactArgs({
      plan: headlessPlan,
      manifest: managedRuntimeManifest
    });

    const preflight = await preflightManagedRoleWikiMcpRuntime({
      plan: headlessPlan,
      manifest: managedRuntimeManifest,
      role: "worker",
      assignedUnit: wk
    });
    headlessPlan.managed_wiki_mcp_runtime = Object.freeze({
      schema_version: managedRuntimeManifest.schema_version,
      commit: managedRuntimeManifest.commit,
      digest: managedRuntimeManifest.digest,
      staged_root: managedRuntimeManifest.snapshot.staged_root,
      entrypoint: managedRuntimeManifest.snapshot.entrypoint,
      artifact_routing: artifactRouting,
      preflight
    });
  } else if (Array.isArray(headlessPlan.args)) {

    injectCodexConfigOverridesBeforeFinalPositional(
      headlessPlan.args,
      buildCodexWikiMcpServerOverrides({ serverPath: wikiMcpServerPath, repo })
    );
  }
  if (remoteAdmissionProvenance) {
    headlessPlan.workerAdmissionRemote = remoteAdmissionProvenance;
  }
  return headlessPlan;
}
