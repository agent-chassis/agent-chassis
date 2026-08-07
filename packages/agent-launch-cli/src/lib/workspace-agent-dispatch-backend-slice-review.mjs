

import path from "node:path";
import { existsSync } from "node:fs";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { AGENT_LAUNCH_ROLE_CONFIG_FILENAME } from "./agent-launch-role-config.mjs";
import {
  isPlainObject,
  createTrustedFrozenSliceReviewContract
} from "./backend-review-identity.mjs";
import {
  deepFreezeCanonicalSnapshot,
  resolveCanonicalFindingsOnlyReviewUnit,
  assertFrozenSliceReviewTarget,
  verifyFrozenSliceReviewTargetAgainstObjectStore,
  resolveCanonicalSliceReviewUnit
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_LIFECYCLE_REQUIRED
} from "./backend-provisioning-state.mjs";
import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import {
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES,
  resolveCommittedSliceReviewAdmission
} from "./committed-slice-review-admission.mjs";
import { prepareReviewerDependencyProjection } from "./terminal-wk-candidate-validation.mjs";
import {
  digestTrustedExactReviewEvidence,
  receiptCarriesUsableReviewVerdict
} from "./workspace-agent-dispatch-run-receipt.mjs";

export function createBackendSliceReview(ctx) {
  const {
    frozenSliceReviewContexts,
    frozenReviewContexts,
    worktreeProvisioningConfig,
    reviewContextRunGit,
    sliceReviewRunContexts,
    runs,
    exactSliceReviewReceiptStore,
    sliceReviewTargetKey,
    postWorkerSliceLifecycle,
    attemptStateAuthority,
    lifecycle
  } = ctx;

  const bindFrozenReviewContext = (args) => ctx.bindFrozenReviewContext(args);
  const resolveCommittedSliceIntegrationContinuation = (args) =>
    ctx.resolveCommittedSliceIntegrationContinuation(args);
  const retireManagedWorkerIdentity = (args) => ctx.retireManagedWorkerIdentity(args);
  const captureSliceReviewTerminalResult = (args) => ctx.captureSliceReviewTerminalResult(args);

  function resolveManagedRunBinding(status) {
    return attemptStateAuthority.resolveProvisioningBinding(status);
  }

  function bindFrozenSliceReviewContext({ status, provisioning, sliceTarget, reviewUnit }) {
    const target = assertFrozenSliceReviewTarget(sliceTarget);
    const sliceBinding = provisioning?.slice_binding;

    const worktreePath = provisioning?.slice_worktree_path ?? sliceBinding?.worktree_path;
    const expectedSliceRef = sliceBinding?.output_branch?.startsWith("refs/heads/")
      ? sliceBinding.output_branch
      : `refs/heads/${sliceBinding?.output_branch ?? ""}`;
    if (!isPlainObject(reviewUnit) || typeof reviewUnit.subject !== "string" ||
        typeof reviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof reviewUnit.review_unit_contract !== "string" ||
        reviewUnit.parent_status === "review" ||
        typeof reviewUnit.initiative !== "string" || !/^IN-\d{4}$/u.test(reviewUnit.initiative) ||
        target.ref !== `refs/heads/slice/${reviewUnit.initiative}/${reviewUnit.record_id}/${reviewUnit.slice_id}` ||
        !path.isAbsolute(worktreePath ?? "") ||
        worktreePath !== sliceBinding?.worktree_path || expectedSliceRef !== target.ref ||
        provisioning?.record_id !== reviewUnit.record_id ||
        provisioning?.slice_id !== reviewUnit.slice_id ||
        status?.subject !== reviewUnit.subject) {
      throw new Error("backend-owned frozen slice review context does not match managed provisioning and canonical slice-review identity");
    }

    if (frozenReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a whole-WK review context; a slice-level review context cannot coexist");
    }

    if (target.diff_base_sha !== sliceBinding?.base_sha) {
      throw new Error("frozen slice review target base does not match the launcher-owned current attempt provisioning binding");
    }
    const committedAdmission = resolveCommittedSliceReviewAdmission({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
      subject: reviewUnit.subject,
      reviewUnit,
      runGit: reviewContextRunGit
    });

    const reviewTarget = assertFrozenSliceReviewTarget(committedAdmission.target);
    if (reviewTarget.sha !== target.sha || reviewTarget.ref !== target.ref ||
        committedAdmission.worktree_path !== worktreePath) {
      throw new Error("canonical committed-slice admission disagrees with the frozen worker target");
    }
    const existing = frozenSliceReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      if (existing.reviewed_sha === reviewTarget.sha &&
          existing.diff_base_sha === reviewTarget.diff_base_sha &&
          existing.source_worker_run_id === status.run_id) {
        return existing;
      }
    }
    const trustedFrozenReviewContract = createTrustedFrozenSliceReviewContract(reviewUnit);
    const reviewerDependencyProjection = prepareReviewerDependencyProjection({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      checkoutPath: worktreePath,
      projectionRoot: path.join(
        worktreeProvisioningConfig.worktreeRoot,
        ".reviewer-dependencies",
        committedAdmission.committed_target_digest,
        "node_modules"
      )
    });
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-slice-review-context.v1",
      review_admission_kind: committedAdmission.review_admission_kind,
      committed_target_digest: committedAdmission.committed_target_digest,
      review_subject: reviewUnit.subject,
      record_id: reviewUnit.record_id,
      review_slice_id: reviewUnit.slice_id,
      initiative: reviewUnit.initiative,
      canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
      review_unit_contract: reviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      slice_ref: reviewTarget.ref,
      reviewed_sha: reviewTarget.sha,

      diff_base_sha: reviewTarget.diff_base_sha,
      diff_head_sha: reviewTarget.diff_head_sha,
      diff_range: reviewTarget.diff_range,
      empty_delivery: committedAdmission.empty_delivery === true,
      slice_level_review: true,

      worker_attempt_base_sha: target.diff_base_sha,
      source_worker_run_id: status.run_id,
      source_worker_monitor_handle: status.monitor_handle ?? status.run_id,
      source_worker_subject: status.subject,
      worktree_identity: committedAdmission.identity,
      worktree_identity_digest: digestTrustedExactReviewEvidence(committedAdmission.identity),
      reviewer_dependency_binds: reviewerDependencyProjection.read_only_binds,
      review_evidence_semantics: "append_only_advisory"
    });
    frozenSliceReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  async function resolveSliceReviewEvidenceSet({ subject } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null || context.slice_level_review !== true) return null;
    const targetKey = sliceReviewTargetKey(context);
    const applicableRuns = [...sliceReviewRunContexts.entries()]
      .filter(([, runContext]) => sliceReviewTargetKey(runContext) === targetKey)
      .map(([runId]) => runs.get(runId))
      .filter(Boolean);
    const activeRuns = applicableRuns.filter((record) => record.terminal !== true);
    const receipts = exactSliceReviewReceiptStore === null
      ? []
      : await exactSliceReviewReceiptStore.loadAll({
          unit_address: subject,
          ...(context.committed_target_digest
            ? { committed_target_digest: context.committed_target_digest }
            : {})
        });
    const receiptByRun = new Map(receipts.map((receipt) => [receipt.review_run_id, receipt]));
    const terminalRunsWithoutReceipt = applicableRuns
      .filter((record) => record.terminal === true && !receiptByRun.has(record.run_id));
    const cleanReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "clean" &&
      receipt.structured_outcome.clean_review === true
    );
    const findingReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "changes_requested"
    );
    const invalidReceipts = receipts.filter((receipt) =>
      !receiptCarriesUsableReviewVerdict(receipt) || receipt.structured_outcome === null
    );
    const activeReviewRunIds = activeRuns.map((record) => record.run_id).sort();
    const cleanReviewRunIds = cleanReceipts.map((receipt) => receipt.review_run_id).sort();
    const findingsReviewRunIds = findingReceipts.map((receipt) => receipt.review_run_id).sort();
    const invalidReviewRunIds = [
      ...invalidReceipts.map((receipt) => receipt.review_run_id),
      ...terminalRunsWithoutReceipt.map((record) => record.run_id)
    ].sort();
    return Object.freeze({
      schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
      unit_address: context.review_subject,
      initiative: context.initiative,
      slice_ref: context.slice_ref,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      ...(context.review_admission_kind === "canonical_committed_slice"
        ? {
            review_admission_kind: context.review_admission_kind,
            committed_target_digest: context.committed_target_digest
          }
        : { source_worker_run_id: context.source_worker_run_id }),
      active_review_run_ids: Object.freeze(activeReviewRunIds),
      clean_review_run_ids: Object.freeze(cleanReviewRunIds),
      findings_review_run_ids: Object.freeze(findingsReviewRunIds),
      invalid_review_run_ids: Object.freeze(invalidReviewRunIds),
      reviews: Object.freeze(receipts.map((receipt) => Object.freeze({
        run_id: receipt.review_run_id,
        monitor_handle: receipt.review_monitor_handle,
        role: receipt.reviewer_role,
        terminal_disposition: receipt.terminal_run_status,
        structured_result_digest: receipt.trusted_evidence_digest,
        outcome: receipt.structured_outcome?.outcome ?? null,
        findings: Object.freeze((receipt.structured_outcome?.findings ?? []).map((finding) =>
          deepFreezeCanonicalSnapshot(finding)
        )),
        finding_counts: receipt.structured_outcome?.finding_counts
          ? deepFreezeCanonicalSnapshot(receipt.structured_outcome.finding_counts)
          : null
      }))),
      observation_complete: activeReviewRunIds.length === 0 &&
        terminalRunsWithoutReceipt.length === 0,
      authority: "advisory_only"
    });
  }

  const runPostWorkerSliceLifecycle = postWorkerSliceLifecycle === null
    ? null
    : async ({ workspace, status }) => postWorkerSliceLifecycle({
        workspace,
        status,
        deps: {
          resolveManagedRunBinding,
          resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
            resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
          bindFrozenReviewContext,

          resolveCanonicalSliceReviewUnit: ({ mainRepo, subject }) =>
            resolveCanonicalSliceReviewUnit(mainRepo, subject),
          bindFrozenSliceReviewContext,

          resolveCommittedSliceIntegrationContinuation,

          retireManagedWorkerIdentity
        }
      });

  const startSliceReviewLaunch = async (input, boundContext) => {
    const context = boundContext;
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_workspace_mismatch"
      });
    }
    try {
      const currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
      if (currentUnit.subject !== context.review_subject ||
          currentUnit.record_id !== context.record_id ||
          currentUnit.slice_id !== context.review_slice_id ||
          currentUnit.initiative !== context.initiative ||
          currentUnit.parent_status === "review" ||
          currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          currentUnit.review_unit_contract !== context.review_unit_contract) {
        throw new Error("canonical parent WK or implementation review unit changed after the slice target was frozen");
      }
    } catch (error) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_stale_or_mismatched",
        message: error?.message ?? String(error)
      });
    }
    const targetVerification = verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    });
    if (targetVerification.ok !== true) {
      if (targetVerification.kind === "transport") {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "slice_context_review",
          reason: "frozen_slice_review_context_probe_transport_failure",
          detail: targetVerification.detail
        });
      }
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_stale_or_mismatched",
        detail: targetVerification.detail
      });
    }
    if (context.review_admission_kind === "canonical_committed_slice") {
      try {
        const currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
        const currentAdmission = resolveCommittedSliceReviewAdmission({
          mainRepo: context.main_repo,
          worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
          subject: context.review_subject,
          reviewUnit: currentUnit,
          runGit: reviewContextRunGit
        });
        if (currentAdmission.committed_target_digest !== context.committed_target_digest ||
            currentAdmission.worktree_path !== context.worktree_path ||
            currentAdmission.target.sha !== context.reviewed_sha ||
            currentAdmission.target.diff_base_sha !== context.diff_base_sha) {
          throw new Error("canonical committed-slice admission changed before spawn");
        }
      } catch (error) {
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "slice_context_review",
          reason: "frozen_slice_review_context_stale_or_mismatched",
          message: error?.message ?? String(error)
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
        reviewer_dependency_binds: context.reviewer_dependency_binds ?? [],
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          frozen_slice_review_target: Object.freeze({
            ref: context.slice_ref,
            sha: context.reviewed_sha,
            diff_base_sha: context.diff_base_sha,
            diff_head_sha: context.diff_head_sha,
            diff_range: context.diff_range,
            empty_delivery: context.empty_delivery === true,
            slice_level_review: true
          })
        })
      });
    } catch (error) {
      throw error;
    }
    if (launch?.accepted === true) {
      sliceReviewRunContexts.set(launch.run_id, context);
      const launchedRecord = runs.get(launch.run_id) ?? null;
      if (launchedRecord !== null) {
        await captureSliceReviewTerminalResult({ record: launchedRecord });
      }
    } else {

      if (launch?.refusal?.reason === "reviewer_model_unset" &&
          !existsSync(path.join(context.main_repo, AGENT_LAUNCH_ROLE_CONFIG_FILENAME))) {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "slice_context_review",
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

  const isLauncherOwnedExactSliceReviewAdmission = ({ subject, workspace_dir: workspaceDir } = {}) => {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null || context.slice_level_review !== true ||
        path.resolve(workspaceDir ?? "") !== context.main_repo) return false;
    try {
      const current = resolveCanonicalSliceReviewUnit(context.main_repo, subject);
      if (current.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          current.review_unit_contract !== context.review_unit_contract) return false;
      return verifyFrozenSliceReviewTargetAgainstObjectStore({
        mainRepo: context.main_repo,
        context,
        runGit: reviewContextRunGit
      }).ok === true;
    } catch {
      return false;
    }
  };

  const prepareCanonicalCommittedSliceReviewAdmission = async ({
    subject,
    workspace_dir: workspaceDir
  } = {}) => {
    if (!worktreeProvisioningConfig || postWorkerSliceLifecycle === null ||
        typeof subject !== "string" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject) ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig.mainRepo) {
      return Object.freeze({ ok: false, reason: "canonical_committed_slice_review_unavailable" });
    }
    try {
      const reviewUnit = resolveCanonicalSliceReviewUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit,
        runGit: reviewContextRunGit
      });
      const context = Object.freeze({
        schema_version: "workspace-agent-frozen-slice-review-context.v1",
        review_admission_kind: admission.review_admission_kind,
        empty_delivery: admission.empty_delivery === true,
        committed_target_digest: admission.committed_target_digest,
        review_subject: subject,
        record_id: reviewUnit.record_id,
        review_slice_id: reviewUnit.slice_id,
        initiative: reviewUnit.initiative,
        canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
        review_unit_contract: reviewUnit.review_unit_contract,
        trusted_frozen_review_contract: createTrustedFrozenSliceReviewContract(reviewUnit),
        main_repo: worktreeProvisioningConfig.mainRepo,
        worktree_path: admission.worktree_path,
        slice_ref: admission.target.ref,
        reviewed_sha: admission.target.sha,
        diff_base_sha: admission.target.diff_base_sha,
        diff_head_sha: admission.target.sha,
        diff_range: admission.target.diff_range,
        slice_level_review: true,
        worktree_identity: admission.identity,
        worktree_identity_digest: digestTrustedExactReviewEvidence(admission.identity),
        review_evidence_semantics: "append_only_advisory"
      });
      const raced = frozenSliceReviewContexts.get(subject) ?? null;
      if (raced !== null && sliceReviewTargetKey(raced) === sliceReviewTargetKey(context)) {
        return Object.freeze({
          ok: true,
          reason: null,
          reviewed_sha: raced.reviewed_sha,
          committed_target_digest: raced.committed_target_digest
        });
      }
      frozenSliceReviewContexts.set(subject, context);
      return Object.freeze({
        ok: true,
        reviewed_sha: context.reviewed_sha,
        committed_target_digest: context.committed_target_digest
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        reason: error?.detail?.reason ?? "canonical_committed_slice_review_refused",
        code: error?.code ?? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
    }
  };

  return {
    resolveManagedRunBinding,
    bindFrozenSliceReviewContext,
    resolveSliceReviewEvidenceSet,
    runPostWorkerSliceLifecycle,
    startSliceReviewLaunch,
    isLauncherOwnedExactSliceReviewAdmission,
    prepareCanonicalCommittedSliceReviewAdmission
  };
}
