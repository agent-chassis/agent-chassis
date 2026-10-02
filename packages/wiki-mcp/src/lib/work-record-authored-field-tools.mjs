import { ordinaryRecoveryCall } from "./work-record-ordinary-field-read.mjs";

import {
  editWorkRecordByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import {
  MCP_WRITE_SEMANTICS,
  projectMcpCallableOwnerIssues
} from "./register-tool.mjs";
import {
  createWorkRecordEditInputContract,
  projectWorkRecordEditInputFailure,
  createWorkRecordTaskIndexSchema
} from "./work-record-edit-input-contract.mjs";
import { buildNextCall, isLosslessMcpSpillDelivery } from "./mcp-response.mjs";
import { mcpContentReferenceReassembly } from "./mcp-content-reference-tools.mjs";
import {
  workRecordEditInputFailureNextCalls
} from "./work-record-edit-input-guidance-delivery.mjs";
import {
  compactGenerationTransition,
  resolveExpectedSourceDigest,
  workRecordFreshnessSource
} from "./work-record-write-route-helpers.mjs";
import { projectWorkRecordFreshness } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
export const WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME = "workspace_work_record_edit";
function createWorkRecordEditAdvertisedInputSchema(z) {
  return z.object({
    repo: z.string().optional(),
    unit: z.string(),
    expected_source_digest: z.string().optional(),
    verbose: z.boolean().optional(),
    kind: z.string(),
    field: z.string(),
    action: z.string(),
    value: z.unknown().optional(),
    text: z.string().optional(),
    index: createWorkRecordTaskIndexSchema(z).optional()
  }).strict().describe(
    "Compact informational declaration. The server enforces the complete closed " +
    "registry-derived union. Retrieve a usable example and targeted field guidance with " +
    "workspace_tools_describe({tool_name:\"workspace_work_record_edit\"}); add verbose:true " +
    "there to recover the complete enforced schema."
  );
}

function taskReadContinuation(args, result) {
  const continuation = ordinaryRecoveryCall(args);
  const index = result?.task?.index;
  return {
    ...continuation,
    arguments: {
      ...continuation.arguments,
      ...(Number.isInteger(index)
        ? { ordinary_field: { field: "sections.tasks", index, member: "text" } }
        : {}),
      expected_source_digest: projectWorkRecordFreshness(result?.source_digest)
    }
  };
}

const COVERAGE_QUERY_TOOL = "workspace_controlled_contract_obligation_coverage_query";
const ACCEPTANCE_CRITERIA_FIELD = "acceptance.criteria";
const ACCEPTANCE_COVERAGE_ADVICE = "Acceptance criteria changed, so a previously held " +
  "coverage content_digest may no longer be current. Before the next coverage upsert or " +
  "remove, use the coverage query's current content_digest as expected_content_digest and " +
  "its acceptance_criteria[].identity values for obligations[].acceptance_criteria. " +
  "next_calls reads this unit unfocused; to resume another unit or a focus, query that " +
  "unit/focus instead. Never use this receipt's source_digest as expected_content_digest " +
  "or repeat this edit.";

function effectivelyChanged(args, result, field) {
  const address = result?.selected_unit?.address;
  if (args?.field !== field || typeof address !== "string" ||
      result.ok !== true || result.valid !== true || result.written !== true ||
      result.no_op !== false || result.publication_state !== "published") return false;
  const sliceId = result.selected_unit.slice_id;
  const changed = sliceId ? `slices[${sliceId}].${field}` : field;
  return Array.isArray(result.changed_fields) && result.changed_fields.includes(changed);
}

function acceptanceCoverageContinuation(args, result) {
  if (!effectivelyChanged(args, result, ACCEPTANCE_CRITERIA_FIELD)) return null;
  return buildNextCall({ tool: COVERAGE_QUERY_TOOL, arguments: {
    ...(args.repo === undefined ? {} : { repo: args.repo }), unit: result.selected_unit.address } });
}

const ACCEPTANCE_VALIDATION_FIELD = "acceptance.validation";
const ACCEPTANCE_VALIDATION_NOTICE = "Notes saved; generation_transition reports purpose " +
  "identity, not candidate publication eligibility.";

function shapeContractResponse(dependencies, workspaceRepo, result, verbose, args = null) {
  const response = dependencies.shapeWriteResponse(
    dependencies.createCompactContractEditResponse(workspaceRepo, result),
    { verbose: Boolean(verbose) }
  );
  const coverageQuery = acceptanceCoverageContinuation(args, result);
  return {
    ...response,
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],

    ...(result?.task
      ? { task: verbose ? result.task : { index: result.task.index, status: result.task.status } }
      : {}),
    ...(verbose || args?.field !== "sections.tasks" || !result?.valid
      ? {}
      : { next_calls: [taskReadContinuation(args, result)] }),
    ...(effectivelyChanged(args, result, ACCEPTANCE_VALIDATION_FIELD)
      ? { next_action: ACCEPTANCE_VALIDATION_NOTICE } : {}),
    ...(coverageQuery === null ? {} : {
      next_action: [response.next_action, ACCEPTANCE_COVERAGE_ADVICE].filter(Boolean).join(". "),
      next_calls: [...(response.next_calls ?? []).filter(call => call.tool !== COVERAGE_QUERY_TOOL),
        coverageQuery]
    }),
    generation_transition: verbose
      ? result?.generation_transition ?? null
      : compactGenerationTransition(
        result?.generation_transition ?? null,
        response.selected_unit ?? result?.selected_unit ?? null
      )
  };
}
function invalidDigestResult(operation, digest, resolution) {
  return {
    operation,
    valid: false,
    written: false,
    no_op: false,
    changed_fields: [],
    status: null,
    task: null,
    source_digest: resolution.stale ? resolution.current_source_digest : null,
    expected_source_digest: digest ?? null,
    current_source_digest: resolution.current_source_digest ?? null,
    diagnostics: [resolution.diagnostic],
    next_action: resolution.next_action ?? null
  };
}
export function registerWorkRecordTaskAndGeneralEditTools(dependencies) {
  const { registerTool, workspaceRepos, z, jsonContent, errorContent,
    resolveWorkspaceRepo } = dependencies;
  const editorContractOptions = dependencies.workRecordEditInputContractOptions ?? {};
  const editorContract = createWorkRecordEditInputContract(z, editorContractOptions);
  const projectEditorInputFailure = async ({ args, validationError, tool }) => {
    const failure = projectWorkRecordEditInputFailure({
      args,
      validationError,
      contract: editorContract,
      ...editorContractOptions
    });
    const captured = jsonContent(failure.raw_failure, { forceSpill: true });
    if (!isLosslessMcpSpillDelivery(captured)) {
      return { terminal_result: captured };
    }
    const {
      buildDispatchContinuation,
      requestSchemaAuthorityForRegistration
    } = await import("./dispatch-tool-helpers.mjs");
    const requestSchemaAuthority = requestSchemaAuthorityForRegistration(registerTool);
    const buildDescribeContinuation = (argumentsValue, successFact) =>
      buildDispatchContinuation({
        tool: "workspace_tools_describe",
        arguments: argumentsValue,
        successPredicate: { fact: successFact, operator: "is_true" },
        requestSchemaAuthority
      });
    const contentReference = captured.structuredContent.content_reference;
    return {
      projection: projectMcpCallableOwnerIssues({
        ownerId: "WORK_RECORD_EDIT_FIELD_REGISTRY",
        tool,
        issues: failure.diagnostics,
        ownerResult: {
          written: false,
          raw_validation_failure: {
            captured: true,
            content_reference: contentReference,
            reassembly: mcpContentReferenceReassembly("decode the verified bytes as UTF-8")
          }
        }
      }),
      next_calls: workRecordEditInputFailureNextCalls({
        field: failure.field,
        scope: failure.scope,
        contentReference,
        buildContinuation: buildDescribeContinuation
      })
    };
  };
  registerTool(
    WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.ACTION_REPLACE_OR_APPEND,
      description:
        "Edit one ordinary WK/slice field with registry schemas, full-record validation, replay and CAS. Enrolled summary, root-only user_requirements, why_it_matters, agent_notes and task-text values require {text}, {ref}, or flat nonempty {parts}; refs resolve exactly under the writer lock. Use workspace_tools_describe with this tool_name for targeted field guidance and bounded inventory. Semantic fields use specialized owners.",
      inputSchema: editorContract.schema,
      advertisedInputSchema: createWorkRecordEditAdvertisedInputSchema(z),
      inputContractUnprojectedConstraints:
        editorContract.requestFacts.unprojected_constraints,
      inputValidationErrorProjector: projectEditorInputFailure
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digest = await resolveExpectedSourceDigest(args.expected_source_digest ?? null,
          { load: workRecordFreshnessSource(workspace.dir, args.unit) });
        const { repo, unit, expected_source_digest, verbose, ...edit } = args;
        const result = digest.ok
          ? await (dependencies.editWorkRecordByUnit ?? editWorkRecordByUnit)({ dir: workspace.dir,
            repository: workspace.repo,
            unitAddress: unit, edit, expectedSourceDigest: digest.value,
            verbose: Boolean(verbose) })
          : invalidDigestResult("edit_work_record", args.expected_source_digest, digest);
        const response = shapeContractResponse(dependencies, workspace.repo, result, verbose, args);
        const selectedEntry = WORK_RECORD_EDIT_FIELD_REGISTRY.find((entry) =>
          entry.facade && entry.field === edit.field);
        if ((edit.field === "sections.tasks" ||
            selectedEntry?.value_schema?.entry_content === true) &&
            result.diagnostics?.some(issue => issue.code === "stale_source_digest")) {
          response.next_calls = [ordinaryRecoveryCall(args)];
        }
        return jsonContent(response);
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
