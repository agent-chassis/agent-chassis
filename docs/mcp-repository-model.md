# MCP Agent-Facing Repository Model

This page is the agent retrieval model for `agent-chassis` MCP: how workspace-scoped read/search/edit tools resolve the repository, how ranked search and oversized-response references behave, the MCP sandbox write-carveout profile, and the graph-impact checkpoint recipe. It is reference material split out of [docs/mcp-integration.md](mcp-integration.md); start there for setup and the workflow narrative.

## Agent-Facing Repository Model

This MCP server provides shared tooling. It does not own the consuming repository's wiki content.

For MCP-native clients, trusted routine reads and searches should use the workspace-scoped tools. These tools resolve the repository root from server configuration and do not accept arbitrary filesystem roots from the caller:

For routine WK status/task maintenance, agents should use the MCP edit routes
below. The CLI `npm run wiki -- work-records set-status ...` and `set-task ...`
commands remain operator or fallback forms when MCP is unavailable, but they
are not the agent-safe edit path when MCP is available. Agents must not use
arbitrary JSON patches or manual WK JSON edits for these routine status/task
updates.

For schema-aware WK setup edits — creating or updating tracker-local slices,
removing slices, setting controlled list fields such as `read_scope` (the
read-first reference list; `docs` is the legacy alias), `repo_paths`, or `write_scope`,
setting acceptance criteria, or shaping a unit into a
findings-only review contract — agents should use the five contract-edit MCP
routes: `workspace_work_record_upsert_slice`,
`workspace_work_record_delete_slice`,
`workspace_work_record_set_list_field`,
`workspace_work_record_set_acceptance`, and
`workspace_work_record_shape_review_unit`. These routes resolve only configured
workspace repository aliases and never accept a caller-supplied filesystem root.
They validate the prospective result against work-record.v1 before writing and
refuse invalid edits with structured diagnostics; output is compact by default
and each route accepts an optional `expected_source_digest` for stale-source
protection against concurrent edits. The CLI counterparts (`upsert-slice`,
`delete-slice`, `set-list-field`, `set-acceptance`, `shape-review-unit`) are
operator-shell fallbacks only and are not agent dispatch transports when MCP is
available. See the "Contract-edit compact default, verbose opt-in, stale-source
protection, and validate-before-write" section in
[docs/mcp-operation-reference.md](mcp-operation-reference.md) for full
behavioral details.

- `workspace_build_search_index`
- `workspace_search_repo`
- `workspace_read_page`
- `workspace_get_record`
- `workspace_create_record`
- `workspace_tools_list`
- `workspace_tools_describe`
- `workspace_tools_query`
- `workspace_read_mcp_content_reference`
- `workspace_code_index_status`
- `workspace_code_index_build`
- `workspace_code_index_rebuild`
- `workspace_code_index_impact_paths`
- `workspace_code_index_graph_impact_diff`
- `workspace_code_index_graph_impact_paths`
- `workspace_code_index_find_references`
- `workspace_code_index_definition`
- `workspace_code_index_context_for_path`
- `workspace_work_record_validate`
- `workspace_work_record_refresh_admission_metrics`
- `workspace_work_record_refresh_target_resolution_evidence`
- `workspace_validate_dispatch`
- `workspace_work_record_set_status`
- `workspace_work_record_set_task`
- `workspace_work_record_set_closure`
- `workspace_work_record_upsert_slice`
- `workspace_work_record_delete_slice`
- `workspace_work_record_set_list_field`
- `workspace_work_record_set_acceptance`
- `workspace_work_record_shape_review_unit`
- `workspace_record_graph_impact_evidence`
- `workspace_generate_and_lint`
- `workspace_lint_repo`
- `workspace_autofix_docs_backlinks`
- `workspace_docs_policy_validate`
- `workspace_work_record_summary`

