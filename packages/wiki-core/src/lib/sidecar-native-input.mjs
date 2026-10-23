import { parseScipSymbol } from "./sidecar-scip-normalize.mjs";
import { validateVirtualSidecarPath } from "./sidecar-paths.mjs";

export function nativeInputError(message) {
  const error = new TypeError(`definition/reference input ${message}`);
  error.code = "sidecar_navigation_input_invalid";
  return error;
}

export function requireNativeNonblankString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw nativeInputError(`${name} must be a nonblank string`);
  }
  return value;
}

export function requireNativePath(value) {
  const path = requireNativeNonblankString("path", value);
  validateVirtualSidecarPath(path);
  return path;
}

export function assertNativeSymbolPath(symbol) {
  if (!parseScipSymbol(symbol).local) {
    throw nativeInputError("accepts path with a symbol only for a document-local symbol");
  }
}
