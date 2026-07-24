
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

## Security scope

The local tooling in this repository is **correctness, provenance, and
honest-agent workflow machinery — not same-user security infrastructure**. This
scope frames every mechanism below; the threat-model baseline section that
follows is its elaboration. The local mechanisms exist to:

- **enforce product contracts** — `write_scope` confinement, dispatch-readiness
  shape checks, and the launcher's controlled-execution boundary keep an honest
  managed agent inside the lane its coordinator authored;
- **detect accidental drift and corruption** — CAS/digest integrity, sidecar
  fail-loud checks, declared-versus-landed verification, and freshness/expiry
  checks catch an unintended, stale, or corrupted change, not a forged one;
- **protect credentials from external disclosure** — the launcher masks its own
  secrets off the worker mount and redacts private carriers so a credential is
  not leaked outward through a run's inputs, outputs, or model egress;
- **constrain confined managed execution** — a managed worker sees exactly its
  `R ∪ W` namespace and mutates only `write_scope`, so its blast radius is
  bounded to what it was dispatched to touch.

It does **not** claim security against a **malicious same-user actor or a
compromised host process**. A party that already holds the operator's shell, host
filesystem, and credentials can defeat every local mechanism here; containing
that party is outside the mandate. The realistic baseline is *"the operator runs
the agent with full host privileges and no tooling at all,"* and the job is to be
honestly better than that baseline for an **honest** agent, not to make a hostile
one harmless.

This framing weakens no real boundary. External service authentication, the
Chassis Control Engine's signing authority as the sole minter of enforcement
authorization, kernel write confinement, CAS/digest integrity, and the
credential/private-carrier disclosure boundaries above all still hold exactly as
before; they are simply described as contract-enforcement, provenance, and
disclosure controls rather than as a same-user security guarantee. This mandate
was established by the work record audit; work record first applied it, making
target-resolution evidence advisory to dispatch rather than a file-type
permission.

## Threat-model baseline: better than full privileges, not perfect

The comparison this model is measured against is **"run the agent with full host
privileges, no sandbox at all"** — the realistic alternative an operator would
otherwise use. The platform's job is to be **strictly better than that baseline
for an honest agent**, NOT to make a *compromised* agent harmless. We do **not**
attempt to prevent prompt injection, defeat a malicious model, or guarantee a
hostile agent cannot misbehave — those are explicitly out of scope. An exposure
that is **no worse than the full-privileges baseline is a known limitation rather
than a boundary failure**; perfect isolation is not the bar for this source-
available dispatch substrate.

What the sandbox buys over that baseline (the load-bearing wins): writes are
confined to the canonical `write_scope` so an honest agent cannot wander out of
its lane; the launcher's own secrets and launch authority are masked/withheld so
an agent cannot read the prod credential or mint authority it would not otherwise
have; the repo is read-only except the write_scope directories. That is
meaningfully safer than no-sandbox while staying usable everywhere.

**Current public threat-model limits:**

- **Worker network egress.** The worker bubblewrap runs with `shareNet: true` (no
  `--unshare-net`) because hosted-model families (Claude, Codex) must reach their
  model API. A compromised worker therefore has outbound network — but a
  full-privileges agent has the same, so this is *no worse than baseline*. Future
  hardening can narrow egress to model-API endpoints; the current public posture
  is transparent about allowing worker outbound network.
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

The actual family command tool is available without interactive approval:
Codex receives `exec_command` and Claude receives `Bash`. Commands may inspect,
generate, format, and mutate inside the namespace. There is no read-only command
classifier or command allowlist; bubblewrap is the filesystem authority and
cannot be widened by a command. This tranche exposes no worker validation or general
MCP tools. Delivery uses only the closed-input commit capability in the trusted
host/runtime boundary, with the server-resolved binding as its input; the worker
does not receive the repository gitdir, index, refs, or a general commit shell.

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
  namespace binds only those entries; everything else is absent (decision).
