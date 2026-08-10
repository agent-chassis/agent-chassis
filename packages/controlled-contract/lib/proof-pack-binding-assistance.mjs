import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

import { loadAdmittedProofPack } from "./admitted-proof-packs.mjs";
import {
  normalizeContractForIdentity,
  normalizeEvaluationInputForIdentity
} from "./contract-assessment.mjs";
import {
  canonicalDigest,
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";
import {
  PROOF_INTENT_DIGESTS,
  describeProofPackAuthoring
} from "./proof-intent-selection.mjs";
import { validateAndResolveNativeContractV034 } from
  "./native-contract-carrier-v034.mjs";

const packageRoot = new URL("../", import.meta.url);
const [evaluationInputSchema, resultSchema] = await Promise.all([
  readJson(new URL(
    "schema/controlled-contract-verification-profile-input.experimental.v0.2.schema.json",
    packageRoot
  )),
  readJson(new URL(
    "schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json",
    packageRoot
  ))
]);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateEvaluationInput = ajv.compile(evaluationInputSchema);
const validateProofPackBindingAssistance = ajv.compile(resultSchema);
const MAX_BINDING_ASSISTANCE_BYTES = 65_536;

class ProofPackBindingAssistanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofPackBindingAssistanceError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function packKey(profileId, profileVersion) {
  return `${profileId}@${profileVersion}`;
}

function validateRequest(request, unexpectedArguments) {
  if (unexpectedArguments.length > 0 || request === null ||
      typeof request !== "object" || Array.isArray(request) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_request_invalid",
      "binding assistance accepts exactly one plain request object"
    );
  }
  const supported = new Set([
    "contract", "profileId", "profileVersion", "requestedIntents",
    "evaluationInput"
  ]);
  const unsupported = Reflect.ownKeys(request).filter((key) =>
    typeof key !== "string" || !supported.has(key));
  if (unsupported.length > 0) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_request_option_unsupported",
    "binding assistance accepts no caller catalog, path, module, executable, environment, root, or other substrate override",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  if (typeof request.profileId !== "string" || request.profileId.length === 0 ||
      typeof request.profileVersion !== "string" ||
      request.profileVersion.length === 0) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_identity_invalid",
      "binding assistance requires one exact profile id and version"
    );
  }
  return {
    contract: request.contract,
    profileId: request.profileId,
    profileVersion: request.profileVersion,
    requestedIntents: request.requestedIntents ?? null,
    evaluationInput: request.evaluationInput ?? null
  };
}

function validatePageRequest(request, unexpectedArguments) {
  if (unexpectedArguments.length > 0 || request === null ||
      typeof request !== "object" || Array.isArray(request) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_request_invalid",
      "paged binding assistance accepts exactly one plain request object"
    );
  }
  const supported = new Set([
    "contract", "profileId", "profileVersion", "requestedIntents",
    "evaluationInput", "roles", "statuses", "offset", "maximumItems"
  ]);
  const unsupported = Reflect.ownKeys(request).filter((key) =>
    typeof key !== "string" || !supported.has(key));
  if (unsupported.length > 0) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_request_option_unsupported",
    "paged binding assistance accepts no caller substrate override",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  const input = validateRequest(Object.fromEntries(Object.entries(request).filter(
    ([key]) => ["contract", "profileId", "profileVersion", "requestedIntents",
      "evaluationInput"].includes(key)
  )), []);
  const strings = (value, maximum, field) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maximum || value.some((entry) =>
      typeof entry !== "string" || entry.length === 0 || entry.length > 512)) {
      throw new ProofPackBindingAssistanceError(
        "proof_pack_binding_selector_invalid",
        `${field} must be a bounded string array`
      );
    }
    return sortedUnique(value);
  };
  const offset = request.offset ?? 0;
  const maximumItems = request.maximumItems ?? 128;
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(maximumItems) || maximumItems < 0 || maximumItems > 128) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_page_invalid",
      "paged binding assistance requires a safe offset and at most 128 items"
    );
  }
  return { ...input, roles: strings(request.roles, 64, "roles"),
    statuses: strings(request.statuses, 8, "statuses"), offset, maximumItems };
}

