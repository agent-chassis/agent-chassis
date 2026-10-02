import { compiledValidators } from "./compiled-validator-cache.mjs";

import OBLIGATION_COVERAGE_SCHEMA from
  "../schema/resolved-obligation-coverage.v1.schema.json" with { type: "json" };
import {
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";

const OBLIGATION_COVERAGE_SCHEMA_VERSION =
  "resolved-obligation-coverage.v1";
const OBLIGATION_COVERAGE_GAP_KINDS = Object.freeze([]);
const OBLIGATION_COVERAGE_MECHANISM_KINDS = Object.freeze(
  [...OBLIGATION_DRAFT_SCHEMA.$defs.mechanism.properties.kind.enum]);

import OBLIGATION_DRAFT_SCHEMA from
  "../schema/controlled-contract-obligation-coverage.v3.schema.json" with { type: "json" };
import { testProofSchemaVocabularyMismatches } from "./test-proof-provider-registry.mjs";
const OBLIGATION_DRAFT_SCHEMA_VERSION = "controlled-contract-obligation-coverage.v3";

const STALE_CASE_VOCABULARY = testProofSchemaVocabularyMismatches("obligation_coverage",
  OBLIGATION_DRAFT_SCHEMA);
if (STALE_CASE_VOCABULARY.length > 0) {
  throw new Error("obligation coverage schema disagrees with the provider catalog at " +
    STALE_CASE_VOCABULARY.join(", "));
}
const OBLIGATION_COVERAGE_MAX_ROWS = 4096;
const OBLIGATION_COVERAGE_MAX_BYTES = 1048576;

export const PROOF_AUTHORING_FIELDS = Object.freeze([
  'statement', 'controlled_contract_node_ids', 'mechanism', 'proof_name',
  'parameters', 'clear_parameters', 'refresh_proof_version', 'acceptance_criteria', 'proof_opt_out'
]);
export const PROOF_AUTHORING_FIELD_SCHEMAS = deepFreeze({
  ...Object.fromEntries(['statement', 'controlled_contract_node_ids', 'mechanism'].map(key => {
    const property = OBLIGATION_DRAFT_SCHEMA.$defs.obligation.properties[key];
    const schema = property.$ref ? OBLIGATION_DRAFT_SCHEMA.$defs[property.$ref.split('/').at(-1)] : property;
    return [key, key === 'mechanism' ? { anyOf: [schema, { type: 'null' }] } : schema];
  })),
  proof_name: { type: 'string', minLength: 1, description: 'Exact proof catalog entry name, not a ' +
    'title or case ID; see workspace_controlled_proof_intents_discover. Unknown names refuse.' },
  parameters: { type: 'object', additionalProperties: true },
  clear_parameters: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
  refresh_proof_version: { const: true },
  acceptance_criteria: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 },
    description: 'Criterion identities from query acceptance_criteria[].identity that this obligation ' +
      'covers, all on the selected unit. Replaces the saved associations; [] clears them; omission preserves.' },
  proof_opt_out: { type: 'boolean', description: 'true records that the author declines proof for ' +
    'this obligation; it still covers its associated criteria and grants no verification credit. ' +
    'false clears it. Refused together with a proof selection or case.' }
});
const { validateAmendment } = await compiledValidators('controlled-contract.proof-authoring-amendment.v1', {
  validators: { validateAmendment: { type: 'object', additionalProperties: false,
    $defs: OBLIGATION_DRAFT_SCHEMA.$defs, properties: PROOF_AUTHORING_FIELD_SCHEMAS } }
});

function validateProofAuthoringAmendment(value) {
  return jsonData(value) && validateAmendment(value);
}
Object.defineProperty(validateProofAuthoringAmendment, 'errors', {
  get: () => validateAmendment.errors ?? []
});
export { validateProofAuthoringAmendment };

const { validateDraftSchema } = await compiledValidators(
  "controlled-contract.obligation-draft.v3",
  { validators: { validateDraftSchema: OBLIGATION_DRAFT_SCHEMA } }
);
const { validateSchema } = await compiledValidators(
  "controlled-contract.obligation-coverage-carrier.v1",
  { schemas: [OBLIGATION_DRAFT_SCHEMA], validators: { validateSchema: OBLIGATION_COVERAGE_SCHEMA } }
);

