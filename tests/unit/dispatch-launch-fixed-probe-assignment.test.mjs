import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { CONNECTED_OPERATIVE_NOTES_HEADING, CONNECTED_OPERATIVE_WINDOW_END, CONNECTED_ROW_VERIFY_DIRECTIVE,
  CONNECTED_VERIFY_DIRECTIVE, FIXED_PROBE_CONNECTED_ROW_DIRECTIVES_SOURCE, FIXED_PROBE_MCP_CLIENT_SOURCE,
  FIXED_PROBE_PROMPT_SECTION_SOURCE, buildConnectedRowVerificationDirective, buildConnectedVerificationDirective } from
  "../../packages/wiki-mcp/src/lib/dispatch-launch-fixed-probe-protocol.mjs";

const readAssignment = runInNewContext(`${FIXED_PROBE_MCP_CLIENT_SOURCE}\nreadFixedProbeAssignment`);
const continuation = { tool: "returned-reader", arguments: {
  reads: [{ reference: { ref_id: "frozen-assignment" }, select: { field: "guidance" } }]
} };
const context = { reference: continuation.arguments.reads[0].reference, next_calls: [
  { tool: "unselected-contract-reader", arguments: { select: { contract: "coverage" } } }, continuation
] };
const guidance = { field: "guidance", value: "exact frozen guidance 🚀\n", next_calls: [] };
const bulk = ({ next_calls, ...value }) => ({ results: [{ status: 'ok', value, next_calls }] });

test("fixed assignment probe consumes the returned complete guidance call unchanged", async () => {
  for (const mirrorOnly of [false, true]) {
    const calls = [];
    const result = await readAssignment({ callTool: async (tool, args) => {
      calls.push([tool, args]);
      const value = bulk(calls.length === 1 ? context : guidance);
      return mirrorOnly ? { content: [{ type: "text", text: JSON.stringify(value) }] }
        : { structuredContent: value };
    } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "workspace_read_wiki");
    assert.equal(JSON.stringify(calls[0][1]), '{"reads":[{"assignment":true}]}');
    assert.equal(calls[1][0], continuation.tool);
    assert.equal(JSON.stringify(calls[1][1]), JSON.stringify(continuation.arguments));
    if (!mirrorOnly) assert.equal(calls[1][1], continuation.arguments);
    assert.equal(result.guidance, guidance.value);
    assert.equal(JSON.stringify(result.reference), JSON.stringify(context.reference));
    assert.equal(result.identity, undefined);
    assert.equal(result.source_digest, undefined);
    assert.equal(result.reads, 2);
  }
});

test("fixed assignment probe retains refusals from context and selected guidance", async () => {
  const refused = { isError: true, content: [{ type: "text", text: "frozen assignment unavailable" }] };
  for (const failedRead of [1, 2]) {
    let reads = 0;
    await assert.rejects(readAssignment({ callTool: async () => {
      reads += 1;
      return reads === failedRead ? refused : { structuredContent: bulk(context) };
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
    return { structuredContent: bulk({ ...context, next_calls: [] }) };
  } }), /assignment_read_missing_guidance_selection/);
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(readAssignment({ callTool: async () => ({ structuredContent:
    ++reads === 1 ? bulk(context) : { results: [{ status: "partial", value: guidance, issues: [{ cause: "Incomplete assignment delivery" }] }] } }) }),
  /assignment_selection_refused/);
  assert.equal(reads, 2);
  for (const changed of [undefined, { ref_id: "different-assignment" }]) {
    let calls = 0;
    await assert.rejects(readAssignment({ callTool: async () => {
      calls += 1;
      return { structuredContent: bulk({ ...context, reference: changed }) };
    } }), /assignment_read_missing_guidance_selection/);
    assert.equal(calls, 1, "an altered/missing binding prevents the dependent read");
  }
});

test('fixed assignment probe requires the complete selected result before consuming guidance', async () => {
  for (const status of ['partial', 'unavailable', 'refused', 'ambiguous']) {
    let calls = 0;
    await assert.rejects(readAssignment({ callTool: async () => {
      calls++;
      return { structuredContent: calls === 1 ? bulk(context) : { results: [{
        status, value: guidance, issue: { code: 'selected_assignment_unavailable' }
      }] } };
    } }), /assignment_selection_refused/);
    assert.equal(calls, 2);
  }
  for (const results of [[], [bulk(context).results[0], bulk(guidance).results[0]]]) {
    let calls = 0;
    await assert.rejects(readAssignment({ callTool: async () => {
      calls++;
      return { structuredContent: { results } };
    } }), /assignment_selection_refused/);
    assert.equal(calls, 1, 'missing/extra results cannot substitute another selection or reach a guidance read');
  }
});

const decodeRows = runInNewContext(
  `${FIXED_PROBE_PROMPT_SECTION_SOURCE}\n${FIXED_PROBE_CONNECTED_ROW_DIRECTIVES_SOURCE}\ndecodeConnectedRowDirectives`);
const delivered = (lines, { before = "", after = "" } = {}) =>
  `Role: implementation worker for WK-0001#SLICE-001.\n${before}${CONNECTED_OPERATIVE_NOTES_HEADING}` +
  `Operative note.\n${lines.join("\n")}\n${CONNECTED_OPERATIVE_WINDOW_END}- criterion\n${after}`;
const ROWS = Object.freeze({ go: "obligation-4d2c", billing: "obligation-9a71" });
const rowLines = (rows = ROWS) => Object.entries(rows).map(([row, subject]) => buildConnectedRowVerificationDirective(row, subject));

test("row verification directives decode to exactly the plan's rows and the delivered identities", () => {
  assert.equal(rowLines()[0], `${CONNECTED_ROW_VERIFY_DIRECTIVE} {"row":"go","subject":"obligation-4d2c"}`);
  const decoded = decodeRows(delivered(rowLines()), ["go", "billing"]);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded.subjects)), ROWS);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded.directive_lines)), rowLines());

  assert.deepEqual(JSON.parse(JSON.stringify(decodeRows(delivered([...rowLines()].reverse()), ["go", "billing"]).subjects)), ROWS);

  const outside = `${buildConnectedRowVerificationDirective("go", "obligation-other")}\n`;
  assert.deepEqual(JSON.parse(JSON.stringify(decodeRows(delivered(rowLines(), { after: outside }), ["go", "billing"]).subjects)), ROWS);

  const mixed = [...rowLines(), buildConnectedVerificationDirective(CONNECTED_VERIFY_DIRECTIVE, "obligation-4d2c")];
  assert.deepEqual(JSON.parse(JSON.stringify(decodeRows(delivered(mixed), ["go", "billing"]).subjects)), ROWS);
});

