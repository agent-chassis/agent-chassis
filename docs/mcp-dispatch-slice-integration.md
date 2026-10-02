
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
  and the registered `workspace_wk_forge_handoff` route reports it with
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
  applicable closure evidence and then the parent review-to-done transition, so
  the initially published pull request already carries parent status `done`;
  that status is branch-local until a confirmed merge. A workflow without
  terminal review has no terminal-review record fabricated for it. Merge takes
  the exact authenticated pull-request head only on confirmed mergeability and
  adds no commits, and an unmerged, unknown, moved or foreign state leaves the
  canonical parent in review. The confirmed merged base record is canonical, and a reconciliation
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
3. `registerCommittedSliceIntegrationRoute` and its
   `projectIntegrationSuccess` helper in
   `packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs`
   are the MCP projector. They validate the public subject, reject caller
   authority carriers, and project the launcher result into the MCP schema.
   Evidence counts and dispositions are correlation output only; projection
   never becomes a second registry, producer, or policy gate.

The public request is
`workspace_integrate_committed_slice({repo?, subject, dispositions?})`.
`subject` is a canonical address such as `work record`; `repo` is the optional
configured repository alias; and `dispositions`, when present, is the registered
array of `{review_run_id, finding_id, disposition}` entries. There is no
`comment_dispositions` argument. The request carries no target, ref, receipt,
review verdict, policy decision, or integration authority.

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
write is made. A pending record is repaired through the existing compound CAS writer
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

A managed exact-slice implementation worker has exactly one completion sequence,
and every supported family prompt states it once, in this order: successfully
invoke the launcher-provided closed-input commit capability, then emit the
`agent-role-result.v1` structured evidence, then terminate. The shared
family-neutral terminal-result renderer is the single source of that ordered
protocol. Family role contracts carry no parallel completion instruction of their
own; in particular they no longer carry an independent commit-and-terminate
sentence, and they do not claim that confirmed termination itself causes
integration, whole-WK freezing, or review. After confirmed termination the
launcher's post-worker lifecycle requests committed-slice integration for the
exact delivered subject, with the exact-target, mechanical, configured-CCE, and
CAS behavior defined on this page; a coordinator may also request it explicitly.
Review is never a prerequisite: it remains available and advisory only as an
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

## Exact commit transaction and immutable integration

The exact-slice commit transaction has two ordered resources: publish the
launcher-bound slice ref with exact compare-and-swap, then persist the canonical
implementation-to-review transition. The response reports committed/submitted
success only when both are proven. If canonical persistence fails after this
invocation advanced the ref, the server compensates that exact publication with
`update-ref <slice-ref> <authenticated-prior-tip> <published-commit>`. Failed
compensation is a typed partial transaction. An idempotently pre-existing delivery
was not published by the invocation and is never compensated.

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
retry and binding pair, the delivery parent and live slice/WK refs, and the
integration's original boundary-authorization target. A refused or in-flight
attempt creates no entry. The index is process-local and non-authoritative after
restart: absence continues through the durable recovery path, including its
unchanged canonical-generation checks and `controlled_contract_generation_missing`
refusal.

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
