

import {
  AGENT_BACKEND_REQUEST_SCHEMA_VERSION,
  AGENT_BACKEND_KINDS,
  AGENT_BACKEND_AGENT_FAMILIES,
  AGENT_BACKEND_AGENT_ROLES,
  TOOL_SURFACE_KEYS
} from "./agent-backend-constants.mjs";
import {
  isObject,
  isNonEmptyString,
  createDiagnostic,
  normalizeStringList,
  buildOrThrow
} from "./agent-backend-primitives.mjs";

export function normalizeAgentSubject(subject, diagnostics) {
  if (!isObject(subject)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "subject is required", "subject"));
    return null;
  }

  const kind = isNonEmptyString(subject.kind) ? subject.kind.trim() : "work_unit";
  if (kind !== "work_unit") {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "subject.kind must be work_unit",
        "subject.kind"
      )
    );
    return null;
  }

  if (!isNonEmptyString(subject.repo)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "subject.repo is required", "subject.repo"));
    return null;
  }

  if (!isObject(subject.unit)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "subject.unit is required", "subject.unit"));
    return null;
  }

  const recordId = isNonEmptyString(subject.unit.record_id) ? subject.unit.record_id.trim() : null;
  if (!recordId) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "subject.unit.record_id is required",
        "subject.unit.record_id"
      )
    );
    return null;
  }

  const sliceId = subject.unit.slice_id === null || subject.unit.slice_id === undefined
    ? null
    : isNonEmptyString(subject.unit.slice_id)
      ? subject.unit.slice_id.trim()
      : null;
  if (sliceId === null && subject.unit.slice_id !== null && subject.unit.slice_id !== undefined) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "subject.unit.slice_id must be null or a non-empty string",
        "subject.unit.slice_id"
      )
    );
    return null;
  }

  if (sliceId !== null && !/^[a-z0-9][a-z0-9-]*$/.test(sliceId)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "subject.unit.slice_id must match ^[a-z0-9][a-z0-9-]*$",
        "subject.unit.slice_id"
      )
    );
    return null;
  }

  const address = isNonEmptyString(subject.unit.address) ? subject.unit.address.trim() : null;
  const expectedAddress = sliceId === null ? recordId : `${recordId}#${sliceId}`;
  if (!address || address !== expectedAddress) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "subject.unit.address must round-trip the record and slice identifiers",
        "subject.unit.address"
      )
    );
    return null;
  }

  return {
    kind: "work_unit",
    repo: subject.repo.trim(),
    unit: {
      record_id: recordId,
      slice_id: sliceId,
      address
    }
  };
}

export function normalizeAgent(agentInput, diagnostics) {
  const source = isObject(agentInput)
    ? agentInput
    : null;

  const family = isNonEmptyString(source?.family) ? source.family.trim() : null;
  const role = isNonEmptyString(source?.role) ? source.role.trim() : null;
  const profile = isNonEmptyString(source?.profile) ? source.profile.trim() : null;
  const model = source?.model === null || source?.model === undefined
    ? null
    : isNonEmptyString(source.model)
      ? source.model.trim()
      : null;

  if (!family || !AGENT_BACKEND_AGENT_FAMILIES.includes(family)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "agent.family must be one of codex, claude, or agy",
        "agent.family"
      )
    );
  }
  if (!role || !AGENT_BACKEND_AGENT_ROLES.includes(role)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "agent.role must be worker, reviewer, or redteam",
        "agent.role"
      )
    );
  }
  if (!profile) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "agent.profile is required", "agent.profile"));
  }

  if (diagnostics.length > 0) {
    return null;
  }

  return {
    family,
    role,
    profile,
    model
  };
}

export function normalizeTools(toolsInput, backendKind, diagnostics) {
  const source = isObject(toolsInput) ? toolsInput : {};
  const rawExecEnabled = source.raw_exec_enabled === undefined ? false : Boolean(source.raw_exec_enabled);

  if (backendKind === "filesystem_mcp" && rawExecEnabled !== false) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "filesystem_mcp tools.raw_exec_enabled must be false",
        "tools.raw_exec_enabled"
      )
    );
    return null;
  }

  const filesystemMcp = isObject(source.filesystem_mcp) ? source.filesystem_mcp : {};
  const read = filesystemMcp.read === undefined ? true : Boolean(filesystemMcp.read);
  const write = filesystemMcp.write === undefined ? true : Boolean(filesystemMcp.write);
  const structuredValidation =
    filesystemMcp.structured_validation === undefined ? true : Boolean(filesystemMcp.structured_validation);
  const finalReport = filesystemMcp.final_report === undefined ? true : Boolean(filesystemMcp.final_report);

  return {
    raw_exec_enabled: backendKind === "filesystem_mcp" ? false : rawExecEnabled,
    filesystem_mcp: {
      read,
      write,
      structured_validation: structuredValidation,
      final_report: finalReport
    }
  };
}

