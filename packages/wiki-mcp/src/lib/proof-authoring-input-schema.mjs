import {
  CONTROLLED_CONTRACT_FOCUS_GRAMMAR,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA,
  isControlledContractFocus
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

import { requestSchema } from "./proof-request-schema.mjs";
import { declareRequestConstraints } from
  "./zod-request-constraint-declarations.mjs";

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
