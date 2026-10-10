

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DECISION_PATTERN_ENFORCEMENT_VERSION, DRAFT_EXPERIMENT_USE, compareContractToDecision,
  requiredPoliciesFromDecision
} from "../../packages/wiki-cli/scripts/required-policy-decision-prototype.mjs";
import { controlledContractContentDigest } from
  "../../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { validateProfileSchemaV1 } from "../../packages/controlled-contract/lib/verification-profile-schema-v1.mjs";
import { SIBLING_REQUIREMENT, compileGaugeRequirements as compileRequirements, verification, when } from
  "../fixtures/required-policy-assessment.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(
  `../fixtures/controlled-contract/${name}`, import.meta.url), "utf8"));
const SIDECAR_PATH = "required-policy-decision-draft.patterns.json";
const DECISION = await fixture("required-policy-decision-draft.json");
const BUNDLE = await fixture(SIDECAR_PATH);
const INVENTORY = await fixture("required-policy-inventory-draft.json");
const SIDECARS = Object.freeze({ [SIDECAR_PATH]: BUNDLE });
const [RULE] = DECISION.enforcement.rules;
const WK = "WK-9001";
const subject = Object.freeze({ unit: WK, wk_id: WK, selected_unit: null, focus: null });
const [CODEX_ENTRY, CLAUDE_ENTRY] = INVENTORY.entries;
const [CODEX, CLAUDE] = [CODEX_ENTRY.input_id, CLAUDE_ENTRY.input_id];
const BEHAVIOR = "invalid-return-answers-usage-invalid-error";
const VERIFICATION = `${BEHAVIOR}-verification`;
const RELATIONSHIP = `${BEHAVIOR}-verifies`;

const requirement = ({ bindings: b }) => ({ nature: "behavior", modality: "MUST", subject: { declare: b.operation },
  behavior: when("reference:returns", b.invalid_usage_error, b.invalid_return),
  verification: verification(b.check, b.operation,
    { relation: "reference:accepts", objects: [{ referent: { declare: b.invalid_return } }] }) });
const compile = (requirements, contract = null) => compileRequirements(requirements, { wkId: WK, contract });
const codexOnly = await compile([requirement(CODEX_ENTRY)]);
const bothCompiled = await compile([requirement(CLAUDE_ENTRY)], codexOnly.content);
const both = bothCompiled.content;
const [codexClaim, claudeClaim] = [codexOnly.compiled[0], bothCompiled.compiled[0]];
const row = (name, claim) => ({ obligation_id: `OBL-${name}`, wk_id: WK, focus: null,
  statement: `${name}: an invalid usage callback return is answered with the stated error`,
  controlled_contract_node_ids: [claim.claim_id] });
const rows = [row("codex", codexClaim), row("claude", claudeClaim)];
const withoutRelation = (target) => ({ ...structuredClone(both),
  relations: both.relations.filter((relation) => relation.target_claim_id !== target.claim_id) });

const compare = (contract, obligations = rows, changes = {}) => compareContractToDecision({ decision: DECISION,
  sidecars: SIDECARS, inventory: INVENTORY, subject, contract, obligations, decisionUse: DRAFT_EXPERIMENT_USE,
  ...changes });
const of = (result, inputId) => Object.fromEntries(result.findings.filter((finding) =>
  finding.input.input_id === inputId).map((finding) => [`${finding.kind}:${finding.pattern_id}`, finding.status]));
const one = (result, inputId, key) => {
  const found = result.findings.filter((finding) => finding.input.input_id === inputId &&
    `${finding.kind}:${finding.pattern_id}` === key);
  assert.equal(found.length, 1, `exactly one ${key} finding for ${inputId}`);
  return found[0];
};
const input = (result, inputId) => result.inputs.find((entry) => entry.input_id === inputId);
const ALL_MISSING = Object.freeze({ [`claim:${BEHAVIOR}`]: "missing", [`claim:${VERIFICATION}`]: "missing",
  [`relation:${RELATIONSHIP}`]: "missing", [`obligation:${BEHAVIOR}`]: "missing" });

