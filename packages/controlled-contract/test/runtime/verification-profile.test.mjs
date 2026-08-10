import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkVerificationProfile,
  parseArgs as parseCliArgs,
  usage as cliUsage
} from "../development/tools/check-verification-profile.mjs";

import {
  EVALUATION_INPUT_VERSION,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
  VERIFICATION_PROFILE_RESULT_SCHEMA,
  VERIFICATION_PROFILE_SCHEMA,
  evaluateVerificationProfile,
  validateProfileSemantics
} from "../../lib/verification-profile.mjs";
import {
  PROFILE_ID,
  SCHEMA_VERSION,
  VOCABULARY_VERSION,
  validateAndResolveNativeContract
} from "../../lib/native-contract-carrier.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const profilePath = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.0.0/profile.json"
);
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const profileV11Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.1.0/profile.json"
);
const profileV11 = JSON.parse(await readFile(profileV11Path, "utf8"));
const profileV12Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.2.0/profile.json"
);
const profileV12 = JSON.parse(await readFile(profileV12Path, "utf8"));
const profileV13Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.3.0/profile.json"
);
const profileV13 = JSON.parse(await readFile(profileV13Path, "utf8"));
const profileV14Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.4.0/profile.json"
);
const profileV14 = JSON.parse(await readFile(profileV14Path, "utf8"));
const profileV15Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.5.0/profile.json"
);
const profileV15 = JSON.parse(await readFile(profileV15Path, "utf8"));
const profileV16Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.6.0/profile.json"
);
const profileV16 = JSON.parse(await readFile(profileV16Path, "utf8"));
const profileV17Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.7.0/profile.json"
);
const profileV17 = JSON.parse(await readFile(profileV17Path, "utf8"));
const profileV18Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.8.0/profile.json"
);
const profileV18 = JSON.parse(await readFile(profileV18Path, "utf8"));
const profileV19Path = path.resolve(
  testDirectory,
  "../legacy/profiles/proof.idempotency.effect-nonduplication/1.9.0/profile.json"
);
const profileV19 = JSON.parse(await readFile(profileV19Path, "utf8"));
const schemaDirectory = path.resolve(testDirectory, "../../schema");

test("idempotency 1.0 remains byte-frozen", async () => {
  const bytes = await readFile(profilePath);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "a369814ed371a7f895bd31b04d4c5d9a9a5e4cdbd9451f475816a31ab7b6daa2"
  );
});

test("idempotency 1.1 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV11Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "01ae97679ceec262184ce864870284db503de56808dbce01409ff7a17496fa81"
  );
});

test("idempotency 1.2 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV12Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "690d3cec54775810143ce9a1dd4d7b2f0fd8d851d069f0bbd89518d8ba36225d"
  );
});

test("idempotency 1.3 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV13Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "b201a8538cb22e7b925cbc6f9c788617f3e9132acc0fb211daf096007a8acdcc"
  );
});

test("idempotency 1.4 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV14Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "b9a99f12710f4451f545f7f6f0ac86fb007e4026b23ed0c0461a55a0dea819f0"
  );
});

test("idempotency 1.5 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV15Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "8aa9d2d058d6970923ecdec6e43569b7eb61f62bea46d8ae916df1682e423460"
  );
});

test("idempotency 1.6 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV16Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "1b8c8eff74e60c1519f1dfe7e737fb35338319a91bf4aafca1d64a9dc529bdcb"
  );
});

test("idempotency 1.7 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV17Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "55b712e64927241744a0002f21b944f8a9ba49bac9be6a54ccbf516fd69d6148"
  );
});

test("idempotency 1.8 remains byte-frozen after its pressure test", async () => {
  const bytes = await readFile(profileV18Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "6933169ea862536fa9ffd4943961c97863e91a33c5a12200816ef6202d205f21"
  );
});

test("idempotency 1.9 remains byte-frozen on the v0.33 profile path", async () => {
  const bytes = await readFile(profileV19Path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "bd8045761a6ae7710f49f1fe0247d44539275dea4c79c27fb4a7a313a4d4ab3e"
  );
});

const roleIds = Object.freeze({
  operation: "ref-operation",
  first_invocation: "ref-first-invocation",
  second_invocation: "ref-second-invocation",
  equivalent_input: "ref-equivalent-input",
  effect_after_first: "ref-effect-after-first",
  effect_after_second: "ref-effect-after-second",
  verification: "ref-verification",
  duplicate_effect_condition: "ref-duplicate-effect-condition"
});

function reference(referenceId, typeTerm, term) {
  return {
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "profile_term", term }
  };
}

function proposition(
  propositionId,
  subjectReferenceId,
  operator,
  operands,
  mode = "unconditional",
  operandReferenceIds = []
) {
  return {
    proposition_id: propositionId,
    subject_reference_id: subjectReferenceId,
    operator,
    applicability_context: {
      mode,
      operand_reference_ids: operandReferenceIds
    },
    operands
  };
}

function directContract(domain) {
  const domainTypes = {
    payment: { input: "cc:configuration", effect: "cc:state" },
    queue: { input: "cc:entity", effect: "cc:resource" },
    database: { input: "cc:artifact", effect: "cc:artifact" }
  }[domain];
  assert.ok(domainTypes, `unsupported test domain: ${domain}`);
  const references = [
    reference(roleIds.operation, "cc:operation", `${domain}:operation`),
    reference(roleIds.first_invocation, "cc:event", `${domain}:first-invocation`),
    reference(roleIds.second_invocation, "cc:event", `${domain}:second-invocation`),
    reference(roleIds.equivalent_input, domainTypes.input, `${domain}:equivalent-input`),
    reference(roleIds.effect_after_first, domainTypes.effect, `${domain}:effect-after-first`),
    reference(roleIds.effect_after_second, domainTypes.effect, `${domain}:effect-after-second`),
    reference(roleIds.verification, "cc:test", `${domain}:verification`),
    reference(
      roleIds.duplicate_effect_condition,
      "cc:configuration",
      `${domain}:duplicate-effect-condition`
    )
  ];
  const propositions = [
    proposition(
      "prop-idempotent-effect",
      roleIds.effect_after_second,
      "reference:behaviorally_equivalent",
      [{ kind: "reference", reference_id: roleIds.effect_after_first }],
      "after",
      [roleIds.second_invocation]
    ),
    proposition(
      "prop-first-invocation",
      roleIds.first_invocation,
      "reference:performs",
      [{ kind: "reference", reference_id: roleIds.operation }]
    ),
    proposition(
      "prop-first-input",
      roleIds.first_invocation,
      "reference:uses",
      [{ kind: "reference", reference_id: roleIds.equivalent_input }]
    ),
    proposition(
      "prop-first-observation",
      roleIds.verification,
      "reference:records",
      [{ kind: "reference", reference_id: roleIds.effect_after_first }],
      "after",
      [roleIds.first_invocation]
    ),
    proposition(
      "prop-second-invocation",
      roleIds.second_invocation,
      "reference:performs",
      [{ kind: "reference", reference_id: roleIds.operation }],
      "after",
      [roleIds.first_invocation]
    ),
    proposition(
      "prop-second-input",
      roleIds.second_invocation,
      "reference:uses",
      [{ kind: "reference", reference_id: roleIds.equivalent_input }],
      "after",
      [roleIds.first_invocation]
    ),
    proposition(
      "prop-second-observation",
      roleIds.verification,
      "reference:records",
      [{ kind: "reference", reference_id: roleIds.effect_after_second }],
      "after",
      [roleIds.second_invocation]
    ),
    proposition(
      "prop-idempotency-verification",
      roleIds.verification,
      "reference:covers",
      [{ kind: "reference", reference_id: roleIds.operation }]
    ),
    proposition(
      "prop-duplicate-effect",
      roleIds.effect_after_second,
      "reference:not_equals",
      [{ kind: "reference", reference_id: roleIds.effect_after_first }],
      "counterfactual",
      [roleIds.duplicate_effect_condition]
    )
  ];
  const claims = [
    {
      claim_id: "claim-idempotent-effect",
      kind: "behavior",
      modality: "MUST",
      proposition_id: "prop-idempotent-effect"
    },
    ...[
      "first-invocation",
      "first-input",
      "first-observation",
      "second-invocation",
      "second-input",
      "second-observation"
    ].map((id) => ({
      claim_id: `claim-${id}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-${id}`
    })),
    {
      claim_id: "claim-idempotency-verification",
      kind: "verification",
      modality: "MUST",
      proposition_id: "prop-idempotency-verification",
      verification_method: "test_execution",
      falsifying_proposition_id: "prop-duplicate-effect"
    }
  ];
  return {
    schema_version: SCHEMA_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: PROFILE_ID,
    references,
    propositions,
    claims,
    relations: [
      {
        relation_id: "rel-verifies-idempotency",
        role: "verifies",
        source_claim_id: "claim-idempotency-verification",
        target_claim_id: "claim-idempotent-effect"
      }
    ],
    collections: [
      {
        collection_id: "set-idempotency-proof-sequence",
        collection_kind: "ordered_sequence",
        member_claim_ids: [
          "claim-first-invocation",
          "claim-first-observation",
          "claim-second-invocation",
          "claim-second-observation",
          "claim-idempotent-effect"
        ]
      }
    ],
    residue: [],
    annotations: []
  };
}

function evaluationInput(overrides = {}) {
  return {
    input_version: EVALUATION_INPUT_VERSION,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.entries(roleIds).map(([role, referenceId]) => ({
      role,
      reference_ids: [referenceId]
    })),
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    ...overrides
  };
}

function evaluate(contract, input = evaluationInput()) {
  return evaluateVerificationProfile({
    contract,
    profile,
    evaluation_input: input
  });
}

function evaluationInputV11({ cardinality, ...overrides } = {}) {
  return evaluationInput({
    number_bindings: cardinality === undefined ? [] : [
      { role: "expected_effect_cardinality", value: cardinality }
    ],
    ...overrides
  });
}

function directContractV11(domain, branch = "equivalence", cardinality = 1) {
  const contract = directContract(domain);
  contract.collections[0].member_claim_ids = [
    "claim-first-invocation",
    "claim-first-observation",
    "claim-second-invocation",
    "claim-second-observation"
  ];
  if (branch === "equivalence") return contract;
  assert.equal(branch, "cardinality");
  contract.claims = contract.claims.filter(
    ({ claim_id }) => claim_id !== "claim-idempotent-effect"
  );
  contract.propositions = contract.propositions.filter(
    ({ proposition_id }) => proposition_id !== "prop-idempotent-effect"
  );
  contract.relations = [];
  for (const [ordinal, effectRole, invocationRole] of [
    ["first", roleIds.effect_after_first, roleIds.first_invocation],
    ["second", roleIds.effect_after_second, roleIds.second_invocation]
  ]) {
    contract.propositions.push(proposition(
      `prop-${ordinal}-effect-cardinality`,
      effectRole,
      "number:has_cardinality",
      [{ kind: "number", value: cardinality }],
      "after",
      [invocationRole]
    ));
    contract.claims.push({
      claim_id: `claim-${ordinal}-effect-cardinality`,
      kind: "behavior",
      modality: "MUST",
      proposition_id: `prop-${ordinal}-effect-cardinality`
    });
    contract.relations.push({
      relation_id: `rel-verifies-${ordinal}-effect-cardinality`,
      role: "verifies",
      source_claim_id: "claim-idempotency-verification",
      target_claim_id: `claim-${ordinal}-effect-cardinality`
    });
  }
  return contract;
}

