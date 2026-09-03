import { readFile } from "node:fs/promises";

const DORMANCY_NONACTIVATION_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.dormancy.nonactivation/2.0.0/profile.json",
  import.meta.url
), "utf8"));
const INPUT_TEMPLATE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.dormancy.nonactivation/2.0.0/evaluation-input.template.json",
  import.meta.url
), "utf8"));

const ref = (reference_id) => ({ kind: "reference", reference_id });
const bindingMap = (input) => new Map(input.reference_bindings.map(
  ({ role, reference_ids }) => [role, reference_ids]
));
const numberMap = (input) => new Map(input.number_bindings.map(
  ({ role, value }) => [role, value]
));

function identityFor(role, referenceId, domain) {
  if (role === "verification") return {
    kind: "code_symbol", repository: `fixture-${domain}`,
    path: "tests/dormancy-nonactivation.test.mjs", symbol: "boundedStateStability"
  };
  if (role.endsWith("_condition")) return {
    kind: "profile_term", term: `dormancy-nonactivation:${referenceId.slice(4)}`
  };
  return { kind: "durable_id", domain: `dormancy-nonactivation:${domain}`,
    value: referenceId.slice(4) };
}

function resolve(template, refs, numbers, local = new Map()) {
  const expand = (role) => local.get(role) ?? refs.get(role) ?? [];
  return {
    subject_reference_id: expand(template.subject_role)[0],
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(expand)
    },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return expand(operand.role).map(ref);
      if (operand.kind === "number" && operand.value_role !== undefined) return [{
        kind: "number", value: numbers.get(operand.value_role)
      }];
      return [structuredClone(operand)];
    })
  };
}

function buildDormancyNonactivationFixture({
  profile: suppliedProfile = DORMANCY_NONACTIVATION_V1_PROFILE,
  domain = "cancellation-survivor-window",
  observation_count: observationCount = 2,
  subject_type: subjectType,
  role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {},
  identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {},
  modality_overrides: modalityOverrides = {},
  verification_method_overrides: verificationMethodOverrides = {},
  proposition_overrides: propositionOverrides = {},
  drop_pattern_ids: dropPatternIds = [],
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const input = structuredClone(INPUT_TEMPLATE);
  for (const binding of input.reference_bindings) {
    binding.reference_ids = [...(roleIdOverrides[binding.role] ?? binding.reference_ids)];
  }
  const roleIds = bindingMap(input);

  for (const binding of input.number_bindings) binding.value = numberValueOverrides[binding.role] ?? binding.value;
  const numbers = numberMap(input);
  const referenceById = new Map();
  for (const role of profile.reference_roles) for (const referenceId of roleIds.get(role.role) ?? []) {
    if (referenceById.has(referenceId)) continue;
    const identity = typeof identityOverrides[role.role] === "function"
      ? identityOverrides[role.role](referenceId)
      : identityOverrides[role.role] ?? identityFor(role.role, referenceId, domain);
    referenceById.set(referenceId, {
      reference_id: referenceId,
      type_term: roleTypeOverrides[role.role] ??
        (role.role === "subject" && subjectType ? subjectType : role.allowed_type_terms[0]),
      identity: structuredClone(identity)
    });
  }
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [...referenceById.values()], propositions: [], claims: [], relations: [],
    collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const addClaim = ({ id, proposition, kind = "evidence", modality = "MUST",
    verificationMethod, falsifierId }) => {
    contract.propositions.push({ proposition_id: `prop-${id}`, ...proposition });
    contract.claims.push({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`,
      kind, modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {}) });
  };
  for (const population of profile.reference_binding_patterns) {
    if (population.comparison !== "complete_population") continue;
    const [populationRole, memberRole] = population.roles;
    const members = roleIds.get(memberRole) ?? [];
    addClaim({ id: `population-${populationRole.replaceAll("_", "-")}-cardinality`,
      proposition: resolve({ subject_role: populationRole,
        operator: "number:has_cardinality", applicability_context: population.applicability_context,
        operands: [{ kind: "number", value: members.length }] }, roleIds, numbers) });
    if (members.length > 0) addClaim({
      id: `population-${populationRole.replaceAll("_", "-")}-contains`,
      proposition: resolve({ subject_role: populationRole, operator: "reference:contains",
        applicability_context: population.applicability_context,
        operands: [{ kind: "reference", role: memberRole }] }, roleIds, numbers)
    });
  }
  const dropped = new Set(dropPatternIds);
  const claimIdsByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    if (pattern.for_each) {
      const members = roleIds.get(pattern.for_each.population_role) ?? [];
      members.forEach((member, index) => addClaim({
        id: `${pattern.pattern_id}-${index + 1}`,
        proposition: { ...resolve(pattern.proposition_template, roleIds, numbers,
          new Map([[pattern.for_each.member_role, [member]]])),
        ...(propositionOverrides[pattern.pattern_id] ?? {}) },
        kind: pattern.claim_kind,
        modality: modalityOverrides[pattern.pattern_id] ?? pattern.allowed_modalities[0]
      }));
      continue;
    }
    let falsifierId;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({ proposition_id: `prop-${falsifierId}`,
        ...resolve(pattern.falsifying_proposition_template, roleIds, numbers),
        ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {}) });
    }
    addClaim({ id: pattern.pattern_id,
      proposition: { ...resolve(pattern.proposition_template, roleIds, numbers),
        ...(propositionOverrides[pattern.pattern_id] ?? {}) },
      kind: pattern.claim_kind,
      modality: modalityOverrides[pattern.pattern_id] ?? pattern.allowed_modalities[0],
      verificationMethod: pattern.claim_kind === "verification"
        ? verificationMethodOverrides[pattern.pattern_id] ?? "test_execution" : undefined,
      falsifierId });
    claimIdsByPattern.set(pattern.pattern_id, `claim-${pattern.pattern_id}`);
  }
  contract.relations = profile.relation_patterns.flatMap((pattern) => {
    const source = claimIdsByPattern.get(pattern.source_claim_pattern_id);
    const target = claimIdsByPattern.get(pattern.target_claim_pattern_id);
    return source && target ? [{ relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role, source_claim_id: source, target_claim_id: target }] : [];
  });
  mutateContract?.(contract, { roleIds, numbers, claimIdsByPattern });
  mutateInput?.(input, { roleIds, numbers });
  return { contract, input, evaluation_input: input, profile, roleIds, numbers };
}

const findClaim = (contract, patternId, index) => contract.claims.find(
  ({ claim_id }) => claim_id === `claim-${patternId}${index ? `-${index}` : ""}`
);
const findProposition = (contract, patternId, index, { falsifier = false } = {}) =>
  contract.propositions.find(({ proposition_id }) => proposition_id ===
    `prop-${falsifier ? "falsifier-" : ""}${patternId}${index ? `-${index}` : ""}`);

export { DORMANCY_NONACTIVATION_V1_PROFILE, buildDormancyNonactivationFixture,
  findClaim, findProposition, ref };
