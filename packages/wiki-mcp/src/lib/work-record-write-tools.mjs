

import {
  setWorkRecordStatusByUnit
} from "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  setWorkRecordClosureByUnit
} from "@agent-chassis/wiki-core/src/operations/work-records-edits.mjs";
import {
  editWorkRecordContractByUnit,
  upsertWorkRecordSliceByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  compactGenerationTransition,
  projectPublicationOutcome,
  validateOptionalExpectedSourceDigest
} from "./work-record-write-route-helpers.mjs";
import { runWorkspaceWorkRecordReadySliceRoute } from
  "./work-record-ready-slice-route.mjs";
import {
  WORK_RECORD_COMPLETION_POLICY_VALUES,
  WORK_RECORD_REVIEW_PURPOSE_VALUES,
  WORK_RECORD_STATUS_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  WORK_RECORD_MATERIAL_REFERENCE_LIMIT
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-material.mjs";

import {
  canonicalWorkRecordUnitAddress,
  READY_PRIORITY_VALUES,
  READY_SHAPING_MODE_VALUES,
  READY_SLICE_WORK_KIND_VALUES,
  readyAcceptance,
  readyExpectedEditTarget,
  readyNonemptyString,
  workRecordProseContent,
  readyRepositoryPath,
  readySliceDispatchIntent,
  upsertSliceBodyContractDeclaration
} from "./work-record-write-tool-schema-vocabulary.mjs";

import { recordServedToolInputContract } from "./compact-tool-declaration-registry.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import {
  registerWorkRecordTaskAndGeneralEditTools
} from "./work-record-authored-field-tools.mjs";
import { generateAndLint } from "@agent-chassis/wiki-core/src/operations/generate-and-lint.mjs";
import {
  CLOSEOUT_LINT_STATUS_TRIGGER_VALUES,
  buildDeferredCloseoutLint,
  composeCloseoutResponse,
  runCloseoutChecks
} from "./work-record-closeout-response.mjs";

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
    generation_transition: verbose
      ? result?.generation_transition ?? null
      : compactGenerationTransition(
        result?.generation_transition ?? null,
        response.selected_unit ?? result?.selected_unit ?? null
      )
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

      completion_policy: z.enum(WORK_RECORD_COMPLETION_POLICY_VALUES).optional(),
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
      summary: workRecordProseContent(z, {
        field: "sections.summary", scope: "slice"
      }).optional(),
      why_it_matters: workRecordProseContent(z, {
        field: "sections.why_it_matters", scope: "slice"
      }).optional(),
      agent_notes: workRecordProseContent(z, {
        field: "sections.agent_notes", scope: "slice"
      }).optional(),
      material_refs: z.array(z.object({ ref: z.string().min(1) }).strict())
        .max(WORK_RECORD_MATERIAL_REFERENCE_LIMIT).optional()
    })
    .strict();
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
  routeDependencies = {},
  constants
}) {

  const runGenerateAndLint = routeDependencies.generateAndLint ?? generateAndLint;
  const {
    WORK_RECORD_STATUS_VALUES,
    WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
    WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME
  } = constants;
  const runReadySliceRoute = routeDependencies.runWorkspaceWorkRecordReadySliceRoute ??
    runWorkspaceWorkRecordReadySliceRoute;
  const editContractByUnit = routeDependencies.editWorkRecordContractByUnit ??
    editWorkRecordContractByUnit;
  const upsertSliceByUnit = routeDependencies.upsertWorkRecordSliceByUnit ??
    upsertWorkRecordSliceByUnit;

  const setClosureByUnit = routeDependencies.setWorkRecordClosureByUnit ??
    setWorkRecordClosureByUnit;
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
        "Set a WK or slice status through validated persistence. Write-capable; optional expected_source_digest rejects stale writes. A landed review/done transition runs its own closeout checks.",
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
          return composeCloseoutResponse({
            payload: createCompactWorkRecordEditResponse(workspace.repo, result),
            closeoutLint: buildDeferredCloseoutLint({
              result,
              transitionApplicable: CLOSEOUT_LINT_STATUS_TRIGGER_VALUES.includes(args.status)
            }),
            verbose: Boolean(args.verbose),
            jsonContent,
            shapeWriteResponse
          });
        }
        const result = await setWorkRecordStatusByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          status: args.status,
          expectedSourceDigest: digestValidation.value
        });
        const response = createCompactWorkRecordEditResponse(workspace.repo, result);
        const triggersLint = CLOSEOUT_LINT_STATUS_TRIGGER_VALUES.includes(args.status);
        const closeoutLint = await runCloseoutChecks({
          result,
          transitionApplicable: triggersLint,
          workspaceDir: workspace.dir,
          generateAndLint: runGenerateAndLint
        });
        return composeCloseoutResponse({
          payload: response,
          closeoutLint,
          publicationState: result.publication_state ?? null,
          verbose: Boolean(args.verbose),
          jsonContent,
          shapeWriteResponse
        });
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
        "Patch a WK or slice closure through validated persistence; optional status:\"done\" composes closure and completion in one write. Optional expected_source_digest rejects stale writes. It runs its own closeout checks.",
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

          status: z.literal("done").optional(),
          expected_source_digest: z.string().optional(),
          verbose: z.boolean().optional()
        })
        .strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

        const digestValidation = validateOptionalExpectedSourceDigest(
          args.expected_source_digest ?? null
        );
        if (!digestValidation.ok) {
          const refusal = {
            valid: false,
            written: false,
            no_op: false,
            changed_fields: [],
            status: null,
            closure: null,
            source_digest: null,
            expected_source_digest: args.expected_source_digest ?? null,
            current_source_digest: null,
            diagnostics: [digestValidation.diagnostic]
          };
          return composeCloseoutResponse({
            payload: { workspaceRepo: workspace.repo, record_id: null, selected_unit: null, ...refusal },
            closeoutLint: buildDeferredCloseoutLint({ result: refusal, transitionApplicable: true }),
            verbose: Boolean(args.verbose),
            jsonContent,
            shapeWriteResponse
          });
        }
        const result = await setClosureByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          closurePatch: args.closure,
          status: args.status ?? null,
          expectedSourceDigest: digestValidation.value
        });
        const closurePayload = {
          workspaceRepo: workspace.repo,
          record_id: result.record_id ?? null,
          selected_unit: result.selected_unit ?? null,
          canonical_record_path: result.canonical_record_path ?? null,
          source_digest: result.source_digest ?? null,
          valid: Boolean(result.valid),

          ...projectPublicationOutcome(result),
          no_op: Boolean(result.no_op),
          changed_fields: result.changed_fields ?? [],
          closure: result.closure ?? null,

          status: result.status ?? null,
          diagnostics: result.diagnostics ?? []
        };
        const closeoutLint = await runCloseoutChecks({
          result,
          transitionApplicable: true,
          workspaceDir: workspace.dir,
          generateAndLint: runGenerateAndLint
        });
        return composeCloseoutResponse({
          payload: closurePayload,
          closeoutLint,
          publicationState: result.publication_state ?? null,
          verbose: Boolean(args.verbose),
          jsonContent,
          shapeWriteResponse
        });
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
        "Clean update or semantic no-op returns exactly {ok:true}; clean creation also returns slice_id (actual server-allocated ID). Optional summary, why_it_matters and agent_notes use the shared text/ref/parts carrier and persist resolved strings. It acknowledges persisted caller-authored data only and grants no authority. Actionable warnings, refusals, nonclean publication outcomes, effect certainty, and supported recovery remain detailed. Read details and current source_digest via workspace_work_record_summary or workspace_read_page with selected_slice. Implementation needs complete or opted-out proof posture.",
      inputSchema: createReadySliceInputSchema(z)
    },
    async (args) => {
      try {
        return await runReadySliceRoute({
          workspaceRepos,
          args,
          dependencies: { resolveWorkspaceRepo, ...routeDependencies }
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  recordServedToolInputContract({
    toolName: "workspace_work_record_upsert_slice",
    contractSchema: z
      .object({
        repo: z.string().optional(),
        unit: canonicalWorkRecordUnitAddress(z),
        slice: upsertSliceBodyContractDeclaration(z),
        expected_source_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
        verbose: z.boolean().optional()
      })
      .strict(),
    enforcedBy:
      "canonical work-record unit-address parsing, shared prose-carrier resolution, and " +
      "work-record.v1 canonical structure validation before any write",
    unprojectedConstraints: [
      {
        path: "slice",
        constraint: "canonical_work_record_slice_validation",
        statement:
          "The complete slice contract is decided by work-record.v1 structure validation when " +
          "the edit is applied, not by this request boundary: the request accepts any object and " +
          "an invalid slice is refused with an invalid_record diagnostic naming the exact path. " +
          "Only faithfully projectable owner constraints are stated. Members beyond those stated " +
          "here, including priority, are accepted by the request and decided there."
      },
      {
        path: "slice.sections",
        constraint: "registry_owned_prose_resolution",
        statement:
          "summary, why_it_matters, and agent_notes use the registry-declared closed content " +
          "carrier, resolve under the writer lock, and persist strings; resolved agent_notes " +
          "is limited to 8192 UTF-8 bytes."
      },
      {
        path: "slice.acceptance.criteria[].facet_provenance",
        constraint: "canonical_dynamic_provenance_members",
        statement:
          "Known provenance members publish their canonical vocabulary. Additional members are " +
          "accepted structurally and canonical validation requires each non-null value to use the " +
          "same vocabulary; that dynamic-key constraint is not projected."
      },
      {
        path: "slice.work_kind",
        constraint: "slice_work_kind_excludes_tracker",
        statement: "A slice may not be a tracker unit; tracker is a record-level work kind only."
      },
      {
        path: "slice.completion_policy",
        constraint: "completion_policy_is_record_only",
        statement: "completion_policy is valid on a record and is refused on a slice."
      }
    ]
  });
  registerTool(
    "workspace_work_record_upsert_slice",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NESTED_MERGE_REPLACEMENT,
      description:
        "Upsert a local WK slice; omit its ID to allocate an ordinal. An explicit ID selects an existing slice or a new ordinal. Optional sections.summary, sections.why_it_matters and sections.agent_notes use the shared text/ref/parts carrier and persist resolved strings. Validates before writing. verbose:true on workspace_tools_describe serves the slice-body contract, including the closed status vocabulary.",
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
        const result = await upsertSliceByUnit({
          dir: workspace.dir,
          repository: workspace.repo,
          unitAddress: args.unit,
          slice: args.slice,
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
        const result = await editContractByUnit({
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
        const result = await editContractByUnit({
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
}
