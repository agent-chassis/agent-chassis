import { createHash } from "node:crypto";

import { canonicalizeJson } from "@agent-chassis/agent-launch-core/src/lib/role-guard.mjs";

export const AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION = "agent-child-tool-surface.v1";
export const AGENT_CHILD_TOOL_SURFACE_REFUSAL_SCHEMA_VERSION = "agent-child-tool-surface-refusal.v1";
export const LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION =
  "workspace-agent-dispatch-source-tool-surface.v1";

export const SOURCE_TOOL_SURFACE_NOT_CONFIGURED_SCHEMA_VERSION =
  "workspace-agent-dispatch-source-tool-surface-not-configured.v1";

export const AGENT_CHILD_TOOL_SURFACE_SUPPORTED_ROLES = Object.freeze(["worker", "reviewer", "redteam"]);
export const AGENT_CHILD_TOOL_SURFACE_READ_ONLY_ROLES = Object.freeze(["reviewer", "redteam"]);

export const AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES = Object.freeze({
  apply_from_scratch: "filesystem_mcp.apply_from_scratch",
  read: "filesystem_mcp.read",
  write: "filesystem_mcp.write",
  structured_validation: "filesystem_mcp.structured_validation",
  final_report: "filesystem_mcp.final_report"
});

const WORKER_APPLY_FROM_SCRATCH_TOOL_CONTRACT = Object.freeze({
  surface: AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.apply_from_scratch,
  scratch_source: "launcher_minted_scratch",
  write_scope_target: "canonical_write_scope_target",
  target_mode: "exact_file",
  apply_mode: "in_place",
  generated_view_targets: "reject_unless_explicitly_supported",
  parent_directory_authority: false,
  prompt_only_authority: false
});

const WORKER_SCOPED_TOOL_CONTRACTS = Object.freeze({
  apply_from_scratch: WORKER_APPLY_FROM_SCRATCH_TOOL_CONTRACT
});

export const AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS = Object.freeze({
  node_check: Object.freeze({
    operation: "node_check",
    node_flag: "--check",
    executes_target: false,
    execution_context: "parse_only_zero_ace"
  }),
  node_test: Object.freeze({
    operation: "node_test",
    node_flag: "--test",
    executes_target: true,
    execution_context: "worker_confined_read_only_secret_masked_net_less"
  })
});

const STRUCTURED_VALIDATION_CONTRACT = Object.freeze({
  surface: AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.structured_validation,
  raw_exec_enabled: false,
  argv_authority: "launcher_owned",
  shell: false,
  target_authority: "unit_declared_validation_only",
  execution_context: "worker_confined_read_only_secret_masked_net_less",
  operations: AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS
});

export const CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME = "filesystem_mcp";
export const CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT = "stdio";
export const CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV =
  "AGENT_LAUNCH_SOURCE_TOOL_SURFACE_DIGEST";
export const CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV =
  "AGENT_LAUNCH_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST";
export const CODEX_SOURCE_TOOL_SURFACE_RAW_EXEC_ENV =
  "AGENT_LAUNCH_SOURCE_TOOL_SURFACE_RAW_EXEC";

export const AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS = Object.freeze([
  "Bash",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Write",
  "exec_command"
]);

const FORBIDDEN_STOCK_TOOL_SET = new Set(AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS);
const TOOL_NAME_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)(?:\(.*\))?$/;

