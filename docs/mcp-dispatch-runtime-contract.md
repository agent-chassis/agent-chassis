
# MCP Dispatch Runtime Contract

Detailed MCP dispatch, bootstrap, run monitoring, host-write-authority sidecar,
caller/session identity, runtime blocker taxonomy, and coordination preflight
contract for [MCP Integration](mcp-integration.md).

## Local Trust And Authority Scope

Local dispatch tooling enforces product contracts and preserves diagnostic
evidence; it does not claim security against a hostile same-user actor or a
compromised host process. Stdio MCP is a same-user local transport, not an
authentication boundary, and the checks on this path assume an honest operator
and honest launcher-minted runtime. Their job is to keep an honest dispatch
correct — enforce declared contracts, select canonical inputs, detect drift or
corruption, and fail loud when evidence is missing or inconsistent — not to
withstand a local actor who already controls the account or the process.

The following remain real, load-bearing boundaries and are unchanged by that
scope framing:

- **Node Engine admission authority.** The configured Node Engine is the sole
  admissibility authority; the local gate forwards carrier facts, consumes typed
  verdicts, and never mints, overrides, or launders an admit. Absent,
  unavailable, unratified, `needs_review`, reject, and unknown outcomes fail
  closed.
- **Launcher confinement and write_scope.** `write_scope` plus launcher-owned
  filesystem confinement is the repository mutation boundary; advisory evidence
  such as target resolution never widens it.
- **External authentication.** Credentials to external services (model APIs, the
  Chassis Control Engine) remain genuine authentication boundaries against
  outside parties.
- **Credential and private-carrier redaction.** Endpoint, authority-file, and
  private-handoff values stay redacted across output, logs, blocker detail, and
  closure text so they are not disclosed onward.
- **Integrity refusals.** Carrier correctness and data-integrity checks —
  malformed shapes or counters, duplicate evidence, sidecar integrity failures,
  digest drift, and invalid private handoffs — retain their fail-closed,
  zero-backend refusals as correctness and corruption detection.

