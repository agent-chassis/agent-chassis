
# MCP dispatch terminal review

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
terminal-candidate material selection and advisory review execution, the
authenticated controlled-generation envelope for terminal candidates, active
managed composition, spawned-server lifecycle, post-spawn conduit failure,
cleanup-only terminal failure, canonical `acceptance.validation` admission across
the findings-only surfaces, independent findings actions, the exact-slice
review-surface state budget, bounded postcheck diagnostics, and terminal-review
audit evidence.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[slice integration](mcp-dispatch-slice-integration.md),
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

## Handoff destinations and landing observation

Handoff hands off the same authenticated candidate and closeout chain whatever
the destination; only the transport and its evidence differ. The destination is
resolved from the launcher-frozen main repository's Git configuration before
any effect, never from caller input.

- **Selection.** `agent-launch.handoffDestination` is the explicit selector:
  `local`, `git:<remote>` for plain Git delivery to that remote whatever its name
  or URL (including a local bare repository), or `hosted:<remote>` for hosted
  branch-and-proposal publication over that remote's canonical HTTPS identity.
  Without a selector, a repository with no remotes hands off locally, a
  repository with an `origin` remote publishes hosted through it, and any other
  remote set refuses `handoff_destination_unselected`: an absent `origin` is not
  the absence of remotes, and no destination is guessed. A multi-valued or
  malformed selector refuses. No origin, credential, GitHub URL or pull request is
  ever fabricated.
- **One failure, one cause.** A failed observation or delivery on the selected
  destination refuses with its original Git failure as evidence (`remote_invalid`
  for selection and remote identity, `git_failed` for local and Git transport)
  and never selects another destination; a failed hosted publication is never
  turned into a local success.
- **Local and Git material.** Local and Git handoff record the authenticated
  closeout head `D` in the product-owned ref
  `refs/agent-launch/wk-handoffs/<initiative>/<WK>/<C>/local` or
  `.../<C>/git/<remote>` in the main repository, created only when absent. The
  ref name retains the destination the candidate was handed to: when the
  current selection names a different destination, handoff and landing
  observation refuse `handoff_destination_changed` with no effect (observation
  reports `unavailable`) rather than re-reading or repeating the handoff under
  the new selection. Git delivery first pushes `D` to
  `refs/heads/handoff/wk/<initiative>/<WK>/<C>` at the selected remote's
  validated URL, with a create-only lease, so no remote-tracking ref moves; the
  handoff ref is written only once the destination branch is observed at `D`, so
  a failed delivery leaves no ref. A retry or a fresh process authenticates the
  same ref and appends no second chain. The result reports `transport`,
  `destination`, `handoff_ref`, the exact head, the base branch and the actual
  `effects`, and names the human landing action with `next_action`; it carries
  no repository coordinate, pull request or proposal authority. Handoff never
  moves a landing base, merges, or completes the WK, and forge merge refuses a
  local or Git handoff because there is no proposal to merge.
- **One read-only landing observer.** `workspace_wk_landing_status` and
  dependency provisioning consume the same observer. It re-authenticates the
  existing handoff through the handoff authority owner's read-only observer and
  reports `awaiting_human_landing`, `landed`, `contradictory` or `unavailable`,
  each with its original cause. Local and Git landing is read from the actual
  base history — the main repository's base branch, or the destination's, whose
  missing objects are fetched into the object store without moving any ref — and
  is `landed` only when the exact handed-off head is an ancestor of the observed
  base tip; the carrier is `git-landed-publication-identity.v1`. Hosted landing
  is the merged exact proposal and its bound ancestry, as the
  `forge-confirmed-landed-publication-identity.v1` carrier. A Git destination
  branch that disappeared or moved without landing is contradictory. The observer
  never publishes, creates or merges a proposal, reconstructs or materializes a
  candidate, executes proofs, or reconciles the canonical record; explicit
  closure remains its own operation.

## Terminal candidates select material, not review execution