function evaluateV12(
  contract,
  input = evaluationInputV11()
) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV12,
    evaluation_input: input
  });
}

const v13RoleIds = Object.freeze({
  operation: "ref-operation",
  first_invocation: "ref-first-invocation",
  second_invocation: "ref-second-invocation",
  first_input: "ref-first-input",
  second_input: "ref-second-input",
  effect_subject: "ref-effect-subject",
  effect_after_first: "ref-effect-after-first",
  effect_after_second: "ref-effect-after-second",
  verification: "ref-verification",
  duplicate_effect_condition: "ref-duplicate-effect-condition"
});

function evaluationInputV13({ cardinality, ...overrides } = {}) {
  return {
    input_version: EVALUATION_INPUT_VERSION,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.entries(v13RoleIds).map(([role, referenceId]) => ({
      role,
      reference_ids: [referenceId]
    })),
    number_bindings: cardinality === undefined ? [] : [
      { role: "expected_effect_cardinality", value: cardinality }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    ...overrides
  };
}

function directContractV13(domain, branch = "equivalence", cardinality = 1) {
  const domainTypes = {
    payment: { input: "cc:configuration", effect: "cc:resource" },
    queue: { input: "cc:entity", effect: "cc:resource" },
    database: { input: "cc:artifact", effect: "cc:entity" }
  }[domain];
  assert.ok(domainTypes, `unsupported test domain: ${domain}`);
  const references = [
    reference(v13RoleIds.operation, "cc:operation", `${domain}:operation`),
    reference(v13RoleIds.first_invocation, "cc:event", `${domain}:first-invocation`),
    reference(v13RoleIds.second_invocation, "cc:event", `${domain}:second-invocation`),
    reference(v13RoleIds.first_input, domainTypes.input, `${domain}:first-input`),
    reference(v13RoleIds.second_input, domainTypes.input, `${domain}:second-input`),
    reference(v13RoleIds.effect_subject, domainTypes.effect, `${domain}:effect-subject`),
    reference(v13RoleIds.effect_after_first, "cc:state", `${domain}:state-after-first`),
    reference(v13RoleIds.effect_after_second, "cc:state", `${domain}:state-after-second`),
    reference(v13RoleIds.verification, "cc:test", `${domain}:verification-suite`),
    reference(
      v13RoleIds.duplicate_effect_condition,
      "cc:configuration",
      `${domain}:duplicate-effect-condition`
    )
  ];
  const specifications = [
    ["input-equivalence", "behavior", v13RoleIds.second_input,
      "reference:semantically_equivalent", [v13RoleIds.first_input], "unconditional", []],
    ["first-invocation", "evidence", v13RoleIds.first_invocation,
      "reference:performs", [v13RoleIds.operation], "unconditional", []],
    ["first-input", "evidence", v13RoleIds.first_invocation,
      "reference:uses", [v13RoleIds.first_input], "unconditional", []],
    ["first-effect-state", "evidence", v13RoleIds.effect_subject,
      "reference:has_state", [v13RoleIds.effect_after_first], "after",
      [v13RoleIds.first_invocation]],
    ["first-observation", "evidence", v13RoleIds.verification,
      "reference:records", [v13RoleIds.effect_after_first], "after",
      [v13RoleIds.first_invocation]],
    ["second-invocation", "evidence", v13RoleIds.second_invocation,
      "reference:performs", [v13RoleIds.operation], "after",
      [v13RoleIds.first_invocation]],
    ["second-input", "evidence", v13RoleIds.second_invocation,
      "reference:uses", [v13RoleIds.second_input], "after",
      [v13RoleIds.first_invocation]],
    ["second-effect-state", "evidence", v13RoleIds.effect_subject,
      "reference:has_state", [v13RoleIds.effect_after_second], "after",
      [v13RoleIds.second_invocation]],
    ["second-observation", "evidence", v13RoleIds.verification,
      "reference:records", [v13RoleIds.effect_after_second], "after",
      [v13RoleIds.second_invocation]]
  ];
  if (branch === "equivalence") specifications.push([
    "idempotent-effect", "behavior", v13RoleIds.effect_after_second,
    "reference:behaviorally_equivalent", [v13RoleIds.effect_after_first], "after",
    [v13RoleIds.second_invocation]
  ]);
  else assert.equal(branch, "cardinality");

  const propositions = specifications.map(([
    id, , subject, operator, operands, mode, contexts
  ]) => proposition(
    `prop-${id}`,
    subject,
    operator,
    operands.map((referenceId) => ({ kind: "reference", reference_id: referenceId })),
    mode,
    contexts
  ));
  const claims = specifications.map(([id, kind]) => ({
    claim_id: `claim-${id}`,
    kind,
    modality: "MUST",
    proposition_id: `prop-${id}`
  }));
  if (branch === "cardinality") {
    for (const [ordinal, effectRole, invocationRole] of [
      ["first", v13RoleIds.effect_after_first, v13RoleIds.first_invocation],
      ["second", v13RoleIds.effect_after_second, v13RoleIds.second_invocation]
    ]) {
      propositions.push(proposition(
        `prop-${ordinal}-effect-cardinality`,
        effectRole,
        "number:has_cardinality",
        [{ kind: "number", value: cardinality }],
        "after",
        [invocationRole]
      ));
      claims.push({
        claim_id: `claim-${ordinal}-effect-cardinality`,
        kind: "behavior",
        modality: "MUST",
        proposition_id: `prop-${ordinal}-effect-cardinality`
      });
    }
  }
  propositions.push(
    proposition(
      "prop-idempotency-verification",
      v13RoleIds.verification,
      "reference:covers",
      [{ kind: "reference", reference_id: v13RoleIds.operation }]
    ),
    proposition(
      "prop-duplicate-effect",
      v13RoleIds.effect_after_second,
      "reference:not_equals",
      [{ kind: "reference", reference_id: v13RoleIds.effect_after_first }],
      "counterfactual",
      [v13RoleIds.duplicate_effect_condition]
    )
  );
  claims.push({
    claim_id: "claim-idempotency-verification",
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-idempotency-verification",
    verification_method: "test_execution",
    falsifying_proposition_id: "prop-duplicate-effect"
  });
  const verifiedBehaviorIds = branch === "equivalence"
    ? ["input-equivalence", "idempotent-effect"]
    : ["input-equivalence", "first-effect-cardinality", "second-effect-cardinality"];
  const relations = verifiedBehaviorIds.map((id) => ({
    relation_id: `rel-verifies-${id}`,
    role: "verifies",
    source_claim_id: "claim-idempotency-verification",
    target_claim_id: `claim-${id}`
  }));
  return {
    schema_version: SCHEMA_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: PROFILE_ID,
    references,
    propositions,
    claims,
    relations,
    collections: [{
      collection_id: "set-idempotency-proof-sequence",
      collection_kind: "ordered_sequence",
      member_claim_ids: [
        "claim-first-invocation",
        "claim-first-effect-state",
        "claim-first-observation",
        "claim-second-invocation",
        "claim-second-effect-state",
        "claim-second-observation"
      ]
    }],
    residue: [],
    annotations: []
  };
}

function evaluateV13(contract, input = evaluationInputV13()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV13,
    evaluation_input: input
  });
}

const v14RoleIds = Object.freeze({
  ...v13RoleIds,
  effect_before_second: "ref-effect-before-second",
  intervening_reset_condition: "ref-intervening-reset-condition"
});

function evaluationInputV14({ cardinality, ...overrides } = {}) {
  return {
    input_version: EVALUATION_INPUT_VERSION,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.entries(v14RoleIds).map(([role, referenceId]) => ({
      role,
      reference_ids: [referenceId]
    })),
    number_bindings: cardinality === undefined ? [] : [
      { role: "expected_effect_cardinality", value: cardinality }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    ...overrides
  };
}

function directContractV14(domain, branch = "equivalence", cardinality = 1) {
  const contract = directContractV13(domain, branch, cardinality);
  contract.references.push(
    reference(
      v14RoleIds.effect_before_second,
      "cc:artifact",
      `${domain}:observation-before-second`
    ),
    reference(
      v14RoleIds.intervening_reset_condition,
      "cc:configuration",
      `${domain}:intervening-reset-condition`
    )
  );
  const additions = [
    ["pre-second-effect-state", "evidence", v14RoleIds.effect_subject,
      "reference:has_state", v14RoleIds.effect_before_second],
    ["pre-second-observation", "evidence", v14RoleIds.verification,
      "reference:records", v14RoleIds.effect_before_second],
    ["state-continuity", "behavior", v14RoleIds.effect_subject,
      "reference:has_state", v14RoleIds.effect_after_first]
  ];
  for (const [id, kind, subject, operator, operand] of additions) {
    const continuity = id === "state-continuity";
    contract.propositions.push(proposition(
      `prop-${id}`,
      subject,
      operator,
      [{ kind: "reference", reference_id: operand }],
      continuity ? "until" : "before",
      [v14RoleIds.second_invocation]
    ));
    contract.claims.push({
      claim_id: `claim-${id}`,
      kind,
      modality: "MUST",
      proposition_id: `prop-${id}`
    });
  }
  contract.propositions.push(
    proposition(
      "prop-continuity-verification",
      v14RoleIds.verification,
      "reference:covers",
      [{ kind: "reference", reference_id: v14RoleIds.effect_subject }]
    ),
    proposition(
      "prop-intervening-reset",
      v14RoleIds.effect_before_second,
      "reference:not_equals",
      [{ kind: "reference", reference_id: v14RoleIds.effect_after_first }],
      "counterfactual",
      [v14RoleIds.intervening_reset_condition]
    )
  );
  contract.claims.push({
    claim_id: "claim-continuity-verification",
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-continuity-verification",
    verification_method: "test_execution",
    falsifying_proposition_id: "prop-intervening-reset"
  });
  contract.relations.push({
    relation_id: "rel-verifies-state-continuity",
    role: "verifies",
    source_claim_id: "claim-continuity-verification",
    target_claim_id: "claim-state-continuity"
  });
  const sequence = contract.collections[0].member_claim_ids;
  const secondInvocationIndex = sequence.indexOf("claim-second-invocation");
  sequence.splice(
    secondInvocationIndex,
    0,
    "claim-pre-second-effect-state",
    "claim-pre-second-observation"
  );
  return contract;
}

function evaluateV14(contract, input = evaluationInputV14()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV14,
    evaluation_input: input
  });
}

