

import { isDeepStrictEqual } from "node:util";
import { PROFILE_ID_V1, SCHEMA_VERSION_V1, TEST_PROOF_VERSION_V1, VOCABULARY_VERSION_V1 } from
  "@agent-chassis/controlled-contract";
import { assessPolicyPatternsExperimentalV1, describePopulationDeclarationExperimentalV1 } from
  "@agent-chassis/controlled-contract/verification-profile";
import { bindProofAuthoringRevision } from "./proof-authoring-revision.mjs";
import { requiredObligationSupport } from "./required-obligation-support.mjs";
import { resolveDerivedProofAuthoringContract, resolveProofAuthoringSource } from
  "./proof-authoring-source.mjs";

export const REQUIRED_POLICY_SCHEMA_VERSION = "required-policy-patterns.experimental.v0";
export const REQUIRED_POLICY_ASSESSMENT_VERSION = "required-policy-assessment.experimental.v0";
const EVALUATION_INPUT_VERSION = "controlled-contract-verification-profile-input.v2";
const POLICY_FIELDS = Object.freeze(["schema_version", "policy_id", "status", "provenance", "scope",
  "profile", "bindings", "obligation_pattern_ids"]);
const NO_AUTHORITY = Object.freeze({ policy_decision: false, implementation_satisfaction: false,
  proof_execution: false, dispatch: false, persistent_effects: false });
const OBLIGATION_JOIN_NOTE = "separate join: obligations are saved rows outside the native graph";

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const unique = (values) => [...new Set(values)].sort(compare);

const typedIdentity = (value) => isRecord(value) && typeof value.type_term === "string" &&
  isRecord(value.identity);

const memberKey = (member) => member === null ? "" : JSON.stringify([member.type_term,
  Object.keys(member.identity).sort().map((key) => [key, member.identity[key]])]);
const distinctMembers = (members) => [...new Map(members.map((member) => [memberKey(member), member])).values()]
  .sort((left, right) => compare(memberKey(left), memberKey(right)));
const memberLabel = (member) => member === null ? "unavailable"
  : Object.entries(member.identity).filter(([key]) => key !== "kind").map(([, value]) => String(value)).join(" ");

class RequiredPolicyInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.code = "required_policy_input_invalid";
    this.details = details;
  }
}

function strings(value) {
  if (typeof value === "string") return [value];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}

function assertPolicy(policy) {
  const fail = (field, message) => { throw new RequiredPolicyInputError(message, { field,
    policy_id: typeof policy?.policy_id === "string" ? policy.policy_id : null }); };
  if (!isRecord(policy)) fail("", "a required policy is one object");
  const unknown = Object.keys(policy).filter((key) => !POLICY_FIELDS.includes(key)).sort();
  if (unknown.length > 0) fail(unknown[0], "a required policy carries an unsupported member");
  if (policy.schema_version !== REQUIRED_POLICY_SCHEMA_VERSION) fail("schema_version",
    `a required policy states ${REQUIRED_POLICY_SCHEMA_VERSION}`);
  if (typeof policy.policy_id !== "string" || policy.policy_id.length === 0) fail("policy_id",
    "a required policy states its identity");
  if (!isRecord(policy.provenance)) fail("provenance", "a required policy states its provenance");
  if (!isRecord(policy.scope) || typeof policy.scope.unit !== "string" ||
      !(policy.scope.focus === null || typeof policy.scope.focus === "string")) fail("scope",
    "a required policy states the exact unit and focus it applies to");
  if (!isRecord(policy.profile) || !Array.isArray(policy.profile.reference_roles) ||
      !Array.isArray(policy.profile.claim_patterns) || !Array.isArray(policy.profile.relation_patterns)) {
    fail("profile", "a required policy states its patterns in the verification profile grammar");
  }
  if (!isRecord(policy.bindings)) fail("bindings", "a required policy states its scoped bindings");

  const cardinality = new Map(policy.profile.reference_roles.map((entry) => [entry.role, entry.cardinality]));
  for (const [role, binding] of Object.entries(policy.bindings)) {
    if (!cardinality.has(role)) fail(`bindings.${role}`, "a binding names a role the bundle does not define");
    if (binding === null) continue;
    if (cardinality.get(role) === "exactly_one") {
      if (!typedIdentity(binding)) fail(`bindings.${role}`,
        "a role bound to exactly one referent takes one typed identity, or null when its meaning is unavailable");
      continue;
    }
    if (!Array.isArray(binding) || binding.some((member) => member !== null && !typedIdentity(member))) {
      fail(`bindings.${role}`, "a member-set role takes an array of typed identities, with null for a member " +
        "whose meaning is unavailable, or null when the whole set is unavailable");
    }
    const distinct = distinctMembers(binding).length;
    if (distinct === 0 && cardinality.get(role) === "one_or_more") fail(`bindings.${role}`,
      "an empty member set is intentional only for a role that admits no member");
    if (distinct > 1 && cardinality.get(role) === "zero_or_one") fail(`bindings.${role}`,
      "a role that admits at most one member is bound to more than one");
  }
  const claimPatterns = policy.profile.claim_patterns.map(({ pattern_id: id }) => id);
  if (!Array.isArray(policy.obligation_pattern_ids) || policy.obligation_pattern_ids.some((id) =>
    !claimPatterns.includes(id))) fail("obligation_pattern_ids",
    "obligation support is required of claim patterns the bundle defines");
}

