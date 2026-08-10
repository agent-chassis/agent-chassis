import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import {
  MAX_BINDING_ASSISTANCE_BYTES,
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings,
  inspectProofPackBindingsPage,
  validateProofPackBindingAssistance
} from "../lib/proof-pack-binding-assistance.mjs";
import { parseArgs } from "../bin/inspect-proof-pack-bindings.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = new URL("../", import.meta.url);
const profileId = "proof.state.bounded-interval-nonmutation";
const profileVersion = "1.0.0";
const intentId = "controlled-proof-intent.bounded-interval-nonmutation";

function reference(referenceId, typeTerm, kind = "durable_id") {
  const identity = kind === "runtime_parameter"
    ? { kind, name: referenceId }
    : { kind, domain: "binding-test", value: referenceId };
  return { reference_id: referenceId, type_term: typeTerm, identity };
}

async function contractFixture() {
  const contract = JSON.parse(await readFile(new URL(
    "examples/minimal-controlled-acceptance-contract-v034.json", packageRoot
  ), "utf8"));
  contract.references.push(
    reference("ref-actor-alpha", "cc:actor"),
    reference("ref-actor-beta", "cc:process"),
    reference("ref-actor-misleading-name", "cc:state"),
    reference("ref-interval", "cc:scope"),
    reference("ref-start", "cc:event"),
    reference("ref-end", "cc:event"),
    reference("ref-population", "cc:population"),
    reference("ref-resource", "cc:resource")
  );
  contract.propositions.push(
    {
      proposition_id: "prop-count-one",
      subject_reference_id: "ref-population",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 1 }]
    },
    {
      proposition_id: "prop-count-two",
      subject_reference_id: "ref-population",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 2 }]
    }
  );
  return contract;
}

function evaluationInput(referenceBindings = [], numberBindings = []) {
  return {
    input_version:
      "controlled-contract-verification-profile-input.experimental.v0.2",
    evaluation_stage: "pre_dispatch",
    reference_bindings: referenceBindings,
    number_bindings: numberBindings,
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
}

test("reports every compatible candidate without choosing or inferring meaning", async () => {
  const result = await inspectProofPackBindings({
    contract: await contractFixture(), profileId, profileVersion,
    requestedIntents: [intentId]
  });
  assert.equal(validateProofPackBindingAssistance(result), true);
  assert.equal(result.binding_selected, false);
  assert.equal(result.binding_written, false);
  assert.equal(result.semantic_truth_inferred, false);
  assert.equal(result.authority, "non_authoritative");
  const actor = result.reference_roles.find(({ role }) => role === "actor");
  assert.equal(actor.status, "ambiguous");
  assert.deepEqual(actor.compatible_candidates.map(({ reference_id: id }) => id), [
    "ref-actor-alpha", "ref-actor-beta"
  ]);
  assert.equal(actor.compatible_candidates.some(({ reference_id: id }) =>
    id === "ref-actor-misleading-name"), false);
  assert(actor.compatible_candidates.every(({ compatibility }) =>
    compatibility.type_compatible && compatibility.identity_kind_compatible));
  assert.ok(actor.profile_usage.patterns.length > 0);
  assert.equal(result.summary.status, "not_supplied");
  const tampered = structuredClone(result);
  tampered.summary.reference_role_count += 1;
  assert.throws(() => canonicalProofPackBindingAssistanceJson(tampered),
    (error) => error.code === "proof_pack_binding_result_digest_mismatch");
});

test("one candidate remains an explicit suggestion status, never a binding", async () => {
  const contract = await contractFixture();
  contract.references = contract.references.filter(({ reference_id: id }) =>
    id !== "ref-actor-beta");
  const result = await inspectProofPackBindings({
    contract, profileId, profileVersion
  });
  const actor = result.reference_roles.find(({ role }) => role === "actor");
  assert.equal(actor.status, "one_compatible_candidate");
  assert.equal(actor.supplied_binding, null);
  assert.equal(result.binding_selected, false);
});

test("valid and stale supplied bindings receive typed per-role status", async () => {
  const contract = await contractFixture();
  const supplied = evaluationInput([
    { role: "actor", reference_ids: ["ref-actor-alpha"] },
    { role: "interval", reference_ids: ["ref-missing"] }
  ], [{ role: "protected_resource_count", value: 2 }]);
  const result = await inspectProofPackBindings({
    contract, profileId, profileVersion, evaluationInput: supplied
  });
  assert.equal(result.reference_roles.find(({ role }) => role === "actor").status,
    "validly_bound");
  const interval = result.reference_roles.find(({ role }) => role === "interval");
  assert.equal(interval.status, "incompatible");
  assert(interval.diagnostics.some(({ code }) =>
    code === "reference_role_binding_dangling"));
  assert.equal(result.number_roles[0].status, "validly_bound");
  assert.equal(result.summary.status, "invalid");
});

test("number candidates preserve ambiguity and exact occurrence facts", async () => {
  const result = await inspectProofPackBindings({
    contract: await contractFixture(), profileId, profileVersion
  });
  const number = result.number_roles.find(
    ({ role }) => role === "protected_resource_count"
  );
  assert.equal(number.status, "ambiguous");
  assert.deepEqual(number.compatible_candidates.map(({ value }) => value), [1, 2]);
  assert.deepEqual(number.compatible_candidates[0].proposition_ids,
    ["prop-count-one"]);
});

test("property, contract-array, intent, and evaluation order preserve bytes", async () => {
  const contract = await contractFixture();
  const input = evaluationInput([
    { role: "interval", reference_ids: ["ref-interval"] },
    { role: "actor", reference_ids: ["ref-actor-alpha"] }
  ], [{ role: "protected_resource_count", value: 1 }]);
  const baseline = await inspectProofPackBindings({
    contract, profileId, profileVersion, requestedIntents: [intentId],
    evaluationInput: input
  });
  const reordered = await inspectProofPackBindings({
    evaluationInput: {
      ...input,
      reference_bindings: [...input.reference_bindings].reverse()
    },
    requestedIntents: [intentId],
    profileVersion,
    profileId,
    contract: {
      ...contract,
      references: [...contract.references].reverse(),
      propositions: [...contract.propositions].reverse()
    }
  });
  assert.equal(canonicalProofPackBindingAssistanceJson(reordered),
    canonicalProofPackBindingAssistanceJson(baseline));
});

test("stale identity, incompatible intent, malformed contract, and overrides fail closed", async () => {
  const contract = await contractFixture();
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion: "0.0.0"
  }));
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion,
    requestedIntents: ["controlled-proof-intent.lossless-projection"]
  }));
  await assert.rejects(inspectProofPackBindings({
    contract: {}, profileId, profileVersion
  }), (error) => error.code === "proof_pack_binding_contract_invalid");
  for (const key of [
    "catalog", "profilePath", "root", "module", "executable", "environment"
  ]) await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion, [key]: "forged"
  }), (error) => error.code === "proof_pack_binding_request_option_unsupported");
  for (const flag of [
    "--catalog", "--profile-path", "--root", "--module", "--executable",
    "--environment"
  ]) assert.throws(() => parseArgs([flag, "forged"]), /unknown argument/u);
});

