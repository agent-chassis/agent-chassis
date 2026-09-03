import { compiledValidators } from "./compiled-validator-cache.mjs";

import OBLIGATION_COVERAGE_SCHEMA from
  "../schema/controlled-contract-obligation-coverage.v1.schema.json" with { type: "json" };
import {
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";

const OBLIGATION_COVERAGE_SCHEMA_VERSION =
  "controlled-contract-obligation-coverage.v1";
const OBLIGATION_COVERAGE_GAP_KINDS = Object.freeze([
  "catalog_gap", "mechanism_gap", "implementation_not_delivered",
  "existing_mechanism_unextended", "review_only", "no_proof_required"
]);
const OBLIGATION_COVERAGE_MECHANISM_KINDS = Object.freeze([
  "code_symbol", "schema", "test", "configuration", "durable_record",
  "tool_operation"
]);

const { validateSchema } = await compiledValidators(
  "controlled-contract.obligation-coverage-carrier.v1",
  { validators: { validateSchema: OBLIGATION_COVERAGE_SCHEMA } }
);

function schemaDiagnostics() {
  return (validateSchema.errors ?? []).map((error) => ({
    code: "obligation_coverage_schema_invalid",
    pointer: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "obligation coverage schema validation failed"
  })).sort((left, right) =>
    compareCodeUnits(left.pointer, right.pointer) ||
    compareCodeUnits(left.keyword, right.keyword) ||
    compareCodeUnits(left.message, right.message)
  );
}

function semanticDiagnostics(carrier) {
  const diagnostics = [];
  const obligationIds = new Map();
  const creditedTuples = new Map();
  for (const [index, row] of carrier.obligations.entries()) {
    if (obligationIds.has(row.obligation_id)) diagnostics.push({
      code: "obligation_coverage_obligation_id_duplicate",
      obligation_id: row.obligation_id,
      first_index: obligationIds.get(row.obligation_id),
      duplicate_index: index
    });
    else obligationIds.set(row.obligation_id, index);
    if (row.statement !== row.statement.trim() || /[\r\n]/u.test(row.statement)) {
      diagnostics.push({
        code: "obligation_coverage_statement_not_atomic",
        obligation_id: row.obligation_id,
        index
      });
    }
    if (new Set(row.controlled_contract_node_ids).size !==
        row.controlled_contract_node_ids.length) diagnostics.push({
      code: "obligation_coverage_controlled_node_duplicate",
      obligation_id: row.obligation_id,
      index
    });
    if (row.proof.kind !== "pack_mapping") continue;
    for (const nodeId of row.controlled_contract_node_ids) {
      const tuple = [
        row.proof.pack_id, row.proof.selector.kind,
        row.proof.selector.component_id, nodeId
      ].join("\0");
      if (creditedTuples.has(tuple)) diagnostics.push({
        code: "obligation_coverage_credit_tuple_duplicate",
        obligation_ids: [row.obligation_id, creditedTuples.get(tuple)]
          .sort(compareCodeUnits),
        pack_id: row.proof.pack_id,
        selector: structuredClone(row.proof.selector),
        node_id: nodeId
      });
      else creditedTuples.set(tuple, row.obligation_id);
    }
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  );
}

function validateObligationCoverageCarrier(carrier) {
  const schemaValid = validateSchema(carrier);
  const schemaErrors = schemaValid ? [] : schemaDiagnostics();
  const diagnostics = schemaValid ? semanticDiagnostics(carrier) : [];
  const valid = schemaValid && diagnostics.length === 0;
  return deepFreeze({
    schema_valid: schemaValid,
    schema_errors: schemaErrors,
    diagnostics,
    valid,
    carrier: valid ? structuredClone(carrier) : null
  });
}

export {
  OBLIGATION_COVERAGE_GAP_KINDS,
  OBLIGATION_COVERAGE_MECHANISM_KINDS,
  OBLIGATION_COVERAGE_SCHEMA,
  OBLIGATION_COVERAGE_SCHEMA_VERSION,
  validateObligationCoverageCarrier
};