export const AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES = Object.freeze({
  INVALID_INPUT: "agent_child_tool_surface.invalid_input.v1",
  INVALID_ROLE: "agent_child_tool_surface.invalid_role.v1",
  RAW_EXEC_FORBIDDEN: "agent_child_tool_surface.raw_exec_forbidden.v1",
  WRITE_FORBIDDEN_FOR_ROLE: "agent_child_tool_surface.write_forbidden_for_role.v1",
  READ_SCOPE_INVALID: "agent_child_tool_surface.read_scope_invalid.v1",
  WRITE_SCOPE_INVALID: "agent_child_tool_surface.write_scope_invalid.v1",
  VALIDATION_INVALID: "agent_child_tool_surface.validation_invalid.v1",
  PROVENANCE_INVALID: "agent_child_tool_surface.provenance_invalid.v1",
  HANDSHAKE_TOOL_SURFACE_MISMATCH: "agent_child_tool_surface.handshake_tool_surface_mismatch.v1",
  STOCK_TOOL_IN_ARGV: "agent_child_tool_surface.stock_tool_in_argv.v1",
  DESCRIPTOR_INVALID: "agent_child_tool_surface.descriptor_invalid.v1",
  SOURCE_SURFACE_INVALID: "agent_child_tool_surface.source_surface_invalid.v1",
  SOURCE_SURFACE_NOT_PROVEN: "agent_child_tool_surface.source_surface_not_proven.v1",
  CODEX_CALLABLE_SURFACE_UNAVAILABLE: "agent_child_tool_surface.codex_callable_surface_unavailable.v1",
  LAUNCHER_RUNTIME_STATE_UNAVAILABLE: "agent_child_tool_surface.launcher_runtime_state_unavailable.v1"
});

const SUPPORTED_VALIDATION_TRANSPORTS = Object.freeze(["argv", "named", "unsupported"]);
const SUPPORTED_PROVENANCE_SINKS = Object.freeze(["launcher_owned"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function buildRefusal(code, message, detail = null) {
  const refusal = {
    schema_version: AGENT_CHILD_TOOL_SURFACE_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: code,
    refusal_message: message
  };
  if (detail !== null) {
    refusal.detail = detail;
  }
  return Object.freeze(refusal);
}

function normalizeStringList(value, pathLabel) {
  if (!Array.isArray(value)) {
    return { ok: false, message: `${pathLabel} must be an array`, normalized: null };
  }
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string" || entry.trim() === "") {
      return {
        ok: false,
        message: `${pathLabel}[${index}] must be a non-empty string`,
        normalized: null
      };
    }
    normalized.push(entry);
  }
  const deduped = Array.from(new Set(normalized));
  deduped.sort();
  return { ok: true, message: null, normalized: deduped };
}

function normalizeScopedToolNames(writeEnabled) {
  const scopedToolNames = [
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.final_report,
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.read,
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.structured_validation
  ];
  if (writeEnabled) {
    scopedToolNames.push(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.apply_from_scratch);
    scopedToolNames.push(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.write);
  }
  scopedToolNames.sort();
  return scopedToolNames;
}

function deriveValidationTransport(validationPolicy) {
  if (!isPlainObject(validationPolicy)) {
    return null;
  }
  const commands = Array.isArray(validationPolicy.commands) ? validationPolicy.commands : null;
  if (!commands || commands.length === 0) {
    return null;
  }
  const forms = new Set();
  for (const command of commands) {
    if (!isPlainObject(command)) {
      return null;
    }
    if (command.form === "argv" || command.form === "named") {
      forms.add(command.form);
      continue;
    }
    return null;
  }
  if (forms.size === 1) {
    return forms.values().next().value;
  }
  return "argv";
}

function computeDescriptorDigest(payload) {
  const canonical = canonicalizeJson(payload);
  return `sha256:${createHash("sha256").update(canonical).digest("base64url")}`;
}

