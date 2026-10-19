
# Initiative Status Coordinator Workflow

Use `workspace_read_wiki` to read an initiative's compact context, then follow
its returned membership and action selections to answer "what durable
coordinator action is pending now?" The connected session's advertised schemas
and exact returned calls define the available route. An initiative lens does
not replace record reads, assessment, launch, observation, mutation or
integration.

The work lens is read-only and advisory. It ranks pending actions and describes
possible next operations without performing them. Reading status does not
launch agents, write records, set statuses, record closure, run diagnostics,
refresh evidence or interpret launcher or Chassis Control Engine policy. A
no-action result is neither lifecycle completion nor approval.

See [MCP Operation Reference](mcp-operation-reference.md) for current operations
and [MCP repository model](mcp-repository-model.md#agent-facing-repository-model)
for repository binding and source ownership.

## Legacy-Named Integration Status

The integration membership view is now a `workspace_read_wiki` selection:
follow the initiative context's returned reference with
`select:{membership:"integration"}`. This heading retains the historical
label; the view is a local coordination inventory, and does not restore
initiative integration branches.

The selected initiative must resolve to a valid canonical initiative JSON
record. Missing, malformed, projection-only or identity-mismatched initiatives
are invalid input, not an empty inventory. Only a valid initiative with no
matching records returns zero members.

Membership comes exclusively from canonical work-record JSON whose `initiative`
scalar equals the selected initiative. Initiative or work-record `related`
arrays and Markdown projections do not add members. `matched_count` under
`sources.work_records` and the sorted `work_records` describe the same complete
population in deterministic work-record ID order. Malformed or unreadable
work-record input prevents a complete census and fails rather than becoming a
partial or empty success. Expected branch labels describe short-lived work
refs, not observations of live Git state.

The view does not implement trusted Git, runtime, lease, worktree, forge,
mergeability, publication or policy observations. Their fields remain explicitly
`unknown`, `not_available` or `not_evaluated`; no caller or environment injection
supplies them. Advertised capabilities and expected branch labels are not
evidence that these facts were observed. Membership grants no integration,
review, merge or lifecycle authority.

## Default Behavior

Start with `workspace_read_wiki` and set `subject` to the actual canonical
initiative ID. The first answer is compact context, not the complete initiative
record or a membership view. Follow its exact returned call with the returned
`reference` and `select:{membership:"work"}` for the advisory action lens, or
`select:{membership:"integration"}` for the membership census. Supply a
selection only with its returned reference, not with `subject`. Do not add a
repository selector or construct a reference.

Work membership scans the initiative frontier and returns counts, a ranked
`top_actions` list, truncation metadata and action-selection calls. It is not a
complete list of members. The reader asks its native status owner for detailed
rows internally, but still returns at most five ranked actions. Respect
`top_actions_total`, `top_actions_returned` and `top_actions_truncated`: a full
selected response does not remove this action-count cap. Public requests accept
no `verbose`, `limit` or action-pagination controls.

Top-level `next_calls` read action detail on the same initiative reference with
an offered `select.action`. Use the exact returned action identity. A
selected work-unit action checks initiative membership and derives that unit's
action lens; it does not rescan the initiative frontier. Read the selected
canonical work-record or slice identity as `workspace_read_wiki`'s `subject`
when its contract context is needed, then follow that context's field or
inventory selections for complete needed content. Do not sample unrelated
record summaries as a substitute for the initiative scan.

A repository with no work-record corpus directory is a fresh empty corpus, not
an error or a request to initialize storage. After a valid initiative resolves,
an absent directory gives the same zero-member counts as an empty one and stays
absent. For a `todo` or `in_progress` initiative with no work, the work lens can
report `allocation_required`. Allocation guidance names `workspace_create_record`
when available and identifies the caller inputs still needed, including a title;
reading that guidance creates nothing. Closed or inactive initiatives retain a
no-action result.

Only initial `ENOENT` for the exact corpus directory means an empty corpus.
Non-directory paths, permission or I/O failures, malformed records and a source
that disappears after enumeration remain read failures. The initiative itself
must first pass canonical identity and record validation; traversal-shaped,
mistyped, missing, malformed and identity-mismatched subjects do not acquire
zero-member success. Its canonical loader owns grammar, contained paths,
identity equality and failure classification.

The action and runtime-blocker taxonomies are package-owned vocabularies in
`@agent-chassis/wiki-core`. They resolve from that package's location. A consuming
repository needs no copy, and ordinary empty-corpus behavior needs no injected
taxonomy.

## Consistency Channel

Work membership's initiative scan includes a `consistency` array alongside the
counts and actions. The current diagnostic, `open_slice_under_terminal_parent`,
identifies an open slice (`todo`, `active`, `review` or `blocked`) under a
`done` or `cancelled` parent. Those slices are excluded from actionable counts,
`top_actions` and `next_action`, while the diagnostic keeps the mismatch visible
for coordinator judgment.

Each diagnostic carries `record_id`, `slice_id`, `record_status`, `slice_status`
and low priority, deduplicated by the record/slice identity. An open slice under
a `parked` parent remains in the actionable population: terminal here means
only `done` or `cancelled`.

The reader's scan includes the owner's detailed consistency population with
`consistency_total`, `consistency_returned` and `consistency_truncated`, including
an empty array and zero counts when no mismatch exists. Native compact row and
byte budgets are not public request controls. A selected work-unit action omits
this channel and is not authoritative for initiative-wide actionability. A
non-unit allocation action also carries no consistency population.

## Tool Boundaries

Action rows have their own `guidance` and `next_calls`. These differ from the
top-level calls that select action detail. Guidance distinguishes
`action_available`, `missing_inputs`, `capability_unavailable` and `no_action`.
An offered information-acquisition read can help obtain context; it does not
perform a missing write, satisfy missing caller inputs or restore an unavailable
capability. Saved free text and native recommendation labels are not invocation
authority. Use only currently advertised operations with compatible schemas.

- Use `workspace_read_wiki` for selected record context and complete field,
  entry or inventory content. Follow an offered integrity selection for relevant
  read-only diagnostics when available.
- Use `workspace_assess_contract` for a prospective assessment of the selected
  unit's authored facts, currentness and routes. Assessment executes no proofs,
  grants no permission and refreshes no evidence. A derived-evidence hint in
  the action lens is not an authenticated readiness or recovery verdict.
- Use `start_agent` to start a canonical subject. It performs current readiness
  and launch checks; an earlier assessment neither replaces those checks nor
  imposes a mandatory pre-call. Follow its precise refusal or returned calls.
- Use `get_run_result` to observe the exact returned subject and attempt. An
  optional `timeout_ms` requests bounded observation. Reading a result does not
  launch, settle, rerun or integrate work; see
  [monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).
- Use `save_record` for authored changes to a selected unit with its current
  revision. Missing `revision` or `changes` requires obtaining current context
  and authoring the change. Maintenance and closeout diagnostics are separate
  from mutation effects and do not widen the selected unit's scope.
- Use `integrate_work` only with an exact returned delivery reference. An
  initiative reference, action, subject or commit is not that delivery locator.
  Membership, observation and saving a disposition do not integrate work; see
  [slice integration](mcp-dispatch-slice-integration.md).

The [operation reference](mcp-operation-reference.md#operations) owns these
request boundaries. An action recommendation is advisory, not a new policy or
automatic lifecycle prerequisite. Existing diagnostics outside the selected
unit's scope remain caveats or work for their owner.

## Blocker Handling

Runtime and operator blockers are not work-contract scope. Missing transport,
backend unavailability, read-only mounts, unavailable capabilities, stale
evidence, missing operator configuration and attempt-selection mismatches must
retain their supplied causes, stable codes and supported recovery. Do not rewrite
acceptance criteria, write scope or closure to absorb environment facts.

Work-contract blockers concern the saved unit's meaning and obligations, such
as ambiguous acceptance, missing write scope or unresolved review disposition.
Address them through the appropriate structured record operations within the
unit's authorized scope. Neither kind of blocker establishes an additional
automatic launch or lifecycle gate in this page.

## Progressive Disclosure

The coordinator reading route is initiative context, returned work membership,
returned action selection, then the selected work-record context and complete
needed fields or inventories. Integration membership is a separate selection
from the same initiative context for the canonical member census. Neither view
supplies execution evidence or performs an operation it recommends.

Follow the owning operation's exact returned calls for assessment, launch,
observation, mutation or integration. If a source moves, a route refuses or a
capability is unavailable, report the exact supplied cause and supported
recovery. Do not turn a missing route or insufficient answer into permission to
use retired aliases, shell substitutes, raw record edits or invented references.
Acquiring information grants no proof, permission or completion credit.
