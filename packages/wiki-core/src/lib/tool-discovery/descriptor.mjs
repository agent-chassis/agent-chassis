

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_DISCOVERY_SCHEMA_VERSION = "tool-discovery.v1";

const TOOL_DISCOVERY_DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data"
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
export const TOOL_DISCOVERY_TIER_VISIBILITY_VALUES = Object.freeze([
  "free_local",
  "paid_cce",
  "operator_only"
]);

export const TOOL_DISCOVERY_TIER_TEXT_FIELDS = Object.freeze(["notes", "summary"]);

export const AGENT_TOOL_CONFORMANCE_REQUIRED_ARRAY_FIELDS = Object.freeze([
  "task_ids",
  "side_effects",
  "authority",
  "tier_visibility",
  "use_when",
  "do_not_use_when",
  "authoritative_for"
]);
export const AGENT_TOOL_CONFORMANCE_REQUIRED_FIELDS = Object.freeze([
  ...AGENT_TOOL_CONFORMANCE_REQUIRED_ARRAY_FIELDS,
  "recommended_route",
  "recommended_first_call"
]);
export const AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD = "agent_tool_conformance_debt";
export const AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD = "agent_tool_token_budget_debt";
export const AGENT_TOOL_TOKEN_BUDGET_KEYS = Object.freeze([
  "live_paid_operator_descriptions",
  "raw_discovery_notes"
]);

export const AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS = 1500;
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

export const TOOL_DISCOVERY_CONTROLLED_TASK_IDS = Object.freeze([
  "create-work-record",
  "validate-work-record",
  "validate-dispatch",
  "dispatch-worker",
  "dispatch-reviewer",
  "dispatch-redteam",
  "query-agent-run-status",
  "query-terminal-review-candidate",
  "advance-terminal-review-candidate",
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
  "controlled-contract-authoring",
  "acceptance-gap-review",
  "mapping-repair",
  "obligation-inventory",
  "proof-obligation-map-inspection",
  "controlled-contract-proof-selection",
  "controlled-contract-proof-plan",
  "controlled-contract-assessment",
  "persist-graph-impact-evidence",
  "generate-and-lint",
  "lint-repo",
  "coordination-preflight",
  "describe-runtime-blocker-taxonomy",
  "run-validation",
  "worker-delivery"
]);
const TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_ORDER = new Map(
  TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_VALUES.map((level, index) => [level, index])
);

export const DEFAULT_DESCRIPTOR_PATH = TOOL_DISCOVERY_MANIFEST_PATH;

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function isInteger(value) {
  return Number.isInteger(value);
}

