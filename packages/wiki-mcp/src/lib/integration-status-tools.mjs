

import path from "node:path";
import { readFileSync } from "node:fs";
import { loadInitiativeStatusRecords } from
  "../../../wiki-core/src/lib/initiative-status.mjs";
import { loadKindRecordById } from
  "../../../wiki-core/src/lib/kind-record-store.mjs";

const SCHEMA_VERSION = "workspace-integration-status.v1";
const REFUSAL_SCHEMA_VERSION = "workspace-integration-status-refusal.v1";
const CANONICAL_WORK_RECORD_FILENAME = /^WK-\d{4}\.json$/u;

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

function buildLocalFacts() {
  const unsupported = "this operation does not implement this observation; no caller or environment injection is supported; use workspace_coordination_preflight to discover configured runtime capabilities, which does not supply mergeability or publication evidence";
  return {
    git_tip: { status: "unknown", reason: unsupported },
    worktree_path: { status: "unknown", reason: unsupported },
    lease: { status: "not_available", reason: unsupported },
    quiescence: { status: "not_evaluated", reason: unsupported },
    detached_merge_workspace: { status: "not_available", reason: unsupported },
    complete_touched_paths: { status: "unknown", reason: unsupported },
    mergeability: { status: "not_evaluated", reason: unsupported },
    policy_admissibility: {
      status: "not_evaluated",
      authority: "not_available",
      reason: "local coordination status is not a policy authority"
    }
  };
}

function failInitiativeSelection(code, message) {
  const error = new Error(message);
  error.name = "WorkspaceIntegrationStatusError";
  error.code = code;
  throw error;
}

function repoRelativePath(workspaceDir, sourcePath) {
  return path.relative(workspaceDir, sourcePath).split(path.sep).join("/");
}

function failWorkRecordCensus({ cause, sourcePath, workspaceDir, workspaceRepo, initiative }) {
  const sourcePathRelative = repoRelativePath(workspaceDir, sourcePath);
  const causeCode = cause instanceof SyntaxError
    ? "workspace_integration_status.work_record_json_invalid.v1"
    : "workspace_integration_status.work_record_read_failed.v1";
  const action = cause instanceof SyntaxError
    ? "repair_canonical_work_record_json"
    : "restore_canonical_work_record_readability";
  const error = new Error(
    `canonical work-record census failed at ${sourcePathRelative}`,
    { cause }
  );
  error.name = "WorkspaceIntegrationStatusCensusError";
  error.code = "workspace_integration_status.work_record_census_failed.v1";
  error.envelope = {
    schema_version: REFUSAL_SCHEMA_VERSION,
    accepted: false,
    operation: "workspace_integration_status",
    code: error.code,
    authority_limb: "mechanical_failure",
    cause: {
      code: causeCode,
      source_path_relative: sourcePathRelative
    },
    recovery: {
      action,
      source_path_relative: sourcePathRelative,
      then_call: {
        name: "workspace_integration_status",
        arguments: { repo: workspaceRepo, initiative }
      }
    }
  };
  throw error;
}

function readCanonicalWorkRecord({
  sourcePath,
  workspaceDir,
  workspaceRepo,
  initiative
}) {
  if (!CANONICAL_WORK_RECORD_FILENAME.test(path.basename(sourcePath))) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (cause) {
    failWorkRecordCensus({ cause, sourcePath, workspaceDir, workspaceRepo, initiative });
  }
}

function requireCanonicalInitiative(loaded, initiative) {
  if (loaded?.classification === "loaded" && loaded.record_kind === "initiative") {
    return loaded.record;
  }
  if (loaded?.classification === "missing") {
    failInitiativeSelection(
      "workspace_integration_status.initiative_not_found.v1",
      `canonical initiative ${initiative} does not exist`
    );
  }
  if (loaded?.classification === "invalid_identity" || loaded?.record_kind !== "initiative") {
    failInitiativeSelection(
      "workspace_integration_status.initiative_identity_invalid.v1",
      "initiative must resolve to one canonical IN-#### JSON identity"
    );
  }
  failInitiativeSelection(
    "workspace_integration_status.initiative_record_invalid.v1",
    `canonical initiative ${initiative} is malformed or identity-mismatched`
  );
}

export async function buildWorkspaceIntegrationStatus({ workspaceRepo, workspaceDir, initiative }) {
  const initiativeLoad = await loadKindRecordById({ repoRoot: workspaceDir, id: initiative });
  requireCanonicalInitiative(initiativeLoad, initiative);
  const loadedRecords = loadInitiativeStatusRecords({
    repoRoot: workspaceDir,
    initiative,
    readRecord: (sourcePath) => readCanonicalWorkRecord({
      sourcePath,
      workspaceDir,
      workspaceRepo,
      initiative
    })
  });
  const workRecords = loadedRecords.filter((entry) =>
    CANONICAL_WORK_RECORD_FILENAME.test(path.basename(entry.source_path))
  ).map((entry) => {
    const record = entry.record ?? entry.raw;
    return buildWorkRecordRow(
      record,
      initiative,
      repoRelativePath(workspaceDir, entry.source_path)
    );
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: SCHEMA_VERSION,
    workspaceRepo,
    initiative,
    expected_wk_branch_pattern: `wk/${initiative}/WK-YYYY`,
    sources: {
      initiative: {
        source_path_relative: initiativeLoad.source_path.split(path.sep).join("/"),
        record_kind: initiativeLoad.record_kind,
        source_digest: initiativeLoad.source_digest
      },
      work_records: {
        source_path_glob: "wiki/work-records/WK-[0-9][0-9][0-9][0-9].json",
        membership_field: "initiative",
        matched_count: workRecords.length
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
        "Read canonical initiative JSON and WK.initiative membership with expected WK refs and explicit unavailable facts. Server resolves repositories. Grants no branch, policy, review or promotion authority.",
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
          await buildWorkspaceIntegrationStatus({
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
