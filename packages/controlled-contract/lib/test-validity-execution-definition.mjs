

import schema from '../schema/controlled-contract-test-execution-profile.v1.schema.json' with { type: 'json' };
import { compiledValidators } from './compiled-validator-cache.mjs';
import { validateProfileSchemaV1, validateEvaluationInputSchemaV1,
  validateResultSchemaV1, RESULT_VERSION_V1 } from './verification-profile-schema-v1.mjs';
import { validateStableV1ContractFamily } from './stable-v1-family-validation.mjs';
import { VOCABULARY_DIGESTS, VOCABULARY_VERSION } from './vocabulary-v1.mjs';
import { profileDigest } from './profile-digest.mjs';
import { projectBoundedDiagnostics } from './bounded-diagnostic-projection.mjs';

export const TEST_EXECUTION_PROFILE_SCHEMA = 'controlled-contract-test-execution-profile.v1';
const { validateExecutionProfile } = await compiledValidators(
  'controlled-contract.test-execution-definition.v1', { validators: { validateExecutionProfile: schema } });

export function validateCurrentProofDefinition(profile) {
  const validate = profile?.schema_version === TEST_EXECUTION_PROFILE_SCHEMA
    ? validateExecutionProfile : validateProfileSchemaV1;
  const valid = validate(profile);
  validateCurrentProofDefinition.errors = validate.errors;
  return valid;
}

export function assessTestExecutionDefinition({ contract, evaluationInput, proofPack }) {
  const profile = proofPack.profile;
  const profileValid = validateExecutionProfile(profile);
  const profileErrors = structuredClone(validateExecutionProfile.errors ?? []);
  const inputSchemaValid = validateEvaluationInputSchemaV1(evaluationInput);
  const inputErrors = structuredClone(validateEvaluationInputSchemaV1.errors ?? []);

  const bindingDiagnostics = inputSchemaValid ? [
    ...evaluationInput.reference_bindings.map(({ role }) => ({ code: 'unknown_reference_role_binding', role })),
    ...evaluationInput.number_bindings.map(({ role }) => ({ code: 'unknown_number_role_binding', role })),
    ...evaluationInput.claim_pattern_bindings.map(({ pattern_id }) => ({ code: 'unknown_claim_pattern_binding', pattern_id }))
  ] : [];
  const inputValid = inputSchemaValid && bindingDiagnostics.length === 0;
  const family = validateStableV1ContractFamily(contract);
  const valid = profileValid && inputValid && family.valid;
  const diagnostics = projectBoundedDiagnostics(valid ? [{
    code: 'test_validity_authenticated_execution_required',
    pointer: '/stable_evaluation/test_validity',
    message: 'Execute the selected native test and evaluate its authenticated evidence. ' +
      'Definition assessment establishes neither execution nor assertion-to-requirement adequacy.'
  }] : [
    ...(!profileValid ? [{ code: 'test_validity_definition_invalid', errors: profileErrors }] : []),
    ...(!inputSchemaValid ? [{ code: 'test_validity_definition_input_invalid', errors: inputErrors }] : []),
    ...bindingDiagnostics,
    ...family.diagnostics.diagnostics
  ]);
  const result = {
    result_version: RESULT_VERSION_V1,
    authority: { kind: 'free_tier_local', authoritative: false },
    profile: { profile_id: profile.profile_id, profile_version: profile.profile_version },
    profile_valid: profileValid, input_valid: inputValid, contract_valid: family.valid,
    satisfaction: valid ? 'indeterminate' : 'invalid', satisfaction_trace: null,
    pattern_results: [],
    binding_analysis: { unbound_reference_roles: [], unbound_number_roles: [],
      reference_roles_without_eligible_candidates: [], directly_blocked_pattern_ids: [],
      direct_binding_blockers: [], reference_binding_blockers: [], downstream_blocked_pattern_ids: [] },
    ambiguity_analysis: { directly_ambiguous_pattern_ids: [], downstream_ambiguous_pattern_ids: [] },
    diagnostics: diagnostics.diagnostics, total_count: diagnostics.total_count,
    returned_count: diagnostics.returned_count, omitted_count: diagnostics.omitted_count,
    truncated: diagnostics.truncated,
    contract: { schema_version: 'controlled-acceptance-contract.v1' },
    vocabulary: { version: VOCABULARY_VERSION, signature_digest: VOCABULARY_DIGESTS.signature,
      algebra_digest: VOCABULARY_DIGESTS.algebra, definitions_digest: VOCABULARY_DIGESTS.definitions,
      complete_digest: VOCABULARY_DIGESTS.complete },
    admission: { kind: 'unadmitted_direct', profile_digest: profileDigest(profile), adequacy_attested: false },
    stable_evaluation: { semantic_request_count: 0, test_validity_evaluated: false,
      diagnostic_count: diagnostics.total_count, satisfaction: 'unsatisfied' }
  };
  if (!validateResultSchemaV1(result)) throw new Error(
    `test-execution definition assessment emitted invalid output: ${JSON.stringify(validateResultSchemaV1.errors)}`);
  return result;
}
