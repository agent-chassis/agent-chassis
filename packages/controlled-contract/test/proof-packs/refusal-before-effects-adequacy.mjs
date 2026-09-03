import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import {
  buildRefusalBeforeEffectsFixture,
  findProposition,
  ref,
  roleReferenceId
} from "./refusal-before-effects-fixture.mjs";
import {
  POSITIVE_DOMAINS,
  executeMutant,
  executePositiveDomain
} from "./refusal-before-effects-harness.mjs";
import {
  evaluateStableProofPackFixtureV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const REFUSAL_BEFORE_EFFECTS_GUARANTEE_DIGEST =
  "f55adcfd21e759ad9f647d8d63aaefd8d0fc0d112d9b288ca7489077c5c508b8";
const REFUSAL_BEFORE_EFFECTS_PROFILE_DIGEST =
  "1e97b33590c2f7219b3fc73e12c3b8c510bea79e2578bb1a523c36f23e167f78";

function evaluateFixture(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function addReference(contract, referenceId, typeTerm = "cc:resource") {
  contract.references.push({
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "profile_term", term: `attack:${referenceId}` }
  });
}

function addEvidenceClaim(contract, {
  id,
  subject,
  operator,
  operands,
  mode = "unconditional",
  context = [],
  modality = "MUST"
}) {
  contract.propositions.push({
    proposition_id: `prop-${id}`,
    subject_reference_id: subject,
    operator,
    applicability_context: { mode, operand_reference_ids: context },
    operands
  });
  contract.claims.push({
    claim_id: `claim-${id}`,
    kind: "evidence",
    modality,
    proposition_id: `prop-${id}`
  });
}

function removeClaim(contract, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = contract.claims.find(({ claim_id: id }) => id === claimId);
  const propositionIds = new Set([
    claim?.proposition_id,
    claim?.falsifying_proposition_id
  ].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id: id }) => id !== claimId);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: id }) => !propositionIds.has(id)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claimId && target !== claimId
  );
  for (const collection of contract.collections) {
    collection.member_claim_ids = collection.member_claim_ids.filter(
      (memberId) => memberId !== claimId
    );
  }
}

function positiveFixtureForDomain(profile, domainId) {
  if (domainId === "cross-tenant-record-store-secondary-index") {
    return buildRefusalBeforeEffectsFixture({
      domain: "tenant",
      profile,
      protected_effects: [
        { reference_id: "ref-tenant-record-store", type_term: "cc:resource" },
        { reference_id: "ref-tenant-secondary-index", type_term: "cc:resource" }
      ],
      role_type_overrides: { operation: "cc:operation", subject: "cc:entity" }
    });
  }
  if (domainId === "unauthenticated-queue-deduplication") {
    return buildRefusalBeforeEffectsFixture({
      domain: "queue",
      profile,
      protected_effects: [
        { reference_id: "ref-queue-state", type_term: "cc:resource" },
        { reference_id: "ref-deduplication-state", type_term: "cc:state" }
      ],
      role_type_overrides: {
        operation: "cc:operation",
        subject: "cc:runtime_component",
        verification: "cc:process"
      }
    });
  }
  return buildRefusalBeforeEffectsFixture({ profile });
}

