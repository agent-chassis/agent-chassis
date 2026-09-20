
# MCP dispatch managed run lifecycle

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
durable managed-run process identity, subject-addressed restart convergence, and
process-local monitoring versus restart-stable result authority.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## One-call closeout with forge-owned completion and truthful check results

Closing a WK is one call. Recording the closure or the status transition, and the
generated-view and lint work that transition requires, are mechanics of that same
request rather than a chore handed back to the caller.

- **One explicit request, one canonical write.** `workspace_work_record_set_closure`
  accepts an optional explicit `status: "done"`. Supplied, the authored closure
  patch and that final transition are composed into a single validated canonical
  write through the same CAS, persistence and completion-policy owners, so a stale
  digest, an invalid field or a persistence conflict leaves neither of them
  applied. Omitted, the same route records closure information and changes no
  status: authoring closure and completing a unit stay distinct requests.
  Completion is never inferred from authored prose, a completing slice never
  closes its parent, and `workspace_work_record_set_status` remains the route for
  a status change on its own.

- **One call, one executor.** A closeout mutation that lands runs
  `generateAndLint` once, against the workspace it just wrote, and reports that
  executor's actual result. `generateAndLint` remains the sole executor of those
  checks; the closeout route decides only when they apply. A completed check
  emits no follow-up generate/lint instruction, and no second report is authored.
- **Not every transition has something to check.** When nothing was written, when
  what was written is invalid, or when the transition is not a closeout one, the
  checks do not apply and the result says which of those it was instead of
  running anything.
- **No canonical mutation, no checks.** A valid request that changes no canonical
  bytes leaves the repository in exactly the state its last verification already
  observed. It preserves those bytes and their digest, executes zero post-write
  checks, and reports them as not run; only a mutation that actually changed the
  canonical record runs `generateAndLint`, and it runs it exactly once.
- **Input validation precedes classification.** A malformed expected digest, a
  digest that does not match the loaded record, or an invalid field is answered
  before the request is classified, so a stale or malformed assertion can never
  ride an otherwise identical unchanged request to a reported success. Storage's
  under-lock compare-and-set remains the authority over a race that lands between
  the read and the write.
- **Uncertainty stays uncertain.** Where canonical publication could not be
  established, the result says so. It is never degraded into a write that was not
  applied, a rollback, or a safe retry.
- **Results are truthful, including the bad ones.** A lint that ran and failed is
  reported as a failing lint with its exact error and warning totals. An executor
  that could not run at all is reported as not run, with its own cause code, and
  never as a passing check. Neither claims the completed write was rolled back:
  the record was written, that stays true, and the result says so.
- **Nothing is invented.** No waiver, accepted risk, follow-on, disposition or
  proof credit is added by a closeout call, and unknown effects stay unknown.
- **Ordinary completion and forge confirmation have distinct authority.**
  An ordinary status or composed closure/status write must not be refused solely
  because the record has `completion_policy: forge_confirmed_merge` and the
  requested status is `done`. This applies to both edit composition and shared
  validated persistence. Completion policy is enforced only through an actual
  returned CCE decision; absent a decision, mechanically valid writes proceed.
  Schema, CAS, identity, integrity and publication checks remain in force, and
  each refusal identifies its mechanical failure or returned policy decision.
  Marking a record `done` supplies no evidence that a forge merge occurred.
- **Forge confirmation remains authenticated.** The trusted forge helper retains
  its exact candidate, pull-request head and mergeability checks, two
  work-record-only closeout commits, confirmed merge and exact reconciliation.
  An unconfirmed merge remains unconfirmed regardless of local record status;
  reconciliation failure after a confirmed merge remains typed partial success.
  Ordinary edits neither invoke those operations nor manufacture their evidence.
  Non-forge and operator-authorized direct-`main` paths require no fabricated
  candidate, forge or proof dependency.
- **A bounded result still leads to the whole one.** A run with more findings
  than the compact preview reports exact totals and names its own complete
  retrieval, preserving every error class and its selected evidence. No internal
  task or hidden helper is needed to continue.
- **The original result is retained, not replayed.** A closeout call asks its
  executor for the complete result, not a default page of it, and retains the
  complete permitted receipt once through the same response owner an oversized
  result already uses. The bounded frame carries that retained answer's
  authenticated content reference in `full_result`, and
  `workspace_read_mcp_content_reference` reads it back. Retrieval is a read: it
  performs no second write and runs no second check. Re-calling the mutation is
  never the route to the detail, because the mutation has already landed and
  repeating it is a no-op that runs nothing and returns no findings. The
  generator's own target directory and build never appear in what is retained or
  returned.
