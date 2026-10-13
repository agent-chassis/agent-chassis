# Conduit capture and probes

This page describes two optional host observability destinations of the
[MCP conduit](agent-launch-mcp-conduit-lifecycle.md) and the test-only
confined-worker probe composition. None of them carries authority.

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
entrypoint, never from a label, command line, or transcript:

- `workspace_packages`: the declared workspace packages of the nearest
  `package.json` whose `workspaces` contain the entrypoint, plus that root's
  `package.json` and `package-lock.json`;
- `workspace_packages_and_entrypoint`: the same plus the entrypoint file, when
  the entrypoint lies inside that workspace root but outside every declared
  package;
- `package`: otherwise the nearest package directory;
- `entrypoint_file`: otherwise the entrypoint file alone.

Every regular file in the census is hashed as it exists in the working tree, so
uncommitted and untracked bytes count. `node_modules` trees are excluded, with
third-party dependencies represented by the lockfile, and symbolic links are
recorded by link text without being followed. Git-ignored runtime state inside a
census directory is hashed like any other file, so it can make identical
implementations report different digests (never the reverse); keep test and run
output outside the census. Paths are sorted relative to the census root, so equal
content in another checkout has an equal digest. The census is observed
synchronously before the server is spawned and again after it closes, within a
bound of 50,000 entries and 2 GiB. Equal observations publish `state: "stable"`
and `content_digest`, which also becomes the journey measurement's
`source.content_digest`. A census that changed during the session, exceeded its
bound, or could not be read reports `changed` or `unavailable` with no digest,
which leaves the measurement identity incomplete. Source observation is evidence
only: it changes neither the capture status nor the mirrored run verdict.

The destination reaches the whole dispatch tree. The host wiki-MCP server owns
structured dispatch, so the conduits for managed worker, reviewer, and redteam
roles are minted inside that process from its own environment. The resolved
destination is therefore part of the launcher-minted server environment
(`buildServerEnv`), and each of those conduits mints its own session directory
in the same root. The already-resolved path is forwarded, never the raw
variable, and the receiving process validates it again, so an invalid one is
dropped at the boundary. It carries no authority: the server environment's tool
profile, assigned unit, workspace, and commit tuple are unchanged.

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

## Closed confined-worker probe composition

The integration suite has one direct-code-only worker probe composition for
testing the model-executable boundary. The production dispatcher still owns
worktree provisioning, assignment construction and authentication, scope
projection, bubblewrap planning and execution, MCP-conduit creation, process
supervision, and managed-run identity binding. After that plan exists, the
composition replaces only the final Codex executable with a fixed in-repository
Node program and executes the plan through the normal bubblewrap spawn path. The
probe has fixed source and receipt paths; no MCP argument, environment variable,
PATH lookup, CLI flag, callback, or executable parameter can select or alter it.

From inside confinement the probe reads the delivered assignment, reads a token
from the declared source path, authenticates to the projected MCP conduit, lists
the available tools, attempts to read a fixed undeclared sentinel, and writes a
bounded receipt through a declared writable file. The receipt's assignment-read
record carries the read count, the read identity, the public freshness token and
a digest of the complete guidance the probe retrieved, continuations included.
Tests correlate the receipt with independently observed managed-run and source
identities. A test-owned server may also give the composition a fixture-owned
observation directory: before the child starts, the composition reads that
attempt's launcher-published assignment from the conduit directory its own
bubblewrap plan projects, through the existing private-artifact reader, requires
it to be the assignment-snapshot owner's serialization, and records only its
identity, artifact digest and guidance digest. The child is never told these
values. Tests bind the receipt to that observation, comparing unit, role, run,
canonical source digest, the owner's public freshness projection of the artifact
digest and the guidance digest. The startup prompt digest is a prompt
observation only, not assignment evidence.

This is test support, not a production launcher mode and not implementation
completion evidence. It stops at worker start and assignment/source
acknowledgement. Missing bubblewrap, namespace, conduit, or launcher
prerequisites fail the test explicitly; there is no unconfined or silent-skip
fallback.

A paired fixed server entrypoint combines this probe with a separate branded
proof-execution-unavailable composition, which replaces only the proof executor
and proof provider dependencies with fixed fail-loud unavailable
implementations and nothing of dispatch, provisioning, assignment
authentication, bubblewrap, the MCP conduit, process supervision, or identity
binding. A separate provider-only branded composition keeps the orchestrator
proof runtime real and replaces only the proof provider. No request, environment
value, PATH override, CLI flag, or arbitrary callback selects any of them. The
owner-level composition test invokes both unavailable dependencies and rejects
an unbranded lookalike. A server calibration test starts each composition
through `startWikiMcpServer` and requires the registered `workspace_verify_proof`
route to report each dependency's own originating unavailable code, with no
proof executed and no credit; its verification requests are counted separately
from the connected journeys. The connected paired witness independently observes
that every server generation ran the fixed selected entrypoint and that both the
default and proof-disabled lanes reached equivalent confined assignment and
source acknowledgement with no proof execution or verification credit.