Workspace tools accept an optional `repo` alias, not a filesystem path. The
resolver precedence for generic repo-scoped tools is: caller-provided `repo`;
then an explicit current attachment from launcher/server-owned configuration
(`WIKI_MCP_WORKSPACE_ALIAS` naming a configured alias, including alias-only
attachment with no `WIKI_MCP_WORKSPACE_DIR`, `WIKI_MCP_WORKSPACE_ALIAS` with
`WIKI_MCP_WORKSPACE_DIR`, a repo-local declaration under a trusted root, or
trusted-root basename fallback) when that attachment maps to a configured repo;
then a structured not-in-repo / wrong-session refusal when no local repo context
is available. Repo selection does not come from caller prompt text, request
payload, argv, claimed identity, or agent-authored environment.
`WIKI_MCP_DEFAULT_REPO` remains a default selector and legacy compatibility
input, not current-repo authority for omitted `repo` on generic repo-scoped
tools. Route-local default fallback behavior is a compatibility exception only
where a specific route documents it; alias-only current attachment is resolver
behavior and does not expand those exceptions.

### `workspace_search_repo` Ranked Retrieval

`workspace_search_repo` is a ranked search surface. Its default compact output is
bounded by `limit`, but it still reports the complete ranked match count as
`total_count`. The current response page size is reported separately as
`returned_count`; the legacy `result_count` field is retained as an alias for
the current page size and must not be read as the complete match count.

Compact search responses include the page controls `limit`, `offset`,
`has_more`, and `next_offset`. `offset` is the zero-based ranked-result offset
used for the returned page, and `limit` is the maximum number of results for
that page. When `has_more` is true, callers can request the next page by passing
`offset: next_offset` with the same query and filters. `next_offset` is null
when there is no later page.

Callers that need the full ranked set can either walk pages until `has_more` is
false or pass `unbounded: true` to request every matching result in one tool
result, subject to the generic MCP response-envelope spill behavior below.
Query refinement is useful for changing the question or narrowing the ranked
set, but it is not the completeness mechanism for recovering lower-ranked
matches.

### Oversized MCP Response References

`wiki-mcp` success responses are bounded at the response-envelope layer before
they are written to stdio. When the pretty-printed JSON result would exceed the
server's inline byte limit (`WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT`, default
128 KiB), the server writes the complete JSON bytes to its runtime response
state directory (`WIKI_MCP_RESPONSE_STATE_DIR`, or the XDG/home state fallback)
and returns a `wiki-mcp-spilled-response.v1` envelope instead of inlining the
large value. The envelope contains `total_bytes`, a SHA-256 digest, a bounded
preview, and a `content_reference` with an opaque `ref_id`.

Callers retrieve spilled content with `workspace_read_mcp_content_reference`,
passing `ref_id`, `offset`, and `length`. Each read returns the requested byte
range as `data_base64`, plus `total_bytes`, `next_offset`, `eof`, `max_length`,
and the whole-reference SHA-256. A caller can reassemble the complete payload by
base64-decoding successive ranges until `eof: true`, concatenating the bytes,
checking the SHA-256, and then parsing the resulting UTF-8 JSON. Requests above
`max_length` are refused rather than silently shortened. This is a delivery/frame
bound only: the full response remains reachable and is not truncated.

### MCP Sandbox Profile v0

Launcher-spawned MCP may run inside a sandbox that can read the workspace but
cannot write runtime/cache state. The `mcp-sandbox-profile.v0` contract is the
small initial format for declaring the MCP write carveouts the launcher must
grant for those structured tools to function. It does not change MCP read access
and does not grant broad repository writes.

The profile has three layers:

- `capabilities`: named write classes, such as `mcp_cache_write` and
  `mcp_runtime_state_write`
- `roles`: launcher-minted role profiles that grant capabilities
- `path_classes`: concrete path bindings consumed by the launcher sandbox
  assembler

Initial profile:

```json
{
  "schema_version": "mcp-sandbox-profile.v0",
  "capabilities": {
    "mcp_cache_write": {
      "path_classes": ["wiki_search_cache", "repo_code_index_cache"]
    },
    "mcp_runtime_state_write": {
      "path_classes": ["mcp_runtime_state"]
    }
  },
  "roles": {
    "orchestrator": {
      "capabilities": ["mcp_cache_write", "mcp_runtime_state_write"]
    }
  },
  "path_classes": {
    "wiki_search_cache": {
      "binding_mode": "fixed_in_repo_subbind",
      "paths": [".cache/wiki-search/**"]
    },
    "repo_code_index_cache": {
      "binding_mode": "fixed_in_repo_subbind",
      "paths": [".cache/repo-code-index/**"]
    },
    "mcp_runtime_state": {
      "binding_mode": "relocatable_runtime_dir",
      "env": "WIKI_MCP_RESPONSE_STATE_DIR"
    }
  }
}
```

