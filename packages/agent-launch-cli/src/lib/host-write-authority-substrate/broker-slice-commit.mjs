

import {
  verifyExactSliceCommitBinding,
  resolveCommitGitIdentity,
  normalizeCommitRef,
  resolveSparseBinding,
  resolveExpectedEnvelope,
  resolveCommitWriteScopeMatcher
} from "./broker-commit-binding.mjs";

export const COMMIT_SLICE_ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "substrate_id", "protocol_version", "op", "commit_request"
]);
export const COMMIT_SLICE_REQUEST_FIELDS = Object.freeze([
  "assigned_unit", "launch_ref", "run_id", "retry_id"
]);
export const COMMIT_SLICE_ASSIGNED_UNIT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

async function loadDefaultCommitDeps() {
  const [
    { resolveWorktreeBinding },
    { materializeCommitObject, advanceWkRef },
    { verifyAndMeasureCommitScope },
    { commitSliceRef },
    { deriveWritableMountsFromWriteScope },
    { admitWorkerCommitCall }
  ] = await Promise.all([
    import("../worktree-substrate.mjs"),
    import("../commit-object-primitive.mjs"),
    import("../commit-scope-envelope.mjs"),
    import("../slice-integration.mjs"),
    import("../workspace-agent-write-scope.mjs"),
    import("../commit-tool-exposure-guard.mjs")
  ]);
  return {
    resolveWorktreeBinding, materializeCommitObject, advanceWkRef,
    verifyAndMeasureCommitScope, commitSliceRef, deriveWritableMountsFromWriteScope,
    admitWorkerCommitCall
  };
}

export async function defaultCommitManagedWorkerSlice({ mainRepo, assignedUnit, launchRef, runId, retryId, deps = null }) {
  const {
    resolveWorktreeBinding,
    materializeCommitObject,
    advanceWkRef,
    verifyAndMeasureCommitScope,
    commitSliceRef,
    deriveWritableMountsFromWriteScope,
    admitWorkerCommitCall
  } = deps ?? await loadDefaultCommitDeps();

  let rawBinding = null;
  const admitted = admitWorkerCommitCall({

    credential: Object.freeze({ kind: "commit_slice_tuple", launchRef, runId, retryId }),
    workerArgs: {},
    deps: {
      resolveBinding() {
        const binding = resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId });
        rawBinding = verifyExactSliceCommitBinding({
          binding, mainRepo, assignedUnit, launchRef, runId, retryId
        });
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
        return resolveCommitWriteScopeMatcher(deriveWritableMountsFromWriteScope, mainRepo, writeScope);
      }
    }
  });
  if (scope.contained !== true) {
    return {
      scope_refused: true,
      changed_paths: scope.changed_paths ?? [],
      refusal: scope.refusal ?? null
    };
  }

  let advanced;
  if (commitTarget.kind === "slice") {
    advanced = commitSliceRef({
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

  return {
    committed: true,
    submitted_for_review: false,
    assigned_unit: assignedUnit,
    commit: advanced.commit,
    tree: advanced.tree,
    base_sha: advanced.base_sha,
    ref: advanced.ref,
    idempotent: advanced.idempotent,
    changed_paths: scope.changed_paths,
    metrics: scope.metrics,
    baseline: scope.baseline,
    attestation: scope.attestation,
    expected_envelope_invariant: scope.expected_envelope_invariant,
    transition: {
      submitted: false,
      status: "awaiting_worker_termination_and_wk_integration"
    }
  };
}