export function normalizeStringList(value) {
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

export function digestToolDiscoveryEntry(entry) {
  return digestJson(entry);
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

export function sortToolDiscoveryDiagnostics(diagnostics) {
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

function validateOptionalRoutingMetadata(diagnostics, tool, path) {
  for (const field of ["use_when", "do_not_use_when", "authoritative_for", "requires_prior_state"]) {
    if (hasOwn(tool, field)) {
      validateStringArrayField(diagnostics, tool, field, path, false);
    }
  }

  if (hasOwn(tool, "recommended_first_call")) {
    const value = tool.recommended_first_call;
    if (!isObject(value)) {
      diagnostics.push(
        createDiagnostic("invalid_tool_entry", "error", `${path}.recommended_first_call must be an object`, {
          paths: [`${path}.recommended_first_call`]
        })
      );
    } else {
      if (hasOwn(value, "routing_intents")) {
        validateStringArrayField(diagnostics, value, "routing_intents", `${path}.recommended_first_call`, false);
      }
      if (hasOwn(value, "operation") && !isNonEmptyString(value.operation)) {
        diagnostics.push(
          createDiagnostic(
            "invalid_tool_entry",
            "error",
            `${path}.recommended_first_call.operation must be a non-empty string when present`,
            { paths: [`${path}.recommended_first_call.operation`] }
          )
        );
      }
      if (hasOwn(value, "arguments") && !isObject(value.arguments)) {
        diagnostics.push(
          createDiagnostic(
            "invalid_tool_entry",
            "error",
            `${path}.recommended_first_call.arguments must be an object when present`,
            { paths: [`${path}.recommended_first_call.arguments`] }
          )
        );
      }
      if (
        !hasOwn(value, "routing_intents") &&
        !hasOwn(value, "operation") &&
        !hasOwn(value, "arguments")
      ) {
        diagnostics.push(
          createDiagnostic(
            "invalid_tool_entry",
            "error",
            `${path}.recommended_first_call must declare routing_intents, operation, or arguments`,
            { paths: [`${path}.recommended_first_call`] }
          )
        );
      }
    }
  }

  if (hasOwn(tool, "replacement_for_misuse")) {
    if (!Array.isArray(tool.replacement_for_misuse)) {
      diagnostics.push(
        createDiagnostic("invalid_tool_entry", "error", `${path}.replacement_for_misuse must be an array`, {
          paths: [`${path}.replacement_for_misuse`]
        })
      );
    } else {
      tool.replacement_for_misuse.forEach((replacement, index) => {
        const replacementPath = `${path}.replacement_for_misuse[${index}]`;
        if (!isObject(replacement)) {
          diagnostics.push(
            createDiagnostic("invalid_tool_entry", "error", `${replacementPath} must be an object`, {
              paths: [replacementPath]
            })
          );
          return;
        }
        for (const field of ["misuse_code", "routing_intent", "use_instead"]) {
          validateStringField(diagnostics, replacement, field, replacementPath);
        }
      });
    }
  }
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

  validateOptionalRoutingMetadata(diagnostics, tool, path);

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

export function compareToolEntries(left, right) {
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

export function validateToolDiscoveryManifestShape(
  manifest,
  manifestPath,
  { requireAgentToolConformanceDebt = false } = {}
) {
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

  const debt = manifest[AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD];
  if (!isObject(debt)) {
    if (!requireAgentToolConformanceDebt && debt === undefined) {
      return;
    }
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD} must be an object`,
      AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD
    );
  }
  for (const field of [
    "owner",
    "target_wk",
    "retirement_evidence",
    "baseline_descriptor_digest",
    "baseline_entry_names_digest",
    "baseline_entry_digests_digest",
    "compatibility_alias_records_digest"
  ]) {
    if (!isNonEmptyString(debt[field])) {
      throw fail(
        `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.${field} must be a non-empty string`,
        `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.${field}`
      );
    }
  }
  if (!/^WK-\d{4,}$/u.test(debt.target_wk)) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.target_wk must be a WK id`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.target_wk`
    );
  }
  for (const field of [
    "baseline_descriptor_digest",
    "baseline_entry_names_digest",
    "baseline_entry_digests_digest",
    "compatibility_alias_records_digest"
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(debt[field])) {
      throw fail(
        `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.${field} must be a sha256 digest`,
        `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.${field}`
      );
    }
  }
  if (!isObject(debt.baseline_entry_digests)) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests must be an object`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests`
    );
  }
  for (const [toolName, digest] of Object.entries(debt.baseline_entry_digests)) {
    if (!isNonEmptyString(toolName) || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw fail(
        `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests must map tool names to sha256 digests`,
        `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests.${toolName}`
      );
    }
  }
  const baselineEntryNamesDigest = digestJson(Object.keys(debt.baseline_entry_digests).sort());
  if (baselineEntryNamesDigest !== debt.baseline_entry_names_digest) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_names_digest does not match the exact baseline name set`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_names_digest`
    );
  }
  const baselineEntryDigestsDigest = digestJson(debt.baseline_entry_digests);
  if (baselineEntryDigestsDigest !== debt.baseline_entry_digests_digest) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests_digest does not match the exact baseline entry map`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.baseline_entry_digests_digest`
    );
  }
  if (!isObject(debt.compatibility_aliases)) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_aliases must be an object`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_aliases`
    );
  }
  const aliasRecordFields = [
    "compatibility_evidence",
    "owner",
    "replacement_route",
    "review_date",
    "target_wk"
  ];
  for (const [toolName, record] of Object.entries(debt.compatibility_aliases)) {
    if (
      !isNonEmptyString(toolName) ||
      !isObject(record) ||
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(aliasRecordFields) ||
      !isNonEmptyString(record.owner) ||
      !/^WK-\d{4,}$/u.test(record.target_wk) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(record.review_date) ||
      Number.isNaN(Date.parse(`${record.review_date}T00:00:00Z`)) ||
      new Date(`${record.review_date}T00:00:00Z`).toISOString().slice(0, 10) !== record.review_date ||
      !isNonEmptyString(record.replacement_route) ||
      !isNonEmptyString(record.compatibility_evidence) ||
      !Object.hasOwn(debt.baseline_entry_digests, toolName)
    ) {
      throw fail(
        `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_aliases must map baseline tool names to complete owner-bound alias records`,
        `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_aliases.${toolName}`
      );
    }
  }
  if (digestJson(debt.compatibility_aliases) !== debt.compatibility_alias_records_digest) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_alias_records_digest does not match the exact alias records`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.compatibility_alias_records_digest`
    );
  }
  if (!Array.isArray(debt.applicability_exceptions) || debt.applicability_exceptions.length !== 0) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.applicability_exceptions must remain an empty array until an adopted owner defines an exception protocol`,
      `${AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD}.applicability_exceptions`
    );
  }

  const budgetDebt = manifest[AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD];
  if (!isObject(budgetDebt)) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD} must be an object`,
      AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD
    );
  }
  if (!isNonEmptyString(budgetDebt.owner) || !/^WK-\d{4,}$/u.test(budgetDebt.target_wk)) {
    throw fail(
      `fragment manifest ${AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD} must name an owner and target WK`,
      AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD
    );
  }
  for (const budgetKey of AGENT_TOOL_TOKEN_BUDGET_KEYS) {
    const budget = budgetDebt[budgetKey];
    const budgetPath = `${AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD}.${budgetKey}`;
    if (!isObject(budget)) {
      throw fail(`fragment manifest ${budgetPath} must be an object`, budgetPath);
    }
    for (const field of ["target_ceiling", "baseline_total", "baseline_denominator"]) {
      if (!isInteger(budget[field]) || budget[field] < 0) {
        throw fail(`fragment manifest ${budgetPath}.${field} must be a non-negative integer`, `${budgetPath}.${field}`);
      }
    }
    if (budget.target_ceiling >= budget.baseline_total) {
      throw fail(`fragment manifest ${budgetPath} must represent actual outstanding excess`, budgetPath);
    }
    if (budget.measurement_unit !== "javascript_string_characters" || !isNonEmptyString(budget.surface)) {
      throw fail(`fragment manifest ${budgetPath} must identify its exact surface and character unit`, budgetPath);
    }
    if (!isObject(budget.baseline_lengths) || !/^sha256:[a-f0-9]{64}$/u.test(budget.baseline_lengths_digest)) {
      throw fail(`fragment manifest ${budgetPath} must carry an integrity-pinned baseline length map`, budgetPath);
    }
    for (const [toolName, length] of Object.entries(budget.baseline_lengths)) {
      if (!isNonEmptyString(toolName) || !isInteger(length) || length <= 0) {
        throw fail(`fragment manifest ${budgetPath}.baseline_lengths must map tool names to positive lengths`, `${budgetPath}.baseline_lengths.${toolName}`);
      }
    }
    const baselineTotal = Object.values(budget.baseline_lengths).reduce((sum, length) => sum + length, 0);
    if (baselineTotal !== budget.baseline_total || Object.keys(budget.baseline_lengths).length !== budget.baseline_denominator) {
      throw fail(`fragment manifest ${budgetPath} baseline total or denominator does not match its exact length map`, budgetPath);
    }
    if (digestJson(budget.baseline_lengths) !== budget.baseline_lengths_digest) {
      throw fail(`fragment manifest ${budgetPath}.baseline_lengths_digest does not match the exact baseline length map`, `${budgetPath}.baseline_lengths_digest`);
    }
  }
}

export async function loadToolDiscoveryManifest(manifestPath = TOOL_DISCOVERY_MANIFEST_PATH) {
  const raw = await readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new ToolDiscoveryFragmentError(
      `tool-discovery: fragment manifest is not valid JSON: ${error.message}`,
      { code: "invalid_manifest_shape", path: manifestPath, cause: error }
    );
  }
  validateToolDiscoveryManifestShape(manifest, manifestPath, {
    requireAgentToolConformanceDebt: true
  });
  return manifest;
}

function missingAgentToolConformanceControls(tool) {
  const missing = [];
  for (const field of AGENT_TOOL_CONFORMANCE_REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(tool?.[field]) || tool[field].length === 0) {
      missing.push(field);
    }
  }
  if (!isNonEmptyString(tool?.recommended_route)) {
    missing.push("recommended_route");
  }
  if (!isObject(tool?.recommended_first_call) || Object.keys(tool.recommended_first_call).length === 0) {
    missing.push("recommended_first_call");
  }
  return missing;
}

export function evaluateAgentToolConformance(descriptor, manifest, { accessPolicy = null } = {}) {
  const debt = manifest?.[AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD];
  const baselineDigests = isObject(debt?.baseline_entry_digests)
    ? debt.baseline_entry_digests
    : {};
  const compatibilityAliases = isObject(debt?.compatibility_aliases)
    ? debt.compatibility_aliases
    : {};
  const access = isObject(accessPolicy?.access) ? accessPolicy.access : null;
  const applicable = (Array.isArray(descriptor?.tools) ? descriptor.tools : []).filter((tool) =>
    tool?.kind === "mcp_tool" &&
    tool.install_state === "installed" &&
    tool.runtime_posture === "supported" &&
    (!access || (Array.isArray(access[tool.tool_name]) && access[tool.tool_name].length > 0))
  );
  const byName = new Map(applicable.map((tool) => [tool.tool_name, tool]));
  const missingControls = new Map();
  for (const tool of applicable) {
    const missing = missingAgentToolConformanceControls(tool);
    if (missing.length > 0) {
      missingControls.set(tool.tool_name, missing);
    }
  }

  const debtAdded = [];
  const debtRetired = [];
  const remainingToolNames = [];
  for (const toolName of missingControls.keys()) {
    const tool = byName.get(toolName);
    const baselineDigest = baselineDigests[toolName];
    if (!baselineDigest || digestToolDiscoveryEntry(tool) !== baselineDigest) {
      debtAdded.push(toolName);
    } else {
      remainingToolNames.push(toolName);
    }
  }
  for (const toolName of Object.keys(baselineDigests)) {
    const tool = byName.get(toolName);
    if (Object.hasOwn(compatibilityAliases, toolName)) {
      const aliasRecord = compatibilityAliases[toolName];
      if (!tool) {
        debtRetired.push(toolName);
      } else if (
        digestToolDiscoveryEntry(tool) !== baselineDigests[toolName] ||
        tool.compatibility_alias_for !== aliasRecord.replacement_route ||
        !byName.has(aliasRecord.replacement_route)
      ) {
        debtAdded.push(toolName);
      } else {
        remainingToolNames.push(toolName);
      }
    } else if (tool && !missingControls.has(toolName)) {
      debtRetired.push(toolName);
    } else if (!tool) {
      debtRetired.push(toolName);
    }
  }

  debtAdded.sort();
  debtRetired.sort();
  remainingToolNames.sort();
  return {
    debt_total: remainingToolNames.length,
    debt_added: [...new Set(debtAdded)].sort(),
    debt_retired: debtRetired,
    remaining_tool_names: remainingToolNames,
    owner: debt?.owner ?? null,
    target_wk: debt?.target_wk ?? null,
    retirement_evidence: debt?.retirement_evidence ?? null,
    compatibility_alias_debt_total: remainingToolNames.filter((toolName) =>
      Object.hasOwn(compatibilityAliases, toolName)
    ).length,
    compatibility_alias_remaining: remainingToolNames.filter((toolName) =>
      Object.hasOwn(compatibilityAliases, toolName)
    ),
    compatibility_alias_retired: debtRetired.filter((toolName) =>
      Object.hasOwn(compatibilityAliases, toolName)
    ),
    compatibility_alias_records: compatibilityAliases,
    applicable_tool_count: applicable.length,
    missing_controls: Object.fromEntries(
      [...missingControls.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    registration_eligible_tool_names: applicable
      .filter((tool) => !missingControls.has(tool.tool_name) || remainingToolNames.includes(tool.tool_name))
      .map((tool) => tool.tool_name)
      .sort()
  };
}

function evaluateTokenBudget(currentLengths, budget, owner, targetWk) {
  const baselineLengths = budget.baseline_lengths;
  const names = new Set([...Object.keys(baselineLengths), ...Object.keys(currentLengths)]);
  let debtAdded = 0;
  let debtRetired = 0;
  const addedEntryNames = [];
  const retiredEntryNames = [];
  for (const name of names) {
    const baseline = baselineLengths[name] ?? 0;
    const current = currentLengths[name] ?? 0;
    if (current > baseline) {
      debtAdded += current - baseline;
      addedEntryNames.push(name);
    } else if (current < baseline) {
      debtRetired += baseline - current;
      retiredEntryNames.push(name);
    }
  }
  const currentValue = Object.values(currentLengths).reduce((sum, length) => sum + length, 0);
  return {
    target: budget.target_ceiling,
    current_value: currentValue,
    denominator: Object.keys(currentLengths).length,
    baseline_value: budget.baseline_total,
    baseline_denominator: budget.baseline_denominator,
    debt_added: debtAdded,
    debt_retired: debtRetired,
    added_entry_names: addedEntryNames.sort(),
    retired_entry_names: retiredEntryNames.sort(),
    owner,
    target_wk: targetWk,
    remaining_excess: Math.max(0, currentValue - budget.target_ceiling),
    within_target: currentValue <= budget.target_ceiling,
    growth_free: debtAdded === 0,
    measurement_unit: budget.measurement_unit,
    surface: budget.surface
  };
}

export function evaluateAgentToolTokenBudgetDebt(
  descriptor,
  manifest,
  { liveDescriptions = null } = {}
) {
  const debt = manifest[AGENT_TOOL_TOKEN_BUDGET_DEBT_MANIFEST_FIELD];
  const notesLengths = Object.fromEntries(
    (Array.isArray(descriptor?.tools) ? descriptor.tools : [])
      .filter((tool) => isNonEmptyString(tool?.notes))
      .map((tool) => [tool.tool_name, tool.notes.length])
  );
  const report = {
    raw_discovery_notes: evaluateTokenBudget(
      notesLengths,
      debt.raw_discovery_notes,
      debt.owner,
      debt.target_wk
    )
  };
  if (liveDescriptions !== null) {
    const descriptionLengths = Object.fromEntries(
      liveDescriptions
        .filter((entry) => isNonEmptyString(entry?.name) && isNonEmptyString(entry?.description))
        .map((entry) => [entry.name, entry.description.length])
    );
    report.live_paid_operator_descriptions = evaluateTokenBudget(
      descriptionLengths,
      debt.live_paid_operator_descriptions,
      debt.owner,
      debt.target_wk
    );
  }
  return report;
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
    const descriptor = await assembleToolDiscoveryDescriptorFromManifest(parsed, {
      manifestPath: descriptorPath
    });
    const validation = validateToolDiscoveryDescriptor(descriptor);
    if (isObject(parsed[AGENT_TOOL_CONFORMANCE_DEBT_MANIFEST_FIELD]) && !validation.valid) {
      throw new ToolDiscoveryFragmentError(
        `tool-discovery: assembled descriptor contains invalid tool metadata: ${validation.diagnostics
          .map((diagnostic) => diagnostic.paths[0] ?? diagnostic.code)
          .join(", ")}`,
        { code: "invalid_tool_entry", path: descriptorPath }
      );
    }
    return descriptor;
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
