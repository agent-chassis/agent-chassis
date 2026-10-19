# Test-proof execution

This page defines how `verify_proof` executes the stages of a proof attempt:
the shared test run, host execution, transformed proof copies, the native
provider lifecycle and the persistent compiler caches. Saved meaning, the
runtime binding and the provider family catalog are in
[Test-proof runtime identity](test-proof-runtime-identity.md).

## Shared test execution

`verify_proof` shares the native execution substrate with ordinary repository
commands. Its saved native proof targets remain a separate internal input
contract; public worker command selections grant no proof authority. Every
test execution of a proof attempt (the unchanged candidate and each falsifier
and traversal stage, for every family) is one run of the owner an ordinary test
run uses (`test-execution/ordinary-test-runner.mjs`), and proof evaluation
consumes what that run settled. For native proof and regression stages that owner alone:

- resolves the runtime as it is now, routing the target to its published
  environment or to the project the checkout declares when no record exists
  (see [Prepared environment routing](test-proof-runtime-environments.md#prepared-environment-routing));
- applies the checkout's saved test-entrypoint associations: a `node-test`
  repository wrapper or a `lib0-testing` harness association runs a proof stage
  exactly as it runs an ordinary run of the file;
- has the runner's installed integration build the one command, running the
  runner's own listing or metadata first when it needs it;
- executes it through the shared [host executor](#host-execution) from the
  target's project directory, under the requested timeout and the invocation's
  execution budget (the shorter applies; no stage has a timeout or ceiling of
  its own), and settles the captured run. The request's MCP cancellation and
  its deadline share that one launcher-minted budget, and the executor accepts
  only a minted budget. For `verify_proof`, the execution budget starts after
  the selected population and runtime bindings resolve. Provider preparation,
  proof attempts and declared regressions share that one budget. Cancellation
  during resolution remains cancellation before execution; it grants no fresh
  attempt or credit.

A provider builds no command and launches nothing. It contributes only what its
checks need and an ordinary run does not supply: the exact selected test and
the runner's own options that load its observer (node:test's reporter, import
and coverage options; Mocha's reporter; a preload for AVA and lib0; an exact
`-run` and Go's `-json` report; Cargo's exact libtest name and JSON messages;
stestr's exact filter and worker command), its instrumented source, its
observation channel and the reader of that evidence. Four families cannot
attach their observer through a runner option and contribute a launcher entry
program that the same interpreter runs in the same project directory: Jest and
Vitest (the observer is installed through the runner's programmatic API), Deno
(an entry module that imports the observer before the selected test module) and
pytest (a plugin that must be installed before any consumer module is
imported). The pytest entry starts the project's own pytest and leaves the
repository's configuration in force, `addopts` included. It passes `--rootdir`
so node ids are named relative to the repository root, sets no verbosity, and
overrides only `cache_dir`, to a pytest subdirectory of its launcher-owned
private scratch that is removed when the process settles. Plugin autoload is
left as the project has it: the entry loads the installed plugins an ordinary
run of the same file loads, and a project that disables autoload itself
(`PYTEST_DISABLE_PLUGIN_AUTOLOAD`, or its own pytest options) keeps that
choice. A loaded plugin is accounted for like every other import: one from the
project or its bound environment is part of those inputs, and one from
anywhere else is a member of the dependency population the entry measures.

A provider keeps the proof-specific authority around that run: the attempt's
launcher-minted runtime authority and its kind, the declared target, the minted
budget and the identity it bound at preparation are all checked before the
shared run is reached. The authority carries no dependency projection: every
stage's dependencies come from the one mapping the shared run publishes where
the stage executes, and the run's own runtime identity is the dependency
evidence. No proof stage has a runtime of its own: a target that no
installation root owns is refused for a proof exactly as for an ordinary run.

An observer belongs to the launcher; the runner and every package it needs
belong to the project. An observer never loads a project dependency from its
own location, and it never selects the runner itself. The shared run selects
the installed runner package once, for the package that encloses the test file
(see [Runners](npm-test-runtime-layouts.md#runners)): the runner integration
builds its command from that installation and names it, and the shared run
writes it into the stage's observer configuration as `runner_package`, the
package's directory where the stage executes. The JavaScript observers load
the project's Jest, Vitest and Mocha from exactly that directory, through one
loader that hands a module identity inside the package to Node's own
resolution: the package is loaded as it loads itself (its `exports` and
conditions included), and everything it imports (Jest's configuration reader,
the Vite its Vitest runs) resolves from where that package is really
installed, peers included. The entry that starts Vitest and the Vitest runner
the launcher installs in each worker both take it from that one configuration;
the worker's base runner is that same Vitest's (its `TestRunner` export, or
`VitestTestRunner` of `vitest/runners` where that Vitest has no such export).
An ordinary run and every proof stage therefore use one installation: a
workspace member's own runner for that member's tests, also when the workspace
root holds another copy, and the root's where it is hoisted.

Three locations stay separate. The repository root (`repository_root`) names
files in results. The project directory (`project_directory`) is the
installation root's directory: the stage's working directory and where the
runner discovers the project's configuration. It is the same for every member
and is never moved to make an import resolve. The selected runner package
(`runner_package`) is where the runner is loaded from and nothing else. An
observer resolves no runner from the project directory, the repository root or
a sibling member.

The other families already run their observer inside the selected runtime:
node:test's reporter and loader use only Node built-ins, AVA and lib0 wrap the
module the project's own loader resolved, Go, Cargo and Deno compile or import
the observer with the selected toolchain, and pytest and stestr run it under
the selected interpreter. Their observer configuration names no runner package.

A selected runner package that is absent is refused before any stage starts,
with the run's own `test_runtime_runner_package_missing` or
`test_runtime_runner_package_inaccessible`. One that is present and cannot
supply a module fails the stage with the runtime's own module-load error
naming the selected package's file. Either way the stage earns no credit, and
no other installation is loaded in its place: not the workspace root's, a
sibling member's, one above the installation root, or a copy installed beside
the launcher. A module Node could only find in another installation is refused
by the loader, never loaded.

### Declared regression files

A slice may declare `regression_tests`
([Work Record Schema](work-record-schema.md#slice-regression-tests)). A
`verify_proof` invocation whose execution source is that slice runs each
declared file once, as an ordinary test run of that file, in declared order:

- The list is the selected source unit's own, read from the same candidate
  work record as its saved proofs and bound into the invocation's execution
  source binding with them. Every subject that resolves to the slice source
  (the slice address, one of its obligations or one of its proofs) runs the
  slice's whole list; narrowing the proofs does not narrow the list. The
  source is selected by the existing source authority for each role: a
  reviewer's source is the unit its launch assigned it to review, and another
  slice's list cannot be selected through it. A whole-WK source declares no
  list and does not collect its slices' lists. No request field supplies or changes the list.
- The files run after the proof population has settled, outside the proof
  loop, so the number of runs is the number of declared files whatever the
  proof population is. A failed proof, a failed earlier file and a population
  with no executable proof do not skip them. No file is rerun, and no parent
  comparison is made.
- Each run is the shared executor's ordinary run of one file against the
  invocation's candidate checkout, uncommitted changes included, on the
  invocation's one execution budget and timeout. No file gets a budget of its
  own. The caller's `environment` selection is passed to it unchanged. The
  runner is selected as described in
  [Runtime Environments](test-proof-runtime-environments.md#regression-file-runner-selection);
  the owning project's explicit choice overrides its single recorded default.
  Missing or multiple runners refuse with the file, project, available names
  and the setup/configuration-owner action. No command is composed here.
- Before each file the invocation's currentness check runs. A source that
  moved, a budget that expired and a cancelled request stop later files from
  starting; each of those files is reported as not started, and nothing is
  retried.
- A source that declares no list, or an empty one, runs nothing here.
- An invocation refused before execution (for example a slice with no saved
  proof source, or an environment that cannot run every selected proof) is
  refused as before. It runs no declared file, and there is no verification
  mode that runs declared files without saved proofs.

The host runs the files. A declared file may be outside the worker's
`read_scope`; running it grants the worker no access to it. The outcomes are
described in
[Test Proof Results](test-proof-results.md#declared-regression-outcomes).

## Host execution

Under `decision` (repository-only: `wiki/decisions/decision.md`), the shared
executor starts every test process directly on the host with the host user's
permissions (`runHostTestInvocation` in `test-execution/confined-invocation.mjs`).
No bubblewrap namespace, read-only mount, secret mask or network denial applies
to an ordinary run or to any proof stage. Test code can read and write the
checkout, its Git metadata, accepted decisions, dependencies and anything else
the host user can reach, and nothing it writes is reset. This is one capability,
bound to the authenticated source and assignment; a request names no command,
argument, environment variable or path, so it is not a host shell. It is
separate from two confinements that are unchanged:

- the invoking agent's session stays in its own namespace, which neither
  confines these processes nor is widened by them (see
  [Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md#test-and-proof-execution-is-a-separate-host-capability)
  and the [enforcement model](enforcement-model.md));
- local test-runtime setup's verification probes stay confined, read-only and
  network-denied (see
  [Verification and readiness](local-test-runtime-setup.md#verification-and-readiness)).

Every run has this shape:

- **Execution root.** One launcher-minted `/tmp/agent-chassis-execution-*`
  host directory per run, with mode-0700 `tmp/` and `scratch/` children for
  launcher artifacts. `HOME`, `TMPDIR`, `TMP` and `TEMP` keep their prepared
  values, including empty or absent values. The observer
  configuration, observation channel, instrumented source and any proof copy are
  files of `scratch/`. A literal `/tmp` path is the host's `/tmp`, not a private
  namespace.
- **Environment.** The prepared host environment crosses the existing
  credential/posture filter, with coordinator authority and parent test-runner
  context withheld. Supplied `HOME`, `CI`, locale, cache and repository settings
  stay supplied through public CLI bootstrap and host handoff, including Node
  options and compile-cache settings; absent values are not manufactured.
  Prepared `PATH` keeps all
  components and their order, including relative and empty entries. Only an
  explicit configured executable binding adds a leading directory; discovery
  never reorders it. The selected dependency installation and the stage's instrumentation
  additions keep their existing owners. Host execution does not impose the
  confined setup/agent environment. An invalid selected executable is refused,
  never replaced.
- **Driver.** The launcher's own Node runs the attempt driver
  (`attempt-driver.mjs`) with one closed, launcher-built plan on stdin. The
  driver creates files only below `scratch/`, starts the single runner process
  with inherited diagnostic streams, and reports on launcher fd 3 in one framed
  message: a `workspace-agent-runner-attempt-status.v3` status line whose
  channel is tagged by kind. A pipe channel (`fd`, pytest) is followed by its
  relayed bytes, with their length and digest, within the 2 MiB protocol
  ceiling. A file channel (`file`, every other family) is followed by nothing:
  after the runner exits the driver counts and hashes the channel file in
  bounded chunks and states only its byte count and SHA-256, or the error it
  hit reading it. No file content travels in the frame, so the frame's size
  does not depend on the observation's.
  The status separates a working-state failure
  (`test_proof_native_working_copy_failed`) and a launch failure
  (`test_proof_native_runner_launch_failed`) from a test outcome; a missing or
  malformed frame yields no evidence (`test_proof_native_driver_status_missing`).
- **Unconfirmed completion.** The frame is the only confirmed completion. A
  driver that cannot write it states the error, the bytes written and the frame
  size in one line of its own stderr
  (`[attempt-driver] completion frame not published: {...}`) and exits 124
  instead of the runner's status. When a driver started and the launcher holds
  no usable frame (absent, cut short, malformed, mismatched or over the protocol
  ceiling), the run's `disposition` is `unconfirmed`, never `not_run`, which
  stays the disposition of a confirmed failure before the runner started. `ran`
  is false because no run was confirmed, with `ok:false`, a null `exit_code`
  and `signal`, no observation and no proof credit. The run carries `completion`:
  `confirmed:false`, `runner_outcome:"unknown"`, `tests_may_have_executed:true`,
  the `frame_error`, `frame_bytes_received`, the driver's own
  `driver_exit_code` and `driver_signal`, and the `publication_error` the driver
  stated (null when it stated none). The driver's exit and signal are never the
  runner's. `blocker_message` states those facts in one line. Captured stdout
  and stderr, a printed pass count included, stay diagnostic only: the runner
  may have executed its tests and changed the checkout, and nothing is inferred
  from its output. `completion_recovery` states what is supported: no repair or
  confirmation call exists (`repair_call:"none"`), the executor never runs the
  test again (`automatic_rerun:false`), and the caller checks the checkout for
  the run's effects and decides whether to start a new run
  (`check_effects_then_decide_on_a_new_run`). Both tools publish these
  facts in their first answer and in every retained or recorded read:
  - `workspace_run_test` answers `status:"unconfirmed"` with
    `run.executed:"unknown"`, the cause and a `recovery`, attempts no parent
    comparison (`not_eligible`, reason `unconfirmed`) and names the retained
    `failure` view first. That view holds the stage `unconfirmed`, the same
    `message`, the `completion` facts as `detail`, the whole `recovery` and
    `effects.candidate_executed:"unknown"`.
  - `workspace_verify_proof` refuses the stage with its execution-error code
    and no receipt. The proof's `recovery.action` is the executor's action,
    and `recovery.facts` carry `ran:"unknown"`, `disposition:"unconfirmed"`,
    the blocker code, `completion` and `completion_recovery`.

  These facts describe a failure; they do not establish why a frame was lost.
- **Observation file.** After the driver's process group settled, the executor
  opens the channel file of that invocation's own execution root (the path the
  launcher composed, never one a frame names, and never through a symbolic
  link), reads it in 64 KiB chunks into the stage's observer and checks the
  end of file, the length and the SHA-256 against the driver's statement. An
  observation is published only for a file that matched completely. The native
  observation reader takes every chunk as it arrives and holds no file content
  ([Observation protocol](test-proof-observation.md#observation-protocol)); the
  node:test report is collected from the same reader up to the protocol
  ceiling and is `test_proof_structured_events_oversized` beyond it. A file
  the launcher cannot take is the observation
  `test_proof_observation_transport_failed`, whose `detail.failure` names the
  cause with what was measured: `driver_channel_read_failed` (the driver's
  `errno`), `channel_open_failed` or `channel_read_failed` (the launcher's
  `errno`), `channel_not_regular_file`, `channel_outside_execution_root`,
  `channel_length_mismatch` and `channel_digest_mismatch` (`expected_bytes`,
  `expected_sha256`, `observed_bytes` and, for a digest, `observed_sha256`),
  or `read_interrupted` (`interruption` and `consumed_bytes`). The read uses
  the invocation's own deadline and cancellation and is granted no further
  time. Such an observation earns no proof credit and changes nothing about
  the run: `ran`, `disposition`, `exit_code` and `signal` stay the runner's
  confirmed outcome. `workspace_verify_proof` carries the code as
  `structured_observation_code` and this closed detail as
  `structured_observation_detail` in the proof's recovery facts, the same in
  its first answer, the retained result and every read of it. The file handle is closed in every case, the read
  completes before an execution root the executor owns is released, and a
  supplied root stays its caller's to release.
- **Settlement.** The driver leads a dedicated process group. Budget expiry or
  cancellation kills that group, and the capture settles when the group is
  confirmed gone or after a five-second cleanup allowance. An interrupted run
  carries `termination`, three facts each stated by the owner that measured it:
  `requested` is the signal asked of the group (`signal`, `scope`
  `owned_process_group`, whether a target took it as `delivered`, and the
  request's `error`); `process` is the driver's own exit when it was observed
  before settlement (`exited` with its `exit_code` and `signal`, or
  `exited:false`); `runner_outcome` is `confirmed` only when a completion frame
  arrived and `unknown` otherwise. `cause` is `timed_out` or `cancelled`. The
  run's own `exit_code` and `signal` stay the runner's and are null without a
  frame: a requested signal or the driver's exit is never reported as the
  runner's. A run refused before it started and a run that was not interrupted
  carry no `termination`. The fact stays in the complete captured run, so every
  retained read returns it unchanged without executing again. The root is removed
  only after settlement. An unconfirmed settlement or removal reports
  `cleanup_failed` (`test_proof_execution_cleanup_failed`) with its
  `cleanup_scope` (`owned_process_group` or `owned_execution_root`) and a
  `cleanup_recovery` naming the group, the retained root, the original cause,
  the known effects, the uncertainty and the host operator's action. Detached
  descendants outside the group are never claimed to be gone, and a killed
  launcher runs no cleanup.
- **Launcher writes.** The launcher never instruments or rewrites the original
  source. Outside the execution root it writes only the persistent compiler
  cache described below and, for a stage that runs in the original checkout
  (node:test, Go) with an npm installation that lives outside it, the reusable
  `node_modules` mapping with its exact Git-local exclusion (see
  [Ordinary test runs](local-test-runtime-setup.md#ordinary-test-runs)); a
  conflicting occupant refuses with `test_runtime_dependency_projection_conflict`.
  A stage that runs from a transformed copy maps the installation in that copy
  and leaves the checkout it copied without a link.

A runner's own permission flags (Deno's, for example) are that runner's test
semantics, not host isolation.

## Transformed proof copies

A proof stage that replaces source bytes never instruments the original
checkout. Three families need no replacement on disk and run every stage in the
original checkout: node:test substitutes the declared module through its loader,
pytest substitutes and traces inside the process, and go test names its
instrumented and added package files, which live in `scratch/`, through Go's own
build overlay (`-overlay`, for the listing and the run alike). Jest, Vitest,
Mocha, AVA, lib0/testing, Deno, stestr and cargo test run every stage of an
attempt, the unchanged candidate included, from a strict temporary copy
(`test-execution/proof-source-copy.mjs`) in that run's `scratch/proof-source`.
Candidate and falsifier therefore read the same inputs except the instrumented
files, and a failure of the mutation run is not an input difference.

| Input | What the copy holds |
| --- | --- |
| Directory structure | Every directory below the checkout root at its own relative path, empty directories included. |
| Files | Every regular file a filesystem walk of the checkout finds, with its exact bytes. The walk is not a Git selection: tracked, untracked and Git-ignored files (fixtures, `.env`, build output, caches) are all copied. |
| Modes | The permission bits of every file and directory. Directory modes are applied after their contents are written. Timestamps are new, so Cargo rebuilds the project's own units. |
| Left out | The top-level `.agent-launch` runtime state, the top-level `node_modules`, and any project's verified dependency mapping (below). |
| Symbolic links and special entries | Neither copied nor followed. One anywhere in the walk fails the copy, with one exception: a `node_modules` entry that the dependency-mapping owner verifies, read-only, against the module tree of the selected npm installation that belongs at that directory (a project's own, or a workspace member's through the installation that owns it; see [Dependency mapping for test runs](npm-test-runtime-layouts.md#dependency-mapping-for-test-runs)). That is a published link together with the one generation it publishes, or the selected installed tree itself where the checkout is the installation. Those exact entries are a runtime input, not source: they are skipped, never copied. A link to anything else, an altered or incomplete generation, a link under any other name and a sibling that merely resembles a generation are refused or measured as before. |
| Git inputs, `.git` directory | The whole directory: configuration, index, refs, hooks and objects. |
| Git inputs, linked worktree | The `.git` pointer file, plus the administration the findings Git-metadata resolver selects for it (the worktree's gitdir, the common Git directory's refs and required files, the object directories and alternates). The project and each of those are placed at their own host-absolute paths below the copy root, so their relative layout is the original's. |
| Configuration inputs | Runner configuration, manifests, lockfiles and `agent-chassis-runtime.json` are ordinary files of the walk. Saved test-entrypoint associations are read from the original checkout and applied to the copy by relative path. |
| Selected runtime | Not copied. The stage uses the same routed environment, toolchain executables, dependency locations and persistent compiler cache as a run in the original checkout. After the copy is made, the shared run maps an npm installation into the copy's project `node_modules` through the one dependency mapping, with external packages linked to the selected installation and workspace members linked to the copy's sources; the runner's own executable is resolved through that mapping in the copy. |
| Original provenance | Evidence names the original. The declared module and selected test file are read and digested from the original checkout's exact bytes before instrumentation, results name repository-relative paths, and the attempt's `worktree`, candidate commit and source snapshot stay the original's. Only the observer configuration's `repository_root`, `project_directory` and `runner_package` name the copy, so the runner executes there and is loaded through the dependency mapping published there. |

The copy is strict. The launcher inventories path, kind, mode and digest, and
the Git inputs separately, then compares the original with that inventory before
and after copying and the copy with it afterwards. A failure names its path and
cause and no stage runs from a partial copy: `proof_source_entry_missing`,
`proof_source_entry_unreadable` (a refused link or special entry included, with
the snapshot owner's code as its cause), `proof_source_entry_unsupported`,
`proof_source_entry_changed`, `proof_source_entry_copy_failed` and
`proof_source_copy_parity_failed`. The copy isolates the source transformation,
not host permissions: a test can still reach the original checkout by path. It
is removed with its execution root.

Pytest uses the same source-binding startup adapter for ordinary execution and
all proof stages. Local editable source paths and supported editable finders
point to the selected candidate before pytest or project plugins import the
application. The proof entry retains isolated Python mode; third-party
installation paths, project cwd and pytest options remain available. The
falsifier resolves through that same binding before substituting the declared
source. Missing candidate source and unsupported editable mechanisms refuse
explicitly; loading the original checkout never supplies candidate evidence.
See [Python runtime inputs](test-proof-runtime-environments.md#native-provider-runtime-inputs)
for supported mechanisms and startup limitations.

Setup's probe copies are a different mechanism with different contents. An npm
runner probe runs in a private copy of only the project source Git selects:
tracked files with their current bytes and untracked files Git does not ignore,
without `.git`, `.agent-launch`, `node_modules` or build and runner caches. That
copier keeps file modes, recreates symbolic links unfollowed and skips entries
that no longer exist. The copy lives in the confined probe's private temporary
mount beside a read-only checkout and a read-only installation, and carries no
proof provenance (see
[Verification and readiness](local-test-runtime-setup.md#verification-and-readiness)).

## Shared native lifecycle

One launcher lifecycle serves every non-Node, non-pytest family; a family
contributes only its runner layout, its observer and the facts its runner's
integration needs for the selected test. Each stage is one run of the
[shared test execution](#shared-test-execution).

1. Preparation routes the selected test to one environment (see
   [Prepared environment routing](test-proof-runtime-environments.md#prepared-environment-routing)) and binds its
   identity: the routed project and environment, the runtime as it is now and
   the provider's assets. It executes nothing. The runner's setup probe belongs
   to setup alone and never decides whether the selected test runs. A target no
   installation root owns, a named environment that cannot serve it, a malformed
   saved configuration, or inputs that can be neither taken from the
   configuration nor located refuses before any selected body runs, with the
   readiness or routing code, its route facts and `recovery.operator_action`. An
   executable that is missing or not executable, or a runner package the project
   did not install, refuses the stage that would have launched it with that same
   code. The state of the readiness record never refuses (see
   [Local test-runtime readiness](test-proof-runtime-environments.md#local-test-runtime-readiness)), and attempts
   never install anything.
2. Every stage of one attempt resolves the runtime again. What authenticates
   the stage is held to preparation: the digest of the launcher's provider
   assets and the routed project and environment. A difference refuses with
   `test_proof_native_runtime_inputs_stale`. The environment's own toolchain and
   dependencies are not held to preparation: a stage that finds them changed
   runs, is bound to the runtime-inputs digest of what it actually used, and
   carries `runtime_environment_observed` (`changed_since_preparation`, the
   current and preparation digests, and the current record, toolchain and
   dependency provenance). The attempt's `runtime_environment` publishes both:
   its top-level facts are what preparation observed (`observed_at:
   "preparation"`), and `stage_environments` lists every executed stage with
   `changed_since_preparation` and, for a stage that used a different runtime,
   that stage's own digest and provenance. The public result detail carries the
   same object.
3. Every stage runs through [host execution](#host-execution) from the target's
   project directory, in the original checkout or in its
   [transformed proof copy](#transformed-proof-copies), with its own execution
   root, nonce, observer configuration and channel.
4. The declared module and the selected test file are read from the original
   checkout, rejected unless they are regular files of the prepared project,
   and instrumented from their exact bytes. Instrumentation never changes line
   numbers. Anything it cannot instrument faithfully refuses with
   `test_proof_native_instrumentation_unsupported` and a reason such as
   `function_absent`, `function_not_unique`, `function_not_synchronous`,
   `body_not_single_scalar_return`, `return_literal_unsupported`,
   `replacement_not_distinct`, `replacement_kind_incompatible`,
   `selected_test_not_observable`, `selected_test_shape_unsupported` or
   `source_unparsable`. Go and Rust resolve the selected test against the file's
   parsed named test declarations before applying eligibility, so the two
   selection reasons are different facts, both `not_started`:
   - `selected_test_not_observable`: the named test is absent. The refusal names
     the test and its declared file, the correction owner is `proof_author`, and
     the recovery is
     `author_the_named_selected_test_or_correct_the_saved_selection` with no
     unchanged retry.
   - `selected_test_shape_unsupported`: the declaration exists but the adapter
     cannot hook it (for example Go's valid `func TestX(_ *testing.T)` or a
     generic test). The correction owner is `launcher_test_proof_provider`, the
     recovery is `report_the_launcher_provider_selected_test_shape_limitation`,
     and there is neither a caller retry nor advice to rewrite a valid test.

   Families that learn a missing identity only by running keep
   `test_proof_selected_identity_not_observed` with their completed run facts
   and captured output, and never infer source absence from a missing
   observation.
5. The runner runs only the selected test. Every other test is deselected or
   skipped before its body runs, so a sibling that ends the process never runs.
   The selected test keeps its runner's ordinary composition: helper functions
   (including another top-level test function the selected test calls directly
   or runs as a subtest), native descendants such as subtests and steps,
   asynchronous work and final lifecycle callbacks all belong to it. They never
   become separately requested tests, earn proof credit of their own, or refuse
   the observation. A separately registered sibling test body that actually
   runs is an unselected execution.

### Persistent native compiler caches (Go, Cargo, Deno and Vitest)

A family whose dependency ecosystem or runner integration names a native
compiler cache runs every stage with that cache at one persistent directory
below the main repository, `<main repository>/.cache/test-proof-native/<cache>`:
Go's `GOCACHE` (`go-build`), Cargo's `CARGO_TARGET_DIR` (`cargo-target`), Deno's
`DENO_DIR` (`deno-dir-<digest of the operator's Deno cache path>`) and Vitest's
native module cache (`fsModuleCache`, `vitest-module-cache`). No other family or
npm runner has one.

- **Ownership.** The native tool alone decides validity, reuse, locking and
  maintenance of its cache. The launcher keeps no copy, generation, snapshot,
  index, census, eviction or lock of its own and never decides whether cache
  content is current. Contents are disposable, mutable compiler state that a
  test may change.
- **Location.** The launcher alone selects the directory; no caller, request or
  environment value can name it. Every component below the main repository must
  be a real directory: a symbolic link or another entry refuses with
  `test_proof_native_compiler_cache_unavailable`, the affected path and the
  original error, before any selected body runs, and nothing is followed,
  repaired or created through it. This is path configuration, not
  authentication of cache content.
- **Git exclusion.** The caches must never change the checkout's status
  identity. Local test-runtime setup of an environment with such a cache appends
  the exact pattern `/.cache/test-proof-native/` to the repository-local exclude
  file Git itself resolves (`git rev-parse --git-path info/exclude`, shared by
  every worktree), keeping every existing line and changing no tracked file; a
  repository's own ignore rule serves equally. Setup refuses
  (`test_runtime_native_cache_exclusion_failed`) when Git tracks any file below
  `.cache/test-proof-native/`, when its root is not a work tree's top level, or
  when Git or the file cannot be used. Every other untracked file, elsewhere
  below `.cache/` included, still changes the status identity.
- **Optional.** Before a run opens its cache, `git check-ignore` must confirm
  the directory is ignored. Where it is not (setup never ran, or the repository
  is not a Git work tree), or its location is redirected or cannot be created,
  nothing is created or written there, the run adds no Git exclusion, and every
  stage keeps its compiler cache in its own `scratch/`. The prepared runtime
  reports the choice as `native_compiler_cache` (`persistent`, or
  `attempt_scratch` with the reason code). The same toolchain and sources run
  either way.
- **Fresh execution.** Only compiler state is reused. Every stage gets its own
  source variant, instrumentation, nonce and channel and executes its selected
  body; no outcome, assertion, mutation or traversal result, test process,
  channel or proof credit is reused. `go test` keeps `-count=1`. Each run removes
  only its own execution root; the persistent cache survives cleanup, failed and
  interrupted runs, and launcher restarts.
- **Go.** Changed instrumented packages rebuild; unchanged standard-library,
  module and project packages are reused by content.
- **Cargo.** Cargo judges a local path package by its source timestamps. Copies
  have fresh timestamps, so Cargo recompiles the project's own units in every
  stage and reuses registry and vendored dependencies, which its fingerprints
  identify by version and source. Cargo reports this per unit (`fresh`) in its
  `compiler-artifact` messages.
- **Deno.** The persistent `DENO_DIR` links, by the same names, to the detected
  dependency stores (`remote`, `npm`) of the operator's cache; the launcher
  points those links before each run and copies nothing from the operator's
  installation. Deno type-checks the stage's own graph and reuses its check
  cache. Configuration and lock files are dependency inputs: a change is
  recorded in the run's provenance and Deno decides whether the cached
  dependencies still satisfy them. Setup probes of other consumers and worker
  commands keep the operator's `DENO_DIR` itself, read-only.
- **Vitest.** Neither the ordinary `vitest list` and `vitest run` commands nor
  the proof entry selects a configuration loader: the project's Vitest loads
  the project configuration its own way in both tools. The entry reads what
  the project configures (its own custom runner, which is refused rather than
  overridden, and the built-in plugin set) from instances it creates through
  `createVitest`
  with the module cache off and closes without running anything, then starts
  the one instance that runs. That existing cache-off resolution also checks
  whether the selected runner supplies a callable `defineCacheKeyGenerator`
  and successfully registers the launcher's invalidation generator. Without
  that capability (including a runner that never calls `configureVitest`),
  every proof stage executes uncached and reports
  `cache_key_generator_unavailable`. An available API that throws keeps its
  original error and fails the stage; it is never treated as capability absence
  or retried. The experimental API name is not used.
  The launcher always passes `fsModuleCache: false`,
  which the root and every test project inherit; its plugin also clears any
  experimental cache request the project supplied in the earlier `config`
  hook, before Vitest normalizes its cache options. After capability is
  established, only its own Vite plugin, in the
  `configResolved` hook of the instance that runs, turns the module cache on at
  the persistent path, and only when the resolved plugins are exactly those
  Vitest resolves with no configuration file (compared by name and hook code)
  and no test projects are declared. Vitest snapshots the setting when it
  initializes native module fetchers, before `configureVitest`: enabling the
  flag only in that later hook would leave those fetchers uncached. The
  running instance registers its own generator in that hook, before proof
  modules load. A custom VCS module that Vitest imports before the hook stays
  uncached (`configured_vcs_provider`). Any other configuration (a plugin, test
  projects or Vite devtools) runs with the cache off (`configured_plugins` or
  `configured_projects`); plugins are never
  stripped, named or trusted. Vitest's own key covers a module's id and content,
  part of the resolved Vite configuration, the modules the configuration file
  imports and the lockfile. Through Vitest's supported
  `defineCacheKeyGenerator` the plugin adds what that key misses: the
  configuration file's text; the environment's resolved `define`, `oxc`, `env`
  and `resolve` options; and, per module, the TypeScript configuration the
  project's own toolchain resolves (rolldown's public `resolveTsconfig` with
  the instance's `tsconfig` setting, merged `extends` included). A module whose inputs cannot be represented safely (a
  function among those options such as a `customResolver`, a value JSON cannot
  hold, an unreadable configuration file, an unavailable toolchain resolution or
  an unresolvable TypeScript configuration) is kept out of the cache (the
  generator returns `false`) and transformed freshly. Each stage prints the
  module-cache state of the instance that ran, how many modules it transformed
  and how many it kept out of the cache and why. No reuse is promised. A
  module's id is its absolute path and Vitest's key also holds the project
  root, and every Vitest stage runs from its own run's temporary copy (see
  [Transformed proof copies](#transformed-proof-copies)), whose path is new
  for each stage. Vitest alone decides whether an entry serves a stage, so a
  stage may transform every module again, and may equally reuse one. What
  holds either way is that a stage never executes a transform of other inputs:
  a changed module, configuration file, TypeScript configuration or computed
  option is executed as changed.
