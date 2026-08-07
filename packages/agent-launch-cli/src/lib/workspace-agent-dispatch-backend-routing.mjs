

import path from "node:path";
import { existsSync } from "node:fs";
import { WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION } from "@agent-chassis/agent-launch-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { AGENT_LAUNCH_ROLE_CONFIG_FILENAME } from "./agent-launch-role-config.mjs";
import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CALLER_REVIEW_CONTEXT_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import {
  scopeAuthorityRefusal,
  firstOwnField,
  readCanonicalWorkRecord,
  resolveCanonicalFindingsOnlyReviewUnit,
  verifyFrozenWkReviewTargetAgainstObjectStore
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_LIFECYCLE_REQUIRED
} from "./backend-provisioning-state.mjs";

export function classifyCanonicalFindingsRoute(selectedSlice) {
  if (!isPlainObject(selectedSlice)) {
    return { route: "refuse", reason: "selected_review_unit_absent" };
  }
  if (selectedSlice.work_kind !== "review" && selectedSlice.work_kind !== "redteam") {
    return { route: "refuse", reason: "selected_unit_not_findings_role" };
  }
  const emptyWriteScope = Array.isArray(selectedSlice.write_scope) &&
    selectedSlice.write_scope.length === 0;
  if (!emptyWriteScope) {
    return { route: "refuse", reason: "findings_unit_write_scope_not_empty" };
  }
  if (selectedSlice.review_purpose === "terminal_whole_wk") {
    return { route: "terminal_whole_wk" };
  }
  return { route: "standalone_findings" };
}

