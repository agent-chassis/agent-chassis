import { realpathSync } from "node:fs";
import path from "node:path";
import { VerifyProofOperationError, assertVerifyProofCallerShape, verifyProofBranchContextWkId, verifyProofPopulationSubject } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { withOrchestratorTestProofRuntime } from "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityIdentity, resolveExecutionBranchSource } from "./managed-test-source-context.mjs";
import { resolveDispatchWorktreeProvisioningConfig } from "./dispatch-launch-runtime.mjs";
import { retainOperatorOnlyEvidence, readOperatorOnlyEvidence, activeMcpInlineByteLimit, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { retainSelectedResponseSource, readSelectedResponseSource, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { VERIFY_PROOF_TOOL_NAME, projectVerifyProofFailure, verifyProofSourceAmbiguityChoices } from "./verify-proof-public-result.mjs";
import { requestedVerifyProofSource as requestedSource } from "./verify-proof-result-reader.mjs";
import { resolveCanonicalSubjectWkId, resolveManagedRuntimeAuthority, resolveProductionContextFromRuntime } from "./verify-proof-candidate-context.mjs";
import { mintVerifyProofInvocationId, recordVerifyProofRunResult, resolveVerifyProofRunAttempt } from "./verify-proof-run-cache.mjs";
import { executeVerifyProofForContext, aggregateResult, VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION, withVerifyProofExecutionBranch, withVerifyProofInvocationTiming } from "./verify-proof-execution.mjs";
import { startTestProofInvocationTiming } from "../../../agent-launch-core/src/lib/test-proof-timing.mjs";
import { verifyProofFailureEffects } from "./verify-proof-execution-effects.mjs";
import { validatedVerifyProofEvidence, deliverStandaloneVerification, deliverManagedVerification, deliverRecordedProofProjection, recordedInvocation, deliveryFailure, shippedVerifyProofCalls } from "./verify-proof-delivery.mjs";

async function executeProductionVerifyProof({ args: received, env, responseEnv, repoRoot, repository, deps, signal,
  run }) {

  const regressionHost = { repository, sessionEnv: env, responseEnv };
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  assertVerifyProofCallerShape(received, { authenticatedRole: state.role });
  run.role = state.role;
  run.authorityIdentity = managedTestAuthorityIdentity(state);
  let args = received;
  const selectBranch = (selector, field) => {
    const selected = (deps.resolveExecutionBranchSource ?? resolveExecutionBranchSource)({ mainRepo: repoRoot,
      selector, contextWkId: verifyProofBranchContextWkId(received) });
    if (!selected.ok) throw new VerifyProofOperationError("verify_proof.execution_branch_unresolved.v1",
      field === "branch" ? "branch names no existing canonical WK or slice branch; no other source was selected"
        : "the subject's WK or slice branch does not exist; no other source was selected",
      { field, reason: selected.reason, branch_selector: selector,
        ...(selected.detail.branch === undefined ? {} : { branch: selected.detail.branch }) });
    const { branch: _selector, ...exact } = received;
    args = { ...exact, git_sha: selected.commit };
    run.args = args;
    run.branch = selected;
  };
  if (received.branch !== undefined) {
    selectBranch(received.branch, "branch");
  }
  const subjectDefault = state.role === "orchestrator" && args.git_sha === undefined;
  const wkId = state.role === "orchestrator"
    ? await (deps.resolveCanonicalSubjectWkId ?? resolveCanonicalSubjectWkId)({
      repoRoot, subject: args.subject,
      ...(args.source === undefined ? {} : { source: args.source })
    })
    : state.assignedUnit?.split("#")[0];
  if (typeof wkId !== "string") throw Object.assign(new Error(
    "launcher-bound subject has no canonical WK identity"
  ), { code: "verify_proof.subject_unknown.v1" });
  if (subjectDefault) selectBranch(verifyProofPopulationSubject(received.subject) === null ? wkId : received.subject,
    "subject");
  if (state.role !== "orchestrator") {
    let context;
    if (deps.resolveProductionContext !== undefined) {

      context = await deps.resolveProductionContext({ args, repoRoot, env, state, wkId });
    } else {
      const runtime = await resolveManagedRuntimeAuthority({ env, mainRepo: repoRoot, state, wkId });
      run.attempt = resolveVerifyProofRunAttempt(runtime);
      run.source = { kind: runtime.authority.kind,
        worktree_path: runtime.authority.worktree_path, selected_unit: runtime.selectedUnitAddress,
        ...(run.attempt === null ? {} : { source_digest: run.attempt.slice_binding.source_digest,
          credential: run.attempt.credential }) };
      context = await resolveProductionContextFromRuntime({ args, runtime });
    }
    run.executionEntered = true;
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal,
      regressionHost
    });
  }
  const result = await (deps.withOrchestratorTestProofRuntime ??
    withOrchestratorTestProofRuntime)({
    mainRepo: repoRoot,
    repository,
    selectedUnit: wkId,
    ...(args.git_sha === undefined ? {} : {
      worktreeRoot: (deps.resolveDispatchWorktreeProvisioningConfig ??
        resolveDispatchWorktreeProvisioningConfig)(env)?.worktreeRoot
    }),
    ...(args.git_sha === undefined ? {} : { gitSha: args.git_sha })
  }, async (runtime) => {
    const context = await resolveProductionContextFromRuntime({ args, runtime });
    run.executionEntered = true;
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal,
      regressionHost
    });
  });
  if (result?.schema_version === VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION) return result;
  const resolution = {
    subject: { requested: args.subject, kind: null, canonical_id: null },
    wk_id: wkId,
    contract_generation: null
  };
  return Object.freeze({ ...aggregateResult({
    resolution,
    runtime: null,
    proofResults: [],
    reasonCode: result.reason_code,
    diagnostics: [],
    requestedEnvironment: args.environment ?? null
  }), ...(result.recovery === undefined ? {} : { recovery: result.recovery }) });
}

