

import {
  PROOF_AUTHORING_FIELDS,
  PROOF_AUTHORING_FIELD_SCHEMAS,
  validateObligationCoverageDraft
} from './obligation-coverage-carrier.mjs';

export { PROOF_AUTHORING_FIELDS, PROOF_AUTHORING_FIELD_SCHEMAS };

export class ProofAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProofAuthoringError';
    this.code = `obligation_coverage_${code}`;
    this.details = { limb: 'mechanical_failure', changed: false, ...details };
  }
}

export function assertProofAuthoringDraft(source) {
  const validation = validateObligationCoverageDraft(source);
  if (!validation.valid) throw new ProofAuthoringError('source_invalid',
    'The authored source must satisfy the current draft contract', {
      schema_errors: validation.schema_errors, diagnostics: validation.diagnostics
    });
  return validation.carrier;
}

export const proofProblem = (category, kind, facts = {}, options = {}) => ({ category,
  severity: options.severity ?? 'unspecified', cause: { kind, ...facts },
  ...(options.definitionSensitive === true ? { definition_sensitive: true } : {}) });

export const proofDiagnostic = (code, path, reason, details = {}, problem =
  proofProblem('unclassified', 'owner_diagnostic', { code })) => ({ code, path, reason,
  owner: '@agent-chassis/controlled-contract', ...details, problem });

export const proofOwnerDiagnostic = (error, path, problem = proofProblem('unclassified',
  'owner_failure', { owner_code: error.code, details: error.details ?? null },
  { definitionSensitive: true })) => proofDiagnostic(error.code, path, error.message,
  error.details, problem);

export function selectProofAuthoringRows(draft, context = {}) {
  const rowIndices = new Map(draft.obligations.map((row, index) => [row.obligation_id, index]));
  if (context.obligation_ids !== undefined && (context.obligation_id !== undefined ||
      !Array.isArray(context.obligation_ids) || context.obligation_ids.length > draft.obligations.length ||
      new Set(context.obligation_ids).size !== context.obligation_ids.length ||
      context.obligation_ids.some(id => !rowIndices.has(id)))) {
    throw new ProofAuthoringError('selection_invalid', 'Internal obligation selection must be unique saved IDs');
  }
  const selectedIds = context.obligation_ids === undefined ? null : new Set(context.obligation_ids);
  const selected = selectedIds ? draft.obligations.filter(row => selectedIds.has(row.obligation_id)) :
    context.obligation_id === undefined ? draft.obligations :
    draft.obligations.filter(row => row.obligation_id === context.obligation_id);
  return { rowIndices, selected };
}

export function assessProofAuthoringRowSemantics(row, path, context = {}) {
  const diagnostics = [];
  if (!row.statement) diagnostics.push(proofDiagnostic('obligation_coverage_statement_missing', path,
    'Author an obligation statement', {}, proofProblem('author_input', 'missing_authored_field',
      { field: 'statement' })));
  if (row.controlled_contract_node_ids?.length && !context.contract_nodes) {
    diagnostics.push(proofDiagnostic('obligation_coverage_contract_unavailable', path,
      'The exact native contract is unavailable', {},
      proofProblem('canonical_source', 'canonical_source_unavailable', { source: 'native_contract' })));
  } else for (const id of row.controlled_contract_node_ids ?? []) {
    if (!context.contract_nodes.includes(id)) diagnostics.push(proofDiagnostic(
      'obligation_coverage_node_unknown', `${path}/controlled_contract_node_ids`,
      'Node is absent from the current native contract', { node_id: id },
      proofProblem('author_input', 'canonical_reference_unknown', { node_id: id })));
  }
  if (row.gap) diagnostics.push(proofDiagnostic('obligation_coverage_authored_gap_retired', `${path}/gap`,
    'The authored gap field is retired; preserve the reason while authoring the actual missing meaning',
    { retired_gap: row.gap }, proofProblem('author_input', 'retired_authored_field', {
      field: 'gap', retired_gap: row.gap })));
  return diagnostics;
}

export function proofAuthoringPopulationDiagnostics(selectedCount) {
  return selectedCount > 0 ? [] : [proofDiagnostic('obligation_coverage_population_empty', '/obligations',
    'No obligation has been authored', {}, proofProblem('author_input', 'missing_authored_population',
      { population: 'obligations' }))];
}

export const PROOF_AUTHORING_SEMANTIC_ASSESSMENT_VERSION =
  'proof-authoring-semantic-assessment.v1';

