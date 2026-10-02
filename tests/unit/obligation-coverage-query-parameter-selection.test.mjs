

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { createObligationCoverageQuerySelection } from
  "../../packages/wiki-mcp/src/lib/controlled-contract-query-response.mjs";
import { measureMcpInlineResultBytes, structuredToolResult } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { composeParameterContract, readParameterSelection } from
  "../helpers/controlled-contract-query-retrieval.mjs";

const REPO = "proof-authoring-consumer";
const UNIT = "WK-0001";
const OBLIGATION = "OB-LEVELS";
const AUTHORITY = Object.freeze({ schema_version: "obligation-coverage-query-authority.v1",
  route: "workspace_controlled_contract_obligation_coverage_query", unit: UNIT, role: "operator",
  source: { kind: "canonical_workspace", repository: REPO }, population: { kind: "repository" } });
const QUERY_IDENTITY = Object.freeze({ focus: null, obligation_id: OBLIGATION, parameter_detail: true,
  inventory: false, view: "compact" });

const slot = (name, index) => ({ name, value_kind: "typed_referent", roles: [name],
  refinement_refs: [`/reference_roles/${index}`], applicability_refs: [`/claim_patterns/${index}`],
  purpose: `Declare ${name}.`, source: { policy: "canonical", mapping: "canonical-source" },
  refinements: [{ ref: `/reference_roles/${index}/${"r".repeat(1300)}`, value: { role: name,
    allowed_type_terms: ["cc:runtime_component"], allowed_identity_kinds: ["repository_path"],
    cardinality: "exactly_one" } }],
  constraints: [{ ref: `/claim_patterns/${index}`, value: { pattern_id: `${name}-exists`,
    template: "c".repeat(200) } }] });

const CONTRACT = Object.freeze({ profile_id: "proof.synthetic", profile_version: "1.0.0",
  profile_digest: "d".repeat(64), total: 2, returned: 2, omitted: 0,
  parameters: [slot("component", 0), slot("suite", 1)],
  construction: { steps: ["bind", "resolve"] }, dependencies: { proofs: [] },
  capabilities: [{ id: "construct", kind: "constructor" }],

  constraints: [{ ref: "/claim_patterns/0", text: "ü".repeat(9000) }] });

function carrier(row) {
  return { schema_version: "obligation-coverage-query.v1", unit: UNIT, status: "source_present",
    view: "complete", content_digest: `sha256:${"a".repeat(64)}`, source_identity: { revision: "b".repeat(40) },
    population: { mode: "obligation", obligation_id: OBLIGATION, returned: { obligations: 1 } },
    acceptance_criteria: Array.from({ length: 8 }, (_, index) => ({ identity: `criterion-${index}`,
      text: `Criterion ${index} ${"t".repeat(300)}` })),
    obligations: [{ obligation_id: OBLIGATION, statement: "Levels exist.", ...row }],
    source_authority: { kind: "canonical" } };
}

function harness(t) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "query-parameter-selection-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const selection = createObligationCoverageQuerySelection({ unitSchema: z.string(), env });
  const ledger = { calls: 0 };
  const journey = { call: async ({ detail }) => {
    ledger.calls += 1;
    const response = await selection.detail({ workspaceRepo: REPO, unit: UNIT, authorityIdentity: AUTHORITY,
      detail });
    assert.ok(measureMcpInlineResultBytes(response) <= selection.bound);
    return structuredToolResult(response);
  } };
  const publish = (row) => selection.publish({ workspaceRepo: REPO, carrier: carrier(row), view: "compact",
    queryIdentity: QUERY_IDENTITY, observationIdentity: `sha256:${"9".repeat(64)}`, authorityIdentity: AUTHORITY });
  return { selection, journey, ledger, publish };
}

test("the pin-fact-only size names every omitted field and its emitted reads complete the contract", async (t) => {
  const { selection, journey, ledger, publish } = harness(t);
  const first = await publish({ parameter_detail: { status: "current" }, parameter_contract: CONTRACT });
  assert.ok(measureMcpInlineResultBytes(first) <= selection.bound);
  const chosen = first.parameter_selection;
  assert.equal(chosen.complete, false);
  assert.equal(Object.hasOwn(chosen, "parameters"), false, "the slots do not fit");
  assert.equal(Object.hasOwn(chosen, "parameter_refinements"), false, "nor do their refinements");
  assert.deepEqual(chosen.parameter_detail, { status: "current" });
  assert.deepEqual(chosen.not_inline, ["parameters.0", "parameters.1", "construction", "dependencies",
    "capabilities", "constraints"], "the pin-fact-only size names everything it leaves out");
  assert.deepEqual(first.next_calls.filter((call) => call.recommended === true).map((call) =>
    call.arguments.detail.field_path), [["value", "parameter_contract", "parameters", 0]]);

  const fields = await readParameterSelection(journey, first);
  assert.deepEqual(Object.keys(fields), chosen.not_inline, "each named field is read once, in order");
  assert.deepEqual(composeParameterContract(chosen, fields), CONTRACT, "nothing is lost");
  t.diagnostic(`pin-fact-only parameter contract: ${ledger.calls + 1} calls`);
});

test("an oversized unavailable-pin fact names its omitted fact and reads it whole", async (t) => {
  const { journey, publish } = harness(t);
  const fact = { status: "stale", reason_code: "obligation_coverage_definition_integrity_mismatch",
    message: "The saved pin no longer matches its definition.", selection: { proof_name: "proof.synthetic",
      profile_digest: "0".repeat(64) }, facts: { detail: "f".repeat(9000) }, repaired_by: "author" };
  const first = await publish({ parameter_detail: fact, parameter_contract: null });
  const chosen = first.parameter_selection;
  assert.deepEqual(chosen.parameter_detail, { status: "stale",
    reason_code: "obligation_coverage_definition_integrity_mismatch" });
  assert.deepEqual(chosen.not_inline, ["parameter_detail"]);
  assert.equal(chosen.complete, false);
  const fields = await readParameterSelection(journey, first);
  assert.deepEqual(fields, { parameter_detail: fact }, "the saved pin fact is delivered exactly");
});
