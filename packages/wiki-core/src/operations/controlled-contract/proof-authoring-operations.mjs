import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { compileProofAuthoringCases } from './proof-authoring-case.mjs';
import { planProofAuthoringRequirementRebinding } from './proof-authoring-requirement-rebinding.mjs';
import { planProofAuthoringRequirementRetirement } from './proof-authoring-requirement-retirement.mjs';
import { settleProofAuthoringCases } from './proof-authoring-targets.mjs';
import { ControlledContractToolError, assertControlledContractOperationInput,
  controlledContractContentDigest, withCanonicalControlledContractSourceLease } from '../../lib/controlled-contract-tools.mjs';
import { assertPackageValidContract, loadControlledContractPackage,
  packageValidationDiagnostics } from './package-runtime.mjs';
import { controlledContractOperation } from './refusal.mjs';
import { resolveProofAuthoringSource, resolveProofAuthoringContext, assessProspectiveProofUses } from './proof-authoring-source.mjs';
import { persistObligationCoverageCarrier, obligationCoverageResolutionInput } from './proof-authoring-persistence.mjs';
import { addressedCorrectionCall, PROOF_VALIDATION_EXECUTION,
  PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, proofAuthoringGroupDiagnosis,
  proofValidationAssessment, proofValidationIssues, projectProofAuthoringDiagnosticGroups,
  semanticCauseGroupDiagnosis, usedCorrectionDefinitions } from
  './proof-authoring-diagnostic-projection.mjs';
import { compileProofAuthoringContractInputs,
  projectProofAuthoringContractInputs } from
  './proof-authoring-contract-inputs.mjs';
import { attributeControlledContractRequirementDiagnostics } from
  './contract-requirement-authoring.mjs';
import { coverageSelectorRecovery, coverageUnitArguments, proofCatalogDiscoveryRecovery } from './coverage-recovery-guidance.mjs';
import { CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } from '../../lib/work-record-proof-posture.mjs';
import { acceptanceCriterionAssociationOwner, acceptanceCriterionInventory,
  assessAcceptanceCriterionCoverage } from './acceptance-criterion-coverage.mjs';
import { inspectControlledContractDesignWorkbenchOperation } from
  './design-workbench-operations.mjs';
import { projectControlledContractTerminalGapDetails, semanticCauseCorrection,
  semanticCauseMeaning, semanticCauseSubject } from
  './terminal-gap-classification.mjs';

