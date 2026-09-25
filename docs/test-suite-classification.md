# Test suite classification

How `tests/**` is categorized, enumerated, and selected, and what refuses a bad
placement. The shipped authority is `tests/test-suite-classification.mjs`; this
page is the durable contract behind it.

## The rule

**Directory location is the sole category authority for `tests/**`.**

| Location | Category |
| --- | --- |
| `tests/unit/**/*.test.mjs` | unit |
| `tests/integration/**/*.test.mjs` | integration |
| any other `tests/**/*.test.mjs` | *uncategorized — refused* |

Source prose, string literals, imported symbol names, and basename lists decide
nothing. A file's category is readable from its path alone, so it cannot change
because someone edited a comment.

`tests/run-tests.mjs` and `tests/test-suite-classification.mjs` are test
infrastructure, not corpus members. Helper modules, shared case files, and
fixtures keep living at `tests/`, `tests/helpers/`, and `tests/fixtures/`; only
`*.test.mjs` files carry a category.

## Why it replaced source-regex inference

Category used to be inferred from a test's own text: a list of regexes
(`INTEGRATION_MARKERS`) plus two basename declaration lists
(`INTEGRATION_FILE_PREFIXES`, `INTEGRATION_FILE_NAMES`) bolted on for what the
regexes could not see. It drifted three ways.

1. **Under-classification.** The regex matched `\bspawnSync\b` and had no marker
   for async `spawn(`, `execFile`, or `fork(` — and it could never see a spawn
   that happens inside a *shared helper*, because the keyword lives in the helper
   rather than in the test. Five subprocess-spawning tests sat in the fast unit
   gate as a result. The basename lists existed only to paper over this class.
2. **Prose false positives.** A test that merely *explains* bwrap confinement in a
   comment matched `/\bbwrap\b/` and was pushed out of the unit gate despite
   spawning nothing.
3. **Consumer drift.** The public-snapshot builder imported the same classifier
   but carried its own flat `readdirSync` and its own "is this a runner-selectable
   test" predicate, so the shipped public test surface could disagree with what
   the runner actually selects.

Under-classification is the dangerous direction: a slow or hanging integration
test in the unit gate makes the fast loop slow and can wedge it.

## The shared authority

`tests/test-suite-classification.mjs` owns, and is the only place that owns:

- **Path classification** — `classifyTestPath(relPath)` → `"unit" | "integration" | null`.
- **The supported-corpus predicate** — `isSupportedTestPath`, `isUncategorizedTestPath`.
- **Deterministic recursive enumeration** — `enumerateFilesRecursively` and the
  `enumerateTestFiles` / `enumerateTestSupportModules` views over it. Entries are
  sorted at every level, so emitted order depends only on the tree and never on
  filesystem iteration order. Symlinks are never followed and never emitted.
- **Duplicate and escape rejection.**
- **The single integration-process signal configuration.**
- **The package-local path rule** — `isPackageLocalTestPath`, for work record.
- **`extractModuleDependencies` / `resolveLocalModule`**, shared with the snapshot
  builder so there is one import-extraction implementation. Extraction uses a
  comment/string/template/regular-expression-aware lexical pass and returns
  lossless real-code occurrences for static, side-effect, literal dynamic, and
  computed dynamic import syntax. Each occurrence carries its kind,
  literal specifier when one exists, source location, and relevant direct-call
  context. The established de-duplicated `.all` projection is preserved for the
  placement guard and other existing consumers.

Consumers must not keep a local `isTopLevelTestPath`, a flat `readdirSync` over
`tests/`, a copied tree walk, or any source-text classifier.

`loadTestCorpus` is the one IO-bearing entry point. `readFile`, `listDir`, and
`dirExists` are injected, so the whole enumeration-and-audit path is exercisable
in-process without touching disk.

## The integration-process signal, and what it does

A test is *integration-shaped* when it can start an operating-system process. The
signal is an **import of Node's process-spawning module**, matched as a module
specifier:

```
node:child_process   child_process
```

