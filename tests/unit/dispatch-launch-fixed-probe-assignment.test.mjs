import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { FIXED_PROBE_MCP_CLIENT_SOURCE } from
  "../../packages/wiki-mcp/src/lib/dispatch-launch-fixed-probe-protocol.mjs";

const readAssignment = runInNewContext(`${FIXED_PROBE_MCP_CLIENT_SOURCE}\nreadFixedProbeAssignment`);
const identity = { assigned_unit: "WK-0001#SLICE-001", role: "worker",
  canonical_source_digest: "canonical-source", run_id: "selected-run" };
const continuation = { tool: "returned-reader", arguments: {
  reference: { ref_id: "frozen-assignment", sha256: "bound-digest" }, select: { field: "guidance" }
} };
const context = { revision: "0123456789abcdef", next_calls: [
  { tool: "unselected-contract-reader", arguments: { select: { contract: "coverage" } } }, continuation
] };
const guidance = { complete: true, field: "guidance", value: "exact frozen guidance 🚀\n",
  identity, next_calls: [] };

test("fixed assignment probe consumes the returned complete guidance call unchanged", async () => {
  for (const mirrorOnly of [false, true]) {
    const calls = [];
    const result = await readAssignment({ callTool: async (tool, args) => {
      calls.push([tool, args]);
      const value = calls.length === 1 ? context : guidance;
      return mirrorOnly ? { content: [{ type: "text", text: JSON.stringify(value) }] }
        : { structuredContent: value };
    } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "workspace_read_wiki");
    assert.equal(JSON.stringify(calls[0][1]), '{"assignment":true}');
    assert.equal(calls[1][0], continuation.tool);
    assert.equal(JSON.stringify(calls[1][1]), JSON.stringify(continuation.arguments));
    if (!mirrorOnly) assert.equal(calls[1][1], continuation.arguments);
    assert.equal(result.guidance, guidance.value);
    assert.equal(result.source_digest, context.revision);
    assert.equal(JSON.stringify(result.identity), JSON.stringify(identity));
    assert.equal(result.reads, 2);
  }
});

test("fixed assignment probe retains refusals from context and selected guidance", async () => {
  const refused = { isError: true, content: [{ type: "text", text: "frozen assignment unavailable" }] };
  for (const failedRead of [1, 2]) {
    let reads = 0;
    await assert.rejects(readAssignment({ callTool: async () => {
      reads += 1;
      return reads === failedRead ? refused : { structuredContent: context };
    } }), error => {
      assert.equal(error.stage, "assignment_read");
      assert.equal(error.message, "assignment_read_refused:" + JSON.stringify(refused.content));
      return true;
    });
    assert.equal(reads, failedRead);
  }
});

test("fixed assignment probe refuses missing selection and incomplete guidance", async () => {
  let reads = 0;
  await assert.rejects(readAssignment({ callTool: async () => {
    reads += 1;
    return { structuredContent: { ...context, next_calls: [] } };
  } }), /assignment_read_missing_guidance_selection/);
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(readAssignment({ callTool: async () => ({ structuredContent:
    ++reads === 1 ? context : { ...guidance, complete: false } }) }),
  /assignment_read_invalid_guidance_selection/);
  assert.equal(reads, 2);
});
