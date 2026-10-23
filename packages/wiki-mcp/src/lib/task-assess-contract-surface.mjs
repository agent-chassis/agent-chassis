

import { ControlledContractToolError, VALIDATE_PROOF_INPUT_SCHEMA } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { boundProofValidationAssessment, capturedDiagnosisNavigation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-authoring-diagnostic-projection.mjs";

import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { CONTRACT_ASSESSMENT_ROUTE } from "./controlled-contract-query-context.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { requestSchema } from "./proof-request-schema.mjs";
import { selectedResponseDeliveryBound, selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";
import { createContractAssessmentResults } from "./task-assess-contract-results.mjs";
import { assessmentAuthoredValidity, projectContractAssessmentResponse } from './task-assess-contract-response.mjs';
import { serveContractAssessmentResponse } from './task-assess-contract-response-calls.mjs';
import { assessmentCurrentRead, projectAssessmentGuidance, projectSelectedDiagnosisGuidance } from
  "./task-assess-contract-corrections.mjs";
import { exclusiveWith, requiredWithout, withDeclaredCrossFieldRules } from
  "./zod-request-constraint-declarations.mjs";

const AUTHENTICATED_ORIGINAL_RULE = "With original, top-level unit, focus and obligation_id are compared with the " +
  "authenticated original after it is read: a value that restates the original is redundant and accepted; " +
  "any other value conflicts and is refused with the original-only and the fresh request as separate " +
  "choices. Neither is run on the caller's behalf.";

export function createContractAssessmentInputContract(z) {
  const declared = VALIDATE_PROOF_INPUT_SCHEMA;
  const selector = (name) => requestSchema(z, declared.properties[name], declared.$defs);
  const original = withDeclaredCrossFieldRules(z.object({
    source: selectedResponseDetailSchema(z).shape.source,
    diagnoses: z.array(z.object({ diagnosis_id: selector("diagnostic_group_id"),
      obligation_id: selector("obligation_id").optional() }).strict()).min(1)
      .describe("Read these explicitly chosen diagnoses in order from this source; each obligation_id restricts only its entry.").optional(),
    view: z.literal("diagnoses").optional()
  }).strict(), [exclusiveWith({ field: "view", others: ["diagnoses"] })]);
  const inputSchema = withDeclaredCrossFieldRules(z.object({
    unit: proofAuthoringUnitInputSchema(z).optional(),
    focus: proofAuthoringFocusInputSchema(z).optional(),
    obligation_id: selector("obligation_id").optional(),
    original: original.optional()
  }).strict(), [requiredWithout({ field: "original", require: ["unit"] })]);
  return Object.freeze({ inputSchema, inputContractUnprojectedConstraints: Object.freeze([Object.freeze({
    path: "$", reason: "handler_enforced_after_original_authentication", guidance: AUTHENTICATED_ORIGINAL_RULE })]) });
}

const refuse = (message, details) => {
  throw new ControlledContractToolError("obligation_coverage_request_invalid", message,
    { changed: false, phase: "request", ...details });
};
const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) =>
  value !== undefined && value !== null));

export const contractAssessmentCall = (arguments_) => ({ tool: CONTRACT_ASSESSMENT_ROUTE, arguments: arguments_ });

function normalizeAgainstOriginal(request, carrier) {
  const { original, ...top } = request;
  const restates = {
    unit: (value) => value === carrier.unit,
    focus: (value) => value === carrier.focus,
    obligation_id: (value) => original.diagnoses?.every(item => item.obligation_id === value) === true ||
      (carrier.selection.scope === "selected_obligation" && value === carrier.selection.obligation_id)
  };
  const supplied = Object.keys(top);
  const conflicting = supplied.filter((field) => !restates[field](top[field]));
  if (conflicting.length > 0) {
    refuse("Top-level selectors do not restate the authenticated original; choose one request", {
      failed_condition: "original_and_current_selection_conflict", conflicting_fields: conflicting,
      choices: { original: { original }, current: present({ unit: carrier.unit, focus: carrier.focus, ...top }) },
      next_calls: [] });
  }
  return { redundant_fields: supplied };
}

const indexedDiagnostics = ({ authoring_occurrence_effects: _effects, semantic_logical_cause_recovery: _recovery,
  issue_selection_basis: _basis, ...diagnostics }) => ({ ...diagnostics,
  issues: diagnostics.issues.map(({ call, ...issue }) =>
    ({ ...issue, diagnosis_id: call?.arguments?.diagnostic_group_id ?? null })) });

function assessmentBody(carrier, registeredTier, compact = true) {
  const { allowed_selectors: _selectors, diagnostics, acceptance_coverage: coverage, ...facts } = carrier.assessment;
  const { supported_next_call: _validate, ...scope } = coverage ?? {};
  return projectAssessmentGuidance(carrier, { ...facts,
    ...(coverage === undefined ? {} : { acceptance_coverage: _validate === undefined ? coverage
      : { ...scope, whole_unit_request: present({ unit: carrier.unit, focus: carrier.focus }) } }),
    ...(diagnostics === undefined ? {} : { diagnostics: indexedDiagnostics(
      (compact ? boundProofValidationAssessment(carrier.assessment, candidate => candidate.diagnostics.issues.every(issue => issue.call === null)).diagnostics : diagnostics)) }) }, registeredTier, { compact });
}