function expectedPopulation(profile) {
  const templateRoles = (template) => template === undefined ? [] : [template.subject_role,
    ...template.applicability_context.operand_roles,
    ...template.operands.filter(({ kind }) => kind === "reference").map(({ role }) => role)];
  const other = (kind, patterns) => (patterns ?? []).map((pattern) => ({ pattern_id: pattern.pattern_id,
    pattern_kind: kind }));
  const contextRoles = (pattern) => pattern.applicability_context?.operand_roles ?? [];
  return [
    ...profile.claim_patterns.map((pattern) => ({ pattern_id: pattern.pattern_id, pattern_kind: "claim",
      roles: unique([...templateRoles(pattern.proposition_template),
        ...templateRoles(pattern.falsifying_proposition_template)]) })),
    ...profile.relation_patterns.map((pattern) => ({ pattern_id: pattern.pattern_id,
      pattern_kind: "relation",
      depends_on: [pattern.source_claim_pattern_id, pattern.target_claim_pattern_id] })),
    ...(profile.collection_patterns ?? []).map((pattern) => ({ pattern_id: pattern.pattern_id,
      pattern_kind: "collection", depends_on: [...pattern.member_claim_pattern_ids] })),

    ...(profile.reference_binding_patterns ?? []).map((pattern) => ({ pattern_id: pattern.pattern_id,
      pattern_kind: "reference_binding", roles: unique([...pattern.roles, ...contextRoles(pattern)]) })),
    ...(profile.binding_constraint_patterns ?? []).map((pattern) => ({ pattern_id: pattern.pattern_id,
      pattern_kind: "binding_constraint", roles: pattern.role_kind === "reference" ? [pattern.role] : [] })),

    ...other("resolver_fact", profile.resolver_fact_patterns),
    ...other("evidence", profile.evidence_patterns)
  ].sort((left, right) => compare(left.pattern_id, right.pattern_id));
}

function absentContract() {
  return { schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1, references: [], propositions: [], claims: [], relations: [],
    collections: [], residue: [], annotations: [], test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: [] };
}

