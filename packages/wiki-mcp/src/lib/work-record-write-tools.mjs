

import {
  setWorkRecordStatusByUnit,
  setWorkRecordTaskByUnit
} from "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  setWorkRecordClosureByUnit
} from "@agent-chassis/wiki-core";
import {
  editWorkRecordContractByUnit,
  buildCloseoutLintSummary
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  validateOptionalExpectedSourceDigest
} from "./work-record-write-route-helpers.mjs";

const CLOSEOUT_LINT_STATUS_TRIGGER_VALUES = ["review", "done"];
const CLOSEOUT_LINT_FINDING_LIMIT = 3;

function closeoutWriteApplied(result) {
  return Boolean(result?.valid) && (Boolean(result?.written) || Boolean(result?.no_op));
}

function closeoutLintNotApplicable(reason) {
  return {
    ran: false,
    applicable: false,
    ok: null,
    cleanly_closeable: null,
    generated_views: "not_evaluated",
    reason,
    next_action: reason
  };
}

async function resolveCloseoutLint({ workspaceDir, applicable, notApplicableReason }) {
  if (!applicable) {
    return closeoutLintNotApplicable(notApplicableReason);
  }
  const summary = await buildCloseoutLintSummary({ dir: workspaceDir });
  return { applicable: true, ...summary };
}

function compactCloseoutLintFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return finding;
  }
  return {
    code: finding.code ?? null,
    path: finding.path ?? null,
    message: finding.message ?? finding.summary ?? null
  };
}

function closeoutLintHasSuppressedDetail(closeoutLint, compactCloseoutLint) {
  if (!closeoutLint || typeof closeoutLint !== "object" || Array.isArray(closeoutLint)) {
    return false;
  }
  if (Array.isArray(closeoutLint.top_findings) && closeoutLint.top_findings.length > CLOSEOUT_LINT_FINDING_LIMIT) {
    return true;
  }
  const compactKeys = new Set(Object.keys(compactCloseoutLint));
  return Object.keys(closeoutLint).some((key) => {
    if (compactKeys.has(key)) {
      return false;
    }
    const value = closeoutLint[key];
    if (value === null || value === undefined || value === false) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  });
}

export function shapeCloseoutLintResponse(closeoutLint, { verbose = false } = {}) {
  if (verbose) {
    return {
      closeout_lint: closeoutLint,
      detail_available: false
    };
  }

  const compactCloseoutLint = {
    ran: closeoutLint?.ran ?? null,
    applicable: closeoutLint?.applicable ?? null,
    ok: closeoutLint?.ok ?? null,
    cleanly_closeable: closeoutLint?.cleanly_closeable ?? null,
    error_count: closeoutLint?.error_count ?? 0,
    top_findings: Array.isArray(closeoutLint?.top_findings)
      ? closeoutLint.top_findings.slice(0, CLOSEOUT_LINT_FINDING_LIMIT).map((finding) => compactCloseoutLintFinding(finding))
      : []
  };

  if (closeoutLint?.next_action) {
    compactCloseoutLint.next_action = closeoutLint.next_action;
  }

  return {
    closeout_lint: compactCloseoutLint,
    detail_available: closeoutLintHasSuppressedDetail(closeoutLint, compactCloseoutLint)
  };
}

function attachCloseoutLintResponse(response, closeoutLint, { verbose = false } = {}) {
  const shaped = shapeCloseoutLintResponse(closeoutLint, { verbose });
  response.closeout_lint = shaped.closeout_lint;
  response.cleanly_closeable = shaped.closeout_lint?.cleanly_closeable ?? null;
  if (shaped.detail_available) {
    response.detail_available = true;
  }
  return response;
}

