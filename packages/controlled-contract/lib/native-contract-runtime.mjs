import Ajv2020 from "ajv/dist/2020.js";

import { resolveNativeContractDag } from "./native-contract-dag.mjs";

const compareCodeUnits = (left, right) => {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
};

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function duplicateIds(entries, key, code) {
  const seen = new Set();
  const emitted = new Set();
  const diagnostics = [];
  for (const entry of entries) {
    const value = entry[key];
    if (seen.has(value) && !emitted.has(value)) {
      diagnostics.push({ code, [key]: value });
      emitted.add(value);
    }
    seen.add(value);
  }
  return diagnostics;
}

function duplicateReferenceIdentities(references) {
  const referencesByIdentity = new Map();
  for (const reference of references) {
    const identity = canonicalValue(reference.identity);
    const key = JSON.stringify(identity);
    const entries = referencesByIdentity.get(key) ?? { identity, reference_ids: [] };
    entries.reference_ids.push(reference.reference_id);
    referencesByIdentity.set(key, entries);
  }
  return [...referencesByIdentity.values()]
    .filter(({ reference_ids: referenceIds }) => referenceIds.length > 1)
    .map(({ identity, reference_ids: referenceIds }) => ({
      code: "duplicate_reference_identity",
      identity,
      reference_ids: referenceIds.sort(compareCodeUnits)
    }))
    .sort((left, right) =>
      compareCodeUnits(JSON.stringify(left.identity), JSON.stringify(right.identity))
    );
}

