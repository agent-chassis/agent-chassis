
# MCP dispatch slice integration

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
empty and no-op slice deliveries, zero-delta lifecycle recovery, and managed
worker completion and post-commit structured evidence.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

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

### Authenticated historical launcher-index recovery

That two-state rule stays exactly as written. Multi-round corrective delivery
adds one further accepted prestate to exact-slice review-surface preparation, and
only there: because corrective rounds reuse the same deterministic slice worktree
while the commit primitive materializes through an isolated index, the ordinary
index can be left at an EARLIER round's launcher delivery — equal to neither the
current binding base nor the reviewed tree. This recovery exists so that state is
repaired in place, preserving the retained multi-round delivery rather than
relaunching the worker, rewriting the delivery, or moving the slice ref.

The earlier state is authenticated, never assumed. The retained index tree must
sit on the LITERAL single-parent suffix running from the reviewed delivery,
through the current authenticated binding base, into history, with every commit on
that suffix an exact canonical server-minted delivery for that slice subject cut
from that commit's own literal parent. Authentication reads literal commit objects
only, ignores replacement objects, uses no revision expression as authority,
consults no graft- or replacement-sensitive ancestry, caches object reads, and is
bounded by a fixed limit no caller, prompt, or environment can raise. Malformed
objects, missing parents, merges, cycles, wrong object types, wrong subjects,
wrong bases, noncanonical messages, Git faults, and bound exhaustion all refuse.
The bound slice ref, HEAD, and ordinary index are re-proved immediately before the
single `read-tree`, and the complete post-preparation verification then runs
unchanged.

This is not acceptance of an arbitrary third index. Tree equality alone grants
nothing: an arbitrary staged index, a staged path absent from the physical
checkout, a merely reachable ancestor, a same-tree unrelated commit, a caller
claim, a timestamp, canonical status, and worktree cleanliness alone are all still
refused, and every such refusal happens before any index mutation and preserves
staged, unstaged, mixed, untracked, ignored, and unrelated historical state
byte-for-byte. There is no general reset, clean, checkout, restore, or
catch-and-continue fallback, and worktree reuse policy is unchanged. Recovery is
idempotent: once the ordinary index is the reviewed tree, a repeat is the existing
no-op.

### Current attempt base versus accumulated reviewer diff base

A corrective round has two distinct bases, and they are not interchangeable.

The **current corrective attempt base** is the launcher-bound parent of the
attempt that just delivered. Its authority is the exact-slice provisioning
binding minted for that attempt; the post-worker lifecycle authenticates the
delivery against it, and a delivery whose sole parent is not that base is
refused. It is an attempt-scoped fact and it moves with every corrective round.

The **accumulated reviewer diff base** is `merge-base(<persistent WK ref>,
<exact slice ref>)`. Its authority is the canonical committed-slice review
admission alone, derived from the launcher-owned WK and slice refs plus the
complete server-minted delivery chain between them. Caller input, prompt text,
ambient environment, canonical status, review receipts, and arbitrary binding
fields never select it.

For a first-round delivery the two coincide, because the attempt parent is the
same commit the persistent WK lifecycle last shared with the slice. After a
second or later corrective round they legitimately **differ**: the attempt parent
is itself an earlier canonical delivery that the persistent WK ref does not yet
contain, so the accumulated base sits further back and the accumulated range
spans every delivery in the round chain. Requiring the two to be equal refuses a
correctly delivered chained corrective round before reviewer spawn; they are
therefore authenticated separately, each against its own authority, and neither
substitutes for the other.

Reviewer projection is consistent and single-sourced: the frozen slice-review
context, the lifecycle's review-surface result, and the reviewer dispatch context
all describe the review range as the independently authenticated accumulated
committed-admission range (`diff_base_sha`, `diff_head_sha`, `diff_range`). The
current attempt base remains visible beside it under its own name and is never
relabelled as the reviewer's diff base. Ref, reviewed-SHA, worktree, canonical
review-unit, or commit-chain disagreement still refuses before reviewer spawn,
leaving refs, worktree, canonical record, index, and lifecycle identity untouched.

### Compound final-slice record write applies to every integration route

