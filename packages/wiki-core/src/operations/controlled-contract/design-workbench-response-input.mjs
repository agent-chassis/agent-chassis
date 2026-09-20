import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from
  "./contract-requirement-vocabulary.mjs";

export const CONTROLLED_CONTRACT_ANSWER_LIMITS = Object.freeze({
  maximum_json_utf8_bytes: 16_384,
  serialization: "Buffer.byteLength(JSON.stringify(response), 'utf8')"
});

export const COVERAGE_ANSWER_LIMITS = Object.freeze({
  entries: 64,
  bytes: CONTROLLED_CONTRACT_ANSWER_LIMITS.maximum_json_utf8_bytes
});

function batchingGuidance(responseKind) {
  if (responseKind === "contract_requirements") return Object.freeze({
    supported: true,
    unit: "complete_requirements",
    maximum_items_per_answer: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
    preserves: "Every intended requirement and its verification method must remain unchanged across batches.",
    method_partition: "For an existing contract, submit complete test_execution requirements separately from complete non-test requirements.",
    continuation: "After each established publication, refresh the same front door and use its current add_requirements action.",
    publication: "Each batch is independently validated and published by its incumbent owner; there is no atomicity across batches.",
    oversized_single_item: "unsupported: one indivisible requirement that exceeds the complete-answer byte limit has no field-fragment route"
  });
  if (responseKind === "current_definition_reauthoring") return Object.freeze({
    supported: true,
    unit: "complete_definition_answers",
    maximum_items_per_answer: COVERAGE_ANSWER_LIMITS.entries,
    continuation: "Use the emitted population session revision for the next complete-definition batch.",
    publication: "Session batches remain unpublished until the incumbent definition owner accepts the complete server-selected population.",
    oversized_single_item: "unsupported: one indivisible definition answer that exceeds the complete-answer byte limit has no field-fragment route"
  });
  if (["obligation_coverage_population", "acceptance_coverage_population"]
    .includes(responseKind)) return Object.freeze({
    supported: true,
    unit: "complete_criterion_answers",
    maximum_items_per_answer: COVERAGE_ANSWER_LIMITS.entries,
    continuation: "Use the emitted coverage session revision for the next complete-item batch.",
    publication: "Session batches remain unpublished until the incumbent population owner accepts the complete population.",
    oversized_single_item: "unsupported: one indivisible criterion answer that exceeds the complete-answer byte limit has no field-fragment route"
  });
  return Object.freeze({
    supported: false,
    unit: "one_complete_semantic_answer",
    oversized_single_item: "unsupported: this response kind has no partial-field or fragmentation route"
  });
}

export function controlledContractAnswerLimits(responseKinds) {
  return Object.freeze(responseKinds.map((responseKind) => Object.freeze({
    response_kind: responseKind,
    ...CONTROLLED_CONTRACT_ANSWER_LIMITS,
    includes: "kind and every nested response field",
    batching: batchingGuidance(responseKind)
  })));
}

export function withControlledContractAnswerLimits(authoring, responseKinds) {
  const projected = structuredClone(authoring ?? {});
  if (responseKinds.length === 1 && responseKinds[0] === "contract_requirements" &&
      projected.constraints !== undefined) return Object.freeze({ ...projected,
    constraints: Object.freeze({ ...projected.constraints,
      batching: batchingGuidance("contract_requirements") })
  });
  if (responseKinds.length === 1 &&
      ["obligation_coverage_population", "acceptance_coverage_population",
        "current_definition_reauthoring"]
        .includes(responseKinds[0]) && projected.population_authoring !== undefined) {
    return Object.freeze({ ...projected,
      population_authoring: Object.freeze({ ...projected.population_authoring,
        maximum_complete_response_json_utf8_bytes:
          CONTROLLED_CONTRACT_ANSWER_LIMITS.maximum_json_utf8_bytes,
        complete_response_serialization: CONTROLLED_CONTRACT_ANSWER_LIMITS.serialization,
        includes: "kind and every nested response field",
        batching: batchingGuidance(responseKinds[0]) })
    });
  }
  return Object.freeze({
    ...projected,
    complete_answer_limits: controlledContractAnswerLimits(responseKinds)
  });
}

export function controlledContractResponseBytes(response) {
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}
