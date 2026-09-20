import { normalizeSidecarNavigationInput } from "./sidecar-navigation-input.mjs";
import { SidecarPathValidationError, validateVirtualSidecarPath } from "./sidecar-paths.mjs";

export const SIDECAR_QUERY_INPUT_INVALID = "sidecar_query_input_invalid";

export const SIDECAR_IMPACT_BOUND_CODES = Object.freeze(new Set([
  "raw_patch_too_large", "raw_patch_too_many_lines", "too_many_diff_records"
]));

const TRANSPORT_KEYS = ["dir", "cacheDir", "repo", "includeSuppressed", "verbose"];

const NARROWING_KEYS = ["path", "symbol"];
const IMPACT_KEYS = new Set([...TRANSPORT_KEYS, "paths", "patchText", "diffRecords", "liveGit",
  ...NARROWING_KEYS]);
const CONTEXT_KEYS = new Set([...TRANSPORT_KEYS, "path"]);
const DIFF_RECORD_KEYS = new Set(["changeKind", "oldPath", "newPath"]);

const CHANGE_SELECTORS = ["paths", "patchText", "diffRecords", "liveGit"];
const LOCATION_SELECTORS = ["symbol", "line", "character"];

const NAVIGATION_TRANSPORT_KEYS = ["dir", "cacheDir", "repo", "verbose"];
export const SIDECAR_CODE_QUESTION_KINDS = Object.freeze(["impact", "context", "navigation"]);

export const SIDECAR_CODE_QUESTION_RELATIONSHIPS = Object.freeze([
  "definition", "references", "callers", "callees"
]);
const CODE_QUESTION_KEYS = new Set([...TRANSPORT_KEYS, ...CHANGE_SELECTORS, ...LOCATION_SELECTORS,
  "path", "relationship"]);

export const SIDECAR_CODE_QUESTION_ALTERNATIVES = Object.freeze([
  "Change impact: supply exactly one of paths, patchText, diffRecords or liveGit:true; " +
    "path and symbol narrow that subject to what they name.",
  "Symbol or source location: supply symbol, or path with line and optional character; " +
    `relationship narrows the answer to one of ${SIDECAR_CODE_QUESTION_RELATIONSHIPS.join(", ")}.`,
  "One file's committed context: supply path alone."
]);

export function invalidQueryInput(message, details = {}) {
  const error = new TypeError(`code-index query input ${message}`);
  error.code = SIDECAR_QUERY_INPUT_INVALID;
  return Object.assign(error, details);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function present(options, key) {
  return Object.hasOwn(options, key) && options[key] !== undefined;
}

function transportOptions(options, allowed) {
  if (!plainObject(options)) throw invalidQueryInput("must be an object");
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw invalidQueryInput(`does not accept ${key}`);
  }
  const input = {};
  for (const key of ["dir", "cacheDir", "repo"]) {
    if (!present(options, key) || options[key] === null) continue;
    if (typeof options[key] !== "string" || options[key].trim().length === 0) {
      throw invalidQueryInput(`${key} must be a nonblank string`);
    }
    input[key] = options[key];
  }
  for (const key of ["includeSuppressed", "verbose"]) {
    if (!present(options, key) || options[key] === null) continue;
    if (typeof options[key] !== "boolean") throw invalidQueryInput(`${key} must be a boolean`);
    input[key] = options[key];
  }
  return input;
}

function diffRecord(record, index) {
  if (!plainObject(record)) throw invalidQueryInput(`diffRecords[${index}] must be an object`);
  for (const key of Object.keys(record)) {
    if (!DIFF_RECORD_KEYS.has(key)) throw invalidQueryInput(`diffRecords[${index}] does not accept ${key}`);
  }
  if (present(record, "changeKind") && typeof record.changeKind !== "string") {
    throw invalidQueryInput(`diffRecords[${index}].changeKind must be a string`);
  }
  for (const key of ["oldPath", "newPath"]) {
    if (present(record, key) && record[key] !== null && typeof record[key] !== "string") {
      throw invalidQueryInput(`diffRecords[${index}].${key} must be a string or null`);
    }
  }
  return structuredClone(record);
}

function impactNarrowing(options) {
  const narrowing = {};
  for (const key of NARROWING_KEYS) {
    if (!present(options, key) || options[key] === null) continue;
    if (typeof options[key] !== "string" || options[key].trim().length === 0) {
      throw invalidQueryInput(`${key} must be a nonblank string`);
    }
    narrowing[key] = options[key];
  }
  return Object.keys(narrowing).length > 0 ? narrowing : null;
}

export function normalizeSidecarImpactInput(options = {}) {
  const input = transportOptions(options, IMPACT_KEYS);
  if (present(options, "liveGit") && typeof options.liveGit !== "boolean") {
    throw invalidQueryInput("liveGit must be a boolean");
  }
  const subjects = ["paths", "patchText", "diffRecords", "liveGit"].filter((key) =>
    key === "liveGit" ? options.liveGit === true : present(options, key));
  if (subjects.length !== 1) {
    throw invalidQueryInput(subjects.length === 0
      ? "requires exactly one of paths, patchText, diffRecords or liveGit:true"
      : `accepts exactly one subject; received ${subjects.join(", ")}`);
  }
  const [subject] = subjects;
  if (subject === "paths") {
    if (!Array.isArray(options.paths) || options.paths.some((value) => typeof value !== "string")) {
      throw invalidQueryInput("paths must be an array of strings");
    }
    input.subject = { kind: "paths", paths: [...options.paths] };
  } else if (subject === "patchText") {
    if (typeof options.patchText !== "string") throw invalidQueryInput("patchText must be a string");
    input.subject = { kind: "patch_text", patch_text: options.patchText };
  } else if (subject === "diffRecords") {
    if (!Array.isArray(options.diffRecords)) throw invalidQueryInput("diffRecords must be an array");
    input.subject = { kind: "diff_records", diff_records: options.diffRecords.map(diffRecord) };
  } else {
    input.subject = { kind: "live_git" };
  }
  const narrowing = impactNarrowing(options);
  if (narrowing !== null) input.narrowing = narrowing;
  return input;
}

