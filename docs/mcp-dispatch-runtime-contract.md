
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

### Dispatch-Owned Admission Evidence Recovery

Only explicit `workspace_agent_dispatch` launch intent with `role=worker` may
automatically mutate recoverable derived evidence. `workspace_validate_dispatch`,
readiness projections, summaries, and reviewer/redteam dispatch are read-only.
A fresh worker dispatch performs no canonical-record, admission-sidecar, or graph
write. There is no coordinator-facing carrier-preparation API and no manual
refresh prerequisite.

Public readiness exposes a digest-free `recovery` object for `graph_impact`,
`admission_metrics`, and `target_resolution`. Each value is one of
`not_required`, `fresh`, `recoverable_missing`, `recoverable_stale`,
`recoverable_outdated`, `nonrecoverable_integrity_failure`,
`nonrecoverable_ambiguous`, `nonrecoverable_missing_paths`,
`nonrecoverable_provider_unavailable`, or `nonrecoverable_malformed`. Dispatch
uses these typed values directly; it does not parse prose or Node Engine reason
strings to decide whether a write is allowed.

Recovery is bounded and straight-line: strict readiness/integrity classification;
at most one graph recovery; canonical reload and structural recheck; at most one
admission/target-resolution recovery; reload and recheck; exactly one configured
Node Engine evaluation or launcher-confirmed `local_only_fail_open` posture check;
one final freshness/integrity revalidation; then at most one backend handoff.
Graph recovery runs first because graph persistence can rematerialize admission
evidence. Graph mutation remains limited to the existing required, graph-bearing,
available, stale, active dirty-overlay, no-unavailable-subject-path predicate.
All other graph states retain the runtime-blocker taxonomy mapping or the
non-mutating degraded-overlay proceed behavior.

Referenced admission sidecars are authenticated from exact bytes, parsed,
identity/source-bound, and evaluated before stale/outdated recovery is considered.
A missing or corrupt referenced sidecar is an integrity failure and permits no
recovery write; only true entry absence can be `recoverable_missing`.

Worker launch validation carries three values only in a server-private handoff:
the authored-source digest, the full persistence-snapshot digest (including
derived evidence and projections), and the reviewed-unit digest. After Node Engine
or posture evaluation, dispatch compares them in that order, then revalidates
exact sidecar bytes and attestation identity/source binding. Authored-source drift
maps to `worker_admission_carrier_invalid` /
`canonical_source_digest_changed`; every source-stable carrier, snapshot,
reviewed-unit, sidecar, or attestation failure maps to
`worker_admission_carrier_invalid` /
`canonical_carrier_revalidation_failed` with bounded typed detail. The private
values are discarded before MCP response or backend handoff and never appear in
public readiness, diagnostics, logs, backend arguments, or worker carriers.

Configured Node Engine tiers require a ratified pack-backed `admit`.
Launcher-derived `local_only_fail_open` is the sole positive confirmed-no-Node-
Engine posture. Absent enforcement, configured unavailability, unratified or
malformed results, `needs_review`, reject, and unknown outcomes fail closed.
The public dispatch schema is strict and accepts no caller-selected Node Engine
configuration, classification, disposition, posture, or fail-open field.

This dispatch/backend admission decision is the single admissibility authority
(work record). The host-write-authority broker downstream does **not** re-evaluate worker
admissibility: it trusts the CCE admit rendered here and acts as a trusted executor
(provision → plan → spawn, with frozen-`write_scope` enforcement on the closed-input
commit). It renders no admissibility verdict, loads no canonical record for admission,
computes no admission digest, and performs no CCE re-consult on the launch path. The
host-write transport is the trust boundary. This retires the broker's former
independent re-consult (work record/work record) and moots the broker's admission-carrier
canonical re-read (work record); an optional signed admit the broker could positively
verify is future hardening (work record), not built here. The digest/carrier
integrity checks described above remain in force where they belong — on this
dispatch/backend path.

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

### Managed Provisioning Carrier On The Host-Write Wire (work record)

