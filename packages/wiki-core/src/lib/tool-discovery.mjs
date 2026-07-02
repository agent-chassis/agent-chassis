import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_DISCOVERY_SCHEMA_VERSION = "tool-discovery.v1";

const TOOL_DISCOVERY_DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data"
);

export const TOOL_DISCOVERY_FRAGMENT_DIRNAME = "tool-discovery";
export const TOOL_DISCOVERY_MANIFEST_FILENAME = "manifest.json";
export const TOOL_DISCOVERY_FRAGMENT_DIR = path.join(
  TOOL_DISCOVERY_DATA_DIR,
  TOOL_DISCOVERY_FRAGMENT_DIRNAME
);
export const TOOL_DISCOVERY_MANIFEST_PATH = path.join(
  TOOL_DISCOVERY_FRAGMENT_DIR,
  TOOL_DISCOVERY_MANIFEST_FILENAME
);
export const TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery/manifest.json";
export const TOOL_DISCOVERY_MANIFEST_KIND = "tool-discovery-fragment-manifest";
export const TOOL_DISCOVERY_FRAGMENT_KIND = "tool-discovery-fragment";

export const TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME = "tool-discovery.v1.json";
export const TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery.v1.json";
export const TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH = path.join(
  TOOL_DISCOVERY_DATA_DIR,
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME
);

export const TOOL_DISCOVERY_DESCRIPTOR_FILENAME = TOOL_DISCOVERY_MANIFEST_FILENAME;
export const TOOL_DISCOVERY_DESCRIPTOR_PATH = TOOL_DISCOVERY_MANIFEST_PATH;
export const TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH = TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH;

export const TOOL_DISCOVERY_INTERFACE_VALUES = Object.freeze(["mcp", "cli", "descriptor"]);
export const TOOL_DISCOVERY_SOURCE_KIND_VALUES = Object.freeze([
  "checked_in_descriptor",
  "runtime_snapshot",
  "last_resort_descriptor"
]);
export const TOOL_DISCOVERY_INSTALL_STATE_VALUES = Object.freeze([
  "installed",
  "package_file_only",
  "missing"
]);
export const TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES = Object.freeze([
  "supported",
  "conditional",
  "refusal_only",
  "deactivated",
  "historical",
  "missing"
]);
export const TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES = Object.freeze([
  "mcp",
  "cli",
  "descriptor",
  "none"
]);
export const TOOL_DISCOVERY_SIDE_EFFECT_VALUES = Object.freeze([
  "read_only",
  "workspace_write",
  "record_write",
  "process_spawn",
  "cleanup_runtime_state",
  "destructive"
]);
export const TOOL_DISCOVERY_AUTHORITY_VALUES = Object.freeze([
  "checked_in_descriptor",
  "workspace_repo",
  "work_record",
  "launcher_registry",
  "launcher_backend",
  "runtime_env",
  "historical_surface",
  "operator_input"
]);
export const TOOL_DISCOVERY_AUDIENCE_VALUES = Object.freeze(["agent", "operator"]);
export const TOOL_DISCOVERY_DEFAULT_AUDIENCE = Object.freeze(["agent", "operator"]);
export const TOOL_DISCOVERY_TIER_VISIBILITY_VALUES = Object.freeze([
  "free_local",
  "paid_cce",
  "operator_only"
]);
export const TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY = Object.freeze([]);

