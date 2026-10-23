import { resolveExceptionSourcePassages } from './contract-requirement-source-links.mjs';

import { projectRequirementMutationFailure } from './proof-authoring-case-diagnosis.mjs';
import { compileProofAuthoringCases } from './proof-authoring-case.mjs';
import { planProofAuthoringRequirementRebinding } from './proof-authoring-requirement-rebinding.mjs';
import { planProofAuthoringRequirementRetirement } from './proof-authoring-requirement-retirement.mjs';
import { ControlledContractToolError, controlledContractContentDigest } from
  '../../lib/controlled-contract-tools.mjs';
import { assertPackageValidContract, packageValidationDiagnostics } from './package-runtime.mjs';
import { assessProspectiveProofUses } from './proof-authoring-source.mjs';
import { compileProofAuthoringContractInputs, requireRequirementAuthoringOperation } from './proof-authoring-contract-inputs.mjs';
import { attributeControlledContractRequirementDiagnostics } from
  './contract-requirement-authoring.mjs';
import { proofCatalogDiscoveryRecovery } from './coverage-recovery-guidance.mjs';
import { acceptanceCriterionAssociationOwner, acceptanceCriterionInventory } from
  './acceptance-criterion-coverage.mjs';
import { RECORD_AUTHORING_EXCEPTION_CODES } from '../../lib/record-authoring-exception.mjs';
import { prepareProofAuthoringRefresh } from './proof-authoring-refresh.mjs';

export const unitAddress = value => value.selectedUnit === null ? value.wkId : `${value.wkId}#${value.selectedUnit}`;
export const caseReferenceIds = (cases, obligations = []) => [...new Set([
  ...cases.map(definition => definition.component?.reference_id),
  ...obligations.map(item => item.case?.component?.reference_id)
].filter(Boolean))];
export function findObligation(resolved, id) {
  const row = resolved.rows.find(row => row.obligation_id === id);
  if (!row) throw new ControlledContractToolError('obligation_coverage_obligation_not_found',
    'The obligation does not exist in this source', { changed: false, obligation_id: id });
  return row;
}
function removeProofAuthoringObligation(pkg, source, obligationId) {
  const content = structuredClone(pkg.assertProofAuthoringDraft(source));
  content.obligations = content.obligations.filter(row => row.obligation_id !== obligationId);
  return pkg.assertProofAuthoringDraft(content);
}
function assertProspectiveCaseContract(pkg, candidate) {
  const validation = pkg.validateNativeTestProofAuthoringContract(candidate.contract);
  if (validation.valid) return;
  const incompatibleVerifications = new Set((validation.diagnostic_details ?? [])
    .filter(diagnostic => diagnostic.keyword === 'not' &&
      /\/falsifiers\/0\/mutation$/u.test(diagnostic.field_pointer ?? diagnostic.pointer ?? ''))
    .map(diagnostic => diagnostic.verification_claim_id).filter(Boolean));
  const affectedCases = candidate.cases.flatMap(definition => {
    const verificationId = pkg.authoredCaseVerificationId(definition);
    if (!incompatibleVerifications.has(verificationId)) return [];
    const falsification = definition.falsification ?? {};
    const authoredFieldPaths = [
      ...(Object.hasOwn(falsification, 'entry_export') ? ['case.falsification.entry_export'] : []),
      ...(Object.hasOwn(falsification, 'operation') ? ['case.falsification.operation'] : [])
    ];
    if (authoredFieldPaths.length === 0) return [];
    const uses = candidate.sources.flatMap(source => (source.content?.obligations ?? [])
      .filter(row => row.case_id === definition.case_id)
      .map(row => ({ unit: source.selectedUnit === null ? candidate.record.id :
        `${candidate.record.id}#${source.selectedUnit}`, obligation_id: row.obligation_id })))
      .sort((left, right) => left.unit.localeCompare(right.unit) ||
        left.obligation_id.localeCompare(right.obligation_id));
    return [{ case_id: definition.case_id,
      authored_field_paths: authoredFieldPaths, uses }];
  }).sort((left, right) => left.case_id.localeCompare(right.case_id));
  if (affectedCases.length === 0) return assertPackageValidContract(validation, candidate.contract);
  const authoredFieldPaths = [...new Set(affectedCases.flatMap(entry =>
    entry.authored_field_paths))].sort();
  const fieldNames = authoredFieldPaths.map(path => path.split('.').at(-1));
  const namedFields = fieldNames.length === 2 && fieldNames.includes('entry_export') &&
    fieldNames.includes('operation') ? 'entry_export and operation' : fieldNames.join(', ');
  const correctionText = authoredFieldPaths.map(path => `${path}=null`).join(' and ');
  const nullCorrections = affectedCases.flatMap(entry => entry.authored_field_paths.map(path => ({
    case_id: entry.case_id, path, value: null
  })));
  const affectedUses = affectedCases.flatMap(entry => entry.uses);
  const explanation = `This upsert would leave ${namedFields}, which dependency_failure does not allow. ` +
    `Reissue the amendment with ${correctionText}.`;
  throw new ControlledContractToolError('controlled_contract_carrier_validation_failed',
    explanation, {
      changed: false,
      explanation,
      ...packageValidationDiagnostics(validation, candidate.contract),
      authored_field_paths: authoredFieldPaths,
      null_corrections: nullCorrections,
      affected_cases: affectedCases,
      affected_case_count: affectedCases.length,
      incompatible_member_count: nullCorrections.length,
      affected_obligation_count: new Set(affectedUses.map(use =>
        `${use.unit}\u0000${use.obligation_id}`)).size
    });
}