export function normalizeSidecarContextInput(options = {}) {
  const input = transportOptions(options, CONTEXT_KEYS);
  if (typeof options.path !== "string" || options.path.trim().length === 0) {
    throw invalidQueryInput("path must be a nonblank string");
  }
  try {
    input.path = validateVirtualSidecarPath(options.path).relativePath;
  } catch (error) {
    if (!(error instanceof SidecarPathValidationError)) throw error;
    throw invalidQueryInput(`path is not a valid repository-relative path: ${error.reason ?? error.message}`,
      { cause: error, path_code: error.code ?? null });
  }
  input.input_path = options.path;
  return input;
}

function withAlternativeText(error) {
  error.alternatives ??= [...SIDECAR_CODE_QUESTION_ALTERNATIVES];
  error.message = `${error.message}. Supported code questions: ${
    error.alternatives.map((text, index) => `(${index + 1}) ${text}`).join(" ")}`;
  return error;
}

function codeQuestionCorrection(message, details = {}) {
  return withAlternativeText(invalidQueryInput(message, details));
}

function withCodeQuestionAlternatives(normalize) {
  try {
    return normalize();
  } catch (error) {
    if (error?.code === SIDECAR_QUERY_INPUT_INVALID ||
        error?.code === "sidecar_navigation_input_invalid") {
      withAlternativeText(error);
    }
    throw error;
  }
}

function suppliedSelectors(options, keys) {
  return keys.filter((key) => (key === "liveGit" ? options.liveGit === true : present(options, key)));
}

function pickSupplied(options, keys) {
  const picked = {};
  for (const key of keys) {
    if (present(options, key)) picked[key] = options[key];
  }
  return picked;
}

function codeQuestionRelationship(options) {
  if (!present(options, "relationship") || options.relationship === null) return null;
  if (!SIDECAR_CODE_QUESTION_RELATIONSHIPS.includes(options.relationship)) {
    throw codeQuestionCorrection(
      `relationship must be one of ${SIDECAR_CODE_QUESTION_RELATIONSHIPS.join(", ")}`,
      { supported_relationships: [...SIDECAR_CODE_QUESTION_RELATIONSHIPS] }
    );
  }
  return options.relationship;
}

export function normalizeSidecarCodeQuestionInput(options = {}) {
  if (!plainObject(options)) throw codeQuestionCorrection("must be an object");
  for (const key of Object.keys(options)) {
    if (!CODE_QUESTION_KEYS.has(key)) throw codeQuestionCorrection(`does not accept ${key}`);
  }
  if (present(options, "liveGit") && typeof options.liveGit !== "boolean") {
    throw codeQuestionCorrection("liveGit must be a boolean");
  }
  const change = suppliedSelectors(options, CHANGE_SELECTORS);
  const position = suppliedSelectors(options, ["line", "character"]);
  const relationship = codeQuestionRelationship(options);

  if (change.length > 0) {
    if (position.length > 0) {
      throw codeQuestionCorrection(
        `a change subject does not accept ${position.join(" or ")}; ${position.join(" and ")} ` +
          "asks a source-location question about one position",
        { conflicting_selectors: [...change, ...position] }
      );
    }
    if (relationship !== null) {
      throw codeQuestionCorrection(
        "relationship narrows a symbol or source-location question, not a change subject",
        { conflicting_selectors: [...change, "relationship"] });
    }
    const selected = pickSupplied(options, [...TRANSPORT_KEYS, ...CHANGE_SELECTORS, ...NARROWING_KEYS]);
    return { query_kind: "impact", relationship: null, arguments: selected,
      input: withCodeQuestionAlternatives(() => normalizeSidecarImpactInput(selected)) };
  }

  if (present(options, "symbol") || position.length > 0) {
    if (present(options, "includeSuppressed")) {
      throw codeQuestionCorrection(
        "a symbol or source-location question reads committed symbols and does not accept includeSuppressed",
        { conflicting_selectors: ["includeSuppressed"] }
      );
    }
    const selected = pickSupplied(options,
      [...NAVIGATION_TRANSPORT_KEYS, "symbol", "path", "line", "character"]);
    return { query_kind: "navigation", relationship, arguments: selected,
      input: withCodeQuestionAlternatives(() => normalizeSidecarNavigationInput(selected)) };
  }

  if (present(options, "path")) {
    if (relationship !== null) {
      throw codeQuestionCorrection(
        "relationship narrows a symbol or source-location question, not file context",
        { conflicting_selectors: ["path", "relationship"] });
    }
    const selected = pickSupplied(options, [...TRANSPORT_KEYS, "path"]);
    return { query_kind: "context", relationship: null, arguments: selected,
      input: withCodeQuestionAlternatives(() => normalizeSidecarContextInput(selected)) };
  }

  throw codeQuestionCorrection("requires a change, symbol or file selector");
}
