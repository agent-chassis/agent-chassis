
# MCP Integration

> **This is reference material.** For first setup, start with [docs/quickstart.md](quickstart.md).
> This page is the deeper MCP integration contract.

This document explains how agents should consume `agent-chassis` through MCP.
If the required backend infrastructure is unusable, `workspace_agent_dispatch` and `workspace_agent_run_status` fail closed with `backend_unavailable`. That covers both missing launch executor wiring and a missing or dead host-write-authority substrate; the host-write-authority case may surface with `backend_unavailable` plus the stable `host_write_authority_substrate_unavailable` reason.

## Phase 1 managed implementation-worker MCP contract (staged)

work record defines a Phase 1 managed implementation-worker contract that remains
staged until `work record` activates production confinement. Before that
activation, MCP descriptions, handshakes, dispatch results, and documentation
must not claim that the confinement or the associated worker tool profile is
active merely because predecessor code or this guidance has landed.

For that contract, let `R` be the normalized union of the canonical unit's
`read_scope` and `repo_paths`, and let `W` be the normalized canonical
`write_scope`. The launcher freezes both sets before launch. Once activated,
the worker's repository visibility is exactly `R union W`, and repository
mutation is permitted exactly within `W`; a target in `W` is visible without
also appearing in `R`.

The worker's prompt-governed Codex inspection shell remains only a non-mutating
inspection mechanism inside the visible `R union W` namespace. It is not MCP or
policy authority and cannot widen the frozen binding. The Phase 1
implementation-worker profile exposes no worker validation or general MCP
tools. Its sole delivery authority is the closed-input commit capability in the
trusted host/runtime boundary, using the server-resolved binding without
exposing repository git metadata or a general commit shell to the worker.

That restriction is specific to the Phase 1 implementation-worker profile. It
does not change reviewer or redteam launcher-owned validation contracts:
authorized reviewer/redteam `node_check` and confined `node_test` operations
remain available according to their declared validation. Persistent MCP client
registration and general `agent-safe` MCP guidance elsewhere on this page do
not grant either surface to a Phase 1 implementation worker.

Every supported family/backend path must preserve the same frozen namespace and
worker tool surface. Unsupported families, backends, scope shapes, or
confinement capabilities fail closed rather than falling back to broader
visibility or mutation. The bootstrap posture retains readable
launcher-provided Codex auth/sourceHome and `shareNet=true` model-API egress as
operator-accepted residual risks under prompt governance; it is not a
digest-bound or per-dispatch mechanical risk-acceptance mechanism.

## Key Point

This repository does **not** require a hosted MCP endpoint.

The intended integration model is spawned per session, local process, `stdio`
transport, no port binding, and no always-on service.

In MCP terminology this is still called a "server", but operationally it behaves like a command the client launches on demand.

Every launch path — externally registered clients, confined Codex orchestrators,
managed Codex workers, reviewers and redteam, direct/unconfined launch, configured
command paths, and installed-package startup — uses this stdio transport. There is
no launcher-hosted HTTP transport, loopback listener, or bearer-authenticated wiki
MCP endpoint. Stdio process/pipe ownership is the transport boundary.

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

## IN/DEC Mutation Routes

Initiative (`IN-*`) and decision (`DEC-*`) records are JSON-backed. The canonical
record is `wiki/initiatives/IN-####.json` / `wiki/decisions/DEC-####.json`; the
co-located `.md` is a generated projection that the kind-record store rewrites in
lockstep on every mutation. Agents must **not** hand-edit decision or initiative
Markdown to draft, revise, or change the authority of a record — a direct `.md`
edit desynchronizes the projection from its canonical JSON and bypasses schema
validation, provenance stamping, and stale-source protection. Use the structured
MCP mutation routes instead:

- create: born through the allocator-backed create surface (`workspace_create_record`
  with `type` `decision` or `initiative`); a new `DEC-*` is born `proposed` and a
  new `IN-*` as a draft
- decision drafts: `workspace_decision_amend_section` and
  `workspace_decision_amend_scalar` edit a `proposed` `DEC-*` in place
- decision lifecycle: `workspace_decision_ratify` (`proposed` -> `accepted`) and
  `workspace_decision_unratify` (`accepted` -> `proposed`); amending an `accepted`
  decision is refused until you `unratify` it back to `proposed`
- initiative edits: `workspace_initiative_amend_section` and
  `workspace_initiative_amend_scalar`

