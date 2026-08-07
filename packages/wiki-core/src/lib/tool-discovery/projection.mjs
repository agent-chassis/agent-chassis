

import { Buffer } from "node:buffer";
import {
  cloneJson,
  hasOwn,
  isObject,
  normalizeStringList,
  compareToolEntries,
  sortToolDiscoveryDiagnostics,
  validateToolDiscoveryDescriptor,
  digestToolDiscoveryDescriptor,
  loadToolDiscoveryDescriptor,
  DEFAULT_DESCRIPTOR_PATH,
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_DISCOVERY_INTERFACE_VALUES,
  TOOL_DISCOVERY_SOURCE_KIND_VALUES,
  TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH
} from "./descriptor.mjs";
import {
  normalizeDiscoveryQuery,
  resolveToolAudience,
  resolveToolTierVisibility,
  tierVisibilityAllows,
  projectToolDiscoveryEntryForTier
} from "./gating.mjs";

export const TOOL_DISCOVERY_COMPACT_ENTRY_FIELDS = Object.freeze([
  "tool_name",
  "display_name",
  "kind",
  "entrypoint",
  "task_ids",
  "runtime_posture",
  "recommended_route",
  "tier_visibility",
  "priority",
  "summary"
]);

export const TOOL_DISCOVERY_LIST_DEFAULT_LIMIT = 20;
export const TOOL_DISCOVERY_LIST_MAX_BYTES = 3840;
export const TOOL_DISCOVERY_LIST_ENTRY_FIELDS = Object.freeze([
  "tool_name",
  "task_ids"
]);

const TOOL_DISCOVERY_LIST_NEXT_CALLS = Object.freeze([
  Object.freeze({
    tool: "workspace_tools_query",
    recommended: true,
    target_by: Object.freeze(["task_id", "tool_name"])
  }),
  Object.freeze({
    tool: "workspace_tools_describe",
    target_by: Object.freeze(["tool_name"])
  })
]);

export function filterToolDiscoveryTools(descriptorOrTools, query = {}) {
  const normalizedQuery = normalizeDiscoveryQuery(query);
  const tools = Array.isArray(descriptorOrTools?.tools)
    ? descriptorOrTools.tools
    : Array.isArray(descriptorOrTools)
      ? descriptorOrTools
      : [];

  return tools.filter((tool) => {
    if (!isObject(tool)) {
      return false;
    }

    if (normalizedQuery.task_id && !normalizeStringList(tool.task_ids).includes(normalizedQuery.task_id)) {
      return false;
    }

    if (normalizedQuery.tool_name && tool.tool_name !== normalizedQuery.tool_name) {
      return false;
    }

    if (normalizedQuery.audience && !resolveToolAudience(tool).includes(normalizedQuery.audience)) {
      return false;
    }

    if (
      normalizedQuery.registered_tier &&
      !tierVisibilityAllows(resolveToolTierVisibility(tool), normalizedQuery.registered_tier)
    ) {
      return false;
    }

    return true;
  });
}

export function getNotesSummary(notes) {
  if (typeof notes !== "string" || notes.trim() === "") {
    return "";
  }
  const match = notes.match(/^[^.!?]+(?:[.!?](?=\s|$))?/);
  let summary = match ? match[0].trim() : notes;
  if (summary.length > 140) {
    summary = summary.substring(0, 137) + "...";
  }
  return summary;
}

export function compactToolDiscoveryEntry(tool) {
  if (!isObject(tool)) {
    return tool;
  }
  const result = {};
  for (const field of TOOL_DISCOVERY_COMPACT_ENTRY_FIELDS) {
    if (hasOwn(tool, field)) {
      result[field] = cloneJson(tool[field]);
    }
  }

  if (!hasOwn(result, "summary") || !result.summary) {
    if (hasOwn(tool, "notes") && typeof tool.notes === "string") {
      const summary = getNotesSummary(tool.notes);
      if (summary) {
        result.summary = summary;
      }
    }
  }

  return result;
}

export function compactToolDiscoveryListEntry(tool) {
  if (!isObject(tool)) {
    return tool;
  }
  const result = {};
  for (const field of TOOL_DISCOVERY_LIST_ENTRY_FIELDS) {
    if (hasOwn(tool, field)) {
      result[field] = cloneJson(tool[field]);
    }
  }
  return result;
}

function prettyJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function cloneToolDiscoveryListNextCalls() {
  return TOOL_DISCOVERY_LIST_NEXT_CALLS.map((entry) => cloneJson(entry));
}

export function createBoundedToolDiscoveryListEnvelope(
  baseEnvelope,
  entries,
  {
    totalCount = Array.isArray(entries) ? entries.length : 0,
    limit = TOOL_DISCOVERY_LIST_DEFAULT_LIMIT,
    byteLimit = TOOL_DISCOVERY_LIST_MAX_BYTES,
    resultField = "results"
  } = {}
) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const normalizedTotalCount = Number.isInteger(totalCount) && totalCount >= 0
    ? totalCount
    : normalizedEntries.length;
  const normalizedLimit = Number.isInteger(limit) && limit > 0
    ? limit
    : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;
  const normalizedByteLimit = Number.isInteger(byteLimit) && byteLimit > 0
    ? byteLimit
    : TOOL_DISCOVERY_LIST_MAX_BYTES;
  const base = isObject(baseEnvelope) ? { ...baseEnvelope } : {};
  delete base[resultField];
  for (const field of [
    "total_count",
    "returned_count",
    "truncated_count",
    "limit_applied",
    "byte_limit",
    "count_truncated",
    "byte_truncated",
    "truncated",
    "next_calls"
  ]) {
    delete base[field];
  }

  const countLimitedEntries = normalizedEntries
    .slice(0, normalizedLimit)
    .map((entry, index) => ({ ...compactToolDiscoveryListEntry(entry), rank: index + 1 }));
  const countTruncated = normalizedTotalCount > normalizedLimit;

  const buildEnvelope = (returnedEntries, byteTruncated) => {
    const returnedCount = returnedEntries.length;
    const truncated = countTruncated || byteTruncated;
    return {
      ...base,
      [resultField]: returnedEntries,
      total_count: normalizedTotalCount,
      returned_count: returnedCount,
      truncated_count: Math.max(0, normalizedTotalCount - returnedCount),
      limit_applied: normalizedLimit,
      byte_limit: normalizedByteLimit,
      count_truncated: countTruncated,
      byte_truncated: byteTruncated,
      truncated,
      ...(truncated ? { next_calls: cloneToolDiscoveryListNextCalls() } : {})
    };
  };

  let returnedEntries = [];
  let bounded = buildEnvelope([], countLimitedEntries.length > 0);
  if (prettyJsonBytes(bounded) > normalizedByteLimit) {
    throw new Error(
      `tool discovery list metadata exceeds the ${normalizedByteLimit}-byte response ceiling`
    );
  }

  for (const entry of countLimitedEntries) {
    const candidateEntries = [...returnedEntries, entry];
    const candidate = buildEnvelope(
      candidateEntries,
      candidateEntries.length < countLimitedEntries.length
    );
    if (prettyJsonBytes(candidate) > normalizedByteLimit) {
      break;
    }
    returnedEntries = candidateEntries;
    bounded = candidate;
  }

  return bounded;
}

export function rankToolDiscoveryTools(descriptorOrTools, query = {}, { verbose = true } = {}) {
  const normalizedQuery = normalizeDiscoveryQuery(query);
  const tools = filterToolDiscoveryTools(descriptorOrTools, normalizedQuery)
    .map((tool) => projectToolDiscoveryEntryForTier(tool, normalizedQuery.registered_tier))
    .sort(compareToolEntries);

  const limited = normalizedQuery.limit != null ? tools.slice(0, normalizedQuery.limit) : tools;
  return limited.map((tool, index) => {
    const ranked = verbose ? { ...tool } : compactToolDiscoveryEntry(tool);
    return { ...ranked, rank: index + 1 };
  });
}

export function listToolDiscoveryTools(descriptorOrTools, query = {}, options = {}) {
  const normalizedQuery = normalizeDiscoveryQuery(query);
  const defaultLimit = Number.isInteger(options.defaultLimit) && options.defaultLimit > 0
    ? options.defaultLimit
    : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;
  const limit = normalizedQuery.limit ?? defaultLimit;

  const allTools = filterToolDiscoveryTools(descriptorOrTools, normalizedQuery)
    .map((tool) => projectToolDiscoveryEntryForTier(tool, normalizedQuery.registered_tier))
    .sort(compareToolEntries);

  return createBoundedToolDiscoveryListEnvelope({}, allTools, {
    totalCount: allTools.length,
    limit,
    byteLimit: options.byteLimit,
    resultField: "tools"
  });
}

