

import { createHash } from "node:crypto";
import { z } from "zod";

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

const DESCRIBE_TOOL = "workspace_tools_describe";
export const TOOL_INPUT_GUIDANCE_SOURCE = "tool_input_guidance";
export const TOOL_INPUT_GUIDANCE_SELECTOR_CONTRACT =
  "workspace-tools-describe-input-guidance-selector.v2";

export const TOOL_INPUT_GUIDANCE_OVERVIEW_PATH = Object.freeze(["overview"]);

export const TOOL_INPUT_GUIDANCE_CODES = Object.freeze({
  EXACT_TOOL_REQUIRED: "tool_input_guidance_exact_tool_required",
  ARGUMENTS_CONFLICT: "tool_input_guidance_arguments_conflict",
  UNAVAILABLE: "tool_input_guidance_unavailable",
  INVALID_PATH: "tool_input_guidance_invalid_path",
  PATH_NOT_FOUND: "tool_input_guidance_path_not_found",
  STALE_SOURCE: "tool_input_guidance_stale_source"
});

const SELECTION_RETURNED = "tool_input_guidance.selection_returned";
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/u;

export const TOOL_DISCOVERY_INPUT_CONTRACT_SELECTOR_SCHEMA = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    field: z.string().min(1),
    scope: z.enum(["record", "slice"])
  }).strict(),
  z.object({
    kind: z.literal("fields"),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    expected_source_digest: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal("guidance"),
    path: z.array(z.string()).optional(),
    expected_source_digest: z.string().optional()
  }).strict().describe(

    "Registered authoring guidance of one tool: requires one exact tool_name and cannot combine with " +
      "task_id, top-level limit or verbose:true (verbose:false is accepted). No path selects overview; a " +
      "literal path returns that complete value."
  )
]);

export const WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA = z.object({
  task_id: z.string().optional(),
  tool_name: z.string().optional(),
  limit: z.number().int().positive().optional(),
  verbose: z.boolean().optional().describe(
    "true restores every field and a named compact tool's enforced input schema; not combinable with " +
      "input_contract kind guidance."
  ),
  input_contract: TOOL_DISCOVERY_INPUT_CONTRACT_SELECTOR_SCHEMA.optional()
}).strict();

export function inputContractSourceDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export function inputContractMechanicalRefusal(code, message, details = {}, nextCalls = []) {
  return {
    ok: false,
    diagnostic: {
      code,
      severity: "error",
      authority_limb: "mechanical_failure",
      message,
      ...details
    },
    ...(nextCalls.length > 0 ? { next_calls: nextCalls } : {})
  };
}

export function inputContractSourceBindingRefusal({
  offset,
  expectedSourceDigest,
  currentSourceDigest,
  source,
  details = {},
  codes,
  messages,
  restartCalls
}) {
  if (expectedSourceDigest !== undefined && expectedSourceDigest !== currentSourceDigest) {
    return inputContractMechanicalRefusal(codes.stale, messages.stale, {
      source,
      ...details,
      expected_source_digest: expectedSourceDigest,
      current_source_digest: currentSourceDigest,
      offset
    }, restartCalls());
  }
  if (offset > 0 && expectedSourceDigest === undefined) {
    return inputContractMechanicalRefusal(codes.required, messages.required, {
      source,
      ...details,
      current_source_digest: currentSourceDigest,
      offset
    }, restartCalls());
  }
  return null;
}

export function inputContractPageAdvances(envelope, offset) {
  return !envelope.has_more ||
    (Number.isInteger(envelope.next_offset) && envelope.next_offset > offset &&
      envelope.next_calls?.length === 1);
}

export function describeInputContractContinuation(argumentsValue, successFact,
  { recommended = true } = {}) {
  const parsed = WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA.safeParse(argumentsValue);
  if (!parsed.success) {
    throw new Error(
      "tool_input_guidance_continuation_invalid: an emitted describe request does not " +
      `satisfy the registered describe schema: ${parsed.error.message}`
    );
  }
  return buildNextCall({
    tool: DESCRIBE_TOOL,
    arguments: argumentsValue,
    recommended,
    success_predicate: { fact: successFact, operator: "is_true" }
  });
}

