import {
  GRAPH_SELECTION_TRACE_VERSION
} from "./projected-contract-graph.mjs";

const EVALUATION_STAGES = Object.freeze(["pre_dispatch", "post_delivery"]);
const STAGE_RANK = Object.freeze({ pre_dispatch: 0, post_delivery: 1 });

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function duplicates(values) {
  const seen = new Set();
  const duplicateSet = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateSet.add(value);
    seen.add(value);
  }
  return [...duplicateSet].sort(compareIds);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function compareDiagnostics(left, right) {
  return compareIds(left.code, right.code) || compareIds(canonical(left), canonical(right));
}

function allProfilePatterns(profile) {
  return [
    ...(profile.binding_constraint_patterns ?? []).map((pattern) => ({
      ...pattern,
      pattern_kind: "binding_constraint"
    })),
    ...(profile.reference_binding_patterns ?? []).map((pattern) => ({
      ...pattern,
      pattern_kind: "reference_binding"
    })),
    ...profile.claim_patterns.map((pattern) => ({ ...pattern, pattern_kind: "claim" })),
    ...profile.relation_patterns.map((pattern) => ({ ...pattern, pattern_kind: "relation" })),
    ...profile.collection_patterns.map((pattern) => ({ ...pattern, pattern_kind: "collection" })),
    ...profile.resolver_fact_patterns.map((pattern) => ({
      ...pattern,
      pattern_kind: "resolver_fact"
    })),
    ...profile.evidence_patterns.map((pattern) => ({ ...pattern, pattern_kind: "evidence" }))
  ];
}

function expressionPatternIds(expression) {
  if (expression.pattern) return [expression.pattern];
  const children = expression.all_of ?? expression.any_of ?? [];
  return children.flatMap(expressionPatternIds);
}

function templateRoles(template) {
  return [
    template.subject_role,
    ...template.applicability_context.operand_roles,
    ...template.operands
      .filter(({ kind }) => kind === "reference")
      .map(({ role }) => role)
  ];
}

function templateNumberRoles(template) {
  return template.operands
    .filter(({ kind, value_role: valueRole }) => kind === "number" && valueRole)
    .map(({ value_role: valueRole }) => valueRole);
}

function invalidResult(
  profile,
  input,
  diagnostics,
  { resultVersion, validateRuntimeResult },
  flags = {}
) {
  const result = {
    result_version: resultVersion,
    authority: { kind: "free_tier_local", authoritative: false },
    profile: {
      profile_id: typeof profile?.profile_id === "string" ? profile.profile_id : null,
      profile_version: typeof profile?.profile_version === "string"
        ? profile.profile_version
        : null
    },
    evaluation_stage: EVALUATION_STAGES.includes(input?.evaluation_stage)
      ? input.evaluation_stage
      : null,
    profile_valid: flags.profile_valid ?? false,
    input_valid: flags.input_valid ?? false,
    contract_valid: flags.contract_valid ?? false,
    satisfaction: "invalid",
    satisfaction_trace: null,
    pattern_results: [],
    binding_analysis: {
      unbound_reference_roles: [],
      unbound_number_roles: [],
      reference_roles_without_eligible_candidates: [],
      directly_blocked_pattern_ids: [],
      direct_binding_blockers: [],
      reference_binding_blockers: [],
      downstream_blocked_pattern_ids: []
    },
    ambiguity_analysis: {
      directly_ambiguous_pattern_ids: [],
      downstream_ambiguous_pattern_ids: []
    },
    diagnostics
  };
  if (!validateRuntimeResult(result)) throw new Error(
    `verification profile evaluator emitted an invalid result: ${JSON.stringify(validateRuntimeResult.errors)}`
  );
  return result;
}

function buildReferenceBindings(profile, contract, input) {
  const diagnostics = [];
  const roleById = new Map(profile.reference_roles.map((entry) => [entry.role, entry]));
  const referenceById = new Map(
    contract.references.map((reference) => [reference.reference_id, reference])
  );
  const bindingByRole = new Map();
  for (const role of duplicates(input.reference_bindings.map(({ role }) => role))) {
    diagnostics.push({ code: "duplicate_reference_role_binding", role });
  }
  for (const binding of input.reference_bindings) {
    const role = roleById.get(binding.role);
    if (!role) {
      diagnostics.push({ code: "unknown_reference_role_binding", role: binding.role });
      continue;
    }
    const ids = [...binding.reference_ids].sort(compareIds);
    bindingByRole.set(binding.role, ids);
    if (role.cardinality === "exactly_one" && ids.length !== 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    if (role.cardinality === "one_or_more" && ids.length < 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    if (role.cardinality === "zero_or_one" && ids.length > 1) diagnostics.push({
      code: "reference_role_cardinality_invalid",
      role: binding.role,
      expected: role.cardinality,
      actual: ids.length
    });
    for (const referenceId of ids) {
      const reference = referenceById.get(referenceId);
      if (!reference) diagnostics.push({
        code: "reference_role_binding_dangling",
        role: binding.role,
        reference_id: referenceId
      });
      else {
        if (!role.allowed_type_terms.includes(reference.type_term)) diagnostics.push({
          code: "reference_role_binding_type_mismatch",
          role: binding.role,
          reference_id: referenceId,
          actual_type_term: reference.type_term,
          allowed_type_terms: [...role.allowed_type_terms]
        });
        if (role.allowed_identity_kinds &&
            !role.allowed_identity_kinds.includes(reference.identity.kind)) {
          diagnostics.push({
            code: "reference_role_binding_identity_kind_mismatch",
            role: binding.role,
            reference_id: referenceId,
            actual_identity_kind: reference.identity.kind,
            allowed_identity_kinds: [...role.allowed_identity_kinds]
          });
        }
      }
    }
  }
  const unboundRoles = profile.reference_roles
    .filter(({ role }) => !bindingByRole.has(role))
    .map(({ role }) => role)
    .sort(compareIds);
  const missingRoles = profile.reference_roles
    .filter(({ role, cardinality }) =>
      ["exactly_one", "one_or_more"].includes(cardinality) &&
      !bindingByRole.has(role)
    )
    .map(({ role }) => role)
    .sort(compareIds);
  const rolesWithoutEligibleCandidates = profile.reference_roles
    .filter(({
      role,
      allowed_type_terms: allowedTypeTerms,
      allowed_identity_kinds: allowedIdentityKinds
    }) => {
      if (bindingByRole.has(role)) return false;
      const unavailableReferenceIds = new Set(
        (profile.distinct_reference_role_sets ?? [])
          .filter(({ roles }) => roles.includes(role))
          .flatMap(({ roles }) => roles
            .filter((peerRole) => peerRole !== role)
            .flatMap((peerRole) => bindingByRole.get(peerRole) ?? [])
          )
      );
      return !contract.references.some(({
        reference_id: referenceId,
        type_term: typeTerm,
        identity
      }) =>
        allowedTypeTerms.includes(typeTerm) &&
        (!allowedIdentityKinds || allowedIdentityKinds.includes(identity.kind)) &&
        !unavailableReferenceIds.has(referenceId)
      );
    })
    .map(({ role }) => role)
    .sort(compareIds);
  return {
    bindingByRole,
    diagnostics,
    missingRoles,
    unboundRoles,
    rolesWithoutEligibleCandidates
  };
}

function validateDistinctReferenceBindings(
  profile,
  bindingByRole,
  contract = null,
  referencesEquivalent = null
) {
  const diagnostics = [];
  for (const {
    roles,
    applicability_contexts: explicitApplicabilityContexts
  } of profile.distinct_reference_role_sets ?? []) {
    const referenceIds = roles.map((role) => bindingByRole.get(role)?.[0]);
    if (referenceIds.some((referenceId) => !referenceId)) continue;
    const unconditional = { mode: "unconditional", operand_reference_ids: [] };
    const contextsByKey = new Map([[canonical(unconditional), unconditional]]);
    if (referencesEquivalent) {
      const addResolvedContext = ({ mode, operand_roles: operandRoles }) => {
        const operandReferenceIds = operandRoles.flatMap(
          (role) => bindingByRole.get(role) ?? []
        );
        const context = {
          mode,
          operand_reference_ids: [...new Set(operandReferenceIds)].sort(compareIds)
        };
        contextsByKey.set(canonical(context), context);
      };
      if (explicitApplicabilityContexts) {
        for (const context of explicitApplicabilityContexts) addResolvedContext(context);
      } else {
        const completePopulationRoles = new Set(
          (profile.reference_binding_patterns ?? [])
            .filter(({ comparison }) => comparison === "complete_population")
            .map(({ roles: patternRoles }) => patternRoles[0])
        );
        if (roles.every((role) => completePopulationRoles.has(role))) {
          for (const pattern of profile.reference_binding_patterns ?? []) {
            if (pattern.comparison === "complete_population" &&
                roles.includes(pattern.roles[0])) {
              addResolvedContext(pattern.applicability_context);
            }
          }
          for (const pattern of profile.claim_patterns ?? []) {
            for (const template of [
              pattern.proposition_template,
              pattern.falsifying_proposition_template
            ].filter(Boolean)) {
              if (!["reference:subset_of", "reference:not_subset_of"].includes(
                template.operator
              )) continue;
              const populationRoles = [
                template.subject_role,
                ...template.operands
                  .filter(({ kind }) => kind === "reference")
                  .map(({ role }) => role)
              ];
              if (roles.every((role) => populationRoles.includes(role))) {
                addResolvedContext(template.applicability_context);
              }
            }
          }
        }
      }
    }
    const collapsedContext = [...contextsByKey.entries()]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([, context]) => context)
      .find((context) => referenceIds.some((referenceId, index) =>
        referenceIds.slice(0, index).some((prior) =>
          referencesEquivalent
            ? referencesEquivalent(contract, prior, referenceId, context)
            : prior === referenceId
        )
      ));
    if (collapsedContext) diagnostics.push({
      code: "distinct_reference_roles_collapsed",
      roles: [...roles].sort(compareIds),
      reference_ids: [...new Set(referenceIds)].sort(compareIds),
      equality_normalized: Boolean(referencesEquivalent),
      ...(canonical(collapsedContext) === canonical(unconditional)
        ? {}
        : { applicability_context: collapsedContext })
    });
  }
  return diagnostics;
}

function buildNumberBindings(profile, input) {
  const diagnostics = [];
  const roles = profile.number_roles ?? [];
  const bindings = input.number_bindings ?? [];
  const roleById = new Map(roles.map((entry) => [entry.role, entry]));
  const bindingByRole = new Map();
  for (const role of duplicates(bindings.map(({ role: roleId }) => roleId))) {
    diagnostics.push({ code: "duplicate_number_role_binding", role });
  }
  for (const binding of bindings) {
    const role = roleById.get(binding.role);
    if (!role) {
      diagnostics.push({ code: "unknown_number_role_binding", role: binding.role });
      continue;
    }
    bindingByRole.set(binding.role, binding.value);
    const reasons = [];
    if (role.number_type === "integer" && !Number.isInteger(binding.value)) {
      reasons.push("not_integer");
    }
    if (role.minimum !== undefined && binding.value < role.minimum) {
      reasons.push("below_minimum");
    }
    if (role.maximum !== undefined && binding.value > role.maximum) {
      reasons.push("above_maximum");
    }
    if (reasons.length > 0) diagnostics.push({
      code: "number_role_binding_value_invalid",
      role: binding.role,
      value: binding.value,
      reasons,
      ...(role.number_type ? { number_type: role.number_type } : {}),
      ...(role.minimum !== undefined ? { minimum: role.minimum } : {}),
      ...(role.maximum !== undefined ? { maximum: role.maximum } : {})
    });
  }
  const unboundRoles = roles
    .filter(({ role }) => !bindingByRole.has(role))
    .map(({ role }) => role)
    .sort(compareIds);
  const missingRoles = roles
    .filter(({ role, cardinality }) =>
      cardinality === "exactly_one" && !bindingByRole.has(role)
    )
    .map(({ role }) => role)
    .sort(compareIds);
  return { bindingByRole, diagnostics, missingRoles, unboundRoles };
}

function validateReferenceRoleCountBindings(
  profile,
  referenceBindingByRole,
  numberBindingByRole
) {
  const diagnostics = [];
  for (const {
    reference_role: referenceRole,
    number_role: numberRole
  } of profile.reference_role_count_bindings ?? []) {
    const referenceIds = referenceBindingByRole.get(referenceRole);
    const expectedCount = numberBindingByRole.get(numberRole);
    if (!referenceIds || expectedCount === undefined) continue;
    if (referenceIds.length !== expectedCount) diagnostics.push({
      code: "reference_role_count_binding_mismatch",
      reference_role: referenceRole,
      number_role: numberRole,
      reference_count: referenceIds.length,
      bound_number: expectedCount
    });
  }
  return diagnostics;
}

function resolveTemplate(
  template,
  bindingByRole,
  numberBindingByRole = new Map(),
  allowedEmptyReferenceRoles = new Set()
) {
  const missingReferenceRoles = new Set();
  const missingNumberRoles = new Set();
  const roleValues = (role) => {
    const values = bindingByRole.get(role);
    if (!values || (values.length === 0 && !allowedEmptyReferenceRoles.has(role))) {
      missingReferenceRoles.add(role);
    }
    return values ?? [];
  };
  const subjects = roleValues(template.subject_role);
  const proposition = {
    subject_reference_id: subjects.length === 1 ? subjects[0] : null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles
        .flatMap(roleValues)
    },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return roleValues(operand.role).map(
        (referenceId) => ({ kind: "reference", reference_id: referenceId })
      );
      if (operand.kind === "number" && operand.value_role) {
        if (!numberBindingByRole.has(operand.value_role)) {
          missingNumberRoles.add(operand.value_role);
          return [];
        }
        return [{ kind: "number", value: numberBindingByRole.get(operand.value_role) }];
      }
      return [structuredClone(operand)];
    })
  };
  return {
    proposition,
    missing_reference_roles: [...missingReferenceRoles].sort(compareIds),
    missing_number_roles: [...missingNumberRoles].sort(compareIds)
  };
}

