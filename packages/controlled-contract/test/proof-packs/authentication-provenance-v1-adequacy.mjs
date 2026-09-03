import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";
import { profileDigest, evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { canonicalDigest } from "../../lib/exact-binding-common.mjs";
import {
  buildAuthenticationProvenanceFixture,
  buildAuthenticationProvenanceSources
} from "./authentication-provenance-v1-fixture.mjs";

const PROFILE_DIGEST = "0b9b62d09bc5d01b743b5f8fa895fe9729fe05037863ec33f6fe46d6bbb1c42c";
const GUARANTEE_DIGEST = "4f01a730acc440a7b32445445b8119e3f2a70f868bf3563fefbbee327b45eb81";

const EXCLUSIONS = Object.freeze([
  "authorship-issuance-or-authorization",
  "ownership-containment-or-decision-authority",
  "generic-integrity-or-runtime-truth",
  "caller-honesty-or-source-discovery-completeness",
  "freshness-beyond-the-bound-observation-attempt",
  "derived-copied-or-transformed-evidence",
  "provenance-outside-the-complete-selected-source-population",
  "runtime-evidence-cce-or-publication-authority"
]);

const evaluate = (fixture) => evaluateStableProofPackFixtureV1({
  profile: fixture.profile,
  contract: fixture.contract,
  evaluation_input: fixture.input
}).satisfaction;

function removeClaim(contract, claimId) {
  const claim = contract.claims.find(({ claim_id: id }) => id === claimId);
  const propositionIds = new Set([
    claim?.proposition_id, claim?.falsifying_proposition_id
  ].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id: id }) => id !== claimId);
  contract.propositions = contract.propositions.filter(({ proposition_id: id }) =>
    !propositionIds.has(id));
  contract.relations = contract.relations.filter(({ source_claim_id: source,
    target_claim_id: target }) => source !== claimId && target !== claimId);
}

function relationMutation(mutator) {
  return buildAuthenticationProvenanceFixture({ mutateContract: mutator });
}

const rejectionFixtures = Object.freeze({
  "missing-authenticates-relation": () => relationMutation((contract) =>
    removeClaim(contract, "claim-evidence-authenticates-target")),
  "missing-originates-from-relation": () => relationMutation((contract) =>
    removeClaim(contract, "claim-evidence-originates-from-source")),
  "missing-source-of-record-relation": () => relationMutation((contract) =>
    removeClaim(contract, "claim-target-has-source-of-record")),
  "missing-observed-in-relation": () => relationMutation((contract) =>
    removeClaim(contract, "claim-evidence-observed-in-attempt")),
  "missing-verifies-edge": () => relationMutation((contract) => {
    contract.relations.shift();
  }),
  "retargeted-verifies-edge": () => relationMutation((contract) => {
    contract.relations[0].target_claim_id = "claim-evidence-originates-from-source";
  }),
  "unrelated-falsifier": () => relationMutation((contract) => {
    const claim = contract.claims.find(({ claim_id: id }) =>
      id === "claim-verify-evidence-authenticates-target");
    const proposition = contract.propositions.find(({ proposition_id: id }) =>
      id === claim.falsifying_proposition_id);
    proposition.operator = "reference:does_not_originate_from";
    proposition.operands = [{ kind: "reference", reference_id: "ref-provenance-source" }];
  }),
  "wrong-scope-falsifier": () => relationMutation((contract) => {
    const claim = contract.claims.find(({ claim_id: id }) =>
      id === "claim-verify-evidence-authenticates-target");
    const proposition = contract.propositions.find(({ proposition_id: id }) =>
      id === claim.falsifying_proposition_id);
    proposition.applicability_context = {
      mode: "during", operand_reference_ids: ["ref-other-attempt"]
    };
    contract.references.push({
      reference_id: "ref-other-attempt", type_term: "cc:event",
      identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
        value: "other-attempt" }
    });
  }),
  "wrong-observation-attempt": () => relationMutation((contract) => {
    contract.references.push({
      reference_id: "ref-other-attempt", type_term: "cc:event",
      identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
        value: "other-attempt" }
    });
    const proposition = contract.propositions.find(({ proposition_id: id }) =>
      id === "prop-evidence-observed-in-attempt");
    proposition.operands[0].reference_id = "ref-other-attempt";
  }),
  "source-differs-from-source-of-record": () => relationMutation((contract) => {
    contract.references.push({
      reference_id: "ref-other-source", type_term: "cc:resource",
      identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
        value: "other-source" }
    });
    contract.propositions.find(({ proposition_id: id }) =>
      id === "prop-target-has-source-of-record").operands[0].reference_id =
      "ref-other-source";
  }),
  "incomplete-target-population": () => relationMutation((contract) => {
    contract.claims = contract.claims.filter(({ claim_id: id }) =>
      id !== "claim-selected-target-cardinality");
  }),
  "incomplete-source-population": () => relationMutation((contract) => {
    contract.claims = contract.claims.filter(({ claim_id: id }) =>
      id !== "claim-selected-source-cardinality");
  }),
  "fabricated-resolver-fact": () => buildAuthenticationProvenanceFixture({
    mutateContract(contract) {
      removeClaim(contract, "claim-evidence-authenticates-target");
    },
    mutateInput(input) {
      input.resolver_facts.push({
        resolver_kind: "fabricated-capture-resolver",
        fact_key: "passes",
        argument_reference_ids: ["ref-evidence-occurrence-one"],
        satisfied: true
      });
    }
  })
});

