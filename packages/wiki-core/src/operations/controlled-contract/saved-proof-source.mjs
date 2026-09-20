

import {
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA,
  ControlledContractToolError,
  assertControlledContractOperationInput,
  controlledContractContentDigest,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet
} from '../../lib/controlled-contract-tools.mjs';
import {
  assertObligationCoverageSourcePathIntegrity,
  normalizeAcceptanceCoverageSelectedUnit,
  readCanonicalObligationSource,
  readCanonicalWorkRecord
} from './acceptance-coverage-facts.mjs';
import { projectCaseOwnedTestProofValidation, projectWorkRecordTestProofValidation } from
  '../../lib/work-record-test-proof-bindings.mjs';
import { canonicalEvaluationBasenames } from '../../lib/controlled-contract-source-lease-primitives.mjs';

import { assertPackageValidContract, loadControlledContractSharedContract } from './package-runtime.mjs';

const PROOF_SOURCE_UNIT_ADDRESS = new RegExp(
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA.properties.unit.pattern, 'u');

export function parseProofSourceUnitAddress(unit) {
  if (typeof unit !== 'string' || !PROOF_SOURCE_UNIT_ADDRESS.test(unit)) throw new ControlledContractToolError(
    'obligation_coverage_unit_invalid', 'Expected a canonical WK or WK#SLICE unit address',
    { changed: false, limb: 'mechanical_failure' });
  const [wkId, selectedUnit = null] = unit.split('#');
  return { wkId, selectedUnit };
}

export async function resolveSavedProofSource(input, { requireSource = false } = {}) {
  assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit']);
  if (typeof input.wkId !== 'string' || !/^WK-[0-9]{4,}$/u.test(input.wkId)) throw new ControlledContractToolError(
    'obligation_coverage_unit_invalid', 'Expected a canonical WK identity', { changed: false, limb: 'mechanical_failure' });
  const focus = input.focus ?? null, selectedUnit = normalizeAcceptanceCoverageSelectedUnit(input.selectedUnit);
  const { repository } = await assertObligationCoverageSourcePathIntegrity(input, { requireSource });
  const { record, unit } = await readCanonicalWorkRecord(repository.repository, input.wkId, selectedUnit);
  const source = await readCanonicalObligationSource({ ...input, repoRoot: repository.repository }, { optional: !requireSource });
  const sources = await Promise.all([null, ...record.slices.map(slice => slice.id)].map(async selected => ({
    selectedUnit: selected, source: selected === selectedUnit ? source : await readCanonicalObligationSource({
      ...input, repoRoot: repository.repository, selectedUnit: selected }, { optional: true }) })));
  const caseSource = sources.find(entry => entry.selectedUnit === null).source;
  const cases = caseSource?.content.cases ?? [];
  const ids = new Set();
  for (const definition of cases) {
    if (ids.has(definition.case_id)) throw new ControlledContractToolError('obligation_coverage_case_duplicate', 'Case identities must be unique');
    ids.add(definition.case_id);
  }
  for (const entry of sources) {
    if (entry.selectedUnit !== null && entry.source?.content.cases?.length) throw new ControlledContractToolError(
      'obligation_coverage_case_owner_invalid', 'Case definitions belong to the parent proof-authoring source');
    for (const row of entry.source?.content.obligations ?? []) if (row.case_id && !ids.has(row.case_id)) throw new ControlledContractToolError(
      'obligation_coverage_case_unknown', 'A saved use references an absent case', { case_id: row.case_id });
  }
  const identity = { wk_id: record.id, selected_unit: selectedUnit, focus };
  return Object.freeze({ repoRoot: repository.repository, wkId: record.id, focus, selectedUnit,
    record, unit, source, sources, caseSource, cases, rows: source?.content.obligations ?? [],
    recordSourceDigest: controlledContractContentDigest(record),
    authoringIdentity: controlledContractContentDigest(identity), sourceCurrent: true, staleReasons: [],
    prospectiveIdentity: { ...identity, source_kind: 'obligation-coverage', content_digest: source?.content_digest ?? null } });
}

export async function resolveDerivedProofContract(resolved) {
  const pkg = await loadControlledContractSharedContract();
  let canonical = resolved.canonicalContract ?? resolved.contract;
  if (canonical === undefined) {
    try { canonical = await readControlledContractCarrierFile({ repoRoot: resolved.repoRoot,
      wkId: resolved.wkId, focus: resolved.focus, carrierKind: 'contract' }); }
    catch (error) { if (error.code !== 'controlled_contract_carrier_not_found') throw error; canonical = null; }
  }
  if (!canonical && !(resolved.cases?.length)) return null;
  const content = pkg.deriveAuthoredTestCases({ contract: canonical?.content ?? null,
    cases: resolved.cases ?? [], buildTemplate: pkg.buildStableTestProofBindingTemplate });
  return { content, content_digest: controlledContractContentDigest(content) };
}

export function projectSavedProofCase(pkg, resolved, row) {
  const record = resolved.record;
  const targets = [record, ...record.slices].flatMap(unit => projectWorkRecordTestProofValidation({ selectedUnit: unit })
    .executable_declarations.flatMap(entry => entry.verification_ids.map(verification_id => ({
      unit: unit === record ? record.id : `${record.id}#${unit.id}`, verification_id, path: entry.target }))));
  return pkg.projectAuthoredTestCase(resolved.cases ?? [], row, {
    references: resolved.contract?.content.references ?? [], targets });
}

