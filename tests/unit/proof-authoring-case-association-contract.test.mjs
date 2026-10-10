

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableTestProofBindingTemplate
} from "@agent-chassis/controlled-contract";
import {
  CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD,
  CASE_VERIFICATION_ASSOCIATION_FIELD,
  NATIVE_TEST_CASE_AUTHORING_GUIDANCE,
  applyNativeTestProofCase,
  caseUseExcludesVerification,
  eligibleCaseVerificationIds,
  emptyCaseContract
} from "@agent-chassis/controlled-contract/native-test-cases";
import {
  PROOF_PREREQUISITE_CODES
} from "@agent-chassis/controlled-contract/proof-contract";
import {
  OCCURRENCE_CORRECTION_CLAUSES,
  occurrenceRecoveryFacts,
  occurrenceRecoverySummary,
  typedBindingFailurePaths
} from "@agent-chassis/controlled-contract/executable-map";
import {
  CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD_PATH,
  CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA,
  CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
  CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  proofAuthoringGroupDiagnosis,
  projectProofAuthoringDiagnosticGroups
} from "../../packages/wiki-core/src/operations/controlled-contract/proof-authoring-diagnostic-projection.mjs";

const UPSERT = "workspace_controlled_contract_obligation_coverage_upsert";
const INCOMPLETE = "obligation_coverage_native_binding_case_incomplete";

const verificationClaim = (id) => ({ claim_id: id, kind: "verification",
  verification_method: "test_execution", proposition_id: `prop-${id}`,
  falsifying_proposition_id: `prop-${id}-false` });

const caseInput = (over = {}) => ({ case_id: "case-one",
  observation: { kind: "return_value" }, ...over });

const applied = (contract, row, over) => applyNativeTestProofCase({ contract, row,
  caseInput: caseInput(over), subject: "WK-9999",
  buildTemplate: buildStableTestProofBindingTemplate });

const refusalOf = (apply) => {
  try {
    apply();
  } catch (error) {
    return error;
  }
  return assert.fail("the application was expected to refuse");
};

const groupedWith = (group) => ({
  version: "proof-authoring-diagnostic-groups.v2",
  identity_digest: "sha256:identity",
  counts: {}, categories: [],
  groups: [{
    semantic_key: "key-one", category: "author_input",
    owner: "@agent-chassis/controlled-contract", code: INCOMPLETE,
    severity: "unspecified", actionable_meaning: "unfinished case content",
    route_effect: "blocking", occurrence_count: 1, affected_obligation_count: 1,
    global_occurrence_count: 0, ...group
  }]
});

const occurrence = (obligationId, caseId) => ({ obligation_id: obligationId,
  diagnostic: { problem: { cause: { case_id: caseId } } } });

const typedDiagnostic = diagnostics => ({
  code: INCOMPLETE,
  problem: { cause: { owner_details: { diagnostics } } }
});