function variantFixtures(profile) {
  const fixtures = {};
  for (const verificationMethod of [
    "analysis", "demonstration", "proof", "test_execution"
  ]) fixtures[`verification-method-${verificationMethod.replaceAll("_", "-")}`] =
    buildRefusalBeforeEffectsFixture({ profile, verification_method: verificationMethod });

  fixtures["protected-resource-reads"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addEvidenceClaim(contract, {
        id: "allowed-protected-read",
        subject: roleReferenceId("attempt"),
        operator: "reference:reads",
        operands: [ref("ref-protected-channel"), ref("ref-protected-configuration")],
        mode: "before",
        context: [roleReferenceId("refusal")]
      });
    }
  });
  fixtures["non-protected-logging-write"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-authorization-log");
      addEvidenceClaim(contract, {
        id: "allowed-log-write",
        subject: roleReferenceId("attempt"),
        operator: "reference:writes",
        operands: [ref("ref-authorization-log")],
        mode: "before",
        context: [roleReferenceId("refusal")]
      });
    }
  });
  fixtures["multiple-protected-resources"] = buildRefusalBeforeEffectsFixture({
    profile,
    protected_effects: [
      { reference_id: "ref-effect-a", type_term: "cc:resource" },
      { reference_id: "ref-effect-b", type_term: "cc:configuration" },
      { reference_id: "ref-effect-c", type_term: "cc:artifact" }
    ]
  });
  fixtures["additional-refusal-status-message"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-refused-status", "cc:state");
      addReference(contract, "ref-refusal-message", "cc:artifact");
      addEvidenceClaim(contract, {
        id: "additional-refusal-status",
        subject: roleReferenceId("refusal"),
        operator: "reference:has_status",
        operands: [ref("ref-refused-status")]
      });
      addEvidenceClaim(contract, {
        id: "additional-refusal-message",
        subject: roleReferenceId("refusal"),
        operator: "reference:returns",
        operands: [ref("ref-refusal-message")]
      });
    }
  });
  fixtures["unrelated-evidence-and-collections"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addEvidenceClaim(contract, {
        id: "unrelated-observation",
        subject: roleReferenceId("verification"),
        operator: "reference:reads",
        operands: [ref(roleReferenceId("subject"))]
      });
      contract.collections.push({
        collection_id: "set-unrelated-observations",
        collection_kind: "closed_set",
        purpose: "verification_obligations",
        member_claim_ids: ["claim-unrelated-observation"]
      });
    }
  });
  fixtures["allowed-role-type-alternatives"] = buildRefusalBeforeEffectsFixture({
    profile,
    protected_effects: [
      { reference_id: "ref-state-effect", type_term: "cc:state" },
      { reference_id: "ref-artifact-effect", type_term: "cc:artifact" }
    ],
    role_type_overrides: {
      operation: "cc:command",
      subject: "cc:runtime_component",
      verification: "cc:process"
    }
  });
  fixtures["unicode-identities-and-set-permutations"] = buildRefusalBeforeEffectsFixture({
    profile,
    identity_prefix: "租户-Δ-🔒",
    mutate_contract(contract) {
      contract.references.reverse();
      contract.propositions.reverse();
      contract.claims.reverse();
      contract.relations.reverse();
      for (const proposition of contract.propositions) proposition.operands.reverse();
      contract.collections[0].member_claim_ids.reverse();
    },
    mutate_input(input) {
      input.reference_bindings.reverse();
      input.reference_bindings.find(({ role }) => role === "protected_effects")
        .reference_ids.reverse();
    }
  });
  return fixtures;
}

function positiveControls(profile) {
  const controls = [];
  for (const domainId of Object.keys(POSITIVE_DOMAINS)) {
    const execution = executePositiveDomain(domainId);
    controls.push({
      control_id: domainId,
      category: "positive",
      implementation_outcome: execution.oracle.passed ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(positiveFixtureForDomain(profile, domainId))
    });
  }
  for (const [controlId, fixture] of Object.entries(variantFixtures(profile))) controls.push({
    control_id: controlId,
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: evaluateFixture(fixture)
  });
  return controls;
}

function truthfulMutantFixture(profile, mutantId) {
  const operator = mutantId.includes("mutation")
    ? "reference:mutates"
    : "reference:writes";
  const resource = mutantId === "protected-mutation-before-refusal"
    ? "ref-protected-configuration"
    : "ref-protected-channel";
  return buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addEvidenceClaim(contract, {
        id: `executed-${mutantId}`,
        subject: roleReferenceId("attempt"),
        operator,
        operands: [ref(resource)],
        mode: "before",
        context: [roleReferenceId("refusal")]
      });
    }
  });
}

function mutantControls(profile) {
  return [
    "protected-write-before-refusal",
    "protected-mutation-before-refusal",
    "mutation-followed-by-rollback",
    "refusal-after-protected-effect"
  ].map((controlId) => {
    const execution = executeMutant(controlId);
    return {
      control_id: controlId,
      category: "mutant",
      implementation_outcome: execution.oracle.passed ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(truthfulMutantFixture(profile, controlId))
    };
  });
}