export const TOOL_DISCOVERY_TIER_TEXT_FIELDS = Object.freeze(["notes", "summary"]);
export const TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL = "free_local";
export const TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE = "paid_cce";
export const TOOL_DISCOVERY_RESULT_REQUIRED_FIELDS = Object.freeze([
  "tool_name",
  "display_name",
  "kind",
  "entrypoint",
  "task_ids",
  "install_state",
  "runtime_posture",
  "recommended_route",
  "priority",
  "side_effects",
  "authority",
  "tier_visibility",
  "docs_refs",
  "source_files"
]);
export const TOOL_DISCOVERY_ENVELOPE_REQUIRED_FIELDS = Object.freeze([
  "schema_version",
  "generated_at",
  "interface",
  "source_kind",
  "descriptor",
  "freshness",
  "results",
  "diagnostics"
]);
export const TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_VALUES = Object.freeze([
  "info",
  "warning",
  "degraded",
  "error"
]);
export const TOOL_DISCOVERY_DIAGNOSTIC_CODES = Object.freeze([
  "missing_schema_version",
  "invalid_schema_version",
  "missing_repository",
  "missing_tools",
  "invalid_tools_array",
  "missing_required_field",
  "invalid_enum_value",
  "invalid_priority",
  "duplicate_tool_name",
  "duplicate_entrypoint",
  "invalid_task_id",
  "invalid_tool_entry"
]);
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

export const TOOL_DISCOVERY_CONTROLLED_TASK_IDS = Object.freeze([
  "create-work-record",
  "validate-work-record",
  "validate-dispatch",
  "dispatch-worker",
  "dispatch-reviewer",
  "dispatch-redteam",
  "query-agent-run-status",
  "list-orchestrators",
  "start-orchestrator",
  "resume-orchestrator",
  "refresh-derived-evidence",
  "query-graph-impact",
  "search-wiki",
  "read-canonical",
  "cleanup-runtime-artifacts",
  "inspect-provenance",
  "summarize-work-record",
  "validate-docs-policy",
  "set-closure",
  "contract-edit",
  "persist-graph-impact-evidence",
  "record-review-attestation",
  "record-review-result-evidence",
  "generate-and-lint",
  "lint-repo",
  "coordination-preflight",
  "describe-runtime-blocker-taxonomy",
  "run-validation"
]);
const TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_ORDER = new Map(
  TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_VALUES.map((level, index) => [level, index])
);