A launcher-built terminal candidate contributes its already-selected immutable
material to the single advisory-review pipeline used by ordinary reviewer and
redteam dispatch. Terminal coordination continues to own candidate construction
and publication, but it owns no separate reviewer executor, run, monitor,
settlement, receipt, recovery, or replay path. The review action remains
read-only and action-local, and its output creates no lifecycle authority.

The managed post-worker lifecycle constructs and publishes the candidate after the
final implementation slice integrates, and only when the canonical record
designates a `terminal_whole_wk` unit. It never dispatches the terminal reviewer:
terminal review runs only when a coordinator explicitly dispatches that unit. A
record that designates no such unit gets no candidate from the lifecycle and
reaches the workflow-not-selected state below.

The advertised terminal reviewer call is subject-addressed:
`{role: "reviewer", subject}` for the canonical slice whose `review_purpose` is
`terminal_whole_wk`. Without an explicit `diff_base_sha`/`reviewed_sha` pair, the
pipeline asks the backend candidate owner for that subject's material. The owner
requires a published `refs/agent-launch/terminal-current-v2/<WK>` selection and
authenticates it for this action through the same cold recovery used by forge
publication. That recovery authenticates the current controlled generation at `W`,
recomputes the candidate identity from `B`, `W`, and that generation, and verifies
the candidate object and private checkout. Candidate preparation and cold recovery
perform authentication only: they do not execute product validation or proof
attempts. Any required verification is a separately authorized
`workspace_verify_proof` operation, and missing evidence remains missing rather
than triggering execution. Recovery then binds the review context against the
live canonical record. The selected `C` must
still be the published selection. The review
materializes `C` against `B` as material kind `launcher_terminal_candidate`.

Selection re-authenticates on every dispatch, so it behaves identically in a fresh
backend and after the worker identity is retired. A retained process-local
context or an earlier review action is not material authority. An unpublished
candidate refuses as `terminal_candidate_unpublished` without reconstruction. A
foreign, moved, stale-generation, or otherwise unauthenticated candidate refuses
with the recovery owner's verdict. Both refuse before reviewer execution as
`agent_launch.advisory_review.material_invalid.v1` with reason
`terminal_candidate_unavailable`, and never fall back to canonical design
material. The request cannot supply a candidate object: the registered
`workspace_agent_dispatch` declares `terminal_candidate` and
`reviewer_launch_identity` only so it can refuse them as
`caller_supplied_identity` before admission, material selection, recovery, or
execution. Canonical WK and
non-terminal design subjects keep canonical design material, implementation
slices keep their retained delivery, and an explicit SHA pair keeps
`explicit_sha_range`.

## The authenticated controlled-generation envelope for terminal candidates

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
recovery, status, reviewer material selection, and forge handoff resolve one
explicit candidate version and return consistent current or superseded state.

Forge mutation has no versionless compatibility path. Branch publication, pull-request
mutation, closeout, and merge require one launcher-authenticated selected version
decision and its immutable version ref and current-selection observation. Review
receipts, results, and findings are not forge prerequisites. A historical state without that version
decision remains readable through observation surfaces only and cannot authorize a
forge effect. Merge consumes an authenticated handoff result minted only by the
handoff authority owner: the result a handoff in the same process returned, or a
fresh read-only observation of the already-published identity
(`observeAuthenticatedWkForgeHandoff`, bound in production by
`createProductionForgeMergeDependencies`). The observation re-authenticates the
exact selected candidate, its version and its squashed worktree from durable
authority, the same repository/base/branch identity the publisher binds, and the
observed branch and single proposal head. It never republishes, creates a
proposal, reconstructs or advances a candidate, or moves a ref, and a serialized
prior response or caller-supplied identity is never adopted. Merge forwards its
own live exclusion context; the observer validates it and does not reacquire the
lock.

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

