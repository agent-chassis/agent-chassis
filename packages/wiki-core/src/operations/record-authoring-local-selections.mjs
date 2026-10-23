

import { compileProofAuthoringContractInputs } from './controlled-contract/proof-authoring-contract-inputs.mjs';
import { createPublicSelectionSource, resolvePublicSelections, projectPublicSelection } from './controlled-contract/public-selection.mjs';
import { ControlledContractToolError, controlledContractContentDigest } from '../lib/controlled-contract-tools.mjs';
import { projectRequirementMutationFailure } from './controlled-contract/proof-authoring-case-diagnosis.mjs';
import { caseReferenceIds } from './controlled-contract/proof-authoring-preparation.mjs';

export async function resolveRecordAuthoringLocalClaims({ pkg, captured, record, unit, changes, batch, selections, requirementAuthoring }) {
  const slots = (changes.obligations ?? []).flatMap((row, index) => (row.claims ?? []).flatMap((selector, at) =>
    selector?.kind === 'claim' && typeof selector.requirement === 'string'
      ? [{ selector, field: `changes.obligations[${index}].claims[${at}]` }] : []));
  if (!slots.length) return new Map();
  let contract;
  try {
    ({ contract } = compileProofAuthoringContractInputs({ pkg, requirementAuthoring, initial: { ...captured, record, unit },
      input: batch === null ? {} : { contractRequirements: batch.answer },
      retainedReferenceIds: caseReferenceIds(captured.cases) }));
  } catch (error) {
    await projectRequirementMutationFailure(error, captured, { captured, changes, rows: batch?.rows ?? [], selections });
    throw error;
  }
  const source = await createPublicSelectionSource({ captured: { ...captured, record, unit,
    contract: contract === null ? null : { content: contract, content_digest: controlledContractContentDigest(contract) } }, population: 'all' });
  const { results: [population] } = await resolvePublicSelections({ source, population: 'requirements', intent: 'read' });
  const fail = (slot, issue, selection) => {
    throw new ControlledContractToolError(issue.code, typeof issue.cause === 'string' ? issue.cause : JSON.stringify(issue.cause),
      { changed: false, field: slot.field, target: slot.selector, selection });
  };
  if (population.status !== 'resolved') fail(slots[0], population.issue, projectPublicSelection(population));
  const localBindings = new Map();
  const { results: [checks] } = await resolvePublicSelections({ source, population: 'verifications', intent: 'read' });
  if (checks.status !== 'resolved') fail(slots[0], checks.issue, projectPublicSelection(checks));
  for (const row of batch?.rows ?? []) {
    const key = row.key ?? changes.requirements.requirements[row.index].replacement_key;
    if (key === undefined && row.verification_key === undefined) continue;
    const match = population.matches.find(match => match.kind === 'requirement' && match.internal.row_id === row.row_id);
    if (!match) fail(slots[0], { code: 'selection_unavailable',
      cause: 'The prepared declaration has no complete prospective semantic binding. No replacement assertion was selected.' });
    if (key !== undefined) localBindings.set(key, { source, match });
    if (row.verification_key !== undefined) {
      const check = checks.matches.find(candidate => candidate.internal.claim_id === row.verification_claim_id);
      if (!check) fail(slots[0], { code: 'selection_unavailable', cause: 'The submitted check has no complete prospective semantic binding.' });
      localBindings.set(row.verification_key, { source, match: check });
    }
  }
  const { results } = await resolvePublicSelections({ source, selectors: slots.map(slot => slot.selector),
    intent: 'write', expectedRevision: captured.authoringIdentity, localBindings });
  return new Map(slots.map((slot, index) => {
    const result = results[index];
    if (result.status !== 'resolved') fail(slot, result.issue, projectPublicSelection(result));
    if (result.matches.length !== 1 || result.matches[0].kind !== 'claim') fail(slot, { code: 'selection_kind_mismatch',
      cause: 'A request-local claim selection must identify exactly one submitted assertion; no broader association was selected.' });

    return [slot.selector, result.matches[0].internal.claim_id];
  }));
}
