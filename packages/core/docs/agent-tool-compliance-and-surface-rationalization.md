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
A malformed descriptor, changed debt row, or new incomplete row fails startup;
only a genuinely absent installed descriptor asset retains the fixed existing
free/local compatibility fallback.

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

| Live alias | Owner | Target WK | Review date | Replacement route | Compatibility evidence |
| --- | --- | --- | --- | --- | --- |
| `workspace_sidecar_build` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_build` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records are complete, immutable, live, and discoverable |
| `workspace_sidecar_rebuild` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_rebuild` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records are complete, immutable, live, and discoverable |
| `workspace_sidecar_status` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_status` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records are complete, immutable, live, and discoverable |
| `workspace_sidecar_impact_paths` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_impact_paths` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records are complete, immutable, live, and discoverable |
| `workspace_sidecar_context_for_path` | code-index registration/descriptor/test family | work record | 2026-08-21 | `workspace_code_index_context_for_path` | `tests/agent-tool-conformance.test.mjs`: compatibility alias records are complete, immutable, live, and discoverable |

All five aliases remain live and discoverable with their existing public
behavior. They contribute five rows to `debt_total` and are reported separately
as `compatibility_alias_debt_total`, `compatibility_alias_remaining`, and
`compatibility_alias_retired`. Changing a descriptor alias target is added debt;
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

Current results are 74 remaining debt rows: 69 unchanged routing-control gaps
and five workspace-sidecar compatibility aliases. Thirteen rows retired from
the baseline: the authoring-ergonomics report, three discovery routes, four SCIP
relation routes, committed-slice integration, coordination preflight, two
terminal-candidate routes, and the controlled proof-authoring skeleton route.
`debt_added` is empty. The manifest-backed report is the exact name inventory
and prevents silent growth.

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

| Surface | Target | Historical baseline | Current | Denominator | Added | Retired | Remaining excess | Within target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Raw canonical descriptor `notes` | 62,000 chars | 65,172 chars | 60,958 chars | 152 noted rows | 0 | 4,214 | 0 | Yes |
| Paid/operator live `tools/list` descriptions | 28,000 chars | 44,880 chars | 44,487 chars | 126 registered tools | 0 | 393 | 16,487 | No |

Each surface carries an exact per-tool length map, total, denominator, and
integrity digest. The manifest validator recomputes all four facts, and the
manifest test pins their accepted values and digests. The evaluator reports
`target`, `current_value`, `debt_added`, `debt_retired`, `owner`, `target_wk`, and
`remaining_excess`. A shorter or removed entry retires debt without rebasing.
Any new entry or per-entry increase is reported separately as added debt even if
larger reductions elsewhere make the aggregate smaller. Raw-note growth fails
structured lint; live-description growth fails the description-budget CI test.
Thus new or changed prose cannot hide inside the historical allowance without
turning historical debt evidence into runtime launch authority.

These measurements are deliberately distinct. Assembled descriptor bytes are
the UTF-8 size of the compact canonical descriptor serialization. Raw notes are
JavaScript string characters before role/tier projection. Live descriptions
are JavaScript string characters in the model-visible paid/operator
`tools/list` surface after registration-time description composition. Serialized
MCP transport bytes include the complete two-channel result envelope and remain
owned by the projection-bounds measurement; they are not counted as
model-visible description or raw-note debt.

The focused discovery budgets remain within target: discovery
list/describe/query notes total 741 against 750, the four SCIP notes total 640
against their focused bound, every live description is at most 1,500 characters,
and the SCIP shared description reduction remains enforced. Broader corpus
issues in the notes smell suite and the three-route duplicate-description
sentence are tracked separately against the debt owner named above.

## Compact discovery and token cost

`workspace_tools_list` remains the bounded browse route;
`workspace_tools_describe` remains targeted detail; and
`workspace_tools_query` remains the known-selector lookup. Their public routes
are not mergeable because their input schemas, output semantics, and discovery
reach differ. Their notes were reduced from 1,424 to 741 characters in total
while retaining selection distinctions, authority, bounds, and complete
recovery guidance.

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

