

import { z } from "zod";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { readSelectedResponseFull, readSelectedResponseProjection, retainSelectedResponseSource,
  selectedResponseLocatorSchema } from "./selected-response-snapshot.mjs";
import { INSPECT_CANDIDATE_TOOL_NAME } from "./task-inspect-candidate-response.mjs";

export const CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA = z.object({
  subject: z.string().regex(/^WK-[0-9]{4}$/u),
  source: selectedResponseLocatorSchema(z)
}).strict();

export function candidateInspectionOriginalRequest(subject, source) {
  return CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.parse({ subject, source });
}

export function createCandidateInspectionDelivery({ workspace, env = process.env,
  responseEnv = process.env, ownerCall = null, ownerRequestSchema = null } = {}) {
  if (typeof workspace?.repo !== "string" || typeof workspace?.dir !== "string") {
    throw new TypeError("candidate inspection delivery requires the server-resolved workspace");
  }
  async function expected(subject) {
    const context = await resolveObligationCoverageQueryContext({ env, workspace });

    return { route: INSPECT_CANDIDATE_TOOL_NAME, repository: workspace.repo, unit: subject,
      authority_identity: context.identity };
  }
  async function readOriginal(request) {
    const { subject, source } = CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.parse(request);
    return readSelectedResponseFull(source, { env: responseEnv, expected: await expected(subject) });
  }
  async function deliver(prepared) {
    const body = prepared.body;
    const subject = body.subject?.unit ?? body.carried?.subject?.unit;

    CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.shape.subject.parse(subject);
    const binding = await expected(subject);
    const source = retainSelectedResponseSource({
      binding: { ...binding, query_identity: body.selection ?? body.carried?.selection,
        observation_identity: {
          candidate: body.candidate ?? null,
          divergence: body.review_consumer?.divergence === null || body.review_consumer == null
            ? null : { historical_digest: body.review_consumer.divergence.historical_digest,
              live_digest: body.review_consumer.divergence.live_digest }
        } },
      carrier: body, ownerCall, ownerRequestSchema
    }, { env: responseEnv });

    const result = await readSelectedResponseProjection(source, { env: responseEnv, expected: binding,
      project: ({ carrier }) => ({ ...carrier, original: { source },
        next_calls: [...(carrier.next_calls ?? []), ...(ownerCall === null ? [] : [ownerCall(source)])] }) });
    return Object.freeze({ source, originalRequest: candidateInspectionOriginalRequest(subject, source), result });
  }
  return Object.freeze({ deliver, readOriginal });
}