const DEFAULT_DESCRIPTOR_PATH = TOOL_DISCOVERY_MANIFEST_PATH;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isInteger(value) {
  return Number.isInteger(value);
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = stableSortObject(value[key]);
  }
  return result;
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableSortObject(value))).digest("hex")}`;
}

function createDiagnostic(code, level, message, overrides = {}) {
  return {
    code,
    level,
    message,
    paths: Array.isArray(overrides.paths) ? overrides.paths : [],
    task_ids: Array.isArray(overrides.task_ids) ? overrides.task_ids : []
  };
}

function compareToolDiscoveryDiagnostics(left, right) {
  const leftLevel = TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_ORDER.get(left.level) ?? Number.POSITIVE_INFINITY;
  const rightLevel = TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_ORDER.get(right.level) ?? Number.POSITIVE_INFINITY;
  if (leftLevel !== rightLevel) {
    return leftLevel - rightLevel;
  }

  const codeCompare = left.code.localeCompare(right.code);
  if (codeCompare !== 0) {
    return codeCompare;
  }

  const leftPath = Array.isArray(left.paths) && left.paths.length > 0 ? left.paths[0] : "";
  const rightPath = Array.isArray(right.paths) && right.paths.length > 0 ? right.paths[0] : "";
  return leftPath.localeCompare(rightPath);
}

function sortToolDiscoveryDiagnostics(diagnostics) {
  return diagnostics.slice().sort(compareToolDiscoveryDiagnostics);
}

function validateEnumValue(diagnostics, value, values, path, field, code = "invalid_enum_value") {
  if (!values.includes(value)) {
    diagnostics.push(
      createDiagnostic(code, "error", `${path}.${field} must be one of: ${values.join(", ")}`, {
        paths: [`${path}.${field}`]
      })
    );
  }
}

function validateStringField(diagnostics, object, field, path, required = true) {
  if (!hasOwn(object, field)) {
    if (required) {
      diagnostics.push(
        createDiagnostic("missing_required_field", "error", `${path}.${field} is required`, {
          paths: [`${path}.${field}`]
        })
      );
    }
    return null;
  }

  const value = object[field];
  if (!isNonEmptyString(value)) {
    diagnostics.push(
      createDiagnostic("invalid_tool_entry", "error", `${path}.${field} must be a non-empty string`, {
        paths: [`${path}.${field}`]
      })
    );
    return null;
  }

  return value;
}

function validateStringArrayField(diagnostics, object, field, path, required = true) {
  if (!hasOwn(object, field)) {
    if (required) {
      diagnostics.push(
        createDiagnostic("missing_required_field", "error", `${path}.${field} is required`, {
          paths: [`${path}.${field}`]
        })
      );
    }
    return [];
  }

  const value = object[field];
  if (!Array.isArray(value)) {
    diagnostics.push(
      createDiagnostic("invalid_tool_entry", "error", `${path}.${field} must be an array`, {
        paths: [`${path}.${field}`]
      })
    );
    return [];
  }

  const normalized = [];
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      diagnostics.push(
        createDiagnostic(
          "invalid_tool_entry",
          "error",
          `${path}.${field}[${index}] must be a non-empty string`,
          { paths: [`${path}.${field}[${index}]`] }
        )
      );
      return;
    }
    normalized.push(entry);
  });
  return normalized;
}

function validateToolEntry(diagnostics, tool, index) {
  const path = `tools[${index}]`;
  if (!isObject(tool)) {
    diagnostics.push(createDiagnostic("invalid_tool_entry", "error", `${path} must be an object`, { paths: [path] }));
    return null;
  }

  const normalized = {};
  normalized.tool_name = validateStringField(diagnostics, tool, "tool_name", path);
  normalized.display_name = validateStringField(diagnostics, tool, "display_name", path);
  normalized.kind = validateStringField(diagnostics, tool, "kind", path);
  normalized.entrypoint = validateStringField(diagnostics, tool, "entrypoint", path);
  normalized.task_ids = validateStringArrayField(diagnostics, tool, "task_ids", path);
  normalized.install_state = validateStringField(diagnostics, tool, "install_state", path);
  normalized.runtime_posture = validateStringField(diagnostics, tool, "runtime_posture", path);
  normalized.recommended_route = validateStringField(diagnostics, tool, "recommended_route", path);
  normalized.priority = hasOwn(tool, "priority") ? tool.priority : null;
  normalized.side_effects = validateStringArrayField(diagnostics, tool, "side_effects", path);
  normalized.authority = validateStringArrayField(diagnostics, tool, "authority", path);
  normalized.tier_visibility = validateStringArrayField(diagnostics, tool, "tier_visibility", path);
  normalized.docs_refs = validateStringArrayField(diagnostics, tool, "docs_refs", path);
  normalized.source_files = validateStringArrayField(diagnostics, tool, "source_files", path);

  if (hasOwn(tool, "audience")) {
    if (!Array.isArray(tool.audience)) {
      diagnostics.push(
        createDiagnostic("invalid_tool_entry", "error", `${path}.audience must be an array when present`, {
          paths: [`${path}.audience`]
        })
      );
      normalized.audience = [];
    } else {
      normalized.audience = [];
      tool.audience.forEach((entry, entryIndex) => {
        if (!isNonEmptyString(entry)) {
          diagnostics.push(
            createDiagnostic(
              "invalid_tool_entry",
              "error",
              `${path}.audience[${entryIndex}] must be a non-empty string`,
              { paths: [`${path}.audience[${entryIndex}]`] }
            )
          );
          return;
        }
        if (!TOOL_DISCOVERY_AUDIENCE_VALUES.includes(entry)) {
          diagnostics.push(
            createDiagnostic("invalid_enum_value", "error", `${path}.audience[${entryIndex}] is not valid`, {
              paths: [`${path}.audience[${entryIndex}]`]
            })
          );
          return;
        }
        normalized.audience.push(entry);
      });
    }
  }

  if (hasOwn(tool, "notes") && tool.notes != null && !isNonEmptyString(tool.notes)) {
    diagnostics.push(
      createDiagnostic("invalid_tool_entry", "error", `${path}.notes must be a non-empty string when present`, {
        paths: [`${path}.notes`]
      })
    );
  }

  if (hasOwn(tool, "tier_text") && tool.tier_text != null) {
    if (!isObject(tool.tier_text)) {
      diagnostics.push(
        createDiagnostic("invalid_tool_entry", "error", `${path}.tier_text must be an object when present`, {
          paths: [`${path}.tier_text`]
        })
      );
    } else {
      for (const tierKey of Object.keys(tool.tier_text)) {
        if (!TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(tierKey)) {
          diagnostics.push(
            createDiagnostic("invalid_enum_value", "error", `${path}.tier_text.${tierKey} is not a controlled tier`, {
              paths: [`${path}.tier_text.${tierKey}`]
            })
          );
          continue;
        }
        const block = tool.tier_text[tierKey];
        if (!isObject(block)) {
          diagnostics.push(
            createDiagnostic("invalid_tool_entry", "error", `${path}.tier_text.${tierKey} must be an object`, {
              paths: [`${path}.tier_text.${tierKey}`]
            })
          );
          continue;
        }
        for (const field of Object.keys(block)) {
          if (!TOOL_DISCOVERY_TIER_TEXT_FIELDS.includes(field)) {
            diagnostics.push(
              createDiagnostic("invalid_tool_entry", "error", `${path}.tier_text.${tierKey}.${field} is not a tier-overridable field`, {
                paths: [`${path}.tier_text.${tierKey}.${field}`]
              })
            );
            continue;
          }
          if (!isNonEmptyString(block[field])) {
            diagnostics.push(
              createDiagnostic("invalid_tool_entry", "error", `${path}.tier_text.${tierKey}.${field} must be a non-empty string`, {
                paths: [`${path}.tier_text.${tierKey}.${field}`]
              })
            );
          }
        }
      }
    }
  }

  if (!isInteger(normalized.priority) || normalized.priority < 0) {
    diagnostics.push(
      createDiagnostic("invalid_priority", "error", `${path}.priority must be a non-negative integer`, {
        paths: [`${path}.priority`]
      })
    );
  }

  validateEnumValue(diagnostics, normalized.install_state, TOOL_DISCOVERY_INSTALL_STATE_VALUES, path, "install_state");
  validateEnumValue(
    diagnostics,
    normalized.runtime_posture,
    TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES,
    path,
    "runtime_posture"
  );
  validateEnumValue(
    diagnostics,
    normalized.recommended_route,
    TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES,
    path,
    "recommended_route"
  );

  for (let taskIndex = 0; taskIndex < normalized.task_ids.length; taskIndex += 1) {
    const taskId = normalized.task_ids[taskIndex];
    if (!TOOL_DISCOVERY_CONTROLLED_TASK_IDS.includes(taskId)) {
      diagnostics.push(
        createDiagnostic("invalid_task_id", "error", `${path}.task_ids[${taskIndex}] is not a controlled task id`, {
          paths: [`${path}.task_ids[${taskIndex}]`],
          task_ids: [taskId]
        })
      );
    }
  }

  for (const field of ["kind", "tool_name", "display_name", "entrypoint"]) {
    if (!isNonEmptyString(normalized[field])) {
      diagnostics.push(
        createDiagnostic("missing_required_field", "error", `${path}.${field} is required`, {
          paths: [`${path}.${field}`]
        })
      );
    }
  }

  for (const [field, values] of [
    ["side_effects", TOOL_DISCOVERY_SIDE_EFFECT_VALUES],
    ["authority", TOOL_DISCOVERY_AUTHORITY_VALUES],
    ["tier_visibility", TOOL_DISCOVERY_TIER_VISIBILITY_VALUES]
  ]) {
    normalized[field].forEach((entry, entryIndex) => {
      if (!values.includes(entry)) {
        diagnostics.push(
          createDiagnostic("invalid_enum_value", "error", `${path}.${field}[${entryIndex}] is not valid`, {
            paths: [`${path}.${field}[${entryIndex}]`]
          })
        );
      }
    });
  }

  return normalized;
}

function validateDescriptorShape(descriptor) {
  const diagnostics = [];
  if (!isObject(descriptor)) {
    diagnostics.push(createDiagnostic("invalid_tool_entry", "error", "descriptor must be an object", { paths: ["descriptor"] }));
    return diagnostics;
  }

  const schemaVersion = validateStringField(diagnostics, descriptor, "schema_version", "descriptor");
  if (schemaVersion != null && schemaVersion !== TOOL_DISCOVERY_SCHEMA_VERSION) {
    diagnostics.push(
      createDiagnostic(
        "invalid_schema_version",
        "error",
        `descriptor.schema_version must be ${TOOL_DISCOVERY_SCHEMA_VERSION}`,
        { paths: ["descriptor.schema_version"] }
      )
    );
  }

  validateStringField(diagnostics, descriptor, "repository", "descriptor");

  if (!hasOwn(descriptor, "tools")) {
    diagnostics.push(createDiagnostic("missing_tools", "error", "descriptor.tools is required", { paths: ["descriptor.tools"] }));
    return diagnostics;
  }

  if (!Array.isArray(descriptor.tools)) {
    diagnostics.push(
      createDiagnostic("invalid_tools_array", "error", "descriptor.tools must be an array", { paths: ["descriptor.tools"] })
    );
    return diagnostics;
  }

  const seenToolNames = new Set();
  const seenEntrypoints = new Set();
  for (let index = 0; index < descriptor.tools.length; index += 1) {
    const tool = validateToolEntry(diagnostics, descriptor.tools[index], index);
    if (!tool) {
      continue;
    }

    if (seenToolNames.has(tool.tool_name)) {
      diagnostics.push(
        createDiagnostic("duplicate_tool_name", "error", `tools[${index}].tool_name must be unique`, {
          paths: [`tools[${index}].tool_name`]
        })
      );
    } else {
      seenToolNames.add(tool.tool_name);
    }

    if (seenEntrypoints.has(tool.entrypoint)) {
      diagnostics.push(
        createDiagnostic("duplicate_entrypoint", "error", `tools[${index}].entrypoint must be unique`, {
          paths: [`tools[${index}].entrypoint`]
        })
      );
    } else {
      seenEntrypoints.add(tool.entrypoint);
    }
  }

  return diagnostics;
}

function normalizeDiscoveryQuery(query = {}) {
  if (!isObject(query)) {
    return {};
  }

  const normalized = {};
  if (isNonEmptyString(query.task_id)) {
    normalized.task_id = query.task_id;
  }
  if (isNonEmptyString(query.tool_name)) {
    normalized.tool_name = query.tool_name;
  }
  if (isNonEmptyString(query.audience) && TOOL_DISCOVERY_AUDIENCE_VALUES.includes(query.audience)) {
    normalized.audience = query.audience;
  }
  if (
    isNonEmptyString(query.registered_tier) &&
    TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(query.registered_tier)
  ) {
    normalized.registered_tier = query.registered_tier;
  }
  if (hasOwn(query, "limit") && Number.isInteger(query.limit) && query.limit > 0) {
    normalized.limit = query.limit;
  }
  return normalized;
}

export function resolveToolAudience(tool) {
  if (!isObject(tool)) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  if (!Array.isArray(tool.audience) || tool.audience.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  return tool.audience.filter((entry) => TOOL_DISCOVERY_AUDIENCE_VALUES.includes(entry));
}

export function resolveToolTierVisibility(tool) {
  if (!isObject(tool) || !Array.isArray(tool.tier_visibility) || tool.tier_visibility.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY.slice();
  }
  return tool.tier_visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry));
}

export function tierVisibilityAllows(visibility, registeredTier) {
  const set = Array.isArray(visibility)
    ? visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry))
    : [];
  if (set.length === 0) {
    return false;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE) {

    return true;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL) {
    return set.includes(TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL);
  }
  if (registeredTier === "operator_only") {
    return set.includes("operator_only");
  }
  return false;
}

export function projectToolDiscoveryEntryForTier(tool, registeredTier) {
  if (!isObject(tool)) {
    return tool;
  }
  const projected = cloneJson(tool);
  const tierText = isObject(tool.tier_text) ? tool.tier_text : null;
  if (hasOwn(projected, "tier_text")) {
    delete projected.tier_text;
  }
  const tier = TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(registeredTier)
    ? registeredTier
    : TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL;
  const overrides = tierText && isObject(tierText[tier]) ? tierText[tier] : null;
  if (overrides) {
    for (const field of TOOL_DISCOVERY_TIER_TEXT_FIELDS) {
      if (isNonEmptyString(overrides[field])) {
        projected[field] = overrides[field];
      }
    }
  }
  return projected;
}

function compareToolEntries(left, right) {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  const toolNameCompare = left.tool_name.localeCompare(right.tool_name);
  if (toolNameCompare !== 0) {
    return toolNameCompare;
  }

  return left.entrypoint.localeCompare(right.entrypoint);
}

export class ToolDiscoveryFragmentError extends Error {
  constructor(message, { code = "tool_discovery_fragment_error", path: errorPath = null, cause } = {}) {
    super(message);
    this.name = "ToolDiscoveryFragmentError";
    this.code = code;
    this.path = errorPath;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function isToolDiscoveryFragmentManifest(value) {
  return (
    isObject(value) &&
    (value.kind === TOOL_DISCOVERY_MANIFEST_KIND || Array.isArray(value.fragments))
  );
}

function validateToolDiscoveryManifestShape(manifest, manifestPath) {
  const fail = (message, field) =>
    new ToolDiscoveryFragmentError(`tool-discovery: ${message} (${manifestPath})`, {
      code: "invalid_manifest_shape",
      path: field ? `${manifestPath}#${field}` : manifestPath
    });

  if (!isObject(manifest)) {
    throw fail("fragment manifest must be a JSON object");
  }
  if (manifest.kind !== TOOL_DISCOVERY_MANIFEST_KIND) {
    throw fail(`fragment manifest kind must be ${TOOL_DISCOVERY_MANIFEST_KIND}`, "kind");
  }
  if (manifest.schema_version !== TOOL_DISCOVERY_SCHEMA_VERSION) {
    throw fail(`fragment manifest schema_version must be ${TOOL_DISCOVERY_SCHEMA_VERSION}`, "schema_version");
  }
  if (!isNonEmptyString(manifest.repository)) {
    throw fail("fragment manifest repository must be a non-empty string", "repository");
  }
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    throw fail("fragment manifest fragments must be a non-empty array", "fragments");
  }
  if (!isInteger(manifest.expected_tool_count) || manifest.expected_tool_count < 0) {
    throw fail("fragment manifest expected_tool_count must be a non-negative integer", "expected_tool_count");
  }

  const seenFiles = new Set();
  manifest.fragments.forEach((entry, index) => {
    if (!isObject(entry) || !isNonEmptyString(entry.file)) {
      throw fail("fragment manifest entry must declare a non-empty file", `fragments[${index}].file`);
    }
    if (!isInteger(entry.tool_count) || entry.tool_count < 0) {
      throw fail(
        `fragment manifest entry ${entry.file} tool_count must be a non-negative integer`,
        `fragments[${index}].tool_count`
      );
    }
    if (seenFiles.has(entry.file)) {
      throw fail(`fragment manifest lists ${entry.file} more than once`, `fragments[${index}].file`);
    }
    seenFiles.add(entry.file);
  });

  const declaredSum = manifest.fragments.reduce((total, entry) => total + entry.tool_count, 0);
  if (declaredSum !== manifest.expected_tool_count) {
    throw new ToolDiscoveryFragmentError(
      `tool-discovery: fragment manifest expected_tool_count ${manifest.expected_tool_count} does not match the sum of per-fragment tool_count values ${declaredSum} (${manifestPath})`,
      { code: "manifest_count_mismatch", path: manifestPath }
    );
  }
}

