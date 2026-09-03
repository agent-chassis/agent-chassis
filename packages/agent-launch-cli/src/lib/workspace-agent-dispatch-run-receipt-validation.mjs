import { createHash } from "node:crypto";
import path from "node:path";
import {
  COMMITTED_SLICE_WORKTREE_FIELDS,
  DIGEST_RE,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4,
  FINDING_COUNT_FIELDS,
  FINDING_SEVERITIES,
  FINDINGS_DEPENDENCY_PROJECTION_EVIDENCE_SCHEMA_VERSION,
  INITIATIVE_RE,
  OID_RE,
  OPAQUE_ID_RE,
  OPTIONAL_RECEIPT_FIELDS,
  PROOF_STATES,
  RECEIPT_CLEANUP_ONLY_FIELD,
  RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD,
  RECEIPT_FIELDS,
  RECEIPT_FIELDS_V2,
  RECEIPT_FIELDS_V3,
  RECEIPT_NO_VERDICT_EVIDENCE_VALUES,
  RECEIPT_OUTCOMES,
  RECEIPT_RESULT_MODE_FIELD,
  RECEIPT_STATES,
  RECEIPT_VERDICT_EVIDENCE_FIELD,
  RECEIPT_VERDICT_EVIDENCE_STATES,
  REVIEW_RESULT_FIELDS,
  RUN_STATUSES,
  TERMINAL_STATUSES,
  UNIT_RE,
  V1_WORKTREE_FIELDS,
  V2_WORKTREE_FIELDS,
  VERDICT_EVIDENCE_VALUES,
  receiptCompletesExactSliceReview,
  ATTEMPT_LINEAGE_IDENTITY_FIELDS,
  ATTEMPT_LINEAGE_IDENTITY_SCHEMA_VERSION,
  ATTEMPT_LINEAGE_ID_RE,
  IDENTITY_GENERATION_DIGEST_RE,
  RECOVERY_TRANSITION_IDENTITY_FIELDS,
  RECOVERY_TRANSITION_IDENTITY_SCHEMA_VERSION,
  RECOVERY_TRANSITION_ID_RE,
  REVIEW_DISPATCH_IDENTITY_FIELDS,
  REVIEW_DISPATCH_IDENTITY_SCHEMA_VERSION,
  REVIEW_DISPATCH_ID_RE,
  RECEIPT_FIELDS_V4,
  STANDALONE_FINDINGS_WORKTREE_FIELDS,
  IMMUTABLE_COMMIT_RANGE_WORKTREE_FIELDS
} from "./workspace-agent-dispatch-run-receipt-schema.mjs";
import {
  WORKSPACE_AGENT_RESULT_MODES,
  validateWorkspaceAgentResultModeEnvelope
} from "./workspace-agent-dispatch-result-mode.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const DEPENDENCY_PROJECTION_EVIDENCE_FIELDS = Object.freeze([
  "schema_version", "selected", "unavailability_reason", "projection_identity",
  "installation_digest", "retained_projection_root", "mount_destination",
  "frozen_read_only_binds"
]);
const DEPENDENCY_PROJECTION_UNAVAILABLE_REASON_VALUES = new Set([
  "dependency_root_unavailable",
  "dependency_path_absent",
  "dependency_path_redirected",
  "dependency_state_unstable",
  "checkout_dependency_tree_present"
]);

function assertDependencyProjectionEvidence(evidence, worktreePath) {
  if (!hasExactKeys(evidence, DEPENDENCY_PROJECTION_EVIDENCE_FIELDS) ||
      evidence.schema_version !==
        FINDINGS_DEPENDENCY_PROJECTION_EVIDENCE_SCHEMA_VERSION ||
      typeof evidence.selected !== "boolean" ||
      evidence.mount_destination !== path.join(worktreePath, "node_modules") ||
      !Array.isArray(evidence.frozen_read_only_binds)) {
    throw new Error("exact slice review receipt carries malformed dependency projection evidence");
  }
  const validBind = (bind) => hasExactKeys(bind, ["src", "dst"]) &&
    typeof bind.src === "string" && path.isAbsolute(bind.src) &&
    typeof bind.dst === "string" && path.isAbsolute(bind.dst);
  if (evidence.frozen_read_only_binds.some((bind) => !validBind(bind))) {
    throw new Error("exact slice review receipt carries malformed dependency projection binds");
  }
  if (evidence.selected === false) {
    if (!DEPENDENCY_PROJECTION_UNAVAILABLE_REASON_VALUES.has(
      evidence.unavailability_reason
    ) || evidence.projection_identity !== null ||
        evidence.installation_digest !== null ||
        evidence.retained_projection_root !== null ||
        evidence.frozen_read_only_binds.length !== 0) {
      throw new Error("exact slice review receipt carries inconsistent unselected dependency evidence");
    }
    return;
  }
  if (evidence.unavailability_reason !== null ||
      !DIGEST_RE.test(evidence.projection_identity ?? "") ||
      !DIGEST_RE.test(evidence.installation_digest ?? "") ||
      typeof evidence.retained_projection_root !== "string" ||
      !path.isAbsolute(evidence.retained_projection_root) ||
      !evidence.frozen_read_only_binds.some((bind) =>
        bind.src === evidence.retained_projection_root &&
        bind.dst === evidence.mount_destination)) {
    throw new Error("exact slice review receipt carries inconsistent selected dependency evidence");
  }
}

