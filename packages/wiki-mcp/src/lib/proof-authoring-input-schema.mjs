import {
  CONTROLLED_CONTRACT_FOCUS_GRAMMAR,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA,
  isControlledContractFocus
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

import { requestSchema } from "./proof-request-schema.mjs";
import { declareRequestConstraints } from
  "./zod-request-constraint-declarations.mjs";
import { selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";

const QUERY_TOOL_NAME = "workspace_controlled_contract_obligation_coverage_query";

export function proofAuthoringUnitInputSchema(z) {
  const declared = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA;
  return requestSchema(z, declared.properties.unit, declared.$defs);
}

export function proofAuthoringFocusInputSchema(z) {
  return declareRequestConstraints(
    z.string().regex(new RegExp(CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern))
      .refine(isControlledContractFocus)
      .describe(CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form),
    [{ constraint: "max_bytes",
      maximum_bytes: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.maximum_bytes,
      measurement: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.measurement,
      statement: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form }]
  );
}

export function proofAuthoringSchema(tool, z, focus) {
  const operation = tool.name === "workspace_validate_proof"
    ? "validate" : tool.name.split("_").at(-1);

  return requestSchema(z, tool.inputSchema, tool.inputSchema.$defs,
    { memoize: operation === "upsert" }).extend({ focus,
    ...(tool.name === QUERY_TOOL_NAME ? {
      detail: selectedResponseDetailSchema(z).optional().describe("Read one bounded page of a retained " +
        "query result, exactly as a next_calls entry states it. Takes unit and repo only.") } : {}) });
}

export function createProofAuthoringQueryInputSchema(z) {
  const tool = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS.find(
    ({ name }) => name === "workspace_controlled_contract_obligation_coverage_query");
  if (tool === undefined) throw new Error("proof-authoring query declaration is unavailable");
  return proofAuthoringSchema(tool, z, proofAuthoringFocusInputSchema(z).optional());
}
