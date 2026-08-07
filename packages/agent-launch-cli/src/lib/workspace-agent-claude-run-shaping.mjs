

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
  WRITE_SCOPE_VERIFICATION_REASONS,
  WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION
} from "./workspace-agent-write-scope-verification.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts
} from "./workspace-agent-sandbox-decision.mjs";
import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision
} from "./workspace-agent-dispatch-provenance.mjs";
import { makeRefusal } from "./workspace-agent-claude-launch-support.mjs";

export { WORKSPACE_AGENT_SANDBOX_OUTCOMES };

let plainChildProcessSpawn = null;

export async function resolvePlainChildProcessSpawn() {
  if (plainChildProcessSpawn === null) {
    const childProcess = await import("node:" + "child_process");
    plainChildProcessSpawn = childProcess.spawn;
  }
  const spawnNow = plainChildProcessSpawn;

  return (command, args, options) =>
    spawnNow(command, Array.isArray(args) ? [...args] : [], options);
}

export async function spawnPlainChildProcess(command, args, options) {
  const spawnNow = await resolvePlainChildProcessSpawn();
  return spawnNow(command, args, options);
}

export function resolveClaudePlainSpawnPrimitive(plainSpawn) {
  return plainSpawn === spawnPlainChildProcess
    ? resolvePlainChildProcessSpawn
    : async () => plainSpawn;
}

export function buildClaudeChildRunProvenance({
  enforcement = null,
  sandboxDecision = null
} = {}) {
  const effectiveEnforcement = sandboxDecision
    ? createDispatchProvenanceEnforcementFromSandboxDecision(sandboxDecision)
    : enforcement;
  return buildStructuredDispatchProvenance({
    transcriptSource: "child_process_stdout",
    enforcement: effectiveEnforcement,
    artifacts: []
  });
}

export function buildClaudeSupervisedFinalResultWithProvenance(provenanceContext) {
  const decorated = new WeakMap();
  return (finalResult) => {
    if (!finalResult || typeof finalResult !== "object") {
      return finalResult;
    }
    const cached = decorated.get(finalResult);
    if (cached !== undefined) {
      return cached;
    }
    const next = {
      ...finalResult,
      provenance: buildClaudeChildRunProvenance(provenanceContext)
    };
    decorated.set(finalResult, next);
    return next;
  };
}

export function buildClaudeWriteScopeVerificationFailure(detail) {
  return Object.freeze({
    schema_version: WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION,
    ran: false,
    ok: false,
    reason: WRITE_SCOPE_VERIFICATION_REASONS.CHECK_THREW,
    enforcement: WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
    detail,
    changed: Object.freeze([]),
    out_of_scope: Object.freeze([])
  });
}

function bwrapAvailabilityFromClaudeIsolationError(err) {
  return Object.freeze({
    available: false,
    diagnostic: Object.freeze({
      code: err?.code ?? null,
      message: err?.message ?? "Claude isolation backend failed before spawn",
      detail: err?.detail ?? null
    })
  });
}

export function buildClaudeSandboxDecisionFromIsolationFailure({
  err,
  launchFacts,
  role,
  subject,
  workspaceDir
}) {
  return buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts({
    launchFacts,
    role,
    subject,
    workspaceDir,
    bwrapAvailability: bwrapAvailabilityFromClaudeIsolationError(err),
    source: "claude_executor_late_bwrap_failure"
  });
}

export function buildClaudeSandboxDecisionRefusal(decision) {
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
    decision?.refusal?.reason ?? "claude_sandbox_decision_refused",
    decision?.refusal?.detail ?? null
  );
}
