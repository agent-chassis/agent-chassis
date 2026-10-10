

import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_POLICY_ASSESSMENT_VERSION, assessRequiredPolicies
} from "../../packages/wiki-core/src/operations/controlled-contract/required-policy-assessment.mjs";
import {
  DIFFERENT_REJECTED_VERIFICATION, GAUGE_EXPECTED_PATTERN_IDS, GAUGE_PATTERN_IDS, GAUGE_REQUIREMENTS,
  GAUGE_REFERENTS, INPUT_BEHAVIOR_SET_PATTERN, SIBLING_REQUIREMENT, compileGaugeRequirements,
  gaugeDependencyRelations, gaugeDraftPolicy, verification, when
} from "../fixtures/required-policy-assessment.mjs";

const WK = "WK-9001";
const subject = Object.freeze({ unit: WK, wk_id: WK, selected_unit: null, focus: null });
const WHOLE = Object.freeze({ scope: "whole_unit" });
const policy = gaugeDraftPolicy({ unit: WK });
const compile = (requirements, contract = null) => compileGaugeRequirements(requirements, { wkId: WK, contract });
const authored = await compile(Object.values(GAUGE_REQUIREMENTS));
const [declaration, accepted, rejected] = authored.compiled;
const dependencies = gaugeDependencyRelations({ declaration: declaration.claim_id,
  accepted: accepted.claim_id, rejected: rejected.claim_id });

const complete = { ...structuredClone(authored.content),
  relations: [...structuredClone(authored.content.relations), ...dependencies] };
const obligation = (name, claimId) => ({ obligation_id: `OBL-${name}`, wk_id: WK, focus: null,
  statement: `${name}: the stated set-level behavior holds`, controlled_contract_node_ids: [claimId],
  proof_opt_out: true });
const rows = [obligation("range", declaration.claim_id), obligation("accepted", accepted.claim_id),
  obligation("out-of-range", rejected.claim_id)];
const verifiesOf = (target) => complete.relations.find((row) => row.role === "verifies" &&
  row.target_claim_id === target).relation_id;
const [acceptedDependency, rejectedDependency] = dependencies.map((row) => row.relation_id);
const without = (edits) => {
  const next = structuredClone(complete);
  for (const [population, field, ids] of edits) next[population] = next[population].filter((row) =>
    !ids.includes(row[field]));
  return next;
};
const assess = (contract, obligations = rows, changes = {}) => assessRequiredPolicies({ policies: [policy],
  subject, contract, obligations, selection: WHOLE, ...changes });
const only = (result) => { assert.equal(result.policies.length, 1); return result.policies[0]; };
const statuses = (entry) => Object.fromEntries(entry.expectations.map((row) => [row.pattern_id, row.status]));
const obligations = (entry) => Object.fromEntries(entry.obligation_support.map((row) => [row.pattern_id, row.status]));
const expectation = (entry, id) => entry.expectations.find((row) => row.pattern_id === id);
const all = (status) => Object.fromEntries(GAUGE_EXPECTED_PATTERN_IDS.map((id) => [id, status]));
const allObligations = (status) => Object.fromEntries([...GAUGE_PATTERN_IDS.behaviors].sort().map((id) => [id, status]));
const structural = (entry) => entry.authored_contract.structural_diagnostics.map(({ code }) => code).sort();

const assertPopulation = (entry) => {
  assert.deepEqual(entry.expectations.map((row) => row.pattern_id), GAUGE_EXPECTED_PATTERN_IDS);
  assert.deepEqual(entry.obligation_support.map((row) => row.pattern_id), [...GAUGE_PATTERN_IDS.behaviors].sort());
  assert.equal(entry.counts.expectations.required, 11);
  assert.equal(entry.counts.obligations.required, 3);
};
const OUT = { behavior: "out-of-range-behavior", verification: "out-of-range-verification",
  relationship: "out-of-range-verifies", dependency: "out-of-range-depends-on-declaration" };
const ACCEPTED_DEPENDENCY = "accepted-depends-on-declaration";

