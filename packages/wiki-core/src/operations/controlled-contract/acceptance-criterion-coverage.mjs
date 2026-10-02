

import { ControlledContractToolError, controlledContractContentDigest } from
  '../../lib/controlled-contract-tools.mjs';
import { criterionIdentityInputs } from './criterion-identity-projection.mjs';

export const ACCEPTANCE_CRITERION_COVERAGE_SCHEMA_VERSION = 'acceptance-criterion-coverage.v1';
const LISTED_LIMIT = 8;
const QUERY_TOOL = 'workspace_controlled_contract_obligation_coverage_query';
const UPSERT_TOOL = 'workspace_controlled_contract_obligation_coverage_upsert';

const unitAddress = ({ wkId, selectedUnit }) =>
  selectedUnit === null || selectedUnit === undefined ? wkId : `${wkId}#${selectedUnit}`;

export function acceptanceCriterionInventory(pkg, unit) {
  return pkg.deriveCriterionIdentities(criterionIdentityInputs(unit?.acceptance?.criteria ?? []))
    .map(entry => Object.freeze({ identity: entry.identity, position: entry.position,
      text: entry.text, text_sha256: controlledContractContentDigest(entry.text) }));
}

export function acceptanceCriterionAssociationOwner(inventory, { wkId, selectedUnit, focus = null }) {
  const byIdentity = new Map(inventory.map(entry => [entry.identity, entry]));
  return (identities, obligationId) => {
    const unknown = identities.filter(identity => !byIdentity.has(identity));
    if (unknown.length > 0) throw new ControlledContractToolError(
      'obligation_coverage_acceptance_criterion_unknown',
      'The obligation names acceptance criteria the selected unit does not currently have', {
        changed: false, phase: 'request', unit: unitAddress({ wkId, selectedUnit }),
        obligation_id: obligationId, unknown_criterion_identities: unknown,
        next_calls: [{ tool: QUERY_TOOL, arguments: {
          unit: unitAddress({ wkId, selectedUnit }), ...(focus ? { focus } : {}) } }]
      });
    return identities.map(identity => ({ identity,
      text_sha256: byIdentity.get(identity).text_sha256 }));
  };
}

function association(inventory, entry) {
  const current = inventory.find(criterion => criterion.identity === entry.identity);
  return current === undefined ? 'criterion_absent'
    : current.text_sha256 !== entry.text_sha256 ? 'criterion_text_changed' : 'current';
}

export function assessAcceptanceCriterionCoverage({ inventory, obligations,
  validObligationIds, wkId, selectedUnit = null, focus = null }) {
  const valid = new Set(validObligationIds);
  const coveredBy = new Map(inventory.map(entry => [entry.identity, []]));
  const stale = [];
  for (const row of obligations) {
    for (const entry of row.acceptance_criteria ?? []) {
      const state = association(inventory, entry);
      if (state !== 'current') {
        stale.push({ obligation_id: row.obligation_id, identity: entry.identity, reason: state });
      } else if (valid.has(row.obligation_id)) {
        coveredBy.get(entry.identity).push(row.obligation_id);
      }
    }
  }
  const uncovered = inventory.filter(entry => coveredBy.get(entry.identity).length === 0);
  const unit = unitAddress({ wkId, selectedUnit });
  const status = inventory.length === 0 ? 'not_applicable'
    : uncovered.length === 0 ? 'complete' : 'incomplete';
  return Object.freeze({
    schema_version: ACCEPTANCE_CRITERION_COVERAGE_SCHEMA_VERSION,
    selected_unit: unit,
    status,
    basis: 'author_declared_obligation_associations',
    criterion_count: inventory.length,
    covered_count: inventory.length - uncovered.length,
    uncovered_count: uncovered.length,
    uncovered_criteria: Object.freeze(uncovered.slice(0, LISTED_LIMIT).map(entry =>
      Object.freeze({ identity: entry.identity, position: entry.position }))),
    uncovered_criteria_omitted: Math.max(0, uncovered.length - LISTED_LIMIT),
    stale_association_count: stale.length,
    stale_associations: Object.freeze(stale.slice(0, LISTED_LIMIT).map(Object.freeze)),
    stale_associations_omitted: Math.max(0, stale.length - LISTED_LIMIT),

    verification_credit: 0,
    correction: status !== 'incomplete' ? null : Object.freeze({
      read_tool: QUERY_TOOL,
      write_tool: UPSERT_TOOL,
      arguments: Object.freeze({ unit, ...(focus ? { focus } : {}) }),
      expected_content_digest_from: 'read_tool_response.content_digest',
      effect: 'associate_or_author_obligations_for_uncovered_criteria',
      field: 'obligations[].acceptance_criteria'
    })
  });
}