- **Reviewer / redteam — the FULL repository, read-only, writes nothing.**
  Reviewer and redteam are findings-only roles whose repository READ visibility
  is the whole repository, matching orchestrator read visibility — NOT the
  `R union W` of the unit under review (decision clause 3, decision clause 2).
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
  repository write surface stays empty.
- **Orchestrator — the full repository read with its separate role-specific
  coordination write policy.** Unchanged by this split.

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
  track work. It enforces local containment — write-scope binding, sandboxed
  reach, and honest enforcement-state provenance — but does not sell a remote
  **enforcement guarantee**: it makes no signed claim that a run was authorized.
- **Hosted governance — the Chassis Control Engine (CCE).** Owns enforcement authorization and signed attestation.

Vocabulary convention: source-available/free local prose uses
**dispatch-readiness**, **recorded review**, **containment**, and **fails-open**.
Chassis Control Engine prose owns **admission**, **authorization**,
**authority**, **signed**, **attestation**, and **enforcement guarantee**. Checked-in
schema and route literals keep their names, including `worker-admission-*`,
`workspace_record_review_attestation`, `reviewer_attestation`, and
`accepted_authority`.

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

**(0) Declaration governs posture.** Fail-open vs fail-closed is selected by
whether enforcement authority is **declared**, not by whether it is **granted**:

- **Confirmed no authority declared → fail OPEN.** The run proceeds and records
  `enforced=false`, honestly.
- **Authority declared → fail CLOSED unless granted.** Once a run is on the CCE
  path, every outcome short of a genuine, ratified grant is refused. A declared
  authority that cannot be substantiated — backend unreachable, unratified,
  needs-review, reject — is refused, never waved through. Claiming enforcement is
  a commitment that cannot be silently walked back to fail-open. This is the
  anti-laundering property: a CCE-governed run whose backend is merely down fails
  **closed**, so an unenforced run is never laundered as a CCE-governed one.
  The same posture applies to the org policy-profile carrier: a confirmed,
  valid profile can be consumed on the CCE path, while a declared-but-malformed
  profile fails closed there and is inert on a confirmed free/local-only install.

**(0′) Positive-confirmation (default-closed on uncertainty).** Every
enforcement-relevant fact — *is authority declared?*, *was it granted?*, *was
isolation actually enforced?* — is "yes" **only on positive confirmation, read
from the canonical source at the moment it matters**. Absence, unreadability,
staleness, or ambiguity always resolves to the safe side: fail-closed /
`enforced=false` / untrusted. **Fail-open requires a *confirmed* "no authority is
declared," never an inference from silence.** This is what makes (0) safe: it is
the difference between "the launcher confirmed the free posture" and "a
propagation bug hid the CCE posture."
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

**(4) Non-spoofable provenance — of the declaration *and* the result.**
Enforcement-relevant state is set by the **observer** (the launcher, from
launch facts), never asserted by the **subject** (the dispatched worker, child,
prompt, or run environment). This covers both the recorded enforcement result and
**the declaration itself**: the declaration is read from a single canonical
config source, by every gating stage, and is not suppressible by the subject or
an untrusted caller. A stage that reads a declaration from a derived, mutable
channel (e.g. an un-propagated `process.env`) can mis-read "declared" as "absent"
and fail open — the exact failure (0′) forbids.

**(5) Containment is a closed, operator-gated set of mechanisms, recorded per
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
  that grants `Edit` only within `write_scope` (a positive allow-list) and runs the
  editor in its default permission mode, so an allowed in-scope write applies with no
  prompt while any unlisted/out-of-scope write is default-denied *before it executes*.
  The settings are launcher-minted, fail closed (the launch is refused if they cannot
  be minted or if a behavioral probe cannot prove the restriction is in effect), and
  are bound read-only so the worker cannot disable them; committed lower-scope editor
  settings are masked so they cannot widen the grant. Underneath, the repo stays
  read-only except the writable `write_scope` directories, and a post-run
  `changed-files ⊆ write_scope` verifier that fails closed is the backstop. Both paths
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
launch on a fresh repo that carries no `.env`. Skipping the bind is safe — an
absent `.env` holds no secret to mask, so absence is not an unmasked secret; a
present `.env` is still hard-masked exactly as before. This is secret masking
only; worker network posture remains the accepted `shareNet: true` model-api
posture above.

