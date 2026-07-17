
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
- **Worker self-scoped policy writes.** A worker can write `wiki/decisions/` only
  if its *coordinator-authored* `write_scope` lists it; a full-privileges agent
  could write it freely, so the write_scope gating is already better than
  baseline. A kernel read-only backstop on `wiki/decisions/` for worker sandboxes
  would be defense-in-depth, not the current enforcement boundary.
- **Orchestrator / escalated / host sessions** are operator-trusted and outside
  the dispatched-run enforcement envelope by design.

### Phase 1 managed implementation-worker R/W boundary

For the bounded Phase 1 managed implementation-worker tranche, `R` is the
normalized union of the canonical unit's `read_scope` and `repo_paths`; `W` is
the normalized canonical `write_scope`. The launcher freezes both sets before
launch. The worker can see exactly `R union W` repository content and can mutate
exactly `W`. Including `W` in visibility is deliberate: an authorized write
target does not also need to be duplicated in `read_scope` or `repo_paths`.

The Codex inspection shell remains available only as a prompt-governed,
non-mutating way to inspect the visible namespace. It is not an authority source
and cannot widen `R` or `W`. This tranche exposes no worker validation or general
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
  same outcome. In-place editors (Codex and AGY, which is WIP / not officially
  supported yet) get a **kernel exact-file bind**: only the bound `write_scope` files
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

The current supported implementation families are **Codex** and **Claude**. AGY
is WIP / not officially supported yet; its row is documented so reviewers can see
the current boundary and its known temporary runtime-state exposure, not as a
hardened support claim.

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
| Claude | The assigned implementation `write_scope` for workers; reviewer/redteam read-only is the default sandboxed posture when an enforced backend is active. | Native Claude Code tool-use permissions: the launcher mints a settings file whose `permissions.allow` grants `Edit` **only** within the record's `write_scope` (exact files + directory prefixes) plus a positive repo-scoped `Read` allow-list, and whose `permissions.deny` blocks `Bash` and every network-egress tool. The editor runs in its **default permission mode**, so an allowed in-scope write applies with no prompt while any unlisted/out-of-scope write is default-denied **before it executes** — out-of-scope writes are prevented, not detected after the fact. The settings are launcher-minted and installed on the launch itself (in-process and broker paths); the launch fails closed if they cannot be minted or if a behavioral probe cannot prove the restriction is actually in effect (an ignored allow-list would fail open), and they are bound read-only so the worker cannot disable them. Committed lower-scope editor settings (the repo `.claude/` subtree and the system managed-settings dir) are masked so they cannot additively widen the grant. The editor also gets writable **containing directories** for the `write_scope` (the atomic rename needs a writable parent) with unsafe roots guarded before spawn. | Under the current Linux enforced backend, the repo is mounted read-only except those writable parent directories. The Claude OAuth credential is a single-file read-only home-policy bind, not broad `~/.claude`; the positive `Read` allow-list keeps the read tool inside the repo, so the credential and host files are not readable through it. Env is launcher-filtered. | The kernel mount is at parent-directory granularity (the atomic-rename editor needs a writable parent), so the file-level boundary is the native tool-use permission gate rather than a kernel exact-file bind; a post-run `changed-files ⊆ write_scope` verifier that fails closed is the backstop beneath it. The layer differs from Codex's kernel bind, but the outcome is the same — an out-of-scope write does not land. Because the permission gate is enforced by the editor process, it is defeated only by an adversary outside the v1 threat model (a compromised editor that ignores its own permission settings). An explicit operator opt-in unenforced run has no sandbox-enforced reviewer/redteam read-only posture and is recorded as unenforced. | Worker launch shares network (`shareNet: true`) for model API access; this is the accepted worker-egress risk above. |
| AGY | WIP / not officially supported. For current launcher experiments, the assigned implementation `write_scope` is bound like Codex: exact files for file scopes and writable roots only for directory scopes. | The executor uses the shared exact-file write-scope mechanism for repo writes. This is separate from the family-runtime writable root. | Repo write scope is bwrap-bound through the shared write-scope derivation and launcher env policy. | AGY has a separate broad writable family-runtime bind for `$HOME/.gemini`, used as a temporary WIP stopgap for Gemini/Antigravity state. Do not conflate that runtime-state bind with repo `write_scope`; tightening it is planned post-v1. | Worker launch shares network (`shareNet: true`) for model API access; this is the accepted worker-egress risk above. |

