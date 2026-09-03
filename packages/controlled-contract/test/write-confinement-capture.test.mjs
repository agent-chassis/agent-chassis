import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES,
  WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_PROFILE_ID,
  WRITE_CONFINEMENT_PROFILE_VERSION,
  canonicalWriteConfinementEvaluationInputJson,
  mapWriteConfinementCapture
} from "../lib/write-confinement-capture.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { evaluateVerificationProfileV1 } from "../current.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const CODES = WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES;
const pack = await loadAdmittedProofPack(WRITE_CONFINEMENT_PROFILE_ID);

const SOURCE_DIGEST = `sha256:${"a".repeat(64)}`;
const RESULT_DIGEST = `sha256:${"e".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"f".repeat(64)}`;

function evidenceFor({
  changed = ["src/a.mjs", "src/b.mjs"],
  outside = [],
  writeScope = ["src"],
  overrides = {}
} = {}) {
  const outsideSet = new Set(outside);
  const inside = changed.filter((entry) => !outsideSet.has(entry));
  return {
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    authority: "authenticated_observation_only",
    observation_boundary: "base_to_delivery_tree_delta",
    not_covered: ["transient_worktree_state", "causal_attribution"],
    repository: "/srv/agent-chassis",
    run_id: "wkdb_6a3c707d1f9b4999",
    attempt: 0,
    record_id: "WK-2103",
    unit_address: "WK-2103#SLICE-001",
    selected_unit: {
      kind: "slice",
      address: "WK-2103#SLICE-001",
      record_id: "WK-2103",
      slice_id: "SLICE-001",
      repo: null
    },
    frozen_write_scope: writeScope,
    base_commit: "b".repeat(40),
    delivery_commit: "c".repeat(40),
    delivery_tree: "d".repeat(40),
    contained: outside.length === 0,
    changed_paths: changed,
    outside_write_scope_paths: outside,
    inside_write_scope_paths: inside,
    changed_path_count: changed.length,
    outside_write_scope_path_count: outside.length,
    inside_write_scope_path_count: inside.length,
    populations_complete: true,
    source_digest: SOURCE_DIGEST,
    result_digest: RESULT_DIGEST,
    observed_at: "2026-08-18T09:15:22.481Z",
    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    closure_effect: "none",
    proof_pack_applicability: "none",
    cce_effect: "none",
    semantic_judgment: "not_performed_coordinator_owned",
    ...overrides
  };
}

function envelopeFor(evidence, overrides = {}) {
  return {
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    projected: true,
    evidence,
    evidence_digest: EVIDENCE_DIGEST,
    state_changed: false,
    authority: "authenticated_observation_only",
    refusal: null,
    ...overrides
  };
}

const projectionFor = (options) => envelopeFor(evidenceFor(options));

function bindingFor(result, role) {
  return result.evaluation_input.reference_bindings.find((entry) => entry.role === role);
}

function referenceFor(result, referenceId) {
  return result.references.find((entry) => entry.reference_id === referenceId);
}

async function mapOrThrow(projection) {
  const result = await mapWriteConfinementCapture({ projection });
  assert.equal(result.mapped, true, JSON.stringify(result.refusal));
  return result;
}

const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_reference_ids: [] });