export function buildScopedChildToolSurfaceDescriptor(input) {
  if (!isPlainObject(input)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
      "buildScopedChildToolSurfaceDescriptor requires an object input"
    );
  }

  const role = isNonEmptyString(input.role) ? input.role.trim() : null;
  if (!role || !AGENT_CHILD_TOOL_SURFACE_SUPPORTED_ROLES.includes(role)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_ROLE,
      "role must be one of worker, reviewer, redteam"
    );
  }

  if (input.raw_exec_enabled === true) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "scoped child tool surface descriptors must report raw_exec_enabled false"
    );
  }
  if (input.raw_exec_enabled !== false && input.raw_exec_enabled !== undefined) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "raw_exec_enabled must be the boolean false"
    );
  }

  const readScopeResult = normalizeStringList(input.read_scope, "read_scope");
  if (!readScopeResult.ok) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.READ_SCOPE_INVALID,
      readScopeResult.message
    );
  }

  const writeScopeResult = normalizeStringList(input.write_scope, "write_scope");
  if (!writeScopeResult.ok) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.WRITE_SCOPE_INVALID,
      writeScopeResult.message
    );
  }

  const isReadOnlyRole = AGENT_CHILD_TOOL_SURFACE_READ_ONLY_ROLES.includes(role);
  if (isReadOnlyRole && writeScopeResult.normalized.length > 0) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.WRITE_FORBIDDEN_FOR_ROLE,
      `role ${role} must launch with an empty write_scope`,
      { supplied_write_scope: writeScopeResult.normalized }
    );
  }

  const validationPolicy = input.validation_policy;
  const validationTransport = deriveValidationTransport(validationPolicy);
  if (!validationTransport || !SUPPORTED_VALIDATION_TRANSPORTS.includes(validationTransport)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.VALIDATION_INVALID,
      "validation_policy.commands must be a non-empty list of {form: argv|named} entries"
    );
  }

  const provenance = input.provenance_destination;
  if (!isPlainObject(provenance) || !isNonEmptyString(provenance.kind)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.PROVENANCE_INVALID,
      "provenance_destination.kind is required"
    );
  }
  const provenanceSink = provenance.kind.trim();
  if (!SUPPORTED_PROVENANCE_SINKS.includes(provenanceSink)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.PROVENANCE_INVALID,
      `provenance_destination.kind ${provenanceSink} is not a launcher-owned sink`
    );
  }

  const writeEnabled = !isReadOnlyRole;

  const toolSurface = {
    read: true,
    write: writeEnabled,
    structured_validation: true,
    final_report: true
  };

  const scopedToolNames = normalizeScopedToolNames(writeEnabled);

  const disallowedTools = [...AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS];
  disallowedTools.sort();

  const effectiveWriteScope = writeEnabled ? writeScopeResult.normalized : [];

  const partial = {
    schema_version: AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION,
    role,
    raw_exec_enabled: false,
    read_scope: readScopeResult.normalized,
    write_scope: effectiveWriteScope,
    scoped_tool_names: scopedToolNames,
    disallowed_tools: disallowedTools,
    tool_surface: toolSurface,
    validation_transport: validationTransport,
    structured_validation_contract: STRUCTURED_VALIDATION_CONTRACT,
    provenance_sink: provenanceSink,
    ...(writeEnabled ? { scoped_tool_contracts: WORKER_SCOPED_TOOL_CONTRACTS } : {})
  };

  const descriptor = Object.freeze({
    ...partial,
    accepted: true,
    descriptor_digest: computeDescriptorDigest(partial)
  });

  return descriptor;
}

export function matchHandshakeToolSurface({ descriptor, handshakeToolSurface } = {}) {
  if (!isPlainObject(descriptor) || descriptor.schema_version !== AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      `descriptor schema_version must be ${AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION}`
    );
  }
  if (!isPlainObject(handshakeToolSurface)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
      "handshake tool_surface must be an object"
    );
  }

  const expectedKeys = ["read", "write", "structured_validation", "final_report"];
  for (const key of expectedKeys) {
    if (typeof handshakeToolSurface[key] !== "boolean") {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
        `handshake tool_surface.${key} must be a boolean`
      );
    }
    if (handshakeToolSurface[key] !== descriptor.tool_surface[key]) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
        `handshake tool_surface.${key} does not match descriptor tool_surface.${key}`,
        {
          descriptor_tool_surface: descriptor.tool_surface,
          handshake_tool_surface: { ...handshakeToolSurface }
        }
      );
    }
  }

  for (const key of Object.keys(handshakeToolSurface)) {
    if (!expectedKeys.includes(key)) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH,
        `handshake tool_surface includes unsupported field: ${key}`
      );
    }
  }

  return descriptor;
}

