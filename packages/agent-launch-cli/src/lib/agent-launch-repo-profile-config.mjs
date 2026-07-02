import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_PROFILE_LOCAL_CONFIG_SCHEMA_VERSION =
  "agent-launch-repo-profile-local-config.v1";

export const REPO_PROFILE_LOCAL_CONFIG_FILENAME = ".agent-launch.local.env";

export const REPO_PROFILE_LOCAL_CONFIG_ALLOWED_KEYS = Object.freeze([
  "ORCHESTRATOR_EFFORT",
  "CLAUDE_ORCH_THREAD_SUFFIX"
]);

export const REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES = Object.freeze({
  SYNTAX_EXPORT_NOT_ALLOWED:
    "repo_profile_local_config.syntax.export_not_allowed",
  SYNTAX_MISSING_EQUALS: "repo_profile_local_config.syntax.missing_equals",
  SYNTAX_EMPTY_KEY: "repo_profile_local_config.syntax.empty_key",
  SYNTAX_INVALID_KEY: "repo_profile_local_config.syntax.invalid_key",
  SYNTAX_QUOTING_NOT_ALLOWED:
    "repo_profile_local_config.syntax.quoting_not_allowed",
  SYNTAX_VARIABLE_EXPANSION_NOT_ALLOWED:
    "repo_profile_local_config.syntax.variable_expansion_not_allowed",
  SYNTAX_INLINE_SHELL_NOT_ALLOWED:
    "repo_profile_local_config.syntax.inline_shell_not_allowed",
  SYNTAX_MULTILINE_NOT_ALLOWED:
    "repo_profile_local_config.syntax.multiline_not_allowed",
  VALUE_CONTROL_CHARACTER: "repo_profile_local_config.value.control_character",
  VALUE_EMPTY: "repo_profile_local_config.value.empty",
  KEY_NOT_ALLOWED: "repo_profile_local_config.key.not_allowed",
  KEY_DUPLICATE: "repo_profile_local_config.key.duplicate",
  THREAD_SUFFIX_INVALID_CHARACTER:
    "repo_profile_local_config.thread_suffix.invalid_character"
});

export const REPO_PROFILE_LOCAL_CONFIG_REFUSAL_REASONS = Object.freeze({
  SYNTAX_VIOLATION: "syntax_violation",
  VALUE_VIOLATION: "value_violation"
});

