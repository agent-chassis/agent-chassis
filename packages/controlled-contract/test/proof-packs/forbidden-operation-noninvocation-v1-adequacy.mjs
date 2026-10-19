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

const PROFILE_DIGEST = "15117ae61d90926813b6c1dbf0500269771f245ed41759adba2c6832d8a370be";
const GUARANTEE_DIGEST = "ceb829c30d301a48cf89646f0c159e35b03e4b867e8428c0eff96b81e16a9f21";
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

function addObservedForbiddenCall(contract, operationId, {
  subjectId = "ref-subject-operation", contextId = "ref-execution-context",
  propositionId = "prop-observed-forbidden-call", claimId = "claim-observed-forbidden-call"
} = {}) {
  contract.propositions.push({
    proposition_id: propositionId,
    subject_reference_id: subjectId,
    operator: "reference:calls",
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
    ["permitted-call-in-selected-context", {
      mutate_contract(contract) {
        contract.references.push({ reference_id: "ref-permitted-operation", type_term: "cc:operation",
          identity: { kind: "durable_id", domain: "noninvocation-control", value: "permitted" } });
        addObservedForbiddenCall(contract, "ref-permitted-operation");
      }
    }],
    ["forbidden-call-outside-selected-context", {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-context", type_term: "cc:configuration",
          identity: { kind: "profile_term", term: "outside-selected-context" }
        });
        addObservedForbiddenCall(contract, "ref-forbidden-operation-1", {
          contextId: "ref-other-context"
        });
      }
    }],
    ["forbidden-call-by-different-subject", {
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-other-subject", type_term: "cc:operation",
          identity: {
            kind: "code_symbol", repository: "fixture-other",
            path: "src/other.mjs", symbol: "otherSubject"
          }
        });
        addObservedForbiddenCall(contract, "ref-forbidden-operation-1", {
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
        addObservedForbiddenCall(contract, "ref-forbidden-operation-2");
        return;
      }
      if (mutant === "multiple-forbidden-operations-restored") {
        addObservedForbiddenCall(contract, "ref-forbidden-operation-1");
        const proposition = contract.propositions.find(
          ({ proposition_id: propositionId }) => propositionId === "prop-observed-forbidden-call"
        );
        proposition.operands.push(ref("ref-forbidden-operation-2"));
        return;
      }
      addObservedForbiddenCall(contract, "ref-forbidden-operation-1");
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
    "permission-is-not-prohibition": () => baselineFixture(profile, {
      modality_overrides: { "subject-does-not-call-forbidden-operations": "MAY" }
    }),
    "optional-verification-does-not-discharge-prohibition": () => baselineFixture(profile, {
      modality_overrides: { "verify-forbidden-operation-noninvocation": "MAY" }
    }),
    "retired-recommendation-prohibition": () => baselineFixture(profile, {
      modality_overrides: { "subject-does-not-call-forbidden-operations": "SHOULD_NOT" }
    }),
    "retired-recommendation-verification": () => baselineFixture(profile, {
      modality_overrides: { "verify-forbidden-operation-noninvocation": "SHOULD" }
    }),
    "empty-forbidden-population": () => baselineFixture(profile, {
      role_id_overrides: { forbidden_operations: [] }
    }),
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
        removeClaim(contract, "subject-does-not-call-forbidden-operations");
      }
    }),
    "wrong-noninvocation-subject": () => baselineFixture(profile, {
      proposition_overrides: {
        "subject-does-not-call-forbidden-operations": {
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
        findProposition(contract, "subject-does-not-call-forbidden-operations")
          .applicability_context.operand_reference_ids = ["ref-other-context"];
      }
    }),
    "partial-noninvocation-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        findProposition(contract, "subject-does-not-call-forbidden-operations").operands.pop();
      }
    }),
    "wrong-noninvocation-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({ reference_id: "ref-other-operation", type_term: "cc:operation",
          identity: { kind: "durable_id", domain: "noninvocation-control", value: "other" } });
        findProposition(contract, "subject-does-not-call-forbidden-operations").operands[0] = ref("ref-other-operation");
      }
    }),
    "retired-broad-use-declaration": () => baselineFixture(profile, {
      mutate_contract(contract) {
        findProposition(contract, "subject-does-not-call-forbidden-operations").operator = "reference:uses";
        findProposition(contract, "verify-forbidden-operation-noninvocation", { falsifier: true }).operator = "reference:uses";
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
    "partial-falsifier-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        findProposition(contract, "verify-forbidden-operation-noninvocation", { falsifier: true }).operands.pop();
      }
    }),
    "wrong-falsifier-population": () => baselineFixture(profile, {
      mutate_contract(contract) {
        contract.references.push({ reference_id: "ref-other-operation", type_term: "cc:operation",
          identity: { kind: "durable_id", domain: "noninvocation-control", value: "other" } });
        findProposition(contract, "verify-forbidden-operation-noninvocation", { falsifier: true }).operands[0] = ref("ref-other-operation");
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

async function runProofPackAdequacyControls({ profile , negative_fixtures: negativeFixtures }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls: [...await isolatedMandatoryVerificationControls(profile, negativeFixtures),
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

import { assessMandatoryVerificationControlV1 }
  from "../support/stable-v1-proof-pack-runtime.mjs";

async function isolatedMandatoryVerificationControls(profile, negativeFixtures) {
  const cases = [
    {
      "fixture_id": "isolated-claim-verify-forbidden-operation-noninvocation-modalities",
      "claim_id": "claim-verify-forbidden-operation-noninvocation",
      "baseline": "isolated-claim-verify-forbidden-operation-noninvocation-modalities-baseline",
      "optional": "isolated-claim-verify-forbidden-operation-noninvocation-modalities-optional"
    }
  ];
  const controls = [];
  for (const row of cases) {
    if (!Array.isArray(negativeFixtures)) throw new Error("isolated verification controls require captured negative fixtures");
    const fixture = negativeFixtures.find(fixture => fixture.fixture_id === row.fixture_id);
    if (!fixture) throw new Error(`captured verification fixture is missing: ${row.fixture_id}`);
    const result = assessMandatoryVerificationControlV1({ profile, fixture,
      verificationClaimId: row.claim_id });
    if (!result.discriminated) throw new Error(`isolated verification control failed: ${row.optional}: ${JSON.stringify(result)}`);
    controls.push({ control_id: row.baseline, category: "positive",
      implementation_outcome: "passed", profile_satisfaction: result.baseline.satisfaction },
    { control_id: row.optional, category: "profile_rejection",
      implementation_outcome: "not_applicable", profile_satisfaction: result.optional.satisfaction });
  }
  return controls;
}