const TOOL_ALLOWLIST_FLAGS = new Set([
  "--allowedTools",
  "--allowed-tools",
  "--tools",
  "--add-allowed-tools",
  "--addAllowedTools"
]);

const PERMISSION_BYPASS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--dangerously-skip-permission-checks"
]);

export function refuseStockToolsInChildArgv({ argv } = {}) {
  if (!Array.isArray(argv)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.STOCK_TOOL_IN_ARGV,
      "argv must be an array"
    );
  }

  const matchedTools = [];
  const normalizeToolName = (part) => {
    const match = TOOL_NAME_PATTERN.exec(part);
    return match ? match[1] : part;
  };
  const collect = (token) => {
    if (typeof token !== "string") {
      return;
    }
    const parts = token.split(",").map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const normalized = normalizeToolName(part);
      if (FORBIDDEN_STOCK_TOOL_SET.has(normalized)) {
        matchedTools.push(normalized);
      }
    }
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (typeof arg !== "string") {
      index += 1;
      continue;
    }
    if (PERMISSION_BYPASS_FLAGS.has(arg)) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.STOCK_TOOL_IN_ARGV,
        `child argv must not bypass tool permissions via ${arg}`
      );
    }
    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0 && arg.startsWith("--")) {
      const flag = arg.slice(0, eqIndex);
      const value = arg.slice(eqIndex + 1);
      if (TOOL_ALLOWLIST_FLAGS.has(flag)) {
        collect(value);
      }
      index += 1;
      continue;
    }
    if (TOOL_ALLOWLIST_FLAGS.has(arg)) {
      collect(argv[index + 1]);
      index += 2;
      continue;
    }
    index += 1;
  }

  if (matchedTools.length > 0) {
    const unique = Array.from(new Set(matchedTools)).sort();
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.STOCK_TOOL_IN_ARGV,
      `child argv exposes forbidden stock tool(s) as the read/write boundary: ${unique.join(", ")}`,
      { stock_tools: unique }
    );
  }

  return { schema_version: AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION, accepted: true };
}

export function isScopedChildToolSurfaceRefusal(value) {
  return (
    isPlainObject(value) &&
    value.schema_version === AGENT_CHILD_TOOL_SURFACE_REFUSAL_SCHEMA_VERSION &&
    value.accepted === false &&
    typeof value.refusal_code === "string"
  );
}

export function buildSourceToolSurfaceNotConfigured(detail = null) {
  const marker = {
    schema_version: SOURCE_TOOL_SURFACE_NOT_CONFIGURED_SCHEMA_VERSION,
    configured: false,
    accepted: false
  };
  if (isPlainObject(detail)) {
    marker.detail = Object.freeze({ ...detail });
  }
  return Object.freeze(marker);
}

const SOURCE_TOOL_SURFACE_NOT_CONFIGURED_KEYS = new Set([
  "schema_version",
  "configured",
  "accepted",
  "detail"
]);

export function isSourceToolSurfaceNotConfigured(value) {
  if (
    !isPlainObject(value) ||
    value.schema_version !== SOURCE_TOOL_SURFACE_NOT_CONFIGURED_SCHEMA_VERSION ||
    value.configured !== false ||
    value.accepted !== false
  ) {
    return false;
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!SOURCE_TOOL_SURFACE_NOT_CONFIGURED_KEYS.has(key)) {
      return false;
    }
  }
  if (!keys.includes("schema_version") || !keys.includes("configured") || !keys.includes("accepted")) {
    return false;
  }
  if (Object.hasOwn(value, "detail") && !isPlainObject(value.detail)) {
    return false;
  }
  return true;
}

export function buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest(request) {
  if (!isPlainObject(request)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
      "agent-backend request must be an object"
    );
  }
  if (request.schema_version !== "agent-backend-request.v1") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
      "agent-backend request schema_version must be agent-backend-request.v1"
    );
  }
  if (request.backend_kind !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
      "scoped source tool surfaces require backend_kind filesystem_mcp"
    );
  }
  return buildScopedChildToolSurfaceDescriptor({
    role: request.agent?.role,
    read_scope: request.scope?.read_scope,
    write_scope: request.scope?.write_scope,
    validation_policy: request.validation,
    raw_exec_enabled: request.tools?.raw_exec_enabled,
    provenance_destination: request.provenance_destination
  });
}