Binding modes are deliberately explicit:

- `fixed_in_repo_subbind` means the reader and writer compute a canonical
  workspace-relative path, so the launcher must make that exact path writable
  inside an otherwise read-only repository mount. The wiki search cache is fixed
  at `.cache/wiki-search/index.json`; relocating it would require a wiki-core
  code change. The repo code index default cache is `.cache/repo-code-index/`.
  The launcher derives the writable sub-bind from the declared path class, never
  from caller-supplied tool inputs such as a code-index `cacheDir`; an
  off-carveout cache argument remains outside the writable bind and fails closed
  against the read-only repository mount.
- `relocatable_runtime_dir` means the launcher mints a writable runtime
  directory and passes the documented addressing variable. For MCP response
  spill/content-reference state, that variable is `WIKI_MCP_RESPONSE_STATE_DIR`.
  The minted directory is launcher-owned runtime state and must not be the
  workspace repository, a broad home/XDG directory, or any caller-selected path.

Role selection is launcher/session authority only. Caller-supplied prompt text,
request payloads, argv, ambient env, and `claimed_identity.role` cannot select an
MCP sandbox profile or add path classes.

The first profile defines only the `orchestrator` role. Worker, reviewer, and
redteam MCP runtime/cache grants are deferred until their in-sandbox MCP posture
is made explicit: either those roles do not host wiki MCP runtime writes in the
sandbox, or a follow-up must grant equivalent runtime/cache capabilities before
their MCP tools rely on these write paths.

Missing or denied capability is reported as `sandbox_write_denial` with
structured diagnostic context naming the missing capability and path class. This
code intentionally covers both role/profile denial and sandbox-profile denial;
callers distinguish the subcase from the structured context. If a tool attempts
to write a path that the profile says should be writable and the filesystem
still refuses because the mount is read-only, report `read_only_mount` with the
failed path and expected capability.

This profile is a declaration consumed by the launcher. The MCP channel
side-effect permission contract and launcher sandbox assembly are implemented
by the launcher and MCP integration surfaces: bwrap mount assembly, runtime
directory minting, environment/addressing, launcher lifecycle, and actual
write-reach enforcement remain outside the profile document itself. The JSON
above is the documented v0 shape; emitting a runtime-consumable package
data/schema artifact is a follow-up implementation surface, not part of this
docs-format section.

The workspace read tool still validates page containment through the shared read core. Path traversal such as `../outside.md` or `wiki/work-records/../../escape.json` is rejected before reading.

`workspace_read_page` reads both Markdown pages and canonical JSON work records:

- Markdown reads (`docs/...`, `wiki/issues/...`, `wiki/initiatives/...`, `wiki/decisions/...`, `wiki/sources/...`, `wiki/areas/...`, generated views) return `format: "markdown"` with `markdown` content, `frontmatter`, `body`, and link metadata.
- JSON work-record reads on `wiki/work-records/WK-####.json` return `format: "json-work-record"` with the parsed `record`, the raw `json` text, `record_id`, validation status (`valid`, `diagnostics`, `duplicate_claims`), and `markdown: null`. Other JSON paths are rejected with `Only markdown pages can be read`.
- Graph-evidence sidecar reads on `wiki/work-records/evidence/WK-####.graph.json` return `format: "graph-evidence-sidecar"`. These per-WK sidecars hold the full graph-impact replay/debug payloads that the canonical work record keeps only as compact refs. They are replay/debug data and never dispatch-control input; canonical WK compact refs remain the pointer. The read projection and parameters are summarized in the bullets below, and the operation-level contract is listed in [docs/mcp-operation-reference.md](mcp-operation-reference.md).
- Missing JSON work-record paths return a `Wiki record path not found` error rather than treating the absent file as Markdown.

