import { PROOF_PACK_ADEQUACY_RUN_VERSION }
  from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 }
  from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildForbiddenOperationNoninvocationFixture,
  findClaim,
  findProposition,
  ref
} from "./forbidden-operation-noninvocation-v1-fixture.mjs";
import {
  DOMAINS,
  MUTATIONS,
  executeForbiddenOperationNoninvocation,
  forbiddenOperationNoninvocationGuaranteeSatisfied
} from "./forbidden-operation-noninvocation-v1-harness.mjs";

const PROFILE_DIGEST = "2bd239cbe18bbbb63db76d21b645713e1cd9de89226438668de654f452be2a07";
const GUARANTEE_DIGEST = "37c6bfcae8528804a5a06d4013d6595e92742ce97e982ef126790662e6acf7df";
const EXCLUSIONS = Object.freeze([
  "actual-execution-or-mutation-test-outcome",
  "dishonest-reference-context-population-or-verification-grounding",
  "dynamic-reflective-or-environment-dependent-invocation-absent-from-the-declared-model",
  "forbidden-operations-outside-the-caller-declared-complete-population",
  "invocation-after-or-outside-the-declared-context",
  "production-path-or-call-graph-discovery"
]);

const evaluateFixture = ({ contract, input, evaluation_input: evaluationInput, profile }) =>
  evaluateStableProofPackFixtureV1({
    contract, profile, evaluation_input: evaluationInput ?? input
  }).satisfaction;
const baselineFixture = (profile, options = {}) =>
  buildForbiddenOperationNoninvocationFixture({ profile, ...options });

function positiveControls(profile) {
  return Object.entries(DOMAINS).map(([domain, definition]) => {
    const run = executeForbiddenOperationNoninvocation({ domain });
    const forbiddenIds = definition.forbidden.map((_, index) =>
      `ref-forbidden-operation-${index + 1}`);
    const fixture = baselineFixture(profile, {
      domain,
      role_id_overrides: { forbidden_operations: forbiddenIds }
    });
    return {
      control_id: domain,
      category: "positive",
      implementation_outcome: forbiddenOperationNoninvocationGuaranteeSatisfied(run)
        ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(fixture)
    };
  });
}

function addObservedForbiddenUse(contract, operationId, {
  subjectId = "ref-subject-operation", contextId = "ref-execution-context",
  propositionId = "prop-observed-forbidden-use", claimId = "claim-observed-forbidden-use"
} = {}) {
  contract.propositions.push({
    proposition_id: propositionId,
    subject_reference_id: subjectId,
    operator: "reference:uses",
    applicability_context: {
      mode: "when", operand_reference_ids: [contextId]
    },
    operands: [ref(operationId)]
  });
  contract.claims.push({
    claim_id: claimId,
    kind: "evidence",
    modality: "MUST",
    proposition_id: propositionId
  });
}

function legitimateControls(profile) {
  const cases = [
    ["verification-method-analysis", { verification_method: "analysis" }],
    ["verification-method-demonstration", { verification_method: "demonstration" }],
    ["verification-method-proof", { verification_method: "proof" }],
    ["single-forbidden-operation", {
      role_id_overrides: { forbidden_operations: ["ref-forbidden-operation-1"] }
    }],
    ["five-forbidden-operations", {
      role_id_overrides: { forbidden_operations: [1, 2, 3, 4, 5].map(
        (index) => `ref-forbidden-operation-${index}`
      ) }
    }],
    ["process-subject-and-verifier", {
      role_type_overrides: { subject_operation: "cc:process", verification: "cc:process" }
    }],
    ["scope-context-runtime-component-operation", {
      role_type_overrides: {
        execution_context: "cc:scope", forbidden_operations: "cc:runtime_component"
      }
    }],
    ["forbidden-use-outside-selected-context", {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-context", type_term: "cc:configuration",
          identity: { kind: "profile_term", term: "outside-selected-context" }
        });
        addObservedForbiddenUse(contract, "ref-forbidden-operation-1", {
          contextId: "ref-other-context"
        });
      }
    }],
    ["forbidden-use-by-different-subject", {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-subject", type_term: "cc:operation",
          identity: {
            kind: "code_symbol", repository: "fixture-other",
            path: "src/other.mjs", symbol: "otherSubject"
          }
        });
        addObservedForbiddenUse(contract, "ref-forbidden-operation-1", {
          subjectId: "ref-other-subject"
        });
      }
    }]
  ];
  return cases.map(([controlId, options]) => ({
    control_id: controlId,
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: evaluateFixture(baselineFixture(profile, options))
  }));
}

