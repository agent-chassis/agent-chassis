
# MCP dispatch terminal review

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
the authenticated per-attempt terminal review contract, active managed
composition, spawned-server lifecycle, post-spawn conduit failure, cleanup-only
terminal failure, canonical `acceptance.validation` admission across the
findings-only surfaces, plural exact-slice review evidence, the exact-slice
review-surface state budget, and bounded postcheck diagnostics.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## Terminal candidates select material, not review execution

A launcher-built terminal candidate contributes its already-selected immutable
material to the single advisory-review pipeline used by ordinary reviewer and
redteam dispatch. Terminal coordination continues to own candidate construction
and publication, but it owns no separate reviewer executor, run, monitor,
settlement, receipt, recovery, or replay path. The review action remains
read-only and action-local, and its output creates no lifecycle authority.

## The authenticated per-attempt terminal review contract

Terminal-candidate authority includes one owner-produced
`controlled-contract-authenticated-generation.v1` envelope. The envelope binds the
canonical repository and WK, the canonical record blob observed in exact `W`, the
exact direct `W` commit, the complete ordered carrier census and bytes, and the
complete ordered visible-manifest census and its deterministically derived identity.
The manifest resolver cannot produce this envelope or its identity: it supplies only
selection facts, while the launcher attachment primitive performs one asynchronous
exact-`W` observation and delegates construction to
`wiki-core`'s controlled-generation authentication owner. Both synchronous and
asynchronous injected Git runners cross that same awaited boundary.

Hot preparation, cold reconstruction, candidate advance, and forge handoff consume
that envelope unchanged. Terminal paths reject a null manifest identity, incomplete
or contradictory observations, a proper subset, and any resolver-, caller-, fixture-,
metadata-, or coordinator-supplied identity. Candidate CAS remains inside the shared
same-WK authority exclusion, and forge retains that exclusion through branch and
pull-request mutation, so generation-only, `W`-only, or simultaneous movement cannot
authorize a stale effect.

### Plural immutable candidate versions and current selection

Frozen means immutable per candidate version, not singleton per WK. The primitive
owner is
`packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs`. It alone defines the
canonical candidate-version tuple, serializes and digests its identity, derives its
refs, constructs and verifies candidate commits, and performs current-selection CAS.
The tuple binds the canonical repository and WK, exact `B`, exact `W`, authenticated
controlled-generation identity, `tree(W)`, candidate format, and deterministic
candidate `C`. No coordinator, runtime route, status projection, caller, metadata
field, or prose may reconstruct any part of that protocol.

The immutable version ref is
`refs/agent-launch/terminal-candidates-v1/<WK>/<version-identity>`. Its final component
is the lowercase SHA-256 digest of the canonical candidate-version tuple. The ref may
be created only as part of the owner-controlled publication transaction and must
resolve to the tuple's exact verified `C`; it is never updated or deleted. Exact
authenticated replay of the same tuple converges on the same identity, ref, and
candidate without mutation. A later authenticated `W` or controlled generation
produces a different identity, immutable ref, and candidate even when other inputs
remain equal.

`refs/agent-launch/terminal-current-v2/<WK>` remains one launcher-authenticated
selection pointer, not the candidate artifact or its history. The owner publishes a
new immutable version ref and advances current selection through one expected-old
transaction under the durable same-WK exclusion after rechecking `B`, `W`, generation,
tree, candidate, and both refs. Same-input contenders converge; a moved expected-old
or any contradictory winner refuses without rewriting either candidate. All prior
version refs remain addressable. A valid version whose ref is not selected is
`superseded`, not invalid, and its review evidence remains immutable evidence for that
version only.

The terminal-candidate coordinator owns hot preparation and cold reconstruction
sequencing under the exclusion. The terminal-candidate runtime owns public status and
explicit advance sequencing. Both consume the primitive owner and may add no local
tuple, ref, construction, verification, or CAS implementation. Hot retry, cold
recovery, status, reviewer spawn, receipt publication, and forge handoff resolve one
explicit candidate version and return consistent current or superseded state.

