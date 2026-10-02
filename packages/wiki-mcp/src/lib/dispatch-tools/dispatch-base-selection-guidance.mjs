

import { realpathSync } from "node:fs";
import path from "node:path";

import { readWorkRecordById } from
  "@agent-chassis/wiki-core/src/operations/work-records-store-io.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import {
  BASE_SELECTION_EDITOR,
  BASE_SELECTION_FIELD_GUIDANCE,
  BASE_SELECTION_MISSING_LAUNCH_REASON
} from "@agent-chassis/agent-launch-cli/src/lib/backend-provisioning-refusal-projection.mjs";
import { AGENT_DISPATCH_TOOL_NAME } from "../dispatch-tool-constants.mjs";
import { projectWorkRecordFreshness } from
  "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { buildDispatchMechanicalRefusal } from "../dispatch-tool-helpers.mjs";
import {
  buildDispatchGuidanceRefusal,
  isActivelyRegistered
} from "../dispatch-guidance-contract.mjs";
import { carriedBackendRefusalFor, publicBackendBlockerCode } from
  "./agent-dispatch-refusal-projection.mjs";

const SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const LAUNCHER_OWNER = "agent-launch managed provisioning";
const STORE_OWNER = "wiki-core canonical work-record store";

export function isBaseSelectionMissingRefusal(classification) {
  const detail = classification?.diagnostics;
  return classification?.refusal_code === BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START &&
    classification.refusal_reason === BASE_SELECTION_MISSING_LAUNCH_REASON &&
    classification.cause?.type === "managed_wk_bootstrap_failure" &&
    detail?.failure_stage === "pre_worker_worktree_provisioning" &&
    detail.provisioning_operation === "base_ref_resolution" &&
    detail.required_ref === null &&
    detail.base_selection?.source === "work_record.base_branch" &&
    detail.base_selection?.policy === "explicit_per_wk_branch" &&
    typeof detail.repository_path === "string" && path.isAbsolute(detail.repository_path);
}

function sameProposal(recovery) {
  return recovery?.state === "guidance" &&
    recovery.route === BASE_SELECTION_FIELD_GUIDANCE.route &&
    JSON.stringify(recovery.args) === JSON.stringify(BASE_SELECTION_FIELD_GUIDANCE.args) &&
    typeof recovery.prerequisite === "string" && recovery.responsible_actor === "operator";
}

function missingPreStartObservations({ role, launch, classification }) {
  const missing = [];
  if (role !== "worker") missing.push("worker_role");
  if ((launch?.run_id ?? null) !== null) missing.push("null_public_run_id");
  if ((launch?.monitor_handle ?? null) !== null) missing.push("null_public_monitor_handle");
  if ((launch?.managed_wk_allocation ?? null) !== null) missing.push("no_managed_wk_allocation");
  if (classification.diagnostics.provisioning_compensation !== "completed") {
    missing.push("completed_provisioning_compensation");
  }
  return missing;
}

function noRoute({ classification, facts, reason, missing, owner, extra = {} }) {
  const entries = [
    ["dispatch.backend_accepted", false],
    ["dispatch.backend_cause", BASE_SELECTION_MISSING_LAUNCH_REASON],
    ...facts
  ];
  return buildDispatchMechanicalRefusal({
    code: publicBackendBlockerCode(classification),
    decidingFacts: entries.map(([field, value]) => ({ field, value })),
    observedFacts: Object.fromEntries(entries),
    noSupportedRoute: true,
    recovery: Object.freeze({
      state: "no_supported_route",
      responsible_actor: "operator",
      prerequisite: classification.recovery?.prerequisite ??
        "the canonical WK record must explicitly select base_branch before its first worker starts",
      explanation: `base-selection guidance is unavailable: ${reason}`
    }),
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: {
      launcher_backend_refusal: carriedBackendRefusalFor(classification),
      base_selection_unavailable: Object.freeze({
        reason,
        missing: Object.freeze([...missing]),
        owner,
        ...extra
      })
    }
  });
}

async function readRoot({ readRecord, dir, wkId }) {
  try {
    return { loaded: await readRecord({ dir, id: wkId }) };
  } catch (error) {
    return {
      failure: {
        error_name: error instanceof Error ? error.name : null,
        error_code: typeof error?.code === "string" ? error.code : null,
        error_message: String(error?.message ?? error).slice(0, 512)
      }
    };
  }
}

function canonicalDirectory(dir) {
  try {
    return realpathSync(path.resolve(dir));
  } catch {
    return null;
  }
}

