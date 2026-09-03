import path from "node:path";

export const CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT = "wiki/contracts";
export const CONTROLLED_CONTRACT_PRIVATE_SCOPE_FIELDS = Object.freeze([
  "read_scope", "repo_paths", "write_scope"
]);
export const CONTROLLED_CONTRACT_PRIVATE_PATH_MATCH_KINDS = Object.freeze([
  "exact", "directory", "ancestor", "wildcard"
]);

function normalizedEntry(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\") ||
      trimmed.includes("\0")) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return trimmed;
}

function wildcardSegmentMatcher(segment) {
  if (segment === "**") return "globstar";
  let source = "^";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "*") {
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const closing = segment.indexOf("]", index + 1);
      if (closing < 0 || closing === index + 1) return null;
      let members = segment.slice(index + 1, closing);
      const negated = members.startsWith("!");
      if (negated) members = members.slice(1);
      if (!members || members.includes("[")) return null;
      source += `[${negated ? "^" : ""}${members}]`;
      index = closing;
      continue;
    }
    if (character === "]") return null;
    source += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }
  try {
    return new RegExp(`${source}$`, "u");
  } catch {
    return null;
  }
}

function wildcardIntersectsPrivateFamily(value) {
  const privateSegments = CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT.split("/");
  const matchers = value.split("/").map(wildcardSegmentMatcher);
  if (matchers.some((matcher) => matcher === null)) return null;
  const visited = new Set();
  function intersects(patternIndex, privateIndex) {
    const key = `${patternIndex}:${privateIndex}`;
    if (visited.has(key)) return false;
    visited.add(key);
    if (patternIndex === matchers.length) return privateIndex === privateSegments.length;
    const matcher = matchers[patternIndex];
    if (matcher === "globstar") {
      if (intersects(patternIndex + 1, privateIndex)) return true;
      if (privateIndex < privateSegments.length) {
        return intersects(patternIndex, privateIndex + 1);
      }
      return true;
    }
    if (privateIndex < privateSegments.length) {
      return matcher.test(privateSegments[privateIndex]) &&
        intersects(patternIndex + 1, privateIndex + 1);
    }

    return true;
  }
  return intersects(0, 0);
}

export function classifyControlledContractPrivatePathEntry(value) {
  const normalized = normalizedEntry(value);
  if (normalized === null) return Object.freeze({
    intersects: false,
    valid: false,
    entry: typeof value === "string" ? value : null,
    normalized: null,
    private_root: CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
    match_kind: null
  });
  const wildcard = /[?*[\]]/u.test(normalized);
  let matchKind = null;
  if (wildcard) {
    const intersects = wildcardIntersectsPrivateFamily(normalized);
    if (intersects === null) return Object.freeze({
      intersects: false,
      valid: false,
      entry: value,
      normalized: null,
      private_root: CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
      match_kind: null
    });
    if (intersects) matchKind = "wildcard";
  } else if (normalized === CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT) {
    matchKind = "exact";
  } else if (normalized.startsWith(`${CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT}/`)) {
    matchKind = "directory";
  } else if (CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT.startsWith(`${normalized}/`)) {
    matchKind = "ancestor";
  }
  return Object.freeze({
    intersects: matchKind !== null,
    valid: true,
    entry: value,
    normalized: path.posix.normalize(normalized),
    private_root: CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
    match_kind: matchKind
  });
}

export function collectControlledContractPrivateScopeIntersections(unit, {
  unitAddress = null,
  status = unit?.status ?? null,
  parentStatus = null
} = {}) {
  const facts = [];
  if (!unit || typeof unit !== "object") return Object.freeze(facts);
  for (const field of CONTROLLED_CONTRACT_PRIVATE_SCOPE_FIELDS) {
    const entries = Array.isArray(unit[field]) ? unit[field] : [];
    for (let index = 0; index < entries.length; index += 1) {
      const classification = classifyControlledContractPrivatePathEntry(entries[index]);
      if (!classification.intersects) continue;
      facts.push(Object.freeze({
        schema_version: "controlled-contract-private-scope-policy-fact.v1",
        unit_address: unitAddress,
        status,
        parent_status: parentStatus,
        field,
        index,
        entry: classification.entry,
        normalized_entry: classification.normalized,
        private_root: classification.private_root,
        match_kind: classification.match_kind,
        policy_authority: "possible_cce_input",
        local_refusal_authority: false,
        authenticated_cce_decision_required_for_policy_disposition: true
      }));
    }
  }
  return Object.freeze(facts.sort((left, right) =>
    String(left.unit_address).localeCompare(String(right.unit_address), "en") ||
    left.field.localeCompare(right.field, "en") || left.index - right.index));
}

export function collectWorkRecordControlledContractPrivateScopeFacts(record) {
  if (!record || typeof record !== "object") return Object.freeze([]);
  const facts = [...collectControlledContractPrivateScopeIntersections(record, {
    unitAddress: record.id ?? null,
    status: record.status ?? null
  })];
  for (const slice of Array.isArray(record.slices) ? record.slices : []) {
    facts.push(...collectControlledContractPrivateScopeIntersections(slice, {
      unitAddress: typeof record.id === "string" && typeof slice?.id === "string"
        ? `${record.id}#${slice.id}` : null,
      status: slice?.status ?? null,
      parentStatus: record.status ?? null
    }));
  }
  return Object.freeze(facts.sort((left, right) =>
    String(left.unit_address).localeCompare(String(right.unit_address), "en") ||
    left.field.localeCompare(right.field, "en") || left.index - right.index));
}

export function excludeControlledContractPrivatePaths(entries) {
  return Object.freeze((Array.isArray(entries) ? entries : []).filter((entry) =>
    !["exact", "directory", "wildcard"].includes(
      classifyControlledContractPrivatePathEntry(entry).match_kind
    )));
}
