

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
import { assembleQuery } from "../helpers/controlled-contract-query-retrieval.mjs";

const REPO = "proof-authoring-consumer";
const UNIT = "WK-0001";

const AUTHORITY = Object.freeze({ schema_version: "obligation-coverage-query-authority.v1",
  route: "workspace_controlled_contract_obligation_coverage_query", unit: UNIT, role: "operator",
  source: { kind: "canonical_workspace", repository: REPO }, population: { kind: "repository" } });
const QUERY_IDENTITY = Object.freeze({ focus: null, obligation_id: null, parameter_detail: false,
  inventory: false, view: "compact" });
const OBSERVATION_IDENTITY = `sha256:${"9".repeat(64)}`;

function carrier() {
  return {
    schema_version: "obligation-coverage-query.v1",
    unit: UNIT,
    status: "authored",
    view: "complete",
    content_digest: `sha256:${"a".repeat(64)}`,
    source_identity: { revision: "b".repeat(40) },
    population: { obligations: 0, requirements: 1, references: 3 },
    acceptance_criteria: Array.from({ length: 8 }, (_, index) => ({
      identity: `criterion-${index}-${"c".repeat(40)}`, text: `Criterion ${index} ${"t".repeat(200)}` })),
    requirements: Array.from({ length: 4 }, (_, index) => ({
      requirement_id: `req-${index}`, statement: "x".repeat(1400) })),
    references: [
      { reference_id: "ref-1b9914c84fe33d1cc6fc57f08d9e01c1e49d73ff", type_term: "cc:test",
        identity: { kind: "repository_path", repository: "example/go-shellcheck",
          path: "core/quote_rule_test.go" } },
      { reference_id: "ref-3f3e9f16f33f67c6b7afc2089e8b611df1b2976c", type_term: "cc:operation",
        identity: { kind: "profile_term", term: "shell command quoting analyzer" } },
      { reference_id: "ref-7ae05d2959bf3cb01ee9f0cebddf111da3bb73d7", type_term: "cc:configuration",
        identity: { kind: "profile_term", term: "command word with an unquoted expansion" } }
    ],
    obligations: [],
    cases: [],
    source_authority: { kind: "canonical" }
  };
}

test("a retained coverage query with cursor-continued collections is retrieved within the bound",
  async (t) => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "wk2668-query-reserve-"));
    t.after(() => rmSync(stateDir, { recursive: true, force: true }));
    const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "32768" };
    const selection = createObligationCoverageQuerySelection({ unitSchema: z.string(), env });
    const expected = carrier();
    const summary = await selection.publish({ workspaceRepo: REPO, carrier: expected, view: "compact",
      queryIdentity: QUERY_IDENTITY, observationIdentity: OBSERVATION_IDENTITY, authorityIdentity: AUTHORITY });
    assert.equal(summary.selected_detail.complete, false, "the result is retained, not inlined");

    const frames = [];
    const call = async ({ detail }) => {
      const response = await selection.detail({ workspaceRepo: REPO, unit: UNIT,
        authorityIdentity: AUTHORITY, detail });
      const bytes = measureMcpInlineResultBytes(response);
      const continued = response.page.continuation?.kind === "cursor";
      frames.push({ collection: response.page.collection, bytes, continued,
        appended: !continued && response.next_calls.length > 0,
        descend: response.descend !== undefined });
      assert.ok(bytes <= selection.bound, `frame ${bytes} exceeds the ${selection.bound}-byte bound`);
      return structuredToolResult(response);
    };
    const { carrier: retrieved } = await assembleQuery({ call }, summary);

    const { view: _view, ...population } = expected;
    const { view: _retrievedView, ...retrievedPopulation } = retrieved;
    assert.deepEqual(retrievedPopulation, population, "complete retrieval loses nothing");

    assert.ok(frames.some(({ continued, bytes }) => continued && bytes > selection.bound - 1280),
      `a cursor-continued page used the reserve it does not need: ${JSON.stringify(frames)}`);
    assert.ok(frames.some(({ continued, descend }) => continued && descend),
      `a cursor-continued field-inventory page with its descend template fit: ${JSON.stringify(frames)}`);
    assert.ok(frames.some(({ appended }) => appended),
      `a page the adapter extended with the next-collection call still fit: ${JSON.stringify(frames)}`);
  });