function schemaDiagnostics(validator = validateSchema) {
  return (validator.errors ?? []).map((error) => ({
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

  for (const [index, row] of carrier.obligations.entries()) {
    if (obligationIds.has(row.obligation_id)) diagnostics.push({
      code: "obligation_coverage_obligation_id_duplicate",
      obligation_id: row.obligation_id,
      first_index: obligationIds.get(row.obligation_id),
      duplicate_index: index
    });
    else obligationIds.set(row.obligation_id, index);
    if (row.statement !== undefined && (row.statement !== row.statement.trim() || /[\r\n]/u.test(row.statement))) {
      diagnostics.push({
        code: "obligation_coverage_statement_not_atomic",
        obligation_id: row.obligation_id,
        index
      });
    }
    if (new Set(row.controlled_contract_node_ids ?? []).size !==
        (row.controlled_contract_node_ids ?? []).length) diagnostics.push({
      code: "obligation_coverage_controlled_node_duplicate",
      obligation_id: row.obligation_id,
      index
    });
    const pinFields = ['proof_name', 'proof_version', 'profile_digest', 'parameter_contract_digest', 'admission_digest'];
    if (!carrier.definition_identities.some(pin => pinFields.every(key => pin[key] === row.selection[key]))) {
      diagnostics.push({ code: 'obligation_coverage_definition_identity_missing', obligation_id: row.obligation_id });
    }
    const assessment = row.selected_proof_assessment;
    if (!pinFields.every(key => assessment.definition?.[key] === row.selection[key])) {
      diagnostics.push({ code: 'obligation_coverage_assessment_definition_inconsistent',
        obligation_id: row.obligation_id });
    }
    const routeAssessments = row.diagnostics.map(diagnostic =>
      diagnostic.problem?.route_assessment);
    const routeEffects = routeAssessments.map(route => route?.effect ?? 'unresolved');
    const expectedStage = { author_input: 'authored_inputs',
      canonical_source: 'canonical_sources', system_capability: 'system_capability',
      unclassified: 'unclassified' };
    for (const [diagnosticIndex, diagnostic] of row.diagnostics.entries()) {
      const route = routeAssessments[diagnosticIndex];
      if (route?.owner_code !== diagnostic.code ||
          route?.selected_route !== assessment.execution_family ||
          route?.stage !== (expectedStage[diagnostic.problem.category] ?? 'unclassified')) {
        diagnostics.push({ code: 'obligation_coverage_diagnostic_route_assessment_inconsistent',
          obligation_id: row.obligation_id, diagnostic_index: diagnosticIndex });
      }
    }
    const stageEntries = stage => row.diagnostics.filter(diagnostic =>
      diagnostic.problem.route_assessment.stage === stage);
    const codes = (stage, effect) => [...new Set(stageEntries(stage).filter(diagnostic =>
      diagnostic.problem.route_assessment.effect === effect).map(diagnostic =>
      diagnostic.code))].sort(compareCodeUnits);
    const sameCodes = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
    for (const stage of ['authored_inputs', 'canonical_sources', 'system_capability']) {
      const projected = assessment.stages[stage];
      if (!sameCodes(projected.blocking_diagnostic_codes, codes(stage, 'blocking')) ||
          !sameCodes(projected.diagnostic_codes, codes(stage, 'blocking')) ||
          !sameCodes(projected.nonblocking_diagnostic_codes, codes(stage, 'nonblocking')) ||
          !sameCodes(projected.unresolved_diagnostic_codes, codes(stage, 'unresolved'))) {
        diagnostics.push({ code: 'obligation_coverage_assessment_stage_diagnostics_inconsistent',
          obligation_id: row.obligation_id, stage });
      }
    }
    const unresolvedCodes = [...new Set(row.diagnostics.filter(diagnostic =>
      diagnostic.problem.route_assessment.effect === 'unresolved').map(diagnostic =>
      diagnostic.code))].sort(compareCodeUnits);
    if (!sameCodes(assessment.unresolved_diagnostic_codes, unresolvedCodes) ||
        (assessment.assessment_status === 'resolved') !== (unresolvedCodes.length === 0)) {
      diagnostics.push({ code: 'obligation_coverage_assessment_resolution_inconsistent',
        obligation_id: row.obligation_id });
    }
    const stageComplete = assessment.stages.authored_inputs.status === 'complete' &&
      assessment.stages.canonical_sources.status === 'current' &&
      assessment.stages.system_capability.status === 'available';
    const assessmentComplete =
      assessment.assessment_status === 'resolved' &&
      assessment.readiness_status === 'complete' &&
      assessment.prevents_selected_route === false && stageComplete;
    const routeComplete = !routeEffects.some(effect =>
      effect === 'blocking' || effect === 'unresolved');
    if ((assessment.readiness_status === 'complete') !==
        (assessment.assessment_status === 'resolved' && stageComplete && routeComplete) ||
        assessment.prevents_selected_route !== (assessment.readiness_status !== 'complete')) {
      diagnostics.push({ code: 'obligation_coverage_selected_route_status_inconsistent',
        obligation_id: row.obligation_id });
    }
    if ((row.design_status === 'valid') !== (assessmentComplete && routeComplete)) {
      diagnostics.push({ code: 'obligation_coverage_design_status_inconsistent', obligation_id: row.obligation_id });
    }
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
  );
}

function validateObligationCoverageCarrier(carrier) {
  if (carrier?.schema_version === OBLIGATION_DRAFT_SCHEMA_VERSION) return deepFreeze({
    schema_valid: false, valid: false, carrier: null, schema_errors: [],
    diagnostics: [{ code: "obligation_coverage_resolution_required", pointer: "/schema_version",
      message: "Resolve the authored draft before reading complete mapping fields" }]
  });
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

function jsonData(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  seen.add(value);
  const valid = Reflect.ownKeys(value).every(key => typeof key === "string") &&
    (Array.isArray(value) ? Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) =>
      Object.hasOwn(value, i) && jsonData(value[i], seen)).every(Boolean) :
      Object.values(value).every(child => jsonData(child, seen)));
  seen.delete(value);
  return valid;
}

function validateObligationCoverageDraft(carrier) {
  const diagnostics = [];
  let jsonValid = false;
  try { jsonValid = jsonData(carrier); } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    diagnostics.push({ code: "obligation_coverage_json_depth_invalid", pointer: "/" });
  }
  if (!jsonValid) diagnostics.push({ code: "obligation_coverage_json_invalid", pointer: "/" });
  const retiredGapDiagnostics = jsonValid && Array.isArray(carrier?.obligations)
    ? carrier.obligations.flatMap((row, index) => row !== null &&
      typeof row === 'object' && Object.hasOwn(row, 'gap') ? [{
      code: 'obligation_coverage_authored_gap_retired',
      pointer: `/obligations/${index}/gap`,
      obligation_id: row.obligation_id ?? null,
      retired_gap: structuredClone(row.gap)
    }] : []) : [];
  diagnostics.push(...retiredGapDiagnostics);
  const schemaValid = jsonValid && validateDraftSchema(carrier);
  if (schemaValid) {
    const ids = new Set();
    for (const [index, row] of carrier.obligations.entries()) {
      const pointer = `/obligations/${index}`;
      if (ids.has(row.obligation_id)) diagnostics.push({ code: "obligation_coverage_obligation_id_duplicate", pointer });
      ids.add(row.obligation_id);
      if (row.statement !== undefined && (row.statement !== row.statement.trim() || /[\r\n]/u.test(row.statement))) {
        diagnostics.push({ code: "obligation_coverage_statement_not_atomic", pointer: `${pointer}/statement` });
      }
      if (row.proof_opt_out === true && (row.selection !== undefined || row.case_id !== undefined)) {
        diagnostics.push({ code: "obligation_coverage_proof_opt_out_conflict", pointer: `${pointer}/proof_opt_out` });
      }
      if (new Set((row.acceptance_criteria ?? []).map(entry => entry.identity)).size !==
          (row.acceptance_criteria ?? []).length) {
        diagnostics.push({ code: "obligation_coverage_acceptance_criterion_duplicate",
          pointer: `${pointer}/acceptance_criteria` });
      }
      if (row.selection) {
        const pin = row.selection;
        const fields = [pin.proof_version, pin.profile_digest, pin.parameter_contract_digest, pin.admission_digest];
        if (!(fields.every(value => value === null) ||
            (pin.proof_name !== null && fields.every(value => value !== null)))) {
          diagnostics.push({ code: "obligation_coverage_pin_inconsistent", pointer: `${pointer}/selection` });
        }
      }
    }
    const caseIds = new Set();
    for (const definition of carrier.cases ?? []) {
      if (caseIds.has(definition.case_id)) diagnostics.push({ code: 'obligation_coverage_case_duplicate', case_id: definition.case_id });
      caseIds.add(definition.case_id);
    }
    if (carrier.selected_unit !== null && carrier.cases?.length) diagnostics.push({ code: 'obligation_coverage_case_owner_invalid' });
    const byteLength = Buffer.byteLength(`${JSON.stringify(carrier, null, 2)}\n`, "utf8");
    if (carrier.obligations.length > OBLIGATION_COVERAGE_MAX_ROWS || byteLength > OBLIGATION_COVERAGE_MAX_BYTES) {
      diagnostics.push({ code: "obligation_coverage_carrier_oversize", pointer: "/",
        row_count: carrier.obligations.length, byte_length: byteLength,
        maximum_rows: OBLIGATION_COVERAGE_MAX_ROWS, maximum_bytes: OBLIGATION_COVERAGE_MAX_BYTES });
    }
  }
  const valid = schemaValid && diagnostics.length === 0;
  return deepFreeze({ schema_valid: schemaValid, schema_errors: jsonValid && !schemaValid
    ? schemaDiagnostics(validateDraftSchema) : [], diagnostics, valid,
    carrier: valid ? structuredClone(carrier) : null });
}

export {
  OBLIGATION_DRAFT_SCHEMA,
  OBLIGATION_DRAFT_SCHEMA_VERSION,
  OBLIGATION_COVERAGE_MAX_ROWS,
  OBLIGATION_COVERAGE_MAX_BYTES,
  validateObligationCoverageDraft,
  OBLIGATION_COVERAGE_GAP_KINDS,
  OBLIGATION_COVERAGE_MECHANISM_KINDS,
  OBLIGATION_COVERAGE_SCHEMA,
  OBLIGATION_COVERAGE_SCHEMA_VERSION,
  validateObligationCoverageCarrier
};
