import { createHash } from "node:crypto";

export const ADVISORY_REVIEW_DESCRIPTOR_SCHEMA_VERSION =
  "workspace-agent-advisory-review-descriptor.v1";
export const ADVISORY_REVIEW_INPUT_SCHEMA_VERSION =
  "workspace-agent-advisory-review-input.v1";

const trustedDescriptors = new WeakSet();
const trustedInputs = new WeakSet();

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function canonicalRole(role) {
  if (role !== "reviewer" && role !== "redteam") {
    throw new TypeError("advisory review role must be reviewer or redteam");
  }
  return role;
}

export function renderAdvisoryReviewBrief({ role, subject, parent, selected }) {
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
    selected: project(selected)
  });
  return Object.freeze({
    role,
    subject,
    instructions: role === "redteam"
      ? "Perform a read-only adversarial review. Return advisory text and do not modify files."
      : "Perform a read-only review. Return advisory text and do not modify files.",
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
  return input;
}

export function consumeAdvisoryReviewInput(input, expected = {}) {
  if (!trustedInputs.has(input) ||
      input?.schema_version !== ADVISORY_REVIEW_INPUT_SCHEMA_VERSION ||
      input.role !== expected.role || input.subject !== expected.subject) {
    throw new TypeError("advisory review input is invalid");
  }
  return input;
}

export function renderFamilyNeutralAdvisoryReviewInput(input) {
  if (!trustedInputs.has(input)) {
    throw new TypeError("advisory review input is not launcher-owned");
  }
  return [
    input.review_brief.instructions,
    `Canonical role: ${input.role}`,
    `Canonical subject: ${input.subject}`,
    `Reviewed range: ${input.base_sha}..${input.reviewed_sha}`,
    `Reviewed tree: ${input.reviewed_tree_sha}`,
    "Review material:",
    JSON.stringify(input.review_brief.material, null, 2),
    "Return advisory text. Structured formatting is optional unless the launcher-selected formal result contract requests it."
  ].join("\n\n");
}
