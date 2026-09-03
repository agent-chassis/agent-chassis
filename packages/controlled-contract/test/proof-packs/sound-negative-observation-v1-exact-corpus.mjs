import {
  projectedEvaluationEnvelopeFor
} from "../../lib/exact-binding-capture.mjs";
import {
  createGraphSelectionTrace,
  evaluateProjectedEvaluationBinding
} from "../../lib/projected-evaluation-binding.mjs";
import {
  evaluateStableProofPackFixtureV1,
  stableProjectedProofSubjectProvenV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildSoundNegativeObservationSources
} from "./sound-negative-observation-v1-fixture.mjs";
import {
  createSoundNegativeObservationSubject
} from "./sound-negative-observation-v1-harness.mjs";

const CONTROL_IDS = Object.freeze([
  "admission-context-splice",
  "capture-source-splice",
  "crossed-position-associations",
  "crossed-source-associations",
  "crossed-target-associations",
  "declaration-profile-splice",
  "evaluation-input-splice",
  "fabricated-selected-claim",
  "omitted-association-trace-record",
  "positive-complete-empty-capture",
  "positive-nonempty-exact-capture",
  "positive-unicode-exact-capture",
  "projected-evaluation-opt-in-removal",
  "projection-result-splice",
  "unbound-invalidating-condition-population"
]);

function assessmentProven(subject, overrides = {}) {
  if (Object.keys(overrides).length > 0) return false;
  return stableProjectedProofSubjectProvenV1(subject);
}

async function checkPositive(fixtureOptions) {
  const subject = await createSoundNegativeObservationSubject({ fixtureOptions });
  try {
    return subject.exactBindingResult.satisfaction === "satisfied" &&
      assessmentProven(subject);
  } finally {
    await subject.cleanup();
  }
}

async function checkRefusal(options, projectOverrides = null) {
  const subject = await createSoundNegativeObservationSubject(options);
  try {
    return subject.exactBindingResult.satisfaction !== "satisfied" ||
      !assessmentProven(subject, projectOverrides ?? {});
  } finally {
    await subject.cleanup();
  }
}

function swapAssociation(contract, suffix) {
  const propositions = contract.propositions.filter(({ proposition_id: id }) =>
    new RegExp(`^prop-sno-occurrence-[0-9]+-[0-9]+-${suffix}$`, "u").test(id));
  [propositions[0].operands, propositions[1].operands] =
    [propositions[1].operands, propositions[0].operands];
  return contract;
}

async function omittedTraceRefused() {
  const subject = await createSoundNegativeObservationSubject({
    fixtureOptions: { domain: "cert-omitted-trace" }
  });
  try {
    const selection = createGraphSelectionTrace();
    const evaluation = evaluateStableProofPackFixtureV1({
      profile: subject.profile,
      contract: subject.contract,
      evaluation_input: subject.evaluationInput
    }, { graphSelectionSink: selection.sink });
    const trace = selection.snapshot();
    const firstAssociation = trace.records.findIndex(({ trace_point: point }) =>
      point === "for_each_association_binding");
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
  const subject = await createSoundNegativeObservationSubject({
    fixtureOptions: { domain: "cert-admission-splice" }
  });
  try {
    const spliced = structuredClone(subject.pack);
    spliced.admission.guarantee = `${spliced.admission.guarantee} spliced`;
    spliced.admission_digest = "0".repeat(64);
    return !assessmentProven(subject, { proofPack: spliced });
  } finally {
    await subject.cleanup();
  }
}

async function runExactBindingCertificationControls() {
  const baseline = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "cert-baseline"
  });
  const alternate = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "cert-alternate"
  });
  const checks = new Map();
  checks.set("positive-nonempty-exact-capture", await checkPositive({
    domain: "cert-positive-nonempty"
  }));
  checks.set("positive-complete-empty-capture", await checkPositive({
    sourceCount: 0, observationCount: 0, domain: "cert-positive-empty"
  }));
  checks.set("positive-unicode-exact-capture", await checkPositive({
    unicode: true, domain: "cert-positive-unicode"
  }));
  checks.set("projection-result-splice", await checkRefusal({
    source: baseline, projectionBytes: alternate.projectionBytes
  }));
  checks.set("evaluation-input-splice", await checkRefusal({
    source: baseline,
    mutateEvaluationInput(input) {
      input.reference_bindings.find(({ role }) => role === "target").reference_ids =
        input.reference_bindings.find(({ role }) => role === "observation_attempt")
          .reference_ids;
      return input;
    }
  }));
  checks.set("capture-source-splice", await checkRefusal({
    source: baseline,
    sourceFiles: {
      "observation-evidence.json": alternate.evidenceBytes,
      "observation-capture-proof.json": alternate.captureProofBytes,
      "observation-projection.json": baseline.projectionBytes
    }
  }));
  checks.set("declaration-profile-splice", await checkRefusal({
    source: baseline,
    mutateDeclaration(declaration) {
      declaration.profile_digest = "0".repeat(64);
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
  checks.set("unbound-invalidating-condition-population", await checkRefusal({
    source: baseline,
    mutateEvaluationInput(input) {
      input.reference_bindings = input.reference_bindings.filter(
        ({ role }) => role !== "invalidating_conditions"
      );
      return input;
    }
  }));
  for (const suffix of ["target", "source", "position"]) {
    checks.set(`crossed-${suffix}-associations`, await checkRefusal({
      source: baseline,
      mutateContract: (contract) => swapAssociation(contract, suffix)
    }));
  }
  checks.set("fabricated-selected-claim", await checkRefusal({
    source: baseline,
    mutateContract(contract) {
      const claim = contract.claims.find(({ claim_id: id }) => id.endsWith("-nonmatch"));
      const proposition = contract.propositions.find(
        ({ proposition_id: id }) => id === claim.proposition_id
      );
      const relation = contract.relations.find(
        ({ target_claim_id: id }) => id === claim.claim_id
      );
      claim.claim_id = "claim-cert-fabricated-nonmatch";
      proposition.proposition_id = "prop-cert-fabricated-nonmatch";
      claim.proposition_id = proposition.proposition_id;
      relation.target_claim_id = claim.claim_id;
      return contract;
    }
  }));
  checks.set("omitted-association-trace-record", await omittedTraceRefused());
  checks.set("admission-context-splice", await admissionSpliceRefused());
  return {
    passed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) === true),
    failed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) !== true)
  };
}

export {
  CONTROL_IDS,
  runExactBindingCertificationControls
};
