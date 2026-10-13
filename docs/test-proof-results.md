# Test-proof results

This page defines what a `verify_proof` result reports: population and
execution outcomes, capability limitations, the public outcome vocabulary and
verification timing. Failure diagnostics and retained evidence are in
[Test-proof diagnostics](test-proof-diagnostics.md).

## Population and execution outcomes

The complete selected population is retained in the result. Missing targets,
invalid selectors, unavailable providers and invalid relationships produce
their own reason-coded `not_executable` rows with zero execution credit; they
do not suppress independently eligible proofs. Eligible proofs run serially,
with exact execution-key de-duplication and currentness checks before and after
each attempt.

An obligation whose author explicitly declined proof (`proof_opt_out: true`) is
not one of those rows. It is accounted for by that decision and is neither
missing input nor a failure: it appears in no `proof_results` row, count or
diagnostic, and carries no `missing_selection`. The result reports it in
`proof_opt_outs`, present only when the selected population holds one: the
complete `obligation_ids` with `accounting: "opted_out"`, `proofs_executed: 0`
and `credit_granted: 0`; the summary gives the same facts as `count` with at
most sixteen identities and `obligation_ids_omitted`. A mixed population runs
and reports its selected proofs as usual beside the opt-outs. A subject that is
only an opt-out resolves no proof and answers
`verify_proof.proof_population_empty.v1` with that same fact, executing nothing.

An obligation whose saved case selects no proof is one of those rows. Its
reason stays `verify_proof.author_inputs_unavailable.v1`, with execution
`not_started` and zero credit, and its recovery
`select_a_proof_for_the_named_obligation_then_retry` carries a
`missing_selection` fact: the selection owner's original code
(`obligation_coverage_proof_unselected`), the owning obligation, the public save
field `proof.name` and that owner's explanation. The fact is read from the
resolver's retained diagnostic for that obligation, never from a message or the
reason code, so any other authored-input failure keeps the generic
`repair_the_named_proof_prerequisite` recovery. The first answer, the selected
detail and every later read of the retained or recorded result report the same
fact; reading it executes nothing and changes no authoring. The caller chooses
the proof: the recovery names no proof, discovery query or save revision. Its
one call is the current read of the unit that owns the obligation, offered only
to a session whose registered reader serves that authoring source. Any other
session receives the same fact with
`verify_proof.authoring_acquisition_unavailable.v1` in place of the call and
gains no authoring route.

Once execution starts, the attempt engine runs the unchanged candidate and each
declared falsifier, observes the selected traversal, and emits authenticated
evidence. A selected assertion failure is an `unproven` result when the
structured observation population is complete. Spawn failure, timeout,
candidate movement, missing observation, malformed receipt or unavailable
provider is `not_executable`.

The selected-test observation is the proof observation whether or not a
mutation can run; a mutation that runs adds falsification evidence for that
same proof, not another proof category. The compact result presents the
selected test's identity and `selected_status` beside `mutation_evidence`; the
full result also labels the same outcome as `test_observation`.
`selected_status` is the observed event status (`passed`, `failed`, `skipped`
or another reported status), and `not_observed` only when no selected-test
event was recorded.

When the candidate run's authenticated event for the exact selected
identity reports the test skipped, the proof refuses at the candidate stage with
`test_proof_selected_test_skipped`: the proof is `not_executable` with execution
`completed`, earns no credit, and runs no falsifier or traversal stage. The
refused result carries that event as its typed `selected_observation`, so the
summary row, the full result's `test_observation` and the selected detail all
say `skipped`; no receipt is synthesized. Every provider reports a candidate's
skip of the selected test this way, pytest included. When the provider observed
the runner's own account of the skip, `selected_observation` also states the
`skip_phase` it happened in and the `skip_reason` as the runner worded it (for
pytest, the skipped phase's own report text); the selected detail's
`failure.selected_test` states the same two members. A reason is reported as
stated and attributes nothing: a skip may be the test's own marker, the
runner's, or the run's (pytest skipping a coroutine test no loaded plugin
runs, for instance), so the recovery is
`resolve_the_reported_selected_test_skip_then_retry` and names no party. The
native run's own outcome stays in the recovery facts (`ran`, `exit_code`,
`disposition`): a skip is an observation, never a failed process. The complete
observed population stays in the recovery facts. A todo, a sibling's skip, or a skip seen by a
falsifier or traversal run is not the candidate's skip and keeps
`test_proof_selected_identity_not_observed`.