function contractFor(result) {
  const one = (role) => bindingFor(result, role).reference_ids[0];
  const propositions = [];
  const claims = [];
  const add = (id, subject, operator, operands) => {
    propositions.push({
      proposition_id: `prop-${id}`,
      subject_reference_id: subject,
      operator,
      applicability_context: UNCONDITIONAL,
      operands
    });
    claims.push({
      claim_id: `claim-${id}`,
      kind: "behavior",
      modality: "MUST",
      proposition_id: `prop-${id}`
    });
  };
  for (const [populationRole, memberRole, slug] of [
    ["observed_population", "observed_mutations", "observed"],
    ["authorized_scope", "authorized_targets", "authorized"]
  ]) {
    const members = bindingFor(result, memberRole).reference_ids;
    if (members.length > 0) {
      add(`${slug}-contains`, one(populationRole), "reference:contains",
        members.map((referenceId) => ({ kind: "reference", reference_id: referenceId })));
    }
    add(`${slug}-cardinality`, one(populationRole), "number:has_cardinality",
      [{ kind: "number", value: members.length }]);
  }
  propositions.push({
    proposition_id: "prop-falsifier",
    subject_reference_id: one("observed_population"),
    operator: "reference:not_subset_of",
    applicability_context: {
      mode: "when",
      operand_reference_ids: [one("unauthorized_mutation_condition")]
    },
    operands: [{ kind: "reference", reference_id: one("authorized_scope") }]
  });
  propositions.push({
    proposition_id: "prop-covers",
    subject_reference_id: one("verification"),
    operator: "reference:covers",
    applicability_context: UNCONDITIONAL,
    operands: [
      { kind: "reference", reference_id: one("observed_population") },
      { kind: "reference", reference_id: one("authorized_scope") }
    ]
  });
  claims.push({
    claim_id: "claim-covers",
    kind: "verification",
    modality: "MUST",
    proposition_id: "prop-covers",
    verification_method: "analysis",
    falsifying_proposition_id: "prop-falsifier"
  });
  const behaviorClaimIds = claims
    .filter(({ kind }) => kind === "behavior")
    .map(({ claim_id: claimId }) => claimId);
  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: structuredClone(result.references),
    propositions,
    claims,
    relations: behaviorClaimIds.map((target, index) => ({
      relation_id: `rel-verifies-${index}`,
      role: "verifies",
      source_claim_id: "claim-covers",
      target_claim_id: target
    })),
    collections: [],
    residue: [],
    annotations: [],
    test_proof_version: "controlled-contract-test-proof.v1",
    test_proofs: []
  };
}

const BINDING_DIAGNOSTIC_CODES = Object.freeze([
  "unknown_reference_role_binding",
  "reference_role_cardinality_invalid",
  "reference_role_binding_dangling",
  "reference_role_binding_type_mismatch",
  "reference_role_binding_identity_kind_mismatch"
]);

function bindingDiagnostics(contract, evaluationInput) {
  const result = evaluateVerificationProfileV1({
    contract,
    profile: pack.profile,
    evaluation_input: structuredClone(evaluationInput)
  });
  return result.diagnostics
    .filter(({ code }) => BINDING_DIAGNOSTIC_CODES.includes(code))
    .map(({ code }) => code);
}

test("mapping fills the complete pack-owned role shape from one authenticated projection", async () => {
  const result = await mapOrThrow(projectionFor());

  assert.equal(result.schema_version, WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION);
  assert.equal(result.profile_id, WRITE_CONFINEMENT_PROFILE_ID);
  assert.equal(result.profile_version, WRITE_CONFINEMENT_PROFILE_VERSION);
  assert.equal(result.refusal, null);

  const packRoles = pack.profile.reference_roles.map(({ role }) => role);
  assert.deepEqual(
    result.evaluation_input.reference_bindings.map(({ role }) => role),
    packRoles
  );
  assert.equal(packRoles.length, 7);

  const template = JSON.parse(await readFile(
    path.join(packageRoot, pack.catalog_entry.path, "evaluation-input.template.json"),
    "utf8"
  ));
  assert.deepEqual(
    Object.keys(result.evaluation_input).sort(),
    Object.keys(template).sort()
  );
  assert.equal(result.evaluation_input.input_version, template.input_version);
  assert.equal(result.evaluation_input.evaluation_stage, template.evaluation_stage);
  assert.deepEqual(pack.profile.evaluation_stages, [result.evaluation_input.evaluation_stage]);

  assert.deepEqual(result.evaluation_input.number_bindings, []);
  assert.deepEqual(result.evaluation_input.claim_pattern_bindings, []);
  assert.deepEqual(result.evaluation_input.resolver_facts, []);
  assert.deepEqual(result.evaluation_input.delivered_evidence, []);
  assert.deepEqual(result.evaluation_input.stable_evaluation, {});

  assert.deepEqual(result.source, {
    repository: "/srv/agent-chassis",
    run_id: "wkdb_6a3c707d1f9b4999",
    attempt: 0,
    record_id: "WK-2103",
    unit_address: "WK-2103#SLICE-001",
    base_commit: "b".repeat(40),
    delivery_commit: "c".repeat(40),
    delivery_tree: "d".repeat(40),
    source_digest: SOURCE_DIGEST,
    result_digest: RESULT_DIGEST,
    evidence_digest: EVIDENCE_DIGEST
  });
  assert.equal(Object.isFrozen(result), true);
});