function rejectionFixtures(profile) {
  const fixtures = {};
  for (const [controlId, patternId] of Object.entries({
    "missing-attempt-operation-binding": "attempt-performs-operation",
    "missing-attempt-subject-binding": "attempt-uses-subject",
    "missing-unauthorized-declaration": "subject-unauthorized-for-operation",
    "missing-exact-refusal-rejection": "refusal-rejects-attempt",
    "missing-attempt-interval-edge": "attempt-precedes-protected-interval",
    "missing-interval-refusal-edge": "protected-interval-precedes-refusal",
    "missing-population-membership-claim": "protected-effect-population-membership",
    "missing-exact-cardinality-claim": "protected-effect-population-cardinality"
  })) fixtures[controlId] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      removeClaim(contract, patternId);
    }
  });
  fixtures["missing-write-prohibition-branch"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      removeClaim(contract, "no-protected-write-before-refusal");
      removeClaim(contract, "write-prohibition-verification");
    }
  });
  fixtures["missing-mutation-prohibition-branch"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      removeClaim(contract, "no-protected-mutation-before-refusal");
      removeClaim(contract, "mutation-prohibition-verification");
    }
  });
  fixtures["omitted-protected-effect"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      findProposition(contract, "protected-effect-population-membership").operands.pop();
    }
  });
  fixtures["population-count-list-mismatch"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      findProposition(contract, "protected-effect-population-cardinality")
        .operands[0].value = 3;
    },
    mutate_input(input) {
      input.number_bindings[0].value = 3;
    }
  });
  fixtures["extra-scoped-member-beyond-cardinality"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-extra-scoped-effect");
      addEvidenceClaim(contract, {
        id: "extra-scoped-population-member",
        subject: roleReferenceId("protected_effect_population"),
        operator: "reference:contains",
        operands: [ref("ref-extra-scoped-effect")],
        mode: "before",
        context: [roleReferenceId("refusal")]
      });
    }
  });
  for (const [controlId, omittedReferenceIds] of Object.entries({
    "missing-attempt-observation": [roleReferenceId("attempt")],
    "missing-refusal-observation": [roleReferenceId("refusal")],
    "missing-operation-observation": [roleReferenceId("operation")],
    "missing-protected-effects-observation": [
      "ref-protected-channel", "ref-protected-configuration"
    ]
  })) fixtures[controlId] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      const omitted = new Set(omittedReferenceIds);
      const observation = findProposition(
        contract, "verification-observes-exact-proof-subjects"
      );
      observation.operands = observation.operands.filter(
        ({ kind, reference_id: referenceId }) =>
          kind !== "reference" || !omitted.has(referenceId)
      );
    }
  });
  fixtures["wrong-attempt-observed"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-wrong-attempt", "cc:event");
      findProposition(contract, "verification-observes-exact-proof-subjects")
        .operands[0] = ref("ref-wrong-attempt");
    }
  });
  fixtures["wrong-resource-observed"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-wrong-resource");
      const observed = findProposition(
        contract, "verification-observes-exact-proof-subjects"
      );
      observed.operands[observed.operands.length - 1] = ref("ref-wrong-resource");
    }
  });
  fixtures["reusable-operation-used-as-attempt"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_input(input) {
      input.reference_bindings.find(({ role }) => role === "attempt").reference_ids = [
        roleReferenceId("operation")
      ];
    }
  });
  fixtures["status-only-verification"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-status-only", "cc:state");
      const observation = findProposition(
        contract, "verification-observes-exact-proof-subjects"
      );
      observation.operator = "reference:has_status";
      observation.operands = [ref("ref-status-only")];
    }
  });
  fixtures["unrelated-verifier-failure"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-unrelated-log");
      const verification = findProposition(contract, "write-prohibition-verification");
      verification.operands = [ref("ref-unrelated-log")];
      const falsifier = findProposition(
        contract, "write-prohibition-verification", { falsifier: true }
      );
      falsifier.subject_reference_id = roleReferenceId("verification");
      falsifier.operands = [ref("ref-unrelated-log")];
    }
  });
  fixtures["unrelated-falsifier"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-unrelated-falsifier-resource");
      const falsifier = findProposition(
        contract, "write-prohibition-verification", { falsifier: true }
      );
      falsifier.subject_reference_id = roleReferenceId("verification");
      falsifier.operator = "reference:rejects";
      falsifier.operands = [ref("ref-unrelated-falsifier-resource")];
    }
  });
  fixtures["falsifier-wrong-subject"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      findProposition(contract, "write-prohibition-verification", { falsifier: true })
        .subject_reference_id = roleReferenceId("operation");
    }
  });
  fixtures["falsifier-wrong-operand"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-falsifier-wrong-operand");
      const falsifier = findProposition(
        contract, "write-prohibition-verification", { falsifier: true }
      );
      falsifier.operands[falsifier.operands.length - 1] =
        ref("ref-falsifier-wrong-operand");
    }
  });
  fixtures["falsifier-wrong-operator"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      findProposition(contract, "write-prohibition-verification", { falsifier: true })
        .operator = "reference:modifies";
    }
  });
  fixtures["falsifier-wrong-temporal-condition"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      findProposition(contract, "write-prohibition-verification", { falsifier: true })
        .applicability_context.mode = "after";
    }
  });
  fixtures["swapped-attempt-refusal-roles"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_input(input) {
      input.reference_bindings.find(({ role }) => role === "attempt").reference_ids = [
        roleReferenceId("refusal")
      ];
      input.reference_bindings.find(({ role }) => role === "refusal").reference_ids = [
        roleReferenceId("attempt")
      ];
    }
  });
  fixtures["collapsed-attempt-refusal-roles"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_input(input) {
      input.reference_bindings.find(({ role }) => role === "refusal").reference_ids = [
        roleReferenceId("attempt")
      ];
    }
  });
  fixtures["missing-verifies-relation"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      contract.relations = contract.relations.filter(
        ({ relation_id: relationId }) => relationId !== "rel-write-verification-target"
      );
    }
  });
  fixtures["retargeted-verifies-relation"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      contract.relations.find(
        ({ relation_id: relationId }) => relationId === "rel-write-verification-target"
      ).target_claim_id = "claim-no-protected-mutation-before-refusal";
    }
  });
  fixtures["competing-proof-population"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addEvidenceClaim(contract, {
        id: "competing-population-extra",
        subject: roleReferenceId("verification"),
        operator: "reference:reads",
        operands: [ref(roleReferenceId("subject"))]
      });
      contract.collections.push({
        collection_id: "set-competing-proof-population",
        collection_kind: "closed_set",
        purpose: "profile_proof_population",
        member_claim_ids: [
          ...contract.collections[0].member_claim_ids,
          "claim-competing-population-extra"
        ]
      });
    }
  });
  fixtures["temporal-cycle"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addEvidenceClaim(contract, {
        id: "refusal-precedes-attempt-cycle",
        subject: roleReferenceId("refusal"),
        operator: "reference:precedes",
        operands: [ref(roleReferenceId("attempt"))]
      });
    }
  });
  fixtures["equals-alias-conceals-forbidden-effect"] = buildRefusalBeforeEffectsFixture({
    profile,
    mutate_contract(contract) {
      addReference(contract, "ref-protected-effect-alias");
      addEvidenceClaim(contract, {
        id: "protected-effect-alias",
        subject: "ref-protected-channel",
        operator: "reference:equals",
        operands: [ref("ref-protected-effect-alias")]
      });
      addEvidenceClaim(contract, {
        id: "forbidden-write-through-alias",
        subject: roleReferenceId("attempt"),
        operator: "reference:writes",
        operands: [ref("ref-protected-effect-alias")],
        mode: "before",
        context: [roleReferenceId("refusal")]
      });
    }
  });
  return fixtures;
}