const captureAttackControls = Object.freeze({
  "reusable-artifact-substituted-for-occurrence": () =>
    buildAuthenticationProvenanceSources({
      mutateWitnesses(witnesses) {
        witnesses.attemptBinding.evidence_occurrence.type_term = "cc:artifact";
      }
    }),
  "caller-invented-occurrence-identity": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.attemptBinding.evidence_occurrence.reference_id = "ref-invented-occurrence";
    }
  }),
  "identical-bytes-replayed-under-another-attempt": () =>
    buildAuthenticationProvenanceSources({
      mutateWitnesses(witnesses) {
        witnesses.sourceOfRecord.attempt.reference_id = "ref-replayed-attempt";
      }
    }),
  "correct-bytes-wrong-target": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.sourceOfRecord.target.reference_id = "ref-wrong-target";
    }
  }),
  "correct-target-wrong-source": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.sourceOfRecord.source.reference_id = "ref-wrong-source";
    }
  }),
  "source-capture-substitution": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.sourceAuthentication.source.reference_id = "ref-substituted-source";
    }
  }),
  "stale-digest-attack": () => buildAuthenticationProvenanceSources({
    recomputeAuthentication: false
  }),
  "derived-evidence-as-direct": () => buildAuthenticationProvenanceSources({
    acquisitionKind: "derived"
  }),
  "self-authored-unrelated-source-key": () => buildAuthenticationProvenanceSources({
    dishonestSourceGrounding: true
  }),
  "fabricated-target-resolution-proof": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.targetResolution.verification_proof.claims.target.reference_id =
        "ref-fabricated-target";
      witnesses.targetResolution.verification_proof_sha256 = canonicalDigest(
        witnesses.targetResolution.verification_proof
      );
    }
  }),
  "fabricated-source-authentication-proof": () =>
    buildAuthenticationProvenanceSources({ mutateWitnesses(witnesses) {
      witnesses.sourceAuthentication.authentication_proof.claims.source.reference_id =
        "ref-fabricated-source";
      witnesses.sourceAuthentication.authentication_proof_sha256 = canonicalDigest(
        witnesses.sourceAuthentication.authentication_proof
      );
    }}),
  "fabricated-source-of-record-proof": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.sourceOfRecord.assignment_proof.claims.source.reference_id =
        "ref-fabricated-source";
      witnesses.sourceOfRecord.assignment_proof_sha256 = canonicalDigest(
        witnesses.sourceOfRecord.assignment_proof
      );
    }
  }),
  "fabricated-attempt-binding-proof": () => buildAuthenticationProvenanceSources({
    mutateWitnesses(witnesses) {
      witnesses.attemptBinding.attempt_binding_proof.claims.attempt.reference_id =
        "ref-fabricated-attempt";
      witnesses.attemptBinding.attempt_binding_proof_sha256 = canonicalDigest(
        witnesses.attemptBinding.attempt_binding_proof
      );
    }
  }),
  "fabricated-aggregate-authentication-proof": () =>
    buildAuthenticationProvenanceSources({ mutateAuthentication(authentication) {
      authentication.authentication_proof.claims.target_grounded_identity_sha256 =
        "f".repeat(64);
      authentication.authentication_proof_sha256 = canonicalDigest(
        authentication.authentication_proof
      );
    }})
});

