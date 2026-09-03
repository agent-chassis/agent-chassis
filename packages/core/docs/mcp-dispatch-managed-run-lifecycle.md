
# MCP dispatch managed run lifecycle

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
durable managed-run process identity, subject-addressed restart convergence, and
process-local monitoring versus restart-stable receipt authority.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

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

Preserving that internal distinction grants no new public diagnostic authority
and does not change the lifecycle disclosure boundary. A tuple-resolution
failure is not a branded closed lifecycle failure carrier, so what
`workspace_agent_run_status` and `workspace_agent_run_wait` publish for it is
unchanged: the same fixed generic lifecycle failure code and message every
unbranded lifecycle rejection already publishes, with no raw exception code,
message, or detail projected onto the public envelope.

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
`workspace_agent_run_status` with the same handle and exact subject after an
incomplete launcher-retirement step is mechanical recovery; advice to activate a
parent, integrate a slice, remediate findings, or redispatch solely because of a
status tuple is policy and is not launcher-owned.

Under [decision](../wiki/decisions/decision.md), historical runs and results are
evidence rather than gates for a current execution generation. Under
[decision](../wiki/decisions/decision.md), findings-only output remains advisory
and grants no lifecycle authority. Public projections preserve the exact owning
boundary: CCE policy recovery is forwarded without local invention, while a
mechanical refusal reports only its exact launcher-owned recovery.

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
projection boundary.

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

### Exact-slice materialization failure disclosure

A post-worker lifecycle rejection publishes one generic pair on
`slice_lifecycle`: code `agent_launch.slice_lifecycle.failed.v1` and message
`post-worker slice lifecycle invocation failed`. That pair is fixed at the seam
and is never derived from the value that was thrown, so an unbranded rejection
discloses nothing. It is also, on its own, undiagnosable: a managed run whose
exact-slice review preparation refuses can stay nonterminal across arbitrarily
many polls while the identity of the failing predicate is discarded.

#### Seam-keyed lifecycle failure codes

`error_code` on `slice_lifecycle` is read by `workspace_agent_run_status` and
`workspace_agent_run_wait`, and a rejection at one of the phased body's BRANDED
dependency seams publishes that seam's own stable code and fixed message instead
of the generic pair:

| Seam | `error_code` | `error_message` |
| --- | --- | --- |
| terminal candidate preparation | `agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1` | `post-worker terminal candidate preparation failed` |
| terminal candidate validation | `agent_launch.slice_lifecycle.terminal_candidate_validation_failed.v1` | `post-worker terminal candidate validation failed` |
| committed-slice integration continuation | `agent_launch.slice_lifecycle.committed_slice_integration_continuation_failed.v1` | `post-worker committed slice integration continuation failed` |
| frozen review-context binding | `agent_launch.slice_lifecycle.frozen_review_context_binding_failed.v1` | `post-worker frozen review context binding failed` |
| managed-worker identity retirement | `agent_launch.slice_lifecycle.managed_worker_identity_retirement_failed.v1` | `post-worker managed worker identity retirement failed` |

A code is a property of the SEAM the phased body names, never of the value that
was thrown: the same code is published for a typed refusal and for an arbitrary
throwable, and nothing is classified, matched, stringified, probed, or read to
select one. Both published fields come from a fixed per-seam table, so
`error_message_truncated` stays `false` and no library, syscall, credential,
path, or environment text can reach either field. The nested closed
`candidate_failure` projection described above accompanies the two
terminal-candidate seams only; the other three publish no nested projection.

The integration-continuation seam is reached from two phases — restart recovery
and the parked slice-review phase — and both publish the SAME code, because they
are one dependency boundary and the envelope's own `phase` already distinguishes
them.

THE GENERIC PAIR STILL GOVERNS EVERY UNBRANDED REJECTION. It is unchanged for
every other rejection the lifecycle can raise, including the exact-slice review
surface preparation, the lifecycle's own typed refusals, and any value a branded
seam's dependency did not itself reject with. Nothing about terminality, the
`next_action`, attempt accounting, the bounded retained-failure ring, or the
additive `postcheck_mismatch_field` and `materialization_failure` discriminators
changes: those two discriminators are computed on the unbranded branch, and their
producing surface is deliberately not one of the branded seams.

