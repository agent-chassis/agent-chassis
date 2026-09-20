import { realpathSync } from "node:fs";
import path from "node:path";

import { effectiveWorkRecordMaterialRefs } from
  "@agent-chassis/wiki-core/src/lib/work-record-entry-material.mjs";

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

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wellFormedSlice(slice) {
  return plainObject(slice) && typeof slice.id === "string" && slice.id.length > 0;
}

function canonicalSubjectContext(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(SUBJECT_RE) : null;
  if (match === null) fail("canonical_subject_malformed");
  const recordId = match[1];
  const sliceId = match[2] ?? null;
  const record = readCanonicalWorkRecord(mainRepo, recordId);
  if (record === null || record === undefined) fail("canonical_subject_unavailable");
  if (!plainObject(record)) fail("canonical_subject_shape_invalid", { field: "record" });
  if (typeof record.id !== "string") fail("canonical_subject_shape_invalid", { field: "id" });
  if (record.id !== recordId) fail("canonical_subject_identity_mismatch", { field: "id" });

  const hasSlices = record.slices !== undefined && record.slices !== null;
  if (hasSlices && (!Array.isArray(record.slices) || !record.slices.every(wellFormedSlice))) {
    fail("canonical_subject_shape_invalid", { field: "slices" });
  }
  let selected = record;
  if (sliceId !== null) {
    const matches = hasSlices ? record.slices.filter((slice) => slice.id === sliceId) : [];
    if (matches.length > 1) {
      fail("canonical_subject_selection_ambiguous",
        { field: "slices", match_count: matches.length });
    }
    if (matches.length === 0) fail("canonical_subject_unavailable");
    selected = matches[0];
  }
  return Object.freeze({ record, selected, record_id: recordId, slice_id: sliceId });
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
        ...(error?.detail ?? {}),

        cause_code: error?.code ?? null
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

function canonicalDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  try {
    return realpathSync(value);
  } catch {
    return null;
  }
}

function dispatchRepositoryIdentity(mainRepo, resolveConfiguredWorkspaceRepo, alias) {
  if (typeof alias !== "string" || alias.length === 0 || alias.trim() !== alias ||
      typeof resolveConfiguredWorkspaceRepo !== "function") {
    return null;
  }
  let configured;
  try {
    configured = resolveConfiguredWorkspaceRepo(alias);
  } catch {
    return null;
  }
  if (configured?.repo !== alias || typeof configured?.dir !== "string") return null;
  const configuredDir = canonicalDirectory(configured.dir);
  if (configuredDir === null || configuredDir !== canonicalDirectory(mainRepo)) {
    fail("review_repository_binding_mismatch");
  }
  return alias;
}

function candidateRefusalDetail(selection) {
  const refusal = selection?.refusal?.refusal ?? selection?.refusal ?? null;
  return Object.freeze({
    candidate_refusal: refusal === null ? null : Object.freeze({
      code: refusal.code ?? null,
      reason: refusal.reason ?? null,
      detail: refusal.detail ?? null
    })
  });
}

export function createWorkspaceAgentAdvisoryReviewPipeline({
  lifecycle,
  worktreeProvisioningConfig,
  runGit,
  resolveTerminalCandidate = null,

  resolveConfiguredWorkspaceRepo = null
} = {}) {
  const mainRepo = worktreeProvisioningConfig?.mainRepo ?? null;
  const worktreeRoot = worktreeProvisioningConfig?.worktreeRoot ?? null;

  async function resolveMaterial(input = {}) {
    const { subject, diff_base_sha: diffBaseSha, reviewed_sha: reviewedSha } = input;
    if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
        typeof worktreeRoot !== "string" || !path.isAbsolute(worktreeRoot)) {
      fail("review_repository_unavailable");
    }
    const context = canonicalSubjectContext(mainRepo, subject);

    const materialRepository = () =>
      effectiveWorkRecordMaterialRefs(context.record, context.selected).length === 0
        ? null
        : dispatchRepositoryIdentity(mainRepo, resolveConfiguredWorkspaceRepo,
          input.workspace_alias);
    const hasBase = diffBaseSha !== undefined;
    const hasReviewed = reviewedSha !== undefined;
    if (hasBase !== hasReviewed) fail("locator_pair_incomplete");

    let selector = "canonical_design";
    let selectedBase = diffBaseSha;
    let selectedReviewed = reviewedSha;
    let reviewUnit = Object.freeze({ subject });
    let designCapture = null;

    if (hasBase) {
      selector = "explicit_sha_range";
    } else if (context.slice_id !== null &&
        context.selected.review_purpose === "terminal_whole_wk") {

      selector = "launcher_terminal_candidate";
      if (typeof resolveTerminalCandidate !== "function") {
        fail("terminal_candidate_selection_unavailable");
      }
      const selection = await resolveTerminalCandidate({
        subject,
        record_id: context.record_id,
        slice_id: context.slice_id
      });
      if (selection?.ok !== true) {
        fail("terminal_candidate_unavailable", candidateRefusalDetail(selection));
      }
      selectedBase = selection.candidate.diff_base_sha;
      selectedReviewed = selection.candidate.reviewed_sha;
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
        initiallyAuthenticatedRecord: context.record,
        selectedSliceId: context.slice_id,
        repository: materialRepository()
      });
      const current = currentCommitRange(runGit, mainRepo);
      selectedBase = current.diff_base_sha;
      selectedReviewed = current.reviewed_sha;
    }

    if (designCapture === null && ((context.record.sections?.material_refs?.length ?? 0) > 0 ||
        (context.selected.sections?.material_refs?.length ?? 0) > 0)) {
      designCapture = await captureCanonicalDesignReviewInputs({
        mainRepo,
        recordId: context.record_id,
        initiallyAuthenticatedRecord: context.record,
        selectedSliceId: context.slice_id,
        repository: materialRepository()
      });
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
        selected: resolvedMaterial.context.selected,
        entryMaterial: resolvedMaterial.design_capture?.entry_material ?? null
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
