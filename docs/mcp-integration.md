
# MCP Integration

> **This is reference material.** For first setup, start with [docs/quickstart.md](quickstart.md).
> This page is the deeper MCP integration contract.

This document explains how agents should consume `agent-chassis` through MCP.
If the required backend infrastructure is unusable, `workspace_agent_dispatch` and `workspace_agent_run_status` fail closed with `backend_unavailable`. That covers both missing launch executor wiring and a missing or dead host-write-authority substrate; the host-write-authority case may surface with `backend_unavailable` plus the stable `host_write_authority_substrate_unavailable` reason.

## Key Point

This repository does **not** require a hosted MCP endpoint.

The intended integration model is spawned per session, local process, `stdio`
transport, no port binding, and no always-on service.

In MCP terminology this is still called a "server", but operationally it behaves like a command the client launches on demand.

## What Agents Should Implement

Agents or MCP-capable clients should treat this repository as a command-based MCP provider.

The client should:

1. spawn the local process
2. speak MCP over stdin/stdout
3. configure trusted workspace repository roots in the server environment when routine broad approval is expected
4. use workspace-scoped tools for routine agent-facing repository retrieval
5. terminate the process when the session ends

The client should **not** assume an HTTP endpoint, a fixed port, a background
daemon, or shared in-memory state across sessions.

## Command To Spawn

Use this command shape:

```bash
wiki-mcp
```

Equivalent repo-local npm script after following
[package-install.md](package-install.md):

```bash
npm run wiki:mcp
```

The installed binary is the normal consuming-repo integration point. If a client
requires an explicit Node module path instead of resolving a bin, point it at
the installed package inside the consuming repo:

```bash
node node_modules/@agent-chassis/wiki-mcp/src/server.mjs
```

See [local-package-install.md](local-package-install.md) for the required
`@agent-chassis/wiki-cli`, `@agent-chassis/wiki-mcp`, and
`@agent-chassis/agent-launch-cli` install.

## Optional Persistent Client Registration

Persistent MCP client registration is operator convenience only. Commands such
as a Codex or Claude MCP "add" helper necessarily write that client's local or
user config, so they are not the launcher authority path for worker, reviewer,
or redteam sessions. Launcher-managed role sessions must receive wiki MCP access
through launcher-minted per-run configuration or client CLI overrides scoped to
the child process, with repo alias/root and `WIKI_MCP_TOOL_PROFILE=agent-safe`
coming from launcher-owned configuration.

Any future persistent registration helper for Codex or Claude must preserve this
boundary:

- It is opt-in for a human/operator, never required for dispatch readiness.
- Its dry run is idempotent and reports the exact proposed config delta without
  writing client config.
- It writes only after explicit operator confirmation or an explicit write flag.
- It uses the installed `wiki-mcp` binary, or an explicit installed module path
  such as `node_modules/@agent-chassis/wiki-mcp/src/server.mjs`; it must not use
  `npx` or any zero-install runtime server path.
- It refuses to overwrite unrelated Codex or Claude MCP config. Existing
  entries that are not owned by this helper require an explicit operator
  decision rather than silent replacement.

This helper boundary does not change the bootstrap contract: package bootstrap
may generate repo-local declarations such as `wiki/.wiki-mcp.json`, but it does
not edit global MCP client config.

## Example Client Configuration Shape

The exact config format depends on the MCP client, but the shape should look like this:

```json
{
  "command": "wiki-mcp",
  "args": []
}
```

If the client supports per-server environment or working-directory settings, use environment configuration for trusted workspace roots. The working directory does not need to be the consuming repo.

For routine agent-facing wiki retrieval where the MCP server itself is trusted, prefer configuring fixed workspace roots:

```json
{
  "command": "wiki-mcp",
  "args": [],
  "env": {
    "WIKI_MCP_REPOS": "{\"example-project\":\"/home/user/example-project\"}",
    "WIKI_MCP_DEFAULT_REPO": "example-project"
  }
}
```

