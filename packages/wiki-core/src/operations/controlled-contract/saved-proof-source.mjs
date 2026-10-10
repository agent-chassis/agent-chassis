

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
import { projectCaseOwnedTestProofValidation, projectWorkRecordTestProofValidation,
  rebindWorkRecordTestProofVerificationIds } from '../../lib/work-record-test-proof-bindings.mjs';
import { computeWorkRecordSourceDigest } from '../../lib/work-record-schema.mjs';
import { assertCanonicalWorkRecordBirthLease, readCanonicalWorkRecordBirthLease } from '../work-records-store-io.mjs';
import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { canonicalEvaluationBasenames } from '../../lib/controlled-contract-source-lease-primitives.mjs';
import { controlledContractAssessmentAuthoredDependencies, scopedControlledContractDependencyObservation } from
  '../../lib/controlled-contract-tool-shared.mjs';

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
  return resolveProofSourcePopulation({ ...input, repoRoot: repository.repository, focus, selectedUnit },
    { record, unit, requireSource });
}

async function resolveProofSourcePopulation(input, { record, unit, requireSource = false }) {
  const { focus, selectedUnit } = input;
  const repository = { repository: input.repoRoot };
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
    recordSourceDigest: computeWorkRecordSourceDigest(record),
    authoringIdentity: controlledContractContentDigest(identity), sourceCurrent: true, staleReasons: [],
    prospectiveIdentity: { ...identity, source_kind: 'obligation-coverage', content_digest: source?.content_digest ?? null } });
}

const BIRTH_SOURCES = new WeakMap();
const BIRTH_PROSPECTIVE_SOURCES = new WeakMap();
function freezeCapture(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeCapture); Object.freeze(value);
  }
  return value;
}
export function birthProofAuthoringAuthority(source) {
  const authority = BIRTH_SOURCES.get(source) ?? BIRTH_PROSPECTIVE_SOURCES.get(source);
  if (!authority) return null;
  assertCanonicalWorkRecordBirthLease(authority.recordLease, { dir: source.repoRoot, id: source.wkId });
  return authority;
}

export async function assertBirthProofAuthoringSource(source, selectedUnits = source.sources.map(entry => entry.selectedUnit)) {
  const authority = birthProofAuthoringAuthority(source);
  if (!authority) throw new ControlledContractToolError('obligation_coverage_birth_source_invalid',
    'Birth requires an issuer-owned source capture', { changed: false });
  await readCanonicalWorkRecordBirthLease(authority.recordLease, { dir: source.repoRoot, id: source.wkId });
  const target = { repoRoot: source.repoRoot, wkId: source.wkId, focus: source.focus };
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet(target);
  if (canonicalSet.members.length || canonicalSet.manifest_content_digest !== null) throw new ControlledContractToolError(
    'obligation_coverage_birth_source_exists', 'Birth cannot adopt existing native sources', { changed: false });
  for (const selectedUnit of selectedUnits) {
    if (await readCanonicalObligationSource({ ...target, selectedUnit }, { optional: true }) !== null) {
      throw new ControlledContractToolError('obligation_coverage_birth_source_exists',
        'Birth cannot adopt existing obligation sources', { changed: false, selected_unit: selectedUnit });
    }
  }
  return authority;
}

export async function resolveBirthSavedProofSource({ repoRoot, wkId, recordLease, focus = null, selectedUnit = null, ...unsupported }) {
  if (focus !== null || selectedUnit !== null || Object.keys(unsupported).length) throw new ControlledContractToolError(
    'obligation_coverage_birth_source_invalid', 'Birth capture is confined to the root source', { changed: false });
  const captured = await readCanonicalWorkRecordBirthLease(recordLease, { dir: repoRoot, id: wkId });
  const input = { repoRoot: captured.target_dir, wkId, focus: null, selectedUnit: null };
  const population = await resolveProofSourcePopulation(input, { record: captured.record, unit: captured.record });
  const source = freezeCapture(await bindProofAuthoringRevision(population));
  BIRTH_SOURCES.set(source, Object.freeze({ recordLease }));
  await assertBirthProofAuthoringSource(source);
  return source;
}

