

import path from "node:path";
import {
  advanceWkRef,
  materializeCommitObject
} from "../../../agent-launch-cli/src/lib/commit-object-primitive.mjs";

import {
  verifyExactSliceCommitBinding,
  resolveCommitGitIdentity,
  normalizeCommitRef,
  resolveExpectedEnvelope,
  resolveSparseBinding,
  resolveCommitWriteScopeMatcher
} from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { verifyAndMeasureCommitScope } from "../../../agent-launch-cli/src/lib/commit-scope-envelope.mjs";
import {
  admitWorkerCommitCall,
  WORKER_COMMIT_TOOL_NAME
} from "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  deriveWritableMountsFromWriteScope
} from "../../../agent-launch-cli/src/lib/workspace-agent-write-scope.mjs";
import {
  persistExactSliceImplementationReviewTransition
} from "../../../wiki-core/src/operations/work-record-slice-review-acceptance.mjs";

export { WORKER_COMMIT_TOOL_NAME };

export const WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: WORKER_COMMIT_TOOL_NAME,
  input_contract: "closed",
  binding_authority: "server_resolved"
});

const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createCommitRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKER_COMMIT_TOOL_NAME,
    committed: false,
    submitted_for_review: false,
    valid: false,
    written: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    ...extra
  };
}

function createCommitResponse(workspaceRepo, assignedUnit, result) {
  return {
    workspaceRepo,
    tool: WORKER_COMMIT_TOOL_NAME,
    committed: true,
    submitted_for_review: Boolean(result.transition?.submitted),
    assigned_unit: assignedUnit,
    commit: result.commit,
    tree: result.tree,
    base_sha: result.base_sha,
    ref: result.ref,
    idempotent: result.idempotent,
    ref_advanced: result.ref_advanced,
    empty_delivery: result.empty_delivery,
    changed_paths: result.scope.changed_paths,
    metrics: result.scope.metrics,
    baseline: result.scope.baseline,
    attestation: result.scope.attestation,
    expected_envelope_invariant: result.scope.expected_envelope_invariant,
    transition: result.transition
  };
}

function boundedTransitionFacts({ state, validation = null, result = null, error = null }) {
  return {
    state,
    decision_code: validation?.decision_code ??
      (typeof error?.code === "string" ? error.code : null),
    reason: validation?.reason ?? (error ? "transition_threw" : null),
    valid: typeof result?.valid === "boolean" ? result.valid : null,
    written: typeof result?.written === "boolean" ? result.written : null,
    no_op: typeof result?.no_op === "boolean" ? result.no_op : null,
    status: typeof result?.status === "string" ? result.status : null
  };
}

function boundedCompensationFacts(error, advanced) {
  const detail = isPlainObject(error?.detail) ? error.detail : {};
  return {
    state: "failed",
    decision_code: typeof error?.code === "string" ? error.code :
      "agent_launch.slice_integration.slice_commit_compensation_failed.v1",
    ref: advanced.ref,
    published_commit: advanced.commit,
    prior_tip: advanced.prior_tip,
    observed_tip: typeof detail.observed_tip === "string" ? detail.observed_tip : null
  };
}

function createTransactionRefusal(advanced, transition, compensation) {
  const partial = compensation?.state === "failed";
  const compensated = compensation?.state === "restored";
  return createCommitRefusal(
    partial
      ? "commit.exact_slice_transaction_partial.v1"
      : compensated
        ? "commit.review_transition_failed_compensated.v1"
        : "commit.review_transition_failed_unpublished.v1",
    [partial
      ? "the exact slice ref was published, canonical review was not proven, and exact CAS compensation did not complete"
      : compensated
        ? "canonical review was not proven; the exact slice ref publication was CAS-compensated to its authenticated prior tip"
        : "canonical review was not proven; this invocation published no ref change"],
    {
      transaction: {
        schema_version: "workspace-exact-slice-commit-transaction.v1",
        ref: advanced.ref,
        base_sha: advanced.base_sha,
        delivered_tree: advanced.tree,
        published_commit: advanced.ref_advanced === true ? advanced.commit : null,
        prior_tip: advanced.prior_tip,
        ref_advanced: advanced.ref_advanced === true,
        canonical_review: transition,
        compensation
      }
    }
  );
}

