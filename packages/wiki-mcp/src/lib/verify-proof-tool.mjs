import { realpathSync } from "node:fs";
import path from "node:path";
import { assertVerifyProofCallerShape, verifyProofTimeoutInputSchema }
  from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { withOrchestratorTestProofRuntime } from "../../../agent-launch-cli/src/lib/workspace-agent-orchestrator-test-proof-runtime.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { resolveDispatchWorktreeProvisioningConfig } from "./dispatch-launch-runtime.mjs";
import { activeMcpInlineByteLimit, assertNoControlledContractRawResponse,
  measureMcpInlineResultBytes, persistVerifyProofEvidenceReference } from "./mcp-response.mjs";
import { VERIFY_PROOF_TOOL_NAME, projectPublicVerifyProofAggregate, projectVerifyProofFailure,
  projectVerifyProofSummary } from "./verify-proof-public-result.mjs";
import { resolveCanonicalSubjectWkId, resolveManagedRuntimeAuthority, resolveProductionContextFromRuntime }
  from "./verify-proof-candidate-context.mjs";
import { mintVerifyProofInvocationId, recordVerifyProofRunResult, resolveVerifyProofRunAttempt }
  from "./verify-proof-run-cache.mjs";
import { executeVerifyProofForContext, aggregateResult, VERIFY_PROOF_AGGREGATE_SCHEMA_VERSION }
  from "./verify-proof-execution.mjs";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";
export { executeVerifyProofForContext, projectDefinitionRepairQuestion } from "./verify-proof-execution.mjs";