export function bindBirthProofAuthoringProspectiveSource(initial, prospective) {
  const authority = birthProofAuthoringAuthority(initial);
  if (authority) {
    if (prospective.repoRoot !== initial.repoRoot || prospective.wkId !== initial.wkId ||
        prospective.focus !== null || prospective.selectedUnit !== null) throw new ControlledContractToolError(
      'obligation_coverage_birth_source_invalid', 'Prospective birth facts must bind the captured root identity', { changed: false });
    BIRTH_PROSPECTIVE_SOURCES.set(prospective, authority);
  }
  return prospective;
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

const isNativeCaseTarget = target => target !== null && typeof target === 'object' && Object.hasOwn(target, 'provider');

function caseTargetRebindingBlock(record, selectedUnit, definition, placeholder, verificationId) {
  const address = unit => unit === record ? record.id : `${record.id}#${unit.id}`;
  const declarations = id => [record, ...(record.slices ?? [])].flatMap(unit =>
    projectWorkRecordTestProofValidation({ selectedUnit: unit }).executable_declarations
      .filter(entry => entry.verification_ids.includes(id)).map(entry => ({ unit: address(unit), path: entry.target })));
  const units = entries => [...new Set(entries.map(entry => entry.unit))].sort();
  const owners = units(declarations(placeholder));
  const declared = declarations(verificationId);
  const others = declared.filter(entry => entry.unit !== selectedUnit);
  const paths = new Set([...declared.map(entry => entry.path),
    ...(definition.target?.path === undefined ? [] : [definition.target.path])]);
  const foreign = owners.some(owner => owner !== selectedUnit) ? owners
    : isNativeCaseTarget(definition.target) || (owners.length === 0 && paths.size > 1) ? units(others) : [];
  if (foreign.length > 0) return { condition: 'case_selector_cross_unit', owner_units: foreign };
  if (owners.length === 0) return null;
  try {
    rebindWorkRecordTestProofVerificationIds(structuredClone(record), new Map([[placeholder, verificationId]]));
  } catch (error) {
    if (typeof error?.code !== 'string' || error.details?.changed !== false) throw error;
    return { condition: error.code.replace(/^obligation_coverage_/u, ''),
      ...(error.details.owner_units === undefined ? {} : { owner_units: error.details.owner_units }) };
  }
  return null;
}

export function resolveUnselectedCaseAssociation(pkg, { contract, cases, uses, record, selectedUnit, definition, rows,
  verificationClaims }) {
  const eligible = [...new Set(rows.flatMap(row => pkg.eligibleCaseVerificationIds(contract, row)))].sort();
  const placeholder = pkg.authoredCaseVerificationId(definition);
  const ownUses = uses.filter(use => use.row.case_id === definition.case_id);
  const blocked = [];
  for (const verificationId of eligible) {
    const owner = cases.find(other => other.case_id !== definition.case_id && other.verification_id === verificationId);
    const excluding = ownUses.filter(use => pkg.caseUseExcludesVerification(use.row, verificationId, verificationClaims));
    const block = owner !== undefined
      ? { condition: 'verification_owned_by_another_case', saved_case_ids: [owner.case_id] }
      : excluding.length > 0 ? { condition: 'shared_case_verification_conflict',
        uses: excluding.map(use => ({ unit: use.unit, obligation_id: use.row.obligation_id }))
          .sort((left, right) => left.unit.localeCompare(right.unit) || left.obligation_id.localeCompare(right.obligation_id)) }
        : caseTargetRebindingBlock(record, selectedUnit, definition, placeholder, verificationId);
    if (block !== null) blocked.push({ verification_id: verificationId, ...block });
  }
  const unselectable = new Set(blocked.map(entry => entry.verification_id));
  return { eligible, candidates: eligible.filter(id => !unselectable.has(id)), blocked };
}

function unselectedCaseAssociations(pkg, resolved, derived) {
  const cases = resolved.cases ?? [];
  const unselected = new Map(cases.filter(definition => definition.verification_id === undefined)
    .map(definition => [definition.case_id, definition]));
  if (unselected.size === 0) return {};
  const caseOwned = new Set(cases.map(pkg.authoredCaseVerificationId));
  const contract = { ...derived, test_proofs: derived.test_proofs.filter(proof => !caseOwned.has(proof.verification_claim_id)) };
  const address = selected => selected === null ? resolved.wkId : `${resolved.wkId}#${selected}`;
  const uses = (resolved.sources ?? []).flatMap(entry => (entry.source?.content.obligations ?? [])
    .map(row => ({ unit: address(entry.selectedUnit), row })));
  const verificationClaims = new Set(derived.claims.filter(claim => claim.kind === 'verification').map(claim => claim.claim_id));
  return Object.fromEntries((resolved.source.content.obligations ?? []).filter(row => unselected.has(row.case_id))
    .map(row => [row.obligation_id, { case_id: row.case_id, ...resolveUnselectedCaseAssociation(pkg, { contract, cases, uses,
      record: resolved.record, selectedUnit: address(resolved.selectedUnit), definition: unselected.get(row.case_id),
      rows: [row], verificationClaims }) }]));
}

export async function resolveSavedProofContext(resolved, { obligationId, assessmentIntent } = {}) {
  const context = { source_digest: resolved.source.content_digest, ...(assessmentIntent ? { assessment_intent: assessmentIntent } : {}), ...(obligationId === undefined ? {} : { obligation_id: obligationId }) };
  const pkg = await loadControlledContractSharedContract();
  const contract = await resolveDerivedProofContract(resolved);
  if (!contract) return context;
  assertPackageValidContract(pkg.validateNativeTestProofAuthoringContract(contract.content));
  context.case_definitions = (resolved.cases ?? []).map(definition => ({ case_id: definition.case_id,
    case_revision: projectSavedProofCase(pkg, { ...resolved, contract }, { case_id: definition.case_id })[0].case_revision, verification_id: pkg.authoredCaseVerificationId(definition) }));

  const associations = assessmentIntent === 'known_parameters' ? {}
    : unselectedCaseAssociations(pkg, resolved, contract.content);
  if (Object.keys(associations).length > 0) context.case_associations = associations;
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

      for (const wkId of controlledContractAssessmentAuthoredDependencies(resolved.record).contract_record_ids) {
        const observation = scopedControlledContractDependencyObservation({ repoRoot: resolved.repoRoot,
          wkId: resolved.wkId, dependencyWkId: wkId });
        const relatedSet = await resolveCanonicalControlledContractCarrierSet({ repoRoot: resolved.repoRoot, wkId,
          focus: null, ...(observation === null ? {} : { observation }) });
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