The compound single-write rule governs **every** production integration route,
not only zero-delta recovery. On the ordinary path as well, when the integrated
slice is the final incomplete implementation slice, the slice reaching `done`
and the parent reaching `review` are one CAS-guarded canonical record write.
They are never two independently visible writes, so an observer cannot see a
final slice transition without its parent transition (or vice versa).

This contract binds all three production routes: the canonical committed-slice
adapters in `packages/agent-launch-cli` and `packages/wiki-mcp`, and the
trusted-runtime primitive `defaultIntegrateManagedWorkerSlice`. Those routes
all supply the compound seam; this is the integrated state at WK tip
`56a61fe884df4f998736ce858f3be6962d9076c3`.

A final implementation slice left at `review` under a parent already at
`review` is a defect state, not a valid steady state. The active-parent
requirement in `backend-slice-review-authority.mjs` surfaces it by refusing
slice-level review when the parent is already in whole-WK review. The separate
reconciliation-masking issue remains tracked as `work record`; this contract does
not claim that issue is resolved.

Integration re-derives the remaining delta independently from immutable Git
objects rather than trusting commit-time or lifecycle bookkeeping. It applies the
exact slice target to the current accumulated WK tree with `git merge-tree`. A
nonempty result retains the ordinary immutable replay and WK-ref compare-and-swap.
A zero-delta result instead advances the WK ref to one launcher-owned evidence
commit; leaving the ref byte-identical is not a durable success state.

The evidence commit has the exact current WK tree and exactly one parent, the
expected-old WK tip. Its raw UTF-8/LF message is mechanically minted as:

```text
agent-launch zero-delta integration evidence: <SUBJECT>

Wk-Slice: <SUBJECT>
Wk-Slice-Integration: v1
Wk-Slice-Delivery: <DELIVERY_OID>
Wk-Slice-Base: <BASE_OID>
Wk-Slice-Wk-Parent: <WK_PARENT_OID>
Wk-Slice-Empty: true
```

The displayed block has exactly one terminal LF. `SUBJECT` is the canonical
`WK-NNNN#SLICE-MMM` identity, and every OID is a full lowercase nonzero object id
of the repository's object format. Authentication reads the literal commit
object, extracts its raw message bytes, mechanically reconstructs the template,
and requires byte equality. It also reauthenticates the reviewed server-minted
delivery, its base, the evidence commit's sole parent, the parent/result tree, and
the zero-delta application. Alternate field order, spelling, padding, line
endings, body placement, duplicate or missing fields, extra bytes, caller text,
abbreviated or malformed OIDs, extra parents, and wrong trees grant nothing.

Publication is one Git ref transaction. It verifies the exact slice ref still
names the reviewed delivery and advances only the WK ref with an expected-old
operand equal to the authenticated WK parent; that operand is the transaction's
WK-ref verification. Deletion, symbolic or malformed output, movement, and
transaction faults refuse without mutation. A concurrent loser succeeds only by
reauthenticating exactly one complete reachable evidence match for the same
subject, delivery, base, WK parent, and tree. Unmatched historical same-slice
commits are irrelevant, while zero or multiple complete matches refuse whenever
durable recovery authority is required.

### Final-slice sibling completeness is bounded by the fixed WK fork

The record compare-and-swap decides, on every attempt, whether the slice it just
integrated was the last incomplete implementation slice of the WK. That decision
is proven by **one fixed-fork-bounded literal history proof per CAS attempt**,
not by an independent full-ancestry walk per done sibling.

The boundary is the launcher-owned immutable WK fork ref
`refs/agent-launch/wk-forks/<initiative>/<WK>` (decision). Its name is derived
only from the already-validated initiative and WK identity, and its target is
observed as one exact direct commit — never peeled, never symbolic. Current
`main`, the current slice attempt's base, a merge-base, caller input, prompt
text, environment, record prose or status, boundary authorization, and reviewer
output are **not** boundary authority and cannot supply or override the floor.

