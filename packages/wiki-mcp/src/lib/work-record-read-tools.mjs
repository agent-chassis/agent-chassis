

import path from "node:path";

import {
  getWorkRecordSummary,
  preflightProspectiveWorkRecordDispatch,
  projectWorkRecordPrivateScopePolicyFacts,
  readWorkRecordById,
  validateDocsPolicyOperation,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import { parseWorkRecordSummaryUnit } from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";

import { RECORD_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-shared.mjs";
import { SHA256_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  projectNextActionScalar,
  validateNextCalls
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  validateWorkerAdmissionRecoveryResult
} from "@agent-chassis/wiki-core/src/lib/node-engine-worker-admission-recovery.mjs";
import {
  getSummarySelectorValidationIssues,
  runWorkRecordSummaryWithCompactGate,
  workRecordDetailSelectorSchemaShape
} from "./work-record-compact-read-gate.mjs";
import {
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  projectMcpCallableOwnerIssues
} from "./register-tool.mjs";

import {
  buildRunValidationTargetNotAuthorizedError,
  collectAuthorizedNodeTestTargets,
  NODE_TEST_FORBIDDEN_CALLER_FIELDS,
  parseNodeTestUnitAddress,
  resolveNodeTestTarget,
  resolveNodeTestUnitSections,
  runNodeTestStep,
  toPosixRelative
} from "./work-record-node-test-validation.mjs";

const RECORD_STALENESS_CHECK_ENTRY_LIMIT = 100;

function projectVerboseRecoveryDiagnostic(readiness) {
  const admissibility = readiness?.admissibility;
  if (!admissibility || !Object.hasOwn(admissibility, "recovery_validation")) {
    return readiness;
  }
  const validation = validateWorkerAdmissionRecoveryResult(
    admissibility.recovery_validation,
    { expectedProjectionMode: "bounded_current_decision_recovery" }
  );
  const carrier = validation.diagnostic_carrier;
  return {
    ...readiness,
    admissibility: {
      ...admissibility,
      recovery_validation: validation,
      ...(carrier === undefined ? {} : { recovery_diagnostic_carrier: carrier })
    }
  };
}

function projectOrdinaryRecoveryDiagnostic(readiness) {
  const admissibility = readiness?.admissibility;
  if (!admissibility || !Object.hasOwn(admissibility, "recovery_validation")) {
    return readiness;
  }
  const validation = validateWorkerAdmissionRecoveryResult(
    admissibility.recovery_validation,
    { expectedProjectionMode: "bounded_current_decision_recovery" }
  );
  const projectedAdmissibility = { ...admissibility };
  delete projectedAdmissibility.recovery;
  return {
    ...readiness,
    admissibility: {
      ...projectedAdmissibility,
      recovery_diagnostic: validation.diagnostic
    }
  };
}

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

  if (currentSourceDigest === entry.observed_source_digest) {
    return { ...base, state: "unchanged" };
  }

  return { ...base, state: "changed", current_source_digest: currentSourceDigest };
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
    if (
      typeof entry.observed_source_digest !== "string" ||
      !SHA256_PATTERN.test(entry.observed_source_digest)
    ) {
      throw new Error(
        `workspace_record_staleness_check entries[${index}].observed_source_digest must be ` +
          "the raw sha256:<hex> source_digest a read returned, not a compact_read_token; got: " +
          JSON.stringify(entry.observed_source_digest)
      );
    }
  });
}

async function readSelectedWorkRecordFullSummary({ dir, id = null, unit = null }) {
  const selectedUnit = parseWorkRecordSummaryUnit(unit ?? id);
  if (!selectedUnit || selectedUnit.kind !== "slice") {
    return {
      record_id: selectedUnit?.record_id ?? null,
      valid: false,
      selected_unit: selectedUnit,
      summary: null
    };
  }

  const loaded = await readWorkRecordById({ dir, id: selectedUnit.record_id });
  const slices = Array.isArray(loaded?.record?.slices) ? loaded.record.slices : [];
  const selectedSlice = slices.find((slice) => slice?.id === selectedUnit.slice_id) ?? null;
  return {
    record_id: loaded?.record_id ?? selectedUnit.record_id,
    valid: loaded?.valid === true && selectedSlice !== null,
    selected_unit: selectedUnit,
    summary: {
      selected_unit_summary: selectedSlice
    }
  };
}