const unitAddress = value => value.selectedUnit === null ? value.wkId : `${value.wkId}#${value.selectedUnit}`;
const own = (value, key) => Object.hasOwn(value, key);
const caseReferenceIds = (cases, obligations = []) => [...new Set([
  ...cases.map(definition => definition.component?.reference_id),
  ...obligations.map(item => item.case?.component?.reference_id)
].filter(Boolean))];
export async function proofAuthoringOperation(callback) {
  return controlledContractOperation(async () => {
    try { return await callback(); }
    catch (error) {
      error.details = { ...error.details, limb: error.details?.limb ?? 'mechanical_failure' };
      throw error;
    }
  });
}
export async function refuseMalformedControlledContractObligationCoverageRequest({ operation, issueCount, issues }) {
  return proofAuthoringOperation(async () => {
    throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'Obligation request failed its closed schema', { changed: false, phase: 'request', operation,
        issue_count: issueCount, issues: structuredClone(issues) });
  });
}
function assertCAS(input, resolved) {
  const actual = resolved.revision;
  if (input.expectedContentDigest !== actual) throw new ControlledContractToolError(
    'obligation_coverage_content_digest_mismatch', 'Source content-digest CAS mismatched', {
      changed: false, phase: 'admission', expected_content_digest: input.expectedContentDigest,
      actual_content_digest: actual,

      next_calls: coverageSelectorRecovery({ family: 'obligation', input })
    });
}
function findObligation(resolved, id) {
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
    return [{ case_id: definition.case_id, verification_id: verificationId,
      authored_field_paths: authoredFieldPaths, uses }];
  }).sort((left, right) => left.case_id.localeCompare(right.case_id));
  if (affectedCases.length === 0) return assertPackageValidContract(validation);
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
      ...packageValidationDiagnostics(validation),
      authored_field_paths: authoredFieldPaths,
      null_corrections: nullCorrections,
      affected_cases: affectedCases,
      affected_case_count: affectedCases.length,
      incompatible_member_count: nullCorrections.length,
      affected_obligation_count: new Set(affectedUses.map(use =>
        `${use.unit}\u0000${use.obligation_id}`)).size
    });
}
async function mutation(input, remove, options) {
  return proofAuthoringOperation(async () => {
    let persistenceStarted = false;
    let committed = false;
    try {
      const pkg = await loadControlledContractPackage();
      assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit',
        'expectedContentDigest', ...(remove ? ['obligationId', 'removalScope'] : [
          'obligations', 'contractRequirements', 'controlledAcceptance'])]);
      if (!own(input, 'expectedContentDigest')) throw new ControlledContractToolError(
        'obligation_coverage_request_invalid', 'A combined revision is required');
      const target = obligationCoverageResolutionInput(input);
      const resolveSource = options.resolveFacts ?? resolveProofAuthoringSource;
      const resolveRevision = async () => bindProofAuthoringRevision(await resolveSource(target));
      const initial = await resolveRevision();
      assertCAS(input, initial);
      if (remove && !['selection', 'obligation'].includes(input.removalScope)) {
        throw new ControlledContractToolError('obligation_coverage_request_invalid',
          'Choose removal_scope selection or obligation; omitted removal scope is not supported', {
            changed: false, phase: 'request', accepted_removal_scopes: ['selection', 'obligation']
          });
      }
      if (remove) findObligation(initial, input.obligationId);
      const editsObligations = remove || own(input, 'obligations');
      const editsRequirements = !remove && own(input, 'contractRequirements');
      const editsPosture = !remove && own(input, 'controlledAcceptance');
      if (!remove && !editsObligations && !editsRequirements && !editsPosture) {
        throw new ControlledContractToolError('obligation_coverage_request_invalid',
          'Supply obligations, contract requirements, controlled acceptance, or a combination');
      }
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
        : editsObligations ? input.obligations : [];
      if (editsObligations && (!Array.isArray(obligations) || obligations.length === 0)) {
        throw new ControlledContractToolError(
          'obligation_coverage_request_invalid', 'Supply a nonempty obligations list');
      }
      const source = initial.source?.content ?? { schema_version: pkg.OBLIGATION_DRAFT_SCHEMA_VERSION,
        wk_id: initial.wkId, selected_unit: initial.selectedUnit, focus: initial.focus, obligations: [] };
      const authoredContent = editsObligations ? structuredClone(remove
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
      let contractInputs = compileProofAuthoringContractInputs({
        pkg, initial, input,
        baseContract: initial.contract?.content ?? null,
        retainedReferenceIds: caseReferenceIds(initial.cases, obligations),
        now: options.now
      });
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
        requirements: input.contractRequirements.requirements ?? [] }) : null;

      const requirementRetirements = contractInputs.requirementCompilation?.retirements ?? [];
      const retirement = requirementRetirements.length === 0 ? null : planProofAuthoringRequirementRetirement({
        retirements: requirementRetirements, contract: initial.contract?.content ?? null });

      const compileCases = editsObligations || initial.cases.length > 0 ||
        (rebinding?.selections.length ?? 0) > 0 || retirement !== null;
      let candidate = compileCases
        ? compileProofAuthoringCases({ pkg, initial: candidateInitial,
          content: structuredClone(authoredContent), obligations, rebinding, retirement })
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
          pkg,
          initial: { ...initial, record: firstContractInputs.record },
          input: { contractRequirements: input.contractRequirements },
          baseContract: initial.contract?.content ?? null,
          retainedReferenceIds: exactCaseReferences,
          now: options.now
        });
        contractInputs = { ...recompiled,
          record: firstContractInputs.record,
          postureChanged: firstContractInputs.postureChanged };
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
        candidate = compileProofAuthoringCases({
          pkg,
          initial: candidateInitial,
          content: structuredClone(authoredContent),
          obligations,
          rebinding,
          retirement
        });
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
          correction: 'Omit the case and proof selection for an opted-out obligation, or supply ' +
            'proof_opt_out false with them.' });

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
        return change && (change.refresh_proof_version || own(change, 'proof_name') &&
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
        for (const selection of distinctRepins) {
          const pin = await pkg.pinProofSelection(selection.proof_name);
          if (['proof_version', 'profile_digest', 'parameter_contract_digest', 'admission_digest'].some(key => pin[key] !== selection[key])) {
            throw new ControlledContractToolError('obligation_coverage_final_compare_stale', 'Requested current definition moved before publication');
          }
        }
        for (const definition of new Map(assessment.definition_identities.map(value =>
          [controlledContractContentDigest(value), value])).values()) await pkg.loadPinnedProofSelection(definition);
      };
      const assertCurrent = async () => {
        const current = await resolveRevision();
        if (current.revision !== initial.revision) throw new ControlledContractToolError(
          'obligation_coverage_final_compare_stale', 'Combined authoring revision changed before effects',
          { next_calls: coverageSelectorRecovery({ family: 'obligation', input }) });
        await assertDefinitions();
        return current;
      };
      persistenceStarted = true;
      if (candidate.nativeChanged || candidate.sourceChanges.some(entry => entry.selectedUnit !== initial.selectedUnit) || candidate.targetsChanged) {
        await settleProofAuthoringCases({ input: target, initial, candidate, assertCurrent, assertDefinitions, options });
        committed = true;
      } else if (candidate.content !== null && controlledContractContentDigest(candidate.content) !==
          controlledContractContentDigest(initial.source?.content ?? null)) {
        const receipt = await (options.persistCarrier ?? persistObligationCoverageCarrier)({ input,
          expectedSnapshot: initial, content: candidate.content,
          bytes: Buffer.from(`${JSON.stringify(candidate.content, null, 2)}\n`),
          write: controlledContractContentDigest(candidate.content) !== initial.source?.content_digest,
          resolveFacts: assertCurrent, directorySync: true, classifyPostCommit: true, draftObligation: true,
          ...(options.persistenceEffects ? { persistenceEffects: options.persistenceEffects } : {}),
          withSourceLease: options.withSourceLease ?? ((_args, callback) => withCanonicalControlledContractSourceLease({
            ...target, mutation: { carrierKind: 'contract', obligationSources: initial.sources.map(entry => ({ selectedUnit: entry.selectedUnit })) } }, callback)) });
        committed = receipt.changed === true;
        if (receipt.status === 'post_commit_failure') return { ...receipt, unit: unitAddress(initial) };
      }
      const final = await resolveRevision();
      const finalMatches = candidate.sources.every(entry => controlledContractContentDigest(entry.content ?? null) ===
        controlledContractContentDigest(final.sources.find(actual => actual.selectedUnit === entry.selectedUnit)?.source?.content ?? null)) && controlledContractContentDigest(final.source?.content ?? null) === controlledContractContentDigest(candidate.content) &&
        controlledContractContentDigest(final.record) === controlledContractContentDigest(candidate.record) &&
        controlledContractContentDigest(final.cases) === controlledContractContentDigest(candidate.cases) &&
        controlledContractContentDigest(final.contract?.content ?? null) === controlledContractContentDigest(candidate.canonicalContract);
      if (!finalMatches) throw new ControlledContractToolError('obligation_coverage_readback_moved',
        'Authored state moved before the save receipt could be read back');
      await assertDefinitions();

      return { unit: unitAddress(initial), saved: candidate.saved, unchanged: candidate.unchanged, content_digest: final.revision,

        ...(editsPosture && input.controlledAcceptance?.disposition === 'opted_out'
          ? { controlled_acceptance: CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } : {}),
        ...(editsRequirements ? { requirement_bindings: (contractInputs.requirementCompilation?.compiled ?? []).map((entry, index) => ({
          input_index: index, claim_id: entry.claim_id, verification_claim_id: entry.verification_claim_id,
          test_proof_id: entry.test_proof_id, replaced_claim_id: entry.replaced_claim_id })) } : {}),
        ...(retirement === null ? {} : { requirement_retirements: {
          selections: requirementRetirements.map(fact => ({ input_index: fact.retire_index, claim_id: fact.claim_id,
            retired_verification_claim_ids: fact.retired_verification_ids,
            surviving_verification_claim_ids: fact.surviving_verification_ids })),
          retired_obligation_count: candidate.retirement.retired_uses.length,
          retired_case_count: candidate.retirement.retired_case_ids.length } }) };
    } catch (error) {
      if (committed) return { unit: input.selectedUnit ? `${input.wkId}#${input.selectedUnit}` : input.wkId,
        status: 'post_commit_failure', commit_state: 'committed', failure_code: error.code ?? 'obligation_coverage_readback_failed',
        next_calls: [{ tool: 'workspace_controlled_contract_obligation_coverage_query', arguments: {
          unit: input.selectedUnit ? `${input.wkId}#${input.selectedUnit}` : input.wkId,
          ...(input.focus ? { focus: input.focus } : {}) } }] };
      if (!persistenceStarted) error.details = { ...error.details, changed: false, phase: error.details?.phase ?? 'admission' };
      throw error;
    }
  });
}