Forge closeout authenticates candidate and publication mechanics only. One
closeout-chain owner (`authenticateWkCloseoutChain`, over the pure
`authenticateWkCloseoutProjection`) authenticates the `C -> K -> D` chain that
forge handoff prepares before publication and that handoff retry and forge merge
recognize; it requires no terminal-review unit, review completion, or
review-specific commit content. The closing implementation slice may carry the
`integrated_delivery_sha` the integration record write added: the commit the
integration installed on the WK ref, which after a replay is not the original
delivery. The projection admits that value only when it equals the expectation
its caller established for that slice from the integration authority's producer
proof (see Producer-authenticated integrated-delivery evidence below), bound to
`C`'s own record as the historical contract and to the proof's WK tip being the
candidate's selected `W`. That authenticated integration transition (slice
`done` with the installed commit) closes the slice on its own, so a new slice
closure is optional; a bare `done` with neither a first canonical closure nor an
authenticated delivery is not a closeout. The live field alone, a substituted
delivery SHA, or any other change to the slice refuses. Handoff preparation keeps the stable outer
`local_WK_not_authenticated_against_candidate` reason and carries the
projection's own `reason` (`integrated_delivery_unauthenticated`,
`unrelated_slice_drift`, ...) with its slice and expected/observed identities,
plus the integration authority's failure reason when it could not establish the
delivery, through the launcher refusal and the registered response under the
cause-neutral eligibility identity `agent_launch.wk_forge_handoff.eligibility_refused.v1`,
which has no supported route. Chain
authentication on retry, existing-publication observation and forge merge
re-establishes the same expectation from the candidate binding; without it the
chain is not authenticated. The producer proof needs the retained slice delivery
ref and the canonical record's recorded value; when either is gone the closeout
refuses rather than accepting the field. Review
text informs coordinator disposition but review schema, receipts, provenance,
history, and formal-attestation availability grant no candidate or forge authority
and cannot veto publication. Formal attestations retain their narrow admission
consumer semantics. Historical `review_provenance` fields remain parseable archival
bytes only.

After a terminal findings action finishes, `workspace_agent_run_status` may
carry the advisory `closeout_continuation` stage `forge_handoff_ready`. It is
projected from the backend terminal-candidate publication owner alone: the WK's
retained designated terminal review unit must equal the observed subject, and the
owner must re-verify the candidate objects, private checkout, and a `selected`
version decision. The projection names `workspace_wk_forge_handoff
{assigned_unit}` as `current_safe_call` with `decision_required: true` and
`decision_reason: "terminal_review_disposition_outstanding"`, because the
coordinator dispositions the actual review response. Findings, run outcome, and
schema adherence neither produce nor suppress it. The first ordered step,
`terminal_whole_wk_review`, is `complete` only when the observed action's
launcher-bound material was exactly the current candidate `C` against its base `B`
and a review response was captured; an explicit SHA range on the same subject,
other material, or a failed action reports `not_established`. That label comes
from a bounded, non-serialized observation of the action's own retained review
input, is process-local like the run itself, and never gates or grants the forge
call. An unpublished, superseded,
foreign, or unauthenticated candidate, or a failed re-verification, projects no
forge call. The projection performs no handoff, recovery, or ref movement, and
forge authenticates its complete input again before any effect. work record retains candidate and forge ownership, work record retains landed
publication identity, work record retains recovery ownership, and forge remains the
sole merge-readiness boundary. Findings remain advisory under decision and
decision.

The terminal-review contract binding has one pure owner:
`packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs`. It alone
defines, validates, canonically serializes, digests, and compares
`agent_launch.terminal_review_contract_binding.v1`, which identifies the designated
terminal-review unit for the review consumer. It is not part of any candidate and
no candidate construction, reconstruction, recovery or publication consumes it.
Forge's work-record closeout comparisons use wiki-core's canonical source digest,
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
candidate lifecycle decision, and forge evidence, so a later reviewer dispatch
refuses until a current candidate exists; the old immutable candidate remains
readable only as historical evidence.

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
field, a SHA-shaped string, caller input, a copied object, or review output.
Advisory reviews produce no receipt and grant no delivery authority. The
integration authority owner authenticates the transition from implementation-owned
integration evidence written by
`packages/agent-launch-cli/src/lib/slice-integration-delivery.mjs` and re-reads
every fact on each decision. The proof binds:

- the exact repository and canonical WK ref;
- the addressed same-record implementation dependency and its canonical
  `/slices/<index>/integrated_delivery_sha` path, compared between the terminal
  lifecycle's historical parent contract and the live canonical projection;
- change kind `add` or `replace`, limited to historical absence or `null` becoming
  one exact integrated commit;
- the launcher delivery retained on the exact slice ref and its authenticated
  sole-parent base, matched to the integrated commit by identity, by exact
  message and delta for a replayed delivery, or by exact zero-delta evidence;
- reachability of the integrated commit from the exact current `W`, and a
  re-observation of `W`, the retained slice ref, and the live canonical projection;
- the producer module and proof schema, plus the failure consequence when any
  bound fact is unavailable or disagrees.

A copied or caller-shaped proof, an absent or moved retained slice delivery, a
foreign or already-integrated historical value, a delivery or base that does not
match the integrated commit, an integrated commit unreachable from current `W`, or
any fact that moves during authentication cannot authenticate the transition.

The positive decision reports `integrated_delivery: producer_authenticated` only
for that exact evidence. Without an authenticated transition, a delivery-field
difference refuses as `integrated_delivery_receipt_required`. Integration evidence
that fails authentication refuses as `integrated_delivery_receipt_unauthenticated`;
wrong dependency, path, and value bindings use
`integrated_delivery_dependency_identity_mismatch`,
`integrated_delivery_canonical_path_mismatch`, and
`integrated_delivery_transition_mismatch` respectively. More than one distinct
authenticated delivery identity refuses as
`integrated_delivery_producer_receipt_ambiguous`. Changed executable or dependency
authority refuses as `executable_or_dependency_authority_changed`, and other
unexplained authored bytes refuse as `canonical_authored_bytes_unauthenticated`.

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
returned `next_call`, including `version_lifecycle.next_call` and
`review_consumer.next_call`, and neither derives nor overrides it. A reviewer
continuation appears only in the advisory `review_consumer` projection and is
exactly `workspace_agent_dispatch {role: "reviewer", subject: <terminal review
subject>}`, the same subject-addressed request the post-worker lifecycle
advertises; a stale or absent candidate advertises no reviewer dispatch. When `repo` is
omitted, continuations omit it as well, so default-repository behavior is not
pinned. Candidate/ref/CAS/authorization identity remains launcher-owned and is
unchanged by this transport projection.

### Review-independent candidate status and advance

`workspace_terminal_review_candidate_status` decides candidate state only from
durable candidate facts: the canonical WK identity, the authenticated exact-W
controlled generation, the durable candidate/fork/WK refs, the candidate's own
metadata and record blob, and its durable version refs. Review designation,
review-unit status, review results, review-contract identity, and retained
reviewer context never select or veto a state. The states are
`candidate_absent`, `candidate_identity_invalid_or_moved`, `candidate_stale_w`
(the only state that advertises advance), and `candidate_healthy` with a
`selected` `version_lifecycle`; an unselected durable version is
`candidate_identity_invalid_or_moved` with cause `candidate_version_<state>`.
Status is read-only. A healthy candidate at current `W` is authenticated through
the same read-only existing-candidate owner cold recovery uses
(`authenticateExistingTerminalCandidate`).

The independent review consumer is reported only as the advisory
`review_consumer` projection of a healthy candidate: `null` when no terminal
review unit is designated, otherwise its subject, a `lifecycle` of `admissible`,
`inadmissible` (for example `ambiguous_terminal_review_coordination`), or
`authored_contract_divergent`, and the paged `divergence` that `continuation`
addresses. That projection is computed after, and never feeds, candidate state.

`workspace_terminal_review_candidate_advance` keeps its explicit, owner-
authenticated snapshot under the per-WK exclusion, expected-old CAS on the exact
observed candidate, generation rechecks, and immutable prior versions. A WK
without any review unit observes a stale `W` and advances through the same
owners.