export function toolInputGuidanceDigest(toolName, guidance) {
  return inputContractSourceDigest({
    source: TOOL_INPUT_GUIDANCE_SOURCE,
    selector_contract: TOOL_INPUT_GUIDANCE_SELECTOR_CONTRACT,
    tool_name: toolName,
    guidance
  });
}

function guidanceCall(toolName, path, sourceDigest) {
  return describeInputContractContinuation({
    tool_name: toolName,
    input_contract: {
      kind: "guidance",
      path: [...path],
      expected_source_digest: sourceDigest
    }
  }, SELECTION_RETURNED);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function guidanceKind(value) {
  if (Array.isArray(value)) return "array";
  return value === null ? "null" : typeof value;
}

export function assertToolInputGuidanceRegistration(toolName, guidance) {
  if (!isPlainObject(guidance) || typeof guidance.overview !== "string" ||
      guidance.overview.trim() === "") {
    throw new Error(
      `tool_input_guidance_overview_required: the guidance registered for ${toolName} must be ` +
      "an object with a nonempty string overview"
    );
  }
}

export function resolveToolInputGuidancePath(guidance, path) {
  let current = guidance;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const failure = (code, expected) => ({
      ok: false,
      code,
      segment_index: index,
      resolved_path: path.slice(0, index),
      expected
    });
    if (Array.isArray(current)) {
      if (!CANONICAL_INDEX.test(segment)) {
        return failure(TOOL_INPUT_GUIDANCE_CODES.INVALID_PATH, "a canonical array index string");
      }
      if (Number(segment) >= current.length) {
        return failure(TOOL_INPUT_GUIDANCE_CODES.PATH_NOT_FOUND,
          `an array index below ${current.length}`);
      }
      current = current[Number(segment)];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, segment)) {
        return failure(TOOL_INPUT_GUIDANCE_CODES.PATH_NOT_FOUND, "an own member key of the selected object");
      }
      current = current[segment];
    } else {
      return failure(TOOL_INPUT_GUIDANCE_CODES.PATH_NOT_FOUND,
        `no further segment: the selected value is ${guidanceKind(current)}`);
    }
  }
  return { ok: true, value: current };
}

export function toolInputGuidanceSelectionCall(toolName, guidance, path) {
  if (!resolveToolInputGuidancePath(guidance, path).ok) {
    throw new Error(
      `tool_input_guidance_reference_unresolved: ${JSON.stringify(path)} is not a registered ` +
      `guidance member of ${toolName}`
    );
  }
  return guidanceCall(toolName, path, toolInputGuidanceDigest(toolName, guidance));
}

export function toolInputGuidanceLocator(toolName, guidance) {
  return {
    call: toolInputGuidanceSelectionCall(toolName, guidance, TOOL_INPUT_GUIDANCE_OVERVIEW_PATH)
  };
}

const ANY_INDEX_SEGMENT = "[]";

export function assertToolInputGuidanceRequestLocations(toolName, guidance, locations) {
  if (guidance === null || guidance === undefined || !Array.isArray(locations)) {
    throw new Error(
      `tool_input_guidance_request_locations_invalid: ${toolName} binds request locations ` +
      "without registered guidance"
    );
  }
  const seen = new Set();
  for (const location of locations) {
    const valid = Array.isArray(location?.path) && location.path.length > 0 &&
      location.path.every((segment) => typeof segment === "string" && segment !== "") &&
      Array.isArray(location.guidance_path) &&
      location.guidance_path.every((segment) => typeof segment === "string");
    const key = valid ? JSON.stringify(location.path) : null;
    if (!valid || seen.has(key)) {
      throw new Error(
        `tool_input_guidance_request_locations_invalid: ${toolName} declares an invalid or ` +
        `repeated request location ${JSON.stringify(location?.path ?? null)}`
      );
    }
    seen.add(key);

    toolInputGuidanceSelectionCall(toolName, guidance, location.guidance_path);
  }
}

export function toolInputGuidanceRequestLocation(locations, issuePath) {
  if (!Array.isArray(issuePath)) return null;
  let selected = null;
  for (const location of locations) {
    const { path } = location;
    if (path.length > issuePath.length ||
        (selected !== null && path.length <= selected.path.length)) continue;
    if (path.every((segment, index) => segment === ANY_INDEX_SEGMENT
      ? Number.isInteger(issuePath[index])
      : segment === issuePath[index])) {
      selected = location;
    }
  }
  return selected;
}