export const upsertControlledContractObligationCoverageOperation = (input, options = {}) => mutation(input, false, options);
export const removeControlledContractObligationCoverageOperation = (input, options = {}) => mutation(input, true, options);

function validationCall(resolved, fields = {}) {
  return { tool: 'workspace_validate_proof', arguments: {
    unit: unitAddress(resolved), ...(resolved.focus === null ? {} : { focus: resolved.focus }), ...fields
  } };
}

function wholeUnitCriterionCoverage(pkg, resolved, validObligationIds) {
  return assessAcceptanceCriterionCoverage({
    inventory: acceptanceCriterionInventory(pkg, resolved.unit),
    obligations: resolved.source?.content?.obligations ?? [],
    validObligationIds, wkId: resolved.wkId, selectedUnit: resolved.selectedUnit,
    focus: resolved.focus });
}
function selectedObligationCoverageScope(resolved) {
  return Object.freeze({ scope: 'selected_obligation', whole_unit_assessed: false,
    reason: 'A selected obligation\'s validation does not assess the unit\'s acceptance-criterion coverage.',
    supported_next_call: validationCall(resolved) });
}

export function validationContractInputsSummary(resolved, contractInputs) {
  const { requirements, controlled_acceptance: acceptance } = contractInputs;
  return {
    contract_content_digest: contractInputs.contract_content_digest,
    controlled_acceptance: { status: acceptance.status, disposition: acceptance.disposition,

      ...(acceptance.disposition === 'opted_out'
        ? { provenance: CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } : {}) },
    requirements: { status: requirements.status,
      total_requirements: requirements.selection.total_requirements,
      reference_count: requirements.selection.reference_count,
      residue_count: requirements.residue.length, note_count: requirements.notes.length },
    detail_call: { tool: 'workspace_controlled_contract_obligation_coverage_query',
      arguments: coverageUnitArguments(resolved) }
  };
}

