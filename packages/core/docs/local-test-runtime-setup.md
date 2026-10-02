# Local test-runtime setup

Native saved-proof attempts run against local test runtimes that already exist
on the host. `workspace_verify_proof` runs those attempts (see
[Test-proof runtime identity](test-proof-runtime-identity.md#native-provider-families)).
The operator installs the toolchains and each project's dependencies with the
ecosystem's own tools. AgentChassis only detects what exists, validates it
against the repository's own requirements, proves it inside the sandbox and
publishes it for attempts and coding workers to use. It never downloads,
installs, upgrades or creates a toolchain or a dependency environment, and a
missing or unusable component is reported with its original diagnostic and the
correction the operator makes.

Ordinary setup does the detection. Run it from the repository root:

```sh
agent-chassis setup
```

Its last step inventories every test environment this repository's own
manifests declare, locates each needed toolchain on `PATH`, saves those
locations in `agent-chassis-runtime.json` at the repository root, and then
detects, validates, proves and publishes readiness for all of the
environments. A repository with several languages, several projects of one
language, or several runners in one project needs no choice and no
configuration. `agent-chassis setup --test-runtimes` reruns exactly that last
step, with the same resolution and the same saved configuration, whether or
not this repository has been configured before; it never reruns wiki
bootstrap and never touches root agent guidance.

## Environments

An environment is one dependency installation root of one ecosystem, with its
public ID `<ecosystem>@<repository-relative root>`:

| Ecosystem | Installation root | Example ID |
| --- | --- | --- |
| npm | a `package.json` directory with its own lock or workspace declaration; its workspace members share its lock and installation | `npm@.` |
| python | a directory with `requirements.txt`, `test-requirements.txt` and/or `requirements-dev.txt` (or a `pyproject.toml` declaring a runner) | `python@services/api` |
| go_modules | a `go.mod` directory | `go_modules@billing` |
| cargo | a `Cargo.toml` directory; `[workspace] members` share its lock | `cargo@.` |
| deno | a `deno.json`/`deno.jsonc` directory | `deno@edge` |

Setup detects every environment the repository declares, in every language at
once. The runners proved in an environment are exactly:

* the runner its toolchain provides — node:test with Node, `go test`, `cargo
  test`, `deno test` — and
* each framework the environment itself declares: a `jest`, `vitest`, `mocha`,
  `ava` or `lib0` dependency in the root or a workspace member of an npm
  environment, or a `pytest` or `stestr` requirement of a Python environment.

Several runners coexist in one environment. A framework the repository does not
declare is never listed or offered, and a test script is never interpreted: a
root script that wraps its runner in a repository script needs nothing more,
because Node's own runner comes with the verified Node.

## How setup finds environments

Inventory reads the repository's manifests — `go.mod`, `Cargo.toml`,
`deno.json`/`deno.jsonc`, `package.json`, `pyproject.toml` and
`requirements.txt`/`test-requirements.txt`/`requirements-dev.txt` — up to three
directories deep, skipping dependency, build and runtime-state trees
(`node_modules`, `vendor`, `target`, `dist`, `build`, `.venv`, `.git`,
`.agent-launch` and the like). Only repository-owned manifests are evidence:

* a path the repository's Git ignore rules exclude (a scratch checkout, a
  cache) is reported as `ignored_by_repository`;
* a manifest under a `fixtures`, `__fixtures__`, `test-fixtures`, `testdata`,
  `examples` or `example` directory is reported as `test_fixture_or_example`,
  unless an npm or Cargo workspace declaration names its directory as a member;
* an npm package with no dependencies, no workspace members and no lock of its
  own runs in the npm installation that encloses it
  (`covered_by_enclosing_environment`);
* a `pyproject.toml` with neither requirement files nor runner evidence has
  nothing to detect (`no_dependency_inputs`).

An npm workspace member below that depth is still a member when the root's
`package-lock.json` records its directory as an installed local package, the
root's own `workspaces` declaration matches it, and it holds a `package.json`;
a lock entry the declaration does not match (a `file:` dependency, for example)
never becomes a member.

Setup reports every environment with its members, runners and evidence, and
every excluded manifest with its reason. It then locates each needed toolchain
with the command it is installed as (`node`, `python3`, `go`, `rustc`, `deno`)
on setup's own `PATH`.

The only question setup can ask is where a toolchain is installed when `PATH`
has none, and only with a terminal (`--executable <toolchain>=<absolute-path>`
answers it on the command line). Without a terminal it never waits on stdin: it
prints the toolchain it could not find and the exact option, and exits
nonzero. A repository whose manifests declare no environment is reported as
such and is not an error; setup saves nothing and guesses nothing.

An explicit runner selection replaces the inventory: `--runner`, or a `runners`
list saved in `agent-chassis-runtime.json` (or supplied with `--runtime-config`),
detects exactly the named runners' environments. `--language <name>` narrows
the inventory to the environments serving that language.

## Ordinary setup options

| Option | Meaning |
| --- | --- |
| `--language <name>` | Detect only the inventoried environments of one language: `go`, `javascript`, `python`, `rust` or `typescript`. |
| `--runner <name>[@<project>]` | Detect exactly this runner's environment at a repository-relative installation root (default `.`) instead of the inventory. Repeatable. Names: `node-test`, `jest`, `vitest`, `mocha`, `ava`, `deno`, `lib0-testing`, `pytest`, `stestr`, `go-test`, `cargo-test`. |
| `--executable <toolchain>=<absolute-path>` | Where `node`, `python`, `go`, `rust` (its `rustc`) or `deno` is installed, when `PATH` has none or the wrong one. Repeatable. |
| `--dry-run` | Detect and validate everything without the sandbox proof, saving or publishing anything. |

## Repository configuration

Setup saves toolchain locations it resolved, any explicit runner selection and
any explicit Python environment selection at the repository root as
`agent-chassis-runtime.json`, and reuses them on every later run:

```json
{
  "toolchains": {
    "go": { "executable": "/usr/local/go/bin/go" }
  },
  "environments": {
    "python@services/api": { "virtual_environment": "/srv/venvs/api" }
  }
}
```

All fields are optional, but a document names at least one. `test_entrypoints`
is described under
[Test-entrypoint associations](#test-entrypoint-associations). `runners`, when
present, is a non-empty explicit selection; each entry names a runner and, by
default, the repository root. Each `toolchains` entry requires `executable`
and may require an exact `version`. Each `environments` entry is keyed by a
`python@<project>` environment ID and names one existing virtual environment by
absolute path; no other ecosystem takes an explicit selection here (see
[Project dependencies](#project-dependencies)). This is one closed shape: an
unknown field, a wrong type or a selection listed twice is refused outright. There is no
configuration include, inheritance, variable expansion or global/local layering,
and a saved file that is not this shape is reported rather than ignored.

### Test-entrypoint associations

`test_entrypoints`, when present, is a non-empty list of test-entrypoint
associations that you author by hand; setup never writes or derives one. Each
association has exactly one of these shapes, with every field required:

```json
{
  "test_entrypoints": [
    {
      "runner": "lib0-testing",
      "project": ".",
      "target": "test/example.test.mjs",
      "entrypoint": "test/run-tests.mjs"
    },
    {
      "runner": "node-test",
      "project": ".",
      "adapter": "node-test-wrapper",
      "entrypoint": "tests/run-tests.mjs"
    }
  ]
}
```

A `lib0-testing` association names the test `target` that one repository
`entrypoint` runs; a `node-test` association names the repository test wrapper
(`adapter` `node-test-wrapper`) that runs a project's Node tests. `project`
names the environment the association belongs to: it is the environment's
installation root (`.` for the repository root), not a base for the other
paths, and nested projects are distinct environments. Every path is a canonical
repository-relative path with forward slashes: no absolute, drive or UNC path,
backslash, empty, `.` or `..` segment, NUL or glob character. `target` and
`entrypoint` name files, so they are never `.` and never end with `/`. A
`lib0-testing` association is unique by `runner`, `project` and `target`, and a
`node-test` association by `runner` and `project`; several targets may share one
entrypoint.

Paths are checked as spelling only: setup does not look for the files, resolve
links or run anything. Associations are separate from `runners`: they neither
select nor suppress a runner, and a document holding only associations leaves
the inventory automatic. Whenever setup saves this file, it keeps the saved
associations exactly as they were. Stored associations currently have no effect
on what setup detects or on how tests run; they are host-local configuration,
not verified source and not readiness.

Setup never saves its inventory: every run inventories the repository again, so
a project added later is detected by the next run instead of being hidden by an
earlier one. The file is saved *choices*. It is not readiness: the generated
host readiness record under `.agent-launch/` stays separate, is never hand
written, and only the detection below decides whether tests can actually run.
Nothing installs anything.

`executable` is a path on this host. Setup rewrites the file only when the
resolved choices differ from what it already holds, and a dry run never writes
it. Commit it only when every host that runs setup shares those paths;
otherwise leave it out of version control and let each host write its own.

## Precedence and refusals for an explicit location

* A configured `executable` — from `--executable`, from
  `agent-chassis-runtime.json`, or from a `--runtime-config` file — wins over
  host discovery on `PATH`. Toolchains with no configured location are found
  on `PATH` as described under [Toolchains](#toolchains).
* A configured location must be an absolute path that resolves to an executable
  regular file. Setup then identifies the complete toolchain from it — sibling
  binaries and runtime files included — and checks the version it reports
  against any requirement. An invalid, unavailable, incomplete or mismatched
  location fails the run (`test_runtime_toolchain_executable_invalid`,
  `test_runtime_toolchain_executable_unavailable`,
  `test_runtime_toolchain_lookup_failed` for other filesystem failures,
  `test_runtime_toolchain_incomplete`, `test_runtime_version_mismatch`),
  publishes no readiness, and reports the exact correction. Setup never quietly
  falls back to `PATH` or to any other installation, and it never changes the
  caller's `PATH` to make a selection.
* An installed toolchain that does not satisfy a requirement is explained,
  never replaced: the report names the version found, the required version and
  its source, and the option to point setup at a matching installation.

## Detecting runtimes without the rest of setup

`agent-chassis setup --test-runtimes` reruns only the detection step.

```sh
agent-chassis setup --test-runtimes
```

| Option | Meaning |
| --- | --- |
| `--runner <name>[@<project>]` | Detect exactly this runner's environment at a repository-relative installation root (default `.`) instead of the inventory. Repeatable. |
| `--toolchain <name>=<x.y.z>` | Require an exact installed version of `node`, `python`, `go`, `rust` or `deno`. |
| `--runtime-config <file>` | Read an explicit runner selection, explicit toolchain executable locations, explicit Python environment selections and/or test-entrypoint associations from one JSON file in the shape above, resolved against the invocation directory. It is temporary: it replaces the repository's saved configuration for this run only and is never written back, so the saved file, its associations included, is left unchanged. Not combinable with `--runner` or `--toolchain`. |
| `--dry-run` | Detect and validate everything without the sandbox proof or changing readiness. |
| `--json` | Print the structured result, including `environments`, `excluded` and the report lines. |

While it runs, setup reports each phase as it starts: resolving each toolchain,
detecting each environment's installed dependencies, planning its sandbox
checks and running each check (for example `... npm@.: sandbox check
runner.ava`). The interactive report prints these lines before the result; with
`--json` they go to standard error, and standard output carries only the one
structured result.

This mode resolves exactly as ordinary setup does, through the same owner: an
explicit runner selection if one is given, otherwise the repository's own
inventory. A repository that has never been configured needs no arguments and
no hand-written file. An unconfigured toolchain is found on `PATH` by the
launcher owner, which reports one it cannot find
(`test_runtime_toolchain_not_found`, with the `--executable` correction)
instead of asking; this mode saves only an explicit `--runner` selection. What
this mode never does is rerun wiki bootstrap or touch root agent guidance.

## Toolchains

Each environment's ecosystem and runners name its toolchains; environments that
need the same toolchain share one installation. For each toolchain setup uses
the configured location when there is one, otherwise the first `node`,
`python3`, `go`, `rustc` or `deno` on setup's own `PATH`. It identifies the
complete installation from that executable, asks it for its version, and
records where it came from (`configured` or `host`). No marker, cache or
AgentChassis-made installation is needed: any installation that is complete and
reports a satisfying version is used as found.

Executable lookup checks absolute `PATH` entries in order and skips empty or
relative entries. Only a missing path (`ENOENT` or `ENOTDIR`) permits the next
candidate; denied access, a symlink loop or a nonregular file fails with the
offending path and operation (`test_runtime_toolchain_lookup_failed`). A
configured path is checked alone. Its absence reports
`test_runtime_toolchain_executable_unavailable`; an invalid location or missing
execute permission reports `test_runtime_toolchain_executable_invalid`.
Lookup observes current file identity but does not prove later readiness.

A version is required only by the repository or the operator:

1. a supported project pin (`.nvmrc`/`.node-version`, `.python-version`, a
   `toolchain goX.Y.Z` directive in `go.mod`, `rust-toolchain.toml`/
   `rust-toolchain`, `.dvmrc`), or
2. an explicit `--toolchain` request or configured `version`.

A pin of `x`, `x.y` or `x.y.z` is satisfied by any installed release with that
prefix. With neither, whatever version the installation reports is accepted
(`version_source: "installed"`); no default version decides. A pin and a
request that disagree, or two environments that pin different versions of one
toolchain, refuse with `test_runtime_version_conflict`; a pin that is not a
numeric version refuses with `test_runtime_version_unsupported`; an
installation that does not satisfy the requirement refuses with
`test_runtime_version_mismatch`. A toolchain found nowhere refuses with
`test_runtime_toolchain_not_found`.

A toolchain is complete only with every executable its recipe declares: `node`;
the Python interpreter; `go` and `gofmt`; `cargo` and `rustc`; `deno`. An
installation missing one of them refuses with
`test_runtime_toolchain_incomplete`, whose detail lists each `missing`
executable and its expected path. Rust needs a system `cc` linker under a
system root (`test_runtime_native_prerequisite_missing` otherwise). Supported
platform: Linux x86_64 (`test_runtime_platform_unsupported` otherwise).

Wiki-core owns the installed-toolchain descriptions: executable roles, paths,
populations, root rules and version-text parsers. Launcher recipes add project
pin readers, version acceptance and native prerequisite policy.

Wiki-core also owns installation observation: from one located executable it
finds the root (Rust asks `rustc --print sysroot`; Python describes itself in
isolated mode), checks the components the caller requires, and asks for the
version. It runs no process itself. The caller injects its bounded process
runner and supplies the working directory, base probe environments and a
timeout applied to each probe. For the version probe, the observer puts the
probed executable's directory first on `PATH` and sets `RUSTC` to the checked
`rustc` path, or to an empty string when none was checked. The returned
executables are the required roles plus the version-probe role. Setup injects
its host runner with a 60-second timeout and requests every recipe role, so Go
still needs `gofmt`. An observation asked only for Go's `go` role does not.

Observation failures keep distinct codes and their evidence:
`runtime_input_installation_components_missing` (absent components),
`runtime_input_installation_component_lookup_failed` (a component path that
cannot be read or executed), `runtime_input_installation_probe_failed` (a
timed-out, cancelled, overflowing, unstartable or failing probe, with its
outcome), `runtime_input_installation_output_invalid` (unusable probe output,
such as non-JSON, a relative path or unrecognized version text) and
`runtime_input_installation_invalid` (a malformed request or unknown role).
Setup reports an unreadable root or Python description, or missing components,
as `test_runtime_toolchain_incomplete`; a failed or unrecognized version as
`test_runtime_toolchain_unusable`; and an unreadable component as
`test_runtime_toolchain_lookup_failed`. Each attaches the observation.

### Setup host process outcomes and bounds

Host-side setup commands (version and installation-root checks, dependency
cache lookups) run directly on the host, unlike the sandbox probes described
under [Verification and readiness](#verification-and-readiness). Each runs its
executable with literal arguments and no shell, in the caller's working
directory and environment, and setup owns only that direct child: it tracks no
process group and cleans up no descendants.

Each command's result names the command and exactly one outcome. It succeeds
only when the command exits with code 0 and nothing stopped it. A command that
could not start reports its errno (for example `ENOENT`), and a nonzero exit or
signal keeps its code or signal. Three conditions stop the child with `SIGKILL`:

* the setup timeout expires (`timed_out`);
* the caller cancels (`cancelled`); a cancellation that already happened
  starts no process at all;
* a stream exceeds 1 MiB (`output_overflow` names `stdout` or `stderr`).

Output of exactly 1 MiB per stream is accepted. At most 1 MiB per stream is
kept, and output beyond it fails the command even when it then exits with
code 0, so truncated output is never parsed. The first stopping condition is
the recorded outcome; later events never replace it or turn it into success.
Every failed outcome's diagnostic starts with the command, the outcome and the
correction, even when the command wrote nothing, and then includes the retained
output's tail.

## Project dependencies

For each environment setup resolves the dependency installation that already
exists, checks that it holds what the project's own inputs declare, and records
it with a measured population. It never runs a package manager's install or
download, never creates or fills a virtual environment, never copies or
vendors dependencies into a replacement location, and never writes into the
installation. Lockfiles are required inputs and are never created or
rewritten.

Wiki-core owns population content digests, currentness fingerprints and named
input-file digests in its runtime-inputs population-identity module. Launcher
setup and readiness consume those measurements from that single owner. Its
runtime-inputs Go module likewise owns the offline Go module environment and
the module-cache population of a listed graph, shared by go-modules setup and
the code index; setup keeps its own `go env GOMODCACHE` selection and
`GOWORK=off` policy. Its runtime-inputs Cargo module owns the offline Cargo
settings (`CARGO_NET_OFFLINE`, `CARGO_TERM_COLOR`), the Cargo home selection
(`CARGO_HOME`, else `$HOME/.cargo`), a recorded toolchain's `RUSTC`/`RUSTDOC`
and the Cargo configuration-file lookup, shared by cargo setup and the code
index; setup keeps its source selection, vendored-directory checks and binding
policy.

| Ecosystem | Required inputs | Installation used, in precedence order | Validation | Attempt binding |
| --- | --- | --- | --- | --- |
| npm | `package.json` and each workspace member's `package.json`, plus `package-lock.json` when any dependency or member is declared | the installation root's own `node_modules` (a link to an installation elsewhere is that installation) | every `dependencies`/`devDependencies` name of the root and members is present; workspace-member links only | read-only, with each workspace member linked to its own source |
| python | `requirements.txt`, `test-requirements.txt` and/or `requirements-dev.txt` | 1. the explicitly selected `virtual_environment`; 2. the nearest `.venv` or `venv` holding `pyvenv.cfg`, from the project directory up to the repository root; 3. the detected interpreter's own site packages | the environment's interpreter is the detected Python; every named requirement (following `-r` includes) is an installed distribution | read-only environment |
| go modules | `go.mod` (and `go.sum`) | the module cache `go env GOMODCACHE` names under the operator's own Go configuration | the module graph lists with module lookup disabled (`GOPROXY=off`) | read-only `GOMODCACHE`, `GOPROXY=off` |
| cargo | `Cargo.toml` and each workspace member's `Cargo.toml`, `Cargo.lock` | 1. a configured directory (vendored) replacement of crates.io; 2. otherwise the registry and git stores of `CARGO_HOME` (`$CARGO_HOME`, else `~/.cargo`) | every locked crate is present (vendored with its checksum file, or downloaded and extracted), and the sandbox probe `cargo metadata --frozen` resolves the whole lock from that source | read-only vendored directory, or read-only registry/git stores; offline |
| deno | `deno.json`/`deno.jsonc`, `deno.lock` | the cache `deno info --json` reports (`DENO_DIR`, otherwise the runtime's own default) | the cache's remote/npm stores exist, and the sandbox probe `deno check --cached-only --frozen` type-checks every locked dependency from that cache | read-only `DENO_DIR` for setup probes and worker commands; for `deno test` proofs, the persistent writable `DENO_DIR` with links to the cache's `remote`/`npm` stores, bound read-only at their own paths; `--frozen --cached-only` |

A project with no locked dependencies (an npm package that declares none, a Go
module whose graph needs no module, a Cargo or Deno lock with no external
packages) needs no installation.

Compiler output is not a dependency installation. Go, Cargo, Deno and Vitest
proofs keep their native compiler caches (`GOCACHE`, `CARGO_TARGET_DIR`, Deno's
check and analysis state in its `DENO_DIR`, Vitest's native module cache of
transformed modules) in persistent directories below
`.cache/test-proof-native/` of the main repository, which the native tools
maintain themselves across proofs, calls and launcher restarts (see
[Test-proof runtime identity](test-proof-runtime-identity.md#persistent-native-compiler-caches-go-cargo-deno-and-vitest)).
For an environment with such a cache, setup adds the exact
`/.cache/test-proof-native/` exclusion to the repository-local Git exclude
file (`git rev-parse --git-path info/exclude`), keeping existing lines, and
refuses with `test_runtime_native_cache_exclusion_failed` when Git tracks any
file below that directory. Setup neither creates nor validates the caches
themselves, and they never hold dependency stores.

The sandbox probes run with the network denied and every dependency location
read-only, so they can only confirm what is already installed. For a JSR
package missing from the cache, Deno itself still requests the package's
metadata even under `--cached-only`; the request is denied and the probe fails
with Deno's own diagnostic.

Ambiguity and unsupported cases are reported, never resolved by guessing:

* two virtual environments (`.venv` and `venv`) at the same level refuse with
  `test_runtime_environment_ambiguous`; an explicit selection that is not an
  existing virtual environment refuses with
  `test_runtime_environment_selection_invalid`, and conventional discovery
  never stands in for it; a virtual environment made from another interpreter
  refuses with `test_runtime_environment_interpreter_mismatch`;
* an explicit selection for any environment other than `python@<project>` is
  refused; npm, Go, Deno and Cargo dependencies follow the installation root
  and the ecosystem's own configuration;
* a crates.io replacement that is not a directory source (a mirror registry, a
  local registry), a vendored-source declaration outside the project's own
  `.cargo/config.toml` and `$CARGO_HOME/config.toml` (which the confined command
  would not read), and a relative vendored directory that is not part of the
  project's Git-selected source refuse with
  `test_runtime_dependency_source_unsupported`;
* a link to anything other than a declared workspace member refuses with
  `test_runtime_local_package_link_unsupported`, and a member-private
  `node_modules` with `test_runtime_workspace_layout_unsupported`.

A missing installation or missing packages refuse with
`test_runtime_dependencies_missing`, naming where detection looked, what is
missing, the tool's own diagnostic when it ran one, and the correction (for
example `npm ci` in the installation root, installing the requirements into the
virtual environment, `go mod download`, `cargo fetch --locked` or `cargo vendor`,
`deno install --frozen`), which the operator runs. A missing lockfile refuses
with `test_runtime_dependency_lock_missing`. Runner packages such as Jest,
Vitest, Mocha, AVA, lib0, pytest and stestr must be declared and installed by
the project itself. stestr runs as the installed package's module under the
detected environment's interpreter (`<python> -I -B -m stestr`), so a selected
or discovered virtual environment and the interpreter's own site packages serve
it alike; no environment script or ambient `PATH` lookup is used. Only the dependency locations named here are ever bound;
for Cargo, `CARGO_HOME` credentials and other files are never bound, and a
`CARGO_HOME` configuration file is bound only when it declares the vendored
source.

## Verification and readiness

Before publishing, setup resolves every environment through the same
runtime-input composition that attempts use and proves it inside the launcher
sandbox with the network denied and every dependency location read-only: each
of its toolchains must report its detected version from the installation root,
and each runner proved there must pass its probe (installed runner package,
offline module or crate resolution). Only when every requested component is ready and
every check passed does setup publish `.agent-launch/test-runtimes/readiness.json`
as ready (see [Test-proof runtime identity](test-proof-runtime-identity.md#local-test-runtime-readiness)).
These setup-owned probes retain ordinary validation's private temporary mount.
An npm environment's runner probes run in a private copy of its project inside
that mount. The installed `node_modules` is bound read-only at its own path and
linked into the copy, and each workspace member resolves to its copied source.
The installation is never changed; the copy disappears with the probe. Executable version checks (each toolchain's version, and the
node:test runner, which is the recorded Node itself) run without any copy.

Every private working copy of a project (setup's probes and proof attempts
alike) holds exactly the project source Git selects:

* every tracked file that still exists, with its current working-tree bytes
  (uncommitted edits included), even when an ignore rule matches it; a tracked
  file deleted in the working tree is absent;
* every untracked file Git's ignore rules (nested `.gitignore` files,
  `.git/info/exclude` and the configured excludes file) do not ignore;
* the files of an initialized submodule, by the same rule; an untracked nested
  repository contributes nothing.

Files keep their permission bits, and symbolic links are copied as links and
never followed into the dependency or external trees they name. Ignored
scratch checkouts, run state, caches and installed dependency trees are never
read or copied. The project root's own `.git`, `.agent-launch`, `node_modules`,
`target`, `__pycache__`, `.pytest_cache` and `.stestr` are never copied either,
because the copy's own layout owns them; nested source directories of those
names are copied when Git selects them. Nothing needs to be committed first.
The project must be inside a Git working tree: otherwise, or when Git fails,
the affected check fails with `test_runtime_source_selection_failed`, the exact
Git condition and its recovery, and nothing is copied. A selected project file
the probe cannot read fails that check with the copy error as the diagnostic.
The host system `/tmp` selection is specific to later `workspace_verify_proof`
subprocesses and requires no consuming-repository option.

Inventorying environments, resolving an executable and saving
`agent-chassis-runtime.json` are none of them readiness: only this published
record means the environments' tests can actually run, and setup says so
explicitly in its final line. The record lists every environment by its public
ID with its members, proved runners and toolchains; `workspace_verify_proof`
routes each saved test to one of them and accepts that ID as its optional
`environment` (see
[Test-proof runtime identity](test-proof-runtime-identity.md#prepared-environment-routing)).

The record is the repository's current detection state, not only a success
marker. Once a request is valid (repository, options, platform and every
environment resolved), setup takes the repository's preparation lock
(`.agent-launch/test-runtimes/preparation.lock`) and publishes the attempt as
`preparing` before any detection or probe work. The same attempt then publishes
`ready`, or `failed` with its complete structured result: each component's
outcome (`ready`, `failed`, `blocked` or `planned`), each verification check,
the failure code and the diagnostics setup captured, including captured
process output as setup captured it. A failed run therefore replaces an
earlier ready record instead of leaving it usable, and the failure is never
lost: the next ready publication keeps the immediately preceding failure as
`last_failure`. An attempt whose process dies stays `preparing`, which is never
usable. Only `ready` grants runtime inputs; `preparing` and `failed` refuse with
`test_runtime_preparation_in_progress` and `test_runtime_preparation_failed`,
and neither is ever read as a repository with no test runtimes.

A second setup started while one holds the lock is refused with
`test_runtime_preparation_in_progress` and changes nothing. A lock whose owner
process is positively confirmed dead is reclaimed; a live or undeterminable
owner never is. `--dry-run`, and a request refused before preparing (an unknown
toolchain, an unsupported platform, an unused executable location), leave the
current state unchanged. A record that fails its digest or belongs to another
repository is invalid. A publication that cannot be made durable is reported as
`test_runtime_readiness_publication_failed`, never as ready.

Recovery is the same producer after the operator's repair: install or correct
what the failed result names with the ecosystem's own tools (or point the
configuration at a usable existing installation), then let detection run again
(`agent-chassis setup --test-runtimes`). It re-resolves the inventory, detects
and validates again and probes again; no marker is deleted and no record is
hand-written. A later change to a lockfile, a detected dependency installation
or a toolchain makes attempts refuse with a stale-input environment failure
until detection runs again.

## Coding workers

A managed implementation worker uses the same published readiness for its
ordinary commands. Every detected environment whose installation root contains
one of the worker's resolved scope members is re-proved when the worker
launches. For each project,
the exact dependency input files its ecosystem measures must be visible in the
worker's read or write scope; otherwise that project reports
`test_runtime_project_inputs_outside_scope`, naming the missing files, for the
coordinator to add them to the unit's scope. Inside the worker, `node`,
`python3`, `go`, `gofmt`, `cargo`, `rustc` and `deno` resolve to the
detected installations. Project-dependent commands (`python3`, `go`, `cargo`,
`deno`) use the detected dependencies of the project that contains the current
directory. The installed npm `node_modules` appears read-only inside that
project, and each workspace member link resolves to that member's source in the
worker's own checkout; a member directory outside the worker's scope is
reported as `test_runtime_workspace_member_outside_scope`, naming the
directories for the coordinator to add, and the scope is never widened. Build,
cache and temporary writes go to private scratch.

Detection must have run first: a worker never installs anything, and a missing
or stale runtime is reported with the `agent-chassis setup --test-runtimes`
recovery. A detection that is still running or failed for an environment the
worker's scope reaches refuses the launch before any worker starts, with
`agent_launch.worker_test_runtime.preparation_unusable.v1`, the preparation's
identity and its complete original result; a worker whose scope reaches none of
that preparation's environments, and a repository that was never prepared,
launch as before. See
[Prepared test runtimes in the coding worker](agent-launch-confinement-mcp-conduit.md#prepared-test-runtimes-in-the-coding-worker).
