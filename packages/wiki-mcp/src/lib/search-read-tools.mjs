import { SEARCH_SOURCE_TEXT_MAX_SCALARS } from
  "@agent-chassis/wiki-core/src/operations/read-search-source.mjs";

export const SEARCH_FILTER_FIELDS = Object.freeze([
  "kind", "type", "status", "priority", "owner", "area", "initiative", "retrieval_role",
  "canonicality", "maintenance_mode", "knowledge_role", "evidence_stage", "retrieval_visibility",
  "lifecycle", "sensitivity", "topic", "history", "profile", "extensionNamespaces", "limit"
]);

export function getWorkspaceSearchValidationIssues(args) {
  const issues = [];
  if (args.continuation !== undefined) {
    for (const field of ["query", ...SEARCH_FILTER_FIELDS]) {
      if (args[field] !== undefined) issues.push({ code: "search_continuation_replacement_field", path: [field], message: "continuation resumes one exact ranked population and accepts no replacement query or scope" });
    }
  } else if (typeof args.query !== "string" || args.query.trim() === "") {
    issues.push({ code: "search_query_required", path: ["query"], message: "query is required when continuation is omitted" });
  }
  return issues;
}

export function searchSelectedReadSchemaShape(z) {
  return {
    search_match: z.string().min(1).optional().describe(
      "Opaque source token returned by workspace_search_repo; ordinary read selectors refuse with it."
    ),
    length: z.number().int().positive().max(SEARCH_SOURCE_TEXT_MAX_SCALARS).optional().describe(
      `Only with search_match; 1-${SEARCH_SOURCE_TEXT_MAX_SCALARS} Unicode scalars.`
    )
  };
}

export function isSearchSelectedRead(args) {
  return args.search_match !== undefined;
}

export function getSearchSelectedReadValidationIssues(args, ordinaryFields) {
  if (!isSearchSelectedRead(args)) {
    return args.length === undefined ? [] : [{ code: "search_source_length_without_selection", path: ["length"], message: "length is available only with search_match" }];
  }
  const issues = [];
  for (const field of ordinaryFields) {
    if (args[field] !== undefined) issues.push({ code: "search_source_mixed_read_branch", path: [field], message: "search_match is a separate selected-source read branch" });
  }
  return issues;
}
