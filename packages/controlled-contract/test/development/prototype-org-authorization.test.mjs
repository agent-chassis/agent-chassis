import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_ID,
  SCHEMA_VERSION,
  VOCABULARY_VERSION
} from "../../lib/native-contract-carrier.mjs";
import { evaluatePrototypeAuthorization } from "./prototype-org-authorization.mjs";

const behaviorSpecs = [
  { id: "exact-owner-success", modality: "MUST" },
  { id: "absent-capability-refused", modality: "MUST_NOT" },
  { id: "wrong-capability-nonconsuming", modality: "MUST_NOT" }
];

function authoredObligation(spec) {
  return {
    obligation_id: spec.id,
    required_by_stage: "pre_dispatch",
    satisfaction_mode: "authored_claim",
    claim_kind: "behavior",
    allowed_modalities: [spec.modality],
    proposition_template: {
      subject_role: "capability",
      operator: "reference:has_property",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "reference", role: spec.id.replaceAll("-", "_") }]
    }
  };
}

const policy = {
  policy_id: "example.single-use-capability",
  policy_version: "1.0.0",
  reference_roles: [
    { role: "capability", allowed_type_terms: ["cc:capability"] },
    ...behaviorSpecs.map((spec) => ({
      role: spec.id.replaceAll("-", "_"),
      allowed_type_terms: ["cc:state"]
    }))
  ],
  obligations: behaviorSpecs.map(authoredObligation),
  require_all_mandatory_behaviors_verified: true,
  require_zero_graph_diagnostics: true,
  operative_residue_effect: "review_required"
};

function contractFor(specs) {
  const references = [
    {
      reference_id: "ref-capability",
      type_term: "cc:capability",
      identity: { kind: "profile_term", term: "example:capability" }
    },
    {
      reference_id: "ref-suite",
      type_term: "cc:test",
      identity: {
        kind: "repository_path",
        repository: "example-repository",
        path: "tests/capability.test.mjs"
      }
    },
    ...behaviorSpecs.map((spec) => ({
      reference_id: `ref-${spec.id}`,
      type_term: "cc:state",
      identity: { kind: "profile_term", term: `example:${spec.id}` }
    }))
  ];
  const propositions = [];
  const claims = [];
  const relations = [];

  for (const [index, spec] of specs.entries()) {
    propositions.push(
      {
        proposition_id: `prop-${spec.id}`,
        subject_reference_id: "ref-capability",
        operator: "reference:has_property",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: `ref-${spec.id}` }]
      },
      {
        proposition_id: `prop-verify-${spec.id}`,
        subject_reference_id: "ref-suite",
        operator: "reference:covers",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: `ref-${spec.id}` }]
      },
      {
        proposition_id: `prop-falsify-${spec.id}`,
        subject_reference_id: "ref-capability",
        operator: "reference:not_member_of",
        applicability_context: { mode: "counterfactual", operand_reference_ids: [`ref-${spec.id}`] },
        operands: [{ kind: "reference", reference_id: `ref-${spec.id}` }]
      }
    );
    claims.push(
      {
        claim_id: `claim-${spec.id}`,
        kind: "behavior",
        modality: spec.modality,
        proposition_id: `prop-${spec.id}`
      },
      {
        claim_id: `claim-verify-${spec.id}`,
        kind: "verification",
        modality: "MUST",
        proposition_id: `prop-verify-${spec.id}`,
        verification_method: "test_execution",
        falsifying_proposition_id: `prop-falsify-${spec.id}`
      }
    );
    relations.push({
      relation_id: `rel-verifies-${index + 1}`,
      role: "verifies",
      source_claim_id: `claim-verify-${spec.id}`,
      target_claim_id: `claim-${spec.id}`
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: PROFILE_ID,
    references,
    propositions,
    claims,
    relations,
    collections: [],
    residue: [],
    annotations: []
  };
}

const bindingsFor = (specs) => specs.map((spec) => ({
  obligation_id: spec.id,
  claim_id: `claim-${spec.id}`
}));

const referenceBindings = [
  { role: "capability", reference_id: "ref-capability" },
  ...behaviorSpecs.map((spec) => ({
    role: spec.id.replaceAll("-", "_"),
    reference_id: `ref-${spec.id}`
  }))
];

function evaluate({
  contract = contractFor(behaviorSpecs),
  selectedPolicy = policy,
  stage = "pre_dispatch",
  bindings = bindingsFor(behaviorSpecs),
  references = referenceBindings,
  facts = [],
  evidence = []
} = {}) {
  return evaluatePrototypeAuthorization({
    contract,
    policy: selectedPolicy,
    evaluation_stage: stage,
    obligation_bindings: bindings,
    reference_bindings: references,
    resolver_facts: facts,
    delivered_evidence: evidence
  });
}

test("prototype policy authorizes a semantically matching pre-dispatch contract", () => {
  const result = evaluate();
  assert.equal(result.decision, "allow");
  assert.equal(result.evaluation_stage, "pre_dispatch");
  assert.equal(result.authority.authoritative, false);
  assert.equal(result.facts.required_authored_claims_satisfied, true);
  assert.equal(result.facts.required_obligations_satisfied, true);
  assert.equal("required_population_complete" in result.facts, false);
  assert.deepEqual(result.diagnostics, []);
});

