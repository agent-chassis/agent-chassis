
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
read-first reference list), `repo_paths`, or `write_scope`,
setting acceptance criteria and validation notes, or shaping a unit into a
findings-only review contract — agents should use the current contract-edit MCP
routes: `workspace_work_record_edit`, `workspace_work_record_upsert_slice`,
`workspace_work_record_delete_slice`, and
`workspace_work_record_shape_review_unit`. Executable `node_test` validation
bindings are not ordinary edits; the controlled-contract proof operations author
them. These routes resolve only configured
workspace repository aliases and never accept a caller-supplied filesystem root.
They validate the prospective result against work-record.v1 before writing and
refuse invalid edits with structured diagnostics; output is compact by default
and each route accepts an optional `expected_source_digest` for stale-source
protection against concurrent edits. The CLI counterparts (`upsert-slice`,
`delete-slice`, `set-list-field`, `shape-review-unit`) are
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
- `workspace_read_mcp_content_reference`
- `workspace_code_index_status`
- `workspace_code_index_build`
- `workspace_code_index_rebuild`
- `workspace_code_index_impact`
- `workspace_code_index_find_references`
- `workspace_code_index_definition`
- `workspace_code_index_context_for_path`
- `workspace_work_record_validate`
- `workspace_work_record_refresh_admission_metrics`
- `workspace_work_record_refresh_target_resolution_evidence`
- `workspace_validate_dispatch`
- `workspace_work_record_set_status`
- `workspace_work_record_set_closure`
- `workspace_work_record_edit`
- `workspace_work_record_upsert_slice`
- `workspace_work_record_delete_slice`
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

### Workspace lint response

`workspace_lint_repo` and `workspace_generate_and_lint` use the same
`buildLintFindingsResponse` projection. Successful responses return lint errors
only as structured `findings`; there is no top-level `problems` property or
replacement error-message alias. Every returned finding occurrence retains its
producer fields and order, including repeated equal occurrences.

`error_count`, `warning_count`, and `finding_count_total` always describe the
complete producer arrays, independently of the response limit. `ok` and `valid`
are true exactly when `error_count` is zero. The optional `warnings` array is an
independent producer-ordered prefix and its length is not described by
`findings_returned`. The `findings_returned`, `findings_truncated`, and
`max_findings` fields describe only the structured findings prefix.

When `max_findings` is omitted, the route returns at most 20 findings. Zero
returns counts and summary metadata without `findings` or `warnings` arrays. A
positive integer returns that many producer-ordered findings and warnings at
most; there is no fixed upper content cap. Every truncated response directs the
caller to rerun the same route with `max_findings` at least
`finding_count_total` before attempting repair. That fresh live rerun retrieves
all finding and warning occurrences when repository input remains stable; it is
not a snapshot or cursor guarantee. Because producer order is unchanged, a
warning-first truncated prefix can contain no error identity even when
`error_count` is nonzero.

Projection requires complete `findings`, `problems`, and `warnings` producer
arrays and checks that `problems` exactly matches the ordered messages of every
error finding, including multiplicity. An incomplete or inconsistent producer
result fails before any successful response, including for `max_findings: 0`.
The two workspace MCP handlers map that exception through the existing
`mcp_response.handler_exception.v1` mechanical failure envelope.

`workspace_lint_repo` is read-only. `workspace_generate_and_lint` refreshes
only generated views before lint; it does not write canonical records and adds
no rollback if lint or projection later fails. The underlying `lintRepo`
producer, raw `lint_repo` representation, and `generateAndLint` nested `lint`
result are unchanged. Direct `generateAndLint` compact results and the raw
`generate_and_lint` route share the top-level projection, including removal of
`problems` and the full-retrieval guidance. Closeout lint retains its existing
catch behavior: it preserves the exception message while reporting that lint
did not run and generated-view refresh failed.

### `workspace_search_repo` Ranked Retrieval

`workspace_search_repo` is a ranked search surface. Its default compact output is
bounded by `limit` (default 8, maximum 50), while `total_count` remains the exact
complete match count. `returned_count`, `has_more`, and an opaque
`continuation` describe the current page. Continue only through the returned
`next_calls`; a continuation cannot be mixed with a replacement query, limit,
profile, namespace, history choice, or filter. Public offset arithmetic,
unbounded/bulk output, `verbose`, and `result_count` are not supported.