Forge mutation has no versionless compatibility path. Branch publication, pull-request
mutation, closeout, and merge require one launcher-authenticated selected version
decision, its immutable version ref and current-selection observation, and at least
one matching authenticated reviewer receipt. A historical state without that version
decision remains readable through observation surfaces only and cannot authorize a
forge effect. Merge consumes the exact authenticated handoff result and never
re-resolves a candidate when that result is absent.

When forge cold recovery crosses into the terminal-candidate coordinator, the
exclusion owner passes an opaque callback-scoped context bound to that exact
repository and WK. The coordinator authenticates the context before recovery and
does not reacquire the non-reentrant lock. The context expires before the forge
callback returns; missing, copied, stale, or mismatched contexts refuse. Ordinary
recovery entrypoints receive no context and continue to acquire the durable lock.

Each candidate `C` freezes `tree(W)`, so the work-record blob inside that version is
the WK-branch snapshot. Trusted integration may later move canonical status and
coordination fields without changing the version's `C/B/W`. The lifecycle-difference
decision records those facts without treating either the frozen snapshot or live
status as candidate or review authority.

The original `workspace_agent_dispatch` review result is the complete review
observation. It returns the captured advisory text directly, a bounded schema
observation, and `formal_attestation`. Ordinary reviews report
`requested:false`. When the launcher-selected canonical result contract is
`schema_constrained`, settlement reports `requested:true` and derives and durably
publishes the existing formal attestation in that same call, or returns a precise
unavailable annotation. The text remains usable in either case. There is no
second review-evidence/provenance/attestation append, settlement replay,
historical monitor reauthentication, or post-restart repair.

Forge closeout authenticates candidate and publication mechanics only. Review
text informs coordinator disposition but review schema, receipts, provenance,
history, and formal-attestation availability grant no candidate or forge authority
and cannot veto publication. Formal attestations retain their narrow admission
consumer semantics. Historical `review_provenance` fields remain parseable archival
bytes only. work record retains candidate and forge ownership, work record retains landed
publication identity, work record retains recovery ownership, and forge remains the
sole merge-readiness boundary. Findings remain advisory under decision and
decision.

Cold reconstruction binds the current designated terminal-review unit through one
pure owner:
`packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs`. It alone
defines, validates, canonically serializes, digests, and compares
`agent_launch.terminal_review_contract_binding.v1`. The coordinator supplies the
facts from its single canonical-record projection. Forge does not reuse that object
or trust candidate metadata as current state: it independently reads and projects
the local canonical record, supplies those facts to the same owner, and compares the
resulting identity. Subject, slice, initiative, or authored review-unit movement
therefore changes or invalidates the binding before forge mutation. Forge's
work-record closeout comparisons likewise use wiki-core's canonical source digest,
whose projection excludes generated `derived_evidence` and `projections` but not
authored contract changes.

Historical frozen contracts and checkpoints are immutable evidence. They are never
rewritten, deleted to force recovery, or served as current review authority. The
launcher instead classifies the exact historical and live canonical bytes through
`agent_launch.terminal_review_lifecycle.invariant_bound_decision.v1`. A positive
decision means every authority-bearing byte stayed exact and every admitted
difference was either a non-authorizing coordination fact or carried exact
producer-authenticated evidence. It does not mean that a lifecycle order was
approved.

Parent, slice, and designated-review status values, server-managed `updated`, and
`sections.closure` are schema-owned coordination facts. Their canonical path, change
kind, and addressed unit remain visible in `non_authorizing_coordination_facts`, but
their order and content neither authorize nor veto candidate movement. Findings,
review result, challenge, disposition, and closure therefore cannot supply
terminal-candidate, delivery, dispatch, or policy authority. Lifecycle ordering that
matters to an organization is CCE policy; absence from a local transition allowlist
is not a mechanical refusal.