const v15RoleIds = Object.freeze({
  operation: v14RoleIds.operation,
  first_invocation: v14RoleIds.first_invocation,
  second_invocation: v14RoleIds.second_invocation,
  first_input: v14RoleIds.first_input,
  second_input: v14RoleIds.second_input,
  effect_subject: v14RoleIds.effect_subject,
  state_after_first: v14RoleIds.effect_after_first,
  state_before_second: v14RoleIds.effect_before_second,
  state_after_second: v14RoleIds.effect_after_second,
  observation_after_first: "ref-observation-after-first",
  observation_before_second: "ref-observation-before-second",
  observation_after_second: "ref-observation-after-second",
  verification: v14RoleIds.verification,
  intervening_reset_condition: v14RoleIds.intervening_reset_condition,
  duplicate_effect_condition: v14RoleIds.duplicate_effect_condition
});

function evaluationInputV15({ cardinality, ...overrides } = {}) {
  return {
    input_version: EVALUATION_INPUT_VERSION,
    evaluation_stage: "pre_dispatch",
    reference_bindings: Object.entries(v15RoleIds).map(([role, referenceId]) => ({
      role,
      reference_ids: [referenceId]
    })),
    number_bindings: cardinality === undefined ? [] : [
      { role: "expected_effect_cardinality", value: cardinality }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    ...overrides
  };
}

function directContractV15(domain, branch = "equivalence", cardinality = 1) {
  const contract = directContractV14(domain, branch, cardinality);
  const stateBeforeSecond = contract.references.find(
    ({ reference_id: referenceId }) => referenceId === v15RoleIds.state_before_second
  );
  stateBeforeSecond.type_term = "cc:state";
  stateBeforeSecond.identity = {
    kind: "profile_term",
    term: `${domain}:state-before-second`
  };
  for (const [role, referenceId] of [
    ["observation_after_first", v15RoleIds.observation_after_first],
    ["observation_before_second", v15RoleIds.observation_before_second],
    ["observation_after_second", v15RoleIds.observation_after_second]
  ]) contract.references.push(
    reference(referenceId, "cc:evidence", `${domain}:${role.replaceAll("_", "-")}`)
  );

  for (const [ordinal, stateReferenceId, observationReferenceId, mode, context] of [
    ["first", v15RoleIds.state_after_first, v15RoleIds.observation_after_first,
      "after", v15RoleIds.first_invocation],
    ["pre-second", v15RoleIds.state_before_second,
      v15RoleIds.observation_before_second, "before", v15RoleIds.second_invocation],
    ["second", v15RoleIds.state_after_second, v15RoleIds.observation_after_second,
      "after", v15RoleIds.second_invocation]
  ]) {
    const observationProposition = contract.propositions.find(
      ({ proposition_id }) => proposition_id === `prop-${ordinal}-observation`
    );
    observationProposition.operator = "reference:reads";
    observationProposition.operands = [
      { kind: "reference", reference_id: observationReferenceId }
    ];
    contract.propositions.push(proposition(
      `prop-${ordinal}-observation-record`,
      observationReferenceId,
      "reference:records",
      [{ kind: "reference", reference_id: stateReferenceId }],
      mode,
      [context]
    ));
    contract.claims.push({
      claim_id: `claim-${ordinal}-observation-record`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-${ordinal}-observation-record`
    });
    const sequence = contract.collections[0].member_claim_ids;
    sequence.splice(
      sequence.indexOf(`claim-${ordinal}-observation`),
      0,
      `claim-${ordinal}-observation-record`
    );
  }
  contract.collections.push({
    collection_id: "set-idempotency-proof-population",
    collection_kind: "closed_set",
    member_claim_ids: [...contract.collections[0].member_claim_ids]
  });
  return contract;
}

function evaluateV15(contract, input = evaluationInputV15()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV15,
    evaluation_input: input
  });
}

const v16RoleIds = Object.freeze({
  ...v15RoleIds,
  intervening_reset_state: "ref-intervening-reset-state"
});

function directContractV16(domain, branch = "equivalence", cardinality = 1) {
  const contract = directContractV15(domain, branch, cardinality);
  contract.references.push(reference(
    v16RoleIds.intervening_reset_state,
    "cc:state",
    `${domain}:intervening-reset-state`
  ));
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== v15RoleIds.state_before_second
  );
  for (const propositionEntry of contract.propositions) {
    if (propositionEntry.subject_reference_id === v15RoleIds.state_before_second) {
      propositionEntry.subject_reference_id = v15RoleIds.state_after_first;
    }
    for (const operand of propositionEntry.operands) {
      if (operand.kind === "reference" &&
          operand.reference_id === v15RoleIds.state_before_second) {
        operand.reference_id = v15RoleIds.state_after_first;
      }
    }
  }
  const resetFalsifier = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-intervening-reset"
  );
  resetFalsifier.subject_reference_id = v16RoleIds.effect_subject;
  resetFalsifier.operator = "reference:has_state";
  resetFalsifier.operands = [{
    kind: "reference",
    reference_id: v16RoleIds.intervening_reset_state
  }];
  return contract;
}

function evaluationInputV16(options = {}) {
  const input = evaluationInputV15(options);
  input.reference_bindings.find(
    ({ role }) => role === "state_before_second"
  ).reference_ids = [v15RoleIds.state_after_first];
  input.reference_bindings.push({
    role: "intervening_reset_state",
    reference_ids: [v16RoleIds.intervening_reset_state]
  });
  return input;
}

function evaluateV16(contract, input = evaluationInputV16()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV16,
    evaluation_input: input
  });
}

function directContractV17(domain, branch = "equivalence", cardinality = 1) {
  const contract = directContractV16(domain, branch, cardinality);
  contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  ).purpose = "profile_proof_population";
  if (branch === "cardinality") {
    const falsifier = contract.propositions.find(
      ({ proposition_id: propositionId }) => propositionId === "prop-duplicate-effect"
    );
    falsifier.operator = "number:not_equals";
    falsifier.operands = [{ kind: "number", value: cardinality }];
  }
  return contract;
}

function evaluateV17(contract, input = evaluationInputV16()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV17,
    evaluation_input: input
  });
}

function directContractV18(domain, branch = "equality", cardinality = 1) {
  const legacyBranch = branch === "equality" ? "equivalence" : branch;
  const contract = directContractV17(domain, legacyBranch, cardinality);
  if (branch === "equality") contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-idempotent-effect"
  ).operator = "reference:equals";
  return contract;
}

function evaluateV18(contract, input = evaluationInputV16()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV18,
    evaluation_input: input
  });
}

function directContractV19(domain, branch = "equality", cardinality = 1) {
  const legacyBranch = branch === "equality" ? "equivalence" : branch;
  const contract = directContractV15(domain, legacyBranch, cardinality);
  contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  ).purpose = "profile_proof_population";
  contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "ordered_sequence"
  ).purpose = "profile_proof_sequence";

  collapseReference(contract, v15RoleIds.second_input, v15RoleIds.first_input);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) => propositionId !== "prop-input-equivalence"
  );
  contract.claims = contract.claims.filter(
    ({ claim_id: claimId }) => claimId !== "claim-input-equivalence"
  );
  contract.relations = contract.relations.filter(
    ({ target_claim_id: targetClaimId }) => targetClaimId !== "claim-input-equivalence"
  );

  const continuity = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-state-continuity"
  );
  continuity.subject_reference_id = v15RoleIds.state_before_second;
  continuity.operator = "reference:equals";
  continuity.operands = [{
    kind: "reference",
    reference_id: v15RoleIds.state_after_first
  }];

  if (branch === "equality") {
    contract.propositions.find(
      ({ proposition_id: propositionId }) => propositionId === "prop-idempotent-effect"
    ).operator = "reference:equals";
  } else {
    contract.propositions = contract.propositions.filter(
      ({ proposition_id: propositionId }) =>
        propositionId !== "prop-first-effect-cardinality"
    );
    contract.claims = contract.claims.filter(
      ({ claim_id: claimId }) => claimId !== "claim-first-effect-cardinality"
    );
    contract.relations = contract.relations.filter(
      ({ target_claim_id: targetClaimId }) =>
        targetClaimId !== "claim-first-effect-cardinality"
    );
    const finalCardinality = contract.propositions.find(
      ({ proposition_id: propositionId }) =>
        propositionId === "prop-second-effect-cardinality"
    );
    finalCardinality.subject_reference_id = v15RoleIds.observation_after_second;
    finalCardinality.operator = "number:equals";
    const falsifier = contract.propositions.find(
      ({ proposition_id: propositionId }) => propositionId === "prop-duplicate-effect"
    );
    falsifier.subject_reference_id = v15RoleIds.observation_after_second;
    falsifier.operator = "number:not_equals";
    falsifier.operands = [{ kind: "number", value: cardinality }];
  }
  return contract;
}

function evaluationInputV19(options = {}) {
  const input = evaluationInputV15(options);
  input.reference_bindings.find(
    ({ role }) => role === "second_input"
  ).reference_ids = [v15RoleIds.first_input];
  return input;
}

function evaluateV19(contract, input = evaluationInputV19()) {
  return evaluateVerificationProfile({
    contract,
    profile: profileV19,
    evaluation_input: input
  });
}

function collapseReference(contract, sourceReferenceId, targetReferenceId) {
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== sourceReferenceId
  );
  for (const propositionEntry of contract.propositions) {
    if (propositionEntry.subject_reference_id === sourceReferenceId) {
      propositionEntry.subject_reference_id = targetReferenceId;
    }
    propositionEntry.applicability_context.operand_reference_ids =
      propositionEntry.applicability_context.operand_reference_ids.map(
        (referenceId) => referenceId === sourceReferenceId
          ? targetReferenceId
          : referenceId
      );
    for (const operand of propositionEntry.operands) {
      if (operand.kind === "reference" && operand.reference_id === sourceReferenceId) {
        operand.reference_id = targetReferenceId;
      }
    }
  }
}

function removeClaimPattern(contract, id) {
  contract.claims = contract.claims.filter(({ claim_id }) => claim_id !== `claim-${id}`);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id }) => proposition_id !== `prop-${id}`
  );
  for (const collection of contract.collections) {
    collection.member_claim_ids = collection.member_claim_ids.filter(
      (claimId) => claimId !== `claim-${id}`
    );
  }
}

test("the idempotency pack is a semantically closed generic profile", () => {
  assert.deepEqual(validateProfileSemantics(profile), []);
  assert.equal(profile.profile_id, "proof.idempotency.effect-nonduplication");
  assert.doesNotMatch(JSON.stringify(profile), /payment|queue|database/i);
});

test("idempotency 1.1 keeps assertions outside the temporal sequence", () => {
  assert.deepEqual(validateProfileSemantics(profileV11), []);
  assert.equal(profile.profile_version, "1.0.0");
  assert.equal(profileV11.profile_version, "1.1.0");
  assert.deepEqual(
    profileV11.collection_patterns[0].member_claim_pattern_ids,
    ["first-invocation", "first-observation", "second-invocation", "second-observation"]
  );
  assert.doesNotMatch(JSON.stringify(profileV11), /payment|queue|database|bootstrap|IN-0001/i);
});

test("idempotency 1.2 requires distinct proof roles and both cardinality edges", () => {
  assert.deepEqual(validateProfileSemantics(profileV12), []);
  assert.deepEqual(profileV12.distinct_reference_role_sets, [
    { roles: ["first_invocation", "second_invocation"] },
    { roles: ["effect_after_first", "effect_after_second"] }
  ]);
  assert.ok(profileV12.relation_patterns.some(
    ({ pattern_id }) => pattern_id === "verification-target-cardinality-first"
  ));
  assert.doesNotMatch(JSON.stringify(profileV12), /payment|queue|database|bootstrap|IN-0001/i);
});

test("idempotency 1.2 rejects collapsed invocation or observation roles", () => {
  for (const [role, referenceId] of [
    ["second_invocation", roleIds.first_invocation],
    ["effect_after_second", roleIds.effect_after_first]
  ]) {
    const input = evaluationInputV11();
    input.reference_bindings.find((binding) => binding.role === role).reference_ids = [
      referenceId
    ];
    const result = evaluateV12(directContractV11("payment"), input);
    assert.equal(result.satisfaction, "invalid");
    assert.ok(result.diagnostics.some(
      ({ code }) => code === "distinct_reference_roles_collapsed"
    ));
  }
});

test("idempotency 1.2 accepts extra authored steps around its ordered subsequence", () => {
  const contract = directContractV11("payment");
  contract.collections[0].member_claim_ids.splice(2, 0, "claim-idempotent-effect");
  const result = evaluateV12(contract);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.equal(
    result.pattern_results.find(({ pattern_id }) => pattern_id === "proof-sequence").status,
    "satisfied"
  );
});

test("idempotency 1.2 cardinality proof attaches verification to both observations", () => {
  const result = evaluateV12(
    directContractV11("database", "cardinality", 1),
    evaluationInputV11({ cardinality: 1 })
  );
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  for (const patternId of [
    "verification-target-cardinality-first",
    "verification-target-cardinality"
  ]) assert.equal(
    result.pattern_results.find(({ pattern_id: id }) => id === patternId).status,
    "satisfied"
  );
});

test("idempotency 1.3 models one resource through two state snapshots", () => {
  assert.deepEqual(validateProfileSemantics(profileV13), []);
  assert.equal(profileV13.profile_version, "1.3.0");
  assert.equal(
    profileV13.reference_roles.find(({ role }) => role === "effect_subject").cardinality,
    "exactly_one"
  );
  assert.deepEqual(
    profileV13.reference_roles.find(({ role }) => role === "effect_after_first")
      .allowed_type_terms,
    ["cc:state"]
  );
  assert.equal(profileV13.collection_patterns[0].match_mode, "contiguous_subsequence");
  assert.doesNotMatch(JSON.stringify(profileV13), /payment|queue|database|bootstrap|IN-0001/i);
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.3 accepts a discriminating ${domain} snapshot plan`, () => {
    const contract = directContractV13(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    const result = evaluateV13(contract);
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  });
}

test("idempotency 1.3 supports literally identical inputs", () => {
  const contract = directContractV13("payment");
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== v13RoleIds.second_input
  );
  for (const propositionId of ["prop-input-equivalence", "prop-second-input"]) {
    const target = contract.propositions.find(
      ({ proposition_id: id }) => id === propositionId
    );
    if (propositionId === "prop-input-equivalence") {
      target.subject_reference_id = v13RoleIds.first_input;
    }
    target.operands = [{ kind: "reference", reference_id: v13RoleIds.first_input }];
  }
  const input = evaluationInputV13();
  input.reference_bindings.find(({ role }) => role === "second_input").reference_ids = [
    v13RoleIds.first_input
  ];
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV13(contract, input).satisfaction, "satisfied");
});

test("idempotency 1.3 cardinality branch verifies both snapshots", () => {
  const result = evaluateV13(
    directContractV13("queue", "cardinality", 1),
    evaluationInputV13({ cardinality: 1 })
  );
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
});

test("idempotency 1.3 rejects a declared step inside its contiguous proof spine", () => {
  const contract = directContractV13("database");
  contract.propositions.push(proposition(
    "prop-intervening-cleanup",
    v13RoleIds.verification,
    "reference:deletes",
    [{ kind: "reference", reference_id: v13RoleIds.effect_subject }],
    "after",
    [v13RoleIds.first_invocation]
  ));
  contract.claims.push({
    claim_id: "claim-intervening-cleanup",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-intervening-cleanup"
  });
  contract.collections[0].member_claim_ids.splice(3, 0, "claim-intervening-cleanup");
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV13(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.equal(
    result.pattern_results.find(({ pattern_id }) => pattern_id === "proof-sequence").status,
    "unsatisfied"
  );

  contract.collections[0].member_claim_ids.splice(3, 1);
  contract.collections[0].member_claim_ids.unshift("claim-intervening-cleanup");
  assert.equal(evaluateV13(contract).satisfaction, "satisfied");
});

test("idempotency 1.4 requires an explicit between-invocation continuity proof", () => {
  assert.deepEqual(validateProfileSemantics(profileV14), []);
  assert.equal(profileV14.profile_version, "1.4.0");
  assert.deepEqual(profileV14.collection_patterns[0], {
    pattern_id: "proof-sequence",
    required_by_stage: "pre_dispatch",
    collection_kind: "ordered_sequence",
    match_mode: "subsequence",
    candidate_quantifier: "all_covering",
    member_claim_pattern_ids: [
      "first-invocation",
      "first-effect-state",
      "first-observation",
      "pre-second-effect-state",
      "pre-second-observation",
      "second-invocation",
      "second-effect-state",
      "second-observation"
    ]
  });
  assert.deepEqual(profileV14.reference_binding_patterns, [{
    pattern_id: "identical-input-binding",
    required_by_stage: "pre_dispatch",
    comparison: "same_reference",
    roles: ["first_input", "second_input"]
  }]);
  assert.deepEqual(
    profileV14.claim_patterns.find(
      ({ pattern_id }) => pattern_id === "state-continuity"
    ).proposition_template,
    {
      subject_role: "effect_subject",
      operator: "reference:has_state",
      applicability_context: {
        mode: "until",
        operand_roles: ["second_invocation"]
      },
      operands: [{ kind: "reference", role: "effect_after_first" }]
    }
  );
  assert.ok(profileV14.claim_patterns.some(
    ({ pattern_id, falsifying_proposition_template: falsifier }) =>
      pattern_id === "continuity-verification" &&
      falsifier?.applicability_context.operand_roles.includes(
        "intervening_reset_condition"
      )
  ));
  assert.doesNotMatch(
    JSON.stringify(profileV14),
    /payment|queue|database|bootstrap|IN-0001/i
  );
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.4 accepts a continuity-sensitive ${domain} plan`, () => {
    const contract = directContractV14(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    const result = evaluateV14(contract);
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  });
}

test("idempotency 1.4 supports literally identical inputs", () => {
  const contract = directContractV14("payment");
  removeClaimPattern(contract, "input-equivalence");
  contract.relations = contract.relations.filter(
    ({ relation_id }) => relation_id !== "rel-verifies-input-equivalence"
  );
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== v14RoleIds.second_input
  );
  contract.propositions.find(
    ({ proposition_id }) => proposition_id === "prop-second-input"
  ).operands = [{ kind: "reference", reference_id: v14RoleIds.first_input }];
  const input = evaluationInputV14();
  input.reference_bindings.find(({ role }) => role === "second_input").reference_ids = [
    v14RoleIds.first_input
  ];
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV14(contract, input);
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id }) => pattern_id === "identical-input-binding"
  ).status, "satisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id }) => pattern_id === "input-equivalence"
  ).status, "unsatisfied");
});

test("idempotency 1.4 requires explicit equivalence for distinct inputs", () => {
  const contract = directContractV14("queue");
  removeClaimPattern(contract, "input-equivalence");
  contract.relations = contract.relations.filter(
    ({ relation_id }) => relation_id !== "rel-verifies-input-equivalence"
  );
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV14(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id }) => pattern_id === "identical-input-binding"
  ).status, "unsatisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id }) => pattern_id === "input-equivalence"
  ).status, "unsatisfied");
});

test("reference-binding patterns report their missing roles", () => {
  const input = evaluationInputV14();
  input.reference_bindings = input.reference_bindings.filter(
    ({ role }) => role !== "second_input"
  );
  const result = evaluateV14(directContractV14("payment"), input);
  assert.equal(result.satisfaction, "indeterminate");
  assert.deepEqual(result.binding_analysis.reference_binding_blockers, [{
    pattern_id: "identical-input-binding",
    reference_roles: ["second_input"]
  }]);
});

test("idempotency 1.4 retains the caller-bound cardinality alternative", () => {
  const contract = directContractV14("database", "cardinality", 1);
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(
    evaluateV14(contract, evaluationInputV14({ cardinality: 1 })).satisfaction,
    "satisfied"
  );
  assert.equal(
    evaluateV14(contract, evaluationInputV14({ cardinality: 2 })).satisfaction,
    "unsatisfied"
  );
});

test("a clean sequence cannot substitute for the required continuity proof", () => {
  const contract = directContractV14("payment");
  removeClaimPattern(contract, "state-continuity");
  removeClaimPattern(contract, "continuity-verification");
  contract.propositions = contract.propositions.filter(
    ({ proposition_id }) => proposition_id !== "prop-intervening-reset"
  );
  contract.relations = contract.relations.filter(
    ({ relation_id }) => relation_id !== "rel-verifies-state-continuity"
  );
  contract.collections.push({
    collection_id: "set-parallel-clean-proof-sequence",
    collection_kind: "ordered_sequence",
    member_claim_ids: [...contract.collections[0].member_claim_ids]
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV14(contract).satisfaction, "unsatisfied");
});

test("idempotency 1.4 accepts grounded observation artifacts", () => {
  const contract = directContractV14("payment");
  for (const referenceId of [
    v14RoleIds.effect_after_first,
    v14RoleIds.effect_before_second,
    v14RoleIds.effect_after_second
  ]) contract.references.find(
    ({ reference_id: candidate }) => candidate === referenceId
  ).type_term = "cc:evidence";
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV14(contract).satisfaction, "satisfied");
});

test("idempotency 1.4 permits harmless interleaving inside the relative-order spine", () => {
  const contract = directContractV14("queue");
  contract.propositions.push(proposition(
    "prop-harmless-assertion",
    v14RoleIds.verification,
    "reference:reads",
    [{ kind: "reference", reference_id: v14RoleIds.first_input }],
    "after",
    [v14RoleIds.first_invocation]
  ));
  contract.claims.push({
    claim_id: "claim-harmless-assertion",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-harmless-assertion"
  });
  contract.collections[0].member_claim_ids.splice(3, 0, "claim-harmless-assertion");
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV14(contract).satisfaction, "satisfied");
});

test("all-covering sequence matching rejects a parallel conflicting order", () => {
  const contract = directContractV14("database");
  const conflicting = [...contract.collections[0].member_claim_ids];
  const beforeIndex = conflicting.indexOf("claim-pre-second-observation");
  const secondIndex = conflicting.indexOf("claim-second-invocation");
  [conflicting[beforeIndex], conflicting[secondIndex]] = [
    conflicting[secondIndex],
    conflicting[beforeIndex]
  ];
  contract.collections.push({
    collection_id: "set-conflicting-proof-sequence",
    collection_kind: "ordered_sequence",
    member_claim_ids: conflicting
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV14(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.deepEqual(
    result.diagnostics.find(
      ({ code }) => code === "collection_covering_sequences_disagree"
    ),
    {
      code: "collection_covering_sequences_disagree",
      pattern_id: "proof-sequence",
      candidate_collection_ids: [
        "set-conflicting-proof-sequence",
        "set-idempotency-proof-sequence"
      ],
      nonmatching_collection_ids: ["set-conflicting-proof-sequence"]
    }
  );
});

test("all-covering matching reports absence without claiming sequence disagreement", () => {
  const contract = directContractV14("payment");
  contract.collections = [];
  const result = evaluateV14(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.equal(result.diagnostics.some(
    ({ code }) => code === "collection_covering_sequences_disagree"
  ), false);
});

test("a declared reset plus a false continuity assertion remains a declared-world limit", () => {
  const contract = directContractV14("queue");
  contract.propositions.push(proposition(
    "prop-intervening-reset-step",
    v14RoleIds.verification,
    "reference:deletes",
    [{ kind: "reference", reference_id: v14RoleIds.effect_subject }],
    "after",
    [v14RoleIds.first_invocation]
  ));
  contract.claims.push({
    claim_id: "claim-intervening-reset-step",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-intervening-reset-step"
  });
  const clean = [...contract.collections[0].member_claim_ids];
  contract.collections[0].collection_id = "set-polluted-proof-sequence";
  contract.collections[0].member_claim_ids.splice(
    contract.collections[0].member_claim_ids.indexOf("claim-pre-second-effect-state"),
    0,
    "claim-intervening-reset-step"
  );
  contract.collections.push({
    collection_id: "set-parallel-clean-proof-sequence",
    collection_kind: "ordered_sequence",
    member_claim_ids: clean
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV14(contract);
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.diagnostics.length, 0);
});

test("all-covering matching is valid for closed sets", () => {
  const closedSetProfile = structuredClone(profileV14);
  closedSetProfile.collection_patterns[0].collection_kind = "closed_set";
  closedSetProfile.collection_patterns[0].match_mode = "exact";
  assert.deepEqual(validateProfileSemantics(closedSetProfile), []);
});

test("idempotency 1.5 separates observation occurrences from state values", () => {
  assert.deepEqual(validateProfileSemantics(profileV15), []);
  assert.equal(profileV15.profile_version, "1.5.0");
  assert.deepEqual(profileV15.distinct_reference_role_sets, [
    { roles: ["first_invocation", "second_invocation"] },
    {
      roles: [
        "observation_after_first",
        "observation_before_second",
        "observation_after_second"
      ]
    }
  ]);
  assert.deepEqual(
    profileV15.reference_roles.find(({ role }) => role === "state_after_first")
      .allowed_type_terms,
    ["cc:state"]
  );
  assert.deepEqual(
    profileV15.reference_roles.find(
      ({ role }) => role === "observation_after_first"
    ).allowed_type_terms,
    ["cc:artifact", "cc:evidence"]
  );
  assert.deepEqual(
    profileV15.claim_patterns.find(
      ({ pattern_id }) => pattern_id === "idempotency-verification"
    ).verification_methods,
    ["analysis", "demonstration", "proof", "test_execution"]
  );
  assert.deepEqual(
    profileV15.collection_patterns.map(
      ({ pattern_id, collection_kind: collectionKind, match_mode: matchMode }) => ({
        pattern_id,
        collection_kind: collectionKind,
        match_mode: matchMode
      })
    ),
    [
      {
        pattern_id: "proof-sequence",
        collection_kind: "ordered_sequence",
        match_mode: "subsequence"
      },
      {
        pattern_id: "proof-population",
        collection_kind: "closed_set",
        match_mode: "exact"
      }
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(profileV15),
    /payment|queue|database|bootstrap|IN-0001/i
  );
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.5 accepts a grounded ${domain} observation plan`, () => {
    const contract = directContractV15(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    assert.equal(evaluateV15(contract).satisfaction, "satisfied");
  });
}

test("idempotency 1.5 permits three observations of one unchanged state", () => {
  const contract = directContractV15("payment");
  for (const replacedReferenceId of [
    v15RoleIds.state_before_second,
    v15RoleIds.state_after_second
  ]) {
    contract.references = contract.references.filter(
      ({ reference_id: referenceId }) => referenceId !== replacedReferenceId
    );
    for (const propositionEntry of contract.propositions) {
      if (propositionEntry.subject_reference_id === replacedReferenceId) {
        propositionEntry.subject_reference_id = v15RoleIds.state_after_first;
      }
      for (const operand of propositionEntry.operands) {
        if (operand.kind === "reference" && operand.reference_id === replacedReferenceId) {
          operand.reference_id = v15RoleIds.state_after_first;
        }
      }
    }
  }
  const input = evaluationInputV15();
  for (const role of ["state_before_second", "state_after_second"]) {
    input.reference_bindings.find(
      ({ role: candidate }) => candidate === role
    ).reference_ids = [v15RoleIds.state_after_first];
  }
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV15(contract, input).satisfaction, "satisfied");
});

test("idempotency 1.5 rejects collapsed observation occurrences", () => {
  const contract = directContractV15("queue");
  const input = evaluationInputV15();
  input.reference_bindings.find(
    ({ role }) => role === "observation_before_second"
  ).reference_ids = [v15RoleIds.observation_after_first];
  const result = evaluateV15(contract, input);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "distinct_reference_roles_collapsed"
  ));
});

test("idempotency 1.5 requires an explicit closed proof population", () => {
  const contract = directContractV15("queue");
  contract.collections = contract.collections.filter(
    ({ collection_kind: collectionKind }) => collectionKind !== "closed_set"
  );
  assert.equal(evaluateV15(contract).satisfaction, "unsatisfied");
});

test("idempotency 1.5 accepts proof and rejects audit as a verification method", () => {
  const proofContract = directContractV15("database");
  for (const claim of proofContract.claims.filter(
    ({ kind }) => kind === "verification"
  )) claim.verification_method = "proof";
  assert.deepEqual(validateAndResolveNativeContract(proofContract).diagnostics, []);
  assert.equal(evaluateV15(proofContract).satisfaction, "satisfied");

  const auditContract = structuredClone(proofContract);
  for (const claim of auditContract.claims.filter(
    ({ kind }) => kind === "verification"
  )) claim.verification_method = "audit";
  assert.deepEqual(validateAndResolveNativeContract(auditContract).diagnostics, []);
  assert.equal(evaluateV15(auditContract).satisfaction, "unsatisfied");
});

test("idempotency 1.5 observation records accept artifacts but state roles do not", () => {
  const artifactContract = directContractV15("queue");
  for (const referenceId of [
    v15RoleIds.observation_after_first,
    v15RoleIds.observation_before_second,
    v15RoleIds.observation_after_second
  ]) artifactContract.references.find(
    ({ reference_id: candidate }) => candidate === referenceId
  ).type_term = "cc:artifact";
  assert.equal(evaluateV15(artifactContract).satisfaction, "satisfied");

  const mistypedState = structuredClone(artifactContract);
  mistypedState.references.find(
    ({ reference_id }) => reference_id === v15RoleIds.state_after_first
  ).type_term = "cc:artifact";
  assert.equal(evaluateV15(mistypedState).satisfaction, "invalid");
});

test("idempotency 1.6 binds continuity to one state reference", () => {
  assert.deepEqual(validateProfileSemantics(profileV16), []);
  assert.equal(profileV16.profile_version, "1.6.0");
  assert.deepEqual(
    profileV16.reference_binding_patterns.find(
      ({ pattern_id: patternId }) => patternId === "continuous-state-binding"
    ),
    {
      pattern_id: "continuous-state-binding",
      required_by_stage: "pre_dispatch",
      comparison: "same_reference",
      roles: ["state_after_first", "state_before_second"]
    }
  );
  assert.deepEqual(profileV16.number_roles, [{
    role: "expected_effect_cardinality",
    cardinality: "zero_or_one",
    number_type: "integer",
    minimum: 0
  }]);
  assert.ok(profileV16.distinct_reference_role_sets.some(({ roles }) =>
    roles.length === 2 &&
    roles.includes("state_after_first") &&
    roles.includes("intervening_reset_state")
  ));
  assert.deepEqual(
    profileV16.claim_patterns.find(
      ({ pattern_id: patternId }) => patternId === "continuity-verification"
    ).falsifying_proposition_template,
    {
      subject_role: "effect_subject",
      operator: "reference:has_state",
      applicability_context: {
        mode: "counterfactual",
        operand_roles: ["intervening_reset_condition"]
      },
      operands: [{ kind: "reference", role: "intervening_reset_state" }]
    }
  );
  assert.equal(
    profileV16.collection_patterns.find(
      ({ pattern_id: patternId }) => patternId === "proof-population"
    ).candidate_quantifier,
    "all_covering"
  );
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.6 accepts a continuous ${domain} observation plan`, () => {
    const contract = directContractV16(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    assert.equal(evaluateV16(contract).satisfaction, "satisfied");
  });
}

test("idempotency 1.6 rejects divergent state immediately before replay", () => {
  const contract = directContractV16("payment");
  const divergentStateId = "ref-divergent-state-before-second";
  contract.references.push(reference(
    divergentStateId,
    "cc:state",
    "payment:divergent-state-before-second"
  ));
  contract.propositions.find(
    ({ proposition_id: propositionId }) =>
      propositionId === "prop-pre-second-effect-state"
  ).operands = [{ kind: "reference", reference_id: divergentStateId }];
  contract.propositions.find(
    ({ proposition_id: propositionId }) =>
      propositionId === "prop-pre-second-observation-record"
  ).operands = [{ kind: "reference", reference_id: divergentStateId }];
  const input = evaluationInputV16();
  input.reference_bindings.find(
    ({ role }) => role === "state_before_second"
  ).reference_ids = [divergentStateId];
  const result = evaluateV16(contract, input);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "continuous-state-binding"
  ).status, "unsatisfied");
});

test("idempotency 1.6 rejects a polluted parallel closed proof population", () => {
  const contract = directContractV16("queue");
  const exactPopulation = contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  );
  contract.collections.push({
    collection_id: "set-polluted-proof-population",
    collection_kind: "closed_set",
    member_claim_ids: [
      ...exactPopulation.member_claim_ids,
      "claim-input-equivalence"
    ]
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV16(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.deepEqual(result.diagnostics.find(
    ({ code }) => code === "collection_covering_sets_disagree"
  ), {
    code: "collection_covering_sets_disagree",
    pattern_id: "proof-population",
    candidate_collection_ids: [
      "set-idempotency-proof-population",
      "set-polluted-proof-population"
    ],
    nonmatching_collection_ids: ["set-polluted-proof-population"]
  });
});

test("idempotency 1.6 ignores closed sets that do not cover the proof population", () => {
  const contract = directContractV16("payment");
  contract.collections.push(
    {
      collection_id: "set-unrelated-behaviors",
      collection_kind: "closed_set",
      member_claim_ids: ["claim-input-equivalence"]
    },
    {
      collection_id: "set-proof-population-subset",
      collection_kind: "closed_set",
      member_claim_ids: ["claim-first-invocation", "claim-first-effect-state"]
    }
  );
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV16(contract).satisfaction, "satisfied");
});

test("idempotency 1.6 cardinality bindings are nonnegative integers", () => {
  const contract = directContractV16("database", "cardinality", 1);
  assert.equal(
    evaluateV16(contract, evaluationInputV16({ cardinality: 1 })).satisfaction,
    "satisfied"
  );
  for (const value of [-1, 1.5]) {
    const result = evaluateV16(contract, evaluationInputV16({ cardinality: value }));
    assert.equal(result.satisfaction, "invalid");
    assert.ok(result.diagnostics.some(
      ({ code, role }) =>
        code === "number_role_binding_value_invalid" &&
        role === "expected_effect_cardinality"
    ));
  }
});

test("number-role ranges must be internally ordered", () => {
  const invalidProfile = structuredClone(profileV16);
  invalidProfile.number_roles[0].minimum = 2;
  invalidProfile.number_roles[0].maximum = 1;
  assert.ok(validateProfileSemantics(invalidProfile).some(
    ({ code }) => code === "profile_number_role_range_invalid"
  ));
});

test("idempotency 1.7 scopes final-state distinctness to the proof branch", () => {
  assert.deepEqual(validateProfileSemantics(profileV17), []);
  assert.equal(profileV17.profile_version, "1.7.0");
  assert.deepEqual(
    profileV17.reference_binding_patterns.find(
      ({ pattern_id: patternId }) => patternId === "distinct-effect-state-binding"
    ),
    {
      pattern_id: "distinct-effect-state-binding",
      required_by_stage: "pre_dispatch",
      comparison: "distinct_references",
      roles: ["state_after_first", "state_after_second"]
    }
  );
  const proofExpression = JSON.stringify(profileV17.satisfaction_expression);
  assert.match(proofExpression, /idempotency-equivalence-verification/);
  assert.match(proofExpression, /idempotency-cardinality-verification/);
  assert.ok(profileV17.distinct_reference_role_sets.some(({ roles }) =>
    roles.includes("state_after_second") &&
    roles.includes("intervening_reset_state")
  ));
  assert.equal(
    profileV17.collection_patterns.find(
      ({ pattern_id: patternId }) => patternId === "proof-population"
    ).collection_purpose,
    "profile_proof_population"
  );
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.7 accepts a purpose-scoped ${domain} plan`, () => {
    const contract = directContractV17(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    assert.equal(evaluateV17(contract).satisfaction, "satisfied");
  });
}

test("idempotency 1.7 does not accept a collapsed equivalence-state falsifier", () => {
  const contract = directContractV17("payment");
  collapseReference(
    contract,
    v15RoleIds.state_after_second,
    v15RoleIds.state_after_first
  );
  const input = evaluationInputV16();
  input.reference_bindings.find(
    ({ role }) => role === "state_after_second"
  ).reference_ids = [v15RoleIds.state_after_first];
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV17(contract, input);
  assert.notEqual(result.satisfaction, "satisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "distinct-effect-state-binding"
  ).status, "unsatisfied");
  const decidedInput = evaluationInputV16({ cardinality: 1 });
  decidedInput.reference_bindings.find(
    ({ role }) => role === "state_after_second"
  ).reference_ids = [v15RoleIds.state_after_first];
  assert.equal(evaluateV17(contract, decidedInput).satisfaction, "unsatisfied");
});

test("idempotency 1.7 permits one state reference on the cardinality branch", () => {
  const contract = directContractV17("database", "cardinality", 1);
  collapseReference(
    contract,
    v15RoleIds.state_after_second,
    v15RoleIds.state_after_first
  );
  const input = evaluationInputV16({ cardinality: 1 });
  input.reference_bindings.find(
    ({ role }) => role === "state_after_second"
  ).reference_ids = [v15RoleIds.state_after_first];
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV17(contract, input);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.equal(result.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "distinct-effect-state-binding"
  ).status, "unsatisfied");
  assert.equal(result.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "idempotency-cardinality-verification"
  ).status, "satisfied");
});

