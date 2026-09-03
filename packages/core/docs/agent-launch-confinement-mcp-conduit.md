
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

Every launcher-managed repository workspace receives the installed Git executable
through the ordinary system-runtime projection and a launcher-authenticated,
read-only Git administration projection. For a managed reviewer or redteam
running from a launcher-created linked checkout, and for a provisioned managed
implementation worker, the launcher resolves the root `.git` indirection,
selected worktree gitdir, common Git directory, primary object directory, and
configured object alternates from the checkout itself. It pins their exact
non-symlink identities through spawn and constructs an empty namespace skeleton
containing only the selected worktree gitdir, object stores, refs, and required
singleton Git files. The mutable common `.git` directory is never broadly
bound. These runtime-support mounts accept no caller-selected Git environment,
path, ref, object directory, or identity. They add no repository-content read
scope and no Git-metadata write authority; findings remain entirely read-only,
while implementation content mutation and trusted delivery remain governed by
the independently authenticated `write_scope` and host-side lifecycle.

Source selection is normalized before confinement composition. Canonical slice,
terminal whole-WK, and explicit `reviewed_sha`/`diff_base_sha` selectors converge
on one repository/base/reviewed/tree target. An explicit pair selects immutable
review bytes without becoming an authority carrier. The resolver proves commit
objects, ancestry, the required nonempty range, readable tree, and exact private
snapshot; canonical selectors additionally prove their subject binding.
Confinement consumes that normalized result and does not reinterpret it. Caller
Git environment, paths, refs, or mutation claims remain forbidden.

The wiki tool surface is not a filesystem backend and does not widen repository
visibility. The launcher starts exactly one host wiki-MCP process per dispatch
and connects it to Claude or Codex through the named-FIFO stdio conduit described
in [MCP integration](mcp-integration.md). No wiki-MCP executable, interpreter,
package, dependency tree, or runtime directory is mounted into the sandbox.

A schema-constrained Codex findings role receives one additional launcher-runtime
support mount: the exact absolute `agent-role-result.v1` schema file passed to
Codex through `--output-schema` is hard-bound read-only at that same path. The
launcher validates and pins that regular file before spawn; it does not mount the
schema's parent directory, package, repository, Node runtime, or `node_modules`.
This file is not reviewer `read_scope` or write authority. Claude continues to
receive the same schema JSON inline through `--json-schema`, so it gains no schema
filesystem mount; free-prose and fenced launches gain neither flag nor mount.

The launcher creates exactly two mode-0600 FIFO objects in a private mode-0700
directory outside repositories and worktrees, holds O_PATH references to those
exact objects, and binds them at fixed relay paths in the dispatch bubblewrap
namespace. The client registration invokes the single pinned copy-only relay.
The FIFO names are unlinked after the bound endpoints are safely open. Readiness
requires a real MCP `initialize` followed by `tools/list` matching the exact
launcher-derived role profile.

The spawned host server's first launcher-only event is
`wiki-mcp-launcher-readiness.v2`. It carries `ready: true`, the registered tool
surface, and `lifecycle_protocol_generation` loaded by that server process from
the conduit contract. The long-lived launcher compares the announcement with
its own loaded generation while constructing the conduit. Only an equal,
well-formed generation resolves server readiness; old, missing, malformed,
unknown, or incompatible generation evidence fails before the confined child
spawn with `operator_recovery_needed`. Recovery detail is bounded: deploy one
coherent build and restart the long-lived backend.

The generation is not selected by a caller, prompt, model, environment,
filesystem identity, parent module cache, or historical run. There is no
backend-global compatibility fact or poison latch. A legacy launcher that does
not recognize the v2 registration refuses through its existing server-readiness
failure during host-server startup, also before confined child spawn.

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
are the existing `operator_recovery_needed` blocker with the bounded
coherent-build/restart recovery, both happen before the confined child is
spawned, and neither opens a retry, a fallback transport, a permissive parse, or
a caller-selected generation.

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

COMMON-PROOF RESOLVER CAPABILITY. The launcher is the only owner allowed to bind
the work record receipt store to a host wiki-MCP generation. Immediately before
spawn, the conduit writes a bounded versioned carrier to a mode-private file,
opens it read-only, unlinks its name, and inherits it into the host as fixed
descriptor 5. The carrier contains exactly the launcher-resolved workspace and
repository alias. It carries no selector, lifecycle state, receipt path, root
override, proof claim, or policy result, and it is never transported through
argv, environment, MCP input, prompts, the confined namespace, or generic IPC.
The host compatibility probe validates that the installed wiki-MCP consumer
supports the producer's exact capability version before any host is spawned.

The direct wiki-MCP entrypoint authenticates and consumes that descriptor once,
then injects the resulting exact read-only resolver through the server
composition root. A present regular-file carrier with invalid mode, link state,
size, encoding, version, or binding fails as
`common_proof_resolver_capability_failed`; an unrelated descriptor kind in a
standalone Node process is not a carrier and preserves the explicitly unbound
posture. Resolver selection confers no repository visibility, mutation,
lifecycle, proof, admission, CCE, review, publication, or completion authority.

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

Teardown propagates close/EOF in **both** directions. When the host server
exits, the relay's server-to-client copy ends and the client observes EOF; when
the client closes, the relay's client-to-server copy ends and the server
observes EOF and shuts down. Either terminal event terminates and reaps the
opposite copy and the relay exits on its own within a bounded interval. A
process-level signal to the sandbox is a backstop, never the mechanism.

On the local-socket transport that EOF is a launcher-observed fact rather than
a relay side effect. Once admission has authenticated a connection and attached
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
that settlement completes, which means before the host server and relay have
actually been reaped.

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
`SIGKILL` and a hard crash remain an explicit operator-recovery case: recovery
requires correlating a FIFO inode to a live process descriptor and revalidating
the immutable process start time, never a prefix sweep or a PID-only kill. There
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

The artifact participates in the conduit's single retained cleanup settlement.
Normal cleanup unlinks it before removing the private directory; a failed unlink
remains owned, is retried by settlement, and produces the existing typed cleanup
failure without suppressing cleanup of the relay, admission endpoints, host
server, or other resources.

Claude and Codex receive only launcher-generated client registrations. Claude
uses `--mcp-config`, `--strict-mcp-config`, and the role-specific tool allowlist.
Codex receives one exact top-level `mcp_servers` override containing only the
`wiki` relay. Its launcher-owned `startup_timeout_sec` is the exact seconds
projection of the shared client-readiness budget, so Codex cannot abandon MCP
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
environment and working directory unmodified, and the launcher-only readiness
descriptor is inherited by number, so the `wiki-mcp-launcher-readiness.v2`
registration crosses the same pipe with nothing on its path. The server's terminal
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
