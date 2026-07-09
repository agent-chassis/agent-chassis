import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "workspace-integration-promote-check.v1";
const ALLOWED_INPUT_FIELDS = new Set(["repo", "unit", "work_record"]);
const FORBIDDEN_INPUT_FIELDS = "root workspaceRoot workspace_root dir cwd path paths gitDir git_dir worktree worktreePath worktree_path branch branchRef branch_ref ref refs base_ref integration_ref wk_ref sha shas base_sha head_sha tip candidate candidate_sha policy policy_verdict policyVerdict evidence evidence_body evidenceBody identity identity_carrier identityCarrier review review_result review_attestation attestation run_id launch_ref merge merge_instruction rebase rebase_instruction cleanup".split(" ");
const FAIL_CLOSED_FACTS = "live_refs candidate_identity liveness quiescence lease touched_paths detached_merge_workspace conflict_classification evidence_binding".split(" ");

function assertPromoteCheckInput(args) {
  const supplied = args && typeof args === "object" ? args : {};
  const unknown = Object.keys(supplied).filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  const forbidden = FORBIDDEN_INPUT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(supplied, field)
  );
  if (unknown.length > 0 || forbidden.length > 0) {
    const rejected = [...new Set([...unknown, ...forbidden])].sort();
    throw new Error(
      `workspace_integration_promote_check accepts only repo plus unit or work_record; rejected fields: ${rejected.join(", ")}`
    );
  }
  const address = supplied.unit ?? supplied.work_record;
  if (typeof address !== "string" || address.trim() === "") {
    throw new Error("workspace_integration_promote_check requires unit or work_record");
  }
  if (supplied.unit && supplied.work_record && supplied.unit.trim() !== supplied.work_record.trim()) {
    throw new Error("workspace_integration_promote_check accepts one canonical unit/work_record identity");
  }
  const match = address.trim().toUpperCase().match(/^(WK-\d{4})(?:#(SLICE-\d{3}))?$/);
  if (!match) {
    throw new Error("workspace_integration_promote_check requires WK-YYYY or WK-YYYY#SLICE-NNN");
  }
  return { repo: supplied.repo, unit: match[2] ? `${match[1]}#${match[2]}` : match[1], recordId: match[1] };
}

function readWorkRecord(workspaceDir, recordId) {
  const sourcePathRelative = `wiki/work-records/${recordId}.json`;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(workspaceDir, sourcePathRelative), "utf8"));
    return { record, source_path_relative: sourcePathRelative, error: null };
  } catch (error) {
    return {
      record: null,
      source_path_relative: sourcePathRelative,
      error: buildRecordError({ id: recordId, sourcePathRelative, error })
    };
  }
}

function buildRecordError({ id, sourcePathRelative, error }) {
  const parseError = error instanceof SyntaxError;
  return {
    id, status: "unknown",
    source_path_relative: sourcePathRelative,
    error_kind: parseError ? "parse_error" : "read_error",
    error_code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    reason: parseError && error instanceof Error
      ? `failed to parse canonical work-record JSON: ${error.message}`
      : "failed to read canonical work-record inventory"
  };
}

function resolveInitiativeBinding(record) {
  const initiatives = (Array.isArray(record?.related) ? record.related : [])
    .filter((entry) => typeof entry === "string" && /^IN-\d{4}$/.test(entry));
  if (initiatives.length !== 1) {
    return {
      status: initiatives.length === 0 ? "missing" : "ambiguous",
      initiative: null,
      related_initiatives: initiatives,
      reason: initiatives.length === 0
        ? "canonical work record has no single related IN-XXXX binding"
        : "canonical work record has multiple related IN-XXXX bindings"
    };
  }
  return { status: "resolved", initiative: initiatives[0], related_initiatives: initiatives, reason: "resolved from canonical work-record related[]" };
}

function collectEvidenceIdentities(record) {
  const text = JSON.stringify(record ?? {});
  return [...new Set(text.match(/\b(?:rr|ra):[0-9a-f]{16,}\b/g) ?? [])]
    .sort()
    .map((id) => ({ id, authority: "record_identity_only" }));
}

function blocker(code, fact, reason, action) {
  return { code, fact, reason, recommended_action: action };
}