test("idempotency 1.7 keeps reset state distinct from the final state", () => {
  const contract = directContractV17("queue");
  const input = evaluationInputV16();
  input.reference_bindings.find(
    ({ role }) => role === "intervening_reset_state"
  ).reference_ids = [v15RoleIds.state_after_second];
  const result = evaluateV17(contract, input);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(
    ({ code, roles }) =>
      code === "distinct_reference_roles_collapsed" &&
      roles.includes("state_after_second") &&
      roles.includes("intervening_reset_state")
  ));
});

test("idempotency 1.7 compares only closed populations with the same purpose", () => {
  const contract = directContractV17("payment");
  const exactPopulation = contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  );
  contract.collections.push({
    collection_id: "set-broader-acceptance-population",
    collection_kind: "closed_set",
    purpose: "whole_acceptance_population",
    member_claim_ids: [
      ...exactPopulation.member_claim_ids,
      "claim-input-equivalence"
    ]
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV17(contract).satisfaction, "satisfied");

  contract.collections.at(-1).purpose = "profile_proof_population";
  const pollutedResult = evaluateV17(contract);
  assert.equal(pollutedResult.satisfaction, "unsatisfied");
  assert.ok(pollutedResult.diagnostics.some(
    ({ code }) => code === "collection_covering_sets_disagree"
  ));
});