Each result carries concise original context plus backend-constructed
`workspace_read_page` calls for the exact selected source near the match and
from the source start. That strict branch is `{repo?, path, search_match,
length?}` and cannot mix with ordinary full/raw/profile/namespace/slice read
options. It returns exact Unicode-scalar text and range metadata; length defaults
to 512 and cannot exceed 1024. Following its opaque continuation reconstructs
the selected Markdown section or canonical JSON scalar without sibling fields.

Search hashes every current source buffer to check freshness even on a warm
query. Unchanged content reuses prepared projections/tokenization; touching a
file alone does not invalidate it, while same-size/same-mtime content edits do.
Missing, stale, or different-version caches prepare in memory without writes,
and repeated queries against the same content and context reuse that one
preparation. A well-formed different-version cache is recognized by its version
envelope and its obsolete content is discarded unread; the explicit build
replaces it. Present corrupt or unreadable current-version caches fail
explicitly. WK, initiative, and decision sources come from canonical JSON; their
Markdown projections never supply fallback hits. Initiative and decision
passages contain the title and the prose sections declared by the record kind's
section schema; metadata, scope, and authority fields remain filter facets
only. Preparation derives the existing link-authority ranking contribution from
the Markdown links and docs/related references of the same parsed corpus.
A search with a registered repository identity also covers addressable
work-record entries. The entry owner renders one source per root or slice entry
version, crossing composed parts; default search selects current versions and
`history:true` selects every retained version, and assignment `material_refs`
never add sources. Entry records are loaded from the same captured corpus
bytes. Their prepared projections are reused while the corpus signature,
projection context, repository, and history choice are unchanged. Each selected
entry version resolves independently: a version whose source closure cannot be
resolved in the searched view, including a reference whose source record has
since changed, is excluded and reported with the resolver's diagnostic plus its
`unit`, `entry_id`, and `version_id`, while every resolvable root, slice,
current, and retained version stays searchable. Ranked counts and continuations
describe exactly that resolvable population. Entry hits return
`workspace_work_record_entry_read` body calls that load only the version's
source closure and keep recovering that exact version after corrections,
current-version advancement, cache eviction, and restart. Searches without a
repository identity, such as the CLI, cover canonical files only and report
`work_record_entry_search_requires_repository`; an explicit `history:true`
request without repository identity is refused with that code before any
preparation or result.
Markdown capture and ordinary page reads share
`parseMarkdownPage(targetDir, filePath, markdown)`: the synchronous parser has
no filesystem effects, while `readMarkdownPage` performs one UTF-8 read and
delegates to it.

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

### Host wiki-MCP process isolation

