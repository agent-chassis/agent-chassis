
# Agent Launch & Direct-Dispatch Reference

> **This is reference material.** For first setup, start with
> [docs/quickstart.md](quickstart.md). This page is the deeper launcher and
> direct-dispatch contract.

This page is the launcher and direct-dispatch contract: role-launch configuration, the dispatch envelope, and the isolation contract. For first setup, use [docs/quickstart.md](quickstart.md).

## 1. Initialize Local Launcher Config

The operator-owned launcher registry written by `init-config`, the workspace-local
launcher state it creates, the Claude read-only argv defaults, and the
consuming-repo role-guard adoption contract are documented in
[agent-launch-local-config.md](agent-launch-local-config.md).

## 2. Use Direct WK Dispatch

### Canonical Operator Command Surface

The **authoritative and preferred** operator path for worker, reviewer, and
redteam launches is the canonical `agent-launch` subcommand with an explicit
`--app` flag:

```bash
agent-launch worker   --app <app> <unit>   # dispatch a worker
agent-launch review   --app <app> <unit>   # dispatch a findings-only reviewer
agent-launch redteam  --app <app> <unit>   # dispatch a findings-only redteam
```

Where `<app>` is `codex` or `claude` for supported launches and `<unit>` is a
`WK-####[#slice]` address (or `IN-####` for initiative-scoped redteam). Agy has
no supported confined launcher adapter and fails closed; do not select it for a
worker, reviewer, redteam, or orchestrator launch.

Examples:

```bash
agent-launch worker   --app codex  <WK-ID#slice>
agent-launch worker   --app claude <WK-ID#slice>
agent-launch review   --app codex  <WK-ID>
agent-launch redteam  --app codex  <IN-ID>
agent-launch worker   --app codex  --spark <WK-ID>  # Spark profile
```

Old per-family wrapper scripts (`codex-worker`, `claude-review`, and the rest)
are no longer shipped. If you are migrating operator scripts that call them, see
the migration table in
[agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md),
which maps each old wrapper name to its supported `agent-launch` command. That
page is operator reference only; agents dispatch through
`workspace_agent_dispatch` and report `missing_structured_transport` if that
route is unavailable.

### Dispatch Identity Control

`workspace_agent_dispatch` is the MCP-only agent dispatch
transport for `worker`, `reviewer`, and `redteam` calls. Stdio MCP is a
same-user local transport, not an authentication boundary. Dispatch is controlled
by the tool being exposed in the current session plus the structured
work-record dispatch-readiness checks.

The normal agent call shape is `{ role, subject }`. When typed `app` and
`model` are omitted, the launcher re-reads the selected role's model from the
workspace-root `agent-launch.toml` for that dispatch, then derives app/backend
through the neutral model registry. Typed `app` and `model` remain explicit
per-dispatch overrides only. Missing, malformed, or unknown role config refuses
with a role-specific diagnostic that names the operator-owned config to fix;
there is no family fallback and caller prompt/request/argv/environment/identity
cannot select the runtime. Editing `agent-launch.toml` affects the next dispatch
without a restart. Updating loaded launcher or MCP code still requires restarting
the owning MCP server or launcher session.

With a launch executor configured on the MCP server process, dispatch-readiness
hands off to the launcher-side run-lifecycle backend, which mints `wkdb_`-prefixed
run ids and `wkmh_`-prefixed monitor handles and reports lifecycle state through
`workspace_agent_run_status` using the controlled vocabulary `launching`,
`running`, `succeeded`, `failed`, or `cancelled`. The `backend_unavailable`
blocker is reserved for the unconfigured case (no launch executor wired into the
server process); it is not the normal posture when a launch executor is
configured.

Ambient `AGENT_ROLE`, `AGENT_WK`, and `AGENT_OPERATOR_WRITE_SCOPE` env
values, request payload role fields, prompt text role claims, argv role
claims, and a caller-asserted `claimed_identity.role` field are not role
identity sources; the dispatch surface refuses them with the stable refusal code
`agent_dispatch_identity.caller_supplied_role.v1` (and carrier-specific
variants documented in
[docs/mcp-integration.md](mcp-integration.md)).
Codex and Claude worker wrappers continue to treat their ambient env as
transport-only; they consume role identity from launcher-minted role-guard
context envelopes, not from inherited shell state.