test("every emitted binding is admissible under the pack's own role definitions", async () => {
  const result = await mapOrThrow(projectionFor({
    changed: ["docs/x.md", "src/a.mjs"],
    outside: ["docs/x.md"],
    writeScope: ["src", "tests"]
  }));

  for (const role of pack.profile.reference_roles) {
    const binding = bindingFor(result, role.role);
    assert.ok(binding, role.role);
    if (role.cardinality === "exactly_one") {
      assert.equal(binding.reference_ids.length, 1, role.role);
    }
    if (role.cardinality === "one_or_more") {
      assert.ok(binding.reference_ids.length >= 1, role.role);
    }
    if (role.cardinality === "zero_or_one") {
      assert.ok(binding.reference_ids.length <= 1, role.role);
    }
    for (const referenceId of binding.reference_ids) {
      const reference = referenceFor(result, referenceId);
      assert.ok(reference, referenceId);
      assert.ok(role.allowed_type_terms.includes(reference.type_term),
        `${role.role} ${reference.type_term}`);
      if (role.allowed_identity_kinds !== undefined) {
        assert.ok(role.allowed_identity_kinds.includes(reference.identity.kind),
          `${role.role} ${reference.identity.kind}`);
      }
    }
  }

  const boundIds = result.evaluation_input.reference_bindings
    .flatMap(({ reference_ids: referenceIds }) => referenceIds);
  assert.equal(new Set(boundIds).size, boundIds.length);
  assert.deepEqual(
    [...boundIds].sort(),
    result.references.map(({ reference_id: referenceId }) => referenceId).sort()
  );

  assert.deepEqual(bindingDiagnostics(contractFor(result), result.evaluation_input), []);
});

test("observed mutations bind at zero, one, and many where the pack permits it", async () => {
  const cardinality = pack.profile.reference_roles
    .find(({ role }) => role === "observed_mutations").cardinality;
  assert.equal(cardinality, "zero_or_more");

  for (const changed of [[], ["src/a.mjs"], ["src/a.mjs", "src/b.mjs", "src/c.mjs"]]) {
    const result = await mapOrThrow(projectionFor({ changed }));
    assert.equal(bindingFor(result, "observed_mutations").reference_ids.length, changed.length);
    assert.deepEqual(bindingDiagnostics(contractFor(result), result.evaluation_input), []);
  }
});

test("authorized targets bind at zero, one, and many where the pack permits it", async () => {
  const cardinality = pack.profile.reference_roles
    .find(({ role }) => role === "authorized_targets").cardinality;
  assert.equal(cardinality, "zero_or_more");

  for (const writeScope of [[], ["src"], ["docs", "src", "tests"]]) {
    const result = await mapOrThrow(projectionFor({ changed: [], writeScope }));
    assert.equal(bindingFor(result, "authorized_targets").reference_ids.length, writeScope.length);
    assert.deepEqual(bindingDiagnostics(contractFor(result), result.evaluation_input), []);
  }
});

test("equivalent complete fixtures map to byte-identical evaluation input", async () => {
  const options = {
    changed: ["docs/x.md", "src/a.mjs"],
    outside: ["docs/x.md"],
    writeScope: ["src"]
  };
  const first = await mapOrThrow(projectionFor(options));
  const second = await mapOrThrow(projectionFor(options));
  const repeated = await mapOrThrow(projectionFor(options));

  const bytes = canonicalWriteConfinementEvaluationInputJson(first);
  assert.ok(bytes.equals(canonicalWriteConfinementEvaluationInputJson(second)));
  assert.ok(bytes.equals(canonicalWriteConfinementEvaluationInputJson(repeated)));
  assert.deepEqual(first.references, second.references);

  const different = await mapOrThrow(projectionFor({ ...options, changed: ["src/a.mjs"], outside: [] }));
  assert.equal(bytes.equals(canonicalWriteConfinementEvaluationInputJson(different)), false);
});

