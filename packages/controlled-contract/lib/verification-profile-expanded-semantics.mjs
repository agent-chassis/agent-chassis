import { canonicalValue, compareCodeUnits } from
  "./deterministic-projection-primitives.mjs";
import { validateProfileSemantics } from "./verification-profile-semantics.mjs";

function createExpandedProfileSemanticValidator({
  controlledVocabulary,
  vocabularyProjection
}) {
  const projection = vocabularyProjection;
  const operatorByTerm = new Map(
    controlledVocabulary.operators.map((operator) => [operator.term, operator])
  );
  const AUTHENTICATION_PROVENANCE_OPERATORS = new Set([
    "reference:authenticates",
    "reference:does_not_authenticate",
    "reference:originates_from",
    "reference:does_not_originate_from",
    "reference:has_source_of_record",
    "reference:does_not_have_source_of_record",
    "reference:observed_in",
    "reference:not_observed_in"
  ]);

  function canonical(value) {
    return JSON.stringify(canonicalValue(value));
  }

  function duplicates(values) {
    const seen = new Set();
    const repeated = new Set();
    for (const value of values) {
      if (seen.has(value)) repeated.add(value);
      seen.add(value);
    }
    return [...repeated].sort(compareCodeUnits);
  }

  function templateRoles(template) {
    return [
      template.subject_role,
      ...template.applicability_context.operand_roles,
      ...template.operands.filter(({ kind }) => kind === "reference")
        .map(({ role }) => role)
    ];
  }

  function templateNumberRoles(template) {
    return template.operands.filter(({ kind, value_role: valueRole }) =>
      kind === "number" && valueRole
    ).map(({ value_role: valueRole }) => valueRole);
  }

  function templatesHaveComplementaryOperands(targetTemplate, falsifierTemplate, complement) {
    if (complement.kind === "operator") {
      return falsifierTemplate.operator === complement.term &&
        canonical(falsifierTemplate.operands) === canonical(targetTemplate.operands);
    }
    if (complement.kind !== "operand_transform" ||
        complement.transform !== "boolean_negation" ||
        targetTemplate.operator !== falsifierTemplate.operator ||
        targetTemplate.operands.length !== 1 || falsifierTemplate.operands.length !== 1) {
      return false;
    }
    const targetOperand = targetTemplate.operands[0];
    const falsifierOperand = falsifierTemplate.operands[0];
    return targetOperand.kind === "boolean" && falsifierOperand.kind === "boolean" &&
      targetOperand.value === !falsifierOperand.value;
  }
  const negativeModalities = new Set(["MUST_NOT", "SHOULD_NOT"]);
  
  function falsifierModeForTarget(targetPattern) {
    const polarities = new Set(targetPattern.allowed_modalities.map((modality) =>
      negativeModalities.has(modality) ? "negative" : "positive"
    ));
    if (polarities.size !== 1) return "mixed";
    return polarities.has("negative") ? "positive_proposition" : "controlled_complement";
  }
  
  function templatesMatchPositiveProposition(targetTemplate, falsifierTemplate) {
    return targetTemplate.operator === falsifierTemplate.operator &&
      canonical(targetTemplate.operands) === canonical(falsifierTemplate.operands);
  }
  
  function validateControlledComplementPolicy(profile) {
    if (profile.verification_falsifier_policy !== "controlled_complement_per_target") {
      return [];
    }
    const diagnostics = [];
    const claimPatternById = new Map(
      profile.claim_patterns.map((pattern) => [pattern.pattern_id, pattern])
    );
    const verifiesPatterns = profile.relation_patterns.filter(({ role }) => role === "verifies");
    const conditionBindings = new Map();
    for (const binding of profile.falsifier_condition_bindings ?? []) {
      if (conditionBindings.has(binding.relation_pattern_id)) diagnostics.push({
        code: "profile_falsifier_condition_binding_duplicate",
        relation_pattern_id: binding.relation_pattern_id
      });
      conditionBindings.set(binding.relation_pattern_id, binding.applicability_context);
    }
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
      const complement = operatorByTerm.get(targetTemplate.operator)?.controlled_complement ?? {
        kind: "none"
      };
      const falsifierMode = falsifierModeForTarget(target);
      const reasons = [];
      const conditionBinding = conditionBindings.get(relation.pattern_id);
      if (source.claim_kind !== "verification") reasons.push("source_is_not_verification");
      if (target.claim_kind !== "behavior") reasons.push("target_is_not_behavior");
      if (!falsifier) reasons.push("source_has_no_falsifier");
      if (falsifierMode === "mixed") reasons.push(
        "target_modalities_mix_positive_and_negative"
      );
      if (falsifierMode === "controlled_complement") {
        if (complement.kind === "none") reasons.push("target_has_no_controlled_complement");
        if (falsifier && complement.kind !== "none" &&
            !templatesHaveComplementaryOperands(targetTemplate, falsifier, complement)) {
          reasons.push("proposition_is_not_controlled_complement");
        }
      }
      if (falsifierMode === "positive_proposition" && falsifier &&
          !templatesMatchPositiveProposition(targetTemplate, falsifier)) {
        reasons.push("proposition_is_not_positive_form_of_negative_behavior");
      }
      if (falsifier && falsifier.subject_role !== targetTemplate.subject_role) {
        reasons.push("subject_role_differs");
      }
      if (!conditionBinding) reasons.push("falsifier_condition_binding_missing");
      else if (falsifier && canonical(falsifier.applicability_context) !==
          canonical(conditionBinding)) reasons.push("falsifier_condition_differs");
      if (conditionBinding && AUTHENTICATION_PROVENANCE_OPERATORS.has(
        targetTemplate.operator
      ) && canonical(targetTemplate.applicability_context) !==
          canonical(conditionBinding)) reasons.push("target_condition_differs");
      if (reasons.length > 0) diagnostics.push({
        code: "profile_verification_falsifier_not_complementary",
        pattern_id: relation.pattern_id,
        source_claim_pattern_id: relation.source_claim_pattern_id,
        target_claim_pattern_id: relation.target_claim_pattern_id,
        reasons
      });
    }
    for (const relationPatternId of conditionBindings.keys()) {
      if (!verifiesPatterns.some(({ pattern_id: patternId }) =>
        patternId === relationPatternId
      )) diagnostics.push({
        code: "profile_falsifier_condition_binding_dangling",
        relation_pattern_id: relationPatternId
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
    return diagnostics;
  }
  
  const roleCardinalityIntervals = Object.freeze({
    exactly_one: { minimum: 1, maximum: 1 },
    one_or_more: { minimum: 1, maximum: null },
    zero_or_one: { minimum: 0, maximum: 1 },
    zero_or_more: { minimum: 0, maximum: null }
  });
  
  function addMaximum(left, right) {
    return left === null || right === null ? null : left + right;
  }
  
  function expansionInterval(referenceRoles, numberRoles, roleById, numberRoleById,
    literalCount = 0, localReferenceRoles = new Set(),
    branchLocalExactlyOneRoles = new Set()) {
    let minimum = literalCount;
    let maximum = literalCount;
    for (const role of referenceRoles) {
      const interval = localReferenceRoles.has(role) || branchLocalExactlyOneRoles.has(role)
        ? roleCardinalityIntervals.exactly_one
        : roleCardinalityIntervals[roleById.get(role)?.cardinality];
      if (!interval) continue;
      minimum += interval.minimum;
      maximum = addMaximum(maximum, interval.maximum);
    }
    for (const role of numberRoles) {
      const interval = branchLocalExactlyOneRoles.has(role)
        ? roleCardinalityIntervals.exactly_one
        : roleCardinalityIntervals[numberRoleById.get(role)?.cardinality];
      if (!interval) continue;
      minimum += interval.minimum;
      maximum = addMaximum(maximum, interval.maximum);
    }
    return { minimum, maximum };
  }
  
  function intervalFits(actual, required) {
    return actual.minimum >= required.minimum &&
      (required.maximum === null ||
        (actual.maximum !== null && actual.maximum <= required.maximum));
  }
  
  function validateRoleExpansionCardinality(profile, branchLocalExactlyOneRolesByPattern) {
    const diagnostics = [];
    const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
    const numberRoleById = new Map(
      (profile.number_roles ?? []).map((role) => [role.role, role])
    );
    const applicabilityByMode = new Map(
      projection.applicability_mode_branches.map((branch) => [branch.mode, branch])
    );
    for (const pattern of profile.claim_patterns) {
      const localReferenceRoles = new Set([
        pattern.for_each?.member_role,
        ...(pattern.for_each?.association_bindings ?? []).map(
          ({ associated_role: associatedRole }) => associatedRole
        )
      ].filter(Boolean));
      const branchLocalExactlyOneRoles = new Set(
        [...branchLocalExactlyOneRolesByPattern]
          .filter((key) => key.startsWith(`${pattern.pattern_id}\0`))
          .map((key) => key.slice(pattern.pattern_id.length + 1))
      );
      for (const [templateKind, template] of [
        ["proposition", pattern.proposition_template],
        ["falsifier", pattern.falsifying_proposition_template]
      ]) {
        if (!template) continue;
        const applicabilityRequired = applicabilityByMode.get(
          template.applicability_context.mode
        )?.context_reference_cardinality;
        if (applicabilityRequired) {
          const actual = expansionInterval(
            template.applicability_context.operand_roles,
            [], roleById, numberRoleById, 0, localReferenceRoles,
            branchLocalExactlyOneRoles
          );
          if (!intervalFits(actual, applicabilityRequired)) diagnostics.push({
            code: "profile_operator_position_cardinality_incompatible",
            pattern_id: pattern.pattern_id,
            template_kind: templateKind,
            position: "applicability_context",
            operator: template.operator,
            applicability_mode: template.applicability_context.mode,
            roles: [...template.applicability_context.operand_roles],
            expansion_cardinality: actual,
            required_cardinality: applicabilityRequired
          });
        }
        const signature = projection.operator_signatures[template.operator];
        if (!signature) continue;
        const referenceRoles = template.operands
          .filter(({ kind }) => kind === "reference")
          .map(({ role }) => role);
        const numberRoles = template.operands
          .filter(({ kind, value_role: valueRole }) => kind === "number" && valueRole)
          .map(({ value_role: valueRole }) => valueRole);
        const literalCount = template.operands.filter(({ kind, value_role: valueRole }) =>
          kind !== "reference" && !(kind === "number" && valueRole)
        ).length;
        const actual = expansionInterval(
          referenceRoles, numberRoles, roleById, numberRoleById, literalCount,
          localReferenceRoles,
          branchLocalExactlyOneRoles
        );
        if (!intervalFits(actual, signature.operand_cardinality)) diagnostics.push({
          code: "profile_operator_position_cardinality_incompatible",
          pattern_id: pattern.pattern_id,
          template_kind: templateKind,
          position: "operands",
          operator: template.operator,
          reference_roles: referenceRoles,
          number_roles: numberRoles,
          literal_operand_count: literalCount,
          expansion_cardinality: actual,
          required_cardinality: signature.operand_cardinality
        });
      }
    }
    return diagnostics;
  }
  
  function validateRoleTypeApplicability(profile) {
    const diagnostics = [];
    const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
    const check = ({ patternId, templateKind, position, role, restriction, operator }) => {
      if (!restriction || restriction.kind !== "restricted") return;
      const definition = roleById.get(role);
      if (!definition) return;
      const incompatible = definition.allowed_type_terms.filter(
        (typeTerm) => !restriction.terms.includes(typeTerm)
      );
      if (incompatible.length === 0) return;
      diagnostics.push({
        code: "profile_operator_position_type_incompatible",
        pattern_id: patternId,
        template_kind: templateKind,
        position,
        operator,
        role,
        incompatible_type_terms: incompatible.sort(compareCodeUnits),
        allowed_type_terms: [...restriction.terms].sort(compareCodeUnits)
      });
    };
    for (const pattern of profile.claim_patterns) {
      for (const [templateKind, template] of [
        ["proposition", pattern.proposition_template],
        ["falsifier", pattern.falsifying_proposition_template]
      ]) {
        if (!template) continue;
        const operator = operatorByTerm.get(template.operator);
        if (!operator || !AUTHENTICATION_PROVENANCE_OPERATORS.has(template.operator)) {
          continue;
        }
        check({ patternId: pattern.pattern_id, templateKind, position: "subject",
          role: template.subject_role, restriction: operator.signature.subject_types,
          operator: template.operator });
        for (const operand of template.operands.filter(({ kind }) => kind === "reference")) {
          check({ patternId: pattern.pattern_id, templateKind, position: "operand",
            role: operand.role, restriction: operator.signature.operand_types,
            operator: template.operator });
        }
        for (const role of template.applicability_context.operand_roles) {
          check({ patternId: pattern.pattern_id, templateKind,
            position: "applicability_context", role,
            restriction: operator.applicability.context_reference_types,
            operator: template.operator });
        }
      }
    }
    return diagnostics;
  }
  
  function expressionRoutes(expression, maximumRoutes = 4096) {
    if (expression.pattern) return [new Set([expression.pattern])];
    const children = expression.all_of ?? expression.any_of;
    if (expression.any_of) return children.flatMap((child) =>
      expressionRoutes(child, maximumRoutes)
    ).slice(0, maximumRoutes + 1);
    let routes = [new Set()];
    for (const child of children) {
      const childRoutes = expressionRoutes(child, maximumRoutes);
      routes = routes.flatMap((route) => childRoutes.map((childRoute) =>
        new Set([...route, ...childRoute])
      )).slice(0, maximumRoutes + 1);
    }
    return routes;
  }
  
  function expressionNodes(expression) {
    const children = expression.all_of ?? expression.any_of ?? [];
    return [expression, ...children.flatMap(expressionNodes)];
  }
  
  function canonicalExpression(expression) {
    if (expression.pattern) return canonical(expression);
    const key = expression.all_of ? "all_of" : "any_of";
    return canonical({
      ...expression,
      [key]: expression[key].map(canonicalExpression).sort(compareCodeUnits)
    });
  }
  
  function patternRoleUse(pattern) {
    if (!pattern) return { references: [], numbers: [] };
    if (pattern.pattern_kind === "binding_constraint") {
      return { references: [], numbers: [] };
    }
    if (pattern.pattern_kind === "reference_binding") return {
      references: [
        ...pattern.roles,
        ...(pattern.applicability_context?.operand_roles ?? [])
      ],
      numbers: []
    };
    if (pattern.pattern_kind === "claim") {
      const localRoles = new Set([pattern.for_each?.member_role].filter(Boolean));
      const iterationProfileRoles = [
        pattern.for_each?.population_role,
        ...(pattern.for_each?.association_bindings ?? []).map(
          ({ associated_role: associatedRole }) => associatedRole
        )
      ].filter(Boolean);
      const references = [
        ...iterationProfileRoles,
        ...templateRoles(pattern.proposition_template),
        ...(pattern.falsifying_proposition_template
          ? templateRoles(pattern.falsifying_proposition_template)
          : [])
      ].filter((role) => !localRoles.has(role));
      const numbers = [
        ...templateNumberRoles(pattern.proposition_template),
        ...(pattern.falsifying_proposition_template
          ? templateNumberRoles(pattern.falsifying_proposition_template)
          : [])
      ];
      return { references, numbers };
    }
    if (pattern.pattern_kind === "resolver_fact") return {
      references: pattern.argument_roles,
      numbers: []
    };
    return { references: [], numbers: [] };
  }
  
  function validateBindingConstraintSemantics(profile) {
    const diagnostics = [];
    const referenceByRole = new Map(profile.reference_roles.map((role) =>
      [role.role, role]
    ));
    const numberByRole = new Map((profile.number_roles ?? []).map((role) =>
      [role.role, role]
    ));
    const constraints = profile.binding_constraint_patterns ?? [];
    const constraintById = new Map(constraints.map((pattern) =>
      [pattern.pattern_id, pattern]
    ));
    const intervalFor = (pattern) => {
      const definition = pattern.role_kind === "reference"
        ? referenceByRole.get(pattern.role)
        : numberByRole.get(pattern.role);
      const global = definition && roleCardinalityIntervals[definition.cardinality];
      return { definition, global, interval: global ? {
        minimum: pattern.minimum ?? global.minimum,
        maximum: pattern.maximum === undefined ? global.maximum : pattern.maximum
      } : null };
    };
    for (const pattern of constraints) {
      const { definition, global, interval } = intervalFor(pattern);
      if (!definition) diagnostics.push({
        code: "profile_binding_constraint_role_undefined",
        pattern_id: pattern.pattern_id,
        role_kind: pattern.role_kind,
        role: pattern.role
      });
      if (!global || !interval) continue;
      const maximumWithin = global.maximum === null ||
        interval.maximum !== null && interval.maximum <= global.maximum;
      const ordered = interval.maximum === null ||
        interval.minimum <= interval.maximum;
      const presenceNarrows = pattern.binding_presence === "required" &&
        global.minimum === 0 || pattern.binding_presence === "forbidden";
      const proper = interval.minimum > global.minimum ||
        interval.maximum !== global.maximum || presenceNarrows;
      if (interval.minimum < global.minimum || !maximumWithin || !ordered || !proper) {
        diagnostics.push({
          code: "profile_binding_constraint_interval_invalid",
          pattern_id: pattern.pattern_id,
          role_kind: pattern.role_kind,
          role: pattern.role,
          global_interval: global,
          constraint_interval: interval
        });
      }
      if (pattern.binding_presence === "forbidden" &&
          (interval.minimum !== 0 || interval.maximum !== 0)) diagnostics.push({
        code: "profile_binding_constraint_presence_invalid",
        pattern_id: pattern.pattern_id,
        role_kind: pattern.role_kind,
        role: pattern.role,
        binding_presence: pattern.binding_presence,
        constraint_interval: interval
      });
    }
    const allPatterns = [
      ...(profile.binding_constraint_patterns ?? []).map((pattern) => ({
        ...pattern, pattern_kind: "binding_constraint"
      })),
      ...(profile.reference_binding_patterns ?? []).map((pattern) => ({
        ...pattern, pattern_kind: "reference_binding"
      })),
      ...profile.claim_patterns.map((pattern) => ({ ...pattern, pattern_kind: "claim" })),
      ...profile.relation_patterns.map((pattern) => ({ ...pattern, pattern_kind: "relation" })),
      ...profile.collection_patterns.map((pattern) => ({ ...pattern, pattern_kind: "collection" })),
      ...profile.resolver_fact_patterns.map((pattern) => ({
        ...pattern, pattern_kind: "resolver_fact"
      })),
      ...profile.evidence_patterns.map((pattern) => ({ ...pattern, pattern_kind: "evidence" }))
    ];
    const patternById = new Map(allPatterns.map((pattern) =>
      [pattern.pattern_id, pattern]
    ));
    for (const node of expressionNodes(profile.satisfaction_expression)) {
      if (!node.any_of || node.branch_cardinality !== "exactly_one") continue;
      const childKeys = node.any_of.map(canonicalExpression);
      for (const duplicate of childKeys.filter((key, index) =>
        childKeys.indexOf(key) !== index
      )) diagnostics.push({
        code: "profile_satisfaction_branch_duplicate",
        expression: duplicate
      });
      const childFacts = node.any_of.map((child, branchIndex) => {
        const routes = expressionRoutes(child);
        if (routes.length > 4096) diagnostics.push({
          code: "profile_satisfaction_branch_route_limit_exceeded",
          branch_index: branchIndex,
          maximum_routes: 4096
        });
        const routeFacts = routes.slice(0, 4096).map((route) => {
          const usedReferences = new Set();
          const usedNumbers = new Set();
          for (const patternId of route) {
            const use = patternRoleUse(patternById.get(patternId));
            use.references.forEach((role) => usedReferences.add(role));
            use.numbers.forEach((role) => usedNumbers.add(role));
          }
          return { route, usedReferences, usedNumbers };
        });
        return { child, routeFacts };
      });
      const constrainedRoles = new Set(childFacts.flatMap(({ routeFacts }) =>
        routeFacts.flatMap(({ route }) => [...route].map((patternId) =>
          constraintById.get(patternId)
        ).filter(Boolean).map(({ role_kind: roleKind, role }) =>
          `${roleKind}\0${role}`
        ))
      ));
      const semanticallyUsedRoles = new Set(childFacts.flatMap(({ routeFacts }) =>
        routeFacts.flatMap(({ usedReferences, usedNumbers }) => [
          ...[...usedReferences].map((role) => `reference\0${role}`),
          ...[...usedNumbers].map((role) => `number\0${role}`)
        ])
      ));
      for (const constrainedRole of constrainedRoles) {
        if (semanticallyUsedRoles.has(constrainedRole)) continue;
        const [roleKind, role] = constrainedRole.split("\0");
        diagnostics.push({
          code: "profile_branch_binding_constraint_selector_only",
          role_kind: roleKind,
          role
        });
      }
      for (const [roleKind, definitions, field] of [
        ["reference", referenceByRole, "usedReferences"],
        ["number", numberByRole, "usedNumbers"]
      ]) {
        const roles = new Set(childFacts.flatMap(({ routeFacts }) =>
          routeFacts.flatMap((fact) => [...fact[field]])
        ));
        for (const role of roles) {
          const definition = definitions.get(role);
          if (!definition || !["zero_or_one", "zero_or_more"].includes(
            definition.cardinality
          )) continue;
          for (const [branchIndex, fact] of childFacts.entries()) {
            for (const routeFact of fact.routeFacts) {
              const { route } = routeFact;
              const guards = [...route].map((patternId) => constraintById.get(patternId))
                .filter((pattern) => pattern?.role_kind === roleKind &&
                  pattern.role === role);
              if (guards.length !== 1) {
                diagnostics.push({
                  code: "profile_branch_binding_constraint_coverage_invalid",
                  branch_index: branchIndex,
                  role_kind: roleKind,
                  role,
                  matching_constraint_count: guards.length
                });
                continue;
              }
              const { interval } = intervalFor(guards[0]);
              const used = routeFact[field].has(role);
              const positive = interval && (interval.minimum >= 1 ||
                guards[0].binding_presence === "required");
              const negative = interval && interval.maximum === 0 &&
                (guards[0].binding_presence === undefined ||
                  guards[0].binding_presence === "forbidden");
              if (interval && (used ? !positive : !negative)) {
                diagnostics.push({
                  code: "profile_branch_binding_constraint_polarity_invalid",
                  branch_index: branchIndex,
                  role_kind: roleKind,
                  role,
                  role_used_in_branch: used,
                  constraint_interval: interval
                });
              }
            }
          }
        }
      }
    }
    return diagnostics;
  }
  
  function branchLocalExactlyOneRolesByPattern(profile) {
    const constraints = new Map((profile.binding_constraint_patterns ?? []).map(
      (pattern) => [pattern.pattern_id, pattern]
    ));
    const result = new Set();
    for (const node of expressionNodes(profile.satisfaction_expression)) {
      if (!node.any_of || node.branch_cardinality !== "exactly_one") continue;
      for (const child of node.any_of) for (const route of expressionRoutes(child)) {
        const exactOneRoles = [...route].map((patternId) => constraints.get(patternId))
          .filter((pattern) => pattern && pattern.minimum === 1 && pattern.maximum === 1)
          .map(({ role }) => role);
        for (const patternId of route) for (const role of exactOneRoles) {
          result.add(`${patternId}\0${role}`);
        }
      }
    }
    return result;
  }
  
  function templateReferencePositions(template) {
    const positions = new Map();
    const add = (role, position) => {
      const current = positions.get(role) ?? [];
      current.push(position);
      positions.set(role, current);
    };
    add(template.subject_role, "subject");
    template.operands.filter(({ kind }) => kind === "reference")
      .forEach(({ role }) => add(role, "reference_operand"));
    template.applicability_context.operand_roles.forEach((role) =>
      add(role, "applicability_operand")
    );
    return positions;
  }
  
  function localIterationReferenceRoles(pattern) {
    return new Set([
      pattern?.for_each?.member_role,
      ...(pattern?.for_each?.association_bindings ?? []).map(
        ({ associated_role: associatedRole }) => associatedRole
      )
    ].filter(Boolean));
  }
  
  function canonicalAssociationBindings(bindings) {
    return canonical(bindings.map((binding) => ({
      ...binding,
      applicability_context: {
        ...binding.applicability_context,
        operand_roles: [...new Set(binding.applicability_context.operand_roles)]
          .sort(compareCodeUnits)
      }
    })).map(canonicalValue).sort((left, right) =>
      compareCodeUnits(canonical(left), canonical(right))
    ));
  }
  
  function compatibleIteratedEndpoints(left, right) {
    if (!left?.for_each || !right?.for_each) return false;
    return left.for_each.population_role === right.for_each.population_role &&
      left.for_each.member_role === right.for_each.member_role &&
      canonicalAssociationBindings(left.for_each.association_bindings ?? []) ===
        canonicalAssociationBindings(right.for_each.association_bindings ?? []);
  }
  
  function validateFalsifierOccurrenceBindings(profile,
    branchLocalExactlyOneRolesByPattern) {
    const diagnostics = [];
    const claimById = new Map(profile.claim_patterns.map((pattern) =>
      [pattern.pattern_id, pattern]
    ));
    const relationById = new Map(profile.relation_patterns.map((pattern) =>
      [pattern.pattern_id, pattern]
    ));
    const referenceByRole = new Map(profile.reference_roles.map((role) =>
      [role.role, role]
    ));
    const numberByRole = new Map((profile.number_roles ?? []).map((role) =>
      [role.role, role]
    ));
    const bindings = profile.falsifier_occurrence_bindings ?? [];
    for (const duplicate of duplicates(bindings.map(
      ({ relation_pattern_id: relationPatternId }) => relationPatternId
    ))) diagnostics.push({
      code: "profile_falsifier_occurrence_binding_duplicate",
      relation_pattern_id: duplicate
    });
    for (const binding of bindings) {
      const relation = relationById.get(binding.relation_pattern_id);
      const verification = relation && claimById.get(relation.source_claim_pattern_id);
      const target = relation && claimById.get(relation.target_claim_pattern_id);
      if (!relation || relation.role !== "verifies" || !verification || !target ||
          verification.claim_kind !== "verification" ||
          target.claim_kind !== "behavior" ||
          !verification.falsifying_proposition_template) {
        diagnostics.push({
          code: "profile_falsifier_occurrence_binding_relation_invalid",
          relation_pattern_id: binding.relation_pattern_id
        });
        continue;
      }
      const iteratedEndpoints = verification.for_each || target.for_each;
      const compatibleIteration = compatibleIteratedEndpoints(verification, target);
      if (iteratedEndpoints && !compatibleIteration) diagnostics.push({
        code: "profile_falsifier_occurrence_binding_iterated_endpoint_invalid",
        relation_pattern_id: binding.relation_pattern_id
      });
      const verificationLocalRoles = localIterationReferenceRoles(verification);
      const targetLocalRoles = localIterationReferenceRoles(target);
      const surfaces = {
        target: templateReferencePositions(target.proposition_template),
        verification: templateReferencePositions(verification.proposition_template),
        falsifier: templateReferencePositions(
          verification.falsifying_proposition_template
        )
      };
      for (const duplicate of duplicates(binding.reference_role_joins.map(
        ({ role }) => role
      ))) diagnostics.push({
        code: "profile_falsifier_occurrence_reference_role_duplicate",
        relation_pattern_id: binding.relation_pattern_id,
        role: duplicate
      });
      for (const join of binding.reference_role_joins) {
        const definition = referenceByRole.get(join.role);
        const branchLocalExactlyOne = branchLocalExactlyOneRolesByPattern.has(
          `${relation.pattern_id}\0${join.role}`
        );
        const iterationLocalExactlyOne = compatibleIteration &&
          verificationLocalRoles.has(join.role) && targetLocalRoles.has(join.role);
        const relationBoundIterationMember = compatibleIteration &&
          join.role === verification.for_each.member_role &&
          join.role === target.for_each.member_role;
        if ((join.target_positions.length === 0 || join.falsifier_positions.length === 0) &&
            (!relationBoundIterationMember || join.verification_positions.length === 0)) {
          diagnostics.push({
            code: "profile_falsifier_occurrence_empty_position_invalid",
            relation_pattern_id: binding.relation_pattern_id,
            role: join.role,
            target_positions: [...join.target_positions],
            verification_positions: [...join.verification_positions],
            falsifier_positions: [...join.falsifier_positions],
            compatible_iteration: compatibleIteration,
            relation_bound_iteration_member: relationBoundIterationMember
          });
        }
        if ((!definition && !iterationLocalExactlyOne) ||
            (definition && definition.cardinality !== "exactly_one" &&
              !branchLocalExactlyOne && !iterationLocalExactlyOne)) diagnostics.push({
          code: "profile_falsifier_occurrence_reference_role_invalid",
          relation_pattern_id: binding.relation_pattern_id,
          role: join.role,
          actual_cardinality: definition?.cardinality ?? null
        });
        for (const [surface, declaredPositions] of [
          ["target", join.target_positions],
          ["verification", join.verification_positions],
          ["falsifier", join.falsifier_positions]
        ]) {
          const actual = [...new Set(surfaces[surface].get(join.role) ?? [])]
            .sort(compareCodeUnits);
          const actualWithMultiplicity = surfaces[surface].get(join.role) ?? [];
          const declared = [...new Set(declaredPositions)].sort(compareCodeUnits);
          if (actualWithMultiplicity.length !== actual.length) diagnostics.push({
            code: "profile_falsifier_occurrence_role_position_repeated",
            relation_pattern_id: binding.relation_pattern_id,
            role: join.role,
            surface,
            actual_positions: [...actualWithMultiplicity].sort(compareCodeUnits)
          });
          if (canonical(actual) !== canonical(declared)) diagnostics.push({
            code: "profile_falsifier_occurrence_role_position_mismatch",
            relation_pattern_id: binding.relation_pattern_id,
            role: join.role,
            surface,
            declared_positions: declared,
            actual_positions: actual
          });
        }
      }
      for (const duplicate of duplicates(binding.number_role_joins.map(
        ({ role }) => role
      ))) diagnostics.push({
        code: "profile_falsifier_occurrence_number_role_duplicate",
        relation_pattern_id: binding.relation_pattern_id,
        role: duplicate
      });
      for (const { role } of binding.number_role_joins) {
        const definition = numberByRole.get(role);
        const branchLocalExactlyOne = branchLocalExactlyOneRolesByPattern.has(
          `${relation.pattern_id}\0${role}`
        );
        const occurrences = [
          target.proposition_template,
          verification.proposition_template,
          verification.falsifying_proposition_template
        ].map((template) => templateNumberRoles(template).filter(
          (candidate) => candidate === role
        ).length);
        const presentExactlyOnce = occurrences.every((count) => count === 1);
        if (!definition || definition.cardinality !== "exactly_one" &&
            !branchLocalExactlyOne ||
            !presentExactlyOnce) {
          diagnostics.push({
            code: "profile_falsifier_occurrence_number_role_invalid",
            relation_pattern_id: binding.relation_pattern_id,
            role,
            actual_cardinality: definition?.cardinality ?? null,
            occurrences_by_surface: {
              target: occurrences[0], verification: occurrences[1],
              falsifier: occurrences[2]
            }
          });
        }
      }
      const applicabilityContexts = [
        target.proposition_template.applicability_context,
        verification.proposition_template.applicability_context,
        verification.falsifying_proposition_template.applicability_context
      ];
      if (binding.applicability_join === "exact_scope" &&
          new Set(applicabilityContexts.map(canonical)).size !== 1) {
        diagnostics.push({
          code: "profile_falsifier_occurrence_applicability_not_exact",
          relation_pattern_id: binding.relation_pattern_id
        });
      }
      if (binding.applicability_join === "shared_operands") {
        for (const [surfaceIndex, [surface, positionsField]] of [
          ["target", "target_positions"],
          ["verification", "verification_positions"],
          ["falsifier", "falsifier_positions"]
        ].entries()) {
          const declaredApplicabilityRoles = binding.reference_role_joins
            .filter((join) => join[positionsField].includes("applicability_operand"))
            .map(({ role }) => role).sort(compareCodeUnits);
          const actualApplicabilityRoles = [
            ...applicabilityContexts[surfaceIndex].operand_roles
          ].sort(compareCodeUnits);
          if (canonical(declaredApplicabilityRoles) !==
              canonical(actualApplicabilityRoles)) diagnostics.push({
            code: "profile_falsifier_occurrence_applicability_not_completely_joined",
            relation_pattern_id: binding.relation_pattern_id,
            surface,
            declared_applicability_roles: declaredApplicabilityRoles,
            actual_applicability_roles: actualApplicabilityRoles
          });
        }
      }
    }
    return diagnostics;
  }
  
  function validateVacuousIterationSemantics(profile) {
    const diagnostics = [];
    const roleById = new Map(profile.reference_roles.map((role) =>
      [role.role, role]
    ));
    const populationPatterns = (profile.reference_binding_patterns ?? [])
      .filter(({ comparison }) => comparison === "complete_population");
    const routes = expressionRoutes(profile.satisfaction_expression);
    if (routes.length > 4096) diagnostics.push({
      code: "profile_satisfaction_route_limit_exceeded",
      maximum_routes: 4096
    });
    for (const pattern of profile.claim_patterns) {
      if (pattern.for_each?.empty_behavior !== "vacuously_satisfied") continue;
      const closureCandidates = populationPatterns.filter((candidate) =>
        candidate.roles[1] === pattern.for_each.population_role &&
        (pattern.for_each.complete_population_pattern_id === undefined ||
          candidate.pattern_id === pattern.for_each.complete_population_pattern_id)
      );
      const closure = closureCandidates.length === 1 ? closureCandidates[0] : null;
      const closurePatternId = closure?.pattern_id ??
        pattern.for_each.complete_population_pattern_id ?? null;
      const definition = roleById.get(pattern.for_each.population_role);
      if (!closure || closure.roles[1] !== pattern.for_each.population_role) {
        diagnostics.push({
          code: "profile_for_each_named_population_binding_invalid",
          pattern_id: pattern.pattern_id,
          complete_population_pattern_id: closurePatternId
        });
      }
      if (definition?.cardinality !== "zero_or_more") diagnostics.push({
        code: "profile_for_each_vacuous_population_cardinality_invalid",
        pattern_id: pattern.pattern_id,
        population_role: pattern.for_each.population_role,
        actual_cardinality: definition?.cardinality ?? null
      });
      for (const route of routes.slice(0, 4096).filter((candidate) =>
        candidate.has(pattern.pattern_id)
      )) if (closurePatternId === null || !route.has(closurePatternId)) {
        diagnostics.push({
          code: "profile_for_each_population_binding_not_dominating",
          pattern_id: pattern.pattern_id,
          complete_population_pattern_id: closurePatternId
        });
      }
      if (profile.evidence_patterns.some(({ verification_claim_pattern_id: id }) =>
        id === pattern.pattern_id
      )) diagnostics.push({
        code: "profile_for_each_vacuous_witness_dependency_invalid",
        pattern_id: pattern.pattern_id,
        dependency_kind: "delivered_evidence"
      });
    }
    for (const relation of profile.relation_patterns) {
      const source = profile.claim_patterns.find(({ pattern_id: id }) =>
        id === relation.source_claim_pattern_id
      );
      const target = profile.claim_patterns.find(({ pattern_id: id }) =>
        id === relation.target_claim_pattern_id
      );
      for (const [field, endpoint] of [
        ["source_claim_pattern_id", source],
        ["target_claim_pattern_id", target]
      ]) if (endpoint?.for_each &&
          endpoint.for_each.empty_behavior !== "vacuously_satisfied") diagnostics.push({
        code: "profile_relation_endpoint_iterated_claim_invalid",
        pattern_id: relation.pattern_id,
        field,
        claim_pattern_id: endpoint.pattern_id
      });
      if (source?.for_each && target?.for_each &&
          !compatibleIteratedEndpoints(source, target)) diagnostics.push({
        code: "profile_relation_iteration_binding_mismatch",
        pattern_id: relation.pattern_id,
        source_claim_pattern_id: source.pattern_id,
        target_claim_pattern_id: target.pattern_id
      });
    }
    for (const collection of profile.collection_patterns) {
      const iteratedMembers = collection.member_claim_pattern_ids.map((memberId) =>
        profile.claim_patterns.find(({ pattern_id: id }) => id === memberId)
      ).filter((member) => member?.for_each);
      if (collection.collection_kind === "ordered_sequence" &&
          iteratedMembers.length > 0) diagnostics.push({
        code: "profile_ordered_collection_iterated_member_invalid",
        pattern_id: collection.pattern_id,
        claim_pattern_ids: iteratedMembers.map(({ pattern_id: id }) => id)
          .sort(compareCodeUnits)
      });
      for (const memberId of collection.member_claim_pattern_ids) {
        const member = profile.claim_patterns.find(({ pattern_id: id }) => id === memberId);
        if (member?.for_each &&
            member.for_each.empty_behavior !== "vacuously_satisfied") diagnostics.push({
          code: "profile_collection_member_iterated_claim_invalid",
          pattern_id: collection.pattern_id,
          claim_pattern_id: memberId
        });
      }
      if (iteratedMembers.length > 1 && new Set(iteratedMembers.map((member) =>
        `${member.for_each.population_role}\0${member.for_each.member_role}`
      )).size !== 1) diagnostics.push({
        code: "profile_collection_iteration_binding_mismatch",
        pattern_id: collection.pattern_id,
        claim_pattern_ids: iteratedMembers.map(({ pattern_id: id }) => id)
          .sort(compareCodeUnits)
      });
    }
    return diagnostics;
  }
  
  function validateAssociationBindingSemantics(
    profile,
    branchLocalExactlyOneRolesByPattern
  ) {
    const diagnostics = [];
    const roleById = new Map(profile.reference_roles.map((role) =>
      [role.role, role]
    ));
    const completePopulationById = new Map(
      (profile.reference_binding_patterns ?? [])
        .filter(({ comparison }) => comparison === "complete_population")
        .map((pattern) => [pattern.pattern_id, pattern])
    );
    const routes = expressionRoutes(profile.satisfaction_expression);
    const checkTypes = (pattern, association, definition, restriction, position) => {
      if (!definition || restriction?.kind !== "restricted") return;
      const incompatible = definition.allowed_type_terms.filter(
        (term) => !restriction.terms.includes(term)
      );
      if (incompatible.length > 0) diagnostics.push({
        code: "profile_for_each_association_position_type_incompatible",
        pattern_id: pattern.pattern_id,
        associated_role: association.associated_role,
        operator: association.operator,
        position,
        incompatible_type_terms: incompatible.sort(compareCodeUnits),
        allowed_type_terms: [...restriction.terms].sort(compareCodeUnits)
      });
    };
    for (const pattern of profile.claim_patterns) {
      const branchLocalExactlyOneRoles = new Set(
        [...branchLocalExactlyOneRolesByPattern]
          .filter((key) => key.startsWith(`${pattern.pattern_id}\0`))
          .map((key) => key.slice(pattern.pattern_id.length + 1))
      );
      const associations = pattern.for_each?.association_bindings ?? [];
      for (const associatedRole of duplicates(associations.map(
        ({ associated_role: role }) => role
      ))) diagnostics.push({
        code: "profile_for_each_association_role_duplicate",
        pattern_id: pattern.pattern_id,
        associated_role: associatedRole
      });
      for (const association of associations) {
        if (association.associated_cardinality === "one_or_more" &&
            (pattern.claim_kind !== "evidence" || associations.length !== 1)) diagnostics.push({
          code: "profile_for_each_association_one_or_more_scope_invalid",
          pattern_id: pattern.pattern_id,
          claim_kind: pattern.claim_kind,
          association_binding_count: associations.length
        });
        const associatedDefinition = roleById.get(association.associated_role);
        const memberDefinition = roleById.get(pattern.for_each.population_role);
        const signature = projection.operator_signatures[association.operator];
        const operator = operatorByTerm.get(association.operator);
        const closure = completePopulationById.get(
          association.complete_population_pattern_id
        );
        if (!associatedDefinition) diagnostics.push({
          code: "profile_for_each_association_role_undefined",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role
        });
        if (association.associated_role === pattern.for_each.population_role ||
            association.associated_role === pattern.for_each.member_role) diagnostics.push({
          code: "profile_for_each_association_role_not_independent",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role
        });
        if (!closure || closure.roles[1] !== association.associated_role) diagnostics.push({
          code: "profile_for_each_association_population_binding_invalid",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          complete_population_pattern_id:
            association.complete_population_pattern_id
        });
        for (const route of routes.slice(0, 4096).filter((candidate) =>
          candidate.has(pattern.pattern_id)
        )) if (!route.has(association.complete_population_pattern_id)) diagnostics.push({
          code: "profile_for_each_association_population_not_dominating",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          complete_population_pattern_id:
            association.complete_population_pattern_id
        });
        const applicationRoles = association.applicability_context.operand_roles;
        if (applicationRoles.includes(association.associated_role)) diagnostics.push({
          code: "profile_for_each_association_role_in_applicability",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role
        });
        for (const role of [...new Set(applicationRoles)].filter((role) =>
          role !== pattern.for_each.member_role && !roleById.has(role)
        )) diagnostics.push({
          code: "profile_for_each_association_applicability_role_undefined",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          role
        });
        const applicabilityRequired = projection.applicability_mode_branches.find(
          ({ mode }) => mode === association.applicability_context.mode
        )?.context_reference_cardinality;
        const applicabilityExpansion = expansionInterval(
          applicationRoles,
          [],
          roleById,
          new Map(),
          0,
          new Set([pattern.for_each.member_role]),
          branchLocalExactlyOneRoles
        );
        if (applicabilityRequired && !intervalFits(
          applicabilityExpansion,
          applicabilityRequired
        )) diagnostics.push({
          code: "profile_for_each_association_applicability_cardinality_incompatible",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          applicability_mode: association.applicability_context.mode,
          roles: [...applicationRoles],
          expansion_cardinality: applicabilityExpansion,
          required_cardinality: applicabilityRequired
        });
        const usedRoles = new Set([
          ...templateRoles(pattern.proposition_template),
          ...(pattern.falsifying_proposition_template
            ? templateRoles(pattern.falsifying_proposition_template)
            : [])
        ]);
        if (!usedRoles.has(association.associated_role)) diagnostics.push({
          code: "profile_for_each_association_role_unused",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role
        });
        if (!signature || signature.operand_kind !== "reference") diagnostics.push({
          code: "profile_for_each_association_operator_not_binary_reference",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          operator: association.operator
        });
        if (operator?.applicability.kind === "restricted_modes" &&
            !operator.applicability.modes.includes(
          association.applicability_context.mode
        )) diagnostics.push({
          code: "profile_for_each_association_applicability_mode_invalid",
          pattern_id: pattern.pattern_id,
          associated_role: association.associated_role,
          operator: association.operator,
          applicability_mode: association.applicability_context.mode
        });
        const subjectDefinition = association.member_position === "subject"
          ? memberDefinition : associatedDefinition;
        const operandDefinition = association.member_position === "reference_operand"
          ? memberDefinition : associatedDefinition;
        checkTypes(pattern, association, subjectDefinition, signature?.subject_types, "subject");
        checkTypes(pattern, association, operandDefinition, signature?.operand_types,
          "reference_operand");
        for (const role of applicationRoles) {
          const definition = role === pattern.for_each.member_role
            ? memberDefinition : roleById.get(role);
          checkTypes(pattern, association, definition,
            operator?.applicability.context_reference_types,
            "applicability_context");
        }
      }
    }
    return diagnostics;
  }
  
  function validateExpandedProfileSemantics(profile) {
    const profileWithoutLegacyComplementPolicy = structuredClone(profile);
    delete profileWithoutLegacyComplementPolicy.verification_falsifier_policy;
    const branchLocalExactlyOne = branchLocalExactlyOneRolesByPattern(profile);
    const diagnostics = [
      ...validateProfileSemantics(profileWithoutLegacyComplementPolicy, {
        allowIteratedRelations: true,
        allowIteratedCollections: true,
        allowOptionalCountNumberRoles: true,
        branchLocalExactlyOneRolesByPattern: branchLocalExactlyOne
      }),
      ...validateControlledComplementPolicy(profile),
      ...validateRoleExpansionCardinality(profile, branchLocalExactlyOne),
      ...validateRoleTypeApplicability(profile),
      ...validateBindingConstraintSemantics(profile),
      ...validateFalsifierOccurrenceBindings(profile, branchLocalExactlyOne),
      ...validateVacuousIterationSemantics(profile),
      ...validateAssociationBindingSemantics(profile, branchLocalExactlyOne)
    ];
    const completePopulationPatterns = (profile.reference_binding_patterns ?? [])
      .filter(({ comparison }) => comparison === "complete_population");
    for (const pattern of profile.claim_patterns ?? []) {
      const iterationPopulationBindingCount = pattern.for_each
        ? completePopulationPatterns.filter(({ roles }) =>
          roles[1] === pattern.for_each.population_role
        ).length
        : 0;
      if (pattern.for_each && iterationPopulationBindingCount !== 1) diagnostics.push({
        code: "profile_for_each_population_not_complete_bound",
        pattern_id: pattern.pattern_id,
        population_role: pattern.for_each.population_role,
        complete_binding_count: iterationPopulationBindingCount
      });
      for (const [templateField, template] of [
        ["proposition_template", pattern.proposition_template],
        ["falsifying_proposition_template", pattern.falsifying_proposition_template]
      ]) {
        if (!template || !["reference:subset_of", "reference:not_subset_of"].includes(
          template.operator
        )) continue;
        const populationRoles = [
          template.subject_role,
          ...template.operands
            .filter(({ kind }) => kind === "reference")
            .map(({ role }) => role)
        ];
        for (const role of populationRoles) {
          const completeBindingCount = completePopulationPatterns.filter(
            ({ roles }) => roles[0] === role
          ).length;
          if (completeBindingCount !== 1) diagnostics.push({
            code: "profile_population_relation_role_not_complete_bound",
            pattern_id: pattern.pattern_id,
            template_field: templateField,
            role,
            complete_binding_count: completeBindingCount
          });
        }
      }
    }
    return diagnostics.sort((left, right) =>
      compareCodeUnits(canonical(left), canonical(right))
    );
  }
  return validateExpandedProfileSemantics;
}

export { createExpandedProfileSemanticValidator };