`workspace_agent_dispatch` enforces the subject-role matrix
(`worker` / `reviewer` -> `WK-####` or `WK-####slice`; `redteam` -> `WK-####`,
`WK-####slice`, or `IN-####`) and returns a server-minted opaque
`monitor_handle` plus `run_id`. Status queries go through
`workspace_agent_run_status`; fabricated, cross-subject, replayed, or
unauthorized-caller handles refuse with the `monitor_handle_*` code
family. Reviewer dispatch enforces findings-only mutation authority. A canonical
implementation slice already in `review` with a launcher-verified exact committed
slice target is admitted against that same subject: the launcher freezes the
target and full required read visibility, then launches the reviewer with
`write_scope: []` without changing the slice's declared delivery scope. Every
other reviewer subject with non-empty scope refuses with `role_policy_violation`
plus diagnostic context `reason: reviewer_write_scope_nonempty`. There is no
`fixup` role on `workspace_agent_dispatch`; post-review fixes use normal worker
slices or follow-up WKs.

For `reviewer_write_scope_nonempty`, do not retry as a worker, switch roles,
refresh graph impact, broaden filesystem access, or use an operator wrapper.
If the selected implementation slice has successfully committed and is
canonically in `review`, dispatch the reviewer directly against that slice; run
identity authenticated delivery, while canonical committed-target state now
authenticates reviewer admission. Otherwise create or select a separate
findings-only review unit with `work_kind: review`, `write_scope: []`,
`repo_paths` listing the implementation files to inspect, `depends_on` pointing
at the implementation unit, and findings-only acceptance criteria.

Orchestrator launch and resume (`agent-launch orchestrator` and
`agent-launch resume`) remain human/operator-only entrypoints; agent dispatch
refuses orchestrator launch attempts from any role kind other than
`human_operator` with the refusal code
`agent_dispatch_identity.orchestrator_not_operator.v1`.

Reviewer review uses `workspace_agent_dispatch --role reviewer`. If that route
is unavailable in the current session, an implementation WK or slice covered by
the bootstrap exception records findings-only review evidence there and reports its bootstrap
state with one of `bootstrap_exception_active`, `bootstrap_review_missing`,
`bootstrap_exception_consumed`, or `graph_impact_persistence_unavailable`.
Graph-impact evidence may be queried through MCP today, but when WK evidence
persistence is required and `workspace_record_graph_impact_evidence`
is unavailable, agents must report
`graph_impact_persistence_unavailable` rather than fall back to shell/CLI
persistence.

#### Restart reconciliation of a prior managed worker

A managed worker dispatch is reconciled against two independent kinds of prior
state before anything is admitted, provisioned, allocated, or spawned.

**Git topology.** If the unit's slice branch already exists, its tip is compared
with the canonical WK-derived base. An absent, equal, or already-integrated tip
allocates as before. An ahead tip is also reusable for a corrective worker when
trusted runtime proves the exact canonical subject and slice ref, a server-minted
linear delivery chain rooted at the frozen authenticated base, and the same
current slice-ref/worktree-HEAD tip. Reviewer or redteam results do not enter
that proof. Any unauthenticated, malformed, cross-subject, moved-ref,
moved-worktree, or divergent tip refuses before a binding, ref mutation,
worktree mutation, or spawn. Refusal never deletes, resets, or rewrites the slice
ref. An unresolvable canonical base refuses the same way.

When the deterministic exact-slice worktree already exists and is correctly
associated, provisioning resumes it with its staged tracked changes, unstaged
tracked changes, and untracked files intact. Cleanliness is not an admission or
provisioning invariant: the launcher does not classify those bytes as intended
work versus residue, and it does not reset, clean, stash, reconstruct, delete, or
recreate the worktree to admit the retry. Branch association, exact HEAD/ref
topology, full-checkout state, repository/binding identity, path/type safety,
active-attempt exclusion, and scope authority remain mandatory. Closed-input
delivery is the boundary that enforces changed-path containment and validates the
result before commit.

**Process identity.** The dispatch run lifecycle is the single authority on
whether a prior managed attempt may be replaced. Before spawning, it publishes a
durable per-attempt record keyed on the exact run tuple (assigned unit, launch
ref, run id, retry id) carrying the launcher's own `(pid, starttime, boot_id)`;
after spawning, it binds the exact outer sandbox `(pid, starttime, boot_id)` and
its kill shape before the dispatch returns accepted. There is no bare-pid
liveness check anywhere: a pid alone cannot distinguish a recycled pid from a
live one.