function mutantFixture(profile, mutant) {
  return baselineFixture(profile, {
    mutate_contract(contract) {
      if (mutant === "last-forbidden-operation-restored") {
        addObservedForbiddenUse(contract, "ref-forbidden-operation-2");
        return;
      }
      if (mutant === "multiple-forbidden-operations-restored") {
        addObservedForbiddenUse(contract, "ref-forbidden-operation-1");
        const proposition = contract.propositions.find(
          ({ proposition_id: propositionId }) => propositionId === "prop-observed-forbidden-use"
        );
        proposition.operands.push(ref("ref-forbidden-operation-2"));
        return;
      }
      addObservedForbiddenUse(contract, "ref-forbidden-operation-1");
    }
  });
}

function mutantControls(profile) {
  return Object.keys(MUTATIONS).map((mutant) => {
    const run = executeForbiddenOperationNoninvocation({ mutant });
    return {
      control_id: mutant,
      category: "mutant",
      implementation_outcome: forbiddenOperationNoninvocationGuaranteeSatisfied(run)
        ? "passed" : "killed",
      profile_satisfaction: evaluateFixture(mutantFixture(profile, mutant))
    };
  });
}

function removeClaim(contract, patternId) {
  const claim = findClaim(contract, patternId);
  const propositionIds = new Set([
    claim?.proposition_id, claim?.falsifying_proposition_id
  ].filter(Boolean));
  contract.claims = contract.claims.filter(({ claim_id: claimId }) =>
    claimId !== claim?.claim_id);
  contract.propositions = contract.propositions.filter(({ proposition_id: propositionId }) =>
    !propositionIds.has(propositionId));
  contract.relations = contract.relations.filter(({ source_claim_id: source, target_claim_id: target }) =>
    source !== claim?.claim_id && target !== claim?.claim_id);
}

function profileRejectionFixtures(profile) {
  return {
    "missing-forbidden-population-count": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.claims = contract.claims.filter(({ claim_id: claimId }) =>
          claimId !== "claim-forbidden-population-cardinality");
        contract.propositions = contract.propositions.filter(({ proposition_id: propositionId }) =>
          propositionId !== "prop-forbidden-population-cardinality");
      }
    }),
    "incomplete-forbidden-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        const population = contract.propositions.find(({ proposition_id: propositionId }) =>
          propositionId === "prop-forbidden-population-contains");
        population.operands.pop();
      }
    }),
    "missing-noninvocation-behavior": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "subject-does-not-use-forbidden-operations");
      }
    }),
    "wrong-noninvocation-subject": () => baselineFixture(profile, {
      proposition_overrides: {
        "subject-does-not-use-forbidden-operations": {
          subject_reference_id: "ref-verification"
        }
      }
    }),
    "wrong-noninvocation-context": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-context", type_term: "cc:configuration",
          identity: { kind: "profile_term", term: "other-execution-context" }
        });
        findProposition(contract, "subject-does-not-use-forbidden-operations")
          .applicability_context.operand_reference_ids = ["ref-other-context"];
      }
    }),
    "missing-verification-observation": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "verification-observes-exact-noninvocation-subjects");
      }
    }),
    "status-only-verification-observation": () => baselineFixture(profile, {
      proposition_overrides: {
        "verification-observes-exact-noninvocation-subjects": {
          operator: "boolean:exists",
          operands: []
        }
      }
    }),
    "missing-verification": () => baselineFixture(profile, {
      mutate_contract(contract) {
        removeClaim(contract, "verify-forbidden-operation-noninvocation");
      }
    }),
    "missing-verifies-relation": () => baselineFixture(profile, {
      mutate_contract(contract) { contract.relations = []; }
    }),
    "wrong-falsifier-subject": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:verify-forbidden-operation-noninvocation": {
          subject_reference_id: "ref-verification"
        }
      }
    }),
    "wrong-falsifier-context": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:verify-forbidden-operation-noninvocation": {
          applicability_context: { mode: "unconditional", operand_reference_ids: [] }
        }
      }
    }),
    "wrong-falsifier-operator": () => baselineFixture(profile, {
      proposition_overrides: {
        "falsifier:verify-forbidden-operation-noninvocation": {
          operator: "reference:reads"
        }
      }
    }),
    "missing-forbidden-operation-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "forbidden_operations"
        );
      }
    })
  };
}

const profileRejectionControls = (profile) => Object.entries(
  profileRejectionFixtures(profile)
).map(([controlId, make]) => ({
  control_id: controlId,
  category: "profile_rejection",
  implementation_outcome: "not_applicable",
  profile_satisfaction: evaluateFixture(make())
}));

function exclusionControls(profile) {
  const satisfaction = evaluateFixture(baselineFixture(profile));
  return EXCLUSIONS.map((controlId) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: satisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...legitimateControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  EXCLUSIONS,
  GUARANTEE_DIGEST as FORBIDDEN_OPERATION_NONINVOCATION_V1_GUARANTEE_DIGEST,
  PROFILE_DIGEST as FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE_DIGEST,
  baselineFixture,
  evaluateFixture,
  profileRejectionFixtures,
  runProofPackAdequacyControls
};
