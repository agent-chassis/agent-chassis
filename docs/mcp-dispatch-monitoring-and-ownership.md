# MCP dispatch monitoring and ownership

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
monitor-route terminality, the wiki-MCP boundary, and trusted operation
ownership. The dispatch-readiness generated write surface keeps its canonical
text on the entry page; see the pointer at the end of this page.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md).

## Monitor-route terminality and lifecycle side effects

The monitor routes are not read-only for a managed exact-slice worker run. The
post-worker lifecycle is driven by polling: every `workspace_agent_run_status`
and `workspace_agent_run_wait` call on such a run advances the same lifecycle,
which observes the durable exact-slice `review` state, prepares the slice-review
surface, performs later canonical lifecycle writes, and mutates integration refs
through the trusted runtime. It neither mints nor repairs the commit-time
implementation-to-review transition. Callers must treat both routes as
state-advancing, not as pure reads.

Public terminality therefore splits in two. `terminal` is true only when the
complete managed run is finalized — the child terminated and its post-worker
lifecycle reached the `finalized` phase. `child_terminal` reports only that the
dispatched child process ended, and can never make an unresolved
pre-integration or awaiting-review run look final. Child completion evidence
(`status`, `exit`, `final_result`, `review_result`) describes the child and does
not contradict `terminal:false`.