function validationAssessment(resolved, result) {
  const rows = result.rows ?? [];
  const assessedRows = rows.filter(row => row.selected_proof_assessment !== null &&
    row.selected_proof_assessment !== undefined);
  const stageCount = (stage, status) => assessedRows.filter(row =>
    row.selected_proof_assessment?.stages?.[stage]?.status === status).length;
  const authoredValid = rows.filter(row => row.status === 'valid').length;
  const routeDiagnostics = assessedRows.flatMap(row => row.diagnostics).filter(diagnostic =>
    diagnostic.problem?.route_assessment !== undefined);
  const routeEffectCount = effect => routeDiagnostics.filter(diagnostic =>
    diagnostic.problem.route_assessment.effect === effect).length;
  const prevents = assessedRows.filter(row =>
    row.selected_proof_assessment.prevents_selected_route === true).length;
  return {
    authored: { status: rows.length > 0 && authoredValid === rows.length ? 'valid' : 'invalid',
      obligations: result.counts.obligations, valid: authoredValid, invalid: rows.length - authoredValid,
      explicit_gaps: result.counts.explicit_gaps, unselected: result.counts.unselected },
    route: {
      status: assessedRows.length === 0 ? 'not_assessed' : assessedRows.every(row =>
        row.selected_proof_assessment.prevents_selected_route === false)
        ? 'clear' : routeEffectCount('unresolved') > 0 ? 'unresolved' : 'blocked',
      assessed: assessedRows.length,
      prevents,
      stages: {
        authored_inputs: { complete: stageCount('authored_inputs', 'complete'),
          incomplete: stageCount('authored_inputs', 'incomplete') },
        canonical_sources: { current: stageCount('canonical_sources', 'current'),
          unresolved: stageCount('canonical_sources', 'unresolved') },
        system_capability: { available: stageCount('system_capability', 'available'),
          unavailable: stageCount('system_capability', 'unavailable') },
        execution_evidence: { not_started: stageCount('execution_evidence', 'not_started'),
          credit_granted: 0 }
      }
    },
    authoring_occurrence_effects: { scope: 'selected_routes_only', blocking: routeEffectCount('blocking'),
      nonblocking: routeEffectCount('nonblocking'), unresolved: routeEffectCount('unresolved') }
  };
}

const USER_REQUIREMENTS_COMPARISON_TARGETS = Object.freeze({
  whole_unit: 'the authored contract and obligations',
  selected_obligation: 'this obligation (whole-unit validity and coverage unassessed)',
  authored_scope: 'the authored scope'
});
function userRequirementsComparison(resolved, scope, deps) {
  if (deps.presentation?.orchestrator !== true) return {};
  const recorded = resolved.record?.sections?.user_requirements;
  const state = typeof recorded !== 'string' ? 'not_recorded' : recorded.length === 0 ? 'empty' : 'recorded';
  return { user_requirements_comparison: {
    scope,
    advisory: `Before dispatch, compare the current user requirements with ${USER_REQUIREMENTS_COMPARISON_TARGETS[scope]} ` +
      'for omissions, unjustified narrowing and unrequested scope; authored validity does not establish coverage of ' +
      'the user request.' + (state === 'recorded' ? '' : ' None are recorded, so coverage is unestablished.'),
    requirements: state,
    read_call: state === 'not_recorded' ? null : { tool: 'workspace_work_record_summary',
      arguments: { unit: resolved.wkId, ordinary_field: { field: 'sections.user_requirements' } } }
  } };
}

const dispatchNotAssessed = resolved => ({ status: 'not_assessed',
  call: { tool: 'workspace_validate_dispatch', arguments: { unit: unitAddress(resolved) } } });

function compactCriterionCoverage(coverage) {
  return { status: coverage.status, criteria: coverage.criterion_count, covered: coverage.covered_count,
    uncovered: coverage.uncovered_count, stale: coverage.stale_association_count,
    correction: coverage.correction };
}

function validationEnvelope(resolved, { sourceDigest, contextDigest }) {
  return { unit: unitAddress(resolved), content_digest: resolved.revision,
    source: { status: resolved.source === null ? 'source_absent' : 'source_present',
      source_digest: sourceDigest, context_digest: contextDigest } };
}

const INDEPENDENT_OWNER_PASSTHROUGH_CODES = new Set([
  'controlled_acceptance_source_not_current',
  'controlled_acceptance_proof_posture_invalid',
  'obligation_coverage_source_not_found'
]);

function independentOwnerRefusal(error) {
  const code = error?.code;
  return typeof code === 'string' && (
    INDEPENDENT_OWNER_PASSTHROUGH_CODES.has(code) ||
    code.startsWith('acceptance_coverage_canonical_source_') ||
    code.startsWith('controlled_contract_carrier_') ||
    code.startsWith('controlled_contract_generation_')
  );
}