export function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length &&
    actual.every((field, index) => field === required[index]);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

const IDENTITY_TARGET_FIELDS = Object.freeze([
  "unit_address", "record_id", "slice_id", "initiative", "review_admission_kind",
  "target_ref", "committed_target_digest", "reviewed_sha", "diff_base_sha"
]);
const IDENTITY_GENERATION_FIELDS = Object.freeze(["generation_digest", "manifest_digest"]);
const FORBIDDEN_IDENTITY_AUTHORITY_FIELDS = new Set([
  "caller_supplied_identity", "caller_supplied_dispatch_id", "caller_supplied_attempt_id",
  "caller_supplied_transition_id", "repair_authority", "repair_token", "authority_source"
]);

function assertNoCallerAuthority(value) {
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_IDENTITY_AUTHORITY_FIELDS.has(key)) {
      throw new Error("review identity cannot carry caller-supplied identity or repair authority");
    }
    assertNoCallerAuthority(child);
  }
}

function assertIdentityTarget(target) {
  assertExactKeys(target, IDENTITY_TARGET_FIELDS, "identity target");
  assertString(target.unit_address, "identity target.unit_address", UNIT_RE);
  const unit = UNIT_RE.exec(target.unit_address);
  if (target.record_id !== unit[1] || target.slice_id !== unit[2]) {
    throw new Error("review identity target address is inconsistent");
  }
  assertString(target.record_id, "identity target.record_id");
  assertString(target.slice_id, "identity target.slice_id");
  assertString(target.initiative, "identity target.initiative", INITIATIVE_RE);
  if (!new Set(["canonical_committed_slice", "terminal_whole_wk_candidate",
    "standalone_findings", "immutable_commit_range"]).has(
    target.review_admission_kind
  )) {
    throw new Error("review identity target admission kind is invalid");
  }
  assertString(target.target_ref, "identity target.target_ref");
  assertString(target.committed_target_digest, "identity target.committed_target_digest", DIGEST_RE);
  assertString(target.reviewed_sha, "identity target.reviewed_sha", OID_RE);
  assertString(target.diff_base_sha, "identity target.diff_base_sha", OID_RE);
  const unitMatch = UNIT_RE.exec(target.unit_address);
  if (unitMatch === null || unitMatch[1] !== target.record_id ||
      unitMatch[2] !== target.slice_id) {
    throw new Error("review identity target unit binding is inconsistent");
  }
  const expectedTargetRef = target.review_admission_kind === "canonical_committed_slice"
    ? `refs/heads/slice/${target.initiative}/${target.record_id}/${target.slice_id}`
    : target.review_admission_kind === "terminal_whole_wk_candidate"
      ? `refs/agent-launch/terminal-current-v2/${target.record_id}`
      : target.target_ref;
  if (target.review_admission_kind === "standalone_findings" &&
      !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(target.target_ref)) {
    throw new Error("standalone findings review identity target ref is invalid");
  }
  if (target.target_ref !== expectedTargetRef) {
    throw new Error("review identity target ref is inconsistent");
  }
}

function assertIdentityGeneration(generation, field) {
  assertExactKeys(generation, IDENTITY_GENERATION_FIELDS, `${field} generation`);
  assertString(generation.generation_digest,
    `${field}.generation_digest`, IDENTITY_GENERATION_DIGEST_RE);
  if (generation.manifest_digest !== null) {
    assertString(generation.manifest_digest, `${field}.manifest_digest`, DIGEST_RE);
  }
  if ((generation.generation_digest === "controlled-contract-generation:none") !==
      (generation.manifest_digest === null)) {
    throw new Error(`review identity ${field} generation/manifest binding is invalid`);
  }
}

export function validateReviewDispatchIdentity(identity) {
  assertNoCallerAuthority(identity);
  assertExactKeys(identity, REVIEW_DISPATCH_IDENTITY_FIELDS, "review-dispatch identity");
  if (identity.schema_version !== REVIEW_DISPATCH_IDENTITY_SCHEMA_VERSION ||
      identity.kind !== "review_dispatch") {
    throw new Error("review-dispatch identity schema is unsupported");
  }
  assertString(identity.review_dispatch_id, "review_dispatch_id", REVIEW_DISPATCH_ID_RE);
  assertIdentityTarget(identity.target);
  assertIdentityGeneration(identity.current_generation, "current");
  return Object.freeze(identity);
}

export function validateAttemptLineageIdentity(identity) {
  assertNoCallerAuthority(identity);
  assertExactKeys(identity, ATTEMPT_LINEAGE_IDENTITY_FIELDS, "attempt-lineage identity");
  if (identity.schema_version !== ATTEMPT_LINEAGE_IDENTITY_SCHEMA_VERSION ||
      identity.kind !== "attempt_lineage") {
    throw new Error("attempt-lineage identity schema is unsupported");
  }
  assertString(identity.review_dispatch_id, "review_dispatch_id", REVIEW_DISPATCH_ID_RE);
  assertString(identity.attempt_id, "attempt_id", ATTEMPT_LINEAGE_ID_RE);
  if (!Number.isSafeInteger(identity.attempt_number) || identity.attempt_number < 1) {
    throw new Error("attempt-lineage identity attempt_number is invalid");
  }
  assertIdentityTarget(identity.target);
  assertIdentityGeneration(identity.current_generation, "current");
  assertString(identity.run_id, "run_id", OPAQUE_ID_RE);
  assertString(identity.monitor_handle, "monitor_handle", OPAQUE_ID_RE);
  return Object.freeze(identity);
}

