# MCP dispatch terminal review

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
the authenticated per-attempt terminal review contract, active managed
composition, spawned-server lifecycle, post-spawn conduit failure, cleanup-only
terminal failure, plural exact-slice review evidence, the exact-slice
review-surface state budget, and safe postcheck diagnostics.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## The authenticated per-attempt terminal review contract

Candidate `C` freezes `tree(W)`, so the work-record blob inside `C` is the
WK-branch snapshot. An exact terminal candidate may freeze the addressed parent
work item at `todo`, `active`, or `review`, while live parent review remains
mandatory. Trusted integration then moves the canonical landing record to
`review` when terminality is established. Re-deriving the reviewer's
findings-only acceptance contract from the candidate-embedded snapshot therefore
authenticates the lifecycle coordination difference without treating the frozen
snapshot as current review authority.

Coordination ordering is part of this boundary: independent blueteam tracking
for implementation-review output must be created and settled before the final
implementation delivery and terminal candidate construction. Once `C` is
constructed, creating or closing a review-tracking unit is authored drift, not a
review-state transition that can be admitted after the fact.

Historical frozen contracts and checkpoints are immutable evidence. They are never
rewritten, never deleted to force a recovery, and never served as current review
authority. Instead, one central normalization compares the frozen historical
contract with the live canonical contract as **whole canonical byte strings**. The
base lifecycle exemption covers exactly two fields: the addressed parent work
item's own `status` and the exact designated terminal review unit's `status`,
neutralized identically on both sides. For each identically declared same-record
implementation dependency whose status transition is already authenticated, its
`status` is also neutralized. Its `sections.closure` is neutralized only when that
path is absent or `null` on the historical frozen side; this frozen-absence gate
admits the normal status-then-closure completion write, including when `sections`
itself must be materialized symmetrically, while refusing a rewrite of an existing
closure. The values those fields carried are then checked against a closed
transition table:

- parent: `todo -> review`, `active -> review`, or an already-`review` zero delta.
  The live parent must be in `review`; `todo`, `active`, `done`, `blocked`,
  `cancelled`, `parked`, unknown, and malformed live values all refuse. The
  `active -> review` case is producer-legitimate: before final-slice integration
  establishes terminality, the integration producer may still keep the parent
  `active`, then atomically advance canonical coordination to `review` as part
  of that final integration.
- designated terminal review unit: `todo -> todo`, `todo -> review`, or an
  already-`review` zero delta. Both `todo` and `review` are admissible live states,
  which is what keeps sequential and concurrent plural advisory attempts possible;
  the backwards `review -> todo` regression and every other value refuse.

The landed `AUTHENTICATED_DEPENDENCY_TRANSITIONS` exception from
work record admits an authenticated dependency moving `todo -> done`,
`review -> done`, or `done -> done`; it must be a same-record implementation slice named by a
byte-identical `depends_on` declaration on both sides. A moved declaration,
undeclared or non-derived sibling, different work kind, or any other dependency
transition remains byte-compared.

Only one newly added canonical closure is admitted, and only as the closure
coupled to `review -> done`; a second new closure, a changed declaration, a
standalone closure, or any unrelated authored change stays in the whole-byte
comparison and fails closed.

Forge recovery is narrower: it authenticates exactly one review-to-done
dependency closeout with its previously absent canonical closure on the
candidate-to-closeout WK-only commit (or its exact composed review/closeout
form). The record-level `updated` date may differ only as the server-managed
consequence coupled to that exact forge closeout; it is not an independent
allowance for authored drift. Added or closed review-tracking units remain
inadmissible, including when they are introduced after candidate construction.
Both paths preserve the same exact `C/B/W`, immutable-candidate,
advisory-review, and forge-confirmed completion boundaries.

Every other difference refuses: another unit, another transition, unrelated
authored drift (including `slices[].sections.agent_notes`), an existing closure
rewritten to a different value, an added, removed, or substituted field, a
projection difference that is not the exact authorized transition, an ambiguous
or unresolvable live terminal unit, and a mis-addressed or non-canonical unit
identity. This normalization does not recover work record's already-drifted
candidate. Normalization inputs are the launcher's canonical serialized
contracts only; a caller-shaped object is not an input, and no caller, prompt,
environment, or reviewer output selects one.

