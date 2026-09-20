

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_PROOF_GRAPH_PREPARATION_SCHEMA,
  composeControlledContractProofGraphPreparation,
  validateControlledContractProofGraphPreparation
} from
  "../../packages/wiki-core/src/operations/controlled-contract/proof-graph-operations.mjs";
import {
  CONTROLLED_CONTRACT_PROOF_PLAN_PREPARATION_SCHEMA,
  validateControlledContractProofPlanPreparation
} from
  "../../packages/wiki-core/src/operations/controlled-contract/proof-pack-operations.mjs";
import {
  CONTROLLED_CONTRACT_VERIFICATION_BUNDLE_PREPARATION_SCHEMA,
  validateControlledContractVerificationBundlePreparation
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  CONTROLLED_CONTRACT_AUTHORING_PROSPECTIVE_SCHEMA,
  compileControlledContractAuthoringProspectiveMembers,
  validateControlledContractAuthoringProspectiveMembers
} from
  "../../packages/wiki-core/src/operations/controlled-contract/authoring-prospective-settlement.mjs";
import { controlledContractContentDigest } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

const WK = "WK-9999";
const CONTRACT = `${WK}.controlled-acceptance.json`;
const REQUEST = `${WK}.proof-plan-request.json`;
const PLAN = `${WK}.proof-plan.json`;
const EVALUATION = `${WK}.evaluation-input.json`;

function leaseSource(members, { generation = "generation-one" } = {}) {
  return {
    canonical_members: structuredClone(members),
    canonical_set: { generation },
    manifest_content_digest: `sha256:${"9".repeat(64)}`,
    record_source_digest: `sha256:${"5".repeat(64)}`,
    record: { repo: "agent-chassis/agent-chassis" },
    target_by_kind: { contract: CONTRACT, evaluation_input: EVALUATION,
      proof_plan_request: REQUEST }
  };
}

const BASE_MEMBERS = {
  [CONTRACT]: { schema_version: "contract.v1", claims: [] },
  [REQUEST]: { schema_version: "request.v1", selected_packs: [] },
  [PLAN]: { schema_version: "plan.v1", rows: [] }
};

test("proof-graph preparation composes a member set and writes nothing", () => {
  const source = leaseSource(BASE_MEMBERS);
  const frozenBefore = JSON.stringify(source.canonical_members);
  const prepared = composeControlledContractProofGraphPreparation({
    input: { wkId: WK, focus: null },
    source,
    composed: { carriers: [{ carrier_kind: "contract", changed: true,
      content: { schema_version: "contract.v1", claims: ["claim-one"] } }] }
  });
  assert.equal(prepared.schema_version,
    CONTROLLED_CONTRACT_PROOF_GRAPH_PREPARATION_SCHEMA);
  assert.equal(prepared.owner, "composeProofGraphCarrierSet");
  assert.deepEqual(prepared.changed_carrier_kinds, ["contract"]);

  assert.equal(Object.hasOwn(prepared.canonical_members, PLAN), false);
  assert.equal(prepared.member_digests[CONTRACT],
    controlledContractContentDigest(prepared.canonical_members[CONTRACT]));

  assert.equal(JSON.stringify(source.canonical_members), frozenBefore);
});

test("proof-graph preparation keeps the plan when no authoring carrier changed", () => {
  const prepared = composeControlledContractProofGraphPreparation({
    input: { wkId: WK, focus: null },
    source: leaseSource(BASE_MEMBERS),
    composed: { carriers: [{ carrier_kind: "contract", changed: false,
      content: BASE_MEMBERS[CONTRACT] }] }
  });
  assert.equal(Object.hasOwn(prepared.canonical_members, PLAN), true);
  assert.deepEqual(prepared.changed_carrier_kinds, []);
});