export function validateRecoveryTransitionIdentity(identity) {
  assertNoCallerAuthority(identity);
  assertExactKeys(identity, RECOVERY_TRANSITION_IDENTITY_FIELDS, "recovery-transition identity");
  if (identity.schema_version !== RECOVERY_TRANSITION_IDENTITY_SCHEMA_VERSION ||
      identity.kind !== "recovery_transition" ||
      !new Set(["retry", "recovery", "replacement"]).has(identity.transition_type)) {
    throw new Error("recovery-transition identity schema is unsupported");
  }
  assertString(identity.transition_id, "transition_id", RECOVERY_TRANSITION_ID_RE);
  assertString(identity.review_dispatch_id, "review_dispatch_id", REVIEW_DISPATCH_ID_RE);
  assertString(identity.prior_attempt_id, "prior_attempt_id", ATTEMPT_LINEAGE_ID_RE);
  assertString(identity.next_attempt_id, "next_attempt_id", ATTEMPT_LINEAGE_ID_RE);
  assertIdentityTarget(identity.target);
  assertIdentityGeneration(identity.prior_generation, "prior");
  assertIdentityGeneration(identity.next_generation, "next");
  if (identity.transition_type === "replacement" && identity.prior_attempt_id === identity.next_attempt_id) {
    throw new Error("replacement transition requires a distinct attempt identity");
  }
  if (canonicalJson(identity.next_generation) !== canonicalJson(identity.prior_generation)) {
    throw new Error("recovery transition generation is stale");
  }
  return Object.freeze(identity);
}

export function assertIdentityTargetBinding(identity, target, generation) {
  const expected = canonicalJson(target);
  if (canonicalJson(identity.target) !== expected ||
      canonicalJson(identity.current_generation ?? identity.next_generation) !== canonicalJson(generation)) {
    throw new Error("review identity target or current generation binding mismatch");
  }
}

export function digestTrustedExactReviewEvidence(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function assertString(value, field, pattern = null) {
  if (typeof value !== "string" || value.length === 0 ||
      (pattern !== null && !pattern.test(value))) {
    throw new Error(`exact slice review receipt requires canonical ${field}`);
  }
}

function assertExactKeys(value, expected, label) {
  if (!hasExactKeys(value, expected)) {
    throw new Error(`exact slice review receipt ${label} must carry exactly ${expected.join(", ")}`);
  }
}

function assertCanonicalRepoPaths(value, field, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((entry) =>
    typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
    path.posix.isAbsolute(entry) || entry.includes("\\") || path.posix.normalize(entry) !== entry ||
    entry === "." || entry.split("/").some((part) => !part || part === "." || part === "..")
  ) || value.some((entry, index) => index > 0 && value[index - 1] >= entry)) {
    throw new Error(`exact slice review receipt worktree_identity ${field} is not canonical`);
  }
}