The tuple is built by one canonical constructor and is identical on both sides of
a restart: the publication uses the launcher-minted worker run id, and recovery
derives that same id from the retained WK/slice binding pair rather than from
either binding's suffixed run id. A binding pair that disagrees on the worker run
id, launch ref, retry id, or assigned unit fails closed with the typed recovery
refusal instead of silently reading as an absent record.

Only a mechanically non-conflicting unit may launch. Live,
partially published, ambiguous, unreadable, tuple-mismatched, and unresolved
states all refuse, and a record reused across launcher tuples is a binding
mismatch rather than a near-enough match. A *proven-dead* no-commit attempt may
be retired for a later implementation retry. A proven-dead delivered attempt may
be replaced by a corrective worker only through the authenticated delivery proof
above and an exact atomic successor reservation; canonical `review` state and
review results confer no authority.
A recycled pid for an undelivered exact tuple is a dead verdict by `starttime`
mismatch; a changed `boot_id` proves the prior boot ended; an unavailable `/proc`
is indeterminate and never reads as death.

**Same-subject exclusion.** The gate takes an atomic per-subject reservation in
the same launcher-private store, so two concurrent dispatches for one unit — in
one launcher or in two sharing the repository — can never both reach the
executor. The loser refuses with `managed_run_prior_attempt_reserved` before
admission, provisioning, and spawn. A launch that is refused before anything is
spawned releases its own reservation; a launch whose outer identity could not be
bound after the process already started keeps it, because that unit is exactly
the uncertain case. A reservation whose owning launcher is proven dead and that
published no record at all is reclaimable, since the fixed publication order
proves nothing was spawned; any other held reservation stays blocked and
auditable. Different subjects never contend.

**Retirement.** A durable attempt is retired — as a recorded state transition,
not a deletion, and never by an operator removing files — once its safety purpose
is provably complete:

- the slice was integrated and its lifecycle finalized;
- a mechanically authenticated exact delivery is preserved as the base of a
  corrective worker on the same slice, while the exact prior attempt is proven
  dead and its reservation is atomically replaced by the successor; or
- the attempt is proven dead and trusted Git comparison shows its slice ref still
  equals its authenticated base, so there is no delivery to lose.

Every retirement additionally requires the proven-dead verdict, so a live,
partial, ambiguous, unreadable, or indeterminate attempt is never retired and its
evidence is never erased. Ordinary retirement releases the subject reservation;
corrective retirement atomically replaces the exact prior reservation so the
subject is never opened to a competing dispatch. A retired record stays on disk
carrying the reason, verdict, and mechanical evidence that authorized it.

If the launcher cannot enforce this for a managed worker — no identity root,
resolver, pending publisher, or outer-identity binder composed — the dispatch
refuses with `managed_run_identity_enforcement_unavailable` and the missing
dependency names, before any executor is invoked. This is a launcher composition
fault, not a work-record readiness blocker: report it and the exact command to
rerun rather than editing the WK to absorb it. Reviewer, redteam, and
operator-direct dispatch are unaffected.

Worker-run recovery never authenticates committed-slice review. Run identity
authenticates delivery; successful delivery establishes impl-to-review; canonical
committed-target state authenticates reviewer admission and corrective delivery
continuation. Reviewer and redteam conclusions remain advisory.

#### Runtime blocker taxonomy and coordinator preflight

A schema-backed runtime blocker taxonomy is published at
`packages/wiki-core/data/runtime-blocker-codes.v1.json`, exposed through
`workspace_runtime_blocker_taxonomy`. The taxonomy is the canonical code set
for dispatch readiness, launcher diagnostics, and preflight blockers. The
bootstrap-state codes (`bootstrap_exception_active`,
`bootstrap_review_missing`, `bootstrap_exception_consumed`,
`graph_impact_persistence_unavailable`) are a strict subset of the
taxonomy; dispatch readiness must select codes from this taxonomy
rather than inventing dispatch-specific ad hoc strings.

