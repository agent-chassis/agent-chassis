import {
  PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";
import {
  evaluateVerificationProfileV034
} from "../../lib/verification-profile-v034.mjs";

import {
  buildAtomicityFixture,
  ref,
  referenceIdForRole
} from "./atomicity-v1-fixture.mjs";
import {
  DOMAINS,
  committedVector,
  executeAttempt,
  runForFixture
} from "./atomicity-v1-harness.mjs";

const ATOMICITY_V1_PROFILE_DIGEST =
  "6bcfc451b5883a076ab5b0f6da7186d1168ce66f035282c8290babe336adee24";
const ATOMICITY_V1_GUARANTEE_DIGEST =
  "3d9681b4aa9e3f75889648eb4d87f995da443f7768f7c7d1938d4e93701a9a98";

const GUARANTEE_CRITICAL_PATTERNS = Object.freeze({
  "compound-operation-writes-constituent-effects": {
    pattern_id: "compound-operation-writes-constituent-effects",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "compound_operation",
      operator: "reference:writes",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "reference", role: "constituent_effects" }]
    }
  },
  "earlier-effect-population-membership": {
    pattern_id: "earlier-effect-population-membership",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "earlier_constituent_effect",
      operator: "reference:member_of",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "reference", role: "constituent_effect_population" }]
    }
  },
  "constituent-effect-order": {
    pattern_id: "constituent-effect-order",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "earlier_constituent_effect",
      operator: "reference:precedes",
      applicability_context: {
        mode: "during",
        operand_roles: ["operation_attempt"]
      },
      operands: [{ kind: "reference", role: "later_constituent_effect" }]
    }
  },
  "failure-boundary-precedes-later-effect": {
    pattern_id: "failure-boundary-precedes-later-effect",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "failure_boundary",
      operator: "reference:precedes",
      applicability_context: {
        mode: "during",
        operand_roles: ["operation_attempt"]
      },
      operands: [{ kind: "reference", role: "later_constituent_effect" }]
    }
  },
  "settlement-follows-later-effect": {
    pattern_id: "settlement-follows-later-effect",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "settlement_event",
      operator: "reference:follows",
      applicability_context: {
        mode: "during",
        operand_roles: ["operation_attempt"]
      },
      operands: [{ kind: "reference", role: "later_constituent_effect" }]
    }
  },
  "allowed-settlement-states-closed": {
    pattern_id: "allowed-settlement-states-closed",
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "allowed_settlement_states",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "number", value: 2 }]
    }
  }
});

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

const DOMAIN_TYPE_OVERRIDES = {
  ledger: {
    earlier_constituent_effect: "cc:lifecycle_entity",
    later_constituent_effect: "cc:lifecycle_entity",
    verification: "cc:test"
  },
  catalog: {
    earlier_constituent_effect: "cc:resource",
    later_constituent_effect: "cc:artifact",
    constituent_effect_population: "cc:entity",
    verification: "cc:test"
  },
  platform: {
    earlier_constituent_effect: "cc:resource",
    later_constituent_effect: "cc:resource",
    partial_commit_condition: "cc:state",
    verification: "cc:test"
  }
};

function fixtureForExecution(profile, execution, extra = {}) {
  return buildAtomicityFixture({
    profile,
    domain: execution.domain,
    run: runForFixture(execution),
    reference_type_overrides: {
      ...DOMAIN_TYPE_OVERRIDES[execution.domain],
      ...(extra.reference_type_overrides ?? {})
    },
    ...extra
  });
}

function executionKilled(execution) {
  const states = execution.settlement_states;
  const settledAtomically = states.every((state) => state === "committed") ||
    states.every((state) => state === "absent");
  return !settledAtomically || execution.observation_drifted ||
    !execution.failure_injected || execution.boundary_position !== "between";
}

