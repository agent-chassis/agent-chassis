import { createHash } from "node:crypto";
import path from "node:path";
import { isPlainObject, MAX_KEYS } from "./core.mjs";

const SAFE_REPO_RELATIVE_CANONICAL_PATH_RE =
  /^(?:AGENTS\.md|docs\/[A-Za-z0-9._/-]+|wiki\/(?:work-records\/WK-\d{4}\.json|(?:areas|decisions|initiatives|sources|issues)\/[A-Za-z0-9._/-]+))(?:#[A-Za-z0-9._:-]+)?$/;
const CANONICAL_ID_RE = /\b(?:WK|IN|DEC|SRC)-\d{4}(?:#SLICE-\d{3})?\b/g;
const SECRET_KEY_RE = /\b(?:token|secret|api[_-]?key|authorization|bearer|password|passwd|credential|auth|cookie|session)\b/i;
const PATH_FRAGMENT_RE =
  /(?:\/(?:home|tmp|var|workspace|private|Users)\/[^\s"'`),\]}]+|\.agent-runs\/[^\s"'`),\]}]+|[A-Za-z]:\\[^\s"'`),\]}]+)/g;
const PATH_FIELD_TOKEN_RE =
  /^(?:path|paths|file|files|dir|directory|cwd|root|workspace|artifact|artifacts|snapshot|transcript|stdout|stderr|response|spill)$/i;

export function sha256Text(text) {
  return `sha256:${createHash("sha256").update(String(text), "utf8").digest("hex")}`;
}

export function sha256Buffer(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

export function categoryForPath(rawPath) {
  const value = String(rawPath);
  if (isSafeRepoRelativeCanonicalPath(value)) return "safe_repo_relative_canonical";
  if (value.includes(".agent-runs/") || value.includes(`${path.sep}.agent-runs${path.sep}`)) return "agent_runs_artifact";
  if (/\/(?:home|Users)\//.test(value)) return "home_path";
  if (/\/tmp\/|\\Temp\\|\\tmp\\/.test(value)) return "tmp_path";
  if (/auth|token|secret|credential|cookie|session/i.test(value)) return "auth_or_secret_path";
  if (/response|spill|stdout|stderr/i.test(value)) return "response_or_log_artifact";
  if (path.isAbsolute(value) || /^[A-Za-z]:\\/.test(value)) return "absolute_path";
  if (/^(?:docs|wiki|packages|tests|tools|internal)\//.test(value)) return "repo_relative_noncanonical";
  return "other_path";
}

export function redactPath(rawPath) {
  const value = String(rawPath);
  const category = categoryForPath(value);
  if (category === "safe_repo_relative_canonical") {
    return { path_category: category, path: value, path_digest: sha256Text(value) };
  }
  return { path_category: category, path_digest: sha256Text(value) };
}

export function redactText(value) {
  const text = String(value);
  const canonicalIds = Array.from(new Set(text.match(CANONICAL_ID_RE) ?? [])).sort();
  const pathReferences = collectPathReferences(text);
  return {
    text_digest: sha256Text(text),
    text_bytes: Buffer.byteLength(text, "utf8"),
    canonical_ids: canonicalIds,
    path_reference_count: pathReferences.length,
    path_references: pathReferences.slice(0, MAX_KEYS),
    truncated_path_references: pathReferences.length > MAX_KEYS,
    contains_secret_like_text: /(?:Bearer\s+|token=|api[_-]?key=|password=|secret=)[^\s"'`),\]}]+/i.test(text)
  };
}

export function redactSubject(subject) {
  const canonicalIds = Array.from(new Set(String(subject).match(CANONICAL_ID_RE) ?? [])).sort();
  return {
    digest: sha256Text(subject),
    canonical_ids: canonicalIds
  };
}

export function artifactDescriptor(filePath, buffer = null) {
  return {
    ...redactPath(filePath),
    digest: buffer ? sha256Buffer(buffer) : sha256Text(filePath)
  };
}

export function redactPayload(value) {
  if (value === undefined) return { category: "absent" };
  const serialized = safeStableStringify(value);
  const pathReferences = collectPathReferences(value);
  return {
    ...summarizeObjectShape(value),
    digest: sha256Text(serialized),
    byte_count: Buffer.byteLength(serialized, "utf8"),
    contains_path_like_text: pathReferences.length > 0,
    path_reference_count: pathReferences.length,
    path_references: pathReferences.slice(0, MAX_KEYS),
    truncated_path_references: pathReferences.length > MAX_KEYS,
    contains_sensitive_key: containsSensitiveKey(value)
  };
}

function summarizeObjectShape(value) {
  if (!isPlainObject(value)) {
    return { category: Array.isArray(value) ? "array" : typeof value };
  }
  const keys = Object.keys(value).sort();
  return {
    category: "object",
    key_count: keys.length,
    truncated_keys: keys.length > MAX_KEYS,
    sensitive_key_count: keys.filter((key) => SECRET_KEY_RE.test(key)).length
  };
}

function collectPathReferences(value) {
  const references = new Map();
  function add(rawPath) {
    const redacted = redactPath(rawPath);
    const key = `${redacted.path_category}:${redacted.path_digest}`;
    if (!references.has(key)) references.set(key, redacted);
  }
  function inspectString(text) {
    if (isSafeRepoRelativeCanonicalPath(text) || /^(?:docs|wiki|packages|tests|tools|internal)\//.test(text)) {
      add(text);
    }
    for (const match of text.matchAll(PATH_FRAGMENT_RE)) add(match[0]);
  }
  function isPathFieldName(key) {
    const tokens = String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .split(/[^A-Za-z0-9]+|_/)
      .filter(Boolean);
    return tokens.some((token) => PATH_FIELD_TOKEN_RE.test(token));
  }
  function walk(entry, keyHint = null) {
    if (typeof entry === "string") {
      inspectString(entry);
      if (keyHint && isPathFieldName(keyHint)) add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, keyHint);
      return;
    }
    if (!isPlainObject(entry)) return;
    for (const [key, item] of Object.entries(entry)) {
      inspectString(key);
      if (typeof item === "string" && isPathFieldName(key)) add(item);
      walk(item, key);
    }
  }
  walk(value);
  return [...references.values()].sort((a, b) => {
    const categoryCompare = a.path_category.localeCompare(b.path_category);
    if (categoryCompare !== 0) return categoryCompare;
    return a.path_digest.localeCompare(b.path_digest);
  });
}

function isSafeRepoRelativeCanonicalPath(value) {
  if (!SAFE_REPO_RELATIVE_CANONICAL_PATH_RE.test(value)) return false;
  if (value.includes("%")) return false;
  const [pathPart] = value.split("#", 1);
  if (pathPart !== path.posix.normalize(pathPart)) return false;
  return pathPart.split("/").every((segment) => segment !== "." && segment !== "..");
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveKey(entry));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, entry]) => SECRET_KEY_RE.test(key) || containsSensitiveKey(entry));
}

function safeStableStringify(value) {
  const seen = new WeakSet();
  function normalize(entry) {
    if (entry === null || typeof entry !== "object") return entry;
    if (seen.has(entry)) return "[Circular]";
    seen.add(entry);
    if (Array.isArray(entry)) return entry.map((item) => normalize(item));
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
  }
  return JSON.stringify(normalize(value));
}