Managed dispatch resolves two distinct roots: the launcher-authority root (the
launcher-minted canonical `mainRepo`, the trusted source for the launcher registry,
verifier, nonce/runtime state, canonical work-record loading, and dispatch
validation) and the worker-execution root (the disposable sparse worktree that is
the worker `cwd` and exact `R union W` boundary). The
[filesystem-MCP backends](agent-launch-filesystem-mcp-backends.md) page defines that
separation; this section covers how the broker path obtains the launcher-authority
root.

For the in-process path the composition binds the source-tool-surface preparer's
trusted launcher-authority root directly to the provisioning configuration's
`mainRepo`. The host-write broker path runs in a separate process and previously had
no way to learn that root, so it re-resolved the launcher registry from the worker
worktree and refused every managed worker. The launcher-owned
`managed-worktree-binding.v1` provisioning carrier now crosses the existing sanitized
host-write launch-input wire as a validated frozen carrier so the broker re-derives
launcher authority from the same launcher-minted `main_repo`:

- **Whitelisted, launcher-owned.** `worktree_provisioning` is an optional launch-input
  field admitted through the existing generic allowlist copier. It is
  launcher/server-side context, never worker prompt/request/env/argv/claimed-identity
  authority. Its absence never blocks delegation; a genuinely absent carrier for a
  managed worker is refused downstream by the managed-commit gate, not on the wire.
- **Frozen, exact-schema, lossless.** The channel requires the carrier to be a
  complete, exact-schema, launcher-frozen, internally-consistent
  `managed-worktree-binding.v1` object before serialization, proves it survives JSON
  transport unchanged, and deeply refreezes it (and its nested bindings) after
  parsing. The channel never reconstructs the carrier from request content.
- **Pre-preparation attempt binding.** Before the broker performs any
  launcher-authority side effect (source-surface preparer invocation, and therefore
  registry access, backend proof, nonce/runtime-state creation, or child
  planning/spawn), it proves the restored carrier belongs to the current attempt:
  worker role and exact subject; `workspace_dir` is **present** and equals
  `provisioning.worktree_path` (a missing, null, or empty `workspace_dir` refuses with
  zero topology derivation, source preparation, planning, or spawn);
  `monitor_handle`, `run_id`, and `retry_id` agree with the nested slice binding
  (`launch_ref`, `run_id`, `retry_id`); `run_authority` is present and consistent; the
  scope authority agrees; and the nested slice-binding identity agrees. A missing,
  mutable, partial, extended, stale, replayed, lossy, mismatched, or caller-carried
  carrier refuses before any of those side effects.
- **No caller-carried Git-binding aliases (work record).** The former
  caller-carried `provisionedWorktreeGitBinding` / `provisioned_worktree_git_binding`
  launch-input fields are **deleted** — not retained behind a compatibility mirror — from
  the host-write allowlist, the envelope sanitizer, and the broker-channel presence and
  agreement requirement. A launch input carrying either spelling refuses as a non-schema
  field before serialization; no silent ignore. The exact nested `wk_binding` and
  `slice_binding` field sets are enforced at the channel so a removed alias cannot
  re-enter through a nested binding. The launcher-owned `worktree_provisioning` carrier
  remains the sole managed-authority carrier on the wire.
- **Trusted-side topology derivation.** Only after the wire exact-schema/freeze/losslessness
  proofs and the pre-preparation attempt binding succeed, the linked-worktree Git topology
  (`worktreePath`, `gitDir`, `mainGitDir`, `gitPointerFile`) is derived at the trusted broker
  plan-launch boundary exclusively from the validated carrier's `main_repo` and
  `worktree_path`, matching the launcher's own `provisionedWorktreeGitIdentity` derivation,
  and frozen before it reaches the downstream planning/isolation seams. It is never derived
  from caller input, environment, cwd, or worktree content.
- **Trusted root only after binding.** Only after the attempt binding succeeds does
  broker re-derivation trust `provisioning.main_repo` as the launcher-authority root
  for source-tool-surface preparation. This resolves authority root only; it changes
  no realpath/symlink path policy.

### Initial Provisioning Routing: Direct-Local Versus Broker-Host (work record)

The INITIAL (`retry_id === 0`) managed-worktree provisioning step
(`provisionManagedWorktreesAtDispatch`, which runs `git worktree add`) selects
one of two composition paths, chosen by launcher-owned startup state only:

- **Direct / writable-host composition.** When no launcher-owned host-write
  sidecar endpoint is configured (`AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT`
  absent), `buildDispatchRuntime` attaches no host provisioning adapter and the
  dispatch backend runs the existing in-process local provisioner unchanged. This
  is correct wherever the MCP process can already write the repo `.git`.
- **Controlled-orchestrator / broker-host composition.** When the endpoint is
  configured, `buildDispatchRuntime` resolves a launcher-owned provisioning
  adapter and attaches it to the provisioning config. The backend then requests
  the initial provisioning across the host-write broker (see the
  [host-write-authority sidecar](agent-launch-host-write-authority-sidecar.md)
  page), so `git worktree add` runs from the writable host namespace instead of
  the read-only orchestrator MCP namespace. The endpoint is launcher-owned
  startup state read once before the MCP transport is wired; it is never selected
  by prompt, request payload, argv, claimed identity, or agent-authored env.

The routing is gated purely on whether the launcher-owned adapter is configured;
caller input cannot select the provisioning mode or the canonical roots. Only the
initial attempt is routed — `retry_id > 0` reissue keeps the existing local path
and its bounded retry hardening is owned by work record. A missing/unavailable broker
or a malformed, extended, mismatched, or lossy returned carrier fails the managed
dispatch closed before the backend records a binding, plans, or spawns the
worker; the backend then feeds the validated, deep-frozen carrier unchanged into
the existing `start_launch` path.

### Managed Worker Closed-Input Commit Delegation (work record)

A managed implementation worker delivers its slice through the closed-input
`commit` MCP tool in its confined, Git-less stdio wiki-MCP child. Because that
child cannot run `git`, the commit is delegated to the writable host-write broker
over the existing sidecar transport (MCP stays stdio-only, decision). The routing
is gated purely on launcher-owned configuration:

- **Endpoint projection is worker-and-managed only.** The launcher projects the
  host-write endpoint into the worker's stdio wiki-MCP child config (a Codex
  `-c mcp_servers.wiki.env.AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT` override)
  ONLY when the worker carries the commit tuple. The endpoint value is threaded as
  launch context from the sidecar-bound broker through the Codex worker
  plan-launch — never on the host-write wire and never inside `launch_input`.
  Reviewer, redteam, orchestrator, direct/unmanaged, Claude, Agy,
  configured-command, and configured-URL paths receive no endpoint and gain no
  commit authority.
- **Delegate iff the endpoint is present.** When the endpoint env var is present
  in the worker's MCP child and the credential is the launcher-minted
  identity-store tuple, the `commit` tool sends a `commit_slice` request carrying
  only `{ assigned_unit, launch_ref, run_id, retry_id }` and runs NO Git in the
  confined process. When absent (unmanaged/direct/legacy), the existing in-process
  commit pipeline runs unchanged.
- **Broker owns roots + primitives.** The broker resolves its canonical commit
  root from launcher-owned production composition (the same `mainRepo` used for
  provisioning), independently resolves and verifies the exact frozen slice
  binding server-side, and runs the existing content-inert materialize / scope /
  slice-ref CAS primitives. Caller input cannot select the repo, worktree, ref,
  branch, base SHA, write_scope, message, or mode. A malformed request, a
  stale/mismatched/absent binding, a write-scope containment failure, an
  unavailable commit host, or a malformed/lossy result fails the commit closed
  with a structured refusal — never a false success and never a Git fallback.
  Successful delivery advances only the exact slice ref; trusted runtime retains
  slice-to-WK integration and whole-WK review freezing.

### Delegated Post-Terminal Slice-to-WK Integration (work record)

After the managed worker terminates, trusted runtime integrates its committed slice
into the parent WK branch. That integration runs `git` (stale-base rebase, ff-only WK
advancement, persistent full-WK-worktree advance) and a canonical review-freeze status
write, none of which succeed inside the read-only orchestrator wiki-MCP namespace — the
work record canary observed `agent_launch.slice_integration.git_failed.v1` there after the
commit already advanced the slice ref. The integration is therefore delegated to the
writable host-write broker over the existing sidecar transport (MCP stays stdio-only,
decision), as one `integrate_slice` operation returning `slice_integrated` — the third
same-pattern managed-lifecycle write operation alongside `provision_worktree` and
`commit_slice`. See the [host-write-authority sidecar](agent-launch-host-write-authority-sidecar.md)
contract for the operation, trigger, and exactly-once details.

