import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  controlledContractPrettyJsonBytes
} from "@agent-chassis/wiki-core";
import {
  assertNoControlledContractRawResponse
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

function exactBytes(size) {
  const empty = controlledContractPrettyJsonBytes({ value: "" });
  const value = { value: "x".repeat(size - empty) };
  assert.equal(controlledContractPrettyJsonBytes(value), size);
  return value;
}

test("semantic projection byte ceilings accept N-1 and N and reject N+1", () => {
  for (const ceiling of Object.values(CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS)) {
    if (!Number.isInteger(ceiling)) continue;
    for (const size of [ceiling - 1, ceiling]) {
      assert.equal(assertControlledContractSemanticProjectionBound(
        exactBytes(size), ceiling, { projection_class: "boundary_test" }
      ).value.length > 0, true);
    }
    assert.throws(() => assertControlledContractSemanticProjectionBound(
      exactBytes(ceiling + 1), ceiling, { projection_class: "boundary_test" }
    ), (error) => error.code === "controlled_contract_semantic_projection_invalid");
  }
});

test("controlled response guard rejects raw fields and content-reference envelopes", () => {
  for (const mutant of [
    { raw_bytes: "secret" },
    { nested: { content_reference: { kind: "wiki_mcp_response_content_reference" } } },
    { schema_version: "wiki-mcp-spilled-response.v1" }
  ]) assert.throws(() => assertNoControlledContractRawResponse(mutant));
  assert.deepEqual(assertNoControlledContractRawResponse({ items: [{ id: "semantic" }] }),
    { items: [{ id: "semantic" }] });
});