Matching the specifier rather than a call keyword catches `spawn`, `spawnSync`,
`execFile`, and `fork` alike — the whole family, not the one shape the outgoing
regex happened to list. The signal is evaluated over a candidate's **direct and
transitive import closure within `tests/**`**, which is what makes a spawn living
inside a shared helper visible.

Nothing in the signal reads comments or string literals, which is why the work record
prose-only false positives are gone by construction.

**The signal refuses a placement; it never reclassifies one.** A signal that
silently moved tests between categories would be the same mechanism that drifted
before. The guard reports the bad placement and the run stops.

### Failure boundary

`loadTestCorpus` throws `TestSuiteClassificationError` carrying a stable code:

| Code | Meaning |
| --- | --- |
| `test_suite_classification.escaping_test_path.v1` | an enumerated path is not under `tests/` |
| `test_suite_classification.uncategorized_test_path.v1` | a `*.test.mjs` outside both category directories |
| `test_suite_classification.duplicate_test_basename.v1` | one test basename claimed by more than one path |
| `test_suite_classification.unknown_exception_path.v1` | a unit-safe exception naming a path that is not a unit test |
| `test_suite_classification.integration_signal_in_unit.v1` | a unit-placed test whose closure can start a process |

The runner reports the code and the offending paths and exits `3` **before any
selection or execution**.

### The unit-safe exception boundary

`UNIT_SAFE_SIGNAL_EXCEPTIONS` admits a unit-placed test that carries the signal in
its closure but cannot start a process in practice. An entry is **exact-path**,
**rationale-bearing**, and **tested**. It is not a category declaration — it never
moves a file between directories — and it is not a parallel signal configuration.
A stale entry is itself a refusal, so an exception cannot rot unnoticed.

There is exactly one today: `tests/unit/test-suite-classification.test.mjs`, whose
assertions must quote the signal specifiers as test data in order to prove the
signal catches them.

## Runner contract

`node tests/run-tests.mjs <mode> [passthrough...]`

| Mode | Selects |
| --- | --- |
| `unit` (default) | `tests/unit/**` |
| `integration` | `tests/integration/**` |
| `all` | both, sorted |
| `list` | prints the classification and exits |

The runner forwards native Node options and accepts literal `.test.mjs` file
paths, including absolute paths outside the repository. Its per-test backstop is
30s for unit and 120s for integration/all, overridable with `--test-timeout=`.
It clamps `HOME` / `XDG` / credential / agent-identity environment variables.

The runner now owns process concerns only. It decides no categories.

### External file watchdog

One native `node --test` run schedules the selected files and produces all
normal spec, JUnit, coverage and custom reporter output. A silent additional
reporter sends exact file-wrapper start/end events over fd 3; the control
protocol (version 2, 16 KiB frames) is defined once in
`tests/helpers/test-runner-observer-protocol.mjs` for both sides. The runner prints
`START` and `FINISH` with file, budget, elapsed time and outcome to stderr;
these messages do not enter reporter output. A filtered, skipped, todo, empty or
nested test cannot finish another file's wrapper.

The suite's stdout and stderr are pipes the runner reads and forwards unchanged,
per stream in order, to the runner's own stdout and stderr. The bytes are
exactly what the native reporters emit under capture, and user reporter
destination files are written by Node as before. Because the suite no longer
writes to the terminal directly, output that depends on a TTY (`isTTY`,
automatic colour) differs from an uncaptured `node --test`. The runner never
injects `FORCE_COLOR` or emulates a terminal; ask a reporter for colour
explicitly if you need it.

`--test-file-timeout=MS` defaults to 600000ms. Its clock starts when Node
dequeues that file, so queued files do not consume their budget. The earliest
expired active file stops the owned suite process group. `--test-runner-phase-timeout=MS`
defaults to 30000ms and bounds startup, intervals with no active files, and
reporter/global teardown. Both options accept `--name=MS` or `--name MS` and
require a positive decimal integer at most 2147483647. They are separate from
Node's `--test-timeout`, which bounds individual assertions where Node can
enforce it. A synchronous loop or a finished assertion that leaves a server
open still reaches the external file budget.
With explicit `--test-shard`, Node may leave input paths unscheduled; only
dequeued wrappers acquire deadlines, and every started wrapper must complete.

