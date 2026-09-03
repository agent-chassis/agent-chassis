# MCP dispatch launch and admission

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
supported families, launch and monitoring, the canonical initiative gate,
orphaned and ahead slice tips, and declared unit dependencies.

Sibling pages: [managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## One advisory-review execution pipeline

`workspace_agent_dispatch` selects reviewer and redteam requests by role before
worker admission, implementation lifecycle planning, persistent worktree
allocation, status/history inspection, receipts, recovery, integration, CAS, or
forge coordination. Both roles enter the same advisory-review owner; their role
presentations and tool profiles remain distinct and their mutation authority is
always empty.

A canonical WK or slice contributes coordination context. Current canonical
design bytes, an immutable implementation-slice delivery, a complete
`diff_base_sha` plus `reviewed_sha` pair, and a launcher-built terminal candidate
are material selectors for that owner, not execution routes. A SHA pair is
locator syntax, never authority. Each accepted action resolves immutable
material, creates a fresh action-private read-only materialization, invokes the
selected executor once, allocates an action-local run and monitor, and settles
its text-first advisory output. Clean findings, severe findings, and
schema-nonadherent text are equally usable; missing output or execution failure
affects only that action.

Formal attestation is optional and can be derived only while the same run
settles when the launcher-selected canonical result contract requests it. No
review result, status, history, provenance, attestation, or receipt authorizes,
vetoes, replays, replaces, or recovers another action. There is no legacy review
receipt, continuation, recovery, or replay route.

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
## Admission refusals carry the canonical mechanical envelope

Every admission refusal on this path — subject/role matrix, readiness, the
findings-only write-scope seam, graph admission, backend absence, and the
authenticated CCE limb — is built by the one public mechanical carrier and
carries a registered code, a deciding fact by identity, and exactly one
continuation limb.

Two of those limbs are worth naming here, because they are the ones an agent
acts on:

- a NOT-DISPATCHABLE authored contract offers the canonical authoring route
  `workspace_work_record_ready_slice` for the selected unit, with complete
  arguments and the machine-checkable outcome that the unit becomes
  dispatchable. A graph-coded readiness state does NOT offer it: the work record
  is not what is wrong, so sending a coordinator to edit it would be false
  guidance.
- a canonical standalone reviewer or redteam unit authenticates empty effective
  mutation scope. A reviewer selecting a write-bearing implementation slice is
  delegated to the exact-target backend, which grants that action empty mutation
  authority without rewriting the implementation contract. Redteam cannot use
  that implementation-slice form. Missing, malformed, mutable, or substituted
  scope refuses before route selection; no unit identity or purpose is invented.

An absent launch backend, an unbuildable graph baseline, and an authenticated
CCE policy refusal all state `no_supported_route`. That is the accurate answer
rather than a missing one: no agent-callable route registers a backend, makes an
unbuildable baseline buildable, or overturns a policy decision, and re-issuing
the same dispatch against unchanged facts reproduces the same refusal.

Normal tooling outcomes never use `operator_recovery_needed`. Validation,
launcher declaration, authority binding, backend, route, decision-envelope,
recovery-contract, scope-threshold, and portfolio failures keep a specific
registered identity, owning boundary, and every mechanically supported next
call. The operator code is break-glass only for an authenticated unexpected
condition outside the tooling model, and must preserve that exact external
condition rather than replace a known cause.

Node Engine and CCE admissibility belong only to implementation-worker
admission. Reviewer and redteam startup performs read-only readiness and never
requests, interprets, or refuses on worker-only declaration, binding, pack, or
decision-envelope facts. A globally registered identity such as
`authority_binding_unratified` remains valid taxonomy, but it can affect only
the worker operation that owns that condition. Frozen reviewer/redteam server
startup instead validates its committed classifier, taxonomy, constants,
discovery projection, registration surface, MCP initialize, and exact
`tools/list`; any genuine current-action startup failure retains its originating
typed identity.

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
executable/backend/runtime capabilities, caller-supplied authority where
launcher-owned state is required, a conflicting
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

A declared `depends_on` population is the normalized record-level plus selected-
slice population resolved by wiki-core's canonical dependency-evidence owner.
For local targets, literal identity, lifecycle status, initiative, provenance,
and `target_work_kind` come from server-read canonical WK JSON. Caller-supplied
status, work kind, initiative, identity, provenance, marker, or reason remains
observable analysis only and never replaces or suppresses a canonical fact.
Missing or vocabulary-unknown canonical `target_work_kind`, malformed addresses,
and missing canonical targets retain wiki-core's `fact_resolution_failed`
mechanical evidence and failure code; the launcher neither defaults nor reparses
them.

Lifecycle status is not dependency admission authority. No local done-only,
blocked-status, review-status, or other lifecycle predicate refuses dispatch.
Under decision an unmet edge is either a wiki-core mechanical fact-resolution
failure, a launcher-owned mechanical Git-integrity failure described below, or a
separately authenticated returned policy decision. A condition that names none of
those limbs does not refuse. The slice-DAG done frontier remains a coordination
projection only and feeds no readiness or provisioning decision. This read-only,
pre-provisioning resolution is decision clause 2 free substrate.

The dispatched subject must still resolve as the exact canonical implementation
slice. For dependencies, only canonical `target_work_kind: implementation`
enters the Git-integrity path. Canonical review and redteam dependencies require
no delivery ref and no initiative-derived Git identity; their lifecycle status
is carried as evidence but never consulted. The same no-ref rule applies to
other canonical non-implementation dependency kinds. A self-edge remains a
mechanical identity failure. Repo-qualified external edges preserve their
existing mechanical disposition without deriving a cross-repository ref or
introducing cross-repository policy.

**Exact ancestry is the primary implementation evidence.** Through the launcher's existing Git
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

**Replay-equivalent marker admission is the one additional implementation path**,
reached only from that determinate negative and never sufficient by itself. The
commit-preserving WK replay rewrites the sha
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
yields a sha only for a one-candidate set. Every candidate reachable from the
captured WK tip participates even when it is
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
admits only when the dependency also has exact canonical implementation identity,
a matching canonical address, matching initiative and `canonical_wk_json`
provenance, the captured WK tip, determinate literal non-ancestry, and final ref
stability. Zero or multiple matches refuse; unmatched historical candidates are
harmless and candidate position grants nothing.

The marker path is closed to a **same-record canonical implementation slice**;
no lifecycle status participates. There is no cross-WK and no whole-WK marker fallback: a marker
naming another record, or a marker for a different slice, grants nothing however
reachable it is. Every other outcome of either probe — spawn error, signal,
unexpected status, malformed output, an absent or malformed marker, a parentless
or merge-shaped delivery/candidate, or any indeterminate resolver state — refuses
without another fallback. Literal commit parsing validates every header and
continuation before using its tree, parents, or message; malformed header lines
make the object unreadable and grant no authority.

All implementation Git evidence is bound to the allocated or adopted subject WK
tip and every exact implementation dependency ref/tip used by either proof.
Review, redteam, and other non-implementation dependencies create no dependency
ref to bind. work record first performs its existing allocation/adoption settlement.
The launcher then freezes the settlement's slice base and requires its ref and
SHA to equal the settlement's persistent-WK ref and tip exactly. Only after that
equality proof does dependency assessment begin. After the last dependency probe,
the launcher re-resolves every captured ref and requires byte-identical equality.
Movement, rewind, deletion, malformed output, or an indeterminate read refuses
before policy continuation, reservation, conduit construction, and process spawn.

The gate's non-authorities are as narrow as its evidence. It performs no retry,
sleep, current-main synchronization, WK-ref repair, cleanup, fallback
reconstruction, or canonical status mutation; it accepts no caller-carried
dependency evidence, prompt text, or environment; it renders no review verdict and
changes no CCE policy boundary; and it grants no existing-slice continuation
authority — the exact-slice reconcile gate above remains independently
load-bearing. A refusal is a coordinator-owned re-dispatch, not a repair.

## Unified launcher transition plan

`launcher-transition-plan.v1` is the one finite readiness-to-spawn projection.
Its exact top-level fields are `schema_version`, `identity`, `phase`,
`role_runtime`, `lifecycle`, `dependency`, `publication`, `cce`, `reservation`,
`spawn`, and `failure`. The launcher composer is pure: it allocates no lifecycle,
mutates no ref or record, evaluates no policy, observes no publication, reserves
no subject, and spawns no process. Registered readiness creates the prospective
plan; `createLaunchFlow` revalidates that exact identity and the work record selection,
then forwards the allocated projection unchanged through the family executor.
Coordination preflight may carry the exact frozen plan by reference only.

The only permitted readiness/accepted-dispatch differences are `phase`
(`prospective` to `allocated`) and freshness authenticated during launch. Every
other identity field must remain equal. Callers cannot supply a plan or identity.
No second transition schema or wrapper-owned semantic envelope is supported.

work record composes retained owners; it does not replace them:

- work record owns role, target, model, application, and runtime selection.
- work record owns allocation/adoption settlement, retry, compensation, CAS-loss,
  concurrency, refs, and worktrees.
- work record owns corrective-history receipt authentication.
- work record owns findings-route classification and authenticated confinement/MCP
  transport.
- work record alone produces `forge-confirmed-landed-publication-identity.v1`.
- CCE alone returns policy decisions and recovery.

A completed cross-WK implementation dependency is admitted only with the exact
frozen carrier returned by work record's forge observer. Status, closure prose,
messages, stale WK refs, and reconstructed publication fields grant nothing.
Manual ref repair and publication replay are not recovery actions.

### Ownership of transition semantics and the managed-provisioning carrier proof

Two semantics that the launch path depends on have exactly one owner each, in
`@agent-chassis/agent-launch-core`. decision places the shared launch dispatch
substrate there, and core never imports `agent-launch-cli`.

| Semantic | Sole owner | Compatibility and host boundaries |
| --- | --- | --- |
| Launcher-transition plan, closed failure taxonomy, and authenticated backend-refusal classification | `agent-launch-core/src/lib/launcher-transition-plan.mjs` | `agent-launch-cli/src/lib/launcher-transition-plan.mjs` is a thin re-export that owns no classification, cause or recovery precedence, redaction policy, or transition semantics. |
| Managed-provisioning carrier meaning — exact v1/v2 field sets, subject and current-attempt identity, path containment, nested-binding completeness, mirror invariants, independent WK-versus-slice resources, restored-carrier deep freeze | `agent-launch-core/src/lib/managed-provisioning-result-shape.mjs`, published through `managed-provisioning-result-assertion.mjs` | `agent-launch-cli/src/lib/worktree-provisioning-dispatch-binding.mjs` re-exports the confined structural assertion by identity and adds only host-physical evidence. |

`packages/wiki-mcp/src/lib/dispatch-tools/register.mjs` is a **structural public
projector** over the core classification. It classifies each authenticated
backend refusal once and then projects; it performs no classification, reason
matching, authority matching, truncation, fallback substitution, or recovery
selection of its own.

The two managed-provisioning proofs remain non-substitutable. Both run the same
core-owned structural rules; they differ only in what the caller supplies:

- The **confined structural proof** — the read-only orchestrator wiki-MCP
  namespace — runs with the launcher-owned worktree root deliberately unmounted.
  It performs no stat, realpath, Git, or worktree-root access, proving containment
  by pure path math, and it additionally requires the restored carrier to be
  deeply frozen. A carrier crossed a JSON wire, so its immutability is evidence
  that the adapter re-froze it, not a formality; a mutable, reconstructed, or
  changed or reconstructed carrier is rejected.
- The **host-physical proof** — the writable host boundary — injects realpath and
  stat canonicalization plus the Git HEAD/ref and fork-ancestry evidence around
  the identical structural rules. It accepts a mutable host carrier because it
  runs before `freezeManagedResult` seals it.

Accepted carriers return by identity in both proofs, so a caller can prove the
admitted object is the exact one it submitted. Refusals carry one stable code,
message, and structured detail, and select no launcher recovery: recovery, actor,
and next-action selection belong to the launcher-transition owner.

The exact refusal classification, producer envelopes, public response field
list, and redaction signal vocabulary are specified in
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md#authenticated-backend-refusal-classification).

### Scope-selected lifecycle settlement and public readiness

Lifecycle selection follows the launcher-authenticated effective `write_scope`,
not role. Empty-write-scope actions bind a detached immutable findings snapshot
containing the exact record and complete selected contract generation, then
create one independently bound advisory action without allocating, reading, or
changing a persistent WK ref. Nonempty-write-scope implementation admission
alone invokes work record allocation/adoption, generation persistence, canonical-WK
snapshotting, worktree reconciliation, and exact-slice authority. Role policy
continues to own confinement and transport; it does not select lifecycle.

work record's readiness-shape module is the sole constructor of the bounded
`managed-wk-allocation-readiness.v1` envelope. The public readiness/start-launch
route transports the same scope-selected result; it does not rebuild the result
or expose worktree paths, manifest member bytes, or another continuation. For
findings readiness an absent persistent ref stays absent and an existing ref is
not consulted. Implementation readiness still allocates or adopts an absent ref.

Allocation CAS loss and controlled-generation persistence CAS loss admit only
an exact equivalent winner. Restart after allocation, generation persistence,
or WK snapshot re-observes the exact durable effect. Authenticated WK-tip
movement invalidates every tip-bound transition projection; only a fresh
work record owner carrier can settle the new tip. Partial ref or worktree
observation converges to the same identity or refuses without another write,
identity substitution, confinement widening, cleanup, raw repair, or duplicate
spawn. Manual ref creation, direct persistence,
`establish_persistent_wk_lifecycle_ref`, a second allocator or persistence
owner, new locks or retry loops, registries, and recovery tools are outside this
route. work record's already-owned serialization and settlement behavior is
unchanged.

Worker spawn uniqueness remains keyed by the canonical implementation-subject
reservation. Findings have no uniqueness election: every accepted empty-scope
dispatch mints a fresh run and monitor, registers both process-locally, and makes
one confined advisory launch. A prior findings action, receipt, result, failure,
or process identity cannot select, resume, suppress, replace, or veto it. Source
identity remains an authenticated immutable Git commit/tree selection, and every
action independently verifies its complete controlled generation and execution
substrate. CCE and decision confinement keep their existing authority boundaries.
Every refusal remains typed and fail-loud.

decision keeps explicit standalone technical redteam distinct from CCE reviewer
mode. Its work record admission must authenticate the exact canonical unit and launch
subject. Missing or mismatched admission is a mechanical refusal before technical
role authority, lifecycle allocation, conduit construction, or spawn.
## Findings-only advisory review

Empty effective mutation scope is the sole findings lifecycle discriminator.
Canonical slice, terminal whole-WK, and explicit `{ diff_base_sha, reviewed_sha }`
selectors all call the same normalization and immutable snapshot owner. A
complete SHA pair is an ordinary review input: it locates bytes but is not an
authority carrier, attestation, receipt, or provenance record. The resolver
validates only commit identity, ancestry, the required nonempty range, readable
tree, and exact private-snapshot bytes. A bad pair refuses only its current call
and creates no persistent recovery or WK state.

The request still uses a canonical WK or `work record` coordination
`subject`; the SHA pair is additional locator data on that same
`workspace_agent_dispatch` call. For example:

```json
{
  "role": "reviewer",
  "subject": "work record",
  "diff_base_sha": "<40-character base commit>",
  "reviewed_sha": "<40-character reviewed commit>"
}
```

A bare SHA in `subject` remains a mechanical refusal. Its bounded correction
offers exactly one callable recovery:
`workspace_tools_describe({"tool_name":"workspace_agent_dispatch","verbose":true})`.
That registered description carries the concrete canonical-subject-plus-SHA-pair
shape above. The caller supplies its already-known WK or slice; the server never
infers or searches for one from a SHA. The same registered dispatcher performs
the corrected review. No external reviewer, shell command, wrapper, alternate
transport, terminal candidate, ref creation, attestation append, or provenance
repair is required.

In an operator-authorized direct-to-main lifecycle, commit the exact scoped
implementation candidate first and dispatch its read-only review with the
canonical subject plus the landed commit's complete base/reviewed SHA pair.
Terminal-candidate status, advance, and forge handoff do not participate, and the
reviewer never creates Git objects.

Capture is one normalized-target transaction. Selector form is erased before
execution and cannot choose another lifecycle, route, retry, result contract, or
provenance requirement. Nonempty implementation admission continues to use the
existing persistent WK allocation, generation persistence, confinement, and
compare-and-swap path unchanged.

Reviewer and redteam prompts are text-first. They ask for the actual advisory
analysis and state that it remains usable whether or not optional structured
metadata conforms. Worker-only outcomes are not offered. Schema-constrained
output is reserved for an explicitly selected formal-attestation use; ordinary
review prompts never imply that JSON adherence determines review acceptance,
occurrence, usability, or lifecycle posture.

Backend routing resolves the authoritative source exactly once and mints one
launcher-private immutable source-selection carrier. Provisioning authenticates
that carrier and materializes only its exact bytes. The findings context carries
the carrier opaquely together with frozen acceptance, readiness, and graph-impact
facts; it never reconstructs source authority or lifecycle state. Technical
reviewer/redteam identity is applied only afterward for prompt/persona, confined
tools, result schema, and completion transport. Family planning must not run a
second readiness pass against the sparse snapshot or accept graph-impact evidence
from argv, prompt, ambient environment, or caller fields.

Canonical design findings add one narrow projection to that transaction. Routing
captures the current WK file and only the canonical controlled-contract/proof
members selected for that WK, verifies that none moved while capture was in
progress, and writes those exact bytes at their canonical paths in the fresh
detached review checkout. The rest of the checkout remains the selected Git commit,
so unrelated tracked dirt and untracked host files never enter the action. The
capture is action-local: host edits after capture do not alter the active review,
and the next independent dispatch captures the new canonical bytes. This projection
does not apply to exact implementation SHA ranges or terminal candidates.

The shared launcher role-contract renderer directs every Codex and Claude
reviewer/redteam client to the assigned unit's canonical
`wiki/work-records/WK-####.json` inside that already-bound snapshot and names the
exact selected unit address. That snapshot-local unit's acceptance criteria and
validation are the findings acceptance source. Live `main`, inline mutable
current-record bytes, and the operator diagnostic frozen-contract query are not
source-selection alternatives. The diagnostic query is neither findings
acceptance transport nor a launch prerequisite.

For an exact implementation-slice review, routing authenticates the current
record and selected-unit identity before it attempts Git target resolution. The
bounded current-record refusals remain distinct through the backend and public
projection: absent record, incomplete or mismatched identity, invalid `slices`,
absent selected slice, wrong selected `work_kind`, and other malformed selected
slice material do not collapse into a Git-object-store failure. Filesystem
presence and source-control status are not Git-object authority, so correcting
current canonical identity does not require committing the record unless a
separate supported operation says so. A fresh dispatch after such a correction
is a new action; it does not resume or recover the refused action.

The process-local run registry is the sole current-run observation owner.
Immediate status and wait can observe a findings run while that backend process
retains it. After restart, an old handle may be unknown or expose separately
retained logs only; receipts and terminal artifacts do not reconstruct it. Such
artifacts are optional audit evidence, so absence or write failure cannot change
the run outcome or suppress a later dispatch. Implementation and integration
receipt, settlement, recovery, allocation, persistence, and CAS behavior remains
unchanged.

Every findings dispatch is a fresh independent advisory action. A failed action
is not repaired or resumed, and neither its failure nor any historical result can
select, satisfy, suppress, or veto a later action.

Slice-level standalone admission authenticates the parent WK as immutable review
context, not as the executable selected unit. Canonical nonempty parent criteria
with an intentionally empty validation array are therefore admissible draft
review material. The selected slice's acceptance remains complete and strict.
Malformed parent material, malformed or incomplete selected-slice acceptance,
moved identity, wrong role or effective scope, and caller-supplied locators or
authority still refuse before allocation, materialization, or spawn. Bare-WK
reviewer and redteam calls remain strict because the parent itself is the
executable selected unit.

Before a canonical exact implementation target becomes an immutable findings
target, the launcher proves that both selected identities are commit objects,
that the base is an ancestor of the reviewed commit, and that the reviewed commit
and base still equal the canonical selected-delivery binding. Missing objects,
reversed and disjoint ranges, a mismatched binding, and movement during the proof
retain distinct owner reasons. Only after the final binding recheck may routing
mint a source carrier or materialize a snapshot.

The route classifier admits exactly five semantic role/subject forms:
standalone reviewer slice, standalone redteam slice, exact implementation-slice
reviewer, bare-WK reviewer, and bare-WK redteam. It derives them from canonical
schema and production classifier semantics; `review_purpose` does not mint a
separate lifecycle subtype. Effective `write_scope: []` alone selects findings,
while a nonempty authenticated scope alone selects implementation. Missing,
malformed, mutable, caller-substituted, or otherwise unauthenticated scope and
locator facts refuse before effects. In particular, redteam applied to a
nonempty-scope implementation slice is a
`technical_role_selected_unit_incompatible` mechanical role-policy violation at
phase `technical_role_selected_unit_admission`; it is not a review-target or
frozen-contract failure because neither operation has been attempted.

Migration-review acknowledgement does not participate in read-only findings
admission. Acknowledged and unacknowledged units with otherwise identical
canonical bytes have identical findings admission. Nonempty-scope
implementation dispatch retains the existing migration policy.
