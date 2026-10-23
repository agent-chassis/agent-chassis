# Test-proof diagnostics

This page defines the diagnostic evidence a proof attempt keeps: the failure
diagnostic graph, the run records and attempt observation, and capture bounds
and retention. Outcomes and recovery are in
[Test-proof results](test-proof-results.md).

## Failure diagnostic graph

Every structured failed event carries a versioned launcher diagnostic
(`launcher-test-failure-diagnostic.v1`) captured from the runner's original
failure at its native boundary: the available error name, message, code and
stack; assertion expected, actual, operator and generated message state; and
nested cause and aggregate-error relationships. Assertion values use explicit
graph records, so shared references, cycles, array holes, `undefined`, bigint,
non-finite numbers, typed bytes and supported built-in collections remain
distinguishable. Accessors and unsupported or unreadable values are not invoked
or silently omitted: the diagnostic records an unavailable value and a
source-path issue.

The graph has one closed shape for every provider family and no metadata bag.
An error may also carry the native source `location` (file, positive line and,
when the runner supplies one, column), `native_details` (labelled,
runner-formatted display text such as a diff, never parsed into typed operands;
typed `expected` and `actual` appear only when the runner hands the values over)
and the failure's native `origin` (`hook`, `step`, `subtest`, `phase` or runner
`condition`, with its native name). The JavaScript owner keeps the 256 KiB
ceiling: oversized assertion values are omitted first. If error fields still
exceed it, the bounded graph keeps available identity, native location and
message/trace prefixes; each partial or omitted field carries an exact
`capture_budget_exceeded` issue. It bounds error records and display details as
well, and reports omitted graph populations explicitly. A message prefix is at
most 1,024 UTF-8 bytes so the selected public diagnosis can present useful text.
This partial capture stays `captured`, never a claim of complete retention.
An absent error, a capture whose required frame cannot fit, and a native report
that could not be read or attributed stay explicit issues (`error_not_supplied`,
`capture_budget_exceeded`, `native_report_unreadable`,
`native_attribution_unavailable`).

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
provider runs `go test -json` and reads the report while the bounded capture
drains it, before head/tail elision. Only records the toolchain types as errors
(`OutputType` `error`, continued by `error-continue`) become the diagnosis, with
the `file:line` prefix Go wrote for them; logged output, frames and untyped
output never do. A toolchain that writes no typed records (for example Go 1.24)
gets no attribution: its diagnosis carries `native_attribution_unavailable` and
its selected outcome is unchanged. Such a toolchain formats `t.Errorf` and
`t.Log` alike, so a lone failed assertion and a log followed by `t.Fail()` write
the same report and no `file:line` prefix makes either a cause. Cargo runs
with `--message-format=json`; only `compiler-message` errors' structured
message, code, primary span and child messages are read, never rendered text.
Rust locations name the file and line only, because instrumentation preserves
lines but not columns. Report framing is bounded per line; an oversized line or
a failed adapter marks the report unreadable while draining, capture and exit
facts continue.

node:test runs each file in its own process and reports a file whose process
failed as one generic wrapper failure (`ERR_TEST_FAILURE`, "test failed"); the
exception that ended the process exists only as the report that process
printed, which the default reporter writes to stdout. The node-test provider
reads that report while the shared capture drains stdout, before head/tail
elision, and the run carries it as its cause when the file wrapper failed with
a nonzero exit and the selected test was not observed. Node's throw-site caret
starts the report; a blank separator before its error header is optional and
extra blank padding is ignored. These are report framing;
the native cause remains separate from the generic authenticated wrapper event.
The cause is diagnosis
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
a node:test file whose wrapper failed before the selected test was observed. A
malformed graph on an observed record refuses the record stream like any other
malformed record.

## Run records and attempt observation

Candidate, falsifier and traversal observations link to their authenticated
structured-result artifacts. The compact verification summary inlines no
diagnostic payloads; it carries each retained proof's selected-test identity and
observation, its mutation-evidence state, and the actual evaluator diagnostic
codes of each unproven relationship. The complete settled result is retained
once and named by `result: {ref_id}`. `verify_proof` with that `result` reads it
without rerunning the proof, and a proof or obligation subject within it returns
that proof's selected diagnosis. The public ranged content reader refuses those
retained bytes and returns that read instead.

