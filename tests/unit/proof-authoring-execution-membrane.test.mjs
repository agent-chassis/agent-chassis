

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NATIVE_TEST_CASE_AUTHORING_GUIDANCE,
  OBLIGATION_COVERAGE_GAP_KINDS,
  validateObligationCoverageDraft
} from "@agent-chassis/controlled-contract";
import { CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  assertWellFormednessOnlyAdmission,
  DispatchQuestionBoundaryError,
  VALIDATE_DISPATCH_QUESTION
} from "../../packages/wiki-core/src/operations/validate-dispatch.mjs";

const EXECUTION_ENVIRONMENT_VOCABULARY = /install(ed|ation|s)?|executors?/iu;

function environmentMentions(node, path = "") {
  if (typeof node === "string") {
    return EXECUTION_ENVIRONMENT_VOCABULARY.test(node) ? [`${path} = ${node}`] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => environmentMentions(child, `${path}/${index}`));
  }
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, child]) => [
    ...(EXECUTION_ENVIRONMENT_VOCABULARY.test(key) ? [`${path}/${key} (field name)`] : []),
    ...environmentMentions(child, `${path}/${key}`)
  ]);
}

function schemaProse(node, path = "") {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child, index) => schemaProse(child, `${path}/${index}`));
  return Object.entries(node).flatMap(([key, child]) => [
    ...(["description", "title"].includes(key) && typeof child === "string"
      ? [[`${path}/${key}`, child]] : []),
    ...schemaProse(child, `${path}/${key}`)
  ]);
}

test("the authored gap vocabulary carries no execution-capability kind", () => {
  assert.deepEqual([...OBLIGATION_COVERAGE_GAP_KINDS], [
    "catalog_gap", "implementation_not_delivered", "review_only", "no_proof_required"
  ]);
});

test("an authored gap cannot record what the environment can run", () => {
  const draft = (gapKind) => ({
    schema_version: "controlled-contract-obligation-coverage.v3",
    wk_id: "WK-0001", selected_unit: null, focus: null,
    obligations: [{ obligation_id: "OBL-1", statement: "The parser rejects the value.",
      controlled_contract_node_ids: [],
      selection: { proof_name: null, proof_version: null, profile_digest: null,
        parameter_contract_digest: null, admission_digest: null, parameters: {} },
      gap: { gap_kind: gapKind, reason: "Recorded by the author." } }]
  });

  assert.equal(validateObligationCoverageDraft(draft("catalog_gap")).schema_valid, true);
  for (const retired of ["mechanism_gap", "existing_mechanism_unextended"]) {
    const result = validateObligationCoverageDraft(draft(retired));
    assert.equal(result.schema_valid, false, retired);
    assert.equal(result.valid, false, retired);
    assert.ok(result.schema_errors.some((error) =>
      error.pointer === "/obligations/0/gap/gap_kind"), JSON.stringify(result.schema_errors));
  }
});

test("registered authoring guidance never names the execution environment", () => {
  const mentions = [
    ...environmentMentions(CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE, "upsert_guidance"),
    ...environmentMentions(NATIVE_TEST_CASE_AUTHORING_GUIDANCE, "case_authoring_guidance")
  ];
  assert.deepEqual(mentions, [], `authoring guidance exposes the execution environment:\n${mentions.join("\n")}`);
});

test("authoring schema prose never names the execution environment", async () => {
  const schemas = [
    "controlled-contract-obligation-coverage.v3.schema.json",
    "controlled-acceptance-contract.v1.schema.json"
  ];
  for (const name of schemas) {
    const schema = JSON.parse(await readFile(
      new URL(`../../packages/controlled-contract/schema/${name}`, import.meta.url), "utf8"));
    const offending = schemaProse(schema, name)
      .filter(([, text]) => EXECUTION_ENVIRONMENT_VOCABULARY.test(text))
      .map(([pointer, text]) => `${pointer} = ${text}`);
    assert.deepEqual(offending, [], `${name} exposes the execution environment:\n${offending.join("\n")}`);
  }
});

test("validate_dispatch declares the question it answers", () => {
  assert.equal(VALIDATE_DISPATCH_QUESTION.answers, "well_formed");
  assert.equal(VALIDATE_DISPATCH_QUESTION.fulfillment_owner, "workspace_verify_proof");
  assert.ok(VALIDATE_DISPATCH_QUESTION.never_considered.length > 0);
});

test("validate_dispatch refuses a fulfillment fact at its boundary", () => {

  for (const admission of [
    { admits: true, blocked_reason_code: null, blocked_stage: null, unavailable_operations: [] },
    { admits: false, blocked_reason_code: "controlled_acceptance_disposition_missing",
      blocked_stage: null, unavailable_operations: [] },
    { admits: false, blocked_reason_code: "controlled_acceptance_incomplete",
      blocked_stage: "authored_inputs", unavailable_operations: [] },
    { admits: false, blocked_reason_code: "controlled_acceptance_incomplete",
      blocked_stage: "canonical_sources", unavailable_operations: [] },
    { admits: false, blocked_reason_code: "controlled_acceptance_source_not_current",
      blocked_stage: null, unavailable_operations: [] }
  ]) {
    assert.equal(assertWellFormednessOnlyAdmission(admission, { wkId: "WK-0001" }), admission);
  }

  for (const [label, admission] of [
    ["capability stage", { admits: false, blocked_reason_code: "controlled_acceptance_incomplete",
      blocked_stage: "system_capability", unavailable_operations: [] }],
    ["capability reason", { admits: false, blocked_stage: null, unavailable_operations: [],
      blocked_reason_code: "controlled_acceptance_system_capability_unavailable" }],
    ["unavailable operation", { admits: true, blocked_reason_code: null, blocked_stage: null,
      unavailable_operations: [{ kind: "tool_operation", id: "workspace_verify_proof" }] }],
    ["absent verdict", null]
  ]) {
    let error = null;
    try {
      assertWellFormednessOnlyAdmission(admission, { wkId: "WK-0001", unit: "WK-0001" });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof DispatchQuestionBoundaryError, label);
    assert.equal(error.code, "dispatch_readiness_fulfillment_fact_refused", label);
    assert.equal(error.details.question.answers, "well_formed", label);
  }
});