An unresolved run carries a `lifecycle_resolution` projection with the exact
lifecycle phase, `integration_complete:false`, the latest retained typed
failure, bounded attempt metadata, and an actionable next step; a transient
failure is retained across polls and the retained history is a fixed-size ring
whose latest entry always survives. `workspace_agent_run_wait` bounds the whole
call by the caller's `timeout_ms`: after the child exits it keeps waiting on the
same deadline for the lifecycle to finalize, and returns promptly — with that
exact lifecycle action as `next_action` rather than the generic retry string —
when the lifecycle is blocked on an action polling cannot perform. A finalized run replays a byte-stable
terminal projection on both routes. This projection is monitoring vocabulary
only: it grants no authority and does not change review, integration, or
candidate semantics. Full field-by-field meanings are in
[MCP operation reference](mcp-operation-reference.md#managed-run-terminal-semantics).

## Wiki-MCP boundary

See [MCP integration](mcp-integration.md). One host wiki-MCP process directly
terminates two named FIFOs bound into the client's bubblewrap namespace. The
client uses a pinned copy-only relay and completes initialize plus tools/list
against the exact role tool profile. No executable MCP runtime is mounted into
the sandbox.

Candidate validation is launcher-owned and executes inside a findings-only
reviewer bwrap composition. Its child process starts from an empty,
fixed, secret-free environment with fresh private `HOME`, `XDG_CONFIG_HOME`, and
`TMPDIR`. When a dependency projection is available it sees ordinary project
dependencies through a read-only mount, and workspace links resolve against the
exact reviewed checkout rather than another worktree. No
dependency installation or copying occurs, and no wiki-MCP package,
interpreter tree, server, broker, listener, or transport is added to the
candidate checkout or bubblewrap namespace.

Project dependencies and project-test execution are optional capabilities of the
terminal cycle. Missing, stale, incompatible, or entirely absent project
dependencies affect only whether declared project tests can execute; they never
refuse exact terminal reviewer launch, lifecycle continuation, or forge handoff.
There is no candidate-versus-installed-dependency comparison anywhere in candidate
validity: no manifest byte equality, no lockfile equality, no workspace-manifest
equality, no install-marker equality or freshness, no dependency-root freshness, and
no requirement that a projection or a project-test command be available. A candidate
whose `package.json`, lockfile, or workspace manifest differs from the landing
checkout is the ordinary result of a WK that touched dependencies, and it is exactly
as valid as one that matches. A declared validation target that is absent from the
candidate, or not a runnable Node file, is recorded as unavailable on the advisory
evidence rather than refused. Reviewer launch with no dependency projection binds no
dependency source at all and never substitutes the mutable landing checkout's
`node_modules`; lifecycle continuation likewise requires no validation evidence, no
successful project test, and no installed dependency tree. Under `decision` and
`decision` this layer renders no admissibility, eligibility, readiness,
review-required, test-required, quality, mergeability, or publication judgment, and
the configured CCE contract is unchanged by any of the above.

When a projection *is* selected, its mount safety is mechanical and mandatory.
Reviewer dependency projections are immutable, physically
verified, atomically published, and restart-safe. Their identity binds the
normalized projection base and exact reviewed checkout to a digest of the complete
projected dependency-entry plan — the exact set of sources the mount exposes, which
names a mount rather than judging dependency compatibility. Construction occurs in a
private sibling
directory; the launcher rechecks the entry plan, makes the projection
read-only, syncs its metadata and directory, then publishes it by atomic rename.
Concurrent builders either publish that same content-addressed generation or
verify and reuse the winner.

Directory presence alone is never projection authority. Every reuse verifies
the closed identity metadata, exact entry set, entry types and link targets,
read-only modes, and a fresh installation snapshot. A legacy stale directory is
ignored, an interrupted private build is never mounted, and an invalid partial
published generation is atomically quarantined and rebuilt without deleting
canonical dependencies or other valid generations. If installation state moves
during construction or verification, the launcher retries against the new
digest; when it cannot obtain a stable snapshot, or the dependency path is
redirected or unavailable, no projection is selected and the cycle proceeds without
a dependency mount. Declining to mount an untrusted or unstable source is strictly
narrower than mounting it, so failing safe here removes no protection. Immediately
before every spawn, a selected mount's exact source path, real path, read-only mode,
and closed identity metadata are rechecked against the recorded projection identity;
a swapped, writable, or redirected mount refuses.

A selected projection is mounted read-only at the exact `<candidate-checkout>/node_modules`
path. Because that checkout is read-only inside the reviewer sandbox, the shared
launch planner materializes exactly that empty untracked mountpoint before
confinement, pins its path, directory type, and filesystem identity, and
re-checks them immediately before spawn for both Codex and Claude. A symlinked,
redirected, non-directory, non-empty, tracked, preexisting-untrusted, type- or
identity-swapped destination, or a writable/runtime bind overlapping the
checkout, mountpoint, or dependency source, refuses before spawn. The mountpoint
is the only permitted checkout addition, and it is created only when a projection was
actually selected; the candidate commit, tree, tracked
state, refs, index, Git metadata, and projected dependency contents remain
byte-identical, and neither the checkout nor the dependency source is made
writable. With no projection selected the checkout gains no addition at all.

## Trusted operation ownership

| Operation | Owner |
| --- | --- |
| `start_launch` | launcher runtime, in-process |
| `probe_run` | launcher runtime, in-process |
| `provision_worktree` | launcher runtime, in-process |
| `prepare_slice_review_surface` | launcher runtime, in-process |
| `integrate_slice` | launcher runtime, in-process |
| `prepare_terminal_candidate` | launcher runtime, in-process |
| `validate_terminal_candidate` | launcher runtime, host-side and in-process |
| `bind_terminal_candidate_review` | launcher runtime, in-process |
| `commit_slice` | host wiki-MCP server, in-process and closed-input |
| `wk_forge_handoff` | launcher-owned host executor, invoked in-process |

Every failure is returned in the structured dispatch or runtime-blocker
taxonomy. There is no compatibility route to another process boundary.

`wk_forge_handoff` receives only backend-resolved exact candidate state plus
exact-candidate-bound advisory review evidence. Clean output does not authorize
publication, findings do not veto it, and missing or mixed review output does not
decide the boundary. The orchestrator request is also non-authorizing. CCE alone
decides a configured organization-policy gate bound to exact `C/B/W`; missing,
unavailable, malformed, unratified, denied, or target-mismatched CCE evidence
fails closed. Paid-tier presence alone configures no gate. With no configured
gate, decision free-substrate publication proceeds with an explicit non-audit
posture. The host publishes exact `C` against the configured base branch without
merge-base calculation, merge-tree, commit-tree, replay, rebase, squash, amend, or
other reconstruction; it does not require `C`'s parent to equal the current
base-branch tip and does not preflight or locally resolve merge conflicts. The
exact remote candidate branch is observed around publication as forge transport
integrity. Movement of the current landing after `C` was constructed neither
changes `C`'s frozen base parent `B` nor blocks publication; git/forge and the
configured merge actor own merge readiness, so a conflicting or unmergeable PR is
still a successfully handed-off exact candidate. Absent candidate
branches may be created, exact branches reused, and differing branch targets are
reported as transport disagreement. Handoff observes the exact
repository/base/head proposal set and creates at most one pull request when none
exists, recovering a single exact open or already-merged proposal without
duplication; an ambiguous, identity-mismatched, closed-unmerged, or unobservable
proposal state refuses. Mergeability is never a local veto — an exact open but
conflicting or unmergeable proposal is still a successful handoff — and merging,
approval, rebasing, branch updating, and conflict resolution remain with the
configured forge and human merge actor. The
operation does not merge.

Loss of process memory, a monitor handle, or a prior in-memory binding does not
invalidate the terminal cycle. On restart, trusted runtime first reads exactly the
fixed `refs/agent-launch/terminal-current-v2/<WK>` ref. When present, it
mechanically verifies the target. Immutable `C` metadata binds repository
identity, the base `B`, `W`, the canonical contract digest, expected tree, and
sole parent. Recovery hashes the complete deterministic commit bytes in the
repository object format and compares that identity with the current-ref target
while `W` remains unchanged. Current landing movement is not candidate movement
and is never consulted: frozen `B` comes from `C`'s verified sole parent (the
candidate's `Base:` metadata line), never from current landing or a computed merge
base. Present-ref recovery does not invoke `commit-tree`, create an object, move a
ref, or compare current WK status, dependencies, or record bytes with the frozen
contract. A v1 candidate — whose message marker and landing parent differ — fails
the v2 metadata reader and is never recovered as a valid v2 candidate.

An absent fixed current ref means no candidate is currently published for this WK.
It does not mean the WK has no durable identity. The launcher mints
`refs/agent-launch/wk-forks/<initiative>/<WK>` when the persistent WK is allocated
and never moves it, and `refs/heads/wk/<initiative>/<WK>` accumulates the WK. When
BOTH survive, cold recovery RECONSTRUCTS the exact candidate the launcher owes,
from durable authority alone: `B` comes only from the fork ref and `W` only from
the WK ref, each observed as one exact direct commit-valued ref. A symbolic ref,
peeling or revision-expression resolution, an ambiguous or malformed observation,
a non-commit, zero-width, or wrong-width target, a Git fault, and movement or
deletion of either ref all refuse. `merge-base --is-ancestor` may PROVE the
observed `B` is an ancestor of `W`; it never selects one. Current landing, a
merge-base selection, the reflog, caller input, monitor memory, historical
candidate refs, and prior process state never participate, and when either durable
ref is absent there is nothing to reconstruct from and recovery keeps its stable
`terminal_candidate_recovery_current_ref_absent` verdict rather than guessing a
base. This is deterministic reconstruction of an exact candidate, not an operator,
manual, or out-of-band publication route.

The designated `terminal_whole_wk` review unit is coordination authority and may
have been added to the canonical record AFTER `W`, so a reconstruction resolves the
initiative and that unit from the CURRENT canonical validated work record and never
requires the unit — or the work-record blob itself — to exist in `tree(W)`. Product
identity is unchanged: `tree(C) === tree(W)` and `C`'s sole parent is `B`.

A reconstructed candidate is an explicitly versioned
`agent_launch.terminal_wk_candidate.v3` object. The established v2 `Contract:`
meaning — the digest of the record blob inside the candidate's own tree — is not
reinterpreted; a v3 candidate instead names its binding in its own immutable
`Review-Unit:` and `Review-Contract:` fields, which bind the addressed review unit
and that unit's authored review contract. The two metadata blocks are mutually
exclusive, so an already-valid v2 candidate keeps its bytes, its version, and its
read-only recovery, and no candidate is ever read under the other version's
meaning. A v3 recovery re-observes both durable refs, and refuses when the
canonical record designates a different terminal review unit than `C` committed
to; the bound contract digest stays immutable historical evidence and is not
re-compared against live coordination state, so the authenticated `todo -> review`
movement of the bound unit still recovers.

Publication uses one `git --no-replace-objects update-ref --no-deref --stdin`
transaction: it verifies the captured durable bindings and then either creates the
fixed ref with `create <fixed> <C>` when it was absent or advances it with
`update <fixed> <C> <expected-old>` when it existed. Repository identity, both
durable refs, `tree(W)`, and the projected review contract are re-authenticated
immediately before publication. A reconstructed candidate uses the create form,
so a byte-identical concurrent winner for the same complete tuple converges and any
different winner refuses without being clobbered. An object created before a lost
or refused CAS is left unreachable and inert; a refusal moves no ref, mutates no
lifecycle or WK state, and creates no reviewer, executor, run, or monitor identity.

The review unit a reconstruction returns carries its honest provenance,
`contract_source: "canonical_current_record"`, because it was projected from the
current canonical record rather than from the candidate's own tree. Forge handoff
consumes only the exact candidate binding and materialization, so a reconstructed
candidate is publishable. Terminal REVIEWER admission also accepts that
provenance, and the permission comes from the ALREADY-AUTHENTICATED binding, never
from the unit: such a unit is admitted only when the candidate binding is a frozen
v3 binding carrying both immutable `Review-Unit:`/`Review-Contract:` values, and
the unit's subject, record, and slice reproduce that binding's review subject. It
is not historical evidence and none is fabricated for it, so the attempt is
authenticated against LIVE canonical coordination alone, with no lifecycle delta,
at both routing and the synchronous pre-spawn recheck. Everything else still fails
closed pre-spawn with `historical_review_evidence_is_not_launcher_owned`, leaving
`C` intact: a `review_unit` whose contracts are not launcher-owned strings, and any
candidate without that v3 binding — including every v2 candidate, whose evidence
must still be stamped `exact_candidate_tree`.

The hot post-worker lifecycle, which holds the WK identity binding's `base_sha`,
remains the constructor of a new candidate during the normal cycle: it freezes `B`
and `W`, deterministically constructs `C`, and creates or advances the fixed ref
with expected-old CAS (covering the first candidate cycle and the
restart-before-CAS path). Legacy per-candidate refs are never read, enumerated,
counted, ranked, validated, migrated, preserved, or interpreted. Any number may
remain physically present without affecting construction, review, restart, or
publication.

Construction snapshots the fixed ref's exact old value before materializing `C`,
then publishes through one `git --no-replace-objects update-ref --no-deref
--stdin` transaction. The transaction verifies the captured durable `W` binding
(`verify <wk_ref> <W>`; v3 also verifies the captured base binding) and publishes
the fixed ref in the matching form: when the candidate ref was absent, `create
<fixed> <C>`; when it existed, `update <fixed> <C> <expected-old>`. Same-input
races converge on the same deterministic object; different-input races have one
CAS winner. A crash before CAS leaves only an inert object, and a crash after CAS
is recovered from the fixed ref. If `W` advances, the next cycle constructs a new
candidate, CAS-replaces the fixed ref, and binds validation and review to that new
SHA. Evidence for the prior SHA remains advisory and does not carry forward.

The fixed ref selects the exact commit an operation addresses; it is not an
authorization state. Ref membership, candidate history, review output, validation
results, WK or slice status, dependency state, landing movement, and forge state
are not local admission or veto authority. CCE alone owns configured policy, and
the configured forge and human merge actor own proposal and merge state.

The same role-neutral reconstruction is terminal-reviewer restart admission.
Before selecting any generic findings-only route, the backend resolves the one
canonical `terminal_whole_wk` contract unit. An existing in-memory context is
used only while its exact candidate, checkout, and canonical contract still verify,
and while any mount it selected retains its pinned read-only identity. Dependency
state is not re-derived and compared against the frozen context: a dependency tree
that moved, went stale, or disappeared since the context was frozen cannot
invalidate the exact candidate or refuse reviewer launch. If that context is
absent or invalid, launcher-owned recovery re-verifies the durable
`repository/unit/C/B/W/ref/tree/sole-parent/checkout` binding from the
existing candidate, reruns the canonical validation targets through whatever
projection is available (or none), and binds the reviewer to the private detached
candidate checkout with
`B..C` as its only review range and no repository write authority. A normally
absent fixed ref is the reconstruction trigger here as well, not a fail-closed
condition: this route runs exactly the role-neutral recovery above, so it
reconstructs `C` from the two durable refs, publishes it with the create-form CAS,
and re-enters the same present-ref recovery tail, making a first cold admission and
every later one mechanically identical. It still refuses when a durable ref, the
canonical review contract, or the publication itself does not authenticate; the hot
lifecycle remains the constructor during the normal cycle.

Parent WK status does not select candidate identity, recovery authority, the
reviewer checkout, or fallback behavior. Missing process memory never permits a
canonical terminal reviewer to use `main_repo` or generic `start_launch`; any
missing, ambiguous, or disagreeing required Git fact other than normal current-ref
absence is a typed technical refusal before spawn. A genuinely standalone findings-only review unit with no terminal
candidate contract remains on its distinct generic route. Terminal reviewer and
redteam attempts remain plural and advisory: concurrent or historical attempts,
findings, and result history neither reserve the candidate nor affect recovery
admission.

## Dispatch-readiness generated write surface

Canonical text stays on the entry page: [MCP dispatch runtime contract ›
Dispatch-readiness generated write
surface](mcp-dispatch-runtime-contract.md#dispatch-readiness-generated-write-surface).
It is not restated here, so there is exactly one copy of it on this page set.
