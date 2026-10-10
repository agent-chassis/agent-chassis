# Semgrep

This repository runs [Semgrep](https://semgrep.dev/) through one process
adapter, `tools/semgrep-run.mjs`, and ships one consumer of it: the test lint,
`tools/semgrep-test-lint.mjs`, which reviews test sources for bypassed shared
helpers and avoidable repeated work.

Both run only when someone invokes them. No launcher, test runner, CI job or
admission check calls them, and neither installs Semgrep, contacts a rule
registry, compares against a baseline or edits a source file.

## Prerequisite

Semgrep is an external executable that the operator installs. Nothing here
installs or downloads it. Every command takes the executable explicitly or
finds `semgrep` on `PATH`:

- An explicit path that is missing or not executable is a failure. It never
  falls back to `PATH`.
- Without an explicit path, the first executable `semgrep` on `PATH` is used.
  If there is none, the command fails and names the prerequisite.

The executable's own reported version is captured on every run and recorded
with the result.

## Shared runner

`runSemgrep` in `tools/semgrep-run.mjs` is the only code that starts Semgrep.
It runs one bounded child and returns the native facts.

```js
import { resolveSemgrepExecutable, runSemgrep } from "./tools/semgrep-run.mjs";

const executable = resolveSemgrepExecutable({ explicit: "/path/to/semgrep" });
const result = await runSemgrep({
  mode: "scan",                       // or "test": native rule-fixture test mode
  executable: executable.path,
  configs: ["rules/my-rules.yaml"],   // local rule files only
  targets: ["src/a.mjs", "src/b.mjs"],
  outputDir: "/path/to/existing/empty/directory",
  cwd: process.cwd(),
  sarif: true                         // scan only: also retain the native SARIF
});
```

| Input | Meaning |
| --- | --- |
| `mode` | `"scan"` or `"test"`. Test mode runs Semgrep's rule-fixture tests: each rule file is paired with a fixture file of the same name. |
| `executable` | Absolute path, normally from `resolveSemgrepExecutable`. |
| `configs` | Non-empty array of readable local rule files. A URL, a registry name, a directory or a missing file is refused before Semgrep starts. |
| `targets` | Non-empty array of existing paths. There is no default target and no scan-everything mode. Targets reach Semgrep exactly as written, so native paths stay relative to `cwd`. |
| `outputDir` | Existing directory that does not hold the native artifacts yet. An existing artifact is never overwritten. |
| `sarif` | Scan only. Retains `semgrep.sarif`. Semgrep 1.180.0 lists every match there and marks each one an in-source comment suppressed with a `suppressions` entry of kind `inSource`; its JSON lists only the unsuppressed matches. |
| `env` | Environment for the child. Defaults to the caller's environment, unchanged, so a clamped `HOME` or `TMPDIR` stays clamped. |

Semgrep is always started with metrics and its version check disabled, rule IDs
not rewritten, Git-ignore filtering off, and only the configs and targets the
caller passed. The runner has no argument for an account login, a proprietary
engine, a baseline or an installation.

### Budgets

Each budget is a positive integer, is configurable per call and is recorded in
the result.

| Option | Default | Bounds |
| --- | --- | --- |
| `timeoutMs` | 120000 | One Semgrep invocation. When it expires the child's process group is stopped. |
| `tailBytes` | 65536 | The retained tail of the child's standard output and standard error, kept for diagnostics. |
| `maxArtifactBytes` | 67108864 | The native JSON artifact. Exceeding it stops the run; findings are never truncated. |
| `versionTimeoutMs` | 30000 | The version probe that precedes each run. |
| `ruleTimeoutSeconds` | 30 | Semgrep's own limit for one rule on one file. |
| `maxTargetBytes` | 1000000 | The largest file Semgrep analyses. |

The child's lifetime and process group are owned by
`tests/helpers/managed-test-process.mjs`, and the artifact and child are
registered with a `tests/helpers/test-resource-scope.mjs` scope. The process
group settles before the artifact is released.

### Result

When Semgrep ran to its own exit and its JSON was retained complete, the call
resolves, whatever the native exit code:

- `native.exit_code`, `native.signal` and `native.status`: `"clean"`,
  `"findings"` or `"error"`. In test mode `"findings"` means a rule fixture did
  not match its annotations.
- `output`: the parsed native JSON. The full bytes are in
  `artifacts.json` (`semgrep.json`); `artifacts.sarif` names the SARIF when it
  was requested.
- `errors`: one diagnostic per native error, described below.
- `fixture_tests` (test mode): every rule's expected and reported lines per
  fixture file, the configs Semgrep rejected, and `passed`.
- `version`, `argv`, `cwd`, `budgets` and `timing` (`started_at`, `ended_at`,
  `elapsed_ms`).

In test mode Semgrep exits zero when it rejects a rule file, so use
`native.status` and `fixture_tests.passed`, not the exit code.

### Failures

When a complete native result could not be established, the call rejects with a
`SemgrepRunError`. Its `diagnostic` has seven fields: `class`, `subject`,
`cause`, `effects`, `uncertainty`, `actor` and `action`. `cleanup` holds a
second diagnostic when releasing the process or artifact also failed; the
original failure is kept. `facts` carries what was observed first: arguments,
native exit, bounded tails and the partial artifacts that exist.

| Class | Actor | Corrective action |
| --- | --- | --- |
| `semgrep_run.invalid_request.v1` | caller | Correct the named request field. |
| `semgrep_run.executable_unreachable.v1` | operator | Make the named executable reachable in this execution environment. |
| `semgrep_run.config_unreadable.v1` | caller | Pass an existing local rule file. |
| `semgrep_run.artifact_destination_refused.v1` | caller | Choose a writable, fresh artifact directory. |
| `semgrep_run.artifact_write_failed.v1` | caller | Choose a writable, fresh artifact directory with enough space. |
| `semgrep_run.artifact_limit_exceeded.v1` | operator | Review `maxArtifactBytes` and the target population before an adjusted rerun. |
| `semgrep_run.timeout.v1` | operator | Review the named budget and targets before an adjusted rerun. |
| `semgrep_run.version_unavailable.v1` | operator | Confirm the executable is a working Semgrep. |
| `semgrep_run.process_start_failed.v1` | operator | Make the executable runnable. |
| `semgrep_run.native_terminated.v1` | operator | Find what terminated the process. |
| `semgrep_run.native_output_invalid.v1` | runner owner | Inspect the retained output; it is never treated as clean. |
| `semgrep_run.cleanup_unconfirmed.v1` | runner owner | Resolve the named process group or artifact. |

Native errors arrive in `errors` on a resolved result, in the same seven-field
shape:

| Class | Actor | Meaning |
| --- | --- | --- |
| `semgrep_run.config_invalid.v1` | rule author | Semgrep rejected a rule file. The cause names the installed version, which may not support newer rule syntax. |
| `semgrep_run.source_unparsed.v1` | source author | Part of the named source was not parsed, so no rule analysed it. |
| `semgrep_run.native_rule_timeout.v1` | operator | A rule hit a native time, memory or match limit on the named source. |
| `semgrep_run.native_error.v1` | runner owner | Any other native error. It is reported, never dropped. |

No failure is retried, and no input is weakened to make a run pass.

### Command line

```sh
node tools/semgrep-run.mjs <scan|test> --config <rule-file> --target <path> --output-dir <dir>
```

`--config` and `--target` repeat. `--semgrep-bin <executable>` selects the
executable, `--sarif` retains the SARIF in scan mode, and `--timeout-ms`,
`--tail-bytes`, `--max-artifact-bytes`, `--rule-timeout-seconds` and
`--max-target-bytes` set the budgets. The command prints a JSON summary and
exits 0 when clean, 1 for findings or failing rule fixtures, and 2 on failure.

## Test lint

```sh
npm run lint:tests -- --semgrep-bin <executable> --report-dir <new-empty-runtime-directory>
```

`npm run lint:tests` runs `node tools/semgrep-test-lint.mjs`, the only test-lint
command.

| Option | Meaning |
| --- | --- |
| `--semgrep-bin <path>` | Semgrep executable. Optional when `semgrep` is on `PATH`. |
| `--report-dir <path>` | Fresh report directory: a path that does not exist yet or an empty directory. It must be outside `docs/`, `wiki/`, `.semgrep/` and every scanned tree. Default: a newly allocated directory under the temporary directory, whose path is printed. The same rule applies to that default: when `TMPDIR` points inside one of those trees the command fails with `test_lint.report_destination_refused.v1`, creates nothing there and does not choose another directory. |
| `--repo-root <path>` | Repository whose test population is scanned. Default: this checkout. |
| `--timeout-ms`, `--tail-bytes`, `--max-artifact-bytes`, `--rule-timeout-seconds`, `--max-target-bytes` | The shared runner's [budgets](#budgets). |
| `--help` | Print the usage text. |

The whole selected population is scanned in one Semgrep invocation, so
`--timeout-ms` bounds the whole scan. A scan that outlasts it fails with
`semgrep_run.timeout.v1` and names the budget and the number of targets; rerun
with an explicit larger value.

### Outcomes

| Exit | Status | Meaning |
| --- | --- | --- |
| 0 | `clean` | Every selected source was scanned and nothing matched. |
| 1 | `findings` | Every selected source was scanned; there are findings or invalid exceptions. |
| 2 | `incomplete` | Semgrep ran, but the result is not an audit: a source was not scanned or not fully parsed, a native error occurred, a source changed, disappeared or became unreadable during the scan, or the suppressed matches could not be established. |
| 2 | `failed` | No scan result: bad arguments, unreachable executable, refused report directory, a selected input that cannot be listed or read before the scan, timeout, output limit, invalid native output or unconfirmed cleanup. |

The first output line states the status and the counts, followed by the
executable and version, the source identity, the report paths, per-rule counts
and up to 40 finding lines. Diagnostics go to standard error in the seven-field
shape. The report holds every finding.

Findings are advice to review. The lint never edits a source, runs a test,
repairs the corpus or records current findings as accepted.

### Population

Root test sources come from the shared enumeration in
`tests/test-suite-classification.mjs`, re-run on every invocation, so a new file
is selected without a list to update:

- every file under `tests/`: unit and integration tests, helpers, fixtures and
  top-level support modules, including hidden and Git-ignored paths;
- every file under the package test directories listed in
  `PACKAGE_TEST_SCAN_ROOTS` in `tools/semgrep-test-lint.mjs`;
- every package `*.test.mjs` beside its source, selected by
  `isPackageLocalTestPath`.

JavaScript (`.mjs`, `.js`, `.cjs`, `.jsx`) and TypeScript (`.ts`, `.mts`,
`.cts`, `.tsx`) files are scanned. Every other input is listed in the report as
omitted, with a reason:

| Reason | Applies to |
| --- | --- |
| `data_file` | Data and binary formats such as JSON, YAML, Markdown and archives. |
| `unsupported_language` | Sources in a language no rule analyses, such as Python or shell. |
| `no_applicable_rule` | Anything else, including files without an extension. |
| `symlink_not_followed` | Symbolic links, which the shared enumerator never follows. |

An omitted file was not analysed. The lint makes no claim about tests written in
other languages.

Other test-shaped package paths — a `tests`, `fixtures` or `test-support`
directory outside the listed package roots, or a `.test.` or `.spec.` file that
is not a `*.test.mjs` — are listed as `uncovered` and are not scanned. They are
disclosed rather than classified by this tool.

The selected sources are passed to Semgrep by explicit path and reconciled with
the paths Semgrep reports as scanned. A selected source that is missing from
that list, reported as skipped, only partly parsed, duplicated, or an unselected
path that appears in it, makes the report `incomplete`. Semgrep 1.180.0 does not
analyse `.mts` or `.cts` files passed by explicit path, so such a file is
reported as not scanned.

### Rules

The rules are in `.semgrep/test-helper-rules.yaml`. Each matches syntax only: a
finding is a lead to review, never proof that a test is slow or that cleanup is
missing.

| Rule | Matches | Owner it points to |
| --- | --- | --- |
| `test-helper-process-call` | A call to `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync` or `fork` bound to `node:child_process` or `child_process`. | `tests/helpers/managed-test-process.mjs` |
| `test-helper-git-repository` | A repository created by hand: `git init` started by such a call, by a promisified one, by a managed process spec, or by a function in the same file whose body starts literal `git`. | `tests/helpers/git-test-fixture.mjs` |
| `test-helper-git-wrapper` | A private Git runner: a literal `git` start whose argument list is an identifier or contains a spread. One finding stands for every command the runner carries. | `tests/helpers/git-test-fixture.mjs` |
| `test-helper-git-call` | Any other literal `git` start with a fixed argument list, or a managed process spec whose command is literally `git`. | `tests/helpers/git-test-fixture.mjs` |
| `test-helper-temp-root` | `mkdtemp` or `mkdtempSync` bound to `node:fs`, `fs`, `node:fs/promises` or `fs/promises`, outside a recognised ownership idiom. | `tests/helpers/test-fixture.mjs` |
| `test-helper-preparation` | Literal `npm pack` or `npm install`, or a worktree created on a literal `slice/` branch. | `tests/helpers/prepared-publishing-fixtures.mjs` or `tests/helpers/committed-slice-review-fixture.mjs` |

Limits that apply to every rule:

- A binding is recognised from a literal import, `require` or dynamic import in
  the same file: named imports, aliases, namespace and default bindings. A
  same-named local function, a method on another object, a comment and a string
  literal do not match.
- A literal `git` start is reported by exactly one of the three Git rules and
  never by the process rule. A computed executable name is a process call and is
  never claimed to be Git.
- The Git rules also recognise a function made with `promisify`. A runner built
  on the Git test owner, such as a local function that calls `ownedGit`, is not
  a private runner, and `init` as a later argument, such as a commit message, is
  not repository creation.
- The temporary-root rule accepts two ownership idioms: creation inside a
  resource-scope `acquire` callback, and a `scope.add(label, () => …)`
  registration in the statement after the creation. Another legitimate idiom
  takes an [inline exception](#inline-exceptions).
- The preparation rule names only the two existing recipes. Calls to
  `packPublishingPackages`, `installConsumer` and the committed-slice fixture
  are compliant however often they repeat, because that preparation is already
  cached. Other setup is not claimed to be equivalent work.

Matches inside the owner a rule points to are that owner's internals. The report
lists them under `exempt`, not as findings. The process and Git owners are
`DESIGNATED_PROCESS_HELPERS` from the classification module; the others are
`TEST_LINT_OWNER_INTERNALS` in `tools/semgrep-test-lint.mjs`.

Each finding carries advice for where it was found. A root test is pointed at
the root helper. A source under `packages/<name>/` is told the helper's
responsibility and its package boundary instead, because a standalone package's
test environment does not include the repository's root `tests/` helpers.

The lint does not replace the checks in
[Test suite classification](test-suite-classification.md). An inline exception
never waives the designated-helper enrollment that page describes.

### Inline exceptions

An exception covers one rule at one site and states why:

```js
// test-lint-reason: this case measures a cold raw child on purpose
// nosemgrep: test-helper-process-call
const child = spawnSync(process.execPath, ["-e", "0"]);
```

- The `nosemgrep` comment sits on the line immediately before the site, or
  trails the site on its first line. Semgrep itself decides whether a site is
  suppressed.
- It names the exact rule IDs it covers, separated by commas.
- The line immediately before the annotated line is a
  `test-lint-reason: <explanation>` comment with a non-empty explanation.

A suppressed match that meets all three is listed under `suppressions.valid`
with its reason. One that does not is listed under `suppressions.invalid` with
the site and the exact correction, and the run is not clean:

| Problem | Meaning |
| --- | --- |
| `bare_annotation` | `nosemgrep` names no rule, which hides every rule at the site. |
| `unknown_rule_id` | A named ID is not an enabled rule. |
| `missing_reason`, `blank_reason` | The reason comment is absent or empty. |
| `annotation_not_a_comment` | Semgrep suppressed the site from text that is neither comment form above. |

An annotation that names only unknown rules suppresses nothing; the finding
stays visible and carries the correction. A neighbouring site, and any other
rule matching the same site, stay visible too. There is no file-level
exception.

Suppression facts come from the pair of native outputs, as Semgrep 1.180.0
writes them: `semgrep.json` lists the unsuppressed matches, and `semgrep.sarif`
lists every match and marks the suppressed ones. The lint requires the
unsuppressed SARIF results to be exactly the JSON results, by path, rule and
range. The marked SARIF results are then the suppressed matches, each of which
must name an enabled rule in a selected source. A suppressed match has no rule
metadata in the native output, so its `family` is `null` in the report.

If the SARIF is missing, unreadable, malformed or over its size budget, carries
a suppression marker of another kind, or does not reconcile with the JSON in
that way, the run is `incomplete` with
`test_lint.suppression_population_unavailable.v1`. Every JSON match is then
listed as a finding and the exception counts are unknown, not zero: the report
sets `suppressions.available` to `false` and `suppressions.valid`,
`suppressions.invalid` and the matching `counts` to `null`, lists each site
that did not reconcile under `suppressions.unreconciled`, and the first output
line reads `exception counts unavailable`.

### Report

One report directory holds:

| File | Content |
| --- | --- |
| `semgrep.json` | The native JSON output, complete. |
| `semgrep.sarif` | The native SARIF, the source of suppression facts. |
| `report.json` | The composed report. |

`report.json` records:

- `status` and `exit_code`, the command's arguments, and start, end and elapsed
  time;
- `tool`: executable, how it was resolved, and the version it reported;
- `rules`: each rule file with its SHA-256, and the enabled rule IDs;
- `source`: the repository root, every scanned file with its SHA-256 and size,
  a digest over all of them taken before the scan and again after it, the files
  that changed or became unreadable in between, and the Git `HEAD` with whether the scanned trees
  have uncommitted changes, or the reason Git could not say;
- `invocation`: the exact Semgrep arguments, working directory, budgets, timing
  and native exit code, signal and status;
- `population`: applicable, omitted and uncovered inputs with reasons;
- `coverage`: expected and scanned counts and every unreconciled path;
- `findings`, `suppressions.valid`, `suppressions.invalid`,
  `suppressions.unverified` and `exempt`, each with rule, path, position and
  source line, and `suppressions.available`, which says whether the exception
  lists and counts are known;
- `diagnostics`: every problem in the seven-field shape;
- `artifacts`: the paths of the files above, and any partial native output a
  failed run left.

### Sources that disappear

The report directory is prepared before the population is read, so a read
failure still has a report to land in. Each one is a
`test_lint.source_unreadable.v1` diagnostic naming the path and the native
cause:

- A directory that cannot be listed, or a selected source that cannot be read
  before the scan, fails the run: Semgrep is not started, and `source.unreadable`
  lists the paths.
- A source that is deleted, renamed or made unreadable during the scan leaves
  the run `incomplete`. The native output and every native match are kept. The
  source is listed under `source.unreadable_after_scan`,
  `source.sha256_after_scan` is `null`, and its matches carry
  `source_unreadable: true` with no source line. A match Semgrep suppressed in
  such a source is listed under `suppressions.unverified`, because its
  annotation and reason can no longer be checked.

A failed run still writes `report.json` when the report directory was usable,
with status `failed`, the diagnostics and what is known. If the report itself
cannot be written, the command says so, lists what the directory holds and exits
2.

The lint's own diagnostic classes are `test_lint.invalid_argument.v1`,
`test_lint.report_destination_refused.v1`, `test_lint.report_write_failed.v1`,
`test_lint.rules_unreadable.v1`, `test_lint.empty_population.v1`,
`test_lint.coverage_incomplete.v1`, `test_lint.source_moved.v1`,
`test_lint.source_unreadable.v1`,
`test_lint.suppression_population_unavailable.v1` and
`test_lint.native_status_unexplained.v1`.

## Ignore file

A `.semgrepignore` replaces Semgrep's built-in ignore patterns, and those
built-ins skip `tests/` and `test/`. The committed `.semgrepignore` lists
neither, so a directory target includes test sources. Files passed by explicit
path, which is how the test lint selects its population, are scanned regardless
of the ignore file.

## Writing rules

Rule fixtures live beside the rule file, with the same name:
`.semgrep/test-helper-rules.js` holds a `// ruleid: <id>` comment before each
line a rule must match and a `// ok: <id>` comment before each line it must not.
Run them through the shared runner:

```sh
node tools/semgrep-run.mjs test --config .semgrep/test-helper-rules.yaml --target .semgrep/test-helper-rules.js --output-dir <existing-empty-directory>
```

Four properties of Semgrep 1.180.0 shape the rule file:

- Write module specifiers literally in each import pattern. Semgrep then skips a
  rule on files that do not import the module, instead of matching every call
  against every import.
- Give every alternative of a rule a literal that a matching file must contain.
  Semgrep decides from those literals whether a file can match at all, by plain
  substring, before it parses the file. An alternative whose only pattern is
  generic, such as a call with any callee, defeats that for the whole rule. A
  condition inside `metavariable-pattern` does not count; state it as a pattern
  beside the `metavariable-pattern` as well.
- Do not use YAML anchors. Semgrep's rule validator does not resolve them.
- `metavariable-regex` is anchored at the start of the value.

The integration tests are in `tests/integration/test-lint-semgrep.test.mjs`. They
call the real Semgrep, taken from `SEMGREP_BIN` when set and otherwise from
`PATH`, and fail rather than skip when it is not reachable:

```sh
node tests/run-tests.mjs integration tests/integration/test-lint-semgrep.test.mjs
```