function assertWorktreeIdentity(receipt) {
  const identity = receipt.worktree_identity;
  if (receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 &&
      receipt.review_admission_kind === "immutable_commit_range") {
    assertExactKeys(identity, IMMUTABLE_COMMIT_RANGE_WORKTREE_FIELDS, "worktree_identity");
    const repository = identity.repository_identity;
    if (identity.schema_version !== "workspace-agent-normalized-slice-review-identity.v1" ||
        identity.unit_address !== receipt.unit_address ||
        identity.initiative !== receipt.initiative || identity.record_id !== receipt.record_id ||
        identity.slice_id !== receipt.slice_id || identity.reviewed_sha !== receipt.reviewed_sha ||
        identity.diff_base_sha !== receipt.diff_base_sha ||
        identity.worktree_path !== receipt.worktree_path ||
        identity.committed_target_digest !== receipt.committed_target_digest ||
        identity.immutable_source_identity !== receipt.committed_target_digest ||
        !isPlainObject(repository) || !path.isAbsolute(repository.repository_path ?? "") ||
        !path.isAbsolute(repository.git_directory ?? "") ||
        !OID_RE.test(identity.reviewed_tree_sha ?? "") ||
        !OID_RE.test(identity.snapshot_commit ?? "") || !OID_RE.test(identity.snapshot_tree ?? "")) {
      throw new Error("immutable commit-range review receipt target identity is inconsistent");
    }
    if (digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
      throw new Error("immutable commit-range review receipt identity digest mismatch");
    }
    return;
  }
  if (receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 &&
      receipt.review_admission_kind === "standalone_findings") {
    assertExactKeys(identity, STANDALONE_FINDINGS_WORKTREE_FIELDS, "worktree_identity");
    if (identity.schema_version !== "canonical-standalone-findings-review-binding.v1" ||
        identity.unit_address !== receipt.unit_address ||
        identity.initiative !== receipt.initiative ||
        identity.record_id !== receipt.record_id || identity.slice_id !== receipt.slice_id ||
        identity.target_ref !== receipt.slice_ref ||
        identity.target_sha !== receipt.reviewed_sha ||
        identity.worktree_path !== receipt.worktree_path ||
        identity.repository_path !== receipt.worktree_path ||
        identity.committed_target_digest !== receipt.committed_target_digest ||
        !path.isAbsolute(identity.repository_path) ||
        !DIGEST_RE.test(identity.canonical_source_digest ?? "")) {
      throw new Error("standalone findings review receipt target identity is inconsistent");
    }
    if (digestTrustedExactReviewEvidence(
      Object.fromEntries(Object.entries(identity)
        .filter(([field]) => field !== "committed_target_digest"))
    ) !== receipt.committed_target_digest ||
        digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
      throw new Error("standalone findings review receipt target digest mismatch");
    }
    return;
  }
  if (receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 &&
      receipt.review_admission_kind === "terminal_whole_wk_candidate") {
    const fields = [
      "schema_version", "unit_address", "initiative", "record_id", "slice_id",
      "candidate_ref", "candidate_sha", "base_sha", "wk_ref", "wk_sha",
      "worktree_path", "canonical_wk_digest", "committed_target_digest"
    ];
    assertExactKeys(identity, fields, "worktree_identity");
    if (identity.schema_version !== "canonical-terminal-wk-review-binding.v1" ||
        identity.unit_address !== receipt.unit_address ||
        identity.initiative !== receipt.initiative ||
        identity.record_id !== receipt.record_id || identity.slice_id !== receipt.slice_id ||
        identity.candidate_ref !== receipt.slice_ref ||
        identity.candidate_sha !== receipt.reviewed_sha ||
        identity.base_sha !== receipt.diff_base_sha ||
        identity.worktree_path !== receipt.worktree_path ||
        identity.committed_target_digest !== receipt.committed_target_digest ||
        !/^refs\/agent-launch\/terminal-current-v2\/WK-\d{4}$/u.test(identity.candidate_ref ?? "") ||
        !/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(identity.wk_ref ?? "") ||
        !OID_RE.test(identity.wk_sha ?? "") ||
        !DIGEST_RE.test(identity.canonical_wk_digest ?? "")) {
      throw new Error("terminal whole-WK review receipt target identity is inconsistent");
    }
    if (digestTrustedExactReviewEvidence(
      Object.fromEntries(Object.entries(identity)
        .filter(([field]) => field !== "committed_target_digest"))
    ) !== receipt.committed_target_digest ||
        digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
      throw new Error("terminal whole-WK review receipt target digest mismatch");
    }
    return;
  }
  if ([EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version)) {
    assertExactKeys(identity, COMMITTED_SLICE_WORKTREE_FIELDS, "worktree_identity");
    const expectedRef = `refs/heads/slice/${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}`;
    const expectedWkRef = `refs/heads/wk/${receipt.initiative}/${receipt.record_id}`;
    const canonicalEmptyDelivery = identity.reviewed_sha === identity.diff_base_sha &&
      identity.reviewed_sha === identity.wk_sha &&
      Array.isArray(identity.commit_chain) && identity.commit_chain.length === 0 &&
      Array.isArray(identity.changed_paths) && identity.changed_paths.length === 0;
    if (identity.schema_version !== "canonical-committed-slice-review-binding.v1" ||
        identity.unit_address !== receipt.unit_address ||
        identity.initiative !== receipt.initiative || identity.record_id !== receipt.record_id ||
        identity.slice_id !== receipt.slice_id || identity.slice_ref !== expectedRef ||
        identity.wk_ref !== expectedWkRef || !OID_RE.test(identity.wk_sha ?? "") ||
        identity.reviewed_sha !== receipt.reviewed_sha ||
        identity.diff_base_sha !== receipt.diff_base_sha ||
        identity.worktree_path !== receipt.worktree_path ||
        identity.committed_target_digest !== receipt.committed_target_digest ||
        !DIGEST_RE.test(identity.source_digest ?? "") ||
        !Array.isArray(identity.commit_chain) ||
        (identity.commit_chain.length === 0 && !canonicalEmptyDelivery) ||
        identity.commit_chain.some((entry) => !OID_RE.test(entry)) ||
        !Array.isArray(identity.changed_paths)) {
      throw new Error("exact slice review receipt committed-target identity is inconsistent");
    }

    assertCanonicalRepoPaths(identity.changed_paths, "changed_paths");
    assertCanonicalRepoPaths(identity.write_scope, "write_scope", { nonEmpty: true });
    if (digestTrustedExactReviewEvidence(
      Object.fromEntries(Object.entries(identity).filter(([field]) => field !== "committed_target_digest"))
    ) !== receipt.committed_target_digest) {
      throw new Error("exact slice review receipt committed-target digest mismatch");
    }
    if (digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
      throw new Error("exact slice review receipt worktree identity digest mismatch");
    }
    return;
  }
  const expectedFields = identity?.schema_version === "worktree-identity-binding.v1"
    ? V1_WORKTREE_FIELDS
    : identity?.schema_version === "worktree-identity-binding.v2"
      ? V2_WORKTREE_FIELDS
      : null;
  if (expectedFields === null) {
    throw new Error("exact slice review receipt worktree_identity schema is unsupported");
  }
  assertExactKeys(identity, expectedFields, "worktree_identity");
  const unit = UNIT_RE.exec(receipt.unit_address);
  const identityUnit = new RegExp(`^${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}$`, "u");
  const branch = `slice/${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}`;
  const selected = identity.selected_unit;
  if (!unit || identity.unit_address.match(identityUnit) === null ||
      identity.initiative !== receipt.initiative || identity.record_id !== receipt.record_id ||
      identity.slice_id !== receipt.slice_id || identity.launch_ref !== receipt.source_worker_monitor_handle ||
      identity.run_id !== `${receipt.source_worker_run_id}.slice` || identity.retry_id !== 0 ||
      identity.base_ref !== `wk/${receipt.initiative}/${receipt.record_id}` ||
      identity.base_sha !== receipt.diff_base_sha ||
      (identity.output_branch !== branch && identity.output_branch !== `refs/heads/${branch}`) ||
      identity.worktree_path !== receipt.worktree_path || !path.isAbsolute(identity.worktree_path) ||
      identity.write_scope_source !== `wiki/work-records/${receipt.record_id}.json#${receipt.slice_id}` ||
      !isPlainObject(selected) || selected.kind !== "slice" ||
      selected.address !== receipt.unit_address || selected.record_id !== receipt.record_id ||
      selected.slice_id !== receipt.slice_id ||
      !Object.prototype.hasOwnProperty.call(selected, "repo") ||
      !(selected.repo === null || (typeof selected.repo === "string" && selected.repo.length > 0))) {
    throw new Error("exact slice review receipt worktree_identity does not match the exact review binding");
  }
  assertCanonicalRepoPaths(identity.read_scope, "read_scope");
  assertCanonicalRepoPaths(identity.repo_paths, "repo_paths");
  assertCanonicalRepoPaths(identity.write_scope, "write_scope", { nonEmpty: true });
  if (identity.schema_version === "worktree-identity-binding.v1") {
    assertCanonicalRepoPaths(identity.cone_dirs, "cone_dirs", { nonEmpty: true });
    if (identity.index_sparse !== false) {
      throw new Error("exact slice review receipt sparse worktree_identity must pin index_sparse=false");
    }
  } else if (identity.checkout_mode !== "full") {
    throw new Error("exact slice review receipt full worktree_identity must pin checkout_mode=full");
  }
  assertString(identity.source_digest, "worktree_identity.source_digest", DIGEST_RE);
  if (!(identity.source_version === null ||
        (typeof identity.source_version === "string" && identity.source_version.length > 0))) {
    throw new Error("exact slice review receipt worktree_identity source_version is invalid");
  }
  if (digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
    throw new Error("exact slice review receipt worktree identity digest mismatch");
  }
}

