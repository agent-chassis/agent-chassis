

import { mkdir, stat } from "node:fs/promises";

export const DEFAULT_PROFILE = "standard";

export const GENERATED_VIEW_NAMES = new Set([
  "catalog.md",
  "now.md",
  "inbox.md",
  "backlog.md",
  "archive.md"
]);

export async function ensureDirectory(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function resolveProfileName(profileName, manifest) {
  const resolved = String(profileName || DEFAULT_PROFILE).toLowerCase();
  if (!manifest.profiles[resolved]) {
    throw new Error(`Unsupported profile: ${profileName}`);
  }
  return resolved;
}

export function normalizeType(type, manifest) {
  const normalized = String(type || "").toLowerCase();

  for (const [canonicalType, definition] of Object.entries(manifest.types)) {
    if (canonicalType === normalized) {
      return canonicalType;
    }
    if ((definition.aliases || []).includes(normalized)) {
      return canonicalType;
    }
  }

  throw new Error(`Unsupported type: ${type}`);
}

export function normalizeExtensionNamespaces(extensionNamespaces) {
  const values = Array.isArray(extensionNamespaces)
    ? extensionNamespaces
    : String(extensionNamespaces || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  return [...new Set(values.map((value) => slugify(value)).filter(Boolean))].sort();
}

export function normalizeStringList(values, { slug = false, sort = true } = {}) {
  const list = Array.isArray(values)
    ? values
    : values == null
      ? []
      : [values];

  const normalized = [];
  for (const value of list) {
    const stringValue = String(value ?? "").trim();
    if (!stringValue) {
      continue;
    }
    normalized.push(slug ? slugify(stringValue) : stringValue.toLowerCase());
  }

  const deduped = [...new Set(normalized)];
  return sort ? deduped.sort((left, right) => left.localeCompare(right)) : deduped;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