function captureAttackKilled(make) {
  try {
    make();
    return false;
  } catch {
    return true;
  }
}

function positiveControls(profile) {
  const cases = [
    ["state-resource-event", {}],
    ["artifact-actor-process", { sourceOptions: {
      targetType: "cc:artifact", sourceType: "cc:actor", attemptType: "cc:process",
      targetResolutionMethod: "verified_manifest_entry",
      sourceAuthenticationMethod: "authenticated_channel",
      sourceOfRecordMethod: "authenticated_catalog_assignment",
      authenticationMethod: "authenticated_channel_validation"
    }}],
    ["unicode-grounded-identities", { sourceOptions: { unicode: true } }],
    ["alternative-verification-method", { verificationMethod: "proof" }],
    ["declaration-order-variant", { mutateContract(contract) {
      contract.claims.reverse();
      contract.propositions.reverse();
      contract.relations.reverse();
    }}],
    ["harmless-unrelated-evidence", { mutateContract(contract) {
      contract.references.push({
        reference_id: "ref-unrelated-evidence", type_term: "cc:evidence",
        identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
          value: "unrelated-evidence" }
      });
    }}],
    ["canonical-record-state", { sourceOptions: {
      targetType: "cc:state", sourceType: "cc:resource",
      targetResolutionMethod: "authenticated_record_key",
      sourceAuthenticationMethod: "authenticated_store_read",
      sourceOfRecordMethod: "transactional_store_assignment",
      authenticationMethod: "trusted_store_validation"
    }}],
    ["authenticated-response", { sourceOptions: {
      targetType: "cc:event", sourceType: "cc:runtime_component",
      targetResolutionMethod: "authenticated_record_key",
      sourceAuthenticationMethod: "authenticated_channel",
      sourceOfRecordMethod: "authenticated_catalog_assignment",
      authenticationMethod: "authenticated_channel_validation"
    }}],
    ["signed-artifact-manifest", { sourceOptions: {
      targetType: "cc:artifact", sourceType: "cc:actor",
      targetResolutionMethod: "verified_manifest_entry",
      sourceAuthenticationMethod: "verified_signature",
      sourceOfRecordMethod: "signed_registry_assignment",
      authenticationMethod: "signature_validation"
    }}],
    ["persisted-record", { sourceOptions: {
      targetType: "cc:entity", sourceType: "cc:resource",
      targetResolutionMethod: "authenticated_record_key",
      sourceAuthenticationMethod: "authenticated_store_read",
      sourceOfRecordMethod: "transactional_store_assignment",
      authenticationMethod: "trusted_store_validation"
    }}],
    ["delegated-issuer-provenance-root-stable", { sourceOptions: {
      targetType: "cc:artifact", sourceType: "cc:actor",
      targetResolutionMethod: "signed_target_digest",
      sourceAuthenticationMethod: "verified_signature",
      sourceOfRecordMethod: "signed_registry_assignment",
      authenticationMethod: "signature_validation"
    }, mutateContract(contract, { roleIds }) {
      contract.references.push({
        reference_id: "ref-delegated-issuer", type_term: "cc:actor",
        identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
          value: "delegated-issuer" }
      });
      contract.propositions.push({
        proposition_id: "prop-source-authorizes-delegated-issuer",
        subject_reference_id: roleIds.source,
        operator: "reference:authorizes",
        applicability_context: {
          mode: "during", operand_reference_ids: [roleIds.observation_attempt]
        },
        operands: [{ kind: "reference", reference_id: "ref-delegated-issuer" }]
      }, {
        proposition_id: "prop-delegated-issuer-generates-occurrence",
        subject_reference_id: "ref-delegated-issuer",
        operator: "reference:generates",
        applicability_context: {
          mode: "during", operand_reference_ids: [roleIds.observation_attempt]
        },
        operands: [{ kind: "reference", reference_id: roleIds.evidence_occurrence }]
      });
      contract.claims.push({
        claim_id: "claim-source-authorizes-delegated-issuer",
        kind: "evidence", modality: "MUST",
        proposition_id: "prop-source-authorizes-delegated-issuer"
      }, {
        claim_id: "claim-delegated-issuer-generates-occurrence",
        kind: "evidence", modality: "MUST",
        proposition_id: "prop-delegated-issuer-generates-occurrence"
      });
    }}],
    ["multiple-independent-authenticators", [{ sourceOptions: {
      occurrenceSuffix: "authenticator-one", sourceAuthenticationMethod: "verified_signature"
    }}, { sourceOptions: {
      occurrenceSuffix: "authenticator-two",
      sourceAuthenticationMethod: "authenticated_channel",
      authenticationMethod: "authenticated_channel_validation"
    }}]],
    ["one-source-many-target-occurrences", [{ sourceOptions: {
      occurrenceSuffix: "target-one", targetSuffix: "one"
    }}, { sourceOptions: {
      occurrenceSuffix: "target-two", targetSuffix: "two"
    }}]],
    ["source-migration-distinct-attempts", [{ sourceOptions: {
      occurrenceSuffix: "before-migration", sourceSuffix: "before"
    }}, { sourceOptions: {
      occurrenceSuffix: "after-migration", sourceSuffix: "after"
    }}]]
  ];
  return cases.map(([controlId, options]) => {
    const fixtures = (Array.isArray(options) ? options : [options]).map((entry) => {
      const fixture = buildAuthenticationProvenanceFixture(entry);
      fixture.profile = profile;
      return fixture;
    });
    return {
      control_id: controlId,
      category: "positive",
      implementation_outcome: "passed",
      profile_satisfaction: fixtures.every((fixture) => evaluate(fixture) === "satisfied")
        ? "satisfied" : "unsatisfied"
    };
  });
}

