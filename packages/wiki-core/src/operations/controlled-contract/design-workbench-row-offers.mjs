

import { controlledContractPrettyJsonBytes } from "./semantic-projection-bounds.mjs";
import { controlledAcceptancePrepareDesignCall } from "../../lib/work-record-proof-posture.mjs";
import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from
  "./contract-requirement-vocabulary.mjs";
import { COVERAGE_ANSWER_LIMITS } from "./design-workbench-response-input.mjs";

export function referenceAttemptRecoveryOffer({ wkId, focus }) {
  const refresh = controlledAcceptancePrepareDesignCall(wkId);
  return {
    state: "retryable", basis: "owner_certified_effect_free",
    explanation: "Refresh rechecks current sources and the retained attempt. It does not supply missing semantic facts or guarantee that owner prerequisites are satisfied.",
    next_call: { ...refresh, arguments: { subject: {
      ...refresh.arguments.subject, ...(focus == null ? {} : { focus }) } } }
  };
}

export function coverageSessionBinding(repoRoot, subject, continuation, family) {
  return { repoRoot, wkId: subject.wk_id, focus: subject.focus ?? null, continuation, family };
}

export function coverageAuthoringOffer(contracts, dimensionId, population = false) {
  return {
    field_contracts: structuredClone(contracts),
    constraints: dimensionId === "obligation_coverage" ? Object.freeze({
      obligation_id: Object.freeze({ required_for_multiple_per_criterion: true,
        format: "uppercase hyphenated segments",
        pattern: "^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$",
        example: "OBL-MYWORK-001", unique_within_population: true }),
      statement: Object.freeze({ atomic: true, trimmed: true,
        line_count: 1, newlines_allowed: false }),
      criterion_partition: "one_or_more_atomic_obligations_per_criterion",
      final_batch_signal: "population_complete:true publishes an explicit multi-obligation population after every criterion is covered"
    }) : Object.freeze({
      criterion_partition: "exactly_one_acceptance_disposition_per_criterion"
    }),
    ...(population ? { population_authoring: {
      maximum_entries_per_answer: COVERAGE_ANSWER_LIMITS.entries,
      maximum_response_bytes: COVERAGE_ANSWER_LIMITS.bytes,
      publication: "complete_population_atomic",
      instructions: dimensionId === "obligation_coverage"
        ? "Use the offered session to submit bounded batches. Give distinct obligation_id values when a criterion has several atomic obligations and send population_complete:true only with the final batch. Accepted answers remain session-only until every criterion validates and the explicit population is complete. An identical retry changes nothing; replacing an accepted answer requires correction:true at the current revision."
        : "Use the offered session to submit bounded batches. Accepted answers remain session-only until every criterion validates and coverage is published. An identical retry changes nothing; replacing an accepted answer requires correction:true at the current revision."
    } } : {}),
    admitted_pack_components_source: {
      collection: "dimensions", selector: { id: dimensionId },
      field_path: ["owner_result", "coverage_authoring", "admitted_pack_components"]
    }
  };
}

export const CONTRACT_REQUIREMENT_OFFER_BYTES = Object.freeze({
  opening: 11_264, extension: 7_168
});

const CONTRACT_REQUIREMENT_OFFER_SOURCE = Object.freeze({
  row: "authoring_stage",
  collection: "dimensions",
  selector: Object.freeze({ id: "authoring_stage" }),
  field_path: Object.freeze(["owner_result", "contract_authoring"])
});

function referentAccounting(total, returned) {
  return { total, returned, omitted: total - returned };
}

function offerPointer(field, schemaVersion) {
  return Object.freeze({
    schema_version: schemaVersion,
    omitted_for_row_bound: true,
    ...CONTRACT_REQUIREMENT_OFFER_SOURCE,
    field_path: Object.freeze([...CONTRACT_REQUIREMENT_OFFER_SOURCE.field_path, field])
  });
}