These boundaries protect an honest workflow's correctness, credentials, and
declared contracts. They are not represented as protection against a malicious
same-user actor or a compromised host, and nothing on this path should be
described that way. See agent-chassis:work record for the audit behind this
scope framing and agent-chassis:work record for the advisory-evidence
correction it follows.

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
automatically mutate recoverable canonical carrier-derived evidence.
`workspace_validate_dispatch` never mutates the canonical WK, graph-evidence
sidecar, admission sidecar, lifecycle/runtime/dispatch/backend state, or result
evidence. When a selected graph-required unit has a missing or stale graph,
validation resolves the canonical current-HEAD graph and may write only the
ignored code-index graph artifact, its sibling atomic temporary file, and the
advisory build-lock file, plus at most eight exclusively claimed candidate-slot
files named `.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. The shared lock is inspected
before any candidate claim, so an existing persistent lock prevents additional
candidate creation. Candidate slots exist only for the initial absent-lock
publication race: retained slots are never reused, read as authority, deleted,
truncated, renamed, or overwritten, and exhaustion falls back to an independent
atomic build. It never launches an agent or invokes the dispatch backend. Other
readiness projections, summaries, and reviewer/redteam dispatch remain read-only.
There is no coordinator-facing carrier-preparation API and no manual refresh
prerequisite.

Concurrent graph refreshes coalesce only within a single process, and only for
equivalent base builds. A process-local active-build registry — never the
persistent lock pathname — is the sole liveness authority: a follower resolves
only when the leader it captured signals a successful atomic publication, and it
returns exactly the bytes that leader published. A pre-existing artifact, however
fresh and schema-valid, never satisfies a follower. A failed leader and an
exhausted bounded wait both fall through to an independent atomic build, so a
failed rebuild can never be reported as a successful coalesced result. SCIP
builds never coalesce in either direction, because a SCIP overlay depends on
`scipOptions` (tsconfig path, indexer set, custom runner) that the equivalence
key deliberately does not model. Cross-process callers never coalesce at all:
every existing on-disk lock — foreign active, stale, malformed, dead-owner, or
different-anchor — yields bounded advisory evidence and an independent atomic
build. Duplicate cross-process extraction is an accepted cost; correctness comes
from exact artifact validation and atomic publication, never from the lock.

Public readiness exposes a digest-free `recovery` object for `graph_impact`,
`admission_metrics`, and `target_resolution`. Each value is one of
`not_required`, `fresh`, `recoverable_missing`, `recoverable_stale`,
`recoverable_outdated`, `nonrecoverable_integrity_failure`,
`nonrecoverable_ambiguous`, `nonrecoverable_missing_paths`,
`nonrecoverable_provider_unavailable`, or `nonrecoverable_malformed`. Dispatch
uses these typed values directly; it does not parse prose or Node Engine reason
strings to decide whether a write is allowed.

For the `target_resolution` axis, recovery describes the freshness and structural
usability of the admission carrier, not whether every declared target resolved.
Target resolution is advisory bounded-edit/planning evidence — not a permission
check, a file-type authorization system, a malicious-actor security boundary, or
proof that a worker may edit a path. A current, schema-valid carrier classifies
`target_resolution` as `fresh` even when its per-target outcomes are unresolved,
ambiguous, or provider-unavailable; those detailed outcomes are preserved
unchanged, stay visible to local review and diagnostics, and are never relabeled
as resolved. The detailed per-target evidence is Portfolio-local planning/review
evidence only: per decision it is never forwarded to the Node Engine, which
receives and consumes only the established bounded carrier facts. Node Engine
remains the sole admission authority over that bounded carrier, and `write_scope`
plus launcher confinement — not target resolution — is the repository mutation
boundary. The local gate still fails closed on carrier correctness and data
integrity (malformed counters or shapes, duplicate evidence, sidecar integrity
failures, digest drift, and invalid private handoffs), which retain their
zero-backend refusals. Graph-impact recovery and its separate dirty-overlay rules
are unchanged.

Target resolution requires no SCIP service: no structural index is consulted, and
a runtime that reports `scip_not_configured` changes nothing. The no-SCIP,
unresolved, ambiguous, unsupported, provider_unavailable, and create/not_applicable
per-target outcomes are all visible advisory planning/review evidence; none is a
local file-type permission or dispatch gate. The absent-versus-declared
distinction is preserved: a genuinely absent target plan on an existing code
surface may still produce the bounded missing-plan review signal, while a declared
schema-valid plan is not relabeled as absent — and is not blocked — merely because
no target resolved. Per decision, the detailed per-target paths, names, providers,
spans, reasons, statuses, and resolver evidence stay portfolio-local; only the
established bounded carrier facts cross to the Node Engine, which remains the sole
admission authority under decision and decision and receives and consumes no
detailed target evidence. This advisory-evidence behavior changes no managed-launch
lifecycle step and no Node Engine (CCE) evaluation call.

Recovery is bounded and straight-line: strict readiness/integrity classification;
at most one graph recovery; canonical reload and structural recheck; at most one
admission/target-resolution recovery; reload and recheck; exactly one configured
Node Engine evaluation or launcher-confirmed `local_only_fail_open` posture check;
one final freshness/integrity revalidation; then at most one backend handoff.
Graph recovery runs first because graph persistence can rematerialize admission
evidence. The single graph derivation rebuilds the base at the current committed
HEAD and merges a valid dirty-worktree overlay when one is available; a missing
or unusable overlay falls back to the current-HEAD base without a pre-CCE graph
refusal, and persisted evidence anchored to an older base is rebuilt rather than
consumed. Only a genuine inability to produce or validate the current-HEAD
baseline retains a runtime-blocker taxonomy mapping with a zero-backend refusal;
every other graph state proceeds to exactly one CCE evaluation on the current-HEAD
carrier facts.

Public `workspace_validate_dispatch` uses that same canonical
`resolveCurrentGraphForImpact` production path exactly once per graph-required
validation pass. A missing or stale ignored cache is rebuilt and atomically
published before post-refresh readiness is returned; a valid dirty overlay is
merged all-or-nothing. Only a typed current-HEAD production failure remains a
graph refusal. The cache lock is advisory and never graph correctness authority.
Validation performs no worker launch, backend handoff, canonical evidence write,
admission write, lifecycle transition, or runtime-result mutation.
That refusal preserves a bounded `graph_impact_failure` envelope in verbose
readiness (including `graph_head_moved_unstable` when the retry budget is
exhausted); compact output carries `graph_impact_failure_code` and the same safe
remediation as `next_action`. Raw exception causes and filesystem details are not
forwarded.

The graph baseline for blast-radius and cluster carrier facts is derived from
the current committed HEAD (agent-chassis:work record). The current-HEAD base
is built from committed tree objects, so it is dirty-safe by construction. A
persisted graph ref or index anchored to an older commit is never consumed as
current evidence; it is rebuilt at current HEAD. A dirty-worktree overlay is
optional best-effort enrichment: when it is available and valid it is merged over
the current-HEAD base, and when it is missing, stale, unavailable, unparseable,
or query-failed the derivation falls back to the current-HEAD base without a
graph-availability refusal. Persisted graph refs and sidecars are cache and
planning evidence, not launch permission — missing, stale, malformed, wrong-unit,
digest-invalid, or corrupt persisted evidence is rejected as evidence and
replaced by the current-HEAD derivation rather than independently refusing
dispatch. Cache integrity is never treated as launch permission.

A `requires_graph_impact` unit with no graph-bearing subject paths is a
structural readiness failure that performs zero derivation attempts and surfaces
the generic `work_record_readiness_failure` blocker code (the graph
`readiness_decision_code` is preserved in the refusal detail), never a
graph-availability blocker code. Matching evidence whose `graph_state` claims
`graph_available:true` but is structurally incomplete (missing
`edge_source`/`dirty_graph_mode`/`graph_schema_version`) normalizes to
unavailable and is never laundered into consumed graph evidence; the derivation
falls back to the current-HEAD base. Only inability to produce or validate the
current-HEAD baseline itself is a genuine graph-production failure: it continues
to carry its canonical runtime-blocker taxonomy code with a zero-backend refusal
and its exact diagnostic state preserved, and dispatch does not fabricate
graph-derived carrier facts in that case.

The Node Engine (CCE) receives only the bounded `cluster_count` and
`blast_radius_severity` summaries derived from this current-HEAD baseline
(optionally enriched by a valid dirty overlay). It never receives raw graph
nodes, edges, paths, freshness, provider details, or sidecar contents. CCE
remains the sole admissibility authority, and dirty-overlay availability or
quality is never an admissibility prerequisite.

This current-HEAD-baseline / optional-overlay rule is the authoritative
2026-07-18 operator ruling recorded on agent-chassis:work record. Its
current-HEAD derivation and advisory-fallback implementation are owned by
work record. decision records the operator update and ratification of this
current-HEAD-baseline / optional-overlay rule on 2026-07-18
(`ratified: 2026-07-18`); this contract page consumes the ratified decision and
does not itself edit decision authority.

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
validation) and the worker-execution root (the disposable per-slice worktree that
is the worker `cwd` and exact `R union W` boundary, confined by bwrap; its checkout
density — legacy `v1` sparse-cone or decision `v2` full — is launcher-owned and
never caller-selectable, and does not change that boundary). The
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
  (`launch_ref`, `run_id`, `retry_id`); the
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

### Deterministic Provisioning Routing: Direct-Local Versus Broker-Host (work record, work record)

The governing provisioning operation is **ensure the deterministic slice
checkout and continue from its current slice branch state**. The WK branch
`wk/IN/WK` and its persistent WK worktree are WK-level resources. The
deterministic slice branch and slice worktree are separate slice-level resources.
After the independent one-live-worker admission decision, every accepted
exact-slice dispatch performs the same slice ensure operation. `retry_id`,
process-local attempt history, retained bindings, failure classification, and why
a previous worker stopped do not select a different provisioning algorithm.

The slice-resource matrix is exhaustive and fail-loud:

- missing slice branch + missing slice worktree: resolve the current WK branch
  tip once, create the slice branch at that tip, and create its v2/full slice
  worktree;
- existing slice branch + missing slice worktree: check out that exact existing
  slice branch without resolving or comparing the WK branch tip;
- existing slice branch + correctly-associated clean full slice worktree: reuse
  both slice resources at the slice branch's exact current tip;
- missing slice branch + present slice worktree path, wrong association,
  malformed Git state, physical sparse/v1 checkout, or staged, unstaged, or
  untracked content: refuse before worker launch or destructive mutation.

The current WK branch tip is creation-only input for a missing slice branch. Once
the slice branch exists, its current tip and commits are durable authority; the
persistent WK worktree, a later WK branch tip, another slice, historical binding
evidence, and retry identity neither validate nor reject continuation. The slice
worktree is a reconstructible view. Provisioning never uses `git worktree add
-B`, branch reset, `reset --hard`, or force recreation.

The host on which that operation runs is selected by launcher-owned startup
state only:

- **Direct / writable-host composition.** When no launcher-owned host-write
  sidecar endpoint is configured (`AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT`
  absent), `buildDispatchRuntime` attaches no host provisioning adapter and the
  dispatch backend runs the in-process provisioner. This is correct wherever the
  MCP process can already write the repo `.git`.
- **Controlled-orchestrator / broker-host composition.** When the endpoint is
  configured, `buildDispatchRuntime` resolves a launcher-owned provisioning
  adapter and attaches it to the provisioning config. The backend requests
  provisioning across the host-write broker (see the
  [host-write-authority sidecar](agent-launch-host-write-authority-sidecar.md)
  page), so `git worktree add` runs from the writable host namespace instead of
  the read-only orchestrator MCP namespace. The endpoint is launcher-owned
  startup state read once before the MCP transport is wired; it is never selected
  by prompt, request payload, argv, claimed identity, or agent-authored env.

Caller input cannot select the provisioning host or canonical roots. With the
host-write provisioning adapter configured, every accepted non-negative
`retry_id` reaches the broker-host ensure operation. Without the adapter, every
retry reaches the direct writable-host ensure operation. The exact retry identity
is preserved and checked across request, broker invocation, provisioner result,
response carrier, and current attempt binding; it is correlation and binding
evidence, never a routing or allocator selector.

Same-unit liveness is a separate pre-provisioning admission gate: live or
indeterminate prior state refuses before the ensure operation, while terminal
prior state permits it. Git resources, bindings, retries, and failure history are
not liveness evidence. A missing/unavailable broker or a malformed, extended,
mismatched, or lossy returned carrier fails managed dispatch closed before the
backend records a binding, plans, or spawns the worker.

Ensure compensation records created-versus-reused slice resources out of band
and removes only resources created by that transaction before result publication.
It preserves reused slice resources, persistent WK resources, and existing
commits. Lost responses, broker restart after publication, and spawn/registration
ambiguity remain work record/work record concerns rather than alternate ordinary
continuation algorithms.

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

### Post-Terminal Exact-Slice Review-Surface Preparation (work record)

The closed-input commit primitive deliberately materializes its commit through a
disposable `GIT_INDEX_FILE`. The commit object and exact slice ref therefore move
without mutating the linked worktree's ordinary index. Immediately after delivery,
the retained full slice checkout has an intentional intermediate state: symbolic
`HEAD`, the slice ref, the reviewed commit, and the physical files name/materialize
the reviewed result, while the ordinary index still names the launcher-bound base
tree. That intermediate state is correct for worker delivery but is not a valid
review surface.

After trusted runtime has confirmed worker termination, and before it changes the
slice to `review`, freezes or binds slice-review context, launches a reviewer, or
integrates the slice, it invokes the separate closed host operation
`prepare_slice_review_surface`. The request is exactly `{ assigned_unit,
launch_ref, run_id, retry_id }`. It carries no repository/worktree path, ref, SHA,
tree, binding/digest, write scope, command/Git arguments, tier/mode, evidence,
Proof A, or cleanup authority. The writable host independently resolves the exact
v2/full binding and its digest from the launcher tuple, the canonical registered
linked worktree, slice ref, base commit, and reviewed commit/parent/tree. Legacy,
sparse, detached, moved, missing, malformed, or mismatched state refuses before
ordinary-index mutation.

Before correction, the host refuses an existing index lock; sparse-directory,
skip-worktree, or assume-unchanged entries; unexpected tracked, untracked, or
ignored physical content; and any ordinary index tree other than the expected base
tree or the already-current reviewed tree. Physical checkout measurement uses an
isolated temporary index and temporary object-write directory, with the canonical
object store read-only through Git alternates, so a refused measurement does not
pollute the retained ordinary index or canonical object store. When the ordinary
index is at base, the only correction is `git read-tree <reviewed-sha>` in the exact
linked-worktree Git context with `GIT_INDEX_FILE` unset. Preparation never uses
reset, checkout, restore, clean, ref/branch mutation, worktree recreation, or a
physical-file write, and it never removes an existing lock. An already-current
reviewed index is an idempotent no-op success.

After correction, the host re-resolves the binding, registration, symbolic HEAD,
slice ref, and objects; proves HEAD, ordinary-index, and isolated physical trees all
equal the reviewed tree; requires empty cached/worktree diffs and porcelain status;
and verifies index flags remain absent. It also proves the slice ref, all other refs,
`ORIG_HEAD`, worktree registration, and physical tree did not change during the
operation. Its exact JSON-safe result binds the originating tuple, worktree identity
digest, canonical worktree path, slice ref, base/reviewed SHAs, reviewed tree, and a
fixed ordered verification-parts list. The adapter validates the complete result and
binds it back to the originating request. This result is trusted loopback
verification evidence only: it is not cryptographic proof, Proof A, review
acceptance, CCE evidence, or an audit attestation.

Response loss, broker restart, and unknown-handle recovery rerun the same operation
from binding and Git truth. No receipt, caller replay token, durable attestation, or
phase protocol is introduced. Supported launcher lifecycle actors are serialized by
confirmed worker termination and existing role/reviewer admission ordering. This
does not claim atomicity against an arbitrary hostile same-user operator outside the
documented local trust model.

### Delegated Post-Terminal Slice-to-WK Integration (work record)

After the managed worker terminates, trusted runtime integrates its committed slice
into the parent WK branch. That integration runs `git` (stale-base rebase, a pure
`update-ref <ref> <new> <old>` CAS advance of the WK ref) and a canonical review-freeze
status write, none of which succeed inside the read-only orchestrator wiki-MCP
namespace — the
work record canary observed `agent_launch.slice_integration.git_failed.v1` there after the
commit already advanced the slice ref. The integration is therefore delegated to the
writable host-write broker over the existing sidecar transport (MCP stays stdio-only,
decision), as one `integrate_slice` operation returning `slice_integrated` — the third
same-pattern managed-lifecycle write operation alongside `provision_worktree` and
`commit_slice`. See the [host-write-authority sidecar](agent-launch-host-write-authority-sidecar.md)
contract for the operation, trigger, and exactly-once details.

- **Direct-local versus broker-host routing.** `buildDispatchRuntime` resolves a
  launcher-owned integration adapter for BOTH supported compositions and threads it
  into the backend, which supplies it to the post-worker slice lifecycle
  (`runPostWorkerSliceLifecycle`). When the host-write sidecar endpoint is
  configured — the same broker-host composition that routes provisioning and commit —
  the adapter delegates over that transport. When managed provisioning is configured
  and the endpoint is genuinely absent (the direct writable-host composition), the
  launcher composes a DIRECT integration adapter instead. The endpoint is
  launcher-owned startup state, never selected by prompt, request payload, argv,
  claimed identity, or agent-authored env.
- **One integration and reap implementation, two evidence modes.** The direct adapter
  does not carry a second integration algorithm. It delegates to
  `defaultIntegrateManagedWorkerSlice` — the same launcher-owned host primitive the
  broker composition invokes — so exact binding resolution, the Proof A gate,
  already-integrated recovery, the `integrateCommittedSlice` ref-CAS, and the
  decision clause 5(a) exact-slice worktree reap are byte-identical on both routes.
  The lifecycle never calls `integrateCommittedSlice` directly and has no local Git
  mutation or cleanup fallback; the primitive owns both. The single divergence is the
  final terminal-evidence step, carried as a launcher-owned composition value:
  `transported_attestation` (broker) mints and transports the bound attestation,
  because the read-only MCP namespace cannot run verify part 5 (`git write-tree`
  takes the index lock); `live_materializer` (direct) mints nothing and the
  lifecycle's own materializer performs the seven-part terminal WK verification
  against the physical worktree before any reviewer is bound. The direct route
  rejects a transported proof and the broker route requires one.
- **Evidence mode is composition-derived, never presence-derived.** Because both
  routes now supply an integration adapter, the existence of an adapter function
  carries no mode information. The launcher passes the broker and direct adapters in
  separate, non-interchangeable slots; only the broker slot selects
  `transported_attestation`, and a direct adapter can never serve a transported
  route. Launcher-owned dependencies are spread last over any caller dependency
  object, so a caller can add dependencies but can never omit, replace, or weaken the
  integration adapter, the reaper, the materializer, the registered tier, or the
  evidence mode. An incomplete composition (managed provisioning with neither
  adapter) composes no integration authority and keeps the pre-existing refusal
  rather than fabricating one.
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

### Post-Terminal WK Forge Handoff Over The Broker (work record)

After a work record's accumulated change is terminal/quiescent, the launcher hands it
to the consuming repository's forge as ONE squashed commit on a forge-visible branch
plus ONE pull request against the configured landing branch. That work runs `git`,
`gh`, and credentialed network I/O, none of which may run inside the read-only,
credential-stripped wiki-MCP bwrap namespace. It is therefore delegated across the
existing host-write sidecar transport (MCP stays stdio-only, decision) as ONE closed
operation, `wk_forge_handoff`, returning `wk_forge_handoff_completed` — the fourth
same-pattern host-write operation alongside `provision_worktree`, `commit_slice`, and
`integrate_slice`. It adds no second broker, sidecar, socket, alternate transport,
generic shell route, CLI wrapper, or generic forge framework.

- **Thin bwrapped proxy; host-only authority.** `workspace_wk_forge_handoff` is one
  orchestrator/operator MCP route whose handler is a THIN CLIENT of the sidecar
  endpoint. The wiki-MCP process (the route, `dispatch-launch-runtime.mjs`, and the
  adapter) constructs only the closed channel adapter; it never reaches for a
  process-launch transport for forge handoff, discovers gh, inspects credentials, runs
  Git/gh, or mutates repository state. Every Git object/ref write, remote
  observation/publication, gh discovery/authentication, credential use, network
  activity, branch publication, and PR operation executes HOST-SIDE in the launcher
  sidecar process, outside bwrap, composed only by `orchestrator-dispatch-sidecar.mjs`.
  The existing bwrap secret-env denial is intact: `GH_TOKEN`/`GITHUB_TOKEN` and host gh
  configuration are unavailable in the child.

- **Launch-executor-independent composition.** Forge handoff is NOT a method on
  `createWorkspaceAgentDispatchBackend` and is NOT conditional on a Codex/model launch
  executor. `buildDispatchRuntime` resolves a dedicated `wkForgeHandoffAdapter` even
  when no launch executor exists (so `dispatchBackend` may be null), `server.mjs`
  injects it into `registerDispatchTools`, and the route is ALWAYS registered. A
  missing adapter/endpoint returns a typed `backend_unavailable` /
  `host_write_authority_substrate_unavailable` refusal rather than the route
  disappearing.

- **Closed wire contract.** The MCP/client request carries ONLY `assigned_unit` (a
  canonical `WK-####` record selector). Repo paths, Git refs, SHAs, initiative, landing
  branch, remote, host, owner/name, credentials, gh path, Git argv, mode, retry policy,
  and merge intent are never accepted from caller input, prompt text, request
  environment, or model output. The host broker independently resolves all authority
  from its launcher-frozen `mainRepo` and canonical WK/Git/gh state: the canonical HTTPS
  `origin` coordinate (one host/owner/repository binding both Git push and gh REST;
  remote helpers, `url.*` rewrites, multiple push URLs, non-HTTPS destinations, and
  Git/REST disagreement refuse before credential use), terminal/quiescent eligibility,
  the frozen WK ref/tip, the unique merge base, and the deterministic squash.

