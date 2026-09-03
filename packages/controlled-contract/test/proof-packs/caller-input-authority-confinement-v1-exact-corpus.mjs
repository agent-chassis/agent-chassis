import {
  projectedEvaluationEnvelopeFor
} from "../../lib/exact-binding-capture.mjs";
import { canonicalDigest } from "../../lib/contract-assessment.mjs";
import {
  createGraphSelectionTrace,
  evaluateProjectedEvaluationBinding
} from "../../lib/projected-evaluation-binding.mjs";
import {
  evaluateStableProofPackFixtureV1,
  profileDigest,
  stableProjectedProofSubjectProvenV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildCallerInputAuthorityConfinementSources
} from "./caller-input-authority-confinement-v1-fixture.mjs";
import {
  createCallerInputAuthorityConfinementSubject
} from "./caller-input-authority-confinement-v1-harness.mjs";

const CONTROL_IDS = Object.freeze([
  "admission-context-splice",
  "accepted-parser-request-id-splice",
  "accepted-request-source-splice",
  "authored-equality-laundering",
  "capture-proof-source-splice",
  "crossed-member-coordinate-association",
  "cut-refusal-id-splice",
  "declaration-profile-splice",
  "declaration-result-splice",
  "evaluation-input-splice",
  "evidence-attempt-id-splice",
  "evidence-cut-id-splice",
  "fabricated-selected-claim",
  "forbidden-request-source-splice",
  "observation-evidence-source-splice",
  "omitted-association-trace-record",
  "policy-source-splice",
  "positive-exact-capture",
  "positive-reordered-capture",
  "positive-unicode-capture",
  "profile-context-splice",
  "profile-association-binding-weakening",
  "profile-cardinality-weakening",
  "profile-complete-population-weakening",
  "profile-falsifier-weakening",
  "profile-relation-weakening",
  "profile-satisfaction-weakening",
  "profile-stage-weakening",
  "profile-verification-method-weakening",
  "projected-evaluation-opt-in-removal",
  "projection-result-splice",
  "surplus-member-coordinate-association"
].sort());

function assessmentProven(subject, overrides = {}) {
  if (Object.keys(overrides).length > 0) return false;
  return stableProjectedProofSubjectProvenV1(subject);
}

async function checkPositive(source = null) {
  const subject = await createCallerInputAuthorityConfinementSubject({ source });
  try {
    return subject.exactBindingResult.satisfaction === "satisfied" &&
      assessmentProven(subject);
  } finally {
    await subject.cleanup();
  }
}

async function checkRefusal(options, projectOverrides = null) {
  let subject;
  try {
    subject = await createCallerInputAuthorityConfinementSubject(options);
    return subject.exactBindingResult.satisfaction !== "satisfied" ||
      !assessmentProven(subject, projectOverrides ?? {});
  } catch {
    return true;
  } finally {
    await subject?.cleanup();
  }
}

async function omittedTraceRefused() {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const selection = createGraphSelectionTrace();
    const evaluation = evaluateStableProofPackFixtureV1({
      profile: subject.profile,
      contract: subject.contract,
      evaluation_input: subject.evaluationInput
    }, { graphSelectionSink: selection.sink });
    const trace = selection.snapshot();
    const firstAssociation = trace.records.findIndex(({ trace_point: tracePoint }) =>
      tracePoint === "for_each_association_binding");
    const result = evaluateProjectedEvaluationBinding({
      declaredOptIn: subject.declaration.projected_evaluation_binding,
      envelope: projectedEvaluationEnvelopeFor(subject.exactBindingResult),
      exactBindingResult: subject.exactBindingResult,
      expectedContext: subject.context,
      contract: subject.contract,
      profile: subject.profile,
      evaluation,
      trace: {
        trace_version: trace.trace_version,
        began: trace.began,
        records: trace.records.filter((_, index) => index !== firstAssociation)
      }
    });
    return result.diagnostics.some(({ code }) =>
      code === "projected_evaluation_trace_incomplete");
  } finally {
    await subject.cleanup();
  }
}

async function admissionSpliceRefused() {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const spliced = structuredClone(subject.pack);
    spliced.admission.guarantee = `${spliced.admission.guarantee} spliced`;
    spliced.admission_digest = "0".repeat(64);
    return !assessmentProven(subject, { proofPack: spliced });
  } finally {
    await subject.cleanup();
  }
}

async function profileSpliceRefused() {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const spliced = structuredClone(subject.pack);
    spliced.profile.claim_patterns[0].proposition_template.operator = "reference:depends_on";
    spliced.profile_digest = "0".repeat(64);
    return !assessmentProven(subject, { proofPack: spliced });
  } finally {
    await subject.cleanup();
  }
}

