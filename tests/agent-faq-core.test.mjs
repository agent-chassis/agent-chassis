

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
  assert.equal(all.total, all.returned);
  assert.equal(all.omitted, 0);
  assert.equal(all.truncated, false);
  assert.equal(all.entries_truncated, false);
  assert.equal(all.entry_fields_clipped, true);
  assert.equal(all.mode, "index");
  assert.equal(all.query.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(all, null, 2)) <= 4_096);
  for (const entry of all.entries) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["actor", "id", "related_codes", "title"]
    );
  }

  const byId = getAgentFaq({ id: "read-scope-missing-or-unfamiliar" });
  assert.equal(byId.entry_count, 1);
  assert.equal(byId.total, 1);
  assert.equal(byId.returned, 1);
  assert.equal(byId.omitted, 0);
  assert.equal(byId.truncated, false);
  assert.equal(byId.entries_truncated, false);
  assert.equal(byId.entry_fields_clipped, false);
  assert.equal(byId.mode, "id");
  assert.equal(byId.query.id, "read-scope-missing-or-unfamiliar");
  assert.equal(byId.total_entry_count, all.total_entry_count);
  assert.ok(Array.isArray(byId.entries[0].routes));
  assert.equal(typeof byId.entries[0].cause, "string");

  const byCode = getAgentFaq({ related_code: "graph_impact_rebuild_required" });
  assert.equal(byCode.entry_count, 1);
  assert.equal(byCode.total, 1);
  assert.equal(byCode.returned, 1);
  assert.equal(byCode.truncated, false);
  assert.equal(byCode.mode, "related_code");
  assert.equal(byCode.entries[0].id, "graph-impact-required-unavailable");
});

test("WK-1980: large corpora stay bounded across compact, tier, and selection modes", async () => {
  const longProse = "route detail ".repeat(4_000);
  const entries = Array.from({ length: 240 }, (_, index) => ({
    id: `synthetic-${String(index).padStart(3, "0")}`,
    title: `Synthetic FAQ ${index} ${"title ".repeat(80)}`,
    symptom: index === 0 ? "short symptom" : `Symptom ${index} ${"symptom ".repeat(200)}`,
    cause: `Cause ${index} ${longProse}`,
    actor: index % 3 === 0 ? "operator" : "agent",
    tier_visibility: [index % 2 === 0 ? "free_local" : "paid_cce"],
    routes: [{ tool: "workspace_synthetic_route", note: longProse }],
    related_codes: [`code-${index % 5}`, ...Array.from({ length: 20 }, (_, n) => `extra-${n}`)]
  }));

  await withCorpusFile(
    {
      schema_version: AGENT_FAQ_SCHEMA_VERSION,
      owner: "synthetic",
      description: longProse,
      entries
    },
    async (corpusPath) => {
      const freeIndex = getAgentFaq({ corpusPath, registered_tier: "free_local" });
      assert.equal(freeIndex.mode, "index");
      assert.equal(freeIndex.total, 120);
      assert.equal(freeIndex.returned, freeIndex.entries.length);
      assert.equal(freeIndex.truncated, true);
      assert.equal(freeIndex.entries_truncated, true);
      assert.equal(freeIndex.omitted, freeIndex.total - freeIndex.returned);
      assert.ok(Buffer.byteLength(JSON.stringify(freeIndex, null, 2)) <= 4_096);
      for (const row of freeIndex.entries) {
        assert.ok(Object.keys(row).every((key) =>
          ["actor", "id", "related_codes", "symptom", "title"].includes(key)
        ));
        assert.equal("cause" in row, false);
        assert.equal("routes" in row, false);
        assert.ok(row.related_codes.length <= 4);
      }
      assert.equal(freeIndex.entries[0].symptom, "short symptom");

      const paidIndex = getAgentFaq({ corpusPath, registered_tier: "paid_cce" });
      assert.equal(paidIndex.total, 240);
      assert.ok(paidIndex.entries.some((entry) => entry.id === "synthetic-001"));

      const hiddenExact = getAgentFaq({
        corpusPath,
        registered_tier: "free_local",
        id: "synthetic-001"
      });
      assert.deepEqual(
        {
          total: hiddenExact.total,
          returned: hiddenExact.returned,
          omitted: hiddenExact.omitted,
          truncated: hiddenExact.truncated
        },
        { total: 0, returned: 0, omitted: 0, truncated: false }
      );

      const exact = getAgentFaq({
        corpusPath,
        registered_tier: "paid_cce",
        id: "synthetic-001"
      });
      assert.equal(exact.total, 1);
      assert.equal(exact.returned, 1);
      assert.equal(exact.omitted, 0);
      assert.equal(exact.truncated, false);
      assert.equal(exact.entries_truncated, false);
      assert.equal(exact.entry_fields_clipped, true);
      assert.equal(exact.entries[0].id, "synthetic-001");
      assert.equal(typeof exact.entries[0].cause, "string");
      assert.ok(Array.isArray(exact.entries[0].routes));
      assert.ok(Buffer.byteLength(JSON.stringify(exact, null, 2)) <= exact.max_response_bytes);

      const related = getAgentFaq({
        corpusPath,
        registered_tier: "paid_cce",
        related_code: "code-1"
      });
      assert.equal(related.total, 48);
      assert.ok(related.returned > 0);
      assert.ok(related.returned <= related.max_results);
      assert.equal(related.truncated, true);
      assert.equal(related.omitted, related.total - related.returned);
      assert.ok(Buffer.byteLength(JSON.stringify(related, null, 2)) <= related.max_response_bytes);
      assert.ok(related.entries.every((entry) => entry.related_codes.includes("code-1")));
    }
  );
});