function validateBindingInputRequest(request, unexpectedArguments) {
  if (unexpectedArguments.length > 0 || request === null ||
      typeof request !== "object" || Array.isArray(request) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_request_invalid",
      "binding validation accepts exactly one plain request object"
    );
  }
  const supported = new Set([
    "contract", "profileId", "profileVersion", "evaluationInput"
  ]);
  const unsupported = Reflect.ownKeys(request).filter((key) =>
    typeof key !== "string" || !supported.has(key));
  if (unsupported.length > 0) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_request_option_unsupported",
    "binding validation accepts no caller catalog, path, module, executable, environment, root, or authoring-projection option",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  if (typeof request.profileId !== "string" || request.profileId.length === 0 ||
      typeof request.profileVersion !== "string" ||
      request.profileVersion.length === 0) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_identity_invalid",
      "binding validation requires one exact profile id and version"
    );
  }
  return {
    contract: request.contract,
    profileId: request.profileId,
    profileVersion: request.profileVersion,
    evaluationInput: request.evaluationInput ?? null
  };
}

async function loadExactBindingPack(input) {
  const pack = await loadAdmittedProofPack(input.profileId);
  if (packKey(pack.profile.profile_id, pack.profile.profile_version) !==
      packKey(input.profileId, input.profileVersion)) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_identity_stale",
      "the requested profile version is not the admitted package-owned version"
    );
  }
  assertContract(input.contract, pack.profile);
  return pack;
}

function assertContract(contract, profile) {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_contract_invalid",
      "binding assistance requires one controlled contract object"
    );
  }
  const resolved = validateAndResolveNativeContractV034(contract);
  if (!resolved.schema_valid) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_contract_invalid",
    "the controlled contract is schema-invalid",
    { diagnostics: structuredClone(resolved.diagnostics) }
  );
  const mismatches = [];
  if (contract.schema_version !== profile.contract_schema_version) mismatches.push({
    field: "schema_version",
    expected: profile.contract_schema_version,
    actual: contract.schema_version ?? null
  });
  if (contract.vocabulary_version !== profile.vocabulary_version) mismatches.push({
    field: "vocabulary_version",
    expected: profile.vocabulary_version,
    actual: contract.vocabulary_version ?? null
  });
  if (mismatches.length > 0) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_contract_incompatible",
    "the controlled contract is incompatible with the exact admitted profile",
    { mismatches }
  );
}

function profileUsesRole(profile, role) {
  const roleKey = /(?:^|_)(?:role|roles)$/u;
  const paths = (value, prefix = "") => {
    const found = [];
    if (Array.isArray(value)) {
      value.forEach((child, index) => found.push(...paths(child, `${prefix}[${index}]`)));
      return found;
    }
    if (value === null || typeof value !== "object") return found;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix.length === 0 ? key : `${prefix}.${key}`;
      if (roleKey.test(key)) {
        if (child === role || Array.isArray(child) && child.includes(role)) found.push(path);
      }
      found.push(...paths(child, path));
    }
    return found;
  };
  const patternCategories = [
    "claim_patterns", "reference_binding_patterns", "relation_patterns",
    "collection_patterns", "resolver_fact_patterns", "evidence_patterns"
  ];
  const patterns = patternCategories.flatMap((category) =>
    (profile[category] ?? []).flatMap((pattern) => {
      const rolePaths = sortedUnique(paths(pattern));
      return rolePaths.length === 0 ? [] : [{
        category,
        pattern_id: pattern.pattern_id,
        role_paths: rolePaths
      }];
    })
  ).sort((left, right) => compareCodeUnits(
    `${left.category}\0${left.pattern_id}`,
    `${right.category}\0${right.pattern_id}`
  ));
  const populationUses = (profile.claim_patterns ?? []).flatMap((pattern) => {
    const uses = [];
    if (pattern.for_each?.population_role === role) uses.push("population_role");
    if (pattern.for_each?.member_role === role) uses.push("member_role");
    return uses.length === 0 ? [] : [{
      pattern_id: pattern.pattern_id,
      uses: uses.sort(compareCodeUnits)
    }];
  }).sort((left, right) => compareCodeUnits(left.pattern_id, right.pattern_id));
  return {
    patterns,
    population_uses: populationUses,
    constraints: {
      distinct_reference_role_sets: (profile.distinct_reference_role_sets ?? [])
        .filter(({ roles }) => roles.includes(role))
        .map(({ roles }) => ({ roles: sortedUnique(roles) }))
        .sort((left, right) => compareCodeUnits(
          left.roles.join("\0"), right.roles.join("\0")
        )),
      reference_role_count_bindings:
        (profile.reference_role_count_bindings ?? []).filter((binding) =>
          binding.reference_role === role || binding.number_role === role
        ).map((binding) => canonicalValue(structuredClone(binding)))
          .sort((left, right) => compareCodeUnits(
            JSON.stringify(left), JSON.stringify(right)
          ))
    }
  };
}

