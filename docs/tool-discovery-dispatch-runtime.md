

# Tool Discovery Dispatch Runtime Contract

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the detailed dispatch identity, bootstrap-state, runtime blocker,
and coordination preflight reference for the canonical tool-discovery overview.

## Dispatch Identity And Bootstrap States

`workspace_agent_dispatch_identity_contract` is the read-only MCP
introspection surface that publishes the dispatch identity and bootstrap
review contract. Consumers of `workspace_agent_dispatch` and
`workspace_agent_run_status` must enforce the contract it publishes:

- caller-supplied role identity is not authority; request payload, prompt
  text, ambient env, argv, docs inference, and a caller-asserted
  `claimed_identity.role` carrier are refused before launch decisions
- `human_operator` is the only role kind permitted to launch or resume
  orchestrator sessions; there is no `orchestrator` role on
  `workspace_agent_dispatch`
- bootstrap review state is reported with one of the stable codes
  `bootstrap_exception_active`, `bootstrap_review_missing`,
  `bootstrap_exception_consumed`, or `graph_impact_persistence_unavailable`
- the `graph_impact_required` and `review_evidence_recorded` introspection
  inputs are caller-asserted contract knobs only; they drive the bootstrap
  evaluator's output for the current introspection call and are not proof that
  WK review evidence has been recorded or that graph-impact persistence is
  required for a real WK
- current AI-agent review separation is enforced through role admission,
  scoped tool authority, structured review evidence, and coordinator-owned
  completion; it is not enforced by comparing two authenticated AI-agent
  principals

Reviewer-dispatch availability for the bootstrap-state evaluator is derived
live from the registered MCP tool set: the evaluator flips to
`bootstrap_exception_consumed` the moment `workspace_agent_dispatch` is
registered on the local MCP server, using the same `registeredToolNames`
style as graph-impact persistence.

Tool registration on the MCP server is the dispatch availability boundary for
stdio MCP. There is no launcher-to-MCP registration prelude
or per-connection launcher identity registry in the active dispatch path
(the registration/prelude architecture is gone, not merely disabled); stdio
is treated as a same-user local transport, not an authentication boundary.
The launcher-side run-lifecycle backend is wired so that calls to
`workspace_agent_dispatch` reach dispatch-readiness and, when a launch
executor is configured on the server process, drive a real backend launch
through `createWorkspaceAgentDispatchBackend(...).startLaunch(...)`. The
`backend_unavailable` blocker is therefore reserved for the
genuinely unconfigured case (no launch executor wired into the server
process); discovery may report `workspace_agent_dispatch` and
`workspace_agent_run_status` as registered and recommended, and a configured
server should accept dispatch and report the lifecycle vocabulary
`launching`, `running`, `succeeded`, `failed`, or `cancelled` (the
`pending_launch` state no longer exists). If a future deployment needs
authenticated cross-session dispatch, it must use a different transport or
launcher-owned broker, not a wrapper_command row, inline env policy, bwrap
mount change, graph-impact side channel, registration frame, per-connection
identity registry, or stdio prelude.

Current AI-agent reviewer independence is enforced through role, tool, and
evidence boundaries rather than author/reviewer principal equality. The
authoritative contract is in
[MCP Dispatch Runtime Contract](mcp-dispatch-runtime-contract.md): stdio MCP is
a same-user local transport, and the active launcher does not mint a
human/service principal envelope for each AI-agent role session. Tool discovery
and dispatch identity introspection therefore must not describe hard principal
comparison as an active prerequisite for findings-only reviewer dispatch.

The enforceable current boundary is:

- implementation workers may edit only their assigned `write_scope` and can
  move only their own implementation unit to `review` through the scoped
  commit/submit-for-review path; they cannot complete their own work
- reviewer sessions are findings-only role sessions with `write_scope: []`;
  dispatch-readiness refuses reviewer units whose canonical JSON write scope is
  non-empty with `role_policy_violation` and diagnostic reason
  `reviewer_write_scope_nonempty`
- structured review-evidence routes are part of this boundary: no-findings
  review evidence is recorded through `workspace_record_review_attestation`,
  and changes-requested or other non-completion reviewer/redteam results are
  recorded through `workspace_record_review_result_evidence`
- reviewer output is evidence for coordinator disposition, not authority for
  the reviewer role session to change the reviewed unit to `done`