The taxonomy distinguishes role policy from runtime filesystem/transport
failures. A fully read-only repository mount surfaces as `read_only_mount`
in the `filesystem` category, never as `role_policy_violation`. Even when
orchestrator role policy already restricts writes to docs/ and wiki/, a
failed write to one of those permitted surfaces is still a filesystem fact
and is reported with the filesystem code so the operator can investigate the
mount or sandbox profile rather than rewriting WK acceptance to absorb the
runtime failure. Graph-impact degraded outcomes are deterministic and
documented in the taxonomy's `graph_impact_state_map`: unavailable/errors
map to the blocking `graph_impact_unavailable`; stale or rebuild-required
without a usable dirty overlay map to the blocking
`graph_impact_rebuild_required` (operator refresh — no rebuild in a dirty
worktree); and a dirty worktree with a usable overlay maps to the
non-blocking `graph_impact_degraded_overlay` so the overlay evidence is
recorded alongside canonical authority.

`workspace_coordination_preflight` composes the preflight envelope a
coordinator should consult before dispatching. It reports the role,
caller/session role, subject, allowed durable write surfaces (`docs/`,
`wiki/`, and the wiki subsurfaces), implementation/test edit prohibition,
repo mount writability, docs/ and wiki/ writability, available structured
dispatch and review routes, and any active runtime blocker codes from the
taxonomy. Caller-supplied identity carriers (request payload,
prompt text, ambient env, argv, and `claimed_identity.role`) are refused
with the refusal code at the MCP boundary. Coordinators that
discover a blocking preflight entry must stop and report the stable code
rather than implement inline, fall back to shell, or rewrite the WK to
absorb the runtime failure.

The same envelope publishes `capabilities`, with nine independently sourced
planes: `structured_dispatch`, `native_edit`, `repository_read_boundary`,
`commit`, `managed_worktree_provisioning`, `slice_to_wk_integration`,
`wk_context_review`, `validation_ownership`, and
`automatic_main_promotion`. Each plane reports availability, its server-owned
source, freshness, blockers, and a structured recovery route. A missing,
unknown, or stale fact is unavailable; a plane never inherits availability
from another plane.

For managed Claude/Codex worker, reviewer, and redteam routes,
`structured_dispatch` is effective only when the current backend exposes the
launcher-authenticated `stdio-mcp-conduit-composition-compatibility.v1` fact.
The fact is frozen and has exactly `schema_version`, `backend_generation_id`,
`producer_protocol_generation`, `consumer_protocol_generation`,
`compatibility_state`, and `source`; its source is
`launcher_active_composition`. Route registration remains separately visible
as `dispatch_route_registered` and under `capabilities.route_registration`.
An incompatible, unknown, missing, malformed, stale, or wrong-generation fact
leaves the route registered but makes effective dispatch unavailable. Every
surface reports `operator_recovery_needed`, cause
`stdio_mcp_lifecycle_protocol_incompatible`, and recovery to deploy one coherent
build and restart the long-lived backend. The other eight capability planes do
not inherit that gate and retain their own sources and blockers.

In the current release, structured dispatch, native edit, coordinator-owned
validation, and the initial local single-repository lifecycle are available
when their production composition is installed. That installed composition
provides the repository read boundary, managed worktree provisioning,
closed-input commit, slice-to-WK integration, and frozen whole-WK context
review. Automatic main promotion remains unavailable. Managed lifecycle
refusals use `managed_lifecycle_required`; provisioning refusals use
`managed_worktree_provisioning_unavailable`. Recovery rechecks the server-owned
facts through `workspace_coordination_preflight`. Free/local and paid/CCE
responses keep the same plane meanings and differ only in their enforcement
metadata.

The current initial flow is: commit the slice, freeze and review its exact SHA,
retain every reviewer/redteam result as independent advisory evidence, then let the
orchestrator disposition individual comments and request
`workspace_integrate_committed_slice`. That request is not authorization. The
server derives the exact target/ref/state and CCE alone decides any configured
organization-policy gate before the trusted CAS integration operation. Reviewer
completion never calls integration, and clean or findings-bearing output directly
authorizes or prohibits nothing.

If applying that exact slice object to the current WK tree changes zero bytes,
the operation succeeds idempotently with `empty_delivery:true` and does not move
the WK ref. This includes an equal tip, a proper-ancestor slice tip after another
slice advanced W, a never-run slice, and a replay whose content is already
accumulated. No worktree, delivery receipt or event, review evidence, lifecycle
status, dependency fact, or liveness proof is needed to apply zero bytes. Real
non-empty deltas still use Git object verification, conflict detection, and
expected-old ref CAS.