export function assessProofAuthoringSemantics(source, context = {}) {
  const draft = assertProofAuthoringDraft(source);
  const { rowIndices, selected } = selectProofAuthoringRows(draft, context);
  const rows = selected.map(row => {
    const path = `/obligations/${rowIndices.get(row.obligation_id)}`;
    const diagnostics = assessProofAuthoringRowSemantics(row, path, context);
    return { obligation_id: row.obligation_id, path, row, diagnostics,
      status: diagnostics.length === 0 ? 'complete' : 'incomplete' };
  });
  return Object.freeze({
    schema_version: PROOF_AUTHORING_SEMANTIC_ASSESSMENT_VERSION,
    status: rows.length > 0 && rows.every(entry => entry.status === 'complete')
      ? 'complete' : 'incomplete',
    total: rows.length,
    diagnostics: proofAuthoringPopulationDiagnostics(rows.length),
    rows: Object.freeze(rows.map(entry => Object.freeze({
      obligation_id: entry.obligation_id, path: entry.path, status: entry.status,
      diagnostics: Object.freeze(entry.diagnostics)
    })))
  });
}

export class ProofDiagnosticCodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProofDiagnosticCodeError';
  }
}

const ACTOR_RECOVERY_VALUES = Object.freeze(['operator', 'coordinator',
  'worker_split', 'automatic_proceed', 'none', 'caller_retry']);

const REGISTERED_CODE_CATEGORY = 'controlled_contract';

const PROBLEM_CATEGORIES = Object.freeze(['author_input', 'canonical_source',
  'system_capability']);

const isNonEmptyString = value => typeof value === 'string' && value.length > 0;
const isFactIdentity = value => isNonEmptyString(value) && /^[a-z][a-z0-9_]*$/u.test(value);

function assertRecoveryShape(code, recovery, requiredFacts) {
  if (recovery === null) return;
  if (!isNonEmptyString(recovery.kind) || !isNonEmptyString(recovery.success_condition)) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: recovery must name a kind and success_condition`);
  }
  for (const [argument, fact] of Object.entries(recovery.argument_bindings ?? {})) {
    if (!isFactIdentity(fact)) {
      throw new ProofDiagnosticCodeError(
        `invalid registered diagnostic code ${code}: recovery argument_bindings.${argument} must name a snake_case refusal fact identity`);
    }
    if (!requiredFacts.has(fact)) {
      throw new ProofDiagnosticCodeError(
        `invalid registered diagnostic code ${code}: recovery binds ${argument} to ${fact}, which the entry does not require`);
    }
  }
}

function assertEntryShape(entry) {
  const code = entry?.code;
  if (!isNonEmptyString(code)) {
    throw new ProofDiagnosticCodeError('invalid registered diagnostic code: every entry must name a code');
  }
  if (!isNonEmptyString(entry.family) || !isNonEmptyString(entry.condition)) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: entry must name a family and condition`);
  }
  if (entry.category !== REGISTERED_CODE_CATEGORY) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: category must be ${REGISTERED_CODE_CATEGORY}`);
  }
  if (!ACTOR_RECOVERY_VALUES.includes(entry.actor_recovery)) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: actor_recovery must be one of ${ACTOR_RECOVERY_VALUES.join(', ')}`);
  }
  if (!PROBLEM_CATEGORIES.includes(entry.problem_category)) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: problem_category must be one of ${PROBLEM_CATEGORIES.join(', ')}`);
  }
  if (typeof entry.blocking !== 'boolean' || !isNonEmptyString(entry.summary) ||
      !isNonEmptyString(entry.cause_kind)) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: entry must declare blocking, a summary and a cause_kind`);
  }
  if (!Array.isArray(entry.required_facts) || !entry.required_facts.every(isFactIdentity) ||
      new Set(entry.required_facts).size !== entry.required_facts.length) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: required_facts must be unique snake_case fact identities`);
  }
  const requiredFacts = new Set(entry.required_facts);
  if (!Array.isArray(entry.detail_facts) ||
      !entry.detail_facts.every(fact => requiredFacts.has(fact))) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: detail_facts must be declared facts of the entry`);
  }

  assertRecoveryShape(code, entry.recovery ?? null, requiredFacts);

  if (entry.actor_recovery === 'caller_retry' && (entry.recovery ?? null) === null) {
    throw new ProofDiagnosticCodeError(
      `invalid registered diagnostic code ${code}: a caller_retry code must declare its recovery`);
  }
}

export function createDiagnosticCodeRegistry({ owner, entries }) {
  if (!isNonEmptyString(owner)) {
    throw new ProofDiagnosticCodeError('a diagnostic code registry must name its owner');
  }
  const byCode = new Map();
  const byCondition = new Map();
  for (const entry of entries) {
    assertEntryShape(entry);
    if (byCode.has(entry.code)) {
      throw new ProofDiagnosticCodeError(
        `invalid registered diagnostic code ${entry.code}: duplicate code`);
    }
    const key = `${entry.family}/${entry.condition}`;
    if (byCondition.has(key)) {
      throw new ProofDiagnosticCodeError(
        `invalid registered diagnostic code ${entry.code}: duplicate family/condition ${key}`);
    }
    const frozen = deepFreezeEntry(entry);
    byCode.set(entry.code, frozen);
    byCondition.set(key, frozen);
  }
  return Object.freeze({ owner, byCode, byCondition,
    codes: Object.freeze([...byCode.keys()]) });
}