Parent and slice titles plus `sections.agent_notes` are authored contract
constituents. They are compared byte-for-byte and are never neutralized as
coordination prose. Moving any of them invalidates the prior execution generation,
candidate lifecycle decision, reviewer attempt, receipt, and forge evidence; the
old immutable candidate remains readable only as historical evidence.

Executable and dependency authority remains exact. The whole-byte comparison still
binds authored titles and agent notes, implementation and review acceptance,
`read_scope`, `repo_paths`, `write_scope`, expected targets, dispatch intent, work
kind, and the exact dependency declarations.
Repository identity, base `B`,
accumulated tip `W`, candidate-version identity, candidate `C`, immutable version ref,
current-selection ref, tree, sole parent, private checkout, and controlled generation
remain independently authenticated by their existing owners and are not reconstructed
by lifecycle normalization.

### Producer-authenticated integrated-delivery evidence

An `integrated_delivery_sha` difference is not authenticated by the live canonical
field, a SHA-shaped string, caller input, or a copied object. The integration
authority owner reads the exact historical receipt contract and live canonical
projection, then authenticates the immutable Git receipt produced by
`packages/agent-launch-cli/src/lib/slice-integration-delivery.mjs`. The proof binds:

- the exact repository and canonical WK ref;
- the addressed same-record implementation dependency and its canonical
  `/slices/<index>/integrated_delivery_sha` path;
- change kind `add` or `replace`, limited to historical absence or `null` becoming
  one exact integrated commit;
- the reviewed delivery and its exact base, producer message/tree/delta (or exact
  zero-delta evidence), reachability from current `W`, and the exact current `W`;
- producer module and receipt schema, plus the failure consequence when any bound
  fact is unavailable or disagrees.

`authenticateCanonicalIntegratedDeliveryTransition` returns the opaque branded
proof; `decideAuthenticatedTerminalReviewLifecycleDelta` consumes that exact proof.
Copying its enumerable fields loses provenance. A plain receipt-shaped object,
live-field lookalike, stale proof bound to another `W`, wrong dependency/path,
changed pre-existing value, mismatched reviewed delivery, malformed commit, or
unreachable integrated commit cannot authenticate the transition.

The positive decision reports `integrated_delivery: producer_authenticated` only
for that exact evidence. Without it, a delivery-field difference refuses as
`integrated_delivery_receipt_required`. An unbranded or mismatched proof refuses as
`integrated_delivery_receipt_unauthenticated`; wrong dependency, path, and value
bindings use `integrated_delivery_dependency_identity_mismatch`,
`integrated_delivery_canonical_path_mismatch`, and
`integrated_delivery_transition_mismatch` respectively. Changed executable or
dependency authority refuses as `executable_or_dependency_authority_changed`, and
other unexplained authored bytes refuse as
`canonical_authored_bytes_unauthenticated`.

Every refusal carries its named identity, authentication, integrity, or operability
invariant and the concrete consequence: candidate or delivery authority would be
unverifiable, or the addressed terminal-review operation could not execute. Input
identity/readability failures likewise remain typed. These causes do not invalidate
unchanged `C/B/W`; they prevent using unauthenticated differences as recovery
authority.

work record remains the sole owner of candidate-status `generationAuthentication`
registration. work record remains the sole owner of terminal-review target construction
and validation. work record tracks that decomposition. The lifecycle decision and
integrated-delivery proof create no substitute generation authority, target owner,
constructor, validator, registration route, candidate reset, or ref rewrite.

Terminal-candidate status and advance continuations preserve repository
selection without creating repository authority. When the public request
explicitly supplies `repo`, `resolveWorkspaceRepo` accepts it and the route
passes only that resolved alias to the runtime; the runtime appends it to every
returned `next_call` and neither derives nor overrides it. When `repo` is
omitted, continuations omit it as well, so default-repository behavior is not
pinned. Candidate/ref/CAS/authorization identity remains launcher-owned and is
unchanged by this transport projection.

### Workflow-not-selected status and direct-to-main review

