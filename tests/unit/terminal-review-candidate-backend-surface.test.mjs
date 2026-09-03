import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceAgentDispatchBackend } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";

test("one public backend generation exposes the bound-state and exclusion owners", async (t) => {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "terminal-backend-surface-main-"));
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "terminal-backend-surface-worktrees-"));
  t.after(() => rm(mainRepo, { recursive: true, force: true }));
  t.after(() => rm(worktreeRoot, { recursive: true, force: true }));
  const backend = createWorkspaceAgentDispatchBackend({
    worktreeProvisioning: { mainRepo, worktreeRoot }
  });
  assert.equal(typeof backend.observeTerminalCandidateBoundState, "function");
  assert.equal(typeof backend.withTerminalCandidateAdvanceExclusion, "function");
  assert.deepEqual(await backend.observeTerminalCandidateBoundState("WK-1864"), { state: "unbound" });
  const calls = [];
  const value = await backend.withTerminalCandidateAdvanceExclusion({
    wkId: "WK-1864",
    evaluateTerminalReviewCandidateStatus: () => {
      calls.push("status");
      return { state: "candidate_stale_w", snapshot: calls.length };
    },
    run: (inside) => inside.snapshot
  });
  assert.equal(value, 2);
  assert.deepEqual(calls, ["status", "status"]);
});
