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

function validateProfileSemantics(profile, {
  allowIteratedRelations = false,
  allowIteratedCollections = false,
  allowOptionalCountNumberRoles = false,
  branchLocalExactlyOneRolesByPattern = new Set(),
  controlledOppositeOperatorForRuntime = null
} = {}) {
  const diagnostics = [];
  const roleIds = profile.reference_roles.map(({ role }) => role);
  for (const role of duplicates(roleIds)) diagnostics.push({
    code: "duplicate_profile_role",
    role
  });
  const roleSet = new Set(roleIds);
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const numberRoleIds = (profile.number_roles ?? []).map(({ role }) => role);
  for (const role of duplicates(numberRoleIds)) diagnostics.push({
    code: "duplicate_profile_number_role",
    role
  });
  const numberRoleSet = new Set(numberRoleIds);
  for (const role of roleIds.filter((value) => numberRoleSet.has(value))) diagnostics.push({
    code: "profile_role_kind_collision",
    role
  });
  const distinctRoleSets = profile.distinct_reference_role_sets ?? [];
  const distinctRoleSetKeys = distinctRoleSets.map(({ roles }) =>
    [...roles].sort(compareIds).join("\0")
  );
  for (const key of duplicates(distinctRoleSetKeys)) diagnostics.push({
    code: "duplicate_distinct_reference_role_set",
    roles: key.split("\0")
  });
  for (const { roles, applicability_contexts: applicabilityContexts = [] } of
    distinctRoleSets) {
    for (const role of roles.filter((value) => !roleSet.has(value))) diagnostics.push({
      code: "profile_distinct_reference_role_undefined",
      role
    });
    for (const role of roles) {
      const definition = roleById.get(role);
      if (definition && definition.cardinality !== "exactly_one") diagnostics.push({
        code: "profile_distinct_reference_role_cardinality_invalid",
        role,
        actual_cardinality: definition.cardinality
      });
    }
    for (const [contextIndex, context] of applicabilityContexts.entries()) {
      for (const role of context.operand_roles ?? []) {
        const definition = roleById.get(role);
        if (!definition) diagnostics.push({
          code: "profile_distinct_reference_applicability_role_undefined",
          role,
          context_index: contextIndex
        });
        else if (definition.cardinality !== "exactly_one") diagnostics.push({
          code: "profile_distinct_reference_applicability_role_cardinality_invalid",
          role,
          context_index: contextIndex,
          actual_cardinality: definition.cardinality
        });
      }
    }
  }
  for (const pattern of profile.reference_binding_patterns ?? []) {
    for (const role of pattern.applicability_context?.operand_roles ?? []) {
      if (!roleById.has(role)) diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
    for (const [roleIndex, role] of pattern.roles.entries()) {
      const definition = roleById.get(role);
      if (!definition) diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
      else if (pattern.comparison === "complete_population"
        ? (roleIndex === 0
          ? definition.cardinality !== "exactly_one" &&
            !branchLocalExactlyOneRolesByPattern.has(
              `${pattern.pattern_id}\0${role}`
            )
          : !["exactly_one", "zero_or_one", "one_or_more", "zero_or_more"].includes(
            definition.cardinality
          ))
        : definition.cardinality !== "exactly_one" &&
          !branchLocalExactlyOneRolesByPattern.has(
            `${pattern.pattern_id}\0${role}`
          )) diagnostics.push({
        code: "profile_reference_binding_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role,
        actual_cardinality: definition.cardinality
      });
      if (pattern.comparison === "complete_population" && roleIndex === 0 &&
          definition && definition.allowed_type_terms.some((typeTerm) =>
            !["cc:population", "cc:scope"].includes(typeTerm)
          )) diagnostics.push({
        code: "profile_population_binding_role_type_invalid",
        pattern_id: pattern.pattern_id,
        role,
        allowed_type_terms: [...definition.allowed_type_terms].sort(compareIds)
      });
    }
    if (pattern.comparison === "complete_population" && pattern.roles[0] === pattern.roles[1]) {
      diagnostics.push({
        code: "profile_population_binding_roles_collapsed",
        pattern_id: pattern.pattern_id,
        role: pattern.roles[0]
      });
    }
  }
  const referenceRoleCountBindings = profile.reference_role_count_bindings ?? [];
  const referenceRoleCountBindingKeys = referenceRoleCountBindings.map(
    ({ reference_role: referenceRole, number_role: numberRole }) =>
      `${referenceRole}\0${numberRole}`
  );
  for (const key of duplicates(referenceRoleCountBindingKeys)) {
    const [referenceRole, numberRole] = key.split("\0");
    diagnostics.push({
      code: "duplicate_reference_role_count_binding",
      reference_role: referenceRole,
      number_role: numberRole
    });
  }
  for (const {
    reference_role: referenceRole,
    number_role: numberRole
  } of referenceRoleCountBindings) {
    const referenceDefinition = roleById.get(referenceRole);
    const numberDefinition = (profile.number_roles ?? []).find(
      ({ role }) => role === numberRole
    );
    if (!referenceDefinition) diagnostics.push({
      code: "profile_reference_role_count_binding_reference_role_undefined",
      reference_role: referenceRole,
      number_role: numberRole
    });
    else if (referenceDefinition.cardinality === "zero_or_one") diagnostics.push({
      code: "profile_reference_role_count_binding_cardinality_invalid",
      role_kind: "reference",
      role: referenceRole,
      actual_cardinality: referenceDefinition.cardinality
    });
    if (!numberDefinition) diagnostics.push({
      code: "profile_reference_role_count_binding_number_role_undefined",
      reference_role: referenceRole,
      number_role: numberRole
    });
    else {
      if (numberDefinition.cardinality !== "exactly_one" &&
          !(allowOptionalCountNumberRoles &&
            numberDefinition.cardinality === "zero_or_one")) diagnostics.push({
        code: "profile_reference_role_count_binding_cardinality_invalid",
        role_kind: "number",
        role: numberRole,
        actual_cardinality: numberDefinition.cardinality
      });
      if (numberDefinition.number_type !== "integer") diagnostics.push({
        code: "profile_reference_role_count_binding_number_type_invalid",
        role: numberRole,
        actual_number_type: numberDefinition.number_type ?? "number"
      });
    }
  }
  const patterns = allProfilePatterns(profile);
  const patternIds = patterns.map(({ pattern_id }) => pattern_id);
  for (const patternId of duplicates(patternIds)) diagnostics.push({
    code: "duplicate_profile_pattern_id",
    pattern_id: patternId
  });
  const patternById = new Map(patterns.map((pattern) => [pattern.pattern_id, pattern]));
  const claimPatternById = new Map(
    profile.claim_patterns.map((pattern) => [pattern.pattern_id, pattern])
  );

  for (const pattern of patterns) {
    if (!profile.evaluation_stages.includes(pattern.required_by_stage)) diagnostics.push({
      code: "profile_pattern_stage_unreachable",
      pattern_id: pattern.pattern_id,
      required_by_stage: pattern.required_by_stage
    });
  }

  for (const pattern of profile.claim_patterns) {
    const iteration = pattern.for_each;
    const localMemberRole = iteration?.member_role;
    const localAssociatedRoles = new Set(
      (iteration?.association_bindings ?? []).map(
        ({ associated_role: associatedRole }) => associatedRole
      )
    );
    const localReferenceRoles = new Set([
      localMemberRole,
      ...localAssociatedRoles
    ].filter(Boolean));
    if (iteration) {
      const populationRole = roleById.get(iteration.population_role);
      if (!populationRole) diagnostics.push({
        code: "profile_for_each_population_role_undefined",
        pattern_id: pattern.pattern_id,
        role: iteration.population_role
      });
      else if (populationRole.cardinality !==
          (iteration.empty_behavior === "vacuously_satisfied"
            ? "zero_or_more"
            : "one_or_more")) diagnostics.push({
        code: "profile_for_each_population_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role: iteration.population_role,
        actual_cardinality: populationRole.cardinality
      });
      if (roleSet.has(localMemberRole) || numberRoleSet.has(localMemberRole)) diagnostics.push({
        code: "profile_for_each_member_role_not_local",
        pattern_id: pattern.pattern_id,
        role: localMemberRole
      });
      const templateRoleSet = new Set([
        ...templateRoles(pattern.proposition_template),
        ...(pattern.falsifying_proposition_template
          ? templateRoles(pattern.falsifying_proposition_template)
          : []),
        ...((iteration.association_bindings ?? []).length > 0
          ? [localMemberRole]
          : [])
      ]);
      if (!templateRoleSet.has(localMemberRole)) diagnostics.push({
        code: "profile_for_each_member_role_unused",
        pattern_id: pattern.pattern_id,
        role: localMemberRole
      });
    }
    const roles = [
      ...templateRoles(pattern.proposition_template),
      ...(pattern.falsifying_proposition_template
        ? templateRoles(pattern.falsifying_proposition_template)
        : [])
    ];
    for (const role of [...new Set(roles)].filter((value) =>
      !roleSet.has(value) && value !== localMemberRole
    )) {
      diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
    const numberRoles = [
      ...templateNumberRoles(pattern.proposition_template),
      ...(pattern.falsifying_proposition_template
        ? templateNumberRoles(pattern.falsifying_proposition_template)
        : [])
    ];
    for (const role of [...new Set(numberRoles)].filter(
      (value) => !numberRoleSet.has(value)
    )) diagnostics.push({
      code: "profile_pattern_number_role_undefined",
      pattern_id: pattern.pattern_id,
      role
    });
    for (const template of [
      pattern.proposition_template,
      pattern.falsifying_proposition_template
    ].filter(Boolean)) {
      const subjectRole = localReferenceRoles.has(template.subject_role)
        ? { cardinality: "exactly_one" }
        : roleById.get(template.subject_role);
      if (subjectRole && subjectRole.cardinality !== "exactly_one" &&
          !branchLocalExactlyOneRolesByPattern.has(
            `${pattern.pattern_id}\0${template.subject_role}`
          )) diagnostics.push({
        code: "profile_subject_role_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        role: template.subject_role,
        actual_cardinality: subjectRole.cardinality
      });
    }
  }
  for (const pattern of profile.relation_patterns) {
    for (const [field, endpoint] of [
      ["source_claim_pattern_id", pattern.source_claim_pattern_id],
      ["target_claim_pattern_id", pattern.target_claim_pattern_id]
    ]) {
      if (!claimPatternById.has(endpoint)) diagnostics.push({
        code: "profile_relation_endpoint_undefined",
        pattern_id: pattern.pattern_id,
        field,
        claim_pattern_id: endpoint
      });
      else if (claimPatternById.get(endpoint).for_each && !allowIteratedRelations) diagnostics.push({
        code: "profile_relation_endpoint_iterated_claim_invalid",
        pattern_id: pattern.pattern_id,
        field,
        claim_pattern_id: endpoint
      });
    }
  }
  if (profile.verification_falsifier_policy ===
      "controlled_complement_per_target") {
    const verifiesPatterns = profile.relation_patterns.filter(
      ({ role }) => role === "verifies"
    );
    const targetedBehaviorPatternIds = new Set();
    const targetingVerificationPatternIds = new Set();
    for (const relation of verifiesPatterns) {
      const source = claimPatternById.get(relation.source_claim_pattern_id);
      const target = claimPatternById.get(relation.target_claim_pattern_id);
      if (!source || !target) continue;
      targetingVerificationPatternIds.add(source.pattern_id);
      targetedBehaviorPatternIds.add(target.pattern_id);
      const falsifier = source.falsifying_proposition_template;
      const targetTemplate = target.proposition_template;
      const reasons = [];
      if (source.claim_kind !== "verification") reasons.push(
        "source_is_not_verification"
      );
      if (target.claim_kind !== "behavior") reasons.push("target_is_not_behavior");
      if (!falsifier) reasons.push("source_has_no_falsifier");
      if (falsifier && (typeof controlledOppositeOperatorForRuntime !== "function" ||
          controlledOppositeOperatorForRuntime(targetTemplate.operator) !==
          falsifier.operator)) reasons.push("operator_is_not_controlled_complement");
      if (falsifier && falsifier.subject_role !== targetTemplate.subject_role) {
        reasons.push("subject_role_differs");
      }
      if (falsifier && canonical(falsifier.operands) !==
          canonical(targetTemplate.operands)) reasons.push("operands_differ");
      if (reasons.length > 0) diagnostics.push({
        code: "profile_verification_falsifier_not_complementary",
        pattern_id: relation.pattern_id,
        source_claim_pattern_id: relation.source_claim_pattern_id,
        target_claim_pattern_id: relation.target_claim_pattern_id,
        reasons
      });
    }
    for (const pattern of profile.claim_patterns) {
      if (pattern.claim_kind === "verification" &&
          !targetingVerificationPatternIds.has(pattern.pattern_id)) diagnostics.push({
        code: "profile_verification_pattern_without_target",
        pattern_id: pattern.pattern_id
      });
      if (pattern.claim_kind === "behavior" &&
          !targetedBehaviorPatternIds.has(pattern.pattern_id)) diagnostics.push({
        code: "profile_behavior_pattern_without_verification",
        pattern_id: pattern.pattern_id
      });
    }
  }
  for (const pattern of profile.collection_patterns) {
    if (pattern.collection_kind === "closed_set" &&
        pattern.match_mode && pattern.match_mode !== "exact") diagnostics.push({
      code: "profile_collection_match_mode_invalid",
      pattern_id: pattern.pattern_id,
      collection_kind: pattern.collection_kind,
      match_mode: pattern.match_mode
    });
    for (const member of pattern.member_claim_pattern_ids) {
      if (!claimPatternById.has(member)) diagnostics.push({
        code: "profile_collection_member_undefined",
        pattern_id: pattern.pattern_id,
        claim_pattern_id: member
      });
      else if (claimPatternById.get(member).for_each && !allowIteratedCollections) diagnostics.push({
        code: "profile_collection_member_iterated_claim_invalid",
        pattern_id: pattern.pattern_id,
        claim_pattern_id: member
      });
    }
  }
  for (const role of profile.number_roles ?? []) {
    if (role.minimum !== undefined && role.maximum !== undefined &&
        role.minimum > role.maximum) diagnostics.push({
      code: "profile_number_role_range_invalid",
      role: role.role,
      minimum: role.minimum,
      maximum: role.maximum
    });
  }
  for (const pattern of profile.resolver_fact_patterns) {
    for (const role of pattern.argument_roles.filter((value) => !roleSet.has(value))) {
      diagnostics.push({
        code: "profile_pattern_role_undefined",
        pattern_id: pattern.pattern_id,
        role
      });
    }
  }
  for (const pattern of profile.evidence_patterns) {
    const target = claimPatternById.get(pattern.verification_claim_pattern_id);
    if (!target || target.claim_kind !== "verification") diagnostics.push({
      code: "profile_evidence_verification_pattern_invalid",
      pattern_id: pattern.pattern_id,
      claim_pattern_id: pattern.verification_claim_pattern_id
    });
    else if (target.for_each) diagnostics.push({
      code: "profile_evidence_iterated_claim_invalid",
      pattern_id: pattern.pattern_id,
      claim_pattern_id: pattern.verification_claim_pattern_id
    });
  }

  const expressionIds = expressionPatternIds(profile.satisfaction_expression);
  for (const patternId of expressionIds.filter((id) => !patternById.has(id))) {
    diagnostics.push({
      code: "satisfaction_pattern_undefined",
      pattern_id: patternId
    });
  }
  const expressionIdSet = new Set(expressionIds);
  for (const patternId of patternIds.filter((id) => !expressionIdSet.has(id))) {
    diagnostics.push({
      code: "profile_pattern_not_in_satisfaction_expression",
      pattern_id: patternId
    });
  }
  return diagnostics.sort(compareDiagnostics);
}

export { validateProfileSemantics };
