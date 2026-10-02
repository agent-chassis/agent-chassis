import { CASE_COMPONENT_FIELD, CASE_COMPONENT_FIELD_PATH, CASE_VERIFICATION_ASSOCIATION_FIELD,
  CASE_VERIFICATION_ASSOCIATION_FIELD_PATH, CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS,
  ControlledContractToolError, controlledContractContentDigest } from '../../lib/controlled-contract-tools.mjs';
import { assertPackageValidContract } from './package-runtime.mjs';
import { projectWorkRecordTestProofValidation, amendWorkRecordTestProofTarget, removeWorkRecordTestProofTarget,
  rebindWorkRecordTestProofVerificationIds } from '../../lib/work-record-test-proof-bindings.mjs';
import { projectSavedProofCase } from './saved-proof-source.mjs';
import { proofAuthoringRebindingIntents, remapProofAuthoringObligationLinks } from './proof-authoring-requirement-rebinding.mjs';
import { reconcileProofAuthoringRequirementRetirement } from './proof-authoring-requirement-retirement.mjs';

const fail = (code, message, details = {}) => { throw new ControlledContractToolError(
  `obligation_coverage_${code}`, message, { changed: false, limb: 'mechanical_failure', ...details }); };
const same = (a, b) => controlledContractContentDigest(a) === controlledContractContentDigest(b);

const isNativeTarget = target => target !== null && typeof target === 'object' && Object.hasOwn(target, 'provider');
const nativeTargetMeaning = ({ provider, path, selector }) => ({ provider, path, selector });
const blankSource = (pkg, initial, selectedUnit) => ({ schema_version: pkg.OBLIGATION_DRAFT_SCHEMA_VERSION,
  wk_id: initial.wkId, selected_unit: selectedUnit, focus: initial.focus, obligations: [] });
const rebindingGuidance = () => [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.requirement_rebinding];
const retirementGuidance = () => [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.requirement_retirement];
const verificationGuidance = () => [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.mandatory_verification];
const caseAssociationGuidance = () => [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.case_verification_association];
const additionalVerificationGuidance = () =>
  [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.case_additional_verification];
const componentGuidance = () => [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.case_component];

const CASE_ASSOCIATION_CODES = new Set([
  'obligation_coverage_case_selector_invalid',
  'obligation_coverage_case_selector_ambiguous'
]);
const caseAssociationRouting = initial => ({
  field: CASE_VERIFICATION_ASSOCIATION_FIELD,
  field_path: CASE_VERIFICATION_ASSOCIATION_FIELD_PATH,
  guidance_path: caseAssociationGuidance(),
  next_calls: [queryCall(initial)]
});

const UNLINKED_VERIFICATION_FIELD = 'requirements[].verification';
const UNLINKED_VERIFICATION_CODES = new Set(['obligation_coverage_case_verification_unlinked']);
const RETIREMENT_CONFLICT_LIMIT = 32;
const unitArguments = initial => ({
  unit: initial.selectedUnit === null ? initial.wkId : `${initial.wkId}#${initial.selectedUnit}`,
  ...(initial.focus ? { focus: initial.focus } : {}) });
const queryCall = initial => ({ tool: 'workspace_controlled_contract_obligation_coverage_query',
  arguments: unitArguments(initial) });

function verificationConflictRecovery(initial, { verificationId, caseIds, initialVerifications, content,
  changes }) {
  const savedCaseIds = caseIds.filter(caseId => initialVerifications.get(caseId) === verificationId);
  const requestedCaseIds = caseIds.filter(caseId => !savedCaseIds.includes(caseId));
  return { condition: 'verification_owned_by_another_case', field: CASE_VERIFICATION_ASSOCIATION_FIELD,
    field_path: CASE_VERIFICATION_ASSOCIATION_FIELD_PATH, saved_case_ids: savedCaseIds,
    requested_case_ids: requestedCaseIds,
    obligation_ids: changes.map(item => content.obligations.find(row => row.obligation_id === item.obligation_id))
      .filter(row => requestedCaseIds.includes(row?.case_id)).map(row => row.obligation_id).sort(),
    requirement_claim_ids: (initial.contract?.content.relations ?? []).filter(relation =>
      relation.role === 'verifies' && relation.source_claim_id === verificationId)
      .map(relation => relation.target_claim_id).sort(),
    guidance_path: additionalVerificationGuidance(),
    next_calls: requestedCaseIds.length === 0 ? [] : [{ tool: 'workspace_controlled_contract_obligation_coverage_upsert',
      fixed_arguments: { ...unitArguments(initial),
        ...(typeof initial.revision === 'string' ? { expected_content_digest: initial.revision } : {}) },
      required_authored_fields: ['contract_requirements.requirements'] }] };
}