Paid CCE availability alone configures no policy and implies neither admission nor
veto. With a configured CCE gate, a missing, unavailable, malformed, unratified,
denied, or target-mismatched decision fails closed. With no configured gate, the
operation follows decision free-substrate behavior and reports that the result is
non-audit; the chassis never invents a local review gate or a CCE verdict.

The same rule governs terminal forge handoff. `workspace_wk_forge_handoff`
publishes only the launcher-frozen exact `C/B/W` candidate; terminal reviewer and
redteam results remain exact-candidate-bound advisory evidence. Clean output does
not authorize publication, findings do not veto it, and the orchestrator request
is not a policy decision. CCE alone decides a configured forge boundary gate.
Paid tier alone configures no gate; without a configured gate, mechanically valid
publication follows decision free-substrate behavior and reports non-audit posture.
Each WK has one launcher-owned current ref,
`refs/agent-launch/terminal-current-v2/<WK>`. Construction snapshots its old value
and replaces it only through Git expected-old CAS. If `W` changes, the launcher
constructs a replacement candidate, CAS-advances that same ref, and validates and
reviews the replacement SHA. Cold recovery reads only that fixed ref and accepts
only an already-present, directly commit-valued raw target whose immutable C
metadata mechanically authenticates repository identity, `W`, `B`, tree, sole
parent, and canonical contract digest. If the fixed ref is absent, cold recovery
fails closed with `terminal_candidate_recovery_current_ref_absent`; it never
reconstructs currentness. Construction from an absent ref happens only during the
hot post-worker lifecycle, where launcher-bound `B`/`W`/contract facts already
exist and absence is the expected-old CAS state. Legacy per-candidate refs are
ignored completely; zero, one, or many have no effect and are not migrated or
deleted.

The current ref selects which exact commit the operation addresses; membership is
not authorization. Candidate history, review findings or clean output, validation
success or failure, WK/slice status, dependencies, landing movement, and forge
state do not become local admission or veto rules. Remote identity and exact
branch publication remain forge transport facts; PR creation, idempotency, state,
and merge readiness stay with the configured forge and human merge actor. Per decision, later
landing movement does not invalidate review or block publication of unchanged C;
the configured merge actor and CCE policy own merge readiness.

Launcher runtime persists every exact-review run as an immutable, synchronously
durable receipt event under a cross-process lock; exact replay is idempotent and
selector conflicts refuse rather than overwrite state. Readers take the same lock as
publishers, a live or stalled owner is never displaced, and first creation syncs
the receipt directory and its parent. After backend/MCP restart, dispatch of another
review remains admissible and evidence evaluation re-resolves the frozen contract,
retained identity, refs, marker, and objects. Final and non-final
already-integrated results are recovered independently from the obsolete
pre-integration `active + slice review` shape. When projecting advisory context,
trusted runtime loads the complete exact-target receipt set rather than a latest
receipt and keeps disagreement visible. Active reviews and findings do not affect
binding authority. Historical fields from older receipt schemas are inert
compatibility data and cannot affect review admission, policy, or integration.

There is no operator `integrate-slice` command, raw-Git recovery, manual acceptance
injection, or caller-carried review authority. Exact-slice reviewers are admitted
only from backend-owned frozen context and remain read-only in both Codex and Claude
execution. For Claude exact-slice review, the credential leaf is a read-only bind
and the final bwrap plan has no writable host root or file. Sandbox construction is
mandatory for both Claude composition: failure refuses before
spawn, and an exact reviewer can never use the ordinary unenforced plain-launch
fallback. There is no manual acceptance injection. `review_purpose` is
structural and non-authorizing. Exact-bound
`changes_requested` findings are rendered into the next same-slice Codex or Claude
worker prompt as non-authorizing corrective context; they do not relaunch work,
grant acceptance, or change read/write scope.

Findings-only review is plural: multiple reviewers or policy-allowed redteams may
run simultaneously against the same committed target, and review history never
blocks another dispatch. Each run has its own run id, monitor handle, execution
state, and durable receipt. Workers and reviewers are expected to run concurrently;
attempt isolation and exact ref/status CAS provide collision safety rather than a
singleton lifecycle or consumed subject slot.

### Agent Dispatch Boundary

`workspace_agent_dispatch` and `workspace_agent_run_status` are
the only agent dispatch and monitor transports. Package-owned role wrappers
are not agent dispatch transports. Agents must not invoke them to start
WK-first implementation, review, or redteam work. If `workspace_agent_dispatch`
is missing or reports unavailable transport, the correct result is the
`missing_structured_transport` blocker, not CLI fallback.

