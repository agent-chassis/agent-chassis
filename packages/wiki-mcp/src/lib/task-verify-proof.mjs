
import { z } from "zod";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";
import { verifyProofTimeoutInputSchema } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { createVerifyProofExecutionHandler } from "./verify-proof-execution-handler.mjs";
import { preparedVerifyProofCalls, projectVerifyProofRecoveryForRegisteredTools } from "./verify-proof-delivery.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { selectedResponseDetailSchema, selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";

export const VERIFY_PROOF_TASK = "verify_proof";
export const VERIFY_PROOF_EXECUTION_INPUT_SCHEMA = z.object({
  subject: z.string().min(1).max(512).describe("One saved proof, obligation, WK or slice subject."),
  source: z.object({ unit: proofAuthoringUnitInputSchema(z),
    focus: proofAuthoringFocusInputSchema(z).optional() }).strict().optional()
    .describe("Exact authored source for a saved proof or obligation; grants no execution authority."),
  branch: z.string().min(1).max(128).optional()
    .describe("Orchestrator only: the execution branch as a WK ID, slice ID or canonical WK or slice branch name; runs the commit it names now. Not with git_sha."),
  git_sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).optional()
    .describe("Orchestrator only: an exact full commit. Neither given: the subject's WK or slice branch."),
  environment: z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE).optional()
    .describe("One existing prepared environment identity serving every selected proof."),
  timeout: verifyProofTimeoutInputSchema(z)
}).strict();

const retainedRequestSchema = selectedResponseRequestSchema(z.object({
  result: selectedResponseDetailSchema(z).shape.source
}).strict());

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
      projectVerifyProofRecoveryForRegisteredTools(evidence, { requestContracts, receivingRole,
        resolveAuthoringSource: () => resolveObligationCoverageQueryContext({ workspace, env: sessionEnv }) })) });
  return async (request, extra = undefined) => {
    const parsed = VERIFY_PROOF_EXECUTION_INPUT_SCHEMA.safeParse(request);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      return errorContent(Object.assign(new Error("verify_proof execution request is invalid"), {
        code: "verify_proof.execution_request_invalid.v1",
        envelope: { code: "verify_proof.execution_request_invalid.v1", accepted: false,
          stage: "request_validation", executed: false,
          subject: typeof request?.subject === "string" && request.subject.length <= 512
            ? request.subject : null,
          invalid_fields: issues.slice(0, 12).map(({ path, code, keys }) => ({ path, code,
            ...(keys === undefined ? {} : {
              unsupported_keys: keys.filter((key) => key.length <= 128).slice(0, 12),
              unsupported_key_count: keys.length }) })),
          issue_count: issues.length,
          correction: "Supply subject and only source, branch, git_sha, environment or timeout execution selectors.",
          next_calls: [] }
      }));
    }
    return handler(parsed.data, extra);
  };
}

export function registerVerifyProofTask({ registerTool, ...host }) {
  registerTool(VERIFY_PROOF_TASK, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: "Execute selected saved proofs in the authenticated source. Returns bounded outcomes and common-reader requests for settled originals. Advisory results.",
    inputSchema: VERIFY_PROOF_EXECUTION_INPUT_SCHEMA
  }, createVerifyProofTask({ ...host, requestContracts: registeredToolRequestContracts(registerTool) }));
}