test("launcher-emitted path bytes and order are preserved exactly", async () => {

  const decomposed = "src/café.mjs";
  const changed = ["src/a.mjs", decomposed];
  const writeScope = ["docs", "src"];
  const result = await mapOrThrow(projectionFor({ changed, writeScope }));

  const observedIds = bindingFor(result, "observed_mutations").reference_ids;
  assert.deepEqual(
    observedIds.map((referenceId) => referenceFor(result, referenceId).identity.path),
    changed
  );
  const target = referenceFor(result, observedIds[1]);
  assert.equal(target.identity.path, decomposed);
  assert.notEqual(target.identity.path, decomposed.normalize("NFC"));
  assert.equal(target.identity.repository, "/srv/agent-chassis");

  assert.deepEqual(
    bindingFor(result, "authorized_targets").reference_ids
      .map((referenceId) => referenceFor(result, referenceId).identity.path),
    writeScope
  );
});

const REFUSAL_CASES = [
  {
    name: "a missing projection",
    projection: undefined,
    code: CODES.MISSING_REQUIRED_INPUT
  },
  {
    name: "a null projection",
    projection: null,
    code: CODES.MISSING_REQUIRED_INPUT
  },
  {
    name: "a non-object projection",
    projection: "workspace-agent-write-confinement-evidence.v1",
    code: CODES.MALFORMED_ENVELOPE
  },
  {
    name: "the launcher delivery input supplied instead of the envelope",
    projection: { schema_version: "workspace-agent-write-confinement-delivery.v1" },
    code: CODES.WRONG_LAUNCHER_ARTIFACT
  },
  {
    name: "the launcher receipt binding supplied instead of the envelope",
    projection: { schema_version: "workspace-agent-write-confinement-receipt-binding.v1" },
    code: CODES.WRONG_LAUNCHER_ARTIFACT
  },
  {
    name: "the launcher source digest body supplied instead of the envelope",
    projection: { schema_version: "workspace-agent-write-confinement-source.v1" },
    code: CODES.WRONG_LAUNCHER_ARTIFACT
  },
  {
    name: "the launcher result digest body supplied instead of the envelope",
    projection: { schema_version: "workspace-agent-write-confinement-result.v1" },
    code: CODES.WRONG_LAUNCHER_ARTIFACT
  },
  {
    name: "an unknown evidence schema version",
    projection: envelopeFor(evidenceFor(), {
      schema_version: "workspace-agent-write-confinement-evidence.v2"
    }),
    code: CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED
  },
  {
    name: "the inner evidence object supplied as the envelope",
    projection: evidenceFor(),
    code: CODES.MALFORMED_ENVELOPE
  },
  {
    name: "an envelope carrying an unexpected field",
    projection: { ...envelopeFor(evidenceFor()), operator_note: "manual" },
    code: CODES.MALFORMED_ENVELOPE
  },
  {
    name: "a refused projection",
    projection: envelopeFor(null, {
      projected: false,
      evidence: null,
      evidence_digest: null,
      refusal: { code: "agent_launch.write_confinement_evidence.nonterminal_run.v1", reason: "", detail: null }
    }),
    code: CODES.UNPROJECTED_ENVELOPE
  },
  {
    name: "an envelope with a malformed evidence digest",
    projection: envelopeFor(evidenceFor(), { evidence_digest: "f".repeat(64) }),
    code: CODES.MALFORMED_ENVELOPE
  },
  {
    name: "inner evidence that is not an object",
    projection: envelopeFor("evidence"),
    code: CODES.MALFORMED_EVIDENCE
  },
  {
    name: "inner evidence missing a required field",
    projection: envelopeFor((() => {
      const evidence = evidenceFor();
      delete evidence.inside_write_scope_paths;
      return evidence;
    })()),
    code: CODES.MALFORMED_EVIDENCE
  },
  {
    name: "inner evidence carrying an unexpected field",
    projection: envelopeFor(evidenceFor({ overrides: { operator_note: "manual" } })),
    code: CODES.MALFORMED_EVIDENCE
  },
  {
    name: "inner evidence with a non-integer attempt",
    projection: envelopeFor(evidenceFor({ overrides: { attempt: 1.5 } })),
    code: CODES.MALFORMED_EVIDENCE
  },
  {
    name: "inner evidence with a malformed result digest",
    projection: envelopeFor(evidenceFor({ overrides: { result_digest: "sha256:zz" } })),
    code: CODES.MALFORMED_EVIDENCE
  },
  {
    name: "evidence claiming proof-pack applicability",
    projection: envelopeFor(evidenceFor({ overrides: { proof_pack_applicability: "write_confinement" } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED
  },
  {
    name: "evidence claiming an admission effect",
    projection: envelopeFor(evidenceFor({ overrides: { admission_effect: "admitted" } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED
  },
  {
    name: "evidence claiming a coordinator semantic judgment",
    projection: envelopeFor(evidenceFor({ overrides: { semantic_judgment: "approved" } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED
  },
  {
    name: "evidence declaring an incomplete population",
    projection: envelopeFor(evidenceFor({ overrides: { populations_complete: false } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED
  },
  {
    name: "evidence that states nothing it did not observe",
    projection: envelopeFor(evidenceFor({ overrides: { not_covered: [] } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED
  },
  {
    name: "duplicate changed paths",
    projection: envelopeFor(evidenceFor({
      overrides: {
        changed_paths: ["src/a.mjs", "src/a.mjs"],
        inside_write_scope_paths: ["src/a.mjs", "src/a.mjs"],
        changed_path_count: 2,
        inside_write_scope_path_count: 2
      }
    })),
    code: CODES.POPULATION_NONCANONICAL
  },
  {
    name: "a duplicate frozen write-scope entry",
    projection: envelopeFor(evidenceFor({ writeScope: ["src", "src"] })),
    code: CODES.POPULATION_NONCANONICAL
  },
  {
    name: "a re-sorted changed-path population",
    projection: envelopeFor(evidenceFor({
      overrides: {
        changed_paths: ["src/b.mjs", "src/a.mjs"],
        inside_write_scope_paths: ["src/b.mjs", "src/a.mjs"]
      }
    })),
    code: CODES.POPULATION_NONCANONICAL
  },
  {
    name: "a non-string population member",
    projection: envelopeFor(evidenceFor({
      overrides: {
        changed_paths: ["src/a.mjs", 7],
        inside_write_scope_paths: ["src/a.mjs"],
        inside_write_scope_path_count: 1
      }
    })),
    code: CODES.POPULATION_NONCANONICAL
  },
  {
    name: "a changed-path count that disagrees with its population",
    projection: envelopeFor(evidenceFor({ overrides: { changed_path_count: 9 } })),
    code: CODES.POPULATION_INCONSISTENT
  },
  {
    name: "an outside path missing from the changed-path population",
    projection: envelopeFor(evidenceFor({
      overrides: {
        outside_write_scope_paths: ["docs/absent.md"],
        outside_write_scope_path_count: 1,
        contained: false
      }
    })),
    code: CODES.POPULATION_INCONSISTENT
  },
  {
    name: "an extra inside path absent from the changed-path population",
    projection: envelopeFor(evidenceFor({
      overrides: {
        inside_write_scope_paths: ["src/a.mjs", "src/b.mjs", "src/extra.mjs"],
        inside_write_scope_path_count: 3
      }
    })),
    code: CODES.POPULATION_INCONSISTENT
  },
  {
    name: "a changed path reported both inside and outside the frozen scope",
    projection: envelopeFor(evidenceFor({
      overrides: {
        outside_write_scope_paths: ["src/a.mjs"],
        outside_write_scope_path_count: 1,
        contained: false
      }
    })),
    code: CODES.POPULATION_INCONSISTENT
  },
  {
    name: "a changed path reported neither inside nor outside the frozen scope",
    projection: envelopeFor(evidenceFor({
      overrides: {
        inside_write_scope_paths: ["src/a.mjs"],
        inside_write_scope_path_count: 1
      }
    })),
    code: CODES.POPULATION_INCONSISTENT
  },
  {
    name: "a containment outcome contradicting the outside population",
    projection: envelopeFor(evidenceFor({
      changed: ["docs/x.md", "src/a.mjs"],
      outside: ["docs/x.md"],
      overrides: { contained: true }
    })),
    code: CODES.POPULATION_INCONSISTENT
  },

  {
    name: "a function-valued required marker",
    projection: envelopeFor(evidenceFor({ overrides: { authority: () => {} } })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
    cloneHostile: true,
    detail: { field: "authority", supplied: "[function]" }
  },
  {
    name: "a symbol-valued required marker",
    projection: envelopeFor(evidenceFor({
      overrides: { semantic_judgment: Symbol("approved") }
    })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
    cloneHostile: true,
    detail: { field: "semantic_judgment", supplied: "[symbol]" }
  },
  {
    name: "an object-valued required marker",
    projection: envelopeFor(evidenceFor({
      overrides: { observation_boundary: { note() { return "delta"; } } }
    })),
    code: CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
    cloneHostile: true,
    detail: { field: "observation_boundary", supplied: "[object]" }
  },
  {
    name: "a function-valued population count",
    projection: envelopeFor(evidenceFor({ overrides: { changed_path_count: () => {} } })),
    code: CODES.POPULATION_INCONSISTENT,
    cloneHostile: true,
    detail: { population: "changed_paths", declared: "[function]", actual: 2 }
  },
  {
    name: "a symbol-valued population count",
    projection: envelopeFor(evidenceFor({
      overrides: { outside_write_scope_path_count: Symbol("count") }
    })),
    code: CODES.POPULATION_INCONSISTENT,
    cloneHostile: true,
    detail: {
      population: "outside_write_scope_paths", declared: "[symbol]", actual: 0
    }
  },
  {
    name: "a bigint-valued population count",
    projection: envelopeFor(evidenceFor({
      overrides: { inside_write_scope_path_count: 2n }
    })),
    code: CODES.POPULATION_INCONSISTENT,
    cloneHostile: true,
    detail: {
      population: "inside_write_scope_paths", declared: "[bigint]", actual: 2
    }
  }
];

for (const { name, projection, code, detail } of REFUSAL_CASES) {
  test(`mapping refuses ${name}`, async () => {
    const result = await mapWriteConfinementCapture({ projection });
    assert.equal(result.mapped, false, name);
    assert.equal(result.refusal.code, code, `${name}: ${result.refusal?.reason}`);
    assert.equal(typeof result.refusal.reason, "string");
    assert.ok(result.refusal.reason.length > 0);
    for (const [key, value] of Object.entries(detail ?? {})) {
      assert.deepEqual(result.refusal.detail[key], value, `${name}: detail.${key}`);
    }
  });
}

test("an uncloneable caller value resolves to a refusal rather than rejecting", async () => {
  const hostile = REFUSAL_CASES.filter(({ cloneHostile }) => cloneHostile === true);
  assert.ok(hostile.length >= 4);
  for (const { name, projection, code } of hostile) {
    await assert.doesNotReject(
      () => mapWriteConfinementCapture({ projection }), name
    );
    const result = await mapWriteConfinementCapture({ projection });
    assert.equal(result.refusal.code, code, name);
    assert.equal(result.evaluation_input, null, name);
    assert.equal(result.references, null, name);
    assert.equal(result.source, null, name);
  }
});

test("no refusal ever emits a partial evaluation input", async () => {
  const supplied = [
    ...REFUSAL_CASES.map(({ projection }) => ({ projection })),
    { projection: projectionFor(), pack: {} },
    { projection: projectionFor(), pack: await loadAdmittedProofPack("proof.single-use.replay-refusal") }
  ];
  let refused = 0;
  for (const request of supplied) {
    const result = await mapWriteConfinementCapture(request);
    assert.equal(result.mapped, false);
    assert.equal(result.evaluation_input, null);
    assert.equal(result.references, null);
    assert.equal(result.source, null);
    assert.equal(result.schema_version, WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION);
    assert.equal(Object.isFrozen(result), true);
    refused += 1;
  }
  assert.equal(refused, REFUSAL_CASES.length + 2);
});

test("a pack that is not the admitted write-confinement identity is refused", async () => {
  const other = await loadAdmittedProofPack("proof.single-use.replay-refusal");
  const result = await mapWriteConfinementCapture({ projection: projectionFor(), pack: other });
  assert.equal(result.mapped, false);
  assert.equal(result.refusal.code, CODES.PROFILE_IDENTITY_MISMATCH);
  assert.equal(result.refusal.detail.expected.profile_id, WRITE_CONFINEMENT_PROFILE_ID);
  assert.equal(result.refusal.detail.expected.profile_version, WRITE_CONFINEMENT_PROFILE_VERSION);
  assert.notEqual(result.refusal.detail.supplied.profile_id, WRITE_CONFINEMENT_PROFILE_ID);
});

test("a hand-built pack is refused rather than trusted", async () => {
  for (const pretender of [
    {},
    { profile: structuredClone(pack.profile), admission: structuredClone(pack.admission) }
  ]) {
    const result = await mapWriteConfinementCapture({
      projection: projectionFor(), pack: pretender
    });
    assert.equal(result.mapped, false);
    assert.equal(result.refusal.code, CODES.PACK_SNAPSHOT_UNRECOGNIZED);
  }
});

test("mutating an emitted binding makes the pack runtime reject it", async () => {
  const result = await mapOrThrow(projectionFor());
  const contract = contractFor(result);
  assert.deepEqual(bindingDiagnostics(contract, result.evaluation_input), []);

  const unknownRole = structuredClone(result.evaluation_input);
  unknownRole.reference_bindings[0].role = "observed_mutation";
  assert.ok(bindingDiagnostics(contract, unknownRole).includes("unknown_reference_role_binding"));

  const wrongTypeTerm = structuredClone(result.evaluation_input);
  wrongTypeTerm.reference_bindings.find(({ role }) => role === "observed_mutations")
    .reference_ids = ["ref-write-confinement-observed-population"];
  assert.ok(bindingDiagnostics(contract, wrongTypeTerm)
    .includes("reference_role_binding_type_mismatch"));

  const wrongCardinality = structuredClone(result.evaluation_input);
  wrongCardinality.reference_bindings.find(({ role }) => role === "execution")
    .reference_ids = ["ref-write-confinement-execution", "ref-write-confinement-verification"];
  assert.ok(bindingDiagnostics(contract, wrongCardinality)
    .includes("reference_role_cardinality_invalid"));

  const wrongIdentityKind = structuredClone(contract);
  wrongIdentityKind.references
    .find(({ reference_id: referenceId }) => referenceId === "ref-write-confinement-verification")
    .identity = {
      kind: "repository_path",
      repository: "/srv/agent-chassis",
      path: "packages/agent-launch-cli/src/lib/workspace-agent-write-confinement-evidence.mjs"
    };
  const rebound = structuredClone(result.evaluation_input);
  rebound.reference_bindings.find(({ role }) => role === "execution")
    .reference_ids = ["ref-write-confinement-verification"];
  assert.ok(bindingDiagnostics(wrongIdentityKind, rebound)
    .includes("reference_role_binding_identity_kind_mismatch"));
});

test("the pack's admission owns every preserved exclusion and the mapping claims none of them", async () => {
  const exclusions = pack.admission.explicit_exclusions;
  assert.ok(Array.isArray(exclusions));
  assert.ok(exclusions.length > 0);

  const result = await mapOrThrow(projectionFor({
    changed: ["docs/x.md", "src/a.mjs"],
    outside: ["docs/x.md"]
  }));
  const emitted = JSON.stringify({
    evaluation_input: result.evaluation_input,
    references: result.references
  });

  for (const exclusion of exclusions) {
    assert.equal(emitted.includes(exclusion), false, exclusion);
  }

  assert.deepEqual(pack.profile.resolver_fact_patterns ?? [], []);
  assert.deepEqual(pack.profile.evidence_patterns ?? [], []);
  assert.deepEqual(result.evaluation_input.resolver_facts, []);
  assert.deepEqual(result.evaluation_input.delivered_evidence, []);

  assert.equal(bindingFor(result, "observed_mutations").reference_ids.length, 2);
  assert.equal(
    referenceFor(result, "ref-write-confinement-unauthorized-mutation-condition").identity.value,
    "observed-mutation-outside-frozen-write-scope"
  );
});

test("the runtime export and the declaration expose the same mapping surface", async () => {
  const current = await import("../current.mjs");
  const exported = [
    "WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES",
    "WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION",
    "WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION",
    "WRITE_CONFINEMENT_PROFILE_ID",
    "WRITE_CONFINEMENT_PROFILE_VERSION",
    "canonicalWriteConfinementEvaluationInputJson",
    "mapWriteConfinementCapture"
  ];
  for (const name of exported) assert.ok(name in current, name);
  assert.equal(typeof current.mapWriteConfinementCapture, "function");
  assert.equal(typeof current.canonicalWriteConfinementEvaluationInputJson, "function");
  assert.equal(current.WRITE_CONFINEMENT_PROFILE_ID, WRITE_CONFINEMENT_PROFILE_ID);
  assert.equal(current.WRITE_CONFINEMENT_PROFILE_VERSION, WRITE_CONFINEMENT_PROFILE_VERSION);
  assert.equal(
    current.WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    "workspace-agent-write-confinement-evidence.v1"
  );
  assert.equal(Object.isFrozen(current.WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES), true);

  const declaration = await readFile(path.join(packageRoot, "current.d.mts"), "utf8");
  for (const name of exported) assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"));
  assert.match(declaration, /\bWriteConfinementCaptureResult\b/u);
  assert.match(declaration, /\bWriteConfinementCaptureRefusalCode\b/u);

  const module = await import("../lib/write-confinement-capture.mjs");
  assert.deepEqual(Object.keys(module).sort(), [...exported].sort());
});

test("canonical evaluation-input bytes are refused for anything but a mapped result", async () => {
  const refusal = await mapWriteConfinementCapture({ projection: null });
  assert.throws(() => canonicalWriteConfinementEvaluationInputJson(refusal), TypeError);
  assert.throws(() => canonicalWriteConfinementEvaluationInputJson(null), TypeError);
});

test("the mapping delegates its pack-agnostic machinery to the shared capture owner", async () => {
  const {
    assembleCaptureEvaluationInput,
    canonicalCaptureEvaluationInputJson,
    createCaptureResultFactory,
    resolveExactlyOneEvaluationStage
  } = await import("../lib/capture-mapping.mjs");

  const result = await mapOrThrow(projectionFor());
  const refusal = await mapWriteConfinementCapture({ projection: null });

  const factory = createCaptureResultFactory({
    schemaVersion: WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION,
    identity: {
      profile_id: WRITE_CONFINEMENT_PROFILE_ID,
      profile_version: WRITE_CONFINEMENT_PROFILE_VERSION,
      evidence_schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
    }
  });
  const reference = factory.refuse(
    refusal.refusal.code, refusal.refusal.reason, refusal.refusal.detail
  );
  assert.deepEqual(refusal, reference);
  assert.deepEqual(Object.keys(result), Object.keys(reference));

  const { stage } = resolveExactlyOneEvaluationStage(pack.profile);
  assert.deepEqual(result.evaluation_input, assembleCaptureEvaluationInput({
    stage, referenceBindings: result.evaluation_input.reference_bindings
  }));

  assert.equal(
    canonicalWriteConfinementEvaluationInputJson(result).equals(
      canonicalCaptureEvaluationInputJson(result, "write-confinement capture")
    ),
    true
  );
});

test("the mapping keeps no second copy of the shared capture machinery", async () => {
  const source = await readFile(
    path.join(packageRoot, "lib/write-confinement-capture.mjs"), "utf8"
  );
  assert.match(source, /from "\.\/capture-mapping\.mjs"/u);

  for (const owned of [
    /from "\.\/admitted-proof-packs\.mjs"/u,
    /from "\.\/verification-profile-schema-v1\.mjs"/u,
    /function\s+deepFreeze\b/u,
    /function\s+diagnosticScalar\b/u,
    /function\s+isPlainObject\b/u,
    /function\s+selectAllowed\b/u,
    /function\s+cardinalityMismatch\b/u
  ]) assert.doesNotMatch(source, owned, String(owned));
});

test("controlled-contract takes no runtime dependency on agent-launch-cli", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const names = Object.keys(manifest[field] ?? {});
    assert.equal(names.some((name) => name.includes("agent-launch")), false, field);
  }
  for (const relative of [
    "lib/write-confinement-capture.mjs",
    "lib/capture-mapping.mjs",
    "lib/behavioral-preservation-capture.mjs",
    "current.mjs"
  ]) {
    const source = await readFile(path.join(packageRoot, relative), "utf8");
    for (const [, specifier] of source.matchAll(/(?:^|\s)(?:import|export)[^;]*?from\s+"([^"]+)"/gu)) {
      assert.equal(specifier.includes("agent-launch"), false, `${relative} -> ${specifier}`);
    }
  }

  const module = await readFile(
    path.join(packageRoot, "lib/write-confinement-capture.mjs"), "utf8"
  );
  assert.match(module, /workspace-agent-write-confinement-evidence\.mjs/u);
});