function profileRejectionControls(profile) {
  const controls = Object.entries(rejectionFixtures(profile)).map(([controlId, fixture]) => ({
    control_id: controlId,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: evaluateFixture(fixture)
  }));
  const invalidComplementProfile = structuredClone(profile);
  const complementAttackPattern = invalidComplementProfile.claim_patterns.find(
    ({ pattern_id: patternId }) => patternId === "write-prohibition-verification"
  ) ?? invalidComplementProfile.claim_patterns.find(
    ({ pattern_id: patternId }) => patternId === "mutation-prohibition-verification"
  );
  if (complementAttackPattern) {
    const falsifier = complementAttackPattern.falsifying_proposition_template;
    falsifier.operator = falsifier.operator === "reference:writes"
      ? "reference:mutates"
      : "reference:writes";
  }
  controls.splice(10, 0, {
    control_id: "missing-complement-policy-selector",
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: complementAttackPattern &&
      validateProfileSemanticsV1(invalidComplementProfile).length > 0
      ? "invalid"
      : "satisfied"
  });
  return controls;
}

function exclusionControls(profile) {
  const baseline = evaluateFixture(buildRefusalBeforeEffectsFixture({ profile }));
  const demonstrations = {
    "production-path-discovery": true,
    "truthful-grounding": true,
    "evidence-authority": true,
    "pack-applicability": true,
    "cce-consequences": true,
    "completeness-beyond-declared-protected-effect-population": true
  };
  return Object.entries(demonstrations).map(([controlId, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: baseline
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: REFUSAL_BEFORE_EFFECTS_PROFILE_DIGEST,
    guarantee_digest: REFUSAL_BEFORE_EFFECTS_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  positiveControls,
  profileRejectionControls,
  rejectionFixtures,
  runProofPackAdequacyControls,
  truthfulMutantFixture,
  variantFixtures
};