function propositionMatches(proposition, template) {
  const normalizeApplicability = (context) => ({
    mode: context.mode,
    operand_reference_ids: [...new Set(context.operand_reference_ids)].sort(compareIds)
  });
  const normalizeOperands = (operator, operands) => {
    if (operator === "reference:ordered_as") return operands;
    const byCanonicalValue = new Map();
    for (const operand of operands) byCanonicalValue.set(canonical(operand), operand);
    return [...byCanonicalValue]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([, operand]) => operand);
  };
  return proposition?.subject_reference_id === template.subject_reference_id &&
    proposition.operator === template.operator &&
    canonical(normalizeApplicability(proposition.applicability_context)) ===
      canonical(normalizeApplicability(template.applicability_context)) &&
    canonical(normalizeOperands(proposition.operator, proposition.operands)) ===
      canonical(normalizeOperands(template.operator, template.operands));
}

function candidateClaimIds(contract, pattern, resolved, resolvedFalsifier, propositionById) {
  return contract.claims.filter((claim) => {
    if (claim.kind !== pattern.claim_kind) return false;
    if (!pattern.allowed_modalities.includes(claim.modality)) return false;
    if (!propositionMatches(
      propositionById.get(claim.proposition_id),
      resolved.proposition
    )) return false;
    if (pattern.claim_kind !== "verification") return true;
    return pattern.verification_methods.includes(claim.verification_method) &&
      propositionMatches(
        propositionById.get(claim.falsifying_proposition_id),
        resolvedFalsifier.proposition
      );
  }).map(({ claim_id: claimId }) => claimId).sort(compareIds);
}

function evaluateForEachAssociationBindings({
  contract,
  pattern,
  memberReferenceId,
  bindingByRole,
  resultsByPattern,
  propositionById,
  referencesEquivalent
}) {
  const associations = pattern.for_each.association_bindings ?? [];
  const localBindings = new Map();
  const diagnostics = [];
  const associationStatuses = [];
  const oneOrMoreClaimIds = [];

  const associationSelections = [];
  let ambiguous = false;
  for (const [associationIndex, association] of associations.entries()) {
    const selection = {
      association_index: associationIndex,
      associated_role: association.associated_role,
      associated_cardinality: association.associated_cardinality ?? "exactly_one",
      status: "unsatisfied",
      claim_ids: []
    };
    associationSelections.push(selection);
    const closureResult = resultsByPattern.get(
      association.complete_population_pattern_id
    );
    const population = bindingByRole.get(association.associated_role) ?? [];
    const applicabilityReferenceIds = [];
    const missingApplicabilityRoles = [];
    for (const role of association.applicability_context.operand_roles) {
      const values = role === pattern.for_each.member_role
        ? [memberReferenceId]
        : bindingByRole.get(role);
      if (!values || values.length === 0) missingApplicabilityRoles.push(role);
      else applicabilityReferenceIds.push(...values);
    }
    if (closureResult?.status !== "satisfied" ||
        missingApplicabilityRoles.length > 0) {
      const associationStatus = missingApplicabilityRoles.length > 0
        ? "indeterminate" : "unsatisfied";
      associationStatuses.push(associationStatus);
      selection.status = associationStatus;
      diagnostics.push({
        code: "for_each_association_binding_incomplete",
        pattern_id: pattern.pattern_id,
        member_reference_id: memberReferenceId,
        associated_role: association.associated_role,
        complete_population_pattern_id:
          association.complete_population_pattern_id,
        complete_population_status: closureResult?.status ?? null,
        missing_applicability_roles: [...new Set(missingApplicabilityRoles)]
          .sort(compareIds)
      });
      continue;
    }
    const expectedApplicability = {
      mode: association.applicability_context.mode,
      operand_reference_ids: [...new Set(applicabilityReferenceIds)].sort(compareIds)
    };
    const memberScoped = [];
    for (const claim of contract.claims) {
      if (claim.kind !== "evidence" || claim.modality !== "MUST") continue;
      const proposition = propositionById.get(claim.proposition_id);
      if (!proposition || proposition.operator !== association.operator ||
          proposition.operands.length !== 1 ||
          proposition.operands[0].kind !== "reference") continue;
      const actualApplicability = {
        mode: proposition.applicability_context.mode,
        operand_reference_ids: [...new Set(
          proposition.applicability_context.operand_reference_ids
        )].sort(compareIds)
      };
      if (canonical(actualApplicability) !== canonical(expectedApplicability)) continue;
      const actualMember = association.member_position === "subject"
        ? proposition.subject_reference_id
        : proposition.operands[0].reference_id;
      const memberExact = actualMember === memberReferenceId;
      const memberAlias = !memberExact && referencesEquivalent?.(
        contract,
        actualMember,
        memberReferenceId,
        expectedApplicability
      );
      if (!memberExact && !memberAlias) continue;
      const endpoint = association.associated_position === "subject"
        ? proposition.subject_reference_id
        : proposition.operands[0].reference_id;
      const exactPopulationMember = population.includes(endpoint);
      const aliasPopulationMembers = exactPopulationMember ? [] : population.filter(
        (populationMember) => referencesEquivalent?.(
          contract,
          endpoint,
          populationMember,
          expectedApplicability
        )
      );
      memberScoped.push({
        claim_id: claim.claim_id,
        endpoint_reference_id: endpoint,
        member_exact: memberExact,
        endpoint_exact: exactPopulationMember,
        alias_population_reference_ids: aliasPopulationMembers.sort(compareIds)
      });
    }
    memberScoped.sort((left, right) => compareIds(left.claim_id, right.claim_id));
    const associatedCardinality = association.associated_cardinality ?? "exactly_one";
    const valid = memberScoped.filter(({ member_exact: memberExact,
      endpoint_exact: endpointExact }) => memberExact && endpointExact);
    const invalid = memberScoped.filter(({ member_exact: memberExact,
      endpoint_exact: endpointExact }) => !memberExact ||
        (associatedCardinality === "exactly_one" && !endpointExact));
    let associationStatus = "satisfied";
    if (invalid.length > 0 || valid.length === 0) associationStatus = "unsatisfied";
    else if (associatedCardinality === "exactly_one" && valid.length > 1) {
      associationStatus = "indeterminate";
      ambiguous = true;
    }
    associationStatuses.push(associationStatus);
    selection.status = associationStatus;
    if (associationStatus === "satisfied") {
      localBindings.set(association.associated_role, associatedCardinality === "one_or_more"
        ? [...new Set(valid.map(({ endpoint_reference_id: id }) => id))].sort(compareIds)
        : [valid[0].endpoint_reference_id]);
      selection.claim_ids = [...new Set(associatedCardinality === "one_or_more"
        ? valid.map(({ claim_id: claimId }) => claimId)
        : [valid[0].claim_id])].sort(compareIds);
      if (associatedCardinality === "one_or_more") {
        oneOrMoreClaimIds.push(...valid.map(({ claim_id: claimId }) => claimId));
      }
    }
    diagnostics.push({
      code: "for_each_association_evaluation",
      pattern_id: pattern.pattern_id,
      member_reference_id: memberReferenceId,
      associated_role: association.associated_role,
      operator: association.operator,
      member_position: association.member_position,
      associated_position: association.associated_position,
      complete_population_pattern_id: association.complete_population_pattern_id,
      associated_cardinality: associatedCardinality,
      status: associationStatus,
      matched_claim_ids: valid.map(({ claim_id: claimId }) => claimId),
      invalid_claims: invalid
    });
  }
  const status = associationStatuses.includes("unsatisfied")
    ? "unsatisfied"
    : associationStatuses.includes("indeterminate") ? "indeterminate" : "satisfied";
  return { status, ambiguous, localBindings, diagnostics, associationSelections,
    oneOrMoreClaimIds: [...new Set(oneOrMoreClaimIds)].sort(compareIds) };
}

