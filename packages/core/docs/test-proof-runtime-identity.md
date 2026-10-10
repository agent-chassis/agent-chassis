# Test-proof runtime identity

This document defines how saved semantic proof meaning becomes one exact runtime
verification. Authoring and validation do not execute code. The public
`verify_proof` operation owns execution.

The production `task-verify-proof.mjs` composition registers execution-only
`verify_proof`. Its closed schema accepts `{subject}` with optional
`source:{unit,focus?}`, `branch`, `git_sha`, `environment` and `timeout`; repository selection
is trusted host configuration. Existing orchestrator, worker and reviewer source
authentication, SDK cancellation and proof execution/settlement remain unchanged.

An orchestrator selects where proofs execute with at most one of `branch` and
`git_sha`. `branch` is a WK ID, a slice ID (`work record`, or `SLICE-001`
when the subject or `source` names the WK) or a canonical WK or slice branch
name. It resolves once, through the unit branch-naming owners and the
initiative of the WK's canonical record, to the commit that branch names, and
that commit executes exactly as a `git_sha` request does. The result names
both: `subject_binding.candidate_identity.resolved_branch` holds the selector,
the branch, its ref and the resolved commit, beside the commit and tree that
ran. A branch is how the commit was chosen and is not evidence of particular
bytes: it may move afterwards, so a later `branch` request names the commit it
selects then, while `git_sha` keeps naming one exact candidate. A selection
that names no existing canonical WK or slice branch refuses with
`verify_proof.execution_branch_unresolved.v1` and its reason
(`selector_invalid`, `slice_context_unavailable`, `initiative_unavailable`,
`branch_missing` or `branch_commit_unavailable`); the configured checkout is
never substituted. `branch` together with `git_sha` refuses with
`verify_proof.execution_source_conflict.v1`, and `branch` from a worker or
reviewer refuses with `verify_proof.branch_role_forbidden.v1`. With neither
selector an orchestrator request selects the subject's own branch the same way:
the slice branch of a slice subject and the WK branch of any other subject. It
refuses identically when that branch does not exist, and it never executes the
configured checkout. `source` selects authored proof definitions only and never
an execution branch. The selected commit supplies code only: the definitions are
current canonical authoring, captured once per invocation (see
[Exact-commit proof definitions](#exact-commit-proof-definitions)). `workspace_run_test` resolves its `{kind:"branch"}` source
through the same resolver.

Responses use incumbent bounded summary and diagnosis owners and retain complete
recorded originals without another execution. `get_run_result({result})` reads a
standalone original, optionally selecting a proof subject or authored source.
`get_run_result({assigned:true,recorded_invocation:{invocation_id}})` reads a
worker's recorded invocation with its original source. Stored producer/schema
identities remain unchanged. Reads are pure and preserve unavailable evidence;
execution retries use `verify_proof`, never a retained-read argument.

## Saved meaning

Contract requirements, proof definitions, cases, and obligation selections are
authored through
`save_record`. The server derives
stable identities and compiles native contract members through the package
owners. A caller supplies semantic inputs, not a carrier, graph, bundle, plan,
publication session, execution observation, or proof result.

Incomplete cases are valid drafts. Query returns the current saved case identity
and revision. Validation reports missing or invalid runtime semantics without
spawning a provider. A single later upsert can complete or correct the same
case under content-digest CAS.

The case target decides the provider family whose falsifier mechanics the save
derives: the target authored in the request, or the one an earlier save bound.
A falsification strategy never selects a family. A draft that states a strategy
and has no target keeps its mechanics unresolved. A strategy the target's family
does not implement is refused with
`obligation_coverage_case_falsification_unsupported`, which carries that
family's selector kind, the requested strategy and the strategies the family
implements, and nothing is saved. The save never substitutes another runner or
another strategy; a case whose family runs no falsifier for it declares
`falsification.support: "registry_unsupported"` instead.

A `test_execution` verification claim can also be saved with no stable proof
definition at all. Its meaning — verifier, observed proposition and falsifying
proposition — is complete without one, and authoring, query, restart and
implementation admission never resolve an evaluator, an installed executor, a
falsifier target or an executable catalog entry to accept it. Execution is the
owner of that gap: `verify_proof` refuses a claim with no binding, and
a claim whose binding exists still passes every strict check below.

Both workflows read that saved meaning through the same owners — the shared
proof contract in `packages/controlled-contract/lib/proof-contract.mjs` and the
saved-source owners in
`packages/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs` —
rather than through each other. Execution resolves the exact proof evaluator
itself, through `loadAdmittedProofPack` and `loadExactAdmittedProofPack`, with
their existing refusals unchanged; reads that need only a definition's meaning
use `loadAdmittedProofPackMeaning` and `loadExactAdmittedProofPackMeaning` and
resolve no evaluator.

## Runtime identity

A `test_execution` verification claim and its stable proof definition form one
runtime binding. The binding identifies:

- the verification claim;
- the repository-relative target module;
- the selector name and nesting;
- the system-under-test boundary;
- the observable and falsifier;
- the provider and evaluator versions.

The launcher derives the runtime test identity from the selected target and
selector. The reporter must mint the same identity for the observed event. A
passing sibling, file-level exit status, or unselected test cannot substitute
for the selected assertion.

Runtime binding preparation failures preserve classification separately from
diagnostic evidence. The modeled refusal keeps the binding operation and stage,
while its diagnostic evidence retains the original error message, stack, path,
metadata and arbitrary nested causes even when a cause code is unknown. That
evidence travels through the existing complete verifier response path; it does
not grant recovery or execution authority.

The same authenticated selection also governs execution. The attempt layer
passes its complete `{file, name, nesting, test_id}` selection to the registered
language executor; it does not reduce selection to an evidence identifier.
Each executor translates that value through its existing native selection
mechanism. The Node executor treats the saved name as literal data and applies
one exact name filter to candidate, every falsifier (including forced-invocation
discovery), and traversal execution. A selected top-level test runs with every
nested subtest it registers. Node also matches a trimmed ancestor-qualified name,
so a root sibling whose name differs from the selected name only by leading or
trailing whitespace is excluded by name; no descendant's qualified name has that
form. Module initialization and native applicable setup hooks still run, but
unrelated sibling bodies do not. If native selection cannot register or attribute
the exact saved identity, the existing missing or unobserved-test outcome applies
without whole-file discovery or fallback.

The Node reporter records the runtime test and parent identifiers Node reports
for each file and projects every outcome's test ancestry as stable identities.
Conflicting or cyclic runtime identifiers, such as identifiers reused by
separately isolated file processes, yield no ancestry rather than an inferred
parent. Ancestry is authenticated with the event transcript and is used only for
attribution; runtime evidence keeps each structured event in its closed form.

### Declared boundary traversal

The Node traversal provider collects native test coverage for exactly the
launcher-resolved system-under-test module. The dependency-failure and
forced-invocation providers scope coverage the same way to their declared
mutation module and, for forced invocation, its operation module. This explicit
inclusion replaces Node's default exclusion of test-like paths, so a declared
module under `tests/` or named `test-*.mjs` or `*.test.mjs` is observable.
`node_modules` remains excluded. Module paths are matched literally, and no
caller or environment value selects the coverage population.

A traversal is proven only when the selected test passes and native coverage
reports at least one executed function defined in the declared module.
Module evaluation itself is not a function execution, so an imported but
uncalled callable boundary stays `not_proven`. A module that defines no
function therefore cannot prove traversal through this provider. Node reports
one coverage count per function for the whole process, so a function the
declared module calls from its own top-level evaluation is counted the same
way as a call made by the selected test. A passing candidate, import presence,
or a detected falsifier never substitutes for that observation.

### Native provider runtime inputs

The pytest provider runs with the interpreter of the environment the shared
runtime resolution routes its target to, as an ordinary run of that target
does, and with the pytest requirement closure that interpreter's own
population provides. It has no interpreter or site population of its own, never
installs a package, searches another root, or accepts a caller executable,
environment, or mount. A fixed launcher-owned program locates that closure
before any selected body runs, under the invocation's execution budget.

Preparation that cannot resolve those inputs refuses with
`test_proof_native_runtime_unavailable`, and its detail names one failure class:

- `runtime_inputs_missing` lists each distribution or import package the
  interpreter does not provide, including the `packaging` distribution the
  closure walk needs. The runtime prerequisite is unmet; the operator
  provisions those inputs to the launcher, and no code change can.
- `runtime_interpreter_mismatch` reports that the program ran under a different
  executable than the resolved interpreter.
- `runtime_locate_failed` reports that the locate program did not complete,
  with its exit code, signal, spawn error code, and complete captured stderr.
- `runtime_locate_output_invalid` reports unreadable program output, with its
  captured stderr.

The last two classes identify a provider or interpreter defect rather than a
missing input. A missing interpreter refuses separately with
`test_proof_native_interpreter_unavailable`.

A target is configured when the repository publishes at least one environment
(see [Local test-runtime readiness](#local-test-runtime-readiness)) and a
Python environment owns the target, published or declared by the checkout, or
when the call names an environment (see
[Prepared environment routing](#prepared-environment-routing)).
A configured target uses exactly the routed environment's configured interpreter
and pytest population as they are now, instead of the
launcher `PATH` lookup; its read-only binds come from the same record. The
prepared runtime reports `runtime_source: "launcher_readiness"`, the record's
`readiness_digest` and the routed `environment`, and execution re-checks both
before each attempt. What setup measured earlier does not decide whether the
target runs (see [Local test-runtime readiness](#local-test-runtime-readiness)).
Inputs that can be
neither taken from the configuration nor located, or an interpreter that is
missing or not executable (`test_runtime_toolchain_executable_unavailable`,
`test_runtime_toolchain_executable_invalid`) refuses preparation with that
code; it never selects a different host interpreter
or site population. A repository that publishes no environment (no record, or
a record that is not authentic and is therefore never consumed) is resolved as
an ordinary run resolves it: the project the checkout declares is routed and
its inputs located, and a target no Python project owns is refused with the
ordinary run's own code.

Immediately before each run the provider measures the interpreter and the
runtime packages again and builds the run from the runtime as it is then
(`refreshInstalledPytestRuntime`). A change to the provider's own assets, or to
the routed interpreter path or environment, is refused, because those
authenticate what the run reports. A change to the interpreter's or the
packages' bytes, or to the environment's toolchain and dependency provenance,
is not: the run is bound to the current runtime-inputs digest and its run
facts carry `runtime_environment_observed`.

### Provider witness validators

Every credit-bearing falsifier and traversal mechanism a catalog provider
declares has exactly one provider-owned witness validator in the package
provider registry, keyed by artifact kind and mechanism:

| Artifact | Mechanism | Credit requires |
| --- | --- | --- |
| `falsifier_result` | `module_substitution` | the row's exact mutation, strategy and module; the selected test; a launcher witness identity; an observed, selected-test-only reach |
| `falsifier_result` | `python_scalar_return_substitution` | the substituted declared function returned a distinguishable replacement inside the selected call, setup passed and that call failed its assertion |
| `boundary_trace` | `node_test_v8_coverage` | the selected test passed and the declared module, at the row's seam, reported an executed function |
| `boundary_trace` | `python_call_trace` | a call-phase entry of the selected test into the declared module source with the same source digest |
| `falsifier_result` | `scalar_return_substitution` | the row's mutation and module; a distinguishable replacement; at least one launcher-credentialed entry of the substituted function inside the selected test's window; the selected test failed on an assertion |
| `boundary_trace` | `function_entry_probe` | the selected test passed and at least one launcher-credentialed entry of an instrumented function of the declared module source, with the same source digest, occurred inside its window |

Shared runtime-evidence validation only looks the validator up. A `detected`
falsifier or `proven` traversal whose linked launcher payload fails its
validator, or whose mechanism has no validator, is refused with
`runtime_falsifier_launcher_evidence_missing` or
`runtime_traversal_launcher_evidence_missing`. An unreached witness remains
valid evidence of a non-detection but never credits a detection.

Changing authored definition meaning creates a new definition generation. It
does not edit, reuse, or transfer an earlier execution result.

### Module-fault export identity

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
test run (see [Shared test execution](#shared-test-execution)). That run uses
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
path is never loaded. The confined run receives exactly that closure read-only
at its own paths; no other launcher or repository path is exposed. Test targets and
declared modules stay rooted in the authorized worktree. A missing or unreadable
asset fails the confined run itself: its original startup error, stderr, exit
status and execution facts are retained, and no proof credit results. The same
enumerated closure, with the provider's own module, is the provider asset
identity of a prepared node:test runtime; it is measured whenever that identity
is computed, so an asset changed after preparation makes the attempt's inputs
stale. Native providers mount and hash their observers' complete closures the
same way (the JavaScript observers and the Deno observer include the shared
diagnostic graph leaf; stestr and the pytest entry include the shared Python
diagnostic owner).

The AVA provider runs the project's installed AVA with the launcher's AVA
configuration factory as its explicit `--config`. The factory loads the
project's own configuration through that installed AVA's own configuration
loader (the package.json `ava` key or an `ava.config.*` file or factory, under
AVA's own discovery, conflict and validation rules) and overrides only `cache`
to `false` for the attempt. AVA then persists no failed-test cache under the
read-only installed `node_modules` and keeps any compilation cache in its
temporary directory; the consumer checkout and the installed dependencies are
never written. The same module is preloaded into AVA's main process and, before
AVA loads, points that process's `TMPDIR` at an `ava-tmp` directory inside the
attempt's own scratch root, so AVA's temporary files are removed with the
attempt. Once the project configuration is loaded it restores the sandbox's
`TMPDIR`, so the test workers AVA forks keep the sandbox's temporary directory;
the sandbox itself is unchanged. The factory is a provider asset, mounted
read-only and part of the provider asset identity. An installed AVA without its configuration loader
(`ava/lib/load-config.js`) makes preparation and attempts unavailable with
`test_runtime_runner_package_missing`.

Forced invocation shares the probe population, selection checks, ordered Inspector
witnesses, and configuration-derived identity. Its replacement statically imports
the probe and operation modules, wraps only the entry export, and re-exports every
other name from the probe URL, preserving names, object identity, live bindings,
and the original module instance. Module startup and selected-test registration do
not wait on the replacement itself.

The replacement validates the original entry when it evaluates. It looks up the
operation only on the first wrapper call. An operation module that imports target
data therefore links in an ordinary module cycle whichever module the test imports
first, including when the operation is a `const` export. This covers the static
cycle in which the target does not itself import the operation and the entry is
first called after module evaluation.

On that first call the replacement resolves the operation synchronously, before
Inspector setup, original execution, or any suspension. It captures the exact
original and operation functions that both invocation and the Inspector
breakpoints use, and takes the single injection claim in the same synchronous
step. The operation runs, without arguments, only after that first original call
returns successfully, and the caller receives the original result. A failed first
original consumes the opportunity. Later and overlapping calls run the captured
original with their own arguments and never inject again; an overlapping call can
still record an invalid-order witness and so earn no credit.

One validator checks both exports. A configured export that is absent, present but
not a function (including an exported `undefined`), a function with a different
name, or unreadable because its binding is not yet initialized fails with a message
naming the configured export and repository-relative module:

- ``Function `cleanup` does not exist in `operation.mjs`.``
- ``Export `cleanup` in `operation.mjs` is not a function.``
- ``Function exported as `cleanup` in `operation.mjs` does not have the required name `cleanup`.``
- ``Cannot read function `cleanup` in `operation.mjs`.``

An invalid original entry fails replacement evaluation, so the selected test is
not observed. An invalid operation fails the first call. That error, with the
binding's read exception as its cause, is retained: every later call rejects with
the same error without rereading the binding, so repairing a mutable export does
not revive the replacement. The failure also runs one private reason witness of
the launcher recipe. The contract owns a single frozen table of reason keys,
witness names, and message templates, plus the formatter that renders them; both
are part of the hashed mutation identity.

After the reporter transcript and the attempt's configuration, nonce, and recipe
identity authenticate, one reason witness makes the observation unavailable with
`test_proof_forced_invocation_export_identity_mismatch`. Its detail is only the
reason and the configured operation module and export, and it applies even when
the selected test caught the rejection. Witnesses for more than one reason are
unavailable as `test_proof_forced_invocation_identity_reason_inconsistent`. Either
way the falsifier ends as `test_proof_falsifier_execution_error`, never
`not_detected`, and earns no invocation or mutation credit. The runtime-evidence
refusal carries that closed identity, and the public Verify Proof failure detail
exposes it as `forced_invocation_identity_failure`, with the message regenerated
from the shared table. An unknown reason or any additional member makes the detail
unprojectable, and captured output is never passed through.

### Shared Node module-fault observation

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

## Parsed JUnit test results

`@agent-chassis/agent-launch-core` publishes one shared JUnit/XUnit XML report
parser at the explicit subpath
`@agent-chassis/agent-launch-core/src/lib/junit-test-result-parser.mjs`.
`parseJUnitReport(xmlText)` always returns a Promise. The package declares
`xml2js` `0.6.2` as a runtime dependency, so a normal installation of the package
provides it. xml2js is the only XML syntax owner: strict parsing, ordered
children, separate attributes, and no trimming, normalization, or value
coercion. The parser only interprets the resulting element tree.

A resolved result has exactly this shape:

```json
{
  "schema_version": "junit-test-results.v1",
  "suites": [
    { "name": "…", "suite_path": ["…"], "duration_seconds": 0.5,
      "stdout": [], "stderr": [] }
  ],
  "tests": [
    { "suite_path": ["…"], "name": "…", "classname": null, "file": null,
      "duration_seconds": null, "status": "failed",
      "diagnostics": [
        { "kind": "failure", "message": null, "type": null, "text": "" }
      ],
      "stdout": [], "stderr": [] }
  ],
  "counts": { "total": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0 }
}
```

- The root is `testsuites` or `testsuite`. A `testsuites` element is a
  container, not a suite. `testsuite` elements may nest, and `testcase`
  elements may appear directly under the root container, as Node's reporter
  emits them.
- `suites` lists every `testsuite` in document order, parents before children.
  A suite's `suite_path` ends with its own name. `tests` lists every `testcase`
  occurrence in document order, and its `suite_path` names every enclosing
  suite. Duplicate occurrences stay separate. The parser adds no identifiers
  and does no de-duplication.
- Names, class names, file paths, messages, and types are decoded XML attribute
  strings, kept literally. Empty and numeric-looking values stay strings, and
  paths are not normalized. A missing suite name, `classname`, `file`,
  `message`, or `type` is `null`.
- `time` is the only converted value. An unsigned decimal or scientific literal
  with a finite value becomes seconds. A missing, blank, signed, malformed, or
  non-finite value becomes `null`.
- Each `failure`, `error`, and `skipped` child becomes a diagnostic, in
  document order. Its `text` is the element's decoded direct text, including
  CDATA and untrimmed whitespace, or `""` when it has none. The status is
  `errored` if any error is present, otherwise `failed` if any failure is
  present, otherwise `skipped` if any skip is present, otherwise `passed`.
- `stdout` and `stderr` are ordered lists, one entry per direct `system-out` or
  `system-err` child of that suite or test. Output is never inherited from a
  suite by its tests or child suites, or passed upward.
- `counts` are computed only from the parsed `testcase` records. Summary
  attributes such as `tests` or `failures` are ignored. A valid report with no
  test cases has zero counts and yields no pass.
- Other elements are ignored as metadata when they contain no `testsuites`,
  `testsuite`, or `testcase` element. Otherwise the report is rejected, so no
  suite or test occurrence is silently dropped.

Rejections are `JUnitParserError` values with a stable `code`, a `detail`
object, and the underlying `cause` when one exists:

| Code | Condition | `detail` |
| --- | --- | --- |
| `junit_parser.invalid_input.v1` | input is not a string | `received_type` |
| `junit_parser.invalid_xml.v1` | malformed XML, no root, or more than one root | `reason`, `line`, `column` (1-based line; `null` when no position applies) |
| `junit_parser.invalid_report.v1` | non-report root, or a report element in an unsupported position | `reason`, `element`, `path` |
| `junit_parser.missing_test_name.v1` | a `testcase` without a `name` attribute | `suite_path`, `test_index`, `path` |

The module exports these codes as `JUNIT_PARSER_ERROR_CODES`.

Malformed XML is rejected with one exception, a known limit of xml2js and its
sax tokenizer. An element that repeats an attribute name is accepted, and the
first value is kept while later values are ignored. For example,
`<testcase name="a" name="b"/>` yields a test named `a`. This does not make
duplicate attributes well-formed XML. Multiple roots, text after the root,
undeclared entities, and every other malformed input are still rejected.

A parse does no filesystem, network, or process work. Document type declarations,
external DTDs, and entity declarations are never loaded or fetched. A reference
to a general entity other than the predefined XML entities is rejected as
malformed XML. Each call has
its own parser state, so calls do not affect one another.

A parsed report is only data. It is not authenticated proof evidence and carries
no execution provenance, runtime identity, or authority. Selected-test proof
execution and evidence remain owned by `verify_proof` as described
above.

## Canonical source and generation

The controlled-contract generation binds the complete selected carrier
population and its byte digests. Published carrier-set manifests select the
exact source location, logical filename, storage mode, generation, and content
digest for every member. A valid manifest is a read fence; malformed or
contradictory manifest state fails instead of falling back to an older root
copy.

The saved obligation source is the canonical owner of authored case meaning.
Native proof bindings derived from that source are a compilation product, not a
second caller-authored definition. Parent and slice obligations can share one
case identity. Removing one use preserves the shared case while another use
still refers to it.

A shared `node_test` case records its owning unit in `target.owner_unit`, and
only that unit's `acceptance.validation` declares its executable target.
Authoring validation and readiness in every unit that uses the case resolve the
declaration through that owner, so no unit needs a copy. Only the used
verification identities are projected, and sibling declarations are never
pooled. The resolution handles each problem case as follows:

- An owner with no declaration reports the target missing, even when another
  unit declares it.
- Any non-owner declaration beside the owner's, including an identical copy,
  is a duplicate and reports the target ambiguous.
- A dangling owner reports `validation_case_owner_unit_missing`, and an invalid
  owner declaration reports that owner's diagnostics.

Rebinding still refuses a verification declared by more than one unit.
Authoring visibility is not execution permission: a managed worker or reviewer
resolves executable targets only from its authorized unit's declarations, with
one exception. When the authorized slice's own saved source references a case
that the parent work record owns, and the slice declares no target of its own
for that case's verification, execution resolves that exact case's declaration
through the parent, using the same owner resolution as authoring:

- The selected slice, its source binding and its launcher-bound worktree are
  unchanged. The parent's declaration names the test; the slice's own checkout
  supplies the code that runs.
- Only the verification identities of cases the slice's source references are
  resolved this way. Other parent declarations, the parent's own obligations
  and source, and sibling uses of the same case remain unavailable to the
  slice.
- The slice needs no copy. A declaration the slice itself holds for that
  verification still resolves from the slice, and the parent is not read.
- A sibling's declaration beside the parent's is a duplicate
  (`verify_proof.declared_target_ambiguous.v1`). A parent with no declaration
  keeps `verify_proof.declared_target_missing.v1`, and a dangling owner refuses
  with `validation_case_owner_unit_missing`; none falls back to a sibling's
  declaration.
- The resolved declaration is part of the invocation's currentness check, so a
  declaration or reference that changes during the invocation refuses as stale.
- Verification and readback write no declaration and never change the case.

A case owned by a sibling slice is not resolved this way, and a reviewer's
frozen review binding is checked before any declaration is read.

## Exact candidate binding

`verify_proof` accepts a canonical proof subject. The server resolves
the corresponding saved population and binds execution to an exact candidate
commit and source snapshot. The source snapshot hashes the sorted repository
entries, entry kind, mode, and file bytes while excluding launcher metadata and
launcher-selected runtime infrastructure. Symlinks refuse because hashing a
link name does not authenticate the bytes an import executes.

Before each provider attempt, the launcher rechecks candidate and source
currentness. Movement invalidates the attempt population. Evidence binds the
subject, contract and source digests, case revision, proof identity, candidate
commit, source snapshot, provider, evaluator, and attempt.

### Exact-commit proof definitions

An orchestrator exact commit, whether named by `git_sha` or resolved from a
branch, supplies the code that executes and nothing else. The proof definitions
are current canonical authoring: the WK record and its complete contract inputs
as they are when the invocation starts. A commit that predates a slice, an
obligation source, a case or a contract generation is therefore verifiable
against them without another commit, and no authoring metadata has to be
committed for verification.

The subject's WK is located in current canonical authoring. The exact-commit
runtime then captures that WK's inputs once, through the definition-capture
core that findings review shares for its frozen design inputs, and supplies
them to the private materialization of the commit before any proof context
resolves: the WK record, the selected contract generation with its manifests
and members, the parent and slice obligation sources, the acceptance carriers,
and the related mapping contracts. Assignment entry material is review input
only: review resolves it on top of the shared capture, proof execution never
resolves it, and a material reference that does not resolve cannot refuse a
proof. The
commit's own copies of that WK's contract sources that current authoring no
longer holds are removed from the private checkout. Every other file keeps the
commit's bytes.

WK, slice, obligation and proof selection, `source` qualification, the
generation and a slice's parent-owned case all resolve from that one captured
set. Membership is never read from the commit's authoring metadata, so a
source saved after the commit is selectable and one removed since is not.
Source and generation authentication and the per-attempt currentness checks
run unchanged against the supplied files: one that moves inside the private
checkout refuses as stale. An authoring edit made after capture does not reach
the invocation or its retained result; a later invocation captures authoring as
it is then.

The result identifies the two separately. `subject_binding.candidate_identity`
keeps the `commit` and `tree` that ran, and its `captured_definitions` names
the origin `current_canonical_authoring` with a `definitions_digest` over the
captured record's source digest, every supplied file's path, digest and length,
and every removed path. The source snapshot binds the same identity as
`selected_definitions`, so receipts that carry the snapshot digest are bound to
both. The definitions are never attributed to the commit's tree. A configured
current worktree executes its own files and carries no captured definitions.

Missing current authoring refuses before any proof starts and names what is
missing:

- When the capture itself cannot complete, the refusal is
  `verify_proof.current_proof_definitions_capture_refused.v1`. Its `cause_code`
  is the capture owner's code (missing, malformed or moved), and
  `definition_source` gives the unit, the input path the owner named and the
  underlying cause. Nothing is materialized. The recovery is
  `author_or_repair_the_named_current_proof_definition_source_then_retry`.
- When the captured record names a unit whose obligation source was never
  saved, the refusal keeps `obligation_coverage_source_not_found`, and its
  `definition_source` gives that unit, the repository path where its source
  belongs and the filesystem cause.

Both publish `definition_source` in the diagnostic and in `recovery.facts`.
Saving the named source and repeating the unchanged call is the correction.

### Exact-commit runtime dependencies

An orchestrator `git_sha` request executes a private immutable materialization of
that commit. Before execution it verifies the package-owned compiled-validator
cache in read-only mode, and it refuses when that verification or the cache bind
plan fails. The verified cache is bound read-only at the materialization's
`.cache/controlled-contract/validators` for every exact-commit attempt, whether
or not an npm dependency projection is selected.

The npm projection of the configured repository's root `node_modules` is
selected, authenticated, and mounted as for findings review. When the root has
no `node_modules` entry at all, the request still runs if the materialized
commit declares no npm installation. This means the npm ecosystem owner finds no
dependency manifest input beyond `package.json`, and `package.json` names no
workspaces. Such an attempt mounts no projection and records
`projection_selected: false` with the reason `dependency_root_unavailable`.

The request refuses with
`test_proof_exact_candidate_dependency_projection_unavailable` in these cases:

- the commit declares dependencies and the root installation is absent;
- the root `node_modules` exists as a symlink, a nondirectory, or an unreadable
  entry;
- the npm owner cannot read the commit's manifest, in which case the refusal
  names `manifest_failure_code` and carries the original failure as its cause;
- any other projection unavailability or integrity failure.

A compiled-validator cache failure refuses with
`verify_proof.exact_candidate_dependency_projection_refused.v1`, whose
`cause_code` is the cache owner's original code; the complete original error is
retained for the operator. The refusal also names the exact candidate commit and
the cache location the refusing check reported. For
`validator_cache_containment_violation` the recovery is operator-owned and is
never an unchanged retry: `recovery.correction` names the operator as actor, the
requested subject, candidate commit and cache, the established effects (no proof
started; verification wrote nothing to the cache), the remaining uncertainty,
and the recovery steps: remove the writing repository's
`.cache/controlled-contract/validators` directory, or only the affected group's
directory named in the cache status `groups`, then rerun
`prepare-validator-cache.mjs` to regenerate it. The repository-only runbook
`the project documentation` ("Recovering a bad
artifact") has the details.
Verification never chmods, deletes or rebuilds the cache, and no agent tool
repairs it. Once the operator has corrected it,
`recovery.correction.verify_after_correction` names the later verification of
the same subject and commit.

A defect in the verification machinery itself is not the caller's to correct,
and verifying the unchanged proof again reproduces it. Its recovery keeps its
`action` and names `correction_owner` and `condition` (the failure's own code,
or the launcher observation code) instead of a `retry_operation`, and no root
next call re-executes the proof:

| Condition | `correction_owner` |
| --- | --- |
| `agent_launch.verify_proof.input_invalid.v1`, `test_proof_caller_executor_forbidden` | `verify_proof_server` |
| `agent_launch.verify_proof.attempt_context_failed.v1`, `agent_launch.verify_proof.attempt_execution_failed.v1` (when no deeper cause is recognized) | `launcher_verify_proof_execution` |
| `agent_launch.verify_proof.receipt_incomplete.v1`, `agent_launch.verify_proof.receipt_cross_bound.v1`, `test_proof_receipt_projection_invalid`, `test_proof_receipt_projection_digest_mismatch`, `test_proof_runtime_evidence_invalid`, `test_proof_artifact_untrusted`, `test_proof_evidence_identity_invalid`, the `test_proof_native_import_policy_unenforced` observation, and the provider registry's untrusted execution | `launcher_test_proof_provider` |

A later verification may follow that owner's actual correction; it is not the
immediate fix. Canonical proof-binding and provider-binding failures, selector
and native-source corrections, runtime setup and timeouts keep their existing
recovery, because their correction is the proof author's or the operator's
prepared runtime, after which verifying again is the right next step. The
standalone answer, the worker's recorded read and the coordinator's recorded
proof detail publish the same recovery, from the one recorded result.

### Managed-worker run identities

A managed worker has two distinct run identities.

- **Launcher binding identity.** The worker's commit credential names its
  identity-store slice binding: a launch ref, a `.slice`-qualified dispatch run
  id such as `wkdb_<16 hex>.slice`, and a retry id. The candidate context
  verifies that binding before minting the worker authority. The binding run id
  is held to the identity store's opaque-id grammar and kept exactly as issued
  on the retained managed authority.
- **Proof-run identity.** The published runtime-evidence schema requires
  `evidence_identity.run_id` to match `run-…`. The worker mint derives it as
  `run-worker-<sha256>` over the authenticated main repository, unit, launch
  ref, binding run id and worktree. The same authenticated worker always
  derives the same value, and distinct workers derive distinct values. The
  derivation represents identity that is already authenticated; it grants
  nothing.

The proof-run identity never replaces the binding identity or the dispatch run
id. Recorded explicit verification keeps the original binding identity and the
retained dispatch tuple beside the result. That result's receipts carry the
derived proof-run identity.

## Population and execution outcomes

The complete selected population is retained in the result. Missing targets,
invalid selectors, unavailable providers, and invalid relationships produce
their own reason-coded `not_executable` rows with zero execution credit; they
do not suppress independently eligible proofs. Eligible proofs run serially,
with exact execution-key de-duplication and currentness checks before and after
each attempt.

An obligation whose author explicitly declined proof (`proof_opt_out: true`) is
not one of those rows. It is accounted for by that decision, has no proof to
resolve or run, and is neither missing input nor a failure: it appears in no
`proof_results` row, no count and no diagnostic, and carries no
`missing_selection`. The result reports it in `proof_opt_outs`, present only
when the selected population holds one: the complete `obligation_ids` with
`accounting: "opted_out"`, `proofs_executed: 0` and `credit_granted: 0`; the
summary gives the same facts as `count` with at most sixteen identities and
`obligation_ids_omitted`. A mixed population keeps both: its selected proofs
run and are reported as usual beside the opt-outs. A subject that is only an
opt-out resolves no proof and answers `verify_proof.proof_population_empty.v1`
with that same fact, executing nothing.

An obligation whose saved case selects no proof is one of those rows. Its
reason stays `verify_proof.author_inputs_unavailable.v1`, with execution
`not_started` and zero credit, and its recovery
`select_a_proof_for_the_named_obligation_then_retry` carries a
`missing_selection` fact: the selection owner's original code
(`obligation_coverage_proof_unselected`), the owning obligation, the public save
field `proof.name` and that owner's explanation. The fact is read from the
resolver's retained diagnostic for that obligation, never from a message or
from the reason code, so any other authored-input failure keeps the generic
`repair_the_named_proof_prerequisite` recovery. The first answer, the selected
detail and every later read of the retained or recorded result report the same
fact for the same result; reading it executes nothing and changes no authoring.
The caller chooses the proof: the recovery names no proof, discovery query or
save revision. Its one call is the current read of the unit that owns the
obligation, offered only to a session whose registered reader serves that
authoring source. Any other session receives the same fact with
`verify_proof.authoring_acquisition_unavailable.v1` in place of the call and
gains no authoring route.

Once execution starts, the attempt engine runs the unchanged candidate and each
declared falsifier, observes the selected traversal, and emits authenticated
evidence. A selected assertion failure is an `unproven` result when the
structured observation population is complete. Spawn failure, timeout,
candidate movement, missing observation, malformed receipt, or unavailable
provider is `not_executable`.

The selected-test observation is the proof observation whether or not a
mutation can run. Mutation does not create a different proof category: when it
runs, it contributes additional falsification evidence for that same proof. The
public compact result presents the selected test's identity and
`selected_status` beside `mutation_evidence`; the full result also labels the
same selected outcome as `test_observation`. `selected_status` is the observed
event status (`passed`, `failed`, `skipped`, or another reported status), and
`not_observed` only when no selected-test event was recorded.

When the candidate run's authenticated Node event for the exact selected
identity reports the test skipped, the proof refuses at the candidate stage with
`test_proof_selected_test_skipped`. The selected test was observed and its body
did not execute: the proof is `not_executable` with execution `completed`, earns
no credit, and runs no falsifier or traversal stage. The refused result carries
that event as its typed `selected_observation`, so the summary row, the full
result's `test_observation` and the selected detail all say `skipped`; no
receipt is synthesized for it. The recovery is
`remove_the_selected_test_skip_then_retry`, and the complete observed population
stays in the recovery facts. A todo, a sibling's skip, or a skip seen by a
falsifier or traversal run is not the candidate's skip and keeps
`test_proof_selected_identity_not_observed`.

A later stage can refuse after the candidate stage already authenticated the
selected test. Once the candidate's observation is validated (the selected
identity observed, its run complete and its inventory present), the attempt
owner records the candidate's own event for the exact launcher-selected
identity, `passed` or `failed`, and a failure in a falsifier, traversal or
receipt stage carries it on its attempt observation as `selected_observation`.
A proof-local refusal publishes it as the refused row's typed
`selected_observation`, exactly as for a candidate skip, so the direct answer,
the population summary, the retained result's `test_observation` and the
selected detail all report the observed status. The refusal keeps its own
reason, stage and provider; no receipt is synthesized, nothing is read from
runner output, and the observation earns no proof credit: the row stays
`not_executable` and its mutation evidence stays `not_run`. An event of any
other identity, a candidate-stage refusal, or an attempt that recorded no
candidate observation publishes nothing, and the row says `not_observed`.

Every mutation member is classified by one pure owner,
`lib/test-proof-mutation-outcome.mjs`, which the semantic kernel, the runtime
assessment and the public presentation share:

- `detected` only when the runtime's authoritative falsifier outcome is
  `detected`; a failed selected-test event alone does not establish detection;
- `survived` only when a supported, isolated, actually observed mutation left
  the falsified execution passing while the original candidate passed: this is
  counterevidence for the selected proof;
- `unavailable` when the provider could not apply the mutation: a capability
  limitation, never a detection and never counterevidence;
- `unevaluable` for any other supported member (unreached mutation,
  non-isolated observation, unexpected failure reason, execution error, or a
  candidate that did not pass).

The row reports `not_run` when no mutation member exists, and otherwise the
status beside every nonzero member count, so a mixed population is never read
as one outcome. Failed or incomplete test execution remains separately visible
through `test_observation.execution_status`, the proof status, reason, and
diagnostics.

### Capability limitations

Whether the selected test runs depends on the test, its runtime, and the source
and authority checks, never on whether every additional proof check can be
applied. A check whose mechanism does not accept its declared subject reports a
capability limitation, and the attempt continues: the candidate result and its
artifacts stand, the remaining checks still run, and the limitation is published
beside the outcome rather than in place of it.

A limitation has exactly two origins, and neither is inferred from the other.
The saved binding may declare `falsification_provider: registry_unsupported`,
which states that this installation runs no falsifier provider for the proof; it
then declares no falsifier, and nothing invents one. Otherwise an installed
provider refused the declared subject at execution time and returned one of
`test_proof_native_instrumentation_unsupported`,
`test_proof_native_runner_unsupported` or
`test_proof_native_selection_unsupported`. Those three codes are the complete
provider-owned limitation set. Unconfigured runtimes, runtime inputs that moved during one attempt, spawn
failures, timeouts, confinement and authority refusals, missing or invalid
selected identities, and malformed observations are execution failures and keep
their own diagnostics; none of them becomes a limitation.

The pytest scalar-return falsifier (`launcher.pytest-scalar-return`) reports
its installed entry's refusal through the same set. A function shape its
substitution does not accept (`body_not_single_scalar_return`,
`return_not_scalar`, `async_function_unsupported` or
`decorated_function_unsupported`) is `test_proof_native_instrumentation_unsupported`
with that reason only when the authenticated envelope shows the refusal in
prevalidation: no pytest session, collection, phase or compilation ran, the
refusal names the bound module, function and replacement, and its source digest
is still current. Every other refusal of that entry stays
`test_proof_python_fault_unsupported`, a falsifier execution failure, whatever
reason it carries: an absent or ambiguous function (`function_absent`,
`function_not_unique`), a malformed or restated replacement, an absent or
unparsable module, and source that moved after prevalidation, which the entry
reports as `module_source_moved` rather than by the moved source's shape.

A refused falsifier keeps its declaration and records `provider_support:
unsupported`, `falsified_status: not_run`, `isolated: false`, unobserved
mutation and `status: review_only`, with no evidence artifacts. A refused
traversal records `provider_support: unsupported`, no observation seam,
`authenticated: false` and `status: review_only`; the registry-declared
traversal keeps its own launcher-authenticated attestation and carries no
limitation. Evidence carries the whole population in `capability_limitations`,
each member naming its check and its reason; a falsification the binding never
declared names no check identity. The semantic facts carry per-check
availability, and the public summary reports the distinct reason codes beside
the selected test's `selected_status`.

A limitation records an absent observation and never supplies the credit of the
check it replaces. For mutation, it also withholds nothing: a proof whose
selected test passed, whose mutation was unavailable, and whose other required
checks hold is `proven`, and its row reports mutation evidence as `unavailable`
with the limitation codes. Mutation unavailability alone supplies no retry,
waiver, installation or repair instruction. The limitation never excuses an
actual survivor elsewhere in the same population: every available member is
assessed individually, and one survivor makes the proof `unproven`. A failed
selected test is `unproven` for its assertion, with its diagnostic, and gains no
mutation counterevidence from falsifier rows that observed the same failure.

For a passing candidate, a declared falsifier missing from the population, a
provider-mode binding with no falsifier, or a supported member that is
`unevaluable` leaves that relationship reason-coded `not_executable`
(`verify_proof.falsifier_evidence_not_evaluable.v1`, with
`verify_proof.falsifier_population_incomplete.v1` or
`verify_proof.falsifier_outcome_unevaluable.v1` diagnostics carrying the
recorded facts). The semantic kernel returns that result instead of reaching
the exact evaluator, and the proof row still reports the observed selected
test. Incomplete evidence is neither credit nor counterevidence. The exact
evaluator refuses such facts rather than judging them.

The runtime-evidence validator requires each unsupported falsifier row and its
member of `capability_limitations` to agree on check identity, reason and detail
(`runtime_falsifier_limitation_incoherent` otherwise), and the semantic kernel
requires exactly one identity-less falsifier limitation for a
`registry_unsupported` binding and none otherwise. Malformed, corrupted,
mismatched, cross-bound or duplicate evidence keeps refusing through those
authenticity checks; it is never read as a limitation or as incomplete evidence.

A provider that refuses a declared check under a code outside that set still
fails the attempt; its classification is the provider's. Its recovery is
attributed by the refusal's adapter reason. When a falsifier or traversal stage
refuses a legal source shape its mechanism does not accept
(`body_not_single_scalar_return`, `return_literal_unsupported`,
`return_not_scalar`, `function_not_synchronous`,
`async_function_unsupported` or `decorated_function_unsupported`), the recovery
is `report_the_launcher_provider_check_shape_limitation` with
`correction_owner: launcher_test_proof_provider`, the reason as `condition`
and no retry. Its facts name the affected `check` (kind, identity and declared
module and function), the stage, the provider and the refusal code and reason.
It never asks for the working source to be rewritten, an obligation removed or
unchanged input retried. An absent or ambiguous target, a malformed
replacement, unparsable source, a candidate-stage refusal, a runtime failure and
an authority refusal keep their own recoveries.

Traversal limitations are unchanged: a proof whose traversal was limited stays
unmet on that evaluator axis. A typed, attributable proof-local attempt failure
may leave that row unavailable and permit a later sibling. Candidate/source or
generation movement, receipt authentication or cross-binding failure,
confinement/authority failure, and unknown or unprojectable causes are shared
failures: they stop the invocation and preserve their owning error.

Every structured failed event carries a versioned launcher diagnostic
(`launcher-test-failure-diagnostic.v1`) captured from the runner's original
failure at its native boundary. It preserves available error name, message,
code, and stack; assertion expected, actual, operator, and generated message
state; and nested cause and aggregate-error relationships. Assertion values use
explicit graph records, so shared references, cycles, array holes, `undefined`,
bigint, non-finite numbers, typed bytes, and supported built-in collections
remain distinguishable. Accessors and unsupported or unreadable values are not
invoked or silently omitted: the diagnostic records an unavailable value and a
source-path issue.

The graph has one closed shape for every provider family. Beside those fields an
error may carry the native source `location` (file, positive line and, when the
runner supplies one, column) and `native_details`: labelled, runner-formatted
display text such as a diff. Display text is never parsed into typed operands;
typed `expected` and `actual` appear only when the runner hands the values over.
The graph may name the failure's native `origin` (`hook`, `step`, `subtest`,
`phase` or runner `condition`, with its native name). An absent error, a capture
over the graph's 256 KiB ceiling (large values are dropped first) and a native
report that could not be read or attributed stay explicit issues
(`error_not_supplied`, `capture_budget_exceeded`, `native_report_unreadable`,
`native_attribution_unavailable`). There is no metadata bag.

One JavaScript owner (a CommonJS leaf the node:test reporter's diagnostic
module, every JavaScript observer and the generated Deno observer load) and one
Python owner (loaded by the pytest entry and the stestr observer from its
installed path, without changing `sys.path`) capture and validate the graph.
Each provider maps only facts its runner supplies natively:

| Family | Diagnosis |
| --- | --- |
| node:test | the reporter's original error graph; for a file that failed before the selected test was observed, the uncaught exception report the file's own Node process printed |
| Jest | circus's original error; `matcherResult` operands and matcher name; the failing hook |
| Vitest | the task or suite error; Vitest's formatted operands and diff as display details; a suite hook |
| Mocha | the original error, captured before Mocha's base reporter formats its operands; the hook title |
| AVA | the original error from the worker's serialized report, AVA's assertion name, source location and formatted details |
| lib0/testing | the caught original exception |
| Deno | the thrown error and its failed step; a step Deno failed without an exception supplies no error; a selected module's original import or startup error as the run's runner-level error; Deno's type-check diagnostics (module resolution included) for a run that failed before any module ran |
| pytest | the phase's original exception, cause and exception-group members, located at the deepest frame pytest does not hide; a failed collector's original exception |
| stestr | unittest's exception and failed subtest, located at the deepest frame unittest does not hide; an unexpected success is its own condition |
| go test | a recovered panic, or Go's typed report error records of the selected test and its subtests |
| cargo test | the panic payload and `PanicHookInfo` file and line; Cargo's structured compiler errors for a build that never reached a test |

Go writes a failed test's messages only to its own test report, so the go-test
provider runs `go test -json` and reads the report while the confined capture
drains it, before head/tail elision. Only records the toolchain types as
errors (`OutputType` `error`, continued by `error-continue`) become the
diagnosis, with the `file:line` prefix Go wrote for them. Logged output, frames
and untyped output never do. A toolchain that writes no typed records (older
than the typed report, for example Go 1.24) gets no attribution: its diagnosis
carries `native_attribution_unavailable`, and its selected outcome is
unchanged. Such a toolchain decorates `t.Errorf` and `t.Log` through one
formatter, so a lone failed assertion and a log followed by `t.Fail()` write
the same report, and no `file:line` prefix makes either one a cause. Cargo
runs with `--message-format=json`; only `compiler-message` errors' structured
message, code, primary span and child messages are read, never rendered text.
Rust locations name the file and line only: instrumentation preserves each
source line but not columns, so a native column would describe the working
copy rather than the author's source. Report framing is bounded per line; an
oversized line or a failed adapter marks the report unreadable while draining,
capture and exit facts continue.

node:test runs each file in its own process and reports a file whose process
failed as one generic wrapper failure (`ERR_TEST_FAILURE`, "test failed"); the
exception that ended the process exists only as the report that process
printed, which the default reporter writes to stdout. The node-test provider
reads that report while the confined capture drains stdout, before head/tail
elision, and the run carries it as its cause when the file wrapper failed with
a nonzero exit and the selected test was not observed. The cause is diagnosis
read from printed text, never a captured error: it has the origin `condition`
`uncaught_exception`, the name, message and code Node printed, the throw site
or first frame inside the checkout as its location (repository path and line,
with the column when a frame names it), and the error's own printed scalar
properties (for example `syscall` and `path`) as labelled details. It has no
call trace and no captured values. A printed cause or aggregate member is not
rebuilt; it is the issue `native_report_unreadable` at `/native_report/cause`
or `/native_report/aggregate_errors`. The structured wrapper event is
unchanged beside it. A report that never reached Node's version line, a thrown
value that is not an error, a property block that never closed and a line the
framing dropped each carry `native_report_unreadable`; a message over 8 KiB, a
report over 256 lines and more than 16 properties (or one over 1 KiB) carry
`capture_budget_exceeded`; a failed file that printed no report has an
unavailable cause with `error_not_supplied`. The last report the stream
terminated is used, so a test that prints report-shaped text before its own
process dies cannot replace it. A file that did not fail has no startup cause,
whatever it printed, and a run that captured no report gains none later.

Diagnosis is never proof authority. It never selects a test, changes a passed,
failed, skipped or execution status, or earns assertion, reach or mutation
credit, and an expected falsifier failure is not candidate repair advice. A
report's diagnosis applies only to a failed selected test whose observer
captured no error of its own, to a build that wrote no observer record, or to
a node:test file whose wrapper failed before the selected test was observed. A malformed graph on an observed record refuses
the record stream like any other malformed record.

Candidate, falsifier, and traversal observations link to their existing
authenticated structured-result artifacts. The compact verification summary
does not inline diagnostic payloads. It does carry each retained proof's
selected-test identity and observation, its mutation-evidence state, and the
actual evaluator diagnostic codes of each unproven relationship. The complete
settled result is retained once and named by `result: {ref_id}`;
`verify_proof` with that `result` reads it without rerunning the
proof, and a proof or obligation subject within it returns that proof's
selected diagnosis. The public ranged content reader refuses those retained
bytes and returns that read instead.

A launcher preparation, candidate, falsifier or traversal execution failure
carries two run records. `run` holds only the bounded public facts the refusal
projection accepts (ran, disposition, exit code, signal, timed out, blocker
code, output truncation, a spawn failure's stable code, a refused native
record's compact context, a source-instrumentation refusal's adapter `reason`
and selected `test`, and the run's original cause as a validated diagnostic
graph). One launcher-owned pure helper validates those facts for both the
launcher and the public refusal projection, which publishes the cause through
the same selected diagnostic projection as a failed test. The cause is the
original error of an observer runtime error (for example a Jest or Vitest
startup failure), of a pytest
runtime error, a native build failure, a node:test file's printed uncaught
exception, or the first runner-level error (with their count) of a run whose
selected test was not observed or whose exit status disagreed with it. Preparation runs nothing, so it is never a captured stage;
a preparation that could not bind its runtime identity reports
`execution_stage: preparation` with the readiness or routing code and no run.
A run's native facts are the process's own, whatever its proof evidence turns
out to be: `ran`, its exit status, signal and output, `ok` and a disposition
of `passed` or `failed` decided by the exit alone, and a blocker only for the
execution budget's own interruption or a cleanup that could not be confirmed.
A proof observation that is missing or refused is reported beside them
(`test_proof_observation.valid: false` with its code, published as
`structured_observation_code`): it establishes nothing and earns no credit,
and it never turns a run that exited 0 into a failed one. `not_run` means the
process never executed, including a stage the shared run refused or whose
native selection it could not resolve; such a stage carries that exact code
as its blocker and no observation.
The failure also names the resolved provider of the failing stage. The proof
result then reports `execution_status: completed` (or `interrupted` when the
run's own timeout stopped it) with status `not_executable`; only a failure
with no executed run reports `not_started`, and `execution_not_started`
counts only those. A completed candidate says nothing about later falsifier
or traversal stages; the failed stage stays in the facts. `captured_run` holds the complete captured run, including the
attempt's stdout and stderr (head-and-tail bounded by the capture's own output
bounds), normalized argv, timings, cleanup outcome, the observation envelope
and `runner_execution`: the harness, native selection and command the shared
run composed, and each selection command with its outcome.
The reporter and observer protocols never travel on either stream (node:test
writes its report to a file of the run's own scratch, native observers to their
channel file, pytest to a descriptor the shared executor's driver relays), so
test output stays diagnostic-only and cannot select authenticated evidence.
node:test hands the tests' own output to its reporters, so its default reporter
keeps writing that output and the native results to stdout, where it is
captured. `captured_run` is never
read by the public projection; it survives only inside the captured evidence
below, including when the execution budget relabels the failure as an
interruption.

Every attempt also keeps one attempt observation: the prepared
`runtime_environment` that ran it and each stage it reached (`preparation`,
`candidate`, each `falsifier` with its falsifier identity as `check_id`, and
`traversal` with its boundary identity), in order, each tagged with the provider
that ran it and carrying that stage's complete captured run exactly once. A
completed attempt returns it beside its authenticated evidence, and the
verifier records it on the proof result as `attempt_diagnostics`, encoded by
the same diagnostic-evidence serializer (the proof's `runtime_environment` is
named there as a published field rather than repeated). A failure after the
attempt started, whether in source currentness, preparation, a later stage,
inventory, identity, runtime currentness, budget, or receipt check, keeps the
observation collected so far, including its sealed `timing`, on the original
thrown value as `attempt_observation`: its code, detail,
message and cause are unchanged, and it is retained through the captured
evidence below. The observation travels with the one attempt whose receipt is
bound to the same target and verification; it replaces the environment-only
pass-through, and the public `runtime_environment` is projected from it.
Diagnostics never grant proof credit, select an identity, or change an outcome:
runner output is never parsed into assertion facts, and the structured
per-test error remains the authenticated observation's `failure_diagnostic`.
An unproven proof's selected diagnosis presents its captured error and
location; its call trace and cause chain stay in the retained result and are
named as retained, and its expected and actual operands over 256 bytes are
named as deferred rather than inlined. The runner's own output stays in the
retained result's `attempt_diagnostics` and is not part of the public answer.

Native capture is bounded at its source. Each captured stream keeps its head
and its tail within the configured caps (by default 262,144 bytes per stream:
one quarter head, the rest tail less a small marker reservation) and elides the
middle with an accounted marker. The bound protects the supervising launcher from unbounded process
output; it is the native capture's resource boundary, not an MCP delivery limit.
No complete middle output exists anywhere, so discarded middle bytes are not
recoverable. Every stage keeps `output_truncated`, `output_elided_bytes` and
`output_bounds` beside its streams, and a truncated capture is never presented
as complete output. Everything after capture is lossless for the captured
value: retention and serialization reproduce it exactly, and the retained
result is read back through its `verify_proof` result read.

A modeled proof refusal captures the original thrown value before it classifies
the cause chain. The complete retained original carries that capture at the
first diagnostic node's `details.evidence`; public selected diagnostics keep
the semantic cause and omit the captured graph and raw output. Its format and completeness rules are the existing
[`agent_launch.diagnostic_evidence.v1` contract](mcp-dispatch-runtime-contract.md#launcher-transition-failure-contract),
also described for launcher failures in
[Launch and admission](mcp-dispatch-launch-and-admission.md). Encountering an
unknown cause stops semantic classification but does not erase an already
recognized refusal or its captured cause graph. It also does not grant proof
credit, execution eligibility, proof-local continuation, or a recovery action
for the unknown cause.

The ordinary proof-result retention and MCP response owners store that JSON
evidence unchanged. `get_run_result` reads the retained proof original through
the authenticated selected-response class, without byte ranges or reassembly.
Retained refusal readback uses the same stored result and never reruns the provider. Carrier-generation member failures name the exact filesystem
operation, `filename`, path, and caller-supplied generation context in the
classified details, while their native exception remains in the captured
evidence. Generation identity is supplied by the manifest owner and is never
inferred from directory layout.
The reporter's fixed 2 MiB authenticated-envelope bound remains an explicit
`test_proof_structured_events_oversized` nonexecution result; diagnostics are
never clipped to fit it.

The public aggregate, each proof row and each obligation relationship use
`proven`, `unproven`, or reason-coded `not_executable`: any unproven row wins,
then any not-executable row, and only a nonempty entirely proven population is
proven. The exact evaluator's internal result keeps its `satisfied` /
`unsatisfied` vocabulary; the public projection converts freshly produced
results once, before summary, retention and delivery, and `counts` reports
`proven` and `unproven`. These outcomes describe the requested proofs against
the tested source only. Results are advisory and grant no lifecycle,
dispatch, admission, integration, completion, or CCE authority.

Recovery names only what the evaluation diagnosed. An unproven proof carries its
evaluator diagnostic codes, subject, effect, responsible actor and the
verification of a corrected source; a relationship whose evidence could not be
evaluated names its reasons and the complete evidence with no retry of unchanged
inputs; a producer-supplied correction (a definition repair, a larger timeout)
is published as supplied. No projection adds a retry the producer did not name.

Retained results are historical evidence: they keep their recorded statuses,
evaluator identities and diagnostics, and are never relabelled, re-evaluated or
recommended for rerun merely because a later definition exists.

### Verification timing

`verify_proof` reports coarse, monotonic timing for each execution
and for the invocation. It is diagnostic evidence beside the authenticated
proof evidence: it never enters a runtime receipt, the semantic evaluation,
proof credit, a source or cache key, a nonce, or the
execution budget, and it changes no status, cause, cleanup order or selected
body count. Elapsed differences come from `performance.now()`, stay unrounded
until a measurement is sealed, and are then rounded once to whole
milliseconds. The one wall-clock value is the invocation's UTC `started_at`,
kept only to correlate it with other intervals. The fixed shape and arithmetic
live in `packages/agent-launch-core/src/lib/test-proof-timing.mjs`.

The attempt owner seals `attempt_observation.timing` with the observation, on
a returned attempt and on every failure path, including a cooperative timeout
or cancellation:

| Member | Meaning |
| --- | --- |
| `state` | `measured`. |
| `elapsed_ms` | From after attempt-context authentication, before source-currentness validation, until the observation is sealed after every reached stage, the final release and the final checks. Receipt construction after that belongs to invocation time. |
| `preparation_ms` | Inclusive time of the provider's runtime preparation: resolving the runtime as it is now and binding its identity. Preparation executes nothing. A preparation that was never reached adds nothing. |
| `stage_work_ms` | The sum of the actual candidate, falsifier and traversal provider calls: runtime resolution, the runner's own selection commands, instrumentation, any source copy, process startup, compilation and linking (with whatever the native compiler cache supplies), test execution, observation and stage-local cleanup. It is not test-body time. |
| `cleanup_ms` | The first explicit final release of the prepared runtime. Cleanup already inside preparation or a stage is not counted again. |
| `other_ms` | `elapsed_ms` minus the three phases above: unexplained attempt time, not an inferred cause. |

Timing never claims a compiler-cache hit or times cache work separately; what
a native compiler reused is visible only in that tool's own output.

The verifier assigns each attempted execution, at its existing `execution_key`
deduplication boundary, a 1-based invocation-local `execution_index`. Each
proof row carries `timing`: its execution's index and measured values
(`state: "measured"`), `{state: "unavailable", execution_index}` for a started
execution with no sealed observation, or `{state: "not_started"}` for a proof
of an executed population that never started. A population refused before
execution (no eligible proof) carries no row timing; its invocation accounting
covers zero executions. A timing-bearing observation on an interrupted or locally
unavailable execution is kept. Rows
sharing one execution share its index and values.

The tool seals the invocation's `timing` after the execution settles,
including runtime release and budget disposal, and before projection,
retention, journal publication and transport. It is included in the retained
result and its `result_digest`:

| Member | Meaning |
| --- | --- |
| `measurement` | `server_verification`: not the full RPC and not whole-worker time. |
| `started_at`, `elapsed_ms` | The UTC anchor and the monotonic elapsed time from after the retained-read branches, before production runtime and source setup, until settlement. |
| `measured_execution_count`, `unmeasured_execution_count` | Distinct executions with and without a sealed attempt timing. |
| `distinct_attempt_ms` | The sum of the distinct measured executions' attempt elapsed time; each execution is counted once, never per proof row or relationship. |
| `preparation_ms`, `stage_work_ms`, `cleanup_ms`, `attempt_other_ms` | The same sums per phase. |
| `invocation_other_ms` | `elapsed_ms` minus `distinct_attempt_ms`: runtime and source setup outside attempts, proof selection, context, receipt, evaluator and currentness work, and any unmeasured attempt, not attributed to a cause. |

`elapsed_ms` equals `preparation_ms + stage_work_ms + cleanup_ms +
attempt_other_ms + invocation_other_ms`, and each attempt's `elapsed_ms`
equals its four disjoint phases, within 1 ms per rounded term
(`TEST_PROOF_TIMING_ROUNDING_TOLERANCE_MS`). A modeled refusal carries the
invocation `timing` with `started_at` and `elapsed_ms`; it binds no proof rows,
so its execution accounting is null rather than zero. Timing makes each
invocation's retained result distinct: a repeated identical call has its own
`timing`, `result_digest` and record identity.

Measurement limits: a SIGKILL, hard launcher timeout or crash before
retention may leave no timing, and none is persisted at crash time; there is
no heartbeat. A pending call has no measured duration. Final projection,
retention, journal publication and MCP transport are outside the
measurement, so comparing it with a whole-worker interval leaves an
outside-measurement remainder that is not thereby model work. Timing does not
distinguish compile or link work from test-body time inside stage work, and
no work is rerun to obtain or recover a timing.

## Restart and repeatability

Query after restart resolves the same canonical case identity, case revision,
contract inputs, and obligation map. Verification of the same saved map against
the same exact candidate preserves source and candidate attribution. A changed
candidate creates a fresh proof instance; historical verification can select an
exact permitted commit and remains bound to that commit.

Runtime evidence is not a universal replay ledger. A later verification call
authenticates its own complete population and candidate facts.

Diagnostic values are public evidence data. A `structured-diagnostic.v1`
carrier is validated by its schema owner (a malformed carrier is refused) and
its original semantic value, string or object, is published and retained
exactly, whatever sensitive values its producer declared; the verifier's
`diagnostic_redactions` list is therefore empty. The generic MCP error
boundary and the dispatch exception projection use the same owner and publish
the same original. A source-snapshot symlink
refusal names its validated source-relative `path`. No field-name heuristic
suppresses assertion messages, stacks, paths or values; raw process output
stays out of the public answer under the delivery contract above.

## Native provider families

`verify_proof` is the only public route that executes a saved test.
Every proof provider belongs to one package provider family, and every family
supplies exactly one provider per capability: candidate execution, falsifier
execution and boundary traversal. A family owns its closed native selector
grammar, its source suffixes, its runtime runner, and the witness validators
for the mechanisms it declares. The composed catalog is registry `1.3.0`; its
capability snapshot digest covers every family.

| Family | Runner | Languages | Selector (`node_id` after `<path>::`) | Candidate mechanism | Traversal seam |
| --- | --- | --- | --- | --- | --- |
| `node-test` | node:test | JavaScript | test name and nesting (`node_test_name`) | `node_test_structured_events` | `node_test_structured_assertion` |
| `pytest` | pytest | Python | pytest node id | `pytest_phase_events` | `pytest_selected_call` |
| `jest` | Jest | JavaScript, TypeScript | JSON title path | `jest_circus_events` | `jest_selected_test_body` |
| `vitest` | Vitest | JavaScript, TypeScript | JSON title path | `vitest_runner_tasks` | `vitest_selected_test_attempt` |
| `mocha` | Mocha | JavaScript, TypeScript | JSON title path | `mocha_runner_events` | `mocha_selected_test_body` |
| `ava` | AVA | JavaScript, TypeScript | JSON array of one test title | `ava_worker_events` | `ava_selected_test_body` |
| `deno` | deno test | JavaScript, TypeScript | JSON array of one test name | `deno_test_registrations` | `deno_selected_test_body` |
| `lib0-testing` | lib0/testing | JavaScript | JSON array of suite and `test*` export name | `lib0_test_registrations` | `lib0_selected_test_body` |
| `stestr` | stestr | Python | `Class.method` | `stestr_unittest_results` | `stestr_selected_test_method` |
| `go-test` | go test | Go | top-level `TestName` | `go_test_function_probe` | `go_selected_test_function` |
| `cargo-test` | cargo test | Rust | `::`-joined test path | `cargo_test_function_guard` | `cargo_selected_test_function` |

A JSON title path is the canonical compact JSON array of one to 32 literal
titles, outermost suite first. Paths are normalized and repository-relative.
Authoring admits any module path within the definitions schema's own module-path
grammar and refuses one outside it with `stable_contract_schema_invalid`:
`repo_module_path` is `.cjs`, `.js` or `.mjs`, the native selector and mutation
arms take the eleven-suffix table, and a `module_substitution` mutation path is
`repo_module_path`. What authoring no longer asks is whether a path ends in one
of the SELECTED family's source suffixes. That is an execution fact about the
provider that will run the proof: `verify_proof` resolves it and
reports an incompatible falsifier or system-under-test module with
`verify_proof.test_proof_binding_source_path_incompatible.v1`, naming each
pointer, its path and the family's suffixes. node:test and pytest keep the
providers and mechanisms described above. The other nine families use
`scalar_return_substitution` for `result_inversion` falsifiers and
`function_entry_probe` for module traversal.

### Authoring facts

Each credit-bearing falsifier mechanism also has exactly one target constraint,
declared beside its witness validator and composed by the registry, which
refuses a family whose credited mechanism has none or two mechanisms with
conflicting constraints. The constraint states the target and source shape the
launcher adapter accepts, the stable refusal code
(`test_proof_native_instrumentation_unsupported` with an adapter reason for
source instrumentation, `test_proof_forced_invocation_export_identity_mismatch`
for Node forced invocation) and that the shape is checked only when
`verify_proof` runs the attempt. It describes the check; it never
performs one.

The registry publishes one authoring-facts projection per installed family:
identity terms (family, runner, ecosystem, languages and toolchains), selector
kind and `node_id` form, source suffixes, the installed provider of each
capability, and the falsifier's strategies, mechanism and target constraint.
Proof discovery uses the identity terms to recognize provider context, and the
case-authoring guidance of the obligation-coverage upsert is projected from the
same facts. Neither adds a provider, a language or execution support.

### Shared test execution

`workspace_verify_proof` is `workspace_run_test` plus proof evaluation. Every
test execution of a proof attempt -- the unchanged candidate and each
falsifier and traversal stage, for every family -- is one run of the same
owner an ordinary test run uses
(`test-execution/ordinary-test-runner.mjs`), and proof evaluation consumes
what that run settled. For both tools that owner alone:

- resolves the runtime as it is now, routing the target to its published
  environment or to the project the checkout declares when no record exists
  (see [Prepared environment routing](#prepared-environment-routing));
- applies the checkout's saved test-entrypoint associations: a `node-test`
  repository wrapper or a `lib0-testing` harness association runs a proof stage
  exactly as it runs an ordinary run of the file;
- has the runner's installed integration build the one command, running the
  runner's own listing or metadata first when it needs it;
- executes through the shared confined executor in the target's project
  directory with the runtime's environment, under the requested timeout and the
  invocation's execution budget (the shorter applies; no stage has a timeout or
  ceiling of its own), and settles the captured run. The budget starts with
  the request's execution, once its input is valid, for both tools: for
  `workspace_verify_proof` that is before canonical resolution, which
  therefore consumes it.

A provider builds no command and launches nothing. It contributes to that run
only what its existing checks need and an ordinary run does not supply: the
exact selected test and the runner's own options that load its observer
(node:test's reporter, import and coverage options; Mocha's reporter; a
preload for AVA and lib0; an exact `-run` and Go's `-json` report; Cargo's
exact libtest name and JSON messages; stestr's exact filter and worker
command), its instrumented source, its observation channel and the reader of
that evidence. A stage's command is therefore the ordinary command with those
options. Four families cannot attach their observer through an option of
their runner's command line and contribute a launcher entry program that the
same interpreter runs in the same project directory instead: Jest and Vitest
(the observer is installed through the runner's programmatic API), Deno (an
entry module that imports the observer before the selected test module) and
pytest (a plugin that must be installed before any consumer module is
imported). The pytest entry starts the project's own pytest and leaves the
repository's configuration in force -- its ini file and `addopts` apply as
for an ordinary run. It passes `--rootdir` so that node ids are named
relative to the repository root, as the launcher's selected identities are.
It overrides only the cache location (`cache_dir`): the enabled cache provider
writes to a separate pytest subdirectory of the entry's launcher-owned private
import-policy scratch, removed when the process settles. This keeps cache writes
outside the authenticated checkout without changing source snapshot enforcement.
It does not set a verbosity. Plugin autoload stays
disabled, because an autoloaded plugin would join the dependency population
the entry measures.

A provider keeps the proof-specific authority around that run: the attempt's
launcher-minted runtime authority and its kind, the declared target, the
minted budget and the identity it bound at preparation are all checked before
the shared run is reached, and a selected dependency projection that changed
is still refused. No proof stage has a runtime of its own: a target that no
installation root owns is refused for a proof exactly as for an ordinary run
of the same file.

An observer belongs to the launcher; the runner and every package it needs
belong to the project. The launcher may be installed anywhere, apart from the
project and its dependencies, so an observer never loads a project dependency
from its own location. A stage's observer configuration names the project
directory the shared run runs in (`project_directory`), and the JavaScript
observers load the project's Jest, Vitest and Mocha from there through one
loader in the observer channel, which hands that location to Node's own
resolution (package `exports` included). The Vitest runner the launcher
installs in each worker takes its base runner from that same Vitest. The other
families already run their observer inside the selected runtime: node:test's
reporter and loader use only Node built-ins, AVA and lib0 wrap the module the
project's own loader resolved, Go, Cargo and Deno compile or import the
observer with the selected toolchain and its dependency environment, and
pytest and stestr run it under the selected interpreter. A package the project
lacks therefore fails with the runtime's own module-load error, as it does for
an ordinary run, and a copy installed beside the launcher is never loaded in
its place.

### Shared native lifecycle

One launcher lifecycle serves every non-Node, non-pytest family; a family
contributes only its runner layout, its observer and the facts its runner's
integration needs for the selected test. Each stage it describes is one run
of the [shared test execution](#shared-test-execution).

1. Preparation routes the selected test to one prepared environment of the
   published [local test-runtime readiness](#local-test-runtime-readiness)
   (see [Prepared environment routing](#prepared-environment-routing)) and
   binds its identity: the routed project and environment, the runtime as it is
   now and the provider's assets. It executes nothing. The runner's setup
   probe belongs to setup alone and never decides whether the selected test
   runs: a project whose unrelated package cannot be loaded still runs the
   selected package's test. A target no installation root owns, a named
   environment that cannot serve it, a malformed saved configuration, or inputs
   that can be neither taken from the configuration nor located refuses before
   any selected body runs, with the readiness or routing code, its route facts
   and `recovery.operator_action`; an executable that is missing or not
   executable, or a runner package the project did not install, refuses the
   stage that would have launched it with that same code. No record, a record
   that is not authentic (it
   is never consumed), a setup that is running or failed, a
   runner setup never proved, a root setup never inventoried and inputs that
   changed since setup do not refuse: the runtime is resolved and run
   as it is. Attempts never install anything.
2. Every stage of one attempt resolves the runtime again. What authenticates
   the stage is held to that attempt's preparation: the digest of the
   launcher's provider assets and the routed project and environment. A
   difference refuses with `test_proof_native_runtime_inputs_stale`. The
   environment's own toolchain and dependencies are not held to preparation: a
   change to them between preparation and a stage runs, the stage is bound to
   the runtime-inputs digest of what it actually used, and its run facts carry
   `runtime_environment_observed` (`changed_since_preparation`, the current and
   preparation digests, and the current record, toolchain and dependency
   provenance). The attempt's `runtime_environment` publishes both: its
   top-level facts are what preparation observed (`observed_at:
   "preparation"`), and `stage_environments` lists every executed stage with
   `changed_since_preparation` and, for a stage that used a different runtime,
   that stage's own runtime-inputs digest and record, toolchain and dependency
   provenance. Stages that used different runtimes stay distinguishable, and
   the public result detail carries the same object.
3. Every stage runs where an ordinary run of the same file runs: in the
   checkout, from the target's project directory, with every input
   that run reads. Each run has its own execution root (a uniquely minted
   `/tmp/agent-chassis-execution-*` host directory whose `scratch/` child
   every family sees at the fixed `/agent-validation-tmp` and whose `tmp/` child
   is the run's whole private `/tmp`), which the launcher removes only after the
   run's process tree settles. Tests can create and use temporary files
   natively or at literal `/tmp` paths, but no pre-existing host `/tmp` entry is
   visible. The launcher's instrumented sources are bound read-only over their
   own checkout paths in that run's sandbox only -- the declared module's
   probes and, for a falsifier, its one declared substitution -- so the
   unchanged candidate and a falsifier read exactly the same inputs except the
   instrumented files: no file Git ignores, no fixture and no path exists for
   one and not the other, and a failure of the mutation run is not an input
   difference. The launcher itself never writes the checkout; the test may
   write its own checkout exactly as in an ordinary run (see
   [Ordinary test runs](local-test-runtime-setup.md#ordinary-test-runs)). The observer
   configuration and the observation channel are files of the run's scratch.
   The checkout's Git administration, every runtime input and the observer
   assets stay read-only; the network is denied and secrets are masked. The driver relays the channel
   on the launcher protocol descriptor in one framed message whose length and
   digest are checked.

   Two families reach the same checkout by their runner's own means. go test's
   observer adds source files to the package, which a bind over an existing
   file cannot do, so a go test stage names its instrumented and added package
   files in Go's own build overlay (`-overlay`, for the listing and the run
   alike); the files themselves are in the stage's scratch. Cargo decides
   what to rebuild from source modification times and its target directory
   outlives a stage, so a cargo test stage binds every Rust source of the
   project's default layout (`src/**/*.rs`, `tests/*.rs`) as that stage's own
   bytes, instrumented or unchanged: a file an earlier stage instrumented and
   this one leaves plain is rebuilt, never reused. No stage of any family runs
   from a copy of the project.
4. The declared module and the selected test file are read from the checkout,
   rejected unless they are regular files of the prepared project, and
   instrumented from their exact bytes. Instrumentation never changes line
   numbers. Anything it cannot instrument faithfully refuses with
   `test_proof_native_instrumentation_unsupported` and a reason such as
   `function_absent`, `function_not_unique`, `function_not_synchronous`,
   `body_not_single_scalar_return`, `return_literal_unsupported`,
   `replacement_not_distinct`, `replacement_kind_incompatible`,
   `selected_test_not_observable`, `selected_test_shape_unsupported` or
   `source_unparsable`. Go and Rust resolve the selected test against the
   file's parsed named test declarations before applying eligibility, so the two
   selection reasons are different facts. `selected_test_not_observable` means
   the named test is absent: the refusal names the test and its declared file,
   the correction owner is `proof_author`, and the recovery is
   `author_the_named_selected_test_or_correct_the_saved_selection` with no
   unchanged retry. `selected_test_shape_unsupported` means the declaration
   exists but the adapter cannot hook it (for example Go's valid
   `func TestX(_ *testing.T)` or a generic test): the correction owner is
   `launcher_test_proof_provider`, the recovery is
   `report_the_launcher_provider_selected_test_shape_limitation`, and there is
   neither a caller retry nor advice to rewrite a valid test. Both are
   `not_started`: the selected test never ran. Families that learn a missing
   identity only by running keep `test_proof_selected_identity_not_observed`
   with their completed run facts and captured output, and never infer source
   absence from a missing observation.
5. The runner runs only the selected test. Every other test is deselected or
   skipped before its body runs, so a sibling that ends the process never runs.
   The selected test keeps its runner's ordinary composition: helper
   functions (including another top-level test function the selected test
   calls directly or runs as a subtest), native descendants such as subtests
   and steps, asynchronous work and final lifecycle callbacks all belong to the
   selected test. They never become separately requested tests, never earn
   proof credit of their own, and never refuse the observation. A separately
   registered sibling test body that actually runs is a different fact: it is
   an unselected execution.

#### Persistent native compiler caches (Go, Cargo, Deno and Vitest)

A family whose dependency ecosystem or runner integration names a native
compiler cache runs every stage with that cache at one
persistent directory below the main repository:
`<main repository>/.cache/test-proof-native/<cache>`. The caches are Go's
`GOCACHE` (`go-build`), Cargo's `CARGO_TARGET_DIR` (`cargo-target`), Deno's
`DENO_DIR` (`deno-dir-<digest of the operator's Deno cache path>`) and Vitest's
native module cache (`fsModuleCache`, `vitest-module-cache`). No other family
or npm runner has one.

- Ownership. The native tool alone decides validity, reuse, locking and normal
  maintenance of its cache: Go's content-addressed action keys and its own
  trimming, Cargo's fingerprints and build-directory lock, Deno's check and
  analysis cache keys, and Vitest's module-cache key. The launcher keeps no
  copy, generation, snapshot, index, census, eviction or lock of its own and
  never decides whether cache content is current. Contents are disposable,
  mutable compiler state: a test may change them, and nothing here guarantees
  that a later run sees them unchanged.
- Location authority. The launcher alone selects the directory; no caller,
  request or environment value can name it. Every component below the main
  repository must be a real directory: a symbolic link or another entry
  refuses with `test_proof_native_compiler_cache_unavailable`, the affected
  path and the original error, before any selected body runs,
  and nothing is followed, repaired or created through it. This is path
  configuration, not authentication of cache content.
- Git exclusion. The caches are untracked runtime state and must never change
  the checkout's status identity, so local test-runtime setup of an
  environment with a native compiler cache appends the exact pattern
  `/.cache/test-proof-native/` to the repository-local exclude file Git
  itself resolves (`git rev-parse --git-path info/exclude`, shared by every
  worktree of the repository), keeping every existing line and changing no
  tracked file; a repository's own ignore rule serves equally. Setup refuses
  (`test_runtime_native_cache_exclusion_failed`) when Git tracks any file
  below `.cache/test-proof-native/`, when its root is not a work tree's top
  level, or when Git or the file cannot be used. Every other untracked file,
  elsewhere below `.cache/` included, still changes the status identity.
  Before a run opens its cache, `git check-ignore` must confirm the directory
  is ignored. The persistent cache is an optimization, not a prerequisite:
  where the directory is not ignored (setup never ran, or the repository is
  not a Git work tree), or its location is redirected or cannot be created,
  nothing is created or written there, no Git exclusion is added by the run,
  and every stage keeps its compiler cache in its own scratch instead. The prepared runtime reports the choice as
  `native_compiler_cache` (`persistent`, or `attempt_scratch` with the reason
  code). The same toolchain and sources run either way.
- Confinement. Each confined run of such a family sees exactly that one cache
  directory writable, bound at its own path through the sandbox planner's
  runtime roots. The checkout's Git metadata, installed dependencies, the
  operator's dependency stores and the provider assets stay read-only, and the
  checkout is writable to the test as in any test execution; secret
  masks and network denial are unchanged. Its fresh private scratch is bound
  at the fixed `/agent-validation-tmp`, so `HOME`, the
  observer configuration and the channel have the same compiler-visible paths
  in every proof, call and launcher process, while concurrent runs keep
  separate host backing directories.
- Fresh execution. Only compiler state is reused. Every candidate, falsifier
  and traversal stage gets its fresh Git-selected source, instrumentation,
  nonce and channel, and executes its selected body; no outcome, assertion,
  mutation or traversal result, test process, channel or proof credit is ever
  reused. `go test` keeps `-count=1`, so Go never supplies a cached test result.
- Cleanup. Each run removes only its own scratch; the persistent cache
  survives cleanup, failed and interrupted runs, and launcher restarts. A
  scratch that cannot be removed withholds the attempt's result.
- Go. Changed instrumented packages rebuild; unchanged standard-library,
  module and project packages are reused by content.
- Cargo. Cargo judges a local path package by its source timestamps. Working
  copies get fresh timestamps, so Cargo recompiles the project's own units in
  every stage and reuses the output of registry and vendored dependencies,
  which its fingerprints identify by version and source. Cargo reports this
  per unit (`fresh`) in its `compiler-artifact` messages.
- Deno. Only the detected dependency stores (`remote`, `npm`) of the
  operator's cache are visible, read-only at their own paths, through links of
  the same names in the persistent `DENO_DIR`, which the launcher points at
  them before each run; nothing is copied from or written to the operator's
  installation. Deno type-checks the stage's own graph and reuses its check
  cache; a changed graph is checked again. Configuration and lock files are
  dependency inputs: a change to them is recorded in the run's provenance and
  Deno itself decides whether the cached dependencies still satisfy them.
  Setup probes of other consumers and worker commands keep the operator's
  `DENO_DIR` itself, read-only.
- Vitest. The supported route is Vitest's built-in transformation only,
  decided on each Vitest instance that runs, never on another evaluation of
  the configuration: the launcher always passes `fsModuleCache: false`
  itself, which the root and every test project inherit over their own
  configuration, and only the launcher's own Vite plugin, in the
  `configResolved` hook of that instance's root resolution, turns the module
  cache on at the persistent path when the resolved plugins are exactly those
  Vitest resolves with no configuration file (each compared by name and hook
  code) and no test projects are declared. Any other configuration (a plugin,
  including one added only on a later evaluation, test projects or Vite
  devtools) runs with the module cache off, unchanged and freshly; plugins are
  never stripped, named or trusted. Vitest's own key covers a transformed
  module's id and content, part of the resolved Vite configuration (root,
  mode, resolution, plugin names, environment, CSS), the content of the
  modules the configuration file imports, and the lockfile. With the runner
  configuration loader it misses the configuration file's own text, the
  TypeScript configuration and the options the configuration computes. The
  launcher's plugin adds those through Vitest's supported
  `defineCacheKeyGenerator`, from the running instance, while every native
  contribution stays: the configuration file's text; the environment's
  resolved `define`, `oxc`, `env` and `resolve` options; and, for each
  module, the TypeScript configuration the project's own Vite toolchain
  resolves for it (rolldown's public `resolveTsconfig` with the instance's
  `tsconfig` setting, merged `extends` included). A module whose inputs
  cannot be represented safely is kept out of the cache with Vitest's
  supported opt-out (the generator returns `false`) and transformed freshly:
  a function among those resolved options (its behavior is not its text, for
  example a `customResolver`), a value JSON cannot hold, an unreadable
  configuration file, an unavailable toolchain resolution, or a TypeScript
  configuration it cannot resolve for the module. Each stage prints, in its
  captured output, the module-cache state of the instance that ran, how many
  modules it transformed itself, how many it kept out of the cache and why.

### Observation protocol

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
status mismatch names the selected outcome and the exit code. The complete
channel population stays in the captured run. A selector that matches no observed
test refuses with `test_proof_selected_identity_not_observed` and lists the
observed identities. An observer can report only
`test_proof_native_runner_unsupported`, `test_proof_native_runner_unavailable`
or `test_proof_native_selection_unsupported`, with the original error when it
has one. A failed pytest collector is listed among the observed failures with
its own identity and original exception; it is never a selected test.

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

### Reach binding

Every attempt mints a fresh random credential for each instrumented function
of the declared module. The credential exists only in that function's entry
probe in the launcher-written instrumented source. For stestr it exists only
in one directive line the launcher appends to the working-copy module; the
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

### Family limits

- JavaScript and TypeScript: the substituted function is a top-level
  synchronous function declaration whose body is one `return` of a number,
  string, boolean or `null` literal. Probes cover named function declarations,
  expressions, arrows and methods. Jest runs in band with the project
  configuration and the launcher setup file appended. Vitest runs once with
  the launcher runner, `cache: false` and, on its supported route, its native
  module cache (see [Persistent native compiler caches](#persistent-native-compiler-caches-go-cargo-deno-and-vitest));
  a project that configures its own runner is refused.
  Mocha runs with the project configuration and the launcher reporter. AVA runs
  one serial worker without worker threads. lib0/testing runs the selected
  harness module with the launcher observer preloaded.
- Deno: the launcher writes a private entry that installs its observer and
  then loads the selected module through it with a literal dynamic import,
  which Deno still resolves and type-checks as part of the module graph. A
  module that fails to import or evaluate at startup (for example a top-level
  read Deno refuses) ends the session with its original error as the one
  runner-level error: the selected test is not observed, the run earns
  nothing, and its cause is that error. A module-resolution or type-check
  failure (for example TS2307 for a missing local module, or a type error)
  precedes every module, the observer's included: nothing runs, the selected
  test is not observed, and the run's cause is Deno's native report read from
  stderr as a build failure. Each diagnostic keeps its `TS` code, its first
  message line and its checkout location (repository path, line and
  column; the instrumented declared module keeps only its line, and a file
  outside the checkout has no location); source excerpts, caret lines,
  related information and hints are never read. A message continued beyond
  its first line (a chained message or a hint) carries
  `native_report_unreadable` for that message. At most 16 diagnostics are
  kept (`capture_budget_exceeded` beyond that). A report that was truncated,
  unterminated or not recognized, including any output with no recognizable
  diagnostic, carries `native_report_unreadable`; only empty output is no
  report. A build diagnosis applies only to a run in which
  no observer record was written, so test output shaped like a report is
  never a cause. A `deno.json` (preferred) or `deno.jsonc` in the
  checkout project is passed as `--config` at its working-copy path. Only the
  channel is writable to the test, nothing is readable through Deno
  permissions, and the run is `--frozen --cached-only --no-prompt`.
- stestr: the project's `.stestr.conf` `top_dir` must make the selected file an
  importable module. The run uses one worker with the launcher observer as the
  worker command, so the interpreter and observer paths must be shell-inert.
  The declared module is a Python module; its transform happens at import,
  from the launcher directive line of the working-copy module.
- go test: the selected test is a top-level `func TestX(t *testing.T)` in the
  selected file. Only its declaration is hooked; every other test function of
  the file is listed as declared inventory and stays ordinary Go. The hook
  observes only the runner-started root `*testing.T` whose name is the selected
  function's: a direct call with that same `T`, or a call of the selected
  function under another runtime name, runs unchanged and observes nothing.
  Panics are recorded and re-raised. The declared module is a non-test source
  of any package in the project. The run uses `GOPROXY=off`, a read-only
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

### Local test-runtime readiness

Local test-runtime detection (see
[Local test-runtime setup](local-test-runtime-setup.md)) is the only producer
of the readiness record `.agent-launch/test-runtimes/readiness.json`
(`agent-launch-test-runtime-readiness.v3`). Ordinary `agent-chassis setup` runs
it as its last step, inventorying the repository's environments and saving the
toolchain locations it resolved in `agent-chassis-runtime.json`;
`agent-chassis setup --test-runtimes` reruns that same step.
Neither entrypoint produces readiness by resolving or saving those choices: the
launcher's `test-runtime-setup` module owns the record. It is the repository's
current detection state: `preparing` from the moment a valid request is
accepted, then that attempt's `ready` (after its own detection, validation and
sandbox checks pass) or `failed` (with the complete structured setup result),
each carrying the attempt's `preparation` identity, its `environments` and the
most recent earlier failure as `last_failure`. `loadReadiness` is the one
classifier of that state: only an intact ready record of this repository is
ready; preparing and failed return `test_runtime_preparation_in_progress` and
`test_runtime_preparation_failed` with the record; an absent record
(`test_runtime_not_ready`) alone means never prepared. Native proof preparation
and attempts read it and nothing else. A `preparing` or `failed` record also
holds, as `configured`, the configuration of the ready record it superseded.
A ready record holds every detected
environment (`environments`: public ID, ecosystem, installation root, workspace
members, proved runner IDs and toolchains), the proved runners as
`selection` rows of runner ID and installation root, each toolchain's exact
version, version source (`project_pin`, `operator_request` or `installed`),
origin (`configured` for an operator-supplied location, `host` for one
discovered on setup's `PATH`), executables, measured population, content digest
and metadata fingerprint, each environment's detected dependency installation
(its `source` such as `project_node_modules`, `selected_virtual_environment`,
`module_cache`, `cargo_vendor` or `deno_dir`, input-file digest over the root
and member manifests and the lock, workspace member links, the existing
directory, measured population, content digest and fingerprint), the passed sandbox
verification checks, and a `readiness_digest` over the whole record. A record
that does not reproduce its digest is invalid.

For execution the record is configuration, not approval
(`loadRuntimeConfiguration`): attempts launch with the configured locations of
a ready record, or with the `configured` block of a `preparing` or `failed`
one, as those locations are now, and locate for the run whatever no
configuration names, including every input of a repository with no record.
The launcher does not compare the checkout's
input files, the recorded populations' fingerprints or digests, or a version
against what setup measured in order to decide whether to run, and a later
setup outcome does not withdraw the configuration. Each resolution instead
observes the current inputs and reports them as the run's provenance: setup's
version and content digest for an input whose bytes are unchanged, and for a
changed one the content digest measured now, `observed: "changed_since_setup"`
and setup's facts under `setup_*` names. The exact fields and the mechanical
refusals that remain are in
[Runtime inputs at execution](local-test-runtime-setup.md#runtime-inputs-at-execution).
Neither setup nor attempts ever download, install or rewrite lockfiles.

The verifier and a managed coding worker select an installation root with the
same pure selector. It takes a candidate root list and a normalized
repository-relative path, and returns the longest candidate that is `.`, equals
the path, or is a slash-bounded ancestor of it. Both filter the recorded
environments by dependency ecosystem. Nothing outside the containing roots is
ever selected.

### Prepared environment routing

`verify_proof` routes each selected test independently, so one call
may verify tests in several languages and environments:

1. The saved proof's runner binding (its candidate provider family) names the
   runtime runner and so the dependency ecosystem. The target's suffix is
   recorded as a language-family hint (`route.suffix_ecosystems`) and never
   replaces the saved binding, test, provider, evaluator, falsifier or
   obligation population.
2. Without an `environment` argument, the environment of that ecosystem whose
   installation root owns the target serves it
   (`route.basis: "saved_runner_binding_and_project_ownership"`): the longest
   of the published environments that contain the target and the environments
   the checkout itself declares, by the one repository inventory setup uses. Two projects of one language are two
   environments and each target reaches its own. Whether setup proved the
   runner in the owning environment is not a condition; no sibling environment
   is borrowed, and a runner the installation lacks fails when it runs. A
   target no root owns refuses with `test_runtime_runner_not_prepared`.
3. An installation root between the target and a published environment that
   declares its own complete dependency inputs is the target's environment
   even though no record names it: its inputs are located for the run (see
   [Runtime inputs at execution](local-test-runtime-setup.md#runtime-inputs-at-execution)),
   and the enclosing environment is never used silently in its place.
4. With `environment: "<ecosystem>@<installation root>"`, that environment,
   published or declared by the checkout at exactly that root, serves the test
   (`route.basis: "named_environment"`) only if it is of the runner's
   ecosystem and contains the target.
   Before anything is bound, prepared or executed, the verifier checks the
   named environment against every selected proof. If any proof cannot run
   there, the whole call refuses with `verify_proof.environment_incompatible.v1`.
   The refusal's `recovery.facts` list `requested_environment`, each
   `incompatible` proof (test proof ID, obligation IDs, target, family,
   `reason`: `ecosystem_mismatch`,
   `target_outside_environment`, `provider_unknown` or
   `environment_unavailable`, and code), the `valid_choices` that would serve
   the whole population, and the `prepared_environments`. Nothing is filtered
   or partially executed. An unknown name is `environment_unavailable` with
   `test_runtime_environment_unknown`.
5. node:test proofs route the same way through the npm environment that owns
   the target, published or declared by the checkout's own package manifest
   when no record exists. A routed node:test stage is the ordinary command of
   the file -- `node --test`, or the repository wrapper a saved `node-test`
   association names, run from the project directory -- with the options the
   provider contributes: its exact selection, reporter, module-fault import
   and declared-module coverage. It names no isolation mode and uses no
   descriptor of the runner, so node:test, or the wrapper, keeps its own
   process boundary. It runs the environment's Node with the detected
   `node_modules` bound read-only
   at the project's own `node_modules` in the checkout under test, so workspace
   member links resolve to that checkout's sources. A missing mountpoint exists
   only in the run's namespace; nothing is created on the host. The run has its
   own execution root as its private `/tmp`. Preparation binds the provider assets and the
   routed environment, and every run of that attempt resolves the runtime again as in
   step 2 of the native lifecycle. A target that no npm project owns (no
   published environment and no package manifest contains it), with no
   environment named, is refused with the ordinary run's
   `test_runtime_runner_not_prepared`.
6. The name is an identity only: it grants no visibility, cannot retarget the
   candidate source, and never supplies an executable, path, variable, root or
   mount. Source authentication, routing and the per-attempt runtime identity
   above apply unchanged.

Each proof result reports the `runtime_environment` that actually ran it: the
`requested_environment`, the routed `environment`, `runtime_source`, the
`route` (`basis`, `runner`, `suffix_ecosystems`), the `readiness_digest`, the
toolchain and dependency identities as observed for that run (versions, sources
and content digests, with any change since setup named; no
host paths) and the `runtime_inputs_digest`, for every family (pytest included).
The aggregate reports the
call's `requested_environment`, the compact summary names each proof's
`environment`, and both are retained with the invocation for execution-free
reads.

The worker composes one frozen runtime identity at launch from the same record
and the same per-project currentness checks (see
[Prepared test runtimes in the coding worker](agent-launch-confinement-mcp-conduit.md#prepared-test-runtimes-in-the-coding-worker)).
Its ordinary commands are evidence of execution with that frozen runtime and
grant no proof credit. Verification remains explicit, re-checks currentness
itself, and alone produces proof evidence. Both the verifier and the worker run
Cargo with the caller's own arguments against the detected source: a vendored
directory declared by the project's or `CARGO_HOME`'s configuration, or the
`CARGO_HOME` registry, offline.

## Public boundary

There is no separate public native-proof editor, proof-plan builder,
verification-bundle editor, assessment route, runtime-proof route, or capture
author. Package and launcher algorithms may retain internal compilers,
integrity checks, evaluators, generation authentication, and execution
machinery when current consumers use them.

The public authoring and execution journey is:

1. Discover a named proof when needed.
2. Query or atomically upsert saved semantic meaning.
3. Validate explicitly when diagnostic feedback is wanted.
4. Correct in one upsert using the current digest.
5. Query selected saved meaning after restart.
6. Verify that same map against the exact candidate.

None of these steps requires preliminary preparation, skeleton creation, plan
publication, carrier editing, or validation before save or verification.
