import { buildBoundaryFixture, buildGuidanceFixture } from "./bounded-policy-v1-fixture.mjs";
import { createBoundedPolicySubject } from "./bounded-policy-v1-harness.mjs";
import {
  stableProjectedProofSubjectProvenV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const CONTROL_IDS = Object.freeze([
  "admission-substitution",
  "association-substitution",
  "certification-substitution",
  "declaration-source-order-substitution",
  "declaration-substitution",
  "evaluation-input-substitution",
  "positive-exact-binding",
  "profile-association-binding-omission",
  "profile-cardinality-weakening",
  "profile-complete-population-omission",
  "profile-falsifier-omission",
  "profile-mechanism-omission",
  "profile-relation-omission",
  "profile-satisfaction-weakening",
  "profile-stage-weakening",
  "profile-substitution",
  "profile-verification-method-weakening",
  "projected-evaluation-opt-in-removal",
  "projection-result-substitution",
  "result-as-source-splice",
  "source-role-swap",
  "source-substitution"
]);

function proven(subject, overrides = {}) {
  if (Object.keys(overrides).length > 0) return false;
  return stableProjectedProofSubjectProvenV1(subject);
}
async function positive(kind) {
  const subject = await createBoundedPolicySubject(kind);
  try { return subject.exactBindingResult.satisfaction === "satisfied" && proven(subject); }
  finally { await subject.cleanup(); }
}
async function refused(kind, options, projectMutator = null) {
  const subject = await createBoundedPolicySubject(kind, options);
  try {
    return subject.exactBindingResult.satisfaction !== "satisfied" ||
      !proven(subject, projectMutator ? projectMutator(subject) : {});
  } finally { await subject.cleanup(); }
}
async function mutatedPackRefused(kind, mutate) {
  const subject = await createBoundedPolicySubject(kind);
  try {
    const pack = structuredClone(subject.pack);
    mutate(pack);
    return !proven(subject, { proofPack: pack });
  } finally { await subject.cleanup(); }
}
function crossAssociation(contract) {
  const marker = contract.references.some(({ reference_id: id }) => id.startsWith("ref-bpr-"))
    ? "case-limit-" : "association-limit-";
  const propositions = contract.propositions.filter(({ proposition_id: id }) => id.includes(marker));
  [propositions[0].operands, propositions[1].operands] =
    [propositions[1].operands, propositions[0].operands];
  return contract;
}

async function runExactBindingCertificationControls({ kind = null, certificationDirectory = "" }) {
  kind ??= String(certificationDirectory).includes("declared-boundary") ? "boundary" : "guidance";
  const baseline = kind === "boundary" ? buildBoundaryFixture() : buildGuidanceFixture();
  const alternate = kind === "boundary"
    ? buildBoundaryFixture({ limits: baseline.policy.limits.map((limit, index) =>
      index === 0 ? { ...limit, limit_value: limit.limit_value + 1 } : limit) })
    : buildGuidanceFixture({ guidanceOptions: { punctuation: ": ", unicode: true } });
  const resultName = kind === "boundary" ? "boundary-report.json" : "propagation-report.json";
  const sourceFiles = kind === "boundary" ? {
    "declared-policy.json": baseline.policyBytes,
    "boundary-observations.json": baseline.observationBytes,
    "measured-subjects.json": baseline.subjectsBytes,
    [resultName]: alternate.reportBytes
  } : {
    "declared-policy.json": baseline.policyBytes,
    "guidance.txt": baseline.guidanceBytes,
    [resultName]: alternate.reportBytes
  };
  const checks = new Map();
  checks.set("positive-exact-binding", await positive(kind));
  checks.set("projection-result-substitution", await refused(kind, { fixture: baseline, sourceFiles }));
  checks.set("source-substitution", await refused(kind, {
    fixture: baseline,
    sourceFiles: kind === "boundary" ? {
      ...sourceFiles, "boundary-report.json": baseline.reportBytes,
      "declared-policy.json": alternate.policyBytes
    } : {
      ...sourceFiles, "propagation-report.json": baseline.reportBytes,
      "guidance.txt": alternate.guidanceBytes
    }
  }));
  checks.set("source-role-swap", await refused(kind, {
    fixture: baseline,
    sourceFiles: kind === "boundary" ? {
      "boundary-observations.json": baseline.policyBytes,
      "boundary-report.json": baseline.reportBytes,
      "declared-policy.json": baseline.observationBytes,
      "measured-subjects.json": baseline.subjectsBytes
    } : {
      "declared-policy.json": baseline.guidanceBytes,
      "guidance.txt": baseline.policyBytes,
      "propagation-report.json": baseline.reportBytes
    }
  }));
  checks.set("result-as-source-splice", await refused(kind, {
    fixture: baseline,
    sourceFiles: kind === "boundary" ? {
      "boundary-observations.json": baseline.observationBytes,
      "boundary-report.json": baseline.reportBytes,
      "declared-policy.json": baseline.reportBytes,
      "measured-subjects.json": baseline.subjectsBytes
    } : {
      "declared-policy.json": baseline.reportBytes,
      "guidance.txt": baseline.guidanceBytes,
      "propagation-report.json": baseline.reportBytes
    }
  }));
  checks.set("declaration-substitution", await refused(kind, {
    mutateDeclaration(declaration) { declaration.profile_digest = "0".repeat(64); return declaration; }
  }));
  checks.set("declaration-source-order-substitution", await refused(kind, {
    mutateDeclaration(declaration) {
      const relation = declaration.relations.find(({ operator }) =>
        operator === "deterministic_projection");
      [relation.source_requirement_ids[0], relation.source_requirement_ids[1]] =
        [relation.source_requirement_ids[1], relation.source_requirement_ids[0]];
      return declaration;
    }
  }));
  checks.set("projected-evaluation-opt-in-removal", await refused(kind, {
    mutateDeclaration(declaration) {
      delete declaration.projected_evaluation_binding;
      return declaration;
    }
  }));
  checks.set("profile-mechanism-omission", await refused(kind, {
    mutateProfile(profile) { profile.claim_patterns.splice(0, 1); return profile; }
  }));
  checks.set("profile-substitution", await refused(kind, {
    mutateProfile(profile) { profile.profile_version = "1.0.1"; return profile; }
  }));
  const profileMutations = {
    "profile-complete-population-omission": (profile) => {
      profile.reference_binding_patterns.splice(0, 1);
    },
    "profile-association-binding-omission": (profile) => {
      const pattern = profile.claim_patterns.find(({ for_each }) => for_each?.association_bindings);
      delete pattern.for_each.association_bindings;
    },
    "profile-falsifier-omission": (profile) => {
      profile.falsifier_occurrence_bindings.splice(0, 1);
    },
    "profile-relation-omission": (profile) => {
      profile.relation_patterns.splice(0, 1);
    },
    "profile-satisfaction-weakening": (profile) => {
      profile.satisfaction_expression.all_of.pop();
    },
    "profile-cardinality-weakening": (profile) => {
      profile.reference_roles.find(({ cardinality }) => cardinality === "exactly_one")
        .cardinality = "one_or_more";
    },
    "profile-stage-weakening": (profile) => {
      profile.evaluation_stages = ["pre_delivery", "post_delivery"];
    },
    "profile-verification-method-weakening": (profile) => {
      profile.claim_patterns.find(({ claim_kind }) => claim_kind === "verification")
        .verification_methods.push("inspection");
    }
  };
  for (const [id, mutate] of Object.entries(profileMutations)) {
    checks.set(id, await mutatedPackRefused(kind, ({ profile }) => mutate(profile)));
  }
  checks.set("evaluation-input-substitution", await refused(kind, {
    mutateEvaluationInput(input) {
      input.reference_bindings.find(({ role }) => role === "declared_limits").reference_ids.pop();
      return input;
    }
  }));
  checks.set("association-substitution", await refused(kind, { mutateContract: crossAssociation }));
  checks.set("admission-substitution", await refused(kind, {}, (subject) => {
    const pack = structuredClone(subject.pack);
    pack.admission.guarantee += " substituted";
    pack.admission_digest = "0".repeat(64);
    return { proofPack: pack };
  }));
  checks.set("certification-substitution", await refused(kind, {}, (subject) => ({
    proofPack: { ...subject.pack, exact_binding_certification_digest: "0".repeat(64) }
  })));
  return {
    passed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) === true),
    failed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) !== true)
  };
}

export { CONTROL_IDS, runExactBindingCertificationControls };
