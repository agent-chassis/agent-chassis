import { ExactBindingError } from "../../lib/deterministic-projection-primitives.mjs";
import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { TEST_PROOF_VERSION_V1 } from "../../lib/native-contract-carrier-v1.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";
import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import {
  POLICY_VERSION,
  PROHIBITED_FAMILIES
} from "../../lib/caller-input-authority-confinement-projection.mjs";
import {
  buildCallerInputAuthorityConfinementSources,
  objectKey,
  path,
  role
} from "./caller-input-authority-confinement-v1-fixture.mjs";
import {
  buildCallerInputAuthorityConfinementEvaluationInput
} from "./caller-input-authority-confinement-v1-profile.mjs";
import { durableIdentity } from "./authentication-provenance-v1-fixture.mjs";
import {
  EXCLUSIONS,
  GUARANTEE
} from "./caller-input-authority-confinement-v1-constants.mjs";

const GUARANTEE_DIGEST = sha256(Buffer.from(GUARANTEE, "utf8"));

function evaluate(profile, options = {}, mutate = (contract, input) => ({ contract, input })) {
  const captured = buildCallerInputAuthorityConfinementSources(options);
  const sourceContract = structuredClone(captured.projection.contract);
  const contract = {
    ...sourceContract,
    test_proof_version: TEST_PROOF_VERSION_V1,
    test_proofs: buildStableTestProofPopulation(sourceContract)
  };
  const input = buildCallerInputAuthorityConfinementEvaluationInput(captured.projection);
  const changed = mutate(contract, input) ?? { contract, input };
  return evaluateStableProofPackFixtureV1({
    profile, contract: changed.contract, evaluation_input: changed.input
  }).satisfaction;
}

function positiveControls(profile) {
  const cases = [
    ["nested-array-and-path-opaque-control", {}],
    ["harmless-authority-bearing-label-value", {
      mutateForbiddenRequest(request) { request.options.displayMode = "label"; }
    }],
    ["alias-chain", {
      mutatePolicy(policy) {
        policy.aliases.push({
          alias: path(objectKey("options"), objectKey("legacyMode")),
          canonical: path(objectKey("options"), objectKey("displayMode"))
        });
      },
      mutateForbiddenRequest(request) {
        request.options.legacyMode = request.options.displayMode;
        delete request.options.displayMode;
      }
    }],
    ["unicode-member-and-value", {
      mutatePolicy(policy) {
        policy.declarations.push({
          path: path(objectKey("café")), classification: "allowed",
          resolution_coordinate_reference_ids: []
        });
      },
      mutateAcceptedRequest(request) { request["café"] = "東京"; }
    }],
    ["transport-decoding-once", {
      decoding: "percent_utf8_once",
      mutateAcceptedRequest(request) {
        request["qu%65ry"] = request.query;
        delete request.query;
      }
    }],
    ["declaration-property-and-set-reordering", {
      mutatePolicy(policy) {
        policy.declarations.reverse();
        policy.effects.reverse();
        policy.operations.reverse();
        policy.resolution_coordinates.reverse();
        policy.boundary_sources.reverse();
      }
    }],
    ["request-reserved-schema-discriminator", {
      mutatePolicy(policy) {
        policy.declarations.push({
          path: path(objectKey("schema_version")), classification: "allowed",
          resolution_coordinate_reference_ids: []
        });
      },
      mutateAcceptedRequest(request) { request.schema_version = POLICY_VERSION; }
    }],
    ["harmless-unrelated-graph-material", {}]
  ];
  return cases.map(([controlId, options]) => ({
    control_id: controlId,
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: evaluate(profile, options, controlId ===
      "harmless-unrelated-graph-material" ? (contract, input) => {
        contract.references.push({
          reference_id: "ref-cia-adequacy-unrelated",
          type_term: "cc:evidence",
          identity: { kind: "durable_id", domain: "adequacy", value: "unrelated" }
        });
        return { contract, input };
      } : undefined)
  }));
}

