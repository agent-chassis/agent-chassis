import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
import {
  RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
  buildResultShapeConformanceFixture,
  findClaim,
  findProposition,
  ref,
  removePatternClaims
} from "./result-shape-conformance-v1-fixture.mjs";
import {
  executeResultShape,
  resultShapeGuaranteeSatisfied
} from "./result-shape-conformance-v1-harness.mjs";

const RESULT_SHAPE_CONFORMANCE_V1_PROFILE_DIGEST =
  "6f93c19165daf4194aedbe6a376b1e55165f918baf4f29593a32ba9672655f11";
const RESULT_SHAPE_CONFORMANCE_V1_GUARANTEE_DIGEST =
  "77dd35821e275dadeb0b82724b51343668e1b595860742aea18e6c3570f85e46";

const descriptorReferenceId = (descriptor) =>
  `ref-member-${descriptor.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;
const shapeReferenceId = (shape) =>
  `ref-shape-${shape.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;

function evaluateFixture({ contract, input, profile }) {
  return evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  }).satisfaction;
}

function fixtureForExecution(profile, execution, options = {}) {
  const requiredIds = execution.required.map(descriptorReferenceId);
  const optionalIds = execution.optional.map(descriptorReferenceId);
  const allowedIds = execution.allowed.map(descriptorReferenceId);
  const forbiddenIds = execution.forbidden.map(descriptorReferenceId);
  const resultIds = execution.members.map(descriptorReferenceId);
  const allowedShapeIds = execution.allowed_shapes.map(shapeReferenceId);
  const forbiddenShapeIds = execution.forbidden_shapes.map(shapeReferenceId);
  return buildResultShapeConformanceFixture({
    profile,
    domain: execution.domain,
    role_id_overrides: {
      result_members: resultIds,
      required_members: requiredIds,
      optional_members: optionalIds,
      allowed_members: allowedIds,
      forbidden_members: forbiddenIds,
      allowed_shapes: allowedShapeIds,
      forbidden_shapes: forbiddenShapeIds,
      result_shape: [shapeReferenceId(execution.shape)]
    },
    number_value_overrides: {
      result_count: resultIds.length,
      required_count: requiredIds.length,
      optional_count: optionalIds.length,
      allowed_count: allowedIds.length,
      forbidden_member_count: forbiddenIds.length,
      allowed_shape_count: allowedShapeIds.length,
      forbidden_shape_count: forbiddenShapeIds.length
    },
    proposition_overrides: {
      "result-count-complete": {
        operands: [{ kind: "number", value: execution.reported_count }]
      }
    },
    ...options
  });
}

function baselineFixture(profile, options = {}) {
  return fixtureForExecution(profile, executeResultShape({ domain: "invoice" }), options);
}

function positiveControls(profile) {
  const cases = [
    ["invoice-object-result", "invoice", "test_execution"],
    ["telemetry-map-result", "telemetry", "analysis"],
    ["command-tuple-result", "command", "proof"]
  ];
  return cases.map(([controlId, domain, verificationMethod]) => {
    const execution = executeResultShape({ domain });
    return {
      control_id: controlId,
      category: "positive",
      implementation_outcome: resultShapeGuaranteeSatisfied(execution)
        ? "passed"
        : "failed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution, {
        verification_method: verificationMethod
      }))
    };
  });
}

function mutantControls(profile) {
  const cases = [
    ["required-member-missing", "missing-required"],
    ["undeclared-extra-member", "extra-member"],
    ["required-member-wrong-type", "wrong-type"],
    ["explicitly-forbidden-member", "forbidden-member"],
    ["explicitly-forbidden-shape", "forbidden-shape"],
    ["result-count-mismatch", "wrong-count"]
  ];
  return cases.map(([controlId, mutant]) => {
    const execution = executeResultShape({ domain: "invoice", mutant });
    return {
      control_id: controlId,
      category: "mutant",
      implementation_outcome: resultShapeGuaranteeSatisfied(execution)
        ? "survived"
        : "killed",
      profile_satisfaction: evaluateFixture(fixtureForExecution(profile, execution))
    };
  });
}

