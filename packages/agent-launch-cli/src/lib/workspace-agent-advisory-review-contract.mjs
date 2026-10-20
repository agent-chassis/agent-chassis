import { createHash } from "node:crypto";

import { renderAgentRoleGuideReadReference } from
  "@agent-chassis/agent-launch-core/src/lib/agent-role-guides.mjs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail
} from "./launch-isolation-errors.mjs";
import { resolveAuthenticatedCheckoutGitMetadata } from
  "./launch-isolation-findings-git-metadata.mjs";
import { buildSelectedRecordMemberCall } from
  "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

export const ADVISORY_REVIEW_DESCRIPTOR_SCHEMA_VERSION =
  "workspace-agent-advisory-review-descriptor.v1";
export const ADVISORY_REVIEW_INPUT_SCHEMA_VERSION =
  "workspace-agent-advisory-review-input.v1";

const trustedDescriptors = new WeakSet();
const trustedInputs = new WeakSet();
const materialKindsByInput = new WeakMap();

const inputRunBindings = new WeakMap();

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function canonicalRole(role) {
  if (role !== "reviewer" && role !== "redteam") {
    throw new TypeError("advisory review role must be reviewer or redteam");
  }
  return role;
}

export function renderAdvisoryReviewBrief({ role, subject, parent, selected, entryMaterial = null }) {
  canonicalRole(role);
  const project = (value) => Object.freeze({
    id: value?.id ?? null,
    title: value?.title ?? null,
    work_kind: value?.work_kind ?? null,
    status: value?.status ?? null,
    read_scope: Object.freeze([...(value?.read_scope ?? [])]),
    repo_paths: Object.freeze([...(value?.repo_paths ?? [])]),
    write_scope: Object.freeze([...(value?.write_scope ?? [])]),
    acceptance: structuredClone(value?.acceptance ?? null)
  });
  const material = Object.freeze({
    parent: project(parent),
    selected: project(selected),
    entry_material: entryMaterial
  });
  return Object.freeze({
    role,
    subject,
    material
  });
}

export function createAdvisoryReviewDescriptor({
  role,
  subject,
  repository,
  materialKind,
  diffBaseSha,
  reviewedSha,
  reviewedTreeSha,
  immutableSourceIdentity,
  reviewBrief,
  formalResultContract = null,
  materialPaths = []
}) {
  const body = Object.freeze({
    schema_version: ADVISORY_REVIEW_DESCRIPTOR_SCHEMA_VERSION,
    role: canonicalRole(role),
    subject,
    repository,
    material_kind: materialKind,
    base_sha: diffBaseSha,
    reviewed_sha: reviewedSha,
    reviewed_tree_sha: reviewedTreeSha,
    immutable_source_identity: immutableSourceIdentity,
    review_brief: reviewBrief,
    formal_result_contract: formalResultContract,
    material_paths: Object.freeze([...materialPaths])
  });
  const descriptor = Object.freeze({ ...body, descriptor_digest: digest(body) });
  trustedDescriptors.add(descriptor);
  return descriptor;
}

export function createAdvisoryReviewInput({ descriptor, checkoutRoot, toolProfile }) {
  if (!trustedDescriptors.has(descriptor)) {
    throw new TypeError("advisory review descriptor is not launcher-owned");
  }
  const input = Object.freeze({
    schema_version: ADVISORY_REVIEW_INPUT_SCHEMA_VERSION,
    role: descriptor.role,
    subject: descriptor.subject,
    repository: descriptor.repository,
    base_sha: descriptor.base_sha,
    reviewed_sha: descriptor.reviewed_sha,
    reviewed_tree_sha: descriptor.reviewed_tree_sha,
    private_checkout_root: checkoutRoot,
    review_brief: descriptor.review_brief,
    tool_profile: toolProfile,
    formal_result_contract: descriptor.formal_result_contract,
    descriptor_digest: descriptor.descriptor_digest
  });
  trustedInputs.add(input);
  materialKindsByInput.set(input, descriptor.material_kind);
  return input;
}

function inputBindingError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