function positiveControls(profile) {
  const cases = [
    {
      control_id: "ledger-debit-credit-none-committed",
      execution: executeAttempt({ domain: "ledger", strategy: "rollback-on-boundary-failure" }),
      extra: {}
    },
    {
      control_id: "catalog-update-publish-all-committed",
      execution: executeAttempt({
        domain: "catalog",
        strategy: "complete-forward-then-report-failure"
      }),
      extra: {}
    },
    {
      control_id: "platform-multi-resource-none-committed",
      execution: executeAttempt({
        domain: "platform",
        strategy: "rollback-on-boundary-failure"
      }),
      extra: {}
    },
    {
      control_id: "ledger-interleaved-harmless-claims",
      execution: executeAttempt({ domain: "ledger", strategy: "rollback-on-boundary-failure" }),
      extra: {
        ordered_sequence_extra_claim_ids: ["claim-harmless-latency-note"],
        mutate_contract(contract) {
          contract.references.push({
            reference_id: "ref-latency-budget",
            type_term: "cc:criterion",
            identity: { kind: "profile_term", term: "ledger:latency-budget" }
          });
          contract.propositions.push({
            proposition_id: "prop-harmless-latency-note",
            subject_reference_id: referenceIdForRole("compound_operation"),
            operator: "reference:conforms_to",
            applicability_context: { mode: "unconditional", operand_reference_ids: [] },
            operands: [ref("ref-latency-budget")]
          });
          contract.claims.push({
            claim_id: "claim-harmless-latency-note",
            kind: "evidence",
            modality: "MUST",
            proposition_id: "prop-harmless-latency-note"
          });
        }
      }
    },
    {
      control_id: "catalog-alternative-verification-method",
      execution: executeAttempt({
        domain: "catalog",
        strategy: "complete-forward-then-report-failure"
      }),
      extra: {
        verification_method: "analysis",
        reference_type_overrides: {
          verification: "cc:process",
          earlier_effect_observation: "cc:evidence",
          later_effect_observation: "cc:evidence"
        }
      }
    }
  ];
  return cases.map(({ control_id: controlId, execution, extra }) => ({
    control_id: controlId,
    category: "positive",
    implementation_outcome: executionKilled(execution) ? "killed" : "passed",
    profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution, extra))
  }));
}

const MUTANTS = [
  ["earlier-committed-later-absent", { domain: "ledger", strategy: "abandon-without-rollback" }],
  ["later-committed-earlier-absent", {
    domain: "ledger", strategy: "compensate-earlier-and-apply-later"
  }],
  ["partial-repaired-after-settlement", {
    domain: "ledger", strategy: "repair-after-settlement"
  }],
  ["partial-outside-pinned-effect-pair", {
    domain: "platform", strategy: "complete-forward-dropping-last-effect"
  }],
  ["failure-injected-before-first-effect", {
    domain: "ledger", strategy: "fail-before-first-effect"
  }],
  ["failure-never-injected", { domain: "ledger", strategy: "never-inject-failure" }],
  ["earlier-effect-torn-write", {
    domain: "ledger", strategy: "torn-write-on-boundary-failure"
  }]
];

function mutantControls(profile) {
  return MUTANTS.map(([controlId, attempt]) => {
    const execution = executeAttempt(attempt);
    return {
      control_id: controlId,
      category: "mutant",
      implementation_outcome: executionKilled(execution) ? "killed" : "passed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution))
    };
  });
}

function removeClaims(contract, claimIds) {
  const ids = new Set(claimIds);
  const propositionIds = new Set(contract.claims
    .filter(({ claim_id: claimId }) => ids.has(claimId))
    .flatMap(({ proposition_id: propositionId, falsifying_proposition_id: falsifierId }) =>
      [propositionId, falsifierId].filter(Boolean)));
  contract.claims = contract.claims.filter(({ claim_id: claimId }) => !ids.has(claimId));
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) => !propositionIds.has(propositionId)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      !ids.has(source) && !ids.has(target)
  );
  contract.collections = contract.collections
    .map((collection) => ({
      ...collection,
      member_claim_ids: collection.member_claim_ids.filter((claimId) => !ids.has(claimId))
    }))
    .filter(({ member_claim_ids: members }) => members.length > 0);
}

function propositionFor(contract, propositionId) {
  return contract.propositions.find(
    ({ proposition_id: id }) => id === propositionId
  );
}

function baselineExecution() {
  return executeAttempt({ domain: "ledger", strategy: "rollback-on-boundary-failure" });
}