test("WK-1377: FAQ output is tier-projected — free/local omits paid remediation entries", () => {
  const free = getAgentFaq({ registered_tier: "free_local" });
  const freeIds = free.entries.map((entry) => entry.id);

  assert.deepEqual(freeIds, [
    "read-scope-missing-or-unfamiliar",
    "dispatch-readiness-multi-cluster-or-critical-blast-radius",
    "run-validation-target-not-authorized",
    "remediation-slices-branch-from-unintegrated-base"
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

test("WK-1793#SLICE-027: corrective-status aliases resolve to one bounded paid FAQ entry", () => {
  const aliases = [
    "managed_corrective_status_reconciliation_required",
    "agent_launch.managed_run.corrective_integrated_state_unresolved.v1",
    "agent_launch.canonical_integrated_lifecycle_state.impossible.v1",
    "agent_launch.managed_run.corrective_status_reconciliation.v1"
  ];
  const results = aliases.map((related_code) =>
    getAgentFaq({ related_code, registered_tier: "paid_cce" })
  );
  const unfilteredPaid = getAgentFaq({ registered_tier: "paid_cce" });

  for (const result of results) {
    assert.equal(result.entry_count, 1);
    assert.equal(result.total_entry_count, unfilteredPaid.entry_count);
    assert.deepEqual(result.query.registered_tier, "paid_cce");
    assert.equal(result.entries[0].id, "managed-corrective-status-reconciliation");
  }
  assert.deepEqual(results.slice(1).map((result) => result.entries[0]), [
    results[0].entries[0],
    results[0].entries[0],
    results[0].entries[0]
  ]);

  const entry = results[0].entries[0];
  assert.deepEqual(entry.tier_visibility, ["paid_cce"]);
  assert.equal(entry.actor, "agent_or_operator");
  assert.match(
    entry.cause,
    /^The server-derived reviewed-integrated corrective-continuation path observed exactly parent=todo and slice=todo\./
  );
  assert.match(
    entry.cause,
    /This FAQ is advisory only: the coordinator may recover only that observed tuple by using the exact parent unit and exact slice subject carried by the typed refusal\./
  );
  assert.match(
    entry.cause,
    /Every other status, missing or unauthenticated fact, ambiguous state, or neighboring lifecycle state remains fail-closed on its typed refusal; do not infer a recovery from message text\.$/
  );
  assert.deepEqual(entry.routes, [
    {
      tool: "workspace_work_record_set_status",
      args: {
        unit: "<exact-parent-unit-from-refusal>",
        status: "active"
      },
      note: "Only after confirming the refusal's server-derived observed parent=todo and slice=todo tuple, set status active on the exact parent unit named by the refusal. This FAQ grants no mutation authority and performs no action itself."
    },
    {
      tool: "workspace_agent_dispatch",
      args: {
        role: "worker",
        subject: "<exact-slice-subject-from-refusal>"
      },
      note: "After the immediate status call succeeds, redispatch only the exact slice subject named by the same typed refusal. Stop on the refusal for every other state; do not clean up refs, receipts, identities, or worktrees."
    }
  ]);

  assert.doesNotMatch(JSON.stringify(entry), /automatically|status[^}]*done|role[^}]*reviewer/);
  assert.equal(entry.routes.some((route) => route.tool.includes("cleanup")), false);
  assert.equal(entry.routes.some((route) => route.tool.includes("spawn")), false);
  assert.match(entry.routes[0].note, /grants no mutation authority and performs no action itself\./);
  assert.match(entry.routes[1].note, /do not clean up refs, receipts, identities, or worktrees\./);
});

test("WK-1793#SLICE-027: corrective-status FAQ remains fail-closed for neighboring identifiers", () => {
  for (const related_code of [
    "operator_recovery_needed",
    "managed_run_identity_check_threw",
    "agent_launch.managed_run.corrective_integrated_state_unresolved.v2",
    "agent_launch.managed_run.corrective_status_reconciliation.neighbor",
    "does-not-exist"
  ]) {
    assert.deepEqual(
      getAgentFaq({ related_code, registered_tier: "paid_cce" }).entries,
      [],
      `${related_code} must not route to corrective-status FAQ`
    );
  }

  for (const id of [
    "managed-corrective-status-reconciliation-neighbor",
    "managed-corrective-status-reconciliation-required"
  ]) {
    assert.equal(getAgentFaqEntryById(id), null);
  }
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

test("WK-1928#SLICE-003: unintegrated remediation base resolves to integration route", () => {
  const entry = getAgentFaqEntryById("remediation-slices-branch-from-unintegrated-base");
  assert.ok(entry);
  assert.deepEqual(entry.tier_visibility, ["free_local", "paid_cce"]);
  assert.ok(entry.routes.some((route) => route.tool === "workspace_integrate_committed_slice"));
  assert.match(entry.routes[0].note, /completed findings-only review.*precondition of integration/i);
  assert.match(entry.routes[0].note, /review the slice, disposition.*then integrate/i);
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
