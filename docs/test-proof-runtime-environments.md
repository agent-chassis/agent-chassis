# Test-proof runtime environments

This page defines which prepared environment runs a selected test: the
readiness record as execution configuration, environment routing, and the
pytest provider's runtime inputs. Execution itself is in
[Test-proof execution](test-proof-execution.md).

## Local test-runtime readiness

Local test-runtime detection is the only producer of the readiness record
`.agent-launch/test-runtimes/readiness.json`
(`agent-launch-test-runtime-readiness.v4`). The launcher's `test-runtime-setup`
module owns it; `agent-chassis setup` runs that detection as its last step and
`agent-chassis setup --test-runtimes` reruns it (see
[Local test-runtime setup](local-test-runtime-setup.md#verification-and-readiness)
for the producer, its states and its recovery). The record is the repository's
current detection state: `preparing`, then that attempt's `ready` or `failed`,
each with the attempt's `preparation` identity, its `environments` and the most
recent earlier failure as `last_failure`. `loadReadiness` is the one classifier
of that state: only an intact ready record of this repository is ready;
preparing and failed return `test_runtime_preparation_in_progress` and
`test_runtime_preparation_failed` with the record; an absent record
(`test_runtime_not_ready`) alone means never prepared. A `preparing` or `failed`
record also holds, as `configured`, the configuration of the ready record it
superseded.

A ready record holds:

- every detected environment (`environments`: public ID, ecosystem,
  installation root, workspace members, proved runner IDs and toolchains) and
  the proved runners as `selection` rows of runner ID and installation root;
- each toolchain's exact version, version source (`project_pin`,
  `operator_request` or `installed`), origin (`configured` for an
  operator-supplied location, `host` for one discovered on setup's `PATH`),
  executables, measured population, content digest and metadata fingerprint;
- each environment's detected dependency installation: its `source` (such as
  `project_node_modules`, `selected_virtual_environment`, `module_cache`,
  `cargo_vendor` or `deno_dir`), the input-file digest over the root and member
  manifests and the lock, workspace member links, the existing directory,
  measured population, content digest and fingerprint. An npm environment
  also holds its links to other local source and each member's own module
  tree, and its population is every physical installation root (see
  [Module trees](npm-test-runtime-layouts.md#module-trees));
- the passed sandbox verification checks, and a `readiness_digest` over the
  whole record. A record that does not reproduce its digest is invalid.

For execution the record is configuration, not approval
(`loadRuntimeConfiguration`). Attempts launch with the configured locations of
a ready record, or with the `configured` block of a `preparing` or `failed` one,
as those locations are now, and locate for the run whatever no configuration
names, including every input of a repository with no record. A record that is
not authentic is never consumed. Nothing setup measured decides whether a run
starts, and a later setup outcome does not withdraw the configuration; each
resolution reports what it observed as the run's provenance
(`observed: "changed_since_setup"`, with setup's facts under `setup_*` names,
for a changed input). The fields and the mechanical refusals that remain are in
[Runtime inputs at execution](local-test-runtime-setup.md#runtime-inputs-at-execution).
Neither setup nor attempts ever download, install or rewrite lockfiles.

The verifier and a managed coding worker select an installation root with the
same pure selector: from a candidate root list and a normalized
repository-relative path it returns the longest candidate that is `.`, equals
the path, or is a slash-bounded ancestor of it. Both filter the environments by
dependency ecosystem, and nothing outside the containing roots is selected.

## Prepared environment routing

`verify_proof` routes each selected test independently, so one call may verify
tests in several languages and environments:

1. The saved proof's runner binding (its candidate provider family) names the
   runtime runner and so the dependency ecosystem. The target's suffix is
   recorded as a language-family hint (`route.suffix_ecosystems`) and never
   replaces the saved binding, test, provider, evaluator, falsifier or
   obligation population.
2. Without an `environment` argument, the environment of that ecosystem whose
   installation root owns the target serves it
   (`route.basis: "saved_runner_binding_and_project_ownership"`): the longest
   of the published environments that contain the target and the environments
   the checkout itself declares, by the one repository inventory setup uses.
   Two projects of one language are two environments and each target reaches
   its own. Whether setup proved the runner in the owning environment is not a
   condition; no sibling environment is borrowed, and a runner the installation
   lacks fails when it runs. A target no root owns refuses with
   `test_runtime_runner_not_prepared`.
3. An installation root between the target and a published environment that
   declares its own complete dependency inputs is the target's environment
   even though no record names it: its inputs are located for the run, and the
   enclosing environment is never used silently in its place.
4. With `environment: "<ecosystem>@<installation root>"`, that environment,
   published or declared by the checkout at exactly that root, serves the test
   (`route.basis: "named_environment"`) only if it is of the runner's ecosystem
   and contains the target. Before anything is bound, prepared or executed, the
   verifier checks the named environment against every selected proof. If any
   proof cannot run there, the whole call refuses with
   `verify_proof.environment_incompatible.v1`; nothing is filtered or partially
   executed. The refusal's `recovery.facts` list `requested_environment`, each
   `incompatible` proof (test proof ID, obligation IDs, target, family, code and
   `reason`: `ecosystem_mismatch`, `target_outside_environment`,
   `provider_unknown` or `environment_unavailable`), the `valid_choices` that
   would serve the whole population, and the `prepared_environments`. An
   unknown name is `environment_unavailable` with
   `test_runtime_environment_unknown`.
5. node:test proofs route the same way through the npm environment that owns
   the target, published or declared by the checkout's own package manifest. A
   routed node:test stage is the ordinary command of the file (`node --test`,
   or the repository wrapper a saved `node-test` association names, run from the
   project directory) with the options the provider contributes: its exact
   selection, reporter, module-fault import and declared-module coverage. It
   names no isolation mode and uses no descriptor of the runner, so node:test,
   or the wrapper, keeps its own process boundary. It runs the environment's
   Node with each module tree of the selected installation at its own place in
   the project (see
   [Dependency mapping for test runs](npm-test-runtime-layouts.md#dependency-mapping-for-test-runs)),
   so workspace member links resolve to that checkout's sources and a member's
   own dependency versions resolve natively.
6. The name is an identity only: it grants no visibility, cannot retarget the
   candidate source, and never supplies an executable, path, variable or root.
   Source authentication, routing and the per-attempt runtime identity (see
   [Shared native lifecycle](test-proof-execution.md#shared-native-lifecycle))
   apply unchanged.

Each proof result reports the `runtime_environment` that actually ran it: the
`requested_environment`, the routed `environment`, `runtime_source`, the
`route` (`basis`, `runner`, `suffix_ecosystems`), the `readiness_digest`, the
toolchain and dependency identities as observed for that run (versions, sources
and content digests, with any change since setup named; no host paths) and the
`runtime_inputs_digest`, for every family. The aggregate reports the call's
`requested_environment`, the compact summary names each proof's `environment`,
and both are retained with the invocation for execution-free reads.

A managed coding worker composes one frozen runtime identity at launch from the
same record and resolution owner (see
[Prepared test runtimes in the coding worker](agent-launch-worker-test-runtimes.md#prepared-test-runtimes-in-the-coding-worker)).
Its ordinary commands are evidence of execution with that frozen runtime and
grant no proof credit. Verification remains explicit, re-checks currentness
itself, and alone produces proof evidence. Both run Cargo with the caller's own
arguments against the detected source: a vendored directory declared by the
project's or `CARGO_HOME`'s configuration, or the `CARGO_HOME` registry, offline.

### Regression file runner selection

A saved proof names its runner. A declared regression file
([Test Proof Execution](test-proof-execution.md#declared-regression-files))
names only a file. Selection reads explicit choices from the landing repository's
`agent-chassis-runtime.json` and recorded defaults through the existing
execution-configuration reader:

1. The longest containing project among explicit choices and recorded
   environments owns the file, across runner ecosystems.
2. That project's explicit `runners` selection takes precedence. Otherwise
   use its recorded runner inventory.
3. Select only when that project's chosen population names exactly one runner.
   A preparing or failed setup retains the preceding configuration through the
   same reader; it creates no execution gate. An invalid runtime record supplies
   no default. Automatic inventory is never saved as explicit operator choices.

The selected runner then runs the file as any ordinary run does, in the
environment that routing selects for it. A selection that fails runs nothing
for that file and reports the file, the configuration file, the containing
project, the runners configured there and the correction:

- No runner is selected for the file's project: the configuration owner runs
  `agent-chassis setup --test-runtimes` from the repository root to record the
  declared environment, or explicitly selects its runner through setup.
- The containing project names several runners: a file-only entry cannot
  choose among them. The configuration owner selects exactly one with
  `agent-chassis setup --test-runtimes --runner <runner>@<project>`. No runner is
  guessed from the file's name, the single
  runner of an ancestor project is not borrowed, and the caller cannot name
  one.
- The saved configuration is refused by its owner: that refusal is reported
  with its own code and message.

A configured name that is not a catalog runner is selected as configured, and
the run that receives it refuses it with the executor's own code.

## Native provider runtime inputs

Ordinary pytest and every pytest proof stage use one shared Python source
binding adapter around their existing invocation. Before pytest or its plugins
load the application, it maps local-project import locations below the landing
repository to their corresponding candidate locations. It handles path-based
editable installations (including src layouts) and setuptools' generated
`MAPPING` and `NAMESPACES` in memory. Paths come from the interpreter's actual
startup search path and editable finders, not an assumed source directory.
Third-party site directories and the selected virtual environment retain their
installed locations, including an environment inside the original checkout.
Runtime discovery and execution disable bytecode writes to that installation.
Project cwd and pytest options remain the project's own.

The proof entry keeps `-I`; the adapter rebinds startup paths explicitly rather
than relying on `PYTHONPATH`, which isolated mode ignores. Candidate, scalar
falsifier and traversal resolve the same candidate source, and the falsifier
respects the shared binding and editable finders. No package is reinstalled,
no shared installation is changed and no source is copied into the landing
checkout. Missing or escaping candidate source refuses with
`python_candidate_source_missing` or `python_candidate_source_escapes` instead
of resolving back to the installation. Unsupported local editable mechanisms
report `python_editable_mechanism_unsupported` with the distribution, origin
and observed mechanism or finder/loader. A startup hook that already imported
original application code is unsupported and reports that module and origin;
the adapter cannot undo code that Python executed during site startup.

The pytest provider runs with the interpreter of the environment the shared
runtime resolution routes its target to (see
[Prepared environment routing](#prepared-environment-routing)), as an ordinary
run of that target does, and with the pytest requirement closure that
interpreter's own population provides: every import package of pytest's
installed requirements, resolved from distribution metadata with environment
markers applied. It has no interpreter or site population of its own, never
installs a package, searches another root, or accepts a caller executable,
environment or path. A fixed launcher-owned program locates that closure
without importing it, before any selected body runs and under the invocation's
execution budget.

Preparation that cannot resolve those inputs refuses with
`test_proof_native_runtime_unavailable`, and its detail names one failure class:

- `runtime_inputs_missing` lists each distribution or import package the
  interpreter does not provide, including the `packaging` distribution the
  closure walk needs. The operator provisions those inputs; no code change can.
- `runtime_interpreter_mismatch`: the program ran under a different executable
  than the resolved interpreter.
- `runtime_locate_failed`: the locate program did not complete; the detail has
  its exit code, signal, spawn error code and complete captured stderr.
- `runtime_locate_output_invalid`: unreadable program output, with its stderr.

The last two identify a provider or interpreter defect rather than a missing
input. A missing interpreter refuses separately with
`test_proof_native_interpreter_unavailable`.

The routed environment's interpreter and pytest population are used exactly as
they are now; a configured interpreter is never replaced by a `PATH` lookup,
another host interpreter or another site population. The prepared runtime
reports `runtime_source: "launcher_readiness"`, the record's `readiness_digest`
and the routed `environment`, and execution re-checks both before each attempt.
What setup measured earlier does not decide whether the target runs. Inputs
that can be neither taken from the configuration nor located, or an interpreter
that is missing or not executable (`test_runtime_toolchain_executable_unavailable`,
`test_runtime_toolchain_executable_invalid`), refuse preparation with that code.
A repository that publishes no environment is resolved as an ordinary run
resolves it (see [Local test-runtime readiness](#local-test-runtime-readiness)).

Immediately before each run the provider measures the interpreter and the
runtime packages again and builds the run from the runtime as it is then
(`refreshInstalledPytestRuntime`). A change to the provider's own assets, or to
the routed interpreter path or environment, is refused, because those
authenticate what the run reports. A change to the interpreter's or the
packages' bytes, or to the environment's toolchain and dependency provenance,
is not: the run is bound to the current runtime-inputs digest and its run
facts carry `runtime_environment_observed`. Each run ignores cached bytecode
through a private empty `pycache_prefix`, refuses sourceless bytecode, and
reports the top-level modules it imported from outside the consumer root, the
runtime packages and the standard library; a non-empty population refuses with
`test_proof_native_dependency_population_unsupported`.