export function contractRequirementAuthoring(facts,
  allowance = CONTRACT_REQUIREMENT_OFFER_BYTES.opening) {
  const offer = {
    schema_version: "controlled-contract-requirement-authoring.v1",
    response_kind: "contract_requirements",
    input_shape: Object.freeze({
      kind: "contract_requirements",
      definitions: structuredClone(facts.input_shapes),
      requirements: Object.freeze({ type: "array", minimum: 1,
        maximum: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
        items: Object.freeze({
          required: Object.freeze(["modality", "subject", "behavior"]),
          optional: Object.freeze(["nature", "verification"]),
          fields: Object.freeze({
            subject: Object.freeze({ shape: "#/definitions/referent",
              meaning: "the requirement subject" }),
            behavior: Object.freeze({ shape: "#/definitions/statement",
              concerns: "the requirement subject" }),
            verification: Object.freeze({
              shape: "{method, verifier, observes, fails_when, runtime_test?}",
              fields: Object.freeze({
                verifier: Object.freeze({ shape: "#/definitions/referent" }),
                observes: Object.freeze({ shape: "#/definitions/statement",
                  concerns: "verification.verifier" }),
                fails_when: Object.freeze({ shape: "#/definitions/statement",
                  concerns: "the requirement subject" })
              })
            })
          })
        }) }),
      unrepresentable_meaning: Object.freeze({ type: "array",
        maximum: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.residue_per_answer,
        optional: true, items: "{reason,text,candidate_concept?}" }),
      notes: Object.freeze({ type: "array",
        maximum: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.notes_per_answer, optional: true,
        items: "{kind,text}" })
    }),
    constraints: Object.freeze({
      maximum_requirements_per_answer:
        CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
      operand_cardinality:
        "owned per relation by vocabulary.relation_details minimum_operands and maximum_operands; null maximum means no count ceiling within the complete-response byte bound",
      maximum_context_referents:
        CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.context_referents,
      maximum_text_bytes: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.text_bytes,
      maximum_complete_response_json_utf8_bytes: COVERAGE_ANSWER_LIMITS.bytes,
      complete_response_serialization:
        "Buffer.byteLength(JSON.stringify(response), 'utf8')",
      statements: "one relation per statement; operands use the relation-owned kind",
      runtime_test_partition: "When extending an existing contract, requirements that add test_execution proofs must be submitted separately from non-test requirements; initial creation remains one atomic mixed-method publication."
    }),
    vocabulary: structuredClone(facts.vocabulary),
    examples: structuredClone(facts.examples),

    runtime_test: structuredClone(facts.runtime_test),
    criteria: structuredClone(facts.criteria),
    declared_referents: [],
    declared_referent_accounting: referentAccounting(
      facts.declared_referents.length, 0)
  };
  const over = () => controlledContractPrettyJsonBytes(offer) > allowance;

  if (over()) offer.runtime_test = offerPointer("runtime_test",
    facts.runtime_test.schema_version);

  if (over()) offer.vocabulary = offerPointer("vocabulary",
    facts.vocabulary.schema_version);
  for (const referent of facts.declared_referents) {
    offer.declared_referents.push(structuredClone(referent));
    offer.declared_referent_accounting = referentAccounting(
      facts.declared_referents.length, offer.declared_referents.length);
    if (!over()) continue;
    offer.declared_referents.pop();
    offer.declared_referent_accounting = referentAccounting(
      facts.declared_referents.length, offer.declared_referents.length);
    break;
  }
  if (offer.declared_referent_accounting.omitted > 0) {
    offer.declared_referent_source = CONTRACT_REQUIREMENT_OFFER_SOURCE;
  }
  return offer;
}

export function runtimeTestReplacementAuthoring(facts, verificationClaimId, current = null) {
  const declared = structuredClone(current ?? (facts.declared_runtime_tests ?? []).find(
    ({ verification_claim_id: id }) => id === verificationClaimId)?.declared ?? null);
  const answers = structuredClone(facts.runtime_test.answers);
  const declaredPopulation = declared?.falsifiers ?? {
    total_count: 0, returned_count: 0, omitted_count: 0, items: [] };
  const population = { ...declaredPopulation,
    items: declaredPopulation.items.map(({ selector, mutation_id: mutationId,
      proposition_id: propositionId, ...meaning }) => ({
      answer: { select: selector, ...meaning },
      read_only: { falsifier_id: selector,
        mutation_id: mutationId, proposition_id: propositionId }
    })) };
  const projectedShared = declared === null ? null : Object.fromEntries(
    Object.entries(declared).filter(([key]) => key !== "falsifiers"));
  const currentShared = projectedShared === null ? null : {
    ...projectedShared,
    boundary: { ...projectedShared.boundary,
      subjects: projectedShared.boundary.subjects.map((select) => ({ select })) }
  };
  return {
    schema_version: "controlled-contract-runtime-test-replacement-authoring.v1",
    response_kind: "runtime_test_replacement",
    operation: "selected_falsifier_update",
    preserves_unselected_falsifiers: true,
    shared_fields: {
      answers: answers.filter(({ field }) => !field.startsWith("falsifier.")),
      omission: "preserve",
      current_answer: currentShared,

      selector_semantics: { response_field: "runtime_test.selector",
        omitted: "preserve", object: "replace",
        execution_evidence: "owned_by_workspace_verify_proof" }
    },
    selected_falsifier: {
      selector_field: "runtime_test.falsifier.select",
      meaning_field: "runtime_test.falsifier",
      answers: answers.filter(({ field }) => field.startsWith("falsifier.")),
      current_population: population,
      retrieval: {
        collection: "actionable_rows",
        selector_field: "row_id",
        field_path: ["evidence", "authoring", "selected_falsifier", "current_population"]
      }
    }
  };
}

export function currentDefinitionReauthoringOffer(qualification) {
  return Object.freeze({
    schema_version: "controlled-contract-current-definition-reauthoring-offer.v1",
    response_kind: "current_definition_reauthoring",
    source_shape: qualification.source_shape,
    affected_definition_count: qualification.affected_definition_count,
    definitions: structuredClone(qualification.definitions),
    answer: Object.freeze({
      identity_field: "verification_claim_id",
      required_fields: Object.freeze([
        "verification_claim_id", "retire_fields", "runtime_test"
      ]),
      runtime_test: Object.freeze({
        required_fields: Object.freeze(["selector"]),
        selector: structuredClone(qualification.selector)
      }),
      retirement_confirmation: "retire_fields must exactly equal the unexpected_fields returned for that definition"
    }),
    preservation: Object.freeze({
      unchanged_definition_fields: true,
      all_falsifiers: true,
      verification_outcomes: "not_read_or_transferred"
    }),
    population_authoring: Object.freeze({
      publication: "complete_population_atomic",
      instructions: "Use the offered session to submit complete definition answers. Nothing is published until every affected definition has one valid current selector and exact retired-field confirmation."
    })
  });
}
