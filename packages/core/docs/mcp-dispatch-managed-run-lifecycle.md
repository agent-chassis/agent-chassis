
# MCP dispatch managed run lifecycle

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
durable managed-run process identity, subject-addressed restart convergence, and
process-local monitoring versus restart-stable result authority.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## Explicit task lifecycle

The production task composition uses one prepared backend for `start_agent`,
`get_run_result` and `integrate_work`. Start preserves the existing executor,
provisioning, conduit and authority owners. Terminal settlement captures the
permitted original once as a producer action. A read performs no capture,
settlement, canonical write, Git mutation, integration, launch or rerun.

Worker delivery is an empty `workspace_deliver_work` request authenticated by its
launcher assignment. Only `integrate_work` for its exact returned delivery
requests integration and existing bookkeeping recovery. A saved disposition is
advisory input, never the request itself. Inspection, advancement, publication,
landing observation and canonical completion are distinct task boundaries.
Explicit completion is a `save_record` change with the native checks and receipt
semantics; no one-call closeout route remains exposed.

Lower-level lifecycle state names, journal events and stored producer identities
below describe their internal owners. They grant no callable retired monitor or
write route. The post-worker mutation owner is reached only by explicit
integration in this production composition.

## Settlement runs no proof verification

Delivery settlement, finalization, restart recovery and every
`get_run_result` observation execute no proof verification. The
lifecycle result and checkpoint carry no verification outcome. A managed
worker's explicit `verify_proof` calls are retained for its attempt
in the attempt journal and read by observation, as described in
[MCP Operation Reference](mcp-operation-reference.md#recorded-managed-worker-proof-verification).
They add no commit, integration, review or completion gate.

Final-slice settlement may prepare an authenticated terminal candidate, but that
preparation and subsequent cold recovery also execute no product validation or
proof attempt. They preserve candidate identity, materialization, dependency
integrity, and existing evidence bindings only. A coordinator requests any new
verification separately through the explicit verification operation.

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

Startup settlement distinguishes a terminal run outcome from positive evidence
that the child process has terminated. The shared supervisor exposes one current
callable observation which latches only when it receives an `exit` or `close`
event, or when the child already has a populated `exitCode` or `signalCode`.
Readiness rejection, timeout, an `error` event, an attempted signal, and an
unreadable pid can make the run outcome terminal but do not prove process death.
A real termination event arriving after such a synthetic outcome still latches
the observation. Provenance and conduit wrappers carry the same callable fact;
they do not create a family-specific liveness decision.

The run lifecycle samples that observation before either probing the supervised
handle or binding managed identity. Confirmed termination alone uses the wrapped
terminal probe, captures the result and typed conduit disposition, retires the
pending identity, settles the reservation, and then registers the terminal run.
A live or indeterminate startup is not probed at this boundary: its outer process
identity must bind before registration. If binding throws, including after an
exit races with the bind, pending identity and reservation remain protective and
the launch refuses; the race grants no retry or retirement authority.

Confirmed termination still registers the failed terminal run when pending
identity discard fails. The original startup or readiness cause remains primary,
while the discard failure is additive and reports the retained pending identity
and reservation. If discard succeeds but reservation release fails, the same
terminal run is registered with additive release residue and truthful retained
reservation state. Discard, release, and conduit cleanup each have one settlement
owner and run at most once. The generic launcher-owned no-output cause is
`probe_terminal_without_final_result` for both startup and later monitoring.

Only a registered run publishes a non-null top-level `run_id` and
`monitor_handle`. A refused backend response that carries a nested managed-WK
allocation preserves that allocation unchanged for lifecycle diagnosis, but its
top-level run and monitor identifiers are null because no process-local monitor
was registered. Conduit diagnostics preserve stable typed codes and validated
lifecycle tokens; producer-classified private `message` and raw `detail` fields
are omitted with field-specific `launcher_private_state` signals. This statement
does not classify or suppress arbitrary captured child output.

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

The retry id in a managed worker's execution tuple is the retry id of its
launcher-private provisioning pair, not a dispatch-side constant. A reissued
slice attempt is provisioned with the prior attempt's retry id plus one, so its
execution tuple carries that nonzero value. Before spawn, the launcher derives the
pending publication tuple from the pair it prepared for this launch, through the
same canonical constructor, and requires the pair's retry id to equal the
prepared attempt's. If the launch re-settles its provisioning because the WK tip
moved, the re-settled pair must derive the same tuple or the launch refuses before
spawn. That one tuple is then used for:

- the pending process-identity record and its sandbox binding;
- the `pending_published` journal binding;
- terminal-result publication;
- lifecycle-failure journaling, where the backend re-derives the tuple from the
  launcher-owned pair for the monitored run instead of accepting one from the
  monitor route;
- the post-worker lifecycle's binding lookup and host integration hand-off;
- proven-death assessment and retirement;
- cold recovery, which requires the retained pair to derive exactly the journal's
  execution tuple.

A lifecycle without a composed launcher binding resolver selects its pair
through the durable recovery owner by launch ref and subject, so no lookup
assumes retry zero. Proof-verification recording keeps deriving from the worker's
slice binding, which now agrees with the retained tuple for any retry. Any
disagreement in subject, launch ref, worker run id, binding run ids, or retry id
refuses. Reviewer process identity is unchanged and uses retry id zero.

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
through this attempt gate. When the retained binding pair's slice ref carries a
delivery that trusted Git shows is not yet contained in the binding's accumulated
WK ref, the refusal names that committed delivery as its unmet prerequisite; canonical slice
status, including a coordinator reopen, is not an input to that routing, and a
delivery the WK ref already contains is not routed to integration.

A prior-attempt refusal offers at most one call, and it is a read. The public
`start_agent` response carries `get_run_result` for the refused subject as
guidance in `next_calls` and `allowed_next_calls`, with `attempt_id` set to the
existing attempt's authenticated run identity: the recorded tuple, or the tuple
its reservation holder attached. That read starts no worker, allocates no
worktree, moves no ref, and neither retires nor integrates anything; the refusal
stays in force after it. For a committed delivery the read's own answer leads to
the authenticated delivery original, and integration remains the coordinator's
separate explicit `integrate_work` request for that original. A committed
delivery whose history elects no single attempt is read by subject alone. Any
other verdict with no authenticated tuple offers no call: the original blocker
is reported and no identity, retry or locator is supplied in its place. The
launcher classifies the read, the guidance owner builds it against the serving
registrar, and the response forwards it only for the exact refused subject and
only when the serving request contract accepts it; when it cannot be offered,
`observation_limitation` names why.

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

The backend also retains a process-local provisioning-attempt authority. Its
settlement is separate from durable pending-identity and subject-reservation
settlement. After recording an authenticated provisioned attempt, the managed
executor wrapper covers all synchronous preparation with one settlement boundary:
provisioning-binding recording, Git-binding derivation, result-mode resolution,
assignment presentation, repository-test definition capture, assignment minting,
and executor-packet construction. Any return or throw before that packet is
complete settles only the exact recorded tuple as never started, preserving the
original refusal or exception and retained worktree/binding evidence. Missing
definitions remain a refusal with their original path, commit and kind. The
outer lifecycle still owns pending-identity discard and reservation release;
a settled in-memory attempt alone authorizes neither durable release nor spawn.

Existing worker input checks run before bootstrap: canonical assignment and
scope, prospective source, test declarations/definition availability, backend
admission and assigned-source access. Served dispatch also performs shared input
inspection before admission-evidence refresh. The reserved lifecycle repeats
these checks and preparation binds the digest and source again under ownership
locks. Created binding/output verification remains after allocation. A failure
before family executor entry settles only this preparation's authenticated
effects and reports parent checkout usability or its precise retained-state
limitation; it preserves the original refusal and exact attempt. This does not
replace the attempt-state `recordProvisioned`/`recordExecutorResult` settlement
above, nor authorize cleanup after uncertain executor entry. See
[launch preparation](mcp-dispatch-launch-and-admission.md) for retained generation,
checkout synchronization and concurrent-winner boundaries.

Once the packet enters the executor, the existing executor-result rules apply:
refusal, throw and terminal status settle the attempt; an accepted running or
launching result retains its probe and liveness protection. Result recording is
outside the executor catch so a recording error cannot trigger a second,
throw-shaped settlement. A missing probe never establishes worker termination.
Both recording paths check the complete attempt identity; neither can settle a
foreign or superseded tuple.

This preparation boundary prevents new stranded attempts. An attempt stranded
in an already-running backend has no authenticated public operation that settles
this process-local map: durable observation and retirement do not mutate it.
The operator must replace the backend-hosting process to load the repaired code
and obtain a fresh process-local authority. Retained durable identities,
reservations and worktree bindings still undergo their ordinary authenticated
checks; restarting is not release proof and does not guarantee a corrected start
will be admitted. Do not delete lifecycle state or substitute a caller reset.

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
attempt whose integration is unresolved keeps its record, as does an attempt
recovered after a restart until its integration resolves.

A slice whose ref never advanced may use the proven-dead no-commit retirement
authorization above so the unit converges to a retryable state. That path is
disjoint from committed delivery and cannot integrate, mint acceptance, or
launch a replacement worker itself.

Within that retirement path a genuinely absent retained attempt and a typed
tuple-resolution failure are distinct answers, and neither may be reported as
the other. Genuine absence — no retained tuple to retire, or no proven-death
verdict for one — carries no retirement authority: the recovery poll defers and
the fresh-terminal classification fails closed on the ordinary typed
missing-delivery continuation, exactly as before. A typed binding mismatch, or a
malformed, corrupt, or unreadable retained binding, is not absence. It fails
closed carrying the tuple resolver's own stable technical code and bounded
cause, so it can never masquerade as a missing closed-input delivery, be
retried into one, or be relabelled as worker liveness, review, policy, or
recovery absence. Either way the exact slice ref is unmoved, no candidate is
constructed, no integration or retirement call runs, and no canonical record is
written.

Preserving that internal distinction grants no new public classification
authority. A tuple-resolution failure is not a branded closed lifecycle failure
carrier, so `get_run_result` classifies it with the generic
lifecycle failure code and message. Its typed code, message, detail, and stack
are published as the failure's evidence (see
[post-worker lifecycle failure reporting](#post-worker-lifecycle-failure-reporting)).

### Subject-addressed restart convergence

One pure owner beside the attempt-journal reducer projects attempts and selects
by canonical subject, optional exact backend run id, and immutable journal
prefix. Admission and observation consume that owner. The CLI retains storage,
partition locking, authenticated binding recovery, and liveness probes. The
current unreleased attempt owns the reservation; released historical attempts
are observation-only. Plural plausible attempts refuse as ambiguous rather than
selecting by time. A reservation with no execution binding remains
pending/indeterminate, and an unknown observation never authorizes relaunch.

Cold managed observation is limited to exact implementation slices. It requires
the existing journal tuple and authenticated retained binding pair, preserves
typed mismatch, corruption, stale, unsupported, indeterminate, and unavailable
diagnostics, and never fabricates a missing terminal report. After an observer
restart, an unreleased attempt's post-worker lifecycle continues under that
re-authenticated binding pair; a status the recovery did not select, or one naming
another attempt, gains no binding. Findings runs keep their process-local
observation contract and are not reconstructed from receipts.

#### Recovered child status derives from the retained result

A retained report never implies success. The recovered child status is derived
from the `result_mode` classification the launcher already made and already
bound into the retained result; cold observation consumes that classification
and never reclassifies, never asserts a status literal, and never infers one
from the mere existence of a report. Because `result_mode` lives inside
`result`, and the retained result event's `result_digest` covers `result`, the
classification is already inside the existing authenticated binding. No journal
payload, digest, or schema changes for this derivation.

The mapping is complete over the result-mode vocabulary:

| Result mode | Recovered child status |
| --- | --- |
| `structured_result` | succeeded |
| `configured_structure_invalid` | succeeded |
| `runtime_failure` | failed |
| `confinement_failure` | failed |
| `legacy_completion` | unavailable |
| `identity_unresolved` | unavailable |
| `missing_output` | unavailable |
| `neutral_prose` | unavailable (unreachable: its branch gates on the terminal-review roles, and result publication refuses non-worker records) |

`configured_structure_invalid` is the ordinary outcome of a successful worker
whose role result does not parse. It is the common case and is not a failure
signal. No child-influenced mode discriminates success from failure: the choice
between `structured_result` and `configured_structure_invalid` is decided by
parsing the child's own final-result text and both project success, while the
failure limbs key on launcher-owned record status, which a child cannot write.

An absent or unreadable result-mode fact projects a typed unavailable child
outcome, never success and never proven death. That outcome is projection-side
vocabulary requiring no journal payload: it carries a reason from the closed,
capability-shaped set `outcome_facts_unobserved` (no outcome fact was
established) and `outcome_facts_unreadable` (a fact is present but its
owner-produced envelope does not validate). No reason names a writer
generation. Because the launcher run-status vocabulary has no member meaning
"not established" and a recovered status is published verbatim, an unavailable
outcome asserts no status at all rather than borrowing one.

A non-success cold outcome publishes `child_terminal` and `terminal` as true —
the launcher publishes a result event only for a terminal worker, so child
terminality is established independently of the outcome — with `settled`
decided by the observing call as usual, no `lifecycle_resolution`, and no
`next_action`. The managed post-worker lifecycle is role- and status-keyed
rather than hot/cold-keyed, so it does not apply to a child that did not
succeed, exactly as for a hot failed worker. Cold is thereby made to agree with
hot; this projection is not created here. Disambiguating that absent resolution
between "no managed lifecycle applies" and "the managed lifecycle cannot advance
because the child failed" is a separate closure story and is not done here.

The retained result's bytes, tuple attribution, and durability reporting are
unchanged by the derivation. `started_at`, `updated_at`, and `exit` remain
absent from a recovered status because the journal records no timestamps and no
exit envelope; that is honest absence, and nothing the journal does hold is
dropped.

### Process-local monitoring versus restart-stable result authority

The existing single in-process runs map remains the hot observation and caller-
visibility owner. Crash recovery reads the subject journal only after that owner
cannot resolve the request. The journal adds exactly two informational events:

- `run_result_recorded: {dispatch_tuple, result_digest, result}`
- `lifecycle_failure_recorded: {dispatch_tuple, invocation_id, failure}`

They use the existing frozen attempt values, canonicalization, partition lock,
and crash-durable publication path. They may be appended to an authenticated
historical attempt without reopening it and never alter lifecycle transitions,
current-attempt election, liveness, reservation or release, integration, or
action authority. Result and failure replay is byte-idempotent and conflicting
payloads refuse.

The result event contains the complete normalized managed-worker report,
including original response and existing provenance and write-scope evidence.
Capture is synchronous; publication precedes any claim of crash durability and
precedes post-worker settlement consumption. Publication failure remains
explicit while hot captured bytes stay retryable. The exception is a missing or
mismatched authenticated execution tuple: the tuple is bound when the run starts
and cannot be supplied, minted or rebound afterwards, so settlement attempts no
publication and records a `repair_required` owned by the launcher
(`retryable: false`), which monitoring publishes as a required correction rather
than a retry (see
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md#full-final-result-and-compact-advisory-reference-contract)). Lifecycle failures receive one
invocation id at the shared invocation seam and are recorded once per actual
failed invocation. A retained failure that a later request does not re-attempt
records no further event, so the journal keeps one event per real attempt. Only
an authenticated completion of the exact delivery or a producer-verified relevant
correction makes a retained pre-integration failure eligible for another attempt;
a failure without a producer correction condition, and every missing, throwing,
malformed or undecided assessment, withholds (see
[retained failures](mcp-dispatch-monitoring-and-ownership.md#retained-failures-and-retry-eligibility)).
Retry facts themselves are never journaled and are never read back from the
journal: historical diagnostics are not retry authority. A journaled failure of
the exact attempt may only withhold. Exact totals and snapshot-paged complete history derive from
committed events; the five-entry process-local preview remains only a cache.

A positively established missing explicit-base `git merge-tree` capability is one
such producer-owned deterministic prerequisite. A later status request rechecks
it with bounded, non-mutating `git merge-tree -h` observation through the same
trusted asynchronous Git runner. The probe has an execution timeout and bounded
output, and its process owner does not resolve until a timed-out child is
terminal. Recognizable help that still omits the option leaves the retained
failure in place without integration or another failure event; recognizable
help that advertises it permits one newly authenticated attempt. While that
prerequisite stands — the first failure and every unchanged reassessment — the
status response publishes a bounded, advisory `required_correction`
(`workspace-agent-lifecycle-required-correction.v1`, `grants_authority: false`)
on `lifecycle_resolution` and, identically, at the top level beside
`next_action: resolve_lifecycle_failure_then_retry_run_status`. It names the
prerequisite `git_merge_tree_write_tree_explicit_merge_base`: the Git executable
selected by the serving launcher runtime must support
`git merge-tree --write-tree --merge-base`; correct that runtime's installation or
executable selection, then observe the same retained run again;
`retry_alone_repairs: false`. The lifecycle projection derives it from the retained
failure's own deterministic correction condition, and the route copies it
verbatim, so neither a detail read nor captured exception internals are needed.
A content conflict, another merge-tree execution failure, an undecided
assessment, an in-flight reassessment and a failure retained only across a restart
carry none; after a restart the escalation stands, because correcting Git does not
restore the lost correction facts. Timeout,
signal, spawn failure, and unrecognizable or indeterminate output report
assessment uncertainty, withhold the attempt, and never infer support or absence. Concurrent observers
single-flight the assessment and any permitted attempt. Each observer waits only
within its remaining request deadline; an observer deadline neither cancels nor
replaces the retained assessment, and concurrent or later observers rejoin it.
A restart retains diagnostics but not retry authority. Authenticated completion
of the exact delivery, including one whose record reconciliation is pending, is
observed through the continuation owner before the retry history is read or any
assessment runs, so neither an unreadable history nor a failing assessor hides
it. The first observation after a restart then adopts the attempt's journaled
failure as the retained failure and, absent completion, re-derives the
producer's current refusal read-only, or reports that the historical correction
cannot be established and which owner holds the missing facts. It never
integrates to find out; a currently supported capability alone does not prove the
historical failure was corrected.

### Independent findings action boundary

Every accepted findings dispatch is a new current-action operation. The launcher
authenticates the current canonical unit, empty effective write scope, purpose,
role profile, immutable source, controlled generation, dependencies, confinement,
client readiness, execution, and output for that call alone. It creates a fresh
run, monitor, source carrier, and action-private checkout. No mutable findings
checkout is shared between accepted calls.

A prior findings run, receipt, result, failure, role, generation, contract,
target, process fact, or other metadata cannot select, satisfy, suppress, resume,
replace, veto, or mechanically refuse a later call. There is no findings
equivalent-attempt selection, election, receipt-selected replay, continuation,
replacement, retirement, repair, cold recovery, settlement-conflict recovery,
or exact-slice retry identity. Identical requests still launch distinct actions.

Run and monitor registration is process-local. Immediate status and wait work for
a live handle registered by the current process; after restart an old findings
handle may truthfully be unknown. That loss does not affect advisory text already
returned by the original review, does not create recovery state, and does not call
for append, reauthentication, retry, replacement, or another review. A new review
is dispatched only when the coordinator independently decides new review work is
needed.

Original findings outlive that registry only once saved. An accepted findings
dispatch returns one exact status call for its run, and completed WK root or
slice findings status offers one entry-upsert call that saves the exact original
text with its run provenance, or the pinned read of a matching capture already on
that unit. The coordinator attaches the returned immutable entry reference to the
next unit's `material_refs`; frozen assignment materialization then delivers the
exact text without the original run. Status neither saves nor selects or
dispatches the next unit. See
[Durable work-record entries](mcp-operation-reference.md#durable-work-record-entries).

Logs and optional result metadata are action-local observations. Their absence,
loss, corruption, or capture failure cannot block a later action. Findings never
allocate or adopt persistent WK identity, persist a generation, integrate, mutate
CAS state, or create lifecycle authority.
The one narrow exception is a formally requested review attestation: a
`schema_constrained` canonical selected contract causes the original terminal
settlement to derive and durably publish the existing attestation before returning
it on that same result. Publication failure is reported there and never makes
captured advisory text unusable or creates a second append/recovery operation.
Implementation-worker allocation, persistent identity, receipts, recovery,
generation persistence, integration, CAS, and forge behavior are separately
owned and unchanged.

Role selects only the technical client, prompt/persona, confined tool profile,
result schema, and completion transport. It cannot select or reuse lifecycle
state.

### CCE policy and local mechanical recovery boundary

This lifecycle page is the normative owner of the boundary between configured
CCE policy and launcher-local mechanics. After the launcher authenticates the
repository, exact subject and target, canonical status and lifecycle history,
and any advisory review evidence, CCE alone owns the configured policy decision
and policy recovery. Canonical status, history, findings, challenge agreement,
disposition, and structured reviewer output remain bounded facts; none is a
launcher-local admission, activation, integration, remediation, or retry gate.

Local launch code may refuse only when an exact authenticity, integrity,
identity, committed-ref, or required-runtime prerequisite mechanically prevents
the requested operation. Any local recovery must identify that exact mechanical
failure and its supported retry or repair route. It must not infer a lifecycle
transition from status text or replace, supplement, or reinterpret recovery
returned by CCE. A monitor-bound instruction to retry
`get_run_result` with the exact subject and optional attempt id after an
incomplete launcher-retirement step is mechanical recovery; advice to activate a
parent, integrate a slice, remediate findings, or redispatch solely because of a
status tuple is policy and is not launcher-owned.

Under `decision` (repository-only: `wiki/decisions/decision.md`), historical runs and results are
evidence rather than gates for a current execution generation. Under
`decision` (repository-only: `wiki/decisions/decision.md`), findings-only output remains advisory
and grants no lifecycle authority. Public projections preserve the exact owning
boundary: CCE policy recovery is forwarded without local invention, while a
mechanical refusal reports only its exact launcher-owned recovery.

### Post-worker delivery without built-in review

Independent producer settlement publishes completion and its retained original;
it performs no integration and dispatches no review. `get_run_result` observes
those facts or the durable journal without advancing the post-worker lifecycle.
Only explicit `integrate_work({delivery})` invokes the integration owner for the
selected authenticated delivery. It resolves no review unit, freezes no review
surface, writes no review status and requests no review continuation.

That owner re-derives the exact minted commit chain, write-scope containment,
bound base, ref CAS and record CAS and applies configured policy. A refusal
retains the cause and any already-confirmed effects. An explicit later request
can retry an incomplete integration; observation never retries it. A successful
final-slice record CAS may move the parent to review through the existing
compound transaction. Integration and record reconciliation remain separate
facts, and result reads report rather than repair them.

### Post-worker lifecycle failure reporting

A post-worker lifecycle rejection records two separate things: a closed
classification and the unredacted evidence of what was thrown. Both are recorded
with the failure (the run's lifecycle checkpoint and the attempt journal's
`lifecycle_failure_recorded` event). `slice_lifecycle` publishes the
classification and the evidence's pure semantic projection; the complete
evidence is never published (see
[Pure failure observation](#pure-failure-observation)). The recorded evidence is
complete only when its `thrown.capture_failures` list is empty; anything the
encoder could not capture is listed there.

The classification is `error_code`, `error_message`, and, where a seam supplies
them, `candidate_failure` and `failure_cause`. A
rejection at a named lifecycle seam publishes that seam's code and fixed message
(below). Any other rejection publishes the generic pair: code
`agent_launch.slice_lifecycle.failed.v1` and message
`post-worker slice lifecycle invocation failed`. The classification is selected
by the seam, by launcher-private brands, and by identity attribution. It is never
selected by reading the thrown value.

The recorded evidence is the failure envelope's `evidence`. Every failure
envelope carries it, and a compact `evidence_summary` travels with it (operation, value type, name,
code, message, the number of capture failures, and `cause_chain`: each level of
the thrown value's cause chain by name, message, code, and scalar facts, as the
shared dispatch failure projection reduces captured evidence; a non-object level
is a final `{ "value": ... }`). The summary reads only the encoded evidence, so a
retained failure re-read from the journal summarizes identically. Evidence is captured at the
originating boundary, before any wrapping. The recorded encoding is never
redacted, and nothing is dropped without a `capture_failures` entry:

- `operation` names where the failure was observed: `seam:<seam>` for a named
  seam, `post_worker_slice_lifecycle_invocation` for any other rejection.
  `seam` repeats the seam, or is `null`.
- `thrown` is the encoding of the original value
  (`agent_launch.diagnostic_evidence.v1`). An `Error` keeps its constructor,
  `name`, `message`, `stack`, every other own property (`code`, `detail`,
  `errno`, ...), and its `cause` chain. Any other value is encoded by type.
  Non-JSON values are tagged with `$type`: `undefined`, non-finite numbers,
  `bigint`, `symbol`, `function`, `Date`, `Map`, and `Set`. A repeated or cyclic
  object becomes `{ "$ref": "<path of its first occurrence>" }`. A plain-object
  key that begins with `$` is escaped with one more `$`. Every own key,
  including `__proto__`, stays an own key of the encoding.
- An object the producer publishes beside the evidence is encoded once, in that
  sibling field, not again inside the evidence. Its first occurrence in the
  encoding is `{ "$type": "published_field", "field": "<sibling field>" }`, and
  any repeat is a `$ref` to that occurrence. The evidence together with the named
  sibling field is the complete input.
- `thrown.capture_failures` lists every inspection that itself threw — a getter,
  a proxy trap, a prototype probe — with its path, step, and the error's name,
  message, and stack. The failing value is encoded as
  `{ "$type": "capture_failed" }`. If the encoder itself fails, the evidence
  carries `evidence_capture_failure` instead of `thrown`.
- The 256-level depth budget bounds ONE encoded value, not the capture. A
  subtree deeper than that is re-rooted: the parent holds
  `{ "$type": "deep_segment", "segment": N, "continues_at": "<path>" }` and the
  subtree is encoded with a fresh budget as `thrown.segments[N]`, which may
  itself continue. `value` plus `segments` is therefore the complete input, and
  no `capture_failures` entry is produced, because nothing was lost. A repeat or
  a cycle becomes a `$ref` before it can be segmented twice, so the continuation
  terminates.
- The encoder (`packages/agent-launch-cli/src/lib/diagnostic-evidence.mjs`) has
  no dependencies, so any producer captures evidence without importing another
  owner.

A closed lifecycle failure carrier holds the same evidence on `evidence`. It
also exposes it as `detail.evidence`, the slot restart recovery reports as
`recovery_failure.detail`. Its `stack` is its own header, the seam, and then
`Caused by:` followed by the original stack, so the wrapper never replaces the
origin. `get_run_result` publishes that `recovery_failure` through
the shared dispatch failure projection: its facts, effects and returned policy
cross unchanged, its evidence becomes a `cause_chain` whose levels keep their
structured facts (a missing fork ref, a refusal reason), and the complete carrier
is retained once for the operator and named by `retained_evidence`. Cold recovery
is not latched. Each explicit `integrate_work` attempt that
reaches recovery and fails reports that attempt’s cause and retained evidence.
A `get_run_result` read only observes the recorded state; it does not retry recovery.

Producers keep their facts at the point of failure:

- The backend integration owner keeps the thrown error's reason, `detail`, and
  captured evidence on every non-integrated result. `detail` is published once,
  on the result; the evidence's `properties.detail` is
  `{ "$type": "published_field", "field": "detail" }`. That includes an admission
  refusal such as `trusted_commit_scope_mismatch` with its offending paths,
  checked write scope, reviewed and base commits, and counts. It also keeps the
  evidence of a retained-context recovery failure that fell through to fresh
  admission (`retained_recovery_evidence`), and the evidence of a failed CCE
  authorization call.
- The launcher-composed direct adapter forwards the complete non-integrated
  result, not only its nested refusal.
- The lifecycle's own refusals record the facts they were decided on: bound and
  expected identities, Git arguments, status, and stderr (the stderr stays in the
  record; the public projection names that it was withheld). A missing delivery also
  carries why the exact retirement could not be established. A continuation
  mismatch carries each mismatched field with its actual and expected value.
- A retirement exception during delivery finalization is kept as
  `cleanup.managed_identity_retirement.evidence`.
- A failure-history publication failure is kept as
  `failure_history_durability.publication_result`.
- Restart recovery keeps its `recovery_failure` code, message, and detail, and
  adds the complete original exception as `recovery_failure.evidence`.
- Lifecycle-failure journaling that cannot derive the attempt's execution tuple
  refuses with its existing `attempt_binding_mismatch` code and `cause_code`,
  plus the derivation failure's `evidence`.
- The launcher durable-state root refuses a failed filesystem operation with
  `operation` (`stat`, `realpath`, `lstat`, `mkdir`, `open`, `close`, `rm`),
  `path`, and the original exception as `cause`. Only `ENOENT` is reported as
  absence. A failed workspace `stat`, `realpath`, or `.git` observation refuses
  with `launcher_durable_state_workspace_unauthenticated`, and its reason says
  the path could not be observed or canonicalized;
  `launcher_durable_state_workspace_redirected` is reserved for an observed
  symbolic-link redirect. A root-chain component that cannot be observed
  refuses with `launcher_durable_state_root_unwritable` before anything is
  created. The exact-review receipt store rethrows that refusal with the
  complete refusal as `cause`, and the proof-verification detail read carries it
  in `cause_diagnostic`.
- The `get_run_result` exception boundary keeps its rendered
  `error_message` (a structured diagnostic's original value, unmasked) and
  publishes each cause level's name, code, message and scalar facts as
  `cause_chain`. The thrown value itself is retained once, unredacted, for the
  operator; `blocker.detail.retained_evidence` names its identity, and the
  public reader refuses it with no route.

The failure is recorded once per invocation, at the shared invocation seam,
however many callers observe it, and journaled whole as that invocation's durable
`lifecycle_failure_recorded` event. `slice_lifecycle` publishes its pure
projection. The internal lifecycle journal keeps each failure beside its `sequence` and
`digest`. Public `get_run_result` reports bounded failure facts and returned
original-member calls when the producer captured an original. The bounded
retained-failure ring (`latest_failure`, `retained_failures`) is a preview: it
keeps the classification and the `evidence_summary`.

#### Pure failure observation

Observing a recorded failure is a read. Compact result observation, original-member reads, an observation after a server
restart, the
proof-journal-unavailable diagnosis, a landing observation and final-result
publication all publish one pure projection
(`distillDispatchFailureDetail` / `projectRecordedFailureDetail` in
`dispatch-tool-helpers.mjs`), and none of them retains, records, executes or
launches anything to do so:

- Each captured exception becomes its `cause_chain`: every level's name, message,
  code and scalar facts. For a post-worker lifecycle failure's evidence, and for
  every other captured exception inside a lifecycle envelope (a record
  reconciliation's write failure, a retirement exception, a retry assessment's
  `assessment_evidence`, a durability defect's `publication_result` or
  `read_result`), each level also keeps its structured facts: an integration
  refusal's reason, offending paths and checked scope, and a merge-tree witness's
  typed facts (`argv`, identities, `process.status`, `process.signal`,
  `process.stderr_truncated`, `process.stderr_bytes`, `capability.name` and
  `capability.state`).
- Raw process capture is withheld wherever it appears: `stdout`, `stderr`,
  `output`, `captured_run`, `stdout_tail`, `stderr_tail`, and captured `stack`
  traces of this server's own code. A native spawn result keeps its own facts
  (argv, status, signal, errno, syscall); only its captured output is withheld.
- A captured test-failure diagnostic (`launcher-test-failure-diagnostic.v1`,
  validated by its schema owner) is the failing test's semantic answer, not a
  server capture: wherever it appears it is published through that owner's
  selected presentation, its message, location and call trace (`stack`)
  exactly. A field merely named `stack` anywhere else is still withheld.
- Each projection that withheld anything names it in `retained_evidence`:
  `{ retained, owner, audience: "operator", fields }`. The owner is the existing
  holder of the complete original — `post_worker_lifecycle_failure_record` for a
  published lifecycle envelope, `managed_worker_attempt_journal` for a history
  entry, `post_worker_lifecycle_checkpoint` for a resolution diagnostic,
  `dispatch_run_final_result` for a final result. A failure the read itself
  observed (an unavailable proof journal, a landing observation, an unavailable
  run detail, a refused recorded-verification read) is `retained: false` with
  reason `observed_by_read`: the read writes nothing, and repeating it observes
  the same failure again.
- The complete original stays byte-for-byte where its producer recorded it. The
  operator reads it internally (the attempt journal, `readOperatorOnlyEvidence`
  for a retained capture). No public route serves it: the generic content
  reader refuses operator-only retained captures, and a missing agent diagnosis
  is reported as the capture owner's gap, never substituted by an evidence read.

Only a failure's original recording seam retains a capture, once
(`projectDispatchFailureDetail` / `retainWithheldOriginal`): a dispatch launch
refusal's `originating_detail`, the explicit integration and forge-handoff
refusals, a failed cold recovery, and the dispatch and identity-contract route
handler exceptions. Every one binds to the one response environment the
composition root passes `registerDispatchTools` (`responseEnv`; the server
passes its process environment), never to an ambient default. A
`get_run_result` or landing-status handler exception is a read's
failure: it is published with `retained_evidence.retained: false` and reason
`observed_by_read`, and nothing is retained, recorded or retried. A recorded failure is never copied into a second
artifact. The public common reader presents a bounded observation and, when the
producer captured one, a semantic member selection of the authenticated original.
Reading a status or original performs no retry assessment, capability probe,
record reconciliation, journal append, process launch or capture. A cold journal
without a durable original locator states that limitation. There is no generic
spill reader or byte-reassembly continuation on this agent surface.

The terminal producer retains its permitted original once, then publishes
`run_original_recorded` through the existing locked attempt-journal owner. This
informational event contains only `dispatch_tuple`, the exact recorded
`result_digest`, and `original_result:{ref_id,sha256}`. Append and replay require
that attempt's prior immutable result and retained dispatch binding. Identical
publication is idempotent; conflicting or malformed linkage refuses. The event
changes no lifecycle, reservation, liveness, release, generation, WK tip or
integration fact, and may be attached to an already released attempt.

Producer pending lasts through capture and durable binding. The live locator is
preserved before binding, and `original_publication` reports `captured,bound:true`
only after successful worker binding. Binding failure reports `original_binding`
and the actual locked publisher outcome or thrown cause while retaining any
captured original. Reads neither retry publication nor cancel pending production
when a bounded wait expires. Completion notifications share the same operation.

After restart, an authenticated orchestrator selects the exact journal attempt
with existing subject/attempt inputs. The retained reader verifies repository,
authority and unit before exposing its locator, and carrier subject/run must
match that attempt. Emitted member calls return the same complete original,
including historical failure after source movement and later success. Selection
preserves ambiguity, and a durable result establishes no additional child status
or terminal fact. Assigned worker observations expose no orchestrator original
locator. These originals carry observation data, never delivery-receipt authority.

Retained original bytes, an immutable journal result and a discoverable original
locator are separate publication facts. A crash after retention can leave an
original readable through a held locator without making it discoverable from
the subject and attempt. Absence of that linkage stays explicit; observation
does not scan retained sources, backfill a journal event or recapture the result.

Evidence is diagnostic content only. Nothing in it selects a code, a
`failure_cause`, a phase, terminality, `next_action`, retry, or any integration,
continuation, or policy outcome. A thrown value or refusal that claims success,
authority, or a classification is published as evidence and classified exactly
as before. The explicit `integrate_work` route returns an
integration refusal with its typed code, reason and public blocker, plus the
admission owner's own facts (for `trusted_commit_scope_mismatch`: the offending
paths, checked write scope, commits and counts) and the admission exception's
`cause_chain`; its capture is retained once for the operator.

#### Seam-keyed lifecycle failure codes

`error_code` on `slice_lifecycle` is read by `get_run_result`, and a
rejection at one of the phased body's BRANDED
dependency seams publishes that seam's own stable code and fixed message instead
of the generic pair:

| Seam | `error_code` | `error_message` |
| --- | --- | --- |
| terminal candidate preparation | `agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1` | `post-worker terminal candidate preparation failed` |
| committed-slice integration continuation | `agent_launch.slice_lifecycle.committed_slice_integration_continuation_failed.v1` | `post-worker committed slice integration continuation failed` |
| managed-worker identity retirement | `agent_launch.slice_lifecycle.managed_worker_identity_retirement_failed.v1` | `post-worker managed worker identity retirement failed` |
| lifecycle binding resolution | `agent_launch.slice_lifecycle.lifecycle_binding_resolution_failed.v1` | `post-worker lifecycle binding resolution failed` |
| slice delivery inspection | `agent_launch.slice_lifecycle.slice_delivery_inspection_failed.v1` | `post-worker slice delivery inspection failed` |
| integrated slice reconciliation | `agent_launch.slice_lifecycle.integrated_slice_reconciliation_failed.v1` | `post-worker integrated slice reconciliation failed` |
| committed-slice integration | `agent_launch.slice_lifecycle.committed_slice_integration_failed.v1` | `post-worker committed slice integration failed` |

A code is a property of the SEAM the phased body names, never of the value that
was thrown: the same code is published for a typed refusal and for an arbitrary
throwable, and nothing is classified or matched to select one. Both
classification fields come from a fixed per-seam table, so
`error_message_truncated` stays `false`; the original message is in the
evidence. The nested closed `candidate_failure` projection described above
accompanies the terminal-candidate preparation seam only. The four pre-integration seams alone publish the closed `failure_cause`
described below.

At the preparation seam, the production candidate coordinator throws an ordinary
`Error` wrapper and keeps that failure's typed projection in its private
`WeakMap`. The lifecycle reads the wrapper's cause only through the coordinator's
read-only `projectAuthenticatedTerminalCandidateFailure` lookup. A wrapper the
coordinator minted keeps its exact typed code, for example
`controlled_generation_stale`. A `TerminalWkCandidateError` that reaches the seam
unwrapped is still classified by the leaf `projectTerminalWkCandidateFailure`.
Everything else publishes the fixed unknown form. That includes copied
`terminal_candidate_failure` or `code` properties, spread or inherited copies,
proxies around a real wrapper, code strings, diagnostic text, and failures from an
injected-runner coordinator. The carrier republishes only the closed code and the
approved Git detail keys: a coordinator projection's `git_operation`,
`git_status`, `git_diagnosis` and `ref_disagreements` survive unchanged, so the
lifecycle publishes exactly what the coordinator's forge, recovery and advisory
refusals publish for the same failure.

The pre-integration seams cover the launcher-owned binding resolution and the
lifecycle's exact subject and WK-ref checks over it; each resolution of the
launcher-bound slice tip; the read-only integrated-slice reconciler; and the
host-delegated committed-slice integration, whether the adapter rejects or
returns a refusal. Each seam wraps only its dependency call. A rejection raised
by what the lifecycle later decides about a successful result is not rebranded.

The integration-continuation seam is reached from restart recovery and from a
pre-integration attempt made eligible by an observed completion or a verified
correction, and both publish the SAME code, because they are
one dependency boundary and the envelope's own `phase` already distinguishes them.

An authenticated completed integration is never a failure at that seam. A
change to the slice's canonical write scope, before or after the integration,
neither hides it nor makes it refusable; the lifecycle installs it as integrated
without another integration request (see
[slice integration](mcp-dispatch-slice-integration.md)). A refusal at a later seam,
such as terminal candidate preparation, publishes that seam's code while the
envelope keeps `integrated: true` and the installed integration.

A completed integration stays authenticated after a later slice's legitimate
integration advances the WK. The integration result is immutable and names the
WK tip that integration produced; the live WK tip may since have moved. When an
earlier slice's original monitor is first observed after that movement, the
process that retained the completion does not compare the two tips. It
authenticates the same exact delivery and the same integration marker through the
read-only integrated-delivery observation at one current, bounded WK observation,
and installs that observation — current WK tip included — beside the retained
result. A cold observer after restart reaches the same observation through durable
recovery. Neither path re-integrates, dispatches, or moves a ref. A WK tip that no
longer carries that marker (rewound, rewritten, or unrelated history), a different
run tuple, or WK movement during the lookup refuses with the continuation
authority's existing reasons, and a failed Git read keeps its own classification.

#### Pre-integration failure cause

A pre-integration seam also publishes `slice_lifecycle.failure_cause`. It always
has exactly these keys: `kind`, `reason`, `diagnostic_code`, `diagnostic_kind`,
and `public_blocker_code`. Each `kind` fills them as follows:

| `kind` | Meaning | Populated fields |
| --- | --- | --- |
| `unexpected_exception` | The dependency rejected with a value the lifecycle did not produce. The seam code identifies the operation; the value itself is in the evidence. | all `null` |
| `lifecycle_refusal` | The lifecycle itself refused at this seam. | `reason` is one of the closed reasons below |
| `integration_refusal` | The committed-slice integration was refused. | `reason`, `diagnostic_code`, `diagnostic_kind`, `public_blocker_code` from the integration owner's registration; all `null` for an unregistered refusal |

The closed `lifecycle_refusal` reasons are:

- For binding resolution: `provisioning_binding_incomplete`,
  `worker_subject_binding_mismatch`, and `wk_binding_mismatch`.
- For delivery inspection: `git_command_failed` (the Git call reported
  failure) and `git_object_unresolved` (it answered no valid object id).

A seam publishes only the reasons it declares. Any other value at that seam
publishes `unexpected_exception`, including a lifecycle refusal made for a
different seam and a closed carrier from another seam.

The call site selects the cause, or reads it from an identity attribution. The
lifecycle's own Git and binding helpers record that attribution privately when
they create their refusal errors. The seam looks it up by object identity. A
copied, proxied, or lookalike error has no attribution.

Integration refusal classification comes only from the backend integration owner
(`workspace-agent-dispatch-backend-integration.mjs`). When it classifies a
non-integrated result, it registers a projection for that exact result object
and its nested refusal:

- `reason` is the producer's own reason string.
- `diagnostic_code` is the source code, but only if it belongs to the owner's
  closed integration diagnostic vocabulary. That vocabulary covers slice
  integration, CCE policy refusal, committed-slice admission, backend
  unavailability, and current-binding codes. Any other code is `null`.
- `diagnostic_kind` is the refusal's existing CCE classification,
  `returned_cce_policy_decision` or `configured_cce_evidence_failure`, when
  present.
- `public_blocker_code` is the owner's existing public blocker classification.

The lifecycle does not reclassify anything: it looks up the refusal its host
adapter returned by identity. A refusal that did not come from this owner in this
process — copied, serialized, proxied, or caller-built — is classified with all
four fields `null`. Its content is still published whole as evidence.

Every publication path rebuilds `failure_cause` field by field from these
vocabularies, and the retained-failure ring does the same. A widened or
inconsistent value is reduced to its closed fields. A hostile or unrecognized
value is removed. `failure_cause` grants no retry, recovery, integration, or
completion authority.

THE GENERIC PAIR STILL CLASSIFIES EVERY OTHER REJECTION. It applies to the
lifecycle's own typed refusals outside the named seams — missing delivery,
tuple-resolution failure, continuation mismatch, recovered-state refusals — and
to any rejection thrown outside the seams (including a copied or proxied
carrier). Those envelopes carry no `failure_cause`; their typed code, message,
detail, stack, and cause are in the evidence. Nothing about terminality,
`next_action`, attempt accounting, retry behavior, or the bounds of the
retained-failure ring changes.

## Managed server process-invariant fail-stop

A managed run's wiki-MCP server no longer survives its own violated invariants.
`packages/wiki-mcp/src/server.mjs` composes the one production diagnostic sink
and the one stdio shutdown controller and injects them into the process guards,
so `uncaughtException` and `unhandledRejection` emit one attributable terminal
diagnostic, preserve its boolean publication outcome, disable diagnostics, and
call `requestShutdown(1)`.

Server readiness is `controller.phase === "running"`, and `requestShutdown(1)`
leaves that phase synchronously. The cleanup hook then stops the server accepting
work during the controller's existing at-most-two-second drain, after which its
closure-private `terminateOnce` owner performs the single terminal action. A
handler-scoped throw is unaffected: it stays contained by the registered
operation boundary and the transport stays open.

For a managed run this means an escaped invariant surfaces as an ordinary
terminated child with the outcome the launcher already classifies, rather than as
a server that keeps answering tool calls after its invariants were violated.
`launch-isolation-spawn.mjs` remains the sole supervision,
termination-attribution, and outcome-record owner and is unchanged; the full
contract is in [runtime contract › Server readiness and process-invariant
fail-stop](mcp-dispatch-runtime-contract.md#server-readiness-and-process-invariant-fail-stop).

## Finalized delivery and cleanup convergence

Finalized delivery is immutable even when cleanup is incomplete. Once integration
and its canonical transition are proven, a worktree-release or managed-identity
retirement failure is reported as `delivery_state: "delivery_finalized"` with
`cleanup_pending: true`; it never rolls back the integrated result, replays
integration, relaunches the worker, or spends an observation call as an integration
retry. Hot polling and cold reconstruction reuse the same exact delivery and may
converge cleanup independently.

Exact-slice reviewer preparation and launch share one backend-authenticated
admission result. Preparation accepts the canonical review-unit selector, obtains
the exact base and reviewed commit from the launcher-owned selected-delivery
binding, normalizes them to one immutable repository/base/target/tree identity,
and captures the detached snapshot before attempt state. The registered public
route rejects caller-provided `reviewed_sha` or `diff_base_sha`; those scalar
spellings never enter preparation. Launch does not reconsult the ref or slice
status. A locator grants no authority and cannot reach implementation admission;
worker attempt recovery, generic status, and caller-carried mutation or lifecycle
claims cannot replace the normalized admission.

## Advisory review target and evidence

A findings-only managed run receives one normalized read-only target regardless
of whether the caller selected a canonical slice, a terminal whole-WK candidate,
or an explicit `{ diff_base_sha, reviewed_sha }` range. The launcher verifies the
commits, ancestry, nonempty range where required, readable tree, and exact private
snapshot before spawn. Selector syntax is not preserved as a lifecycle mode and
grants no mutation or lifecycle authority.

Each accepted call creates an independent advisory action. A malformed,
incomplete, missing-object, reversed, or disjoint range refuses only that call
before spawn, with caller-correctable details and no persistent recovery state.
A later valid call proceeds normally. Runtime failure likewise affects only its
own action; it does not select, resume, suppress, replace, or veto another action.

The historical `admission_review_target_unit` field, when encountered during
work-record parsing, is inert compatibility metadata. Launch, settlement, status,
receipts, evidence projection, and provenance do not require, freeze, compare,
repair, or publish it. A unit without that field launches normally. A reviewer
unit may use ordinary `depends_on` lineage to identify a predecessor review or
redteam result without any implementation-target annotation.

Clean, findings-bearing, invalid, absent, and failed outcomes remain available as
distinct evidence for coordinator judgment. They all carry the same mechanical
lifecycle posture: none changes status, authorizes or refuses implementation,
integration, forge, or completion, authorizes another review, or requires replay,
settlement, election, recovery, or retroactive metadata repair. Receipts and
provenance may describe an action but are never prerequisites for recognizing
that its review occurred.

The ordinary reviewer/redteam result is text-first. A captured response is
published as available and usable even when its optional structured parse is
non-adherent; bounded parser diagnostics annotate a separate schema observation.
Execution status, content availability, schema conformance, and formal-attestation
availability are independent facts. A failed execution with captured text keeps
that text usable, while an action with no captured text reports unavailable and
unusable solely because content is absent.

After authenticating the exact retained text and its source bindings, the original
source resolver includes normalized, deeply frozen `provenance.findings` only when
the existing schema and reported role/subject checks pass. Valid no-findings text
yields an empty array. Optional validation failure preserves the original advisory
prose without findings. This projection remains `advisory_only` with
`attestation: false`; it grants no approval, integration or lifecycle authority.

Formal attestation remains a separate explicit consumer. It alone may depend on
schema adherence. Its absence or a `schema_non_adherent` result does not alter the
underlying review occurrence or advisory usability, and never requests replay,
replacement, settlement, or recovery. Compact monitoring points to the complete
result; full monitoring returns the captured response for normal coordinator
disposition.

## Crash-durable state substrate

Durable attempt identity, subject reservation, journal, and lifecycle publication
depend on the shared [crash-durable state substrate](mcp-dispatch-runtime-contract.md#crash-durable-state-substrate).

## Subject-partitioned attempt journal

Managed-worker reservations use one subject-partitioned, digest-chained attempt
journal. This section describes its event bindings, reservation transitions,
release, and failure boundaries. The crash-durable publisher and existing
liveness oracle retain their separate responsibilities.

### Ownership

`packages/agent-launch-core/src/lib/managed-worker-attempt-journal.mjs` is the
sole owner of the attempt-event schema, the digest chain, subject partitioning,
current-attempt election, reservation legality, the release proof families,
transition legality, and the typed next command or subject-local refusal.

Everything in `agent-launch-cli` is an adapter over it:

| Module | Retained responsibility |
| --- | --- |
| `managed-run-process-identity-store.mjs` | Journal bytes, paths, and the token-owned partition lock. No semantics. |
| `managed-run-subject-reservation.mjs` | Typed-command construction and legacy result shaping. No election, legality, release classification, or mutable store. |
| `managed-run-attempt-supervisor.mjs` | The attempt-scoped supervisor's pre-spawn binding, termination record, and recovery authentication. It publishes an observation, never a verdict. |

The process-identity record remains, unchanged in role: it is the liveness
mechanism the existing oracle judges, not a reservation authority.

### Partitioning and the durable artifact

Each `(repository, subject)` maps to exactly one launcher-private partition at
`.agent-launch/managed-worker-attempts/v1-<sha256>/`, holding `journal.jsonl` and
its token-owned `lock/`. There is no global current-attempt file and no global
reservation whose unreadable tail can block unrelated subjects. A damaged
partition blocks exactly its own subject.

Every event binds the schema version, repository, exact subject, launcher-minted
attempt tuple, monotonically contiguous sequence, prior-event digest,
`generation_digest`, `wk_tip`, a closed event kind and payload, and its own
digest. The two identity fields are frozen at `reservation_claimed` and repeated
identically by every later event for that attempt. An unknown version, an extra
key, a sequence gap, a chain break, a content-tampered digest, or a binding
mismatch refuses that partition only.

The production dispatch path claims the reservation before resolving the
attempt's contract generation and accumulated WK tip. Its reservation adapter
therefore fills `generation_digest` with `reservation-generation:<reservationId>`
and `wk_tip` with `reservation-tip:<reservationId>`. These values identify the
reservation; they are not a canonical contract digest or Git commit. The journal
tuple also initially names the reservation, with launch ref
`managed-run-subject-reservation`, run ID equal to the reservation ID, and retry
ID zero. That reservation tuple is not the execution tuple and keeps retry id
zero. The launcher attaches the execution tuple, with the provisioning pair's
retry id, in the `pending_published` payload without replacing the frozen event
tuple or identity fields. Historical events are not rewritten. The adapter
can freeze explicitly supplied generation and tip values, but the current
dispatch caller supplies neither.

### Retired mechanisms

The following are retired and are no longer written by any path. Neither is
mirrored, and no decision reads either:

- the `subject-<sha256>.json` managed-run subject reservation record;
- its `.successor` shared successor-guard sidecar.

The guard existed because retiring a reservation and creating its successor were
two filesystem operations with an unreserved window between them, so a launcher
lost inside that window left a guard nobody could remove. Under the journal,
retirement and succession are one atomic append of a contiguous event sequence:
there is no unreserved window, and therefore nothing to reclaim. Contenders
serialize on the subject partition lock, which is released on exit and cannot
wedge a subject the way an orphaned guard file could.

### Transitions

The append order for one attempt is `reservation_claimed`, `pending_published`,
`supervisor_bound`, `spawn_started`, `sandbox_bound`, `execution_terminated`,
`delivery_observed`, the integration sequence, `attempt_terminal`, and
`reservation_released`. The transition table in the journal module is the single
source of that truth.

The lifecycle boundary is `spawn_started`. Before it, no sandbox can exist, so an
abandoned attempt is an unused election and may be terminally retired once its
owning launcher is confirmed terminated by the existing oracle. At or after it the
attempt is POSSIBLY LIVE: `attempt_terminal` is not a legal successor, absence of
`sandbox_bound` is not an unused election, and neither launcher exit, elapsed
time, canonical status, nor a missing process lookup may reclaim it.

### Release

The reducer alone accepts a release, and it recognizes exactly three proof
families:

1. exact attempt terminality with no unresolved execution;
2. authenticated proven death for the exact attempt; or
3. authenticated completed delivery settlement together with authenticated
   execution termination and no unresolved execution.

`done`, `cancelled`, missing WK or slice state, child exit, launcher exit,
elapsed time, PID-only probes, findings, and operator prose are never release
evidence and have no representation in the reducer. A release command whose
claimed proof is not the proof the reducer derives is refused rather than
downgraded.

A holderless or plural successor contender names no prior tuple, so nothing else
proves the current holder is gone. It may never supersede a live or
indeterminate owner; without that gate a contender could take a freshly reserved
subject from a running launcher.

### Staleness

The reducer can compare frozen identities with the optional
`currentGenerationDigest` and `currentWkTip` inputs. A supplied value that differs
marks the attempt stale and prevents it from authorizing further work while
retaining its reservation until exact authenticated release proof arrives. The
production reservation adapter supplies neither input, so its journal reduction
does not establish canonical contract-generation or WK-tip freshness.

Managed implementation dispatch separately resolves, persists, and verifies the
actual contract generation through the existing provisioning owner. After scope
settlement and pending identity publication, the launcher independently
authenticates the current WK tip and revalidates the allocated transition before
invoking the executor. These checks do not rewrite the reservation journal's
frozen identities. See [Controlled-contract generation is an implementation
pre-execution gate](mcp-dispatch-runtime-contract.md#controlled-contract-generation-is-an-implementation-pre-execution-gate)
for the generation and execution-binding contract. Integration, terminal
candidate construction, and publication retain their own authority checks.

### The attempt-scoped supervisor

Before the supervisor may spawn, the launcher durably binds its non-reusable
`(pid, starttime, boot_id)`, the digest of an unguessable spawn token, and a
private subject-local result slot. The token itself never reaches the durable
store, argv, or the environment: it is delivered over a launcher-owned private
file descriptor.

The supervisor is attempt-scoped, not a daemon: it spawns at most one sandbox,
waits for it, publishes one closed `launcher-supervisor-termination.v1` record
through the same crash-durable publisher, and exits. Because it is a separate
process it outlives its launcher, which is what makes a post-spawn crash
recoverable at all.

Recovery authenticates the token pre-image against the committed digest, the
exact repository, subject, attempt, frozen generation, frozen WK tip, and the
bound supervisor identity before the record may be submitted to the reducer as an
allowed exact-death input. Missing, malformed, mismatched, or unpublished
supervisor evidence is INDETERMINATE and retains the reservation. The record is
an observation; the reducer decides what it authorizes.

### Failure boundaries

The public taxonomy distinguishes at least: subject journal absent, unreadable,
invalid, or conflicting; attempt partial, live, dead, indeterminate, or terminal;
and supervisor termination absent or invalid. Raw paths, owner tokens, spawn
tokens, journal bytes, and exception text remain private. A typed mechanical
refusal is never translated into policy, and a policy refusal is never stored as
a mechanical event.

### Historical reservation census and migration boundary

`work record` migrates the retired legacy artifacts through an
evidence-only census rather than a drain.

`managed-run-historical-reservation-census.mjs` owns exactly two things:
authenticating and normalizing legacy evidence, and projecting the reducer's
answers into a bounded report. It owns no classification table, no transition
legality, no current-attempt election, and no release decision, and it cannot
append a journal event by any route other than a reducer-accepted typed import
command. `classifyLegacyImport` in `agent-launch-core` is the only migration
classification table.

Evidence is attributed to a subject only when the artifact's own bytes
authenticate an exact attempt tuple. A tuple-less reservation, an artifact whose
recorded subject disagrees with its tuple's assigned unit, an unparseable
artifact, and an unauthenticated corrective sidecar are all bounded operator-only
residue. Residue whose subject cannot be authenticated is attributed to no
subject, so it can never become a global dispatch gate.

The reducer projects each authenticated record into exactly one class:

| Class | Required evidence |
| --- | --- |
| Releasable: exact terminal | Authenticated terminal attempt with no unresolved execution |
| Releasable: proven-dead no delivery | Exact attempt identity, authenticated death, and proof the slice ref equals its bound base |
| Releasable: completed delivery | Authenticated completed delivery plus authenticated execution termination |
| Retained: live | The exact bound sandbox is live |
| Retained: possibly live | Spawn reached without an authenticated termination |
| Retained: indeterminate | Liveness or an exact effect cannot be authenticated |
| Operator-only residue | Corrupt, conflicting, unauthenticated, or unclassifiable evidence |

Possibly-live dominates: a spawn with no authenticated termination is retained
regardless of delivery, terminality, or base-equality. Only the three releasable
classes append anything; retained and residue classes are reported and write
nothing. File age, canonical `done`/`cancelled`/absence, launcher exit, a missing
process lookup, an ownerless artifact, a PID-only probe, and a historical
corrective sidecar are not representable in the evidence shape and cannot reach a
release.

Import is idempotent by exact legacy evidence digest: re-running the census
recognises an already-imported digest, reports the same class, and appends
nothing. Imports are submitted per subject under that subject's partition lock,
so damage attributed to one subject is quarantined in that subject's result and
cannot change another subject's outcome.

The report carries exact denominators — total artifacts, subjects, attempts, a
count for every class, and the bounded operator-only residue — and every artifact
lands in exactly one class, so nothing is silently dropped. Original legacy bytes
are preserved exactly where they are, under the existing launcher-private
retention boundary; the census repairs, rewrites, and deletes nothing.

**Operational residue.** Operator-only residue requires operator disposition. No
in-tree mechanism repairs it, and no later dispatch may treat it as an implicit
release.
## Independent findings actions (decision)

Every accepted findings call is a new advisory action authenticated only from
that request's current canonical unit and launcher-owned source selection. It
receives a fresh process-local run and monitor identity and a private immutable
materialization. Prior runs, receipts, results, failures, roles, generations,
process facts, or metadata cannot select, satisfy, suppress, resume, replace,
veto, or mechanically refuse the later call.

Status and wait observe only the owning process's run registry. After restart an
old findings handle may truthfully be unknown. A new call performs source
authentication, dependency/cache verification, materialization, registration,
and launch again; no receipt replay, election, settlement, repair, retirement,
cold recovery, or replacement path reconstructs the old action.

Receipts, logs, outcomes, and provenance are optional action-local audit evidence.
Failure to create or append them cannot change the current action's runtime
outcome and cannot prevent a later dispatch. Nonempty-scope implementation
allocation, persistent identity, receipts, generation persistence, integration,
recovery, ref reconciliation, and CAS remain independently owned and unchanged.
## Managed verify-proof capability

Eligible managed worker and reviewer sessions may receive
`verify_proof`. The role-access authority grants it to those two roles
only. A worker is bound to its launcher-authenticated assigned worktree. A
reviewer receives a separately minted authority for the action-private frozen
review materialization and independently executes the exact reviewed candidate;
worker results and receipts are never reused as reviewer proof.

The capability is not a general validation or process-execution surface. Its
request cannot carry a unit, candidate, path, target, command, environment,
provider, evaluator, receipt, policy, or authority. Candidate or controlled
generation movement invalidates the attempt. Its result is advisory evidence
with no review, dispatch, integration, admission, completion, CCE, lifecycle, or
policy effect, and existing findings-only review requirements remain unchanged.

## Assignment-change early stop

A durably accepted `request_assignment_change` is an alternative worker
completion. It does not deliver work. Producer settlement reads the exact
attempt's completion observation through the existing journal owner and records
`assignment_change_requested` as the semantic result after observed termination.
The host requires this attempt's private launcher stop capability before durable
acceptance. Acceptance emits a normal terminal event through the private lifecycle
pipe; the shared isolated-launch process owner immediately sends SIGKILL to its
owned confined worker, without a grace period for another model turn or report.
The accepted call stays pending. Completed and remaining work in the request are
the handoff; no later worker call is required or permitted. Multiple authenticated
connection generations reach the same attempt stop owner. Refusals leave the
worker usable and other attempts unchanged. Channel or signal failure after
acceptance retains consumed authority and the actual failure; pending acceptance
cannot prove death or authorize release.
Process status, exit/signal facts and actual producer/publication failures stay
independent. Child prose cannot mint acceptance, and absent or malformed final
prose cannot erase it.

Before unchanged-ref or missing-delivery classification, the post-worker
lifecycle consults that same accepted fact. An intentional early stop produces
neither `missing_closed_input_delivery` nor `no_commit_base_equal` retirement.
No delivery, integration, proof credit, canonical completion, checkout
finalization or destructive cleanup follows from acceptance or settlement.
Staged, unstaged and untracked work, the index, refs, prior evidence and frozen
assignment remain in place. Release and later separately authorized cleanup
still require their incumbent authenticated evidence and owners; acceptance
proves no process death and cancels no concurrent host test writer.
