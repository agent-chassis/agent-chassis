
# MCP dispatch runtime contract

`workspace_agent_dispatch` and its monitor routes are backed by one
launcher-owned in-process runtime. The runtime freezes the selected family,
role, work record or slice, managed worktree binding, read and write authority,
model registration adapter, host wiki-MCP server, named-FIFO conduit, and
lifecycle owner before spawning the role.

## Supported families

Confined Claude and Codex roles are supported when their runtime and bubblewrap
contracts validate. Worker, reviewer, and redteam sessions use the same R union
W namespace construction and write-scope enforcement; reviewers and redteam
have no writable repository paths. Claude preserves native-edit permission
settings and settings masking. Codex preserves its isolated runtime home and
launcher-generated configuration overrides. Agy remains unsupported and fails
closed.

## Launch and monitoring

`start_launch` validates readiness and starts the selected family executor
directly. `probe_run` reads the in-memory launcher run state directly. Run IDs
and monitor handles are launcher-minted correlation values and never accepted
as caller authority. Cancellation or any client, relay, host-server, or model
exit tears down the same per-dispatch lifecycle.

### The canonical initiative gates dispatch; other parent facts are observations

The canonical parent `IN-####` initiative is **mechanical ref identity**. The
launcher derives and verifies the exact `wk/IN/WK` and `slice/IN/WK` ref
namespace an implementation-slice launch commits into from it, so an
implementation-slice dispatch whose canonical parent declares no initiative, or a
non-canonical one, cannot name that namespace and is refused with the stable,
typed `missing_initiative_ref_namespace` decision code. That refusal is returned
before graph recovery, CCE policy evaluation, reservation, provisioning, worktree
allocation or mutation, backend launch, and spawn; the backend is reached zero
times. It is derived solely from the canonical record — never from caller input,
prompt text, or environment — accepts only the `IN-####` shape, and is **not** CCE
policy (local renders no admissibility verdict and cannot overturn a configured
CCE decision). It is the ONLY parent-level fact that gates local dispatch.

The remaining parent-lifecycle facts — non-empty parent `acceptance.criteria` and
`acceptance.validation`, and a predeclared, singular terminal whole-WK
findings-only review unit — are **not** a free/local implementation-dispatch
admission veto. An otherwise-valid implementation unit (with a canonical
initiative) reaches graph recovery, CCE policy evaluation, reservation,
provisioning, worktree allocation or mutation, backend launch, and spawn even when
its parent WK lacks parent acceptance arrays, or has no — or more than one —
`terminal_whole_wk` review unit. Parent review planning is organizational
coordination policy, not a technical prerequisite for spawning a confined
implementation worker; there is no `parent_lifecycle_contract_incomplete` dispatch
refusal.

Parent acceptance and terminal-review completeness remain an **observable
projection** that coordination or a configured CCE may consult, surfaced as a
non-authorizing fact — never as mechanical integrity or execution readiness. They
cannot set `dispatchable:false` locally, cannot prevent provisioning, reservation,
or spawn, and cannot overturn a CCE decision.

Terminal whole-WK review routing keeps its exact findings-target classification.
An eligible terminal review unit has `review_purpose` `terminal_whole_wk`, an
empty write scope, a reviewer slice dispatch intent, and a status that is neither
`done` nor `cancelled`. When exactly one exists it gives the terminal review
route one canonical identity; its absence is reported, never fabricated, and its
plurality is not an implementation-admission failure. Standalone and exact
committed-slice findings units keep their own classification, and reviewer and
redteam attempts against any of these targets remain unlimited, plural, and
advisory.

Removing the parent-planning veto does not weaken genuine pre-spawn technical
barriers: a missing or non-canonical initiative, the selected slice's own
acceptance and validation, malformed selected-unit input, invalid or non-canonical
paths, an invalid scope shape, unsupported confinement, missing
executable/backend/runtime capabilities, forged caller authority, a conflicting
live reservation, and exact subject or repository identity failure all still
refuse before spawn.

Managed worktrees are provisioned in-process from canonical launcher roots.
Before an existing slice branch is adopted, its tip is reconciled against the
canonical WK-derived base, and containment alone is never spawn authority:
reaching an executor additionally requires that no prior managed attempt is live,
partially published, ambiguous, or unresolved. The two gates are independent and
have separate owners — see *Orphaned and ahead slice tips refuse before mutation*
and *Durable managed-run process identity* below.

The dispatch-time canonical WK-record snapshot is committed onto the WK branch
without any disposable full-repository scratch checkout. The launcher seeds a
private throwaway index from the exact launcher-bound moving WK tip
(`wk_tip_sha`), replaces exactly `wiki/work-records/<WK>.json` with the freshly
hashed canonical blob, writes an immutable tree proven to differ from that tip at
that path alone, constructs one deterministic child commit whose sole parent is
`wk_tip_sha`, and advances the WK ref by expected-old compare-and-swap against
that same tip. The fixed WK fork in `base_sha` is unchanged and remains the
terminal candidate's parent. Nothing but the moving-tip tree and that one blob
is ever staged, so unrelated main-worktree or persistent-WK bytes cannot enter
the commit. The compare-and-swap preserves whether this transaction advanced the
ref or converged
on an equivalent concurrent winner; only an owned advance is ever rolled back, an
equivalent winner is never rewound, and a within-scope no-op that finds the WK tip
already at the exact record-only child converges on it rather than stacking
another commit. After the compare-and-swap the launcher proves ref-level coherence
— WK branch ref, the persistent worktree's HEAD symbolic-ref and branch
association, the atomically rebound binding, and the returned committed tip name
one state. The persistent WK worktree stays materialized-once (decision): its
index and working files may remain at a mechanically proven cleanly-older parent,
and provisioning performs no read-tree, reset, checkout, or other file
rematerialization against it. Failure compensation runs in reverse acquisition
order and restores only transaction-owned state; persistent WK resources are never
removed merely because one attempt failed.