When the backend's advance exclusion refuses, the route returns
`agent_launch.terminal_candidate.exclusion_refused.v1` with the backend's closed
`reason`. The possible reasons are `invalid_arguments`, `candidate_not_stale_w`,
`repository_root_unavailable`, and `candidate_not_stale_w_inside_exclusion`.
For the two not-stale reasons, `recovery` is `observe_candidate_status` and
`next_call` is the read-only `workspace_terminal_review_candidate_status` for the
same WK, including `repo` when the request supplied one. For the other two
reasons, `recovery` is `unavailable` and `next_call` is `null`. The reason and
continuation come from the backend owner's private identity lookup
(`projectTerminalCandidateExclusionRefusal`), not from the thrown value's `code`
or `reason`. A copied, inherited, or proxied refusal therefore publishes only
the four-field generic refusal. Advance is not a recovery route for absent,
invalid, or stale-generation candidates, and the exclusion, stale-W checks,
generation authentication, and candidate construction are unchanged.

### Direct-to-main review

An operator-authorized direct-to-main lifecycle does not use terminal-candidate
status, terminal-candidate advance, forge handoff, external review, or shell
review. The operator first commits the exact scoped implementation candidate.
The coordinator then calls the same registered `workspace_agent_dispatch`
reviewer route with the canonical WK or review-slice `subject` and the landed
commit's complete `diff_base_sha` and `reviewed_sha`. The reviewer is read-only
and never creates Git objects.

### Terminal advisory review execution

Each terminal reviewer dispatch is one independent advisory action. An accepted
call resolves its material once through the published-candidate selection above,
materializes a fresh action-private read-only checkout of `C`, invokes the
selected family executor once with the launcher-built advisory review input, and
settles its own run and monitor. Another explicit dispatch repeats selection,
authentication, materialization, and execution. No earlier action, retained
context, or review result is reused, and status observations launch nothing.

The advisory review input carries role, subject, repository, `base_sha`,
`reviewed_sha`, reviewed tree, the private checkout root, the rendered review
brief with the parent and selected-unit contracts and acceptance, tool profile,
and any launcher-selected formal result contract. It carries no readiness, frozen
review target, dependency mount, per-attempt execution contract, or candidate
validation evidence. Existing explicit verification results retain their own
candidate, population, generation, provider, and attempt bindings; candidate
preparation and recovery neither produce nor replay them. They are not transported
to reviewers, and review output never becomes validation evidence.

Authentication precedes execution. Selection refuses before any run, monitor,
materialization, or executor call when publication, cold recovery,
controlled-generation authentication at `W`, the lifecycle-difference decision, or
selection agreement fails. Recovery failures publish only the recovery verdict
through the closed candidate failure projection: a typed candidate code such as
`candidate_invalid`, `input_moved`, or `controlled_generation_stale` when the
current controlled generation is not persisted in `W`, or the fixed unknown-cause
projection for any unrecognized or untrusted exception. The reviewed material is
the immutable selected `C`. Canonical movement after selection affects the next
dispatch, not the running action. There is no terminal-review spawn barrier,
retained per-attempt execution contract, or pre-spawn coordination refusal.

A selection refusal is not a candidate defect. Unchanged `C/B/W` remain valid, and
no ref, checkout, or historical contract is mutated. Standalone findings-only
reviewers and redteam units select their own material and reach none of this.

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
allows a confined client to exchange MCP bytes. Confined Claude and Codex both
use the decision local socket adapter. The managed composition gate probes the
on-disk producer before conduit construction; each authenticated connection
then supplies its own running server's registration evidence.

No host MCP server generation exists until an MCP command invocation
authenticates. Before confined-child spawn, the launcher proves that the private
listener is armed, the endpoint and token file are projected, the connector and
interpreter are descriptor-pinned, the
admission window is open, and exactly-once settlement supervision is installed.
After a connection authenticates, the launcher reserves and starts one host
wiki-MCP generation with its stdio mechanically wired, then verifies that
generation's `wiki-mcp-launcher-readiness.v2` registration. The connector is
still blocked from reading its stdin and the host does not read or forward
client MCP bytes. Only a matching, well-formed generation authorizes the fixed
admission acknowledgement; MCP forwarding begins after that acknowledgement.
Each later overlapping connection repeats the same per-generation check.