- **Deterministic squash and idempotent publication.** The squash reuses `wkTip^{tree}`
  verbatim with the unique merge base as the sole parent and pins identity, message,
  timestamps, and timezone from launcher-owned deterministic inputs (no wall clock), so
  the same trusted tuple reproduces the same SHA and preserves modes, symlinks,
  submodules, deletions, renames, merge-history content, and intended coordination
  files. Branch publication is absent-ref CAS only (exact head recovers, a different
  head or race refuses and is re-observed); PR selection is exact
  repository/base/head across bounded all-state pagination (zero creates once, one
  recovers open/closed/merged, multiple/malformed/uncertain refuse). Canonical record
  eligibility and the WK ref are re-read before every success. It never force-updates or
  deletes a branch, or merges/rebases/resets/updates the landing branch.

- **Bounded no-auth posture; fail-loud after observation.** Before any authenticated
  remote observation/mutation, absent or unauthenticated host gh returns a typed
  human-action result: a manual `git merge --ff-only` argv (program + argv array, never
  shell text) ONLY when the host independently proves an exact local landing branch/tip,
  the deterministic squash, an absent/exact local handoff-ref CAS, and fast-forward
  applicability; otherwise `human_reconciliation_required` with no guessed branch and no
  merge command. After authenticated remote observation begins, every failure is
  fail-loud and cannot degrade to a manual success. The gh token is never read,
  returned, placed on an argv or in a remote URL, or put on the wire; branch publication
  uses gh's one-shot HTTPS Git credential helper.