const ALLOWED_KEY_SET = new Set(REPO_PROFILE_LOCAL_CONFIG_ALLOWED_KEYS);

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const THREAD_SUFFIX_PATTERN = /^[A-Za-z0-9._ \-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0B-\x1F\x7F]/;
const SHELL_METACHARACTER_PATTERN = /[|&;<>()\\]/;
const QUOTE_CHARACTER_PATTERN = /["'`]/;
const VARIABLE_EXPANSION_PATTERN = /\$/;
const EXPORT_KEYWORD_PATTERN = /^export(\s|$)/;

const SYNTAX_VIOLATION_CODES = new Set([
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_EXPORT_NOT_ALLOWED,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_MISSING_EQUALS,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_EMPTY_KEY,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_INVALID_KEY,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_QUOTING_NOT_ALLOWED,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_VARIABLE_EXPANSION_NOT_ALLOWED,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_INLINE_SHELL_NOT_ALLOWED,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.SYNTAX_MULTILINE_NOT_ALLOWED
]);

const VALUE_VIOLATION_CODES = new Set([
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.VALUE_CONTROL_CHARACTER,
  REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES.THREAD_SUFFIX_INVALID_CHARACTER
]);

function freshValues() {
  return {
    ORCHESTRATOR_EFFORT: null,
    CLAUDE_ORCH_THREAD_SUFFIX: null
  };
}

function emptyResult({ source }) {
  return {
    schema_version: REPO_PROFILE_LOCAL_CONFIG_SCHEMA_VERSION,
    filename: REPO_PROFILE_LOCAL_CONFIG_FILENAME,
    source,
    refused: false,
    refusal_reason: null,
    values: freshValues(),
    normalized_thread_suffix: null,
    diagnostics: [],
    allowed_keys: REPO_PROFILE_LOCAL_CONFIG_ALLOWED_KEYS
  };
}

function pushDiagnostic(diagnostics, entry) {
  diagnostics.push(Object.freeze({ ...entry }));
}

function stripByteOrderMark(input) {
  if (input.length > 0 && input.charCodeAt(0) === 0xfeff) {
    return input.slice(1);
  }
  return input;
}

export function parseRepoProfileLocalConfigSource(input, options = {}) {
  const source = options.source ?? Object.freeze({ kind: "text" });
  if (typeof input !== "string") {
    return emptyResult({ source });
  }

  const text = stripByteOrderMark(input);
  const result = emptyResult({ source });
  const diagnostics = [];
  const seenKeys = new Set();
  const codes = REPO_PROFILE_LOCAL_CONFIG_DIAGNOSTIC_CODES;

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) continue;

    if (rawLine.replace(/[ \t]+$/, "").endsWith("\\")) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_MULTILINE_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        message: "multiline continuation via trailing backslash is not allowed"
      });
      continue;
    }

    if (EXPORT_KEYWORD_PATTERN.test(trimmed)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_EXPORT_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        message: "shell-style 'export' prefix is not allowed"
      });
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_MISSING_EQUALS,
        line_number: lineNumber,
        raw_line: rawLine,
        message: "missing '=' delimiter; expected KEY=VALUE"
      });
      continue;
    }

    const key = trimmed.slice(0, equalsIndex);
    const value = trimmed.slice(equalsIndex + 1);

    if (key === "") {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_EMPTY_KEY,
        line_number: lineNumber,
        raw_line: rawLine,
        message: "empty key before '='"
      });
      continue;
    }

    if (!KEY_PATTERN.test(key)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_INVALID_KEY,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: `invalid key syntax: ${JSON.stringify(key)}`
      });
      continue;
    }

    if (QUOTE_CHARACTER_PATTERN.test(value)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_QUOTING_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: "quote characters are not allowed in value"
      });
      continue;
    }

    if (VARIABLE_EXPANSION_PATTERN.test(value)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_VARIABLE_EXPANSION_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: "variable expansion via '$' is not allowed in value"
      });
      continue;
    }

    if (SHELL_METACHARACTER_PATTERN.test(value)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.SYNTAX_INLINE_SHELL_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: "inline shell metacharacters are not allowed in value"
      });
      continue;
    }

    if (CONTROL_CHARACTER_PATTERN.test(value)) {
      pushDiagnostic(diagnostics, {
        severity: "error",
        code: codes.VALUE_CONTROL_CHARACTER,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: "control characters are not allowed in value"
      });
      continue;
    }

    if (value === "") {
      pushDiagnostic(diagnostics, {
        severity: "warning",
        code: codes.VALUE_EMPTY,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: `empty value for key ${key}; ignored`
      });
      continue;
    }

    if (!ALLOWED_KEY_SET.has(key)) {
      pushDiagnostic(diagnostics, {
        severity: "warning",
        code: codes.KEY_NOT_ALLOWED,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: `key ${key} is not in the repo-local config allowlist; ignored`
      });
      continue;
    }

    if (seenKeys.has(key)) {
      pushDiagnostic(diagnostics, {
        severity: "warning",
        code: codes.KEY_DUPLICATE,
        line_number: lineNumber,
        raw_line: rawLine,
        key,
        message: `duplicate key ${key}; first occurrence retained`
      });
      continue;
    }

    if (key === "CLAUDE_ORCH_THREAD_SUFFIX") {
      if (!THREAD_SUFFIX_PATTERN.test(value)) {
        pushDiagnostic(diagnostics, {
          severity: "error",
          code: codes.THREAD_SUFFIX_INVALID_CHARACTER,
          line_number: lineNumber,
          raw_line: rawLine,
          key,
          message:
            "CLAUDE_ORCH_THREAD_SUFFIX must match [A-Za-z0-9._ -]+ (no slash, brackets, control characters, or newlines)"
        });
        continue;
      }
    }

    result.values[key] = value;
    seenKeys.add(key);
  }

  if (result.values.CLAUDE_ORCH_THREAD_SUFFIX !== null) {
    result.normalized_thread_suffix = result.values.CLAUDE_ORCH_THREAD_SUFFIX;
  }

  result.diagnostics = Object.freeze(diagnostics);

  const fatal = diagnostics.find(
    (d) =>
      SYNTAX_VIOLATION_CODES.has(d.code) || VALUE_VIOLATION_CODES.has(d.code)
  );
  if (fatal) {
    result.refused = true;
    result.refusal_reason = SYNTAX_VIOLATION_CODES.has(fatal.code)
      ? REPO_PROFILE_LOCAL_CONFIG_REFUSAL_REASONS.SYNTAX_VIOLATION
      : REPO_PROFILE_LOCAL_CONFIG_REFUSAL_REASONS.VALUE_VIOLATION;
    result.values = freshValues();
    result.normalized_thread_suffix = null;
  }

  return result;
}

export function loadRepoProfileLocalConfig(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot === "") {
    return emptyResult({
      source: Object.freeze({ kind: "file", path: null, found: false })
    });
  }
  const path = join(repoRoot, REPO_PROFILE_LOCAL_CONFIG_FILENAME);
  if (!existsSync(path)) {
    return emptyResult({
      source: Object.freeze({ kind: "file", path, found: false })
    });
  }
  const text = readFileSync(path, "utf8");
  return parseRepoProfileLocalConfigSource(text, {
    source: Object.freeze({ kind: "file", path, found: true })
  });
}

export function appendRepoProfileThreadSuffix(baseThreadName, normalizedSuffix) {
  if (typeof baseThreadName !== "string" || baseThreadName === "") {
    return baseThreadName;
  }
  if (typeof normalizedSuffix !== "string" || normalizedSuffix === "") {
    return baseThreadName;
  }
  if (!THREAD_SUFFIX_PATTERN.test(normalizedSuffix)) {
    return baseThreadName;
  }
  return `${baseThreadName} ${normalizedSuffix}`;
}