- **A retained original that could not be kept is disclosed.** When retention
  fails, the call still reports exactly the effects it had and the checks it ran,
  and says the original detail is unavailable. It never advertises a reference
  that cannot be read, and it never converts a transport failure into a claim
  about the write.
- **An unknown publication stays unknown.** Where storage could not establish
  canonical publication, the response says so and keeps the cause: `written` is
  null, `publication_state` is `unknown`, and the closeout half reports
  `publication_unknown` without running checks over an indeterminate tree. It is
  never reported as a write that was not applied, a rollback, or a safe retry,
  and the caller is told to inspect the canonical record rather than repeat the
  write.

## Settlement runs no proof verification

Delivery settlement, finalization, restart recovery and every
`workspace_agent_run_status` observation execute no proof verification. The
lifecycle result and checkpoint carry no verification outcome. A managed
worker's explicit `workspace_verify_proof` calls are retained for its attempt
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
WK ref, the refusal names `workspace_integrate_committed_slice`; canonical slice
status, including a coordinator reopen, is not an input to that routing, and a
delivery the WK ref already contains is not routed to integration.

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
carrier, so `workspace_agent_run_status` classifies it with the generic
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
explicit while hot captured bytes stay retryable. Lifecycle failures receive one
invocation id at the shared invocation seam and are recorded once per actual
failed invocation. A retained failure that a later request does not re-attempt —
because the producing owner's correction condition is unchanged — records no
further event, so the journal keeps one event per real attempt. Retry facts
themselves are never journaled and are never read back from the journal:
historical diagnostics are not retry authority. Exact totals and snapshot-paged complete history derive from
committed events; the five-entry process-local preview remains only a cache.

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
`workspace_agent_run_status` with the exact subject and optional attempt id after an
incomplete launcher-retirement step is mechanical recovery; advice to activate a
parent, integrate a slice, remediate findings, or redispatch solely because of a
status tuple is policy and is not launcher-owned.

Under [decision](../wiki/decisions/decision.md), historical runs and results are
evidence rather than gates for a current execution generation. Under
[decision](../wiki/decisions/decision.md), findings-only output remains advisory
and grants no lifecycle authority. Public projections preserve the exact owning
boundary: CCE policy recovery is forwarded without local invention, while a
mechanical refusal reports only its exact launcher-owned recovery.

### Post-worker delivery without built-in review

Review is not a built-in step of the managed post-worker lifecycle. When
observation finds a terminal implementation worker whose authenticated slice ref
carries a committed delivery (a nonempty delta or a server-minted same-tree
child), the lifecycle requests canonical committed-slice integration for that
exact subject through the launcher-owned writable host route. It resolves no
review unit, prepares or freezes no review surface, binds no review context,
writes no review status of its own, never parks the run awaiting review, and
returns no reviewer-dispatch request or review continuation. The closed-input
commit's own decision delivery transition is unchanged.