function resolveBindings(policy, contract) {
  const states = {};
  const members = {};
  const referenceBindings = [];
  const resolve = (referent) => {
    if (referent === null) return { state: "binding_unavailable", reference_id: null };
    const declared = contract.references.filter((reference) => reference.type_term === referent.type_term &&
      isDeepStrictEqual(reference.identity, referent.identity));
    return declared.length === 1 ? { state: "bound", reference_id: declared[0].reference_id }
      : { state: declared.length === 0 ? "referent_undeclared" : "referent_ambiguous", reference_id: null };
  };
  for (const { role, cardinality } of policy.profile.reference_roles) {
    const binding = policy.bindings[role] ?? null;
    if (binding === null) { states[role] = "binding_unavailable"; continue; }
    if (cardinality === "exactly_one") {
      const resolved = resolve(binding);
      states[role] = resolved.state;
      if (resolved.reference_id !== null) referenceBindings.push({ role, reference_ids: [resolved.reference_id] });
      continue;
    }
    const resolved = distinctMembers(binding).map((member) => ({ member, ...resolve(member) }));
    members[role] = resolved.map(({ member, state }) => ({ identity: clone(member), state }));
    const found = (state) => resolved.some((entry) => entry.state === state);
    states[role] = found("binding_unavailable") ? "members_unavailable"
      : found("referent_ambiguous") ? "members_ambiguous"
        : found("referent_undeclared") ? "members_undeclared" : "bound";
    const ids = resolved.flatMap((entry) => entry.reference_id === null ? [] : [entry.reference_id]).sort(compare);

    if (ids.length > 0 || resolved.length === 0) referenceBindings.push({ role, reference_ids: ids });
  }

  const sizeOf = new Map(referenceBindings.map((entry) => [entry.role, entry.reference_ids.length]));
  const numberBindings = (policy.profile.reference_role_count_bindings ?? []).flatMap((binding) =>
    states[binding.reference_role] === "bound" && sizeOf.has(binding.reference_role)
      ? [{ role: binding.number_role, value: sizeOf.get(binding.reference_role) }] : [])
    .sort((left, right) => compare(left.role, right.role));
  return { states, members, evaluationInput: { input_version: EVALUATION_INPUT_VERSION,
    reference_bindings: referenceBindings.sort((left, right) => compare(left.role, right.role)),
    number_bindings: numberBindings, claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [],
    stable_evaluation: {} } };
}

function populationSources(policy, contract, states, evaluationInput) {
  const bound = new Map(evaluationInput.reference_bindings.map((entry) => [entry.role, entry.reference_ids]));
  const byPattern = new Map();
  for (const pattern of (policy.profile.reference_binding_patterns ?? [])
    .filter(({ comparison }) => comparison === "complete_population")) {
    const [populationRole, memberRole] = pattern.roles;
    const scopeRoles = pattern.applicability_context.operand_roles;
    if ([populationRole, ...scopeRoles].some((role) => states[role] !== "bound") ||
        bound.get(populationRole).length !== 1) continue;
    const [populationId] = bound.get(populationRole);
    const facts = describePopulationDeclarationExperimentalV1({ contract, population_reference_id: populationId,
      applicability_context: { mode: pattern.applicability_context.mode,
        operand_reference_ids: unique(scopeRoles.flatMap((role) => bound.get(role))) } });

    const required = unique([populationId, ...(bound.get(memberRole) ?? [])]);
    const read = unique([...required, ...facts.member_reference_ids]);
    byPattern.set(pattern.pattern_id, { membership_claim_ids: [...facts.membership_claim_ids],
      cardinality_claim_ids: [...facts.cardinality_claim_ids],
      equated_reference_ids: unique(contract.references.map((reference) => reference.reference_id)
        .filter((other) => !required.includes(other) && read.some((id) => id !== other
          ? facts.equivalent(id, other) : required.some((bound) => facts.equivalent(bound, other))))) });
  }
  return byPattern;
}

const DEFINITE = Object.freeze(["referent_undeclared", "members_undeclared"]);
function bindingReasons(role, states, members) {
  if (members[role] === undefined || states[role] === "binding_unavailable") return [`${states[role]}:${role}`];
  return members[role].filter(({ state }) => state !== "bound").map(({ identity, state }) =>
    `member_${state}:${role}:${memberLabel(identity)}`);
}