The runner binds known option values before choosing explicit files. Use `--`
before literal file paths when needed; quoted glob patterns are refused, so
expand them in the shell. Ambiguous unknown options followed by a bare value,
missing/duplicate watchdog budgets, and mismatched reporter/destination pairs
fail before launch. Explicit file spellings that resolve to the same absolute
path are launched and observed once. Native Node decides whether an otherwise
self-contained unknown option is valid. Watch mode, `--test-isolation=none`, and
`--experimental-test-isolation=none` are refused before launch because they do
not provide a finite process-per-file boundary. Explicit
`--test-force-exit` remains a native option; the runner never injects it.

On expiry, the first mechanical code (`test_runner.file_timeout.v1`,
`test_runner.phase_timeout.v1` or `test_runner.observer_startup_timeout.v1`) is
retained, the owned process group is stopped through `managed-test-process`, and
the run exits 1 after confirmed settlement, including when escalation sends
SIGKILL to a blocked suite process. Timeout output may contain an incomplete
JUnit document;
the runner does not synthesize closing XML or passes. The diagnostic names the
file or phase, elapsed and budget where available, and the relevant option for
a deliberate larger budget. Observer protocol/loss diagnostics identify runner
maintenance. On SIGINT, SIGTERM or SIGHUP, the runner settles the group and
re-raises the signal. Temporary roots are removed only after confirmed group
settlement; an unconfirmed group retains exact roots for operator inspection.
Children that deliberately detach into another process group and hard kills of
the runner itself are outside this JavaScript cleanup boundary.

### Serial integration execution

`node --test` defaults its concurrency to the host CPU count, so an integration
batch forks one test process **per file**, each with its own V8 heap and its own
real-repository Git subprocesses. On a many-core host that multiplies the cost of
the heaviest suites by the core count.

`integration` and `all` therefore pass `--test-concurrency=1`. An explicit
`--test-concurrency` in the passthrough still wins, and `unit` keeps its
parallelism because those tests start no processes.

### The supported entrypoint

The migrated integration fixtures refuse a direct `node --test` invocation and
name `node tests/run-tests.mjs integration <file>` in the refusal. They read the
runner's existing `PORTFOLIO_WIKI_TOOLS_HERMETIC_TESTS` marker — no separate
execution token exists — and refuse **before** allocating a temporary tree or
starting a process, so an unsupported invocation leaves nothing behind.

A direct invocation bypasses serial execution, the runner-owned `HOME`/`TMPDIR`
roots, the credential clamp, and abandoned-root recovery.

### Runner-owned temporary roots

The runner creates its `HOME` and `TMPDIR` as exact `/tmp` roots and removes them
on completion, partial setup failure and catchable termination. One deletion path
serves both that cleanup and abandoned-root recovery, and it refuses anything it
cannot prove is the runner's own unchanged root.

- **Continuity is an open handle, not a cached inode number.** The runner holds a
  no-follow directory handle on each root from creation until cleanup. A root is
  removed only while its path is still a plain directory resolving to the held
  handle's identity. A replaced directory or a symlink — even one pointing at the
  genuine root — is refused. A cached device/inode pair is not usable here:
  where a directory's inode number is not persistent it changes while the
  directory is untouched. On an overlayfs whose layers span filesystems with
  `xino` off, as on a container root, `st_ino` is the overlay's in-memory inode
  number. It is reassigned after cache eviction with the same device and ctime.
  An open handle pins that inode, so the number cannot change while it is held.
- **Ownership is the original marker file.** Each root carries a single-link,
  mode-0600 marker recording the runner's identity and the marker file's own
  device and inode. Regular-file inode numbers are persistent, so a copied marker
  proves nothing.
- **Recovery leaves live and unproven roots alone.** It opens a handle before proving
  ownership and holds it through both proofs and the removal. It removes a root
  only when the marker's owner process or boot is gone. Roots whose markers use
  another schema are not recovered.
- Every handle is released on every path, and a cleanup failure is reported per
  root and makes the run non-clean without changing the child's exit or signal.

