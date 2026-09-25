# Test-proof runtime identity

This document defines how saved semantic proof meaning becomes one exact runtime
verification. Authoring and validation do not execute code. The public
`workspace_verify_proof` operation owns execution.

## Saved meaning

Contract requirements, proof definitions, cases, and obligation selections are
authored through
`workspace_controlled_contract_obligation_coverage_upsert`. The server derives
stable identities and compiles native contract members through the package
owners. A caller supplies semantic inputs, not a carrier, graph, bundle, plan,
publication session, execution observation, or proof result.

Incomplete cases are valid drafts. Query returns the current saved case identity
and revision. Validation reports missing or invalid runtime semantics without
spawning a provider. A single later upsert can complete or correct the same
case under content-digest CAS.

A `test_execution` verification claim can also be saved with no stable proof
definition at all. Its meaning — verifier, observed proposition and falsifying
proposition — is complete without one, and authoring, query, restart and
implementation admission never resolve an evaluator, an installed executor, a
falsifier target or an executable catalog entry to accept it. Execution is the
owner of that gap: `workspace_verify_proof` refuses a claim with no binding, and
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

The pytest provider uses only launcher-provisioned runtime inputs: the first
`python3` on the launcher `PATH`, and the pytest requirement closure that
interpreter's site population provides under the launcher `HOME`. It never
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