test("REQUIRED-POLICY-EMPTY-AND-COMPLETE", () => {

  const none = assess(null, []);
  assert.equal(none.schema_version, REQUIRED_POLICY_ASSESSMENT_VERSION);
  assert.equal(none.experimental, true);
  const empty = only(none);
  assertPopulation(empty);
  assert.equal(empty.status, "assessed");
  assert.deepEqual(statuses(empty), all("missing"));
  assert.deepEqual(obligations(empty), allObligations("missing"));
  assert.equal(empty.authored_contract.present, false);
  assert.deepEqual(structural(empty), ["empty_contract"]);
  assert.ok(Object.values(empty.bindings).every((state) => state === "referent_undeclared"));
  assert.deepEqual(expectation(empty, "range-declaration").reasons, ["referent_undeclared:level"]);
  assert.equal(empty.definition_coverage_complete, false);
  assert.deepEqual(none.whole_unit_definition_coverage, { claimed: true, complete: false });
  assert.ok(Object.values(none.authority).every((granted) => granted === false));

  const referents = only(assess({ ...structuredClone(complete), propositions: [], claims: [], relations: [] }, []));
  assertPopulation(referents);
  assert.ok(Object.values(referents.bindings).every((state) => state === "bound"));
  assert.deepEqual(statuses(referents), all("missing"));
  assert.deepEqual(expectation(referents, "accepted-behavior").reasons, ["no_matching_authored_claim"]);
  assert.deepEqual(expectation(referents, "accepted-verifies").reasons, ["endpoint_not_authored"]);
  assert.deepEqual(structural(referents), ["empty_contract"]);

  const whole = assess(complete);
  const full = only(whole);
  assertPopulation(full);
  assert.deepEqual(statuses(full), all("supported"));
  assert.deepEqual(obligations(full), allObligations("supported"));
  assert.equal(full.authored_contract.structurally_valid, true);
  assert.equal(full.matcher.admission.kind, "unadmitted_direct");
  assert.equal(full.definition_coverage_complete, true);
  assert.deepEqual(whole.whole_unit_definition_coverage, { claimed: true, complete: true });
  assert.ok(rows.every((row) => row.selection === undefined));
});

