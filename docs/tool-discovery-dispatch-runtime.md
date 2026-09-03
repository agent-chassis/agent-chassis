
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
launcher-owned in-process runtime, not a wrapper_command row, inline env policy, bwrap
mount change, graph-impact side channel, registration frame, per-connection
identity registry, or stdio prelude.

For hot context compaction in the same backend process,
`workspace_agent_runs_list` gives orchestrator and operator sessions a read-only
view of their visible run handles. Use a returned handle with
`workspace_agent_run_status` or `workspace_agent_run_wait`. The list is not
durable or historically complete and does not provide cold/restart recovery.
After a restart, reviewer/redteam advisory text already returned remains usable;
do not re-dispatch, append, or repair its monitor merely to recover optional
metadata or attestation.
The detailed listing and process-local authority contract is owned by
[Process-local monitoring versus restart-stable receipt authority](mcp-dispatch-managed-run-lifecycle.md#process-local-monitoring-versus-restart-stable-receipt-authority).

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
- the sole non-empty canonical-scope exception is a launcher-owned frozen
  exact-slice review; backend admission re-verifies its context and Git target,
  while the reviewer still launches read-only, and no request field selects it
- `review_purpose` defaults to `standalone`; only structural
  `terminal_whole_wk` can participate in terminal lifecycle review, and it
  carries no authority by itself
- reviewer and redteam output is text-first advisory evidence returned by the
  original `workspace_agent_dispatch` run. Clean or
  findings-bearing results never admit, defer, or veto integration, and reviewer
  completion never calls integration. The orchestrator may disposition comments
  and request the separate `workspace_integrate_committed_slice` operation; that
  request and those dispositions are not policy authorization
- CCE alone owns a configured organization-policy decision for integration. Paid
  tier presence configures no gate and implies no verdict. A configured gate fails
  closed on a missing, unavailable, malformed, unratified, denied, or target-mismatched
  decision; no configured gate follows decision free-substrate behavior and reports
  non-audit posture
- exact-review dispatch is plural: active and historical reviews never block another
  reviewer or policy-allowed redteam for the same committed target; every run has a
  distinct identity and independently retained exact-target receipt
- trusted advisory projection preserves the complete captured text and reports
  schema adherence separately. Clean, findings-bearing, schema-nonadherent,
  absent, and failed shapes have the same automatic lifecycle posture and never
  permit, defer, or veto integration. Old receipt, provenance, and attestation
  fields are inert archival data. Integration is available only through
  the separate structured coordinator continuation, with no raw-Git fallback,
  manual proof injection, request-carried proof, or caller authority carrier
- worker and reviewer concurrency is expected; launcher-minted attempt identity,
  isolated runtime/worktree state, and exact ref/status CAS provide collision safety,
  not singleton lifecycle consumption or historical subject reservations
- exact-slice Claude review binds credentials read-only and produces no writable
  host file/root in launcher-owned bwrap plans; sandbox construction is required
  and fails closed before spawn with no unenforced exact-review fallback; normal
  implementation workers retain their credential-refresh and fallback posture
- exact `changes_requested` findings may reach an explicitly reissued same-slice
  Codex or Claude worker prompt as launcher-owned corrective context; they grant
  no admission, acceptance, relaunch, integration, or scope expansion
- `workspace_agent_dispatch` is the sole callable review route. The coordinator
  reads and dispositions its returned advisory text directly. Ordinary reviews
  report `formal_attestation.requested:false`. A `schema_constrained` canonical
  selected contract requests formal attestation; the same settlement derives and
  durably publishes it or reports why it is unavailable. No second evidence,
  provenance, or attestation append, monitor reauthentication, or replacement
  review is supported
- reviewer output is evidence for coordinator disposition, not authority for
  the reviewer role session to change the reviewed unit to `done`
- the coordinator-owned `review` to `done` transition remains the trusted
  completion boundary after findings-only review text is read and
  dispositioned

Under this model, a worker cannot satisfy the mandatory review gate by
reviewing and closing its own implementation session because the worker role
lacks review completion authority, the reviewer role has no write scope,
review text is returned by the dispatch route, and completion is
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

A future authenticated human/service-principal substrate may add principal
comparison on top of the current role/evidence controls. That is outside the
current agent-role contract. Current launcher and transport carriers provide
correlation, ownership, freshness, replay handling, and cross-session
noninterference; they are not documented as adversarial forgery resistance or
as authenticated human/service principals.

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
degraded-state outcomes. Under the work record current-HEAD ruling the baseline is
rebuilt at the current committed HEAD, so staleness alone is never a blocking
refusal: `graph_state` `unavailable` or `error` blocks with
`graph_impact_unavailable`, `query_error` blocks with
`graph_impact_query_error`, an active dirty-worktree overlay produces the
non-blocking `graph_impact_degraded_overlay`, and every other combination is a
clean proceed.

Taxonomy loading fails closed. Allowed keys are explicit and closed at the
top-level descriptor, the `graph_impact_state_map` object, each graph rule, and
each code entry. Every entry field — required and optional alike — is
shape-validated; an unknown key or malformed `detail`, `consumer_notes`,
`recovery`, `aliases`, `reasons`, or `wk_0532_subset` value refuses the load
before any taxonomy value is accepted. A published taxonomy therefore always
matches its canonical descriptor.

### Producer-to-code state table

Every dispatch refusal is exactly one of two things (decision):

- an **exact returned policy result** — an authenticated Chassis Control Engine
  decision came back, and its verdict, reason facts, returned remediation, and
  decision identity are the answer;
- a **mechanical failure** — no valid authenticated decision exists and
  something in this repository's own runtime failed or was never declared.

Mechanical code selection is owned by one shared classifier,
`packages/wiki-mcp/src/lib/dispatch-tools/runtime-blocker-classifier.mjs`.
Producers detect their own facts and supply bounded detail; they do not keep
local mapping tables. The classifier can only ever build the mechanical limb: it
has no admit/needs_review/reject vocabulary and no threshold arithmetic, and it
refuses a policy-result-shaped input outright rather than reclassifying it.

| Producer fact | Public code | Actor |
| --- | --- | --- |
| Authored or structural WK/slice contract defect, with a named check, status, and path | `work_record_readiness_failure` | coordinator |
| Graph state unavailable / error | `graph_impact_unavailable` | operator |
| Graph query failure, or an unbuildable current-HEAD baseline | `graph_impact_query_error` | operator |
| Missing graph artifact | `graph_impact_artifact_missing` | operator |
| Graph rebuild required | `graph_impact_rebuild_required` | operator |
| Unrecognised graph state | `graph_impact_unknown_state` | operator |
| Graph produced but no trusted envelope persisted | `graph_impact_persistence_unavailable` | operator |
| Carrier/evidence integrity, revalidation, digest drift, private-handoff, or malformed evidence | `worker_admission_carrier_invalid` | coordinator |
| Retained slice delivery not reconciled to the review surface | `managed_slice_tip_reconcile_required` | coordinator |
| Committed review target unresolved or moved | `review_target_unresolved` | coordinator |
| Committed review target has a mismatched trusted binding | `review_target_binding_mismatch` | coordinator |
| Frozen review worktree missing, mis-bound, or not frozen | `frozen_worktree_unavailable` | operator |
| Slice ref unresolvable | `review_target_ref_unresolved` | coordinator |
| Configured CCE unreachable, transport failure, or absent response | `backend_unavailable` | operator |
| Route/request input invalid, or the launch was refused on request shape | `validation_failure` | coordinator |
| Findings-only unit declares a non-empty `write_scope` | `role_policy_violation` | coordinator |
| Missing launcher declaration | `launcher_declaration_missing` | operator |
| Unratified authority binding | `authority_binding_unratified` | operator |
| Malformed, unknown, contradictory, or unauthenticated decision envelope | Exact `decision_envelope_*` identity | none |
| Runtime materialization failure | `runtime_materialization_failed` | operator |

`workspace_agent_dispatch` accepts `reviewed_sha` and `diff_base_sha` together as
an ordinary reviewer/redteam locator. Discovery advertises no bind-target,
attestation, or recovery operation because the pair carries no lifecycle
authority. It is validated and normalized through the same read-only target path
as canonical slice and terminal whole-WK subjects. An incomplete or invalid pair
fails only that call with caller-correctable detail; no persistent recovery state
or WK mutation is created.

`work_record_readiness_failure` appears in exactly one row. Its registered
recovery targets the exact named contract defect, and the classifier refuses to
emit it at all unless the refusal names a non-empty check, status, and path. A
graph, backend, carrier, review-target, launcher, runtime, or CCE failure can no
longer borrow it, so the published recovery can no longer instruct a coordinator
to revise a work record that is not at fault.

`worker_admission_review_threshold_exceeded` is **retired**. All three of its
former producers were downstream of an authenticated CCE `needs_review`
decision — a policy result, never a mechanical failure this repository observes
on its own — and no non-CCE mechanical producer exists. It is absent from the
active taxonomy and from every active dispatch constant and alias, and a
reinstated entry fails taxonomy loading closed.

### Exact CCE result behavior

| CCE state | Dispatch behavior |
| --- | --- |
| Positive launcher-authenticated declaration that no CCE request or backing exists and every carrier is intentionally undeclared | No local admissibility block. A structurally runnable, contained unit proceeds and measured facts stay advisory. Environment absence or caller assertion is insufficient. |
| Partial declaration: at least one CCE authority carrier declared, another missing | Not confirmed absence. Falls through to the admissibility overlay and fails closed there; no request is sent. |
| Authenticated `admit` | Proceeds. |
| Authenticated `needs_review` or `reject` with complete identity, lossless bounded reasons, and valid untruncated returned recovery | Fails closed on the exact-returned-policy limb under `launcher_transition.cce_policy_refused.v1`. The returned verdict, reason facts, remediation, and decision identity cross verbatim; no repository blocker code, threshold conclusion, or substituted split/review/escalation action is generated. |
| Missing launcher declaration | `launcher_declaration_missing`, bounded missing-declaration cause. |
| Configured but unreachable, or an absent response | `backend_unavailable`. |
| Unratified authority binding | `authority_binding_unratified`, bounded unratified cause. |
| Missing, partial, truncated, inconsistent, malformed, unknown, contradictory, or unauthenticated decision envelope | Exact registered decision-envelope or recovery-contract identity; malformed recovery never becomes authenticated `projection_mismatch`. |

An authenticated decision requires the full authentication contract: genuine
Node Engine backing, a real pack envelope, a ratified authority binding carrying
the stable ratified marker, present operator authority-binding evidence, present
request-contract digest evidence, and a recognised effect that agrees with the
interpreted status. A pack-shaped `needs_review` or `reject` that fails any of
those limbs is an unauthenticated envelope, not a returned denial, and fails on
the applicable mechanical limb.

The complete payload additionally requires all decision-identity fields,
lossless bounded reason facts, and valid untruncated CCE-returned recovery when
the verdict requires remediation. These carriers are preserved end to end;
dropping facts, accepting partial identity, or substituting local recovery makes
the envelope mechanically malformed rather than exact policy.

The confirmed no-authority posture is **positive only**. Silence — no
admissibility block at all — is a missing declaration and fails closed. A
caller assertion cannot select it either: the closed authority-input schema
refuses caller-supplied Node Engine authority fields before admission, and the
posture is additionally required to report that it was evaluated from the
local-only config authority with no authenticated request sent and no pack or
Node Engine backing claimed.

The upstream derivation accepts only a capability read from the launcher-owned
prewritten, unlinked inherited authority descriptor, written per server
generation after the launcher has resolved canonical workspace configuration for
that generation. The descriptor is not represented in environment or argv, and
ordinary library validation and MCP registration expose no mint; a standalone
published `wiki-mcp` bin launch inherits no descriptor and fails closed. Its
declaration must be COMPLETE as well as positive: service URL, API key,
worker-admission route, request-contract digest, and worker-admission authority
binding must all be undeclared. A launcher that declared any one of them has
declared CCE authority, so an absent sibling is an operator configuration
shortfall rather than evidence of absence. Missing, malformed, partial, or
caller-authored descriptor payloads, and environment-variable absence alone,
never establish no authority.

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

Managed route registration and effective `structured_dispatch` are distinct.
The route catalog and `dispatch_route_registered` report live MCP registration;
effective dispatch additionally requires the backend's authenticated current-
generation `stdio-mcp-conduit-composition-compatibility.v1` fact to be
`compatible`. The compact and verbose projections expose the same frozen
six-key fact and gate outcome. `incompatible`, `unknown`, `missing_fact`,
`malformed_fact`, `stale_fact`, and `backend_generation_mismatch` all publish
the taxonomy-backed `stdio_mcp_lifecycle_protocol_incompatible` blocker with
recovery to deploy one coherent build and restart the long-lived backend. The
modeled startup identity is preserved rather than collapsed into
`operator_recovery_needed`. Diagnostics do not reconstruct this
authority from route registration, packages, files, environment, or run history.
Only the `structured_dispatch` plane is affected; the other eight managed-
lifecycle planes retain their independently sourced values and blockers.
The fact describes the coherently loaded backend composition, not an executed
server probe. The mandatory per-dispatch readiness exchange remains authoritative
for the separate server process and safely rejects partial or hot deployment
drift after preflight.
