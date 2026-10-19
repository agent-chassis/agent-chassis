

import { resolveObligationCoverageQueryContext } from "./controlled-contract-query-context.mjs";
import { readSelectedResponseProjection, retainSelectedResponseSource } from "./selected-response-snapshot.mjs";

function diagnosis(level) {
  const answer = Object.fromEntries(["message", "code", "value", "path", "syscall", "errno", "status", "signal"]
    .filter(key => Object.hasOwn(level, key)).map(key => [key, level[key]]));
  if (typeof level.detail?.condition === "string") answer.condition = level.detail.condition;

  for (const key of ["cause", "write_failure", "reobservation_failure"]) {
    const child = level.detail?.[key];
    if (child !== null && typeof child === "object") answer[key] = diagnosis(child);
  }
  if (level.process_failure !== undefined) {
    answer.process_failure = Object.fromEntries(["message", "errors", "code", "path", "syscall", "errno", "status", "signal"]
      .filter(key => Object.hasOwn(level.process_failure, key)).map(key => [key, level.process_failure[key]]));
  }
  return answer;
}

export function projectAdvanceCandidateResponse(result) {
  const base = { ok: result.ok, outcome: result.outcome, subject: result.subject };
  if (result.ok) {
    return Object.freeze({ ...base,
      ...(result.outcome === "converged" ? { write_attribution: "not_established" } : {}),
      next_calls: result.next_calls });
  }
  const effects = result.known_effects;
  const changed = effects.candidate_refs === "unchanged" ||
    effects.candidate_refs === "unchanged_no_transaction_attempted" ? "unchanged"
    : effects.candidate_refs;
  const mismatch = result.observed_facts?.["advance_candidate.observed_selection"];
  const recovery = Object.fromEntries(Object.entries(result.recovery)
    .filter(([key]) => !["selected_from", "information", "operator_action"].includes(key)));
  const native = result.cause.candidate_failure?.detail;
  return Object.freeze({ ...base,
    selection: { ...result.selection,
      ...(result.source === null && mismatch === undefined ? { authentication: "unverified" } : {}) },
    code: result.cause.code,
    cause: {
      ...(result.cause.exclusion_reason === undefined ? {} : { exclusion_reason: result.cause.exclusion_reason }),
      ...(result.cause.observation === undefined ? {} : { observation: result.cause.observation }),
      ...(result.cause.exclusion_reason === undefined
        ? { diagnosis: (result.cause.evidence?.cause_chain ?? []).map(diagnosis) } : {}),
      ...(native?.git_diagnosis == null ? {} : { git_diagnosis: native.git_diagnosis })
    },
    ...(mismatch === undefined ? {} : { selection_conflict: { observed_version: mismatch.version_identity } }),
    known_effects: { selection_and_version: changed,
      ...(effects.git_objects === "candidate_derivation_completed" ||
          effects.git_objects === "derivation_incomplete_objects_possible"
        ? { candidate_preparation: "objects_may_remain_without_confirmed_advancement" } : {}) },
    recovery,
    ...(result.no_supported_route === true ? { no_supported_route: true } : {}),
    next_calls: result.next_calls });
}

export async function deliverAdvanceCandidateResponse({ body, workspace, env, responseEnv,
  ownerCall, ownerRequestSchema }) {
  const context = await resolveObligationCoverageQueryContext({ env, workspace });
  const binding = { route: "workspace_advance_candidate", repository: workspace.repo,
    unit: body.subject.unit, authority_identity: context.identity };
  const source = retainSelectedResponseSource({ binding: { ...binding,
    query_identity: body.selection ?? null, observation_identity: { outcome: body.outcome } },
    carrier: body, ownerCall, ownerRequestSchema }, { env: responseEnv });
  return readSelectedResponseProjection(source, { env: responseEnv, expected: binding,
    project: ({ carrier }) => carrier });
}
