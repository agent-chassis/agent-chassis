import {
  ordinaryFieldReadAdvertisedSchema,
  ordinaryFieldReadSchema
} from "./work-record-ordinary-field-read.mjs";
import { selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import {
  CLOSEOUT_RECEIPT_READ_ROUTE,
  closeoutReceiptSelectorSchema,
  readCloseoutReceipt
} from "./work-record-closeout-response.mjs";
import {
  createValidateDispatchResponseSelection,
  VALIDATE_DISPATCH_ROUTE,
  validateDispatchDetailRequestShape
} from "./validate-dispatch-response-selection.mjs";

import {
  preflightProspectiveWorkRecordDispatch,
  projectWorkRecordPrivateScopePolicyFacts,
  readWorkRecordById,
  validateDocsPolicyOperation,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";

import { RECORD_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-shared.mjs";
import {
  isWorkRecordFreshness,
  projectWorkRecordFreshness,
  WORK_RECORD_FRESHNESS_PATTERN,
  workRecordFreshnessMatches
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { preflightWorkerScope } from "@agent-chassis/agent-launch-cli/src/lib/worker-scope-preflight.mjs";
import {
  getSummarySelectorValidationIssues,
  runWorkRecordSummaryWithCompactGate,
  selectedRecordMemberSchema,
  workRecordDetailSelectorSchemaShape
} from "./work-record-compact-read-gate.mjs";
import {
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  projectMcpCallableOwnerIssues
} from "./register-tool.mjs";
import { createWorkspaceReadRepoResolver } from "./wiki-core-tools.mjs";
import {
  isWorkRecordNavigationResult,
  toolVisibleToSession,
  WORK_RECORD_DETAILS_MAX_LIMIT
} from "./work-record-read-navigation.mjs";

const RECORD_STALENESS_CHECK_ENTRY_LIMIT = 100;

function classifyRecordStalenessEntry(entry, loaded) {
  const diagnosticCodes = (Array.isArray(loaded?.diagnostics) ? loaded.diagnostics : [])
    .map((diagnostic) => diagnostic?.code)
    .filter((code) => typeof code === "string");
  const base = { id: entry.id, observed_source_digest: entry.observed_source_digest };

  if (diagnosticCodes.includes("missing_json_record")) {
    return { ...base, state: "absent" };
  }

  const currentSourceDigest =
    typeof loaded?.source_digest === "string" ? loaded.source_digest : null;
  if (loaded?.valid !== true || currentSourceDigest === null) {
    return { ...base, state: "unreadable", diagnostic_codes: diagnosticCodes };
  }

  if (workRecordFreshnessMatches(entry.observed_source_digest, currentSourceDigest)) {
    return { ...base, state: "unchanged" };
  }

  return { ...base, state: "changed", current_source_digest: projectWorkRecordFreshness(currentSourceDigest) };
}

function assertRecordStalenessCheckEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      "workspace_record_staleness_check requires a non-empty entries array of " +
        "{id, observed_source_digest}"
    );
  }
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`workspace_record_staleness_check entries[${index}] must be an object`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "observed_source_digest") {
      throw new Error(
        `workspace_record_staleness_check entries[${index}] must carry exactly ` +
          `{id, observed_source_digest}; got: ${keys.join(", ") || "(no fields)"}`
      );
    }
    if (typeof entry.id !== "string" || !RECORD_ID_PATTERN.test(entry.id)) {
      throw new Error(
        `workspace_record_staleness_check entries[${index}].id must be a canonical ` +
          `WK-#### work-record id; got: ${JSON.stringify(entry.id)}`
      );
    }
    if (!isWorkRecordFreshness(entry.observed_source_digest)) {
      throw new Error(
        `workspace_record_staleness_check entries[${index}].observed_source_digest must be ` +
          "the 16 lowercase hex source_digest a read returned; got: " +
          JSON.stringify(entry.observed_source_digest)
      );
    }
  });
}