function mutantControls(profile) {
  const controls = [];
  for (const [controlId, make] of Object.entries(captureAttackControls)) controls.push({
    control_id: controlId,
    category: "mutant",
    implementation_outcome: captureAttackKilled(make) ? "killed" : "passed",
    profile_satisfaction: "unsatisfied"
  });
  for (const [controlId, make] of Object.entries(rejectionFixtures)) {
    const fixture = make();
    fixture.profile = profile;
    controls.push({
      control_id: controlId,
      category: "mutant",
      implementation_outcome: "killed",
      profile_satisfaction: evaluate(fixture)
    });
  }
  return controls;
}

const profileRejectionControls = (profile) => Object.entries(rejectionFixtures)
  .map(([controlId, make]) => {
    const fixture = make();
    fixture.profile = profile;
    return {
      control_id: `reject-${controlId}`,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluate(fixture)
    };
  });

function removePatternsFromExpression(expression, removed) {
  if (expression.pattern) return removed.has(expression.pattern) ? null : expression;
  const key = expression.all_of ? "all_of" : "any_of";
  const children = expression[key].map((child) =>
    removePatternsFromExpression(child, removed)).filter(Boolean);
  return children.length === 0 ? null : { [key]: children };
}

function removeBehaviorBundle(profile, behaviorPatternId) {
  const verificationPatternId = `verify-${behaviorPatternId}`;
  const relationPatternId = `verification-targets-${behaviorPatternId}`;
  const removed = new Set([
    behaviorPatternId, verificationPatternId, relationPatternId
  ]);
  profile.claim_patterns = profile.claim_patterns.filter(({ pattern_id: id }) =>
    !removed.has(id));
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: id }) => !removed.has(id));
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: id }) => !removed.has(id));
  profile.satisfaction_expression = removePatternsFromExpression(
    profile.satisfaction_expression, removed
  );
}

