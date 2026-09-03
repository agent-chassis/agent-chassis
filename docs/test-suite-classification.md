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

Preserved unchanged by the cutover: passthrough arguments to `node --test`,
explicit-file passthrough, the per-mode timeouts (30s unit backstop, 120s
integration backstop, overridable with `--test-timeout=`), and the hermetic
`HOME` / `XDG` / credential / agent-identity environment clamp.

The runner now owns process concerns only. It decides no categories.

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