function assertFindingCounts(counts, findings) {
  assertExactKeys(counts, FINDING_COUNT_FIELDS, "finding_counts");
  for (const field of FINDING_COUNT_FIELDS) {
    if (!Number.isInteger(counts[field]) || counts[field] < 0) {
      throw new Error("exact slice review receipt finding_counts are invalid");
    }
  }
  const recomputed = Object.fromEntries(FINDING_COUNT_FIELDS.map((field) => [field, 0]));
  recomputed.total = findings.length;
  for (const finding of findings) {
    recomputed[finding.severity] += 1;
    if (finding.blocking) recomputed.blocking += 1;
  }
  if (FINDING_COUNT_FIELDS.some((field) => counts[field] !== recomputed[field])) {
    throw new Error("exact slice review receipt finding_counts do not match findings");
  }
}

function assertFindings(outcome) {
  if (!Array.isArray(outcome.findings) || outcome.findings.length === 0) {
    throw new Error("changes_requested receipt lacks structured findings");
  }
  const ids = new Set();
  for (const finding of outcome.findings) {
    const keys = Object.keys(finding ?? {}).sort();
    const required = ["affected_paths", "blocking", "id", "severity", "title"];
    const allowed = new Set([...required, "control_id"]);
    if (!isPlainObject(finding) || required.some((field) => !Object.prototype.hasOwnProperty.call(finding, field)) ||
        keys.some((field) => !allowed.has(field)) || typeof finding.id !== "string" || !finding.id.trim() ||
        ids.has(finding.id) || typeof finding.title !== "string" || !finding.title.trim() ||
        !FINDING_SEVERITIES.has(finding.severity) || typeof finding.blocking !== "boolean" ||
        !Array.isArray(finding.affected_paths) || finding.affected_paths.some((entry) =>
          !hasExactKeys(entry, ["path", "line"]) || typeof entry.path !== "string" || !entry.path ||
          path.posix.isAbsolute(entry.path) || path.posix.normalize(entry.path) !== entry.path ||
          !(entry.line === null || (Number.isInteger(entry.line) && entry.line > 0))
        )) {
      throw new Error("changes_requested receipt carries malformed structured findings");
    }
    ids.add(finding.id);
  }
  assertFindingCounts(outcome.finding_counts, outcome.findings);
}

function assertCleanReviewResult(result) {
  assertExactKeys(result, REVIEW_RESULT_FIELDS, "clean review_result");
  if (!new Set(["no_findings", "passed_no_blocking_or_medium_findings"]).has(result.review_outcome) ||
      result.clean_review !== true || typeof result.no_findings !== "boolean" ||
      result.no_findings !== (result.review_outcome === "no_findings") ||
      result.blocking_finding_count !== 0 || result.medium_finding_count !== 0 ||
      !Array.isArray(result.reviewed_controls) ||
      result.reviewed_controls.some((entry) => typeof entry !== "string") ||
      result.reviewed_controls.some((entry, index) => index > 0 && result.reviewed_controls[index - 1] >= entry)) {
    throw new Error("clean exact slice review receipt carries malformed review_result");
  }
}