function cardinalityValid(cardinality, count) {
  if (cardinality === "exactly_one") return count === 1;
  if (cardinality === "one_or_more") return count >= 1;
  if (cardinality === "zero_or_one") return count <= 1;
  return cardinality === "zero_or_more";
}

function bindingMaps(evaluationInput, profile) {
  const diagnostics = [];
  const referenceByRole = new Map();
  const numberByRole = new Map();
  if (evaluationInput === null) return { diagnostics, referenceByRole, numberByRole };
  if (!validateEvaluationInput(evaluationInput)) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_evaluation_input_invalid",
      "the supplied evaluation input is schema-invalid",
      { diagnostics: structuredClone(validateEvaluationInput.errors) }
    );
  }
  const referenceRoles = new Set((profile.reference_roles ?? []).map(({ role }) => role));
  const numberRoles = new Set((profile.number_roles ?? []).map(({ role }) => role));
  for (const binding of evaluationInput.reference_bindings) {
    if (referenceByRole.has(binding.role)) diagnostics.push({
      code: "duplicate_reference_role_binding", role: binding.role
    });
    else referenceByRole.set(binding.role, [...binding.reference_ids].sort(compareCodeUnits));
    if (!referenceRoles.has(binding.role)) diagnostics.push({
      code: "unknown_reference_role_binding", role: binding.role
    });
  }
  for (const binding of evaluationInput.number_bindings ?? []) {
    if (numberByRole.has(binding.role)) diagnostics.push({
      code: "duplicate_number_role_binding", role: binding.role
    });
    else numberByRole.set(binding.role, binding.value);
    if (!numberRoles.has(binding.role)) diagnostics.push({
      code: "unknown_number_role_binding", role: binding.role
    });
  }
  diagnostics.sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
  return { diagnostics, referenceByRole, numberByRole };
}

function referenceRoleResult(role, contract, suppliedIds) {
  const compatible = contract.references.filter((reference) =>
    role.allowed_type_terms.includes(reference.type_term) &&
    (!role.allowed_identity_kinds ||
      role.allowed_identity_kinds.includes(reference.identity.kind))
  ).sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id))
    .map((reference) => ({
      reference_id: reference.reference_id,
      type_term: reference.type_term,
      identity_kind: reference.identity.kind,
      compatibility: {
        type_compatible: true,
        identity_kind_compatible: true
      }
    }));
  const byId = new Map(contract.references.map((reference) => [
    reference.reference_id, reference
  ]));
  const supplied = suppliedReferenceRoleResult(role, byId, suppliedIds);
  const status = suppliedIds !== null
    ? supplied.status
    : compatible.length === 1 ? "one_compatible_candidate"
    : compatible.length > 1 ? "ambiguous" : "unbound";
  return {
    role: role.role,
    allowed_type_terms: sortedUnique(role.allowed_type_terms),
    allowed_identity_kinds: sortedUnique(role.allowed_identity_kinds ?? []),
    cardinality: role.cardinality,
    compatible_candidates: compatible,
    supplied_binding: suppliedIds === null ? null : { reference_ids: suppliedIds },
    status,
    diagnostics: supplied.diagnostics,
    profile_usage: null
  };
}

