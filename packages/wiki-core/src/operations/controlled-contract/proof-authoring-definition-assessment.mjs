

import { proofAuthoringDiagnosticGroupId } from './proof-authoring-diagnostic-projection.mjs';
import { projectControlledContractRequirements } from './contract-requirement-authoring.mjs';
import { prepareProofAuthoringDescriptionRead, projectProofAuthoringContractInputs } from './proof-authoring-contract-inputs.mjs';

const json = value => JSON.stringify(value);
const unique = values => [...new Set(values)].sort();
const owner = 'contract-requirement-descriptions';
const nodeIds = (resolved, pkg, row) => [...(row.controlled_contract_node_ids ?? []),
  ...resolved.cases.filter(definition => definition.case_id === row.case_id).map(pkg.authoredCaseVerificationId)];

export async function assessProofAuthoringDefinitions(resolved, pkg, obligationId) {
  const rows = resolved.rows.filter(row => obligationId === undefined || row.obligation_id === obligationId);
  const all = resolved.selectedUnit === null && obligationId === undefined;
  const controlledContractNodeIds = all ? null : unique(rows.flatMap(row => nodeIds(resolved, pkg, row)));
  const descriptionPreparation = await prepareProofAuthoringDescriptionRead(resolved, { controlledContractNodeIds });
  const requirements = projectProofAuthoringContractInputs(resolved, {
    controlledContractNodeIds, descriptionPreparation }).requirements;
  const scope = all ? 'whole_unit' : obligationId === undefined ? 'slice' : 'selected_obligation';
  if (requirements.status === 'absent') return { specification: { status: 'not_assessed', scope,
    authored_meaning: 'not_assessed', lowering: 'not_assessed', source_resolution: 'not_assessed', findings: 0 }, entries: [] };
  const descriptions = requirements.descriptions;

  const links = new Map(rows.map(row => [row.obligation_id, new Set(projectControlledContractRequirements(
    resolved.contract?.content ?? null, { controlledContractNodeIds: nodeIds(resolved, pkg, row) })
    .requirements.map(requirement => requirement.claim_id))]));
  const nodes = new Map(descriptions.nodes.map(node => [node.key, node]));
  const findings = descriptions.missing;
  const categoryOf = finding => {
    if (finding.code === 'description_lowering_unsupported') return 'system_capability';
    if (finding.source !== undefined) return 'canonical_source';

    if (finding.key !== undefined && findings.some(other => other.key === finding.key && (other.source !== undefined ||
      other.code === 'description_lowering_unsupported'))) return 'definition_resolution';
    return 'author_input';
  };
  const entries = findings.map(finding => {
    const affectedRoots = descriptions.roots.filter(root => root.missing.some(row => json(row) === json(finding)));
    const affected = requirements.requirements.filter(requirement => affectedRoots.some(root =>
      nodes.get(root.key)?.definitions.some(definition => definition.claim_id === requirement.claim_id &&
        json(definition.constraint.applies) === json(root.applicability))) || finding.claim_id === requirement.claim_id);
    const claimIds = affected.map(row => row.claim_id);
    const requirementRowIds = unique((resolved.contract?.content.authored_requirements?.rows ?? [])
      .filter(row => row.claim_ids.some(id => claimIds.includes(id)) || affectedRoots.some(root =>
        row.constraint_ids.some(id => root.defining_constraint_ids.includes(id)) &&
        json(row.input.subject.identity) === json(root.entity.identity))).map(row => row.row_id));
    const obligationIds = rows.filter(row => claimIds.some(id => links.get(row.obligation_id).has(id)))
      .map(row => row.obligation_id);
    const object = nodes.get(finding.key);
    const facts = { finding: structuredClone(finding), requirement_claim_ids: claimIds,
      requirement_row_ids: requirementRowIds,
      ...(object === undefined ? {} : { object: { key: object.key, owner: object.owner, entity: object.entity,
        reference_ids: object.reference_ids } }) };
    const category = categoryOf(finding);
    const diagnosticGroupId = proofAuthoringDiagnosticGroupId(resolved.revision, 'requirement-definition-assessment.v1', finding);
    const subjects = obligationIds.length === 0 ? [facts] : obligationIds.map(obligation_id => ({ obligation_id, ...facts }));
    const selected = { diagnostic_group_id: diagnosticGroupId, family: 'definition', owner, code: finding.code, category,
      meaning: finding.recovery ?? finding.reason ?? finding.code };
    return { family: 'definition', diagnosis: { selected, subjects,
      recovery: { actor_recovery: category === 'author_input' ? 'agent' : 'system_owner',
        explanation: selected.meaning }, correction_route: null }, subjects,
      issue: { meaning: { owner, code: finding.code, category, reason: selected.meaning,
        effect: category === 'author_input' ? 'incomplete' : 'unresolved', stage: 'specification', route: 'not_assessed' }, ...facts,
        subjects: subjects.length, occurrences: 1, obligation_ids: obligationIds, obligations_omitted: 0,
        call: { tool: 'workspace_validate_proof', arguments: { unit: resolved.selectedUnit === null ? resolved.wkId
          : `${resolved.wkId}#${resolved.selectedUnit}`, ...(resolved.focus === null ? {} : { focus: resolved.focus }),
        diagnostic_group_id: diagnosticGroupId } } } };
  });
  const count = category => entries.filter(entry => entry.diagnosis.selected.category === category).length;
  return { specification: { status: descriptions.state, scope,
    authored_meaning: count('author_input') > 0 ? 'incomplete' : count('definition_resolution') > 0 ? 'unresolved' : 'complete',
    lowering: count('system_capability') > 0 ? 'unsupported' : 'supported',
    source_resolution: count('canonical_source') > 0 ? 'unavailable' : 'available', findings: entries.length }, entries };
}
