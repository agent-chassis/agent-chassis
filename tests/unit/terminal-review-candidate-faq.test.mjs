import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, root), "utf8"));
const taxonomy = readJson("packages/wiki-core/data/runtime-blocker-codes.v1.json");
const faq = readJson("packages/wiki-core/data/agent-faq.v1.json");
const discovery = readJson("packages/wiki-core/data/tool-discovery/launcher-tools.json");

const recoverable = new Set([
  "agent_launch.terminal_candidate.status.candidate_stale_w.v1",
  "agent_launch.terminal_candidate.transport_failure.v1",
  "agent_launch.terminal_candidate.continuation_invalid.v1",
  "agent_launch.terminal_candidate.continuation_stale.v1",
  "agent_launch.terminal_candidate.advance_not_stale.v1",
  "agent_launch.terminal_candidate.advance_input_moved.v1",
  "agent_launch.terminal_candidate.advance_final_recheck_failed.v1",
  "agent_launch.terminal_candidate.exclusion_refused.v1",
  "agent_launch.terminal_wk_candidate.invalid_argument.v1",
  "agent_launch.terminal_wk_candidate.git_failed.v1",
  "agent_launch.terminal_wk_candidate.input_moved.v1",
  "agent_launch.terminal_wk_candidate.candidate_ref_disagrees.v1"
]);

test("every supported terminal-candidate recovery has one bounded FAQ action", () => {
  const counts = new Map();
  const discoveryNames = new Set(discovery.tools.map((tool) => tool.tool_name));
  for (const entry of faq.entries) {
    for (const code of entry.related_codes ?? []) {
      if (!code.startsWith("agent_launch.terminal_")) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      assert.equal(entry.routes.length, 1, code);
      const route = entry.routes[0];
      assert.equal(discoveryNames.has(route.tool), true, route.tool);
      assert.deepEqual(Object.keys(route.args ?? {}), ["wk_id"]);
      assert.ok(route.note.length <= 512);
    }
  }
  assert.deepEqual(new Set(counts.keys()), recoverable);
  for (const code of recoverable) assert.equal(counts.get(code), 1, code);
});

test("non-recoverable terminal-candidate identities have no fabricated FAQ action", () => {
  const all = new Set(taxonomy.codes.map((entry) => entry.code)
    .filter((code) => code.startsWith("agent_launch.terminal_")));
  for (const code of recoverable) all.delete(code);
  const faqCodes = new Set(faq.entries.flatMap((entry) => entry.related_codes ?? []));
  for (const code of all) assert.equal(faqCodes.has(code), false, code);
});

test("advance is advertised only for stale W and status is the post-advance observation", () => {
  const stale = faq.entries.find((entry) => entry.id === "terminal-candidate-stale-w-advance");
  assert.equal(stale.routes[0].tool, "workspace_terminal_review_candidate_advance");
  const reobserve = faq.entries.find((entry) => entry.id === "terminal-candidate-advance-reobserve");
  assert.equal(reobserve.routes[0].tool, "workspace_terminal_review_candidate_status");
  const serialized = JSON.stringify([stale, reobserve]);
  for (const forbidden of ["git ", "ref:", "sha:", "path:", "cas:", "lock:"])
    assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
});