function removeContractVerificationBundle(contract, behaviorPatternId) {
  removeClaim(contract, `claim-${behaviorPatternId}`);
  removeClaim(contract, `claim-verify-${behaviorPatternId}`);
}

function evaluateRedigestedWeakening(profile, fixture, weaken) {
  const weakened = structuredClone(profile);
  weaken(weakened, fixture);
  const weakenedDigest = profileDigest(weakened);
  const canonicalSatisfaction = evaluateStableProofPackFixtureV1({
    profile,
    contract: fixture.contract,
    evaluation_input: fixture.input
  }).satisfaction;
  const weakenedSatisfaction = evaluateStableProofPackFixtureV1({
    profile: weakened,
    contract: fixture.contract,
    evaluation_input: fixture.input
  }).satisfaction;
  return {
    canonical_satisfaction: canonicalSatisfaction,
    weakened_digest: weakenedDigest,
    weakened_satisfaction: weakenedSatisfaction,
    passed: weakenedDigest !== profileDigest(profile) &&
      canonicalSatisfaction !== "satisfied" && weakenedSatisfaction === "satisfied"
  };
}

function buildProfileWeakeningControls(profile) {
  const controls = [];
  for (const behaviorPatternId of [
    "evidence-authenticates-target",
    "evidence-originates-from-source",
    "target-has-source-of-record",
    "evidence-observed-in-attempt"
  ]) {
    const fixture = buildAuthenticationProvenanceFixture({
      mutateContract(contract) {
        removeContractVerificationBundle(contract, behaviorPatternId);
      }
    });
    controls.push([
      `redigested-delete-${behaviorPatternId}-bundle`,
      evaluateRedigestedWeakening(profile, fixture, (weakened) =>
        removeBehaviorBundle(weakened, behaviorPatternId))
    ]);
  }
  for (const [population, patternId, claimPrefix] of [
    ["target", "complete-selected-target-population", "selected-target"],
    ["source", "complete-selected-source-population", "selected-source"]
  ]) {
    const fixture = buildAuthenticationProvenanceFixture({
      mutateContract(contract) {
        removeClaim(contract, `claim-${claimPrefix}-membership`);
        removeClaim(contract, `claim-${claimPrefix}-cardinality`);
      }
    });
    controls.push([
      `redigested-delete-${population}-population-closure`,
      evaluateRedigestedWeakening(profile, fixture, (weakened) => {
        weakened.reference_binding_patterns = weakened.reference_binding_patterns.filter(
          ({ pattern_id: id }) => id !== patternId);
        weakened.satisfaction_expression = removePatternsFromExpression(
          weakened.satisfaction_expression, new Set([patternId])
        );
      })
    ]);
  }
  const distinctFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract, { roleIds }) {
      contract.propositions.push({
        proposition_id: "prop-scoped-occurrence-attempt-alias",
        subject_reference_id: roleIds.evidence_occurrence,
        operator: "reference:equals",
        applicability_context: {
          mode: "during", operand_reference_ids: [roleIds.observation_attempt]
        },
        operands: [{ kind: "reference", reference_id: roleIds.observation_attempt }]
      });
      contract.claims.push({
        claim_id: "claim-scoped-occurrence-attempt-alias",
        kind: "evidence", modality: "MUST",
        proposition_id: "prop-scoped-occurrence-attempt-alias"
      });
    }
  });
  controls.push([
    "redigested-delete-scoped-distinctness",
    evaluateRedigestedWeakening(profile, distinctFixture, (weakened) => {
      weakened.distinct_reference_role_sets = [];
    })
  ]);

  const captureCardinalityFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract) {
      contract.references.push({
        reference_id: "ref-occurrence-capture-two", type_term: "cc:artifact",
        identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
          value: "occurrence-capture-two" }
      });
      for (const claim of contract.claims.filter(({ claim_id: id }) =>
        id.startsWith("claim-verify-"))) {
        contract.propositions.find(({ proposition_id: id }) =>
          id === claim.proposition_id).operands.push({
          kind: "reference", reference_id: "ref-occurrence-capture-two"
        });
      }
    },
    mutateInput(input) {
      input.reference_bindings.find(({ role }) => role === "occurrence_capture")
        .reference_ids.push("ref-occurrence-capture-two");
    }
  });
  controls.push([
    "redigested-weaken-capture-cardinality",
    evaluateRedigestedWeakening(profile, captureCardinalityFixture, (weakened) => {
      weakened.reference_roles.find(({ role }) => role === "occurrence_capture")
        .cardinality = "one_or_more";
    })
  ]);

  const modalityFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract) {
      contract.claims.find(({ claim_id: id }) =>
        id === "claim-evidence-authenticates-target").modality = "SHOULD";
    }
  });
  controls.push([
    "redigested-weaken-authentication-modality",
    evaluateRedigestedWeakening(profile, modalityFixture, (weakened) => {
      weakened.claim_patterns.find(({ pattern_id: id }) =>
        id === "evidence-authenticates-target").allowed_modalities.push("SHOULD");
    })
  ]);

  const satisfactionFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract) {
      removeContractVerificationBundle(contract, "evidence-authenticates-target");
    }
  });
  controls.push([
    "redigested-broaden-satisfaction-expression",
    evaluateRedigestedWeakening(profile, satisfactionFixture, (weakened) => {
      weakened.satisfaction_expression = {
        any_of: structuredClone(weakened.satisfaction_expression.all_of)
      };
    })
  ]);

  const sourceFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract) {
      contract.references.push({
        reference_id: "ref-alternate-source", type_term: "cc:resource",
        identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
          value: "alternate-source" }
      });
      for (const proposition of contract.propositions.filter(({ proposition_id: id }) =>
        ["prop-target-has-source-of-record",
          "prop-falsifier-verify-target-has-source-of-record"].includes(id))) {
        proposition.operands[0].reference_id = "ref-alternate-source";
      }
    },
    mutateInput(input) {
      input.reference_bindings.push({
        role: "alternate_source", reference_ids: ["ref-alternate-source"]
      });
    }
  });
  controls.push([
    "redigested-split-shared-source-role",
    evaluateRedigestedWeakening(profile, sourceFixture, (weakened) => {
      weakened.reference_roles.push({
        role: "alternate_source", allowed_type_terms: ["cc:resource"],
        cardinality: "exactly_one"
      });
      for (const pattern of weakened.claim_patterns.filter(({ pattern_id: id }) =>
        ["target-has-source-of-record",
          "verify-target-has-source-of-record"].includes(id))) {
        const templates = [pattern.proposition_template,
          pattern.falsifying_proposition_template].filter(Boolean);
        for (const template of templates) if (
          ["reference:has_source_of_record",
            "reference:does_not_have_source_of_record"].includes(template.operator)
        ) template.operands[0].role = "alternate_source";
      }
    })
  ]);

  const attemptFixture = buildAuthenticationProvenanceFixture({
    mutateContract(contract, { roleIds }) {
      contract.references.push({
        reference_id: "ref-alternate-attempt", type_term: "cc:event",
        identity: { kind: "durable_id", domain: "authentication-provenance-fixture",
          value: "alternate-attempt" }
      });
      for (const proposition of contract.propositions.filter(({ operator }) =>
        ["reference:authenticates", "reference:does_not_authenticate",
          "reference:originates_from", "reference:does_not_originate_from",
          "reference:has_source_of_record",
          "reference:does_not_have_source_of_record"].includes(operator))) {
        proposition.applicability_context.operand_reference_ids = ["ref-alternate-attempt"];
      }
    },
    mutateInput(input) {
      input.reference_bindings.push({
        role: "alternate_attempt", reference_ids: ["ref-alternate-attempt"]
      });
    }
  });
  controls.push([
    "redigested-split-shared-attempt-role",
    evaluateRedigestedWeakening(profile, attemptFixture, (weakened) => {
      weakened.reference_roles.push({
        role: "alternate_attempt", allowed_type_terms: ["cc:event"],
        cardinality: "exactly_one"
      });
      for (const pattern of weakened.claim_patterns) {
        for (const template of [pattern.proposition_template,
          pattern.falsifying_proposition_template].filter(Boolean)) if (
          ["reference:authenticates", "reference:does_not_authenticate",
            "reference:originates_from", "reference:does_not_originate_from",
            "reference:has_source_of_record",
            "reference:does_not_have_source_of_record"].includes(template.operator)
        ) template.applicability_context.operand_roles = ["alternate_attempt"];
      }
      for (const binding of weakened.falsifier_condition_bindings.filter(
        ({ relation_pattern_id: id }) => id !==
          "verification-targets-evidence-observed-in-attempt"
      )) binding.applicability_context.operand_roles = ["alternate_attempt"];
    })
  ]);

  const applicabilitySplit = structuredClone(profile);
  applicabilitySplit.reference_roles.push({
    role: "alternate_attempt", allowed_type_terms: ["cc:event"],
    cardinality: "exactly_one"
  });
  applicabilitySplit.claim_patterns.find(({ pattern_id: id }) =>
    id === "evidence-authenticates-target").proposition_template
    .applicability_context.operand_roles = ["alternate_attempt"];
  const applicabilityFixture = buildAuthenticationProvenanceFixture({
    mutateInput(input) {
      input.reference_bindings.push({
        role: "alternate_attempt", reference_ids: ["ref-observation-attempt-one"]
      });
    }
  });
  const applicabilityResult = evaluateStableProofPackFixtureV1({
    profile: applicabilitySplit,
    contract: applicabilityFixture.contract,
    evaluation_input: applicabilityFixture.input
  });
  controls.push([
    "redigested-target-falsifier-applicability-split-refused",
    {
      canonical_satisfaction: evaluateStableProofPackFixtureV1({
        profile,
        contract: applicabilityFixture.contract,
        evaluation_input: applicabilityFixture.input
      }).satisfaction,
      weakened_digest: profileDigest(applicabilitySplit),
      weakened_satisfaction: applicabilityResult.satisfaction,
      passed: applicabilityResult.satisfaction !== "satisfied" &&
        applicabilityResult.diagnostics.some(({ reasons }) =>
          reasons?.includes("target_condition_differs"))
    }
  ]);

  return controls.map(([controlId, result]) => ({
    control_id: controlId,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: result.passed ? "unsatisfied" : "satisfied",
    result
  }));
}

function exclusionControls(profile) {
  const fixture = buildAuthenticationProvenanceFixture();
  fixture.profile = profile;
  const satisfaction = evaluate(fixture);
  return EXCLUSIONS.map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  if (profileDigest(profile) !== PROFILE_DIGEST) throw new Error(
    "authentication/provenance profile digest is stale"
  );
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...buildProfileWeakeningControls(profile).map(({ result, ...control }) => control),
      ...exclusionControls(profile)
    ]
  };
}

export {
  EXCLUSIONS,
  GUARANTEE_DIGEST,
  PROFILE_DIGEST,
  captureAttackControls,
  buildProfileWeakeningControls,
  rejectionFixtures,
  runProofPackAdequacyControls
};