function referenceCandidateCount(contract, role) {
  return contract.references.filter((reference) =>
    role.allowed_type_terms.includes(reference.type_term) &&
    (!role.allowed_identity_kinds ||
      role.allowed_identity_kinds.includes(reference.identity.kind))).length;
}

function suppliedReferenceRoleResult(role, referencesById, suppliedIds) {
  const diagnostics = [];
  if (suppliedIds !== null) {
    if (!cardinalityValid(role.cardinality, suppliedIds.length)) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      expected: role.cardinality,
      actual: suppliedIds.length
    });
    for (const referenceId of suppliedIds) {
      const reference = referencesById.get(referenceId);
      if (!reference) diagnostics.push({
        code: "reference_role_binding_dangling", reference_id: referenceId
      });
      else {
        if (!role.allowed_type_terms.includes(reference.type_term)) diagnostics.push({
          code: "reference_role_binding_type_mismatch",
          reference_id: referenceId,
          actual_type_term: reference.type_term
        });
        if (role.allowed_identity_kinds &&
            !role.allowed_identity_kinds.includes(reference.identity.kind)) {
          diagnostics.push({
            code: "reference_role_binding_identity_kind_mismatch",
            reference_id: referenceId,
            actual_identity_kind: reference.identity.kind
          });
        }
      }
    }
  }
  return {
    role: role.role,
    status: suppliedIds === null ? "unbound" :
      diagnostics.length === 0 ? "validly_bound" : "incompatible",
    diagnostics: canonicalValue(diagnostics)
  };
}

function numberCandidates(contract, role, { start = 0, end = Infinity } = {}) {
  const occurrences = new Map();
  for (const proposition of contract.propositions) {
    for (const operand of proposition.operands) {
      if (operand.kind !== "number" || !("value" in operand)) continue;
      const value = Object.is(operand.value, -0) ? 0 : operand.value;
      const compatible = (role.number_type !== "integer" || Number.isInteger(value)) &&
        (role.minimum === undefined || value >= role.minimum) &&
        (role.maximum === undefined || value <= role.maximum);
      if (!compatible) continue;
      const key = JSON.stringify(value);
      const prior = occurrences.get(key) ?? { value, proposition_ids: [] };
      prior.proposition_ids.push(proposition.proposition_id);
      occurrences.set(key, prior);
    }
  }
  return [...occurrences.values()].sort((left, right) => left.value - right.value)
    .slice(start, end).map((candidate) => ({
    value: candidate.value,
    proposition_ids: sortedUnique(candidate.proposition_ids),
    compatibility: {
      number_type_compatible: true,
      minimum_compatible: true,
      maximum_compatible: true
    }
  }));
}

function numberRoleResult(role, contract, suppliedValue) {
  const candidates = numberCandidates(contract, role);
  const supplied = suppliedNumberRoleResult(role, suppliedValue);
  const status = suppliedValue !== null
    ? supplied.status
    : candidates.length === 1 ? "one_compatible_candidate"
    : candidates.length > 1 ? "ambiguous" : "unbound";
  return {
    role: role.role,
    cardinality: role.cardinality,
    number_type: role.number_type,
    minimum: role.minimum ?? null,
    maximum: role.maximum ?? null,
    compatible_candidates: candidates,
    supplied_binding: suppliedValue === null ? null : { value: suppliedValue },
    status,
    diagnostics: supplied.diagnostics,
    profile_usage: null
  };
}