The parent-status normalization is coordination evidence only. It is
non-authorizing and grants no candidate, `C/B/W`, terminality, reviewer-spawn,
integration, dispatch, or forge authority. Those authorities remain gated by
the independently authenticated candidate, repository identity, exact addressed
identities, whole-contract comparison, and live terminal-review coordination
checks.

An admissible attempt derives an immutable per-attempt review contract keyed by the
exact `C/B/W` and repository identity, the candidate ref/tree/parent and the private
candidate checkout, the exact addressed parent and designated review-unit
identities, the historical and live canonical contract digests, and the
authenticated transitions. Its identity is the SHA-256 of that canonical key, so
identical concurrent derivations converge on one contract and a differing snapshot
yields a different identity that rechecks or refuses. Nothing process-local — a
monitor handle, a run id, a clock, a counter — participates, and nothing is
persisted: this is not a durable epoch registry. A crash before spawn therefore
grants no durable launch authority, and a retry re-reads, re-verifies, and
re-derives from canonical evidence alone.

The final live canonical read and digest verification happens **inside the
production spawn stack, immediately adjacent to the actual process-creation
primitive** — not in backend routing, not merely before the family executor is
invoked, and not at the family's call site either. Invoking the family executor is
not spawning: every supported family performs substantial asynchronous preparation
afterwards, and canonical coordination state can move anywhere inside that window.
Claude probes runtime availability, mints native-permission settings, constructs a
stdio-MCP conduit, and re-verifies runtime identity; Codex builds its plan,
constructs a conduit, injects config overrides, assembles the bwrap plan, and
asserts the containment backend.

Calling a family's spawn function is not spawning either. For both isolated
families that call enters `spawnIsolated`, which still revalidates the
identity-pinned read-only sources, probes and resolves the bwrap backend binary
from the host filesystem, authenticates the stdio-MCP conduit binding, and composes
the child stdio before it creates a process; isolated Claude additionally
constructs its whole bwrap plan — credential-leaf policy, writable-mount
derivation, settings mask, runtime mount policy, executable resolution — in the
launch-support wrapper in front of it.

The launcher therefore binds a synchronous barrier closure over the retained
per-attempt contract and hands it down the launcher-internal spawn-options
transport — never argv, env, readiness, the plan, a prompt, or any model-visible
surface — to the authoritative site in each family:

- isolated Codex and isolated Claude, **inside `spawnIsolated`**, after plan
  validation, read-only-source revalidation, backend resolution, conduit binding,
  and stdio composition, as the last statement before `child_process.spawn`;
- unenforced plain-spawn Codex and unenforced plain-spawn Claude, through the
  shared family launch lifecycle, after baseline capture and spawn-primitive
  preload and immediately before its spawn call.

Nothing intervenes between the authoritative verdict and process creation: no
await, callback, mutable selection, bwrap-plan construction, identity or backend
check, conduit operation, caller-controlled code, or wrapper/shared-family
lifecycle step.

A present-but-uncallable barrier fails closed with
`terminal_review_spawn_barrier_invalid` rather than degrading into an unchecked
spawn. A launch whose `spawn` merely returns an already-created child is a
post-spawn supervision step and deliberately carries no barrier.

The deep refusal is a privately branded throw, unforgeable from outside the spawn
primitive and deliberately **not** a `BubblewrapIsolationError`: each family
classifies it first, ahead of the conduit remap and the sandbox decision, so a
coordination refusal can never be laundered into an unenforced retry. It carries
the verifier's verdict verbatim, so the family returns the same typed
terminal-review lifecycle refusal — including `exact_candidate_unchanged` — that
the earlier gates return. Refusal runs the family's existing pre-spawn
compensation — stdio-MCP conduit teardown and attempt-owned cleanup — so no
process, namespace, FIFO, host server, descriptor, or directory survives it, and
the fail-open plain-spawn retry is re-verified on its own terms rather than
inheriting the isolated attempt's verdict.