function structuralFindings(contract, diagnostics) {
  const claims = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositions = new Map(contract.propositions.map((row) => [row.proposition_id, row]));
  const named = diagnostics.map((diagnostic) => ({ code: diagnostic.code, ids: strings(diagnostic) }));
  const definition = (id) => {
    const claim = claims.get(id);
    if (claim === undefined) return [id];
    const propositionIds = [claim.proposition_id, claim.falsifying_proposition_id].filter((value) =>
      typeof value === "string");
    return [id, ...propositionIds, ...propositionIds.flatMap((propositionId) => {
      const proposition = propositions.get(propositionId);
      return proposition === undefined ? [] : [proposition.subject_reference_id,
        ...(proposition.applicability_context?.operand_reference_ids ?? []),
        ...(proposition.operands ?? []).flatMap((operand) =>
          operand.kind === "reference" ? [operand.reference_id] : [])];
    })];
  };
  return (matchedIds) => {
    const own = matchedIds.flatMap(definition);
    return unique(named.filter(({ ids }) => ids.some((id) => own.includes(id))).map(({ code }) => code));
  };
}

const PRESENT = Object.freeze(["supported", "affected"]);
function expectationResults(population, bindingStates, bindingMembers, matched, findings, matcherCodes) {
  const results = new Map();
  const reading = (expected) => {
    const row = matched.get(expected.pattern_id) ?? null;
    const base = { pattern_id: expected.pattern_id, pattern_kind: expected.pattern_kind,
      matcher_status: row?.status ?? null, declaration_matched: row?.status === "satisfied",
      matched_ids: row?.matched_ids ?? [],
      structural_diagnostics: row === null ? [] : findings(row.matched_ids) };
    if (row === null) return { ...base, status: "unresolved", reasons: ["matcher_result_absent"] };

    const blocked = (expected.roles ?? []).filter((role) => bindingStates[role] !== "bound");
    const uncertain = blocked.filter((role) => !DEFINITE.includes(bindingStates[role]));
    if (uncertain.length > 0) return { ...base, status: "unresolved",
      reasons: uncertain.flatMap((role) => bindingReasons(role, bindingStates, bindingMembers)) };
    if (blocked.length > 0) return { ...base, status: "missing",
      reasons: blocked.flatMap((role) => bindingReasons(role, bindingStates, bindingMembers)) };
    if (row.status === "satisfied") {
      const codes = base.structural_diagnostics;
      const duplicated = codes.filter((code) => code.startsWith("duplicate_"));
      if (duplicated.length > 0) return { ...base, status: "unresolved",
        reasons: duplicated.map((code) => `identity_ambiguous:${code}`) };
      return codes.length === 0 ? { ...base, status: "supported", reasons: [] }
        : { ...base, status: "affected", reasons: codes.map((code) => `structural_diagnostic:${code}`) };
    }
    if (expected.depends_on !== undefined) {
      const members = expected.depends_on.map((id) => results.get(id));
      if (members.some((member) => member === undefined || member.status === "unresolved")) {
        return { ...base, status: "unresolved", reasons: ["endpoint_unresolved"] };
      }
      if (members.some((member) => !PRESENT.includes(member.status))) return { ...base,
        status: "missing", reasons: ["endpoint_not_authored"] };
      return row.status === "unsatisfied" ? { ...base, status: "missing",
        reasons: [`no_matching_authored_${expected.pattern_kind === "relation" ? "relationship" : "collection"}`] }
        : { ...base, status: "unresolved", reasons: ["matcher_indeterminate"] };
    }

    if (expected.pattern_kind !== "claim") {
      const codes = matcherCodes.get(expected.pattern_id) ?? [];
      return row.status === "unsatisfied"
        ? { ...base, status: "missing", reasons: codes.length > 0 ? codes : ["matcher_unsatisfied"] }
        : { ...base, status: "unresolved", reasons: codes.length > 0 ? codes : ["matcher_indeterminate"] };
    }
    return row.status === "unsatisfied" ? { ...base, status: "missing",
      reasons: ["no_matching_authored_claim"] }
      : { ...base, status: "unresolved", reasons: ["matcher_indeterminate"] };
  };

  for (const expected of [...population.filter(({ pattern_kind: kind }) => kind === "claim"),
    ...population.filter(({ pattern_kind: kind }) => kind !== "claim")]) {
    results.set(expected.pattern_id, reading(expected));
  }
  return population.map((expected) => results.get(expected.pattern_id));
}