export function createBackendRouting(ctx) {
  const {
    worktreeProvisioningConfig,
    frozenReviewContexts,
    frozenSliceReviewContexts,
    recoverTerminalCandidate,
    reviewContextRunGit,
    lifecycle
  } = ctx;

  const startSliceReviewLaunch = (input, boundContext) => ctx.startSliceReviewLaunch(input, boundContext);
  const recoverTerminalReviewContext = (reviewAddress) => ctx.recoverTerminalReviewContext(reviewAddress);
  const verifyTerminalReviewContext = (context) => ctx.verifyTerminalReviewContext(context);
  const refreshTerminalReviewAttemptContract = (context) =>
    ctx.refreshTerminalReviewAttemptContract(context);

  const startLaunch = async (input = {}) => {
    const correctiveCarrier = firstOwnField(input, [
      "trusted_corrective_findings_context",
      "corrective_findings_context",
      "review_findings_context"
    ]);
    const nestedCorrectiveCarrier = firstOwnField(input?.readiness, [
      "trusted_corrective_findings_context",
      "corrective_findings_context",
      "review_findings_context"
    ]);
    if (correctiveCarrier !== null || nestedCorrectiveCarrier !== null) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "trusted_corrective_findings",
        reason: "caller_carried_corrective_findings_forbidden",
        field: correctiveCarrier ?? `readiness.${nestedCorrectiveCarrier}`
      });
    }
    if (input?.role === "worker") {
      const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
      const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
      const configCarrier = firstOwnField(worktreeProvisioningConfig, CALLER_SCOPE_CARRIERS);
      const configAttemptCarrier = firstOwnField(worktreeProvisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS);
      if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null || configAttemptCarrier !== null) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
          ...scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
            reason: lifecycleCarrier !== null || configAttemptCarrier !== null
              ? "caller_carried_managed_lifecycle_forbidden"
              : "caller_carried_scope_forbidden",
            field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
            carrier: callerCarrier !== null || lifecycleCarrier !== null ? "dispatch_input" : "provisioning_config"
          })
        };
      }
    }
    if (input?.role !== "reviewer" && input?.role !== "redteam") {
      return lifecycle.startLaunch(input);
    }

    const terminalCandidateCallerCarriers = [
      ...CALLER_REVIEW_CONTEXT_CARRIERS,
      "candidateRef", "candidate_ref", "candidateSha", "candidate_sha",
      "baseRef", "base_ref", "baseSha", "base_sha",
      "landingRef", "landing_ref", "landingSha", "landing_sha",
      "terminalCandidate", "terminal_candidate", "terminalCandidateContext",
      "terminal_candidate_context",

      "trustedTerminalReviewAttemptContract", "trusted_terminal_review_attempt_contract",
      "terminalReviewAttemptContract", "terminal_review_attempt_contract"
    ];
    const contextCarrier = firstOwnField(input, terminalCandidateCallerCarriers);
    const nestedContextCarrier = firstOwnField(input?.readiness, terminalCandidateCallerCarriers);
    if (contextCarrier !== null || nestedContextCarrier !== null) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "caller_carried_review_context_forbidden",
        field: contextCarrier ?? `readiness.${nestedContextCarrier}`
      });
    }

    const sliceContext = frozenSliceReviewContexts.get(input.subject);
    if (sliceContext) {
      return startSliceReviewLaunch(input, sliceContext);
    }
    let context = frozenReviewContexts.get(input.subject);

    let terminalRoute = false;
    if (!context) {
      const subjectMatch = typeof input.subject === "string"
        ? input.subject.match(/^(WK-\d{4})#SLICE-\d{3}$/u)
        : null;
      if (subjectMatch) {
        const canonicalMainRepo = worktreeProvisioningConfig?.mainRepo ?? input.workspace_dir;
        const record = readCanonicalWorkRecord(canonicalMainRepo, subjectMatch[1]);
        if (!record) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "canonical_review_authority_unresolved",
            subject: input.subject
          });
        }
        const selectedSliceId = input.subject.slice(input.subject.indexOf("#") + 1);
        const selectedSlice = Array.isArray(record.slices)
          ? record.slices.find((slice) => slice?.id === selectedSliceId)
          : null;

        const classification = classifyCanonicalFindingsRoute(selectedSlice);
        if (classification.route === "standalone_findings") {
          return lifecycle.startLaunch(input);
        }
        if (classification.route === "refuse") {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: classification.reason,
            subject: input.subject
          });
        }

        terminalRoute = true;
        if (recoverTerminalCandidate === null) {
          try {
            const canonicalUnit = resolveCanonicalFindingsOnlyReviewUnit(canonicalMainRepo, subjectMatch[1]);
            if (canonicalUnit.subject !== input.subject) {
              return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
                capability: "wk_context_review",
                reason: "canonical_review_subject_mismatch",
                subject: input.subject,
                canonical_subject: canonicalUnit.subject
              });
            }
          } catch (error) {
            return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
              capability: "wk_context_review",
              reason: "canonical_review_authority_unresolved",
              subject: input.subject,
              message: error?.message ?? String(error)
            });
          }
        }
        const recovered = await recoverTerminalReviewContext({
          record_id: subjectMatch[1],
          subject: input.subject
        });
        if (recovered.ok !== true) return recovered.refusal;
        context = recovered.context;
      }
      if (!context) {
        if (terminalRoute) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "terminal_review_context_unresolved",
            subject: input.subject ?? null
          });
        }
        return lifecycle.startLaunch(input);
      }
    }
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_workspace_mismatch"
      });
    }
    if (context.review_identity_kind !== "terminal_candidate") {
      try {
        const currentUnit = resolveCanonicalFindingsOnlyReviewUnit(context.main_repo, context.record_id);
        if (currentUnit.subject !== context.review_subject ||
            currentUnit.record_id !== context.record_id ||
            currentUnit.slice_id !== context.review_slice_id ||
            currentUnit.initiative !== context.initiative ||
            currentUnit.parent_status !== "review" ||
            currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
            currentUnit.review_unit_contract !== context.review_unit_contract) {
          throw new Error("canonical parent WK or findings-only review unit changed after the WK target was frozen");
        }
      } catch (error) {
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "frozen_review_context_stale_or_mismatched",
          message: error?.message ?? String(error)
        });
      }
    }
    if (context.review_identity_kind === "terminal_candidate") {
      try {
        verifyTerminalReviewContext(context);
      } catch (error) {
        const recovered = await recoverTerminalReviewContext({
          record_id: context.record_id,
          subject: context.review_subject
        });
        if (recovered.ok !== true) return recovered.refusal;
        context = recovered.context;
      }

      const refreshed = refreshTerminalReviewAttemptContract(context);
      if (refreshed.ok !== true) return refreshed.refusal;
      context = refreshed.context;
    } else {
      const targetVerification = verifyFrozenWkReviewTargetAgainstObjectStore({
        mainRepo: context.main_repo,
        context,
        runGit: reviewContextRunGit
      });
      if (targetVerification.ok !== true) {
        if (targetVerification.kind === "transport") {
          return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
            capability: "wk_context_review",
            reason: "frozen_review_context_probe_transport_failure",
            detail: targetVerification.detail
          });
        }
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "frozen_review_context_stale_or_mismatched",
          detail: targetVerification.detail
        });
      }
    }

    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,
        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,

        trusted_terminal_review_attempt_contract:
          context.terminal_review_attempt_contract ?? null,
        reviewer_dependency_binds: context.reviewer_dependency_binds ?? [],
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          ...(context.review_identity_kind === "terminal_candidate"
            ? { frozen_terminal_candidate_review_target: Object.freeze({
                review_identity_kind: "terminal_candidate",
                candidate_ref: context.candidate_ref,
                candidate_sha: context.candidate_sha,
                base_ref: context.base_ref,
                base_sha: context.base_sha,
                wk_ref: context.wk_ref,
                wk_sha: context.wk_sha,
                diff_base_sha: context.base_sha,
                diff_head_sha: context.candidate_sha,
                diff_range: `${context.base_sha}..${context.candidate_sha}`,
                canonical_wk_digest: context.canonical_wk_digest,
                complete_parent_wk_contract: true,
                accumulated_wk_diff: true
              }) }
            : { frozen_wk_review_target: Object.freeze({
                ref: context.wk_ref,
                sha: context.wk_sha,
                diff_base_sha: context.diff_base_sha,
                diff_head_sha: context.diff_head_sha,
                diff_range: context.diff_range,
                complete_parent_wk_contract: true,
                accumulated_wk_diff: true
              }) }),
          reviewer_validation_evidence: context.reviewer_validation_evidence ?? []
        })
      });
    } catch (error) {
      throw error;
    }
    if (launch?.accepted === true) {
      ctx.wholeReviewRunContexts.set(launch.run_id, context);
    } else {

      if (launch?.refusal?.reason === "reviewer_model_unset" &&
          !existsSync(path.join(context.main_repo, AGENT_LAUNCH_ROLE_CONFIG_FILENAME))) {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "wk_context_review",
          reason: "reviewer_role_config_root_unreadable",
          detail: {
            config_root: context.main_repo,
            config_file: AGENT_LAUNCH_ROLE_CONFIG_FILENAME
          }
        });
      }
    }
    return launch;
  };

  return { startLaunch };
}