An existing correctly associated deterministic exact-slice worktree is a resume
surface, not a clean-room allocation. Provisioning preserves and admits any
mixture of staged tracked changes, unstaged tracked changes, and untracked files;
it makes no porcelain-cleanliness decision and performs no reset, clean,
checkout, restore, stash, index reconstruction, deletion, or recreation. Dirty
bytes do not weaken the independent mechanical gates: deterministic path,
full/non-sparse checkout, branch association, exact HEAD/ref relationship,
repository and binding identity, symlink/type protection, active-run reservation,
and frozen scope authority still fail closed. Changed-path containment and final
validation are enforced by the closed-input delivery/commit boundary.

## Orphaned and ahead slice tips refuse before mutation

A slice branch that already exists is a continuation base only after it is
reconciled against the canonical WK-derived base. The launcher classifies the
existing tip as absent, equal, integrated, or orphaned. Absent, equal, and
integrated tips hold nothing the WK base does not already contain, so cutting
from them can hide no delivery and allocation proceeds. A tip that is ahead of or
diverged from that base is an orphaned, unreviewed delivery: it refuses with a
stable typed reconcile diagnostic before the WK tip is adopted as anything,
before any worktree is created or reused, before an attempt binding is published,
and therefore before any spawn. A canonical base that cannot be resolved is also
a refusal — an unresolvable base is never read as "nothing to compare against".

This classification runs twice, from one authority, with no time-of-check gap.
The provisioner runs it first at the very top of the per-WK critical section,
using only launcher-derived ref/ancestry probes — no worktree add or remove, no
`git status`, and no full-index scan — so an ahead, diverged, or orphaned tip
refuses before the worktree root is created, before the WK is adopted, before the
record is committed, and before any binding is written. The slice allocator then
re-runs the identical gate at use, so the early check is a fast-fail optimization
and is never sole authority.

The refusal reports Git facts only. It never infers that the prior worker
finished, never deletes or moves a ref, and never offers the unreviewed tip as a
continuation base: the recorded delivery stays exactly where the worker left it
and is addressable through the exact-slice review recovery route. Containment is
decided by the ancestry oracle alone; any Git failure while deciding it fails
closed rather than being read as either contained or orphaned.

Publicly the retained-delivery case is its own blocker,
`managed_slice_tip_reconcile_required`: provisioning is available, recovery is
coordinator-owned, and the route is exact-slice review through the monitor
surface — not the provisioning capability preflight. The refusal carries the
bounded reconciliation facts (state, slice tip, canonical base ref and sha,
recovery route, responsible actor, next action) at the top level of its detail,
so no caller has to read a nested source diagnostic to learn what to do, while
the substrate's own typed diagnostic is preserved underneath unchanged. The
blocker is narrow by construction: it is selected from the trusted substrate
diagnostic alone, never from caller input, and every other condition keeps its
existing code. In particular an unresolvable canonical base is an operator
reconciliation problem, not a review-recovery one, so it continues to report as
`managed_worktree_provisioning_unavailable` along with genuinely absent
provisioning and unrelated Git, configuration, allocation, or worktree failures.

This gate decides **Git topology only**. Whether a prior managed attempt may be
replaced by a new worker is a process-identity question with a single authority —
see below.

## Durable managed-run process identity

The dispatch run lifecycle is the single prior-attempt identity authority. It
consults the durable record described here before admission, scope freezing,
worktree provisioning, slice allocation, and executor invocation. No second
identity decision exists anywhere downstream: in particular the worktree
allocator carries none, because a duplicated gate there could only agree
redundantly, disagree, or silently no-op while reading as enforcement.

Identity reconciliation is required from launcher-owned managed-worker authority
— the worker role together with the composition root's managed-worker
provisioning fact — and never from the presence or absence of an optional
configuration block. When a managed worker requires reconciliation, the launcher
must be able to enforce it: absence of the identity root, the prior-attempt
resolver, the pending publisher, or the outer-identity binder is a stable typed
refusal naming the missing dependencies, returned before admission, provisioning,
or any executor invocation. An optional configuration value can never silently
disable the gate for a managed worker. Reviewer, redteam, operator-direct, and
genuinely non-managed compositions are unaffected: they spawn no confined managed
worker, so they have no managed attempt to duplicate.

A managed worker attempt is identified durably, not only in launcher memory. The
identity is a launcher-private per-attempt record keyed on the exact run tuple
(assigned unit, launch ref, run id, retry id) and published in two ordered
phases: a tuple-bound pending record carrying the launcher's own non-reusable
`(pid, starttime, boot_id)` is durable before the worker is spawned, and the
exact outer sandbox `(pid, starttime, boot_id)` plus its recorded kill shape are
bound synchronously before the dispatch returns accepted. No caller ever holds an
accepted launch whose sandbox identity is not already durable. There is no
broker, write-ahead log, daemon, generic run-durability service, or
caller-carried identity authority.

Both phases fail closed, and cleanup follows what was actually started. A
publication that fails before any spawn refuses and retires its own record. A
binding that fails after the outer process already started refuses and
deliberately LEAVES the record pending, so the unit reads as a partial
publication and refuses the next dispatch rather than admitting a second worker
beside a process the launcher cannot address.

Liveness comes only from the existing non-reusable identity oracle. A changed
`boot_id` proves the prior boot ended and is an unconditional dead verdict; a
recycled pid for the exact persisted tuple is a dead verdict by `starttime`
mismatch; an unavailable `/proc` is indeterminate and never reads as death. No
bare-pid liveness exists anywhere in the protocol.

For a durable BOUND attempt the bound outer sandbox identity is the worker
execution identity and is the SOLE authority on whether worker execution is still
live: a live sandbox is LIVE, a dead sandbox is a proven death, and an
indeterminate sandbox is unresolved. The launcher is a long-lived lifecycle
coordinator that may legitimately remain alive after worker execution has ended,
so its liveness is retained only as diagnostic evidence and never turns a
known-dead worker into LIVE — a bound attempt whose sandbox is dead is proven
dead even while its launcher still runs. Launcher liveness stays authoritative
only before the sandbox is bound: a PENDING record is a partial publication that
refuses under every reading, and an abandoned pre-attempt reservation is
reclaimable only when its owning launcher is proven dead and it published nothing
that could still be running.