test("typed case recovery preserves property paths while keeping prose bounded", () => {
  const diagnostic = typedDiagnostic([
    { instancePath: "/falsification", keyword: "required",
      params: { missingProperty: "candidate_execution_provider" } },
    { instancePath: "/falsification", keyword: "additionalProperties",
      params: { additionalProperty: "extra~/field" } },
    { instancePath: "", keyword: "required",
      params: { missingProperty: "verification_claim_id" } }
  ]);
  assert.deepEqual(typedBindingFailurePaths(diagnostic), [
    "/falsification/candidate_execution_provider",
    "/falsification/extra~0~1field",
    "/verification_claim_id"
  ]);
  const prose = occurrenceRecoverySummary(diagnostic, { summary: "static fallback" });
  assert.match(prose, /reported 3 failed field paths/u);
  assert.match(prose, /Correct the case's verification association/u);
  assert.doesNotMatch(prose, /upsert/u);
  for (const path of typedBindingFailurePaths(diagnostic)) {
    assert.doesNotMatch(prose, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }

  const absent = occurrenceRecoverySummary(typedDiagnostic([]), {
    summary: "exact failed paths were published; repair verification links"
  });
  assert.match(absent, /No typed failed field path was published/u);
  assert.match(absent, /does not identify a verification-association repair/u);
  assert.doesNotMatch(absent, /exact failed paths were published/u);
});

const projectedCall = (grouped) => projectProofAuthoringDiagnosticGroups({
  grouped, resultIdentity: grouped.identity_digest, wkId: "WK-9999"
}).groups[0].route_assessment.recovery?.supported_next_call ?? null;

test("the incomplete-binding recovery advertises only inputs the named tool declares", () => {
  const entry = PROOF_PREREQUISITE_CODES.byCode.get(INCOMPLETE);
  assert.equal(entry.recovery.route, UPSERT);
  const declared = Object.keys(
    CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA.properties);

  for (const fact of ["verification_id", "incomplete_content"]) {
    assert.equal(declared.includes(fact), false,
      `${fact} is not an input of ${UPSERT}, so no recovery may bind it as one`);
  }
  for (const argument of Object.keys(entry.recovery.argument_bindings ?? {})) {
    assert.equal(declared.includes(argument), true,
      `${INCOMPLETE} advertises ${argument}, which ${UPSERT} does not accept`);
  }

  assert.equal(entry.detail_facts.includes("owner_details"), true);
  assert.equal(entry.required_facts.includes("verification_id"), true);

  assert.match(entry.recovery.summary, /obligations\[\]\.case /u);
  assert.doesNotMatch(entry.recovery.summary, /upsert/u);
  assert.doesNotMatch(entry.recovery.summary, /verification_id/u);
  assert.doesNotMatch(entry.recovery.summary, /controlled_contract_node_ids/u);
  assert.match(entry.recovery.summary, /never supply or edit the derived binding itself/u);
});

test("an advertised authoring route is addressed by the obligations and cases of its own group", () => {
  const call = projectedCall(groupedWith({
    affected_obligation_ids: ["OBL-A", "OBL-B"],
    occurrences: [occurrence("OBL-A", "case-a"), occurrence("OBL-B", "case-b")],
    route_assessment: { effect: "blocking", stage: "authored_inputs",
      selected_route: "provider_bound_test_validity", owner_code: INCOMPLETE,
      reason: "unfinished case content", unavailable_operation: null,
      responsible_owner: "@agent-chassis/controlled-contract",
      recovery: { status: "operator_action", operator_action: "re-author the case",
        explanation: "success condition", supported_next_call: {
          tool: UPSERT, kind: "structured_route", arguments: {} } } }
  }));
  assert.deepEqual(call.arguments, { unit: "WK-9999", obligations: [
    { obligation_id: "OBL-A", case: { case_id: "case-a" } },
    { obligation_id: "OBL-B", case: { case_id: "case-b" } }
  ] }, "the call names every obligation the group published and the case each occurrence names");
  for (const argument of Object.keys(call.arguments)) {
    assert.equal(Object.hasOwn(
      CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA.properties, argument), true,
    `${argument} is not an input of ${UPSERT}`);
  }

  assert.deepEqual(Object.keys(call.arguments.obligations[0].case), ["case_id"]);
});

test("a route this owner does not author, and a group with no obligation, are left exactly as declared", () => {
  const withRecovery = (supported, over) => groupedWith({
    affected_obligation_ids: over?.affected ?? [],
    occurrences: over?.occurrences ?? [{ obligation_id: null, diagnostic: {} }],
    route_assessment: { effect: "blocking", stage: "authored_inputs",
      selected_route: "provider_bound_test_validity", owner_code: INCOMPLETE,
      reason: "unfinished case content", unavailable_operation: null,
      responsible_owner: "@agent-chassis/controlled-contract",
      recovery: { status: "operator_action", operator_action: "act",
        explanation: "why", supported_next_call: supported } }
  });
  const foreign = { tool: "workspace_work_record_edit", kind: "structured_route",
    arguments: { verification_id: "claim-one" } };
  assert.deepEqual(projectedCall(withRecovery(foreign, {
    affected: ["OBL-A"], occurrences: [occurrence("OBL-A", "case-a")] })), foreign,
  "a route another owner declares is not re-addressed here");
  assert.deepEqual(projectedCall(withRecovery({ tool: UPSERT, kind: "structured_route",
    arguments: { } })), { tool: UPSERT, kind: "structured_route", arguments: {} },
  "a group with no affected obligation advertises no addressing it does not have");
  assert.equal(projectedCall(withRecovery(null)), null);
});

test("the eligibility relationship is published once and routes to the identity owner", () => {
  const member = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.verification_association;
  assert.equal(member.field, CASE_VERIFICATION_ASSOCIATION_FIELD);
  assert.match(member.eligible, /controlled_contract_node_ids/u);
  assert.match(member.eligible, /test_execution/u);
  assert.match(member.correction, /controlled_contract_node_ids/u);

  assert.match(member.eligible, /explicit verifies relationship ties to a requirement claim it lists/u);
  assert.match(member.eligible, /executable binding exists never changes it/u);
  assert.doesNotMatch(JSON.stringify(member), /leaves no eligible verification/u);
  assert.match(member.authoring.omit_when, /requirement makes each verification that verifies it eligible/u);

  assert.match(member.derived_from_association, /never authored/u);

  const population = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE
    .required_object_shapes.requirement_rebinding.complete_case_population;
  assert.match(member.identities, /complete_case_population/u);
  assert.equal(JSON.stringify(member).includes(population), false,
    "the identity-reading rule is routed to, never copied");

  assert.deepEqual(CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.case_verification_association,
    ["case_authoring", "verification_association"]);
  const bound = CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS.find((location) =>
    location.path.join(".") === CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH.join("."));
  assert.ok(bound, "the authored case field binds a request location");
  assert.deepEqual([...bound.guidance_path], ["case_authoring", "verification_association"]);

  assert.deepEqual([CASE_VERIFICATION_ASSOCIATION_FIELD, CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD],
    ["obligations[].case.verification_id", "obligations[].case.verification"]);
  assert.equal(CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD_PATH, "$.obligations[].case.verification");
  assert.equal(OCCURRENCE_CORRECTION_CLAUSES.association.field, CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD);
});

test("the case purpose names every authored member and the authority routes to it", () => {
  const purpose = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.purpose;
  assert.match(purpose, /^Author case\.target, case\.observation and case\.falsification for an obligation verified by test_execution/u);

  assert.match(purpose, /case\.observation \(the derived binding's observable_result comes from it\)/u);
  const routed = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE.authority.case_members;
  assert.deepEqual(routed.arguments.input_contract, { kind: "guidance", path: ["case_authoring", "purpose"] });
  assert.equal(CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE.case_authoring.purpose, purpose);
});

test("a native case-association refusal names the deciding field and the identities it considered", () => {
  const contract = emptyCaseContract();
  contract.claims.push(verificationClaim("claim-one"), verificationClaim("claim-two"));
  contract.test_proofs.push(
    { test_proof_id: "test-proof-one", verification_claim_id: "claim-one" },
    { test_proof_id: "test-proof-two", verification_claim_id: "claim-two" });
  const row = { obligation_id: "OBL-ONE",
    controlled_contract_node_ids: ["claim-one", "claim-two"] };

  const wrong = refusalOf(() => applied(structuredClone(contract), { ...row },
    { verification_id: "claim-absent" }));
  assert.equal(wrong.code, "obligation_coverage_case_selector_invalid");
  assert.equal(wrong.details.condition, "unassociated_declaration");
  assert.equal(wrong.details.field, CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD);
  assert.equal(wrong.details.verification_id, "claim-absent");
  assert.equal(wrong.details.obligation_id, "OBL-ONE");
  assert.deepEqual(wrong.details.eligible_verification_ids, ["claim-one", "claim-two"]);
  assert.deepEqual(wrong.details.controlled_contract_node_ids, ["claim-one", "claim-two"]);
  assert.equal(wrong.details.changed, false);

  const ambiguous = refusalOf(() => applied(structuredClone(contract), { ...row }, {}));
  assert.equal(ambiguous.code, "obligation_coverage_case_selector_ambiguous");
  assert.equal(ambiguous.details.condition, "ambiguous_declaration");
  assert.equal(ambiguous.details.verification_id, null);
  assert.deepEqual(ambiguous.details.eligible_verification_ids, ["claim-one", "claim-two"]);
  assert.equal(ambiguous.details.changed, false);

  assert.notEqual(wrong.details.condition, ambiguous.details.condition);
  const bound = applied(structuredClone(contract), { ...row }, { verification_id: "claim-two" });
  assert.equal(bound.verification_claim_id, "claim-two");
  assert.equal(bound.observable_result.proposition_id, "prop-claim-two",
    "the proposition identity is derived from the named claim, never authored");
});

test("one owner computes the eligible verifications and the shared-use exclusion", () => {
  const contract = emptyCaseContract();
  contract.claims.push(verificationClaim("claim-two"), verificationClaim("claim-one"),
    { claim_id: "claim-behavior", kind: "behavior" },
    { ...verificationClaim("claim-inspected"), verification_method: "inspection" },
    verificationClaim("claim-declared"));

  contract.relations.push({ role: "verifies", source_claim_id: "claim-declared", target_claim_id: "claim-behavior" });
  contract.test_proofs.push({ test_proof_id: "test-proof-declared", verification_claim_id: "claim-declared" });
  const eligible = links => eligibleCaseVerificationIds(contract, { case_id: "case-ignored",
    controlled_contract_node_ids: links });

  assert.deepEqual(eligible(["claim-two", "claim-inspected", "claim-one", "claim-absent"]), ["claim-one", "claim-two"]);
  assert.deepEqual(eligible(["claim-one", "claim-two"]), eligible(["claim-two", "claim-one"]));
  assert.deepEqual(eligible(["claim-behavior"]), ["claim-declared"]);
  assert.deepEqual(eligible([]), []);
  assert.deepEqual(eligibleCaseVerificationIds(emptyCaseContract(), { controlled_contract_node_ids: ["claim-one"] }), []);

  contract.claims.push({ claim_id: "claim-shared", kind: "behavior" }, verificationClaim("claim-shared-a"),
    verificationClaim("claim-shared-b"), { ...verificationClaim("claim-shared-inspected"), verification_method: "inspection" });
  for (const source of ["claim-shared-b", "claim-shared-inspected", "claim-shared-a"]) {
    contract.relations.push({ role: "verifies", source_claim_id: source, target_claim_id: "claim-shared" });
  }
  contract.relations.push({ role: "refines", source_claim_id: "claim-two", target_claim_id: "claim-behavior" });

  contract.test_proofs.push({ test_proof_id: "test-proof-placeholder", verification_claim_id: "claim-placeholder" });
  const unbound = { ...contract, test_proofs: [] };
  const bound = { ...contract, test_proofs: [...contract.test_proofs,
    ...["claim-one", "claim-shared-a"].map(id => ({ test_proof_id: `test-proof-${id}`, verification_claim_id: id }))] };
  const populations = links => [unbound, contract, bound].map(variant =>
    eligibleCaseVerificationIds(variant, { controlled_contract_node_ids: links }));
  for (const [links, expected] of [
    [["claim-declared"], ["claim-declared"]],
    [["claim-behavior"], ["claim-declared"]],
    [["claim-shared"], ["claim-shared-a", "claim-shared-b"]],
    [["claim-shared", "claim-behavior", "claim-one"], ["claim-declared", "claim-one", "claim-shared-a", "claim-shared-b"]],
    [["claim-shared-inspected", "claim-placeholder", "claim-absent"], []],
    [[], []]
  ]) {
    assert.deepEqual(populations(links), [expected, expected, expected], JSON.stringify(links));
  }

  const claims = new Set(["claim-one", "claim-two"]);
  const use = links => ({ controlled_contract_node_ids: links });
  assert.equal(caseUseExcludesVerification(use(["claim-two"]), "claim-one", claims), true);
  assert.equal(caseUseExcludesVerification(use(["claim-one", "claim-two"]), "claim-one", claims), false);
  assert.equal(caseUseExcludesVerification(use(["claim-behavior"]), "claim-one", claims), false,
    "a use that links no verification constrains nothing");
});

test("the omission and choice behavior is stated once, in the save's own vocabulary", () => {
  const member = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.verification_association;
  assert.match(member.omission, /unresolved draft/u);
  assert.doesNotMatch(member.omission, /is ambiguous and must be named/u);
  const authoring = member.authoring;
  assert.deepEqual([authoring.method, authoring.field, authoring.links_field],
    ["test_execution", CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD, "obligations[].claims"]);
  const identity = NATIVE_TEST_CASE_AUTHORING_GUIDANCE.case_identity;
  assert.equal(identity.field, "obligations[].case");

  assert.equal(JSON.stringify([authoring, identity]).includes("verification_id"), false);
  assert.equal(JSON.stringify([authoring, identity]).includes("case_id"), false);
});

test("an unselected case's recovery carries every candidate and names only the real choice", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => `claim-${String(index).padStart(2, "0")}`);
  const withAssociation = association => ({ ...typedDiagnostic([{ instancePath: "/observable_result",
    keyword: "required", params: { missingProperty: "proposition_id" } }]),
  problem: { cause: { owner_details: { diagnostics: [{ instancePath: "/observable_result", keyword: "required",
    params: { missingProperty: "proposition_id" } }] }, case_association: association } } });
  const facts = condition => ({ condition, case_id: "case-one", selected: false,
    eligible_verification_ids: candidates, candidate_verification_ids: candidates, blocked: [],
    required_choice: { field: CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD, links_field: "obligations[].claims",
      choose_one_of: candidates } });
  const several = occurrenceRecoveryFacts(withAssociation(facts("ambiguous_linked_verification")));

  assert.deepEqual(several.corrections, ["association"]);
  assert.deepEqual(several.association.candidate_verification_ids, candidates,
    "all forty candidates survive: no short-list bound applies to the candidate population");
  const prose = occurrenceRecoverySummary(withAssociation(facts("ambiguous_linked_verification")), { summary: "unused" });
  assert.match(prose, /name one of candidate_verification_ids in obligations\[\]\.case\.verification/u);
  assert.doesNotMatch(prose, /claim-0/u, "identities stay in the typed facts");
  const none = occurrenceRecoverySummary(withAssociation({ ...facts("no_eligible_verification"),
    eligible_verification_ids: [], candidate_verification_ids: [] }), { summary: "unused" });
  assert.match(none, /lists no eligible test_execution verification/u);

  assert.equal(Object.hasOwn(occurrenceRecoveryFacts(typedDiagnostic([])), "association"), false);
});

test("a selected diagnosis keeps an owner's bounded diagnostics as typed facts and no dossier", () => {
  const PROVIDER = "obligation_coverage_native_binding_provider_unresolved";
  const subjectOf = ownerDetails => {
    const grouped = groupedWith({ category: "system_capability", code: PROVIDER,
      affected_obligation_ids: ["OBL-A"],
      occurrences: [{ obligation_id: "OBL-A", diagnostic: { code: PROVIDER,
        path: "/obligations/0/case_id", owner_code: "stable_test_proof_provider_strategy_mismatch",
        owner_details: ownerDetails,
        problem: { category: "system_capability", cause: { kind: "selected_route_prerequisite",
          case_id: "case-a", owner_code: "stable_test_proof_provider_strategy_mismatch",
          owner_details: ownerDetails, actor_recovery: "none" } } } }] });
    const [projected] = projectProofAuthoringDiagnosticGroups({ grouped,
      resultIdentity: grouped.identity_digest, wkId: "WK-9999" }).groups;
    return proofAuthoringGroupDiagnosis({ projected, raw: grouped.groups[0],
      recoveryFacts: () => null, publicRecovery: () => null }).subjects[0];
  };

  const subject = subjectOf({ diagnostics: {
    diagnostic_projection_version: "controlled-contract.bounded-diagnostic-projection.v2",
    total_count: 4, returned_count: 2, omitted_count: 2, truncated: true,
    diagnostics: [
      { code: "stable_test_proof_provider_strategy_mismatch", pointer: "/falsifiers/0/execution_provider/strategy",
        keyword: "providerCompatibility", reason_code: "stable_test_proof_provider_refused",
        expected_identity: "[\"scalar_return\"]", actual_identity: "dependency_failure",
        message: "raw owner message", owner_facts: { stack: "internal" } },
      { code: "stable_test_proof_provider_missing", pointer: "/traversal_provider" }] } });
  assert.deepEqual(subject, { obligation_id: "OBL-A", path: "/obligations/0/case_id",
    owner_code: "stable_test_proof_provider_strategy_mismatch", case_id: "case-a",
    owner_diagnostics: { total_count: 4, omitted_count: 2, truncated: true, diagnostics: [
      { code: "stable_test_proof_provider_strategy_mismatch", pointer: "/falsifiers/0/execution_provider/strategy",
        expected_identity: "[\"scalar_return\"]", actual_identity: "dependency_failure" },
      { code: "stable_test_proof_provider_missing", pointer: "/traversal_provider" }] } });

  for (const details of [null, { field: "x" }, { diagnostics: [{ instancePath: "/x", keyword: "required" }] }]) {
    assert.equal(Object.hasOwn(subjectOf(details), "owner_diagnostics"), false, JSON.stringify(details));
  }
});
