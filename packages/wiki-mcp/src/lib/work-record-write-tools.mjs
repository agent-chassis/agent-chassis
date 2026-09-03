

import {
  setWorkRecordStatusByUnit
} from "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  setWorkRecordClosureByUnit
} from "@agent-chassis/wiki-core";
import {
  editWorkRecordContractByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  runWorkspaceWorkRecordReadySliceRoute,
  validateOptionalExpectedSourceDigest
} from "./work-record-write-route-helpers.mjs";
import {
  WORK_RECORD_REVIEW_PURPOSE_VALUES,
  WORK_RECORD_STATUS_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";

import {
  READY_PRIORITY_VALUES,
  READY_SHAPING_MODE_VALUES,
  READY_SLICE_WORK_KIND_VALUES,
  readyAcceptance,
  readyExpectedEditTarget,
  readyNonemptyString,
  readyRepositoryPath,
  readySliceAgentNotes,
  readySliceDispatchIntent
} from "./work-record-write-tool-schema-vocabulary.mjs";

import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import {
  registerWorkRecordListFieldCompatibilityTool,
  registerWorkRecordTaskAndGeneralEditTools
} from "./work-record-authored-field-tools.mjs";

export const WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME =
  "workspace_work_record_ready_slice";

function shapeContractEditResponse(
  shapeResponse,
  createResponse,
  workspaceRepo,
  result,
  verbose
) {
  const response = shapeResponse(
    createResponse(workspaceRepo, result),
    { verbose: Boolean(verbose) }
  );
  return {
    ...response,
    generation_transition: result?.generation_transition ?? null
  };
}

export function createReadySliceInputSchema(z) {

  const nonemptyString = () => readyNonemptyString(z);
  const repositoryPath = () => readyRepositoryPath(z);

  const acceptance = () => readyAcceptance(z, { structuredCriteria: true });

  const expectedTarget = () =>
    readyExpectedEditTarget(z, { coarseFacets: true, facetProvenance: true });

  return z
    .object({
      repo: z.string().optional(),
      unit: z.string().regex(/^WK-[0-9]{4}$/),
      slice_id: z.string().regex(/^SLICE-[0-9]{3}$/).optional(),
      expected_source_digest: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional(),
      shaping_mode: z.enum(READY_SHAPING_MODE_VALUES).optional(),
      verbose: z.boolean().optional(),
      title: nonemptyString().optional(),
      status: z.enum(WORK_RECORD_STATUS_VALUES).optional(),
      work_kind: z.enum(READY_SLICE_WORK_KIND_VALUES).optional(),
      review_purpose: z.enum(WORK_RECORD_REVIEW_PURPOSE_VALUES).optional(),

      completion_policy: z.string().optional(),
      priority: z.enum(READY_PRIORITY_VALUES).optional(),
      owner: nonemptyString().optional(),
      depends_on: z.array(nonemptyString()).optional(),
      read_scope: z.array(nonemptyString()).min(1).optional(),
      repo_paths: z.array(repositoryPath()).min(1).optional(),
      write_scope: z.array(repositoryPath()).optional(),
      dispatch_intent: readySliceDispatchIntent(z).optional(),
      acceptance: acceptance().optional(),
      expected_edit_targets: z.array(expectedTarget()).optional(),
      expected_changed_line_budget: z.number().int().nonnegative().nullable().optional(),
      agent_notes: readySliceAgentNotes(z).optional()
    })
    .strict();
}

const CLOSEOUT_LINT_STATUS_TRIGGER_VALUES = ["review", "done"];
const CLOSEOUT_LINT_FINDING_LIMIT = 3;

export class CloseoutLintResultContractError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "CloseoutLintResultContractError";
    this.code = "closeout_lint_result_contract_error";
    this.result_tuple = Object.freeze({
      valid: Boolean(result?.valid),
      written: Boolean(result?.written),
      no_op: Boolean(result?.no_op)
    });
  }
}

function closeoutLintDeferred(reason, applicable, nextAction) {
  return {
    ran: false,
    applicable,
    ok: null,
    cleanly_closeable: null,
    generated_views: "not_evaluated",
    reason,
    next_action: nextAction
  };
}

