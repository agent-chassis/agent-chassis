# Agent-tool compliance and surface rationalization

This document describes the implemented agent-tool compliance boundary: what the
conformance evaluator requires of every role-visible MCP registration, how the
manifest-backed debt records measure the remaining gaps, and why overlapping
public tool families were retained rather than merged. The canonical fragment
manifest, descriptor validator, and adopted decisions remain authoritative; this
page describes the repository behavior and its measurements.

## Mechanical compliance boundary

The canonical fragment manifest and descriptor validator remain the only
registry and metadata owners. For each installed, supported MCP row, the
conformance evaluator requires non-empty `task_ids`, `side_effects`,
`authority`, `tier_visibility`, `use_when`, `do_not_use_when`, and
`authoritative_for`, plus `recommended_route` and a structured
`recommended_first_call`. Existing install-state, runtime-posture, task,
side-effect, authority, tier, and role vocabularies are reused unchanged.

The shared `registerTool` boundary first applies the session-role policy. Every
role-visible registration must then have a canonical descriptor row and belong
to the manifest-derived registration-eligible set. That check precedes the tier
projection and therefore covers free/local, paid CCE, and operator-only routes.
A missing installed manifest or fragment, a malformed descriptor, a changed debt
row, or a new incomplete row fails startup with its original attributable error
before any registration boundary exists. There is no fixed fallback tool
population.

Live description safety is a separate runtime invariant. The single policy
owner is `AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS` in
`packages/wiki-core/src/lib/tool-discovery/descriptor.mjs`. Registration
requires a nonempty description of at most 1,500 JavaScript string characters.
It does not load or compare the manifest's historical per-tool baselines, so
ordinary prose growth within the hard limit cannot prevent MCP initialize or
`tools/list`.

Runtime visibility is the intersection of actual registration,
`session-role-tool-access.json`, the launcher-minted session role, registered
tier, `tier_visibility`, `install_state`, and `runtime_posture`. The declared
`operator` role is the full-role posture. `audience` is descriptive only and is
not authority for visibility.

## Owner-bound debt

`manifest.json.agent_tool_conformance_debt` is the single routing and alias debt
mechanism. It names its owner, target WK, retirement evidence, original
assembled-descriptor digest, exact baseline entry digests, and the five
compatibility aliases. The
evaluator reports `debt_total`, `debt_added`, `debt_retired`, and exact remaining
tool names. An unchanged incomplete baseline row may remain; a conformant row
retires; a changed baseline row or new incomplete row is `debt_added` and fails
lint and registration. Compatibility aliases remain debt until removed through
an authorized compatibility change. The baseline descriptor, exact name set,
and exact entry-digest map have separately pinned digests in the existing
manifest test, so deleting, replacing, or rebasing debt cannot pass silently.

Each alias record is part of that exact baseline and must carry the following
accountability data. The record-map digest is pinned by
`packages/wiki-core/data/tool-discovery/manifest.test.mjs`; malformed fields,
record deletion, replacement-route mutation, and an updated/rebased record map
fail the validator or the pinned manifest test.