export function registerWorkRecordReadTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createCompactValidateDispatchResponse,

  validateDispatch = (options) => validateWorkRecordDispatch({
    ...options,
    worker_scope_preflight: preflightWorkerScope
  }),
  preflightDispatch = preflightProspectiveWorkRecordDispatch,

  registeredTier = "paid_cce",

  isToolVisible = toolVisibleToSession,

  validateDispatchSelection = null
}) {
  const isPaidTier = registeredTier !== "free_local";

  const readinessObservationIdentity = async (dir, unit) => {
    if (typeof unit !== "string") return null;
    try {
      const loaded = await readWorkRecordById({ dir, id: unit.split("#")[0] });
      return typeof loaded?.source_digest === "string" ? loaded.source_digest : null;
    } catch {
      return null;
    }
  };
  const readinessSelection = validateDispatchSelection ?? createValidateDispatchResponseSelection({
    resolveCurrentObservationIdentity: async (retained) => readinessObservationIdentity(
      resolveWorkspaceRepo(workspaceRepos, retained.repository).dir, retained.unit)
  });
  const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
    message: "Expected a non-empty string"
  });

  const workRecordSummaryShape = (ordinaryField, receipt) => ({
    ordinary_field: ordinaryField.optional(),
    repo: z.string().optional(),
    id: nonEmptyString.optional(),
    unit: nonEmptyString.optional(),
    path: nonEmptyString.optional(),
    member: selectedRecordMemberSchema(z),
    details: z.object({
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(WORK_RECORD_DETAILS_MAX_LIMIT).optional()
    }).strict().optional(),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_work_record_summary"),

    receipt: receipt.optional()
  });

  const advertisedReceiptSchema = z.object({}).passthrough().describe(
    "{ref_id,sha256,finding_id?} of a unit's closeout receipt; reruns nothing.");

  const resolveSummaryWorkspace = createWorkspaceReadRepoResolver({
    workspaceRepos,
    resolveWorkspaceRepo
  });
  const workRecordSummaryAdvertisedInputSchema = z.object(
    workRecordSummaryShape(ordinaryFieldReadAdvertisedSchema(z), advertisedReceiptSchema)
  ).strict().describe(
    "Compact declaration; the complete enforced ordinary_field union is served by " +
    "workspace_tools_describe({tool_name:\"workspace_work_record_summary\",verbose:true})."
  );
  const workRecordSummaryInputSchema = z.object(
    workRecordSummaryShape(ordinaryFieldReadSchema(z), closeoutReceiptSelectorSchema(z))
  ).strict().superRefine((args, context) => {

    if (args.receipt !== undefined) return;
    const issues = getSummarySelectorValidationIssues(args);
    const ownerProjection = projectMcpCallableOwnerIssues({
      ownerId: "work-record-compact-read-gate",
      tool: "workspace_work_record_summary",
      issues
    });
    for (const issue of issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message,
        params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection }
      });
    }
  });
  registerTool(
    "workspace_docs_policy_validate",
    {
      description:
        "Validate agent-facing docs for non-MCP role-dispatch authority drift. Read-only; operator/internal sections are audience-scoped. Compact by default; use verbose:true or include_all_findings:true for full diagnostics.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string()).optional(),
        verbose: z.boolean().optional(),
        include_all_findings: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await validateDocsPolicyOperation({
          dir: workspace.dir,
          paths: Array.isArray(args.paths) && args.paths.length > 0 ? args.paths : null,
          verbose: Boolean(args.verbose),
          include_all_findings: Boolean(args.include_all_findings)
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_summary",
    {
      description:
        "Read a WK/slice by id, unit or path. Default returns status, title and up to 3 next calls; details:{offset,limit} lists selected routes. ordinary_field selects root summary, notes, task pages or task text; reference_only omits bodies. member:{path} pages one field; members:[...] reads 1-16 selections in one bounded call. Pin index reads, selected occurrences and noninitial pages/ranges with the 16-hex source_digest. Read-only.",
      inputSchema: workRecordSummaryInputSchema,
      advertisedInputSchema: workRecordSummaryAdvertisedInputSchema
    },
    async (args) => {
      try {
        const workspace = resolveSummaryWorkspace(args);
        if (args.receipt !== undefined) {
          const conflicting = Object.keys(args)
            .filter((key) => !["repo", "unit", "receipt"].includes(key) && args[key] !== undefined);
          if (typeof args.unit !== "string") {
            throw selectedResponseQueryInvalidError(CLOSEOUT_RECEIPT_READ_ROUTE, "receipt_requires_unit");
          }
          if (conflicting.length > 0) {
            throw selectedResponseQueryInvalidError(CLOSEOUT_RECEIPT_READ_ROUTE,
              "receipt_excludes_other_selectors", { arguments: conflicting.sort() });
          }
          return jsonContent({ workspaceRepo: workspace.repo, ...readCloseoutReceipt({
            receipt: args.receipt, repository: workspace.repo, unit: args.unit }) });
        }
        const result = await runWorkRecordSummaryWithCompactGate({
          workspaceRepo: workspace.repo,
          callRepository: workspace.call_repository,
          workspaceDir: workspace.dir,
          args,
          readWorkRecordById,
          isToolVisible
        });
        if (isWorkRecordNavigationResult(result)) return jsonContent(result);
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_validate",
    {
      description:
        "Read-only WK validation with diagnostics and private-scope policy facts. Facts grant no lifecycle or CCE authority.",
      inputSchema: {
        repo: z.string().optional(),
        id: z.string()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await readWorkRecordById({
          dir: workspace.dir,
          id: args.id
        });
        return jsonContent({
          workspaceRepo: workspace.repo,
          record_id: result.record_id,
          source_path_relative: result.source_path_relative,
          source_digest: projectWorkRecordFreshness(result.source_digest),
          valid: result.valid,
          diagnostics: result.diagnostics,
          policy_facts: projectWorkRecordPrivateScopePolicyFacts(result.record)
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_record_staleness_check",
    {
      description:
        "Compare up to 100 observed WK digests. Distinguishes changed, unchanged, absent and unreadable; unchecked_ids reports overflow. Read-only, with no content or authority. Fresh reads and write CAS remain required.",
      inputSchema: {
        repo: z.string().optional(),
        entries: z
          .array(
            z
              .object({
                id: z.string().regex(RECORD_ID_PATTERN),
                observed_source_digest: z.string().regex(WORK_RECORD_FRESHNESS_PATTERN)
              })
              .strict()
          )
          .min(1)
      }
    },
    async (args) => {
      try {
        const suppliedArgs = args && typeof args === "object" ? args : {};
        const submitted = suppliedArgs.entries;
        assertRecordStalenessCheckEntries(submitted);

        const workspace = resolveWorkspaceRepo(workspaceRepos, suppliedArgs.repo);
        const resolvable = submitted.slice(0, RECORD_STALENESS_CHECK_ENTRY_LIMIT);
        const uncheckedIds = submitted
          .slice(RECORD_STALENESS_CHECK_ENTRY_LIMIT)
          .map((entry) => entry.id);

        const results = [];
        for (const entry of resolvable) {

          const loaded = await readWorkRecordById({ dir: workspace.dir, id: entry.id });
          results.push(classifyRecordStalenessEntry(entry, loaded));
        }

        return jsonContent({
          workspaceRepo: workspace.repo,
          entry_limit: RECORD_STALENESS_CHECK_ENTRY_LIMIT,
          total_count: submitted.length,
          returned_count: results.length,
          has_more: uncheckedIds.length > 0,
          unchecked_ids: uncheckedIds,
          results
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_preflight_dispatch",
    {
      description:
        "Preflight a proposed work-record dispatch contract. Read-only; mutates neither canonical records nor admission sidecars.",
      inputSchema: {
        repo: z.string().optional(),
        proposed_record: z.object({}).passthrough(),
        unit: nonEmptyString.optional(),
        dispatch_role: z.string().optional(),
        node_engine_admissibility: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await preflightDispatch({
          dir: workspace.dir,
          proposed_record: args.proposed_record,
          unit_address: args.unit,
          dispatch_role: args.dispatch_role,
          node_engine_admissibility: args.node_engine_admissibility
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_validate_dispatch",
    {
      description: isPaidTier
        ? "Check structural WK/slice dispatch readiness. It may write only ignored current-HEAD graph cache artifacts; it does not launch an agent or mutate canonical records, evidence, lifecycle, or runtime state. This is not managed-launch capability: a worker requires an explicit implementation slice. It answers well-formedness only: is the saved unit and the contract it names coherent and complete as a document. Whether anything can execute a selected proof is workspace_verify_proof's question at verify time and is never considered here, so a unit whose proofs cannot run today still dispatches. Implementation requires complete or opted-out proof posture. node_engine_admissibility:true requests CCE judgment; no local substitute. Large results return selected detail calls."
        : "Validate structural WK/slice dispatch readiness. It may write only ignored current-HEAD graph cache artifacts; it does not launch an agent or mutate canonical records, evidence, lifecycle, or runtime state. Structural readiness is not managed-launch capability: a worker requires an explicit implementation slice. It answers well-formedness only: is the saved unit and the contract it names coherent and complete as a document. Whether anything can execute a selected proof is workspace_verify_proof's question at verify time and is never considered here, so a unit whose proofs cannot run today still dispatches. Implementation derives controlled_acceptance_state from authenticated proof posture. Free/local renders no CCE judgment; local_only_fail_open supplies no disposition. Large results return selected detail calls.",
      inputSchema: z.object({
        repo: z.string().optional(),
        unit: z.string(),
        dispatch_role: z.enum(["implementation", "read_only"]).optional(),
        mode: z.enum(["strict", "report-only"]).optional(),
        node_engine_admissibility: z.boolean().optional(),
        detail: validateDispatchDetailRequestShape(z).detail.optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

        if (args.detail !== undefined) {
          const validationArguments = ["dispatch_role", "mode", "node_engine_admissibility"]
            .filter((field) => args[field] !== undefined);
          if (validationArguments.length > 0) {
            throw selectedResponseQueryInvalidError(VALIDATE_DISPATCH_ROUTE,
              "detail_excludes_validation_arguments", { arguments: validationArguments });
          }
          return jsonContent(await readinessSelection.detail({
            workspaceRepo: workspace.repo,
            unit: args.unit,
            detail: args.detail
          }));
        }

        const result = await validateDispatch({
          dir: workspace.dir,
          unitAddress: args.unit,

          dispatch_role: args.dispatch_role,
          mode: args.mode ?? "strict",

          node_engine_admissibility: args.node_engine_admissibility === true ? true : null
        });
        return jsonContent(await readinessSelection.publish({
          workspaceRepo: workspace.repo,
          carrier: createCompactValidateDispatchResponse(workspace.repo, result, registeredTier),
          observationIdentity: (unit) => readinessObservationIdentity(workspace.dir, unit)
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
