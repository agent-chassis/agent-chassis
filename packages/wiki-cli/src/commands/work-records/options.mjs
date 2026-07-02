

import { WORK_RECORD_SCHEMA_VERSION } from "@agent-chassis/wiki-core";

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function createDiagnostic(code, message, { path: diagnosticPath = null, severity = "error" } = {}) {
  return {
    code,
    severity,
    message,
    path: diagnosticPath
  };
}

export function parseAdmissionUnitSelector(unitSelector) {
  const normalizedSelector = typeof unitSelector === "string" ? unitSelector.trim() : "";
  if (!normalizedSelector) {
    return null;
  }

  const pieces = normalizedSelector.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return null;
  }

  if (pieces.length === 1) {
    return {
      kind: "work_item",
      address: pieces[0],
      record_id: pieces[0],
      slice_id: null
    };
  }

  const sliceId = pieces[1];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sliceId)) {
    return null;
  }

  return {
    kind: "slice",
    address: normalizedSelector,
    record_id: pieces[0],
    slice_id: sliceId
  };
}

export function parseJsonValue(value, { fieldName }) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return {
      ok: false,
      diagnostic: createDiagnostic("invalid_json", `${fieldName} must be valid JSON`, {
        path: fieldName
      })
    };
  }
}

const COMMON_EDIT_OPTION_NAMES = Object.freeze([
  "dir",
  "expected-source-digest",
  "help",
  "id",
  "json",
  "schema-version",
  "unit"
]);

const EDIT_COMMAND_ALLOWED_OPTIONS = Object.freeze({
  "set-status": new Set([...COMMON_EDIT_OPTION_NAMES, "status"]),
  "set-task": new Set([...COMMON_EDIT_OPTION_NAMES, "index", "text"]),
  "set-closure": new Set([
    ...COMMON_EDIT_OPTION_NAMES,
    "follow-ups-json",
    "json-file",
    "summary",
    "validation-json"
  ])
});

const ALL_EDIT_COMMAND_OPTION_NAMES = new Set(
  Object.values(EDIT_COMMAND_ALLOWED_OPTIONS).flatMap((set) => Array.from(set))
);

const EDIT_COMMAND_DASH_VALUE_OPTIONS = Object.freeze({
  "set-status": new Set(),
  "set-task": new Set(["text"]),
  "set-closure": new Set(["summary", "json-file"])
});

export const PERSIST_GRAPH_IMPACT_COMMAND_OPTION_NAMES = new Set([
  "dir",
  "graph-impact-json-file",
  "help",
  "json",
  "unit"
]);

export const CLEANUP_DERIVED_EVIDENCE_COMMAND_OPTION_NAMES = new Set([
  "all",
  "concurrency",
  "dir",
  "expected-source-digest",
  "help",
  "id",
  "json",
  "records",
  "require-graph-sidecarization",
  "verbose",
  "write"
]);

const EXPECTED_SOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isReservedOptionToken(token, reservedOptionNames = ALL_EDIT_COMMAND_OPTION_NAMES) {
  if (typeof token !== "string" || !token.startsWith("--")) {
    return false;
  }
  const key = token.slice(2).split("=", 1)[0];
  return reservedOptionNames.has(key);
}

function collectDashValueTokenKeys(argv, command) {
  const keys = new Set();
  if (!Array.isArray(argv)) {
    return keys;
  }
  const dashValueOptions = EDIT_COMMAND_DASH_VALUE_OPTIONS[command];
  if (!dashValueOptions || !dashValueOptions.size) {
    return keys;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string" || !token.startsWith("--")) {
      continue;
    }
    const body = token.slice(2);

    if (body.includes("=") || !dashValueOptions.has(body)) {
      continue;
    }
    const next = argv[index + 1];

    if (typeof next === "string" && next.startsWith("--") && !isReservedOptionToken(next)) {
      keys.add(next.slice(2).split("=", 1)[0]);
    }
  }
  return keys;
}