A launcher preparation, candidate, falsifier or traversal execution failure
carries two run records:

- `run` holds only the bounded public facts the refusal projection accepts:
  ran, disposition, exit code, signal, timed out, blocker code, output
  truncation, a spawn failure's stable code, a refused native record's compact
  context, a source-instrumentation refusal's adapter `reason` and selected
  `test`, and the run's original cause as a validated diagnostic graph. One
  launcher-owned pure helper validates those facts for both the launcher and the
  public refusal projection, which publishes the cause through the same selected
  diagnostic projection as a failed test. The cause is the original error of an
  observer runtime error (for example a Jest or Vitest startup failure), a
  pytest runtime error, a native build failure, a node:test file's printed
  uncaught exception, or the first runner-level error
  (with their count) of a run whose selected test was not observed or whose exit
  status disagreed with it.
  When no native error graph was supplied, the native diagnosis owner may
  distill that failed run's own explicit loader exception report into a native
  diagnostic graph before retaining these bounded facts. The loading subject,
  exception and reported location remain diagnostic meaning only. A bare
  error-looking line, passing run or incomplete capture establishes no such
  cause; an existing native graph takes precedence. Missing selected-test
  observation remains unavailable alongside this cause, without selector
  correction advice or proof credit.
- `captured_run` holds the complete captured run: stdout and stderr (head and
  tail bounded by the capture), normalized argv, timings, cleanup outcome, an
  interrupted run's `termination`
  ([Host execution](test-proof-execution.md#host-execution)), the
  observation envelope and `runner_execution` (the harness, native selection and
  command the shared run composed, and each selection command with its
  outcome). The public projection never reads it; it survives only inside the
  captured evidence below, including when the execution budget relabels the
  failure as an interruption.

A run's native facts are the process's own, whatever its proof evidence turns
out to be: `ran`, exit status, signal and output, `ok` and a disposition of
`passed` or `failed` decided by the exit alone, and a blocker only for the
execution budget's own interruption or a cleanup that could not be confirmed. A
missing or refused proof observation is reported beside them
(`test_proof_observation.valid: false` with its code, published as
`structured_observation_code`): it establishes nothing, earns no credit, and
never turns a run that exited 0 into a failed one. `not_run` means the process
never executed, including a stage the shared run refused or whose native
selection it could not resolve; such a stage carries that exact code as its
blocker and no observation. Preparation runs nothing, so it is never a captured
stage; a preparation that could not bind its runtime identity reports
`execution_stage: preparation` with the readiness or routing code and no run.
The failure names the resolved provider of the failing stage. The proof result
then reports `execution_status: completed` (or `interrupted` when the run's own
timeout stopped it) with status `not_executable`; only a failure with no
executed run reports `not_started`, and `execution_not_started` counts only
those. A completed candidate says nothing about later stages; the failed stage
stays in the facts.

The reporter and observer protocols never travel on stdout or stderr (node:test
writes its report to a file of the run's own scratch, native observers to their
channel file, pytest to a descriptor the driver relays), so test output stays
diagnostic-only and cannot select authenticated evidence. node:test hands the
tests' own output to its reporters, so its default reporter keeps writing that
output and the native results to stdout, where it is captured.

Every attempt keeps one attempt observation: the prepared `runtime_environment`
that ran it and each stage it reached (`preparation`, `candidate`, each
`falsifier` with its falsifier identity as `check_id`, and `traversal` with its
boundary identity), in order, each tagged with its provider and carrying that
stage's complete captured run exactly once. A completed attempt returns it
beside its authenticated evidence, and the verifier records it on the proof
result as `attempt_diagnostics`, encoded by the diagnostic-evidence serializer
(the proof's `runtime_environment` is named there as a published field rather
than repeated). A failure after the attempt started (source currentness,
preparation, a later stage, inventory, identity, runtime currentness, budget or
receipt check) keeps the observation collected so far, including its sealed
`timing`, on the original thrown value as `attempt_observation`; its code,
detail, message and cause are unchanged. The observation travels with the one
attempt whose receipt is bound to the same target and verification, and the
public `runtime_environment` is projected from it. Diagnostics never grant proof
credit, select an identity or change an outcome: runner output is never parsed
into assertion facts, and the structured per-test error remains the
authenticated observation's `failure_diagnostic`. An unproven proof's selected
diagnosis keeps its root error (including a runner wrapper) and available native
location. A message over the public inline limit now has a useful native prefix,
independently of whether capture compaction ran: at most 1,024 UTF-8 bytes for the
root and 256 for each presented related error. `message_presentation` states
`status: partial`, `retained_utf8_bytes`, `returned_utf8_bytes` and
`omitted_utf8_bytes`; these describe presentation of the retained message, not
bytes already lost at capture. Short messages stay unchanged. Capture issues
remain separate and unchanged.

The same distiller presents native `cause` and `aggregate_errors` relationships,
with at most three additional errors across the diagnosis. It preserves the
wrapper and intermediate errors, never promotes the deepest error or chooses
one aggregate member as the assertion. Exhausted causes are `deferred` with
`reason: presentation_error_limit`; omitted aggregate members have
`aggregate_errors_omitted`. Revisited errors keep their native graph `ref`.
Primitive causes stay in the retained graph, named by `retained_fields` and the
related-error count. Related-error counts and bounded codes still cover the
complete selected graph, including errors omitted from presentation.

Each presented error uses its own native location. When a related error has no
explicit location but retains a native Node frame, the shared location extractor
supplies its first file frame, labelled `location_source: native_stack`. Without
an explicit checkout it preserves the native absolute file path; it never
infers the old checkout from the reading process. A wrapper's test-declaration
location is never substituted for its assertion cause. A frame already omitted
at capture remains unavailable, with the original capture issue.

Call traces and the complete cause/aggregate graph stay unchanged in the retained
original and are named by `retained_fields`. Expected and actual operands over
256 bytes are deferred; runner-formatted details are deferred with label and
size, and omitted detail rows are counted by `native_details_omitted`. The
runner's own output stays in retained `attempt_diagnostics`. The initial answer,
selected detail and recorded-result reads use this same bounded presentation
within existing response budgets. Reads execute nothing, rewrite no retained
evidence and grant no proof credit.

## Capture bounds and retention

Native capture is bounded at its source. Each captured stream keeps its head
and tail within the configured caps (by default 262,144 bytes per stream: one
quarter head, the rest tail less a small marker reservation) and elides the
middle with an accounted marker. The bound protects the supervising launcher;
it is the capture's resource boundary, not an MCP delivery limit, and discarded
middle bytes are not recoverable. Every stage keeps `output_truncated`,
`output_elided_bytes` and `output_bounds` beside its streams, and a truncated
capture is never presented as complete. Everything after capture is lossless:
retention and serialization reproduce the captured value exactly.

A modeled proof refusal captures the original thrown value before it classifies
the cause chain. The retained original carries that capture at the first
diagnostic node's `details.evidence`; public selected diagnostics keep the
semantic cause and omit the captured graph and raw output. Its format is the
[`agent_launch.diagnostic_evidence.v1` contract](mcp-dispatch-runtime-contract.md#launcher-transition-failure-contract),
also described in [Launch and admission](mcp-dispatch-launch-and-admission.md).
An unknown cause stops semantic classification but does not erase an already
recognized refusal or its captured cause graph, and grants no proof credit,
execution eligibility, proof-local continuation or recovery action.

The ordinary proof-result retention and MCP response owners store that JSON
evidence unchanged. `get_run_result` reads the retained proof original through
the authenticated selected-response class, without byte ranges or reassembly,
and retained refusal readback never reruns the provider. Carrier-generation
member failures name the exact filesystem operation, `filename`, path and
caller-supplied generation context in the classified details, while their
native exception remains in the captured evidence; generation identity is
supplied by the manifest owner and never inferred from directory layout. The
reporter's fixed 2 MiB authenticated-envelope bound remains an explicit
`test_proof_structured_events_oversized` nonexecution result; diagnostics are
never clipped to fit it.
