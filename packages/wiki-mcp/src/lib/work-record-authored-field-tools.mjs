

import { setWorkRecordTaskByUnit } from
  "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  editWorkRecordByUnit,
  editWorkRecordContractByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  WORK_RECORD_CONTRACT_LIST_FIELDS,
  WORK_RECORD_EDIT_FIELD_REGISTRY,
  WORK_RECORD_LIST_FIELD_WRITE_MODES
} from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
export const WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME = "workspace_work_record_edit";
function commonShape(z) {
  return {
    repo: z.string().optional(),
    unit: z.string(),
    expected_source_digest: z.string().optional(),
    verbose: z.boolean().optional()
  };
}
function indexSchema(z) {
  return z.union([z.number().int().nonnegative(), z.string().regex(/^(0|[1-9][0-9]*)$/)]);
}
function stringSchemaForRegistry(z, schema) {
  if (Array.isArray(schema?.enum)) return z.enum(schema.enum);
  let value = z.string();
  if (schema?.trim) value = value.trim();
  if (schema?.min_length) value = value.min(schema.min_length);
  if (schema?.max_utf8_bytes) value = value.refine((item) => Buffer.byteLength(item, "utf8") <= schema.max_utf8_bytes);
  return value;
}
function editVariant(z, entry, action, selector = null) {
  const shape = {
    ...commonShape(z),
    kind: z.literal(entry.kind),
    field: z.literal(entry.field),
    action: z.literal(action)
  };
  if (entry.kind === "scalar") {
    shape.value = stringSchemaForRegistry(z, entry.value_schema);
  } else if (entry.kind === "list") {
    shape.value = action === "append" ? z.string() : z.array(z.string());
  } else if (action === "append_todo") {
    shape.value = z.string().trim().min(1);
  } else {
    shape[selector] = selector === "index" ? indexSchema(z) : z.string().trim().min(1);
    if (action === "replace_text") shape.value = z.string().trim().min(1);
  }
  return z.object(shape).strict();
}
function semanticRefusalVariant(z, field) {
  return z.object({
    ...commonShape(z),
    kind: z.literal("scalar"),
    field: z.literal(field),
    action: z.literal("replace"),
    value: z.string()
  }).strict();
}

export function createWorkRecordEditInputSchema(z) {
  const variants = [];
  const seen = new Set();
  for (const entry of WORK_RECORD_EDIT_FIELD_REGISTRY.filter(({ facade }) => facade)) {
    for (const action of entry.actions) {
      const selectors = entry.kind === "task" && action !== "append_todo"
        ? ["text", "index"]
        : [null];
      for (const selector of selectors) {
        const identity = `${entry.kind}:${entry.field}:${action}:${selector ?? "none"}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        variants.push(editVariant(z, entry, action, selector));
      }
    }
  }
  for (const field of WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS.flatMap(
    ({ prefixes }) => prefixes
  )) {
    variants.push(semanticRefusalVariant(z, field));
  }
  return z.union(variants);
}
function shapeContractResponse(dependencies, workspaceRepo, result, verbose) {
  const response = dependencies.shapeWriteResponse(
    dependencies.createCompactContractEditResponse(workspaceRepo, result),
    { verbose: Boolean(verbose) }
  );
  return {
    ...response,
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],
    ...(result?.task ? { task: result.task } : {}),
    generation_transition: result?.generation_transition ?? null
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
    resolveWorkspaceRepo, shapeWriteResponse, createCompactWorkRecordEditResponse,
    validateOptionalExpectedSourceDigest, constants } = dependencies;
  registerTool(
    constants.WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Compatibility adapter that marks one WK or slice task done by exact text or zero-based index through setWorkRecordTaskByUnit. Use workspace_work_record_edit for replacement or append.",
      inputSchema: z.object({
        ...commonShape(z),
        text: z.string().optional(),
        index: indexSchema(z).optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digest = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digest.ok) {
          return jsonContent(shapeWriteResponse(
            createCompactWorkRecordEditResponse(workspace.repo, invalidDigestResult(
              "set_task", args.expected_source_digest, digest.diagnostic
            )),
            { verbose: Boolean(args.verbose) }
          ));
        }
        const result = await setWorkRecordTaskByUnit({ dir: workspace.dir,
          unitAddress: args.unit, action: "mark_done", text: args.text,
          index: args.index, expectedSourceDigest: digest.value });
        return jsonContent(shapeWriteResponse(
          createCompactWorkRecordEditResponse(workspace.repo, result),
          { verbose: Boolean(args.verbose) }
        ));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
  registerTool(
    WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.REPLACE_OR_APPEND,
      description:
        "Edit one registry-declared ordinary scalar, list, or task field on a canonical WK or slice. Closed schemas, configured repositories, complete-record validation, no-op replay, and CAS protection apply; semantic fields use their specialized owners.",
      inputSchema: createWorkRecordEditInputSchema(z)
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
            args.verbose
          ));
        }
        const { repo, unit, expected_source_digest, verbose, ...edit } = args;
        const result = await editWorkRecordByUnit({ dir: workspace.dir,
          unitAddress: unit, edit, expectedSourceDigest: digest.value,
          verbose: Boolean(verbose) });
        return jsonContent(shapeContractResponse(
          dependencies, workspace.repo, result, verbose
        ));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
export function registerWorkRecordListFieldCompatibilityTool(dependencies) {
  const { registerTool, workspaceRepos, z, jsonContent, errorContent,
    resolveWorkspaceRepo, validateOptionalExpectedSourceDigest } = dependencies;
  registerTool(
    "workspace_work_record_set_list_field",
    {
      description:
        "Compatibility adapter over registry-declared setListField entries. replace writes the supplied list; append adds one absent entry. Use workspace_work_record_edit for the complete ordinary-field vocabulary.",
      writeSemantics: MCP_WRITE_SEMANTICS.REPLACE_OR_APPEND,
      inputSchema: z.object({
        ...commonShape(z),
        field: z.enum(WORK_RECORD_CONTRACT_LIST_FIELDS),
        values: z.array(z.union([z.string(), z.record(z.unknown())])),
        mode: z.enum(WORK_RECORD_LIST_FIELD_WRITE_MODES).optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const digest = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null);
        if (!digest.ok) {
          return jsonContent(shapeContractResponse(
            dependencies,
            workspace.repo,
            invalidDigestResult("set_list_field", args.expected_source_digest, digest.diagnostic),
            args.verbose
          ));
        }
        const result = await editWorkRecordContractByUnit({ dir: workspace.dir,
          unitAddress: args.unit, operation: "set_list_field",
          params: { field: args.field, values: args.values, mode: args.mode ?? "replace" },
          expectedSourceDigest: digest.value, verbose: Boolean(args.verbose) });
        return jsonContent(shapeContractResponse(
          dependencies, workspace.repo, result, args.verbose
        ));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
