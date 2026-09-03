import { readFile } from "node:fs/promises";
import { PROFILE_ID_V1, SCHEMA_VERSION_V1, VOCABULARY_VERSION_V1 }
  from "../../lib/native-contract-carrier-v1.mjs";

const BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE = JSON.parse(await readFile(
  new URL("../certification/profiles/proof.state.bounded-interval-nonmutation/2.0.0/profile.json",
    import.meta.url), "utf8"));
const INPUT_TEMPLATE = JSON.parse(await readFile(
  new URL("../certification/profiles/proof.state.bounded-interval-nonmutation/2.0.0/evaluation-input.template.json",
    import.meta.url), "utf8"));
const DEFAULT_ROLE_IDS = Object.freeze(Object.fromEntries(INPUT_TEMPLATE.reference_bindings.map(
  ({ role, reference_ids }) => [role, Object.freeze([...reference_ids])])));
const DEFAULT_NUMBER_VALUES = Object.freeze(Object.fromEntries(INPUT_TEMPLATE.number_bindings.map(
  ({ role, value }) => [role, value])));
const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identityFor(role, referenceId, domain) {
  if (role === "verification") return { kind: "code_symbol", repository: `fixture-${domain}`,
    path: "tests/bounded-interval-nonmutation.test.mjs", symbol: "boundedIntervalNonmutation" };
  if (role.endsWith("_condition")) return { kind: "profile_term",
    term: `bounded-interval-nonmutation:${referenceId.slice(4)}` };
  return { kind: "durable_id", domain: `bounded-interval-nonmutation:${domain}`,
    value: referenceId.slice(4) };
}

function resolveTemplate(template, roleIds, numberValues, local = {}) {
  const idsForRole = (role) => local[role] ? [local[role]] : roleIds[role];
  return { subject_reference_id: idsForRole(template.subject_role)[0], operator: template.operator,
    applicability_context: { mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(idsForRole) },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return idsForRole(operand.role).map(ref);
      if (operand.kind === "number") return [{ kind: "number", value:
        operand.value_role === undefined ? operand.value : numberValues[operand.value_role] }];
      return [structuredClone(operand)];
    }) };
}

function addPopulationClaims(contract, populationId, memberIds, suffix) {
  if (memberIds.length > 0) {
    contract.propositions.push({ proposition_id: `prop-population-${suffix}-contains`,
      subject_reference_id: populationId, operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: memberIds.map(ref) });
    contract.claims.push({ claim_id: `claim-population-${suffix}-contains`, kind: "evidence",
      modality: "MUST", proposition_id: `prop-population-${suffix}-contains` });
  }
  contract.propositions.push({ proposition_id: `prop-population-${suffix}-cardinality`,
    subject_reference_id: populationId, operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }] });
  contract.claims.push({ claim_id: `claim-population-${suffix}-cardinality`, kind: "evidence",
    modality: "MUST", proposition_id: `prop-population-${suffix}-cardinality` });
}

function buildBoundedIntervalNonmutationFixture({ profile: suppliedProfile = BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE,
  domain = "database-snapshot", role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {}, identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {}, verification_method: verificationMethod = "test_execution",
  verification_method_overrides: verificationMethodOverrides = {},
  modality_overrides: modalityOverrides = {}, evaluation_stage: evaluationStage = "pre_dispatch",
  drop_pattern_ids: dropPatternIds = [], proposition_overrides: propositionOverrides = {},
  mutate_contract: mutateContract, mutate_input: mutateInput } = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) =>
    [role, [...(roleIdOverrides[role] ?? ids)]]));
  const numberValues = { ...DEFAULT_NUMBER_VALUES, ...numberValueOverrides };
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) for (const referenceId of roleIds[declaredRole.role]) {
    if (referenceById.has(referenceId)) continue;
    referenceById.set(referenceId, { reference_id: referenceId,
      type_term: roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
      identity: structuredClone(typeof identityOverrides[declaredRole.role] === "function"
        ? identityOverrides[declaredRole.role](referenceId)
        : identityOverrides[declaredRole.role] ?? identityFor(declaredRole.role, referenceId, domain)) });
  }
  const contract = { schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1, references: [...referenceById.values()], propositions: [], claims: [],
    relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: [] };
  for (const pattern of profile.reference_binding_patterns) if (pattern.comparison === "complete_population") {
    const [populationRole, memberRole] = pattern.roles;
    addPopulationClaims(contract, roleIds[populationRole][0], roleIds[memberRole],
      populationRole.replaceAll("_", "-"));
  }
  const dropped = new Set(dropPatternIds);
  const claimIdsByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    const instances = pattern.for_each ? roleIds[pattern.for_each.population_role].map((memberId) => ({
      suffix: `-${memberId.slice(4)}`, local: { [pattern.for_each.member_role]: memberId }
    })) : [{ suffix: "", local: {} }];
    for (const { suffix, local } of instances) {
      const propositionId = `prop-${pattern.pattern_id}${suffix}`;
      contract.propositions.push({ proposition_id: propositionId,
        ...resolveTemplate(pattern.proposition_template, roleIds, numberValues, local),
        ...(propositionOverrides[pattern.pattern_id] ?? {}) });
      const claimId = `claim-${pattern.pattern_id}${suffix}`;
      const claim = { claim_id: claimId, kind: pattern.claim_kind,
        modality: modalityOverrides[pattern.pattern_id] ?? pattern.allowed_modalities[0],
        proposition_id: propositionId };
      if (pattern.claim_kind === "verification") {
        const falsifierId = `prop-falsifier-${pattern.pattern_id}${suffix}`;
        contract.propositions.push({ proposition_id: falsifierId,
          ...resolveTemplate(pattern.falsifying_proposition_template, roleIds, numberValues, local),
          ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {}) });
        claim.verification_method = verificationMethodOverrides[pattern.pattern_id] ?? verificationMethod;
        claim.falsifying_proposition_id = falsifierId;
      }
      contract.claims.push(claim);
      if (!pattern.for_each) claimIdsByPattern.set(pattern.pattern_id, claimId);
    }
  }
  contract.relations = profile.relation_patterns.flatMap((pattern) => {
    const source_claim_id = claimIdsByPattern.get(pattern.source_claim_pattern_id);
    const target_claim_id = claimIdsByPattern.get(pattern.target_claim_pattern_id);
    return source_claim_id && target_claim_id ? [{ relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role, source_claim_id, target_claim_id }] : [];
  });
  const input = { input_version: INPUT_TEMPLATE.input_version, evaluation_stage: evaluationStage,
    reference_bindings: profile.reference_roles.map(({ role }) => ({ role, reference_ids: [...roleIds[role]] })),
    number_bindings: profile.number_roles.map(({ role }) => ({ role, value: numberValues[role] })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {} };
  mutateContract?.(contract, { claimIdsByPattern, roleIds, numberValues });
  mutateInput?.(input, { roleIds, numberValues });
  return { contract, input, evaluation_input: input, profile, roleIds, numberValues };
}

const findClaim = (contract, patternId) => contract.claims.find(
  ({ claim_id }) => claim_id === `claim-${patternId}`);
const findProposition = (contract, patternId, { falsifier = false } = {}) =>
  contract.propositions.find(({ proposition_id }) => proposition_id ===
    `${falsifier ? "prop-falsifier-" : "prop-"}${patternId}`);
export { BOUNDED_INTERVAL_NONMUTATION_V1_PROFILE, buildBoundedIntervalNonmutationFixture,
  findClaim, findProposition, ref };