test("idempotency 1.7 attributes a missing purpose-scoped population", () => {
  const contract = directContractV17("queue");
  delete contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  ).purpose;
  const result = evaluateV17(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.deepEqual(result.diagnostics.find(
    ({ code }) => code === "collection_pattern_no_candidate"
  ), {
    code: "collection_pattern_no_candidate",
    pattern_id: "proof-population",
    collection_kind: "closed_set",
    collection_purpose: "profile_proof_population"
  });
});

test("all-covering populations expose non-covering overlaps without changing satisfaction", () => {
  const contract = directContractV17("queue");
  const exactPopulation = contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  );
  const missingMember = exactPopulation.member_claim_ids.at(-1);
  contract.collections.push({
    collection_id: "set-near-complete-relabelled",
    collection_kind: "closed_set",
    purpose: "internal_bookkeeping",
    member_claim_ids: [
      ...exactPopulation.member_claim_ids.slice(0, -1),
      "claim-input-equivalence"
    ]
  });
  const result = evaluateV17(contract);
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.diagnostics.find(
    ({ code }) => code === "collection_noncovering_population_overlap"
  ), {
    code: "collection_noncovering_population_overlap",
    pattern_id: "proof-population",
    collections: [{
      collection_id: "set-near-complete-relabelled",
      actual_collection_purpose: "internal_bookkeeping",
      shared_member_claim_ids: exactPopulation.member_claim_ids.slice(0, -1).sort(),
      missing_expected_member_claim_ids: [missingMember],
      extra_member_claim_ids: ["claim-input-equivalence"]
    }]
  });
});

