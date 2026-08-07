
# Initiative Status Coordinator Workflow

`workspace_initiative_status` is the adopted compact coordinator action lens for
an initiative or selected work unit. It answers "what durable coordinator action
is pending now?" without replacing the tools that read full work-record
context, validate dispatchability, launch agents, monitor runs, lint the repo,
or mutate work records.

Use `workspace_initiative_status` when discovery reports the route as supported.
When the surface is unavailable, coordinators should use the existing
structured tools directly:
`workspace_work_record_summary`, `workspace_validate_dispatch`,
`workspace_agent_dispatch`, `workspace_agent_run_status`,
`workspace_agent_run_wait`, `workspace_lint_repo`,
`workspace_generate_and_lint`, and the work-record setter routes.

The surface is read-only and advisory. It may rank pending actions and name the
structured tool that should perform the next operation, but it must not perform
that operation itself. It must not dispatch agents, write work records, set
statuses, record closure, run lint, refresh metrics, write graph evidence,
reinterpret Chassis Control Engine or launcher policy, parse closure prose as authority,
or recommend shell commands and raw JSON edits as fallback paths.

## Default Behavior

Use `workspace_initiative_status` when a coordinator needs a bounded
next-action view across an initiative or a single `WK-*` lifecycle:

- For initiative scope, pass `initiative` to scan the initiative frontier and
  return counts, a bounded ranked `top_actions` list, truncation metadata, and a
  progressive-disclosure next step.
- For unit scope, pass `unit` to inspect one `WK-*`, tracker, or slice
  lifecycle as an action lens rather than as another work-record summary.
- When both `initiative` and `unit` are supplied, the tool verifies membership
  before deriving the action lens.

The default output is compact. It should not include full
work-record summaries, slice bodies, acceptance criteria, validation arrays,
docs lists, closure prose, long diagnostics, or raw evidence payloads. Use
explicit verbose or selected-action disclosure only when the compact action row
is insufficient to decide which structured tool to call next.

Compact `top_actions` rows carry only `target_unit`, `reason_code`, and
`suggested_tool`; compact `next_action` uses the same projection, and the other
action fields are available through explicit verbose disclosure. The default
action channel is independently bounded by the requested count (five by
default) and a 1,000-byte pretty-JSON
row budget. `top_actions_total`, `top_actions_returned`, and
`top_actions_truncated` distinguish the complete ranked population from the
returned projection even when the byte budget is reached before the count cap.

For initiative frontier scans, start with `workspace_initiative_status` before
sampling individual `workspace_work_record_summary` results. Use work-record
summaries only for the selected unit or narrow follow-up called for by the
compact status row, not as the first pass across an initiative.

## Consistency Channel

In initiative (scan) scope the response carries a `consistency` array alongside
`counts`, `top_actions`, and `next_action`. It holds low-priority diagnostic
entries — currently `open_slice_under_terminal_parent`: an open slice
(`todo`/`active`/`review`/`blocked`) whose parent record is already terminal
(`done` or `cancelled`).

Such a slice is a record/slice mismatch, not actionable frontier work: the
parent is legitimately closed, so the open slice is excluded from
`top_actions`, `next_action`, and the actionable `counts`. It is not silently
dropped, though — surfacing it here keeps a wrongly-closed parent that still
carries a live wave visible so a coordinator can reconcile the mismatch (mark
the slice terminal, or reopen the parent) without it polluting the actionable
ranker. Each entry carries `record_id`, `slice_id`, `record_status`,
`slice_status`, and `priority: 'low'`, and is deduplicated by
`record_id#slice_id` (one slice can appear in several of a record's slice
arrays). `parked` parents are intentionally out of scope: terminal here means
`done` or `cancelled` only, and an open slice under a parked parent stays in the
actionable units.

Compact consistency rows retain only the mismatch `kind` and deduplicated unit
`address`; record and slice fields derivable from that identity are verbose-only.
The default channel is independently bounded to ten rows and a 600-byte
pretty-JSON row budget. `consistency_total`, `consistency_returned`, and
`consistency_truncated` report the exact complete and returned populations.
Explicit `verbose: true` preserves the complete consistency detail.

The `consistency` array and its metadata are always present in scan mode (empty
and zeroed when there is no mismatch), giving callers a stable contract. In
single-unit mode (`unit` is supplied) they are omitted: that lens is a
frontier-only action view for one selected record/slice and is not authoritative
on initiative-wide actionability.

