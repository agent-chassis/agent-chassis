# Tool Discovery Surfaces

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for the discovery entrypoints and the
per-surface projection guidance they carry: the three MCP discovery routes and
the CLI fallback, the CCE worker-admission recovery projection, omitted-`repo`
behavior, and trusted work-record edit discovery.

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

`workspace_tools_list` is the hard-bounded daily-use catalog scan. Its default
rows contain only `tool_name`, `task_ids`, and `rank`, which are sufficient to
select a targeted lookup without repeating entrypoints, prose, posture, tier,
or descriptor detail. Both its pretty-printed structured payload and its
complete serialized MCP result stay within 4,096 UTF-8 bytes. The two ceilings
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
which bound removed rows. Returned ranks are contiguous from the top of the
ranking, so a truncated response never skips over a hidden row. Increasing
caller `limit` never relaxes either byte ceiling. A truncated response carries
targeted `next_calls` for `workspace_tools_query` by `task_id`/`tool_name` and
`workspace_tools_describe` by `tool_name`.

Those two next calls need a `tool_name` the caller can only learn from the list
itself, so they are targeted follow-ups, not the completeness mechanism. The
completeness mechanism is continuation paging, in the same vocabulary
`workspace_search_repo` uses: `offset` echoes the zero-based cursor this
response was served at, `has_more` reports whether any role-visible row remains
after it, and `next_offset` is the position to resume from (`null` when nothing
remains). Continue by repeating the call with `offset: next_offset` and the same
filters until `has_more` is false; the union of the returned rows is then the
complete role- and tier-visible set. `next_offset` resumes immediately after the
last row the response actually carried, so a page cut short by a byte ceiling
resumes at the first row it dropped rather than skipping the remainder of the
count window. Ranks are positions in the complete ranking, so they stay
contiguous across consecutive pages. `offset` is a paging input only: it selects
which page of the already role- and tier-scoped ranking is returned, is applied
after scoping and before both bounds, and can no more widen visibility or relax
a byte ceiling than `limit` can. An `offset` past the end returns no rows with
`has_more` false rather than an endless cursor.

The exact losslessness enforcement is
`tests/tool-discovery-projection-bounds.test.mjs`, test
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
diagnostics remain on the describe and query surfaces. A healthy catalog never
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
positive integer `limit`, and a non-negative integer `offset` from the caller;
every other request field is ignored,
so no request can restate the session role, re-open the tier gate, raise a byte
ceiling, or otherwise widen the authorized role-visible projection. An
unresolvable role sees nothing rather than the full surface.

`workspace_tools_describe` is the targeted detail surface. It is intended for
known tools or narrow sets, and full descriptor fields remain available only
through explicit verbose/detail behavior. Routine browsing should not start
here unless the agent already knows it needs the deeper descriptor shape.

`workspace_tools_query` remains the filtered task/tool lookup for finding
tools by controlled task IDs or exact tool names without broadening into a
catalog scan. It is the narrow lookup path for routine agent discovery when
the caller already has a task ID or exact tool name in hand.

`workspace_agent_faq` is the read-only MCP troubleshooting surface for
recurring agent known issues. Agents should use it to list FAQ entries or query
by stable entry id / related blocker code before guessing at unfamiliar tool
output or worker complaints. Its CLI parity command is
`npm run wiki -- agent-faq --json`, with `--id <entry-id>` or
`--related-code <code>` for targeted fallback/operator inspection. The FAQ is
advisory and read-only: it does not dispatch roles, decide readiness, satisfy
review controls, change launcher policy, or authorize any runtime behavior.

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
If bounded current-HEAD graph production fails, verbose readiness preserves the
safe `graph_impact_failure` code and remediation; compact readiness preserves
`graph_impact_failure_code` and uses that remediation as `next_action`, without
forwarding raw causes.

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

`workspace_tool_usage_audit` is the compact read-only observability surface that
emits a NEUTRAL usage catalog of agent tool-use. Discovery should present it as an
operator/coordinator measurement lens over bounded historical and live audit
facts, not as a launch, mutation, lint/generate, routing, refusal, enforcement,
or policy-authority route. Its output is descriptive only -- counts, provenance,
first-tool, and response-size indicators -- and renders no misuse or adherence
verdict; assessing the catalog for misuse is an offline, out-of-band activity. The
underlying domain tools still own read, search, work-record, dispatch, review,
validation, and lint semantics.

The audit surface reports neutral facts without duplicating owned contracts
inline. work record owns the `tool-use-policy.v1` evidence envelopes, source and
confidence labels, redaction posture, and audit-only interpretation; its misuse
vocabulary remains only as offline reference data and is no longer reported by the
runtime audit output (work record). work record owns routing-intent ids and
replacement-call guidance through `tool-routing-intents.v1`, router output, and
discovery metadata. The audit result does NOT report misuse codes, next-action
adherence, or work record routing/replacement guidance -- that runtime coupling was
removed (work record). Discovery text must not describe the audit surface as emitting
misuse classifications or recommended-call authority.

Keep the five policy surfaces distinct:

- FAQ and docs teach humans how to interpret known issues and tool output.
- Discovery and the router guide agents toward appropriate first or recovery
  calls.
- Runtime refusals and enforcement decide whether a call is allowed to proceed.
- Historical backfill measurement reports only what old artifacts can prove,
  with confidence labels and unsupported-gap markers for MCP-specific questions
  the artifacts cannot establish.
- Live audit measurement records bounded observed usage facts going forward
  (provenance, response size, outcome) -- a neutral catalog, with no adherence or
  misuse verdict.

`workspace_tool_usage_audit` is canonical only for the compact audit facts it
returns. It must not be documented as a reason to scrape `.agent-runs`, broad
logs, generated views, runtime artifacts, raw JSON work records, or shell output
to reconstruct canonical audit state. When audit state is missing, stale, or
unsupported, discovery should describe that as a bounded measurement gap or
runtime availability issue, then route any actual read, dispatch, lint,
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

Discovery describes the output split explicitly: ordinary validation output is
bounded diagnostic metadata and excludes retained recovery values; verbose
validation transports the complete carrier through the shared MCP response-size
boundary. When that envelope spills, the content-reference route range-reads
the already-stored exact bytes and owns no recovery semantics. This transport
contract creates no portfolio security posture or CCE schema authority.

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