function suppliedNumberRoleResult(role, suppliedValue) {
  const diagnostics = [];
  if (suppliedValue !== null) {
    const reasons = [];
    if (role.number_type === "integer" && !Number.isInteger(suppliedValue)) {
      reasons.push("not_integer");
    }
    if (role.minimum !== undefined && suppliedValue < role.minimum) {
      reasons.push("below_minimum");
    }
    if (role.maximum !== undefined && suppliedValue > role.maximum) {
      reasons.push("above_maximum");
    }
    if (reasons.length > 0) diagnostics.push({
      code: "number_role_binding_value_incompatible", reasons
    });
  }
  return {
    role: role.role,
    status: suppliedValue === null ? "unbound" :
      diagnostics.length === 0 ? "validly_bound" : "incompatible",
    diagnostics
  };
}

async function bindingInspectionContext(input) {
  const authoring = describeProofPackAuthoring({
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    requestedIntents: input.requestedIntents
  });
  const pack = await loadExactBindingPack(input);
  const bindings = bindingMaps(input.evaluationInput, pack.profile);
  const roles = [
    ...(pack.profile.reference_roles ?? []).map((role) => {
      const supplied = bindings.referenceByRole.has(role.role)
        ? bindings.referenceByRole.get(role.role) : null;
      const checked = suppliedReferenceRoleResult(role,
        new Map(input.contract.references.map((reference) =>
          [reference.reference_id, reference])), supplied);
      const candidateCount = referenceCandidateCount(input.contract, role);
      return { kind: "reference", role, supplied, checked, candidateCount,
        status: supplied === null ? candidateCount === 1 ? "one_compatible_candidate" :
          candidateCount > 1 ? "ambiguous" : "unbound" : checked.status };
    }),
    ...(pack.profile.number_roles ?? []).map((role) => {
      const supplied = bindings.numberByRole.has(role.role)
        ? bindings.numberByRole.get(role.role) : null;
      const checked = suppliedNumberRoleResult(role, supplied);
      const candidateCount = numberCandidates(input.contract, role).length;
      return { kind: "number", role, supplied, checked, candidateCount,
        status: supplied === null ? candidateCount === 1 ? "one_compatible_candidate" :
          candidateCount > 1 ? "ambiguous" : "unbound" : checked.status };
    })
  ].sort((left, right) => compareCodeUnits(
    `${left.kind}\0${left.role.role}`, `${right.kind}\0${right.role.role}`
  ));
  const invalidCount = roles.filter(({ status }) => status === "incompatible").length +
    bindings.diagnostics.length;
  const summary = {
    reference_role_count: roles.filter(({ kind }) => kind === "reference").length,
    number_role_count: roles.filter(({ kind }) => kind === "number").length,
    incompatible_binding_count: invalidCount,
    status: input.evaluationInput === null ? "not_supplied" :
      invalidCount === 0 && roles.every(({ status }) => status === "validly_bound")
        ? "valid" : "invalid"
  };
  const digests = {
    contract: canonicalDigest(normalizeContractForIdentity(input.contract)),
    evaluation_input: input.evaluationInput === null ? null : canonicalDigest(
      normalizeEvaluationInputForIdentity(input.evaluationInput)),
    profile: pack.profile_digest,
    admission: pack.admission_digest,
    authoring_projection: authoring.projection_digest,
    catalog: PROOF_INTENT_DIGESTS.catalog,
    vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
    profile_population: PROOF_INTENT_DIGESTS.profiles,
    intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
  };
  return { authoring, pack, bindings, roles, summary, digests };
}