export function registerWorkRecordReadTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createCompactValidateDispatchResponse,
  validateDispatch = validateWorkRecordDispatch,
  preflightDispatch = preflightProspectiveWorkRecordDispatch,
  runTerminalCandidateValidationForUnit = null,

  registeredTier = "paid_cce"
}) {
  const isPaidTier = registeredTier !== "free_local";
  const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
    message: "Expected a non-empty string"
  });

  const workRecordSummaryInputSchema = z.object({
    repo: z.string().optional(),
    id: nonEmptyString.optional(),
    unit: nonEmptyString.optional(),
    path: nonEmptyString.optional(),
    verbose: z.boolean().optional(),
    include_full_summary: z.boolean().optional(),
    accept_full_read: z.literal(true).optional(),
    compact_read_token: z.string().optional(),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_work_record_summary")
  }).strict().superRefine((args, context) => {
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
        "Read a compact WK or slice summary selected by id, unit, or path. A selected slice returns only that unit. WK-level compact output omits detailed inactive slices and note bodies; pass accept_full_read:true for an unscoped full read. Read-only; detail flags do not widen a selected-slice response.",
      inputSchema: workRecordSummaryInputSchema
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await runWorkRecordSummaryWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          getWorkRecordSummary,
          readSelectedWorkRecordSummary: readSelectedWorkRecordFullSummary,
          readWorkRecordById
        });
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
        "Validate one canonical JSON work record and return structured diagnostics plus top-level non-authoritative private-scope policy facts. Read-only; policy facts are possible CCE input and do not authorize, refuse, or certify. Writes no record, cache, or generated view.",
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
          source_digest: result.source_digest,
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
        "Read-only comparison of up to 100 previously observed WK source digests. Each result is unchanged, changed with current_source_digest, absent, or unreadable; the last two stay distinct, and unchecked_ids reports overflow. It returns no record content or authority and does not replace a fresh read or write CAS. Malformed input refuses.",
      inputSchema: {
        repo: z.string().optional(),
        entries: z
          .array(
            z
              .object({
                id: z.string().regex(RECORD_ID_PATTERN),
                observed_source_digest: z.string().regex(SHA256_PATTERN)
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
        ? "Validate WK or slice dispatch readiness; this does not launch an agent or mutate canonical records, evidence, lifecycle, or runtime state. Stale required graph impact may refresh ignored current-HEAD graph cache artifacts. Compact by default; verbose:true returns the full readiness envelope and bounded graph failures. node_engine_admissibility:true requests a Chassis Control Engine judgment over measured carrier facts; no local threshold verdict or admit fallback is synthesized."
        : "Validate WK or slice structural dispatch readiness; this does not launch an agent or mutate canonical records, evidence, lifecycle, or runtime state. Stale required graph impact may refresh ignored current-HEAD graph cache artifacts. Compact by default; verbose:true returns the full readiness envelope and bounded graph failures. Free/local output renders no admissibility or threshold judgment.",
      inputSchema: {
        repo: z.string().optional(),
        unit: z.string(),
        dispatch_role: z.enum(["implementation", "read_only"]).optional(),
        mode: z.enum(["strict", "report-only"]).optional(),
        node_engine_admissibility: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

        const result = await validateDispatch({
          dir: workspace.dir,
          unitAddress: args.unit,

          dispatch_role: args.dispatch_role,
          mode: args.mode ?? "strict",

          node_engine_admissibility: args.node_engine_admissibility === true ? true : null
        });
        if (args.verbose === true) {
          return jsonContent({
            workspaceRepo: workspace.repo,
            readiness: projectVerboseRecoveryDiagnostic(result)
          });
        }
        const compact = createCompactValidateDispatchResponse(
          workspace.repo,
          projectOrdinaryRecoveryDiagnostic(result),
          registeredTier
        );

        if (result.graph_impact_failure) {
          compact.graph_impact_failure_code = result.graph_impact_failure.code;
          const structuredNextCalls = Array.isArray(result.next_calls)
            ? result.next_calls
            : [];
          const canonicalNextCalls =
            structuredNextCalls.length > 0 && validateNextCalls(structuredNextCalls).valid
              ? structuredNextCalls
              : null;
          const scalarNextAction = canonicalNextCalls
            ? projectNextActionScalar(canonicalNextCalls)
            : null;
          const descriptorAuthoritativeNextAction =
            typeof scalarNextAction === "string" && scalarNextAction.trim() !== "";
          if (!descriptorAuthoritativeNextAction) {
            compact.next_action = result.graph_impact_failure.remediation;
          }
        }
        return jsonContent(compact);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_run_validation",
    {
      description:
        "Run one declared node_test target for an implementation unit. Side effect: process_spawn. The server authorizes the target from the canonical unit, fixes binary/cwd/env/limits, runs node --check before node --test, and returns per-step evidence. Caller authority fields or extra arguments refuse.",
      inputSchema: {
        unit: z.string(),
        target: z.string()
      }
    },
    async (args) => {
      try {
        const suppliedArgs = args && typeof args === "object" ? args : {};
        const forbidden = NODE_TEST_FORBIDDEN_CALLER_FIELDS.filter((field) =>
          Object.prototype.hasOwnProperty.call(suppliedArgs, field)
        );
        if (forbidden.length > 0) {
          throw new Error(
            `workspace_run_validation rejects caller-supplied authority fields: ${forbidden.join(", ")}. ` +
              "The command, node binary, cwd, env, timeouts, and output caps are fixed server facts; " +
              "targets are authorized only from the unit's work contract."
          );
        }
        const unexpected = Object.keys(suppliedArgs).filter((field) => !["unit", "target"].includes(field));
        if (unexpected.length > 0) {
          throw new Error(
            `workspace_run_validation accepts exactly {unit,target}; unexpected fields: ${unexpected.sort().join(", ")}`
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, undefined);
        const { address, recordId, sliceId } = parseNodeTestUnitAddress(args.unit);

        const loaded = await readWorkRecordById({ dir: workspace.dir, id: recordId });
        if (!loaded || !loaded.record) {
          throw new Error(`workspace_run_validation could not load canonical work record: ${recordId}`);
        }

        const selectedUnit = resolveNodeTestUnitSections(loaded.record, sliceId);
        if (!selectedUnit) {
          throw new Error(`workspace_run_validation could not resolve unit: ${address}`);
        }

        const authorizedTargets = collectAuthorizedNodeTestTargets(selectedUnit);
        let resolvedMainTarget = null;
        let requestedTarget;
        if (sliceId !== null || typeof runTerminalCandidateValidationForUnit !== "function") {
          resolvedMainTarget = resolveNodeTestTarget(workspace.dir, args.target);
          requestedTarget = resolvedMainTarget.posixRelative;
        } else {
          requestedTarget = toPosixRelative(path.posix.normalize(String(args.target ?? "")));
          if (!requestedTarget || requestedTarget === "." || requestedTarget === ".." ||
              requestedTarget.startsWith("../") || path.isAbsolute(args.target ?? "") ||
              String(args.target ?? "").includes("\0") || /[\r\n]/u.test(String(args.target ?? ""))) {
            throw new Error("workspace_run_validation target must be repo-relative and contained");
          }
        }
        if (!authorizedTargets.has(requestedTarget)) {
          throw buildRunValidationTargetNotAuthorizedError({
            address,
            requestedTarget,
            authorizedTargets
          });
        }

        if (sliceId === null && typeof runTerminalCandidateValidationForUnit === "function") {
          const candidateResult = await runTerminalCandidateValidationForUnit({
            workspace,
            unit: address,
            target: requestedTarget,
            record: loaded.record
          });
          if (candidateResult !== null && candidateResult !== undefined) {
            return jsonContent({
              workspaceRepo: workspace.repo,
              tool: "workspace_run_validation",
              operation: "node_test",
              unit: address,
              target: requestedTarget,
              ...candidateResult
            });
          }
        }

        const { absolute, posixRelative } = resolvedMainTarget ?? resolveNodeTestTarget(workspace.dir, requestedTarget);

        const checkStep = runNodeTestStep({
          workspaceDir: workspace.dir,
          flag: "--check",
          absoluteTarget: absolute,
          posixRelative
        });

        let testStep;
        if (checkStep.ok) {
          testStep = runNodeTestStep({
            workspaceDir: workspace.dir,
            flag: "--test",
            absoluteTarget: absolute,
            posixRelative
          });
        } else {
          testStep = {
            step: "node --test",
            operation: "node_test",
            argv: ["node", "--test", posixRelative],
            target: posixRelative,
            ran: false,
            skipped: true,
            skipped_reason: "node --check failed; node --test not run",
            exit_code: null,
            signal: null,
            timed_out: false,
            output_truncated: false,
            spawn_error: null,
            stdout: "",
            stderr: "",
            ok: false
          };
        }

        return jsonContent({
          workspaceRepo: workspace.repo,
          tool: "workspace_run_validation",
          operation: "node_test",
          unit: address,
          target: posixRelative,
          ok: checkStep.ok && testStep.ok,
          steps: [checkStep, testStep]
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