export function createVerifyProofExecutionHandler({ resolveWorkspace, env, responseEnv,
  deps = {}, jsonContent, errorContent, requestSchema, calls = shippedVerifyProofCalls }) {
  return async (received, extra = undefined) => {
    let args = received;

    const signal = extra?.signal instanceof AbortSignal ? extra.signal : null;
    if (signal?.aborted) {
      const code = "verify_proof.execution_cancelled_before_start.v1";
      return errorContent(Object.assign(new Error(
        "workspace_verify_proof request was cancelled before any proof work started"
      ), { code, envelope: { reason_code: code, subject: { requested: received.subject },
        status: "not_executable", execution_effects: { status: "not_started" },
        stopping_condition: "The request was cancelled before execution. Issue a new execution only when it is still required.",
        next_calls: [] } }));
    }

    const run = { attempt: null, invocationId: mintVerifyProofInvocationId(), original: null, args: received,
      branch: null };

    const request = { subject: args.subject, timeout: args.timeout ?? null,
      ...(args.environment === undefined ? {} : { environment: args.environment }),
      ...(args.source === undefined ? {} : { source: {
        unit: args.source.unit, ...(args.source.focus === undefined ? {} : { focus: args.source.focus })
      } }) };
    const recordRun = (kind, record) => run.attempt === null ? null : recordVerifyProofRunResult({
      attempt: run.attempt, invocationId: run.invocationId, request, kind, record, env: responseEnv });
    let result;
    let workspace;

    const timing = startTestProofInvocationTiming();
    try {
      workspace = resolveWorkspace(args);
      result = await executeProductionVerifyProof({
        args,
        env,
        responseEnv,
        repoRoot: realpathSync(path.resolve(workspace.dir)),
        repository: workspace.repo,
        deps,
        signal,
        run
      });
      timing.stop();
      args = run.args;
      result = withVerifyProofInvocationTiming(result, timing.seal(result));
      if (run.branch !== null) result = withVerifyProofExecutionBranch(result, run.branch);
    } catch (error) {
      timing.stop();
      args = run.args;
      let envelope = projectVerifyProofFailure(error, { subject: args.subject, request: args, executionCall: calls.execution,
        timing: timing.seal() });
      let effects = verifyProofFailureEffects(error);
      if (effects === undefined) effects = { status: run.executionEntered === true ? "unknown" : "not_started" };
      if (envelope === null) return calls.unmodeledFailure({ error, effects, subject: args.subject, errorContent });
      if (effects !== undefined) envelope = { ...envelope, execution_effects: effects };
      if (envelope.reason_code === "test_proof_source_snapshot_symlink_unsupported" && run.source) {
        envelope = { ...envelope, refused_source: run.source };
      }
      envelope = await calls.refusal(envelope);

      let recordedRefusal = null;
      let retention = null;
      let ambiguityLocator = null;
      let standaloneRefusalEvidence = null;
      const sourceChoices = verifyProofSourceAmbiguityChoices(envelope);
      if (run.attempt === null) {
        try {
          if (sourceChoices === null) {
            standaloneRefusalEvidence = retainOperatorOnlyEvidence(envelope, { env: responseEnv });
          } else {
            const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
            if (state.role !== "orchestrator") {
              throw selectedResponseQueryInvalidError(VERIFY_PROOF_TOOL_NAME,
                "source_read_role_ineligible");
            }
            ambiguityLocator = retainSelectedResponseSource({
              binding: { route: VERIFY_PROOF_TOOL_NAME, repository: workspace.repo,
                unit: null, query_identity: { subject: args.subject, source: requestedSource(args) },
                observation_identity: envelope.reason_code,
                authority_identity: { session_contract: state.sessionContract } },
              carrier: envelope,
              ownerCall: (retained) => calls.originalRetained(workspace.repo, retained, args.subject),
              ownerRequestSchema: requestSchema
            }, { env: responseEnv });
          }
        } catch (retentionError) {
          retention = calls.retentionFailure(retentionError, {
            operation: sourceChoices === null ? "retain_operator_only_evidence"
              : "retain_selected_response_source",
            subject: { route: VERIFY_PROOF_TOOL_NAME, subject: args.subject, evidence: "refusal" } });
        }
      } else {
        try {
          recordedRefusal = await recordRun("refusal", envelope);
        } catch (recordingError) {
          return calls.refusalRecordingFailure({ envelope, recordingError, errorContent, request: args });
        }
      }

      const decoration = {
        ...(ambiguityLocator === null ? {} : { result: ambiguityLocator }),
        ...(recordedRefusal === null ? {} : {
          recorded_invocation: recordedInvocation(args.subject, run.invocationId, calls) }),
        ...(retention === null ? {} : { original_retention: retention }) };
      const delivered = { ...calls.presentRefusal(envelope, { responseEnv, decoration, request: args,
        retentionFailed: sourceChoices !== null && retention !== null,
        readCall: sourceChoices === null || retention !== null ? null : run.attempt === null
          ? (source) => calls.sourceRetained(workspace.repo, ambiguityLocator, args.subject, source, args)
          : (source) => calls.sourceRecorded(args.subject, run.invocationId, source, args) }),
        ...decoration };
      const projected = Object.assign(new Error(
        "workspace_verify_proof refused a modeled proof failure"
      ), { code: envelope.code, envelope: delivered });
      if (recordedRefusal !== null &&
          measureMcpInlineResultBytes(delivered, { isError: true }) > activeMcpInlineByteLimit(responseEnv)) {
        return deliverRecordedProofProjection({ run, projection: delivered, isError: true });
      }
      if (ambiguityLocator !== null &&
          measureMcpInlineResultBytes(delivered, { isError: true }) > activeMcpInlineByteLimit(responseEnv)) {
        const retained = readSelectedResponseSource(ambiguityLocator, { env: responseEnv,
          expected: { route: VERIFY_PROOF_TOOL_NAME, repository: workspace.repo } });
        const answer = selectedFullContent({ source: ambiguityLocator, retained, projection: delivered });
        answer.isError = true;
        return answer;
      }
      if (standaloneRefusalEvidence !== null &&
          measureMcpInlineResultBytes(delivered, { isError: true }) > activeMcpInlineByteLimit(responseEnv)) {

        const retained = readOperatorOnlyEvidence(standaloneRefusalEvidence, { env: responseEnv });
        const answer = selectedFullContent({ source: standaloneRefusalEvidence, retained, projection: delivered });
        answer.isError = true;
        return answer;
      }
      return errorContent(projected);
    }
    let evidence;
    try {
      evidence = await validatedVerifyProofEvidence(result, calls, args, run.role);
    } catch (error) {
      return errorContent(error);
    }
    try {
      const recorded = await recordRun("aggregate", evidence);
      if (recorded !== null) run.original = {
        recorded_invocation: recordedInvocation(args.subject, run.invocationId, calls) };
    } catch (recordingError) {
      return calls.settledFailure({ evidence, error: recordingError, jsonContent, errorContent, responseEnv });
    }
    try {
      return run.attempt === null
        ? deliverStandaloneVerification({ evidence, args, repository: workspace.repo, jsonContent,
          responseEnv, requestSchema, calls, run })
        : deliverManagedVerification({ evidence, args, run, jsonContent, responseEnv, calls });
    } catch (error) {
      return calls.settledFailure({ evidence, error: deliveryFailure(result, error), jsonContent, errorContent,
        responseEnv, original: run.original, phase: "delivery" });
    }
  };
}