- **Closed refusal taxonomy.** Operation-specific host-broker reasons
  (`broker_forge_handoff_unavailable`, `broker_forge_handoff_request_invalid`,
  `broker_forge_handoff_remote_invalid`, `broker_forge_handoff_eligibility_refused`,
  `broker_forge_handoff_publication_disagreement`, `broker_forge_handoff_indeterminate`,
  `broker_forge_handoff_threw`) and one adapter result-invalid reason
  (`host_write_authority_forge_handoff_result_invalid`) keep missing composition,
  malformed request/result, remote/config/auth refusal, publication disagreement, and
  indeterminate mutation distinguishable. No public runtime-blocker taxonomy code is
  added. The forge and organization own review, approvals, checks, branch protection,
  merge queues, and merge; this operation adds no local reviewer, Proof A, receipt,
  merge, cleanup, reaping, or DEC authority.

### Identity-Store Scoping During Restart Recovery (work record)

The launcher-owned worktree identity store is APPEND-ONLY history. Every managed
launch retains its `.slice` and `.wk` binding files, and decision clause 5(a) reaps
the slice checkout after a successful integration while deliberately retaining that
binding evidence. A binding whose `worktree_path` no longer exists is therefore a
NORMAL, expected steady state — not corruption — and the store grows without bound
across the lifetime of a repository.

Restart recovery resolves one exact WK/slice binding pair from that store by
`launch_ref` plus an exact `WK-####SLICE-###` subject. Scoping that resolution to the
requested handle is a CORRECTNESS requirement, not an optimization: a scan that
validates unrelated history makes recovery of a live handle fail for reasons that have
nothing to do with it. The work record canary observed both failure modes after a launcher
restart — unrelated reaped worktrees failing liveness validation, and a global
scan-size ceiling refusing outright once retained history grew past it.

- **Recovery is bounded by the requested candidate set, never by total store size or
  unrelated valid history.** The total number of retained binding files cannot refuse recovery;
  there is no global scan ceiling. Entries are parsed only far enough to classify
  `launch_ref`, and a well-formed `launch_ref` that is not the requested one is the
  ONLY entry kind discarded before validation. Unrelated bindings therefore receive no
  schema, path, worktree, ref, or scope validation, and an unrelated dead worktree can
  never block a live handle.
- **Unattributable corruption still fails loudly.** An unreadable file, invalid JSON, a
  non-object envelope, or an absent/noncanonical `launch_ref` refuses through the
  existing `agent_launch.worktree_substrate.binding_not_found.v1` posture. Without a
  per-launch selector or index the resolver cannot prove such a file is unrelated — it
  might BE the requested handle — so skipping it would silently downgrade store
  corruption into a false no-match or a false unique pair. Only provably unrelated
  entries are ignored.
- **The requested handle stays fully fail-closed.** Recovery requires exactly two
  bindings carrying the requested `launch_ref`, assembled into exactly one WK/slice
  pair with distinct worktrees. Zero matching bindings preserve the existing
  no-recovery (`null`) result. Two refusal families apply, and they do not overlap:
  - A candidate that carries the requested `launch_ref` but fails the binding
    contract — a missing authority field, a noncanonical path, ref, scope, filename,
    or schema, or an absent worktree — is attributable store corruption and refuses
    through `agent_launch.worktree_substrate.binding_not_found.v1` with the offending
    file path and field, exactly as for the unattributable corruption above.
  - A candidate set that is well-formed but does not name one pair — partial,
    overfull, duplicate, wrong-subject, or otherwise unassemblable — refuses through
    one canonical `agent_launch.worktree_substrate.verified_binding_unit_mismatch.v1`
    path. That refusal always reports `matching_binding_count`; it reports
    `matching_pair_count` only once pair assembly has actually run, so an absent
    count means the set was rejected on cardinality before assembly rather than
    assembled and found ambiguous.

  Candidates are never truncated or sampled to reach a unique answer.
- **Tolerating a reaped slice checkout stays exact (work record).** `allowMissingSliceWorktree`
  is authorized for already-integrated recovery on BOTH recovery routes — the exact-slice
  receipt route and the ordinary unknown-monitor-handle route — and only for the SELECTED
  exact slice binding, the one whose `record_id` and `slice_id` match the requested
  subject. It tolerates `ENOENT` alone; any other errno still refuses. The selected WK
  validation worktree remains MANDATORY and can never receive the tolerance, because the
  flag is re-derived per binding and the WK binding carries `slice_id: null`. Pinning the
  tolerance off on the ordinary route made the live work record steady state unrecoverable:
  clause 5(a) reaps the slice checkout at integration, so "already integrated" and "slice
  checkout absent" are the SAME state, and the resulting `ENOENT` surfaced as
  `binding_not_found` naming the binding FILE — telling an operator that a correctly
  integrated slice had lost its retained identity evidence.
- **An already-integrated recovery requires no slice-review receipt.** Recovery of an
  integrated slice is authorized by Git objects and refs, the integration marker, the
  retained exact bindings, and canonical WK state. A slice receipt, a reviewer run, Proof
  A, or a recreated slice worktree is NOT a precondition, and the absent-receipt route
  returning null simply falls through to ordinary integrated-worker recovery. Slice review
  is transient orchestration QA, not durable delivery provenance: its artifacts are not
  squash or forge (PR) provenance, and the final whole-WK review remains bound to the
  ACCUMULATED WK/squash target, never to a slice-review artifact. A missing slice worktree
  still authorizes nothing on its own — it can never permit fresh integration, proof
  minting, review inference, ref mutation, status mutation, or cleanup, because a slice
  that is not already integrated fails closed in the recovery-only arm with zero mutation.
- **Recovery reads; it never reaps (work record).** The decision clause 5(a) reap is an
  INTEGRATION-time responsibility and runs exactly once, on the fresh-integration path. A
  RECOVERED integration does not re-enter `releaseRetainedSlice` at all. Re-entering it
  made recovery depend on the reaper re-explaining an already-absent checkout — it
  tolerates a missing worktree only given a prior audit record — so a correctly integrated
  and correctly reaped slice failed recovery for want of cleanup bookkeeping, and every
  replay re-took a ref lock and appended another audit write for finished work. Once the
  exact integrated state is proven, the slice checkout's absence is the EXPECTED terminal
  outcome and needs no further proof, regardless of whether a historical reaper audit
  exists. This narrows nothing else: no retained binding, worktree, ref, or receipt is
  deleted or modified to keep the store scannable, store growth is not a condition any
  recovery path may remediate by deletion, and the reaper's own contract is unchanged
  wherever it is actually invoked.
- **Convergence on the first recovery is exactly-once and idempotent.** A first already-
  integrated recovery may perform the narrowly required canonical lifecycle convergence —
  the exact status transition reflecting the already-integrated slice, and for a final
  slice the persistent-WK materialization needed to reach whole-WK review. Those actions
  are exactly-once; a subsequent exact replay is byte-identical and mutation-free. Durable
  receipt cleanup and CCE enforcement of this path remain follow-up work and are NOT
  described above as current behavior.

### Terminal Ownership And Historical Non-Final Recovery (work record)

A slice marker stays an ancestor of the WK branch forever, but it owns the terminal
whole-WK review target only while it IS the current tip. The closed
`slice_integrated` result envelope encodes that ownership rule directly.

- **A non-null `review_target` requires `slice_sha === wk_sha`.** This binds the
  fresh integration path and the recovered path alike. It is checked BEFORE terminal
  evidence handling, before any policy-only conversion, before frozen review-context
  binding, before reviewer construction, and before any status mutation — so a result
  claiming a terminal target it does not own is refused before any of that is
  inspected or acted on, not after.
- **An earlier recovered slice is an honest non-final success, not a failure.** When
  slice A integrated and a later slice B advanced the WK ref, canonical
  reconciliation of A truthfully reports `integrated: true` with `slice_sha` naming
  A's retained integrated marker and `wk_sha` naming the later current WK tip. Both
  `review_target` and `terminal_review_evidence` are null, the transition is a
  read-only recovered no-op, and no reviewer, frozen context, or terminal status
  authority is produced. The broker re-enters this path to complete or idempotently
  confirm the exact-slice cleanup, so it must be expressible on the wire.
- **Only the exact canonical historical-recovery shape may carry differing SHAs.**
  Acceptance is a discriminated union over exactly two top-level shapes, not a
  relaxation of the SHA rule. A FRESH result carries the closed field set with
  `slice_sha === wk_sha` and a real `previous_wk_sha`. A RECOVERED result carries
  that set plus both `recovered` and `integrated_state`, with `previous_wk_sha`
  exactly null. SHA disagreement is admitted only when the result is recovered,
  classified `non_final`, carries a null review target and null terminal evidence,
  claims no rebase, and carries the exact recovered/no-op/unwritten `done`
  transition. A partial discriminator pair, a `recovered: false` claim, a fresh
  result asserting disagreement, a forged classification, terminal evidence on a
  historical recovery, or any additional field is refused.
