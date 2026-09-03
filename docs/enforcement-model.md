
# Enforcement Model

This page is the durable synthesis of how the platform decides **whether a
dispatched run is enforced** and **how it fails when it is not**. It states the
load-bearing *principles*; the decision records ratify against it and the
implementation work records build to it. When a
specific mechanism count, disposition vocabulary, or file changes, this page's
principles should still hold — if they don't, the principle was wrong, not the
enumeration.

Ratification surface: `decision` / `decision` (enforcement posture + recording) and `decision` (separate
authorization from controlled execution) are the accepted boundaries
this model underlies.

Session-contract trace only: the launcher-enforced consequence is that a child
or host cannot become ready unless its launcher-minted session carrier validates
against the branded conduit authority and resolved launch facts. The sole
normative versioning, schema, canonicalization, provenance, compatibility,
cutover, and refusal specification is
[Launcher agent session contract (normative)](agent-launch-confinement-mcp-conduit.md#launcher-agent-session-contract-normative).
This page intentionally does not restate that schema.

## Scope doctrine

This document applies the canonical
[no-additional-security-profile doctrine](operating-model.md#scope-doctrine-no-additional-security-profile).
The mechanisms below record and enact role scope, repository reach, write scope,
mechanical validity, and explicit CCE policy. They do not provide a security
profile, confidentiality guarantee, least-privilege system, or harm-prevention
boundary for the agent.

The comparison point is the equivalent unmanaged-agent setup. AgentChassis aims
not to worsen its security characteristics; it does not promise to improve or
patch them. Exact namespace, mount, tool, carrier, and response behavior may have
incidental security effects, but those effects are not product guarantees.

In particular, confinement says where an agent may operate, not whether an
authorized operation is safe. An orchestrator may expose a production-database
deletion function within write scope and a worker may execute it. The run can be
scope-correct and mechanically valid while still being destructive.

**Current operational limits:**

- **Worker network egress.** The worker bubblewrap runs with `shareNet: true` (no
  `--unshare-net`) because hosted-model families (Claude, Codex) must reach their
  model API. Shell-visible network programs therefore also have outbound network.
  Network filtering is not part of this confinement contract.
- **Self-scoped policy writes are now denied at the kernel.** This limit is
  closed: see "The DEC filesystem authority boundary" below. No launcher-enforced
  bwrap namespace leaves `wiki/decisions/` mutable, whatever the coordinator
  wrote into `write_scope`.
- **Orchestrator / escalated / host sessions** are operator-trusted and outside
  the dispatched-run enforcement envelope by design.

### Initial managed implementation-worker R/W boundary

For the bounded initial managed implementation-worker tranche, `R` is the
normalized union of the canonical unit's `read_scope` and `repo_paths`; `W` is
the normalized canonical `write_scope`. The launcher freezes both sets before
launch. The worker can see exactly `R union W` repository content and can mutate
exactly `W`. Including `W` in visibility is deliberate: an authorized write
target does not also need to be duplicated in `read_scope` or `repo_paths`.

#### Which commit scope-path existence is resolved against

Freezing `R` and `W` requires deciding whether each declared path exists and what
kind of entry it is. That question has exactly one authority: **the commit the
slice worktree will be cut from, read as a Git tree.** One rule with two
branches, neither of which is a fallback for the other:

- the unit's persistent **WK branch exists** → its current tip;
- the **WK branch is absent** → the configured base tip it will be cut from,
  resolved through the same base resolution the allocator's create-fresh-off-base
  path uses.

An absent WK branch is not an error condition — it is the first slice of a new
WK, and refusing it would make every new WK permanently undispatchable. A live
working directory, caller input, `HEAD`, and a worktree path are **never** the
authority, and an unresolvable or unstable base refuses rather than reverting to
the ambient checkout. A worktree is always cut from a resolved SHA and can never
be built from uncommitted state, so the hazard this rule guards is naming the
wrong commit, not the filesystem as such.

This matters because work accumulates on a per-WK branch that the landing
checkout never sees until the WK merges. A path created by an
already-integrated prerequisite exists on the WK branch and not on landing;
resolving existence against landing refused legitimate scopes. The converse
holds too and is equally deliberate: a path that landed **after** the WK forked
is absent at the base and is refused, because the WK branch never absorbs
landing (`decision` clauses 1-2, `decision`).

Between scope freeze and slice allocation the launcher interposes a
record-snapshot commit, so the commit the worktree is cut from is a **child** of
the freeze-time commit whose only permitted tree delta is
`wiki/work-records/<WK>.json`; a foreign path in that delta fails closed. The
freeze tip and the provisioning base are therefore parent and child, never equal.

**Canonical record content and digest authority stay on landing.** The canonical
work record is read, digested, and re-checked against the landing checkout, and
an exact `wiki/work-records/<WK>.json` entry appearing in `read_scope` or
`repo_paths` resolves under that same landing record authority — it is the one file the
provisioner is about to write, hence the one path guaranteed stale at freeze
time. Every other declared path resolves at the base commit.

At the base commit, a blob is a file, a tree is a directory, and modes `120000`
(symlink) and `160000` (gitlink) are refused at both terminal and intermediate
positions. A missing entry follows the existing rules: a missing leaf is allowed
only for a writable target (or a read entry that is also a write target), and a
missing intermediate component always refuses. Wildcard semantics are unchanged
and now stated: a root-wide wildcard is refused, any wildcard in `write_scope` is
refused, and for `read_scope` / `repo_paths` only the pre-wildcard prefix is
validated.

This is a scope-freezing authority only. `inspectAuthorityPath` in the isolation
layer remains an independent second filesystem check over the checkout produced
from that same base.

The actual family command tool is available without interactive approval:
Codex receives `exec_command` and Claude receives `Bash`. Commands may inspect,
generate, format, and mutate inside the namespace. There is no read-only command
classifier or command allowlist; bubblewrap is the filesystem authority and
cannot be widened by a command. This tranche exposes no general worker MCP tools.
Delivery uses only the closed-input commit capability in the trusted
host/runtime boundary, with the server-resolved binding as its input. A managed
workspace receives a constrained, read-only projection of the launcher-resolved
worktree gitdir, object stores, refs, and required singleton Git files so ordinary
inspection commands work inside confinement. It never receives a broad bind of
the mutable common `.git` directory or Git-metadata write authority, and it does
not receive a general commit shell. Delivery and ref mutation remain trusted
host/runtime operations.

#### The launcher-owned worker declared-test capability

A managed worker's namespace is exactly `R union W` over a tmpfs skeleton and
carries no dependency tree, so it cannot execute any test whose system under test
imports a workspace package by bare specifier. Projecting dependencies **into**
the worker's namespace was tried and reverted: an unconditional dependency
precondition on the launch path took managed dispatch down repository-wide. The
supported answer is the opposite direction, and it rests on an asymmetry — the
worktree **on disk** is dense (`checkout_mode: full`), while the worker's
**namespace** is sparse.

`workspace_worker_run_declared_test` is a launcher-owned capability that runs the
unit's declared test **launcher-side**, in a separate confined process against
that dense worktree, and returns the output. The worker's own namespace is
untouched: no path is bound, mounted, stat-able, or readable inside it that was
not already, so a launcher-side runner structurally cannot leak one into it, and
the worker's mutation set stays exactly `W`.

`decision` clause 3 is the authority: a worker's baseline is extended by "a
launcher-owned capability", what the capability **confers** on the worker is
bounded by `decision` clause 2, and "what the capability itself reads or executes
is bounded by its own confinement, not the worker's." `decision` clause 4 permits
the purpose — executing a test to check your own delivery is not the
coordinator-owned acceptance validation. `decision` clause 4 covers the
dependency mount: launcher-provided non-repository runtime infrastructure is not
repository content and is not bounded by a role's repository entitlement, so it
needs no scope declaration.

What is launcher-bound, and why it has to be:

- **The unit and the worktree** resolve from the dispatched run's launcher-minted
  identity binding — the same carrier the closed-input commit capability is bound
  to — and never from caller input. The coordinator route
  (`workspace_run_validation`) takes a caller-supplied unit address and resolves
  its workspace from server config; reusing that path here would let a worker
  select targets from any record's `allowed[]` and run them against the landing
  checkout. A caller-supplied unit, record, repository, workspace, worktree, cwd,
  base, or target set is **refused**, not silently overridden by the bound value.
- **The targets** come from the bound unit's exact
  `acceptance.validation[]` declarations shaped as
  `{operation: "node_test", target, verification_ids}`.
  They are neither derived from `write_scope` nor auto-discovered, and an
  undeclared target refuses rather than widening to something broader.
- Plain validation strings and `{note, verification_ids}` objects are inert
  notes and never authorize targets. **The argv, node binary, cwd, env, timeout,
  and output bounds** are launcher
  facts. No arbitrary command string, argv, environment, or working directory is
  accepted from any source.

Confinement of the run: the repository is mounted **read-only with no writable
`W`**, secrets are masked, the network is denied, the environment is
launcher-minted and clean, and the **only** writable location is an ephemeral
tmpfs `TMPDIR` outside the repository. The read-only repository bind is the
intended final posture rather than a gap — it makes it structurally impossible
for a test byproduct to land inside the write scope, be staged by the delivery
`add -A`, and ship silently in the worker's delivery commit.

The dependency mount is **fail-soft**. A managed worktree has no `node_modules`
(it is gitignored), so a launcher-owned, read-only, identity-pinned mount is what
makes a bare-specifier workspace import resolve at all; it reuses the reviewer
projection mechanism, including the host-side creation of the mount destination
that bubblewrap cannot create inside a read-only bind. An unavailable, stale, or
mismatched dependency tree **degrades that run and is recorded as advisory
evidence**. It never refuses a dispatch.

The result carries no admission, review, or closure authority, adds no admission
metric, and neither satisfies the mandatory findings-only review nor authorizes
integration. Output retains the head **and** the tail of each stream so a failing
assertion's diagnostics survive a chatty passing run; the elided middle is
byte-accounted rather than silently dropped.

Every family/backend path claimed as supported must enact this same binding.
Unsupported families, backends, scope shapes, or confinement capabilities fail
closed rather than plain-spawning or widening visibility. The initial bootstrap
posture preserves readable launcher-provided Codex auth/sourceHome and
`shareNet=true` model-API egress as explicit operator-accepted residual risks
under prompt governance. It does not add or imply a digest-bound or per-dispatch
mechanical risk-acceptance gate.

### Role-visibility split: worker R∪W vs findings-role full-repo read

The repository-visibility contract differs by role, and each role's read root is
derived from **role policy**, never composed from the subject unit:

- **Implementation worker — exactly `R union W`, writes only `W`.** As above:
  the launcher freezes `R` and `W` from the canonical unit and the bwrap
  namespace binds only those entries; everything else is absent (decision
  clause 2). The controlled-contract private family is subtracted from both
  sets before projection.
- **Reviewer / redteam — the FULL repository, read-only, writes nothing.**
  Reviewer and redteam are findings-only roles whose repository READ visibility
  is the whole repository, matching orchestrator read visibility — NOT the
  `R union W` of the unit under review (decision clause 2, decision clause 2).
  Deriving a findings role's read scope from the selected WK/slice would hide the
  canonical decisions, durable docs, and undeclared sibling implementation/test
  paths a reviewer or redteam must inspect, so the read root is the repository
  itself and the selected unit can neither narrow nor widen it. The bwrap
  namespace binds the whole repository read-only and mounts nothing writable; a
  supported managed findings launch that cannot construct that read-only bwrap
  topology fails closed rather than silently narrowing or widening authority.
  Full read visibility is a read-only posture only — it grants no lifecycle,
  dispatch, commit, mutation, or host-write authority, because a confined role's
  tool surface is exactly its policy profile (decision), and the role's
  repository write surface stays empty. The full read root excludes the
  controlled-contract private family through the final launcher-owned overlay.
- **Orchestrator — the full repository read with its separate role-specific
  coordination write policy.** Unchanged by this split except for the same
  enforced private-family overlay.

Operator confinement follows the same enforced subtraction. The phrase "full
repository" in this section therefore means the role's ordinary repository
projection minus `wiki/contracts`; it never means visibility into the
controlled-contract private family.

### Controlled-contract filesystem scope exclusion

`wiki/contracts` and every descendant form a launcher-excluded filesystem family
for managed roles. "Private" in field names and older decision vocabulary is a
compatibility label; this exclusion is a scope rule, not a confidentiality
claim.
Canonical work-record validation and shaping classify exact, descendant,
ancestor, and wildcard intersections as structured policy facts and possible CCE
input. Those facts are not local refusal authority under decision. The launcher
may mechanically exclude the private family from an enforced namespace, but it
does not convert an intersection into a policy refusal without an authenticated
returned CCE decision.

Every enforced bwrap plan that would otherwise show the family emits an empty
`tmpfs` overlay and then remounts it read-only after ordinary repository,
writable, runtime, Git, and secret-mask mounts. A sparse namespace in which the
family is already absent receives no visibility-adding mount. A visible path
whose canonical directory identity cannot be established refuses before spawn;
an enforced launch never degrades to a wider projection.

This scope exclusion ends at the confinement boundary. A decision direct launch
or decision-permitted plain spawn does not apply the mount. Its output reports
`filesystem_confidentiality_guaranteed=false` and
`private_repository_path_enforced=false`; those compatibility fields describe
the absence of the filesystem mechanism and do not imply that an enforced run
provides a broader confidentiality posture. Prompt instructions, role/tool
profiles, or scope declarations do not substitute for the mount.

### The DEC filesystem authority boundary

Ratifying a decision is a **human/operator** act (`decision`, `decision`). The
operator CLI is the only surface that confers or removes accepted DEC authority;
agents keep the proposed lane (create, amend, proposed→rejected) through their
role policy. That authority split is only credible if an agent cannot simply
route around the tools and write the file, so the boundary is enforced at the
layer that does not negotiate: **the kernel mount namespace**.

Every launcher-enforced bwrap namespace reimposes the canonical
`<repo>/wiki/decisions` subtree read-only as the **absolute final repository
mount overlay**. The rule is **role-neutral and launcher-derived** — it is not
selected by role, family, backend, prompt text, caller request, or ambient
environment, and there is no per-launch opt-out. Because the overlay is emitted
after the repo bind, every declared read-only bind, every writable root and
writable file, every runtime bind, the Git-identity binds, and the in-repo secret
and tmpfs masks, nothing emitted earlier can shadow it. Mount order *is* the
enforcement here: an overlay emitted anywhere but last would be silently undone
by a later overlapping writable bind.

Two properties bound what the overlay is allowed to do:

- **It subtracts write authority, never adds visibility.** The overlay is emitted
  only for a path the namespace *already showed*. If no DEC path or ancestor is
  visible, no bind is emitted at all — absent DEC authority stays absent. An exact
  declared DEC read stays exact and read-only: it never justifies a
  directory-level bind, because that would expose sibling decisions the unit was
  not authorized to see. When a subtree is deliberately masked away, the carveout
  stays silent rather than re-exposing it.
- **It preserves legitimate coordination writes.** An authorized ancestor such as
  a writable `wiki/` is *not* rejected and remains writable **outside**
  `wiki/decisions`, so orchestrator coordination writes to non-DEC wiki paths
  still land. Worker `R ∪ W` semantics are unchanged apart from the DEC
  subtraction.

A physically absent `wiki/decisions` is judged by the same rule rather than waved
through. There is nothing to reimpose, so no bind is emitted either way; but if the
final namespace still contains a **writable visible path equal to or above**
`wiki/decisions` — an authorized writable `wiki/` root, an in-repo writable runtime
bind, or a worker `W` entry at or above the subtree — the child could create the
directory and author DEC files under human-only ratification authority, with no
later overlay left to stop it. That combination refuses the launch. Absence is a
no-op only when nothing visible in the namespace could create the subtree; the
launcher never creates it, and never adds visibility, in either case.

The carveout is fail-closed: the decisions path and every bind source it uses must
be canonical, non-symlinked, and launcher-derived, and an unsafe or impossible
carveout (a symlinked or non-directory decisions path, an absent subtree a writable
visible path could still create, or a launcher mask strictly
inside the subtree) refuses the launch **before spawn** — and before any writable
host preparation — rather than degrading to a weaker boundary.

This is the kernel floor, not the only seam: structured dispatch separately
refuses a canonical `write_scope` entry equal to or beneath `wiki/decisions` with
one stable typed error before provisioning or launch, which turns a
mis-authored scope into a clear coordinator-facing refusal instead of a confusing
`EROFS` mid-run. The dispatch refusal is the ergonomic gate; the bwrap overlay is
the boundary that holds when anything upstream is wrong. Neither is duplicated
into family-specific or downstream preparation guards.

For the source-available Codex findings path this is already the bwrap enactment:
the reviewer/redteam plan binds the whole repository realpath `--ro-bind` with an
empty writable set. The Claude backend-request scope derivation resolves a
findings role's read scope to the repository root for the same reason, so no
supported reviewer/redteam launch path derives read visibility from the subject
unit.

## Product Structure

The system ships as two products over one codebase:

- **Source-available (free).** Lets people dispatch agents, write the wiki, and
  track work. It applies local scope mechanics — write-scope binding, bounded
  repository reach, and recorded enforcement-state provenance — but makes no
  remote CCE policy claim that a run was authorized.
- **Hosted governance — the Chassis Control Engine (CCE).** Owns enforcement authorization and signed attestation.

Vocabulary convention: source-available/free local prose uses
**dispatch-readiness**, **recorded review**, **containment**, and **fails-open**.
Chassis Control Engine prose owns **admission**, **authorization**,
**authority**, **signed**, **attestation**, and **enforcement guarantee**. Checked-in
schema and archival literals keep their names where the narrow formal-attestation
consumer or canonical-record compatibility requires them, including
`worker-admission-*`, `reviewer_attestation`, and `accepted_authority`. Formal
attestation may be derived and durably published only by the original
`workspace_agent_dispatch` settlement when its canonical selected contract
requests it. No review append route is exposed, and ordinary advisory review text
provides no admission authority.

Enforcement authority is **not** local refusal and **not** the recorded
enforcement state itself: that recorded state is part of the free, forkable
substrate and sells no guarantee on its own. Authority is the Chassis Control
Engine's signing service: only a genuine, granted, ratified authorization yields
an attestation the CCE tier will trust.

## The spine: authorization is not enactment

Two concerns are categorically different and owned by different components:

- **Authorization — "may this run?"** A *decision*. Owned by the Chassis Control Engine on
  the CCE tier, or **absent** on the free tier. It is a remote decision /
  attestation; it is **never minted by the local launcher**.
- **Controlled execution — "how is it bounded while it runs?"** An *enactment*.
  **Irreducibly local, because the Chassis Control Engine cannot spawn processes** (its
  client is HTTP-only; every process spawn is a local launcher site). The
  launcher can enact but must not decide; the Chassis Control Engine can decide but cannot
  enact. They are complementary **by necessity**, not by convention.

## Principles

These are the invariants. They do not depend on how many enforcement mechanisms
exist or on any particular disposition code.

**(0) Declaration governs processing.** Fail-open vs fail-closed is selected by
whether enforcement authority is **declared**, not by whether it is **granted**:

- **Confirmed no authority declared → fail OPEN.** The run proceeds and records
  `enforced=false`, honestly.
- **Authority declared → fail CLOSED unless granted.** Once a run is on the CCE
  path, every outcome short of a genuine, ratified grant is refused. A declared
  authority that cannot be substantiated — backend unreachable, unratified,
  needs-review, reject — is refused rather than reclassified as a free/local
  run. Here and throughout this document, **fail closed** means that processing
  stops when required mechanical or authenticated-policy facts are absent or
  invalid; it is not a security-safe-default claim.
  The same posture applies to the org policy-profile carrier: a confirmed,
  valid profile can be consumed on the CCE path, while a declared-but-malformed
  profile fails closed there and is inert on a confirmed free/local-only install.

**(0′) Positive-confirmation (mechanically closed on uncertainty).** Every
enforcement-relevant fact — *is authority declared?*, *was it granted?*, *was
isolation actually enforced?* — is "yes" **only on positive confirmation, read
from the canonical source at the moment it matters**. Absence, unreadability,
staleness, or ambiguity resolves to the mechanically conservative result:
refusal, `enforced=false`, or unattributed. **Fail-open requires a *confirmed*
"no authority is declared," never an inference from silence.** This preserves
the distinction between "the launcher confirmed the free posture" and "the
required declaration fact was unavailable."
The same positive-confirmation rule applies to the org policy-profile carrier:
the loader must positively confirm the launcher-minted config source, the
profile contents, the digest, and the tier posture before the CCE path can
consume it.

**(1) Consume authority, never mint it.** The right to run originates remotely
(Chassis Control Engine) or is explicitly absent (free). No local component fabricates a
positive authorization. A local surface takes authority as an **input** and emits
**evidence** as an output. (This is why a locally-minted accepted-launch seam was
removed.)

**(2) Decide ≠ enact, complementary by necessity.** See the spine above. Neither
side can do the other's job, so a single component can never be both the
authorizer and the unchecked executor.

**(3) Fail-open *is* fail-honest.** Failing open is only legitimate when the
unenforced posture is recorded truthfully and visibly. A fail-open run records
`enforced=false` and its isolation identity, and must **never** be presented,
labelled, or attested as enforced. The free product fails open; it does not fail
silent.

**(4) Launcher-sourced provenance — of the declaration *and* the result.**
Enforcement-relevant state is set by the **observer** (the launcher, from
launch facts), never asserted by the **subject** (the dispatched worker, child,
prompt, or run environment). This covers both the recorded enforcement result and
**the declaration itself**: the declaration is read from a single canonical
config source by every gating stage. A stage that reads a declaration from a derived, mutable
channel (e.g. an un-propagated `process.env`) can mis-read "declared" as "absent"
and fail open — the exact mechanical failure (0′) forbids. This origin rule
does not claim forgery resistance against a hostile same-user process.

**(5) Confinement is a closed, operator-gated set of mechanisms, recorded per
dimension.** Inside enactment, several independent mechanisms each bound a
different dimension and each record their own enforcement state. For the free /
source-available tier the **membership of this set is closed** (`decision`,
amending the earlier "open set" posture): the **sandbox mechanic** — bubblewrap
kernel binds plus secret masking, the Claude native tool-use permission gate, and
the launcher-side post-run `changed-files ⊆ write_scope` verifier (all one
launcher-owned containment family) — and **CLI command-line parameters** (the
command-surface / permission posture). Adding any *other* local enactment
mechanism to the free tier requires an explicit operator decision, recorded as a
`decision` amendment, not a silent addition. Deciding (authorization / admission /
minting / attestation) is never part of this local set — it is CCE or remote
(`decision`). The dimensions:

- what the process can **reach** (filesystem / network / env) → the sandbox.
  Structured role dispatch is backend-neutral at the contract layer: it is
  enforced only when the launcher has selected and confirmed a supported,
  enabled containment backend for that launch. Linux bubblewrap is the current
  enforced backend; future supported backends, such as Seatbelt, fit the same
  recorded-state contract. The enforcement-required posture is selected by a
  configured CCE key, not by backend availability and not
  by a service URL alone. With no CCE key, local/free structured role
  dispatch may run unenforced when no backend can be used, and records that
  loudly. With a configured CCE key, a local structured role run requires a
  working backend or refuses before plain spawn unless the operator explicitly
  opts out for that launch/configuration; that opt-out is also recorded loudly
  as unenforced.
- which **commands** the agent may invoke → `no-raw-exec` / `structured_validation`.
  This is the **advisory, layered** dimension: a command-surface restriction is only
  as strong as the containment beneath it.
- where it may **write** → write-scope. An out-of-scope write is **prevented before
  it lands** for both families — a different mechanism at a different layer, with the
  same outcome. The in-place Codex editor gets a **kernel exact-file bind**: only
  the bound `write_scope` files
  are writable, the containing directory stays read-only, so an out-of-scope write is
  impossible at the kernel. Native-edit editors that need a writable parent directory
  (Claude) get **native tool-use permissions**: the launcher mints a settings file
  that grants `Edit` only within `write_scope` (an explicit path list) and runs the
  editor in its default permission mode, so an allowed in-scope write applies with no
  prompt while any unlisted/out-of-scope write is default-denied *before it executes*.
  The settings are launcher-minted; the launch is refused if they cannot
  be minted or if a behavioral probe cannot prove the restriction is in effect), and
  are bound read-only so the worker cannot disable them; committed lower-scope editor
  settings are masked so they cannot widen the grant. Underneath, the repo stays
  read-only except the writable `write_scope` directories, and a post-run
  `changed-files ⊆ write_scope` verifier refuses an invalid delivery as the backstop. Both paths
  are default-on, not a future substrate.
- *(future dimensions — egress policy, resource/time caps, secret access — do NOT
  slot in silently: adding one to the free tier is an operator decision recorded as
  a `decision` amendment)*

`enforced` is therefore not a single global boolean: it is a **predicate over the
dimensions the CCE gate requires**. A run that is reach-enforced but
command-surface-unenforced is not fully enforced. The dimensions also **layer** —
a command-surface restriction is only as strong as the containment beneath it — so
some mechanisms presuppose others rather than standing fully independent. *How
many dimensions the CCE gate requires* is CCE-gate policy and lives outside this
free-tier substrate.

### Current per-executor boundary

The supported implementation families are **Codex** and **Claude**. Agy is
unsupported and fails closed before any model, repository-write, runtime-state,
or wiki-MCP transport setup.

All non-orchestrator worker-family bwrap launches mask repo-local launcher
secrets before the child starts: when `<workspace>/.env` exists it is shadowed by
a hard `--ro-bind /dev/null <workspace>/.env`, and the `<workspace>/.agent-launch`
subtree is shadowed by an empty in-repo tmpfs. The `.env` mask is emitted only
when the file is present: because the repo is bound read-only, bwrap cannot create
a `.env` mount point when the file is absent, so an unconditional bind crashed the
launch on a fresh repo that carries no `.env`. Skipping the bind when the file is
absent preserves the same namespace result: an absent `.env` has no mount target,
while a present `.env` is still hard-masked exactly as before. This describes the
mount mechanics only; it is not a credential-confidentiality guarantee. Worker
network behavior remains `shareNet: true` as described above.

| Executor family | What it may write | Write-scope enforcement | What is sandboxed | What is not sandboxed / known caveats | Network posture |
| --- | --- | --- | --- | --- | --- |
| Codex | The assigned implementation `write_scope` for workers; reviewer/redteam subjects must have `write_scope: []`. | The outer bubblewrap plan mounts the repo read-only, then emits exact `--bind <file> <file>` entries for file scopes and writable root binds only for directory scopes. Paths are realpath-normalized and must remain inside the repo; repo root and `.git` writable roots fail closed. Codex CLI `-s workspace-write` / `--add-dir` records directory-level intent only, so the bwrap file bind is the file-level boundary. | The dispatched child runs under bwrap with system/read-only roots, env filtered through the launcher policy, and write binds derived from canonical record state. | The Codex CLI sandbox itself is not the file-level guarantee; do not read `--add-dir` as per-file enforcement. | Worker launch shares network (`shareNet: true`) for model API access; this is the accepted worker-egress risk above. |
| Claude | The assigned implementation `write_scope` for managed workers; reviewer/redteam are read-only. | Managed workers receive exact `W` writable mounts over a sparse `R union W` namespace. `Bash` is present in `permissions.allow`, `--allowedTools`, and the capability probe, and absent from both deny layers. Native WebFetch/WebSearch and delegation/spawn tools remain denied. | The settings root is read-only, repository content visibility is exactly `R union W`, and launcher-resolved Git support is projected read-only without broadly exposing the common `.git` directory. The real host OAuth credential leaf is writable for normal implementation workers so Claude can persist token refresh; exact findings roles bind it read-only. | Legacy non-managed native-edit composition may retain directory-scoped native editing, but managed-worker shell authority comes from bwrap, not command parsing or native edit permissions. Post-run changed-path containment remains a backstop. | `shareNet: true`; shell-visible network binaries may use the shared network. Native WebFetch/WebSearch denial is not network confinement. |
| Agy | Unsupported; no repository writes. | No executor or write-scope projection is created. | No role sandbox is spawned. | No Gemini state, credential, config, or wiki-MCP transport is mounted. | No launch; fails closed. |

#### Why native-edit families use a directory bind

The write-enforcement class follows from the editor's write strategy. Claude's
editor writes atomically: it creates a
temporary sibling in the target's directory and `rename(2)`s it over the target.
`rename(2)` mutates directory entries, so it needs write+execute on the
**containing directory**, not on the file. An exact-file kernel bind — target
file writable, parent directory read-only — is therefore *structurally
incompatible* with a rename-atomic editor: the temp create or the rename fails
`EROFS` and the agent cannot edit at all. Codex can take the exact-file
bind precisely because they write in place.

So the directory-scoped writable parent is required by the editor's write
strategy — that physical constraint stands. The **file-level boundary inside that
directory is the editor's native tool-use permission gate**: the launcher mints a
settings file that grants `Edit` only within `write_scope`, and the editor runs in
its default permission mode, so an out-of-scope `Edit`/`Write` (including a sibling
file in the writable directory) is default-denied before it executes while an
in-scope write applies with no prompt. The in-place Codex editor reaches the same
write-scope outcome through the kernel exact-file bind. The layer differs — kernel
for in-place editors, native permissions for atomic-rename editors — but neither lets
an out-of-scope write land. The post-run `changed-files ⊆ write_scope` verifier is
the fail-closed backstop beneath the permission gate (on exception it fails closed; a
baseline-capture failure degrades to judging the full changed set, still fail-closed).
A genuine kernel exact-file bind for an atomic-rename editor would need a non-atomic
write mode the editor does not expose; that finer kernel-layer variant is a deferred
refinement. The layer difference is an implementation fact, not a claim that the
editor resists hostile modification of its own permission settings.

An earlier investigation concluded that the editor CLI could not enforce path-scoped
writes by itself and that a custom per-action pre-execution adapter would be required
for durable enforcement. That conclusion is **reversed**: a real headless run of the
editor confirms that its default permission mode plus a positive `Edit(<path>)`
allow-list *does* enforce path-scoped writes non-interactively — an allowed in-scope
write applies with no prompt, and an unlisted or out-of-scope write (including through
a symlink whose real path escapes the scope) is denied. So the file-level boundary is
the editor's own permission gate on the bwrap floor, not a custom hook or an
second authorization service. The write-scope enforcement path carries **no**
launcher secret and needs no per-action service.

Reproduce the spike (edit the `REPO`/`OUT` placeholders and point `CLAUDE` at the
installed editor CLI):

```sh
CLAUDE=claude
REPO=$(mktemp -d); OUT=$(mktemp -d)
mkdir -p "$REPO/inscope"
printf 'v=1\n' > "$REPO/inscope/target.txt"                 # in-scope real file
ln -s "$OUT/escape.txt" "$REPO/inscope/link.txt"            # symlink escaping the repo
printf 'v=1\n' > "$OUT/escape.txt"
cat > "$REPO/settings.json" <<JSON
{ "permissions": {
    "allow": ["Bash", "Edit(inscope/**)", "Read(//${REPO#/}/**)"],
    "deny": ["WebFetch","WebSearch","Task","Agent","Workflow","Skill","Monitor","mcp__*"],
    "disableBypassPermissionsMode": "disable" } }
JSON
cd "$REPO"
# (a) in-scope edit -> APPLIED, no prompt:
"$CLAUDE" -p --permission-mode default --settings "$REPO/settings.json" \
  "Change v=1 to v=2 in inscope/target.txt using Edit. Pre-authorized." </dev/null
# (b) symlink-escape edit -> DENIED (falls to approval, no write headless):
"$CLAUDE" -p --permission-mode default --settings "$REPO/settings.json" \
  "Change v=1 to v=2 in inscope/link.txt using Edit. Pre-authorized." </dev/null
grep -q '^v=2' "$REPO/inscope/target.txt" && echo "in-scope: APPLIED (expected)"
grep -q '^v=1' "$OUT/escape.txt"          && echo "symlink escape: DENIED (expected)"
```

Expected result: `inscope/target.txt` becomes `v=2` (the in-scope edit applies), while
the out-of-repo symlink target stays `v=1` (the escaping edit is denied). The same
settings shape grants `Bash` while denying native WebFetch/WebSearch and delegation
tools. Because the sandbox shares the model network, a shell-visible network binary
can still connect; durable proxy/network confinement is separate work.

## The declaration as a positive, default-shipped artifact

(0′) requires fail-open to key on a *confirmed* "no authority," which means the
free tier needs something positive to confirm — otherwise "no config at all"
would be uncertainty and (0′) would fail it closed, breaking the free product.

The substrate already produces this. The launcher-owned posture classifier treats
absence of a configured CCE key as a **deterministic,
named disposition**, not a null: a no-key install positively classifies itself as
a local-only, fail-open posture — the **no-key declaration** — rather than the
system *inferring* "no authority" from silence. A service URL by itself is not a
CCE-key posture signal; a configured CCE key remains the enforcement-required
credential even if the service URL is missing, malformed, or otherwise
unconfigured. Making this an explicit, default-shipped sentinel (rather than
relying on "the key is falsy") is the most auditable form: it lets a reader
distinguish "unconfigured because this is a free deployment (declared)" from
"unconfigured because the config was deleted or corrupted (→ closed)."

## Org policy-profile carrier

The worker-admission wire can carry an org policy profile, but only from the
launcher-minted durable config surface at `<workspace>/.agent-launch`. That
source is canonical; the subject, request payload, or ambient process
environment do not get to declare the profile.

The profile is all-or-nothing: it supplies the complete parameter set required
by the active ratified Node Engine pack, not a partial override file. If the
declared profile is unreadable, empty, malformed, schema-invalid, or over the
structural bound, the CCE path fails closed. On a confirmed free/local-only
install, the same malformed declaration is inert: the carrier is omitted and
the run stays usable as free.

The loader owns the digest. It validates the profile, computes the digest once
over the exact transmitted object, and the wire forwards that object and digest
without re-canonicalizing or re-digesting them. The carrier's legal shape is the
validated `parameter_values` object plus its digest and the literal
`policy_profile_authority_mode="entitlement"`.

This carrier is integrity-only, not subject-bound. The entitlement boundary sits
upstream of pack-input inspection on the CCE path: a granted, entitled request
can use the carrier; an unentitled CCE request is refused before the carrier is
examined. Free/local-only installs do not construct the CCE enforcement request,
so the carrier is naturally absent there.

## Dispatch-readiness disposition mapping

Controlled-contract authoring and query tooling continues to validate test-proof
references and report missing, duplicate, stale, cross-WK, non-test,
commandless, invalid, mixed, downgrade, and provider-incompatibility facts.
Those facts are non-authorizing evidence and possible CCE policy input under
`decision`; implementation dispatch does not validate proof semantics or apply a
local proof-completeness decision code. Managed provisioning may mechanically
attach the complete authenticated same-WK carrier population under `decision`,
but an absent population is a no-op and semantic incompleteness, staleness, or
incompatibility does not prevent exact attachment or continued dispatch. With no
configured CCE denial,
absent, incomplete, stale, unsupported, incompatible, or unavailable proof
material cannot prevent an otherwise mechanically sound dispatch. A configured
CCE may still deny from the forwarded facts, and authenticity, integrity,
identity, containment, corrupt or contradictory state, malformed input, and
runtime prerequisites actually required to execute remain mechanical refusal
boundaries.

Before any model call, dispatch-readiness applies structural
checks to the selected work record. Non-read-only dispatch is blocked when
`write_scope` is missing or empty, and when `acceptance.validation` has no
validation command; the work-record schema also requires `acceptance.criteria`
and `acceptance.validation` to be present arrays. Portfolio then forwards the
measured LOC, breadth, and bounded-edit facts. On the CCE-bound path, the active
org policy / ratified Node Engine pack alone applies the review-band,
hard-reject, and small-edit thresholds and returns the admissibility verdict;
Portfolio renders no independent threshold judgment (`decision`, `decision`).

For a file in the active org-policy review band, `decision` preserves two
authorization paths: a bounded edit within the active small-edit budget may
self-attest, while a larger edit requires trusted review-attestation. A file at
or above the active hard-reject threshold must be refactored or split before it
can be admitted. These policy judgments are real gates on the CCE-bound path,
but they are not semantic proof: dispatch-readiness does not verify that the
coordinator chose the minimal possible scope or that the validation commands
are meaningful. On a confirmed free/local-only install, admissibility is inert
and the measured facts remain evidence rather than a local verdict.

Applying (0)/(0′) to the worker-admission remote gate, the two "no remote" codes
are **opposite** and must not be lumped together:

| Gate code | Meaning | Posture |
| --- | --- | --- |
| `remote_enforcement_local_only` | trusted launcher/runtime boundary authenticated that no CCE request or backing exists and every authority carrier is intentionally undeclared | **fail OPEN**, record `enforced=false` |
| `remote_enforcement_absent` | **no result artifact at all** — classification never ran | **fail CLOSED** (uncertainty, not a confirmed declaration) |
| `remote_admit` (pack-backed, NE-backed, **ratified**) | declared **and** granted | run, `enforced=true` |
| `remote_admit_unratified` | declared, bound to unratified placeholder | **fail CLOSED** |
| `remote_needs_review` / `remote_reject` | declared; NE withheld the grant | **fail CLOSED** |
| `remote_enforcement_unavailable` | declared; backend transport / auth / entitlement failure | **fail CLOSED** (a down CCE backend degrades closed) |
| `local_refusal_preserved` | a structural / safety precondition refused first | **fail CLOSED** (orthogonal to authorization) |

The gate accepts this posture only with the capability delivered by the trusted
launcher/runtime boundary over its dedicated, prewritten and unlinked inherited
authority descriptor. The launcher writes that descriptor for each server
generation, only after resolving canonical workspace configuration for that
generation; the server brands an exact, complete declaration read from it. A
generation whose canonical workspace declares any authority carrier inherits no
descriptor at all, so configuration that appears while a conduit is live cannot
be attested away by an earlier generation's bytes. The descriptor is not
selected through environment or argv, and ordinary core-library or
MCP-registration callers expose no mint. A standalone published `wiki-mcp` bin
launch inherits no such descriptor, carries no capability, and therefore fails
closed. Empty environment state, missing variables, a caller-provided config
bag, and a structurally identical caller assertion are not authentication and
fail closed. The declaration additionally names every authority carrier as
intentionally undeclared; missing, partial, malformed, oversized, or
caller-authored declarations fail closed.

This **revises** the prior free-tier posture (which fails closed when the
binding is absent) for the confirmed-no-declaration case only, exactly as
`decision` revised `decision`'s worker clause. It changes nothing for any
declared disposition.

### The authority boundary at MCP dispatch admission (work record)

This section is Portfolio's single durable derivation of the CCE-producer /
Portfolio-consumer boundary from accepted `decision`, `decision`, `decision`,
and `decision`. It records what Portfolio consumes and transports; it does not
mint CCE response schema, threshold policy, recovery semantics, or dispatch
authority.

The registered `workspace_agent_dispatch` route applies the same discipline, and
publishes which decision limb it resolved as `authority_limb` on the refusal.

Locator syntax is not authority. A complete `reviewed_sha` and `diff_base_sha`
pair is nevertheless a valid ordinary reviewer/redteam input because it only
identifies immutable bytes. The public route requires no authenticated operator
selection, carrier, attestation, receipt, or provenance record. Explicit ranges
and canonical selections enter the same normalizer, which proves commit type,
base ancestry, the required nonempty range, readable tree, and exact private
snapshot before any immutable target is minted. A malformed or unresolved range
refuses only that call and creates no lifecycle or recovery authority.

The refusal that carries that limb is the one canonical public mechanical
carrier. Enforcement therefore reaches a caller as a registered public code, the
deciding fact that decided it (or a closed redaction in place of a value it may
not publish), and exactly one continuation limb — a callable MCP route whose
arguments satisfy that route's own published request contract and whose outcome
is machine-checkable and currently false, or an explicit `no_supported_route`.

The distinction the limb draws is preserved by construction, not by convention:
a mechanical refusal's code, facts, and continuation are this repository's; an
authenticated policy result's verdict, reasons, optional remediation, and
response provenance are carried unchanged and are never restated as mechanical
ones. Local code may authenticate and enact a policy decision. It may not
re-decide it, and it does not manufacture a mechanical continuation for it.

`remote_needs_review` and `remote_reject` are **withheld grants by an external
authority**, not failures this repository observed. The route therefore forwards
the CCE decision itself — verdict, complete reason facts, optional returned
remediation, and response provenance — under
`launcher_transition.cce_policy_refused.v1` and
generates no repository blocker code, no local threshold conclusion, and no
substituted split, review, or escalation action for it. The
`worker_admission_review_threshold_exceeded` code, which asserted a local
threshold conclusion this repository never computed, is retired from the active
taxonomy: every one of its producers was downstream of a CCE `needs_review`.

`node-engine-api-client.mjs` is the sole Portfolio owner of current response
recognition and exact-policy authentication. The consumed CCE contract is one
closed `pack_result`: required `schema_version`
`worker_admission.evaluate_work_unit_dispatch.result.v1`, `pack`
`worker_admission_v1`, `operation` `evaluate_work_unit_dispatch`, authoritative
`decision`, and required `accounting`; `reasons` and `recovery` are optional
members, while `needs_review` and `reject` require nonempty reasons. When
`recovery` is present, the client validates the current CCE recovery schema;
absence is conformant and no consumer synthesizes a substitute. CCE continues
to own action selection and ordering, reasons, evidence, thresholds,
dependencies, and bindings, including the producer-declared maximum of 16
recovery actions.

The typed result publishes `response_provenance` with exactly
`schema_version`, `pack`, and `operation`, copied from the recognized response.
Response-side `operation_version`, `decision_id`, `pack_result.id`,
`decision_kind`, `decision_identity`, top-level provenance, and effect/verdict
aliases are not accepted, retained, defaulted, or reconstructed. This does not
change request-side or anti-laundering uses of similarly named fields. The
operation-manifest digest remains source-pinning evidence only and never enters
response provenance or response-derived diagnostics.

A conformant `admit`, including schema-valid optional reasons or recovery, is an
authenticated exact returned policy. It may proceed only after the independent
Node Engine backing, ratification, request digest, selected target,
authority-binding, launcher declaration, graph, backend, and runtime gates hold.
`needs_review` and `reject` remain exact returned policy effects. Malformed
present recovery fails at the client-owned validation boundary; missing optional
recovery does not. Downstream wiki-core, wiki-MCP, and launcher code consumes the
typed result and does not repeat response parsing, identity checks, reason caps,
effect-specific recovery rules, or recovery validation.

Complete typed and verbose/ranged transports preserve producer values and
ordering. Ordinary diagnostics may present bounded summaries, including at most
16 reasons, 24 evidence keys, and 256 observed-string characters, but those are
presentation bounds only. More than 16 reasons, more than 24 evidence keys, and
long observed strings remain conformant and cannot change the CCE disposition.

| CCE admission state | Consumer result |
| --- | --- |
| Launcher-confirmed no CCE authority | Proceed with advisory facts only. |
| Fully authenticated `admit` | Proceed. |
| Authenticated `needs_review` or `reject` | Carry the exact returned policy under `launcher_transition.cce_policy_refused.v1`. |
| Malformed present recovery or another client-recognized response defect | Fail closed as a malformed decision envelope. |
| Missing declaration, unavailable backend, unratified binding, contradictory carrier, or any other malformed/inconsistent prerequisite | Fail closed on its bounded mechanical limb. |

Every other state is a **mechanical failure** whose public code comes from one
shared classifier that cannot express a policy verdict at all. The classifier
refuses a policy-result-shaped input rather than reclassifying it, so a decision
cannot be laundered into a repository code by handing it to the wrong seam.

### Guarded-owner repository lint

`npm run lint:guarded-owner` deterministically enumerates tracked production
catch clauses and owner-classified public code literals through the neutral
guarded-owner registry and its category adapters. It validates the registry's
exact owner-proof identities, joins discovered sites to the work record public
refusal/exception classifications or the work record asynchronous-failure
classifications, and reports stable source identities and denominators.

The lint is a mechanical conformance gate, not another semantic owner. Invalid
registry shape, stale or digest-mismatched owner proof, duplicate ownership,
malformed or unbounded suppression evidence, a disappeared classified site, and
an unowned authenticated deciding-authority literal fail the command. A newly
discovered ordinary site absent from the point-in-time corpora is emitted as a
finite unresolved fact with its candidate owner and falsifying selector, but
that absence alone is non-gating. This preserves decision's separation between
mechanical refusal and policy authority: the lint consumes existing
classification and exact-policy identities and never authenticates, rebuilds,
or re-decides a carrier.

Modeled mechanical failures retain their exact identity: launcher declaration
and authority-binding defects, validation failures, backend and route failures,
decision-envelope problems, and recovery-contract conformance failures each
have a registered code and owner. `operator_recovery_needed` is not their
fallback. It is reachable only for an authenticated unexpected condition from
outside the tooling model, with the exact external condition preserved; seeing
it during normal tooling operation is itself a classification defect.

CCE alone produces `worker_admission.recovery.v1`, owns that schema, and chooses
every recovery action. When recovery is present, wiki-core owns Portfolio's one
mechanical validation boundary and its typed result: it checks compatibility,
retains an independent deeply frozen recovery value, and records the source,
response provenance, request and authority-binding evidence, canonical digest,
byte and member counts, ordered JSON-Pointer/type census, and validation issue.
Mechanical validation does not transfer CCE policy or schema authority to
wiki-core, and absent optional recovery creates no validation failure.

wiki-MCP and the launcher are consumers only. wiki-MCP transports the typed
result and complete diagnostic carrier in verbose output, leaving ordinary
output bounded; its existing response boundary spills the already-complete JSON
envelope and its content-reference reader range-reads those exact stored bytes.
The launcher renders the same typed result and carrier. Neither consumer parses
or revalidates raw CCE recovery, defines an action or reason vocabulary, chooses
a replacement next step, synthesizes recovery, or changes the enclosing
`needs_review` or `reject` effect. Unknown or malformed typed results are passed
through wiki-core's single validator and remain fail-closed.

This division creates no portfolio security posture, CCE schema authority,
dispatch authority, or policy interpretation. It also makes no claim that any
observed production response is conformant or defective; that classification
belongs to the separate live coordinator operation.

The no-key declaration keeps its authentication discipline at this boundary too,
in the positive direction only. The dispatch route treats a confirmed
no-authority posture as proceed **only** when the admissibility block reports
that it was evaluated from the local-only config authority, with no
authenticated request sent and no pack or Node Engine backing claimed. Silence —
no admissibility block at all — is `remote_enforcement_absent` and fails closed
as a missing declaration. The closed authority-input schema refuses
caller-supplied Node Engine authority fields before admission, so neither
absence nor caller assertion selects the no-key declaration; object identity is
bound to the declaration minted at the launcher/runtime boundary. This is a
source-selection rule, not an adversarial forgery-resistance claim.

The declaration must also be COMPLETE where it is minted. A launcher that
declared any single CCE authority carrier — service URL, API key,
worker-admission route, request-contract digest, or worker-admission authority
binding — has declared CCE authority, so a missing sibling carrier is an operator
configuration shortfall that fails closed on the overlay. Only a declaration in
which every carrier is undeclared is the no-key posture; one unset environment
variable is never enough to establish it.

Finally, `work_record_readiness_failure` is confined to its own limb. It states
that the selected WK or slice genuinely is not independently executable, and it
is emitted only with the exact failed check, status, and contract path. A
containment, backend, graph, carrier, review-target, or authorization failure may
not borrow it, because its published recovery instructs a coordinator to change
the work record — an actively harmful instruction when the record is correct and
the environment is not.

## Composition: free-tier usability needs CCE-key posture and honest containment

Authorization and containment are separate layers, so a usable free-tier run
needs both layers to select the same local/free posture:

- **dispatch-readiness** (this model / `decision`) — the gate runs *before*
  isolation, so this is the primary unblock; and
- **containment** (`decision`) — no configured CCE key
  means local/free structured dispatch does not require bwrap/Seatbelt before it
  can do useful work.

Containment alone cannot make the free product usable, because the dispatch-readiness gate
would still refuse before isolation is ever reached.

For structured role containment, "fail open" is not an automatic fallback and is
not a bwrap-specific absence proof. The launcher first makes a backend-neutral
selection and availability decision from launcher-owned facts: which containment
backend is supported for the platform, whether that backend is enabled for the
launch, and whether it can be used. If a supported/enabled backend is confirmed
and the spawn succeeds under that backend, the run records `enforced=true` with
the backend id (`isolation_backend=bwrap` today on Linux; `seatbelt` is reserved
for the future macOS backend).

If no backend can be used and no CCE key is
configured, local/free structured role dispatch may plain-spawn unenforced. That
run uses the role's ordinary command, args, cwd, and launcher-minted env without
the containment backend; it does not inherit the orchestrator direct-mode waiver
or become a sandboxed run. The posture must be loud in plan/runtime output and
provenance, with `enforced=false`, `isolation_backend=none`, and a reason that
distinguishes no-key local fallback from operator opt-out.
It also records the compatibility fields
`filesystem_confidentiality_guaranteed=false` and
`private_repository_path_enforced=false` to state that the corresponding mount
mechanism was not applied. An `enforced=true` value elsewhere remains a scope and
mechanical-status claim, not an AgentChassis confidentiality guarantee.

If a CCE key is configured, missing, broken, or
unusable containment is an enforcement-required refusal unless the operator sets
the explicit unsandboxed opt-out for that launch/configuration. A CCE-key
opt-out run also records `enforced=false` and `isolation_backend=none`, but its
reason must identify operator opt-out rather than no-key local fallback. This is
structure, admissibility, and provenance for the source-available product, not a
security guarantee. CCE admission and attestation consumers must treat either
unenforced state as unenforced.

## What the recorded state is

The enforcement-state recorder is part of the free, source-available substrate.
The recorded state is the **input** to authorization, not the authorization
itself: a trusted attestation comes only from the Chassis Control Engine's
signing service. Consumers that need a guarantee verify the signed attestation,
not the local recorded state.

## Contributor review is not consuming-repository integration authority

This repository's contributor policy may require a review sequence before a
change is integrated. That sequencing is workflow evidence for the portfolio
maintainers; it does not grant the contributor review process mechanical
authority over the consuming repository. In particular, a review result,
receipt, disposition, challenge, or terminal-review state cannot itself approve
or veto committed-slice integration.

The integration boundary keeps three limbs separate:

- **Mechanical facts** are launcher- and Git-derived preconditions, such as
  repository identity, the bound base and target, tree and parent
  relationships, CAS/ref state, and write-scope containment. A mechanical
  failure may refuse the operation because it cannot complete correctly.
- **Review evidence** is advisory evidence. Clean or failed review output,
  missing or recovered receipts, and contributor-sequencing irregularities are
  recorded and preserved, but they do not become a local integration refusal.
- **CCE policy** is explicit authority. Only an explicit configured CCE
  decision may supply a policy denial (or other policy disposition); local
  code does not manufacture that authority from review evidence or lifecycle
  expectations.

Accordingly, contributor review sequencing and runtime integration authority
must not be conflated. Rejected `decision` is not adopted policy and supplies
no product or consuming-repository authority; references to its proposed
review-before-integration rule cannot be used to create a local mechanical
gate. Adopted decisions and an explicit CCE result remain the only sources of
the corresponding authority.

### The recorded result carries its own attribution

Principle (4) says enforcement-relevant state is set by the **observer**, never
asserted by the **subject**. The recorded result enacts that by carrying, next to
the posture, an explicit statement of **where the posture came from** — so a
reader never has to infer trust from the presence of a field.

A result is attributed to the launcher (`authority = "launcher_owned"`) **only**
when it rode on a source the launcher itself minted — from a real sandbox
decision, or from its own confirmed isolated spawn. That marking is process-local
rather than accepted from the serialized result. Validation precedes marking, so invalid input yields no
marked source at all rather than a marked-but-empty one; "launcher-owned" means
*the launcher observed this*, never merely *this code path ran*.

Everything else — an absent source, a malformed one, an unmarked one, one
supplied by the caller, one supplied by the dispatched child — is recorded
**unattributed** and collapses to the fail-honest unenforced default. It does not
carry launcher attribution. This is (0′) applied to the result rather than to the
decision: absence and ambiguity resolve to the mechanically conservative state, and the unattributed
marking makes that resolution *visible* instead of leaving a confident-looking
record the launcher never stood behind.

Two consequences follow. First, a launch the launcher **accepted and ran under a
confirmed backend** records the enforced result — `enforced=true` with the
backend id — and cannot truthfully be recorded as refused; refusal describes a
launch that never ran under the backend, and the child's output quality is a
separate fact that does not retroactively unmake containment. Recording an
accepted contained run as its least contained outcome would violate (3) in the
opposite direction from the usual concern: fail-honest cuts both ways, and
under-claiming real containment is as dishonest as over-claiming absent
containment. Second, the rule is **family-neutral**: every supported family
(Codex, Claude) earns attribution the same way, and none has a private route to
it — an unsupported or unmarked path fails to unattributed rather than
inheriting authority.

This is result provenance only. It records the outcome of containment; it is not
a containment mechanism, does not belong to the closed Principle (5) set, and
does not alter backend selection, scope projection, transport setup, spawn, or
the fail-open and refusal branches those mechanisms own.

## Scope and limits

A few points clarify where the boundaries are, so the layered model is not
misread.

**There is no managed-worker command classifier; the boundaries are reach and
write.** Inspection, generation, formatting, and in-scope mutation may use the
native command tool. The actual boundaries are
the sandbox **reach** dimension (filesystem / env via bubblewrap) and the
**write** dimension, where out-of-scope writes are blocked before they land (the
kernel exact-file bind for Codex, the native tool-use permission gate for
Claude). Per Principles (3) and (4), an advisory dimension is recorded as such and
never presented as the guarantee.

**An allowed code-runner is contained by where it spawns.**
Managed implementation workers receive no validation or general wiki-MCP tool;
their only server capability is closed-input commit delivery. Test availability
and success are not worker admission or commit prerequisites. Findings-only
review owns declared validation against the exact committed target, in a read-only
reviewer namespace with isolated writable scratch and bounded structured output.
Passing and failing results are advisory evidence; coordinator/CCE policy decides
their effect on integration.

**Project-test execution is an optional capability; mechanical candidate and
confinement enforcement is not.** The same "test availability and success are not
prerequisites" rule holds at the terminal whole-WK boundary. Ordinary project
dependencies and declared project tests are exposed to a findings-only reviewer when
the launcher can expose them, and their absence changes only what evidence exists.
Concretely, none of the following is enforcement: whether the candidate's
`package.json`, lockfile, or workspace manifest matches the landing checkout's
installed dependency root; whether an install marker is present or fresh; whether a
dependency projection can be built at all; whether a declared project-test command
exists in the candidate. Treating any of them as a refusal would be exactly the
local admissibility judgment `decision` and `decision` place outside this layer, and
`decision` already settles that review is not a required floor. What remains
mechanically enforced is repository identity, the exact `C/B/W` binding,
`tree(C) === tree(W)`, `C`'s sole parent `B`, candidate-ref and checkout identity,
rejection of caller-supplied candidate authority, reviewer write confinement, and —
only when a dependency mount is actually selected — that mount's exact source
identity, read-only mode, absence of writable overlap, and freedom from an identity
swap between verification and spawn. Current-landing mergeability is owned by
git/forge, never by a local check.

**Controlled-generation authentication has one semantic owner.**
`packages/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs` first
owns the carrier-set manifest contract itself: schema, strict JSON shape,
WK/focus/generation identity, ordered complete census, member semantics, canonical
body serialization, manifest digest verification, normalized projection, and typed
diagnostic meanings. Resolution, exact-`W` authentication, publication, and slice
integration may observe different authoritative files, but all delegate those bytes
to this pure owner and may only map its typed error into their public taxonomy.
Publication also delegates embedded and visible manifest bytes, byte equality, and
content-digest inputs to the owner's canonical-byte operation; it owns no local
manifest serializer.
`packages/wiki-core/src/lib/controlled-contract-generation-authentication.mjs`
owns the closed authenticated-generation schema, tuple validation, immutable
normalization, deterministic descriptor order, and manifest-selection identity.
Manifest resolution supplies applicability facts only. The launcher attachment
primitive asynchronously observes the exact direct `W` ref and reads the exact
canonical-record, carrier, and visible-manifest blobs from that commit, then hands
those observations to the owner. Candidate, runtime, coordinator, and forge code
transport or compare the owner-produced envelope; none constructs one, replaces a
field, or accepts metadata as authority. A legacy generation with no manifest can
remain readable for non-terminal compatibility, but it has a null manifest identity
and is mechanically ineligible for candidate or forge authority.

**Terminal-review binding and source-record digest each have one owner.**
`packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs` alone
constructs, validates, canonically serializes, digests, and compares
`agent_launch.terminal_review_contract_binding.v1`. The coordinator and forge each
resolve their own canonical-record facts and delegate them to that owner; forge does
not accept candidate metadata as current authority. Forge also imports wiki-core's
`computeWorkRecordSourceDigest` rather than hashing a locally chosen record
population. That canonical source projection excludes generated `derived_evidence`
and `projections`, but every authored contract change remains digest movement.

## Slice-integration authority: mechanical facts, advisory evidence, and CCE policy

The `agent-chassis` contributor policy in `AGENTS.md` recommends and
requires implementation review before integration as a contributor workflow
ordering. That policy governs how changes are authored and coordinated in this
repository; it is not shipped consuming-repository runtime authority. In
particular, free/local integration of an otherwise mechanically valid committed
slice derives no mechanical authority from review evidence, and a review result
does not become an integration veto merely because the contributor workflow
places review first. Rejected `decision` material has no adopted status and
supplies no product or runtime authority.

The integration boundary keeps three kinds of facts separate:

1. **Exact mechanical integration facts** are derived by the integration owner
   from authenticated refs, commits, trees, parents, target identity, scope,
   and compare-and-swap state. These facts establish whether the requested
   slice can be applied safely and exactly to the current WK state.
2. **Preserved advisory review evidence** includes clean or failing
   findings-only results, receipts, findings, and coordinator dispositions.
   It remains available for correlation, recovery, and policy input, but it
   neither authorizes integration nor refuses it on its own.
3. **An explicit configured CCE decision**, when a CCE gate is configured, is
   the separate policy authority. The decision must be authenticated and bound
   to the exact integration target. On these limbs, an explicit authenticated
   CCE denial is a policy refusal; a missing, malformed, unavailable,
   unratified, or target-mismatched decision is instead a distinct typed
   validity/availability failure that fails closed when configured policy
   requires a valid gate. Review evidence cannot be promoted into either
   category by interpretation.

This boundary covers the `work record` regression: invalid terminal-only
review evidence cannot block a mechanically sound free/local integration.
Receipt recovery and the authority to recover a durable review/integration
receipt remain owned by `work record`; this model does not create a second recovery
owner or turn invalid evidence into mechanical authority.

The diagnostic and projection ownership is likewise typed. The
`runtime-blocker-codes.v1` registry is the public coordinator recovery
taxonomy. The launcher integration logic owns typed diagnostic classification
and the underlying mechanical/CCE boundary. The MCP committed-slice route is
an explicit projector of those typed results and preserved advisory
correlation; it does not infer authority from message substrings, review text,
receipt presence, liveness, or other untyped output. A projected blocker is
therefore evidence of the owning boundary's result, not a new policy decision
at the MCP surface.

**Inputs are typed where it matters.** Identifiers are allocator-minted through
the structured create path, never hand-assigned. Spec completeness
("independently executable") is a human judgment owned by the coordinator
design→review loop, not a machine-verified guarantee — a field that drives no
check is documentation, not enforcement. Parent-WK *planning* completeness —
parent acceptance arrays and a predeclared terminal whole-WK review unit — is
coordination/CCE-owned policy in exactly this sense: it is an observable fact a
configured CCE may weigh, consistent with `decision` / `decision` (local renders
no admissibility verdict), not a free/local implementation-dispatch veto.
Free/local dispatch of an otherwise-valid confined worker never refuses for its
absence, and it never overturns a CCE decision. The canonical `IN-####`
initiative is the exception: it is mechanical ref identity (`decision`), not
planning policy — the launcher derives the exact `wk/IN/WK` and `slice/IN/WK` ref
namespace from it, so a missing or non-canonical initiative is a narrow, typed
local dispatch refusal (`missing_initiative_ref_namespace`) returned before any
backend side effect, and it is not a CCE verdict. Authorship trust has a stated
precondition: a single trusted work-record author. Once authorship goes
multi-party, record prose flowing into a worker prompt becomes an untrusted input
that must be typed, escaped at the prompt boundary, and validated at creation
before that capability ships. This is a precondition on the model, not a silent
gap in it.

## Operator direct-mode is a separate posture

The claim switch governs **dispatched role runs** (worker, reviewer, redteam). The
**operator entrypoint** (the orchestrator, per `decision`) is a separate,
explicitly-acknowledged waiver — neither "no declaration → open" nor "declared →
closed." Each dispatched run **re-evaluates** the declaration independently and
does not inherit the operator's waiver.
# Native stable controlled-contract evidence tooling

The supported controlled-contract boundary accepts only the exact native-v1
carrier, vocabulary, profile, evaluation-input, result, and test-proof
identities. Package code owns validation and diagnostic meaning; wiki-core owns
canonical same-WK resolution, CAS, leases, staleness, continuation, and
generation coordination; wiki-MCP owns route schemas, role exposure, bounded
presentation, and content references. On these authoring and query routes,
unsupported family state is rejected before persistence or execution. This
tooling reports evidence; it does not authorize or refuse implementation
dispatch, and only a configured CCE decision can apply proof-policy denial.
