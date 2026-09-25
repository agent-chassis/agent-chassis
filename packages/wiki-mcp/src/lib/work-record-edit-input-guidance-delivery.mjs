import {
  createBoundedToolDiscoveryListEnvelope,
  TOOL_DISCOVERY_LIST_DEFAULT_LIMIT,
  TOOL_DISCOVERY_LIST_MAX_BYTES,
  TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES
} from "@agent-chassis/wiki-core/src/lib/tool-discovery/projection.mjs";
import { buildNextCall } from
  "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  createWorkRecordEditFieldGuidance,
  createWorkRecordEditFieldInventory
} from "@agent-chassis/wiki-core/src/lib/work-record-edit-input-guidance.mjs";
import { activeMcpInlineByteLimit } from "./mcp-response.mjs";
import {
  describeInputContractContinuation,
  inputContractMechanicalRefusal,
  inputContractPageAdvances,
  inputContractSourceBindingRefusal,
  inputContractSourceDigest
} from "./tool-discovery-input-guidance-delivery.mjs";

export const WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE = "editor_input_contract";
export const WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL = "workspace_work_record_edit";

export const WORK_RECORD_EDIT_INPUT_CONTRACT_CODES = Object.freeze({
  EXACT_TOOL_REQUIRED: "editor_input_contract_exact_tool_required",
  TOOL_UNSUPPORTED: "editor_input_contract_tool_unsupported",
  LIMIT_CONFLICT: "editor_input_contract_limit_conflict",
  INVALID_SELECTOR: "invalid_editor_input_contract_selector"
});

const EDITOR_FIELD_INVENTORY_FRAME_RESERVE_BYTES = 16384;

const GENERIC_STRUCTURED_UNDER_FRAME_MARGIN_BYTES =
  TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES - TOOL_DISCOVERY_LIST_MAX_BYTES;