function descriptorDetail(descriptor, profile) {
  if (descriptor.kind === "reference") {
    return canonicalValue({ role: descriptor.role.role,
      allowed_type_terms: sortedUnique(descriptor.role.allowed_type_terms),
      allowed_identity_kinds: sortedUnique(descriptor.role.allowed_identity_kinds ?? []),
      cardinality: descriptor.role.cardinality,
      supplied_binding: descriptor.supplied === null ? null :
        { reference_ids: descriptor.supplied }, status: descriptor.status,
      diagnostics: descriptor.checked.diagnostics,
      profile_usage: profileUsesRole(profile, descriptor.role.role) });
  }
  return canonicalValue({ role: descriptor.role.role,
    cardinality: descriptor.role.cardinality, number_type: descriptor.role.number_type,
    minimum: descriptor.role.minimum ?? null, maximum: descriptor.role.maximum ?? null,
    supplied_binding: descriptor.supplied === null ? null :
      { value: descriptor.supplied }, status: descriptor.status,
    diagnostics: descriptor.checked.diagnostics,
    profile_usage: profileUsesRole(profile, descriptor.role.role) });
}

function descriptorCandidates(descriptor, contract, start, end) {
  if (descriptor.kind === "number") return numberCandidates(contract, descriptor.role, { start, end });
  return contract.references.filter((reference) =>
    descriptor.role.allowed_type_terms.includes(reference.type_term) &&
    (!descriptor.role.allowed_identity_kinds ||
      descriptor.role.allowed_identity_kinds.includes(reference.identity.kind)))
    .sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id))
    .slice(start, end)
    .map((reference) => ({ reference_id: reference.reference_id,
      type_term: reference.type_term, identity_kind: reference.identity.kind,
      compatibility: { type_compatible: true, identity_kind_compatible: true } }));
}

async function inspectProofPackBindingsPage(request, ...unexpectedArguments) {
  const input = validatePageRequest(request, unexpectedArguments);
  const context = await bindingInspectionContext(input);
  const names = new Set(context.roles.map(({ role }) => role.role));
  const knownStatuses = new Set(context.roles.map(({ status }) => status));
  const unmatchedRoles = input.roles.filter((role) => !names.has(role));
  const unmatchedStatuses = input.statuses.filter((status) => !knownStatuses.has(status));
  const selected = context.roles.filter(({ role, status }) =>
    (input.roles.length === 0 || input.roles.includes(role.role)) &&
    (input.statuses.length === 0 || input.statuses.includes(status)));
  const matchedCount = context.bindings.diagnostics.length + selected.reduce(
    (count, descriptor) => count + 1 + descriptor.candidateCount, 0);
  const totalCount = matchedCount + unmatchedRoles.length + unmatchedStatuses.length;
  if (input.offset > totalCount) throw new ProofPackBindingAssistanceError(
    "proof_pack_binding_page_invalid", "binding page offset exceeds its population"
  );
  const leadingItems = [
    ...context.bindings.diagnostics.map((diagnostic) =>
      ({ kind: "evaluation_input_diagnostic", diagnostic })),
    ...unmatchedRoles.map((selector) => ({ kind: "unmatched_role_selector", selector })),
    ...unmatchedStatuses.map((selector) => ({ kind: "unmatched_status_selector", selector }))
  ];
  const items = []; let position = 0;
  const include = (item) => {
    if (position >= input.offset && items.length < input.maximumItems) items.push(item);
    position += 1;
  };
  for (const item of leadingItems) include(item);
  for (const descriptor of selected) {
    if (position >= input.offset && items.length < input.maximumItems) items.push({ kind: descriptor.kind, role: descriptor.role.role, detail: descriptorDetail(descriptor, context.pack.profile) }); position += 1;
    const pageEnd = input.offset + input.maximumItems;
    if (position < pageEnd && position + descriptor.candidateCount > input.offset) {
      const start = Math.max(0, input.offset - position);
      const end = Math.min(descriptor.candidateCount, pageEnd - position);
      const candidates = descriptorCandidates(descriptor, input.contract, start, end);
      position += start;
      for (const candidate of candidates) include({
        kind: `${descriptor.kind}_candidate`, role: descriptor.role.role, candidate
      });
      position += descriptor.candidateCount - end;
    } else position += descriptor.candidateCount;
    if (items.length >= input.maximumItems && position >= pageEnd) {

      continue;
    }
  }
  const roleIndex = context.roles.map(({ kind, role, status, candidateCount }) =>
    ({ kind, role: role.role, status, compatible_candidate_count: candidateCount }));
  const identityBody = canonicalValue({
    profile_id: input.profileId, profile_version: input.profileVersion,
    requested_intents: context.authoring.requested_intents,
    summary: context.summary, role_index: roleIndex,
    evaluation_input_diagnostics: context.bindings.diagnostics,
    source_digests: context.digests
  });
  return deepFreeze(canonicalValue({
    schema_version: "controlled-contract-proof-pack-binding-page.v1",
    profile_id: input.profileId, profile_version: input.profileVersion,
    requested_intents: context.authoring.requested_intents,
    authority: "non_authoritative", summary: context.summary,
    counts: {
      supplied: context.roles.filter(({ supplied }) => supplied !== null).length,
      missing: context.roles.filter(({ status }) =>
        ["unbound", "one_compatible_candidate"].includes(status)).length,
      ambiguous: context.roles.filter(({ status }) => status === "ambiguous").length,
      incompatible: context.roles.filter(({ status }) => status === "incompatible").length
    },
    role_index: roleIndex,
    evaluation_input_diagnostics: context.bindings.diagnostics,
    selection: { roles: input.roles, statuses: input.statuses,
      unmatched_role_count: unmatchedRoles.length,
      unmatched_status_count: unmatchedStatuses.length },
    population: { total_count: totalCount, matched_count: matchedCount,
      offset: input.offset, returned_count: items.length,
      omitted_count: totalCount - items.length,
      remaining_count: totalCount - input.offset - items.length },
    items, digests: { ...context.digests, result: canonicalDigest(identityBody) },
    binding_selected: false, binding_written: false,
    semantic_truth_inferred: false
  }));
}

