
# MCP dispatch slice integration

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
empty and no-op slice deliveries, zero-delta lifecycle recovery, and managed
worker completion and post-commit structured evidence.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## Common fixed-fork squash candidate, independent review and exact forge lifecycle

Every forge publication publishes the same thing, whichever delivery workflow the
repository selected.

- **One candidate.** For the selected integrated WK tip `W` and the fixed
  authenticated fork `B`, the existing trusted constructor builds the squash
  candidate `C` with `tree(C) = tree(W)` and sole parent `B`, and handoff
  publishes `C` unchanged. The current base tip is not a construction input.
  There is no direct-`W` alternative, no second constructor and no additional
  candidate store or ref family.
- **The candidate is publication material; review is an independent consumer.**
  Every fresh final integration constructs `C` and materializes its squashed
  candidate worktree, whether or not the canonical record designates a terminal
  review unit. No review unit, review contract, review evidence or retained
  reviewer context is an input to construction, reconstruction, recovery,
  materialization or publication, and the candidate bytes carry no review field.
  Publication requires the squashed candidate worktree bound to exactly `C`; its
  presence says nothing about whether a review ran. The candidate object binding,
  its tree and sole-parent topology, the worktree, the selected version and the
  controlled generation are authenticated on every publication, and the result
  carries no review-selection fact. A terminal review, when one is dispatched,
  consumes this same exact candidate.
- **A selected candidate is resolved from durable state on every call.** Forge
  publication resolves `C` from the fixed current-selection ref through the
  terminal-candidate coordinator: it authenticates the exact-`W` generation,
  re-derives and verifies `C`, converges its selected version and materializes
  the worktree. Process memory does not participate, so a fresh process and a
  warm one resolve the same state. When the current ref is absent but the durable
  fork and WK refs survive, the same candidate is reconstructed byte for byte; when
  either durable ref is absent the stable
  `terminal_candidate_recovery_current_ref_absent` verdict is genuine absence. A
  failed read, an invalid candidate or an authentication failure is never absence:
  it keeps its authenticated cause, stops that attempt before any forge effect,
  and the registered `workspace_publish_work` route reports it with
  `stage: "candidate_resolution"`. Recovery consults no current landing state.
- **The fence holds before any external effect.** Repository, WK, fork, tip,
  candidate identity, tree, parent and controlled generation are rechecked under
  the existing exclusion before the branch or the proposal is touched. A moved or
  foreign input, an inconsistent candidate identity, tree or parent, or
  generation drift refuses with zero publication. Configured CCE denial is
  enacted; the absence of a configured decision is not a local denial.
- **Publication is create-or-observe and nothing more.** The result reports the
  exact candidate and proposal identity and the truthful effects. Repeating a
  handoff recovers the same proposal and the already-published closeout chain
  rather than opening a duplicate or appending closeout commits again, a branch
  already present at different bytes refuses rather than being republished, and
  publication neither merges nor completes the WK on the base branch.
- **Closeout preserves the published bytes.** Before initial publication, both
  workflows keep `C` beneath exactly two WK-only commits carrying the actual
  applicable closure evidence under the parent status the live record actually
  holds, and then the parent's transition to `done`, so
  the initially published pull request already carries parent status `done`;
  that status is branch-local until a confirmed merge. A workflow without
  terminal review has no terminal-review record fabricated for it. Merge takes
  the exact authenticated pull-request head only on confirmed mergeability and
  adds no commits, and an unmerged, unknown, moved or foreign state leaves the
  canonical parent exactly as it was. The confirmed merged base record is canonical, and a reconciliation
  failure is a typed partial success.

## Authority boundary and ownership map

Contributor sequencing and consuming-repository integration are separate
contracts. The contributor process in `AGENTS.md` governs how a WK is prepared:
work record's DRY and DEC reviews, contract authoring, and any design redteam are
coordinator-owned sequencing evidence, not a runtime integration gate. work record
is historical evidence of launcher-owned reviewer-attempt and receipt-lineage
work that was reconciled directly on `main`; it has no implementation delivery
or review receipt to reconstruct and grants no integration veto. Neither record
changes the consuming repository's integration authority.

The consuming-repository boundary has three explicit owners:

1. `resolveCanonicalSliceIntegrationUnit` in
   `packages/agent-launch-cli/src/lib/backend-scope-authority.mjs` is the
   canonical integration-unit registry/lookup. It resolves the record, slice,
   parent contract, and exact refs from the canonical repository. A subject is
   a lookup key, not permission to supply those values.
2. `requestCommittedSliceIntegration` in
   `packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs`
   is the launcher producer. It derives and authenticates the committed target,
   mechanical integration facts, advisory review evidence, and the configured
   CCE boundary decision before invoking the integration primitive. It owns
   integration admission and canonical state transitions; it does not infer
   authority from review text or result fields.
   `slice-integration-policy.mjs` owns the exact-target CCE policy authorizer;
   the backend composes one instance for fresh integration and record recovery.
3. `registerCommittedSliceIntegrationRoute` and its
   `projectIntegrationSuccess` helper in
   `packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs`
   are the MCP projector. They validate the public subject, reject caller
   authority carriers, and project the launcher result into the MCP schema.
   Evidence counts and dispositions are correlation output only; projection
   never becomes a second registry, producer, or policy gate.

The public request is `integrate_work({delivery:{ref_id}})`. The delivery
owner authenticates its canonical subject, commit, source and managed attempt.
Saved dispositions are read from that same source by the existing owner; a
saved disposition alone never requests integration. The request has no repository
selector, replacement subject, ref, target, review verdict or authority carrier.

A refused request returns `accepted: false` with the blocker and the canonical
`refusal` carrier. For a backend refusal, `blocker.detail` is the producer's
complete refusal (its code, reason, detail, CCE `diagnostic_kind` and schema, and
the cause chain of any captured evidence) projected once through the shared
dispatch failure projection. The public code comes from the integration owner:
`agent_launch.slice_integration.cce_policy_refused.v1` only when the owner itself
classified that exact result as a returned CCE decision (by identity, never from
a caller-shaped field), a registered pass-through classification otherwise, and
`agent_launch.slice_integration.classification_unavailable.v1` when neither
exists. The carrier holds the producer refusal identity, the owner's
classification and any producer correction condition unchanged, and its
`no_supported_route` recovery names who must act: the operator for the serving
runtime's Git `merge-tree --merge-base` capability, the coordinator for a
delivery outside the canonical write scope, the registered classification's actor
otherwise, and `responsible_actor: null` with an explanation when no owner
established a correction. No call is offered: an unchanged request refuses
identically, and a correction condition grants no integration authority. Caller
authority fields, a malformed subject and an absent backend refuse the same way
(caller, caller and operator respectively), and an unresolvable `repo` is the
repository-resolution owner's `workspace_repo_resolution_invalid` refusal.

These roles are selected by explicit structured fields and bound function
contracts, never by substring matching over a reason, code, subject, or prose.
The normative CCE-policy versus local-mechanical boundary is owned by
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md#cce-policy-and-local-mechanical-recovery-boundary).
This page applies that boundary only to integration mechanics: launcher- and
Git-derived prerequisites must authenticate before the integration mutation,
while review findings and other advisory evidence do not become integration
preconditions. Findings-only authority remains advisory under decision and
decision.

## Empty and no-op slice deliveries