export async function decideBaseSelectionRecovery({
  classification,
  launch,
  role,
  subject,
  workspace,
  requestSchemaAuthority,
  reassessmentAvailable,
  readRecord = readWorkRecordById
}) {
  if (classification?.refusal_reason !== BASE_SELECTION_MISSING_LAUNCH_REASON) return null;
  const wkId = typeof subject === "string" ? subject.split("#", 1)[0] : null;
  if (!isBaseSelectionMissingRefusal(classification) || !sameProposal(classification.recovery) ||
      role !== "worker" || !/^WK-\d{4}$/u.test(wkId ?? "")) {
    return {
      kind: "refusal",
      refusal: noRoute({ classification, facts: [], reason: "producer_evidence_not_exact",
        missing: ["authenticated_worker_missing_selection_evidence"], owner: LAUNCHER_OWNER })
    };
  }
  const repository = canonicalDirectory(workspace.dir);
  if (repository === null || repository !== classification.diagnostics.repository_path) {
    return {
      kind: "refusal",
      refusal: noRoute({ classification, facts: [], reason: "launcher_repository_mismatch",
        missing: ["configured_repository_identity"], owner: LAUNCHER_OWNER,
        extra: { repository: workspace.repo } })
    };
  }
  const read = await readRoot({ readRecord, dir: workspace.dir, wkId });
  const loaded = read.loaded ?? null;
  if (read.failure || loaded?.record === null || loaded?.record === undefined) {
    return {
      kind: "refusal",
      refusal: noRoute({ classification, facts: [["work_record.root", wkId]],
        reason: "canonical_root_unreadable", missing: ["canonical_root_record"], owner: STORE_OWNER,
        extra: read.failure ?? { diagnostics: (loaded?.diagnostics ?? [])
          .map((entry) => entry?.code ?? null).slice(0, 20) } })
    };
  }
  if (loaded.record_id !== wkId || loaded.record.id !== wkId) {
    return {
      kind: "refusal",
      refusal: noRoute({ classification, facts: [["work_record.root", wkId]],
        reason: "canonical_root_identity_mismatch", missing: ["canonical_root_identity"],
        owner: STORE_OWNER })
    };
  }
  if (!SOURCE_DIGEST_RE.test(loaded.source_digest ?? "")) {
    return {
      kind: "refusal",
      refusal: noRoute({ classification, facts: [["work_record.root", wkId]],
        reason: "canonical_root_digest_unavailable", missing: ["root_source_digest"],
        owner: STORE_OWNER })
    };
  }
  const baseBranch = loaded.record.base_branch;
  if (typeof baseBranch === "string" && baseBranch.length > 0) {
    const missing = missingPreStartObservations({ role, launch, classification });
    if (missing.length > 0 || reassessmentAvailable !== true) {
      return {
        kind: "refusal",
        refusal: noRoute({ classification, facts: [["work_record.root", wkId],
          ["work_record.base_branch_selected", true]],
        reason: reassessmentAvailable === true
          ? "reassessment_evidence_missing"
          : "base_selection_state_moved_after_reassessment",
        missing: missing.length > 0 ? missing : ["single_reassessment_already_used"],
        owner: LAUNCHER_OWNER })
      };
    }
    return {
      kind: "reassess",
      evidence: Object.freeze({
        reason: "root_base_selected_concurrently",
        prior_refusal_reason: BASE_SELECTION_MISSING_LAUNCH_REASON,
        root_unit: wkId,
        root_source_digest: loaded.source_digest,
        prior_public_run_id: null,
        prior_public_monitor_handle: null
      })
    };
  }
  const editorAvailable = isActivelyRegistered(requestSchemaAuthority, BASE_SELECTION_EDITOR);
  const entries = [
    ["dispatch.backend_accepted", false],
    ["dispatch.backend_cause", BASE_SELECTION_MISSING_LAUNCH_REASON],
    ["work_record.root", wkId],
    ["work_record.base_branch", null]
  ];
  const proposal = classification.recovery;
  const built = buildDispatchGuidanceRefusal({
    code: publicBackendBlockerCode(classification),
    decidingFacts: entries.map(([field, value]) => ({ field, value })),
    observedFacts: Object.fromEntries(entries),
    guidance: {
      tool: proposal.route,
      arguments: proposal.args,
      information: proposal.information
    },
    recovery: {
      responsible_actor: "operator",
      prerequisite: proposal.prerequisite,
      selected_from: ["work_record.base_branch"],
      operator_action: editorAvailable
        ? proposal.operator_action
        : `${proposal.operator_action}; this session does not register ${BASE_SELECTION_EDITOR}, so an operator session authorized for it performs the edit`,
      ...(proposal.retry_condition ? { retry_condition: proposal.retry_condition } : {}),
      ...(proposal.explanation ? { explanation: proposal.explanation } : {})
    },
    route: AGENT_DISPATCH_TOOL_NAME,
    carried: {
      launcher_backend_refusal: carriedBackendRefusalFor(classification),
      base_selection: Object.freeze({
        repository: workspace.repo,
        root_unit: wkId,

        root_source_digest: projectWorkRecordFreshness(loaded.source_digest),
        cas_argument: "expected_source_digest",
        editor: BASE_SELECTION_EDITOR,
        edit_actor: editorAvailable ? "caller" : "authorized_operator_session",
        branch_choice: "operator",
        resubmit: "original_workspace_agent_dispatch_request"
      })
    },
    requestSchemaAuthority
  });
  if (built.refusal) return { kind: "refusal", refusal: built.refusal };
  return {
    kind: "refusal",
    refusal: noRoute({ classification, facts: [["work_record.root", wkId],
      ["work_record.base_branch", null]], reason: "field_guidance_unavailable",
    missing: built.unavailable.missing, owner: built.unavailable.owner,
    extra: { root_source_digest: projectWorkRecordFreshness(loaded.source_digest) } })
  };
}