Operator shells may still use wrapper commands for local debugging only when a
separate operator instruction explicitly asks for that action. Such use does
not establish agent-facing dispatch posture and must not be recorded as proof
that structured agent dispatch works.

#### Stdio Dispatch Boundary

Configured stdio MCP dispatch is a same-user local
tool call. A dispatch attempt should reach the structured dispatch-readiness
checks without a launcher registration prelude. Dispatch-readiness wires
to the launcher-owned launch backend so that a dispatchable subject reaches
the backend's `startLaunch(...)` rather than fail-closing at the readiness
tail. This same-user launcher contract does not add an authentication layer;
do not recreate one with a first-line stdio prelude,
shell helper, inline env policy, Codex `CODEX_HOME` config rewrite, an
auth prelude, a registration frame, or a per-connection identity registry.

This does not authorize non-MCP dispatch. Agents still use
`workspace_agent_dispatch`; they must not switch to non-MCP operator-shell
wrapper commands, broaden bwrap mounts, supply inline `VAR=value`
environment, repoint `HOME` or `XDG_*` roots, open a temp worktree, or use
graph-impact persistence as a launch side channel.

### Host wiki-MCP conduit contract

The launcher-owned host wiki-MCP server, exact two-FIFO transparent stdio
conduit, role-derived tool surface, and shared Claude/Codex lifecycle are
documented in [mcp-integration.md](mcp-integration.md).

Managed structured dispatch binds the resolved host-server entrypoint, selected
Node executable, exact spawn primitive, producer and consumer lifecycle
descriptors, and conduit constructor into one private process-generation object.
Both Claude and Codex consume the same guarded constructor. This pre-dispatch
composition fact is complementary to the per-dispatch work record readiness
handshake: the fact prevents advertising or entering a known-unresolved managed
composition, while the spawned-server handshake remains the final runtime check.
Direct orchestrator and operator launch paths are outside this preflight gate.
The early fact assumes one coherent deployed package composition; it is not a
second server launch and does not attest an in-place source mutation. The real
spawned server's readiness event remains authoritative in that case.

### Claude role paths

The supported Claude role paths are:

- `agent-launch worker --app claude <unit>`
- `agent-launch review --app claude <unit>`
- `agent-launch redteam --app claude <unit-or-IN>`

Reviewer and redteam launches are findings-only by role contract. Any internal
launcher adapter derives its family, role profile, scope, conduit binding, and
host-server authority from one frozen per-run launcher binding. Ambient shell
environment, alternate `HOME`/`XDG_CONFIG_HOME`, caller config, and env-carried
payloads cannot select or reconstruct that authority.

### Read-only role dispatch addresses

Canonical `agent-launch review|redteam --app <family> <unit>` operator smokes
and structured `workspace_agent_dispatch` calls accept the same v1 unit address
grammar as worker dispatch.

- a whole work item: `WK-####`
- a tracker-local slice: a `WK-####` address with a `#slice` suffix
- redteam may also target an initiative: `IN-####`

When the address resolves to a WK record (with or without a slice), the
read-only role consults the canonical dispatch-readiness pipeline before
launching. This read-only readiness check is not the same as implementation
worker dispatchability: review and redteam targets may be non-implementation
units, and the launcher must not refuse them solely because a worker would have
returned `not_implementation`.

Read-only readiness still fails closed for canonical record problems such as
missing JSON, missing slice, invalid record shape, unresolved or blocked
dependency evidence under the active profile, required missing graph-impact
evidence, or required missing/stale preparation-audit evidence. A
`blocked_dependency` readiness — for example a slice that depends on another
slice whose status is `blocked` or whose address cannot be resolved against
canonical WK JSON — refuses the launch with shared dependency evidence drawn
from `dispatch_readiness_dependencies` and the
`dispatch_readiness_preparation_audit` envelope.

If a read-only WK/slice target requires graph-impact evidence, wrappers may
transport a runtime graph envelope through the same file-backed bridge used by
worker planning, but that file path is not authority. Launch proceeds only after
the shared dispatch evaluator accepts the parsed graph evidence for the
selected read-only unit. Redteam targets that name an initiative (`IN-####`)
have no canonical JSON record to consult and remain on the legacy non-gated
path.