`WIKI_MCP_REPOS` defines trusted repo aliases and roots.
`WIKI_MCP_DEFAULT_REPO` is a default selector and legacy compatibility input
for routes that explicitly document default-repo behavior; it is not current
repo authority for generic repo-scoped tools when their `repo` argument is
omitted. Generic repo-scoped tools with omitted `repo` require an explicit
current attachment through `WIKI_MCP_WORKSPACE_ALIAS` naming an alias already
present in `WIKI_MCP_REPOS`, `WIKI_MCP_WORKSPACE_ALIAS` plus
`WIKI_MCP_WORKSPACE_DIR`, a repo-local `wiki/.wiki-mcp.json` declaration under a
trusted root, or the trusted-root basename fallback described by the workspace
resolver. The alias-only form is supported even when
`WIKI_MCP_WORKSPACE_ALIAS` matches `WIKI_MCP_DEFAULT_REPO`, as long as the alias
is present in `WIKI_MCP_REPOS`; `WIKI_MCP_DEFAULT_REPO` by itself is still not a
current attachment. When no current attachment is available, callers should
pass an explicit `repo` alias.

For a single-repo setup, this equivalent shorthand is also supported:

```json
{
  "env": {
    "WIKI_MCP_WORKSPACE_ALIAS": "example-project",
    "WIKI_MCP_WORKSPACE_DIR": "/home/user/example-project"
  }
}
```

If the repo root is already configured in `WIKI_MCP_REPOS`, the launcher/server
can attach the current repo by alias only:

```json
{
  "env": {
    "WIKI_MCP_REPOS": "{\"example-project\":\"/home/user/example-project\"}",
    "WIKI_MCP_DEFAULT_REPO": "example-project",
    "WIKI_MCP_WORKSPACE_ALIAS": "example-project"
  }
}
```

This does not expand route-local default-repo compatibility exceptions. It only
declares the current repo because `WIKI_MCP_WORKSPACE_ALIAS` names a trusted
alias from `WIKI_MCP_REPOS`.

Agent-facing clients should set `WIKI_MCP_TOOL_PROFILE` to `agent-safe` and can
then set server-level MCP approval to approve:

```toml
[mcp_servers.wiki]
default_tools_approval_mode = "approve"

[mcp_servers.wiki.env]
WIKI_MCP_TOOL_PROFILE = "agent-safe"
```

The `agent-safe` profile does not use a hand-maintained route list. Agent-safe
exposure is descriptor-audience-derived. An MCP tool is registered under
`agent-safe` only when both gates allow it:
its checked-in tool-discovery descriptor entry has `kind: "mcp_tool"` and a raw
`audience` array that includes the literal `"agent"`
(`Array.isArray(entry.audience) && entry.audience.includes("agent")`), **and**
the registered-tier gate permits it for the resolved session. The two gates
compose as an independent AND: descriptor audience never overrides tier
visibility, and tier visibility never grants agent-safe exposure to a tool whose
descriptor omits the literal `"agent"` audience. The audience gate is
default-deny — a missing, empty, non-array, or non-literal/substring `audience`
value does not make a tool agent-safe. The descriptor `audience` field is
therefore the authoritative agent-exposure control; caller text, prompt intent,
argv, environment, and wrapper names are not exposure authority. See
[docs/tool-discovery.md](tool-discovery.md) (`agent-safe` / `agent-authoritative`
are not tier labels) for the full derivation and fail-closed rules.

## Repo-Local Workspace Declaration

`wiki/.wiki-mcp.json` is the repo-local MCP declaration path for consuming
repos that want to self-describe their intended workspace alias without editing
global MCP client settings by hand.

The declaration is consumed only after the launcher/client has already selected
a trusted workspace root. It is not a caller-supplied filesystem root, and it
does not grant trust to arbitrary paths outside that trust model.

The current repo declaration schema is `wiki-mcp-workspace.v1`.

Minimum current-repo fields:

- `schema_version`: must be `wiki-mcp-workspace.v1`
- `current.alias`: the repo's workspace alias
- `current.root`: the fully resolved absolute realpath for the current repo