test("policy catches an obligation omitted from an otherwise covered authored graph", () => {
  const authoredSpecs = behaviorSpecs.slice(0, 2);
  const result = evaluate({
    contract: contractFor(authoredSpecs),
    bindings: bindingsFor(authoredSpecs)
  });
  assert.equal(result.decision, "refuse");
  assert.equal(result.facts.required_authored_claims_satisfied, false);
  assert.deepEqual(result.facts.unsatisfied_obligation_ids, [
    "wrong-capability-nonconsuming"
  ]);
});

test("same-kind and same-modality bindings cannot satisfy a different proposition", () => {
  const bindings = bindingsFor(behaviorSpecs);
  bindings.find(({ obligation_id }) =>
    obligation_id === "wrong-capability-nonconsuming"
  ).claim_id = "claim-absent-capability-refused";
  const result = evaluate({ bindings });
  assert.equal(result.decision, "refuse");
  assert.equal(result.facts.required_authored_claims_satisfied, false);
  assert.equal(
    result.diagnostics.some(({ code }) => code === "obligation_proposition_mismatch"),
    true
  );
});

test("policy can require graph coverage independently of semantic bindings", () => {
  const contract = contractFor(behaviorSpecs);
  contract.relations = contract.relations.filter(
    ({ target_claim_id }) => target_claim_id !== "claim-exact-owner-success"
  );
  const result = evaluate({ contract });
  assert.equal(result.facts.required_authored_claims_satisfied, true);
  assert.equal(result.decision, "refuse");
  assert.equal(
    result.diagnostics.some(({ code }) => code === "policy_requires_verified_behavior"),
    true
  );
});

test("resolver facts and delivery evidence activate at their declared stages", () => {
  const stagedPolicy = structuredClone(policy);
  stagedPolicy.obligations.push(
    {
      obligation_id: "ownership-graph-acyclic",
      required_by_stage: "pre_dispatch",
      satisfaction_mode: "authoritative_resolver_fact",
      fact_key: "ownership-graph-acyclic"
    },
    {
      obligation_id: "falsifier-executed",
      required_by_stage: "post_delivery",
      satisfaction_mode: "delivered_evidence",
      evidence_key: "falsifier-executed"
    }
  );

  const preDispatch = evaluate({
    selectedPolicy: stagedPolicy,
    facts: [{ fact_key: "ownership-graph-acyclic", satisfied: true }]
  });
  assert.equal(preDispatch.decision, "allow");
  assert.equal(preDispatch.facts.required_obligation_ids.includes("falsifier-executed"), false);

  const missingEvidence = evaluate({
    selectedPolicy: stagedPolicy,
    stage: "post_delivery",
    facts: [{ fact_key: "ownership-graph-acyclic", satisfied: true }]
  });
  assert.equal(missingEvidence.decision, "refuse");
  assert.equal(
    missingEvidence.diagnostics.some(
      ({ code }) => code === "required_delivered_evidence_unsatisfied"
    ),
    true
  );

  const delivered = evaluate({
    selectedPolicy: stagedPolicy,
    stage: "post_delivery",
    facts: [{ fact_key: "ownership-graph-acyclic", satisfied: true }],
    evidence: [{ evidence_key: "falsifier-executed", satisfied: true }]
  });
  assert.equal(delivered.decision, "allow");
});

test("pre-dispatch does not require roles used only by post-delivery claims", () => {
  const stagedPolicy = structuredClone(policy);
  stagedPolicy.reference_roles.push({
    role: "delivered_artifact",
    allowed_type_terms: ["cc:artifact"]
  });
  stagedPolicy.obligations.push({
    obligation_id: "delivered-artifact-preserved",
    required_by_stage: "post_delivery",
    satisfaction_mode: "authored_claim",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "delivered_artifact",
      operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "boolean", value: true }]
    }
  });

  const result = evaluate({ selectedPolicy: stagedPolicy });
  assert.equal(result.decision, "allow");
  assert.equal(
    result.diagnostics.some(({ code }) => code === "missing_policy_reference_binding"),
    false
  );
});

test("operative residue remains a policy-controlled review result", () => {
  const contract = contractFor(behaviorSpecs);
  contract.residue.push({
    residue_id: "res-unknown-property",
    reason: "unsupported_concept",
    text: "An organization-specific property remains unstructured."
  });
  const result = evaluate({ contract });
  assert.equal(result.decision, "review_required");
  assert.equal(result.facts.operative_residue_count, 1);
});

test("invalid stage, policy, or contract inputs are indeterminate, never allowed", () => {
  assert.equal(evaluate({ stage: "during_delivery" }).decision, "indeterminate");

  const invalidPolicy = { ...policy, policy_version: "latest" };
  assert.equal(evaluate({ selectedPolicy: invalidPolicy }).decision, "indeterminate");

  const invalidContract = contractFor(behaviorSpecs);
  invalidContract.claims = [];
  const invalidContractResult = evaluate({ contract: invalidContract });
  assert.equal(invalidContractResult.decision, "indeterminate");
  assert.equal(invalidContractResult.evaluation_stage, "pre_dispatch");
});