export function registerWorkRecordWriteTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  shapeWriteResponse,
  createCompactWorkRecordEditResponse,
  createCompactContractEditResponse,
  validateOptionalExpectedSourceDigest,
  runWorkspaceWorkRecordAdmissionRefreshRoute,
  runWorkspaceWorkRecordCleanupDerivedEvidenceRoute,
  constants
}) {
  const {
    WORK_RECORD_STATUS_VALUES,
    WORK_RECORD_CONTRACT_LIST_FIELDS,
    WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
    WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME,
    WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
    WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
    WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME
  } = constants;

  registerTool(
    WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
    {
      description:
        "Write-capable: set the status of a WK or slice (`unit`) through the validated work-record persistence path, honoring an optional expected_source_digest for stale-write protection. Transitions to review or done also run an advisory closeout lint.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          status: z.enum(WORK_RECORD_STATUS_VALUES),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactWorkRecordEditResponse(workspace.repo, {
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                status: null,
                task: null,
                source_digest: null,
                expected_source_digest: args.expected_source_digest ?? null,
                current_source_digest: null,
                diagnostics: [digestValidation.diagnostic]
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await setWorkRecordStatusByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          status: args.status,
          expectedSourceDigest: digestValidation.value
        });
        const response = createCompactWorkRecordEditResponse(workspace.repo, result);

        const writeApplied = closeoutWriteApplied(result);
        const triggersLint = CLOSEOUT_LINT_STATUS_TRIGGER_VALUES.includes(args.status);
        const closeoutLint = await resolveCloseoutLint({
          workspaceDir: workspace.dir,
          applicable: writeApplied && triggersLint,
          notApplicableReason: !writeApplied
            ? "the status write was not applied; no closeout lint was run"
            : `status '${args.status}' does not trigger closeout lint (only transitions to review or done do)`
        });
        return jsonContent(
          attachCloseoutLintResponse(
            shapeWriteResponse(response, { verbose: Boolean(args.verbose) }),
            closeoutLint,
            { verbose: Boolean(args.verbose) }
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME,
    {
      description:
        "Write-capable: mark a work-record task done on a WK or slice (`unit`), selecting the task by exact `text` or zero-based `index`, through the validated work-record persistence path, honoring an optional expected_source_digest for stale-write protection.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          text: z.string().optional(),
          index: z
            .union([z.number().int().nonnegative(), z.string().regex(/^(0|[1-9][0-9]*)$/)])
            .optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactWorkRecordEditResponse(workspace.repo, {
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                status: null,
                task: null,
                source_digest: null,
                expected_source_digest: args.expected_source_digest ?? null,
                current_source_digest: null,
                diagnostics: [digestValidation.diagnostic]
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await setWorkRecordTaskByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          text: args.text,
          index: args.index,
          expectedSourceDigest: digestValidation.value
        });
        return jsonContent(
          shapeWriteResponse(createCompactWorkRecordEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_set_closure",
    {
      description:
        "Write-capable: apply a structured closure patch (summary, validation, follow_ups) to a WK or slice (`unit`). Validates against the canonical schema and refuses if a supplied expected_source_digest no longer matches the on-disk record.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),

          closure: z
            .object({
              summary: z.string().optional(),
              validation: z.array(z.string()).optional(),
              follow_ups: z.array(z.string()).optional()
            })
            .strict(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await setWorkRecordClosureByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          closurePatch: args.closure,
          expectedSourceDigest: args.expected_source_digest ?? null
        });
        const closurePayload = {
          workspaceRepo: workspace.repo,
          record_id: result.record_id ?? null,
          selected_unit: result.selected_unit ?? null,
          canonical_record_path: result.canonical_record_path ?? null,
          source_digest: result.source_digest ?? null,
          valid: Boolean(result.valid),
          written: Boolean(result.written),
          no_op: Boolean(result.no_op),
          changed_fields: result.changed_fields ?? [],
          closure: result.closure ?? null,
          diagnostics: result.diagnostics ?? []
        };

        const closeoutLint = await resolveCloseoutLint({
          workspaceDir: workspace.dir,
          applicable: closeoutWriteApplied(result),
          notApplicableReason: "the closure write was not applied; no closeout lint was run"
        });
        return jsonContent(
          attachCloseoutLintResponse(
            shapeWriteResponse(closurePayload, { verbose: Boolean(args.verbose) }),
            closeoutLint,
            { verbose: Boolean(args.verbose) }
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_upsert_slice",
    {
      description:
        "Write-capable: create-if-absent / update-if-present a tracker-local slice on a WK (`unit`). Omit `slice.id` to create the next `SLICE-###` id; an explicit id selects an existing slice or, for new slices, must be an ordinal id because explicit new semantic ids are refused by the core planner. Validates the edited record against work-record.v1 before writing and refuses to persist a schema-invalid result.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          slice: z.object({}).passthrough(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactContractEditResponse(workspace.repo, {
                operation: "upsert_slice",
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                diagnostics: [digestValidation.diagnostic],
                next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await editWorkRecordContractByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          operation: "upsert_slice",
          params: { slice: args.slice },
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeWriteResponse(createCompactContractEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_delete_slice",
    {
      description:
        "Write-capable: delete a tracker-local slice from a WK, addressed by a slice-scoped `unit` or an explicit `slice_id`. Validates the edited record against work-record.v1 before writing.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          slice_id: z.string().optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactContractEditResponse(workspace.repo, {
                operation: "delete_slice",
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                diagnostics: [digestValidation.diagnostic],
                next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await editWorkRecordContractByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          operation: "delete_slice",
          params: { slice_id: args.slice_id },
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeWriteResponse(createCompactContractEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_set_list_field",
    {
      description:
        "Write-capable: set one controlled list-valued contract field (`field`/`values`) at record or slice scope, selected by `unit`; slice scope accepts only the slice-relevant subset of fields. Validates against work-record.v1 before writing.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          field: z.enum(WORK_RECORD_CONTRACT_LIST_FIELDS),
          values: z.array(z.string()),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactContractEditResponse(workspace.repo, {
                operation: "set_list_field",
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                diagnostics: [digestValidation.diagnostic],
                next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await editWorkRecordContractByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          operation: "set_list_field",
          params: { field: args.field, values: args.values },
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeWriteResponse(createCompactContractEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_set_acceptance",
    {
      description:
        "Write-capable: set acceptance.criteria and/or acceptance.validation at record or slice scope for a WK, selected by `unit`. Validates against work-record.v1 before writing.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          criteria: z.array(z.string()).optional(),
          validation: z.array(z.string()).optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactContractEditResponse(workspace.repo, {
                operation: "set_acceptance",
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                diagnostics: [digestValidation.diagnostic],
                next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await editWorkRecordContractByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          operation: "set_acceptance",
          params: { criteria: args.criteria, validation: args.validation },
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeWriteResponse(createCompactContractEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_shape_review_unit",
    {
      description:
        "Write-capable: shape a WK or tracker-local slice (`unit`) into a findings-only review unit — set work_kind to 'review', force write_scope to [], and point the dispatch intent at the reviewer role. Validates against work-record.v1 before writing.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digestValidation = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digestValidation.ok) {
          return jsonContent(
            shapeWriteResponse(
              createCompactContractEditResponse(workspace.repo, {
                operation: "shape_review_unit",
                valid: false,
                written: false,
                no_op: false,
                changed_fields: [],
                diagnostics: [digestValidation.diagnostic],
                next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
              }),
              { verbose: Boolean(args.verbose) }
            )
          );
        }
        const result = await editWorkRecordContractByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          operation: "shape_review_unit",
          params: {},
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeWriteResponse(createCompactContractEditResponse(workspace.repo, result), {
            verbose: Boolean(args.verbose)
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
    {
      description:
        "Write-capable: refresh stored worker-admission derived evidence for a WK or slice (`unit` or `id`) through the canonical admission refresh path, honoring an optional expected_source_digest.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string().optional(),
          id: z.string().optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {

        return await runWorkspaceWorkRecordAdmissionRefreshRoute({
          workspaceRepos,
          args,
          toolName: WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
    {
      description:
        "Write-capable: refresh target-resolution evidence for a WK or slice (`unit` or `id`) through the canonical worker-admission derived-evidence refresh path, honoring an optional expected_source_digest. A strict input schema rejects caller-carried policy fields.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string().optional(),
          id: z.string().optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        return await runWorkspaceWorkRecordAdmissionRefreshRoute({
          workspaceRepos,
          args,
          toolName: WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
          refusalMessage: "target-resolution refresh did not write"
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME,
    {
      description:
        "Report or prune oversized worker-admission derived evidence on a WK. Cleanup is whole-record: pass a record-level `id` or `unit` (a slice address resolves to its parent). Dry-run by default; pass `write: true` to persist the pruned record through the validated work-record path with stale-source protection. Keeps the newest usable worker-admission entry per unit and never drops graph-impact or other non-worker-admission evidence.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string().optional(),
          id: z.string().optional(),
          write: z.boolean().optional(),
          verbose: z.boolean().optional(),
          expected_source_digest: z.string().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        return await runWorkspaceWorkRecordCleanupDerivedEvidenceRoute({ workspaceRepos, args });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
