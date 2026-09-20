import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { compileProofAuthoringCases, projectProofAuthoringCase } from './proof-authoring-case.mjs';
import { planProofAuthoringRequirementRebinding } from './proof-authoring-requirement-rebinding.mjs';
import { planProofAuthoringRequirementRetirement } from './proof-authoring-requirement-retirement.mjs';
import { settleProofAuthoringCases } from './proof-authoring-targets.mjs';
import { ControlledContractToolError, assertControlledContractOperationInput,
  controlledContractContentDigest, withCanonicalControlledContractSourceLease } from '../../lib/controlled-contract-tools.mjs';
import { assertPackageValidContract, loadControlledContractPackage,
  packageValidationDiagnostics } from './package-runtime.mjs';
import { controlledContractOperation } from './refusal.mjs';
import { resolveProofAuthoringSource, resolveProofAuthoringContext, assessProspectiveProofUses } from './proof-authoring-source.mjs';
import { persistObligationCoverageCarrier, obligationCoverageResolutionInput,
  encodeObligationCoverageOperationCursor, decodeObligationCoverageOperationCursor,
  obligationCoverageProjectionCursor } from './proof-authoring-persistence.mjs';
import { projectProofAuthoringDiagnosticGroups } from
  './proof-authoring-diagnostic-projection.mjs';
import { compileProofAuthoringContractInputs,
  projectProofAuthoringContractInputs } from
  './proof-authoring-contract-inputs.mjs';
import { attributeControlledContractRequirementDiagnostics } from
  './contract-requirement-authoring.mjs';
import { coverageSelectorRecovery, coverageUnitArguments, proofCatalogDiscoveryRecovery } from './coverage-recovery-guidance.mjs';
import { CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } from '../../lib/work-record-proof-posture.mjs';