function createSubmitForReviewResponse(workspaceRepo, assignedUnit, result, createCompactWorkRecordEditResponse) {
  return {
    tool: "workspace_submit_for_review",
    submitted: Boolean(result?.valid) && (Boolean(result?.written) || Boolean(result?.no_op)),
    assigned_unit: assignedUnit,
    ...createCompactWorkRecordEditResponse(workspaceRepo, result)
  };
}

function parseNonNegativeIntegerString(value, label) {
  const text = trimmed(value);
  if (!text) return null;
  if (!/^(0|[1-9]\d*)$/u.test(text)) {
    throw new Error(`${label} must be a non-negative integer string`);
  }
  return Number.parseInt(text, 10);
}

function resolveCommitCredentialFromEnv(env) {
  const launchRef = trimmed(env[WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR]);
  const runId = trimmed(env[WIKI_MCP_COMMIT_RUN_ID_ENV_VAR]);
  if (!launchRef || !runId) {
    return null;
  }
  return Object.freeze({
    kind: "identity_store_tuple",
    launchRef,
    runId,
    retryId: parseNonNegativeIntegerString(env[WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR], WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR) ?? 0
  });
}

function resolveCommitBindingFromCredential(credential, mainRepo, assignedUnit) {
  if (!isPlainObject(credential)) {
    throw new Error("commit credential must be a launcher-provided object");
  }
  if (credential.kind !== "identity_store_tuple") {
    throw new Error(`unsupported commit credential kind: ${JSON.stringify(credential.kind)}`);
  }
  const binding = resolveWorktreeBinding({
    mainRepo,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });
  return verifyExactSliceCommitBinding({
    binding,
    mainRepo,
    assignedUnit,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });
}