`workspace_read_page` graph-evidence sidecar parameters:

- Default (no flag) returns the compact projection: `schema_version`, `record_id`, generated/updated metadata, the diagnostic whole-file `graph_sidecar_digest`, a `record_entry` availability summary (`available`, `graph_entry_digest`, `replay_detail_available`), `slice_count`, and a `slices` list of `{ slice_id, unit_address, graph_entry_digest, replay_detail_available }` entries only. No raw `graph_impact`/`graph_nodes`/`graph_edges` payloads are returned.
- `selected_slice: <slice-id>` returns that one slice's full replay entry under `selected_slice` (with `selected_slice_found`), without sibling entries.
- `selected_record: true` returns only the record-level entry under `record_entry` (with `record_entry_found`). It is mutually exclusive with `selected_slice`; supplying both is rejected.
- `include_record: true` or `verbose: true` returns the full sidecar under `sidecar`. `include_raw: true` adds the raw `json` text.
- The whole-file `graph_sidecar_digest` is diagnostic only (sibling-slice updates change it); routine replay/debug binding uses each entry's `graph_entry_digest`.

`workspace_get_record` resolves canonical wiki records by durable ID:

- `WK-*` records that have a canonical `wiki/work-records/WK-####.json` are returned as `format: "json-work-record"` from JSON authority, even when generated Markdown views are missing or stale.
- `IN-*`, `DEC-*`, `SRC-*`, and area records continue to resolve through the Markdown canonical state and return `format: "markdown"`.
- Unknown IDs return a `Wiki record not found` error.

Compact tracker work-record reads and summaries intentionally distinguish
WK-level orientation from selected-slice retrieval:

- WK-level defaults for tracker records in `workspace_get_record`,
  `workspace_read_page`, and `workspace_work_record_summary` suppress detailed
  slice bodies for `done`, `cancelled`, and `parked` slices. Status counts and
  slice-detail omission metadata remain the way to see which statuses and how
  many slices were suppressed.
- WK-level defaults omit record-level and slice-level `agent_notes` bodies.
  Included slice rows may expose `agent_notes_bytes`, an integer byte count
  that signals note presence/size without returning the note body.
- When an agent needs one suppressed slice's detail or notes, use the targeted
  selected-slice paths: `workspace_read_page(..., selected_slice: "<slice-id>")`
  for `wiki/work-records/WK-####.json`, or
  `workspace_work_record_summary(..., unit: "WK-0001#slice-id")`. These
  selected-slice responses include
  that slice's details and agent notes by default, plus `agent_notes_bytes`.
- Full/debug opt-ins such as `verbose`, `include_record`, `include_raw`, and
  `include_full_summary` where applicable can expose complete payloads and may
  spill through the oversized-response mechanism. They are explicit debug or
  full-inspection paths, not the routine WK-level default.

Omitted `done`, `cancelled`, or `parked` slice details and omitted WK-level
agent note bodies are default response shaping, not missing canonical data. Do
not recover them by shelling out, editing raw JSON, changing spill limits, or
changing storage; use a targeted selected-slice read/summary or an explicit
full/debug opt-in.

`workspace_create_record` is the workspace-scoped structured create route agents
should use for allocator-backed canonical wiki records when that MCP tool is
exposed by the active descriptor-audience and registered-tier gates:

- Inputs are `{ repo?, type, title, id? }`. Omitted `repo` follows the same workspace resolver precedence as the other repo-scoped tools: explicit caller `repo`, then launcher/server-minted local repo alias, then structured not-in-repo / wrong-session refusal. The tool never accepts a caller-supplied filesystem `dir`.
- `type: "issue"` allocates the next `WK-####` and writes canonical `wiki/work-records/WK-####.json`, consuming any outstanding `allocate_id` reservation. Returned structured content includes `id`, `jsonRelativeFile`, and `jsonAbsoluteFile` for the JSON authority.
- `type: "initiative"` allocates the next `IN-####` and writes `wiki/initiatives/IN-####.md`. Returned structured content includes `id` and `relativeFile` set to the `wiki/initiatives/IN-####.md` path.
- Other allocator-backed types (`decision`, `source`) and slug-based `area` records follow the same shared allocator/template path.
- Unknown `repo` aliases return the standard workspace `Unknown workspace repo alias` error and never silently fall back to another root.
- The non-workspace `create_record` tool with a caller-supplied `dir` is reserved for admin/operator flows; agent-safe exposure is still determined by descriptor audience plus registered-tier gating, not by this prose distinction.