One canonical constructor owns the tuple, and publication and recovery both use
it. The run id in the tuple is the launcher-minted WORKER run id. The retained
worktree bindings of one attempt carry that id plus a launcher-minted suffix, so
recovery derives the worker run id from the retained MAIN binding and
independently proves the slice binding pairs with it; it never adopts either
binding's suffixed id and never strips a suffix off an untrusted string. A pair
that disagrees on the worker run id, launch ref, retry id, or assigned unit is a
typed binding mismatch that fails closed through the existing recovery refusal,
never a silently absent record.

Every durable read is a closed schema. Exact top-level keys, schema version,
state, tuple shape and scalar types, role, both process identities, the
`published_at` shape, and the kill shape are all validated before a record is
used, together with the state invariants that tie them together — a pending
record carries no bound-only field, a bound record carries no retirement, and a
retired record carries the authorization that retired it. The recorded kill shape
is validated through the canonical kill-shape validator and must address the
exact bound sandbox pid; it remains descriptive, and recovery is
observation-only. Malformed, extra-key, cross-tuple, invalid-pid,
inconsistent-kill-shape, and invalid-timestamp records all produce a stable typed
fail-closed verdict rather than an untyped exception escaping recovery.

Before an implementation executor is invoked, the registered dispatch surface
consults this state and takes an atomic per-subject reservation in the same
launcher-private store. Only a pre-delivery unit with no ACTIVE recorded prior attempt may launch. Live,
partially published, ambiguous, unreadable, tuple-mismatched, and unresolved
states all refuse; a record reused across launcher tuples is a binding mismatch,
not a near-enough match. A proven-dead no-commit attempt may be retired for a
later implementation retry. A committed slice is never relaunched or resumed
through this attempt gate: its canonical `review` state and exact committed
target admit the reviewer directly.

The reservation is what makes same-subject exclusion atomic rather than
check-then-act: two concurrent dispatches mint different run ids, so a
tuple-keyed publication alone never excluded them from each other. Exactly one
caller acquires the subject — across launcher processes sharing the repository,
not merely within one process — and the loser receives a typed prior-attempt
refusal before admission, provisioning, allocation, or spawn. A launch refused
before anything was spawned releases only its own reservation; post-spawn
uncertainty retains the reservation together with its record. A reservation whose
owner is proven dead and that published no record is reclaimable, because the
fixed publication order proves nothing was spawned; every other held reservation
stays blocked and auditable, and a stale owner can never release or reclaim a
newer reservation.

A durable attempt is retired through a launcher-owned state transition — never a
file deletion, and never an operator or caller capability — once its safety
purpose is provably complete. Three authorizations exist: the slice was
integrated and its lifecycle finalized; a launcher-owned exact findings receipt
supersedes the attempt with a corrective worker on the same slice, which requires
that the prior delivery was reviewed so nothing unreviewed is discarded; or the
attempt is proven dead and trusted Git comparison shows its slice ref still
equals its authenticated base. Each authorization additionally requires the
proven-dead verdict and is re-validated against the record, so a pending, live,
partial, ambiguous, unreadable, or indeterminate attempt is never retired and
evidence for a process that may still exist is never erased. Retirement is
tuple-bound, so an older attempt can never retire or supersede a newer one; it
releases that attempt's subject reservation, which is what keeps a unit from
being permanently locked by the attempt that succeeded on it; and the retired
record remains on disk carrying its reason, verdict, and evidence. A committed
attempt whose review or integration is unresolved keeps its record, as does an
attempt recovered after a restart until its exact-slice review resolves.

A slice whose ref never advanced may use the proven-dead no-commit retirement
authorization above so the unit converges to a retryable state. That path is
disjoint from committed review and cannot prepare a review surface, integrate,
mint acceptance, or launch a replacement worker itself.

### Subject-addressed restart convergence

Managed exact-slice dispatch converges after ordinary orchestrator and backend
restarts. A restarted coordinator holds no process-local monitor handle, no
unique historical binding, and performs no operator repair: it re-issues the same
structured dispatch for the same canonical subject, and continuation is derived
only from configured repository identity, the exact canonical subject, durable
current reservation and attempt state, and canonical Git and WK state. The subject
reservation names the current attempt, so a plurality of accumulated historical
records is assessed mechanically and is never, by count alone, `ambiguous` or an
operator-recovery state; ranking, guessing, deletion, and uniqueness across
history are not required.

A mechanically live current attempt is never duplicated. It is returned as an
observable continuation that re-exposes the launcher-minted run and monitor
identity from durable current state, so the new orchestrator needs no prior
possession of the handle and is never told to recover the subject by supplying a
prior launch ref. The re-exposed handle is an observation only: the supported
convergence action is a subject-addressed re-issue of `workspace_agent_dispatch`
for the same canonical subject, which observes the still-live attempt and asks the
coordinator to reissue that dispatch once it settles. A restarted coordinator is
never directed to `workspace_agent_run_status` or `workspace_agent_run_wait` with
the old process-local handle — a cold backend holds no in-memory run for it and
would answer only `monitor_handle_unknown`, so neither the refusal `recovery_route`
nor the continuation `next_action` for a live current attempt names those routes.
A committed delivery continues from canonical exact-slice state
— either a mechanically authenticated corrective supersession of the delivered
tip, or, when that is not applicable, a committed-review continuation — and
consults no worker monitor memory or historical-binding uniqueness. A proven-dead
no-delivery attempt (its slice ref still equal to its authenticated base, proven
from the retained binding resolved through the durable record's own launch ref,
never a caller-supplied handle) is retired through subject-addressed durable
facts, its reservation released and replaced atomically, and the exact subject
made launchable again without the old monitor handle.

Within restart-state convergence specifically, the refusals are a closed set:
invalid caller input, attributable corrupt current state (an exact current record
that exists but cannot be read; an unrelated corrupt or historical file for a
different attempt never blocks a subject whose current record is readable),
contradictory immutable Git facts, or a genuinely indeterminate live conflict that
cannot be safely duplicated. Caller-supplied handles, tuples, bindings, liveness,
environment, or recovery claims still grant no authority. This closed list scopes
only convergence; it does not narrow or suppress the ordinary typed pre-spawn
blockers — malformed selected-unit input, invalid or non-canonical paths, an
invalid scope shape, unsupported confinement or sandbox, missing
executable/backend/runtime capabilities, MCP/server transport gaps, credential
failures, forged caller authority, and the identity-enforcement-unavailable
composition fault — which remain separate and unchanged.

