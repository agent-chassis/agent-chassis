

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
} from "../../packages/wiki-core/src/index.mjs";
import {
  assertForgeHandoffGuidance,
  evaluateForgeHandoffGuidance,
  FORBIDDEN_AUTHORITY
} from "../helpers/forge-handoff-guidance.mjs";

const SEED_IDS = ["read-scope-missing-or-unfamiliar", "graph-impact-required-unavailable"];
const VERIFY_PROOF_EXECUTION_FAQ_ID = "verify-proof-execution-not-executable";
const VERIFY_PROOF_EXECUTION_CODES = [
  "agent_launch.verify_proof.input_invalid.v1",
  "agent_launch.verify_proof.binding_resolution_failed.v1",
  "agent_launch.verify_proof.attempt_context_failed.v1",
  "agent_launch.verify_proof.attempt_execution_failed.v1",
  "agent_launch.verify_proof.receipt_incomplete.v1",
  "agent_launch.verify_proof.receipt_cross_bound.v1",
  "test_proof_bound_identity_mismatch",
  "test_proof_selected_identity_not_observed"
];

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

test("verify-proof execution codes resolve one bounded recovery entry", () => {
  const entry = getAgentFaqEntryById(VERIFY_PROOF_EXECUTION_FAQ_ID);
  assert.equal(entry.actor, "agent_or_operator");
  assert.deepEqual(entry.routes.map(({ tool }) => tool), ["workspace_verify_proof"]);
  assert.match(entry.cause, /failing assertion is unsatisfied/u);
  assert.match(entry.cause, /not_executable or refused/u);
  assert.match(entry.cause, /deepest_stable_cause_code/u);
  for (const code of VERIFY_PROOF_EXECUTION_CODES) {
    assert.deepEqual(filterAgentFaqEntriesByRelatedCode(code).map(({ id }) => id),
      [VERIFY_PROOF_EXECUTION_FAQ_ID], code);
  }
  assert.deepEqual(filterAgentFaqEntriesByRelatedCode(
    "test_proof_structured_events_oversized"
  ).map(({ id }) => id), [VERIFY_PROOF_EXECUTION_FAQ_ID]);
  assert.match(entry.cause, /separate lossless machine-protocol channel/u);
  assert.match(entry.cause, /reduce the declared test's structured event population/u);
  assert.match(entry.cause, /expected_test_id/u);
  assert.match(entry.cause, /observed_identity_candidates/u);
});

test("getAgentFaq envelope narrows by id and related_code", () => {
  const all = getAgentFaq();
  assert.equal(all.schema_version, AGENT_FAQ_SCHEMA_VERSION);

  assert.equal(all.returned, all.entries.length);
  assert.equal(all.omitted, all.total - all.returned);
  assert.equal(all.truncated, all.returned < all.total);
  assert.equal(all.entries_truncated, all.truncated);
  assert.equal(all.total, all.total_entry_count);
  assert.equal(all.entry_count, all.returned);
  assert.equal(all.entry_fields_clipped, true);
  assert.equal(all.mode, "index");
  assert.equal(all.query.id, null);
  assert.ok(Buffer.byteLength(JSON.stringify(all, null, 2)) <= 4_096);
  for (const entry of all.entries) {
    const keys = Object.keys(entry).sort();
    assert.deepEqual(keys.filter((key) => key !== "symptom"), [
      "actor", "id", "related_codes", "title"
    ]);
    assert.ok(keys.length === 4 || (keys.length === 5 && keys.includes("symptom")));
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

  const freeVisibleIds = loadAgentFaqCorpus()
    .entries.filter((entry) => entry.tier_visibility.includes("free_local"))
    .map((entry) => entry.id);
  assert.deepEqual(freeIds, freeVisibleIds.slice(0, freeIds.length));
  assert.equal(free.total, freeVisibleIds.length);

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
  assert.ok(free.total_entry_count < paid.total_entry_count);
});

test("WK-2293#SLICE-018: FAQ does not grant corrective status or integration authority", () => {
  const corpus = JSON.stringify(loadAgentFaqCorpus());
  for (const staleId of [
    "managed-corrective-status-reconciliation",
    "remediation-slices-branch-from-unintegrated-base"
  ]) {
    assert.equal(getAgentFaqEntryById(staleId), null);
  }
  for (const forbidden of [
    "workspace_work_record_set_status",
    "workspace_integrate_committed_slice",
    "managed_corrective_status_reconciliation_required"
  ]) {
    assert.equal(corpus.includes(forbidden), false, `FAQ must not expose ${forbidden}`);
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

const FORGE_HANDOFF_FAQ_ID = "terminal-review-dispositioned-forge-handoff";

const forgeHandoffEntryText = (entry) =>
  [entry.title, entry.symptom, entry.cause, ...entry.routes.map((route) => route.note ?? "")].join(
    "\n"
  );

test("WK-1731 shipped corpus carries exactly one forge-handoff entry routed to the tool", () => {
  const entries = listAgentFaqEntries();
  const routed = entries.filter((entry) =>
    entry.routes.some((route) => route.tool === "workspace_wk_forge_handoff")
  );
  assert.deepEqual(
    routed.map((entry) => entry.id),
    [FORGE_HANDOFF_FAQ_ID],
    "exactly one corpus entry may route to workspace_wk_forge_handoff"
  );

  const entry = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID);
  assert.ok(entry);
  assert.equal(entry.actor, "agent_or_operator");
  assert.deepEqual(entry.tier_visibility, ["free_local", "paid_cce"]);

  assert.deepEqual(entry.routes.map((route) => route.args), [{ assigned_unit: "$wk_id" }]);
});

test("WK-1731 forge-handoff FAQ entry states the publication boundary", () => {
  assertForgeHandoffGuidance(forgeHandoffEntryText(getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID)), {
    surface: "agent-faq forge-handoff entry"
  });
});

test("WK-1731 forge-handoff FAQ entry claims no unsupported authority", () => {
  const entry = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID);
  assert.deepEqual(evaluateForgeHandoffGuidance(forgeHandoffEntryText(entry)).violations, []);

  for (const rule of FORBIDDEN_AUTHORITY) {
    const claims = {
      "merge-or-merge-observation": "It also merges the pull request and reports the merge state.",
      "state-reconciliation": "It reconciles the WK record with the landed branch.",
      "parent-wk-completion": "It completes the parent WK on success.",
      "candidate-reconstruction": "It rebuilds the candidate before publishing.",
      "caller-supplied-authority": "It accepts a caller-supplied base branch.",
      "shell-or-gh-route": "If it refuses, publish the branch with `gh` from the shell."
    };
    const spliced = { ...entry, cause: `${entry.cause} ${claims[rule.id]}` };
    assert.ok(
      evaluateForgeHandoffGuidance(forgeHandoffEntryText(spliced)).violations.some(
        (violation) => violation.id === rule.id
      ),
      `spliced ${rule.id} claim must be reported`
    );
  }
});

test("WK-1731 forge-handoff FAQ entry names only live routes and typed outcomes", () => {
  const entry = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID);

  assert.deepEqual(entry.related_codes, [
    "terminal_candidate_recovery_current_ref_absent",
    "wk_forge_handoff_executor_unavailable",
    "wk_forge_handoff_subject_invalid"
  ]);
  for (const code of entry.related_codes) {
    assert.deepEqual(
      filterAgentFaqEntriesByRelatedCode(code).map((item) => item.id),
      [FORGE_HANDOFF_FAQ_ID],
      `${code} must resolve to the forge-handoff entry`
    );
  }

  const serialized = JSON.stringify(entry);
  for (const absent of ["workspace_wk_forge_merge", "workspace_wk_complete", "gh pr", "git push"]) {
    assert.equal(serialized.includes(absent), false, `entry must not name ${absent}`);
  }
  assert.deepEqual(entry.routes.map((route) => route.tool), ["workspace_wk_forge_handoff"]);
});

test("WK-2153 forge-handoff FAQ entry does not claim an exhaustive refusal surface", () => {
  const entry = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID);

  assert.doesNotMatch(
    entry.cause,
    /whole recovery surface/i,
    "the entry must not claim its listed refusals are the complete recovery surface"
  );
  assert.match(
    entry.cause,
    /typed refusals include/i,
    "the entry must present its listed refusals as examples"
  );

  assert.deepEqual(entry.related_codes, [
    "terminal_candidate_recovery_current_ref_absent",
    "wk_forge_handoff_executor_unavailable",
    "wk_forge_handoff_subject_invalid"
  ]);
  for (const code of entry.related_codes) {
    assert.ok(entry.cause.includes(code), `${code} must still be explained in the entry`);
    assert.deepEqual(
      filterAgentFaqEntriesByRelatedCode(code).map((item) => item.id),
      [FORGE_HANDOFF_FAQ_ID],
      `${code} must still resolve to the forge-handoff entry`
    );
  }
});