test("idempotency 1.8 uses exact equality with its controlled complement", () => {
  assert.deepEqual(validateProfileSemantics(profileV18), []);
  assert.equal(profileV18.profile_version, "1.8.0");
  assert.equal(profileV18.claim_patterns.find(
    ({ pattern_id: patternId }) => patternId === "idempotent-effect"
  ).proposition_template.operator, "reference:equals");
  assert.equal(profileV18.claim_patterns.find(
    ({ pattern_id: patternId }) => patternId === "idempotency-equivalence-verification"
  ).falsifying_proposition_template.operator, "reference:not_equals");
});

for (const domain of ["payment", "queue", "database"]) {
  test(`idempotency 1.8 accepts an exact-state ${domain} plan`, () => {
    const contract = directContractV18(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    assert.equal(evaluateV18(contract).satisfaction, "satisfied");
  });
}

test("idempotency 1.8 normalizes duplicate set-like proposition members", () => {
  const contract = directContractV18("payment");
  const behavior = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-idempotent-effect"
  );
  behavior.applicability_context.operand_reference_ids.push(
    behavior.applicability_context.operand_reference_ids[0]
  );
  behavior.operands.push(structuredClone(behavior.operands[0]));
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  assert.equal(evaluateV18(contract).satisfaction, "satisfied");
});

test("idempotency 1.8 rejects behavioral equivalence as a substitute for equality", () => {
  const contract = directContractV17("payment");
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateV18(contract);
  assert.equal(result.satisfaction, "indeterminate");
  assert.equal(result.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "idempotent-effect"
  ).status, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code, unbound_number_roles: roles }) =>
      code === "profile_satisfaction_indeterminate" &&
      roles.includes("expected_effect_cardinality")
  ));
});

test("idempotency 1.8 exposes purpose relabeling without rejecting a broader population", () => {
  const contract = directContractV18("queue");
  const exactPopulation = contract.collections.find(
    ({ collection_kind: collectionKind }) => collectionKind === "closed_set"
  );
  contract.collections.push({
    collection_id: "set-broader-purpose-population",
    collection_kind: "closed_set",
    purpose: "whole_acceptance_population",
    member_claim_ids: [...exactPopulation.member_claim_ids, "claim-input-equivalence"]
  });
  const result = evaluateV18(contract);
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.diagnostics.find(
    ({ code }) => code === "collection_covering_purpose_mismatch"
  ), {
    code: "collection_covering_purpose_mismatch",
    pattern_id: "proof-population",
    expected_collection_purpose: "profile_proof_population",
    excluded_collections: [{
      collection_id: "set-broader-purpose-population",
      actual_collection_purpose: "whole_acceptance_population"
    }]
  });
});

test("idempotency 1.8 permits a behavior to oppose its discriminating falsifier", () => {
  const contract = directContractV18("database");
  const falsifier = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-duplicate-effect"
  );
  contract.propositions.push({
    ...structuredClone(falsifier),
    proposition_id: "prop-duplicate-effect-impossible",
    operator: "reference:equals"
  });
  contract.claims.push({
    claim_id: "claim-duplicate-effect-impossible",
    kind: "behavior",
    modality: "MUST",
    proposition_id: "prop-duplicate-effect-impossible"
  });
  contract.relations.push({
    relation_id: "rel-verifies-duplicate-effect-impossible",
    role: "verifies",
    source_claim_id: "claim-idempotency-verification",
    target_claim_id: "claim-duplicate-effect-impossible"
  });
  const result = evaluateV18(contract);
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.diagnostics.some(
    ({ code }) => code === "verification_falsifier_contradiction"
  ), false);
});

test("idempotency 1.9 requires a complementary falsifier for every verified target", () => {
  assert.deepEqual(validateProfileSemantics(profileV19), []);
  assert.equal(
    profileV19.verification_falsifier_policy,
    "controlled_complement_per_target"
  );
  const broken = structuredClone(profileV19);
  broken.claim_patterns.find(
    ({ pattern_id: patternId }) => patternId === "second-effect-cardinality"
  ).proposition_template.operator = "number:has_cardinality";
  assert.deepEqual(validateProfileSemantics(broken).find(
    ({ code }) => code === "profile_verification_falsifier_not_complementary"
  ), {
    code: "profile_verification_falsifier_not_complementary",
    pattern_id: "verification-target-cardinality",
    source_claim_pattern_id: "idempotency-cardinality-verification",
    target_claim_pattern_id: "second-effect-cardinality",
    reasons: ["operator_is_not_controlled_complement"]
  });
});