export function assembleToolDiscoveryDescriptor(
  manifest,
  fragmentsByFile,
  { manifestPath = TOOL_DISCOVERY_MANIFEST_PATH } = {}
) {
  validateToolDiscoveryManifestShape(manifest, manifestPath);

  const lookup =
    fragmentsByFile instanceof Map
      ? fragmentsByFile
      : new Map(Object.entries(isObject(fragmentsByFile) ? fragmentsByFile : {}));

  const tools = [];
  const seenToolNames = new Map();

  for (const manifestEntry of manifest.fragments) {
    const fragmentFile = manifestEntry.file;
    const fragmentPathRef = path.join(path.dirname(manifestPath), fragmentFile);

    if (!lookup.has(fragmentFile)) {
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: fragment ${fragmentFile} declared by the manifest was not provided`,
        { code: "missing_fragment_file", path: fragmentPathRef }
      );
    }

    const fragment = lookup.get(fragmentFile);
    const failShape = (message, field) =>
      new ToolDiscoveryFragmentError(`tool-discovery: ${message} (${fragmentPathRef})`, {
        code: "invalid_fragment_shape",
        path: field ? `${fragmentPathRef}#${field}` : fragmentPathRef
      });

    if (!isObject(fragment)) {
      throw failShape(`fragment ${fragmentFile} must be a JSON object`);
    }
    if (fragment.kind !== TOOL_DISCOVERY_FRAGMENT_KIND) {
      throw failShape(`fragment ${fragmentFile} kind must be ${TOOL_DISCOVERY_FRAGMENT_KIND}`, "kind");
    }
    if (fragment.schema_version !== TOOL_DISCOVERY_SCHEMA_VERSION) {
      throw failShape(
        `fragment ${fragmentFile} schema_version must be ${TOOL_DISCOVERY_SCHEMA_VERSION}`,
        "schema_version"
      );
    }
    if (isNonEmptyString(fragment.fragment) && fragment.fragment !== fragmentFile) {
      throw failShape(
        `fragment ${fragmentFile} self-identifies as ${fragment.fragment}`,
        "fragment"
      );
    }
    if (!Array.isArray(fragment.tools)) {
      throw failShape(`fragment ${fragmentFile} tools must be an array`, "tools");
    }
    if (isInteger(fragment.tool_count) && fragment.tool_count !== fragment.tools.length) {
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: fragment ${fragmentFile} self-declared tool_count ${fragment.tool_count} does not match its ${fragment.tools.length} tool entries (${fragmentPathRef})`,
        { code: "fragment_self_count_mismatch", path: fragmentPathRef }
      );
    }
    if (fragment.tools.length !== manifestEntry.tool_count) {
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: fragment ${fragmentFile} has ${fragment.tools.length} tool entries but the manifest declares ${manifestEntry.tool_count} (${fragmentPathRef})`,
        { code: "fragment_count_mismatch", path: fragmentPathRef }
      );
    }

    fragment.tools.forEach((tool, toolIndex) => {
      if (!isObject(tool) || !isNonEmptyString(tool.tool_name)) {
        throw new ToolDiscoveryFragmentError(
          `tool-discovery: fragment ${fragmentFile} tools[${toolIndex}] must be an object with a non-empty tool_name (${fragmentPathRef})`,
          { code: "invalid_tool_entry", path: `${fragmentPathRef}#tools[${toolIndex}]` }
        );
      }
      if (seenToolNames.has(tool.tool_name)) {
        throw new ToolDiscoveryFragmentError(
          `tool-discovery: duplicate tool_name "${tool.tool_name}" found in ${fragmentFile} and ${seenToolNames.get(tool.tool_name)}; each tool_name is owned by exactly one fragment (no last-writer-wins)`,
          { code: "duplicate_tool_name", path: fragmentPathRef }
        );
      }
      seenToolNames.set(tool.tool_name, fragmentFile);
      tools.push(tool);
    });
  }

  if (tools.length !== manifest.expected_tool_count) {
    throw new ToolDiscoveryFragmentError(
      `tool-discovery: assembled corpus has ${tools.length} tools but the manifest expected ${manifest.expected_tool_count}; refusing a partial-corpus descriptor`,
      { code: "corpus_count_mismatch", path: manifestPath }
    );
  }

  return {
    schema_version: manifest.schema_version,
    repository: manifest.repository,
    tools
  };
}

