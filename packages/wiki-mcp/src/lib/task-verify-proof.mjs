
import { z } from "zod";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";
import { verifyProofTimeoutInputSchema } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { createVerifyProofExecutionHandler } from "./verify-proof-execution-handler.mjs";
import { preparedVerifyProofCalls, projectVerifyProofRecoveryForRegisteredTools } from "./verify-proof-delivery.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { MCP_WRITE_SEMANTICS, projectToolInputValidationFailure } from "./register-tool.mjs";
import { selectedResponseDetailSchema, selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";

export const VERIFY_PROOF_TASK = "verify_proof";
export const VERIFY_PROOF_EXECUTION_INPUT_SCHEMA = z.object({
  subject: z.string().min(1).max(512).describe("A saved test_proof_id or obligation_id, or a WK/slice population such as WK-1234 or WK-1234#SLICE-001."),
  source: z.object({ unit: proofAuthoringUnitInputSchema(z),
    focus: proofAuthoringFocusInputSchema(z).optional() }).strict().optional()
    .describe("Exact authored source for an individual proof/obligation only. Omitted focus selects root; no other source is searched. Not with a WK/slice population. Grants no execution authority."),
  branch: z.string().min(1).max(128).optional()
    .describe("Orchestrator only: the execution branch as a WK ID, slice ID or canonical WK or slice branch name; runs the commit it names now. Not with git_sha."),
  git_sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).optional()
    .describe("Orchestrator only: an exact full hexadecimal commit; branch selectors belong in branch. Neither given: the subject's WK or slice branch."),
  environment: z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE).optional()
    .describe("One existing prepared environment identity serving every selected proof. Omitted: route each proof independently to its owning prepared environment."),
  timeout: verifyProofTimeoutInputSchema(z)
}).strict();

const retainedRequestSchema = selectedResponseRequestSchema(z.object({
  result: selectedResponseDetailSchema(z).shape.source
}).strict());

async function inputFailure(args, validationError) {
  return { ...await projectToolInputValidationFailure({ tool: VERIFY_PROOF_TASK, args, validationError,
    inputSchema: VERIFY_PROOF_EXECUTION_INPUT_SCHEMA }), executed: false };
}

export function verifyProofExecutionCall(request, { recommended = false } = {}) {
  return Object.freeze({ tool: VERIFY_PROOF_TASK, ...(recommended ? { recommended: true } : {}),
    arguments: VERIFY_PROOF_EXECUTION_INPUT_SCHEMA.parse(request) });
}

export function createVerifyProofTask({ workspace, sessionEnv, responseEnv,
  jsonContent, errorContent, deps = {}, requestContracts, receivingRole = null }) {
  const handler = createVerifyProofExecutionHandler({ resolveWorkspace: () => workspace,
    env: sessionEnv, responseEnv, jsonContent, errorContent, deps,
    requestSchema: retainedRequestSchema,
    calls: preparedVerifyProofCalls(verifyProofExecutionCall, evidence =>
      projectVerifyProofRecoveryForRegisteredTools(evidence, { requestContracts, receivingRole, workspace, sessionEnv, responseEnv,
        resolveAuthoringSource: () => resolveObligationCoverageQueryContext({ workspace, env: sessionEnv }) })) });
  return async (request, extra = undefined) => {
    const parsed = VERIFY_PROOF_EXECUTION_INPUT_SCHEMA.safeParse(request);
    if (!parsed.success) {
      const envelope = await inputFailure(request, parsed.error);
      return errorContent(Object.assign(new Error('verify_proof execution request is invalid'), {
        code: envelope.code, envelope }));
    }
    return handler(parsed.data, extra);
  };
}

export function registerVerifyProofTask({ registerTool, ...host }) {
  registerTool(VERIFY_PROOF_TASK, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: "Execute an authorized saved proof selection; cases, targets and providers come from saved prerequisites. Source selects authored meaning; branch/git_sha separately select orchestrator code. Workers and eligible reviewers use their bound code. A slice selection also runs its entire regression_tests list once, even when proofs are narrowed. Returns the observed outcome and deciding problems; process success alone establishes no requirement credit. Use offered get_run_result calls only for needed diagnosis; reads never execute. Advisory results.",
    inputSchema: VERIFY_PROOF_EXECUTION_INPUT_SCHEMA,
    advertisedInputSchema: VERIFY_PROOF_EXECUTION_INPUT_SCHEMA,
    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
      ...host.jsonContent(await inputFailure(args, validationError)), isError: true } })
  }, createVerifyProofTask({ ...host, requestContracts: registeredToolRequestContracts(registerTool) }));
}