function deepFreezeEntry(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreezeEntry(child);
  return Object.freeze(value);
}

export function raiseErrorCode(registry, selector, occurrence = {}) {
  const entry = isNonEmptyString(selector) ? registry.byCode.get(selector)
    : registry.byCondition.get(`${selector?.family}/${selector?.condition}`);
  if (entry === undefined) {
    const named = isNonEmptyString(selector) ? selector
      : `${selector?.family}/${selector?.condition}`;
    throw new ProofDiagnosticCodeError(
      `unregistered diagnostic code ${named} for ${registry.owner}`);
  }
  const { path, facts } = occurrence;
  if (!isNonEmptyString(path)) {
    throw new ProofDiagnosticCodeError(
      `diagnostic code ${entry.code} was raised without an occurrence path`);
  }
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new ProofDiagnosticCodeError(
      `diagnostic code ${entry.code} was raised without its declared facts`);
  }
  for (const name of entry.required_facts) {
    if (!Object.hasOwn(facts, name)) {
      throw new ProofDiagnosticCodeError(
        `diagnostic code ${entry.code} was raised without the declared fact ${name}`);
    }
    if (facts[name] === undefined) {
      throw new ProofDiagnosticCodeError(
        `diagnostic code ${entry.code} was raised with the declared fact ${name} undefined`);
    }
  }

  for (const [argument, fact] of Object.entries(entry.recovery?.argument_bindings ?? {})) {
    if (facts[fact] === null) {
      throw new ProofDiagnosticCodeError(
        `diagnostic code ${entry.code} binds recovery argument ${argument} to ${fact}, which is null in this occurrence`);
    }
  }

  return proofDiagnostic(entry.code, path, entry.summary,
    Object.fromEntries(entry.detail_facts.map(fact => [fact, structuredClone(facts[fact])])),
    proofProblem(entry.problem_category, entry.cause_kind, {
      ...structuredClone(facts), actor_recovery: entry.actor_recovery
    }));
}

export function registeredRecoveryTemplate(registry, code) {
  return registry.byCode.get(code)?.recovery ?? null;
}

export const OBLIGATION_COVERAGE_UPSERT_TOOL =
  'workspace_controlled_contract_obligation_coverage_upsert';
export const WORK_RECORD_EDIT_TOOL = 'workspace_work_record_edit';

export const AUTHORED_BINDING_OWNER_CODES = Object.freeze(['stable_test_proof_incomplete']);

const PREREQUISITE_FACTS = Object.freeze(['verification_id', 'binding_count',
  'case_id', 'prerequisite', 'status', 'owner_code', 'owner_details']);

const PREREQUISITE_DETAIL_FACTS = Object.freeze(['verification_id', 'binding_count',
  'owner_code', 'owner_details']);

const prerequisiteEntry = ({ family, condition, code, summary, recovery = null,
  actorRecovery = 'caller_retry', problemCategory = 'author_input' }) => ({
  code, family, condition, category: REGISTERED_CODE_CATEGORY,
  actor_recovery: actorRecovery, blocking: true, problem_category: problemCategory,
  cause_kind: 'selected_route_prerequisite', required_facts: PREREQUISITE_FACTS,
  detail_facts: PREREQUISITE_DETAIL_FACTS, summary, recovery
});

const authorRoute = (route, { summary, prerequisite, success_condition: success,
  argument_bindings: bindings }) => ({ kind: 'structured_route', route, summary,
  prerequisite, success_condition: success,
  ...(bindings === undefined ? {} : { argument_bindings: bindings }) });