function receiptBody(receipt) {
  const { receipt_digest: _digest, ...body } = receipt;
  return body;
}

export function normalizedEvidenceFromReceipt(receipt) {
  return {
    unit_address: receipt.unit_address,
    ...([EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
      EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
      EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version)
      ? {
          review_admission_kind: receipt.review_admission_kind,
          committed_target_digest: receipt.committed_target_digest
        }
      : {
          source_worker_run_id: receipt.source_worker_run_id,
          source_worker_monitor_handle: receipt.source_worker_monitor_handle
        }),
    review_run_id: receipt.review_run_id,
    review_monitor_handle: receipt.review_monitor_handle,
    reviewer_role: receipt.reviewer_role,
    reviewed_sha: receipt.reviewed_sha,
    diff_base_sha: receipt.diff_base_sha,
    ...(receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4
      ? {
          review_dispatch_identity: receipt.review_dispatch_identity,
          attempt_lineage_identity: receipt.attempt_lineage_identity,
          recovery_transition_identity: receipt.recovery_transition_identity
        }
      : {}),
    terminal_run_status: receipt.terminal_run_status,
    structured_outcome: receipt.structured_outcome,
    ...(Object.prototype.hasOwnProperty.call(receipt, RECEIPT_RESULT_MODE_FIELD)
      ? { result_mode: receipt[RECEIPT_RESULT_MODE_FIELD] }
      : {})
  };
}