export function normalizeFilesystemMcpToolSurface(toolSurfaceInput, diagnostics) {
  const raw = isObject(toolSurfaceInput) ? toolSurfaceInput : null;
  if (!raw) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "tool_surface is required",
        "tool_surface"
      )
    );
    return null;
  }

  const source = isObject(raw.filesystem_mcp) ? raw.filesystem_mcp : raw;
  const normalized = {};
  for (const key of TOOL_SURFACE_KEYS) {
    if (typeof source[key] !== "boolean") {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          `tool_surface.${key} must be a boolean`,
          `tool_surface.${key}`
        )
      );
      return null;
    }
    normalized[key] = source[key];
  }

  for (const key of Object.keys(source)) {
    if (!TOOL_SURFACE_KEYS.includes(key)) {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          `tool_surface includes unsupported field ${key}`,
          `tool_surface.${key}`
        )
      );
      return null;
    }
  }

  return normalized;
}

export function normalizeValidationPolicy(validationInput, diagnostics) {
  if (!isObject(validationInput)) {
    diagnostics.push(
      createDiagnostic("invalid_agent_backend_input", "validation policy is required", "validation")
    );
    return null;
  }

  const commands = Array.isArray(validationInput.commands) ? validationInput.commands : null;
  if (!commands || commands.length === 0) {
    diagnostics.push(
      createDiagnostic("invalid_agent_backend_input", "validation.commands must be a non-empty array", "validation.commands")
    );
    return null;
  }

  const normalizedCommands = [];
  for (let index = 0; index < commands.length; index += 1) {
    const entry = commands[index];
    if (!isObject(entry)) {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          "validation.commands entries must be objects",
          `validation.commands[${index}]`
        )
      );
      return null;
    }

    if (entry.form === "argv") {
      const argv = normalizeStringList(entry.argv, `validation.commands[${index}].argv`, diagnostics);
      if (!argv) {
        return null;
      }
      normalizedCommands.push({
        form: "argv",
        argv
      });
      continue;
    }

    if (entry.form === "named") {
      const profile = isNonEmptyString(entry.profile)
        ? entry.profile.trim()
        : isNonEmptyString(entry.name)
          ? entry.name.trim()
          : null;
      if (!profile) {
        diagnostics.push(
          createDiagnostic(
            "invalid_agent_backend_input",
            "validation.commands named entries require profile or name",
            `validation.commands[${index}]`
          )
        );
        return null;
      }
      normalizedCommands.push({
        form: "named",
        profile
      });
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "validation.commands entries must use form argv or named",
        `validation.commands[${index}].form`
      )
    );
    return null;
  }

  return { commands: normalizedCommands };
}

export function normalizeEnvironmentPolicy(environmentPolicyInput, diagnostics) {
  if (!isObject(environmentPolicyInput)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "environment policy is required",
        "environment_policy"
      )
    );
    return null;
  }

  const mode = isNonEmptyString(environmentPolicyInput.mode)
    ? environmentPolicyInput.mode.trim()
    : null;
  if (!mode || !["closed", "allowlist"].includes(mode)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "environment_policy.mode must be closed or allowlist",
        "environment_policy.mode"
      )
    );
    return null;
  }

  const allowedKeys = environmentPolicyInput.allowed_keys === undefined
    ? []
    : normalizeStringList(environmentPolicyInput.allowed_keys, "environment_policy.allowed_keys", diagnostics, {
        allowEmpty: true
      });
  if (!allowedKeys) {
    return null;
  }

  return {
    mode,
    allowed_keys: allowedKeys
  };
}

export function normalizeProvenanceDestination(provenanceInput, diagnostics) {
  if (!isObject(provenanceInput)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "provenance destination is required",
        "provenance_destination"
      )
    );
    return null;
  }

  const kind = isNonEmptyString(provenanceInput.kind) ? provenanceInput.kind.trim() : null;
  if (!kind) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "provenance_destination.kind is required",
        "provenance_destination.kind"
      )
    );
    return null;
  }

  if (kind === "launcher_owned") {
    const runId = isNonEmptyString(provenanceInput.run_id) ? provenanceInput.run_id.trim() : null;
    if (!runId) {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          "launcher_owned provenance_destination requires run_id",
          "provenance_destination.run_id"
        )
      );
      return null;
    }

    const result = {
      kind,
      run_id: runId
    };
    if (isNonEmptyString(provenanceInput.path)) {
      result.path = provenanceInput.path.trim();
    }
    return result;
  }

  if (kind === "path" || kind === "handle") {
    const value = isNonEmptyString(provenanceInput.value)
      ? provenanceInput.value.trim()
      : isNonEmptyString(provenanceInput.path)
        ? provenanceInput.path.trim()
        : isNonEmptyString(provenanceInput.handle)
          ? provenanceInput.handle.trim()
          : null;
    if (!value) {
      diagnostics.push(
        createDiagnostic(
          "invalid_agent_backend_input",
          `${kind} provenance_destination requires a value`,
          "provenance_destination"
        )
      );
      return null;
    }

    return { kind, value };
  }

  diagnostics.push(
    createDiagnostic(
      "invalid_agent_backend_input",
      "provenance_destination.kind must be launcher_owned, path, or handle",
      "provenance_destination.kind"
    )
  );
  return null;
}