function baselineFixture(profile, extra = {}) {
  return fixtureForExecution(profile, baselineExecution(), extra);
}

function independentlyMissingPatternFixture(profile, patternId) {
  const restoredProfile = structuredClone(profile);
  if (!restoredProfile.claim_patterns.some(({ pattern_id: id }) => id === patternId)) {
    restoredProfile.claim_patterns.push(structuredClone(GUARANTEE_CRITICAL_PATTERNS[patternId]));
  }
  const attack = baselineFixture(restoredProfile);
  const actualShape = baselineFixture(profile);
  attack.profile = profile;
  attack.contract.relations = actualShape.contract.relations;
  attack.contract.collections = actualShape.contract.collections;
  removeClaims(attack.contract, [`claim-${patternId}`]);
  return attack;
}

function rejectionFixtures(profile) {
  return {
    "constituent-effect-omitted-from-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, ["claim-later-effect-population-membership"]);
      }
    }),
    "declared-effect-not-observed": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, ["claim-later-effect-observation-record"]);
      }
    }),
    "observation-before-settlement": () => baselineFixture(profile, {
      mutate_contract(contract) {
        for (const position of ["earlier", "later"]) {
          propositionFor(contract, `prop-${position}-effect-observation-record`)
            .applicability_context = {
              mode: "before",
              operand_reference_ids: [referenceIdForRole("settlement_event")]
            };
        }
      }
    }),
    "failure-boundary-not-between-effects": () => baselineFixture(profile, {
      mutate_contract(contract) {
        propositionFor(contract, "prop-failure-boundary-follows-earlier-effect")
          .operator = "reference:precedes";
      }
    }),
    "settlement-precedes-injected-failure": () => baselineFixture(profile, {
      mutate_contract(contract) {
        propositionFor(contract, "prop-settlement-follows-injected-failure")
          .operator = "reference:precedes";
      }
    }),
    "status-only-verification": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, [
          "claim-settled-outcome-within-allowed-states",
          "claim-atomic-settlement-verification"
        ]);
        for (const [suffix, term] of [["failed", "failed"], ["succeeded", "succeeded"]]) {
          contract.references.push({
            reference_id: `ref-attempt-status-${suffix}`,
            type_term: "cc:state",
            identity: { kind: "profile_term", term: `ledger:attempt-status-${term}` }
          });
        }
        contract.propositions.push({
          proposition_id: "prop-attempt-reports-failure",
          subject_reference_id: referenceIdForRole("operation_attempt"),
          operator: "reference:has_status",
          applicability_context: {
            mode: "after",
            operand_reference_ids: [referenceIdForRole("settlement_event")]
          },
          operands: [ref("ref-attempt-status-failed")]
        }, {
          proposition_id: "prop-attempt-status-verification",
          subject_reference_id: referenceIdForRole("verification"),
          operator: "reference:covers",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [ref(referenceIdForRole("operation_attempt"))]
        }, {
          proposition_id: "prop-attempt-status-falsifier",
          subject_reference_id: referenceIdForRole("operation_attempt"),
          operator: "reference:has_status",
          applicability_context: {
            mode: "after",
            operand_reference_ids: [referenceIdForRole("settlement_event")]
          },
          operands: [ref("ref-attempt-status-succeeded")]
        });
        contract.claims.push({
          claim_id: "claim-attempt-reports-failure",
          kind: "behavior",
          modality: "MUST",
          proposition_id: "prop-attempt-reports-failure"
        }, {
          claim_id: "claim-attempt-status-verification",
          kind: "verification",
          modality: "MUST",
          proposition_id: "prop-attempt-status-verification",
          verification_method: "test_execution",
          falsifying_proposition_id: "prop-attempt-status-falsifier"
        });
        contract.relations.push({
          relation_id: "rel-attempt-status-verification",
          role: "verifies",
          source_claim_id: "claim-attempt-status-verification",
          target_claim_id: "claim-attempt-reports-failure"
        });
      }
    }),
    "verification-reads-single-effect": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, ["claim-later-effect-observation-read"]);
      }
    }),
    "verification-falsifier-unrelated": () => baselineFixture(profile, {
      mutate_contract(contract) {
        const falsifier = propositionFor(
          contract, "prop-falsifier-atomic-settlement-verification"
        );
        falsifier.subject_reference_id = referenceIdForRole("operation_attempt");
        falsifier.operator = "reference:not_equals";
        falsifier.operands = [ref(referenceIdForRole("injected_failure"))];
      }
    }),
    "verification-falsifier-names-another-attempt": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-attempt-partial-commit-condition",
          type_term: "cc:configuration",
          identity: { kind: "profile_term", term: "ledger:other-attempt-partial-commit" }
        });
        propositionFor(contract, "prop-falsifier-atomic-settlement-verification")
          .applicability_context = {
            mode: "when",
            operand_reference_ids: ["ref-other-attempt-partial-commit-condition"]
          };
      }
    }),
    "forbidden-partial-state-aliases-allowed-state": () => baselineFixture(profile, {
      reference_id_overrides: { forbidden_partial_state: "ref-fully-committed-state" }
    }),
    "allowed-settlement-states-collapse": () => baselineFixture(profile, {
      reference_id_overrides: { fully_uncommitted_state: "ref-fully-committed-state" }
    }),
    "single-constituent-effect": () => baselineFixture(profile, {
      mutate_input(input) {
        const binding = input.reference_bindings.find(
          ({ role }) => role === "later_constituent_effect"
        );
        binding.reference_ids = [referenceIdForRole("earlier_constituent_effect")];
      }
    }),

    "population-count-below-profile-minimum": () => baselineFixture(profile, {
      mutate_input(input) {
        input.number_bindings.find(({ role }) => role === "constituent_effect_count")
          .value = 1;
      }
    }),
    "population-count-contradicts-plurality": () => baselineFixture(profile, {
      mutate_contract(contract) {
        propositionFor(contract, "prop-constituent-effect-population-cardinality")
          .operands = [{ kind: "number", value: 1 }];
      }
    }),
    "bound-population-count-mismatch": () => fixtureForExecution(
      profile,
      executeAttempt({ domain: "platform", strategy: "rollback-on-boundary-failure" }),
      {
        mutate_contract(contract) {
          const operationWrites = propositionFor(
            contract, "prop-compound-operation-writes-constituent-effects"
          );
          const populationMembers = propositionFor(
            contract, "prop-constituent-effect-population-members"
          );
          if (operationWrites) operationWrites.operands.pop();
          if (populationMembers) populationMembers.operands.pop();
        },
        mutate_input(input) {
          input.reference_bindings.find(
            ({ role }) => role === "constituent_effects"
          ).reference_ids.pop();
        }
      }
    ),
    "declared-population-exceeds-exact-cardinality": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-undeclared-third-effect",
          type_term: "cc:resource",
          identity: { kind: "profile_term", term: "ledger:undeclared-third-effect" }
        });
        contract.propositions.push({
          proposition_id: "prop-undeclared-third-effect-membership",
          subject_reference_id: "ref-undeclared-third-effect",
          operator: "reference:member_of",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [ref(referenceIdForRole("constituent_effect_population"))]
        });
        contract.claims.push({
          claim_id: "claim-undeclared-third-effect-membership",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-undeclared-third-effect-membership"
        });
      }
    }),
    "settled-outcome-unclassified": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, [
          "claim-settled-outcome-is-fully-committed",
          "claim-settled-outcome-is-fully-uncommitted"
        ]);
      }
    }),
    "partial-commit-condition-unanchored": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaims(contract, ["claim-partial-commit-condition-state"]);
      }
    }),
    "competing-proof-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-shadow-observation",
          type_term: "cc:artifact",
          identity: { kind: "profile_term", term: "ledger:shadow-observation" }
        });
        contract.propositions.push({
          proposition_id: "prop-shadow-observation",
          subject_reference_id: referenceIdForRole("verification"),
          operator: "reference:reads",
          applicability_context: {
            mode: "before",
            operand_reference_ids: [referenceIdForRole("settlement_event")]
          },
          operands: [ref("ref-shadow-observation")]
        });
        contract.claims.push({
          claim_id: "claim-shadow-observation",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-shadow-observation"
        });
        const population = contract.collections.find(
          ({ collection_id: id }) => id === "set-proof-population"
        );
        contract.collections.push({
          collection_id: "set-competing-proof-population",
          collection_kind: "closed_set",
          purpose: "profile_proof_population",
          member_claim_ids: [...population.member_claim_ids, "claim-shadow-observation"]
        });
      }
    }),
    "reordered-proof-sequence": () => baselineFixture(profile, {
      mutate_contract(contract) {
        const sequence = contract.collections.find(
          ({ collection_id: id }) => id === "set-proof-sequence-earlier-effect"
        );
        const members = sequence.member_claim_ids;
        const record = members.indexOf("claim-earlier-effect-observation-record");
        const read = members.indexOf("claim-earlier-effect-observation-read");
        [members[record], members[read]] = [members[read], members[record]];
      }
    }),
    "missing-earlier-effect-population-membership": () =>
      independentlyMissingPatternFixture(profile, "earlier-effect-population-membership"),
    "missing-compound-operation-write-population": () =>
      independentlyMissingPatternFixture(
        profile, "compound-operation-writes-constituent-effects"
      ),
    "missing-allowed-settlement-state-closure": () =>
      independentlyMissingPatternFixture(profile, "allowed-settlement-states-closed"),
    "missing-constituent-effect-order": () =>
      independentlyMissingPatternFixture(profile, "constituent-effect-order"),
    "missing-boundary-before-later-effect": () =>
      independentlyMissingPatternFixture(profile, "failure-boundary-precedes-later-effect"),
    "missing-settlement-after-later-effect": () =>
      independentlyMissingPatternFixture(profile, "settlement-follows-later-effect"),
    "temporal-ordering-cycle": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.propositions.push({
          proposition_id: "prop-later-effect-precedes-earlier-effect",
          subject_reference_id: referenceIdForRole("later_constituent_effect"),
          operator: "reference:precedes",
          applicability_context: {
            mode: "during",
            operand_reference_ids: [referenceIdForRole("operation_attempt")]
          },
          operands: [ref(referenceIdForRole("earlier_constituent_effect"))]
        });
        contract.claims.push({
          claim_id: "claim-later-effect-precedes-earlier-effect",
          kind: "evidence",
          modality: "MUST",
          proposition_id: "prop-later-effect-precedes-earlier-effect"
        });
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(rejectionFixtures(profile)).map(([controlId, createFixture]) => ({
    control_id: controlId,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: evaluateFixture(createFixture())
  }));
}

