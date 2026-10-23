

import { z } from "zod";
import { CODE_INDEX_QUERY_ROUTE } from "./code-index-query-contract.mjs";
import { readSelectedResponseEvidence, selectedResponseLocatorSchema, selectedResponseQueryInvalidError } from
  "./selected-response-snapshot.mjs";

const SOURCE_LOCATOR_SCHEMA = selectedResponseLocatorSchema(z);

export function readRetainedGraphImpact(source, { repository, responseEnv = process.env }) {
  if (!SOURCE_LOCATOR_SCHEMA.safeParse(source).success) {
    throw selectedResponseQueryInvalidError(CODE_INDEX_QUERY_ROUTE, "graph_impact_source_invalid",
      { accepted_form: `the exact selected_detail.source {ref_id} of a ${CODE_INDEX_QUERY_ROUTE} change-impact answer` });
  }
  const { envelope, evidence } = readSelectedResponseEvidence(source, { env: responseEnv,
    expected: { route: CODE_INDEX_QUERY_ROUTE, repository, unit: null } });
  const { workspaceRepo: _workspaceRepo, ...answer } = envelope.carrier;
  if (answer.query_kind !== "impact") {
    throw selectedResponseQueryInvalidError(CODE_INDEX_QUERY_ROUTE, "graph_impact_source_not_impact",
      { query_kind: typeof answer.query_kind === "string" ? answer.query_kind : null });
  }
  return { answer, binding: envelope.binding, evidence };
}
