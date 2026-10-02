

import {
  classifyControlledContractPrivatePathEntry
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-private-path-policy.mjs";
import {
  UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR,
  parseRepositoryScopeFileSelector,
  repositoryScopeSelectorRefusalMessage
} from "@agent-chassis/wiki-core/src/lib/work-record-repository-path.mjs";

export function deriveCanonicalUnitScope(entries, label, recordPath, {
  required = true,
  invalid,
  forbidGitMetadata = false
} = {}) {
  if (!Array.isArray(entries)) {
    if (!required && entries === undefined) return Object.freeze([]);
    invalid(`${label} for the exact selected unit must be an array in ${recordPath}`);
  }
  const normalized = [];
  for (const entry of entries) {
    const parsed = parseRepositoryScopeFileSelector(entry);
    if (!parsed.ok && parsed.diagnostic.code === UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR) {
      invalid(`${repositoryScopeSelectorRefusalMessage(label, entry)} (${recordPath})`,
        { field: label, path: entry, kind: "unsupported_selector",
          selector_kind: parsed.diagnostic.selector_kind });
    }
    if (!parsed.ok) {
      invalid(`${label} contains a non-canonical repository-relative path in ${recordPath}: ${JSON.stringify(entry)}`,
        { field: label, path: entry, kind: "non_canonical" });
    }
    if (forbidGitMetadata && parsed.value.components.includes(".git")) {
      invalid(`${label} contains a forbidden Git metadata path in ${recordPath}: ${JSON.stringify(entry)}`,
        { field: label, path: entry, kind: "git_metadata" });
    }
    normalized.push(entry);
  }

  const privateLiteral = (entry) =>
    ["exact", "directory"].includes(classifyControlledContractPrivatePathEntry(entry).match_kind);
  return Object.freeze([...new Set(normalized)].sort().filter((entry) => !privateLiteral(entry)));
}

export function deriveCanonicalReadableScope(readScope, repoPaths) {
  return Object.freeze([...new Set([...readScope, ...repoPaths])].sort());
}