function patternResult(pattern, status, matchedIds = []) {
  return {
    pattern_id: pattern.pattern_id,
    pattern_kind: pattern.pattern_kind,
    status,
    matched_ids: [...matchedIds].sort(compareIds)
  };
}

function activeAt(pattern, evaluationStage) {
  return STAGE_RANK[pattern.required_by_stage] <= STAGE_RANK[evaluationStage];
}

function unresolvedDependencyStatus(patternIds, resultsByPattern) {
  const statuses = patternIds.map((patternId) =>
    resultsByPattern.get(patternId)?.status ?? "indeterminate"
  );
  return statuses.includes("unsatisfied") ? "unsatisfied" : "indeterminate";
}

function isOrderedSubsequence(requiredMembers, actualMembers) {
  let requiredIndex = 0;
  for (const member of actualMembers) {
    if (member === requiredMembers[requiredIndex]) requiredIndex += 1;
    if (requiredIndex === requiredMembers.length) return true;
  }
  return requiredMembers.length === 0;
}

function isContiguousSubsequence(requiredMembers, actualMembers) {
  if (requiredMembers.length === 0) return true;
  if (requiredMembers.length > actualMembers.length) return false;
  return actualMembers.some((_, start) => canonical(
    actualMembers.slice(start, start + requiredMembers.length)
  ) === canonical(requiredMembers));
}

function expressionKey(expression) {
  if (expression.pattern) return `pattern:${expression.pattern}`;
  const kind = expression.all_of ? "all_of" : "any_of";
  const children = expression[kind].map(expressionKey).sort(compareIds);
  return canonical({
    kind,
    children,
    ...(expression.branch_cardinality
      ? { branch_cardinality: expression.branch_cardinality }
      : {})
  });
}

function expressionPatternRoutes(expression) {
  if (expression.pattern) return [[expression.pattern]];
  if (expression.any_of) return expression.any_of.flatMap(expressionPatternRoutes);
  let routes = [[]];
  for (const child of expression.all_of) {
    const childRoutes = expressionPatternRoutes(child);
    routes = routes.flatMap((route) => childRoutes.map((childRoute) =>
      [...route, ...childRoute]
    ));
  }
  return routes;
}

function evaluateExpressionNode(expression, statusByPattern, diagnostics,
  canonicalizeChildren = false, branchSelectorPatternIds = new Set()) {
  if (expression.pattern) {
    const patternStatus = statusByPattern.get(expression.pattern) ?? "indeterminate";
    const status = patternStatus === "inactive" ? "satisfied" : patternStatus;
    return {
      active: patternStatus !== "inactive",
      trace: {
        kind: "pattern",
        status,
        pattern_id: expression.pattern,
        pattern_status: patternStatus
      }
    };
  }
  const key = expression.all_of ? "all_of" : "any_of";
  const exactOne = key === "any_of" &&
    expression.branch_cardinality === "exactly_one";
  const childExpressions = (canonicalizeChildren || exactOne)
    ? [...expression[key]].sort((left, right) =>
      compareIds(expressionKey(left), expressionKey(right)))
    : expression[key];
  const evaluatedChildren = childExpressions.map((child) =>
    evaluateExpressionNode(child, statusByPattern, diagnostics,
      canonicalizeChildren || exactOne, branchSelectorPatternIds)
  );
  const activeChildren = evaluatedChildren.filter(({ active }) => active);
  const results = activeChildren.map(({ trace }) => trace.status);
  let status;
  if (activeChildren.length === 0) {
    status = "satisfied";
  } else if (key === "all_of") {
    if (results.includes("unsatisfied")) status = "unsatisfied";
    else if (results.includes("indeterminate")) status = "indeterminate";
    else status = "satisfied";
  } else if (exactOne) {
    const selectorBranches = childExpressions.map((child, index) => ({
      index,
      selected: expressionPatternRoutes(child).some((route) => {
        const selectors = route.filter((patternId) =>
          branchSelectorPatternIds.has(patternId)
        );
        return selectors.length > 0 && selectors.every((patternId) =>
          statusByPattern.get(patternId) === "satisfied"
        );
      })
    }));
    const selectedBranches = selectorBranches.filter(({ selected }) => selected);
    const satisfiedCount = results.filter((result) => result === "satisfied").length;
    const indeterminateCount = results.filter(
      (result) => result === "indeterminate"
    ).length;
    const ambiguousCount = selectedBranches.length > 0
      ? selectedBranches.length
      : satisfiedCount;
    if (ambiguousCount > 1) {
      status = "unsatisfied";
      diagnostics.push({
        code: "satisfaction_branch_ambiguous",
        selected_branch_count: ambiguousCount
      });
    } else if (selectedBranches.length === 1) {
      status = evaluatedChildren[selectedBranches[0].index].trace.status;
    } else if (satisfiedCount === 1 && indeterminateCount === 0) {
      status = "satisfied";
    } else if (satisfiedCount === 0 && indeterminateCount === 0) {
      status = "unsatisfied";
    } else {
      status = "indeterminate";
    }
  } else if (results.includes("satisfied")) {
    status = "satisfied";
  } else if (results.includes("indeterminate")) {
    status = "indeterminate";
  } else {
    status = "unsatisfied";
  }
  return {
    active: activeChildren.length > 0,
    trace: {
      kind: key,
      status,
      children: evaluatedChildren.map(({ trace }) => trace)
    }
  };
}

function evaluateExpressionTrace(expression, statusByPattern, diagnostics = [],
  branchSelectorPatternIds = new Set()) {
  return evaluateExpressionNode(
    expression, statusByPattern, diagnostics, false, branchSelectorPatternIds
  ).trace;
}

function patternBranchPaths(expression) {
  const paths = new Map();
  const visit = (node, path, depth) => {
    if (node.pattern) {
      const current = paths.get(node.pattern) ?? [];
      current.push(path);
      paths.set(node.pattern, current);
      return;
    }
    const key = node.all_of ? "all_of" : "any_of";
    const operator = key === "any_of" && node.branch_cardinality === "exactly_one"
      ? "exactly_one" : key;
    const children = operator === "exactly_one"
      ? [...node[key]].sort((left, right) => compareIds(
          expressionKey(left), expressionKey(right)
        ))
      : node[key];
    children.forEach((child, branchPosition) => visit(child, [...path, {
      gate_depth: depth,
      gate_operator: operator,
      branch_position: branchPosition
    }], depth + 1));
  };
  visit(expression, [], 0);
  for (const [patternId, values] of paths) paths.set(patternId, values
    .map((value) => structuredClone(value))
    .sort((left, right) => compareIds(
      JSON.stringify(left), JSON.stringify(right)
    )));
  return paths;
}

function iterationMemberPositions(pattern) {
  const role = pattern.for_each.member_role;
  const positions = [];
  const collect = (template) => {
    if (!template) return;
    if (template.subject_role === role) positions.push({
      position_kind: "subject", position: 0
    });
    (template.operands ?? []).forEach((operand, position) => {
      if (operand.kind === "reference" && operand.role === role) positions.push({
        position_kind: "operand", position
      });
    });
    (template.applicability_context?.operand_roles ?? []).forEach(
      (operandRole, position) => {
        if (operandRole === role) positions.push({
          position_kind: "applicability_operand", position
        });
      }
    );
  };
  collect(pattern.proposition_template);
  collect(pattern.falsifying_proposition_template);
  const unique = new Map(positions.map((entry) => [JSON.stringify(entry), entry]));
  return [...unique.values()].sort((left, right) => {
    const rank = { subject: 0, operand: 1, applicability_operand: 2 };
    return rank[left.position_kind] - rank[right.position_kind] ||
      left.position - right.position;
  });
}

function resolveIterationCompletePopulation(profile, pattern, resultsByPattern,
  bindingByRole) {
  const declared = pattern.for_each.complete_population_pattern_id;
  const candidates = (profile.reference_binding_patterns ?? []).filter((candidate) =>
    candidate.comparison === "complete_population" &&
    candidate.roles?.[1] === pattern.for_each.population_role &&
    (declared === undefined || candidate.pattern_id === declared)
  );
  if (candidates.length !== 1) return null;
  const [completePattern] = candidates;
  const populationReferenceId = bindingByRole.get(completePattern.roles[0])?.[0];
  const result = resultsByPattern.get(completePattern.pattern_id);
  if (typeof populationReferenceId !== "string" || !result) return null;
  return {
    resolution_status: declared === undefined
      ? "resolved_unique_by_population_role" : "declared",
    pattern: completePattern,
    population_reference_id: populationReferenceId,
    result
  };
}