test("many compatible candidates fail the output bound instead of truncating", async () => {
  const contract = await contractFixture();
  contract.references.push(...Array.from({ length: 900 }, (_, index) =>
    reference(`ref-extra-${String(index).padStart(4, "0")}`, "cc:process")
  ));
  let legacyBytes;
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion
  }), (error) => error instanceof ProofPackBindingAssistanceError &&
    error.code === "proof_pack_binding_result_too_large" &&
    (legacyBytes = error.details.byte_length) > MAX_BINDING_ASSISTANCE_BYTES);
  const first = await inspectProofPackBindingsPage({ contract, profileId,
    profileVersion, roles: ["actor"], maximumItems: 7 });
  assert.equal(first.population.returned_count, 7);
  assert.ok(first.population.total_count > first.population.returned_count);
  const second = await inspectProofPackBindingsPage({ contract, profileId,
    profileVersion, roles: ["actor"], offset: 7, maximumItems: 7 });
  assert.equal(second.items[0].candidate.reference_id,
    first.items.at(-1).candidate.reference_id.replace(/(\d+)$/u,
      (value) => String(Number(value) + 1).padStart(value.length, "0")));
  assert.equal(first.digests.result, second.digests.result);
});

test("the bounded CLI emits canonical output and rejects invalid supplied bindings", async () => {
  const cli = new URL("bin/inspect-proof-pack-bindings.mjs", packageRoot);
  const contract = new URL(
    "examples/minimal-controlled-acceptance-contract-v034.json", packageRoot
  );
  const args = [
    cli.pathname, "--input", contract.pathname,
    "--profile-id", "proof.scope.write-confinement",
    "--profile-version", "1.0.0"
  ];
  const { stdout } = await execFileAsync(process.execPath, args, {
    maxBuffer: MAX_BINDING_ASSISTANCE_BYTES + 1024
  });
  assert.equal(validateProofPackBindingAssistance(JSON.parse(stdout)), true);
  assert.ok(Buffer.byteLength(stdout, "utf8") <= MAX_BINDING_ASSISTANCE_BYTES);
});