function exceptionInput({ initial, exception, requirementAuthoring }) {
  const sourcePassages = resolveExceptionSourcePassages({ wkId: initial.wkId,
    text: initial.record?.sections?.user_requirements, passages: exception.source_passages });
  if (exception.kind === 'grammar') {
    const prepared = requireRequirementAuthoringOperation(requirementAuthoring, "prepareGrammarException")({ contract: initial.contract?.content ?? null, selected: exception.selectedUnresolved,
      action: exception.action, ...(exception.action === 'apply' ? { rationale: exception.rationale, sourcePassages } : {}) });
    return { contractRequirements: prepared.answer };
  }
  if (exception.kind === 'controlled_acceptance') {
    if (exception.subject !== initial.wkId) throw new ControlledContractToolError(
      RECORD_AUTHORING_EXCEPTION_CODES.SUBJECT_UNKNOWN,
      `exception.subject names ${JSON.stringify(exception.subject)}; the whole-unit exemption of ${unitAddress(initial)} is recorded on ${initial.wkId}`, {
        changed: false, phase: 'request', path: 'exception.subject', kind: 'controlled_acceptance',
        subject: exception.subject, unit: unitAddress(initial), accepted_subject: initial.wkId });
    return { controlledAcceptance: exception.action === 'apply'
      ? { disposition: 'opted_out', rationale: exception.rationale, sourcePassages } : { disposition: 'required' } };
  }
  return {};
}