const transformerRejections = Object.freeze({
  "duplicate-declared-member": "caller_input_declared_population_invalid",
  "unclassified-declared-member": "caller_input_declaration_invalid",
  "overlapping-allowed-and-forbidden-partition": "caller_input_member_classification_invalid",
  "forbidden-member-without-coordinate": "caller_input_member_classification_invalid",
  "alias-cycle": "caller_input_alias_cycle",
  "alias-canonical-collision": "caller_input_alias_collision",
  "nfc-nfd-request-key-collision": "caller_input_request_key_collision",
  "double-transport-decoding": "caller_input_accepted_surface_invalid",
  "canonical-plus-alias-supply": "caller_input_alias_supply_collision",
  "coordinate-association-omission": "caller_input_coordinate_association_invalid",
  "operation-association-omission": "caller_input_operation_association_invalid",
  "operation-association-substitution": "caller_input_association_closure_invalid",
  "effect-association-substitution": "caller_input_operation_association_invalid",
  "ambiguous-duplicate-member-coordinate-association": "caller_input_member_classification_invalid",
  "incomplete-coordinate-population": "caller_input_server_coordinate_invalid",
  "incomplete-operation-population": "caller_input_association_closure_invalid",
  "incomplete-effect-population": "caller_input_operation_association_invalid",
  "same-path-opposite-classification-overlap": "caller_input_declared_population_invalid",
  "server-selected-coordinate-attribution": "caller_input_server_coordinate_invalid",
  "missing-mandatory-source-family": "caller_input_source_census_invalid",
  "duplicate-mandatory-source-family": "caller_input_source_census_invalid",
  "unknown-accepted-top-level-member": "caller_input_accepted_surface_invalid",
  "unknown-accepted-nested-member": "caller_input_accepted_surface_invalid",
  "unknown-accepted-array-member": "caller_input_accepted_surface_invalid",
  "unknown-forbidden-member": "caller_input_forbidden_surface_invalid",
  "missing-forbidden-member": "caller_input_forbidden_member_missing",
  "caller-authored-classification-label": "caller_input_accepted_surface_invalid",
  "accepted-request-digest-substitution": "caller_input_trace_request_attempt_crossing",
  "forbidden-attempt-crossing": "caller_input_trace_request_attempt_crossing",
  "accepted-parser-request-reference-id-splice": "caller_input_trace_request_attempt_crossing",
  "forbidden-disposition-attempt-reference-id-splice": "caller_input_trace_request_attempt_crossing",
  "forbidden-request-crossing": "caller_input_trace_request_attempt_crossing",
  "forbidden-disposition-substitution": "caller_input_parser_disposition_invalid",
  "refusal-identity-substitution": "caller_input_refusal_cut_invalid",
  "cut-refusal-crossing": "caller_input_refusal_cut_invalid",
  "cut-refusal-reference-id-splice": "caller_input_refusal_cut_invalid",
  "acceptance-refusal-grounded-identity-collision": "caller_input_refusal_cut_invalid",
  "cut-identity-substitution": "caller_input_sound_negative_boundary_splice",
  "accepted-request-refusal-crossing": "caller_input_acceptance_invalid",
  "duplicate-trace-position": "caller_input_trace_position_invalid",
  "nonmonotonic-trace-position": "caller_input_trace_position_invalid",
  "parser-accepted-but-ignored-forbidden-input": "caller_input_parser_disposition_invalid",
  "post-cut-record": "caller_input_refusal_cut_invalid",
  "unknown-trace-kind": "caller_input_trace_kind_unknown",
  "missing-observed-source": "sound_negative_projection_result_invalid",
  "duplicated-observed-source": "caller_input_sound_negative_not_absent",
  "unstable-observation-endpoint": "caller_input_sound_negative_not_absent",
  "mixed-source-endpoint": "caller_input_sound_negative_not_absent",
  "drifted-observation-version": "caller_input_sound_negative_not_absent",
  "unavailable-observation-source": "caller_input_sound_negative_not_absent",
  "unknown-source-outcome-kind": "sound_negative_source_outcome_invalid",
  "evidence-attempt-reference-id-splice": "caller_input_sound_negative_boundary_splice",
  "evidence-cut-reference-id-splice": "caller_input_sound_negative_boundary_splice",
  "duplicate-observation": "caller_input_sound_negative_not_absent",
  "reversed-observation-cut": "caller_input_sound_negative_not_absent",
  "wrong-attempt-pre-refusal-occurrence": "caller_input_trace_request_attempt_crossing",
  "operation-grounded-identity-splice": "caller_input_occurrence_association_invalid",
  "effect-grounded-identity-splice": "caller_input_occurrence_association_invalid",
  ...Object.fromEntries(PROHIBITED_FAMILIES.map((family) =>
    [`pre-refusal-${family}-occurrence`, "caller_input_prohibited_occurrence_before_refusal"]))
});