export const PROOF_PREREQUISITE_CODES = createDiagnosticCodeRegistry({
  owner: '@agent-chassis/controlled-contract',
  entries: [
    prerequisiteEntry({
      family: 'native_test_binding', condition: 'missing',
      code: 'obligation_coverage_native_binding_missing',
      summary: "The selected test-validity route derives one native test binding from this obligation's authored case; no case is linked, so no binding is derived.",

      recovery: authorRoute(OBLIGATION_COVERAGE_UPSERT_TOOL, {
        summary: "Link this obligation to one authored case through its case_id and case definition. The native test binding is derived from that case; never supply or edit the binding itself.",
        prerequisite: 'the obligation names no authored case for the derivation to read',
        success_condition: 'The obligation names one saved authored case, so exactly one native test binding is derived from it.'
      })
    }),
    prerequisiteEntry({
      family: 'native_test_binding', condition: 'ambiguous',
      code: 'obligation_coverage_native_binding_ambiguous',
      summary: "The selected test-validity route requires exactly one native test binding derived from this obligation's authored case; more than one is linked, so no single binding resolves.",
      recovery: authorRoute(OBLIGATION_COVERAGE_UPSERT_TOOL, {
        summary: "Reduce this obligation to exactly one authored case so its derivation resolves one binding. The native test binding is derived; never supply or edit the binding itself.",
        prerequisite: 'more than one authored case feeds the derivation',
        success_condition: 'The obligation names exactly one saved authored case, so exactly one native test binding resolves.',
        argument_bindings: { linked_binding_count: 'binding_count' }
      })
    }),

    prerequisiteEntry({
      family: 'native_test_binding', condition: 'case_incomplete',
      code: 'obligation_coverage_native_binding_case_incomplete',

      summary: "The one native test binding derived from this obligation's authored case does not state the complete meaning the route requires, which is that case's own unfinished content.",

      recovery: authorRoute(OBLIGATION_COVERAGE_UPSERT_TOOL, {
        summary: "Re-author this obligation's case through the upsert's case_authoring guidance and inspect any structured owner diagnostics validation published; never supply or edit the derived binding itself.",
        prerequisite: 'the authored case omits content the derived binding must state',
        success_condition: 'The authored case states the complete meaning the derived binding requires, so the derivation validates.'
      })
    }),

    prerequisiteEntry({
      family: 'native_test_binding', condition: 'provider_unresolved',
      code: 'obligation_coverage_native_binding_provider_unresolved',
      summary: "The execution provider of the one native test binding derived from this obligation's authored case could not be resolved against the provider registry.",
      actorRecovery: 'operator', problemCategory: 'system_capability'
    }),

    prerequisiteEntry({
      family: 'declared_test_target', condition: 'verification_unresolved',
      code: 'obligation_coverage_declared_test_target_verification_unresolved',
      summary: "No single native test binding resolves for this obligation, so there is no verification for a declared test target to name.",
      recovery: authorRoute(OBLIGATION_COVERAGE_UPSERT_TOOL, {
        summary: "Resolve the native test binding first by linking this obligation to exactly one authored case; the verification a declared target must name comes from that binding.",
        prerequisite: 'the obligation resolves no single native test binding, so its verification is unknown',
        success_condition: 'Exactly one native test binding resolves, so its verification identity is known and a declared target can name it.'
      })
    }),

    prerequisiteEntry({
      family: 'declared_test_target', condition: 'undeclared',
      code: 'obligation_coverage_declared_test_target_undeclared',
      summary: "The selected test-validity route requires one declared test target naming this obligation's verification; the work record declares none.",
      recovery: authorRoute(WORK_RECORD_EDIT_TOOL, {
        summary: "Declare one executable validation entry naming the refusal's verification_id in the owning unit's acceptance.validation.",
        prerequisite: "no acceptance.validation entry and no native case target names the refusal's verification",
        success_condition: "Exactly one declared test target names the refusal's verification_id.",
        argument_bindings: { verification_id: 'verification_id' }
      })
    }),
    prerequisiteEntry({
      family: 'declared_test_target', condition: 'ambiguous',
      code: 'obligation_coverage_declared_test_target_ambiguous',
      summary: "The selected test-validity route requires exactly one declared test target naming this obligation's verification; more than one declares it, so no single target resolves.",
      recovery: authorRoute(WORK_RECORD_EDIT_TOOL, {
        summary: "Reduce the declarations naming the refusal's verification_id to exactly one across the owning unit's acceptance.validation and its case targets.",
        prerequisite: "more than one declared test target names the refusal's verification",
        success_condition: "Exactly one declared test target names the refusal's verification_id.",
        argument_bindings: { verification_id: 'verification_id', declared_count: 'binding_count' }
      })
    }),
    prerequisiteEntry({
      family: 'declared_test_target', condition: 'invalid',
      code: 'obligation_coverage_declared_test_target_invalid',
      summary: "The work record's declared test-target projection is invalid, so no declared target resolves for this obligation's verification.",
      recovery: authorRoute(WORK_RECORD_EDIT_TOOL, {
        summary: "Correct the declared validation defect the refusal's owner_code names in the owning unit's acceptance.validation.",
        prerequisite: 'the declared validation projection reports at least one defect',
        success_condition: "The work record's declared test-target projection is valid.",
        argument_bindings: { declared_validation_defect: 'owner_code' }
      })
    })
  ]
});