export function assertAcceptedScopedChildToolSurfaceDescriptor(descriptor) {
  if (
    !isPlainObject(descriptor) ||
    descriptor.schema_version !== AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION ||
    descriptor.accepted !== true
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "scoped child tool surface descriptor must be accepted"
    );
  }
  if (descriptor.raw_exec_enabled !== false) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "accepted scoped child tool surface descriptor must disable raw exec"
    );
  }

  if (
    !isPlainObject(descriptor.structured_validation_contract) ||
    descriptor.structured_validation_contract.raw_exec_enabled !== false ||
    descriptor.structured_validation_contract.shell !== false ||
    !sameJson(
      descriptor.structured_validation_contract.operations,
      AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS
    )
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "accepted scoped child tool surface descriptor must declare the launcher-owned structured_validation node_check/node_test operations with raw exec and shell disabled",
      { structured_validation_contract: descriptor.structured_validation_contract ?? null }
    );
  }
  if (!Array.isArray(descriptor.scoped_tool_names)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "accepted scoped child tool surface descriptor must expose scoped_tool_names as an array"
    );
  }
  const scopedToolNames = descriptor.scoped_tool_names;
  const missingScopedTools = [
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.read,
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.structured_validation,
    AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.final_report
  ].filter((name) => !scopedToolNames.includes(name));
  if (descriptor.role === "worker") {
    if (!scopedToolNames.includes(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.apply_from_scratch)) {
      missingScopedTools.push(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.apply_from_scratch);
    }
    if (!scopedToolNames.includes(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.write)) {
      missingScopedTools.push(AGENT_CHILD_TOOL_SURFACE_SCOPED_TOOL_NAMES.write);
    }
  }
  if (missingScopedTools.length > 0) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "accepted scoped child tool surface descriptor is missing scoped tools",
      { missing_scoped_tools: missingScopedTools.sort() }
    );
  }
  const expectedScopedToolNames = normalizeScopedToolNames(descriptor.role === "worker");
  if (!sameJson(scopedToolNames, expectedScopedToolNames)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "accepted scoped child tool surface descriptor must expose the exact scoped tool names for its role",
      {
        expected_scoped_tool_names: expectedScopedToolNames,
        scoped_tool_names: scopedToolNames
      }
    );
  }
  if (descriptor.role === "worker") {
    if (!isPlainObject(descriptor.scoped_tool_contracts) || !sameJson(descriptor.scoped_tool_contracts, WORKER_SCOPED_TOOL_CONTRACTS)) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
        "accepted worker scoped child tool surface descriptor must describe the apply_from_scratch contract",
        {
          expected_scoped_tool_contracts: WORKER_SCOPED_TOOL_CONTRACTS,
          scoped_tool_contracts: isPlainObject(descriptor.scoped_tool_contracts) ? descriptor.scoped_tool_contracts : null
        }
      );
    }
  } else if (Object.hasOwn(descriptor, "scoped_tool_contracts")) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "read-only scoped child tool surface descriptors must not expose worker apply_from_scratch contracts",
      {
        scoped_tool_contracts: descriptor.scoped_tool_contracts
      }
    );
  }
  if (!Array.isArray(descriptor.disallowed_tools)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
      "accepted scoped child tool surface descriptor must expose disallowed_tools as an array"
    );
  }
  const disallowedTools = descriptor.disallowed_tools;
  for (const forbidden of AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS) {
    if (!disallowedTools.includes(forbidden)) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.DESCRIPTOR_INVALID,
        "accepted scoped child tool surface descriptor must explicitly disallow stock tools",
        { missing_disallowed_tool: forbidden }
      );
    }
  }
  return descriptor;
}