Delivery, reviewer admission, and integration use distinct authority. The
launcher-minted worker run identity authenticates the closed-input commit call.
That successful exact-slice commit advances only the slice ref and durably
performs the implementation-to-review transition. Once canonical state is
`review`, direct `workspace_agent_dispatch(role="reviewer", subject=<exact
slice>)` derives admission from the launcher-resolved committed ref/tip and its
trusted commit binding, without consulting worker monitor state, process
liveness, managed-run identity, or historical binding-pair uniqueness. The
reviewer has full required read visibility and empty mutation authority. Only an
applicable evidence remains bound to that frozen target.
Ordinary status and wait calls remain scoped to their server-minted monitor
handles; no subject-only committed-worker recovery is part of review admission.

The separate `workspace_integrate_committed_slice` operation may integrate that
committed slice into the accumulated WK tip. Reviewer and redteam results remain
independently retained, exact-target-bound advisory evidence: active, clean,
findings-bearing, missing, and malformed results neither admit nor veto integration.
The orchestrator may accept, reject, or defer individual comments when requesting
the operation, but those dispositions are not authorization. The server re-derives
the exact target and CCE alone supplies any configured organization-policy decision.
If no CCE gate is configured, the operation follows decision free-substrate behavior
and reports its non-audit posture. If a gate is configured, missing, unavailable,
malformed, unratified, denied, or target-mismatched CCE evidence refuses before ref
or status mutation. Review completion itself never calls or authorizes integration.
When the WK becomes terminal and quiescent, the runtime freezes repository
identity plus the launcher-bound base `B` of the persistent WK lifecycle
(propagated from the WK identity binding's `base_sha`, base_ref `main`) and the
accumulated WK tip `W`; constructs the deterministic squash candidate `C` such
that `tree(C) === tree(W)` and `C`'s sole parent is `B` (`tree(C)` is resolved
directly with `rev-parse <W>^{tree}` and `C` is created with `commit-tree` — no
`merge-tree`, no current-landing-tip resolution); creates or recovers the fixed
`refs/agent-launch/terminal-current-v2/<WK>` ref by expected-old CAS; and
materializes a separate private mode-0700 full detached checkout. The WK ref and
worktree remain assembly state and are not the terminal review checkout.

The runtime verifies the complete `B/W/C/tree/parent/ref/checkout` binding,
runs every canonical whole-WK validation against `C` in the read-only reviewer
composition, then binds the final findings-only reviewer to `C` with `B` as diff base (`B..C`). Public
`workspace_run_validation` input remains exactly `{unit,target}`; candidate,
checkout, dependency, process, environment, argument, and ref authority is
launcher-resolved. Reviewer result consumption rechecks the same frozen
contract and candidate binding. Validation and reviewer output are advisory;
passing evidence does not admit and failing evidence does not veto integration.
A result belongs only to that exact cycle;
restart uncertainty causes validation and review to run again.

A technical failure while constructing or restart-recovering `C` refuses reviewer
dispatch **before spawn** and preserves the real cause rather than fabricating an
exact-candidate disagreement. Candidate `C` is the deterministic squash of the
launcher-bound base `B` and the accumulated WK tip `W` (`tree(C) === tree(W)`,
sole parent `B`); construction and recovery run only ordinary object-store
operations — `rev-parse`, `cat-file`, `rev-list`, and `commit-tree` — and never a
landing content merge, so no `merge-tree` runs and the retained `conflict`
taxonomy code is unreachable in v2. A typed candidate error keeps its exact stable
`agent_launch.terminal_wk_candidate.*` code (for example `git_failed` from a
nonzero Git execution such as status 128 / read-only object store) and its bounded
mechanical Git detail (operation/args, exit status, bounded stderr), classified by
the command's mechanical result rather than by parsing prose; an unexpected cause
is retained as its bounded `unknown_cause` code/name and message. Neither
projection exposes stdout, environment, credentials, or stack traces. The
refusal returns `accepted:false` with no reviewer run, monitor handle, executor
invocation, fallback candidate, or alternate ref, and grants no review,
integration, publication, validation, or CCE authority.

## Post-spawn conduit failure is a terminal run outcome

A stdio-MCP conduit failure discovered AFTER a spawn was accepted is published as
a terminal run, never as a launch-admission refusal. Both supported families
attach one shared supervised-probe wrapper before any post-spawn readiness wait
can fail, and that wrapper projects the retained typed conduit error as a
canonical lifecycle probe result: status `failed`, terminal, carrying the known
child exit and final-result evidence plus the stable family-neutral conduit
blocker reason and its bounded detail. The blocker reason and detail are
preserved on the run's terminal missing-result envelope, so a run that died
because its required wiki-MCP conduit died is distinguishable from a run that
merely produced no report. Claude does not refuse admission after an accepted
spawn.

Run-state polling fails closed on probe shape. A non-null probe result without a
normalizable run status — an admission-refusal envelope, a bare object, an array,
a scalar — is a lifecycle contract violation and terminalizes the run with a typed
`probe_result_status_invalid` missing result. It can never leave an accepted run
indefinitely `launching`, and it can never be silently discarded. Valid running
and terminal probes keep their existing semantics.

Conduit cleanup has one ownership path and one memoized settlement. Client
termination, relay shutdown, host-server reap, FIFO retirement, private-directory
removal, and descriptor disposal settle exactly once; child exit, cancellation,
the executors, and the terminal probe projection all await that same settlement,
and no terminal result is published before it completes. Concurrent status and
wait callers coalesce on it. A cleanup failure remains typed and terminal rather
than being masked or discarded.