function invalidControl(controlId, options) {
  const expectedCode = transformerRejections[controlId];
  if (!expectedCode) throw new Error(`missing transformer rejection for ${controlId}`);
  let actualCode = null;
  try {
    buildCallerInputAuthorityConfinementSources(options);
  } catch (error) {
    if (!(error instanceof ExactBindingError) || error.code !== expectedCode) throw error;
    if (controlId.startsWith("pre-refusal-") && error.details.family !==
        controlId.slice("pre-refusal-".length, -"-occurrence".length)) throw error;
    if (controlId === "missing-observed-source" &&
        !error.details.diagnostics?.some(({ code, constraint_id: constraint }) =>
          code === "direct_proposition_contradiction" &&
          constraint === "exact-cardinality-not-below-declared-membership")) throw error;
    actualCode = error.code;
  }
  return {
    control_id: controlId,
    category: "mutant",
    implementation_outcome: actualCode === null ? "survived" : "killed",
    profile_satisfaction: "not_evaluated",
    rejection: {
      checker: "transformer", subject: "transformer_input",
      expected_reason: expectedCode, actual_reason: actualCode
    }
  };
}

function insertOccurrence(records, subject, family, { accepted = false, wrongAttempt = false } = {}) {
  const operation = subject.policy.operations[0].reference;
  const effect = subject.policy.effects.find(({ reference_id: referenceId }) =>
    referenceId === subject.policy.operations[0].effect_reference_ids[0]);
  const request = accepted ? subject.roles.acceptedRequest : subject.roles.forbiddenRequest;
  const attempt = accepted ? subject.roles.acceptedAttempt : subject.roles.forbiddenAttempt;
  records.splice(-1, 0, {
    kind: "occurrence",
    position: 0,
    request: structuredClone(request),
    attempt: structuredClone(wrongAttempt
      ? subject.roles.acceptedAttempt : attempt),
    request_sha256: records.find(({ request }) =>
      request.reference_id === (accepted
        ? subject.roles.acceptedRequest.reference_id
        : subject.roles.forbiddenRequest.reference_id)).request_sha256,
    family,
    operation: structuredClone(operation),
    effect: structuredClone(effect)
  });
  records.forEach((record, index) => { record.position = index + 1; });
}