## Tool Boundaries

Use `workspace_work_record_summary` when the coordinator needs record context:
dependencies, write scope, acceptance, validation, slice state, blockers, review
state, or closure detail. The initiative-status surface can point at a target
unit and reason code, but it is not the full record reader.

Use `workspace_validate_dispatch` when the next possible action is dispatch and
the coordinator needs the authoritative readiness decision for that selected
unit. When the initiative-status layer's non-authoritative derived-evidence scan
hints that admission evidence may be missing, stale, or incomplete, it recommends
this read-only operation for the exact unit. It does not authenticate evidence
carriers or sidecars, import or duplicate the admission-recovery classifier,
label the evidence recoverable, or claim that the unit is dispatchable. It also
does not synthesize malformed, ambiguous, provider-unavailable, integrity, or
other recovery verdicts from the hint.

The structured dispatch-readiness envelope remains the authority after
validation: its result determines whether the coordinator may call
`workspace_agent_dispatch` with `role=worker` or must inspect a typed blocker.
The deprecated `workspace_work_record_refresh_admission_metrics` and
`workspace_work_record_refresh_target_resolution_evidence` operations are not
initiative-status readiness recommendations. `workspace_validate_dispatch`
remains read-only and does not refresh derived evidence.

Use `workspace_agent_dispatch` only after the selected unit is ready for the
intended role. Dispatch remains MCP-only agent authority. If dispatch transport
is missing, report the structured transport blocker instead of invoking role
wrappers, shell commands, or hand-written prompts.

Use `workspace_agent_run_status` or `workspace_agent_run_wait` after dispatch
has returned a server-minted monitor handle. The initiative-status surface may
identify that a run needs monitoring, but run-status owns lifecycle truth for
the launched run.

Use `workspace_lint_repo` or `workspace_generate_and_lint` when the coordinator
needs repo contract diagnostics. Lint output is diagnostic unless the selected
`WK-*` or slice explicitly owns the lint surface in its scope and acceptance
criteria. A pre-existing repo-wide lint finding should be reported as a caveat
or routed to the owning work, not silently absorbed into an unrelated selected
unit's scope.

Use work-record setter tools for actual mutations:
`workspace_work_record_set_status`, `workspace_work_record_set_closure`,
`workspace_work_record_set_task`, `workspace_work_record_set_list_field`,
`workspace_work_record_set_acceptance`, `workspace_work_record_upsert_slice`,
`workspace_work_record_delete_slice`, and
`workspace_work_record_shape_review_unit`. The initiative-status surface may
suggest one of these operations, but the setter route owns
validation-before-write, stale-source protection, advisory closeout lint, and
schema-backed persistence.

## Blocker Handling

Runtime and operator blockers are not WK scope. Missing MCP dispatch transport,
backend unavailability, read-only mounts, stale graph-impact state, missing
operator configuration, and monitor-handle mismatches should be surfaced with
their stable blocker codes and recovery guidance. Do not rewrite the selected
WK's acceptance criteria, write scope, or closure to absorb those environment
facts.

WK-scope blockers are different: ambiguous acceptance criteria, missing
write-scope authority, incomplete review evidence, unresolved medium-or-higher
review findings, or a selected unit that needs a remediation slice belong in the
work-record lifecycle. Initiative status should classify these as coordinator
actions against the appropriate structured record tools, not as runtime
failures.

## Progressive Disclosure

The compact response is the normal coordinator loop. Expand only along the next
necessary boundary:

- read the selected work record with `workspace_work_record_summary` for full
  contract context
- call `workspace_validate_dispatch` for dispatchability
- call `workspace_agent_run_status` for a specific monitor handle
- call lint tools for repo diagnostics
- call setter routes for validated work-record writes
- use initiative-status verbose or selected-action detail only after the route is
  discoverable, and only for the evidence references behind a compact action row

Do not recover from a missing or insufficient compact response by reading raw
work-record JSON, editing JSON by hand, changing spill limits, or falling back
to shell. The recovery path is a narrower structured read, validation, monitor,
lint, dispatch, or setter tool. If the initiative-status route is unavailable
or discovery does not expose it as supported, report the missing structured
surface and use the existing structured tools directly rather than treating
this document as invocation authority.