function independentOwnerFailure(error, responsibleOwner) {

  if (independentOwnerRefusal(error)) return null;
  const code = typeof error?.code === 'string'
    ? error.code : 'independent_owner_failure';
  const originalDetails = error?.details !== null &&
      typeof error?.details === 'object'
    ? structuredClone(error.details) : null;
  return Object.freeze({
    code,
    ownership: 'system',
    responsible_owner: responsibleOwner,
    message: typeof error?.message === 'string'
      ? error.message : 'An independent validation owner failed',
    details: originalDetails === null ? null : Object.freeze(originalDetails),
    cause: Object.freeze({
      code,
      class: typeof error?.name === 'string' ? error.name : null,
      details: originalDetails === null ? null : Object.freeze(structuredClone(originalDetails))
    })
  });
}

function semanticValidationResult(resolved, semantic, context, failure) {
  const sourceDigest = resolved.source.content_digest;
  const contextDigest = controlledContractContentDigest({
    contract_nodes: context.contract_nodes ?? [],
    selected_unit: resolved.selectedUnit
  });
  const rows = semantic.rows.map((row) => {
    const sourceRow = resolved.rows.find(({ obligation_id: id }) => id === row.obligation_id);
    return {
      obligation_id: row.obligation_id,
      status: row.status === 'complete' ? 'valid' : 'invalid',
      semantic_status: row.status === 'complete' ? 'valid' : 'invalid',
      semantic_diagnostic_codes: row.diagnostics.map(({ code }) => code),
      authoring_status: row.status,
      authoring_diagnostic_codes: row.diagnostics.map(({ code }) => code),
      disposition: sourceRow?.gap ? 'explicit_gap'
        : sourceRow?.selection?.proof_name ? 'selected' : 'unselected',
      input_status: row.status,
      construction_status: 'unresolved',
      definition: null,
      resolved_identity: null,
      selected_proof_assessment: null,
      diagnostics: structuredClone(row.diagnostics)
    };
  });
  return Object.freeze({
    status: 'invalid',
    semantic_status: semantic.status === 'complete' ? 'valid' : 'invalid',
    source_digest: sourceDigest,
    context_digest: contextDigest,
    identity_digest: controlledContractContentDigest({ sourceDigest, contextDigest,
      semantic, failure }),
    definition_identities: [],
    diagnostics: structuredClone(semantic.diagnostics),
    rows,
    dependencies: [],
    mapping: null,
    obligation_facts: [],
    counts: {
      obligations: rows.length,
      resolved_selections: 0,
      valid: 0,
      invalid: rows.length,
      explicit_gaps: rows.filter(({ disposition }) => disposition === 'explicit_gap').length,
      unselected: rows.filter(({ disposition }) => disposition === 'unselected').length,
      dependency_nodes: 0
    }
  });
}

function publicOwnerFailure(failure) {
  return { code: failure.code, ownership: failure.ownership, responsible_owner: failure.responsible_owner,
    message: failure.message, cause: { code: failure.cause.code, class: failure.cause.class },
    details: failure.details === null ? null : structuredClone(failure.details),
    recovery: { actor_recovery: 'system_owner',
      explanation: 'An independent validation owner failed; this is not an authored-input defect, and changing ' +
        'authored proof inputs is not an established correction.' } };
}

function refuseOversizedValidationAnswer({ scope, bytes, limit, reason, nextCalls = [] }) {
  throw new ControlledContractToolError('proof_validation_answer_exceeds_compact_class',
    `The validation answer for ${JSON.stringify(scope)} measures ${bytes} bytes, above the ${limit}-byte compact class`, {
      changed: false, phase: 'delivery', scope, measured_bytes: bytes, limit, reason,
      next_calls: nextCalls });
}

function validationDelivery(deps) {
  const delivery = deps.delivery ?? null;
  return delivery === null
    ? { fits: () => true, measure: () => 0, limit: null }
    : { fits: value => delivery.measure(value) <= delivery.limit, measure: delivery.measure,
      limit: delivery.limit };
}

function publicDiagnosis(diagnosis, subjects, { resolved, clauses }) {
  const call = addressedCorrectionCall(diagnosis.correction_route, subjects, { unit: unitAddress(resolved),
    focus: resolved.focus, contentDigest: resolved.revision });
  return { ...diagnosis.selected, recovery: diagnosis.recovery, subjects,
    corrections: usedCorrectionDefinitions(subjects, clauses),
    correction_call: call,
    ...(call !== null && call.tool === UPSERT_TOOL_NAME ? { requires_authored_values: true } : {}) };
}

const UPSERT_TOOL_NAME = 'workspace_controlled_contract_obligation_coverage_upsert';