test("REQUIRED-POLICY-OMISSIONS", async () => {
  const cases = [
    ["out-of-range leg omitted cleanly", without([
      ["claims", "claim_id", [rejected.claim_id, rejected.verification_claim_id]],
      ["relations", "relation_id", [verifiesOf(rejected.claim_id), rejectedDependency]]]), rows,
    { [OUT.behavior]: "missing", [OUT.verification]: "missing", [OUT.relationship]: "missing",
      [OUT.dependency]: "missing" }, { [OUT.behavior]: "missing" }, []],
    ["accepted leg omitted cleanly", without([
      ["claims", "claim_id", [accepted.claim_id, accepted.verification_claim_id]],
      ["relations", "relation_id", [verifiesOf(accepted.claim_id), acceptedDependency]]]), rows,
    { "accepted-behavior": "missing", "accepted-verification": "missing", "accepted-verifies": "missing",
      [ACCEPTED_DEPENDENCY]: "missing" }, { "accepted-behavior": "missing" }, []],
    ["omitted behavior with dangling residue", without([["claims", "claim_id", [rejected.claim_id]]]), rows,
      { [OUT.behavior]: "missing", [OUT.relationship]: "missing", [OUT.dependency]: "missing",
        [OUT.verification]: "affected" }, { [OUT.behavior]: "missing" },
      ["dangling_relation_source", "dangling_relation_target", "mandatory_verification_unattached"]],
    ["missing obligation", complete, rows.slice(0, 2), {}, { [OUT.behavior]: "missing" }, []],
    ["missing verification claim", without([["claims", "claim_id", [rejected.verification_claim_id]]]), rows,
      { [OUT.verification]: "missing", [OUT.relationship]: "missing", [OUT.behavior]: "affected" }, {},
      ["dangling_relation_source", "mandatory_behavior_unverified"]],
    ["missing verifies edge", without([["relations", "relation_id", [verifiesOf(rejected.claim_id)]]]), rows,
      { [OUT.relationship]: "missing", [OUT.behavior]: "affected", [OUT.verification]: "affected" }, {},
      ["mandatory_behavior_unverified", "mandatory_verification_unattached"]],
    ["a different linked verification", (await compile([{ ...GAUGE_REQUIREMENTS.rejected,
      verification: DIFFERENT_REJECTED_VERIFICATION }], without([
      ["claims", "claim_id", [rejected.verification_claim_id]],
      ["relations", "relation_id", [verifiesOf(rejected.claim_id)]]]))).content, rows,
    { [OUT.verification]: "missing", [OUT.relationship]: "missing" }, {}, []],

    ["missing dependency edge", without([["relations", "relation_id", [rejectedDependency]]]), rows,
      { [OUT.dependency]: "missing" }, {}, []],

    ["missing range declaration with dangling residue", without([["claims", "claim_id", [declaration.claim_id]]]),
      rows, { "range-declaration": "missing", "range-declaration-verifies": "missing",
        [ACCEPTED_DEPENDENCY]: "missing", [OUT.dependency]: "missing",
        "range-declaration-verification": "affected" },
      { "range-declaration": "missing" }, ["dangling_relation_target", "mandatory_verification_unattached"]]
  ];
  for (const [name, contract, saved, changed, changedObligations, diagnostics] of cases) {
    const entry = only(assess(contract, saved));
    assertPopulation(entry);
    assert.deepEqual(statuses(entry), { ...all("supported"), ...changed }, name);
    assert.deepEqual(obligations(entry), { ...allObligations("supported"), ...changedObligations }, name);

    assert.deepEqual([...new Set(structural(entry))], diagnostics, name);
    assert.equal(entry.authored_contract.structurally_valid, diagnostics.length === 0, name);
    assert.equal(entry.definition_coverage_complete, false, name);
  }

  const residue = only(assess(without([["claims", "claim_id", [rejected.claim_id]]])));
  assert.deepEqual(expectation(residue, OUT.behavior).reasons, ["no_matching_authored_claim"]);
  assert.deepEqual(expectation(residue, OUT.relationship).reasons, ["endpoint_not_authored"]);

  const unattached = expectation(residue, OUT.verification);
  assert.deepEqual([unattached.declaration_matched, unattached.status, unattached.structural_diagnostics,
    unattached.reasons], [true, "affected", ["mandatory_verification_unattached"],
    ["structural_diagnostic:mandatory_verification_unattached"]]);
  assert.equal(residue.counts.expectations.affected, 1);

  const edgeless = only(assess(without([["relations", "relation_id", [rejectedDependency]]])));
  assert.deepEqual([expectation(edgeless, OUT.dependency).matcher_status,
    expectation(edgeless, OUT.dependency).reasons, expectation(edgeless, OUT.behavior).status,
    expectation(edgeless, "range-declaration").status],
  ["unsatisfied", ["no_matching_authored_relationship"], "supported", "supported"]);
  assert.equal(edgeless.authored_contract.structurally_valid, true);
  assert.equal(edgeless.matcher.satisfaction, "unsatisfied");
  const orphaned = only(assess(without([["claims", "claim_id", [declaration.claim_id]]])));
  assert.deepEqual(expectation(orphaned, OUT.dependency).reasons, ["endpoint_not_authored"]);
  assert.equal(residue.obligation_support.find((row) => row.pattern_id === OUT.behavior).reasons[0],
    "required_claim_not_authored");
  const edge = only(assess(without([["relations", "relation_id", [verifiesOf(rejected.claim_id)]]])));
  assert.deepEqual(expectation(edge, OUT.relationship).reasons, ["no_matching_authored_relationship"]);
  assert.deepEqual(expectation(edge, OUT.behavior).structural_diagnostics, ["mandatory_behavior_unverified"]);

  assert.equal(obligations(edge)[OUT.behavior], "supported");
  const unpaid = only(assess(complete, rows.slice(0, 2)));
  assert.deepEqual(unpaid.obligation_support.find((row) => row.pattern_id === OUT.behavior).reasons,
    ["no_qualifying_same_subject_obligation"]);

  for (const other of [{ ...rows[2], wk_id: "WK-9002" }, { ...rows[2], focus: "other" },
    { ...rows[2], controlled_contract_node_ids: [accepted.claim_id] }, { ...rows[2], statement: " " }]) {
    assert.equal(obligations(only(assess(complete, [rows[0], rows[1], other])))[OUT.behavior], "missing");
  }
});

