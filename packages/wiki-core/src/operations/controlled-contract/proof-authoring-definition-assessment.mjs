

import { proofAuthoringDiagnosticGroupId } from './proof-authoring-diagnostic-projection.mjs';
import { requirementUses } from './contract-requirement-normalization.mjs';
import { projectControlledContractRequirements } from './contract-requirement-authoring.mjs';
import { prepareProofAuthoringDescriptionRead, projectProofAuthoringContractInputs } from './proof-authoring-contract-inputs.mjs';
import { unresolvedSpecificationMeanings } from './authoring-exception-assessment.mjs';
import { createPublicSelectionSource, resolvePublicSelections, projectPublicSelection } from './public-selection.mjs';
import { projectRequirementDefinitionMeaning } from './contract-requirement-description-sources.mjs';

const json = value => JSON.stringify(value);
const unique = values => [...new Set(values)].sort();
const owner = 'contract-requirement-descriptions';

const authoredIdentity = finding => finding.source !== undefined &&
  (finding.code === 'description_repository_unavailable' &&
      typeof finding.source.repository === 'string' && typeof finding.source.bound_repository === 'string' ||
    finding.code === 'description_symbol_missing' ||

    (finding.code === 'description_source_missing' && finding.source.code === 'description_source_missing' &&
      typeof finding.source.path === 'string' && finding.source.source_generation?.committed_source != null) ||
    (['description_symbol_ambiguous', 'description_identity_ambiguous'].includes(finding.code) &&
      finding.source.candidates?.length > 0));
const nodeIds = (resolved, pkg, row) => [...(row.controlled_contract_node_ids ?? []),
  ...resolved.cases.filter(definition => definition.case_id === row.case_id).map(pkg.authoredCaseVerificationId)];

async function authoredTargets(resolved) {
  const source = await createPublicSelectionSource({ captured: resolved, population: 'all' });
  const population = (await resolvePublicSelections({ source, population: 'requirements', intent: 'read' })).results[0];
  if (population.status !== 'resolved') return { rows: new Map(), issue: projectPublicSelection(population).issue };
  const rows = population.matches.filter(match => match.kind === 'requirement');
  if (!rows.length) return { rows: new Map() };
  const selections = await resolvePublicSelections({ source, selectors: rows.map(match => match.selector), intent: 'read' });
  return { rows: new Map(rows.map((match, index) => {
    const selected = projectPublicSelection(selections.results[index]);
    return [match.internal.row_id, selected.status === 'ok'
      ? { target: selected.value.members[0].selector, declaration: selected.value.members[0].declaration }
      : { targeting: { status: selected.status, issue: selected.issue } }];
  })) };
}

export async function assessProofAuthoringSpecification(resolved, pkg, obligationId, preparation = null) {
  const rows = resolved.rows.filter(row => obligationId === undefined || row.obligation_id === obligationId);
  const all = resolved.selectedUnit === null && obligationId === undefined;
  const controlledContractNodeIds = all ? null : unique(rows.flatMap(row => nodeIds(resolved, pkg, row)));
  const descriptionPreparation = preparation ?? await prepareProofAuthoringDescriptionRead(resolved, { controlledContractNodeIds });
  const requirements = projectProofAuthoringContractInputs(resolved, {
    controlledContractNodeIds, descriptionPreparation }).requirements;
  const scope = all ? 'whole_unit' : obligationId === undefined ? 'slice' : 'selected_obligation';
  if (requirements.status === 'absent') return { specification: { status: 'not_assessed', scope,
    authored_meaning: 'not_assessed', lowering: 'not_assessed', source_resolution: 'not_assessed', findings: 0 }, findings: [] };
  const descriptions = requirements.descriptions;
  const findings = descriptions.missing;
  const categoryOf = finding => {
    if (finding.code === 'description_lowering_unsupported') return 'system_capability';
    if (finding.source !== undefined) return 'canonical_source';

    if (finding.key !== undefined && findings.some(other => other.key === finding.key && (other.source !== undefined ||
      other.code === 'description_lowering_unsupported'))) return 'definition_resolution';
    return 'author_input';
  };
  const count = category => findings.filter(finding => categoryOf(finding) === category).length;
  const unfinished = unresolvedSpecificationMeanings(resolved);
  const authoredMeaning = count('author_input') > 0 ? 'incomplete' : count('definition_resolution') > 0 ? 'unresolved' : 'complete';
  return { rows, requirements, unfinished, specification: {
    status: descriptions.state === 'complete' && unfinished.length > 0 ? 'incomplete' : descriptions.state, scope,
    authored_meaning: authoredMeaning === 'complete' && unfinished.length > 0 ? 'incomplete' : authoredMeaning,
    definitions: { status: descriptions.state, authored_meaning: authoredMeaning, findings: findings.length },
    unfinished_meaning: { scope: 'whole_unit', unit: resolved.wkId, count: unfinished.length },
    lowering: count('system_capability') > 0 ? 'unsupported' : 'supported',
    source_resolution: count('canonical_source') > 0 ? 'unavailable' : 'available', findings: findings.length },
    findings: findings.map(finding => ({ finding, category: categoryOf(finding) })) };
}