The list response preserves the two-channel MCP compatibility contract. The
wiki-core projection owns row and structured-payload admission; the MCP adapter
measures the complete serialized result, including the text channel's escaped
JSON cost. Transport serialization duplication is therefore measured without
copying duplicate selection prose into the compact model-visible rows.

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

## Cross-posture measurements

The role/tier parity test constructs every posture from canonical policy and
descriptor facts, then starts a distinct live MCP session for that exact role
and tier. This is a cross-posture measurement, not a claim that one caller can
observe other roles from `workspace_tools_list`.

After the MCP restart, the paid-orchestrator live posture registers 93 tools.
The exact live recovery test follows `next_offset` through seven byte-bounded
pages, retrieves all 93 names exactly once, and verifies that no public name has
an `mcp__` or `wiki__` prefix. The exact test is
`tests/agent-tool-conformance.test.mjs`, test `paid orchestrator discovery
recovers 93 live tools exactly once across seven bounded pages`. Cross-role and
cross-tier parity remains a different proof, owned by `live registration equals
descriptor role/tier visibility for every session-role posture` in that file.

| Session role | Free/local before → after | Paid CCE before → after |
| --- | ---: | ---: |
| orchestrator | 77 → 77 | 93 → 93 |
| reviewer | 30 → 30 | 39 → 39 |
| worker | 2 → 2 | 2 → 2 |
| redteam | 30 → 30 | 39 → 39 |
| operator | 84 → 84 | 125 → 125 |

The live counts do not change: the 22 previously undescribed registrations were
already reachable in the paid operator posture and absent from free/local. The
descriptor now covers them, so the descriptor corpus changes from 134 to 156
rows and its installed/supported MCP denominator changes from 103 to 125. The
compact assembled-descriptor serialization changes from 211,008 to 238,452
UTF-8 bytes because 22 live registrations and their routing controls are no
longer missing. Missing-control rows decrease from 82 to 72. The current
assembled digest is produced by `digestToolDiscoveryDescriptor`; no separate
“manifest-source digest” exists.

## Surface rationalization dispositions

Public tools were retained unless authority, side effects, lifecycle, input
schema, output semantics, discovery reachability, and compatibility obligations
all matched.

| Family | Disposition and reason |
| --- | --- |
| Controlled contracts | Retained as separate public routes. They already share the controlled-contract library, while authoring, assessment, proof, capture, and persistence have different lifecycle, schema, effects, and authority. |
| Code-index relations | Definition, references, callers, callees, context, impact paths, and graph-impact routes remain separate because selectors and output semantics differ. Five `workspace_sidecar_*` compatibility names are explicit alias debt; direct-directory `sidecar_*` routes remain operator-only because their caller-selected directory schema and authority differ. |
| Discovery list/describe/query | Retained separately because browse pagination, targeted detail, and exact selector lookup have different schemas and recovery semantics. They share the existing projection and result-measurement owners. |
| Lint/generate | Retained separately because lint is read-only diagnostics, generation writes derived views, and generate-and-lint composes both effects and outputs. Direct-directory routes remain operator-only; workspace routes use configured aliases. |
| Slice/work-record writes | Retained because each structured mutation owns a distinct field, lifecycle transition, CAS behavior, and output. Shared validation and compact edit projection remain internal owners. |
| Graph-impact operations | Path impact and diff impact retain different input and output contracts. Persistence remains separate because it writes canonical evidence and carries different authority. |
| Evidence refresh | Admission, target resolution, staleness, cleanup, graph impact, and review evidence remain separate because their evidence owner and mutation authority differ. |
| CLI/MCP overlap | Retained where interface, caller-selected paths, workspace-alias resolution, output envelope, or operator compatibility differs. CLI presence does not authorize an MCP route. |

No public tool was removed or merged. Five existing workspace-sidecar names are
now discoverable compatibility aliases and debt. All other reviewed overlaps
are intentionally retained for the reasons above.

## Decision gap

No adopted vocabulary expresses “live but deprecated.” This implementation does
not invent a lifecycle or support state. A future deprecation or alias-retirement
protocol requires an adopted decision naming the vocabulary owner, discovery
semantics, compatibility obligations, retirement evidence, and authority for
the transition. The same is true before any non-empty applicability-exception
protocol can be accepted.