### Retained run artifacts and live timing

Every finite `unit`, `integration` or `all` run retains a private diagnostic
directory. `list` creates nothing. Before the suite starts the runner prints
`[run-tests] artifacts=<dir> run=<id>` to stderr. After the suite it prints the
slowest files, tests and component spans (at most 20 each), then
`run status=<status> recording=<complete|incomplete> artifacts=<dir>`.

**Where.** A run allocates a fresh mode-0700 `mkdtemp` directory named
`agent-chassis-test-run-*`, choosing its base in this order:

1. `--test-artifacts-dir=PATH` (or `--test-artifacts-dir PATH`), created 0700 if
   missing, within the caller's own write authority.
2. A runner started inside another run's suite (a nested runner in a test)
   allocates under `<outer-run>/nested/`. The outer runner passes
   `PORTFOLIO_WIKI_TOOLS_TEST_RUN_CONTEXT` to its suite. This is routing data
   naming the run and its directory, and it grants nothing. The nested runner
   refuses it unless it names a real, non-symlink, current-uid, mode-0700
   directory outside disposable roots whose `run.json` carries the same run id.
3. Otherwise, the caller's temporary directory, captured before the runner
   clamps `TMPDIR` for its suite.

A base inside a runner-owned `HOME`/`TMPDIR` root is refused before launch with
`test_runner.artifact_create_failed.v1`. There is no fallback probe, no
overwrite and no pruning: a run never deletes another run's directory, and
removing retained runs is up to the operator. "Retained" means the directory
survives this run's own cleanup. It does not survive a launcher or session that
discards its temporary filesystem.

**Contents.** All files are mode 0600. Every record is appended as it is
observed; nothing is buffered until the end of the suite. There is no fsync, so
there is no power-failure guarantee.

| File | Holds |
| --- | --- |
| `run.json` | run id, parent run, artifact base, Node version, mode, diagnostic kind, selected files, runner flags, source provenance, and at the end: status, native exit/signal/watchdog, recording status and failures, output statistics |
| `stdout.log`, `stderr.log` | exactly the bytes forwarded to stdout and stderr, from the artifact notice on |
| `events.jsonl` | native test starts and completions, one producer |
| `components/<producer>.jsonl` | component spans and Git commands, one create-exclusive journal per producing process |
| `summary.json` | derived counts, unfinished work, slowest rows, component and Git totals, and completeness |

Source provenance comes from `git --no-optional-locks` reads, each bounded to
5 s. When there is no Git or no metadata, the field is recorded as unavailable
with its reason. A dirty tree has no exact patch identity, so its
`patch_identity` stays null rather than being invented. No environment variables
are recorded.

**Status.** The primary outcome is one of `tests_passed`, `tests_failed`,
`watchdog_expired`, `operator_signal`, `output_lost`, `setup_failed`,
`spawn_failed` or `settlement_unconfirmed`. The recording status is reported
beside it and never replaces it.

**Native timing.** The observer writes `events.jsonl` in the process that runs
the reporters:

- A start is written from `test:dequeue`, in execution order.
- A completion is written from `test:complete`, with Node's own
  `details.duration_ms`.
- `test:pass`/`test:fail` are not recorded, so nothing completes twice.

The observer writes each record before it sends the file-boundary frame, so a
test's completion is on disk while later tests are still running.

Identity has two namespaces:

- **`file`:** run, suite producer, absolute wrapper file and wrapper `testId`.
  File wrappers carry no `entryFile`, by Node's design.
- **`test`:** run, entry file, source producer and `testId`. The source producer
  is that entry file's wrapper instance.

Names and source locations describe a test; they are never its identity, so
repeated names, imported tests and nested tests stay distinct. Suite and file
durations include their children and are never summed with them. Timestamps
from different processes are not a shared clock.

If Node 24 SIGKILLs a file's process, it publishes only that file's failed
wrapper, not the inner results. Rows Node already published are kept, and the
file is never shown as a pass.

**Partial capture.** A reader accepts only a torn final line. That line's raw
bytes are kept and the journal is marked incomplete. A malformed, oversized
(over 64 KiB), foreign or out-of-sequence interior record is a named error,
never skipped.