export function validateExactSliceReviewReceipt(receipt, selector = {}) {
  if (!isPlainObject(receipt) ||
      ![EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
        EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
        EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
        EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version)) {
    throw new Error("exact slice review receipt is malformed or has an unsupported schema");
  }

  assertExactKeys(
    OPTIONAL_RECEIPT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(receipt, field))
      ? Object.fromEntries(Object.entries(receipt)
        .filter(([field]) => !OPTIONAL_RECEIPT_FIELDS.includes(field)))
      : receipt,
    receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4
      ? RECEIPT_FIELDS_V4
      : receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3
        ? RECEIPT_FIELDS_V3
      : receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2
        ? RECEIPT_FIELDS_V2
        : RECEIPT_FIELDS,
    "top-level schema"
  );
  const unit = UNIT_RE.exec(receipt.unit_address);
  if (!unit || receipt.record_id !== unit[1] || receipt.slice_id !== unit[2]) {
    throw new Error("exact slice review receipt unit identity is inconsistent");
  }
  assertString(receipt.initiative, "initiative", INITIATIVE_RE);
  assertString(receipt.canonical_parent_wk_contract, "canonical_parent_wk_contract");
  assertString(receipt.slice_review_contract, "slice_review_contract");
  for (const field of ["canonical_parent_contract_digest", "slice_review_contract_digest",
    "worktree_identity_digest", "trusted_evidence_digest", "receipt_digest"]) {
    assertString(receipt[field], field, DIGEST_RE);
  }
  if (digestTrustedExactReviewEvidence(receipt.canonical_parent_wk_contract) !==
        receipt.canonical_parent_contract_digest ||
      digestTrustedExactReviewEvidence(receipt.slice_review_contract) !==
        receipt.slice_review_contract_digest) {
    throw new Error("exact slice review receipt frozen contract digest mismatch");
  }
  for (const field of ["review_run_id", "review_monitor_handle"]) {
    assertString(receipt[field], field, OPAQUE_ID_RE);
  }
  if ([EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V2,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version)) {
    if (receipt.review_admission_kind !== "canonical_committed_slice" &&
        !(receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 &&
          new Set(["terminal_whole_wk_candidate", "standalone_findings", "immutable_commit_range"])
            .has(receipt.review_admission_kind))) {
      throw new Error("exact slice review receipt carries invalid committed-target admission kind");
    }
    assertString(receipt.committed_target_digest, "committed_target_digest", DIGEST_RE);
  } else {
    for (const field of ["source_worker_run_id", "source_worker_monitor_handle"]) {
      assertString(receipt[field], field, OPAQUE_ID_RE);
    }
  }
  assertString(receipt.reviewed_sha, "reviewed_sha", OID_RE);
  assertString(receipt.diff_base_sha, "diff_base_sha", OID_RE);
  assertString(receipt.worktree_path, "worktree_path");
  if (!path.isAbsolute(receipt.worktree_path) || path.normalize(receipt.worktree_path) !== receipt.worktree_path) {
    throw new Error("exact slice review receipt worktree_path must be normalized and absolute");
  }
  if (Object.prototype.hasOwnProperty.call(
    receipt,
    RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD
  )) {
    assertDependencyProjectionEvidence(
      receipt[RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD],
      receipt.worktree_path
    );
  }
  const expectedRef = receipt.review_admission_kind === "terminal_whole_wk_candidate"
    ? `refs/agent-launch/terminal-current-v2/${receipt.record_id}`
    : receipt.review_admission_kind === "standalone_findings"
      ? receipt.worktree_identity?.target_ref
      : `refs/heads/slice/${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}`;
  const legacyAdmissionFieldsValid = [EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V3,
    EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4].includes(receipt.schema_version) ||
    (RECEIPT_STATES.has(receipt.frozen_context_state) && PROOF_STATES.has(receipt.proof_state));
  if (receipt.slice_ref !== expectedRef ||
      !new Set(["reviewer", "redteam"]).has(receipt.reviewer_role) ||
      !RUN_STATUSES.has(receipt.terminal_run_status) || !legacyAdmissionFieldsValid) {
    throw new Error("exact slice review receipt carries invalid closed vocabulary");
  }
  assertWorktreeIdentity(receipt);
  if (receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4) {
    validateReviewDispatchIdentity(receipt.review_dispatch_identity);
    validateAttemptLineageIdentity(receipt.attempt_lineage_identity);
    const transition = receipt.recovery_transition_identity;
    if (transition !== null) validateRecoveryTransitionIdentity(transition);
    const target = {
      unit_address: receipt.unit_address,
      record_id: receipt.record_id,
      slice_id: receipt.slice_id,
      initiative: receipt.initiative,
      review_admission_kind: receipt.review_admission_kind,
      target_ref: receipt.slice_ref,
      committed_target_digest: receipt.committed_target_digest,
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha
    };
    const generation = receipt.review_dispatch_identity.current_generation;
    assertIdentityTargetBinding(receipt.review_dispatch_identity, target, generation);
    assertIdentityTargetBinding(receipt.attempt_lineage_identity, target, generation);
    if (receipt.attempt_lineage_identity.review_dispatch_id !==
        receipt.review_dispatch_identity.review_dispatch_id ||
        receipt.attempt_lineage_identity.run_id !== receipt.review_run_id ||
        receipt.attempt_lineage_identity.monitor_handle !== receipt.review_monitor_handle) {
      throw new Error("exact slice review receipt lineage identities are inconsistent");
    }
    if (transition !== null) {
      if (transition.review_dispatch_id !== receipt.review_dispatch_identity.review_dispatch_id ||
          transition.next_attempt_id !== receipt.attempt_lineage_identity.attempt_id) {
        throw new Error("exact slice review receipt transition identity is inconsistent");
      }
      assertIdentityTargetBinding(transition, target, generation);
    }
  }

  if (Object.prototype.hasOwnProperty.call(receipt, RECEIPT_CLEANUP_ONLY_FIELD)) {
    if (receipt[RECEIPT_CLEANUP_ONLY_FIELD] !== true) {
      throw new Error("exact slice review receipt carries invalid closed vocabulary");
    }
    if (receipt.terminal_run_status !== "failed") {
      throw new Error("cleanup-only exact slice review evidence requires a failed reviewer run");
    }
  }
  const hasResultMode = Object.prototype.hasOwnProperty.call(
    receipt,
    RECEIPT_RESULT_MODE_FIELD
  );
  let resultMode = null;
  if (hasResultMode) {
    try {
      resultMode = validateWorkspaceAgentResultModeEnvelope(
        receipt[RECEIPT_RESULT_MODE_FIELD]
      );
    } catch (error) {
      throw new Error("exact slice review receipt carries invalid result-mode envelope", {
        cause: error
      });
    }
    if (resultMode.mode ===
        WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE &&
        (receipt.terminal_run_status !== "succeeded" ||
          receipt.structured_outcome !== null)) {
      throw new Error("neutral prose receipt must be a successful unstructured review");
    }
    if (resultMode.mode ===
        WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT &&
        receipt.structured_outcome === null &&
        receipt[RECEIPT_CLEANUP_ONLY_FIELD] !== true) {
      throw new Error("structured result receipt lacks a usable structured outcome");
    }
  } else if (receipt.schema_version === EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 &&
      TERMINAL_STATUSES.has(receipt.terminal_run_status)) {
    throw new Error("terminal current exact slice review receipt requires result-mode envelope");
  }
  if (receipt.structured_outcome !== null) {
    const expected = receipt.structured_outcome.outcome === "clean"
      ? ["outcome", "clean_review", "review_result"]
      : receipt.structured_outcome.outcome === "changes_requested"
        ? ["outcome", "clean_review", "findings", "finding_counts"]
        : null;
    if (expected === null || !RECEIPT_OUTCOMES.has(receipt.structured_outcome.outcome)) {
      throw new Error("exact slice review receipt carries invalid closed vocabulary");
    }
    assertExactKeys(receipt.structured_outcome, expected, "structured_outcome");

    if (!receiptCompletesExactSliceReview(receipt)) {
      throw new Error("non-succeeded exact slice review receipt cannot carry a structured outcome");
    }
    if (receipt.structured_outcome.outcome === "clean") {
      if (receipt.structured_outcome.clean_review !== true) {
        throw new Error("clean exact slice review receipt lacks validated clean outcome");
      }
      assertCleanReviewResult(receipt.structured_outcome.review_result);
    } else {
      if (receipt.structured_outcome.clean_review !== false) {
        throw new Error("changes_requested receipt cannot claim a clean review");
      }
      assertFindings(receipt.structured_outcome);
    }
  }

  if (Object.prototype.hasOwnProperty.call(receipt, RECEIPT_VERDICT_EVIDENCE_FIELD)) {
    const evidence = receipt[RECEIPT_VERDICT_EVIDENCE_FIELD];
    if (!VERDICT_EVIDENCE_VALUES.has(evidence)) {
      throw new Error("exact slice review receipt carries invalid closed vocabulary");
    }

    if (receipt.structured_outcome !== null &&
        evidence !== RECEIPT_VERDICT_EVIDENCE_STATES.VERDICT_RECORDED) {
      throw new Error(
        "exact slice review receipt verdict_evidence disagrees with its validated structured outcome"
      );
    }
    if (resultMode?.mode ===
        WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE &&
        evidence !== RECEIPT_VERDICT_EVIDENCE_STATES.NEUTRAL_PROSE_RECORDED) {
      throw new Error("neutral prose receipt verdict evidence is inconsistent");
    }
    if (evidence === RECEIPT_VERDICT_EVIDENCE_STATES.PENDING &&
        TERMINAL_STATUSES.has(receipt.terminal_run_status)) {
      throw new Error("terminal exact slice review receipt cannot leave verdict presence pending");
    }
    if (RECEIPT_NO_VERDICT_EVIDENCE_VALUES.has(evidence) &&
        !TERMINAL_STATUSES.has(receipt.terminal_run_status)) {
      throw new Error("no-verdict exact slice review evidence requires a terminal reviewer run");
    }
  }

  if (selector.unit_address !== undefined && selector.unit_address !== receipt.unit_address) {
    throw new Error("exact slice review receipt unit selector mismatch");
  }
  if (selector.review_run_id !== undefined && selector.review_run_id !== receipt.review_run_id) {
    throw new Error("exact slice review receipt run selector mismatch");
  }
  if (selector.monitor_handle !== undefined && selector.monitor_handle !== receipt.review_monitor_handle) {
    throw new Error("exact slice review receipt monitor selector mismatch");
  }
  const evidenceDigest = digestTrustedExactReviewEvidence(normalizedEvidenceFromReceipt(receipt));
  if (evidenceDigest !== receipt.trusted_evidence_digest) {
    throw new Error("exact slice review receipt trusted evidence digest mismatch");
  }
  const receiptDigest = digestTrustedExactReviewEvidence(receiptBody(receipt));
  if (receiptDigest !== receipt.receipt_digest) {
    throw new Error("exact slice review receipt digest mismatch");
  }
  return Object.freeze(receipt);
}