The plain-spawn primitive is **preloaded before the barrier**. Both families
resolved `node:child_process` dynamically inside their spawn function, which put an
`await` between the barrier's verdict and process creation; canonical state can move
during that await, and the import being a builtin does not close the race. The
builtin is now resolved once, ahead of the barrier, into a callable that creates the
process synchronously. A barrier composed over a primitive that was NOT preloaded
fails closed with `terminal_review_spawn_primitive_unresolved` rather than trusting
that the supplied spawn function contains no awaited step.

Backend routing, the dispatch run lifecycle, and each family's own call site keep
earlier checks so a state change is refused cheaply before deeper preparation
begins, but none of them is the authority — they are defense in depth. After the
authoritative verdict no authority-bearing await, callback, caller-controlled
operation, or mutable decision step remains before spawn. Canonical state that
changes at any point up to that boundary — including an otherwise-authorized
transition arriving late — refuses with the actual process-creation primitive
provably never called, which the regressions measure by driving the registered
production wrappers against a real recorded executable rather than an injected
wrapper-call substitute.

A coordination refusal is not a candidate defect. It is reported as
`terminal_review_lifecycle_state_inadmissible` with the specific lifecycle reason
and an explicit `exact_candidate_unchanged` marker: unchanged `C/B/W` stay valid, no
new decision cycle is required, and no ref, checkout, or historical contract is
mutated. A recovered terminal reviewer still runs only in the private exact
candidate checkout, with `B` as the findings-only diff base and empty write
authority. Standalone findings-only reviewers and redteam units carry no per-attempt
contract and reach none of this.

## Active managed composition precedes dispatch and child creation

At managed-backend construction, the launcher mints one immutable, branded,
process-local composition object. It binds the exact resolved
`@agent-chassis/wiki-mcp/src/server.mjs` producer entrypoint, selected Node
executable, exact spawn primitive, producer-owned lifecycle descriptor,
consumer lifecycle descriptor, and `createStdioMcpConduit` constructor used by
both managed Claude and Codex family executors. The object is not public;
module-private brands authenticate it and a bounded accessor exposes only its
frozen compatibility fact and guarded conduit construction.

This fact authenticates the coherently loaded launcher/package composition; it
does not execute the selected server or attest arbitrary in-place source changes
within that backend generation. The spawned-server readiness exchange below is
the authority for what the separate server process actually executes. A partial
or hot deployment can therefore pass this early composition gate and still be
safely refused by the mandatory per-dispatch exchange.

The public fact is `stdio-mcp-conduit-composition-compatibility.v1` with exactly
six keys: `schema_version`, `backend_generation_id`,
`producer_protocol_generation`, `consumer_protocol_generation`,
`compatibility_state`, and `source`. `source` is
`launcher_active_composition`. `compatible` requires authenticated,
well-formed, supported, equal producer and consumer bindings; authenticated,
well-formed unequal or unsupported bindings are `incompatible`; unavailable,
unbound, unauthenticated, or malformed internal composition is `unknown`.
Missing, malformed, stale, and backend-generation-mismatched facts are gate
outcomes, not compatibility states.

The backend requires a current `compatible` fact before delegating any managed
worker, reviewer, or redteam role to a family executor, and the shared guarded
constructor checks it again before host-server creation. Route registration is
reported independently. Effective structured dispatch alone becomes
unavailable on any unresolved outcome; native edit, repository read boundary,
commit, managed worktree provisioning, slice-to-WK integration, WK-context
review, validation ownership, and automatic main promotion remain independent.
All public projections use `operator_recovery_needed`, cause
`stdio_mcp_lifecycle_protocol_incompatible`, and recovery to deploy one coherent
build and restart the long-lived backend. No raw component identity is exposed,
and historical failures cannot poison a newly minted compatible generation.
Direct orchestrator and operator launches are outside this gate.

## Lifecycle compatibility precedes confined child spawn or MCP forwarding

The launcher proves the active producer/consumer lifecycle contract before it
allows a confined client to exchange MCP bytes. The exact readiness subject
depends on whether the client contract permits one MCP command lifetime or
overlapping command lifetimes.