async function validateSuppliedProofPackBindings(request, ...unexpectedArguments) {
  const input = validateBindingInputRequest(request, unexpectedArguments);
  const pack = await loadExactBindingPack(input);
  const bindings = bindingMaps(input.evaluationInput, pack.profile);
  const referencesById = new Map(input.contract.references.map((reference) => [
    reference.reference_id, reference
  ]));
  const referenceRoles = (pack.profile.reference_roles ?? []).map((role) =>
    suppliedReferenceRoleResult(
      role,
      referencesById,
      bindings.referenceByRole.has(role.role)
        ? bindings.referenceByRole.get(role.role) : null
    )
  ).sort((left, right) => compareCodeUnits(left.role, right.role));
  const numberRoles = (pack.profile.number_roles ?? []).map((role) =>
    suppliedNumberRoleResult(
      role,
      bindings.numberByRole.has(role.role)
        ? bindings.numberByRole.get(role.role) : null
    )
  ).sort((left, right) => compareCodeUnits(left.role, right.role));
  const invalidCount = [...referenceRoles, ...numberRoles].filter(
    ({ status }) => status === "incompatible"
  ).length + bindings.diagnostics.length;
  return deepFreeze(canonicalValue({
    reference_roles: referenceRoles,
    number_roles: numberRoles,
    evaluation_input_diagnostics: bindings.diagnostics,
    summary: {
      reference_role_count: referenceRoles.length,
      number_role_count: numberRoles.length,
      incompatible_binding_count: invalidCount,
      status: input.evaluationInput === null ? "not_supplied" :
        invalidCount === 0 && [...referenceRoles, ...numberRoles].every(
          ({ status }) => status === "validly_bound"
        ) ? "valid" : "invalid"
    }
  }));
}

