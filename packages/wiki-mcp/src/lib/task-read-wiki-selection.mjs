

import { resolveReadWikiSelectionGrantsFromPolicy } from
  "@agent-chassis/wiki-core/src/lib/tool-discovery/gating.mjs";

export const READ_WIKI_TOOL = "workspace_read_wiki";

export const READ_WIKI_SOURCE_KINDS = Object.freeze({
  RECORD: "record",
  CANONICAL_RECORD: "canonical_record",
  DOCUMENT: "document",
  MANIFEST: "manifest",
  REPOSITORY: "repository",
  REQUIREMENT_GUIDANCE: "requirement_guidance",

  RECORD_KIND: "record_kind",
  SEARCH: "search",
  ASSIGNMENT: "assignment",
  ASSIGNED_CONTRACT: "assigned_contract",
  ENTRY: "entry",
  RECEIPT: "receipt",
  PACKAGE_DOCUMENT: "package_document"
});

export const READ_WIKI_SELECTIONS = Object.freeze([
  "context", "field", "inventory", "entry", "text", "integrity", "currentness",
  "membership", "action", "contract", "obligation", "finding", "guidance", "input_contract"
]);

export function createReadWikiGrants(policy, role) {

  resolveReadWikiSelectionGrantsFromPolicy(policy, { source_kind: "record", selection: "context" });
  const rows = policy.read_selections.filter((row) => row.roles.includes(role))
    .map((row) => Object.freeze({ source_kind: row.source_kind, selection: row.selection }));
  return Object.freeze({
    role,
    rows: Object.freeze(rows),
    granted: (sourceKind, selection) => resolveReadWikiSelectionGrantsFromPolicy(policy,
      { source_kind: sourceKind, selection }).has(role),
    contextKinds: Object.freeze([...new Set(rows.filter((row) => row.selection === "context")
      .map((row) => row.source_kind))]),
    selections: Object.freeze([...new Set(rows.map((row) => row.selection))])
  });
}