Optional metadata:

- `profile`: a preferred repo profile for the current workspace declaration
- `tool_profile`: a preferred tool surface profile, such as `agent-safe`
- `linked_repos`: an alias-to-directory registry for controlled cross-repo
  read/search workflows, where each linked entry uses a fully resolved absolute
  realpath and may only be consumed under the linked-root trust rules below

Example declaration:

```json
{
  "schema_version": "wiki-mcp-workspace.v1",
  "current": {
    "alias": "example-project",
    "root": "/home/user/example-project"
  },
  "profile": "agent-safe",
  "tool_profile": "agent-safe",
  "linked_repos": {
    "agent-chassis": {
      "root": "/home/user/agent-chassis",
      "profile": "agent-safe"
    }
  }
}
```

When the trusted root contains a valid declaration, the server may derive the
workspace alias from `wiki/.wiki-mcp.json` unless an explicit launcher-owned
alias override is already present.

Before alias collision checks, duplicate directory checks,
current-vs-linked equivalence checks, and target declaration matching, the
server canonicalizes every current and linked root with `realpath`. Relative
paths, `~`, environment interpolation, unresolved symlinks, and ambiguous
paths are refused.

Each `linked_repos` entry is usable only when one of the following is true:

- the launcher/client already independently trusted the linked root, or
- the target repo contains `wiki/.wiki-mcp.json` with
  `schema_version: "wiki-mcp-workspace.v1"` and a matching
  `current.alias`/`current.root` pair for that linked alias and root

The target declaration is read only from `wiki/.wiki-mcp.json` under the
proposed target root. Missing target declarations, alias/root mismatches,
invalid target schema, non-repo targets, missing directories, symlink
ambiguity, duplicate canonical realpaths, current-vs-linked equivalence
conflicts, and conflicting profile fields fail closed with structured
diagnostics.

The bootstrap and tool flows in this repository do not write global MCP client
settings. Repo-local declarations are the preferred package-agnostic per-repo
setup path, while the existing environment variables remain compatibility
fallbacks:

- `WIKI_MCP_REPOS`
- `WIKI_MCP_DEFAULT_REPO`
- `WIKI_MCP_WORKSPACE_ALIAS`
- `WIKI_MCP_WORKSPACE_DIR`
- `WIKI_MCP_TOOL_PROFILE`

For the full set of supported environment and `.env` keys across all classes
(hosted service, role selection, MCP server, launcher runtime), see
[env-reference.md](env-reference.md).

Invalid or conflicting declarations fail closed with structured diagnostics.
Typical refusal cases include:

- invalid schema or malformed JSON
- alias conflict with an explicit launcher-owned alias
- duplicate directory or duplicate canonical realpath
- missing target directory or missing declaration target
- alias/root mismatch between a linked entry and the target repo declaration
- symlink ambiguity or unresolved path canonicalization failure
- conflicting current, linked, profile, or tool_profile metadata
- no trusted root available for declaration consumption

The important security rule is unchanged: repo-local declaration can describe
intent and controlled alias-to-root mappings, but it cannot by itself make an
arbitrary filesystem path trusted.

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

## Operation Reference

The full per-operation reference is
[docs/mcp-operation-reference.md](mcp-operation-reference.md): every MCP tool
and CLI fallback, contract-edit compact/verbose/stale-source/validate-before-write
behavior, and graph-impact compact-default and verbose opt-in contract. This page
stays the MCP setup and mental-model entry point.

## Dispatch Identity And Bootstrap Review

