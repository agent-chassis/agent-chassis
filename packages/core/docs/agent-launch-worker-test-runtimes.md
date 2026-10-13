# Worker test runtimes

This page describes the toolchains and dependencies a managed worker's own
commands see inside its sparse namespace. Test and proof execution through
`workspace_run_test` and `verify_proof` is a separate host capability (see
[Test-proof execution](test-proof-execution.md)).

## Prepared test runtimes in the coding worker

A managed implementation worker's ordinary commands use the toolchains and
dependencies the operator installed and local test-runtime detection
published, inside the same sparse confinement. Codex and Claude reach one family-neutral composer
(`test-execution/worker-runtime.mjs`) with only launcher-settled facts: the
canonical repository, the worker checkout and the frozen worker scope
authority. It resolves each resolved scope member to its containing
environment (per ecosystem, longest containing installation root) among the
published environments and the ones the checkout itself declares by the one
repository inventory, and resolves each such environment, as it is then,
through the same current-runtime owner test runs and the verifier use: what
the published configuration names is used as configured and everything else
is located at launch. An environment with no proved
runner is projected like any other. No caller supplies a root, mount, path,
environment or readiness record, and no ancestor search is made. A repository
with no record is projected the same way from located inputs; only a scope
that reaches no project of a repository that publishes nothing gets no
projection, and that launch is unchanged.

The state of setup is not a launch condition. A current preparation that is
`preparing` or `failed` composes from the configuration it kept from the ready
record it superseded, exactly as a ready record does; a first preparation that
failed publishes no configuration and composes, like a repository that was
never prepared, from located inputs. A record that is not authentic is never
consumed. Neither the composer nor the spawn owner refuses a launch for the
state of a record or for a record that changed or was removed after
composition.

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
- each module tree of the installed npm installation at its own place: the
  root's at `<checkout>/<project>/node_modules` and each workspace member's own
  at `<checkout>/<project>/<member>/node_modules` (see
  [Module trees](npm-test-runtime-layouts.md#module-trees)). These are
  the only in-repository read-only mounts a sparse worker receives, and only this
  launcher-composed projection can supply them. Caller `readOnlyRoots` inside the
  repository still refuse with `sandbox_write_denial`. Each workspace member
  link in a tree is relative (`node_modules/<name> -> ../<member>`), so inside the
  namespace it resolves to that member's source in the worker's own checkout,
  never to the canonical repository or the installation's own location. A link
  reaches only the individually authorized files already exposed in the worker's
  namespace. The member's manifest is a dependency input checked with the other
  installation inputs; it grants no access to the rest of that package. No
  directory grant is required and no additional source is mounted. An ungranted
  entrypoint, sibling or other source file stays inaccessible, including through
  the link. Missing dependency inputs report
  `test_runtime_project_inputs_outside_scope` with the exact files to add; missing
  source fails when the worker command attempts to load it;
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
while `node`, `gofmt` and `rustc` are toolchain-only. A failed dependency
resolution or a dependency input outside scope does not withdraw these independent
commands. The composer retains the selected installation, or locates an
unconfigured one through the existing toolchain resolver using the operator's
saved location when present. It validates the requested executable and applies
the same confinement, protected-root, source-identity and mountpoint checks.
Project commands retain the environment's specific failure; independent commands
report their own toolchain failure when their installation or executable is
missing, invalid or too broad. A failed configured location never falls back to
another executable on PATH.

A project command runs only from inside a prepared project, with that project's
ecosystem environment:

- Python runs the project's detected virtual environment (or the detected
  interpreter when the project's requirements are installed there);
- Go runs with the read-only module cache, `GOPROXY=off`, `GOFLAGS=-mod=readonly`
  and `GOWORK` naming the workspace the checkout's module builds in (`off` for a
  module no `go.work` of the checkout uses; see
  [Go workspaces](local-test-runtime-setup.md#go-workspaces)), with `GOCACHE`
  and `GOPATH` in scratch. The workspace files and the other used modules'
  `go.mod` and `go.sum` are dependency inputs of the project, so they must be
  visible in the worker's frozen scope like its own;
- Cargo runs the caller's own arguments offline against the detected source
  (the project's vendored directory, or the `CARGO_HOME` registry with
  `CARGO_HOME` naming it), exactly as the verifier does, plus the recorded
  `RUSTC` and `RUSTDOC`.

Outside every prepared project, a project command exits 127 and names the
prepared project directories it can run from. An argv path never selects
another project's dependencies. A harness started through `#!/usr/bin/env <name>`
keeps the interpreter its launcher search path resolved, so the projected
commands never change the coding model, MCP host or connector executable.

A project whose runtime inputs can be neither taken from the configuration nor
located is not a dispatch gate. The affected rows
report the exact condition when the runtime is used, with its subject, effects,
uncertainty, actor and action: `readinessRecovery` (the operator repairs the
named installation, then local test-runtime detection, whose producer is
`agent-chassis setup --test-runtimes`, runs again), or the exact missing dependency
input files for the coordinator to add to scope. The same applies to a link into
a repository that is not a declared workspace member (local package provenance). A dependency input or an
installed population that changed since setup is neither: the project is
projected as it is, with the change recorded in its identity. No host runtime is substituted, and no
readiness or completion summary claims a command ran.

An executable the installation lacks is that one command's condition, not the
project's: the command's own row reports `test_runtime_toolchain_incomplete`
with the executable and its expected path. An existing path that is not an
executable regular file reports the shared executable owner's specific failure.
The project and every other command of the same installation stay usable (a Go
installation without `gofmt` still supplies `go`).

The final pre-spawn check (`assertWorkerTestRuntimeMountsUnchanged`, reached
from `spawnIsolated`) covers what this launch actually binds: every projected
read-only source, every dependency source and every host mountpoint must still
be the same directory, and every mountpoint still empty. It does not consult
the readiness record: saved measurements that changed, a record that was
republished, or a record that was removed after composition do not refuse a
launch whose own sources are intact. This is a launch-time check; it does not
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

The confined-shell regression tests cover workspace resolution and hidden source
with real Node and installed-layout fixture data, and independent formatting
with real `gofmt`. Stand-in executable controls separately check command routing,
environment selection and failure isolation. These shell checks establish worker
namespace behavior; they do not establish host test-tool or proof-tool behavior.
