

import { summarizeDispatchReadinessDependencies } from "@agent-chassis/agent-launch-core/src/lib/work-record-gate.mjs";
import { validateWorkRecordDispatchById } from "@agent-chassis/wiki-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  REVIEWER_WRITE_SCOPE_NONEMPTY_REASON,
  buildReviewerEmptyScopeAssertion,
  buildReviewerWriteScopeRefusalDetail
} from "./reviewer-write-scope-policy.mjs";
import {
  AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
  appendGraphImpactBridgeDiagnostic,
  applyGraphImpactBridge
} from "./graph-impact-bridge.mjs";
import {
  assertNoConfiguredCodexRoleCommitCredential
} from "./codex-role-mcp-env.mjs";
import { gateRoleWriteScope } from "./workspace-agent-launch-adapter-contract.mjs";
import {
  redteamPrompt,
  reviewPrompt
} from "./codex-role-prompts.mjs";
import {
  buildReadOnlyRolePreparationAudit,
  classifyReadOnlySubject,
  loadReviewerSubjectScope
} from "./codex-role-read-only-support.mjs";
import {
  ROLE_CONFIG,
  buildCodexApprovalArgsForRole,
  buildCodexSandboxArgsForRole,
  findRepoRoot
} from "./codex-role-adapter-isolation.mjs";
import { buildHeadlessPlan } from "./codex-role-adapter-headless-plan.mjs";

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
  terminalStructuredRoleResultMode = undefined,
  reviewerDependencyBinds = [],

  canonicalRepo = null
}) {
  const config = ROLE_CONFIG[role];
  assertNoConfiguredCodexRoleCommitCredential({ role, env });
  const classified = classifyReadOnlySubject(role, subject);
  if (!classified.ok) {
    throw new Error(classified.error);
  }
  const repo = await findRepoRoot(cwd);

  const metadataRepo = typeof canonicalRepo === "string" && canonicalRepo.length > 0
    ? canonicalRepo
    : repo;
  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : config.defaultProfile;
  const model = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  const renderedRolePrompt = role === "review"
    ? reviewPrompt(subject, {
        acceptanceCriteria,
        acceptanceValidation,
        terminalStructuredRoleResultMode,

        canonicalRepo
      })
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
      repoRoot: metadataRepo,
      now
    });
    const initialReadiness = await validateWorkRecordDispatchById({
      dir: metadataRepo,
      unitAddress: classified.unit_address,
      dispatch_role: "read_only",
      preparation_audit: preparationAudit,
      now
    });
    const bridgeResult = await applyGraphImpactBridge({
      readiness: initialReadiness,
      env,
      repo: metadataRepo,
      envVar: AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
      validate: (evidence) =>
        validateWorkRecordDispatchById({
          dir: metadataRepo,
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
        repo: metadataRepo,
        recordId: classified.record_id,
        sliceId: classified.slice_id
      });
      const reviewerWriteScopeGate = gateRoleWriteScope({
        role: "reviewer",
        write_scope: reviewerScope ? reviewerScope.write_scope : [],
        launcher_owned_exact_slice_review:
          canonicalRepo !== null && classified.slice_id !== null
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
      "--ignore-user-config",
      "--ignore-rules"
    ],
    model,
    prompt,
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot,
    additionalReadOnlyRoots: role === "review" && Array.isArray(reviewerDependencyBinds)
      ? reviewerDependencyBinds
      : [],

    terminalStructuredRoleResultMode
  });

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