The launcher starts one host wiki-MCP server for each authenticated MCP command
invocation. Confined clients reach their independent server generations through
the launcher-owned private Unix-domain socket adapter. The socket endpoint,
credential file, pinned stdio connector, and connector Node executable are
projected into the sandbox; the wiki-MCP server package, dependency tree, cache,
and server runtime state remain on the host, outside the repository namespace.
See [MCP integration](mcp-integration.md#transport).

Role selection and tool authority come only from the frozen launcher binding.
Prompt text, request payloads, argv, ambient environment, repository settings,
and user settings cannot select a server, connector, mount, endpoint, or lifecycle.

The workspace read tool still validates page containment through the shared read core. Path traversal such as `../outside.md` or `wiki/work-records/../../escape.json` is rejected before reading.

`workspace_read_page` reads Markdown pages and registered canonical JSON records.
Work items, initiatives, and decisions use JSON authority: respectively
`wiki/work-records/WK-####.json`, `wiki/initiatives/IN-####.json`, and
`wiki/decisions/DEC-####.json`. Their Markdown projections are generated views,
never canonical sources. Reading a projection does not confer record authority;
use the JSON path or a canonical ID read when authority matters.

- Markdown reads (`docs/...`, `wiki/issues/...`, `wiki/initiatives/...`, `wiki/decisions/...`, `wiki/sources/...`, `wiki/areas/...`, generated views) return `format: "markdown"` with `markdown` content, `frontmatter`, `body`, and link metadata.
- JSON work-record reads on `wiki/work-records/WK-####.json` return `format: "json-work-record"`. Registered initiative and decision JSON reads return `format: "json-kind-record"`, `source_classification: "canonical"`, and `canonical_record_path`. These reads are compact-first and have no whole-record mode: read any current member with `member: {path}`, which returns a bounded page of immediate members or one exact string range and pins `source_digest` in every emitted call. `include_body` reads Markdown page bodies only; it is refused for canonical records and for record projections under `wiki/issues/`, `wiki/initiatives/`, and `wiki/decisions/`. `member` is refused on any Markdown path. When either refusal addresses the exact generated projection of a registered initiative or decision and that canonical record loads valid under the same identity and repository binding, the refusal carries one recommended `next_calls` entry: the `member` read of the canonical JSON path, keeping a refused `member` selection or selecting the record root for a refused `include_body`, pinned to the verified `source_digest` unless the caller pinned one. A missing, traversal, unregistered, or ordinary Markdown path receives the plain refusal. Support for registered canonical paths does not permit arbitrary JSON or filesystem reads.
- The generated `wiki/catalog.md` links each registered initiative and decision to its canonical JSON path, resolved through the same manifest-derived kind-record authority as reads, when that canonical record loads valid; a projection whose canonical record is missing or invalid, and every other catalog entry, links its own page.
- Graph-evidence sidecar reads on `wiki/work-records/evidence/WK-####.graph.json` return `format: "graph-evidence-sidecar"`. These per-WK sidecars hold the full graph-impact replay/debug payloads that the canonical work record keeps only as compact refs. They are replay/debug data and never dispatch-control input; canonical WK compact refs remain the pointer. The read projection and parameters are summarized in the bullets below, and the operation-level contract is listed in [docs/mcp-operation-reference.md](mcp-operation-reference.md).
- Missing JSON work-record paths return a `Wiki record path not found` error rather than treating the absent file as Markdown.
- Search-selected reads load and revalidate only the selected source. Their opaque binding survives restart while bytes and projection context remain unchanged, and refuses changed/deleted/reordered sources without disclosing stale text.

`workspace_read_page` graph-evidence sidecar parameters:

- Default (no flag) returns the compact projection: `schema_version`, `record_id`, generated/updated metadata, the diagnostic whole-file `graph_sidecar_digest`, a `record_entry` availability summary (`available`, `graph_entry_digest`, `replay_detail_available`), `slice_count`, and a `slices` list of `{ slice_id, unit_address, graph_entry_digest, replay_detail_available }` entries only. No raw `graph_impact`/`graph_nodes`/`graph_edges` payloads are returned.
- `selected_slice: <slice-id>` returns that one slice's full replay entry under `selected_slice` (with `selected_slice_found`), without sibling entries.
- `selected_record: true` returns only the record-level entry under `record_entry` (with `record_entry_found`). It is mutually exclusive with `selected_slice`; supplying both is rejected.
- There is no whole-sidecar or raw-text read: `include_record`, `include_raw`, and `verbose` are not `workspace_read_page` arguments.
- The whole-file `graph_sidecar_digest` is diagnostic only (sibling-slice updates change it); routine replay/debug binding uses each entry's `graph_entry_digest`.

`workspace_get_record` resolves canonical wiki records by durable ID:

- `WK-*` records that have a canonical `wiki/work-records/WK-####.json` are returned as `format: "json-work-record"` from JSON authority, even when generated Markdown views are missing or stale.
- `IN-*` and `DEC-*` resolve to their registered canonical JSON records and return `format: "json-kind-record"`. Their authority does not depend on a generated Markdown projection being present or current. `workspace_read_page` addressed by `id` reads the same records, including `member` pages.
- `SRC-*` and area records use their Markdown sources and return `format: "markdown"`.
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
  for `wiki/work-records/WK-####.json`,
  `workspace_get_record(..., selected_slice: "<slice-id>")`, or
  `workspace_work_record_summary(..., unit: "WK-0001#slice-id")`. These
  selected-slice responses include that slice's details and complete direct
  `agent_notes` value by default. They continue to omit `agent_notes_bytes`.
  When authored `sections.agent_notes` is exactly the same string, or an array
  of the same length with the same strings in the same order, the response
  removes that identical nested copy. This includes sections-only authored
  notes because selected-unit projection creates the complete direct copy.
  Distinct direct and nested values are both preserved. Consequently,
  `sections.agent_notes` may be absent from a selected-slice response even
  though it is authored in the canonical file; the `sections` container itself
  remains present, including as `sections: {}`.
- There are no full or debug opt-ins on these routes: `verbose`,
  `include_record`, `include_raw`, `include_full_summary`, `accept_full_read`,
  and `compact_read_token` fail schema validation. Complete content is reached
  through explicit selection: `member: {path}` for any current record or slice
  member, `workspace_work_record_entry_read` for entries and versions, and
  `ordinary_field` for enrolled text. A reference to an unselected whole record
  is never returned in place of a selected value.
- Write routes that accept `verbose: true` return their complete diagnostics and
  detail fields but never the whole record, including for a no-op edit. The
  mutation result, `source_digest`, and error identity are the write response;
  record content is read back through the selected routes above.

Omitted `done`, `cancelled`, or `parked` slice details and omitted WK-level
agent note bodies are default response shaping, not missing canonical data. Do
not recover them by shelling out, editing raw JSON, changing spill limits, or
changing storage; use a targeted selected-slice, member, entry, or ordinary-field
read.

`workspace_create_record` is the workspace-scoped structured create route agents
should use for allocator-backed canonical wiki records when that MCP tool is
exposed by the active descriptor-audience and registered-tier gates:

- Inputs are `{ repo?, type, title, id? }`. Omitted `repo` follows the same workspace resolver precedence as the other repo-scoped tools: explicit caller `repo`, then launcher/server-minted local repo alias, then structured not-in-repo / wrong-session refusal. The tool never accepts a caller-supplied filesystem `dir`.
- `type: "issue"` allocates the next `WK-####` and writes canonical `wiki/work-records/WK-####.json`, consuming any outstanding `allocate_id` reservation. Returned structured content includes `id`, `jsonRelativeFile`, and `jsonAbsoluteFile` for the JSON authority.
- Initiative and decision creation writes canonical JSON in the registered kind directory and produces the corresponding Markdown projection. The projection path in a creation receipt is not the canonical record path. Use live discovery to select the currently exposed creation route and its input schema.
- Source and slug-based area records use their shared allocator/template routes and Markdown storage.
- Unknown `repo` aliases return the standard workspace `Unknown workspace repo alias` error and never silently fall back to another root.
- The non-workspace `create_record` tool with a caller-supplied `dir` is reserved for admin/operator flows; agent-safe exposure is still determined by descriptor audience plus registered-tier gating, not by this prose distinction.

For agents, the structured workspace tool to use is:

- `workspace_get_record` when a durable record ID such as `WK-0001` is already known.
- `workspace_read_page` when the canonical repo-relative path is already known, including registered WK, IN, and DEC JSON paths.
- `workspace_create_record` when a new canonical record must be allocated through the shared allocator/template path.

Codex agent-facing repo instructions should prefer the repo-local CLI for search/read/get-record retrieval. Codex may prompt for MCP calls when encrypted reasoning or prior tool-call state is attached to a request, even when the MCP tool is read-only and workspace-scoped. Non-workspace MCP tools remain reserved for admin, bootstrap, migration, and tooling-test flows where an operator intentionally selects the target checkout.

`workspace_code_index_context_for_path` returns complete committed context for one repo-relative path: the file's exact committed source, graph relationships, inferred related code and tests, canonical records, and `affected_files` whose relationships name their basis. A valid path outside the indexed corpus keeps its guidance and reports source `indexed_corpus_excluded`; a path absent from the commit reports `missing_file_descriptor`; forbidden or malformed paths are refused before preparation. Source and line counts come only from the committed publication. That complete answer is retained at `full_result`; the default response carries identity, source state and line count, trust facts, and bounded code-graph `graph_paths` with whole-population totals, as described in [Tool Discovery Surfaces](tool-discovery-surfaces.md).

The context route and `workspace_code_index_impact` automatically prepare
the same exact committed-HEAD base/SCIP pair used by graph impact and symbol
navigation. This may update the ignored derived cache; it never indexes dirty
worktree bytes. `workspace_code_index_status` is the read-only inspection route
and never prepares either layer.

- The default is `context_available: "compact"`: committed identity, trust facts, source metadata, and at most twenty entries of each population with exact `counts` totals. Committed source above 1200 lines is omitted with `source_text_omitted: true`; large files are never refused. This threshold is unrelated to worker-admission policy and produces no admission verdict.
- Before any compact omission, the complete original answer is retained through the authenticated content-reference owner and bound at `full_result` (content reference, byte total and SHA-256); read it with `workspace_read_mcp_content_reference`. A retention failure is returned as that failure, never as a compact success.
- `verbose: true` runs a new evaluation and returns the complete answer; it does not recover an earlier retained answer. CLI `--json` and `--verbose` print the complete answer, and plain CLI output lists every population.

The internal pure owner for likely-test and same-directory path inference is
`deriveSidecarPathContext` in
`packages/wiki-core/src/lib/sidecar-path-context.mjs`. It accepts already
selected input and source paths, performs no filesystem, Git, index-preparation,
or graph work, and returns complete path-deduplicated populations with every
contributing input path and `committed_path_inference` evidence. Consumers apply
their own presentation limits; compact projections display at most twenty
entries while their counts and the retained complete answer cover the complete
population. These hints remain path inference, not graph dependencies.

`workspace_code_index_impact` accepts exactly one subject — `paths`,
`patchText`, `diffRecords`, or `liveGit: true` — plus `repo`, `cacheDir`,
`includeSuppressed`, and `verbose`. Empty `paths`, `patchText`, and
`diffRecords` are explicit no-change requests. Mixed subjects, unknown keys,
malformed diff records, and diffs beyond 1,048,576 normalized bytes, 20,000
lines, or 1,000 records are refused as invalid requests. Live Git only selects
changed paths; relationships, inference, and canonical records always come from
the committed publication. The answer carries `impact_state` (`evaluated`,
`partial`, `no_change`, `invalid_input`, or `unsupported_input`) with reasons and
denominators, `affected_files` whose relationships name their basis (`graph`,
`inferred_adjacency`, `canonical_record`, or `suggested_update`), structural
impacts, missing-update hints, diff diagnostics, and a compact graph summary. It
never exposes raw graph nodes or edges. CLI `wiki code-index impact` accepts
exactly one of positional or `--paths` paths, `--patch`, `--patch-file`,
`--diff-records-json`, or `--live-git`, with the same `--json`/`--verbose`
output.

## Agent Graph Impact Recipe

### Automatic index preparation

Code-index consumers prepare the base graph and SCIP overlay together for the
captured committed HEAD. Callers do not need to run a build command or obtain a
clean worktree before asking about a change.
The committed-snapshot preparation owner, `resolveCommittedSidecarSnapshot` in
`packages/wiki-core/src/lib/sidecar-committed-preparation.mjs`, delegates the
only reuse/rebuild decision to `ensureSidecarIndex`, then verifies the selected
SQLite publication against the captured repository HEAD and tree. The
selected-unit graph query authenticates its unit before preparation and then
uses a fixed selected read whose publication must equal that snapshot;
current-worktree graph queries retain their separate transient dirty-overlay
selection. Transport adapters must not add another ensure or verification loop.

`ensureSidecarIndex` applies the one freshness classifier. A publication already
tagged with the captured commit, with a compatible extraction basis and complete
provider coverage, is reused without an update, provider run, or database copy.
Otherwise the shared updater applies the committed Git diff from the published
commit, reruns only the SCIP projects whose inputs changed, and publishes the
data and the new commit tag together; an unusable or unrelated predecessor takes
the clean path. Moving HEAD observations restart within the shared bounded pass
count. Dirty worktree bytes remain outside both layers and are collected only
when a caller's response reports them.

`workspace_code_index_status` and its core/CLI equivalents remain read-only. The
status result reports the base verdict separately from `scip_state`, including
the provider input identity, freshness, availability, and its own
`index_action`; it never runs a provider. Optional build and rebuild controls use
the same preparation owner; rebuild forces a clean candidate for the same commit.

Preparation may write ignored derived cache artifacts through the existing
builder. It does not edit source files or canonical docs/work records, clean
the worktree, or grant dispatch authority. Impact calls therefore are not
strictly read-only operations. The standalone `workspace_code_index_status`
operation remains read-only and reports the state it finds without preparing
the index. Its diagnostic result is not a manual build prerequisite.

The index represents committed files. Dirty files do not prevent preparation
and must not be presented as indexed by that committed baseline. Results keep
the selected commit/tree identity and worktree limitations explicit, in
accordance with decision. HEAD movement, unusable output after rebuilding, and
preparation failures use the shared owner's bounded retry and typed failure
behavior. A failed preparation is not an empty successful impact result or a
reason to substitute filename guesses for graph evidence.

During automatic pair preparation, the committed snapshot runner invokes only the fixed
backend-provisioned `scip-typescript` and `scip-python` executables. It resolves
each installed name to an absolute executable path before spawning with
`shell:false`, then runs with the committed snapshot as its working directory;
it does not use `npx`, install packages, or accept executable paths from a
query. The runner passes the already validated captured commit to
`scip-python` as `--project-version`, so Python indexing does not depend on
repository or project-version metadata that is absent from the archive. It
does not add `.git` data to the snapshot or guess a replacement version.
Every applicable provider project is required. A provider execution or decode
failure fails preparation before publication, so the previously published data
and its commit tag stay in place and no partial provider coverage is published.
A project whose committed inputs did not change keeps its earlier output and
the commit that produced it.
SCIP bytes are decoded with the released `@scip-code/scip` generated bindings.
Alongside aggregate symbol and call edges, the published overlay retains native
`symbol_occurrences` with provider, path, raw symbol, stable global or
document-local symbol key, roles, resolution, and one-based inclusive whole-line
source and optional enclosing ranges. These coarse regions preserve repeated and
same-line occurrences without claiming character-precise targeting. Invalid or
unsupported range encodings are omitted from the collection and counted in
coverage; they never manufacture graph or call relationships. Source-text
selection and presentation are a separate query concern.
Because incomplete provider coverage is never published, a query retried after
a provider is provisioned prepares the index automatically; no manual rebuild is
required. Standalone status remains read-only.
Snapshot,
Git, filesystem, and publication failures retain their typed infrastructure
failure behavior.

### Existing runtime calls

Graph impact is an agent workflow checkpoint, not a primary manual user
workflow. After canonical wiki/docs retrieval identifies the assigned `WK-*`,
durable docs, and candidate implementation paths, implementation workers should:

1. call MCP `workspace_code_index_status` for the configured workspace repo
   alias
2. call MCP `workspace_code_index_impact` with the repository-relative `paths`
   they may edit
3. after a diff exists, call MCP `workspace_code_index_impact` with parsed
   `diffRecords`, raw `patchText`, or `liveGit: true`

The route returns compact output by default, bound to the retained complete
answer at `full_result`; pass `verbose: true` when the complete answer must be
evaluated again, for example to record it as graph-impact evidence.

Use the CLI forms, such as `npm run wiki -- code-index impact --paths <path>` and
`npm run wiki -- code-index impact --live-git`, only when MCP approval prompts,
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

## Package-Owned Documentation Versus Workspace Pages

Two read routes exist because two different things own the bytes, and confusing
them is what made discovery advertise a documentation path a consuming
repository did not contain.

- `workspace_read_page` reads pages the CONSUMING WORKSPACE owns, resolved
  against the configured repo alias. It is workspace-scoped and never
  reinterprets a package path.
- `workspace_read_tool_doc` reads documentation the launching PACKAGE owns,
  resolved against the documentation bundle that package supplies. It accepts
  only a tool the session can currently see plus one of that tool's currently
  advertised package-scoped logical paths, and it reads only manifest-contained
  bundled files.

Which route applies is decided by descriptor provenance, not by probing which
filesystem happens to contain the relative path. Built-in AgentChassis
descriptor references are package-scoped; a descriptor may declare individual
references workspace-owned, and those keep `workspace_read_page`. When the same
logical path exists in both places the declared owner wins deterministically, so
a workspace file can never shadow a package-owned built-in reference and a
package-owned reference never falls back to the consuming workspace. Every
refusal on that boundary carries a stable typed code; the codes are tabulated in
[Package-Document Read Diagnostics](tool-discovery-schema.md#package-document-read-diagnostics).

The documentation bundle reaches the server as a closed carrier value handed
over by the package that owns it — today `@agent-chassis/core`'s forwarding bin,
derived from its own module location and its own `package.json`. There is no
environment variable, caller-supplied root, ancestor-package search, hoisting
assumption, or workspace fallback that can produce one. A standalone
`@agent-chassis/wiki-mcp` launch therefore carries no documentation bundle and
advertises no package-owned reference it cannot read.
