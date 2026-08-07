
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

### Process-local monitoring versus restart-stable receipt authority

Two kinds of state look similar during one coordinator lifetime and are not the
same thing at all.

The run map, the monitor-handle registry, frozen review contexts, retained
recovery proofs, and the receipt store INSTANCE are **process-local
observations**. They exist to let the process that created a run watch it. They
are deliberately not persisted: a monitor handle names a live in-memory lifecycle
owner, so writing one down would only invite a later process to treat a handle it
cannot address as authority. When a coordinator process ends, all of it is
correctly gone, and a cold coordinator answering `monitor_handle_unknown` for a
handle from a previous lifetime is right, not degraded.

A trusted exact-slice review receipt is **restart-stable authority**. It is the
launcher's own durable record that a reviewer produced a validated verdict about
one exactly identified committed delivery, and it is the only thing that can
authenticate a corrective continuation once integration has moved canonical state
out of slice-level review. It therefore lives under the launcher-owned
per-workspace durable state root, whose location is a pure function of canonical
launcher configuration and authenticated workspace identity — the primary
repository checkout, proven absolute, normalized, and unredirected. Concretely,
that root is:

```
<primary-checkout>/.agent-launch/durable-state/v1
```

It is INSIDE the primary checkout, under the gitignored `.agent-launch/`
directory — never a tracked path, so it is not committed, reviewed, or carried by
a branch. It is outside `docs/`, `wiki/`, managed worktrees, and process-temporary
storage, and it is identical in every process operating on the same workspace and
distinct for distinct workspaces.

`<primary-checkout>` is the REAL path of the launcher-minted workspace. The
launcher canonicalizes `WIKI_MCP_WORKSPACE_DIR` once at its single source
(`resolveDispatchWorktreeProvisioningConfig`), resolving it absolutely and then
authenticating it through `realpath`, and the canonical result is both the
`mainRepo` every in-process operation uses and the value the managed worktree root
is derived from. A checkout reached through a symlinked path is therefore an
ordinary supported deployment, while the durable resolver keeps refusing a
redirected workspace handed to it directly: there is exactly one spelling of one
workspace, so there is exactly one durable root. A launcher workspace that is
missing, a broken symlink, not a directory, or otherwise unreadable fails closed
at startup, before any backend, receipt store, or worktree root exists.

Nothing else may select it. Caller request, prompt text, argv, ambient or
process-temporary environment (`TMPDIR` and the mutable launcher runtime-state
root included), reviewer output, and unrelated-root scans all carry no authority
over it, and there is no fallback root, compatibility alias, retry, or
process-local authority cache. Missing, malformed, redirected, ambiguous, and
unwritable authority fail closed. The receipt store keeps its append-only event
history, atomic `O_EXCL` publication, exact schema validation, monotonic
transitions, trusted evidence digests, and selector uniqueness on top of that
root; a malformed, conflicting, unreadable, or identity-mismatched event refuses
rather than degrading.

Living inside the checkout under an ignored directory has a consequence worth
stating plainly: the receipt authority is bound to THAT checkout, not to the
repository. A fresh clone starts with no receipts, and an ignored-file clean of an
existing checkout — `git clean -xd` most obviously, but equally a container image
rebuilt from a clone, a wiped workspace volume, or any tooling that deletes
ignored paths — DESTROYS the receipt authority for every unit that had one.
Nothing about the destruction is announced: canonical status, refs, and commits
are untouched, so the loss surfaces only when a corrective continuation asks for
the evidence. When it does, recovery REFUSES. It does not synthesize a receipt, and
it does not reconstruct one from canonical status, `agent_notes`, raw reviewer
prose, caller input, work-record review evidence, a sibling checkout, or a guessed
path. Preserve `.agent-launch/durable-state/` across cleans on any checkout whose
units may still need corrective continuation; once it is gone, the only route back
is a fresh review that legitimately mints a new receipt.

The practical consequence is a hard asymmetry. A restarted coordinator that holds
no monitor handle can still converge, because the durable receipt — not its lost
memory — is what authenticates the reviewed integrated delivery, carries the exact
trusted findings, supersedes the proven-dead attempt, and mints exactly one
successor, all from a subject-addressed re-issue and without
`workspace_agent_run_status`. But **a receipt that was never durably written, or
that has been lost, cannot be synthesized by retrying dispatch.** Repeating the
dispatch produces no authority, and none is reconstructed from canonical status,
`agent_notes`, raw reviewer prose, caller input, work-record review evidence, or a
guessed path. A unit in that state stays refused until an authoritative receipt is
restored or a fresh review legitimately mints one; that is the fail-closed answer,
not a defect to route around.

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

