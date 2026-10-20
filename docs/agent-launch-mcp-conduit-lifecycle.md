# MCP conduit lifecycle

This page describes the launcher-owned stdio-MCP conduit between a confined
Codex, Claude, Agy, or OpenCode role and its host wiki-MCP server: transport,
readiness, teardown and failure reporting. Confinement and the session contract are in
[Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md);
what the conduit is authorized to carry is in
[Conduit authority and review sources](agent-launch-conduit-authority-and-review-sources.md).

## Opt-out publication configuration

The launcher captures
`AGENT_CHASSIS_PUBLISH_CONTROLLED_ACCEPTANCE_OPT_OUT=true|false` at host profile
resolution and forwards its resolved value in `configurationEnv` to each MCP
server generation. Unset resolves to `true`; malformed values refuse with
`controlled_acceptance_publication_config_invalid`. Codex, Claude and OpenCode
orchestrator launch/resume and managed-role conduits use this same carrier.
Changing the environment requires restarting the session/server.

This is presentation configuration, independent of tier, authorization and
acceptance policy. The receiving MCP host captures one publication filter before
registering tools. The same selection chooses the generated orchestrator guide
and vignette, their existing exact-file read grants and compaction hooks, and
the registered package-document routes. Disabled publication never changes the
authoritative exception schema or save operation: a valid directly supplied
request behaves identically. See [environment reference](env-reference.md) and
[exception publication](acceptance-coverage-mcp.md#deliberate-exceptions).

## Transport and admission

The wiki tool surface is not a filesystem backend and does not widen repository
visibility. For confined Codex, Claude, Agy, and OpenCode roles, the launcher
establishes a private Unix-domain socket admission service. Each authenticated MCP command
invocation receives its own connection and host wiki-MCP process, as specified
by `decision` (repository-only: `wiki/decisions/decision.md`) and
[MCP integration](mcp-integration.md#standalone-client-configuration). The sandbox receives the pinned
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

## Lifecycle protocol generation

The spawned host server's first launcher-only event is
`wiki-mcp-launcher-readiness.v3`. It carries `ready: true`, the registered tool
surface, and `lifecycle_protocol_generation` loaded by that server process from
the conduit contract. The long-lived launcher compares the announcement with
its own loaded generation after connection authentication. Only an equal,
well-formed generation resolves server readiness; old, missing, malformed,
unknown, or incompatible generation evidence fails before MCP forwarding with
`stdio_mcp_lifecycle_protocol_incompatible`. Recovery is bounded: deploy one
coherent build and restart the long-lived backend. The generation is not
selected by a caller, prompt, model, environment, filesystem identity, parent
module cache, or historical run, and there is no backend-global compatibility
fact or poison latch.

**Versioning rule.** The lifecycle generation names the whole launcher-only
event grammar: every event's schema version, its required and permitted keys,
and the exact values the consumer demands. The consumer validates each event
against a closed key set, so adding a key to an existing event is a malformed
event to every consumer built before it. Any change to that grammar therefore
moves the producer's `STDIO_MCP_CONDUIT_PRODUCER_PROTOCOL_GENERATION` and the
consumer's `STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION` together, and new evidence
gets its own schema version rather than a new key on an old one. Discovery-probe
close evidence is `wiki-mcp-launcher-client-closed.discovery-probe.v1`; the
ordinary `wiki-mcp-launcher-client-closed.v1` keeps its two-key grammar exactly.
The automated checks are narrower than the rule.
`tests/integration/agent-launch-stdio-mcp-lifecycle-generation-versioning.test.mjs`
fails if the set of schema versions the producer emits, or the generation
literal, moves without an explicit edit, and
`tests/integration/agent-launch-stdio-mcp-client-close-grammar.test.mjs` proves
that unpermitted keys and unaccepted values are refused. Neither detects a key
added to an existing event on both sides at once while the generation stands
still, so that coupling remains an obligation on whoever edits the grammar.

**Mixed-generation boundary.** Under the decision local transport the host
wiki-MCP server is not spawned until a confined client has authenticated, so the
registration handshake runs after the confined child exists. The boundary that
refuses a mixed build before the spawn is the managed composition gate, which
reads the producer from disk: immediately before conduit construction the
launcher runs one short-lived probe process that imports the resolved
host-server package's readiness observer and returns the generation that server
will announce. Only equality with the launcher's own consumer generation admits
the launch. A mismatch refuses with gate outcome
`spawned_producer_generation_mismatch`; an unresolvable, unspawnable, or
malformed producer refuses with `spawned_producer_generation_unavailable`. Both
are the `stdio_mcp_lifecycle_protocol_incompatible` blocker with the bounded
coherent-build/restart recovery, both happen before the confined child is
spawned, and neither opens a retry, a fallback transport, a permissive parse, or
a caller-selected generation. The gate outcome is carried beside that identity;
it does not become the public code, and neither outcome is published as
`operator_recovery_needed`.

**Core package-document composition.** A managed session started through the
`@agent-chassis/core` `agent-launch` forwarding bin binds its sibling core
`wiki-mcp` forwarding bin before the agent-launch-cli composition root is
initialized. The handoff is process-local and first-bind-only, and accepts no
environment, argv, prompt, request, workspace, ancestor-search, or hoisting
input. Install `@agent-chassis/core` for supported consumer operations; it is
the sole npm owner of `agent-launch`. The internal launcher engine exports no
standalone bin. Direct wiki-mcp embedding without a core carrier retains the
operation-level `package_docs_carrier_unavailable` result and does not search
for core. The forwarding launcher binds only for commands
that construct a managed wiki-MCP conduit: help and maintenance commands do not
read the package carrier and remain usable if package documentation is damaged,
and a composing command reports the closed package-carrier diagnostic and exits
without a raw exception stack.

The carrier has one private core owner, `lib/package-docs-carrier.mjs`, which is
not a package-root export; the core package allowlist publishes that exact
module, not `lib/**`. Both core forwarding bins consume its constructor, which
derives the package name, version, root, docs root, and
`public-docs-manifest.json` path from its own installed module location and the
adjacent core `package.json`. The launcher constructs no second carrier.

The managed-composition gate binds the exact forwarding entrypoint, producer
generation, core package identity and version, manifest schema and digest, and
carrier-module bytes. Its fresh-process pre-spawn probe imports the installed
carrier constructor and reads those installed bytes, and the generation factory
synchronously revalidates the identical entrypoint, carrier module, package
metadata, and manifest bytes immediately before the actual server spawn. Every
production codex-role, Claude worker/reviewer/redteam, and Codex in-process
worker/reviewer/redteam constructor reaches that gate through a launcher-minted
managed-composition authority. Internal embedding uses the same authority with
an intentionally unbound core carrier when no core composition was supplied.

For a core-bound spawn, the proven immutable generation crosses the process
boundary as one bounded record in the parent-to-child direction of the existing
duplex readiness descriptor. Before constructing the MCP server or registering
tools, the child reads that record and revalidates the package carrier supplied
by the private core forwarding bin against the exact entrypoint, carrier module,
package metadata, and manifest digests. It adds no environment or argv selector,
workspace lookup, ancestor search, fallback, or second carrier owner, so a
replacement between probe and child binding refuses; it never falls back to the
direct wiki-mcp entrypoint or an inferred package root.

All core carrier-composition failures use the closed launcher diagnostic
`package_docs_carrier_composition_incompatible`, whose `reason` is exactly one
of `entrypoint_missing`, `carrier_missing`, `package_metadata_invalid`,
`manifest_invalid`, `generation_stale`, `package_version_mismatch`,
`probe_mismatch`, or `duplicate_bind`. This diagnostic protects composition
correctness and package identity only. It is not a confidentiality, secrecy,
redaction, policy, admission, or CCE decision, and it does not alter the
manifest, descriptor, document-read, traversal, shadowing, or
operation-diagnostic semantics of package documentation.

**Restart and resume.** A fresh launch and a resume both mint a new managed
backend generation from the same composition root; neither replays a stored
compatibility fact. A restart refreshes only what the launcher process loaded,
while the producer that actually runs is re-read from the worktree at every
spawn. Restarting is therefore no remedy for a grammar that moved without its
generation, which every gate admits; the on-disk probe is what makes a stale
long-lived launcher detectable before it spawns anything.

## Lifecycle phases and discovery probes

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

## Generation readiness and stream failures

Until the first successful client readiness, all authenticated generations share
one original confined-child readiness deadline. Discovery probes and successor
candidates cannot extend it. A generation born after that first success gets the
full trusted client-readiness timeout (180 seconds by default), fixed at birth
and armed once through its existing activation path. Success never resets an
older generation's budget; rejection never authorizes a fresh initial budget.

The lifecycle observes child stdin (FD 0), stdout (FD 1), stderr (FD 2), and the
readiness/composition channel (FD 3) synchronously after spawn and through
teardown. A live stream error records `stdio_mcp_conduit_stream_error`, retaining
its native cause, generation, stream, errno and observed phase. A stream error
is not evidence of process exit. The first failure stays primary; the first
stream error remains separate bounded context when it follows a timeout or
another failure. After an expected terminal state or this child's launcher-owned
reap, a stream error retains context without creating a new primary failure.

Admission routes an established generation's failure to the same memoized
connection disposal that owns socket closure, bounded reaping and resource
release. A failed extra generation closes only its own connection and child.
Failed startup candidates are removed before discovery-probe promotion. Failure
of the required active generation still triggers deliberate bounded session
shutdown, with no automatic failover. Actual reap and release failures remain
separate cleanup failures and reach the conduit's cleanup settlement; an ordinary
extra-generation rejection does not become a shared cleanup failure.

## Private root and teardown

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

Once admission has authenticated a connection and attached the generation, a
graceful peer half-close on that socket is recorded as authenticated client
transport EOF **before** the EOF is forwarded, and the generation's stdin is
then ended exactly once. The recorded fact is clean-drain evidence only: it says
the client's MCP transport reached EOF, never that the confined client process
is terminal, and it authorizes no successful completion. The launcher-observed
confined-process exit remains the sole authority for that.

Only after client readiness has completed at the tools/profile boundary does a
host server exiting `code 0, signal null` following that fact count as the
expected drain. It then records no server-exit failure and no launcher
termination, even while the orchestrator is still finishing. Every other shape
keeps its typed fail-closed teardown: an unauthenticated disconnect, a close
with no preceding half-close, a disconnect before client readiness, a spawn
failure, a host exit that precedes the EOF, and any nonzero or signalled exit.

Having forwarded the EOF, admission waits for the generation's own server-exit
settlement for one natural-exit window equal to the launcher-owned
abnormal-drain grace, so the server can leave on its own. A server that does not
still reaches the same memoized generation close and bounded TERM-to-KILL
escalation, so host-server shutdown stays bounded by three such intervals. No
caller, environment, config, or prompt selects the window. It is entered only
for a graceful drain: a socket that never half-closed disposes with no wait, and
a generation that exposes no such settlement goes straight to the close owner.

Confined-client terminal supervision is a separate decision, and a clean
expected host-server drain does not reach it. That drain means the client's MCP
session ended; it is not evidence about the client process, which for an
interactive orchestrator is routinely still working. The launcher therefore arms
no terminal supervisor, schedules no signal, and records no launcher-termination
evidence for it, and the client may stay alive indefinitely. The confined
process's own exit, close, or error event remains the authority that finalizes
the conduit lifecycle. Abnormal server loss, a failed server-exit observation,
and a conduit failure settlement keep the bounded terminal supervision on the
abnormal-drain grace, with their typed cause, escalation, and evidence.

Teardown has exactly one owner per conduit: a retained, awaitable settlement
created before the first resource is acquired. Every path (partial create,
launch refusal, readiness failure, killed client, forced timeout, cancellation,
child exit) drives that same settlement, so concurrent cleanup, probe, status,
and wait callers coalesce on one disposal and observe one verdict. It never
rejects; the typed cleanup failure is retained state, published additively so it
can never mask the originating failure. No terminal result is published before
that settlement completes, which means before the owned host-server generations
have been reaped and admission resources disposed.

Teardown clears both client-readiness deadlines, and reaping the active
generation's host is the launcher's own action rather than a server loss, so the
settlement itself resolves any readiness still unfinished once disposal has
completed and the cleanup verdict is retained. For an authenticated generation
whose client has not completed readiness (killed, timed out by its run budget,
exited on its own, or cancelled) it publishes one typed
`stdio_mcp_client_readiness_failed` with `detail.reason`
`cleanup_before_client_readiness` through the ordinary failure path: `failure`,
`readinessFailure`, the `failureSettlement` value and the `clientReady` rejection
name that same error, and the launcher cause names it at the conduit-lifecycle
boundary. A launcher awaiting `clientReady` therefore resumes from the settlement
and publishes its accepted run as a terminal typed conduit failure. An earlier
typed cause keeps its exact identity and every promise it already settled, a
resolved `clientReady` is never touched (healthy teardown after readiness
records no failure), and a cleanup failure stays the separate `cleanupFailure`
verdict, never the readiness primary. `cancel()` still throws its own
`stdio_mcp_conduit_cancelled` to its caller, carrying the cancellation reason and
any cleanup residue additively; that thrown outcome is not retained, while the
conduit it cancelled before readiness retains the readiness failure above.

## Start failures, reaping and signals

Construction failures and generation-start failures are reported differently.
A failure while the conduit is being constructed — minting or validating the
private directory, resolving the server entrypoint, the conduit-wide Node
Engine bootstrap, resolving role tools, or opening admission — rejects
construction with its original error unchanged; a launcher-typed refusal keeps
its code and any other thrown value keeps its identity. Once a connection has
authenticated, its generation's own start — the per-generation Node Engine
bootstrap, the launcher no-CCE authority descriptor, and the synchronous spawn
call — can fail before any child lifecycle exists. That failure is a typed
`stdio_mcp_host_server_start_failed` whose `detail.phase` names the step and
whose `cause` is the exact thrown value, including a falsy or non-`Error` one;
externally only the bounded code and cause projection are published. While no
generation is active it becomes the conduit's primary failure before teardown:
`failure`, `readinessFailure`, `failureSettlement`, and the `clientReady`
rejection all carry it, the launcher cause names it at the conduit-lifecycle
boundary, and `serverExit` settles at once as a no-child `spawnFailed`
termination. Teardown's pre-authentication fallback never relabels it, and a
genuine cleanup failure is reported separately through the cleanup verdict. The
authority descriptor is conduit-owned from acquisition, so a failed close is
retained for the single cleanup settlement rather than masking the start
outcome. A generation that fails to start while another generation is active
leaves that generation's cause, readiness, and terminal projections untouched;
only the failed connection is refused. A conduit torn down before any
connection authenticated keeps its pre-authentication settlement with no
originating cause.

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

## Client registrations

Codex, Claude, Agy, and OpenCode receive only launcher-generated client
registrations. Claude uses `--mcp-config`, `--strict-mcp-config`, and the role-specific tool allowlist.
Codex receives one exact top-level `mcp_servers` override containing only the
`wiki` stdio connector, with three launcher-owned settings:

- `startup_timeout_sec` is the exact seconds projection of the shared
  client-readiness budget, so Codex cannot abandon MCP before the launcher's
  initialize-plus-`tools/list` window ends.
- `tool_timeout_sec` is 1260: the twenty-minute `get_run_result` wait plus a
  sixty-second response margin, so Codex does not abandon the server's longest
  bounded call before it answers. It is the tool-request allowance only and
  changes neither startup and readiness nor the bound the server applies to
  each call. Codex 0.162.1 accepts the setting in a server registration.
- `tool_input_schema_max_bytes` is 131072. Codex shortens a tool's input schema
  above its per-server limit (5,000 bytes by default) and then offers the model
  nested members as `unknown`, which would hide the nested
  `workspace_create_record` authoring members. The limit changes only what
  Codex renders; at this limit Codex 0.162.1 renders that declaration
  completely, and every member it still offers as `unknown` is one the server
  publishes without a constraint.

`save_record` does not depend on that limit. Its published declaration is
intentionally compact: the request envelope, every `changes` member by name in
the owner's order, each scalar member complete, and each composite member
deferred whole, with the owner's description and no nested type. The serialized
input schema is about 4.8 KB, under Codex's default limit, so Codex 0.162.1
holds the same declaration whole with and without the raised limit, about 4.3 KB
of delivered text; both are byte counts, not model tokens. The members Codex
offers as `unknown` are exactly the ones the declaration defers. Codex renders a
patterned member as a plain string, so the `changes` description states the
new-row label pattern and the `$<key>` reference form, which Codex keeps as a
comment, and the tool description states where a deferred member's complete
schema is read.

A deferred member's complete schema is one `workspace_read_wiki` selection of
the saved unit's input contract. Codex also bounds what one tool call returns
to the model: Codex 0.162.1 cut a single printed output of about 68,000
characters to about 48,000 with an inline notice, and neither a per-call
`max_output_tokens` nor `tool_output_token_limit` changed that. The combined
criteria, requirements, obligations and controlled-acceptance selection is
about 44,000 characters when its structured carrier is printed once, and Codex
0.162.1 returns it whole under the launcher's own arguments. That is an
observation of one client version and one serialization, not a general limit:
output that prints both response carriers, or a larger selection, is not shown
to fit.

Repository settings, user settings, prompt text, ambient environment, and caller
configuration cannot add, replace, retarget, or shorten the server registration.
Agy projects the authenticated channel into its private native configuration;
OpenCode projects the same pinned command and argv into its read-only native
configuration. Both use the shared closed conduit. Their configuration-source
masks and qualification limits are owned by [Agy confinement](agent-launch-confinement-mcp-conduit.md#agy-confinement-and-native-qualification)
and the [OpenCode native configuration boundary](agent-launch-confinement-mcp-conduit.md#opencode-native-configuration-boundary).

For the local-socket transport, that shared client-registration projection runs
the pinned connector with the Node executable already running the launcher. The
launcher derives it only from `process.execPath`, canonicalizes it to an absolute
regular executable, and binds that exact file read-only at the same path in a
bubblewrap namespace. It never resolves connector Node from `PATH`, the task
repository, task `node_modules`, caller arguments, prompts, `HOME`, or environment
overrides. Consequently neither a confined task nor an operator's consuming task
environment needs a global `/usr/bin/node` or any task-level Node toolchain.

The current readiness registration requires `registered_tier` to name a known profile equal to the launcher’s captured host selection. Missing, unknown or mismatched profiles refuse that connection generation before readiness; the operator restarts the affected connection with coherent host configuration. Registration establishes no CCE admission or audit assurance.

## Assignment-change terminal event

The closed `wiki-mcp-launcher-assignment-change.v1` event carries exactly
`schema_version`, `assigned_unit`, `launch_ref`, `run_id`, `retry_id` and
`request_id`. Producer and consumer negotiate lifecycle vocabulary generation
`stdio-mcp-conduit-lifecycle-vocabulary.v4`. Only the authenticated host for the exact launcher-bound worker attempt may
issue this event, after its
request and frozen assignment originals have won durable completion arbitration.
Each authenticated connection generation forwards it to the same attempt owner,
including a generation other than the active readiness generation. A previous
readiness failure cannot suppress this trusted terminal event; its first cause
remains recorded independently.

This is a normal semantic termination request, separate from server failure,
cancellation and MCP EOF. The shared isolated-launch owner immediately sends
SIGKILL to its live confined child, retaining the semantic initiating cause and
the actual signal return or thrown signalling error. A false kill return is not
successful signal delivery. The managed launch probe exposes the owner's read-only
`exit.launcher_termination` evidence during a live failed stop and after death;
terminal assignment-change settlement also retains it in the final result.
The accepted RPC remains pending; no final model
turn or report is requested. Only actual child termination authorizes the existing
transport cleanup. A failed stop leaves acceptance pending and completion
consumed, without a false death or release. Ordinary MCP close keeps its current
healthy-client behavior. No request field, model prose or worker environment
selects the process to stop.
