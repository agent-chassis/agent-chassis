import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { evaluateVerificationProfileV034 } from "../../lib/verification-profile-v034.mjs";
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
  "14a13d53f4582e2b063a1a23e5b17458d2ae9561f553c6129630b4f52cf77204";
const LOSSLESS_PROJECTION_V1_GUARANTEE_DIGEST =
  "e999fd999699e6b4f0ce98b59622c11ee30a74f0f6ce150c18a7bb0a9c887a80";

const memberReferenceId = ({ key }) =>
  `ref-member-${key.replaceAll(/[^a-zA-Z0-9-]/gu, "-")}`;
const reasonReferenceId = (reason) => `ref-reason-${reason}`;

function evaluateFixture({ contract, input, profile }) {
  return evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  }).satisfaction;
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
    ["complete-path-drops-member", "drop-from-complete"],
    ["compact-loss-unaccounted", "silent-compact-loss"],
    ["omission-undisclosed", "drop-disclosure"],
    ["complete-total-undercounted", "undercount-total"],
    ["omission-total-undercounted", "undercount-omissions"],
    ["recovery-route-broken", "break-recovery-route"],
    ["reason-outside-closed-catalog", "reason-outside-catalog"],
    ["compact-omits-no-heavy-member", "omit-no-heavy-member"]
  ];
  return cases.map(([controlId, mutant]) => {
    const execution = executeProjection({ domain: "record", mutant });
    return {
      control_id: controlId,
      category: "mutant",
      implementation_outcome: projectionGuaranteeSatisfied(execution)
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

async function runProofPackAdequacyControls({ profile }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: LOSSLESS_PROJECTION_V1_PROFILE_DIGEST,
    guarantee_digest: LOSSLESS_PROJECTION_V1_GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile),
      ...mutantControls(profile),
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