Within each attempt the live record, the live WK tip, and the fixed fork are all
re-resolved; nothing — no fork value, history cache, or marker conclusion —
crosses a retry. The single walk reads exact full-OID objects with replacement
objects disabled, parses raw commit bytes, enforces cycle detection and the
literal-commit bound, and stops at the fork. Every path explored from the WK tip
must terminate at that fork; a path that ends, escapes, or becomes indeterminate
first leaves the region unproven. Every relevant done sibling is then evaluated
from that one walk, preserving cancelled-sibling behavior, record-status gating,
exact `<WK>#<SLICE>` identity, canonical worker-delivery and zero-delta marker
authentication, singular and plural legitimate markers, malformed-marker refusal,
exact parent checks, and the FOUND/ABSENT/INDETERMINATE meanings. Pre-fork
commits are outside the WK lifecycle: a canonical-looking or malformed
same-subject message before the fork cannot influence the decision. Deterministic
cost is proportional to commits after the fixed fork plus relevant marker
candidates, and is independent of total repository history and of how many done
siblings exist.

**Supported automated WK integration requires this ref.** A legacy WK that
carries no fork ref is not integrated automatically: it is an operator-handled
unit, and an authenticated historical fork may be registered manually outside the
integration path. There is deliberately no inferred fallback — not full-root
traversal, not current `main`, not a merge-base, WK tip, reflog, or record prose.

Fork authority is authenticated **before the first integration mutation**.
`integrateCommittedSlice` resolves and validates the ref before
`advanceSliceRefCas` or any other mutation, so an absent or already-invalid
binding refuses while the WK ref, the slice ref, and the canonical record are all
still untouched — rather than wedging the unit with Git advanced and the record
behind. A missing, ambiguous, symbolic, non-commit, or malformed ref is a
completed negative observation and refuses with `BINDING_MISMATCH`; a Git
transport or process failure proves nothing about the binding and refuses with
`GIT_FAILED`. This preflight is a guarantee about absent-or-already-invalid
authority, not a claim that every concurrent movement is caught before mutation:
a fork that moves *afterwards* is caught by the per-attempt recheck immediately
before the record write, which refuses rather than publishing a decision taken
against stale authority.

**Both** final-slice sibling-completeness deciders use the bounded proof: the
record-CAS write path and the sibling-completeness decision inside
`recoverZeroDeltaIntegratedSlice`. Both take launcher-authenticated fork
authority rather than caller input, and for the same record, WK tip, and fork
they return the same answer.

Everything else stays full-history by design: `resolveSliceMarkerEvidence`,
`resolveSliceMarkerCommit`, `resolveZeroDeltaIntegrationEvidence`, the
marker-evidence recovery inside `advanceSliceRefCas`,
`reconcileIntegratedSliceRecord`, and the other historical
reconciliation/recovery callers keep their existing arguments, full-ancestry
search scope, and semantics. Only the sibling-completeness decision is bounded.

The fixed fork must **dominate every parent path** from the WK tip. When it does
not — a path that reaches a root, escapes the floor, or becomes indeterminate —
the proof returns the existing fail-closed incomplete decision, and that refusal
may first walk until a root commit or until `MAX_LITERAL_COMMITS` is exhausted.
On a *successful* bounded proof, `MAX_LITERAL_COMMITS` now bounds the
authenticated post-fork lifecycle region rather than total repository history, so
a WK whose full ancestry exceeds the limit is still provable when its post-fork
region does not. A non-dominating fork, a missing object, a malformed commit, a
cycle, and bound exhaustion all yield the incomplete/false decision and gain no
new mutation authority.

### Zero-delta lifecycle recovery

Durable evidence recovery runs before fresh committed-delivery admission and
before consulting process-local completed-integration maps. The state
classification is closed:

- Multiple complete evidence matches always refuse without record or ref mutation.
- Zero matches permits fresh admission only for a slice in `review` under a
  preterminal parent. A done or cancelled slice, or a parent in `review` or
  `done`, refuses as `status_without_evidence`; every other status is inadmissible.
- One current-tip match with a slice in `review` under a preterminal parent
  performs one expected-digest canonical-record CAS. With incomplete sibling
  implementations it marks only the slice done and returns non-final with no
  review target. With none remaining the same record image marks the slice done
  and parent `review`, returning final with the exact frozen whole-WK target.