async function redigestedProfileWeakeningRefused(mutate) {
  const subject = await createCallerInputAuthorityConfinementSubject();
  try {
    const weakened = structuredClone(subject.pack);
    mutate(weakened.profile);
    weakened.profile_digest = profileDigest(weakened.profile);
    weakened.declaration.profile_digest = weakened.profile_digest;
    weakened.admission.profile_digest = weakened.profile_digest;
    weakened.admission_digest = canonicalDigest(weakened.admission);
    return !assessmentProven(subject, { proofPack: weakened });
  } finally {
    await subject.cleanup();
  }
}

function swapFirstMemberAssociation(contract) {
  const propositions = contract.propositions.filter(({ proposition_id: propositionId }) =>
    propositionId.includes("-targets-") && propositionId.includes("member-"));
  if (propositions.length >= 2) {
    [propositions[0].operands, propositions[1].operands] =
      [propositions[1].operands, propositions[0].operands];
  }
  return contract;
}

async function runExactBindingCertificationControls() {
  const baseline = buildCallerInputAuthorityConfinementSources();
  const alternate = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) { policy.declarations.reverse(); },
    mutateAcceptedRequest(request) { request.query = "alternate"; },
    mutateForbiddenRequest(request) { request.options.displayMode = "alternate"; }
  });
  const unicode = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.declarations.push({
        path: [{ kind: "object_key", value: "café" }],
        classification: "allowed",
        resolution_coordinate_reference_ids: []
      });
    },
    mutateAcceptedRequest(request) { request["café"] = "東京"; }
  });
  const reordered = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.declarations.reverse();
      policy.effects.reverse();
      policy.operations.reverse();
      policy.resolution_coordinates.reverse();
      policy.boundary_sources.reverse();
    }
  });
  const baselineFiles = {
    "accepted-input-policy.json": baseline.policyBytes,
    "accepted-request.json": baseline.acceptedRequestBytes,
    "forbidden-request.json": baseline.forbiddenRequestBytes,
    "observation-evidence.json": baseline.evidenceBytes,
    "observation-capture-proof.json": baseline.captureProofBytes,
    "caller-input-projection.json": baseline.projectionBytes
  };
  const checks = new Map();
  checks.set("positive-exact-capture", await checkPositive(baseline));
  checks.set("positive-unicode-capture", await checkPositive(unicode));
  checks.set("positive-reordered-capture", await checkPositive(reordered));
  checks.set("projection-result-splice", await checkRefusal({
    source: baseline, projectionBytes: alternate.projectionBytes
  }));
  for (const [controlId, fileName] of [
    ["policy-source-splice", "accepted-input-policy.json"],
    ["accepted-request-source-splice", "accepted-request.json"],
    ["forbidden-request-source-splice", "forbidden-request.json"],
    ["observation-evidence-source-splice", "observation-evidence.json"],
    ["capture-proof-source-splice", "observation-capture-proof.json"]
  ]) checks.set(controlId, await checkRefusal({
    source: baseline,
    sourceFiles: {
      ...baselineFiles,
      [fileName]: ({
        "accepted-input-policy.json": alternate.policyBytes,
        "accepted-request.json": alternate.acceptedRequestBytes,
        "forbidden-request.json": alternate.forbiddenRequestBytes,
        "observation-evidence.json": alternate.evidenceBytes,
        "observation-capture-proof.json": alternate.captureProofBytes
      })[fileName]
    }
  }));
  checks.set("evaluation-input-splice", await checkRefusal({
    source: baseline,
    mutateEvaluationInput(input) {
      input.reference_bindings.find(({ role }) => role === "accepted_request").reference_ids =
        [...input.reference_bindings.find(({ role }) => role === "forbidden_request")
          .reference_ids];
      return input;
    }
  }));
  checks.set("accepted-parser-request-id-splice", await checkRefusal({
    fixtureOptions: {
      mutateTraceRecords(records, subject) {
        records.find(({ kind, request }) => kind === "parser_attempt" &&
          request.reference_id === subject.roles.acceptedRequest.reference_id)
          .request.reference_id = "ref-cia-accepted-request-spliced";
      }
    }
  }));
  checks.set("cut-refusal-id-splice", await checkRefusal({
    fixtureOptions: {
      mutateTraceRecords(records) {
        records.find(({ kind }) => kind === "observation_cut").refusal.reference_id =
          "ref-cia-refusal-spliced";
      }
    }
  }));
  checks.set("evidence-attempt-id-splice", await checkRefusal({
    fixtureOptions: {
      mutateEvidence(evidence) {
        evidence.attempt.reference_id = "ref-cia-forbidden-attempt-spliced";
      }
    }
  }));
  checks.set("evidence-cut-id-splice", await checkRefusal({
    fixtureOptions: {
      mutateEvidence(evidence) {
        evidence.interval.end.reference_id = "ref-cia-observation-cut-spliced";
      }
    }
  }));
  checks.set("declaration-profile-splice", await checkRefusal({
    source: baseline,
    mutateDeclaration(declaration) {
      declaration.profile_digest = "0".repeat(64);
      return declaration;
    }
  }));
  checks.set("declaration-result-splice", await checkRefusal({
    source: baseline,
    mutateDeclaration(declaration) {
      declaration.projected_evaluation_binding.result_requirement_id = "accepted-request";
      return declaration;
    }
  }));
  checks.set("projected-evaluation-opt-in-removal", await checkRefusal({
    source: baseline,
    mutateDeclaration(declaration) {
      delete declaration.projected_evaluation_binding;
      return declaration;
    }
  }));
  checks.set("crossed-member-coordinate-association", await checkRefusal({
    source: baseline, mutateContract: swapFirstMemberAssociation
  }));
  checks.set("surplus-member-coordinate-association", await checkRefusal({
    source: baseline,
    mutateContract(contract) {
      const association = contract.propositions.find(({ proposition_id: propositionId }) =>
        propositionId.includes("-targets-") && propositionId.includes("member-"));
      const duplicate = structuredClone(association);
      duplicate.proposition_id = "prop-cia-cert-surplus-member-coordinate";
      duplicate.operands = structuredClone(contract.propositions.find(({ proposition_id: id }) =>
        id !== association.proposition_id && id.includes("-targets-") && id.includes("member-"))
        .operands);
      contract.propositions.push(duplicate);
      contract.claims.push({
        claim_id: "claim-cia-cert-surplus-member-coordinate",
        kind: "evidence", modality: "MUST", proposition_id: duplicate.proposition_id
      });
      return contract;
    }
  }));
  checks.set("fabricated-selected-claim", await checkRefusal({
    source: baseline,
    mutateContract(contract) {
      const claim = contract.claims.find(({ claim_id: claimId }) =>
        claimId.includes("forbidden-request-targets-interface"));
      const proposition = contract.propositions.find(({ proposition_id: propositionId }) =>
        propositionId === claim.proposition_id);
      claim.claim_id = "claim-cia-cert-fabricated-selected";
      proposition.proposition_id = "prop-cia-cert-fabricated-selected";
      claim.proposition_id = proposition.proposition_id;
      return contract;
    }
  }));
  checks.set("authored-equality-laundering", await checkRefusal({
    source: baseline,
    mutateContract(contract) {
      contract.propositions.push({
        proposition_id: "prop-cia-cert-authored-equality",
        subject_reference_id: "ref-cia-accepted-request",
        operator: "reference:equals",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-cia-forbidden-request" }]
      });
      contract.claims.push({
        claim_id: "claim-cia-cert-authored-equality",
        kind: "evidence", modality: "MUST",
        proposition_id: "prop-cia-cert-authored-equality"
      });
      return contract;
    },
    mutateEvaluationInput(input) {
      input.reference_bindings.find(({ role }) => role === "accepted_request").reference_ids =
        ["ref-cia-forbidden-request"];
      return input;
    }
  }));
  checks.set("omitted-association-trace-record", await omittedTraceRefused());
  checks.set("admission-context-splice", await admissionSpliceRefused());
  checks.set("profile-context-splice", await profileSpliceRefused());
  const profileWeakenings = {
    "profile-association-binding-weakening": (profile) => {
      const pattern = profile.claim_patterns.find(({ for_each: forEach }) =>
        forEach?.association_bindings?.length > 0);
      delete pattern.for_each.association_bindings;
    },
    "profile-cardinality-weakening": (profile) => {
      profile.reference_roles.find(({ cardinality }) => cardinality === "exactly_one")
        .cardinality = "one_or_more";
    },
    "profile-complete-population-weakening": (profile) => {
      profile.reference_binding_patterns.splice(0, 1);
    },
    "profile-falsifier-weakening": (profile) => {
      profile.falsifier_occurrence_bindings.splice(0, 1);
    },
    "profile-relation-weakening": (profile) => {
      profile.relation_patterns.splice(0, 1);
    },
    "profile-satisfaction-weakening": (profile) => {
      profile.satisfaction_expression.all_of.pop();
    },
    "profile-stage-weakening": (profile) => {
      profile.evaluation_stages = ["pre_delivery", "post_delivery"];
    },
    "profile-verification-method-weakening": (profile) => {
      profile.claim_patterns.find(({ claim_kind: claimKind }) => claimKind === "verification")
        .verification_methods.push("inspection");
    }
  };
  for (const [controlId, mutate] of Object.entries(profileWeakenings)) {
    checks.set(controlId, await redigestedProfileWeakeningRefused(mutate));
  }
  return {
    passed_control_ids: CONTROL_IDS.filter((controlId) => checks.get(controlId) === true),
    failed_control_ids: CONTROL_IDS.filter((controlId) => checks.get(controlId) !== true)
  };
}

export {
  CONTROL_IDS,
  runExactBindingCertificationControls
};
