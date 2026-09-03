
# Tool Discovery Schema

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for the `tool-discovery.v1` data contract:
the authority posture, the envelope schema and freshness model, the tool entry
schema and routing metadata, the controlled task-ID vocabulary, the status model,
and the side-effect and authority vocabularies.

## Authority And Trust

Discovery output does not create authority. It only reports it.

The registry contract must not be used to infer support from:

- wrapper filenames
- package manifests alone
- executable mode bits
- stale runtime caches
- historical WK pages

When runtime output conflicts with the checked-in descriptor, agents must treat
the conflict as a freshness problem and consult the documented source of truth
instead of assuming the runtime result is more authoritative.

The fragment manifest also owns the owner-bound conformance and aggregate
prose-debt baselines. Compatibility aliases are ordinary live descriptor rows,
not a new lifecycle state. Each alias record requires an owner, target WK,
review date, replacement route, and named compatibility test. Aggregate
raw-note and paid/operator live-description records preserve the 62,000 and
28,000 targets and pin exact per-tool character lengths, totals, denominators,
and digests. The manifest validator rejects malformed maps; pinned manifest
tests reject rebasing; lint rejects new or enlarged raw notes; and the MCP
description-budget CI test rejects new or enlarged live descriptions.
Registration separately requires a nonempty live description within the single
1,500-character runtime ceiling owned by the descriptor policy module. Exact
historical lengths and the 28,000 aggregate target never authorize startup.
Reductions retire debt without moving a baseline upward.

## Envelope Schema

The discovery envelope uses these top-level fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `schema_version` | yes | Constant string `tool-discovery.v1`. |
| `generated_at` | yes | UTC timestamp for when the envelope was produced. |
| `interface` | yes | The transport used to obtain the envelope: `mcp`, `cli`, or `descriptor`. |
| `source_kind` | yes | Where the data came from: `checked_in_descriptor`, `runtime_snapshot`, or `last_resort_descriptor`. |
| `package_versions` | yes | Object keyed by package name with the version used to generate or validate the envelope. |
| `descriptor` | yes | Descriptor identity, including `path` and `digest`. |
| `freshness` | yes | Freshness and degradation state for the envelope. |
| `query` | no | Echo of the caller query when a filter was applied. |
| `results` | yes | Ranked tool entries. |
| `diagnostics` | yes | Deterministic machine-readable diagnostics. |

Minimal envelope shape:

```json
{
  "schema_version": "tool-discovery.v1",
  "generated_at": "2026-05-20T17:50:46Z",
  "interface": "mcp",
  "source_kind": "runtime_snapshot",
  "package_versions": {
    "wiki_core": "0.0.0",
    "wiki_cli": "0.0.0",
    "wiki_mcp": "0.0.0"
  },
  "descriptor": {
    "path": "packages/wiki-core/data/tool-discovery/manifest.json",
    "digest": "sha256:..."
  },
  "freshness": {
    "state": "fresh",
    "degraded": false,
    "reasons": []
  },
  "results": [],
  "diagnostics": []
}
```

### Freshness

`freshness.state` is a controlled value:

- `fresh` means the runtime envelope matches the checked-in descriptor and the
  package/version metadata is aligned.
- `stale` means the envelope is readable but the descriptor digest or package
  metadata diverges from the checked-in source.
- `degraded` means the envelope was produced, but some required data was
  missing, partial, or had to be inferred from a fallback path.
- `missing` means no usable discovery surface was available.

`freshness.degraded` is a boolean summary that should be `true` whenever the
state is `stale`, `degraded`, or `missing`.

`freshness.reasons` is an ordered array of short machine-readable reasons such
as `missing_mcp_surface`, `missing_cli_fallback`, `descriptor_digest_mismatch`,
`package_version_drift`, or `tool_surface_untracked`.

## Tool Entry Schema

Each result entry describes one discoverable tool or command.

