import path from "node:path";

import {
  readCanonicalWorkRecord
} from "./backend-scope-authority.mjs";
import {
  materializeImmutableAdvisoryReviewTarget,
  resolveImmutableAdvisoryReviewTarget
} from "./backend-review-target-resolver.mjs";
import {
  captureCanonicalDesignReviewInputs,
  materializeCanonicalDesignReviewInputs
} from "./findings-design-review-materialization.mjs";
import {
  createAdvisoryReviewDescriptor,
  createAdvisoryReviewInput,
  renderAdvisoryReviewBrief
} from "./workspace-agent-advisory-review-contract.mjs";

export const ADVISORY_REVIEW_PIPELINE_SCHEMA_VERSION =
  "workspace-agent-advisory-review-pipeline.v1";
export const ADVISORY_REVIEW_MATERIAL_INVALID =
  "agent_launch.advisory_review.material_invalid.v1";

const SUBJECT_RE = /^(WK-\d{4})(?:#(SLICE-\d{3}))?$/u;
const resolvedMaterials = new WeakSet();

function fail(reason, detail = null) {
  const error = new Error("advisory review material could not be resolved");
  error.code = ADVISORY_REVIEW_MATERIAL_INVALID;
  error.detail = Object.freeze({ reason, ...(detail ?? {}) });
  throw error;
}

function git(runGit, repo, args, reason) {
  const result = runGit({ repo, args });
  if (result?.ok !== true) fail(reason);
  return String(result.stdout ?? "").trim();
}

function canonicalSubjectContext(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(SUBJECT_RE) : null;
  if (match === null) fail("canonical_subject_malformed");
  let record;
  try {
    record = readCanonicalWorkRecord(mainRepo, match[1]);
  } catch (error) {
    fail("canonical_subject_unavailable", { cause_code: error?.code ?? null });
  }
  const selected = match[2] === undefined
    ? record
    : record?.slices?.find((slice) => slice?.id === match[2]) ?? null;
  if (selected === null || selected === undefined) fail("canonical_subject_unavailable");
  return Object.freeze({ record, selected, record_id: match[1], slice_id: match[2] ?? null });
}

function currentCommitRange(runGit, mainRepo) {
  const reviewed = git(runGit, mainRepo, ["rev-parse", "--verify", "HEAD^{commit}"],
    "canonical_review_commit_unavailable");
  const parent = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `${reviewed}^`] });
  return Object.freeze({
    reviewed_sha: reviewed,
    diff_base_sha: parent?.ok === true ? String(parent.stdout ?? "").trim() : reviewed
  });
}

function refusal(error) {
  const reason = error?.detail?.reason ?? error?.code ?? "advisory_review_material_invalid";
  return Object.freeze({
    schema_version: ADVISORY_REVIEW_PIPELINE_SCHEMA_VERSION,
    accepted: false,
    run_id: null,
    monitor_handle: null,
    blocker: Object.freeze({
      code: ADVISORY_REVIEW_MATERIAL_INVALID,
      reason,
      detail: Object.freeze({
        cause_code: error?.code ?? null,
        ...(error?.detail ?? {})
      })
    }),
    refusal: Object.freeze({
      code: ADVISORY_REVIEW_MATERIAL_INVALID,
      reason,
      authority_limb: "mechanical_failure",
      effects_started: false
    })
  });
}