function editorFieldInventoryByteCeilings(env = process.env) {
  const resultByteLimit = Math.max(
    TOOL_DISCOVERY_LIST_RESULT_MAX_BYTES,
    activeMcpInlineByteLimit(env) - EDITOR_FIELD_INVENTORY_FRAME_RESERVE_BYTES
  );
  return {
    resultByteLimit,
    byteLimit: resultByteLimit - GENERIC_STRUCTURED_UNDER_FRAME_MARGIN_BYTES
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceDigest(inventory, requestFacts) {
  return inputContractSourceDigest({
    source: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
    inventory,
    request_facts: requestFacts
  });
}

export function checkedWorkRecordEditInputContinuation(
  buildContinuation,
  argumentsValue,
  successFact
) {
  const call = buildContinuation(argumentsValue, successFact);
  if (call === null) {
    throw new Error(
      "editor_input_contract_continuation_schema_unavailable: " +
      "workspace_tools_describe has no registered request-schema authority"
    );
  }
  return call;
}

export function workRecordEditInputFieldsArguments({
  offset,
  limit,
  expectedSourceDigest
}) {
  return {
    tool_name: WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL,
    input_contract: {
      kind: "fields",
      offset,
      limit,
      ...(offset === 0 ? {} : { expected_source_digest: expectedSourceDigest })
    }
  };
}

export function workRecordEditInputFieldArguments(field, scope) {
  return {
    tool_name: WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL,
    input_contract: { kind: "field", field, scope }
  };
}

function validateRecommendedFirstCall(entry, editorSchema) {
  const argumentsValue = entry?.recommended_first_call?.arguments;
  const parsed = editorSchema.safeParse(argumentsValue);
  if (!parsed.success) {
    throw new Error(
      "editor_input_contract_first_call_invalid: the descriptor's recommended_first_call.arguments " +
      "does not satisfy the registered editor schema"
    );
  }
  return clone(parsed.data);
}

function initialGuidance({
  entry,
  inventory,
  digest,
  editorSchema,
  buildContinuation,
  writeSemanticsStatement
}) {
  validateRecommendedFirstCall(entry, editorSchema);
  if (typeof writeSemanticsStatement !== "string" || writeSemanticsStatement === "") {
    throw new Error(
      "editor_input_contract_write_semantics_unavailable: shared editor write semantics are required"
    );
  }
  const detailCall = checkedWorkRecordEditInputContinuation(
    buildContinuation,
    workRecordEditInputFieldArguments("sections.agent_notes", "record"),
    "editor_input_contract.notes_detail_returned"
  );
  const inventoryCall = checkedWorkRecordEditInputContinuation(
    buildContinuation,
    workRecordEditInputFieldsArguments({
      offset: 0,
      limit: Math.max(TOOL_DISCOVERY_LIST_DEFAULT_LIMIT, inventory.total_count),
      expectedSourceDigest: digest
    }),
    "editor_input_contract.first_page_returned"
  );
  return {
    ok: true,
    schema_version: inventory.schema_version,
    source: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
    source_digest: digest,
    common_arguments: inventory.common_request,
    action_semantics: writeSemanticsStatement,
    replacement_guidance: inventory.semantics.replacement,
    mutation_digest_guidance: inventory.semantics.digests.mutation_record,
    inventory: {
      total_count: inventory.total_count,
      first_page_call: inventoryCall
    },
    notes_detail_call: detailCall
  };
}

function fieldGuidance({ selector, registryOptions = {}, requestFacts, inventory, digest, buildContinuation }) {
  const result = createWorkRecordEditFieldGuidance({
    ...registryOptions,
    field: selector.field,
    scope: selector.scope,
    requestFacts
  });
  const correction = result.ok === false && result.diagnostic?.code === "unsupported_edit_field"
    ? [checkedWorkRecordEditInputContinuation(
      buildContinuation,
      workRecordEditInputFieldsArguments({
        offset: 0,
        limit: Math.max(TOOL_DISCOVERY_LIST_DEFAULT_LIMIT, inventory.total_count),
        expectedSourceDigest: digest
      }),
      "editor_input_contract.first_page_returned"
    )]
    : null;
  return {
    ...result,
    source_contract: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
    source_digest: digest,
    ...(correction === null ? {} : { next_calls: correction })
  };
}

function fieldsGuidance({
  selector,
  inventory,
  digest,
  buildContinuation,
  measureResultBytes,
  responseEnv
}) {
  const offset = selector.offset ?? 0;

  const limit = selector.limit ??
    Math.max(TOOL_DISCOVERY_LIST_DEFAULT_LIMIT, inventory.total_count);
  const binding = inputContractSourceBindingRefusal({
    offset,
    expectedSourceDigest: selector.expected_source_digest,
    currentSourceDigest: digest,
    source: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
    codes: {
      required: "editor_input_contract_source_digest_required",
      stale: "stale_editor_input_contract_source"
    },
    messages: {
      required: "input_contract.expected_source_digest is required when offset is nonzero",
      stale: "the complete editor input contract changed; restart traversal at offset zero"
    },
    restartCalls: () => [checkedWorkRecordEditInputContinuation(
      buildContinuation,
      workRecordEditInputFieldsArguments({ offset: 0, limit, expectedSourceDigest: digest }),
      "editor_input_contract.first_page_returned"
    )]
  });
  if (binding !== null) return binding;

  const envelope = createBoundedToolDiscoveryListEnvelope(
    {
      ok: true,
      schema_version: inventory.schema_version,
      source: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
      source_digest: digest,
      ...(offset === 0 ? { navigation: inventory.navigation } : {})
    },
    inventory.fields,
    {
      totalCount: inventory.total_count,
      limit,
      offset,
      resultField: "fields",
      projectEntry: clone,
      measureResultBytes,
      ...editorFieldInventoryByteCeilings(responseEnv),
      createNextCalls(nextOffset) {
        if (!Number.isInteger(nextOffset) || nextOffset <= offset) return [];
        return [checkedWorkRecordEditInputContinuation(
          buildContinuation,
          workRecordEditInputFieldsArguments({
            offset: nextOffset,
            limit,
            expectedSourceDigest: digest
          }),
          "editor_input_contract.next_page_returned"
        )];
      }
    }
  );
  if (!inputContractPageAdvances(envelope, offset)) {
    throw new Error(
      "editor_input_contract_page_nonadvancing: the current byte policy could not admit one field row"
    );
  }
  return envelope;
}

function correctedEditorInputContractRequest(selector) {
  if (selector.kind === "field") {
    return {
      arguments: workRecordEditInputFieldArguments(selector.field, selector.scope),
      successFact: "editor_input_contract.field_detail_returned"
    };
  }
  if (selector.kind !== "fields") return null;
  const bound = typeof selector.expected_source_digest === "string";
  const offset = bound && Number.isInteger(selector.offset) && selector.offset > 0
    ? selector.offset
    : 0;
  return {
    arguments: workRecordEditInputFieldsArguments({
      offset,
      limit: selector.limit ?? TOOL_DISCOVERY_LIST_DEFAULT_LIMIT,
      expectedSourceDigest: selector.expected_source_digest
    }),
    successFact: offset === 0
      ? "editor_input_contract.first_page_returned"
      : "editor_input_contract.next_page_returned"
  };
}

function editorInputContractMisuse(options, toolName) {
  const exactTool = typeof toolName === "string" && toolName !== "" &&
    toolName.trim() === toolName;
  if (options.task_id !== undefined || !exactTool) {
    return {
      code: WORK_RECORD_EDIT_INPUT_CONTRACT_CODES.EXACT_TOOL_REQUIRED,
      message: "input_contract requires one exact tool_name and no task_id",
      details: {
        expected: "tool_name naming exactly one tool, with no task_id",
        ...(options.task_id === undefined ? {} : { conflicting_arguments: ["task_id"] })
      }
    };
  }
  if (toolName !== WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL) {
    return {
      code: WORK_RECORD_EDIT_INPUT_CONTRACT_CODES.TOOL_UNSUPPORTED,
      message: "input_contract is available only for the ordinary work-record editor",
      details: { requested_tool_name: toolName }
    };
  }
  if (options.limit !== undefined) {
    return {
      code: WORK_RECORD_EDIT_INPUT_CONTRACT_CODES.LIMIT_CONFLICT,
      message: "use input_contract.limit for field inventory paging",
      details: { conflicting_arguments: ["limit"] }
    };
  }
  return null;
}

export function workRecordEditInputContractRequestRefusal(options, { editorVisible }) {
  const selector = options.input_contract;
  if (selector === undefined || selector === null || selector.kind === "guidance") return null;
  const misuse = editorInputContractMisuse(options, options.tool_name);
  if (misuse === null) return null;
  const correction = editorVisible ? correctedEditorInputContractRequest(selector) : null;
  return inputContractMechanicalRefusal(
    misuse.code,
    misuse.message,
    {
      source: WORK_RECORD_EDIT_INPUT_CONTRACT_SOURCE,
      ...misuse.details,
      ...(correction === null ? {} : { supported_tool_name: WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL })
    },
    correction === null
      ? []
      : [describeInputContractContinuation(correction.arguments, correction.successFact)]
  );
}

export function workRecordEditInputFailureNextCalls({
  field,
  scope,
  contentReference,
  buildContinuation
}) {
  const guidanceArguments = typeof field === "string" && scope !== null
    ? workRecordEditInputFieldArguments(field, scope)
    : workRecordEditInputFieldsArguments({
      offset: 0,
      limit: TOOL_DISCOVERY_LIST_DEFAULT_LIMIT,
      expectedSourceDigest: undefined
    });
  const guidance = checkedWorkRecordEditInputContinuation(
    buildContinuation,
    guidanceArguments,
    typeof field === "string" && scope !== null
      ? "editor_input_contract.field_detail_returned"
      : "editor_input_contract.first_page_returned"
  );
  const raw = buildNextCall({
    tool: contentReference.read_tool,
    arguments: {
      ref_id: contentReference.ref_id,
      offset: contentReference.range.offset,
      length: contentReference.range.length
    },
    recommended: false,
    success_predicate: {
      fact: "mcp_response.content_reference_range_returned",
      operator: "is_true"
    }
  });
  return [guidance, raw];
}

export function deliverWorkRecordEditInputGuidance({
  entry,
  selector = null,
  registry = undefined,
  requestFacts,
  editorSchema,
  buildContinuation,
  writeSemanticsStatement,
  measureResultBytes = null,

  responseEnv = process.env
}) {
  const registryOptions = registry === undefined ? {} : { registry };
  const inventory = createWorkRecordEditFieldInventory({ ...registryOptions, requestFacts });
  const digest = sourceDigest(inventory, requestFacts);
  if (selector === null || selector === undefined) {
    return initialGuidance({
      entry,
      inventory,
      digest,
      editorSchema,
      buildContinuation,
      writeSemanticsStatement
    });
  }
  if (selector.kind === "field") {
    return fieldGuidance({ selector, registryOptions, requestFacts, inventory, digest, buildContinuation });
  }
  if (selector.kind === "fields") {
    return fieldsGuidance({
      selector,
      inventory,
      digest,
      buildContinuation,
      measureResultBytes,
      responseEnv
    });
  }
  return inputContractMechanicalRefusal(
    WORK_RECORD_EDIT_INPUT_CONTRACT_CODES.INVALID_SELECTOR,
    "input_contract.kind must be field or fields"
  );
}
