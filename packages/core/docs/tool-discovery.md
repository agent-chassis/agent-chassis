
# Tool Discovery v1
`workspace_initiative_status` is the adopted compact read-only coordinator
action lens for initiative and unit next-action triage. Discovery should
present it as the next-step surface, not as a pre-adoption or replacement path.
Use summary, validate-dispatch, dispatch, run-status, lint, and setter tools
for the underlying operations they own.

`tool-discovery.v1` is the machine-readable contract for telling agents which
agent-chassis command or MCP function should handle a job. It exists so
agents can choose a tool from structured data instead of guessing from wrapper
filenames, package metadata, executable bits, or historical WK pages.

This document is the durable operator contract for the discovery schema. The
canonical checked-in registry is the set of JSON fragments under
`packages/wiki-core/data/tool-discovery/`, assembled at load time into one
`tool-discovery.v1` descriptor (see "Canonical Fragment Registry" below).
Runtime transports must expose the assembled fragment registry without
rewriting support status or inventing policy from prose.

## Canonical Fragment Registry

The canonical checked-in registry is a set of JSON fragments under
`packages/wiki-core/data/tool-discovery/`, assembled at load time into one
`tool-discovery.v1` descriptor. There is no monolithic descriptor file; the
assembled fragment registry is the only canonical tool-discovery data source.

### Fragment Layout

The fragment directory contains a manifest plus one fragment file per tool
family:

- `packages/wiki-core/data/tool-discovery/manifest.json` — names the fragment
  files in canonical order, carries the canonical per-fragment `tool_count`
  values and the `expected_tool_count` corpus total, and is the registry
  identity anchor.
- `packages/wiki-core/data/tool-discovery/mcp-tools.json` — MCP discovery,
  read, validation, search, record evidence, and contract-manifest tools.
- `packages/wiki-core/data/tool-discovery/work-record-tools.json` —
  work-record create/edit/validate/migrate routes across MCP and CLI.
- `packages/wiki-core/data/tool-discovery/code-index-tools.json` — code-index
  and graph-impact tools across MCP and CLI.
- `packages/wiki-core/data/tool-discovery/launcher-tools.json` — dispatch,
  run-status, coordination preflight, and runtime-blocker-taxonomy tools.
- `packages/wiki-core/data/tool-discovery/cli-commands.json` — wiki and
  agent-launch CLI command rows.
- `packages/wiki-core/data/tool-discovery/wrapper-commands.json` — empty
  historical role-wrapper fragment retained for manifest-order stability after
  the family-role wrapper commands were removed from package source.

The manifest is the canonical source for the per-fragment counts and the
corpus total; treat its `tool_count`/`expected_tool_count` values as
authoritative rather than any count repeated in prose. The assembled corpus is
exactly 82 tool entries (21 + 28 + 18 + 5 + 10 + 0 = 82), matching the
manifest order above. Each `tool_name` is owned by exactly one fragment; a
fragment must not repeat a `tool_name` that appears in any sibling fragment.

### Deterministic Fragment Order

Fragment assembly order is fixed by the manifest, not by filesystem read order,
directory listing order, or glob expansion. The canonical order is:

1. `mcp-tools.json`
2. `work-record-tools.json`
3. `code-index-tools.json`
4. `launcher-tools.json`
5. `cli-commands.json`
6. `wrapper-commands.json`

The loader assembles fragments strictly in manifest order so the assembled
descriptor — and therefore its digest — is reproducible across machines and
checkouts. Manifest order fixes assembly and digest determinism; it does not
change query ranking, which remains governed by the
`priority`/`tool_name`/`entrypoint` rules in "Ranking And Query Behavior".

### Duplicate `tool_name` Handling

`tool_name` is unique across the whole assembled corpus. A duplicate
`tool_name` — whether repeated within one fragment or appearing in two
fragments — is a fragment-corpus integrity error, not a last-writer-wins
merge. The loader exposes a validation hook that fails (or emits a
deterministic diagnostic) on a duplicate `tool_name` rather than silently
collapsing or overwriting entries. The same posture applies to invalid
fragment shape, invalid tool entries, and partial-corpus fixture omissions:
these are surfaced as validation failures, not silently tolerated.

### Descriptor Digest Semantics