Per `decision` the free tier is ungated and fail-open: `ratify`/`unratify` are
agent-callable trusted status flips (no approver check, no filesystem or admission
lockdown), and every mutation stamps provenance (who/when). Authority consumers
treat `proposed` as non-binding and only `accepted` as authority (on trust in the
free tier). The paid CCE ratification-attestation enforcement boundary (approver-set signature,
separation of duties) is out of scope here and lives in node-engine.

For the per-tool argument contract, stale-source/validate-before-write behavior,
and the agent-safe tool profile, see
[docs/mcp-tool-reference.md](mcp-tool-reference.md#available-mcp-tools) rather than
duplicating the tool reference here.

## Agent-Facing Repository Model
Moved to [docs/mcp-repository-model.md](mcp-repository-model.md#agent-facing-repository-model) — the agent-facing repository model, including the `workspace_search_repo` ranked-retrieval, oversized-response-reference, and MCP sandbox profile v0 subsections.

## Agent Graph Impact Recipe
Moved to [docs/mcp-repository-model.md](mcp-repository-model.md#agent-graph-impact-recipe).

## Operation Reference
Moved to [docs/mcp-tool-reference.md](mcp-tool-reference.md#operation-reference); the full per-operation reference remains [docs/mcp-operation-reference.md](mcp-operation-reference.md).

## Dispatch Identity And Bootstrap Review
The normal agent call is `workspace_agent_dispatch({ role, subject })`. On every
call, the launcher backend reads the selected role's model from repo-root
`agent-launch.toml`, derives app/backend through the neutral model registry, and
either launches or returns an actionable role-specific missing/malformed/unknown
configuration refusal. Typed `app` and `model` are optional explicit overrides;
MCP forwards them or their omission to the launcher and does not preselect a
family. Prompt, request, argv, ambient environment, and claimed identity never
become selection authority.

Changes to `agent-launch.toml` apply on the next dispatch without a restart.
Changes to loaded MCP or launcher code require restarting the owning MCP server
or launcher session. See
[docs/mcp-tool-reference.md](mcp-tool-reference.md#dispatch-identity-and-bootstrap-review)
for the broader identity, host-write-sidecar, and bootstrap-review contract.

## Runtime Blocker Taxonomy And Coordination Preflight
Moved to [docs/mcp-tool-reference.md](mcp-tool-reference.md#runtime-blocker-taxonomy-and-coordination-preflight).

## Available MCP Tools
Moved to [docs/mcp-tool-reference.md](mcp-tool-reference.md#available-mcp-tools).

## Available MCP Resources
Moved to [docs/mcp-tool-reference.md](mcp-tool-reference.md#available-mcp-resources).

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

`workspace_tool_usage_audit` is a NEUTRAL usage-catalog telemetry surface for
operators and coordinators. Treat its output as bounded, descriptive evidence
about tool-use patterns seen in historical artifacts or live MCP calls -- not as
a misuse or adherence verdict, and not as canonical work-record state, dispatch
readiness, review attestation, lint status, or tool authority. It renders no
misuse or policy-adherence judgment at runtime; assessing the catalog for misuse
is an offline, out-of-band activity, never something this tool performs (work record). The canonical state for a work item remains the work record and the
domain-specific structured tools that own validation, dispatch, mutation,
review, lint, and generation.

The audit path uses historical backfill first when existing artifacts can prove
facts with an evidence envelope. Historical evidence can establish bounded facts
such as observed structured tool events, confidence, source kind, redacted path
categories, and unsupported gaps. Live MCP runtime capture exists only for
MCP-policy questions that historical artifacts cannot answer, such as
caller/session/profile provenance for an observed MCP call or the response
size/outcome of a live MCP call. The catalog records these neutral facts; it does
not judge whether a call followed any policy. Historical stderr, launcher
metadata, local shell traces, or review bundles must not be upgraded into a
confirmed MCP-specific fact when they cannot prove it; the audit result marks
those questions as unsupported gaps.

By default, `workspace_tool_usage_audit` returns compact, descriptive aggregate
telemetry: counts by tool, source group, and confidence; provenance buckets;
first-tool-per-bucket; high-response-size (expensive-call) indicators ranked by
size alone; and unsupported-gap labels. It reports no misuse codes and no
next-action adherence signals -- those runtime judgments were removed (work record);
misuse assessment is performed offline over the exported catalog facts. It preserves redaction rather than
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
Moved to [docs/mcp-tool-reference.md](mcp-tool-reference.md#code-index-interface-parity).

## Operational Expectations

Because this is spawned per session:

- there is no uptime to manage
- there is no deployment surface to maintain
- failures are local process failures, not remote-service incidents
- version alignment comes from the installed `@agent-chassis/*` package versions pinned in your lockfile

This is the intended operating model for agent-heavy consumers.
