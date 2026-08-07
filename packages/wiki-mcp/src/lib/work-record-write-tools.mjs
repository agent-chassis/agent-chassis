

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
  runWorkspaceWorkRecordReadySliceRoute,
  validateOptionalExpectedSourceDigest
} from "./work-record-write-route-helpers.mjs";
import {
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-target-metrics.mjs";

export const WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME =
  "workspace_work_record_ready_slice";

const READY_SLICE_STATUS_VALUES = [
  "inbox",
  "todo",
  "active",
  "review",
  "done",
  "blocked",
  "parked",
  "cancelled"
];
const READY_SLICE_WORK_KIND_VALUES = ["implementation", "review", "redteam"];
const READY_SLICE_PRIORITY_VALUES = ["low", "medium", "high", "critical"];
const READY_SLICE_SHAPING_VALUES = ["implementation", "reviewer", "redteam"];
const READY_SLICE_ATTESTATION_ACTION_VALUES = [
  "preserve_or_refuse",
  "invalidate_for_review"
];

function addReadySliceSchemaIssue(context, path, message) {
  context.addIssue({ code: "custom", path: [path], message });
}

function isReadySliceRepositoryPath(value) {
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  const segments = normalized.split("/");
  return !(
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  );
}

export function createReadySliceInputSchema(z) {
  const nonemptyString = z.string().trim().min(1);
  const repositoryPath = nonemptyString.refine(isReadySliceRepositoryPath, {
    message: "must be a canonical repository-relative POSIX path"
  });
  const provenanceValue = z.enum(WORK_UNIT_FACET_PROVENANCE_VALUES).nullable();
  const acceptanceProvenance = z
    .object({
      text: provenanceValue.optional(),
      verification_method: provenanceValue.optional(),
      evidence_target: provenanceValue.optional()
    })
    .strict();
  const targetProvenance = z
    .object({
      path: provenanceValue.optional(),
      name: provenanceValue.optional(),
      kind: provenanceValue.optional(),
      operation: provenanceValue.optional(),
      activity_kind: provenanceValue.optional(),
      artifact_kind: provenanceValue.optional(),
      granularity: provenanceValue.optional(),
      optional: provenanceValue.optional()
    })
    .strict();
  const acceptanceCriterion = z.union([
    nonemptyString,
    z
      .object({
        text: nonemptyString,
        verification_method: z
          .enum(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES)
          .nullable()
          .optional(),
        evidence_target: z.string().nullable().optional(),
        facet_provenance: acceptanceProvenance.optional()
      })
      .strict()
  ]);
  const acceptance = z
    .object({
      criteria: z.array(acceptanceCriterion).min(1),
      validation: z.array(nonemptyString).min(1)
    })
    .strict();
  const expectedTarget = z
    .object({
      path: repositoryPath,
      name: nonemptyString,
      kind: z.enum(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES),
      operation: z.enum(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES),
      activity_kind: z
        .enum(WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES)
        .nullable()
        .optional(),
      artifact_kind: z
        .enum(WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES)
        .nullable()
        .optional(),
      granularity: z
        .enum(WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES)
        .nullable()
        .optional(),
      optional: z.boolean().optional(),
      facet_provenance: targetProvenance.optional()
    })
    .strict();
  const dispatchIntent = z
    .object({
      intended_agent_role: z.enum(["worker", "reviewer", "redteam"]),
      target_unit: z.literal("slice"),
      requires_graph_impact: z.boolean(),
      requires_escalation: z.boolean()
    })
    .strict();
  const agentNotes = z
    .union([z.string(), z.array(z.string())])
    .refine(
      (value) =>
        Buffer.byteLength(Array.isArray(value) ? value.join("\n") : value, "utf8") <= 8192,
      { message: "agent_notes must be at most 8192 UTF-8 bytes after LF joining" }
    );

  return z
    .object({
      repo: z.string().optional(),
      unit: z.string().regex(/^WK-[0-9]{4}$/),
      slice_id: z.string().regex(/^SLICE-[0-9]{3}$/).optional(),
      expected_source_digest: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional(),
      shaping_mode: z.enum(READY_SLICE_SHAPING_VALUES).optional(),
      attestation_action: z
        .enum(READY_SLICE_ATTESTATION_ACTION_VALUES)
        .optional(),
      verbose: z.boolean().optional(),
      title: nonemptyString.optional(),
      status: z.enum(READY_SLICE_STATUS_VALUES).optional(),
      work_kind: z.enum(READY_SLICE_WORK_KIND_VALUES).optional(),
      review_purpose: z.enum(["standalone", "terminal_whole_wk"]).optional(),

      completion_policy: z.string().optional(),
      priority: z.enum(READY_SLICE_PRIORITY_VALUES).optional(),
      owner: nonemptyString.optional(),
      depends_on: z.array(nonemptyString).optional(),
      read_scope: z.array(nonemptyString).min(1).optional(),
      repo_paths: z.array(repositoryPath).min(1).optional(),
      write_scope: z.array(repositoryPath).optional(),
      dispatch_intent: dispatchIntent.optional(),
      acceptance: acceptance.optional(),
      expected_edit_targets: z.array(expectedTarget).optional(),
      expected_changed_line_budget: z.number().int().nonnegative().nullable().optional(),
      agent_notes: agentNotes.optional()
    })
    .strict()
    .superRefine((args, context) => {
      const create = args.slice_id === undefined;
      const mode = args.shaping_mode ?? (create ? "implementation" : null);
      const expectedShape = {
        implementation: { workKind: "implementation", role: "worker" },
        reviewer: { workKind: "review", role: "reviewer" },
        redteam: { workKind: "redteam", role: "redteam" }
      }[mode];

      if (create) {
        for (const field of ["title", "read_scope", "repo_paths", "acceptance"]) {
          if (args[field] === undefined) {
            addReadySliceSchemaIssue(context, field, `${field} is required on create`);
          }
        }
      }
      if (
        create &&
        args.attestation_action === "invalidate_for_review"
      ) {
        addReadySliceSchemaIssue(
          context,
          "attestation_action",
          "creation cannot invalidate an attestation"
        );
      }
      if (
        (mode === "reviewer" || mode === "redteam") &&
        args.attestation_action === "invalidate_for_review"
      ) {
        addReadySliceSchemaIssue(
          context,
          "attestation_action",
          "findings-only shaping cannot invalidate an implementation attestation"
        );
      }
      if (expectedShape && args.work_kind !== undefined && args.work_kind !== expectedShape.workKind) {
        addReadySliceSchemaIssue(
          context,
          "work_kind",
          "work_kind contradicts shaping_mode"
        );
      }
      if (args.review_purpose !== undefined &&
          (mode === "implementation" || mode === "redteam")) {
        addReadySliceSchemaIssue(context, "review_purpose", "review_purpose is valid only for reviewer shaping");
      }
      if (
        expectedShape &&
        args.dispatch_intent !== undefined &&
        args.dispatch_intent.intended_agent_role !== expectedShape.role
      ) {
        addReadySliceSchemaIssue(
          context,
          "dispatch_intent",
          "dispatch_intent contradicts shaping_mode"
        );
      }
      if (mode === "implementation") {
        if (create && (!Array.isArray(args.write_scope) || args.write_scope.length === 0)) {
          addReadySliceSchemaIssue(
            context,
            "write_scope",
            "implementation write_scope is required and non-empty on create"
          );
        }
        if (
          create &&
          (!Array.isArray(args.expected_edit_targets) ||
            args.expected_edit_targets.length === 0)
        ) {
          addReadySliceSchemaIssue(
            context,
            "expected_edit_targets",
            "implementation expected_edit_targets is required and non-empty on create"
          );
        }
        if (args.write_scope !== undefined && args.write_scope.length === 0) {
          addReadySliceSchemaIssue(
            context,
            "write_scope",
            "implementation write_scope must be non-empty"
          );
        }
        if (
          args.expected_edit_targets !== undefined &&
          args.expected_edit_targets.length === 0
        ) {
          addReadySliceSchemaIssue(
            context,
            "expected_edit_targets",
            "implementation expected_edit_targets must be non-empty"
          );
        }
      }
      if (mode === "reviewer" || mode === "redteam") {
        if (args.write_scope?.length > 0) {
          addReadySliceSchemaIssue(
            context,
            "write_scope",
            "reviewer/redteam write_scope must be empty"
          );
        }
        if (args.expected_edit_targets?.some((target) => target.operation !== "inspect")) {
          addReadySliceSchemaIssue(
            context,
            "expected_edit_targets",
            "reviewer/redteam expected_edit_targets must be an inspection plan"
          );
        }
      }
    });
}

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
    WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME,
    {
      description:
        "Write-capable: atomically create or update one independently executable tracker-local slice contract using ready-slice-contract.v1. The strict whole-object schema rejects unknown properties and arbitrary nested patches; omitted update fields preserve exact persisted values, while supplied fields replace whole fields after normalization. Creation allocates the next SLICE-### and applies documented defaults. implementation/reviewer/redteam shaping owns work_kind, dispatch role, target_unit, write_scope constraints, and findings-only inspection constraints. The operation performs one load-to-write CAS and one full-persistence-snapshot CAS under the store lock, never returns the private snapshot digest, invalidates only an explicitly selected unit/current-digest attestation carry when valid, and never mutates sidecars. An optional completion_policy authors the DEC-0173 record-level completion policy, currently forge_confirmed_merge, and is accepted only while shaping the terminal whole-WK review slice; the core planner remains the authority on the accepted values and that placement rule, and the field carries no forge observation, merge evidence, candidate identity, closeout, or publication authority. Success/no-op returns only ready-slice-structural-readiness.v1; this closed structural vocabulary is read-only and is not dispatch readiness, dependency policy, admission evidence, Node Engine evaluation, launch, provisioning, or backend selection. A post-persistence projection failure remains contract_persisted:true with persisted whole-record and reviewed-unit digests and projection_internal. workspace_agent_dispatch remains the separate WK-1567 dispatch-owned evidence-derivation and launch-intent call.",
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
        "Write-capable: set acceptance.criteria and/or acceptance.validation at record or slice scope for a WK, selected by `unit`. This is the only contract setter that may repair a structurally parsed invalid base, and only when the persisted record is already canonical and every base error is confined to the selected acceptance subtree; every other setter remains fail-closed. Object-shaped acceptance preserves an omitted criteria/validation sibling exactly, while missing or non-object acceptance requires both arrays as a whole replacement. The server guards the post-normalization persisted diff to caller-named acceptance paths plus enumerated server-managed fields, fully validates the prospective record, and performs one CAS-protected write. Compact responses preserve diagnostic order and codes, but diagnostic count and fields may be bounded; `diagnostics_truncation` reports compaction, and `detail_available` identifies verbose retrieval. `verbose:true` returns complete core diagnostics, while responses requiring no truncation retain their existing shape. The strict schema grants no arbitrary invalid-record edit or caller-controlled authority input.",
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