test("WK-2153 forge-handoff FAQ route note permits the optional repository alias", () => {
  const [route] = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID).routes;
  const { note } = route;

  assert.match(note, /assigned_unit is required/i, "the note must state assigned_unit is required");
  assert.match(
    note,
    /alias may also be supplied/i,
    "the note must permit the workspace repository alias"
  );
  assert.match(
    note,
    /not repo-attached/i,
    "the note must say when the alias is needed"
  );

  assert.doesNotMatch(
    note,
    /and nothing else/i,
    "the note must not forbid the optional repository alias"
  );

  assert.deepEqual(route.args, { assigned_unit: "$wk_id" });
});

test("WK-2153 forge-handoff FAQ route note still rejects authority-shaped input", () => {
  const { note } = getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID).routes[0];

  for (const [concept, pattern] of [
    ["refs", /\brefs\b/i],
    ["SHAs", /\bSHAs\b/i],
    ["base or branch names", /base or branch names/i],
    ["candidate identity", /candidate identity/i],
    ["pull-request identity", /pull-request identity/i]
  ]) {
    assert.match(note, pattern, `the note must still forbid ${concept}`);
  }
  assert.match(note, /pass no other input/i, "the note must still close the input surface");

  const serialized = JSON.stringify(getAgentFaqEntryById(FORGE_HANDOFF_FAQ_ID));
  for (const absent of ["gh pr", "git push", "workspace_wk_forge_merge"]) {
    assert.ok(!serialized.includes(absent), `entry must not name ${absent}`);
  }
});