That settlement exists from before the first resource is acquired, so a partial
create, a launch refusal, a cancellation, and a native non-conduit failure all
settle through the same owner. The originating failure is always preserved; the
cleanup failure is composed onto it additively, never in its place. The host
server's `error`, `close`, and `exit` events converge on one terminal finalizer,
a spawn that never produced a process is recorded as terminal instead of waited
for, and termination is a bounded TERM-to-KILL escalation against the live child
handle that returns only after actual process completion. That escalation is the
launcher terminating its own server, not the server being lost: the cleanup owner
marks the exact child before it signals, and the finalizer records no server-exit
failure for a termination carrying that mark, so tearing a healthy conduit down
cannot rewrite a successful run as a failed one. The mark is refused once the
child has already settled, so a host server that died on its own — before, during,
or without any cleanup — still produces its typed server-exit failure. A resource
whose early release fails stays owned and is retried by the settlement. The
launcher drains its own conduits' settlements on catchable `SIGINT`, `SIGTERM`,
and `SIGHUP` and then re-raises the signal; `SIGKILL` and a hard crash stay an
operator-recovery case, and no daemon, periodic reaper, broker, or cleanup
service is introduced.

## Cleanup-only terminal failure and reviewer-verdict validity

Aggregate run status and reviewer-verdict validity answer different questions and
are established separately.

The aggregate status reports what happened to the RUN. When the launcher's own
conduit cleanup fails, the run is published `failed` and keeps its typed cleanup
blocker and its cleanup residue. That is never laundered into a success, never
suppressed, and never redacted; it stays visible and operator-actionable on the
public envelope.

Reviewer-verdict validity is a separate fact, established from trusted structured
evidence plus the launcher's own cleanup-only evidence. The conduit's terminal
projection computes a frozen `cleanup_only` discriminator at the launcher
boundary and it is re-validated on read. It is true only when the primary typed
blocker is exactly the stable cleanup reason — readiness failure, abnormal server
exit, relay failure, and cancellation all outrank cleanup and can never present
as cleanup-only — AND the supervised child was observed to complete with exit
code `0` and no terminating signal. It is derived from structure only: never from
prose, stderr, substring matching, or the mere presence of a final result.

One shared launcher-owned predicate decides verdict eligibility for every
consumer, so the review-result projection and durable receipt outcome cannot
drift. A reviewer verdict is usable when either the ordinary
succeeded-reviewer rules hold, or ALL of: the role is exactly `reviewer`; the run
is terminal with aggregate status `failed`; the run carries the validated
cleanup-only conduit disposition; the preserved child exit is code `0` with no
signal; and the preserved final result carries a schema-valid
`agent-role-result.v1` bound to that exact run's role and subject.

In the cleanup-only case the verdict remains available as exact-target evidence:
the durable receipt records the structured outcome, a
`cleanup_only_terminal_failure` disposition, and `verdict_evidence:
"verdict_recorded"`, while `terminal_run_status` stays `failed`. Each review is
retained independently by run id and monitor handle. Clean and findings-bearing
output are advisory evidence only. Neither outcome consumes the target, prevents
another reviewer or policy-allowed redteam dispatch, or directly permits or
prevents a boundary mutation.

This exception is reviewer-only and does not make arbitrary failed worker or
reviewer output authoritative. A genuinely failed child, a nonzero exit or a
terminating signal, a readiness/server/relay failure, a cancellation, a malformed
probe result, a wrong role or subject, a malformed or unbranded structured
result, and prose-only output all remain unusable — with or without a cleanup
failure alongside them. These dispositions affect only that run's evidence. A
failed, cancelled, malformed, transport-failed, clean, or findings-bearing review
never changes whether another exact-target review may be dispatched.

## Plural exact-slice review evidence

Exact-slice findings-only review is plural. Every valid reviewer or policy-allowed
redteam dispatch against the canonical committed target receives a distinct run id,
monitor handle, execution state, and receipt. Active reviews and any amount of
historical receipt state never block another dispatch. Restart does not turn review
history into an admission latch.

Receipts are append-only per-run evidence bound to the exact subject, committed
SHA/tree, diff base or base parent, role, run identity, monitor handle,
structured-result digest, and terminal disposition. The complete applicable set is
evaluated; a latest-receipt projection is never review admission or the complete
review set. Target movement makes old evidence inapplicable without rewriting or
deleting it.

Findings-only reviews are advisory, not admissions or vetoes. Clean and
findings-bearing results may coexist indefinitely, and reviewer disagreement remains
visible in the retained evidence set. Active, missing, or malformed review output
also carries no boundary authority and never blocks another review. The separate
trusted integration operation is exactly-once and CAS-protected; it consumes only
the configured CCE policy decision for that boundary, or an explicit decision
free-substrate/no-gate posture. Paid CCE availability does not itself configure a
gate or imply either authorization or denial.

Worker and reviewer concurrency is expected. Launcher-minted attempt identities and
isolated worktrees/runtime state distinguish attempts; short critical sections and
exact ref/status compare-and-swap protect shared mutations. Process identity supports
observation and cleanup only. It is never review authority or a historical
per-subject dispatch prohibition.

## Exact-slice review-surface state budget

Slice-review preparation freezes and re-proves a closed, authority-bound state
budget rather than a repository-global snapshot. Bound state is the worktree
identity digest, canonical worktree path, linked Git directory, resolved common
and object directories, object alternates, the target worktree's own
registration fields (path, HEAD, branch, and the absence of bare, detached,
locked, and prunable), the launcher-bound slice ref, the worktree's symbolic
HEAD and HEAD commit, the reviewed commit and tree, the bound base commit and
tree, the ordinary index, and the physical checkout. Any drift in that budget
fails closed before reviewer launch.

The bound-ref set is exactly the target worktree's slice ref and its HEAD.
In-progress sequencer pseudorefs — `MERGE_HEAD`, `CHERRY_PICK_HEAD`,
`REVERT_HEAD`, `REBASE_HEAD`, `BISECT_HEAD`, and `AUTO_MERGE` — are refused when
present, because a mid-operation worktree is not a stable review surface.
`ORIG_HEAD`, `FETCH_HEAD`, every repository ref outside the bound-ref set, and
the registration, HEAD, and branch of every non-target worktree are explicitly
unbound: concurrent unrelated ref churn and movement in another checked-out
worktree cannot invalidate an otherwise identical review surface.

