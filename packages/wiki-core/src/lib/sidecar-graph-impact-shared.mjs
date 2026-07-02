import path from "node:path";

import {
  SidecarPathValidationError,
  validateVirtualSidecarPath
} from "./sidecar-paths.mjs";

const GRAPH_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".py",
  ".ts",
  ".tsx"
]);

const GRAPH_PARSED_PATH_PATTERNS = [
  /^docs\/.+\.md$/,
  /^wiki\/(?:issues|initiatives)\/(?:WK|IN)-\d{4}\.md$/,
  /\.(?:cjs|cts|js|jsx|mjs|mts|py|ts|tsx)$/
];

export const SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS = Object.freeze({
  max_bytes: 1048576,
  max_lines: 20000,
  max_records: 1000
});

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function asStringList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.trim()).map(String);
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}

export function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

export function provenance({ evidenceBasis = "unknown", sourceKind = "code_index" } = {}) {
  return {
    source_kind: sourceKind,
    canonicality: "derived",
    evidence_basis: evidenceBasis
  };
}

export function graphProvenance(relativePath = null) {
  return {
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "parser_extract",
    ...(relativePath ? { path: relativePath } : {})
  };
}

export function validateImpactPath(inputPath) {
  try {
    const { relativePath } = validateVirtualSidecarPath(inputPath);
    return {
      ok: true,
      input_path: inputPath,
      relative_path: relativePath,
      hint: {
        kind: "sidecar_path_validation",
        input_path: inputPath,
        relative_path: relativePath,
        valid: true,
        provenance: provenance({ evidenceBasis: "path_match" })
      }
    };
  } catch (error) {
    if (!(error instanceof SidecarPathValidationError)) {
      throw error;
    }
    return {
      ok: false,
      input_path: inputPath,
      relative_path: error.relativePath ?? null,
      hint: {
        kind: "sidecar_path_validation",
        input_path: String(inputPath),
        relative_path: error.relativePath ?? null,
        valid: false,
        code: error.code,
        pattern: error.pattern ?? null,
        reason: error.reason ?? error.message,
        message: error.message,
        provenance: provenance({ evidenceBasis: error.pattern ? "path_match" : "unknown" })
      }
    };
  }
}

export function pageKindForPath(relativePath) {
  if (relativePath.startsWith("docs/")) {
    return "docs";
  }
  if (relativePath.startsWith("wiki/issues/")) {
    return "issues";
  }
  if (relativePath.startsWith("wiki/initiatives/")) {
    return "initiatives";
  }
  if (relativePath.startsWith("wiki/decisions/")) {
    return "decisions";
  }
  if (relativePath.startsWith("wiki/sources/")) {
    return "sources";
  }
  if (relativePath.startsWith("wiki/areas/")) {
    return "areas";
  }
  if (relativePath.startsWith("wiki/")) {
    return "wiki";
  }
  return "unknown";
}

export function isGraphTextSource(relativePath) {
  return GRAPH_TEXT_EXTENSIONS.has(path.posix.extname(relativePath));
}

export function isParsedGraphPath(relativePath) {
  return GRAPH_PARSED_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

export function isGraphOverlaySourcePath(relativePath) {
  return !(
    relativePath.startsWith("docs/") ||
    relativePath.startsWith("internal/") ||
    relativePath.startsWith("wiki/")
  );
}
