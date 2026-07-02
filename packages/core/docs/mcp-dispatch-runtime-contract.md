
# MCP Dispatch Runtime Contract

Detailed MCP dispatch, bootstrap, run monitoring, host-write-authority sidecar,
caller/session identity, runtime blocker taxonomy, and coordination preflight
contract for [MCP Integration](mcp-integration.md).

## Dispatch Identity And Bootstrap Review

`workspace_agent_dispatch` and `workspace_agent_run_status` are the
MCP-only agent role dispatch and monitor surfaces. The identity and bootstrap
contract they enforce lives in
`packages/wiki-core/src/lib/agent-dispatch-identity.mjs` and is surfaced
through the read-only `workspace_agent_dispatch_identity_contract` MCP tool.

Missing `workspace_agent_dispatch` is a structured-transport blocker, not
permission to fall back to non-MCP role wrappers. Agents must not invoke
wrapper commands as an alternate dispatch transport. Operator installation or
debug docs may describe local wrapper inventory, but those wrappers are not
agent dispatch transports.

The contract is binding on `workspace_agent_dispatch`,
`workspace_agent_run_status`, on launcher-side worker plans that consume the
same role identity, and on any future MCP surface that makes a role decision.

### workspace_agent_dispatch And workspace_agent_run_status

`workspace_agent_dispatch` accepts a controlled `role` enum
(`worker`, `reviewer`, `redteam`) and a `subject` string drawn from the
subject-role matrix:

- `worker` and `reviewer` dispatch a `WK-####` or `WK-#####slice` subject
- `redteam` dispatches a `WK-####`, `WK-#####slice`, or `IN-####` subject
- any other role/subject pairing refuses before launch

The role enum is exactly `worker`, `reviewer`, and `redteam`. There is no
`fixup` role; post-review fixes use normal worker slices or follow-up WKs.
There is no `orchestrator` role on `workspace_agent_dispatch`; orchestrator
launch and resume remain human/operator-only entrypoints and cannot be
dispatched through this MCP tool.

Stdio MCP is a same-user local transport and is not an authentication
boundary. There is no launcher-to-MCP registration prelude,
HMAC registration frame, mint bundle, or per-connection identity registry
in the active dispatch path; that architecture is gone, not merely
disabled. A configured stdio `wiki-mcp` process may call
`workspace_agent_dispatch` directly; dispatch is controlled by the MCP tool
being exposed in the current session plus the structured work-record
dispatch-readiness checks below.

Dispatch-readiness feeds the launcher-side run-lifecycle backend.
When a launch executor is configured on the MCP server process (the
backend-adapter module
`packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs`
provides the in-process backend, and the MCP server selects it via the
launcher-owned startup env var `WIKI_MCP_DISPATCH_BACKEND_TEST_FIXTURE` for
test fixtures), accepted dispatch returns a backend-minted `wkdb_`-prefixed
`run_id` and `wkmh_`-prefixed `monitor_handle`, and `workspace_agent_run_status`
reports the controlled lifecycle vocabulary `launching`, `running`,
`succeeded`, `failed`, or `cancelled` (there is no `pending_launch` state).
Executor refusal surfaces as the `validation_failure` blocker;
executor exceptions surface as `operator_recovery_needed`. The `backend_unavailable`
blocker is reserved for the genuinely unconfigured case — no launch executor
wired into the server process — not the normal posture.

Caller-supplied identity carriers (request payload role fields, prompt text,
ambient env, argv role claims, `claimed_identity.role`) remain refused with
the `agent_dispatch_identity.caller_supplied_*` codes before any
launch decision. Those refusals prevent callers from smuggling unsupported
roles or bypassing the role enum. They are not stdio authentication.

For avoidance of doubt, `backend_unavailable` also covers a dead or missing
host-write-authority substrate. In that case the stable reason remains
`host_write_authority_substrate_unavailable`; the host-write section below
spells out the endpoint contract in full.

If authenticated cross-session or multi-user dispatch becomes a requirement,
the correct design is a different transport or launcher-owned broker that
owns connection/session identity. Do not reintroduce a first-line stdio
prelude, inline env policy, shell helper, or Codex `CODEX_HOME` config
rewrite to simulate authentication over stdio.

Reviewer dispatch enforces findings-only `write_scope: []` during MCP dispatch-readiness
by reading the selected slice or work-item write_scope from the canonical
JSON record and refusing non-empty scopes with `role_policy_violation`
plus structured diagnostic context `reason: reviewer_write_scope_nonempty`.
That reason is structured diagnostic context attached to
`role_policy_violation`, not a separate taxonomy code.

When a reviewer dispatch refuses with `reviewer_write_scope_nonempty`, the
selected subject is shaped like implementation work. The recovery is a
coordination change: create or select a separate findings-only review unit
whose `work_kind` is `review`, whose `write_scope` is exactly `[]`, whose
`repo_paths` name the files being inspected, whose `depends_on` points at the
implementation unit, and whose acceptance criteria ask for findings only. Do
not remediate this refusal by changing the requested role, bypassing dispatch
readiness, refreshing graph impact, broadening filesystem authority, invoking a
role wrapper or direct CLI command, adding prompt/env/argv/request carriers, or
editing the implementation inline.