export function normalizeEvidence(evidenceInput, diagnostics) {
  if (evidenceInput === undefined || evidenceInput === null) {
    return {};
  }
  if (!isObject(evidenceInput)) {
    diagnostics.push(
      createDiagnostic("invalid_agent_backend_input", "evidence must be an object when present", "evidence")
    );
    return null;
  }

  const normalized = {};
  for (const key of [
    "work_record_digest",
    "dispatch_readiness_digest",
    "worker_admission_digest",
    "normalized_input_digest",
    "scope_digest"
  ]) {
    if (key in evidenceInput) {
      if (evidenceInput[key] === null) {
        normalized[key] = null;
      } else if (isNonEmptyString(evidenceInput[key])) {
        normalized[key] = evidenceInput[key].trim();
      } else {
        diagnostics.push(
          createDiagnostic(
            "invalid_agent_backend_input",
            `${key} must be a non-empty string when present`,
            `evidence.${key}`
          )
        );
        return null;
      }
    }
  }

  return normalized;
}

const AGENT_BACKEND_READ_ONLY_ROLES = Object.freeze(["reviewer", "redteam"]);

export function normalizeScope(scopeInput, diagnostics, { allowEmptyWriteScope = false } = {}) {
  if (!isObject(scopeInput)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "scope is required", "scope"));
    return null;
  }

  const readScope = normalizeStringList(scopeInput.read_scope, "scope.read_scope", diagnostics);
  if (!readScope) {
    return null;
  }

  const writeScope = normalizeStringList(scopeInput.write_scope, "scope.write_scope", diagnostics, {
    allowEmpty: allowEmptyWriteScope
  });
  if (!writeScope) {
    return null;
  }

  return {
    read_scope: readScope,
    write_scope: writeScope
  };
}

export function normalizeBackendKind(value, diagnostics) {
  const backendKind = isNonEmptyString(value) ? value.trim() : "filesystem_mcp";
  if (!AGENT_BACKEND_KINDS.includes(backendKind)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "backend_kind must be filesystem_mcp or local_cli",
        "backend_kind"
      )
    );
    return null;
  }
  return backendKind;
}

export function normalizeAgentBackendRequestInput(input) {
  const diagnostics = [];
  if (!isObject(input)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", "request input must be an object", "input"));
    return { ok: false, diagnostics };
  }

  const backendKind = normalizeBackendKind(input.backend_kind ?? input.backendKind, diagnostics);
  const subject = normalizeAgentSubject(input.subject, diagnostics);
  const agentInput = input.agent ?? {
    family: input.family,
    role: input.role,
    profile: input.profile,
    model: input.model
  };
  const agent = normalizeAgent(agentInput, diagnostics);
  const rawAgentRole = isObject(agentInput) && isNonEmptyString(agentInput.role)
    ? agentInput.role.trim()
    : null;
  const allowEmptyWriteScope = AGENT_BACKEND_READ_ONLY_ROLES.includes(rawAgentRole);
  const scope = normalizeScope(input.scope ?? {
    read_scope: input.read_scope ?? input.readScope,
    write_scope: input.write_scope ?? input.writeScope
  }, diagnostics, { allowEmptyWriteScope });
  const validation = normalizeValidationPolicy(input.validation ?? input.validation_policy ?? input.validationPolicy, diagnostics);
  const environmentPolicy = normalizeEnvironmentPolicy(
    input.environment_policy ?? input.environmentPolicy,
    diagnostics
  );
  const provenanceDestination = normalizeProvenanceDestination(
    input.provenance_destination ?? input.provenanceDestination,
    diagnostics
  );
  const tools = normalizeTools(input.tools, backendKind ?? "filesystem_mcp", diagnostics);
  const evidence = normalizeEvidence(input.evidence, diagnostics);

  if (diagnostics.length > 0 || !backendKind || !subject || !agent || !scope || !validation || !environmentPolicy || !provenanceDestination || !tools || evidence === null) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    diagnostics: [],
    value: {
      schema_version: AGENT_BACKEND_REQUEST_SCHEMA_VERSION,
      backend_kind: backendKind,
      subject,
      agent,
      scope,
      tools,
      validation,
      environment_policy: environmentPolicy,
      provenance_destination: provenanceDestination,
      evidence
    }
  };
}

export function normalizeAgentBackendRequestV1(input = {}) {
  return normalizeAgentBackendRequestInput(input);
}

export function buildAgentBackendRequestV1(input = {}) {
  return buildOrThrow(normalizeAgentBackendRequestV1(input), AGENT_BACKEND_REQUEST_SCHEMA_VERSION);
}

export function buildFilesystemMcpAgentBackendRequestV1(input = {}) {
  return buildAgentBackendRequestV1({
    ...input,
    backend_kind: "filesystem_mcp"
  });
}