test("REQUIRED-POLICY-MATCHER-VERDICT-AND-STRUCTURE", async () => {

  const withSet = { ...policy, profile: { ...policy.profile,
    collection_patterns: [INPUT_BEHAVIOR_SET_PATTERN],
    satisfaction_expression: { all_of: [...policy.profile.satisfaction_expression.all_of,
      { pattern: INPUT_BEHAVIOR_SET_PATTERN.pattern_id }] } } };
  const judge = (contract) => only(assessRequiredPolicies({ policies: [withSet], subject, contract,
    obligations: rows, selection: WHOLE }));
  const unset = judge(complete);
  const set = expectation(unset, "input-behavior-set");
  assert.equal(unset.counts.expectations.required, 12);
  assert.deepEqual([set.pattern_kind, set.matcher_status, set.status, set.reasons],
    ["collection", "unsatisfied", "missing", ["no_matching_authored_collection"]]);

  assert.deepEqual(statuses(unset), { ...all("supported"), "input-behavior-set": "missing" });
  assert.deepEqual(obligations(unset), allObligations("supported"));
  assert.equal(unset.matcher.satisfaction, "unsatisfied");
  assert.equal(unset.definition_coverage_complete, false);
  const collected = judge({ ...structuredClone(complete), collections: [{ collection_id: "set-input-behaviors",
    collection_kind: "closed_set", purpose: "input_behaviors",
    member_claim_ids: [accepted.claim_id, rejected.claim_id].sort() }] });
  assert.deepEqual(statuses(collected), { ...all("supported"), "input-behavior-set": "supported" });
  assert.equal(collected.matcher.satisfaction, "satisfied");
  assert.equal(collected.definition_coverage_complete, true);

  assert.deepEqual(expectation(judge(without([
    ["claims", "claim_id", [rejected.claim_id, rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(rejected.claim_id), rejectedDependency]]])),
  "input-behavior-set").reasons, ["endpoint_not_authored"]);

  const withEvidence = only(assessRequiredPolicies({ policies: [{ ...policy, profile: { ...policy.profile,
    evidence_patterns: [{ pattern_id: "accepted-test-run", evidence_kind: "test_run",
      verification_claim_pattern_id: "accepted-verification" }] } }], subject, contract: complete,
  obligations: rows, selection: WHOLE }));
  assert.deepEqual([withEvidence.status, withEvidence.reason], ["not_assessed", "matcher_refused"]);
  assert.deepEqual(expectation(withEvidence, "accepted-test-run").status, "unresolved");
  assert.equal(withEvidence.counts.expectations.unresolved, withEvidence.counts.expectations.required);
  assert.equal(withEvidence.definition_coverage_complete, false);

  const affected = only(assess(without([["relations", "relation_id", [verifiesOf(accepted.claim_id)]]])));
  assert.deepEqual(statuses(affected), { ...all("supported"), "accepted-behavior": "affected",
    "accepted-verification": "affected", "accepted-verifies": "missing" });
  assert.equal(affected.definition_coverage_complete, false);

  const sibling = await compile([SIBLING_REQUIREMENT], complete);
  const brokenSibling = structuredClone(sibling.content);
  brokenSibling.relations = brokenSibling.relations.filter((row) =>
    row.target_claim_id !== sibling.compiled[0].claim_id);
  const unrelated = only(assess(brokenSibling));
  assert.deepEqual(statuses(unrelated), all("supported"));
  assert.ok(unrelated.expectations.every((row) => row.structural_diagnostics.length === 0));
  assert.equal(unrelated.authored_contract.structurally_valid, false);
  assert.deepEqual(structural(unrelated), ["mandatory_behavior_unverified", "mandatory_verification_unattached"]);

  const twiceRelated = structuredClone(complete);
  twiceRelated.relations.push(structuredClone(twiceRelated.relations.find((row) =>
    row.relation_id === verifiesOf(accepted.claim_id))));
  const ambiguous = only(assess(twiceRelated));
  assert.deepEqual([expectation(ambiguous, "accepted-verifies").status,
    expectation(ambiguous, "accepted-verifies").reasons],
  ["unresolved", ["identity_ambiguous:duplicate_relation_id"]]);
  assert.equal(ambiguous.definition_coverage_complete, false);

  const stale = assessRequiredPolicies({ policies: [policy], subject, contract: null, obligations: [],
    selection: WHOLE, unavailable: "source_revision_moved" });
  assert.equal(stale.status, "unavailable");
  assertPopulation(only(stale));
  assert.deepEqual([only(stale).status, only(stale).reason], ["not_assessed", "source_revision_moved"]);
  assert.deepEqual(statuses(only(stale)), all("unresolved"));
  assert.deepEqual(stale.whole_unit_definition_coverage, { claimed: true, complete: false });
});

