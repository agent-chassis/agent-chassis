# Tool Discovery Surfaces

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for the discovery entrypoints and the
per-surface projection guidance they carry: the MCP startup advertisement, the
two MCP discovery routes and the CLI fallback, the CCE worker-admission recovery
projection, omitted-`repo` behavior, and trusted work-record edit discovery.
Prose on every surface follows
the [Discovery Prose Boundary](tool-discovery-schema.md#discovery-prose-boundary).

## Discovery Surfaces

In this repository the wiki-mcp server registers both discovery routes, so the
preferred discovery entrypoints are:

- MCP `workspace_tools_list`
- MCP `workspace_tools_describe`
- CLI fallback `npm run wiki -- tools-describe [--task <task_id>|--tool <tool_name>] --json`

These two MCP routes are registered and supported on this repo's wiki-mcp
server — registered from `packages/wiki-mcp/src/lib/tool-discovery-tools.mjs`
(extracted from `server.mjs`) — and are not planned or pending. The
checked-in fragment registry already owns the `workspace_tools_list` and
`workspace_tools_describe` entries (in the `mcp-tools.json` fragment), so the server does not need to inject them through
runtime descriptor augmentation. The runtime MCP envelope therefore reports the
same descriptor digest as the assembled checked-in fragment registry.

A consuming repo must still confirm that its own runtime MCP registry exposes
these routes before treating them as available; this document names the
contract, not another deployment's registration state. Where a route is not
registered in some other deployment, that deployment's checked-in descriptor
and the CLI fallback remain the documented sources of truth for discovery
behavior there.

`workspace_tools_list` is the hard-bounded daily-use catalog scan. Its default
rows contain only `tool_name` and `task_ids`, which are sufficient to
select a targeted lookup without repeating entrypoints, prose, posture, tier,
or descriptor detail. Rows follow the one ordering rule in
[Tool Discovery](tool-discovery.md#ranking-and-query-behavior), and complete
pagination remains guaranteed. Rank is available through targeted detailed
discovery with
`workspace_tools_describe({tool_name, verbose:true})`; ordinary list rows omit
it. Both its pretty-printed structured payload and its complete serialized MCP
result stay within 4,096 UTF-8 bytes. The two ceilings
are separate: a 3,840-byte structured-payload ceiling (`byte_limit`) keeps the
payload alone from consuming the whole frame, and the 4,096-byte
complete-result ceiling (`result_byte_limit`) bounds what the transport
actually emits — both response channels, the JSON-string escaping the text
channel pays, and the MCP frame keys. The complete-result ceiling is normally
the binding one, so a bounded structured payload is not on its own evidence
that a response fits.

Count and byte bounds are independent. `total_count` is the exact complete
role- and tier-visible count before either bound; `returned_count` is the exact
row count in this response; and `truncated_count` is the number of rows this
response does not reach, counted in the same frame as the resume cursor
(`total_count - (offset + returned_count)`, floored at zero). At `offset` 0 that
is the difference between the two counts; on a later page it excludes the rows
the caller has already paged past, so a final page that withheld nothing reports
zero.
`limit_applied`, `byte_limit`, and `result_byte_limit` report the active
ceilings, while `count_truncated`, `byte_truncated`, and `truncated` report
which bound removed rows. Returned rows preserve the complete role- and
tier-visible ordering without skipping eligible rows. Increasing
caller `limit` never relaxes either byte ceiling. Every page reports
`source_digest`, and a page with rows remaining carries exactly one
`next_calls` entry: the concrete `workspace_tools_list` call for the next page,
with the same filters, the effective `limit`, `offset: next_offset`, and
`expected_source_digest`.

The completeness mechanism is continuation paging, in the same vocabulary
`workspace_search_repo` uses: `offset` echoes the zero-based cursor this
response was served at, `has_more` reports whether any role-visible row remains
after it, and `next_offset` is the position to resume from (`null` when nothing
remains). Continue by following that call (equivalently, repeating the request
with `offset: next_offset`, `expected_source_digest`, and the same filters) until
`has_more` is false; the union of the returned rows is then the
complete role- and tier-visible set. `next_offset` resumes immediately after the
last row the response actually carried, so a page cut short by a byte ceiling
resumes at the first row it dropped rather than skipping the remainder of the
count window. Consecutive pages preserve that ordering without gaps or
duplicates; they do not return a rank field. `offset` is a paging input only: it
selects which page of the already role- and tier-scoped ranking is returned, is applied
after scoping and before both bounds, and can no more widen visibility or relax
a byte ceiling than `limit` can. An `offset` past the end returns no rows with
`has_more` false rather than an endless cursor.

List traversal is live and version-checked, with no cursor store or time expiry.
`source_digest` binds the normalized `task_id`/`tool_name` selector, the
augmented descriptor identity, and the ordered role- and tier-scoped rows. It
excludes timestamps, process identity, `offset`, and page size, so an unchanged
source survives a server restart. A supplied `expected_source_digest` is checked
even at offset 0. A nonzero `offset` without one refuses with
`tool_discovery_list_source_digest_required`; a digest that no longer names the
current source refuses with `tool_discovery_list_source_changed`. Both refusals
state `authority_limb:"mechanical_failure"`, return no rows, report
`current_source_digest`, and carry one callable `workspace_tools_list` restart
at offset 0 that preserves the normalized filter and effective limit and binds
the current digest. Every emitted next-page and restart call is checked against
the registered list request schema.

The exact losslessness enforcement is
`tests/unit/tool-discovery-projection-bounds.test.mjs`, test
`work record: following next_offset enumerates the complete catalog exactly once`.
The registered-route proof is `work record: the registered workspace_tools_list
route pages on a non-zero offset` in that same file. Together they prove exact
`total_count`, `returned_count`, and `truncated_count` semantics plus complete
cursor recovery under count and byte bounds. They also prove that a caller
limit cannot relax the server bound.

When the descriptor is degraded, the envelope's `diagnostics` can be large
enough to crowd the catalog out of the budget. Descriptor health is not
selection detail, so on that path the list sheds `diagnostics` for a
`diagnostics_omitted` count and returns rows instead of refusing; the full
diagnostics remain on the describe surface. A healthy catalog never
takes that path and its response is unaffected.

`packages/wiki-core/src/lib/tool-discovery/projection.mjs` is the sole owner of
the row projection, both ceilings, and the admission decision;
`packages/wiki-core/src/lib/tool-discovery.mjs` is a re-export barrel over it.
A transport adapter — `packages/wiki-mcp/src/lib/tool-discovery-tools.mjs` for
the MCP surface — contributes measurement only: it injects a callback that
reports what its own shaper (`packages/wiki-mcp/src/lib/mcp-response.mjs`)
costs for a candidate envelope, and wiki-core decides how many rows that leaves
room for. Adapters do not restate a ceiling, re-slice rows, or recompute
truncation metadata.

Role and registered tier are launcher-minted visibility inputs. The complete
visibility decision additionally composes the canonical role-access policy,
descriptor tier visibility, install/runtime posture, and actual registration.
`audience` is descriptive only. `workspace_tools_list` accepts exactly
`task_id`, `tool_name`, a
positive integer `limit`, a non-negative integer `offset`, and a string
`expected_source_digest` from the caller;
every other request field is ignored,
so no request can restate the session role, re-open the tier gate, raise a byte
ceiling, or otherwise widen the authorized role-visible projection. An
unresolvable role sees nothing rather than the full surface.

`workspace_tools_describe` is the targeted detail surface. It is intended for
known tools or narrow sets, and full descriptor fields remain available only
through explicit verbose/detail behavior. Routine browsing should not start
here unless the agent already knows it needs the deeper descriptor shape. A
named compact tool's verbose description returns its complete structural input
contract with an authoring-guidance locator, whose call selects the registered
overview, rather than the guidance body. `input_contract` `kind:"guidance"`
returns the complete selected guidance value in one call, without paging. An
omitted path selects the overview, which names the members a caller can select
one at a time, so neither the complete guidance root (`path: []`) nor the
verbose contract is a prerequisite for reading one accepted-value member. It
requires one exact `tool_name` and cannot combine with `task_id`, top-level
`limit`, or `verbose:true`; the published selector states this, and a
conflicting request is refused with the same selection as its recommended
correction. The editor alternatives `kind:"field"` and `kind:"fields"`
carry the same rule and the same correction: a selector addressed to another
tool, to no tool, alongside a `task_id`, or alongside describe's top-level
`limit` is refused by the editor selector's own owner with
`editor_input_contract_tool_unsupported`,
`editor_input_contract_exact_tool_required`, or
`editor_input_contract_limit_conflict`, and the refusal carries the one
describe call that re-addresses the caller's own selection to
`workspace_work_record_edit`. That correction is emitted only where the session
role can already see the editor. Initial declarations also carry the selection rules their owners
enforce, as in these examples:
- the readers' Markdown-only `include_body` and its alternatives;
- the separate top-level and `member` source-digest modes;
- the requirement upsert's combined `requirements` and `retire_claim_ids`
  population.

The selector contract is described in
[Tool Discovery](tool-discovery.md#ranking-and-query-behavior). A refused
compact-route request names each failed field and the exact guidance member its
owner declares, with the owner's reason code and authority limb unchanged; the
same section describes that recovery shape.

A caller with a known task ID pages `workspace_tools_list` filtered by
`task_id` and then describes the selected tool. A caller with an exact tool name
calls `workspace_tools_describe` directly; no preliminary list call is needed.
`task_id` and `tool_name` are alternative selectors, and a request naming both
is refused.

`tool_name` is the bare registered name, exactly as the registry declares it. A
host harness may present the same tool to its model under a namespaced alias
such as `mcp__<server>__<tool>`; that alias is not a discovery name and is never
accepted, aliased, or parsed as a fallback. A targeted describe whose
`tool_name` matches nothing still answers with an empty `results` array, which
is the truthful answer for an unregistered or role-invisible name. Where the
requested name is such an alias and its bare tail IS visible to this session,
the same response additionally carries an `unregistered_tool_name` mechanical
diagnostic naming `requested_tool_name` and `supported_tool_name`, plus the one
describe call that answers the original question. A name with no visible bare
tail adds neither, so no hidden tool is disclosed.

The agent FAQ has no MCP tool. Agents follow the status, refusal, and supported
next call returned by the originating structured operation and use discovery
for the routes it names. The operator CLI command
`npm run wiki -- agent-faq --json`, with `--id <entry-id>` or
`--related-code <code>`, reads the corpus for operator inspection. The FAQ is
advisory and read-only: it does not dispatch roles, decide readiness, satisfy
review controls, change launcher policy, or authorize any runtime behavior.

`workspace_search_repo` is a ranked search surface over canonical wiki/docs
content. The default page is 8 results and the maximum is 50. `total_count` is
the exact complete match count; `returned_count` and `has_more` describe the
current page. Complete traversal uses only the `next_calls` continuation
returned by the backend, and every page frame fits the compact complete-frame
class. A continuation rejects replacement query or scope fields. Public offset arithmetic, unbounded/bulk output, `verbose`,
`result_count`, and search-side `reindex` are absent. Each hit includes a callable
`workspace_read_page` selection for exact original context, and a separate
source-start selection only when it differs from that call. Search remains read-only and discloses the unavoidable
warm-query corpus-byte hashing cost in its diagnostics.

`workspace_autofix_docs_backlinks` is the explicit opt-in MCP repair route for
`missing_docs_backlink` findings. It is write-capable and docs-only: it may add
missing `<!-- wiki: id=... relation=tracks -->` comments to canonical docs
pages after recomputing fresh lint findings internally and revalidating each
target under the repo docs root. Caller-supplied findings are never write
authority, and optional path/id/comment inputs only narrow the internally
recomputed findings. Ordinary `workspace_lint_repo`, CLI `wiki lint`, and
`workspace_generate_and_lint` remain non-autofixing.

Closeout is one call. `workspace_work_record_set_closure` and a closeout status
transition run the generated-view and lint checks that transition requires within
the same request, through `generateAndLint` as the sole executor, and report what
it actually returned: a failing lint as failing, an unavailable executor as not
run with its own cause, and neither as a rollback of the completed write.
Discovery publishes that no follow-up generate/lint chore is returned after a
check ran. It also publishes the closure route's explicit optional
`status: "done"`, which composes the authored closure patch and the final
transition into one validated canonical write; omitted, the same route records
closure and changes no status. A closeout whose findings exceed its bounded
answer retains its receipt once and names `workspace_work_record_summary` with
the unit and `receipt` as the read of its findings; lint results carry
`lint_scope: "repository"`. See
[MCP Operation Reference](mcp-operation-reference.md#one-call-closeout-with-forge-owned-completion-and-truthful-check-results).

Forge publication is review-independent. `workspace_wk_forge_handoff`
publishes one squash candidate whose tree is the selected integrated WK tip's and
whose sole parent is the fixed authenticated fork, and it publishes those bytes
unchanged with no terminal-review unit, review evidence or reviewer context as an
input. Discovery states that publication requires the squashed candidate worktree
bound to that exact candidate, that candidate, topology, worktree and generation
authentication always run, that a candidate-resolution failure keeps its own
cause, and that publication neither merges nor completes the WK. The
destination is local, plain Git delivery or hosted publication by repository
configuration, and the read-only `workspace_wk_landing_status` reports the
resulting human landing. See
[MCP Operation Reference](mcp-operation-reference.md#common-fixed-fork-squash-candidate-independent-review-and-exact-forge-lifecycle).

Managed run observation carries recorded explicit proof verification. For a
managed worker slice, `workspace_agent_run_status` reports `proof_verification`:
the attempt's recorded `workspace_verify_proof` calls, with exact counts and a
callable `detail: {kind:"proof_verification"}` read. Discovery publishes three
facts about it:

- `none_recorded` is not a pass;
- an `invocation_id` detail reads one recorded result's outcome, and adding
  `proof_subject` reads one proof's recorded error, location and call trace;
- observation never executes proofs and grants no integration, review or
  lifecycle permission.

A `workspace_verify_proof` answer names the exact read of each returned failed
proof in its `next_calls`: for a standalone call, the same tool with the
answer's `result` locator and the proof as subject, which reads the settled
result and executes nothing.

See
[MCP Operation Reference](mcp-operation-reference.md#recorded-managed-worker-proof-verification).

Starting work has one entrypoint, `workspace_agent_dispatch`. Its `role` is
optional: omitted, the dispatch target is derived from the canonical unit's
declared `dispatch_intent`, and the task, scope, acceptance, validation, material
and runtime are resolved by the system from that unit and authenticated launcher
facts. Discovery publishes that caller-authored prompt, request, argv and env are
refused, and that readiness is performed internally by its existing owner while
`workspace_validate_dispatch` remains the explicit readiness question. See
[MCP Operation Reference](mcp-operation-reference.md#canonical-slice-start-and-existing-readiness-orchestration).

Selected canonical reading has one ordinary entrypoint,
`workspace_read_page`. It addresses a page by repo-relative `path`, a canonical
record by `id`, or a record and its slice by `unit`, and delegates one exact
entry through `entry:{...}` and one retained spill through
`content_reference:{...}`. Discovery publishes that exactly one of `path`, `id`
and `unit` selects a read, so a caller addresses canonical content by the
identity it already holds instead of reconstructing a storage path, and every
emitted call repeats the identity form the caller used. The dedicated entry and
content-reference routes remain registered with their own contracts and grants;
see
[MCP Operation Reference](mcp-operation-reference.md#ordinary-selected-canonical-reads-and-authoring-continuity).

Ordinary code questions have one entrypoint, `workspace_code_index_impact`, with
automatic index preparation. Its documented selectors choose the answer: exactly
one of `paths`, `patchText`, `diffRecords` or `liveGit:true` asks combined path
context and structural impact, narrowed by a compatible `path` or `symbol`;
`symbol`, or `path` with `line` and optional `character`, asks the definition,
reference, caller and callee owners, narrowed by `relationship`; `path` alone asks that
file's context. Discovery publishes that precedence so a caller picks the
information it wants rather than an engine, and a conflicting or empty selection
returns the reachable alternatives. See the owning
[automatic preparation contract](mcp-repository-model.md#automatic-index-preparation)
and the full rules in
[MCP Operation Reference](mcp-operation-reference.md#ordinary-code-question-selectors-grounding-and-complete-retrieval).
Impact discovery discloses the possible ignored-cache writes and typed
preparation failures; it does not label automatic preparation as strictly
read-only or require a separate build call. The dedicated
`workspace_code_index_context_for_path` and the four navigation routes remain
registered with identical role, disposition, audience and tier classification,
so the consolidation moves no entitlement.

Its default response is compact: one complete frame within the compact class
with exact totals, a truthful `impact_state`, bounded leading rows, the retained
answer's opaque `selected_detail.source`, and a top-level `next_calls` entry
selecting its first affected file. `detail` selects one collection of that
retained answer by `selector.id`, `path`, `symbol` or `relationship` without
evaluating the question again. For a selected affected file, `input_path`
selects its relationships; `lines` selects absolute source lines within one
retained region or file, and `candidates` exposes ambiguity by symbol and path.
No cursor, byte range or field path exists. The file
context and four navigation routes answer the same way, and none of the six has
a verbose or `full_result` form. Discovery text makes that compact-then-detail
split explicit so routine agents stay on the bounded path and recover omitted
detail from the retained answer.

`workspace_code_index_context_for_path` defaults to one complete frame within
the same compact class. It carries the committed identity, the source's
identity, state, and line count, the scalar graph and SCIP state (arrays become
their exact counts), and the dirty-state and overlay trust facts. `graph_paths`
lists affected paths with a code-graph path relationship, one row per path with
its distinct `kinds` and `path_relationship_count`, admitted in path order while
the complete frame fits. `counts.graph_paths.total` and
`path_relationship_total` count the whole population; they are path
relationships aggregated from graph impacts, not symbol references or raw graph
edges. Default kinds are `reverse_import` (imports the path directly or
transitively), `covering_test`, `downstream_cli_command`, `downstream_mcp_tool`,
and `schema_field_contract`. Source text, snapshots, canonical references,
inferred related code and tests, `docs_contract` and `work_scope_owner`
relationships, impact explanations, and update hints are omitted by default.
The complete original answer is retained once as the route's selected-response
source, and `next_calls` selects its first affected file by path.

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
- These ordinary routes have no whole-record, full-summary, raw, or verbose
  mode. `verbose`, `include_record`, `include_raw`, `include_full_summary`,
  `accept_full_read`, and `compact_read_token` are refused as unknown
  arguments. Discovery presents only selected recovery: selected slices,
  ordinary fields, entries and versions, and `member:{path}` pages of one
  canonical WK, slice, IN, or DEC member pinned to `source_digest`.
- `workspace_work_record_summary` publishes two advisory terminal-review facts,
  and discovery must make both findable from the default WK-level read rather
  than only from a selected-slice call. Every emitted findings row — in `slices`,
  in `review_state.review_slices`, and in selected findings-unit summaries,
  compact and full alike — carries the effective `review_purpose` drawn from the
  closed set `standalone` and `terminal_whole_wk`, with `terminal_whole_wk`
  reviewer-only. An omitted purpose normalizes to `standalone` for `review` work
  only. A `redteam` row shows an explicitly authored `standalone` and carries no
  key when the unit authored none; implementation and other non-findings rows
  carry no such key either. [Work-record schema](work-record-schema.md) is the
  durable public contract for that vocabulary, and discovery text must not
  restate it in a form that contradicts it.
  Record-level output carries `terminal_review_designation` with a `state` of
  `missing`, `designated`, `ambiguous`, or `not_applicable`, the exact
  `eligible_count`, and `unit_id` only when exactly one unit is eligible.
  `not_applicable` is what a closed parent record, or one carrying no
  implementation work, returns.
- Discovery text for those two fields must state their boundary as plainly as it
  states their content: they are advisory, descriptive, fact-only observations
  of the authored record. They remain inside the advisory consumer boundary
  owned by controlled claim `claim-designation-no-consumers` in
  `wiki/contracts/work record.controlled-acceptance.json`, which is the single
  enumeration of the consumers they must not reach — discovery must not keep a
  second one. Discovery must not present either field as granting or withholding
  blocker, next-action, dispatch, admission, integration, terminal-candidate,
  handoff, or recovery authority, and must not present the designation as a
  refusal ground.

### Startup Advertisement

The wiki-mcp server also publishes one short notice through the standard MCP
`initialize` result's `instructions` field. The text is owned once, as
`WIKI_MCP_SERVER_INSTRUCTIONS` in `packages/wiki-mcp/src/server.mjs`, and is
identical for every role and tier. Its first 512 characters carry the selection
order: call a known registered operation directly; when the next operation is
unclear and `workspace_tool_router_recommend` is exposed, call it with the task
and known identifiers and follow its `next_calls`; use `workspace_tools_list`
for compact capability discovery and `workspace_tools_describe` for one
selected tool's detail. The remainder states that a full input schema is needed
only for the operation being called, that the session's actual exposed names
are the ones to use, and that app or plugin catalogs and MCP resource lists are
not repository tool discovery.

The notice names bare registered operations only. It adds no alias, prefix
convention, catalog, or schema, and it does not register, expose, or authorize
anything: tool visibility remains decided by role and tier registration, so a
named entrypoint absent from a session's `tools/list` is that session's access
limitation, not evidence about another deployment. Hosts own callable-name
qualification, deferred schema loading, and whether and how the notice reaches
the model. A client receives a changed notice only from a new `initialize`
exchange, so an existing session must reconnect after a package update.

## Input Schema Identity And Lossless Projection

The controlled-contract proof-authoring registrations derive their Zod request
validators from the authored JSON Schema declarations. For the compact upsert
route only, that conversion preserves repeated source-object identity within one
root conversion and its exact `$defs` environment. Completed conversions and
matching whole optional wrappers may be reused during that conversion; caches do
not cross roots, tools, or definition environments, and recursive authored
schemas are refused explicitly. Query, remove, and proof validation deliberately
retain fresh conversion identities so their always-served `tools/list` schemas
remain directly readable inline.

Verbose `workspace_tools_describe` projects every occurrence at its actual path
and depth before considering reuse. A subtree with any unprojected constraint or
depth omission stays inline, preserving both its node-local disclosure and every
global path/reason entry. Complete occurrences share a whole-node
`#/$defs/<name>` reference when they have the same schema identity and depth.
In the served verbose contract, which always carries its `$defs`, distinct
instances that project to byte-identical complete contracts also share one
definition: identical projected JSON validates the same values, and a single
differing byte, such as a bound or a description, keeps two occurrences
separate. A projection published without its `$defs` never uses this sharing. Definitions
retain wrapper semantics, constraints, descriptions, defaults, and declared
refinements; reference objects have no sibling keywords, and a definition that
no reference reaches is removed.

Hoisting remains owned by the request-contract projector. It keeps the 96-byte
minimum, existing deterministic naming and collision behavior, then compares the
complete encoded candidate—including the definition name and body, all emitted
references, JSON escaping, and the `$defs` container—with the inline result.
Uneconomic candidates remain inline and no unused definition is emitted. The
projection therefore still visits repeated occurrences to preserve complete
disclosure even though the delivered JSON bytes are deduplicated. Authored
schemas and handler validation remain authoritative; projection creates no
second request-schema source and changes neither response-channel policy nor
byte-budget gates.

Structured discovery for the findings-capable authoring routes —
`workspace_work_record_ready_slice` and `workspace_work_record_upsert_slice` —
must publish the complete conditional
request contract, not a summary of it: the conditional redteam requirement
(`shaping_mode: "redteam"` needs an explicitly authored
`review_purpose: "standalone"`), the closed accepted purpose vocabulary, the
reviewer/redteam role binding derived from `work_kind`, a complete executable
redteam request example, and `docs/work-record-schema.md` as the durable public
contract. A field the discovery example advertises must be accepted by the live
route, and a field the live route requires must not exist only in prose. That
publication belongs in the structured guidance fields (`use_when`,
`requires_prior_state`, `authoritative_for`, `recommended_first_call.arguments`,
`docs_refs`) rather than in `notes`, which is budgeted selection guidance.

Each MCP tool's `side_effects` is also the canonical read-only authority for
refusal guidance: a guidance next call may name only a tool whose entry
declares exactly `["read_only"]`. The next-calls corpus loads membership and
`side_effects` from the same fragments and fails the load on a missing,
duplicated or contradictory declaration. See
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md#guidance-information-not-correction).

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
- `workspace_agent_dispatch` for MCP-only worker/reviewer/redteam launch
- `workspace_agent_run_status` for launched-run
  monitoring
- `workspace_lint_repo` or `workspace_generate_and_lint` for repo diagnostics
- work-record setter routes for status, closure, task, contract, acceptance, or
  slice writes

Discovery classifies `workspace_validate_dispatch` as `workspace_write` only
because a graph-required validation may refresh the ignored current-HEAD graph
cache. Its write boundary is exactly the graph artifact, its sibling atomic
temporary file, the advisory build-lock file, and the eight exclusively claimed
candidate slots `.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. Candidate slots are attempted
only during the initial absent-lock race, are never reused or authority, and
remain untouched; an existing shared lock prevents further claims and slot
exhaustion uses an independent atomic build. Concurrent refreshes coalesce only
within one process and only between equivalent base builds; SCIP builds and all
cross-process callers perform independent atomic builds. A follower resolves only
on its captured leader's successful publication, so no pre-existing artifact and
no failed leader can produce a coalesced result. It never writes canonical work
records or evidence sidecars, lifecycle/runtime/dispatch/backend state, or result
evidence, and it never launches an agent. Its existing
orchestrator/operator-only role exposure is unchanged in both free-local and
paid-CCE registrations.
If bounded current-HEAD graph production fails, the sole readiness response
preserves the typed `graph_impact_failure`, its code, and authoritative
remediation precedence. The strict route accepts no `verbose` or replacement
bulk alias. Its complete failure and recovery projection, selected detail owners,
and content-reference transport are defined by the
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md).

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

`workspace_integration_promote_check`, when present through the
`integration-tools.json` fragment, is a read-only local coordination check for
WK-to-integration promotion readiness. It reports local facts, unknowns, and
blockers for the coordinator's next action; it is not policy authority and must
not be described as authorizing promotion, merge, rebase, lifecycle changes,
worktree cleanup, or ref updates.

No MCP route reports tool-use telemetry. Live usage measurement is the
operator-configured [anonymous MCP metrics](mcp-telemetry.md) files: numeric,
closed-schema records with no arguments, results, or caller identity. Discovery
must not advertise a live audit, usage-catalog, or metrics query route, and must
not describe metrics as launch, mutation, lint/generate, routing, refusal,
enforcement, or policy authority. The domain tools still own read, search,
work-record, dispatch, review, validation, and lint semantics.

Keep the five policy surfaces distinct:

- FAQ and docs teach humans how to interpret known issues and tool output.
- Discovery and the router guide agents toward appropriate first or recovery
  calls.
- Runtime refusals and enforcement decide whether a call is allowed to proceed.
- Historical backfill measurement reports only what old artifacts can prove,
  with confidence labels and unsupported-gap markers for MCP-specific questions
  the artifacts cannot establish.
- Live measurement is anonymous numeric metrics written to local files (tool
  name, hour, outcome, duration, byte counts) -- no provenance or identity, and
  no query route.
- Sequential trajectory is measured by the same per-connection recorder as a
  separate closed `kind: "trajectory"` record: the tool, what the previous
  completed call offered (`router_recommendation`, `emitted_next_calls`,
  `refusal_replacement` or `none`) and a fixed outcome (`followed`,
  `allowed_alternative`, `wrong_first_tool`, `ignored_recommendation`,
  `refusal_recovered`, `refusal_not_recovered`, `refusal_recovery_unassessed`,
  `concurrent_unknown` or `unobserved`). The recorder keeps only the one
  previous result's offered calls, compares the next call's tool and arguments
  as inert data, and evaluates a refusal replacement's declared success
  predicate with `evaluateSuccessPredicate` against facts the follow-up result
  itself published. Overlapping calls, results that offered nothing, missing
  predicates and calls rejected before the handler boundary are unknown or
  outside the denominator; no intent is inferred from prose and no argument or
  result is stored.

Anonymous metric files are observability data only. They must not be documented
as a reason to scrape `.agent-runs`, broad logs, generated views, runtime
artifacts, raw JSON work records, or shell output to reconstruct canonical state.
When metrics are missing, disabled, or incomplete, discovery should describe that
as a bounded measurement gap, then route any actual read, dispatch, lint,
generate, review, mutation, refusal, or enforcement decision to the tool that
owns that authority.

## CCE Worker-Admission Recovery Projection

When the Chassis Control Engine (CCE) returns a valid `worker_admission.recovery.v1` object,
tool-discovery and launcher-facing guidance must treat that object as the
primary recovery projection for the refusal it accompanies. Portfolio surfaces
may transport, summarize, and display validator-owned projections of those
CCE-owned facts, but
they do not authorize launch, satisfy review controls, add accepted authority,
or infer local admission from recovery content.

CCE is the sole recovery producer and action chooser. wiki-core's
`node-engine-worker-admission-recovery.mjs` owns mechanical validation and the
typed result, including the complete retained diagnostic carrier. wiki-MCP and
launcher consumers only transport or render that result. They do not parse raw
recovery, maintain another action, reason, field, or schema vocabulary, or
synthesize replacement recovery.

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

Malformed, oversized, unknown-version, unknown-field, or projection-mismatched
recovery data fails closed through the wiki-core validator. Portfolio surfaces preserve the
underlying non-admit or route-problem refusal, surface the recovery contract
problem with its exact typed classification and owning boundary, publish every
mechanically supported next call (or explicit no-supported-route), and require
resubmission through CCE. Agents must not repair malformed recovery locally,
guess hidden controls, synthesize review
attestations or accepted authorities, bypass CCE, or treat absent recovery as
permission to proceed.

`workspace_validate_dispatch` accepts no `verbose` or replacement bulk alias.
Its sole readiness response preserves the validator-owned complete recovery
carrier. A carrier that fits the compact complete-frame class is returned whole;
otherwise the response is a bounded summary whose explicitly selected `detail`
calls read the retained carrier exactly, as described in
[MCP Selected Response Details](mcp-selected-response-details.md). Selected
detail reads the already-stored exact bytes and owns no recovery semantics. This
transport contract creates no portfolio security posture or CCE schema authority.

### Findings-only reviewer validation

Implementation workers do not own complete declared validation and do not receive
test dependencies merely to make it runnable. They may use their native command
tool for checks already available in frozen `R union W`; inability to reach an
undeclared test corpus is not a blocker and test success is not a closed-input
commit prerequisite.

The findings-only reviewer receives the exact committed target and diff base,
repository-wide read-only source, and a reviewer-only read-only dependency
projection. Workspace dependency links are rewritten to the exact reviewed
checkout rather than current main. Commands run with isolated writable temp/cache
locations; the checkout, Git metadata, refs, index, work records, receipts, and
canonical runtime state remain read-only. Bounded evidence records reviewer run
id, subject, reviewed SHA, diff-base SHA, command/target, exit status,
stdout/stderr, and timeout/truncation state. Both passing evidence and failing
findings are advisory and independently neither admit nor veto integration.

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

- [`workspace_work_record_edit`](mcp-operation-reference.md#bounded-ordinary-authored-field-editor)
  is the general facade for ordinary authored fields, including record- and
  slice-level task completion through its `task` `mark_done` action;
  specialized semantic routes retain excluded fields.
- `workspace_work_record_set_status` is the agent-safe route for trusted
  record- and slice-level status updates, including a status change made on its
  own. A landed transition to `review` or `done` runs its closeout checks and
  reports their actual result in `closeout_lint`.
- `workspace_work_record_set_closure` remains the closure-specific route and
  is separate from the status/task edit family. Its explicit optional
  `status: "done"` composes authored closure and completion into one validated
  canonical write; omitted, it records closure and changes no status. A landed
  mutation likewise runs its closeout checks and reports their actual result.
- `workspace_work_record_entry_upsert` is the durable entry writer. The
  router's `work_record_mutation` intent selects it for ordinary entry writes:
  a write verb before `entry` with no entry number (such as "append a new entry
  to WK-0001" or "add an entry titled …") is entry creation, and one that names
  `entry <n>` (such as "update WK-0001 entry 35" or "append a version to entry
  3") is an update of that entry. Creation suggests `unit` and any stated
  `title`, and asks for `kind`, `title` and `content`. An update keeps the named
  `entry_id` and asks for `content`. Neither proposal takes content from the
  task text. `expected_source_digest` is reported in `server_state_fields` with
  the `source_digest` of `workspace_work_record_entry_read`. When the unit is
  known, that read (the unit's entry inventory, or the named entry) is the one
  recommended call. The incomplete write is returned as `operation` guidance,
  never as an executable call. Reading an entry ("read entry 40 of WK-0001"),
  listing entries, and whole-record edits such as a summary replacement keep
  their own routes. A request that only explains an entry write, or that names
  no entry, selects no entry operation. Sessions without the entry writer,
  such as reviewer and redteam, receive `visibility_withheld` without the
  operation's identity.

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

The following four MCP routes are the agent-safe recommended path for
schema-aware WK contract and slice editing. Discovery queries for structured
WK setup intents should surface these ahead of the CLI fallback rows:

- `workspace_work_record_upsert_slice` — create or update a tracker-local
  slice on a `WK-####`; the `slice.id` field selects the target slice.
- `workspace_work_record_delete_slice` — remove a tracker-local slice by
  slice-scoped `unit` (WK-#####slice-id) or explicit `slice_id`.
- `workspace_work_record_edit` — edit ordinary registry-declared scalar, list,
  task, and notes fields. List actions support whole-list replacement or one-item
  append for record and slice fields allowed by the shared registry; `read_scope`
  is the canonical read-first reference list. `acceptance.criteria` and the human
  notes in `acceptance.validation` are ordinary list fields; note replacement
  preserves stored executable `node_test` bindings, which only the
  controlled-contract proof operations author.
- `workspace_work_record_shape_review_unit` — shape a record or slice into a
  findings-only review contract by setting `work_kind` to `"review"`, forcing
  `write_scope` to `[]`, and pointing `dispatch_intent.intended_agent_role` at
  `"reviewer"`. Agents creating review slices should use this composite route
  rather than assembling the three field edits manually.

All four routes share the same behavioral contract: output is compact by
default (`verbose: true` adds complete diagnostics but never the updated record
body; read changed state through the selected read routes); each validates the
prospective result against work-record.v1
before writing and refuses invalid edits with structured diagnostics; each
accepts an optional `expected_source_digest` for stale-source protection
against concurrent edits; and none accept caller-supplied filesystem roots —
they resolve only through configured workspace repository aliases.

The matching CLI commands (`npm run wiki -- work-records upsert-slice`,
`delete-slice`, `set-list-field`, `shape-review-unit`) are
operator-shell fallbacks only. They are not agent dispatch transports when the
MCP surface is available. Agents must use the MCP routes above and report a
`missing_structured_transport` blocker if those routes are unavailable rather
than falling through to the CLI commands.

### Review Result Discovery

Discovery exposes one callable review route: `workspace_agent_dispatch` with a
reviewer or redteam role. Its original result preserves complete captured text as
the primary advisory product and reports schema adherence separately. A
schema-nonadherent response remains usable text. Ordinary reviews report
`formal_attestation.requested:false`. A `schema_constrained` canonical selected
contract requests formal attestation; the same settlement derives and durably
publishes it or reports a precise unavailable reason. The existing attestation
retains its narrow admission consumer semantics and grants no general lifecycle
authority.

No discovery entry, router recommendation, role profile, or recovery response may
expose a review-evidence, review-provenance, or attestation append operation. An
unknown old monitor after restart does not invalidate text already returned and
does not create a repair, reauthentication, retry, or replacement-review action.
Clean, severe, schema-nonadherent, absent, and failed result shapes have identical
automatic lifecycle posture. Their content informs coordinator judgment and
disposition; it does not automatically admit, refuse, integrate, forge, complete,
or mutate a work record.