`workspace_terminal_review_candidate_status` applies only to a launcher-built
managed terminal candidate. When the canonical WK identity and parent acceptance
are complete but the eligible `terminal_whole_wk` unit count is zero, the route
returns the non-candidate state
`terminal_review_workflow_not_selected` with code
`agent_launch.terminal_candidate.status.workflow_not_selected.v1`,
`candidate:null`, and `next_call:null`. Its bounded deciding facts report the
valid canonical record, complete parent identity and acceptance, and eligible
count zero. This decision occurs before controlled-generation authentication,
backend state, candidate refs, metadata, or Git candidate identity are inspected.
Plural eligible units remain `ambiguous_terminal_review_coordination`; malformed
canonical contracts retain their precise projection cause; a real candidate that
moved or fails identity checks remains `candidate_identity_invalid_or_moved`.

An operator-authorized direct-to-main lifecycle does not use terminal-candidate
status, terminal-candidate advance, forge handoff, external review, or shell
review. The operator first commits the exact scoped implementation candidate.
The coordinator then calls the same registered `workspace_agent_dispatch`
reviewer route with the canonical WK or review-slice `subject` and the landed
commit's complete `diff_base_sha` and `reviewed_sha`. The reviewer is read-only
and never creates Git objects.

An admissible attempt derives an immutable per-attempt review contract keyed by the
exact candidate-version identity, immutable version ref, current-selection
observation, `C/B/W`, repository identity, tree, parent, private candidate checkout,
exact addressed parent and designated review-unit identities, historical and live
canonical contract digests, and authenticated transitions. Its identity is the
SHA-256 of that canonical key, so identical concurrent derivations converge on one
contract and a differing version or snapshot yields a different identity that
rechecks or refuses. Nothing process-local — a monitor handle, a run id, a clock, a
counter — participates, and nothing is persisted: this is not a durable epoch
registry. A crash before spawn therefore grants no durable launch authority, and a
retry re-reads, re-verifies, and re-derives from canonical evidence alone.