for (const domain of ["payment", "queue", "database"]) {
  for (const branch of ["equality", "cardinality"]) {
    test(`idempotency 1.9 accepts the ${domain} ${branch} proof`, () => {
      const contract = directContractV19(domain, branch);
      const input = evaluationInputV19(branch === "cardinality" ? { cardinality: 1 } : {});
      assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
      assert.equal(evaluateV19(contract, input).satisfaction, "satisfied");
    });
  }
}

test("idempotency 1.9 requires literal input reuse until semantic inequality exists", () => {
  const contract = directContractV19("payment");
  contract.references.push(reference(
    v15RoleIds.second_input,
    "cc:configuration",
    "payment:second-input"
  ));
  const input = evaluationInputV19();
  input.reference_bindings.find(
    ({ role }) => role === "second_input"
  ).reference_ids = [v15RoleIds.second_input];
  assert.equal(evaluateV19(contract, input).satisfaction, "unsatisfied");
});

test("idempotency 1.9 rejects zero as an effect cardinality proof", () => {
  const contract = directContractV19("queue", "cardinality", 0);
  const result = evaluateV19(contract, evaluationInputV19({ cardinality: 0 }));
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(
    ({ code, role }) => code === "number_role_binding_value_invalid" &&
      role === "expected_effect_cardinality"
  ));
});

test("idempotency 1.9 attributes absent and disjoint proof sequences", () => {
  const missing = directContractV19("database");
  missing.collections = missing.collections.filter(
    ({ collection_kind: collectionKind }) => collectionKind !== "ordered_sequence"
  );
  const missingResult = evaluateV19(missing);
  assert.equal(missingResult.satisfaction, "unsatisfied");
  assert.ok(missingResult.diagnostics.some(
    ({ code, pattern_id: patternId }) =>
      code === "collection_pattern_no_candidate" && patternId === "proof-sequence"
  ));

  const disjoint = directContractV19("database");
  disjoint.collections.push({
    collection_id: "set-disjoint-proof-sequence",
    collection_kind: "ordered_sequence",
    purpose: "profile_proof_sequence",
    member_claim_ids: ["claim-idempotent-effect"]
  });
  const disjointResult = evaluateV19(disjoint);
  assert.equal(disjointResult.satisfaction, "satisfied");
  assert.ok(disjointResult.diagnostics.some(
    ({ code, pattern_id: patternId }) =>
      code === "collection_disjoint_purpose_match" && patternId === "proof-sequence"
  ));
});

test("idempotency 1.1 accepts the corrected equivalence proof without numeric input", () => {
  const contract = directContractV11("payment");
  const result = evaluateVerificationProfile({
    contract,
    profile: profileV11,
    evaluation_input: evaluationInputV11()
  });
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.deepEqual(result.binding_analysis.unbound_number_roles, [
    "expected_effect_cardinality"
  ]);
  assert.deepEqual(result.binding_analysis.directly_blocked_pattern_ids, [
    "first-effect-cardinality",
    "second-effect-cardinality"
  ]);
  const alternativeTrace = result.satisfaction_trace.children.at(-1);
  assert.equal(alternativeTrace.kind, "any_of");
  assert.deepEqual(
    alternativeTrace.children.map(({ status }) => status),
    ["satisfied", "indeterminate"]
  );
});

test("idempotency 1.1 accepts a caller-bound cardinality proof", () => {
  const contract = directContractV11("database", "cardinality", 1);
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluateVerificationProfile({
    contract,
    profile: profileV11,
    evaluation_input: evaluationInputV11({ cardinality: 1 })
  });
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.equal(
    result.pattern_results.find(
      ({ pattern_id }) => pattern_id === "idempotent-effect"
    ).status,
    "unsatisfied"
  );
  assert.equal(
    result.pattern_results.find(
      ({ pattern_id }) => pattern_id === "second-effect-cardinality"
    ).status,
    "satisfied"
  );
  assert.equal(
    result.pattern_results.find(
      ({ pattern_id }) => pattern_id === "verification-target-equivalence"
    ).status,
    "unsatisfied"
  );
  assert.equal(
    result.binding_analysis.downstream_blocked_pattern_ids.includes(
      "verification-target-equivalence"
    ),
    false
  );
});

test("idempotency 1.1 rejects a cardinality binding that differs from the contract", () => {
  const result = evaluateVerificationProfile({
    contract: directContractV11("queue", "cardinality", 1),
    profile: profileV11,
    evaluation_input: evaluationInputV11({ cardinality: 2 })
  });
  assert.equal(result.satisfaction, "unsatisfied");
});

test("binding analysis separates missing roots from downstream patterns", () => {
  const input = evaluationInputV11();
  input.reference_bindings = input.reference_bindings.filter(
    ({ role }) => role === "verification"
  );
  const result = evaluateVerificationProfile({
    contract: directContractV11("payment"),
    profile: profileV11,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "indeterminate");
  assert.deepEqual(result.binding_analysis.unbound_reference_roles, [
    "duplicate_effect_condition",
    "effect_after_first",
    "effect_after_second",
    "equivalent_input",
    "first_invocation",
    "operation",
    "second_invocation"
  ]);
  assert.ok(result.binding_analysis.directly_blocked_pattern_ids.length > 0);
  assert.deepEqual(result.binding_analysis.downstream_blocked_pattern_ids, [
    "proof-sequence",
    "verification-target-cardinality",
    "verification-target-equivalence"
  ]);
  assert.deepEqual(
    result.binding_analysis.direct_binding_blockers.find(
      ({ pattern_id }) => pattern_id === "idempotency-verification"
    ),
    {
      pattern_id: "idempotency-verification",
      proposition_reference_roles: ["operation"],
      proposition_number_roles: [],
      falsifier_reference_roles: [
        "duplicate_effect_condition",
        "effect_after_first",
        "effect_after_second"
      ],
      falsifier_number_roles: []
    }
  );
  assert.deepEqual(
    result.binding_analysis.reference_roles_without_eligible_candidates,
    []
  );
});

test("binding analysis distinguishes an unbound role with no eligible reference", () => {
  const contract = directContractV11("payment");
  for (const id of [
    "second-invocation",
    "second-input",
    "second-observation",
    "idempotent-effect"
  ]) removeClaimPattern(contract, id);
  contract.references = contract.references.filter(
    ({ reference_id: referenceId }) => referenceId !== roleIds.second_invocation
  );
  contract.relations = [];
  contract.propositions.push(proposition(
    "prop-operation-required",
    roleIds.operation,
    "boolean:exists",
    [{ kind: "boolean", value: true }]
  ));
  contract.claims.push({
    claim_id: "claim-operation-required",
    kind: "behavior",
    modality: "MUST",
    proposition_id: "prop-operation-required"
  });
  contract.relations.push({
    relation_id: "rel-verifies-operation-required",
    role: "verifies",
    source_claim_id: "claim-idempotency-verification",
    target_claim_id: "claim-operation-required"
  });
  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);

  const input = evaluationInputV11();
  input.reference_bindings = input.reference_bindings.filter(({ role }) =>
    ["operation", "verification", "first_invocation"].includes(role)
  );
  const result = evaluateV12(contract, input);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(
    result.binding_analysis.reference_roles_without_eligible_candidates.includes(
      "second_invocation"
    )
  );
});

test("idempotency 1.1 still rejects a nondiscriminating one-request plan", () => {
  const contract = directContractV11("payment");
  for (const id of [
    "first-invocation",
    "first-input",
    "first-observation",
    "second-invocation",
    "second-input",
    "second-observation"
  ]) removeClaimPattern(contract, id);
  contract.collections = [];
  const result = evaluateVerificationProfile({
    contract,
    profile: profileV11,
    evaluation_input: evaluationInputV11()
  });
  assert.equal(result.satisfaction, "unsatisfied");
});

test("tracked SDK schemas are byte-independent copies of executable schemas", async () => {
  const [profileSchema, inputSchema, resultSchema] = await Promise.all([
    readFile(
      path.join(
        schemaDirectory,
        "controlled-contract-verification-profile.experimental.v0.1.schema.json"
      ),
      "utf8"
    ),
    readFile(
      path.join(
        schemaDirectory,
        "controlled-contract-verification-profile-input.experimental.v0.1.schema.json"
      ),
      "utf8"
    ),
    readFile(
      path.join(
        schemaDirectory,
        "controlled-contract-verification-profile-result.experimental.v0.1.schema.json"
      ),
      "utf8"
    )
  ]);
  assert.deepEqual(JSON.parse(profileSchema), VERIFICATION_PROFILE_SCHEMA);
  assert.deepEqual(JSON.parse(inputSchema), VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA);
  assert.deepEqual(JSON.parse(resultSchema), VERIFICATION_PROFILE_RESULT_SCHEMA);
});

for (const domain of ["payment", "queue", "database"]) {
  test(`one frozen idempotency profile accepts a discriminating ${domain} plan`, () => {
    const contract = directContract(domain);
    assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
    const result = evaluate(contract);
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
    assert.equal(result.authority.authoritative, false);
    assert.equal(result.pattern_results.every(({ status }) => status === "satisfied"), true);
  });
}

test("a one-request status-only plan remains contract-valid but fails the idempotency pack", () => {
  const contract = directContract("payment");
  for (const id of [
    "first-invocation",
    "first-input",
    "first-observation",
    "second-invocation",
    "second-input",
    "second-observation"
  ]) removeClaimPattern(contract, id);
  contract.collections = [];

  assert.deepEqual(validateAndResolveNativeContract(contract).diagnostics, []);
  const result = evaluate(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.pattern_results.some(
    ({ pattern_id, status }) => pattern_id === "second-invocation" && status === "unsatisfied"
  ));
  assert.ok(result.pattern_results.some(
    ({ pattern_id, status }) => pattern_id === "proof-sequence" && status === "unsatisfied"
  ));
});

test("a missing second observation identifies the exact absent proof pattern", () => {
  const contract = directContract("queue");
  removeClaimPattern(contract, "second-observation");
  const result = evaluate(contract);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.deepEqual(
    result.pattern_results.find(({ pattern_id }) => pattern_id === "second-observation"),
    {
      pattern_id: "second-observation",
      pattern_kind: "claim",
      status: "unsatisfied",
      matched_ids: []
    }
  );
});

