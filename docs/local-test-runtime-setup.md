# Local test-runtime setup

Native saved-proof attempts run against local test runtimes that already exist
on the host. `verify_proof` runs those attempts (see
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
| python | a directory with `requirements.txt`, `test-requirements.txt` and/or `requirements-dev.txt`, or, without any of them, a `pyproject.toml` with runner evidence | `python@services/api` |
| go_modules | a `go.mod` directory | `go_modules@billing` |
| cargo | a `Cargo.toml` directory; `[workspace] members` share its lock | `cargo@.` |
| deno | a `deno.json`/`deno.jsonc` directory | `deno@edge` |

Setup detects every environment the repository declares that has a runner, in
every language at once. The runners proved in an environment are exactly:

* the runner its toolchain provides — node:test with Node, `go test`, `cargo
  test`, `deno test` — and
* each framework the environment itself declares: a `jest`, `vitest`, `mocha`,
  `ava` or `lib0` dependency in the root or a workspace member of an npm
  environment, or a `pytest` or `stestr` requirement of a Python environment.
  Runner evidence in a `pyproject.toml` is any mention of the runner: a
  dependency, a dependency group or the runner's own configuration table.
  Evidence only selects the runner. What a Python project without requirement
  files must have installed is its `pyproject.toml`'s `[project]`
  `dependencies`; an optional-dependency or dependency group (a documentation
  extra, for example) is never required, because nothing in the file says which
  groups are selected. The runner itself is proved by sandbox verification.

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
  nothing to detect (`no_dependency_inputs`);
* an environment with no runner — Python requirement files that declare neither
  `pytest` nor `stestr`, such as documentation tooling — is not a test
  environment (`no_test_runner_declared`). Its dependencies are neither
  detected nor required, and it is never reported ready. An explicit runner
  selection there detects it as named.

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
associations exactly as they were. Stored associations have no effect on what
setup detects; they choose the harness of an
[ordinary test run](#ordinary-test-runs) and nothing else. They are host-local
configuration, not verified source and not readiness.

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
| python | `requirements.txt`, `test-requirements.txt` and/or `requirements-dev.txt`; without any of them, the `pyproject.toml` | 1. the explicitly selected `virtual_environment`; 2. the nearest `.venv` or `venv` holding `pyvenv.cfg`, from the project directory up to the repository root; 3. the detected interpreter's own site packages | the environment's interpreter is the detected Python; every named requirement (following `-r` includes, or each of the `pyproject.toml`'s `[project]` `dependencies`) is an installed distribution | read-only environment |
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
These setup-owned probes retain ordinary validation's private temporary mount
and its read-only checkout.
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
The host system `/tmp` selection is specific to later `verify_proof`
subprocesses and requires no consuming-repository option.

Inventorying environments, resolving an executable and saving
`agent-chassis-runtime.json` are none of them readiness: only this published
record means setup detected, validated and probed the environments, and setup
says so explicitly in its final line. The record lists every environment by its public
ID with its members, proved runners and toolchains; `verify_proof`
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
earlier ready record as the current state, and the failure is never
lost: the next ready publication keeps the immediately preceding failure as
`last_failure`. An attempt whose process dies stays `preparing`. `loadReadiness`
reports `preparing` and `failed` as `test_runtime_preparation_in_progress` and
`test_runtime_preparation_failed`, and neither is ever read as a repository
with no test runtimes.

The record's state is setup's own result. It is not a condition on running
tests. For execution the record is configuration: it names where the
operator's toolchains and dependency environments are. A `preparing` or
`failed` record keeps, as `configured`, the configuration of the ready record
it superseded (its environments, selection, toolchains and dependency
environments), and test runs, proof attempts and worker commands launch with
that configuration exactly as they launch with a ready record's. A repository
with no record, and a record that carries no configuration because no
detection ever succeeded, are not refused either: a test run or proof attempt
there locates its inputs for that run.
See [Runtime inputs at execution](#runtime-inputs-at-execution).

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
hand-written.

### Runtime inputs at execution

One resolution owner serves ordinary test runs, proof attempts and worker
commands: `resolveCurrentEnvironmentInputs` in `test-runtime-setup/readiness.mjs`,
composed by `test-execution/runtime-inputs.mjs`, and reached by test runs and
proof attempts through `resolveCurrentRunnerRuntime` in
`test-execution/current-runtime.mjs`. It hands an execution its toolchain
executables and dependency locations as they are when the run starts. Nothing
setup measured, proved or inventoried earlier decides whether the harness is
invoked: not a metadata fingerprint (file identity, timestamps, a reboot or a
reinstall), not a content digest or version, not the digest of the dependency
input files, not the presence of a lockfile, not whether setup proved the
runner in the environment or inventoried the project, and not the state or
existence of a setup record. No setup or sandbox probe runs first, nothing is
installed, and the record is never written by a run. The harness and its
toolchain decide their own compatibility: a changed interpreter, a changed
lockfile or a dependency the installation lacks produces the harness's own
result or error.

**Routing.** The runner names the dependency ecosystem. The target's
environment is the installation root of that ecosystem that owns it: the
longest of the published environments that contain it and the environments
the checkout itself declares now. The checkout's environments come from the
one repository inventory setup uses (`test-runtime-setup/discovery.mjs` in the
launcher package): the same bounded manifest walk, ignore and fixture rules,
workspace membership and installation roots. A project, or a root nested
inside a published environment, that was declared after setup is therefore its
own environment, `<ecosystem>@<root>`, with its workspace members (including
an npm member its root lock records below the walk), and can also be named. A
manifest that declares dependencies and has no lockfile is an installation
root like any other: a lock is setup's diagnostic, not a condition on running.
A target no root owns has no runtime to select
(`test_runtime_runner_not_prepared`).

The inventory's manifest walk stays bounded (three directories below the
root). The explicitly selected target is the one exception, and it is not a
deeper walk: the manifests in the target's own ancestor directories are looked
up directly, one directory per path segment, under the same skipped-tree and
ignore rules. A selected file that lies deeper than the walk is therefore
routed to the project that declares it, and a workspace member on the
target's path is a member of its declaring root even when no lock records it;
neither is silently attributed to an enclosing environment. What remains
outside the inventory is a project or member below the walk that no selected
target lies in and no root lock records: it is not listed as a valid choice,
not projected for a worker whose scope reaches only it, and not linked as a
workspace member of a run that selected some other file.

**Inputs.** What the published configuration names is used as configured.
What it does not name (every input of a repository with no configuration, the
dependency environment of a root declared after setup, the toolchain of a
runner setup never recorded) is located for that run through the detection
owners setup itself uses, in location-only form (`locateEnvironmentInputs`):

- A toolchain is the executable the operator saved for it in
  `agent-chassis-runtime.json`, otherwise the recipe's command on `PATH`. The
  saved file is read by the one configuration owner setup uses
  (`test-runtime-setup/config.mjs` in the launcher package), so a file that
  owner refuses (invalid JSON, an unknown field, a location that is not an
  absolute path) fails the run with `test_runtime_configuration_invalid`; its
  locations are never dropped in favour of `PATH`. The installation's layout
  is located, and it is asked for its version; no repository pin or version
  request is read or applied. Locating does not judge the installation: a
  version probe that fails or prints unrecognized text leaves the version
  unknown (`version: null`), and a recipe executable the run does not launch
  need not exist (`go test` does not need `gofmt`). The executable a run does
  launch is still required. A saved location that does not resolve is that
  failure and is never replaced by `PATH`.
- A dependency environment is the one the ecosystem's own rule finds: the
  root's `node_modules` (with or without a lockfile, and with each workspace
  member linked to its own source), the virtual environment saved for the environment
  (else the nearest `.venv` or `venv`, else the interpreter's own packages),
  the module cache `go env GOMODCACHE` names, Cargo's effective source, Deno's
  cache. A missing lockfile is never taken as evidence that nothing is
  installed: without `Cargo.lock` the configured vendored directory, or the
  `registry` (and `git`) stores of `CARGO_HOME`, are located whole, and without
  `deno.lock` the cache `deno info` reports is. Whether the tool accepts the
  project without its lock is the tool's own result. (The Deno runner
  integration itself reads `deno.lock` to build its command and refuses with
  `test_runtime_dependency_lock_missing` when it is absent.) Whether an installation
  holds everything the project declares is not checked. One
  that is not there is recorded with status `absent`, nothing is bound for it,
  and the harness reports what it then cannot load.

Locating runs on every such resolution and is not cached or published.

Each run records the provenance observed for that run instead of repeating
setup's measurements. The run's identity names the record the configuration
came from (`readiness_digest`, null without a record, plus
`configuration_record_status` when that record is `preparing`, `failed` or
`absent`) and, per input:

- An input located for the run reports `observed: "located_for_this_run"` with
  the version the toolchain reported and the content digest measured for that
  run; it has no `setup_*` facts.
- A toolchain whose population still has setup's metadata, or whose bytes
  measured now equal setup's content digest, reports setup's `version`,
  `source` and `content_digest`. A toolchain whose bytes differ reports
  `version: null`, the `content_digest` measured now and
  `observed: "changed_since_setup"`, with setup's facts kept apart as
  `setup_version` and `setup_content_digest`. A population that cannot be read
  reports `observed: "unobservable"` with the `errno`.
- The dependency environment reports the `inputs_digest` of the checkout's
  dependency input files as they are now and the installation's
  `content_digest` by the same rule. Inputs that differ from setup's add
  `inputs_observed: "changed_since_setup"` (or `lock_missing` or `unreadable`,
  with a null digest) and `setup_inputs_digest`; a changed installation adds
  `observed` and `setup_content_digest`.

Content is measured only when the metadata no longer matches, once per process
for each unchanged population.

What still refuses before anything runs is mechanical. A record is
authenticated before anything in it is used: one that does not reproduce its
digest or belongs to another repository is never consumed. It supplies no
path, environment or digest; the run locates its inputs as it would with no
record and reports `configuration_record_status: "invalid"`. The record is not
required, so its being invalid is not a refusal. The operator's saved
configuration is an input the run does consume, so a malformed one is
(`test_runtime_configuration_invalid`). The target must be owned by an installation root, and a named
environment must exist, be of the runner's ecosystem and contain the target
(`test_runtime_runner_not_prepared`, `test_runtime_environment_unknown`,
`test_runtime_environment_incompatible`). An input that is not configured must
be locatable: a toolchain that is neither saved nor on `PATH`, or whose
installation cannot be identified, fails with the detection owner's own code
(for example `test_runtime_toolchain_not_found`). A caller that resolves
synchronously and cannot locate (`resolveRunnerRuntimeInputs` without located
inputs) receives `test_runtime_environment_not_prepared` with the exact
`locate` request. The executable a run is about to launch must
exist and be an executable regular file
(`test_runtime_toolchain_executable_unavailable`,
`test_runtime_toolchain_executable_invalid`); the configured location is never
replaced by another executable. Request validation, target and source
authentication, routing, confinement and result authentication are unchanged.

## Ordinary test runs

The launcher has one internal entry that runs one repository test file with its
prepared runner, outside any proof: `runOrdinaryTestFile` in
`packages/agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs`. It
grants no proof credit, and agents reach it only through the
[`workspace_run_test`](#the-workspace_run_test-route) route. Its trusted
launcher caller supplies the repository that owns the runtime configuration, the exact checkout,
one literal repository-relative file, a runner name and, optionally, a published
environment ID, one native selector, a timeout and an execution budget. Nothing
else is an input: commands, arguments, environment variables and host paths
are refused (`ordinary_test_request_invalid`). An absolute, glob, `.`/`..`,
missing, directory or symlink-escaping target is refused before anything runs
(`ordinary_test_target_invalid`, `ordinary_test_target_missing`,
`ordinary_test_target_not_file`, `ordinary_test_target_escapes_checkout`), as is
a selector that is empty, multi-line or begins with `-`
(`ordinary_test_selector_invalid`).

The file is routed exactly as a proof target is: the runner's ecosystem and the
containing installation root choose the environment (see
[Test-proof runtime identity](test-proof-runtime-identity.md#prepared-environment-routing)),
and its toolchains and dependencies are used as they are now, configured or
located for the run (see
[Runtime inputs at execution](#runtime-inputs-at-execution)). A target no
installation root owns, a wrong named environment, a record that is not
authentic, an input that cannot be located, or an executable that is gone or
not executable is refused with its owner's own code; nothing is installed and
a configured location is never replaced. The command then runs through the same confined
execution as proof stages, in the checkout with its own private
`/tmp` and scratch, and the result carries that execution's process, timeout,
cancellation, output-completeness and cleanup facts with the runtime, target,
harness and exact native command. The result status is `executed` when that
command ran and `not_run` when it never started (a plan or spawn failure, or
an interruption before start), with the shared execution facts either way.

**Checkout writes.** A test execution, an ordinary run or a proof stage, may
create, change and remove files in its own checkout, fixture directories named
`.git` included. Those writes are made in the checkout on the host and the run
neither removes nor hides them: a test that leaves a change behind has moved
the source, which source currentness reports. The checkout's own Git
administration stays read-only: its root `.git`, whether a directory or a
linked worktree's pointer file. A root `.git` that is a symbolic link or
another file type cannot be kept read-only, so that run is `not_run` with
`agent_launch.isolation.test_runtime_projection_refused.v1`. Installed
dependencies, every other runtime input, the secret masks and an existing
`wiki/decisions` stay read-only, and the network stays denied. When a
dependency mountpoint is missing from the checkout, the mountpoint, the
checkout root and each directory between them exist only in the run's
namespace and are read-only there: the test writes anywhere beneath their
existing entries and can change an existing file in them, but cannot create,
rename or remove an entry directly in one of those directories. Setup's own
probes never write the checkout.

The requested file locates the runner's normal execution unit; it is not a
promise that only tests defined in that file run. Where the runner's unit is
larger than the file (a Go package, a Vitest file filter), neighboring tests
run too, and the result's `selection` reports the resolved unit or filter and
the native listing the runner gave.

The runner and the repository's configured harness own test semantics. Which
tests run, what passes, skips or counts as zero tests, and what is printed are
theirs; the launcher collects no tests, adds no observer and reads no counts or
attribution from the output, so the result's success is the native process
success and nothing more. A native selector is passed in the runner's own
syntax:

| Runner | File selection | Selector |
| --- | --- | --- |
| `node-test` | `node --test <file>`, or the configured wrapper (below) | `--test-name-pattern` |
| `jest` | `jest --runTestsByPath <file>` | `--testNamePattern` |
| `vitest` | `vitest run <file>`; its prefix and substring filter may select neighboring files, which `vitest list --filesOnly` reports first | `--testNamePattern` |
| `mocha` | `mocha <file>` with the project's configuration and reporter | `--grep` |
| `ava` | `ava <file>` with the project's configuration (cache disabled, the installation is read-only) | `--match` |
| `deno` | `deno test <file>`, offline, frozen, without permissions | `--filter` |
| `lib0-testing` | the file itself, or the separate harness its association names | lib0 `--filter` |
| `pytest` | `pytest <file>` | `<file>::<selector>` node ID |
| `stestr` | `stestr run` with the file's dotted module path as an anchored test-ID prefix | Python regular expression after that prefix, checked by the prepared interpreter's `re` |
| `go-test` | `go test` of the file's whole package, all of its test files, once `go list` reports the file as one of them | `-run` over the package |
| `cargo-test` | `cargo test` of the target whose crate root the file is, from `cargo metadata` | libtest name filter |

A runner's own listing, metadata or validation command (`vitest list`,
`go list`, `cargo metadata`, the wrapper's `list`, the stestr selector check)
runs first through the same confined execution and budget, and every such
command is reported in the result's `resolution` with its own facts. When one
does not succeed (a native failure, timeout, cancellation or lost output), or
its output cannot be read, the result is `selection_unresolved`
(`ordinary_test_selection_unresolved`) with that cause. A command that did not
succeed states `detail.phase:"selection"` and `detail.diagnostic`, the
diagnostic text that command itself carried: its `source` (`blocker_message`
or `spawn_error` whole when it never started, otherwise `stderr`, else
`stdout`), the literal `text`, its byte `offset` in that source,
`total_bytes` and the `basis` of the cut. Captured output gives at most 256
bytes: from the first line carrying a common error word (`first_error_line`),
else a short stream `whole`, else its `tail`. The excerpt is cut, never
interpreted, and a command that carried no text states `source:"none"`. A target the runner
has no unit for is refused with `ordinary_test_selection_unsupported` and the
specific reason, never replaced by an unrelated target: a non-test Go file or
one `go list` does not report, a Rust file that is no Cargo target's crate
root, or a stestr file whose path is not a Python module path. A refusal means
the requested test command never started; selection commands that ran before
it stay in `resolution`. stestr compiles its filter with Python's `re`, so the
prepared interpreter's own `re` checks the selector before it is placed inside
the launcher's module-prefix group: it must compile on its own and inside that
group, so it can never close the group and widen the filter. A selector Python
rejects is refused with `ordinary_test_selector_invalid` and Python's error;
an interrupted or failed check stays `selection_unresolved`. The stestr
selector is therefore relative to the file: `unit/test_clamp.py` supplies the
prefix `unit.test_clamp.`, and native ID
`unit.test_clamp.ClampTests.test_preserves` is selected by
`ClampTests\.test_preserves`. The selector is used as given, never stripped
or rewritten: the full native ID, or a saved-proof target such as
`unit/test_clamp.py::ClampTests.test_preserves` (a different representation),
is composed after the prefix like any other text and matches nothing. The
`selector` field of `workspace_run_test` states the same rule, and a stestr
run with a selector that executes and does not pass shows the composed
filter in its first answer as `selection.test_id_filter`, the runner
integration's own value (clipped with `omitted_bytes` when it does not fit;
the `outcome` view's `native` retains it whole). That is what ran, not a
diagnosis: a selector that matches nothing stays an executed native failure
with stestr's own output, and no test is chosen or retried for the caller.
Configuration-driven additions
(for example a Mocha `spec` or a pytest `addopts` path) are the harness's own
behavior and run as configured.

Saved [test-entrypoint associations](#test-entrypoint-associations) choose the
harness. A `lib0-testing` association whose `target` is the file runs its
`entrypoint` instead of the file; without one the file runs as a self-running
lib0 module. A `node-test` association with the `node-test-wrapper` adapter
runs every node:test file of its project through that wrapper's own command
line, from the project directory with project-relative paths: its `list` mode
classifies the file, and `<wrapper> <mode> [--test-name-pattern=<selector>]
<file>` runs it, so the wrapper keeps its own environment clamp, watchdog and
timeouts. A file the wrapper does not list is refused, and a failing wrapper
listing (for example its own refusal of an uncategorized corpus) is reported
as `selection_unresolved`. An association entrypoint that is missing or outside
the checkout is refused (`ordinary_test_entrypoint_invalid`), and an invalid
saved field keeps `test_runtime_test_entrypoints_invalid`.

### The workspace_run_test route

`workspace_run_test` is the MCP route to one ordinary run, granted to
authenticated orchestrator, worker and reviewer sessions only. Proof questions
stay with `verify_proof`; this route never grants proof credit.

**Repository.** The server resolves one unique repository from trusted host
configuration. `repo` is neither advertised nor accepted: supplying it, even
with the matching alias, refuses before source/runtime work. Execution, retries
and retained reads bind the same repository. A foreign seed or original never
redirects execution or reading; source authentication remains required. Missing
or ambiguous host configuration keeps its native resolver refusal.

**Request.** One strict schema is published and enforced, and a request is
exactly one of four modes. An execution names `file` (one literal
repository-relative file) and `runner`, and optionally `environment` (a
setup-published environment ID), `selector` (one native selector), `timeout`
(`short`, `medium` (the default), `long` or `{ seconds }`, the shared
execution-timeout language), `compare_parent` (default `false`) and, for an
orchestrator, `source`. `read` is `{result, view}`: one semantic view of a
retained result. `continue` is a continuation copied from an earlier answer,
which is the selected-response selection under this route's name. `retry` is
`{request, changes?, clear?}`: a new execution of the retained request a
refusal named, where `changes` sets execution fields to non-null values and
`clear` is a non-empty list of distinct names from `environment`, `selector`,
`timeout`, `compare_parent` and `source`; a field is cleared or changed, never
both, and `file` and `runner` cannot be cleared. The schema is closed: commands,
arguments, environment variables, roots, roles and binding facts are not
fields, and an unknown field, a null value or a mix of modes is refused before
any source or runtime work (`run_test.request_invalid.v1`). File, runner and
selector rules are the runner's own codes listed above; a refused target never
starts anything.

**Source.** A worker runs its launcher-bound slice checkout, live uncommitted
edits included, authenticated through its verified identity-store slice binding
and the exact WK/slice binding pair of its run. A reviewer runs its frozen review
materialization. Neither may name a source: the refusal
(`run_test.source_not_permitted.v1`) returns one `retry` of the retained
request with `clear:["source"]`. The source is never dropped automatically;
that call runs only when the caller invokes it.
An orchestrator must name its source; an execution without one is refused
before anything is resolved or run (`run_test.source_required.v1`) with
`missing_fields` and `source_kinds`, and one `retry` whose `changes.source`
selects `current_main`; the same `retry` with a `changes.source` of kind
`exact_sha` selects that commit, or of kind `branch` that branch's commit. It
names `{kind:"current_main"}` (the configured worktree, dirty state included),
`{kind:"exact_sha", value}` or `{kind:"branch", value}`. A branch `value` is a
WK ID, a full slice ID (`work record`) or a canonical WK or slice branch
name; the resolver `verify_proof` also uses resolves it once to the commit that
branch names, and the answer and the retained `source` view report the branch
beside that commit. A value that names no existing canonical branch refuses
with `run_test.source_not_executable.v1` and `selector_invalid`,
`initiative_unavailable`, `branch_missing` or `branch_commit_unavailable`, and
the configured checkout never runs in its place. The selected commit must be
held by an existing, owned, registered, canonical, full and clean checkout of
that exact commit and tree in this repository. Several such checkouts of one
commit are one source, not an ambiguity: delivery leaves the worker's slice
checkout clean and integration leaves the WK checkout clean, so both may hold
the same commit. After deduplication by physical identity the checkout with the
smallest canonical path in bytewise UTF-8 order is selected, whatever order Git
enumerates its registrations in. A branch selection keeps its authenticated
unit and uses only the checkout the launcher identity store records for that
unit; it never borrows another unit's clean copy of the same commit, and when
its own checkout is dirty or absent it refuses. The selection is among proved
equals and claims nothing more: equal commits do not have equal ignored or
prepared runtime inputs, so the selected checkout's own execution-visible bytes
and prepared runtime are measured as for any source, and a source, runtime or
execution failure on it is the answer and is never retried on another checkout,
another commit or the configured checkout. The eligible owners
are the configured worktree, a worktree the launcher identity store records,
and the terminal-candidate owner's existing private checkout of a terminal
squash candidate. That last owner is consulted only for a commit carrying
terminal candidate metadata, which locates its WK and grants nothing: the
existing read-only terminal observation must authenticate the commit as that
WK's selected candidate and verify its checkout under the launcher-derived
worktree root. A commit object, a Git registration, a candidate-shaped path or
a candidate-shaped commit message alone is not enough, and nothing is checked
out, created, published or recovered by the lookup: the refusal
`run_test.source_not_executable.v1` names `not_materialized`, `unowned`,
`dirty`, `moved`, `repository_mismatch`, `commit_unavailable` or
`terminal_owner_refused`. `terminal_owner_refused`
means the commit is a terminal candidate that its owner did not authenticate
(not the selected candidate, or its checkout missing, moved or dirty) and no
other eligible owner holds it; the refusal carries that owner's own cause
(`cause_code`, `cause_message`, `owner_cause_code`) and the lookup's
`lookup_reason`. A source that cannot be authenticated is never replaced by
another one: a worker's or reviewer's missing binding
(`run_test.worker_source_unauthenticated.v1`,
`run_test.reviewer_source_unauthenticated.v1`), an unavailable configured
checkout and an exact commit without an owned checkout each state
`unavailable_capability` and `owner` and return no call, because no caller
correction exists. One refusal also returns a read-only call. When an
orchestrator's exact commit, or the commit its slice branch names, is refused
as `dirty` and the same lookup found that commit's one considered checkout to
be a worktree the launcher identity store records for exactly one slice (for a
branch selection, the selected slice), the refusal keeps its cause, commit,
`unavailable_capability` and `owner`, names that slice as `owning_slice` and
returns `get_run_result({subject})` for its full slice ID. That call only
inspects the slice's delivery: the caller matches the delivery's commit to the
refused one before separately approving any integration that result offers.
The refusal itself selects no delivery, offers no integration, retries nothing
and runs no other source. A delivered slice commit is in this state when its
slice worktree is no longer a clean checkout of it, because the delivery's own
checkout finalization is still pending or the slice has been edited since
([slice integration](mcp-dispatch-slice-integration.md)). Every other refused
commit returns no call: one held by several unusable checkouts, by an unowned, moved or
otherwise unusable one, by the configured or WK worktree, by a worktree
recorded for more than one unit or for a slice other than the selected one, and
one no checkout holds. A publication head is such a commit until an owner
materializes it; the integrated commit or the terminal candidate is never run
in its place, even when their trees agree.

**Execution scope.** The file locates the runner's normal unit, so neighboring
tests the harness selects run too; the answer promises no file-only execution,
reports no test counts and parses nothing. One monotonic execution budget is
minted from the timeout after input validation and before any source or runtime
work; the MCP request's cancellation is its only cancellation. Source
currentness is checked after each run: the checkout's execution-visible bytes
and its exact HEAD commit and tree, and nothing else. The runtime is observed
again separately, through the owner the run resolved it with (located inputs
are located again), and the observation is reported with the run's native
result as `runtime_after_run`: `unchanged`; `changed`, with the fields that
differ and the runtime observed then; `not_applicable` for a result that
reached no runtime; or `unknown` with the exact cause when it could not be
observed. An observation that was not made is never reported as unchanged,
and a runtime that changed never alters the run's outcome, its source
currentness or whether a comparison runs. The compact answer carries
`runtime_after_run` as bounded facts (`status` always; the changed field
names, the owner's `code` and the stated `cause` while they fit, each at most
64 bytes), an attempted baseline carries its own status, and the retained
`outcome` and `comparison` views carry the same four facts unclipped
(`runtime_after_run`, `baseline_runtime_after_run`); the complete observation
stays in the retained native result. Nothing is run again to produce it. The bytes are a filesystem walk of every entry, ignored inputs and
executable bits included; a directory's name alone excludes nothing. Only what
the execution cannot see or another owner re-proves is left out: the
`.agent-launch` directory and the `.env` file the confinement masks, the Git
object store (content-addressed; the rest of Git's metadata is measured), a
dependency mountpoint the prepared runtime binds another tree over, and a
toolchain or dependency population inside the checkout, which the run's own
runtime identity observes, except the names that population's own
fingerprint excludes. Everything else is measured, so a checkout holding large
unmasked trees (for example runtime records or caches the run does not prepare)
is hashed in full on each check. This is two observations compared, not an
atomic snapshot. Git is only read: status runs without optional locks and the
terminal checkout's index is compared with its tree rather than written out, so
no observation rewrites the index. The answer's `source` states the candidate's
exact `commit` and `snapshot_digest`, the digest of those execution-visible
bytes at the initial observation, so two dirty states of one HEAD are distinct
sources; it identifies the checkout bytes with the exclusions above, not the
prepared runtime. A moved source is the later observation and is reported
(`source.current:false` with `source.moved`).

**Comparison.** With `compare_parent:true`, the same request runs at most once
more, on the same budget, only when the candidate's final test command ran and
exited normally with a nonzero code (an assertion failure and a harness
configuration failure alike). A succeeding, refused, unresolved, not-run,
signal-terminated, timed-out or cancelled candidate, lost captured output, an
unconfirmed cleanup, a moved source and an expired budget each make the
comparison `not_eligible` with that reason. The baseline is the candidate's own
HEAD when it carries uncommitted edits and otherwise its one immediate parent; a
worker's uncommitted edits at its slice's recorded start compare with its WK
worktree at that start, never with the WK's older fork. Only an already-owned
clean materialization serves, selected by the same exact-commit lookup with the
candidate's own checkout excluded (for a worker, its own pair's WK worktree): a
dirty, moved, missing or merge-parent baseline makes the comparison
`unavailable` with its reason, and no older ancestor is searched. The baseline
runs with its own checkout's saved entrypoint associations and runtime, and its
outcome is reported beside the candidate's, never in its place; nothing infers
a cause.

**Response limit.** Every response, refusals, selections and continuations
included, is at most 1,024 UTF-8 bytes as the response owner measures it. The
mandatory frame is the status, `proof_credit:false`, the candidate commit and
initial snapshot digest, the run's exit, interruption, cleanup and capture
facts, source currentness, the comparison state and one next call. The message,
the failed phase's `cause`, the baseline facts and the native stdout and stderr
of both sides share what remains and are shown when they fit: each stream shows
its captured tail at a character boundary with `omitted_bytes`,
`output_complete:false` marks any clipping and `native_output_only:true` marks
that the output was neither parsed nor examined. What does not fit stays
selectable in the retained result.

**Failure cause.** The phase that failed keeps the cause it captured, as
`cause` with its `phase` and `source`. An unresolved selection
(`phase:"selection"`) shows its command's `detail.diagnostic`; the same
diagnostic is in the retained `failure` view's `detail`, and the answer names
that view, never a test stream that was not attempted. A final command that
never started (`not_run`) shows its `blocker_message` (else its `spawn_error`
text), which is also the retained `failure` view's `message`, and the answer
names that view. A final command that ran and failed shows a literal excerpt
only when the shown tail of its own stream does not reach it: at most 256
bytes of the candidate's stderr, else stdout, from the first line carrying a
common error word, with the retained `view` (`candidate_stderr` or
`candidate_stdout`) and byte `offset` it starts at, so the same bytes read
back from that view. The baseline's output is never a cause. `text` is the
captured text, `omitted_bytes` states what of it was clipped, and
`source:"none"` states that the phase captured no diagnostic. The cause is
fitted before the stream tails, and the stream text, the baseline facts and
then the optional facts (`source.dirty`, the runtime observation's detail and
the `correction`, which the retained `failure` view keeps) give way until its
first line shows whole. It changes no outcome, comparison or retention.
Clipping is presentation only and does not prevent a comparison;
`run.output_lost` is the executor's own capture loss, which does. A test's
success grants no proof, lifecycle or integration credit.

**Retained reads.** The complete settled result is retained once through the
selected-response owner, bound to the server-resolved caller identity, and
protected from the generic content-reference reader, which refuses it with this
route's own call. It has eight views. `outcome` (the execution flags, the
request and the complete native result with its selected population), `source`
(the initial identity and currentness), `comparison` (both identities, both
outcomes and the eligibility) and `failure` (the complete original cause, its
recovery, the execution effects and the retained correction of a refused
request) are structured; `candidate_stdout`,
`candidate_stderr`, `baseline_stdout` and `baseline_stderr` are the streams. An
answer's `next_calls` names the first clipped stream, otherwise the `failure`
view of a refusal, otherwise `outcome`. A `read` returns a view whole when it
fits. Otherwise a structured view is read field by field in its fixed order
and a long value in byte ranges of whole characters with `next_offset`. A
stream too long to return whole answers its `read` with its first byte range,
the native text from offset 0 that fits, never with a selection alone; every
answer returns the exact `continue` call for what follows, and the last read of
a view names the next view, in the order above and wrapping, so every view is
reachable from returned calls alone. The one exception is a `failure` view
that carries a correction: that request was refused before anything ran, so
its last read names `outcome` instead of streams that were never attempted,
which still read by name. Text is the native text as captured. A
stream that was never attempted reads as `state:"not_attempted"` and one
captured empty as `state:"empty"`. Nothing is read automatically. A read
authenticates the original and selects from it: it resolves no source, prepares
no runtime, runs nothing and changes no lifecycle state, works after a server
restart for the same caller, and refuses another caller, a missing or corrupt
source and a correction seed with the selected-response owner's own cause. See
[Selected-response details](mcp-selected-response-details.md).

**Corrections and failures.** Every refusal the route authors states
`authority_limb:"mechanical_failure"`. A caller-correctable refusal of a valid
request from an authenticated role retains that request's execution fields as
a correction seed and returns the exact `retry`: the source refusals above, and
a runner's own refusal of the target, which adds `correction.retry_request` and
the fields that may change beside the read of its `failure` view. An unknown
runner (`ordinary_test_runner_unknown`) is such a refusal with a closed choice:
its `correction` also states `set:"retry.changes.runner"`, the `rejected`
runner and `choices`, the runner catalog's names. The caller picks one and
sends the `retry` of `retry_request` with that `changes.runner`; no retry is
returned for a runner nobody chose, nothing is matched or selected for the
caller, and nothing runs until that retry. The same correction is kept in the
retained `failure` view, so a later read, after a restart included, still
states it. A retry
applies its `clear` and `changes` to the authenticated seed, passes the same
schema and the same source checks again, and is a new run with its own result.
A failure after authentication states its cause within the limit; when any of
it is clipped, the complete cause is retained and its `failure` read is
returned. When a seed cannot be retained, the refusal says `executed:false`,
`correction_seed:"unavailable"`, the failed operation and cause code, the
unavailable capability and its owner, and `repair_call:"none"`; it returns no
seed and no call, and the caller resubmits its original request with the stated
correction once retention is restored. When a settled result cannot be
retained, the answer keeps the actual run facts and source, adds `retention`
with the same facts, and returns no read call; a later execution is a new run,
never a recovery of that output.

## Coding workers

A managed implementation worker uses the same published configuration for its
ordinary commands. Every detected environment whose installation root contains
one of the worker's resolved scope members is resolved, as it is then, when the
worker launches. For each project,
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

A worker never installs anything. Its projection covers every project its
scope reaches: the published environments and the ones the checkout itself
declares, each resolved through the owner test runs and proofs use (see
[Runtime inputs at execution](#runtime-inputs-at-execution)). A detection that
is still running or failed composes from the configuration it kept, exactly
as a ready one does; a configured runtime that changed since detection is
projected as it is; and with no record, a first detection that failed or a
record that is not authentic, each project's toolchain and dependency
environment are located at launch. A project whose inputs cannot be located
reports that exact condition on its own commands. Only a scope that reaches
no project of a repository that publishes nothing gets no projection. An
executable an installation lacks is reported by that command alone. Immediately
before spawn the launch checks only what it binds (its projected sources and
mountpoints); the readiness record is not consulted, so a record that changed
or was removed after composition does not refuse the launch. See
[Prepared test runtimes in the coding worker](agent-launch-confinement-mcp-conduit.md#prepared-test-runtimes-in-the-coding-worker).
