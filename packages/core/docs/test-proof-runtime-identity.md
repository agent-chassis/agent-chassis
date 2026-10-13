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

## Related pages

This page owns saved meaning, the runtime binding, candidate binding and the
provider family catalog. The rest of the test-proof contract is split by topic:

| Page | Owns |
| --- | --- |
| [Test-proof execution](test-proof-execution.md) | The shared test run, host execution under `decision`, transformed proof copies, the native lifecycle and persistent compiler caches. |
| [Test-proof runtime environments](test-proof-runtime-environments.md) | The readiness record as configuration, environment routing and the pytest runtime inputs. |
| [Test-proof observation](test-proof-observation.md) | The observation protocol, reach binding, family limits and the Node module-fault providers. |
| [Test-proof results](test-proof-results.md) | Population and execution outcomes, capability limitations, public outcomes and verification timing. |
| [Test-proof diagnostics](test-proof-diagnostics.md) | The failure diagnostic graph, run records, attempt observations, capture bounds and retention. |
| [JUnit test result parser](junit-test-result-parser.md) | The shared JUnit/XUnit XML report parser. |
| [Local test-runtime setup](local-test-runtime-setup.md) | Setup, readiness publication, runtime inputs at execution and the `workspace_run_test` route. |

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

A managed worker that selects a subject its assigned unit does not offer, or
names another unit or the parent work record, is refused without executing
anything. The refusal keeps its code (`verify_proof.subject_unknown.v1` or
`verify_proof.source_unit_forbidden.v1`) and carries one sentence,
`Invalid proof selected. Valid proofs for you: <proof IDs>.`, with the same IDs
as `valid_proof_ids`. The IDs are the proofs the assigned unit's own saved
sources relate to its obligations, read from those sources; parent-only and
sibling-only proofs are never listed, and listing a proof says nothing about
whether it would pass. If the assigned unit's sources cannot be read, that
failure is reported instead of the invalid-selection sentence.

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
cache in read-only mode, and it refuses when that verification or the cache
selection fails. The verified cache is selected for the materialization's
`.cache/controlled-contract/validators` for every exact-commit attempt. Host
execution places no read-only mount over it (see [Host execution](test-proof-execution.md#host-execution)).
The authority binds exactly that one cache location: a bind plan that is
missing, unfrozen, or names any other source or destination refuses with
`test_proof_exact_candidate_validator_cache_bind_invalid`.

The authority selects no npm dependency projection and is not gated on the
configured repository's installation. Whether the root `node_modules` is
absent, a link, or anything else, the request runs: the shared run maps the npm
installation the npm ecosystem owner selects for the materialized project into
the materialization it executes in, with workspace members resolving to that
materialization's own sources (see
[Ordinary test runs](local-test-runtime-setup.md#ordinary-test-runs)). A
project with no selected installation runs unmapped and its harness reports
what it cannot load; an occupant that is not the mapping refuses that run with
`test_runtime_dependency_projection_conflict`. The run's own
`identity.dependencies` is the dependency evidence, and neither the source
snapshot nor the result carries projection facts.

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
refusal names its validated source-relative `path`. The source snapshot does
not refuse or measure a project's verified dependency mapping (the
`node_modules` link the dependency-mapping owner verifies against the selected
npm installation, with the one workspace generation it publishes), so mapping
dependencies for a test never moves the snapshot digest; every other link
refuses and every source edit still moves it. No field-name heuristic
suppresses assertion messages, stacks, paths or values; raw process output
stays out of the public answer under the delivery contract in
[Test-proof diagnostics](test-proof-diagnostics.md#run-records-and-attempt-observation).

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
`repo_module_path`. Whether a path ends in one of the selected family's source
suffixes is an execution fact about the provider that will run the proof, not
an authoring check: `verify_proof` reports an incompatible falsifier or
system-under-test module with
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