#### Why native-edit families use a directory bind

The write-enforcement class follows from the editor's write strategy. Claude's
editor writes atomically: it creates a
temporary sibling in the target's directory and `rename(2)`s it over the target.
`rename(2)` mutates directory entries, so it needs write+execute on the
**containing directory**, not on the file. An exact-file kernel bind — target
file writable, parent directory read-only — is therefore *structurally
incompatible* with a rename-atomic editor: the temp create or the rename fails
`EROFS` and the agent cannot edit at all. Codex and AGY can take the exact-file
bind precisely because they write in place.

So the directory-scoped writable parent is required by the editor's write
strategy — that physical constraint stands. The **file-level boundary inside that
directory is the editor's native tool-use permission gate**: the launcher mints a
settings file that grants `Edit` only within `write_scope`, and the editor runs in
its default permission mode, so an out-of-scope `Edit`/`Write` (including a sibling
file in the writable directory) is default-denied before it executes while an
in-scope write applies with no prompt. In-place editors (Codex, AGY) reach the same
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
out-of-sandbox authorization broker. The write-scope enforcement path carries **no**
launcher secret and needs no per-action broker.

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
    "allow": ["Edit(inscope/**)", "Read(//${REPO#/}/**)"],
    "deny": ["Bash","WebFetch","WebSearch","Task","Agent","Workflow","Skill","Monitor","mcp__*"],
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
settings shape denies `Bash`, every network-egress tool, and any read outside the
positive repo-scoped `Read` allow-list.

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

The profile is all-or-nothing: it is a complete 8-control / 19-key baseline, not
a partial override file. If the declared profile is unreadable, empty,
malformed, schema-invalid, or over the structural bound, the CCE path fails
closed. On a confirmed free/local-only install, the same malformed declaration
is inert: the carrier is omitted and the run stays usable as free.

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
and `acceptance.validation` to be present arrays. The policy then
applies bounded shape/size pressure: for example, more than one write-scope entry
or more than 200 scoped LOC requires review, while more than four write-scope
entries, more than 1200 scoped LOC, or more than one write cluster is denied /
non-launchable. These are real gates, but they are not semantic proof:
dispatch-readiness does not verify that the coordinator chose the minimal
possible scope or that the validation commands are meaningful.

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

**The command-surface classifier is advisory; the boundaries are reach and
write.** The Bash/argv classifier is the command-surface dimension of Principle
(5): it catches the modal agent failure — drift out of lane — cheaply and early,
but it is only as strong as the containment beneath it. The actual boundaries are
the sandbox **reach** dimension (filesystem / env via bubblewrap) and the
**write** dimension, where out-of-scope writes are blocked before they land (the
kernel exact-file bind for Codex/AGY, the native tool-use permission gate for
Claude). Per Principles (3) and (4), an advisory dimension is recorded as such and
never presented as the guarantee.

**An allowed code-runner is contained by where it spawns, not by the classifier.**
A worker's in-session validation (`node_check` / `node_test`) runs inside the
worker's own bubblewrap sandbox — not the server process — with the repo mounted
read-only, launcher secrets masked off the mount, no network (`--unshare-net`), a
launcher-minted clean-env allowlist, and an ephemeral tmpfs as the only writable
scratch. So a worker's `node --test` is arbitrary code that can write nothing
persistent, read no secret, and reach no network — the containment holds, not the
classifier. (`node_check` is parse-only.) The coordinator
`workspace_run_validation` route instead spawns `node` unsandboxed in the server
process; that is a coordinator/operator capability, and operator sessions are
outside the enforcement envelope by design — it matches the baseline of an
operator running the command in a shell. It is still bounded against accident and
secret leak: the target must be an allowlisted validation entry, launcher secret
families are stripped from the child env, and output and wall-clock are capped.

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