| Retired alias | Owner | Target WK | Review date | Recorded replacement route | Compatibility evidence |
| --- | --- | --- | --- | --- | --- |
| `workspace_sidecar_build` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_build` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records stay immutable while every alias is retired from the live surface |
| `workspace_sidecar_rebuild` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_rebuild` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records stay immutable while every alias is retired from the live surface |
| `workspace_sidecar_status` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_status` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records stay immutable while every alias is retired from the live surface |
| `workspace_sidecar_impact_paths` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_impact_paths` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records stay immutable while every alias is retired from the live surface |
| `workspace_sidecar_context_for_path` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_context_for_path` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records stay immutable while every alias is retired from the live surface |

All five aliases are retired: they are absent from registration, discovery, and
role access, and a retired name refuses when called. Their immutable records
keep the pinned baseline and now report as `compatibility_alias_retired`, with
`compatibility_alias_debt_total` zero and `compatibility_alias_remaining` empty.
The recorded replacement for the retired path-impact alias names a route that is
itself retired; `workspace_code_index_impact` is the current impact route.
Restoring a retired alias to the descriptor is added debt. Changing a descriptor alias target is added debt;
removing the descriptor and access-policy entry through an authorized
compatibility change is measurable retirement. No deprecated lifecycle or
support value is introduced.

Applicability exceptions are mechanically fixed to an empty array. A non-empty
exception protocol could decide which tools escape controls and therefore needs
an adopted authority owner; none is invented here.

The authoring-ergonomics surface now separates compact snapshot creation from
typed inspection. `workspace_authoring_ergonomics_report` returns no finding,
episode, cluster, or raw-event population and exposes no whole-response spill.
`workspace_authoring_ergonomics_report_query` retrieves only declared
collections and selected scalar ranges from an authenticated immutable
snapshot, with exact accounting and loud refusal for invalid, forged, expired,
cross-domain, or source-mismatched state. Both registrations share the same
read-only advisory authority, role grant set, canonical refusal transport,
discovery controls, and durable documentation. The neutral snapshot and
projection-vocabulary owners live in `@agent-chassis/controlled-contract`; wiki
projection and byte measurement remain injected wiki-owned behavior, so the
neutral package imports neither wiki-core nor wiki-mcp.

Code-index evidence used by this report is ensured automatically. The report
reuses a fresh shared committed index or invokes the incumbent atomic/coalesced
builder for missing, stale, incompatible, or corrupt state, then continues the
report against captured HEAD. A genuine ensure failure is reported as
`code_index_rebuild_failed` with the owner failure and correction-before-retry
guidance; dirty-worktree content is not substituted for committed evidence.

The evaluator report is the current measurement. `applicable_tool_count`,
`debt_total`, `remaining_tool_names`, and `debt_retired` are computed from the
assembled descriptor, the manifest baseline, and the access policy, and the
agent-tool conformance test pins their exact current values. `debt_added` must
stay empty. A baseline row whose prose changes must gain its complete routing
controls in the same change, because an edited incomplete row is added debt.

## Runtime ceiling and token-budget debt

The runtime ceiling, historical debt accounting, and aggregate reduction target
are distinct controls. Runtime registration owns only the nonempty/1,500 safety
and conformance ceiling described above. The exact historical per-tool maps are
CI/lint evidence: they reveal new or enlarged prose even when reductions
elsewhere offset it, but they do not decide whether the server starts. The
28,000-character paid/operator aggregate remains the reduction target; it is
not raised, waived, recaptured, or used as a startup threshold.

The existing manifest and notes/description budget test family owns the debt
record with owner `tool-discovery notes/description budget test family` and
target `work record`.

| Surface | Target | Measured population |
| --- | ---: | --- |
| Raw canonical descriptor `notes` | 62,000 chars | Every non-empty base note before role/tier projection. `tier_text` overrides are checked separately and are not part of this aggregate. |
| Paid/operator live `tools/list` descriptions | 28,000 chars | Every registered description in the paid operator posture. |

Each surface carries an exact historical per-tool length map, total, denominator,
and integrity digest; the notes-budget and live-description budget tests pin the
current values the evaluator reports. The manifest validator recomputes all four facts, and the
manifest test pins their accepted values and digests. Those historical per-tool
lengths are debt guards only while a row lacks the complete structured routing
metadata. Once a row is metadata-complete, its prose is governed by the aggregate
surface target, the universal runtime limit, and the discovery prose boundary;
the old row length is measurement evidence, not a permanent tool-specific cap.
The evaluator reports
`target`, `current_value`, `debt_added`, `debt_retired`, `owner`, `target_wk`, and
`remaining_excess`. A shorter or removed entry retires debt without rebasing.
Any new entry is reported separately. A per-entry increase on a metadata-incomplete
row is added debt even if larger reductions elsewhere make the aggregate smaller.
Growth on a metadata-complete row remains visible as measurement but is not debt.
Thus new or changed prose cannot hide inside the historical allowance without
turning historical debt evidence into runtime launch authority.

These measurements are deliberately distinct. Assembled descriptor bytes are
the UTF-8 size of the compact canonical descriptor serialization. Raw notes are
JavaScript string characters before role/tier projection. Live descriptions
are JavaScript string characters in the model-visible paid/operator
`tools/list` surface after registration-time description composition. Serialized
MCP transport bytes include the complete serialized result frame and remain
owned by the projection-bounds measurement; they are not counted as
model-visible description or raw-note debt.

The focused discovery budgets remain enforced: the two retained discovery
routes' notes stay within 750 characters, the four SCIP notes within 650, every
live description is at most 1,500 characters, and the SCIP shared description
reduction remains enforced. Prose content follows the
[Discovery Prose Boundary](tool-discovery-schema.md#discovery-prose-boundary).

## Compact discovery and token cost

`workspace_tools_list` remains the bounded browse route, filtered by `task_id`
when the task is known, and `workspace_tools_describe` remains targeted detail
for an exact tool name. Their public routes are not mergeable because their
input schemas, output semantics, and discovery reach differ. The earlier
three-route discovery family's notes were reduced from 1,424 to 741 characters
in total while retaining selection distinctions, authority, bounds, and
complete recovery guidance; the two retained routes' notes now total 534.

work record narrows only the ordinary list and compact-description projections. It
is bound to the immutable census baseline of 106/106 orchestrator-visible tools
at descriptor digest
`sha256:f523d121f07a351e70553ad84dd9d0f003165237d76dc366319afb8405b46adb`.
Each `workspace_tools_list` result retains only `tool_name` and `task_ids`; its
deterministic ordering, pagination, `total_count`, `returned_count`, and
continuation metadata are unchanged. Compact `workspace_tools_describe` results
omit only `kind`, `entrypoint`, `runtime_posture`, `priority`, and `rank`, while
retaining the remaining routing identity and task-contract fields.

Every omitted value is non-sensitive and remains losslessly available to the
same caller. After selecting a name, call
`workspace_tools_describe({tool_name, verbose:true})`; the verbose result returns
the complete descriptor entry and the tool's rank in the full role- and
tier-visible ordering. work record does not change query, router, refusal, MCP spill,
controlled-authoring, proof-verification, or role-handoff projections.

The four SCIP symbol-query notes were reduced from 1,730 to 640 characters,
and their repeated live compact/detail suffix was reduced by 560 serialized
characters across the four registrations. The short suffix remains owned once
in `code-index-tools.mjs`; route-specific subjects and exact compact/detail
semantics remain distinct.

The list response follows the structured-result contract: its value is
published in `structuredContent` with exactly one generated text block holding
the compact JSON serialization of that value. The wiki-core projection owns row
and structured-payload admission; the MCP adapter measures the complete
serialized result frame — both representations — through the shared
`measureMcpInlineResultBytes` owner, without shaping or persisting a spill as a
probe, so transport cost is measured without copying selection prose into the
compact model-visible rows.

`total_count` is the exact complete role/tier-visible population,
`returned_count` is the current page, and `truncated_count` is the remaining
population in the current cursor frame. `has_more` and `next_offset` provide
complete continuation under both count and byte bounds. A caller limit cannot
relax either server bound. Full diagnostics omitted by the list byte budget are
recoverable from describe/query.

The exact complete-recovery enforcement is
`tests/tool-discovery-projection-bounds.test.mjs`, test
`work record: following next_offset enumerates the complete catalog exactly once`.
The live-route continuation enforcement is `work record: the registered
workspace_tools_list route pages on a non-zero offset` in the same file.

The four changed SCIP symbol-query descriptions use the existing compact/detail
contract: `result_count.total`, `result_count.returned`, and
`result_count.truncated` describe the bounded default, while `verbose:true` on
the same route restores every omitted result and full evidence. Their exact
enforcement is `tests/interface-smoke-mcp-code-index.test.mjs`, test `MCP symbol
navigation caps successful defaults and preserves verbose full envelopes`.

## Controlled-authoring journey measurement

Launcher-owned stdio MCP capture records a bounded
`controlled-authoring-journey-measurement.v2` summary in local transcript
session metadata. It pairs every ID-bearing protocol request with its response,
including the real MCP `initialize` exchange, and includes successes, refusals,
protocol failures, retries, and unmatched calls. Initialize request/response bytes
remain in the transport totals and its observed latency is reported separately in
the protocol summary; it is not misclassified as a tool operation. Per-tool-call
phase, outcome, reported effect, and elapsed time are retained when observed. Invalid
frames, duplicate or unmatched IDs, missing phases, and mixed evidence
identities make the capture incomplete instead of shrinking its denominator. Its
`source.content_digest` is the capture owner's stable executed-source census
digest (see the transcript capture section of
[agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md));
a changed or unobservable census leaves the identity incomplete, and comparison
refuses it rather than substituting a command or path label.

Classification is documented and separate from observed outcome: ordinary
semantic upsert and remove calls are authoring,
snapshot/cursor/collection/field-path selectors are retrieval, discovery-family
calls are discovery, and all other calls are preparation. Retry attribution
requires an observed earlier request ID; identical requests alone are only
reported as repetition. A refusal never
implies caller responsibility. Attribution stays unknown unless separately
authored with supporting evidence. Repeated complete requests and repeated
semantic inputs are different counts. Request and response byte counts remain
transport diagnostics and are explicitly not token counts. No transcript
values, paths, or fingerprints enter the summary or an admission carrier.
IDs are scoped to one captured server session. Reuse in a separately measured
server generation is valid; reuse inside one session remains a duplicate and
orphaned, duplicate, malformed, and error responses remain explicit.

Exact token totals are admitted only when the observed client projection
supplies nonnegative input/output counts together with client, model, tokenizer,
and projection identities. Otherwise the summary reports the observation gap;
it never estimates tokens from bytes.

Historical paired-benchmark artifacts remain measurement evidence with their
recorded source identities, comparison validity, and transport limitations.
The retired authoring workflow has no current executable benchmark wrapper;
ordinary-authoring performance evidence must exercise the registered upsert,
query, and explicit-validation operations directly and must preserve the same
source, semantic-state, exactly-once, and client-projection attribution rules.

## Cross-posture assurance

Role and registered-tier exposure are tested from separately authenticated
sessions. A caller cannot select another role through request data, and missing
or inconsistent classification fails closed. Discovery pagination must recover
the complete caller-visible population exactly once, while targeted discovery
remains the ordinary selection path.

Deployment-specific inventories and assessment records are maintained outside
this adopter-facing guarantee.

## Surface rationalization

Public routes remain separate when their authority, side effects, lifecycle,
inputs, results, discovery reach, or compatibility obligations differ. A smaller
tool count is not accepted as an improvement when it weakens task completion,
routing, refusals, retrieval, or state transitions.

Rationalization therefore requires paired workflow evidence: the candidate must
preserve or improve task outcome and result quality, and any compact or selected
route must retain a lossless complete-retrieval path. This page does not
enumerate deployment-specific capability placement.

## Decision gap

No adopted vocabulary expresses “live but deprecated.” This implementation does
not invent a lifecycle or support state. A future deprecation or alias-retirement
protocol requires an adopted decision naming the vocabulary owner, discovery
semantics, compatibility obligations, retirement evidence, and authority for
the transition. The same is true before any non-empty applicability-exception
protocol can be accepted.
