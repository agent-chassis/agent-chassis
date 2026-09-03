import { sha256 } from "../../lib/exact-binding-common.mjs";
import { buildStableTestProofPopulation, evaluateStableProofPackFixtureV1,
  validateProfileSemanticsV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { EXCLUSIONS, GUARANTEE } from "./supplementary-isolation-v1-constants.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import {
  buildSupplementaryIsolationEvaluationInput,
  buildSupplementaryIsolationProfile
} from "./supplementary-isolation-v1-profile.mjs";

const GUARANTEE_DIGEST = sha256(Buffer.from(GUARANTEE, "utf8"));

function evaluate(profile, options = {}, mutate = ({ contract, evaluation_input }) => ({
  contract, evaluation_input
})) {
  try {
    const sourceContract = JSON.parse(
      buildSupplementaryIsolationSources(options).projectionBytes
    );
    const contract = migrateControlledAcceptanceContractV02ToV1({
      contract: sourceContract,
      testProofs: buildStableTestProofPopulation(sourceContract)
    });
    const evaluation_input = buildSupplementaryIsolationEvaluationInput(contract);
    return evaluateStableProofPackFixtureV1({ profile,
      ...mutate({ contract, evaluation_input }) }).satisfaction;
  } catch { return "invalid"; }
}

function positiveControls(profile) {
  return ["present", "omitted"].map((branch) => ({
    control_id: `positive-${branch}-exact-capture`, category: "positive",
    implementation_outcome: "passed", profile_satisfaction: evaluate(profile, { branch })
  }));
}

function mutantControls(profile) {
  const cases = {
    "equal-cardinality-substituted-membership": {
      finalCoreMembers: ["ref-core-member-a", "ref-core-member-c"]
    },
    "identical-membership-false-count": { declaredCoreMemberCount: 99 },
    "dropped-core-member": { finalCoreMembers: ["ref-core-member-a"] },
    "modified-core-member": { finalCoreMembers: ["ref-core-member-a", "ref-core-member-z"] },
    "false-unavailable-with-result": {
      supplementaryResults: ["ref-supplementary-result"], declaredResultCount: 1
    },
    "failure-before-settlement": { settlementSequence: 20, failureSequence: 10 },
    "final-before-failure": { failureSequence: 30, finalSequence: 20 },
    "multiple-settlements": { settlements: 2 },
    "multiple-failures": { failures: 2 },
    "multiple-final-results": { results: 2 },
    "missing-reason-disclosure": { disclosedReasons: [] },
    "duplicate-reason-disclosure": {
      disclosedReasons: ["ref-failure-reason-selected", "ref-failure-reason-selected"]
    },
    "wrong-reason": { disclosedReasons: ["ref-failure-reason-other"] },
    "multiple-reasons": {
      disclosedReasons: ["ref-failure-reason-selected", "ref-failure-reason-other"]
    },
    "present-omitted-branch-ambiguity": { branch: "ambiguous" }
  };
  const controls = Object.entries(cases).map(([control_id, options]) => ({
    control_id, category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: evaluate(profile, options)
  }));
  controls.push({
    control_id: "wrong-component", category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: evaluate(profile, {}, ({ contract, evaluation_input }) => {
      evaluation_input.reference_bindings.find(({ role }) => role === "supplementary_component")
        .reference_ids = ["ref-core-member-a"];
      return { contract, evaluation_input };
    })
  });
  return controls;
}

function removeLeaf(expression, targetId) {
  if (expression.pattern === targetId) return null;
  for (const key of ["all_of", "any_of"]) if (Array.isArray(expression[key])) {
    expression[key] = expression[key].map((child) => removeLeaf(child, targetId)).filter(Boolean);
  }
  return expression;
}

function satisfactionPatternIds(expression, output = []) {
  if (expression.pattern) output.push(expression.pattern);
  for (const key of ["all_of", "any_of"]) for (const child of expression[key] ?? []) {
    satisfactionPatternIds(child, output);
  }
  return output;
}

function dropPatterns(profile, patternIds) {
  for (const id of patternIds) profile.satisfaction_expression = removeLeaf(
    profile.satisfaction_expression, id
  );
  for (const field of [
    "binding_constraint_patterns", "reference_binding_patterns", "claim_patterns",
    "relation_patterns", "collection_patterns", "resolver_fact_patterns", "evidence_patterns"
  ]) profile[field] = profile[field].filter(({ pattern_id: id }) => !patternIds.includes(id));
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: id }) => !patternIds.includes(id)
  );
}