The descriptor digest is computed over the assembled descriptor — the
fragments combined in manifest order — not over any single fragment file and
not over an arbitrary filesystem read order. Because assembly order is fixed by
the manifest, the same fragment contents always produce the same digest. The
`descriptor.path` field in the discovery envelope identifies the assembled
fragment registry by its manifest
(`packages/wiki-core/data/tool-discovery/manifest.json`), and
`descriptor.digest` is the digest of the assembled corpus. The runtime MCP
envelope reports the same digest as the checked-in fragment registry whenever
the runtime data matches the checked-in fragments; a divergence is a freshness
problem (`descriptor_digest_mismatch`), exactly as for the prior monolithic
descriptor.

### Package Install Expectations

The fragment directory ships as package data with `wiki-core`. A published
install must contain `packages/wiki-core/data/tool-discovery/manifest.json` and
all six fragment files, resolved package-relative — the same install-layout
asset-resolution contract for the relocated `contract/`
tree and the other checked-in descriptors. The loader resolves the manifest
and fragments relative to the installed `wiki-core` package, not the monorepo
working tree, so discovery behaves identically from a published tarball and
from the repo checkout. Explicit `descriptorPath` loading of a single
full-descriptor JSON remains supported only for tests and fixtures (or through
a clearly exposed replacement explicit-load API); it is not the default
runtime data path, and a fixture file named `tool-discovery.v1.json` inside a
test is not a live aggregate dependency.

## Discovery Surfaces

In this repository the wiki-mcp server registers all three discovery routes,
so the preferred discovery entrypoints are:

- MCP `workspace_tools_list`
- MCP `workspace_tools_describe`
- MCP `workspace_tools_query`
- CLI fallback `npm run wiki -- tools-describe [--task <task_id>|--tool <tool_name>] --json`

These three MCP routes are registered and supported on this repo's wiki-mcp
server — registered from `packages/wiki-mcp/src/lib/tool-discovery-tools.mjs`
(extracted from `server.mjs`) — and are not planned or pending. The
checked-in fragment registry already owns the `workspace_tools_list`,
`workspace_tools_describe`, and `workspace_tools_query` entries (in the
`mcp-tools.json` fragment), so the server does not need to inject them through
runtime descriptor augmentation. The runtime MCP envelope therefore reports the
same descriptor digest as the assembled checked-in fragment registry.

A consuming repo must still confirm that its own runtime MCP registry exposes
these routes before treating them as available; this document names the
contract, not another deployment's registration state. Where a route is not
registered in some other deployment, that deployment's checked-in descriptor
and the CLI fallback remain the documented sources of truth for discovery
behavior there.

`workspace_tools_list` is the compact, limit-bounded daily-use catalog scan.
It is the first stop for routine browsing and should return a short, bounded
catalog slice rather than a full descriptor dump.

`workspace_tools_describe` is the targeted detail surface. It is intended for
known tools or narrow sets, and full descriptor fields remain available only
through explicit verbose/detail behavior. Routine browsing should not start
here unless the agent already knows it needs the deeper descriptor shape.

`workspace_tools_query` remains the filtered task/tool lookup for finding
tools by controlled task IDs or exact tool names without broadening into a
catalog scan. It is the narrow lookup path for routine agent discovery when
the caller already has a task ID or exact tool name in hand.

`workspace_search_repo` is a ranked search surface over canonical wiki/docs
content. Its default compact output is bounded by `limit`, but the bound is a
page size, not the total result set: `total_count` reports the complete match
count, while `returned_count` and `result_count` report only the results
returned in the current response. The response also reports `limit`, `offset`,
`has_more`, and `next_offset` so callers can continue from the next ranked
position. When `has_more` is true, request the next page by passing
`offset: next_offset` with the desired `limit`; repeat until `has_more` is
false. Callers that need the entire ranked result set in one response may pass
`unbounded: true`, subject to transport size constraints. Query refinement can
improve relevance or narrow intent, but it is not the completeness mechanism
for ranked search results; completeness comes from offset/continuation paging
or the explicit unbounded retrieval mode.

`workspace_autofix_docs_backlinks` is the explicit opt-in MCP repair route for
`missing_docs_backlink` findings. It is write-capable and docs-only: it may add
missing `<!-- wiki: id=... relation=tracks -->` comments to canonical docs
pages after recomputing fresh lint findings internally and revalidating each
target under the repo docs root. Caller-supplied findings are never write
authority, and optional path/id/comment inputs only narrow the internally
recomputed findings. Ordinary `workspace_lint_repo`, CLI `wiki lint`, and
`workspace_generate_and_lint` remain non-autofixing.