- **The discriminator is server-derived.** The broker projects `recovered` and
  `integrated_state` from `reconcileIntegratedSliceRecord`'s own frozen output. The
  `integrate_slice` request remains the closed four-field launcher tuple, so no
  caller, prompt, worker, or environment value can select recovery, finality, SHA
  disagreement, cleanup authority, or a terminal claim. Recovered results are
  read-only reconciliations and may never carry a written status transition, Proof A,
  receipt state, or tier.

### Slice-Level Pre-Integration Review And The Proof A Gate (work record / decision clause 1(a))

This is the FIRST of decision's two mandatory review surfaces, and it inverts the
order the lifecycle previously ran in. Before work record a terminal worker ran
straight through to integration, and a non-final implementation slice integrated with
NO reviewer at all — only the final slice triggered any review, and that review was
the whole-WK one. Every non-final slice therefore reached the WK branch unreviewed.

Under the inverted lifecycle, `runPostWorkerSliceLifecycle` does the following on a
terminal, successful worker whose committed slice tip differs from its frozen base:

1. **Freeze the slice target.** The committed slice tip becomes a frozen slice-level
   review target (`ref`, `sha`, `diff_base_sha`, `diff_range`, `slice_level_review:
   true`). It carries the slice discriminant and MUST NOT carry the whole-WK
   completeness markers (`complete_parent_wk_contract`, `accumulated_wk_diff`); a
   mixed shape fails closed.
2. **Transition the SLICE to `review` while the PARENT stays ACTIVE.** This is what
   makes surface (a) a per-slice review rather than the whole-WK review of surface
   (b). The canonical resolver enforces the ordering: it refuses to return a
   slice-review unit unless the slice itself is `review`, and independently refuses if
   the parent has entered whole-WK review.
3. **Bind the backend-owned frozen slice-review context and dispatch a findings-only
   reviewer against it.** The reviewer's `workspace_dir` is the LIVE FULL SLICE
   WORKTREE — not the persistent WK worktree. Under decision clause 2 that worktree is
   a full checkout cut off the current WK tip, so it already contains every prior
   integrated slice plus this slice's work. The post-terminal preparation above has
   aligned its ordinary index with the reviewed commit before this context is bound;
   no physical-file materialization or separate retention machinery is needed.
4. **Park until a verified Proof A.** The run sits in the non-terminal
   `awaiting-slice-review` phase and re-enters the lifecycle on every poll. Findings, a
   still-running reviewer, a malformed or missing structured result, and a corrective
   commit that moved the slice tip are indistinguishable from here: no launcher-owned
   acceptance binding exists, so the run stays parked and NOTHING integrates. Silence
   is never read as acceptance.

**The Proof A gate.** Integration is authorized only by a server-resolved, exact-SHA
proof that the slice's review was ACCEPTED against the very commit being integrated.
The gate runs inside `integrateCommittedSlice` immediately before `advanceSliceRefCas`
— which covers BOTH the local in-process route and the broker route, since both call
that primitive — so every refusal precedes any rebase, any `update-ref`, and any
canonical status write. A refused integration leaves both refs and the record exactly
as it found them. The gate:

- requires a launcher-owned slice-review binding and validates it names THIS unit
  (a binding for a sibling slice can never authorize a different slice);
- requires the CURRENT slice ref AND the commit under integration to BOTH equal
  `reviewed_sha`, so a same-branch corrective commit invalidates the proof and repeats
  the review rather than shipping unreviewed work;
- re-runs the object-store probes from the trusted namespace rather than trusting the
  backend's earlier measurement;
- requires the canonical slice to still be an implementation slice under unresolved
  review with an active parent;
- server-resolves the persisted proof and matches unit, initiative, slice ref,
  reviewed SHA, diff base, source worker run, and review run, confirming the
  backend-derived CLEAN outcome and the evidence digest.

Refusals use the `agent_launch.slice_integration.review_acceptance_proof_{missing,
malformed,untrusted_provenance,binding_mismatch,target_stale,review_not_accepted}.v1`
taxonomy. **A missing or malformed structured result is NEVER interpreted as
no-findings.**

Review enforcement is launcher-tier-owned. Registered `paid_cce` uses enforced
CCE: exact Proof A is mandatory and cannot be selected, disabled, or replaced by
request fields, prompt text, argv, environment, or a worker-selected mode.
Free/local still treats review as policy and can launch/report reviewers, but
absent review evidence does not park or refuse automatic slice integration; that
non-enforced path mints no Proof A. The sidecar consumes the registered tier
frozen by launcher plan construction; it does not re-derive enforcement from the
mutable broker-planning environment.

Exact-slice review state is durable launcher runtime state. At context consumption
and terminal reviewer capture, the launcher publishes an immutable exact-identity
receipt event with temp-write, file `fsync`, atomic rename, and directory `fsync`
under a cross-process lock. Selector state is rebuilt from the validated append-only
event history rather than from independently overwritten aliases. Only monotonic
state/proof transitions and byte-exact replay are accepted; any reviewer-run or
monitor selector conflict fails closed without replacing terminal state. Each
reader serializes on the publication lock, so it cannot return an obsolete
nonterminal event after terminal publication completes. Live and stalled owners
are never aged out, dead owners move to token-specific tombstones, malformed lock
state fails loudly, and initial directory creation syncs its parent. Each
receipt binds unit and contract digests, source/reviewer runs, monitor handles,
retained worktree identity, slice ref, reviewed/diff-base SHAs, terminal status,
validated structured outcome, and trusted-evidence digest.

After backend/MCP restart, recovery accepts only the bounded unit plus run/handle
selector, re-resolves canonical contracts and retained Git identity, verifies the
required refs and commits, and then mints or resolves the existing Proof A. The
host broker independently reads the same durable receipt from launcher state,
reconstructs only the exact acceptance binding, and passes it to the existing
`integrateCommittedSlice` Proof A gate. Neither proof nor acceptance crosses the
broker request. Exact replay is idempotent, including final and non-final
already-integrated paths. Those paths independently validate the frozen contract,
the exact permitted canonical lifecycle transition, integration marker, retained
slice/WK refs, target SHA, and object-store commits; they do not require the
current record to retain the pre-integration active/review shape. In
`enforced_cce`, backend and broker then independently resolve the persisted
historical Proof A at the frozen reviewed-unit digest and validate its unit,
initiative, runs, monitor identity, reviewed/base SHAs, structured-result digest,
and frozen contract before reporting recovered success. `proof_state` is
descriptive only. `policy_only` recovery neither requires nor fabricates Proof A,
reviewer identity, or audit acceptance. Failed,
nonterminal, malformed, prose-only,
changed-contract, missing-object, stale-SHA, wrong-unit, wrong-run,
consumed-conflicting, or digest-invalid receipts authorize nothing.

**The frozen contract is the authored REVIEW-RECEIPT contract (work record).**
Every frozen `canonical_parent_wk_contract`, its digest, the paired
`slice_review_contract`, and every comparison against them — admission freeze,
post-mint publication, integrated-state reconciliation, and the acceptance
proof's historical comparison — is taken over ONE shared derivation,
`projectSliceReviewReceiptContracts`. Both halves come from a SINGLE canonicalized
snapshot of the record, so the frozen slice is byte-identical to the frozen
parent's embedded slice by construction and the four surfaces cannot drift apart.

That derivation excludes exactly three classes of NON-AUTHORED variation:

- **Generated evidence.** The generated surfaces `derived_evidence` and
  `projections` are excluded, via the shared `projectWorkRecordSourceContract`.
  They are validated separately, on their own terms.
- **Legacy representation.** `read_scope` and its historical `docs` alias are the
  same authored contract, so the record is canonicalized (`docs` -> `read_scope`,
  at record AND slice scope) BEFORE either contract is derived.
- **Coordination metadata.** The parent record's `updated` field is coordination
  metadata at this boundary and is dropped from both sides of every comparison.

Each exclusion is required for correctness, not convenience. Proof A publishes
its own admission-evidence envelope into top-level `derived_evidence`, and
admission-metric, target-resolution, cleanup, and review-result refreshes write
that field and move `updated`; the same persistence path canonicalizes a legacy
`docs` representation. Comparing raw record bytes would therefore make a trusted
publication — including Proof A's own write, a coordination-only `updated`
refresh, or a pure field rename — read back as an intervening canonical edit, so
the post-mint receipt would conflict with the admission receipt already published
for the same run and every clean slice review would fail to close.

This projection is scoped to the review-receipt boundary alone. It is
deliberately NOT wired into `computeWorkRecordSourceDigest`, so repository-wide
source-digest and CAS semantics are unchanged and no stored digest is migrated.

The same derivation governs the WHOLE-WK findings-only review contract
(`resolveCanonicalFindingsOnlyReviewUnit`), whose frozen parent and review-unit
contracts are compared for byte equality on every reviewer launch. Freezing raw
record bytes there let a generated-surface refresh, a `docs` -> `read_scope`
canonicalization, or a coordination-only `updated` bump refuse a launch as
`frozen_review_context_stale_or_mismatched` while nothing authored had changed.