function evaluateVerificationProfileWithRuntime(
  { contract, profile, evaluation_input: input },
  {
    resultVersion,
    validateProfile,
    validateProfileSemanticsForRuntime,
    validateEvaluationInput,
    validateContract,
    purposeMatchedCollectionsAreCandidates = false,
    completePopulationBindingEvaluator = null,
    referencesEquivalent = null,
    normalizeReference = null,
    allowIteratedRelations = false,
    allowIteratedCollections = false,
    allowBindingPresenceConstraints = false,
    allowExplicitEmptyReferenceBindings = false,
    globalRequiredBindingsAffectSatisfaction = false,
    graphSelectionSink = null,
    validateRuntimeResult
  } = {}
) {
  const requiredRuntimeOptions = {
    resultVersion,
    validateProfile,
    validateProfileSemanticsForRuntime,
    validateEvaluationInput,
    validateContract,
    validateRuntimeResult
  };
  for (const [name, value] of Object.entries(requiredRuntimeOptions)) {
    const valid = name === "resultVersion"
      ? typeof value === "string" && value.length > 0
      : typeof value === "function";
    if (!valid) throw new TypeError(`verification profile runtime option ${name} is required`);
  }
  const invalid = (diagnostics, flags = {}) => invalidResult(
    profile,
    input,
    diagnostics,
    { resultVersion, validateRuntimeResult },
    flags
  );
  const recordGraphSelection = typeof graphSelectionSink === "function"
    ? (record) => graphSelectionSink({
        trace_version: GRAPH_SELECTION_TRACE_VERSION, ...record
      })
    : () => {};
  const branchPathsByPattern = patternBranchPaths(profile.satisfaction_expression);
  const iterationPositionByPattern = new Map(profile.claim_patterns
    .filter(({ for_each: forEach }) => forEach)
    .map((pattern) => ({
      pattern_id: pattern.pattern_id,
      branch_paths: branchPathsByPattern.get(pattern.pattern_id) ?? []
    }))
    .sort((left, right) => compareIds(left.pattern_id, right.pattern_id) ||
      compareIds(
        JSON.stringify(left.branch_paths), JSON.stringify(right.branch_paths)
      ))
    .map((entry, position) => [entry.pattern_id, position]));
  const recordLegacyAssociationIteration = (pattern, memberReferenceIds, vacuous) => {
    const associations = pattern.for_each?.association_bindings ?? [];
    if (associations.length === 0) return;
    recordGraphSelection({
      trace_point: "for_each_association_iteration",
      pattern_id: pattern.pattern_id,
      member_reference_ids: [...memberReferenceIds],
      association_count: associations.length,
      iteration_vacuous: vacuous
    });
  };
  const beginUniversalIteration = (pattern, completePopulation, memberReferenceIds) => {
    if (completePopulation === null) return null;
    const branchPaths = branchPathsByPattern.get(pattern.pattern_id) ?? [];
    const memberPositions = iterationMemberPositions(pattern);
    const iteration = {
      iteration_position: iterationPositionByPattern.get(pattern.pattern_id),
      pattern_id: pattern.pattern_id,
      pattern_kind: "claim",
      branch_paths: branchPaths,
      population_role: pattern.for_each.population_role,
      population_reference_id: completePopulation.population_reference_id,
      member_reference_ids: [...memberReferenceIds],
      complete_population_status: completePopulation.resolution_status,
      complete_population_pattern_id: completePopulation.pattern.pattern_id,
      complete_population_result: structuredClone(completePopulation.result),
      member_role: pattern.for_each.member_role,
      member_positions: memberPositions,
      iteration_quantifier: pattern.for_each.quantifier ?? "bound_population",
      empty_behavior: pattern.for_each.empty_behavior ?? "not_vacuous",
      association_count: pattern.for_each.association_bindings?.length ?? 0,
      occurrence_count: 0
    };
    recordGraphSelection({ trace_point: "for_each_iteration_begin", ...iteration });
    return iteration;
  };
  const recordUniversalOccurrence = (pattern, iteration, memberReferenceId, status,
    claimIds, associationSelections) => {
    if (iteration === null) return;
    const memberOccurrencePosition = iteration.occurrence_count;
    iteration.occurrence_count += 1;
    recordGraphSelection({
      trace_point: "for_each_member_occurrence",
      iteration_position: iteration.iteration_position,
      pattern_id: iteration.pattern_id,
      member_occurrence_position: memberOccurrencePosition,
      member_reference_id: memberReferenceId,
      member_role: iteration.member_role,
      member_positions: iteration.member_positions,
      selection_status: status === "satisfied" ? "selected"
        : status === "indeterminate" ? "ambiguous" : "not_satisfied",
      node_kind: "claim",
      node_ids: [...claimIds]
    });
    for (const selection of associationSelections) recordGraphSelection({
      trace_point: "for_each_association_binding",
      iteration_position: iteration.iteration_position,
      pattern_id: iteration.pattern_id,
      member_occurrence_position: memberOccurrencePosition,
      member_reference_id: memberReferenceId,
      association_index: selection.association_index,
      member_role: iteration.member_role,
      member_position: pattern.for_each.association_bindings[
        selection.association_index
      ].member_position,
      associated_role: selection.associated_role,
      associated_position: pattern.for_each.association_bindings[
        selection.association_index
      ].associated_position,
      associated_cardinality: selection.associated_cardinality,
      association_status: selection.status,
      node_kind: "claim",
      node_ids: [...selection.claim_ids]
    });
  };
  const endUniversalIteration = (iteration, memberCount, vacuous) => {
    if (iteration === null) return;
    recordGraphSelection({
      trace_point: "for_each_iteration_end",
      iteration_position: iteration.iteration_position,
      pattern_id: iteration.pattern_id,
      member_count: memberCount,
      occurrence_count: iteration.occurrence_count,
      association_count: iteration.association_count * memberCount,
      iteration_vacuous: vacuous,
      completion_status: "complete"
    });
  };
  if (!validateProfile(profile)) return invalid([{
    code: "verification_profile_schema_invalid",
    errors: structuredClone(validateProfile.errors)
  }]);
  const profileDiagnostics = validateProfileSemanticsForRuntime(profile);
  if (profileDiagnostics.length > 0) return invalid(
    profileDiagnostics,
    { profile_valid: false }
  );
  if (!validateEvaluationInput(input)) return invalid([{
    code: "verification_profile_input_schema_invalid",
    errors: structuredClone(validateEvaluationInput.errors)
  }], { profile_valid: true });
  if (!profile.evaluation_stages.includes(input.evaluation_stage)) return invalid(
    [{ code: "profile_stage_not_supported", evaluation_stage: input.evaluation_stage }],
    { profile_valid: true, input_valid: true }
  );
  const contractEvaluation = validateContract(contract);
  if (!contractEvaluation.schema_valid || contractEvaluation.diagnostics.length > 0) {
    return invalid([{
      code: "controlled_contract_invalid",
      schema_errors: contractEvaluation.schema_errors,
      diagnostics: contractEvaluation.diagnostics
    }], { profile_valid: true, input_valid: true });
  }

  const claimPatternIds = new Set(
    profile.claim_patterns.map(({ pattern_id }) => pattern_id)
  );
  const iteratedClaimPatternIds = new Set(
    profile.claim_patterns.filter(({ for_each: forEach }) => forEach)
      .map(({ pattern_id: patternId }) => patternId)
  );
  const inputSemanticDiagnostics = [];
  for (const patternId of duplicates(
    input.claim_pattern_bindings.map(({ pattern_id }) => pattern_id)
  )) inputSemanticDiagnostics.push({
    code: "duplicate_claim_pattern_binding",
    pattern_id: patternId
  });
  for (const bindingEntry of input.claim_pattern_bindings) {
    if (!claimPatternIds.has(bindingEntry.pattern_id)) inputSemanticDiagnostics.push({
      code: "unknown_claim_pattern_binding",
      pattern_id: bindingEntry.pattern_id
    });
    else if (iteratedClaimPatternIds.has(bindingEntry.pattern_id)) {
      inputSemanticDiagnostics.push({
        code: "claim_pattern_binding_iterated_pattern_invalid",
        pattern_id: bindingEntry.pattern_id,
        claim_id: bindingEntry.claim_id
      });
    }
  }
  if (inputSemanticDiagnostics.length > 0) return invalid(
    inputSemanticDiagnostics,
    { profile_valid: true, input_valid: false, contract_valid: true }
  );

  const binding = buildReferenceBindings(profile, contract, input);
  if (binding.diagnostics.length > 0) return invalid(
    binding.diagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const distinctBindingDiagnostics = validateDistinctReferenceBindings(
    profile,
    binding.bindingByRole,
    contract,
    referencesEquivalent
  );
  if (distinctBindingDiagnostics.length > 0) return invalid(
    distinctBindingDiagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const numberBinding = buildNumberBindings(profile, input);
  if (numberBinding.diagnostics.length > 0) return invalid(
    numberBinding.diagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );
  const referenceRoleCountDiagnostics = validateReferenceRoleCountBindings(
    profile,
    binding.bindingByRole,
    numberBinding.bindingByRole
  );
  if (referenceRoleCountDiagnostics.length > 0) return invalid(
    referenceRoleCountDiagnostics,
    { profile_valid: true, input_valid: true, contract_valid: true }
  );

  const allowedEmptyReferenceRoles = new Set((allowExplicitEmptyReferenceBindings
    ? profile.reference_roles : [])
    .filter(({ role, cardinality }) =>
      cardinality === "zero_or_more" &&
      binding.bindingByRole.has(role) &&
      binding.bindingByRole.get(role).length === 0
    )
    .map(({ role }) => role));

  const diagnostics = binding.missingRoles.map((role) => ({
    code: "required_reference_role_unbound",
    role
  }));
  diagnostics.push(...numberBinding.missingRoles.map((role) => ({
    code: "required_number_role_unbound",
    role
  })));
  const claimById = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  const explicitBindings = new Map();
  for (const bindingEntry of input.claim_pattern_bindings) {
    explicitBindings.set(bindingEntry.pattern_id, bindingEntry.claim_id);
  }

  recordGraphSelection({ trace_point: "evaluation_begin" });
  const resultsByPattern = new Map();
  const selectedClaimByPattern = new Map();
  const selectedIterationClaims = [];
  const selectedIterationClaimsByPattern = new Map();
  const vacuousIterationPatternIds = new Set();
  const directlyBlockedPatternIds = new Set();
  const directBindingBlockers = [];
  const referenceBindingBlockers = [];
  const downstreamBlockedPatternIds = new Set();
  const directlyAmbiguousPatternIds = new Set();
  const downstreamAmbiguousPatternIds = new Set();
  for (const originalPattern of profile.binding_constraint_patterns ?? []) {
    const pattern = { ...originalPattern, pattern_kind: "binding_constraint" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const count = pattern.role_kind === "reference"
      ? (binding.bindingByRole.get(pattern.role)?.length ?? 0)
      : (numberBinding.bindingByRole.has(pattern.role) ? 1 : 0);
    const bindingPresent = pattern.role_kind === "reference"
      ? binding.bindingByRole.has(pattern.role)
      : numberBinding.bindingByRole.has(pattern.role);
    const presenceSatisfied = !allowBindingPresenceConstraints ||
      pattern.binding_presence === undefined ||
      (pattern.binding_presence === "required" ? bindingPresent : !bindingPresent);
    const satisfied = presenceSatisfied && count >= (pattern.minimum ?? 0) &&
      (pattern.maximum === undefined || count <= pattern.maximum);
    resultsByPattern.set(pattern.pattern_id, patternResult(
      pattern,
      satisfied ? "satisfied" : "unsatisfied",
      pattern.role_kind === "reference"
        ? (binding.bindingByRole.get(pattern.role) ?? [])
        : (count === 1 ? [`${pattern.role}:${numberBinding.bindingByRole.get(pattern.role)}`] : [])
    ));
    if (!satisfied) diagnostics.push({
      code: "binding_constraint_unsatisfied",
      pattern_id: pattern.pattern_id,
      role_kind: pattern.role_kind,
      role: pattern.role,
      actual_count: count,
      ...(allowBindingPresenceConstraints && pattern.binding_presence !== undefined
        ? {
            actual_binding_presence: bindingPresent ? "present" : "omitted",
            required_binding_presence: pattern.binding_presence
          }
        : {}),
      minimum: pattern.minimum ?? 0,
      maximum: pattern.maximum ?? null
    });
  }
  for (const originalPattern of profile.reference_binding_patterns ?? []) {
    const pattern = { ...originalPattern, pattern_kind: "reference_binding" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const contextualRoles = pattern.applicability_context?.operand_roles ?? [];
    const missingRoles = [...new Set([...pattern.roles, ...contextualRoles])].filter((role) =>
      !binding.bindingByRole.has(role)
    );
    if (missingRoles.length > 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      referenceBindingBlockers.push({
        pattern_id: pattern.pattern_id,
        reference_roles: [...missingRoles].sort(compareIds)
      });
      const deterministicallyAbsent = missingRoles.some((role) =>
        binding.rolesWithoutEligibleCandidates.includes(role)
      );
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, deterministicallyAbsent ? "unsatisfied" : "indeterminate")
      );
      continue;
    }
    if (pattern.comparison === "complete_population") {
      const [populationRole, memberRole] = pattern.roles;
      const populationReferenceId = binding.bindingByRole.get(populationRole)[0];
      const memberReferenceIds = binding.bindingByRole.get(memberRole);
      const populationReference = contract.references.find(
        ({ reference_id: referenceId }) => referenceId === populationReferenceId
      );
      if (!populationReference || !["cc:population", "cc:scope"].includes(
        populationReference.type_term
      )) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "population_binding_reference_type_invalid",
          pattern_id: pattern.pattern_id,
          population_reference_id: populationReferenceId,
          actual_type_term: populationReference?.type_term ?? null,
          allowed_type_terms: ["cc:population", "cc:scope"]
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
        continue;
      }
      if (!completePopulationBindingEvaluator) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "complete_population_binding_evaluator_unavailable",
          pattern_id: pattern.pattern_id
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
        continue;
      }
      const populationEvaluation = completePopulationBindingEvaluator({
        contract,
        population_reference_id: populationReferenceId,
        member_reference_ids: memberReferenceIds,
        applicability_context: {
          mode: pattern.applicability_context.mode,
          operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
            (role) => binding.bindingByRole.get(role)
          )
        }
      });
      diagnostics.push(...populationEvaluation.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        pattern_id: pattern.pattern_id
      })));
      recordGraphSelection({
        trace_point: "complete_population_binding",
        pattern_id: pattern.pattern_id,
        node_kind: "claim",
        node_ids: [...(populationEvaluation.consumed_claim_ids ?? [])]
      });
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        populationEvaluation.satisfied ? "satisfied" : "unsatisfied",
        [populationReferenceId, ...populationEvaluation.normalized_member_reference_ids]
      ));
      continue;
    }
    const referenceIds = pattern.roles.map((role) =>
      binding.bindingByRole.get(role)[0]
    );
    const collapsed = referenceIds.some((referenceId, index) =>
      referenceIds.slice(0, index).some((prior) =>
        referencesEquivalent
          ? referencesEquivalent(
            contract,
            prior,
            referenceId,
            { mode: "unconditional", operand_reference_ids: [] }
          )
          : prior === referenceId
      )
    );
    const satisfied = pattern.comparison === "same_reference"
      ? collapsed
      : !collapsed;
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(
        pattern,
        satisfied ? "satisfied" : "unsatisfied",
        [...new Set(referenceIds)].sort(compareIds)
      )
    );
  }
  for (const originalPattern of profile.claim_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "claim" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    if (pattern.for_each) {
      const populationMembers = binding.bindingByRole.get(
        pattern.for_each.population_role
      ) ?? [];
      const completePopulation = resolveIterationCompletePopulation(
        profile, pattern, resultsByPattern, binding.bindingByRole
      );
      const iteratedMemberIds = [...populationMembers].sort(compareIds);
      const universalIteration = beginUniversalIteration(
        pattern, completePopulation, iteratedMemberIds
      );
      if (populationMembers.length === 0) {
        const explicitlyBound = binding.bindingByRole.has(
          pattern.for_each.population_role
        );
        const closureResult = completePopulation?.result ?? null;
        const iterationBindings = new Map(binding.bindingByRole);
        iterationBindings.set(pattern.for_each.member_role, []);
        const associationRoles = new Set(
          (pattern.for_each.association_bindings ?? []).map(
            ({ associated_role: associatedRole }) => associatedRole
          )
        );
        for (const associatedRole of associationRoles) {
          iterationBindings.set(associatedRole, []);
        }
        const resolved = resolveTemplate(
          pattern.proposition_template,
          iterationBindings,
          numberBinding.bindingByRole,
          allowedEmptyReferenceRoles
        );
        const resolvedFalsifier = pattern.falsifying_proposition_template
          ? resolveTemplate(
            pattern.falsifying_proposition_template,
            iterationBindings,
            numberBinding.bindingByRole,
            allowedEmptyReferenceRoles
          )
          : null;
        const missingNonlocalReferenceRoles = [...new Set([
          ...resolved.missing_reference_roles,
          ...(resolvedFalsifier?.missing_reference_roles ?? [])
        ])].filter((role) =>
          role !== pattern.for_each.member_role && !associationRoles.has(role)
        )
          .sort(compareIds);
        const missingNumberRoles = [...new Set([
          ...resolved.missing_number_roles,
          ...(resolvedFalsifier?.missing_number_roles ?? [])
        ])].sort(compareIds);
        const vacuous = pattern.for_each.quantifier === "universal" &&
          pattern.for_each.empty_behavior === "vacuously_satisfied" &&
          explicitlyBound && closureResult?.status === "satisfied" &&
          missingNonlocalReferenceRoles.length === 0 && missingNumberRoles.length === 0;
        recordLegacyAssociationIteration(pattern, [], vacuous);
        endUniversalIteration(universalIteration, 0, vacuous);
        if (vacuous) {
          vacuousIterationPatternIds.add(pattern.pattern_id);
          resultsByPattern.set(
            pattern.pattern_id,
            patternResult(pattern, "satisfied")
          );
          diagnostics.push({
            code: "for_each_evaluation",
            pattern_id: pattern.pattern_id,
            population_role: pattern.for_each.population_role,
            member_role: pattern.for_each.member_role,
            quantifier: "universal",
            empty_behavior: "vacuously_satisfied",
            vacuously_satisfied: true,
            instance_results: []
          });
          continue;
        }
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: explicitlyBound
            ? "for_each_empty_population_not_vacuously_closed"
            : "for_each_population_empty_or_unbound",
          pattern_id: pattern.pattern_id,
          population_role: pattern.for_each.population_role,
          explicitly_bound: explicitlyBound,
          complete_population_pattern_id:
            pattern.for_each.complete_population_pattern_id ?? null,
          complete_population_status: closureResult?.status ?? null,
          missing_reference_roles: missingNonlocalReferenceRoles,
          missing_number_roles: missingNumberRoles
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(
          pattern,
          explicitlyBound ? "unsatisfied" : "indeterminate"
        ));
        continue;
      }
      const instanceResults = [];
      recordLegacyAssociationIteration(pattern, iteratedMemberIds, false);
      for (const memberReferenceId of iteratedMemberIds) {
        const iterationBindings = new Map(binding.bindingByRole);
        iterationBindings.set(pattern.for_each.member_role, [memberReferenceId]);
        const associationEvaluation = evaluateForEachAssociationBindings({
          contract,
          pattern,
          memberReferenceId,
          bindingByRole: binding.bindingByRole,
          resultsByPattern,
          propositionById,
          referencesEquivalent
        });
        diagnostics.push(...associationEvaluation.diagnostics);
        if (associationEvaluation.status !== "satisfied") {
          instanceResults.push({
            member_reference_id: memberReferenceId,
            status: associationEvaluation.status
          });
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId,
            associationEvaluation.status, [],
            associationEvaluation.associationSelections
          );
          if (associationEvaluation.ambiguous) {
            directlyAmbiguousPatternIds.add(pattern.pattern_id);
          }
          continue;
        }
        for (const [role, values] of associationEvaluation.localBindings) {
          iterationBindings.set(role, values);
        }
        if (associationEvaluation.oneOrMoreClaimIds.length > 0) {
          instanceResults.push({ member_reference_id: memberReferenceId,
            status: "satisfied", claim_id: associationEvaluation.oneOrMoreClaimIds[0],
            claim_ids: associationEvaluation.oneOrMoreClaimIds });
          for (const claimId of associationEvaluation.oneOrMoreClaimIds) {
            selectedIterationClaims.push({ pattern_id: pattern.pattern_id,
              member_reference_id: memberReferenceId, claim_id: claimId });
          }
          if (!selectedIterationClaimsByPattern.has(pattern.pattern_id)) {
            selectedIterationClaimsByPattern.set(pattern.pattern_id, new Map());
          }
          selectedIterationClaimsByPattern.get(pattern.pattern_id).set(
            memberReferenceId, associationEvaluation.oneOrMoreClaimIds[0]
          );
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId, "satisfied",
            associationEvaluation.oneOrMoreClaimIds,
            associationEvaluation.associationSelections
          );
          continue;
        }
        const resolved = resolveTemplate(
          pattern.proposition_template,
          iterationBindings,
          numberBinding.bindingByRole,
          allowedEmptyReferenceRoles
        );
        const resolvedFalsifier = pattern.falsifying_proposition_template
          ? resolveTemplate(
            pattern.falsifying_proposition_template,
            iterationBindings,
            numberBinding.bindingByRole,
            allowedEmptyReferenceRoles
          )
          : null;
        const missingReferenceRoles = [...new Set([
          ...resolved.missing_reference_roles,
          ...(resolvedFalsifier?.missing_reference_roles ?? [])
        ])].sort(compareIds);
        const missingNumberRoles = [...new Set([
          ...resolved.missing_number_roles,
          ...(resolvedFalsifier?.missing_number_roles ?? [])
        ])].sort(compareIds);
        if (missingReferenceRoles.length > 0 || missingNumberRoles.length > 0) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "indeterminate" });
          diagnostics.push({
            code: "for_each_instance_binding_incomplete",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            missing_reference_roles: missingReferenceRoles,
            missing_number_roles: missingNumberRoles
          });
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId, "indeterminate", [],
            associationEvaluation.associationSelections
          );
          continue;
        }
        const candidates = candidateClaimIds(
          contract,
          pattern,
          resolved,
          resolvedFalsifier,
          propositionById
        );
        if (candidates.length === 0) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "unsatisfied" });
          diagnostics.push({
            code: "for_each_instance_claim_missing",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId
          });
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId, "unsatisfied", [],
            associationEvaluation.associationSelections
          );
        } else if (candidates.length > 1) {
          instanceResults.push({ member_reference_id: memberReferenceId, status: "indeterminate" });
          directlyAmbiguousPatternIds.add(pattern.pattern_id);
          diagnostics.push({
            code: "for_each_instance_claim_ambiguous",
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            claim_ids: candidates
          });
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId, "indeterminate",
            candidates, associationEvaluation.associationSelections
          );
        } else {
          instanceResults.push({
            member_reference_id: memberReferenceId,
            status: "satisfied",
            claim_id: candidates[0]
          });
          selectedIterationClaims.push({
            pattern_id: pattern.pattern_id,
            member_reference_id: memberReferenceId,
            claim_id: candidates[0]
          });
          if (!selectedIterationClaimsByPattern.has(pattern.pattern_id)) {
            selectedIterationClaimsByPattern.set(pattern.pattern_id, new Map());
          }
          selectedIterationClaimsByPattern.get(pattern.pattern_id).set(
            memberReferenceId,
            candidates[0]
          );
          recordUniversalOccurrence(
            pattern, universalIteration, memberReferenceId, "satisfied",
            [candidates[0]], associationEvaluation.associationSelections
          );
        }
      }
      endUniversalIteration(universalIteration, iteratedMemberIds.length, false);
      const instanceStatuses = instanceResults.map(({ status }) => status);
      const status = instanceStatuses.includes("unsatisfied")
        ? "unsatisfied"
        : instanceStatuses.includes("indeterminate") ? "indeterminate" : "satisfied";
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        status,
        instanceResults.flatMap(({ claim_id: claimId }) => claimId ? [claimId] : [])
      ));
      diagnostics.push({
        code: "for_each_evaluation",
        pattern_id: pattern.pattern_id,
        population_role: pattern.for_each.population_role,
        member_role: pattern.for_each.member_role,
        ...(pattern.for_each.quantifier ? {
          quantifier: pattern.for_each.quantifier,
          empty_behavior: pattern.for_each.empty_behavior,
          vacuously_satisfied: false
        } : {}),
        instance_results: instanceResults
      });
      continue;
    }
    const resolved = resolveTemplate(
      pattern.proposition_template,
      binding.bindingByRole,
      numberBinding.bindingByRole,
      allowedEmptyReferenceRoles
    );
    const resolvedFalsifier = pattern.falsifying_proposition_template
      ? resolveTemplate(
        pattern.falsifying_proposition_template,
        binding.bindingByRole,
        numberBinding.bindingByRole,
        allowedEmptyReferenceRoles
      )
      : null;
    const missingReferenceRoles = [...new Set([
      ...resolved.missing_reference_roles,
      ...(resolvedFalsifier?.missing_reference_roles ?? [])
    ])].sort(compareIds);
    const missingNumberRoles = [...new Set([
      ...resolved.missing_number_roles,
      ...(resolvedFalsifier?.missing_number_roles ?? [])
    ])].sort(compareIds);
    if (missingReferenceRoles.length > 0 || missingNumberRoles.length > 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      directBindingBlockers.push({
        pattern_id: pattern.pattern_id,
        proposition_reference_roles: resolved.missing_reference_roles,
        proposition_number_roles: resolved.missing_number_roles,
        falsifier_reference_roles: resolvedFalsifier?.missing_reference_roles ?? [],
        falsifier_number_roles: resolvedFalsifier?.missing_number_roles ?? []
      });
      const deterministicallyAbsent = missingReferenceRoles.some((role) =>
        binding.rolesWithoutEligibleCandidates.includes(role)
      );
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, deterministicallyAbsent ? "unsatisfied" : "indeterminate")
      );
      continue;
    }
    const candidates = candidateClaimIds(
      contract,
      pattern,
      resolved,
      resolvedFalsifier,
      propositionById
    );

    const explicitlyBoundClaim = explicitBindings.get(pattern.pattern_id);
    let selected = null;
    if (explicitlyBoundClaim) {
      if (!claimById.has(explicitlyBoundClaim)) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
        diagnostics.push({
          code: "claim_pattern_binding_dangling",
          pattern_id: pattern.pattern_id,
          claim_id: explicitlyBoundClaim
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
        continue;
      }
      if (!candidates.includes(explicitlyBoundClaim)) {
        diagnostics.push({
          code: "claim_pattern_binding_mismatch",
          pattern_id: pattern.pattern_id,
          claim_id: explicitlyBoundClaim
        });
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
        continue;
      }
      selected = explicitlyBoundClaim;
    } else if (candidates.length === 1) {
      [selected] = candidates;
    } else if (candidates.length === 0) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
      continue;
    } else {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "claim_pattern_match_ambiguous",
        pattern_id: pattern.pattern_id,
        claim_ids: candidates
      });
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, "indeterminate", candidates)
      );
      continue;
    }
    selectedClaimByPattern.set(pattern.pattern_id, selected);
    resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "satisfied", [selected]));
  }

  const patternsBySelectedClaim = new Map();
  for (const [patternId, claimId] of selectedClaimByPattern) {
    const patternIds = patternsBySelectedClaim.get(claimId) ?? [];
    patternIds.push(patternId);
    patternsBySelectedClaim.set(claimId, patternIds);
  }
  for (const { pattern_id: patternId, member_reference_id: memberReferenceId, claim_id: claimId }
    of selectedIterationClaims) {
    const patternIds = patternsBySelectedClaim.get(claimId) ?? [];
    patternIds.push(`${patternId}[${memberReferenceId}]`);
    patternsBySelectedClaim.set(claimId, patternIds);
  }
  for (const [claimId, patternIds] of patternsBySelectedClaim) {
    if (patternIds.length < 2) continue;
    diagnostics.push({
      code: "claim_selected_by_multiple_patterns",
      claim_id: claimId,
      pattern_ids: patternIds.sort(compareIds)
    });
    for (const instancePatternId of patternIds) {
      const patternId = instancePatternId.includes("[")
        ? instancePatternId.slice(0, instancePatternId.indexOf("["))
        : instancePatternId;
      directlyAmbiguousPatternIds.add(patternId);
      const current = resultsByPattern.get(patternId);
      resultsByPattern.set(patternId, { ...current, status: "indeterminate" });
      selectedClaimByPattern.delete(patternId);
    }
  }

  const claimPatternById = new Map(profile.claim_patterns.map((pattern) =>
    [pattern.pattern_id, pattern]
  ));
  const relationPatternById = new Map(profile.relation_patterns.map((pattern) =>
    [pattern.pattern_id, pattern]
  ));
  const failedOccurrenceJoinRelationPatternIds = new Set();
  for (const occurrenceBinding of profile.falsifier_occurrence_bindings ?? []) {
    const relation = relationPatternById.get(occurrenceBinding.relation_pattern_id);
    const verification = relation && claimPatternById.get(
      relation.source_claim_pattern_id
    );
    const target = relation && claimPatternById.get(
      relation.target_claim_pattern_id
    );
    if (!relation || !verification || !target ||
        !selectedClaimByPattern.has(verification.pattern_id) ||
        !selectedClaimByPattern.has(target.pattern_id)) continue;
    const targetContext = resolveTemplate(
      target.proposition_template,
      binding.bindingByRole,
      numberBinding.bindingByRole,
      allowedEmptyReferenceRoles
    ).proposition.applicability_context;
    const verificationContext = resolveTemplate(
      verification.proposition_template,
      binding.bindingByRole,
      numberBinding.bindingByRole,
      allowedEmptyReferenceRoles
    ).proposition.applicability_context;
    const falsifierContext = resolveTemplate(
      verification.falsifying_proposition_template,
      binding.bindingByRole,
      numberBinding.bindingByRole,
      allowedEmptyReferenceRoles
    ).proposition.applicability_context;
    const reference_roles = occurrenceBinding.reference_role_joins.map(({ role }) => {
      const raw = binding.bindingByRole.get(role)?.[0] ?? null;
      return {
        role,
        raw_reference_id: raw,
        normalized_target_reference_id: raw && normalizeReference
          ? normalizeReference(contract, raw, targetContext)
          : raw,
        normalized_verification_reference_id: raw && normalizeReference
          ? normalizeReference(contract, raw, verificationContext)
          : raw,
        normalized_falsifier_reference_id: raw && normalizeReference
          ? normalizeReference(contract, raw, falsifierContext)
          : raw
      };
    }).sort((left, right) => compareIds(left.role, right.role));
    const normalizedReferencesMatch = reference_roles.every((joinedRole) =>
      joinedRole.normalized_target_reference_id ===
        joinedRole.normalized_verification_reference_id &&
      joinedRole.normalized_target_reference_id ===
        joinedRole.normalized_falsifier_reference_id
    );
    const contextsBySurface = {
      target: targetContext,
      verification: verificationContext,
      falsifier: falsifierContext
    };
    const positionFieldBySurface = {
      target: "target_positions",
      verification: "verification_positions",
      falsifier: "falsifier_positions"
    };
    const sharedOperandsMatch = Object.entries(contextsBySurface).every(
      ([surface, contextValue]) => {
        const expected = occurrenceBinding.reference_role_joins.filter((join) =>
          join[positionFieldBySurface[surface]].includes("applicability_operand")
        ).flatMap(({ role }) => binding.bindingByRole.get(role) ?? [])
          .map((referenceId) => normalizeReference
            ? normalizeReference(contract, referenceId, contextValue)
            : referenceId)
          .sort(compareIds);
        const actual = contextValue.operand_reference_ids.map((referenceId) =>
          normalizeReference
            ? normalizeReference(contract, referenceId, contextValue)
            : referenceId
        ).sort(compareIds);
        return canonical(expected) === canonical(actual);
      }
    );
    const applicabilityMatches = occurrenceBinding.applicability_join === "exact_scope"
      ? canonical(targetContext) === canonical(verificationContext) &&
        canonical(targetContext) === canonical(falsifierContext)
      : sharedOperandsMatch;
    const satisfied = normalizedReferencesMatch && applicabilityMatches;
    if (!satisfied) {
      failedOccurrenceJoinRelationPatternIds.add(relation.pattern_id);
      diagnostics.push({
        code: "falsifier_occurrence_join_mismatch",
        relation_pattern_id: relation.pattern_id,
        normalized_references_match: normalizedReferencesMatch,
        applicability_matches: applicabilityMatches
      });
    }
    diagnostics.push({
      code: "falsifier_occurrence_join_evaluation",
      relation_pattern_id: relation.pattern_id,
      applicability_join: occurrenceBinding.applicability_join,
      satisfied,
      reference_roles,
      number_roles: occurrenceBinding.number_role_joins.map(({ role }) => ({
        role,
        value: numberBinding.bindingByRole.get(role) ?? null
      })).sort((left, right) => compareIds(left.role, right.role))
    });
  }

  for (const originalPattern of profile.relation_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "relation" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    if (failedOccurrenceJoinRelationPatternIds.has(pattern.pattern_id)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
      continue;
    }
    const sourceIteration = selectedIterationClaimsByPattern.get(
      pattern.source_claim_pattern_id
    );
    const targetIteration = selectedIterationClaimsByPattern.get(
      pattern.target_claim_pattern_id
    );
    const sourceVacuous = vacuousIterationPatternIds.has(
      pattern.source_claim_pattern_id
    );
    const targetVacuous = vacuousIterationPatternIds.has(
      pattern.target_claim_pattern_id
    );
    if (allowIteratedRelations &&
        (sourceIteration || targetIteration || sourceVacuous || targetVacuous)) {
      const sourceGlobal = selectedClaimByPattern.get(
        pattern.source_claim_pattern_id
      );
      const targetGlobal = selectedClaimByPattern.get(
        pattern.target_claim_pattern_id
      );
      const sourceIsIterated = Boolean(sourceIteration || sourceVacuous);
      const targetIsIterated = Boolean(targetIteration || targetVacuous);
      if (!sourceIsIterated && !sourceGlobal || !targetIsIterated && !targetGlobal) {
        const endpointPatternIds = [
          pattern.source_claim_pattern_id,
          pattern.target_claim_pattern_id
        ];
        const status = unresolvedDependencyStatus(endpointPatternIds, resultsByPattern);
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, status));
        continue;
      }
      const memberIds = sourceIsIterated && targetIsIterated
        ? [...new Set([
          ...(sourceIteration?.keys() ?? []),
          ...(targetIteration?.keys() ?? [])
        ])].sort(compareIds)
        : [...(sourceIteration?.keys() ?? targetIteration?.keys() ?? [])]
          .sort(compareIds);
      if (memberIds.length === 0 && sourceVacuous && targetVacuous) {
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "satisfied"));
        diagnostics.push({
          code: "for_each_relation_evaluation",
          pattern_id: pattern.pattern_id,
          vacuously_satisfied: true,
          instance_results: []
        });
        continue;
      }
      if (memberIds.length === 0 && (sourceVacuous || targetVacuous)) {
        resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
        diagnostics.push({
          code: "for_each_relation_mixed_vacuity_invalid",
          pattern_id: pattern.pattern_id,
          source_vacuous: sourceVacuous,
          target_vacuous: targetVacuous
        });
        continue;
      }
      const instanceResults = memberIds.map((memberReferenceId) => {
        const source = sourceIsIterated
          ? sourceIteration?.get(memberReferenceId)
          : sourceGlobal;
        const target = targetIsIterated
          ? targetIteration?.get(memberReferenceId)
          : targetGlobal;
        if (!source || !target) return {
          member_reference_id: memberReferenceId,
          status: "unsatisfied",
          relation_ids: []
        };
        const relationIds = contract.relations.filter((relation) =>
          relation.role === pattern.role && relation.source_claim_id === source &&
          relation.target_claim_id === target
        ).map(({ relation_id: relationId }) => relationId).sort(compareIds);
        return {
          member_reference_id: memberReferenceId,
          status: relationIds.length > 0 ? "satisfied" : "unsatisfied",
          relation_ids: relationIds
        };
      });
      const selectedSourceClaimIds = new Set(sourceIsIterated
        ? [...(sourceIteration?.values() ?? [])]
        : [sourceGlobal]);
      const selectedTargetClaimIds = new Set(targetIsIterated
        ? [...(targetIteration?.values() ?? [])]
        : [targetGlobal]);
      const expectedPairs = new Set(instanceResults.flatMap(
        ({ member_reference_id: memberReferenceId }) => {
          const source = sourceIsIterated
            ? sourceIteration?.get(memberReferenceId)
            : sourceGlobal;
          const target = targetIsIterated
            ? targetIteration?.get(memberReferenceId)
            : targetGlobal;
          return source && target ? [`${source}\0${target}`] : [];
        }
      ));
      const relevantRelations = contract.relations.filter((relation) =>
        relation.role === pattern.role && (
          selectedSourceClaimIds.has(relation.source_claim_id) ||
          selectedTargetClaimIds.has(relation.target_claim_id)
        )
      );
      const relationCountsByPair = new Map();
      for (const relation of relevantRelations) {
        const pair = `${relation.source_claim_id}\0${relation.target_claim_id}`;
        relationCountsByPair.set(pair, (relationCountsByPair.get(pair) ?? 0) + 1);
      }
      const exactRelationPopulation = relevantRelations.length === expectedPairs.size &&
        [...expectedPairs].every((pair) => relationCountsByPair.get(pair) === 1);
      const status = exactRelationPopulation && instanceResults.every(
        ({ status: instanceStatus }) => instanceStatus === "satisfied"
      ) ? "satisfied" : "unsatisfied";
      const unexpectedRelationIds = relevantRelations.filter((relation) =>
        !expectedPairs.has(
          `${relation.source_claim_id}\0${relation.target_claim_id}`
        ) || relationCountsByPair.get(
          `${relation.source_claim_id}\0${relation.target_claim_id}`
        ) !== 1
      ).map(({ relation_id: relationId }) => relationId).sort(compareIds);
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        status,
        relevantRelations.map(({ relation_id: relationId }) => relationId)
      ));
      diagnostics.push({
        code: "for_each_relation_evaluation",
        pattern_id: pattern.pattern_id,
        vacuously_satisfied: false,
        exact_relation_population: exactRelationPopulation,
        expected_relation_count: expectedPairs.size,
        relevant_relation_count: relevantRelations.length,
        unexpected_or_duplicate_relation_ids: unexpectedRelationIds,
        instance_results: instanceResults
      });
      continue;
    }
    const source = selectedClaimByPattern.get(pattern.source_claim_pattern_id);
    const target = selectedClaimByPattern.get(pattern.target_claim_pattern_id);
    if (!source || !target) {
      const endpointPatternIds = [
        pattern.source_claim_pattern_id,
        pattern.target_claim_pattern_id
      ];
      const status = unresolvedDependencyStatus(endpointPatternIds, resultsByPattern);
      if (status === "indeterminate" && endpointPatternIds.some((patternId) =>
        directlyBlockedPatternIds.has(patternId) ||
        downstreamBlockedPatternIds.has(patternId)
      )) {
        downstreamBlockedPatternIds.add(pattern.pattern_id);
      }
      if (status === "indeterminate" && endpointPatternIds.some((patternId) =>
        directlyAmbiguousPatternIds.has(patternId) ||
        downstreamAmbiguousPatternIds.has(patternId)
      )) downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, status));
      continue;
    }
    const matches = contract.relations.filter((relation) =>
      relation.role === pattern.role && relation.source_claim_id === source &&
      relation.target_claim_id === target
    ).map(({ relation_id }) => relation_id).sort(compareIds);
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(pattern, matches.length > 0 ? "satisfied" : "unsatisfied", matches)
    );
  }

  for (const originalPattern of profile.collection_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "collection" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const expandedMemberGroups = pattern.member_claim_pattern_ids.map((patternId) => {
      const iteration = selectedIterationClaimsByPattern.get(patternId);
      if (iteration) return [...iteration.entries()].sort(([left], [right]) =>
        compareIds(left, right)).map(([, claimId]) => claimId);
      if (vacuousIterationPatternIds.has(patternId)) return [];
      const selected = selectedClaimByPattern.get(patternId);
      return selected ? [selected] : null;
    });
    if (expandedMemberGroups.some((members) => members === null)) {
      const status = unresolvedDependencyStatus(
        pattern.member_claim_pattern_ids,
        resultsByPattern
      );
      if (status === "indeterminate" && pattern.member_claim_pattern_ids.some((patternId) =>
        directlyBlockedPatternIds.has(patternId) ||
        downstreamBlockedPatternIds.has(patternId)
      )) downstreamBlockedPatternIds.add(pattern.pattern_id);
      if (status === "indeterminate" && pattern.member_claim_pattern_ids.some((patternId) =>
        directlyAmbiguousPatternIds.has(patternId) ||
        downstreamAmbiguousPatternIds.has(patternId)
      )) downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, status));
      continue;
    }
    const members = expandedMemberGroups.flat();
    const hasVacuousMemberPattern = pattern.member_claim_pattern_ids.some((patternId) =>
      vacuousIterationPatternIds.has(patternId)
    );
    const everyMemberPatternVacuous = members.length === 0 &&
      pattern.member_claim_pattern_ids.every((patternId) =>
        vacuousIterationPatternIds.has(patternId)
      );
    if (allowIteratedCollections && everyMemberPatternVacuous) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "satisfied"));
      diagnostics.push({
        code: "for_each_collection_evaluation",
        pattern_id: pattern.pattern_id,
        vacuously_satisfied: true,
        expanded_member_claim_ids: []
      });
      continue;
    }
    if (allowIteratedCollections && hasVacuousMemberPattern) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "unsatisfied"));
      diagnostics.push({
        code: "for_each_collection_mixed_vacuity_invalid",
        pattern_id: pattern.pattern_id,
        vacuous_member_pattern_ids: pattern.member_claim_pattern_ids.filter(
          (patternId) => vacuousIterationPatternIds.has(patternId)
        ).sort(compareIds)
      });
      continue;
    }
    const expected = pattern.collection_kind === "closed_set"
      ? [...members].sort(compareIds)
      : members;
    const matchesPurpose = (collection) =>
      pattern.collection_purpose === undefined ||
      collection.purpose === pattern.collection_purpose;
    const matchingCollections = contract.collections.filter((collection) => {
      if (collection.collection_kind !== pattern.collection_kind) return false;
      if (!matchesPurpose(collection)) return false;
      if (pattern.collection_kind === "ordered_sequence") {
        const matchMode = pattern.match_mode ?? "subsequence";
        if (matchMode === "exact") return canonical(collection.member_claim_ids) ===
          canonical(expected);
        if (matchMode === "contiguous_subsequence") return isContiguousSubsequence(
          expected,
          collection.member_claim_ids
        );
        return isOrderedSubsequence(expected, collection.member_claim_ids);
      }
      return canonical([...collection.member_claim_ids].sort(compareIds)) ===
        canonical(expected);
    });
    const candidateCollections = pattern.candidate_quantifier === "all_covering"
      ? contract.collections.filter((collection) => {
        if (collection.collection_kind !== pattern.collection_kind ||
            !matchesPurpose(collection)) return false;
        const covers = expected.every((claimId) =>
          collection.member_claim_ids.includes(claimId)
        );
        return covers || purposeMatchedCollectionsAreCandidates &&
          pattern.collection_purpose !== undefined;
      })
      : matchingCollections;
    if (pattern.candidate_quantifier === "all_covering" &&
        pattern.collection_purpose !== undefined) {
      const excludedCoveringCollections = contract.collections.filter((collection) =>
        collection.collection_kind === pattern.collection_kind &&
        !matchesPurpose(collection) &&
        expected.every((claimId) => collection.member_claim_ids.includes(claimId))
      );
      if (excludedCoveringCollections.length > 0) diagnostics.push({
        code: "collection_covering_purpose_mismatch",
        pattern_id: pattern.pattern_id,
        expected_collection_purpose: pattern.collection_purpose,
        excluded_collections: excludedCoveringCollections
          .map(({ collection_id: collectionId, purpose = null }) => ({
            collection_id: collectionId,
            actual_collection_purpose: purpose
          }))
          .sort((left, right) => compareIds(left.collection_id, right.collection_id))
      });
    }
    if (pattern.candidate_quantifier === "all_covering") {
      const expectedSet = new Set(expected);
      const overlappingNoncoveringCollections = contract.collections
        .filter((collection) =>
          collection.collection_kind === pattern.collection_kind &&
          collection.member_claim_ids.some((claimId) => expectedSet.has(claimId)) &&
          !expected.every((claimId) => collection.member_claim_ids.includes(claimId))
        )
        .map(({ collection_id: collectionId, purpose = null, member_claim_ids: memberIds }) => ({
          collection_id: collectionId,
          actual_collection_purpose: purpose,
          shared_member_claim_ids: expected.filter((claimId) => memberIds.includes(claimId)),
          missing_expected_member_claim_ids: expected.filter(
            (claimId) => !memberIds.includes(claimId)
          ),
          extra_member_claim_ids: memberIds.filter((claimId) => !expectedSet.has(claimId))
            .sort(compareIds)
        }))
        .sort((left, right) => compareIds(left.collection_id, right.collection_id));
      if (overlappingNoncoveringCollections.length > 0) diagnostics.push({
        code: "collection_noncovering_population_overlap",
        pattern_id: pattern.pattern_id,
        collections: overlappingNoncoveringCollections
      });
    }
    if (pattern.candidate_quantifier === "all_covering" &&
        pattern.collection_purpose !== undefined) {
      const disjointPurposeMatches = contract.collections
        .filter((collection) =>
          collection.collection_kind === pattern.collection_kind &&
          matchesPurpose(collection) &&
          !collection.member_claim_ids.some((claimId) => expected.includes(claimId))
        )
        .map(({ collection_id: collectionId }) => collectionId)
        .sort(compareIds);
      if (disjointPurposeMatches.length > 0) diagnostics.push({
        code: "collection_disjoint_purpose_match",
        pattern_id: pattern.pattern_id,
        collection_ids: disjointPurposeMatches
      });
    }
    const matches = matchingCollections.map(({ collection_id }) => collection_id)
      .sort(compareIds);
    const allCandidatesMatch = candidateCollections.length > 0 &&
      matchingCollections.length === candidateCollections.length;
    if (pattern.candidate_quantifier === "all_covering" &&
        candidateCollections.length > 0 && !allCandidatesMatch) {
      diagnostics.push({
        code: pattern.collection_kind === "ordered_sequence"
          ? "collection_covering_sequences_disagree"
          : "collection_covering_sets_disagree",
        pattern_id: pattern.pattern_id,
        candidate_collection_ids: candidateCollections
          .map(({ collection_id }) => collection_id).sort(compareIds),
        nonmatching_collection_ids: candidateCollections
          .filter((candidate) => !matchingCollections.includes(candidate))
          .map(({ collection_id }) => collection_id).sort(compareIds)
      });
    }
    if (pattern.candidate_quantifier === "all_covering" &&
        candidateCollections.length === 0) {
      diagnostics.push({
        code: "collection_pattern_no_candidate",
        pattern_id: pattern.pattern_id,
        collection_kind: pattern.collection_kind,
        collection_purpose: pattern.collection_purpose ?? null
      });
    }
    resultsByPattern.set(
      pattern.pattern_id,
      patternResult(
        pattern,
        pattern.candidate_quantifier === "all_covering"
          ? (allCandidatesMatch ? "satisfied" : "unsatisfied")
          : (matches.length > 0 ? "satisfied" : "unsatisfied"),
        matches
      )
    );
  }

  for (const originalPattern of profile.resolver_fact_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "resolver_fact" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const argumentReferenceIds = pattern.argument_roles.flatMap((role) =>
      binding.bindingByRole.get(role) ?? []
    );
    if (argumentReferenceIds.length === 0 && pattern.argument_roles.length > 0) {
      if (pattern.argument_roles.some((role) => binding.unboundRoles.includes(role))) {
        directlyBlockedPatternIds.add(pattern.pattern_id);
      }
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
      continue;
    }
    const matches = input.resolver_facts.filter((fact) =>
      fact.resolver_kind === pattern.resolver_kind && fact.fact_key === pattern.fact_key &&
      canonical(fact.argument_reference_ids) === canonical(argumentReferenceIds)
    );
    const id = `${pattern.resolver_kind}:${pattern.fact_key}`;
    if (matches.length === 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
    } else if (matches.length > 1) {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "resolver_fact_match_ambiguous",
        pattern_id: pattern.pattern_id
      });
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate", [id]));
    } else {
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, matches[0].satisfied ? "satisfied" : "unsatisfied", [id])
      );
    }
  }

  for (const originalPattern of profile.evidence_patterns) {
    const pattern = { ...originalPattern, pattern_kind: "evidence" };
    if (!activeAt(pattern, input.evaluation_stage)) {
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "inactive"));
      continue;
    }
    const verificationClaimId = selectedClaimByPattern.get(
      pattern.verification_claim_pattern_id
    );
    if (!verificationClaimId) {
      if (directlyBlockedPatternIds.has(pattern.verification_claim_pattern_id) ||
          downstreamBlockedPatternIds.has(pattern.verification_claim_pattern_id)) {
        downstreamBlockedPatternIds.add(pattern.pattern_id);
      }
      if (directlyAmbiguousPatternIds.has(pattern.verification_claim_pattern_id) ||
          downstreamAmbiguousPatternIds.has(pattern.verification_claim_pattern_id)) {
        downstreamAmbiguousPatternIds.add(pattern.pattern_id);
      }
      resultsByPattern.set(pattern.pattern_id, patternResult(
        pattern,
        unresolvedDependencyStatus(
          [pattern.verification_claim_pattern_id],
          resultsByPattern
        )
      ));
      continue;
    }
    const matches = input.delivered_evidence.filter((evidence) =>
      evidence.evidence_kind === pattern.evidence_kind &&
      evidence.verification_claim_id === verificationClaimId
    );
    const id = `${pattern.evidence_kind}:${verificationClaimId}`;
    if (matches.length === 0) {
      directlyBlockedPatternIds.add(pattern.pattern_id);
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate"));
    } else if (matches.length > 1) {
      directlyAmbiguousPatternIds.add(pattern.pattern_id);
      diagnostics.push({
        code: "delivered_evidence_match_ambiguous",
        pattern_id: pattern.pattern_id
      });
      resultsByPattern.set(pattern.pattern_id, patternResult(pattern, "indeterminate", [id]));
    } else {
      resultsByPattern.set(
        pattern.pattern_id,
        patternResult(pattern, matches[0].satisfied ? "satisfied" : "unsatisfied", [id])
      );
    }
  }

  const statusByPattern = new Map(
    [...resultsByPattern].map(([patternId, result]) => [patternId, result.status])
  );
  let satisfactionTrace = evaluateExpressionTrace(
    profile.satisfaction_expression,
    statusByPattern,
    diagnostics,
    new Set((profile.binding_constraint_patterns ?? [])
      .filter(({ minimum = 0, binding_presence: bindingPresence }) =>
        minimum >= 1 || allowBindingPresenceConstraints && bindingPresence === "required")
      .map(({ pattern_id: patternId }) => patternId))
  );
  let satisfaction = satisfactionTrace.status;
  if (globalRequiredBindingsAffectSatisfaction && satisfaction !== "unsatisfied" &&
      (binding.missingRoles.length > 0 || numberBinding.missingRoles.length > 0)) {
    satisfaction = "indeterminate";
    satisfactionTrace = { ...satisfactionTrace, status: "indeterminate" };
  }
  if (satisfaction === "indeterminate") diagnostics.push({
    code: "profile_satisfaction_indeterminate",
    unbound_reference_roles: binding.unboundRoles,
    unbound_number_roles: numberBinding.unboundRoles,
    directly_blocked_pattern_ids: [...directlyBlockedPatternIds].sort(compareIds),
    directly_ambiguous_pattern_ids: [...directlyAmbiguousPatternIds].sort(compareIds),
    downstream_blocked_pattern_ids: [...downstreamBlockedPatternIds].sort(compareIds),
    downstream_ambiguous_pattern_ids: [...downstreamAmbiguousPatternIds].sort(compareIds)
  });
  const result = {
    result_version: resultVersion,
    authority: { kind: "free_tier_local", authoritative: false },
    profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version
    },
    evaluation_stage: input.evaluation_stage,
    profile_valid: true,
    input_valid: true,
    contract_valid: true,
    satisfaction,
    satisfaction_trace: satisfactionTrace,
    pattern_results: [...resultsByPattern.values()].sort((left, right) =>
      compareIds(left.pattern_id, right.pattern_id)
    ),
    binding_analysis: {
      unbound_reference_roles: binding.unboundRoles,
      unbound_number_roles: numberBinding.unboundRoles,
      reference_roles_without_eligible_candidates:
        binding.rolesWithoutEligibleCandidates,
      directly_blocked_pattern_ids: [...directlyBlockedPatternIds].sort(compareIds),
      direct_binding_blockers: directBindingBlockers.sort((left, right) =>
        compareIds(left.pattern_id, right.pattern_id)
      ),
      reference_binding_blockers: referenceBindingBlockers.sort((left, right) =>
        compareIds(left.pattern_id, right.pattern_id)
      ),
      downstream_blocked_pattern_ids: [...downstreamBlockedPatternIds].sort(compareIds)
    },
    ambiguity_analysis: {
      directly_ambiguous_pattern_ids: [...directlyAmbiguousPatternIds].sort(compareIds),
      downstream_ambiguous_pattern_ids: [...downstreamAmbiguousPatternIds].sort(compareIds)
    },
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
  if (!validateRuntimeResult(result)) throw new Error(
    `verification profile evaluator emitted an invalid result: ${JSON.stringify(validateRuntimeResult.errors)}`
  );
  return result;
}

export {
  EVALUATION_STAGES,
  evaluateVerificationProfileWithRuntime
};