function canonicalProofPackBindingAssistanceJson(result) {
  if (!validateProofPackBindingAssistance(result)) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_result_invalid",
      "canonical serialization requires a schema-valid binding-assistance result",
      { diagnostics: structuredClone(validateProofPackBindingAssistance.errors) }
    );
  }
  const { result_digest: resultDigest, ...body } = result;
  if (resultDigest !== canonicalDigest(body)) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_result_digest_mismatch",
      "binding-assistance result digest does not bind the canonical result body"
    );
  }
  const bytes = canonicalJsonBytes(result, { file: true });
  if (bytes.byteLength > MAX_BINDING_ASSISTANCE_BYTES) {
    throw new ProofPackBindingAssistanceError(
      "proof_pack_binding_result_too_large",
      "binding assistance exceeds its declared UTF-8 byte bound",
      { byte_length: bytes.byteLength, maximum_bytes: MAX_BINDING_ASSISTANCE_BYTES }
    );
  }
  return bytes.toString("utf8");
}

async function inspectProofPackBindings(request, ...unexpectedArguments) {
  const input = validateRequest(request, unexpectedArguments);
  const authoring = describeProofPackAuthoring({
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    requestedIntents: input.requestedIntents
  });
  const pack = await loadExactBindingPack(input);
  const bindings = bindingMaps(input.evaluationInput, pack.profile);
  const referenceRoles = (pack.profile.reference_roles ?? []).map((role) => {
    const supplied = bindings.referenceByRole.has(role.role)
      ? bindings.referenceByRole.get(role.role) : null;
    const result = referenceRoleResult(role, input.contract, supplied);
    result.profile_usage = profileUsesRole(pack.profile, role.role);
    return result;
  }).sort((left, right) => compareCodeUnits(left.role, right.role));
  const numberRoles = (pack.profile.number_roles ?? []).map((role) => {
    const supplied = bindings.numberByRole.has(role.role)
      ? bindings.numberByRole.get(role.role) : null;
    const result = numberRoleResult(role, input.contract, supplied);
    result.profile_usage = profileUsesRole(pack.profile, role.role);
    return result;
  }).sort((left, right) => compareCodeUnits(left.role, right.role));
  const invalidCount = [...referenceRoles, ...numberRoles].filter(
    ({ status }) => status === "incompatible"
  ).length + bindings.diagnostics.length;
  const body = canonicalValue({
    schema_version: "controlled-contract-proof-pack-binding-assistance.v1",
    digest_algorithm: "sha256-canonical-json-v1",
    profile_id: input.profileId,
    profile_version: input.profileVersion,
    requested_intents: [...authoring.requested_intents],
    contract_digest: canonicalDigest(normalizeContractForIdentity(input.contract)),
    evaluation_input_digest: input.evaluationInput === null
      ? null : canonicalDigest(normalizeEvaluationInputForIdentity(
        input.evaluationInput
      )),
    reference_roles: referenceRoles,
    number_roles: numberRoles,
    evaluation_input_diagnostics: bindings.diagnostics,
    summary: {
      reference_role_count: referenceRoles.length,
      number_role_count: numberRoles.length,
      incompatible_binding_count: invalidCount,
      status: input.evaluationInput === null ? "not_supplied" :
        invalidCount === 0 && [...referenceRoles, ...numberRoles].every(
          ({ status }) => status === "validly_bound"
        ) ? "valid" : "invalid"
    },
    source_digests: {
      catalog: PROOF_INTENT_DIGESTS.catalog,
      vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
      profile_population: PROOF_INTENT_DIGESTS.profiles,
      intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact,
      profile: pack.profile_digest,
      admission: pack.admission_digest,
      authoring_projection: authoring.projection_digest
    },
    binding_selected: false,
    binding_written: false,
    semantic_truth_inferred: false,
    authority: "non_authoritative"
  });
  const result = {
    ...body,
    result_digest: canonicalDigest(body)
  };
  canonicalProofPackBindingAssistanceJson(result);
  return deepFreeze(structuredClone(result));
}

export {
  MAX_BINDING_ASSISTANCE_BYTES,
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings,
  inspectProofPackBindingsPage,
  validateSuppliedProofPackBindings,
  validateProofPackBindingAssistance
};
