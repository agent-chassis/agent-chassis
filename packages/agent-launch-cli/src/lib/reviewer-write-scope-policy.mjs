import { createHash } from "node:crypto";

export const REVIEWER_WRITE_SCOPE_NONEMPTY_REASON = "reviewer_write_scope_nonempty";
export const REVIEWER_WRITE_SCOPE_REMEDIATION_ACTION =
  "create_or_select_separate_findings_only_review_unit";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildReviewerEmptyScopeAssertion(writeScope, passed) {
  const scopeForDigest = Array.isArray(writeScope) ? writeScope : [];
  return {
    schema_version: "agent-role-reviewer-empty-scope-assertion.v1",
    enforced: passed === true,
    write_scope_length: scopeForDigest.length,
    write_scope_digest: createHash("sha256").update(canonicalJson(scopeForDigest)).digest("hex"),
    refusal_reason: passed === true ? null : REVIEWER_WRITE_SCOPE_NONEMPTY_REASON
  };
}

export function buildReviewerWriteScopeRemediation({ subject = null, repoPaths = [] } = {}) {
  return {
    action: REVIEWER_WRITE_SCOPE_REMEDIATION_ACTION,
    suggested_unit_id_examples: ["WK-#####review", "WK-#####implementation-review"],
    work_kind: "review",
    write_scope: [],
    repo_paths: Array.isArray(repoPaths) ? repoPaths : [],
    depends_on: typeof subject === "string" && subject.length > 0 ? [subject] : [],
    acceptance: [
      "Findings-only review.",
      "Do not modify files.",
      "Report findings against the inspected files."
    ]
  };
}

export function buildReviewerWriteScopeRefusalDetail({
  subject = null,
  role = "reviewer",
  subjectKind = "work_record",
  subjectTitle = null,
  recordId = null,
  sliceId = null,
  observedWriteScopeSize = 0,
  repoPaths = []
} = {}) {
  return {
    subject,
    role,
    subject_kind: subjectKind,
    subject_title: subjectTitle,
    record_id: recordId,
    slice_id: sliceId,
    observed_write_scope_size: observedWriteScopeSize,
    required_write_scope: [],
    cause_classification: "coordination_wk_shape_issue",
    remediation: buildReviewerWriteScopeRemediation({ subject, repoPaths })
  };
}