A run is `recording=complete` only when all of these hold:

- the native stream has both start and end markers, no unfinished work and no
  incomplete identity;
- every journal reads cleanly;
- no producer wrote a failure marker;
- Git events reconcile with the owning aggregate;
- no runner-observed recording failure occurred.

An incomplete recording makes the run exit nonzero even when every test passed.
It never turns a failure into a pass.

**Output owner.** Every finite-run byte the runner emits goes through one
bounded asynchronous owner (`tests/helpers/test-runner-output.mjs`, 1 MiB per
sink). That includes forwarded suite output, progress, notices, diagnostics
and the final lines. How it writes depends on the destination:

- **Pipes and sockets:** written from the event loop by a nonblocking stream.
- **TTYs and other character devices:** reopened through `/proc/self/fd/N` as
  the runner's own `O_NONBLOCK` file description (the shared description is
  untouched). A paused terminal returns `EAGAIN` and is retried on a timer.
  Without `/proc`, the inherited blocking description is used, and `run.json`
  records that transport as `fs-blocking-device`.
- **Regular files:** written by asynchronous fs writes on the threadpool.

When a sink passes its bound, the runner pauses the suite's pipe, so a slow or
unread destination never blocks the watchdog's timers. How destination
failures are handled:

- **Closed stdout or stderr (EPIPE):** the failure is latched, the suite is
  stopped through `managed-test-process`, and the run exits 1 with
  `status=output_lost`. It never exits 0.
- **Final lines not drained within the phase budget:** this is a recording
  failure, and the runner exits 1.
- **A TTY or pipe that is never read:** deadlines, settlement and artifacts
  still complete. The final drain is bounded, and the process exits 1 even if
  the terminal is never read again.

**Recording failures.** `tests/helpers/test-timing-diagnostics.mjs` owns
these codes:

- `test_runner.artifact_create_failed.v1`
- `test_runner.artifact_write_failed.v1`
- `test_runner.timing_record_invalid.v1`
- `test_runner.timing_incomplete.v1`

Each names the next actor and action. If the observer's timing sink fails, only
that sink is disabled, and the failure is sent as a `RECORDING_FAILURE` control
frame beside the file lifecycle. The native run and the file deadlines continue,
and the failure is never reported as `observer_lost`. The watchdog keeps its own
codes, and so does option parsing.

**Nested Node context.** The clamp removes `NODE_TEST_CONTEXT` and
`NODE_TEST_WORKER_ID`. Without that, a runner started from inside a test file
inherits them, `node --test` skips every file as a recursive run, native
reporter output is empty, and the run ends in `observer_lost`.

**Component spans.** Recording is automatic under the runner's run context and
is off otherwise. These shared owners publish spans:

- `test-fixture`: setup;
- `test-resource-scope`: owned cleanup, one span per scope;
- `managed-test-process`: child lifetime;
- the Git preparation measurement: sample and setup phases;
- `measureComponentPhase`: explicit copy and setup phases.

Every fixture Git command is also recorded, from both execution paths.

A span nests only through an explicit parent span id. Without an explicit
`test` it is `unattributed`; it is never assigned to whichever test ran most
recently. A span still open when its producer ended is reported as unfinished
coverage. Test-body internals and production subprocesses are unmeasured, and
`summary.json` names both. Native whole-test durations are never split into
setup, body and cleanup.

## Designated process and Git helpers

Placement (above) asks whether a test *can* start a process. This asks a
different question: does a file start processes **itself**, rather than through a
helper that bounds them?

A raw `spawnSync` in a fixture has no timeout, no output bound, no isolated Git
environment and no registered cleanup, so a runaway or abandoned child is
invisible. The designated helpers supply those guarantees:

| Helper | Use |
| --- | --- |
| `tests/helpers/managed-test-process.mjs` | test-owned processes generally |
| `tests/helpers/git-test-fixture.mjs` | `createGitTestRepository` for asynchronous Git; `createSyncOwnedGitRunner` where the production contract under test is synchronous |