function assertCaseComponentIdentities(pkg, contract, preparedChanges) {
  const conflicts = new Map();
  for (const { item, definition, caseInput } of preparedChanges) {
    if (caseInput.component?.identity === undefined) continue;
    const binding = contract.test_proofs.find(proof =>
      proof.verification_claim_id === pkg.authoredCaseVerificationId(definition));
    const referenceId = binding?.system_under_test_boundary?.subject_reference_ids?.[0];
    const requested = contract.references.find(reference => reference.reference_id === referenceId);
    const existing = requested === undefined ? [] : contract.references.filter(reference =>
      reference.reference_id !== referenceId && same(reference.identity, requested.identity));
    if (existing.length === 0) continue;
    const conflict = conflicts.get(definition.case_id) ?? { case_id: definition.case_id, obligation_ids: [],
      requested: structuredClone(requested), existing: structuredClone(existing) };
    conflict.obligation_ids = [...new Set([...conflict.obligation_ids, item.obligation_id])].sort();
    conflicts.set(definition.case_id, conflict);
  }
  if (conflicts.size === 0) return;
  try {
    assertPackageValidContract(pkg.validateNativeTestProofAuthoringContract(contract));
  } catch (error) {
    error.details = { ...error.details, field: CASE_COMPONENT_FIELD, field_path: CASE_COMPONENT_FIELD_PATH,
      guidance_path: componentGuidance(),
      component_reference_conflicts: [...conflicts.values()].sort((a, b) => a.case_id.localeCompare(b.case_id)) };
    throw error;
  }
}
function leaves(value, prefix = '') {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? leaves(child, `${prefix}/${key}`) : [[`${prefix}/${key}`, child]]);
}
function merge(target, changes, parentKey = null) {
  let deleted = false;
  for (const [key, value] of Object.entries(changes).sort(([left], [right]) => left.localeCompare(right))) {

    if (value === null && parentKey === 'falsification' && key === 'replacement') target[key] = null;
    else if (value === null) {
      delete target[key];
      deleted = true;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {

      if (key === 'identity' || key === 'component') target[key] = structuredClone(value);

      else if (key === 'target' && (isNativeTarget(value) || isNativeTarget(target[key]))) {
        target[key] = structuredClone(value);
      } else {
        const child = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
          ? target[key] : {};
        const childDeleted = merge(child, value, key);
        if (childDeleted && Object.keys(child).length === 0) delete target[key];
        else target[key] = child;
        deleted ||= childDeleted;
      }
    } else target[key] = structuredClone(value);
  }
  return deleted;
}
const ancestor = (parent, child) => child.startsWith(`${parent}/`);
function assertCompatibleCaseIntents(caseId, intents) {
  const ordered = [...intents].sort((left, right) => left.path.localeCompare(right.path) ||
    left.obligation_id.localeCompare(right.obligation_id));
  for (let index = 0; index < ordered.length; index++) {
    const left = ordered[index];
    for (const right of ordered.slice(index + 1)) {
      if (left.path === right.path) {
        if (!same(left.value, right.value)) fail('case_shared_identity_conflict',
          'Two amendments change the same case field differently', {
            case_id: caseId,
            obligation_ids: [left.obligation_id, right.obligation_id].sort(),
            path: left.path,
            values: [left, right].sort((a, b) => a.obligation_id.localeCompare(b.obligation_id))
              .map(intent => ({ obligation_id: intent.obligation_id, value: intent.value }))
          });
        continue;
      }
      const parent = ancestor(left.path, right.path) ? left :
        ancestor(right.path, left.path) ? right : null;
      const child = parent === left ? right : left;
      if (parent?.value === null && child.value !== null) fail(
        'case_shared_identity_conflict',
        'One amendment clears a case object while another sets its descendant', {
          case_id: caseId,
          obligation_ids: [parent.obligation_id, child.obligation_id].sort(),
          path: parent.path,
          descendant_path: child.path
        });
    }
  }
}

function assertRebindingSelection(pkg, initial, rebinding, definitions, authored) {
  const listed = rebinding.selections.flatMap(selection =>
    (selection.case_ids ?? []).map(caseId => ({ selection, caseId })));
  const unknown = listed.filter(({ caseId }) => !definitions.has(caseId));
  if (unknown.length > 0) fail('case_unknown', 'rebind_case_ids names cases this work record does not define', {
    requested_case_ids: [...new Set(unknown.map(({ caseId }) => caseId))].sort(),
    field: unknown[0].selection.field, guidance_path: rebindingGuidance(), next_calls: [queryCall(initial)] });
  const claims = new Map((initial.contract?.content.claims ?? []).map(claim => [claim.claim_id, claim]));
  const priorClaims = new Map((initial.previousContract?.claims ?? []).map(claim => [claim.claim_id, claim]));
  for (const { selection, caseId } of listed) {
    const verificationId = pkg.authoredCaseVerificationId(definitions.get(caseId));
    const identity = { requirement_index: selection.requirement_index,
      replace_claim_id: selection.prior_claim_id, field: selection.field, guidance_path: rebindingGuidance() };
    if (!selection.prior_verification_ids.includes(verificationId)) fail('case_selector_invalid',
      'A rebound case is not bound to a verification of the replaced requirement', { ...identity,
        condition: 'unrelated_rebinding_case', case_id: caseId, verification_id: verificationId,
        prior_verification_ids: [...selection.prior_verification_ids] });
    if (!selection.retired_verification_ids.includes(verificationId)) continue;
    const replacement = selection.verification_claim_id === null ? undefined : claims.get(selection.verification_claim_id);
    const retiredMethod = priorClaims.get(verificationId)?.verification_method ?? null;
    if (replacement?.verification_method !== 'test_execution' || retiredMethod !== 'test_execution') fail(
      'case_rebinding_verification_incompatible',
      'The replacement requirement compiles no test_execution verification for a retained case', { ...identity,
        case_id: caseId, retired_verification_id: verificationId, retired_verification_method: retiredMethod,
        replacement_verification_id: selection.verification_claim_id,
        replacement_verification_method: replacement?.verification_method ?? null });
  }
  const used = new Set([...definitions.values()].map(pkg.authoredCaseVerificationId));

  const linked = new Set([...[initial.sources.map(entry => entry.source?.content), authored].flat()
    .flatMap(source => source?.obligations ?? []).flatMap(row => row.controlled_contract_node_ids ?? []),
  ...[initial.record, ...(initial.record?.slices ?? [])].filter(Boolean).flatMap(unit =>
    projectWorkRecordTestProofValidation({ selectedUnit: unit }).executable_declarations
      .flatMap(entry => entry.verification_ids))]);
  for (const [verificationId, replacements] of rebinding.ambiguousLinks) {
    if (!used.has(verificationId) && !linked.has(verificationId)) continue;
    const owners = rebinding.selections.filter(selection => selection.retired_verification_ids.includes(verificationId));
    fail('case_shared_identity_conflict', 'Two requirement replacements map one retired verification to different identities', {
      path: '/verification_id', verification_id: verificationId, replacement_verification_ids: replacements,
      requirement_indexes: owners.map(selection => selection.requirement_index),
      field: owners[0].field, guidance_path: rebindingGuidance() });
  }
}

function assertNoStrandedCases(pkg, initial, rebinding, cases, initialVerifications) {
  for (const selection of rebinding.selections) {
    const retired = new Set(selection.retired_verification_ids);
    if (retired.size === 0) continue;
    const missing = cases.filter(definition => retired.has(pkg.authoredCaseVerificationId(definition)))
      .map(definition => definition.case_id).sort();
    if (missing.length === 0) continue;
    const identity = { requirement_index: selection.requirement_index, replace_claim_id: selection.prior_claim_id,
      retired_verification_ids: [...retired].sort(), field: selection.field, guidance_path: rebindingGuidance(),
      next_calls: [queryCall(initial)] };
    if (selection.case_ids === null) fail('case_selector_invalid',
      'A prospective requirement replacement removes a verification fact still used by a case; list the retained cases in rebind_case_ids', {
        ...identity, condition: 'stranded_case', case_ids: missing });
    const affected = [...initialVerifications].filter(([, verificationId]) => retired.has(verificationId))
      .map(([caseId]) => caseId).sort();
    fail('case_rebinding_incomplete', 'rebind_case_ids omits existing cases whose verification the replacement retires', {
      ...identity, missing_case_ids: missing, affected_case_ids: affected, affected_case_count: affected.length });
  }
}

function assertReplacementRuntimeMeaning(pkg, initial, rebinding, cases, derived) {
  const content = initial.contract?.content;
  const bindings = new Map((content?.test_proofs ?? []).map(proof => [proof.verification_claim_id, proof]));
  const derivedBoundaries = new Map((derived?.test_proofs ?? []).map(proof =>
    [proof.verification_claim_id, proof.system_under_test_boundary]));
  for (const selection of rebinding.selections) {
    const authored = selection.authored_runtime_test;
    if (authored === null || selection.verification_claim_id === null) continue;
    const binding = bindings.get(selection.verification_claim_id);
    const runtimeField = `requirements[${selection.requirement_index}].verification.runtime_test`;
    for (const definition of cases.filter(entry => pkg.authoredCaseVerificationId(entry) === selection.verification_claim_id)) {
      const component = definition.component?.reference_id ?? (content?.references ?? []).find(reference =>
        definition.component?.identity && reference.type_term === definition.component.type_term &&
        same(reference.identity, definition.component.identity))?.reference_id;
      const selector = isNativeTarget(definition.target) ? undefined : definition.target?.selector;
      const boundary = derivedBoundaries.get(selection.verification_claim_id);
      const subjects = authored.boundary?.subjects === undefined
        ? undefined : binding?.system_under_test_boundary?.subject_reference_ids;
      const comparisons = [
        ['/component', `${runtimeField}.boundary.subjects`, component,
          subjects, component !== undefined && Array.isArray(subjects) && !subjects.includes(component)],
        ['/observation/kind', `${runtimeField}.observable.kind`, definition.observation?.kind, authored.observable?.kind],
        ['/target/selector/name', `${runtimeField}.selector.name`, selector?.name, authored.selector?.name],
        ['/target/selector/nesting', `${runtimeField}.selector.nesting`, selector?.nesting, authored.selector?.nesting],
        ['/falsification/strategy', `${runtimeField}.falsifier.strategy`, definition.falsification?.strategy,
          authored.falsifier?.strategy],
        ...['module_path', 'entry_export', 'operation'].map(key => [`/falsification/${key}`,
          `${runtimeField}.falsifier.${key}`, definition.falsification?.[key], authored.falsifier?.[key]]),
        ['/system_under_test_boundary/kind', `${runtimeField}.boundary.kind`, boundary?.kind, authored.boundary?.kind],
        ['/system_under_test_boundary/runtime_module_path', `${runtimeField}.boundary.module_path`,
          boundary?.runtime_module_path, authored.boundary?.module_path]
      ];
      for (const [casePath, requirementPath, caseValue, requirementValue, conflict = caseValue !== undefined &&
        requirementValue !== undefined && !same(caseValue, requirementValue)] of comparisons) {
        if (conflict) fail('case_shared_identity_conflict',
          'The replacement requirement runtime test contradicts a retained case', {
            condition: 'replacement_runtime_meaning_conflict', case_id: definition.case_id,
            verification_id: selection.verification_claim_id, path: casePath, requirement_index: selection.requirement_index,
            values: [{ source: `case:${definition.case_id}${casePath}`, value: caseValue },
              { source: requirementPath, value: requirementValue }],
            field: selection.field, guidance_path: rebindingGuidance() });
      }
    }
  }
}

export { projectSavedProofCase as projectProofAuthoringCase } from './saved-proof-source.mjs';
export function compileProofAuthoringCases({ pkg, initial, content: authored, obligations, rebinding = null,
  retirement = null }) {
  const changes = obligations.filter(item => item.case !== undefined);
  const maximum = pkg.STABLE_TEST_PROOF_AUTHORING_LIMITS.replacement_operations;
  const rebindOperationCount = rebinding?.rebindOperationCount ?? 0;

  const retirementOperationCount = retirement === null ? 0 : (initial.cases ?? []).filter(value =>
    retirement.retiredVerificationIds.has(pkg.authoredCaseVerificationId(value))).length;
  if (changes.length + rebindOperationCount + retirementOperationCount > maximum) fail(
    'case_population_too_large', 'Case authoring retains the incumbent operation bound', {
      maximum, explicit_operation_count: changes.length, rebind_operation_count: rebindOperationCount,
      ...(retirement === null ? {} : { retirement_operation_count: retirementOperationCount }),
      requested: changes.length + rebindOperationCount + retirementOperationCount });
  const cases = structuredClone(initial.cases ?? []);
  const definitions = new Map(cases.map(value => [value.case_id, value]));
  const initialVerifications = new Map(cases.map(value => [value.case_id, pkg.authoredCaseVerificationId(value)]));
  if (rebinding !== null) assertRebindingSelection(pkg, initial, rebinding, definitions, authored);
  const remap = value => rebinding === null ? value : remapProofAuthoringObligationLinks(value, rebinding);
  let content = remap(authored);
  let rootContent = initial.selectedUnit === null ? content : structuredClone(
    remap(initial.caseSource?.content ?? blankSource(pkg, initial, null)));
  const intents = new Map();

  const linkedVerificationClaimIds = new Set((initial.contract?.content.claims ?? [])
    .filter(claim => claim.kind === 'verification' && claim.verification_method === 'test_execution')
    .map(claim => claim.claim_id));

  const preparedChanges = [];
  for (const item of [...changes].sort((left, right) =>
    left.obligation_id.localeCompare(right.obligation_id))) {
    const row = content.obligations.find(row => row.obligation_id === item.obligation_id);
    const caseId = item.case.case_id ?? row.case_id ?? `case-${controlledContractContentDigest({
      wk: initial.wkId, focus: initial.focus, unit: initial.selectedUnit, obligation: item.obligation_id }).slice(7,47)}`;
    row.case_id = caseId;
    if (!definitions.has(caseId) && (Object.keys(item.case).some(key => key !== 'case_id') || !item.case.case_id)) {
      const linked = pkg.linkedNativeTestProofs(initial.contract?.content ?? pkg.emptyCaseContract(), { ...row, case_id: undefined });
      const ids = [...new Set([...linked.map(p => p.verification_claim_id),
        ...(row.controlled_contract_node_ids ?? []).filter(id => linkedVerificationClaimIds.has(id))])];
      const association = condition => ({ condition, ...caseAssociationRouting(initial),
        obligation_id: item.obligation_id, case_id: caseId,
        verification_id: item.case.verification_id ?? null,
        eligible_verification_ids: [...ids].sort(),
        controlled_contract_node_ids: [...(row.controlled_contract_node_ids ?? [])].sort() });
      if (ids.length > 1 && !item.case.verification_id) fail('case_selector_ambiguous',
        'Select a canonical verification fact', association('ambiguous_linked_verification'));
      if (item.case.verification_id && !ids.includes(item.case.verification_id)) fail(
        'case_selector_invalid', 'The verification selector is not an associated canonical fact',
        association('unlinked_verification_selected'));
      const verification = item.case.verification_id ?? ids[0];
      const definition = { case_id: caseId, ...(verification ? { verification_id: verification } : {}) };
      definitions.set(caseId, definition); cases.push(definition);
    }
  }
  for (const item of changes) {
    const row = content.obligations.find(row => row.obligation_id === item.obligation_id);
    const definition = definitions.get(row.case_id);
    if (!definition) fail('case_unknown', 'Reference an existing case or supply new case fields', { case_id: row.case_id });
    if (item.case.verification_id && item.case.verification_id !== definition.verification_id &&
        !row.controlled_contract_node_ids?.includes(item.case.verification_id)) fail(
      'case_selector_invalid', 'The canonical verification fact is not associated with this obligation', {
        condition: 'unlinked_verification_selected', ...caseAssociationRouting(initial),
        obligation_id: item.obligation_id, case_id: row.case_id,
        verification_id: item.case.verification_id,

        eligible_verification_ids: [...new Set([...(definition.verification_id ? [definition.verification_id] : []),
          ...(row.controlled_contract_node_ids ?? []).filter(id => linkedVerificationClaimIds.has(id))])].sort(),
        controlled_contract_node_ids: [...(row.controlled_contract_node_ids ?? [])].sort() });
    const caseInput = structuredClone(item.case);
    if (caseInput.component?.identity) {
      const reference = (initial.contract?.content.references ?? []).find(ref =>
        ref.type_term === caseInput.component.type_term && same(ref.identity, caseInput.component.identity));
      if (reference) caseInput.component = { reference_id: reference.reference_id };
    }
    const caseIntents = intents.get(row.case_id) ?? [];
    for (const [path, value] of [...leaves(Object.fromEntries(Object.entries(caseInput).filter(([key]) => key !== 'component'))),
      ...(caseInput.component ? [['/component', caseInput.component]] : [])]) {
      if (path === '/case_id') continue;
      caseIntents.push({ path, value, obligation_id: item.obligation_id });
    }
    intents.set(row.case_id, caseIntents);
    preparedChanges.push({ item, definition, caseInput });
  }
  const rebindingIntents = rebinding === null ? []
    : proofAuthoringRebindingIntents(rebinding, caseId => initialVerifications.get(caseId));
  for (const { case_id: caseId, ...intent } of rebindingIntents) {
    intents.set(caseId, [...(intents.get(caseId) ?? []), intent]);
  }
  for (const [caseId, caseIntents] of [...intents].sort(([left], [right]) => left.localeCompare(right))) {
    assertCompatibleCaseIntents(caseId, caseIntents);
  }

  for (const { definition, caseInput } of preparedChanges) merge(definition, caseInput);
  for (const intent of rebindingIntents) definitions.get(intent.case_id).verification_id = intent.value;
  if (rebinding !== null) assertNoStrandedCases(pkg, initial, rebinding, cases, initialVerifications);

  const unitAddress = selected => selected === null ? initial.wkId : `${initial.wkId}#${selected}`;
  const retired = retirement === null ? null : reconcileProofAuthoringRequirementRetirement(retirement, {
    sources: initial.sources.map(entry => ({ selectedUnit: entry.selectedUnit, unit: unitAddress(entry.selectedUnit),
      content: entry.selectedUnit === initial.selectedUnit ? content
        : entry.selectedUnit === null ? rootContent : remap(entry.source?.content),
      amended: new Set(entry.selectedUnit === initial.selectedUnit ? obligations.map(item => item.obligation_id) : []) })),
    caseIds: cases.map(definition => definition.case_id),
    verificationIdForCase: caseId => definitions.has(caseId) ? pkg.authoredCaseVerificationId(definitions.get(caseId)) : undefined });
  if (retired !== null) {
    if (retired.conflicts.length > 0) fail('requirement_retirement_use_conflict',
      'A retired requirement is still used by an obligation that supports remaining meaning or that this save amends', {
        field: 'retire_claim_ids', conflict_count: retired.conflicts.length,
        conflicts: retired.conflicts.slice(0, RETIREMENT_CONFLICT_LIMIT), guidance_path: retirementGuidance(),
        next_calls: [queryCall(initial)] });
    content = retired.contents.get(initial.selectedUnit);
    rootContent = initial.selectedUnit === null ? content : retired.contents.get(null);
    for (let index = cases.length - 1; index >= 0; index--) {
      if (!retired.retiredCaseIds.has(cases[index].case_id)) continue;
      definitions.delete(cases[index].case_id);
      cases.splice(index, 1);
    }
  }
  cases.sort((a,b) => a.case_id.localeCompare(b.case_id));
  if (cases.length || rootContent.cases) rootContent.cases = cases;
  let contract;
  try {
    contract = pkg.deriveAuthoredTestCases({ contract: initial.contract?.content ?? null,
      cases, buildTemplate: pkg.buildStableTestProofBindingTemplate });
  } catch (error) {
    if (error?.code === 'obligation_coverage_case_verification_conflict') {
      const caseIds = cases.filter(definition => pkg.authoredCaseVerificationId(definition) ===
        error.details?.verification_id).map(definition => definition.case_id);
      const selection = rebinding?.selections.find(entry => entry.case_ids?.some(id => caseIds.includes(id)));
      error.details = { ...error.details, changed: false, phase: 'admission', limb: 'mechanical_failure',
        case_ids: caseIds, ...(selection === undefined ? verificationConflictRecovery(initial, {
          verificationId: error.details?.verification_id, caseIds, initialVerifications, content, changes })
          : { field: selection.field, requirement_index: selection.requirement_index,
            guidance_path: rebindingGuidance() }) };
    } else if (CASE_ASSOCIATION_CODES.has(error?.code) && error.details?.condition !== undefined) {

      error.details = { ...error.details, changed: false, phase: 'admission', limb: 'mechanical_failure',
        ...caseAssociationRouting(initial) };
    } else if (UNLINKED_VERIFICATION_CODES.has(error?.code)) {

      error.details = { ...error.details, changed: false, phase: 'admission', limb: 'mechanical_failure',
        field: UNLINKED_VERIFICATION_FIELD, guidance_path: verificationGuidance() };
    }
    throw error;
  }
  assertCaseComponentIdentities(pkg, contract, preparedChanges);

  if (rebinding !== null) assertReplacementRuntimeMeaning(pkg, initial, rebinding, cases, contract);
  const record = structuredClone(initial.record);
  if (rebinding?.changesLinks) {
    const address = initial.selectedUnit === null ? initial.wkId : `${initial.wkId}#${initial.selectedUnit}`;
    const verificationLinks = new Map([...rebinding.exactLinks]
      .filter(([identity]) => rebinding.retiredVerificationIds.has(identity)));
    const ownerUnits = rebindWorkRecordTestProofVerificationIds(record, verificationLinks)
      .filter(owner => owner !== address);

    const owner = rebinding.selections.find(selection => selection.retired_verification_ids
      .some(identity => verificationLinks.has(identity)));
    if (ownerUnits.length > 0) fail('case_selector_cross_unit',
      'The replacement retires a verification whose execution target another unit owns; replace the requirement through that unit', {
        owner_units: ownerUnits, selected_unit: address, requirement_index: owner.requirement_index,
        field: owner.field, verification_ids: [...verificationLinks.keys()].sort(), guidance_path: rebindingGuidance() });
  }
  const unit = initial.selectedUnit === null ? record : record.slices.find(slice => slice.id === initial.selectedUnit);
  if (retired !== null) {

    const selectedAddress = unitAddress(initial.selectedUnit);
    const foreign = [record, ...record.slices].map(owner => ({ address: unitAddress(owner === record ? null : owner.id),
      verificationIds: projectWorkRecordTestProofValidation({ selectedUnit: owner }).executable_declarations
        .flatMap(entry => entry.verification_ids.filter(id => retirement.retiredVerificationIds.has(id))) }))
      .filter(owner => owner.address !== selectedAddress && owner.verificationIds.length > 0);
    if (foreign.length > 0) {
      const verificationIds = [...new Set(foreign.flatMap(owner => owner.verificationIds))].sort();
      const selections = retirement.selections.filter(fact => fact.retired_verification_ids.some(id =>
        verificationIds.includes(id))).map(fact => ({ field: `retire_claim_ids[${fact.retire_index}]`,
        retire_index: fact.retire_index, claim_id: fact.claim_id }));
      fail('case_selector_cross_unit',
        'The retirement retires a verification whose execution target another unit owns; retire the requirement through that unit', {
          owner_units: foreign.map(owner => owner.address), selected_unit: selectedAddress, field: selections[0].field,
          verification_ids: verificationIds, retirement_selections: selections, guidance_path: retirementGuidance() });
    }
    for (const verificationId of retirement.retiredVerificationIds) removeWorkRecordTestProofTarget(unit, verificationId);
  }
  for (const item of changes) {
    const definition = definitions.get(content.obligations.find(row => row.obligation_id === item.obligation_id).case_id);
    const verification = pkg.authoredCaseVerificationId(definition);
    const paths = owner => projectWorkRecordTestProofValidation({ selectedUnit: owner }).executable_declarations
      .filter(entry => entry.verification_ids.includes(verification)).map(entry => entry.target);
    const otherPaths = [record, ...record.slices].filter(owner => owner !== unit).flatMap(paths);
    const address = initial.selectedUnit === null ? initial.wkId : `${initial.wkId}#${initial.selectedUnit}`;
    const prior = item.case.target === undefined ? undefined : initial.cases.find(value => value.case_id === definition.case_id);
    const priorTarget = prior ? projectSavedProofCase(pkg, initial, { case_id: prior.case_id })[0].target ?? null : null;

    if (isNativeTarget(priorTarget) && priorTarget.owner_unit && priorTarget.owner_unit !== address &&
        !(isNativeTarget(item.case.target) && same(nativeTargetMeaning(priorTarget), nativeTargetMeaning(definition.target)))) fail(
      'case_selector_cross_unit', 'Change the native execution target through its existing owning unit', {
        verification_id: verification, owner_unit: priorTarget.owner_unit });
    if (isNativeTarget(priorTarget) && !isNativeTarget(item.case.target) && definition.target) {
      definition.target.owner_unit = priorTarget.owner_unit;
    }
    if (isNativeTarget(item.case.target)) {

      if (priorTarget?.owner_unit && priorTarget.owner_unit !== address && !isNativeTarget(priorTarget)) fail(
        'case_selector_cross_unit', 'Change the native execution target through its existing owning unit', {
          verification_id: verification, owner_unit: priorTarget.owner_unit });
      if (otherPaths.length > 0) fail('case_selector_cross_unit',
        'Another unit still declares an ordinary execution target for this verification', {
          verification_id: verification, targets: [...new Set(otherPaths)].sort() });
      removeWorkRecordTestProofTarget(unit, verification);
      definition.target.owner_unit = priorTarget?.owner_unit ?? address;
      continue;
    }
    const knownPaths = new Set([...paths(unit), ...otherPaths]);
    if (knownPaths.size > 1 || item.case.target?.path !== undefined && otherPaths.some(path => path !== item.case.target.path)) fail(
      'case_selector_cross_unit', 'Shared executable targets conflict; change the target through its authorized owner', {
        verification_id: verification, targets: [...knownPaths].sort() });
    if (item.case.target?.path !== undefined) {
      if (priorTarget?.owner_unit && priorTarget.owner_unit !== address && priorTarget.path !== item.case.target.path) fail(
        'case_selector_cross_unit', 'Change the execution target through its existing owning unit');
      amendWorkRecordTestProofTarget(unit, verification, item.case.target.path);
      definition.target.owner_unit = priorTarget?.owner_unit ?? address;
      delete definition.target.path;
    }
  }

  const selectedBinding = (owner, definitions, row) => {
    const definition = row?.case_id ? definitions.find(value => value.case_id === row.case_id) : undefined;
    if (!definition) return [];
    const verification = pkg.authoredCaseVerificationId(definition);
    return projectWorkRecordTestProofValidation({ selectedUnit: owner }).executable_declarations
      .filter(entry => entry.verification_ids.includes(verification)).map(entry => entry.target);
  };
  const saved = obligations.filter(item => {
    const before = initial.rows.find(row => row.obligation_id === item.obligation_id) ?? null;
    const after = content.obligations.find(row => row.obligation_id === item.obligation_id) ?? null;
    return !same(before, after) || !same(projectSavedProofCase(pkg, initial, before ?? {}),
      projectSavedProofCase(pkg, { cases, record, contract: initial.contract }, after ?? {})) ||
      !same(selectedBinding(initial.unit, initial.cases ?? [], before), selectedBinding(unit, cases, after));
  }).length;

  const selectedContent = obligations.length === 0 && initial.source === null &&
    (initial.cases ?? []).length === 0 && content.obligations.length === 0 && !content.cases ? null : content;
  const sources = initial.sources.map(entry => ({ ...entry,
    content: entry.selectedUnit === initial.selectedUnit ? selectedContent ?? undefined
      : entry.selectedUnit === null ? (cases.length || initial.caseSource ? rootContent : undefined)
        : retired?.contents.get(entry.selectedUnit) ?? remap(entry.source?.content) }));
  const verificationClaims = new Set([
    ...(initial.previousContract?.claims ?? []), ...(initial.contract?.content.claims ?? [])
  ].filter(claim => claim.kind === 'verification').map(claim => claim.claim_id));
  for (const entry of sources) for (const row of entry.content?.obligations ?? []) {
    if (!row.case_id) continue;
    const definition = definitions.get(row.case_id);
    if (!definition) fail('case_unknown', 'A use references an absent case', { case_id: row.case_id });
    const verification = pkg.authoredCaseVerificationId(definition);

    const known = (row.controlled_contract_node_ids ?? []).filter(id =>
      verificationClaims.has(id));
    if (known.length > 0 && !known.includes(verification)) fail('case_selector_ambiguous',
      'The use names a different verification fact from its shared case', {
        condition: 'shared_case_verification_conflict', ...caseAssociationRouting(initial),
        case_id: row.case_id, obligation_id: row.obligation_id,
        verification_id: verification ?? null, eligible_verification_ids: verification ? [verification] : [],
        controlled_contract_node_ids: [...(row.controlled_contract_node_ids ?? [])].sort() });
  }
  const sourceChanges = sources.filter(entry => entry.content && !same(entry.source?.content ?? null, entry.content));
  const canonicalContract = initial.contract ? structuredClone(initial.contract.content) : null;
  if (canonicalContract) {
    const owned = new Set(cases.map(pkg.authoredCaseVerificationId));
    canonicalContract.test_proofs = canonicalContract.test_proofs.filter(proof => !owned.has(proof.verification_claim_id));
  }
  return { contract, canonicalContract, record, unit, content: selectedContent, rootContent, cases, sources, sourceChanges,
    nativeChanged: canonicalContract !== null && !same(initial.contract.content, canonicalContract), targetsChanged: !same(initial.unit.acceptance.validation, unit.acceptance.validation),
    affected: content.obligations.map(row => row.obligation_id), saved, unchanged: obligations.length - saved,
    retirement: retired === null ? null : { retired_uses: retired.retiredUses,
      retired_case_ids: [...retired.retiredCaseIds].sort() } };
}