Object identity is bound by resolved path, not only by readability. A
substituted object or common directory, or an added or changed alternates
entry, fails closed even when every required OID stays readable elsewhere, and a
missing or wrong-type reviewed or base commit or tree object always fails
closed.

### Safe postcheck mismatch diagnostics

A state-budget refusal names which bound fact drifted. The dispatch surface
republishes that name, and nothing else, as an additive
`postcheck_mismatch_field` on the thrown-diagnostic envelope, so an operator can
distinguish a moved slice ref from a substituted object directory without host
log access.

The projection is an allowlist owned by the dispatch surface, not a pass-through
of producer detail. It applies only to the exact
`agent_launch.slice_review_materialization.postcheck_failed.v1` code; the detail
must be an own, plain-object, exactly-one-key `{ field }` shape carrying a plain
data property whose string value is a member of the closed bound-field enum.
Arrays, null prototypes, class instances, accessors, non-enumerable properties,
additional string or symbol keys, nested values, unknown values, and every other
diagnostic code omit the field entirely. This is what keeps the sibling refusals
under the same code — which carry `git status` porcelain and raw stderr — from
ever reaching the envelope. No cause, path, stderr, secret, or arbitrary detail
transits this seam, and existing envelopes are otherwise unchanged.

The additive field survives every public projection of both monitor routes: the
`workspace_agent_run_status` and `workspace_agent_run_wait` catch seams, the
terminal-worker lifecycle `slice_lifecycle` reconstruction on either route's
accepted response, and the `run_wait` wait-window-expiry projection.

That last one matters because a postcheck refusal's next action is
progress-capable, so `run_wait` keeps polling and leaves through the timeout
projection when its deadline expires — making that envelope the only response a
waiting coordinator ever sees for this failure. It therefore carries
`slice_lifecycle` alongside `lifecycle_resolution`. The bounded retained-failure
ring inside `lifecycle_resolution` keeps its fixed four-key entries; the latest
attempt's full typed envelope is where the discriminator lives on both routes.

All three publication points pass through one re-gate against the same frozen
15-member vocabulary, so they cannot drift and a widened producer cannot widen
what is published. Carrying the diagnostic never promotes the run: a timed-out
response stays `timed_out: true`, `terminal: false`, with `child_terminal` and
`next_action` reporting exactly which wait expired, and a refusal is never
rewritten into success, finalization, or an automatic retry.

## Empty and no-op slice deliveries

Commit-object materialization stays first: the immutable tree and commit objects
are written before any check, so every check binds to one immutable object rather
than to a re-read worktree. An empty trusted changed-path set is not a third
commit blocker: once structural write-scope containment succeeds, the exact-slice
delivery performs the same implementation-to-review transaction as any other
delivery. A within-scope zero-delta delivery still publishes an authenticated
server-minted child — its single parent is the launcher-authenticated base and
its tree equals that base tree — and advances the exact slice ref to that child
through the expected-old compare-and-swap. `empty_delivery` is reported from tree
equality, never from an unchanged ref. A replay materialized from a prior real
delivery leaves that exact delivery reachable as the new child's ancestor; an
equivalent same-tree child converges idempotently on the already-published winner
and never hides, discards, or replaces it.

When a managed worker terminates successfully, the post-worker lifecycle
mechanically separates an authenticated delivery from a missing one before any
review or integration, and the exact slice ref is the witness: an unchanged ref
is ALWAYS the absence of a committed delivery, and any authenticated delivery —
empty or not — has advanced it. An **authenticated delivery commit** is a slice
ref advanced past its launcher-bound base with a server-minted commit chain. It
may carry a nonempty delta or be a **genuine zero-delta child** whose tree equals
the base tree; either way it advanced through the expected-old compare-and-swap
and takes the full real-delivery path, retaining server-minted chain
verification, write-scope containment, object and target-stability checks, and
the exact-parent assertion — which a same-tree child satisfies because its sole
parent is the launcher-bound base. `empty_delivery` is that tree equality, not
ref identity. A **missing delivery** is an unchanged slice ref with no
authenticated closed-input delivery at all: the worker changed authorized files
but never invoked the closed-input commit, so the delta is unpublished. A missing
delivery is not a committed slice. It enters neither review-surface preparation,
slice-level review, nor integration; it moves no ref; it preserves every
unpublished worktree byte untouched; and it is retired only through the exact
proven-dead `no_commit_base_equal` path into a finalized, non-integrated,
retryable continuation the coordinator clears by re-dispatch — no ref deletion,
worktree cleanup, historical binding enumeration, or operator repair. Canonical
status, worker liveness, process exit, monitor possession, and reviewer output
are never delivery authority.

For every authenticated delivery — nonempty or zero-delta — exact-ref
publication and canonical review persistence form one truthful success boundary.
The ref is advanced only by
`update-ref <slice-ref> <new-commit> <authenticated-prior-tip>`. If the canonical
implementation-to-review write throws, returns an invalid result, or does not
prove that the exact selected slice reached `review`, the server compensates only
by `update-ref <slice-ref> <authenticated-prior-tip> <new-commit>`. It never
forces, infers a restore target, or overwrites a concurrent update. A lost
compensation race or ref-store/read failure is a typed partial-transaction result
carrying the bounded ref, published commit, authenticated prior tip, observed tip
when known, and canonical-transition disposition. No partial path reports
committed or submitted success.

Replay equivalence is authenticated delivery identity, not commit SHA. The
current exact slice tip converges only when its single parent is the exact
launcher-authenticated base, its tree is the delivered tree, its exact target is
the launcher-resolved slice ref, and its server-generated delivery subject/base
line plus `Wk-Slice` trailer match that slice binding. This permits two
independently materialized commits with different wall-clock metadata to converge.
A different base, tree, target, binding, or delivery marker conflicts. After a
failed publication CAS the primitive re-reads that exact ref: an equivalent winner
converges, a different winner refuses without overwrite, and an indeterminate read
fails closed.

The closed-input materializer uses a throwaway index, so advancing the attached
slice ref does not rewrite the retained worktree's ordinary index. Canonical
committed-slice reviewer admission accepts exactly two index states: already
reconciled to the reviewed target, or still equal to the authenticated diff base.
In the latter state it independently verifies the target's changed-path set,
tracked modifications and deletions, added and ignored files, blob contents, and
file modes against the reviewed commit. An arbitrary staged state, extra file, or
filesystem drift refuses before reviewer spawn. Trusted integration owns the
later base-to-target index reconciliation after the independent CCE policy boundary.