- One match with an already-done slice is read-only. Under a preterminal parent it
  is non-final only while another implementation remains incomplete; otherwise
  the split state refuses. Under parent `review`, historical evidence is
  non-final and owns no target, while exact current-tip evidence reconstructs the
  final target. Parent `done` is terminal read-only and mints no new target.
- Evidence with a cancelled, todo, active, blocked, parked, or inbox slice
  refuses. Any non-done slice under a parent in `review` or `done` is a
  contradiction and refuses.

The slice-done update and final parent transition are never two independently
visible writes. Evidence plus the one stale-but-admissible slice-review state may
re-drive only the compound record CAS; correct evidence plus correct canonical
status reconstructs read-only. Every reconstructed result preserves
`empty_delivery:true` and the exact delivery, evidence, WK, base, and review-target
ownership. Status, notes, reviewer prose, caller SHAs, and process-local maps
never synthesize recovery authority. This contract owns durable integration
result reconstruction only; cross-generation delivery of that result to an
original monitor remains a separate transport concern.

The same coordinator-owned lifecycle transition is then permitted. Findings,
clean output, malformed or plural review evidence, and absent historical attempt
state remain advisory facts; configured CCE policy is the only policy gate. A
non-empty remaining delta continues through the normal immutable-object
application, conflict detection, and expected-old WK-ref compare-and-swap. A
missing or malformed required ref/object, an uncomputable delta, a real content
conflict, or a lost compare-and-swap remains a technical refusal. Replay repeats
the same object calculation, so an already integrated delivery converges without
losing or overwriting accumulated content.

## Managed worker completion and post-commit structured evidence

A managed exact-slice implementation worker has exactly one completion sequence,
and every supported family prompt states it once, in this order: successfully
invoke the launcher-provided closed-input commit capability, then emit the
`agent-role-result.v1` structured evidence, then terminate. The shared
family-neutral terminal-result renderer is the single source of that ordered
protocol. Family role contracts carry no parallel completion instruction of their
own; in particular they no longer carry an independent commit-and-terminate
sentence, and they no longer claim that confirmed termination itself causes
integration, whole-WK freezing, and review — exact committed-slice review runs
before integration.

Authenticated closed-input commit is the sole implementation delivery and the
sole implementation-to-review authority. Worker structured output is strictly
post-commit evidence: it is diagnostic, non-authorizing, and never a delivery
fact. `reported_outcome:"completed"` is meaningful only after that commit has
already returned success. Child prose, a fenced or raw JSON result, a zero exit
status, and process termination cannot fabricate a delivery between them.

The failure matrix follows from that split:

- Commit capability unavailable or refusing the delivery is a `blocked` or
  `failed` diagnostic result; no `completed` claim is admissible.
- Commit succeeding and structured output then going missing or malformed leaves
  the authenticated delivery fully intact; only the diagnostic evidence is lost.
  Output failure after commit never erases delivery.
- A process that exits without invoking commit is a missing delivery: the delta
  stays unpublished and enters neither review nor integration.
- An authenticated same-tree child commit is a valid zero-delta delivery.
- Repeated equivalent commit calls converge on the existing trusted-tool
  idempotency; the prompt adds no retry protocol of its own.

Structured worker-result collection itself is unchanged and still runs across
families. One terminal-result mode governs each dispatch, and within a family the
same value governs both the final rendered worker prompt and that family's schema
transport — Codex's `--output-schema` file push and Claude's inline schema — so
prompt shape and schema constraint can never disagree.

The two families reach that single value by different routes, and both routes
begin at the same launcher-minted tier fact. On the Codex path the launcher
resolves the mode once, at the dispatch executor, and threads it unchanged through
the worker chain — plan-args carrier, role plan, worker plan, wrapper gate launch
packet, and headless argv construction — so nothing downstream re-resolves it. On
the Claude path the family adapter derives the corresponding mode itself, from the
launcher-supplied tier fact it is handed, in the same place it disposes the inline
schema flag. Neither route consults caller request, prompt text, ambient
environment, argv, or model output, and family identity selects only the transport
spelling, never the mode. Reviewer and redteam completion semantics are untouched
by this boundary.