- the coordinator-owned `review` to `done` transition remains the trusted
  completion boundary after mandatory findings-only review evidence is read and
  dispositioned

Under this model, a worker cannot satisfy the mandatory review gate by
reviewing and closing its own implementation session because the worker role
lacks review completion authority, the reviewer role has no write scope,
review evidence is recorded through structured routes, and completion is
coordinator-owned. work record remains the consumer of review-separation policy,
but its current AI-agent enforcement target is this role/evidence separation.
work record may record trusted commit-path provenance when useful, but that
provenance is not reviewer-independence authority. work record's earlier
principal-envelope prerequisite is superseded for the current AI-agent flow.

Git `author.name`, `author.email`, committer metadata, branch names, `run_id`,
`launch_ref`, retry ids, worktree paths, output branches, monitor handles,
dispatch session ids, generated launch briefs, prompt text, ambient env,
launcher argv visible to a child, request payloads, `claimed_identity`,
work-record prose, slice notes, and runtime artifacts may provide provenance,
debugging context, correlation, or binding evidence. They are not security
authority for AI-agent reviewer independence and must not be promoted into an
author or reviewer principal for the current dispatch flow.

A future authenticated human/service-principal substrate may add hard
principal-envelope comparison on top of the current role/evidence controls. In
that future extension, reviewer and commit-author authority would need
launcher- or transport-minted envelopes that are unforgeable by the MCP request
caller, available before the relevant admission decision, and canonically
comparable without reinterpreting prompt text or work-record prose. That
future-only equality check is meaningful only for authenticated human/service
principals or another adopted principal registry distinct from
run/session/worktree metadata.

The non-MCP role-wrapper `wrapper_command` discovery rows were removed with the
family-role wrapper files; structured discovery no longer advertises
`codex-worker`, `codex-review`, `codex-redteam`, `claude-worker`, or sibling
family entries as tools. `workspace_agent_dispatch` and
`workspace_agent_run_status` carry `audience: ["agent", "operator"]`,
`filterToolDiscoveryTools` accepts an `audience` query, and
`workspace_agent_dispatch` ranks first for `dispatch-worker`,
`dispatch-reviewer`, and `dispatch-redteam`. Discovery output never makes a
non-MCP role route available to agents; agents must route worker/reviewer/redteam dispatch through
`workspace_agent_dispatch` and report `missing_structured_transport` when
it is unavailable.

## Runtime Blocker Taxonomy And Coordination Preflight

A schema-backed runtime blocker taxonomy is published at
`packages/wiki-core/data/runtime-blocker-codes.v1.json`, exposed through the
read-only `workspace_runtime_blocker_taxonomy` MCP tool
(`describe-runtime-blocker-taxonomy` task). The taxonomy is the canonical
code set for orchestrator preflight, dispatch readiness
(`workspace_agent_dispatch`), and launcher diagnostics. The
bootstrap-state codes are a strict subset of this taxonomy;
dispatch-specific consumers must select codes from this taxonomy rather
than inventing ad hoc strings.

The taxonomy categories are: `role_policy`, `caller_identity`,
`work_record_readiness`, `transport`, `backend`, `filesystem`, `validation`,
`route`, `review_transport`, `bootstrap`, `graph_impact`,
`graph_impact_persistence`, and `operator_recovery`. The descriptor's
`graph_impact_state_map` field documents the deterministic graph-impact
degraded-state outcomes: unavailable/errors block with
`graph_impact_unavailable`; stale or rebuild-required without a usable dirty
overlay block with `graph_impact_rebuild_required`; and a dirty worktree
with a usable overlay produces the non-blocking
`graph_impact_degraded_overlay`.

`workspace_coordination_preflight` (`coordination-preflight` task) composes
the coordinator preflight envelope — role, caller/session role, subject,
allowed durable write surfaces, implementation/test edit prohibition, repo
mount writability, docs/ and wiki/ writability, available structured
dispatch and review routes, and any active runtime blockers from the
taxonomy. A fully read-only mount surfaces as `read_only_mount`
(filesystem category), not as `role_policy_violation`; this is the
mandated distinction between orchestrator role boundary and
runtime filesystem facts. Caller-supplied identity carriers are refused
with a stable code at the MCP boundary; `role` and
`caller_session_role` are caller-asserted contract introspection knobs
until launcher-minted identity is wired.
