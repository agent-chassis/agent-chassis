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
import { isLosslessMcpSpillDelivery } from "./mcp-response.mjs";
import {
  workRecordEditInputFailureNextCalls
} from "./work-record-edit-input-guidance-delivery.mjs";
import { compactGenerationTransition } from "./work-record-write-route-helpers.mjs";
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
      expected_source_digest: result?.source_digest ?? null
    }
  };
}

function shapeContractResponse(dependencies, workspaceRepo, result, verbose, args = null) {
  const response = dependencies.shapeWriteResponse(
    dependencies.createCompactContractEditResponse(workspaceRepo, result),
    { verbose: Boolean(verbose) }
  );
  return {
    ...response,
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],

    ...(result?.task
      ? { task: verbose ? result.task : { index: result.task.index, status: result.task.status } }
      : {}),
    ...(verbose || args?.field !== "sections.tasks" || !result?.valid
      ? {}
      : { next_calls: [taskReadContinuation(args, result)] }),
    generation_transition: verbose
      ? result?.generation_transition ?? null
      : compactGenerationTransition(
        result?.generation_transition ?? null,
        response.selected_unit ?? result?.selected_unit ?? null
      )
  };
}
function invalidDigestResult(operation, digest, diagnostic) {
  return {
    operation,
    valid: false,
    written: false,
    no_op: false,
    changed_fields: [],
    status: null,
    task: null,
    source_digest: null,
    expected_source_digest: digest ?? null,
    current_source_digest: null,
    diagnostics: [diagnostic],
    next_action: "supply a valid expected_source_digest (sha256:<64 lowercase hex>) or omit the field"
  };
}
export function registerWorkRecordTaskAndGeneralEditTools(dependencies) {
  const { registerTool, workspaceRepos, z, jsonContent, errorContent,
    resolveWorkspaceRepo, validateOptionalExpectedSourceDigest } = dependencies;
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
            reassembly:
              "follow next_offset to eof, concatenate decoded base64 bytes, then decode UTF-8"
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
        "Edit one ordinary WK/slice field with registry schemas, full-record validation, replay and CAS. Enrolled summary, why_it_matters, agent_notes and task-text values require {text}, {ref}, or flat nonempty {parts}; refs resolve exactly under the writer lock. Use workspace_tools_describe with this tool_name for targeted field guidance and bounded inventory. Semantic fields use specialized owners.",
      inputSchema: editorContract.schema,
      advertisedInputSchema: createWorkRecordEditAdvertisedInputSchema(z),
      inputContractUnprojectedConstraints:
        editorContract.requestFacts.unprojected_constraints,
      inputValidationErrorProjector: projectEditorInputFailure
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digest = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digest.ok) {
          return jsonContent(shapeContractResponse(
            dependencies,
            workspace.repo,
            invalidDigestResult("edit_work_record", args.expected_source_digest, digest.diagnostic),
            args.verbose,
            args
          ));
        }
        const { repo, unit, expected_source_digest, verbose, ...edit } = args;
        const result = await (dependencies.editWorkRecordByUnit ?? editWorkRecordByUnit)({ dir: workspace.dir,
          repository: workspace.repo,
          unitAddress: unit, edit, expectedSourceDigest: digest.value,
          verbose: Boolean(verbose) });
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