Integration re-derives the remaining delta independently from immutable Git
objects rather than trusting commit-time or lifecycle bookkeeping. It applies the
exact slice target to the current accumulated WK tree with `git merge-tree`. When
the resulting tree equals the current WK tree, integration succeeds
idempotently with `empty_delivery:true` and leaves the WK ref byte-identical. The
slice tip may equal the WK tip, be its proper ancestor, or name content already
accumulated by another integration. No delivery receipt, worker event, review
result, status, dependency state, liveness fact, or retained worktree is required
to establish that applying the requested object would change zero bytes.

The same coordinator-owned lifecycle transition is then permitted. Findings,
clean output, malformed or plural review evidence, and absent historical attempt
state remain advisory facts; configured CCE policy is the only policy gate. A
non-empty remaining delta continues through the normal immutable-object
application, conflict detection, and expected-old WK-ref compare-and-swap. A
missing or malformed required ref/object, an uncomputable delta, a real content
conflict, or a lost compare-and-swap remains a technical refusal. Replay repeats
the same object calculation, so an already integrated delivery converges without
losing or overwriting accumulated content.

## Monitor-route terminality and lifecycle side effects

The monitor routes are not read-only for a managed exact-slice worker run. The
post-worker lifecycle is driven by polling: every `workspace_agent_run_status`
and `workspace_agent_run_wait` call on such a run advances the same lifecycle,
which observes the durable exact-slice `review` state, prepares the slice-review
surface, performs later canonical lifecycle writes, and mutates integration refs
through the trusted runtime. It neither mints nor repairs the commit-time
implementation-to-review transition. Callers must treat both routes as
state-advancing, not as pure reads.

Public terminality therefore splits in two. `terminal` is true only when the
complete managed run is finalized — the child terminated and its post-worker
lifecycle reached the `finalized` phase. `child_terminal` reports only that the
dispatched child process ended, and can never make an unresolved
pre-integration or awaiting-review run look final. Child completion evidence
(`status`, `exit`, `final_result`, `review_result`) describes the child and does
not contradict `terminal:false`.