export function bindAdvisoryReviewInputToRun(input, runId) {
  if (!trustedInputs.has(input)) {
    throw inputBindingError("advisory_review_input_not_launcher_owned",
      "advisory review input is not launcher-owned");
  }
  if (typeof runId !== "string" || runId.length === 0) {
    throw inputBindingError("advisory_review_run_identity_missing",
      "advisory review input requires the runner-minted run identity");
  }
  const existing = inputRunBindings.get(input);
  if (existing !== undefined) {
    if (existing.run_id !== runId) {
      throw inputBindingError("advisory_review_input_bound_to_another_run",
        "advisory review input is already bound to a different run");
    }
    return existing;
  }
  const bound = Object.freeze({ ...input, run_id: runId });
  trustedInputs.add(bound);
  materialKindsByInput.set(bound, materialKindsByInput.get(input));
  inputRunBindings.set(input, bound);
  inputRunBindings.set(bound, bound);
  return bound;
}

export function resolveAdvisoryReviewInputRun(input) {
  return trustedInputs.has(input) && inputRunBindings.get(input) === input
    ? input.run_id
    : null;
}

export function resolveAdvisoryReviewMaterialKind(input) {
  return trustedInputs.has(input) ? materialKindsByInput.get(input) : undefined;
}

export function resolveAdvisoryReviewGitMetadataProjection(input) {
  if (!trustedInputs.has(input)) {
    fail(BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID,
      "advisory review Git metadata requires a launcher-owned review input");
  }
  return resolveAuthenticatedCheckoutGitMetadata({
    checkout: input.private_checkout_root,
    repository: input.repository,
    headCommit: input.reviewed_sha
  });
}

export function consumeAdvisoryReviewInput(input, expected = {}) {
  if (!trustedInputs.has(input) ||
      input?.schema_version !== ADVISORY_REVIEW_INPUT_SCHEMA_VERSION ||
      input.role !== expected.role || input.subject !== expected.subject) {
    throw new TypeError("advisory review input is invalid");
  }
  return input;
}

function advisoryReviewFirstReadCalls(subject) {
  const sliceMatch = String(subject).match(/^(WK-\d{4})#SLICE-\d{3}$/u);
  return [JSON.stringify({ reads: [{ subject }, ...(sliceMatch ? [{ subject: sliceMatch[1] }] : [])] })];
}

export function renderFamilyNeutralAdvisoryReviewInput(input) {
  if (!trustedInputs.has(input)) {
    throw new TypeError("advisory review input is not launcher-owned");
  }
  const [unitCall, parentCall = null] = advisoryReviewFirstReadCalls(input.subject);
  return [
    renderAgentRoleGuideReadReference("reviewer"),
    `Canonical role: ${input.role}`,
    `Canonical subject: ${input.subject}`,
    ...(input.role === "redteam" ? [
      "Challenge the proposed design before implementation. " +
        "Examine the user requirements, proposed assignments, obligations, assumptions, interactions and planned checks. " +
        "Compare the obligations with the complete user request and relevant source, not just the saved requirements. " +
        "Identify missing, weakened or unsupported interpretations. " +
        "Return findings only; the orchestrator evaluates them and owns any saved-contract updates before implementation dispatch. " +
        "Check that the proposed obligations cover the user’s requirements, including interactions and failure cases, and that their planned checks would fail if the required behavior were wrong. " +
        "Report missing coverage and weak checks. " +
        "For each gap, propose the smallest concrete correction to the assignment, requirement, obligation or planned check. " +
        "Explain which missing behavior it covers and how the check would detect an incorrect implementation. " +
        "If a correction requires an unresolved user decision, identify that decision rather than inventing an answer. " +
        "This reviews obligation design; do not execute proofs or claim that the implementation satisfies the obligations. " +
        "Implementation commits are not required. Their absence is not a finding or a reason to request implementation before completing the design challenge. " +
        "An explicitly supplied SHA can select supporting checkout context; it never changes redteam into an implementation review.",
      `Supporting source context checkout: ${input.reviewed_sha}`,
      `Supporting source context tree: ${input.reviewed_tree_sha}`
    ] : [
      `Reviewed range: ${input.base_sha}..${input.reviewed_sha}`,
      `Reviewed tree: ${input.reviewed_tree_sha}`
    ]),
    `Review descriptor: ${input.descriptor_digest}`,
    [
      "Your assignment is not included in this startup text. Before reviewing, first call " +
        `workspace_read_wiki with arguments ${unitCall}` +
        (parentCall === null
          ? ""
          : ` and then, because a slice root does not carry its parent contract, ${parentCall}`) +
        ".",
      "Follow the operative fields, every returned next_call and next_calls continuation, and the selected " +
        "material references until the assignment is complete. If a read is refused, report the refusal as " +
        "a blocker instead of substituting another source."
    ].join(" "),
    "Return advisory text. Structured formatting is optional unless the launcher-selected formal result contract requests it."
  ].join("\n\n");
}