- **Direct-local versus broker-host routing.** `buildDispatchRuntime` resolves a
  launcher-owned integration adapter whenever the host-write sidecar endpoint is
  configured — the same broker-host composition that routes provisioning and commit —
  and threads it into the backend, which supplies it to the post-worker slice
  lifecycle (`runPostWorkerSliceLifecycle`). When the endpoint is absent (a
  direct/writable-host composition), no adapter is attached and the lifecycle keeps
  the existing in-process integration path. The endpoint is launcher-owned startup
  state, never selected by prompt, request payload, argv, claimed identity, or
  agent-authored env.
- **Trusted-runtime-only trigger.** The lifecycle owner delegates only after it
  observes the worker reach terminal outcome succeeded (`status.terminal &&
  status.status === "succeeded"`); the worker has no integrate tool, so the broker
  accepts the same loopback residual as `commit_slice` and adds no trigger credential.
  The request carries only the base run tuple `{ assigned_unit, launch_ref, run_id,
  retry_id }`; the broker derives the `.slice`/`.wk` binding identity and every
  canonical root itself, enforces per-tuple exactly-once with a fail-loud
  `failed_indeterminate` latch, and returns a delegated result with full parity so the
  downstream review-freeze consumer works unchanged. Response-loss / restart recovery
  and retry hardening remain owned by work record and are not absorbed.

### Managed Worker wiki-MCP Runtime Closure (work record / decision)

The closed-input `commit` tool is served by a stdio wiki-MCP child inside the
managed worker's confined, Git-less sparse `R∪W` namespace. That namespace mounts
none of the server runtime, so the child could not start and the sole delivery
surface was unreachable (the work record live canary, run `wkdb_345a805426cd0a64`).
decision authorizes a single additional read-only, launcher-derived runtime
closure in a managed worker's namespace so the server starts in-namespace:

- **Closure members.** Exactly the node interpreter directory; the
  repository-root `node_modules` directory, wholesale read-only (vendored
  third-party code — its transitive import graph is intentionally not
  enumerated); and, for the workspace packages in the wiki-MCP server's real
  import graph (`@agent-chassis/wiki-mcp`, `wiki-core`, `agent-launch-cli`,
  `agent-launch-core`), ONLY their git-tracked source/data/contract/package
  files. Whole-workspace-package-directory binds are FORBIDDEN — a package
  directory can contain ignored runtime state (for example
  `packages/agent-launch-cli/bin/.agent-runs`) carrying live credential aliases.
- **Launcher-derived, fail-closed.** The closure is derived exclusively from
  launcher-owned paths (the launcher-resolved wiki-MCP server module plus Node
  module resolution). No caller input, prompt, environment, or argv can add,
  remove, or retarget a member. An unresolved member fails closed with a
  structured pre-spawn refusal — never a silent widening, hang, or in-child
  import crash treated as success.
- **Read-only delivery infrastructure only.** Every root is read-only. The mount
  is gated strictly on `managedWorkerCommitRequired`; unmanaged workers,
  reviewers, redteam, and orchestrator plans are unchanged. The worker's
  repository WRITE surface stays exactly `write_scope`, the closed-input `commit`
  tool stays the sole delivery capability, and the worker-facing wiki-MCP tool
  profile stays commit-only. The closure refines decision/decision delivery
  infrastructure; it is not a change to the `R∪W` repository-content contract and
  confers no precedent for widening it.
- **Topology.** Every closure root resolves under the launcher-authority root,
  which managed provisioning holds distinct from the worker-execution worktree,
  so no mounted content can ever appear as the worker's commit content. A staged
  self-contained runtime (the closure copied to a launcher-owned directory
  outside the repository) is the tracked hardening successor; the loopback
  broker transport (work record) is governed separately and is unchanged here.

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

### AI-Agent Review Separation

The active local dispatch model enforces AI-agent review separation through
role, tool, write-scope, and evidence controls rather than by comparing two
authenticated AI-agent principals. Stdio MCP is a same-user local transport,
and the current launcher does not mint a human/service principal envelope for
each AI-agent role session. Therefore same-principal comparison is not a
meaningful security boundary for the current AI-agent review flow and is not a
prerequisite for dispatching findings-only reviews.

