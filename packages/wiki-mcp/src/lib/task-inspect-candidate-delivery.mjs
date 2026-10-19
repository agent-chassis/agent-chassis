

import { z } from "zod";
import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { readSelectedResponseFull, readSelectedResponseProjection, retainSelectedResponseSource,
  selectedResponseLocatorSchema, selectedResponseQueryInvalidError,
  selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { INSPECT_CANDIDATE_TOOL_NAME } from "./task-inspect-candidate-response.mjs";
import { candidateInspectionView } from "./task-inspect-candidate-view.mjs";
import { jsonContent, measureMcpInlineResultBytes } from "./mcp-response.mjs";

export const CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA = z.object({
  subject: z.string().regex(/^WK-[0-9]{4}$/u),
  source: selectedResponseLocatorSchema(z)
}).strict();

const detailSchema = z.object({
  subject: z.object({ unit: CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.shape.subject }).strict(),
  selection: z.object({ kind: z.literal("current") }).strict(),
  review_subject: z.string(),
  differences: z.array(z.unknown()),
  next_calls: z.array(z.never())
}).strict();

function unavailableComparison(answer, message, problem = null) {
  answer.detail_unavailable = message;
  answer.review_consumer.recovery = problem?.recovery ?? {
    state: 'no_supported_route',
    stopping_condition: 'Stop choosing an authored correction from this comparison until its authored differences are available.'
  };
  if (problem !== null) {
    const { recovery, ...diagnosis } = problem;
    answer.detail_problem = diagnosis;
  }
}

export function candidateInspectionOriginalRequest(subject, source) {
  return CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.parse({ subject, source });
}

export function createCandidateInspectionDelivery({ workspace, env = process.env,
  responseEnv = process.env, ownerCall = null, ownerRequestSchema = null,
  route = INSPECT_CANDIDATE_TOOL_NAME } = {}) {
  if (typeof workspace?.repo !== "string" || typeof workspace?.dir !== "string") {
    throw new TypeError("candidate inspection delivery requires the server-resolved workspace");
  }
  async function expected(subject) {
    const context = await resolveObligationCoverageQueryContext({ env, workspace });

    return { route, repository: workspace.repo, unit: subject,
      authority_identity: context.identity };
  }
  async function readOriginal(request) {
    const { subject, source } = CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.parse(request);
    return readSelectedResponseProjection(source, { env: responseEnv, expected: await expected(subject),
      project: ({ carrier }) => {
        if (!detailSchema.safeParse(carrier).success || carrier.subject.unit !== subject) {
          throw selectedResponseQueryInvalidError(route, "candidate_detail_unavailable", {
            subject, correction: "This reference does not contain supported authored candidate differences. Stop this saved-comparison read; a fresh inspection is a separate current-state question." });
        }
        return carrier;
      } });
  }
  async function deliver(prepared) {
    const body = prepared.body;
    const subject = body.subject?.unit ?? body.carried?.subject?.unit;

    CANDIDATE_INSPECTION_ORIGINAL_INPUT_SCHEMA.shape.subject.parse(subject);
    const binding = await expected(subject);
    const { answer, detail } = candidateInspectionView(body);
    if (detail !== null && prepared.semanticDetail?.differences === undefined) {
      unavailableComparison(answer, prepared.semanticDetail?.unavailable ??
        'The compared authored values are unavailable; no supported detail read can answer this comparison.',
      prepared.semanticDetail?.problem ?? null);
      if (prepared.semanticDetail?.reobserve != null) answer.next_calls.push(prepared.semanticDetail.reobserve);
      return Object.freeze({ source: null, originalRequest: null,
        result: jsonContent(answer, { env: responseEnv }) });
    }
    if (detail !== null) detail.differences = prepared.semanticDetail.differences;

    if (detail === null || ownerCall === null) {
      if (detail !== null) unavailableComparison(answer,
        'Authored differences cannot be read through this serving registration; no detail reader is configured.');

      if (measureMcpInlineResultBytes(answer) > selectedResponseDeliveryBound(responseEnv)) {
        const source = retainSelectedResponseSource({ binding, carrier: answer }, { env: responseEnv });
        return Object.freeze({ source: null, originalRequest: null,
          result: readSelectedResponseFull(source, { env: responseEnv, expected: binding }) });
      }
      return Object.freeze({ source: null, originalRequest: null,
        result: jsonContent(answer, { env: responseEnv }) });
    }
    const source = retainSelectedResponseSource({
      binding: { ...binding, query_identity: body.selection ?? body.carried?.selection,
        observation_identity: {
          candidate: body.candidate ?? null,
          divergence: body.review_consumer?.divergence === null || body.review_consumer == null
            ? null : { historical_digest: body.review_consumer.divergence.historical_digest,
              live_digest: body.review_consumer.divergence.live_digest }
        } },

      carrier: detail, ownerCall, ownerRequestSchema
    }, { env: responseEnv });
    const result = await readSelectedResponseProjection(source, { env: responseEnv, expected: binding,
      project: () => ({ ...answer,
        next_calls: [...answer.next_calls, ownerCall(source)] }) });
    return Object.freeze({ source, originalRequest: candidateInspectionOriginalRequest(subject, source), result });
  }
  return Object.freeze({ deliver, readOriginal });
}