test("row verification directives refuse an incomplete, ambiguous or malformed mapping before any request", () => {
  const prefix = CONNECTED_ROW_VERIFY_DIRECTIVE;
  const refusals = [
    ["a missing row", rowLines({ go: ROWS.go }), /directive missing for rows billing$/u],
    ["no directive at all", [], /directive missing for rows go,billing$/u],
    ["a repeated row", [...rowLines(), buildConnectedRowVerificationDirective("go", "obligation-third")], /repeats row go$/u],
    ["a row the plan does not have", [...rowLines(), buildConnectedRowVerificationDirective("rust", "obligation-third")],
      /names unknown row rust$/u],
    ["one identity for two rows", rowLines({ go: ROWS.go, billing: ROWS.go }), /gives one subject to two rows: obligation-4d2c$/u],
    ["an extra key", [rowLines()[0], `${prefix} {"row":"billing","subject":"obligation-9a71","tool":"verify_proof"}`],
      /must carry exactly one row and one nonempty subject$/u],
    ["an empty subject", [rowLines()[0], `${prefix} {"row":"billing","subject":""}`],
      /must carry exactly one row and one nonempty subject$/u],
    ["a subject that is not a string", [rowLines()[0], `${prefix} {"row":"billing","subject":7}`],
      /must carry exactly one row and one nonempty subject$/u],
    ["malformed JSON", [rowLines()[0], `${prefix} {"row":"billing"`], /directive is malformed$/u],
    ["a bare prefix", [rowLines()[0], prefix], /directive is malformed$/u]
  ];
  for (const [label, lines, message] of refusals) {
    assert.throws(() => decodeRows(delivered(lines), ["go", "billing"]), message, label);
  }

  assert.throws(() => decodeRows(delivered(rowLines(), { before: CONNECTED_OPERATIVE_NOTES_HEADING }), ["go", "billing"]),
    /window boundaries are not complete and unique$/u);
  assert.throws(() => decodeRows(rowLines().join("\n"), ["go", "billing"]), /window boundaries are not complete and unique$/u);

  for (const keys of [[], ["go", "go"], null]) {
    assert.throws(() => decodeRows(delivered(rowLines()), keys), /row keys are not a nonempty distinct list$/u);
  }

  for (const [row, subject] of [["Go", "obligation-1"], ["", "obligation-1"], ["go test", "obligation-1"], ["go", ""], ["go", null]]) {
    assert.throws(() => buildConnectedRowVerificationDirective(row, subject), TypeError);
  }
});