The current control boundary is:

- implementation workers may edit only their assigned `write_scope` and can
  move only their own implementation unit to `review` through the scoped
  commit/submit-for-review path; they cannot complete their own work
- reviewer sessions are findings-only role sessions with `write_scope: []`;
  dispatch-readiness refuses reviewer units whose canonical JSON write scope is
  non-empty with `role_policy_violation` and diagnostic reason
  `reviewer_write_scope_nonempty`
- structured review-evidence routes are part of this enforceable boundary:
  accepted no-findings review evidence is recorded through
  `workspace_record_review_attestation`, and changes-requested or other
  non-completion reviewer/redteam results are recorded through
  `workspace_record_review_result_evidence`
- reviewer output is evidence for coordinator disposition; it is not a
  role-session authority to change the reviewed unit to `done`
- the coordinator-owned `review` to `done` transition remains the trusted
  completion boundary after mandatory findings-only review evidence is read and
  dispositioned

Under this model, a worker cannot satisfy the mandatory review gate by
reviewing and closing its own implementation session because the worker role
lacks the review completion authority, the reviewer role has no write scope,
and completion is coordinator-owned. The review separation invariant is thus
enforced by independent role admission, empty reviewer write authority,
structured review-evidence recording, and coordinator closure, not by asserting
that the AI-agent reviewer is a different authenticated principal from the
AI-agent author.

Git `author.name`, `author.email`, committer metadata, branch names, `run_id`,
`launch_ref`, retry ids, worktree paths, output branches, monitor handles,
dispatch session ids, generated launch briefs, prompt text, ambient env,
launcher argv visible to a child, request payloads, `claimed_identity`,
work-record prose, slice notes, and runtime artifacts may provide provenance,
debugging context, correlation, or binding evidence. They are not security
authority for AI-agent reviewer independence and must not be promoted into an
author or reviewer principal for the current dispatch flow.

work record, work record, and work record are revised by this role/evidence model. They
are no longer blocked on inventing an AI-agent principal solely to compare
implementation and reviewer sessions in the active local dispatch path.
work record remains the consumer of review-separation policy, but its current
AI-agent enforcement target is role/evidence separation. work record may record
trusted provenance from the commit path when useful, but it must not describe
that provenance as reviewer-independence authority. work record's earlier
principal-envelope prerequisite is superseded for the current AI-agent flow by
this section.

### Future Authenticated Principal Extension

A future authenticated human/service-principal substrate may add hard
principal-envelope comparison on top of the current role/evidence controls. In
that extension, reviewer and commit-author authority would need launcher- or
transport-minted envelopes that are unforgeable by the MCP request caller,
available before the relevant admission decision, and canonically comparable
without reinterpreting prompt text or work-record prose.

That future envelope, if adopted, would carry a stable schema version, a
non-empty opaque principal, a controlled principal kind, a controlled trust
source such as `launcher_minted` or `transport_minted`, opaque mint evidence,
and selected-unit binding semantics. Its equality check would be meaningful
only for authenticated human/service principals or another adopted principal
registry that is distinct from run/session/worktree metadata.

Until such a substrate is accepted and implemented, the following sources are
explicitly not author or reviewer principal authority:

- `workspace_agent_dispatch` request fields, including requested `role`,
  `subject`, free-form metadata, or any request-level reviewer/caller field
- prompt text, instructions, role labels, generated launch briefs, or docs
  inference
- ambient env, launcher argv as seen by the child, or any agent-authored
  env/argv override
- `claimed_identity`, `claimed_identity.role`, or any similarly wrapped
  caller assertion
- work-record title/body/closure prose, slice notes, ad hoc work-record fields,
  or the fact that a unit's `work_kind` is `review`
- git author/name/email, committer metadata, branch names,
  `dispatchSessionIdentity`, `run_id`, `launch_ref`, retry ids, worktree paths,
  output branches, monitor handles, and runtime artifacts

Those values may locate a binding or explain provenance. They must not be
compared as security principals, hashed into substitute principals, or used to
fail or pass AI-agent reviewer independence in the current role/evidence model.

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