`createSyncOwnedGitRunner` exists for a demonstrated requirement, not
convenience: `resolveCommittedSliceReviewAdmission` reads `result.ok` /
`result.stdout` on the line after it calls the injected probe, so an asynchronous
runner fails every probe closed. Production is not converted to async for a test
helper. The synchronous runner keeps the same argument and environment policy as
the asynchronous fixture, requires an explicit timeout, bounds output, and runs
only against explicitly registered fixture-owned repositories, worktrees or
trees. Ordinary nonzero Git results stay results — `rev-parse --verify` on a
missing ref legitimately exits 128 and production depends on reading that —
while timeout, spawn failure and output exhaustion each raise their own code and
can never be mistaken for Git's verdict.

Repository-local committer identity is still written through the runner's narrow
`configure` opening, because production code drives the same repository with its
own Git process and never sees the runner's isolated environment.

### Git preparation measurement

`tests/helpers/git-test-measurement.mjs` is the one fixture Git measurement
owner. Both execution paths report every command through it:

- the asynchronous `createGitTestRepository`;
- the synchronous and asynchronous forms of `createSyncOwnedGitRunner`.

It holds one command identity rule (first positional argument and its
subcommand) and one outcome vocabulary (`ok`, `nonzero`, `fault`). Every
command lands in four places:

- the process totals (`snapshotGitTestFixtureMetrics`);
- the repository account (`fixture.metrics()`: `commands`, `ok`, `nonzero`,
  `faults`, `elapsed_ms`, `by_command`);
- the optional preparation collector;
- one live `git_command` event.

`git-test-fixture.mjs` delegates to this owner and keeps no accounting of its
own. A nonzero verdict from Git is `nonzero` whether the caller allowed it or
the fixture threw on it. Timeouts, spawn failures and output exhaustion are
`fault`.

`createGitPreparationMeasurement` is an opt-in, observation-only collector. A
fixture owner passes it to `createSyncOwnedGitRunner({ measurement })`. It
never runs Git, changes a result, or owns cleanup. None of its methods throw:
an unusable clock, an impossible duration or a re-entered phase becomes a
counted, bounded collection failure and marks the report `incomplete`. Its
sample and phase transitions are also published as component spans.