function smokeFixture(profile, kind) {
  const fixture = baselineFixture(profile);
  const verificationPatternIds = profile.claim_patterns
    .filter(({ claim_kind: claimKind }) => claimKind === "verification")
    .map(({ pattern_id: patternId }) => patternId);
  removePatternClaims(fixture.contract, verificationPatternIds);
  fixture.contract.references.push({
    reference_id: "ref-smoke-status",
    type_term: "cc:state",
    identity: { kind: "durable_id", domain: "smoke", value: "http-200" }
  });
  fixture.contract.propositions.push({
    proposition_id: `prop-${kind}`,
    subject_reference_id: fixture.roleIds.verification[0],
    operator: "reference:covers",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [ref(fixture.roleIds.operation[0])]
  }, {
    proposition_id: `prop-falsifier-${kind}`,
    subject_reference_id: kind === "status-only-verification"
      ? fixture.roleIds.result[0]
      : fixture.roleIds.operation[0],
    operator: kind === "status-only-verification"
      ? "reference:has_status"
      : "boolean:exists",
    applicability_context: {
      mode: "when",
      operand_reference_ids: [fixture.roleIds.unexpected_member_condition[0]]
    },
    operands: kind === "status-only-verification"
      ? [ref("ref-smoke-status")]
      : [{ kind: "boolean", value: false }]
  });
  const smokeClaimId = `claim-${kind}`;
  fixture.contract.claims.push({
    claim_id: smokeClaimId,
    kind: "verification",
    modality: "MUST",
    proposition_id: `prop-${kind}`,
    verification_method: "test_execution",
    falsifying_proposition_id: `prop-falsifier-${kind}`
  });
  const behaviorClaimIds = profile.claim_patterns
    .filter(({ claim_kind: claimKind }) => claimKind === "behavior")
    .map(({ pattern_id: patternId }) => `claim-${patternId}`);
  fixture.contract.relations.push(...behaviorClaimIds.map((targetClaimId, index) => ({
    relation_id: `rel-${kind}-${index}`,
    role: "verifies",
    source_claim_id: smokeClaimId,
    target_claim_id: targetClaimId
  })));
  return fixture;
}

function duplicateClaimFixture(profile) {
  return baselineFixture(profile, {
    mutate_contract(contract) {
      const claim = findClaim(contract, "operation-returns-result");
      const proposition = findProposition(contract, "operation-returns-result");
      contract.propositions.push({
        ...structuredClone(proposition),
        proposition_id: "prop-operation-returns-result-duplicate"
      });
      contract.claims.push({
        ...structuredClone(claim),
        claim_id: "claim-operation-returns-result-duplicate",
        proposition_id: "prop-operation-returns-result-duplicate"
      });
    }
  });
}