function selectedGroupAnswer({ envelope, diagnosis, resolved, clauses, delivery }) {
  const { subjects } = diagnosis;
  const build = (included, extra = {}) => {
    const body = publicDiagnosis(diagnosis, included, { resolved, clauses });
    const { subjects: listed, corrections, correction_call: call, requires_authored_values: values,
      recovery, ...selected } = body;
    return { schema_version: PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, ...envelope, selected,
      recovery, subjects: listed, corrections, correction_call: call,
      ...(values === undefined ? {} : { requires_authored_values: values }),
      subjects_total: subjects.length, subjects_omitted: subjects.length - included.length, ...extra,
      complete: included.length === subjects.length && extra.subject_index === undefined,
      execution: { ...PROOF_VALIDATION_EXECUTION } };
  };
  const complete = build(subjects);
  if (delivery.fits(complete)) return complete;
  const identified = subjects.every(subject => typeof subject.obligation_id === 'string');
  const ids = [...new Set(subjects.map(subject => subject.obligation_id))];
  const index = build([], { subject_index: { obligation_ids: ids, selector: 'obligation_id',
    call: validationCall(resolved) } });
  if (identified && ids.length > 0 && delivery.fits(index)) return index;
  let admitted = [];
  for (const subject of subjects) {
    const candidate = [...admitted, subject];
    if (!delivery.fits(build(candidate))) break;
    admitted = candidate;
  }
  if (admitted.length > 0) return build(admitted);
  const empty = build([]);
  if (delivery.fits(empty)) return empty;
  return refuseOversizedValidationAnswer({ scope: { unit: envelope.unit,
    diagnostic_group_id: diagnosis.selected.diagnostic_group_id }, bytes: delivery.measure(empty),
  limit: delivery.limit, reason: 'the selected group\'s shared cause and recovery alone exceed the compact class' });
}

function selectedObligationAnswer({ envelope, obligationId, row, route, diagnoses, ownerFailures,
  resolved, clauses, delivery, comparison }) {

  const build = (admitted) => ({ schema_version: PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, ...envelope,
    selected: { obligation_id: obligationId, authored: row?.status ?? 'invalid',
      route: route === null ? 'not_assessed' : route.prevents_selected_route === false ? 'clear' : 'blocked' },
    owner_failures: ownerFailures,
    diagnoses: admitted.map(({ entry }) => entry),
    corrections: Object.assign({}, ...admitted.map(({ corrections }) => corrections)),
    diagnoses_total: diagnoses.length, diagnoses_returned: admitted.length,
    diagnoses_omitted: diagnoses.length - admitted.length,
    complete: admitted.length === diagnoses.length,
    acceptance_coverage: selectedObligationCoverageScope(resolved),
    ...(row?.status === 'valid' ? comparison : {}),
    execution: { ...PROOF_VALIDATION_EXECUTION } });
  const entries = diagnoses.map(({ diagnosis, subjects }) => {
    const { corrections, ...entry } = publicDiagnosis(diagnosis, subjects, { resolved, clauses });
    return { entry, corrections };
  });
  let admitted = [];
  for (const entry of entries) {
    const candidate = [...admitted, entry];
    if (!delivery.fits(build(candidate))) break;
    admitted = candidate;
  }
  if (admitted.length === 0 && entries.length > 0) {
    return refuseOversizedValidationAnswer({ scope: { unit: envelope.unit, obligation_id: obligationId },
      bytes: delivery.measure(build(entries.slice(0, 1))), limit: delivery.limit,
      reason: 'the selected obligation\'s first indivisible diagnosis exceeds the compact class; ' +
        'no narrower existing selection states it' });
  }
  return build(admitted);
}

