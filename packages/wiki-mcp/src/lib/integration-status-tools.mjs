

import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "workspace-integration-status.v1";

const ALLOWED_INPUT_FIELDS = new Set(["repo", "initiative"]);
const FORBIDDEN_INPUT_FIELDS = [
  "root", "workspaceRoot", "workspace_root", "dir", "gitDir", "git_dir",
  "branch", "branchRef", "branch_ref", "ref", "base_ref", "integration_ref",
  "worktree", "worktreePath", "worktree_path", "policy", "policy_verdict",
  "policyVerdict", "evidence", "evidence_body", "evidenceBody", "identity",
  "identity_carrier", "identityCarrier", "run_id", "launch_ref"
];

function assertIntegrationStatusInput(args) {
  const supplied = args && typeof args === "object" ? args : {};
  const unknown = Object.keys(supplied)
    .filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  const forbidden = FORBIDDEN_INPUT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(supplied, field)
  );
  if (unknown.length > 0 || forbidden.length > 0) {
    const rejected = [...new Set([...unknown, ...forbidden])].sort();
    throw new Error(
      `workspace_integration_status accepts only repo and initiative; rejected fields: ${rejected.join(", ")}`
    );
  }
  if (
    typeof supplied.initiative !== "string" ||
    !/^IN-\d{4}$/.test(supplied.initiative.trim())
  ) {
    throw new Error("workspace_integration_status requires initiative like IN-0021");
  }
  return { repo: supplied.repo, initiative: supplied.initiative.trim().toUpperCase() };
}

function readInitiativeRelated(workspaceDir, initiative) {
  const initiativePath = path.join(workspaceDir, "wiki", "initiatives", `${initiative}.md`);
  if (!fs.existsSync(initiativePath)) {
    return { source_path_relative: `wiki/initiatives/${initiative}.md`, exists: false, related: [] };
  }
  const text = fs.readFileSync(initiativePath, "utf8");
  const related = [];
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (match) {
    let inRelated = false;
    for (const line of match[1].split(/\r?\n/)) {
      if (/^\w/.test(line)) {
        inRelated = line.trim() === "related:";
        continue;
      }
      if (inRelated) {
        const item = line.match(/^\s*-\s*(WK-\d{4})\s*$/);
        if (item) related.push(item[1]);
      }
    }
  }
  return { source_path_relative: `wiki/initiatives/${initiative}.md`, exists: true, related };
}

function collectWorkRecordRows(workspaceDir, initiative) {
  const recordsDir = path.join(workspaceDir, "wiki", "work-records");
  if (!fs.existsSync(recordsDir)) return { rows: [], record_errors: [] };
  const rows = [];
  const recordErrors = [];
  let entries;
  try {
    entries = fs.readdirSync(recordsDir).sort();
  } catch (error) {
    return {
      rows,
      record_errors: [
        buildWorkRecordError({
          sourcePathRelative: "wiki/work-records",
          errorKind: "read_error",
          error
        })
      ]
    };
  }
  for (const entry of entries) {
    if (!/^WK-\d{4}\.json$/.test(entry)) continue;
    const sourcePath = path.join(recordsDir, entry);
    const sourcePathRelative = `wiki/work-records/${entry}`;
    let record;
    try {
      record = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    } catch (error) {
      recordErrors.push(buildWorkRecordError({
        sourcePathRelative,
        errorKind: error instanceof SyntaxError ? "parse_error" : "read_error",
        error,
        id: path.basename(entry, ".json")
      }));
      continue;
    }
    const related = Array.isArray(record.related) ? record.related : [];
    if (!related.includes(initiative)) continue;
    rows.push(buildWorkRecordRow(record, initiative, sourcePathRelative));
  }
  return { rows, record_errors: recordErrors };
}

function buildWorkRecordError({ sourcePathRelative, errorKind, error, id = null }) {
  const errorCode = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
  const reason = errorKind === "parse_error" && error instanceof Error
    ? `failed to parse canonical work-record JSON: ${error.message}`
    : "failed to read canonical work-record inventory";
  return {
    id,
    status: "unknown",
    source_path_relative: sourcePathRelative,
    error_kind: errorKind,
    error_code: errorCode,
    reason
  };
}

function buildWorkRecordRow(record, initiative, sourcePathRelative) {
  const id = typeof record.id === "string"
    ? record.id
    : path.basename(sourcePathRelative, ".json");
  return {
    id,
    title: typeof record.title === "string" ? record.title : null,
    status: typeof record.status === "string" ? record.status : "unknown",
    work_kind: typeof record.work_kind === "string" ? record.work_kind : "unknown",
    source_path_relative: sourcePathRelative,
    expected_branch: `wk/${initiative}/${id}`,
    slice_count: Array.isArray(record.slices) ? record.slices.length : 0
  };
}

function mergeInitiativeAndRecordRows({ initiativeRelated, recordRows, initiative }) {
  const byId = new Map(recordRows.map((row) => [row.id, row]));
  for (const id of initiativeRelated.related) {
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      title: null,
      status: "unknown",
      work_kind: "unknown",
      source_path_relative: null,
      expected_branch: `wk/${initiative}/${id}`,
      slice_count: null
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildLocalFacts() {
  const noResolver = "no trusted local resolver is injected for this first read-only status slice";
  return {
    git_tip: { status: "unknown", reason: noResolver },
    worktree_path: { status: "unknown", reason: noResolver },
    lease: { status: "not_available", reason: noResolver },
    quiescence: { status: "not_evaluated", reason: noResolver },
    detached_merge_workspace: { status: "not_available", reason: noResolver },
    complete_touched_paths: { status: "unknown", reason: noResolver },
    mergeability: { status: "not_evaluated", reason: noResolver },
    policy_admissibility: {
      status: "not_evaluated",
      authority: "not_available",
      reason: "local coordination status is not a policy authority"
    }
  };
}

export function buildWorkspaceIntegrationStatus({ workspaceRepo, workspaceDir, initiative }) {
  const initiativeRelated = readInitiativeRelated(workspaceDir, initiative);
  const recordInventory = collectWorkRecordRows(workspaceDir, initiative);
  const workRecords = mergeInitiativeAndRecordRows({
    initiativeRelated,
    recordRows: recordInventory.rows,
    initiative
  });
  return {
    schema_version: SCHEMA_VERSION,
    workspaceRepo,
    initiative,
    expected_integration_ref: `integration/${initiative}`,
    expected_wk_branch_pattern: `wk/${initiative}/WK-YYYY`,
    sources: {
      initiative: initiativeRelated,
      work_records: {
        source_path_glob: "wiki/work-records/WK-*.json",
        matched_count: recordInventory.rows.length,
        record_errors: recordInventory.record_errors
      }
    },
    work_records: workRecords,
    local_facts: buildLocalFacts()
  };
}

export function registerIntegrationStatusTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo
}) {
  registerTool(
    "workspace_integration_status",
    {
      description:
        "Read-only local coordination status for an initiative integration branch. Accepts only server-resolved repo selection plus initiative id; reports expected refs, related WK rows, and explicit unknown/not-available local facts. It is not policy, review, merge, or promotion authority.",
      inputSchema: {
        repo: z.string().optional(),
        initiative: z.string()
      }
    },
    async (args) => {
      try {
        const input = assertIntegrationStatusInput(args);
        const workspace = resolveWorkspaceRepo(workspaceRepos, input.repo);
        return jsonContent(
          buildWorkspaceIntegrationStatus({
            workspaceRepo: workspace.repo,
            workspaceDir: workspace.dir,
            initiative: input.initiative
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