test("REQUIRED-POLICY-SCOPE-BINDING-AND-POPULATION", async () => {

  const sibling = only(assess((await compile([SIBLING_REQUIREMENT], complete)).content));
  assertPopulation(sibling);
  assert.deepEqual(statuses(sibling), all("supported"));
  assert.equal(sibling.definition_coverage_complete, true);

  const alone = only(assess((await compile([SIBLING_REQUIREMENT])).content, []));
  assertPopulation(alone);
  assert.deepEqual(statuses(alone), all("missing"));
  assert.equal(alone.authored_contract.structurally_valid, true);

  for (const scope of [{ unit: "WK-9002", focus: null }, { unit: WK, focus: "other" }]) {
    const result = assessRequiredPolicies({ policies: [{ ...policy, scope }], subject, contract: complete,
      obligations: rows, selection: WHOLE });
    const entry = only(result);
    assertPopulation(entry);
    assert.equal(result.status, "partially_assessed");
    assert.deepEqual([entry.status, entry.reason], ["not_assessed", "policy_scope_mismatch"]);
    assert.deepEqual(statuses(entry), all("unresolved"));
    assert.deepEqual(obligations(entry), allObligations("unresolved"));
    assert.equal(entry.definition_coverage_complete, false);
    assert.deepEqual(result.whole_unit_definition_coverage, { claimed: true, complete: false });
  }

  const unbound = only(assessRequiredPolicies({ policies: [{ ...policy,
    bindings: { ...policy.bindings, outside_range: null } }], subject, contract: complete, obligations: rows,
  selection: WHOLE }));
  assertPopulation(unbound);
  assert.equal(unbound.bindings.outside_range, "binding_unavailable");
  assert.deepEqual(statuses(unbound), { ...all("supported"), [OUT.behavior]: "unresolved",
    [OUT.verification]: "unresolved", [OUT.relationship]: "unresolved", [OUT.dependency]: "unresolved" });
  assert.deepEqual(expectation(unbound, OUT.behavior).reasons, ["binding_unavailable:outside_range"]);
  assert.deepEqual(expectation(unbound, OUT.relationship).reasons, ["endpoint_unresolved"]);
  assert.equal(obligations(unbound)[OUT.behavior], "unresolved");
  assert.equal(unbound.definition_coverage_complete, false);

  const twice = structuredClone(complete);
  const level = twice.references.find((row) => row.identity.term === "gauge.level-input");
  twice.references.push({ ...structuredClone(level), reference_id: "ref-second-level" });
  const ambiguous = only(assess(twice));
  assert.equal(ambiguous.bindings.level, "referent_ambiguous");
  assert.equal(statuses(ambiguous)["range-declaration"], "unresolved");

  assert.deepEqual(assess(complete, rows, { selection: { scope: "selected_obligation" } })
    .whole_unit_definition_coverage, { claimed: false, complete: null, reason: "selected_obligation_request" });

  const reversed = (value) => Array.isArray(value) ? value.map(reversed).reverse()
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, member]) => [key, reversed(member)]))
      : value;
  const permuted = { ...reversed(policy), profile: { ...policy.profile,
    reference_roles: [...policy.profile.reference_roles].reverse(),
    claim_patterns: [...policy.profile.claim_patterns].reverse(),
    relation_patterns: [...policy.profile.relation_patterns].reverse() } };
  const second = { ...gaugeDraftPolicy({ unit: WK }), policy_id: "draft.another" };
  const baseline = assessRequiredPolicies({ policies: [policy, second], subject, contract: complete,
    obligations: rows, selection: WHOLE });
  assert.deepEqual(baseline.policies.map((entry) => entry.policy_id),
    ["draft.another", "draft.gauge-set-level-input-contract"]);
  const again = assessRequiredPolicies({ policies: [second, policy, structuredClone(policy), second], subject,
    contract: complete, obligations: [...rows].reverse(), selection: WHOLE });
  assert.deepEqual(again, baseline);
  const shuffled = only(assessRequiredPolicies({ policies: [permuted], subject, contract: complete,
    obligations: rows, selection: WHOLE }));
  assert.deepEqual([statuses(shuffled), obligations(shuffled), shuffled.counts],
    [all("supported"), allObligations("supported"), only(assess(complete)).counts]);

  const refused = (policies, field) => assert.throws(() => assessRequiredPolicies({ policies, subject,
    contract: complete, obligations: rows, selection: WHOLE }), (error) => {
    assert.equal(error.code, "required_policy_input_invalid");
    assert.equal(error.details.field, field, error.message);
    return true;
  });
  refused("none", "policies");
  refused([{ ...policy, trust: true }], "trust");
  refused([{ ...policy, scope: { unit: WK } }], "scope");
  refused([{ ...policy, bindings: { ...policy.bindings, nonexistent: null } }], "bindings.nonexistent");

  refused([{ ...policy, bindings: { ...policy.bindings, level: [policy.bindings.level] } }], "bindings.level");
  refused([{ ...policy, obligation_pattern_ids: ["nonexistent"] }], "obligation_pattern_ids");
  refused([policy, { ...policy, status: "changed" }], "policies");

  const broken = only(assessRequiredPolicies({ policies: [{ ...policy, profile: { ...policy.profile,
    satisfaction_expression: "none" } }], subject, contract: complete, obligations: rows, selection: WHOLE }));
  assertPopulation(broken);
  assert.deepEqual([broken.status, broken.reason, broken.matcher.refused],
    ["not_assessed", "matcher_refused", "stable_family_refused"]);
  assert.deepEqual(statuses(broken), all("unresolved"));
});

