

import { isDeepStrictEqual } from "node:util";

import { assertControlledContractOperationInput, ControlledContractToolError } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { resolveObligationCoverageQueryRevision } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";
import { usedCorrectionDefinitions } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-authoring-diagnostic-projection.mjs";
import { narrowCapturedDiagnosis } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-validation-operations.mjs";
import { parseProofSourceUnitAddress } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs";

import { describeRetainedObservation } from "./selected-response-observation.mjs";
import { CONTRACT_ASSESSMENT_ROUTE, contractAssessmentAuthorityIdentity, parseQueryObservationIdentity,
  queryObservationIdentity } from "./controlled-contract-query-context.mjs";
import { describeRetentionFailure, jsonContent, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { readSelectedResponseProjection, readSelectedResponseSource, retainSelectedResponseSource,
  selectedResponseDeliveryBound, selectedResponseQueryInvalidError } from
  "./selected-response-snapshot.mjs";
import { assessCurrentContractWithContext, resolveContractAssessmentContext } from "./task-assess-contract.mjs";

const RETAIN_OPERATION = "retain_contract_assessment_original";

const SPILL_PERSISTENCE_FAILED_CODE = "mcp_response.spill_persistence_failed.v1";
const isPersistenceFailure = (error) => error?.code === SPILL_PERSISTENCE_FAILED_CODE &&
  error.envelope?.code === SPILL_PERSISTENCE_FAILED_CODE && error.envelope.response_spilled === false;

const refuse = (code, message, details) => {
  throw new ControlledContractToolError(code, message, { changed: false, limb: "mechanical_failure", ...details });
};

function parseOriginalRequest(request) {
  assertControlledContractOperationInput(request, ["unit", "source", "diagnoses", "view"]);
  const { unit, source } = request;
  const keys = source !== null && typeof source === "object" ? Object.keys(source).sort() : [];
  if (keys.length !== 1 || keys[0] !== "ref_id") {
    refuse("obligation_coverage_request_invalid",
      "source names one retained original by exactly its ref_id",
      { phase: "request", rejected_arguments: ["source"] });
  }
  if (request.view !== undefined && (request.view !== "diagnoses" || request.diagnoses !== undefined)) {
    refuse("obligation_coverage_request_invalid", "view selects diagnoses exclusively of the diagnoses selection array",
      { phase: "request", failed_condition: "diagnoses_view_selection_invalid", rejected_arguments: ["view"] });
  }
  if (request.diagnoses !== undefined && (!Array.isArray(request.diagnoses) || request.diagnoses.length === 0 ||
      request.diagnoses.some(item => item === null || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(key => !["diagnosis_id", "obligation_id"].includes(key)) ||
        typeof item.diagnosis_id !== "string" || item.diagnosis_id.length === 0 ||
        (Object.hasOwn(item, "obligation_id") && (typeof item.obligation_id !== "string" || item.obligation_id.length === 0))))) {
    refuse("obligation_coverage_request_invalid", "diagnoses is a nonempty ordered array of {diagnosis_id, obligation_id?} selections",
      { phase: "request", failed_condition: "diagnoses_selection_invalid", rejected_arguments: ["diagnoses"] });
  }

  if (unit !== undefined) parseProofSourceUnitAddress(unit);
  return { ...(unit === undefined ? {} : { unit }), source: { ref_id: source.ref_id },
    ...(request.diagnoses === undefined ? {} : { diagnoses: request.diagnoses }) };
}

function selectRetainedDiagnosis(carrier, { unit, source, diagnosisId, obligationId }) {
  const { diagnosis_inventory: inventory, selection } = carrier;
  const subject = { unit, diagnosis_id: diagnosisId, original_selection: selection,
    ...(obligationId === undefined ? {} : { obligation_id: obligationId }) };
  const inventoryCall = { tool: CONTRACT_ASSESSMENT_ROUTE, arguments: { original: { source, view: 'diagnoses' } } };
  const notFound = (failedCondition, message, details = {}) => refuse(
    "obligation_coverage_diagnostic_group_not_found", message,
    { phase: "retained_selection", failed_condition: failedCondition, subject,
      next_calls: ['retained_diagnosis_inventory_incomplete', 'original_has_no_selectable_diagnoses',
        'diagnosis_unknown_in_complete_inventory'].includes(failedCondition) ? [inventoryCall] : [], ...details });
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(inventory) || !Array.isArray(inventory.diagnoses) || !isRecord(inventory.families) ||
      !isRecord(inventory.corrections) || !Array.isArray(inventory.population?.obligation_ids) ||
      typeof inventory.complete !== "boolean") {
    notFound("retained_diagnosis_inventory_malformed",
      "This retained original holds no well-formed diagnosis inventory; it is not repaired by reassessment");
  }
  const outside = (failedCondition, message) => refuse("obligation_coverage_obligation_not_found", message,
    { phase: "retained_selection", failed_condition: failedCondition, subject, obligation_id: obligationId,
      next_calls: [inventoryCall] });
  if (obligationId !== undefined && !inventory.population.obligation_ids.includes(obligationId)) {
    outside("obligation_outside_original_population",
      "The obligation is outside the population this original assessed; a read never changes its population");
  }
  const matches = inventory.diagnoses.filter((entry) => entry?.diagnostic_group_id === diagnosisId);
  if (matches.length === 0 && !inventory.complete) {
    notFound("retained_diagnosis_inventory_incomplete",
      "An owner failed when this original was captured, so its diagnoses were not all observed; " +
      "the requested one is not retained and is not thereby unknown",
      { unavailable_families: Object.entries(inventory.families)
        .filter(([, family]) => family?.status !== "complete")
        .map(([family, state]) => ({ family, status: state?.status, failure: state?.failure })) });
  }
  if (inventory.group_selectable !== true) {
    notFound("original_has_no_selectable_diagnoses",
      "This original holds no selectable diagnoses; its findings remain available in the diagnosis inventory view");
  }
  if (matches.length !== 1) {
    notFound(matches.length === 0 ? "diagnosis_unknown_in_complete_inventory" : "retained_diagnosis_identity_ambiguous",
      "The diagnosis is not one diagnosis of this retained original");
  }
  const [diagnosis] = matches;
  if (!Array.isArray(diagnosis.subjects)) {
    notFound("retained_diagnosis_malformed", "The retained diagnosis records no subjects");
  }
  const subjects = obligationId === undefined ? diagnosis.subjects
    : diagnosis.subjects.filter((entry) => entry?.obligation_id === obligationId);
  if (obligationId !== undefined && subjects.length === 0) {
    outside("obligation_not_a_diagnosis_subject", "The obligation is not a subject of this retained diagnosis");
  }
  const missing = [...new Set(subjects.flatMap((entry) => entry?.corrections ?? []))]
    .filter((clause) => !Object.hasOwn(inventory.corrections, clause));
  if (missing.length > 0) {
    notFound("retained_correction_definition_missing",
      `The retained original lacks the correction definitions its diagnosis references: ${missing.join(", ")}`);
  }

  return { diagnosis_id: diagnosisId, ...(obligationId === undefined ? {} : { obligation_id: obligationId }),
    ...(obligationId === undefined
    ? { diagnosis, corrections: usedCorrectionDefinitions(subjects, inventory.corrections) }
    : narrowCapturedDiagnosis(inventory, diagnosis, subjects)) };
}