export async function assessProofAuthoringDefinitions(resolved, pkg, obligationId, preparation = null) {
  const assessed = await assessProofAuthoringSpecification(resolved, pkg, obligationId, preparation);
  if (assessed.specification.status === 'not_assessed') return { specification: assessed.specification, entries: [] };
  const { rows, requirements, specification } = assessed;
  const descriptions = requirements.descriptions;

  const links = new Map(rows.map(row => [row.obligation_id, new Set(projectControlledContractRequirements(
    resolved.contract?.content ?? null, { controlledContractNodeIds: nodeIds(resolved, pkg, row) })
    .requirements.map(requirement => requirement.claim_id))]));
  const nodes = new Map(descriptions.nodes.map(node => [node.key, node]));
  const publicRequirements = assessed.findings.length === 0 ? { rows: new Map() } : await authoredTargets(resolved);
  const targeting = id => publicRequirements.rows.get(id) ?? { targeting: { status: 'unavailable',
    ...(publicRequirements.issue === undefined ? { cause: 'No public authored declaration target is established for this requirement.' }
      : { issue: publicRequirements.issue }) } };
  const entries = assessed.findings.map(({ finding, category }) => {
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
    const uses = [];
    const identityUseRows = new Set();
    const reachableConstraints = new Set(affectedRoots.flatMap(root => root.defining_constraint_ids));
    for (const row of resolved.contract?.content.authored_requirements?.rows ?? []) {
      if (!requirementRowIds.includes(row.row_id) && !row.constraint_ids.some(id => reachableConstraints.has(id))) continue;
      const locations = [];
      requirementUses([row.input], locations);
      for (const use of locations) if (object !== undefined && json(use.id.identity) === json(object.entity.identity)) {
        identityUseRows.add(row.row_id);
        const { declaration: _declaration, ...selection } = targeting(row.row_id);
        uses.push({ ...selection,
          path: use.path.slice(2), role: use.role, accepted_types: use.types });
      }
    }
    const requiredUses = object?.uses.filter(use => use.missing.some(row => json(row) === json(finding))) ?? [];
    const { key: _key, claim_id: _claim, ...findingMeaning } = finding;
    const facts = { finding: projectRequirementDefinitionMeaning(findingMeaning),
      requirements: requirementRowIds.filter(id => !authoredIdentity(finding) || identityUseRows.has(id)).map(targeting), uses,
      required_uses: requiredUses.map(({ required_meaning, applicability }) => ({ required_meaning, applicability,
        entity_type: object.entity.type_term,
        required_value_type: required_meaning === 'condition' ? 'bool' : null })),
      ...(authoredIdentity(finding) ? { authored_identity_correction: true } : {}),
      ...(object === undefined ? {} : { object: { entity: { type_term: object.entity.type_term,
        identity: structuredClone(object.entity.identity) } } }) };
    const diagnosticGroupId = proofAuthoringDiagnosticGroupId(resolved.revision, 'requirement-definition-assessment.v1', finding);
    const subjects = obligationIds.length === 0 ? [facts] : obligationIds.map(obligation_id => ({ obligation_id, ...facts }));
    const selected = { diagnostic_group_id: diagnosticGroupId, family: 'definition', owner, code: finding.code, category,
      meaning: finding.recovery ?? finding.reason ?? finding.code };

    const { uses: _uses, required_uses: _requiredUses, authored_identity_correction: _identity, ...issueFacts } = facts;
    return { family: 'definition', diagnosis: { selected, subjects,
      recovery: { actor_recovery: category === 'author_input' || authoredIdentity(finding) ? 'agent' : 'system_owner',
        explanation: selected.meaning }, correction_route: null }, subjects,
      issue: { meaning: { owner, code: finding.code, category, reason: selected.meaning,
        effect: category === 'author_input' ? 'incomplete' : 'unresolved', stage: 'specification', route: 'not_assessed' }, ...issueFacts,
        subjects: subjects.length, occurrences: 1, obligation_ids: obligationIds, obligations_omitted: 0,
        call: { tool: 'workspace_validate_proof', arguments: { unit: resolved.selectedUnit === null ? resolved.wkId
          : `${resolved.wkId}#${resolved.selectedUnit}`, ...(resolved.focus === null ? {} : { focus: resolved.focus }),
        diagnostic_group_id: diagnosticGroupId } } } };
  });

  for (const meaning of assessed.unfinished) {
    const code = 'specification_meaning_unresolved';
    const diagnosticGroupId = proofAuthoringDiagnosticGroupId(resolved.revision, 'specification-meaning.v1', meaning);
    const subjects = [{ ...meaning, scope: 'whole_unit', unit: resolved.wkId }];
    const explanation = 'The owning unit still has unfinished specification meaning. Author its intended typed behavior through the requirement batch, preserving source links and other unresolved entries; an exception does not define or enforce it.';
    entries.push({ family: 'specification_meaning', subjects,
      diagnosis: { selected: { diagnostic_group_id: diagnosticGroupId, family: 'specification_meaning',
        owner: 'authored_requirements.unresolved', code, category: 'author_input', meaning: explanation },
      subjects, recovery: { actor_recovery: 'agent', explanation }, correction_route: null },
      issue: { meaning: { owner: 'authored_requirements.unresolved', code, category: 'author_input',
        effect: 'incomplete', stage: 'specification', route: 'not_assessed', reason: explanation },
      scope: 'whole_unit', unit: resolved.wkId, unresolved_id: meaning.id, location: meaning.location,
      ...(meaning.reason === undefined ? {} : { reason: meaning.reason }),
      subjects: 1, occurrences: 1, obligation_ids: [], obligations_omitted: 0,
      call: { tool: 'workspace_validate_proof', arguments: { unit: resolved.selectedUnit === null ? resolved.wkId
        : `${resolved.wkId}#${resolved.selectedUnit}`, ...(resolved.focus === null ? {} : { focus: resolved.focus }),
      diagnostic_group_id: diagnosticGroupId } } } });
  }
  return { specification, entries };
}