The canonical field model for work records lives in the `work-record.v1` JSON
schema and the `workRecordAuthority` stanza of
`packages/wiki-core/contract/manifest.json`; the public wiki contract summary is
in `packages/wiki-core/contract/schema.md`.
This quickstart only documents the operator-facing dispatch address form.

### Confined source access and host wiki-MCP

The launcher-owned repository namespace, shared host wiki-MCP FIFO conduit, and
unsupported Agy posture are documented in
[agent-launch-confinement-mcp-conduit.md](agent-launch-confinement-mcp-conduit.md).

### New-directory write scopes

How the launcher resolves and pre-creates a declared `write_scope` entry that does
not yet exist on disk, the `bubblewrap` isolation that owns the real write
boundary, and the `prepared_new_write_roots` dry-run surface are documented in
[agent-launch-write-scope-preparation.md](agent-launch-write-scope-preparation.md).

### Family runtime state

The per-family launcher runtime-state facts for supported Codex and Claude, plus
the explicit unsupported Agy posture,
the four runtime-state classes, and the state-class summary table are
documented in
[agent-launch-family-runtime-state.md](agent-launch-family-runtime-state.md).

### Agent run provenance and inspection

The `agent-run-provenance.v1` envelope, its field model, digest and
retention rules, and the repo-local provenance inspection command are
documented in
[agent-launch-run-provenance.md](agent-launch-run-provenance.md).

### Host wiki-MCP conduit diagnostics

The per-role host wiki-MCP conduit, its typed `stdio_mcp_*` failure taxonomy, the
orchestrator `session.json` diagnostic fields, and the operator recovery route for
a consumed or failed conduit are documented in
[agent-launch-conduit-diagnostics.md](agent-launch-conduit-diagnostics.md).

### Restart recovery of a committed worker

A managed worker attempt is recorded durably, keyed on its exact run tuple, from
before the spawn until the run resolves. The launcher's own identity and the
outer sandbox identity are both bound as non-reusable `(pid, starttime, boot_id)`
tuples, so a launcher restart no longer erases the attempt. See
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md) for the
protocol.

What this changes for an operator:

- A dispatch for a unit that still has a recorded prior attempt refuses. The
  refusal names the verdict — live, partial, ambiguous, unreadable, mismatched,
  unresolved, or proven dead. **The response is never to relaunch the worker.**
  Poll the same `monitor_handle` with `workspace_agent_run_status` for an
  undelivered attempt when it is available.
- A successful closed-input exact-slice commit is submit-for-review: it advances
  only the slice ref and durably moves that slice to `review`. After delivery,
  worker monitor handles, process liveness, and historical binding-pair
  uniqueness are irrelevant to reviewer admission.
- Continue a committed slice with
  `workspace_agent_dispatch(role="reviewer", subject="work record")`.
  The launcher resolves and freezes the exact committed slice ref/tip from
  canonical state. The reviewer receives full required read visibility and
  `write_scope: []`; the implementation slice retains its declared write scope.
- Reviewer and redteam results are append-only advisory evidence. Clean output,
  findings, reviewer count, and reviewer agreement neither authorize nor veto a
  corrective dispatch.
- A recovered run reports `final_result: null`. That means no agent report was
  captured across the restart — it is not a success, not a completion, and not a
  reason to skip the review.
- A `reserved` verdict means another dispatch for the same unit is already in
  flight. Nothing is wrong: wait for that run and poll its `monitor_handle`.
- A unit is not locked by the attempt that succeeded on it. Once the slice is
  integrated and the lifecycle is finalized, the launcher retires that attempt
  itself and the unit is dispatchable again. For corrective work, a proven-dead
  attempt is retired only while its exact reservation is atomically replaced and
  its mechanically authenticated delivered tip becomes the successor's base. No
  review outcome participates. A proven-dead attempt shown by trusted Git
  comparison to have delivered nothing also converges to a retryable unit.
  Retirement is launcher-owned; no capability deletes an identity record.
- A `partial` verdict means the launcher spawned a process it could not durably
  identify. That unit stays refused: the launcher cannot prove whether a process
  is still running, and the record is deliberately preserved rather than cleared.

  Resolve the underlying process question — the record is under the gitignored
  `.agent-launch/managed-run-identity/` store — and re-run the dispatch.

### Operator Follow-Up After Review

Follow-up implementation after a worker result must go through a WK-first
structured dispatch path with canonical `write_scope` and the normal
findings-only review step. Do not use direct shell model launchers for
post-review edits.
