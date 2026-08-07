
# Agent-launch confinement and MCP conduit

Confined implementation and findings roles use bubblewrap for repository
visibility and mutation enforcement. For a managed worker, the visible
repository namespace is exactly the frozen union of canonical `read_scope`,
`repo_paths`, and `write_scope`; mutation is possible exactly within
`write_scope`. A full host checkout never broadens this namespace.

For a managed reviewer or redteam running from a launcher-created linked Git checkout, whole-repository findings read also includes that checkout's transitive Git metadata dependencies: the launcher resolves the root `.git` indirection, selected worktree gitdir, common Git directory, primary object directory, and configured object alternates from the checkout itself, pins their exact non-symlink identities through spawn, and hard-binds only the required outside paths read-only where Git expects them. These runtime-support mounts accept no caller-selected Git path, ref, or object identity, leave the findings write set empty, and grant no Git mutation, commit, integration, dispatch, or lifecycle authority.

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

The launcher consumes lifecycle events through a one-way phase machine:
registration and generation, client initialize, exact `tools/list`, ready,
client close, then terminal. Duplicate or impossible evidence fails with the
first typed cause retained; later failure and cleanup attempts are idempotent.

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

Claude and Codex receive only launcher-generated client registrations. Claude
uses `--mcp-config`, `--strict-mcp-config`, and the role-specific tool allowlist.
Codex receives one exact top-level `mcp_servers` override containing only the
`wiki` relay. Its launcher-owned `startup_timeout_sec` is the exact seconds
projection of the shared client-readiness budget, so Codex cannot abandon MCP
before the launcher's initialize-plus-`tools/list` window ends. Repository
settings, user settings, prompt text, ambient environment, and caller
configuration cannot add, replace, retarget, or shorten the server registration.
Agy has no supported confined registration adapter and fails closed.

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
