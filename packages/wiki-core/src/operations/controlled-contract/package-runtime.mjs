

import { readFile } from "node:fs/promises";

import {
  compiledValidators,
  createEvictOnRejectionMemo
} from "@agent-chassis/controlled-contract/validator-cache";

import { ControlledContractToolError } from "../../lib/controlled-contract-tool-shared.mjs";

const CONTROLLED_CONTRACT_MODULE_SPECIFIER = "@agent-chassis/controlled-contract";
const PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-proof-plan-request.v1.schema.json";
const EVALUATION_INPUT_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-verification-profile-input.v2.schema.json";

const EVALUATION_INPUT_VALIDATOR_GROUP =
  "wiki-core.controlled-contract-operations.evaluation-input.v1";

function addressedEvaluationInputPack(input) {
  const hasProfileId = input.profileId !== undefined;
  const hasProfileVersion = input.profileVersion !== undefined;
  if (hasProfileId !== hasProfileVersion) throw new ControlledContractToolError(
    "controlled_contract_pack_identity_invalid",
    "profile_id and profile_version must be supplied together"
  );
  if (!hasProfileId) return null;
  if (input.carrierKind !== "evaluation_input") throw new ControlledContractToolError(
    "controlled_contract_pack_identity_forbidden",
    "exact profile identity addresses only an evaluation-input carrier"
  );
  return { profileId: input.profileId, profileVersion: input.profileVersion };
}

const loadControlledContractPackage = createEvictOnRejectionMemo(() =>
  import(CONTROLLED_CONTRACT_MODULE_SPECIFIER));

const loadControlledContractProofPlanCompiler = createEvictOnRejectionMemo(() =>
  import(`${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-plan-compiler`));

const SHARED_CONTRACT_SPECIFIERS = Object.freeze([
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-contract`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/test-proof`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/native-test-cases`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/obligation-coverage`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/acceptance-coverage-identity`
]);

const loadControlledContractSharedContract = createEvictOnRejectionMemo(async () => {
  const modules = await Promise.all(SHARED_CONTRACT_SPECIFIERS.map(
    (specifier) => import(specifier)));
  return Object.freeze(Object.assign({}, ...modules.map((module) => ({ ...module }))));
});

const PROOF_AUTHORING_SPECIFIERS = Object.freeze([
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-selection`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/native-contract`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-authoring-diagnostic-groups`
]);

const loadControlledContractProofAuthoring = createEvictOnRejectionMemo(async () => {
  const [shared, ...modules] = await Promise.all([loadControlledContractSharedContract(),
    ...PROOF_AUTHORING_SPECIFIERS.map((specifier) => import(specifier))]);
  return Object.freeze(Object.assign({}, shared, ...modules.map((module) => ({ ...module }))));
});

const loadControlledContractProofIntents = createEvictOnRejectionMemo(() =>
  import(`${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-intents`));

const loadProofPlanRequestSchema = createEvictOnRejectionMemo(() =>
  readFile(new URL(import.meta.resolve(PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER)), "utf8")
    .then(JSON.parse));

const loadEvaluationInputSchemaValue = createEvictOnRejectionMemo(() =>
  readFile(new URL(import.meta.resolve(EVALUATION_INPUT_SCHEMA_SPECIFIER)), "utf8")
    .then(JSON.parse));

const loadEvaluationInputSchema = createEvictOnRejectionMemo(async () => {
  const schema = await loadEvaluationInputSchemaValue();
  const { validateEvaluationInput } = await compiledValidators(
    EVALUATION_INPUT_VALIDATOR_GROUP,
    { validators: { validateEvaluationInput: schema } }
  );
  return validateEvaluationInput;
});

const diagnosticIdentityKinds = new Map([
  ['row_id', 'requirement'], ['collection_row_id', 'collection'],
  ['claim_id', 'claim'], ['verification_id', 'verification'], ['verification_claim_id', 'verification'],
  ['proposition_id', 'proposition'], ['constraint_id', 'constraint'], ['reference_id', 'entity'], ['relation_id', 'relation']
]);
const uniqueMeanings = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
function nativeDiagnosticSubjects(candidate) {
  const bindings = new Map();
  const add = (id, subject) => { if (typeof id === 'string') bindings.set(id,
    uniqueMeanings([...(bindings.get(id) ?? []), subject])); };
  const references = new Map((candidate?.references ?? []).map(row => [row.reference_id, row]));
  const entity = row => ({ ...(row.type_term === undefined ? {} : { type_term: row.type_term }), identity: structuredClone(row.identity) });
  let missingReference = false;
  const authoredValue = value => {
    if (Array.isArray(value)) return value.map(authoredValue);
    if (value === null || typeof value !== 'object') return value;
    if (value.identity !== undefined) return entity(value);
    if (typeof value.select === 'string') {
      if (references.get(value.select)?.identity !== undefined) return entity(references.get(value.select));
      missingReference = true;
      return undefined;
    }
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, authoredValue(member)]));
  };
  for (const row of candidate?.references ?? []) if (row.identity !== undefined) add(row.reference_id,
    { subject: { kind: 'entity', identity: row.identity, type_term: row.type_term } });
  for (const row of candidate?.authored_requirements?.rows ?? []) {
    if (row.input?.subject?.identity === undefined) continue;
    missingReference = false;
    const match = authoredValue(row.input);
    if (missingReference) continue;
    const subject = { kind: 'requirement', match };
    add(row.row_id, { subject });
    for (const id of row.constraint_ids ?? []) add(id, { subject, field: row.input.membership === undefined ? 'behavior' : 'membership' });
    for (const id of row.claim_ids ?? []) add(id, { subject, field: 'behavior' });
  }
  for (const claim of candidate?.claims ?? []) {
    const owns = claim.kind === 'verification'
      ? (candidate.relations ?? []).filter(row => row.role === 'verifies' && row.source_claim_id === claim.claim_id)
        .flatMap(row => bindings.get(row.target_claim_id) ?? []).map(({ subject }) => ({ subject, field: 'verification' }))
      : bindings.get(claim.claim_id) ?? [];
    for (const subject of owns) {
      add(claim.claim_id, subject);
      add(claim.proposition_id, { ...subject, field: claim.kind === 'verification' ? 'verification.observes' : 'behavior' });
      add(claim.falsifying_proposition_id, { ...subject, field: 'verification.fails_when' });
    }
  }
  for (const row of candidate?.relations ?? []) for (const id of [row.source_claim_id, row.target_claim_id])
    for (const subject of bindings.get(id) ?? []) add(row.relation_id, subject);
  return bindings;
}