function mutantControls() {
  const controls = [
    ["duplicate-declared-member", { mutatePolicy(policy) {
      policy.declarations.push(structuredClone(policy.declarations[0]));
    } }],
    ["unclassified-declared-member", { mutatePolicy(policy) {
      policy.declarations[0].classification = "caller-label";
    } }],
    ["overlapping-allowed-and-forbidden-partition", { mutatePolicy(policy) {
      policy.declarations[0].resolution_coordinate_reference_ids =
        [policy.resolution_coordinates[0].reference.reference_id];
    } }],
    ["forbidden-member-without-coordinate", { mutatePolicy(policy) {
      policy.declarations.find(({ classification }) =>
        classification === "authority_bearing_forbidden")
        .resolution_coordinate_reference_ids = [];
    } }],
    ["alias-cycle", { mutatePolicy(policy) {
      policy.aliases.push(
        { alias: path(objectKey("cycleA")), canonical: path(objectKey("cycleB")) },
        { alias: path(objectKey("cycleB")), canonical: path(objectKey("cycleA")) }
      );
    } }],
    ["alias-canonical-collision", { mutatePolicy(policy) {
      policy.aliases.push({
        alias: structuredClone(policy.declarations[0].path),
        canonical: structuredClone(policy.declarations[1].path)
      });
    } }],
    ["nfc-nfd-request-key-collision", {
      mutatePolicy(policy) {
        policy.declarations.push({
          path: path(objectKey("café")), classification: "allowed",
          resolution_coordinate_reference_ids: []
        });
      },
      mutateAcceptedRequest(request) {
        request["café"] = "one";
        request["cafe\u0301"] = "two";
      }
    }],
    ["double-transport-decoding", {
      decoding: "percent_utf8_once",
      mutateAcceptedRequest(request) {
        request["qu%2565ry"] = request.query;
        delete request.query;
      }
    }],
    ["canonical-plus-alias-supply", { mutateForbiddenRequest(request) {
      request.options.mode = "canonical-too";
    } }],
    ["coordinate-association-omission", { mutatePolicy(policy) {
      policy.resolution_coordinates[0].operation_reference_ids = [];
    } }],
    ["operation-association-omission", { mutatePolicy(policy) {
      policy.operations[0].effect_reference_ids = [];
    } }],
    ["operation-association-substitution", { mutatePolicy(policy) {
      policy.resolution_coordinates[0].operation_reference_ids = ["ref-unknown-operation"];
    } }],
    ["effect-association-substitution", { mutatePolicy(policy) {
      policy.operations[0].effect_reference_ids = ["ref-unknown-effect"];
    } }],
    ["ambiguous-duplicate-member-coordinate-association", { mutatePolicy(policy) {
      const declaration = policy.declarations.find(({ classification }) =>
        classification === "authority_bearing_forbidden");
      declaration.resolution_coordinate_reference_ids.push(
        declaration.resolution_coordinate_reference_ids[0]
      );
    } }],
    ["incomplete-coordinate-population", { mutatePolicy(policy) {
      policy.resolution_coordinates.pop();
    } }],
    ["incomplete-operation-population", { mutatePolicy(policy) {
      policy.operations.pop();
    } }],
    ["incomplete-effect-population", { mutatePolicy(policy) {
      policy.effects.pop();
    } }],
    ["same-path-opposite-classification-overlap", { mutatePolicy(policy) {
      policy.declarations.push({
        path: structuredClone(policy.declarations[0].path),
        classification: policy.declarations[0].classification === "allowed"
          ? "authority_bearing_forbidden" : "allowed",
        resolution_coordinate_reference_ids: [
          policy.resolution_coordinates[0].reference.reference_id
        ]
      });
    } }],
    ["server-selected-coordinate-attribution", { mutatePolicy(policy) {
      policy.declarations.find(({ classification }) =>
        classification === "authority_bearing_forbidden")
        .resolution_coordinate_reference_ids.push(
          policy.server_selected_coordinate_reference_ids[0]
        );
    } }],
    ["missing-mandatory-source-family", { mutatePolicy(policy) {
      policy.boundary_sources.pop();
    } }],
    ["duplicate-mandatory-source-family", { mutatePolicy(policy) {
      policy.boundary_sources[1].family = policy.boundary_sources[0].family;
    } }],
    ["unknown-accepted-top-level-member", { mutateAcceptedRequest(request) {
      request.unknown = "ignored";
    } }],
    ["unknown-accepted-nested-member", { mutateAcceptedRequest(request) {
      request.nested = { unknown: true };
    } }],
    ["unknown-accepted-array-member", { mutateAcceptedRequest(request) {
      request.items.push({ label: "surplus" });
    } }],
    ["unknown-forbidden-member", { mutateForbiddenRequest(request) {
      request.unknown = "ignored";
    } }],
    ["missing-forbidden-member", { mutateForbiddenRequest(request) {
      delete request.options.displayMode;
    } }],
    ["caller-authored-classification-label", { mutateAcceptedRequest(request) {
      request.classification = "allowed";
    } }],
    ["accepted-request-digest-substitution", { mutateTraceRecords(records) {
      records[1].request_sha256 = "0".repeat(64);
    } }],
    ["forbidden-attempt-crossing", { mutateTraceRecords(records, subject) {
      records[5].attempt = structuredClone(subject.roles.acceptedAttempt);
    } }],
    ["accepted-parser-request-reference-id-splice", { mutateTraceRecords(records, subject) {
      records.find(({ kind, request }) => kind === "parser_attempt" &&
        request.reference_id === subject.roles.acceptedRequest.reference_id)
        .request.reference_id = "ref-cia-accepted-request-spliced";
    } }],
    ["forbidden-disposition-attempt-reference-id-splice", {
      mutateTraceRecords(records, subject) {
        records.find(({ kind, request }) => kind === "parser_disposition" &&
          request.reference_id === subject.roles.forbiddenRequest.reference_id)
          .attempt.reference_id = "ref-cia-forbidden-attempt-spliced";
      }
    }],
    ["forbidden-request-crossing", { mutateTraceRecords(records, subject) {
      records[6].request = structuredClone(subject.roles.acceptedRequest);
    } }],
    ["forbidden-disposition-substitution", { mutateTraceRecords(records) {
      records[6].disposition = "accepted";
    } }],
    ["refusal-identity-substitution", { mutateTraceRecords(records) {
      records[7].refusal = role("ref-cia-refusal-substitute", "cc:event",
        durableIdentity("caller-input:disposition", "substitute"));
    } }],
    ["cut-refusal-crossing", { mutateTraceRecords(records) {
      records[8].refusal = role("ref-cia-refusal-substitute", "cc:event",
        durableIdentity("caller-input:disposition", "substitute"));
    } }],
    ["cut-refusal-reference-id-splice", { mutateTraceRecords(records) {
      records.find(({ kind }) => kind === "observation_cut").refusal.reference_id =
        "ref-cia-refusal-spliced";
    } }],
    ["acceptance-refusal-grounded-identity-collision", { mutateTraceRecords(records) {
      const acceptance = records.find(({ kind }) => kind === "acceptance").acceptance;
      records.find(({ kind }) => kind === "refusal").refusal.grounded_identity =
        structuredClone(acceptance.grounded_identity);
    } }],
    ["cut-identity-substitution", { mutateTraceRecords(records) {
      records[8].cut = structuredClone(records[7].refusal);
    } }],
    ["accepted-request-refusal-crossing", { mutateTraceRecords(records) {
      records[3].kind = "refusal";
      records[3].refusal = records[3].acceptance;
      delete records[3].acceptance;
    } }],
    ["duplicate-trace-position", { mutateTraceRecords(records) {
      records[7].position = records[6].position;
    } }],
    ["nonmonotonic-trace-position", { mutateTraceRecords(records) {
      records[7].position = records[6].position - 1;
    } }],
    ["parser-accepted-but-ignored-forbidden-input", { mutateTraceRecords(records, subject) {
      records.find(({ kind, request }) => kind === "parser_disposition" &&
        request.reference_id === subject.roles.forbiddenRequest.reference_id)
        .disposition = "accepted";
    } }],
    ["post-cut-record", { mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver");
      const occurrence = records.splice(-2, 1)[0];
      records.push(occurrence);
      records.forEach((record, index) => { record.position = index + 1; });
    } }],
    ["unknown-trace-kind", { mutateTraceRecords(records) {
      records[0].kind = "caller_conclusion";
    } }],
    ["missing-observed-source", { mutateEvidence(evidence) {
      evidence.source_outcomes.pop();
      evidence.declared_observation_total -= 1;
    } }],
    ["duplicated-observed-source", { mutateEvidence(evidence) {
      evidence.source_outcomes.push(structuredClone(evidence.source_outcomes[0]));
      evidence.declared_observation_total += 1;
    } }],
    ["unstable-observation-endpoint", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].endpoints[1].state = role(
        "ref-cia-drifted-state", "cc:state",
        durableIdentity("caller-input:drift", "state")
      );
    } }],
    ["mixed-source-endpoint", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].endpoints[1].source = structuredClone(
        evidence.source_outcomes[1].source
      );
    } }],
    ["drifted-observation-version", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].observations[0].observed_version = structuredClone(
        evidence.source_outcomes[1].endpoints[1].version
      );
    } }],
    ["unavailable-observation-source", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].kind = "store_failure";
      evidence.source_outcomes[0].observations = [];
      evidence.declared_observation_total -= 1;
    } }],
    ["unknown-source-outcome-kind", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].kind = "unknown";
    } }],
    ["evidence-attempt-reference-id-splice", { mutateEvidence(evidence) {
      evidence.attempt.reference_id = "ref-cia-forbidden-attempt-spliced";
    } }],
    ["evidence-cut-reference-id-splice", { mutateEvidence(evidence) {
      evidence.interval.end.reference_id = "ref-cia-observation-cut-spliced";
    } }],
    ["duplicate-observation", { mutateEvidence(evidence) {
      evidence.source_outcomes[0].observations.push(structuredClone(
        evidence.source_outcomes[0].observations[0]
      ));
      evidence.declared_observation_total += 1;
    } }],
    ["reversed-observation-cut", { mutateEvidence(evidence) {
      evidence.interval.end_sequence = evidence.interval.start_sequence - 1;
    } }]
  ];
  for (const family of PROHIBITED_FAMILIES) controls.push([
    `pre-refusal-${family}-occurrence`,
    { mutateTraceRecords(records, subject) { insertOccurrence(records, subject, family); } }
  ]);
  controls.push(["wrong-attempt-pre-refusal-occurrence", {
    mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver", { wrongAttempt: true });
    }
  }]);
  controls.push(["operation-grounded-identity-splice", {
    mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver", { accepted: true });
      records.find(({ kind }) => kind === "occurrence").operation.grounded_identity.value =
        "spliced-operation";
    }
  }]);
  controls.push(["effect-grounded-identity-splice", {
    mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver", { accepted: true });
      records.find(({ kind }) => kind === "occurrence").effect.grounded_identity.value =
        "spliced-effect";
    }
  }]);
  return controls.map(([controlId, options]) => invalidControl(controlId, options));
}