| Executor family | What it may write | Write-scope enforcement | What is sandboxed | What is not sandboxed / known caveats | Network posture |
| --- | --- | --- | --- | --- | --- |
| Codex | The assigned implementation `write_scope` for workers; reviewer/redteam subjects must have `write_scope: []`. | The outer bubblewrap plan mounts the repo read-only, then emits exact `--bind <file> <file>` entries for file scopes and writable root binds only for directory scopes. Paths are realpath-normalized and must remain inside the repo; repo root and `.git` writable roots fail closed. Codex CLI `-s workspace-write` / `--add-dir` records directory-level intent only, so the bwrap file bind is the file-level boundary. | The dispatched child runs under bwrap with system/read-only roots, env filtered through the launcher policy, and write binds derived from canonical record state. | The Codex CLI sandbox itself is not the file-level guarantee; do not read `--add-dir` as per-file enforcement. | Worker launch shares network (`shareNet: true`) for model API access; this is the accepted worker-egress risk above. |
| Claude | The assigned implementation `write_scope` for managed workers; reviewer/redteam are read-only. | Managed workers receive exact `W` writable mounts over a sparse `R union W` namespace. `Bash` is present in `permissions.allow`, `--allowedTools`, and the capability probe, and absent from both deny layers. Native WebFetch/WebSearch and delegation/spawn tools remain denied. | The settings root is read-only, repository visibility is exactly `R union W`, and repository Git metadata is absent. | Legacy non-managed native-edit composition may retain directory-scoped native editing, but managed-worker shell authority comes from bwrap, not command parsing or native edit permissions. Post-run changed-path containment remains a backstop. | `shareNet: true`; shell-visible network binaries may use the shared network. Native WebFetch/WebSearch denial is not network confinement. |
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
refinement. The layer difference only matters to an adversary outside the v1 threat
model — a compromised editor that ignores its own permission settings — which this
model scopes out.

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
| `remote_enforcement_local_only` | client ran; CCE key confirmed absent — **the no-key declaration** | **fail OPEN**, record `enforced=false` |
| `remote_enforcement_absent` | **no result artifact at all** — classification never ran | **fail CLOSED** (uncertainty, not a confirmed declaration) |
| `remote_admit` (pack-backed, NE-backed, **ratified**) | declared **and** granted | run, `enforced=true` |
| `remote_admit_unratified` | declared, bound to unratified placeholder | **fail CLOSED** |
| `remote_needs_review` / `remote_reject` | declared; NE withheld the grant | **fail CLOSED** |
| `remote_enforcement_unavailable` | declared; backend transport / auth / entitlement failure | **fail CLOSED** (a down CCE backend degrades closed) |
| `local_refusal_preserved` | a structural / safety precondition refused first | **fail CLOSED** (orthogonal to authorization) |

The gate must **re-derive** this from canonical config (re-running the readiness
classification), never trust a `local_only_fail_open` artifact handed to it — or a
subject could forge the no-key declaration to force open. A real declared key
always takes precedence over the no-key floor, so a forged no-key only ever
matters where no real key exists (free stays free); the re-derivation discipline
is what guarantees that.

This **revises** the prior free-tier posture (which fails closed when the
binding is absent) for the confirmed-no-declaration case only, exactly as
`decision` revised `decision`'s worker clause. It changes nothing for any
declared disposition.

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

**Inputs are typed where it matters.** Identifiers are allocator-minted through
the structured create path, never hand-assigned. Spec completeness
("independently executable") is a human judgment owned by the coordinator
design→review loop, not a machine-verified guarantee — a field that drives no
check is documentation, not enforcement. Authorship trust has a stated
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