`workspace_code_index_impact_paths` is the decision-oriented graph-impact
query surface. Its default response is compact: it returns bounded summary
data plus a lightweight `graph_impact_summary_ref` so agents can see the
binding/provenance and the relevant input, validated, and invalid path
metadata without carrying a duplicated full summary payload into context.
When a diagnostic trace is needed, `verbose:true` restores the full
graph-impact envelope, including the detailed evidence, debug-oriented
metadata, and compatibility fields needed for troubleshooting. Discovery
text should make that compact/verbose split explicit so routine agents stay
on the bounded path and only opt into the heavier payload when they truly
need it.

Work-record read and summary discovery must make compact WK-level behavior
discoverable for `workspace_get_record`, `workspace_read_page`, and
`workspace_work_record_summary`:

- For tracker WK-level defaults, detailed `done`, `cancelled`, and `parked`
  slice bodies are intentionally omitted. Status counts and slice-detail
  omission metadata are the compact signals for what was suppressed.
- WK-level defaults omit record-level and slice-level `agent_notes` bodies.
  Included slice rows may expose `agent_notes_bytes` so agents can detect note
  presence/size without expanding the note text.
- Targeted selected-slice reads and selected-slice summaries are the recovery
  path for selected slice details and notes. Discovery text should direct
  agents to `selected_slice:<id>` for `workspace_read_page` on canonical
  `wiki/work-records/WK-####.json` paths, or to slice-scoped
  `workspace_work_record_summary` units such as `WK-0001#slice-id`.
- Full/debug opt-ins (`verbose`, `include_record`, `include_raw`, and
  `include_full_summary` where applicable) can expose complete payloads and may
  spill. Discovery must present those as explicit full/debug paths.

Discovery notes must describe omitted closed/parked slice details and omitted
WK-level agent note bodies as intentional default response shaping, not missing
data. They must not route agents to shell commands, raw JSON edits, spill-limit
changes, or storage changes as recovery paths.

`workspace_initiative_status` is the adopted compact read-only coordinator
action lens for an initiative or selected work unit. Discovery should present
it as the next-step surface for coordinator triage, not as a replacement for
work-record summary, dispatch readiness, lint, dispatch, run monitoring, or
work-record setters. Its compact default returns counts, a bounded ranked
action list, truncation metadata, and the next progressive-disclosure step; full
WK summaries, slice bodies, acceptance arrays, validation arrays, docs lists,
closure prose, long diagnostics, and raw evidence are explicit verbose or
selected-action detail only. For actual operations, discovery must route agents
to:

- `workspace_work_record_summary` for full WK or slice context
- `workspace_validate_dispatch` for authoritative dispatch readiness
- `workspace_run_validation` for work-contract-authorized Node test validation
  (`node_test`: `node --check` then `node --test`) without raw shell
- `workspace_agent_dispatch` for MCP-only worker/reviewer/redteam launch
- `workspace_agent_run_status` or `workspace_agent_run_wait` for launched-run
  monitoring
- `workspace_lint_repo` or `workspace_generate_and_lint` for repo diagnostics
- work-record setter routes for status, closure, task, contract, acceptance, or
  slice writes

Initiative status is read-only and advisory: it does not dispatch, write
records, set statuses, run lint, refresh metrics, write graph evidence,
reinterpret policy, or parse closure prose as authority. Discovery must not
describe shell commands, role wrappers, raw work-record JSON edits, spill-limit
changes, or descriptor inspection as recovery paths.
Repo-wide lint is diagnostic unless the selected `WK-*` or slice owns that lint
surface, and runtime/operator blockers such as missing transport, backend
unavailability, read-only mounts, stale graph impact, or monitor-handle
mismatches should be reported with stable blocker codes instead of being
absorbed into WK scope. See [docs/initiative-status.md](initiative-status.md)
for the adopted coordinator workflow guidance.

## CCE Worker-Admission Recovery Projection

When the Chassis Control Engine (CCE) returns a valid `worker_admission.recovery.v1` object,
tool-discovery and launcher-facing guidance must treat that object as the
primary recovery projection for the refusal it accompanies. Portfolio surfaces
may transport, schema-check, summarize, and display those CCE-owned facts, but
they do not authorize launch, satisfy review controls, add accepted authority,
or infer local admission from recovery content.