[Detailed dispatch identity, bootstrap review, run-status, host-write sidecar, and caller/session identity contract.](mcp-dispatch-runtime-contract.md#dispatch-identity-and-bootstrap-review)
### workspace_agent_dispatch And workspace_agent_run_status

[Detailed dispatch and monitor contract.](mcp-dispatch-runtime-contract.md#workspace_agent_dispatch-and-workspace_agent_run_status)

In the free/local tier, `workspace_agent_run_wait` and `workspace_agent_run_status`
may report terminal success while `structured_role_result.valid:false`, because
`decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting.
That is expected, non-attesting state — not a failed child run, a failed dispatch,
or missing findings. A schema-valid structured role result is a CCE capability
enabled only by a configured CCE key.

Tool discovery, MCP registration, live tool descriptions, the agent FAQ, and
mixed-route default output are **tier-projected** by the registered CCE/Node Engine
key posture. Free/local registrations see only source-available coordination tools
and explanations; CCE policy, admission, attestation, diagnostics,
graph-impact/blast-radius, and recovery detail are exposed only after a canonical
CCE-key posture is positively resolved. The registered tier is resolved from the
canonical key posture (`decision`/`decision`/`decision`), never from caller input.
See [docs/tool-discovery.md](tool-discovery.md) "Registered-Tier Exposure And
Projection".
### Host Write Authority Localhost Sidecar Endpoint

[Detailed localhost sidecar endpoint contract.](mcp-dispatch-runtime-contract.md)
### Caller/Session Identity

[Detailed caller/session identity contract.](mcp-dispatch-runtime-contract.md#caller-session-identity)
## Runtime Blocker Taxonomy And Coordination Preflight

[Detailed runtime blocker taxonomy and preflight contract.](mcp-dispatch-runtime-contract.md#runtime-blocker-taxonomy-and-coordination-preflight)
### MCP Tools

[Runtime blocker/preflight MCP tool details.](mcp-dispatch-runtime-contract.md#mcp-tools)
## Available MCP Tools

[Agent-facing MCP tool profile lists.](mcp-tool-registry-reference.md#available-mcp-tools)
## Available MCP Resources

[Agent-facing MCP resources reference.](mcp-tool-registry-reference.md#available-mcp-resources)

## Recommended Agent Workflow

For reusable repo-local `AGENTS.md` text that teaches agents this retrieval
model, see `packages/wiki-core/templates/AGENTS.md.boilerplate.md`.

For a new consuming repo:

1. read `contract://manifest` and optionally `contract://schema`
2. choose the correct repo profile
3. call `bootstrap_repo`
4. call `lint_repo`
5. start creating records with `create_record`

For an existing consuming repo:

1. call `sync_contract` or `sync_contract` with `check: true`
2. call `lint_repo`
3. fix surfaced drift
4. use `allocate_id` and `create_record` for new entries

Reservation rule:

- `allocate_id` advances the shared allocator state and returns the reserved ID
- `create_record` materializes the next reserved ID before allocating a fresh one
- callers may also pass `id` to `create_record` when they want to bind creation to the next expected allocated ID explicitly
- MCP `create_record` uses the same controlled allocator-backed core operation as the CLI creation flow
- `workspace_create_record` is the agent-safe MCP create surface: it accepts `{ repo?, type, title, id? }`, resolves the workspace through configured aliases, and delegates to the same allocator-backed core operation; agents should use it instead of `create_record` whenever a workspace alias is configured

Read rule:

- in Codex sessions, use repo-local CLI retrieval first: `npm run wiki -- search --query ...`, `npm run wiki -- read --path ... --json`, and `npm run wiki -- get-record --id ... --json`
- MCP-native clients may use `workspace_search_repo` to identify canonical paths, then `workspace_read_page` to retrieve the complete page without a filesystem fallback
- MCP-native clients may use `workspace_get_record` when a durable record ID is already known and a workspace repo is configured; `WK-*` IDs are returned from `wiki/work-records/WK-####.json` JSON authority and do not require generated Markdown views
- `workspace_read_page` reads Markdown pages and canonical `wiki/work-records/WK-####.json` work records inside the configured workspace repository; other JSON paths and traversal outside the configured root are rejected
- tracker WK-level defaults for `workspace_get_record`, `workspace_read_page`, and `workspace_work_record_summary` are compact: detailed `done`, `cancelled`, and `parked` slice bodies and WK-level `agent_notes` bodies are intentionally omitted, with status counts, omission metadata, and `agent_notes_bytes` on included slice rows as the compact signals; use targeted selected-slice reads/summaries or explicit full/debug opt-ins for hidden detail
- if the MCP approval layer reports encrypted reasoning, prior tool-call state, or a tool-call/action mismatch, use CLI retrieval instead
- when code index context is needed, use `workspace_code_index_status`, `workspace_code_index_impact_paths`, `workspace_code_index_graph_impact_paths`, `workspace_code_index_graph_impact_diff`, `workspace_code_index_find_references`, `workspace_code_index_definition`, and `workspace_code_index_context_for_path` for routine reads
- do not block routine implementation work on a clean worktree or fresh code index cache; dirty-overlay evidence is expected during normal work
- use `workspace_code_index_build` or `workspace_code_index_rebuild` only for explicit cache refreshes when a clean worktree is available

Tool discovery rule:

The three tool-discovery tools have distinct scopes to avoid pulling the full catalog into context:

- `workspace_tools_list` — compact daily-use catalog scan, bounded to 20 entries by default. Use when you need a quick bounded overview of available tools or want to filter by `task_id`/`tool_name`/`limit`. Returns compact entry fields: `tool_name`, `display_name`, `kind`, `entrypoint`, `task_ids`, `runtime_posture`, `recommended_route`, `priority`.
- `workspace_tools_describe` — compact per-tool detail, same compact fields by default, same 20-entry bound. Pass `verbose: true` to expand to full catalog entries (`display_name`, `install_state`, `side_effects`, `authority`, `docs_refs`, `source_files`, `notes`). Use for targeted inspection when you already know which tool you want to examine.
- `workspace_tools_query` — targeted lookup by `task_id` or `tool_name`. Returns compact entry shape. Use when you already know the exact identifier and want the narrowest possible result.

All three are read-only and bounded by default. Do not call `workspace_tools_describe` without a filter when a bounded `workspace_tools_list` scan would answer the question first. Do not call any tool-discovery route with `verbose: true` unless the compact entry fields are insufficient.

Router and discovery guidance rule:

`workspace_tool_router_recommend` is an advisory first-call router. Agents and
operators should use it when the correct first MCP tool is unclear, especially
for coordination tasks where search, full record reads, dispatch, lint, or
mutation might be the wrong starting point. A matched router response recommends
the first call and any derivable arguments; ambiguous or unknown responses bound
the next question instead of guessing, reading full records, dispatching,
mutating, linting, or validating on the caller's behalf.

Tool discovery exposes the same routing contract as compact metadata on tool
entries. Fields such as `use_when`, `do_not_use_when`, `authoritative_for`,
`recommended_first_call`, `requires_prior_state`, and
`replacement_for_misuse` are machine-actionable selection hints for agents,
reviews, and operators. They are not a second source of execution authority and
they do not make discovery responsible for performing the underlying operation.

Domain tools retain authority for their domains: read tools own reads, dispatch
readiness tools own dispatchability decisions, dispatch tools own role launch,
lint tools own lint results, mutation tools own writes, and validation tools own
validation outcomes. Router and discovery output may tell an agent which of
those tools to call first or avoid as a first call; the called domain tool's
structured result remains the authority for the operation.

Vocabulary ownership is split by WK. `work record` owns the misuse-code vocabulary
in `tool-use-policy.v1`; `work record` owns routing-intent ids and replacement-call
guidance in `tool-routing-intents.v1` and tool-discovery metadata. MCP
integration docs should reference that split rather than duplicating either
vocabulary inline.

`workspace_tool_usage_audit` is an observed-adherence telemetry surface for
operators and coordinators. Treat its output as bounded evidence about tool-use
patterns seen in historical artifacts or live MCP calls, not as canonical
work-record state, dispatch readiness, review attestation, lint status, or tool
authority. The canonical state for a work item remains the work record and the
domain-specific structured tools that own validation, dispatch, mutation,
review, lint, and generation.

The audit path uses historical backfill first when existing artifacts can prove
facts with an evidence envelope. Historical evidence can establish bounded facts
such as observed structured tool events, confidence, source kind, redacted path
categories, and unsupported gaps. Live MCP runtime capture exists only for
MCP-policy questions that historical artifacts cannot answer, such as
caller/session/profile provenance for an observed MCP call or whether a live MCP
call followed the expected compact-first and next-action policy. Historical
stderr, launcher metadata, local shell traces, or review bundles must not be
upgraded into confirmed MCP-specific misuse when they cannot prove that fact;
the audit result should mark those questions as unsupported gaps.

By default, `workspace_tool_usage_audit` returns compact aggregate telemetry:
counts by tool and misuse code, expensive-call indicators, next-action adherence
signals where derivable, source/confidence labels, unsupported-gap labels, and
caller/session/profile provenance buckets. It preserves redaction rather than
returning raw prompts, full arguments, raw results, filesystem roots, secrets,
or child-agent final text. Caller provenance, session provenance, and tool
profile are separate dimensions so operator/full-profile/test calls are not
conflated with launcher-managed agent-safe role sessions.

`workspace_tool_usage_audit` does not dispatch agents, mutate records, run
lint/generate, block or refuse calls, route agents, grant tool authority, revoke
tool authority, or reinterpret a domain tool's result. It may report misuse
codes owned by `tool-use-policy.v1` and coarse or work record-derived guidance when
available, but the relevant domain tool still owns the operation itself.

Backlink rule:

- when an issue, initiative, decision, or area lists a durable `docs/**` page in `read_scope` (or the legacy `docs` alias), that page must include a matching `<!-- wiki: id=... relation=tracks -->` comment; `AGENTS.md` and `wiki/**` read-first entries are validated for existence only and do not require a backlink
- when a source lists a durable doc in `related_docs`, the doc must include a matching `<!-- wiki: id=... relation=evidence_for -->` comment
- `lint_repo` is non-mutating; missing-backlink findings include the exact comment agents should add where it fits the target document
- `workspace_autofix_docs_backlinks` is the separate explicit opt-in MCP route for missing docs backlink comments only; it recomputes fresh lint findings internally and does not make `workspace_lint_repo`, CLI `wiki lint`, or `workspace_generate_and_lint` autofix by default

Generated-view control rule for agents:

1. if you need `catalog`, `now`, `inbox`, `backlog`, or `archive`, call `generate_views` first when practical
2. otherwise call `lint_repo` and confirm there are no `missing_generated_view` or `stale_generated_view` findings
3. if generated views are stale or missing, prefer canonical pages over derived views

## Code Index Interface Parity

Repo code index MCP tools must expose machine-readable result data in `structuredContent`. The equivalent CLI `code-index` surface must expose the same data as JSON through a stable `--json` mode. The older `sidecar` CLI and MCP tool names remain compatibility aliases in the full tool profile.

Repo code index parity comparisons require both MCP and CLI JSON results to
carry the same trust-envelope fields, including `schema_version`, `source_kind`,
`canonicality`, `evidence_basis`, `index_head`, `index_tree`, `dirty_state`,
`dirty_details`, `staleness`, canonical references, and derived evidence.

SCIP symbol navigation parity is exposed through CLI `wiki code-index
find-references --json` / `wiki code-index definition --json` and MCP
`workspace_code_index_find_references` / `workspace_code_index_definition`.
Those tools return derived, non-canonical SCIP evidence only: provider
descriptor(s), coverage, freshness/dirty-worktree state, and per-result
`resolution.state` remain part of the machine-readable envelope. When the SCIP
overlay is absent or degraded, the tools report the unavailable SCIP state
explicitly instead of returning an empty complete-looking answer.

## Operational Expectations

Because this is spawned per session:

- there is no uptime to manage
- there is no deployment surface to maintain
- failures are local process failures, not remote-service incidents
- version alignment comes from the installed `@agent-chassis/*` package versions pinned in your lockfile

This is the intended operating model for agent-heavy consumers.