export function classifyExactSliceReviewVerdictEvidence({
  terminal_run_status: terminalRunStatus,
  structured_outcome: structuredOutcome,
  result_mode: resultMode = null,
  validated_verdict_present: validatedVerdictPresent = false,
  launch_transport_failed: launchTransportFailed = false
} = {}) {
  const resultModeEnvelope = resultMode === null
    ? null
    : validateWorkspaceAgentResultModeEnvelope(resultMode);
  if (resultModeEnvelope?.mode === WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE &&
      terminalRunStatus === "succeeded") {
    return RECEIPT_VERDICT_EVIDENCE_STATES.NEUTRAL_PROSE_RECORDED;
  }
  if (validatedVerdictPresent === true ||
      (structuredOutcome !== null && structuredOutcome !== undefined)) {
    return RECEIPT_VERDICT_EVIDENCE_STATES.VERDICT_RECORDED;
  }
  if (!TERMINAL_STATUSES.has(terminalRunStatus)) {
    return RECEIPT_VERDICT_EVIDENCE_STATES.PENDING;
  }
  return launchTransportFailed === true
    ? RECEIPT_VERDICT_EVIDENCE_STATES.NO_VERDICT_LAUNCH_FAILED
    : RECEIPT_VERDICT_EVIDENCE_STATES.NO_VERDICT_CHILD_TERMINAL;
}

export const DELIVERY_EQUIVALENCE_SCHEMA_VERSION =
  "workspace-agent-review-delivery-equivalence.v1";
const DELIVERY_EQUIVALENCE_FIELDS = Object.freeze([
  "repository_path", "slice_ref", "reviewed_sha", "diff_base_sha",
  "commit_chain", "changed_paths", "worktree_binding"
]);

export function projectStableDeliveryEquivalence(receipt) {
  const identity = receipt?.worktree_identity ?? {};
  const chain = Array.isArray(identity.commit_chain) ? [...identity.commit_chain] : [];
  const changed = Array.isArray(identity.changed_paths) ? [...identity.changed_paths] : [];
  return Object.freeze({
    schema_version: DELIVERY_EQUIVALENCE_SCHEMA_VERSION,
    repository_path: identity.repository_path ?? receipt?.worktree_path ?? null,
    slice_ref: receipt?.slice_ref ?? null,
    reviewed_sha: receipt?.reviewed_sha ?? null,
    diff_base_sha: receipt?.diff_base_sha ?? null,
    commit_chain: Object.freeze(chain),
    changed_paths: Object.freeze([...changed].sort()),
    worktree_binding: receipt?.worktree_path ?? null
  });
}

export function deliveryEquivalenceDigest(projection) {
  return digestTrustedExactReviewEvidence(projection);
}

export function compareStableDeliveryEquivalence(left, right) {
  const leftProjection = projectStableDeliveryEquivalence(left);
  const rightProjection = projectStableDeliveryEquivalence(right);
  const moved = DELIVERY_EQUIVALENCE_FIELDS.filter((field) =>
    canonicalJson(leftProjection[field]) !== canonicalJson(rightProjection[field]));
  return Object.freeze({
    schema_version: DELIVERY_EQUIVALENCE_SCHEMA_VERSION,
    equivalent: moved.length === 0,
    left_digest: deliveryEquivalenceDigest(leftProjection),
    right_digest: deliveryEquivalenceDigest(rightProjection),
    moved_fields: Object.freeze(moved)
  });
}