function profileRejectionControls(profile) {
  const controls = [
    ["member-coordinate-association-substitution", (contract, input) => {
      const claim = contract.claims.find(({ claim_id: claimId }) =>
        claimId.includes("member-") && claimId.includes("-targets-"));
      const proposition = contract.propositions.find(({ proposition_id: propositionId }) =>
        propositionId === claim.proposition_id);
      proposition.operands = [{
        kind: "reference", reference_id: "ref-cia-server-coordinate"
      }];
      return { contract, input };
    }],
    ["selected-reference-substitution", (contract, input) => {
      input.reference_bindings.find(({ role: roleName }) =>
        roleName === "accepted_request").reference_ids =
        [...input.reference_bindings.find(({ role: roleName }) =>
          roleName === "forbidden_request").reference_ids];
      return { contract, input };
    }],
    ["complete-population-binding-omission", (contract, input) => {
      input.reference_bindings = input.reference_bindings.filter(({ role: roleName }) =>
        roleName !== "declared_members");
      return { contract, input };
    }],
    ["selected-proposition-substitution", (contract, input) => {
      const claim = contract.claims.find(({ claim_id: claimId }) =>
        claimId.includes("forbidden-request-targets-interface"));
      contract.propositions.find(({ proposition_id: propositionId }) =>
        propositionId === claim.proposition_id).operator = "reference:depends_on";
      return { contract, input };
    }]
  ];
  return controls.map(([controlId, mutate]) => ({
    control_id: controlId,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: evaluate(profile, {}, mutate)
  }));
}

function exclusionControls(profile) {
  const satisfaction = evaluate(profile);
  return EXCLUSIONS.map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile, profile_digest }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export { GUARANTEE_DIGEST, runProofPackAdequacyControls };