The integration route re-derives and authenticates the exact target — the
server-minted delivery chain, write-scope containment, bound base, ref CAS, and
record CAS — and applies configured CCE policy exactly as it does for an explicit
coordinator request (see [CCE policy boundary](#cce-policy-and-local-mechanical-recovery-boundary)
and [slice integration](mcp-dispatch-slice-integration.md)). With no configured
gate it follows decision free-substrate behavior. A refusal, including a
configured CCE denial, leaves the run unresolved at `pre-integration` with its
typed lifecycle failure retained, moves no ref or status, and is retried by later
observation; it never becomes review.

A successful integration finalizes the run. The final implementation slice's
record CAS moves the canonical parent WK to `review`, which the finalized result
reports as `wk_transitioned_to_review: true`; that coordinator handoff is where
the lifecycle ends. Repeated `workspace_agent_run_status` observation replays the
settled result without a second integration, and restart reconstruction recovers
the already-integrated delivery through the durable continuation without
re-integrating or dispatching anything.

Review of a delivery, a slice, or a whole WK remains available only as an
explicit coordinator `workspace_agent_dispatch` of a reviewer or redteam unit.
This repository's own contributor workflow may require those reviews; that
requirement is coordinator process, not a launcher prerequisite (see
[Enforcement Model](enforcement-model.md#contributor-review-is-not-consuming-repository-integration-authority)).

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
When worker redispatch instead encounters an existing committed delivery, the
dispatch refusal does not launch another worker and does not route through a
mandatory reviewer. Its callable recovery names
`workspace_integrate_committed_slice` with the canonical slice subject. That is
only a next request: the integration operation independently re-derives the exact
target and applies its existing CAS and configured CCE checks, so the refusal does
not claim integration is authorized or successful. If integration succeeds,
remaining already-dispositioned remediation may be implemented in a follow-up
slice of the same WK. The dispatch response never creates that slice, integrates
automatically, or redispatches a worker.
When the final integration completes and the canonical record declares a
findings-only terminal review unit — the repository's explicit selection of the
terminal review workflow — the lifecycle prepares the terminal publication
candidate that an explicitly dispatched terminal review and forge handoff later
recover. A record that declares none constructs no candidate and requires no
review unit. To prepare the candidate the runtime freezes repository
identity plus the launcher-bound base `B` of the persistent WK lifecycle
(propagated from the WK identity binding's `base_sha`, base_ref `main`) and the
accumulated WK tip `W`; constructs the deterministic squash candidate `C` such
that `tree(C) === tree(W)` and `C`'s sole parent is `B` (`tree(C)` is resolved
directly with `rev-parse <W>^{tree}` and `C` is created with `commit-tree` — no
`merge-tree`, no current-landing-tip resolution); creates or recovers the fixed
`refs/agent-launch/terminal-current-v2/<WK>` ref by expected-old CAS; and
materializes a separate private mode-0700 full detached checkout. The WK ref and
worktree remain assembly state and are not the terminal review checkout.

The runtime verifies the complete `B/W/C/tree/parent/ref/checkout` binding and
runs every canonical whole-WK validation against `C` in the read-only reviewer
composition. It binds no reviewer: an explicitly dispatched terminal reviewer
recovers `C` and is bound to it with `B` as diff base (`B..C`). No
public MCP route runs that validation; candidate, checkout, dependency, process,
environment, argument, and ref authority is launcher-resolved. Reviewer result consumption rechecks the same frozen
contract and candidate binding. Validation and reviewer output are advisory;
passing evidence does not admit and failing evidence does not veto integration.
A result belongs only to that exact cycle;
restart uncertainty causes validation and review to run again.

When a restart finds the fixed `refs/agent-launch/terminal-current-v2/<WK>` ref
ABSENT but durable launcher authority intact, the runtime reconstructs that exact
candidate instead of stalling the WK. `B` is observed only from
`refs/agent-launch/wk-forks/<initiative>/<WK>` and `W` only from
`refs/heads/wk/<initiative>/<WK>`, each as one exact direct commit-valued ref
observation — never through a symbolic ref, peeling, a revision expression, current
landing, a merge base, the reflog, caller input, or process memory — and the
initiative and designated `terminal_whole_wk` review unit come from the CURRENT
canonical validated work record, which is not required to exist in `tree(W)`. The
product identity is unchanged (`tree(C) === tree(W)`, sole parent `B`), the
reconstructed object is the explicitly versioned
`agent_launch.terminal_wk_candidate.v3` form that names its review-contract binding
in its own `Review-Unit:`/`Review-Contract:` fields rather than reinterpreting the
v2 `Contract:` field, and already-valid v2 candidates keep their bytes and their
read-only recovery unchanged. Repository identity, both durable refs, `tree(W)`,
and the projected review contract are re-authenticated immediately before an
absent-expected-old `update-ref --no-deref` publication, and the published ref is
re-read as a direct commit-valued ref equal to `C`. An identical concurrent winner
converges; any different winner refuses and is never clobbered. A refusal creates no
ref, lifecycle, reviewer, executor, run, or monitor state and may leave only an
unreachable inert object. When either durable ref is absent, recovery keeps its
stable `terminal_candidate_recovery_current_ref_absent` verdict — there is nothing
to reconstruct from and `B` is never guessed.

The terminal-wk-candidate authority-call surface is replacement-neutral: each Git
invocation in that surface is prefixed with `--no-replace-objects`, including the
exact direct-ref observations and the publication transaction. For a reconstructed
candidate, the captured direct commit OIDs are `B` from
`refs/agent-launch/wk-forks/<initiative>/<WK>` and `W` from
`refs/heads/wk/<initiative>/<WK>`. The single `update-ref --no-deref --stdin`
transaction verifies those captured OIDs and then uses one of two forms: when the
candidate ref was absent, it verifies the captured durable refs and issues
`create <candidate-ref> <C>`; when the candidate ref existed, it verifies the
captured durable refs and issues
`update <candidate-ref> <C> <expected-old>`. The absent form deliberately does
not verify the candidate ref against an all-zero OID. If the transaction fails,
each captured direct durable ref and the candidate ref are independently
re-observed; convergence is accepted only when every captured OID still matches
and the candidate ref names exactly `C`, otherwise the operation refuses without
clobbering a winner. This is the landed behavior at `W=e15a4e7e`.

This replacement-neutral statement is limited to the terminal-wk-candidate
authority-call surface. `authorityGitArgs()` does not reach the bare `git show`
used by `exactWkBoundContract()` for the v2 contract projection, nor the
unprefixed `runGit` seam used by `terminal-review-materialization.mjs` for the
reviewer's candidate checkout.

A technical failure while constructing, reconstructing, or restart-recovering `C`
refuses reviewer dispatch **before spawn** and preserves the real cause rather than
fabricating an exact-candidate disagreement. Candidate `C` is the deterministic squash of the
launcher-bound base `B` and the accumulated WK tip `W` (`tree(C) === tree(W)`,
sole parent `B`); construction and recovery run only ordinary object-store
operations — `rev-parse`, `cat-file`, `rev-list`, and `commit-tree` — and never a
landing content merge, so no `merge-tree` runs and the retained `conflict`
taxonomy code is unreachable in v2.

Failure disclosure uses the closed
`agent_launch.terminal_candidate_failure_projection.v1` contract. Both forms have
exactly the five enumerable data keys `schema_version`, `kind`, `code`, `message`,
and `detail`; no additional field is admitted. A typed projection is exactly:

```json
{
  "schema_version": "agent_launch.terminal_candidate_failure_projection.v1",
  "kind": "typed_candidate_error",
  "code": "<one typed code below>",
  "message": "terminal WK candidate: typed construction or recovery failure",
  "detail": null
}
```

The eight and only eight typed codes are:

- `agent_launch.terminal_wk_candidate.invalid_argument.v1`
- `agent_launch.terminal_wk_candidate.git_failed.v1`
- `agent_launch.terminal_wk_candidate.base_invalid.v1`
- `agent_launch.terminal_wk_candidate.input_moved.v1`
- `agent_launch.terminal_wk_candidate.conflict.v1`
- `agent_launch.terminal_wk_candidate.candidate_invalid.v1`
- `agent_launch.terminal_wk_candidate.candidate_ref_disagrees.v1`
- `agent_launch.terminal_wk_candidate.binding_mismatch.v1`

Typed `detail` is `null` except that `git_failed` may carry exactly
`{"git_operation":"<operation>","git_status":<status>}` and `base_invalid` may
carry exactly `{"git_operation":"merge-base","git_status":<status>}`. The
closed operation domain is `rev-parse`, `rev-list`, `cat-file`, `commit-tree`,
`for-each-ref`, `update-ref`, or `merge-base`. The status domain is `null` or an
integer from 0 through 255 inclusive. At the typed-error projection boundary,
invalid, incomplete, or inapplicable internal detail collapses to `null`. At the
public backend boundary, an incoming projected value with invalid detail or any
other schema defect is replaced by the unknown projection rather than forwarded.

The unknown form is the following byte-stable projection; its compact serialized
bytes and key order are exactly:

```json
{"schema_version":"agent_launch.terminal_candidate_failure_projection.v1","kind":"unknown_cause","code":null,"message":"terminal WK candidate: unknown construction or recovery failure","detail":null}
```

Only an actual `TerminalWkCandidateError` can produce the typed form at the
runtime boundary. Unknown exceptions, non-errors, copied prefixes, lookalikes,
caller-supplied projection shapes, and malformed backend carriers collapse to the
fixed unknown form. Neither form returns Git arguments, stdout, stderr, exception
or subprocess prose, arbitrary fields or strings, names, stacks, causes,
credentials or other secrets, filesystem paths, environment content, caller
fields, or unvalidated object IDs or refs. No internal error instance crosses the
projection boundary. The post-worker lifecycle publishes this projection as
classification only; the original exception accompanies it as evidence
(see [post-worker lifecycle failure reporting](#post-worker-lifecycle-failure-reporting)).

Shape is validation, never provenance. The terminal-candidate runtime records the
exact error identities it originates in one module-private `WeakMap`, together
with their already-closed five-field projections. Consumers have only a read-only
lookup over that private membership: no exported registration, adoption, branding,
or caller-selected mint operation can attach module membership. The exported
coordinator retains `runGit`
injection for tests, but only the exact module-fixed production-default Git runner
identity may mint typed membership; explicitly passing that exact function is
equivalent to using the default. An injected, wrapped, bound, proxied, copied,
lookalike, or otherwise substituted runner does not receive membership regardless of its
name, source text, properties, symbols, prefixes, or caller assertions. Its failure
is replaced by fixed launcher-owned transport data and crosses the public boundary
only as the byte-stable unknown projection. Structural validity remains defense in
depth, not provenance, and no request, prompt, callback, dependency object, error
property, symbol, token, or code prefix can select or replace the lookup. Copying
`terminal_candidate_failure`, reproducing all five fields, or
wrapping either a projection or carrier in a transparent or trapping proxy grants
no membership and therefore yields the exact unknown projection. The backend
still validates the returned shape defensively, but never reads an error property
as module membership.

One projection boundary covers fixed-current-ref observation, recovered-contract
and input freezing, candidate identity re-derivation and comparison, object-binding
verification, private-checkout materialization, dependency-mount verification,
and final recovery verification. Any projection refusal happens before process
creation: it creates zero reviewer runs, zero executor invocations, and zero
monitor identities or handles.

Forge restart recovery uses the same private read-only lookup. Its existing
transport/control-flow reason remains in the forge refusal, while
`detail.recovery_detail` carries the exact module-originated five-field projection.
An exact-shaped exception without module membership carries the fixed unknown form.
The typed projection is appended only after generic forge-detail
sanitization, so its required fixed `message` key survives without making arbitrary
exception messages, Git arguments, stdout, stderr, paths, secrets, stacks, or
causes public. The runner-identity provenance gate does not alter this forge
recovery retention behavior.

work record removes the diagnostic suppression on the reviewer side of that same
lookup. The reviewer backend previously hardcoded `detail.reason` to
`terminal_candidate_recovery_failed` for every cause while the forge path already
published the authenticated verdict; it now publishes
`projectTerminalCandidateRecoveryReason` too, validated against a closed
vocabulary, so an error the runtime did not mint still reads
`terminal_candidate_recovery_failed` and one it did mint names itself.
`detail.recovery_code` and `detail.recovery_detail` are unchanged and remain the
typed CANDIDATE projection, which is `null` / `unknown_cause` for a control-flow
verdict because such a verdict is not a candidate defect.

A new `detail.recovery_diagnostic` carries the bounded launcher-owned cause when
one exists, and `null` otherwise. It has exactly the keys `schema_version`
(`agent_launch.terminal_candidate_recovery_diagnostic.v1`), `contract_code`,
`projection_code`, `missing_facts`, and `ambiguous_facts`. `contract_code`
distinguishes the canonical-current-contract refusal paths that were previously
one undifferentiated `null` — a symlinked repository root, an unreadable or
unparseable record, a record whose id or initiative disagrees, an unprojectable
terminal review unit, and a moved review subject or contract digest.
`projection_code` says whether the parent lifecycle contract was incomplete or the
designated unit's own review contract was absent, and the two fact lists carry
contract-fact NAMES drawn from the frozen `PARENT_LIFECYCLE_CONTRACT_FACTS`
vocabulary (for example `acceptance.criteria` and `acceptance.validation`). Every
value is a fixed module constant: no stack, Error, raw stderr, record content,
repository path, or caller-controlled text can enter, and provenance is the same
private WeakMap membership check the failure projection uses, so a copied
diagnostic yields `null`. This is diagnostic projection only — no refusal that refused before
changes, and none of it selects a path, a retry, a fallback, or any authority.

work record lifecycle-refusal authentication and
`packages/agent-launch-cli/src/lib/backend-scope-authority.mjs` are outside this
contract change. The change supplies no retry, fallback, cleanup, publication,
review, lifecycle, policy, or CCE authority and does not alter the exact `C/B/W`
candidate contract or its existing authority boundaries.

### Post-worker lifecycle failure reporting

A post-worker lifecycle rejection publishes two separate things on
`slice_lifecycle`: a closed classification and the unredacted evidence of what
was thrown. The evidence is complete only when its `thrown.capture_failures`
list is empty; anything the encoder could not capture is listed there.

The classification is `error_code`, `error_message`, and, where a seam supplies
them, `candidate_failure`, `continuation_failure`, and `failure_cause`. A
rejection at a named lifecycle seam publishes that seam's code and fixed message
(below). Any other rejection publishes the generic pair: code
`agent_launch.slice_lifecycle.failed.v1` and message
`post-worker slice lifecycle invocation failed`. The classification is selected
by the seam, by launcher-private brands, and by identity attribution. It is never
selected by reading the thrown value.

The evidence is `slice_lifecycle.evidence`. Every failure envelope carries it,
and a compact `evidence_summary` travels with it (operation, value type, name,
code, message, and the number of capture failures). Evidence is captured at the
originating boundary, before any wrapping. It is never redacted, and nothing is
dropped without a `capture_failures` entry:

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
origin.

Producers keep their facts at the point of failure:

- The backend integration owner keeps the thrown error's reason, `detail`, and
  captured evidence on every non-integrated result. That includes an admission
  refusal such as `trusted_commit_scope_mismatch` with its offending paths,
  checked write scope, reviewed and base commits, and counts. It also keeps the
  evidence of a retained-context recovery failure that fell through to fresh
  admission (`retained_recovery_evidence`), and the evidence of a failed CCE
  authorization call.
- The launcher-composed direct adapter forwards the complete non-integrated
  result, not only its nested refusal.
- The lifecycle's own refusals carry the facts they were decided on: bound and
  expected identities, Git arguments, status, and stderr. A missing delivery also
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
- The `workspace_agent_run_status` exception boundary keeps its existing rendered
  `error_message` (including a producer's declared-sensitive redactions) and adds
  the thrown value itself as `blocker.detail.evidence`, unredacted.

The failure is recorded once per invocation, at the shared invocation seam,
however many callers observe it. The same envelope, evidence included, is
published on `slice_lifecycle` and journaled as that invocation's durable
`lifecycle_failure_recorded` event. `workspace_agent_run_status` with
`detail: { kind: "failure_history" }` returns those journaled envelopes. The
bounded retained-failure ring (`latest_failure`, `retained_failures`) is a
preview: it keeps the classification and the `evidence_summary`, not the full
evidence. A response too large to inline is spilled like any other tool
response. Its complete content is read back through
`workspace_read_mcp_content_reference`.

Evidence is diagnostic content only. Nothing in it selects a code, a
`failure_cause`, a phase, terminality, `next_action`, retry, or any integration,
continuation, or policy outcome. A thrown value or refusal that claims success,
authority, or a classification is published as evidence and classified exactly
as before. The explicit `workspace_integrate_committed_slice` route is unchanged:
it returns an integration refusal with its typed code, reason, and public blocker.

#### Seam-keyed lifecycle failure codes

`error_code` on `slice_lifecycle` is read by `workspace_agent_run_status`, and a
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
accompanies the terminal-candidate preparation seam only. The integration-continuation
seam alone may publish the closed `continuation_failure` fact described below.
The four pre-integration seams alone publish the closed `failure_cause`
described below.

The pre-integration seams cover the launcher-owned binding resolution and the
lifecycle's exact subject and WK-ref checks over it; each resolution of the
launcher-bound slice tip; the read-only integrated-slice reconciler; and the
host-delegated committed-slice integration, whether the adapter rejects or
returns a refusal. Each seam wraps only its dependency call. A rejection raised
by what the lifecycle later decides about a successful result is not rebranded.

The integration-continuation seam is reached from restart recovery and from a
retried pre-integration attempt, and both publish the SAME code, because they are
one dependency boundary and the envelope's own `phase` already distinguishes them.

That seam alone may additionally publish the closed, non-authorizing
`slice_lifecycle.continuation_failure` fact. Its only value is
`{ "reason": "completed_integration_write_scope_mismatch" }`: the live backend
authenticated a successful integration of this worker's exact delivery, but that
integration was admitted under a different write scope from the worker's retained
binding, so the original monitor does not consume it (see
[slice integration](mcp-dispatch-slice-integration.md)). The fact is selected only
by a launcher-private brand on the refusal the continuation owner mints. A
caller-built error with the same code, reason or property, a proxy around the
real refusal, and every other throwable publish no fact; their content is in the
evidence. The publication re-gate rebuilds the fact from its closed vocabulary
and strips anything else. The fact grants no retry, recovery, integration or
completion authority, and it leaves terminality, `next_action`, attempt
accounting and the retained-failure ring unchanged.

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
`workspace_verify_proof`. The role-access authority grants it to those two roles
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
