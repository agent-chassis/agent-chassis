

import { ControlledContractToolError, assertControlledContractOperationInput } from
  '../../lib/controlled-contract-tools.mjs';
import { loadControlledContractPackage } from './package-runtime.mjs';
import { resolveProofAuthoringSource } from './proof-authoring-source.mjs';
import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { obligationCoverageResolutionInput } from './proof-authoring-persistence.mjs';
import { projectProofAuthoringCase } from './proof-authoring-case.mjs';
import { projectProofAuthoringContractInputs } from './proof-authoring-contract-inputs.mjs';
import { projectControlledContractReferenceClosure } from './contract-requirement-authoring.mjs';
import { coverageUnitArguments } from './coverage-recovery-guidance.mjs';
import { proofAuthoringOperation, validationContractInputsSummary } from './proof-authoring-operations.mjs';
import { acceptanceCriterionInventory } from './acceptance-criterion-coverage.mjs';

export const OBLIGATION_COVERAGE_QUERY_SCHEMA_VERSION = 'obligation-coverage-query.v1';
export const OBLIGATION_COVERAGE_QUERY_TOOL = 'workspace_controlled_contract_obligation_coverage_query';
export const OBLIGATION_COVERAGE_QUERY_VIEWS = Object.freeze(['compact', 'complete']);
const POPULATION_MODES = Object.freeze(['all', 'assigned']);

const unitAddress = value => value.selectedUnit === null ? value.wkId : `${value.wkId}#${value.selectedUnit}`;
const byObligationId = (left, right) => left.obligation_id < right.obligation_id ? -1
  : left.obligation_id > right.obligation_id ? 1 : 0;

function requestInvalid(message, rejected, input) {
  throw new ControlledContractToolError('obligation_coverage_request_invalid', message, {
    changed: false, phase: 'request', rejected_arguments: rejected,
    next_calls: [{ tool: OBLIGATION_COVERAGE_QUERY_TOOL,
      arguments: coverageUnitArguments(obligationCoverageResolutionInput(input)) }] });
}

function assertQuerySelection(input) {
  if (input.view !== undefined && !OBLIGATION_COVERAGE_QUERY_VIEWS.includes(input.view)) {
    requestInvalid('view is compact or complete', ['view'], input);
  }
  if (input.population !== undefined && !POPULATION_MODES.includes(input.population)) {
    throw new TypeError('obligation-coverage query population is all or assigned');
  }

  if (input.inventory === true) {
    const conflicts = [...(input.obligationId === undefined ? [] : ['obligation_id']),
      ...(input.parameterDetail === true ? ['parameter_detail'] : []),
      ...(input.view === 'complete' ? ['view'] : [])];
    if (conflicts.length > 0) requestInvalid(
      'inventory lists the obligation population; obligation_id, parameter_detail and view:"complete" select a different view',
      ['inventory', ...conflicts], input);
  }
}

const PIN_STATE_BY_CODE = Object.freeze(new Map([
  ['obligation_coverage_proof_unselected', 'unselected'],
  ['obligation_coverage_proof_unpinned', 'unpinned'],
  ['obligation_coverage_definition_integrity_mismatch', 'stale'],
  ['proof_pack_exact_version_not_current', 'stale'],
  ['proof_pack_exact_version_unavailable', 'stale']
]));

async function parameterDetail(pkg, row) {
  const { loadPackParameterContract, describePackParameters } =
    await import('@agent-chassis/controlled-contract/pack-parameters');
  let pack;
  try {
    pack = await pkg.loadPinnedProofSelection(row.selection);
  } catch (error) {
    const status = PIN_STATE_BY_CODE.get(error?.code);
    if (status === undefined) throw error;
    return { parameter_contract: null, parameter_detail: { status, reason_code: error.code,
      message: error.message, selection: structuredClone(row.selection ?? null),
      ...(error.details === undefined ? {} : { facts: structuredClone(error.details) }),

      repaired_by: 'author' } };
  }
  return { parameter_contract: describePackParameters(loadPackParameterContract(pack)),
    parameter_detail: { status: 'current' } };
}

function inventoryRow(row) {
  return { obligation_id: row.obligation_id, statement: row.statement ?? null,
    proof_name: row.selection?.proof_name ?? null, case_id: row.case_id ?? null,
    explicit_gap: row.gap !== undefined && row.gap !== null,
    acceptance_criteria: (row.acceptance_criteria ?? []).map(entry => entry.identity),
    proof_opt_out: row.proof_opt_out === true };
}

function mergedReferences(...populations) {
  const byId = new Map();
  for (const entry of populations.flat()) if (!byId.has(entry.reference_id)) byId.set(entry.reference_id, entry);
  return [...byId.keys()].sort().map(id => byId.get(id));
}

function selectedNodeIds(pkg, resolved, rows) {
  return [...new Set(rows.flatMap(row => {
    const definition = row.case_id ? resolved.cases.find(entry => entry.case_id === row.case_id) : undefined;
    return [...(row.controlled_contract_node_ids ?? []),
      ...(definition === undefined ? [] : [pkg.authoredCaseVerificationId(definition)])];
  }).filter(Boolean))].sort();
}