### Corrective-status recovery authority boundary

Classification, public communication, and lifecycle mutation authority are
separate boundaries for corrective-status recovery. The server classifies and
communicates the bounded refusal; the coordinator owns any subsequent status
mutation and redispatch, and neither the refusal nor its public projection
authorizes either operation.

The sole supported corrective-status guidance applies when the
server-derived reviewed-integrated state observes exactly
`parent=todo` and `slice=todo`. In that case, the typed refusal
`agent_launch.managed_run.corrective_integrated_state_unresolved.v1` may be
projected publicly as `managed_corrective_status_reconciliation_required`,
with the exact parent unit and exact slice subject. Coordinator guidance is to
set that exact parent unit to `active` and then redispatch that exact slice
subject through `workspace_agent_dispatch(role="worker", subject=<exact
slice-subject>)`.

This guidance is advisory and non-authorizing: it performs no status write and
spawns no worker. Every other unreadable, unauthenticated, ambiguous, or
neighboring state remains fail-closed on its own typed refusal; no recovery
may be inferred from message text or substituted units, statuses, or subjects.
The guidance changes none of the existing managed lifecycle, receipt,
identity, integration, or CCE semantics.

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
runtime boundary. Unknown exceptions, non-errors, forged prefixes, lookalikes,
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
or caller-selected mint operation can attach authenticity. The exported
coordinator retains `runGit`
injection for tests, but only the exact module-fixed production-default Git runner
identity may mint typed membership; explicitly passing that exact function is
equivalent to using the default. An injected, wrapped, bound, proxied, copied,
lookalike, or otherwise substituted runner is non-authenticating regardless of its
name, source text, properties, symbols, prefixes, or caller assertions. Its failure
is replaced by fixed launcher-owned transport data and crosses the public boundary
only as the byte-stable unknown projection. Structural validity remains defense in
depth, not provenance, and no request, prompt, callback, dependency object, error
property, symbol, token, or code prefix can select or replace the lookup. Copying
`terminal_candidate_failure`, reproducing all five fields, or
wrapping either a projection or carrier in a transparent or trapping proxy grants
no membership and therefore yields the exact unknown projection. The backend
still validates the returned shape defensively, but never reads an error property
as authority.

One projection boundary covers fixed-current-ref observation, recovered-contract
and input freezing, candidate identity re-derivation and comparison, object-binding
verification, private-checkout materialization, dependency-mount verification,
and final recovery verification. Any projection refusal happens before process
creation: it creates zero reviewer runs, zero executor invocations, and zero
monitor identities or handles.

Forge restart recovery uses the same private read-only lookup. Its existing
transport/control-flow reason remains in the forge refusal, while
`detail.recovery_detail` carries the exact authenticated five-field projection.
An unauthenticated exact-shaped forge exception carries the fixed unknown form.
The authenticated projection is appended only after generic forge-detail
sanitization, so its required fixed `message` key survives without making arbitrary
exception messages, Git arguments, stdout, stderr, paths, secrets, stacks, or
causes public. The runner-identity provenance gate does not alter this forge
recovery retention behavior.

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
full-checkout configuration keys and scopes for `config_key`/`config_scope`, the
closed refusal-reason allowlist for `predicate` — or a small integer inside a
fixed range (`suffix_depth` and `traversal_bound` within the historical-delivery
traversal bound, `git_exit_status` in 0 through 255). Producer detail outside that
vocabulary has no key to arrive under.

Nothing else crosses. Stacks, `cause`, arbitrary throwable properties,
filesystem or worktree paths, repository contents, index entries, `git status`
porcelain, Git stdout, Git stderr, Git argument vectors, environment values,
receipts, credentials, tokens, identities, and reservations are all absent by
construction rather than by scrubbing, and the projection is reconstructed field
by field at both the launcher primitive and the dispatch publication boundary.

Authentication is structural and conservative, never `Error.message` text. A
value qualifies only if it was constructed by the launcher's own
`SliceReviewMaterializationError` (private brand plus `instanceof`), owns that
exact class name, owns a message carrying the module's exact refusal prefix, owns
a code inside the closed `SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES` set, and
owns a plain-object detail if it has one at all. The message is read only after
those checks pass, and only as an exact member lookup in the closed predicate
allowlist; an unrecognized reason yields `predicate: null` rather than any
producer or caller text. Name-only, code-only, plain-object, prototype-forged,
proxy-wrapped, out-of-taxonomy, malformed-detail, unknown, and unrelated values
all fail at least one conjunct and keep producing the byte-stable generic failure
with no nested projection and no leaked detail.