function sameJson(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export function assertLauncherOwnedSourceToolSurface(surface) {
  if (
    !isPlainObject(surface) ||
    surface.schema_version !== LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION ||
    surface.backend_kind !== "filesystem_mcp"
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_INVALID,
      `source tool surface must use ${LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION} for backend_kind filesystem_mcp`
    );
  }

  const descriptor = assertAcceptedScopedChildToolSurfaceDescriptor(surface.descriptor);
  if (isScopedChildToolSurfaceRefusal(descriptor)) {
    return descriptor;
  }

  if (!isPlainObject(surface.request) || surface.request.schema_version !== "agent-backend-request.v1") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "launcher-owned source tool surface requires an agent-backend-request.v1 request"
    );
  }
  const requestDescriptor = buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest(surface.request);
  if (isScopedChildToolSurfaceRefusal(requestDescriptor)) {
    return requestDescriptor;
  }
  if (!sameJson(requestDescriptor, descriptor)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface descriptor must match the launcher-owned backend request",
      {
        descriptor_digest: descriptor.descriptor_digest ?? null,
        request_descriptor_digest: requestDescriptor.descriptor_digest ?? null
      }
    );
  }

  const decision = surface.decision;
  if (
    !isPlainObject(decision) ||
    decision.schema_version !== "agent-backend-decision.v1" ||
    decision.backend_kind !== "filesystem_mcp" ||
    decision.allowed !== true ||
    decision.decision_code !== "agent_backend.filesystem_mcp.allowed.v1" ||
    !isNonEmptyString(decision.accepted_handshake_digest)
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "launcher-owned source tool surface requires an allowed filesystem_mcp backend decision with an accepted handshake digest"
    );
  }

  const handshake = surface.handshake;
  if (
    !isPlainObject(handshake) ||
    handshake.schema_version !== "agent-backend-handshake-result.v1" ||
    handshake.accepted !== true ||
    handshake.backend_kind !== "filesystem_mcp" ||
    handshake.status !== "available" ||
    handshake.mode !== "enforced" ||
    handshake.raw_exec_enabled !== false ||
    handshake.scope_binding !== true ||
    !isNonEmptyString(handshake.handshake_digest)
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "launcher-owned source tool surface requires an accepted enforced filesystem_mcp handshake"
    );
  }
  if (handshake.handshake_digest !== decision.accepted_handshake_digest) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface handshake digest must match the verified backend decision",
      {
        decision_handshake_digest: decision.accepted_handshake_digest,
        handshake_digest: handshake.handshake_digest
      }
    );
  }
  if (handshake.scope_digest !== descriptor.descriptor_digest) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface handshake scope digest must bind the descriptor digest",
      {
        descriptor_digest: descriptor.descriptor_digest,
        handshake_scope_digest: handshake.scope_digest ?? null
      }
    );
  }

  const matched = matchHandshakeToolSurface({
    descriptor,
    handshakeToolSurface: handshake.tool_surface
  });
  if (isScopedChildToolSurfaceRefusal(matched)) {
    return matched;
  }

  const backendProof = surface.backend_proof;
  if (
    !isPlainObject(backendProof) ||
    backendProof.schema_version !== "agent-backend-handshake-result.v1" ||
    backendProof.backend_kind !== "filesystem_mcp" ||
    backendProof.backend_id !== handshake.backend_id ||
    backendProof.backend_version !== handshake.backend_version ||
    backendProof.challenge_nonce !== handshake.challenge_nonce ||
    backendProof.status !== "available" ||
    backendProof.mode !== "enforced" ||
    backendProof.raw_exec_enabled !== false ||
    backendProof.scope_binding !== true ||
    backendProof.scope_digest !== descriptor.descriptor_digest
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "launcher-owned source tool surface requires backend-issued proof of the actual scoped tools"
    );
  }
  const backendProofMatched = matchHandshakeToolSurface({
    descriptor,
    handshakeToolSurface: backendProof.tool_surface
  });
  if (isScopedChildToolSurfaceRefusal(backendProofMatched)) {
    return backendProofMatched;
  }

  return Object.freeze({
    ...surface,
    accepted: true,
    descriptor,
    backend_proof: backendProof,
    request: surface.request,
    decision,
    handshake
  });
}