The committed-slice review fixture declares its setup phases —
`common_init`, `common_config`, `common_base_content`, `common_base_commit`
(together one common preparation), `scenario` and `backend_setup` — and
attributes Git to the active phase. Git issued after setup (test bodies, the
backend's review-context probe through the fixture runner) is counted as
`outside_fixture_setup`.
The fixture keeps an immutable base repository template per exact base-content
key for the life of one test file. Every case copies its files and `.git`
directory before creating mutable refs, worktrees and deliveries; no case
shares a writable repository. Template creation and copy time remain attributed
to the common setup phases, and the copies are explicit `measureComponentPhase`
spans.
The admission and policy files call
`enrollCommittedSliceGitMeasurement(import.meta.url)`. Without the runner's run
context this does nothing. Under it, every fixture call in that file's process
is measured, and after the file's tests finish one `measurement_report` record
is appended to that process's own component journal.

The report's provenance comes only from the run's `run.json`:

| Report field | From `run.json` |
| --- | --- |
| `source_revision` | source commit |
| `patch_identity` | `clean`, or null when the tree is dirty or the identity is unavailable |
| `sample_id` | run id |
| `diagnostic_kind` | `--test-diagnostic-kind=focused\|baseline`; the default is `focused`, so an arbitrary run is never a baseline |
| `selectors` | selected files |
| `runner` | mode and flags |

`readGitPreparationReports(runDir)` in
`tests/helpers/git-preparation-baseline.mjs` reads the reports back from the
per-producer journals. It names any journal that is torn or malformed instead
of skipping it.

A report holds fixture invocations, completions, failures, common preparations,
repositories and worktrees created, per-phase durations and Git counts by command
name, and individual samples with their unattributed residual. It also records
whole-workload elapsed time with the remainder outside fixture setup, process
uptime at enrollment, peak RSS of the workload process, and an explicit
`unavailable` list: fixture disk bytes, Git child CPU time and production Git.
Git counts are **fixture-helper Git only**. Production Git and Git run through
another owner or shim, such as the delayed capability-probe shim, are unmeasured.
The lifecycle fixture's own repository is also unmeasured. Sample and command-name
capacities bound storage; overflow is reported through `samples_dropped` and
`commands_overflowed` while totals stay complete.

`validateGitPreparationReport` lists accounting and provenance inconsistencies.
`summarizeGitPreparationBaseline` combines per-file reports into per-sample
values and medians, and refuses reports that are inconsistent, not comparable
(revision, patch, selectors, runner settings or diagnostic kind differ) or
incomplete per sample. These checks establish report correctness only. They say
nothing about speed.

`SUBPROCESS_HELPER_ENROLLED` in `tests/test-suite-classification.mjs` lists the
files required to route process creation through a designated helper. The check
is enrollment-based on purpose: around 195 modules under `tests/` import the
spawning module directly, and enumerating them would be an inventory of the
status quo rather than a rule. Detection reuses the placement signal, so a
**dynamic** `await import("node:child_process")` counts exactly like a static
import. `SUBPROCESS_MIGRATION_BACKLOG` records remaining work; an entry naming a
file that has since migrated is itself a refusal, so the list cannot rot into a
standing allowance.

## Public snapshot behaviour

`tools/agent-chassis-snapshot.mjs` consumes the same classifier and the same
enumerator. It ships:

- `tests/run-tests.mjs` and `tests/test-suite-classification.mjs`, verbatim;
- `tests/unit/**` tests that are portable, with nested paths preserved;
- the complete reachable portable helper and fixture closure.

It ships **no** `tests/integration/**` file, and carries no second walk and no
category mapping of its own. Post-copy verification walks the copied tree with the
shared enumerator and re-checks category by location.

Two source-repo-only exclusions remain path-pinned:
`PORTABILITY_TEST_REL` and the `PUBLIC_EXCLUDED_TESTS` entries.

### Snapshot dependency obligations

Import extraction remains shared classification infrastructure, but import
**disposition for the public artifact** is owned only by
`tools/agent-chassis-snapshot-test-surface.mjs`. The snapshot builder consumes
and verifies that module's normalized obligations; it does not carry a parallel
negative-import rule.

An occurrence is `expected-absent` only when it is a real-code string-literal
dynamic import expression passed directly as argument zero—the asserted
operation—to the exact `assert.rejects(...)` call shape. Arrow callbacks,
parenthesized or nested expressions, computed targets or members, aliases, and
otherwise ambiguous forms remain `required-present`. Import-shaped text in a
comment, string, template, or regular-expression literal is not an occurrence.
Computed dynamic imports remain visible as targetless `required-present`
evidence for source/copy drift detection. Because they do not identify one
physical target, they neither fabricate a target obligation nor exclude an
otherwise-portable candidate; literal imports and the existing `.all` projection
continue to own local closure and process-placement checks.

Exclusion is evaluated first. An import escaping the repository, entering a
forbidden/excluded root, or naming a non-shipped workspace package remains an
exclusion even inside `assert.rejects`. For the complete candidate corpus that
will ship, relative occurrences are resolved and grouped by normalized target,
not by their source-relative spelling. If any occurrence requires a target to be
present, that target is globally `required-present`; an expected-absence use
cannot weaken it.

The obligation corpus covers every JavaScript module that can affect public test
execution: selected portable tests, their reachable helper/fixture modules, and
the force-copied `tests/run-tests.mjs` and
`tests/test-suite-classification.mjs` infrastructure. The two infrastructure
modules participate only in dependency analysis; they do not become test
classification candidates or change directory policy.

Resolved-target identity is established once against the authoritative source
candidate universe. Copy analysis reuses those canonical identities while
re-extracting occurrence kind and disposition from the copied bytes. Physical
copy state answers only whether each already-identified target is present. This
keeps extensionless imports stable when a source-side `.mjs` target is
deliberately absent from the artifact and still lets mixed spellings converge on
one target-wide required-present disposition.

Verification is symmetric and fail-closed:

- `snapshot_dependency.required_target_missing.v1` refuses a required target
  omitted from the copied tree.
- `snapshot_dependency.expected_absent_target_present.v1` refuses an
  expected-absent target that appears in the copied tree.
- `snapshot_dependency.normalized_obligation_drift.v1` refuses when the
  post-scrub copied sources re-extract to different disposition-relevant
  normalized obligations than their source counterparts.

Each target-state refusal carries the source, occurrence kind and location,
original specifier, resolved target, disposition, and reason. Source/copy
comparison deliberately ignores raw regex matches and location shifts caused by
comment removal; it compares semantic occurrence kind, specifier, target, local
disposition, and target-wide final disposition using the same extractor and
test-surface authority on both sides.

Source and copy disposition contexts are created by one test-surface helper and
carry the same `shippedPackages`, `nonShippedPackages`, and `pathExists` fields;
only the tree consulted by `pathExists` changes. Exclusion precedence therefore
cannot drift because one side silently omitted a package-root input.

`tests/unit/agent-chassis-snapshot-negative-import-witness.test.mjs` is the real
shipped witness. It is an ordinary portable unit candidate whose direct
`assert.rejects(import(...))` target intentionally does not exist. Repository-plan
regressions prove the witness is selected, contributes an expected-absent
obligation, accepts the missing target, and refuses a simulated unexpected
presence. No path registry or work record location participates. Whole-snapshot
validation confirms the generated artifact contains the witness and at least one
expected-absent obligation before running `node tests/run-tests.mjs unit` inside
`/tmp/agent-chassis-public`; classification and transitive process-placement
behavior remain owned and validated separately by the shared test-suite
authority.

## Ownership boundary with work record and work record

- **work record** owns `tests/**` classification, enumeration, process signals,
  snapshot consumption, the moved path literals, and the cutover baseline below.
- **work record** owns discovery of the `packages/**` corpus. It consumes
  `isPackageLocalTestPath` from this module and reports only its own
  `packages/**` delta. It must not add a basename declaration list or a second
  classifier.
- **work record** is report-of-record and owns no baseline proof.

The runner does not select the package-local corpus yet. Naming the rule here is
what keeps that future switch from growing a parallel authority.

## Migration and baseline contract

Counts are **evidence, not constants**. Re-derive them; do not pin them.

The cutover moved every repository-tracked `*.test.mjs` under `tests/**` exactly
once into a category directory. Its one-time migration inventory used the outgoing
classifier — the marker regexes and basename lists — unioned with the new process
signal, with the two work record prose-only false positives placed by behaviour
instead. Those outgoing mechanisms informed the inventory only; they survive
nowhere as lint lists or exports.

Baseline measured at cutover (2026-08-25):

| | pre-cutover | post-cutover |
| --- | --- | --- |
| unit files | 543 | 443 |
| integration files | 293 | 395 |
| collected by no mode | 1 | 0 |
| total `tests/**` test files | 837 | 838 |

Per-file category deltas across the 837 moved files:

| transition | files |
| --- | --- |
| unit → unit | 440 |
| integration → integration | 292 |
| unit → integration | 104 |
| integration → unit | 1 |

The 104 moves into `tests/integration/` are tests the outgoing classifier placed
in the unit gate whose import closure can start a process — the under-classified
class the guard now refuses. The single move into `tests/unit/` is
`launch-isolation-failopen-refusal.test.mjs`, a work record prose-only false positive
that spawns nothing.

One previously-orphaned file, `tests/fixtures/mcp-stdio-session.test.mjs`, was
collected by no runner mode before the cutover because the old `classify()` read
only the top level of `tests/`. It is now placed and selected.

Post-cutover totals include two files the cutover added:
`tests/unit/test-suite-classification.test.mjs` and the relocated
`tests/unit/agent-chassis-snapshot-portability.test.mjs`.

## Adding a test

Put it in `tests/unit/` or `tests/integration/` by behaviour. If it can start a
process — directly or through a `tests/` helper — it belongs in
`tests/integration/`. Nothing else is required, and nothing you write in the file
changes its category.