async function executeProductionVerifyProof({ args, env, repoRoot, repository, deps, signal, run }) {
  const state = (deps.resolveLauncherRunState ?? resolveLauncherRunState)(env);
  assertVerifyProofCallerShape(args, { authenticatedRole: state.role });
  const wkId = state.role === "orchestrator"
    ? await (deps.resolveCanonicalSubjectWkId ?? resolveCanonicalSubjectWkId)({
      repoRoot, subject: args.subject, gitSha: args.git_sha,
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.git_sha === undefined ? {} : { worktreeRoot: (deps.resolveDispatchWorktreeProvisioningConfig ??
        resolveDispatchWorktreeProvisioningConfig)(env)?.worktreeRoot })
    })
    : state.assignedUnit?.split("#")[0];
  if (typeof wkId !== "string") throw Object.assign(new Error(
    "launcher-bound subject has no canonical WK identity"
  ), { code: "verify_proof.subject_unknown.v1" });
  if (state.role !== "orchestrator") {
    let context;
    if (deps.resolveProductionContext !== undefined) {

      context = await deps.resolveProductionContext({ args, repoRoot, env, state, wkId });
    } else {
      const runtime = await resolveManagedRuntimeAuthority({ env, mainRepo: repoRoot, state, wkId });
      run.attempt = resolveVerifyProofRunAttempt(runtime);
      context = await resolveProductionContextFromRuntime({ args, runtime });
    }
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal
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
    return executeVerifyProofForContext({
      args,
      resolutionContext: context.resolutionContext,
      runtime: context.runtime,
      deps,
      signal
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

function validatedVerifyProofEvidence(result) {
  const evidence = projectPublicVerifyProofAggregate(result);
  assertNoControlledContractRawResponse(evidence, { toolName: VERIFY_PROOF_TOOL_NAME });
  return evidence;
}

function deliverVerifyProofEvidence({ evidence, jsonContent, responseEnv, persistEvidence }) {
  const persisted = persistEvidence({ evidence, evidenceIdentity: evidence.result_digest },
    { env: responseEnv });
  if (persisted.status !== "persisted") return persisted.result;
  const inlineByteLimit = activeMcpInlineByteLimit(responseEnv);
  const summary = projectVerifyProofSummary(evidence, {
    evidenceReference: persisted.reference,
    fits: (candidate) => measureMcpInlineResultBytes(candidate) <= inlineByteLimit
  });
  return jsonContent(summary);
}

function deliveryFailure(result, error) {
  return Object.assign(new Error(
    "workspace_verify_proof settled its execution but could not deliver the result"
  ), { code: "verify_proof.result_delivery_failed.v1", details: {
    authority_limb: "mechanical_failure",
    execution_status: typeof result?.status === "string" ? result.status : null,
    result_digest: typeof result?.result_digest === "string" ? result.result_digest : null,
    cause_code: typeof error?.code === "string" ? error.code : null
  } });
}

const VERIFY_PROOF_DESCRIPTION = "Execute existing saved proofs selected by one subject per call, using installed providers, with timeout and cancellation support. Each requested proof is proven, unproven or not_executable for the tested source only, never for the whole unit. Rows name the selected test and its observed outcome (passed, failed, skipped or not_observed) separately from mutation evidence: a detected mutation adds falsification evidence, a surviving mutation is counterevidence, and unavailable mutation is a capability limitation that neither earns nor withholds credit, so a passing selected test with unavailable mutation and every other required check holding is proven with that limitation. Incomplete or unevaluable required evidence is not_executable with its reason codes. Rows carry the actual evaluator diagnostic codes and a recovery only where a correction is known. A canonical work-record ID or slice address selects that unit's saved proof population; a saved test_proof_id or obligation_id narrows verification to that subject. When that ID is saved in more than one source, the bare call refuses and lists every source choice; add source {unit, focus?}, where unit is the canonical work-record ID or slice address holding the saved proof, to select exactly one. Return advisory results with lossless evidence retrieval.";
const VERIFY_PROOF_SOURCE_DESCRIPTION =
  "Optional for a saved test_proof_id or obligation_id only; refused with a WK or slice subject. " +
  "Selects exactly one saved proof source: unit is the source's WK ID or slice address and focus is " +
  "its controlled-contract focus. Omitted focus selects the root source. The subject must exist in " +
  "that source; no other source is searched. Selection grants no execution authority.";
const VERIFY_PROOF_ENVIRONMENT_DESCRIPTION =
  "Optional. Names one prepared environment that local test-runtime setup published, as " +
  "<ecosystem>@<repository-relative installation root> (for example \"npm@.\", \"go_modules@services/api\" " +
  "or \"python@tools/lint\"); setup's readiness report lists every environment with its workspace members " +
  "and proved runners. Omitted, each selected test routes independently: its saved runner binding names the " +
  "dependency ecosystem, the target suffix is recorded as a language hint, and the environment whose " +
  "installation root owns the target runs it, so one call may use several environments and languages. " +
  "Named, it must serve every selected proof (same ecosystem, runner proved there, target inside it) or the " +
  "call refuses before anything executes and lists each incompatible target and the valid choices; nothing is " +
  "filtered out. It is an identity only, never a command, path, variable, root or mount, and grants no " +
  "visibility, source or preparation.";
const VERIFY_PROOF_SOURCE_UNIT_DESCRIPTION =
  "The saved proof source's canonical WK ID (\"WK-1234\") or slice address (\"WK-1234#SLICE-001\").";

export function registerVerifyProofTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  env = process.env,
  responseEnv = process.env,
  persistEvidence = persistVerifyProofEvidenceReference,
  deps = {}
}) {
  registerTool(VERIFY_PROOF_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: VERIFY_PROOF_DESCRIPTION,
    inputSchema: z.object({
      subject: z.string().min(1).max(512).describe(
        "Exactly one saved proof subject: a canonical WK ID (\"WK-1234\") or slice address " +
        "(\"WK-1234#SLICE-001\") selects that unit's saved proof population; a saved test_proof_id " +
        "(\"test-proof-00170a30e83e042b20d409d42a2bb49cd3da7cda\") or obligation_id (\"ANON-BOUNDS\") " +
        "narrows verification to that subject. " +
        "Use separate calls for multiple subjects. Unknown or ambiguous subjects refuse without executing."
      ),
      source: z.object({
        unit: proofAuthoringUnitInputSchema(z).describe(VERIFY_PROOF_SOURCE_UNIT_DESCRIPTION),
        focus: proofAuthoringFocusInputSchema(z).optional()
      }).strict().optional().describe(VERIFY_PROOF_SOURCE_DESCRIPTION),
      repo: z.string().optional(),
      timeout: verifyProofTimeoutInputSchema(z),
      environment: z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE).optional()
        .describe(VERIFY_PROOF_ENVIRONMENT_DESCRIPTION),
      git_sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).optional()
    }).strict()
  }, async (args, extra = undefined) => {

    const signal = extra?.signal instanceof AbortSignal ? extra.signal : null;
    if (signal?.aborted) {
      return errorContent(Object.assign(new Error(
        "workspace_verify_proof request was cancelled before any proof work started"
      ), { code: "verify_proof.execution_cancelled_before_start.v1" }));
    }

    const run = { attempt: null, invocationId: mintVerifyProofInvocationId() };

    const request = { subject: args.subject, timeout: args.timeout ?? null,
      ...(args.environment === undefined ? {} : { environment: args.environment }),
      ...(args.source === undefined ? {} : { source: {
        unit: args.source.unit, ...(args.source.focus === undefined ? {} : { focus: args.source.focus })
      } }) };
    const recordRun = (kind, record) => run.attempt === null ? null : recordVerifyProofRunResult({
      attempt: run.attempt, invocationId: run.invocationId, request, kind, record, env: responseEnv });
    let result;
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      result = await executeProductionVerifyProof({
        args,
        env,
        repoRoot: realpathSync(path.resolve(workspace.dir)),
        repository: workspace.repo,
        deps,
        signal,
        run
      });
    } catch (error) {
      const envelope = projectVerifyProofFailure(error, { subject: args.subject, request: args });
      if (envelope === null) return errorContent(error);
      try {
        await recordRun("refusal", envelope);
      } catch (recordingError) {
        return errorContent(recordingError);
      }
      const projected = Object.assign(new Error(
        "workspace_verify_proof refused a modeled proof failure"
      ), { code: envelope.code, envelope });
      return errorContent(projected);
    }
    let evidence;
    try {
      evidence = validatedVerifyProofEvidence(result);
    } catch (error) {
      return errorContent(error);
    }
    try {
      await recordRun("aggregate", evidence);
    } catch (recordingError) {
      return errorContent(recordingError);
    }
    try {
      return deliverVerifyProofEvidence({ evidence, jsonContent, responseEnv, persistEvidence });
    } catch (error) {
      return errorContent(deliveryFailure(result, error));
    }
  });
}