export function buildDeferredCloseoutLint({ result, transitionApplicable }) {
  const valid = Boolean(result?.valid);
  const written = Boolean(result?.written);
  const noOp = Boolean(result?.no_op);

  if (written && noOp) {
    throw new CloseoutLintResultContractError(
      "closeout mutation result cannot be both written and no_op",
      result
    );
  }
  if (noOp && !valid) {
    throw new CloseoutLintResultContractError(
      "closeout mutation result cannot be no_op and invalid",
      result
    );
  }
  if (written && !valid) {
    return closeoutLintDeferred(
      "persisted_but_invalid",
      false,
      "repair the persisted invalid work record before requesting repository verification"
    );
  }
  if (!written && !noOp) {
    return closeoutLintDeferred(
      "write_not_applied",
      false,
      "repair the reported mutation diagnostics and retry the write"
    );
  }
  if (!transitionApplicable) {
    return closeoutLintDeferred(
      "transition_not_applicable",
      false,
      "repository closeout verification applies only to status review/done or a closure mutation"
    );
  }
  const reason = noOp ? "deferred_after_no_op" : "deferred_after_write";
  return closeoutLintDeferred(
    reason,
    true,
    "after all intended closeout mutations, call workspace_generate_and_lint once to verify the repository state observed by that invocation"
  );
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

  if (closeoutLint?.ran === false && closeoutLint?.generated_views) {
    compactCloseoutLint.generated_views = closeoutLint.generated_views;
  }
  if (closeoutLint?.reason) {
    compactCloseoutLint.reason = closeoutLint.reason;
  }

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
    WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
    WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
    WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
    WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME
  } = constants;
  const authoredFieldDependencies = {
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
    constants
  };

  registerTool(
    WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Set a WK or slice status through validated persistence. Write-capable; optional expected_source_digest rejects stale writes. Review/done verification is deferred to workspace_generate_and_lint.",
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
          const result = {
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
          };
          return jsonContent(
            attachCloseoutLintResponse(
              shapeWriteResponse(
                createCompactWorkRecordEditResponse(workspace.repo, result),
                { verbose: Boolean(args.verbose) }
              ),
              buildDeferredCloseoutLint({
                result,
                transitionApplicable: CLOSEOUT_LINT_STATUS_TRIGGER_VALUES.includes(args.status)
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
        const triggersLint = CLOSEOUT_LINT_STATUS_TRIGGER_VALUES.includes(args.status);
        const closeoutLint = buildDeferredCloseoutLint({
          result,
          transitionApplicable: triggersLint
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

  registerWorkRecordTaskAndGeneralEditTools(authoredFieldDependencies);

  registerTool(
    "workspace_work_record_set_closure",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description:
        "Patch a WK or slice closure through validated persistence. Write-capable; optional expected_source_digest rejects stale writes. Repository verification is deferred.",
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
        const closeoutLint = buildDeferredCloseoutLint({
          result,
          transitionApplicable: true
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
    WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description:
        "Create or update one independently executable slice under ready-slice-contract.v1. Write-capable. Creation allocates the next slice ID; omitted update fields preserve stored values. Use the four common expected_edit_targets fields; advanced facets are optional. Unknown shapes refuse. Role shaping enforces read/write boundaries. The lock-bound CAS returns structural readiness only. completion_policy is terminal-review-only; after projection_internal, inspect the persisted record before retrying.",
      inputSchema: createReadySliceInputSchema(z)
    },
    async (args) => {
      try {
        return await runWorkspaceWorkRecordReadySliceRoute({
          workspaceRepos,
          args,
          dependencies: { resolveWorkspaceRepo }
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_upsert_slice",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NESTED_MERGE_REPLACEMENT,
      description:
        "Create or update a tracker-local WK slice. Write-capable. Omit slice.id to allocate the next ordinal ID; an explicit ID selects an existing slice or must be a new ordinal. Invalid prospective records refuse before persistence.",
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
          shapeContractEditResponse(
            shapeWriteResponse,
            createCompactContractEditResponse,
            workspace.repo,
            result,
            args.verbose
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_delete_slice",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Delete a tracker-local WK slice selected by slice-scoped unit or slice_id. Write-capable; the prospective work record must validate before persistence.",
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
          shapeContractEditResponse(
            shapeWriteResponse,
            createCompactContractEditResponse,
            workspace.repo,
            result,
            args.verbose
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerWorkRecordListFieldCompatibilityTool(authoredFieldDependencies);

  registerTool(
    "workspace_work_record_set_acceptance",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
      description:
        "Set WK- or slice-scoped acceptance criteria and/or validation. Write-capable and the only contract setter allowed to repair an invalid base whose errors are confined to the selected acceptance subtree. Omitted criteria or validation is preserved only when acceptance is already object-shaped; otherwise supply both arrays. verbose:true returns complete diagnostics.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          criteria: z.array(z.string()).optional(),
          validation: z.array(z.union([
            z.string(),
            z.object({
              command: z.string(),
              verification_ids: z.array(z.string())
            }).strict()
          ])).optional(),
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
          shapeContractEditResponse(
            shapeWriteResponse,
            createCompactContractEditResponse,
            workspace.repo,
            result,
            args.verbose
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_shape_review_unit",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Shape a WK or slice as a findings-only review unit by setting work_kind review, empty write_scope, and reviewer dispatch intent. Write-capable; invalid prospective records refuse.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          unit: z.string(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional(),
          review_purpose: z.enum(["standalone", "terminal_whole_wk"]).optional()
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
          params: { reviewPurpose: args.review_purpose ?? "standalone" },
          expectedSourceDigest: digestValidation.value,
          verbose: Boolean(args.verbose)
        });
        return jsonContent(
          shapeContractEditResponse(
            shapeWriteResponse,
            createCompactContractEditResponse,
            workspace.repo,
            result,
            args.verbose
          )
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Refresh stored worker-admission derived evidence for a WK or slice. Write-capable; the canonical route honors optional expected_source_digest stale-write protection.",
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
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Refresh stored target-resolution evidence for a WK or slice. Write-capable; optional expected_source_digest protects the canonical write, and caller-carried policy fields refuse.",
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
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Report or prune oversized worker-admission derived evidence for a whole WK; slice addresses resolve to the parent. Dry-run by default; write:true persists with stale-source protection. Cleanup keeps the newest usable entry per unit and preserves other evidence classes.",
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