On accepted dispatch the tool returns an opaque server-minted `monitor_handle`
plus `run_id`. Monitor handles are bound to subject, role, the per-server-session
synthetic dispatch identity (`workspace-agent-dispatch-session-identity.v1.<hex>`),
`workspace_alias`, and a server-only provenance digest produced by the
backend-adapter module. Query progress through
`workspace_agent_run_status` only; fabricated handles, cross-subject reuse,
replay, and queries by an unauthorized caller refuse with the
`monitor_handle_unknown`, `monitor_handle_subject_mismatch`,
`monitor_handle_caller_mismatch`, or `monitor_handle_replay` codes. The
controlled run-status vocabulary is `launching`, `running`, `succeeded`,
`failed`, and `cancelled`; `pending_launch` is not a valid state.

All blocker codes emitted by dispatch and run-status are drawn from the union
of the runtime blocker taxonomy and the `IDENTITY_REFUSAL_CODES`
and `BOOTSTRAP_STATE_CODES`. Adding a new code requires updating the canonical
schema in the same change rather than inventing a string at the handler.

There is no shell/wrapper fallback for `workspace_agent_dispatch`. When the
tool is unavailable on the local MCP server, the correct result is the
`missing_structured_transport` blocker, not invocation of an operator-shell
wrapper.

### Host Write Authority Localhost Sidecar Endpoint (initiative)

The `backend_unavailable` blocker in this page is broader than the unconfigured launch-executor case: a dead or missing host-write-authority substrate can also fail closed with `backend_unavailable` and the stable `host_write_authority_substrate_unavailable` reason.

The MCP server consumes the launcher-owned host-write-authority dispatch
sidecar endpoint as startup transport state. This subsection pins how that
endpoint reaches MCP startup; the full operator-facing contract lives in
[docs/agent-launch-quickstart.md](agent-launch-quickstart.md).
This contract covers AUTH-H1 through AUTH-H4. Authority hardening here is
secondary to working structured dispatch and must not introduce a new launch
precondition for the controlled-orchestrator path.

- **Canonical endpoint variable.** MCP startup reads the localhost endpoint
  once, before the MCP transport is wired, from the canonical env var
  `AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT` (value shape `<host>:<port>`,
  host pinned to `127.0.0.1` — a loopback-only invariant; non-loopback hosts are
  refused before listen/connect). The JS constant
  `HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR` is a misleadingly named
  identifier whose value is exactly that string; it is not a second competing
  env var.
- **Launcher-owned, not caller-supplied.** The endpoint and the
  `AGENT_LAUNCH_HOST_WRITE_AUTHORITY_FILE` authority-file path are launcher-owned
  startup state. Caller-supplied prompt, request payload, argv,
  `claimed_identity`, or agent-authored env carriers cannot select or override
  either value.
- **No controlled-orchestrator Unix-socket fallback.** When the endpoint is
  absent, malformed, or unreachable, `resolveHostWriteAuthoritySubstrateAdapter`
  returns no adapter; controlled-orchestrator MCP startup must not fall back to
  the legacy `.local/state` Unix-socket resolver (AUTH-H1). The in-process
  executor then surfaces `backend_unavailable` /
  `host_write_authority_substrate_unavailable`.
- **Dead-sidecar recovery is a runtime blocker, not a readiness probe.** A
  configured-but-dead sidecar is reported only by dispatch/`startLaunch` as
  `backend_unavailable` / `host_write_authority_substrate_unavailable` (AUTH-H4);
  static dispatch-readiness never probes sidecar liveness. Recovery is
  restarting the launcher-owned sidecar — never a wrapper, direct CLI, shell,
  temp worktree, broad bwrap remount, inline env policy, stdio auth prelude,
  connection registry, Unix-socket fallback, or graph-impact launch side
  channel.
- **Kernel-assigned ports; static ports forbidden.** Each orchestrator binds a
  kernel-assigned per-orchestrator loopback endpoint;
  static/fixed ports are forbidden. MCP consumes only its own orchestrator
  session's endpoint and must not discover, cache globally, or reuse a sibling
  session's endpoint. Multiple orchestrators and multiple concurrent workers per
  orchestrator are supported without endpoint, cache, run-id, or monitor-handle
  collisions.
- **Authority file (AUTH-H2).**
  `AGENT_LAUNCH_HOST_WRITE_AUTHORITY_FILE` names a launcher-generated
  per-orchestrator authority file. It is not a standalone launch prerequisite
  unless the touched channel surface already implements it end to end.
- **Operator-shell socket variable.**
  `AGENT_LAUNCH_HOST_WRITE_AUTHORITY_SOCKET` is operator-shell-only and is never
  read by controlled-orchestrator MCP startup.
