

import { z } from "zod";

import { RUNTIME_CONFIGURATION_INVALID_CODE } from
  "../../../agent-launch-cli/src/lib/test-execution/current-runtime.mjs";
import { selectConfiguredFileRunner } from "../../../agent-launch-cli/src/lib/test-execution/runtime-inputs.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityIdentity } from "./managed-test-source-context.mjs";
import { projectRunTestNativeResult, runTestCarrier, runTestRetentionFailure } from "./run-test-result.mjs";
import { createRunTestResultReader, runOrdinaryTestAndObserve } from "./run-test-tool.mjs";
import { withVerifyProofRegressionEffects } from "./verify-proof-execution-effects.mjs";

export const VERIFY_PROOF_REGRESSION_STATUSES = Object.freeze(["passed", "failed", "not_executable", "not_started"]);

export const VERIFY_PROOF_REGRESSION_CODES = Object.freeze({
  FAILED: "verify_proof.regression_test_failed.v1",
  RUNNER_UNCONFIGURED: "verify_proof.regression_runner_unconfigured.v1",
  RUNNER_AMBIGUOUS: "verify_proof.regression_runner_ambiguous.v1",
  NOT_RUN: "verify_proof.regression_not_run.v1",
  UNCONFIRMED: "verify_proof.regression_execution_unconfirmed.v1",
  EXECUTION_FAILED: "verify_proof.regression_execution_failed.v1",
  SOURCE_MOVED: "verify_proof.regression_source_moved.v1",
  SOURCE_MOVED_BEFORE_START: "verify_proof.regression_source_moved_before_start.v1"
});

const CONFIGURATION_OWNER = "local test-runtime setup and the repository runtime configuration owner";

function runnerSelectionFailure(file, selection) {
  const facts = { file, configuration: selection.file, project: selection.project,
    candidate_runners: [...selection.candidates], effect: "this file was not executed" };
  if (selection.reason === "configuration_invalid") {
    return { reason_code: RUNTIME_CONFIGURATION_INVALID_CODE, runner_selection: { ...facts,
      condition: "configuration_invalid", message: selection.message, owner: CONFIGURATION_OWNER,
      correction: "correct or remove the saved runtime configuration; its selections are never ignored" } };
  }
  if (selection.reason === "runner_unconfigured") {
    return { reason_code: VERIFY_PROOF_REGRESSION_CODES.RUNNER_UNCONFIGURED, runner_selection: { ...facts,
      condition: "owning_project_has_no_runner_selection", owner: CONFIGURATION_OWNER,
      missing_choice: "the runner for this file's owning project",
      correction: "have the configuration owner run agent-chassis setup --test-runtimes from the repository root; " +
        "if the project has several runners, select one with setup --test-runtimes --runner <runner>@<project>" } };
  }
  return { reason_code: VERIFY_PROOF_REGRESSION_CODES.RUNNER_AMBIGUOUS, runner_selection: { ...facts,
    condition: "containing_project_names_several_runners",
    missing_choice: "one explicit runner selection for this file's owning project",
    missing_capability: "a file-only regression entry cannot choose among several runners of one project",
    owner: CONFIGURATION_OWNER,
    correction: "have the configuration owner select exactly one named runner for this project with " +
      "agent-chassis setup --test-runtimes --runner <runner>@<project>; no ancestor runner resolves this ambiguity" } };
}

function settledStatus(execution, interruption, interruptions) {
  if (execution.status === "executed" && execution.ok === true) return { status: "passed", reason_code: null };
  if (execution.timed_out === true || execution.cancelled === true) {
    const kind = execution.cancelled === true ? "cancelled" : "timed_out";
    return { status: "not_executable", reason_code: interruptions[interruption ?? kind].interrupted };
  }
  if (execution.executed === "unknown") {
    return { status: "not_executable", reason_code: VERIFY_PROOF_REGRESSION_CODES.UNCONFIRMED };
  }
  if (execution.status === "executed" && execution.executed === true) {
    return { status: "failed", reason_code: VERIFY_PROOF_REGRESSION_CODES.FAILED };
  }

  return { status: "not_executable",
    reason_code: execution.code ?? execution.blocker ?? VERIFY_PROOF_REGRESSION_CODES.NOT_RUN };
}

function failureFacts(failure) {
  return {
    ...(failure?.semantic_diagnosis == null ? {} : { diagnosis: failure.semantic_diagnosis }),
    ...(failure?.cause?.present !== true ? {} : { failure: {
      stage: failure.cause.stage, code: failure.cause.code,
      ...(typeof failure.message === "string" ? { message: failure.message } : {}) } })
  };
}

function thrownFacts(error) {
  return { code: typeof error?.code === "string" ? error.code : null, message: String(error?.message ?? error) };
}

