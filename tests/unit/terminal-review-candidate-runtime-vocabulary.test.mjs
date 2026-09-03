import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TERMINAL_CANDIDATE_RUNTIME_CODES
} from "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";
import {
  TERMINAL_WK_CANDIDATE_CODES
} from "../../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

const root = new URL("../../", import.meta.url);
const taxonomy = JSON.parse(readFileSync(new URL(
  "packages/wiki-core/data/runtime-blocker-codes.v1.json", root
), "utf8"));
const registered = taxonomy.codes.map((entry) => entry.code);
const terminalRegistered = registered.filter((code) => code.startsWith("agent_launch.terminal_"));
const expected = new Set([
  ...Object.values(TERMINAL_CANDIDATE_RUNTIME_CODES),
  "agent_launch.terminal_candidate.exclusion_refused.v1",
  TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
  TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
  TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID,
  TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
  TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
  TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
  TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH
]);

test("live terminal-candidate producer identities have complete bidirectional registry coverage", () => {
  assert.equal(new Set(registered).size, registered.length, "global code identities must be unique");
  assert.deepEqual(new Set(terminalRegistered), expected);
  for (const code of expected) {
    const entries = taxonomy.codes.filter((entry) => entry.code === code);
    assert.equal(entries.length, 1, code);
    assert.ok(taxonomy.code_categories.includes(entries[0].category), code);
    assert.ok(taxonomy.actor_recovery_values.includes(entries[0].actor_recovery), code);
    assert.equal(typeof entries[0].blocking, "boolean", code);
    assert.ok(entries[0].summary.length > 0 && entries[0].summary.length <= 256, code);
  }
});

test("runtime vocabulary uses no hard-coded global registry population count", () => {
  const source = readFileSync(new URL(
    "tests/unit/terminal-review-candidate-runtime-vocabulary.test.mjs", root
  ), "utf8");
  assert.equal(/taxonomy\.codes\.length\s*,\s*\d+/u.test(source), false);
});