function weakenCountBinding(profile, memberRole) {
  profile.reference_role_count_bindings = profile.reference_role_count_bindings.filter(
    ({ reference_role: role }) => role !== memberRole
  );
}

function loosenNumberMaximum(profile, role) {
  delete profile.number_roles.find(({ role: candidate }) => candidate === role).maximum;
}

function functionalWeakening(profile, { control_id, options = {}, weaken }) {
  const weakened = structuredClone(profile);
  weaken(weakened);
  const semantic = validateProfileSemanticsV1(weakened);
  const original = evaluate(profile, options);
  const weakenedSatisfaction = semantic.length === 0 ? evaluate(weakened, options) : "invalid";
  return {
    control_id, category: "mutant",
    implementation_outcome: original !== "satisfied" && weakenedSatisfaction === "satisfied"
      ? "killed" : "survived",
    profile_satisfaction: original
  };
}

function weakeningControls(profile) {
  const cases = [
    {
      control_id: "weakening-settlement-before-failure",
      options: { settlementSequence: 20, failureSequence: 10 },
      weaken: (candidate) => dropPatterns(candidate, ["settlement-precedes-failure"])
    },
    {
      control_id: "weakening-failure-before-final",
      options: { failureSequence: 30, finalSequence: 20 },
      weaken: (candidate) => dropPatterns(candidate, ["failure-precedes-final"])
    },
    {
      control_id: "weakening-captured-core-value-preservation",
      options: { finalCoreValue: "ref-different-final-core-value" },
      weaken: (candidate) => dropPatterns(candidate, ["final-core-state-resolves-to-value"])
    },
    {
      control_id: "weakening-closed-valid-core-value",
      options: { validCoreValues: ["ref-other-valid-core-value"] },
      weaken: (candidate) => dropPatterns(candidate, ["core-value-is-valid"])
    },
    {
      control_id: "weakening-captured-core-member-count",
      options: { declaredCoreMemberCount: 99 },
      weaken: (candidate) => weakenCountBinding(candidate, "core_members")
    },
    {
      control_id: "weakening-captured-final-core-member-count",
      options: { declaredFinalCoreMemberCount: 99 },
      weaken: (candidate) => weakenCountBinding(candidate, "final_core_members")
    },
    {
      control_id: "weakening-captured-final-result-member-count",
      options: { declaredFinalMemberCount: 99 },
      weaken: (candidate) => weakenCountBinding(candidate, "final_result_members")
    },
    {
      control_id: "weakening-observed-supplementary-result-absence",
      options: { supplementaryResults: ["ref-supplementary-result"], declaredResultCount: 1 },
      weaken: (candidate) => loosenNumberMaximum(candidate, "supplementary_result_count")
    },
    {
      control_id: "weakening-closed-failure-reason",
      options: { reasons: ["ref-failure-reason-other"] },
      weaken: (candidate) => dropPatterns(candidate, ["failure-reason-is-closed"])
    },
    {
      control_id: "weakening-exact-reason-disclosure",
      options: { disclosedReasons: ["ref-failure-reason-other"] },
      weaken: (candidate) => dropPatterns(candidate, [
        "final-discloses-exact-failure-reason", "failure-reason-is-disclosed"
      ])
    },
    {
      control_id: "weakening-functional-reason-disclosure",
      options: {
        disclosedReasons: ["ref-failure-reason-selected", "ref-failure-reason-other"]
      },
      weaken: (candidate) => {
        dropPatterns(candidate, [
          "final-discloses-exact-failure-reason", "failure-reason-is-disclosed"
        ]);
        loosenNumberMaximum(candidate, "disclosed_reason_count");
      }
    }
  ];
  return cases.map((entry) => functionalWeakening(profile, entry));
}

function profileRejectionControls(profile) {
  const spliced = structuredClone(profile);
  spliced.satisfaction_expression.all_of.find(({ any_of }) => any_of).branch_cardinality =
    "at_least_one";
  return [{
    control_id: "profile-splice-invalid-branch-cardinality",
    category: "profile_rejection", implementation_outcome: "not_applicable",
    profile_satisfaction: evaluate(spliced)
  }];
}

async function runProofPackAdequacyControls({ profile, profile_digest }) {
  const satisfied = evaluate(profile);
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest, guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile), ...mutantControls(profile),
      ...weakeningControls(profile),
      ...profileRejectionControls(profile),
      ...EXCLUSIONS.map((control_id) => ({
        control_id, category: "exclusion", implementation_outcome: "boundary_demonstrated",
        profile_satisfaction: satisfied
      }))
    ]
  };
}

export { GUARANTEE_DIGEST, runProofPackAdequacyControls, satisfactionPatternIds };