test("REQUIRED-POLICY-THE-EXISTING-GRAMMAR-GOVERNS", async () => {
  const R = GAUGE_REFERENTS;
  const declare = (referent) => ({ declare: structuredClone(referent) });
  const term = (type_term, name) => ({ type_term, identity: { kind: "profile_term", term: name } });

  const legless = without([["claims", "claim_id", [rejected.claim_id, rejected.verification_claim_id]],
    ["relations", "relation_id", [verifiesOf(rejected.claim_id), rejectedDependency]]]);
  const LEG_MISSING = { [OUT.behavior]: "missing", [OUT.verification]: "missing", [OUT.relationship]: "missing",
    [OUT.dependency]: "missing" };
  const behaviorOf = (subjectRef, relation, object, scope) => ({ nature: "behavior", modality: "MUST",
    subject: declare(subjectRef), behavior: when(relation, object, scope),
    verification: verification(term("cc:test", "gauge.candidate-check"), R.operation,
      when("reference:writes", R.accepted_effect, scope)) });

  assert.equal(Object.hasOwn(policy.profile, "verification_falsifier_policy"), false);
  const full = only(assess(complete));
  assert.deepEqual([full.definition_coverage_complete, Object.keys(full.counts.expectations)],
    [true, ["required", "supported", "affected", "missing", "unresolved"]]);
  assert.ok(full.expectations.every((row) => row.population_sources === null));

  const prose = term("cc:state", "gauge.contract-prose: a level outside the declared range is answered with the range error");
  const candidates = [
    ["prose inside a named referent", behaviorOf(R.operation, "reference:conforms_to", prose, R.outside_range)],
    ["another subject", behaviorOf(term("cc:operation", "gauge.read-level"), "reference:returns", R.refusal_result,
      R.outside_range)],
    ["another condition", behaviorOf(R.operation, "reference:returns", R.refusal_result, R.inside_range)],
    ["another value", behaviorOf(R.operation, "reference:returns", term("cc:artifact", "gauge.other-error"),
      R.outside_range)]];
  for (const [name, requirement] of candidates) {
    const compiled = await compile([requirement], legless);

    const entry = only(assess(compiled.content, [rows[0], rows[1],
      { ...rows[2], controlled_contract_node_ids: [compiled.compiled[0].claim_id] }]));
    assertPopulation(entry);
    assert.deepEqual(statuses(entry), { ...all("supported"), ...LEG_MISSING }, name);
    assert.deepEqual(obligations(entry), { ...allObligations("supported"), [OUT.behavior]: "missing" }, name);
    assert.equal(entry.authored_contract.structurally_valid, true, name);
  }

  const strict = only(assessRequiredPolicies({ policies: [{ ...policy, profile: { ...policy.profile,
    verification_falsifier_policy: "controlled_complement_per_target" } }], subject, contract: complete,
  obligations: rows, selection: WHOLE }));
  assertPopulation(strict);
  assert.deepEqual([strict.status, strict.reason, strict.matcher.satisfaction, statuses(strict),
    strict.definition_coverage_complete], ["not_assessed", "matcher_input_invalid", "invalid", all("unresolved"), false]);
  assert.ok(strict.matcher.diagnostics.some(({ code }) => code === "profile_verification_falsifier_not_complementary"));
});