test("ambiguous automatic claim matching requires an explicit pattern binding", () => {
  const contract = directContract("database");
  contract.propositions.push({
    ...structuredClone(
      contract.propositions.find(({ proposition_id }) =>
        proposition_id === "prop-first-invocation"
      )
    ),
    proposition_id: "prop-first-invocation-duplicate"
  });
  contract.claims.push({
    claim_id: "claim-first-invocation-duplicate",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-first-invocation-duplicate"
  });

  const ambiguous = evaluate(contract);
  assert.equal(ambiguous.satisfaction, "indeterminate");
  assert.ok(ambiguous.diagnostics.some(
    ({ code, pattern_id }) => code === "claim_pattern_match_ambiguous" &&
      pattern_id === "first-invocation"
  ));
  assert.ok(ambiguous.ambiguity_analysis.directly_ambiguous_pattern_ids.includes(
    "first-invocation"
  ));
  assert.ok(ambiguous.ambiguity_analysis.downstream_ambiguous_pattern_ids.includes(
    "proof-sequence"
  ));

  const explicit = evaluate(contract, evaluationInput({
    claim_pattern_bindings: [
      { pattern_id: "first-invocation", claim_id: "claim-first-invocation" }
    ]
  }));
  assert.equal(explicit.satisfaction, "satisfied", JSON.stringify(explicit.diagnostics));
});

test("missing and mistyped role bindings never become inferred success", () => {
  const contract = directContract("payment");
  const missing = evaluationInput();
  missing.reference_bindings = missing.reference_bindings.filter(
    ({ role }) => role !== "second_invocation"
  );
  const missingResult = evaluate(contract, missing);
  assert.equal(missingResult.satisfaction, "indeterminate");
  assert.ok(missingResult.diagnostics.some(
    ({ code, role }) => code === "required_reference_role_unbound" &&
      role === "second_invocation"
  ));

  const mistyped = structuredClone(contract);
  mistyped.references.find(({ reference_id }) =>
    reference_id === roleIds.operation
  ).type_term = "cc:state";
  const mistypedResult = evaluate(mistyped);
  assert.equal(mistypedResult.satisfaction, "invalid");
  const mismatch = mistypedResult.diagnostics.find(
    ({ code }) => code === "reference_role_binding_type_mismatch"
  );
  assert.ok(mismatch);
  assert.notEqual(
    mismatch.allowed_type_terms,
    profile.reference_roles.find(({ role }) => role === "operation").allowed_type_terms
  );
  mismatch.allowed_type_terms.push("cc:state");
  assert.deepEqual(
    profile.reference_roles.find(({ role }) => role === "operation").allowed_type_terms,
    ["cc:operation"]
  );
});

test("property and array ordering do not affect idempotency profile results", () => {
  const contract = directContract("queue");
  const first = evaluate(contract);
  const reordered = structuredClone(contract);
  reordered.references.reverse();
  reordered.propositions.reverse();
  reordered.claims.reverse();
  for (const proposition of reordered.propositions) proposition.operands =
    proposition.operands.map((operand) => Object.fromEntries(
      Object.entries(operand).reverse()
    ));
  const second = evaluate(reordered, evaluationInput({
    reference_bindings: [...evaluationInput().reference_bindings].reverse()
  }));
  assert.deepEqual(second, first);
});

test("set-like multi-reference operands match independently of authored order", () => {
  const contract = directContract("queue");
  contract.references.push(
    reference("ref-equivalent-input-extra", "cc:configuration", "queue:input-extra")
  );
  for (const propositionId of ["prop-first-input", "prop-second-input"]) {
    contract.propositions.find(({ proposition_id }) =>
      proposition_id === propositionId
    ).operands.unshift({
      kind: "reference",
      reference_id: "ref-equivalent-input-extra"
    });
  }
  const input = evaluationInput();
  input.reference_bindings.find(({ role }) => role === "equivalent_input").reference_ids = [
    roleIds.equivalent_input,
    "ref-equivalent-input-extra"
  ];
  const result = evaluate(contract, input);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
});

test("bounded any-of alternatives accept one declared proof branch", () => {
  const alternativeProfile = structuredClone(profile);
  alternativeProfile.satisfaction_expression = {
    all_of: [
      { pattern: "idempotent-effect" },
      { pattern: "first-invocation" },
      {
        any_of: [
          { pattern: "first-input" },
          { pattern: "second-input" }
        ]
      },
      { pattern: "first-observation" },
      { pattern: "second-invocation" },
      { pattern: "second-observation" },
      { pattern: "idempotency-verification" },
      { pattern: "verification-target" },
      { pattern: "proof-sequence" }
    ]
  };
  const contract = directContract("database");
  removeClaimPattern(contract, "first-input");
  const result = evaluateVerificationProfile({
    contract,
    profile: alternativeProfile,
    evaluation_input: evaluationInput()
  });
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(
    result.pattern_results.find(({ pattern_id }) => pattern_id === "first-input").status,
    "unsatisfied"
  );
});

test("resolver facts and delivered evidence remain explicit staged inputs", () => {
  const stagedProfile = structuredClone(profile);
  stagedProfile.evaluation_stages = ["pre_dispatch", "post_delivery"];
  stagedProfile.resolver_fact_patterns = [
    {
      pattern_id: "operation-stability-fact",
      required_by_stage: "pre_dispatch",
      resolver_kind: "code-analysis",
      fact_key: "operation-stable",
      argument_roles: ["operation"]
    }
  ];
  stagedProfile.evidence_patterns = [
    {
      pattern_id: "verification-executed",
      required_by_stage: "post_delivery",
      evidence_kind: "test-result",
      verification_claim_pattern_id: "idempotency-verification"
    }
  ];
  stagedProfile.satisfaction_expression.all_of.push(
    { pattern: "operation-stability-fact" },
    { pattern: "verification-executed" }
  );
  const contract = directContract("queue");
  const resolverFact = {
    resolver_kind: "code-analysis",
    fact_key: "operation-stable",
    argument_reference_ids: [roleIds.operation],
    satisfied: true
  };

  const absentFact = evaluateVerificationProfile({
    contract,
    profile: stagedProfile,
    evaluation_input: evaluationInput()
  });
  assert.equal(absentFact.satisfaction, "indeterminate");
  assert.ok(absentFact.ambiguity_analysis.directly_ambiguous_pattern_ids.length === 0);
  assert.ok(absentFact.binding_analysis.directly_blocked_pattern_ids.includes(
    "operation-stability-fact"
  ));

  const preDispatch = evaluateVerificationProfile({
    contract,
    profile: stagedProfile,
    evaluation_input: evaluationInput({ resolver_facts: [resolverFact] })
  });
  assert.equal(preDispatch.satisfaction, "satisfied");
  assert.equal(
    preDispatch.pattern_results.find(
      ({ pattern_id }) => pattern_id === "verification-executed"
    ).status,
    "inactive"
  );

  const postDelivery = evaluateVerificationProfile({
    contract,
    profile: stagedProfile,
    evaluation_input: evaluationInput({
      evaluation_stage: "post_delivery",
      resolver_facts: [resolverFact],
      delivered_evidence: [
        {
          evidence_kind: "test-result",
          verification_claim_id: "claim-idempotency-verification",
          satisfied: true
        }
      ]
    })
  });
  assert.equal(postDelivery.satisfaction, "satisfied");

  const absentEvidence = evaluateVerificationProfile({
    contract,
    profile: stagedProfile,
    evaluation_input: evaluationInput({
      evaluation_stage: "post_delivery",
      resolver_facts: [resolverFact]
    })
  });
  assert.equal(absentEvidence.satisfaction, "indeterminate");
  assert.ok(absentEvidence.binding_analysis.directly_blocked_pattern_ids.includes(
    "verification-executed"
  ));

  const wrongVerification = structuredClone(contract);
  wrongVerification.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-idempotency-verification"
  ).verification_method = "audit";
  const definitivelyAbsentEvidence = evaluateVerificationProfile({
    contract: wrongVerification,
    profile: stagedProfile,
    evaluation_input: evaluationInput({
      evaluation_stage: "post_delivery",
      resolver_facts: [resolverFact]
    })
  });
  assert.equal(definitivelyAbsentEvidence.pattern_results.find(
    ({ pattern_id: patternId }) => patternId === "verification-executed"
  ).status, "unsatisfied");
  assert.equal(definitivelyAbsentEvidence.satisfaction, "unsatisfied");
});

test("unknown or duplicate explicit pattern bindings are invalid input", () => {
  const contract = directContract("payment");
  const unknown = evaluate(contract, evaluationInput({
    claim_pattern_bindings: [
      { pattern_id: "not-a-profile-pattern", claim_id: "claim-first-invocation" }
    ]
  }));
  assert.equal(unknown.satisfaction, "invalid");
  assert.equal(unknown.input_valid, false);

  const duplicate = evaluate(contract, evaluationInput({
    claim_pattern_bindings: [
      { pattern_id: "first-invocation", claim_id: "claim-first-invocation" },
      {
        pattern_id: "first-invocation",
        claim_id: "claim-first-invocation-duplicate"
      }
    ]
  }));
  assert.equal(duplicate.satisfaction, "invalid");
  assert.equal(duplicate.input_valid, false);

  const dangling = evaluate(contract, evaluationInput({
    claim_pattern_bindings: [
      { pattern_id: "first-invocation", claim_id: "claim-absent" }
    ]
  }));
  assert.equal(dangling.satisfaction, "indeterminate");
  assert.ok(dangling.binding_analysis.directly_blocked_pattern_ids.includes(
    "first-invocation"
  ));
});

test("unreachable stages and multi-valued subject roles invalidate a profile", () => {
  const contract = directContract("payment");
  const unreachable = structuredClone(profile);
  unreachable.evaluation_stages = ["post_delivery"];
  const unreachableResult = evaluateVerificationProfile({
    contract,
    profile: unreachable,
    evaluation_input: evaluationInput({ evaluation_stage: "post_delivery" })
  });
  assert.equal(unreachableResult.satisfaction, "invalid");
  assert.ok(unreachableResult.diagnostics.some(
    ({ code }) => code === "profile_pattern_stage_unreachable"
  ));

  const multiSubject = structuredClone(profile);
  multiSubject.reference_roles.find(({ role }) =>
    role === "first_invocation"
  ).cardinality = "one_or_more";
  const subjectResult = evaluateVerificationProfile({
    contract,
    profile: multiSubject,
    evaluation_input: evaluationInput()
  });
  assert.equal(subjectResult.satisfaction, "invalid");
  assert.ok(subjectResult.diagnostics.some(
    ({ code }) => code === "profile_subject_role_cardinality_invalid"
  ));
});

test("the local CLI evaluates files through the same pure profile engine", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "verification-profile-cli-"));
  const contractPath = path.join(directory, "contract.json");
  const inputPath = path.join(directory, "input.json");
  await Promise.all([
    writeFile(contractPath, `${JSON.stringify(directContract("payment"), null, 2)}\n`),
    writeFile(inputPath, `${JSON.stringify(evaluationInput(), null, 2)}\n`)
  ]);
  const result = await checkVerificationProfile({
    contractPath,
    profilePath,
    inputPath
  });
  assert.equal(result.evaluation.satisfaction, "satisfied");
  assert.equal(result.authority.authoritative, false);
  assert.equal(result.inputs.profile.sha256.length, 64);
  assert.deepEqual(parseCliArgs([
    "--contract", contractPath,
    "--profile", profilePath,
    "--input", inputPath
  ]), {
    contract: contractPath,
    profile: profilePath,
    input: inputPath,
    output: null,
    help: false
  });
  assert.match(cliUsage(), /performs no prose translation/i);
});
