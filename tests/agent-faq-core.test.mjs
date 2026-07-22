

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  AGENT_FAQ_SCHEMA_VERSION,
  loadAgentFaqCorpus,
  listAgentFaqEntries,
  getAgentFaqEntryById,
  filterAgentFaqEntriesByRelatedCode,
  getAgentFaq
} from "../packages/wiki-core/src/index.mjs";

const SEED_IDS = ["read-scope-missing-or-unfamiliar", "graph-impact-required-unavailable"];

async function withCorpusFile(contents, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-faq-core-"));
  const corpusPath = path.join(dir, "agent-faq.v1.json");
  await writeFile(
    corpusPath,
    typeof contents === "string" ? contents : JSON.stringify(contents),
    "utf8"
  );
  try {
    await fn(corpusPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("shipped corpus validates against the agent-faq.v1 shape", () => {
  const corpus = loadAgentFaqCorpus();
  assert.equal(corpus.schema_version, AGENT_FAQ_SCHEMA_VERSION);
  assert.ok(Array.isArray(corpus.entries) && corpus.entries.length >= 2);
});

test("list returns the seeded entries", () => {
  const entries = listAgentFaqEntries();
  const ids = entries.map((entry) => entry.id);
  for (const seed of SEED_IDS) {
    assert.ok(ids.includes(seed), `corpus must seed ${seed}`);
  }
});

test("both seed entries carry actor and routes", () => {
  const readScope = getAgentFaqEntryById("read-scope-missing-or-unfamiliar");
  assert.ok(readScope);
  assert.equal(readScope.actor, "agent");
  assert.ok(
    readScope.routes.some((route) => route.tool === "workspace_work_record_set_list_field"),
    "read_scope entry must route through workspace_work_record_set_list_field"
  );

  const graphImpact = getAgentFaqEntryById("graph-impact-required-unavailable");
  assert.ok(graphImpact);
  assert.equal(graphImpact.actor, "agent_or_operator");
  assert.ok(Array.isArray(graphImpact.fork) && graphImpact.fork.length >= 2);
  const forkTools = graphImpact.fork.flatMap((branch) =>
    branch.routes.map((route) => route.tool)
  );
  assert.ok(forkTools.includes("workspace_code_index_graph_impact_paths"));
  assert.ok(forkTools.includes("workspace_record_graph_impact_evidence"));
});

test("get-by-id returns null for an unknown id", () => {
  assert.equal(getAgentFaqEntryById("does-not-exist"), null);
});

test("filter-by-related-code returns matching entries", () => {
  const byMissingDocs = filterAgentFaqEntriesByRelatedCode("missing_docs_target");
  assert.deepEqual(
    byMissingDocs.map((entry) => entry.id),
    ["read-scope-missing-or-unfamiliar"]
  );

  const byGraph = filterAgentFaqEntriesByRelatedCode("graph_impact_rebuild_required");
  assert.deepEqual(
    byGraph.map((entry) => entry.id),
    ["graph-impact-required-unavailable"]
  );

  const byShared = filterAgentFaqEntriesByRelatedCode("missing_graph_impact");
  assert.deepEqual(byShared.map((entry) => entry.id).sort(), [
    "graph-impact-evidence-rejected-envelope-shape",
    "graph-impact-required-unavailable"
  ]);

  assert.deepEqual(filterAgentFaqEntriesByRelatedCode("no-such-code"), []);
});

test("getAgentFaq envelope narrows by id and related_code", () => {
  const all = getAgentFaq();
  assert.equal(all.schema_version, AGENT_FAQ_SCHEMA_VERSION);
  assert.equal(all.entry_count, all.total_entry_count);
  assert.equal(all.query.id, null);

  const byId = getAgentFaq({ id: "read-scope-missing-or-unfamiliar" });
  assert.equal(byId.entry_count, 1);
  assert.equal(byId.query.id, "read-scope-missing-or-unfamiliar");
  assert.equal(byId.total_entry_count, all.total_entry_count);

  const byCode = getAgentFaq({ related_code: "graph_impact_rebuild_required" });
  assert.equal(byCode.entry_count, 1);
  assert.equal(byCode.entries[0].id, "graph-impact-required-unavailable");
});

test("WK-1377: FAQ output is tier-projected — free/local omits paid remediation entries", () => {
  const free = getAgentFaq({ registered_tier: "free_local" });
  const freeIds = free.entries.map((entry) => entry.id);

  assert.deepEqual(freeIds, [
    "read-scope-missing-or-unfamiliar",
    "dispatch-readiness-multi-cluster-or-critical-blast-radius",
    "run-validation-target-not-authorized"
  ]);

  for (const paidId of [
    "graph-impact-required-unavailable",
    "graph-impact-evidence-rejected-envelope-shape",
    "needs-review-write-scope-loc-line-budget",
    "validate-dispatch-worker-admission-problem-diagnostics"
  ]) {
    assert.equal(freeIds.includes(paidId), false, `${paidId} must be hidden from free/local FAQ`);
  }

  const freeText = JSON.stringify(free.entries).toLowerCase();
  for (const token of ["graph-impact", "graph_impact", "worker_admission", "admissibility"]) {
    assert.equal(freeText.includes(token), false, `free/local FAQ must not name paid token "${token}"`);
  }
});

test("WK-1377: paid/CCE FAQ projection exposes the paid remediation entries", () => {
  const paid = getAgentFaq({ registered_tier: "paid_cce" });
  const paidIds = paid.entries.map((entry) => entry.id);
  for (const id of [
    "read-scope-missing-or-unfamiliar",
    "graph-impact-required-unavailable",
    "needs-review-write-scope-loc-line-budget"
  ]) {
    assert.ok(paidIds.includes(id), `${id} must be visible under the paid/CCE tier`);
  }

  const free = getAgentFaq({ registered_tier: "free_local" });
  assert.ok(free.entry_count < paid.entry_count);
});

test("WK-1377: every shipped FAQ entry carries an explicit tier classification", () => {
  const corpus = loadAgentFaqCorpus();
  for (const entry of corpus.entries) {
    assert.ok(
      Array.isArray(entry.tier_visibility) && entry.tier_visibility.length > 0,
      `FAQ entry ${entry.id} must carry a non-empty tier_visibility`
    );
  }
});

test("WK-1377: a FAQ entry missing tier_visibility fails closed", async () => {
  await withCorpusFile(
    {
      schema_version: "agent-faq.v1",
      entries: [
        { id: "x", title: "t", symptom: "s", cause: "c", actor: "agent", routes: [] }
      ]
    },
    async (corpusPath) => {
      assert.throws(() => loadAgentFaqCorpus({ corpusPath }), /tier_visibility must be a non-empty array/);
    }
  );
});

test("malformed corpus fails closed with a clear error", async () => {
  await withCorpusFile("{ not json", async (corpusPath) => {
    assert.throws(
      () => loadAgentFaqCorpus({ corpusPath }),
      /agent-faq corpus.*not valid JSON/
    );
  });

  await withCorpusFile({ schema_version: "agent-faq.v1", entries: "nope" }, async (corpusPath) => {
    assert.throws(() => loadAgentFaqCorpus({ corpusPath }), /entries must be an array/);
  });

  await withCorpusFile(
    {
      schema_version: "agent-faq.v1",
      entries: [{ id: "x", title: "t", symptom: "s", cause: "c", actor: "nobody", routes: [] }]
    },
    async (corpusPath) => {
      assert.throws(() => loadAgentFaqCorpus({ corpusPath }), /actor must be one of/);
    }
  );

  await withCorpusFile(
    { schema_version: "wrong.v9", entries: [] },
    async (corpusPath) => {
      assert.throws(() => loadAgentFaqCorpus({ corpusPath }), /schema_version must be/);
    }
  );

  await withCorpusFile(
    { schema_version: "agent-faq.v1", entries: [{ id: "x" }] },
    async (corpusPath) => {
      assert.throws(() => loadAgentFaqCorpus({ corpusPath }), /entries\[0\]\.title/);
    }
  );
});
