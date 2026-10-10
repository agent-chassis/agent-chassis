
# MCP Agent-Facing Repository Model

This page is the agent retrieval model for `agent-chassis` MCP: which repository a server works on, who owns the bytes a read returns, how large answers are delivered, how host processes are isolated, and how code-index questions are answered. The operations themselves are listed once, in [MCP Operation Reference](mcp-operation-reference.md); start with [MCP integration](mcp-integration.md) for setup and the workflow narrative.

## Agent-Facing Repository Model

This MCP server provides shared tooling. It does not own the consuming repository's wiki content.

A server binds one trusted repository. It resolves that repository once, at
startup, from launcher- or server-owned configuration (see
[environment reference](env-reference.md)), and a launch that configures none
does not serve. Public agent requests carry no `repo` selector and no
filesystem root: every task operates on the configured repository, and no
prompt text, request payload, argv, claimed identity or agent-authored
environment selects another one. A request field that names a repository is
refused by the tool's closed schema rather than honoured or ignored.

The task tools, their request boundaries and the role that holds each one are
the [operation reference](mcp-operation-reference.md#operations) and its
[role authority](mcp-operation-reference.md#role-authority) section. This page
does not repeat them. `tools/list` is the authority for what a session can
call: a tool the session's role does not hold is absent, not refused.

Ownership follows from that single binding:

- Durable `docs/` pages and canonical `wiki/` records belong to the configured
  repository. Agents read them with `workspace_read_wiki` and change canonical
  records only through `workspace_create_record` and `save_record`; see
  [persistence](work-record-persistence.md). Raw JSON edits and shell patches
  are not an agent edit path.
- Work items, initiatives and decisions have JSON authority:
  `wiki/work-records/WK-####.json`, `wiki/initiatives/IN-####.json` and
  `wiki/decisions/DEC-####.json`. Their Markdown projections and the generated
  catalogue views are derived, never canonical, and reading a projection confers
  no record authority. Sources and areas use their Markdown documents.
- A reader subject is a canonical ID or a Markdown document path. JSON storage
  paths are not reader subjects.
- Documentation that ships with the tooling belongs to the launching package,
  not to the repository; see
  [Package-Owned Documentation Versus Workspace Pages](#package-owned-documentation-versus-workspace-pages).

Reads are compact first. `workspace_read_wiki` answers with bounded context and
the exact selection calls that read a field, entry, population or text whole;
follow those calls unchanged. A returned reference selects only the resource
the first answer named, under the same source and role grants. It never grants
arbitrary filesystem access, and the shared read core rejects path traversal
such as `../outside.md` or `wiki/work-records/../../escape.json` before any
read. Omitted detail in a compact answer is response shaping, not missing
canonical data: reach it through the returned selection, never by shelling out,
editing raw JSON or changing storage.

### Oversized MCP Response References

Default answers are bounded summaries. A complete value that exceeds the
ordinary bound is retained once by its producer and read through the selection
call the answer returned, on the tool that owns it: `workspace_read_wiki` for
wiki, record and package-document selections, `get_run_result` for execution
originals, and `query_code_index` for code-index answers. Selected full reads
are delivered through the shared authenticated response class as semantic
structured values and plain Unicode text.

There is no generic content reader. Callers never page byte ranges, decode
base64, verify a digest or reassemble a payload, and no response asks them to.
A missing or corrupt original, or a retention failure, is reported as that
failure and never as a compact success. The delivery bound, retained sources
and selected-full delivery are specified in
[selected-response details](mcp-selected-response-details.md). The one native
output exception belongs to
[`workspace_run_test`](local-test-runtime-setup.md#the-workspace_run_test-route).

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
The repository a server answers for is part of that same binding, so every call
a response emits is answered from the source the first call was bound to.

### Code index reads

`query_code_index` is the one agent code read. It answers for the server's own current repository; no argument selects a repository, root, cache or commit, and no emitted call carries one. With `path` alone it returns complete committed context for one repo-relative path: the file's exact committed source, graph relationships, inferred related code and tests, canonical records, and `affected_files` whose relationships name their basis. A valid path outside the indexed corpus keeps its guidance and reports source `indexed_corpus_excluded`; a path absent from the commit reports `missing_file_descriptor`; forbidden or malformed paths are refused before preparation. Source and line counts come only from the committed publication. That complete answer is retained once as the route's selected-response source; the response carries identity, source state and line count, trust facts, and bounded code-graph `graph_paths` with whole-population totals, as described in [Tool Discovery Surfaces](tool-discovery-surfaces.md).

An ordinary question — file context, change impact, or a symbol or
source-location question — answers at once from the last usable published
base/SCIP pair of the one shared code index and never waits for indexing. Every
answer frame states `read_mode: "query"`, the full commit it was selected from
(`indexed_commit`), that commit's display form (`indexed_commit_short`) and the
separately observed `current_head`; whether they are the same (`staleness`) and
the background refresh of the index (`preparation.refresh`) are reported beside
them. Every row, source line and "not found" describes the indexed commit, never
the current HEAD or a commit under review. A composed answer whose parts
describe different commits states no common commit: `mixed_source: true` says
so and each part keeps its own. The refresh runs in a separate process, may
update the ignored derived cache, and never indexes dirty worktree bytes. With
no usable published index the route returns `available: false` with the index
and refresh state and the same call to repeat, never an empty answer.

`status: true`, alone, is the passive alternative: it reports availability,
the published index (`read_mode: "status"`, the same `indexed_commit` labels),
the separately observed `current_head`, freshness, dirty state, base-graph and
SCIP usability, coverage qualifications and the owner's reason/action. Deep
generator, provider, dependency and provenance populations stay in the retained
status evidence. For a fresh index the recommended selection reads the complete
`graph_snapshot`, or `derived_evidence` when no snapshot exists. A published
index that is not fresh recommends `diagnosis` instead: the status reason,
freshness, required action and base-graph and SCIP usability of that status
read, beside its `indexed_commit`, `indexed_commit_short` and observed
`current_head`, with no provider, dependency, toolchain or cache record. A
diagnosis read also states `preparation` and, when it holds one, the preparation
call of the session reading it, decided by that session's own registration after
the retained source is authenticated; a diagnosis retained by a session that can
prepare lends another session nothing. It is the earlier read's observation, not
a new status probe, and `observation` states the present comparison. The
complete `graph_snapshot` and `derived_evidence` are unchanged and stay
explicitly selectable through `selected_detail.choices`. Status neither prepares
a layer nor requests a refresh. `preparation.state` says what the serving session can do
about an index that needs preparing: `not_needed`; `action_available`, when the
session's own registration holds `workspace_code_index_build` and its request
schema accepts `{}`, in which case that exact call leads `next_calls` with
`purpose: "prepare_index"`; or `capability_unavailable` with
`missing_capability: "prepare_code_index"`, in which case no preparation call or
route name is emitted. The cause, `indexed_commit` and `current_head` are
reported either way, and a usable stale index stays `available: true`. Evidence
selections, the diagnosis included, carry `purpose: "inspect_evidence"`: they
read the retained status evidence and prepare, refresh and repair nothing. The `available: false` answer
to a question carries the same `preparation` beside the call to repeat.
A `detail` read of a retained answer (`read_mode: "retained"`) is equally
passive. A question, `status` and `detail` are mutually exclusive, and an
undeclared or conflicting argument is refused before any owner runs.
Missing or conflicting question selections return the input owner's specific
`sidecar_query_input_invalid` cause (`sidecar_navigation_input_invalid` for a
delegated navigation selection), with its complete diagnostic and supported
question alternatives. The existing input-refusal owner carries that diagnosis
in `refusal.diagnostic`. Recovery states `choice_required` for the caller, with
no fabricated next call: the caller chooses the question and supplies its values.
These refusals change no index, publication or retained answer. Unexpected
selection or query execution failures keep the shared response owner's failure
path and original diagnostic; they are not classified as caller choice.
`workspace_code_index_build` and `workspace_code_index_rebuild` are the
operator's routes: they prepare the current HEAD and wait.

- The default file context is `context_available: "compact"`. It leads with the requested path, committed source identity/state, line count and source metadata, followed by index freshness/refresh, trust facts and bounded code-graph relationships with exact totals. Source text stays retained with `source_text_omitted: true`. The recommended complete call selects that file's `source`, including every committed source byte.
- Before any compact omission, the complete original answer is retained once. Status and file context carry `selected_detail.source` `{ref_id}`, `snapshot_identity`, collection counts and concise `choices` objects. They emit one recommended complete `next_calls` call. To select any choice, call `query_code_index` with `{detail:{source:selected_detail.source,snapshot_identity:selected_detail.snapshot_identity,...choice}}`. This shares source context without repeating an expanded envelope for every member; no collection name needs to be guessed. Impact and navigation retain their existing collection calls.
- A `detail` names one retained collection or member. `selector.id`, `path`, `symbol` and `relationship` narrow rows; `input_path` narrows one affected file's relationships and `lines` selects absolute retained source lines. The `candidates` collection exposes ambiguity without choosing a candidate. The shared selected-response registry keeps ordering, row boundaries, totals, authenticated snapshots/cursors, seeking and source-based recovery. `page` states the matched total, offset and whether rows remain; `next_calls` holds at most its one continuation with the same source and filters. Complete selected rows use authenticated selected-full delivery, including a source or provenance row larger than the ordinary summary bound. Oversized rows require no field inventory or byte reconstruction. These reads retain no new original, evaluate no question, prepare no index and request no refresh. A retention failure remains that failure, never a compact success.
- There is no verbose or `full_result` form; a new evaluation is a new question. CLI `--json` and `--verbose` print the complete answer, and plain CLI output lists every population.

The internal pure owner for likely-test and same-directory path inference is
`deriveSidecarPathContext` in
`packages/wiki-core/src/lib/sidecar-path-context.mjs`. It accepts already
selected input and source paths, performs no filesystem, Git, index-preparation,
or graph work, and returns complete path-deduplicated populations with every
contributing input path and `committed_path_inference` evidence. Consumers apply
their own presentation limits; compact projections display at most twenty
entries while their counts and the retained complete answer cover the complete
population. These hints remain path inference, not graph dependencies.

A change-impact question supplies exactly one subject — `paths`,
`patchText`, `diffRecords`, or `liveGit: true` — plus optional
`includeSuppressed`, and `path` or `symbol` to narrow it. Empty `paths`, `patchText`, and
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

The adapter forwards the action `ensureSidecarIndex` itself reported. The
context, impact and symbol-navigation query envelopes take their common
preparation and source fields from one projection, `committedEnvelopeFields` in
`packages/wiki-core/src/lib/sidecar-query-selection.mjs`:

| Field | Meaning |
| --- | --- |
| `indexed_commit` | The full commit of the published snapshot the answer was read from (`graph_snapshot.repository_commit`). It is the authoritative identity. |
| `indexed_commit_short` | The first 12 hexadecimal characters of `indexed_commit`, for display only. It is not a unique identity, a lookup key, or proof of currentness. |
| `current_head` | The Git HEAD observed for the request. It is a separate observation and never stands in for the indexed commit. |
| `preparation.action` | The owner's action for this request: `published_snapshot`, `reused`, `coalesced`, `build`, `rebuild`, `incremental`, or `advance_tag`. A request that joined another caller's update reports `coalesced`, not the update that caller performed. |
| `preparation.publication_outcome`, `preparation.changed` | The owner's own facts when it supplies them, otherwise `null`. |

When no publication identity is available, `indexed_commit` and
`indexed_commit_short` are `null` and `status_reason` carries the cause; the
current HEAD is never substituted. A preparation fact the owner did not report
is `null`: no effect is inferred from the build result or from comparing status
before and after. The symbol-navigation envelope keeps its own `scip_state`,
provider descriptors, coverage and provenance.

`ensureSidecarIndex` applies the one freshness classifier. A publication already
tagged with the captured commit, with a compatible extraction basis, complete
provider coverage and provider input records that still match the installed
executables, settings and dependency populations, is reused without an update,
provider run, or database copy. Otherwise the shared updater applies the
committed Git diff from the published commit, reruns only the SCIP projects
whose input records changed, and publishes the
data and the new commit tag together; an unusable or unrelated predecessor takes
the clean path. Moving HEAD observations restart within the shared bounded pass
count. Dirty worktree bytes remain outside both layers and are collected only
when a caller's response reports them.

The `status: true` read and its core/CLI equivalents remain read-only. The
status result reports the base verdict separately from `scip_state`, including
the provider input identity, freshness, availability, and its own
`index_action`; it never runs a provider. Optional build and rebuild controls use
the same preparation owner; rebuild forces a clean candidate for the same commit.

Preparation may write ignored derived cache artifacts through the existing
builder. It does not edit source files or canonical docs/work records, clean
the worktree, or grant dispatch authority. Ordinary `query_code_index`
questions request that background refresh, so they are not strictly read-only
operations and discovery advertises the write. The `status: true` and `detail`
reads remain read-only and report the state they find without preparing the
index. A status result is not a manual build prerequisite.

The index represents committed files. Dirty files do not prevent preparation
and must not be presented as indexed by that committed baseline. Results keep
the selected commit/tree identity and worktree limitations explicit, in
accordance with decision. HEAD movement, unusable output after rebuilding, and
preparation failures use the shared owner's bounded retry and typed failure
behavior. A failed preparation is not an empty successful impact result or a
reason to substitute filename guesses for graph evidence.

During automatic pair preparation, the committed snapshot runner invokes only the fixed
installed `scip-typescript`, `scip-python`, `scip-go` and `rust-analyzer`
providers (`scip-go` with the installed `go` toolchain; `rust-analyzer` with the
`cargo` and `rustc` of the toolchain the `PATH` `rustc` selects). It looks each
name up on the server's `PATH`, runs the resolved absolute executable with
`shell:false` against the committed snapshot, and does not use `npx`, install
packages or toolchains, fetch modules or crates, or accept executable paths from
a query. Rust indexing runs Cargo offline and lets already-available build
scripts and procedural macros run inside the temporary snapshot. The runner passes the already validated
captured commit to `scip-python` as `--project-version` and to `scip-go` as
`--module-version`, so indexing does not depend on repository or version
metadata that is absent from the archive. It does not add `.git` data to the
snapshot or guess a replacement version. An applicable project whose provider
executable is not installed is reported as inactive coverage
(`provider_coverage.inactive_projects`), never as a successful run. Every active
project is required: a failed executable lookup, a refused Go or Rust project,
unavailable Go or Rust dependencies, or a provider execution or decode failure fails
preparation before publication, so the previously published data and its commit
tag stay in place and no partial provider coverage is published. A
commit-independent project whose input record did not change keeps its earlier
output and the commit that produced it; a commit-sensitive producer reruns at
every new commit. Provider activation, input records and Go and Rust execution
are recorded with each publication and reported by the status read.
SCIP bytes are decoded with the released `@scip-code/scip` generated bindings.
Alongside aggregate symbol and call edges, the published overlay retains native
`symbol_occurrences` with provider, path, raw symbol, stable global or
document-local symbol key, roles, resolution, and one-based inclusive whole-line
source and optional enclosing ranges. These coarse regions preserve repeated and
same-line occurrences without claiming character-precise targeting. Invalid or
unsupported range encodings are omitted from the collection and counted in
coverage; they never manufacture graph or call relationships. Source-text
selection and presentation are a separate query concern.
Because each publication records the provider executables it observed, a query
after a provider is installed, removed or replaced at the same commit prepares
the affected projects automatically; no manual rebuild is required. Standalone
status remains read-only and reports `scip_provider_inputs_changed` meanwhile.
Snapshot,
Git, filesystem, and publication failures retain their typed infrastructure
failure behavior.

### Existing runtime calls

Graph impact is an agent workflow checkpoint, not a primary manual user
workflow. After canonical wiki/docs retrieval identifies the assigned `WK-*`,
durable docs, and candidate implementation paths, a session that holds
`query_code_index` should:

1. call MCP `query_code_index` with the repository-relative `paths` it may
   edit
2. after a diff exists, call MCP `query_code_index` with parsed `diffRecords`,
   raw `patchText`, or `liveGit: true`

No status call is a prerequisite; `query_code_index` with `status: true` is
available when the published commit itself is the question. The route returns a
compact answer bound to its retained complete original by
`selected_detail.source`; read that original through the returned `detail`
selection.

Use the CLI forms, such as `npm run wiki -- code-index impact --paths <path>` and
`npm run wiki -- code-index impact --live-git`, only when the session does not
hold the MCP tool. The CLI must preserve the same trust envelope: graph evidence
is derived code index evidence, while durable `docs/` pages and canonical
`wiki/` records remain authoritative.

Final answers and handoff notes that rely on graph impact should report:

- input paths or diff endpoints queried
- tool used, including whether MCP or the CLI was used
- `dirty_state` and `staleness`
- graph edge source from `graph_state.edge_source`
- key missing-update hints
- whether post-diff graph impact was run, unavailable, or not applicable

## Package-Owned Documentation Versus Workspace Pages

Two different owners hold the bytes a read can return, and confusing them is
what made discovery advertise a documentation path a consuming repository did
not contain. `workspace_read_wiki` reads both, and the request says which:

- A `subject` or `search` reads what the CONFIGURED REPOSITORY owns: its
  canonical records and its own pages. It never reinterprets a package path.
- A `reference` of `{tool_name, path}` reads documentation the launching
  PACKAGE owns, resolved against the documentation bundle that package
  supplies. It accepts only a tool the session can currently see plus one of
  that tool's currently advertised package-scoped logical paths, and it reads
  only manifest-contained bundled files. The answer states the owning package
  and version with the document's digest and size, and returns the selection
  that reads its whole text.

Which owner applies is decided by descriptor provenance, not by probing which
filesystem happens to contain the relative path. Built-in AgentChassis
descriptor references are package-scoped. When the same logical path exists in
both places the declared owner wins deterministically, so a repository file can
never shadow a package-owned built-in reference and a package-owned reference
never falls back to the configured repository. Every refusal on that boundary
carries a stable typed code; the codes are tabulated in
[Package-Document Read Diagnostics](tool-discovery-schema.md#package-document-read-diagnostics).

The documentation bundle reaches the server as a closed carrier value handed
over by the package that owns it — today `@agent-chassis/core`'s forwarding bin,
derived from its own module location and its own `package.json`. There is no
environment variable, caller-supplied root, ancestor-package search, hoisting
assumption, or repository fallback that can produce one. A standalone
`@agent-chassis/wiki-mcp` launch therefore carries no documentation bundle, and
its reader refuses a package reference with the carrier-unavailable code.