test("proof-graph prospective validation rejects a mismatched member digest", () => {
  const prepared = composeControlledContractProofGraphPreparation({
    input: { wkId: WK, focus: null },
    source: leaseSource(BASE_MEMBERS),
    composed: { carriers: [{ carrier_kind: "contract", changed: false,
      content: BASE_MEMBERS[CONTRACT] }] }
  });
  assert.equal(validateControlledContractProofGraphPreparation(prepared), prepared);
  const tampered = { ...prepared,
    member_digests: { ...prepared.member_digests, [CONTRACT]: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => validateControlledContractProofGraphPreparation(tampered),
    (error) => error.code === "controlled_contract_proof_graph_preparation_invalid" &&
      error.details.changed === false);
});

test("proof-graph prospective validation rejects an incomplete preparation", () => {
  for (const value of [null, {}, { schema_version: "wrong" }]) {
    assert.throws(() => validateControlledContractProofGraphPreparation(value),
      (error) => error.code === "controlled_contract_proof_graph_preparation_invalid");
  }
});

test("proof-plan prospective validation accepts and rejects on its own contract", () => {
  const prepared = {
    schema_version: CONTROLLED_CONTRACT_PROOF_PLAN_PREPARATION_SCHEMA,
    carrier_kind: "proof_plan", content: { schema_version: "plan.v1" }
  };
  assert.equal(validateControlledContractProofPlanPreparation(prepared), prepared);
  for (const value of [null, { ...prepared, content: [] },
    { ...prepared, carrier_kind: "contract" }, { ...prepared, schema_version: "x" }]) {
    assert.throws(() => validateControlledContractProofPlanPreparation(value),
      (error) => error.code === "controlled_contract_proof_plan_preparation_invalid" &&
        error.details.changed === false);
  }
});

test("verification-bundle prospective validation guards its own contract", () => {
  const prepared = {
    schema_version: CONTROLLED_CONTRACT_VERIFICATION_BUNDLE_PREPARATION_SCHEMA,
    carrier_kind: "contract", content: { schema_version: "contract.v1" },
    changed_verification_ids: []
  };
  assert.equal(validateControlledContractVerificationBundlePreparation(prepared),
    prepared);
  for (const value of [null, { ...prepared, content: null },
    { ...prepared, changed_verification_ids: "no" },
    { ...prepared, carrier_kind: "proof_plan" }]) {
    assert.throws(() => validateControlledContractVerificationBundlePreparation(value),
      (error) =>
        error.code === "controlled_contract_verification_bundle_preparation_invalid");
  }
});

test("authoring prospective compilation composes owner contributions only", () => {
  const source = leaseSource(BASE_MEMBERS);
  const before = JSON.stringify(source.canonical_members);
  const prospective = compileControlledContractAuthoringProspectiveMembers({
    wkId: WK, focus: null, source,
    contributions: [{ owner: "authoring_continuation", carrier_kind: "evaluation_input",
      filename: EVALUATION, content: { schema_version: "evaluation.v1" } }]
  });
  assert.equal(prospective.schema_version,
    CONTROLLED_CONTRACT_AUTHORING_PROSPECTIVE_SCHEMA);
  assert.deepEqual(prospective.changed_filenames, [EVALUATION]);
  assert.equal(prospective.invalidated_proof_plan, true);
  assert.equal(Object.hasOwn(prospective.canonical_members, PLAN), false);

  assert.deepEqual(prospective.contributions, [{ owner: "authoring_continuation",
    carrier_kind: "evaluation_input", filename: EVALUATION,
    content_digest: controlledContractContentDigest({ schema_version: "evaluation.v1" }) }]);
  assert.equal(JSON.stringify(source.canonical_members), before,
    "compilation performs no write and mutates no input");
});

test("a contributed proof plan is the fresh derivation, not an invalidation", () => {
  const prospective = compileControlledContractAuthoringProspectiveMembers({
    wkId: WK, focus: null, source: leaseSource(BASE_MEMBERS),
    contributions: [{ owner: "proof_plan", carrier_kind: "proof_plan",
      filename: PLAN, content: { schema_version: "plan.v1", rows: ["row"] } }]
  });
  assert.equal(prospective.invalidated_proof_plan, false);
  assert.deepEqual(prospective.canonical_members[PLAN],
    { schema_version: "plan.v1", rows: ["row"] });
});

test("two owners preparing one carrier are competing candidates, not a merge", () => {
  assert.throws(() => compileControlledContractAuthoringProspectiveMembers({
    wkId: WK, focus: null, source: leaseSource(BASE_MEMBERS),
    contributions: [
      { owner: "proof_graph", carrier_kind: "contract", filename: CONTRACT,
        content: { a: 1 } },
      { owner: "verification_bundle", carrier_kind: "contract", filename: CONTRACT,
        content: { a: 2 } }
    ]
  }), (error) =>
    error.code === "controlled_contract_authoring_contribution_conflicting" &&
    error.details.changed === false &&
    error.details.owners.join(",") === "proof_graph,verification_bundle");
});

test("an empty or malformed contribution set compiles nothing", () => {
  for (const contributions of [[], null,
    [{ owner: "x", filename: CONTRACT, content: null }],
    [{ owner: "x", filename: CONTRACT, content: [] }]]) {
    assert.throws(() => compileControlledContractAuthoringProspectiveMembers({
      wkId: WK, focus: null, source: leaseSource(BASE_MEMBERS), contributions
    }), (error) => typeof error.code === "string" &&
      error.code.startsWith("controlled_contract_authoring_contribution_"));
  }
});

test("prospective validation refuses a set that no longer binds its source", () => {
  const source = leaseSource(BASE_MEMBERS);
  const prospective = compileControlledContractAuthoringProspectiveMembers({
    wkId: WK, focus: null, source,
    contributions: [{ owner: "authoring_continuation", carrier_kind: "evaluation_input",
      filename: EVALUATION, content: { schema_version: "evaluation.v1" } }]
  });
  assert.equal(validateControlledContractAuthoringProspectiveMembers(prospective,
    { source }), prospective);
  const moved = leaseSource(BASE_MEMBERS, { generation: "generation-two" });
  assert.throws(() => validateControlledContractAuthoringProspectiveMembers(
    prospective, { source: moved }),
  (error) => error.code === "controlled_contract_authoring_prospective_stale" &&
    error.details.changed === false);
});

test("prospective validation refuses a tampered digest population", () => {
  const source = leaseSource(BASE_MEMBERS);
  const prospective = compileControlledContractAuthoringProspectiveMembers({
    wkId: WK, focus: null, source,
    contributions: [{ owner: "proof_plan", carrier_kind: "proof_plan",
      filename: PLAN, content: { schema_version: "plan.v1", rows: ["row"] } }]
  });
  const tampered = { ...prospective,
    member_digests: { ...prospective.member_digests, [PLAN]: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => validateControlledContractAuthoringProspectiveMembers(tampered),
    (error) => error.code === "controlled_contract_authoring_prospective_invalid");
  const missing = { ...prospective, member_digests: {} };
  assert.throws(() => validateControlledContractAuthoringProspectiveMembers(missing),
    (error) => error.code === "controlled_contract_authoring_prospective_invalid");
});
