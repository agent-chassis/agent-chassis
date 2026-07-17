

import {
  __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS
} from "./workspace-agent-launch-core.mjs";
import {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";
import {
  buildCodexRolePlan,
  buildCodexRoleBubblewrapPlan
} from "../commands/codex-role.mjs";
import { ensureNewWorkerWriteRoots } from "./codex-worker-plan.mjs";

import {
  CODEX_CLEAN_REVIEW_LINE_PATTERN,
  CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  defaultCaptureCodexFinalResult,
  detectCodexCleanReviewLine,
  redactCodexTransportSecrets
} from "./workspace-agent-codex-final-result.mjs";

import {
  CODEX_EXECUTOR_ROLE_MAP,
  CODEX_FAMILY_SOURCE_READ_MODE,
  CODEX_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import {
  createHostWriteAuthorityBrokerPlanLaunchImpl
} from "./workspace-agent-dispatch-codex-broker-plan-launch.mjs";
import {
  evaluateDispatchRoleModelGate,
  resolveCodexWorkerSourceSurfacePolicy
} from "./workspace-agent-dispatch-codex-executor-policy.mjs";
import {
  createCodexWorkspaceAgentLaunchExecutor as createCodexWorkspaceAgentLaunchExecutorImpl
} from "./workspace-agent-dispatch-codex-in-process-executor.mjs";

export {
  CODEX_CLEAN_REVIEW_LINE_PATTERN,
  CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  defaultCaptureCodexFinalResult,
  detectCodexCleanReviewLine,
  redactCodexTransportSecrets
};

export {
  CODEX_EXECUTOR_ROLE_MAP,
  CODEX_FAMILY_SOURCE_READ_MODE,
  CODEX_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION
};

export {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
};

export function createCodexWorkspaceAgentLaunchExecutor(options = {}) {
  return createCodexWorkspaceAgentLaunchExecutorImpl(options);
}

export function createHostWriteAuthorityBrokerPlanLaunch(options = {}) {
  return createHostWriteAuthorityBrokerPlanLaunchImpl({
    options,
    deps: {
      buildPlan: buildCodexRolePlan,
      buildBwrapPlan: buildCodexRoleBubblewrapPlan,
      ensureWriteRoots: ensureNewWorkerWriteRoots,
      captureFinalResult: defaultCaptureCodexFinalResult,
      resolveCodexWorkerSourceSurfacePolicy,
      evaluateDispatchRoleModelGate
    }
  });
}

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;
