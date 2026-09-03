import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROOF_GRAPH_PROPOSAL_FIELDS,
  PROOF_GRAPH_PROPOSAL_LIMITS,
  PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
  measureProofGraphProposalBytes,
  projectProofGraphProposal,
  validateProofGraphProposal
} from "../../lib/proof-graph-proposal-v1.mjs";
import {
  PROOF_GRAPH_CARRIER_ORDER,
  PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION,
  composeProofGraphCarrierSet
} from "../../lib/proof-graph-composition-v1.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "../proof-packs/refusal-before-effects-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../support/stable-v1-proof-pack-runtime.mjs";

const PACK = Object.freeze({
  profile_id: "proof.authorization.refusal-before-effects",
  profile_version: "2.0.0"
});
const INTENT = "controlled-proof-intent.refusal-before-effects";
const EVALUATION_INPUT_PATH = "WK-9001.evaluation-input.json";
const CONTINUATION = Object.freeze({
  schema_version: "controlled-contract-proof-authoring-continuation.v1",
  identity_digest: "d".repeat(64),
  contract_digest: `sha256:${"c".repeat(64)}`,
  package_version: "0.0.0-test"
});

function carrierDigest(value) {
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`, "utf8").digest("hex")}`;
}

function fixtureCarriers(options = {}) {
  const { contract, input } = buildRefusalBeforeEffectsFixture({
    verification_method: "analysis", ...options
  });
  return {
    contract,
    evaluation_input: input,
    proof_plan_request: {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [INTENT],
      selected_packs: [{ ...PACK, evaluation_input_path: EVALUATION_INPUT_PATH }]
    }
  };
}

function presentExpectations(sources) {
  return PROOF_GRAPH_CARRIER_ORDER
    .filter((kind) => Object.hasOwn(sources, kind))
    .map((kind) => ({
      carrier_kind: kind,
      presence: "present",
      expected_content_digest: carrierDigest(sources[kind])
    }));
}

function compose({
  proposal, sources = {}, expected_sources: expectedSources = presentExpectations(sources)
}) {
  return composeProofGraphCarrierSet({
    proposal, sources, expected_sources: expectedSources
  });
}

function proposalFor(sources, overrides = {}) {
  return {
    schema_version: PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION,
    wk_id: "WK-9001",
    focus: null,
    contract_content_digest: carrierDigest(sources.contract ?? {}),
    selected_pack: { ...PACK },
    requested_intents: [INTENT],
    skeleton_continuation: {
      continuation: { ...CONTINUATION },
      unresolved_required_roles: []
    },
    carrier_operations: [],
    ...overrides
  };
}

function annotationOperation(index) {
  return {
    kind: "carrier_patch",
    carrier_kind: "contract",
    op: "upsert",
    target: "annotations",
    value: {
      annotation_id: `ann-composed-${index}`,
      kind: "rationale",
      text: `composed annotation ${index}`
    }
  };
}

async function refusal(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return assert.fail("composition accepted an input it must refuse");
}

function refusalSync(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return assert.fail("the proposal accepted an input it must refuse");
}

test("the proposal projection carries the frozen key order the bound measures", () => {
  const sources = fixtureCarriers();
  const proposal = proposalFor(sources);
  const projection = projectProofGraphProposal(proposal);
  assert.deepEqual(Object.keys(projection), [...PROOF_GRAPH_PROPOSAL_FIELDS]);
  assert.deepEqual([...PROOF_GRAPH_PROPOSAL_FIELDS], [
    "schema_version", "wk_id", "focus", "contract_content_digest",
    "selected_pack", "requested_intents", "skeleton_continuation",
    "carrier_operations"
  ]);
  assert.equal(measureProofGraphProposalBytes(projection),
    Buffer.byteLength(JSON.stringify(projection), "utf8"));
  assert.equal(validateProofGraphProposal(proposal).projection_bytes,
    measureProofGraphProposalBytes(projection));
});

test("the proposal envelope is closed against unknown and missing fields", () => {
  const sources = fixtureCarriers();
  for (const [pointer, mutate] of [
    ["", (value) => { value.extra_field = 1; }],
    ["", (value) => { delete value.focus; }],
    ["/schema_version", (value) => { value.schema_version = "other.v1"; }],
    ["/wk_id", (value) => { value.wk_id = ""; }],
    ["/contract_content_digest", (value) => { value.contract_content_digest = "sha256:zz"; }],
    ["/selected_pack", (value) => { value.selected_pack = { ...PACK, extra: 1 }; }],
    ["/selected_pack/profile_version", (value) => { value.selected_pack = { profile_id: "p", profile_version: 2 }; }],
    ["/requested_intents", (value) => { value.requested_intents = "intent"; }],
    ["/requested_intents/1", (value) => { value.requested_intents = [INTENT, INTENT]; }],
    ["/skeleton_continuation", (value) => { value.skeleton_continuation = { continuation: {} }; }],
    ["/skeleton_continuation/continuation", (value) => { value.skeleton_continuation = { continuation: null, unresolved_required_roles: [] }; }],
    ["/skeleton_continuation/unresolved_required_roles", (value) => { value.skeleton_continuation = { continuation: {}, unresolved_required_roles: {} }; }],
    ["/carrier_operations", (value) => { value.carrier_operations = {}; }]
  ]) {
    const proposal = proposalFor(sources);
    mutate(proposal);
    const error = refusalSync(() => validateProofGraphProposal(proposal));
    assert.equal(error.code, "controlled_contract_proof_graph_proposal_invalid");
    assert.equal(error.details.pointer, pointer);
  }
});