A later stage can refuse after the candidate stage authenticated the selected
test. Once the candidate's observation is validated (identity observed, run
complete, inventory present), the attempt owner records the candidate's own
event for the exact launcher-selected identity, `passed` or `failed`, and a
falsifier, traversal or receipt failure carries it on its attempt observation
as `selected_observation`. A proof-local refusal publishes it exactly as for a
candidate skip, so the direct answer, the population summary, the retained
`test_observation` and the selected detail report the observed status. The
refusal keeps its own reason, stage and provider; no receipt is synthesized,
nothing is read from runner output, and the observation earns no credit: the
row stays `not_executable` and its mutation evidence stays `not_run`. An event
of any other identity, a candidate-stage refusal, or an attempt that recorded no
candidate observation publishes nothing, and the row says `not_observed`.

Every mutation member is classified by one pure owner,
`lib/test-proof-mutation-outcome.mjs`, shared by the semantic kernel, the
runtime assessment and the public presentation:

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
as one outcome. Failed or incomplete test execution stays visible through
`test_observation.execution_status`, the proof status, reason and diagnostics.

## Declared regression outcomes

When the execution source declares regression files
([Test Proof Execution](test-proof-execution.md#declared-regression-files)),
the result carries `regression_results` beside `proof_results`. A source that
declares none has no such member, and its result claims no regression pass.

- `source_unit` is the slice that declares the list. `counts` gives the
  declared files and how many `passed`, `failed`, were `not_executable` and
  were `not_started`. `results` has one row per declared file, in declared
  order.
- A row states its `file`, `status`, `reason_code` and `source_unit`. A file
  that ran also states the selected `runner` and its `project`, and the native
  `execution` facts of the run (whether it executed, its exit code, signal,
  timeout, cancellation and output loss). A file whose runner could not be
  selected states `runner_selection` instead.
- `failed` means the file ran and did not pass. `not_executable` means it did
  not produce a pass or a failure: its runner could not be selected, the
  executor refused or could not start it, its completion could not be
  confirmed, it was interrupted by the budget or a cancellation, or the source
  moved while it ran. `not_started` means the loop never reached it. The
  reason code is the owner's own where an owner refused, and one of
  `verify_proof.regression_*` otherwise.
- A regression is a native test outcome. It is not a proof row, is in no proof
  count, and grants no proof credit (`proof_credit_granted` is 0).
- The overall `status` is `proven` only when the proofs are and every declared
  file passed. A failed file makes it `unproven`; a file that is not
  executable or not started makes it `not_executable`. A passing regression
  never improves an outcome the proofs do not support.
- The result digest covers `regression_results`.

Each run that settled is retained once as a `workspace_run_test` native result,
bound to the session that ran it. The row carries its locator
(`native_result`) and the read of it (`native_read`). No captured output is
copied into the verification result: stdout and stderr are read through
`workspace_run_test`, which serves them only to the authority the native
result was retained for. Any reader of the verification result sees the row's
structured facts. When the native result could not be retained, the row keeps
its facts and states `native_result_retention` instead of a locator.

The summary and the selected detail carry the same compact `regressions`
member: the complete counts, and at most eight rows, files that did not pass
first, with `results_returned` and `results_omitted`. A row that did not
pass also carries the diagnostic facts its retained row states
(`runner_selection`, `failure`, `source_movement`,
`native_result_retention`), so a file that never ran names its cause and
correction without a native result to read. A string in those facts longer
than 512 bytes is replaced by `<name>_omitted` with its byte size; it is
never shortened, and the retained result keeps it whole. The retained result
keeps every row. Reading a result runs nothing.

A native result retained for a file whose source moved while it ran states
that in its own `source` view: not current, with the reason the row states.
A managed worker's recorded invocation is journaled as `timed_out` or
`cancelled` when a declared regression file was interrupted or left unstarted
for that reason, as it is for a proof.

## Capability limitations

Whether the selected test runs depends on the test, its runtime, and the source
and authority checks, never on whether every additional proof check can be
applied. A check whose mechanism does not accept its declared subject reports a
capability limitation and the attempt continues: the candidate result and its
artifacts stand, the remaining checks still run, and the limitation is published
beside the outcome rather than in place of it.

A limitation has exactly two origins, and neither is inferred from the other.
The saved binding may declare `falsification_provider: registry_unsupported`:
this installation runs no falsifier provider for the proof, the binding declares
no falsifier, and nothing invents one. Otherwise an installed provider refused
the declared subject at execution time with one of
`test_proof_native_instrumentation_unsupported`,
`test_proof_native_runner_unsupported` or
`test_proof_native_selection_unsupported`, the complete provider-owned
limitation set. Unconfigured runtimes, runtime inputs that moved during one
attempt, spawn failures, timeouts, authority refusals, missing or invalid
selected identities, and malformed observations are execution failures and keep
their own diagnostics; none becomes a limitation.

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
each member naming its check and reason; a falsification the binding never
declared names no check identity. The semantic facts carry per-check
availability, and the public summary reports the distinct reason codes beside
the selected test's `selected_status`.

A limitation records an absent observation and never supplies the credit of the
check it replaces. For mutation it also withholds nothing: a proof whose
selected test passed, whose mutation was unavailable, and whose other required
checks hold is `proven`, and its row reports mutation evidence as `unavailable`
with the limitation codes. Mutation unavailability alone supplies no retry,
waiver, installation or repair instruction, and it never excuses an actual
survivor: every available member is assessed individually, and one survivor
makes the proof `unproven`. A failed selected test is `unproven` for its
assertion, with its diagnostic, and gains no mutation counterevidence from
falsifier rows that observed the same failure.

For a passing candidate, a declared falsifier missing from the population, a
provider-mode binding with no falsifier, or a supported member that is
`unevaluable` leaves that relationship reason-coded `not_executable`
(`verify_proof.falsifier_evidence_not_evaluable.v1`, with
`verify_proof.falsifier_population_incomplete.v1` or
`verify_proof.falsifier_outcome_unevaluable.v1` diagnostics carrying the
recorded facts). The semantic kernel returns that result instead of reaching
the exact evaluator, which refuses such facts rather than judging them; the
proof row still reports the observed selected test. Incomplete evidence is
neither credit nor counterevidence.

The runtime-evidence validator requires each unsupported falsifier row and its
member of `capability_limitations` to agree on check identity, reason and detail
(`runtime_falsifier_limitation_incoherent` otherwise), and the semantic kernel
requires exactly one identity-less falsifier limitation for a
`registry_unsupported` binding and none otherwise. Malformed, corrupted,
mismatched, cross-bound or duplicate evidence keeps refusing through those
authenticity checks; it is never read as a limitation or as incomplete evidence.

A provider that refuses a declared check under a code outside that set still
fails the attempt; its classification is the provider's, and its recovery is
attributed by the refusal's adapter reason. When a falsifier or traversal stage
refuses a legal source shape its mechanism does not accept
(`body_not_single_scalar_return`, `return_literal_unsupported`,
`return_not_scalar`, `function_not_synchronous`, `async_function_unsupported`
or `decorated_function_unsupported`), the recovery is
`report_the_launcher_provider_check_shape_limitation` with
`correction_owner: launcher_test_proof_provider`, the reason as `condition`
and no retry. Its facts name the affected `check` (kind, identity and declared
module and function), the stage, the provider and the refusal code and reason.
It never asks for the working source to be rewritten, an obligation removed or
unchanged input retried. An absent or ambiguous target, a malformed
replacement, unparsable source, a candidate-stage refusal, a runtime failure and
an authority refusal keep their own recoveries.

A proof whose traversal was limited stays unmet on that evaluator axis. A
typed, attributable proof-local attempt failure may leave that row unavailable
and permit a later sibling. Candidate/source or generation movement, receipt
authentication or cross-binding failure, authority failure, and unknown or
unprojectable causes are shared failures: they stop the invocation and preserve
their owning error.

## Public outcomes and recovery

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

## Verification timing

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
