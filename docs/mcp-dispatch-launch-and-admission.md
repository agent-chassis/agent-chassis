# MCP dispatch launch and admission

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
supported families, launch and monitoring, the canonical initiative gate,
orphaned and ahead slice tips, and declared unit dependencies.

Sibling pages: [managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

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

### The canonical initiative and parent review status gate dispatch

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
CCE decision). It is one parent-level fact that gates local dispatch. A managed
implementation-worker dispatch is also refused before any executor spawns when
the parent WK is in whole-WK `review`, with blocker code
`managed_parent_wk_review_blocks_worker_dispatch` and `actor_recovery`
`coordinator`. The coordinator route is to move the parent out of whole-WK
review or complete the terminal cycle before dispatching the slice.

The remaining parent-lifecycle facts — non-empty parent `acceptance.criteria` and
`acceptance.validation`, and a predeclared, singular terminal whole-WK
findings-only review unit — are **not** a free/local implementation-dispatch
admission veto. An otherwise-valid implementation unit (with a canonical
initiative and a parent outside whole-WK `review`) reaches graph recovery, CCE
policy evaluation, reservation, provisioning, worktree allocation or mutation,
backend launch, and spawn even when its parent WK lacks parent acceptance arrays,
or has no — or more than one — `terminal_whole_wk` review unit. Parent review
planning remains organizational coordination policy except for the explicit
whole-WK `review` dispatch refusal above; there is no
`parent_lifecycle_contract_incomplete` dispatch refusal.

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

### Declared unit dependencies are authenticated conjunctively

A declared `depends_on` edge admits an exact-slice dispatch only when canonical
status and mechanically bound Git evidence are **both** satisfied. Canonical
`done` alone never admits, and Git evidence alone never admits. The check runs
before scope freezing, provisioning, reservation, and spawn, and an unmet edge is
the existing `unit_dependencies_unmet` refusal carrying per-dependency
diagnostics.

Two identity rules apply to a slice dependency **before either Git path runs**.
The dispatched slice may not depend on itself, and a non-implementation
(review/redteam) slice is refused outright: such a unit mints no delivery commit,
so no ancestry and no marker about it is evidence that it completed. Both refuse
even when the retained dependency tip genuinely is an ancestor of the WK tip.
Whole-WK dependencies keep their existing record-status and ref semantics.

**Exact ancestry is the primary evidence.** Through the launcher's existing Git
runner, the launcher resolves the subject WK tip and retained dependency tip with
exact `show-ref` queries, without peeling, and requires canonical non-zero object
ids. Every authority-bearing Git argv begins with `--no-replace-objects`. The
launcher reads each full oid's literal commit with `cat-file`, parses its complete
literal parent list, and performs a bounded walk of those literal parent oids.
Replacement refs, revision expressions, and semantic history output are not
ancestry authority; graft inputs are irrelevant because Git's semantic parent
view is never consulted. Malformed objects, missing parents, cycles, bound
exhaustion, inconsistent output, and Git faults are indeterminate refusals. A
determinate literal not-ancestor result is the only route to replay-equivalent
matching.

**Replay-equivalent marker admission is the one additional path**, reached only
from that determinate negative. The commit-preserving WK replay rewrites the sha
of an already-integrated delivery, so the retained slice ref keeps naming the
original commit while the WK chain carries an equivalent with a different object
id; strict ancestry then reports a mechanically present dependency as absent. The
stable `Wk-Slice: WK-NNNN#SLICE-MMM` trailer is the identity that survives that
rewrite, and the single canonical marker authority enumerates every authenticated
historical candidate reachable from the captured subject WK tip. The marker must
occupy the launcher's exact final trailer paragraph; marker-keyed body lines,
duplicates, conflicts, padding, case variants, malformed values, and trailing
prose refuse. It authenticates both launcher-minted families: an ordinary worker
delivery and the exact work record zero-delta integration-evidence template with all
of its delivery, base, WK-parent, literal-parent, and tree bindings. Multiple
authenticated commits carrying the same slice identity are legitimate history
and are returned as an ordered-neutral set. The compatibility single-sha view
yields a sha only for a one-candidate set; whole-WK lifecycle presence for a
canonical done sibling instead accepts any nonempty authenticated candidate set.
Every candidate reachable from the captured WK tip participates even when it is
also reachable from current landing; landing is not resolved or consulted by
this authority.

Marker identity is not delivery authority. The current retained slice commit and
every historical candidate must be literal, readable, single-parent commit
objects. The retained commit must carry the exact launcher-generated canonical
message. An ordinary candidate matches only when its exact canonical message
equals that retained message and its fixed parent-relative object delta equals
the retained delta. A zero-delta evidence candidate must authenticate every
encoded binding, name the current retained delivery and its literal parent as its
delivery and base, and have a parent-relative structural delta equal to the
retained delta. Consequently only a genuinely empty retained delivery can match
that family. With explicit parsed parent oids, the runner executes `-c
core.quotePath=true -c color.ui=false diff-tree --raw -r --no-renames
--no-abbrev --ignore-submodules=none --no-ext-diff --no-textconv --no-color`.
Every non-NUL raw record and Git C-quoted pathname is parsed fail-closed into its
original filename bytes, then converted to a deterministic sorted structural set;
patch rendering, external diff, textconv, rename detection, caller configuration,
and `<oid>^` never participate. This preserves file modes, symlinks, binary blobs,
gitlinks, empty commits, distinct non-UTF-8 filenames, hostile filename bytes, and
both SHA-1 and SHA-256 object ids. Exactly one current retained-delivery match
admits. Zero or multiple matches refuse; unmatched historical candidates are
harmless and candidate position grants nothing.

The marker path is closed to a **same-record implementation slice whose canonical
status is `done`**. There is no cross-WK and no whole-WK marker fallback: a marker
naming another record, or a marker for a different slice, grants nothing however
reachable it is. Every other outcome of either probe — spawn error, signal,
unexpected status, malformed output, an absent or malformed marker, a parentless
or merge-shaped delivery/candidate, or any indeterminate resolver state — refuses
without another fallback. Literal commit parsing validates every header and
continuation before using its tree, parents, or message; malformed header lines
make the object unreadable and grant no authority.

All evidence is bound to the captured subject WK tip and every exact dependency
ref/tip used by either proof. After the last dependency probe and immediately
before provisioning, the launcher re-resolves all of those exact refs and requires
byte-identical equality with every captured tip. Movement, rewind, deletion,
malformed output, or an indeterminate read refuses before worktree creation, slice
reservation, and process spawn because the evidence describes state that no
longer exists.

The gate's non-authorities are as narrow as its evidence. It performs no retry,
sleep, current-main synchronization, WK-ref repair, cleanup, fallback
reconstruction, or canonical status mutation; it accepts no caller-carried
dependency evidence, prompt text, or environment; it renders no review verdict and
changes no CCE policy boundary; and it grants no existing-slice continuation
authority — the exact-slice reconcile gate above remains independently
load-bearing. A refusal is a coordinator-owned re-dispatch, not a repair.