Frozen contract strings are serialized with `canonicalizeWorkRecordJson`, which
emits keys in a canonical order. `JSON.stringify` would make immutable review
identity depend on the record's incidental on-disk key order, so a writer that
reordered its output would silently invalidate every frozen contract. Producers
and comparisons use this serialization consistently; it is a review-contract
boundary change only and does not affect `computeWorkRecordSourceDigest` or CAS.

**Contracts frozen before this change are not equivalent and are not migrated.**
A contract frozen by the earlier raw projection carries `updated`, any legacy
`docs` shape, and insertion-ordered bytes, so it cannot compare equal to the
canonical projection. That disagreement fails closed: it refuses as a stale or
changed contract rather than being reinterpreted. An affected in-flight review
must simply be performed again against a freshly frozen contract. There is
deliberately NO digest or CAS migration, and no compatibility bypass that would
preserve authority across the two representations — a bypass would have to accept
bytes no current projection can reproduce, which is exactly the property the
frozen contract exists to deny.

This narrows nothing else. A real authored edit to the parent record or the
slice — acceptance criteria, scopes, or any other authored authority-bearing
field — still invalidates the frozen contract and refuses, and the receipt
validator's immutable selector and monotonic-transition rules are unchanged.

**Terminal minted replay survives integration (work record).** Post-mint
publication re-resolves the canonical slice, and that resolver requires the slice
to still be `review`. After the slice integrates it is `done` (or its parent has
moved to whole-WK review), so an ordinary later poll of an already-completed
review must not fail. Before re-resolving, the backend queries the exact receipt
selector owned by the current unit and reviewer run. An existing receipt may
bypass canonical re-resolution ONLY when it is already, exactly: bound to the
same unit, review run, monitor, frozen context, worktree identity, reviewed SHA,
and diff base; `frozen_context_state: "consumed"`; `terminal_run_status:
"succeeded"`; structured outcome `clean`; `proof_state: "minted"`; and consistent
with the current trusted terminal run result. It then returns the byte-identical
retained receipt as a no-op, publishing nothing.

That receipt lookup is FAIL-LOUD. An absent receipt is an ordinary non-replay and
falls through to normal publication, but an unreadable, schema-invalid,
digest-mismatched, selector-conflicting, or non-monotonic stored receipt surfaces
the store's own typed error with its cause intact, and mutates nothing — no
publication, no Proof A mint, no integration, and no receipt deletion or rewrite.
Swallowing that read into "no receipt" would let real corruption fall through and
be reported later as an unrelated canonical-state failure.

Admission and running receipts are NOT terminal replay authority. A
running/unminted admission receipt exists under that same selector for the whole
review, and it fails the predicate on every terminal clause, so it still proceeds
through Proof A minting and the validated monotonic terminal transition. The
shortcut is never taken merely because some receipt exists, and child prose,
caller input, `final_result.kind`, and summaries are never receipt authority.

The exact-slice reviewer exception is backend-owned. Its canonical implementation
slice may have a non-empty `write_scope`, but only matching live frozen context
admits the reviewer, and the reviewer receives zero write authority. Ordinary
caller-selected reviewers still require `write_scope: []` at MCP admission and in
Codex/Claude planning. Claude exact-slice review binds its credential leaf
read-only and supplies no writable host root or file in either direct or broker
bwrap composition. A final sandbox-construction failure refuses before spawn for
both compositions; the ordinary unenforced plain-launch fallback is unavailable
to exact reviewers. Normal implementation-worker refresh and fallback behavior is
unchanged. No public request carries proof or enables manual proof injection.

Findings-only slices carry `review_purpose: "standalone" |
"terminal_whole_wk"`; omission means `standalone`. This discriminator is
structural and non-authorizing. Only `terminal_whole_wk`, matching backend-owned
frozen whole-WK context, and a canonical parent at that frozen review target can
classify terminal lifecycle review. Titles, summaries, acceptance prose, repo
paths, and “findings-only” text do not classify it.

An exact `changes_requested` result persists trusted corrective findings bound to
the unit, reviewer run, and reviewed SHA. An explicitly selected same-slice worker
reissue receives that launcher-owned, family-neutral context on Codex and Claude.
It grants no admission, Proof A, integration, acceptance, relaunch, or wider write
scope. A corrective commit moves the SHA and requires a fresh exact review.

Recovery exposes no operator integrate command, raw-Git recovery route, manual
proof injection, portfolio-local attestation, or caller authority field. The host
broker's internal integration operation is launcher composition, not a public
agent/operator recovery API.

**The expectation tuple is launcher-owned server state.** It comes from the dispatch
backend's `resolveSliceReviewAcceptanceBinding`, which reads the frozen slice-review
context and knows which run consumed it. It is NEVER read off the artifact under
validation: sourcing `review_run_id` from the persisted proof would make the proof
attest to its own binding, so the comparison would pass unconditionally and the gate
would read green while verifying nothing. Caller-carried review authority is refused
for the same reason (`FORBIDDEN_CALLER_CARRIED_FIELDS` rejects `review_acceptance`,
`proof`, `evidence`, `attestation`).

**Disposition on findings (decision clause 4).** Findings never trigger automatic Git
mutation. The slice stays in unresolved review with its branch and worktree retained;
the orchestrator disposes by reissuing the worker on the SAME slice branch (a
corrective commit, never a new branch), rescoping, cancelling, or invoking trusted
revert. A corrective commit moves the tip, which invalidates the proof and repeats the
review. `done` means accepted review plus integration.

### Terminal Review Materialization Gate (work record / decision clause 1(b))

decision defines TWO mandatory review surfaces: a slice-level pre-integration review
on the live slice worktree (clause 1(a)), and the terminal whole-WK review (clause
1(b)). This section covers the terminal one. Earlier revisions of this contract
described a single post-integration review reading the persistent worktree; that is
superseded.

Because the WK ref advance is a pure `update-ref` CAS (work record), integration ORPHANS
the persistent WK worktree: its ref still names the WK branch, but its index and
working files stay at the pre-integration tree. The managed reviewer reads SOURCE in
that physical worktree (`workspace_dir` = `validation_worktree_path`; Codex runs `-C`
there), so without a further step it reviews stale source — the work record
live bug. Object-store verification cannot substitute: the reviewer executes against
the checkout on disk, not the canonical object store.

- **The enforcement boundary is CCE-only.** The launcher-resolved registered tier
  is the sole source of `reviewEnforcementMode`: registered `paid_cce` maps to
  `enforced_cce`; every other registered free/local tier maps to `policy_only`.
  work record propagates that tier through launcher-owned composition. Caller input,
  request fields, prompt text, argv, worker environment, locally observed API-key
  presence, and worker- or reviewer-selected values cannot choose or override the
  mode; launcher-owned dependencies are spread last. Mechanical integration
  integrity remains mandatory in both modes.
- **The CCE gate.** In `enforced_cce`, the final-slice branch of
  `runPostWorkerSliceLifecycle` REFUSES unless it holds a verified attestation
  (`agent_launch.terminal_review_materialization.v1`) bound to the exact persistent
  worktree path, WK ref, and frozen reviewed SHA. The refusal happens before
  `bindFrozenReviewContext` and before any reviewer dispatch, on normal and
  restart-recovery routes. There is no null-tolerant CCE path and no default branch.
  A non-final slice launches no terminal reviewer and is outside this gate.
- **The evidence MODE is launcher-owned, and it selects the branch.** Which proof the
  gate can demand depends on who holds write authority over `.git`, which only the
  composition root knows. `buildDispatchRuntime` therefore hands the lifecycle owner
  an explicit `terminalReviewEvidenceMode` — `live_materializer` or
  `transported_attestation` — paired with the matching dependency, and spreads those
  deps LAST over any caller deps object. A caller can add dependencies but can never
  narrow, replace, select, or spoof the mode; neither can prompt text, ambient
  environment, or a worker-selected mode. Both lifecycle entry points — normal
  terminal-worker monitoring and the backend's restart-recovery route — go through
  that one wrapper, so recovery cannot run with a weaker dependency set than normal
  monitoring.
- **Enforced direct route (`live_materializer`).** Where the host-write sidecar
  endpoint is genuinely absent, integration ran in-process and materialized nothing,
  so the gate runs the materialize + 7-part verify ITSELF against the physical
  worktree and validates the exact seven-part result. Proof on this route is a
  measurement, never an inherited claim: a transported attestation — even a
  well-formed, fully bound one — is REJECTED here.