Commit-object materialization stays first: the immutable tree and commit objects
are written before any check, so every check binds to one immutable object rather
than to a re-read worktree. An empty trusted changed-path set is not a third
commit blocker: once structural write-scope containment succeeds, the exact-slice
delivery performs the same implementation-to-review transaction as any other
delivery. That containment is the shared scope interpretation described in
[Enforcement Model](enforcement-model.md#scope-doctrine) — one declared-to-effective
derivation, membership at the authenticated base tree, one candidate matcher —
and the closed-input commit gate, this page's admission, and the retry re-check
all consume it rather than restating it. A within-scope zero-delta delivery still publishes an authenticated
server-minted child — its single parent is the launcher-authenticated base and
its tree equals that base tree — and advances the exact slice ref to that child
through the expected-old compare-and-swap. `empty_delivery` is reported from tree
equality, never from an unchanged ref. A replay materialized from a prior real
delivery leaves that exact delivery reachable as the new child's ancestor; an
equivalent same-tree child converges idempotently on the already-published winner
and never hides, discards, or replaces it.

When a managed worker terminates successfully, the post-worker lifecycle
mechanically separates an authenticated delivery from a missing one before
integration, and the exact slice ref is the witness: an unchanged ref
is ALWAYS the absence of a committed delivery, and any authenticated delivery —
empty or not — has advanced it. An **authenticated delivery commit** is a slice
ref advanced past its launcher-bound base with a server-minted commit chain. It
may carry a nonempty delta or be a **genuine zero-delta child** whose tree equals
the base tree; either way it advanced through the expected-old compare-and-swap
and takes the full real-delivery path — the lifecycle requests this page's
canonical committed-slice integration directly, with no review step — retaining
server-minted chain
verification, write-scope containment, object and target-stability checks, and
the exact-parent assertion — which a same-tree child satisfies because its sole
parent is the launcher-bound base. `empty_delivery` is that tree equality, not
ref identity. A **missing delivery** is an unchanged slice ref with no
authenticated closed-input delivery at all: the worker changed authorized files
but never invoked the closed-input commit, so the delta is unpublished. A missing
delivery is not a committed slice. It does not enter integration; it moves no ref; it preserves every
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
committed or submitted success. The effects every outcome reports are defined in
[Exact commit transaction and immutable integration](#exact-commit-transaction-and-immutable-integration).

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
slice ref does not itself rewrite the retained worktree's ordinary index;
delivery aligns that index afterwards, as described under
[Worker checkout finalization](#worker-checkout-finalization), and a delivery
whose finalization is still pending leaves it at the diff base. Canonical
committed-slice reviewer admission accepts exactly two index states: already
reconciled to the reviewed target, or still equal to the authenticated diff base.
In the latter state it independently verifies the target's changed-path set,
tracked modifications and deletions, added and ignored files, blob contents, and
file modes against the reviewed commit. An arbitrary staged state, extra file, or
filesystem drift refuses before reviewer spawn. Integration never reads or
rewrites the slice worktree's contents: after its ref movement it finalizes the
WK's own checkout, as described under
[WK checkout finalization](#wk-checkout-finalization), and, once the worker's
retirement is confirmed, removes the integrated slice worktree whole, as
described under
[Integrated slice checkout reaping](#integrated-slice-checkout-reaping).

### Authenticated historical launcher-index recovery

No managed post-worker route invokes exact-slice review-surface preparation;
the preparation primitive's contract below is unchanged for its direct callers.
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

The retained ordinary index is authenticated by walking the canonical
server-minted delivery commits from the frozen successor toward the
launcher-owned persistent WK fork ref
`refs/agent-launch/wk-forks/<initiative>/<WK>`. That exact fork target — both
its literal commit identity and its literal tree — is the bounded terminal of
the proof. Every commit above that terminal still has to pass the literal
single-parent, canonical-message, slice-binding, subject, parent, and fixed
bounded-depth checks. The ordinary WK fork terminal is the deliberate
exception: it may itself be a merge commit because its authority comes from
the launcher-owned ref identity and literal tree, not from delivery-shaped
single-parent parsing.

An absent WK fork ref supplies no terminal: authenticated recovery may still
succeed through the pre-existing canonical delivery-suffix tree match, while
any case that requires the absent terminal refuses; a moved, malformed,
symbolic, non-commit, or wrong-tree fork, or an arbitrary, replacement/graft-
sensitive, or otherwise unauthenticated delivery suffix, still fails closed.
Tree
equality, a caller-supplied value, or a merely reachable ancestor supplies no
authority. This authentication only prepares the retained review surface; it
does not change this repository's contributor review-before-integration
sequencing recommendation or the existing closed-input commit, integration,
terminal whole-WK review, and
forge-publication authority.

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

An explicitly dispatched exact-slice reviewer describes its review range as the
independently authenticated accumulated committed-admission range
(`diff_base_sha`, `diff_head_sha`, `diff_range`); the post-worker lifecycle
publishes no review range at all. The current attempt base is never relabelled as
the reviewer's diff base. Ref, reviewed-SHA, canonical review-unit, or
commit-chain disagreement refuses before reviewer spawn, leaving refs, worktree,
canonical record, index, and lifecycle identity untouched.

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

The complete-WK review target that accompanies the final-slice transition, on
fresh integration, record-only reconciliation, and read-only observation or
recovery alike, takes its diff base as `merge-base(refs/heads/<base_ref>, <WK
tip>)`. `<base_ref>` is the WK's authenticated captured base branch from the
launcher identity store; the branch name is never defaulted, so a repository
without `main`, a divergent `main`, or a different checkout branch cannot change
it. A WK without that captured identity refuses target construction with
`agent_launch.slice_integration.binding_mismatch.v1`; an already-advanced WK ref
keeps its integrated fact with `blocked` record reconciliation and is never
reintegrated. The selected branch's current tip is read only to derive that diff
base; the WK's frozen fork `base_sha` and the terminal candidate's immutable base
are unaffected.

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

All three explicit-base `merge-tree` consumers — committed-slice admission,
remaining-delta detection, and immutable delivery replay — share one result
interpreter. Exit status 1 without a process fault is a content conflict. A
positively identified rejection of the required `--merge-base` option is instead
a typed serving-runtime prerequisite failure; other nonzero, signalled, or faulted
results remain execution failures rather than conflicts. The diagnostic
evidence retains bounded operation/argument, repository, base/current/incoming
object, status, signal, process-error, stdout, and stderr facts. The public
refusal detail publishes those facts and the cause chain except the process
output: `stdout` and `stderr` stay in the operator-retained original named by
`retained_evidence`
([Dispatch-family failure detail](mcp-operation-reference.md#dispatch-family-failure-detail)).
Bounded text is
an exact prefix of what Git emitted, cut on a character boundary. The trusted Git
runners keep the first 2,048 UTF-16 code units of stderr and report
`stderr_truncated` and the emitted `stderr_bytes`; the diagnostic's own
8,192-byte bound applies on top. `stderr_truncated` is true when either bound cut
the text, and `stderr_bytes` is the number of bytes Git emitted. A timed-out
process keeps the stderr received before it was stopped, under the same bound.
When the output exceeded the runner's buffer, the capture is discarded: the
result reports `overflow`, an empty stderr, `stderr_truncated: true`, and
`stderr_bytes: null`, because the emitted size is unknown. Executable path
and Git version are reported as unavailable when the runner did not observe them.
There is no alternate merge algorithm or older-Git fallback: the serving runtime
must provide Git with the required explicit-base merge-tree capability, and this
repository change does not upgrade a consuming installation. A managed run
refused for this prerequisite reports it as an advisory `required_correction` on
its status response (see
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md)).

The repository's installed-runtime witness boots an installed `wiki-mcp`
entrypoint and, inside that serving process, runs the installed launcher Git
runners with this shared argument builder, interpreter and capability probe
against fixture-owned commits. It records the installed package versions and
content digests, the entrypoint, working directory, the Git executable the serving
process selects from its own `PATH` and its version, the complete argv, the runner
outcome and bounded output. By default it checks an isolated local-tarball
installation; `INSTALLED_GIT_WITNESS_TARGET` (install root) and
`INSTALLED_GIT_WITNESS_TARGET_NODE` select an existing installation instead,
without reinstalling it, when the test runs inside that installation's serving
runtime:

```bash
INSTALLED_GIT_WITNESS_TARGET=/opt/agent-chassis/install \
INSTALLED_GIT_WITNESS_TARGET_NODE=/opt/agent-chassis/node/bin/node \
node tests/run-tests.mjs integration tests/integration/managed-observation-installed-git.test.mjs
```

A pass establishes installed boot and runner capability for the checked
installation and environment only. It does not certify another deployment,
package digest or runtime image, and it is not live-worker end-to-end execution.
An unavailable target, no selectable Git, a timeout, spawn failure or
indeterminate probe is reported unavailable, never capable.

The coherent observation journey
(`tests/integration/managed-observation-source-installed-journey.test.mjs`)
runs the same ordered public MCP calls against this checkout's packages and
against one isolated local-tarball installation. The full registered server
dispatches one deterministic confined worker that commits one fixture delivery.
A test-owned wrapper ahead of the serving process's own Git then rejects
`--merge-base`. The journey observes the actionable prerequisite, unchanged
observations and detail reads that repeat no effect, one integration of the same
delivery after the stimulus is corrected, and a fresh server that recognizes
completion and still returns the original failure. Branches cover oversized
multibyte diagnostics read through content references, a restart while blocked,
and an integration whose canonical-record write fails. The wrapper delegates to
the Git that the installed-runtime check observed inside a serving process of the
same package set. The worker's model output, the Git stimulus and the record
fault are test machinery, so a pass is not live-model or deployment evidence.

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

### One fixed-fork post-fork observation serves every live consumer

`boundedWkLifecycleObservation` is the authorization core's only post-fork
history owner. It constructs one immutable authenticated region for one exact
operation phase. `classifySliceMarkerEvidenceFromRegion` projects all requested
slice-marker states from that region in one pass, and
`enumerateZeroDeltaCandidatesFromRegion` projects the relevant zero-delta
candidates before `classifyExactZeroDeltaEvidence` authenticates each candidate's
exact delivery, base, parent, tree, and message tuple. Worker deliveries,
zero-delta evidence, contract-persistence commits, canonical-record snapshots,
ordinary replay commits, and any other well-formed post-fork commits are region
members; absence of a slice marker is never itself a refusal.

The boundary is the launcher-owned immutable WK fork ref
`refs/agent-launch/wk-forks/<initiative>/<WK>` (decision). Its name is derived
only from the already-validated initiative and WK identity, and its target is
observed as one exact direct commit — never peeled, never symbolic. Current
`main`, the current slice attempt's base, a merge-base, caller input, prompt
text, environment, record prose or status, boundary authorization, and reviewer
output are **not** boundary authority and cannot supply or override the floor.

The observation binds canonical repository identity, initiative and WK identity,
the exact WK tip, the exact immutable fork commit, the launcher-selected complete
canonical contract generation, and the canonical record source digest. The
complete generation is authority-bearing contract identity: its selected carrier
manifest and complete carrier population are authenticated together. The record
digest identifies only the coordination snapshot and cannot replace, derive, or
mask the contract generation.

The single walk reads exact full-OID objects with replacement objects disabled,
parses raw commit bytes, detects cycles, enforces `MAX_LITERAL_COMMITS`, and stops
at the fork. Every traversed parent path must terminate at that exact floor. A
missing, moved, symbolic, malformed, indirect, or non-commit floor; an escaping
or floor-unreachable path; a missing or malformed object; a cycle; or bound
exhaustion mechanically refuses the observation. Pre-fork commits remain outside
the WK lifecycle even when they contain canonical-looking slice markers.

**Supported automated WK integration requires this ref.** A legacy WK that
carries no fork ref is not integrated automatically: it is an operator-handled
unit, and an authenticated historical fork may be registered manually outside the
integration path. There is deliberately no inferred fallback — not full-root
traversal, not current `main`, not a merge-base, WK tip, reflog, or record prose.

No observation crosses an operation-phase boundary. `advanceSliceRefCas` builds
one for each delivery attempt; a concurrency loser builds a distinct fresh
observation before accepting a winner. Recovery and later fresh integration use
separate observations. Every record-CAS retry, new integration transaction,
WK-ref movement, fixed-fork identity change, complete-generation change, or
record-digest change discards every cached commit, marker conclusion, and
zero-delta projection and starts again. Each same-WK dependency observation in
provisioning constructs its own observation for the resolver's one captured tip.

The live consumer dispositions remain specific:

- `advanceSliceRefCas` maps an indeterminate observation or marker projection to
  `ZERO_DELTA_EVIDENCE_INDETERMINATE`; its concurrency-loser check accepts only
  one exact match from a fresh observation.
- `recoverZeroDeltaIntegratedSlice` maps indeterminate initial or record-CAS
  reauthentication to its existing `ZERO_DELTA_EVIDENCE_INDETERMINATE` refusal.
- Final-sibling completeness consumes the phase observation once for all done
  siblings; an indeterminate completeness projection remains incomplete/`false`
  and cannot authorize the terminal transition. Failure to construct the
  operation's observation remains a typed mechanical refusal before a write.
- `reconcileIntegratedSliceRecord` (the first step of every integrated-delivery
  observation, and so of every managed monitor observation and post-worker
  lifecycle attempt) reads the WK-tip slice marker from the region, projected to
  exactly one candidate. When replay gave the integrated marker a different SHA,
  the retained slice tip is authenticated from its own post-fork region, which
  ends at the same fork; the tip must be one of that region's canonical markers.
  Neither read walks to the repository root. The region owner's refusals cross
  unchanged: a failed fork-ref read stays `GIT_FAILED` with its Git status and
  stderr, and a missing or malformed fork binding stays `BINDING_MISMATCH`.
  Neither is reported as "not integrated".
- The same-WK dependency observation in backend provisioning
  ([captured-tip dependency observation](#captured-tip-dependency-observation))
  performs no history walk or marker classification of its own. An
  indeterminate observation or projection is the distinct
  `dependency_observation_indeterminate` refusal, never an unmet dependency.

These are decision mechanical outcomes, not policy judgments. Missing or stale
obligation coverage, proof carriers, or other non-authorizing evidence can inform
a configured CCE but does not create a local refusal. Malformed or contradictory
identity, corrupt history, containment failure, or a runtime prerequisite needed
to perform the observation refuses mechanically; no consumer falls back to
current `main`, merge-base, arbitrary reachability, record prose, or review
output.

Successful cost is `O(post-fork commits + relevant candidates)`, independent of
pre-fork age and completed-sibling count. The executable scale fixture has 500
pre-fork commits and five post-fork commits; the successful observation reads
only those five commits plus the exact floor and reads none of the preceding 499.

### Captured-tip dependency observation

Given a launcher-captured WK tip, `observeIntegratedSliceDelivery` answers the
dependency question for one same-WK implementation slice: is the exact retained
delivery on that slice's ref integrated into THAT tip? It is maybe-asynchronous
over the injected Git runner, so a synchronous runner keeps a synchronous
resolver and an asynchronous one is awaited inside the resolver's own loop. It
returns one of three facts and decides no ordering policy:

- `present` — authenticated inclusion, with `delivery_kind` (`direct`, `replay`
  or `zero_delta`), `inclusion` and the record's bookkeeping reported beside it
  as `record_reconciliation`: `reconciled`, `pending`
  (`canonical_record_not_reconciled`) or `blocked` (a cancelled slice, or a
  terminal parent over a non-done slice). Bookkeeping never changes the fact and
  nothing is backfilled.
- `absent` — a completed permitted observation proves the exact delivery is not
  in the captured tip's fixed-fork region.
- `indeterminate` — a named required fact was unavailable, malformed,
  mismatched or moved, with the distilled read cause (operation, object or ref,
  exit status, signal, spawn error, timeout and overflow flags, at most the
  first stderr line).

**Selection.** A present `integrated_delivery_sha` is an exact candidate
selector, never authority. It must authenticate against the retained delivery
through `authenticateIntegratedDeliveryCandidate`: the retained delivery is one
canonical launcher delivery (one literal parent, exact minted message bytes),
and the candidate is that delivery (`direct`), a single-parent commit with the
same message bytes and an equal normalized parent-relative structural delta
(`replay`; whole trees are never compared), or authenticated zero-delta evidence
bound to that delivery and base (`zero_delta`). A required read the
authentication cannot complete — including the zero-delta evidence's WK parent
or its explicit-base merge-tree run — is `zero_delta_evidence_unreadable` (or
the corresponding unreadable reason) with its distilled cause, never a
mismatch; only a completed read that disagrees is a mismatch. A malformed
selector, or one that does not authenticate, is indeterminate and never falls
back to marker discovery. A canonical record that cannot be reread during the
final identity recheck is `canonical_record_unreadable` with its cause, distinct
from a reread record whose digest changed (`canonical_record_changed`). The authenticated selector's inclusion is then answered by the
targeted literal walk over the same post-fork traversal: equality reads no
history, a direct parent reads only the tip, and a deeper inclusion stops at the
first commit that names the selector as a parent. Only a completed walk of the
permitted region answers `absent`. The targeted walk proves inclusion of one
recorded delivery; it enumerates no marker, claims no uniqueness, and is never
reused as a complete-region observation.

With no selector — a reconciled record the already-consistent write left without
one, or an interrupted write — the complete fixed-fork observation and
`classifySliceMarkerEvidenceFromRegion` select: exactly one marker that
authenticates as this delivery is `present`, none is `absent`, and more than one
is `indeterminate` (`integrated_delivery_marker_ambiguous`). Complete-region
clients keep their complete traversal and plural-marker semantics.

**Pinned identities.** Repository, captured WK tip and ref, retained delivery
ref, canonical record source digest, fixed fork and complete contract generation
are pinned before selection and rechecked through their existing owners before
the answer is returned; any movement or read failure is `indeterminate`
(`captured_wk_tip_moved`, `retained_delivery_ref_moved`,
`canonical_record_changed`, `fixed_fork_moved`, `contract_generation_changed`,
`pinned_ref_unobservable`, and so on).

The dependency resolver consumes `present` as met, `absent` as
`dependency_not_present_on_wk_branch` with evidence `integrated_delivery_absent`,
and `indeterminate` as `dependency_observation_indeterminate`, which maps to the
`launcher_transition.dependency_observation_indeterminate.v1` transition failure:
restore the named read, then retry the identical dispatch. No worker starts while
required authentication is indeterminate, and a restored read needs no
reintegration or record edit.

**Terminal delivery authentication** delegates the same common checks — literal
commit parsing and message bytes, parent-relative structural-delta equivalence,
zero-delta authenticity — to `authenticateIntegratedDeliveryCandidate`, and
literal inclusion in the exact current WK tip to the same targeted walk bounded
by the literal roots. Replacement refs and grafts cannot fabricate that
inclusion. Terminal keeps its own absent/null-to-exact record transition,
subject, ref and record rechecks and branded proof minting.

### Zero-delta lifecycle recovery

Durable evidence recovery runs before fresh committed-delivery admission and
before consulting process-local completed-integration maps. The state
classification is closed:

- Multiple complete evidence matches always refuse without record or ref mutation.
- Zero matches do not activate review or authorize integration. Under the
  [normative lifecycle boundary](mcp-dispatch-managed-run-lifecycle.md#cce-policy-and-local-mechanical-recovery-boundary),
  the integration primitive proceeds only when the authenticated record and
  refs satisfy its mechanical contract; otherwise it reports the exact
  mechanical refusal and supported recovery. A done or cancelled slice, or a
  parent in `review` or `done` with no matching evidence, is the mechanical
  contradiction `status_without_evidence`; other inadmissible combinations are
  likewise integration-mechanism refusals rather than local policy gates.
- One current-tip match performs one expected-digest canonical-record CAS only
  when the launcher-authenticated record and refs satisfy the mechanical
  transition contract. With incomplete sibling implementations it marks only
  the slice done and returns non-final with no review target. With none
  remaining the same record image marks the slice done and parent `review`,
  returning final with the exact frozen whole-WK target.
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

### Authenticated integration and record reconciliation

Git integration of an exact delivery and reconciliation of its canonical record
are separate facts. Once the existing owners authenticate that this exact
delivery is integrated, that is an occurred fact; a stale, contradictory or
unwritable record cannot turn it back into "not integrated" or authorize another
integration attempt.

`observeIntegratedSliceDelivery` is the one read-only observation. It reuses the
zero-delta evidence classifier and the ordinary exact-delivery marker classifier
(`resolveExactDeliveryMarkerFromObservation`, shared with `advanceSliceRefCas`),
and returns one of:

- `null` — no authenticated integration of the delivery on the slice ref. A
  same-subject marker for a different (for example corrective) delivery, or a
  record status claiming completion without evidence, is not an integration.
- `integrated: true` with `record_reconciliation.state` `pending` or `blocked` —
  the exact Git integration with its delivery, marker or evidence, base and WK
  tip. `integrated_state`, `review_target` and `transition` are `null`: finality
  and a review target are never guessed from an unreconciled record. `blocked`
  names a current record constraint (a cancelled or reopened slice, a terminal
  parent over a non-done slice, or historical evidence or a historical marker
  that would own a final parent transition) with its refusal evidence.
- `integrated: true` with `record_reconciliation.state` `reconciled` — the
  pre-existing recovered result, including the closed `final`/`non_final`
  discriminator and review-target ownership.

An authenticity, identity or integrity failure (indeterminate or ambiguous
evidence, a retained tip that is not the exact marker) still refuses; it is
neither absence nor a fabricated integration. `reconcileIntegratedSliceRecord`
keeps answering only the reconciled case.

`record_reconciliation` is an observation, never a request option, receipt or
authority flag. No store, journal event or receipt records it.

The writable owner, `requestCommittedSliceIntegration`, classifies
already-integrated work before fresh committed-range admission, through
`reconcileIntegratedSliceRecordOnly`. Only pending or blocked bookkeeping is
answered there; a delivery whose record is already reconciled continues to fresh
admission, whose existing answer for already-applied work is unchanged, and no
write is made. That observation and repair run inside the WK's existing
cross-process authority exclusion (`withControlledContractAuthorityExclusion`,
the lock `integrateCommittedSlice` and carrier publication already take), entered
before anything is observed; the selected unit is resolved again once it is held,
and it is released before any fresh integration acquires the same non-reentrant
lock. An exclusion that cannot be acquired is not "no integrated delivery": the
request returns the owner's exact cause
(`controlled_contract_wk_authority_lock_timeout` or
`controlled_contract_wk_authority_lock_unavailable`) as a `backend_unavailable`
refusal that states prior integration was not observed, with no record or ref
change and no fresh admission. A release that fails after the observation or
repair completed (`controlled_contract_wk_authority_lock_ownership_changed`) is
thrown as the owner's own error with the completed result in its detail: a
written repair or a null observation stays the fact it is, and the request does
not continue to fresh admission. A pending record is repaired through the existing compound CAS writer
(`driveRecordCasWrite`) and the existing validated record writer: every attempt
rereads the record and live WK tip, re-authenticates the exact evidence or
marker, recomputes sibling completeness and keeps slice `done` plus a final
parent `review` in one `expectedSourceDigest` write that preserves unrelated
record edits. The branch has no path to `advanceSliceRefCas`, object replay,
evidence minting, ref movement or fresh-integration reaping. Its authorization is
that of this mutation boundary: a retained exact admitted target is re-authorized
through the configured policy and current-binding checks; configured CCE without
such a target refuses the metadata write; the free substrate has no policy gate.
Any unconfirmed or refused write returns the integrated fact with the
outstanding substate and the original exception as evidence. After a confirmed
write the delivery is observed again, and only that reconciled answer carries
finality or a review target.

When the first integration's ref CAS succeeds and its record write then fails,
`integrateCommittedSlice` returns `integrated: true` with a `pending` (or, for a
refusal or incompatible movement, `blocked`) substate and the original exception,
instead of discarding the Git result as a refusal. Such a result is not retained
as a completed integration, so a later request reaches the record-only branch.

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

A managed exact-slice implementation worker implements and validates on the
launcher-created branch, leaving assigned changes uncommitted.
`workspace_deliver_work({})` commits and delivers those changes and fulfills the
assignment's commit requirement. Do not create another branch or make a separate
Git commit before delivery; moving the assigned branch can cause delivery to
refuse. The request is empty and integrates nothing.

For delivery, every supported family prompt states this completion sequence once,
in this order: successfully invoke `workspace_deliver_work({})`, then emit the
`agent-role-result.v1` structured evidence, then terminate. The shared
family-neutral terminal-result renderer is the single source of that ordered
protocol. Family role contracts carry no parallel completion instruction of their
own; in particular they no longer carry an independent commit-and-terminate
sentence, and they do not claim that confirmed termination itself causes
integration, whole-WK freezing, or review. Confirmed termination captures the delivered result but requests no integration.
Only the coordinator's explicit `integrate_work({delivery})` invokes integration
for the exact authenticated delivery, with the mechanical, configured-CCE and
CAS behavior defined on this page. Review is not a local runtime prerequisite: it remains available and advisory only as an
explicit dispatch; see
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md#post-worker-delivery-without-built-in-review).

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
  stays unpublished and does not enter integration.
- A successful `workspace_deliver_work({})` with identical parent and child trees
  is a valid no-change delivery; it does not authorize a separate Git commit first.
- Repeated equivalent commit calls converge on the existing trusted-tool
  idempotency; the prompt adds no retry protocol of its own.

An identified assignment gap instead uses
[`request_assignment_change`](mcp-operation-reference.md#worker-assignment-change-requests).
Acceptance immediately terminates the worker with completed and remaining work
as the handoff, preserving partial work without a final report. Refused requests
leave ordinary recovery available. These instructions govern managed workers;
direct implementation workers retain their repository Git commit procedure.

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

## Exact commit transaction and immutable integration

Delivery materializes the complete content-inert delta and measures its full
scope before deciding whether to publish it. Only authenticated inactive
confinement waives a pure mutation-scope mismatch. The complete changed and
outside-scope paths remain measured and `contained:false` remains truthful.
Successful delivery reports its actual delivered disposition and completion
action, without a containment-repair action. The `wiki/contracts` exclusion,
forbidden sidecar paths (including generated output), symlink/type swaps and
mixed failures still refuse. Decisions, work records and `AGENTS.md` receive no
additional delivery restriction. Exact assignment/run/repository/ref checks,
CAS, compensation and lifecycle transitions remain in force. This exception
changes no worker edit/read grant, integration or publication authority.

The exact-slice commit transaction has two ordered resources: publish the
launcher-bound slice ref with exact compare-and-swap, then persist the canonical
implementation-to-review transition. The response reports committed/submitted
success only when both are proven. If canonical persistence fails after this
invocation advanced the ref, the server compensates that exact publication with
`update-ref <slice-ref> <authenticated-prior-tip> <published-commit>`. Failed
compensation is a typed partial transaction. An idempotently pre-existing delivery
was not published by the invocation and is never compensated.

Delivery publishes one ref: the assigned exact slice ref,
`refs/heads/slice/<initiative>/<wk>/<slice>`. Before any Git work, the launcher
binding must prove that its output branch is that slice's branch and that its
selected unit is the assigned slice; a binding whose output branch names the WK
branch, a sibling slice, or anything else, or whose selected unit is not that
slice, is refused before materialization, scope measurement, publication, or any
status write. Delivery has no WK-ref publication path: it never advances the WK
ref or the base branch, and it changes no lifecycle status other than the
assigned slice's move to `review`. Advancing the WK ref is integration's
authority alone.

The delivery request supplies no caller fields: `{}` and an omitted MCP
`arguments` member both mean `{}`. One strict empty-object field schema owns
what `tools/list` advertises — an object with no properties and
`additionalProperties: false` — and authoritative field validation. The
authoritative schema derives a Zod `.default({})` from that same object, so only
true `undefined` becomes `{}`. The existing registrar forwards the parsed object
to the handler. Identity, scope, refs, and the commit message are launcher-owned
and are never request fields. Omission grants no authority: the same launcher
authentication, binding and scope checks apply.

A request the schema refuses reaches no delivery handler and has no effect: no
binding is resolved, nothing is materialized or published, and the unit's status
is not written. Where the refusal is raised depends on the request shape:

| Request `arguments` | Refused by | Result |
| --- | --- | --- |
| A record with any field — unknown, identity-bearing, or message-shaped | Tool registrar | `tool_input_validation_failed` with the validator's own diagnostics naming every rejected key, and `next_calls` |
| `null`, an array, or a scalar | MCP protocol envelope, before the registrar | A native protocol error; it carries no `next_calls` |

Whether the serving SDK forwards omission or supplies `{}`, the public boundary
admits the same normalized empty object. Explicit `null`, arrays, scalars and
nonempty objects remain invalid; no unknown field is stripped.

`next_calls` is the one complete corrective call,
`{tool, arguments: {}, recommended: true}`, naming the registered delivery tool.
It carries nothing the caller supplied; no field is silently stripped to make a
refused request pass. Submitting it on the same launcher-authenticated session
delivers.

The handler's internal guard requires the normalized object: only `{}` is
admitted, before the launcher binding is resolved. A direct invocation that
bypasses the registrar with an absent argument, `null`, an array, or a scalar is
a closed-schema violation, and a message-shaped or binding-shaped field keeps
its own diagnostic.

Once materialization has been attempted, every outcome — success, refusal, or
thrown failure — carries the same transaction facts. Four effects are reported
independently, and none is inferred from another:

| Field | Values | Meaning |
| --- | --- | --- |
| `commit_object` | `created`, `not_created`, `unknown` | Whether the candidate commit object exists. `not_created` is a refusal before materialization; `unknown` is a materialization that threw. |
| `delivery_ref` | `unchanged`, `advanced`, `restored`, `unknown` | What this invocation did to the exact delivery ref. |
| `submitted_for_review` | `true`, `false`, `null` | Whether the assigned unit reached `review`. `null` is not established either way. |
| `checkout` | `complete`, `pending`, `superseded`, `not_attempted` | The worker checkout's own finalization, attempted only after publication and review submission succeeded. See [Worker checkout finalization](#worker-checkout-finalization). |

`committed` keeps one meaning: delivery publication and the exact unit's review
submission are both established. A successful submission and a valid
already-`review` no-op are both committed; a partial or uncertain settlement
never is. Checkout finalization never changes `committed`: a delivery whose
checkout is `pending` or `superseded` is committed and submitted, and the
response's `outcome` is `partial` rather than `delivered`.

`transaction` retains the identities that are known: `ref`, `base_sha`,
`delivered_tree`, `candidate_commit`, `delivery_commit`, `prior_tip`,
`attempted_commit`, `published_commit`, and `observed_tip`. `candidate_commit` is
the object this invocation materialized; `delivery_commit` is the delivery the ref
owner selected. An equivalent replay returns the existing selected delivery while
`candidate_commit` still names the candidate that was only compared against it.

`transaction.canonical_review` keeps the status writer's raw `valid`, `written`,
`no_op`, and `status` as returned, with `null` for a fact it did not state. Only a
result naming the exact assigned unit can speak for that unit:

- an explicit no-write result, or a written result whose status is not `review`,
  reports `submitted_for_review: false`;
- a canonical write whose publication is unknown, a thrown transition, a
  malformed result, and a wrong-unit result report `null`.

A restored ref does not resolve that uncertainty: `delivery_ref: restored` and
`submitted_for_review: null` are reported together.

A publication that throws is classified from the stage evidence the ref owner
attached to its failure, never from the error code alone:

| Evidence | `delivery_ref` |
| --- | --- |
| Conflict naming this ref and base and a different observed tip | `unchanged`, with that `observed_tip` |
| Read failure naming this ref and base, raised before the compare-and-swap | `unchanged` |
| Read failure after the compare-and-swap was attempted | `unknown` |
| Any other exception, or a code without that evidence | `unknown` |

A failed or indeterminate publication invokes neither the canonical transition
nor compensation. A failure thrown while materializing, verifying scope, or
publishing names its `stage` (`materialization`, `scope_verification`,
`publication`) beside the same facts.

Compensation runs only for a publication this invocation performed. When it
fails, the observed concurrent tip is kept and `delivery_ref` is `unknown` unless
the published commit was observed still in place.

The thrown transition, compensation, and stage failures are each serialized whole,
nested causes included, as that block's `cause`, with
`diagnostic_serialization.state: "complete"`. A value that cannot be serialized
losslessly reports `state: "failed"` with the serializer's own failure, and leaves
every sibling cause and every identity above intact.

After integration, the integrated ref/status result is immutable. Cleanup is a
separate post-success disposition: `state: "failed"` becomes a finalized delivery
with cleanup pending, not a failed or replayable integration. Recovery
authenticates the retained marker, exact refs and commits, current WK tip, and
canonical record, then performs only cleanup confirmation or continuation. Review
findings, historical status, and generic operator settings grant no recovery or
integration authority.

The live backend retains one additional index entry for each successful
authenticated integration, keyed by repository, unit, exact delivery and base.
This lets the original worker monitor recognize a completion even when an
earlier pre-integration failure occurred before its frozen review context was
retained. Observation must still authenticate the launcher-minted run, monitor,
retry and binding pair, the delivery chain and live slice/WK refs, and the
integration's original boundary-authorization target. A refused or in-flight
attempt creates no entry. The index is process-local and non-authoritative after
restart: absence continues through the durable recovery path, including its
unchanged canonical-generation checks and `controlled_contract_generation_missing`
refusal.

The base in that key, and the `delivery_base_sha` durable recovery reports, is
the delivery's original base: the `base_sha` frozen in the authenticated slice
binding, never the delivery tip's immediate parent, which for a multi-commit
delivery is an earlier delivery commit. Both the live lookup and durable
recovery authenticate the complete server-minted chain from that base to the
delivery with the same validator pre-integration admission uses. An empty,
non-linear, wrong-subject, malformed or unreadable chain refuses as
`reviewed_delivery_base_mismatch` with the validator's cause; it is never
absence, a recovered completion, or grounds for a fresh integration.

Git is authoritative about an integration that already happened. Neither the
index key nor durable recovery depends on the slice's current canonical
`write_scope`, so a scope revision made before or after the integration cannot
hide an authenticated completion, turn it into absence, or make another
integration attempt eligible. Both the live and the restarted monitor recognize
the completion before considering whether another attempt is warranted, and
consuming it performs no integration request, ref movement, worker launch or
proof execution. A WK or slice status, matching scope, bare ancestry, or a
caller-supplied SHA is not integration evidence.

Recognizing a completion grants nothing new. The worker's original write scope
still bounds its commits, pre-integration admission and configured CCE still
decide every integration attempt, and later candidate, review, forge and
new-worker actions keep their own current-contract checks. A refusal by one of
those later actions is published as that action's failure and leaves the
delivery reported as integrated. Integration of one delivery is not completion of
the WK: cleanup and coordination that remain pending are reported as pending.

### Delivery originals

Every invocation that reaches an admitted exact-slice binding retains one
complete original of what happened, after its transaction outcome is fixed and
before that outcome is returned: success and equivalent replay, a write-scope
refusal, an unproven or thrown review transition, a returned or thrown
compensation, and a failure thrown while materializing, verifying scope, or
publishing. A request refused before admission — a missing assignment or
launcher tuple, a binding that fails its proof, or a malformed request — retains
nothing and reports no original. A replay is its own invocation with its own
original; it never rewrites an earlier one.

The original holds what each owner actually returned or threw, before the bounded
response keeps only part of it:

| Member | Content |
| --- | --- |
| `identity` | The server-resolved repository and unit, the `launch_ref`/`run_id`/`retry_id` tuple, and the identity-store binding exactly as stored |
| `materialization`, `scope_verification`, `publication`, `canonical_review`, `compensation`, `checkout` | `{state: "returned", result}` with the owner's whole return value (and, for the review transition, its `validation`), `{state: "threw", cause}` with the thrown value whole, or `{state: "not_attempted"}` |
| `outcome` | The response as emitted, and whether it was an error result |

A phase that did not run is `not_attempted`, which is distinct from an owner
result that is `null` or unknown. Unfamiliar owner fields are kept. A generation
identity appears only if an owner supplied one; none is derived from a digest.
The response's `committed`, `commit_object`, `delivery_ref`,
`submitted_for_review` and `checkout` are the single transaction projection and are recorded as
part of `outcome`; the original adds observations, not a second interpretation.

Every admitted outcome reports retention separately from its transaction effects:

- `original: {available: true, operator_only: true, locator: {ref_id}}`
  when the original was kept. The locator is output metadata only. It names no
  reader call and no usable file path, and it opens no public read.
- When the original cannot be kept — it holds a value the lossless serializer
  refuses, or the response state cannot be written — the call returns an error
  result that says so and still states the settled transaction:
  `output: {state: "failed", failed_output: "complete_original", stage, unit,
  response_state_owner, recoverable: false}`, where `stage` is
  `original_serialization` or `original_retention`, and
  `original: {available: false, locator: null, operator_only: true,
  retention_failure}` carrying the failed operation, the affected unit, and the
  owner's own cause.

A retention failure changes nothing else. The delivery is not compensated,
recommitted, resubmitted, or retried, the retention is not retried, and a
transaction failure the invocation already had is reported as it was. The lost
original is not recoverable and is never described as such. This failure response
stays within the response bound: if the complete outcome and cause do not fit,
the settled effects and identities are kept and every fact left out is named in
`omitted_facts`; if the retention cause alone does not fit, it is replaced by
`cause_omitted: true`. No unbounded original or log is returned in its place.

Retention and reading go through one private adapter, `createDeliveryOriginals`
in `packages/wiki-mcp/src/lib/task-deliver-work-result.mjs`. It registers no tool
and adds no request parameter; `workspace_deliver_work` appears only as the
producer identity recorded with the retained bytes. It is constructed from
trusted server configuration — the configured workspace, the identity-store
binding, the launcher credential and assigned unit, and the response-state
environment, which for the registered handler is the server's own. The binding
must pass the same exact-slice proof delivery uses, or construction refuses. The
validated configuration is copied and frozen. This establishes that the trusted
configuration is consistent; it does not authenticate a credential a caller
supplies.

- `retain({original})` alone validates and normalizes the complete original
  through the lossless diagnostic serializer, once, then passes that carrier to
  the existing selected-response writer and returns the `{ref_id}`
  locator. The handler performs no preliminary complete-original normalization.
  A value that cannot be kept exactly fails there, by path, before retention.
  Nothing is dropped.
- `read({result})` takes that locator and returns the complete original.

The private adapter's `retentionFailureStage()` accessor reports the observed
phase of its last synchronous failed retain, cleared on each attempt. The phase
changes from `original_serialization` to `original_retention` only after
normalization succeeds and before the selected-response writer is called. The
adapter rethrows the owner's exact error without wrapping or annotating it; the
handler uses the accessor for stage reporting. Failure while constructing the
original before that call remains `original_serialization`. The store's JSON
encoding and the separate small cause projections keep their existing owners.

Retention and verified reading are the selected-response source owner's. Each
original is bound to the producer, repository, and unit, with the exact run tuple
as its query identity and the rest of the verified launcher binding — base,
output branch, worktree, scopes, and the binding's own `source_digest` and
`source_version` — as its authority identity. A read supplies that complete
binding, so a different repository, unit, run, retry, or launcher binding is
refused before any content is returned.

The retained bytes are marked operator-only: holding a locator does not open the
public ranged content reader, which refuses them. Session-authenticated private
producer access is described below; no public or managed-worker reader is
activated. An original outlives the server process that
retained it and is exactly as durable as the response state it lives in. A read
performs no delivery, capture, retention, Git or status mutation, compensation,
integration, or proof execution, and never reconstructs a transaction from
current Git or record state.

## Retained integration originals

The incumbent integration route uses a private, in-process composition that
retains the complete original of a completed integration outcome and reads it
back. This originals owner is not itself a registered tool. It is handed one complete
producer carrier — the request selection, the authenticated source facts it had,
the result, and any supplied policy or disposition facts — and that carrier is
retained unchanged, including members the composition does not know.

The dispatch backend captures into it once per shared integration attempt, when
that attempt settles: its result or thrown failure, with the authenticated
delivery, base and target the attempt ran on. Concurrent requests that joined
the attempt resolve that one original, as does a later request answered from the
settled result. Capture completes before any of them returns: the settled result
is held behind its attempt's capture, so a request served from it never receives
the result without the same original, or the same capture failure, and no read
starts a capture.

A request answered before any shared attempt is captured once as well, before it
returns: an unavailable backend or integration adapter, an invalid or missing
subject, a canonical-resolution or admission refusal, and an already-integrated
or record-only reconciliation answer. The answer and its classification are
retained exactly as their owner returned them, and each explicit request outside
an attempt has its own original. An error thrown on those paths is rethrown as
the same object after its evidence is retained; a completed recovery result it
carries is kept beside that evidence as observed, so a completed null
observation and a completed repair stay distinct and neither is relabelled. The
original records only the source facts that were observed: its `source` is null
when the request ended before an admitted delivery and base existed. A capture
that itself fails is recorded beside the answer or error without changing it,
and starts no further admission, integration, repair or capture. A backend
configured without retention captures nothing.

Every `integrate_work` response carries an `original`
member. When available it holds the retained `locator` (`ref_id`, `sha256`), the
verified JSON `file` whose `carrier` is the complete original, and the
`carrier_member` holding this answer (`result` or `thrown`). The route publishes
the original the backend registered for that exact result or thrown error, after
reading it back through the private composition; it never retains a backend
answer again and never substitutes current state. Otherwise `available` is
false, `locator` and `file` are null, and `unavailable.reason` states the actual
condition beside the unchanged outcome: `backend_capture_not_registered`,
`backend_capture_failed`, `retention_failed`, `retained_original_unreadable`
(missing, changed, foreign, or a session without the grant),
`handler_capture_failed`, `repository_unresolved`, or
`retained_summary_unrecognized` when the backend's capture returned something
other than the private composition's summary. Nothing is retried to repair
publication.

When the result states an integration and the WK commit it produced, and the
retained original names the integrated subject, `next_calls` also carries one
`verify_proof({subject, git_sha})` call. Complete outstanding required
selected-proof verification before treating the work as validated; already
sufficient verification need not be rerun merely because integration occurred.
The response does not look up verification completion or infer it from
integration, checkout cleanliness, review, or a commit SHA. It recommends this
call on a successful integration conditionally on required verification
remaining outstanding. On partial results, including an approval refusal with
confirmed integration effects, the retained read and any correction or recovery
guidance keep priority and verification is not the recommended next action.
The call is pinned to that WK commit
(`delivery.integrated_sha`), never to the worker's delivery commit
(`delivery.commit`) and never to a branch that may move later, and it follows
the retained read and any recovery call. A refused or unconfirmed integration,
or one whose original names no subject, offers none.

A refusal the handler makes before calling the backend — rejected caller
authority, an invalid subject, an unavailable backend — and a handler-origin
exception are retained once by the route, complete, with a null `source`, against
the server's configured default repository and its own session. An unresolved
repository keeps the operation's refusal and discloses no file. Projected detail
writes no second evidence file: withheld fields name the same original and
carrier member. A backend error thrown after a completed recovery publishes that
`completed_recovery_result` beside the failure, read from that same error
whether or not its original is available: the short facts of a completed repair
or observation, or null for a completed observation that found nothing. The
complete frame is measured against the selected-response delivery bound; detail
that does not fit is replaced by an explicit omission naming the same original,
and the codes, known effects and `original` member stay inline.

The serving host passes one trusted fixed repository binding directly to the
runtime and `integrateWorkBackendOptions`; no repository-selection callback
participates in integration or original capture. Construction authenticates the
checkout's canonical path against the provisioning main repository and freezes
the binding. At completion the one installed retention callback canonicalizes
that fixed checkout again against the pinned main path. An unresolvable or
retargeted checkout records its specific capture failure beside the integration's
occurred effects; nothing is retained or implicitly retried. A symlink to the
same canonical checkout preserves identity. Retained repository identities can
only authenticate equality with this binding; they cannot retarget the runtime.

Access follows the session, never the request. The launcher-minted session role
must hold the central grant of `integrate_work`; any other
role is refused before anything is retained or disclosed. Each original is bound
to the integration producer, its subject and the single configured repository,
and a read names only the retained result by `ref_id` and `sha256`. A request
whose subject is absent or is not an exact slice binds a null subject, which the
summary repeats; the original's own request keeps what was asked, unshortened. A source
retained by another producer or for another repository, a changed or missing
artifact, and any further read argument refuse with the owning cause.

Retention and reading answer with one compact summary measured as a complete
frame against the selected-response delivery bound, the retained locator, and
the verified file that holds the retained envelope with the complete original
as its `carrier`. The summary repeats only short facts the original's result
states and names a written record by identity. A summary that would exceed the
bound keeps a minimal form instead: every known effect small enough to state is
still stated, each omitted fact is named, and the original is never shortened.
A refusal with no agent run and a partial outcome are retained like any other
original. When the response store cannot keep the bytes, the answer reports
that cause beside the outcome the original states, with the original marked
unavailable; the known effects are reported even when the summary is minimal,
and integration is not retried to obtain an original.

Reading performs no integration, repair, retention or current-record read, so a
later integration never changes what an earlier original returns. Originals
live in the response spill store and are exactly as durable as it is: marked
operator only for incumbent public readers, and gone when that store is removed.
The registered `get_run_result` facade delegates a verified integration
selection to this same originals owner for an entitled orchestrator. It delivers
a bounded summary and complete permitted semantic members through the shared
selected-response class.

## Worker delivery preparation

`packages/wiki-mcp/src/lib/task-deliver-work.mjs` exports
`createDeliverWorkSurface({ workspace, sessionEnv, responseEnv, z,
executionFactory, writeStatus })`. `workspace` is the trusted `{repo, dir}`;
`sessionEnv` carries the launcher-authenticated worker contract and independently
resolved unit/run/retry tuple. `responseEnv` supplies the incumbent response
state. Defaults use the real transaction, status writer and Zod. Dependency
configuration is host-owned. The returned `{inputContract, prepare}` accepts an
omitted request or `{}` identically; every other argument shape or member refuses
before effects. The schema and execution factory are supplied by the existing private
`createWorkspaceCommitExecution` owner; the old commit tool is not registered.

The production registrar constructs this importable composition and registers
`workspace_deliver_work` for workers only. `prepare(request)` runs delivery
once through the existing binding, materialization, containment, publication,
review-status and compensation owners, then returns
`{registered:false, body, isError, continuations, delivery}`. `isError` preserves
the execution owner's error channel separately from transaction outcome: returned
transaction refusals retain their JSON channel, while thrown/input/authentication
and retained-original failures use the error channel. `delivery.delivered` is
false because preparation itself supplies no transport. `delivery.measured_bytes`
measures the complete frame, with that error flag, against the shared 8 KiB
selected-response bound. Configuration below the incumbent inline minimum still
selects 8 KiB. The prepared summary never spills.

The pure `prepareDeliverWorkResponse` export in
`task-deliver-work-response.mjs` consumes observed facts and changes no repository,
status or response state. Its body names producer `workspace_deliver_work`, the
trusted repository, authenticated subject, selected `{commit,base}`, known tree,
measured changed-path count or explicit unmeasured status, and independent
commit-object/ref/submission effects. It preserves uncertainty. A materialized
candidate never substitutes for the ref owner's selected delivery. Known
incomplete effects are partial; a restored ref with proven non-submission is
refused. Tests, proofs, integration, forge publication and parent completion are
false for this invocation. Publishing the delivery ref establishes none of
those effects.

Transaction outcome and output state remain separate. Original serialization or
retention failure after successful delivery keeps the delivered facts, reports
failed output, and offers response-state repair rather than successful completion
or a blind delivery retry. Bounded diagnostics preserve their owners' codes,
authority classification and separate transition/compensation causes. Omitted
collections and large scalar detail are identified explicitly; identifiers are
never shortened into false selectors. Complete admitted originals remain with
the existing lossless retention owner. If the launcher assignment cannot be
authenticated before admission, the bounded refusal identifies the actual failed
condition, its native code and authentication or binding-resolution stage, and
the launcher provisioning / identity-store recovery owner. It starts no delivery
effects, selects no delivery and reports original availability `not_captured`
with a null locator and no original continuation. No separate original is
required or retained for that unauthenticated attempt. A caller-claimed unit
never becomes an authenticated subject. Returned refusals and thrown errors
keep their existing channels; neither supplies successful completion guidance.

Retained-original continuations use the exact `get_run_result` selector
`{result:{ref_id}}`. The common reader authenticates a worker or
orchestrator through the producer entrypoint below, then presents the bounded
summary or a complete permitted semantic member. Input corrections use the
registered delivery request `{}`. No generic byte reader or integration call is
added to delivery. Binding refusals identify launcher provisioning and the
identity-store owner; containment refusals require repair of the assigned scope
relation; uncertain publication, review or compensation requires reconciliation
by the delivery-ref and canonical unit-status owners. Delivery supplies no new
reconciliation capability.

On successful delivery with successful output, guidance reuses the managed
worker protocol owner: delivery is already complete, emit diagnostic
`agent-role-result.v1` evidence, then terminate. Neither evidence nor termination
approves or integrates a delivery. The public composition grant is worker-only;
real launcher session authentication also enforces it before delivery. The
shared reader admits authenticated workers and orchestrators to the retained
delivery original without another transaction, retention store or role bypass.

### Session-authenticated delivery-original access

`task-deliver-work-result.mjs` exports
`readDeliveryOriginalForSession({workspace, sessionEnv, responseEnv, request})`.
`workspace` is the trusted host's configured `{repo, dir}`, `sessionEnv` contains
the launcher-startup session facts, and `responseEnv` selects the existing
response state. The only request is exactly `{result:{ref_id}}`; subject,
role, credentials, source, run, retry, repository and paths are not request
arguments. The result is the complete original carrier as an internal in-process
value. This export is unregistered and defines no public response or unbounded
MCP delivery.

`resolveLauncherRunState` authenticates the presented session against the
launcher-expected contract. The existing managed-test identity helpers require
the authenticated role's identity facts. Only workers and orchestrators are
eligible for delivery originals; reviewer, redteam, operator, absent, malformed
and mismatched session facts refuse. A role name or locator alone grants nothing.
The configured repository remains trusted host context; the fixture's repository
alias is not a new launcher session identifier.

A worker resolves only its session's exact assigned unit and launcher
`launch_ref`/`run_id`/`retry_id` through `resolveWorktreeBinding` under
`workspace.dir`. The existing exact-slice verifier and `createDeliveryOriginals`
adapter compare the entire expected retained binding: producer, configured
repository, unit, launcher tuple and complete immutable authority identity,
including base, source, scope, worktree and output branch. A retained carrier or
caller field never selects the worker's authority.

An orchestrator first authenticates its existing coordination session over the
host-configured repository. A launcher-owned delivery receipt selects the
producer storage before `readSelectedResponseSource` checks the delivery producer
and configured repository and selects the sealed original's unit and producer tuple. That tuple selects its retained identity-store binding;
the same exact verifier and adapter perform the full comparison. It is a
historical selector within the authorized repository population and conveys no
mutation authority. There is no current-unit, latest-result or HEAD lookup.

Reading performs no Git operation, live canonical-unit read, execution,
verification, capture, original serialization, retention, status write, ref movement,
compensation, retry, integration or cleanup. Source movement, unit-file removal,
later retained results and serving-process restart preserve an explicitly
selected original while its identity binding and response artifact remain
retained. No additional lifetime is promised: changing the retained identity
breaks its full match, and removing either owner makes the read unavailable.
Session authentication, identity-store resolution, exact verification and
selected-response missing, corrupt or foreign-artifact errors propagate with
their native causes. Missing bytes are never recreated and refusals disclose no
carrier.

The private source/installed composition tests use different producer and reader
subprocesses, authenticate both permitted roles, preserve genuine scope refusals,
and compare complete large Unicode carriers, including unknown nested causes,
false and null. They independently compare refs, canonical-unit bytes when
present, identity-store bytes and response artifacts across successful and
refused reads. Installed production imports stay within one reused installed
package set and the relevant owner bytes match the tested working source. The
large authored carrier tests establish serializer/read completeness, not a
transaction outcome. Generic spill/ranged access retains `operator_only` denial.

The registered shared result facade delegates an entitled delivery worker or
orchestrator to this producer export rather than duplicating its authority
checks. Other producers keep their own grants. Public selected detail preserves
the shared owner's branded response; missing, corrupt or foreign originals keep
their real owner refusal and are never recaptured by a read.

## Durable delivery receipts and separate response stores

Worker and coordinator response stores remain separate. The production conduit
projects its runtime response directory for an orchestrator; a worker uses its
existing host response-spill configuration. Delivery bytes remain in the
producer's spill. No caller supplies a path, repository identity or storage
selector, and no original is copied into the coordinator store.

After a successful commit and original retention, the delivery producer records
one `delivery_receipt_recorded` informational event through the existing managed
attempt journal owner. Its closed receipt binds the configured repository,
assigned unit, dispatch attempt, independently verified slice producer tuple,
delivered source digest/version, exact delivery commit/base, original reference
and digest, and host-owned response-state directory. The existing binding-pair
relation attaches it to the exact retained dispatch attempt. Publication is
idempotent for identical bytes and refuses rebinding. This event changes no
reservation election, lifecycle transition or integration state.

`get_run_result({subject, attempt_id?})` discovers receipts from the selected
launcher-authenticated attempt. Before returning a delivery reference and its
exact read call, the producer reader authenticates the journal partition,
repository, dispatch/slice binding pair, source, base and full retained binding.
The shared result interface returns bounded delivery summaries and semantic
member reads. The authenticated orchestrator summary supplies the exact
`integrate_work({delivery:{ref_id}})` approval call. Integration uses the
same receipt-selected producer store and existing complete-original reader.
Observation originals remain a different producer and cannot approve delivery.
Receipt lookup and every result read perform no integration, publication,
canonical mutation, launch or linkage repair.

The journal and identity-store owners preserve discovery after worker exit and
coordinator restart. Existing retention governs both bytes and bindings; a
receipt adds no lifetime extension. Missing or corrupt retained artifacts and
changed identity bindings keep their owner causes. Reads neither recreate bytes
nor search an alternative store.

If the commit and review submission succeed but receipt publication fails,
`workspace_deliver_work` states those successful transaction effects beside
`output.state: failed`, the specific publication cause, and an exact empty
request for recovery. A new serving composition inventories only originals
bound to its authenticated producer attempt through the existing retention
owner. The retained successful original is republished through the journal
owner; the commit transaction and canonical transition are bypassed. An already
published receipt is idempotent, including publication that committed before
reporting failure, so a repeated empty request cannot repeat that transaction.
The response labels the effects as historical and states this invocation's
`commit_transaction_executed: false`. Receipt recovery never stands in for an
outstanding checkout: when the retained delivery's `checkout` is not `complete`,
the same empty request also finishes that, as described under
[Worker checkout finalization](#worker-checkout-finalization). Retained
originals that name different deliveries refuse instead of selecting one. This
recovery requires the existing original and identity owners to retain their
data; it grants no recreation or lifetime authority.

## Connected production delivery

The source and installed connected journeys use real production stdio
registration and the production conduit/session response configuration, with
separate worker and orchestrator stores. Fixture setup creates the assigned
unit, worktree, retained attempt and saved review dispositions through existing
owners; it does not model an external model dispatch. The worker delivers and
exits. The coordinator obtains the locator only from public subject observation,
reads it, restarts, reads it again and explicitly approves that exact delivery.
Tests compare Git and canonical snapshots around reads and wrong producer,
repository, attempt, digest, unit, run and source refusals. Neither an observation
alone nor a receipt read has integration effects.

After explicit integration, a separate fixture actor invokes the existing
terminal-candidate owner, records fixture closeout and calls public publication
to a fixture-owned Git destination. The published eligible candidate preserves
the delivered content. Candidate creation and publication are separate actions;
result reads and integration never invoke them. Source and installed journeys
reuse the existing confined lifecycle and installed package fixtures and report
the tested package origin. These observations establish behavior, not clean
release provenance or external model execution.

## Registered explicit integration composition

`createIntegrateWorkTask` in `wiki-mcp/src/lib/task-integrate-work.mjs` composes
the host's `preparedDispatchBackend` for one trusted `{workspace, sessionEnv,
responseEnv}` configuration. The host binds its provisioning main repository to
that workspace and installs the existing saved-disposition reader,
integration-original retention and shared delivery finalization through
`integrateWorkBackendOptions`. Its
`prepare(request)` returns bounded response data; `backend` is the same backend
whose attempts performed the operation. The importable
`registerIntegrateWorkTools({registerTool, ...configuration})` registers this
handler through the supplied SDK registration boundary. The production composer
injects the same prepared backend used by start and result observation. Result
reads and child completion never invoke integration.

The closed request is `{delivery: {ref_id}}`. It selects the automatically
retained delivery producer original. The verified original supplies the unit,
selected commit, original launcher base and exact run/retry binding; these are
not additional caller inputs. The reference identifies one artifact and its
digest authenticates its bytes. No repository, subject, policy, judgment, tuple,
ref or moving-tip argument is accepted. The existing authenticated delivery
reader and central integration entitlement admit the session before selection.
The registered tool requires an authenticated orchestrator.

A saved run-result reference is not a delivery reference. If an entitled
caller submits one as `delivery`, the task preserves the delivery reader's
refusal code and diagnostic cause and explains `run_result_is_not_delivery`.
Only after the existing observation-original owner authenticates repository,
launcher authority and subject does the refusal recommend
`get_run_result({subject,attempt_id})` for that original's exact attempt. That
call returns the attempt's delivery facts; an authenticated empty population
states that nothing is available to integrate. A genuine single delivery still
offers the exact explicit integration call. Foreign, unauthorized, missing or
corrupt originals receive no subject/attempt correction. The refusal's retained
original remains separately readable. Neither the refusal nor its observation
continuation launches, verifies, delivers, integrates, retires an identity,
changes authoring state or modifies earlier originals.

The backend independently checks the selected binding and the literal minted
commit chain, and compares the live delivery ref with the approved commit before
any cache return or recovery. Record repair repeats the fence under the existing
WK exclusion. Fresh admission must agree with the approved original base and
commit; a differing merge base is not substituted silently. Existing primitive
binding checks, ref CAS, compound record CAS and sibling completeness remain the
effect owners. On final integration, the registered composition invokes the shared terminal-candidate preparation owner before delivery finalization. Ordinary recovery prepares the exact integrated slice commit; a later WK tip cannot silently replace that input. Preparation failure preserves confirmed integration and its specific cause, with recovery limited to unfinished effects. Observation reads prepare nothing and launch nothing.

If that preparation owner reports
`terminal_candidate_recovery_expected_version_mismatch`, integration stands and
the selected candidate remains unchanged. The partial response recommends
`workspace_inspect_candidate({subject: <authenticated delivery's parent WK>})`.
Its current-state read supplies any supported exact-version advancement choice;
inspection neither advances the candidate nor finishes integration. Advancing
remains an explicit caller decision under the candidate owner's existing rules.
After resolving the mismatch, the conditional `integrate_work` call retains the
original delivery locator and finishes only outstanding preparation and
finalization. It never substitutes another delivery, advances a candidate
implicitly, or replays completed Git or record effects. The optional historical
integration read preserves this same correction. If candidate inspection is not
served or permitted, the response states that this correction cannot continue
in that session; an unchanged retry is not a fix.

When publication cannot use a selected candidate's checkout, the shared
integration-original owner can associate that candidate with one authenticated
unfinished integration of its implementation. It offers the original delivery
binding plus `candidate_version` in an exact `integrate_work` call. This is
separate from ordinary integration: the receiver authenticates the unfinished
original, immutable version and current selection before entering integration
recovery. The candidate must contain the already-integrated implementation;
unknown ancestry, a moved selection or a missing/altered binding stops the
action. Recovery may restore an explicitly advanced candidate's checkout but
does not construct an absent selection or replace any candidate. Completed
Git effects remain intact. Successful preparation reports its selected version
and suppresses further preparation discovery for that logical delivery. Pending
finalization retains its own continuation as described below; any independently
superseded checkout remains a separate fact. An optional publication call still
requires publication intent and authority.

Preparation completion does not settle independently pending delivery cleanup.
If exact-version recovery completes preparation but leaves checkout, retirement
or slice cleanup pending, its returned call retains both the original delivery
locator and `candidate_version`. After correcting the reported condition, that
same call resumes unfinished finalization through its existing owners. It reuses
the authenticated preparation receipt and acknowledged completed stages; it
does not repeat integration, preparation or completed checkout/retirement/reap
effects. Persistent failure preserves its cause and remaining work. A fully
settled receipt takes precedence over earlier pending receipts, so a settled
replay executes no effects. A superseded WK checkout remains superseded while
independent cleanup can finish; this recovery cannot rewind newer work.

A version fence rejected before recovery starts reports this invocation's
nonexecution separately from `prior_integration`, which preserves the established
delivery, integration point, any known record effect and outstanding cleanup
with its specific cause. A moved selection uses
`integrate_work.candidate_preparation_selection_moved.v1`; the rejected version
is not offered again. The response offers read-only current-candidate inspection
and a conditional, explicitly different choice to publish current work. That
publication choice may issue a new authenticated recovery binding; inspection
does not select it. A completed preparation is distinguished from an unavailable
unfinished-preparation account, without denying the earlier integration.

Version-bound preparation outcomes publish
`observed_facts["integration.preparation_complete"]`: `true` for authoritative
completion of the exact requested version, `false` for authoritative
incompletion, and no fact when unknown or bound to another version. Prior
integration alone does not establish this fact. The publication-issued
continuation evaluates this fact without a compulsory reread. Preparation
completion is independent of delivery cleanup and grants neither publication
authority nor proof credit; pending cleanup adds no publication policy gate.

The public integrated source is the delivery's established integration point,
not a later live WK tip observed during recovery. Dependent verification retains
that same source. Native content-conflict responses preserve the failed
operation, source commit identities and conflicted paths, or explicitly state
that affected paths are unavailable. The Git owner obtains paths through native
NUL-delimited name-only output; the response does not interpret diagnostic prose
or expose process transcripts. An authorized implementation worker must correct
the intended content; a corrected immutable delivery needs a new explicit
integration decision. The refused call neither edits its selected delivery nor
offers an unchanged merge retry.

A failed current fence preserves any previously confirmed cached integration as
a partial result with the refusal cause. Without authenticated historical facts,
a cold fence refusal reports unconfirmed integration rather than invented absence.

A configured `readIntegrationDispositions` constructor dependency reads the
selected unit's saved rows once inside an actual shared attempt. It has the
`readSavedReviewDispositions` signature. Finding and Unicode-scalar prose rows,
exact entry/version/run references, judgments and rationale reach configured
policy intact. They supply advisory context, never integration approval or a
local veto. Configured reads do not fall back to inline annotations. The reader's
`present`, `absent`, `source_mismatch` and `unavailable` states and causes are
retained. The full canonical source digest, distinct from the narrower review
contract projection, binds the read to the primitive's guarded canonical loader
under its existing lock before ref CAS. Confirmed writes advance this attempt's
own expected revision; unexplained changes refuse. Repair reads under the same
exclusion using its current expected source digest. Configured policy without an
existing admitted repair target keeps its missing-target refusal and the already
applied Git fact.

When saved-source movement refuses before effects, the adapter's existing
read-only observer may establish that no integration occurred. A completed null
observation reports `refused` with `effects.integrated: false` only while the
delivery ref still identifies the approved commit. A moved or unavailable
identity, or a failed observation, keeps `unresolved` with a null integration
effect. The original source cause and any confirmed effects remain stated;
this observation starts no retry or repair.

Concurrent calls approving the same exact delivery share repair, execution,
finalization and original capture. Successful completed calls return the same
original without reading newer judgments. A new explicit request after an
incomplete attempt can consume a newer saved revision; it cannot change older
originals. Authenticated cold recovery repairs only missing bookkeeping,
retirement, checkout finalization and slice checkout reaping. Failed acquisition
or release never authorizes fresh fallthrough.
The incumbent finalizer in `dispatch-integration-finalization.mjs` uses an exact
producer-associated binding pair and the existing identity retirement owner;
missing or ambiguous identity leaves cleanup pending beside confirmed integration.
Original reads through the existing shared result facade perform no integration,
repair, capture or retry.

### Owned checkout synchronization

Delivery and integration both publish commits by ref compare-and-swap from an
index that is not the checkout's own, so each leaves one launcher-owned checkout
behind the commit its branch now names. One owner brings such a checkout to that
commit: `synchronizeOwnedWorktreeCheckout` in
`agent-launch-cli/src/lib/owned-worktree-checkout.mjs`. Each lifecycle
authenticates its own trusted binding and supplies the exact checkout, the exact
commit it selected and the one mutation it permits; neither holds
synchronization mechanics of its own, and the slice-review surface uses the same
owner's physical measurement and index mutation under its own validation. The
owner creates no worktree, moves no ref, selects no checkout and publishes
nothing.

| Mutation | Lifecycle | What may change |
| --- | --- | --- |
| `index_only` | worker delivery | The ordinary index, after the physical checkout is proved to be exactly the target tree. No file is written. |
| `index_and_files` | WK integration | Index and files together, by Git's two-tree merge from an authenticated unmodified earlier materialization. |

The owner proves the checkout before it changes anything: the canonical bound
path, membership of the configured repository, a live Git worktree registration,
`HEAD` attached to the bound branch, a full (non-sparse) checkout and the branch
tip. The state it finds is authenticated exactly rather than assumed, because
`HEAD` has already moved. The previous materialization is the nearest
first-parent ancestor of the target whose tree the ordinary index equals entry
for entry; no ancestor is chosen by similarity, and an index that equals no
examined commit is not authenticated.

Unexpected content is reported as
`agent_launch.owned_worktree_checkout.unexpected_local_changes.v1` before
anything is updated: an index that is no authenticated commit's tree (staged
changes), a tracked file that differs, and an untracked file. The owner does not
merge around such a change; the index and every file are left as found, and the
cause states how many paths of each kind were seen. A history that cannot be
read back within the examined bound is `previous_materialization_unauthenticated`
and is likewise refused without a guess. Ignored files are not checkout state:
ordinary ignored content such as installed dependencies is left alone and is not
a violation, but an ignored file standing where an index-and-files update adds a
path is `ignored_file_obstructs` and is never overwritten.

A locked index, an unwritable index, an unwritable directory, a moved or
unregistered worktree, a checkout that left its branch, Git's own refusal of the
update and any other Git failure are distinct codes, and each leaves the checkout
as it was. Identity and target are proved again immediately before the one
mutation. Nothing is reset, cleaned, deleted or forced. Afterwards the owner
proves the branch tip again and that the checkout is a clean exact checkout of
the target tree; `complete` means exactly that. When the branch has already left
the target, a newer commit owns the checkout: it is neither rewound nor
described as holding the earlier commit, and the owner answers
`agent_launch.owned_worktree_checkout.superseded_by_newer_commit.v1`.

The owner takes no authority exclusion; a lifecycle that needs one holds it
around the call.

### Worker checkout finalization

A delivery commits the worker's physical files, so after publication those files
are the delivery while the worker's ordinary index still names the commit the
slice started from. After immutable scope verification, publication of the
selected delivery and a successful review transition, `workspace_deliver_work`
therefore finalizes the worker's own checkout through
`wiki-mcp/src/lib/delivery-checkout-finalization.mjs`. A review failure is
compensated and returned before this step, so finalization never runs for a
delivery that did not stand.

The leaf resolves and verifies the worker's exact launcher binding again and asks
the shared owner for an `index_only` update to `transaction.delivery_commit`, the
delivery the ref owner selected. An equivalent replay therefore finalizes the
existing delivery and never the candidate it only compared. The owner measures
the physical checkout through an isolated index and a private object directory:
its tracked contents and modes and every untracked non-ignored path must be
exactly the delivery tree. Only then is the ordinary index aligned. A later
edit, a new untracked file, or an index staged to anything but an earlier commit
of the slice branch or the delivery itself is unexpected content, and nothing is
changed. No physical file is ever written, and the WK branch and checkout are
not touched: delivery integrates nothing.

Finalization is reported beside the transaction effects and never changes them.
`effects.checkout` is `complete` for a clean exact checkout of the delivery. A
failure keeps the created commit, the delivery ref and the review submission as
stated, reports `effects.checkout: "pending"` with the owner's code and message
under the `checkout` stage, and makes the outcome `partial`; the complete owner
answer is the retained original's `checkout` member. `superseded` means the
slice branch already left this delivery, so no retry of it can finish.

A pending checkout is finished only by an explicit repeat of the same closed
request. `workspace_deliver_work({})` finds the retained delivery of the
authenticated attempt, and when its `checkout` is not `complete` it finalizes
only that: no object is materialized, no ref moves, no review transition runs and
nothing is integrated. The response states
`commit_transaction_executed: false` and
`checkout_finalization_attempted: true`. The attempt's outcome is retained as a
new original that names the one it continues; earlier originals are never
rewritten, and the latest one answers a later repeat. A completed checkout is
not finalized again. A retry whose own original cannot be retained still states
what it did. Reading an original, by anyone, repairs nothing.

### Integrated slice checkout reaping

A successful explicit integration ends the lifetime of its own slice worktree.
The integration finalizer removes that checkout through the existing exact-slice
reaper, `releaseRetainedSlice` in `agent-launch-cli/src/lib/worktree-reaper.mjs`,
under its `successful-integration` disposition, and holds no removal mechanics of
its own. The reap runs only after the result states the confirmed integration of
the approved delivery, the producer-associated binding pair has authenticated the
exact launch, run, retry and base, and the identity retirement owner has
confirmed the worker's retirement, including its idempotent answer for an
identity already retired. Its authority is the slice binding's own launch
reference, run and retry identity, that binding's identity digest and the
approved original delivery commit. A replayed WK commit, or a later tip of either
branch, is never removal authority.

Worker dirtiness is not consulted. Later edits, staged or untracked files and
ignored build or test residue are removed with the checkout; none of them gates
integration, publication or the reap, and none was ever integrated. The reaper
keeps the delivery ref at the delivery commit under its exact-ref lock, writes
its attempt and completion audit, and removes nothing else: the WK checkout, the
configured checkout, history and every other worktree are untouched.

The reap is its own effect, `effects.slice_checkout`, separate from
`effects.checkout`: `complete` once the reaper reported the removal, `pending`
while it is outstanding and `not_attempted` when finalization did not run. WK
checkout finalization is not a condition of it. Without a confirmed retirement
nothing is deleted and the effect is `pending` with
`slice_checkout_reap_awaits_worker_retirement`; a binding pair that no longer
authenticates the approved delivery leaves it `pending` without entering the
reaper. A reaper refusal or failure, such as a moved delivery ref, a failed
removal or a failed audit write, keeps `integrated: true` and every confirmed
effect, reports `effects.slice_checkout: "pending"` with the reaper's own code
and message and makes the outcome `partial`; the complete answer and its
evidence are the retained original's `cleanup.slice_checkout` member. A pending
result is never cached as success.

An explicit request for the same delivery passes the same approval fence,
observes the integration as already applied and finishes only the outstanding
reap. It authenticates the same binding pair without the slice path, in the same
process or after a restart, and the reaper answers from its own audit: a
completed removal is observed idempotently, and a removal interrupted before its
completion audit is completed without a second removal. Reading a retained
original repairs nothing.

An original delivery commit is therefore executed from its slice checkout before
that slice is integrated. After integration, the returned integrated commit is
executed from the WK checkout.

### WK checkout finalization

Integration advances the WK branch by ref compare-and-swap only, so the WK's own
registered worktree would otherwise keep the index and physical files of an older
WK commit while its `HEAD` names the integrated one. The integration finalizer
therefore also brings that existing checkout to the exact integrated tree,
through `synchronizeIntegratedWkWorktree` in
`agent-launch-cli/src/lib/integrated-wk-worktree.mjs`: a thin wrapper that
authenticates the WK half of the delivery's binding pair and asks the shared
owner for an `index_and_files` update. The worker's slice worktree is not its
concern: that checkout is removed by its own separate effect, described under
[Integrated slice checkout reaping](#integrated-slice-checkout-reaping), so
after integration the WK checkout is the owned copy of the integrated commit
that the exact-commit test source selects
([local test runtime setup](local-test-runtime-setup.md)).

The WK worktree is integration-owned and holds no local edits. The only expected
difference from the integrated commit is the stale index and files that ref-only
integration leaves. Its previous materialization may sit no further back than
the WK's fixed fork. A launcher record snapshot or an earlier unfinished
finalization leaves the checkout more than one commit behind, and files such a
commit added are absent from the old index; the older ancestor is then the
authenticated one and those files are added with the rest. The update follows a
stat-only index refresh whose failures keep their own cause.

The whole operation runs inside the WK's authority exclusion, which every
integration of that WK also takes; the exclusion is not reentrant and the
finalizer holds none when it calls the wrapper. When the WK tip has already left
this delivery's integrated commit, a newer integration owns the checkout. The
response keeps `integrated: true`, reports `effects.checkout: "superseded"` and
outcome `partial` with the owner's superseded cause, and the retained original
names the newer tip. No same-delivery checkout retry is offered, because none
could finish; an outstanding record, retirement or slice cleanup correction
still supplies its own recovery call.

Checkout finalization and identity retirement are independent; neither outcome
hides or prevents the other, and neither a pending nor a superseded WK checkout
keeps the integrated slice checkout. A checkout failure keeps `integrated: true` and the
confirmed record and retirement effects, reports `effects.checkout: "pending"`
with the owner's code and message, and makes the outcome `partial`. A pending
result is never cached as success. An explicit request for the same delivery, in
the same process or after a restart, passes the same approval fence, observes the
integration as already applied and finishes only the outstanding finalization;
it repeats no ref movement, record write, launch or integration execution.

`integrate-work.v1` responses distinguish `integrated`, `partial`, `refused` and
`unresolved`. A settled answer acknowledges integration and preserves the
selected delivery and integrated commit for dependent work. It omits successful
record, checkout, retirement and authentication checks, disposition counts and
revisions, policy bookkeeping, private artifact paths and routine diagnostics.
The returned historical outcome read is optional and never recommended merely
because evidence was retained. Conditional verification of the integrated WK
commit is also optional: availability does not establish caller intent or
outstanding proof work. Integration-only requests can finish immediately.

Partial, refused and unresolved answers preserve specific causes, the
authenticated subject when known, actual effects and uncertainty. Unconfirmed
integration effects are explicit nulls; confirmed integration stands even if
record reconciliation, checkout synchronization, identity retirement, slice
cleanup or original storage fails. Remaining effects identify the unfinished
work, its specific originating cause and supported correction or stop. An
unconfirmed checkout or removal differs from an established failure; neither
erases confirmed integration. Original
storage failure alone offers no reintegration to recreate evidence. A superseded
checkout offers no rewind or same-delivery checkout repair. A historical result
read performs no synchronization, execution, retention or repair; the mutable WK
checkout is not a guarantee of current exact-source availability.

Partial completion
with an outstanding record, retirement, checkout or slice cleanup correction also supplies the explicit
same-selection recovery call and its condition. An immutable approval refusal
suppresses that correction call while keeping the optional original read, cause
and confirmed effects. A stale approval offers exact same-attempt observation
only from the already authenticated delivery identity and only when that call is
served and authorized. Observation may still return the rejected delivery; a
reported current commit is never a substitute selection. An operator request
stops before delivery reads or effects and explains that an authenticated
orchestrator session is required. Caller arguments cannot provision that session.
Transport interruption does not cancel an attempt or trigger another one.

The production registration, role grant and returned result calls use these
same owners. Private source/installed compositions establish owner behavior only;
actual combined-server journeys establish public reachability. The delivery
producer refuses a second distinct publication for one binding. A result read
never repairs or recaptures the delivery or integration original.

## Integration entitlement and delivery selection

`integrate_work` is granted only to an authenticated orchestrator. Operator tool
availability supplies no integration authority. Obtain the delivery locator from
`get_run_result` observation and pass it unchanged; worker completion bookkeeping
is not an alternative authenticated delivery source. Checkout and receipt
recovery for one delivery describe one logical delivery. Distinct deliveries
remain explicit choices, with no first-receipt default.
