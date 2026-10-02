

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  createSelectedResponseSession,
  readSelectedResponseSource,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const ROUTE = "workspace_controlled_contract_obligation_coverage_query";
const MARKER = "retained-carrier-marker-λ";
const WORKER_A = Object.freeze({ role: "worker", run: { run_id: "run-a", retry_id: 0 },
  population: { kind: "assigned", unit: "WK-0001#SLICE-001" }, source_generation: "sha256:aaa" });
const WORKER_B = Object.freeze({ ...WORKER_A, run: { run_id: "run-b", retry_id: 0 } });
const REVIEWER = Object.freeze({ role: "reviewer", run: { run_id: "run-a", retry_id: 0 },
  population: { kind: "repository" }, source_generation: "sha256:aaa" });

function session(env, options = {}) {
  return createSelectedResponseSession({
    route: ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({ unit: z.string().min(1),
      detail: selectedResponseDetailSchema(z) }).strict()),
    buildDetailArguments: (binding, selection) => ({ unit: binding.unit, detail: selection }),
    env,
    ...options
  });
}

function binding(authority) {
  return { route: ROUTE, repository: "fixture-repo", unit: "WK-0001#SLICE-001",
    ...(authority === undefined ? {} : { authority_identity: authority }) };
}

function expected(authority) {
  return { route: ROUTE, repository: "fixture-repo", unit: "WK-0001#SLICE-001",
    ...(authority === undefined ? {} : { authority_identity: authority }) };
}

const carrier = { rows: Array.from({ length: 180 }, (_, index) =>
  ({ index, text: `${MARKER} ${index} ${"x".repeat(80)}` })) };

function refusedBefore(disclosure, reason) {
  return (error) => {
    assert.equal(error?.envelope?.code, "selected_response_query_invalid", String(error?.stack ?? error));
    assert.equal(JSON.stringify(error.envelope).includes(MARKER), false,
      "a refusal discloses no retained carrier content");
    const facts = Object.fromEntries(error.envelope.deciding_facts.map(({ field, value }) => [field, value]));
    assert.equal(facts["selected_response.invalid_reason"], reason, disclosure);
    return true;
  };
}

test("selected response validates authority on hot and retained detail paths", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-authority-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const requiring = session(env, { requireAuthorityIdentity: true });

    assert.throws(() => requiring.retain({ binding: binding(), carrier }),
      refusedBefore("retention without identity", "authority_identity_missing"));
    const { source, snapshot_identity: snapshotIdentity } =
      requiring.retain({ binding: binding(WORKER_A), carrier });
    const envelope = readSelectedResponseSource(source, { env, expected: { route: ROUTE } });
    assert.deepEqual(envelope.binding.authority_identity, WORKER_A,
      "the retained envelope carries the authority identity");

    const first = await requiring.detail({ expected: expected(WORKER_A),
      detail: { source, snapshot_identity: snapshotIdentity, collection: "rows" } });
    assert.ok(first.page.items.length > 0 && first.page.items.length < carrier.rows.length);
    assert.match(first.page.retained_source.authority_identity_sha256, /^[0-9a-f]{64}$/u,
      "the hot summary carries the comparable identity");
    const cursorDetail = first.next_calls[0].arguments.detail;
    assert.ok(cursorDetail.cursor, "the collection continues by cursor");
    for (const [label, authority, reason] of [
      ["absent expected", undefined, "authority_identity_missing"],
      ["cross-run", WORKER_B, "source_binding_mismatch"],
      ["cross-role", REVIEWER, "source_binding_mismatch"]]) {
      await assert.rejects(requiring.detail({ expected: expected(authority),
        detail: { source, snapshot_identity: snapshotIdentity, collection: "rows" } }),
      refusedBefore(`snapshot identity: ${label}`, reason));

      await assert.rejects(requiring.detail({ expected: expected(authority), detail: cursorDetail }),
        refusedBefore(`hot cursor: ${label}`, reason));
    }
    const continued = await requiring.detail({ expected: expected(WORKER_A), detail: cursorDetail });
    assert.equal(continued.page.offset, first.page.items.length);

    const restarted = session(env, { requireAuthorityIdentity: true });
    for (const [label, authority, reason] of [
      ["absent expected", undefined, "authority_identity_missing"],
      ["cross-run", WORKER_B, "source_binding_mismatch"],
      ["cross-role", REVIEWER, "source_binding_mismatch"]]) {
      await assert.rejects(restarted.detail({ expected: expected(authority),
        detail: { source, collection: "rows" } }), refusedBefore(`cold locator: ${label}`, reason));
    }
    const rehydrated = await restarted.detail({ expected: expected(WORKER_A),
      detail: { source, collection: "rows" } });
    assert.deepEqual(rehydrated.page.items, first.page.items, "the equal identity reads the same page");

    await assert.rejects(restarted.detail({ expected: expected(WORKER_A), detail: cursorDetail }),
      (error) => error?.envelope?.code === "selected_response_snapshot_unavailable");

    const unconfigured = session(env);
    const legacyShape = unconfigured.retain({ binding: binding(), carrier });
    const retainedBinding = readSelectedResponseSource(legacyShape.source,
      { env, expected: { route: ROUTE } }).binding;
    assert.deepEqual(Object.keys(retainedBinding).sort(),
      ["observation_identity", "query_identity", "repository", "route", "unit"],
      "an unconfigured session keeps its exact retained binding shape");
    await assert.rejects(restarted.detail({ expected: expected(WORKER_A),
      detail: { source: legacyShape.source, collection: "rows" } }),
    refusedBefore("cold locator without retained identity", "source_binding_mismatch"));

    const plain = await unconfigured.detail({ expected: expected(),
      detail: { source: legacyShape.source, snapshot_identity: legacyShape.snapshot_identity,
        collection: "rows" } });
    assert.equal(Object.hasOwn(plain.page.retained_source, "authority_identity_sha256"), false);
    assert.equal(plain.page.items[0].value.index, 0);
  } finally {
    await scope.dispose();
  }
});

test("WK-2716: a hot field correction is offered only to the retained authority", async () => {
  const scope = createTestResourceScope();
  try {
    const dir = await scope.acquire("response state",
      () => mkdtempSync(path.join(os.tmpdir(), "selected-correction-")),
      (created) => rmSync(created, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
    const requiring = session(env, { requireAuthorityIdentity: true });
    const { source, snapshot_identity: snapshotIdentity } =
      requiring.retain({ binding: binding(WORKER_A), carrier });
    const hot = { source, snapshot_identity: snapshotIdentity, collection: "rows" };
    for (const [invalid, corrected] of [
      [{ field_path: ["index"] }, hot],
      [{ selector: { id: "3" }, field_path: ["index"] }, { ...hot, selector: { id: "3" } }]]) {
      const refusal = await requiring.detail({ expected: expected(WORKER_A), detail: { ...hot, ...invalid } })
        .then(() => assert.fail("an invalid field selection is refused"), (error) => error.envelope);
      assert.equal(refusal.recovery.state, "callable");
      assert.deepEqual(refusal.next_calls.map((call) => call.arguments),
        [{ unit: "WK-0001#SLICE-001", detail: corrected }]);

      for (const authority of [WORKER_B, REVIEWER]) {
        await assert.rejects(requiring.detail({ expected: expected(authority), detail: { ...hot, ...invalid } }),
          (error) => {
            assert.equal(error.envelope.no_supported_route, true);
            assert.equal(Object.hasOwn(error.envelope, "next_calls"), false);
            assert.equal(JSON.stringify(error.envelope).includes(MARKER), false);
            return true;
          });
      }
    }
  } finally {
    await scope.dispose();
  }
});
