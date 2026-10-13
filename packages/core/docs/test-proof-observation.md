# Test-proof observation

This page defines how a proof stage's evidence is observed and authenticated:
the native observation protocol, reach binding, per-family limits and the Node
module-fault providers. The witness validators that credit this evidence are in
[Test-proof runtime identity](test-proof-runtime-identity.md#provider-witness-validators).

## Observation protocol

Observers write `launcher-test-proof-native-events.v1` line records carrying
the attempt nonce, a writer id and a per-writer sequence number. The launcher
accepts a population only when it is complete UTF-8, every record has its
closed shape, every nonce matches the attempt, and every writer's sequence is
contiguous. It then requires that at most the selected test starts, that the
selected test has exactly one result after its start, that the session ended
when the family reports a session end, and that the runner's exit status agrees
with the selected outcome. Violations refuse with
`test_proof_structured_events_cross_attempt`,
`test_proof_structured_events_lifecycle_invalid`,
`test_proof_structured_events_unselected_execution`,
`test_proof_structured_test_identity_duplicate`,
`test_proof_structured_test_inventory_incomplete`,
`test_proof_structured_events_exit_status_mismatch`,
`test_proof_structured_events_oversized`,
`test_proof_structured_events_reach_unauthenticated` or
`test_proof_structured_events_invalid`. A refused record keeps its concrete
context in the observation detail: the provider and version, the selected
node identity, and the refused record's kind, observed node identity (and
outcome for a result), writer, sequence and position in the stream. An exit
status mismatch names the selected outcome and the exit code. An incomplete
inventory names the one member that is `missing` (`session_end`,
`selected_test_start` or `selected_test_result`), the `completion_requirement`
of the family (`session_end` or `selected_result`), and what the stream did
hold: `session_end_observed`, `selected_collected`, `selected_started`,
`selected_result_observed`, `discovered_count` and `record_count`. These are
the stream's own facts; why a record is absent is not among them, and the
native run's exit status is reported beside them unchanged. The public
`workspace_verify_proof` recovery facts publish this detail and an oversized
observation's measured limit as `structured_observation_detail`, with the
run's own `ran`, `exit_code` and `disposition`. A selector that matches no observed
test refuses with `test_proof_selected_identity_not_observed` and lists the
observed identities. An observer can report only
`test_proof_native_runner_unsupported`, `test_proof_native_runner_unavailable`
or `test_proof_native_selection_unsupported`, with the original error when it
has one. A failed pytest collector is listed among the observed failures with
its own identity and original exception; it is never a selected test.