A target is readiness-configured when the repository's published local
test-runtime readiness (see [Local test-runtime readiness](#local-test-runtime-readiness))
has a Python environment that owns the target, or when the call names a
prepared environment (see [Prepared environment routing](#prepared-environment-routing)).
A configured target uses exactly the routed environment's detected interpreter
and pytest population, the same population setup verified, instead of the
launcher `PATH` lookup; its read-only binds come from the same record. The
prepared runtime reports `runtime_source: "launcher_readiness"`, the record's
`readiness_digest` and the routed `environment`, and execution re-checks both
before each attempt. A missing, invalid or stale record for a configured target refuses
preparation with the readiness code (`test_runtime_readiness_invalid`,
`test_runtime_inputs_stale`, `test_runtime_dependencies_stale`,
`test_runtime_toolchain_stale`); it never selects a different host interpreter
or site population. A repository without published readiness is unconfigured
and keeps the `PATH` lookup (`runtime_source: "launcher_path"`).

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
reporter, loader, registration probe, substituted-module expectation, and test
execution. The confined runner uses that same resolved root as its working
directory. A supported symlink spelling of the launcher-minted worktree therefore
cannot make recorded fault identity diverge from the module URL actually loaded;
no caller or environment supplies an alternate root.

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
execution and evidence remain owned by `workspace_verify_proof` as described
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
resolves executable targets only from its authorized unit's declarations.

## Exact candidate binding

`workspace_verify_proof` accepts a canonical proof subject. The server resolves
the corresponding saved population and binds execution to an exact candidate
commit and source snapshot. The source snapshot hashes the sorted repository
entries, entry kind, mode, and file bytes while excluding launcher metadata and
launcher-selected runtime infrastructure. Symlinks refuse because hashing a
link name does not authenticate the bytes an import executes.

Before each provider attempt, the launcher rechecks candidate and source
currentness. Movement invalidates the attempt population. Evidence binds the
subject, contract and source digests, case revision, proof identity, candidate
commit, source snapshot, provider, evaluator, and attempt.

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
provider-owned limitation set. Unprepared runtimes, stale runtime inputs, spawn
failures, timeouts, confinement and authority refusals, missing or invalid
selected identities, and malformed observations are execution failures and keep
their own diagnostics; none of them becomes a limitation.

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

Traversal limitations are unchanged: a proof whose traversal was limited stays
unmet on that evaluator axis. A typed, attributable proof-local attempt failure
may leave that row unavailable and permit a later sibling. Candidate/source or
generation movement, receipt authentication or cross-binding failure,
confinement/authority failure, and unknown or unprojectable causes are shared
failures: they stop the invocation and preserve their owning error.

Every structured failed event carries a versioned launcher diagnostic captured
at the original Node reporter boundary. It preserves available error name,
message, code, and stack; assertion expected, actual, operator, and generated
message state; and nested cause and aggregate-error relationships. Assertion
values use explicit graph records, so shared references, cycles, array holes,
`undefined`, bigint, non-finite numbers, typed bytes, and supported built-in
collections remain distinguishable. Accessors and unsupported or unreadable
values are not invoked or silently omitted: the diagnostic records an
unavailable value and a source-path issue.

Candidate, falsifier, and traversal observations link to their existing
authenticated structured-result artifacts. The compact verification summary
does not inline diagnostic payloads. It does carry each retained proof's
selected-test identity and observation, its mutation-evidence state, and the
actual evaluator diagnostic codes of each unproven relationship. Its evidence reference identifies the complete persisted result,
retrievable in ranges without rerunning the proof.

A launcher candidate, falsifier or traversal execution failure carries two run
records. `run` holds only the bounded public facts the refusal projection
accepts (ran, disposition, exit code, signal, timed out, blocker code, output
truncation, and a refused native record's compact context). A process that ran
and whose proof observation was refused afterwards keeps those facts:
`ran: true`, its exit status and output, and disposition `failed` with the
observation code as its blocker. `not_run` means the process never executed.
The failure also names the resolved provider of the failing stage. The proof
result then reports `execution_status: completed` (or `interrupted` when the
run's own timeout stopped it) with status `not_executable`; only a failure
with no executed run reports `not_started`, and `execution_not_started`
counts only those. A completed candidate says nothing about later falsifier
or traversal stages; the failed stage stays in the facts. `captured_run` holds the complete captured run, including the
attempt's stdout and stderr (head-and-tail bounded by the capture's own output
bounds), normalized argv, timings, cleanup outcome and the observation envelope.
The fd-3 reporter protocol is never part of either stream, so test output stays
diagnostic-only and cannot select authenticated evidence. `captured_run` is never
read by the public projection; it survives only inside the captured evidence
below, including when the execution budget relabels the failure as an
interruption.

A modeled proof refusal captures the original thrown value before it classifies
the cause chain. The first public diagnostic node carries that capture at
`details.evidence`; its format and completeness rules are the existing
[`agent_launch.diagnostic_evidence.v1` contract](mcp-dispatch-runtime-contract.md#launcher-transition-failure-contract),
also described for launcher failures in
[Launch and admission](mcp-dispatch-launch-and-admission.md). Encountering an
unknown cause stops semantic classification but does not erase an already
recognized refusal or its captured cause graph. It also does not grant proof
credit, execution eligibility, proof-local continuation, or a recovery action
for the unknown cause.

The ordinary proof-result retention and MCP response owners store that JSON
evidence unchanged. If the refusal is too large to inline,
`workspace_read_mcp_content_reference` ranged reads reconstruct the complete
refusal; retained refusal readback uses the same stored result and never reruns
the provider. Carrier-generation member failures name the exact filesystem
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

## Restart and repeatability

Query after restart resolves the same canonical case identity, case revision,
contract inputs, and obligation map. Verification of the same saved map against
the same exact candidate preserves source and candidate attribution. A changed
candidate creates a fresh proof instance; historical verification can select an
exact permitted commit and remains bound to that commit.

Runtime evidence is not a universal replay ledger. A later verification call
authenticates its own complete population and candidate facts.

Diagnostic strings are public evidence data unless their producer supplied an
exact `structured-diagnostic.v1` sensitive-value declaration. Such values use
the existing closed redaction reasons, identify the affected field, and have no
recovery path. No field-name heuristic broadly suppresses assertion messages,
stacks, paths, or values.

## Native provider families

`workspace_verify_proof` is the only public route that executes a saved test.
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
provider that will run the proof: `workspace_verify_proof` resolves it and
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
`workspace_verify_proof` runs the attempt. It describes the check; it never
performs one.

The registry publishes one authoring-facts projection per installed family:
identity terms (family, runner, ecosystem, languages and toolchains), selector
kind and `node_id` form, source suffixes, the installed provider of each
capability, and the falsifier's strategies, mechanism and target constraint.
Proof discovery uses the identity terms to recognize provider context, and the
case-authoring guidance of the obligation-coverage upsert is projected from the
same facts. Neither adds a provider, a language or execution support.

### Shared native lifecycle

One launcher lifecycle runs every non-Node, non-pytest family; a family
contributes only its runner layout, its observer and its runner command.

1. Preparation routes the selected test to one prepared environment of the
   published [local test-runtime readiness](#local-test-runtime-readiness)
   (see [Prepared environment routing](#prepared-environment-routing)) and runs
   the runner's setup probe inside the attempt confinement under the
   invocation's execution budget. A target no environment serves, a named
   environment that cannot serve it, or a missing, invalid or stale record,
   refuses before any selected body runs, with the readiness or routing code,
   its route facts and `recovery.operator_action`. Attempts never install
   anything.
2. Every attempt re-derives the runtime-inputs digest (readiness digest, routed
   environment, toolchain and dependency identities, and the digest of the
   launcher's provider assets) and refuses with
   `test_proof_native_runtime_inputs_stale` when it differs from preparation.
3. The launcher-owned attempt driver copies the prepared project into a working
   copy beneath a uniquely minted `/tmp/agent-chassis-proof-*` directory
   on the host's actual `/tmp`, omitting only the project root's
   own `.git`, `.agent-launch`, `node_modules`, `target`, `__pycache__`,
   `.pytest_cache` and `.stestr` entries (nested directories with those names
   are copied). The verifier removes only that owned directory after completion,
   failure or cancellation. Concurrent attempts therefore have disjoint working
   copies and caches, while tests can read and write ordinary pre-existing
   system-`/tmp` paths without repository configuration. It links the read-only
   detected dependency installation into it (for an npm workspace, a private
   `node_modules` whose member entries link to the members' copied sources and
   whose other entries link to the installed packages), and writes the launcher's instrumented
   sources, observer configuration and observation channel. The checkout, every
   runtime input and the observer assets stay read-only; the network is denied
   and secrets are masked. The driver relays the channel on the launcher
   protocol descriptor in one framed message whose length and digest are
   checked.
4. The declared module and the selected test file are read from the checkout,
   rejected unless they are regular files of the prepared project, and
   instrumented from their exact bytes. Instrumentation never changes line
   numbers. Anything it cannot instrument faithfully refuses with
   `test_proof_native_instrumentation_unsupported` and a reason such as
   `function_absent`, `function_not_unique`, `function_not_synchronous`,
   `body_not_single_scalar_return`, `return_literal_unsupported`,
   `replacement_not_distinct`, `replacement_kind_incompatible`,
   `selected_test_not_observable` or `source_unparsable`.
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
or `test_proof_native_selection_unsupported`.

Process exit codes, runner output and printed text are never evidence.

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
channel and nonce but never the attempt mode, the substitution or a
credential. The channel nonce binds a record population to one attempt and
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
the working copy or the configuration. The node:test and pytest providers
observe through their own mechanisms: coverage of attempt-private witness
functions, and a tracer bound to the declared module's code objects.

### Family limits

- JavaScript and TypeScript: the substituted function is a top-level
  synchronous function declaration whose body is one `return` of a number,
  string, boolean or `null` literal. Probes cover named function declarations,
  expressions, arrows and methods. Jest runs in band with the project
  configuration and the launcher setup file appended. Vitest runs once with
  the launcher runner; a project that configures its own runner is refused.
  Mocha runs with the project configuration and the launcher reporter. AVA runs
  one serial worker without worker threads. lib0/testing runs the selected
  harness module with the launcher observer preloaded.
- Deno: the launcher writes a private entry that installs its observer before
  the selected module. A `deno.json` (preferred) or `deno.jsonc` in the
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
  of any package in the project. The run uses `GOPROXY=off` and a read-only
  module cache.
- cargo test: only Cargo's default target layout is supported. The selected
  test is a plain `#[test]` function without parameters or a return type, in
  `tests/<name>.rs` or a library module under `src/`. Only the selected test
  carries the observer guard; other test functions stay ordinary Rust and may
  be called as helpers, and a repeated entry of the selected function within
  the run observes nothing. The declared module is a library module under
  `src/`. The run uses the recorded toolchain's own `cargo` with `--frozen` and
  one test thread.
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
classifier: only an intact ready record of this repository is usable; preparing
and failed return `test_runtime_preparation_in_progress` and
`test_runtime_preparation_failed` with the record; an absent record
(`test_runtime_not_ready`) alone means never prepared. Native proof preparation
and attempts read it and nothing else. A ready record holds every detected
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
that does not reproduce its digest is invalid. Before every attempt the
launcher recomputes the input-file digest of the checkout under test and the
fingerprints of the recorded populations; any difference refuses with the
matching stale code. Neither setup nor attempts ever download, install or
rewrite lockfiles.

The verifier and a managed coding worker select an installation root with the
same pure selector. It takes a candidate root list and a normalized
repository-relative path, and returns the longest candidate that is `.`, equals
the path, or is a slash-bounded ancestor of it. Both filter the recorded
environments by dependency ecosystem. Nothing outside the containing roots is
ever selected.

### Prepared environment routing

`workspace_verify_proof` routes each selected test independently, so one call
may verify tests in several languages and environments:

1. The saved proof's runner binding (its candidate provider family) names the
   runtime runner and so the dependency ecosystem. The target's suffix is
   recorded as a language-family hint (`route.suffix_ecosystems`) and never
   replaces the saved binding, test, provider, evaluator, falsifier or
   obligation population.
2. Without an `environment` argument, the recorded environment of that
   ecosystem whose installation root owns the target serves it
   (`route.basis: "saved_runner_binding_and_project_ownership"`). Two projects
   of one language are two environments and each target reaches its own. If
   the owning environment did not prove the runner, the test refuses with
   `test_runtime_runner_not_prepared`, naming the environment, its runners and
   the environments that would serve it; no sibling environment is borrowed.
3. An installation root between the target and its routed environment that
   declares its own complete dependency inputs but is not in the record refuses
   with `test_runtime_inventory_stale` (`unrecorded_project`) until setup runs
   again, instead of silently using the enclosing environment.
4. With `environment: "<ecosystem>@<installation root>"`, that published
   environment serves the test (`route.basis: "named_environment"`) only if it
   is of the runner's ecosystem, proved the runner and contains the target.
   Before anything is bound, prepared or executed, the verifier checks the
   named environment against every selected proof. If any proof cannot run
   there, the whole call refuses with `verify_proof.environment_incompatible.v1`.
   The refusal's `recovery.facts` list `requested_environment`, each
   `incompatible` proof (test proof ID, obligation IDs, target, family,
   `reason`: `ecosystem_mismatch`, `runner_not_proved`,
   `target_outside_environment`, `provider_unknown` or
   `environment_unavailable`, and code), the `valid_choices` that would serve
   the whole population, and the `prepared_environments`. Nothing is filtered
   or partially executed. An unknown name is `environment_unavailable` with
   `test_runtime_environment_unknown`.
5. node:test proofs route the same way through the npm environment that owns
   the target and proved node-test. A routed node:test attempt keeps its
   selection, reporter, module-fault falsifier and V8 traversal, but runs the
   environment's recorded Node with the detected `node_modules` bound read-only
   at the project's own `node_modules` in the checkout under test, so workspace
   member links resolve to that checkout's sources. Only a missing mountpoint
   leaf is created and removed. Preparation binds the runtime-inputs digest and
   every run re-proves it. A repository that publishes no readiness owning the
   target, with no environment named, keeps the launcher's own Node
   (`runtime_source: "launcher_node"`).
6. The name is an identity only: it grants no visibility, cannot retarget the
   candidate source, and never supplies an executable, path, variable, root or
   mount. Currentness, source authentication and the stale checks above apply
   unchanged.

Each proof result reports the `runtime_environment` that actually ran it: the
`requested_environment`, the routed `environment`, `runtime_source`, the
`route` (`basis`, `runner`, `suffix_ecosystems`), the `readiness_digest`, the
toolchain and dependency identities (versions, sources and content digests; no
host paths) and the `runtime_inputs_digest`, for every family (pytest included).
An unrouted node:test proof reports `runtime_source: "launcher_node"` and no
environment. The aggregate reports the
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