export async function resolveSavedProofContext(resolved, { obligationId, assessmentIntent } = {}) {
  const context = { source_digest: resolved.source.content_digest, ...(assessmentIntent ? { assessment_intent: assessmentIntent } : {}), ...(obligationId === undefined ? {} : { obligation_id: obligationId }) };
  const pkg = await loadControlledContractSharedContract();
  const contract = await resolveDerivedProofContract(resolved);
  if (!contract) return context;
  assertPackageValidContract(pkg.validateNativeTestProofAuthoringContract(contract.content));
  context.case_definitions = (resolved.cases ?? []).map(definition => ({ case_id: definition.case_id,
    case_revision: projectSavedProofCase(pkg, { ...resolved, contract }, { case_id: definition.case_id })[0].case_revision, verification_id: pkg.authoredCaseVerificationId(definition) }));
  context.contract_digest = contract.content_digest;

  context.contract_nodes = [...contract.content.claims.map(row => row.claim_id),
    ...contract.content.references.map(row => row.reference_id)];

  context.contract_claims = contract.content.claims.map(({ claim_id, kind,
    verification_method, proposition_id, falsifying_proposition_id }) => ({
    claim_id, kind,
    ...(verification_method === undefined ? {} : { verification_method }),
    ...(proposition_id === undefined ? {} : { proposition_id }),
    ...(falsifying_proposition_id === undefined ? {} : { falsifying_proposition_id })
  }));
  context.contract_proposition_ids = contract.content.propositions.map(
    row => row.proposition_id);

  const isNativeCase = definition => definition.target !== null && typeof definition.target === 'object' &&
    Object.hasOwn(definition.target, 'provider');
  const usedCaseIds = new Set((resolved.source.content.obligations ?? []).map(row => row.case_id).filter(Boolean));
  context.test_target_declarations = projectCaseOwnedTestProofValidation({
    workRecord: resolved.record, selectedUnit: resolved.unit,
    caseTargets: (resolved.cases ?? []).filter(definition => usedCaseIds.has(definition.case_id) &&
      !isNativeCase(definition)).map(definition => ({
      verification_id: pkg.authoredCaseVerificationId(definition),
      owner_unit: definition.target?.owner_unit ?? null })) });

  const nativeCaseTargets = (resolved.cases ?? []).filter(isNativeCase).map(definition => ({
    case_id: definition.case_id,
    verification_id: pkg.authoredCaseVerificationId(definition),
    provider: structuredClone(definition.target.provider),
    path: definition.target.path,
    node_id: definition.target.selector?.node_id ?? null,
    owner_unit: definition.target.owner_unit ?? null
  }));
  if (nativeCaseTargets.length > 0) context.native_case_targets = nativeCaseTargets;
  context.contract_relations = structuredClone(contract.content.relations);
  context.test_declarations = structuredClone(contract.content.test_proofs ?? []);
  context.contract_references = structuredClone(contract.content.references);
  if (assessmentIntent !== 'known_parameters' && resolved.source.content.obligations.some(row => row.selection?.proof_version != null)) {

    const capability = '@agent-chassis/controlled-contract#buildProofAuthoringSkeleton';
    try {
      const canonicalSet = resolved.canonicalSet ?? await resolveCanonicalControlledContractCarrierSet({
        repoRoot: resolved.repoRoot, wkId: resolved.wkId, focus: resolved.focus });
      const request = await readControlledContractCarrierFile({ repoRoot: resolved.repoRoot,
        wkId: resolved.wkId, focus: resolved.focus, carrierKind: 'proof_plan_request', canonicalSet });
      const evaluationInputs = {};
      for (const basename of canonicalEvaluationBasenames({ wkId: resolved.wkId, focus: resolved.focus, request: request.content })) {
        const member = canonicalSet.members_by_basename[basename];
        if (member === undefined) throw new ControlledContractToolError('obligation_coverage_construction_sources_missing',
          'A declared canonical evaluation input is absent', { basename });
        evaluationInputs[basename] = member.content;
      }
      const mappingContracts = [];
      for (const wkId of [...new Set((resolved.record.related ?? []).filter(id => /^WK-[0-9]{4}$/u.test(id)))].sort()) {
        const relatedSet = await resolveCanonicalControlledContractCarrierSet({ repoRoot: resolved.repoRoot, wkId, focus: null });
        for (const member of relatedSet.members) if (member.carrier_kind === 'contract') mappingContracts.push(member.content);
      }
      context.construction_inputs = { [capability]: structuredClone({ canonicalRecord: resolved.record,
        contract: contract.content, mappingContracts, slices: resolved.record.slices,
        proofPlanRequest: request.content, evaluationInputs, focus: resolved.focus }) };
    } catch (error) {
      if (!error.code?.startsWith('controlled_contract_source_lease_') &&
          error.code !== 'controlled_contract_carrier_not_found' &&
          error.code !== 'obligation_coverage_construction_sources_missing') throw error;
      context.construction_source_diagnostics = { [capability]: {
        code: error.code, reason: error.message, details: error.details } };
    }
  }
  return context;
}