function refuseOversizedSummary({ carrier, bytes, bound, inventoryRequest }) {
  const scope = present({ unit: carrier.unit, focus: carrier.focus, obligation_id: carrier.selection.obligation_id });
  throw new ControlledContractToolError("proof_validation_answer_exceeds_compact_class",
    `The assessment summary for ${JSON.stringify(scope)} measures ${bytes} bytes, above the ${bound}-byte compact class`,
    { changed: false, phase: "delivery", scope, measured_bytes: bytes, limit: bound,
      reason: "the assessment summary with no admitted issue or diagnosis alone exceeds the compact class",
      next_calls: [{ ...contractAssessmentCall(inventoryRequest), purpose: "diagnostic_inventory" }] });
}

function selectedDiagnosisBody(carrier, { diagnosis_id: diagnosisId, diagnosis, corrections }, restriction, registeredTier) {
  const { correction_route: _route, ...saved } = diagnosis;
  const total = carrier.diagnosis_inventory.diagnoses.find((entry) =>
    entry.diagnostic_group_id === diagnosisId).subjects.length;
  return { diagnosis_id: diagnosisId, ...present({ obligation_id: restriction }),
    ...projectSelectedDiagnosisGuidance(carrier, saved, corrections, registeredTier),
    subjects_returned: saved.subjects.length, subjects_in_original_diagnosis: total,
    correction: { supplied: false } };
}