One incremental reader does this for every family but pytest and node:test.
It takes the channel file in chunks
([Observation file](test-proof-execution.md#host-execution)), and chunk
boundaries never change a result. Each record is decoded as UTF-8, checked for
its shape, nonce and writer sequence, and applied to the selected test's
lifecycle as it completes. A reach record is attributed to the selected window
or outside it from the lifecycle position it arrives at, adds one to the exact
counter of its window and minted probe, and is dropped, so a selected test that
enters its declared module any number of times is bounded by its channel file
and not by memory. The reader keeps the current record, each writer's next
sequence, the test identities and their lifecycle, the first pending refusal of
each kind and those counters; the channel's SHA-256 is computed over the same
bytes. Nothing is published before the whole stream is checked: a record
refused late withholds everything counted before it. A stream refuses, in this
order, for bytes that are not a newline-terminated UTF-8 record stream, a
retained-state limit, the first record that fails its shape, nonce or
sequence, the first runtime error, the first lifecycle violation, and then
completeness and exit status.

What the reader retains is bounded by three limits; the channel's total size
and its number of reach records are not limited. One record may be at most
2 MiB (`record_bytes`), at most 100,000 records other than reaches may add
retained state (`control_records`), and at most 100,000 distinct writers may
appear (`writers`). A stream past one refuses with
`test_proof_structured_events_oversized` and a detail naming the `limit`, the
`measured` value, the `threshold`, the `unit`, the `record_index` and whether
the measurement is exact or a lower bound (`measured_is_lower_bound`). The
same code without a detail is a relayed pipe population, or a collected
node:test report, over the 2 MiB protocol ceiling. The channel file lives in
the run's execution root and is removed with it; the artifacts keep its digest
and the exact counters.

A process exit code and printed text are never evidence, and neither is
anything parsed from a runner's human-readable output. Evidence is what the
runner itself reports, for the same run an ordinary test run performs, through
its own reporting facility or the observer that facility loads: node:test's
reporter events and coverage, a runner's reporter or lifecycle hooks, the
launcher probes of an instrumented source. Each such report is authenticated
(its attempt nonce, digest, sequence and selected identity) before it is read,
and the selected test's identity, a falsifier's detection and a traversal are
established only from it. A run that exits 0 without that evidence is a
successful native run and an unestablished proof.

The selected window opens when the runner starts the selected test and closes
with its result. The selected outcome is the runner's final outcome for the
selected test, including failures of its children and of its applicable
lifecycle, not whether a body function returned. The window is the separate
attribution seam for falsifier and traversal reach. For stestr it covers only
the test method, excluding `setUp` and `tearDown`. For Deno it covers the test
body and its steps; a failed step, which Deno reports without rejecting the
body, fails the selected test. For lib0/testing it covers every body entry lib0
makes for the selected test (lib0 re-enters a `testRepeat…` test until its
repetition time elapses) and closes when lib0's run of that test returns, with
the last entry's outcome. For Jest, Vitest and Mocha a failing hook of the
started selected test fails it, including an `afterAll` (Mocha `after`) hook of
an enclosing suite, which each runner reports after the test itself passed:
Jest as a file-level error, Vitest on the suite, Mocha as a separate hook
failure. The selected outcome is therefore reported once, when the runner's
run of the selected file ends. For Go it
covers the selected test's root lifecycle: its function, every subtest
including parallel subtests that run after the function returns, and every
later-registered cleanup; it closes in the observer's first-registered cleanup,
which Go runs last, and the result is Go's own `Failed`/`Skipped` state or the
recorded panic. For Cargo it covers the selected test function. Entry probes record every
entry of an instrumented function of the declared module. Only entries inside
the window count. A falsifier is detected only when the substituted function
was entered inside the window and the selected test then failed on an
assertion. A traversal is proven only when the selected test passed and an
instrumented function of the declared module was entered inside the window.
Evidence stays bound to the instrumented module's source digest.

## Reach binding

Every attempt mints a fresh random credential for each instrumented function
of the declared module. The credential exists only in that function's entry
probe in the launcher-written instrumented source. For stestr it exists only
in one directive line the launcher appends to the copied module; the
import hook strips the line and verifies the remaining bytes against the
authenticated source digest. The launcher keeps the mapping from credential
to function, definition line and substitution. A reach record carries only a
credential, never a function, line or substitution flag. A record whose
credential the launcher did not mint for this attempt refuses the attempt with
`test_proof_structured_events_reach_unauthenticated`.

The observer configuration is readable by the selected test. It names the
channel, the nonce and the project directory but never the attempt mode, the
substitution or a credential. The channel nonce binds a record population to one attempt and
proves it complete. It does not identify which in-process code wrote a
record. A test can therefore call the probe sink or append channel records,
but without a minted credential the attempt earns nothing. Traversal and
falsifier attempts differ to test code only through the declared module's own
code.

The credentials are ordinary data inside the test process. Selected-test code
that reads the instrumented declared module can recover them and replay reach
records. That includes reading the module's file or its function source text.
Such code can also tell a falsifier attempt from its substituted literal.
This is source-text inspection of the system under test, which the launcher
does not detect. Deno tests run without read permission, so they cannot read
the project source or the configuration. The node:test and pytest providers
observe through their own mechanisms: coverage of attempt-private witness
functions, and a tracer bound to the declared module's code objects.

## Family limits

- JavaScript and TypeScript: the substituted function is a top-level
  synchronous function declaration whose body is one `return` of a number,
  string, boolean or `null` literal. Probes cover every function declaration,
  function expression, arrow and method whose body is a block. One that takes
  no name from its declaration, variable, assignment, property or field (for
  example a callback passed as an argument) is listed as
  `<anonymous:line:column>`, the 1-based position it starts at in the declared
  source; it is never a substitution target. An arrow whose body is an
  expression has no block and no probe, so a module made only of such arrows
  has no instrumented function and cannot prove traversal. Jest runs in band
  with the project configuration and the launcher setup file appended. Vitest
  runs once with
  the launcher runner, `cache: false` and, on its supported route, its native
  module cache (see [Persistent native compiler caches](test-proof-execution.md#persistent-native-compiler-caches-go-cargo-deno-and-vitest));
  a project that configures its own runner is refused. Mocha runs with the
  project configuration and the launcher reporter. AVA runs one serial worker
  without worker threads. lib0/testing runs the selected harness module with
  the launcher observer preloaded.
- Deno: the launcher writes a private entry that installs its observer and
  then loads the selected module through a literal dynamic import, which Deno
  still resolves and type-checks as part of the module graph. A `deno.json`
  (preferred) or `deno.jsonc` in the project is passed as `--config`, and the
  run is `--frozen --cached-only --no-prompt`. Deno's own permissions make only
  the channel writable and nothing readable to the test. Two failures precede
  the selected test, which is then not observed and earns nothing:
  - A module that fails to import or evaluate at startup (for example a
    top-level read Deno refuses) ends the session with its original error as
    the one runner-level error, which is the run's cause.
  - A module-resolution or type-check failure (for example TS2307, or a type
    error) precedes every module, the observer's included, so nothing runs. The
    cause is Deno's native report read from stderr as a build failure. Each
    diagnostic keeps its `TS` code, its first message line and its checkout
    location (repository path, line and column; the instrumented declared
    module keeps only its line, and a file outside the checkout has no
    location). Source excerpts, caret lines, related information and hints are
    never read. A message continued beyond its first line carries
    `native_report_unreadable` for that message. At most 16 diagnostics are
    kept (`capture_budget_exceeded` beyond that). A report that was truncated,
    unterminated or not recognized, including any output with no recognizable
    diagnostic, carries `native_report_unreadable`; only empty output is no
    report. A build diagnosis applies only to a run in which no observer record
    was written, so test output shaped like a report is never a cause.
- stestr: the project's `.stestr.conf` `top_dir` must make the selected file an
  importable module. The run uses one worker with the launcher observer as the
  worker command, so the interpreter and observer paths must be shell-inert.
  The declared module is a Python module; its transform happens at import,
  from the launcher directive line of the copied module.
- go test: the selected test is a top-level `func TestX(t *testing.T)` in the
  selected file. Only its declaration is hooked; every other test function of
  the file is listed as declared inventory and stays ordinary Go. The hook
  observes only the runner-started root `*testing.T` whose name is the selected
  function's: a direct call with that same `T`, or a call of the selected
  function under another runtime name, runs unchanged and observes nothing.
  Panics are recorded and re-raised. The declared module is a non-test source
  of any package in the project. The run uses `GOPROXY=off`, the selected
  module cache and Go's native `-json` test report.
- cargo test: only Cargo's default target layout is supported. The selected
  test is a plain `#[test]` function without parameters or a return type, in
  `tests/<name>.rs` or a library module under `src/`. Only the selected test
  carries the observer guard; other test functions stay ordinary Rust and may
  be called as helpers, and a repeated entry of the selected function within
  the run observes nothing. The declared module is a library module under
  `src/`. The run uses the recorded toolchain's own `cargo` with `--frozen`,
  `--message-format=json` and one test thread.
- A final native outcome an observer cannot attribute to the selected test
  stays a refusal, never a success: for example a Deno failure outside the
  body and its steps (a sanitizer failure of the test itself) refuses with
  `test_proof_structured_events_exit_status_mismatch`.
- Observers run inside the test process, and nothing isolates them from code
  in the selected test. See [Reach binding](#reach-binding) for what the
  evidence is bound to.

## Module-fault export identity

The dependency-failure provider observes the original target namespace once at
its configuration-owned probe URL. The contract classifies exports with `typeof`
into a closed `{name, callable}` population. Missing, malformed, duplicate,
over-limit, and name-only input is rejected; limits remain 512 names of 256 characters.

The replacement re-exports initially non-callable bindings from that same URL,
preserving data shape, names, shared identity, live updates, and module instance.
Initially callable exports remain authenticated faults; only the target is substituted.

Every substituted callable is the one launcher-owned recipe: it runs a private
invocation witness and then throws synchronously. The thrown error's code is
diagnostic only; detection never reads error codes, causes, or consumer tags, so
an assertion wrapper, a plain `Error`, a serialized response, or a caught fault
leaves the reached fact intact. Loading the replacement or probing its exports
does not run the witness.

The provider resolves the launcher-bound worktree once before constructing the
registration probe, substituted-module expectation and its stage of the shared
test run (see [Shared test execution](test-proof-execution.md#shared-test-execution)). That run uses
the same resolved root as its checkout and runs from the target's project
directory inside it; the reporter and the declared-module coverage scope are
addressed by that root, so every reported file and covered module is named
relative to it whatever directory the tests run from. A supported symlink
spelling of the launcher-minted worktree therefore cannot make recorded fault
identity diverge from the module URL actually loaded; no caller or environment
supplies an alternate root.

The structured-event reporter, the module-fault loader and the modules they
import are installed launcher assets. Every node:test candidate, falsifier and
traversal run resolves them from the loaded launcher package, never from the
checkout under test or its working directory, so a consumer file at a lookalike
path is never loaded. Test targets and declared modules stay rooted in the
authorized worktree. A missing or unreadable asset fails the run itself: its
original startup error, stderr, exit status and execution facts are retained,
and no proof credit results. That enumerated closure, with the provider's own
module, is the provider asset identity of a prepared node:test runtime. It is
measured whenever that identity is computed, so an asset changed after
preparation makes the attempt's inputs stale. Native providers hash their
observers' complete closures the same way (the JavaScript observers and the
Deno observer include the shared diagnostic graph leaf; stestr and the pytest
entry include the shared Python diagnostic owner).

The AVA provider runs the project's installed AVA with the launcher's AVA
configuration factory as its explicit `--config`. The factory loads the
project's own configuration through that installed AVA's own configuration
loader (the package.json `ava` key or an `ava.config.*` file or factory, under
AVA's own discovery, conflict and validation rules) and overrides only `cache`
to `false` for the attempt, so AVA persists no failed-test cache under the
installed `node_modules`. The same module is preloaded into AVA's main process
and, before AVA loads, points that process's `TMPDIR` at an `ava-tmp` directory
inside the attempt's own scratch, so AVA's temporary files are removed with the
attempt. Once the project configuration is loaded it restores the run's own
`TMPDIR`, which the test workers AVA forks keep. The factory is a provider asset
and part of the provider asset identity. An installed AVA without its
configuration loader (`ava/lib/load-config.js`) makes preparation and attempts
unavailable with `test_runtime_runner_package_missing`.

Forced invocation shares the probe population, selection checks, ordered
Inspector witnesses and configuration-derived identity. Its replacement
statically imports the probe and operation modules, wraps only the entry export,
and re-exports every other name from the probe URL, preserving names, object
identity, live bindings and the original module instance. Module startup and
selected-test registration do not wait on the replacement.

The replacement validates the original entry when it evaluates and looks up the
operation only on the first wrapper call, so an operation module that imports
target data links in an ordinary module cycle whichever module the test imports
first, including when the operation is a `const` export. On that first call it
resolves the operation synchronously, before Inspector setup, original
execution or any suspension, captures the exact original and operation
functions that both invocation and the Inspector breakpoints use, and takes the
single injection claim in the same step. The operation runs, without arguments,
only after that first original call returns successfully, and the caller
receives the original result. A failed first original consumes the opportunity.
Later and overlapping calls run the captured original with their own arguments
and never inject again; an overlapping call can still record an invalid-order
witness and so earn no credit.

One validator checks both exports. A configured export that is absent, present
but not a function (including an exported `undefined`), a function with a
different name, or unreadable because its binding is not yet initialized fails
with a message naming the configured export and repository-relative module:

- ``Function `cleanup` does not exist in `operation.mjs`.``
- ``Export `cleanup` in `operation.mjs` is not a function.``
- ``Function exported as `cleanup` in `operation.mjs` does not have the required name `cleanup`.``
- ``Cannot read function `cleanup` in `operation.mjs`.``

An invalid original entry fails replacement evaluation, so the selected test is
not observed. An invalid operation fails the first call. That error, with the
binding's read exception as its cause, is retained: every later call rejects
with the same error without rereading the binding, so repairing a mutable export
does not revive the replacement. The failure also runs one private reason
witness of the launcher recipe. The contract owns a single frozen table of
reason keys, witness names and message templates, plus the formatter that
renders them; both are part of the hashed mutation identity.

After the reporter transcript and the attempt's configuration, nonce and recipe
identity authenticate, one reason witness makes the observation unavailable with
`test_proof_forced_invocation_export_identity_mismatch`, even when the selected
test caught the rejection; its detail is only the reason and the configured
operation module and export. Witnesses for more than one reason are unavailable
as `test_proof_forced_invocation_identity_reason_inconsistent`. Either way the
falsifier ends as `test_proof_falsifier_execution_error`, never `not_detected`,
and earns no invocation or mutation credit. The runtime-evidence refusal carries
that closed identity, and the public Verify Proof failure detail exposes it as
`forced_invocation_identity_failure`, with the message regenerated from the
shared table. An unknown reason or any additional member makes the detail
unprojectable, and captured output is never passed through.

## Shared Node module-fault observation

`launcher.node-test-module-fault@2.0.0` observes both strategies through one
owner. Each attempt carries its validated closed configuration intact, including a
fresh launcher-minted 64-hex `attempt_nonce`. The contract derives the mutation
attestation from that nonce, the strategy, the mutation and module selection, the
forced-invocation selection, and the exact launcher recipe source. The substituted
module URL and every private witness function name carry that identity, and both
strategies substitute the target's own file URL under an attempt-addressed query so
declared Node coverage reports the witnesses under the target module path. Callers
supply no nonce, source, environment, root, or witness fact. Replay means a witness
that does not belong to this attempt; there is no used-nonce ledger.

The observer authenticates the reporter transcript once, re-derives the attempt
identity from the carried configuration, and requires the exact selected test
identity. Every executed outcome must be the selected test or a descendant whose
reported ancestry includes it. Static suites and hooks are not outcomes, so
selection nested under a suite is supported for both strategies, and numeric
nesting neither admits nor refuses. The provider performs no discovery run; the
attempt engine's single unchanged-candidate run is the only candidate execution.

Coverage counts are computed once per observation. A present zero-count witness is
an authentic unreached fact. Dependency failure is reached when its invocation
witness counts at least one call. Forced invocation is reached when the original
entry, the operation entry, and both ordered Inspector witnesses are positive and
the invalid-order and inspection-failure witnesses are zero. The replacement
catches an operation throw, so a throw alone is not a failure of the selected test.

The reached-valid fact is reported as `mutation_observed` and the payload's
`observation.observed`, separately from the selected test's own status. A reached
mutation whose selected test passes therefore stays observed. Only
`projectFalsifierExecution` in the evidence owner judges detection: it requires
isolation, the reached mutation, the unchanged candidate's selected pass, the
mutated selected failure, and the exact launcher reason, so a reached mutation
with a selected pass is `not_detected`. In the forced payload,
`observation.reached_assertion` remains the selected-test-failed diagnostic and
`observed:true` does not imply it. The evidence establishes process-wide reached
mutation plus the selected outcome, not causal attribution or execution inside the
selected test's body; a callable invoked while a test module initializes counts.

The observer declares four strategy-neutral mechanical outcomes, each
`valid:false` unavailable evidence rather than a policy refusal:

- `test_proof_module_fault_expectation_invalid`: a malformed configuration, a
  missing or wrong nonce, or an attestation, strategy, or recipe that the carried
  configuration does not reproduce;
- `test_proof_module_fault_witness_identity_mismatch`: a launcher witness of
  another attempt, recipe, or strategy under the target module path;
- `test_proof_module_fault_instrumentation_unavailable`: missing coverage, a
  missing declared witness or module population, or a malformed count;
- `test_proof_module_fault_selection_unattributable`: an executed outcome outside
  the selected test's reported subtree, or one whose ancestry is unestablished.

Transcript, receipt, and missing-selected-identity failures keep their own codes.
Each unavailable observation ends the attempt as
`test_proof_falsifier_execution_error` with its exact observation code and projects
publicly as `not_executable`; none becomes survival.

A selected test that never imports the target never loads the substituted module,
so no witness population exists. That limitation is reported as
`test_proof_module_fault_instrumentation_unavailable` with no proof credit, not as
a zero count.
