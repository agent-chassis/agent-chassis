

import { ControlledContractToolError, VALIDATE_PROOF_INPUT_SCHEMA } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { boundProofValidationAssessment } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-authoring-diagnostic-projection.mjs";
import { boundAuthoringExceptions } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/authoring-exception-assessment.mjs";

import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { CONTRACT_ASSESSMENT_ROUTE } from "./controlled-contract-query-context.mjs";
import { proofAuthoringFocusInputSchema, proofAuthoringUnitInputSchema } from "./proof-authoring-input-schema.mjs";
import { requestSchema } from "./proof-request-schema.mjs";
import { selectedResponseDeliveryBound, selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";
import { createContractAssessmentResults } from "./task-assess-contract-results.mjs";
import { assessmentCurrentRead, projectAssessmentGuidance, projectSelectedDiagnosisGuidance } from
  "./task-assess-contract-corrections.mjs";
import { requiredWithout, requiresPath, withDeclaredCrossFieldRules } from
  "./zod-request-constraint-declarations.mjs";

const AUTHENTICATED_ORIGINAL_RULE = "With original, top-level unit, focus and obligation_id are compared with the " +
  "authenticated original after it is read: a value that restates the original is redundant and reported as " +
  "normalized; any other value conflicts and is refused with the original-only and the fresh request as separate " +
  "choices. Neither is run on the caller's behalf.";

export function createContractAssessmentInputContract(z) {
  const declared = VALIDATE_PROOF_INPUT_SCHEMA;
  const selector = (name) => requestSchema(z, declared.properties[name], declared.$defs);
  const original = withDeclaredCrossFieldRules(z.object({
    source: selectedResponseDetailSchema(z).shape.source,
    diagnosis_id: selector("diagnostic_group_id").optional(),
    obligation_id: selector("obligation_id").optional()
  }).strict(), [requiresPath({ field: "obligation_id", path: ["diagnosis_id"] })]);
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
    obligation_id: (value) => value === original.obligation_id ||
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

function assessmentBody(carrier) {
  const { allowed_selectors: _selectors, diagnostics, acceptance_coverage: coverage, ...facts } = carrier.assessment;
  const { supported_next_call: _validate, ...scope } = coverage ?? {};
  return projectAssessmentGuidance(carrier, { ...facts,
    ...(coverage === undefined ? {} : { acceptance_coverage: _validate === undefined ? coverage
      : { ...scope, whole_unit_request: present({ unit: carrier.unit, focus: carrier.focus }) } }),
    ...(diagnostics === undefined ? {} : { diagnostics: indexedDiagnostics(diagnostics) }) });
}

function refuseOversizedSummary({ carrier, bytes, bound, originalRequest }) {
  const scope = present({ unit: carrier.unit, focus: carrier.focus, obligation_id: carrier.selection.obligation_id });
  throw new ControlledContractToolError("proof_validation_answer_exceeds_compact_class",
    `The assessment summary for ${JSON.stringify(scope)} measures ${bytes} bytes, above the ${bound}-byte compact class`,
    { changed: false, phase: "delivery", scope, measured_bytes: bytes, limit: bound,
      reason: "the assessment summary with no admitted issue or diagnosis alone exceeds the compact class",
      next_calls: [{ ...contractAssessmentCall(originalRequest), purpose: "historical_retrieval" }] });
}

function selectedDiagnosisBody(carrier, { diagnosis_id: diagnosisId, diagnosis, corrections }, restriction) {
  const { correction_route: _route, ...saved } = diagnosis;
  const total = carrier.diagnosis_inventory.diagnoses.find((entry) =>
    entry.diagnostic_group_id === diagnosisId).subjects.length;
  return { diagnosis_id: diagnosisId, ...present({ obligation_id: restriction }),
    ...projectSelectedDiagnosisGuidance(carrier, saved, corrections),
    subjects_returned: saved.subjects.length, subjects_in_original_diagnosis: total,
    correction: { supplied: false } };
}

export function createContractAssessmentSurface({ workspace, z, sessionEnv = process.env,
  responseEnv = process.env, sourceDeps = {}, assessmentDeps = {} }) {
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
    const selected = read.selected_diagnosis;
    const retained = carrier.diagnosis_inventory.diagnoses.map((entry) => entry.diagnostic_group_id);
    const complete = selected === undefined ? assessmentBody(carrier) : null;

    const summary = complete === null || complete.exceptions === undefined ? complete
      : { ...complete, exceptions: boundAuthoringExceptions(complete.exceptions) };
    const historicalCall = (arguments_) => ({ ...contractAssessmentCall(arguments_), purpose: "historical_retrieval" });

    const diagnosisRequest = (id) => ({ original: { source, diagnosis_id: id } });
    const originalRequest = source === null ? null : { original: { source } };

    const answer = (assessment, offered) => {
      const body = present({ repository: carrier.repository, unit: carrier.unit, focus: carrier.focus,
        selection: carrier.selection, source_authority: carrier.source_authority,
        ...(selected === undefined ? { assessment }
          : { source: carrier.assessment.source, content_digest: carrier.assessment.content_digest,
            selected_diagnosis: selectedDiagnosisBody(carrier, selected, requested.obligation_id) }),
        original: present({ available: read.original.available, revision: read.original.revision, source,
          purpose: "historical_retrieval", write_authority: false,
          retention_failure: read.original.retention_failure }),

        ...(selected !== undefined || source === null ? {} : { diagnosis_selection: { retained: retained.length,
          calls_returned: offered.length, calls_omitted: retained.length - offered.length } }),
        source_revision_currentness: read.source_revision_currentness,
        assessment_context_currentness: read.assessment_context_currentness });
      const continuations = source === null ? { original: null, unavailable_reason: "original_not_retained" } : {
        original: originalRequest,
        ...(selected !== undefined ? { diagnosis: diagnosisRequest(selected.diagnosis_id) }
          : { diagnoses: offered.map(diagnosisRequest) }) };
      const currentRead = assessmentCurrentRead(body);
      const { diagnoses, diagnosis } = continuations;
      const nextCalls = [...(currentRead === null ? [] : [currentRead]),
        ...(originalRequest === null ? [] : [historicalCall(originalRequest)]),
        ...(diagnoses ?? (diagnosis === undefined ? [] : [diagnosis])).map(historicalCall)];
      return { body, continuations, nextCalls };
    };
    const bound = selectedResponseDeliveryBound(responseEnv);
    const delivered = ({ body, nextCalls }) => measureMcpInlineResultBytes({ ...body, next_calls: nextCalls });
    let projected;
    if (requested !== undefined) {

      projected = answer(complete, retained);
    } else if (source === null) {

      projected = answer(complete, []);
    } else if (carrier.assessment.diagnostics !== undefined) {

      const offeredBy = (diagnostics) =>
        [...new Set(diagnostics.issues.map((issue) => issue.diagnosis_id).filter((id) => id !== null))];
      const view = (bounded) => {
        const diagnostics = indexedDiagnostics(bounded.diagnostics);
        return answer({ ...summary, diagnostics }, offeredBy(diagnostics));
      };
      projected = view(boundProofValidationAssessment(carrier.assessment,
        (candidate) => delivered(view(candidate)) <= bound));
    } else {

      const all = complete.diagnoses ?? [];
      const view = (rows, calls) => answer({ ...summary, ...(complete.diagnoses === undefined ? {} : {
        diagnoses: rows, diagnoses_returned: rows.length, diagnoses_omitted: all.length - rows.length,
        complete: rows.length === all.length }) }, all.slice(0, calls).map((entry) => entry.diagnostic_group_id));
      const fits = (rows, calls) => delivered(view(rows, calls)) <= bound;
      let calls = 0;
      while (calls < all.length && fits([], calls + 1)) calls += 1;
      const rows = [];
      for (const row of all) if (fits([...rows, row], calls)) rows.push(row);
      projected = view(rows, calls);
    }
    if (requested === undefined && source !== null && delivered(projected) > bound) {
      refuseOversizedSummary({ carrier, bytes: delivered(projected), bound, originalRequest });
    }
    const { body, continuations, nextCalls } = projected;
    const bytes = measureMcpInlineResultBytes({ body, continuations });
    return { registered: false, ...normalized, body, continuations, nextCalls,
      delivery: { delivered: false, measured_bytes: bytes, bound_bytes: bound, fits: bytes <= bound,
        complete_transport_required: bytes > bound } };
  }

  async function prepare(request) {
    const parsed = parse(request);
    const { original, ...current } = parsed;
    const { nextCalls: _calls, ...prepared } = project(parsed,
      original === undefined ? await results.current(current) : await results.original(original));
    return prepared;
  }

  async function respond(request) {
    const parsed = parse(request);
    const { original, ...current } = parsed;
    const delivered = (read) => {
      const prepared = project(parsed, read);
      return { ...prepared.body, ...(prepared.normalized === undefined ? {} : { normalized: prepared.normalized }),
        next_calls: prepared.nextCalls };
    };
    return original === undefined ? results.deliverCurrent(current, delivered) : results.deliverOriginal(original, delivered);
  }

  return Object.freeze({ inputContract: contract, prepare, respond });
}
