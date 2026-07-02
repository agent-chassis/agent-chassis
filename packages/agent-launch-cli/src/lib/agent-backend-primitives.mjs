

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}

export function isNonEmptyString(value) {
  return isString(value) && value.trim() !== "";
}

export function createDiagnostic(code, message, path, extra = {}) {
  return { code, message, path, ...extra };
}

export function normalizeStringList(value, path, diagnostics, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", `${path} must be an array`, path));
    return null;
  }

  const list = [];
  for (const entry of value) {
    if (!isNonEmptyString(entry)) {
      diagnostics.push(createDiagnostic("invalid_agent_backend_input", `${path} must contain non-empty strings`, path));
      return null;
    }
    list.push(entry.trim());
  }

  if (!allowEmpty && list.length === 0) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", `${path} must not be empty`, path));
    return null;
  }

  return list;
}

export function normalizeIsoTimestamp(value, path, diagnostics) {
  if (!isNonEmptyString(value)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", `${path} is required`, path));
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    diagnostics.push(createDiagnostic("invalid_agent_backend_input", `${path} must be an ISO timestamp`, path));
    return null;
  }

  return new Date(timestamp).toISOString();
}

export function deriveValidationTransport(validation) {
  if (!isObject(validation) || !Array.isArray(validation.commands) || validation.commands.length === 0) {
    return "unsupported";
  }

  let transport = null;
  for (const entry of validation.commands) {
    if (!isObject(entry)) {
      return "unsupported";
    }
    if (entry.form !== "argv" && entry.form !== "named") {
      return "unsupported";
    }
    if (transport === null) {
      transport = entry.form;
      continue;
    }
    if (transport !== entry.form) {
      return "unsupported";
    }
  }

  return transport ?? "unsupported";
}

export function normalizeDiagnosticProbe(input, diagnostics) {
  if (input === undefined || input === null) {
    return null;
  }
  if (!isObject(input)) {
    diagnostics.push(
      createDiagnostic(
        "invalid_agent_backend_input",
        "local_cli probe evidence must be an object when present",
        "diagnostic.local_cli_probe"
      )
    );
    return null;
  }
  return cloneJson(input);
}

export function buildOrThrow(result, schemaVersion) {
  if (result.ok) {
    return result.value;
  }
  const details = result.diagnostics
    .map((entry) => `${entry.path}: ${entry.message}`)
    .join("; ");
  throw new Error(`${schemaVersion} validation failed${details ? `: ${details}` : ""}`);
}