For anonymous-pipe and named-FIFO one-lifetime conduits, the family executor
constructs the complete conduit before invoking the isolated child spawn.
Construction starts exactly one host wiki-MCP server and waits for its first
launcher-only `wiki-mcp-launcher-readiness.v2` event. That event carries
`lifecycle_protocol_generation` from the producer contract loaded inside the
spawned server process. The long-lived launcher consumer compares it with its
own loaded generation before returning a conduit binding to the family
executor. This binds the compatibility result to the producer that is actually
running without filesystem fingerprints or parent-process module-cache
assumptions.

For the decision Codex local-acceptor variant, no host server exists until an
MCP command invocation authenticates. Before confined-child spawn, the launcher
instead proves that the private listener is armed, the endpoint and token file
are projected, the connector and interpreter are descriptor-pinned, the
admission window is open, and exactly-once settlement supervision is installed.
After a connection authenticates, the launcher reserves and starts one host
wiki-MCP generation with its stdio mechanically wired, then verifies that
generation's `wiki-mcp-launcher-readiness.v2` registration. The connector is
still blocked from reading its stdin and the host does not read or forward
client MCP bytes. Only a matching, well-formed generation authorizes the fixed
admission acknowledgement; MCP forwarding begins after that acknowledgement.
Each later overlapping connection repeats the same per-generation check.

For a one-lifetime conduit, a missing, malformed, legacy, unknown, or mismatched
generation remains a pre-spawn `stdio_mcp_lifecycle_protocol_incompatible`
failure. Existing exactly-once cleanup reaps the server and conduit resources;
the executor never reaches confined-child spawn and creates no delivery,
review, integration, retry, or fallback authority.

For the local acceptor, listener or projection failure before confined-child
spawn is the same launch-admission refusal. Authentication rejection creates no
generation. A server spawn, registration, or readiness failure after
authentication but before acknowledgement closes that connection, reaps the
partial generation, and enters the post-spawn conduit-failure path below. It
never acknowledges the connector or forwards an MCP byte. If no usable required
wiki-MCP generation exists, the outer launch fails closed. Failure of a
replacement generation does not corrupt or automatically terminate a separate
healthy admitted generation; outer-session disposition follows the existing
required-MCP lifecycle policy.

The lifecycle generation is never supplied through a request, prompt, model
output, environment, backend registry entry, or retained run state, and no
historical compatibility latch exists.

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

Client readiness and lifecycle failure are separate launcher settlements.
`clientReady` resolves once for the real initialize plus exact `tools/list`
exchange; it is never reused as post-readiness authority. A distinct, memoized,
always-live failure settlement remains pending after readiness and resolves once
with the first typed failure. Spawn supervision observes that settlement for the
whole confined process lifetime, starts the one bounded cleanup settlement
promptly, and retains later cleanup or reaping evidence additively. A relay
restart, malformed lifecycle event, later tool-surface mismatch, or host-server
loss therefore cannot disappear behind an already-resolved readiness promise.

Clean host-server exit after readiness remains expected drain for the one-shot
worker, reviewer, and redteam lifecycles. An interactive orchestrator requires
its wiki-MCP surface for the whole session: transport close alone never
authorizes success while the orchestrator process remains live, regardless of
whether client close or server exit is observed first. Expected interactive
cleanup requires the launcher to have observed the confined orchestrator process
itself become terminal. This classification uses only the launcher-validated role
and launcher-observed process lifecycle; prompt text, environment, caller input,
model output, client messages, and client-supplied policy are not classification
inputs.

For an orchestrator, the launcher persists `stdio_mcp_reason` and
`stdio_mcp_detail` in its launcher-owned `session.json` before publishing the
terminal state. This projection is bounded and allowlisted: it records the typed
reason, phase (`readiness`, `mid_session_server_loss`, `relay_restart`,
`cleanup`, or `reaping`), launcher run id, and bounded cleanup resource/code
tokens only. It never serializes Error messages or causes, prompts, credentials,
environment, raw process output, arbitrary event detail, prose, or stack traces.
The initiating failure remains primary. Failure to persist this diagnostic fails
closed as `stdio_mcp_session_diagnostic_persistence_failed`; terminal state is
not published as though the diagnostic had been saved.

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