There are two recovery locations with different meanings:

- Current-decision recovery appears on the ratified worker-admission pack result
  as `pack_result.recovery`. It describes bounded actions for resubmitting the
  same work unit after correcting the current admission decision inputs.
- Route-problem recovery appears on a top-level worker-admission route problem
  response before a `pack_result` exists. It describes bounded actions for
  resubmitting a request that failed at the route/problem layer.

Both forms are advisory and resubmission-only. Agents must correct the request,
evidence, scope, attestation, accepted authority, metrics, or route input named
by CCE, then submit again through the normal CCE-backed admission route. A
recovery action is not itself review evidence, accepted authority, a policy
override, or an admission decision.

The legacy reason-fact recovery classifier remains compatibility-only for
responses that do not carry a valid CCE recovery object. It may explain bounded
known reason facts such as CCE reason codes, controls, scalar threshold facts,
or evidence keys already exposed by the portfolio summary, but it is not a
complete policy projection and must not be used to infer hidden controls,
missing evidence values, route-problem mappings, or local admission.

Malformed, oversized, unknown-version, unknown-field, or projection-mismatched
recovery data fails closed for recovery display. Portfolio should preserve the
underlying non-admit or route-problem refusal, surface the recovery contract
problem at a bounded level, and require resubmission through CCE. Agents must
not repair malformed recovery locally, guess hidden controls, synthesize review
attestations or accepted authorities, bypass CCE, or treat absent recovery as
permission to proceed.

### Worker in-session validation (`node_check` / `node_test`)

A dispatched worker/reviewer/redteam child can validate the code it writes
in-session through `node_check` and `node_test`, exposed as launcher-owned
operations UNDER the child's existing `structured_validation` capability (no new
scoped tool name, and never a raw shell / raw `exec_command` / free argv). The
target comes solely from the unit's declared validation; a path-escape or any
caller-supplied execution authority is refused with a stable code.
This is the worker self-validation runner
(`packages/agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs`), not
a coordinator tool — discovery must not route a worker to a shell or to the
coordinator route to run its own tests.

- `node_check` runs `node --check <target>` — parse-only, it does NOT execute
  the target (zero arbitrary-code-execution).
- `node_test` runs `node --test <target>` ONLY inside the worker's OWN
  bubblewrap confinement: the repo (including `write_scope`) is mounted
  READ-ONLY, `.env` and the `<workspace>/.agent-launch` secret material are
  MASKED off the mount, the spawn is NETWORK-DENIED (`--unshare-net`), the child
  env is a launcher-minted clean allowlist, and captured stdout/stderr plus a
  wall-clock timeout are bounded. A failing run yields a non-green disposition;
  an unrunnable validation records an honest `not_run`, never success.

This worker-confined runner is a DIFFERENT execution context from the
coordinator `workspace_run_validation` route below, which spawns `node` in the
wiki-mcp SERVER process (not a worker confinement). Discovery must keep the two
distinct: a worker runs its own tests through the confined runner; the
coordinator route is for coordinator-owned validation.

The MCP and CLI surfaces must emit equivalent structured envelopes. They may
differ in `interface` and `source_kind`. The intended current values are:

- MCP: `interface = mcp`, `source_kind = runtime_snapshot`
- CLI fallback: `interface = cli`, `source_kind = checked_in_descriptor`

Those transport differences do not change the descriptor content, ranking
rules, or field meanings for equivalent queries against the same registry
state. The transport affects how the envelope is obtained, not which tools are
listed or how they are ordered.

## Omitted Repo Behavior

Repo-scoped discovery should make the omitted-`repo` contract visible rather
than pushing agents toward ad hoc repo-identity carriers. In a repo-attached
session, the structured workspace tools may omit `repo` when the server has a
launcher or workspace alias for the current repo. In that case, discovery
should describe the precedence as:

1. explicit caller `repo`
2. launcher/server-minted local repo alias
3. structured not-in-repo / wrong-session refusal when no local repo context
   is available

Discovery text must not suggest that prompt text, request payload, argv, or
agent-authored environment are valid repo-selection authority for making an
omitted `repo` work.

## Trusted Work-Record Edit Discovery

Discovery queries for routine work-record editing should surface the trusted
MCP routes first:

- `workspace_work_record_set_status` is the agent-safe route for trusted
  record- and slice-level status updates. A transition to `review` or `done`
  attaches an advisory post-write `closeout_lint` summary.
- `workspace_work_record_set_task` is the agent-safe route for trusted
  record- and slice-level task completion.
- `workspace_work_record_set_closure` remains the closure-specific route and
  is separate from the status/task edit family. A successful closure write
  attaches the same advisory `closeout_lint` summary so the response shows
  whether the unit is cleanly closeable or blocked by red repo lint.

When querying `task_id = set-closure`, the ranked discovery result should put
the MCP edit routes ahead of the CLI fallback rows so agents see the
structured path first. The matching CLI commands
`npm run wiki -- work-records set-status --unit <WK-ID|WK-ID#slice> --status <status> --json`
and `npm run wiki -- work-records set-task --unit <WK-ID|WK-ID#slice> (--text <task text> | --index <n>) --json`
remain operator-shell fallback only; they are not agent dispatch transports.
Routine maintenance should stay on the trusted edit commands instead of
dropping into ad hoc WK JSON edits or manual patching.

If neither runtime surface is available, agents may read the checked-in JSON
descriptor directly as a last-resort, read-only descriptor. That mode is for
inspection only. It is not evidence that a tool is installed, supported, or
safe to invoke.

### Schema-Aware Contract/Slice Edit Routes

The following five MCP routes are the agent-safe recommended path for
schema-aware WK contract and slice editing. Discovery queries for structured
WK setup intents should surface these ahead of the CLI fallback rows:

- `workspace_work_record_upsert_slice` — create or update a tracker-local
  slice on a `WK-####`; the `slice.id` field selects the target slice.
