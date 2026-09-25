
# Agent-launch confinement and MCP conduit

Confined implementation and findings roles use bubblewrap to keep repository
visibility and mutation within declared role scope. This is the scope mechanism
described by the
[no-additional-security-profile doctrine](operating-model.md#scope-doctrine-no-additional-security-profile),
not a security profile or task-safety boundary. For a managed worker, the visible
repository namespace is exactly the frozen union of canonical `read_scope`,
`repo_paths`, and `write_scope`; mutation is possible exactly within
`write_scope`, with the controlled-contract private family at
`wiki/contracts` subtracted. A full host checkout never broadens this namespace.

The subtraction is a filesystem fact only after an enforced bwrap plan is
constructed and spawned. The launcher derives the private path itself, overlays
it with an empty read-only mount after every ordinary read/write mount, and
refuses before spawn if an already-visible private subtree is not a canonical
directory or the boundary cannot be built. Sparse projections do not add
visibility merely to mask an already-absent path. Wide projections—including
confined reviewer, redteam, orchestrator, and operator postures—receive the same
final overlay. Prompt text, role names, scope policy facts, and an unavailable
backend are not filesystem enforcement.

Direct and supported plain-spawn modes do not apply this confinement. Their
plan/runtime output states `enforced=false`, `isolation_backend=none`,
`filesystem_confidentiality_guaranteed=false`, and
`private_repository_path_enforced=false`, stating that the corresponding
filesystem mechanisms are absent. The compatibility field name does not turn an
enforced run into a broader confidentiality guarantee. Those modes remain
available where decision or decision permits them;
they are neither blocked merely because the private family exists nor described
as confined.

## Git status under the private-family overlay

Git reads the repository index, which lists every tracked path under
`wiki/contracts`, while the enforced namespace shows that subtree as an empty
read-only mount. An ordinary `git status` inside a confined session therefore
reports each hidden contract as a deletion. Those rows describe the overlay, not
the working tree, and they bury the session's real changes.

Supported Claude and Codex orchestrator launches correct the output. The shared
orchestrator composition asks the planner for a launcher-owned executable named
`git`, bound read-only from a package-local asset at
`/agent-launch-git-status-wrapper` and placed first on the child's `PATH`. When
that executable sees an ordinary `git status` whose global options resolve to the
launcher-designated repository, it adds the root-anchored exclusion pathspec
`:(top,exclude)wiki/contracts` and execs the launcher-resolved real Git. An
explicit `wiki/contracts` pathspec from the caller stays excluded, because the
exclusion wins.

The subcommand is identified by walking argv past Git's global options, including
the ones that consume a separate value (`-C`, `-c`, `--git-dir`, `--work-tree`,
`--namespace`, `--super-prefix`, `--attr-source`, `--config-env`), so a pathspec,
a commit message, or a configuration value that happens to read `status` is never
mistaken for the subcommand. `git status` has no option that consumes a separate
following value, so everything after the subcommand that does not begin with `-`,
and everything after a `--`, is a caller pathspec. Status options and formats,
working directory, output streams and exit status are the real Git's; an invalid
invocation stays invalid rather than becoming a successful status.

In Git's ordinary pathspec mode the exclusion is simply appended. It is a
pathspec rather than an option, so no `--` separator is inserted and no caller
option, pathspec, or separator position is rewritten, and a trailing pathspec
cannot be swallowed as an option argument.

Literal pathspec mode needs one more step. Under `--literal-pathspecs`, or a true
`GIT_LITERAL_PATHSPECS`, Git reads every pathspec as a plain filename, so an
appended `:(top,exclude)...` element would name a file that does not exist and
would silently hide the caller's own rows. The invocation is therefore
normalized: the global literal flags are dropped and `GIT_LITERAL_PATHSPECS` is
set to `0` for that one real-Git call, each caller pathspec is re-expressed with
explicit `:(literal)` magic — which is exactly the meaning global literal mode
gave it, including wildcards, bracket expressions, leading colons and
case-sensitivity — and the launcher's exclusion keeps its magic. Caller paths
mean the same thing in both shapes, and `--no-literal-pathspecs` returns the
invocation to the ordinary appended shape, last flag winning as in Git's own
handling.

Two literal-mode invocations that real Git itself rejects are handed to it
untouched rather than normalized into something that succeeds: an empty
pathspec, and literal mode combined with another global pathspec mode
(`--glob-pathspecs`, `--noglob-pathspecs`, `--icase-pathspecs`, or their
environment spellings) once any pathspec is present. That combination without a
caller pathspec is legal Git and no caller path meaning is at stake, so it is
still filtered.

The wrapper's identity is entirely launcher-derived. The asset is package-local,
the real Git stays at its own absolute host path (so its exec-path, libraries and
any runtime-prefix derivation are unchanged), and the designated repository plus
the exclusion pathspec are minted by the planner into three child environment
variables. A missing or non-executable wrapper asset, or a resolved Git that
points back at the wrapper, is an explicit launch refusal
(`agent_launch.isolation.git_status_wrapper_asset_unavailable.v1`); at run time a
missing pinned real Git is an explicit exit-127 error on stderr. Neither degrades
into a silently unfiltered status.

The wrapper is omitted, with no argv or environment change at all, for a sparse
worker namespace (which shows only its frozen scope and carries no Git metadata),
for a plan that carries no private-family overlay, for a plan whose child has no
usable `PATH` or whose closed environment policy does not admit `PATH`, and when
no real Git is reachable inside the namespace. Worker, reviewer, redteam and
validation-confinement plans are unchanged. No role gains Git metadata it did not
already have.

Coverage is honest and bounded:

- Interception is `PATH`-based. A direct absolute-path call such as
  `/usr/bin/git status`, and an in-process Git library or language binding, are
  **not** intercepted and still show the overlay rows.
- A shell that rebuilds `PATH` from scratch rather than extending it loses the
  interception for that shell.
- Only `status` is adapted. `git diff`, `git ls-files`, `git commit` and every
  other subcommand keep the real Git's answer, including the overlay's deletions.
- Long-format status may print the `git add` advice line instead of
  `git add/rm`, because the only deletion has genuinely been excluded.

This is an output adaptation, not a confidentiality boundary. The empty read-only
overlay is unchanged and remains the enforcement; the wrapper never reads a
private path or a repository object, and it never touches host Git configuration,
the index, or any Git metadata entitlement. Because the wrapper ships as a file
inside the installed launcher package, an already-running launcher process picks
it up only after the package is reinstalled or the process is restarted.

Advisory reviewer and redteam launches and terminal candidate validation receive
the installed Git executable through the ordinary system-runtime projection and a
required, launcher-authenticated, read-only Git administration projection. The
authenticated owner selects it: the launcher-owned advisory review input for Codex
and Claude reviewer/redteam launches, and the authenticated terminal candidate for
terminal validation. The shared resolver in
`launch-isolation-findings-git-metadata.mjs` derives the projection from the
launcher-created linked checkout itself: the root `.git` indirection, selected
worktree gitdir, common Git directory, primary object directory, and configured
object alternates. It requires the common Git directory to belong to the
authenticated repository and the selected worktree `HEAD` to name the authenticated
reviewed commit. It pins exact non-symlink identities, including that `HEAD` file,
through spawn and constructs an empty namespace skeleton containing only the
selected worktree gitdir, object stores, refs, and required singleton Git files.
The mutable common `.git` directory and unrelated worktree administration are never
bound. The planner revalidates a supplied projection against a fresh
checkout-derived resolution, and each launch path confirms the projection survived
into the exact plan it spawns. Missing, malformed, substituted, changed, or dropped
Git metadata refuses before spawn with the typed
`findings_git_metadata_invalid` or `findings_git_metadata_changed_before_spawn`
diagnostic and the `mechanical_failure` authority limb. A repository object store
exposes every tracked path, so the planner refuses to combine it with a sparse
declared read scope. These mounts accept no caller-selected Git environment, path,
ref, object directory, or identity, and add no write authority. Codex reviewer and
redteam launches inspect the projection through their command tool; Claude reviewer
and redteam launches receive `Bash` under the minted native-permission settings,
which deny native edit tools, so both findings roles can run read-only Git commands.

Implementation workers receive no Git administration or object-store mounts. For a
provisioned managed worker the launcher still authenticates the server-supplied
worktree binding against the checkout-derived topology, but projects none of those
paths into the worker namespace. Workers keep their family command tool (Codex
`exec_command`, Claude `Bash`) inside that namespace, so commands can edit only
`write_scope` through the bwrap write binds and see no Git storage. Workers keep
their launcher MCP capabilities and rely on host-owned validation and delivery,
which use Git outside the worker namespace.

Source selection is normalized before confinement composition. Canonical slice,
terminal whole-WK, and explicit `reviewed_sha`/`diff_base_sha` selectors converge
on one repository/base/reviewed/tree target. An explicit pair selects immutable
review bytes without becoming an authority carrier. The resolver proves commit
objects, ancestry, the required nonempty range, readable tree, and exact private
snapshot; canonical selectors additionally prove their subject binding.
Confinement consumes that normalized result and does not reinterpret it. Caller
Git environment, paths, refs, or mutation claims remain forbidden.

The wiki tool surface is not a filesystem backend and does not widen repository
visibility. For confined Claude and Codex roles, the launcher establishes a
private Unix-domain socket admission service. Each authenticated MCP command
invocation receives its own connection and host wiki-MCP process, as specified
by [decision](../wiki/decisions/decision.md) and
[MCP integration](mcp-integration.md#transport). The sandbox receives the pinned
connector and its Node executable, socket endpoint, and credential file; the
wiki-MCP server package, dependency tree, and server runtime state stay on the host.

A schema-constrained Codex findings role receives one additional launcher-runtime
support mount: the exact absolute `agent-role-result.v1` schema file passed to
Codex through `--output-schema` is hard-bound read-only at that same path. The
launcher validates and pins that regular file before spawn; it does not mount the
schema's parent directory, package, repository, Node runtime, or `node_modules`.
This file is not reviewer `read_scope` or write authority. Claude continues to
receive the same schema JSON inline through `--json-schema`, so it gains no schema
filesystem mount; free-prose and fenced launches gain neither flag nor mount.

The launcher creates the socket endpoint and mode-0600 credential file beneath
a private mode-0700 root outside repositories and worktrees, then projects them
at fixed paths in the dispatch bubblewrap namespace. The client registration
invokes the launcher-pinned stdio connector. Admission authenticates the
connection before spawning its host server; server registration and lifecycle
compatibility must succeed before acknowledgement permits MCP forwarding.
Client readiness then requires a real MCP `initialize` followed by `tools/list`
matching the exact launcher-derived role profile. Independent generations may
overlap and have separate streams, readiness observers, and settlements. The
endpoint remains available for admission until conduit teardown; named-FIFO
relays are not supported.

The spawned host server's first launcher-only event is
`wiki-mcp-launcher-readiness.v2`. It carries `ready: true`, the registered tool
surface, and `lifecycle_protocol_generation` loaded by that server process from
the conduit contract. The long-lived launcher compares the announcement with
its own loaded generation after connection authentication. Only an equal,
well-formed generation resolves server readiness; old, missing, malformed,
unknown, or incompatible generation evidence fails before MCP forwarding with
`stdio_mcp_lifecycle_protocol_incompatible`. The separate pre-spawn composition
gate is described below. Recovery detail is bounded: deploy one coherent build
and restart the long-lived backend.

The generation is not selected by a caller, prompt, model, environment,
filesystem identity, parent module cache, or historical run. There is no
backend-global compatibility fact or poison latch.

THE VERSIONING RULE. The lifecycle generation names the whole launcher-only
event GRAMMAR, not merely the set of schema versions: every event's schema
version, its required keys, its permitted keys, and the exact values the consumer
demands. The consumer validates each event against a CLOSED key set, so adding a
key to an existing event is not a compatible extension — it is a malformed event
to every consumer built before it. Any change to that grammar therefore moves the
producer's `STDIO_MCP_CONDUIT_PRODUCER_PROTOCOL_GENERATION` and the consumer's
`STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION` together, and new evidence gets its own
schema version rather than a new key on an old one. Discovery-probe close
evidence is `wiki-mcp-launcher-client-closed.discovery-probe.v1`; the ordinary
`wiki-mcp-launcher-client-closed.v1` keeps its original two-key grammar exactly.
That coupling is an obligation on whoever edits the grammar, and the automated
checks around it are narrower than the rule itself.
`tests/agent-launch-stdio-mcp-lifecycle-generation-versioning.test.mjs` records
the grammar beside the generation and fails if the set of schema versions the
producer emits, or the generation literal, moves without an explicit edit;
`tests/agent-launch-stdio-mcp-client-close-grammar.test.mjs` drives the real
producer and consumer and proves that unpermitted keys and unaccepted values are
refused. Neither detects a key added to an existing event on both sides at once
while the generation stands still, which is precisely the drift the rule above
exists to prevent.

THE MIXED-GENERATION FAILURE BOUNDARY. Under the decision local transport the
host wiki-MCP server is not spawned until a confined client has authenticated on
the launcher-owned endpoint, so the registration handshake described above runs
AFTER the confined child exists. The boundary that refuses a mixed build before
the spawn is therefore the managed composition gate, and it now reads the
producer OFF DISK rather than out of the launcher's module cache: immediately
before conduit construction the launcher runs one short-lived probe process that
imports the resolved host-server package's readiness observer and returns the
generation that server will announce. Only equality with the launcher's own
consumer generation admits the launch. A mismatch refuses with gate outcome
`spawned_producer_generation_mismatch`; an unresolvable, unspawnable, or
malformed producer refuses with `spawned_producer_generation_unavailable`. Both
are the existing `stdio_mcp_lifecycle_protocol_incompatible` blocker with the
bounded coherent-build/restart recovery, both happen before the confined child
is spawned, and neither opens a retry, a fallback transport, a permissive parse,
or a caller-selected generation. The gate outcome is carried beside that
identity; it does not become the public code, and neither outcome is published
as `operator_recovery_needed`.

CORE PACKAGE-DOCUMENT COMPOSITION. A managed session started through the
`@agent-chassis/core` `agent-launch` forwarding bin binds its sibling core
`wiki-mcp` forwarding bin before the agent-launch-cli composition root is
initialized. The handoff is process-local and first-bind-only. It accepts no
environment, argv, prompt, request, workspace, ancestor-search, or hoisting
input. A standalone `@agent-chassis/agent-launch-cli` launch intentionally makes
no such bind and therefore retains wiki-mcp's operation-level
`package_docs_carrier_unavailable` result rather than searching for core.
The forwarding launcher performs this bind only for commands that construct a
managed wiki-MCP conduit. Help and maintenance commands do not read the package
carrier and remain usable if package documentation is damaged. A composing
command reports the closed package-carrier diagnostic and exits without a raw
exception stack.

The carrier has one private core owner,
`lib/package-docs-carrier.mjs`, and is not a package-root export. Both core
forwarding bins consume that constructor. It derives the package name, version,
root, docs root, and `public-docs-manifest.json` path from its own installed
module location and the adjacent core `package.json`; the launcher does not
construct a second carrier. The core package allowlist publishes that exact
private module, not `lib/**`.

The existing managed-composition gate binds the exact forwarding entrypoint,
producer generation, core package identity and version, manifest schema and
digest, and carrier-module bytes. Its fresh-process pre-spawn probe imports the
installed carrier constructor and reads those installed bytes. The generation
factory then synchronously revalidates the identical entrypoint, carrier module,
package metadata, and manifest bytes immediately before the actual server
spawn. Every production codex-role, Claude worker/reviewer/redteam, and Codex
in-process worker/reviewer/redteam constructor reaches that gate through a
launcher-minted managed-composition authority; standalone agent-launch-cli uses
the same authority with an intentionally unbound core carrier.

For a core-bound spawn, the already-proven immutable generation crosses the
process boundary as one bounded record in the parent-to-child direction of the
existing duplex readiness descriptor. Before constructing the MCP server or
registering tools, the child reads that record and revalidates the package
carrier supplied by the private core forwarding bin against the exact
entrypoint, carrier module, package metadata, and manifest digests. It adds no
environment or argv selector, workspace lookup, ancestor search, fallback, or
second carrier owner. Replacement between probe and child binding therefore
refuses; it never falls
back to the direct wiki-mcp entrypoint or an inferred package root.

All core carrier-composition failures use the closed launcher diagnostic
`package_docs_carrier_composition_incompatible`, whose `reason` is exactly one
of `entrypoint_missing`, `carrier_missing`, `package_metadata_invalid`, `manifest_invalid`,
`generation_stale`, `package_version_mismatch`, `probe_mismatch`, or
`duplicate_bind`. This diagnostic protects composition correctness and package
identity only. It is not a confidentiality, secrecy, redaction, policy,
admission, or CCE decision, and it does not alter the work record-owned manifest,
descriptor, document-read, traversal, shadowing, or operation-diagnostic
semantics.

RESTART AND RESUME COMPOSITION. A fresh launch and a resume both mint a new
managed backend generation from the same composition root; neither replays a
stored compatibility fact. But a restart only refreshes what the launcher process
LOADED — its own consumer constant and its imported producer descriptor — while
the producer that actually runs is re-read from the worktree at every spawn. So
restarting is not a remedy for a grammar that moved without its generation: two
builds that both announce the same generation are admitted by every gate no
matter how recently either process started. The generation discipline above is
what makes a restart meaningful, and the on-disk probe is what makes a stale
long-lived launcher detectable before it spawns anything.

The launcher consumes lifecycle events through a one-way phase machine:
registration and generation, client initialize, exact `tools/list`, ready,
client close, then terminal. Duplicate or impossible evidence fails with the
first typed cause retained; later failure and cleanup attempts are idempotent.

An authenticated connection that sends a `server/discover` REQUEST before any
`initialize`, observes no transport error and no prior lifecycle failure, and
then closes GRACEFULLY is a client discovery probe, not the MCP session. The
observing host server marks only that exact protocol shape: an errored, reset,
or abruptly closed connection, a connection that later initializes, a
`server/discover` after `initialize`, a duplicate-initialize restart, and a
non-request `server/discover` all keep their existing fail-closed
classification. The conduit retires the marked generation — closing and reaping
it — and keeps the original launcher-owned client-readiness deadline for the
next authenticated generation, which becomes the facade's active one. The probe
cannot satisfy readiness, grant authority, widen or change the tool profile,
restart or extend the deadline, publish a terminal result, or suppress an
ordinary pre-initialize close. Readiness still requires `initialize`,
`notifications/initialized`, and an exact `tools/list` result from one
subsequent generation.

That probe close is reported on its own schema version,
`wiki-mcp-launcher-client-closed.discovery-probe.v1`, carrying exactly
`schema_version`, `closed: true`, and `discovery_probe: true`. Every other close
— ordinary, errored, abrupt, or after a lifecycle failure — is the unchanged
`wiki-mcp-launcher-client-closed.v1`, which permits exactly `schema_version` and
`closed` and rejects any additional key. Probe evidence whose content does not
match that exact grammar, or which arrives in any phase other than the
pre-initialize one, fails closed under its own reasons
(`malformed_client_discovery_probe_close_evidence`,
`unexpected_client_discovery_probe_close`) rather than being folded into the
ordinary close reasons.

The private root is selected from launcher-owned facts only: the per-user
runtime directory when it is valid, otherwise the passwd-derived home cache.
`HOME`, `TMPDIR`, `XDG_*`, argv, prompt text, and caller input never select it.
The selected root must be a real directory this uid owns at mode 0700 — never a
symlink, a non-directory, or a permissive mode — and a root inside the
repository or inside any git checkout, including a managed per-slice worktree,
is refused. An unresolvable root is a typed fail-closed refusal, never a
fallback to a world-writable temporary directory.

Teardown closes admission, settles the owned connections and server generations,
and removes endpoint and credential state. Each connection's stdio forwarding
and lifecycle remain independent of the other connections.

Once admission has authenticated a connection and attached
the generation, a graceful peer half-close on that socket is recorded as
authenticated client transport EOF **before** the EOF is forwarded, and the
generation's stdin is then ended exactly once. The recorded fact is clean-drain
evidence only: it says the client's MCP transport reached EOF, never that the
confined client process is terminal, and it authorizes no successful
completion. The launcher-observed confined-process exit remains the sole
authority for that.

Only after client readiness has completed at the tools/profile boundary does a
host server exiting `code 0, signal null` following that fact count as the
expected drain. It then records no server-exit failure and no launcher
termination, even while the orchestrator is still finishing — which is exactly
the case the previous behavior broke, by suppressing the EOF, reaping a healthy
server on socket close, and then reading its own escalation as an abnormal
loss. Every other shape keeps its existing typed fail-closed teardown: an
unauthenticated disconnect, a close with no preceding half-close, a disconnect
before client readiness, a spawn failure, a host exit that precedes the EOF, and
any nonzero or signalled exit.

Having forwarded the EOF, admission waits for the generation's own server-exit
settlement for one natural-exit window equal to the launcher-owned
abnormal-drain grace, so the server can leave on its own instead of being
signalled while it is already shutting down. A server that uses the window costs
no reap at all. One that does not still reaches the same memoized generation
close and the same bounded TERM-to-KILL escalation, so host-server shutdown stays
bounded by three such intervals. The window is a launcher-owned constant: no
caller, environment, config, or prompt selects it, it is entered only for a drain
that was graceful — so a teardown destroying a socket that never half-closed
still disposes with no wait at all — and a generation that exposes no such
settlement falls straight through to the memoized close owner rather than gaining
a new required shape.

Confined-client terminal supervision is a separate decision, and a clean
expected host-server drain does not reach it. That drain means the client's own
MCP session ended; it is not evidence about the client process, which for an
interactive orchestrator is routinely still working. The launcher therefore arms
no terminal supervisor, schedules no signal, and records no launcher-termination
evidence for it, and the client may stay alive indefinitely afterwards. A longer
grace would only move that truncation, so there is none: the confined process's
own exit, close, or error event remains the independently observed authority
that finalizes the conduit lifecycle. Abnormal server loss, a server-exit
observation that fails outright, and a conduit failure settlement all keep the
existing bounded terminal supervision on the abnormal-drain grace, with their
existing typed originating cause, TERM-to-KILL escalation, and evidence.

Teardown has exactly one owner per conduit: a retained, awaitable settlement
created before the first resource is acquired. Every path — partial create,
launch refusal, readiness failure, killed client, forced timeout, cancellation,
child exit — drives that same settlement, so concurrent cleanup, probe, status,
and wait callers coalesce on one disposal and observe one verdict. It never
rejects; the typed cleanup failure is retained state, published additively so it
can never mask the originating failure. No terminal result is published before
that settlement completes, which means before the owned host-server generations
have been reaped and admission resources disposed.

The host-server child's `error`, `close`, and `exit` events converge on one
terminal finalizer. A spawn that failed produces no process, so the conduit
records that terminal state instead of waiting for an exit that cannot arrive.
Termination is a bounded TERM-to-KILL escalation against the live child handle —
never a recorded pid, which on a busy host can name an unrelated process — and it
returns only once the process has actually completed; a child surviving both
budgets is a typed reap failure, not a silent orphan.

Because that reap is the first disposal step, the settlement routinely terminates
a host server that is still alive, and the terminal projection reads conduit
failure only after the settlement completes. The two are kept apart by the
termination latch itself: the cleanup owner marks that exact child immediately
before it signals, and a termination carrying the mark is the launcher observing
its own escalation rather than an abnormal server loss, so it records no
server-exit failure and cannot turn a healthy run into a failed one. The mark is
refused once the latch has settled, so a server that exited on its own is never
reclassified — its typed loss stands. Nothing else is suppressed: reap failures,
disposal exceptions, spawn failures, and any readiness, tool-surface, or
cancellation failure that already exists all remain primary.

Owned resources stay registered until they are successfully released. A
namespace-ready unlink or descriptor close that fails leaves the resource owned
so the single settlement retries it, rather than dropping it silently.

The launcher process owns the conduits it creates: catchable `SIGINT`,
`SIGTERM`, and `SIGHUP` drain exactly those retained settlements and then
re-raise the signal. The registry holds only conduits this process minted and
disarms when the last one settles; it never enumerates a conduit root, matches
directories by prefix, or signals a process it does not hold a handle to.
`SIGKILL` and a hard crash remain an explicit operator-recovery case. Recovery
must establish ownership of remaining processes and local endpoint/credential
state; directory prefixes or a PID alone do not establish that ownership. There
is no daemon, periodic reaper, broker, or cleanup service.

The worktree identity and the R∪W authority a dispatch carries are not conduit
input fields. Raw caller-shaped `worktreeIdentity` / `writeAuthority` values are
refused. Family adapters resolve canonical carriers — the managed worktree
provisioning binding, the frozen worker scope authority, the commit tuple — and
a single shared launcher-owned composition boundary validates those carriers
against the assigned unit, family, role, workspace, scope sets, and cross-run
identity, then mints one branded, frozen authority object. The conduit accepts
only that object, and only when it was minted for exactly the family, role,
unit, and workspace being launched. Freezing a value never makes it launcher
authority; provenance does. The authority mode is derived from the role
(`assigned` for a managed worker, `read_only` for findings roles, `coordination`
for an orchestrator) and is never selectable by a caller or a call site.

Conduit creation, validation, readiness, authority composition, failure mapping,
and teardown are one family-neutral implementation. Claude and Codex differ only
in the frozen client registration projection described below.

For a managed findings launch carrying a supported trusted contract, the
composition boundary first authenticates the exact canonical findings-route
admission against the assigned unit, subject, technical role, standalone
purpose, frozen-contract digest, and launcher run. Codex and Claude carry the
same admission object; neither derives managed transport from a role label.
Terminal whole-WK and exact-slice reviewer contracts retain their existing
reviewer-owned binding. The same boundary then publishes the contract's exact query projection as a
mode-0400 regular file beneath the conduit-owned mode-0700 private directory.
Only the host wiki-MCP server receives the launcher-minted path; the confined
child receives neither path nor bytes, and its namespace gains only the existing
admission endpoints. The server-side protocol, authenticated managed-run binding,
supported contract discriminators, pagination, cursor grammar, and content-free
refusal contract are normatively specified in [Frozen reviewer-query
protocol](mcp-dispatch-runtime-contract.md#frozen-reviewer-query-protocol).
This page owns only the private transport and cleanup lifecycle.

The same branded findings context carries an action-private review-materialization
root distinct from the canonical launcher/run-state root. For canonical design
reviews, both family adapters forward that root unchanged. The host server keeps
`WIKI_MCP_WORKSPACE_DIR` bound to canonical launcher identity, but binds
`workspace_read_page` through the launcher-only
`WIKI_MCP_REVIEW_MATERIALIZATION_DIR` to the frozen checkout projection. The
variable is accepted only for reviewer/redteam profiles and is never a caller or
prompt selector. Consequently direct checkout reads and MCP page reads share the
same frozen WK and selected controlled-contract/proof bytes, while completion and
run identity continue to authenticate against the canonical root.

Frozen assignments may also select immutable work-record entry material. The
launcher resolves those refs only from the selected canonical source set,
checks the recipient's source visibility, and captures the complete
referenced WK closure through the same private snapshot owner. For a managed
worker, visibility is coverage by the frozen resolved read and write membership
at the scope-existence base, minus the launcher exclusions, through the same
containment predicate the scope tree owns; a glob admits only records present at
that base, and a reference never grants source access by itself. Reviewer
findings capture keeps its own declared read/repository/write check.
Every reference must belong to the trusted repository identity bound to the
canonical repository. A reference or `record.repo` never supplies that identity.

Reviewer and redteam capture uses the workspace alias that the registered
`workspace_agent_dispatch` route resolved from the server's configured workspace
mappings. The wiki-MCP composition root supplies that same mapping and resolver
to the dispatch backend, which re-resolves the alias and accepts it only when its
configured directory canonicalizes to the backend's own main repository. The
advisory dispatch request carries no directory, and ambient environment or Codex
configuration is not consulted. Nonempty material with no composed binding or an
unconfigured alias refuses before launch with the resolver's
`work_record_material_repository_unavailable` diagnostic preserved in the
refusal detail, and an alias configured for another directory refuses as
`review_repository_binding_mismatch`.

Managed worker preparation consumes the alias and directory that the same route
resolved together for the launch, from any supported server attachment. The
managed provisioning wrapper replaces the executor workspace with the slice
worktree and forwards that resolved pair unchanged beside it. Brief preparation
accepts the alias only when the directory canonicalizes to the provisioned main
repository; no duplicate alias declaration, ambient environment, or Codex
configuration participates. Nonempty material with an absent, partial, or
foreign-root binding refuses with `work_record_material_repository_unavailable`.
A worker brief refusal reports the renderer's diagnostic code as its
`wrapper_gate_code` and carries the renderer diagnostics into the launch refusal
detail; `missing_agent_brief` remains only for a brief that is absent without a
renderer diagnostic. An unmanaged local worker resolves the alias that
launcher-owned configuration maps to its canonical read root
(`resolveLauncherConfiguredWorkspaceAlias`).

On every path a reference naming another repository remains denied even when its
record, entry, and version identifiers match.
Dispatches without entry material do not consume the identity. Ordered
identities, provenance, and text participate in the existing descriptor freeze.
There is no ambient-host fallback and the confined worker receives no new MCP
grant.

The artifact participates in the conduit's single retained cleanup settlement.
Normal cleanup unlinks it before removing the private directory; a failed unlink
remains owned, is retried by settlement, and produces the existing typed cleanup
failure without suppressing cleanup of admission endpoints, host-server
generations, or other resources.

Claude and Codex receive only launcher-generated client registrations. Claude
uses `--mcp-config`, `--strict-mcp-config`, and the role-specific tool allowlist.
Codex receives one exact top-level `mcp_servers` override containing only the
`wiki` stdio connector. Its launcher-owned `startup_timeout_sec` is the exact
seconds projection of the shared client-readiness budget, so Codex cannot abandon MCP
before the launcher's initialize-plus-`tools/list` window ends. Repository
settings, user settings, prompt text, ambient environment, and caller
configuration cannot add, replace, retarget, or shorten the server registration.
Agy has no supported confined registration adapter and fails closed.

For the local-socket transport, that shared client-registration projection runs
the pinned connector with the Node executable already running the launcher. The
launcher derives it only from `process.execPath`, canonicalizes it to an absolute
regular executable, and binds that exact file read-only at the same path in a
bubblewrap namespace. It never resolves connector Node from `PATH`, the task
repository, task `node_modules`, caller arguments, prompts, `HOME`, or environment
overrides. Consequently neither a confined task nor an operator's consuming task
environment needs a global `/usr/bin/node` or any task-level Node toolchain.

## Frozen worker assignment capture and authority

The launcher-frozen worker scope snapshot is the single authenticated carrier for
BOTH the namespace a managed worker receives and the task it receives. Alongside
the frozen scope authority, the freeze resolves the selected assignment material
through the shared entry-material resolver, using the repository identity the
dispatch route already resolved and a loader memoized over the captured record
population. The assignment's own record is served from the captured bytes, so a
later on-disk version cannot be bound after the freeze authenticated it; every
other declared source still loads canonically and keeps the resolver's existing
repository and declared-visibility checks. The resolver's diagnostics refuse the
freeze, and no worker is spawned.

Capture is not a capability. The material references remain identities: they
confer no additional read or write access, and the assignment they produce never
widens R union W, the mutation targets, the private-family exclusion at
`wiki/contracts`, or the worker MCP tool profile.

Authentication of the handoff is separate from scope authority and allocates no
lifecycle. The managed provisioning wrapper mints one frozen assignment bound to
the exact unit address, canonical source digest, run id, monitor handle, and
provisioned worktree, and registers it privately. A family adapter authenticates
that exact value before it prepares a launch. What crosses the boundary is
immutable presentation and identity only — the composed prompt, the launch
packet, the canonical summary and brief, and the resolved terminal-result mode.
The raw work record, the private controlled-proof carrier, and the launcher-
private provisioning ticket do not cross it, and a caller prompt, request field,
or environment value can neither create nor replace the value.

The complete delivery path, its content rules, its four stable transport
diagnostics, and the surviving non-presentation canonical reads are described in
[MCP dispatch launch and admission](mcp-dispatch-launch-and-admission.md#one-frozen-worker-assignment-for-every-managed-family).

## Launcher agent session contract (normative)

This section is the sole normative specification of
`launcher-agent-session-contract.v1`. The carrier is an authenticated,
deterministic projection of the branded
`launcher-stdio-mcp-conduit-authority.v1` owned by
`stdio-mcp-conduit-authority.mjs`; it is not another authority or policy engine.

### Closed schema and field semantics

The top-level JSON object contains exactly these twelve keys, with no unknown,
duplicate, missing, or role-forbidden fields: `schema_version`, `role`,
`assigned_unit`, `repository`, `read_scope`, `repo_paths`, `write_scope`,
`lifecycle`, `capabilities`, `completion_transport`, `minting_provenance`, and
`contract_digest`.

- `schema_version` is exactly `launcher-agent-session-contract.v1`.
- `role` is exactly `orchestrator`, `worker`, `reviewer`, or `redteam`.
- `assigned_unit` is closed at `record_id`, nullable `slice_id`, and canonical
  `address`. Orchestrator sessions accept exactly `IN-[0-9]{4}`, copy that
  address to `record_id`, and require `slice_id: null`. Worker, reviewer, and
  redteam sessions accept exactly `WK-[0-9]{4}` or
  `WK-[0-9]{4}#SLICE-[0-9]{3}`; their `record_id` is the WK address and their
  `slice_id` is null or the exact `SLICE-[0-9]{3}` suffix. Partial matches,
  whitespace, arbitrary suffixes, and cross-role initiative/WK addresses
  refuse. `repository` is closed at launcher-resolved, repo-qualified
  `repository_id`.
- `read_scope`, `repo_paths`, and `write_scope` remain distinct. Each is a
  duplicate-free, bytewise-sorted array of normalized repository-relative
  selectors.
- `lifecycle` is closed at `position` and nullable `review_purpose`.
  `review_purpose` is `standalone` or `terminal_whole_wk` for reviewer/redteam
  and null for orchestrator/worker.
- `capabilities` is a duplicate-free bytewise-sorted population of stable
  identifiers proven present in the launcher capability-registry snapshot.
- `completion_transport` is closed at `transport_id`, exactly one of
  `coordinator_control`, `managed_slice_delivery`,
  `workspace_submit_for_review`, or `standalone_findings`, consistent with the
  resolved role/runtime route.

### Canonical serialization and digest

Canonical serialization is UTF-8 JSON with recursively bytewise-sorted object
keys, no insignificant whitespace, normalized scope/capability/source-binding
arrays, and no Unicode or numeric coercion. `contract_digest` is
`sha256:<lowercase-hex>` over the canonical bytes of the entire closed object
with `contract_digest` omitted. Every consumer recomputes it before using a
field.

### Minting provenance and decision

`minting_provenance` is closed at `issuer`, `authority_schema_version`,
`authority_digest`, `capability_registry_digest`, `trusted_source_bindings`, and
nullable `operator_action_binding`. `trusted_source_bindings` is the complete
bytewise-sorted population of closed `kind`/`id`/`digest` tuples.

`operator_action_binding` is null unless a separately authenticated accepted
action applies. Its decision form is closed at `decision_id` (exactly
`decision`), `action_id`, `authenticated_actor_binding_digest`,
`selected_findings_source_digest`, and `action_binding_digest`, which binds the
other four fields. Raw requests, prompts, argv, ambient environment, wrappers,
AGENTS.md, and filesystem bytes never mint or widen a contract fact.

### Consumers, compatibility, and coherent cutover

Codex and Claude consume one family-neutral carrier for all four roles. Each
family admission seam recomputes the digest and compares every resolved fact
before readiness. Host wiki-MCP authenticates the exact launcher-startup carrier
against launcher facts. Prompt prose is presentation derived only after
validation. Monitoring exposes a bounded read-only projection with the same
`contract_digest` and never mints, repairs, or widens the carrier.

The cutover is coherent and v1-only. Producers emit only
`launcher-agent-session-contract.v1`; Codex, Claude, host wiki-MCP, prompt, and
monitor consumers accept only v1. The former partial completion credential is
rejected as unsupported and is never translated, dual-read, or reconstructed
from prose.

### Stable refusal contract

Every failure occurs before child or host readiness in the existing closed
`stdio_mcp_conduit_input_invalid` envelope, with exactly one of these ten codes:

- `session_contract_missing`
- `session_contract_schema_unsupported`
- `session_contract_shape_invalid`
- `session_contract_authority_untrusted`
- `session_contract_fact_mismatch`
- `session_contract_digest_mismatch`
- `session_contract_capability_unknown`
- `session_contract_completion_transport_mismatch`
- `session_contract_operator_action_binding_invalid`
- `session_contract_consumer_version_mismatch`

No completion credential, AGENTS.md, prompt, environment, argv, wrapper, prose,
or monitoring fallback repairs a refusal.

### Supported compatibility census

The exact supported population is 24 combinations: four roles multiplied by
Codex/Claude multiplied by AGENTS.md present/empty/absent. For equal launcher
facts, each role/family three-state group has byte-identical complete carrier
bytes and digest. AGENTS.md may affect only human-reference metadata outside the
carrier and digest. Unsupported role/family/state combinations refuse.

### Historical completion credential (retired)

Before the coherent session-contract cutover, findings-role launches carried
`launcher-stdio-mcp-completion-credential.v2`. That retired envelope had five fields:
`schema_version`, `completion_transport`, `canonical_repository`, `assigned_unit`,
and the launcher-derived `technical_role`. A v1 credential is never upgraded,
repaired, or inferred; because a v1 envelope carries a different field set, an
unsupported schema is classified before the current field inventory is applied,
so an authentic older credential fails as a schema mismatch rather than as a
malformed object.

Three owners, and no others, hold any part of this contract:

- `workspace-agent-role-contract.mjs` is the sole SEMANTIC route classifier.
  `classifyLauncherFindingsCompletionTransport` decides a route's completion
  transport from the launcher-minted `canonicalRepo` signal and the role.
  Nothing else may spell a transport out or grow a parallel predicate.
- `stdio-mcp-conduit-core.mjs` is the sole minter, authenticator, and refusal
  owner. `mintStdioMcpCompletionCredential` is the only way a credential comes
  into existence; `authenticateStdioMcpCompletionCredential` is the only thing
  that validates a transported one against launcher-resolved expected facts.
  These are DISTINCT operations: the composition facade exports both and must
  never alias authentication to minting, which would turn every check into a
  re-derivation from facts already trusted and validate nothing.
- The Claude and Codex family modules are MECHANICAL consumers. They select
  which expected facts their route completes against, forward the credential,
  and project the authenticated result's own fields into the conduit input. They
  hold no field inventory, no mismatch classifier, no refusal-envelope
  constructor, and no call to the minter. A source scan in
  `tests/workspace-agent-family-adapter-boundary.test.mjs` fails on any of these
  reappearing in a family-named module.

The conduit input is a closed carrier set that accepts the credential's FACTS
(`completionTransport`, `canonicalRepo`) and never a credential object. The child
receives the launcher's projection as `WIKI_MCP_COMPLETION_CREDENTIAL` and cannot
mint or replace it from prompt, caller, or ambient environment.

### Credential refusal contract

Every credential failure is a PRE-SPAWN refusal through the shared
`stdio_mcp_conduit_input_invalid` contract, carrying the exact failed fact as a
stable `mismatch_class`. It occurs before the conduit exists, so no host server,
transport, or child is created. A credential failure is never relabelled as an
absent or unconfigured family backend — that relabelling is precisely what would
hide a broken credential path behind a plausible environment excuse.

| `mismatch_class` | Failed fact | Supported recovery |
| --- | --- | --- |
| `credential_absent` | No credential reached a route that requires one | Restore launcher credential forwarding in the family executor |
| `credential_malformed` | Not a credential object, unusable `schema_version`, wrong field closure for v2, or an unusable fact | Mint through the sole minter; do not hand-build an envelope |
| `credential_schema_mismatch` | A present but unsupported schema, including an authentic v1 envelope | Re-mint at v2; v1 is never upgraded |
| `completion_transport_mismatch` | `completion_transport` contradicts the classifier's result for this route | Fix the route classification input, not the credential |
| `canonical_repository_absent` | The route expects a canonical repository and the credential carries none | Supply the launcher-minted `config_root_dir` |
| `canonical_repository_mismatch` | `canonical_repository` disagrees with launcher-resolved facts | Re-dispatch against the correct canonical repository |
| `assigned_unit_mismatch` | `assigned_unit` is not this run's unit | Re-mint for the assigned unit; credentials are not transferable |
| `technical_role_mismatch` | `technical_role` is not the launcher-resolved role | Re-dispatch under the correct role |

### Registered family and route coverage

Credential forwarding is proved as one table over the REGISTERED inventories, not
a hand-maintained census: the family axis is
`STDIO_MCP_CONDUIT_ALLOWED_FAMILIES` and the route axis is the registered
findings-route population — standalone reviewer, exact-slice reviewer, redteam,
and terminal whole-WK reviewer. That is eight rows across Claude and Codex, and
each row exercises its family's real production conduit-input boundary.

The matrix binds the `work record` review finding
`work record-S020-R1-F001`: a family executor that forwards no credential must fail
as `stdio_mcp_conduit_input_invalid` / `credential_absent` with zero conduit
calls. That regression is why the row enters through the production producer
rather than injecting a credential by hand.

Adding a supported family or a registered findings route without explicit
credential-forwarding coverage fails the coverage assertion in
`tests/workspace-agent-findings-route-family-forwarding.test.mjs`.

## Native proof provider execution

`workspace_verify_proof` executes a provider-qualified native proof selection
through the same confined proof runner as node:test proofs: a read-only,
secret-masked, network-denied bubblewrap namespace with `--unshare-pid` and
`--die-with-parent`, a launcher-minted clean environment, bounded diagnostic
streams and one lossless protocol envelope on launcher-owned fd 3. Standard
output and exit status are diagnostics only; the provider's authenticating
decoder accepts the digest-bound, attempt-nonce-bound phase envelope and refuses
duplicated, missing, reordered, cross-attempt, stale-source or digest-mismatched
observations with stable codes.

Only installed launcher composition supplies executable authority. The catalog
descriptor must be bound to an installed integration; the pytest integration
resolves the launcher's `python3`, or for a target configured by published local
test-runtime readiness exactly that record's prepared project interpreter, and
locates its pytest runtime without importing it. A configured target whose
readiness is missing, invalid or stale refuses; it never falls back to `PATH`. The runtime identity digests the interpreter binary, the installed
Python provider entry and the complete package tree of every import package in
pytest's installed requirement closure, resolved from distribution metadata with
environment markers applied. Every input is re-measured before each confined
spawn, a moved or changed input refuses, and only those inputs are bound
read-only. The consumer repository is never searched for launcher assets and the
consumer dependency projection (`node_modules`) is not mounted. Each run ignores
cached bytecode through a private empty `pycache_prefix`, refuses sourceless
bytecode, and reports the top-level modules it imported from outside the consumer
root, the runtime packages and the standard library; a non-empty population
refuses with `test_proof_native_dependency_population_unsupported`. A caller
supplies no executable, argv, environment, mount, module, callback or dependency
root.

Provider preparation is itself a confined probe of the installed runtime and
receives the same remaining execution budget as the attempts that follow. The
request's MCP cancellation signal and the invocation deadline share one
launcher-minted budget; the runner accepts only a minted budget. Expiry or
cancellation SIGKILLs the confined child, which reaps its PID namespace; the
capture settles when the child closes or after a five-second live cleanup
allowance, reporting `test_proof_execution_cleanup_failed` distinctly. The
server shutdown allowance is unchanged.

## Native proof attempt execution

Native proof families other than node:test and pytest run each preparation
probe and attempt through one launcher-owned confined invocation. It uses the
same validation confinement planner, output bounds, execution budget,
cancellation and cleanup allowance as the proof runner. Its closed inputs are
the launcher-minted proof attempt, the checkout under test and the repository
that owns the published test-runtime readiness. No caller supplies an
executable, argv, environment, cwd, mount or root.

The launcher binds these read-only at their recorded paths: the recorded
toolchain roots, the detected dependency installations, its observer assets and its own
attempt driver with the driver's working-copy copier. Proof execution alone binds the host's actual `/tmp` at `/tmp`
and sets `TMPDIR=/tmp`; the shared launcher baseline and ordinary validation
retain their private `/tmp` mount. Each native proof invocation mints a unique
`/tmp/agent-chassis-proof-*` root for `HOME`, caches, instrumentation and
its working copy, and removes that owned root after completion, failure or
cancellation without touching other `/tmp` entries. The driver receives a closed
plan on stdin. It creates the attempt's working copy of the project
from exactly the project-relative entries the plan lists, which the launcher
selects through Git before launch (see
[Local test runtime setup](local-test-runtime-setup.md#verification-and-readiness)):
files keep their current bytes and modes, links are recreated unfollowed, and
nothing outside the list is read. It links the
detected dependency installation into the copy and writes the launcher's
instrumented sources, observer configuration and observation channel.
It then starts the runner and relays one framed message on launcher fd 3: its
status line, then the channel bytes with their length and digest. That status
separates working-copy and launch failures from test outcomes. A missing or
malformed frame yields no evidence. The repository's `.agent-launch` runtime
state, including the readiness record itself, stays masked inside the attempt.
Setup's in-sandbox verification probes run through the same confined-invocation
machinery before readiness is published, but retain the ordinary private-temp
posture because they are setup validation rather than `workspace_verify_proof`.

## Prepared test runtimes in the coding worker

A managed implementation worker's ordinary commands use the toolchains and
dependencies the operator installed and local test-runtime detection
published, inside the same sparse confinement. Codex and Claude reach one family-neutral composer
(`test-execution/worker-runtime.mjs`) with only launcher-settled facts: the
canonical repository, the worker checkout and the frozen worker scope
authority. It loads the published readiness record, resolves each resolved
scope member to its containing prepared environment (per ecosystem, longest
containing installation root), and re-proves each such environment through the
same runtime-input owner the verifier uses. An environment with no proved
runner is projected like any other. No caller supplies a root, mount, path,
environment or readiness record, and no ancestor search is made. A repository
that was never prepared gets no projection; the launch is unchanged.

A current preparation that is `preparing` or `failed` is not a runtime the
worker can use and is never read as "nothing prepared". When the worker's
scope reaches any environment of that preparation, the composer throws
`WorkerTestRuntimePreparationError` and the launch refuses before any worker
starts with `agent_launch.worker_test_runtime.preparation_unusable.v1`. Its
detail keeps the readiness code, the preparation identity, the required
environments, the deciding failure, component and check codes, the producer's
complete original result and the `readinessRecovery` wording, without bounding
or path redaction. Both families refuse through the shared
`launch-failure-cause.mjs` transport: Codex while its worker plan is built
(`plan_build_threw`) and Claude in its spawn catch, each after its usual
cleanup, with conduit cleanup evidence secondary. A worker whose scope reaches
none of that preparation's environments composes nothing and launches.

The composer freezes one runtime identity (repository, checkout, selected unit,
source digest, readiness digest, per-environment public ID, workspace members,
proved runners, dependency and toolchain identities) and a launcher-minted
command table. The table is published
content-addressed and read-only under the canonical repository's
`.agent-launch/test-runtimes/worker-runtime/`. The planner then binds, read-only:

- each selected toolchain's recorded installation at its own path, and each
  non-npm detected dependency installation (a virtual environment or the
  interpreter's site packages outside the system roots, the `DENO_DIR`, the
  `GOMODCACHE`, a vendored Cargo directory, or only the `registry`/`git` stores
  of `CARGO_HOME` plus a `CARGO_HOME` configuration file that declares
  vendoring) at its own path, outside the source tree. A store's parent (such
  as the whole `CARGO_HOME` with its credentials) is never bound. A toolchain source that equals or contains `HOME`, the
  canonical repository or the worker checkout, or lies inside the checkout, is
  never bound: that project reports `test_runtime_toolchain_bind_too_broad`
  with the source and the protected root it contains;
- the installed npm `node_modules` at `<checkout>/<project>/node_modules`. This is
  the only in-repository read-only mount a sparse worker receives, and only this
  launcher-composed projection can supply it. Caller `readOnlyRoots` inside the
  repository still refuse with `sandbox_write_denial`. Each workspace member
  link in it is relative (`node_modules/<name> -> ../<member>`), so inside the
  namespace it resolves to that member's source in the worker's own checkout,
  never to the canonical repository or the installation's own location. Every linked member
  directory must already be visible in the worker's frozen read or write scope;
  otherwise the environment reports
  `test_runtime_workspace_member_outside_scope` with the member directories for
  the coordinator to add, and the scope is never widened;
- the table at `/agent-launch-test-runtime` and the package command entry
  (`test-runtime-entry/entry`) at `/agent-launch-test-runtime-entry`.

A private tmpfs at `/agent-launch-test-runtime-scratch` holds per-project
mutable build, cache and temporary state. The model's `HOME`, configuration,
authentication and conduit environment are unchanged. The child `PATH` gains
`/agent-launch-test-runtime/bin` first. Each projected command name (`node`,
`python3`, `go`, `gofmt`, `cargo`, `rustc`, `deno`) there is a link to the one
entry.

The entry reads only the frozen table. It selects the row by the command name
and the canonical working directory, then `exec`s the recorded executable, so
the caller's argv, streams, exit status, signals and cancellation are
unchanged. Each ecosystem owner's closed `projectCommands` fact decides which
commands need a project environment: `python3`, `go`, `cargo` and `deno` do,
while `node`, `gofmt` and `rustc` are toolchain-only.

A project command runs only from inside a prepared project, with that project's
ecosystem environment:

- Python runs the project's detected virtual environment (or the detected
  interpreter when the project's requirements are installed there);
- Go runs with the read-only module cache, `GOPROXY=off`, `GOFLAGS=-mod=readonly`
  and `GOWORK=off`, with `GOCACHE` and `GOPATH` in scratch;
- Cargo runs the caller's own arguments offline against the detected source
  (the project's vendored directory, or the `CARGO_HOME` registry with
  `CARGO_HOME` naming it), exactly as the verifier does, plus the recorded
  `RUSTC` and `RUSTDOC`.

Outside every prepared project, a project command exits 127 and names the
prepared project directories it can run from. An argv path never selects
another project's dependencies. A harness started through `#!/usr/bin/env <name>`
keeps the interpreter its launcher search path resolved, so the projected
commands never change the coding model, MCP host or connector executable.

Apart from an unusable required preparation, a missing, invalid or stale
runtime is not a dispatch gate. The affected rows
report the exact condition when the runtime is used, with its subject, effects,
uncertainty, actor and action: `readinessRecovery` (the operator repairs the
named installation, then local test-runtime detection, whose producer is
`agent-chassis setup --test-runtimes`, runs again), or the missing dependency input files or workspace member
directories for the coordinator to add to scope. The same applies to an
incomplete installation (every missing executable and its expected path), a
stale input or population, or a prepared link into a repository that is not a
declared workspace member (local package provenance). No host runtime is substituted, and no
readiness or completion summary claims a command ran.

The final pre-spawn check (`assertWorkerTestRuntimeMountsUnchanged`, reached
from `spawnIsolated`) reloads the record and compares it with the projection's
`identity.readiness_digest`. A preparation that changed after composition
(preparing, failed or a newer ready record) refuses with the same code and
`test_runtime_preparation_changed`. This is a launch-time check; it does not
revoke a worker already running.

Launch selection is frozen. Ordinary commands are evidence of execution with
that frozen runtime. They do not establish that a dependency input edited later
matches it. Explicit `workspace_verify_proof` checks its own currentness.

Mountpoints follow the shared sparse-worker lifecycle:

- A destination below only skeleton directories is created inside the
  namespace, before the read-only remount.
- A destination below a visible host directory needs an empty host leaf. Only
  the missing leaf is created (never a parent), with the shared sparse-worker
  leaf primitive, and it joins the attempt's precreation cleanup.
- An occupied destination (file, symlink or populated directory) refuses with
  `agent_launch.isolation.test_runtime_projection_refused.v1`. The refusal
  reports `authority_limb: mechanical` and leaves the occupant unchanged. So do
  a scope member at or below the destination, and a dependency source that is
  also reachable through a writable or runtime root.
- An existing empty leaf is used but never becomes launcher-owned.
- Dependency binds follow every writable bind and precede the final secret,
  private-family and decision masks, so an authorized writable ancestor keeps
  its dependency child read-only.
- Source and mountpoint identities are rechecked immediately before spawn.
- After the child terminates, only still-empty, identity-matching leaves this
  launch created are removed. Replaced or populated ones are preserved.

## Optional stdio-MCP transcript capture

The conduit carries one optional observability seam, and it is dormant. The
composition root's `spawnServer` dependency is
`spawnStdioMcpServerWithTranscriptCapture`
(`agent-launch-cli/src/lib/stdio-mcp-transcript-capture.mjs`); with no transcript
destination it is `child_process.spawn` verbatim, so an ordinary launch spawns
exactly the process it always did and writes nothing.

A destination arms it: `AGENT_CHASSIS_MCP_TRANSCRIPT_ROOT`. The launcher
re-validates that value in its own process — absolute, an existing real directory
this uid owns at mode 0700, never a symlink — and mints each per-generation
session directory itself at 0700 with 0600 files. The wrapper receives that exact
minted path as argv and resolves, creates, or selects nothing, so no caller,
prompt, model, confined process, or child can steer capture at a path of its
choosing. An invalid destination disables capture with a diagnostic; it never
refuses a launch.

The capture point is the generation spawn, one hop before the unchanged host
wiki-MCP server the launcher resolved and validated for itself. The wrapper is
byte-transparent in both directions and holds no protocol knowledge: it parses,
reframes, redacts, truncates, and reserializes nothing, ordering follows the sink
write that releases each chunk, and backpressure reaches the producer rather than
growing an unbounded queue. It executes the server with the launcher-minted
environment and working directory unmodified, and every launcher-only auxiliary
descriptor is inherited by number: readiness on fd 3 and the authenticated no-CCE
declaration on fd 4 when present. Their bytes cross unchanged with nothing on
their path. The server's terminal
state is mirrored exactly — a signalled loss is re-raised as a signal rather than
flattened into an exit code — so readiness, admission, the lifecycle phase
machine, reaping, and the single teardown settlement observe what they always
observed.

It carries no authority. It cannot widen a tool surface, a write scope, a
namespace, or a repository visibility set; nothing consults it for readiness,
admission, lifecycle, or teardown; and it sets no `NODE_OPTIONS` and preloads
nothing into any other process. It is not a proxy, does not replace, move, or
shadow the wiki-MCP server entrypoint, and every failure inside it degrades to
pass-through with the failure recorded in the session metadata for an evidence
consumer to classify. Capture is never allowed to cost a run its MCP surface.

Per session the seam records `request.bin`, `response.bin`, `session.json`, and —
only when the server actually emits stderr — `server.stderr.log`. A capture
verdict is therefore a separate fact from a run verdict, and a consumer must
report the two independently rather than deriving one from the other.

`session.json` also carries `server_source`
(`stdio-mcp-server-source-census.v1`), the content identity of the implementation
that served the session. The census is selected from the resolved server
entrypoint, never from a label, command line, or transcript: the declared
workspace packages of the nearest `package.json` whose `workspaces` contain the
entrypoint, plus that root's `package.json` and `package-lock.json`
(`workspace_packages`); when the entrypoint lies inside that workspace root but
outside every declared package, the same packages, manifest, and lockfile plus the
entrypoint file itself (`workspace_packages_and_entrypoint`); otherwise the
nearest package directory (`package`); otherwise the entrypoint file alone
(`entrypoint_file`). Every regular
file in the census is hashed as it exists in the working tree, so uncommitted and
untracked bytes count. `node_modules` trees are excluded, with third-party
dependencies represented by the lockfile, and symbolic links are recorded by link
text without being followed. Git-ignored runtime state that lives inside a census
directory is hashed like any other file, so such state can make identical
implementations report different digests (never the reverse); keep test and run
output outside the census. Paths are sorted relative to the census root, so equal
content in another checkout has an equal digest. The census is observed
synchronously before the server is spawned and again after it closes, within a
bound of 50,000 entries and 2 GiB. Equal observations publish `state: "stable"` and
`content_digest`, which also becomes the journey measurement's
`source.content_digest`. A census that changed during the session, exceeded its
bound, or could not be read reports `changed` or `unavailable` with no digest,
which leaves the measurement identity incomplete. Source observation is evidence
only: it does not change the capture status or the mirrored run verdict.

The destination reaches the whole dispatch tree. The host wiki-MCP server owns
structured dispatch, so the conduits for managed worker, reviewer, and redteam
roles are minted inside that process from its own environment; the resolved
destination is part of the launcher-minted server environment
(`buildServerEnv`) for exactly that reason, and each of those conduits mints its
own session directory in the same root. What is forwarded is the already-resolved
path, never the raw variable: it passed validation in the forwarding process and is
validated again in the receiving one, so an invalid destination is dropped at the
boundary rather than propagated. This carries no authority with it — the server
environment's tool profile, assigned unit, workspace, and commit tuple are
unchanged, and a transcript destination grants nothing.

## Anonymous MCP metrics destination

`AGENT_CHASSIS_MCP_METRICS_ROOT` is a separate, independent host setting for
[anonymous MCP metrics](mcp-telemetry.md). It follows the same forwarding shape as
the transcript destination without sharing its root, validator, or capture seam.
`resolveMcpMetricsConfig` (`agent-launch-cli/src/lib/mcp-metrics-config.mjs`) is the
only metrics root policy: absolute, an existing real directory this uid owns at
mode 0700, never a symlink. The launcher-minted server environment
(`buildServerEnv`) includes only the root that resolver accepted in the launching
process, so an invalid value is dropped at the boundary rather than handed down.
The receiving host server resolves it again before writing, and a host server that
dispatches nested managed runs forwards its own re-resolved root through the same
builder.

The conduit's closed launch input has no metrics field, so neither a caller, a
prompt, a model, nor a confined worker can select the destination, and the
directory is never mounted into the confined sandbox. Metrics carry no authority
and do not enable transcript capture. The host server's existing close hook
flushes the writer on a graceful client EOF; launcher SIGTERM or SIGKILL, abrupt
disconnects, and teardown deadline races can lose buffered records or leave a
partial final gzip member, as documented in the metrics reference.

Trusted writes remain inside their owning host process. The launcher runtime
owns launch, probe, worktree provisioning, review-surface preparation, and slice
integration. The host wiki-MCP server owns the closed-input commit capability.
The orchestrator-only forge tool invokes the existing launcher-owned host
executor in-process. There is no broker, endpoint, socket transport,
general-filesystem transport, in-sandbox MCP runtime, or compatibility fallback.

Terminal candidate construction, checkout verification, reviewer dependency
projection, final-review binding, and forge publication are launcher-owned.
The launcher creates a separate private
mode-0700 full detached checkout at exact candidate `C`; it does not repurpose,
rewrite, or mount the WK worktree. Validation uses an empty-baseline child
environment inside a findings-only reviewer bwrap composition. Source, Git
metadata, and projected dependencies are read-only; temp/cache/output roots are
isolated and writable outside repository state. Workspace-package links are
rewritten to `C`, so a host `node_modules` link cannot redirect validation to
current main. The projection exposes ordinary project dependencies only: the
wiki-MCP server and its interpreter/package tree remain outside bubblewrap, and
no broker, listener, relay variant, mounted server runtime, dependency copy, or
package installation is introduced. Candidate authority is launcher-resolved
and never crosses the conduit as caller, prompt, environment, or model-output
authority.

The projection is bound read-only at the exact `<candidate-checkout>/node_modules`
path. Because the candidate checkout is mounted read-only, bwrap cannot create
that mountpoint under it, so the launcher creates exactly that one empty
untracked mountpoint directory before confinement, pins its canonical path,
directory type, and filesystem identity, and re-proves them at the final shared
pre-spawn boundary used by both Codex and Claude terminal findings launches. The
mountpoint is the sole permitted addition to the checkout; a symlinked,
redirected, non-directory, non-empty, tracked, preexisting-untrusted,
type-swapped, or identity-swapped destination, or any writable/runtime bind
overlapping the checkout, destination, or dependency source, fails closed before
spawn. The read-only dependency projection bind is the only bind emitted at that
destination — the candidate checkout and dependency source are never made
writable and no parent directory is bound — and the candidate commit `C`, tree,
tracked checkout bytes, HEAD, refs, index tree, Git metadata, and projected
dependency contents are preserved byte-for-byte.

Standalone and normalized immutable-range snapshots use the same exact
`<snapshot-worktree>/node_modules` destination and the same shared Codex/Claude
pre-spawn confinement checks. Their elected receipt retains the projection selection
and frozen bind plan as execution evidence. Replacement revalidates that retained
content-addressed root; it never rebuilds a selection from a changed canonical
installation. Projection evidence grants no review, repository, lifecycle, snapshot,
source, generation, or election authority, and no dependency path is writable.

## Closed confined-worker probe composition

The integration suite has one direct-code-only worker probe composition for
testing the model-executable boundary. The production dispatcher still owns
worktree provisioning, assignment construction and authentication, scope
projection, bubblewrap planning and execution, MCP-conduit creation, process
supervision, and managed-run identity binding. After that plan exists, the
composition replaces only the final Codex executable with a fixed in-repository
Node program and executes the resulting plan through the normal bubblewrap
spawn path.

The probe has fixed source and receipt paths and no MCP argument, environment
variable, PATH lookup, CLI flag, callback, or executable parameter can select
it or alter its program. From inside confinement it reads the delivered
assignment, reads a token from the declared source path, authenticates to the
projected MCP conduit, lists the available tools, attempts to read a fixed
undeclared sentinel, and writes a bounded receipt through a declared writable
file. Tests correlate that receipt with independently observed managed-run and
source identities.

This is test support, not a production launcher mode and not implementation
completion evidence. It stops at worker start and assignment/source
acknowledgement. Missing bubblewrap, namespace, conduit, or launcher
prerequisites fail the test explicitly; there is no unconfined or silent-skip
fallback.

A paired fixed server entrypoint combines this same confined-worker probe with a
separate branded proof-execution-unavailable composition. The latter replaces
only the proof executor and proof provider dependencies with fixed fail-loud
unavailable implementations; it does not replace implementation dispatch,
provisioning, assignment authentication, bubblewrap, the MCP conduit, process
supervision, or identity binding. No request, environment value, PATH override,
CLI flag, or arbitrary callback selects either composition.

The owner-level composition test invokes both unavailable dependencies and
rejects an unbranded lookalike. The connected paired witness independently
observes that every server generation ran the fixed selected entrypoint and that
both the default and proof-disabled lanes reached equivalent confined assignment
and source acknowledgement with no proof execution or verification credit.