| Field | Required | Meaning |
| --- | --- | --- |
| `tool_name` | yes | Stable machine-readable name for the tool. |
| `display_name` | yes | Human-readable name. |
| `kind` | yes | Entry type such as `mcp_tool`, `cli_command`, `wrapper_command`, or `descriptor_only`. |
| `entrypoint` | yes | Canonical invocation or MCP method name. |
| `task_ids` | yes | Controlled task vocabulary values associated with the tool. |
| `install_state` | yes | Physical presence of the tool in this repo. |
| `runtime_posture` | yes | Runtime behavior and support posture. |
| `recommended_route` | yes | Preferred route an agent should use. |
| `priority` | yes | Curated integer used for deterministic ranking. |
| `side_effects` | yes | Controlled side-effect vocabulary. |
| `authority` | yes | Controlled authority vocabulary describing which source governs the tool. |
| `tier_visibility` | yes | Controlled registered-tier exposure vocabulary (`free_local`, `paid_cce`, `operator_only`). See [Registered-Tier Exposure And Projection](tool-discovery-tiers.md#registered-tier-exposure-and-projection). |
| `tier_text` | no | Optional per-tier prose overrides (`notes`/`summary`) keyed by registered tier; the base body is the free/local common text and CCE detail lives only under `tier_text.paid_cce`. This projection is product routing, not a minimum-disclosure or confidentiality policy. |
| `docs_refs` | yes | Durable docs that explain the tool or contract. In the CHECKED-IN descriptor this is source metadata: it records what the tool is documented by. In RUNTIME verbose output it is filtered to the references the current server session can actually serve. See [Documentation Reference Scope](#documentation-reference-scope). |
| `docs_ref_scopes` | no | Optional per-reference scope override keyed by logical path. Only `workspace` is meaningful; everything else stays package-scoped. |
| `doc_references` | runtime | Runtime-only, verbose-only, scope-qualified projection of `docs_refs`. Each entry carries `path`, `scope`, `read_tool`, and for package scope `owner_package`/`owner_package_version`. Never present in the checked-in descriptor. |
| `documentation_state` | runtime | Runtime-only bounded diagnostic present when a reference was omitted: `advertised_count`, `omitted_count`, `omitted_reasons`, and an `omitted_sample` of at most three logical paths. |
| `source_files` | yes | Repo-relative files that define or verify the tool. |
| `notes` | no | Optional extra guidance that does not change status. |
| `use_when` | agent-visible MCP | Positive selection conditions. Required for a new or changed installed, supported MCP row. |
| `do_not_use_when` | agent-visible MCP | Negative selection conditions with the owning alternative or recovery route. Required for a new or changed installed, supported MCP row. |
| `authoritative_for` | agent-visible MCP | The exact decision or fact owned by the route. Required for a new or changed installed, supported MCP row. |
| `recommended_first_call` | agent-visible MCP | Executable first-call or next-call guidance using the existing operation and argument vocabulary. Required for a new or changed installed, supported MCP row. |

The canonical manifest carries the single owner-bound conformance-debt ledger
for older rows. Each baseline entry is pinned by its descriptor-entry digest.
A baseline row may retire by becoming conformant or disappearing through an
authorized compatibility retirement; a changed or newly nonconformant row is
reported as `debt_added` and fails lint and registration. Applicability
exceptions remain an empty, mechanically checked array until an adopted owner
defines an authority-bearing exception protocol.

### Documentation Reference Scope

A checked-in descriptor records what a tool is documented BY. A running session
can only advertise what it can SERVE. Those were the same fact only while the
server ran inside this repository's own checkout; inside a consuming repository
they are not, which is how discovery came to advertise `docs/mcp-operation-reference.md`
to an agent whose workspace did not contain it.

Scope comes from DESCRIPTOR PROVENANCE, never from probing which filesystem
happens to contain the relative path:

- A built-in AgentChassis descriptor row is **package-scoped**. Its executable
  read route is `workspace_read_tool_doc`, served from the documentation bundle
  the launching package supplies.
- A row may name individual references as **workspace-scoped** through
  `docs_ref_scopes`. Those keep `workspace_read_page` as their route.
- When the same logical path exists in both places the declared owner wins
  deterministically. A workspace file can never shadow a package-owned built-in
  reference, and a package-owned reference never reads the consuming workspace.

Runtime verbose output advertises a package-scoped reference only when the
session's bound package documentation carrier can serve it. A session launched
without a carrier — a direct `@agent-chassis/wiki-mcp` launch, which ships no
documentation bundle — advertises no package-owned reference and says so through
`documentation_state` rather than leaving an unreachable value in `docs_refs`.
Compact list and query output carries no documentation fields at all, so
discovery compactness is unchanged.

`packages/core/scripts/sync-public-docs.mjs` owns the single `PUBLIC_DOCS`
mapping (logical descriptor path, repository source path, bundled package path)
and generates `packages/core/docs/public-docs-manifest.json` with each bundled
file's content digest. Every unique documentation reference advertised by the
checked-in built-in descriptors must have an entry there; packaging refuses
otherwise. An entry may be declared but deliberately not shipped — the
repository-local `internal/` and `wiki/` trees are never published — in which
case the manifest records it as unavailable with a reason and the runtime omits
it instead of advertising a reference no session can read.

### Package-Document Read Diagnostics

Every failure on this boundary is a stable typed identity. Nothing degrades into
a partial bundle, a guessed root, or a consumer-workspace read: a session that
cannot serve a reference does not advertise it, and a call that cannot be
authorized refuses with one of these codes.

Runtime `documentation_state.omitted_reasons` values (why a reference is not
advertised):

| Code | Meaning |
| --- | --- |
| `package_docs_carrier_absent` | The session was launched without a package documentation carrier, so no package-scoped reference is executable. |
| `package_docs_reference_not_bundled` | The bound carrier's manifest does not carry this logical path (declared but not shipped, or absent from the installed bundle). |

`workspace_read_tool_doc` refusal codes (`tool-doc-read-refusal.v1`; a success
envelope is `tool-doc-read.v1`):

| Code | Refused because |
| --- | --- |
| `package_docs_carrier_unavailable` | No carrier was supplied, or the supplied carrier is incomplete or not absolute. |
| `package_docs_manifest_unreadable` | The carrying package's documentation manifest is absent, unreadable, or not valid JSON. |
| `package_docs_manifest_schema_mismatch` | The manifest does not declare `public-docs-manifest.v1`. |
| `package_docs_package_version_mismatch` | The manifest names a different package identity or version than the carrying package. |
| `tool_not_visible_to_session` | The named tool is not visible to this session's launcher-minted role and registered tier. The refusal does not confirm the name back to the caller. |
| `documentation_reference_not_advertised` | The tool does not currently advertise that package-scoped logical path. |
| `descriptor_manifest_disagreement` | Discovery advertised the reference and the bound manifest does not carry it, so nothing is read. |
| `invalid_documentation_path` | The path is not an advertised repository-relative logical path: absolute, `~`-rooted, drive-lettered, backslashed, NUL-bearing, untrimmed, empty, or carrying a `.`/`..` segment. |
| `documentation_path_containment_failure` | The manifest entry does not resolve inside the bound package root. |
| `documentation_read_failed` | The manifest-bound bundled file could not be read. There is no workspace or ancestor fallback. |

The input is closed: exactly `tool_name` and `path`. A caller-supplied package
root, docs root, or manifest path is refused by the published schema
(`additionalProperties: false`), and the response names only the logical path and
the owning package identity — never an installation root.

### Routing Metadata Fields

Tool entries may include compact routing metadata for agent first-call
selection. These fields are machine-actionable hints consumed by discovery,
the router, and reviews; they are not prose policy inventories and do not make
the descriptor the authority for executing the underlying operation.

| Field | Meaning |
| --- | --- |
| `use_when` | Short routing-intent ids or bounded task conditions where this entry is an appropriate first or early call. |
| `do_not_use_when` | Short routing-intent ids or bounded task conditions where this entry is the wrong first call. |
| `authoritative_for` | Exact decision, evidence, read, mutation, or advisory domains this tool owns once its prerequisites are satisfied. |
| `recommended_first_call` | Structured router hint containing `routing_intents`, derivable argument templates, and omission behavior for null/unknown arguments. |
| `requires_prior_state` | Minimal state that must already be known or selected before the tool should be called, such as a `WK-*`, `WK-*#SLICE-*`, `IN-*`, role, monitor handle, or known repo path. |
| `replacement_for_misuse` | Bounded replacement guidance from an observed misuse code and routing intent to the tool that should be used instead. |

`use_when`, `do_not_use_when`, and `authoritative_for` should prefer stable
routing-intent ids from `tool-routing-intents.v1` when a routing intent exists.
When a field needs prose, use one concise condition that can be interpreted as
a predicate, not a narrative description.

`recommended_first_call` is advisory routing guidance. It may name the first
tool and argument template an agent should try when the router can derive the
required state; it must not dispatch, mutate, validate readiness, run lint, or
read full records by itself. If the required state is absent, the router should
return `ambiguous` or `unknown` according to `tool-routing-intents.v1` rather
than guessing a broad fallback.

`replacement_for_misuse` bridges two owned vocabularies without duplicating
either one inline. work record owns the misuse-code vocabulary in
`tool-use-policy.v1`; work record owns routing-intent ids and replacement-call
guidance in `tool-routing-intents.v1` and the discovery metadata. Discovery
entries may reference those ids, but changes to the code vocabulary or routing
vocabulary belong in their owning WK/contracts.

Example result entry:

```json
{
  "tool_name": "tools-describe",
  "display_name": "Describe available tools",
  "kind": "cli_command",
  "entrypoint": "npm run wiki -- tools-describe --json",
  "task_ids": ["search-wiki", "read-canonical", "inspect-provenance"],
  "install_state": "installed",
  "runtime_posture": "supported",
  "recommended_route": "cli",
  "priority": 100,
  "side_effects": ["read_only"],
  "authority": ["checked_in_descriptor", "workspace_repo"],
  "docs_refs": ["packages/wiki-core/templates/AGENTS.md.boilerplate.md", "docs/agent-launch-quickstart.md"],
  "source_files": ["packages/wiki-core/data/tool-discovery/cli-commands.json"]
}
```

## Controlled Task IDs

The descriptor uses a controlled `task_id` vocabulary so query results are
stable across transports and consuming repos. The executable vocabulary owner
is `packages/wiki-core/src/lib/tool-discovery/descriptor.mjs`; this table is its
durable documentation projection, not an independent registry.

| Task ID | Intent |
| --- | --- |
| `create-work-record` | Create a new canonical `WK-*` record. |
| `validate-work-record` | Validate a canonical work record. |
| `validate-dispatch` | Check whether a unit is dispatch-ready. |
| `dispatch-worker` | Start an implementation worker. |
| `dispatch-reviewer` | Start a findings-only review worker. |
| `dispatch-redteam` | Start a findings-only redteam worker. |
| `list-orchestrators` | List active orchestrator sessions or equivalent local state. |
| `start-orchestrator` | Open a new orchestrator session when the repo supports it. |
| `resume-orchestrator` | Resume an existing orchestrator session when the repo supports it. |
| `refresh-derived-evidence` | Refresh generated or derived evidence surfaces. |
| `query-graph-impact` | Inspect compact code-index or graph impact evidence; `verbose:true` or a raw/debug route exposes the full envelope. |
| `search-wiki` | Search canonical wiki content. |
| `read-canonical` | Read a canonical wiki page or work record. For tracker WK-level defaults, compact record reads omit detailed `done`, `cancelled`, and `parked` slice bodies and WK-level agent note bodies; use status counts, omission metadata, `agent_notes_bytes`, targeted selected-slice reads, or explicit full/debug opt-ins for hidden detail. |
| `cleanup-runtime-artifacts` | Remove local runtime artifacts or stale launcher state. |
| `inspect-provenance` | Inspect provenance, descriptor digest, or source evidence. |
| `set-closure` | Apply a structured closure patch to a work record or slice. |
| `persist-graph-impact-evidence` | Persist structured graph-impact evidence onto a work record or slice. |
| `generate-and-lint` | Regenerate wiki views and lint the repository against the shared contract. Optional `max_findings` (omit for the bounded compact default, `0` for counts only, or a positive integer with no hard upper bound) controls how many lint findings the response returns. |
| `lint-repo` | Validate a repository against the shared wiki contract (read-only). Optional `max_findings` (omit for the bounded compact default, `0` for counts only, or a positive integer with no hard upper bound) controls how many lint findings the response returns; responses carry `finding_count_total`/`findings_returned`/`findings_truncated`/`max_findings`. |
| `validate-docs-policy` | Validate agent-facing docs for non-MCP role-dispatch drift with audience-scoped operator/internal sections. |
| `summarize-work-record` | Return a compact work-record summary view (dependencies, write_scope, acceptance, slices, validation, owners, review state, blockers). Tracker WK-level defaults intentionally omit detailed `done`, `cancelled`, and `parked` slice bodies and WK-level agent note bodies; selected-slice summaries and explicit full/debug opt-ins recover selected or complete detail. |
| `summarize-initiative-status` | Adopted compact read-only coordinator action lens for initiative or selected-unit triage. Use it to identify the next durable coordinator action, then route actual operations to the owning structured tools (`workspace_work_record_summary`, `workspace_validate_dispatch`, `workspace_agent_dispatch`, `workspace_agent_run_status`, `workspace_lint_repo`, and the work-record setter routes). |
| `coordination-preflight` | Compose the coordinator/orchestrator preflight envelope (role, write surfaces, repo/docs/wiki writability, structured routes, runtime blockers). |
| `describe-runtime-blocker-taxonomy` | Read the schema-backed runtime blocker taxonomy (codes, categories, graph-impact degraded-state mapping, bootstrap subset). |
| `contract-edit` | Edit the pre-dispatch contract of a work record: upsert or delete tracker-local slices, set list-valued contract fields, set acceptance criteria and validation, or shape a unit into a findings-only review unit. |
| `run-validation` | Run declared Node test validation (`node --check` then `node --test`) for an implementation unit's work-contract-authorized target, with `process_spawn` side effect and no raw shell or caller-supplied execution authority. |
| `query-terminal-review-candidate` | Query the existing exact terminal whole-WK review candidate status route without changing its read-only authority. |
| `advance-terminal-review-candidate` | Advance the existing exact terminal whole-WK review candidate state through its declared workspace-write route. |

Tools may list more than one `task_id`. A query by task must filter on exact
string match first, then rank the matching tools.

`generate-and-lint` and `lint-repo` treat the canonical
`wiki/work-records/WK-####.json` layer as work-record authority.
Legacy Markdown work pages (`wiki/issues/WK-####.md`) are historical,
searchable, migration-input pages and package source templates under
`packages/wiki-core/templates/**` are package inputs; neither is linted as a
canonical work record. For public field-model and vocabulary guidance, see
[docs/work-record-ontology.md](work-record-ontology.md). The checked-in
work-record validation authority lives in
`packages/wiki-core/src/lib/work-record-schema.mjs`,
`packages/wiki-core/src/lib/work-record-schema-structure.mjs`, and
`packages/wiki-core/src/lib/work-record-schema-constants.mjs`; the portable
contract authority is summarized by `packages/wiki-core/contract/schema.md` and
`packages/wiki-core/contract/manifest.json`.

## Status Model

Discovery must model support without flattening different kinds of absence into
a single `supported` or `unsupported` string.

### `install_state`

`install_state` describes source-tree/package-directory presence in this repo,
not whether a file is included in published npm package files:

- `installed` means a usable runtime or wrapper exists in the repo source tree
  and is exposed through the appropriate runtime route.
- `package_file_only` means the named file is present in the repo's package
  directory or checked-in package source tree, but it is not an installed command
  and is not a supported operator entrypoint. A `package_file_only` row does not
  imply the file is shipped in the published npm package; package manifests and
  descriptor notes provide the concrete package-boundary posture, including
  explicit exclusions from published package files.
- `missing` means the tool is not present in the local repo checkout.

### `runtime_posture`

`runtime_posture` describes how the tool behaves when invoked:

- `supported` means the tool is available and intended for normal use.
- `conditional` means the tool is only available under documented conditions.
- `refusal_only` means the surface exists but intentionally refuses to execute
  the requested action.
- `deactivated` means the surface is historical or intentionally disabled.
- `historical` means the surface is retained for reference only.
- `missing` means no runnable runtime posture exists.

### `recommended_route`

`recommended_route` tells the agent which path to prefer:

- `mcp`
- `cli`
- `descriptor`
- `none`

The three fields are separate on purpose. A tool can be present but
`refusal_only`, or physically present as `package_file_only`, or available only
as a historical reference. Discovery metadata must not collapse those cases.

## Side-Effect And Authority Vocabularies

`side_effects` is an ordered array of controlled values:

- `read_only`
- `workspace_write`
- `record_write`
- `process_spawn`
- `cleanup_runtime_state`
- `destructive`

`authority` is an ordered array of controlled values:

- `checked_in_descriptor`
- `workspace_repo`
- `work_record`
- `launcher_registry`
- `launcher_backend`
- `runtime_env`
- `historical_surface`
- `operator_input`

The vocabulary is intentionally small. It should tell agents what kind of
effect or governing source to expect without encoding implementation details.
