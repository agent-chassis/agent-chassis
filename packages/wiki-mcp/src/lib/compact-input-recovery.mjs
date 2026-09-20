

import {
  resolveToolInputGuidancePath,
  TOOL_INPUT_GUIDANCE_CODES,
  toolInputGuidanceRequestLocation,
  toolInputGuidanceSelectionCall
} from "./tool-discovery-input-guidance-delivery.mjs";

export const COMPACT_INPUT_RECOVERY_SCHEMA_VERSION = "compact-input-recovery.v1";
export const COMPACT_INPUT_RECOVERY_AUTHORITY_GAP = "owner_declared_no_authority_limb";

export const COMPACT_INPUT_RECOVERY_LOCATION_UNDECLARED = "request_location_guidance_undeclared";
const DESCRIBE_TOOL = "workspace_tools_describe";

export function rejectedFieldPath(path, root = "$") {
  if (!Array.isArray(path) || path.length === 0) return root;
  return path.reduce((rendered, segment) => Number.isInteger(segment)
    ? `${rendered}[${segment}]`
    : `${rendered}.${segment}`, root);
}

function structuralContractCall(toolName) {
  return Object.freeze({
    tool: DESCRIBE_TOOL,
    arguments: Object.freeze({ tool_name: toolName, verbose: true })
  });
}

function guidanceRead(toolName, guidance, guidancePath) {
  if (!Array.isArray(guidancePath) ||
      !guidancePath.every((segment) => typeof segment === "string")) {
    return { guidance_unavailable: {
      code: TOOL_INPUT_GUIDANCE_CODES.INVALID_PATH,
      guidance_path: structuredClone(guidancePath ?? null)
    } };
  }
  if (guidance === null || guidance === undefined) {
    return { guidance_unavailable: {
      code: TOOL_INPUT_GUIDANCE_CODES.UNAVAILABLE,
      guidance_path: [...guidancePath]
    } };
  }
  const resolved = resolveToolInputGuidancePath(guidance, guidancePath);
  if (!resolved.ok) {
    return { guidance_unavailable: {
      code: resolved.code,
      guidance_path: [...guidancePath],
      resolved_path: resolved.resolved_path
    } };
  }
  return { guidance_call: toolInputGuidanceSelectionCall(toolName, guidance, guidancePath) };
}

function authoredFieldPath(guidance, entry) {
  if (typeof entry?.field_path === "string" && entry.field_path.startsWith("$")) {
    return entry.field_path;
  }
  const root = guidance?.authored_path_root;
  if (typeof root !== "string" || typeof entry?.field !== "string") return null;
  return entry.field === "" ? root : `${root}.${entry.field}`;
}

function refusalAuthority(payload, details) {
  const limb = typeof details.limb === "string" ? details.limb : null;
  return {
    reason_code: typeof payload.reason_code === "string" ? payload.reason_code : null,
    authority_limb: limb,
    ...(limb === null ? { authority_gap: COMPACT_INPUT_RECOVERY_AUTHORITY_GAP } : {})
  };
}

function failedField(toolName, guidance, entry) {
  const fieldPath = authoredFieldPath(guidance, entry);
  return {
    field: entry.field,
    ...(fieldPath === null ? {} : { field_path: fieldPath }),
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(entry.claim_id === undefined ? {} : { claim_id: entry.claim_id }),
    ...guidanceRead(toolName, guidance, entry.guidance_path)
  };
}

const OCCURRENCE_KEYS = Object.freeze(["field", "field_path", "code", "claim_id"]);

export function groupFailedFieldsByCorrection(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const occurrence = {};
    const correction = {};
    for (const [key, value] of Object.entries(entry)) {
      if (OCCURRENCE_KEYS.includes(key)) occurrence[key] = value;
      else correction[key] = value;
    }
    const identity = JSON.stringify(correction);
    const existing = groups.get(identity);
    if (existing === undefined) groups.set(identity, { occurrences: [occurrence], correction });
    else existing.occurrences.push(occurrence);
  }
  return [...groups.values()].map(({ occurrences, correction }) => ({
    occurrences,
    ...correction
  }));
}

function rejectedRequestFields(toolName, guidance, locations, issues) {
  const byPath = new Map();
  for (const issue of issues) {
    const fieldPath = rejectedFieldPath(issue?.path);
    if (byPath.has(fieldPath)) continue;
    const location = toolInputGuidanceRequestLocation(locations, issue?.path);
    byPath.set(fieldPath, {
      field_path: fieldPath,
      ...(location === null
        ? { guidance_unavailable: { code: COMPACT_INPUT_RECOVERY_LOCATION_UNDECLARED } }
        : guidanceRead(toolName, guidance, location.guidance_path))
    });
  }
  return [...byPath.values()];
}

export function projectCompactInputRecovery({
  result, toolName, guidance = null, requestGuidanceLocations = []
}) {
  const structured = result?.structuredContent;
  const payload = structured?.warning?.payload;
  const details = payload?.details;
  if (result?.isError !== true || details === null || typeof details !== "object" ||
      Array.isArray(details)) {
    return result;
  }
  const issues = details.phase === "request" && Array.isArray(details.issues) &&
    details.issues.length > 0 ? details.issues : null;
  const attributions = Array.isArray(details.requirement_attributions) &&
    details.requirement_attributions.length > 0 ? details.requirement_attributions : null;
  const located = typeof details.field === "string" && Object.hasOwn(details, "guidance_path");
  if (issues === null && attributions === null && !located) return result;

  let rejectedFieldPaths;
  let correction;
  if (issues !== null) {
    rejectedFieldPaths = [...new Set(issues.map((issue) => rejectedFieldPath(issue?.path)))];

    correction = {
      ...(requestGuidanceLocations.length === 0 ? {} : {
        failed_fields: groupFailedFieldsByCorrection(
          rejectedRequestFields(toolName, guidance, requestGuidanceLocations, issues)
        )
      }),
      structural_contract: structuralContractCall(toolName)
    };
  } else {
    const failedFields = (attributions ?? [details]).map((entry) =>
      failedField(toolName, guidance, entry));
    rejectedFieldPaths = [...new Set(failedFields.flatMap(({ field_path: fieldPath }) =>
      fieldPath === undefined ? [] : [fieldPath]))];
    correction = { failed_fields: groupFailedFieldsByCorrection(failedFields) };
  }
  const augmented = {
    ...structured,
    warning: {
      ...structured.warning,
      payload: {
        ...payload,
        details: {
          ...details,
          ...(rejectedFieldPaths.length === 0 ? {} : { rejected_field_paths: rejectedFieldPaths }),

          input_contract_recovery: {
            schema_version: COMPACT_INPUT_RECOVERY_SCHEMA_VERSION,
            tool_name: toolName,
            refusal: refusalAuthority(payload, details),
            ...correction
          }
        }
      }
    }
  };
  return {
    ...result,
    structuredContent: augmented,
    content: [{ type: "text", text: JSON.stringify(augmented) }]
  };
}