export function describeToolDiscoveryTools(descriptorOrTools, query = {}, options = {}) {
  const verbose = options.verbose === true;
  const normalizedQuery = normalizeDiscoveryQuery(query);
  const tools = filterToolDiscoveryTools(descriptorOrTools, normalizedQuery)
    .map((tool) => projectToolDiscoveryEntryForTier(tool, normalizedQuery.registered_tier))
    .sort(compareToolEntries);

  return tools.map((tool, index) => {
    const entry = verbose ? { ...tool } : compactToolDiscoveryEntry(tool);
    return { ...entry, rank: index + 1 };
  });
}

export function createToolDiscoveryFreshness(state = "fresh", reasons = []) {
  return {
    state,
    degraded: state !== "fresh",
    reasons: Array.isArray(reasons) ? reasons.slice() : []
  };
}

export function createToolDiscoveryEnvelope(overrides = {}) {
  const descriptor = isObject(overrides.descriptor) ? overrides.descriptor : null;
  const query = normalizeDiscoveryQuery(overrides.query);

  const echoQuery = { ...query };
  delete echoQuery.registered_tier;
  const verbose = overrides.verbose !== false;
  const results = Array.isArray(overrides.results)
    ? overrides.results.map((entry) => cloneJson(entry))
    : descriptor
      ? rankToolDiscoveryTools(descriptor, query, { verbose })
      : [];
  const diagnostics = Array.isArray(overrides.diagnostics)
    ? sortToolDiscoveryDiagnostics(overrides.diagnostics.map((entry) => cloneJson(entry)))
    : descriptor
      ? validateToolDiscoveryDescriptor(descriptor).diagnostics
      : [];

  if (verbose) {
    return {
      schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      interface: TOOL_DISCOVERY_INTERFACE_VALUES.includes(overrides.interface) ? overrides.interface : "descriptor",
      source_kind: TOOL_DISCOVERY_SOURCE_KIND_VALUES.includes(overrides.source_kind)
        ? overrides.source_kind
        : "checked_in_descriptor",
      package_versions: isObject(overrides.package_versions) ? cloneJson(overrides.package_versions) : {},
      descriptor: descriptor
        ? {
            path:
              overrides.descriptor?.path ??
              TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
            digest:
              overrides.descriptor?.digest ??
              digestToolDiscoveryDescriptor(descriptor)
          }
        : {
            path: TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
            digest: overrides.descriptor?.digest ?? null
          },
      freshness: isObject(overrides.freshness)
        ? cloneJson(overrides.freshness)
        : createToolDiscoveryFreshness(diagnostics.length === 0 ? "fresh" : "degraded", diagnostics.map((entry) => entry.code)),
      ...(Object.keys(echoQuery).length > 0 ? { query: echoQuery } : {}),
      verbose,
      results,
      diagnostics
    };
  }

  const envelope = {
    schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
    ...(Object.keys(echoQuery).length > 0 ? { query: echoQuery } : {}),
    results
  };

  if (diagnostics.length > 0) {
    envelope.diagnostics = diagnostics;
  }

  return envelope;
}

export async function loadToolDiscoveryEnvelope(options = {}) {
  const descriptorPath = options.descriptorPath ?? DEFAULT_DESCRIPTOR_PATH;
  const descriptor = await loadToolDiscoveryDescriptor(descriptorPath);
  const query = normalizeDiscoveryQuery(options.query);
  const verbose = options.verbose === true;
  const validation = validateToolDiscoveryDescriptor(descriptor);

  return createToolDiscoveryEnvelope({
    interface: options.interface,
    source_kind: options.source_kind,
    package_versions: options.package_versions,
    descriptor: {
      path: options.descriptorPath ?? TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
      digest: digestToolDiscoveryDescriptor(descriptor)
    },
    freshness: validation.valid ? createToolDiscoveryFreshness("fresh", []) : createToolDiscoveryFreshness("degraded", validation.diagnostics.map((entry) => entry.code)),
    query,
    verbose,
    results: rankToolDiscoveryTools(descriptor, query, { verbose }),
    diagnostics: validation.diagnostics
  });
}

export function queryToolDiscoveryDescriptor(descriptor, query = {}, options = {}) {
  return rankToolDiscoveryTools(descriptor, query, { verbose: options.verbose === true });
}
