import { CONTROLLED_ACCEPTANCE_PUBLICATION_ENV, resolveControlledAcceptancePublication } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveSessionProfileForEnv } from "@agent-chassis/wiki-core/src/lib/tool-discovery/session-profile.mjs";
import { bootstrapNodeEngineEnvFromFile, NODE_ENGINE_BOOTSTRAP_ENV_KEYS } from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";
import { mcpMetricsServerEnv } from "./mcp-metrics-config.mjs";
import { nativeUsageTaskEnv } from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";
import { projectHostTestEnvironment } from "./launch-isolation-env-policy.mjs";
import { STDIO_MCP_READY_FD } from "./stdio-mcp-conduit-contract.mjs";
import { isTrustedStdioMcpConduitAuthority } from "./stdio-mcp-conduit-authority.mjs";
import { STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR, resolveStdioMcpTranscriptCaptureRoot } from "./stdio-mcp-transcript-capture.mjs";
import { FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR } from "@agent-chassis/wiki-core/src/lib/frozen-review-contract-query.mjs";
import { MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR } from "./managed-assignment-read-artifact.mjs";

function transcriptCaptureServerEnv() {
  const resolved = resolveStdioMcpTranscriptCaptureRoot();
  return resolved.root === null
    ? {}
    : { [STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR]: resolved.root };
}

export function buildServerEnv(input, role, {
  frozenReviewContractArtifactPath = null,
  managedAssignmentArtifactPath = null,
  reviewerCredential = null
} = {}) {

  const reviewMaterializationDir = isTrustedStdioMcpConduitAuthority(input.authority)
    ? input.authority.reviewMaterializationDir
    : null;
  const env = {
    ...projectHostTestEnvironment(process.env),
    ...(process.env[CONTROLLED_ACCEPTANCE_PUBLICATION_ENV] === undefined ? {}
      : { [CONTROLLED_ACCEPTANCE_PUBLICATION_ENV]: process.env[CONTROLLED_ACCEPTANCE_PUBLICATION_ENV] }),
    ...transcriptCaptureServerEnv(),

    ...mcpMetricsServerEnv(),

    ...nativeUsageTaskEnv(),

    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "1",
    WIKI_MCP_TOOL_PROFILE: role,
    WIKI_MCP_ASSIGNED_UNIT: input.assignedUnit,
    WIKI_MCP_WORKSPACE_DIR: input.workspaceDir,
    WIKI_MCP_LAUNCHER_READY_FD: String(STDIO_MCP_READY_FD)
  };
  if (typeof input.workspaceAlias === "string" && input.workspaceAlias.length > 0) {
    env.WIKI_MCP_WORKSPACE_ALIAS = input.workspaceAlias;
  }
  if (typeof input.dispatchWorktreeRoot === "string" && input.dispatchWorktreeRoot.length > 0) {
    env.WIKI_MCP_DISPATCH_WORKTREE_ROOT = input.dispatchWorktreeRoot;
  }
  if (typeof input.responseStateDir === "string" && input.responseStateDir.length > 0) {
    env.WIKI_MCP_RESPONSE_STATE_DIR = input.responseStateDir;
  }

  const commitTuple = reviewerCredential ?? input.commitTuple;
  if (commitTuple) {
    env.WIKI_MCP_COMMIT_LAUNCH_REF = commitTuple.launchRef;
    env.WIKI_MCP_COMMIT_RUN_ID = commitTuple.runId;
    env.WIKI_MCP_COMMIT_RETRY_ID = String(commitTuple.retryId);
  }
  if (frozenReviewContractArtifactPath !== null) {
    env[FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR] =
      frozenReviewContractArtifactPath;
  }
  if (reviewMaterializationDir !== null) {
    env.WIKI_MCP_REVIEW_MATERIALIZATION_DIR = reviewMaterializationDir;
  }
  if (managedAssignmentArtifactPath !== null) {
    env[MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR] = managedAssignmentArtifactPath;
  }
  return env;
}

const profiles = new WeakSet();
const planProfile = Symbol("captured launcher host session");
export function bootstrapLauncherHostConfiguration(env, workspaceDir) {
  const envPath = path.join(workspaceDir, ".env");
  let envFilePath = envPath;
  try {
    if (!statSync(envPath).isFile()) throw Object.assign(new Error(`Host configuration ${envPath} is not a regular file`), { code: "host_configuration_nonregular" });
  } catch (error) { if (error.code === "ENOENT") envFilePath = null; else throw error; }
  let failure;
  const descriptor = bootstrapNodeEngineEnvFromFile({ env, envFilePath,
    readFileText: file => { try { return readFileSync(file, "utf8"); } catch (error) { failure = error; throw error; } } });
  if (failure !== undefined) throw failure;
  return descriptor;
}
export function resolveLauncherHostSessionProfile({ workspaceDir, role }) {
  const env = buildServerEnv({ workspaceDir }, role);
  bootstrapLauncherHostConfiguration(env, workspaceDir);
  const publishControlledAcceptanceOptOut = resolveControlledAcceptancePublication(env);
  const profile = Object.freeze({ ...resolveSessionProfileForEnv(env), publishControlledAcceptanceOptOut,
    configurationEnv: Object.freeze({ ...Object.fromEntries(NODE_ENGINE_BOOTSTRAP_ENV_KEYS.filter(key => env[key] !== undefined).map(key => [key, env[key]])),
      [CONTROLLED_ACCEPTANCE_PUBLICATION_ENV]: String(publishControlledAcceptanceOptOut) }) });
  profiles.add(profile);
  return profile;
}
export function assertLauncherHostSessionProfile(profile) {
  if (!profiles.has(profile)) throw Object.assign(new TypeError("Expected the captured launcher host configuration; correct host configuration or restart with a coherent build"), { code: "orchestrator_guidance_profile_invalid" });
  return profile;
}
export function attachLauncherHostSessionProfile(plan, profile) {
  Object.defineProperty(plan, planProfile, { value: assertLauncherHostSessionProfile(profile), enumerable: true });
  return plan;
}
export function launcherHostSessionProfileFor(plan) {
  return assertLauncherHostSessionProfile(plan[planProfile]);
}