function obligationSupport(patternId, expectation, rows, subject, contract) {
  const base = { pattern_id: patternId, join: OBLIGATION_JOIN_NOTE };
  if (!PRESENT.includes(expectation.status)) return { ...base, obligation_ids: [], diagnostics: [],
    status: expectation.status === "missing" ? "missing" : "unresolved",
    reasons: [expectation.status === "missing" ? "required_claim_not_authored" : "required_claim_unresolved"] };
  const { obligationIds, diagnostics } = requiredObligationSupport(rows, expectation.matched_ids[0],
    { wk_id: subject.wk_id, focus: subject.focus }, [...contract.claims.map((row) => row.claim_id),
      ...contract.references.map((row) => row.reference_id)]);
  return { ...base, obligation_ids: obligationIds, diagnostics: unique(diagnostics.map(({ code }) => code)),
    status: obligationIds.length > 0 ? "supported" : "missing",
    reasons: obligationIds.length > 0 ? [] : ["no_qualifying_same_subject_obligation"] };
}

const tally = (rows) => Object.fromEntries([["required", rows.length],
  ...["supported", "affected", "missing", "unresolved"].map((status) =>
    [status, rows.filter((row) => row.status === status).length])]);

function unassessed(policy, population, reason, detail) {
  const expectations = population.map((expected) => ({ pattern_id: expected.pattern_id,
    pattern_kind: expected.pattern_kind, matcher_status: null, declaration_matched: false, matched_ids: [],
    structural_diagnostics: [], status: "unresolved", reasons: [reason], population_sources: null }));
  const obligations = unique(policy.obligation_pattern_ids).map((patternId) => ({ pattern_id: patternId,
    join: OBLIGATION_JOIN_NOTE, obligation_ids: [], diagnostics: [], status: "unresolved", reasons: [reason] }));
  return { status: "not_assessed", reason, ...detail, expectations, obligation_support: obligations };
}

export function assessRequiredPolicy({ policy, subject, contract, obligations, unavailable = null }) {
  assertPolicy(policy);
  const population = expectedPopulation(policy.profile);
  const authored = contract ?? absentContract();
  const header = { policy_id: policy.policy_id, policy_status: policy.status ?? null,
    provenance: clone(policy.provenance), scope: clone(policy.scope) };

  const finish = (body) => {
    const counts = { expectations: tally(body.expectations), obligations: tally(body.obligation_support) };
    return { ...header, ...body, counts,
      definition_coverage_complete: body.status === "assessed" &&
        body.matcher.satisfaction === "satisfied" &&
        counts.expectations.supported === counts.expectations.required &&
        counts.obligations.supported === counts.obligations.required };
  };
  if (unavailable !== null) return finish(unassessed(policy, population, unavailable, {
    bindings: {}, binding_members: {}, authored_contract: null, matcher: null }));
  if (policy.scope.unit !== subject.unit || policy.scope.focus !== subject.focus) {
    return finish(unassessed(policy, population, "policy_scope_mismatch", {
      bindings: {}, binding_members: {}, authored_contract: null, matcher: null }));
  }
  const { states, members, evaluationInput } = resolveBindings(policy, authored);
  const authoredContract = { present: contract !== null };
  let matcher;
  try {
    matcher = assessPolicyPatternsExperimentalV1({ contract: authored, profile: policy.profile,
      evaluation_input: evaluationInput });
  } catch (error) {
    return finish(unassessed(policy, population, "matcher_refused", { bindings: states, binding_members: members,
      authored_contract: { ...authoredContract, structurally_valid: null, structural_diagnostics: [] },
      matcher: { refused: error?.code ?? error?.name ?? "error", message: error?.message ?? null,
        pointers: clone(error?.details?.pointers ?? []),
        diagnostics: clone(error?.details?.diagnostics?.diagnostics ?? []) } }));
  }
  const structural = { ...authoredContract, structurally_valid: matcher.contract_structurally_valid,
    structural_diagnostics: clone(matcher.contract_structural_diagnostics) };
  const matcherFacts = { result_version: matcher.result_version, admission: clone(matcher.admission),
    satisfaction: matcher.satisfaction, diagnostics: clone(matcher.diagnostics) };
  if (matcher.satisfaction === "invalid") {
    return finish(unassessed(policy, population, "matcher_input_invalid", { bindings: states, binding_members: members,
      authored_contract: structural, matcher: matcherFacts }));
  }
  const matcherCodes = new Map();
  for (const diagnostic of matcher.diagnostics) {
    if (typeof diagnostic.pattern_id !== "string") continue;
    matcherCodes.set(diagnostic.pattern_id, unique([...(matcherCodes.get(diagnostic.pattern_id) ?? []), diagnostic.code]));
  }
  const expectations = expectationResults(population, states, members,
    new Map(matcher.pattern_results.map((row) => [row.pattern_id, row])),
    structuralFindings(authored, matcher.contract_structural_diagnostics), matcherCodes);
  const sources = populationSources(policy, authored, states, evaluationInput);
  for (const row of expectations) row.population_sources = sources.get(row.pattern_id) ?? null;
  const byPattern = new Map(expectations.map((row) => [row.pattern_id, row]));
  return finish({ status: "assessed", reason: null, bindings: states, binding_members: members,
    authored_contract: structural,
    matcher: matcherFacts, expectations,
    obligation_support: unique(policy.obligation_pattern_ids).map((patternId) =>
      obligationSupport(patternId, byPattern.get(patternId), obligations, subject, authored)) });
}