export function createContractAssessmentResults({ workspace, sessionEnv = process.env,
  responseEnv = process.env, sourceDeps = {}, assessmentDeps = {} }) {

  const responseOwner = (envelope, options) => jsonContent(envelope, { env: responseEnv, ...options,
    selectedAccess: () => ({ operator_only: true }) });

  async function captureCurrent(selection) {
    const { carrier, context } = await assessCurrentContractWithContext({ workspace, selection },
      { sessionEnv, sourceDeps, assessmentDeps });
    const revision = carrier.assessment.content_digest ?? null;
    const binding = { route: CONTRACT_ASSESSMENT_ROUTE, repository: workspace.repo, unit: carrier.unit,
      query_identity: { focus: carrier.focus, selection: carrier.selection,
        population_kind: carrier.source_authority.population_kind },
      observation_identity: queryObservationIdentity(carrier.focus, revision),
      authority_identity: contractAssessmentAuthorityIdentity(context, { unit: carrier.unit }) };
    let locator;
    try {
      locator = retainSelectedResponseSource({ binding, carrier }, { responseOwner });
    } catch (error) {

      if (!isPersistenceFailure(error)) throw error;

      return { binding, retentionError: error, read: { carrier, original: { available: false, locator: null, revision,
        retention_failure: describeRetentionFailure(error, { operation: RETAIN_OPERATION,
          subject: { unit: carrier.unit, selection: carrier.selection } }) } } };
    }
    return { binding, read: { carrier, original: { available: true, locator, revision } } };
  }

  async function captureOriginal(request) {
    const { request: parsed, context } = await resolveContractAssessmentContext(
      { workspace, sessionEnv, sourceDeps }, () => parseOriginalRequest(request));

    const { binding, carrier } = readSelectedResponseSource(parsed.source, { env: responseEnv, expected: {
      route: CONTRACT_ASSESSMENT_ROUTE, repository: workspace.repo } });
    const mismatch = (field) => {
      throw selectedResponseQueryInvalidError(CONTRACT_ASSESSMENT_ROUTE, "source_binding_mismatch",
        { binding_field: field });
    };
    const unit = binding.unit;
    if (typeof unit !== "string" || !isDeepStrictEqual(binding.authority_identity,
      contractAssessmentAuthorityIdentity(context, { unit }))) mismatch("authority_identity");
    if ((parsed.unit ?? unit) !== unit) mismatch("unit");
    if (carrier.unit !== unit || carrier.repository !== workspace.repo) mismatch("carrier");
    const address = parseProofSourceUnitAddress(unit);
    const observation = await describeRetainedObservation(binding, async (retained) => {
      const { focus } = parseQueryObservationIdentity(retained.observation_identity);
      return queryObservationIdentity(focus, await resolveObligationCoverageQueryRevision({
        repoRoot: context.sourceRoot, wkId: address.wkId, selectedUnit: address.selectedUnit, focus }));
    });

    const selected = parsed.diagnoses === undefined ? {} : {
      selected_diagnoses: parsed.diagnoses.map(({ diagnosis_id: diagnosisId, obligation_id: obligationId }) => {
        try {
          return selectRetainedDiagnosis(carrier, { unit, source: parsed.source, diagnosisId, obligationId });
        } catch (error) {

          if (!(error instanceof ControlledContractToolError) || ![
            'obligation_coverage_diagnostic_group_not_found', 'obligation_coverage_obligation_not_found'
          ].includes(error.code)) throw error;
          return { diagnosis_id: diagnosisId, ...(obligationId === undefined ? {} : { obligation_id: obligationId }),
            failure: { code: error.code, cause: error.message, ...error.details } };
        }
      })
    };
    return { binding, read: { carrier, ...selected,
      original: { available: true, locator: parsed.source, revision: carrier.assessment.content_digest ?? null,
        selection: binding.query_identity },
      source_revision_currentness: { state: observation.state,
        ...(observation.state === "unavailable" ? { cause: observation.unavailable_reason } : {}) },

      assessment_context_currentness: "not_observed" } };
  }

  async function deliver({ binding, read, retentionError }, project, { selectedMeaning }) {
    const payload = await project(read);
    const bytes = measureMcpInlineResultBytes(payload);
    const bound = selectedResponseDeliveryBound(responseEnv);
    if (bytes <= bound) return jsonContent(payload, { env: responseEnv });
    if (read.original.locator === null) {

      throw retentionError;
    }
    if (!selectedMeaning) {
      throw new ControlledContractToolError("proof_validation_answer_exceeds_compact_class",
        `The fresh assessment answer measures ${bytes} bytes, above the ${bound}-byte compact class`,
        { changed: false, phase: "delivery", scope: { unit: read.carrier.unit }, measured_bytes: bytes, limit: bound,
          reason: "a fresh assessment answer is a compact summary and is not given complete delivery",
          next_calls: [] });
    }

    return readSelectedResponseProjection(read.original.locator, { env: responseEnv,
      expected: binding, route: CONTRACT_ASSESSMENT_ROUTE,
      project: ({ carrier }) => project({ ...read, carrier }) });
  }

  return Object.freeze({
    current: async (selection) => (await captureCurrent(selection)).read,
    original: async (request) => (await captureOriginal(request)).read,
    deliverCurrent: async (selection, project) =>
      deliver(await captureCurrent(selection), project, { selectedMeaning: false }),
    deliverOriginal: async (request, project) =>
      deliver(await captureOriginal(request), project, { selectedMeaning: true })
  });
}