An AUTHENTICATED exact-slice materialization refusal therefore additionally
carries the closed
`agent_launch.slice_review_materialization_failure_projection.v1` contract as
`slice_lifecycle.materialization_failure`. This is OBSERVABILITY ONLY. It grants
no authority, performs no retry, reconciliation, materialization, mutation,
cleanup, review, integration, or status change, and it changes nothing else about
the response: the outer code and message, the truncation flag, the top-level
`next_action`, terminality, attempt accounting, and the bounded retained-failure
ring are all exactly as before, and concurrent waiters still share the single
recorded failure of one lifecycle attempt. The pre-existing additive
`postcheck_mismatch_field` discriminator is unchanged and coexists with it.

The projection has exactly the five enumerable keys `schema_version`, `kind`,
`code`, `message`, and `detail`:

```json
{
  "schema_version": "agent_launch.slice_review_materialization_failure_projection.v1",
  "kind": "slice_review_materialization_failure",
  "code": "<one stable agent_launch.slice_review_materialization.* code>",
  "message": "exact-slice review materialization refused",
  "detail": {
    "predicate": "<one closed refusal reason, or null>",
    "field": null,
    "pseudoref": null,
    "config_key": null,
    "config_scope": null,
    "suffix_depth": null,
    "traversal_bound": null,
    "git_exit_status": null
  }
}
```

`message` is fixed for every code. `detail` always carries all eight keys, `null`
where the refusal does not supply one, and each admitted value is either a member
of a frozen vocabulary the launcher already owns — the postcheck bound-state
budget for `field`, the refused sequencer pseudorefs for `pseudoref`, the
constant-null compatibility fields `config_key`/`config_scope`, the closed
refusal-reason allowlist for `predicate` — or a small integer inside a fixed
range (`suffix_depth` and `traversal_bound` within the historical-delivery
traversal bound, `git_exit_status` in 0 through 255). Producer detail outside that
vocabulary has no key to arrive under. The bounded shape exists so callers get
stable, task-relevant refusal facts without arbitrary producer detail; it is not
a least-disclosure or confidentiality policy.

Nothing else is part of this schema. Stacks, `cause`, arbitrary throwable properties,
filesystem or worktree paths, repository contents, index entries, `git status`
porcelain, Git stdout, Git stderr, Git argument vectors, environment values,
receipts, credentials, tokens, identities, and reservations are all absent by
construction rather than by scrubbing, and the projection is reconstructed field
by field at both the launcher primitive and the dispatch publication boundary.

Classification is structural, never based on `Error.message` text. A
value qualifies only if it was constructed by the launcher's own
`SliceReviewMaterializationError` (private brand plus `instanceof`), owns that
exact class name, owns a message carrying the module's exact refusal prefix, owns
a code inside the closed `SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES` set, and
owns a plain-object detail if it has one at all. The message is read only after
those checks pass, and only as an exact member lookup in the closed predicate
allowlist; an unrecognized reason yields `predicate: null` rather than any
producer or caller text. Name-only, code-only, plain-object, prototype-shaped,
proxy-wrapped, out-of-taxonomy, malformed-detail, unknown, and unrelated values
all fail at least one conjunct and keep producing the byte-stable generic failure
with no nested projection.

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

`work record` replaced the cross-store managed-worker reservation with one
subject-partitioned, digest-chained attempt journal. This section states the
authority, transition, release, and failure boundaries that replaced it. It does
not change the `work record` crash-durable publication or liveness authority: that
substrate remains the mechanism owner and interprets no field written here.

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
attempt tuple, monotonically contiguous sequence, prior-event digest, the exact
canonical contract-generation digest, the exact accumulated WK tip, a closed
event kind and payload, and its own digest. Generation and WK tip are frozen at
`reservation_claimed` and must be repeated identically by every later event for
that attempt. An unknown version, an extra key, a sequence gap, a chain break, a
content-tampered digest, or a binding mismatch refuses that partition only.

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

An attempt whose frozen generation digest or accumulated WK tip is no longer
current is historical. It authorizes no new spawn, delivery adoption, integration
intent, terminal candidate, or publication, but it retains any possibly live
execution reservation until exact authenticated release proof arrives.

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
