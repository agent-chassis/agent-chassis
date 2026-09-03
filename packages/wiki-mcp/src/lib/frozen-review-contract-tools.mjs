import {
  queryFrozenReviewContract
} from "../../../wiki-core/src/lib/frozen-review-contract-query.mjs";
import {
  resolveFrozenReviewContractArtifact,
  resolveLauncherRunState
} from "./launcher-run-credential.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

export const WORKSPACE_FROZEN_REVIEW_CONTRACT_QUERY_TOOL_NAME =
  "workspace_frozen_review_contract_query";

export const FROZEN_REVIEW_CONTRACT_QUERY_REQUEST_KEYS = Object.freeze([
  "target",
  "cursor"
]);

function requestShape(request) {
  return Boolean(request && typeof request === "object" && !Array.isArray(request)) &&
    Object.keys(request).every((key) => FROZEN_REVIEW_CONTRACT_QUERY_REQUEST_KEYS.includes(key));
}

export function createFrozenReviewContractQueryHandler({
  resolveFrozenReviewContract = resolveFrozenReviewContractArtifact,
  resolveState = resolveLauncherRunState,
  query = queryFrozenReviewContract
} = {}) {
  if (typeof resolveFrozenReviewContract !== "function")
    throw new TypeError("resolveFrozenReviewContract must be a function");
  if (typeof resolveState !== "function")
    throw new TypeError("launcher state resolver must be a function");
  if (typeof query !== "function") throw new TypeError("query must be a function");

  return (request = {}) => {

    if (!requestShape(request)) return query({ artifact: null, request });
    const state = resolveState();
    const artifact = resolveFrozenReviewContract({ state });
    return query({ artifact, request });
  };
}

export const runFrozenReviewContractQuery = createFrozenReviewContractQueryHandler;

export function registerFrozenReviewContractTools({
  registerTool,
  z,
  resolveFrozenReviewContract = resolveFrozenReviewContractArtifact,
  resolveState,
  query = queryFrozenReviewContract
} = {}) {
  if (typeof registerTool !== "function") throw new TypeError("registerTool must be a function");
  if (!z?.object || !z?.enum || !z?.string) throw new TypeError("zod is required");
  const requestSchema = z.object({
    target: z.enum(["acceptance_criteria", "acceptance_validation"]).optional(),
    cursor: z.string().min(1).optional()
  }).strict();
  const handler = createFrozenReviewContractQueryHandler({
    resolveFrozenReviewContract,
    resolveState,
    query
  });
  const contentHandler = (request) => {
    const result = handler(request);
    return result?.status === "refused"
      ? errorContent({ envelope: result })
      : jsonContent(result);
  };
  registerTool(
    WORKSPACE_FROZEN_REVIEW_CONTRACT_QUERY_TOOL_NAME,
    {
      description:
        "Read the launcher-frozen acceptance contract bound to this managed review.",
      inputSchema: requestSchema
    },
    contentHandler
  );
  return Object.freeze({
    name: WORKSPACE_FROZEN_REVIEW_CONTRACT_QUERY_TOOL_NAME,
    inputSchema: requestSchema,
    handler
  });
}