export async function prepareProofAuthoringMutation({ pkg, initial, input, remove, now, requirementAuthoring, authoringContext = null }) {
  if (input.refreshProofs === true) return prepareProofAuthoringRefresh({ pkg, initial, now, requirementAuthoring,
    prepare: prepareProofAuthoringMutation });
  if (remove && !['selection', 'obligation'].includes(input.removalScope)) {
    throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'Choose removal_scope selection or obligation; omitted removal scope is not supported', {
        changed: false, phase: 'request', accepted_removal_scopes: ['selection', 'obligation']
      });
  }
  if (remove) findObligation(initial, input.obligationId);

  const exception = !remove && Object.hasOwn(input, 'exception') ? input.exception : null;
  if (exception !== null) {
    const combined = ['obligations', 'contractRequirements', 'controlledAcceptance'].filter(key => Object.hasOwn(input, key));
    if (combined.length > 0) throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'An exception is requested alone, never beside authored members', {
        changed: false, phase: 'request', path: 'exception', combined_with: combined });
    input = exceptionInput({ initial, exception, requirementAuthoring });
  } else if (!remove && Object.hasOwn(input, 'controlledAcceptance') &&
      input.controlledAcceptance?.disposition !== 'required') {
    throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'controlled_acceptance takes disposition required; no authored member exempts a unit', {
        changed: false, phase: 'request', path: 'changes.controlled_acceptance',
        accepted_dispositions: ['required'] });
  }
  const proofException = exception?.kind === 'proof' ? exception : null;
  const editsObligations = remove || Object.hasOwn(input, 'obligations') || proofException !== null;
  const editsRequirements = !remove && Object.hasOwn(input, 'contractRequirements');
  const editsPosture = !remove && Object.hasOwn(input, 'controlledAcceptance');
  const orphanRebindings = (editsRequirements ? input.contractRequirements?.requirements ?? [] : [])
    .flatMap((requirement, index) => requirement?.rebind_case_ids !== undefined &&
      requirement.replace_claim_id === undefined ? [index] : []);
  if (orphanRebindings.length > 0) throw new ControlledContractToolError('obligation_coverage_request_invalid',
    'rebind_case_ids retains cases only for a requirement replacement; supply replace_claim_id', {
      changed: false, phase: 'request', operation: 'upsert', issue_count: orphanRebindings.length,
      issues: orphanRebindings.map(index => ({ code: 'custom',
        path: ['contract_requirements', 'requirements', index, 'rebind_case_ids'],
        message: 'rebind_case_ids requires replace_claim_id' })) });
  const obligations = remove ? [{ obligation_id: input.obligationId }]
    : proofException !== null ? [{ obligation_id: proofException.subject }]
      : editsObligations ? input.obligations : [];
  if (editsObligations && (!Array.isArray(obligations) || obligations.length === 0)) {
    throw new ControlledContractToolError(
      'obligation_coverage_request_invalid', 'Supply a nonempty obligations list');
  }
  const source = initial.source?.content ?? { schema_version: pkg.OBLIGATION_DRAFT_SCHEMA_VERSION,
    wk_id: initial.wkId, selected_unit: initial.selectedUnit, focus: initial.focus, obligations: [] };
  if (proofException !== null && !initial.rows.some(row => row.obligation_id === proofException.subject)) {
    throw new ControlledContractToolError(RECORD_AUTHORING_EXCEPTION_CODES.SUBJECT_UNKNOWN,
      `exception.subject names ${JSON.stringify(proofException.subject)}, which is no saved obligation of ${unitAddress(initial)}`, {
        changed: false, phase: 'request', path: 'exception.subject', kind: 'proof', subject: proofException.subject,
        unit: unitAddress(initial), saved_obligations: initial.rows.length,
        correction: 'Read the selected unit\'s obligations for their saved ids; an exception names one existing obligation.' });
  }
  const authoredContent = proofException !== null ? structuredClone(pkg.applyProofAuthoringException(source,
    proofException.subject, { action: proofException.action,
      ...(proofException.action === 'apply' ? { rationale: proofException.rationale } : {}) }))
    : editsObligations ? structuredClone(remove
    ? input.removalScope === 'selection'
      ? pkg.removeProofAuthoringSelection(source, input.obligationId)
      : removeProofAuthoringObligation(pkg, source, input.obligationId)
    : await pkg.upsertProofAuthoringSelection(source,
      obligations.map(({ case: ignored, ...changes }) => changes), {
        criteria: acceptanceCriterionAssociationOwner(
          acceptanceCriterionInventory(pkg, initial.unit), initial) }).catch(error => {
      if (error?.code === 'obligation_coverage_proof_name_unknown') error.details = {
        ...error.details, next_calls: proofCatalogDiscoveryRecovery() };
      throw error;
    })) : source;
  let contractInputs;
  try {
    contractInputs = compileProofAuthoringContractInputs({
      pkg, initial, input, requirementAuthoring,
      baseContract: initial.contract?.content ?? null,
      retainedReferenceIds: caseReferenceIds(initial.cases, obligations),
      now: now
    });
  } catch (error) {
    await projectRequirementMutationFailure(error, authoringContext?.captured ?? initial, authoringContext);
    throw error;
  }
  let contractInputState = contractInputs.contract === null ? null : {
    content: contractInputs.contract,
    content_digest: controlledContractContentDigest(contractInputs.contract)
  };
  let contractInputUnit = initial.selectedUnit === null
    ? contractInputs.record
    : contractInputs.record.slices.find(slice => slice.id === initial.selectedUnit);
  let candidateInitial = { ...initial, record: contractInputs.record,
    unit: contractInputUnit, contract: contractInputState,
    previousContract: initial.contract?.content ?? null };

  const requirementCorrections = contractInputs.requirementCompilation?.corrections ?? [];
  const rebinding = editsRequirements ? planProofAuthoringRequirementRebinding({
    corrections: requirementCorrections,
    compiled: contractInputs.requirementCompilation?.compiled ?? [],
    requirements: input.contractRequirements.requirements ?? [] }) : null;

  const requirementRetirements = contractInputs.requirementCompilation?.retirements ?? [];
  const retirement = requirementRetirements.length === 0 ? null : planProofAuthoringRequirementRetirement({
    retirements: requirementRetirements, contract: initial.contract?.content ?? null,
    prospectiveContract: contractInputs.contract });

  const compileCases = editsObligations || initial.cases.length > 0 ||
    (rebinding?.selections.length ?? 0) > 0 || retirement !== null;
  let candidate = compileCases
    ? await compileProofAuthoringCases({ pkg, initial: candidateInitial,
      content: structuredClone(authoredContent), obligations, rebinding, retirement }, initial, authoringContext)
    : { contract: contractInputs.contract, canonicalContract: contractInputs.contract,
      record: contractInputs.record, unit: contractInputUnit, content: initial.source?.content ?? null,
      rootContent: initial.caseSource?.content ?? null, cases: initial.cases,
      sources: initial.sources.map(entry => ({ ...entry, content: entry.source?.content })),
      sourceChanges: [], nativeChanged: false, targetsChanged: false,
      affected: [], saved: 0, unchanged: 0 };

  if (editsRequirements && compileCases) {
    const firstContractInputs = contractInputs;
    const exactCaseReferences = caseReferenceIds(candidate.cases);
    const recompiled = compileProofAuthoringContractInputs({
      pkg, requirementAuthoring,
      initial: { ...initial, record: firstContractInputs.record },
      input: { contractRequirements: input.contractRequirements },
      baseContract: initial.contract?.content ?? null,
      retainedReferenceIds: exactCaseReferences,
      now: now
    });
    contractInputs = { ...recompiled,
      record: firstContractInputs.record,
      postureChanged: firstContractInputs.postureChanged,
      proofPosturePreparation: firstContractInputs.proofPosturePreparation };
    contractInputState = contractInputs.contract === null ? null : {
      content: contractInputs.contract,
      content_digest: controlledContractContentDigest(contractInputs.contract)
    };
    contractInputUnit = initial.selectedUnit === null
      ? contractInputs.record
      : contractInputs.record.slices.find(slice => slice.id === initial.selectedUnit);
    candidateInitial = { ...initial, record: contractInputs.record,
      unit: contractInputUnit, contract: contractInputState,
      previousContract: initial.contract?.content ?? null };
    if (controlledContractContentDigest([recompiled.requirementCompilation?.corrections ?? [],
      recompiled.requirementCompilation?.retirements ?? []]) !==
        controlledContractContentDigest([requirementCorrections, requirementRetirements])) {
      throw new Error('requirement compilation passes disagree on retirement facts');
    }
    candidate = await compileProofAuthoringCases({
      pkg,
      initial: candidateInitial,
      content: structuredClone(authoredContent),
      obligations,
      rebinding,
      retirement
    }, initial, authoringContext);
  }
  candidate.nativeChanged = controlledContractContentDigest(candidate.canonicalContract) !==
    controlledContractContentDigest(initial.contract?.content ?? null);
  candidate.targetsChanged = controlledContractContentDigest(candidate.record) !==
    controlledContractContentDigest(initial.record);
  const correctionsByIndex = new Map(requirementCorrections.map(fact => [fact.requirement_index, fact]));
  for (const [index, entry] of (contractInputs.requirementCompilation?.compiled ?? []).entries()) {
    const correction = correctionsByIndex.get(index);

    const unchanged = correction !== undefined
      ? correction.claim_id === correction.prior_claim_id && (correction.verification_claim_id === null
        ? correction.prior_verification_ids.length === 0
        : correction.prior_verification_ids.length === 1 &&
          correction.prior_verification_ids[0] === correction.verification_claim_id)
      : initial.contract?.content.claims?.some(claim => claim.claim_id === entry.claim_id);
    candidate[unchanged ? 'unchanged' : 'saved'] += 1;
  }

  candidate.saved += requirementRetirements.length;
  if (editsPosture) {
    candidate[contractInputs.postureChanged ? 'saved' : 'unchanged'] += 1;
  }
  if (candidate.canonicalContract !== null || candidate.cases.length > 0) {
    try {
      assertProspectiveCaseContract(pkg, candidate);
    } catch (error) {
      throw attributeControlledContractRequirementDiagnostics(error,
        contractInputs.requirementCompilation);
    }
  }

  const optOutCases = (candidate.content?.obligations ?? []).filter(row =>
    row.proof_opt_out === true && (row.case_id !== undefined || row.selection !== undefined));
  if (optOutCases.length > 0) throw new ControlledContractToolError(
    'obligation_coverage_proof_opt_out_conflict',
    'An obligation cannot both decline proof and keep a proof selection or case', {
      changed: false, phase: 'request', unit: unitAddress(initial),
      obligation_ids: optOutCases.map(row => row.obligation_id),
      correction: 'Keep one decision. A proof exception is withdrawn only by its own explicit withdrawal; ' +
        'a proof selection or case is removed only by its own explicit removal.' });

  const validatedSources = new Map();
  for (const entry of candidate.sourceChanges) {
    const validated = pkg.validateObligationCoverageDraft(entry.content);
    if (!validated.valid) throw new ControlledContractToolError('obligation_coverage_source_invalid',
      'Prospective source is invalid', { validation: validated, selected_unit: entry.selectedUnit });
    entry.content = validated.carrier;
    validatedSources.set(entry.selectedUnit, validated.carrier);
  }
  if (candidate.content !== null) {
    const validated = validatedSources.has(initial.selectedUnit)
      ? { valid: true, carrier: validatedSources.get(initial.selectedUnit) }
      : pkg.validateObligationCoverageDraft(candidate.content);
    if (!validated.valid) throw new ControlledContractToolError('obligation_coverage_source_invalid', 'Prospective source is invalid', { validation: validated });
    candidate.content = validated.carrier;
  }
  const prospective = { ...initial, record: candidate.record, unit: candidate.unit, cases: candidate.cases,
    contract: candidate.canonicalContract === null ? null : {
      content: candidate.canonicalContract,
      content_digest: controlledContractContentDigest(candidate.canonicalContract) },
    source: candidate.content === null ? null : { content: candidate.content,
      content_digest: controlledContractContentDigest(candidate.content) } };
  const assessment = await assessProspectiveProofUses(candidate.sources.filter(entry => entry.content).map(entry => {
    const unit = entry.selectedUnit === null ? candidate.record : candidate.record.slices.find(slice => slice.id === entry.selectedUnit);
    return { ...prospective, selectedUnit: entry.selectedUnit,
      unit, source: { content: entry.content, content_digest: controlledContractContentDigest(entry.content) } };
  }));
  const changesById = new Map(obligations.map(item => [item.obligation_id, item]));
  const initialRowsById = new Map(initial.rows.map(item => [item.obligation_id, item]));
  const repins = (candidate.content?.obligations ?? []).filter(row => {
    const change = changesById.get(row.obligation_id);
    const prior = initialRowsById.get(row.obligation_id)?.selection;
    return change && (change.refresh_proof_version || Object.hasOwn(change, 'proof_name') &&
      (prior?.proof_name !== row.selection?.proof_name || prior?.proof_version == null));
  }).map(row => row.selection).filter(selection => selection?.proof_name);
  const distinctRepins = [...new Map(repins.map(selection =>
    [controlledContractContentDigest({
      proof_name: selection.proof_name,
      proof_version: selection.proof_version,
      profile_digest: selection.profile_digest,
      parameter_contract_digest: selection.parameter_contract_digest,
      admission_digest: selection.admission_digest
    }), selection])).values()];
  const assertDefinitions = async () => {
    try {
      for (const selection of distinctRepins) {
        const pin = await pkg.pinProofSelection(selection.proof_name);
        if (['proof_version', 'profile_digest', 'parameter_contract_digest', 'admission_digest'].some(key => pin[key] !== selection[key])) {
          throw new ControlledContractToolError('obligation_coverage_final_compare_stale', 'Requested current definition moved',
            { movement: 'definition', proof_name: selection.proof_name, proof_version: selection.proof_version });
        }
      }
      for (const definition of new Map(assessment.definition_identities.map(value =>
        [controlledContractContentDigest(value), value])).values()) await pkg.loadPinnedProofSelection(definition);
    } catch (error) {

      const { changed: _changed, ...details } = error.details ?? {};
      error.details = details;
      throw error;
    }
  };
  return { candidate, contractInputs, editsRequirements, editsPosture, requirementRetirements,
    retirement, assertDefinitions };
}