export async function validateProofOperation(input, deps = Object.freeze({})) {
  return proofAuthoringOperation(async () => {
    assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit',
      'obligationId', 'diagnosticGroupId']);
    if (input.obligationId !== undefined && input.diagnosticGroupId !== undefined) throw new ControlledContractToolError(
      'obligation_coverage_request_invalid', 'Select either one obligation or one diagnostic group', {
        changed: false, phase: 'request'
      });
    const delivery = validationDelivery(deps);
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
      obligationCoverageResolutionInput(input), { requireSource: false }));
    if (resolved.source === null) return sourceAbsentValidation(resolved, input, delivery, deps);
    const pkg = await loadControlledContractPackage();
    const obligationId = input.obligationId;
    if (obligationId !== undefined) findObligation(resolved, obligationId);

    const context = await resolveProofAuthoringContext(resolved, {});
    const { assessProofAuthoringSemantics } =
      await import('@agent-chassis/controlled-contract/proof-contract');
    const { occurrenceRecoveryFacts, occurrencePublicRecovery, OCCURRENCE_CORRECTION_CLAUSES } =
      await import('@agent-chassis/controlled-contract/executable-map');
    const semanticAssessment = assessProofAuthoringSemantics(resolved.source.content, context);
    let executableMapFailure = null;
    let result;
    try {
      const { resolveProofAuthoring: defaultResolveProofAuthoring } =
        await import('@agent-chassis/controlled-contract/proof-authoring');
      const resolveProofAuthoring = deps.resolveProofAuthoring ?? defaultResolveProofAuthoring;
      result = await resolveProofAuthoring(resolved.source.content, context);
    } catch (error) {
      executableMapFailure = independentOwnerFailure(error, 'proof-authoring-executable-map');
      if (executableMapFailure === null) throw error;
      result = semanticValidationResult(resolved, semanticAssessment, context,
        executableMapFailure);
    }
    const grouped = pkg.groupProofAuthoringDiagnostics(result);
    const diagnosticProjection = projectProofAuthoringDiagnosticGroups({
      grouped,
      resultIdentity: result.identity_digest,
      wkId: resolved.wkId,
      focus: resolved.focus,
      selectedUnit: resolved.selectedUnit
    });
    const inspectDesignWorkbench = deps.inspectControlledContractDesignWorkbench ??
      inspectControlledContractDesignWorkbenchOperation;
    let workbenchFailure = null;
    let workbench = null;
    try {
      workbench = await inspectDesignWorkbench({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        selectedUnit: input.selectedUnit ?? null
      });
    } catch (error) {
      workbenchFailure = independentOwnerFailure(error,
        'controlled-contract-design-workbench');
      if (workbenchFailure === null) throw error;
    }
    const semanticDetails = workbench === null ? null :
      projectControlledContractTerminalGapDetails({ workbench });
    const semanticGroups = semanticDetails?.groups ?? [];
    const ownerFailures = [executableMapFailure, workbenchFailure].filter(Boolean).map(publicOwnerFailure);
    const assessment = validationAssessment(resolved, result);
    const envelope = validationEnvelope(resolved, { sourceDigest: result.source_digest,
      contextDigest: result.context_digest });
    const clauses = OCCURRENCE_CORRECTION_CLAUSES;
    const authoringDiagnosis = (index) => proofAuthoringGroupDiagnosis({
      projected: diagnosticProjection.groups[index], raw: grouped.groups[index],
      recoveryFacts: occurrenceRecoveryFacts, publicRecovery: occurrencePublicRecovery });
    const semanticDiagnosis = group => semanticCauseGroupDiagnosis({ group,
      semanticMeaning: semanticCauseMeaning, semanticSubject: semanticCauseSubject,
      semanticCorrection: semanticCauseCorrection });

    if (input.diagnosticGroupId !== undefined) {
      const proofIndex = diagnosticProjection.groups.findIndex(group =>
        group.diagnostic_group_id === input.diagnosticGroupId);
      const semanticGroup = semanticGroups.find(group =>
        group.semantic_cause_id === input.diagnosticGroupId);
      if (proofIndex === -1 && semanticGroup === undefined) {
        if (workbenchFailure !== null) {
          throw new ControlledContractToolError(
            'obligation_coverage_semantic_diagnostic_detail_unavailable',
            'Semantic diagnostic detail is unavailable because its system owner failed', {
              changed: false,
              diagnostic_group_id: input.diagnosticGroupId,
              ownership: 'system',
              responsible_owner: workbenchFailure.responsible_owner,
              cause: workbenchFailure.cause,
              independent_owner_failure: workbenchFailure,
              authored_assessment: { ...assessment.authored, source: envelope.source },
              next_calls: [validationCall(resolved)]
            });
        }
        throw new ControlledContractToolError(
          'obligation_coverage_diagnostic_group_not_found',
          'The diagnostic group is unknown or belongs to a different resolved snapshot', {
            changed: false, diagnostic_group_id: input.diagnosticGroupId,
            next_calls: [validationCall(resolved)]
          });
      }
      const diagnosis = proofIndex === -1 ? semanticDiagnosis(semanticGroup) : authoringDiagnosis(proofIndex);
      return selectedGroupAnswer({ envelope, diagnosis, resolved, clauses, delivery });
    }

    if (obligationId !== undefined) {
      const row = result.rows.find(entry => entry.obligation_id === obligationId) ?? null;
      const named = subject => subject.obligation_id === obligationId;
      const authoring = grouped.groups.map((raw, index) => ({ raw, index }))
        .filter(({ raw }) => raw.occurrences.some(occurrence => occurrence.obligation_id === obligationId))
        .map(({ index }) => {
          const diagnosis = authoringDiagnosis(index);
          return { diagnosis, subjects: diagnosis.subjects.filter(named),
            priority: ISSUE_PRIORITY.authoring(diagnosis.selected.effect) };
        });
      const semantic = semanticGroups.filter(group => group.occurrences.some(occurrence =>
        occurrence.semantic_identity?.obligation_id === obligationId)).map(group => {
        const diagnosis = semanticDiagnosis(group);
        return { diagnosis, subjects: diagnosis.subjects.filter(named),
          priority: ISSUE_PRIORITY.semantic(group.recovery.status) };
      });
      const diagnoses = [...authoring, ...semantic].map((entry, order) => ({ ...entry, order }))
        .sort((left, right) => left.priority - right.priority || left.order - right.order);
      return selectedObligationAnswer({ envelope, obligationId, row,
        route: row?.selected_proof_assessment ?? null, diagnoses, ownerFailures, resolved, clauses, delivery,
        comparison: userRequirementsComparison(resolved, 'selected_obligation', deps) });
    }

    const coverage = wholeUnitCriterionCoverage(pkg, resolved,
      result.rows.filter(row => row.status === 'valid').map(row => row.obligation_id));
    const issues = proofValidationIssues({ authoringGroups: diagnosticProjection.groups,
      rawGroups: grouped.groups, semanticGroups, semanticMeaning: semanticCauseMeaning });
    const answer = proofValidationAssessment({
      envelope: { ...envelope, authored: assessment.authored, route: assessment.route,
        owner_failures: ownerFailures, execution: { ...PROOF_VALIDATION_EXECUTION },
        dispatch: dispatchNotAssessed(resolved), acceptance_coverage: compactCriterionCoverage(coverage),
        ...(assessment.authored.status === 'valid'
          ? userRequirementsComparison(resolved, 'whole_unit', deps) : {}) },
      diagnostics: { authoring_groups: grouped.groups.length, semantic_groups: semanticDetails?.group_count ?? 0,
        authoring_occurrence_effects: assessment.authoring_occurrence_effects,
        semantic_logical_cause_recovery: semanticDetails?.recovery_status_counts ?? {
          authored_correction_available: 0, system_owner_failure: workbenchFailure === null ? 0 : 1,
          inspection_only: 0 } },
      issues, fits: delivery.fits });
    if (!delivery.fits(answer)) {
      refuseOversizedValidationAnswer({ scope: { unit: envelope.unit }, bytes: delivery.measure(answer),
        limit: delivery.limit, reason: 'the whole-unit assessment envelope alone exceeds the compact class',
        nextCalls: [] });
    }
    return answer;
  });
}