export async function assembleToolDiscoveryDescriptorFromManifest(
  manifest,
  { manifestPath = TOOL_DISCOVERY_MANIFEST_PATH } = {}
) {
  validateToolDiscoveryManifestShape(manifest, manifestPath);

  const fragmentDir = path.dirname(manifestPath);
  const fragmentsByFile = new Map();

  for (const manifestEntry of manifest.fragments) {
    const fragmentPath = path.join(fragmentDir, manifestEntry.file);
    let raw;
    try {
      raw = await readFile(fragmentPath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new ToolDiscoveryFragmentError(
          `tool-discovery: fragment ${manifestEntry.file} declared by the manifest is missing on disk`,
          { code: "missing_fragment_file", path: fragmentPath, cause: error }
        );
      }
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: unable to read fragment ${manifestEntry.file}: ${error.message}`,
        { code: "fragment_read_error", path: fragmentPath, cause: error }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: fragment ${manifestEntry.file} is not valid JSON: ${error.message}`,
        { code: "invalid_fragment_shape", path: fragmentPath, cause: error }
      );
    }

    fragmentsByFile.set(manifestEntry.file, parsed);
  }

  return assembleToolDiscoveryDescriptor(manifest, fragmentsByFile, { manifestPath });
}

export async function readToolDiscoveryDescriptorFile(descriptorPath = DEFAULT_DESCRIPTOR_PATH) {
  return readFile(descriptorPath, "utf8");
}