An unresolved run carries a `lifecycle_resolution` projection with the exact
lifecycle phase, `integration_complete:false`, the latest retained typed
failure, bounded attempt metadata, and an actionable next step; a transient
failure is retained across polls and the retained history is a fixed-size ring
whose latest entry always survives. `workspace_agent_run_wait` bounds the whole
call by the caller's `timeout_ms`: after the child exits it keeps waiting on the
same deadline for the lifecycle to finalize, and returns promptly — with that
exact lifecycle action as `next_action` rather than the generic retry string —
when the lifecycle is blocked on an action polling cannot perform. A finalized run replays a byte-stable
terminal projection on both routes. This projection is monitoring vocabulary
only: it grants no authority and does not change review, integration, or
candidate semantics. Full field-by-field meanings are in
[MCP operation reference](mcp-operation-reference.md#managed-run-terminal-semantics).

## Wiki-MCP boundary

See [MCP integration](mcp-integration.md). One host wiki-MCP process directly
terminates two named FIFOs bound into the client's bubblewrap namespace. The
client uses a pinned copy-only relay and completes initialize plus tools/list
against the exact role tool profile. No executable MCP runtime is mounted into
the sandbox.

Candidate validation is launcher-owned and executes inside a findings-only
reviewer bwrap composition. Its child process starts from an empty,
fixed, secret-free environment with fresh private `HOME`, `XDG_CONFIG_HOME`, and
`TMPDIR`. It sees verified ordinary project dependencies through a read-only
projection; workspace links resolve against the exact reviewed checkout rather
than another worktree. Manifest, lock, workspace, installation-
marker, realpath, and freshness checks run before and after execution. No
dependency installation or copying occurs, and no wiki-MCP package,
interpreter tree, server, broker, listener, or transport is added to the
candidate checkout or bubblewrap namespace.

Reviewer dependency projections are immutable, installation-bound, physically
verified, atomically published, and restart-safe. Their identity binds the
normalized projection base and exact reviewed checkout to byte-verified
manifests plus a digest of the coherent installation marker and complete
projected dependency-entry plan. Construction occurs in a private sibling
directory; the launcher rechecks installation identity, makes the projection
read-only, syncs its metadata and directory, then publishes it by atomic rename.
Concurrent builders either publish that same content-addressed generation or
verify and reuse the winner.

Directory presence alone is never projection authority. Every reuse verifies
the closed identity metadata, exact entry set, entry types and link targets,
read-only modes, and a fresh installation snapshot. A legacy stale directory is
ignored, an interrupted private build is never mounted, and an invalid partial
published generation is atomically quarantined and rebuilt without deleting
canonical dependencies or other valid generations. If installation state moves
during construction or verification, the launcher retries against the new
digest and fails closed if it cannot obtain a stable snapshot.

The projection is mounted read-only at the exact `<candidate-checkout>/node_modules`
path. Because that checkout is read-only inside the reviewer sandbox, the shared
launch planner materializes exactly that empty untracked mountpoint before
confinement, pins its path, directory type, and filesystem identity, and
re-checks them immediately before spawn for both Codex and Claude. A symlinked,
redirected, non-directory, non-empty, tracked, preexisting-untrusted, type- or
identity-swapped destination, or a writable/runtime bind overlapping the
checkout, mountpoint, or dependency source, refuses before spawn. The mountpoint
is the only permitted checkout addition; the candidate commit, tree, tracked
state, refs, index, Git metadata, and projected dependency contents remain
byte-identical, and neither the checkout nor the dependency source is made
writable.

## Trusted operation ownership

| Operation | Owner |
| --- | --- |
| `start_launch` | launcher runtime, in-process |
| `probe_run` | launcher runtime, in-process |
| `provision_worktree` | launcher runtime, in-process |
| `prepare_slice_review_surface` | launcher runtime, in-process |
| `integrate_slice` | launcher runtime, in-process |
| `prepare_terminal_candidate` | launcher runtime, in-process |
| `validate_terminal_candidate` | launcher runtime, host-side and in-process |
| `bind_terminal_candidate_review` | launcher runtime, in-process |
| `commit_slice` | host wiki-MCP server, in-process and closed-input |
| `wk_forge_handoff` | launcher-owned host executor, invoked in-process |

Every failure is returned in the structured dispatch or runtime-blocker
taxonomy. There is no compatibility route to another process boundary.

`wk_forge_handoff` receives only backend-resolved exact candidate state plus
exact-candidate-bound advisory review evidence. Clean output does not authorize
publication, findings do not veto it, and missing or mixed review output does not
decide the boundary. The orchestrator request is also non-authorizing. CCE alone
decides a configured organization-policy gate bound to exact `C/B/W`; missing,
unavailable, malformed, unratified, denied, or target-mismatched CCE evidence
fails closed. Paid-tier presence alone configures no gate. With no configured
gate, decision free-substrate publication proceeds with an explicit non-audit
posture. The host publishes exact `C` against the configured base branch without
merge-base calculation, merge-tree, commit-tree, replay, rebase, squash, amend, or
other reconstruction; it does not require `C`'s parent to equal the current
base-branch tip and does not preflight or locally resolve merge conflicts. The
exact remote candidate branch is observed around publication as forge transport
integrity. Movement of the current landing after `C` was constructed neither
changes `C`'s frozen base parent `B` nor blocks publication; git/forge and the
configured merge actor own merge readiness, so a conflicting or unmergeable PR is
still a successfully handed-off exact candidate. Absent candidate
branches may be created, exact branches reused, and differing branch targets are
reported as transport disagreement. Handoff observes the exact
repository/base/head proposal set and creates at most one pull request when none
exists, recovering a single exact open or already-merged proposal without
duplication; an ambiguous, identity-mismatched, closed-unmerged, or unobservable
proposal state refuses. Mergeability is never a local veto — an exact open but
conflicting or unmergeable proposal is still a successful handoff — and merging,
approval, rebasing, branch updating, and conflict resolution remain with the
configured forge and human merge actor. The
operation does not merge.

Loss of process memory, a monitor handle, or a prior in-memory binding does not
invalidate the terminal cycle. On restart, trusted runtime first reads exactly the
fixed `refs/agent-launch/terminal-current-v2/<WK>` ref. When present, it
mechanically verifies the target. Immutable `C` metadata binds repository
identity, the base `B`, `W`, the canonical contract digest, expected tree, and
sole parent. Recovery hashes the complete deterministic commit bytes in the
repository object format and compares that identity with the current-ref target
while `W` remains unchanged. Current landing movement is not candidate movement
and is never consulted: frozen `B` comes from `C`'s verified sole parent (the
candidate's `Base:` metadata line), never from current landing or a computed merge
base. Present-ref recovery does not invoke `commit-tree`, create an object, move a
ref, or compare current WK status, dependencies, or record bytes with the frozen
contract. A v1 candidate — whose message marker and landing parent differ — fails
the v2 metadata reader and is never recovered as a valid v2 candidate.

An absent fixed current ref means no candidate was ever published for this WK.
Cold recovery has no launcher-bound base to reconstruct one from — and `B` may not
come from current landing or a guessed merge base — so cold recovery fails closed
rather than constructing a guessed candidate. The hot post-worker lifecycle, which
holds the WK identity binding's `base_sha`, is the sole constructor of a new
candidate: it freezes `B` and `W`, deterministically constructs `C`, and creates
or advances the fixed ref with expected-old CAS (covering the first candidate
cycle and the restart-before-CAS path). Legacy per-candidate refs are never read,
enumerated, counted, ranked, validated, migrated, preserved, or interpreted. Any
number may remain physically present without affecting construction, review,
restart, or publication.

Construction snapshots the fixed ref's exact old value before materializing `C`
and advances it only with `update-ref <fixed> <C> <expected-old>`. Same-input races
converge on the same deterministic object; different-input races have one CAS
winner. A crash before CAS leaves only an inert object, and a crash after CAS is
recovered from the fixed ref. If `W` advances, the next cycle constructs a new
candidate, CAS-replaces the fixed ref, and binds validation and review to that new
SHA. Evidence for the prior SHA remains advisory and does not carry forward.

The fixed ref selects the exact commit an operation addresses; it is not an
authorization state. Ref membership, candidate history, review output, validation
results, WK or slice status, dependency state, landing movement, and forge state
are not local admission or veto authority. CCE alone owns configured policy, and
the configured forge and human merge actor own proposal and merge state.

The same role-neutral reconstruction is terminal-reviewer restart admission.
Before selecting any generic findings-only route, the backend resolves the one
canonical `terminal_whole_wk` contract unit. An existing in-memory context is
used only while its exact candidate, checkout, canonical contract, and immutable
installation-bound dependency projection still verify. If that context is
absent or invalid, launcher-owned recovery re-verifies the durable
`repository/unit/C/B/W/ref/tree/sole-parent/checkout/dependency` binding from the
existing candidate, reruns the canonical validation targets through that
projection, and binds the reviewer to the private detached candidate checkout with
`B..C` as its only review range and no repository write authority. An absent fixed
ref fails closed here as well; only the hot lifecycle constructs a candidate.

Parent WK status does not select candidate identity, recovery authority, the
reviewer checkout, or fallback behavior. Missing process memory never permits a
canonical terminal reviewer to use `main_repo` or generic `start_launch`; any
missing, ambiguous, or disagreeing required Git fact other than normal current-ref
absence is a typed technical refusal before spawn. A genuinely standalone findings-only review unit with no terminal
candidate contract remains on its distinct generic route. Terminal reviewer and
redteam attempts remain plural and advisory: concurrent or historical attempts,
findings, and result history neither reserve the candidate nor affect recovery
admission.

## Dispatch-readiness generated write surface

Graph-index refresh may use the fixed eight exclusively claimed candidate names
`.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. An existing persistent shared lock
prevents candidate attempts; slot exhaustion falls back to an independent
atomic build. Candidate files are retained but never reused or authoritative.