export async function queryControlledContractObligationCoverageOperation(input) {
  return proofAuthoringOperation(async () => {
    assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit',
      'obligationId', 'parameterDetail', 'inventory', 'view', 'population']);
    assertQuerySelection(input);
    const population = input.population ?? 'all';
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
      obligationCoverageResolutionInput(input)));
    const inventory = input.inventory === true;
    const present = resolved.source !== null;
    const pkg = present ? await loadControlledContractPackage() : null;
    let rows = present ? [...resolved.rows].sort(byObligationId) : [];
    if (input.obligationId !== undefined) {
      const row = rows.find(entry => entry.obligation_id === input.obligationId);
      if (row === undefined) throw new ControlledContractToolError('obligation_coverage_obligation_not_found',
        'The obligation does not exist in this source', { changed: false, phase: 'request',
          obligation_id: input.obligationId, unit: unitAddress(resolved),
          available_obligation_count: rows.length,
          next_calls: [{ tool: OBLIGATION_COVERAGE_QUERY_TOOL,
            arguments: { ...coverageUnitArguments(resolved), inventory: true } }] });
      rows = [row];
    }
    const assigned = population === 'assigned';
    const mode = input.obligationId === undefined ? population
      : assigned ? 'assigned_obligation' : 'obligation';

    const nodeIds = mode === 'all' ? null : selectedNodeIds(pkg, resolved, rows);
    const contractInputs = projectProofAuthoringContractInputs(resolved, {
      controlledContractNodeIds: nodeIds });
    const requirements = contractInputs.requirements;
    const cases = [];
    const obligations = [];
    for (const row of rows) {
      const projected = present ? projectProofAuthoringCase(pkg, resolved, row) : [];
      for (const definition of projected) {
        if (!cases.some(entry => entry.case_id === definition.case_id)) cases.push(definition);
      }
      obligations.push(inventory ? inventoryRow(row) : {
        ...structuredClone(row),
        ...(input.parameterDetail === true ? await parameterDetail(pkg, row) : {}) });
    }
    cases.sort((left, right) => left.case_id.localeCompare(right.case_id));

    const references = inventory ? requirements.references : mergedReferences(requirements.references,
      projectControlledContractReferenceClosure(resolved.contract?.content ?? null, cases
        .filter(definition => typeof definition.component?.reference_id === 'string')
        .map(definition => ({ reference_id: definition.component.reference_id,
          field: `cases[${definition.case_id}].component` }))));
    const returnedCounts = { obligations: obligations.length,
      explicit_gaps: rows.filter(row => row.gap).length,
      requirements: inventory ? 0 : requirements.requirements.length,
      references: inventory ? 0 : references.length,
      cases: inventory ? 0 : cases.length,
      notes: inventory ? 0 : requirements.notes.length,
      residue: inventory ? 0 : requirements.residue.length };

    const populationFacts = { mode,
      ...(input.obligationId === undefined ? {} : { obligation_id: input.obligationId }),
      returned: returnedCounts,
      ...(assigned ? {} : { source: { obligations: present ? resolved.rows.length : 0,
        explicit_gaps: present ? resolved.rows.filter(row => row.gap).length : 0,
        requirements: requirements.selection.total_requirements,
        case_definitions: resolved.cases.length } }),
      ...(assigned && !present ? { assignment_mapping: 'absent',
        recovery: { actor: 'coordinator', action: 'author the assigned unit\'s obligations through ' +
          'workspace_controlled_contract_obligation_coverage_upsert before relying on its contract meaning' } }
        : {}),
      global_annotations: 'all_notes_and_residue_retained' };

    const acceptanceCriteria = acceptanceCriterionInventory(
      pkg ?? await loadControlledContractPackage(), resolved.unit);
    const common = {
      schema_version: OBLIGATION_COVERAGE_QUERY_SCHEMA_VERSION,
      unit: unitAddress(resolved),
      status: present ? 'source_present' : 'source_absent',
      view: inventory ? 'inventory' : 'complete',
      content_digest: resolved.revision,
      source_identity: resolved.prospectiveIdentity,
      contract_content_digest: contractInputs.contract_content_digest,
      population: populationFacts,
      acceptance_criteria: acceptanceCriteria
    };
    if (inventory) {
      const summary = validationContractInputsSummary(resolved, contractInputs);

      if (assigned) summary.requirements = { ...summary.requirements,
        total_requirements: requirements.requirements.length };
      return { ...common, contract_inputs_summary: summary,
        obligation_detail_read: { tool: OBLIGATION_COVERAGE_QUERY_TOOL,
          arguments: coverageUnitArguments(resolved), selector: 'obligation_id',
          accepted_values: 'obligations[].obligation_id',
          returns: 'the complete saved obligation with its mechanism, pinned selection and linked case, ' +
            'plus the requirement meaning and references associated with it',
          complete_population_read: { tool: OBLIGATION_COVERAGE_QUERY_TOOL,
            arguments: { ...coverageUnitArguments(resolved), view: 'complete' } } },
        obligations, next_calls: [] };
    }
    return { ...common,
      meaning_identity: requirements.meaning_identity,
      requirement_status: requirements.status,
      controlled_acceptance: contractInputs.controlled_acceptance,
      requirements: requirements.requirements,
      references,
      obligations,
      cases,
      notes: requirements.notes,
      residue: requirements.residue,
      next_calls: [] };
  });
}

export async function resolveObligationCoverageQueryRevision(input) {
  const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
    obligationCoverageResolutionInput(input)));
  return resolved.revision;
}

export function refuseObligationCoverageQuery(code, message, details) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

export function obligationCoverageQueryOperation(callback) {
  return proofAuthoringOperation(callback);
}