- **Enforced broker route (`transported_attestation`).** Where the sidecar endpoint is
  configured, the MCP namespace is read-only over `.git` and cannot mint proof at
  all: verify part 5 is `git write-tree`, which takes
  `.git/worktrees/<name>/index.lock` and fails EACCES read-only. Dropping that part
  is not an option — it is precisely the probe that catches the stale orphaned index.
  So the broker, which owns the writable namespace, materializes, verifies, and mints
  a BOUND attestation (`agent_launch.terminal_review_evidence.v1`) that the
  `integrate_slice` response envelope carries back. The gate requires that proof and
  requires that NO materializer be composed on this branch.
- **Independent checks use independently resolved state.** The adapter first enforces
  the closed transported schema. At the lifecycle gate, the bound run tuple is then
  checked against the live terminal-worker status, and the transported WK binding is
  checked field-for-field against the locally resolved launcher-owned
  `provisioning.wk_binding`. Those are real independent checks and catch stale,
  unintended, or corrupted run/binding evidence. The lifecycle deliberately does
  **not** compare the transported `review_target` echo with
  `integration.review_target`: both arrive in the same broker response, so agreement
  between them is self-referential and cannot establish anything. It is not replaced
  by an object-store-only target check. The broker has already run the stronger
  seven-part fail-loud verification against the physical worktree on disk, which is
  the surface the reviewer actually reads.
- **Policy-only optional reviewer.** `policy_only` runs the same strict direct or
  broker verifier when evidence is available. Only a successful verification may
  bind the frozen whole-WK context and return the ordinary optional reviewer
  dispatch. Local verification does not make that review CCE-enforced or audit-grade.
  A verified optional-reviewer result remains on the ordinary review lifecycle; it
  does not take the no-reviewer completion shortcut.
- **Policy-only no-reviewer completion.** If terminal-review evidence is absent or
  fails one of the closed evidence/materialization classes, review policy is not an
  integration or lifecycle gate. Trusted runtime launches no reviewer, binds no
  frozen review context, and returns `reviewer_dispatch: null` plus
  `workspace-agent-terminal-review-policy-disposition.v1`. The disposition says
  `enforcement_mode: policy_only`, `reviewer_launched: false`,
  `evidence_enforced: false`, and `audit_disposition: non_audit`, with a bounded
  cause. It contains no slice-review acceptance, reviewer or review-run identity,
  Proof A, clean verdict, accepted review result, CCE verdict, audit-grade
  acceptance, or synthetic evidence, and it does not describe review as completed.
- **Exact reconciliation precedes policy completion.** A failed evidence envelope is
  never integration authority. The lifecycle re-enters the existing trusted
  reconciliation path and independently verifies the exact unit, integration marker,
  retained slice and WK refs, integrated object identities, launcher binding, frozen
  target, and current canonical record. Marker/ref/identity/object disagreement,
  missing reconciliation, or target mismatch still fails loud. Only then may the
  no-reviewer disposition complete the lifecycle.
- **Canonical status and idempotency.** Exact policy-only no-reviewer completion
  requires the canonical parent to be at the expected whole-WK `review` state and
  moves that exact parent to `done` once through the canonical optimistic-CAS status
  operation. The CAS is bound to the digest of the canonical contract that was
  resolved at `review`, and the lifecycle re-resolves and verifies `done` afterward.
  Exact already-done replay is idempotent only after the same reconciliation and live
  unit/marker/ref/identity/target verification; it performs no second status write.
  `todo`, `active`, `blocked`, wrong target, wrong unit, missing marker,
  reconciliation failure, CAS conflict, or unexplained state refuses. A verified
  optional-reviewer case stays at `review` for the ordinary review lifecycle.
- **Refusal codes and ordering.** In `enforced_cce`, every refusal below is
  fail-closed and is raised BEFORE `bindFrozenReviewContext` and before reviewer
  dispatch. In `policy_only`, the same ordering holds for reviewer launch; only the
  closed evidence/materialization causes may instead become the explicit
  no-reviewer disposition after reconciliation. The direct branch requires the
  materializer, rejects transported evidence, runs the live materialize/verify, then
  validates the returned seven-part attestation. The broker branch rejects a
  materializer, requires evidence, validates the closed outer and bound-subtree
  shapes, validates the seven-part materialization attestation, then checks status
  and the locally resolved WK binding.

  | Condition | Code |
  | --- | --- |
  | No mode composed, or an unrecognized one (includes the no-managed-provisioning composition) | `…terminal_review_materialization.evidence_mode_unavailable.v1` |
  | Live branch, no materializer composed | `…terminal_review_materialization.materializer_unavailable.v1` |
  | Live branch, a transported proof was carried | `…terminal_review_materialization.unexpected_transported_evidence.v1` |
  | Broker branch, a materializer was composed | `…terminal_review_materialization.unexpected_materializer.v1` |
  | Broker branch, no proof carried (**includes recovery**) | `…terminal_review_materialization.transported_evidence_missing.v1` |
  | Broker branch, proof fails the closed schema, carries an unknown version, or has a malformed bound subtree | `…terminal_review_materialization.transported_evidence_malformed.v1` |
  | Broker branch, proof disagrees with live status or the locally resolved WK binding | `…terminal_review_materialization.transported_evidence_binding_mismatch.v1` |
  | Either branch, attestation absent, incomplete, or bound to another worktree/ref/SHA | `…terminal_review_materialization.attestation_invalid.v1` |

- **Narrow conversion, including upstream refusal.** The convertible taxonomy is
  closed: the six `TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES`,
  materializer-unavailable, and materialization `materialize_failed`, `verify_failed`, or
  `attestation_invalid`. Materializer `invalid_arg` and
  `frozen_target_mismatch` are excluded: the latter is a mechanical target/ref
  integrity failure, not optional review evidence.
  The production adapter's closed terminal-evidence/materialization validator issues
  map into those same classes. A broker-side post-integration materialization failure
  is recognized only through its exact nested review-freeze/materialization-code
  shape; a sibling reaper failure carrying `reap_code` is not convertible. Unknown
  broker codes, malformed unrelated transport, binding/canonical-record failures,
  integration or reconciliation failures, marker/ref/identity/object mismatches,
  lifecycle exceptions, cleanup/reaper failures, and status-CAS failures keep their
  normal fail-loud behavior. There is no blanket catch or recursive search for a
  familiar-looking code.
- **Same-invocation upstream refusal.** A broker or adapter may return one of those
  known nested evidence/materialization refusals after integration occurred but
  before `delegateSliceIntegrationToHost` returns an integration result. In
  `policy_only`, the failed envelope supplies no integration authority: the lifecycle
  invokes trusted reconciliation, independently reconstructs and verifies the exact
  canonical integration, preserves the exact original bounded cause and detail for
  that invocation, then applies the no-reviewer disposition and canonical status
  transition. The same upstream refusal remains fail-closed in `enforced_cce`.
- **Restart recovery uses the same tiered chokepoint.** A materialize that failed and
  latched may leave the tree stale. In `enforced_cce`, reconstructed broker state
  without required transported evidence remains a fail-closed
  `transported_evidence_missing` refusal. In `policy_only`, recovery reconciles and
  reverifies the exact integration, launches no reviewer, and completes the canonical
  lifecycle as above. When the original upstream refusal was not durably retained,
  recovery reports the honest cause `transported_evidence_missing` with bounded
  reconstruction context; it does not fabricate the lost original cause, add a new
  durable carrier, or degrade a valid reconstruction to `monitor_handle_unknown`.
  No normal or recovery path launches a reviewer against an unverified persistent
  worktree.
- **Failed recovery reports its true cause.** When a recovery attempt throws, the
  operator-facing envelope carries that cause under
  `blocker.detail.recovery_failure` with `reason: post_worker_lifecycle_recovery_failed`,
  and preserves the handle-level fact under `blocker.detail.backend_refusal`. The
  handle is not the problem in this failure and must not be reported as though it
  were; a recovery that simply found nothing to recover still reports the ordinary
  unknown-handle refusal.
- **Threat model — stated plainly, not overclaimed.** Per the operating model, these
  checks are correctness, provenance, and honest-agent workflow machinery. They catch
  unintended, stale, or corrupted evidence; they do not claim resistance to forged
  evidence from a hostile same-user process. Anti-forgery protocol hardening is out of
  scope for this repository's local machinery.
- **Mechanism (operator-ratified).** Re-create the persistent worktree as a FRESH
  FULL CHECKOUT at the reviewed SHA, at the EXISTING path (`git worktree remove` then
  `git worktree add`). Never `reset --hard`, never a sibling directory. Re-creating
  at the same path preserves the worktree's decision clause-3 roles (whole-WK
  validation checkout and squash-PR staging). Verification is 7-part and fail-loud
  against the checkout on disk: symbolic HEAD is the WK ref; the ref commit is the
  frozen SHA; HEAD is the frozen SHA; HEAD tree is the frozen tree; write-tree is the
  frozen tree; index and worktree diffs are empty; no untracked files.