export function registerWorkspaceCommitTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createCompactWorkRecordEditResponse,
  setWorkRecordStatusByUnit,
  env = process.env
}) {
  registerTool(
    WORKER_COMMIT_TOOL_NAME,
    {
      description:
        "Worker-only closed-input affordance. Materialize and verify the launcher-bound delta against the launcher-assigned write_scope, advance only the launcher-bound delivery ref, and durably transition the assigned unit to review. For an exact slice, that successful commit is submit-for-review; it does not advance the WK ref or authorize integration. The exact committed slice target must receive a clean findings-only review before trusted integration. The tool accepts no caller-supplied branch, path, base_sha, write_scope, subject, expected envelope, author identity, commit message, or serialized binding.",
      inputSchema: z.object({}).strict()
    },
    async (args) => {
      try {
        const rawAssignedUnit = env.WIKI_MCP_ASSIGNED_UNIT;
        const assignedUnit = trimmed(rawAssignedUnit);
        if (!assignedUnit) {
          return jsonContent(
            createCommitRefusal("commit.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; commit is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const credential = resolveCommitCredentialFromEnv(env);
        if (!credential) {
          return jsonContent(
            createCommitRefusal("commit.missing_launcher_binding.v1", [
              `${WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR}/${WIKI_MCP_COMMIT_RUN_ID_ENV_VAR} launcher tuple is required; commit refuses to derive identity from worker input, serialized environment bindings, or the current checkout`
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);

        const mainRepo = path.resolve(workspace.dir);
        let rawBinding = null;
        const admitted = admitWorkerCommitCall({
          credential,
          workerArgs: args,
          deps: {
            resolveBinding(value) {
              rawBinding = resolveCommitBindingFromCredential(value, mainRepo, rawAssignedUnit);
              return rawBinding;
            }
          }
        });
        const binding = admitted.binding;
        const serverResolvedBinding = rawBinding ?? binding;
        const gitIdentity = resolveCommitGitIdentity(serverResolvedBinding, mainRepo);
        const commitTarget = normalizeCommitRef(binding.output_branch);

        const materialized = materializeCommitObject({
          gitDir: gitIdentity.gitDir,
          workTree: gitIdentity.workTree,
          baseSha: binding.base_sha,
          message: admitted.server_generated_message,
          sparseBinding: resolveSparseBinding(serverResolvedBinding)
        });

        const scope = verifyAndMeasureCommitScope({
          gitDir: gitIdentity.gitDir,
          baseSha: materialized.base_sha,
          commit: materialized.commit,
          tree: materialized.tree,
          writeScope: binding.write_scope,
          expectedEnvelope: resolveExpectedEnvelope(serverResolvedBinding),
          deps: {
            resolveWriteScope(writeScope) {
              return resolveCommitWriteScopeMatcher(
                deriveWritableMountsFromWriteScope, mainRepo, writeScope
              );
            }
          }
        });
        if (scope.contained !== true) {
          return jsonContent(
            createCommitRefusal("commit.write_scope_refused.v1", [
              "materialized commit object is not structurally contained in the launcher-assigned write_scope"
            ], {
              materialized,
              scope
            })
          );
        }

        let advanced;
        let exactSlicePrimitives = null;
        if (commitTarget.kind === "slice") {

          exactSlicePrimitives = await import("../../../agent-launch-cli/src/lib/slice-integration.mjs");
          advanced = exactSlicePrimitives.commitSliceRef({
            repo: mainRepo,
            sliceRef: commitTarget.ref,
            baseSha: materialized.base_sha,
            tree: materialized.tree,
            commit: materialized.commit
          });
        } else {
          advanced = advanceWkRef({
            gitDir: gitIdentity.gitDir,
            ref: commitTarget.ref,
            baseSha: materialized.base_sha,
            tree: materialized.tree,
            commit: materialized.commit
          });
        }

        let persistedTransition;
        let transitionFacts;
        try {
          persistedTransition = await persistExactSliceImplementationReviewTransition({
            dir: workspace.dir,
            unitAddress: assignedUnit,
            writeStatus: setWorkRecordStatusByUnit
          });
          transitionFacts = boundedTransitionFacts({
            state: persistedTransition.validation.ok ? "review" : "invalid",
            validation: persistedTransition.validation,
            result: persistedTransition.result
          });
        } catch (error) {
          transitionFacts = boundedTransitionFacts({ state: "threw", error });
        }

        if (transitionFacts.state !== "review") {
          let compensation = { state: "not_required" };
          if (commitTarget.kind === "slice" && advanced.ref_advanced === true) {
            try {
              exactSlicePrimitives.compensateCommittedSliceRef({
                repo: mainRepo,
                sliceRef: advanced.ref,
                publishedCommit: advanced.commit,
                priorTip: advanced.prior_tip
              });
              compensation = {
                state: "restored",
                ref: advanced.ref,
                published_commit: advanced.commit,
                restored_tip: advanced.prior_tip
              };
            } catch (error) {
              compensation = boundedCompensationFacts(error, advanced);
            }
          }
          return jsonContent(createTransactionRefusal(advanced, transitionFacts, compensation));
        }

        const transition = createSubmitForReviewResponse(
          workspace.repo,
          assignedUnit,
          persistedTransition.result,
          createCompactWorkRecordEditResponse
        );
        return jsonContent(
          createCommitResponse(workspace.repo, assignedUnit, {
            commit: advanced.commit,
            tree: advanced.tree,
            base_sha: advanced.base_sha,
            ref: advanced.ref,
            idempotent: advanced.idempotent,
            ref_advanced: advanced.ref_advanced,
            empty_delivery: advanced.empty_delivery,
            scope,
            transition
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
