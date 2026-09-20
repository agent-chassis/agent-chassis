

import path from "node:path";
import { createSubmitForReviewResponse } from "./server-composition-helpers.mjs";
import {
  resolveLauncherRunCredential,
  resolveAssignedUnit,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR
} from "./launcher-run-credential.mjs";
import {
  advanceWkRef,
  materializeCommitObject
} from "../../../agent-launch-cli/src/lib/commit-object-primitive.mjs";

import {
  verifyExactSliceCommitBinding,
  resolveCommitGitIdentity,
  normalizeCommitRef,
  resolveExpectedEnvelope,
  resolveCommitWriteScopeMatcher
} from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { createWorkerScopeTreeReader } from "../../../agent-launch-cli/src/lib/backend-worker-scope-tree.mjs";
import { defaultRunGit } from "../../../agent-launch-cli/src/lib/worktree-substrate-primitives.mjs";
import { CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT } from "../../../wiki-core/src/lib/controlled-contract-private-path-policy.mjs";
import { verifyAndMeasureCommitScope } from "../../../agent-launch-cli/src/lib/commit-scope-envelope.mjs";
import {
  admitWorkerCommitCall,
  WORKER_COMMIT_TOOL_NAME
} from "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  persistExactSliceImplementationReviewTransition
} from "../../../wiki-core/src/operations/work-record-slice-review-acceptance.mjs";
import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";

export { WORKER_COMMIT_TOOL_NAME };

export const WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: WORKER_COMMIT_TOOL_NAME,
  input_contract: "closed",
  binding_authority: "server_resolved"
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const BINDING_RESOLUTION_STAGE = "binding_resolution";
const BINDING_RESOLUTION_DIAGNOSTIC_PATH = "workspace_commit.binding_resolution";

function declareBindingResolutionFailure(error, resolution) {
  if (!resolution.threw || error === null || typeof error !== "object" ||
      !Object.hasOwn(error, "cause") || error.cause !== resolution.error) {
    return error;
  }
  const declared = new Error(error.message);
  try {
    declared.envelope = {
      ...serializeWorkRecordDiagnosticValue(error, { path: BINDING_RESOLUTION_DIAGNOSTIC_PATH }),
      stage: BINDING_RESOLUTION_STAGE,
      diagnostic_serialization: { state: "complete" }
    };
  } catch (serializationError) {
    declared.envelope = {
      code: typeof error.code === "string" ? error.code : null,
      message: typeof error.message === "string" ? error.message : null,
      stage: BINDING_RESOLUTION_STAGE,
      diagnostic_serialization: {
        state: "failed",
        cause: serializeWorkRecordDiagnosticValue(serializationError, {
          path: `${BINDING_RESOLUTION_DIAGNOSTIC_PATH}.serialization_failure`
        })
      }
    };
  }
  return declared;
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

    submitted_for_review: result.transition.submitted,
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
  setWorkRecordStatusByUnit,
  env = process.env
}) {
  registerTool(
    WORKER_COMMIT_TOOL_NAME,
    {
      description:
        "Commit only the launcher-bound worker delta and move its unit to review. Exact-slice commit submits for review; it advances no WK ref or integration authority. Closed input: identity, scope, refs and commit settings are launcher-owned.",
      inputSchema: z.object({}).strict()
    },
    async (args) => {
      const bindingResolution = { threw: false, error: undefined };
      try {
        const rawAssignedUnit = env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR];
        const assignedUnit = resolveAssignedUnit(env);
        if (!assignedUnit) {
          return jsonContent(
            createCommitRefusal("commit.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; commit is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const credential = resolveLauncherRunCredential(env);
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
              try {
                rawBinding = resolveCommitBindingFromCredential(value, mainRepo, rawAssignedUnit);
              } catch (error) {
                bindingResolution.threw = true;
                bindingResolution.error = error;
                throw error;
              }
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
          message: admitted.server_generated_message
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
                createWorkerScopeTreeReader({ runGit: defaultRunGit, mainRepo, baseSha: binding.base_sha }),
                writeScope,
                [CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT]
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

        let advanced = {
          base_sha: materialized.base_sha,
          commit: materialized.commit,
          tree: materialized.tree,
          ref: commitTarget.ref,
          prior_tip: materialized.base_sha,
          ref_advanced: false
        };
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
          persistedTransition.result
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
        return errorContent(declareBindingResolutionFailure(error, bindingResolution));
      }
    }
  );
}