export async function loadToolDiscoveryDescriptor(descriptorPath = DEFAULT_DESCRIPTOR_PATH) {
  const raw = await readToolDiscoveryDescriptorFile(descriptorPath);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ToolDiscoveryFragmentError(
      `tool-discovery: descriptor source is not valid JSON: ${error.message}`,
      { code: "invalid_descriptor_source", path: descriptorPath, cause: error }
    );
  }

  if (isToolDiscoveryFragmentManifest(parsed)) {
    return assembleToolDiscoveryDescriptorFromManifest(parsed, { manifestPath: descriptorPath });
  }

  return parsed;
}

export function validateToolDiscoveryDescriptor(descriptor) {
  const diagnostics = sortToolDiscoveryDiagnostics(validateDescriptorShape(descriptor));
  return {
    valid: diagnostics.length === 0,
    diagnostics
  };
}

export function digestToolDiscoveryDescriptor(descriptor) {
  return digestJson(descriptor);
}

export function normalizeToolDiscoveryDescriptor(descriptor) {
  if (!descriptor) {
    return descriptor;
  }

  const normalized = cloneJson(descriptor);
  if (Array.isArray(normalized.tools)) {
    normalized.tools = normalized.tools.slice().sort(compareToolEntries);
  }
  return normalized;
}

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

  const total_count = allTools.length;
  const sliced = allTools.slice(0, limit);

  return {
    tools: sliced.map((tool, index) => ({ ...compactToolDiscoveryEntry(tool), rank: index + 1 })),
    total_count,
    limit_applied: limit,
    truncated: total_count > limit
  };
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