function assertPopulation(result) {
  assert.deepEqual([result.totals.definitions.required, result.totals.obligations.required], [6, 2]);
  assert.deepEqual(result.inputs.map((entry) => entry.input_id).sort(), [CLAUDE, CODEX].sort());
  const counted = (status) => (result.totals.definitions[status] ?? 0) + (result.totals.obligations[status] ?? 0);
  for (const status of ["missing", "unresolved", "affected"]) {
    assert.equal(result.findings.filter((finding) => finding.status === status).length, counted(status), status);
  }
  assert.equal(result.status === "complete", result.findings.length === 0);
}
const refusedBy = (run, code, details = {}) => assert.throws(run, (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  for (const [key, value] of Object.entries(details)) assert.deepEqual(error.details[key], value, key);
  return true;
});

function edited(change) {
  const decision = structuredClone(DECISION);
  const bundle = structuredClone(BUNDLE);
  change(decision.enforcement.rules[0], bundle, decision);
  return { decision, sidecars: { [SIDECAR_PATH]: bundle } };
}
const repinned = (change) => edited((rule, bundle, decision) => {
  change(rule, bundle, decision);
  rule.patterns.content_digest = controlledContractContentDigest(bundle);
});

test("DECISION-SIDECAR-REFERENCE-AND-ATTRIBUTION", () => {

  assert.deepEqual([DECISION.status, DECISION.record_kind, DECISION.related], ["proposed", "decision", ["DEC-0194"]]);
  assert.notEqual(DECISION.id, "DEC-0194");
  assert.equal(DECISION.enforcement.schema_version, DECISION_PATTERN_ENFORCEMENT_VERSION);
  assert.deepEqual(Object.keys(RULE).sort(), ["applies_to", "clauses", "obligation_pattern_ids", "patterns", "rule_id"]);
  assert.deepEqual(RULE.patterns, { path: SIDECAR_PATH, content_digest: controlledContractContentDigest(BUNDLE) });

  assert.equal(validateProfileSchemaV1(BUNDLE), true);
  assert.deepEqual(RULE.clauses, { [BEHAVIOR]: ["1"], [VERIFICATION]: ["2"], [RELATIONSHIP]: ["2"] });

  const { policies } = requiredPoliciesFromDecision({ decision: DECISION, sidecars: SIDECARS, inventory: INVENTORY,
    scope: { unit: WK, focus: null }, decisionUse: DRAFT_EXPERIMENT_USE });
  assert.equal(policies.length, 2);
  for (const policy of policies) assert.deepEqual(policy.profile, BUNDLE);
  assert.deepEqual([CODEX_ENTRY.bindings.operation.identity.symbol, CLAUDE_ENTRY.bindings.operation.identity.symbol],
    ["startCodexModelEndpoint", "startClaudeModelEndpoint"]);
  const { operation: _codex, ...sharedCodex } = CODEX_ENTRY.bindings;
  const { operation: _claude, ...sharedClaude } = CLAUDE_ENTRY.bindings;
  assert.deepEqual(sharedCodex, sharedClaude);

  refusedBy(() => compareContractToDecision({ decision: DECISION, sidecars: SIDECARS, inventory: INVENTORY, subject,
    contract: null, obligations: [] }), "decision_not_accepted");

  const none = compare(null, []);
  assertPopulation(none);
  assert.deepEqual([of(none, CODEX), of(none, CLAUDE), none.status], [ALL_MISSING, ALL_MISSING, "incomplete"]);
  for (const id of [CODEX, CLAUDE]) {
    assert.deepEqual(Object.fromEntries(Object.keys(ALL_MISSING).map((key) => [key, one(none, id, key).required_by])), {
      [`claim:${BEHAVIOR}`]: { decision_id: "DEC-9194", rule_id: RULE.rule_id, clauses: ["1"] },
      [`claim:${VERIFICATION}`]: { decision_id: "DEC-9194", rule_id: RULE.rule_id, clauses: ["2"] },
      [`relation:${RELATIONSHIP}`]: { decision_id: "DEC-9194", rule_id: RULE.rule_id, clauses: ["2"] },

      [`obligation:${BEHAVIOR}`]: { decision_id: "DEC-9194", rule_id: RULE.rule_id, clauses: ["1"],
        through_claim_pattern_id: BEHAVIOR } });
  }
  assert.equal(one(none, CLAUDE, `claim:${BEHAVIOR}`).message, "Your contract is missing behavior claim (MUST): " +
    'cc:operation "agent-chassis tests/helpers/role-guide-compaction-native.mjs startClaudeModelEndpoint" ' +
    'reference:returns cc:artifact "model-endpoint.error.fixture_usage_invalid" when cc:state ' +
    '"model-endpoint.usage-callback.return.invalid" for startClaudeModelEndpoint usage(entry, phase) (WK-9001), ' +
    "required by DEC-9194 (proposed, not accepted policy) clause 1, rule invalid-callback-return-failure.");
  assert.match(one(none, CODEX, `relation:${RELATIONSHIP}`).message, /startCodexModelEndpoint.* clause 2, rule /u);

  assert.deepEqual({ ...none.decision, content_digest: null }, { id: "DEC-9194", status: "proposed",
    use: DRAFT_EXPERIMENT_USE, accepted: false, content_digest: null });
  assert.deepEqual(none.rules, [{ rule_id: RULE.rule_id, inventory_kind: "model_endpoint_usage_callback",
    patterns: { ...RULE.patterns, profile_id: BUNDLE.profile_id }, clauses: ["1", "2"],
    input_ids: [CLAUDE, CODEX].sort() }]);
  assert.deepEqual(Object.keys(none).sort(), ["authored_contract", "boundaries", "decision", "findings", "inputs",
    "inventory", "policy_coverage", "population_equalities", "proof_recommendations", "rules", "schema_version",
    "scope_note", "status",
    "subject", "totals", "unresolved_requirements"]);

  assert.deepEqual([none.population_equalities, none.boundaries, none.unresolved_requirements, none.policy_coverage],
    [[], [], [], null]);

  assert.deepEqual(none.proof_recommendations, []);

  assert.match(none.scope_note, /supplied interpretations, not derived from the decision's text/u);
  assert.match(none.scope_note, /not that a rule states the right meaning/u);

  assert.equal(Object.hasOwn(BUNDLE, "verification_falsifier_policy"), false);
});

test("DECISION-SIDECAR-TWO-INTERFACES", async () => {

  const complete = compare(both);
  assertPopulation(complete);
  assert.deepEqual([complete.status, complete.findings, complete.inputs.map((entry) => entry.complete),
    complete.authored_contract.structurally_valid], ["complete", [], [true, true], true]);
  assert.ok(rows.every((entry) => entry.selection === undefined && entry.proof_opt_out === undefined));

  for (const contract of [codexOnly.content, (await compile([SIBLING_REQUIREMENT], codexOnly.content)).content]) {
    const half = compare(contract, [rows[0]]);
    assertPopulation(half);
    assert.deepEqual([of(half, CODEX), of(half, CLAUDE), input(half, CODEX).complete, input(half, CLAUDE).complete],
      [{}, ALL_MISSING, true, false]);
  }

  assert.deepEqual(of(compare(both, [rows[0]]), CLAUDE), { [`obligation:${BEHAVIOR}`]: "missing" });

  const unverified = compare(withoutRelation(claudeClaim));
  assertPopulation(unverified);
  assert.deepEqual([of(unverified, CODEX), input(unverified, CODEX).complete], [{}, true]);
  assert.deepEqual(of(unverified, CLAUDE), { [`relation:${RELATIONSHIP}`]: "missing",
    [`claim:${BEHAVIOR}`]: "affected", [`claim:${VERIFICATION}`]: "affected" });
  assert.deepEqual([one(unverified, CLAUDE, `relation:${RELATIONSHIP}`).reasons,
    one(unverified, CLAUDE, `claim:${BEHAVIOR}`).structural_diagnostics,
    one(unverified, CLAUDE, `claim:${VERIFICATION}`).structural_diagnostics],
  [["no_matching_authored_relationship"], ["mandatory_behavior_unverified"], ["mandatory_verification_unattached"]]);
  assert.match(one(unverified, CLAUDE, `claim:${BEHAVIOR}`).message,
    /^Your contract declares .* but it is not valid support \(mandatory_behavior_unverified\)/u);
  assert.deepEqual([unverified.authored_contract.structurally_valid,
    unverified.authored_contract.structural_diagnostics.map(({ code }) => code).sort()],
  [false, ["mandatory_behavior_unverified", "mandatory_verification_unattached"]]);

  const unresolved = [{ requirement_id: "cause-is-a-nonempty-string", clauses: ["2.c"],
    statement: "cause is a nonempty string", reason: "representation: no operator states non-emptiness" }];
  const withUnresolved = { ...INVENTORY, entries: [{ ...CODEX_ENTRY, unresolved_requirements: unresolved,
    boundary: { provider: "the helper module", consumers: ["native compaction tests"] } }, CLAUDE_ENTRY] };
  const limited = compare(both, rows, { inventory: withUnresolved });
  assert.deepEqual([limited.status, limited.findings, limited.inputs.map((entry) => entry.complete)],
    ["unresolved_requirements_remain", [], [true, true]]);
  assert.deepEqual(limited.unresolved_requirements, [{ input: { input_id: CODEX, interface: CODEX_ENTRY.interface },
    requirement_id: "cause-is-a-nonempty-string", statement: "cause is a nonempty string",
    reason: "representation: no operator states non-emptiness",
    required_by: { decision_id: "DEC-9194", clauses: ["2.c"] } }]);
  assert.deepEqual(limited.boundaries, [{ input_id: CODEX, interface: CODEX_ENTRY.interface,
    boundary: { provider: "the helper module", consumers: ["native compaction tests"] } }]);

  const gapped = compare(codexOnly.content, [rows[0]], { inventory: withUnresolved });
  assert.deepEqual([gapped.status, gapped.unresolved_requirements.length], ["incomplete", 1]);

  for (const [entry, field] of [
    [{ ...CODEX_ENTRY, unresolved_requirements: "none" }, "inventory.entries[0].unresolved_requirements"],
    [{ ...CODEX_ENTRY, unresolved_requirements: [{ ...unresolved[0], clauses: [] }] },
      "inventory.entries[0].unresolved_requirements[0].clauses"],
    [{ ...CODEX_ENTRY, unresolved_requirements: [{ ...unresolved[0], reason: "" }] },
      "inventory.entries[0].unresolved_requirements[0].reason"],
    [{ ...CODEX_ENTRY, unresolved_requirements: [unresolved[0], unresolved[0]] },
      "inventory.entries[0].unresolved_requirements[1].requirement_id"],
    [{ ...CODEX_ENTRY, unresolved_requirements: [{ ...unresolved[0], covered: true }] },
      "inventory.entries[0].unresolved_requirements[0].covered"],
    [{ ...CODEX_ENTRY, boundary: "internal" }, "inventory.entries[0].boundary"]]) {
    refusedBy(() => compare(both, rows, { inventory: { ...INVENTORY, entries: [entry, CLAUDE_ENTRY] } }),
      "policy_inventory_invalid", { field });
  }

  const { invalid_return: _omitted, ...partial } = CLAUDE_ENTRY.bindings;
  const unbound = compare(both, rows, { inventory: { ...INVENTORY,
    entries: [CODEX_ENTRY, { ...CLAUDE_ENTRY, bindings: partial }] } });
  assert.deepEqual([of(unbound, CODEX), of(unbound, CLAUDE)], [{}, { [`claim:${BEHAVIOR}`]: "unresolved",
    [`claim:${VERIFICATION}`]: "unresolved", [`relation:${RELATIONSHIP}`]: "unresolved",
    [`obligation:${BEHAVIOR}`]: "unresolved" }]);

  const inputs = structuredClone({ DECISION, BUNDLE, INVENTORY, both, rows });
  assert.deepEqual(compare(withoutRelation(claudeClaim)), unverified);
  const permuted = compare({ ...withoutRelation(claudeClaim), claims: [...both.claims].reverse(),
    references: [...both.references].reverse(), propositions: [...both.propositions].reverse() },
  [...rows].reverse(), { inventory: { ...INVENTORY, entries: [CLAUDE_ENTRY, CODEX_ENTRY] },
    decision: Object.fromEntries(Object.entries(DECISION).reverse()) });
  assert.deepEqual({ ...permuted, inventory: null }, { ...unverified, inventory: null });
  assert.deepEqual({ DECISION, BUNDLE, INVENTORY, both, rows }, inputs);
});

test("DECISION-SIDECAR-FAILURES-ARE-EXPLICIT", () => {
  const run = ({ decision, sidecars }, inventory = INVENTORY) => () => compareContractToDecision({ decision, sidecars,
    inventory, subject, contract: both, obligations: rows, decisionUse: DRAFT_EXPERIMENT_USE });
  const reference = { rule_id: RULE.rule_id, path: SIDECAR_PATH };

  refusedBy(run({ decision: DECISION, sidecars: {} }), "decision_pattern_sidecar_absent", reference);
  refusedBy(run({ decision: DECISION, sidecars: undefined }), "decision_pattern_sidecar_absent", reference);
  refusedBy(run(edited((_rule, bundle) => { bundle.claim_patterns[0].allowed_modalities = ["SHOULD"]; })),
    "decision_pattern_sidecar_digest_mismatch", { ...reference, expected: RULE.patterns.content_digest });
  refusedBy(run({ decision: DECISION, sidecars: { [SIDECAR_PATH]: "not a bundle" } }),
    "decision_pattern_sidecar_digest_mismatch", { actual: null });
  refusedBy(run(repinned((_rule, bundle) => { bundle.claim_patterns = "none"; })),
    "decision_pattern_sidecar_invalid", reference);
  refusedBy(run(repinned((_rule, bundle) => { bundle.relation_patterns[0].target_claim_pattern_id = "nonexistent"; })),
    "decision_pattern_sidecar_invalid", reference);
  for (const location of ["../outside.json", "/absolute.json", "a//b.json"]) {
    refusedBy(run(edited((rule) => { rule.patterns.path = location; })), "decision_pattern_sidecar_location_invalid");
  }
  refusedBy(run(edited((rule) => { rule.patterns.content_digest = "48b632"; })),
    "decision_pattern_enforcement_invalid", { field: "enforcement.rules[0].patterns.content_digest" });

  refusedBy(run(edited((rule) => { rule.clauses.nonexistent = ["9"]; })), "decision_pattern_attribution_unknown",
    { unknown_pattern_ids: ["nonexistent"] });
  refusedBy(run(edited((rule) => { delete rule.clauses[RELATIONSHIP]; })), "decision_pattern_attribution_missing",
    { unattributed_pattern_ids: [RELATIONSHIP] });
  refusedBy(run(edited((rule) => { rule.clauses[BEHAVIOR] = []; })), "decision_pattern_enforcement_invalid",
    { field: "enforcement.rules[0].clauses" });
  for (const target of ["nonexistent", RELATIONSHIP]) {
    refusedBy(run(edited((rule) => { rule.obligation_pattern_ids = [target]; })),
      "decision_pattern_obligation_target_invalid", { invalid_pattern_ids: [target] });
  }

  refusedBy(run(edited((rule, bundle) => { rule.profile = bundle; })), "decision_pattern_enforcement_invalid",
    { field: "enforcement.rules[0].profile" });
  refusedBy(run(edited((_rule, _bundle, decision) => {
    decision.enforcement.schema_version = "decision-required-patterns.prototype.v1"; })),
  "decision_pattern_enforcement_unsupported");
  refusedBy(run(edited((_rule, _bundle, decision) => { delete decision.enforcement; })),
    "decision_pattern_enforcement_missing");
  refusedBy(run(edited((_rule, _bundle, decision) => { decision.enforcement.rules = []; })),
    "decision_pattern_enforcement_invalid", { field: "enforcement.rules" });
  refusedBy(run(edited((rule) => { rule.applies_to = {}; })), "decision_pattern_enforcement_invalid",
    { field: "enforcement.rules[0].applies_to" });
  refusedBy(run({ decision: { ...DECISION, record_kind: "issue" }, sidecars: SIDECARS }), "decision_invalid");

  refusedBy(run({ decision: DECISION, sidecars: SIDECARS }, { ...INVENTORY, schema_version: "other" }),
    "policy_inventory_invalid");
  refusedBy(run({ decision: DECISION, sidecars: SIDECARS }, { ...INVENTORY, entries: [{ ...CODEX_ENTRY,
    bindings: { ...CODEX_ENTRY.bindings, nonexistent: null } }] }), "policy_inventory_binding_role_unknown");
  const mixed = compare(both, rows, { inventory: { ...INVENTORY,
    entries: [{ ...CODEX_ENTRY, kind: "other_kind" }, CLAUDE_ENTRY] } });
  assert.deepEqual([mixed.inventory.entries_without_rule, mixed.inputs.map((entry) => entry.input_id),
    mixed.totals.definitions.required], [[CODEX], [CLAUDE], 3]);

  const changed = compareContractToDecision({ ...repinned((_rule, bundle) => {
    bundle.claim_patterns[0].proposition_template.operator = "reference:emits"; }), inventory: INVENTORY, subject,
  contract: both, obligations: rows, decisionUse: DRAFT_EXPERIMENT_USE });
  assert.notEqual(changed.rules[0].patterns.content_digest, RULE.patterns.content_digest);
  for (const id of [CODEX, CLAUDE]) {
    assert.deepEqual(of(changed, id), { [`claim:${BEHAVIOR}`]: "missing", [`relation:${RELATIONSHIP}`]: "missing",
      [`obligation:${BEHAVIOR}`]: "missing" });
    assert.match(one(changed, id, `claim:${BEHAVIOR}`).what, / reference:emits /u);
  }
});

test("DECISION-SIDECAR-FIELD-POPULATION-BINDINGS", async () => {
  const population = await import("../fixtures/required-policy-population.mjs");
  const { declarations: D, objectIdentities, populationBindings, fieldIdentity } = population;
  const bundle = population.fieldPopulationBundle(5);
  const path = "closed-field-population.patterns.json";

  const decision = { ...DECISION, enforcement: { schema_version: DECISION_PATTERN_ENFORCEMENT_VERSION, rules: [{
    rule_id: "closed-error-body-fields", applies_to: { inventory_kind: "object_with_closed_fields" },
    patterns: { path, content_digest: controlledContractContentDigest(bundle) },
    clauses: { "object-has-field-population": ["1"], "object-has-field-population-verification": ["2"],
      "object-has-field-population-verifies": ["2"], "population-declares-cardinality": ["1"],
      "field-population-is-complete": ["1"], "exactly-the-expected-member-count": ["1"] },
    obligation_pattern_ids: [] }] } };
  const alpha = objectIdentities("alpha");
  const beta = objectIdentities("beta");
  const five = Object.values(alpha.field);
  const entry = (name, identities, members) => ({ input_id: name, interface: `${name} error body`,
    kind: "object_with_closed_fields", bindings: populationBindings(identities, members) });
  const inventory = (alphaMembers = five) => ({ schema_version: INVENTORY.schema_version,
    entries: [entry("alpha", alpha, alphaMembers), entry("beta", beta)] });
  const author = (requirements, contract = null) => population.authorDeclarations(requirements, { wkId: WK, contract });
  const betaComplete = await author([D.association(beta), D.contains(beta, Object.values(beta.field)),
    D.cardinality(beta, 5)]);
  const withAlpha = (requirements) => author(requirements, betaComplete);
  const run = (contract, supplied = inventory()) => compareContractToDecision({ decision, sidecars: { [path]: bundle },
    inventory: supplied, subject, contract, obligations: [], decisionUse: DRAFT_EXPERIMENT_USE });
  const closed = "reference_binding:field-population-is-complete";
  const counted = "binding_constraint:exactly-the-expected-member-count";

  const whole = run(await withAlpha([D.association(alpha), D.contains(alpha, five), D.cardinality(alpha, 5)]));
  assert.deepEqual([whole.status, whole.findings, whole.totals.definitions.required,
    whole.inputs.map((item) => [item.input_id, item.complete])], ["complete", [], 12, [["alpha", true], ["beta", true]]]);
  assert.deepEqual(whole.population_equalities, []);

  const alias = fieldIdentity("alpha", "code-alias");
  const spelled = run(await withAlpha([D.association(alpha), D.equal(alpha, alias, alpha.field.code),
    D.contains(alpha, five.slice(0, 3)), D.contains(alpha, [five[3], five[4], alias]), D.cardinality(alpha, 5)]));
  assert.deepEqual([spelled.status, spelled.population_equalities.map((entry) => [entry.input.input_id, entry.pattern_id,
    entry.status, entry.membership_claim_ids.length, entry.equated_reference_ids.length, entry.required_by.clauses])],
  ["complete", [["alpha", "field-population-is-complete", "supported", 2, 1, ["1"]]]]);

  const strict = { ...bundle, verification_falsifier_policy: "controlled_complement_per_target" };
  assert.throws(() => compareContractToDecision({ decision: { ...decision, enforcement: { ...decision.enforcement,
    rules: [{ ...decision.enforcement.rules[0],
      patterns: { path, content_digest: controlledContractContentDigest(strict) } }] } },
  sidecars: { [path]: strict }, inventory: inventory(), subject, contract: betaComplete, obligations: [],
  decisionUse: DRAFT_EXPERIMENT_USE }), (error) => {
    assert.equal(error.code, "decision_pattern_sidecar_invalid");
    assert.ok(error.details.diagnostics.includes("profile_verification_falsifier_not_complementary"));
    return true;
  });

  const omitted = run(await withAlpha([D.association(alpha), D.contains(alpha, five.slice(0, 4)), D.cardinality(alpha, 5)]));
  assert.deepEqual([of(omitted, "beta"), of(omitted, "alpha"), omitted.status],
    [{}, { [closed]: "missing", [counted]: "missing" }, "incomplete"]);
  const gap = one(omitted, "alpha", closed);
  assert.deepEqual([gap.required_by, gap.reasons], [{ decision_id: "DEC-9194", rule_id: "closed-error-body-fields",
    clauses: ["1"] }, ["member_referent_undeclared:field_member:alpha.error-body.field.cause"]]);

  assert.equal(gap.message, 'Your contract is missing closed population cc:population "alpha.error-body.fields" whose ' +
    'declared members are exactly {cc:entity "alpha.error-body.field.cause", cc:entity "alpha.error-body.field.code", ' +
    'cc:entity "alpha.error-body.field.family", cc:entity "alpha.error-body.field.phase", ' +
    'cc:entity "alpha.error-body.field.request_index"} for alpha error body (WK-9001), required by DEC-9194 ' +
    "(proposed, not accepted policy) clause 1, rule closed-error-body-fields.");
  assert.match(one(omitted, "alpha", counted).what, /^exactly 5 declared referent\(s\) for field_member: \{/u);

  const uncounted = run(await withAlpha([D.association(alpha), D.contains(alpha, five)]));
  assert.deepEqual(of(uncounted, "alpha"), { [closed]: "missing", "claim:population-declares-cardinality": "missing" });
  assert.deepEqual(one(uncounted, "alpha", closed).reasons, ["population_exact_cardinality_missing"]);
  const sixth = run(await withAlpha([D.association(alpha), D.contains(alpha, [...five, fieldIdentity("alpha", "extra")]),
    D.cardinality(alpha, 5)]));
  assert.deepEqual(of(sixth, "alpha"), { [closed]: "missing", "claim:population-declares-cardinality": "affected" });
  assert.deepEqual([one(sixth, "alpha", closed).reasons,
    one(sixth, "alpha", "claim:population-declares-cardinality").structural_diagnostics,
    sixth.authored_contract.structurally_valid],
  [["population_binding_not_complete", "population_membership_incomplete"], ["direct_proposition_contradiction"], false]);

  const partial = run(await withAlpha([D.association(alpha), D.contains(alpha, five), D.cardinality(alpha, 5)]),
    inventory([...five.slice(0, 4), null]));
  assert.deepEqual([of(partial, "alpha"), partial.status, partial.totals.definitions.missing],
    [{ [closed]: "unresolved", [counted]: "unresolved" }, "incomplete", 0]);
  assert.match(one(partial, "alpha", closed).message,
    /^It could not be determined whether your contract has closed population .*<field_member: binding unavailable>/u);

  const inputs = structuredClone({ decision, bundle });
  const supplied = inventory([...five, ...five].reverse());
  const repeated = run(await withAlpha([D.association(alpha), D.contains(alpha, five.slice(0, 4)), D.cardinality(alpha, 5)]),
    supplied);
  assert.deepEqual({ ...repeated, inventory: null }, { ...omitted, inventory: null });
  assert.deepEqual({ decision, bundle }, inputs);

  assert.throws(() => run(betaComplete, { ...inventory(), entries: [{ ...entry("alpha", alpha), bindings:
    { ...populationBindings(alpha), field_member: five[0] } }] }), (error) => {
    assert.deepEqual([error.code, error.details.field], ["required_policy_input_invalid", "bindings.field_member"]);
    return true;
  });
});