- **Redaction.** Endpoint and authority-file values are redacted across planner
  output, broker/server logs, channel errors, MCP dispatch responses,
  `final_result` envelopes, structured blocker detail fields, and WK closure /
  attempt-log text.

Remote agent runner distribution and remote endpoint/authority handling are
excluded from the local sidecar endpoint contract.

### Caller/Session Identity

Caller/session role identity authority is **launcher-minted** or
**transport-minted** only. The following sources are explicitly not
authority and are refused before any dispatch decision:

- `request.role`, `request.caller_role`, `request.session_role`,
  `request.agent_role`, or any other caller-supplied request payload field
- `prompt.role` or any role claim embedded in prompt text
- `env.AGENT_ROLE`, `env.AGENT_WK`, or `env.AGENT_OPERATOR_WRITE_SCOPE`
  (these env variables are transport metadata only, never authority)
- `argv.role` or any caller-passed argv claim
- `claimed_identity.role` (a caller-asserted role field, regardless of how it
  is wrapped in the request)
- docs inference

When the dispatch surface receives a request that attaches one of those
carriers, it must refuse with the stable refusal code
`agent_dispatch_identity.caller_supplied_role.v1` (and the carrier-specific
variants for ambient env, request payload, and prompt text) and must not
downgrade the refusal to an accepted decision. The
`workspace_agent_dispatch_identity_contract` MCP introspection tool exposes
`graph_impact_required` and `review_evidence_recorded` as caller-asserted
contract knobs that drive the bootstrap-state evaluator's output for the
current introspection call only; they are NOT proof that WK review evidence
has been recorded or that graph-impact persistence is required for a real
WK. Durable proof of bootstrap review evidence lives in the owning WK
closure.

The controlled vocabulary of caller role kinds is:

- `coordinator`
- `worker`
- `reviewer`
- `redteam`
- `human_operator`
- `unknown`

Human/operator-only orchestrator launch/resume is enforceable from the same
identity model. The dispatch surface refuses orchestrator launch attempts for
any role kind other than `human_operator` with the refusal code
`agent_dispatch_identity.orchestrator_not_operator.v1`. Agents never launch
orchestrators.

## Runtime Blocker Taxonomy And Coordination Preflight

A schema-backed runtime blocker taxonomy is published at
`packages/wiki-core/data/runtime-blocker-codes.v1.json`. The taxonomy is the
canonical code set for orchestrator preflight, dispatch readiness
(`workspace_agent_dispatch`), and launcher diagnostics. The
bootstrap-state codes are a strict subset; dispatch-specific consumers must
select from this taxonomy rather than inventing ad hoc strings.

The taxonomy intentionally separates role policy from runtime
filesystem/transport failures. A fully read-only repository mount is reported
as `read_only_mount` (filesystem category), not as `role_policy_violation`.
Even when orchestrator role policy already restricts writes to `docs/` and
`wiki/`, a failed write to a permitted surface is a filesystem fact that
must be reported with the filesystem code so operators can investigate the
mount or sandbox profile, rather than rewriting WK acceptance to absorb it.

Graph-impact degraded outcomes are deterministic. The taxonomy's
`graph_impact_state_map` maps sub-states to taxonomy codes:

- `graph_state` `unavailable` or `error` → blocking `graph_impact_unavailable`
- `staleness` `stale`, `rebuild_required`, or `missing` without a usable
  dirty worktree overlay → blocking `graph_impact_rebuild_required` (the
  operator must refresh; agents must not rebuild inside a dirty worktree)
- `dirty_state` `dirty_worktree` with `overlay_state` `active` →
  non-blocking `graph_impact_degraded_overlay` (the dispatch result must
  surface the overlay evidence alongside canonical authority)

### MCP Tools

- `workspace_runtime_blocker_taxonomy` — read-only introspection that emits
  the canonical code catalog, categories, the deterministic graph-impact
  state map, and the bootstrap-state subset.
- `workspace_coordination_preflight` — composes the coordinator/orchestrator
  preflight envelope: role, caller/session role, subject, allowed durable
  write surfaces (`docs/`, `wiki/`, `wiki/initiatives/`, `wiki/decisions/`,
  `wiki/issues/`, `wiki/sources/`, `wiki/work-records/`),
  implementation/test edit prohibition, repo mount writability, docs/ and
  wiki/ writability, available structured dispatch and review routes, and
  any active runtime blockers. Caller-supplied identity carriers
  (`request`, `prompt`, `env`, `argv`, `claimed_identity.role`) are refused
  with the stable refusal code at the MCP boundary. The `role` and
  `caller_session_role` inputs are caller-asserted contract introspection
  knobs until launcher-minted identity is wired into dispatch.

Coordinators that discover a blocking preflight entry must stop and report
the stable blocker code rather than implement inline, fall back to shell, or
rewrite the WK to absorb the runtime failure. Coordinators are not
authorized to implement inline; preflight blockers must be cleared by the
operator or by a distinct implementation `WK-*`.
