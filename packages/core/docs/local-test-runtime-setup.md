# Local test-runtime setup

Native saved-proof attempts run against local test runtimes that were prepared
in advance. `workspace_verify_proof` runs those attempts (see
[Test-proof runtime identity](test-proof-runtime-identity.md#native-provider-families)).
Preparing those runtimes is an explicit operator step and the only place where
test toolchains or test dependencies are prepared; attempts only consume what
it published.

Ordinary setup does it. Run it from the repository root:

```sh
agent-chassis setup
```

Its last step finds this repository's test project from the repository's own
manifests, locates that project's toolchain on `PATH`, saves both choices in
`agent-chassis-runtime.json` at the repository root, and then validates,
prepares, proves and publishes readiness. Nothing else has to be discovered,
and no configuration has to be hand written. `agent-chassis setup
--test-runtimes` reruns exactly that last step for an already-configured
repository, with the same resolution and the same saved configuration; it never
reruns wiki bootstrap and never touches root agent guidance.

## How setup chooses

Each choice is resolved in one order:

1. an explicit command-line option,
2. the repository's saved `agent-chassis-runtime.json`,
3. deterministic discovery from the repository's own evidence.

Discovery reads the repository's manifests — `go.mod`, `Cargo.toml`,
`deno.json`/`deno.jsonc`, `package.json`, `pyproject.toml` and
`requirements.txt`/`test-requirements.txt`/`requirements-dev.txt` — up to three
directories deep, skipping dependency, build and runtime-state trees
(`node_modules`, `vendor`, `target`, `dist`, `build`, `.venv`, `.git`,
`.agent-launch` and the like). A language never selects a test framework by
itself: an npm project names its runner through a declared `jest`, `vitest`,
`mocha`, `ava` or `lib0` dependency, or an explicit `node --test` test script;
a Python project through a declared `pytest` or `stestr` requirement. Go, Rust
and Deno projects have one catalog runner each, so their manifest identifies it.

Setup then locates each selected runner's toolchain with the command it is
installed as (`node`, `python3`, `go`, `rustc`, `deno`) on setup's own `PATH`,
and reports the project, the runner, the chosen executable and, once prepared,
its actual version.

Setup asks only about what this leaves unresolved, and only when it has a
terminal:

| Unresolved | Question | Command-line answer |
| --- | --- | --- |
| Several plausible language/project/runner choices | which selection to prepare | `--language <name>`, or `--runner <name>[@<project>]` |
| No matching executable on `PATH` | where that toolchain is installed | `--executable <toolchain>=<absolute-path>` |

Without a terminal it never waits on stdin: it prints the plausible choices, or
the toolchain it could not find, together with the exact option to pass, and
exits nonzero. Unambiguous discovery succeeds noninteractively with no options
at all. A repository whose manifests show no test project is reported as such
and is not an error; setup saves nothing and guesses no runner.

## Ordinary setup options

| Option | Meaning |
| --- | --- |
| `--language <name>` | Choose the repository language when several fit: `go`, `javascript`, `python`, `rust` or `typescript`. Rediscovers the selection rather than reusing a saved one. |
| `--runner <name>[@<project>]` | Choose the runner and its repository-relative project directory (default `.`) directly. Repeatable. Names: `node-test`, `jest`, `vitest`, `mocha`, `ava`, `deno`, `lib0-testing`, `pytest`, `stestr`, `go-test`, `cargo-test`. |
| `--executable <toolchain>=<absolute-path>` | Where `node`, `python`, `go`, `rust` (its `rustc`) or `deno` is installed, when `PATH` has none or the wrong one. Repeatable. |
| `--dry-run` | Resolve and report everything without installing, preparing, saving or publishing anything. |

## Repository configuration

Setup saves the choices it resolved at the repository root as
`agent-chassis-runtime.json`, and reuses them on every later run:

```json
{
  "runners": [{ "runner": "go-test", "project": "go" }],
  "toolchains": {
    "go": { "executable": "/usr/local/go/bin/go" }
  }
}
```

`runners` is required and non-empty; each entry names a runner and, by default,
the repository root. `toolchains` is optional; each entry requires `executable`
and may request an exact `version`. This is one closed shape: an unknown field,
a wrong type, a selection listed twice, or a toolchain entry no selected runner
uses is refused outright. There is no configuration include, inheritance,
variable expansion or global/local layering, and a saved file that is not this
shape is reported rather than ignored.

The file is the saved *choice*. It is not readiness: the generated host
readiness record under `.agent-launch/` stays separate, is never hand written,
and only the preparation below decides whether tests can actually run. Saving
it also never installs anything.

`executable` is a path on this host. Setup rewrites the file only when the
resolved choices differ from what it already holds, and a dry run never writes
it. Commit it only when every host that runs setup shares those paths;
otherwise leave it out of version control and let each host write its own.

## Precedence and refusals for an explicit location

* A configured `executable` — from `--executable`, from
  `agent-chassis-runtime.json`, or from a `--runtime-config` file — wins over
  every other source: it is used ahead of a previously installed copy under the
  toolchain root and ahead of host discovery on `PATH`. Toolchains with no
  configured location keep the ordinary behaviour described under
  [Toolchains](#toolchains).
* A configured location must be an absolute path that resolves to an executable
  regular file. Setup then identifies the complete toolchain from it — sibling
  binaries and runtime files included — and checks that it reports the selected
  exact version. An invalid, unavailable, incomplete or mismatched location
  fails the run (`test_runtime_toolchain_executable_invalid`,
  `test_runtime_toolchain_executable_unavailable`,
  `test_runtime_toolchain_incomplete`, `test_runtime_version_mismatch`),
  publishes no readiness, and reports the exact correction. Setup never quietly
  falls back to `PATH`, to a cached installation or to a download instead, and
  it never changes the caller's `PATH` to make a selection.
* An installed toolchain of the wrong version is explained, never replaced: the
  report names the version found, the version this project selects, and the
  option to point setup at a matching installation.

## Reconfiguring an existing repository

`agent-chassis setup --test-runtimes` reruns only the preparation step.

```sh
agent-chassis setup --test-runtimes \
  --runner jest@web --runner pytest@services/api --runner cargo-test@crates/core
```

| Option | Meaning |
| --- | --- |
| `--runner <name>[@<project>]` | Select a test runtime runner for a repository-relative project directory (default `.`). A proof target uses the runner selected for the deepest project that contains it. Repeatable. |
| `--toolchain <name>=<x.y.z>` | Request an exact supported version of `node`, `python`, `go`, `rust` or `deno`. |
| `--runtime-config <file>` | Take the selection, and any explicit toolchain executable locations, from one JSON file in the shape above, resolved against the invocation directory. Not combinable with `--runner`, `--toolchain` or `--host-toolchains`. |
| `--toolchain-root <dir>` | Absolute toolchain installation root. Default: `$XDG_DATA_HOME/agent-chassis/toolchains` or `~/.local/share/agent-chassis/toolchains`. |
| `--state-root <dir>` | Absolute root for prepared project dependencies. Default: `$XDG_STATE_HOME/agent-chassis/test-runtimes/<repository key>` or the same path under `~/.local/state`. |
| `--host-toolchains reuse\|ignore` | Reuse a compatible host installation (default) or always use the toolchain root. |
| `--dry-run` | Report the plan (selected versions and planned installs) without installing anything or changing readiness. |
| `--json` | Print the structured result. |

This mode makes no choices of its own. With neither `--runner` nor
`--runtime-config` it uses the repository's own `agent-chassis-runtime.json`,
then the previously published selection; with neither of those it refuses with
`test_runtime_selection_required` and lists the runner names. Unlike ordinary
setup it never discovers a project, never asks, and never saves: to change what
this repository selects, run ordinary `agent-chassis setup` with `--language`,
`--runner` or `--executable`.

## Toolchains

Each selected runner names its toolchain. Setup selects one exact version per
toolchain and reports where it came from:

1. a supported project pin (`.nvmrc`/`.node-version`, `.python-version`, a
   `toolchain goX.Y.Z` directive in `go.mod`, `rust-toolchain.toml`/
   `rust-toolchain`, `.dvmrc`),
2. an explicit `--toolchain` request, or
3. the package baseline (Node 24.20.0, Python 3.12.3, Go 1.27.1, Rust 1.98.1,
   Deno 2.9.6).

A pin and a request that disagree refuse with `test_runtime_version_conflict`;
an unsupported version refuses with `test_runtime_version_unsupported` before
any download. Setup never selects "latest".

For the selected version, setup uses the configured location when one is
configured, and otherwise reuses a previously verified copy under the toolchain
root, then (unless `--host-toolchains ignore`) a host installation that reports
exactly that version, and otherwise installs it from the official
artifact with a pinned SHA-256: the Node.js and Go release archives, the Deno
release archive, and `rustup-init` (minimal profile) for Rust. Python versions
are installed with `uv python install`, which verifies its own downloads. An
install is staged privately and renamed into place only when complete; a
verification marker beside the install records its content digest and
fingerprint. Unrelated system installations are never modified. Supported
platform: Linux x86_64 (`test_runtime_platform_unsupported` otherwise). Rust
needs a system `cc` linker (`test_runtime_native_prerequisite_missing`
otherwise); archive extraction needs `tar`, `xz` or `unzip`.

Ordinary `agent-chassis setup` always gives every selected toolchain an
explicit location, so it validates exactly the installation this repository
chose and installs nothing. Installation is reached only through
`--test-runtimes` for a toolchain that has no configured location.

## Project dependencies

For each selected project, setup prepares the pinned test dependencies with
the ecosystem's standard tool into launcher-owned state under the state root,
never into the repository and never globally:

| Ecosystem | Required inputs | Preparation | Attempt binding |
| --- | --- | --- | --- |
| npm | `package.json`, plus `package-lock.json` when any dependency is declared | `npm ci --ignore-scripts` | read-only prepared `node_modules`, linked into the attempt's private working copy |
| deno | `deno.json`/`deno.jsonc`, `deno.lock` | `deno install --frozen` into a prepared `DENO_DIR` | read-only `DENO_DIR`, `--frozen --cached-only` |
| python | `requirements.txt`, `test-requirements.txt` and/or `requirements-dev.txt` | `uv venv --relocatable` then `uv pip install -r ...` | read-only virtual environment |
| go modules | `go.mod` (and `go.sum`) | `go mod download all` into a prepared module cache | read-only `GOMODCACHE`, `GOPROXY=off` |
| cargo | `Cargo.toml`, `Cargo.lock` | `cargo vendor --locked` | read-only vendored sources, `--frozen` |

A missing lockfile fails that component with
`test_runtime_dependency_lock_missing`; setup never creates or rewrites a lock
and runs no package install scripts. Runner packages such as Jest, Vitest,
Mocha, AVA, lib0, pytest and stestr must be pinned by the project itself.
Prepared populations are content-addressed by their inputs and toolchain, made
read-only, measured, and reused when still intact.

## Verification and readiness

Before publishing, setup resolves every selected runner through the same
runtime-input composition that attempts use and proves it inside the launcher
sandbox with the network denied: each toolchain must report its exact version,
and each runner's probe (installed runner package, offline module or crate
resolution) must succeed. Only when every requested component is ready and
every check passed does setup publish `.agent-launch/test-runtimes/readiness.v1.json`
(see [Test-proof runtime identity](test-proof-runtime-identity.md#local-test-runtime-readiness)).
These setup-owned probes retain ordinary validation's private temporary mount.
The host system `/tmp` selection is specific to later `workspace_verify_proof`
subprocesses and requires no consuming-repository option.

Finding the project, resolving an executable and saving
`agent-chassis-runtime.json` are none of them readiness: only this published
record means the selected tests can actually run, and setup says so explicitly
in its final line.

Setup withdraws any published readiness when it starts. A run that fails
reports each component's outcome (`ready`, `failed`, `blocked` or `planned`)
and each verification check, and leaves no ready record; repeating setup after
fixing the cause reuses every component that is still verified. A later change
to a lockfile, a prepared tree or a toolchain makes attempts refuse with a
stale-input environment failure until setup runs again.