For agents, the structured workspace tool to use is:

- `workspace_get_record` when a durable record ID such as `WK-0001` is already known.
- `workspace_read_page` when the canonical repo-relative path is already known, including `wiki/work-records/WK-####.json` for current JSON work records.
- `workspace_create_record` when a new canonical record must be allocated through the shared allocator/template path.

Codex agent-facing repo instructions should prefer the repo-local CLI for search/read/get-record retrieval. Codex may prompt for MCP calls when encrypted reasoning or prior tool-call state is attached to a request, even when the MCP tool is read-only and workspace-scoped. Non-workspace MCP tools remain reserved for admin, bootstrap, migration, and tooling-test flows where an operator intentionally selects the target checkout.

`workspace_code_index_context_for_path` returns scoped retrieval context for one repo-relative path under a three response-shape mode contract (this is a response-shape contract about payload size, not a product-tier availability signal — do not confuse it with free/local, CCE, or operator-only tool exposure):

- Sub-threshold files (`<=1200` LOC) default to `context_available: "compact"`: a bounded routing hint — `query_kind`, `path`, the `canonical_ref_count` / `related_code_path_count` / `likely_test_count` counts, `top_canonical_refs` / `top_related_code_paths` / `top_likely_tests` each bounded to 5, and a `next_action`. It omits the full `canonical_refs` (with `match_explanations`), `source_entries`, `derived_evidence`, and nested context payloads. (The MCP routes strip the redundant `context` echo; the core/CLI `--json` surface still carries a minimal `context` pointer.)
- Over-threshold files (`>1200` LOC) return `context_available: "degraded"` (the large-file guard), unchanged.
- `verbose: true` restores the full exploded context for either mode — all `canonical_refs` with `match_explanations`, `source_entries`, `derived_evidence`, `dirty_details`, and `context.canonical_refs`.

The legacy aliases `sidecar_context_for_path` / `workspace_sidecar_context_for_path` accept `verbose` passthrough, and the CLI `wiki code-index context-for-path` inherits the compact default with a `--verbose` escape hatch. This matches the compact-by-default pattern of `workspace_code_index_impact_paths`, `workspace_code_index_graph_impact_paths`, and `workspace_code_index_status`.

## Agent Graph Impact Recipe

Graph impact is an agent workflow checkpoint, not a primary manual user
workflow. After canonical wiki/docs retrieval identifies the assigned `WK-*`,
durable docs, and candidate implementation paths, implementation workers should:

1. call MCP `workspace_code_index_status` for the configured workspace repo
   alias
2. call MCP `workspace_code_index_graph_impact_paths` with the repository
   relative paths they may edit
3. after a diff exists, call MCP `workspace_code_index_graph_impact_diff` with
   parsed diff records, raw patch text, or live-git diff input

These routes return compact output by default and accept an optional `verbose`
boolean; leave it unset for the normal agent path and pass `verbose: true` only
when debugging needs the expanded graph fields (see the graph-impact compact
default and verbose opt-in section in
[docs/mcp-operation-reference.md](mcp-operation-reference.md)).

Use the CLI forms, such as `npm run wiki -- code-index graph-impact-paths` and
`npm run wiki -- code-index graph-impact-diff`, only when MCP approval prompts,
client tooling, or workspace alias configuration block the MCP tools. The CLI
fallback must preserve the same trust envelope: graph evidence is derived code
index evidence, while durable `docs/` pages and canonical `wiki/` records remain
authoritative.

Worker final answers and handoff closure notes should report:

- input paths or diff endpoints queried
- tool used, including whether MCP or CLI fallback was used
- `dirty_state` and `staleness`
- graph edge source from `graph_state.edge_source`
- key missing-update hints
- whether post-diff graph impact was run, unavailable, or not applicable