Listener or projection failure before confined-child spawn is the same
launch-admission refusal. Authentication rejection creates no
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
termination, admission shutdown, per-generation host-server reap, endpoint and
credential retirement, private-directory removal, and descriptor disposal settle
exactly once; child exit, cancellation, the executors, and the terminal probe
projection all await that same settlement,
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
consumer, so every review-result projection of the run agrees. A reviewer verdict is usable when either the ordinary
succeeded-reviewer rules hold, or ALL of: the role is exactly `reviewer`; the run
is terminal with aggregate status `failed`; the run carries the validated
cleanup-only conduit disposition; the preserved child exit is code `0` with no
signal; and the preserved final result carries a schema-valid
`agent-role-result.v1` bound to that exact run's role and subject.

In the cleanup-only case the verdict remains available in that run's settled
advisory result while the aggregate run status stays `failed`. No receipt is
published. Each review is observed independently by run id and monitor handle. Clean and findings-bearing
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
verification population also feeds terminal-candidate execution and
`workspace_verify_proof`; no public route executes a declared node_test target
directly. Consumers retain their own confinement and role
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

Logs, results, and provenance are optional action-local audit evidence; advisory
reviews publish no receipt. They may describe the exact subject, committed
SHA/tree, diff base, role, run, monitor, and terminal disposition, but no result
set or latest-result projection has dispatch, admission, completion, integration,
or veto authority.

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
call binds the designated review unit, the published terminal candidate and its
base, WK ref and SHA, canonical WK digest, and current controlled generation, and
reviews a fresh action-private checkout of that candidate. A fresh call for unchanged inputs still launches a new
action; no durable store recovers, resumes, replaces, or returns an earlier
action after the process-local registry is gone.

## Exact-slice review-surface state budget

No managed post-worker route invokes slice-review preparation; this section is
the contract of the preparation primitive for its direct callers.
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

The additive field is published by the `workspace_agent_run_status` catch seam
through one re-gate against the frozen 15-member vocabulary, so a widened producer
cannot widen what is published. The managed post-worker lifecycle does not run
slice-review preparation and therefore never carries this field on
`slice_lifecycle`. Carrying the diagnostic never promotes a run, and a refusal is
never rewritten into success, finalization, or an automatic retry.

## Terminal-review audit evidence

A terminal whole-WK findings action is independent. Its log, result, and
provenance, when captured, are optional evidence about only that action, and it
publishes no receipt. Capture failure does not change the action's result and
cannot prevent a later terminal findings dispatch. No result or provenance record
elects, replays, resumes, replaces, or settles a later findings action.

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
empty-scope immutable snapshot action. It does not advance a persistent
terminal/WK lifecycle, move the WK ref, or publish a candidate. Its immutable
review source is the launcher-published terminal candidate selected as described
in [Terminal candidates select material](#terminal-candidates-select-material-not-review-execution).
The WK ref remains unchanged, and the call binds the candidate's authenticated
generation and bytes for that call alone.

Terminal-candidate construction and forge coordination remain implementation
lifecycle owners. They supply the selected candidate object but grant the
findings action no provisioning authority, and caller-supplied locators cannot
select a candidate.
Every accepted terminal findings call creates a fresh run, monitor, source
carrier, and private materialization. Prior runs, receipts, results, failures,
roles, or metadata cannot select, satisfy, suppress, resume, replace, veto, or
refuse another terminal findings call. Observation is process-local; an old
handle may be unknown after restart. Logs, results, and provenance are optional
action-local audit evidence, no receipt is published, and capture failure cannot
block a later dispatch. Implementation candidate construction, integration, CAS, and
forge behavior remain independently owned and unchanged.