function profileRejectionFixtures(profile) {
  return {
    "status-only-verification": () => smokeFixture(profile, "status-only-verification"),
    "suite-covers-symbol-negation-only": () =>
      smokeFixture(profile, "suite-covers-symbol-negation-only"),
    "missing-operation-result-stimulus": () => baselineFixture(profile, {
      drop_pattern_ids: ["operation-returns-result"]
    }),
    "missing-result-population-stimulus": () => baselineFixture(profile, {
      drop_pattern_ids: ["result-carries-member-population"]
    }),
    "missing-required-member-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["required-members-present"]
    }),
    "missing-extra-member-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["result-members-allowed"]
    }),
    "missing-forbidden-member-assertions": () => baselineFixture(profile, {
      drop_pattern_ids: ["each-forbidden-member-absent"]
    }),
    "missing-allowed-shape-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["result-shape-allowed"]
    }),
    "missing-forbidden-shape-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["result-shape-not-forbidden"]
    }),
    "missing-count-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["result-count-complete"]
    }),
    "missing-verification-read-spine": () => baselineFixture(profile, {
      drop_pattern_ids: ["verification-reads-result-contract"]
    }),
    "wrong-required-member-falsifier": () => baselineFixture(profile, {
      mutate_contract(contract) {
        findProposition(contract, "required-members-verification", {
          falsifier: true
        }).operator = "reference:subset_of";
      }
    }),
    "ambiguous-duplicate-shape-claim": () => duplicateClaimFixture(profile),
    "missing-result-role-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "result"
        );
      }
    }),
    "ungrounded-result-profile-term": () => baselineFixture(profile, {
      identity_overrides: {
        result: { kind: "profile_term", term: "invented-result" }
      }
    }),
    "ungrounded-schema-profile-term": () => baselineFixture(profile, {
      identity_overrides: {
        schema: { kind: "profile_term", term: "invented-schema" }
      }
    }),
    "collapsed-result-schema-identities": () => baselineFixture(profile, {
      mutate_input(input) {
        const result = input.reference_bindings.find(({ role }) => role === "result");
        input.reference_bindings.find(
          ({ role }) => role === "schema"
        ).reference_ids = [...result.reference_ids];
      }
    }),
    "unbound-result-count": () => baselineFixture(profile, {
      mutate_input(input) {
        input.number_bindings = input.number_bindings.filter(
          ({ role }) => role !== "result_count"
        );
      }
    })
  };
}

function profileRejectionControls(profile) {
  return Object.entries(profileRejectionFixtures(profile)).map(
    ([controlId, createFixture]) => ({
      control_id: controlId,
      category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: evaluateFixture(createFixture())
    })
  );
}

function exclusionControls(profile) {
  const baseline = baselineFixture(profile);
  const baselineSatisfaction = evaluateFixture(baseline);
  const dishonestExecution = executeResultShape({
    domain: "invoice",
    mutant: "missing-required"
  });
  const inventedIdentityFixture = baselineFixture(profile, {
    identity_overrides: {
      schema: {
        kind: "code_symbol",
        repository: "nonexistent-repository",
        path: "nonexistent/schema.mjs",
        symbol: "inventedSchema"
      }
    }
  });
  const optionalOmitted = executeResultShape({ domain: "invoice" });
  optionalOmitted.members = optionalOmitted.members.filter(
    (member) => !optionalOmitted.optional.includes(member)
  );
  optionalOmitted.reported_count = optionalOmitted.members.length;
  const demonstrations = {
    "authored-schema-truthfulness": baselineSatisfaction === "satisfied" &&
      !resultShapeGuaranteeSatisfied(dishonestExecution),
    "identity-target-existence":
      evaluateFixture(inventedIdentityFixture) === "satisfied",
    "delivered-test-implementation": baselineSatisfaction === "satisfied" &&
      baseline.input.delivered_evidence.length === 0,
    "member-value-business-semantics": baselineSatisfaction === "satisfied",
    "nested-recursive-shape-validation": baselineSatisfaction === "satisfied",
    "conditional-cross-member-invariants": baselineSatisfaction === "satisfied",
    "serialization-and-transport-media": baselineSatisfaction === "satisfied",
    "optional-member-presence":
      evaluateFixture(fixtureForExecution(profile, optionalOmitted)) === "satisfied",
    "schema-version-negotiation": baselineSatisfaction === "satisfied"
  };
  return Object.entries(demonstrations).map(([controlId, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: baselineSatisfaction
  }));
}

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: RESULT_SHAPE_CONFORMANCE_V1_PROFILE_DIGEST,
    guarantee_digest: RESULT_SHAPE_CONFORMANCE_V1_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  RESULT_SHAPE_CONFORMANCE_V1_GUARANTEE_DIGEST,
  RESULT_SHAPE_CONFORMANCE_V1_PROFILE_DIGEST,
  evaluateFixture,
  fixtureForExecution,
  profileRejectionFixtures,
  runProofPackAdequacyControls
};