const PAGE_SIZE = 25;
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
          obligations.map(({ case: ignored, ...changes }) => changes)).catch(error => {
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

function pageResult({ resolved, selector, cursor, identity, items, tool, extra = {} }) {
  const continued = decodeObligationCoverageOperationCursor(cursor, identity);
  if (continued && selector !== undefined && JSON.stringify(selector) !== JSON.stringify(continued.selector)) throw new ControlledContractToolError(
    'obligation_coverage_cursor_invalid', 'Cursor selection differs from request', { changed: false });
  const offset = continued?.offset ?? 0;
  if (offset > items.length || continued && offset === items.length) throw new ControlledContractToolError(
    'obligation_coverage_cursor_stale', 'Cursor offset is outside the selected population', { changed: false });
  const page = items.slice(offset, offset + PAGE_SIZE), next = offset + page.length;
  const continuation = next === items.length ? null : encodeObligationCoverageOperationCursor(
    obligationCoverageProjectionCursor(selector ?? continued?.selector ?? null, next), identity);
  const args = { unit: unitAddress(resolved), ...(resolved.focus === null ? {} : { focus: resolved.focus }),
    ...(selector?.obligation_id ? { obligationId: selector.obligation_id } : {}) };
  return { unit: unitAddress(resolved), content_digest: resolved.revision,
    source_identity: resolved.prospectiveIdentity, ...extra,
    total: items.length, returned: page.length, remaining: items.length - next,
    page: { offset, items: page, continuation, complete: continuation === null },
    next_calls: continuation === null ? [] : [{ tool, arguments: {
      unit: args.unit, ...(args.focus ? { focus: args.focus } : {}), cursor: continuation } }] };
}

const OBLIGATION_INVENTORY_STATEMENT_MAX_SCALARS = 1024;

function inventoryStatement(statement) {
  if (typeof statement !== 'string') return { statement: null };
  const scalars = [...statement];
  if (scalars.length <= OBLIGATION_INVENTORY_STATEMENT_MAX_SCALARS) return { statement };
  return { statement_preview: scalars.slice(0, OBLIGATION_INVENTORY_STATEMENT_MAX_SCALARS).join(''),
    statement_complete: false, statement_scalars: scalars.length };
}

function inventoryRow(row) {
  return { obligation_id: row.obligation_id, ...inventoryStatement(row.statement),
    gap_kind: row.gap?.gap_kind ?? null, proof_name: row.selection?.proof_name ?? null,
    case_count: (row.cases ?? []).length };
}

function inventoryDetailRead(resolved) {
  return { tool: 'workspace_controlled_contract_obligation_coverage_query',
    incomplete_arguments: coverageUnitArguments(resolved),
    required_argument: 'obligation_id', accepted_values: 'page.items[].obligation_id',
    returns: 'the complete saved obligation with its mechanism, gap reason, pinned selection and ' +
      'linked cases, plus the contract requirements and references associated with it',
    complete_population_read: 'Omit obligation_id and inventory to read every obligation and the ' +
      'complete requirement meaning in one response.',
    note: 'Declaration, not an executable next_call: add required_argument to incomplete_arguments.' };
}
function validationCall(resolved, fields = {}) {
  return { tool: 'workspace_validate_proof', arguments: {
    unit: unitAddress(resolved), ...(resolved.focus === null ? {} : { focus: resolved.focus }), ...fields
  } };
}

function validationContractInputsSummary(resolved, contractInputs) {
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
function validationFacts(resolved, result, grouped) {
  const rows = result.rows ?? [];
  const stageCount = (stage, status) => rows.filter(row =>
    row.selected_proof_assessment?.stages?.[stage]?.status === status).length;
  const selectedRoutes = [...new Set(rows.map(row =>
    row.selected_proof_assessment?.execution_family ?? 'unresolved'))].sort()
    .map(route => {
      const selected = rows.filter(row =>
        (row.selected_proof_assessment?.execution_family ?? 'unresolved') === route);
      const prerequisite = name => Object.fromEntries([...new Set(selected.map(row =>
        row.selected_proof_assessment?.[name]?.status ?? 'unresolved'))].sort().map(status =>
        [status, selected.filter(row =>
          (row.selected_proof_assessment?.[name]?.status ?? 'unresolved') === status).length]));
      return { route, obligation_count: selected.length,
        requirements: selected[0]?.selected_proof_assessment?.requirements ?? null,
        prerequisites: {
          authored_case: prerequisite('authored_case'),
          native_test_binding: prerequisite('native_test_binding'),
          declared_test_target: prerequisite('declared_test_target')
        },
        prevents_route_count: selected.filter(row =>
          row.selected_proof_assessment?.prevents_selected_route !== false).length };
    });
  const dispatchCall = result.status === 'valid' ? {
    tool: 'workspace_validate_dispatch',
    arguments: { unit: unitAddress(resolved) }
  } : null;
  return {
    status: result.status,
    saved_source: { status: 'source_present', obligation_count: resolved.rows.length,
      content_digest: resolved.source.content_digest },
    counts: result.counts,
    diagnostic_counts: grouped.counts,
    diagnostic_categories: grouped.categories,
    source_digest: result.source_digest,
    context_digest: result.context_digest,
    input_status: result.rows.every(row => row.input_status === 'valid') ? 'valid' : 'invalid',
    construction_status: result.rows.every(row => row.construction_status === 'complete') ? 'complete' : 'unresolved',
    construction_status_scope: 'generic_definition_metadata',
    selected_route_assessment: {
      schema_version: 'proof-authoring-selected-route-summary.v1',
      status: result.status === 'valid'
        ? 'clear' : grouped.counts.unresolved_occurrences > 0 ? 'unresolved' : 'blocked',
      prevents_route_count: rows.filter(row =>
        row.selected_proof_assessment?.prevents_selected_route !== false).length,
      routes: selectedRoutes,
      stages: {
        authored_inputs: { complete: stageCount('authored_inputs', 'complete'),
          incomplete: stageCount('authored_inputs', 'incomplete') },
        canonical_sources: { current: stageCount('canonical_sources', 'current'),
          unresolved: stageCount('canonical_sources', 'unresolved') },
        system_capability: { available: stageCount('system_capability', 'available'),
          unavailable: stageCount('system_capability', 'unavailable') },
        execution_evidence: { not_started: stageCount('execution_evidence', 'not_started'),
          credit_granted: 0 }
      },
      diagnostic_effects: {
        blocking: grouped.counts.blocking_occurrences,
        nonblocking: grouped.counts.nonblocking_occurrences,
        unresolved: grouped.counts.unresolved_occurrences
      },
      execution_assessment: {
        status: 'not_started',
        proofs_executed: 0,
        credit_granted: 0,
        reason: 'workspace_validate_proof assesses saved design prerequisites only; it does not execute proofs or decide proof success.'
      },
      dispatch_assessment: {
        status: 'not_assessed',
        owner: 'workspace_validate_dispatch',
        grants: [],
        reason: dispatchCall === null
          ? 'Proof validation does not assess dispatch. Resolve the selected-route blockers before requesting the independent workspace_validate_dispatch structural assessment.'
          : 'Proof validation does not assess or grant dispatch; workspace_validate_dispatch is the independent structural assessment and remains optional until dispatch is requested.',
        supported_next_call: dispatchCall
      }
    }
  };
}
export async function queryControlledContractObligationCoverageOperation(input) {
  return proofAuthoringOperation(async () => {
    assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit', 'obligationId', 'parameterDetail', 'inventory', 'cursor']);

    if (input.inventory === true && (input.obligationId !== undefined || input.parameterDetail === true)) {
      throw new ControlledContractToolError('obligation_coverage_request_invalid',
        'inventory lists the obligation population; obligation_id and parameter_detail read one obligation in full',
        { changed: false, phase: 'request',
          rejected_arguments: ['inventory', ...(input.obligationId === undefined ? [] : ['obligation_id']),
            ...(input.parameterDetail === true ? ['parameter_detail'] : [])],
          next_calls: [{ tool: 'workspace_controlled_contract_obligation_coverage_query',
            arguments: { ...coverageUnitArguments(obligationCoverageResolutionInput(input)), inventory: true } }] });
    }
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(obligationCoverageResolutionInput(input)));
    const continued = decodeObligationCoverageOperationCursor(input.cursor);
    const selector = own(input, 'obligationId') || own(input, 'parameterDetail') || input.inventory === true
      ? { ...(input.obligationId ? { obligation_id: input.obligationId } : {}),
        ...(input.inventory === true ? { inventory: true } : {}),
        parameter_detail: input.parameterDetail === true } : continued?.selector;

    const inventory = selector?.inventory === true;
    if (resolved.source === null && continued) throw new ControlledContractToolError(
      'obligation_coverage_cursor_stale', 'The cursor source is absent', { changed: false });
    let items = resolved.source === null ? [] : selector?.obligation_id
      ? [findObligation(resolved, selector.obligation_id)] : [...resolved.rows];
    const pkg = resolved.source === null ? null : await loadControlledContractPackage();
    const selectedCase = selector?.obligation_id && items[0].case_id
      ? resolved.cases.find(definition => definition.case_id === items[0].case_id)
      : null;
    const selectedNodeIds = selector?.obligation_id ? [...new Set([
      ...(items[0].controlled_contract_node_ids ?? []),
      ...(selectedCase === null ? [] : [pkg.authoredCaseVerificationId(selectedCase)])
    ].filter(Boolean))] : null;
    const contractInputs = projectProofAuthoringContractInputs(resolved, {
      controlledContractNodeIds: selectedNodeIds
    });

    const contractInputChannel = inventory
      ? { view: 'inventory', contract_inputs_summary: validationContractInputsSummary(resolved, contractInputs),
        obligation_detail_read: inventoryDetailRead(resolved),
        inventory_limits: { statement_scalars: OBLIGATION_INVENTORY_STATEMENT_MAX_SCALARS } }
      : { contract_inputs: contractInputs };
    if (resolved.source === null) return { unit: unitAddress(resolved), status: 'source_absent', content_digest: resolved.revision,
      source_identity: resolved.prospectiveIdentity, ...contractInputChannel,
      total: 0, returned: 0, remaining: 0, page: { items: [], continuation: null }, next_calls: [] };
    items.sort((a, b) => a.obligation_id < b.obligation_id ? -1 : a.obligation_id > b.obligation_id ? 1 : 0);
    items = items.map(row => ({ ...row, cases: projectProofAuthoringCase(pkg, resolved, row) }));
    if (selector?.parameter_detail) {
      const pkg = await loadControlledContractPackage();
      const { loadPackParameterContract, describePackParameters } = await import('@agent-chassis/controlled-contract/pack-parameters');
      items = await Promise.all(items.map(async row => ({ ...row,
        parameter_contract: describePackParameters(loadPackParameterContract(await pkg.loadPinnedProofSelection(row.selection))) })));
    }
    const identity = controlledContractContentDigest({ source: resolved.source?.content_digest ?? null,
      unit: resolved.authoringIdentity, ...(selector?.parameter_detail ? {
        parameter_contracts: items.map(row => row.parameter_contract) } : {}) });
    return pageResult({ resolved, selector, cursor: input.cursor, identity,
      items: inventory ? items.map(inventoryRow) : items,
      tool: 'workspace_controlled_contract_obligation_coverage_query', extra: { status: 'source_present',
        ...contractInputChannel,
        totals: { obligations: resolved.rows.length, explicit_gaps: resolved.rows.filter(row => row.gap).length } } });
  });
}
export async function validateProofOperation(input) {
  return proofAuthoringOperation(async () => {
    assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit',
      'obligationId', 'diagnosticGroupId', 'cursor']);
    if (input.obligationId !== undefined && input.diagnosticGroupId !== undefined) throw new ControlledContractToolError(
      'obligation_coverage_request_invalid', 'Select either one obligation or one diagnostic group', {
        changed: false, phase: 'request'
      });
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
      obligationCoverageResolutionInput(input), { requireSource: false }));
    const contractInputs = projectProofAuthoringContractInputs(resolved);
    if (resolved.source === null) {
      const diagnostics = [];
      if (contractInputs.controlled_acceptance.status === 'unset') diagnostics.push({
        category: 'author_input', code: 'controlled_acceptance_disposition_missing',
        cause: 'Controlled-acceptance applicability has not been authored',
        responsible_owner: 'work-record-proof-posture', affected_obligations: []
      });
      if (contractInputs.controlled_acceptance.status === 'invalid') diagnostics.push({
        category: 'canonical_source', code: 'controlled_acceptance_proof_posture_invalid',
        cause: contractInputs.controlled_acceptance.problem,
        responsible_owner: 'work-record-proof-posture', affected_obligations: []
      });
      if (contractInputs.controlled_acceptance.disposition === 'required' &&
          contractInputs.requirements.requirements.length === 0) diagnostics.push({
        category: 'author_input', code: 'controlled_contract_requirements_missing',
        cause: 'Controlled acceptance applies but no contract requirements are saved',
        responsible_owner: 'contract-requirement-authoring', affected_obligations: []
      });
      if (contractInputs.controlled_acceptance.disposition === 'required') diagnostics.push({
        category: 'author_input', code: 'obligation_coverage_source_not_found',
        cause: 'No proof-authoring obligations are saved',
        responsible_owner: 'proof-authoring-source', affected_obligations: []
      });
      const identity = controlledContractContentDigest({ contract_inputs: contractInputs,
        diagnostics });
      return pageResult({ resolved, selector: { contract_inputs: true },
        cursor: input.cursor, identity, items: diagnostics,
        tool: 'workspace_validate_proof', extra: {
          status: diagnostics.length === 0 ? 'valid' : 'invalid',
          counts: { total: 0, valid: 0, invalid: 0 },
          diagnostic_counts: { total: diagnostics.length },
          diagnostic_categories: Object.freeze([...new Set(diagnostics.map(row => row.category))]),
          source_digest: null, context_digest: identity,
          input_status: diagnostics.length === 0 ? 'valid' : 'invalid',
          construction_status: 'unresolved',
          contract_inputs_summary: validationContractInputsSummary(resolved, contractInputs)
        } });
    }
    const pkg = await loadControlledContractPackage();

    const requested = decodeObligationCoverageOperationCursor(input.cursor);
    const explicitSelector = input.obligationId !== undefined ? { obligation_id: input.obligationId } :
      input.diagnosticGroupId !== undefined ? { diagnostic_group_id: input.diagnosticGroupId } : undefined;
    const selector = explicitSelector ?? requested?.selector ?? { diagnostic_groups: true };
    const obligationId = selector.obligation_id;
    if (obligationId) findObligation(resolved, obligationId);
    const context = await resolveProofAuthoringContext(resolved, { obligationId });
    const { resolveProofAuthoring } = await import('@agent-chassis/controlled-contract/proof-authoring');
    const result = await resolveProofAuthoring(resolved.source.content, context);
    const grouped = pkg.groupProofAuthoringDiagnostics(result);
    if (obligationId) {
      const diagnostics = [...result.diagnostics, ...result.rows.flatMap(row => row.diagnostics.map(
        diagnostic => ({ obligation_id: row.obligation_id, ...diagnostic })))];
      return pageResult({ resolved, selector, cursor: input.cursor, identity: result.identity_digest,
        items: diagnostics, tool: 'workspace_validate_proof', extra: {
          ...validationFacts(resolved, result, grouped),
          definition_identities: result.definition_identities,
          rows: result.rows.map(({ diagnostics: ignored, ...row }) => row),
          contract_inputs_summary: validationContractInputsSummary(resolved, contractInputs)
        } });
    }
    const identity = controlledContractContentDigest({ result_identity: result.identity_digest,
      projection_version: grouped.version });
    const diagnosticProjection = projectProofAuthoringDiagnosticGroups({
      grouped,
      resultIdentity: result.identity_digest,
      wkId: resolved.wkId,
      focus: resolved.focus,
      selectedUnit: resolved.selectedUnit
    });
    const groups = diagnosticProjection.groups;
    try {
      decodeObligationCoverageOperationCursor(input.cursor, identity);
      if (selector.diagnostic_group_id) {
        const index = groups.findIndex(group => group.diagnostic_group_id === selector.diagnostic_group_id);
        if (index === -1) throw new ControlledContractToolError(
          'obligation_coverage_diagnostic_group_not_found',
          'The diagnostic group is unknown or belongs to a different resolved snapshot', {
            changed: false, diagnostic_group_id: selector.diagnostic_group_id,
            next_calls: [validationCall(resolved)]
          });
        return pageResult({ resolved, selector, cursor: input.cursor, identity,
          items: grouped.groups[index].occurrences, tool: 'workspace_validate_proof',
          extra: { ...validationFacts(resolved, result, grouped), group: groups[index],
            contract_inputs_summary: validationContractInputsSummary(resolved, contractInputs) } });
      }
      return pageResult({ resolved, selector, cursor: input.cursor, identity,
        items: groups, tool: 'workspace_validate_proof',
        extra: { ...validationFacts(resolved, result, grouped),
          contract_inputs_summary: validationContractInputsSummary(resolved, contractInputs) } });
    } catch (error) {
      if (error?.code === 'obligation_coverage_cursor_stale') error.details = {
        ...error.details, next_calls: [validationCall(resolved)]
      };
      throw error;
    }
  });
}