function exclusionControls(profile) {
  const baseline = baselineExecution();
  const baselineSatisfaction = evaluateFixture(fixtureForExecution(profile, baseline));

  const transientPartial = baseline.transiently_committed.some((vector) =>
    vector.some(Boolean) && vector.some((value) => !value)
  );

  const platform = DOMAINS.platform();
  const sharedStore = platform.createStore();
  const attemptOne = executeAttempt({
    domain: "platform", strategy: "rollback-on-boundary-failure", store: sharedStore
  });
  platform.effects[0].commit(sharedStore);
  const attemptTwo = executeAttempt({
    domain: "platform", strategy: "rollback-on-boundary-failure", store: sharedStore
  });
  const interferenceObserved = attemptOne.settlement_committed.every((value) => !value) &&
    attemptTwo.settlement_committed.every((value) => !value) &&
    committedVector(platform, sharedStore).some(Boolean) === false &&
    sharedStore.resources.size === 0;

  const outsidePopulation = executeAttempt({
    domain: "ledger", strategy: "rollback-with-audit-write"
  });
  const outsideSatisfaction = evaluateFixture(
    fixtureForExecution(profile, outsidePopulation)
  );

  const dishonestExecution = executeAttempt({
    domain: "ledger", strategy: "complete-forward-then-report-failure"
  });
  const dishonestFixture = buildAtomicityFixture({
    profile,
    domain: "ledger",
    run: {
      ...runForFixture(dishonestExecution),
      settlement_committed: [false, false],
      observation_committed: [false, false],
      settlement_states: ["absent", "absent"],
      observation_states: ["absent", "absent"]
    },
    reference_type_overrides: DOMAIN_TYPE_OVERRIDES.ledger
  });
  const dishonestSatisfaction = evaluateFixture(dishonestFixture);

  const completedDespiteFailure = executeAttempt({
    domain: "catalog", strategy: "complete-forward-then-report-failure"
  });
  const completedSatisfaction = evaluateFixture(
    fixtureForExecution(profile, completedDespiteFailure)
  );

  const threeEffect = executeAttempt({
    domain: "platform", strategy: "rollback-on-boundary-failure"
  });
  const withThirdEffectClaims = evaluateFixture(
    fixtureForExecution(profile, threeEffect)
  );
  const withoutThirdEffectClaims = evaluateFixture(fixtureForExecution(
    profile,
    threeEffect,
    {
      mutate_contract(contract) {
        removeClaims(contract, [
          "claim-constituent-effect-3-membership",
          "claim-constituent-effect-3-settled-state"
        ]);
      }
    }
  ));

  const overloadedVerification = evaluateFixture(baselineFixture(profile, {
    mutate_contract(contract) {
      contract.references.push({
        reference_id: "ref-unrelated-latency-target",
        type_term: "cc:criterion",
        identity: { kind: "profile_term", term: "ledger:unrelated-latency-target" }
      });
      contract.propositions.push({
        proposition_id: "prop-unrelated-latency-behavior",
        subject_reference_id: referenceIdForRole("compound_operation"),
        operator: "reference:conforms_to",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [ref("ref-unrelated-latency-target")]
      });
      contract.claims.push({
        claim_id: "claim-unrelated-latency-behavior",
        kind: "behavior",
        modality: "MUST",
        proposition_id: "prop-unrelated-latency-behavior"
      });
      contract.relations.push({
        relation_id: "rel-unrelated-latency-verification",
        role: "verifies",
        source_claim_id: "claim-atomic-settlement-verification",
        target_claim_id: "claim-unrelated-latency-behavior"
      });
    }
  }));

  const demonstrations = {
    "transient-partial-state-before-settlement": {
      demonstrated: baselineSatisfaction === "satisfied" && transientPartial,
      satisfaction: baselineSatisfaction
    },
    "concurrent-attempt-interference": {
      demonstrated: baselineSatisfaction === "satisfied" && interferenceObserved,
      satisfaction: baselineSatisfaction
    },
    "mutation-outside-the-declared-effect-population": {
      demonstrated: outsideSatisfaction === "satisfied" &&
        outsidePopulation.store.auditWrites > 0,
      satisfaction: outsideSatisfaction
    },
    "authored-claim-truthfulness": {
      demonstrated: dishonestSatisfaction === "satisfied" &&
        dishonestExecution.settlement_committed.every(Boolean),
      satisfaction: dishonestSatisfaction
    },
    "injected-failure-need-not-abort-the-operation": {
      demonstrated: completedSatisfaction === "satisfied" &&
        completedDespiteFailure.settlement_committed.every(Boolean) &&
        completedDespiteFailure.failure_injected,
      satisfaction: completedSatisfaction
    },
    "per-effect-obligations-beyond-the-boundary-pair": {
      demonstrated: withThirdEffectClaims === "satisfied" &&
        withoutThirdEffectClaims === "satisfied",
      satisfaction: withoutThirdEffectClaims
    },
    "verification-exclusivity": {
      demonstrated: overloadedVerification === "satisfied",
      satisfaction: overloadedVerification
    }
  };
  return Object.entries(demonstrations).map(
    ([controlId, { demonstrated, satisfaction }]) => ({
      control_id: controlId,
      category: "exclusion",
      implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
      profile_satisfaction: satisfaction
    })
  );
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: ATOMICITY_V1_PROFILE_DIGEST,
    guarantee_digest: ATOMICITY_V1_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  ATOMICITY_V1_GUARANTEE_DIGEST,
  ATOMICITY_V1_PROFILE_DIGEST,
  evaluateFixture,
  executionKilled,
  fixtureForExecution,
  rejectionFixtures,
  removeClaims,
  runProofPackAdequacyControls
};