function normalizeLauncherOwnedChildMountSpec(childMount, { descriptorDigest, handshakeDigest, mcpServerName }) {
  if (!isPlainObject(childMount)) {
    return { ok: false, message: "child mount spec must be an object" };
  }
  if (childMount.transport !== CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT) {
    return {
      ok: false,
      message: `child mount transport must be ${CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT}`
    };
  }
  if (!isNonEmptyString(childMount.command)) {
    return { ok: false, message: "child mount command must be a non-empty string" };
  }
  if (!Array.isArray(childMount.args) || childMount.args.some((entry) => typeof entry !== "string")) {
    return { ok: false, message: "child mount args must be an array of strings" };
  }
  const staticEnv = {};
  if (childMount.env !== undefined && childMount.env !== null) {
    if (!isPlainObject(childMount.env)) {
      return { ok: false, message: "child mount env must be an object of string values" };
    }
    for (const [key, value] of Object.entries(childMount.env)) {
      if (!isNonEmptyString(key) || typeof value !== "string") {
        return { ok: false, message: "child mount env entries must be string key/value pairs" };
      }
      staticEnv[key] = value;
    }
  }
  const env = Object.freeze({
    ...staticEnv,
    [CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV]: descriptorDigest,
    [CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV]: handshakeDigest,
    [CODEX_SOURCE_TOOL_SURFACE_RAW_EXEC_ENV]: "false"
  });
  return {
    ok: true,
    mount: Object.freeze({
      transport: CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT,
      mcp_server_name: mcpServerName,
      command: childMount.command,
      args: Object.freeze([...childMount.args]),
      env
    })
  };
}

export function buildCodexChildRuntimeForLauncherOwnedSourceToolSurface(surface, options = {}) {
  const accepted = assertLauncherOwnedSourceToolSurface(surface);
  if (isScopedChildToolSurfaceRefusal(accepted)) {
    return accepted;
  }
  const mcpServerName = isNonEmptyString(options.mcpServerName)
    ? options.mcpServerName.trim()
    : CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME;
  const runtimeBody = {
    schema_version: "codex-child-source-tool-runtime.v1",
    backend_kind: "filesystem_mcp",
    transport: "mcp",
    mcp_server_name: mcpServerName,
    tool_namespace: "filesystem_mcp",
    callable_tools: [...accepted.descriptor.scoped_tool_names].sort(),
    descriptor_digest: accepted.descriptor.descriptor_digest,
    handshake_digest: accepted.decision.accepted_handshake_digest,
    backend_id: accepted.handshake.backend_id,
    backend_version: accepted.handshake.backend_version,
    raw_exec_enabled: false,
    scope_binding: true
  };

  if (options.childMount !== undefined && options.childMount !== null) {
    const normalized = normalizeLauncherOwnedChildMountSpec(options.childMount, {
      descriptorDigest: accepted.descriptor.descriptor_digest,
      handshakeDigest: accepted.decision.accepted_handshake_digest,
      mcpServerName
    });
    if (!normalized.ok) {
      return buildRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
        `Codex source-edit worker child mount is invalid: ${normalized.message}`,
        { mcp_server_name: mcpServerName }
      );
    }
    runtimeBody.child_mount = normalized.mount;
  }
  return Object.freeze({
    ...accepted,
    codex_child_runtime: Object.freeze(runtimeBody)
  });
}