### Managed Confined-Role Staged wiki-MCP Runtime (work record / decision)

The closed-input `commit` tool is served by a stdio wiki-MCP child inside the
managed worker's confined, Git-less `R∪W` namespace (a bwrap namespace whose
confinement is independent of the slice worktree's checkout density). That
namespace mounts none of the server runtime, so the child could not start and the
sole delivery surface was unreachable (the work record live canary, run
`wkdb_345a805426cd0a64`). The same is true of a confined findings-only reviewer or
redteam, whose registered read-only wiki-MCP server is its findings surface.

decision first authorized an in-repo closure. That closure is now RETIRED and
superseded by the staged runtime successor, because it was structurally unsound:
it took member membership from the Git INDEX (`git ls-files`) but bound the LIVE
working-tree bytes at those paths, so the executed runtime could mix two different
states of the repository into a composition that never existed as any coherent
revision — the work record incident shape — and it silently skipped a member tracked
in the index but absent on disk, letting an incomplete runtime reach spawn.

- **Committed-snapshot authority.** The runtime is built from ONE immutable Git
  object snapshot of a launcher-owned COMMITTED revision of the repository that
  owns the resolved server entrypoint. Membership (`git ls-tree` at the commit)
  and bytes (`git cat-file` on those objects) come from that same revision.
  Unstaged, staged-only, untracked, deleted, or concurrently changing working-tree
  bytes can neither enter a runtime nor invalidate one already selected. A
  launcher runtime source change becomes eligible only after it is committed;
  ordinary dirty development on the launcher checkout is therefore neither a
  global dispatch outage nor a way to smuggle uncommitted code into an
  authority-bearing runtime. The managed task worktree stays the worker's editable
  and reviewed subject and never supplies the commit-serving implementation.
- **Tracked superset, detector-only import analysis.** The staged runtime carries
  the full tracked four-package superset (`@agent-chassis/wiki-mcp`, `wiki-core`,
  `agent-launch-cli`, `agent-launch-core`) at the frozen commit: all tracked
  source, data, contract, schema, package, and other runtime path-read artifacts.
  Import-graph analysis walks the graph reachable from the staged entrypoint and
  REFUSES a snapshot whose committed importers do not resolve inside the superset.
  It is a completeness detector only and never minimizes the superset — a runtime
  `readFileSync` of a checked-in data or schema file is invisible to it.
- **Staged outside every worktree; three roots.** The runtime is staged in a
  launcher-owned directory OUTSIDE the repository and outside every managed task
  worktree, keyed by a digest over (schema, commit, and each member's
  mode/object-id/path). Exactly three read-only roots — the node interpreter
  directory, the staged root, and the canonical `node_modules` — replace the
  former hundreds of per-file same-path binds. Registration points at the exact
  staged entrypoint, never the live checkout. Because the staged tree is outside
  every worktree and no staged path is writable, staged runtime files can never
  become worker commit content, and ignored runtime state carrying credential
  aliases cannot be staged at all (a commit tree contains none).
- **Verified dependency link.** The staged runtime provisions ONE dependency link
  to the owning repository's canonical `node_modules`, verified before use:
  canonical target present, a directory, not redirected away from the owning
  repository, carrying npm's installed-tree marker, exposing the expected
  workspace aliases resolving back into that repository's `packages/`, and
  satisfying every dependency the SNAPSHOT's committed manifests declare. bwrap
  additionally binds the target read-only. The staged tree's own `@agent-chassis`
  scope resolves to the STAGED packages, so a staged importer cannot resolve back
  into the live working tree through the installation's workspace symlinks. This
  is ONLY the trusted runtime's link; the consuming worktree's own `node_modules`
  symlink is owned by agent-chassis:work record.
- **One predicate; typed fail-loud refusals.** Registration and staged-runtime
  composition come from ONE launcher-owned predicate for every managed confined
  role, bound to the exact (commit, digest) tuple, so a role cannot receive
  registration without its runtime nor a runtime without the matching registration
  and tuple. Every failure is a typed pre-spawn refusal published in the canonical
  runtime-blocker taxonomy — `managed_wiki_mcp_runtime_snapshot_incomplete` and
  `managed_wiki_mcp_runtime_dependency_unavailable` — carrying a bounded,
  repository-relative member diagnostic. Neither may degrade to an opaque bwrap
  failure, an in-child module-resolution crash, optional-MCP behavior, or a later
  `committed_slice_result_absent`.
- **Role authority unchanged.** The staged runtime is applied through the shared
  confined-role surface, differing only in the role passed in: managed workers keep
  the commit-only profile, confined reviewers/redteams keep their findings-only
  profile. The expected tools/list set is DERIVED from
  `session-role-tool-access.json` (composed with the descriptor's per-tool tier
  visibility), not restated as a hardcoded launcher list. Unmanaged workers,
  unconfined reviewers/redteams, and orchestrator plans are unchanged. Each role's
  repository WRITE surface and `R∪W` visibility are untouched; this refines
  decision/decision delivery infrastructure and confers no precedent for widening
  the repository-content contract.
- **In-namespace preflight is a hard pre-spawn gate.** The launcher runs a bounded
  real MCP `initialize` + `tools/list` against the staged runtime inside the
  role's FINAL bwrap mount topology under the production environment projection.
  It runs during plan construction — after registration is injected and the staged
  roots are bound, before a launchable plan is returned — so the topology it
  exercises is the one that will launch. Any initialize error, `tools/list` error,
  timeout, premature process exit, spawn or topology-materialization failure, or
  tool-surface mismatch produces a typed refusal and PREVENTS MODEL SPAWN. There
  is no advisory mode and no optional-MCP degradation.
- **Attestation binding.** A pass is evidence about one exact configuration. The
  attestation carried on the plan (`managed_wiki_mcp_runtime.preflight`) is bound
  to a digest over: snapshot commit and digest, entrypoint, role, registered tier,
  the central role→tool access policy bytes, the derived expected tool set, the
  canonical dependency installation (path plus npm installed-tree marker bytes),
  and the full bwrap mount topology. Any drift yields a different binding, so a
  prior pass cannot be read as evidence for a configuration that was not
  exercised. Safe caching keyed on that binding is optional; correctness first.
- **Remaining limitation.** The gate proves the STAGED RUNTIME — complete,
  startable in the role's real namespace, exposing exactly that role's
  policy-derived surface. It does NOT prove that the later Codex-owned MCP client
  instance initialized: a different process with its own lifecycle, which no
  launcher-side check can stand in for. An actual-client mandatory-readiness
  protocol remains separate follow-on work and is neither implemented nor claimed
  here. The loopback broker transport (work record) is governed separately and is
  unchanged here.
- **Managed family boundaries.** Managed Claude and Agy remain unsupported
  confined implementation-worker families, refused by the existing typed
  managed-read-boundary gate (`worker_read_boundary_unsupported`; supported
  families exactly `["codex"]`, backends exactly `["bwrap"]`) before any executor
  or plain-launch path. No Claude/Agy MCP configuration, commit authority, family
  support, or fallback is added; their unmanaged modes are unchanged.

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

Graph-impact degraded outcomes are deterministic. Under the work record current-HEAD
rule, the graph baseline is derived from the current committed HEAD, so a stale,
older-base, or missing-overlay state is rebuilt at current HEAD rather than
blocking. The taxonomy's `graph_impact_state_map` maps sub-states to taxonomy
codes as follows (the map's realignment to this rule in
`packages/wiki-core/data/runtime-blocker-codes.v1.json` is owned by
work record):

- a current-HEAD baseline that genuinely cannot be produced or validated
  (`graph_state` `unavailable` or `error`, or an unbuildable/unparseable base) →
  blocking `graph_impact_unavailable` / `graph_impact_rebuild_required` with a
  zero-backend refusal and its exact diagnostic state preserved
- `staleness` `stale`, `rebuild_required`, or `missing` on an older base →
  non-blocking: canonical graph rebuilding is safe in a dirty worktree because
  the base is derived from committed current-HEAD objects, not mutable worktree
  contents. Any supported dirty overlay is optional and all-or-nothing; an
  unusable overlay is discarded without contaminating the committed base.
  Agents must not clean, stash, reset, checkout, commit, or otherwise sanitize
  the worktree to refresh graph impact. Staleness alone never produces a
  blocking refusal
- `dirty_state` `dirty_worktree` with `overlay_state` `active` →
  non-blocking `graph_impact_degraded_overlay` (a valid overlay is merged over
  the current-HEAD base as optional enrichment, and the dispatch result surfaces
  the overlay evidence alongside canonical authority); an absent or unusable
  overlay falls back to the current-HEAD base without a refusal

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