- `workspace_work_record_delete_slice` — remove a tracker-local slice by
  slice-scoped `unit` (WK-#####slice-id) or explicit `slice_id`.
- `workspace_work_record_set_list_field` — set one controlled list-valued
  contract field (`read_scope`, `docs`, `repo_paths`, `write_scope`,
  `depends_on`, `related`, `blocks` at record scope; `read_scope`, `docs`,
  `repo_paths`, `write_scope`, `depends_on` at slice scope). `read_scope` is the
  canonical read-first reference list; `docs` is a backward-compatible alias.
- `workspace_work_record_set_acceptance` — set `acceptance.criteria` and/or
  `acceptance.validation` at record or slice scope.
- `workspace_work_record_shape_review_unit` — shape a record or slice into a
  findings-only review contract by setting `work_kind` to `"review"`, forcing
  `write_scope` to `[]`, and pointing `dispatch_intent.intended_agent_role` at
  `"reviewer"`. Agents creating review slices should use this composite route
  rather than assembling the three field edits manually.

All five routes share the same behavioral contract: output is compact by
default (pass `verbose: true` to include the full updated record body, for
debugging only); each validates the prospective result against work-record.v1
before writing and refuses invalid edits with structured diagnostics; each
accepts an optional `expected_source_digest` for stale-source protection
against concurrent edits; and none accept caller-supplied filesystem roots —
they resolve only through configured workspace repository aliases.

The matching CLI commands (`npm run wiki -- work-records upsert-slice`,
`delete-slice`, `set-list-field`, `set-acceptance`, `shape-review-unit`) are
operator-shell fallbacks only. They are not agent dispatch transports when the
MCP surface is available. Agents must use the MCP routes above and report a
`missing_structured_transport` blocker if those routes are unavailable rather
than falling through to the CLI commands.

### Non-Completion Review-Result Evidence Discovery

Discovery entries for a non-completion review-result evidence route must keep
that surface distinct from `workspace_record_review_attestation`. Review
recording is the accepted/no-findings path that may satisfy review pressure;
review-result evidence is coordination-only evidence for trusted reviewer or
redteam non-completion states.

The supported evidence described by discovery is limited to:

- trusted reviewer/redteam `changes_requested` role-result evidence from valid
  structured role-result data; and
- structured missing-result or runtime-failure evidence from dispatch/run
  metadata.

Discovery wording must not claim support for trusted reviewer/redteam `blocked`
or `failed` role-result outcomes until a separate launcher/core vocabulary WK
adds that seam. It also must not suggest that non-completion review-result
evidence can satisfy mandatory review, make dispatch available, write
`accepted_authorities[]`, set status, or replace accepted/no-findings recorded
review. If a route is not registered in a given runtime, discovery must
report it as missing or unavailable rather than routing agents to shell, raw JSON
edits, copied prose, or caller-supplied outcome strings.

## Registered-Tier Exposure And Projection

The system ships as two products over one codebase (see
[docs/enforcement-model.md](enforcement-model.md), `decision`, `decision`,
`decision`): a source-available free/local product and the Chassis Control Engine (CCE) tier. Tool discovery is a **tier projection**, not a single global
corpus shown to every registration. The checked-in descriptor corpus may carry
full metadata and per-tier prose, but `workspace_tools_list` /
`workspace_tools_describe` / `workspace_tools_query`, the agent FAQ, live MCP tool
descriptions, and mixed-route default responses render only the tool information
relevant to the **resolved registered tier**.

### Registered tiers

Each entry declares a `tier_visibility` array over the controlled vocabulary:

- `free_local` — visible to a free/local no-key registration (and, by superset, to
  a CCE registration).
- `paid_cce` — visible only to a registration whose CCE-key posture is positively
  resolved.
- `operator_only` — surfaced only to an operator-tier caller; CLI fallback rows and
  operator entrypoints carry this so they are never agent-visible free escape
  hatches for CCE MCP surfaces.

Exposure composes as a fail-closed superset: a free/local registration sees
`free_local` entries; a CCE registration sees `free_local` plus `paid_cce`
entries. An entry with missing or unknown tier metadata is visible to **no** tier —
missing classification fails closed rather than defaulting to free/agent-visible.
A tool is exposed only when **both** the selected role profile (`full`,
`agent-safe`, `worker`) and the resolved tier allow it; role profile alone is never
authority to expose a CCE surface or CCE explanation. `tier_visibility` composes
with, and does not replace, `audience`, `recommended_route`, `runtime_posture`, and
`side_effects`.

### Tier resolution is canonical, never caller-asserted

The runtime registered tier is resolved from the canonical CCE/Node Engine
key/no-key posture described by [docs/enforcement-model.md](enforcement-model.md),
`decision`, `decision`, and `decision` — a positively-resolved CCE key
selects the CCE tier; its absence, an unreadable config, or any uncertainty
fails closed to free/local. The tier is **never** derived from caller-supplied
request data, prompt text, argv, ambient child env, claimed identity, or ad hoc
local inference. Uncertainty or an invalid CCE-key posture must not expose
CCE-only tools or CCE-only explanatory text.

### Free/local messaging boundary (decision / decision)

`decision` and `decision` are load-bearing for messaging. A free/local
confirmed-no-Node-Engine posture renders **no local admissibility judgment**: it
may expose structural runnability and containment guidance, but local LOC, cluster,
blast-radius, target-resolution, and threshold analysis must **not** be presented
as free-tier guidance, advisory policy, recovery detail, or agent-usable tooling.
There is no local "advisory" admissibility code. Free/local discovery, FAQ, and
default output must not name CCE metric/leverage concepts or route agents to
CCE-only tools as ordinary remediation.

### CCE projection

CCE registrations may expose the CCE leverage and authorization surfaces:
worker-admission carrier facts, Node-Engine-returned verdicts / reason codes /
remediation, review evidence, attestation, CCE admission diagnostics and recovery,
worker-admission LOC / admission-metrics / target-resolution refresh,
graph-impact / blast-radius / multicluster code-index queries, and graph-impact
evidence persistence. CCE messaging must **distinguish raw measured carrier facts
from Node-Engine-returned admissibility judgments** and must not imply the local
layer renders its own threshold verdict under `decision`.

### Per-tier prose (`tier_text`)

A mixed route that is visible to both tiers carries a free/local-safe base body and
an optional `tier_text.paid_cce` override. Projection strips the internal
`tier_text` container from output, applies the resolved tier's override, and — for
an unknown/absent tier or a missing CCE override — degrades to the free/local base
rather than falling through to CCE text.

### Free vs CCE boundary examples

- Free/local coordination substrate stays visible: canonical wiki/docs
  read/search/discovery, work-record create/edit/validate/summary, lint/generate,
  structured dispatch and run monitoring, and declared validation routes that do
  not mint CCE authority or teach CCE-only analysis.
- CCE-only (or operator-only): `workspace_record_review_attestation`,
  `workspace_record_review_result_evidence`, `workspace_node_engine_admission_runtime_diagnostic`,
  worker-admission LOC/admission-metrics and target-resolution refresh, the
  code-index / graph-impact query family, and graph-impact evidence persistence.
- `workspace_validate_dispatch` and `workspace_agent_dispatch` remain free/local for
  basic dispatch-readiness and launch flow, but their free/local discovery and
  default output must not expose CCE LOC/threshold/blast-radius/multicluster,
  CCE-recovery, structural-admissibility, or structured review-artifact detail.

### `agent-safe` / `agent-authoritative` are not tier labels

`agent-safe` and `agent-authoritative` describe structured-route/profile posture,
not product-tier availability. They may be used only when clearly qualified;
registered-tier metadata remains the sole authority for free/local versus CCE
exposure. Do not read either label as a free-tier availability signal.

### Terminology disambiguation

Response-shape language such as the code-index compact/degraded/verbose contract is
about payload size, not availability. It is **not** a product tier: do not confuse
a "three response-shape mode" contract with `free_local` / `paid_cce` /
`operator_only` tool exposure.

### Free-tier run monitoring under decision

In the free/local tier, `workspace_agent_run_wait` and `workspace_agent_run_status`
can report terminal success while `structured_role_result.valid:false`, because
`decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting.
That value is expected, non-attesting state — not a failed child run, a failed
dispatch, or missing findings. A schema-valid structured role result is a CCE
capability enabled only by a configured CCE key.

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
| `tier_visibility` | yes | Controlled registered-tier exposure vocabulary (`free_local`, `paid_cce`, `operator_only`). See "Registered-Tier Exposure And Projection". |
| `tier_text` | no | Optional per-tier prose overrides (`notes`/`summary`) keyed by registered tier; the base body is the free/local-safe common text and CCE detail lives only under `tier_text.paid_cce`. |
| `docs_refs` | yes | Durable docs that explain the tool or contract. |
| `source_files` | yes | Repo-relative files that define or verify the tool. |
| `notes` | no | Optional extra guidance that does not change status. |

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
stable across transports and consuming repos.

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
| `record-review-attestation` | Record bounded recorded-review evidence for a work record or slice after a trusted reviewer or redteam run. |
| `record-review-result-evidence` | Record coordination-only non-completion review-result evidence for trusted reviewer or redteam runs. |
| `generate-and-lint` | Regenerate wiki views and lint the repository against the shared contract. Optional `max_findings` (omit for the bounded compact default, `0` for counts only, or a positive integer with no hard upper bound) controls how many lint findings the response returns. |
| `lint-repo` | Validate a repository against the shared wiki contract (read-only). Optional `max_findings` (omit for the bounded compact default, `0` for counts only, or a positive integer with no hard upper bound) controls how many lint findings the response returns; responses carry `finding_count_total`/`findings_returned`/`findings_truncated`/`max_findings`. |
| `validate-docs-policy` | Validate agent-facing docs for non-MCP role-dispatch drift with audience-scoped operator/internal sections. |
| `summarize-work-record` | Return a compact work-record summary view (dependencies, write_scope, acceptance, slices, validation, owners, review state, blockers). Tracker WK-level defaults intentionally omit detailed `done`, `cancelled`, and `parked` slice bodies and WK-level agent note bodies; selected-slice summaries and explicit full/debug opt-ins recover selected or complete detail. |
| `summarize-initiative-status` | Adopted compact read-only coordinator action lens for initiative or selected-unit triage. Use it to identify the next durable coordinator action, then route actual operations to the owning structured tools (`workspace_work_record_summary`, `workspace_validate_dispatch`, `workspace_agent_dispatch`, `workspace_agent_run_status`, `workspace_lint_repo`, and the work-record setter routes). |
| `coordination-preflight` | Compose the coordinator/orchestrator preflight envelope (role, write surfaces, repo/docs/wiki writability, structured routes, runtime blockers). |
| `describe-runtime-blocker-taxonomy` | Read the schema-backed runtime blocker taxonomy (codes, categories, graph-impact degraded-state mapping, bootstrap subset). |
| `contract-edit` | Edit the pre-dispatch contract of a work record: upsert or delete tracker-local slices, set list-valued contract fields, set acceptance criteria and validation, or shape a unit into a findings-only review unit. |
| `run-validation` | Run declared Node test validation (`node --check` then `node --test`) for an implementation unit's work-contract-authorized target, with `process_spawn` side effect and no raw shell or caller-supplied execution authority. |

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

## Ranking And Query Behavior

Query results must be deterministic.

For a `task_id` query:

1. Match the requested `task_id` exactly.
2. Rank by curated `priority` integer, with higher numbers first.
3. Break ties alphabetically by `tool_name`.
4. If still tied, break ties by `entrypoint`.

For a `tool_name` query:

1. Match the requested `tool_name` exactly.
2. Rank by curated `priority` integer, with higher numbers first.
3. Break ties alphabetically by `tool_name`.
4. If still tied, break ties by `entrypoint`.

The envelope should also include a 1-based `rank` field in each result when the
response is queryable, so callers can see the chosen ordering without
recomputing it.

## Diagnostics

Diagnostics are deterministic machine-readable records that explain why an
entry is missing, degraded, stale, historical, or route-limited.

Recommended diagnostic shape:

```json
{
  "code": "descriptor_digest_mismatch",
  "level": "degraded",
  "message": "Runtime descriptor digest does not match the checked-in JSON.",
  "paths": ["packages/wiki-core/data/tool-discovery/manifest.json"],
  "task_ids": ["inspect-provenance"]
}
```

Diagnostics should be ordered by:

1. `level`
2. `code`
3. `paths[0]`

The code values must be stable. The message text should be concise and
actionable, but it does not need to be a verbatim user-facing sentence.

## Dispatch Identity And Bootstrap States

`workspace_agent_dispatch_identity_contract` is the read-only MCP
introspection surface for dispatch identity and bootstrap review. Agents route
worker/reviewer/redteam dispatch through `workspace_agent_dispatch`, treat
wrapper_command rows as operator-facing inventory, and use the stable bootstrap
states `bootstrap_exception_active`, `bootstrap_review_missing`,
`bootstrap_exception_consumed`, and `graph_impact_persistence_unavailable`.
See
[Dispatch Identity And Bootstrap States](tool-discovery-dispatch-runtime.md#dispatch-identity-and-bootstrap-states)
for the detailed identity, audience, registration, backend, and lifecycle
contract.

## Runtime Blocker Taxonomy And Coordination Preflight

`workspace_runtime_blocker_taxonomy` exposes the schema-backed code set in
`packages/wiki-core/data/runtime-blocker-codes.v1.json` for orchestrator
preflight, dispatch readiness, and launcher diagnostics. The canonical
taxonomy categories are `role_policy`, `caller_identity`,
`work_record_readiness`, `transport`, `backend`, `filesystem`, `validation`,
`route`, `review_transport`, `bootstrap`, `graph_impact`,
`graph_impact_persistence`, and `operator_recovery`.
`workspace_coordination_preflight` composes the coordinator preflight envelope
against those codes. See
[Runtime Blocker Taxonomy And Coordination Preflight](tool-discovery-dispatch-runtime.md#runtime-blocker-taxonomy-and-coordination-preflight)
for the detailed taxonomy and preflight contract.

## Representative Coverage

The checked-in descriptor should cover at least one representative tool in each
of these categories:

- wiki search, read, and create
- work-record edit routes for status, task, and closure; validate, migrate, and refresh
- dispatch readiness
- graph impact and code index
- worker, reviewer, and redteam dispatch
- orchestrator start, resume, and list
- diagnostics, provenance, and cleanup
- deactivated and historical blackboard surfaces

That coverage is about discoverability, not support promotion. A historical or
refusal-only surface is still useful if the descriptor says so clearly.

## Cross-Repo Adoption

This schema is local to this repository, but the pattern is reusable.

A consuming repo may either:

- ship its own `tool-discovery.v1` descriptor and compatible discovery
  surface, or
- explicitly replace the command names and MCP methods in its own `AGENTS.md`
  while keeping the same schema contract

If a consuming repo replaces the names, it must say so explicitly. Agents must
not infer support from wrapper files, package metadata, or historical records.

## What This Document Does Not Do

This document does not:

- change tool behavior
- promote unsupported surfaces to supported ones
- define launcher policy
- replace repo-local `AGENTS.md` instructions
- make a checked-in descriptor authoritative for runtime execution

It only defines how discovery should be described, surfaced, and compared.