export function packageValidationDiagnostics(validation, candidate = null) {

  const native = structuredClone(validation.diagnostic_details ?? validation.diagnostics?.diagnostics ?? []);
  const bindings = nativeDiagnosticSubjects(candidate);
  const diagnostic = fact => {
    const subjects = [], unresolved = [], substitutions = new Map();
    const visit = value => {
      if (Array.isArray(value)) return value.map(visit);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).flatMap(([key, member]) => {
        const singular = key.endsWith('_ids') ? key.slice(0, -1) : key;
        const identityField = [...diagnosticIdentityKinds.keys()].find(field => singular === field || singular.endsWith(`_${field}`));
        const kind = diagnosticIdentityKinds.get(identityField);
        if (kind !== undefined) {
          for (const id of Array.isArray(member) ? member : [member]) {
            const matches = bindings.get(id) ?? [];
            subjects.push(...matches.map(subject => ({ ...subject, ...(singular === identityField ? {}
              : { role: singular.slice(0, -3) }) })));
            if (!matches.length) unresolved.push({ kind,
              cause: 'No authored subject association is established for this failed native member.' });
            substitutions.set(id, matches.length ? `the affected ${matches[0].subject.kind}` : `an unattributed ${kind}`);
          }
          return [];
        }

        if (['schema_pointer', 'schemaPath', 'diagnostic_projection_version'].includes(key)) return [];
        if (['pointer', 'field_pointer', 'instancePath'].includes(key) &&
            /^\/(?:claims|propositions|references|relations|test_proofs|authored_requirements)(?:\/|$)/u.test(member)) {
          const field = member.replace(/^\/[^/]+\/[0-9]+\/?/u, '').replaceAll('/', '.');
          return field ? [['failed_field', field]] : [];
        }
        return [[key, visit(member)]];
      }));
    };
    const meaning = visit(fact);
    const translate = value => typeof value === 'string'
      ? [...substitutions].reduce((text, [id, subject]) => typeof id === 'string' && id.length > 0 ? text.replaceAll(id, subject) : text, value)
      : Array.isArray(value) ? value.map(translate)
        : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, member]) => [key, translate(member)])) : value;
    const choices = uniqueMeanings(subjects);
    const status = unresolved.length ? 'unavailable' : choices.length === 1 ? 'mapped' : choices.length > 1 ? 'ambiguous' : 'unavailable';
    const attribution = { status, ...(choices.length === 1 && status === 'mapped' ? choices[0] : choices.length ? { choices } : {}),
      ...(unresolved.length ? { unresolved } : {}),
      ...(status === 'mapped' ? {} : { uncertainty: choices.length > 1
        ? 'The failed member has several authored associations. No single correction target is established.'
        : 'The failure is established, but its authored correction location is unavailable.' }) };
    const falsifier = fact.code === 'irreflexive_proposition' && choices.some(row => row.field === 'verification.fails_when');
    return { ...translate(meaning), attribution,
      ...(falsifier ? { guidance_path: ['required_object_shapes', 'verification'],
        correction: 'Preserve the required behavior, applicability, source and evidence associations. Author verification.fails_when tied to that behavior: a subject differing from itself cannot describe a contrary outcome.' } : {}) };
  };
  const incomplete = validation.diagnostic_details === undefined &&
    (validation.diagnostics?.truncated === true || validation.diagnostics?.omitted_count > 0);
  return { diagnostics: { diagnostics: uniqueMeanings(native.map(diagnostic)),
    ...(native.length === 0 ? { availability: { state: 'unavailable',
      cause: 'Validation failed but its deciding diagnostics were not supplied.',
      correction: 'Stop: no supported correction is established without the deciding cause. Do not retry unchanged to discover it.' } }
      : incomplete ? { availability: { state: 'partial',
        cause: 'Additional deciding validation facts were not supplied by the validator. The delivered failures remain established.',
        correction: 'Preserve the delivered failures. A complete correction cannot be established from this incomplete diagnosis; do not guess omitted causes or retry unchanged.' } } : {}) } };

}

function assertPackageValidContract(validation, candidate = null) {
  if (!validation.valid) throw new ControlledContractToolError(
    "controlled_contract_carrier_validation_failed", "contract failed package validation",
    {

      changed: false,
      ...packageValidationDiagnostics(validation, candidate)
    }
  );
  return validation;
}

export {
  EVALUATION_INPUT_VALIDATOR_GROUP,
  SHARED_CONTRACT_SPECIFIERS,
  addressedEvaluationInputPack,
  assertPackageValidContract,
  loadControlledContractPackage,
  loadControlledContractProofPlanCompiler,
  loadControlledContractProofAuthoring,
  loadControlledContractProofIntents,
  loadControlledContractSharedContract,
  loadEvaluationInputSchema,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
};