const ISSUE_PRIORITY = Object.freeze({
  authoring: effect => effect === 'blocking' || effect === 'unresolved' ? 0 : 2,
  semantic: status => status === 'authored_correction_available' || status === 'system_owner_failure' ? 1 : 3
});

async function sourceAbsentValidation(resolved, input, delivery, deps) {
  if (input.obligationId !== undefined) findObligation(resolved, input.obligationId);
  if (input.diagnosticGroupId !== undefined) throw new ControlledContractToolError(
    'obligation_coverage_diagnostic_group_not_found',
    'The diagnostic group is unknown or belongs to a different resolved snapshot', {
      changed: false, diagnostic_group_id: input.diagnosticGroupId, next_calls: [validationCall(resolved)] });
  const contractInputs = projectProofAuthoringContractInputs(resolved);
  const coveragePkg = await loadControlledContractPackage();
  const findings = [];
  if (contractInputs.controlled_acceptance.status === 'unset') findings.push({
    category: 'author_input', code: 'controlled_acceptance_disposition_missing',
    reason: 'Controlled-acceptance applicability has not been authored',
    owner: 'work-record-proof-posture' });
  if (contractInputs.controlled_acceptance.status === 'invalid') findings.push({
    category: 'canonical_source', code: 'controlled_acceptance_proof_posture_invalid',
    reason: contractInputs.controlled_acceptance.problem, owner: 'work-record-proof-posture' });
  if (contractInputs.controlled_acceptance.disposition === 'required' &&
      contractInputs.requirements.requirements.length === 0) findings.push({
    category: 'author_input', code: 'controlled_contract_requirements_missing',
    reason: 'Controlled acceptance applies but no contract requirements are saved',
    owner: 'contract-requirement-authoring' });
  if (contractInputs.controlled_acceptance.disposition === 'required') findings.push({
    category: 'author_input', code: 'obligation_coverage_source_not_found',
    reason: 'No proof-authoring obligations are saved', owner: 'proof-authoring-source' });
  const identity = controlledContractContentDigest({ contract_inputs: contractInputs, diagnostics: findings });
  const issues = findings.map(finding => ({ meaning: { owner: finding.owner, code: finding.code,
    category: finding.category, reason: finding.reason }, subjects: 0, occurrences: 1, call: null,
  obligation_ids: [], obligations_omitted: 0 }));
  const zero = { obligations: 0, valid: 0, invalid: 0, explicit_gaps: 0, unselected: 0 };
  return proofValidationAssessment({
    envelope: { ...validationEnvelope(resolved, { sourceDigest: null, contextDigest: identity }),
      authored: { status: findings.length === 0 ? 'valid' : 'invalid', ...zero },
      route: { status: 'not_assessed', assessed: 0, prevents: 0, stages: {
        authored_inputs: { complete: 0, incomplete: 0 }, canonical_sources: { current: 0, unresolved: 0 },
        system_capability: { available: 0, unavailable: 0 },
        execution_evidence: { not_started: 0, credit_granted: 0 } } },
      owner_failures: [], execution: { ...PROOF_VALIDATION_EXECUTION }, dispatch: dispatchNotAssessed(resolved),
      acceptance_coverage: compactCriterionCoverage(wholeUnitCriterionCoverage(coveragePkg, resolved, [])),
      ...(findings.length === 0 ? userRequirementsComparison(resolved, 'authored_scope', deps) : {}) },
    diagnostics: { authoring_groups: findings.length, semantic_groups: 0,
      authoring_occurrence_effects: { scope: 'selected_routes_only', blocking: 0, nonblocking: 0, unresolved: 0 },
      semantic_logical_cause_recovery: { authored_correction_available: 0, system_owner_failure: 0,
        inspection_only: 0 } },
    issues, fits: delivery.fits });
}