Managed Codex and Claude terminal reviewers receive this exact per-attempt
contract through the [normative frozen reviewer-query
protocol](mcp-dispatch-runtime-contract.md#frozen-reviewer-query-protocol), not
through prompt bodies. This terminal lifecycle remains responsible for the
candidate and live-contract gates above; it does not own query authorization,
contract-discriminator coverage, pagination, cursor grammar, or query refusals.
The shared role instruction still requires exhausting both acceptance targets,
and managed reviewer prompts remain invariant to contract length under the
complete-prompt 1200 UTF-8-byte ceiling. Pre-spawn validation, exact target facts,
findings-only terminal instructions, result schema enforcement, and unrelated
roles are unchanged.

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

The deep refusal is a process-local branded throw recognized only by the spawn
primitive and deliberately **not** a `BubblewrapIsolationError`: each family
classifies it first, ahead of the conduit remap and the sandbox decision, so a
coordination refusal is not reclassified as an unenforced retry. It carries
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

Empty write authority is also the lifecycle discriminator. Terminal, exact-slice,
standalone reviewer, and standalone redteam actions bind immutable findings
source snapshots and do not allocate, consult, or mutate persistent
implementation-WK lifecycle state; technical role remains a confinement and
transport fact only.

Candidate construction assumes the repository-wide
[design-first work-record sequence](../AGENTS.md#wk-first-work); terminal review
does not provide a local substitute for its semantic authoring or CCE-owned
sequencing.

## Active managed composition precedes dispatch and child creation

At managed-backend construction, the launcher mints one immutable, branded,
process-local composition object. It binds the exact resolved
`@agent-chassis/wiki-mcp/src/server.mjs` producer entrypoint, selected Node
executable, exact spawn primitive, producer-owned lifecycle descriptor,
consumer lifecycle descriptor, and `createStdioMcpConduit` constructor used by
both managed Claude and Codex family executors. The object is not public;
module-private brands identify it and a bounded accessor exposes only its
frozen compatibility fact and guarded conduit construction.

This fact authenticates the coherently loaded launcher/package composition; it
does not execute the selected server or attest arbitrary in-place source changes
within that backend generation. The spawned-server readiness exchange below is
the authority for what the separate server process actually executes. A partial
or hot deployment can therefore pass this early composition gate and still be
refused by the mandatory per-dispatch exchange.

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
Public projections preserve the originating
`stdio_mcp_lifecycle_protocol_incompatible` identity and recovery to deploy one
coherent build and restart the long-lived backend. They do not replace that
modeled startup cause with `operator_recovery_needed`. No raw component identity is exposed,
and historical failures cannot poison a newly minted compatible generation.
The direct Claude orchestrator topology covered here is not outside this gate:
its fresh and resume launches take their conduit constructor from the same
launcher-minted composition authority, so the pre-spawn compatibility decision —
including the on-disk producer probe — precedes both host wiki-MCP server and
confined child creation. Other direct operator launches remain outside it.

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
terminal state. This projection has an explicit closed schema: it records the typed
reason, phase (`readiness`, `mid_session_server_loss`, `relay_restart`,
`cleanup`, or `reaping`), launcher run id, and bounded cleanup resource/code
tokens only. By schema it does not serialize Error messages or causes, prompts, credentials,
environment, raw process output, arbitrary event detail, prose, or stack traces.
This is a stable lifecycle-result shape, not a least-disclosure or
confidentiality guarantee. The initiating failure remains primary. Failure to
persist this diagnostic refuses publication as
`stdio_mcp_session_diagnostic_persistence_failed`; terminal state is
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
terminating signal, a readiness/server/relay failure, a cancellation, and a
malformed probe result remain distinct execution facts. When reviewer text was
captured, however, it remains usable advisory evidence even if the structured
payload is malformed, unbranded, bound to the wrong role or subject, or is prose
only. Those defects affect only optional schema observation and formal
attestation. These dispositions affect only that run's evidence and never change
whether another exact-target review may be dispatched.

## Canonical acceptance.validation admission across the findings-only surfaces

One wiki-core owner validates and projects every selected unit's complete
`acceptance.validation[]` declaration. The only executable entry is exactly
`{operation: "node_test", target, verification_ids}`; `target` is one
canonical repository-relative lowercase-`.mjs` test-module path and
`verification_ids` is an array of unique nonblank identities. Plain nonblank
strings and exact `{note, verification_ids}` objects are human instructions,
not execution authority. Command-bearing objects, unknown operations, extra
fields, duplicate executable bindings, invalid targets, and
`sections.structured_validation` are rejected.

The work-record schema, ready-slice projection, bounded selected-unit read,
dispatch/admission projection, findings-only classifier, and role-contract
renderer all consume that owner. The same projected operation, target, and
verification population also feeds `workspace_run_validation`, managed-worker
declared-test authorization, terminal-candidate execution, and
`workspace_verify_proof`. Consumers retain their own confinement and role
authority, but none parses command text, searches secondary sections, or
reconstructs target bindings.

Reviewer rendering preserves note order and emits executable entries as compact
JSON in `operation`, `target`, `verification_ids` order. Verification
identities are deterministically sorted by the shared projection. Composition ordering is unchanged on both surfaces: the parent WK's entries
precede the selected review unit's. On a slice-level standalone surface, the
parent is authenticated as immutable inherited review material rather than as
the executable selected unit. Its canonical nonempty criteria may intentionally
carry an empty validation array while still admitting the review; an exactly
empty `{criteria: [], validation: []}` parent contributes zero inherited
entries. The selected review slice's acceptance stays mandatory and complete.
The terminal whole-WK surface has no draft-parent exception: the parent is the
selected executable unit, so both sections stay mandatory and complete there.

A malformed section fails closed. The refusal names which side contributed it —
the parent or the selected review unit — alongside the canonical detail, so the
defect is attributable without re-inspecting either frozen contract. An
entry-level canonical rejection is reported as `acceptance_validation_invalid`; a
section that is not an array at all is reported against the acceptance-section
shape; and a canonically valid entry that the typed projection cannot faithfully
render carries its own distinct non-renderable detail, so "the schema rejects this
section" is never conflated with "this projection cannot render it". A canonical
field that is present is never described as missing.

Nothing here moves an authority boundary. The final prompt formatter, the
controlled-contract schemas and vocabulary, the reviewer result schema, target
binding, evidence authority, worker and reviewer confinement, lifecycle
transitions, dispatch and readiness authority, and integration policy are all
unchanged. The frozen contracts' identity checks, role behavior, and refusal codes
are likewise unchanged; the refusals merely carry better attribution. Findings-only
review stays advisory under `decision`.

## Independent findings actions

Public SHA spellings are ordinary locator syntax, not operator authentication.
The registered `workspace_agent_dispatch` boundary accepts a complete
`{ diff_base_sha, reviewed_sha }` pair for reviewer and redteam calls and routes it
through the same normalizer used by canonical slice and terminal whole-WK
subjects. No special selection authority, carrier, attestation, receipt,
provenance identity, or persistent review identity is required.

A review target is normalized only after the resolver proves commit type,
base-to-reviewed ancestry, the required nonempty range, readable reviewed tree,
and exact private-snapshot bytes. Canonical selectors additionally prove their
canonical subject binding. The resolver keeps incomplete, malformed,
missing-object, reversed-range, disjoint-range, binding-mismatch, and moved-target
causes distinct and returns no immutable target on any failure.

Every valid reviewer or admitted redteam call against a canonical committed
target receives a distinct run, monitor, source carrier, execution state, and
private materialization. Active or historical actions never block another call.
Restart may make an old process-local handle unknown and never turns history into
an admission latch.

Receipts, logs, outcomes, and provenance are optional action-local audit evidence.
They may describe the exact subject, committed SHA/tree, diff base, role, run,
monitor, and terminal disposition, but no receipt set or latest-result projection
has dispatch, admission, completion, integration, or veto authority.

Historical `admission_review_target_unit` metadata is not read by review
execution and is not an occurrence or provenance prerequisite. Its absence,
staleness, or mismatch never requires retroactive repair. Ordinary `depends_on`
lineage remains available for a reviewer unit that challenges a predecessor
review or redteam result.

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

Terminal whole-WK findings use the same independent-action model. The current
call binds the designated review unit, exact terminal candidate ref and SHA,
fixed base SHA, WK ref and SHA, canonical WK digest, private checkout, and current
controlled generation. A fresh call for unchanged inputs still launches a new
action; no durable store recovers, resumes, replaces, or returns an earlier
action after the process-local registry is gone.

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

### Full provisioning is authoritative and no sparse guard exists

The retained slice worktree is provisioned v2/full, and that provisioning is
authoritative for checkout density. Sparse checkout is unsupported for this
surface: it is not a configuration the review path tolerates, detects, or
compensates for.

Consequently, review preparation neither probes sparse configuration nor
enumerates the ordinary index population. It reads no `core.sparseCheckout`,
`core.sparseCheckoutCone`, or `index.sparse` value in any scope, and it runs no
`git ls-files --sparse --stage` or `git ls-files --sparse -v` scan.

Nothing replaced them. There is no sparse-disable pin, no compatibility probe,
no bounded or sampled rescan, no early-exit predicate, and no increase to the
Git output-capture limit. The removal is the fix, not a step toward a smaller
guard.

The scans were removed because they were population-wide: their cost and output
grew with the size of the repository rather than with the review surface they
claimed to prove. Past a large-enough tracked population the staged scan's output
exceeded the launcher's Git output capture, and preparation failed before the
findings-only reviewer could start — a delivery-blocking failure with no bearing
on whether the review surface was exact.

Removing them narrows no authority. The exact worktree, ref, HEAD, base, and
reviewed tuple, the object-store and sequencer checks, the physical
checkout-tree verification, the ordinary-index classification and
reconciliation, historical launcher-delivery recovery, arbitrary third-index
refusal, and the complete postcheck are all unchanged. The `ls-files` calls that
remain enumerate untracked content only, so they are bounded by worktree dirt
rather than by the tracked population.

The public failure projection keeps its `...failure_projection.v1` schema
version. Its `config_key` and `config_scope` detail fields are retained in place
and in order as constant nulls, so existing consumers keep the same shape; no
refusal can populate them any more.

### Bounded postcheck mismatch diagnostics

A state-budget refusal names which bound fact drifted. The dispatch surface
republishes that name, and nothing else, as an additive
`postcheck_mismatch_field` on the thrown-diagnostic envelope, so an operator can
distinguish a moved slice ref from a substituted object directory without host
log access.

The projection is an explicit field list owned by the dispatch surface, not a pass-through
of producer detail. It applies only to the exact
`agent_launch.slice_review_materialization.postcheck_failed.v1` code; the detail
must be an own, plain-object, exactly-one-key `{ field }` shape carrying a plain
data property whose string value is a member of the closed bound-field enum.
Arrays, null prototypes, class instances, accessors, non-enumerable properties,
additional string or symbol keys, nested values, unknown values, and every other
diagnostic code omit the field entirely. Sibling refusals under the same code may
carry `git status` porcelain and raw stderr internally, but those fields are not
members of this envelope schema. This is a response-contract fact, not a
confidentiality or minimum-disclosure guarantee. Existing envelopes are otherwise
unchanged.

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

## Terminal-review audit evidence

A terminal whole-WK findings action is independent. Its receipt, log, outcome,
and provenance, when captured, are optional evidence about only that action.
Audit append failure does not change the action's result and cannot prevent a
later terminal findings dispatch. No receipt or provenance record elects,
replays, resumes, replaces, or settles a later findings action.

Run and monitor observation is process-local. An old findings handle may
truthfully be unknown after restart; a new call launches from the current
launcher-authenticated terminal source selection. Terminal candidate
construction, candidate CAS, forge handoff, and implementation/integration
lifecycle behavior remain separately owned and unchanged.

Forge publication does not authenticate or consume the historical findings
receipt, result, or provenance. Its eligibility owner authenticates the current
candidate, exact candidate version or controlled generation, base, current forge
facts, and applicable CCE decision only. Those inputs and the eligibility answer
are identical for absent, clean, critical/blocking, schema-invalid, failed, or
missing historical findings evidence. Retained review evidence remains optional
audit data and cannot enter the forge request, repair a candidate, or veto or
authorize publication.

Terminal review publication separates review occurrence, actual advisory text,
optional schema observation, and optional formal attestation. Captured text is
available and usable in full-result mode even after schema nonadherence or a
nonzero execution; compact mode carries its supported content reference. Parser
diagnostics annotate the schema observation instead of classifying the review as
invalid. Only an explicit formal-attestation request consumes adherence. The
coordinator reads and dispositions the actual response normally.

## Terminal findings execution (decision, work record)

The findings execution action for a canonical terminal whole-WK review unit is an
empty-scope immutable snapshot action. It does not recover, consult, or advance a
persistent terminal/WK lifecycle. The terminal purpose remains frozen contract
metadata, while source bytes, the canonical WK record, manifests, and the complete
carrier generation are bound independently for that call in the same manner as
standalone and exact-slice findings.

Historical terminal-candidate machinery remains relevant to implementation
candidate construction and forge coordination, but it is not findings-action
provisioning authority and cannot be selected by caller-supplied locators.
Every accepted terminal findings call creates a fresh run, monitor, source
carrier, and private materialization. Prior runs, receipts, results, failures,
roles, or metadata cannot select, satisfy, suppress, resume, replace, veto, or
refuse another terminal findings call. Observation is process-local; an old
handle may be unknown after restart. Receipts, logs, outcomes, and provenance are
optional action-local audit evidence, and audit capture failure cannot block a
later dispatch. Implementation candidate construction, integration, CAS, and
forge behavior remain independently owned and unchanged.