export function createWorkspaceAgentAdvisoryReviewPipeline({
  lifecycle,
  worktreeProvisioningConfig,
  runGit
} = {}) {
  const mainRepo = worktreeProvisioningConfig?.mainRepo ?? null;
  const worktreeRoot = worktreeProvisioningConfig?.worktreeRoot ?? null;

  async function resolveMaterial({ subject, diff_base_sha: diffBaseSha,
    reviewed_sha: reviewedSha, terminal_candidate: terminalCandidate = null } = {}) {
    if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
        typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot)) {
      fail("review_repository_unavailable");
    }
    const context = canonicalSubjectContext(mainRepo, subject);
    const hasBase = diffBaseSha !== undefined;
    const hasReviewed = reviewedSha !== undefined;
    if (hasBase !== hasReviewed) fail("locator_pair_incomplete");

    let selector = "canonical_design";
    let selectedBase = diffBaseSha;
    let selectedReviewed = reviewedSha;
    let reviewUnit = Object.freeze({ subject });
    let designCapture = null;

    if (terminalCandidate !== null) {
      selector = "launcher_terminal_candidate";
      selectedBase = terminalCandidate.diff_base_sha ??
        terminalCandidate.binding?.base ?? terminalCandidate.review_target?.diff_base_sha;
      selectedReviewed = terminalCandidate.reviewed_sha ??
        terminalCandidate.binding?.candidate ?? terminalCandidate.review_target?.candidate_sha ??
        terminalCandidate.review_target?.sha;
    } else if (hasBase) {
      selector = "explicit_sha_range";
    } else if (context.slice_id !== null &&
        Array.isArray(context.selected.write_scope) && context.selected.write_scope.length > 0) {
      selector = "canonical_implementation_slice";
      reviewUnit = Object.freeze({
        subject,
        initiative: context.record.initiative,
        record_id: context.record_id,
        slice_id: context.slice_id
      });
    } else {
      designCapture = await captureCanonicalDesignReviewInputs({
        mainRepo,
        recordId: context.record_id,
        initiallyAuthenticatedRecord: context.record
      });
      const current = currentCommitRange(runGit, mainRepo);
      selectedBase = current.diff_base_sha;
      selectedReviewed = current.reviewed_sha;
    }

    const normalized = resolveImmutableAdvisoryReviewTarget({
      mainRepo,
      subject,
      reviewUnit,
      reviewedSha: selectedReviewed,
      diffBaseSha: selectedBase,
      allowEmpty: !hasBase && selector === "canonical_design",
      runGit
    });
    const frozenInputPaths = designCapture === null
      ? []
      : designCapture.files.map(({ path: inputPath }) => inputPath);
    const resolved = Object.freeze({
      context,
      normalized_target: normalized,
      design_capture: designCapture,
      material_kind: selector,
      material_paths: Object.freeze(frozenInputPaths)
    });
    resolvedMaterials.add(resolved);
    return resolved;
  }

  async function executeResolved({ role, input, resolvedMaterial } = {}) {
    const subject = input?.subject;
    if (role !== "reviewer" && role !== "redteam") {
      fail("advisory_review_role_invalid");
    }
    if (!resolvedMaterials.has(resolvedMaterial) ||
        resolvedMaterial?.context === undefined) {
      fail("resolved_material_untrusted");
    }
    const descriptor = createAdvisoryReviewDescriptor({
      role,
      subject,
      repository: mainRepo,
      materialKind: resolvedMaterial.material_kind,
      diffBaseSha: resolvedMaterial.normalized_target.diff_base_sha,
      reviewedSha: resolvedMaterial.normalized_target.reviewed_sha,
      reviewedTreeSha: resolvedMaterial.normalized_target.reviewed_tree_sha,
      immutableSourceIdentity: resolvedMaterial.normalized_target.immutable_source_identity,
      reviewBrief: renderAdvisoryReviewBrief({
        role,
        subject,
        parent: resolvedMaterial.context.record,
        selected: resolvedMaterial.context.selected
      }),
      formalResultContract: input.formal_result_contract ?? null,
      materialPaths: resolvedMaterial.material_paths
    });
    const materialized = materializeImmutableAdvisoryReviewTarget({
      normalizedTarget: resolvedMaterial.normalized_target,
      worktreeRoot,
      runGit
    });
    let launched;
    try {
      if (resolvedMaterial.design_capture !== null) {
        materializeCanonicalDesignReviewInputs({
          capture: resolvedMaterial.design_capture,
          checkoutPath: materialized.private_snapshot.worktree_path
        });
      }
      const reviewInput = createAdvisoryReviewInput({
        descriptor,
        checkoutRoot: materialized.private_snapshot.worktree_path,
        toolProfile: role
      });
      launched = await lifecycle.startAdvisoryProcess({
        caller_session_id: input.caller_session_id ?? null,
        role,
        subject,
        workspace_alias: input.workspace_alias ?? null,
        app: input.app ?? null,
        model: input.model ?? null,
        advisory_review_input: reviewInput,
        cleanup: materialized.cleanup
      });
    } catch (error) {
      materialized.cleanup({
        primaryErrorCode: typeof error?.code === "string" ? error.code : null
      });
      throw error;
    }
    if (launched?.accepted !== true) materialized.cleanup();
    return Object.freeze({
      ...launched,
      advisory_review_material: Object.freeze({
        schema_version: descriptor.schema_version,
        role: descriptor.role,
        subject: descriptor.subject,
        repository: descriptor.repository,
        material_kind: descriptor.material_kind,
        base_sha: descriptor.base_sha,
        reviewed_sha: descriptor.reviewed_sha,
        reviewed_tree: descriptor.reviewed_tree_sha,
        material_digest: descriptor.descriptor_digest,
      }),
      review_materialization: Object.freeze({
        private: true,
        read_only: true
      })
    });
  }

  async function execute(input = {}) {
    try {
      const resolvedMaterial = await resolveMaterial(input);
      return await executeResolved({ role: input.role, input, resolvedMaterial });
    } catch (error) {
      return refusal(error);
    }
  }

  return Object.freeze({ execute, executeResolved, resolveMaterial });
}