function buildUnavailableFacts() {
  const noResolver = "no trusted same-ref-store/live-workspace resolver is injected for this first promote-check slice";
  return {
    live_refs: { status: "unknown", reason: noResolver },
    candidate_identity: { status: "unknown", reason: noResolver },
    liveness: { status: "unknown", reason: "no trusted contract liveness oracle is injected" },
    quiescence: { status: "unknown", reason: "no trusted clean-index/worktree quiescence oracle is injected" },
    lease: { status: "not_available", reason: "no trusted IN lease resolver is injected" },
    touched_paths: { status: "unknown", reason: "no trusted complete touched-path resolver is injected" },
    detached_merge_workspace: { status: "not_available", reason: "no trusted detached merge workspace resolver is injected" },
    conflict_classification: { status: "not_evaluated", reason: "conflicts cannot be classified without trusted live refs and touched paths" },
    evidence_binding: {
      status: "unknown", authority: "not_available",
      reason: "evidence cannot be bound to the exact live candidate tip/source digest without trusted same-ref-store candidate resolution"
    }
  };
}

function buildLocalBlockers(recordError, binding, localFacts) {
  const blockers = [];
  if (recordError) {
    blockers.push(blocker("canonical_record_untrusted", "work_record", recordError.reason, "repair_canonical_record_then_recheck"));
  }
  if (binding.status !== "resolved") {
    blockers.push(blocker("branch_binding_unresolved", "branch_binding", binding.reason, "repair_wk_to_initiative_binding_then_recheck"));
  }
  for (const fact of FAIL_CLOSED_FACTS) blockers.push(blocker(`${fact}_${localFacts[fact].status}`, fact, localFacts[fact].reason, "blocked_needs_trusted_resolver"));
  return blockers;
}

export function buildWorkspaceIntegrationPromoteCheck({ workspaceRepo, workspaceDir, unit, recordId }) {
  const recordRead = readWorkRecord(workspaceDir, recordId);
  const binding = recordRead.record ? resolveInitiativeBinding(recordRead.record) : {
    status: "unknown", initiative: null, related_initiatives: [],
    reason: "canonical work record could not be read"
  };
  const localFacts = buildUnavailableFacts();
  return {
    schema_version: SCHEMA_VERSION,
    workspaceRepo,
    unit,
    work_record: recordId,
    expected_wk_ref: binding.initiative ? `wk/${binding.initiative}/${recordId}` : null,
    expected_integration_ref: binding.initiative ? `integration/${binding.initiative}` : null,
    sources: {
      work_record: {
        source_path_relative: recordRead.source_path_relative,
        readable: Boolean(recordRead.record), error: recordRead.error
      }
    },
    work_record_inventory: {
      id: recordRead.record?.id ?? recordId,
      title: typeof recordRead.record?.title === "string" ? recordRead.record.title : null,
      status: typeof recordRead.record?.status === "string" ? recordRead.record.status : "unknown",
      work_kind: typeof recordRead.record?.work_kind === "string" ? recordRead.record.work_kind : "unknown",
      initiative_binding: binding
    },
    evidence_inventory: collectEvidenceIdentities(recordRead.record),
    local_facts: localFacts,
    policy_admissibility: {
      status: "not_evaluated", authority: "not_available",
      reason: "workspace_integration_promote_check is local coordination only, not policy authority"
    },
    local_blockers: buildLocalBlockers(recordRead.error, binding, localFacts),
    recommended_actions: [
      "repair_wk_to_initiative_binding_then_recheck",
      "provide_trusted_live_ref_candidate_resolver",
      "provide_trusted_liveness_lease_and_quiescence_resolvers",
      "provide_trusted_touched_path_and_detached_workspace_resolvers",
      "request_review_for_current_candidate_after_exact_candidate_binding"
    ]
  };
}

export function registerIntegrationPromoteCheckTools({
  registerTool, workspaceRepos, z, jsonContent, errorContent, resolveWorkspaceRepo
}) {
  registerTool(
    "workspace_integration_promote_check",
    {
      description:
        "Read-only local WK-to-integration promote check. Accepts only server-resolved repo selection plus a canonical WK/unit id; reports local facts and fail-closed blockers without policy, review, merge, rebase, cleanup, or promotion authority.",
      inputSchema: { repo: z.string().optional(), unit: z.string().optional(), work_record: z.string().optional() }
    },
    async (args) => {
      try {
        const input = assertPromoteCheckInput(args);
        const workspace = resolveWorkspaceRepo(workspaceRepos, input.repo);
        return jsonContent(buildWorkspaceIntegrationPromoteCheck({ workspaceRepo: workspace.repo, workspaceDir: workspace.dir, unit: input.unit, recordId: input.recordId }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