function createNativeContractRuntime({
  carrierVersion,
  schema,
  complementByOperator,
  inverseByOperator = {},
  functionalOperators,
  irreflexiveOperators = [],
  symmetricOperators = [],
  transitiveOperators = [],
  pointwiseRelationOperators = [],
  complementContradictionModalities = ["MUST"],
  unconditionalEquivalenceIsGlobal = false,
  operandSemanticsByOperator,
  conjunctiveRangeOperators,
  crossOperatorConstraints = { kind: "unsupported", reason: "not supplied" },
  validatePropositionSemantics = () => [],
  validatePopulationRelations = () => []
}) {
  const validateSchema = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const complements = new Map(Object.entries(complementByOperator));
  const inverses = new Map(Object.entries(inverseByOperator));
  const functional = new Set(functionalOperators);
  const irreflexive = new Set(irreflexiveOperators);
  const symmetric = new Set(symmetricOperators);
  const transitive = new Set(transitiveOperators);
  const pointwiseRelations = new Set(pointwiseRelationOperators);
  const complementModalities = new Set(complementContradictionModalities);
  const rangeConstraints = new Set(conjunctiveRangeOperators);
  const declaredCrossConstraints = crossOperatorConstraints.kind === "declared"
    ? crossOperatorConstraints.constraints
    : [];

  function normalizedApplicability(context) {
    return {
      mode: context.mode,
      operand_reference_ids: [...new Set(context.operand_reference_ids)].sort(compareCodeUnits)
    };
  }

  function normalizedOperands(operator, operands) {
    const semantics = operandSemanticsByOperator[operator];
    const normalized = operands.map(canonicalValue);
    const selected = semantics?.duplicates === "ignored"
      ? [...new Map(normalized.map((operand) => [JSON.stringify(operand), operand])).values()]
      : normalized;
    if (semantics?.ordering === "significant") return selected;
    return selected.sort((left, right) =>
      compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
    );
  }

  function operandsAreControlledComplements(operator, leftOperands, rightOperands) {
    const complement = complements.get(operator);
    if (complement?.kind !== "operand_transform") return false;
    if (complement.transform !== "boolean_negation" ||
        leftOperands.length !== 1 || rightOperands.length !== 1 ||
        leftOperands[0].kind !== "boolean" || rightOperands[0].kind !== "boolean") return false;
    return leftOperands[0].value !== rightOperands[0].value;
  }

  function directPropositionContradictions(contract) {
    const propositionById = new Map(
      contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
    );
    const mandatoryClaims = contract.claims
      .filter(({ kind, modality }) =>
        ["behavior", "evidence"].includes(kind) && ["MUST", "MUST_NOT"].includes(modality)
      )
      .map((claim) => ({ ...claim, proposition: propositionById.get(claim.proposition_id) }))
      .filter(({ proposition }) => proposition);
    const diagnostics = [];
    const emitted = new Set();

    function emit(left, right, reason) {
      const claimIds = [left.claim_id, right.claim_id].sort(compareCodeUnits);
      const key = `${reason}\0${claimIds.join("\0")}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      diagnostics.push({
        code: "direct_proposition_contradiction",
        reason,
        claim_ids: claimIds,
        proposition_ids: [left.proposition_id, right.proposition_id].sort(compareCodeUnits)
      });
    }

    const sameApplicability = (left, right) =>
      JSON.stringify(normalizedApplicability(left.applicability_context)) ===
        JSON.stringify(normalizedApplicability(right.applicability_context));
    const applicabilityKey = (proposition) => JSON.stringify(
      normalizedApplicability(proposition.applicability_context)
    );
    const substitutionOperators = new Set(declaredCrossConstraints
      .filter(({ kind }) => kind === "reference_equivalence_substitution")
      .flatMap(({ equivalence_operators: operators }) => operators));
    const equivalenceParentsByApplicability = new Map();
    const equivalenceParent = (applicability) => {
      const parent = equivalenceParentsByApplicability.get(applicability) ?? new Map();
      equivalenceParentsByApplicability.set(applicability, parent);
      return parent;
    };
    const findEquivalent = (parent, value) => {
      if (!parent.has(value)) parent.set(value, value);
      const current = parent.get(value);
      if (current !== value) parent.set(value, findEquivalent(parent, current));
      return parent.get(value);
    };
    const unionEquivalent = (parent, left, right) => {
      const leftRoot = findEquivalent(parent, left);
      const rightRoot = findEquivalent(parent, right);
      if (leftRoot === rightRoot) return;
      const [canonicalRoot, otherRoot] = [leftRoot, rightRoot].sort(compareCodeUnits);
      parent.set(otherRoot, canonicalRoot);
    };
    const equivalenceClaims = mandatoryClaims.filter((claim) => {
      const proposition = claim.proposition;
      return claim.modality === "MUST" &&
        substitutionOperators.has(proposition.operator) &&
        proposition.operands.every(({ kind }) => kind === "reference");
    });
    const unconditionalApplicabilityKey = JSON.stringify({
      mode: "unconditional",
      operand_reference_ids: []
    });
    const unconditionalParent = unconditionalEquivalenceIsGlobal
      ? equivalenceParent(unconditionalApplicabilityKey)
      : null;
    const unionClaim = (claim, parent, normalizeReference = (value) => value) => {
      const proposition = claim.proposition;
      for (const operand of proposition.operands) unionEquivalent(
        parent,
        normalizeReference(proposition.subject_reference_id),
        normalizeReference(operand.reference_id)
      );
    };
    if (unconditionalEquivalenceIsGlobal) {
      for (const claim of equivalenceClaims.filter(
        ({ proposition }) => applicabilityKey(proposition) === unconditionalApplicabilityKey
      )) unionClaim(claim, unconditionalParent);
      const normalizeUnconditional = (referenceId) =>
        findEquivalent(unconditionalParent, referenceId);
      for (const claim of equivalenceClaims.filter(
        ({ proposition }) => applicabilityKey(proposition) !== unconditionalApplicabilityKey
      )) unionClaim(
        claim,
        equivalenceParent(applicabilityKey(claim.proposition)),
        normalizeUnconditional
      );
    } else {
      for (const claim of equivalenceClaims) unionClaim(
        claim,
        equivalenceParent(applicabilityKey(claim.proposition))
      );
    }
    const equivalentReference = (proposition, referenceId) => {
      const unconditionalReference = unconditionalEquivalenceIsGlobal
        ? findEquivalent(unconditionalParent, referenceId)
        : referenceId;
      const parent = equivalenceParentsByApplicability.get(applicabilityKey(proposition));
      return parent ? findEquivalent(parent, unconditionalReference) : unconditionalReference;
    };
    const contradictionOperands = (proposition) => normalizedOperands(
      proposition.operator,
      proposition.operands.map((operand) => operand.kind === "reference"
        ? { ...operand, reference_id: equivalentReference(proposition, operand.reference_id) }
        : operand)
    );
    const sameScope = (left, right) =>
      sameApplicability(left, right) &&
      equivalentReference(left, left.subject_reference_id) ===
        equivalentReference(right, right.subject_reference_id);
    const symmetricEdges = (proposition) => {
      if (!symmetric.has(proposition.operator) ||
          proposition.operands.some(({ kind }) => kind !== "reference")) return [];
      return proposition.operands.map((operand) => JSON.stringify([
        equivalentReference(proposition, proposition.subject_reference_id),
        equivalentReference(proposition, operand.reference_id)
      ].sort(compareCodeUnits)));
    };
    const sameSymmetricRelation = (left, right) => {
      if (!sameApplicability(left, right)) return false;
      const rightEdges = new Set(symmetricEdges(right));
      return symmetricEdges(left).some((edge) => rightEdges.has(edge));
    };

    for (let leftIndex = 0; leftIndex < mandatoryClaims.length; leftIndex += 1) {
      const left = mandatoryClaims[leftIndex];
      for (let rightIndex = leftIndex + 1;
        rightIndex < mandatoryClaims.length;
        rightIndex += 1) {
        const right = mandatoryClaims[rightIndex];
        const leftProposition = left.proposition;
        const rightProposition = right.proposition;
        const ordinarySameScope = sameScope(leftProposition, rightProposition);
        const symmetricSameScope = sameSymmetricRelation(leftProposition, rightProposition);
        if (!ordinarySameScope && !symmetricSameScope) continue;
        const sameOperands = JSON.stringify(contradictionOperands(leftProposition)) ===
          JSON.stringify(contradictionOperands(rightProposition));
        const sameControlledRelation = ordinarySameScope && sameOperands || symmetricSameScope;
        if (leftProposition.operator === rightProposition.operator && sameControlledRelation &&
            left.modality !== right.modality) {
          emit(left, right, "opposed_modality");
          continue;
        }
        if (ordinarySameScope && leftProposition.operator === rightProposition.operator &&
            left.modality !== right.modality &&
            pointwiseRelations.has(leftProposition.operator)) {
          const leftOperands = new Set(contradictionOperands(leftProposition).map(
            (operand) => JSON.stringify(operand)
          ));
          const overlaps = contradictionOperands(rightProposition).some(
            (operand) => leftOperands.has(JSON.stringify(operand))
          );
          if (overlaps) {
            emit(left, right, "opposed_modality");
            continue;
          }
        }
        const sameComplementPolarity = left.modality === right.modality &&
          complementModalities.has(left.modality);
        const complement = complements.get(leftProposition.operator);
        if (sameComplementPolarity && complement?.kind === "operator" &&
            complement.term === rightProposition.operator && sameControlledRelation) {
          emit(left, right, "opposed_operator");
          continue;
        }
        if (sameComplementPolarity && leftProposition.operator === rightProposition.operator &&
            operandsAreControlledComplements(
              leftProposition.operator,
              leftProposition.operands,
              rightProposition.operands
            )) {
          emit(left, right, "opposed_boolean_value");
          continue;
        }
        if (left.modality !== "MUST" || right.modality !== "MUST") continue;
        if (leftProposition.operator === rightProposition.operator &&
            functional.has(leftProposition.operator) && !sameOperands) {
          emit(left, right, "conflicting_functional_value");
          continue;
        }
        if (leftProposition.operator === rightProposition.operator &&
            rangeConstraints.has(leftProposition.operator)) {
          const leftRange = leftProposition.operands[0];
          const rightRange = rightProposition.operands[0];
          const lower = Math.max(
            leftRange.minimum ?? Number.NEGATIVE_INFINITY,
            rightRange.minimum ?? Number.NEGATIVE_INFINITY
          );
          const upper = Math.min(
            leftRange.maximum ?? Number.POSITIVE_INFINITY,
            rightRange.maximum ?? Number.POSITIVE_INFINITY
          );
          if (lower > upper) emit(left, right, "empty_range_conjunction");
        }
        for (const constraint of declaredCrossConstraints) {
          if (constraint.kind !== "exact_number_within_range") continue;
          const exactOnLeft = constraint.exact_operators.includes(leftProposition.operator) &&
            constraint.range_operators.includes(rightProposition.operator);
          const exactOnRight = constraint.exact_operators.includes(rightProposition.operator) &&
            constraint.range_operators.includes(leftProposition.operator);
          if (!exactOnLeft && !exactOnRight) continue;
          const exact = (exactOnLeft ? leftProposition : rightProposition).operands[0].value;
          const range = (exactOnLeft ? rightProposition : leftProposition).operands[0];
          if ((range.minimum !== undefined && exact < range.minimum) ||
              (range.maximum !== undefined && exact > range.maximum)) {
            emit(left, right, "cross_operator_constraint");
          }
        }
      }
    }

    for (const operator of transitive) {
      const complement = complements.get(operator);
      if (complement?.kind !== "operator") continue;
      const claimsByApplicability = new Map();
      for (const claim of mandatoryClaims) {
        if (claim.modality !== "MUST" ||
            ![operator, complement.term].includes(claim.proposition.operator) ||
            claim.proposition.operands.length !== 1 ||
            claim.proposition.operands[0].kind !== "reference") continue;
        const applicability = JSON.stringify(normalizedApplicability(
          claim.proposition.applicability_context
        ));
        const group = claimsByApplicability.get(applicability) ?? [];
        group.push(claim);
        claimsByApplicability.set(applicability, group);
      }
      for (const claims of claimsByApplicability.values()) {
        const parent = new Map();
        const find = (value) => {
          if (!parent.has(value)) parent.set(value, value);
          const current = parent.get(value);
          if (current !== value) parent.set(value, find(current));
          return parent.get(value);
        };
        const union = (left, right) => {
          const leftRoot = find(left);
          const rightRoot = find(right);
          if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
        };
        const positive = claims.filter(({ proposition }) => proposition.operator === operator);
        for (const { proposition } of positive) union(
          proposition.subject_reference_id,
          proposition.operands[0].reference_id
        );
        for (const negative of claims.filter(
          ({ proposition }) => proposition.operator === complement.term
        )) {
          const left = negative.proposition.subject_reference_id;
          const right = negative.proposition.operands[0].reference_id;
          if (find(left) !== find(right)) continue;
          const contributing = positive.filter(({ proposition }) =>
            find(proposition.subject_reference_id) === find(left) ||
            find(proposition.operands[0].reference_id) === find(left)
          );
          const claimIds = [...new Set([
            ...contributing.map(({ claim_id: claimId }) => claimId),
            negative.claim_id
          ])].sort(compareCodeUnits);
          const key = `transitive_opposed_operator\0${claimIds.join("\0")}`;
          if (emitted.has(key)) continue;
          emitted.add(key);
          diagnostics.push({
            code: "direct_proposition_contradiction",
            reason: "transitive_opposed_operator",
            claim_ids: claimIds,
            proposition_ids: [...new Set([
              ...contributing.map(({ proposition_id: propositionId }) => propositionId),
              negative.proposition_id
            ])].sort(compareCodeUnits)
          });
        }
      }
    }
    for (const constraint of declaredCrossConstraints) {
      if (constraint.kind !== "exact_number_not_below_declared_membership") continue;
      for (const exactClaim of mandatoryClaims) {
        if (exactClaim.modality !== "MUST" ||
            !constraint.exact_operators.includes(exactClaim.proposition.operator) ||
            exactClaim.proposition.operands.length !== 1 ||
            exactClaim.proposition.operands[0].kind !== "number") continue;
        const populationId = equivalentReference(
          exactClaim.proposition,
          exactClaim.proposition.subject_reference_id
        );
        const members = new Set();
        const contributingClaims = [];
        for (const membershipClaim of mandatoryClaims) {
          if (membershipClaim.modality !== "MUST") continue;
          const exactScope = normalizedApplicability(
            exactClaim.proposition.applicability_context
          );
          if (!sameApplicability(exactClaim.proposition, membershipClaim.proposition) &&
              !(constraint.scope_matching === "same_or_exact_unconditional" &&
                exactScope.mode === "unconditional")) continue;
          const proposition = membershipClaim.proposition;
          if (constraint.contains_operators.includes(proposition.operator) &&
              equivalentReference(
                exactClaim.proposition,
                proposition.subject_reference_id
              ) === populationId) {
            for (const operand of proposition.operands) {
              if (operand.kind === "reference") members.add(equivalentReference(
                exactClaim.proposition,
                operand.reference_id
              ));
            }
            contributingClaims.push(membershipClaim);
          }
          if (constraint.member_of_operators.includes(proposition.operator) &&
              proposition.operands.some(({ kind, reference_id: referenceId }) =>
                kind === "reference" && equivalentReference(
                  exactClaim.proposition,
                  referenceId
                ) === populationId
              )) {
            members.add(equivalentReference(
              exactClaim.proposition,
              proposition.subject_reference_id
            ));
            contributingClaims.push(membershipClaim);
          }
        }
        const exactCount = exactClaim.proposition.operands[0].value;
        if (members.size <= exactCount) continue;
        const involvedClaims = [
          exactClaim,
          ...contributingClaims
        ].filter(({ claim_id: claimId }, index, claims) =>
          claims.findIndex(({ claim_id: candidateId }) => candidateId === claimId) === index
        );
        const claimIds = involvedClaims
          .map(({ claim_id: claimId }) => claimId)
          .sort(compareCodeUnits);
        const key = `cross_operator_constraint\0${claimIds.join("\0")}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        diagnostics.push({
          code: "direct_proposition_contradiction",
          reason: "cross_operator_constraint",
          constraint_id: constraint.constraint_id,
          claim_ids: claimIds,
          proposition_ids: involvedClaims
            .map(({ proposition_id: propositionId }) => propositionId)
            .sort(compareCodeUnits),
          declared_member_count: members.size,
          exact_cardinality: exactCount
        });
      }
    }
    const processedOrderPairs = new Set();
    for (const operator of transitive) {
      if (!irreflexive.has(operator)) continue;
      const inverse = inverses.get(operator);
      const pairedOperator = inverse?.kind === "operator" ? inverse.term : operator;
      if (!transitive.has(pairedOperator) || !irreflexive.has(pairedOperator)) continue;
      const pair = [operator, pairedOperator].sort(compareCodeUnits);
      const pairKey = pair.join("\0");
      if (processedOrderPairs.has(pairKey)) continue;
      processedOrderPairs.add(pairKey);
      const canonicalOperator = pair[0];
      const groups = new Map();
      for (const claim of mandatoryClaims) {
        if (claim.modality !== "MUST" ||
            !pair.includes(claim.proposition.operator) ||
            claim.proposition.operands.some(({ kind }) => kind !== "reference")) continue;
        const applicability = JSON.stringify(normalizedApplicability(
          claim.proposition.applicability_context
        ));
        const edges = groups.get(applicability) ?? [];
        for (const operand of claim.proposition.operands) {
          const forward = claim.proposition.operator === canonicalOperator;
          edges.push({
            from: forward
              ? claim.proposition.subject_reference_id
              : operand.reference_id,
            to: forward
              ? operand.reference_id
              : claim.proposition.subject_reference_id,
            claim
          });
        }
        groups.set(applicability, edges);
      }
      for (const edges of groups.values()) {
        const orderedEdges = [...edges].sort((left, right) =>
          compareCodeUnits(left.from, right.from) ||
          compareCodeUnits(left.to, right.to) ||
          compareCodeUnits(left.claim.claim_id, right.claim.claim_id)
        );
        const outgoing = new Map();
        for (const edge of orderedEdges) {
          const entries = outgoing.get(edge.from) ?? [];
          entries.push(edge);
          outgoing.set(edge.from, entries);
        }
        const findPath = (from, target, visited = new Set()) => {
          if (from === target) return [];
          if (visited.has(from)) return null;
          const nextVisited = new Set(visited).add(from);
          for (const edge of outgoing.get(from) ?? []) {
            const suffix = findPath(edge.to, target, nextVisited);
            if (suffix !== null) return [edge, ...suffix];
          }
          return null;
        };
        for (const edge of orderedEdges) {
          const returnPath = findPath(edge.to, edge.from);
          if (returnPath === null) continue;
          const contributing = [edge, ...returnPath].map(({ claim }) => claim);
          const claimIds = [...new Set(contributing.map(
            ({ claim_id: claimId }) => claimId
          ))].sort(compareCodeUnits);
          const key = `ordering_cycle\0${claimIds.join("\0")}`;
          if (emitted.has(key)) continue;
          emitted.add(key);
          diagnostics.push({
            code: "direct_proposition_contradiction",
            reason: "ordering_cycle",
            operators: pair,
            claim_ids: claimIds,
            proposition_ids: [...new Set(contributing.map(
              ({ proposition_id: propositionId }) => propositionId
            ))].sort(compareCodeUnits)
          });
        }
      }
    }
    return diagnostics.sort((left, right) => compareCodeUnits(
      JSON.stringify(canonicalValue(left)),
      JSON.stringify(canonicalValue(right))
    ));
  }

  function validateAndResolve(contract) {
    if (!validateSchema(contract)) return {
      carrier_version: carrierVersion,
      schema_valid: false,
      schema_errors: structuredClone(validateSchema.errors),
      facts: null,
      diagnostics: [],
      graph: null
    };

    const referenceById = new Map(
      contract.references.map((reference) => [reference.reference_id, reference])
    );
    const propositionIds = new Set(
      contract.propositions.map(({ proposition_id: propositionId }) => propositionId)
    );
    const diagnostics = [
      ...duplicateIds(contract.references, "reference_id", "duplicate_reference_id"),
      ...duplicateReferenceIdentities(contract.references),
      ...duplicateIds(contract.propositions, "proposition_id", "duplicate_proposition_id"),
      ...duplicateIds(contract.claims, "claim_id", "duplicate_claim_id"),
      ...duplicateIds(contract.relations, "relation_id", "duplicate_relation_id"),
      ...duplicateIds(contract.collections, "collection_id", "duplicate_collection_id"),
      ...duplicateIds(contract.residue, "residue_id", "duplicate_residue_id"),
      ...duplicateIds(contract.annotations, "annotation_id", "duplicate_annotation_id"),
      ...directPropositionContradictions(contract),
      ...validatePopulationRelations(contract)
    ];

    for (const proposition of contract.propositions) {
      if (!referenceById.has(proposition.subject_reference_id)) diagnostics.push({
        code: "dangling_proposition_subject",
        proposition_id: proposition.proposition_id,
        reference_id: proposition.subject_reference_id
      });
      for (const referenceId of proposition.applicability_context.operand_reference_ids) {
        if (!referenceById.has(referenceId)) diagnostics.push({
          code: "dangling_context_operand",
          proposition_id: proposition.proposition_id,
          reference_id: referenceId
        });
      }
      for (const operand of proposition.operands) {
        if (operand.kind === "reference" && !referenceById.has(operand.reference_id)) {
          diagnostics.push({
            code: "dangling_proposition_operand",
            proposition_id: proposition.proposition_id,
            reference_id: operand.reference_id
          });
        }
        if (operand.kind === "range" && operand.minimum !== undefined &&
            operand.maximum !== undefined && operand.minimum > operand.maximum) {
          diagnostics.push({
            code: "invalid_range_order",
            proposition_id: proposition.proposition_id,
            minimum: operand.minimum,
            maximum: operand.maximum
          });
        }
        if (operand.kind === "reference" &&
            operand.reference_id === proposition.subject_reference_id &&
            irreflexive.has(proposition.operator)) diagnostics.push({
          code: "irreflexive_proposition",
          proposition_id: proposition.proposition_id,
          operator: proposition.operator,
          reference_id: operand.reference_id
        });
      }
      diagnostics.push(...validatePropositionSemantics({ proposition, referenceById }));
    }

    for (const claim of contract.claims) {
      if (!propositionIds.has(claim.proposition_id)) diagnostics.push({
        code: "dangling_claim_proposition",
        claim_id: claim.claim_id,
        proposition_id: claim.proposition_id
      });
      if (claim.kind === "verification" &&
          !propositionIds.has(claim.falsifying_proposition_id)) diagnostics.push({
        code: "dangling_falsifying_proposition",
        claim_id: claim.claim_id,
        proposition_id: claim.falsifying_proposition_id
      });
    }

    const graph = resolveNativeContractDag(contract);
    const carrierDuplicateIdCodes = new Set([
      "duplicate_claim_id", "duplicate_relation_id", "duplicate_collection_id"
    ]);
    diagnostics.push(...graph.diagnostics.filter(
      ({ code }) => !carrierDuplicateIdCodes.has(code)
    ));
    diagnostics.sort((left, right) =>
      compareCodeUnits(left.code, right.code) || compareCodeUnits(
        JSON.stringify(canonicalValue(left)),
        JSON.stringify(canonicalValue(right))
      )
    );

    return {
      carrier_version: carrierVersion,
      schema_valid: true,
      schema_errors: [],
      facts: {
        reference_count: contract.references.length,
        proposition_count: contract.propositions.length,
        operative_residue_count: contract.residue.length,
        annotation_count: contract.annotations.length,
        ...graph.facts
      },
      diagnostics,
      graph
    };
  }

  return {
    controlledComplement(operator) {
      return structuredClone(complements.get(operator) ?? { kind: "none" });
    },
    normalizeOperands: normalizedOperands,
    validateAndResolve
  };
}

export { canonicalValue, compareCodeUnits, createNativeContractRuntime };