export function projectToolInputGuidanceReferences(toolName, guidance, constraints) {
  return constraints.map((constraint) => {
    if (!Array.isArray(constraint?.guidance_path)) return constraint;
    const { guidance_path: guidancePath, ...rest } = constraint;
    return {
      ...rest,
      guidance_call: toolInputGuidanceSelectionCall(toolName, guidance, guidancePath)
    };
  });
}

export function toolInputGuidanceRequestRefusal(options) {
  const selector = options.input_contract;
  const toolName = options.tool_name;
  if (typeof toolName !== "string" || toolName === "" || toolName.trim() !== toolName) {
    const trimmed = typeof toolName === "string" ? toolName.trim() : "";
    const recovery = trimmed === ""
      ? buildNextCall({
        tool: "workspace_tools_list",
        arguments: {},
        recommended: true,
        success_predicate: { fact: "tool_discovery.list_page_returned", operator: "is_true" }
      })
      : describeInputContractContinuation({ tool_name: trimmed, input_contract: selector },
        SELECTION_RETURNED);
    return inputContractMechanicalRefusal(
      TOOL_INPUT_GUIDANCE_CODES.EXACT_TOOL_REQUIRED,
      "input_contract kind guidance requires one exact tool_name",
      { source: TOOL_INPUT_GUIDANCE_SOURCE, expected: "tool_name exactly naming one tool" },
      [recovery]
    );
  }
  const conflicting = [
    ...(options.task_id === undefined ? [] : ["task_id"]),
    ...(options.limit === undefined ? [] : ["limit"]),
    ...(options.verbose === true ? ["verbose"] : [])
  ];
  if (conflicting.length === 0) return null;
  return inputContractMechanicalRefusal(
    TOOL_INPUT_GUIDANCE_CODES.ARGUMENTS_CONFLICT,
    "input_contract kind guidance cannot combine with task_id, top-level limit or verbose:true; " +
      "the selected guidance value is returned whole",
    { source: TOOL_INPUT_GUIDANCE_SOURCE, conflicting_arguments: conflicting },
    [describeInputContractContinuation({ tool_name: toolName, input_contract: selector },
      SELECTION_RETURNED)]
  );
}

export function deliverToolInputGuidance({ toolName, guidance, selector }) {
  if (guidance === null || guidance === undefined) {
    return inputContractMechanicalRefusal(
      TOOL_INPUT_GUIDANCE_CODES.UNAVAILABLE,
      "the named tool registers no input guidance; verbose describe serves its complete descriptor and input contract",
      { source: TOOL_INPUT_GUIDANCE_SOURCE },
      [describeInputContractContinuation({ tool_name: toolName, verbose: true },
        "tool_discovery.complete_entry_returned")]
    );
  }
  const digest = toolInputGuidanceDigest(toolName, guidance);
  const path = selector.path ?? TOOL_INPUT_GUIDANCE_OVERVIEW_PATH;
  const resolved = resolveToolInputGuidancePath(guidance, path);

  if (selector.expected_source_digest !== undefined &&
      selector.expected_source_digest !== digest) {
    return inputContractMechanicalRefusal(
      TOOL_INPUT_GUIDANCE_CODES.STALE_SOURCE,
      "the registered guidance changed; repeat the selection against the current source",
      {
        source: TOOL_INPUT_GUIDANCE_SOURCE,
        path: [...path],
        expected_source_digest: selector.expected_source_digest,
        current_source_digest: digest
      },
      [guidanceCall(toolName, resolved.ok ? path : resolved.resolved_path, digest)]
    );
  }
  if (!resolved.ok) {
    return inputContractMechanicalRefusal(
      resolved.code,
      resolved.code === TOOL_INPUT_GUIDANCE_CODES.INVALID_PATH
        ? "a path segment is not a canonical index of the selected array"
        : "the path does not name a registered guidance member",
      {
        source: TOOL_INPUT_GUIDANCE_SOURCE,
        path: [...path],
        segment_index: resolved.segment_index,
        resolved_path: resolved.resolved_path,
        expected: resolved.expected
      },
      [guidanceCall(toolName, resolved.resolved_path, digest)]
    );
  }
  return { ok: true, source_digest: digest, value: resolved.value };
}