test("carrier operations are closed and typed", () => {
  const sources = fixtureCarriers();
  for (const [pointer, operation] of [
    ["/carrier_operations/0/kind", { kind: "carrier_delete", carrier_kind: "contract" }],
    ["/carrier_operations/0/carrier_kind", { kind: "carrier_patch", carrier_kind: "proof_plan" }],
    ["/carrier_operations/0", { kind: "carrier_patch", carrier_kind: "contract", unexpected: 1 }],
    ["/carrier_operations/0", { kind: "verification_bundle", op: "upsert", verification_id: "claim-x" }],
    ["/carrier_operations/0", { kind: "verification_bundle", op: "upsert", verification_id: "claim-x", bundle: {}, target: "annotations" }]
  ]) {
    const proposal = proposalFor(sources, { carrier_operations: [operation] });
    const error = refusalSync(() => validateProofGraphProposal(proposal));
    assert.equal(error.code, "controlled_contract_proof_graph_proposal_invalid");
    assert.equal(error.details.pointer, pointer);
  }
});

test("the server-owned source declaration is closed and typed", async () => {
  const sources = fixtureCarriers();
  for (const [pointer, expectation] of [
    ["/expected_sources/0/carrier_kind", { carrier_kind: "proof_plan", presence: "absent", expected_content_digest: null }],
    ["/expected_sources/0/presence", { carrier_kind: "contract", presence: "maybe", expected_content_digest: null }],
    ["/expected_sources/0/expected_content_digest", { carrier_kind: "contract", presence: "present", expected_content_digest: null }],
    ["/expected_sources/0/expected_content_digest", { carrier_kind: "contract", presence: "absent", expected_content_digest: `sha256:${"a".repeat(64)}` }],
    ["/expected_sources/0", { carrier_kind: "contract", presence: "absent" }],
    ["/expected_sources/0", { carrier_kind: "contract", presence: "absent", expected_content_digest: null, extra: 1 }]
  ]) {
    const error = await refusal(() => compose({
      proposal: proposalFor(sources), sources, expected_sources: [expectation]
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_composition_input_invalid");
    assert.equal(error.details.pointer, pointer);
  }
  const duplicated = await refusal(() => compose({
    proposal: proposalFor(sources),
    sources,
    expected_sources: [
      { carrier_kind: "contract", presence: "absent", expected_content_digest: null },
      { carrier_kind: "contract", presence: "absent", expected_content_digest: null }
    ]
  }));
  assert.equal(duplicated.details.pointer, "/expected_sources/1/carrier_kind");

  const notAnArray = await refusal(() => compose({
    proposal: proposalFor(sources), sources, expected_sources: null
  }));
  assert.equal(notAnArray.details.pointer, "/expected_sources");
});

test("the operation bound admits 0, 1, and 64 and refuses 65", () => {
  const sources = fixtureCarriers();
  for (const count of [0, 1, 64]) {
    const proposal = proposalFor(sources, {
      carrier_operations: Array.from({ length: count }, (value, index) =>
        annotationOperation(index))
    });
    assert.equal(validateProofGraphProposal(proposal).operation_count, count);
  }
  const proposal = proposalFor(sources, {
    carrier_operations: Array.from({ length: 65 }, (value, index) =>
      annotationOperation(index))
  });
  const error = refusalSync(() => validateProofGraphProposal(proposal));
  assert.equal(error.code, "controlled_contract_proof_graph_bound_exceeded");
  assert.equal(error.details.bound, "carrier_operations");
  assert.equal(error.details.minimum, 0);
  assert.equal(error.details.maximum, PROOF_GRAPH_PROPOSAL_LIMITS.carrier_operations);
  assert.equal(error.details.actual, 65);
});

test("both bounds are measured before any candidate operation detail exists", () => {
  const sources = fixtureCarriers();

  const proposal = proposalFor(sources, {
    carrier_operations: Array.from({ length: 65 }, () => ({ kind: "nonsense" }))
  });
  assert.equal(refusalSync(() => validateProofGraphProposal(proposal)).code,
    "controlled_contract_proof_graph_bound_exceeded");
});

test("the byte bound admits exactly 1,048,576 bytes and refuses one byte more", () => {
  const sources = fixtureCarriers();
  const build = (target) => {
    const operation = annotationOperation(0);
    const proposal = proposalFor(sources, { carrier_operations: [operation] });
    const measure = () => measureProofGraphProposalBytes(
      projectProofGraphProposal(proposal));
    let padding = 0;
    for (let attempt = 0; attempt < 8 && measure() !== target; attempt += 1) {
      padding += target - measure();
      operation.value.text = "x".repeat(Math.max(0, padding));
    }
    assert.equal(measure(), target);
    return proposal;
  };
  const atBound = build(PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes);
  assert.equal(validateProofGraphProposal(atBound).projection_bytes,
    PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes);

  const aboveBound = build(PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes + 1);
  const error = refusalSync(() => validateProofGraphProposal(aboveBound));
  assert.equal(error.code, "controlled_contract_proof_graph_bound_exceeded");
  assert.equal(error.details.bound, "projection_bytes");
  assert.equal(error.details.maximum, PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes);
  assert.equal(error.details.actual,
    PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes + 1);
});

test("the proposal byte bound never widens the primitive request limit", async () => {
  const sources = fixtureCarriers();
  const operation = annotationOperation(0);
  const proposal = proposalFor(sources, { carrier_operations: [operation] });
  operation.value.text = "x".repeat(70000);
  const admitted = validateProofGraphProposal(proposal);
  assert.ok(admitted.projection_bytes <
    PROOF_GRAPH_PROPOSAL_LIMITS.projection_bytes);

  const error = await refusal(() => compose({
    proposal, sources
  }));
  assert.equal(error.code, "controlled_contract_patch_request_too_large");
  assert.ok(error.details.byte_length > 65536);
});

test("an unchanged present carrier set composes as an idempotent no-op", async () => {
  const sources = fixtureCarriers();
  const proposal = proposalFor(sources);
  const result = await compose({ proposal, sources });

  assert.equal(result.schema_version, PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION);
  assert.equal(result.status, "composed");
  assert.equal(result.reason_code, null);
  assert.equal(result.no_op, true);
  assert.equal(result.counts.carrier_operations, 0);
  assert.equal(result.counts.prospective_carriers, 3);
  assert.equal(result.counts.changed_carriers, 0);
  assert.deepEqual(result.delegated_validations, [
    "validateAndResolveNativeContractV1",
    "validateSuppliedProofPackBindings",
    "buildProofPlan"
  ]);
  assert.deepEqual(result.carriers.map(({ carrier_kind: kind }) => kind),
    [...PROOF_GRAPH_CARRIER_ORDER]);
  assert.deepEqual(result.manifest_inputs.map(({ carrier_kind: kind }) => kind),
    [...PROOF_GRAPH_CARRIER_ORDER]);
  assert.match(result.proof_plan_digest, /^sha256:[0-9a-f]{64}$/u);

  assert.equal(result.counts.selected_packs, 1);
  assert.deepEqual(result.proof_plan_derivation, {
    status: "derived",
    derived_from_evaluation_input_paths: [EVALUATION_INPUT_PATH],
    unavailable_selected_packs: []
  });
  assert.deepEqual(result.requested_intents, [INTENT]);
  assert.equal(result.focus, null);
  assert.equal(result.authority, "non_authoritative");
  assert.equal(result.carriers_written, false);
  assert.equal(result.semantics_chosen, false);
  assert.equal(result.proof_claimed, false);
  assert.equal(result.dispatch_authorized, false);

  const repeated = await compose({ proposal, sources });
  assert.deepEqual(repeated.carriers.map(({ content_digest: digest }) => digest),
    result.carriers.map(({ content_digest: digest }) => digest));
  assert.equal(repeated.proof_plan_digest, result.proof_plan_digest);
});

test("the composed result is deeply immutable and compact", async () => {
  const sources = fixtureCarriers();
  const result = await compose({
    proposal: proposalFor(sources), sources
  });
  assert.deepEqual(Object.keys(result), [
    "schema_version", "status", "reason_code", "wk_id", "focus", "selected_pack",
    "requested_intents", "contract_content_digest", "proposal_operation_count",
    "proposal_projection_bytes", "permitted_cross_carrier_join", "counts",
    "carriers", "manifest_inputs", "cross_carrier_bindings",
    "delegated_validations", "proof_plan_digest", "proof_plan_derivation",
    "unresolved_pointers", "no_op", "authority", "carriers_written",
    "semantics_chosen", "proof_claimed", "dispatch_authorized"
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.proof_plan_derivation), true);
  assert.equal(Object.isFrozen(result.carriers), true);
  assert.equal(Object.isFrozen(result.carriers[0]), true);
  assert.equal(Object.isFrozen(result.carriers[0].content), true);
  assert.equal(Object.isFrozen(result.cross_carrier_bindings[0]
    .evaluation_input_pointers), true);
  assert.throws(() => { result.carriers[0].content.references = []; }, TypeError);
  assert.throws(() => { result.carriers.push({}); }, TypeError);

  for (const entry of result.manifest_inputs) {
    assert.deepEqual(Object.keys(entry),
      ["carrier_kind", "presence_before", "content_digest", "byte_length"]);
  }
  for (const binding of result.cross_carrier_bindings) {
    assert.deepEqual(Object.keys(binding), [
      "semantic_key", "reference_id", "type_term", "identity_kind",
      "contract_pointer", "evaluation_input_pointers"
    ]);
  }
});

test("composition mutates none of the carriers or the proposal it is given", async () => {
  const sources = fixtureCarriers();
  const proposal = proposalFor(sources, {
    carrier_operations: [annotationOperation(0)]
  });
  const sourceBefore = JSON.stringify(sources);
  const proposalBefore = JSON.stringify(proposal);
  const result = await compose({ proposal, sources });
  assert.equal(JSON.stringify(sources), sourceBefore);
  assert.equal(JSON.stringify(proposal), proposalBefore);
  assert.equal(result.no_op, false);
});

test("one composed operation changes exactly its carrier and its digest", async () => {
  const sources = fixtureCarriers();
  const proposal = proposalFor(sources, {
    carrier_operations: [annotationOperation(0)]
  });
  const result = await compose({ proposal, sources });
  assert.equal(result.counts.carrier_operations, 1);
  assert.equal(result.counts.carrier_patch_operations, 1);
  assert.equal(result.counts.verification_bundle_operations, 0);
  assert.equal(result.counts.changed_carriers, 1);
  assert.equal(result.no_op, false);

  const contract = result.carriers.find(
    ({ carrier_kind: kind }) => kind === "contract");
  assert.equal(contract.changed, true);
  assert.notEqual(contract.content_digest, contract.prior_content_digest);
  assert.deepEqual(contract.content.annotations.at(-1),
    proposal.carrier_operations[0].value);
  assert.deepEqual(JSON.parse(contract.canonical_bytes), contract.content);
  assert.equal(contract.byte_length,
    Buffer.byteLength(contract.canonical_bytes, "utf8"));
  assert.equal(contract.content_digest, `sha256:${createHash("sha256")
    .update(contract.canonical_bytes, "utf8").digest("hex")}`);
  for (const other of result.carriers.filter(
    ({ carrier_kind: kind }) => kind !== "contract")) {
    assert.equal(other.changed, false);
  }
});

test("sixty-four composed operations compose in one request per carrier", async () => {
  const sources = fixtureCarriers();
  const proposal = proposalFor(sources, {
    carrier_operations: Array.from({ length: 64 }, (value, index) =>
      annotationOperation(index))
  });
  const result = await compose({ proposal, sources });
  assert.equal(result.counts.carrier_operations, 64);
  const contract = result.carriers.find(
    ({ carrier_kind: kind }) => kind === "contract");
  assert.equal(contract.content.annotations.length, 64);
});

test("an absent carrier is created and its exact replay is an idempotent no-op",
  async () => {
    const complete = fixtureCarriers();
    const sources = {
      contract: complete.contract,
      evaluation_input: complete.evaluation_input
    };
    const carrierOperations = [
      { kind: "carrier_patch", carrier_kind: "proof_plan_request", op: "upsert",
        target: "requested_intents", value: INTENT },
      { kind: "carrier_patch", carrier_kind: "proof_plan_request", op: "upsert",
        target: "selected_packs",
        value: { ...PACK, evaluation_input_path: EVALUATION_INPUT_PATH } }
    ];
    const proposal = proposalFor(sources, {
      carrier_operations: carrierOperations
    });
    const created = await compose({
      proposal,
      sources,
      expected_sources: [
        ...presentExpectations(sources),
        { carrier_kind: "proof_plan_request", presence: "absent",
          expected_content_digest: null }
      ]
    });
    assert.equal(created.status, "composed");
    assert.equal(created.no_op, false);
    const request = created.carriers.find(
      ({ carrier_kind: kind }) => kind === "proof_plan_request");
    assert.equal(request.presence_before, "absent");
    assert.equal(request.prior_content_digest, null);
    assert.equal(request.changed, true);
    assert.deepEqual(request.content.requested_intents, [INTENT]);
    assert.deepEqual(request.content.selected_packs, [{
      ...PACK, evaluation_input_path: EVALUATION_INPUT_PATH
    }]);

    const replaySources = { ...sources, proof_plan_request: request.content };
    const replay = await compose({
      proposal: proposalFor(replaySources, {
        carrier_operations: carrierOperations
      }),
      sources: replaySources
    });
    assert.equal(replay.status, "composed");
    assert.equal(replay.no_op, true);
    assert.equal(replay.counts.changed_carriers, 0);
    assert.deepEqual(replay.carriers.map(({ content_digest: digest }) => digest),
      created.carriers.map(({ content_digest: digest }) => digest));
  });

const OTHER_PACK = Object.freeze({
  profile_id: "proof.result-shape.conformance",
  profile_version: "2.0.0"
});
const OTHER_INTENT = "controlled-proof-intent.result-shape-conformance";
const OTHER_EVALUATION_INPUT_PATH = "WK-9001-shape.evaluation-input.json";

const EVALUATION_INPUT_ONLY_ROLE = "protected_interval";

function withoutCarriers(result) {
  return JSON.stringify({
    ...result, carriers: [], manifest_inputs: [], cross_carrier_bindings: []
  });
}

test("focused authoring preserves the focus identity and composes identically",
  async () => {
    const sources = fixtureCarriers();
    const root = await compose({
      proposal: proposalFor(sources), sources
    });
    const focused = await compose({
      proposal: proposalFor(sources, { focus: "authoring-slice" }), sources
    });
    assert.equal(root.focus, null);
    assert.equal(focused.focus, "authoring-slice");
    assert.equal(focused.status, "composed");

    assert.deepEqual(focused.carriers.map(({ content_digest: digest }) => digest),
      root.carriers.map(({ content_digest: digest }) => digest));
    assert.equal(focused.proof_plan_digest, root.proof_plan_digest);
    assert.deepEqual(focused.proof_plan_derivation, root.proof_plan_derivation);
  });

test("an existing multi-pack request keeps its whole population and intent union",
  async () => {
    const sources = fixtureCarriers();
    sources.evaluation_input.stable_evaluation = { associations: [] };
    sources.proof_plan_request = {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [OTHER_INTENT, INTENT],
      selected_packs: [
        { ...PACK, evaluation_input_path: EVALUATION_INPUT_PATH },
        { ...OTHER_PACK, evaluation_input_path: OTHER_EVALUATION_INPUT_PATH }
      ]
    };

    const result = await compose({
      proposal: proposalFor(sources), sources
    });
    assert.equal(result.status, "composed");

    assert.deepEqual(result.requested_intents, [INTENT, OTHER_INTENT].sort());
    assert.equal(result.counts.selected_packs, 2);

    const request = result.carriers.find(
      ({ carrier_kind: kind }) => kind === "proof_plan_request");
    assert.equal(request.changed, false);
    assert.deepEqual(request.content.selected_packs.map((pack) =>
      [pack.profile_id, pack.profile_version, pack.evaluation_input_path]), [
      [PACK.profile_id, PACK.profile_version, EVALUATION_INPUT_PATH],
      [OTHER_PACK.profile_id, OTHER_PACK.profile_version,
        OTHER_EVALUATION_INPUT_PATH]
    ]);
    assert.deepEqual(request.content.requested_intents, [OTHER_INTENT, INTENT]);

    assert.equal(result.proof_plan_digest, null);
    assert.deepEqual(result.proof_plan_derivation, {
      status: "selected_pack_evaluation_input_outside_carrier_set",
      derived_from_evaluation_input_paths: [EVALUATION_INPUT_PATH],
      unavailable_selected_packs: [{
        profile_id: OTHER_PACK.profile_id,
        profile_version: OTHER_PACK.profile_version,
        evaluation_input_path: OTHER_EVALUATION_INPUT_PATH
      }]
    });
    assert.equal(result.delegated_validations.includes("buildProofPlan"), false);
    assert.deepEqual(result.delegated_validations, [
      "validateAndResolveNativeContractV1", "validateSuppliedProofPackBindings"
    ]);

    const evaluationInput = result.carriers.find(
      ({ carrier_kind: kind }) => kind === "evaluation_input");
    assert.equal(evaluationInput.changed, false);
    assert.deepEqual(evaluationInput.content.stable_evaluation,
      { associations: [] });
  });

test("the composed result restates the chosen semantics nowhere but its carrier",
  async () => {
    const sources = fixtureCarriers();
    assert.ok(JSON.stringify(sources.evaluation_input)
      .includes(EVALUATION_INPUT_ONLY_ROLE));
    const result = await compose({
      proposal: proposalFor(sources), sources
    });

    assert.equal(withoutCarriers(result).includes(EVALUATION_INPUT_ONLY_ROLE),
      false);
    for (const field of [
      "expected_sources", "carrier_operations", "sources", "evaluation_input",
      "proposal", "skeleton_continuation", "recovery", "proof_pack_authoring"
    ]) assert.equal(Object.hasOwn(result, field), false, field);
    assert.equal(result.carriers.filter(({ carrier_kind: kind }) =>
      kind === "evaluation_input").length, 1);
  });

test("an unresolved selected-pack role stops the proposal before composition",
  async () => {
    const sources = fixtureCarriers();
    const proposal = proposalFor(sources, {
      skeleton_continuation: {
        continuation: { ...CONTINUATION },
        unresolved_required_roles: [
          { role: "protected_effects", status: "unbound" }
        ]
      },
      carrier_operations: [annotationOperation(0)]
    });
    const result = await compose({ proposal, sources });
    assert.equal(result.status, "incomplete");
    assert.equal(result.reason_code,
      "controlled_contract_proof_graph_proposal_incomplete");
    assert.deepEqual(result.unresolved_pointers, [{
      carrier_kind: null,
      pointer: "/skeleton_continuation/unresolved_required_roles/0",
      reason: "selected_pack_required_role_unresolved",
      role: "protected_effects"
    }]);
    assert.deepEqual(result.carriers, []);
    assert.deepEqual(result.manifest_inputs, []);
    assert.equal(result.proof_plan_digest, null);
    assert.equal(result.no_op, false);
  });

test("an addressed carrier with no declared source expectation is unresolved",
  async () => {
    const sources = fixtureCarriers();
    const proposal = proposalFor(sources, {
      carrier_operations: [annotationOperation(0)]
    });
    const result = await compose({
      proposal,
      sources: {
        evaluation_input: sources.evaluation_input,
        proof_plan_request: sources.proof_plan_request
      }
    });
    assert.equal(result.status, "incomplete");
    assert.equal(result.unresolved_pointers.length, 1);
    assert.deepEqual(result.unresolved_pointers[0], {
      addressed_carrier_kind: "contract",
      carrier_kind: null,
      pointer: "/carrier_operations/0/carrier_kind",
      reason: "addressed_carrier_source_expectation_missing"
    });
  });

test("a created evaluation input without a chosen stage is unresolved", async () => {
  const sources = { contract: fixtureCarriers().contract };
  const proposal = proposalFor(sources, {
    carrier_operations: [{
      kind: "carrier_patch", carrier_kind: "evaluation_input", op: "upsert",
      target: "reference_bindings",
      value: { role: "subject", reference_ids: ["ref-subject"] }
    }]
  });
  const result = await compose({
    proposal,
    sources,
    expected_sources: [
      ...presentExpectations(sources),
      { carrier_kind: "evaluation_input", presence: "absent",
        expected_content_digest: null }
    ]
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.unresolved_pointers, [{
    carrier_kind: "evaluation_input",
    pointer: "/evaluation_stage",
    reason: "evaluation_stage_unresolved"
  }]);
});

test("a request that binds no evaluation-input path for the selected pack is unresolved",
  async () => {
    const sources = fixtureCarriers();
    sources.proof_plan_request = {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [INTENT],
      selected_packs: [{ ...PACK }]
    };
    const result = await compose({
      proposal: proposalFor(sources), sources
    });
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.unresolved_pointers, [{
      carrier_kind: "proof_plan_request",
      pointer: "/selected_packs",
      reason: "selected_pack_evaluation_input_path_unresolved"
    }]);
  });

test("every present and absent source expectation is enforced before composition",
  async () => {
    const sources = fixtureCarriers();
    const proposal = proposalFor(sources);

    const stale = presentExpectations(sources);
    stale[0].expected_content_digest = `sha256:${"a".repeat(64)}`;
    let error = await refusal(() => compose({
      proposal, sources, expected_sources: stale
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_source_expectation_mismatch");
    assert.equal(error.details.reason, "expected_present_source_digest_mismatch");
    assert.equal(error.details.pointer, "/expected_sources/0");

    error = await refusal(() => compose({
      proposal,
      sources: { evaluation_input: sources.evaluation_input,
        proof_plan_request: sources.proof_plan_request },
      expected_sources: presentExpectations(sources)
    }));
    assert.equal(error.details.reason, "expected_present_source_absent");

    error = await refusal(() => compose({
      proposal,
      sources,
      expected_sources: [
        { carrier_kind: "contract", presence: "absent",
          expected_content_digest: null },
        ...presentExpectations({
          evaluation_input: sources.evaluation_input,
          proof_plan_request: sources.proof_plan_request
        })
      ]
    }));
    assert.equal(error.details.reason, "expected_absent_source_present");

    error = await refusal(() => compose({
      proposal,
      sources,
      expected_sources: presentExpectations({
        contract: sources.contract,
        evaluation_input: sources.evaluation_input
      })
    }));
    assert.equal(error.details.reason, "supplied_source_without_expectation");
    assert.equal(error.details.pointer, "/sources/proof_plan_request");
  });

test("a compatible repeated reference identity collapses with ordered provenance",
  async () => {

    const sources = fixtureCarriers({
      mutate_input: (input) => {
        input.reference_bindings.find(
          ({ role }) => role === "protected_interval"
        ).reference_ids = ["ref-attempt"];
      }
    });
    const result = await compose({
      proposal: proposalFor(sources), sources
    });
    const repeated = result.cross_carrier_bindings.find(
      ({ reference_id: id }) => id === "ref-attempt");
    assert.equal(repeated.evaluation_input_pointers.length, 2);
    const [first, second] = repeated.evaluation_input_pointers;
    const bindingIndex = (pointer) =>
      Number(pointer.split("/")[2]);
    assert.match(first, /^\/reference_bindings\/\d+\/reference_ids\/0$/u);
    assert.match(second, /^\/reference_bindings\/\d+\/reference_ids\/0$/u);
    assert.ok(bindingIndex(first) < bindingIndex(second));
    assert.equal(repeated.contract_pointer.startsWith("/references/"), true);
    assert.equal(repeated.type_term, "cc:event");
    assert.equal(result.counts.cross_carrier_provenance_pointers,
      result.cross_carrier_bindings.reduce(
        (total, binding) => total + binding.evaluation_input_pointers.length, 0));
    assert.ok(result.counts.cross_carrier_provenance_pointers >
      result.counts.cross_carrier_bindings);
    const keys = result.cross_carrier_bindings.map(
      ({ semantic_key: key }) => key);
    assert.deepEqual(keys, [...keys].sort());
  });

test("a missing contract reference refuses at its exact evaluation-input pointer",
  async () => {
    const sources = fixtureCarriers({
      mutate_input: (input) => {
        input.reference_bindings.find(({ role }) => role === "protected_effects")
          .reference_ids.push("ref-absent-from-contract");
      }
    });
    const error = await refusal(() => compose({
      proposal: proposalFor(sources), sources
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_cross_carrier_identity_conflict");
    assert.equal(error.details.carrier_kind, "evaluation_input");
    assert.equal(error.details.reason, "contract_reference_missing");
    assert.equal(error.details.reference_id, "ref-absent-from-contract");
    assert.match(error.details.pointer,
      /^\/reference_bindings\/\d+\/reference_ids\/2$/u);
  });

test("an incompatible repeated contract identity refuses at the joined pointer",
  async () => {
    const sources = fixtureCarriers({
      mutate_contract: (contract) => {
        contract.references.push({
          reference_id: "ref-protected-channel",
          type_term: "cc:state",
          identity: { kind: "durable_id", domain: "WK-9001", value: "other" }
        });
      }
    });
    const error = await refusal(() => compose({
      proposal: proposalFor(sources), sources
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_cross_carrier_identity_conflict");
    assert.equal(error.details.reason,
      "contract_reference_identity_incompatible");
    assert.equal(error.details.contract_pointers.length, 2);
  });

test("any other proposed semantic carrier join refuses as unowned", async () => {
  const sources = fixtureCarriers();
  for (const [target, joinField, value] of [
    ["resolver_facts", "argument_reference_ids", {
      resolver_kind: "repository", fact_key: "fact-one",
      argument_reference_ids: ["ref-subject"]
    }],
    ["claim_pattern_bindings", "claim_id", {
      pattern_id: "attempt-performs-operation",
      claim_id: "claim-attempt-performs-operation"
    }],
    ["delivered_evidence", "verification_claim_id", {
      evidence_kind: "trace", verification_claim_id: "claim-verification"
    }]
  ]) {
    const proposal = proposalFor(sources, {
      carrier_operations: [{
        kind: "carrier_patch", carrier_kind: "evaluation_input", op: "upsert",
        target, value
      }]
    });
    const error = await refusal(() => compose({
      proposal, sources
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_cross_carrier_identity_conflict");
    assert.equal(error.details.reason, "unowned_semantic_carrier_join");
    assert.equal(error.details.pointer, `/${target}/0/${joinField}`);
    assert.equal(error.details.proposal_pointer, "/carrier_operations/0");
  }
});

test("an unowned proposed join refuses with no declared contract source",
  async () => {
    const complete = fixtureCarriers();
    const operation = {
      kind: "carrier_patch", carrier_kind: "evaluation_input", op: "upsert",
      target: "resolver_facts",
      value: {
        resolver_kind: "repository", fact_key: "fact-one",
        argument_reference_ids: ["ref-subject"]
      }
    };
    const subset = { evaluation_input: complete.evaluation_input };
    const withoutContract = await refusal(() => compose({
      proposal: proposalFor(subset, { carrier_operations: [operation] }),
      sources: subset
    }));
    const withContract = await refusal(() => compose({
      proposal: proposalFor(complete, { carrier_operations: [operation] }),
      sources: complete
    }));

    assert.equal(withoutContract.code,
      "controlled_contract_proof_graph_cross_carrier_identity_conflict");
    assert.equal(withoutContract.details.carrier_kind, "evaluation_input");
    assert.equal(withoutContract.details.reason, "unowned_semantic_carrier_join");
    assert.equal(withoutContract.details.pointer,
      "/resolver_facts/0/argument_reference_ids");
    assert.equal(withoutContract.details.proposal_pointer, "/carrier_operations/0");
    assert.deepEqual(withoutContract.details, withContract.details);
  });

test("an evaluation-input reference identity with no contract source is unresolved",
  async () => {
    const complete = fixtureCarriers();
    const sources = { evaluation_input: complete.evaluation_input };
    const expected = complete.evaluation_input.reference_bindings.flatMap(
      ({ reference_ids: ids }, bindingIndex) => ids.map((value, memberIndex) =>
        `/reference_bindings/${bindingIndex}/reference_ids/${memberIndex}`));
    assert.ok(expected.length > 0);
    const result = await compose({
      proposal: proposalFor(sources), sources
    });

    assert.equal(result.status, "incomplete");
    assert.equal(result.reason_code,
      "controlled_contract_proof_graph_proposal_incomplete");
    assert.deepEqual(result.unresolved_pointers.map(({ pointer }) => pointer),
      expected);
    for (const entry of result.unresolved_pointers) {
      assert.equal(entry.carrier_kind, "evaluation_input");
      assert.equal(entry.reason,
        "reference_identity_contract_source_expectation_missing");
    }
    assert.equal(result.counts.unresolved_pointers, expected.length);
    assert.equal(result.counts.cross_carrier_bindings, 0);
    assert.deepEqual(result.carriers, []);
    assert.deepEqual(result.delegated_validations, []);

    const composed = await compose({
      proposal: proposalFor(complete), sources: complete
    });
    assert.equal(composed.status, "composed");
    assert.deepEqual(composed.unresolved_pointers, []);
  });

test("an invalid prospective contract is refused by the native validator", async () => {
  const sources = fixtureCarriers({
    mutate_contract: (contract) => {
      contract.propositions.push({
        proposition_id: "prop-dangling-subject",
        subject_reference_id: "ref-nowhere",
        operator: "reference:equals",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-subject" }]
      });
    }
  });
  const error = await refusal(() => compose({
    proposal: proposalFor(sources), sources
  }));
  assert.equal(error.code,
    "controlled_contract_proof_graph_prospective_carrier_invalid");
  assert.equal(error.details.owner, "validateAndResolveNativeContractV1");
  assert.ok(error.details.diagnostics.length > 0);
});

test("an unauthorized pack binding is refused by the binding validator", async () => {
  const sources = fixtureCarriers({
    mutate_input: (input) => {
      input.reference_bindings.find(({ role }) => role === "attempt")
        .reference_ids = ["ref-subject"];
    }
  });
  const error = await refusal(() => compose({
    proposal: proposalFor(sources), sources
  }));
  assert.equal(error.code,
    "controlled_contract_proof_graph_prospective_carrier_invalid");
  assert.equal(error.details.owner, "validateSuppliedProofPackBindings");
  assert.equal(error.details.cause_code, "proof_pack_binding_summary_not_valid");
});

test("an unassignable prospective request is refused by the proof-plan compiler",
  async () => {
    const sources = fixtureCarriers();
    sources.proof_plan_request = {
      ...sources.proof_plan_request, requested_intents: []
    };
    const error = await refusal(() => compose({
      proposal: proposalFor(sources), sources
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_prospective_carrier_invalid");
    assert.equal(error.details.owner, "buildProofPlan");
    assert.equal(error.details.cause_code, "proof_plan_request_selection_incomplete");
  });

test("a test_execution graph is routed to the verification-bundle owner alone",
  async () => {
    const sources = fixtureCarriers({ verification_method: "test_execution" });
    sources.contract.test_proofs = buildStableTestProofPopulation(sources.contract);
    const verification = sources.contract.claims.find(
      ({ kind, verification_method: method }) =>
        kind === "verification" && method === "test_execution");
    const proof = sources.contract.test_proofs.find(
      ({ verification_claim_id: id }) => id === verification.claim_id);
    const bundle = {
      schema_version: "controlled-contract-verification-bundle.v1",
      verification_id: verification.claim_id,
      references: [], propositions: [], claims: [structuredClone(verification)],
      relations: [], collections: [], residue: [], annotations: [],
      test_proof: structuredClone(proof)
    };
    const proposal = proposalFor(sources, {
      carrier_operations: [{
        kind: "verification_bundle", op: "upsert",
        verification_id: verification.claim_id, bundle
      }]
    });
    const result = await compose({ proposal, sources });
    assert.equal(result.status, "composed");
    assert.equal(result.counts.verification_bundle_operations, 1);
    assert.equal(result.counts.carrier_patch_operations, 0);
    assert.equal(result.no_op, true);

    const divergent = proposalFor(sources, {
      carrier_operations: [{
        kind: "verification_bundle", op: "upsert",
        verification_id: verification.claim_id,
        bundle: {
          ...bundle,
          claims: [{ ...verification, modality: "SHOULD" }]
        }
      }]
    });
    const error = await refusal(() => compose({
      proposal: divergent, sources
    }));
    assert.match(error.code, /^stable_verification_bundle_/u);
  });

test("the published proof-graph declarations and the runtime exports agree",
  async () => {
    const declared = new Set([...(await readFile(
      new URL("../../current-proof-graph.d.mts", import.meta.url), "utf8"
    )).matchAll(
      /^export (?:declare )?(?:const|function|class) ([A-Za-z0-9_]+)/gmu
    )].map(([, name]) => name));
    const publicSurface = new Set(Object.keys(await import("../../current.mjs")));

    for (const name of declared) {
      assert.equal(publicSurface.has(name), true, name);
    }

    const publicName = {
      PERMITTED_CROSS_CARRIER_JOIN: "PROOF_GRAPH_PERMITTED_CROSS_CARRIER_JOIN",
      FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS:
        "PROOF_GRAPH_FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS"
    };
    for (const modulePath of [
      "../../lib/proof-graph-proposal-v1.mjs",
      "../../lib/proof-graph-composition-v1.mjs"
    ]) {
      for (const name of Object.keys(await import(modulePath))) {
        assert.equal(declared.has(publicName[name] ?? name), true,
          `${modulePath}:${name}`);
      }
    }
  });

test("the proposal and composition modules perform no filesystem or network work",
  async () => {
    for (const module of [
      "carrier-patch-v1.mjs",
      "proof-graph-proposal-v1.mjs",
      "proof-graph-composition-v1.mjs"
    ]) {
      const source = await readFile(
        new URL(`../../lib/${module}`, import.meta.url), "utf8");
      for (const effect of [
        "node:fs", "node:http", "node:https", "node:net", "node:dgram",
        "node:dns", "node:child_process", "node:worker_threads", "fetch("
      ]) assert.equal(source.includes(effect), false, `${module}:${effect}`);
    }
  });

test("the composition entry point is closed against unsupported request fields",
  async () => {
    const sources = fixtureCarriers();
    let error = await refusal(() => composeProofGraphCarrierSet({
      proposal: proposalFor(sources),
      sources,
      expected_sources: presentExpectations(sources),
      extra: true
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_composition_input_invalid");
    assert.equal(error.details.pointer, "");

    error = await refusal(() => composeProofGraphCarrierSet({
      proposal: proposalFor(sources), sources
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_composition_input_invalid");
    assert.equal(error.details.pointer, "/expected_sources");
    error = await refusal(() => compose({
      proposal: proposalFor(sources), sources: { proof_plan: {} }
    }));
    assert.equal(error.code,
      "controlled_contract_proof_graph_composition_input_invalid");
    assert.deepEqual(error.details.unknown, ["proof_plan"]);
  });