export async function executeVerifyProofRegressions({ declared, runtime, budget, environment = null, source,
  host, interruptions, deps = {} }) {
  if (declared === null || declared === undefined) return null;
  const repositoryRoot = runtime.authority.main_repo;
  const checkoutRoot = runtime.authority.worktree_path;
  const base = (file) => ({ file, source_unit: declared.unit, proof_credit: false });
  let caller = null;
  let reader = null;

  const retention = () => {
    if (reader === null) {
      caller = { workspace: { repo: host.repository },
        state: (deps.resolveLauncherRunState ?? resolveLauncherRunState)(host.sessionEnv) };
      reader = createRunTestResultReader({ z, responseEnv: host.responseEnv, jsonContent: (value) => value,
        errorContent: (error) => { throw error; } });
    }
    return { caller, reader };
  };
  const results = [];
  let moved = null;
  const startedFiles = new Set();
  return withVerifyProofRegressionEffects({ declared, results, startedFiles }, async () => {
  for (const file of declared.files) {
    const interruption = budget.interruption();
    if (interruption !== null) {
      results.push({ ...base(file), status: "not_started", reason_code: interruptions[interruption].unstarted });
      continue;
    }
    if (moved === null) {
      try {
        await runtime.assertCurrentIdentity();
      } catch (error) {
        moved = thrownFacts(error);
      }
    }
    if (moved !== null) {
      results.push({ ...base(file), status: "not_started",
        reason_code: VERIFY_PROOF_REGRESSION_CODES.SOURCE_MOVED_BEFORE_START, source_movement: moved });
      continue;
    }
    const selection = (deps.selectRegressionRunner ?? selectConfiguredFileRunner)({ repositoryRoot, target: file });
    if (!selection.ok) {
      results.push({ ...base(file), status: "not_executable", ...runnerSelectionFailure(file, selection) });
      continue;
    }
    const runner = { runner: selection.runner, project: selection.project };
    const ordinary = { target: file, runner: selection.runner, environment, selector: null };
    const request = { file, runner: selection.runner, environment, selector: null,
      timeout: { milliseconds: budget.timeout_ms }, source: null };
    let outcome;
    try {
      startedFiles.add(file);
      const result = await runOrdinaryTestAndObserve({
        runRequest: { repositoryRoot, checkoutRoot, ...ordinary, budget, timeoutMs: budget.timeout_ms },
        request: ordinary,
        ...(deps.runRegressionFile === undefined ? {} : { runFile: deps.runRegressionFile }),
        ...(deps.observeRegressionRuntime === undefined ? {} : { observeRuntime: deps.observeRegressionRuntime }) });

      outcome = { candidate: { result, source: { current: true } }, comparison: { state: "not_requested" } };
    } catch (error) {

      results.push({ ...base(file), status: "not_executable",
        reason_code: VERIFY_PROOF_REGRESSION_CODES.EXECUTION_FAILED, runner, failure: thrownFacts(error) });
      continue;
    }

    try {
      await runtime.assertCurrentIdentity();
    } catch (error) {
      moved = thrownFacts(error);
    }

    const observed = moved === null ? outcome : { ...outcome, candidate: { ...outcome.candidate,
      source: { current: false, reason: moved.code ?? "source_moved" } } };
    const carrier = runTestCarrier({ request, source, outcome: observed });
    let retained;
    try {
      const { caller: bound, reader: owner } = retention();
      const locator = owner.retain(carrier, bound, source.commit ?? null);
      const projected = projectRunTestNativeResult({ result: locator, repository: host.repository,
        authorityIdentity: managedTestAuthorityIdentity(bound.state), views: ["outcome", "failure"],
        env: host.responseEnv });
      retained = { execution: projected.outcome.execution, failure: projected.failure,
        native_result: projected.retained, native_read: projected.native_read };
    } catch (error) {

      retained = { execution: carrier.outcome.execution, failure: carrier.failure,
        native_result_retention: runTestRetentionFailure(error, { operation: "retain_native_result",
          subject: "settled regression result", capability: "original_read" }) };
    }
    const { execution, failure, ...native } = retained;
    const settled = moved === null ? settledStatus(execution, budget.interruption(), interruptions)
      : { status: "not_executable", reason_code: VERIFY_PROOF_REGRESSION_CODES.SOURCE_MOVED };
    results.push({ ...base(file), ...settled, runner,
      ...(moved === null ? {} : { source_movement: moved }),
      execution: { ...execution }, ...failureFacts(failure), ...native });
  }
  const counts = { declared: results.length, ...Object.fromEntries(VERIFY_PROOF_REGRESSION_STATUSES.map((status) =>
    [status, results.filter((row) => row.status === status).length])) };
  return { source_unit: declared.unit, proof_credit_granted: 0, counts, results };
  });
}