export function createContractAssessmentSurface({ workspace, z, sessionEnv = process.env,
  responseEnv = process.env, sourceDeps = {}, assessmentDeps = {}, registeredTier, requestContracts = () => null }) {
  const contract = createContractAssessmentInputContract(z);
  const results = createContractAssessmentResults({ workspace, sessionEnv, responseEnv, sourceDeps, assessmentDeps });

  function parse(request) {
    const parsed = contract.inputSchema.safeParse(request);
    if (!parsed.success) {
      refuse("The request does not satisfy the assess_contract input contract", {
        failed_condition: "input_contract_violation", next_calls: [],
        issues: parsed.error.issues.map(({ path, code, message }) => ({ path, code, message })) });
    }
    return parsed.data;
  }

  function project(request, read) {
    const requested = request.original;
    const { carrier } = read;
    const normalized = requested === undefined ? {} : { normalized: normalizeAgainstOriginal(request, carrier) };
    const source = read.original.locator;
    const selected = read.selected_diagnoses;
    const inventoryView = requested?.view === "diagnoses";
    const navigation = capturedDiagnosisNavigation(carrier.diagnosis_inventory);
    const retained = navigation.map(row => row.diagnosis_id);
    const equivalentCount = navigation.reduce((count, row) => count + (row.equivalent_diagnoses?.length ?? 0), 0);
    const complete = selected === undefined ? assessmentBody(carrier, registeredTier, source !== null) : null;

    const summary = complete;
    const historicalCall = (arguments_) => ({ ...contractAssessmentCall(arguments_), purpose: "historical_retrieval" });
    const diagnosisCall = (arguments_) => {
      const row = navigation.find(row => row.diagnosis_id === arguments_.original.diagnoses[0].diagnosis_id);

      return { ...contractAssessmentCall(arguments_),
        ...(row.code === undefined ? { information: `${row.recovery_status.replaceAll('_', ' ')}: ${row.reason_codes.map(code =>
          code.replace(/^controlled_contract_/u, '').replaceAll('_', ' ')).join('; ')}` } : {}),
        ...present({ code: row.code, family: row.family, category: row.category }),
        ...present({ choice: row.choice, equivalent_diagnoses: row.equivalent_diagnoses }),
        subjects: row.subjects };
    };

    const diagnosisRequest = (id) => ({ original: { source, diagnoses: [{ diagnosis_id: id }] } });
    const originalRequest = source === null ? null : { original: { source } };
    const inventoryRequest = source === null ? null : { original: { source, view: "diagnoses" } };
    let includeOriginalCall = true;

    const answer = (assessment, offered) => {
      const body = present({ repository: carrier.repository, unit: carrier.unit, focus: carrier.focus,
        selection: carrier.selection, source_authority: carrier.source_authority,
        ...(inventoryView ? { source: carrier.assessment.source, content_digest: carrier.assessment.content_digest,
          ...(retained.length === 0 && summary.save_guidance !== undefined
            ? { assessment: { save_guidance: summary.save_guidance } } : {}) }
          : selected === undefined ? { assessment }
          : { source: carrier.assessment.source, content_digest: carrier.assessment.content_digest,
            selected_diagnoses: selected.map(item => item.failure ? item
              : selectedDiagnosisBody(carrier, item, item.obligation_id, registeredTier)) }),
        original: present({ available: read.original.available, revision: read.original.revision, source,
          purpose: "historical_retrieval", write_authority: false,
          retention_failure: read.original.retention_failure }),
        diagnostic_navigation: { complete: carrier.diagnosis_inventory.complete,
          ...(inventoryView ? { families: Object.fromEntries(Object.entries(carrier.diagnosis_inventory.families)
            .map(([family, state]) => [family, { status: state.status, ...(state.failure == null ? {} : { failure: { code: state.failure.code, cause: { code: state.failure.cause?.code } } }) }])),
            unselectable_findings: carrier.diagnosis_inventory.unselectable_findings,
            diagnoses_total: navigation.length, diagnoses_returned: offered.length,
            diagnoses_omitted: navigation.length - offered.length }
            : Object.values(carrier.diagnosis_inventory.families).some(state =>
              ["incomplete", "unavailable"].includes(state.status)) ? {
              families: Object.fromEntries(Object.entries(carrier.diagnosis_inventory.families)
                .map(([family, state]) => [family, { status: state.status }])) } : {}),
          ...(inventoryView || selected !== undefined ? {} : { diagnoses_total: retained.length, diagnoses_returned: offered.length, diagnoses_omitted: retained.length - offered.length }),
          ...(equivalentCount === 0 ? {} : { equivalent_diagnoses: equivalentCount,
            retained_diagnoses_total: navigation.length + equivalentCount }),
          ...(inventoryRequest === null ? { unavailable_reason: "original_not_retained" } : {}) },

        ...(selected !== undefined || source === null ? {} : { diagnosis_selection: { retained: retained.length,
          calls_returned: offered.length, calls_omitted: retained.length - offered.length,
          ...(equivalentCount === 0 ? {} : { equivalent_diagnoses: equivalentCount }) } }),
        source_revision_currentness: read.source_revision_currentness,
        assessment_context_currentness: read.assessment_context_currentness });
      const continuations = source === null ? { original: null, unavailable_reason: "original_not_retained" } : {
        original: originalRequest,
        ...(selected !== undefined ? { diagnoses: [{ original: requested }] }
          : { diagnoses: offered.map(diagnosisRequest) }) };
      const currentRead = assessmentCurrentRead(body);
      const diagnosisCalls = selected === undefined ? (continuations.diagnoses ?? []).map(diagnosisCall) : [];

      const nextCalls = [...diagnosisCalls,
        ...(selected !== undefined || currentRead === null ? [] : [currentRead]),
        ...(originalRequest === null || inventoryView || !includeOriginalCall ? [] : [historicalCall(originalRequest)]),
        ...(inventoryRequest === null || inventoryView ? [] : [{ ...contractAssessmentCall(inventoryRequest), purpose: "diagnostic_inventory" }])];
      return { body, continuations, nextCalls };
    };
    const bound = selectedResponseDeliveryBound(responseEnv);
    const delivered = ({ body, nextCalls }) => measureMcpInlineResultBytes({ ...body, ...normalized, next_calls: nextCalls });
    let projected = answer(summary, []);
    if (selected !== undefined) {

      projected = answer(null, selected.map(item => item.diagnosis_id));
    } else if (source !== null) {

      includeOriginalCall = !inventoryView;
      const offered = [];
      const ranked = [...retained].sort((a, b) => Number(navigation.find(row => row.diagnosis_id === b).family === "authoring") - Number(navigation.find(row => row.diagnosis_id === a).family === "authoring"));
      for (const id of ranked) if (inventoryView || delivered(answer(summary, [...offered, id])) <= bound) offered.push(id);
      projected = answer(summary, offered);
    }
    if (requested === undefined && source !== null && delivered(projected) > bound) {
      refuseOversizedSummary({ carrier, bytes: delivered(projected), bound, inventoryRequest });
    }
    const { body, continuations, nextCalls } = projected;
    const bytes = delivered(projected);
    return { registered: false, ...normalized, body, continuations, nextCalls,
      delivery: { delivered: false, measured_bytes: bytes, bound_bytes: bound, fits: bytes <= bound,
        complete_transport_required: bytes > bound } };
  }

  async function prepare(request) {
    const parsed = parse(request);
    const { original, ...current } = parsed;
    const read = original === undefined ? await results.current(current) : await results.original(original);
    const { nextCalls: _calls, ...prepared } = project(parsed, read);
    const assessment = prepared.body.assessment;
    return { ...prepared, body: { ...prepared.body, ...(assessment === undefined ? {} : {
      assessment: { ...assessment, authored: { ...assessment.authored,
        status: assessmentAuthoredValidity(read.carrier) } } }), next_calls: _calls } };
  }

  async function respond(request) {
    const parsed = parse(request);
    const { original, ...current } = parsed;

    const delivered = read => serveContractAssessmentResponse(projectContractAssessmentResponse(read, parsed, {
      tier: registeredTier, responseEnv, normalize: normalizeAgainstOriginal }), requestContracts());
    return original === undefined ? results.deliverCurrent(current, delivered) : results.deliverOriginal(original, delivered);
  }

  return Object.freeze({ inputContract: contract, prepare, respond });
}