export function assessRequiredPolicies({ policies, subject, contract, obligations, selection,
  unavailable = null }) {
  if (!Array.isArray(policies)) throw new RequiredPolicyInputError(
    "the required policy population is an array", { field: "policies" });
  const byId = new Map();
  for (const policy of policies) {
    assertPolicy(policy);
    const known = byId.get(policy.policy_id);
    if (known !== undefined && !isDeepStrictEqual(known, policy)) throw new RequiredPolicyInputError(
      "two different required policies share one identity", { field: "policies",
        policy_id: policy.policy_id });
    byId.set(policy.policy_id, policy);
  }
  const results = [...byId.keys()].sort(compare).map((id) => assessRequiredPolicy({ policy: byId.get(id),
    subject, contract, obligations, unavailable }));
  const wholeUnit = selection?.scope === "whole_unit";
  return { schema_version: REQUIRED_POLICY_ASSESSMENT_VERSION, experimental: true,
    status: unavailable !== null ? "unavailable"
      : results.every((entry) => entry.status === "assessed") ? "assessed" : "partially_assessed",
    subject: clone(subject), policies: results,

    whole_unit_definition_coverage: wholeUnit ? {
      claimed: true, complete: results.every((entry) => entry.definition_coverage_complete) }
      : { claimed: false, complete: null, reason: "selected_obligation_request" },
    authority: NO_AUTHORITY };
}

export function createRequiredPolicyAssessment({ policies }) {
  return async function assessRequiredPolicyForUnit(input) {
    if (!Object.hasOwn(input, "expectedRevision")) throw new RequiredPolicyInputError(
      "the composition states the source revision its assessment was computed at",
      { field: "expectedRevision" });
    const { repoRoot, unit, wkId, selectedUnit, focus, selection, expectedRevision } = input;
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
      { repoRoot, wkId, focus, selectedUnit }, { requireSource: false }));
    const subject = { unit, wk_id: wkId, selected_unit: selectedUnit, focus };
    const moved = resolved.revision !== expectedRevision;
    const contract = moved ? null : await resolveDerivedProofAuthoringContract(resolved);
    return { ...assessRequiredPolicies({ policies, subject, contract: contract?.content ?? null,
      obligations: moved ? [] : clone(resolved.rows), selection,
      unavailable: moved ? "source_revision_moved" : null }),
    source: { revision: expectedRevision, observed_revision: resolved.revision, current: !moved,
      contract_content_digest: contract?.content_digest ?? null,
      obligation_source_digest: moved ? null : resolved.source?.content_digest ?? null } };
  };
}
