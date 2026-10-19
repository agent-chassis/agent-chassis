import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1, profileDigest,
  validateProfileSchemaV1, validateProfileSemanticsV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import {
  LOSSLESS_PROJECTION_V1_PROFILE,
  buildLosslessProjectionFixture,
  findClaim,
  findProposition,
  ref,
  removePatternClaims
} from "./lossless-projection-v1-fixture.mjs";
import {
  executeProjection,
  projectionGuaranteeSatisfied
} from "./lossless-projection-v1-harness.mjs";

const LOSSLESS_PROJECTION_V1_PROFILE_DIGEST =
  profileDigest(LOSSLESS_PROJECTION_V1_PROFILE);
const LOSSLESS_PROJECTION_V1_GUARANTEE_DIGEST =
  "e999fd999699e6b4f0ce98b59622c11ee30a74f0f6ce150c18a7bb0a9c887a80";

const memberReferenceId = ({ key }) =>
  `ref-member-${key.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;
const reasonReferenceId = (reason) => `ref-reason-${reason}`;

function evaluateFixtureResult({ contract, input, profile }) {
  return evaluateStableProofPackFixtureV1({
    contract,
    profile,
    evaluation_input: input
  });
}

function evaluateFixture(fixture) {
  return evaluateFixtureResult(fixture).satisfaction;
}

function evaluatorNegative(controlId, fixture, expected, killed = true) {
  const result = evaluateFixtureResult(fixture);
  const actualReason = expected.pattern
    ? `pattern:${expected.pattern}:${result.pattern_results?.find(
      ({ pattern_id: id }) => id === expected.pattern)?.status ?? "missing"}`
    : result.diagnostics.find(({ code }) => code !== "for_each_evaluation")?.code ?? null;
  return {
    control_id: controlId,
    category: "mutant",
    implementation_outcome: killed ? "killed" : "survived",
    profile_satisfaction: result.satisfaction,
    rejection: {
      checker: "proof_evaluator", subject: "evaluation_input",
      expected_reason: expected.pattern
        ? `pattern:${expected.pattern}:unsatisfied` : expected.code,
      actual_reason: actualReason
    }
  };
}

function fixtureForExecution(profile, execution, options = {}) {
  const sourceIds = execution.source.map(memberReferenceId);
  const compactIds = execution.compact.map(memberReferenceId);
  const omittedIds = execution.omitted.map(memberReferenceId);
  const completeIds = execution.complete.map(memberReferenceId);
  const disclosedIds = execution.disclosed.map(memberReferenceId);
  const accountedIds = execution.accounted.map(memberReferenceId);
  const allowedReasonIds = execution.allowed_reasons.map(reasonReferenceId);
  const propositionOverrides = {};
  const dropPatternIds = [];

  if (execution.omitted.length === 0) propositionOverrides["projection-actually-omits"] = {
    operator: "reference:subset_of"
  };
  if (new Set(completeIds).size !== new Set(sourceIds).size ||
      completeIds.some((id) => !sourceIds.includes(id))) {
    propositionOverrides["complete-result-lossless"] = {
      operator: "reference:not_equals"
    };
  }
  if (new Set(accountedIds).size !== new Set(sourceIds).size ||
      accountedIds.some((id) => !sourceIds.includes(id))) {
    propositionOverrides["projection-accounting-complete"] = {
      operator: "reference:not_equals"
    };
  }
  if (new Set(disclosedIds).size !== new Set(omittedIds).size ||
      disclosedIds.some((id) => !omittedIds.includes(id))) {
    propositionOverrides["disclosure-population-complete"] = {
      operator: "reference:not_equals"
    };
  }
  propositionOverrides["total-count-complete"] = {
    operands: [{ kind: "number", value: execution.reported_total }]
  };
  propositionOverrides["omission-count-complete"] = {
    operands: [{ kind: "number", value: execution.reported_omissions }]
  };
  if (!execution.recovery_path_operable) {
    dropPatternIds.push("compact-result-names-complete-path");
  }
  if (!execution.allowed_reasons.includes(execution.omission_reason)) {
    propositionOverrides["reason-selected-from-closed-catalog"] = {
      operator: "reference:not_member_of"
    };
  }

  return buildLosslessProjectionFixture({
    profile,
    domain: execution.domain,
    role_id_overrides: {
      source_members: sourceIds,
      compact_members: compactIds,
      omitted_members: omittedIds,
      complete_result_members: completeIds,
      disclosed_members: disclosedIds,
      accounted_members: accountedIds,
      allowed_reasons: allowedReasonIds,
      omission_reason: [reasonReferenceId(execution.omission_reason)]
    },
    number_value_overrides: {
      source_count: sourceIds.length,
      omission_count: omittedIds.length
    },
    drop_pattern_ids: dropPatternIds,
    proposition_overrides: propositionOverrides,
    ...options
  });
}

function baselineFixture(profile, options = {}) {
  return fixtureForExecution(profile, executeProjection({ domain: "record" }), options);
}

function positiveControls(profile) {
  const cases = [
    ["record-object-projection", "record", "test_execution"],
    ["graph-map-projection", "graph", "analysis"],
    ["artifact-array-projection", "artifact", "proof"],
    ["all-heavy-empty-compact-projection", "archive", "demonstration"]
  ];
  return cases.map(([controlId, domain, verificationMethod]) => {
    const execution = executeProjection({ domain });
    return {
      control_id: controlId,
      category: "positive",
      implementation_outcome: projectionGuaranteeSatisfied(execution)
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
    ["complete-path-drops-member", "drop-from-complete", { code: "direct_proposition_contradiction" }],
    ["compact-loss-unaccounted", "silent-compact-loss", { code: "reference_role_count_binding_mismatch" }],
    ["compact-loss-falsely-accounted", "false-accounting", { pattern: "source-accounted-by-compact-and-omissions" }],
    ["omission-undisclosed", "drop-disclosure", { code: "reference_role_cardinality_invalid" }],
    ["complete-total-undercounted", "undercount-total", { pattern: "total-count-complete" }],
    ["omission-total-undercounted", "undercount-omissions", { pattern: "omission-count-complete" }],
    ["recovery-route-broken", "break-recovery-route", { pattern: "compact-result-names-complete-path" }],
    ["reason-outside-closed-catalog", "reason-outside-catalog", { pattern: "reason-selected-from-closed-catalog" }],
    ["compact-omits-no-heavy-member", "omit-no-heavy-member", { code: "reference_role_cardinality_invalid" }]
  ];
  return cases.map(([controlId, mutant, expected]) => {
    const execution = executeProjection({ domain: "record", mutant });
    return evaluatorNegative(controlId, fixtureForExecution(profile, execution),
      expected, !projectionGuaranteeSatisfied(execution));
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
    operands: [ref(fixture.roleIds.tool[0])]
  }, {
    proposition_id: `prop-falsifier-${kind}`,
    subject_reference_id: kind === "status-only-verification"
      ? fixture.roleIds.compact_result[0]
      : fixture.roleIds.tool[0],
    operator: kind === "status-only-verification"
      ? "reference:has_status"
      : "boolean:exists",
    applicability_context: {
      mode: "when",
      operand_reference_ids: [fixture.roleIds.unrecoverable_loss_condition[0]]
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
      const claim = findClaim(contract, "tool-declares-modes");
      const proposition = findProposition(contract, "tool-declares-modes");
      contract.propositions.push({
        ...structuredClone(proposition),
        proposition_id: "prop-tool-declares-modes-duplicate"
      });
      contract.claims.push({
        ...structuredClone(claim),
        claim_id: "claim-tool-declares-modes-duplicate",
        proposition_id: "prop-tool-declares-modes-duplicate"
      });
    }
  });
}

function profileRejectionFixtures(profile) {
  return {
    "status-only-verification": () => smokeFixture(profile, "status-only-verification"),
    "suite-covers-symbol-negation-only": () =>
      smokeFixture(profile, "suite-covers-symbol-negation-only"),
    "missing-compact-result-stimulus": () => baselineFixture(profile, {
      drop_pattern_ids: ["compact-mode-returns-result"]
    }),
    "missing-complete-result-stimulus": () => baselineFixture(profile, {
      drop_pattern_ids: ["complete-mode-returns-result"]
    }),
    "missing-projection-accounting-comparison": () => baselineFixture(profile, {
      drop_pattern_ids: ["projection-accounting-complete"]
    }),
    "missing-projection-accounting-spine": () => baselineFixture(profile, {
      drop_pattern_ids: [
        "verification-reads-projection-partition",
        "verification-builds-accounted-population"
      ]
    }),
    "missing-disclosure-signal": () => baselineFixture(profile, {
      drop_pattern_ids: ["compact-result-emits-disclosure"]
    }),
    "wrong-recovery-falsifier": () => baselineFixture(profile, {
      mutate_contract(contract) {
        findProposition(contract, "lossless-recovery-verification", {
          falsifier: true
        }).operator = "reference:equals";
      }
    }),
    "ambiguous-duplicate-proof-claim": () => duplicateClaimFixture(profile),
    "missing-required-role-binding": () => baselineFixture(profile, {
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(
          ({ role }) => role !== "complete_mode"
        );
      }
    }),
    "mistyped-complete-mode": () => baselineFixture(profile, {
      role_type_overrides: { complete_mode: "cc:artifact" }
    }),
    "ungrounded-tool-profile-term": () => baselineFixture(profile, {
      identity_overrides: {
        tool: { kind: "profile_term", term: "invented-tool" }
      }
    }),
    "collapsed-compact-complete-modes": () => baselineFixture(profile, {
      mutate_input(input) {
        const compact = input.reference_bindings.find(({ role }) => role === "compact_mode");
        const complete = input.reference_bindings.find(({ role }) => role === "complete_mode");
        complete.reference_ids = [...compact.reference_ids];
      }
    }),
    "unbound-source-count": () => baselineFixture(profile, {
      mutate_input(input) {
        input.number_bindings = input.number_bindings.filter(
          ({ role }) => role !== "source_count"
        );
      }
    })
  };
}

const INPUT_REJECTIONS = {
  "status-only-verification": { pattern: "lossless-recovery-verification" },
  "suite-covers-symbol-negation-only": { pattern: "lossless-recovery-verification" },
  "missing-compact-result-stimulus": { pattern: "compact-mode-returns-result" },
  "missing-complete-result-stimulus": { pattern: "complete-mode-returns-result" },
  "missing-projection-accounting-comparison": { code: "mandatory_verification_unattached" },
  "missing-projection-accounting-spine": { pattern: "verification-builds-accounted-population" },
  "missing-disclosure-signal": { pattern: "compact-result-emits-disclosure" },
  "wrong-recovery-falsifier": { pattern: "lossless-recovery-verification" },
  "mistyped-complete-mode": { code: "reference_role_binding_type_mismatch" },
  "ungrounded-tool-profile-term": { code: "reference_role_binding_identity_kind_mismatch" },
  "collapsed-compact-complete-modes": { code: "distinct_reference_roles_collapsed" }
};

const INDETERMINATE_INPUTS = {
  "ambiguous-duplicate-proof-claim": "claim_pattern_match_ambiguous",
  "missing-required-role-binding": "required_reference_role_unbound",
  "unbound-source-count": "required_number_role_unbound"
};

function inputRejectionControls(profile) {
  const fixtures = profileRejectionFixtures(profile);
  return Object.entries(INPUT_REJECTIONS).map(([id, expected]) =>
    evaluatorNegative(id, fixtures[id](), expected));
}

function requiredApplicabilityChecks(profile) {
  const fixtures = profileRejectionFixtures(profile);
  return Object.entries(INDETERMINATE_INPUTS).every(([id, expectedCode]) => {
    const result = evaluateFixtureResult(fixtures[id]());
    return result.satisfaction === "indeterminate" && result.diagnostics.some(
      ({ code }) => code === expectedCode);
  });
}

function profileRejectionControls(profile) {
  const cases = [
    ["undefined-accounting-member-role", candidate => {
      candidate.reference_binding_patterns.at(-1).roles[1] = "undefined_member";
    }, "profile_pattern_role_undefined"],
    ["nonpopulation-accounting-subject", candidate => {
      candidate.reference_binding_patterns.at(-1).roles[0] = "tool";
    }, "profile_population_binding_role_type_invalid"],
    ["nonbinary-identity-comparison", candidate => {
      const binding = candidate.reference_binding_patterns.at(-1);
      binding.comparison = "same_reference";
      delete binding.applicability_context;
    }, "profile_schema_invalid"]
  ];
  return cases.map(([id, mutate, expectedReason]) => {
    const candidate = structuredClone(profile);
    mutate(candidate);
    const schemaValid = validateProfileSchemaV1(candidate);
    const diagnostics = schemaValid ? validateProfileSemanticsV1(candidate) : [];
    const reason = schemaValid ? diagnostics[0]?.code ?? null : "profile_schema_invalid";
    return {
      control_id: id, category: "profile_rejection",
      implementation_outcome: "not_applicable",
      profile_satisfaction: schemaValid && diagnostics.length === 0 ? "satisfied" : "invalid",
      rejection: {
        checker: "profile_conformance", subject: "profile",
        expected_reason: expectedReason, actual_reason: reason
      }
    };
  });
}

function exclusionControls(profile) {
  const baseline = baselineFixture(profile);
  const baselineSatisfaction = evaluateFixture(baseline);
  const dishonestExecution = executeProjection({
    domain: "record",
    mutant: "drop-from-complete"
  });
  const inventedIdentityFixture = baselineFixture(profile, {
    identity_overrides: {
      tool: {
        kind: "code_symbol",
        repository: "nonexistent-repository",
        path: "nonexistent/tool.mjs",
        symbol: "inventedTool"
      }
    }
  });
  const extraModeFixture = baselineFixture(profile, {
    mutate_contract(contract) {
      contract.references.push({
        reference_id: "ref-undisclosed-third-mode",
        type_term: "cc:operation",
        identity: {
          kind: "code_symbol",
          repository: "fixture-record",
          path: "fixtures/record.mjs",
          symbol: "thirdMode"
        }
      });
      contract.propositions.push({
        proposition_id: "prop-tool-includes-third-mode",
        subject_reference_id: "ref-tool",
        operator: "reference:includes",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [ref("ref-undisclosed-third-mode")]
      });
      contract.claims.push({
        claim_id: "claim-tool-includes-third-mode",
        kind: "evidence",
        modality: "MUST",
        proposition_id: "prop-tool-includes-third-mode"
      });
    }
  });
  const demonstrations = {
    "authored-population-truthfulness": baselineSatisfaction === "satisfied" &&
      !projectionGuaranteeSatisfied(dishonestExecution),
    "identity-provenance-truthfulness":
      evaluateFixture(inventedIdentityFixture) === "satisfied",
    "delivered-test-implementation": baselineSatisfaction === "satisfied" &&
      baseline.input.delivered_evidence.length === 0,
    "redaction-and-security-exemptions": baselineSatisfaction === "satisfied" &&
      profile.claim_patterns.every(({ pattern_id: patternId }) =>
        !patternId.includes("redaction") && !patternId.includes("exemption")),
    "pagination-range-and-cursor-semantics": baselineSatisfaction === "satisfied" &&
      profile.reference_roles.every(({ role }) =>
        !role.includes("cursor") && !role.includes("range") && !role.includes("page")),
    "member-byte-value-equality": baselineSatisfaction === "satisfied",
    "modes-outside-bound-pair": evaluateFixture(extraModeFixture) === "satisfied",
    "code-routing-and-call-graph": baselineSatisfaction === "satisfied" &&
      profile.claim_patterns.every(
        ({ proposition_template: template }) => template.operator !== "reference:calls"
      ),
    "cross-storage-envelope-parity": baselineSatisfaction === "satisfied"
  };
  return Object.entries(demonstrations).map(([controlId, demonstrated]) => ({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: demonstrated ? "boundary_demonstrated" : "not_applicable",
    profile_satisfaction: baselineSatisfaction
  }));
}

async function runProofPackAdequacyControls({ profile , negative_fixtures: negativeFixtures }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: LOSSLESS_PROJECTION_V1_PROFILE_DIGEST,
    guarantee_digest: LOSSLESS_PROJECTION_V1_GUARANTEE_DIGEST,
    passed: evaluateFixture(baselineFixture(profile)) === "satisfied" &&
      validateProfileSchemaV1(profile) && validateProfileSemanticsV1(profile).length === 0 &&
      requiredApplicabilityChecks(profile),
    controls: [...await isolatedMandatoryVerificationControls(profile, negativeFixtures),
      ...positiveControls(profile),
      ...mutantControls(profile),
      ...inputRejectionControls(profile),
      ...profileRejectionControls(profile),
      ...exclusionControls(profile)
    ]
  };
}

export {
  LOSSLESS_PROJECTION_V1_GUARANTEE_DIGEST,
  LOSSLESS_PROJECTION_V1_PROFILE_DIGEST,
  evaluateFixture,
  fixtureForExecution,
  profileRejectionFixtures,
  runProofPackAdequacyControls
};

import { assessMandatoryVerificationControlV1 }
  from "../support/stable-v1-proof-pack-runtime.mjs";

async function isolatedMandatoryVerificationControls(profile, negativeFixtures) {
  const cases = [
    {
      "fixture_id": "isolated-claim-projection-omission-verification-modalities",
      "claim_id": "claim-projection-omission-verification",
      "baseline": "isolated-claim-projection-omission-verification-modalities-baseline",
      "optional": "isolated-claim-projection-omission-verification-modalities-optional"
    },
    {
      "fixture_id": "isolated-claim-lossless-recovery-verification-modalities",
      "claim_id": "claim-lossless-recovery-verification",
      "baseline": "isolated-claim-lossless-recovery-verification-modalities-baseline",
      "optional": "isolated-claim-lossless-recovery-verification-modalities-optional"
    },
    {
      "fixture_id": "isolated-claim-disclosure-completeness-verification-modalities",
      "claim_id": "claim-disclosure-completeness-verification",
      "baseline": "isolated-claim-disclosure-completeness-verification-modalities-baseline",
      "optional": "isolated-claim-disclosure-completeness-verification-modalities-optional"
    },
    {
      "fixture_id": "isolated-claim-projection-accounting-verification-modalities",
      "claim_id": "claim-projection-accounting-verification",
      "baseline": "isolated-claim-projection-accounting-verification-modalities-baseline",
      "optional": "isolated-claim-projection-accounting-verification-modalities-optional"
    },
    {
      "fixture_id": "isolated-claim-total-count-verification-modalities",
      "claim_id": "claim-total-count-verification",
      "baseline": "isolated-claim-total-count-verification-modalities-baseline",
      "optional": "isolated-claim-total-count-verification-modalities-optional"
    },
    {
      "fixture_id": "isolated-claim-omission-count-verification-modalities",
      "claim_id": "claim-omission-count-verification",
      "baseline": "isolated-claim-omission-count-verification-modalities-baseline",
      "optional": "isolated-claim-omission-count-verification-modalities-optional"
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
    const optionalFixture = { profile, contract: fixture.contract, input: fixture.evaluation_input };
    controls.push({ control_id: row.baseline, category: "positive",
      implementation_outcome: "passed", profile_satisfaction: result.baseline.satisfaction },
    evaluatorNegative(row.optional, optionalFixture, { pattern: row.claim_id.slice("claim-".length) }));
  }
  return controls;
}
