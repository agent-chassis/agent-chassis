import { parseScipSymbol } from "./sidecar-scip-normalize.mjs";
import { validateVirtualSidecarPath } from "./sidecar-paths.mjs";

const NAVIGATION_INPUT_KEYS = new Set([
  "dir", "cacheDir", "repo", "verbose", "symbol", "path", "line", "character"
]);
const LINE_TEXT = /^[1-9][0-9]*$/;
const CHARACTER_TEXT = /^(0|[1-9][0-9]*)$/;

function invalidInput(message) {
  const error = new TypeError(`definition/reference input ${message}`);
  error.code = "sidecar_navigation_input_invalid";
  return error;
}

function supplied(value) {
  return value !== undefined && value !== null;
}

function nonblankString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`${name} must be a nonblank string`);
  }
  return value;
}

function safeInteger(name, value, minimum, pattern) {
  let numeric;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string" && pattern.test(value)) {
    numeric = Number(value);
  } else {
    throw invalidInput(`${name} must be a canonical decimal integer >= ${minimum}`);
  }
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw invalidInput(`${name} must be a safe integer >= ${minimum}`);
  }
  return numeric;
}

export function normalizeSidecarNavigationInput(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw invalidInput("must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!NAVIGATION_INPUT_KEYS.has(key)) throw invalidInput(`does not accept ${key}`);
  }
  const input = {};
  for (const key of ["dir", "cacheDir", "repo"]) {
    if (supplied(options[key])) input[key] = nonblankString(key, options[key]);
  }
  if (supplied(options.verbose)) {
    if (typeof options.verbose !== "boolean") throw invalidInput("verbose must be a boolean");
    input.verbose = options.verbose;
  }
  if (supplied(options.symbol)) input.symbol = nonblankString("symbol", options.symbol);
  if (supplied(options.path)) {
    input.path = nonblankString("path", options.path);
    validateVirtualSidecarPath(input.path);
  }
  if (supplied(options.line)) input.line = safeInteger("line", options.line, 1, LINE_TEXT);
  if (supplied(options.character)) {
    input.character = safeInteger("character", options.character, 0, CHARACTER_TEXT);
  }

  if (Object.hasOwn(input, "symbol")) {
    if (Object.hasOwn(input, "line") || Object.hasOwn(input, "character")) {
      throw invalidInput("accepts either symbol or path+line, not both");
    }
    if (Object.hasOwn(input, "path") && !parseScipSymbol(input.symbol).local) {
      throw invalidInput("accepts path with a symbol only for a document-local symbol");
    }
    return input;
  }
  if (Object.hasOwn(input, "character") && !Object.hasOwn(input, "line")) {
    throw invalidInput("character requires line");
  }
  if (!Object.hasOwn(input, "path") || !Object.hasOwn(input, "line")) {
    throw invalidInput("requires either symbol or path+line");
  }
  return input;
}