export function rejectUnknownEditOptions(options, command, argv = null) {
  const allowed = EDIT_COMMAND_ALLOWED_OPTIONS[command];
  if (!allowed) {
    return null;
  }
  const dashValueTokenKeys = collectDashValueTokenKeys(argv, command);
  const unknown = Object.keys(options).filter(
    (key) => !allowed.has(key) && !dashValueTokenKeys.has(key)
  );
  if (!unknown.length) {
    return null;
  }
  unknown.sort();
  return createDiagnostic(
    "unknown_option",
    `${command} does not accept option(s): ${unknown.map((key) => `--${key}`).join(", ")}`,
    { path: unknown[0] }
  );
}

export function rejectUnknownOptions(options, allowedOptionNames, command) {
  const unknown = Object.keys(options).filter((key) => !allowedOptionNames.has(key));
  if (!unknown.length) {
    return null;
  }
  unknown.sort();
  return createDiagnostic(
    "unknown_option",
    `${command} does not accept option(s): ${unknown.map((key) => `--${key}`).join(", ")}`,
    { path: unknown[0] }
  );
}

export function readOptionalSchemaVersion(argv, options, commandName) {
  if (!("schema-version" in options)) {
    return { ok: true, value: null };
  }
  const result = readEditOption(argv, options, "schema-version", { command: commandName });
  if (!result.ok) {
    return { ok: false, diagnostic: result.diagnostic };
  }
  if (result.value !== WORK_RECORD_SCHEMA_VERSION) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "unsupported_schema_version",
        `${commandName} only supports schema_version ${WORK_RECORD_SCHEMA_VERSION}; received ${result.value}`,
        { path: "schema-version" }
      )
    };
  }
  return { ok: true, value: result.value };
}

export function readEditOption(
  argv,
  options,
  key,
  {
    command,
    allowEmpty = false,
    allowDashValue = false,
    reservedOptionNames = ALL_EDIT_COMMAND_OPTION_NAMES
  } = {}
) {
  if (!(key in options)) {
    return {
      ok: false,
      diagnostic: createDiagnostic("missing_option", `${command} requires --${key}`, { path: key })
    };
  }

  const inlinePrefix = `--${key}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === `--${key}`) {
      const next = argv[index + 1];
      if (
        next === undefined ||
        (!allowDashValue && next.startsWith("--")) ||
        (allowDashValue && isReservedOptionToken(next, reservedOptionNames))
      ) {
        return {
          ok: false,
          diagnostic: createDiagnostic("missing_option", `${command} requires --${key} <value>`, { path: key })
        };
      }
      if (next === "" && !allowEmpty) {
        return {
          ok: false,
          diagnostic: createDiagnostic("missing_option", `${command} requires --${key} <value>`, { path: key })
        };
      }
      return { ok: true, value: next };
    }
    if (token.startsWith(inlinePrefix)) {
      const value = token.slice(inlinePrefix.length);
      if (value === "" && !allowEmpty) {
        return {
          ok: false,
          diagnostic: createDiagnostic("missing_option", `${command} requires --${key} <value>`, { path: key })
        };
      }
      return { ok: true, value };
    }
  }

  return {
    ok: false,
    diagnostic: createDiagnostic("missing_option", `${command} requires --${key}`, { path: key })
  };
}

export function readPersistGraphImpactOption(argv, options, key, { command, allowEmpty = false, allowDashValue = false } = {}) {
  return readEditOption(argv, options, key, {
    command,
    allowEmpty,
    allowDashValue,
    reservedOptionNames: PERSIST_GRAPH_IMPACT_COMMAND_OPTION_NAMES
  });
}

export function readOptionalExpectedSourceDigest(argv, options, commandName) {
  if (!("expected-source-digest" in options)) {
    return { ok: true, value: null };
  }
  const result = readEditOption(argv, options, "expected-source-digest", { command: commandName });
  if (!result.ok) {
    return { ok: false, diagnostic: result.diagnostic };
  }
  if (typeof result.value !== "string" || !EXPECTED_SOURCE_DIGEST_PATTERN.test(result.value)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "invalid_expected_source_digest",
        `${commandName} requires --expected-source-digest sha256:<64 lowercase hex>`,
        { path: "expected-source-digest" }
      )
    };
  }
  return { ok: true, value: result.value };
}