export function assertCodexCallableSourceToolSurface(surface) {
  const accepted = assertLauncherOwnedSourceToolSurface(surface);
  if (isScopedChildToolSurfaceRefusal(accepted)) {
    return accepted;
  }
  const runtime = accepted.codex_child_runtime;
  if (!isPlainObject(runtime) || runtime.schema_version !== "codex-child-source-tool-runtime.v1") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit workers require callable scoped source tools, not descriptor metadata",
      {
        required_runtime_schema_version: "codex-child-source-tool-runtime.v1",
        required_tools: accepted.descriptor.scoped_tool_names
      }
    );
  }
  if (runtime.transport !== "mcp" || runtime.backend_kind !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker runtime must expose the filesystem_mcp tool surface through a callable transport",
      {
        transport: runtime.transport ?? null,
        backend_kind: runtime.backend_kind ?? null
      }
    );
  }
  if (!isNonEmptyString(runtime.mcp_server_name) || runtime.tool_namespace !== "filesystem_mcp") {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker runtime must name the launcher-owned filesystem_mcp MCP server namespace",
      {
        mcp_server_name: runtime.mcp_server_name ?? null,
        tool_namespace: runtime.tool_namespace ?? null
      }
    );
  }
  if (
    runtime.raw_exec_enabled !== false ||
    runtime.scope_binding !== true ||
    runtime.descriptor_digest !== accepted.descriptor.descriptor_digest ||
    runtime.handshake_digest !== accepted.decision.accepted_handshake_digest
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker runtime must bind the verified source-surface descriptor and handshake",
      {
        descriptor_digest: runtime.descriptor_digest ?? null,
        expected_descriptor_digest: accepted.descriptor.descriptor_digest,
        handshake_digest: runtime.handshake_digest ?? null,
        expected_handshake_digest: accepted.decision.accepted_handshake_digest,
        raw_exec_enabled: runtime.raw_exec_enabled ?? null,
        scope_binding: runtime.scope_binding ?? null
      }
    );
  }
  const callableTools = Array.isArray(runtime.callable_tools)
    ? Array.from(new Set(runtime.callable_tools.filter(isNonEmptyString))).sort()
    : [];
  const missing = accepted.descriptor.scoped_tool_names.filter((toolName) => !callableTools.includes(toolName));
  if (missing.length > 0) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker runtime is missing callable scoped source tools",
      { missing_callable_tools: missing.sort() }
    );
  }

  const mount = runtime.child_mount;
  if (!isPlainObject(mount)) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker runtime must carry a launcher-owned child MCP-server mount; the verified scoped surface is not mountable into the Codex child (no enforced filesystem_mcp backend child_mount is configured)",
      { required: "codex_child_runtime.child_mount" }
    );
  }
  if (
    mount.transport !== CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT ||
    !isNonEmptyString(mount.command) ||
    !Array.isArray(mount.args) ||
    mount.args.some((entry) => typeof entry !== "string")
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker child mount must be a launcher-owned stdio command with string args",
      {
        transport: mount.transport ?? null,
        command: mount.command ?? null
      }
    );
  }
  if (mount.mcp_server_name !== runtime.mcp_server_name) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker child mount must name the same filesystem_mcp MCP server as the runtime",
      {
        mount_mcp_server_name: mount.mcp_server_name ?? null,
        runtime_mcp_server_name: runtime.mcp_server_name ?? null
      }
    );
  }
  const mountEnv = isPlainObject(mount.env) ? mount.env : {};
  if (
    mountEnv[CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV] !== accepted.descriptor.descriptor_digest ||
    mountEnv[CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV] !== accepted.decision.accepted_handshake_digest ||
    mountEnv[CODEX_SOURCE_TOOL_SURFACE_RAW_EXEC_ENV] !== "false"
  ) {
    return buildRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
      "Codex source-edit worker child mount env must bind the verified descriptor digest, handshake digest, and raw-exec=false",
      {
        descriptor_digest: mountEnv[CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV] ?? null,
        expected_descriptor_digest: accepted.descriptor.descriptor_digest,
        handshake_digest: mountEnv[CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV] ?? null,
        expected_handshake_digest: accepted.decision.accepted_handshake_digest
      }
    );
  }
  return Object.freeze({
    ...accepted,
    codex_child_runtime: Object.freeze({
      ...runtime,
      callable_tools: callableTools
    })
  });
}
